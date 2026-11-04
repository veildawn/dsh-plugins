import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createRunStore } from '../lib/store.js';

const meta = {
  name: 'review',
  description: 'review changes',
  phases: [{ title: 'Find', detail: 'look' }, { title: 'Verify' }, { title: 'Report' }],
};
const info = { id: 'run-1', meta };

test('engine events fold into phase lanes, nodes and edges', () => {
  let clock = 1000;
  const store = createRunStore({ now: () => clock });
  store.runStart(info);
  store.phase(info, 'Find');
  store.agentStart('run-1', { seq: 1, label: 'finder a', phase: 'Find', childId: 'c1' });
  store.agentStart('run-1', { seq: 2, label: 'finder b', childId: 'c2' });
  clock = 2000;
  store.agentEnd('run-1', { seq: 1, label: 'finder a', phase: 'Find', childId: 'c1', outcome: 'completed' });
  store.phase(info, 'Verify');
  store.agentStart('run-1', { seq: 3, label: 'verifier', phase: 'Verify', childId: 'c3' });

  const run = store.get('run-1');
  assert.equal(run.status, 'running');
  assert.equal(run.currentPhase, 'Verify');
  assert.deepEqual(run.graph.lanes.map((lane) => lane.title), ['Find', 'Verify', 'Report']);
  assert.deepEqual(run.graph.lanes.map((lane) => lane.state), ['running', 'running', 'pending']);
  assert.deepEqual(run.graph.lanes[0].nodes, [1, 2]);
  assert.equal(run.graph.lanes[0].detail, 'look');
  assert.deepEqual(run.graph.edges, [{ from: 'p0', to: 'p1' }, { from: 'p1', to: 'p2' }]);
  assert.equal(run.nodes[0].status, 'completed');

  store.runEnd('run-1', { stopReason: 'completed', agentsStarted: 3 });
  const done = store.get('run-1');
  assert.equal(done.status, 'completed');
  assert.ok(done.nodes.every((node) => node.status === 'completed'));
  assert.equal(done.graph.lanes[2].state, 'skipped');
});

test('session records and engine events are idempotent and bind the session', () => {
  const store = createRunStore();
  store.toolCall('s1', 'call-1', JSON.stringify({ meta, script: 'return 1', args: { a: 1 } }));
  store.sessionRunStart('s1', { runId: 'run-2', name: 'review' });
  store.runStart({ id: 'run-2', meta });
  store.agentStart('run-2', { seq: 1, label: 'x', childId: 'c' });
  store.agentStart('run-2', { seq: 1, label: 'x', childId: 'c' });
  store.agentEnd('run-2', { seq: 1, outcome: 'failed' });
  store.agentEnd('run-2', { seq: 1, outcome: 'failed' });
  store.runEnd('run-2', { stopReason: 'error', error: 'boom' });
  store.runEnd('run-2', { stopReason: 'error' });

  const run = store.get('run-2');
  assert.equal(run.sessionId, 's1');
  assert.equal(run.script, 'return 1');
  assert.deepEqual(run.args, { a: 1 });
  assert.equal(run.nodes.length, 1);
  assert.equal(run.status, 'error');
  assert.equal(run.error, 'boom');
  assert.equal(run.logs.filter((line) => line.kind === 'end').length, 1);
  assert.equal(store.list({ sessionId: 's1' }).runs.length, 1);
  assert.equal(store.list({ sessionId: 'other' }).runs.length, 0);
});

test('a tool call arriving after the run still attaches its script', () => {
  const store = createRunStore();
  store.sessionRunStart('s1', { runId: 'run-3', name: 'review' });
  store.toolCall('s1', 'call', JSON.stringify({ meta, script: 'return 2' }));
  assert.equal(store.get('run-3').script, 'return 2');
});

test('rev only moves forward and every mutation bumps it', () => {
  const store = createRunStore();
  const r0 = store.rev;
  store.runStart(info);
  const r1 = store.rev;
  store.log(info, 'hi');
  assert.ok(r1 > r0 && store.rev > r1);
});

test('persisted running runs reload as interrupted', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dwf-store-'));
  const first = createRunStore({ dir });
  first.runStart(info);
  first.agentStart('run-1', { seq: 1, label: 'a', childId: 'c' });
  await first.close();
  assert.deepEqual(await readdir(path.join(dir, 'runs')), ['run-1.json']);

  const second = createRunStore({ dir });
  assert.equal(await second.load(), 1);
  const run = second.get('run-1');
  assert.equal(run.status, 'interrupted');
  assert.equal(run.nodes[0].status, 'interrupted');
  await second.close();
});

test('running runs cannot be deleted; finished ones can', async () => {
  const store = createRunStore();
  store.runStart(info);
  await assert.rejects(store.remove('run-1'));
  store.runEnd('run-1', { stopReason: 'cancelled' });
  assert.equal(await store.remove('run-1'), true);
  assert.equal(store.get('run-1'), null);
});
