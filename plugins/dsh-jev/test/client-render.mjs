/**
 * Frontend render check for the dsh-jev settings panel.
 *
 * The proxy field is user-facing, so a broken component tree would ship a
 * settings page that throws instead of letting the user type a proxy. This test
 * loads lib/client.js the same way the DSH web bundle does (a stubbed
 * window.__ModuleLoader__ plus a minimal React) and asserts the panel:
 *   - registers into the settings slot;
 *   - renders a 代理地址 input bound to the proxy state;
 *   - sends the typed proxy on save and on test;
 *   - renders the value returned by getConfig, and disables the field when the
 *     proxy is pinned by config.
 *
 * Zero dependencies, no browser, no network.
 *
 * Run: node test/client-render.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let failures = 0;
function check(label, condition, extra) {
  if (condition) {
    console.log('PASS ' + label);
  } else {
    failures += 1;
    console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra));
  }
}

// ---------------------------------------------------------------------------
// minimal React: createElement builds a plain tree; hooks are driven by hand
// ---------------------------------------------------------------------------
const hookState = [];
let hookIndex = 0;
let rerender = null;
let effectCleanups = [];

const react = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat().filter((c) => c !== null && c !== undefined && c !== false) };
  },
  useState(initial) {
    const i = hookIndex++;
    if (!(i in hookState)) hookState[i] = typeof initial === 'function' ? initial() : initial;
    const set = (value) => {
      hookState[i] = typeof value === 'function' ? value(hookState[i]) : value;
      if (rerender) rerender();
    };
    return [hookState[i], set];
  },
  useEffect(fn) {
    hookIndex++;
    effectCleanups.push(fn);
  },
};

// ---------------------------------------------------------------------------
// load the client bundle exactly like the web loader does
// ---------------------------------------------------------------------------
let registration = null;
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      registration = entry;
    },
  },
};
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ set textContent(v) { this._t = v; }, get textContent() { return this._t; }, id: '' }),
  head: { appendChild: () => {} },
};

const clientPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'client.js');
// eslint-disable-next-line no-eval
(0, eval)(readFileSync(clientPath, 'utf8'));

check('client bundle registers itself with the module loader', registration !== null && registration.id === 'dsh-jev', String(registration && registration.id));

const mod = registration.factory((id) => {
  if (id === 'react') return react;
  throw new Error('unexpected require: ' + id);
});
check('client exports apply and injects slots/connection', typeof mod.apply === 'function' && mod.inject.join(',') === 'slots,connection', JSON.stringify(mod.inject));

// ---------------------------------------------------------------------------
// fake ctx: capture the registered settings component
// ---------------------------------------------------------------------------
let component = null;
let injectedProps = null;
const ctx = {
  connection: {
    rpc: {
      call: async (channel, method, payload) => {
        ctx.lastCall = { channel, method, payload };
        return ctx.rpcResult ?? { ok: true, value: {} };
      },
    },
  },
  slots: {
    inject: (_name, fn) => fn(),
    register: (_options, comp) => {
      component = comp;
      return () => {};
    },
  },
};
mod.apply(ctx);
check('apply registers a settings component', typeof component === 'function', typeof component);

// the slot's inject() supplies rpcCall
const slotOptions = {};
ctx.slots.register = (_options, comp) => {
  component = comp;
  slotOptions.options = _options;
  return () => {};
};
mod.apply(ctx);
check('the slot supplies rpcCall to the component', typeof slotOptions.options.inject().rpcCall === 'function');

// ---------------------------------------------------------------------------
// render helper
// ---------------------------------------------------------------------------
function render(props) {
  hookIndex = 0;
  effectCleanups = [];
  return component(props);
}

/** Let queued promise callbacks (the getConfig effect) settle. */
async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

/** The component always talks to the RPC through this prop.
 *  Mirrors the real client wrapper: unwrap the { ok, value } envelope and throw
 *  on failure, so the component sees the same shapes it does in production. */
const rpcCall = async (method, payload) => {
  const result = await ctx.connection.rpc.call('channel', method, payload);
  if (result && result.ok === true) return result.value;
  throw new Error(result?.error?.message || '请求失败');
};

/** Walk the tree collecting elements matching a predicate. */
function findAll(node, predicate, out = []) {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out);
    return out;
  }
  if (predicate(node)) out.push(node);
  for (const child of node.children ?? []) findAll(child, predicate, out);
  return out;
}

const isInput = (node) => node.type === 'input';
const labelOf = (tree, text) => findAll(tree, (n) => n.type === 'span' && n.children?.[0] === text)[0];

// --- default render -------------------------------------------------------
let tree = render({ rpcCall });
check('renders the panel heading', findAll(tree, (n) => n.type === 'h2')[0]?.children[0] === 'TypeSafe Jev 设置');
const proxyLabel = labelOf(tree, '代理地址');
check('renders a 代理地址 label', proxyLabel !== undefined);
const proxyInput = findAll(tree, isInput)[2];
check('renders a proxy input', proxyInput !== undefined && proxyInput.props.type === 'text', JSON.stringify(proxyInput && proxyInput.props));
check('the proxy input starts empty (direct connection)', proxyInput.props.value === '', JSON.stringify(proxyInput.props.value));
check('the proxy input is enabled by default', proxyInput.props.disabled === false, String(proxyInput.props.disabled));
check('the proxy input offers a placeholder', typeof proxyInput.props.placeholder === 'string' && proxyInput.props.placeholder.includes('http://'), String(proxyInput.props.placeholder));
const hint = findAll(tree, (n) => n.type === 'p' && String(n.children[0] ?? '').includes('留空表示直连'))[0];
check('the hint explains that an empty value means direct', hint !== undefined);

// typing into the field updates state
proxyInput.props.onChange({ target: { value: 'http://127.0.0.1:7890' } });
tree = render({ rpcCall });
check('typing updates the proxy input value', findAll(tree, isInput)[2].props.value === 'http://127.0.0.1:7890', findAll(tree, isInput)[2].props.value);

// --- save sends the proxy -------------------------------------------------
const saveButton = findAll(tree, (n) => n.type === 'button' && n.children?.[0] === '保存设置')[0];
check('renders the save button', saveButton !== undefined);
ctx.lastCall = null;
await saveButton.props.onClick();
check('save sends the typed proxy', ctx.lastCall?.method === 'saveConfig' && ctx.lastCall.payload.proxy === 'http://127.0.0.1:7890', JSON.stringify(ctx.lastCall));

// --- test sends the proxy -------------------------------------------------
tree = render({ rpcCall });
const testButton = findAll(tree, (n) => n.type === 'button' && n.children?.[0] === '测试连接')[0];
check('renders the test button', testButton !== undefined);
ctx.lastCall = null;
ctx.rpcResult = { ok: true, value: { durationMs: 42 } };
await testButton.props.onClick();
check('test sends the typed proxy', ctx.lastCall?.method === 'testConnection' && ctx.lastCall.payload.proxy === 'http://127.0.0.1:7890', JSON.stringify(ctx.lastCall));

// --- getConfig populates the field, and reports the route used ------------
ctx.rpcResult = { ok: true, value: { apiKey: 'ts-abc...1234', model: 'jev-latest', proxy: 'http://user:***@127.0.0.1:7890', proxyLocked: false } };
tree = render({ rpcCall });
await effectCleanups[0]();
await flush();
tree = render({ rpcCall });
check('getConfig populates the proxy field', findAll(tree, isInput)[2].props.value === 'http://user:***@127.0.0.1:7890', findAll(tree, isInput)[2].props.value);
check('a locked proxy is reported as unlocked here', findAll(tree, isInput)[2].props.disabled === false);

// --- a config-pinned proxy disables the field -----------------------------
ctx.rpcResult = { ok: true, value: { configured: true, apiKey: 'ts-abc...1234', model: 'jev-latest', proxy: 'http://127.0.0.1:7890', proxyLocked: true } };
tree = render({ rpcCall });
await effectCleanups[0]();
await flush();
tree = render({ rpcCall });
check('a config-pinned proxy disables the input', findAll(tree, isInput)[2].props.disabled === true, String(findAll(tree, isInput)[2].props.disabled));
const lockedHint = findAll(tree, (n) => n.type === 'p' && String(n.children[0] ?? '').includes('已由插件配置'))[0];
check('the hint explains why the field is locked', lockedHint !== undefined);

// --- success message names the route -------------------------------------
tree = render({ rpcCall });
proxyInput.props.onChange({ target: { value: 'http://127.0.0.1:7890' } });
tree = render({ rpcCall });
ctx.rpcResult = { ok: true, value: { durationMs: 7 } };
await findAll(tree, (n) => n.type === 'button' && n.children?.[0] === '测试连接')[0].props.onClick();
tree = render({ rpcCall });
const status = findAll(tree, (n) => n.props?.className?.startsWith('jev-status'))[0];
check('a successful proxied test says it went through the proxy', String(status?.children[0] ?? '').includes('经代理'), String(status?.children[0]));

console.log('');
console.log(failures === 0 ? 'CLIENT OK' : 'CLIENT FAILED: ' + failures + ' check(s)');
process.exit(failures === 0 ? 0 : 1);
