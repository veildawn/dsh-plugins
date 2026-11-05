import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const react = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) };
  },
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect() {},
};

let registration = null;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language: 'zh-CN' } });
globalThis.window = { __ModuleLoader__: { load(entry) { registration = entry; } } };
const styles = [];
globalThis.document = {
  getElementById: (id) => styles.find((s) => s.id === id) || null,
  createElement: () => ({ id: '', textContent: '', setAttribute() {} }),
  head: { appendChild: (s) => styles.push(s) },
};

(0, eval)(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'client.js'), 'utf8'));
const mod = registration.factory((id) => {
  if (id === 'react') return react;
  throw new Error(`unexpected require ${id}`);
});

function texts(node, out = []) {
  if (typeof node === 'string' || typeof node === 'number') out.push(String(node));
  else if (node && typeof node === 'object') {
    if (typeof node.type === 'function') texts(node.type(node.props), out);
    else for (const child of node.children ?? []) texts(child, out);
  }
  return out;
}

test('bundle registers under the package id and injects styles', () => {
  assert.equal(registration.id, '@weniatall/dsh-dynamic-workflow');
  assert.deepEqual(mod.inject, ['slots', 'connection', 'locale', 'uiWorkspace']);
  assert.ok(styles.some((s) => s.id === 'dsh-dynamic-workflow-styles'));
});

test('apply registers a floating card in the composer dock', () => {
  const registered = [];
  mod.apply({
    slots: { inject: (_slot, fn) => fn(), register: (entry, component) => registered.push({ entry, component }) },
    connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
    get: () => undefined,
  });
  assert.equal(registered.length, 2);
  assert.equal(registered[0].entry.name, 'conversation.input.dock');
  // The host's message-flow card is shadowed by a one-line row on the same key.
  assert.equal(registered[1].entry.name, 'conversation.chat.node');
  assert.equal(registered[1].entry.key, 'workflow-run');
  assert.ok(registered[1].entry.priority < 0);
  assert.equal(registered[0].entry.id, 'dsh-dynamic-workflow');
  assert.ok(registered[0].entry.order < 0);
  assert.equal(typeof registered[0].entry.inject('s1').rpcCall, 'function');
});

test('dock renders nothing until a run exists, and hides dismissed finished runs', () => {
  assert.equal(mod.internals.WorkflowDock({ rpcCall: async () => ({}), sessionId: 's1' }), null);
  const { visibleRun } = mod.internals;
  const done = { id: 'a', status: 'completed' };
  assert.equal(visibleRun(null, new Set()), null);
  assert.equal(visibleRun(done, new Set()), done);
  assert.equal(visibleRun(done, new Set(['a'])), null);
  const running = { id: 'a', status: 'running' };
  assert.equal(visibleRun(running, new Set(['a'])), running);
});

test('chat row summarizes the host node and asks the dock to show itself', () => {
  const data = { name: 'release', status: 'running', phases: [
    { key: 'a', phase: '盘点', members: [{ seq: 1, status: 'completed' }, { seq: 2, status: 'completed' }] },
    { key: 'b', phase: '分析', members: [{ seq: 3, status: 'running' }] },
  ] };
  assert.deepEqual(mod.internals.chatSummary(data), { total: 3, done: 2, current: '分析', status: 'running' });
  const row = mod.internals.WorkflowChatRow({ node: { data }, sessionId: 's9' });
  const flat = texts(row);
  assert.ok(flat.includes('release'));
  assert.ok(flat.includes('2/3 个 agent · 分析'));
  let revealed = 0;
  mod.internals.revealers.set('s9', () => { revealed += 1; });
  row.props.onClick();
  assert.equal(revealed, 1);
});

test('graph renders lanes left to right with nodes and arrows', () => {
  const run = {
    graph: {
      lanes: [
        { id: 'p0', title: 'Find', state: 'done', detail: '', nodes: [1, 2] },
        { id: 'p1', title: 'Verify', state: 'running', detail: 'check', nodes: [3] },
      ],
      edges: [{ from: 'p0', to: 'p1' }],
    },
    nodes: [
      { seq: 1, label: 'finder a', status: 'completed', startedAt: 1, endedAt: 2001 },
      { seq: 2, label: 'finder b', status: 'failed', startedAt: 1, endedAt: 1001 },
      { seq: 3, label: 'verifier', status: 'running', startedAt: Date.now(), model: 'glm-5.3', modelDeclared: false },
    ],
  };
  const tree = mod.internals.Graph({ run, lang: 'zh' });
  const flat = texts(tree);
  assert.ok(flat.includes('Find') && flat.includes('Verify') && flat.includes('→'));
  assert.ok(flat.includes('#3 verifier'));
  assert.ok(flat.includes('glm-5.3'));
  assert.equal(tree.children[2].props.title, 'check');
  assert.equal(tree.children.length, 3);
});

test('strings exist in both languages', () => {
  for (const [key, pair] of Object.entries(mod.internals.STRINGS)) {
    assert.equal(pair.length, 2, key);
  }
  assert.equal(mod.internals.t('en', 'agents', { done: 1, n: 3 }), '1/3 agents');
  assert.equal(mod.internals.progressText({ counts: { completed: 1 }, agents: 2, currentPhase: 'Find', startedAt: 1000, endedAt: 3000 }, 'zh'), '1/2 个 agent · Find · 2s');
  assert.equal(mod.internals.formatDuration(0, 0), '');
  assert.equal(mod.internals.formatDuration(1000, 66000), '1m05s');
});
