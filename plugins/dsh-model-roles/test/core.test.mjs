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
  sanitizeSandboxToolArgs,
  sanitizeToolSchema,
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

test('role precedence is internal runtime, plan, task, then default (no preset-name routing)', () => {
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
  // An agent preset never routes by name; it is only a creation-time option.
  assert.equal(roleForAgent(agent({
    header: { origin: 'subagent', agentPreset: 'standard' }, livePreset: 'designer',
  }), table), 'task')
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
  // A runtime modelRole alone never activates routing without the 智选模式 preset.
  assert.equal(isModelRolesActive(agent({ options: { modelRole: 'vision' } }), table), false)
  assert.equal(isModelRolesActive(agent({ options: { modelRole: 'advisor' } }), table), false)

  // modelRole under a standard preset stays inactive; under 智选模式 it is active.
  assert.equal(isModelRolesActive(agent({ options: { modelRole: 'vision' }, livePreset: 'standard' }), table), false)
  assert.equal(isModelRolesActive(agent({ options: { modelRole: 'vision' }, livePreset: 'model-roles' }), table), true)

  assert.equal(isModelRolesActive(agent({ livePreset: 'model-roles' }), table), true)
  assert.equal(isModelRolesActive(agent({ header: { agentPreset: 'model-roles' } }), table), true)

  for (const std of STANDARD_PRESETS) {
    assert.equal(isModelRolesActive(agent({ livePreset: std }), table), false)
    assert.equal(isModelRolesActive(agent({ header: { agentPreset: std } }), table), false)
  }

  // A preset that merely names a configured role does NOT activate 智选模式:
  // presets are only the session-creation option list, not a routing trigger.
  assert.equal(isModelRolesActive(agent({ livePreset: 'designer' }), table), false)
  assert.equal(isModelRolesActive(agent({ header: { agentPreset: 'designer' } }), table), false)

  // Switched presets via agent-preset/selected event:
  // 1. Initial header was 'code', but switched to 'model-roles' -> active
  assert.equal(isModelRolesActive(agent({
    header: { agentPreset: 'code' },
    events: [{ type: 'agent-preset/selected', data: { agentPreset: 'model-roles' } }],
  }), table), true)

  // 2. Initial header was 'model-roles', but switched to 'standard' -> inactive
  assert.equal(isModelRolesActive(agent({
    header: { agentPreset: 'model-roles' },
    events: [{ type: 'agent-preset/selected', data: { agentPreset: 'standard' } }],
  }), table), false)

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

test('sanitizeSandboxToolArgs removes non-strictly-wider escalation and heals blank justification', () => {
  // Case 1: current mode is danger-full-access, GPT defensively passed danger-full-access
  const gptArgsInDanger = {
    file_path: 'foo.txt',
    content: 'bar',
    sandbox_permissions: 'danger-full-access',
    justification: 'write config',
  }
  assert.deepEqual(
    sanitizeSandboxToolArgs('write', gptArgsInDanger, 'danger-full-access'),
    { file_path: 'foo.txt', content: 'bar' },
    'must strip escalation arguments when already in danger-full-access to avoid strictly-wider crashes',
  )

  // Case 2: current mode is workspace-write, GPT passed workspace-write (same mode)
  const gptArgsInWorkspace = {
    command: 'git status',
    sandbox_permissions: 'workspace-write',
    justification: 'check git',
  }
  assert.deepEqual(
    sanitizeSandboxToolArgs('bash', gptArgsInWorkspace, 'workspace-write'),
    { command: 'git status' },
    'must strip escalation arguments when requestedMode equals effectiveMode',
  )

  // Case 3: legitimate escalation from workspace-write to danger-full-access with justification
  const validEscalation = {
    command: 'apt-get update',
    sandbox_permissions: 'danger-full-access',
    justification: 'install dependency',
  }
  assert.deepEqual(
    sanitizeSandboxToolArgs('bash', validEscalation, 'workspace-write'),
    validEscalation,
    'must keep legitimate escalation arguments intact',
  )

  // Case 4: legitimate escalation but justification is empty
  const blankJustification = {
    command: 'apt-get update',
    description: 'Update packages',
    sandbox_permissions: 'danger-full-access',
    justification: '   ',
  }
  const healed = sanitizeSandboxToolArgs('bash', blankJustification, 'workspace-write')
  assert.equal(healed.sandbox_permissions, 'danger-full-access')
  assert.match(healed.justification, /Update packages/)
  assert.match(healed.justification, /Smart Mode requests danger-full-access access/)

  // Case 5: non-object or missing sandbox_permissions passes through unchanged
  assert.deepEqual(sanitizeSandboxToolArgs('write', { file_path: 'a.txt' }, 'danger-full-access'), { file_path: 'a.txt' })
  assert.equal(sanitizeSandboxToolArgs('write', null), null)
})

test('sanitizeToolSchema hides impossible escalation and keeps a real wider rung', () => {
  const tool = {
    name: 'pwsh',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        sandbox_permissions: { type: 'string', enum: ['workspace-write', 'danger-full-access'] },
        justification: { type: 'string' },
      },
      required: ['command', 'sandbox_permissions'],
    },
  }

  const full = sanitizeToolSchema(tool, 'danger-full-access')
  assert.equal('sandbox_permissions' in full.parameters.properties, false)
  assert.equal('justification' in full.parameters.properties, false)
  assert.deepEqual(full.parameters.required, ['command'])

  const write = sanitizeToolSchema(tool, 'workspace-write')
  assert.deepEqual(write.parameters.properties.sandbox_permissions.enum, ['danger-full-access'])
  assert.equal(sanitizeToolSchema(tool, 'read-only'), tool)
})

test('resolveBaselineModel resolves active baseline from events, header, options, or default', async () => {
  const { resolveBaselineModel, sameModelSelection } = await import('../lib/core.js')

  // Case 1: from model/selection event
  const agentWithEvent = {
    session: {
      events: [
        { type: 'model/selection', data: { provider: 'anthropic', model: 'claude-3-7-sonnet', reasoningEffort: 'high' } },
      ],
      requestHeader: () => ({ config: { provider: 'openai', model: 'gpt-4o' } }),
    },
    options: { provider: 'ollama', model: 'llama3' },
  }
  assert.deepEqual(resolveBaselineModel(agentWithEvent), {
    provider: 'anthropic',
    model: 'claude-3-7-sonnet',
    reasoningEffort: 'high',
  })

  // Case 2: from requestHeader
  const agentWithHeader = {
    session: {
      events: [],
      requestHeader: () => ({ config: { provider: 'openai', model: 'gpt-4o', reasoningEffort: 'medium' } }),
    },
    options: { provider: 'ollama', model: 'llama3' },
  }
  assert.deepEqual(resolveBaselineModel(agentWithHeader), {
    provider: 'openai',
    model: 'gpt-4o',
    reasoningEffort: 'medium',
  })

  // Case 3: from agent options
  const agentWithOptions = {
    session: { events: [] },
    options: { provider: 'ollama', model: 'llama3' },
  }
  assert.deepEqual(resolveBaselineModel(agentWithOptions), {
    provider: 'ollama',
    model: 'llama3',
  })

  // Case 4: from deployment default
  const emptyAgent = { session: { events: [] } }
  assert.deepEqual(resolveBaselineModel(emptyAgent, { provider: 'deepseek', model: 'deepseek-chat' }), {
    provider: 'deepseek',
    model: 'deepseek-chat',
  })

  // Case 5: ignores _restoredByModelRoles when earlier explicit user selection exists
  const agentWithRestoreHistory = {
    session: {
      events: [
        { type: 'model/selection', data: { provider: 'anthropic', model: 'claude-3-7-sonnet', reasoningEffort: 'high' } },
        { type: 'model/selection', data: { provider: 'e2e', model: 'slow-model', _restoredByModelRoles: true } },
      ],
    },
    options: { provider: 'ollama', model: 'llama3' },
  }
  assert.deepEqual(resolveBaselineModel(agentWithRestoreHistory), {
    provider: 'anthropic',
    model: 'claude-3-7-sonnet',
    reasoningEffort: 'high',
  })

  // sameModelSelection checks
  assert.equal(sameModelSelection({ provider: 'a', model: 'b' }, { provider: 'a', model: 'b' }), true)
  assert.equal(sameModelSelection({ provider: 'a', model: 'b', reasoningEffort: 'low' }, { provider: 'a', model: 'b' }), false)
  assert.equal(sameModelSelection({ provider: 'a', model: 'b' }, { provider: 'a', model: 'c' }), false)
})



