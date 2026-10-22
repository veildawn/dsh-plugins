/**
 * 客户端包单测：验证它能被宿主的模块加载器加载、注册到正确的槽位，
 * 并且设置面板组件在最小 React 桩下可以渲染出关键字段。
 *
 * 用 vm 造一个极简的 `window.__ModuleLoader__` + React 桩，零依赖、零浏览器。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const CLIENT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'client.js');
const CLIENT_CODE = readFileSync(CLIENT_PATH, 'utf8');

/**
 * 最小 React 桩：createElement 返回带 type/props/children 的普通对象，
 * 这样可以在 Node 里遍历「虚拟树」而不需要 DOM。
 */
function makeReactStub() {
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [initial, () => {}],
    useCallback: (fn) => fn,
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
    Fragment: 'Fragment',
  };
}

/** 加载客户端包，返回它的 exports 与注册记录。 */
function loadClient({ rpcCall } = {}) {
  const registrations = [];
  const slotsInjected = [];
  const sandbox = {
    console,
    document: {
      getElementById: () => null,
      createElement: () => ({ id: '', textContent: '' }),
      head: { appendChild: () => {} },
    },
    window: {
      __ModuleLoader__: {
        load: ({ id, factory }) => {
          const moduleExports = factory((name) => (name === 'react' ? makeReactStub() : {}));
          registrations.push({ id, exports: moduleExports });
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(CLIENT_CODE, sandbox);

  const entry = registrations.find((item) => item.id === '@weniatall/dsh-im-bot');
  const ctx = {
    slots: {
      inject: (name, fn) => {
        slotsInjected.push(name);
        fn();
      },
      register: (meta, component) => {
        registrations.push({ slotMeta: meta, component });
        return () => {};
      },
    },
    connection: { rpc: { call: rpcCall ?? (async () => ({ ok: true, value: {} })) } },
  };
  entry.exports.apply(ctx);
  return { entry, registrations, slotsInjected, ctx };
}

/** vm 里创建的数组来自另一个 realm，deepEqual 会因原型不同而失败，统一转成本 realm 的值。 */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('客户端包以正确 id 注册到 ModuleLoader', () => {
  const { entry } = loadClient();
  assert.ok(entry !== undefined, '必须以 @weniatall/dsh-im-bot 注册');
  assert.equal(typeof entry.exports.apply, 'function');
  assert.deepEqual(plain(entry.exports.inject), ['slots', 'connection']);
});

test('apply 注入 settings.section 槽位并注册 im-bot 分区', () => {
  const { registrations, slotsInjected } = loadClient();
  assert.deepEqual(slotsInjected, ['settings.section']);
  const section = registrations.find((item) => item.slotMeta !== undefined);
  assert.ok(section !== undefined, '必须注册一个设置分区');
  assert.equal(section.slotMeta.name, 'settings.section');
  assert.equal(section.slotMeta.id, 'im-bot');
  assert.equal(typeof section.slotMeta.order, 'number');
  assert.equal(typeof section.slotMeta.label, 'function');
  assert.equal(typeof section.slotMeta.inject, 'function');
});

test('分区的 inject 提供 rpcCall，且 rpcCall 解包 ok/value', async () => {
  const calls = [];
  const { registrations } = loadClient({
    rpcCall: async (channel, method, payload) => {
      calls.push({ channel, method, payload });
      return { ok: true, value: { marker: 42 } };
    },
  });
  const section = registrations.find((item) => item.slotMeta !== undefined);
  const props = section.slotMeta.inject();
  assert.equal(typeof props.rpcCall, 'function');

  const value = await props.rpcCall('status', {});
  assert.deepEqual(value, { marker: 42 });
  assert.equal(calls[0].channel, '/dsh-im-bot');
  assert.equal(calls[0].method, 'status');
});

test('rpcCall 在失败时抛出带 message 的错误', async () => {
  const { registrations } = loadClient({
    rpcCall: async () => ({ ok: false, error: { code: 'x', message: '后端拒绝了' } }),
  });
  const section = registrations.find((item) => item.slotMeta !== undefined);
  const { rpcCall } = section.slotMeta.inject();
  await assert.rejects(() => rpcCall('save', {}), /后端拒绝了/);
});

test('parseList 去空、去重并支持换行与逗号', () => {
  const { entry } = loadClient();
  assert.deepEqual(plain(entry.exports.parseList('a\n b , a\n\nc')), ['a', 'b', 'c']);
  assert.deepEqual(plain(entry.exports.parseList('')), []);
  assert.deepEqual(plain(entry.exports.parseList(null)), []);
});

test('设置面板能渲染出标题与关键分区（不触达真实网络）', () => {
  const { entry } = loadClient();
  // useState 桩返回初值，loading 初值为 true，所以先渲染出读取中的占位。
  const tree = entry.exports.ImBotSettings({ rpcCall: async () => ({ ok: true, value: {} }) });
  assert.ok(tree !== null && typeof tree === 'object');

  const texts = [];
  const walk = (node) => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string' || typeof node === 'number') {
      texts.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const child of node.children ?? []) walk(child);
    // 也检查 props 里的静态文案（如 placeholder）
    for (const value of Object.values(node.props ?? {})) {
      if (typeof value === 'string') texts.push(value);
    }
  };
  walk(tree);
  assert.ok(texts.some((text) => text.includes('集成机器人')), '应出现标题「集成机器人」');
});

test('客户端样式包含隐藏宿主默认导航齿轮的规则（消除双图标）', () => {
  assert.ok(CLIENT_CODE.includes('button:has([data-settings-nav-label="im-bot"]) > svg:first-child{display:none}'),
    '必须包含隐藏宿主默认 svg 齿轮的规则');
});

test('cordis.patch.yml 必须注入 connection 与 webServer，防止 HTTP 405', () => {
  const patchPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'cordis.patch.yml');
  const patchContent = readFileSync(patchPath, 'utf8');

  // 1. insert 必须包含 inject: [webServer, connection]
  assert.ok(patchContent.includes('name: \'@weniatall/dsh-im-bot\''), 'patch 必须包含插件名称');
  assert.ok(patchContent.includes('- webServer'), 'patch 必须注入 webServer');
  assert.ok(patchContent.includes('- connection'), 'patch 必须注入 connection');
});

test('客户端样式包含渠道多选卡片网格与卡片选中样式', () => {
  assert.ok(CLIENT_CODE.includes('.imb-channel-grid'), '必须包含 .imb-channel-grid 样式');
  assert.ok(CLIENT_CODE.includes('.imb-channel-card.selected'), '必须包含 .imb-channel-card.selected 选中高亮样式');
});
