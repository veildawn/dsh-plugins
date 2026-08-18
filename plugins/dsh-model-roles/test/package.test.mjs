import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  SETTINGS_RPC_CHANNEL,
  apply as applyHost,
  contentHasImage,
  handleSettingsRpc,
} from '../lib/index.js'

let definition
const previousWindow = globalThis.window
const previousCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
let randomByte = 0
Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: { getRandomValues: bytes => bytes.fill(randomByte++ & 255) },
})
globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
await import('../lib/client.js')
globalThis.window = previousWindow
const polyfilledUUID = globalThis.crypto.randomUUID()
if (previousCrypto) Object.defineProperty(globalThis, 'crypto', previousCrypto)
else delete globalThis.crypto

test('browser bundle loads with the expected client services', async () => {
  assert.match(polyfilledUUID, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  const react = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useEffect() {},
    useState(initial) { return [initial, () => {}] },
  }
  const IconBranchOutline16 = props => react.createElement('svg', props)
  const client = definition.factory((id) => {
    if (id === 'react') return react
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { IconBranchOutline16 }
    assert.fail('unexpected browser dependency: ' + id)
  })
  assert.deepEqual(client.inject, ['slots', 'connection', 'remote'])
  assert.deepEqual(client.internals.OMP_ROLES, [
    'default', 'smol', 'slow', 'vision', 'plan', 'designer', 'commit', 'tiny', 'task', 'advisor',
  ])
  assert.deepEqual(client.internals.BUILTIN, [
    'smol', 'slow', 'vision', 'plan', 'designer', 'commit', 'tiny', 'task', 'advisor',
  ])
  assert.deepEqual(Object.fromEntries(Object.entries(client.internals.copy).map(([id, value]) => [id, value.title])), {
    smol: '快速', slow: '深度', vision: '识图', plan: '计划',
    designer: '设计', commit: '提交', tiny: '轻量后台', task: '任务', advisor: '顾问',
  })
  assert.equal(client.internals.copy.tiny.detail, '用于自动任务分类、会话标题和压缩等 DSH 后台调用。')
  assert.equal(client.internals.INTRO_TEXT, '系统会自动为任务选择合适模型；未命中已配置角色时使用当前会话选择的模型。')
  assert.equal(client.internals.ADVISOR_HELP_TEXT, '请先为顾问选择模型。')
  assert.equal(client.internals.statusMessage('ready', true, false), '')
  assert.equal(client.internals.statusMessage('loading', true, false), '正在读取模型与角色配置…')
  assert.equal(client.internals.statusMessage('ready', true, true), '有未保存的更改。')
  assert.equal(client.internals.statusMessage('ready', false, false), '当前设置文档为只读。')
  assert.equal(client.internals.normalizeRole(' Designer '), 'designer')
  assert.deepEqual(client.internals.configurableRoutes([
    { role: 'default', provider: 'legacy', model: 'forced' },
    { role: 'plan', provider: 'p', model: 'm' },
  ]), [{ role: 'plan', provider: 'p', model: 'm' }])
  assert.equal(client.internals.validateRoles([
    { role: 'default', provider: 'p', model: 'm' },
  ]), '默认模型由当前会话选择，无需配置')
  assert.equal(client.internals.validateRoles([
    { role: 'plan', provider: 'p', model: 'm' },
    { role: 'PLAN', provider: 'p', model: 'other' },
  ]), '角色 ID“plan”重复')
  const key = client.internals.modelKey('open/router', 'model/a')
  assert.deepEqual(client.internals.parseModelKey(key), { provider: 'open/router', model: 'model/a' })

  const registrations = []
  const stops = []
  const ctx = {
    connection: { api: { settings: {}, llm: {} } },
    remote: {
      $on() { const stop = () => {}; stops.push(stop); return stop },
    },
    slots: {
      inject(name, install) {
        assert.equal(name, 'settings.section')
        return install()
      },
      register(entry, component) { registrations.push({ entry, component }); return () => {} },
    },
  }
  client.apply(ctx)
  const settings = registrations.find(({ entry }) => entry.name === 'settings.section')
  assert.equal(settings.entry.id, 'model-roles')
  assert.equal(settings.entry.order, 24)
  assert.equal(typeof settings.component, 'function')
  assert.equal(settings.entry.inject().api, ctx.connection.api)
  const navLabel = settings.entry.label()
  assert.equal(navLabel.props.className, 'mr-nav-label')
  assert.deepEqual(navLabel.props.style, { display: 'inline-flex', alignItems: 'center', gap: 8 })
  assert.equal(navLabel.props.children.length, 2)
  assert.match(client.internals.navCss, /data-settings-nav-label="model-roles"/)
  assert.doesNotMatch(client.internals.navCss, /data-settings-nav-label\]/)
  assert.equal(registrations.length, 1)
})

test('manifest, bundle patch and package contents form a DSH plugin', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  const host = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.equal(manifest.name, 'dsh-model-roles')
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert(manifest.files.includes('lib/core.js'))
  assert.equal(manifest.scripts['test:live'], 'node scripts/live-ai-proxy-e2e.mjs')
  assert(manifest.files.includes('scripts/live-ai-proxy-e2e.mjs'))
  assert.match(patch, /name: dsh-model-roles/)
  assert.match(host, /ctx\.on\('agent\/request'/)
  assert.match(host, /ctx\.commands\.register/)
  assert.match(host, /llm\/stream/)
  assert.match(host, /agent\/turn-stopping/)
  assert.match(host, /connection\.rpc\.handle/)
  assert.match(client, /connection\.rpc\.call/)
  assert.match(client, /api\.settings\.(?:describe|replace)/)
  assert.doesNotMatch(client, /conversation\.input\.left|ModelRoleSelect|ROLE_SLOT|"subagent"|子代理角色（兼容）/)
})

test('loopback settings RPC exposes and revision-checks the plugin namespace', async () => {
  const calls = []
  const settings = {
    writable: true,
    describe(options) {
      assert.deepEqual(options, { redactSecrets: true })
      return [{
        ns: 'model-roles',
        value: { roles: [{ role: 'vision', provider: 'p', model: 'v' }] },
        revision: calls.length + 4,
      }]
    },
    async replace(ns, section, expectedRevision) {
      calls.push({ ns, section, expectedRevision })
    },
  }

  assert.equal(SETTINGS_RPC_CHANNEL, '/model-roles-settings')
  assert.deepEqual(await handleSettingsRpc(settings, 'describe', {}), {
    ok: true,
    value: {
      writable: true,
      value: { roles: [{ role: 'vision', provider: 'p', model: 'v' }] },
      revision: 4,
    },
  })
  const section = { roles: [{ role: 'default', provider: 'p', model: 'm' }] }
  assert.deepEqual(await handleSettingsRpc(settings, 'replace', {
    section,
    expectedRevision: 4,
  }), {
    ok: true,
    value: {
      writable: true,
      value: { roles: [{ role: 'vision', provider: 'p', model: 'v' }] },
      revision: 5,
    },
  })
  assert.deepEqual(calls, [{ ns: 'model-roles', section, expectedRevision: 4 }])
  assert.equal((await handleSettingsRpc(settings, 'replace', {
    section: [], expectedRevision: 4,
  })).ok, false)
  assert.equal((await handleSettingsRpc(settings, 'unknown', {})).ok, false)
})

test('host registers advisor control and delegates image requests before main routing', async () => {
  const commands = new Map()
  const listeners = new Map()
  const starts = []
  let watcher
  const section = {
    roles: [
      { role: 'default', provider: 'legacy', model: 'forced', reasoningEffort: '' },
      { role: 'vision', provider: 'p', model: 'vision', reasoningEffort: 'high' },
    ],
    advisor: { enabled: false, subagents: false, provider: 'spawn', maxTranscriptChars: 60000 },
  }
  const ctx = {
    logger: { error() {} },
    settings: {
      writable: true,
      describe: () => [{ ns: 'model-roles', value: section, revision: 0 }],
      replace: async () => {},
      register(ns) {
        assert.equal(ns, 'model-roles')
        return {
          get: () => section,
          watch(next) { watcher = next },
        }
      },
    },
    commands: {
      register(definition) { commands.set(definition.name, definition); return () => {} },
    },
    llm: { stream() { throw new Error('not exercised') } },
    subagents: {
      async start(provider, request) {
        starts.push({ provider, request })
        return {
          result: Promise.resolve({
            stopReason: 'completed',
            output: [{ type: 'text', text: 'The image shows a red banner.' }],
          }),
          async dispose() {},
        }
      },
    },
    inject(dependencies, install) {
      assert.deepEqual(dependencies, ['connection'])
      return install({
        connection: {
          rpc: {
            handle(channel, handler, options) {
              assert.equal(channel, '/model-roles-settings')
              assert.equal(typeof handler, 'function')
              assert.deepEqual(options, { authority: 'trusted-host' })
              return async () => {}
            },
          },
        },
      })
    },
    on(name, listener) {
      listeners.set(name, listener)
      return () => {}
    },
  }
  applyHost(ctx)
  assert.equal(typeof watcher, 'function')
  const requestListener = listeners.get('agent/request')
  const preStepListener = listeners.get('agent/pre-step')
  assert.equal(commands.has('model-role'), false)
  assert.equal(commands.get('advisor').name, 'advisor')
  assert.equal(typeof listeners.get('llm/stream'), 'function')
  assert.equal(typeof listeners.get('agent/turn-stopping'), 'function')
  const imageAgent = {
    options: {},
    session: {
      events: [],
      deriveMessages: () => [{ role: 'user', content: [{ type: 'image' }] }],
    },
  }
  const decision = await preStepListener({
    agent: imageAgent,
    turn: 1,
    signal: AbortSignal.timeout(5_000),
  }, async () => ({
    kind: 'enter',
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: 'inspect' }, { type: 'image' }],
      source: { kind: 'user' },
    }],
  }))
  assert.equal(starts.length, 1)
  assert.equal(starts[0].provider, 'spawn')
  assert.equal(starts[0].request.agentOptions.modelRole, 'vision')
  assert.equal(decision.messages.some((message) => contentHasImage(message.content)), false)
  assert.match(decision.messages.at(-1).content[0].text, /red banner/u)
  assert.deepEqual(await requestListener({ agent: imageAgent }, async () => ({
    provider: 'native', model: 'text', maxTokens: 100,
  })), {
    provider: 'native', model: 'text', maxTokens: 100,
  })
})
test('client settingsRequest falls back to api.settings on HTTP 403', async () => {
  const ctx = {
    connection: {
      rpc: {
        async call() {
          throw new Error('transport failure for /model-roles-settings/describe: HTTP 403')
        },
      },
    },
  }
  const api = {
    settings: {
      async describe() {
        return {
          result: {
            ok: true,
            value: {
              writable: true,
              hasDocument: true,
              namespaces: [{
                ns: 'model-roles',
                value: { roles: [{ role: 'plan', provider: 'p', model: 'm' }] },
                revision: 3,
              }],
            },
          },
        }
      },
      async replace(payload) {
        return {
          result: {
            ok: true,
            value: {
              ns: payload.ns,
              value: payload.section,
              revision: payload.expectedRevision + 1,
            },
          },
        }
      },
    },
  }
  const settingsRequest = client.internals.createSettingsRequest(ctx.connection.rpc, api)
  const describeResult = await settingsRequest('describe', {}, api)
  assert.deepEqual(describeResult, {
    writable: true,
    value: { roles: [{ role: 'plan', provider: 'p', model: 'm' }] },
    revision: 3,
  })
  const replaceResult = await settingsRequest('replace', {
    section: { roles: [{ role: 'vision', provider: 'p', model: 'v' }] },
    expectedRevision: 3,
  }, api)
  assert.deepEqual(replaceResult, {
    writable: true,
    value: { roles: [{ role: 'vision', provider: 'p', model: 'v' }] },
    revision: 4,
  })
})
