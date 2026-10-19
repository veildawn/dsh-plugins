import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

let definition
const previousWindow = globalThis.window
globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
await import('../lib/client.js')
globalThis.window = previousWindow

function fakeReact() {
  return {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useEffect() {},
    useRef(initial) { return { current: initial } },
    useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
  }
}

function loadClient() {
  const react = fakeReact()
  return definition.factory((id) => {
    if (id === 'react') return react
    assert.fail('unexpected browser dependency: ' + id)
  })
}

test('browser bundle loads with the expected services and task templates', async () => {
  const client = loadClient()
  assert.deepEqual(client.inject, ['slots', 'connection', 'remote', 'remote.session', 'uiWorkspace'])
  assert.deepEqual(client.internals.TASK_TEMPLATES.map((template) => template.id), [
    'explore', 'implement', 'review', 'test', 'research', 'docs',
  ])
  assert.deepEqual(client.internals.DEFAULT_ROUTING, {
    enabled: false,
    fallback: 'taskRole',
    useJev: true,
    respectExplicitChildModel: true,
    classifier: { provider: '', model: '', reasoningEffort: '' },
  })
  assert.deepEqual(client.internals.DEFAULT_JEV, {
    enabled: false,
    baseURL: 'https://api.typesafe.ai',
    model: 'jev-latest',
    minConfidence: 0.6,
    timeoutMs: 3000,
    maxStateChars: 8000,
  })
  assert.equal(client.internals.normalizeId(' Review '), 'review')
  assert.deepEqual(client.internals.splitKeywords('审查, review，audit'), ['审查', 'review', 'audit'])
  assert.deepEqual(client.internals.normalizeKeywords(['Review', 'review', ' 审查 ']), ['Review', '审查'])
  assert.equal(client.internals.validateRouting({ fallback: 'nope' }), '子任务回退方式无效')
  assert.equal(client.internals.validateRouting({ fallback: 'llm', classifier: { provider: 'p', model: '' } }), '轻量分类模型需要同时选择 Provider 与模型')
  assert.equal(client.internals.validateProfiles([]), '')
  assert.equal(client.internals.validateProfiles([{ id: 'general', provider: 'p', model: 'm' }]), '任务类型 ID“general”与保留名冲突')
  assert.equal(client.internals.validateProfiles([
    { id: 'review', provider: 'p', model: 'm' },
    { id: 'REVIEW', provider: 'p', model: 'n' },
  ]), '任务类型 ID“review”重复')
  assert.equal(client.internals.validateProfiles([{ id: 'review', provider: '', model: '' }]), '任务类型“review”尚未选择模型')
  assert.equal(client.internals.validateJev({ ...client.internals.DEFAULT_JEV, baseURL: '' }), 'Jev Base URL 不能为空')
  assert.deepEqual(client.internals.normalizeJev({ apiKeyEnv: 'OLD', keyFile: 'old', model: 'm' }), {
    enabled: false, baseURL: 'https://api.typesafe.ai', model: 'm',
    minConfidence: 0.6, timeoutMs: 3000, maxStateChars: 8000,
  })
  assert.deepEqual(client.internals.normalizeProfiles([
    { id: 'review', provider: 'p', model: 'm', keywords: ['Review', 'review', ' 审查 '] },
  ])[0].keywords, ['Review', '审查'])
  assert.equal(client.internals.profileDefaults('review').name, '审查与复核')
  assert.equal(client.internals.profileDefaults('custom-1').name, 'custom-1')
})

test('the settings page registers once with the task-models section and renders', () => {
  const client = loadClient()
  const registrations = []
  const stops = []
  const injectedSlots = []
  const ctx = {
    connection: { api: { settings: {}, llm: {} } },
    remote: {
      $on() { const stop = () => {}; stops.push(stop); return stop },
      session: { modelCatalog: async () => ({ ok: true, value: { groups: [], failures: [] } }) },
    },
    uiWorkspace: { openSession() {} },
    slots: {
      inject(name, install) {
        injectedSlots.push(name)
        return install()
      },
      register(entry, component) { registrations.push({ entry, component }); return () => {} },
    },
  }
  client.apply(ctx)
  assert.deepEqual(injectedSlots, ['settings.section', 'conversation.chat.node'])
  assert.equal(registrations.length, 2)
  const settings = registrations.find(({ entry }) => entry.id === 'task-models')
  assert.equal(settings.entry.name, 'settings.section')
  assert.equal(settings.entry.order, 25)
  assert.equal(typeof settings.component, 'function')
  assert.equal(settings.entry.inject().api, ctx.connection.api)
  const label = settings.entry.label()
  assert.equal(label.props.children.length, 2)
  assert.match(client.internals.navCss, /data-settings-nav-label="task-models"/)
  const rendered = settings.component({ api: {} })
  assert.equal(rendered.type, 'div')
  assert.equal(rendered.props.className, 'tm-page')

  const workflow = registrations.find(({ entry }) => entry.name === 'conversation.chat.node')
  assert.equal(workflow.entry.key, 'workflow-run')
  assert.equal(workflow.entry.priority, -1)
  assert.equal(typeof workflow.component, 'function')
  const workflowProps = workflow.entry.inject()
  assert.equal(typeof workflowProps.loadModels, 'function')
  assert.equal(typeof workflowProps.openSession, 'function')
  const panel = workflow.component({
    node: {
      data: {
        name: 'smart-routes-in-v1-models-review',
        status: 'running',
        phases: [{
          key: 'phase-1',
          phase: '独立评审',
          members: [
            { seq: 1, childId: 'child-1', label: '后端评审', status: 'running' },
            { seq: 2, childId: 'child-2', label: '契约/前端评审', status: 'completed' },
          ],
        }],
      },
    },
    sessionId: 'parent-1',
    openSession: workflowProps.openSession,
    loadModels: workflowProps.loadModels,
  })
  assert.equal(panel.type, 'div')
  assert.equal(panel.props.className, 'tm-wf-root')
  const serialized = JSON.stringify(panel)
  assert.match(serialized, /后端评审/)
  assert.match(serialized, /契约\/前端评审/)
  assert.match(serialized, /模型…/)
  assert.match(serialized, /运行中/)
  assert.match(serialized, /已完成/)

  const opened = []
  const openedPanel = workflow.component({
    node: {
      data: {
        name: 'run', status: 'running',
        phases: [{ key: 'p', phase: '阶段', members: [{ seq: 1, childId: 'child-continuable', label: '成员', status: 'running' }] }],
      },
    },
    sessionId: 'parent-1',
    openSession: (target) => opened.push(target),
    loadModels: async () => ({}),
    useSessionStatus: (selector) => selector(new Map([['child-continuable', { running: true }]])),
    useSessions: (selector) => selector({
      byId: { 'child-continuable': { running: true } },
      projectionsBySession: {
        'parent-1': { values: { subagentCatalog: [{ id: 'child-continuable', mode: 'continuable' }] } },
      },
    }),
  })
  function findClickable(node) {
    if (node === null || typeof node !== 'object') return undefined
    if (typeof node.props?.className === 'string' && node.props.className.includes('tm-wf-clickable')) return node
    for (const child of node.props?.children ?? []) {
      const found = findClickable(child)
      if (found !== undefined) return found
    }
    return undefined
  }
  const clickable = findClickable(openedPanel)
  assert.notEqual(clickable, undefined)
  clickable.props.onClick()
  assert.deepEqual(opened, [{
    parentSessionId: 'parent-1',
    childSessionId: 'child-continuable',
    mode: 'continuable',
  }])
})

test('manifest, bundle patch and source wiring form a DSH plugin', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  const host = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.equal(manifest.name, '@weniatall/dsh-task-models')
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/u)
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert(manifest.files.includes('lib/core.js'))
  assert(manifest.files.includes('lib/client.js'))
  assert.match(patch, /name: '@weniatall\/dsh-task-models'/u)
  assert.match(patch, /profiles: \[\]/u)
  assert.match(host, /ctx\.on\('agent\/request'/u)
  assert.match(host, /ctx\.on\('agent\/pre-step'/u)
  assert.match(host, /connection\.rpc\.handle/u)
  assert.match(host, /v1\/systemone/u)
  assert.match(client, /connectionRpc\.call/u)
  assert.match(client, /api\.settings\.(?:describe|replace)/u)
  assert.match(client, /task-models-settings/u)
})

test('client settings transport falls back to api.settings on HTTP 403', async () => {
  const client = loadClient()
  const ctx = {
    connection: {
      rpc: {
        async call() {
          throw new Error('transport failure for /task-models-settings/describe: HTTP 403')
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
              namespaces: [{
                ns: 'task-models',
                value: { profiles: [{ id: 'review', provider: 'p', model: 'm' }] },
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
            value: { ns: payload.ns, value: payload.section, revision: payload.expectedRevision + 1 },
          },
        }
      },
    },
  }
  const request = client.internals.createSettingsRequest(ctx.connection.rpc, api)
  assert.deepEqual(await request('describe', {}, api), {
    writable: true,
    value: { profiles: [{ id: 'review', provider: 'p', model: 'm' }] },
    revision: 3,
  })
  assert.deepEqual(await request('replace', {
    section: { profiles: [] },
    expectedRevision: 3,
  }, api), {
    writable: true,
    value: { profiles: [] },
    revision: 4,
  })
})
