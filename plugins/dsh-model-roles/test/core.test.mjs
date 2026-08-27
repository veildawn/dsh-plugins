import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_ROLES,
  CONFIGURABLE_ROLES,
  MODEL_ROLES_PRESET,
  OMP_ROLES,
  STANDARD_PRESETS,
  advisorEnabledOf,
  agentHasImage,
  applyRoleRoute,
  contentHasImage,
  isModelRolesActive,
  normalizeRoleId,
  parseAutomaticRole,
  planModeActive,
  resolveRoleTable,
  roleForAgent,
  routeAgentRequest,
  routeForRole,
  taskTextOf,
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
  assert.deepEqual(OMP_ROLES, [
    'default', 'smol', 'slow', 'vision', 'plan', 'designer', 'commit', 'tiny', 'task', 'advisor',
  ])
  assert.deepEqual(BUILTIN_ROLES, OMP_ROLES)
  assert.deepEqual(CONFIGURABLE_ROLES, [
    'smol', 'slow', 'vision', 'plan', 'designer', 'commit', 'tiny', 'task', 'advisor',
  ])
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

test('role precedence is internal runtime, plan, preset, task, then default', () => {
  assert.equal(roleForAgent(agent({
    options: { modelRole: 'advisor' },
    messages: [{ role: 'user', content: [{ type: 'image' }] }],
    events: [{ type: 'plan/mode', data: { active: true } }],
  }), table), 'advisor')
  assert.equal(roleForAgent(agent({
    messages: [{ role: 'user', content: [{ type: 'image' }] }],
    events: [{ type: 'plan/mode', data: { active: true } }],
    header: { origin: 'subagent', agentPreset: 'designer' },
  }), table), 'plan')
  assert.equal(roleForAgent(agent({
    events: [{ type: 'plan/mode', data: { active: true } }],
    header: { origin: 'subagent', agentPreset: 'designer' },
  }), table), 'plan')
  assert.equal(roleForAgent(agent({
    header: { origin: 'subagent', agentPreset: 'standard' }, livePreset: 'designer',
  }), table), 'designer')
  assert.equal(roleForAgent(agent({ header: { parentSession: 'parent' } }), table), 'task')
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

test('isModelRolesActive activates only for model-roles preset, internal runtime roles, or custom role presets', () => {
  assert.equal(isModelRolesActive(agent({ options: { modelRole: 'vision' } }), table), true)
  assert.equal(isModelRolesActive(agent({ options: { modelRole: 'advisor' } }), table), true)

  assert.equal(isModelRolesActive(agent({ livePreset: 'model-roles' }), table), true)
  assert.equal(isModelRolesActive(agent({ header: { agentPreset: 'model-roles' } }), table), true)

  for (const std of STANDARD_PRESETS) {
    assert.equal(isModelRolesActive(agent({ livePreset: std }), table), false)
    assert.equal(isModelRolesActive(agent({ header: { agentPreset: std } }), table), false)
  }

  assert.equal(isModelRolesActive(agent({ livePreset: 'designer' }), table), true)
  assert.equal(isModelRolesActive(agent({ header: { agentPreset: 'designer' } }), table), true)

  // A roster that exists but reports no composed preset stays inactive.
  const noPresetRoster = {
    options: {},
    session: { events: [], header: {} },
    ctx: {
      get(name) {
        if (name === 'agentPresets') return { composedPreset: () => undefined }
        return undefined
      },
    },
  }
  assert.equal(isModelRolesActive(noPresetRoster, table), false)

  // No agentPresets service at all: also inactive, matching the 智选模式-only contract.
  assert.equal(isModelRolesActive(agent(), table), false)
})

