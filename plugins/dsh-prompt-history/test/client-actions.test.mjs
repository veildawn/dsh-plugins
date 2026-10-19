/**
 * 气泡「填回修改 / 重新发送」按钮行为测试（lib/client.js）。
 *
 * 桌面版 dsh 的 composer 是 Lexical contenteditable，且宿主不再保证把
 * `useInput` / `inputActions` 透传给 `conversation.input.left` 槽位。
 * 这里用零依赖的假 DOM + 桩 Cordis ctx 按 Web 加载方式（window.__ModuleLoader__.load）
 * 加载真实的客户端包，断言：
 *   - 插件注册到 conversation.input.left；
 *   - 宿主通过 uiSession 标准绑定提供 inputActions 时，编辑按钮写回草稿并聚焦；
 *   - 重发按钮在草稿落位后点击宿主的发送按钮（而不是盲目提交）；
 *   - 拿不到 inputActions 时，走 Lexical contenteditable 的 DOM 回落，按钮仍然有效；
 *   - 「排队发送 / 插话发送」等忙态发送按钮可识别，「停止生成」不会被误点。
 *
 * 零依赖、无浏览器、无网络。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const CLIENT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'client.js');
const CLIENT_CODE = readFileSync(CLIENT_PATH, 'utf8');
const MODULE_ID = '@weniatall/dsh-prompt-history';

// ---------------------------------------------------------------------------
// 极简 DOM：只实现插件的选择器子集（属性、class、tag、后代组合、逗号列表）
// ---------------------------------------------------------------------------
function parseAttr(selector) {
  const match = selector.match(/^\[([a-zA-Z0-9-]+)(?:(\*?=)"?([^\]"]*)"?)?\]$/);
  if (!match) return null;
  return { name: match[1], op: match[2] || '', value: match[3] };
}

function matchesSimple(el, rawSelector) {
  const selector = rawSelector.trim();
  if (!selector) return false;
  if (selector === '*') return true;
  if (selector.startsWith('.')) {
    return (el.className || '').split(/\s+/).includes(selector.slice(1));
  }
  if (selector.startsWith('[')) {
    const parsed = parseAttr(selector);
    if (!parsed) return false;
    const raw = el.attrs?.[parsed.name];
    if (!parsed.op) return raw !== undefined && raw !== null;
    const value = String(raw ?? '');
    if (parsed.op === '=') return value === parsed.value;
    if (parsed.op === '*=') return value.includes(parsed.value);
    return false;
  }
  if (/^[a-zA-Z0-9]+$/.test(selector)) return el.tagName === selector.toUpperCase();
  return false;
}

function matchesSelector(el, selector) {
  for (const part of selector.split(',')) {
    const chain = part.trim().split(/\s+/).filter(Boolean);
    if (chain.length === 0) continue;
    if (!matchesSimple(el, chain[chain.length - 1])) continue;
    let cursor = el.parent;
    let matched = true;
    for (let i = chain.length - 2; i >= 0; i -= 1) {
      let found = false;
      while (cursor) {
        if (matchesSimple(cursor, chain[i])) {
          found = true;
          cursor = cursor.parent;
          break;
        }
        cursor = cursor.parent;
      }
      if (!found) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

class FakeElement {
  constructor(tag, attrs = {}) {
    this.tagName = String(tag).toUpperCase();
    this.attrs = { ...attrs };
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.className = attrs.class || '';
    this.textContent = attrs.text || '';
    this.innerText = attrs.text || '';
    this.title = '';
    this.innerHTML = '';
    this.disabled = false;
    this.isContentEditable = false;
    this.id = attrs.id || '';
  }
  get nodeType() { return 1; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  setAttribute(name, value) { this.attrs[name] = value; }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  remove() {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = null;
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (node.nodeType === 1 && matchesSelector(node, selector)) return node;
      node = node.parent;
    }
    return null;
  }
  matches(selector) { return matchesSelector(this, selector); }
  contains(node) {
    let cursor = node;
    while (cursor) {
      if (cursor === this) return true;
      cursor = cursor.parent;
    }
    return false;
  }
  querySelector(selector) {
    for (const child of this.children) {
      if (matchesSelector(child, selector)) return child;
      const nested = child.querySelector?.(selector);
      if (nested) return nested;
    }
    return null;
  }
  querySelectorAll(selector) {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  cloneNode() {
    const copy = new FakeElement(this.tagName.toLowerCase(), { ...this.attrs });
    copy.className = this.className;
    copy.innerText = this.innerText;
    copy.textContent = this.textContent;
    return copy;
  }
  focus() { this.focused = true; }
  scrollIntoView() {}
  click() {
    this.clicked = (this.clicked || 0) + 1;
    if (typeof this.onclick === 'function') this.onclick({ stopPropagation() {} });
  }
  dispatchEvent() { return true; }
}

function createWorld() {
  const body = new FakeElement('body');
  const head = new FakeElement('head');
  const seat = new FakeElement('div', { 'data-composer-seat': '' });
  const card = new FakeElement('div', { 'data-composer-card': '' });
  const input = new FakeElement('div', { 'data-composer-input': '' });
  input.isContentEditable = true;
  card.appendChild(input);
  seat.appendChild(card);
  body.appendChild(seat);

  const bubble = new FakeElement('div', { class: 'x_bubble' });
  bubble.innerText = '审查后，提交、打 tag 发版';
  const clock = new FakeElement('span', { class: 'x_timeStart' });
  clock.innerText = '16:38';
  const actions = new FakeElement('div', { class: 'x_actions' });
  const row = new FakeElement('div', { 'data-chat-flow-kind': 'user', class: 'x_userRow' });
  row.appendChild(bubble);
  row.appendChild(actions);
  body.appendChild(row);

  const document = {
    body,
    documentElement: body,
    head,
    getElementById: () => null,
    createElement: (tag) => new FakeElement(tag),
    querySelector: (selector) => (matchesSelector(body, selector) ? body : body.querySelector(selector)),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    createRange: () => ({
      selectNodeContents() {},
      collapse() {},
      cloneRange() { return this; },
      getBoundingClientRect: () => ({ top: 0 }),
      toString: () => '',
    }),
    execCommand: (command, _ui, value) => {
      if (command === 'insertText') input.innerText = value;
      return true;
    },
  };

  const handlers = {};
  const window = {
    addEventListener: (name, handler) => { handlers[name] = handler; },
    removeEventListener: () => {},
    getSelection: () => ({
      rangeCount: 1,
      removeAllRanges() {},
      addRange() {},
      getRangeAt: () => document.createRange(),
    }),
    __ModuleLoader__: { load: () => {} },
    HTMLTextAreaElement: { prototype: {} },
    InputEvent: class { constructor(type, init) { Object.assign(this, init); this.type = type; } },
    KeyboardEvent: class { constructor(type, init) { Object.assign(this, init); this.type = type; } },
    Event: class { constructor(type, init) { Object.assign(this, init); this.type = type; } },
  };

  return { body, head, seat, card, input, bubble, actions, row, document, window, handlers };
}

// ---------------------------------------------------------------------------
// 以 Web 加载器的方式在隔离 vm 中加载客户端包
// ---------------------------------------------------------------------------
function loadClient(world) {
  let registration = null;
  world.window.__ModuleLoader__.load = (entry) => { registration = entry; };
  const sandbox = {
    window: world.window,
    document: world.document,
    console,
    setTimeout,
    clearTimeout,
    navigator: {},
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CLIENT_CODE, sandbox);
  if (!registration) throw new Error('client bundle did not register with __ModuleLoader__');
  const stubReact = {
    createElement: () => ({}),
    useState: (value) => [value, () => {}],
    useRef: (value) => ({ current: value }),
    useEffect: () => {},
    useMemo: (fn) => fn(),
    Fragment: 'fragment',
  };
  return registration.factory((id) => {
    if (id === 'react') return stubReact;
    throw new Error('unexpected require: ' + id);
  });
}

function createContext({ world, inputActions }) {
  const state = { draft: '', phase: 'plain' };
  const binding = {
    getSnapshot: () => ({
      key: 'session-under-test',
      props: inputActions === null ? {} : { inputActions },
      hooks: {
        input: {
          getSnapshot: () => state,
          subscribe: () => () => {},
        },
      },
    }),
    subscribe: () => () => {},
  };
  const registrations = [];
  let injectedSlot = null;
  const ctx = {
    connection: undefined,
    slots: {
      inject: (name, callback) => {
        injectedSlot = name;
        callback();
      },
      register: (options, component) => {
        registrations.push({ slot: injectedSlot, options, component });
        return () => {};
      },
    },
    inject: (_deps, callback) => callback({
      uiSession: { adapter: { current: binding } },
      effect: (fn) => { fn(); },
    }),
    on: () => {},
  };
  return { ctx, state, registrations };
}

function buttons(world) {
  return world.actions.children.filter((child) => child.dataset.dshPhAction);
}

// ---------------------------------------------------------------------------

test('bundle registers the composer entry on conversation.input.left', () => {
  const world = createWorld();
  const mod = loadClient(world);
  assert.equal(mod.inject.join(','), 'slots,connection');

  const { ctx, registrations } = createContext({ world, inputActions: { setDraft: () => {}, submit: () => {} } });
  mod.apply(ctx);

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].slot, 'conversation.input.left');
  assert.equal(registrations[0].options.name, 'conversation.input.left');
});

test('edit button writes the bubble text through the uiSession inputActions', () => {
  const world = createWorld();
  const mod = loadClient(world);
  const writes = [];
  const { ctx } = createContext({
    world,
    inputActions: {
      setDraft: (text) => { writes.push(text); world.input.innerText = text; },
      submit: () => {},
    },
  });
  mod.apply(ctx);

  const edit = buttons(world).find((button) => button.dataset.dshPhAction === 'edit');
  assert.ok(edit, 'edit button injected into the user message actions');
  edit.onclick({ stopPropagation() {} });

  assert.deepEqual(writes, ['审查后，提交、打 tag 发版']);
  assert.equal(world.input.focused, true, 'composer receives focus after edit');
});

test('resend waits for the draft, then clicks the host send control', async () => {
  const world = createWorld();
  const mod = loadClient(world);
  let stateRef = null;
  const { ctx, state } = createContext({
    world,
    inputActions: {
      setDraft: (text) => {
        world.input.innerText = text;
        if (stateRef) stateRef.draft = text;
      },
      submit: () => { throw new Error('submit should not be used when the send button exists'); },
    },
  });
  stateRef = state;
  mod.apply(ctx);

  const send = new FakeElement('button', { 'aria-label': '排队发送' });
  world.card.appendChild(send);
  state.draft = '';

  const resend = buttons(world).find((button) => button.dataset.dshPhAction === 'resend');
  assert.ok(resend, 'resend button injected');
  resend.onclick({ stopPropagation() {} });

  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(send.clicked, 1, 'host send control clicked exactly once');
});

test('stop control is never treated as a send control', async () => {
  const world = createWorld();
  const mod = loadClient(world);
  let setDraftCalls = 0;
  let submitCalls = 0;
  const { ctx, state } = createContext({
    world,
    inputActions: {
      setDraft: (text) => { setDraftCalls += 1; state.draft = text; },
      submit: () => { submitCalls += 1; },
    },
  });
  mod.apply(ctx);

  const stop = new FakeElement('button', { 'aria-label': '停止生成' });
  world.card.appendChild(stop);

  const resend = buttons(world).find((button) => button.dataset.dshPhAction === 'resend');
  resend.onclick({ stopPropagation() {} });
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(stop.clicked, undefined, 'Stop must not be clicked');
  assert.ok(setDraftCalls >= 1);
  assert.equal(submitCalls, 1, 'official submit is the fallback when no Send control is mounted');
});

test('edit falls back to the Lexical contenteditable when inputActions are absent', () => {
  const world = createWorld();
  const mod = loadClient(world);
  const { ctx } = createContext({ world, inputActions: null });
  mod.apply(ctx);

  const edit = buttons(world).find((button) => button.dataset.dshPhAction === 'edit');
  assert.ok(edit, 'edit button injected without slot props');
  edit.onclick({ stopPropagation() {} });

  assert.equal(world.input.innerText, '审查后，提交、打 tag 发版');
});
