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

async function createRuntime(roles, settingsSection = {}) {
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
  ctx.provide('agentPresets', {
    authorable: true,
    async list() { return [{ id: modelRoles.MODEL_ROLES_PRESET_ID }] },
    async copy() { throw new Error('model-roles preset already exists') },
    composedPreset() { return undefined },
    composeFrom() { return modelRoles.MODEL_ROLES_PRESET_ID },
  })
  const adapter = new RecordingAdapter()
  ctx.llm.registerAdapter(['e2e'], adapter)
  await modelRoles.apply(ctx)
  return { ctx, adapter }
}

function modelRolesMeta(meta = {}) {
  return { ...meta, agentPreset: modelRoles.MODEL_ROLES_PRESET_ID }
}

async function requestThroughHarness(ctx, agent, { turn = 1, step = 1 } = {}) {
  const config = await agentEvents(ctx, agent).waterfall('agent/request', {
    turn,
    step,
    signal: AbortSignal.timeout(5_000),
  }, () => Promise.resolve({
    provider: 'e2e',
    model: 'unrouted-model',
    reasoningEffort: 'high',
  }))
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
  const { ctx, adapter } = await createRuntime([...conversationRoles.filter((role) => role !== 'default'), 'tiny'].map((role) => ({
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
    const session = ctx.sessions.create(`role-e2e-${String(index)}`, {
      meta: modelRolesMeta(role === 'task' ? { origin: 'subagent', delegationDepth: 1 } : {}),
    })
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
  const { ctx, adapter } = await createRuntime([
    { role: 'smol', provider: 'e2e', model: 'smol-model' },
    { role: 'tiny', provider: 'e2e', model: 'tiny-model' },
  ])
  const session = ctx.sessions.create('automatic-role-turn-cache', { meta: modelRolesMeta() })
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
  const { ctx, adapter } = await createRuntime([
    { role: 'slow', provider: 'e2e', model: 'slow-model' },
    { role: 'tiny', provider: 'e2e', model: 'tiny-model' },
  ])
  const session = ctx.sessions.create('automatic-role-continuation', { meta: modelRolesMeta() })
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
  const { ctx, adapter } = await createRuntime([
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
        meta: modelRolesMeta({ origin: 'subagent', delegationDepth: 1 }),
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

  const session = ctx.sessions.create('vision-main-parent', { meta: modelRolesMeta() })
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
  assert.equal(decision.messages.some((message) => modelRoles.contentHasImage(message.content)), false)
  const returned = decision.messages.find((message) => message.source?.kind === 'plugin')
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
  const { ctx, adapter } = await createRuntime([
    { role: 'advisor', provider: 'e2e', model: 'advisor-model' },
  ], {
    advisor: { enabled: false, provider: 'advisor-e2e', subagents: false },
  })
  const created = []
  ctx.agents.setFactory({
    async createAgent(ownerCtx, options) {
      created.push(options)
      const childSession = ctx.sessions.create(options.sessionId, {
        meta: modelRolesMeta(options.meta),
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

  const session = ctx.sessions.create('advisor-e2e-parent', { meta: modelRolesMeta() })
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

  const enabled = await ctx.commands.execute(parent, '/advisor on', [], AbortSignal.timeout(5_000))
  assert.equal(enabled?.result.kind, 'success')

  const stopping = { turn: 1, signal: AbortSignal.timeout(5_000) }
  await agentEvents(ctx, parent).serial('agent/turn-stopping', stopping)
  await agentEvents(ctx, parent).serial('agent/turn-stopping', stopping)
  const disabled = await ctx.commands.execute(parent, '/advisor off', [], AbortSignal.timeout(5_000))
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
    kind: 'plugin',
    plugin: 'model-roles',
    form: 'notice',
    summary: 'Advisor review',
  })
})

test('tiny role routes real DSH title and compaction LLM calls', async () => {
  const { ctx, adapter } = await createRuntime([
    { role: 'smol', provider: 'e2e', model: 'smol-model' },
    { role: 'tiny', provider: 'e2e', model: 'tiny-model', reasoningEffort: 'low' },
  ])

  const session = ctx.sessions.create('tiny-auxiliary-routing', { meta: modelRolesMeta() })
  for (const purpose of ['session-title', 'compaction']) {
    await collect(ctx.llm.stream({
      provider: 'e2e',
      model: 'default-model',
      reasoningEffort: 'high',
      messages: [{ role: 'user', content: [{ type: 'text', text: purpose }] }],
      sessionId: session.id,
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

test('standard mode leaves conversation and auxiliary requests untouched', async () => {
  const { ctx, adapter } = await createRuntime([
    { role: 'smol', provider: 'e2e', model: 'smol-model' },
    { role: 'tiny', provider: 'e2e', model: 'tiny-model' },
  ])
  const session = ctx.sessions.create('standard-mode-routing', {
    meta: { agentPreset: 'standard' },
  })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Perform a mechanical rename in one file.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  await requestThroughHarness(ctx, { ctx, session, options: {} })
  await collect(ctx.llm.stream({
    provider: 'e2e',
    model: 'default-model',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'title' }] }],
    sessionId: session.id,
    purpose: 'session-title',
  }))
  assert.deepEqual(adapter.requests.map(({ model }) => model), ['unrouted-model', 'default-model'])
})
