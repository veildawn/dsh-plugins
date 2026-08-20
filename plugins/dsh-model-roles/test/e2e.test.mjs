import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry, agentEvents } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createUserMessage, LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { CommandRuntime } from '@deepseek-ai/dsh-commands'
import { GoalService } from '@deepseek-ai/dsh-goal'
import * as goalRoundDriver from '@deepseek-ai/dsh-goal-round-driver'
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

async function createRuntime(roles, settingsSection = {}, runtimeOptions = {}) {
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
  const goalCreates = []
  const goalViews = new WeakMap()
  if (runtimeOptions.nativeGoals) {
    new GoalService(ctx, { defaultMaxGoalRounds: 32 })
    goalRoundDriver.apply(ctx)
  } else {
    ctx.provide('goals', {
      get(agent) { return goalViews.get(agent) },
      create(agent, request) {
        goalCreates.push({ agent, request })
        const goal = {
          id: `goal-${String(goalCreates.length)}`, revision: 1,
          objective: request.objective, phase: 'active', activation: 'armed',
          roundsStarted: 0, maxGoalRounds: request.maxGoalRounds,
        }
        goalViews.set(agent, goal)
        return goal
      },
    })
  }
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
  return { ctx, adapter, goalCreates, goalViews }
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

function executeCommand(commands, agent, line, signal) {
  // dsh-commands rc.8 added an images argument; keep the integration test
  // compatible with the rc.7 runtime still used by the release workflow.
  return commands.execute.length >= 4
    ? commands.execute(agent, line, [], signal)
    : commands.execute(agent, line, signal)
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

  const enabled = await executeCommand(ctx.commands, parent, '/advisor on', AbortSignal.timeout(5_000))
  assert.equal(enabled?.result.kind, 'success')

  const stopping = { turn: 1, signal: AbortSignal.timeout(5_000) }
  await agentEvents(ctx, parent).serial('agent/turn-stopping', stopping)
  await agentEvents(ctx, parent).serial('agent/turn-stopping', stopping)
  const disabled = await executeCommand(ctx.commands, parent, '/advisor off', AbortSignal.timeout(5_000))
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

test('unfinished smart-mode work arms one native goal and advertises the continuous-work policy', async () => {
  const { ctx, goalCreates } = await createRuntime([], {
    continuous: { enabled: true, maxGoalRounds: 24 },
  })
  const session = ctx.sessions.create('continuous-work-parent', { meta: modelRolesMeta() })
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Review and repair the integration architecture.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('todo/write', { todos: [
    { content: 'Inspect the module', status: 'completed' },
    { content: 'Fix the boundary', status: 'in_progress' },
    { content: 'Verify the result', status: 'pending' },
  ] })
  const parent = { ctx, session, options: {} }
  const stopping = { turn: 1, signal: AbortSignal.timeout(5_000) }

  await agentEvents(ctx, parent).serial('agent/turn-stopping', stopping)
  await agentEvents(ctx, parent).serial('agent/turn-stopping', stopping)

  assert.equal(goalCreates.length, 1)
  assert.equal(goalCreates[0].agent, parent)
  assert.deepEqual(goalCreates[0].request, {
    objective: 'Review and repair the integration architecture.',
    maxGoalRounds: 24,
  })
  const assembly = await ctx.systemPrompt.assemble({ agent: parent, scope: ctx })
  assert(assembly.sections.some((section) => section.name === 'model-roles:continuous-work'))

  const standardSession = ctx.sessions.create('continuous-work-standard', {
    meta: { agentPreset: 'standard' },
  })
  standardSession.append('turn/start', { turn: 1 })
  standardSession.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Keep working.' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  standardSession.append('todo/write', { todos: [
    { content: 'Still open', status: 'in_progress' },
  ] })
  const standard = { ctx, session: standardSession, options: {} }
  await agentEvents(ctx, standard).serial('agent/turn-stopping', stopping)
  assert.equal(goalCreates.length, 1)
  const standardAssembly = await ctx.systemPrompt.assemble({ agent: standard, scope: ctx })
  assert.equal(standardAssembly.sections.some((section) => section.name === 'model-roles:continuous-work'), false)
})

test('continuous work hands the unfinished objective to the real DSH goal-round driver', async () => {
  const { ctx } = await createRuntime([], {
    continuous: { enabled: true, maxGoalRounds: 12 },
  }, { nativeGoals: true })
  const session = ctx.sessions.create('continuous-work-native-goal', { meta: modelRolesMeta() })
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Finish the integration audit and verify every finding.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('todo/write', { todos: [
    { content: 'Inspect boundaries', status: 'completed' },
    { content: 'Verify findings', status: 'in_progress' },
  ] })
  const queued = []
  const parent = {
    id: session.id,
    ctx,
    session,
    options: {},
    status: 'running',
    followup(message) { queued.push(message) },
    whenIdle() { return Promise.resolve() },
    cancel() {},
  }
  const unregister = ctx.agents.register(parent)
  try {
    await agentEvents(ctx, parent).serial('agent/turn-stopping', {
      turn: 1,
      signal: AbortSignal.timeout(5_000),
    })
    const goal = ctx.goals.get(parent)
    assert.equal(goal.phase, 'active')
    assert.equal(goal.activation, 'armed')
    assert.equal(goal.maxGoalRounds, 12)
    assert.equal(goal.objective, 'Finish the integration audit and verify every finding.')
    assert(session.events.some((event) => event.type === modelRoles.CONTINUOUS_GOAL_EVENT
      && event.data.goalId === goal.id))

    session.append('agent-preset/selected', { agentPreset: 'standard' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(ctx.goals.get(parent).activation, 'disarmed')
    parent.status = 'idle'
    agentEvents(ctx, parent).emit('agent/status', { status: 'idle' })
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(queued.length, 0)

    session.append('agent-preset/selected', { agentPreset: modelRoles.MODEL_ROLES_PRESET_ID })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(modelRoles.sessionPresetOf(session), modelRoles.MODEL_ROLES_PRESET_ID)
    assert.equal(modelRoles.continuousGoalOwnedByPlugin(session.events, goal.id), true)
    assert.equal(ctx.goals.get(parent).activation, 'armed')
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(queued.length, 1)
    assert.equal(queued[0].source.kind, 'goal')
    assert.equal(queued[0].source.round, 1)
    assert.match(queued[0].content[0].text, /Round: 1\/12/u)
    assert.match(queued[0].content[0].text, /Finish the integration audit/u)
  } finally {
    unregister()
  }
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
