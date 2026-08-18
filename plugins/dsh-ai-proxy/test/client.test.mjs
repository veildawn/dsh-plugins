import test from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'

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

const openedWindows = []
globalThis.open = (url, target) => {
  const popup = { location: { href: url }, target, closed: false, close() { this.closed = true } }
  openedWindows.push(popup)
  return popup
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
const IconApiOutline14 = (props) => react.createElement('svg', props)
const plugin = definition.factory((id) => {
  if (id === 'react') return react
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return { IconApiOutline14 }
  assert.fail('unexpected browser dependency: ' + id)
})

class SlotsService extends Service {
  constructor(ctx) {
    super(ctx, 'slots')
    this.registrations = []
  }
  inject(_name, install) { return install() }
  register(entry, component) {
    this.registrations.push({ entry, component })
    return () => {}
  }
}

class ConnectionService extends Service {
  constructor(ctx) {
    super(ctx, 'connection')
    this.calls = []
    this.rpc = { call: async (channel, method, payload) => {
      this.calls.push({ channel, method, payload })
      if (method === 'config') return { ok: true, value: { baseURL: 'http://gateway.test', clientId: 'dsh' } }
      if (method === 'setBaseURL') return { ok: true, value: { baseURL: payload.baseURL, clientId: 'dsh' } }
      return {
        ok: true,
        value: method === 'login'
          ? { state: 'authorizing', message: '等待浏览器授权', authorizeUrl: 'https://gateway.test/oauth/authorize?state=local-state' }
          : { state: 'signed-out', message: '未登录' },
      }
    } }
  }
}

class RemoteService extends Service {
  constructor(ctx) { super(ctx, 'remote') }
  $on() { return () => {} }
}

function resetHooks() {
  hooks = []
  effects = []
}

function render(component, props) {
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

function authSlot() {
  const slot = hooks.findIndex((value) => value && typeof value === 'object' && 'state' in value)
  assert(slot >= 0)
  return slot
}

test('browser client registers only the AI Proxy OAuth settings section', async () => {
  assert.deepEqual(plugin.inject, ['slots', 'connection', 'remote'])
  const ctx = new Context()
  const slots = new SlotsService(ctx)
  const connection = new ConnectionService(ctx)
  new RemoteService(ctx)
  await ctx.plugin(plugin).await()

  assert.equal(slots.registrations.length, 1)
  const section = slots.registrations[0]
  assert.deepEqual({ name: section.entry.name, id: section.entry.id, order: section.entry.order }, {
    name: 'settings.section', id: 'ai-proxy', order: 25,
  })
  assert(findElement(section.entry.label(), (node) => node?.type === IconApiOutline14))
  assert.equal(section.entry.inject().remoteRequest, undefined)

  const props = section.entry.inject()
  render(section.component, props)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(connection.calls, [
    { channel: '/ai-proxy-auth', method: 'config', payload: {} },
    { channel: '/ai-proxy-auth', method: 'status', payload: {} },
  ])
  assert.equal(connection.calls.some((call) => call.channel.includes('remote-control')), false)

  let view = render(section.component, props)
  const gateway = findElement(view, (node) => node?.type === 'input' && node.props['aria-label'] === '网关地址')
  assert.equal(gateway.props.value, 'http://gateway.test')
  gateway.props.onChange({ target: { value: 'http://gateway-2.test/' } })
  view = render(section.component, props)
  await findElement(view, (node) => node?.type === 'button' && node.props.children.includes('登录')).props.onClick()
  assert.deepEqual(connection.calls.at(-2), {
    channel: '/ai-proxy-auth', method: 'setBaseURL', payload: { baseURL: 'http://gateway-2.test' },
  })
  assert.deepEqual(connection.calls.at(-1), { channel: '/ai-proxy-auth', method: 'login', payload: {} })
  assert.equal(openedWindows.at(-1).location.href, 'https://gateway.test/oauth/authorize?state=local-state')
  assert(findElement(render(section.component, props), (node) => node?.type === 'a' && node.props.target === '_blank'))

  hooks[authSlot()] = { state: 'signed-in', message: '已登录' }
  view = render(section.component, props)
  assert(findElement(view, (node) => node?.type === 'button' && node.props.children.includes('退出登录')))
  assert.equal(findElement(view, (node) => node?.props?.['aria-label'] === '远程访问密钥'), undefined)
})

test('invalid gateways are rejected before an OAuth request', async () => {
  resetHooks()
  const ctx = new Context()
  const slots = new SlotsService(ctx)
  const connection = new ConnectionService(ctx)
  new RemoteService(ctx)
  await ctx.plugin(plugin).await()
  const section = slots.registrations[0]
  const props = section.entry.inject()
  render(section.component, props)
  await new Promise((resolve) => setImmediate(resolve))
  let view = render(section.component, props)
  findElement(view, (node) => node?.props?.['aria-label'] === '网关地址').props.onChange({ target: { value: 'ftp://invalid' } })
  view = render(section.component, props)
  assert.equal(findElement(view, (node) => node?.type === 'button' && node.props.children.includes('登录')).props.disabled, true)
})
