/**
 * 宿主接线冒烟测试（lib/index.js）。
 *
 * 与其它几套测试不同，这一套**会加载真实的宿主入口**：它用最小桩替换
 * `connection` / `webServer` / `settings` / `credentials` / `tools`，验证：
 *   - `apply()` 不抛错，且注册了 RPC 通道、发送路由、原生工具；
 *   - 默认配置下插件完全关闭（装完不产生任何连接）；
 *   - `status` / `save` / `diagnostics` / `bindings.*` RPC 的契约形状；
 *   - 设置写回用的是**扁平键名**（schemastery 的 volatile 约束）；
 *   - 未配置 HTTP 令牌时，发送路由返回 404 而不是 401（不暴露存在性）。
 *
 * 这里不触达任何网络：通道在默认关闭时根本不会建立连接。
 *
 * **运行前提**：`lib/index.js` 会 import `@deepseek-ai/schemastery` 等宿主包。
 * 在仓库开发态下这些包只在「装过依赖的插件目录」或「profile 目录」里可解析，
 * 所以本文件在解析失败时**跳过**而不是报错 —— 这与 `check-host-settings.mjs`
 * 「没有 dsh 就 SKIP」的策略一致，保证 `npm test` 在任何环境下都能通过。
 * 想在本地真正跑起来，用：
 *
 *   node scripts/harness-host-test.mjs plugins/dsh-im-bot
 *
 * 它会把插件复制进一个临时目录并软链宿主包，然后执行本文件。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 把状态目录指到临时位置，避免测试污染真实的 ~/.dsh/im-bot。
const STATE_ROOT = await mkdtemp(join(tmpdir(), 'dsh-im-bot-test-'));
process.env.DSH_HOME = STATE_ROOT;

/** 探测宿主入口能否被解析；不能则整组跳过。 */
let applyFn = null;
let importError = '';
try {
  const mod = await import('../lib/index.js');
  applyFn = mod.apply;
} catch (error) {
  importError = error instanceof Error ? error.message : String(error);
}

const skipReason = applyFn === null
  ? `宿主包不可解析（${importError.split('\n')[0]}）；用 scripts/harness-host-test.mjs 在隔离环境里跑`
  : undefined;

/**
 * 造一套宿主桩并挂载插件。
 * @returns {Promise<object>}
 */
async function mountPlugin(configOverride = {}) {
  const apply = applyFn;

  const rpcHandlers = new Map();
  const routes = [];
  const settingsWrites = [];
  const credentialWrites = [];
  const tools = [];

  const connection = {
    rpc: {
      handle: (channel, handler, opts) => {
        rpcHandlers.set(channel, { handler, opts });
        return () => {};
      },
    },
  };
  const webServer = {
    register: (route) => {
      routes.push(route);
      return () => {};
    },
  };
  const settings = {
    mutate: async (ns, ops) => {
      settingsWrites.push({ ns, ops });
    },
  };
  const credentials = {
    resolve: async () => undefined,
    set: async (ref, value) => {
      credentialWrites.push({ ref, value });
    },
  };

  const ctx = {
    connection,
    webServer,
    settings,
    credentials,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    /*
     * 复刻宿主 tools.register() 的强制校验：output 必须存在，且 render 必须是
     * 函数。v0.1.5 线上事故就是漏了 output 让 apply 抛错、RPC 通道没注册。
     * 桩过于宽松就测不出这类问题，所以这里按真实契约严格校验。
     */
    tools: {
      register: (definition) => {
        const output = definition?.output;
        if (output === undefined || typeof output !== 'object'
          || typeof output.render !== 'function') {
          throw new TypeError(`tool "${definition?.name}" must declare output { schema, render, presentationMeta? }`);
        }
        if (output.schema === undefined || typeof output.schema !== 'object') {
          throw new TypeError(`tool "${definition?.name}" output.schema must be a JSON Schema`);
        }
        tools.push(definition);
        return () => {};
      },
    },
    fiber: { entry: { options: { config: configOverride } } },
    get: (name) => {
      if (name === 'connection') return connection;
      if (name === 'webServer') return webServer;
      if (name === 'settings') return settings;
      if (name === 'credentials') return credentials;
      // 插件用 ctx.get('tools') 做能力探测，这里必须能取到 tools，
      // 否则 im_bot_send 不会被注册（见 host.test 的软依赖回归用例）。
      if (name === 'tools') return ctx.tools;
      return undefined;
    },
    inject: (_deps, fn) => {
      fn(ctx);
      return ctx;
    },
    effect: (fn) => fn(),
    on: () => () => {},
  };

  apply(ctx, configOverride);
  // boot() 是 fire-and-forget；等它跑完（默认关闭时几乎立刻返回）。
  await new Promise((resolve) => setTimeout(resolve, 30));

  const handler = rpcHandlers.get('/dsh-im-bot')?.handler;
  return { rpcHandlers, routes, settingsWrites, credentialWrites, tools, handler };
}

test('软依赖缺失时 apply 不得崩溃（Cordis 未注入服务会抛错）', { skip: skipReason }, async () => {
  /*
   * 这是 v0.1.4 线上事故的回归测试。
   *
   * Cordis 的 Context 代理在读取**未注入**的服务时会抛
   * `cannot get property "<name>" without inject`，而不是返回 undefined ——
   * 可选链 `ctx.tools?.register` 挡不住代理的 get 陷阱。原实现因此让整个
   * apply 抛错，插件加载失败，RPC 通道没注册，前端报 HTTP 405。
   *
   * 这里用一个「读未注入服务就抛错」的 ctx 模拟真实宿主，断言：
   *   - apply 不抛错；
   *   - 即使 tools / settings / credentials 都不可用，RPC 通道与发送路由仍然注册成功。
   */
  const apply = applyFn;

  const rpcHandlers = new Map();
  const routes = [];

  /** 只允许读取已注入的服务，其余一律抛错——与 Cordis 代理一致。 */
  const makeStrictCtx = (injected) => {
    const base = {
      fiber: { entry: { options: { config: {} } } },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      inject: (_deps, fn) => { fn(strict); return strict; },
      effect: (fn) => fn(),
      on: () => () => {},
      // 关键：get() 安全，但直接属性访问未注入服务会抛错。
      get: (name) => injected[name],
    };
    const strict = new Proxy(base, {
      get(target, prop, receiver) {
        if (prop in target) return Reflect.get(target, prop, receiver);
        if (typeof prop === 'string' && Object.hasOwn(injected, prop)) return injected[prop];
        // 模拟 Cordis：任何未注入的服务名读取都抛错。
        if (typeof prop === 'string' && /^[a-z][A-Za-z]*$/.test(prop)) {
          throw new Error(`cannot get property "${prop}" without inject`);
        }
        return undefined;
      },
    });
    return strict;
  };

  const connection = {
    rpc: {
      handle: (channel, handler) => {
        rpcHandlers.set(channel, { handler });
        return () => {};
      },
    },
  };
  const webServer = {
    register: (route) => {
      routes.push(route);
      return () => {};
    },
  };

  // 只注入 connection 与 webServer —— tools / settings / credentials 全部缺席。
  const ctx = makeStrictCtx({ connection, webServer });

  let thrown = null;
  try {
    apply(ctx, {});
  } catch (error) {
    thrown = error;
  }
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(thrown, null, `apply 不得抛错，实际：${thrown?.message}`);
  assert.ok(rpcHandlers.has('/dsh-im-bot'), '即使软依赖缺失，RPC 通道也必须注册');
  assert.ok(routes.some((route) => route.path === '/dsh-im-bot/send'), '发送路由也必须注册');
});

test.after(async () => {
  await rm(STATE_ROOT, { recursive: true, force: true });
});

test('apply 注册 RPC 通道、发送路由与原生工具', { skip: skipReason }, async () => {
  const { rpcHandlers, routes, tools } = await mountPlugin();

  const rpc = rpcHandlers.get('/dsh-im-bot');
  assert.ok(rpc !== undefined, '必须注册 /dsh-im-bot RPC 通道');
  assert.equal(rpc.opts.authority, 'trusted-host');
  assert.equal(typeof rpc.handler, 'function');

  const route = routes.find((item) => item.path === '/dsh-im-bot/send');
  assert.ok(route !== undefined, '必须注册发送路由');
  assert.equal(route.kind, 'exact');

  const tool = tools.find((item) => item.name === 'im_bot_send');
  assert.ok(tool !== undefined, '必须注册 im_bot_send 工具');
  assert.ok(Array.isArray(tool.parameters.required));
  assert.ok(tool.parameters.required.includes('text'));

  // output 是宿主强制契约：缺 render 会让 tools.register() 抛错、拖垮 apply。
  assert.ok(tool.output !== undefined, '工具必须声明 output');
  assert.equal(typeof tool.output.render, 'function', 'output.render 必须是函数');
  assert.ok(tool.output.schema !== undefined, 'output.schema 必须存在');

  // render 必须能按 schema 的字段渲染出内容块。
  const rendered = tool.output.render({ text: 'hi' }, {
    ok: true, channel: 'wecom', peer: 'C1', chars: 2,
  });
  assert.ok(Array.isArray(rendered) && rendered.length > 0, 'render 必须返回内容块');
  assert.equal(rendered[0].type, 'text');
  assert.match(rendered[0].text, /wecom/);
});

test('默认配置下插件完全关闭，不建立任何连接', { skip: skipReason }, async () => {
  const { handler } = await mountPlugin();
  const result = await handler('status', {});
  assert.equal(result.ok, true);
  assert.equal(result.value.enabled, false);
  assert.equal(result.value.channels.wecom.status, 'idle');
  assert.equal(result.value.channels.ilink.status, 'idle');
  assert.equal(result.value.credentials.wecomSecret, false);
  assert.equal(result.value.credentials.ilinkToken, false);
});

test('save 写回扁平键名（schemastery volatile 约束）', { skip: skipReason }, async () => {
  const { handler, settingsWrites } = await mountPlugin();
  const result = await handler('save', { enabled: true, wecomEnabled: true, wecomBotId: 'BOT1' });
  assert.equal(result.ok, true, JSON.stringify(result));

  assert.ok(settingsWrites.length > 0, '必须发生一次设置写入');
  const ops = settingsWrites.at(-1).ops;
  const keys = ops.map((op) => op.path[0]);
  assert.ok(keys.includes('wecomBotId'), `写入键：${keys.join(',')}`);
  assert.ok(keys.includes('enabled'));
  // 不允许出现嵌套对象键（那是被 schemastery 拒绝的形状）。
  assert.ok(!keys.includes('wecom'), '不能写嵌套的 wecom 对象');
  assert.ok(!keys.includes('ilink'), '不能写嵌套的 ilink 对象');
});

test('save 只在提供非空凭据时才写入 credentials', { skip: skipReason }, async () => {
  const { handler, credentialWrites } = await mountPlugin();
  await handler('save', { enabled: true, secrets: { wecomSecret: '', ilinkToken: 'TK' } });
  const refs = credentialWrites.map((item) => item.ref);
  assert.ok(refs.includes('DSH_IM_BOT_ILINK_TOKEN'), refs.join(','));
  assert.ok(!refs.includes('DSH_IM_BOT_WECOM_SECRET'), '空值不应覆盖已有凭据');
});

test('未知 RPC 方法返回结构化错误而不是抛错', { skip: skipReason }, async () => {
  const { handler } = await mountPlugin();
  const result = await handler('does-not-exist', {});
  assert.equal(result.ok, false);
  assert.match(result.error.message, /未知方法/);
});

test('diagnostics 报告运行时能力', { skip: skipReason }, async () => {
  const { handler } = await mountPlugin();
  const result = await handler('diagnostics', {});
  assert.equal(result.ok, true);
  assert.equal(typeof result.value.node, 'string');
  assert.equal(result.value.webSocket, typeof globalThis.WebSocket === 'function');
  assert.equal(typeof result.value.stateDir, 'string');
});

test('绑定与解绑走通', { skip: skipReason }, async () => {
  const { handler } = await mountPlugin();
  const bound = await handler('bindings.bind', { channel: 'wecom', peer: 'CHAT-X', sessionId: 'SESS-X' });
  assert.equal(bound.ok, true, JSON.stringify(bound));

  const listed = await handler('bindings.list', {});
  assert.ok(listed.value.bindings.some((item) => item.peer === 'CHAT-X'));

  const removed = await handler('bindings.remove', { channel: 'wecom', peer: 'CHAT-X' });
  assert.equal(removed.value.removed, true);
});

test('非法绑定参数被拒绝', { skip: skipReason }, async () => {
  const { handler } = await mountPlugin();
  const badChannel = await handler('bindings.bind', { channel: 'nope', peer: 'P', sessionId: 'S' });
  assert.equal(badChannel.ok, false);
  const noPeer = await handler('bindings.bind', { channel: 'wecom', peer: '', sessionId: 'S' });
  assert.equal(noPeer.ok, false);
});

test('未配置 HTTP 令牌时发送路由返回 404（不暴露存在性）', { skip: skipReason }, async () => {
  const { routes } = await mountPlugin();
  const route = routes.find((item) => item.path === '/dsh-im-bot/send');

  let statusCode = 0;
  let body = '';
  const res = {
    set statusCode(value) { statusCode = value; },
    get statusCode() { return statusCode; },
    setHeader: () => {},
    end: (chunk) => { body = chunk; },
  };
  await route.handler({ method: 'POST', headers: {} }, res);

  assert.equal(statusCode, 404);
  assert.match(body, /not-found/);
});

test('命令列表 RPC 返回全部内置命令', { skip: skipReason }, async () => {
  const { handler } = await mountPlugin();
  const result = await handler('commands', {});
  assert.equal(result.ok, true);
  for (const name of ['help', 'new', 'use', 'sessions', 'status', 'stop', 'notify']) {
    assert.ok(result.value.commands.includes(name), `缺少命令 ${name}`);
  }
  assert.match(result.value.help, /\/new/);
});
