/**
 * Kiro task-list model tests.
 *
 * Pins the semantics Kiro implements: checkbox grammar (`[ ]`, `[~]`, `[-]`,
 * `[x]`), optional `*` subtasks, parent completion propagation, required-child
 * blocking, wave scheduling, linear bugfix order, in-place writes, and the
 * tasks.meta.json record shape.
 *
 * Run: node --test test/tasks.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyStatusChanges,
  attachWaveInfo,
  boxToStatus,
  metadataPathFor,
  parseDependencyGraph,
  parseTasks,
  planStatusChange,
  readyTasks,
  recordExecution,
  recordPbtResult,
  reconcileDependencyGraph,
  taskProgress,
  writeStatusLine,
} from '../lib/tasks.js';

const DOC = `# Implementation Plan: Demo

## Overview

Demo plan.

## Tasks

- [ ] 1. Setup project
  - _Requirements: 1.1_

- [ ] 2. Build it
  - [ ] 2.1 Implement core
    - _Requirements: 1.1_

  - [ ]* 2.2 Write property test
    - **Property 1: Round trip**
    - **Validates: Requirements 1.2**

  - [ ] 2.3 Implement edge
    - _Requirements: 1.2_

- [ ] 3. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- keep it simple

## Task Dependency Graph

\`\`\`json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.3"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["3"] }
  ]
}
\`\`\`
`;

test('checkbox characters map to Kiro statuses', () => {
  assert.equal(boxToStatus(' '), 'not_started');
  assert.equal(boxToStatus('~'), 'queued');
  assert.equal(boxToStatus('-'), 'in_progress');
  assert.equal(boxToStatus('x'), 'completed');
  assert.equal(boxToStatus('X'), 'completed');
});

test('parseTasks builds the two-level hierarchy with optional markers', () => {
  const parsed = parseTasks(DOC);
  assert.deepEqual(parsed.tasks.map((task) => task.id), ['1', '2', '2.1', '2.2', '2.3', '3']);
  const parent = parsed.byId.get('2');
  assert.deepEqual(parent.children.map((task) => task.id), ['2.1', '2.2', '2.3']);
  assert.equal(parsed.byId.get('2.2').optional, true);
  assert.equal(parsed.byId.get('2.1').optional, false);
  assert.deepEqual(parsed.byId.get('2.1').requirements, ['1.1']);
  assert.match(parsed.byId.get('2.2').body.join('\n'), /Property 1/u);
});

test('progress counts required leaves only', () => {
  const parsed = parseTasks(DOC);
  const progress = taskProgress(parsed);
  assert.equal(progress.total, 6);
  assert.equal(progress.leaves, 5);
  assert.equal(progress.required, 4);
  assert.equal(progress.optional, 1);
  assert.equal(progress.percent, 0);
});

test('dependency graph parses and validates', () => {
  const { graph, issues } = parseDependencyGraph(DOC);
  assert.deepEqual(issues, []);
  assert.equal(graph.waves.length, 4);
  assert.deepEqual(graph.waves[1].tasks, ['2.1', '2.3']);
});

test('reconciling the graph reports unknown, duplicate and missing tasks', () => {
  const parsed = parseTasks(DOC);
  const reconciled = reconcileDependencyGraph(parsed, {
    waves: [
      { id: 0, tasks: ['1', '9.9'] },
      { id: 2, tasks: ['1'] },
    ],
  });
  const rules = reconciled.map((issue) => issue.rule);
  assert.ok(rules.includes('dag/unknown-task'));
  assert.ok(rules.includes('dag/duplicate-task'));
  assert.ok(rules.includes('dag/non-contiguous-waves'));
  assert.ok(rules.includes('dag/missing-task'));
});

test('checkpoints are exempt from the "every leaf is graphed" rule', () => {
  // Kiro's own template ships "N. Checkpoint" leaves outside its waves, so
  // demanding every leaf be graphed flagged every spec written from it.
  const parsed = parseTasks(DOC);
  const graphed = reconcileDependencyGraph(parsed, {
    waves: [{ id: 0, tasks: ['1', '2.1', '2.2', '2.3'] }],
  });
  assert.deepEqual(graphed.filter((issue) => issue.rule === 'dag/missing-task'), []);
  // Work leaves are still required.
  const partial = reconcileDependencyGraph(parsed, {
    waves: [{ id: 0, tasks: ['1', '2.1', '2.2'] }],
  });
  assert.deepEqual(
    partial.filter((issue) => issue.rule === 'dag/missing-task').map((issue) => issue.message),
    ['Leaf task "2.3" is not in the dependency graph; it will be scheduled after the last wave.'],
  );
});

test('wave dependencies gate readiness and optional tasks never block', () => {
  const parsed = parseTasks(DOC);
  const { graph } = parseDependencyGraph(DOC);
  attachWaveInfo(parsed, graph);
  assert.equal(parsed.byId.get('2.1').wave, 1);
  assert.deepEqual(parsed.byId.get('2.1').dependencies, ['1']);
  assert.deepEqual(parsed.byId.get('3').dependencies, ['1', '2.1', '2.3', '2.2']);

  assert.deepEqual(readyTasks(parsed).map((task) => task.id), ['1']);
  parsed.byId.get('1').status = 'completed';
  assert.deepEqual(readyTasks(parsed).map((task) => task.id), ['2.1', '2.3']);
  parsed.byId.get('2.1').status = 'completed';
  parsed.byId.get('2.3').status = 'completed';
  // 2.2 is optional: it is not returned as ready work and does not gate wave 3.
  assert.deepEqual(readyTasks(parsed).map((task) => task.id), ['3']);
});

test('without a graph readiness is linear', () => {
  const parsed = parseTasks(DOC.split('## Task Dependency Graph')[0]);
  attachWaveInfo(parsed, null);
  assert.deepEqual(readyTasks(parsed).map((task) => task.id), ['1']);
  parsed.byId.get('1').status = 'completed';
  assert.deepEqual(readyTasks(parsed).map((task) => task.id), ['2.1']);
});

test('completing children propagates to the parent', () => {
  const parsed = parseTasks(DOC);
  const first = planStatusChange(parsed, '2.1', 'completed');
  assert.deepEqual(first.changes.map((change) => change.taskId), ['2.1']);
  parsed.byId.get('2.1').status = 'completed';
  const second = planStatusChange(parsed, '2.3', 'completed');
  assert.deepEqual(second.changes.map((change) => change.taskId), ['2.3']);
  parsed.byId.get('2.3').status = 'completed';
  // 2.2 is optional, so completing the required children completes the parent.
  const last = planStatusChange(parsed, '2.2', 'completed');
  assert.deepEqual(last.changes.map((change) => change.taskId).sort(), ['2', '2.2']);
});

test('a parent whose required children are all done reads as completed', () => {
  // An Agent that edits tasks.md directly checks the subtasks it ran and leaves
  // the parent's own box alone. Reporting that parent as "not started" would be
  // the opposite of the honest status this model promises.
  const doc = `# Implementation Plan: Demo

## Tasks

- [ ] 1. Scaffold the project
  - [x] 1.1 Create the manifest
  - [x] 1.2 Create the layout
- [x] 2. Implement the core
  - [x] 2.1 Write the parser
`;
  const parsed = parseTasks(doc);
  const parent = parsed.byId.get('1');
  assert.equal(parent.status, 'completed');
  assert.equal(parent.derived, true, 'the status is derived, not written');
  assert.equal(parent.box, ' ', 'the file still holds the raw unchecked box');
  assert.equal(parsed.byId.get('2').derived, undefined, 'a checked parent is not derived');
  assert.equal(taskProgress(parsed).percent, 100);
});

test('an open required child keeps its parent incomplete', () => {
  const doc = `# Implementation Plan: Demo

## Tasks

- [ ] 1. Scaffold the project
  - [x] 1.1 Create the manifest
  - [ ] 1.2 Create the layout
`;
  const parsed = parseTasks(doc);
  assert.equal(parsed.byId.get('1').status, 'not_started');
  assert.equal(parsed.byId.get('1').derived, undefined);
});

test('optional children never derive a parent', () => {
  // A parent with nothing but optional subtasks keeps its own box as the only
  // statement about it: skipping the optional work is not the same as doing it.
  const doc = `# Implementation Plan: Demo

## Tasks

- [ ] 1. Add the smoke tests
  - [ ]* 1.1 Optional property test
  - [ ]* 1.2 Optional fuzz test
- [ ] 2. Mixed
  - [x] 2.1 Required work
  - [ ]* 2.2 Optional property test
`;
  const parsed = parseTasks(doc);
  assert.equal(parsed.byId.get('1').status, 'not_started', 'only optional children');
  assert.equal(parsed.byId.get('2').status, 'completed', 'the required child is done');
});

test('deriving a parent status never rewrites the file', () => {
  const doc = `# Implementation Plan: Demo

## Tasks

- [ ] 1. Scaffold the project
  - [x] 1.1 Create the manifest
`;
  const parsed = parseTasks(doc);
  assert.equal(parsed.byId.get('1').status, 'completed');
  // The line keeps its original unchecked box: the status is a reading of the
  // subtree, so nothing is written back until someone asks for a change.
  assert.match(applyStatusChanges(doc, []), /^- \[ \] 1\. Scaffold the project$/mu);
});

test('a parent cannot complete while required children are open', () => {
  const parsed = parseTasks(DOC);
  const plan = planStatusChange(parsed, '2', 'completed');
  assert.match(plan.error, /Cannot complete parent task "2"/u);
  assert.match(plan.error, /2\.1/u);
});

test('starting a task warns about earlier unfinished required siblings', () => {
  const parsed = parseTasks(DOC);
  const plan = planStatusChange(parsed, '3', 'in_progress');
  assert.equal(plan.changes.length, 1);
  assert.ok(plan.warnings.some((warning) => /has not been completed yet/u.test(warning)));
});

test('status writes touch exactly one checkbox and preserve formatting', () => {
  const parsed = parseTasks(DOC);
  const next = applyStatusChanges(DOC, [{ taskId: '2.2', newStatus: 'in_progress' }]);
  const original = DOC.split('\n');
  const updated = next.split('\n');
  assert.equal(original.length, updated.length);
  assert.equal(updated[parsed.byId.get('2.2').line], '  - [-]* 2.2 Write property test');
  // Everything else is byte-identical.
  for (let index = 0; index < original.length; index += 1) {
    if (index === parsed.byId.get('2.2').line) continue;
    assert.equal(original[index], updated[index]);
  }
});

test('writeStatusLine keeps the decimal separator style', () => {
  assert.equal(writeStatusLine('- [ ] 2. Parent', 'completed'), '- [x] 2. Parent');
  assert.equal(writeStatusLine('  - [ ]* 2.1 Child', 'completed'), '  - [x]* 2.1 Child');
});

test('metadata helpers record execution history and PBT results', () => {
  const metadata = { pbtResults: {}, executionHistory: {} };
  for (let index = 0; index < 12; index += 1) {
    recordExecution(metadata, '1.1', { executionId: `exec-${index}`, chatSessionId: 'sess', timestamp: index });
  }
  assert.equal(metadata.executionHistory['1.1'].length, 10);
  assert.equal(metadata.executionHistory['1.1'][9].executionId, 'exec-11');
  recordPbtResult(metadata, '1.2', { status: 'failed', failingExample: 'a != b', timestamp: 42 });
  assert.deepEqual(metadata.pbtResults['1.2'], { status: 'failed', failingExample: 'a != b', lastRunTimestamp: 42 });
  assert.equal(metadataPathFor('/tmp/spec/tasks.md'), '/tmp/spec/tasks.meta.json');
});

test('a passing PBT result carries no counterexample key, matching what is written', () => {
  const metadata = { pbtResults: {}, executionHistory: {} };
  recordPbtResult(metadata, '1.3', { status: 'passed', timestamp: 43 });
  assert.deepEqual(metadata.pbtResults['1.3'], { status: 'passed', lastRunTimestamp: 43 });
  assert.equal('failingExample' in metadata.pbtResults['1.3'], false);
  assert.deepEqual(JSON.parse(JSON.stringify(metadata)).pbtResults['1.3'], metadata.pbtResults['1.3']);
});
