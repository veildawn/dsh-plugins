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
export const MODEL_ROLES_PRESET = 'model-roles'
export const MODEL_ROLES_PRESET_NAME = '智选模式'
/** Copy shown next to the preset in the picker; mirrors the shipped standard mode. */
export const MODEL_ROLES_PRESET_DESCRIPTION = '功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。'
/** Roster position, after the shipped standard/ptc/minimal/cordis declarations. */
export const MODEL_ROLES_PRESET_ORDER = 5
/** The shipped preset declaration this plugin clones. */
export const AGENT_PRESET_PLUGIN = '@deepseek-ai/dsh-agent-preset'
/**
 * Preset ids the host itself ships, across generations: `code` was the shipped
 * PTC mode id before 0.1.7 renamed it to `ptc`. Sessions on any of these keep
 * their native routing; only `model-roles` (智选模式) activates role routing.
 */
export const STANDARD_PRESETS = Object.freeze(new Set([
  'standard',
  'code',
  'ptc',
  'minimal',
  'cordis',
]))
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

/**
 * 判断两个模型配置是否等价（provider、model 及 reasoningEffort）。
 *
 * 思考等级只在一方显式给出、另一方留空时视为「继承」，按等价处理：宿主
 * `AgentModel.select()` 对同一 provider/model 会沿用已有的思考等级，空值意味着
 * 「不改变」。若把这种情形判为不等，插件会在每个回合都把同一条选择重写一遍。
 */
export function sameModelSelection(left, right) {
  if (left === right) return true
  if (!left || !right) return false
  if (left.provider !== right.provider || left.model !== right.model) return false
  const leftEffort = left.reasoningEffort ?? ''
  const rightEffort = right.reasoningEffort ?? ''
  if (leftEffort === '' || rightEffort === '') return true
  return String(leftEffort) === String(rightEffort)
}

export function toRouteConfig(entry) {
  if (!entry?.provider || !entry?.model) return undefined
  return {
    provider: entry.provider,
    model: entry.model,
    ...(entry.reasoningEffort !== undefined && entry.reasoningEffort !== null && entry.reasoningEffort !== ''
      ? { reasoningEffort: String(entry.reasoningEffort) }
      : {}),
  }
}

/** 选择在确认集合中的键：provider/model。 */
export function selectionKey(selection) {
  const route = toRouteConfig(selection)
  return route === undefined ? '' : `${route.provider}/${route.model}`
}

/**
 * 解析会话当前生效的基准选择模型（用户手动指定的首选模型和思考等级）。
 *
 * 防污染的关键是「先取最干净的事实，再让用户的后续改选覆盖它」：
 * 1. 会话最初的 'initial' 请求头——宿主在第一条请求时写入，插件此时尚未路由，
 *    因此它一定是用户当时的真实选择。绝不取路由后的 'change' 请求头。
 * 2. 如果之后用户在会话中又手动改选了模型，则以其最近一次手动选择覆盖第 1 步。
 *    这里必须排除插件自身的写入：`_restoredByModelRoles` 标记的选择、以及键在
 *    `pluginSelections` 中的记录。注意 'restored' 与 '改写回用户模型' 是两回事，
 *    后者会带上用户所选模型的 provider/model，因此不会被误排除。
 * 3. 当前 session requestHeader（仅当未经过路由修改或明确标记为 initial）
 * 4. 全局 defaultModel
 * 5. agent 启动 options
 * 6. 之前还原过的选择兜底
 *
 * 历史教训：早期版本把「倒序扫描 model/selection」放在最前，插件写入又按
 * `provider/model` 键排除。同一角色模型跨回合反复写入时，残留记录无法与用户
 * 选择区分，一旦命中就直接返回，永远走不到 initial 请求头，基准被固化成角色模型
 * （用户选 A、路由到 B 之后，回合结束总把模型"还原"成 B）。
 *
 * @param {object} agent - 会话 agent
 * @param {object} [defaultModel] - 全局默认模型
 * @param {Set<string>|string[]} [pluginSelections] - 插件自身写入过的选择，形如 `provider/model`；
 *   这些记录按插件自身写入处理
 */
export function resolveBaselineModel(agent, defaultModel, pluginSelections) {
  const events = agent?.session?.events ?? []
  const written = pluginSelections instanceof Set ? pluginSelections : new Set(pluginSelections ?? [])

  // 1. 用户最初的显式选择：第一条请求头（此时尚未发生任何角色路由）
  let initialSelection
  for (const event of events) {
    if (event?.type !== 'request/header' || event.data?.reason !== 'initial') continue
    initialSelection = toRouteConfig(event.data.header?.config)
    break
  }

  // 2. 用户在会话中途手动改选过的模型，后来者优先（排除插件自身写入）
  let userOverride
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'model/selection') continue
    if (event.data?._restoredByModelRoles) continue
    const match = toRouteConfig(event.data)
    if (!match) continue
    if (written.has(selectionKey(match))) continue
    userOverride = match
    break
  }

  if (userOverride !== undefined && initialSelection !== undefined) {
    return sameModelSelection(userOverride, initialSelection) ? initialSelection : userOverride
  }
  if (userOverride !== undefined) return userOverride
  if (initialSelection !== undefined) return initialSelection

  // 3. 检查当前 session requestHeader（若没有任何修改记录或为 initial 状态）
  const directHeader = agent?.session?.requestHeader?.()
  if (directHeader && (!directHeader.reason || directHeader.reason === 'initial')) {
    const match = toRouteConfig(directHeader.config ?? directHeader)
    if (match) return match
  }

  // 4. 优先匹配系统/用户设定的全局 defaultModel
  const defaultMatch = toRouteConfig(defaultModel)
  if (defaultMatch) {
    return defaultMatch
  }

  // 5. 匹配 agent 显式启动 options
  const optionMatch = toRouteConfig(agent?.options)
  if (optionMatch) {
    return optionMatch
  }

  // 6. 若之前有还原过的有效配置，则采用（历史还原记录里最近的一次）
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'model/selection' || !event.data?._restoredByModelRoles) continue
    const match = toRouteConfig(event.data)
    if (match) return match
  }

  return undefined
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
  for (let index = (agent?.session?.events?.length ?? 0) - 1; index >= 0; index -= 1) {
    const event = agent.session.events[index]
    if (event?.type === 'agent-preset/selected' && typeof event.data?.agentPreset === 'string') {
      return event.data.agentPreset.trim().toLowerCase()
    }
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
 * Whether the agent runs in model-roles (智选模式).
 *
 * STRICT contract: the model-roles router activates ONLY when the session was
 * created with the `model-roles` Agent Preset. Agent presets are nothing
 * more than a priority-ordered option list provided at session-creation time;
 * a preset that merely *names* a configured role (e.g. `designer`) does NOT
 * activate the router. A runtime `modelRole` option never activates routing
 * on its own — vision/advisor subagents inherit the parent's preset through
 * `childSessionMeta`, so only children of a 智选模式 session route by
 * `modelRole`. Standard DSH presets and unpreseted sessions are always
 * passive, no matter what options they carry.
 */
export function isModelRolesActive(agent, table) {
  return presetOf(agent) === MODEL_ROLES_PRESET
}

/**
 * Permitted wider targets for each sandbox mode in DSH.
 * 'danger-full-access' is the ceiling and cannot be escalated.
 */
export const SANDBOX_WIDER_MODES = Object.freeze({
  'read-only': Object.freeze(['workspace-write', 'danger-full-access']),
  'workspace-write': Object.freeze(['danger-full-access']),
  'danger-full-access': Object.freeze([]),
})

/**
 * 按当前会话沙箱权限动态收窄工具 Schema。
 * 在已达到最高权限（danger-full-access）时完全移除提权字段，避免诱导模型误传参数；
 * 在中间档位（workspace-write）时只保留严格更宽的枚举值。
 */
export function sanitizeToolSchema(tool, currentMode) {
  const params = tool?.parameters
  const properties = params?.properties
  if (!properties || !Object.hasOwn(properties, 'sandbox_permissions')) return tool
  const wider = SANDBOX_WIDER_MODES[currentMode]
  if (wider === undefined) return tool
  if (wider.length === 0) return withoutEscalationFields(tool)
  const declared = properties.sandbox_permissions?.enum
  const nextEnum = Array.isArray(declared) ? declared.filter((mode) => wider.includes(mode)) : [...wider]
  if (Array.isArray(declared) && nextEnum.length === declared.length && nextEnum.every((mode, index) => mode === declared[index])) {
    return tool
  }
  return {
    ...tool,
    parameters: {
      ...params,
      properties: {
        ...properties,
        sandbox_permissions: { ...properties.sandbox_permissions, enum: nextEnum },
      },
    },
  }
}

function withoutEscalationFields(tool) {
  const { sandbox_permissions, justification, ...properties } = tool.parameters.properties
  const required = Array.isArray(tool.parameters.required)
    ? tool.parameters.required.filter((key) => key !== 'sandbox_permissions' && key !== 'justification')
    : tool.parameters.required
  return {
    ...tool,
    parameters: {
      ...tool.parameters,
      properties,
      ...(required === undefined ? {} : { required }),
    },
  }
}

/**
 * Sanitize tool arguments for sandbox-aware tools (write, edit, bash, pwsh).
 *
 * When an LLM (notably GPT models) defensively supplies sandbox_permissions
 * in an environment that is already fully privileged ('danger-full-access')
 * or when the requested mode is not strictly wider than the call's effective mode,
 * DSH throws "sandbox escalation to ... is not strictly wider than this call's current ... mode".
 *
 * This pure function strips unneeded/invalid escalation arguments so the operation
 * runs as a normal execution without crashing on strictly-wider assertions.
 * If escalation is valid and required but justification is empty, it derives a clear non-empty reason.
 */
export function sanitizeSandboxToolArgs(toolName, args, effectiveMode = 'workspace-write') {
  if (!args || typeof args !== 'object') return args
  const requestedMode = typeof args.sandbox_permissions === 'string'
    ? args.sandbox_permissions.trim()
    : undefined

  if (!requestedMode) return args

  const allowedWider = SANDBOX_WIDER_MODES[effectiveMode] ?? []

  // If the requested mode is not strictly wider than the current effective mode
  // (e.g. effectiveMode is already 'danger-full-access', or requestedMode == effectiveMode),
  // strip sandbox_permissions and justification to prevent "not strictly wider" errors.
  if (!allowedWider.includes(requestedMode)) {
    const { sandbox_permissions: _, justification: __, ...sanitized } = args
    return sanitized
  }

  // If escalation is legitimate but justification is empty, fill a clear sentence
  // so the host approval service can show the prompt without throwing validation errors.
  const justification = typeof args.justification === 'string' ? args.justification.trim() : ''
  if (justification === '') {
    const desc = typeof args.description === 'string' && args.description.trim()
      ? args.description.trim().replace(/[.!。！]+$/gu, '')
      : `the requested ${toolName} operation`
    return {
      ...args,
      justification: `Smart Mode requests ${requestedMode} access for: ${desc}.`,
    }
  }

  return args
}

/**
 * Select the requested role for one conversation request.
 *
 * Called only while the 智选模式 router is active. Internal runtime roles
 * (`modelRole` on vision/advisor subagents) win; then plan mode; then
 * delegated task work; then the automatically classified main task. An agent
 * preset NEVER routes by name — presets are merely the option list offered at
 * session creation, and only the `model-roles` preset activates this router.
 */
export function roleForAgent(agent, table) {
  const runtimeRole = typeof agent?.options?.modelRole === 'string'
    ? agent.options.modelRole.trim().toLowerCase()
    : undefined
  if (runtimeRole !== undefined && isSelectableRole(runtimeRole, table)) return runtimeRole
  if (planModeActive(agent?.session?.events)) return 'plan'
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
