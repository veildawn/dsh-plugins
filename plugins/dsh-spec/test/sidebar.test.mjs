/**
 * Sidebar presentation rules.
 *
 * The sidebar's tree is derived from disk facts, so its rules are pure and
 * testable without a browser. These assertions pin the Kiro parity points:
 * document order per workflow, the `(auto-generated)` marking of fast-task
 * documents, and the phase label the feature row shows.
 *
 * The client bundle is a self-registering IIFE, so the module is loaded with a
 * stub `window.__ModuleLoader__` and a minimal React stand-in; `internals`
 * carries the pure functions the render tree uses.
 *
 * Run: node --test test/sidebar.test.mjs
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/** Minimal React surface the bundle touches at load time. */
const fakeReact = {
  createElement: () => ({}),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
  useMemo: (factory) => factory(),
  useCallback: (factory) => factory,
};

async function loadInternals() {
  const source = await readFile(join(root, 'lib', 'client.js'), 'utf8');
  let captured = null;
  const previous = globalThis.window;
  globalThis.window = { __ModuleLoader__: { load: (module) => { captured = module; } } };
  try {
    new Function(source)();
  } finally {
    globalThis.window = previous;
  }
  assert.ok(captured, 'the bundle must self-register');
  const required = [];
  const module = captured.factory((name) => {
    required.push(name);
    if (name === 'react') return fakeReact;
    throw new Error(`unexpected require: ${name}`);
  });
  return { internals: module.internals, exports: module.exports, required };
}

const { internals } = await loadInternals();
const { documentOrder, phaseOf, phaseView } = internals;

test('the bundle names the conversation-view seats', () => {
  // 规格 is a view of the conversation strip, not a right-sidebar tab: the host
  // registers 对话 (order 0) and 轨迹 (order 10), so 20 lands right of 轨迹.
  assert.equal(internals.VIEW_SLOT, 'conversation.view');
  assert.equal(internals.SPEC_VIEW_ID, 'spec');
  assert.equal(internals.SPEC_VIEW_LABEL, '规格');
  assert.equal(internals.SPEC_VIEW_ORDER, 20);
  assert.ok(internals.SPEC_VIEW_ORDER > 10, 'the view sits right of 轨迹');
  assert.equal(internals.COMPOSER_SLOT, 'conversation.input.left');
  // The right-sidebar seats and the old full-screen drawer are gone.
  assert.equal(internals.PANE_TAB_SLOT, undefined);
  assert.equal(internals.PANE_TAB_TITLE_SLOT, undefined);
  assert.equal(internals.SPEC_TAB_KIND, undefined);
  assert.equal(internals.OVERLAY_SLOT, undefined);
  assert.equal(internals.SETTINGS_SLOT, undefined);
});

test('the client still requires only react', async () => {
  // The factory body calls require() as it evaluates, so the recorded list is
  // the module's whole dependency set.
  const { required } = await loadInternals();
  assert.deepEqual(required, ['react']);
});

test('requirements-first lists documents in Kiro order', () => {
  const nodes = documentOrder(
    { workflowType: 'requirements-first', specType: 'feature' },
    ['requirements', 'design', 'tasks'],
  );
  assert.deepEqual(nodes.map((node) => node.kind), ['requirements', 'design', 'tasks']);
  assert.deepEqual(nodes.map((node) => node.label), ['Requirements', 'Design', 'Tasks']);
  assert.deepEqual(nodes.map((node) => node.secondary), [false, false, false]);
});

test('only documents that exist are listed', () => {
  const fresh = documentOrder({ workflowType: 'requirements-first', specType: 'feature' }, ['requirements']);
  assert.deepEqual(fresh.map((node) => node.kind), ['requirements']);
  const empty = documentOrder({ workflowType: 'requirements-first', specType: 'feature' }, []);
  assert.deepEqual(empty, []);
});

test('fast-task lists tasks first and marks the derived documents', () => {
  const nodes = documentOrder(
    { workflowType: 'fast-task', specType: 'feature' },
    ['requirements', 'design', 'tasks'],
  );
  assert.deepEqual(nodes.map((node) => node.kind), ['tasks', 'requirements', 'design']);
  assert.deepEqual(nodes.map((node) => node.secondary), [false, true, true]);
});

test('bugfix specs list the bugfix document', () => {
  const nodes = documentOrder(
    { workflowType: 'requirements-first', specType: 'bugfix' },
    ['bugfix', 'design', 'tasks'],
  );
  assert.deepEqual(nodes.map((node) => node.kind), ['bugfix', 'design', 'tasks']);
  assert.equal(nodes[0].label, 'Bugfix');
});

test('the phase follows the documents on disk', () => {
  const feature = { workflowType: 'requirements-first', specType: 'feature' };
  assert.equal(phaseOf(feature, []), 'requirements');
  assert.equal(phaseOf(feature, ['requirements']), 'design');
  assert.equal(phaseOf(feature, ['requirements', 'design']), 'tasks');
  assert.equal(phaseOf(feature, ['requirements', 'design', 'tasks']), 'execution');
  // A bugfix spec's first document is bugfix.md.
  assert.equal(phaseOf({ specType: 'bugfix' }, ['bugfix']), 'design');
});

test('the current phase is marked on the matching document', () => {
  // With all three documents written the spec is executing, so tasks.md is the
  // current node and the two upstream documents are done.
  const executing = documentOrder(
    { workflowType: 'requirements-first', specType: 'feature' },
    ['requirements', 'design', 'tasks'],
  );
  assert.deepEqual(executing.map((node) => node.state), ['done', 'done', 'current']);

  // While design.md is still being written, requirements is the done node.
  const designing = documentOrder(
    { workflowType: 'requirements-first', specType: 'feature' },
    ['requirements'],
  );
  assert.deepEqual(designing.map((node) => node.state), ['done']);
});

test('phase labels cover every phase value', () => {
  for (const phase of ['requirements', 'design', 'tasks', 'execution', 'done']) {
    const view = phaseView(phase);
    assert.equal(typeof view.label, 'string');
    assert.ok(view.label.length > 0, `${phase} needs a label`);
  }
  assert.equal(phaseView('done').tone, 'ok');
  assert.equal(phaseView('execution').tone, 'brand');
  assert.equal(phaseView('requirements').tone, 'muted');
});

test('only documents present on disk become nodes', () => {
  // The list RPC reports presence; the panel must not infer it from the phase.
  const nodes = documentOrder(
    { workflowType: 'requirements-first', specType: 'feature' },
    { requirements: true, bugfix: false, design: false, tasks: false },
    'design',
  );
  assert.deepEqual(nodes.map((node) => node.kind), ['requirements']);
});

test('node state comes from the server phase, including done', () => {
  const present = { requirements: true, bugfix: false, design: true, tasks: true };
  const executing = documentOrder({ workflowType: 'requirements-first', specType: 'feature' }, present, 'execution');
  assert.deepEqual(executing.map((node) => node.state), ['done', 'done', 'current']);
  const done = documentOrder({ workflowType: 'requirements-first', specType: 'feature' }, present, 'done');
  assert.deepEqual(done.map((node) => node.state), ['done', 'done', 'done']);
});
