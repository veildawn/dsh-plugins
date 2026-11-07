import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry, agentEvents } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createUserMessage, LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { CommandRuntime } from '@deepseek-ai/dsh-commands'
import { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import * as spawnInProcess from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as modelRoles from '../lib/index.js'

class MemorySettings extends SettingsProvider {
  constructor(ctx, doc) {
    super(ctx)
    this.doc = structuredClone(doc)
  }
  async load() { return structuredClone(this.doc) }
  async persist(ns, section) { this.doc[ns] = structuredClone(section) }
  get writable() { return true }
}

class RecordingAdapter extends LlmAdapter {
  constructor() {
    super()
    this.requests = []
  }
  providerInfo(provider) { return { id: provider, name: provider } }
  async listModels(provider) { return [{ provider, id: 'base', name: 'base' }] }
  async resolveModel(provider, model) {
    return {
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [
          { id: 'low', name: 'Low' },
          { id: 'high', name: 'High' },
        ],
      },
    }
  }
  async *stream(options) {
    this.requests.push(options)
    let output = options.model
    if (options.system?.includes('Classify the user task into one model role')) {
      const task = options.messages.flatMap((message) => message.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .toLowerCase()
      output = task.includes('mechanical rename') ? 'smol'
        : task.includes('architecture tradeoff') ? 'slow'
          : task.includes('dashboard experience') ? 'designer'
            : task.includes('conventional commit') ? 'commit'
              : 'default'
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: output }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: output } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function collect(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function createRuntime(roles, settingsSection = {}) {
  const ctx = new Context()
  new LlmRuntime(ctx)
  new SessionStore(ctx)
  new AgentRegistry(ctx)
  new SystemPrompt(ctx, { persona: '' })
  new ToolRuntime(ctx)
  new SubagentRuntime(ctx)
  const settings = new MemorySettings(ctx, {
    'model-roles': { roles, ...settingsSection },
  })
  settings.publish(settings.doc)
  new CommandRuntime(ctx)
  const adapter = new RecordingAdapter()
  ctx.llm.registerAdapter(['e2e'], adapter)
  modelRoles.apply(ctx)
  return { ctx, adapter }
}

/**
 * 模拟用户在对话框里手动切换模型：直接追加 model/selection 并通知插件。
 * 这里绕开 agent.model.select()，因为测试 agent 的该实现会先把选择登记成插件写入。
 */
function userSelect(session, selection) {
  session.append('model/selection', selection)
  return { type: 'model/selection', data: selection }
}

/**
 * 给测试 agent 补上与宿主一致的 agent.model 接口：current() 读会话日志里
 * pending/lastUsed 的选择，select() 追加 model/selection 事件。
 */
function attachModel(ctx, agent) {
  const read = () => {
    for (let index = agent.session.events.length - 1; index >= 0; index -= 1) {
      const event = agent.session.events[index]
      if (event?.type === 'request/header') return event.data?.header?.config
      if (event?.type === 'model/selection') return event.data
    }
    return agent.options
  }
  agent.model = {
    current: () => {
      const value = read()
      return value?.provider && value?.model ? { ...value } : undefined
    },
    select(selection) {
      agent.session.append('model/selection', {
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
      })
    },
  }
  return agent
}

/**
 * Drive the real host sequence for one step: prepare the step (where role routing
 * now selects the model), then run the request waterfall with that fixed
 * selection. Mirrors dsh-agent-loop: agent/request may not change the route.
 */
async function requestThroughHarness(ctx, agent, { turn = 1, step = 1, messages = [] } = {}) {
  if (agent.model === undefined) attachModel(ctx, agent)
  const base = { provider: 'e2e', model: 'unrouted-model', reasoningEffort: 'high' }
  const selection = { ...base, ...(agent.model?.current?.() ?? {}) }
  const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step', {
    turn,
    step,
    signal: AbortSignal.timeout(5_000),
    modelSelection: selection,
    messages,
  }, () => Promise.resolve({ kind: 'enter', messages }))
  if (decision.kind !== 'enter') throw new Error(`pre-step rejected: ${decision.kind}`)
  const fixed = { ...base, ...(agent.model?.current?.() ?? {}) }
  const config = await agentEvents(ctx, agent).waterfall('agent/request', {
    turn,
    step,
    signal: AbortSignal.timeout(5_000),
  }, () => Promise.resolve(fixed))
  const history = agent.session.deriveMessages()
  await collect(ctx.llm.stream({
    ...config,
    messages: history.length > 0 ? history : [createUserMessage({
      content: [{ type: 'text', text: 'role e2e' }],
      source: { kind: 'user' },
    })],
  }))
}

test('all conversation roles traverse DSH session, agent/request, and llm/stream', async () => {
  const conversationRoles = [
    'default', 'smol', 'slow', 'vision', 'plan',
    'designer', 'commit', 'task', 'advisor',
  ]
  const { ctx, adapter } = createRuntime([...conversationRoles.filter((role) => role !== 'default'), 'tiny'].map((role) => ({
    role,
    provider: 'e2e',
    model: `${role}-model`,
  })))
  const tasks = {
    default: 'Implement a normal feature with its tests.',
    smol: 'Perform a mechanical rename in one file.',
    slow: 'Resolve this architecture tradeoff with a rigorous analysis.',
    designer: 'Design the dashboard experience and visual hierarchy.',
    commit: 'Write a conventional commit message for the staged changes.',
    vision: 'Inspect this screenshot.',
    plan: 'Create the implementation plan.',
    task: 'Complete the delegated implementation task.',
    advisor: 'Review the primary agent transcript.',
  }

  for (const [index, role] of conversationRoles.entries()) {
    const session = ctx.sessions.create(`role-e2e-${String(index)}`, role === 'task'
      ? { meta: { origin: 'subagent', delegationDepth: 1, agentPreset: 'model-roles' } }
      : { meta: { agentPreset: 'model-roles' } })
    const agent = {
      ctx,
      session,
      options: role === 'advisor' || role === 'vision' ? { modelRole: role } : {},
    }
    if (role === 'vision') {
      session.append('user/message', createUserMessage({
        content: [
          { type: 'text', text: tasks[role] },
          { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
        ],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
    } else {
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: tasks[role] }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
    }
    if (role === 'plan') session.append('plan/mode', { active: true })
    await requestThroughHarness(ctx, agent)
  }

  const classifierRequests = adapter.requests.filter((request) =>
    request.system?.includes('Classify the user task into one model role'))
  assert.equal(classifierRequests.length, 5)
  assert.deepEqual(classifierRequests.map(({ model }) => model), Array(5).fill('tiny-model'))
  assert.deepEqual(classifierRequests.map(({ maxTokens }) => maxTokens), Array(5).fill(128))
  const routedRequests = adapter.requests.filter((request) =>
    !request.system?.includes('Classify the user task into one model role'))
  assert.deepEqual(routedRequests.map(({ model }) => model),
    conversationRoles.map((role) => role === 'default' ? 'unrouted-model' : `${role}-model`))
})

test('automatic task classification runs once per agent turn across tool-loop steps', async () => {
  const { ctx, adapter } = createRuntime([
    { role: 'smol', provider: 'e2e', model: 'smol-model' },
    { role: 'tiny', provider: 'e2e', model: 'tiny-model' },
  ])
  const session = ctx.sessions.create('automatic-role-turn-cache', {
    meta: { agentPreset: 'model-roles' },
  })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Perform a mechanical rename in one file.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const agent = { ctx, session, options: {} }

  await requestThroughHarness(ctx, agent)
  await requestThroughHarness(ctx, agent)

  const classifier = adapter.requests.filter((request) =>
    request.system?.includes('Classify the user task into one model role'))
  const routed = adapter.requests.filter((request) =>
    !request.system?.includes('Classify the user task into one model role'))
  assert.equal(classifier.length, 1)
  assert.deepEqual(routed.map(({ model }) => model), ['smol-model', 'smol-model'])
})

test('continuation-only turns retain the substantive task role after an agent reload', async () => {
  const { ctx, adapter } = createRuntime([
    { role: 'slow', provider: 'e2e', model: 'slow-model' },
    { role: 'tiny', provider: 'e2e', model: 'tiny-model' },
  ])
  const session = ctx.sessions.create('automatic-role-continuation', {
    meta: { agentPreset: 'model-roles' },
  })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Resolve this architecture tradeoff with a rigorous analysis.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })

  await requestThroughHarness(ctx, { ctx, session, options: {} }, { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '继续' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  await requestThroughHarness(ctx, { ctx, session, options: {} }, { turn: 2 })

  const classifier = adapter.requests.filter((request) =>
    request.system?.includes('Classify the user task into one model role'))
  const routed = adapter.requests.filter((request) =>
    !request.system?.includes('Classify the user task into one model role'))
  assert.equal(classifier.length, 2)
  assert.deepEqual(routed.map(({ model }) => model), ['slow-model', 'slow-model'])
})

test('image input runs once in a vision subagent and returns text-only analysis to the main agent', async () => {
  const { ctx, adapter } = createRuntime([
    { role: 'vision', provider: 'e2e', model: 'vision-model' },
    { role: 'tiny', provider: 'e2e', model: 'tiny-model' },
  ])
  const starts = []
  let childIndex = 0
  ctx.subagents.registerProvider({
    name: 'spawn',
    capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    async start(request) {
      starts.push(request)
      const childSession = ctx.sessions.create(`vision-e2e-child-${String(childIndex++)}`, {
        meta: { origin: 'subagent', delegationDepth: 1, agentPreset: 'model-roles' },
      })
      childSession.append('user/message', createUserMessage({
        content: request.prompt,
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      const child = { ctx, session: childSession, options: request.agentOptions ?? {} }
      await requestThroughHarness(ctx, child)
      return {
        id: childSession.id,
        localAgent: child,
        result: Promise.resolve({
          stopReason: 'completed',
          output: [{ type: 'text', text: 'The screenshot shows a red error banner.' }],
        }),
        async dispose() {},
      }
    },
  })

  const session = ctx.sessions.create('vision-main-parent', {
    meta: { agentPreset: 'model-roles' },
  })
  const parent = { ctx, session, options: {} }
  const imageMessage = createUserMessage({
    content: [
      { type: 'text', text: 'Implement ordinary error handling based on this screenshot.' },
      { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
    ],
    source: { kind: 'user' },
  })
  const decision = await agentEvents(ctx, parent).waterfall('agent/pre-step', {
    agent: parent,
    messages: [imageMessage],
    turn: 1,
    step: 1,
    signal: AbortSignal.timeout(5_000),
  }, () => Promise.resolve({ kind: 'enter', messages: [imageMessage] }))

  assert.equal(decision.kind, 'enter')
  assert.equal(starts.length, 1)
  assert.equal(starts[0].label, 'vision')
  assert.equal(starts[0].agentOptions.modelRole, 'vision')
  assert.equal(starts[0].agentOptions.maxTokens, 4096)
  assert.deepEqual(starts[0].toolFilter, { allow: [] })
  assert(starts[0].prompt.some((block) => block.type === 'image'))
  // decision.messages 必须保留原始用户图片，以便持久化到 user/message 事件中供前端正常渲染回显
  assert.equal(decision.messages.some((message) => modelRoles.contentHasImage(message.content)), true)
  const returned = decision.messages.find((message) => message.source?.kind === 'plugin:model-roles')
  assert.match(returned.content[0].text, /red error banner/u)
  assert.equal(returned.source.summary, 'Vision analysis')

  for (const message of decision.messages) {
    session.append('user/message', message, { surfaceOp: 'append' })
  }
  await requestThroughHarness(ctx, parent)
  assert.deepEqual(adapter.requests.map(({ model }) => model), [
    'vision-model',
    'tiny-model',
    'unrouted-model',
  ])
})

test('/advisor drives the real DSH spawn provider and steers actionable advice', async () => {
  const { ctx, adapter } = createRuntime([
    { role: 'advisor', provider: 'e2e', model: 'advisor-model' },
  ], {
    advisor: { enabled: false, provider: 'advisor-e2e', subagents: false },
  })
  const created = []
  ctx.agents.setFactory({
    async createAgent(ownerCtx, options) {
      created.push(options)
      const childSession = ctx.sessions.create(options.sessionId, {
        meta: { ...options.meta, agentPreset: 'model-roles' },
        seed: options.seed,
      })
      let activity = Promise.resolve()
      const child = {
        id: childSession.id,
        session: childSession,
        options: options.agentOptions ?? {},
        ctx: undefined,
        followup(message) {
          activity = (async () => {
            childSession.append('turn/start', { turn: 1 })
            await agentEvents(ctx, child).waterfall('agent/pre-step', {
              messages: [message],
              turn: 1,
              step: 1,
              signal: AbortSignal.timeout(5_000),
            }, () => Promise.resolve({ kind: 'enter', messages: [message] }))
            childSession.append('user/message', message, { surfaceOp: 'append' })
            childSession.append('step/start', { turn: 1, step: 1 })
            await requestThroughHarness(ctx, child)
            childSession.append('assistant/message', {
              turn: 1,
              step: 1,
              message: createAssistantMessage({
                content: [{ type: 'text', text: 'Check the error path before shipping.' }],
                source: { provider: 'e2e', model: 'advisor-model' },
              }),
            }, { surfaceOp: 'append' })
            childSession.append('step/end', { turn: 1, step: 1 })
            childSession.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
          })()
        },
        whenIdle() { return activity },
        cancel() {},
      }
      const childCtx = ownerCtx.extend({ agent: child })
      child.ctx = childCtx
      await options.setup?.(childCtx)
      const unregister = ctx.agents.register(child)
      return {
        agent: child,
        async dispose() { unregister() },
      }
    },
    async resume() { throw new Error('not used') },
  })
  spawnInProcess.apply(ctx, { providerName: 'advisor-e2e' })

  const session = ctx.sessions.create('advisor-e2e-parent', {
    meta: { agentPreset: 'model-roles' },
  })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Implement the change.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const steered = []
  const parent = {
    ctx,
    session,
    options: { provider: 'e2e', model: 'default-model' },
    steer(message) { steered.push(message) },
  }

  // dsh-commands rc.6/rc.7 take (agent, line, signal); rc.8+ added the images
  // argument. Match the resolved signature so the test passes on both.
  const execute = (line) => ctx.commands.execute.length >= 4
    ? ctx.commands.execute(parent, line, [], AbortSignal.timeout(5_000))
    : ctx.commands.execute(parent, line, AbortSignal.timeout(5_000))

  const enabled = await execute('/advisor on')
  assert.equal(enabled?.result.kind, 'success')

  const stopping = { turn: 1, signal: AbortSignal.timeout(5_000) }
  await agentEvents(ctx, parent).serial('agent/turn-stopping', stopping)
  await agentEvents(ctx, parent).serial('agent/turn-stopping', stopping)
  const disabled = await execute('/advisor off')
  assert.equal(disabled?.result.kind, 'success')
  await agentEvents(ctx, parent).serial('agent/turn-stopping', {
    turn: 2,
    signal: AbortSignal.timeout(5_000),
  })

  assert.equal(created.length, 1)
  assert.equal(created[0].agentOptions.modelRole, 'advisor')
  assert.equal(adapter.requests.at(-1).model, 'advisor-model')
  assert.equal(steered.length, 1)
  assert.match(steered[0].content[0].text, /Check the error path/u)
  assert.deepEqual(steered[0].source, {
    kind: 'plugin:model-roles',
    form: 'notice',
    summary: 'Advisor review',
  })
})

test('tiny role routes real DSH title and compaction LLM calls', async () => {
  const { ctx, adapter } = createRuntime([
    { role: 'smol', provider: 'e2e', model: 'smol-model' },
    { role: 'tiny', provider: 'e2e', model: 'tiny-model', reasoningEffort: 'low' },
  ])

  for (const purpose of ['session-title', 'compaction']) {
    await collect(ctx.llm.stream({
      provider: 'e2e',
      model: 'default-model',
      reasoningEffort: 'high',
      messages: [{ role: 'user', content: [{ type: 'text', text: purpose }] }],
      purpose,
    }))
  }

  assert.deepEqual(adapter.requests.map(({ model, reasoningEffort, purpose }) => ({
    model, reasoningEffort, purpose,
  })), [
    { model: 'tiny-model', reasoningEffort: 'low', purpose: 'session-title' },
    { model: 'tiny-model', reasoningEffort: 'low', purpose: 'compaction' },
  ])
})

test('standard presets bypass vision delegation and automatic task classification', async () => {
  const { ctx, adapter } = createRuntime([
    { role: 'vision', provider: 'e2e', model: 'vision-model' },
    { role: 'smol', provider: 'e2e', model: 'smol-model' },
    { role: 'tiny', provider: 'e2e', model: 'tiny-model' },
  ])
  const starts = []
  ctx.subagents.registerProvider({
    name: 'spawn',
    capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    async start(request) {
      starts.push(request)
      return {
        id: 'child-1',
        result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'analysis' }] }),
        dispose: () => Promise.resolve(),
      }
    },
  })

  // A session running on standard 'code' preset
  const codeSession = ctx.sessions.create('standard-preset-session', {
    meta: { agentPreset: 'code' },
  })
  const imageMessage = createUserMessage({
    content: [
      { type: 'text', text: 'Look at this code screenshot' },
      { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
    ],
    source: { kind: 'user' },
  })
  const parent = { ctx, session: codeSession, options: {} }

  const decision = await agentEvents(ctx, parent).waterfall('agent/pre-step', {
    messages: [imageMessage],
    turn: 1,
    step: 1,
    signal: AbortSignal.timeout(5_000),
  }, () => Promise.resolve({ kind: 'enter', messages: [imageMessage] }))

  // Vision delegation must be bypassed: image is preserved, no vision subagent spawned
  assert.equal(decision.kind, 'enter')
  assert.equal(starts.length, 0)
  assert.equal(decision.messages[0].content.some((b) => b.type === 'image'), true)

  // Agent request must not trigger tiny-model classifier: keeps original model
  codeSession.append('user/message', imageMessage, { surfaceOp: 'append' })
  await requestThroughHarness(ctx, parent)

  const classifierRequests = adapter.requests.filter((r) =>
    r.system?.includes('Classify the user task into one model role'))
  assert.equal(classifierRequests.length, 0)
  const routedRequests = adapter.requests.filter((r) =>
    !r.system?.includes('Classify the user task into one model role'))
  assert.equal(routedRequests.at(-1).model, 'unrouted-model')
})

test('smart mode heals sandbox arguments on tool execution to prevent strictly-wider errors', async () => {
  const { ctx } = createRuntime([])
  let receivedArgs
  ctx.tools.register({
    name: 'write',
    description: 'Write file',
    parameters: {
      properties: {
        file_path: { type: 'string' },
        content: { type: 'string' },
        sandbox_permissions: { type: 'string' },
        justification: { type: 'string' },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args) {
      receivedArgs = args
      if (args.sandbox_permissions === 'danger-full-access') {
        throw new Error('sandbox escalation to "danger-full-access" is not strictly wider than this call\'s current "danger-full-access" mode')
      }
      return 'ok'
    },
  })

  ctx.provide('sandboxPolicy', {
    resolve: () => ({ mode: 'danger-full-access' }),
  })

  const session = ctx.sessions.create('smart-mode-session', {
    meta: { agentPreset: 'model-roles' },
  })
  const agent = { id: session.id, session, options: {}, ctx }

  const toolResult = await ctx.tools.execute({
    callId: 'call-1',
    name: 'write',
    arguments: {
      file_path: 'test.txt',
      content: 'hello',
      sandbox_permissions: 'danger-full-access',
      justification: 'write file',
    },
    agent,
    signal: AbortSignal.timeout(5_000),
  })

  assert.equal(toolResult.isError, false, 'tool must execute successfully without throwing strictly-wider error')
  assert.equal(receivedArgs.file_path, 'test.txt')
  assert.equal(receivedArgs.content, 'hello')
  assert.equal(receivedArgs.sandbox_permissions, undefined, 'sandbox_permissions must be stripped')
  assert.equal(receivedArgs.justification, undefined, 'justification must be stripped')
})

test('sandbox guard also protects standard non-smart sessions and sanitizes prompt assembly', async () => {
  const { ctx } = createRuntime([])
  let receivedArgs
  ctx.tools.register({
    name: 'pwsh',
    description: 'Execute command',
    parameters: {
      properties: {
        command: { type: 'string' },
        sandbox_permissions: { type: 'string', enum: ['workspace-write', 'danger-full-access'] },
        justification: { type: 'string' },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args) {
      receivedArgs = args
      if (args.sandbox_permissions === 'danger-full-access') {
        throw new Error('sandbox escalation to "danger-full-access" is not strictly wider than this call\'s current "danger-full-access" mode')
      }
      return 'ok'
    },
  })

  ctx.provide('sandboxPolicy', {
    resolve: () => ({ mode: 'danger-full-access' }),
  })

  // 模拟没有智选模式 preset 的普通标准会话 (preset: standard)
  const session = ctx.sessions.create('standard-session', {
    meta: { agentPreset: 'standard' },
  })
  const agent = { id: session.id, session, options: {}, ctx }

  // 1. 测试工具执行防御（在非智选会话中同样生效）
  const toolResult = await ctx.tools.execute({
    callId: 'call-2',
    name: 'pwsh',
    arguments: {
      command: 'dir',
      sandbox_permissions: 'danger-full-access',
      justification: 'run command',
    },
    agent,
    signal: AbortSignal.timeout(5_000),
  })

  assert.equal(toolResult.isError, false, 'must execute successfully in standard session')
  assert.equal(receivedArgs.sandbox_permissions, undefined, 'sandbox_permissions must be stripped in standard session')

  // 2. 测试提示词组装期 Schema 收窄防御
  const assembled = await ctx.systemPrompt.assemble({ agent })
  const pwshTool = assembled.tools.find((t) => t.name === 'pwsh')
  assert.ok(pwshTool, 'pwsh tool schema should exist')
  assert.equal(pwshTool.parameters.properties.sandbox_permissions, undefined, 'must hide sandbox_permissions from prompt schema at top mode')
})

test('a user re-selecting the plugin-written model is treated as a plugin write; the role route reasserts on the next request', async () => {
  // 已知边界（见 README「与 DSH 模型选择器的关系」）：用户手动选回插件刚写入的同一模型时，
  // 宿主事件流上与插件写入逐字节相同、无来源标记，无法区分，按插件自身写入处理。
  // 回合结束还原基准后，下一条消息的角色路由仍会路由回该模型，最终收敛到同一选择。
  const { ctx } = createRuntime([
    { role: 'slow', provider: 'e2e', model: 'slow-model' },
    { role: 'tiny', provider: 'e2e', model: 'tiny-model' },
  ])
  const session = ctx.sessions.create('plugin-route-revoke-session', {
    meta: { agentPreset: 'model-roles' },
  })
  session.append('model/selection', { provider: 'e2e', model: 'default-model' })
  const agent = attachModel(ctx, { id: session.id, session, options: { provider: 'e2e', model: 'default-model' }, ctx, inbox: { nextStep: [] } })

  // 路由写入 slow-model（插件自身写入）
  agent.options.modelRole = 'slow'
  await requestThroughHarness(ctx, agent)
  assert.equal(agent.model.current().model, 'slow-model')

  // 用户此后又主动选了同一个 slow-model（宿主 UI 的切换动作）。
  userSelect(session, { provider: 'e2e', model: 'slow-model' })

  await agentEvents(ctx, agent).serial('agent/turn-stopping', {
    agent, turn: 1, signal: AbortSignal.timeout(5_000),
  })
  assert.equal(agent.model.current().model, 'default-model', 'same-key reselection is indistinguishable from a plugin write, so the baseline is restored')

  // 下一条消息：角色路由仍然生效，重新路由回 slow-model，与用户的选择收敛
  await requestThroughHarness(ctx, agent, { turn: 2 })
  assert.equal(agent.model.current().model, 'slow-model', 'the role route reasserts on the next request')
})

test('a model selection does not reach the step that is already prepared', async () => {
  // 回归：宿主的 preStep 在瀑布之前就读定了 selection，之后不再重读。
  // 因此 pre-step 内写入的选择只对「下一个请求」生效，无法改写本步骤已固定的模型。
  const { ctx } = createRuntime([
    { role: 'slow', provider: 'e2e', model: 'slow-model' },
    { role: 'tiny', provider: 'e2e', model: 'tiny-model' },
  ])
  const session = ctx.sessions.create('pre-step-snapshot-session', {
    meta: { agentPreset: 'model-roles' },
  })
  session.append('model/selection', { provider: 'e2e', model: 'default-model' })
  const agent = attachModel(ctx, { id: session.id, session, options: { provider: 'e2e', model: 'default-model' }, ctx })
  agent.options.modelRole = 'slow'

  // 宿主取快照
  const captured = agent.model.current()
  await agentEvents(ctx, agent).waterfall('agent/pre-step', {
    agent, turn: 1, step: 1, signal: AbortSignal.timeout(5_000), modelSelection: captured,
  }, () => Promise.resolve({ kind: 'enter', messages: [] }))

  // 快照未被改写；新选择只影响之后才读取 current() 的一方
  assert.equal({ ...captured }.model, 'default-model', 'the captured selection must stay untouched')
  assert.equal(agent.model.current().model, 'slow-model', 'select() applies to the NEXT read only')
})

test('role routing selects the model during step preparation and never rewrites agent/request', async () => {
  const { ctx, adapter } = createRuntime([
    { role: 'slow', provider: 'e2e', model: 'slow-model' },
    { role: 'tiny', provider: 'e2e', model: 'tiny-model' },
  ])
  const session = ctx.sessions.create('pre-step-select-session', {
    meta: { agentPreset: 'model-roles' },
  })
  session.append('model/selection', { provider: 'e2e', model: 'default-model' })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Resolve this architecture tradeoff with a rigorous analysis.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const agent = attachModel(ctx, { id: session.id, session, options: { provider: 'e2e', model: 'default-model' }, ctx })

  // 宿主先取一次 selection（default-model），pre-step 期间插件完成分类并写入 slow-model
  const selection = { provider: 'e2e', model: 'default-model', reasoningEffort: 'high', maxTokens: 64 }
  const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step', {
    agent,
    turn: 1,
    step: 1,
    signal: AbortSignal.timeout(5_000),
    modelSelection: selection,
  }, () => Promise.resolve({ kind: 'enter', messages: [] }))
  assert.equal(decision.kind, 'enter')
  assert.deepEqual(
    { provider: agent.model.current().provider, model: agent.model.current().model },
    { provider: 'e2e', model: 'slow-model' },
    'pre-step must record the routed model before the host fixes the selection',
  )

  // 宿主随后以固定 selection 调用 agent/request，监听器只能原样放行
  const fixed = { ...selection, provider: 'e2e', model: 'slow-model' }
  const proposed = await agentEvents(ctx, agent).waterfall('agent/request', {
    agent,
    turn: 1,
    step: 1,
    signal: AbortSignal.timeout(5_000),
  }, () => Promise.resolve(fixed))
  assert.deepEqual(
    { provider: proposed.provider, model: proposed.model, reasoningEffort: proposed.reasoningEffort, maxTokens: proposed.maxTokens },
    { provider: 'e2e', model: 'slow-model', reasoningEffort: 'high', maxTokens: 64 },
    'agent/request must return the fixed selection untouched',
  )

  // 同一回合的后续步骤复用分类结果，不重复调用分类器
  const second = await agentEvents(ctx, agent).waterfall('agent/pre-step', {
    agent,
    turn: 1,
    step: 2,
    signal: AbortSignal.timeout(5_000),
    modelSelection: fixed,
  }, () => Promise.resolve({ kind: 'enter', messages: [] }))
  assert.equal(second.kind, 'enter')
  assert.equal(adapter.requests.filter((request) =>
    request.system?.includes('Classify the user task into one model role')).length, 1)
  assert.equal(agent.model.current().model, 'slow-model')
})

test('smart mode: restores default model selection after turn ends when a role was switched', async () => {
  const { ctx } = createRuntime([
    { role: 'slow', provider: 'e2e', model: 'slow-model' },
    { role: 'tiny', provider: 'e2e', model: 'tiny-model' },
  ])

  // 创建智选模式会话，初始模型为 default-model
  const session = ctx.sessions.create('smart-restore-session', {
    meta: { agentPreset: 'model-roles' },
  })
  session.append('model/selection', { provider: 'e2e', model: 'default-model' })

  const agent = {
    id: session.id,
    session,
    options: { provider: 'e2e', model: 'default-model' },
    ctx,
    inbox: { nextStep: [] },
  }

  // 1. 第一步：准备期完成角色路由（显式指定 slow），宿主随后把 slow-model 固定为本步骤模型
  attachModel(ctx, agent)
  agent.options.modelRole = 'slow'
  await requestThroughHarness(ctx, agent)
  const requestedConfig = agent.model.current()
  assert.equal(requestedConfig.model, 'slow-model', 'turn request must be routed to slow-model')

  // 模拟请求被执行并持久化到 request/header
  session.append('request/header', {
    header: {
      config: { provider: 'e2e', model: 'slow-model' },
    },
    reason: 'initial',
  })

  // 2. 回合结束：触发 agent/turn-stopping
  await agentEvents(ctx, agent).serial('agent/turn-stopping', {
    agent,
    turn: 1,
    signal: AbortSignal.timeout(5_000),
  })

  // 3. 验证会话事件中已经追加恢复默认模型的事件
  const lastEvent = session.events.at(-1)
  assert.equal(lastEvent.type, 'model/selection', 'must append model/selection event to restore baseline')
  assert.equal(lastEvent.data.model, 'default-model', 'restored model must be default-model')
  assert.equal(lastEvent.data.provider, 'e2e', 'restored provider must be e2e')
})

test('smart mode: restores default model and reasoning effort on abort/idle or session stop', async () => {
  const { ctx } = createRuntime([
    { role: 'slow', provider: 'e2e', model: 'slow-model', reasoningEffort: 'low' },
  ])

  // 创建智选模式会话，用户显式选择了 high 思考等级
  const session = ctx.sessions.create('smart-idle-restore-session', {
    meta: { agentPreset: 'model-roles' },
  })
  session.append('model/selection', { provider: 'e2e', model: 'default-model', reasoningEffort: 'high' })

  const agent = {
    id: session.id,
    session,
    options: { provider: 'e2e', model: 'default-model', reasoningEffort: 'high' },
    ctx,
    inbox: { nextStep: [] },
  }

  // 模拟任务开始，角色路由切换为带 low 思考等级的 slow-model
  attachModel(ctx, agent)
  agent.options.modelRole = 'slow'
  await requestThroughHarness(ctx, agent)
  const requestedConfig = agent.model.current()
  assert.equal(requestedConfig.model, 'slow-model')
  assert.equal(requestedConfig.reasoningEffort, 'low')

  session.append('request/header', {
    header: {
      config: { provider: 'e2e', model: 'slow-model', reasoningEffort: 'low' },
    },
    reason: 'change',
  })

  // 模拟任务被用户强行打断取消（未调用 turn-stopping，直接进入 idle）
  await agentEvents(ctx, agent).emit('agent/status', {
    agent,
    status: 'idle',
  })

  // 验证会话在停止时精准还原为用户设定的 default-model 及 high 思考等级
  const lastEvent = session.events.at(-1)
  assert.equal(lastEvent.type, 'model/selection')
  assert.equal(lastEvent.data.model, 'default-model')
  assert.equal(lastEvent.data.provider, 'e2e')
  assert.equal(lastEvent.data.reasoningEffort, 'high')
})

test('smart mode: restores user-selected model when changed mid-session', async () => {
  const { ctx } = createRuntime([
    { role: 'slow', provider: 'e2e', model: 'slow-model' },
  ])

  const session = ctx.sessions.create('smart-mid-change-session', {
    meta: { agentPreset: 'model-roles' },
  })
  // 用户初始选择 A
  session.append('model/selection', { provider: 'e2e', model: 'model-a' })

  const agent = {
    id: session.id,
    session,
    options: { provider: 'e2e', model: 'model-a' },
    ctx,
    inbox: { nextStep: [] },
  }

  // 回合 1：角色切换为 slow-model
  agent.options.modelRole = 'slow'
  await agentEvents(ctx, agent).waterfall('agent/request', {
    agent, turn: 1, step: 1, signal: AbortSignal.timeout(5_000),
  }, () => Promise.resolve({ provider: 'e2e', model: 'model-a' }))

  session.append('request/header', {
    header: { config: { provider: 'e2e', model: 'slow-model' } },
    reason: 'change',
  })

  // 假设用户中途手动切换为了 model-b
  session.append('model/selection', { provider: 'e2e', model: 'model-b', reasoningEffort: 'high' })

  // 任务完成，结束回合
  await agentEvents(ctx, agent).serial('agent/turn-stopping', {
    agent, turn: 1, signal: AbortSignal.timeout(5_000),
  })

  // 必须精准恢复为中途切换的新模型 model-b
  const lastEvent = session.events.at(-1)
  assert.equal(lastEvent.type, 'model/selection')
  assert.equal(lastEvent.data.model, 'model-b')
  assert.equal(lastEvent.data.reasoningEffort, 'high')
})






