import test from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import * as plugin from '../lib/index.js'

const {
  CONFIG_RPC_CHANNEL,
  REMOTE_CONTROL_RPC_CHANNEL,
  REMOTE_CONTROL_RPC_ALIASES,
  REMOTE_CONTROL_SECRET_REF,
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
  }
  tapIndex(fn) {
    this.taps.push(fn)
    return () => {
      const idx = this.taps.indexOf(fn)
      if (idx !== -1) this.taps.splice(idx, 1)
    }
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

function makeHost() {
  const ctx = new Context()
  const settings = new MemorySettings(ctx)
  const credentials = new FakeCredentials(ctx)
  const connection = new FakeConnection(ctx)
  const webServer = new FakeWebServer(ctx)
  const apiProxy = new FakeApiProxy(ctx)
  return { ctx, settings, credentials, connection, webServer, apiProxy }
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

  assert.deepEqual(await configure('status', {}), {
    ok: true, value: { enabled: false, secretConfigured: false },
  })
  assert.equal((await configure('setEnabled', { enabled: 'yes' })).ok, false)
  assert.equal((await configure('setSecret', { secret: 'remote-test', extra: true })).ok, false)
  assert.deepEqual(await configure('setSecret', { secret: '  remote-test  ' }), {
    ok: true, value: { enabled: false, secretConfigured: true },
  })
  assert.equal(credentials.store.get(REMOTE_CONTROL_SECRET_REF), 'remote-test')
  assert.deepEqual(await configure('setEnabled', { enabled: true }), {
    ok: true, value: { enabled: true, secretConfigured: true },
  })
  assert.equal(settings.doc['remote-control'].enabled, true)

  assert.deepEqual(await remote('status', { token: 'remote-test' }), {
    ok: true, value: { enabled: true, secretConfigured: true, authenticated: true },
  })
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
  assert.deepEqual(await configure('setSecret', { secret: '' }), {
    ok: true, value: { enabled: true, secretConfigured: false },
  })
  assert.equal(credentials.store.has(REMOTE_CONTROL_SECRET_REF), false)
  assert.equal((await remote('call', { token: 'remote-test', method: 'settings.describe', payload: {} })).ok, false)
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
let effects = []
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
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
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
  inject(_name, install) { return install() }
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
  effects = []
}

function render(component, props = {}) {
  hookIndex = 0
  effectIndex = 0
  return component(props)
}

function findElement(node, predicate) {
  if (predicate(node)) return node
  for (const child of node?.props?.children ?? []) {
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
    const section = slots.registrations.find((item) => item.entry.id === 'remote-control')
    assert(section)
    assert.equal(section.entry.order, 26)
    assert(findElement(section.entry.label(), (node) => node?.type === IconGlobeOutline14))
    render(section.component, section.entry.inject())
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(connection.calls, [{ channel: CONFIG_RPC_CHANNEL, method: 'status', payload: {} }])
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
