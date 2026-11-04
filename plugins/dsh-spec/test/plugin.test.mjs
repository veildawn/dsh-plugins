/**
 * Preset end-to-end tests.
 *
 * Everything runs against a temp workspace and a fake cordis context: no DSH
 * process, no network. The assertions pin Kiro's observable contract — the
 * on-disk layout, the template validation result, task checkbox writes, parent
 * propagation, and tasks.meta.json — plus the RPC surface the Web panel gets
 * from the host half.
 *
 * The eight tools are mounted by the preset half (`lib/tools.js`), which is how
 * a session that selected the Spec preset receives them; the host row
 * (`lib/index.js`) only serves RPC.
 *
 * Run: node --test test/plugin.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const previousHome = process.env.DSH_HOME;
const home = await mkdtemp(path.join(tmpdir(), 'dsh-spec-home-'));
process.env.DSH_HOME = home;

const host = await import('../lib/index.js');
const preset = await import('../lib/tools.js');
const { TOOL_NAMES, DEFAULT_SETTINGS } = host;
const { SPEC_POLICY_TEXT } = preset;
const { parseTasks } = await import('../lib/tasks.js');

const workspace = await mkdtemp(path.join(tmpdir(), 'dsh-spec-ws-'));

function makeCtx() {
  const tools = new Map();
  let rpcHandler = null;
  const injections = [];
  const sections = [];
  const contexts = [];
  const promptService = {
    section: (section) => { sections.push(section); return () => {}; },
    context: (context) => { contexts.push(context); return () => {}; },
  };
  const services = {
    workspaceRegistry: { list: () => [{ path: workspace }] },
    systemPrompt: promptService,
  };
  const base = {
    on: () => {},
    inject: (deps, callback) => { injections.push({ deps, callback }); },
    get: (key) => services[key],
    logger: { warn: () => {} },
  };
  // Host half: RPC channel only.
  host.apply({
    ...base,
    connection: { rpc: { handle: (channel, handler) => { if (channel === '/dsh-spec') rpcHandler = handler; return async () => {}; } } },
  }, {});
  // Preset half: tools + prompt, in the preset scope.
  preset.apply({
    ...base,
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
  }, {});
  return {
    sections,
    contexts,
    tools,
    injections,
    call: async (name, args) => tools.get(name).execute(args, {
      agent: { id: 'sess-1', session: { id: 'sess-1', header: { cwd: workspace } } },
      callId: 'call-1',
      name,
      arguments: args,
      signal: new AbortController().signal,
    }),
    rpc: async (method, payload = {}) => rpcHandler(method, payload),
  };
}

const exists = async (file) => {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
};

const specDir = path.join(workspace, '.kiro', 'specs', 'login-revamp');

test('all eight tools register and the RPC channel mounts', () => {
  const ctx = makeCtx();
  assert.deepEqual([...ctx.tools.keys()].sort(), Object.values(TOOL_NAMES).sort());
  assert.equal(ctx.tools.size, 8);
  // The prompt service is resolved by lookup, so the section and the runtime
  // context appear without a hard `inject` edge.
  assert.deepEqual(ctx.sections.map((section) => section.name), ['spec-policy']);
  assert.deepEqual(ctx.contexts.map((context) => context.name), ['spec-active']);
  assert.deepEqual(ctx.sections[0].order, 185);
  assert.deepEqual(ctx.contexts[0].order, 650);
});

test('every tool result is lossless JSON, because the host rejects anything else', async () => {
  // The host snapshots each successful tool value and throws a ToolOutputError
  // when it holds an `undefined` property ("value is not lossless JSON"). A
  // passing spec_pbt call used to echo `failingExample: undefined` and fail at
  // the wrapper after its write had already landed; this sweeps all eight.
  const ctx = makeCtx();
  await ctx.call(TOOL_NAMES.create, { title: 'Json Sweep' });
  const dir = path.join(workspace, '.kiro', 'specs', 'json-sweep');
  await writeFile(path.join(dir, 'tasks.md'), `# Implementation Plan: json-sweep

## Tasks

- [ ] 1. Work
  - [ ] 1.1 Child
    - _Requirements: 1.1_
    - **Property 1: Round Trip**

## Task Dependency Graph

\`\`\`json
{ "waves": [{ "id": 0, "tasks": ["1.1"] }] }
\`\`\`
`);
  const tasksText = await readFile(path.join(dir, 'tasks.md'), 'utf8');
  const args = {
    [TOOL_NAMES.list]: {},
    [TOOL_NAMES.read]: { feature: 'json-sweep' },
    [TOOL_NAMES.check]: { feature: 'json-sweep' },
    [TOOL_NAMES.next]: { feature: 'json-sweep' },
    [TOOL_NAMES.write]: { feature: 'json-sweep', document: 'tasks', content: tasksText },
    [TOOL_NAMES.taskUpdate]: { feature: 'json-sweep', taskId: '1.1', status: 'completed' },
    [TOOL_NAMES.pbt]: { feature: 'json-sweep', taskId: '1.1', status: 'passed' },
  };
  for (const [name, callable] of Object.entries(args)) {
    const value = await ctx.call(name, callable);
    const undefinedKeys = Object.keys(value ?? {}).filter((key) => value[key] === undefined);
    assert.deepEqual(undefinedKeys, [], `${name} returned undefined properties`);
    assert.deepEqual(JSON.parse(JSON.stringify(value)), value, `${name} did not survive a JSON round trip`);
  }
});

test('spec_create writes Kiro layout and a valid requirements skeleton', async () => {
  const ctx = makeCtx();
  const result = await ctx.call(TOOL_NAMES.create, { title: 'Login Revamp' });
  assert.equal(result.feature, 'login-revamp');
  assert.deepEqual(result.files, ['requirements.md']);
  assert.equal(await exists(path.join(specDir, '.config.kiro')), true);
  assert.equal(await exists(path.join(specDir, 'requirements.md')), true);
  assert.equal(await exists(path.join(specDir, 'design.md')), false);

  const config = JSON.parse(await readFile(path.join(specDir, '.config.kiro'), 'utf8'));
  assert.equal(config.workflowType, 'requirements-first');
  assert.equal(config.specType, 'feature');
  assert.match(config.specId, /^[0-9a-f-]{36}$/u);

  const requirements = await readFile(path.join(specDir, 'requirements.md'), 'utf8');
  assert.match(requirements, /^# Requirements Document/u);
  assert.match(requirements, /^### Requirement 1:/mu);
});

test('creating the same title twice derives a new feature; an explicit duplicate is rejected', async () => {
  const ctx = makeCtx();
  const again = await ctx.call(TOOL_NAMES.create, { title: 'Login Revamp' });
  assert.equal(again.feature, 'login-revamp-2');
  await assert.rejects(
    () => ctx.call(TOOL_NAMES.create, { title: 'Login Revamp', feature: 'login-revamp' }),
    /already exists/u,
  );
});

test('spec_write validates with Kiro rules and reports findings', async () => {
  const ctx = makeCtx();
  const design = `# Design Document: Login Revamp

## Overview

x

## Architecture

x

## Components and Interfaces

x

## Data Models

x

## Correctness Properties

### Property 1: Round trip

_For any_ session, serialize then deserialize returns the same session.

**Validates: Requirements 1.1**

## Error Handling

x

## Testing Strategy

x
`;
  const result = await ctx.call(TOOL_NAMES.write, { feature: 'login-revamp', document: 'design', content: design });
  assert.equal(result.document, 'design.md');
  assert.equal(result.issues.filter((issue) => issue.file === 'design.md').length, 0, JSON.stringify(result.issues));
  assert.equal(result.issues.some((issue) => issue.rule === 'spec/missing-document' && issue.file === 'tasks.md'), true);
  assert.equal(await exists(path.join(specDir, 'design.md')), true);

  const broken = await ctx.call(TOOL_NAMES.write, { feature: 'login-revamp', document: 'design', content: '# Design\n' });
  assert.equal(broken.ok, false);
  assert.ok(broken.issues.some((issue) => issue.rule === 'design/missing-overview'));
});

test('tasks.md is parsed into the Kiro tree and drives ready work', async () => {
  const ctx = makeCtx();
  const tasks = `# Implementation Plan: Login Revamp

## Overview

Do it.

## Tasks

- [ ] 1. Add endpoint
  - _Requirements: 1.1_

- [ ] 2. Add tests
  - [ ] 2.1 Unit test
    - _Requirements: 1.1_

  - [ ]* 2.2 Property test
    - **Property 1: Round trip**
    - **Validates: Requirements 1.1**

- [ ] 3. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- notes

## Task Dependency Graph

\`\`\`json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["3"] }
  ]
}
\`\`\`
`;
  const written = await ctx.call(TOOL_NAMES.write, { feature: 'login-revamp', document: 'tasks', content: tasks });
  assert.equal(written.issues.filter((issue) => issue.file === 'tasks.md' && issue.severity === 'error').length, 0, JSON.stringify(written.issues));

  const state = await ctx.call(TOOL_NAMES.read, { feature: 'login-revamp' });
  assert.equal(state.progress.required, 3);
  assert.deepEqual(state.ready.map((task) => task.id), ['1']);
  assert.equal(state.tasks.find((task) => task.id === '2.2').optional, true);
  assert.deepEqual(state.tasks.find((task) => task.id === '2.1').requirements, ['1.1']);

  const next = await ctx.call(TOOL_NAMES.next, { feature: 'login-revamp' });
  assert.deepEqual(next.ready.map((task) => task.id), ['1']);
});

test('task updates write checkboxes, propagate parents, and append metadata', async () => {
  const ctx = makeCtx();
  const first = await ctx.call(TOOL_NAMES.taskUpdate, { feature: 'login-revamp', taskId: '1', status: 'completed' });
  assert.equal(first.status, 'completed');
  assert.deepEqual(first.ready.map((task) => task.id), ['2.1']);

  const second = await ctx.call(TOOL_NAMES.taskUpdate, { feature: 'login-revamp', taskId: '2.1', status: 'completed' });
  assert.equal(second.status, 'completed');

  const text = await readFile(path.join(specDir, 'tasks.md'), 'utf8');
  assert.match(text, /^- \[x\] 1\. Add endpoint$/mu);
  assert.match(text, /^  - \[x\] 2\.1 Unit test$/mu);
  assert.match(text, /^  - \[ \]\* 2\.2 Property test$/mu);

  const meta = JSON.parse(await readFile(path.join(specDir, 'tasks.meta.json'), 'utf8'));
  assert.ok(Array.isArray(meta.executionHistory['1']));
  assert.equal(meta.executionHistory['1'].length, 1);
  assert.equal(meta.executionHistory['1'][0].executionId, 'call-1');
  assert.equal(meta.executionHistory['1'][0].chatSessionId, 'sess-1');
});

test('completing the checkpoint completes the spec phase', async () => {
  const ctx = makeCtx();
  await ctx.call(TOOL_NAMES.taskUpdate, { feature: 'login-revamp', taskId: '2.2', status: 'completed' });
  await ctx.call(TOOL_NAMES.taskUpdate, { feature: 'login-revamp', taskId: '3', status: 'completed' });
  const state = await ctx.call(TOOL_NAMES.read, { feature: 'login-revamp' });
  assert.equal(state.phase, 'done');
  assert.equal(state.progress.completed, 3);
});

test('the read view reports a subtree-completed parent as completed and derived', async () => {
  // The client can only show the right state if the RPC view carries the flag:
  // a parent whose required children are done reads `completed` even though its
  // own box in tasks.md is still `[ ]`.
  const ctx = makeCtx();
  await writeFile(path.join(specDir, 'tasks.md'), `# Implementation Plan: X

## Overview

x

## Tasks

- [ ] 1. Parent
  - [x] 1.1 Child
    - _Requirements: 1.1_

- [ ] 2. Untouched
  - [ ] 2.1 Child
    - _Requirements: 1.1_

## Notes

x

## Task Dependency Graph

\`\`\`json
{ "waves": [{ "id": 0, "tasks": ["1.1", "2.1"] }] }
\`\`\`
`, 'utf8');
  const state = await ctx.call(TOOL_NAMES.read, { feature: 'login-revamp' });
  const parent = state.tasks.find((task) => task.id === '1');
  assert.equal(parent.status, 'completed');
  assert.equal(parent.derived, true);
  const open = state.tasks.find((task) => task.id === '2');
  assert.equal(open.status, 'not_started');
  assert.equal(open.derived, false);
  assert.equal(state.progress.completed, 1);
});

test('a parent with open required children is rejected', async () => {
  const ctx = makeCtx();
  await writeFile(path.join(specDir, 'tasks.md'), `# Implementation Plan: X

## Overview

x

## Tasks

- [ ] 1. Parent
  - [ ] 1.1 Child
    - _Requirements: 1.1_

## Notes

x

## Task Dependency Graph

\`\`\`json
{ "waves": [{ "id": 0, "tasks": ["1.1"] }] }
\`\`\`
`, 'utf8');
  await assert.rejects(
    () => ctx.call(TOOL_NAMES.taskUpdate, { feature: 'login-revamp', taskId: '1', status: 'completed' }),
    /Cannot complete parent task/u,
  );
});

test('spec_pbt records results in tasks.meta.json', async () => {
  const ctx = makeCtx();
  const result = await ctx.call(TOOL_NAMES.pbt, {
    feature: 'login-revamp', taskId: '2.2', status: 'failed', failingExample: 'session.id lost',
  });
  assert.equal(result.status, 'failed');
  const meta = JSON.parse(await readFile(path.join(specDir, 'tasks.meta.json'), 'utf8'));
  assert.equal(meta.pbtResults['2.2'].status, 'failed');
  assert.equal(meta.pbtResults['2.2'].failingExample, 'session.id lost');
  assert.ok(meta.pbtResults['2.2'].lastRunTimestamp > 0);
});

test('a passing spec_pbt result is lossless JSON, so the tool call succeeds', async () => {
  const ctx = makeCtx();
  // A passing run has no counterexample. The host snapshots every tool result
  // and rejects an `undefined` property as "not lossless JSON", which made
  // every passing call fail at the wrapper even though the write had landed.
  const result = await ctx.call(TOOL_NAMES.pbt, { feature: 'login-revamp', taskId: '2.2', status: 'passed' });
  assert.equal(result.status, 'passed');
  assert.equal('failingExample' in result, false, 'no counterexample key at all, not an undefined one');
  assert.ok(result.lastRunTimestamp > 0);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result, 'the value survives a JSON round trip');

  const meta = JSON.parse(await readFile(path.join(specDir, 'tasks.meta.json'), 'utf8'));
  assert.deepEqual(meta.pbtResults['2.2'], { status: 'passed', lastRunTimestamp: result.lastRunTimestamp });
});

test('a property test named in the task title satisfies the missing-PBT finding', async () => {
  const ctx = makeCtx();
  await ctx.call(TOOL_NAMES.create, { title: 'Pbt Naming' });
  const directory = path.join(workspace, '.kiro', 'specs', 'pbt-naming');
  // The design has a property; tasks.md names the test in the title only, which
  // is how an agent usually writes it. That must count as coverage — otherwise
  // `spec/missing-pbt-task` keeps firing after the test exists and the agent
  // spends the rest of the run hunting for work it already did.
  await writeFile(path.join(directory, 'design.md'), `# Design Document

## Overview

x

### Property 1: Round Trip

**Validates: Requirements 1.1**
`);
  await writeFile(path.join(directory, 'tasks.md'), `# Implementation Plan: pbt-naming

## Tasks

- [x] 1. Implement
  - [x] 1.1 Property-based tests for the counter
    - _Requirements: 1.1_
`);
  const check = await ctx.call(TOOL_NAMES.check, { feature: 'pbt-naming' });
  assert.deepEqual(check.specs[0].issues.filter((issue) => issue.rule === 'spec/missing-pbt-task'), []);
});

test('spec_check aggregates Kiro and cross-document findings', async () => {
  const ctx = makeCtx();
  await writeFile(path.join(specDir, 'tasks.md'), `# Implementation Plan: X

## Overview

x

## Tasks

- [ ] 1. Do
  - _Requirements: 9.9_

## Notes

x
`, 'utf8');
  const result = await ctx.call(TOOL_NAMES.check, { feature: 'login-revamp' });
  const spec = result.specs[0];
  assert.equal(result.ok, false);
  assert.ok(spec.issues.some((issue) => issue.rule === 'tasks/missing-dependency-graph'));
  assert.ok(spec.issues.some((issue) => issue.rule === 'spec/unknown-requirement'));
});

test('the list view reports every spec with progress and health', async () => {
  const ctx = makeCtx();
  const result = await ctx.call(TOOL_NAMES.list, {});
  assert.ok(result.specs.length >= 1);
  const spec = result.specs.find((entry) => entry.feature === 'login-revamp');
  assert.ok(spec, 'login-revamp is listed');
  assert.equal(spec.specType, 'feature');
  assert.equal(spec.workflowType, 'requirements-first');
  assert.equal(typeof spec.ok, 'boolean');
  assert.ok(spec.progress === null || typeof spec.progress.percent === 'number');
});

test('bugfix specs scaffold bugfix.md and a graph-free task list', async () => {
  const ctx = makeCtx();
  const result = await ctx.call(TOOL_NAMES.create, {
    title: 'Fix crash on logout',
    specType: 'bugfix',
    documents: ['requirements', 'design', 'tasks'],
  });
  const dir = path.join(workspace, '.kiro', 'specs', result.feature);
  assert.equal(await exists(path.join(dir, 'bugfix.md')), true);
  assert.equal(await exists(path.join(dir, 'requirements.md')), false);
  const tasks = await readFile(path.join(dir, 'tasks.md'), 'utf8');
  assert.doesNotMatch(tasks, /^## Task Dependency Graph$/mu);
  const config = JSON.parse(await readFile(path.join(dir, '.config.kiro'), 'utf8'));
  assert.equal(config.specType, 'bugfix');
  const checked = await ctx.call(TOOL_NAMES.check, { feature: result.feature });
  assert.equal(checked.specs[0].counts.error, 0, JSON.stringify(checked.specs[0].issues));
});

test('non-latin titles get a derived feature name and disambiguate', async () => {
  const ctx = makeCtx();
  const first = await ctx.call(TOOL_NAMES.create, { title: '登录改造' });
  assert.equal(first.feature, 'spec');
  assert.equal(first.files[0], 'requirements.md');
  const second = await ctx.call(TOOL_NAMES.create, { title: '登录改造' });
  assert.equal(second.feature, 'spec-2');

  const explicit = await ctx.call(TOOL_NAMES.create, { title: 'Another', feature: 'explicit-name' });
  assert.equal(explicit.feature, 'explicit-name');
  await assert.rejects(() => ctx.call(TOOL_NAMES.create, { title: 'Duplicate', feature: 'explicit-name' }), /already exists/u);
});

test('writing "requirements" on a bugfix spec targets bugfix.md', async () => {
  const ctx = makeCtx();
  const created = await ctx.call(TOOL_NAMES.create, { title: 'Fix logout crash', specType: 'bugfix' });
  const written = await ctx.call(TOOL_NAMES.write, {
    feature: created.feature,
    document: 'requirements',
    content: '# Bugfix Requirements Document\n\n## Introduction\n\nThe logout path crashes.\n',
  });
  assert.equal(written.document, 'bugfix.md');
  assert.match(written.path, /bugfix\.md$/u);
  // Reading by the logical name resolves the same file.
  const read = await ctx.call(TOOL_NAMES.read, { feature: created.feature, document: 'requirements' });
  assert.equal(read.document, 'bugfix.md');
  assert.match(read.content, /^# Bugfix Requirements Document/u);
  const dir = path.join(workspace, '.kiro', 'specs', created.feature);
  assert.equal(await exists(path.join(dir, 'bugfix.md')), true);
  assert.equal(await exists(path.join(dir, 'requirements.md')), false);
});

test('RPC describe/get/document/write/taskUpdate/saveSettings work', async () => {
  const ctx = makeCtx();
  const described = await ctx.rpc('describe', {});
  assert.equal(described.ok, true);
  assert.ok(described.value.specs.some((spec) => spec.feature === 'login-revamp'));
  assert.equal(described.value.settings.values.kiroDir, '.kiro');

  const got = await ctx.rpc('get', { feature: 'login-revamp' });
  assert.equal(got.ok, true);
  assert.equal(got.value.feature, 'login-revamp');

  const doc = await ctx.rpc('document', { feature: 'login-revamp', document: 'requirements' });
  assert.equal(doc.ok, true);
  assert.match(doc.value.content, /^# Requirements Document/u);

  const written = await ctx.rpc('write', {
    feature: 'login-revamp',
    document: 'design',
    content: '# Design Document: X\n\n## Overview\n\nx\n',
  });
  assert.equal(written.ok, true);
  assert.equal(written.value.ok, false);

  const task = await ctx.rpc('taskUpdate', { feature: 'login-revamp', taskId: '1', status: 'in_progress' });
  assert.equal(task.ok, true);

  const saved = await ctx.rpc('saveSettings', { values: { promptMaxSpecs: 9 } });
  assert.equal(saved.ok, true);
  assert.equal(saved.value.settings.values.promptMaxSpecs, 9);
  const stored = JSON.parse(await readFile(path.join(home, 'spec', 'settings.json'), 'utf8'));
  assert.equal(stored.promptMaxSpecs, 9);

  const reset = await ctx.rpc('resetSettings', {});
  assert.equal(reset.ok, true);
  assert.equal(reset.value.settings.values.promptMaxSpecs, DEFAULT_SETTINGS.promptMaxSpecs);

  const unknown = await ctx.rpc('nope', {});
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'unknown-method');
});

test('RPC surfaces model errors with stable codes', async () => {
  const ctx = makeCtx();
  const missing = await ctx.rpc('get', { feature: 'nope' });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'spec-not-found');
  const badCreate = await ctx.rpc('create', { title: 'login-revamp', feature: 'login-revamp' });
  assert.equal(badCreate.ok, false);
  assert.equal(badCreate.error.code, 'spec-exists');
});

test('the policy text names the Kiro contract and the checkbox statuses', () => {
  assert.match(SPEC_POLICY_TEXT, /requirements\.md/u);
  assert.match(SPEC_POLICY_TEXT, /Task Dependency Graph/u);
  assert.match(SPEC_POLICY_TEXT, /\[x\]/u);
  assert.match(SPEC_POLICY_TEXT, /spec_task_update/u);
});

test('task parsing of the generated spec is stable', async () => {
  const ctx = makeCtx();
  await ctx.call(TOOL_NAMES.write, {
    feature: 'login-revamp',
    document: 'tasks',
    content: `# Implementation Plan: X

## Overview

x

## Tasks

- [ ] 1. Do
  - _Requirements: 1.1_

## Notes

x

## Task Dependency Graph

\`\`\`json
{ "waves": [{ "id": 0, "tasks": ["1"] }] }
\`\`\`
`,
  });
  const text = await readFile(path.join(specDir, 'tasks.md'), 'utf8');
  const parsed = parseTasks(text);
  assert.equal(parsed.tasks.length, 1);
  assert.equal(parsed.tasks[0].id, '1');
});

test.after(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousHome;
});
