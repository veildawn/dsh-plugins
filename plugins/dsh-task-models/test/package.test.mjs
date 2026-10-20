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
    decisionTimeoutMs: 5000,
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
  assert.equal(client.internals.validateRouting({ fallback: 'taskRole', decisionTimeoutMs: 50 }), '决策总超时须在 100 到 60000 毫秒之间')
  assert.equal(client.internals.validateRouting({ fallback: 'taskRole', decisionTimeoutMs: 70000 }), '决策总超时须在 100 到 60000 毫秒之间')
  assert.equal(client.internals.validateRouting({ fallback: 'taskRole', decisionTimeoutMs: 150.5 }), '决策总超时须在 100 到 60000 毫秒之间')
  assert.equal(client.internals.validateRouting({ fallback: 'taskRole', decisionTimeoutMs: 5000 }), '')
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

test('pure functions: buildDraftSection, reconcileSettings, formatRoutingDetail, formatMemberTitle', () => {
  const client = loadClient()
  const {
    buildDraftSection,
    reconcileSettings,
    formatRoutingDetail,
    formatMemberTitle,
    formatNextStep,
    formatRuleAnalysisSummary,
  } = client.internals

  // 1. buildDraftSection
  const draftSection = buildDraftSection({
    routing: { fallback: 'llm', decisionTimeoutMs: 3000 },
    profiles: [
      { id: 'review', provider: 'deepseek', model: 'deepseek-chat', keywords: ['审查', 'review'] },
      { id: 'CUSTOM-1', name: '自建', provider: 'openai', model: 'gpt-4o', keywords: '自定义, test' },
    ],
    jev: { enabled: true, minConfidence: 0.8, timeoutMs: 4000 },
  })
  assert.equal(draftSection.routing.decisionTimeoutMs, 3000)
  assert.equal(draftSection.routing.fallback, 'llm')
  assert.equal(draftSection.profiles.length, 2)
  assert.equal(draftSection.profiles[0].id, 'review')
  assert.deepEqual(draftSection.profiles[0].keywords, ['审查', 'review'])
  assert.equal(draftSection.profiles[1].id, 'custom-1')
  assert.deepEqual(draftSection.profiles[1].keywords, ['自定义', 'test'])
  assert.equal(draftSection.jev.enabled, true)
  assert.equal(draftSection.jev.minConfidence, 0.8)
  assert.equal(draftSection.jev.timeoutMs, 4000)

  // 2. reconcileSettings
  // Case A: Initial or active non-silent load
  const initial = reconcileSettings({
    currentRevision: 0,
    currentWritable: false,
    remoteRevision: 1,
    remoteWritable: true,
    silent: false,
    dirty: false,
  })
  assert.deepEqual(initial, {
    conflict: false,
    revision: 1,
    writable: true,
    shouldApplyRemote: true,
  })

  // Case B: Dirty draft + silent load + remote updated externally
  const conflictRes = reconcileSettings({
    currentRevision: 1,
    currentWritable: true,
    remoteRevision: 2,
    remoteWritable: true,
    silent: true,
    dirty: true,
  })
  assert.deepEqual(conflictRes, {
    conflict: true,
    revision: 1, // MUST preserve base revision!
    writable: true,
    shouldApplyRemote: false,
  })

  // Case C: Dirty draft + silent load + no remote update
  const noConflict = reconcileSettings({
    currentRevision: 1,
    currentWritable: true,
    remoteRevision: 1,
    remoteWritable: true,
    silent: true,
    dirty: true,
  })
  assert.deepEqual(noConflict, {
    conflict: false,
    revision: 1,
    writable: true,
    shouldApplyRemote: false,
  })

  // Case D: User clicks reload (silent: false, discarding local draft)
  const reloaded = reconcileSettings({
    currentRevision: 1,
    currentWritable: true,
    remoteRevision: 2,
    remoteWritable: true,
    silent: false,
    dirty: true,
  })
  assert.deepEqual(reloaded, {
    conflict: false,
    revision: 2,
    writable: true,
    shouldApplyRemote: true,
  })

  // 3. formatRoutingDetail
  assert.equal(formatRoutingDetail('rules-explicit-label'), '规则匹配（显式标签）')
  assert.equal(formatRoutingDetail('rules-keywords'), '规则匹配（关键词）')
  assert.equal(formatRoutingDetail('rules-unmatched'), '规则未命中')
  assert.equal(formatRoutingDetail('jev-selected'), 'Jev 决策')
  assert.equal(formatRoutingDetail('llm-selected'), '轻量模型分类')
  assert.equal(formatRoutingDetail('no-match'), '无规则命中')
  assert.equal(formatRoutingDetail('rules-tie'), '规则冲突平局')
  assert.equal(formatRoutingDetail('classifier-unconfigured'), '分类模型未配置')
  assert.equal(formatRoutingDetail('jev-low-confidence'), 'Jev 置信度不足')
  assert.equal(formatRoutingDetail('jev-invalid-response'), 'Jev 响应无效')
  assert.equal(formatRoutingDetail('jev-unavailable'), 'Jev 服务不可用')
  assert.equal(formatRoutingDetail('classifier-failed'), '轻量模型分类失败')
  assert.equal(formatRoutingDetail('decision-timeout'), '决策超时')
  assert.equal(formatRoutingDetail('route-unusable'), '目标路由不可用')
  assert.equal(formatRoutingDetail('explicit-child-model'), '子代理指定模型')
  assert.equal(formatRoutingDetail('routing-disabled'), '任务路由已禁用')
  assert.equal(formatRoutingDetail('no-profiles'), '未配置任务模型')
  assert.equal(formatRoutingDetail('internal-role'), '内部角色')
  assert.equal(formatRoutingDetail('plan-mode'), '计划模式')
  assert.equal(formatRoutingDetail('existing-request'), '已有会话延续')
  assert.equal(formatRoutingDetail('no-task'), '无任务内容')
  assert.equal(formatRoutingDetail(''), '原因未知')
  assert.equal(formatRoutingDetail(undefined), '原因未知')

  // 4. formatMemberTitle
  // Historical data with model info only, no details -> 原因未知
  const historical = formatMemberTitle({
    info: { provider: 'deepseek', model: 'deepseek-chat' },
    detail: undefined,
    pending: false,
  })
  assert.equal(historical, 'deepseek/deepseek-chat · 原因未知')

  // Selection done but header not submitted yet -> 待请求头确认
  const pendingHeader = formatMemberTitle({
    info: undefined,
    detail: {
      status: 'adopted',
      source: 'rules',
      profileId: 'explore',
      profileName: '探索与检索',
      durationMs: 4,
      reason: 'rules-keywords',
      selectedRoute: { provider: 'deepseek', model: 'deepseek-chat' },
    },
    pending: true,
  })
  assert.equal(
    pendingHeader,
    '待请求头确认 (预选: deepseek/deepseek-chat) · 类别: 探索与检索 · 来源: 规则 · 耗时: 4ms · 原因: 规则匹配（关键词）'
  )

  // Candidate rejected / route unusable (status != adopted) -> 未采用候选
  const unusable = formatMemberTitle({
    info: undefined,
    detail: {
      status: 'current',
      source: 'rules',
      profileId: 'explore',
      profileName: '探索与检索',
      durationMs: 4,
      reason: 'route-unusable',
      selectedRoute: { provider: 'deepseek', model: 'deepseek-chat' },
    },
    pending: false,
  })
  assert.equal(
    unusable,
    '未采用候选: deepseek/deepseek-chat · 类别: 探索与检索 · 来源: 规则 · 耗时: 4ms · 原因: 目标路由不可用'
  )

  // Route unusable but baseline effectiveRoute present -> effectiveRoute takes priority
  const unusableWithBaseline = formatMemberTitle({
    info: undefined,
    detail: {
      status: 'current',
      source: 'rules',
      profileId: 'explore',
      profileName: '探索与检索',
      durationMs: 4,
      reason: 'route-unusable',
      selectedRoute: { provider: 'deepseek', model: 'deepseek-chat' },
      effectiveRoute: { provider: 'deepseek', model: 'deepseek-baseline' },
    },
    pending: false,
  })
  assert.equal(
    unusableWithBaseline,
    'deepseek/deepseek-baseline · 类别: 探索与检索 · 来源: 规则 · 耗时: 4ms · 原因: 目标路由不可用'
  )

  // Fully confirmed effectiveRoute with details
  const confirmed = formatMemberTitle({
    info: { provider: 'deepseek', model: 'deepseek-chat' },
    detail: {
      status: 'adopted',
      source: 'jev',
      profileId: 'review',
      profileName: '审查与复核',
      confidence: 0.92,
      durationMs: 145,
      reason: 'jev-selected',
      effectiveRoute: { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' },
    },
    pending: false,
  })
  assert.equal(
    confirmed,
    'deepseek/deepseek-reasoner · high · 类别: 审查与复核 · 来源: Jev · 置信度: 92% · 耗时: 145ms · 原因: Jev 决策'
  )

  // 5. formatNextStep & formatRuleAnalysisSummary
  assert.equal(formatNextStep('rules'), '规则命中')
  assert.equal(formatNextStep('jev'), '交由 Jev 决策')
  assert.equal(formatNextStep('llm'), '交由轻量模型分类')
  assert.equal(formatNextStep('current'), '保持当前路由')

  const summary = formatRuleAnalysisSummary({
    source: 'keywords',
    profileId: 'implement',
    matches: [{ id: 'implement', score: 2, explicitLabel: false, matchedKeywords: [{ keyword: '实现', in: 'label' }] }],
    tiedIds: [],
  })
  assert.match(summary, /来源: 关键词匹配/)
  assert.match(summary, /候选类型: implement/)
  assert.match(summary, /实现\(标题\)/)
})

test('WorkflowRunPanel with loadDetails and stateful effect harness', async () => {
  let state = {}
  let effectCleanup
  const react = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const key = (new Error()).stack.split('\n')[2]
      if (!(key in state)) state[key] = typeof initial === 'function' ? initial() : initial
      const setState = (next) => {
        state[key] = typeof next === 'function' ? next(state[key]) : next
      }
      return [state[key], setState]
    },
    useRef(initial) { return { current: initial } },
    useEffect(effect) {
      if (typeof effectCleanup === 'function') effectCleanup()
      effectCleanup = effect()
    },
  }
  const client = definition.factory((id) => {
    if (id === 'react') return react
    assert.fail('unexpected dependency: ' + id)
  })

  const registrations = []
  const ctx = {
    connection: { api: { settings: {}, llm: {} } },
    remote: { $on: () => () => {}, session: { modelCatalog: async () => ({ ok: true, value: { groups: [] } }) } },
    uiWorkspace: { openSession() {} },
    slots: {
      inject: (name, install) => install(),
      register: (entry, component) => { registrations.push({ entry, component }); return () => {} },
    },
  }
  client.apply(ctx)

  const workflow = registrations.find(({ entry }) => entry.name === 'conversation.chat.node')
  const { loadModels, loadDetails } = workflow.entry.inject()
  assert.equal(typeof loadModels, 'function')
  assert.equal(typeof loadDetails, 'function')

  const routingDetailsMock = async () => ({
    models: {
      'child-2': { provider: 'deepseek', model: 'deepseek-reasoner' },
    },
    details: {
      'child-1': {
        status: 'adopted',
        source: 'rules',
        profileId: 'implement',
        profileName: '实现与修改',
        reason: 'rules-keywords',
        selectedRoute: { provider: 'deepseek', model: 'deepseek-chat' },
      },
      'child-2': {
        status: 'adopted',
        source: 'rules',
        profileId: 'review',
        profileName: '审查与复核',
        reason: 'rules-explicit-label',
        effectiveRoute: { provider: 'deepseek', model: 'deepseek-reasoner' },
      },
    },
  })

  workflow.component({
    node: {
      data: {
        name: 'test-wf',
        status: 'running',
        phases: [{
          key: 'phase-1',
          members: [
            { seq: 1, childId: 'child-1', label: '任务1', status: 'running' },
            { seq: 2, childId: 'child-2', label: '任务2', status: 'completed' },
          ],
        }],
      },
    },
    sessionId: 'session-parent',
    loadDetails: routingDetailsMock,
  })

  await new Promise((resolve) => setTimeout(resolve, 20))

  const updatedPanel = workflow.component({
    node: {
      data: {
        name: 'test-wf',
        status: 'running',
        phases: [{
          key: 'phase-1',
          members: [
            { seq: 1, childId: 'child-1', label: '任务1', status: 'running' },
            { seq: 2, childId: 'child-2', label: '任务2', status: 'completed' },
          ],
        }],
      },
    },
    sessionId: 'session-parent',
    loadDetails: routingDetailsMock,
  })

  function findElements(node, predicate) {
    const matches = []
    function walk(current) {
      if (current === null || typeof current !== 'object') return
      if (predicate(current)) matches.push(current)
      const children = Array.isArray(current.props?.children)
        ? current.props.children
        : (current.props?.children ? [current.props.children] : [])
      for (const child of children) {
        if (Array.isArray(child)) {
          for (const c of child) walk(c)
        } else {
          walk(child)
        }
      }
    }
    walk(node)
    return matches
  }

  const badges = findElements(updatedPanel, (el) => typeof el.props?.className === 'string' && el.props.className.includes('tm-wf-model'))
  assert.equal(badges.length, 2)
  // child-1: effective model not confirmed yet -> shows "模型…", has pending class
  assert.equal(badges[0].props.children[0], '模型…')
  assert(badges[0].props.className.includes('tm-wf-model-pending'))
  assert.match(badges[0].props.title, /待请求头确认/)
  assert.match(badges[0].props.title, /预选: deepseek\/deepseek-chat/)

  // child-2: effectiveRoute confirmed -> shows "deepseek-reasoner"
  assert.equal(badges[1].props.children[0], 'deepseek-reasoner')
  assert(!badges[1].props.className.includes('tm-wf-model-pending'))
  assert.match(badges[1].props.title, /deepseek\/deepseek-reasoner/)
  assert.match(badges[1].props.title, /审查与复核/)

  if (typeof effectCleanup === 'function') effectCleanup()
})

test('Settings component: decisionTimeoutMs, preview rules inputs & validation, Jev badge & read-only inputs', () => {
  const client = loadClient()
  const registrations = []
  const ctx = {
    connection: { api: { settings: {}, llm: {} } },
    remote: { $on: () => () => {}, session: { modelCatalog: async () => ({ ok: true, value: { groups: [] } }) } },
    uiWorkspace: { openSession() {} },
    slots: {
      inject: (name, install) => install(),
      register: (entry, component) => { registrations.push({ entry, component }); return () => {} },
    },
  }
  client.apply(ctx)

  const settings = registrations.find(({ entry }) => entry.id === 'task-models')
  const rendered = settings.component({ api: {} })

  function findElement(node, predicate) {
    if (node === null || typeof node !== 'object') return undefined
    if (predicate(node)) return node
    const children = Array.isArray(node.props?.children)
      ? node.props.children
      : (node.props?.children ? [node.props.children] : [])
    for (const child of children) {
      if (Array.isArray(child)) {
        for (const c of child) {
          const res = findElement(c, predicate)
          if (res) return res
        }
      } else {
        const res = findElement(child, predicate)
        if (res) return res
      }
    }
    return undefined
  }

  // 1. decisionTimeoutMs input
  const timeoutInput = findElement(rendered, (el) => el.props?.['aria-label'] === '决策总超时')
  assert.notEqual(timeoutInput, undefined)
  assert.equal(timeoutInput.props.type, 'number')
  assert.equal(timeoutInput.props.min, 100)
  assert.equal(timeoutInput.props.max, 60000)

  // 2. Preview inputs: label (300 chars), text (6000 chars)
  const previewLabel = findElement(rendered, (el) => el.props?.['aria-label'] === '试运行任务 Label')
  assert.notEqual(previewLabel, undefined)
  assert.equal(previewLabel.props.maxLength, 300)

  const previewText = findElement(rendered, (el) => el.props?.['aria-label'] === '试运行任务内容')
  assert.notEqual(previewText, undefined)
  assert.equal(previewText.props.maxLength, 6000)

  // 3. Preview button
  const previewBtn = findElement(rendered, (el) => el.type === 'button' && el.props?.children?.[0] === '试运行规则')
  assert.notEqual(previewBtn, undefined)
  assert.equal(previewBtn.props.disabled, true)

  // 4. Jev configured badge
  const jevBadge = findElement(rendered, (el) => typeof el.props?.className === 'string' && el.props.className.includes('tm-badge'))
  assert.notEqual(jevBadge, undefined)
  assert.notEqual(jevBadge.props.children[0], '已连接')
  assert.equal(jevBadge.props.children[0], '未配置')
})

function createDeferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createDeterministicHarness(Component, props) {
  const stateList = []
  const refList = []
  const effectList = []
  let scheduledRenders = 0
  let tree = null

  let stateIdx = 0
  let refIdx = 0
  let effectIdx = 0

  const react = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => {
      const flatChildren = children.flat()
      if (typeof type === 'function') {
        return type({ ...props, children: flatChildren })
      }
      return {
        type,
        props: {
          ...props,
          children: flatChildren,
        },
      }
    },
    useState(initial) {
      const idx = stateIdx++
      if (!(idx in stateList)) {
        stateList[idx] = typeof initial === 'function' ? initial() : initial
      }
      const setState = (next) => {
        const current = stateList[idx]
        const val = typeof next === 'function' ? next(current) : next
        if (!Object.is(val, current)) {
          stateList[idx] = val
          scheduledRenders++
        }
      }
      return [stateList[idx], setState]
    },
    useRef(initial) {
      const idx = refIdx++
      if (!(idx in refList)) {
        refList[idx] = { current: initial }
      }
      return refList[idx]
    },
    useEffect(effect, deps) {
      const idx = effectIdx++
      const prev = effectList[idx]
      let changed = true
      if (prev && prev.deps && deps) {
        changed = deps.length !== prev.deps.length || deps.some((d, i) => !Object.is(d, prev.deps[i]))
      }
      effectList[idx] = { effect, deps, changed, cleanup: prev?.cleanup }
    },
  }

  function renderCycle() {
    stateIdx = 0
    refIdx = 0
    effectIdx = 0
    tree = Component(props)
    for (const item of effectList) {
      if (item.changed) {
        if (typeof item.cleanup === 'function') {
          item.cleanup()
        }
        item.cleanup = item.effect()
        item.changed = false
      }
    }
    return tree
  }

  async function flush() {
    let limit = 100
    while (limit-- > 0) {
      if (scheduledRenders > 0 || tree === null) {
        scheduledRenders = 0
        renderCycle()
      }
      await Promise.resolve()
      await new Promise((resolve) => queueMicrotask(resolve))
      if (scheduledRenders === 0) break
    }
    if (limit <= 0) throw new Error('flush loop exceeded limit')
    return tree
  }

  function unmount() {
    for (const item of effectList) {
      if (typeof item.cleanup === 'function') {
        item.cleanup()
      }
    }
  }

  return { react, flush, unmount, getTree: () => tree }
}

function findNode(node, predicate) {
  if (node === null || typeof node !== 'object') return undefined
  if (predicate(node)) return node
  const children = Array.isArray(node.props?.children)
    ? node.props.children
    : (node.props?.children ? [node.props.children] : [])
  for (const child of children) {
    if (Array.isArray(child)) {
      for (const c of child) {
        const res = findNode(c, predicate)
        if (res) return res
      }
    } else {
      const res = findNode(child, predicate)
      if (res) return res
    }
  }
  return undefined
}

test('Settings stateful interactive test: load writable -> edit -> preview rules actual RPC carries current draft without replace -> external revision 1->2 preserves expectedRevision=1 on save -> temporary key test badge remains unconfigured', async () => {
  const rpcCalls = []
  let remoteRevision = 1
  let remoteConfig = {
    routing: { fallback: 'taskRole', decisionTimeoutMs: 5000 },
    profiles: [],
    jev: { enabled: false, baseURL: 'https://api.typesafe.ai', model: 'jev-latest' },
  }

  const mockRpc = {
    async call(channel, method, payload) {
      rpcCalls.push({ channel, method, payload })
      if (method === 'describe') {
        return {
          ok: true,
          value: {
            writable: true,
            revision: remoteRevision,
            value: remoteConfig,
          },
        }
      }
      if (method === 'replace') {
        return {
          ok: true,
          value: {
            writable: true,
            revision: payload.expectedRevision + 1,
            value: payload.section,
          },
        }
      }
      if (method === 'previewRules') {
        return {
          ok: true,
          value: {
            next: 'rules',
            reason: 'rules-keywords',
            ruleAnalysis: {
              source: 'keywords',
              profileId: payload.section?.profiles?.[0]?.id || 'custom-1',
              matches: [{ id: 'custom-1', score: 2 }],
            },
            profile: payload.section?.profiles?.[0] || null,
          },
        }
      }
      if (method === 'testJev') {
        return {
          ok: true,
          value: { latencyMs: 45 },
        }
      }
      if (method === 'jevStatus') {
        return {
          ok: true,
          value: { configured: false, model: 'jev-latest' },
        }
      }
      return { ok: true, value: {} }
    },
  }

  const mockApi = {
    llm: {
      async models() {
        return {
          ok: true,
          value: {
            groups: [{
              id: 'openai',
              name: 'OpenAI',
              models: [{ id: 'gpt-4o', name: 'GPT-4o' }],
            }],
            failures: [],
          },
        }
      },
    },
  }

  let settingsComponent
  const registrations = []
  const listeners = new Map()
  const ctx = {
    connection: { rpc: mockRpc, api: mockApi },
    remote: {
      $on(event, handler) {
        if (!listeners.has(event)) listeners.set(event, new Set())
        listeners.get(event).add(handler)
        return () => listeners.get(event)?.delete(handler)
      },
      session: {
        modelCatalog: mockApi.llm.models,
      },
    },
    uiWorkspace: { openSession() {} },
    slots: {
      inject: (name, install) => install(),
      register: (entry, component) => {
        registrations.push({ entry, component })
        if (entry.id === 'task-models') settingsComponent = component
        return () => {}
      },
    },
  }

  const harness = createDeterministicHarness((props) => settingsComponent(props), { api: mockApi })
  const client = definition.factory((id) => {
    if (id === 'react') return harness.react
    assert.fail('unexpected dependency: ' + id)
  })

  client.apply(ctx)

  // 1. Initial load
  await harness.flush()
  assert.equal(rpcCalls.filter((c) => c.method === 'describe').length, 1)

  // 2. Edit draft: Add custom profile and set model
  const addBtn = findNode(harness.getTree(), (el) => el.type === 'button' && el.props?.children?.[0] === '添加任务类型')
  assert.notEqual(addBtn, undefined)
  addBtn.props.onClick()
  await harness.flush()

  const modelSelect = findNode(harness.getTree(), (el) => el.props?.['aria-label'] === 'custom-1 任务模型')
  assert.notEqual(modelSelect, undefined)
  modelSelect.props.onChange({ target: { value: JSON.stringify(['openai', 'gpt-4o']) } })
  await harness.flush()

  // 3. Preview actual RPC with current draft and NO replace
  const labelInput = findNode(harness.getTree(), (el) => el.props?.['aria-label'] === '试运行任务 Label')
  assert.notEqual(labelInput, undefined)
  labelInput.props.onChange({ target: { value: '实现用户登录' } })

  const textInput = findNode(harness.getTree(), (el) => el.props?.['aria-label'] === '试运行任务内容')
  assert.notEqual(textInput, undefined)
  textInput.props.onChange({ target: { value: '详细任务描述' } })
  await harness.flush()

  const previewBtn = findNode(harness.getTree(), (el) => el.type === 'button' && el.props?.children?.[0] === '试运行规则')
  assert.notEqual(previewBtn, undefined)
  assert.equal(previewBtn.props.disabled, false)
  previewBtn.props.onClick()
  await harness.flush()

  // Verify preview actual RPC call carried current draft
  const previewRpc = rpcCalls.find((c) => c.method === 'previewRules')
  assert.notEqual(previewRpc, undefined)
  assert.equal(previewRpc.payload.label, '实现用户登录')
  assert.equal(previewRpc.payload.text, '详细任务描述')
  assert.equal(previewRpc.payload.section?.profiles?.length, 1)
  assert.equal(previewRpc.payload.section.profiles[0].id, 'custom-1')
  assert.equal(previewRpc.payload.section.profiles[0].model, 'gpt-4o')

  // Verify replace RPC was NOT called by preview
  const replaceRpcBeforeSave = rpcCalls.find((c) => c.method === 'replace')
  assert.equal(replaceRpcBeforeSave, undefined)

  // 4. External revision update: 1 -> 2 while dirty
  remoteRevision = 2
  for (const handler of listeners.get('settings/document-updated') || []) {
    handler('task-models')
  }
  await harness.flush()

  // Conflict warning should appear
  const conflictWarning = findNode(harness.getTree(), (el) => typeof el.props?.className === 'string' && el.props.className.includes('tm-warn') && el.props.role === 'alert')
  assert.notEqual(conflictWarning, undefined)
  assert.match(JSON.stringify(conflictWarning), /外部配置已更新，当前草稿存在冲突/)

  // Click Save: saving must still use expectedRevision=1!
  const saveBtn = findNode(harness.getTree(), (el) => el.type === 'button' && el.props?.children?.[0] === '保存')
  assert.notEqual(saveBtn, undefined)
  assert.equal(saveBtn.props.disabled, false)
  saveBtn.props.onClick()
  await harness.flush()

  const replaceRpc = rpcCalls.find((c) => c.method === 'replace')
  assert.notEqual(replaceRpc, undefined)
  assert.equal(replaceRpc.payload.expectedRevision, 1)

  // 5. Unsaved temporary key test: badge remains unconfigured
  const keyInput = findNode(harness.getTree(), (el) => el.props?.type === 'password')
  assert.notEqual(keyInput, undefined)
  keyInput.props.onChange({ target: { value: 'ts-temporary-unsaved-key' } })
  await harness.flush()

  const testJevBtn = findNode(harness.getTree(), (el) => el.type === 'button' && (el.props?.children?.[0] === '测试 Jev' || el.props?.children?.[0] === '测试中…'))
  assert.notEqual(testJevBtn, undefined)
  testJevBtn.props.onClick()
  await harness.flush()

  const jevTestCall = rpcCalls.find((c) => c.method === 'testJev')
  assert.notEqual(jevTestCall, undefined)
  assert.equal(jevTestCall.payload.apiKey, 'ts-temporary-unsaved-key')

  // Status message shows connection success
  const jevStatusMsg = findNode(harness.getTree(), (el) => typeof el.props?.className === 'string' && el.props.className.includes('tm-jev-status') && typeof el.props?.children?.[0] === 'string' && el.props.children[0].includes('测试成功'))
  assert.notEqual(jevStatusMsg, undefined)

  // Badge MUST still be "未配置"
  const badge = findNode(harness.getTree(), (el) => typeof el.props?.className === 'string' && el.props.className.includes('tm-badge'))
  assert.notEqual(badge, undefined)
  assert.equal(badge.props.children[0], '未配置')
  assert(badge.props.className.includes('tm-badge-warn'))

  // saveJevKey was NOT called
  const saveKeyCall = rpcCalls.find((c) => c.method === 'saveJevKey')
  assert.equal(saveKeyCall, undefined)

  harness.unmount()
})

test('Settings rule preview and Jev test reliability: staleness, async discard, and immediate clearing on draft edit', async () => {
  let previewDeferred = null
  let jevDeferred = null

  const mockRpc = {
    async call(channel, method, payload) {
      if (method === 'describe') {
        return {
          ok: true,
          value: {
            writable: true,
            revision: 1,
            value: { routing: { fallback: 'taskRole', decisionTimeoutMs: 5000 }, profiles: [], jev: { enabled: true, baseURL: 'https://api.typesafe.ai', model: 'jev-latest' } },
          },
        }
      }
      if (method === 'previewRules') {
        if (previewDeferred) return previewDeferred.promise
        return {
          ok: true,
          value: {
            next: 'rules',
            reason: 'rules-keywords',
            ruleAnalysis: { source: 'keywords' },
            profile: null,
          },
        }
      }
      if (method === 'testJev') {
        if (jevDeferred) return jevDeferred.promise
        return {
          ok: true,
          value: { latencyMs: 60 },
        }
      }
      if (method === 'jevStatus') {
        return {
          ok: true,
          value: { configured: false, model: 'jev-latest' },
        }
      }
      return { ok: true, value: {} }
    },
  }

  const mockApi = {
    llm: {
      async models() {
        return {
          ok: true,
          value: { groups: [], failures: [] },
        }
      },
    },
  }

  let settingsComponent
  const ctx = {
    connection: { rpc: mockRpc, api: mockApi },
    remote: {
      $on: () => () => {},
      session: { modelCatalog: mockApi.llm.models },
    },
    uiWorkspace: { openSession() {} },
    slots: {
      inject: (name, install) => install(),
      register: (entry, component) => {
        if (entry.id === 'task-models') settingsComponent = component
        return () => {}
      },
    },
  }

  const harness = createDeterministicHarness((props) => settingsComponent(props), { api: mockApi })
  const client = definition.factory((id) => {
    if (id === 'react') return harness.react
    assert.fail('unexpected dependency: ' + id)
  })

  client.apply(ctx)
  await harness.flush()

  // --- Part 1: Rule preview staleness & async discard ---
  const labelInput = findNode(harness.getTree(), (el) => el.props?.['aria-label'] === '试运行任务 Label')
  labelInput.props.onChange({ target: { value: '初始 Label' } })
  await harness.flush()

  previewDeferred = createDeferred()
  const previewBtn = findNode(harness.getTree(), (el) => el.type === 'button' && el.props?.children?.[0] === '试运行规则')
  previewBtn.props.onClick()
  await harness.flush()

  // While preview request is in-flight, user modifies label to new draft
  labelInput.props.onChange({ target: { value: '新 Label' } })
  await harness.flush()

  // Now resolve the old preview request
  previewDeferred.resolve({
    ok: true,
    value: {
      next: 'rules',
      reason: 'rules-keywords',
      ruleAnalysis: { source: 'keywords' },
      profile: null,
    },
  })
  previewDeferred = null
  await harness.flush()

  // Verify: old preview result was NOT rendered (discarded)
  let previewResultBox = findNode(harness.getTree(), (el) => typeof el.props?.className === 'string' && el.props.className.includes('tm-preview-result'))
  assert.equal(previewResultBox, undefined)

  // Now run preview with the new draft, resolves immediately
  const previewBtn2 = findNode(harness.getTree(), (el) => el.type === 'button' && el.props?.children?.[0] === '试运行规则')
  previewBtn2.props.onClick()
  await harness.flush()

  previewResultBox = findNode(harness.getTree(), (el) => typeof el.props?.className === 'string' && el.props.className.includes('tm-preview-result'))
  assert.notEqual(previewResultBox, undefined)

  // Editing previewText immediately clears the displayed preview result
  const textInput = findNode(harness.getTree(), (el) => el.props?.['aria-label'] === '试运行任务内容')
  textInput.props.onChange({ target: { value: '更新内容' } })
  await harness.flush()

  previewResultBox = findNode(harness.getTree(), (el) => typeof el.props?.className === 'string' && el.props.className.includes('tm-preview-result'))
  assert.equal(previewResultBox, undefined)

  // --- Part 2: Jev connection test clearing on config/key change ---
  const testJevBtn = findNode(harness.getTree(), (el) => el.type === 'button' && el.props?.children?.[0] === '测试 Jev')
  testJevBtn.props.onClick()
  await harness.flush()

  let jevTestMsg = findNode(harness.getTree(), (el) => typeof el.props?.className === 'string' && el.props.className.includes('tm-jev-status') && typeof el.props?.children?.[0] === 'string' && el.props.children[0].includes('测试成功'))
  assert.notEqual(jevTestMsg, undefined)

  // Modifying Jev key immediately clears the test success message
  const keyInput = findNode(harness.getTree(), (el) => el.props?.type === 'password')
  keyInput.props.onChange({ target: { value: 'ts-new-key' } })
  await harness.flush()

  jevTestMsg = findNode(harness.getTree(), (el) => typeof el.props?.className === 'string' && el.props.className.includes('tm-jev-status') && typeof el.props?.children?.[0] === 'string' && el.props.children[0].includes('测试成功'))
  assert.equal(jevTestMsg, undefined)

  // Test Jev again
  const testJevBtn2 = findNode(harness.getTree(), (el) => el.type === 'button' && el.props?.children?.[0] === '测试 Jev')
  testJevBtn2.props.onClick()
  await harness.flush()

  jevTestMsg = findNode(harness.getTree(), (el) => typeof el.props?.className === 'string' && el.props.className.includes('tm-jev-status') && typeof el.props?.children?.[0] === 'string' && el.props.children[0].includes('测试成功'))
  assert.notEqual(jevTestMsg, undefined)

  // Modifying Jev baseURL immediately clears the test success message
  const baseURLInput = findNode(harness.getTree(), (el) => el.props?.className === 'tm-input' && typeof el.props?.value === 'string' && el.props.value.startsWith('http'))
  baseURLInput.props.onChange({ target: { value: 'https://api.new-url.ai' } })
  await harness.flush()

  jevTestMsg = findNode(harness.getTree(), (el) => typeof el.props?.className === 'string' && el.props.className.includes('tm-jev-status') && typeof el.props?.children?.[0] === 'string' && el.props.children[0].includes('测试成功'))
  assert.equal(jevTestMsg, undefined)

  // Async in-flight discard for Jev test
  jevDeferred = createDeferred()
  const testJevBtn3 = findNode(harness.getTree(), (el) => el.type === 'button' && el.props?.children?.[0] === '测试 Jev')
  testJevBtn3.props.onClick()
  await harness.flush()

  // Modify baseURL while test is pending
  baseURLInput.props.onChange({ target: { value: 'https://api.another-url.ai' } })
  await harness.flush()

  // Resolve old test
  jevDeferred.resolve({ ok: true, value: { latencyMs: 50 } })
  jevDeferred = null
  await harness.flush()

  // Discarded old response does not show
  jevTestMsg = findNode(harness.getTree(), (el) => typeof el.props?.className === 'string' && el.props.className.includes('tm-jev-status') && typeof el.props?.children?.[0] === 'string' && el.props.children[0].includes('测试成功'))
  assert.equal(jevTestMsg, undefined)

  harness.unmount()
})

test('WorkflowRunPanel polling has inFlight guard preventing overlapping requests', async () => {
  let intervalCb = null
  const savedSetInterval = globalThis.setInterval
  const savedClearInterval = globalThis.clearInterval
  globalThis.setInterval = (cb) => {
    intervalCb = cb
    return 999
  }
  globalThis.clearInterval = () => {}

  let loadDetailsCalls = 0
  let deferred = null
  const mockLoadDetails = async () => {
    loadDetailsCalls++
    if (deferred) return deferred.promise
    return { models: {}, details: {} }
  }

  try {
    let panelComponent
    const ctx = {
      connection: { rpc: { call: async () => ({ ok: true, value: {} }) }, api: {} },
      remote: { $on: () => () => {}, session: {} },
      uiWorkspace: { openSession() {} },
      slots: {
        inject: (name, install) => install(),
        register: (entry, component) => {
          if (entry.name === 'conversation.chat.node') panelComponent = component
          return () => {}
        },
      },
    }

    const node = {
      data: {
        name: 'test-in-flight',
        status: 'running',
        phases: [{
          key: 'p1',
          members: [{ seq: 1, childId: 'c1', label: '任务1', status: 'running' }],
        }],
      },
    }

    const harness = createDeterministicHarness((props) => panelComponent(props), {
      node,
      sessionId: 'parent-s',
      loadDetails: mockLoadDetails,
    })

    const client = definition.factory((id) => {
      if (id === 'react') return harness.react
      assert.fail('unexpected dependency: ' + id)
    })

    client.apply(ctx)

    // Initial load: deferred is pending
    deferred = createDeferred()
    await harness.flush()

    assert.equal(loadDetailsCalls, 1)
    assert.equal(typeof intervalCb, 'function')

    // Interval fires while first call is in flight: guard MUST drop it
    intervalCb()
    intervalCb()
    assert.equal(loadDetailsCalls, 1)

    // First call finishes
    deferred.resolve({ models: { c1: { model: 'm1' } }, details: {} })
    deferred = null
    await harness.flush()

    // Next interval tick can now trigger a new request normally
    intervalCb()
    await harness.flush()
    assert.equal(loadDetailsCalls, 2)

    harness.unmount()
  } finally {
    globalThis.setInterval = savedSetInterval
    globalThis.clearInterval = savedClearInterval
  }
})

/**
 * 面板不得重新声明 color-scheme。
 *
 * light-dark() 只认最近的 color-scheme 祖先：面板一旦写 `color-scheme: light dark`，
 * 里面的 light-dark() 会退回跟随操作系统偏好。应用是暗色、系统是亮色时，输入框文字
 * 会被解析成亮色侧（#262626）压在暗底上，对比度 1.08:1，肉眼几乎不可见。
 * 主题与宿主的 color-scheme 写在 html 上，面板保持继承即可。
 */
test('面板不重置 color-scheme', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.equal(/color-scheme\s*:/u.test(client), false, '面板不得声明 color-scheme，交给宿主 html 继承')
})

/**
 * 实心主按钮的前景色必须走 Token，不能硬编码 #fff。
 * 暗色主题下 --dsw-alias-brand-primary 是白色，硬编码 #fff 就是白底白字。
 */
test('实心主按钮用 primary-foreground Token 而非硬编码白色', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const rule = client.match(/\.tm-primary\{([^}]*)\}/u)
  assert.ok(rule, '缺少 .tm-primary 规则')
  assert.match(rule[1], /background:\s*var\(--dsw-alias-brand-primary/u)
  assert.match(rule[1], /color:\s*var\(--dsw-alias-label-primary-foreground/u)
  assert.equal(/color\s*:\s*(#fff\b|#ffffff\b|white\b)/iu.test(rule[1]), false, '不得硬编码白色前景')
})
