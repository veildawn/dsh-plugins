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


/**
 * 渲染一个客户端组件，并让它 effect 里的异步 setState 真正反映到结果上。
 *
 * 为什么需要它：静态 React 桩的 useState 是死的、useEffect 也不执行，
 * reload() 里 setCommandCatalog(...) 的结果永远看不到。这里实现一个最小的
 * 重渲染循环——setState 触发重跑、effect 在渲染后执行、用 Promise 微任务收敛。
 *
 * @param {any} Component 组件函数
 * @param {object} props 组件 props
 * @param {(name: string) => any} requireFn 模块解析函数
 * @returns {Promise<any>} 最终虚拟树
 */
async function renderWithEffects(componentName, props, rpcCall) {
  /*
   * slots 必须**跨轮保留**（这就是 React 的 state 存储），每轮只把游标归零。
   * 早期写成每轮 slots.length = 0，等于每次渲染都丢掉所有 state，
   * setCommandCatalog 的结果立刻被清空，面板永远停在 loading。
   */
  const slots = [];
  let cursor = 0;
  let pending = false;
  // useCallback/useMemo 的缓存跨轮保留，游标每轮归零（与 React 的 hook 顺序一致）
  const memoSlots = [];
  let memoCursor = 0;

  /** 依赖数组浅比较。 */
  const sameDeps = (a, b) => {
    if (a === undefined || b === undefined) return false;
    if (a.length !== b.length) return false;
    return a.every((item, i) => Object.is(item, b[i]));
  };

  /** useCallback / useMemo 的缓存槽：依赖未变则复用旧值。 */
  const memoSlot = (factory, deps, invoke = false) => {
    const index = memoCursor;
    memoCursor += 1;
    const prev = memoSlots[index];
    const changed = prev === undefined || deps === undefined || !sameDeps(prev.deps, deps);
    if (changed) {
      memoSlots[index] = { deps, value: invoke ? factory() : factory };
    }
    return memoSlots[index].value;
  };

  const react = {
    createElement: (type, elProps, ...children) => ({ type, props: elProps ?? {}, children }),
    useState: (initial) => {
      const index = cursor;
      cursor += 1;
      if (index >= slots.length) slots[index] = initial;
      const setValue = (next) => {
        const resolved = typeof next === 'function' ? next(slots[index]) : next;
        if (Object.is(resolved, slots[index])) return;
        slots[index] = resolved;
        pending = true;
      };
      return [slots[index], setValue];
    },
    /*
     * useCallback / useMemo 必须**按依赖数组缓存**。
     *
     * 组件里写的是 `useEffect(() => { void reload() }, [reload])`，而
     * `reload` 来自 `useCallback(async () => {...}, [rpcCall])`。如果桩每次都返回
     * 新的函数，reload 的引用每轮都变，effect 就认为依赖变了、无限重跑，
     * 面板永远收敛不下来（也就是永远停在 loading，命令列表拿不到）。
     *
     * 这里按依赖数组浅比较决定复用旧值，与 React 的语义一致。
     */
    useCallback: (fn, deps) => memoSlot(fn, deps),
    useMemo: (fn, deps) => memoSlot(fn, deps, true),
    useRef: (initial) => {
      const index = cursor;
      cursor += 1;
      if (index >= slots.length) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect: (fn, deps) => {
      const index = cursor;
      cursor += 1;
      const prev = slots[index];
      const changed = prev === undefined || deps === undefined
        || !sameDeps(prev.deps, deps);
      if (changed) {
        slots[index] = { deps };
        react.__effects.push(fn);
      }
    },
    Fragment: 'Fragment',
    __effects: [],
  };

  /*
   * 关键：组件内部用的是闭包里的 `react`（来自 factory 的 require('react')），
   * 不接受外部传入。所以必须让 sandbox 的 require 返回上面这个 live 桩，
   * 否则组件拿到的是另一个对象，hook 状态完全对不上。
   */
  let captured = null;
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    document: {
      getElementById: () => null,
      createElement: () => ({ id: '', textContent: '' }),
      head: { appendChild: () => {} },
    },
    window: {
      __ModuleLoader__: {
        load: ({ factory }) => {
          captured = factory((name) => (name === 'react' ? react : {}));
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(CLIENT_CODE, sandbox);

  const Component = captured?.[componentName];
  if (typeof Component !== 'function') throw new Error(`未导出组件 ${componentName}`);

  let tree = null;
  // 反复「渲染 → 跑 effect → 等微任务」，直到没有新的 setState。
  for (let round = 0; round < 20; round += 1) {
    cursor = 0;
    memoCursor = 0;
    react.__effects = [];
    pending = false;
    tree = Component(props);
    for (const effect of react.__effects) effect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (pending === false) break;
  }
  return tree;
}

/** 把虚拟树里所有可见文本收集到 out（含 props 里的静态字符串）。 */
function walkTree(node, out) {
  if (node === null || node === undefined) return;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) walkTree(item, out);
    return;
  }
  for (const child of node.children ?? []) walkTree(child, out);
  for (const value of Object.values(node.props ?? {})) {
    if (typeof value === 'string') out.push(value);
  }
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

test('渠道卡片为单选（radio）且一行两列、紧凑样式', () => {
  // 一行固定两列，窄屏也保持两个
  assert.ok(CLIENT_CODE.includes('grid-template-columns:repeat(2,minmax(0,1fr))'),
    '渠道网格必须固定两列');
  // 单选而非多选
  assert.ok(CLIENT_CODE.includes("type: 'radio'"), '渠道卡片必须使用 radio（单选）');
  assert.ok(!CLIENT_CODE.includes('selectedChannels'), '不得残留多选数组状态');
  assert.ok(CLIENT_CODE.includes('name: \'imb-channel-select\''), '单选组必须有统一 name');
  // 选中高亮与独立启用开关
  assert.ok(CLIENT_CODE.includes('.imb-channel-card.selected'), '必须包含选中高亮样式');
  assert.ok(CLIENT_CODE.includes('.imb-channel-footer'), '必须包含底部独立开关区');
});

test('设置面板渲染聊天命令卡片，且命令来自服务端目录而非硬编码', async () => {
  const catalog = [
    { name: 'new', usage: '/new [标题]', summary: '新建会话并绑定到当前聊天' },
    { name: 'status', usage: '/status', summary: '查看当前绑定与运行状态' },
  ];
  /*
   * 两个约定都要对：
   *   1. 签名是 (method, payload)，不是 (channel, method)；
   *   2. 返回**纯数据**——apply 里的 rpcCall 已经把 { ok, value } 解包了，
   *      这里再包一层会让组件读到 undefined（命令列表永远空）。
   */
  const rpcCall = async (method) => {
    if (method === 'status') {
      return { enabled: true, config: {}, channels: {}, bindings: [], credentials: {} };
    }
    if (method === 'commands') return { catalog, help: '' };
    return {};
  };

  const tree = await renderWithEffects('ImBotSettings', { rpcCall }, rpcCall);

  const texts = [];
  walkTree(tree, texts);

  assert.ok(texts.some((t) => t.includes('聊天命令')), '应出现「聊天命令」卡片');
  for (const item of catalog) {
    assert.ok(texts.some((t) => t.includes(item.usage)), `缺少命令 ${item.usage}`);
    assert.ok(texts.some((t) => t.includes(item.summary)), `缺少说明 ${item.summary}`);
  }
  assert.ok(
    texts.some((t) => t.includes('不会进入模型上下文')),
    '应说明命令不消耗额度',
  );
});

test('命令目录为空时面板显示占位而不是崩溃', async () => {
  const rpcCall = async (method) => {
    if (method === 'status') {
      return { enabled: true, config: {}, channels: {}, bindings: [], credentials: {} };
    }
    if (method === 'commands') throw new Error('命令目录不可用');
    return {};
  };
  const tree = await renderWithEffects('ImBotSettings', { rpcCall }, rpcCall);
  const texts = [];
  walkTree(tree, texts);
  // commands 调用失败不应让面板崩溃，只显示占位
  assert.ok(texts.some((t) => t.includes('聊天命令')), '面板仍应渲染');
  assert.ok(texts.some((t) => t.includes('加载中')), '应显示加载占位');
});
