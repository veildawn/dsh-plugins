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

function expand(node) {
  if (!node || typeof node !== 'object') return node;
  if (typeof node.type === 'function') return expand(node.type({ ...(node.props ?? {}), children: node.children }));
  return { ...node, children: (node.children ?? []).map(expand) };
}

function texts(node, out = []) {
  if (typeof node === 'string' || typeof node === 'number') out.push(String(node));
  else if (node && typeof node === 'object') {
    if (typeof node.type === 'function') texts(node.type(node.props), out);
    else for (const child of node.children ?? []) texts(child, out);
  }
  return out;
}

function findAll(node, pred, out = []) {
  const tree = expand(node);
  if (!tree || typeof tree !== 'object') return out;
  if (pred(tree)) out.push(tree);
  for (const child of tree.children ?? []) findAll(child, pred, out);
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

test('chat row summarizes the host node with mini station rail and GrokBot puppets', () => {
  const data = { name: 'release', status: 'running', phases: [
    { key: 'a', phase: '盘点', members: [{ seq: 1, status: 'completed' }, { seq: 2, status: 'completed' }] },
    { key: 'b', phase: '分析', members: [{ seq: 3, status: 'running' }] },
  ] };
  assert.deepEqual(mod.internals.chatSummary(data), { total: 3, done: 2, current: '分析', status: 'running' });
  const row = mod.internals.WorkflowChatRow({ node: { data }, sessionId: 's9' });
  const flat = texts(row);
  assert.ok(flat.includes('release'));
  assert.ok(flat.includes('2/3 个子代理 · 分析'));
  const avatars = findAll(row, (el) => el.props && el.props['data-subagent-avatar'] === 'true');
  assert.equal(avatars.length, 3);
  assert.equal(avatars[0].props['data-face-state'], 'content');
  assert.equal(avatars[2].props['data-face-state'], 'scanning');
  let revealed = 0;
  mod.internals.revealers.set('s9', () => { revealed += 1; });
  row.props.onClick();
  assert.equal(revealed, 1);
});

test('timeline renders station rail, settled fractions, capsule pills, and GrokBot faces', () => {
  const run = {
    graph: {
      lanes: [
        { id: 'p0', title: '实机连接与录制验证', state: 'done', detail: '', nodes: [1, 2] },
        { id: 'p1', title: '独立复核并修复问题', state: 'running', detail: 'check', nodes: [3] },
        { id: 'p2', title: '撰写交付说明', state: 'pending', detail: '', nodes: [4] },
      ],
      edges: [{ from: 'p0', to: 'p1' }, { from: 'p1', to: 'p2' }],
    },
    nodes: [
      { seq: 1, label: '实机验证员', status: 'completed', startedAt: 1, endedAt: 2001 },
      { seq: 2, label: '测试作者', status: 'failed', startedAt: 1, endedAt: 1001 },
      { seq: 3, label: '独立复核员', status: 'running', startedAt: Date.now(), model: 'deepseek-v4.1-flash', childId: 'c3' },
      { seq: 4, label: '交付说明撰写者', status: 'pending', startedAt: 0 },
    ],
  };
  let opened = null;
  const tree = mod.internals.Graph({ run, lang: 'zh', openNode: (n) => { opened = n.seq; } });
  const flat = texts(tree);
  assert.ok(flat.includes('实机连接与录制验证'));
  assert.ok(flat.includes('独立复核并修复问题'));
  assert.ok(flat.includes('撰写交付说明'));
  assert.ok(flat.includes('2/2'));
  assert.ok(flat.includes('0/1'));
  assert.ok(flat.includes('独立复核员'));

  const rails = findAll(tree, (el) => el.props && el.props.className === 'dwf-rail-line');
  assert.equal(rails[0].props['data-ink'], 'march');
  assert.equal(rails[1].props['data-ink'], 'next');

  const avatars = findAll(tree, (el) => el.props && el.props['data-subagent-avatar'] === 'true');
  assert.equal(avatars.length, 4);
  assert.equal(avatars[0].props['data-expression'], 'happy');
  assert.equal(avatars[1].props['data-expression'], 'sad');
  assert.equal(avatars[2].props['data-expression'], 'pill');
  assert.equal(avatars[3].props['data-expression'], 'dots');

  const clickablePills = findAll(tree, (el) => el.props && el.props['data-open'] === 'true');
  assert.equal(clickablePills.length, 1);
  assert.match(clickablePills[0].props.title, /deepseek-v4\.1-flash/u);
  clickablePills[0].props.onClick();
  assert.equal(opened, 3);
});

test('overflow ledge renders +N and clickable station lamps when scrolled', () => {
  const lanes = [0, 1, 2, 3, 4].map((i) => ({ id: `p${i}`, title: `阶段${i}`, state: 'done' }));
  let jumped = -1;
  const ledge = expand(mod.internals.StationLedge({
    side: 'left',
    indices: [0, 1, 2, 3],
    lanes,
    scrollLeft: 768,
    onSelectIndex: (idx) => { jumped = idx; },
  }));
  assert.ok(texts(ledge).includes('+1'));
  const dots = findAll(ledge, (el) => el.type === 'button');
  assert.equal(dots.length, 3);
  dots[0].props.onClick();
  assert.equal(jumped, 1);

  const moreBadge = findAll(ledge, (el) => el.props && el.props.className === 'dwf-ledge-more')[0];
  moreBadge.props.onClick();
  assert.equal(jumped, 0);
});

test('header progress line matches reference format and strings exist in both languages', () => {
  for (const [key, pair] of Object.entries(mod.internals.STRINGS)) {
    assert.equal(pair.length, 2, key);
  }
  const runningSummary = mod.internals.progressText({
    status: 'running',
    phases: 9,
    agents: 8,
    counts: { completed: 7, running: 1 },
    nodes: [{ seq: 8, status: 'running', model: 'deepseek-v4.1-flash' }],
  }, 'zh');
  assert.equal(runningSummary, '9 个阶段 · 1 个子代理工作中 · deepseek-v4.1-flash');

  const finishedSummary = mod.internals.progressText({
    status: 'completed',
    phases: 4,
    agents: 6,
    counts: { completed: 6 },
    nodes: [{ seq: 1, status: 'completed', model: 'glm-5.3' }],
    startedAt: 1000,
    endedAt: 66000,
  }, 'en');
  assert.equal(finishedSummary, '4 phases · 6 subagents · glm-5.3 · 1m05s');
  assert.equal(mod.internals.formatDuration(0, 0), '');
});

test('planned script items are non-clickable, skipped conditional agents stay pending, role colors match, and >6 overflow works', () => {
  const run = {
    status: 'running',
    phases: 2,
    agents: 2,
    hasScript: true,
    model: 'deepseek-v4.1-flash',
    counts: { completed: 1, running: 1 },
    graph: {
      lanes: [
        {
          id: 'p0',
          title: '编写并跑通单元测试',
          state: 'done',
          nodes: [1],
          items: [
            { key: 'n1', kind: 'agent', seq: 1, label: '测试作者', status: 'completed', avatarSlot: 7 },
            { key: 's0', kind: 'script', seq: null, label: '', status: 'completed' },
            { key: 'plan0', kind: 'agent', seq: null, label: '编译修复工', status: 'pending', avatarSlot: 6 },
          ],
        },
        {
          id: 'p1',
          title: '独立复核并修复问题',
          state: 'running',
          nodes: [2],
          items: [
            { key: 'n2', kind: 'agent', seq: 2, label: '独立复核员', status: 'running', avatarSlot: 0 },
            { key: 'plan1', kind: 'agent', seq: null, label: '编译修复工', status: 'pending', avatarSlot: 6 },
            { key: 's1', kind: 'script', seq: null, label: '', status: 'pending' },
            { key: 'p3', kind: 'agent', seq: null, label: '安全复核员', status: 'pending', avatarSlot: 2 },
            { key: 'p4', kind: 'agent', seq: null, label: '性能复核员', status: 'pending', avatarSlot: 3 },
            { key: 'p5', kind: 'agent', seq: null, label: '兼容复核员', status: 'pending', avatarSlot: 4 },
            { key: 'p6', kind: 'agent', seq: null, label: '文档复核员', status: 'pending', avatarSlot: 5 },
          ],
        },
      ],
      edges: [{ from: 'p0', to: 'p1' }],
    },
    nodes: [
      { seq: 1, label: '测试作者', status: 'completed' },
      { seq: 2, label: '独立复核员', status: 'running' },
    ],
  };

  assert.equal(mod.internals.progressText(run, 'zh'), '2 个阶段 · 1 个子代理工作中 · deepseek-v4.1-flash');

  const tree = mod.internals.Graph({ run, lang: 'zh' });
  const flat = texts(tree);
  assert.ok(flat.includes('2/2'));
  assert.ok(flat.includes('0/1'));
  assert.ok(flat.includes('还有 2 个子代理'));
  assert.ok(flat.includes('脚本'));

  const fixerAvatars = findAll(tree, (el) => el.props && el.props['data-subagent-avatar'] === 'true' && el.props.style?.['--wf-face-body'] === '#EB4699');
  assert.equal(fixerAvatars.length, 2);

  const scriptPills = findAll(tree, (el) => el.props && el.props['data-kind'] === 'script');
  assert.equal(scriptPills.length, 2);
  assert.equal(scriptPills[0].type, 'div');
  assert.equal(scriptPills[0].props['data-open'], 'false');
  assert.equal(scriptPills[0].props.onClick, undefined);
});

test('logs/script inspector button and drawer are completely removed', () => {
  assert.equal(mod.internals.WorkflowInspector, undefined);
  assert.equal(mod.internals.STRINGS.toggleInspector, undefined);
  assert.equal(mod.internals.STRINGS.tabLogs, undefined);
  assert.equal(mod.internals.STRINGS.tabScript, undefined);
  const stylesheet = styles.find((s) => s.id === 'dsh-dynamic-workflow-styles').textContent;
  assert.equal(stylesheet.includes('.dwf-inspector'), false);
});

test('stylesheet enforces alpha-1.0 anti-bleed card surface, valid glass elevation shadow, webkit scrollbar scoping, overscroll containment, and 204px lane pitch', () => {
  const css = styles.find((s) => s.id === 'dsh-dynamic-workflow-styles').textContent;
  // Explicit `/ 1` alpha override is mandatory in CSS Color 5 relative color syntax (`rgb(from ... r g b)` alone preserves origin alpha!)
  assert.match(css, /--dwf-surface-solid:rgb\(from var\(--dsw-alias-bg-layer-2,var\(--dsw-alias-bg-base,#ffffff\)\) r g b \/ 1\)/u);
  // `--ts-glass-highlight` is a <color>, so it MUST be prefixed with `inset 0 1px 0` (otherwise box-shadow becomes IACVT `none`)
  assert.match(css, /html\[data-theme-studio="glass-color"\] \.dwf-dock/u);
  assert.match(css, /box-shadow:inset 0 1px 0 var\(--ts-glass-highlight,transparent\),var\(--dsw-elevation-soft/u);
  // `scrollbar-width` must be gated behind `@supports not selector(::-webkit-scrollbar)` so Chromium honors `::-webkit-scrollbar { height: 0 }`
  assert.match(css, /@supports not selector\(::-webkit-scrollbar\)\{\s*\.dwf-scroller\{scrollbar-width:none\}/u);
  // Trackpad horizontal swipe protection without trapping vertical chat scroll when not vertically expanded
  assert.match(css, /\.dwf-scroller\{width:100%;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain\}/u);
  assert.match(css, /\.dwf-scroller\[data-vscroll="true"\]\{max-height:276px;overflow-y:auto;overscroll-behavior:contain\}/u);
  // `.dwf-lanes` MUST NOT use `width:max-content` (which bloats multi-phase Chinese lanes to ~269px in Blink)
  assert.equal(css.includes('width:max-content'), false);
  assert.match(css, /\.dwf-lanes\{display:flex;align-items:stretch;width:100%\}/u);
  assert.match(css, /\.dwf-lane\{flex:1 0 204px;max-width:316px/u);
  assert.match(css, /\.dwf-lane\[data-last="true"\]\{flex:1 0 184px;max-width:296px;padding-right:0\}/u);
  assert.match(css, /\.dwf-lanes\[data-compact="true"\] \.dwf-lane\{flex-shrink:1;min-width:176px\}/u);
  // Folded `.dwf-station` keeps its opaque sticky surface while hiding only its foreground children
  assert.equal(/\.dwf-station\[data-folded="true"\]\{[^}]*opacity:0/u.test(css), false);
  assert.match(css, /\.dwf-station\[data-folded="true"\]>\*\{opacity:0;pointer-events:none\}/u);
  // Rail & lamp tokens derive from opaque --dsw-alias-label-primary, not pre-faded --dsw-alias-label-tertiary
  assert.match(css, /--dwf-rail-idle:color-mix\(in srgb,var\(--dsw-alias-label-primary,#1f2329\) 45%,transparent\)/u);
  assert.match(css, /--dwf-rail-done:color-mix\(in srgb,var\(--dsw-alias-label-primary,#1f2329\) 64%,transparent\)/u);
  assert.match(css, /\.dwf-rail-line\{[^}]*height:2px/u);

  const { railInkBetween } = mod.internals;
  assert.equal(railInkBetween({ state: 'done' }, { state: 'running' }), 'march');
  assert.equal(railInkBetween({ state: 'running' }, { state: 'pending' }), 'next');
  assert.equal(railInkBetween({ state: 'done' }, { state: 'done' }), 'done');
  assert.equal(railInkBetween({ state: 'done' }, { state: 'cancelled' }), 'done');
  assert.equal(railInkBetween({ state: 'done' }, { state: 'failed' }), 'err');
  assert.equal(railInkBetween({ state: 'pending' }, { state: 'pending' }), 'solid');
});

test('translateTimelineWheel maps vertical mouse wheel, scales line/page deltaMode, ignores pinch-zoom, and yields at boundaries', () => {
  const { translateTimelineWheel, WHEEL_LINE_PX } = mod.internals;
  assert.equal(WHEEL_LINE_PX, 16);
  // No horizontal overflow -> 0
  assert.equal(translateTimelineWheel({ scrollWidth: 600, clientWidth: 600, scrollHeight: 180, clientHeight: 180 }, { deltaX: 0, deltaY: 60 }), 0);
  // Horizontal overflow, no vertical overflow -> maps deltaY to horizontal scroll
  assert.equal(translateTimelineWheel({ scrollLeft: 0, scrollWidth: 1200, clientWidth: 600, scrollHeight: 180, clientHeight: 180 }, { deltaX: 0, deltaY: 60 }), 60);
  assert.equal(translateTimelineWheel({ scrollLeft: 240, scrollWidth: 1200, clientWidth: 600, scrollHeight: 180, clientHeight: 180 }, { deltaX: 0, deltaY: -60 }), -60);
  // Left & right scroll boundaries (including fractional DPR subpixel scrollLeft) return 0 so outer chat can scroll vertically
  assert.equal(translateTimelineWheel({ scrollLeft: 0, scrollWidth: 1200, clientWidth: 600, scrollHeight: 180, clientHeight: 180 }, { deltaX: 0, deltaY: -60 }), 0);
  assert.equal(translateTimelineWheel({ scrollLeft: 600, scrollWidth: 1200, clientWidth: 600, scrollHeight: 180, clientHeight: 180 }, { deltaX: 0, deltaY: 60 }), 0);
  assert.equal(translateTimelineWheel({ scrollLeft: 599.25, scrollWidth: 1200, clientWidth: 600, scrollHeight: 180, clientHeight: 180 }, { deltaX: 0, deltaY: 60 }), 0);
  // Scales DOM_DELTA_LINE (1) by 16px and DOM_DELTA_PAGE (2) by clientWidth
  assert.equal(translateTimelineWheel({ scrollLeft: 100, scrollWidth: 1200, clientWidth: 600, scrollHeight: 180, clientHeight: 180 }, { deltaX: 0, deltaY: 3, deltaMode: 1 }), 48);
  assert.equal(translateTimelineWheel({ scrollLeft: 100, scrollWidth: 1200, clientWidth: 600, scrollHeight: 180, clientHeight: 180 }, { deltaX: 0, deltaY: 1, deltaMode: 2 }), 600);
  // Pinch-to-zoom (ctrlKey) and trackpad horizontal swipe -> return 0
  assert.equal(translateTimelineWheel({ scrollLeft: 100, scrollWidth: 1200, clientWidth: 600, scrollHeight: 180, clientHeight: 180 }, { deltaX: 0, deltaY: 60, ctrlKey: true }), 0);
  assert.equal(translateTimelineWheel({ scrollLeft: 100, scrollWidth: 1200, clientWidth: 600, scrollHeight: 180, clientHeight: 180 }, { deltaX: 50, deltaY: 10 }), 0);
  // Expanded lane has vertical overflow -> allow vertical scrolling unless shiftKey or over .dwf-station / .dwf-ledge
  assert.equal(translateTimelineWheel({ scrollLeft: 100, scrollWidth: 1200, clientWidth: 600, scrollHeight: 360, clientHeight: 276 }, { deltaX: 0, deltaY: 60 }), 0);
  assert.equal(translateTimelineWheel({ scrollLeft: 100, scrollWidth: 1200, clientWidth: 600, scrollHeight: 360, clientHeight: 276 }, { deltaX: 0, deltaY: 60, shiftKey: true }), 60);
  assert.equal(translateTimelineWheel({ scrollLeft: 100, scrollWidth: 1200, clientWidth: 600, scrollHeight: 360, clientHeight: 276 }, { deltaX: 0, deltaY: 60, onStation: true }), 60);
});

test('openSession falls back to subagent address on both synchronous throws and async Promise rejections', async () => {
  const syncCalls = [];
  const registered = [];
  mod.apply({
    slots: { inject: (_slot, fn) => fn(), register: (entry, component) => registered.push({ entry, component }) },
    connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
    get: (name) => (name === 'uiWorkspace' ? {
      openSession(target) {
        syncCalls.push(target);
        if (typeof target === 'string') throw new Error(`sessions.retain: unknown session ${target}`);
      },
    } : undefined),
  });
  registered[0].entry.inject('parent-1').openSession('parent-1', 'child-9');
  assert.deepEqual(syncCalls, [
    'child-9',
    { parentSessionId: 'parent-1', childSessionId: 'child-9', mode: 'unknown' },
  ]);

  const asyncCalls = [];
  const registeredAsync = [];
  mod.apply({
    slots: { inject: (_slot, fn) => fn(), register: (entry, component) => registeredAsync.push({ entry, component }) },
    connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
    get: (name) => (name === 'uiWorkspace' ? {
      openSession(target) {
        asyncCalls.push(target);
        if (typeof target === 'string') return Promise.reject(new Error(`unknown session ${target}`));
        return Promise.resolve();
      },
    } : undefined),
  });
  registeredAsync[0].entry.inject('parent-2').openSession('parent-2', 'child-11');
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(asyncCalls, [
    'child-11',
    { parentSessionId: 'parent-2', childSessionId: 'child-11', mode: 'unknown' },
  ]);
});

test('stateful WorkflowDock: no inspector action, stop feedback, hover-paused completion collapse, and 0ms instant reveal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

  const defaultUseState = react.useState;
  const defaultUseEffect = react.useEffect;

  function mountComponent(Component, props) {
    const states = [];
    const effectRecs = [];
    let tree = null;

    const render = () => {
      let sIdx = 0;
      let eIdx = 0;
      const pendingEffects = [];
      react.useState = (init) => {
        const idx = sIdx++;
        if (!(idx in states)) states[idx] = typeof init === 'function' ? init() : init;
        const setter = (next) => {
          const val = typeof next === 'function' ? next(states[idx]) : next;
          if (!Object.is(val, states[idx])) {
            states[idx] = val;
            render();
          }
        };
        return [states[idx], setter];
      };
      react.useEffect = (fn, deps) => {
        const idx = eIdx++;
        const prev = effectRecs[idx];
        const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((d, i) => !Object.is(d, prev.deps[i]));
        if (changed) pendingEffects.push({ idx, fn, deps });
      };
      try {
        tree = Component(props);
      } finally {
        react.useState = defaultUseState;
        react.useEffect = defaultUseEffect;
      }
      for (const eff of pendingEffects) {
        if (effectRecs[eff.idx] && typeof effectRecs[eff.idx].cleanup === 'function') {
          effectRecs[eff.idx].cleanup();
        }
        const cleanup = eff.fn();
        effectRecs[eff.idx] = { deps: eff.deps, cleanup };
      }
      return tree;
    };

    render();
    return {
      get tree() { return tree; },
      unmount() {
        for (const rec of effectRecs) {
          if (rec && typeof rec.cleanup === 'function') rec.cleanup();
        }
      },
    };
  }

  const dockQueue = [];
  let stopRejectedOnce = false;
  const rpcCall = (method) => {
    if (method === 'dock') {
      return new Promise((resolve) => { dockQueue.push(resolve); });
    }
    if (method === 'stop') {
      if (!stopRejectedOnce) {
        stopRejectedOnce = true;
        return Promise.reject(new Error('transient'));
      }
      return Promise.resolve({ via: 'agent' });
    }
    throw new Error(`unexpected rpc ${method}`);
  };

  const mounted = mountComponent(mod.internals.WorkflowDock, {
    rpcCall,
    sessionId: 'sess-live',
    openSession() {},
  });

  try {
    assert.equal(mounted.tree, null);
    assert.equal(dockQueue.length, 1);

    // Push a running workflow snapshot
    const runningRun = {
      id: 'run-live',
      name: 'ai-protocol-audit',
      status: 'running',
      phases: 2,
      agents: 2,
      hasScript: true,
      counts: { running: 1, completed: 1 },
      graph: {
        lanes: [
          { id: 'p0', title: '基线核查', state: 'done', nodes: [1] },
          { id: 'p1', title: '影子复核', state: 'running', nodes: [2] },
        ],
      },
      nodes: [
        { seq: 1, label: '基线核查', status: 'completed' },
        { seq: 2, label: '专项复核', status: 'running', model: 'deepseek-v4.1-flash', childId: 'c2' },
      ],
    };
    dockQueue.shift()({ rev: 1, run: runningRun });
    await Promise.resolve();
    await Promise.resolve();

    assert.ok(mounted.tree);
    assert.equal(mounted.tree.props['data-collapsed'], 'false');

    // Verify zero inspector buttons in header
    const actions = findAll(mounted.tree, (el) => el.props && el.props['data-action']);
    assert.deepEqual(actions.map((b) => b.props['data-action']), ['stop', 'collapse']);

    // Click Stop -> shows immediate stopping feedback, then recovers on transient rejection
    const stopBtn = actions.find((b) => b.props['data-action'] === 'stop');
    stopBtn.props.onClick();
    const stopBtnBusy = findAll(mounted.tree, (el) => el.props && el.props['data-action'] === 'stop')[0];
    assert.equal(stopBtnBusy.props.disabled, true);
    assert.equal(stopBtnBusy.props.title, '正在停止…');
    await Promise.resolve();
    await Promise.resolve();
    const stopBtnRecovered = findAll(mounted.tree, (el) => el.props && el.props['data-action'] === 'stop')[0];
    assert.equal(stopBtnRecovered.props.disabled, false);

    // Transition running -> completed: stays expanded during COLLAPSE_DELAY_MS so GrokBot hop plays
    const completedRun = {
      ...runningRun,
      status: 'completed',
      counts: { completed: 2 },
      graph: {
        lanes: [
          { id: 'p0', title: '基线核查', state: 'done', nodes: [1] },
          { id: 'p1', title: '影子复核', state: 'done', nodes: [2] },
        ],
      },
      nodes: [
        { seq: 1, label: '基线核查', status: 'completed' },
        { seq: 2, label: '专项复核', status: 'completed', model: 'deepseek-v4.1-flash', childId: 'c2' },
      ],
    };
    dockQueue.shift()({ rev: 2, run: completedRun });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(mounted.tree.props['data-collapsed'], 'false');

    // Hovering over the dock pauses auto-collapse even past COLLAPSE_DELAY_MS
    mounted.tree.props.onMouseEnter();
    t.mock.timers.tick(mod.internals.COLLAPSE_DELAY_MS + 500);
    assert.equal(mounted.tree.props['data-collapsed'], 'false');

    // Leaving the dock resumes completion collapse after COLLAPSE_DELAY_MS
    mounted.tree.props.onMouseLeave();
    t.mock.timers.tick(mod.internals.COLLAPSE_DELAY_MS + 50);
    assert.equal(mounted.tree.props['data-collapsed'], 'true');

    // Interactive mini-rail dot in collapsed header expands the dock on click
    const miniDots = findAll(mounted.tree, (el) => el.props && el.props['data-interactive'] === 'true');
    assert.equal(miniDots.length, 2);
    let propagated = false;
    miniDots[1].props.onClick({ stopPropagation() { propagated = true; } });
    assert.equal(propagated, true);
    assert.equal(mounted.tree.props['data-collapsed'], 'false');

    // Dismiss the finished card -> dock becomes null while next long-poll is still pending!
    const dismissBtn = findAll(mounted.tree, (el) => el.props && el.props['data-action'] === 'dismiss')[0];
    dismissBtn.props.onClick();
    assert.equal(mounted.tree, null);

    // Clicking WorkflowChatRow calls reveal('sess-live') -> restores dock in 0ms with flash highlight!
    mod.internals.reveal('sess-live');
    assert.ok(mounted.tree);
    assert.equal(mounted.tree.props['data-collapsed'], 'false');
    assert.equal(mounted.tree.props['data-flash'], 'true');
    t.mock.timers.tick(900);
    assert.equal(mounted.tree.props['data-flash'], undefined);
  } finally {
    mounted.unmount();
  }
});

test('Graph binds non-passive wheel listener in useEffect, handles empty->populated transitions, data-compact, and pointer grab-to-pan', () => {
  // Empty lanes -> renders empty state cleanly
  const emptyTree = mod.internals.Graph({ run: { graph: { lanes: [] } }, lang: 'en' });
  assert.ok(texts(emptyTree).includes('No phase nodes yet'));

  // Null/missing chat node data -> renders default row cleanly without throwing
  const fallbackRow = mod.internals.WorkflowChatRow({ node: null, sessionId: 's-empty' });
  assert.ok(texts(fallbackRow).includes('工作流脚本'));

  // Mount Graph with real effect lifecycle to verify non-passive `wheel` binding (not passive JSX `onWheel`)
  const defaultUseState = react.useState;
  const defaultUseEffect = react.useEffect;
  function mountGraph(initialProps) {
    let props = initialProps;
    const states = [];
    const effectRecs = [];
    let tree = null;
    const render = () => {
      let sIdx = 0;
      let eIdx = 0;
      const pending = [];
      react.useState = (init) => {
        const idx = sIdx++;
        if (!(idx in states)) states[idx] = typeof init === 'function' ? init() : init;
        const set = (next) => {
          const val = typeof next === 'function' ? next(states[idx]) : next;
          if (!Object.is(val, states[idx])) { states[idx] = val; render(); }
        };
        return [states[idx], set];
      };
      react.useEffect = (fn, deps) => {
        const idx = eIdx++;
        const prev = effectRecs[idx];
        const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((d, i) => !Object.is(d, prev.deps[i]));
        if (changed) pending.push({ idx, fn, deps });
      };
      try { tree = mod.internals.Graph(props); } finally {
        react.useState = defaultUseState;
        react.useEffect = defaultUseEffect;
      }
      for (const eff of pending) {
        if (effectRecs[eff.idx] && typeof effectRecs[eff.idx].cleanup === 'function') effectRecs[eff.idx].cleanup();
        const rec = { deps: eff.deps, cleanup: null };
        effectRecs[eff.idx] = rec;
        rec.cleanup = eff.fn();
      }
      return tree;
    };
    render();
    return {
      get tree() { return tree; },
      rerender(nextProps) { props = nextProps; render(); },
      unmount() { for (const rec of effectRecs) if (rec && typeof rec.cleanup === 'function') rec.cleanup(); },
    };
  }

  const listeners = new Map();
  const mockScroller = {
    scrollLeft: 0,
    clientWidth: 400,
    scrollWidth: 1020,
    clientHeight: 220,
    scrollHeight: 220,
    captured: null,
    addEventListener(type, fn, opts) { listeners.set(type, { fn, opts }); },
    removeEventListener(type, fn) {
      const cur = listeners.get(type);
      if (cur && cur.fn === fn) listeners.delete(type);
    },
    setPointerCapture(id) { this.captured = id; },
    releasePointerCapture() { this.captured = null; },
    scrollTo({ left }) { this.scrollLeft = left; },
  };
  const scrollerBox = { current: null };

  // Start with 0 lanes (scroller not yet in DOM) -> transition to 3 lanes (`data-compact="true"`) -> 5 lanes (`data-compact` undefined)
  const mounted = mountGraph({ run: { id: 'r-wheel', graph: { lanes: [] } }, lang: 'zh', scrollerRef: scrollerBox });
  assert.equal(listeners.has('wheel'), false);

  scrollerBox.current = mockScroller;
  const threeLaneRun = {
    id: 'r-wheel',
    graph: {
      lanes: [0, 1, 2].map((i) => ({ id: `c${i}`, title: `阶段${i}`, state: 'done', nodes: [i + 1] })),
    },
    nodes: [0, 1, 2].map((i) => ({ seq: i + 1, label: `角色${i}`, status: 'completed' })),
  };
  mounted.rerender({ run: threeLaneRun, lang: 'zh', scrollerRef: scrollerBox });
  const compactLanesVnode = findAll(mounted.tree, (el) => el.props && el.props.className === 'dwf-lanes')[0];
  assert.equal(compactLanesVnode.props['data-compact'], 'true');

  const multiLaneRun = {
    id: 'r-wheel',
    graph: {
      lanes: [0, 1, 2, 3, 4].map((i) => ({
        id: `p${i}`,
        title: `阶段${i}`,
        state: i < 4 ? 'done' : 'done',
        nodes: [i + 1],
      })),
    },
    nodes: [0, 1, 2, 3, 4].map((i) => ({
      seq: i + 1,
      label: `角色${i}`,
      status: 'completed',
    })),
  };
  mounted.rerender({ run: multiLaneRun, lang: 'zh', scrollerRef: scrollerBox });

  const scrollerVnode = findAll(mounted.tree, (el) => el.props && el.props.className === 'dwf-scroller')[0];
  const fullLanesVnode = findAll(mounted.tree, (el) => el.props && el.props.className === 'dwf-lanes')[0];
  assert.equal(fullLanesVnode.props['data-compact'], undefined);
  assert.equal(scrollerVnode.props.onWheel, undefined, 'must not attach passive React JSX onWheel');

  const wheelBinding = listeners.get('wheel');
  assert.ok(wheelBinding, 'wheel listener must be attached via addEventListener');
  assert.deepEqual(wheelBinding.opts, { passive: false });

  // At scrollLeft = 0, scrolling UP (deltaY < 0) cannot move further left -> does NOT preventDefault
  let upAtStartPrevented = false;
  wheelBinding.fn({
    deltaX: 0,
    deltaY: -80,
    deltaMode: 0,
    shiftKey: false,
    target: null,
    preventDefault() { upAtStartPrevented = true; },
  });
  assert.equal(upAtStartPrevented, false);
  assert.equal(mockScroller.scrollLeft, 0);

  // Vertical wheel event (pixel & line deltaMode) translates to scrollLeft and prevents default vertical page scroll
  let wheelPrevented = false;
  wheelBinding.fn({
    deltaX: 0,
    deltaY: 72,
    deltaMode: 0,
    shiftKey: false,
    target: null,
    preventDefault() { wheelPrevented = true; },
  });
  assert.equal(wheelPrevented, true);
  assert.equal(mockScroller.scrollLeft, 72);

  let linePrevented = false;
  wheelBinding.fn({
    deltaX: 0,
    deltaY: 3,
    deltaMode: 1,
    shiftKey: false,
    target: null,
    preventDefault() { linePrevented = true; },
  });
  assert.equal(linePrevented, true);
  assert.equal(mockScroller.scrollLeft, 120);

  // At right boundary (scrollLeft = 620 = 1020 - 400), scrolling DOWN (deltaY > 0) yields to parent vertical scroll
  mockScroller.scrollLeft = 620;
  let downAtEndPrevented = false;
  wheelBinding.fn({
    deltaX: 0,
    deltaY: 80,
    deltaMode: 0,
    shiftKey: false,
    target: null,
    preventDefault() { downAtEndPrevented = true; },
  });
  assert.equal(downAtEndPrevented, false);
  mockScroller.scrollLeft = 120;

  // Pointer drag > 6px pans scrollLeft and suppresses immediate trailing click
  scrollerVnode.props.onPointerDown({ button: 0, clientX: 300, pointerId: 7 });
  scrollerVnode.props.onPointerMove({ clientX: 220, pointerId: 7 });
  assert.equal(mockScroller.scrollLeft, 200);
  assert.equal(mockScroller.captured, 7);
  scrollerVnode.props.onPointerUp({ pointerId: 7 });
  assert.equal(mockScroller.captured, null);

  let clickStopped = false;
  scrollerVnode.props.onClickCapture({
    preventDefault() {},
    stopPropagation() { clickStopped = true; },
  });
  assert.equal(clickStopped, true);

  // Touch pointers are never hijacked by pointer-capture drag-to-pan
  const prevScrollLeft = mockScroller.scrollLeft;
  scrollerVnode.props.onPointerDown({ button: 0, pointerType: 'touch', clientX: 300, clientY: 100, pointerId: 9 });
  scrollerVnode.props.onPointerMove({ pointerType: 'touch', clientX: 180, clientY: 100, pointerId: 9 });
  assert.equal(mockScroller.scrollLeft, prevScrollLeft);
  assert.equal(mockScroller.captured, null);

  // Predominantly vertical drags cancel horizontal grab so expanded lanes scroll vertically
  scrollerVnode.props.onPointerDown({ button: 0, pointerType: 'mouse', clientX: 200, clientY: 50, pointerId: 10 });
  scrollerVnode.props.onPointerMove({ pointerType: 'mouse', clientX: 196, clientY: 95, pointerId: 10 });
  scrollerVnode.props.onPointerMove({ pointerType: 'mouse', clientX: 120, clientY: 100, pointerId: 10 });
  assert.equal(mockScroller.scrollLeft, prevScrollLeft);
  assert.equal(mockScroller.captured, null);

  // Unmount removes native wheel and scroll listeners cleanly
  mounted.unmount();
  assert.equal(listeners.has('wheel'), false);
  assert.equal(listeners.has('scroll'), false);
});

test('formatAgentLabel localizes live unnamed "agent #N" and generic labels while preserving real role names', () => {
  const { formatAgentLabel, AgentPill } = mod.internals;
  assert.equal(formatAgentLabel({ seq: 8, label: 'agent #8' }, 'zh'), '子代理 #8');
  assert.equal(formatAgentLabel({ seq: 8, label: 'agent #8' }, 'en'), 'Subagent #8');
  assert.equal(formatAgentLabel({ seq: null, label: 'agent' }, 'zh'), '子代理');
  assert.equal(formatAgentLabel({ seq: 5, label: 'subagent-3' }, 'zh'), '子代理 #3');
  assert.equal(formatAgentLabel({ seq: 4, label: '' }, 'zh'), '子代理 #4');
  assert.equal(formatAgentLabel({ seq: 1, label: 'Agent Smith' }, 'zh'), 'Agent Smith');
  assert.equal(formatAgentLabel({ seq: 2, label: '独立复核员' }, 'zh'), '独立复核员');

  const pill = expand(AgentPill({ node: { seq: 8, label: 'agent #8', status: 'running' }, lang: 'zh' }));
  assert.ok(texts(pill).includes('子代理 #8'));
  assert.equal(texts(pill).includes('agent #8'), false);
});

test('StationLedge bridges right-ledge rail gap dynamically and applies state-aware data-ink on both sides', () => {
  const { StationLedge } = mod.internals;
  const lanes = [
    { id: 'p0', title: '阶段0', state: 'done' },
    { id: 'p1', title: '阶段1', state: 'done' },
    { id: 'p2', title: '阶段2', state: 'running' },
    { id: 'p3', title: '阶段3', state: 'pending' },
    { id: 'p4', title: '阶段4', state: 'pending' },
  ];

  // Right ledge: bridges from lane 2 right edge (612) to right-pinned dots [3, 4] in a 726px viewport
  const rightLedge = expand(StationLedge({
    side: 'right',
    indices: [3, 4],
    lanes,
    scrollLeft: 0,
    clientWidth: 726,
    prevLaneRight: 612,
    onSelectIndex() {},
    lang: 'zh',
  }));
  const stubL = findAll(rightLedge, (el) => el.props && el.props.className === 'dwf-ledge-stub')[0];
  assert.equal(stubL.props['data-ink'], 'solid'); // continues running->pending gradient's idle tail without restarting orange
  const widthPx = Number.parseInt(stubL.props.style.width, 10);
  assert.ok(widthPx >= 75 && widthPx <= 95, `expected dynamic right stub ~87px, got ${widthPx}px`);

  // Left ledge: when scrolled past running lane 2 into pending lane 3, stub-r carries 'next' (not hardcoded 'done')
  const leftLedge = expand(StationLedge({
    side: 'left',
    indices: [0, 1, 2],
    lanes,
    scrollLeft: 560,
    nextLaneLeft: 612,
    onSelectIndex() {},
    lang: 'zh',
  }));
  const segs = findAll(leftLedge, (el) => el.props && el.props.className === 'dwf-ledge-seg');
  assert.deepEqual(segs.map((s) => s.props['data-ink']), ['done', 'march']);
  const stubR = findAll(leftLedge, (el) => el.props && el.props.className === 'dwf-ledge-stub')[0];
  assert.equal(stubR.props['data-ink'], 'next');
});

test('MiniStationRail slides its 10-dot window to include active phases >= 10 and reports exact phase index', () => {
  const { MiniStationRail } = mod.internals;
  const lanes = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i}`,
    title: `阶段${i}`,
    state: i < 10 ? 'done' : i === 10 ? 'running' : 'pending',
  }));
  let selected = -1;
  const rail = expand(MiniStationRail({
    lanes,
    lang: 'zh',
    onSelectPhase: (idx) => { selected = idx; },
  }));
  const dots = findAll(rail, (el) => el.props && el.props.className === 'dwf-mini-dot');
  assert.equal(dots.length, 10);
  const runningDot = dots.find((d) => d.props['data-s'] === 'running');
  assert.ok(runningDot, 'active phase at index 10 must be visible inside sliding window');
  runningDot.props.onClick({ stopPropagation() {} });
  assert.equal(selected, 10);
});

test('chatSummary and chatLanesAndMembers do not count pending subagents as completed', () => {
  const { chatSummary, chatLanesAndMembers } = mod.internals;
  const data = {
    name: 'multi-stage',
    status: 'running',
    phases: [
      { key: 'p0', phase: '收集', members: [{ seq: 1, status: 'completed' }] },
      { key: 'p1', phase: '分析', members: [{ seq: 2, status: 'running' }, { seq: 3, status: 'pending' }] },
      { key: 'p2', phase: '汇总', members: [{ seq: 4, status: 'pending' }] },
    ],
  };
  assert.deepEqual(chatSummary(data), { total: 4, done: 1, current: '分析', status: 'running' });
  const { lanes } = chatLanesAndMembers(data);
  assert.deepEqual(lanes.map((l) => l.state), ['done', 'running', 'pending']);
});

test('Graph activates data-vscroll only when expanded, suppresses LocateIcon flicker during smooth scroll, and WorkflowDock reveals historical runs in 0ms', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  t.mock.timers.setTime(10_000);

  const defaultUseState = react.useState;
  const defaultUseEffect = react.useEffect;
  function mount(Component, initialProps) {
    let props = initialProps;
    const states = [];
    const effectRecs = [];
    let tree = null;
    const render = () => {
      let sIdx = 0;
      let eIdx = 0;
      const pendingEffects = [];
      react.useState = (init) => {
        const idx = sIdx++;
        if (!(idx in states)) states[idx] = typeof init === 'function' ? init() : init;
        const setter = (next) => {
          const val = typeof next === 'function' ? next(states[idx]) : next;
          if (!Object.is(val, states[idx])) { states[idx] = val; render(); }
        };
        return [states[idx], setter];
      };
      react.useEffect = (fn, deps) => {
        const idx = eIdx++;
        const prev = effectRecs[idx];
        const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((d, i) => !Object.is(d, prev.deps[i]));
        if (changed) pendingEffects.push({ idx, fn, deps });
      };
      try { tree = Component(props); } finally {
        react.useState = defaultUseState;
        react.useEffect = defaultUseEffect;
      }
      for (const eff of pendingEffects) {
        if (effectRecs[eff.idx] && typeof effectRecs[eff.idx].cleanup === 'function') effectRecs[eff.idx].cleanup();
        const rec = { deps: eff.deps, cleanup: null };
        effectRecs[eff.idx] = rec;
        rec.cleanup = eff.fn();
      }
      return tree;
    };
    render();
    return {
      get tree() { return tree; },
      rerender(nextProps) { props = nextProps; render(); },
      unmount() { for (const rec of effectRecs) if (rec && typeof rec.cleanup === 'function') rec.cleanup(); },
    };
  }

  // 1. Graph: initial auto-follow on mount, data-vscroll toggle, and LocateIcon no-flicker during smooth scroll
  const listeners = {};
  const scrollTargets = [];
  const scrollerEl = {
    scrollLeft: 0,
    clientWidth: 400,
    scrollWidth: 1020,
    clientHeight: 240,
    scrollHeight: 240,
    addEventListener(ev, fn) { listeners[ev] = fn; },
    removeEventListener(ev) { delete listeners[ev]; },
    scrollTo({ left }) { scrollTargets.push(left); },
  };
  const awayHistory = [];
  const sevenNodes = Array.from({ length: 7 }, (_, i) => ({ seq: i + 1, label: `角色${i + 1}`, status: i === 6 ? 'running' : 'completed' }));
  const graphRun = {
    id: 'run-g1',
    graph: {
      lanes: [
        { id: 'p0', title: '阶段0', state: 'done', nodes: [1, 2, 3, 4, 5, 6, 7] },
        { id: 'p1', title: '阶段1', state: 'done', nodes: [] },
        { id: 'p2', title: '阶段2', state: 'done', nodes: [] },
        { id: 'p3', title: '阶段3', state: 'done', nodes: [] },
        { id: 'p4', title: '阶段4', state: 'running', nodes: [7] },
      ],
    },
    nodes: sevenNodes,
  };
  const g = mount(mod.internals.Graph, {
    run: graphRun,
    lang: 'zh',
    scrollerRef: { current: scrollerEl },
    focusRequest: null,
    onAwayChange: (v) => awayHistory.push(v),
  });
  try {
    // Mounting with running phase 4 auto-scrolls to the right end (620) without LocateIcon flashing
    assert.deepEqual(scrollTargets, [620]);
    assert.deepEqual(awayHistory, []);
    scrollerEl.scrollLeft = 620;
    t.mock.timers.tick(720);
    assert.deepEqual(awayHistory, []);

    // Initially unexpanded -> data-vscroll is undefined
    let scroller = findAll(g.tree, (el) => el.props && el.props.className === 'dwf-scroller')[0];
    assert.equal(scroller.props['data-vscroll'], undefined);

    // Click "还有 2 个子代理" -> data-vscroll becomes "true"
    const moreBtn = findAll(g.tree, (el) => el.props && el.props['data-more'] === '2')[0];
    moreBtn.props.onClick();
    scroller = findAll(g.tree, (el) => el.props && el.props.className === 'dwf-scroller')[0];
    assert.equal(scroller.props['data-vscroll'], 'true');

    // User scrolls manually to scrollLeft=0 -> away=true (`LocateIcon` appears)
    scrollerEl.scrollLeft = 0;
    listeners.scroll();
    assert.deepEqual(awayHistory, [true]);

    // User clicks LocateIcon -> focusRequest fires, away becomes false, smooth scroll begins;
    // intermediate scroll event at +16ms (scrollLeft=24, still far from lane 4 at x=816) MUST NOT flicker away back to true!
    awayHistory.length = 0;
    g.rerender({
      run: graphRun,
      lang: 'zh',
      scrollerRef: { current: scrollerEl },
      focusRequest: { idx: null, seq: 1 },
      onAwayChange: (v) => awayHistory.push(v),
    });
    assert.deepEqual(awayHistory, [false]);
    t.mock.timers.tick(16);
    scrollerEl.scrollLeft = 24;
    listeners.scroll();
    assert.deepEqual(awayHistory, [false]);

    // Switching run.id resets openLanes (`data-vscroll` returns to undefined)
    g.rerender({
      run: { ...graphRun, id: 'run-g2' },
      lang: 'zh',
      scrollerRef: { current: scrollerEl },
      focusRequest: null,
      onAwayChange: (v) => awayHistory.push(v),
    });
    scroller = findAll(g.tree, (el) => el.props && el.props.className === 'dwf-scroller')[0];
    assert.equal(scroller.props['data-vscroll'], undefined);
  } finally {
    g.unmount();
  }

  // 2. WorkflowDock: clicking an earlier workflow's WorkflowChatRow reveals it in 0ms and hydrates full details
  const dockResolvers = [];
  const dockMounted = mount(mod.internals.WorkflowDock, {
    sessionId: 'sess-multi',
    openSession() {},
    rpcCall(method, payload) {
      if (method === 'dock') return new Promise((resolve) => { dockResolvers.push(resolve); });
      if (method === 'runs') return Promise.resolve({ runs: [{ id: 'run-old', name: 'audit-v1' }, { id: 'run-new', name: 'deploy-v2' }] });
      if (method === 'run' && payload.runId === 'run-old') {
        return Promise.resolve({
          id: 'run-old',
          name: 'audit-v1',
          status: 'completed',
          phases: 1,
          agents: 1,
          counts: { completed: 1 },
          model: 'deepseek-r2',
          graph: { lanes: [{ id: 'p0', title: '审计阶段', state: 'done', nodes: [1] }] },
          nodes: [{ seq: 1, label: '审计员', status: 'completed', model: 'deepseek-r2', childId: 'child-old' }],
        });
      }
      throw new Error(`unexpected ${method}`);
    },
  });
  try {
    dockResolvers.shift()({
      rev: 5,
      run: {
        id: 'run-new',
        name: 'deploy-v2',
        status: 'completed',
        phases: 1,
        agents: 1,
        counts: { completed: 1 },
        graph: { lanes: [{ id: 'p0', title: '部署阶段', state: 'done', nodes: [1] }] },
        nodes: [{ seq: 1, label: '部署员', status: 'completed' }],
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(texts(dockMounted.tree).includes('deploy-v2'));

    // Click earlier WorkflowChatRow ('audit-v1') -> switches dock in 0ms synchronously, then hydrates model 'deepseek-r2'
    mod.internals.reveal('sess-multi', {
      name: 'audit-v1',
      status: 'completed',
      phases: [{ key: 'p0', phase: '审计阶段', members: [{ seq: 1, label: '审计员', status: 'completed' }] }],
    });
    assert.ok(texts(dockMounted.tree).includes('audit-v1'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(texts(dockMounted.tree).join(' ').includes('deepseek-r2'));
  } finally {
    dockMounted.unmount();
  }
});

test('Graph clears +N left/right station ledges without lamp/title collision, omits folded station tooltips, and interrupts programmatic auto-scroll on manual wheel', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.mock.timers.setTime(50_000);

  const defaultUseState = react.useState;
  const defaultUseEffect = react.useEffect;
  function mountGraph(initialProps) {
    let props = initialProps;
    const states = [];
    const effects = [];
    let tree = null;
    const render = () => {
      let sIdx = 0;
      let eIdx = 0;
      const pending = [];
      react.useState = (init) => {
        const idx = sIdx++;
        if (!(idx in states)) states[idx] = typeof init === 'function' ? init() : init;
        const set = (next) => {
          const val = typeof next === 'function' ? next(states[idx]) : next;
          if (!Object.is(val, states[idx])) { states[idx] = val; render(); }
        };
        return [states[idx], set];
      };
      react.useEffect = (fn, deps) => {
        const idx = eIdx++;
        const prev = effects[idx];
        const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((d, i) => !Object.is(d, prev.deps[i]));
        if (changed) pending.push({ idx, fn, deps });
      };
      try { tree = mod.internals.Graph(props); } finally {
        react.useState = defaultUseState;
        react.useEffect = defaultUseEffect;
      }
      for (const eff of pending) {
        if (effects[eff.idx] && typeof effects[eff.idx].cleanup === 'function') effects[eff.idx].cleanup();
        const rec = { deps: eff.deps, cleanup: null };
        effects[eff.idx] = rec;
        rec.cleanup = eff.fn();
      }
      return tree;
    };
    render();
    return {
      get tree() { return tree; },
      rerender(next) { props = next; render(); },
      unmount() { for (const rec of effects) if (rec && typeof rec.cleanup === 'function') rec.cleanup(); },
    };
  }

  const ninePhaseRun = {
    id: 'run-9p',
    graph: {
      lanes: Array.from({ length: 9 }, (_, i) => ({
        id: `p${i}`,
        title: `第${i + 1}阶段长标题用于测试截断与折叠`,
        state: i < 6 ? 'done' : i === 6 ? 'running' : 'pending',
        nodes: [i + 1],
      })),
    },
    nodes: Array.from({ length: 9 }, (_, i) => ({
      seq: i + 1,
      label: `子代理角色${i + 1}`,
      status: i < 6 ? 'completed' : i === 6 ? 'running' : 'pending',
    })),
  };

  const listeners = new Map();
  const scrollerEl = {
    scrollLeft: 0,
    clientWidth: 590,
    scrollWidth: 1816,
    clientHeight: 160,
    scrollHeight: 160,
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    scrollTo({ left }) { this.scrollLeft = left; },
  };
  const awayLog = [];
  const mounted = mountGraph({
    run: ninePhaseRun,
    lang: 'zh',
    scrollerRef: { current: scrollerEl },
    onAwayChange: (v) => awayLog.push(v),
  });

  try {
    // 1. At scrollLeft = 0 in a 590px viewport, lane 2 (x = 408) folds into right ledge (+4) so its title never overlaps ●—●—● +4
    scrollerEl.scrollLeft = 0;
    listeners.get('scroll')();
    let stations = findAll(mounted.tree, (el) => el.props && el.props.className === 'dwf-station');
    assert.equal(stations[0].props['data-folded'], undefined);
    assert.ok(stations[0].props.title.includes('第1阶段'));
    assert.equal(stations[1].props['data-folded'], undefined);
    assert.equal(stations[2].props['data-folded'], 'true');
    assert.equal(stations[2].props.title, undefined, 'folded station must omit native tooltip');

    // 2. At scrollLeft = 962 in a 694px viewport, lane 4 (x = 816) AND lane 5 (x = 1020, x - scrollLeft = 58 < 88)
    //    both fold into left ledge (+2 ●—●—●—) so the +N badge + 3 dots never overlap lane 5's lamp!
    scrollerEl.clientWidth = 694;
    scrollerEl.scrollLeft = 962;
    listeners.get('scroll')();
    stations = findAll(mounted.tree, (el) => el.props && el.props.className === 'dwf-station');
    for (let i = 0; i <= 5; i++) {
      assert.equal(stations[i].props['data-folded'], 'true', `expected lane ${i} to be folded behind +N left ledge`);
    }
    assert.equal(stations[6].props['data-folded'], undefined, 'running lane 6 at x - scrollLeft = 262 must remain visible');

    // 3. Re-focus via focusRequest starts 680ms programmatic scroll window; an immediate manual wheel pan backward
    //    clears programmaticUntil so the resulting scroll event immediately surfaces LocateIcon (away = true)
    awayLog.length = 0;
    mounted.rerender({
      run: ninePhaseRun,
      lang: 'zh',
      scrollerRef: { current: scrollerEl },
      focusRequest: { idx: null, seq: 1 },
      onAwayChange: (v) => awayLog.push(v),
    });
    t.mock.timers.tick(20); // still well inside the 680ms programmatic window
    listeners.get('wheel')({
      deltaX: 0,
      deltaY: -600,
      deltaMode: 0,
      shiftKey: false,
      target: null,
      preventDefault() {},
    });
    scrollerEl.scrollLeft = 0;
    listeners.get('scroll')();
    assert.equal(awayLog[awayLog.length - 1], true, 'manual wheel interrupt must immediately report away = true');
  } finally {
    mounted.unmount();
  }
});

