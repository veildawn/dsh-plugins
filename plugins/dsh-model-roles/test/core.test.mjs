import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_ROLES,
  CONFIGURABLE_ROLES,
  CONTINUOUS_GOAL_EVENT,
  CONTINUOUS_WORK_SYSTEM,
  MODEL_ROLES_PRESET_ID,
  MODEL_ROLES_PRESET_NAME,
  OMP_ROLES,
  advisorEnabledOf,
  agentHasImage,
  applyRoleRoute,
  contentHasImage,
  continuousGoalOwnedByPlugin,
  continuousGoalRequest,
  modelRolesActive,
  modelRolesActiveForSession,
  normalizeRoleId,
  parseAutomaticRole,
  planModeActive,
  resolveRoleTable,
  roleForAgent,
  routeAgentRequest,
  routeForRole,
  sessionPresetOf,
  taskTextOf,
  unfinishedTodosForTurn,
} from '../lib/core.js'

function agent({ events = [], header = {}, options = {}, livePreset, messages } = {}) {
  return {
    options,
    session: {
      events,
      header,
      ...(messages === undefined ? {} : { deriveMessages: () => messages }),
    },
    ctx: {
      get(name) {
        if (name !== 'agentPresets' || livePreset === undefined) return undefined
        return { composedPreset: () => livePreset }
      },
    },
  }
}

const table = resolveRoleTable({
  roles: [
    { role: 'default', provider: 'proxy', model: 'balanced', reasoningEffort: 'medium' },
    { role: 'plan', provider: 'proxy', model: 'reasoner', reasoningEffort: 'high' },
    { role: 'task', provider: 'proxy', model: 'flash', reasoningEffort: 'low' },
    { role: 'smol', provider: 'proxy', model: 'mini', reasoningEffort: 'low' },
    { role: 'designer', provider: 'vision', model: 'canvas', reasoningEffort: '' },
  ],
})

test('the complete OMP vocabulary is the only built-in role set', () => {
  assert.equal(MODEL_ROLES_PRESET_ID, 'model-roles')
  assert.equal(MODEL_ROLES_PRESET_NAME, '智选模式')
  assert.deepEqual(OMP_ROLES, [
    'default', 'smol', 'slow', 'vision', 'plan', 'designer', 'commit', 'tiny', 'task', 'advisor',
  ])
  assert.deepEqual(BUILTIN_ROLES, OMP_ROLES)
  assert.deepEqual(CONFIGURABLE_ROLES, [
    'smol', 'slow', 'vision', 'plan', 'designer', 'commit', 'tiny', 'task', 'advisor',
  ])
})

test('model roles activate only for the opt-in preset and follow live selection events', () => {
  const standard = agent({ header: { agentPreset: 'standard' } })
  const active = agent({ header: { agentPreset: 'model-roles' } })
  const liveStandard = agent({ header: { agentPreset: 'model-roles' }, livePreset: 'standard' })
  const switched = agent({
    header: { agentPreset: 'standard' },
    events: [{ type: 'agent-preset/selected', data: { agentPreset: 'model-roles' } }],
  })
  assert.equal(modelRolesActive(standard), false)
  assert.equal(modelRolesActive(active), true)
  assert.equal(modelRolesActive(liveStandard), false)
  assert.equal(modelRolesActive(switched), true)
  assert.equal(modelRolesActiveForSession(switched.session), true)
  assert.equal(sessionPresetOf(switched.session), 'model-roles')
})

test('role ids normalize, legacy default routes are ignored, and invalid tables fail loud', () => {
  assert.equal(normalizeRoleId(' Designer '), 'designer')
  assert.throws(() => normalizeRoleId('@slow'), /must match/)
  assert.throws(() => resolveRoleTable({ roles: [
    { role: 'plan', provider: 'p', model: 'a' },
    { role: 'PLAN', provider: 'p', model: 'b' },
  ] }), /duplicate role/)
  assert.throws(() => resolveRoleTable({ roles: [{ role: 'plan', provider: '', model: 'a' }] }), /needs non-empty/)
  assert.equal(resolveRoleTable({ roles: [
    { role: ' DEFAULT ', provider: 'legacy', model: 'forced' },
  ] }).size, 0)
  assert.equal(table.has('default'), false)
})

test('plan mode folds the latest public plan/mode event', () => {
  assert.equal(planModeActive([]), false)
  assert.equal(planModeActive([
    { type: 'plan/mode', data: { active: true } },
    { type: 'message', data: {} },
    { type: 'plan/mode', data: { active: false } },
  ]), false)
  assert.equal(planModeActive([
    { type: 'plan/mode', data: { active: false } },
    { type: 'plan/mode', data: { active: true } },
  ]), true)
})

test('image detection walks durable messages and nested tool results', () => {
  const nested = [{ type: 'tool-result', content: [{ type: 'image', attachment: { attachmentId: 'i' } }] }]
  assert.equal(contentHasImage(nested), true)
  assert.equal(contentHasImage([{ type: 'text', text: 'plain' }]), false)
  assert.equal(agentHasImage(agent({
    messages: [{ role: 'user', content: nested }],
  })), true)
  assert.equal(agentHasImage(agent({
    events: [{ type: 'user/message', data: { content: [{ type: 'image' }] } }],
  })), true)
})

test('automatic task routing reads the latest substantive user task and accepts only classifier roles', () => {
  assert.equal(taskTextOf(agent({ messages: [
    { role: 'user', content: [{ type: 'text', text: 'old task' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
    { role: 'user', content: [{ type: 'text', text: 'design the dashboard' }, { type: 'image' }] },
  ] })), 'design the dashboard')
  assert.equal(taskTextOf(agent({ messages: [
    { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'mechanically rename this symbol' }] },
    { role: 'user', source: { kind: 'plugin', plugin: 'runtime' }, content: [{ type: 'text', text: 'Current runtime context' }] },
    { role: 'user', source: { kind: 'plugin', plugin: 'skills' }, content: [{ type: 'text', text: '<system-reminder>skills</system-reminder>' }] },
  ] })), 'mechanically rename this symbol')
  assert.equal(taskTextOf(agent({ messages: [
    { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Resolve this architecture tradeoff.' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'I started the analysis.' }] },
    { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }] },
  ] })), 'Resolve this architecture tradeoff.')
  assert.equal(parseAutomaticRole('designer'), 'designer')
  assert.equal(parseAutomaticRole('`slow`\n'), 'slow')
  assert.equal(parseAutomaticRole('task'), undefined)
  assert.equal(parseAutomaticRole('designer or slow'), undefined)
})

test('continuous work converts only current-turn unfinished todos into a bounded goal request', () => {
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'todo/write', data: { todos: [
      { content: 'Inspect the module', status: 'completed' },
      { content: 'Fix the boundary', status: 'in_progress' },
      { content: 'Verify the result', status: 'pending' },
    ] } },
  ]
  const active = agent({
    header: { agentPreset: 'model-roles' },
    events,
    messages: [{
      role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: 'Review and repair the integration architecture.' }],
    }],
  })

  assert.deepEqual(unfinishedTodosForTurn(events, 1).map(({ content }) => content), [
    'Fix the boundary', 'Verify the result',
  ])
  assert.deepEqual(continuousGoalRequest(active, 1, { enabled: true, maxGoalRounds: 24 }), {
    objective: 'Review and repair the integration architecture.',
    maxGoalRounds: 24,
  })
  assert.equal(CONTINUOUS_GOAL_EVENT, 'model-roles/continuous-goal')
  assert.equal(continuousGoalOwnedByPlugin([
    { type: CONTINUOUS_GOAL_EVENT, data: { goalId: 'goal-smart' } },
  ], 'goal-smart'), true)
  assert.equal(continuousGoalOwnedByPlugin(events, 'goal-smart'), false)
  assert.match(CONTINUOUS_WORK_SYSTEM, /unfinished todo/iu)

  const completed = agent({
    header: { agentPreset: 'model-roles' },
    events: [...events, { type: 'todo/write', data: { todos: [
      { content: 'Inspect the module', status: 'completed' },
      { content: 'Fix the boundary', status: 'completed' },
      { content: 'Verify the result', status: 'completed' },
    ] } }],
    messages: active.session.deriveMessages(),
  })
  const stale = agent({
    header: { agentPreset: 'model-roles' },
    events: [...events, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'turn/start', data: { turn: 2 } }],
    messages: active.session.deriveMessages(),
  })
  assert.equal(continuousGoalRequest(completed, 1, { enabled: true, maxGoalRounds: 24 }), undefined)
  assert.equal(continuousGoalRequest(stale, 2, { enabled: true, maxGoalRounds: 24 }), undefined)
  assert.equal(continuousGoalRequest(agent({
    header: { agentPreset: 'standard' }, events, messages: active.session.deriveMessages(),
  }), 1, { enabled: true, maxGoalRounds: 24 }), undefined)
  assert.equal(continuousGoalRequest(agent({
    header: { agentPreset: 'model-roles', origin: 'subagent' }, events,
    messages: active.session.deriveMessages(),
  }), 1, { enabled: true, maxGoalRounds: 24 }), undefined)
  assert.equal(continuousGoalRequest(active, 1, { enabled: false, maxGoalRounds: 24 }), undefined)
})

test('successful advisor commands fold a session override over settings', () => {
  const advisorCommand = (commandId, input, kind = 'success') => [
    { type: 'command/run', data: { commandId, name: 'advisor', args: input } },
    { type: 'command/done', data: { commandId, kind } },
  ]
  assert.equal(advisorEnabledOf(advisorCommand('1', 'on'), false), true)
  assert.equal(advisorEnabledOf([
    ...advisorCommand('1', 'off'),
    ...advisorCommand('2', 'on', 'error'),
  ], true), false)
  assert.equal(advisorEnabledOf(advisorCommand('1', ''), false), true)
  assert.equal(advisorEnabledOf(advisorCommand('1', 'status'), true), true)
})

test('role routing is opt-in and precedence is internal runtime, plan, task, then default', () => {
  assert.equal(roleForAgent(agent({
    options: { modelRole: 'advisor' },
    messages: [{ role: 'user', content: [{ type: 'image' }] }],
    events: [{ type: 'plan/mode', data: { active: true } }],
    header: { agentPreset: 'model-roles' },
  }), table), 'advisor')
  assert.equal(roleForAgent(agent({
    messages: [{ role: 'user', content: [{ type: 'image' }] }],
    events: [{ type: 'plan/mode', data: { active: true } }],
    header: { origin: 'subagent', agentPreset: 'model-roles' },
  }), table), 'plan')
  assert.equal(roleForAgent(agent({
    events: [{ type: 'plan/mode', data: { active: true } }],
    header: { origin: 'subagent', agentPreset: 'model-roles' },
  }), table), 'plan')
  assert.equal(roleForAgent(agent({
    header: { origin: 'subagent', agentPreset: 'model-roles' },
  }), table), 'task')
  assert.equal(roleForAgent(agent({
    options: { modelRole: 'advisor' },
    events: [{ type: 'plan/mode', data: { active: true } }],
    header: { parentSession: 'parent', agentPreset: 'standard' },
  }), table), 'default')
  assert.equal(roleForAgent(agent(), table), 'default')
})

test('unconfigured roles preserve the session route and tiny can inherit smol', () => {
  const legacyDefault = new Map([['default', { provider: 'legacy', model: 'forced' }]])
  assert.equal(routeForRole(legacyDefault, 'default'), undefined)
  assert.equal(routeForRole(legacyDefault, 'plan'), undefined)
  assert.deepEqual(routeForRole(table, 'tiny'), table.get('smol'))
  assert.deepEqual(routeForRole(table, 'task'), table.get('task'))
  assert.equal(routeForRole(new Map(), 'plan'), undefined)
  const original = Object.freeze({ provider: 'native', model: 'current', reasoningEffort: 'high' })
  assert.equal(applyRoleRoute(original, undefined), original)
})

test('routing replaces provider/model/effort while preserving other request controls', () => {
  const current = {
    provider: 'native', model: 'current', reasoningEffort: 'ultra',
    maxTokens: 12000, temperature: 0.2, stop: ['END'],
  }
  assert.deepEqual(routeAgentRequest(agent({
    events: [{ type: 'plan/mode', data: { active: true } }],
    header: { agentPreset: 'model-roles' },
  }), current, table), {
    role: 'plan',
    route: { provider: 'proxy', model: 'reasoner', reasoningEffort: 'high' },
    config: {
      provider: 'proxy', model: 'reasoner', reasoningEffort: 'high',
      maxTokens: 12000, temperature: 0.2, stop: ['END'],
    },
  })
  assert.deepEqual(applyRoleRoute(current, table.get('designer')), {
    provider: 'vision', model: 'canvas', maxTokens: 12000, temperature: 0.2, stop: ['END'],
  })
})
