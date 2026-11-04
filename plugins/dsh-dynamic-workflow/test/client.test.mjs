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
  assert.deepEqual(mod.inject, ['slots', 'connection', 'locale']);
  assert.ok(styles.some((s) => s.id === 'dsh-dynamic-workflow-styles'));
});

test('apply registers a conversation.view tab with a localized label', () => {
  const registered = [];
  mod.apply({
    slots: { inject: (_slot, fn) => fn(), register: (entry, component) => registered.push({ entry, component }) },
    connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
    get: () => undefined,
  });
  assert.equal(registered.length, 1);
  assert.equal(registered[0].entry.name, 'conversation.view');
  assert.equal(registered[0].entry.id, 'dynamic-workflow');
  assert.equal(registered[0].entry.label(), '编排');
  assert.equal(typeof registered[0].entry.inject('s1').rpcCall, 'function');
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
      { seq: 3, label: 'verifier', status: 'running', startedAt: Date.now() },
    ],
  };
  const tree = mod.internals.Graph({ run, lang: 'zh' });
  const flat = texts(tree);
  assert.ok(flat.includes('Find') && flat.includes('Verify') && flat.includes('→'));
  assert.ok(flat.includes('#3 verifier'));
  assert.ok(flat.includes('check'));
  assert.equal(tree.children.length, 3);
});

test('strings exist in both languages', () => {
  for (const [key, pair] of Object.entries(mod.internals.STRINGS)) {
    assert.equal(pair.length, 2, key);
  }
  assert.equal(mod.internals.t('en', 'agents', { n: 3 }), '3 agents');
  assert.equal(mod.internals.formatDuration(0, 0), '');
  assert.equal(mod.internals.formatDuration(1000, 66000), '1m05s');
});
