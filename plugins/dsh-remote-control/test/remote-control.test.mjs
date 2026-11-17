import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, get } from 'node:http'
import { networkInterfaces } from 'node:os'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import * as plugin from '../lib/index.js'
import { DEFAULT_LAN_GATEWAY_PORT, startLanGateway, startLanGateways, probePortAvailable, isPortTakenError, describeBindFailure } from '../lib/lan-gateway.js'

const {
  CONFIG_RPC_CHANNEL,
  REMOTE_CONTROL_RPC_CHANNEL,
  REMOTE_CONTROL_RPC_ALIASES,
  REMOTE_CONTROL_SECRET_REF,
  REMOTE_CONTROL_SESSION_PATH,
  internals,
} = plugin

class FakeCredentials extends Service {
  constructor(ctx) {
    super(ctx, 'credentials')
    this.store = new Map()
  }
  async resolve(ref) {
    const value = this.store.get(String(ref))
    return value === undefined ? undefined : { value, source: 'test' }
  }
  async set(ref, value) { this.store.set(String(ref), value) }
  async unset(ref) { this.store.delete(String(ref)) }
}

class MemorySettings extends SettingsProvider {
  constructor(ctx, doc = {}) {
    super(ctx)
    this.doc = structuredClone(doc)
  }
  async load() { return structuredClone(this.doc) }
  async persist(ns, section) { this.doc[ns] = structuredClone(section) }
  get writable() { return true }
}

class FakeConnection extends Service {
  constructor(ctx) {
    super(ctx, 'connection')
    this.registrations = new Map()
    this.rpc = { handle: (channel, handler, options) => {
      this.registrations.set(channel, { channel, handler, options })
      return () => this.registrations.delete(channel)
    } }
  }
}
class FakeWebServer extends Service {
  constructor(ctx) {
    super(ctx, 'webServer')
    this.taps = []
    this.routes = new Map()
  }
  tapIndex(fn) {
    this.taps.push(fn)
    return () => {
      const idx = this.taps.indexOf(fn)
      if (idx !== -1) this.taps.splice(idx, 1)
    }
  }
  register(route) {
    const key = route.kind + ':' + route.path
    if (this.routes.has(key)) throw new Error('duplicate ' + key)
    this.routes.set(key, route)
    return () => { this.routes.delete(key) }
  }
}

class FakeApiProxy extends Service {
  constructor(ctx) {
    super(ctx, 'apiProxy')
    this.calls = []
    const result = (domain, method) => async (request, signal) => {
      this.calls.push({ domain, method, request, signal })
      return { rpcId: request.rpcId, result: { ok: true, value: { domain, method, payload: request.payload } } }
    }
    this.agentPresets = {
      read: result('agentPreset', 'read'), copy: result('agentPreset', 'copy'),
      openDocument: result('agentPreset', 'openDocument'), remove: result('agentPreset', 'remove'),
    }
    this.host = { pickDirectory: result('host', 'pickDirectory'), openPath: result('host', 'openPath') }
    this.settings = {
      describe: result('settings', 'describe'), openDocument: result('settings', 'openDocument'),
      update: result('settings', 'update'), replace: result('settings', 'replace'), mutate: result('settings', 'mutate'),
    }
    this.credentials = {
      describe: result('credentials', 'describe'), set: result('credentials', 'set'), unset: result('credentials', 'unset'),
    }
    this.llm = {
      providers: result('llm', 'providers'), models: result('llm', 'models'),
      discoverModels: result('llm', 'discoverModels'),
    }
  }
}

function makeHost(doc) {
  const ctx = new Context()
  const settings = new MemorySettings(ctx, doc)
  const credentials = new FakeCredentials(ctx)
  const connection = new FakeConnection(ctx)
  const webServer = new FakeWebServer(ctx)
  const apiProxy = new FakeApiProxy(ctx)
  return { ctx, settings, credentials, connection, webServer, apiProxy }
}

/** 取一个当前空闲的端口：绑 0 拿到系统分配的端口后立刻释放。 */
async function freePort() {
  const probe = createServer()
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address()
  await new Promise((resolve) => probe.close(resolve))
  return port
}

/**
 * 等某个网关真正启动完成。
 *
 * `lanGatewayRuntime` 是模块级状态，多个用例共用一个进程时会互相覆盖，
 * 因此必须按端口认出「本次用例自己的那个网关」，不能只等「有失败」或「已启动」。
 */
async function waitForGateway(port, predicate = () => true, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const runtime = internals.lanGatewayRuntime()
    if (runtime.port === port && predicate(runtime)) return runtime
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return internals.lanGatewayRuntime()
}

/**
 * 让既有 ctx 以「桌面端 profile」的身份被检测。
 * 不能用 Object.create(ctx)：那样 `get` 会递归到自己。
 */
function desktopView(ctx) {
  return {
    get: (name) => (name === 'profileContext' ? { name: 'desktop', dir: 'C:/tmp' } : ctx.get(name)),
    settings: ctx.settings,
    fiber: ctx.fiber,
    logger: ctx.logger,
    effect: (fn) => ctx.effect(fn),
    inject: (deps, fn) => ctx.inject(deps, fn),
    on: (name, fn) => ctx.on(name, fn),
    emit: (name, ...args) => ctx.emit(name, ...args),
  }
}
test('secret comparison and resolution reject unsafe values and honor documented priority', async (t) => {
  assert.equal(internals.matchesRemoteControlSecret('secret', 'secret'), true)
  assert.equal(internals.matchesRemoteControlSecret('secret', 'Secret'), false)
  assert.equal(internals.matchesRemoteControlSecret('', ''), false)
  assert.equal(internals.matchesRemoteControlSecret('secret', undefined), false)

  const { ctx, credentials } = makeHost()
  const previous = process.env[REMOTE_CONTROL_SECRET_REF]
  t.after(() => {
    if (previous === undefined) delete process.env[REMOTE_CONTROL_SECRET_REF]
    else process.env[REMOTE_CONTROL_SECRET_REF] = previous
  })
  process.env[REMOTE_CONTROL_SECRET_REF] = 'environment-secret'
  assert.equal(await internals.remoteControlSecret(ctx, () => ({ secret: 'config-secret' })), 'environment-secret')
  credentials.store.set(REMOTE_CONTROL_SECRET_REF, 'credential-secret')
  assert.equal(await internals.remoteControlSecret(ctx, () => ({ secret: 'config-secret' })), 'credential-secret')
  credentials.store.clear()
  delete process.env[REMOTE_CONTROL_SECRET_REF]
  assert.equal(await internals.remoteControlSecret(ctx, () => ({ secret: 'config-secret' })), 'config-secret')
})

test('Host registers a loopback config channel plus primary and compatible remote channels', async () => {
  const { ctx, connection, webServer } = makeHost()
  await ctx.plugin(plugin).await()
  assert.deepEqual([...connection.registrations.keys()], [
    CONFIG_RPC_CHANNEL,
    REMOTE_CONTROL_RPC_CHANNEL,
    ...REMOTE_CONTROL_RPC_ALIASES,
  ])
  assert.deepEqual(connection.registrations.get(CONFIG_RPC_CHANNEL).options, { authority: 'loopback' })
  for (const channel of [REMOTE_CONTROL_RPC_CHANNEL, ...REMOTE_CONTROL_RPC_ALIASES]) {
    assert.deepEqual(connection.registrations.get(channel).options, { authority: 'trusted-host' })
  }
  const transformed = webServer.taps.reduce((html, tap) => tap(html), '<html><head><title>Test</title></head><body></body></html>')
  assert(transformed.includes('randomUUID'), 'webServer indexTap injects crypto.randomUUID polyfill')
})
test('configuration is local-only and authenticated calls use a fixed allowlist', async () => {
  const { ctx, connection, credentials, settings, apiProxy } = makeHost()
  await ctx.plugin(plugin).await()
  const configure = connection.registrations.get(CONFIG_RPC_CHANNEL).handler
  const remote = connection.registrations.get(REMOTE_CONTROL_RPC_CHANNEL).handler
  const alias = connection.registrations.get(REMOTE_CONTROL_RPC_ALIASES[0]).handler

  const checkConfigValue = (result, expected) => {
    assert.equal(result.ok, true)
    assert.equal(result.value.enabled, expected.enabled)
    assert.equal(result.value.secretConfigured, expected.secretConfigured)
    assert('lanIps' in result.value)
    assert('host' in result.value)
  }

  checkConfigValue(await configure('status', {}), { enabled: false, secretConfigured: false })
  assert.equal((await configure('setEnabled', { enabled: 'yes' })).ok, false)
  assert.equal((await configure('setSecret', { secret: 'remote-test', extra: true })).ok, false)
  checkConfigValue(await configure('setSecret', { secret: '  remote-test  ' }), { enabled: false, secretConfigured: true })
  assert.equal(credentials.store.get(REMOTE_CONTROL_SECRET_REF), 'remote-test')
  checkConfigValue(await configure('setEnabled', { enabled: true }), { enabled: true, secretConfigured: true })
  assert.equal(settings.doc['remote-control'].enabled, true)

  const remoteStatus = await remote('status', { token: 'remote-test' })
  assert.equal(remoteStatus.ok, true)
  assert.equal(remoteStatus.value.enabled, true)
  assert.equal(remoteStatus.value.secretConfigured, true)
  assert.equal(remoteStatus.value.authenticated, true)
  assert('lanIps' in remoteStatus.value)
  assert.equal((await remote('call', { token: 'wrong', method: 'settings.describe', payload: {} })).ok, false)
  assert.equal((await remote('call', { token: 'remote-test', method: 'toString', payload: {} })).ok, false)
  assert.equal((await remote('call', { token: 'remote-test', method: 'settings.describe', payload: {}, extra: true })).ok, false)
  assert.deepEqual(await remote('call', { token: 'remote-test', method: 'settings.describe', payload: {} }), {
    ok: true, value: { domain: 'settings', method: 'describe', payload: {} },
  })
  assert.deepEqual(await remote('call', { token: 'remote-test', method: 'llm.providers', payload: {} }), {
    ok: true, value: { domain: 'llm', method: 'providers', payload: {} },
  })
  assert.deepEqual(await remote('call', { token: 'remote-test', method: 'llm.models', payload: { provider: 'x' } }), {
    ok: true, value: { domain: 'llm', method: 'models', payload: { provider: 'x' } },
  })
  assert.deepEqual(await alias('call', { token: 'remote-test', method: 'llm.discoverModels', payload: { provider: 'x' } }), {
    ok: true, value: { domain: 'llm', method: 'discoverModels', payload: { provider: 'x' } },
  })
  assert.deepEqual(apiProxy.calls.map(({ domain, method }) => ({ domain, method })), [
    { domain: 'settings', method: 'describe' },
    { domain: 'llm', method: 'providers' },
    { domain: 'llm', method: 'models' },
    { domain: 'llm', method: 'discoverModels' },
  ])
  checkConfigValue(await configure('setSecret', { secret: '' }), { enabled: true, secretConfigured: false })
  assert.equal(credentials.store.has(REMOTE_CONTROL_SECRET_REF), false)
  assert.equal((await remote('call', { token: 'remote-test', method: 'settings.describe', payload: {} })).ok, false)
})

test('index passthrough and 401 bypass are gated on enabled and limited to remote-control RPC', async () => {
  assert.equal(internals.isRemoteControlRpcPath('/dsh-remote-control'), true)
  assert.equal(internals.isRemoteControlRpcPath('/dsh-remote-control/status'), true)
  assert.equal(internals.isRemoteControlRpcPath('/ai-proxy-remote-control'), true)
  assert.equal(internals.isRemoteControlRpcPath('/dsh-remote-control-config'), false)
  assert.equal(internals.isRemoteControlRpcPath('/api'), false)
  assert.equal(internals.isRemoteControlRpcPath('/dsh-remote-control-extra'), false)

  assert.equal(internals.shouldServeUnauthenticatedIndex({ method: 'GET', url: '/' }, true, false), true)
  assert.equal(internals.shouldServeUnauthenticatedIndex({ method: 'HEAD', url: '/index.html' }, true, false), true)
  assert.equal(internals.shouldServeUnauthenticatedIndex({ method: 'GET', url: '/' }, false, false), false)
  assert.equal(internals.shouldServeUnauthenticatedIndex({ method: 'GET', url: '/' }, true, true), false)
  assert.equal(internals.shouldServeUnauthenticatedIndex({ method: 'GET', url: '/?token=abc' }, true, false), false)
  assert.equal(internals.shouldServeUnauthenticatedIndex({ method: 'POST', url: '/' }, true, false), false)
  assert.equal(internals.shouldServeUnauthenticatedIndex(
    { method: 'GET', url: '/', headers: { host: '192.168.1.128:3080' } }, true, false,
  ), true, 'a remote host with no session still loads the lock screen')
  assert.equal(internals.shouldServeUnauthenticatedIndex(
    { method: 'GET', url: '/', headers: { host: '127.0.0.1:3080' } }, true, false,
  ), false, 'a loopback browser keeps the stock 401 and its token URL hint')
  // 局域网网关把 Host 折成回环，但原始 authority 在标记头里，仍要下发锁屏页
  assert.equal(internals.shouldServeUnauthenticatedIndex(
    { method: 'GET', url: '/', headers: { host: '127.0.0.1:4385', 'x-dsh-lan-origin': '192.168.50.108:3080' } }, true, false,
  ), true, 'gateway requests must still get the lock screen, not the stock 401')
  assert.equal(internals.shouldServeUnauthenticatedIndex(
    { method: 'GET', url: '/', headers: new Headers({ host: 'localhost:3080' }) }, true, false,
  ), false, 'Headers-like carriers classify the same way')
  assert.equal(internals.isLoopbackHostHeader('localhost'), true)
  assert.equal(internals.isLoopbackHostHeader('[::1]:3080'), true)
  assert.equal(internals.isLoopbackHostHeader('192.168.1.128:3080'), false)

  assert.equal(internals.shouldBypassBrowserAuthRejection({ url: '/dsh-remote-control' }, true), true)
  assert.equal(internals.shouldBypassBrowserAuthRejection({ url: '/ai-proxy-remote-control' }, true), true)
  assert.equal(internals.shouldBypassBrowserAuthRejection({ url: '/dsh-remote-control' }, false), false)
  assert.equal(internals.shouldBypassBrowserAuthRejection({ url: '/api' }, true), false)
  assert.equal(internals.shouldBypassBrowserAuthRejection({ url: '/dsh-remote-control-config' }, true), false)

  const { ctx, connection } = makeHost()
  let isAuthenticatedValue = false
  connection.browserAuth = {
    isAuthenticated: () => isAuthenticatedValue,
    launchToken: 'test-launch-token-1234',
  }
  let origAuthorizeIndexCalled = 0
  connection.authorizeIndex = (req, res) => {
    origAuthorizeIndexCalled++
    const url = new URL(req.url ?? '/', 'http://dsh.invalid')
    if (url.searchParams.has('token')) {
      res.writeHead(url.searchParams.get('token') ? 303 : 401, { location: '/' })
      res.end()
      return false
    }
    if (isAuthenticatedValue) return true
    res.writeHead(401)
    res.end()
    return false
  }
  connection.requestRejection = (req) => {
    const url = new URL(req.url ?? '/', 'http://dsh.invalid')
    if (url.searchParams.get('trust') === 'no') return 403
    return 401
  }
  connection.admit = (req) => {
    const rej = connection.requestRejection(req)
    if (rej !== undefined) return { rejection: rej }
    return { peer: connection.browserPeer }
  }
  connection.browserPeer = { id: 'browser-peer' }

  await ctx.plugin(plugin).await()
  const configure = connection.registrations.get(CONFIG_RPC_CHANNEL).handler
  const mockRes = () => ({ writeHead() {}, end() {} })

  assert.equal(connection.authorizeIndex({ method: 'GET', url: '/' }, mockRes()), false)
  assert.equal(origAuthorizeIndexCalled, 1, 'disabled install keeps native 401 on GET /')
  assert.equal(connection.requestRejection({ url: '/dsh-remote-control' }), 401)
  assert.equal(connection.requestRejection({ url: '/api' }), 401)

  const enabledResult = await configure('setEnabled', { enabled: true })
  assert.equal(enabledResult.ok, true)
  assert.equal(enabledResult.value.enabled, true)
  assert.equal(enabledResult.value.secretConfigured, false)
  assert('lanIps' in enabledResult.value)
  origAuthorizeIndexCalled = 0

  assert.equal(connection.authorizeIndex({ method: 'GET', url: '/' }, mockRes()), true)
  assert.equal(connection.authorizeIndex({ method: 'HEAD', url: '/index.html' }, mockRes()), true)
  assert.equal(origAuthorizeIndexCalled, 0, 'enabled unauthenticated index does not 303')

  assert.equal(connection.authorizeIndex({ method: 'GET', url: '/?token=test-launch-token-1234' }, mockRes()), false)
  assert.equal(origAuthorizeIndexCalled, 1, 'explicit launch token still uses native exchange')
  assert.equal(connection.authorizeIndex({ method: 'GET', url: '/?token=' }, mockRes()), false)
  assert.equal(origAuthorizeIndexCalled, 2)

  isAuthenticatedValue = true
  assert.equal(connection.authorizeIndex({ method: 'GET', url: '/' }, mockRes()), true)
  assert.equal(origAuthorizeIndexCalled, 3, 'authenticated index stays on the native path')
  isAuthenticatedValue = false

  assert.equal(connection.requestRejection({ url: '/dsh-remote-control' }), undefined)
  assert.equal(connection.requestRejection({ url: '/ai-proxy-remote-control' }), undefined)
  assert.equal(connection.requestRejection({ url: '/api' }), 401, '/api still requires the browser cookie')
  assert.equal(connection.requestRejection({ url: '/dsh-remote-control-config' }), 401)
  assert.equal(connection.requestRejection({ url: '/dsh-remote-control?trust=no' }), 403)

  // Verify connection.admit bypasses 401 for remote-control RPC channels
  assert.deepEqual(connection.admit({ url: '/dsh-remote-control' }), { peer: connection.browserPeer })
  assert.deepEqual(connection.admit({ url: '/ai-proxy-remote-control' }), { peer: connection.browserPeer })
  assert.deepEqual(connection.admit({ url: '/api' }), { rejection: 401 })
  assert.deepEqual(connection.admit({ url: '/dsh-remote-control?trust=no' }), { rejection: 403 })
})

// Browser session handshake -------------------------------------------------

const SESSION_COOKIE = 'dsh-auth-hash=signature; Max-Age=1; Path=/; HttpOnly; SameSite=Strict'

function makeSessionHost({ authenticated = false, launchToken = 'launch-token-1', fence = 401 } = {}) {
  const host = makeHost()
  host.credentials.store.set(REMOTE_CONTROL_SECRET_REF, 'remote-test')
  host.connection.browserAuth = { launchToken, isAuthenticated: () => authenticated }
  host.connection.requestRejection = () => fence
  return host
}

/** Record the synthetic native exchange and answer it like Connection would. */
function recordExchange(connection, minted = SESSION_COOKIE) {
  const exchanges = []
  connection.authorizeIndex = (request, response) => {
    exchanges.push(request)
    if (new URL(request.url, 'http://dsh.invalid').searchParams.get('token') !== 'launch-token-1') {
      response.writeHead(401)
      response.end()
      return false
    }
    response.writeHead(303, { 'set-cookie': minted })
    response.end()
    return false
  }
  return exchanges
}

test('the session handshake mints the official browser cookie for the shared secret', async () => {
  const { ctx, connection } = makeSessionHost()
  const exchanges = recordExchange(connection)
  await ctx.plugin(plugin).await()
  const options = () => ({ enabled: true, secret: 'remote-test' })
  const request = { method: 'POST', headers: { host: '192.168.1.128:3080' } }

  assert.deepEqual(await internals.handleSessionRequest(ctx, options, request, { token: 'remote-test' }), {
    status: 200,
    headers: { 'set-cookie': SESSION_COOKIE },
    body: '{"ok":true,"minted":true}',
  })
  assert.equal(exchanges.length, 1)
  assert.equal(exchanges[0].method, 'GET')
  assert.equal(exchanges[0].headers.host, '192.168.1.128:3080', 'the exchange keeps the caller authority')
  assert.equal(new URL(exchanges[0].url, 'http://dsh.invalid').searchParams.get('token'), 'launch-token-1')
})

test('the session handshake refuses everything but the shared secret', async () => {
  const { ctx, connection } = makeSessionHost()
  const exchanges = recordExchange(connection)
  await ctx.plugin(plugin).await()
  const enabled = () => ({ enabled: true, secret: 'remote-test' })
  const request = { method: 'POST', headers: { host: '192.168.1.128:3080' } }
  const unauthorized = {
    status: 401,
    body: JSON.stringify({ ok: false, error: { code: 'unauthorized', message: '远程控制认证失败', details: {} } }),
  }

  assert.deepEqual(await internals.handleSessionRequest(ctx, enabled, request, { token: 'wrong' }), unauthorized)
  assert.deepEqual(await internals.handleSessionRequest(ctx, enabled, request, {}), unauthorized)
  assert.deepEqual(await internals.handleSessionRequest(ctx, enabled, request, undefined), unauthorized)
  assert.deepEqual(await internals.handleSessionRequest(ctx, () => ({ enabled: false, secret: 'remote-test' }), request, { token: 'remote-test' }), {
    status: 403,
    body: JSON.stringify({ ok: false, error: { code: 'forbidden', message: '远程控制未在宿主机启用', details: {} } }),
  })
  assert.deepEqual(await internals.handleSessionRequest(ctx, enabled, { ...request, method: 'GET' }, {}), {
    status: 405,
    headers: { allow: 'POST, DELETE' },
    body: JSON.stringify({ ok: false, error: { code: 'method-not-allowed', message: 'Remote Control session requests must be POST or DELETE', details: {} } }),
  })
  assert.equal(exchanges.length, 0, 'no refusal reaches the native exchange')
})

test('an untrusted authority is fenced out before the secret is compared', async () => {
  const { ctx, connection } = makeSessionHost({ fence: 403 })
  const exchanges = recordExchange(connection)
  await ctx.plugin(plugin).await()
  const request = { method: 'POST', headers: { host: 'evil.example.com' } }

  assert.deepEqual(await internals.handleSessionRequest(ctx, () => ({ enabled: true, secret: 'remote-test' }), request, { token: 'remote-test' }), {
    status: 403,
    body: JSON.stringify({ ok: false, error: { code: 'forbidden', message: 'Remote Control session requests require a trusted host', details: {} } }),
  })
  assert.equal(exchanges.length, 0)
})

test('an existing session is kept and an unminteable host is reported', async () => {
  const authenticated = makeSessionHost({ authenticated: true })
  const authenticatedExchanges = recordExchange(authenticated.connection)
  await authenticated.ctx.plugin(plugin).await()
  const options = () => ({ enabled: true, secret: 'remote-test' })
  const request = { method: 'POST', headers: { host: '192.168.1.128:3080' } }
  assert.deepEqual(await internals.handleSessionRequest(authenticated.ctx, options, request, { token: 'remote-test' }), {
    status: 200,
    body: '{"ok":true,"minted":false}',
  })
  assert.equal(authenticatedExchanges.length, 0, 'a live session is never re-minted')

  const legacy = makeSessionHost({ launchToken: null })
  recordExchange(legacy.connection)
  await legacy.ctx.plugin(plugin).await()
  assert.deepEqual(await internals.handleSessionRequest(legacy.ctx, options, request, { token: 'remote-test' }), {
    status: 503,
    body: JSON.stringify({
      ok: false,
      error: {
        code: 'unavailable',
        message: 'Host 无法签发浏览器会话，请改用 dsh web 打印的带 token 链接访问',
        details: {},
      },
    }),
  })
})

test('DELETE drops the session cookie the browser carried', async () => {
  const { ctx, connection } = makeSessionHost()
  const exchanges = recordExchange(connection)
  await ctx.plugin(plugin).await()
  const options = () => ({ enabled: true, secret: 'remote-test' })
  const headers = { host: '192.168.1.128:3080', cookie: 'other=1; dsh-auth-hash=signature' }

  const cleared = await internals.handleSessionRequest(ctx, options, { method: 'DELETE', headers }, { token: 'remote-test' })
  assert.equal(cleared.status, 204)
  assert.match(cleared.headers['set-cookie'], /^dsh-auth-hash=; Path=\/; Max-Age=0;/)
  assert.equal(exchanges.length, 0)

  assert.deepEqual(
    await internals.handleSessionRequest(ctx, options, { method: 'DELETE', headers: { host: '192.168.1.128:3080' } }, { token: 'remote-test' }),
    { status: 204 },
  )
})

test('Host registers one exact session route that owns its response', async () => {
  const { ctx, connection, webServer } = makeSessionHost()
  recordExchange(connection)
  await ctx.plugin(plugin).await()
  await connection.registrations.get(CONFIG_RPC_CHANNEL).handler('setEnabled', { enabled: true })
  const route = webServer.routes.get('exact:' + REMOTE_CONTROL_SESSION_PATH)
  assert(route, 'the session route is an exact route so the SPA fallback never claims it')

  const response = {
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body) { this.body = body },
  }
  await route.handler({
    method: 'POST',
    url: REMOTE_CONTROL_SESSION_PATH,
    headers: { host: '192.168.1.128:3080' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ token: 'remote-test' })) },
  }, response)

  assert.equal(response.status, 200)
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal(response.headers['set-cookie'], SESSION_COOKIE)
  assert.equal(response.body, '{"ok":true,"minted":true}')
})

// Browser bundle harness ---------------------------------------------------

let definition
const previousWindow = globalThis.window
const previousCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
let randomByte = 0
Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: { getRandomValues: (bytes) => bytes.fill(randomByte++ & 255) },
})
globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
await import('../lib/client.js')
globalThis.window = previousWindow
const polyfilledUUID = globalThis.crypto.randomUUID()
if (previousCrypto) Object.defineProperty(globalThis, 'crypto', previousCrypto)
else delete globalThis.crypto

test('Client polyfills crypto.randomUUID in insecure contexts', () => {
  assert.match(polyfilledUUID, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
}

let hooks = []
let refs = []
let effects = []
let fetchCalls = []
let fetchHandler = async () => ({ status: 200, ok: true, json: async () => ({ ok: true, minted: false }) })
const previousFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  fetchCalls.push({ input: String(input), method: init?.method, body: init?.body })
  return fetchHandler(input, init)
}
let hookIndex = 0
let effectIndex = 0
const react = {
  useState(initial) {
    const slot = hookIndex++
    if (hooks[slot] === undefined) hooks[slot] = typeof initial === 'function' ? initial() : initial
    return [hooks[slot], (next) => { hooks[slot] = typeof next === 'function' ? next(hooks[slot]) : next }]
  },
  useEffect(effect, deps) {
    const slot = effectIndex++
    const previous = effects[slot]
    if (previous && deps?.every((value, index) => Object.is(value, previous.deps?.[index]))) return
    previous?.cleanup?.()
    effects[slot] = { deps, cleanup: effect() }
  },
  useRef(initial) {
    // 每个 hook 槽位持有一个稳定的盒子：跨渲染必须是同一个对象，否则
    // “卸载后不再回写状态”这条守卫会在测试里永远为真而测不出问题。
    const slot = hookIndex++
    if (refs[slot] === undefined) refs[slot] = { current: initial }
    return refs[slot]
  },
  createElement: (type, props, ...children) => {
    const flat = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false)
    return { type, props: { ...props, children: flat.length === 1 ? flat[0] : flat } }
  },
}
const BrandWordmark = (props) => react.createElement('svg', props)
const IconGlobeOutline14 = (props) => react.createElement('svg', props)
const clientPlugin = definition.factory((id) => {
  if (id === 'react') return react
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return { BrandWordmark, IconGlobeOutline14 }
  assert.fail('unexpected browser dependency: ' + id)
})

class SlotsService extends Service {
  constructor(ctx) {
    super(ctx, 'slots')
    this.registrations = []
  }
  /**
   * Stand-in for the host registry's declaration-lifetime seam.
   *
   * The real `ctx.slots.inject` runs the callback once per declaration lifetime
   * and installs an iterable callback transactionally (disposers unwound in
   * reverse on teardown). Registrations that nest three `inject` calls — as the
   * directory-flow holes do — therefore only appear if this stub expands the
   * generator the callback returns.
   */
  inject(_name, install) {
    const effect = install()
    if (effect === null || typeof effect !== 'object' || typeof effect[Symbol.iterator] !== 'function') {
      return effect
    }
    const disposers = []
    for (const disposer of effect) {
      disposers.push(disposer)
    }
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }
  register(entry, component) {
    const registration = { entry, component }
    this.registrations.push(registration)
    return () => { this.registrations = this.registrations.filter((item) => item !== registration) }
  }
}

class BrowserConnection extends Service {
  constructor(ctx) {
    super(ctx, 'connection')
    this.calls = []
    this.api = {
      settings: { describe: async () => { throw new Error('transport failure: HTTP 403') } },
      credentials: {}, agentPresets: {}, host: {},
      llm: {
        providers: async () => { throw new Error('transport failure: HTTP 403') },
        models: async () => { throw new Error('transport failure: HTTP 403') },
        discoverModels: async () => { throw new Error('transport failure: HTTP 403') },
      },
    }
    this.rpc = { call: async (channel, method, payload) => {
      this.calls.push({ channel, method, payload })
      if (channel === CONFIG_RPC_CHANNEL) {
        return { ok: true, value: { enabled: payload.enabled ?? false, secretConfigured: method === 'setSecret' } }
      }
      if (channel === REMOTE_CONTROL_RPC_CHANNEL && method === 'status') {
        return { ok: true, value: { enabled: true, secretConfigured: true, authenticated: payload.token === 'remote-test' } }
      }
      if (channel === REMOTE_CONTROL_RPC_CHANNEL && method === 'call') {
        return { ok: true, value: { proxied: payload.method } }
      }
      return { ok: false, error: { message: 'unexpected request' } }
    } }
  }
}

function resetBrowser() {
  hooks = []
  refs = []
  effects = []
  fetchCalls = []
  fetchHandler = async () => ({ status: 200, ok: true, json: async () => ({ ok: true, minted: false }) })
}

function render(component, props = {}) {
  hookIndex = 0
  effectIndex = 0
  return component(props)
}

/**
 * 对话框当前所在路径。路径栏是可编辑 input，路径落在它的 value 上。
 * @param tree - 渲染树。
 * @returns 当前路径文本，未渲染时为 undefined。
 */
function dialogPath(tree) {
  return findElement(tree, (node) => node?.props?.['aria-label'] === '目录路径')?.props?.value
}

/**
 * 收集树里所有满足谓词的节点。
 *
 * `children` 在只有一个孩子时是单对象而不是数组（见 react.createElement 桩），
 * 所以每个节点都必须两种形态都处理，否则遍历会在第一个「独生子」处断掉。
 * @param node - 渲染树根。
 * @param predicate - 匹配条件。
 * @returns 匹配到的节点数组。
 */
function findAll(node, predicate) {
  const found = []
  const walk = (current) => {
    if (!current || typeof current !== 'object') return
    if (predicate(current)) found.push(current)
    const children = Array.isArray(current?.props?.children)
      ? current.props.children
      : current?.props?.children !== undefined ? [current.props.children] : []
    for (const child of children) walk(child)
  }
  walk(node)
  return found
}

function findElement(node, predicate) {
  if (!node) return undefined
  if (predicate(node)) return node
  const children = Array.isArray(node?.props?.children)
    ? node.props.children
    : node?.props?.children
      ? [node.props.children]
      : []
  for (const child of children) {
    const found = findElement(child, predicate)
    if (found) return found
  }
}

test('local browser registers settings without a lock screen', async () => {
  const previousLocation = globalThis.location
  globalThis.location = { hostname: 'localhost', host: 'localhost:3080' }
  storage.clear()
  resetBrowser()
  try {
    const ctx = new Context()
    const slots = new SlotsService(ctx)
    const connection = new BrowserConnection(ctx)
    await ctx.plugin(clientPlugin).await()
    assert.equal(slots.registrations.some((item) => item.entry.name === 'root'), false)
    const section = slots.registrations.find((item) => item.entry.name === 'settings.section' && item.entry.id === 'remote-control')
    assert(section)
    assert.equal(section.entry.order, 26)
    // 图标走 settings.section.icon，label 只放文本：0.2.x 外壳会渲染自己的默认
    // 图标容器，若 label 还内嵌图形就会叠成双图标。
    assert.equal(section.entry.label(), '远程控制')
    const icon = slots.registrations.find((item) => item.entry.name === 'settings.section.icon')
    assert(icon)
    assert.equal(icon.entry.id, 'remote-control')
    assert(findElement(icon.component({ size: 16 }), (node) => node?.type === IconGlobeOutline14))
    render(section.component, section.entry.inject())
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(connection.calls, [{ channel: CONFIG_RPC_CHANNEL, method: 'status', payload: {} }])
  } finally {
    globalThis.location = previousLocation
  }
})

test('desktop electron client recognizes dsh-app protocol and app hostname without a lock screen', async () => {
  const previousLocation = globalThis.location
  globalThis.location = { protocol: 'dsh-app:', hostname: 'app', host: 'app' }
  storage.clear()
  resetBrowser()
  try {
    const ctx = new Context()
    const slots = new SlotsService(ctx)
    new BrowserConnection(ctx)
    await ctx.plugin(clientPlugin).await()
    // 桌面端不应注册根路径的全屏锁屏 gate
    assert.equal(slots.registrations.some((item) => item.entry.name === 'root'), false)
  } finally {
    globalThis.location = previousLocation
  }
})

test('remote Unlock Screen authenticates, stores the secret and redirects privileged APIs', async () => {
  const previousLocation = globalThis.location
  globalThis.location = { hostname: 'remote.example', host: 'remote.example' }
  storage.clear()
  resetBrowser()
  try {
    const ctx = new Context()
    const slots = new SlotsService(ctx)
    const connection = new BrowserConnection(ctx)
    await ctx.plugin(clientPlugin).await()
    const gate = slots.registrations.find((item) => item.entry.name === 'root')
    assert(gate)
    assert.equal(gate.entry.priority, -100)
    assert.equal(connection.calls.length, 0)

    let view = render(gate.component)
    assert(findElement(view, (node) => node?.type === 'h1' && node.props.children.includes('远程工作区已锁定')))
    assert(findElement(view, (node) => node?.type === BrandWordmark))
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(connection.calls, [{
      channel: REMOTE_CONTROL_RPC_CHANNEL, method: 'status', payload: { token: '' },
    }])

    view = render(gate.component)
    findElement(view, (node) => node?.props?.['aria-label'] === '远程访问密钥').props.onChange({ target: { value: 'remote-test' } })
    view = render(gate.component)
    findElement(view, (node) => node?.type === 'form').props.onSubmit({ preventDefault() {} })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(slots.registrations.some((item) => item.entry.name === 'root'), false)
    assert.equal(storage.get('dsh-remote-control.secret'), 'remote-test')
    assert.deepEqual(fetchCalls, [{
      input: REMOTE_CONTROL_SESSION_PATH, method: 'POST', body: JSON.stringify({ token: 'remote-test' }),
    }], 'unlock completes the host browser session before restoring the workspace')

    assert.deepEqual(await connection.api.settings.describe({}), {
      rpcId: 'remote-control', result: { ok: true, value: { proxied: 'settings.describe' } },
    })
    assert.deepEqual(connection.calls.at(-1), {
      channel: REMOTE_CONTROL_RPC_CHANNEL,
      method: 'call',
      payload: { method: 'settings.describe', payload: {}, token: 'remote-test' },
    })
    for (const method of ['providers', 'models', 'discoverModels']) {
      assert.deepEqual(await connection.api.llm[method]({}), {
        rpcId: 'remote-control', result: { ok: true, value: { proxied: 'llm.' + method } },
      })
    }
  } finally {
    globalThis.location = previousLocation
  }
})

test('a legacy browser secret migrates to the independent storage key', async () => {
  const previousLocation = globalThis.location
  globalThis.location = { hostname: 'remote.example', host: 'remote.example' }
  storage.clear()
  storage.set('dsh-ai-proxy.remote-control-secret', 'remote-test')
  resetBrowser()
  try {
    const ctx = new Context()
    const slots = new SlotsService(ctx)
    new BrowserConnection(ctx)
    await ctx.plugin(clientPlugin).await()
    const gate = slots.registrations.find((item) => item.entry.name === 'root')
    assert(gate, 'stored secrets are verified before the application root is restored')
    render(gate.component)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(slots.registrations.some((item) => item.entry.name === 'root'), false)
    assert.equal(storage.get('dsh-remote-control.secret'), 'remote-test')
    assert.equal(storage.has('dsh-ai-proxy.remote-control-secret'), false)
  } finally {
    globalThis.location = previousLocation
  }
})

test('a rejected session handshake keeps the gate mounted with the host message', async () => {
  const previousLocation = globalThis.location
  globalThis.location = { hostname: 'remote.example', host: 'remote.example' }
  storage.clear()
  resetBrowser()
  fetchHandler = async () => ({
    status: 401, ok: false, json: async () => ({ ok: false, error: { code: 'unauthorized', message: '远程控制认证失败' } }),
  })
  try {
    const ctx = new Context()
    const slots = new SlotsService(ctx)
    new BrowserConnection(ctx)
    await ctx.plugin(clientPlugin).await()
    const gate = slots.registrations.find((item) => item.entry.name === 'root')

    let view = render(gate.component)
    findElement(view, (node) => node?.props?.['aria-label'] === '远程访问密钥').props.onChange({ target: { value: 'remote-test' } })
    view = render(gate.component)
    findElement(view, (node) => node?.type === 'form').props.onSubmit({ preventDefault() {} })
    await new Promise((resolve) => setImmediate(resolve))

    assert(slots.registrations.some((item) => item.entry.name === 'root'), 'a page without the host session is not restored')
    assert.equal(storage.has('dsh-remote-control.secret'), false)
    view = render(gate.component)
    assert(findElement(view, (node) => node?.type === 'p' && String(node.props.children).includes('未能建立官方浏览器会话')))
  } finally {
    globalThis.location = previousLocation
  }
})

test('a freshly minted session restarts the page instead of half-booting the workspace', async () => {
  const previousLocation = globalThis.location
  let reloads = 0
  globalThis.location = { hostname: 'remote.example', host: 'remote.example', reload() { reloads += 1 } }
  storage.clear()
  resetBrowser()
  fetchHandler = async () => ({ status: 200, ok: true, json: async () => ({ ok: true, minted: true }) })
  try {
    const ctx = new Context()
    const slots = new SlotsService(ctx)
    new BrowserConnection(ctx)
    await ctx.plugin(clientPlugin).await()
    const gate = slots.registrations.find((item) => item.entry.name === 'root')

    let view = render(gate.component)
    findElement(view, (node) => node?.props?.['aria-label'] === '远程访问密钥').props.onChange({ target: { value: 'remote-test' } })
    view = render(gate.component)
    findElement(view, (node) => node?.type === 'form').props.onSubmit({ preventDefault() {} })
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(reloads, 1, 'the page restarts so the SPA boots against a live /api surface')
    assert.equal(storage.get('dsh-remote-control.secret'), 'remote-test')
  } finally {
    globalThis.location = previousLocation
  }
})

test('the automatic check restarts a sessionless page exactly once', async () => {
  const previousLocation = globalThis.location
  let reloads = 0
  globalThis.location = { hostname: 'remote.example', host: 'remote.example', reload() { reloads += 1 } }
  storage.clear()
  storage.set('dsh-remote-control.secret', 'remote-test')
  resetBrowser()
  fetchHandler = async () => ({ status: 200, ok: true, json: async () => ({ ok: true, minted: true }) })
  try {
    const ctx = new Context()
    const slots = new SlotsService(ctx)
    new BrowserConnection(ctx)
    await ctx.plugin(clientPlugin).await()
    const gate = slots.registrations.find((item) => item.entry.name === 'root')

    render(gate.component)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(reloads, 1)
  } finally {
    globalThis.location = previousLocation
  }
})

test('an older host without the session endpoint still restores the workspace', async () => {
  const previousLocation = globalThis.location
  globalThis.location = { hostname: 'remote.example', host: 'remote.example' }
  storage.clear()
  resetBrowser()
  fetchHandler = async () => ({ status: 404, ok: false, json: async () => ({}) })
  try {
    const ctx = new Context()
    const slots = new SlotsService(ctx)
    new BrowserConnection(ctx)
    await ctx.plugin(clientPlugin).await()
    const gate = slots.registrations.find((item) => item.entry.name === 'root')

    let view = render(gate.component)
    findElement(view, (node) => node?.props?.['aria-label'] === '远程访问密钥').props.onChange({ target: { value: 'remote-test' } })
    view = render(gate.component)
    findElement(view, (node) => node?.type === 'form').props.onSubmit({ preventDefault() {} })
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(slots.registrations.some((item) => item.entry.name === 'root'), false)
    assert.equal(storage.get('dsh-remote-control.secret'), 'remote-test')
  } finally {
    globalThis.location = previousLocation
  }
})

test('locking a remote session drops the minted host session', async () => {
  const previousLocation = globalThis.location
  globalThis.location = { hostname: 'remote.example', host: 'remote.example' }
  storage.clear()
  storage.set('dsh-remote-control.secret', 'remote-test')
  resetBrowser()
  try {
    const ctx = new Context()
    const slots = new SlotsService(ctx)
    new BrowserConnection(ctx)
    await ctx.plugin(clientPlugin).await()
    const section = slots.registrations.find((item) => item.entry.name === 'settings.section' && item.entry.id === 'remote-control')
    const view = render(section.component, section.entry.inject())
    const lockButton = findElement(view, (node) => node?.props?.children?.includes?.('锁定远程会话 / 清除本地凭证'))
    assert(lockButton)

    lockButton.props.onClick()
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(storage.has('dsh-remote-control.secret'), false)
    assert(slots.registrations.some((item) => item.entry.name === 'root'), 'locking restores the gate')
    assert.deepEqual(fetchCalls.filter((call) => call.method === 'DELETE'), [{
      input: REMOTE_CONTROL_SESSION_PATH, method: 'DELETE', body: JSON.stringify({ token: 'remote-test' }),
    }])
  } finally {
    globalThis.location = previousLocation
  }
})

test('an invalid stored secret stays locked and is removed', async () => {
  const previousLocation = globalThis.location
  globalThis.location = { hostname: 'remote.example', host: 'remote.example' }
  storage.clear()
  storage.set('dsh-remote-control.secret', 'stale')
  resetBrowser()
  try {
    const ctx = new Context()
    const slots = new SlotsService(ctx)
    new BrowserConnection(ctx)
    await ctx.plugin(clientPlugin).await()
    const gate = slots.registrations.find((item) => item.entry.name === 'root')
    render(gate.component)
    await new Promise((resolve) => setImmediate(resolve))
    assert(slots.registrations.some((item) => item.entry.name === 'root'))
    assert.equal(storage.has('dsh-remote-control.secret'), false)
    const view = render(gate.component)
    assert(findElement(view, (node) => node?.type === 'p' && node.props.children.includes('保存的访问密钥已失效，请重新输入')))
  } finally {
    globalThis.location = previousLocation
  }
})

test('updateWebserverHostInPatch seamlessly updates or inserts webserver host', () => {
  const sampleEmpty = `# empty patch\n[]\n`
  const added = internals.updateWebserverHostInPatch(sampleEmpty, '127.0.0.1', 19387)
  assert(added.includes('host: "127.0.0.1"'))
  assert(added.includes('port: 19387'))

  const sampleExisting = `- id: webserver\n  name: "@deepseek-ai/dsh-host-webserver"\n  config:\n    host: "127.0.0.1"\n    port: 19387\n- id: other\n`
  const updatedToLan = internals.updateWebserverHostInPatch(sampleExisting, '192.168.1.20')
  assert(updatedToLan.includes('host: "192.168.1.20"'))
  assert.equal(updatedToLan.includes('host: "127.0.0.1"'), false)
  assert(updatedToLan.includes('- id: other'))

  const updatedBack = internals.updateWebserverHostInPatch(updatedToLan, '127.0.0.1')
  assert(updatedBack.includes('host: "127.0.0.1"'))
  assert.equal(updatedBack.includes('192.168.1.20'), false)
})

test('updateWebserverHostInPatch 同时支持自定义端口', () => {
  const sampleExisting = `- id: webserver\n  name: "@deepseek-ai/dsh-host-webserver"\n  config:\n    host: "127.0.0.1"\n    port: 3080\n- id: other\n`
  // 只改端口，host 不变
  const portOnly = internals.updateWebserverHostInPatch(sampleExisting, '127.0.0.1', 5464, 5464)
  assert(portOnly.includes('port: 5464'))
  assert.equal(portOnly.includes('port: 3080'), false)
  assert(portOnly.includes('host: "127.0.0.1"'))
  assert(portOnly.includes('- id: other'), '不得破坏其它配置段')
  // 只出现一次 port 行，不重复插入
  assert.equal((portOnly.match(/^\s+port:/gm) ?? []).length, 1)
  // 新建段落时带上端口
  const created = internals.updateWebserverHostInPatch('# empty\n[]\n', '127.0.0.1', 3080, 3080)
  assert(created.includes('host: "127.0.0.1"'))
  assert(created.includes('port: 3080'))
})

test('normalizeBindPort 只接受 1~65535 的整数端口', () => {
  for (const value of [1, 80, 3080, 65535, '8080']) {
    assert.equal(internals.normalizeBindPort(value), Number(value))
  }
  for (const bad of [0, -1, 65536, 3.14, 'abc', '', null, undefined]) {
    assert.throws(() => internals.normalizeBindPort(bad), /端口必须是 1 到 65535 之间的整数/, String(bad) + ' 应被拒绝')
  }
  assert.equal(internals.DEFAULT_SERVER_PORT, 3080)
})

test('桌面端可以改端口，但不能改 host', async () => {
  const { ctx } = makeHost()
  // profile.dir 指向临时目录：patch 由测试创建，不碰本机真实 profile
  const dir = mkdtempSync(join(tmpdir(), 'dsh-rc-'))
  const patchPath = join(dir, 'cordis.patch.yml')
  writeFileSync(patchPath, '# empty\n[]\n', 'utf8')
  try {
    const desktopCtx = {
      get: (name) => (name === 'profileContext' ? { name: 'desktop', dir } : ctx.get(name)),
      settings: ctx.settings,
    }
    // 桌面端回环端口由宿主随机分配，插件不允许固定它
    await assert.rejects(
      () => internals.setServerBindHost(desktopCtx, undefined, 5464),
      /回环端口由宿主随机分配/,
    )
    // 试图改成局域网地址：拒绝
    await assert.rejects(
      () => internals.setServerBindHost(desktopCtx, '192.168.50.108', 5464),
      /桌面端不能修改监听地址/,
    )
    // 回环地址通过校验，只重写 host 行、不固定端口
    const sameHost = await internals.setServerBindHost(desktopCtx, '127.0.0.1')
    assert.equal(sameHost.host, '127.0.0.1')
    assert.equal(sameHost.port, undefined)
    const written = readFileSync(patchPath, 'utf8')
    assert.match(written, /host: "127\.0\.0\.1"/)
    assert.doesNotMatch(written, /port: 5464/, '回环端口不应被固定')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('桌面端对外端口由 lanGatewayPort 独立控制', async () => {
  const { ctx, settings } = makeHost()
  // 走真实的 settings 注册流程，让 mutate 有命名空间可用
  plugin.apply(ctx, { enabled: true })
  const desktopCtx = desktopView(ctx)
  // 只写 settings，不碰 profile 的 webserver 行：
  // 这里给一个不存在的 profile 目录，若实现误去改 patch 会直接抛错。
  const isolated = {
    get: (name) => (name === 'profileContext' ? { name: 'desktop', dir: 'C:/nonexistent-profile' } : ctx.get(name)),
    settings: ctx.settings,
  }
  const result = await internals.setLanGatewayPort(isolated, 4000)
  assert.equal(result.lanGatewayPort, 4000)
  assert.equal(settings.doc[plugin.NS]?.lanGatewayPort, 4000)
  await assert.rejects(() => internals.setLanGatewayPort(isolated, 0), /端口必须是 1 到 65535/)
})

test('局域网代理把网卡端口的请求转发到 127.0.0.1 上游', async () => {
  const lan = Object.values(networkInterfaces()).flat()
    .find((iface) => iface && iface.family === 'IPv4' && !iface.internal)?.address
  if (!lan) return // 无局域网网卡的环境跳过
  // 上游只监听回环，等价于桌面端宿主
  const upstream = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('host=' + req.headers.host + ' url=' + req.url)
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const targetPort = upstream.address().port
  const gateway = await startLanGateway({ bindHost: lan, port: 0, targetPort })
  const gatewayPort = gateway.server.address().port
  try {
    // 本文件把 globalThis.fetch 换成了假实现，这里直接用原生 http 请求。
    const body = await new Promise((resolve, reject) => {
      get(`http://${lan}:${gatewayPort}/probe?x=1`, (response) => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => { text += chunk })
        response.on('end', () => resolve({ status: response.statusCode, text }))
      }).on('error', reject)
    })
    assert.equal(body.status, 200)
    assert.match(body.text, /url=\/probe\?x=1/)
    // Host 折成上游 authority：connection.admit 只认回环/绑定地址/trustedHosts，
    // 局域网 authority 会被判 403，故由代理改写。
    assert.match(body.text, new RegExp('host=127\\.0\\.0\\.1:' + targetPort))
  } finally {
    await gateway.close()
    await new Promise((resolve) => upstream.close(resolve))
  }
})

test('局域网代理端口默认 3081，且可配置', () => {
  assert.equal(DEFAULT_LAN_GATEWAY_PORT, 3081)
  assert.equal(plugin.resolveOptions({}).lanGatewayPort, DEFAULT_LAN_GATEWAY_PORT)
  assert.equal(plugin.resolveOptions({ lanGatewayPort: 4000 }).lanGatewayPort, 4000)
  for (const bad of [0, 70000, 3.5]) {
    assert.throws(() => plugin.resolveOptions({ lanGatewayPort: bad }), /lanGatewayPort/)
  }
})

test('每块局域网网卡都要监听，不能只绑系统枚举到的第一个地址', async () => {
  // 真实故障：本机 networkInterfaces() 先返回虚拟网卡 10.11.8.5（EasyTier），
  // 只绑第一个地址时真实局域网 192.168.68.106:3081 根本没有 socket，
  // 浏览器 ERR_CONNECTION_REFUSED，而设置页却把这个地址列成可访问 URL。
  const lanIps = internals.getLocalLanAddresses()
  if (lanIps.length === 0) return // 无局域网网卡的环境跳过

  const upstream = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const targetPort = upstream.address().port
  const gateway = await startLanGateways({ bindHosts: lanIps, port: 0, targetPort })
  try {
    assert.deepEqual(gateway.addresses, lanIps, '每个局域网地址都要有监听')
    assert.equal(gateway.servers.length, lanIps.length)
    assert.deepEqual(gateway.failures, [])
    for (const ip of lanIps) {
      const port = gateway.servers[gateway.addresses.indexOf(ip)].address().port
      const text = await new Promise((resolve, reject) => {
        get(`http://${ip}:${port}/`, (response) => {
          let body = ''
          response.setEncoding('utf8')
          response.on('data', (chunk) => { body += chunk })
          response.on('end', () => resolve(body))
        }).on('error', reject)
      })
      assert.equal(text, 'ok', ip + ' 必须真的能连上')
    }
  } finally {
    await gateway.close()
    await new Promise((resolve) => upstream.close(resolve))
  }
})

test('网关同时监听回环地址，且回环不进入 lanIps', async () => {
  // 回环必须能走同一个对外端口（本机浏览器 / 端口转发 / SSH 隧道只转发回环时）。
  const hosts = internals.getGatewayBindHosts()
  const lanIps = internals.getLocalLanAddresses()
  assert.ok(hosts.includes('127.0.0.1'), '网关必须监听回环')
  assert.equal(hosts[hosts.length - 1], '127.0.0.1', '回环排在最后')
  assert.equal(hosts.length, lanIps.length + (lanIps.includes('127.0.0.1') ? 0 : 1))
  assert.equal(lanIps.includes('127.0.0.1'), false, 'lanIps 仍只含局域网地址')
  assert.equal(new Set(hosts).size, hosts.length, '地址不重复')

  const upstream = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const targetPort = upstream.address().port
  const gateway = await startLanGateways({ bindHosts: hosts, port: 0, targetPort })
  try {
    const index = gateway.addresses.indexOf('127.0.0.1')
    assert.notEqual(index, -1, '回环监听必须启动成功')
    const port = gateway.servers[index].address().port
    const text = await new Promise((resolve, reject) => {
      get(`http://127.0.0.1:${port}/`, (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => { body += chunk })
        response.on('end', () => resolve(body))
      }).on('error', reject)
    })
    assert.equal(text, 'ok', 'http://127.0.0.1:<lanGatewayPort> 必须能打开')
  } finally {
    await gateway.close()
    await new Promise((resolve) => upstream.close(resolve))
  }
})

test('单个网卡监听失败不影响其它网卡，全部失败才抛错', async () => {
  // 至少要两个地址才能表达「部分失败」。CI runner 往往只有一块网卡，
  // 因此固定用「回环 + 一块局域网网卡」，而不是依赖网卡数量。
  const lanIps = internals.getLocalLanAddresses()
  if (lanIps.length === 0) return
  const upstream = createServer((req, res) => res.end('ok'))
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const targetPort = upstream.address().port
  const blocked = lanIps[0]
  const healthy = '127.0.0.1'
  // 先占住一个端口，让该地址的监听必然失败
  const blocker = createServer(() => {})
  await new Promise((resolve) => blocker.listen(0, blocked, resolve))
  const takenPort = blocker.address().port
  try {
    const gateway = await startLanGateways({ bindHosts: [blocked, healthy], port: takenPort, targetPort })
    try {
      assert.deepEqual(gateway.addresses, [healthy], '被占用的地址失败，其余地址照常监听')
      assert.equal(gateway.failures.length, 1)
      assert.equal(gateway.failures[0].bindHost, blocked)
      assert.equal(gateway.failures[0].portTaken, true)
      assert.match(gateway.failures[0].message, new RegExp(`端口 ${takenPort}`))
    } finally {
      await gateway.close()
    }
    // 全部失败时整体抛出，且错误里带上每个地址的原因
    await assert.rejects(
      () => startLanGateways({ bindHosts: [blocked], port: takenPort, targetPort }),
      new RegExp(`端口 ${takenPort} 在 ${blocked.replace(/\./g, '\\.')} 上已被占用`),
    )
  } finally {
    await new Promise((resolve) => blocker.close(resolve))
    await new Promise((resolve) => upstream.close(resolve))
  }
})

test('getLocalLanAddresses 过滤回环与 169.254 链路本地地址', () => {
  for (const ip of internals.getLocalLanAddresses()) {
    assert.equal(ip.startsWith('127.'), false, ip + ' 不应是回环')
    assert.equal(ip.startsWith('169.254.'), false, ip + ' 不应是链路本地地址')
  }
})

test('probePortAvailable 能分辨空闲端口与被占用端口', async () => {
  const blocker = createServer(() => {})
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve))
  const takenPort = blocker.address().port
  try {
    const taken = await probePortAvailable('127.0.0.1', takenPort)
    assert.equal(taken.available, false, '已被占用的端口应判定为不可用')
    assert.equal(taken.code, 'EADDRINUSE')
    assert.equal(isPortTakenError({ code: taken.code }), true)
    assert.match(describeBindFailure('127.0.0.1', takenPort, taken), new RegExp(`端口 ${takenPort} 在 127\\.0\\.0\\.1 上已被占用`))
  } finally {
    await new Promise((resolve) => blocker.close(resolve))
  }

  // 端口释放后应判定为可用
  const free = await probePortAvailable('127.0.0.1', takenPort)
  assert.equal(free.available, true, '释放后的端口应可用')

  // 权限类错误不应被说成“占用”
  const denied = describeBindFailure('127.0.0.1', 80, { code: 'EACCES', message: 'permission denied' })
  assert.match(denied, /没有权限监听/)
  assert.equal(isPortTakenError({ code: 'EACCES' }), false)
})

test('findPortConflicts 报出被占用的地址，并跳过宿主当前端口', async () => {
  const blocker = createServer(() => {})
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve))
  const takenPort = blocker.address().port
  try {
    // 只探回环，避免依赖真实网卡
    const conflicts = await internals.findPortConflicts(takenPort, { bindHosts: ['127.0.0.1'] })
    assert.equal(conflicts.length, 1)
    assert.equal(conflicts[0].bindHost, '127.0.0.1')
    assert.match(conflicts[0].message, new RegExp(`端口 ${takenPort}`))

    // 宿主自己就监听着这个端口时不能算冲突（否则永远改不了端口）
    const ignored = await internals.findPortConflicts(takenPort, { bindHosts: ['127.0.0.1'], ignorePort: takenPort })
    assert.deepEqual(ignored, [], '宿主当前端口要跳过')
  } finally {
    await new Promise((resolve) => blocker.close(resolve))
  }

  const free = await internals.findPortConflicts(takenPort, { bindHosts: ['127.0.0.1'] })
  assert.deepEqual(free, [], '端口空闲时无冲突')
})

test('setLanGatewayPort 拒绝已被占用的端口，不写进配置', async () => {
  const blocker = createServer(() => {})
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve))
  const takenPort = blocker.address().port
  const { ctx, webServer } = makeHost()
  webServer.host = '127.0.0.1'
  webServer.port = 19387
  await ctx.plugin(plugin).await()
  const settings = ctx.get('settings')
  const before = settings.doc[plugin.NS]?.lanGatewayPort
  try {
    // 网关会监听回环，因此回环上的占用足以判定冲突
    await assert.rejects(
      () => internals.setLanGatewayPort(ctx, takenPort),
      new RegExp(`端口 ${takenPort} 已被占用`),
    )
    assert.equal(settings.doc[plugin.NS]?.lanGatewayPort, before, '冲突时不应写入配置')
  } finally {
    await new Promise((resolve) => blocker.close(resolve))
  }
})

test('网关端口冲突进入 status，其余网卡照常监听', async () => {
  // 回环端口被占住：网关只在回环这一条监听上失败，其它网卡照常起来，
  // 冲突原因通过 status 暴露给设置页，而不是静默失败。
  const port = await freePort()
  const blocker = createServer(() => {})
  await new Promise((resolve) => blocker.listen(port, '127.0.0.1', resolve))
  const { ctx, connection, webServer } = makeHost()
  webServer.host = '127.0.0.1'
  webServer.port = 19387
  connection.browserAuth = { isAuthenticated: () => false }
  try {
    await ctx.plugin(plugin, { lanGatewayPort: port }).await()
    const configure = connection.registrations.get(CONFIG_RPC_CHANNEL).handler
    await waitForGateway(port, (runtime) => runtime.failures.length > 0)
    const value = (await configure('status', {})).value
    assert.ok(Array.isArray(value.lanGatewayFailures), '冲突列表必须是数组')
    assert.equal(value.lanGatewayActive, true, '其它网卡仍应监听成功')
    const loopbackFailure = value.lanGatewayFailures.find((failure) => failure.bindHost === '127.0.0.1')
    assert.ok(loopbackFailure, '回环上的占用必须被报出来，实际: ' + JSON.stringify(value.lanGatewayFailures))
    assert.match(loopbackFailure.message, new RegExp(`端口 ${port} 在 127\\.0\\.0\\.1 上已被占用`))
  } finally {
    await new Promise((resolve) => blocker.close(resolve))
  }
})

test('DSH_LAN_GATEWAY=0 时回环宿主和桌面端都不起局域网反代', (t) => {
  const previous = process.env.DSH_LAN_GATEWAY
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_LAN_GATEWAY
    else process.env.DSH_LAN_GATEWAY = previous
  })
  const { ctx, webServer } = makeHost()
  webServer.host = '127.0.0.1'
  process.env.DSH_LAN_GATEWAY = '0'
  assert.equal(internals.isLanGatewayDisabled(), true)
  assert.equal(internals.shouldStartLanGateway(ctx), false, '容器用这个开关关掉会签发 launch token 的网关')
  assert.equal(internals.shouldStartLanGateway(desktopView(ctx)), false, '显式关闭也覆盖桌面端')
  process.env.DSH_LAN_GATEWAY = '1'
  assert.equal(internals.shouldStartLanGateway(ctx), true, '其它取值保持回环宿主起反代')
  delete process.env.DSH_LAN_GATEWAY
  assert.equal(internals.shouldStartLanGateway(ctx), true)
})

test('宿主绑回环时由插件反代提供局域网入口', () => {
  // 桌面端固定 127.0.0.1；web profile 也可以这么配（0.2.x 拒绝 0.0.0.0），
  // 两种情况下局域网入口都只能由插件自己的反代端口提供。
  const { ctx, webServer } = makeHost()
  webServer.host = '127.0.0.1'
  assert.equal(internals.shouldStartLanGateway(ctx), true, '回环绑定必须起反代')

  // 宿主已经绑到具体网卡时不需要再叠一层代理
  webServer.host = '192.168.1.20'
  assert.equal(internals.shouldStartLanGateway(ctx), false)

  // 桌面端无论 host 是什么都走反代（宿主不允许改绑）
  const desktopCtx = desktopView(ctx)
  assert.equal(internals.shouldStartLanGateway(desktopCtx), true)
})

test('status 报告的局域网代理状态以 webServer 服务为键，跨子上下文可见', async () => {
  // status 由另一个 inject 子上下文发起，只有 webServer 实例是共享的；
  // 若把状态挂在各自的 ctx 上，界面永远看不到「反代已启动」。
  const port = await freePort()
  const { ctx, connection, webServer } = makeHost()
  webServer.host = '127.0.0.1'
  webServer.port = 19387
  connection.browserAuth = { isAuthenticated: () => false }
  await ctx.plugin(plugin, { lanGatewayPort: port }).await()

  const configure = connection.registrations.get(CONFIG_RPC_CHANNEL).handler
  await waitForGateway(port, (runtime) => runtime.active === true && runtime.failures.length === 0)
  const value = (await configure('status', {})).value
  assert.equal(value.lanGatewayActive, true, '反代启动后另一个子上下文必须看得到')
  assert.equal(value.lanGatewayPort, port)
  assert.deepEqual(value.lanGatewayFailures, [], '空闲端口上不应有冲突')
  // 监听地址至少覆盖回环，且与界面展示的局域网地址一致
  assert.ok(internals.lanGatewayRuntime().hosts.includes('127.0.0.1'))
})

test('normalizeBindHost 把通配地址换成具体网卡 IP，宿主只接受 IP 字面量', () => {
  // 0.2.x 的 webserver 在启动阶段拒绝 0.0.0.0/::，写进配置会让整个 profile 起不来
  const lan = internals.getLocalLanAddresses().find((ip) => !ip.startsWith('127.'))
  for (const wildcard of ['0.0.0.0', '::', '[::]', '*']) {
    if (lan) assert.equal(internals.normalizeBindHost(wildcard), lan, wildcard + ' 应落到具体网卡 IP')
    else assert.throws(() => internals.normalizeBindHost(wildcard), /没有可用的局域网 IPv4/, wildcard + ' 无网卡时应报错')
  }
  assert.equal(internals.normalizeBindHost('127.0.0.1'), '127.0.0.1')
  assert.equal(internals.normalizeBindHost('192.168.1.20'), '192.168.1.20')
  // 宿主只接受 IP 字面量：回环别名归一成 127.0.0.1，域名直接拒绝
  assert.equal(internals.normalizeBindHost('localhost'), '127.0.0.1')
  assert.equal(internals.normalizeBindHost('::1'), '127.0.0.1')
  assert.throws(() => internals.normalizeBindHost('dsh.example.com'), /必须是具体的 IP 地址/)
  assert.throws(() => internals.normalizeBindHost('300.1.1.1'), /必须是具体的 IP 地址/)
  assert.throws(() => internals.normalizeBindHost(''), /不能为空/)
})

test('isLoopbackHost 区分回环与具体网卡地址', () => {
  for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]', ' 127.0.0.1 ', '127.0.0.2']) {
    assert.equal(internals.isLoopbackHost(host), true, host + ' 是回环')
  }
  for (const host of ['192.168.1.20', '0.0.0.0', '::', '10.0.0.5', '127.0.0', undefined, '']) {
    assert.equal(internals.isLoopbackHost(host), false, String(host) + ' 不是回环')
  }
})

test('isDesktopHostedProfile 识别桌面端 profile', () => {
  const make = (profile, entryName) => ({
    get: (name) => (name === 'profileContext' ? profile : undefined),
    fiber: { entry: { options: { name: entryName } } },
  })
  assert.equal(internals.isDesktopHostedProfile(make({ name: 'desktop' })), true)
  assert.equal(internals.isDesktopHostedProfile(make({ name: 'web' })), false)
  assert.equal(internals.isDesktopHostedProfile(make(undefined, '@deepseek-ai/dsh-desktop-host')), true)
  assert.equal(internals.isDesktopHostedProfile(make(undefined, 'dsh-web-app')), false)
})

test('桌面端拒绝改绑监听地址，避免宿主硬编码 127.0.0.1 打不开而崩溃', async () => {
  const { ctx } = makeHost()
  // 模拟桌面端 profile
  const desktopCtx = desktopView(ctx)
  await assert.rejects(
    () => internals.setServerBindHost(desktopCtx, '192.168.50.108'),
    /桌面端不能修改监听地址/,
  )
})

test('desktop and LAN trust: getLocalLanAddresses, getServerNetworkInfo and auto-trusted LAN IP requestRejection', async () => {
  const lanIps = internals.getLocalLanAddresses()
  assert(Array.isArray(lanIps))
  lanIps.forEach((ip) => {
    assert.match(ip, /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)
    assert.notEqual(ip.startsWith('127.'), true)
  })

  const { ctx, connection, webServer } = makeHost()
  webServer.port = 19387
  webServer.host = lanIps[0] || '192.168.1.20'
  connection.trustedHosts = []
  let authed = false
  connection.browserAuth = {
    isAuthenticated: () => authed,
  }
  connection.authorizeIndex = () => true
  connection.requestRejection = (req) => {
    // 模拟原生 HostConnectionService：非 loopback 且不在 connection.trustedHosts 返回 403
    const host = req?.headers?.host || ''
    if (!host.startsWith('127.0.0.1') && !host.startsWith('localhost')) return 403
    return connection.browserAuth.isAuthenticated(req) ? undefined : 401
  }

  await ctx.plugin(plugin).await()
  const info = internals.getServerNetworkInfo(ctx)
  assert.equal(info.port, 19387)
  assert.equal(info.host, webServer.host)
  assert.equal(info.isAllInterfaces, true, '绑具体网卡 IP 即视为已开放局域网')

  const configure = connection.registrations.get(CONFIG_RPC_CHANNEL).handler
  await configure('setEnabled', { enabled: true })

  // 模拟从局域网 IP 发起的请求（如 192.168.x.x:19387）
  if (lanIps.length > 0) {
    const targetLanIp = lanIps[0]
    const unauthLanReq = { headers: { host: `${targetLanIp}:19387` }, url: '/api/session' }
    // 启用远程控制后，合法局域网地址自动从 403 转换为 401（未认证）
    assert.equal(connection.requestRejection(unauthLanReq), 401)

    authed = true
    const authedLanReq = { headers: { host: `${targetLanIp}:19387` }, url: '/api/session' }
    // 已认证则完全放行 (undefined)
    assert.equal(connection.requestRejection(authedLanReq), undefined)
    authed = false

    const rpcLanReq = { headers: { host: `${targetLanIp}:19387` }, url: '/dsh-remote-control' }
    // 远程控制专属 RPC 路径则完全豁免 401
    assert.equal(connection.requestRejection(rpcLanReq), undefined)
  }

  // 非本机局域网的外来伪造 host 仍严格保持 403
  const forgedReq = { headers: { host: 'evil-phishing.com:19387' }, url: '/api/session' }
  assert.equal(connection.requestRejection(forgedReq), 403)
})

test('desktop and LAN status info renders in RemoteControlSettings', async () => {
  const previousLocation = globalThis.location
  globalThis.location = { hostname: 'localhost', host: 'localhost:19387' }
  storage.clear()
  resetBrowser()
  try {
    const ctx = new Context()
    const slots = new SlotsService(ctx)
    const connection = new BrowserConnection(ctx)
    // 模拟服务端返回完整的网络与局域网 IP 信息
    connection.rpc.call = async (channel, method, payload) => {
      connection.calls.push({ channel, method, payload })
      if (channel === CONFIG_RPC_CHANNEL) {
        return {
          ok: true,
          value: {
            enabled: true,
            secretConfigured: true,
            port: 19387,
            host: '192.168.50.108',
            isAllInterfaces: true,
            lanIps: ['192.168.50.108'],
            trustedHosts: [],
          },
        }
      }
      return { ok: false }
    }

    await ctx.plugin(clientPlugin).await()
    const section = slots.registrations.find((item) => item.entry.name === 'settings.section' && item.entry.id === 'remote-control')
    assert(section)
    render(section.component, section.entry.inject())
    // 刷新 Promise 微任务使 useEffect 中的 configRequest 得到响应
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))

    const reRendered = render(section.component, section.entry.inject())
    const networkCard = findElement(reRendered, (node) => node?.props?.className === 'dsh-remote-network-card')
    assert(networkCard, '网络信息卡片应当正常渲染')
    const portTag = findElement(networkCard, (node) => node?.props?.className === 'dsh-remote-tag' && String(node?.props?.children).includes('19387'))
    assert(portTag, '应当显示监听端口标签')
    const hostSwitch = findElement(networkCard, (node) => node?.props?.className === 'dsh-remote-host-switch')
    assert(hostSwitch, '本机访问时应显示切换监听地址控件')
    // 已开放局域网时只提供「切回仅本机」，且按钮文案里不出现宿主会拒绝的通配地址
    const backButton = findElement(hostSwitch, (node) => node?.type === 'button' && String(node?.props?.children).includes('仅本机'))
    assert(backButton, '已开放局域网时应提供切回仅本机的按钮')
    assert.equal(findElement(hostSwitch, (node) => node?.type === 'button' && String(node?.props?.children).includes('0.0.0.0')), undefined,
      '界面不得再引导用户绑定 0.0.0.0')
    const lanUrl = findElement(networkCard, (node) => node?.props?.className === 'dsh-remote-network-url')
    assert(lanUrl, '应当显示可供局域网直接访问的完整 URL')
    assert.equal(lanUrl.props.children, 'http://192.168.50.108:19387')
  } finally {
    globalThis.location = previousLocation
  }
})

test('the switch row nests no label and drives the checkbox only through change', async () => {
  // 真实浏览器里点击内层 label 会先冒泡到外层再触发原生 activation，
  // 嵌套 label 或手写 onClick 翻转都会连发两次点击，开关看起来永远打不开。
  const previousLocation = globalThis.location
  globalThis.location = { hostname: 'localhost', host: 'localhost:19387' }
  storage.clear()
  resetBrowser()
  try {
    const ctx = new Context()
    const slots = new SlotsService(ctx)
    new BrowserConnection(ctx)
    await ctx.plugin(clientPlugin).await()
    const section = slots.registrations.find((item) => item.entry.name === 'settings.section' && item.entry.id === 'remote-control')
    render(section.component, section.entry.inject())
    await new Promise((resolve) => setImmediate(resolve))
    const view = render(section.component, section.entry.inject())

    const row = findElement(view, (node) => node?.props?.className === 'dsh-remote-toggle-row')
    assert(row)
    assert.equal(row.type, 'label', '整行仍是 label，点文字也能切换')
    assert.equal(row.props.onClick, undefined, '不得再手写 onClick 翻转')

    const switchWrapper = findElement(view, (node) => node?.props?.className === 'dsh-remote-switch')
    assert(switchWrapper)
    assert.notEqual(switchWrapper.type, 'label', '内层不能是 label，否则一次点击会激活两次')
    const checkbox = findElement(switchWrapper, (node) => node?.props?.role === 'switch')
    assert.equal(checkbox.props.type, 'checkbox')
    assert.equal(typeof checkbox.props.onChange, 'function')
  } finally {
    globalThis.location = previousLocation
  }
})

test('开关的透明 checkbox 必须压回 0 尺寸，否则移动端触摸目标会把它撑成方块', () => {
  // mobile-adapter 按 [role="switch"] 给 min-width/min-height: 44px，
  // 这里若不显式压回，透明 input 会变成 44×44 盖住 38×22 的滑块。
  const clientSource = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const rule = clientSource.match(/\.dsh-remote-switch input\{[^}]*\}/)
  assert(rule, '缺少 .dsh-remote-switch input 样式规则')
  for (const prop of ['width', 'height', 'min-width', 'min-height']) {
    assert.match(rule[0], new RegExp(prop + ':0!important'), prop + ' 必须用 !important 压回 0')
  }
})

test('端口行里的标签、输入框、按钮都不得换行，说明文字独占整行', async () => {
  // 宿主把设置面板挤到 531px 时，四个 flex 项一起收缩会把「局域网对外端口:」
  // 和「应用端口」压成两行。标签与按钮必须 flex:none + nowrap，
  // 说明文字用 flex-basis:100% 独占一行，整段下移而不是被压窄。
  const previousLocation = globalThis.location
  globalThis.location = { hostname: 'localhost', host: 'localhost:19387' }
  storage.clear()
  resetBrowser()
  try {
    const ctx = new Context()
    const slots = new SlotsService(ctx)
    const connection = new BrowserConnection(ctx)
    connection.rpc.call = async (channel) => channel === CONFIG_RPC_CHANNEL
      ? { ok: true, value: { enabled: true, secretConfigured: true, port: 19387, host: '127.0.0.1', bindLocked: true, lanIps: [] } }
      : { ok: false }
    await ctx.plugin(clientPlugin).await()
    const section = slots.registrations.find((item) => item.entry.name === 'settings.section' && item.entry.id === 'remote-control')
    render(section.component, section.entry.inject())
    await new Promise((resolve) => setImmediate(resolve))
    const view = render(section.component, section.entry.inject())

    const row = findElement(view, (node) => node?.props?.className === 'dsh-remote-port-row')
    assert(row, '端口行应当渲染')
    const hint = findElement(row, (node) => node?.props?.className === 'dsh-remote-port-hint')
    assert(hint, '尾部说明文字必须带 dsh-remote-port-hint 类，否则拿不到独占整行的样式')

    const clientSource = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
    /** 取指定选择器的样式规则体；选择器按字面量处理，不做正则解释。 */
    const cssRule = (selector) => {
      const start = clientSource.indexOf(selector + '{')
      assert(start !== -1, '缺少样式规则 ' + selector)
      const end = clientSource.indexOf('}', start)
      return clientSource.slice(start, end + 1)
    }
    const noWrap = cssRule('.dsh-remote-port-row>*')
    assert.match(noWrap, /flex:none/, '行内子项不得收缩')
    assert.match(noWrap, /white-space:nowrap/, '行内子项不得换行')
    const hintRule = cssRule('.dsh-remote-port-hint')
    assert.match(hintRule, /flex:1 0 100%/, '说明文字必须独占整行')
    assert.match(hintRule, /white-space:normal/, '说明文字自身允许换行')
    assert.match(cssRule('.dsh-remote-host-btn'), /white-space:nowrap/, '按钮文案不得换行')
  } finally {
    globalThis.location = previousLocation
  }
})

// ── live (volatile) config plumbing ────────────────────────────────────────

const VOLATILE_WRITE_SYMBOL = Symbol.for('cosmokit.volatile.write')

/** A cosmokit `createVolatile` reference: an own `get()` plus the shared write symbol. */
function liveRef(initial) {
  let current = initial
  return {
    ref: Object.freeze({ get: () => current, [VOLATILE_WRITE_SYMBOL]: (next) => { current = next } }),
    write: (next) => { current = next },
  }
}

test('isVolatileRef: cosmokit references count, config data never does', () => {
  const { ref } = liveRef('x')
  assert.equal(plugin.isVolatileRef(ref), true)
  assert.equal(plugin.isVolatileRef({ get: () => 1, baseURL: 'x' }), false, 'a data object with a get method is not a reference')
  for (const value of [undefined, null, 'x', 42, true, ['x'], { a: 1 }]) {
    assert.equal(plugin.isVolatileRef(value), false, String(value) + ' is plain data')
  }
})

test('unwrapConfig: live references resolve to their current value, nested included', () => {
  const secret = liveRef('s3cret')
  const config = { enabled: secret.ref, nested: { list: [secret.ref] } }
  assert.deepEqual(plugin.unwrapConfig(config), { enabled: 's3cret', nested: { list: ['s3cret'] } })
  // The Loader swaps the value inside the same reference, never the reference.
  secret.write('rotated')
  assert.equal(plugin.unwrapConfig(config).enabled, 'rotated')
})

test('settingsBase: the legacy settings seam receives raw plain config', () => {
  const live = liveRef('http://gw.example')
  const resolved = { enabled: live.ref, mode: 'x' }
  assert.deepEqual(plugin.settingsBase({ fiber: undefined }, resolved), { enabled: 'http://gw.example', mode: 'x' },
    'without a loader entry the resolved config is all there is, so it is unwrapped')
  const entryConfig = { enabled: true }
  assert.deepEqual(plugin.settingsBase({ fiber: { entry: { options: { config: entryConfig } } } }, resolved), entryConfig,
    'with an entry, register receives the raw composition layer it resolves itself')
  assert.deepEqual(plugin.settingsBase({ fiber: undefined }, undefined), {})
})

test('Config: every field this section owns is live, and unwraps to plain data', () => {
  // The local devDependency may pin schemastery 3.18.1 while a fresh install
  // (CI, the host itself) resolves 3.18.4, so both shapes must hold: the host
  // settings service refuses every write when no field is volatile, and
  // consumers must never receive a live reference.
  const keys = Object.keys(plugin.Config.dict)
  const supportsLiveFields = typeof plugin.Config.dict[keys[0]].volatile === 'function'
  for (const [key, field] of Object.entries(plugin.Config.dict)) {
    assert.equal(field.meta?.volatile === true, supportsLiveFields,
      key + (supportsLiveFields ? ' must be declared live' : ' stays ordinary on this schemastery'))
  }
  const resolved = plugin.Config({})
  assert.equal(plugin.isVolatileRef(resolved[keys[0]]), supportsLiveFields,
    'live fields resolve to references exactly when the schema declares them')
  const plain = plugin.unwrapConfig(resolved)
  for (const key of keys) assert.equal(plugin.isVolatileRef(plain[key]), false, key + ' unwraps to plain data')
  assert.deepEqual(Object.keys(plain).sort(), [...keys].sort(), 'unwrapping keeps every declared field')
})

test('开关圆点在开启态必须取反色 Token，不能硬编码白色', () => {
  // Zai 主题下开启态轨道是 --dsw-alias-brand-primary，暗色为 #ffffff；
  // 圆点若硬编码 #ffffff 就是白圆点压白轨道，整个消失（2026-10 实测）。
  // 必须与宿主官方 switch 一致：开启态圆点用 label-primary-foreground（暗色=黑）。
  const clientSource = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

  const slider = clientSource.match(/\.dsh-remote-slider:before\{[^}]*\}/)
  assert(slider, '缺少 .dsh-remote-slider:before 规则')
  assert.match(slider[0], /background-color:var\(--dsw-alias-switch-thumb/, '关闭态圆点应取 switch-thumb Token')
  assert.doesNotMatch(slider[0], /background-color:#fff/i, '圆点不得硬编码白色')

  const checked = clientSource.match(/input:checked \+ \.dsh-remote-slider:before\{[^}]*\}/)
  assert(checked, '缺少开启态圆点规则')
  assert.match(checked[0], /background-color:var\(--dsw-alias-label-primary-foreground/, '开启态圆点必须取反色 Token')
  assert.doesNotMatch(checked[0], /background-color:#fff/i, '开启态圆点不得硬编码白色')

  // 关闭态轨道同样要走 Token，避免与 --dsw-alias-border-default 这类不存在的 Token 混用
  const track = clientSource.match(/\.dsh-remote-slider\{[^}]*\}/)
  assert(track, '缺少 .dsh-remote-slider 规则')
  assert.match(track[0], /background-color:var\(--dsw-alias-border-l3/, '轨道应取宿主真实存在的 border-l3')
})

test('remote directory RPCs list and create on the host without touching apiProxy', async () => {
  const { ctx, connection, credentials, settings, apiProxy } = makeHost()
  await ctx.plugin(plugin).await()
  const configure = connection.registrations.get(CONFIG_RPC_CHANNEL).handler
  const remote = connection.registrations.get(REMOTE_CONTROL_RPC_CHANNEL).handler
  // 先落密钥再开开关：一次改一个字段，避免两次 patch 互相覆盖。
  assert.equal((await configure('setSecret', { secret: 'remote-test' })).ok, true)
  assert.equal((await configure('setEnabled', { enabled: true })).ok, true)
  const statusResult = await remote('status', { token: 'remote-test' })
  assert.equal(statusResult.value.authenticated, true, '目录 RPC 测试需要先建立可信认证')

  const parent = mkdtempSync(join(tmpdir(), 'dsh-remote-rpc-'))
  try {
    // 列举：payload 省略 path 时落在调用方主目录，给 path 时列举该目录。
    const home = await remote('call', { token: 'remote-test', method: 'directory.list', payload: {} })
    assert.equal(home.ok, true)
    assert.equal(typeof home.value.path, 'string')
    assert.equal(Array.isArray(home.value.entries), true)

    const listed = await remote('call', { token: 'remote-test', method: 'directory.list', payload: { path: parent } })
    assert.equal(listed.ok, true)
    assert.equal(listed.value.path, parent)
    assert.deepEqual(listed.value.entries, [])

    // 盘符枚举：没有它，界面走到盘根就到头了。
    const drives = await remote('call', { token: 'remote-test', method: 'directory.drives', payload: {} })
    assert.equal(drives.ok, true)
    assert(Array.isArray(drives.value))
    assert(drives.value.length >= 1)

    const created = await remote('call', {
      token: 'remote-test', method: 'directory.create', payload: { path: parent, name: 'made-remotely' },
    })
    assert.equal(created.ok, true)
    assert.equal(created.value, join(parent, 'made-remotely'))
    const after = await remote('call', { token: 'remote-test', method: 'directory.list', payload: { path: parent } })
    assert.deepEqual(after.value.entries.map((entry) => entry.name), ['made-remotely'])

    // 失败码必须翻译成宿主的 directory-picker/* 词汇，客户端按码分支。
    const duplicate = await remote('call', {
      token: 'remote-test', method: 'directory.create', payload: { path: parent, name: 'made-remotely' },
    })
    assert.equal(duplicate.ok, false)
    assert.equal(duplicate.error.code, 'directory-picker/exists')
    assert.deepEqual(duplicate.error.details, { path: join(parent, 'made-remotely') })

    const unreadable = await remote('call', {
      token: 'remote-test', method: 'directory.list', payload: { path: join(parent, 'nope') },
    })
    assert.equal(unreadable.ok, false)
    assert.equal(unreadable.error.code, 'directory-picker/unreadable')

    const badName = await remote('call', {
      token: 'remote-test', method: 'directory.create', payload: { path: parent, name: '../escape' },
    })
    assert.equal(badName.ok, false)
    assert.equal(badName.error.code, 'directory-picker/create-failed')

    // 认证仍然先于方法分派：没有 token 的目录调用不会读到任何路径。
    assert.equal((await remote('call', { token: 'wrong', method: 'directory.list', payload: {} })).ok, false)

    // 目录浏览是插件自己的原语，绝不能落到宿主 apiProxy 上。
    assert.deepEqual(apiProxy.calls.filter((call) => call.domain === 'host'), [])
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test('directory primitives list the home directory and refuse unsafe targets', async () => {
  const { listDirectory, createDirectory, DirectoryBrowseError } = await import('../lib/directory-browse.js')
  const listing = await listDirectory(undefined, { home: tmpdir(), limit: 4 })
  assert.equal(listing.path, tmpdir())
  assert.equal(listing.home, tmpdir())
  assert.equal(listing.crumbs.at(-1).path, tmpdir())
  assert(Array.isArray(listing.entries))
  assert.equal(listing.entries.length <= 4, true, 'limit caps the entry list')

  // 相对路径没有「当前目录」可言：宿主 browse 后端同样只接受绝对路径。
  await assert.rejects(() => listDirectory('relative/dir'), (error) => {
    assert(error instanceof DirectoryBrowseError)
    assert.equal(error.code, 'directory-unreadable')
    return true
  })
  await assert.rejects(() => listDirectory(42), (error) => {
    assert.equal(error.code, 'directory-unreadable')
    return true
  })

  const parent = mkdtempSync(join(tmpdir(), 'dsh-dir-'))
  try {
    // 目录名必须是单一路径段：`a/b` 不能借父目录逃出去。
    await assert.rejects(() => createDirectory(parent, 'a/b'), (error) => {
      assert.equal(error.code, 'directory-create-failed')
      return true
    })
    await assert.rejects(() => createDirectory(parent, '..'), (error) => {
      assert.equal(error.code, 'directory-create-failed')
      return true
    })
    // Windows 会在 API 层去掉路径部件末尾的空格与点，'.. ' 到不了文件系统
    // 就已被折叠成 '..'。必须在进 OS 之前拒掉，不能指望 mkdir 报错。
    if (process.platform === 'win32') {
      for (const sneaky of ['.. ', 'a.', 'a ', '. ']) {
        await assert.rejects(() => createDirectory(parent, sneaky), (error) => {
          assert.equal(error.code, 'directory-create-failed', sneaky + ' 必须在进 OS 前被拒')
          return true
        })
      }
    }
    const created = await createDirectory(parent, 'remote-control-target')
    assert.equal(created, join(parent, 'remote-control-target'))
    // 已存在必须报 exists，而不是让 mkdir 的 EEXIST 冒成 internal。
    await assert.rejects(() => createDirectory(parent, 'remote-control-target'), (error) => {
      assert(error instanceof DirectoryBrowseError)
      assert.equal(error.code, 'directory-exists')
      return true
    })
    const nested = await listDirectory(parent)
    assert.deepEqual(nested.entries.map((entry) => entry.name), ['remote-control-target'])
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test('directory browsing stays off the apiProxy allowlist and reports host wire codes', async () => {
  // 目录浏览由插件自己在宿主机上实现，绝不能退化成 apiProxy 上的一个方法：
  // 宿主的那套后端在远程访问下根本没有被挂上。
  for (const method of Object.keys(internals.LOCAL_METHODS)) {
    assert.equal(Object.hasOwn(internals.LOCAL_METHODS, method), true)
    assert.equal(method.startsWith('directory.'), true, method + ' 应留在 directory.* 命名空间')
  }
  assert.deepEqual(Object.keys(internals.DIRECTORY_BROWSE_WIRE_CODES).sort(), [
    'directory-create-failed', 'directory-exists', 'directory-unreadable',
  ])
  // 失败码必须与宿主 directory-picker 一致，客户端的浏览对话框按码分支。
  for (const wireCode of Object.values(internals.DIRECTORY_BROWSE_WIRE_CODES)) {
    assert.equal(wireCode.startsWith('directory-picker/'), true, wireCode + ' 必须是宿主的失败码词汇')
  }
})

test('a remote browser claims the three directory-flow holes instead of the host native picker', async () => {
  const previousLocation = globalThis.location
  globalThis.location = { protocol: 'http:', hostname: '192.168.1.20', host: '192.168.1.20:3080' }
  storage.clear()
  storage.set('dsh-remote-control.secret', 'remote-test')
  resetBrowser()
  try {
    const ctx = new Context()
    const slots = new SlotsService(ctx)
    const connection = new BrowserConnection(ctx)
    await ctx.plugin(clientPlugin).await()
    const flows = slots.registrations.filter((item) => item.entry.name.endsWith('.directoryFlow'))
    assert.deepEqual([...flows.map((item) => item.entry.name)].sort(), [
      'conversation.hero.workspace.directoryFlow',
      'sidebar.workspaces.directoryFlow',
      'workspace.picker.directoryFlow',
    ])
    // single 孔洞只按 priority 升序排完取第一个，不声明即 0，与随包发布的
    // native 占用者并列 —— 那时胜负取决于注册先后，不可控。必须显式给负值。
    for (const flow of flows) {
      assert.equal(typeof flow.entry.priority, 'number', flow.entry.name + ' 必须显式声明 priority')
      assert(flow.entry.priority < 0, flow.entry.name + ' 的 priority 必须为负才能压过随包发布的占用者')
    }

    // 注入面必须走本插件通道，而不是宿主的 uiWorkspace：宿主若选到 native 后端，
    // 它的 directoryPicker.list() 只会抛 `directory-picker/unavailable`。
    const injected = flows[0].entry.inject()
    await injected.listDirectory(undefined)
    const listingCall = connection.calls.find((call) => call.payload?.method === 'directory.list')
    assert(listingCall, 'listDirectory 必须经由本插件 RPC 通道')
    assert.equal(listingCall.channel, REMOTE_CONTROL_RPC_CHANNEL)
    assert.equal(listingCall.method, 'call')
    assert.equal(listingCall.payload.token, 'remote-test')
    assert.deepEqual(listingCall.payload.payload, {})
  } finally {
    globalThis.location = previousLocation
  }
})

test('the remote directory dialog lists, navigates and commits the picked folder', async () => {
  const previousLocation = globalThis.location
  globalThis.location = { protocol: 'http:', hostname: '192.168.1.20', host: '192.168.1.20:3080' }
  storage.clear()
  storage.set('dsh-remote-control.secret', 'remote-test')
  resetBrowser()

  const listings = {
    'C:\\Users\\me': {
      path: 'C:\\Users\\me',
      home: 'C:\\Users\\me',
      crumbs: [{ name: 'C:\\', path: 'C:\\' }, { name: 'Users', path: 'C:\\Users' }, { name: 'me', path: 'C:\\Users\\me' }],
      entries: [{ name: 'project', path: 'C:\\Users\\me\\project', hidden: false }],
      truncated: false,
    },
    'C:\\Users\\me\\project': {
      path: 'C:\\Users\\me\\project',
      home: 'C:\\Users\\me',
      crumbs: [
        { name: 'C:\\', path: 'C:\\' },
        { name: 'Users', path: 'C:\\Users' },
        { name: 'me', path: 'C:\\Users\\me' },
        { name: 'project', path: 'C:\\Users\\me\\project' },
      ],
      entries: [],
      truncated: true,
    },
  }

  try {
    const ctx = new Context()
    const slots = new SlotsService(ctx)
    const connection = new BrowserConnection(ctx)
    // 真实宿主会在这里给出 directory.list / directory.create 的结果；桩只记录调用。
    connection.rpc.call = async (channel, method, payload) => {
      connection.calls.push({ channel, method, payload })
      if (payload?.method === 'directory.list') {
        return { ok: true, value: listings[payload.payload?.path ?? 'C:\\Users\\me'] }
      }
      return { ok: false, error: { code: 'internal', message: 'unexpected' } }
    }
    await ctx.plugin(clientPlugin).await()

    const flow = slots.registrations.find((item) => item.entry.name === 'sidebar.workspaces.directoryFlow')
    const picked = []
    const props = {
      open: true,
      busy: false,
      onPicked: (path) => { picked.push(path) },
      onCancel: () => { picked.push(null) },
      onError: (message) => { picked.push('error:' + message) },
      ...flow.entry.inject(),
    }

    let tree = render(flow.component, props)
    await new Promise((resolve) => setImmediate(resolve))
    tree = render(flow.component, props)

    // 打开即落在主目录：标题、当前路径与子文件夹都在树里。
    assert(findElement(tree, (node) => node?.props?.children === '选择工作区目录'), '缺少对话框标题')
    assert.equal(dialogPath(tree), 'C:\\Users\\me', '路径栏应显示当前目录')
    const entryButton = findElement(tree, (node) => node?.props?.children === 'project')
    assert(entryButton, '缺少子文件夹条目')
    assert.equal(entryButton.props.type, 'button')

    // 点进子文件夹：重新列举，面包屑与截断提示跟着更新。
    entryButton.props.onClick()
    await new Promise((resolve) => setImmediate(resolve))
    tree = render(flow.component, props)
    assert.equal(connection.calls.at(-1).payload.payload.path, 'C:\\Users\\me\\project')
    assert(findElement(tree, (node) => node?.props?.children === '文件夹过多，仅显示开头部分。'), '缺少截断提示')

    // 提交用的是「当前所在目录」，不是某条子条目。
    const commit = findElement(tree, (node) => node?.props?.children === '选择此文件夹')
    assert(commit, '缺少提交按钮')
    commit.props.onClick()
    assert.deepEqual(picked, ['C:\\Users\\me\\project'])

    // 关闭态渲染空，且不再发起列举。
    const callsBeforeClose = connection.calls.length
    assert.equal(render(flow.component, { ...props, open: false }), null)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(connection.calls.length, callsBeforeClose, '关闭的对话框不得继续列举目录')
  } finally {
    globalThis.location = previousLocation
  }
})

test('the remote directory dialog creates a folder then stops in it', async () => {
  const previousLocation = globalThis.location
  globalThis.location = { protocol: 'http:', hostname: '192.168.1.20', host: '192.168.1.20:3080' }
  storage.clear()
  storage.set('dsh-remote-control.secret', 'remote-test')
  resetBrowser()

  try {
    const ctx = new Context()
    const slots = new SlotsService(ctx)
    const connection = new BrowserConnection(ctx)
    let created = null
    connection.rpc.call = async (channel, method, payload) => {
      connection.calls.push({ channel, method, payload })
      if (payload?.method === 'directory.create') {
        created = payload.payload
        return { ok: true, value: payload.payload.path + '\\' + payload.payload.name }
      }
      if (payload?.method === 'directory.list') {
        const path = payload.payload?.path ?? 'C:\\Users\\me'
        return {
          ok: true,
          value: {
            path,
            home: 'C:\\Users\\me',
            crumbs: [{ name: 'C:\\', path: 'C:\\' }],
            entries: created !== null && path === created.path + '\\' + created.name
              ? []
              : [{ name: 'notes', path: 'C:\\Users\\me\\notes', hidden: false }],
            truncated: false,
          },
        }
      }
      return { ok: false, error: { code: 'internal', message: 'unexpected' } }
    }
    await ctx.plugin(clientPlugin).await()

    const flow = slots.registrations.find((item) => item.entry.name === 'conversation.hero.workspace.directoryFlow')
    const props = {
      open: true,
      busy: false,
      onPicked: () => {},
      onCancel: () => {},
      onError: () => {},
      ...flow.entry.inject(),
    }

    render(flow.component, props)
    await new Promise((resolve) => setImmediate(resolve))
    let tree = render(flow.component, props)

    // 输入新目录名并创建：必须打到 directory.create，参数是「当前目录 + 名字」。
    const input = findElement(tree, (node) => node?.props?.placeholder === '新建文件夹')
    assert(input, '缺少新建文件夹输入框')
    input.props.onChange({ target: { value: 'brand-new' } })
    tree = render(flow.component, props)
    const createButton = findElement(tree, (node) => node?.props?.children === '创建')
    assert(createButton, '缺少创建按钮')
    createButton.props.onClick()
    await new Promise((resolve) => setImmediate(resolve))

    assert.deepEqual(created, { path: 'C:\\Users\\me', name: 'brand-new' })
    const createCall = connection.calls.find((call) => call.payload?.method === 'directory.create')
    assert.equal(createCall.channel, REMOTE_CONTROL_RPC_CHANNEL)
    // 创建后停在新目录：下一次列举的路径就是刚建好的那个，而不是直接提交。
    tree = render(flow.component, props)
    assert.equal(dialogPath(tree), 'C:\\Users\\me\\brand-new', '创建后应停在新目录')
    assert(findElement(tree, (node) => node?.props?.children === '这里没有子文件夹'), '新目录应为空')
  } finally {
    globalThis.location = previousLocation
  }
})

test('a remote browser claims the holes even though uiWorkspace always exposes listDirectory', async () => {
  // 回归守卫：**不能**用「ctx.uiWorkspace.listDirectory 是否存在」判断宿主有没有
  // browse 后端。它是 UiWorkspaceService 的无条件实例方法，内部转发到
  // directoryPicker.list()，native 后端下只是调用时抛
  // `directory-picker/unavailable`，方法本身永远存在。
  //
  // 曾经按「方法存在 = 宿主是 browse」写过判据，结果在真实宿主上恒为真，插件
  // 永不注册，用户报告的 bug（远程点添加工作区弹在宿主机屏幕）完全没修。这里让
  // 桩模拟真实宿主形态：uiWorkspace 存在且 listDirectory 可调用，同时当前宿主
  // 后端是 native（调用会抛 unavailable）—— 三个孔洞仍然必须被接管。
  class NativeBackedUiWorkspace extends Service {
    constructor(ctx) {
      super(ctx, 'uiWorkspace')
    }
    async listDirectory() {
      const error = new Error('the directory picker offers no browse capability')
      error.code = 'directory-picker/unavailable'
      throw error
    }
    async createDirectory() {
      const error = new Error('the directory picker offers no browse capability')
      error.code = 'directory-picker/unavailable'
      throw error
    }
  }

  const previousLocation = globalThis.location
  globalThis.location = { protocol: 'http:', hostname: '192.168.1.20', host: '192.168.1.20:3080' }
  storage.clear()
  storage.set('dsh-remote-control.secret', 'remote-test')
  resetBrowser()
  try {
    const ctx = new Context()
    const slots = new SlotsService(ctx)
    new BrowserConnection(ctx)
    new NativeBackedUiWorkspace(ctx)
    await ctx.plugin(clientPlugin).await()
    const flows = slots.registrations.filter((item) => item.entry.name.endsWith('.directoryFlow'))
    assert.deepEqual([...flows.map((item) => item.entry.name)].sort(), [
      'conversation.hero.workspace.directoryFlow',
      'sidebar.workspaces.directoryFlow',
      'workspace.picker.directoryFlow',
    ], '宿主 uiWorkspace 存在时也必须在远程浏览器上接管三个孔洞')
    for (const flow of flows) {
      assert.equal(flow.entry.priority, -100, flow.entry.name + ' 必须以负 priority 压过 native 占用者')
    }
  } finally {
    globalThis.location = previousLocation
  }
})

test('a superseded listing cannot overwrite the newer level', async () => {
  // 点两下目录时，慢的那个响应回来不能把界面拽回旧层级：用户以为停在 B，
  // 点「选择此文件夹」提交的却是 A —— 会建出指向错误目录的 workspace。
  const previousLocation = globalThis.location
  globalThis.location = { protocol: 'http:', hostname: '192.168.1.20', host: '192.168.1.20:3080' }
  storage.clear()
  storage.set('dsh-remote-control.secret', 'remote-test')
  resetBrowser()

  const level = (path, names) => ({
    path,
    home: 'C:\\',
    crumbs: [{ name: 'C:\\', path: 'C:\\' }],
    entries: names.map((name) => ({ name, path: path + '\\' + name, hidden: false })),
    truncated: false,
  })

  try {
    const ctx = new Context()
    const slots = new SlotsService(ctx)
    new BrowserConnection(ctx)
    await ctx.plugin(clientPlugin).await()

    const flow = slots.registrations.find((item) => item.entry.name === 'sidebar.workspaces.directoryFlow')
    const pending = []
    const props = {
      open: true,
      busy: false,
      onPicked: () => {},
      onCancel: () => {},
      onError: () => {},
      ...flow.entry.inject(),
      // 受控的列举：每次调用都挂起，由测试决定谁先回来。
      listDirectory: (path) => new Promise((resolve) => { pending.push({ path, resolve }) }),
    }

    render(flow.component, props)
    pending[0].resolve(level('C:\\', ['A', 'B']))
    await new Promise((resolve) => setImmediate(resolve))
    let tree = render(flow.component, props)

    // 依次点 A、B：A 的请求先发出，但 B 先返回。
    findElement(tree, (node) => node?.props?.children === 'A').props.onClick()
    tree = render(flow.component, props)
    findElement(tree, (node) => node?.props?.children === 'B').props.onClick()
    render(flow.component, props)
    assert.equal(pending.length, 3)

    pending[2].resolve(level('C:\\B', []))
    await new Promise((resolve) => setImmediate(resolve))
    tree = render(flow.component, props)
    assert.equal(dialogPath(tree), 'C:\\B', '应先停在 B')

    // 慢一步的 A 迟到：不得把界面拽回 A。
    pending[1].resolve(level('C:\\A', []))
    await new Promise((resolve) => setImmediate(resolve))
    tree = render(flow.component, props)
    assert.equal(dialogPath(tree), 'C:\\B', '过期响应不得覆盖当前层级')
  } finally {
    globalThis.location = previousLocation
  }
})

test('drives are enumerated so the dialog is not trapped on one volume', async () => {
  const { listDrives } = await import('../lib/directory-browse.js')
  const drives = await listDrives({ timeoutMs: 1500 })
  assert(Array.isArray(drives))
  assert(drives.length >= 1, '至少要有一个可列举的驱动器根')
  for (const drive of drives) {
    assert.equal(typeof drive.name, 'string')
    assert.equal(drive.path, drive.name)
  }
  if (process.platform === 'win32') {
    // 盘符根固定是 `X:\`，不能是裸 `X:` —— 后者在 Windows 上表示「该盘的当前目录」。
    for (const drive of drives) assert.match(drive.path, /^[A-Z]:\\$/)
    // 名字排序，界面上盘符顺序才稳定。
    assert.deepEqual([...drives.map((drive) => drive.name)].sort(), drives.map((drive) => drive.name))
  } else {
    assert.deepEqual(drives, [{ name: '/', path: '/' }])
  }
})

test('truncation keeps the name-sorted head, and an aborted caller stops the scan', async () => {
  const { listDirectory } = await import('../lib/directory-browse.js')
  const parent = mkdtempSync(join(tmpdir(), 'dsh-trunc-'))
  try {
    // 宿主 browse 后端的契约是「略去的是名字排序后的尾部」（types.ts 的
    // truncated 注释）。按文件系统遍历顺序截断会让每次刷新看到不同子集，
    // 被略掉的也不一定是字典序尾部。
    for (const name of ['m', 'b', 'z', 'a', 'y']) mkdirSync(join(parent, name))
    const listed = await listDirectory(parent, { limit: 2 })
    assert.deepEqual(listed.entries.map((entry) => entry.name), ['a', 'b'])
    assert.equal(listed.truncated, true)

    // 刚好等于上限时不算截断。
    const exact = await listDirectory(parent, { limit: 5 })
    assert.equal(exact.entries.length, 5)
    assert.equal(exact.truncated, false)

    // 调用方已断开：不要继续扫描，也不要报成「读不了」。
    const controller = new AbortController()
    controller.abort()
    const aborted = await listDirectory(parent, { signal: controller.signal })
    assert.deepEqual(aborted.entries, [])
    assert.equal(aborted.truncated, false)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test('the dialog switches drives and jumps to a typed path', async () => {
  const previousLocation = globalThis.location
  globalThis.location = { protocol: 'http:', hostname: '192.168.1.20', host: '192.168.1.20:3080' }
  storage.clear()
  storage.set('dsh-remote-control.secret', 'remote-test')
  resetBrowser()

  const level = (path) => ({
    path,
    home: 'C:\\Users\\me',
    crumbs: [{ name: 'C:\\', path: 'C:\\' }],
    entries: [],
    truncated: false,
  })

  try {
    const ctx = new Context()
    const slots = new SlotsService(ctx)
    new BrowserConnection(ctx)
    await ctx.plugin(clientPlugin).await()

    const flow = slots.registrations.find((item) => item.entry.name === 'sidebar.workspaces.directoryFlow')
    const listed = []
    const props = {
      open: true,
      busy: false,
      onPicked: () => {},
      onCancel: () => {},
      onError: () => {},
      ...flow.entry.inject(),
      listDrives: async () => [{ name: 'C:\\', path: 'C:\\' }, { name: 'D:\\', path: 'D:\\' }],
      listDirectory: async (path) => {
        listed.push(path)
        return level(path ?? 'C:\\Users\\me')
      },
    }

    render(flow.component, props)
    await new Promise((resolve) => setImmediate(resolve))
    let tree = render(flow.component, props)
    assert.equal(dialogPath(tree), 'C:\\Users\\me')

    // 盘符入口：C: 当前、D: 可切。没有它就只能困在 C 盘。
    const driveButtons = findAll(tree, (node) => node?.props?.className === 'dsh-remote-dir-drive')
    assert.equal(driveButtons.length, 2, '应渲染两个盘符')
    driveButtons[1].props.onClick()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(listed.at(-1), 'D:\\', '点击盘符应列举该盘根目录')

    // 路径输入：直接键入绝对路径后回车跳转，不必逐层点。
    tree = render(flow.component, props)
    const pathInput = findElement(tree, (node) => node?.props?.['aria-label'] === '目录路径')
    assert(pathInput, '缺少可编辑路径栏')
    pathInput.props.onChange({ target: { value: 'D:\\games\\save' } })
    tree = render(flow.component, props)
    const edited = findElement(tree, (node) => node?.props?.['aria-label'] === '目录路径')
    assert.equal(edited.props.value, 'D:\\games\\save')
    edited.props.onKeyDown({ key: 'Enter' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(listed.at(-1), 'D:\\games\\save', '回车应跳转到键入的路径')

    // 失焦丢弃未提交的编辑，路径栏回到真实所在目录。
    tree = render(flow.component, props)
    const stale = findElement(tree, (node) => node?.props?.['aria-label'] === '目录路径')
    stale.props.onChange({ target: { value: 'Z:\\nope' } })
    tree = render(flow.component, props)
    findElement(tree, (node) => node?.props?.['aria-label'] === '目录路径').props.onBlur()
    tree = render(flow.component, props)
    assert.equal(dialogPath(tree), 'D:\\games\\save', '未提交的编辑不得留在路径栏')
  } finally {
    globalThis.location = previousLocation
  }
})

test('wheel deltas are converted and clamped for every deltaMode', () => {
  // 滚轮在真实环境里拖得动滚动条却滚不动列表，所以滚轮由我们自己驱动。
  // 这里锁住换算与夹取：像素/行/页三种 deltaMode，以及上下边界。
  const { nextScrollTop } = clientPlugin.internals
  assert.equal(typeof nextScrollTop, 'function')

  const box = { scrollTop: 500, scrollHeight: 2000, clientHeight: 300 }
  assert.equal(nextScrollTop(box, 100, 0), 600, '像素模式：直接相加')
  assert.equal(nextScrollTop(box, -100, 0), 400, '像素模式：向上')
  assert.equal(nextScrollTop(box, 1, 1), 516, '行模式：一行按 16px')
  assert.equal(nextScrollTop(box, -1, 1), 484, '行模式：向上')
  assert.equal(nextScrollTop(box, 1, 2), 800, '页模式：一页按可视高度')
  assert.equal(nextScrollTop(box, 999999, 0), 1700, '夹在底部（scrollHeight - clientHeight）')
  assert.equal(nextScrollTop(box, -999999, 0), 0, '夹在顶部')

  // 内容不比可视区高时不该动，也不该把滚动链吃掉。
  assert.equal(nextScrollTop({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 }, 120, 0), 0)
})

test('the directory list stays scrollable and its buttons never wrap', async () => {
  // 两个真实回归都在 CSS 里，且只看截图才发现：
  //   1. 列表用 min-height:120px + flex 收缩，内容被裁却滚不动；
  //   2. 「创建」按钮被 flex 压成竖排两个字。
  const clientSource = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

  const list = clientSource.match(/\.dsh-remote-dir-list\{[^}]*\}/)
  assert(list, '缺少 .dsh-remote-dir-list 规则')
  assert.match(list[0], /overflow-y:auto/, '列表必须可纵向滚动')
  assert.match(list[0], /max-height:/, '列表必须有确定的高度上限，不能只靠 flex 收缩')
  assert.doesNotMatch(list[0], /min-height:120px/, '旧的 min-height:120px 会让内容裁掉却不滚动')
  assert.match(list[0], /scrollbar-width:thin/, '滚动条要可见，否则用户不知道能滚')

  const card = clientSource.match(/\.dsh-remote-dir-card\{[^}]*\}/)
  assert(card, '缺少 .dsh-remote-dir-card 规则')
  assert.match(card[0], /overflow:hidden/, '卡片要收住溢出内容，圆角才不会被撑破')

  for (const selector of ['\\.dsh-remote-dir-create button', '\\.dsh-remote-dir-actions button']) {
    const rule = clientSource.match(new RegExp(selector + '\\{[^}]*\\}'))
    assert(rule, '缺少 ' + selector + ' 规则')
    assert.match(rule[0], /white-space:nowrap/, selector + ' 不得换行')
    assert.match(rule[0], /flex:none/, selector + ' 不得被 flex 压扁')
  }
})

test('local and desktop clients leave the host directory flow untouched', async () => {
  for (const location of [
    { protocol: 'http:', hostname: 'localhost', host: 'localhost:3080' },
    { protocol: 'http:', hostname: '127.0.0.1', host: '127.0.0.1:49438' },
    { protocol: 'dsh-app:', hostname: 'app', host: 'app' },
  ]) {
    const previousLocation = globalThis.location
    globalThis.location = location
    storage.clear()
    resetBrowser()
    try {
      const ctx = new Context()
      const slots = new SlotsService(ctx)
      new BrowserConnection(ctx)
      await ctx.plugin(clientPlugin).await()
      assert.deepEqual(
        slots.registrations.filter((item) => item.entry.name.endsWith('.directoryFlow')),
        [],
        location.hostname + ' 不得抢占宿主的 directory-flow 孔洞',
      )
    } finally {
      globalThis.location = previousLocation
    }
  }
})
