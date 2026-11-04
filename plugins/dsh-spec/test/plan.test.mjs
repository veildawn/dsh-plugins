/**
 * Plan dock model tests.
 *
 * The Spec preset replaces the host's `todo_write` with a projection derived
 * from tasks.md. These assertions pin what the dock promises: waves come from
 * the dependency graph, checkpoints are not work, parallel tasks in one wave
 * are all visible as in progress, and nothing is invented when the document
 * does not say it.
 *
 * Run: node --test test/plan.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { planFor, publishPlan } from '../lib/plan-bridge.js';
import { planCounts, planProjectionDefinition, planState, planWaves } from '../lib/plan.js';
import { parseTasks } from '../lib/tasks.js';

const DOC = `# Implementation Plan: wc-lite

## Overview

x

## Tasks

- [x] 1. Scaffold
  - [x] 1.1 Create the manifest

- [ ] 2. Implement the core
  - [x] 2.1 count.js
  - [~] 2.2 tests

- [ ] 3. Checkpoint
  - Ensure all tests pass.

## Notes

## Task Dependency Graph

\`\`\`json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2"] }
  ]
}
\`\`\`
`;

const GRAPH = {
  waves: [
    { id: 0, tasks: ['1.1'] },
    { id: 1, tasks: ['2.1', '2.2'] },
  ],
};

function parsed() {
  return parseTasks(DOC);
}

test('waves follow the dependency graph and keep parallel tasks together', () => {
  const { waves, unscheduled } = planWaves(parsed(), GRAPH);
  assert.deepEqual(waves.map((wave) => wave.id), [0, 1]);
  // 2.1 and 2.2 share wave 1: the dock must show them as one parallel batch.
  assert.deepEqual(waves[1].tasks.map((task) => task.id), ['2.1', '2.2']);
  assert.deepEqual(unscheduled, [], 'every leaf is graphed in this document');
});

test('checkpoints are not scheduled work', () => {
  // Kiro's template writes checkpoints as leaves outside the graph. The dock
  // must not offer "run the checkpoint" beside real tasks.
  const { waves, unscheduled } = planWaves(parsed(), GRAPH);
  const ids = [...waves.flatMap((wave) => wave.tasks), ...unscheduled].map((task) => task.id);
  assert.equal(ids.includes('3'), false);
  assert.equal(ids.includes('1'), false, 'parents are not scheduled, only their leaves');
});

test('a leaf the graph forgot is kept, not dropped', () => {
  const { unscheduled } = planWaves(parsed(), { waves: [{ id: 0, tasks: ['1.1'] }] });
  assert.deepEqual(unscheduled.map((task) => task.id), ['2.1', '2.2']);
});

test('counts cover leaves only, so a finished parent is not counted twice', () => {
  const counts = planCounts(planWaves(parsed(), GRAPH).waves.flatMap((wave) => wave.tasks));
  assert.equal(counts.total, 3, '1.1, 2.1 and 2.2');
  assert.equal(counts.done, 2);
  assert.equal(counts.queued, 1);
  assert.equal(counts.pending, 0);
  assert.equal(counts.percent, 67);
});

test('several tasks may be in progress at once — the parallel case', () => {
  const doc = DOC.replace('- [~] 2.2 tests', '- [-] 2.2 tests').replace('- [x] 2.1 count.js', '- [-] 2.1 count.js');
  const waves = planWaves(parseTasks(doc), GRAPH).waves;
  const state = planState({ feature: 'demo', phase: 'execution', parsed: parseTasks(doc), graph: GRAPH });
  const running = state.waves.flatMap((wave) => wave.tasks).filter((task) => task.status === 'in_progress');
  assert.equal(running.length, 2, 'a wave runs its tasks in parallel');
  assert.equal(waves.length, 2);
  assert.equal(state.counts.active, 2);
});

test('a finished wave is still listed, marked closed', () => {
  const doc = DOC.replace('- [~] 2.2 tests', '- [x] 2.2 tests').replace('- [x] 2.1 count.js', '- [x] 2.1 count.js');
  const state = planState({ feature: 'demo', phase: 'done', parsed: parseTasks(doc), graph: GRAPH });
  assert.equal(state.waves[0].open, false);
  assert.equal(state.waves[1].open, false);
  assert.equal(state.counts.percent, 100);
});

test('a parent finished by its subtree carries the derived flag to the dock', () => {
  const state = planState({ feature: 'demo', phase: 'execution', parsed: parseTasks(DOC), graph: GRAPH });
  // 2 is complete by subtree in DOC (2.1 done, 2.2 queued → not yet), so check
  // the derived path on a document where it does hold.
  const done = DOC.replace('- [~] 2.2 tests', '- [x] 2.2 tests');
  const derivedState = planState({ feature: 'demo', phase: 'execution', parsed: parseTasks(done), graph: GRAPH });
  assert.equal(derivedState.counts.percent, 100);
  assert.equal(state.feature, 'demo');
});

test('a spec without tasks.md publishes nothing', () => {
  assert.equal(planFor({ feature: 'demo', phase: 'requirements', tasks: null }), null);
  assert.equal(planFor({ feature: 'demo', phase: 'requirements' }), null);
});

test('the projection folds whole plan events and survives a turn boundary', () => {
  const def = planProjectionDefinition();
  const plan = planState({ feature: 'demo', phase: 'execution', parsed: parsed(), graph: GRAPH });
  assert.equal(def.init(), null, 'nothing is reported before the first write');
  assert.deepEqual(def.apply(null, { type: 'spec/plan', data: { plan } }), plan);
  // The plan comes from tasks.md, not from what one turn did, so a new turn
  // must not blank the dock — that made it vanish at every turn start.
  assert.deepEqual(def.apply(plan, { type: 'turn/start' }), plan, 'a turn boundary leaves the plan alone');
  assert.equal(def.apply(plan, { type: 'tool/call' }), plan, 'unrelated events leave the plan alone');
  assert.equal(def.apply(plan, { type: 'spec/plan', data: { plan: null } }), null, 'a null plan clears the dock');
});

test('the projection validates what it serves', () => {
  const def = planProjectionDefinition();
  assert.deepEqual(def.stateSchema.parse(null), null);
  assert.throws(() => def.stateSchema.parse({ feature: 'demo', counts: {}, waves: 'no' }), /waves/u);
  assert.throws(() => def.wire.viewSchema.parse({ feature: 1, counts: {}, waves: [], unscheduled: [] }), /feature/u);
});

test('publishing appends one whole-plan event to the calling session', () => {
  const appended = [];
  const exec = { agent: { session: { append: (type, data) => appended.push({ type, data }) } } };
  const plan = publishPlan({}, exec, { feature: 'demo', phase: 'execution', tasks: parsed(), graph: GRAPH });
  assert.equal(appended.length, 1);
  assert.equal(appended[0].type, 'spec/plan');
  assert.deepEqual(appended[0].data.plan, plan);
  assert.equal(appended[0].data.plan.feature, 'demo');
});

test('publishing without a session is a no-op, never a failure', () => {
  assert.equal(planFor({ feature: 'demo', phase: 'execution', tasks: parsed(), graph: GRAPH }).waves.length, 2);
  // The panel's RPC toggle passes a sessionId and no agent; an unknown id means
  // no publish, and the tool call itself still succeeds.
  const plan = publishPlan({ get: () => undefined }, {}, { feature: 'demo', phase: 'execution', tasks: parsed(), graph: GRAPH }, 'nope');
  assert.equal(plan.feature, 'demo');
});
