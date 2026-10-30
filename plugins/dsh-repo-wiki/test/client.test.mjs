/**
 * Client bundle tests.
 *
 * The browser half cannot be imported as an ES module — it is an IIFE that
 * registers itself with `window.__ModuleLoader__`. So these tests load it the
 * same way the host does, with a stub loader, and then drive the exported
 * `internals` (the pure helpers) and the `apply` function against a fake Cordis
 * context.
 *
 * Run: node --test test/client.test.mjs
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

/** Minimal React stand-in: enough for the pure render helpers. */
function makeReact() {
  const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children });
  return {
    createElement,
    Fragment: Symbol('Fragment'),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (initial) => ({ current: initial }),
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    memo: (component) => component,
  };
}

/** Load the bundle and return its module object. */
async function loadBundle() {
  const source = await readFile(path.join(root, 'lib', 'client.js'), 'utf8');
  let registration = null;
  const window = { __ModuleLoader__: { load: (value) => { registration = value; } } };
  // eslint-disable-next-line no-new-func
  new Function('window', source)(window);
  assert.ok(registration !== null, 'the bundle must call __ModuleLoader__.load');
  const react = makeReact();
  const module = registration.factory((name) => {
    if (name === 'react') return react;
    throw new Error(`unexpected client dependency ${name}`);
  });
  return { module, registration, react };
}

/* ------------------------------------------------------------------------- *
 * Module shape
 * ------------------------------------------------------------------------- */

test('the bundle registers under the package name', async () => {
  const { registration } = await loadBundle();
  assert.equal(registration.id, '@weniatall/dsh-repo-wiki');
});

test('the bundle injects the services it actually uses', async () => {
  const { module } = await loadBundle();
  assert.deepEqual(module.inject.sort(), ['connection', 'layout', 'slots']);
  assert.equal(typeof module.apply, 'function');
});

test('internals expose the pure helpers', async () => {
  const { module } = await loadBundle();
  for (const key of ['flattenTree', 'filterTree', 'statusLabel', 'statusTone', 'showsProgress', 'hasContent', 'tabTitle', 'splitPage', 'renderMarkdown']) {
    assert.equal(typeof module.internals[key], 'function', `${key} must be exported`);
  }
});

/* ------------------------------------------------------------------------- *
 * apply(): slot and tab-type registration
 * ------------------------------------------------------------------------- */

function makeCtx(overrides = {}) {
  const slots = [];
  const tabTypes = [];
  const effects = [];
  let selected = null;
  const ctx = {
    connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
    slots: {
      inject: (_name, factory) => factory(),
      // The host's signature is `register(definition, component)`; keep both so
      // the render smoke tests can invoke the component the plugin registered.
      register: (definition, component) => {
        slots.push({ ...definition, component });
        return () => {};
      },
    },
    effect: (fn, label) => {
      effects.push(label);
      fn();
      return () => {};
    },
    get: (key) => {
      // Kept so the "no tab type" test can prove nothing registers here.
      if (key === 'sidebarRightTabs') {
        return {
          register: (definition) => {
            tabTypes.push(definition);
            return () => {};
          },
        };
      }
      if (key === 'layout') return { selectPanel: (id) => { selected = id; } };
      return undefined;
    },
    ...overrides,
  };
  return { ctx, slots, tabTypes, effects, selectedPanel: () => selected };
}

test('apply registers the left panel row and its keyed main seat', async () => {
  const { module } = await loadBundle();
  const harness = makeCtx();
  module.apply(harness.ctx);

  const names = harness.slots.map((slot) => slot.name);
  assert.deepEqual(names.sort(), [
    'conversation.input.left',
    'main',
    'settings.section',
    'sidebar.panellist',
  ]);

  const row = harness.slots.find((slot) => slot.name === 'sidebar.panellist');
  const main = harness.slots.find((slot) => slot.name === 'main');
  assert.equal(row.id, 'repo-wiki');
  assert.equal(main.key, row.id, 'the main seat must be keyed by the nav row id');
  assert.ok(typeof row.label === 'function', 'the nav row supplies its own label');
  assert.equal(typeof row.label(), 'string');
});

test('the panel registers no right-sidebar tab type', async () => {
  // The wiki moved to the left panel; leaving a tab type behind would give the
  // plugin two entry points with independent state.
  const { module } = await loadBundle();
  const harness = makeCtx();
  module.apply(harness.ctx);
  assert.equal(harness.tabTypes.length, 0, 'no sidebarRightTabs registration');
  assert.equal(
    harness.slots.some((slot) => slot.name.startsWith('sidebar.right')),
    false,
    'no right-sidebar slots',
  );
});

test('the composer button opens the panel through layout.selectPanel', async () => {
  const { module } = await loadBundle();
  const harness = makeCtx();
  module.apply(harness.ctx);
  const composer = harness.slots.find((slot) => slot.name === 'conversation.input.left');
  const props = composer.inject('session-1');
  props.openPanel();
  assert.equal(harness.selectedPanel(), 'repo-wiki');
});

test('the composer shortcut opens the current session without starting generation', async () => {
  const { module } = await loadBundle();
  const calls = [];
  const harness = makeCtx({ connection: { rpc: { call: async (...args) => { calls.push(args); return { ok: true, value: {} }; } } } });
  module.apply(harness.ctx);
  const composer = harness.slots.find((slot) => slot.name === 'conversation.input.left');
  const button = composer.component(composer.inject('session-1'));
  button.props.onClick();
  assert.equal(harness.selectedPanel(), 'repo-wiki');
  const panel = harness.slots.find((slot) => slot.name === 'main');
  const context = panel.inject();
  assert.equal(context.peekPanelSession(), 'session-1');
  assert.equal(context.peekPanelSession(), 'session-1', 'reading during a repeated render must not consume the context');
  context.clearPanelSession('session-1');
  assert.equal(context.peekPanelSession(), '');
  assert.deepEqual(calls, [], 'opening the panel must not make a generation request');
});

test('a failing selectPanel is swallowed rather than thrown from the click handler', async () => {
  const { module } = await loadBundle();
  const warnings = [];
  const previousWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    const harness = makeCtx({
      get: (key) => (key === 'layout'
        ? { selectPanel: () => { throw new Error('layout.selectPanel: main panel "repo-wiki" is not registered'); } }
        : undefined),
    });
    module.apply(harness.ctx);
    const composer = harness.slots.find((slot) => slot.name === 'conversation.input.left');
    const props = composer.inject('session-1');
    assert.doesNotThrow(() => props.openPanel());
    assert.ok(warnings.some((message) => message.includes('cannot open')));
  } finally {
    console.warn = previousWarn;
  }
});

test('apply survives a host without layout', async () => {
  const { module } = await loadBundle();
  const harness = makeCtx({ get: () => undefined });
  assert.doesNotThrow(() => module.apply(harness.ctx));
  assert.equal(harness.slots.length, 4, 'the slots still register');
});

/* ------------------------------------------------------------------------- *
 * Render smoke tests
 *
 * Regression guard for the 0.1.1 white screen: every component here is written
 * as `h(...)`, so a bundle that forgets `const h = react.createElement` throws
 * `ReferenceError: h is not defined` on first render. The host does not isolate
 * slot render errors, so that one bug blanked the whole settings dialog. These
 * tests invoke each registered component with the fake React and would have
 * caught it.
 * ------------------------------------------------------------------------- */

/** A `createElement` that keeps the element shape the host's renderer expects. */
const fakeElement = (type, props, ...children) => ({ type, props: props ?? {}, children });

test('every registered slot component renders without throwing', async () => {
  const { module } = await loadBundle();
  const harness = makeCtx();
  module.apply(harness.ctx);
  for (const slot of harness.slots) {
    const Component = slot.component;
    assert.equal(typeof Component, 'function', `${slot.name} must register a component`);
    const props = typeof slot.inject === 'function' ? slot.inject('session-1') : {};
    // `useState`/`useEffect`/`useCallback` are inert in the fake React, so a
    // single call exercises the component body without a reconciler.
    const tree = Component({ ...props, sessionId: 'session-1' });
    assert.ok(tree !== undefined, `${slot.name} rendered nothing`);
  }
});

test('the settings nav label renders an icon instead of throwing', async () => {
  // The exact entry that crashed in 0.1.1: the settings.section `label` icon.
  const { module } = await loadBundle();
  const harness = makeCtx();
  module.apply(harness.ctx);
  const settings = harness.slots.find((slot) => slot.name === 'settings.section');
  assert.equal(typeof settings.label, 'function');
  const label = settings.label();
  assert.equal(label.type, 'span');
  assert.ok(label.children.length > 0, 'the nav label carries the glyph and the text');
});

test('the sidebar glyph and composer button render standalone', async () => {
  const { module } = await loadBundle();
  const harness = makeCtx();
  module.apply(harness.ctx);
  const row = harness.slots.find((slot) => slot.name === 'sidebar.panellist');
  assert.equal(row.label(), 'Repo Wiki', 'the label is the row text, not the glyph');
  const glyph = row.component({});
  assert.equal(glyph.type, 'svg', 'the sidebar row component is the glyph');
  const composer = harness.slots.find((slot) => slot.name === 'conversation.input.left');
  const button = composer.component({ ...composer.inject('session-1'), sessionId: 'session-1' });
  assert.equal(button.type, 'button');
});

test('renderMarkdown output is h-built elements, not raw markup', async () => {
  const { module } = await loadBundle();
  const { renderMarkdown } = module.internals;
  const nodes = renderMarkdown('## 标题\n\n正文', fakeElement);
  assert.ok(nodes.length > 0);
  assert.equal(typeof nodes[0].type, 'string');
});

test('apply survives a host with no sidebar at all', async () => {
  const { module } = await loadBundle();
  const harness = makeCtx({ get: () => undefined });
  assert.doesNotThrow(() => module.apply(harness.ctx));
  assert.equal(harness.slots.length, 4);
});

/* ------------------------------------------------------------------------- *
 * Pure helpers
 * ------------------------------------------------------------------------- */

test('flattenTree expands children by default and honours collapse', async () => {
  const { module } = await loadBundle();
  const { flattenTree } = module.internals;
  const catalogs = [
    { catalog_id: 'a', title: '架构', parent_id: null, order: 0 },
    { catalog_id: 'b', title: '模块', parent_id: 'a', order: 0 },
    { catalog_id: 'c', title: '概述', parent_id: null, order: 1 },
  ];
  assert.deepEqual(flattenTree(catalogs, {}).map((row) => row.catalog.title), ['架构', '模块', '概述']);
  assert.deepEqual(flattenTree(catalogs, { a: false }).map((row) => row.catalog.title), ['架构', '概述']);
  const rows = flattenTree(catalogs, {});
  assert.deepEqual(rows.map((row) => row.depth), [0, 1, 0]);
});

test('completed pages remain visible when their parent has not completed', async () => {
  const { module } = await loadBundle();
  const catalogs = [
    { catalog_id: 'child', title: '已完成子页', parent_id: 'missing', order: 0 },
    { catalog_id: 'grandchild', title: '子页详情', parent_id: 'child', order: 0 },
  ];
  const rows = module.internals.flattenTree(catalogs, null);
  assert.deepEqual(rows.map((row) => [row.catalog.title, row.depth]), [['已完成子页', 0], ['子页详情', 1]]);
});

test('settings save sends only changed values so unrelated workspace defaults stay inherited', async () => {
  const { module } = await loadBundle();
  const baseline = { language: 'zh', concurrency: 2, citation: true };
  assert.deepEqual(module.internals.changedSettings({ ...baseline, language: 'en' }, baseline), { language: 'en' });
  assert.deepEqual(module.internals.changedSettings({ ...baseline }, baseline), {});
});

test('filterTree matches title or path, case-insensitively', async () => {
  const { module } = await loadBundle();
  const { filterTree } = module.internals;
  const catalogs = [
    { catalog_id: 'a', title: 'Architecture', path: '架构/Architecture.md' },
    { catalog_id: 'b', title: '模块', path: '架构/模块.md' },
  ];
  assert.equal(filterTree(catalogs, 'arch').length, 1);
  assert.equal(filterTree(catalogs, '模块').length, 1);
  assert.equal(filterTree(catalogs, '').length, 2);
  assert.equal(filterTree(catalogs, '   ').length, 2);
  assert.equal(filterTree(catalogs, 'nothing').length, 0);
});

test('filterTree retains ancestors so matching nested pages remain visible', async () => {
  const { module } = await loadBundle();
  const catalogs = [
    { catalog_id: 'a', title: '架构', path: 'architecture', parent_id: '' },
    { catalog_id: 'b', title: '支付', path: 'payments', parent_id: 'a' },
    { catalog_id: 'c', title: '其他', path: 'other', parent_id: '' },
  ];
  const filtered = module.internals.filterTree(catalogs, '支付');
  assert.deepEqual(module.internals.flattenTree(filtered, null).map((row) => row.catalog.title), ['架构', '支付']);
});

test('statusLabel and statusTone fall back gracefully', async () => {
  const { module } = await loadBundle();
  const { statusLabel, statusTone } = module.internals;
  assert.equal(statusLabel('COMPLETED'), '已完成');
  assert.equal(statusLabel('MADE_UP'), 'MADE_UP');
  assert.equal(statusTone('COMPLETED'), 'ok');
  assert.equal(statusTone('NETWORK_ERROR'), 'err');
  assert.equal(statusTone('MADE_UP'), 'muted');
});

test('showsProgress, hasContent and isRetryable agree with the host', async () => {
  const { module } = await loadBundle();
  const { showsProgress, hasContent, isRetryable } = module.internals;
  assert.equal(showsProgress('DOCUMENT_GENERATING'), true);
  assert.equal(showsProgress('COMPLETED'), false);
  assert.equal(hasContent('COMPLETED'), true);
  assert.equal(hasContent('WIKI_INIT'), false);
  assert.equal(isRetryable('NETWORK_ERROR'), true);
  assert.equal(isRetryable('COMPLETED'), false);
});

test('tabTitle reflects busy and drift states', async () => {
  const { module } = await loadBundle();
  const { tabTitle } = module.internals;
  assert.equal(tabTitle(null), 'Repo Wiki');
  assert.match(tabTitle({ busy: true }), /生成中/u);
  assert.match(tabTitle({ status: 'WIKI_HAS_COMMIT' }), /待更新/u);
});

test('splitPage separates the cite block, the TOC and the body', async () => {
  const { module } = await loadBundle();
  const { splitPage } = module.internals;
  const page = [
    '# 技术栈',
    '',
    '<cite>',
    '**本文档引用的文件**',
    '- [a.ts](file://src/a.ts)',
    '- [b.ts](file://src/b.ts)',
    '</cite>',
    '',
    '## 目录',
    '1. [简介](#简介)',
    '',
    '## 简介',
    '内容',
  ].join('\n');
  const result = splitPage(page);
  assert.equal(result.title, '技术栈');
  assert.deepEqual(result.references.map((ref) => ref.path), ['src/a.ts', 'src/b.ts']);
  assert.ok(result.body.startsWith('## 简介'));
  assert.equal(result.body.includes('<cite>'), false);
  assert.equal(result.body.includes('## 目录'), false);
});

test('splitPage tolerates a page without a prologue', async () => {
  const { module } = await loadBundle();
  const { splitPage } = module.internals;
  const result = splitPage('## 只有正文\nx');
  assert.equal(result.title, '');
  assert.deepEqual(result.references, []);
  assert.ok(result.body.includes('只有正文'));
});

test('renderMarkdown handles headings, lists, code and mermaid', async () => {
  const { module, react } = await loadBundle();
  const { renderMarkdown } = module.internals;
  const nodes = renderMarkdown(
    [
      '## 标题',
      '',
      '段落 **粗体** 和 `代码`。',
      '',
      '- 项目一',
      '- 项目二',
      '',
      '```ts',
      'const a = 1;',
      '```',
      '',
      '```mermaid',
      'graph TB',
      'A-->B',
      '```',
    ].join('\n'),
    react.createElement,
  );
  const types = nodes.map((node) => node.type);
  assert.ok(types.includes('h3'), 'a ## heading renders as h3 (h1 is the page title)');
  assert.ok(types.includes('ul'));
  assert.ok(types.includes('pre'));
  // The mermaid fence becomes a MermaidBlock component with the source as a
  // prop — it renders to an SVG once the lazily imported library resolves.
  const mermaid = nodes.find((node) => typeof node.type === 'function' && node.props && typeof node.props.source === 'string');
  assert.ok(mermaid, 'mermaid fences get their own component');
  assert.ok(mermaid.props.source.includes('graph TB'));
});

test('renderMarkdown handles tables with alignments and cells', async () => {
  const { module, react } = await loadBundle();
  const { renderMarkdown } = module.internals;
  const tableMd = [
    '| 插件名称 | 路径 | 状态 |',
    '| :--- | :---: | ---: |',
    '| repowiki | plugins/dsh-repo-wiki | 正常 |',
    '| fileviewer | plugins/dsh-file-viewer | 正常 |',
  ].join('\n');
  const nodes = renderMarkdown(tableMd, react.createElement);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].type, 'div');
  assert.equal(nodes[0].props.className, 'rw-table-wrap');
  const table = nodes[0].children[0];
  assert.equal(table.type, 'table');
});

test('internals expose knowledge categories matching Qoder schema', async () => {
  const { module } = await loadBundle();
  const { KNOWLEDGE_CATEGORIES, CATEGORY_NAMES } = module.internals;
  assert.ok(Array.isArray(KNOWLEDGE_CATEGORIES));
  assert.ok(KNOWLEDGE_CATEGORIES.some((c) => c.key === 'overview'));
  assert.ok(KNOWLEDGE_CATEGORIES.some((c) => c.key === 'architecture_design'));
  assert.equal(CATEGORY_NAMES.overview, '概览');
  assert.equal(CATEGORY_NAMES.architecture_design, '架构设计');
});

test('renderMarkdown never emits raw HTML', async () => {
  const { module, react } = await loadBundle();
  const { renderMarkdown } = module.internals;
  const nodes = renderMarkdown('<script>alert(1)</script>', react.createElement);
  const flat = JSON.stringify(nodes, (key, value) => (typeof value === 'symbol' ? String(value) : value));
  // The text survives as text; it is never parsed into a script element.
  assert.equal(flat.includes('"script"'), false);
  assert.ok(flat.includes('<script>'));
});

test('formatDate renders a local timestamp and rejects junk', async () => {
  const { module } = await loadBundle();
  const { formatDate } = module.internals;
  assert.match(formatDate('2026-06-02T19:02:22.000Z'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u);
  assert.equal(formatDate('not a date'), '');
  assert.equal(formatDate(''), '');
  assert.equal(formatDate(undefined), '');
});

test('the stylesheet is installed once', async () => {
  const { module } = await loadBundle();
  const appended = [];
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: () => null,
    createElement: () => ({ setAttribute: () => {}, textContent: '' }),
    head: { appendChild: (node) => appended.push(node) },
    body: { appendChild: (node) => appended.push(node) },
  };
  try {
    const harness = makeCtx();
    module.apply(harness.ctx);
    assert.equal(appended.length, 1, 'the style element is created on first apply');
    assert.ok(appended[0].textContent.includes('.rw-root'));
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

