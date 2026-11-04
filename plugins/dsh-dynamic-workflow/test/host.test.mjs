import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DSH_HOME = await mkdtemp(path.join(tmpdir(), 'dwf-home-'));
const workspace = await mkdtemp(path.join(tmpdir(), 'dwf-ws-'));

const { apply, inject, name, RPC_CHANNEL } = await import('../lib/index.js');

function makeCtx() {
  const listeners = new Map();
  const followups = [];
  const state = { handler: null, channel: null, options: null, command: null };
  const agent = { session: { id: 's1', header: { cwd: workspace } }, followup: (message) => followups.push(message) };
  const ctx = {
    logger: { warn() {} },
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
      return () => {};
    },
    emit(event, ...args) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
    get(key) {
      if (key === 'sessions') return { get: (id) => (id === 's1' ? agent.session : undefined) };
      if (key === 'agents') return { get: (id) => (id === 's1' ? agent : undefined) };
      return undefined;
    },
    inject(_names, fn) {
      fn({ commands: { register: (def) => { state.command = def; return () => {}; } }, on() {} });
    },
    connection: {
      rpc: {
        handle(channel, handler, options) {
          state.channel = channel;
          state.handler = handler;
          state.options = options;
          return async () => {};
        },
      },
    },
  };
  return { ctx, state, followups, agent };
}

const call = async (state, method, payload = {}) => state.handler(method, payload);

test('plugin identity', () => {
  assert.equal(name, 'dynamic-workflow');
  assert.deepEqual(inject, ['connection']);
  assert.equal(RPC_CHANNEL, '/dsh-dynamic-workflow');
});

test('end to end: observe a run, watch, save it, launch it, slash command', async () => {
  const { ctx, state, followups, agent } = makeCtx();
  apply(ctx, { persist: false });
  assert.equal(state.channel, RPC_CHANNEL);
  assert.equal(state.options.authority, 'trusted-host');
  assert.equal(state.command.name, 'workflow');

  const before = (await call(state, 'describe', { sessionId: 's1' })).value;
  assert.equal(before.projectDir, path.join(workspace, '.dsh', 'workflows'));

  const watching = call(state, 'watch', { since: before.rev, timeoutMs: 5000 });
  const meta = { name: 'fanout', description: 'fan out', phases: [{ title: 'Scan' }] };
  const session = { id: 's1' };
  ctx.emit('session/event', session, { type: 'tool/call', data: { name: 'workflow', callId: 'k', arguments: JSON.stringify({ meta, script: 'return 1', args: { n: 2 } }) } });
  ctx.emit('session/event', session, { type: 'tool-workflow/run-start', data: { runId: 'R', name: 'fanout' } });
  ctx.emit('workflow/start', { id: 'R', meta });
  ctx.emit('workflow/phase', { id: 'R', meta }, 'Scan');
  ctx.emit('workflow/agent-start', { id: 'R', meta }, { seq: 1, label: 'scan a', phase: 'Scan', childId: 'c1' });
  const woke = (await watching).value;
  assert.ok(woke.rev > before.rev);

  const runs = (await call(state, 'runs', { sessionId: 's1' })).value.runs;
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'running');
  ctx.emit('workflow/agent-end', { id: 'R', meta }, { seq: 1, label: 'scan a', phase: 'Scan', childId: 'c1', outcome: 'completed' });
  ctx.emit('workflow/end', { id: 'R', meta }, { stopReason: 'completed', agentsStarted: 1 });
  const run = (await call(state, 'run', { runId: 'R' })).value;
  assert.equal(run.status, 'completed');
  assert.equal(run.graph.lanes[0].state, 'done');

  const saved = (await call(state, 'saveRun', { runId: 'R', scope: 'project', sessionId: 's1' })).value;
  assert.equal(saved.name, 'fanout');
  const list = (await call(state, 'workflows', { sessionId: 's1' })).value.workflows;
  assert.equal(list.length, 1);

  const launched = (await call(state, 'launch', { sessionId: 's1', name: 'fanout', args: { n: 5 } })).value;
  assert.equal(launched.launched, 'fanout');
  assert.equal(followups.length, 1);
  assert.match(followups[0].content[0].text, /"n": 5/u);

  const listed = await state.command.handler({ agent, rawInput: '' });
  assert.match(listed.text, /fanout \[project\]/u);
  const ran = await state.command.handler({ agent, rawInput: ' fanout' });
  assert.equal(ran.kind, 'success');
  assert.equal(followups.length, 2);
  const authored = await state.command.handler({ agent, rawInput: ' 审查项目问题' });
  assert.equal(authored.kind, 'success');
  assert.equal(followups.length, 3);
  assert.match(followups[2].content[0].text, /Design and run a dynamic workflow for this task: 审查项目问题/u);

  assert.equal((await call(state, 'deleteRun', { runId: 'R' })).value.deleted, true);
  assert.equal((await call(state, 'run', { runId: 'R' })).error.code, 'not-found');
  assert.equal((await call(state, 'launch', { sessionId: 'nope', name: 'fanout' })).error.code, 'session-unavailable');
  assert.equal((await call(state, 'bogus')).error.code, 'unknown-method');
});
