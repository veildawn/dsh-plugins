/**
 * Dependency-free model-role routing policy.
 *
 * Keeping this module free of Harness imports makes the precedence and
 * fallback rules easy to test, while lib/index.js owns the Cordis/settings
 * wiring.
 */

/** OMP's built-in model-role vocabulary, in its configuration UI order. */
export const OMP_ROLES = Object.freeze([
  'default',
  'smol',
  'slow',
  'vision',
  'plan',
  'designer',
  'commit',
  'tiny',
  'task',
  'advisor',
])

export const BUILTIN_ROLES = OMP_ROLES
const BUILTIN_ROLE_SET = new Set(BUILTIN_ROLES)
export const CONFIGURABLE_ROLES = Object.freeze(OMP_ROLES.filter((role) => role !== 'default'))
export const ROLE_ID_PATTERN = /^[a-z][a-z0-9_-]*$/u
export const ADVISOR_COMMAND = 'advisor'
export const AUTOMATIC_TASK_ROLES = Object.freeze([
  'default',
  'smol',
  'slow',
  'designer',
  'commit',
])
const AUTOMATIC_TASK_ROLE_SET = new Set(AUTOMATIC_TASK_ROLES)

/** Normalize and validate one role id. */
export function normalizeRoleId(value) {
  const role = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!ROLE_ID_PATTERN.test(role)) {
    throw new Error(`model role "${String(value)}" must match ${String(ROLE_ID_PATTERN)}`)
  }
  return role
}

/**
 * Validate settings rows and build an immutable lookup table. The `default`
 * role is deliberately ignored so legacy settings cannot override the model
 * selected for the current DSH session.
 *
 * A missing reasoningEffort means "use this model's provider/default effort".
 */
export function resolveRoleTable(config = {}) {
  const rows = config.roles ?? []
  if (!Array.isArray(rows)) throw new Error('model-roles: roles must be an array')
  const table = new Map()
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('model-roles: every role entry must be an object')
    }
    const role = normalizeRoleId(row.role)
    if (role === 'default') continue
    if (table.has(role)) throw new Error(`model-roles: duplicate role "${role}"`)
    const provider = typeof row.provider === 'string' ? row.provider.trim() : ''
    const model = typeof row.model === 'string' ? row.model.trim() : ''
    if (!provider || !model) {
      throw new Error(`model-roles: role "${role}" needs non-empty provider and model values`)
    }
    const effort = typeof row.reasoningEffort === 'string' ? row.reasoningEffort.trim() : ''
    table.set(role, Object.freeze({
      provider,
      model,
      ...(effort ? { reasoningEffort: effort } : {}),
    }))
  }
  return table
}

/** Fold the public dsh-plan-mode log contract without requiring that plugin. */
export function planModeActive(events = []) {
  let active = false
  for (const event of events) {
    if (event?.type === 'plan/mode' && typeof event.data?.active === 'boolean') {
      active = event.data.active
    }
  }
  return active
}

/** Recursively detect image blocks, including images nested in tool results. */
export function contentHasImage(content = []) {
  if (!Array.isArray(content)) return false
  for (const block of content) {
    if (block?.type === 'image') return true
    if (block?.type === 'tool-result' && contentHasImage(block.content)) return true
  }
  return false
}

/** Collect image blocks without forwarding their surrounding tool-result envelope. */
export function imageBlocksOf(content = []) {
  if (!Array.isArray(content)) return []
  const images = []
  for (const block of content) {
    if (block?.type === 'image') images.push(block)
    if (block?.type === 'tool-result') images.push(...imageBlocksOf(block.content))
  }
  return images
}

/** Remove image bytes/references before delegated input reaches the parent model. */
export function withoutImageBlocks(content = []) {
  if (!Array.isArray(content)) return []
  return content.flatMap((block) => {
    if (block?.type === 'image') return []
    if (block?.type === 'tool-result' && Array.isArray(block.content)) {
      return [{ ...block, content: withoutImageBlocks(block.content) }]
    }
    return [block]
  })
}

/** Whether the current durable model-visible conversation contains an image. */
export function agentHasImage(agent) {
  try {
    const messages = agent?.session?.deriveMessages?.()
    if (Array.isArray(messages)) {
      return messages.some((message) => contentHasImage(message?.content))
    }
  } catch {
    // Fall through to the raw log for test doubles and partial deployments.
  }
  for (const event of agent?.session?.events ?? []) {
    if (event?.type === 'user/message' && contentHasImage(event.data?.content)) return true
    if (event?.type === 'assistant/message' && contentHasImage(event.data?.message?.content)) return true
    if (event?.type === 'tool/result' && contentHasImage(event.data?.message?.content)) return true
  }
  return false
}

const CONTINUATION_TASKS = new Set([
  '继续', '请继续', '继续吧', '继续做', '继续处理', '继续完成', '继续执行', '继续修复',
  '接着', '请接着', '接着吧', '接着做', '接着处理', '接着完成', '往下做',
  '继续之前的任务', '继续上次的任务', '接着之前的任务', '接着上次的任务',
  'continue', 'please continue', 'continue please', 'continue the task',
  'go on', 'please go on', 'keep going', 'carry on',
  'resume', 'please resume', 'resume the task', 'resume the previous task',
  'proceed', 'please proceed',
])

/** Whether a human message only asks to resume the preceding task. */
export function isContinuationTask(value) {
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
    .replace(/[。.!！?？…]+$/gu, '')
    .trim()
  return CONTINUATION_TASKS.has(normalized)
}

/** Latest substantive user-authored text used by the automatic role router. */
export function taskTextOf(agent) {
  let messages
  try {
    messages = agent?.session?.deriveMessages?.()
  } catch {
    messages = undefined
  }
  if (!Array.isArray(messages)) {
    messages = (agent?.session?.events ?? [])
      .filter((event) => event?.type === 'user/message')
      .map((event) => ({
        role: 'user',
        content: event.data?.content,
        source: event.data?.source,
      }))
  }
  const hasHumanSource = messages.some((message) => message?.source?.kind === 'user')
  let continuation = ''
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role !== 'user' || !Array.isArray(message.content)) continue
    if (hasHumanSource && message.source?.kind !== 'user') continue
    const text = message.content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
      .trim()
    if (text === '') continue
    if (isContinuationTask(text)) {
      continuation ||= text
      continue
    }
    return text
  }
  return continuation
}

/** Accept only one exact, classifier-owned main-task role token. */
export function parseAutomaticRole(value) {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/^`+|`+$/gu, '').trim()
    : ''
  return AUTOMATIC_TASK_ROLE_SET.has(normalized) ? normalized : undefined
}

/** Fold the session-scoped `/advisor` override over the configured default. */
export function advisorEnabledOf(events = [], configured = false) {
  const pending = new Map()
  let enabled = configured
  for (const event of events) {
    if (event?.type === 'command/run' && event.data?.name === ADVISOR_COMMAND) {
      pending.set(event.data.commandId, event.data.args)
      continue
    }
    if (event?.type !== 'command/done') continue
    const input = pending.get(event.data?.commandId)
    pending.delete(event.data?.commandId)
    if (event.data?.kind !== 'success' || typeof input !== 'string') continue
    switch (input.trim().toLowerCase()) {
      case '': enabled = !enabled; break
      case 'on': enabled = true; break
      case 'off': enabled = false; break
      default: break
    }
  }
  return enabled
}

/** Whether the durable session header identifies an in-process subagent. */
export function isSubagent(agent) {
  const header = agent?.session?.header ?? {}
  return header.origin === 'subagent'
    || header.parentSession !== undefined
    || (Number.isSafeInteger(header.delegationDepth) && header.delegationDepth > 0)
    || (Number.isSafeInteger(agent?.options?.subagentDepth) && agent.options.subagentDepth > 0)
}

/** Resolve the live preset id, falling back to the creation header. */
export function presetOf(agent) {
  try {
    const roster = agent?.ctx?.get?.('agentPresets')
    const live = roster?.composedPreset?.(agent.ctx)
    if (typeof live === 'string' && live.trim()) return live.trim().toLowerCase()
  } catch {
    // An optional service lookup must never make model routing fail.
  }
  const recorded = agent?.session?.header?.agentPreset
  return typeof recorded === 'string' && recorded.trim()
    ? recorded.trim().toLowerCase()
    : undefined
}

/** Whether a role can be selected even before it has a dedicated route. */
export function isSelectableRole(role, table) {
  return BUILTIN_ROLE_SET.has(role) || table.has(role)
}

/**
 * Select the requested role for one conversation request.
 *
 * Plan mode wins over an exact preset, delegated task work, and the
 * automatically classified main task. Image work is delegated before this
 * boundary to a one-shot subagent whose explicit runtime role is `vision`.
 */
export function roleForAgent(agent, table) {
  const runtimeRole = typeof agent?.options?.modelRole === 'string'
    ? agent.options.modelRole.trim().toLowerCase()
    : undefined
  if (runtimeRole !== undefined && isSelectableRole(runtimeRole, table)) return runtimeRole
  if (planModeActive(agent?.session?.events)) return 'plan'
  const preset = presetOf(agent)
  if (preset !== undefined && isSelectableRole(preset, table)) return preset
  if (isSubagent(agent)) return 'task'
  return 'default'
}

/**
 * Resolve the selected role. `tiny` inherits `smol`; an unconfigured role
 * returns no override so the current session's selected model is preserved.
 */
export function routeForRole(table, role) {
  if (role === 'default') return undefined
  const direct = table.get(role)
  if (direct !== undefined) return direct
  if (role === 'tiny') return table.get('smol')
  return undefined
}

/** Apply one role route while retaining non-route request controls. */
export function applyRoleRoute(config, route) {
  if (route === undefined) return config
  const { reasoningEffort: _previousEffort, ...rest } = config
  return {
    ...rest,
    provider: route.provider,
    model: route.model,
    ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
  }
}

/** Full pure decision used by the Host waterfall listener. */
export function routeAgentRequest(agent, config, table) {
  const role = roleForAgent(agent, table)
  const route = routeForRole(table, role)
  return { role, route, config: applyRoleRoute(config, route) }
}
