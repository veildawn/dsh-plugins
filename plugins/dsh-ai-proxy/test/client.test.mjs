import test from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'

let definition
const previousWindow = globalThis.window
globalThis.window = {
  __ModuleLoader__: {
    load(value) {
      definition = value
    },
  },
}
await import('../lib/client.js')
globalThis.window = previousWindow

const remoteSecretStore = new Map()
const openedWindows = []
globalThis.open = (url, target) => {
  const popup = { location: { href: url }, target, closed: false, close() { this.closed = true } }
  openedWindows.push(popup)
  return popup
}
globalThis.localStorage = {
  getItem: (key) => remoteSecretStore.get(key) ?? null,
  setItem: (key, value) => remoteSecretStore.set(key, String(value)),
  removeItem: (key) => remoteSecretStore.delete(key),
}

const stateWrites = []
let hooks = []
let hookIndex = 0
let effects = []
let effectIndex = 0
const react = {
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  useState: (initial) => {
    const slot = hookIndex++
    if (hooks[slot] === undefined) hooks[slot] = typeof initial === 'function' ? initial() : initial
    return [hooks[slot], (next) => {
      hooks[slot] = typeof next === 'function' ? next(hooks[slot]) : next
      stateWrites.push(hooks[slot])
    }]
  },
  useEffect: (effect, deps) => {
    const slot = effectIndex++
    const previous = effects[slot]
    if (previous && deps?.every((value, index) => Object.is(value, previous.deps?.[index]))) return
    previous?.cleanup?.()
    effects[slot] = { deps, cleanup: effect() }
  },
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
}
const IconApiOutline14 = (props) => react.createElement('svg', props)
const IconGlobeOutline14 = (props) => react.createElement('svg', props)
const BrandWordmark = (props) => react.createElement('svg', props)

const plugin = definition.factory((id) => {
  if (id === 'react') return react
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return { BrandWordmark, IconApiOutline14, IconGlobeOutline14 }
  assert.fail('unexpected browser dependency: ' + id)
})

class SlotsService extends Service {
  constructor(ctx) {
    super(ctx, 'slots')
    this.registrations = []
  }

  inject(_name, install) {
    return install()
  }

  register(entry, component) {
    const registration = { entry, component }
    this.registrations.push(registration)
    return () => {
      this.registrations = this.registrations.filter((candidate) => candidate !== registration)
    }
  }
}

class ConnectionService extends Service {
  constructor(ctx) {
    super(ctx, 'connection')
    this.calls = []
    this.api = {
      settings: {
        describe: async () => { throw new Error('transport failure for /api/settings.describe: HTTP 403') },
      },
    }
    this.rpc = {
      call: async (channel, method, payload) => {
        this.calls.push({ channel, method, payload })
        if (channel === '/ai-proxy-remote-control') {
          return method === 'status'
            ? { ok: true, value: { enabled: true, secretConfigured: true, authenticated: payload.token === 'remote-test' } }
            : method === 'call'
              ? payload.method === 'aiProxy.gateway'
                ? { ok: true, value: { baseURL: 'http://gateway.test', clientId: 'dsh' } }
                : payload.method === 'aiProxy.status'
                  ? { ok: true, value: { state: 'signed-out', message: '未登录' } }
                  : payload.method === 'aiProxy.login'
                    ? { ok: true, value: { state: 'authorizing', message: '等待浏览器授权', authorizeUrl: 'https://gateway.test/oauth/authorize?redirect_uri=https%3A%2F%2Fgateway.test%2Foauth%2Fcode&state=remote-state' } }
                    : payload.method === 'aiProxy.completeLogin'
                      ? { ok: true, value: { state: 'signed-in', message: '已登录' } }
                  : payload.method === 'aiProxy.setBaseURL'
                    ? { ok: true, value: { baseURL: payload.payload.baseURL, clientId: 'dsh' } }
                    : { ok: true, value: { proxied: true } }
              : { ok: false, error: { message: 'unexpected remote method' } }
        }
        if (method === 'config') {
          return { ok: true, value: { baseURL: 'http://gateway.test', clientId: 'dsh' } }
        }
        if (method === 'remoteConfig') {
          return { ok: true, value: { enabled: false, secretConfigured: false } }
        }
        if (method === 'setRemoteSecret' || method === 'setRemoteAccess') {
          return { ok: true, value: { enabled: payload.enabled ?? false, secretConfigured: true } }
        }
        if (method === 'setBaseURL') {
          return { ok: true, value: { baseURL: payload.baseURL, clientId: 'dsh' } }
        }
        return {
          ok: true,
          value: method === 'login'
            ? { state: 'authorizing', message: '等待浏览器授权', authorizeUrl: 'https://gateway.test/oauth/authorize?state=local-state' }
            : { state: 'signed-out', message: '未登录' },
        }
      },
    }
  }
}

class RemoteService extends Service {
  constructor(ctx) {
    super(ctx, 'remote')
  }
  $on() { return () => {} }
}

function findElement(node, predicate) {
  if (predicate(node)) return node
  for (const child of node?.props?.children ?? []) {
    const found = findElement(child, predicate)
    if (found) return found
  }
  return undefined
}

function authSlotOf() {
  const slot = hooks.findIndex((value) => value && typeof value === 'object' && 'state' in value)
  assert(slot >= 0, 'auth state slot found')
  return slot
}

function resetHooks() {
  hooks = []
  effects = []
}

function beginRender() {
  hookIndex = 0
  effectIndex = 0
}

test('browser half registers independent AI Proxy and Remote Control settings sections', async () => {
  assert.deepEqual(plugin.inject, ['slots', 'connection', 'remote'])

  const ctx = new Context()
  const slots = new SlotsService(ctx)
  const connection = new ConnectionService(ctx)
  new RemoteService(ctx)

  const fiber = ctx.plugin(plugin)
  await fiber.await()
  assert.equal(fiber.state, 2)
  assert.equal(slots.registrations.length, 2, 'AI Proxy and Remote Control are independent settings sections')

  const section = slots.registrations.find((registration) => registration.entry.id === 'ai-proxy')
  const remoteSection = slots.registrations.find((registration) => registration.entry.id === 'remote-control')
  assert.equal(section.entry.name, 'settings.section')
  assert.equal(remoteSection.entry.name, 'settings.section')
  assert.equal(section.entry.order, 25)
  assert.equal(remoteSection.entry.order, 26)
  const label = section.entry.label()
  const remoteLabel = remoteSection.entry.label()
  assert.equal(label.props['data-settings-nav-label'], 'ai-proxy')
  assert.equal(remoteLabel.props['data-settings-nav-label'], 'remote-control')
  assert(findElement(label, (node) => node?.type === IconApiOutline14), 'the AI Proxy nav uses the API icon')
  assert(findElement(remoteLabel, (node) => node?.type === IconGlobeOutline14), 'the Remote Control nav uses the globe icon')
  const injected = section.entry.inject()
  assert.equal(typeof injected.authRequest, 'function')
  assert.equal(injected.remoteRequest, undefined, 'AI Proxy does not receive Remote Control actions')

  const render = () => {
    beginRender()
    return section.component(injected)
  }
  render()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(connection.calls[0], { channel: '/ai-proxy-auth', method: 'config', payload: {} })
  assert.deepEqual(connection.calls[1], { channel: '/ai-proxy-auth', method: 'status', payload: {} })
  assert.equal(connection.calls.length, 2, 'AI Proxy does not load Remote Control state')

  // Signed out: the gateway is editable and login persists it first.
  const view = render()
  const gateway = findElement(view, (node) => node?.type === 'input' && node.props['aria-label'] === '网关地址')
  assert.equal(gateway.props.value, 'http://gateway.test')
  assert.equal(gateway.props.disabled, false, 'the gateway address is editable while signed out')
  await gateway.props.onChange({ target: { value: 'http://gateway-2.test/' } })
  const editedView = render()
  await findElement(editedView, (node) => node?.type === 'button' && node.props.children.includes('登录')).props.onClick()
  assert.deepEqual(connection.calls.at(-2), { channel: '/ai-proxy-auth', method: 'setBaseURL', payload: { baseURL: 'http://gateway-2.test' } })
  assert.deepEqual(connection.calls.at(-1), { channel: '/ai-proxy-auth', method: 'login', payload: {} })
  assert(stateWrites.some((value) => value?.state === 'authorizing'))
  assert.equal(openedWindows.at(-1).location.href, 'https://gateway.test/oauth/authorize?state=local-state')
  assert.equal(findElement(render(), (node) => node?.type === 'a' && node.props.children.includes('点击前往授权')).props.target, '_blank')

  // An unchanged gateway is not rewritten on a later login.
  resetHooks()
  connection.calls = []
  render()
  await new Promise((resolve) => setImmediate(resolve))
  await findElement(render(), (node) => node?.type === 'button' && node.props.children.includes('登录')).props.onClick()
  assert(!connection.calls.some((call) => call.method === 'setBaseURL'), 'an unchanged gateway is not rewritten')

  // Signed in with an edited address: a save button persists through the Host channel.
  resetHooks()
  connection.calls = []
  render()
  await new Promise((resolve) => setImmediate(resolve))
  hooks[authSlotOf()] = { state: 'signed-in', message: '已登录' }
  const signedInInput = findElement(render(), (node) => node?.type === 'input' && node.props['aria-label'] === '网关地址')
  assert.equal(signedInInput.props.disabled, false, 'the gateway address stays editable while signed in')
  await signedInInput.props.onChange({ target: { value: 'http://gateway-3.test' } })
  const dirtyView = render()
  const save = findElement(dirtyView, (node) => node?.type === 'button' && node.props.children.includes('保存'))
  assert(save, 'a changed address shows a save button while signed in')
  await save.props.onClick()
  assert.deepEqual(connection.calls.at(-1), { channel: '/ai-proxy-auth', method: 'setBaseURL', payload: { baseURL: 'http://gateway-3.test' } })
  assert(findElement(dirtyView, (node) => node?.type === 'button' && node.props.children.includes('退出登录')), 'a signed-in card offers logout')
  assert.equal(findElement(dirtyView, (node) => node?.type === 'input' && node.props['aria-label'] === '远程访问密钥'), undefined)
  assert(findElement(dirtyView, (node) => node?.type === 'p' && node.props.children.includes('模型调用与用量由 AI Proxy 网关统一统计。')))

  // The independent Remote Control section keeps the browser copy of the
  // secret and uses its dedicated channel.
  resetHooks()
  connection.calls = []
  const remoteInjected = remoteSection.entry.inject()
  const renderRemote = () => {
    beginRender()
    return remoteSection.component(remoteInjected)
  }
  renderRemote()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(connection.calls, [{ channel: '/ai-proxy-auth', method: 'remoteConfig', payload: {} }])
  let remoteView = renderRemote()
  assert(findElement(remoteView, (node) => node?.type === 'h2' && node.props.children.includes('远程控制 (Remote Control)')))
  assert.equal(findElement(remoteView, (node) => node?.type === 'input' && node.props['aria-label'] === '网关地址'), undefined)
  assert(findElement(remoteView, (node) => node?.type === 'p' && node.props.children.includes('访问环境: 本机访问')))
  const secret = findElement(remoteView, (node) => node?.type === 'input' && node.props['aria-label'] === '远程访问密钥')
  await secret.props.onChange({ target: { value: 'remote-test' } })
  remoteView = renderRemote()
  const verify = findElement(remoteView, (node) => node?.type === 'button' && node.props.children.includes('验证密钥'))
  await verify.props.onClick()
  assert.deepEqual(connection.calls.at(-1), {
    channel: '/ai-proxy-remote-control', method: 'status', payload: { token: 'remote-test' },
  })
  assert.deepEqual(await connection.api.settings.describe({}), {
    rpcId: 'remote-control', result: { ok: true, value: { proxied: true } },
  })
  assert.deepEqual(connection.calls.at(-1), {
    channel: '/ai-proxy-remote-control', method: 'call',
    payload: { method: 'settings.describe', payload: {}, token: 'remote-test' },
  })
})

test('remote host renders only the lock gate until a localStorage secret is verified', async (t) => {
  const previousLocation = globalThis.location
  globalThis.location = { hostname: 'remote.example', host: 'remote.example' }
  t.after(() => { globalThis.location = previousLocation })
  remoteSecretStore.clear()
  resetHooks()

  const ctx = new Context()
  const slots = new SlotsService(ctx)
  const connection = new ConnectionService(ctx)
  new RemoteService(ctx)
  const fiber = ctx.plugin(plugin)
  await fiber.await()

  const gate = slots.registrations.find((registration) => registration.entry.name === 'root')
  const sections = slots.registrations.filter((registration) => registration.entry.name === 'settings.section')
  const section = sections.find((registration) => registration.entry.id === 'remote-control')
  assert(gate, 'remote access shadows the application root')
  assert.equal(gate.entry.priority, -100)
  assert.deepEqual(sections.map((registration) => registration.entry.id), ['ai-proxy', 'remote-control'])
  assert(section, 'Remote Control remains registered but is not mounted under the shadowed root')
  assert.equal(connection.calls.length, 0, 'the client makes no application request before the gate mounts')

  const renderGate = () => {
    beginRender()
    return gate.component({})
  }
  let view = renderGate()
  assert(findElement(view, (node) => node?.type === 'h1' && node.props.children.includes('远程工作区已锁定')))
  assert(findElement(view, (node) => node?.type === BrandWordmark), 'the gate uses the official BrandWordmark primitive')
  const designStyle = findElement(view, (node) => node?.type === 'style' && node.props.children[0]?.includes('--dsw-alias-background-base'))
  assert(designStyle, 'the gate and settings share the official design tokens')
  assert.match(designStyle.props.children[0], /--dsw-alias-(background-surface|label-primary|border-default|brand-primary)/)
  assert.doesNotMatch(designStyle.props.children[0], /gradient/)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(connection.calls, [{
    channel: '/ai-proxy-remote-control', method: 'status', payload: { token: '' },
  }], 'the locked root performs only its authentication status request')

  view = renderGate()
  const secret = findElement(view, (node) => node?.type === 'input' && node.props['aria-label'] === '远程访问密钥')
  assert.equal(secret.props.disabled, false)
  secret.props.onChange({ target: { value: 'remote-test' } })
  view = renderGate()
  const form = findElement(view, (node) => node?.type === 'form')
  form.props.onSubmit({ preventDefault() {} })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(slots.registrations.some((registration) => registration.entry.name === 'root'), false, 'unlock restores the official root')
  assert.equal(remoteSecretStore.get('dsh-ai-proxy.remote-control-secret'), 'remote-test')
  assert.deepEqual(connection.calls.at(-1), {
    channel: '/ai-proxy-remote-control', method: 'status', payload: { token: 'remote-test' },
  })

  await connection.api.settings.describe({})
  assert.deepEqual(connection.calls.at(-1), {
    channel: '/ai-proxy-remote-control', method: 'call',
    payload: { method: 'settings.describe', payload: {}, token: 'remote-test' },
  }, 'remote privileged RPC goes straight through the authenticated channel')

  const aiSection = sections.find((registration) => registration.entry.id === 'ai-proxy')
  resetHooks()
  connection.calls = []
  const aiInjected = aiSection.entry.inject()
  const renderAi = () => {
    beginRender()
    return aiSection.component(aiInjected)
  }
  renderAi()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(connection.calls, [
    {
      channel: '/ai-proxy-remote-control', method: 'call',
      payload: { method: 'aiProxy.gateway', payload: {}, token: 'remote-test' },
    },
    {
      channel: '/ai-proxy-remote-control', method: 'call',
      payload: { method: 'aiProxy.status', payload: {}, token: 'remote-test' },
    },
  ], 'remote AI Proxy reads use the authenticated channel')
  const login = findElement(renderAi(), (node) => node?.type === 'button' && node.props.children.includes('登录'))
  await login.props.onClick()
  assert.deepEqual(connection.calls.at(-1), {
    channel: '/ai-proxy-remote-control', method: 'call',
    payload: { method: 'aiProxy.login', payload: {}, token: 'remote-test' },
  })
  let authorizingView = renderAi()
  const authorizeLink = findElement(authorizingView, (node) => node?.type === 'a' && node.props.children.includes('点击前往授权'))
  assert.equal(new URL(authorizeLink.props.href).searchParams.get('redirect_uri'), 'https://gateway.test/oauth/code')
  const oauthCode = findElement(authorizingView, (node) => node?.type === 'input' && node.props['aria-label'] === 'OAuth 授权码')
  oauthCode.props.onChange({ target: { value: 'mock-code#remote-state' } })
  authorizingView = renderAi()
  await findElement(authorizingView, (node) => node?.type === 'button' && node.props.children.includes('完成登录')).props.onClick()
  assert.deepEqual(connection.calls.at(-1), {
    channel: '/ai-proxy-remote-control', method: 'call',
    payload: { method: 'aiProxy.completeLogin', payload: { code: 'mock-code', state: 'remote-state' }, token: 'remote-test' },
  })
  assert.equal(hooks[authSlotOf()].state, 'signed-in')

  const gateway = findElement(renderAi(), (node) => node?.type === 'input' && node.props['aria-label'] === '网关地址')
  gateway.props.onChange({ target: { value: 'https://aps.veildawn.com' } })
  const save = findElement(renderAi(), (node) => node?.type === 'button' && node.props.children.includes('保存'))
  await save.props.onClick()
  assert.deepEqual(connection.calls.at(-1), {
    channel: '/ai-proxy-remote-control', method: 'call',
    payload: {
      method: 'aiProxy.setBaseURL',
      payload: { baseURL: 'https://aps.veildawn.com' },
      token: 'remote-test',
    },
  }, 'remote gateway writes never touch the loopback-only auth channel')
  assert.equal(connection.calls.some((call) => call.channel === '/ai-proxy-auth'), false)

  resetHooks()
  const injected = section.entry.inject()
  beginRender()
  let settingsView = section.component(injected)
  await new Promise((resolve) => setImmediate(resolve))
  beginRender()
  settingsView = section.component(injected)
  assert(findElement(settingsView, (node) => node?.type === 'p' && node.props.children.includes('访问环境: 远程访问')))
  assert(findElement(settingsView, (node) => node?.type === 'p' && node.props.children.includes('当前 Host: remote.example')))
  const lock = findElement(settingsView, (node) => node?.type === 'button' && node.props.children.includes('锁定远程会话 / 清除本地凭证'))
  assert(lock)
  lock.props.onClick()
  assert.equal(remoteSecretStore.has('dsh-ai-proxy.remote-control-secret'), false)
  assert(slots.registrations.some((registration) => registration.entry.name === 'root'), 'locking re-mounts the remote gate')
})

test('remote host silently verifies a stored secret and only mounts the gate when it is stale', async (t) => {
  const previousLocation = globalThis.location
  globalThis.location = { hostname: 'remote.example', host: 'remote.example' }
  t.after(() => { globalThis.location = previousLocation })

  remoteSecretStore.set('dsh-ai-proxy.remote-control-secret', 'remote-test')
  resetHooks()
  const validCtx = new Context()
  const validSlots = new SlotsService(validCtx)
  const validConnection = new ConnectionService(validCtx)
  new RemoteService(validCtx)
  await validCtx.plugin(plugin).await()

  assert.equal(validSlots.registrations.some((registration) => registration.entry.name === 'root'), false, 'a stored secret never flashes the lock gate')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(validConnection.calls[0], {
    channel: '/ai-proxy-remote-control', method: 'status', payload: { token: 'remote-test' },
  })
  assert.equal(validSlots.registrations.some((registration) => registration.entry.name === 'root'), false, 'a valid secret keeps the application root visible')

  remoteSecretStore.set('dsh-ai-proxy.remote-control-secret', 'stale')
  resetHooks()
  const staleCtx = new Context()
  const staleSlots = new SlotsService(staleCtx)
  new ConnectionService(staleCtx)
  new RemoteService(staleCtx)
  await staleCtx.plugin(plugin).await()
  await new Promise((resolve) => setImmediate(resolve))

  const gate = staleSlots.registrations.find((registration) => registration.entry.name === 'root')
  assert(gate, 'an invalid stored secret mounts the lock gate after silent verification')
  assert.equal(remoteSecretStore.has('dsh-ai-proxy.remote-control-secret'), false, 'an invalid stored secret is cleared')
  beginRender()
  const view = gate.component({})
  assert(findElement(view, (node) => node?.type === 'p' && node.props.children.includes('保存的访问密钥已失效，请重新输入')))
})
