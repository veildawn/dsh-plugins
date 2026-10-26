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
      if (method === 'config') return { ok: true, value: { baseURL: 'http://gateway.test', clientId: 'dsh', apiFormat: 'chat/completions', defaultReasoningEffort: 'highest', maxContextWindow: 1000000, endpoint: 'http://gateway.test/v1/chat/completions' } }
      if (method === 'setGateway') return { ok: true, value: { baseURL: payload.baseURL, clientId: 'dsh', apiFormat: payload.apiFormat || 'chat/completions', defaultReasoningEffort: payload.defaultReasoningEffort ?? 'highest', maxContextWindow: payload.maxContextWindow === '' || payload.maxContextWindow === undefined ? 1000000 : payload.maxContextWindow, endpoint: 'http://gateway.test/v1/chat/completions' } }
      if (method === 'setBaseURL') return { ok: true, value: { baseURL: payload.baseURL, clientId: 'dsh' } }
      if (method === 'refreshModels') return { ok: true, value: { count: 5, models: [] } }
      return {
        ok: true,
        value: method === 'login'
          ? { state: 'authorizing', message: '等待浏览器授权', authorizeUrl: 'https://gateway.test/oauth/authorize?state=local-state', clientId: 'dsh-a1b2c3d4' }
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
  
  const apiFormatSelect = findElement(view, (node) => node?.type === 'select' && node.props['aria-label'] === 'API 格式')
  assert.equal(apiFormatSelect.props.value, 'chat/completions')
  assert.equal(apiFormatSelect.props.children.length, 3)

  const effortSwitch = findElement(view, (node) => node?.type === 'input' && node.props['aria-label'] === '最高推理强度')
  assert.equal(effortSwitch.props.checked, true)

  gateway.props.onChange({ target: { value: 'http://gateway-2.test/' } })
  view = render(section.component, props)
  await findElement(view, (node) => node?.type === 'button' && node.props.children.includes('登录')).props.onClick()
  assert.deepEqual(connection.calls.at(-2), {
    channel: '/ai-proxy-auth', method: 'setGateway', payload: { baseURL: 'http://gateway-2.test', apiFormat: 'chat/completions', defaultReasoningEffort: 'highest', maxContextWindow: 1000000 },
  })
  assert.deepEqual(connection.calls.at(-1), { channel: '/ai-proxy-auth', method: 'login', payload: {} })
  view = render(section.component, props)
  assert.equal(findElement(view, (node) => node?.type === 'input' && node.props['aria-label'] === 'Client ID').props.value, 'dsh-a1b2c3d4')
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

test('toggling highest reasoning effort sets defaultReasoningEffort to lowest', async () => {
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

  // Simulate signed-in
  hooks[authSlot()] = { state: 'signed-in', message: '已登录' }
  let view = render(section.component, props)

  const effortSwitch = findElement(view, (node) => node?.type === 'input' && node.props['aria-label'] === '最高推理强度')
  assert.equal(effortSwitch.props.checked, true)

  effortSwitch.props.onChange({ target: { checked: false } })
  view = render(section.component, props)

  const saveBtn = findElement(view, (node) => node?.type === 'button' && node.props.children.includes('保存'))
  assert(saveBtn)
  await saveBtn.props.onClick()

  assert.deepEqual(connection.calls.at(-1), {
    channel: '/ai-proxy-auth',
    method: 'setGateway',
    payload: { baseURL: 'http://gateway.test', apiFormat: 'chat/completions', defaultReasoningEffort: 'lowest', maxContextWindow: 1000000 },
  })
})

test("clicking refresh models button triggers refreshModels RPC call", async () => {
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

  // Simulate signed-in
  hooks[authSlot()] = { state: "signed-in", message: "已登录" }
  let view = render(section.component, props)

  const refreshBtn = findElement(view, (node) => node?.type === "button" && node.props.children.includes("重新获取模型列表"))
  assert(refreshBtn, "refresh models button should exist when signed-in")
  await refreshBtn.props.onClick()

  assert.deepEqual(connection.calls.at(-1), {
    channel: "/ai-proxy-auth",
    method: "refreshModels",
    payload: {},
  })

  // Verify auth message updated with count
  const authState = hooks[authSlot()]
  assert.equal(authState.state, "signed-in")
  assert.match(authState.message, /已刷新模型列表 \(共 5 个模型\)/)
})

test("editing clientId persists through setGateway RPC", async () => {
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

  // Simulate signed-in
  hooks[authSlot()] = { state: "signed-in", message: "已登录" }
  let view = render(section.component, props)

  const clientIdInput = findElement(view, (node) => node?.type === "input" && node.props["aria-label"] === "Client ID")
  assert(clientIdInput, "Client ID input should be rendered")
  assert.equal(clientIdInput.props.value, "dsh")

  clientIdInput.props.onChange({ target: { value: "dsh-laptop-1" } })
  view = render(section.component, props)

  const saveBtn = findElement(view, (node) => node?.type === "button" && node.props.children.includes("保存"))
  assert(saveBtn)
  await saveBtn.props.onClick()

  assert.deepEqual(connection.calls.at(-1), {
    channel: "/ai-proxy-auth",
    method: "setGateway",
    payload: { baseURL: "http://gateway.test", clientId: "dsh-laptop-1", apiFormat: "chat/completions", defaultReasoningEffort: "highest", maxContextWindow: 1000000 },
  })
})

test("context ceiling field loads, formats and persists through setGateway RPC", async () => {
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

  hooks[authSlot()] = { state: "signed-in", message: "已登录" }
  let view = render(section.component, props)

  // The stored token count is spelled back in its shortest round-tripping form.
  const capInput = findElement(view, (node) => node?.type === "input" && node.props["aria-label"] === "上下文上限")
  assert(capInput, "context ceiling input should be rendered")
  assert.equal(capInput.props.value, "1M")

  capInput.props.onChange({ target: { value: "2M" } })
  view = render(section.component, props)
  let saveBtn = findElement(view, (node) => node?.type === "button" && node.props.children.includes("保存"))
  assert(saveBtn, "editing the ceiling marks the config dirty")
  await saveBtn.props.onClick()

  assert.deepEqual(connection.calls.at(-1), {
    channel: "/ai-proxy-auth",
    method: "setGateway",
    payload: {
      baseURL: "http://gateway.test",
      apiFormat: "chat/completions",
      defaultReasoningEffort: "highest",
      maxContextWindow: 2000000,
    },
  })

  // A lowercase suffix parses the same way.
  view = render(section.component, props)
  findElement(view, (node) => node?.type === "input" && node.props["aria-label"] === "上下文上限")
    .props.onChange({ target: { value: "300k" } })
  view = render(section.component, props)
  saveBtn = findElement(view, (node) => node?.type === "button" && node.props.children.includes("保存"))
  await saveBtn.props.onClick()
  assert.equal(connection.calls.at(-1).payload.maxContextWindow, 300000)

  // A plain number needs no suffix at all.
  view = render(section.component, props)
  findElement(view, (node) => node?.type === "input" && node.props["aria-label"] === "上下文上限")
    .props.onChange({ target: { value: "262144" } })
  view = render(section.component, props)
  saveBtn = findElement(view, (node) => node?.type === "button" && node.props.children.includes("保存"))
  await saveBtn.props.onClick()
  assert.equal(connection.calls.at(-1).payload.maxContextWindow, 262144)
})

test("an unreadable context ceiling blocks saving instead of silently defaulting", async () => {
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

  hooks[authSlot()] = { state: "signed-in", message: "已登录" }
  let view = render(section.component, props)
  findElement(view, (node) => node?.type === "input" && node.props["aria-label"] === "上下文上限")
    .props.onChange({ target: { value: "500G" } })
  view = render(section.component, props)

  assert.equal(
    findElement(view, (node) => node?.type === "button" && node.props.children.includes("保存")),
    undefined,
    "an unreadable ceiling hides the save button",
  )
  assert(findElement(view, (node) => node?.props?.className === "ai-proxy-error" && /上下文上限/.test(node.props.children)))

  // The sign-in path is blocked by the same validation.
  hooks[authSlot()] = { state: "signed-out", message: "未登录" }
  view = render(section.component, props)
  const loginBtn = findElement(view, (node) => node?.type === "button" && node.props.children.includes("登录"))
  assert.equal(loginBtn.props.disabled, true)
})

test("clearing the context ceiling asks the host for the documented default", async () => {
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

  hooks[authSlot()] = { state: "signed-in", message: "已登录" }
  let view = render(section.component, props)
  findElement(view, (node) => node?.type === "input" && node.props["aria-label"] === "上下文上限")
    .props.onChange({ target: { value: "  " } })
  view = render(section.component, props)

  // Blank is valid: it means "no override", not "unreadable".
  const saveBtn = findElement(view, (node) => node?.type === "button" && node.props.children.includes("保存"))
  assert(saveBtn, "clearing the field is a valid edit")
  await saveBtn.props.onClick()
  assert.equal(connection.calls.at(-1).payload.maxContextWindow, "",
    "the empty string asks the host to reset the field to its default")
})

test("equivalent context ceiling spellings do not mark the card dirty", async () => {
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

  hooks[authSlot()] = { state: "signed-in", message: "已登录" }
  let view = render(section.component, props)
  const capInput = findElement(view, (node) => node?.type === "input" && node.props["aria-label"] === "上下文上限")
  assert.equal(capInput.props.value, "1M")

  // `1m` and `1000000` parse to the stored 1000000, so nothing changed.
  for (const spelling of ["1m", "1000000"]) {
    capInput.props.onChange({ target: { value: spelling } })
    view = render(section.component, props)
    assert.equal(
      findElement(view, (node) => node?.type === "button" && node.props.children.includes("保存")),
      undefined,
      spelling + " is the same ceiling, so there is nothing to save",
    )
    findElement(view, (node) => node?.type === "input" && node.props["aria-label"] === "上下文上限")
      .props.onChange({ target: { value: "1M" } })
    view = render(section.component, props)
  }
})

test("the card's default ceiling matches the host's own constant", async () => {
  // lib/client.js is a standalone browser bundle and cannot import lib/index.js
  // (that module pulls in node:crypto), so the default is spelled out on both
  // sides. A drift here would show one ceiling before the config RPC answers
  // and another afterwards, so pin the two together.
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const { dirname, join } = await import('node:path')
  const here = dirname(fileURLToPath(import.meta.url))
  const hostSource = readFileSync(join(here, '..', 'lib', 'index.js'), 'utf8')
  const clientSource = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

  const hostDefault = /export const DEFAULT_MAX_CONTEXT_WINDOW = (\d+)/.exec(hostSource)
  const clientDefault = /const DEFAULT_MAX_CONTEXT_WINDOW = (\d+)/.exec(clientSource)
  assert(hostDefault, 'the host declares DEFAULT_MAX_CONTEXT_WINDOW')
  assert(clientDefault, 'the card declares DEFAULT_MAX_CONTEXT_WINDOW')
  assert.equal(clientDefault[1], hostDefault[1],
    'the card and the host must agree on the default ceiling')
  assert.equal(hostDefault[1], '1000000', 'the documented default is 1M')
})

test("a context ceiling below the floor is refused and explained in the card", async () => {
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

  hooks[authSlot()] = { state: "signed-in", message: "已登录" }
  let view = render(section.component, props)

  // The floor is documented under the field, next to the units it shares.
  const details = []
  const collect = (node) => {
    if (!node || typeof node !== "object") return
    if (node.props?.className === "ai-proxy-details") details.push([].concat(node.props.children).join(""))
    for (const child of node.props?.children ?? []) collect(child)
  }
  collect(view)
  assert(details.some((text) => text.includes("128K")),
    "the card must state the 128K floor: " + JSON.stringify(details))

  const capInput = findElement(view, (node) => node?.type === "input" && node.props["aria-label"] === "上下文上限")

  // One token under the floor blocks saving and shows the reason.
  capInput.props.onChange({ target: { value: "127K" } })
  view = render(section.component, props)
  assert.equal(
    findElement(view, (node) => node?.type === "button" && node.props.children.includes("保存")),
    undefined,
    "a sub-floor ceiling hides the save button",
  )
  assert(findElement(view, (node) => node?.props?.className === "ai-proxy-error" && /128K/.test(node.props.children)))

  // The floor itself is accepted.
  capInput.props.onChange({ target: { value: "128K" } })
  view = render(section.component, props)
  const saveBtn = findElement(view, (node) => node?.type === "button" && node.props.children.includes("保存"))
  assert(saveBtn, "the floor is a legal value")
  await saveBtn.props.onClick()
  assert.equal(connection.calls.at(-1).payload.maxContextWindow, 128000)

  // Signing in is blocked by the same rule.
  capInput.props.onChange({ target: { value: "64K" } })
  view = render(section.component, props)
  hooks[authSlot()] = { state: "signed-out", message: "未登录" }
  view = render(section.component, props)
  assert.equal(
    findElement(view, (node) => node?.type === "button" && node.props.children.includes("登录")).props.disabled,
    true,
    "sign-in cannot carry a sub-floor ceiling",
  )
})
