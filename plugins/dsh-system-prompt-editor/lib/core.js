/**
 * 纯函数核心：规则归一化、section 匹配与文本变换。
 *
 * 这个模块**不接触**任何 Cordis 上下文、文件系统或网络，因此全部决策逻辑
 * 都能用普通单元测试覆盖。宿主端（lib/index.js）只负责把 assembly 传进来、
 * 把结果写回去。
 *
 * 设计原则：
 *  1. 单条规则出错绝不抛到调用方——坏规则被标记并跳过，其余规则照常生效。
 *  2. 任何变换都保留原 section 的 `interpolate` 标记，避免破坏 {{var}} 插值。
 *  3. 函数尽量纯：同样的输入必须得到同样的输出，便于预览与实际渲染一致。
 *
 * @module dsh-system-prompt-editor/core
 */

/** 配置命名空间（settings 服务的 namespace 与本地兜底文件共用）。 */
export const NS = 'system-prompt-editor'

/** 自定义 section 名称前缀，避免与官方及其它插件的命名空间冲突。 */
export const CUSTOM_SECTION_PREFIX = 'prompt-editor:custom:'

/**
 * 内置 section 的语义位置锚点。
 *
 * 数值与 `@deepseek-ai/dsh-system-prompt` 的 `SECTION_ORDERS` 保持一致；
 * 这里刻意复制一份而不是运行时读取，因为 `getSectionOrder` 只接受官方枚举名，
 * 而我们需要在这些锚点之间做“+1 / +10”这类微调。
 */
export const ORDER_ANCHORS = Object.freeze({
  HARNESS_IDENTITY: -1000,
  DEPLOYMENT_PERSONA_PREFIX: 0,
  PLAN_POLICY: 500,
  TEAM_POLICY: 600,
  PTC_ONLY: 800,
  FILE_REFERENCE: 900,
  TOOL_BASH: 1000,
  MCP_SERVERS: 3100,
  TOOLS_SDK: 5000,
  DELIVERABLE_FILE_REFERENCES: 9000,
  STRUCTURED_OUTPUT: 9900,
  HARNESS_SOURCE: 10000,
  WEB_SURFACE: 10100,
  DEPLOYMENT_PERSONA_SUFFIX: 10200,
})

/**
 * 语义位置 → 实际 order 的映射。
 *
 * 用户不应该被迫理解 `-1000` 这种内部数字，所以设置页只暴露语义位置；
 * 想精确控制顺序的高级用户仍可直接写 `order`。
 */
export const POSITION_ORDERS = Object.freeze({
  'before-persona': ORDER_ANCHORS.HARNESS_IDENTITY + 1,
  'after-persona': ORDER_ANCHORS.DEPLOYMENT_PERSONA_SUFFIX + 10,
  'before-tools': ORDER_ANCHORS.FILE_REFERENCE - 1,
  'after-tools': ORDER_ANCHORS.MCP_SERVERS + 10,
  end: ORDER_ANCHORS.DEPLOYMENT_PERSONA_SUFFIX + 1000,
})

/** 允许的位置取值，用于配置校验。 */
export const POSITIONS = Object.freeze(Object.keys(POSITION_ORDERS))

/** 允许的匹配方式。 */
export const MATCH_KINDS = Object.freeze(['all', 'name', 'prefix', 'text', 'regex'])

/** 允许的动作。 */
export const ACTION_KINDS = Object.freeze([
  'replaceText',
  'setText',
  'prepend',
  'append',
  'remove',
])

/**
 * 把任意输入安全转成字符串。
 * @param {unknown} value - 任意值。
 * @returns {string} 字符串结果；`null`/`undefined` 变成空串。
 */
export function asText(value) {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : String(value)
}

/**
 * 把任意输入安全转成布尔值，支持 `"false"` / `"0"` 这类字符串形式。
 *
 * 这一点很重要：配置可能来自 JSON（布尔值）也可能来自 YAML 表单（字符串），
 * 如果只做真值判断，`"false"` 会被误认为 true。
 * @param {unknown} value - 任意值。
 * @param {boolean} fallback - 无法判定时的默认值。
 * @returns {boolean} 布尔结果。
 */
export function asBool(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (value === undefined || value === null) return fallback
  if (typeof value === 'number') return value !== 0
  const text = String(value).trim().toLowerCase()
  if (text === 'true' || text === '1' || text === 'yes' || text === 'on') return true
  if (text === 'false' || text === '0' || text === 'no' || text === 'off' || text === '') return false
  return fallback
}

/**
 * 把任意输入安全转成有限数字。
 * @param {unknown} value - 任意值。
 * @param {number|undefined} fallback - 无法判定时的默认值。
 * @returns {number|undefined} 有限数字或默认值。
 */
export function asNumber(value, fallback = undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

/**
 * 归一化匹配选择器。
 *
 * 非法输入不抛错，而是退化为 `{kind: 'all'}` 并附带 `problem`，
 * 让前端能把问题显示出来，同时不至于让整条链路失败。
 * @param {unknown} raw - 原始配置。
 * @returns {{selector: object, problem?: string}} 归一化结果。
 */
export function normalizeMatch(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const kind = asText(value.kind || 'all').trim()

  if (kind === 'all') return { selector: { kind: 'all' } }

  if (kind === 'name') {
    const name = asText(value.name).trim()
    if (name === '') return { selector: { kind: 'all' }, problem: 'match.name 为空，已退化为匹配全部段落' }
    return { selector: { kind: 'name', name } }
  }

  if (kind === 'prefix') {
    const prefix = asText(value.prefix).trim()
    if (prefix === '') return { selector: { kind: 'all' }, problem: 'match.prefix 为空，已退化为匹配全部段落' }
    return { selector: { kind: 'prefix', prefix } }
  }

  if (kind === 'text') {
    const contains = asText(value.contains)
    if (contains === '') return { selector: { kind: 'all' }, problem: 'match.contains 为空，已退化为匹配全部段落' }
    return { selector: { kind: 'text', contains, caseSensitive: asBool(value.caseSensitive, false) } }
  }

  if (kind === 'regex') {
    const pattern = asText(value.pattern)
    if (pattern === '') return { selector: { kind: 'all' }, problem: 'match.pattern 为空，已退化为匹配全部段落' }
    const flags = asText(value.flags || 'i')
    // 提前编译一次，把语法错误在归一化阶段就暴露出来，而不是等到渲染时。
    try {
      // eslint-disable-next-line no-new
      new RegExp(pattern, flags)
    } catch (error) {
      return {
        selector: { kind: 'all' },
        problem: `match.pattern 不是合法正则（${error instanceof Error ? error.message : String(error)}），已退化为匹配全部段落`,
      }
    }
    return { selector: { kind: 'regex', pattern, flags } }
  }

  return { selector: { kind: 'all' }, problem: `未知的 match.kind "${kind}"，已退化为匹配全部段落` }
}

/**
 * 归一化动作。
 * @param {unknown} raw - 原始配置。
 * @returns {{action: object, problem?: string}} 归一化结果；非法动作返回 `action: null`。
 */
export function normalizeAction(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const kind = asText(value.kind).trim()

  if (kind === 'remove') return { action: { kind: 'remove' } }

  if (kind === 'setText') {
    return { action: { kind: 'setText', text: asText(value.text) } }
  }

  if (kind === 'prepend' || kind === 'append') {
    const text = asText(value.text)
    if (text === '') return { action: null, problem: `${kind} 动作的 text 为空` }
    return { action: { kind, text } }
  }

  if (kind === 'replaceText') {
    const find = asText(value.find)
    if (find === '') return { action: null, problem: 'replaceText 动作的 find 为空' }
    return {
      action: {
        kind: 'replaceText',
        find,
        replace: asText(value.replace),
        all: asBool(value.all, true),
      },
    }
  }

  return { action: null, problem: kind === '' ? '缺少 action.kind' : `未知的 action.kind "${kind}"` }
}

/**
 * 归一化一条规则。
 *
 * 返回的 `problem` 只是诊断信息：有问题的规则会被标记 `valid: false`，
 * 由调用方决定是否跳过。这样前端能逐条显示错误，而不是整个配置报废。
 * @param {unknown} raw - 原始规则。
 * @param {number} index - 规则在数组中的下标，用于生成兜底 id。
 * @returns {object} 归一化后的规则。
 */
export function normalizeRule(raw, index = 0) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const problems = []

  const id = asText(value.id).trim() || `rule-${index + 1}`
  const enabled = asBool(value.enabled, true)

  const { selector, problem: matchProblem } = normalizeMatch(value.match)
  if (matchProblem) problems.push(matchProblem)

  const { action, problem: actionProblem } = normalizeAction(value.action)
  if (actionProblem) problems.push(actionProblem)

  const reach = normalizeReach(value.applyTo)

  const valid = action !== null && problems.length === 0

  return {
    id,
    enabled,
    valid,
    match: selector,
    action,
    applyTo: reach.reach,
    ...problems.length > 0 ? { problems } : {},
    ...reach.problem === undefined ? {} : { reachProblem: reach.problem },
  }
}

/**
 * 归一化生效范围。
 * @param {unknown} raw - 原始配置。
 * @returns {{reach: object, problem?: string}} 归一化结果。
 */
export function normalizeReach(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const mode = asText(value.mode || 'all').trim()

  if (mode === 'all' || mode === '') return { reach: { mode: 'all' } }

  if (mode === 'presets' || mode === 'sessions') {
    const list = Array.isArray(value.ids) ? value.ids : []
    const ids = list.map((item) => asText(item).trim()).filter((item) => item !== '')
    if (ids.length === 0) {
      return {
        reach: { mode: 'all' },
        problem: `${mode} 范围没有给出任何 id，已退化为对全部会话生效`,
      }
    }
    return { reach: { mode, ids: [...new Set(ids)] } }
  }

  return { reach: { mode: 'all' }, problem: `未知的 applyTo.mode "${mode}"，已退化为对全部会话生效` }
}

/**
 * 归一化一条自定义段落。
 * @param {unknown} raw - 原始配置。
 * @param {number} index - 下标，用于生成兜底 id 与名称。
 * @returns {object} 归一化后的段落。
 */
export function normalizeSection(raw, index = 0) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const problems = []

  const id = asText(value.id).trim() || `section-${index + 1}`
  const enabled = asBool(value.enabled, true)
  const text = asText(value.text)

  if (text.trim() === '') problems.push('段落内容为空')

  // 用户自定义的 name 只作为展示信息保留，不参与 section 名的生成：
  // 官方 section 名会被用于排序与去重，必须稳定且只含安全字符。
  const label = asText(value.name).trim()
  // 名称用「序号 + id」构成：id 是用户可见的稳定标识，不随增删段落而漂移，
  // 所以删除中间一条不会让后续段落改名（改名会触发 section 卸载重注册）。
  const safeId = id.replace(/[^A-Za-z0-9_.-]+/g, '-') || `section-${index + 1}`
  const name = `${CUSTOM_SECTION_PREFIX}${String(index + 1).padStart(3, '0')}-${safeId}`

  const explicitOrder = asNumber(value.order, undefined)
  const position = asText(value.position || 'after-persona').trim()
  let order
  if (explicitOrder !== undefined) {
    order = explicitOrder
  } else if (Object.hasOwn(POSITION_ORDERS, position)) {
    order = POSITION_ORDERS[position]
  } else {
    problems.push(`未知的 position "${position}"，已改用 after-persona`)
    order = POSITION_ORDERS['after-persona']
  }

  return {
    id,
    enabled,
    valid: problems.length === 0,
    name,
    text,
    order,
    position: explicitOrder === undefined ? position : 'custom',
    ...problems.length > 0 ? { problems } : {},
  }
}

/**
 * 归一化整份配置。
 *
 * 这是配置进入系统的唯一入口：无论来自 settings 服务、本地 JSON 还是前端，
 * 都必须先过这一层。返回的 `diagnostics` 汇总所有问题，供设置页展示。
 * @param {unknown} raw - 原始配置。
 * @returns {object} 归一化后的配置与诊断信息。
 */
export function normalizeConfig(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const diagnostics = []

  const rawRules = Array.isArray(value.rules) ? value.rules : []
  const seenRuleIds = new Set()
  const rules = []
  rawRules.forEach((item, index) => {
    const rule = normalizeRule(item, index)
    if (seenRuleIds.has(rule.id)) {
      diagnostics.push(`规则 id "${rule.id}" 重复，已忽略后出现的那条`)
      return
    }
    seenRuleIds.add(rule.id)
    if (!rule.valid) {
      diagnostics.push(`规则 "${rule.id}" 无效：${(rule.problems || ['未知原因']).join('；')}`)
    }
    rules.push(rule)
  })

  const rawSections = Array.isArray(value.appendSections) ? value.appendSections : []
  const seenSectionIds = new Set()
  const appendSections = []
  rawSections.forEach((item, index) => {
    const section = normalizeSection(item, index)
    if (seenSectionIds.has(section.id)) {
      diagnostics.push(`自定义段落 id "${section.id}" 重复，已忽略后出现的那条`)
      return
    }
    seenSectionIds.add(section.id)
    if (!section.valid) {
      diagnostics.push(`自定义段落 "${section.id}" 无效：${(section.problems || ['未知原因']).join('；')}`)
    }
    appendSections.push(section)
  })

  return {
    enabled: asBool(value.enabled, true),
    rules,
    appendSections,
    diagnostics,
  }
}

/**
 * 判断某条规则在当前上下文中是否生效。
 *
 * `context` 由宿主端构造，字段缺失时按“不限制”处理——宁可多生效，
 * 也不要因为拿不到预设 id 就静默失效（后者更难排查）。
 * @param {object} rule - 归一化后的规则。
 * @param {{presetId?: string|null, sessionId?: string|null}} context - 当前上下文。
 * @returns {boolean} 是否生效。
 */
export function ruleAppliesTo(rule, context = {}) {
  const reach = rule?.applyTo || { mode: 'all' }
  if (reach.mode === 'all') return true

  if (reach.mode === 'presets') {
    const presetId = context.presetId
    // 拿不到预设 id 时放行，并在上层诊断里说明原因。
    if (presetId === undefined || presetId === null) return true
    return reach.ids.includes(presetId)
  }

  if (reach.mode === 'sessions') {
    const sessionId = context.sessionId
    if (sessionId === undefined || sessionId === null) return true
    return reach.ids.includes(sessionId)
  }

  return true
}

/**
 * 判断某个 section 是否被匹配选择器选中。
 * @param {{name: string, text: string}} section - 待判断的段落。
 * @param {object} selector - 归一化后的匹配选择器。
 * @returns {boolean} 是否命中。
 */
export function matchesSection(section, selector) {
  if (!section || typeof section !== 'object') return false
  const name = asText(section.name)
  const text = asText(section.text)
  const kind = selector?.kind || 'all'

  if (kind === 'all') return true
  if (kind === 'name') return name === selector.name
  if (kind === 'prefix') return name.startsWith(selector.prefix)

  if (kind === 'text') {
    const haystack = selector.caseSensitive ? text : text.toLowerCase()
    const needle = selector.caseSensitive ? selector.contains : selector.contains.toLowerCase()
    return haystack.includes(needle)
  }

  if (kind === 'regex') {
    try {
      return new RegExp(selector.pattern, selector.flags || 'i').test(text)
    } catch {
      return false
    }
  }

  return false
}

/**
 * 对一个 section 的文本应用动作。
 *
 * 返回 `{text, removed, changed}`：
 *  - `removed: true` 表示整段应被删除；
 *  - `changed: false` 表示动作没有产生任何修改（用于“未命中”提示）。
 * @param {string} text - 原始文本。
 * @param {object} action - 归一化后的动作。
 * @returns {{text: string, removed: boolean, changed: boolean}} 变换结果。
 */
export function applyActionToText(text, action) {
  const original = asText(text)
  if (!action || typeof action !== 'object') return { text: original, removed: false, changed: false }

  if (action.kind === 'remove') return { text: '', removed: true, changed: true }

  if (action.kind === 'setText') {
    const next = asText(action.text)
    return { text: next, removed: false, changed: next !== original }
  }

  if (action.kind === 'prepend') {
    const next = `${asText(action.text)}${original}`
    return { text: next, removed: false, changed: next !== original }
  }

  if (action.kind === 'append') {
    const next = `${original}${asText(action.text)}`
    return { text: next, removed: false, changed: next !== original }
  }

  if (action.kind === 'replaceText') {
    const find = asText(action.find)
    if (find === '') return { text: original, removed: false, changed: false }

    let next
    if (action.all) {
      // 用 split/join 而不是正则，避免用户输入里的 $1 被当成替换模板。
      next = original.split(find).join(asText(action.replace))
    } else {
      const index = original.indexOf(find)
      next = index < 0
        ? original
        : `${original.slice(0, index)}${asText(action.replace)}${original.slice(index + find.length)}`
    }
    return { text: next, removed: false, changed: next !== original }
  }

  return { text: original, removed: false, changed: false }
}

/**
 * 把规则与自定义段落应用到一份 assembly 上。
 *
 * 纯函数：不修改入参，返回新的 sections 数组和逐条命中统计。
 * 统计信息是设置页“预览”与排障的核心——用户能看到每条规则到底命中了几段。
 * @param {object[]} sections - 当前 assembly 的 sections。
 * @param {object} config - 归一化后的配置。
 * @param {{presetId?: string|null, sessionId?: string|null}} context - 当前上下文。
 * @param {{includeAppended?: boolean}} [options] - `includeAppended: false` 表示只跑规则、
 *   不追加自定义段落。宿主端的 waterfall 必须传 false：自定义段落已经通过
 *   `systemPrompt.section()` 正式注册进了 assembly，这里再追加一次就会重复。
 * @returns {{sections: object[], ruleResults: object[], appliedRules: number}} 结果。
 */
export function applyRules(sections, config, context = {}, options = {}) {
  const input = Array.isArray(sections) ? sections : []
  const normalized = config && typeof config === 'object' ? config : normalizeConfig({})

  // 先做一次浅拷贝，保证后续替换文本时不会改到官方 assembly 里的对象。
  let working = input.map((section) => ({
    name: asText(section?.name),
    text: asText(section?.text),
    ...section?.interpolate === undefined ? {} : { interpolate: section.interpolate },
  }))

  const ruleResults = []
  let appliedRules = 0

  if (normalized.enabled === false) {
    return {
      sections: working,
      ruleResults,
      appliedRules,
      disabled: true,
    }
  }

  for (const rule of normalized.rules || []) {
    if (!rule.enabled || !rule.valid) {
      ruleResults.push({ id: rule.id, status: rule.enabled ? 'invalid' : 'disabled', hits: 0 })
      continue
    }

    if (!ruleAppliesTo(rule, context)) {
      ruleResults.push({ id: rule.id, status: 'out-of-scope', hits: 0 })
      continue
    }

    let hits = 0
    const next = []
    for (const section of working) {
      if (!matchesSection(section, rule.match)) {
        next.push(section)
        continue
      }
      hits += 1
      const outcome = applyActionToText(section.text, rule.action)
      if (outcome.removed) continue
      next.push({
        name: section.name,
        text: outcome.text,
        ...section.interpolate === undefined ? {} : { interpolate: section.interpolate },
      })
    }

    working = next
    appliedRules += hits > 0 ? 1 : 0
    ruleResults.push({ id: rule.id, status: hits > 0 ? 'applied' : 'no-match', hits })
  }

  // 追加自定义段落：只加启用的、内容非空的。
  // 宿主端 waterfall 传 includeAppended: false，因为这些段落已经通过正式
  // section 注册进入 assembly，重复追加会让提示词出现两份。
  if (options.includeAppended !== false) {
    for (const section of normalized.appendSections || []) {
      if (!section.enabled || !section.valid) continue
      working.push({ name: section.name, text: section.text, order: section.order })
    }
  }

  // 自定义段落带 order，官方 assembly 里的段落没有；这里按 order 重新排一次，
  // 缺 order 的保持原有相对顺序（稳定排序保证这一点）。
  working = stableSortByOrder(working)

  return { sections: working, ruleResults, appliedRules }
}

/**
 * 稳定排序：有 order 的按 order 排，没有 order 的保持原始相对位置。
 *
 * 不能简单地 `sort((a,b) => (a.order ?? 0) - (b.order ?? 0))`：那会把所有
 * 官方段落当成 order 0，打乱它们原本的正确顺序。
 * @param {object[]} sections - 段落列表。
 * @returns {object[]} 排序后的新列表。
 */
export function stableSortByOrder(sections) {
  const list = Array.isArray(sections) ? sections : []
  const annotated = list.map((section, index) => ({ section, index }))

  annotated.sort((left, right) => {
    const leftOrder = asNumber(left.section?.order, undefined)
    const rightOrder = asNumber(right.section?.order, undefined)

    if (leftOrder === undefined && rightOrder === undefined) return left.index - right.index
    // 没有 order 的段落视为“与相邻保持原位”，用原下标参与比较。
    if (leftOrder === undefined) return left.index < right.index ? -1 : 1
    if (rightOrder === undefined) return right.index < left.index ? 1 : -1

    return leftOrder - rightOrder || left.index - right.index
  })

  return annotated.map((item) => item.section)
}

/**
 * 按官方渲染规则把 sections 拼成最终提示词。
 *
 * 与 `renderPrompt` 的差别：这里**不做变量插值**，因为宿主端拿到的 assembly
 * 是插值前的文本。预览时如果直接展示 `{{model}}`，用户会以为变量坏了；
 * 所以提供 `variables` 参数做一次“尽力插值”，未定义的变量原样保留。
 * @param {object[]} sections - 段落列表。
 * @param {Record<string, string|undefined>} [variables] - 可用变量。
 * @returns {string} 拼接后的提示词。
 */
export function renderSections(sections, variables = {}) {
  const list = Array.isArray(sections) ? sections : []
  return list
    .map((section) => {
      const text = asText(section?.text)
      if (section?.interpolate === false) return text
      return interpolateLenient(text, variables)
    })
    .filter((text) => text.length > 0)
    .join('\n\n')
}

/**
 * 宽松插值：已知变量替换，未知变量原样保留。
 *
 * 官方的严格插值遇到未知变量会抛错，这在预览场景下会把整个页面搞崩。
 * 预览用宽松版，真正的渲染仍由官方完成，所以不会掩盖真实错误。
 * @param {string} text - 原始文本。
 * @param {Record<string, string|undefined>} variables - 变量表。
 * @returns {string} 插值结果。
 */
export function interpolateLenient(text, variables = {}) {
  const source = asText(text)
  return source.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (whole, name) => {
    const value = Object.hasOwn(variables, name) ? variables[name] : undefined
    return value === undefined ? whole : String(value)
  })
}

/**
 * 找出新文本里引用了但当前不可用的变量。
 *
 * 保存前用它做校验：官方渲染期遇到未知变量会抛错，提前拦下来比让用户在
 * 下一轮对话里看到报错要好。
 * @param {string} text - 待检查文本。
 * @param {Record<string, unknown>} variables - 可用变量表。
 * @returns {string[]} 未知变量名列表（去重、有序）。
 */
export function findUnknownVariables(text, variables = {}) {
  const source = asText(text)
  const unknown = new Set()
  const pattern = /\{\{([a-z][a-z0-9_]*)\}\}/g
  let match
  while ((match = pattern.exec(source)) !== null) {
    if (!Object.hasOwn(variables, match[1])) unknown.add(match[1])
  }
  return [...unknown].sort()
}

/* ------------------------------------------------------------------ *
 * 段落查询定位
 *
 * 场景：用户知道提示词里有这么一句话（例如「Web GUI」），但不知道它属于
 * 哪个 section，因此没办法写定位规则。这里提供“给一段文字 → 找出命中的
 * 段落”的纯函数，设置页据此展示结果，并可一键转成 `match.kind = 'name'`。
 *
 * 设计要点：
 *  1. 忽略空白差异。用户粘贴的多行文本、段内的换行/缩进都不应影响命中，
 *     所以匹配在「折叠空白」的副本上进行，再用下标映射回原文。
 *  2. `auto` 策略两级降级：先按连续短语找，找不到再按关键词（全部出现）找。
 *     前者精确，后者容忍措辞差异。
 *  3. 输出可直接渲染的片段（segments），前端不需要再做正则高亮。
 * ------------------------------------------------------------------ */

/** 允许的查询策略。`auto` 表示先短语、后关键词。 */
export const QUERY_MODES = Object.freeze(['auto', 'phrase', 'terms', 'regex'])

/** 片段上下文默认保留的字符数（匹配处前后各这么多）。 */
export const SNIPPET_CONTEXT = 60

/** 每个段落默认最多展示几个片段。 */
export const MAX_SNIPPETS = 3

/** 把匹配区间合并后，最多收集多少个区间（防止超短关键词命中上千处）。 */
const MAX_SPANS = 200

/**
 * 判断一个字符是否属于「单词字符」，用于 wholeWord 边界判断。
 * @param {string} char - 单个字符。
 * @returns {boolean} 是否单词字符。
 */
function isWordChar(char) {
  return char !== '' && /[A-Za-z0-9_]/.test(char)
}

/**
 * 折叠空白：把连续空白压成一个空格，并记录下标映射。
 *
 * 这样 `"Web\n  GUI"` 与 `"Web GUI"` 能互相匹配，而返回给前端的片段
 * 仍然取自**原文**（用 `map` 把折叠后的下标翻回原始下标）。
 * @param {string} text - 原始文本。
 * @returns {{text: string, map: number[]}} 折叠后的文本与 `折叠下标 → 原始下标`。
 */
export function compactWhitespace(text) {
  const source = asText(text)
  const out = []
  const map = []
  let pendingSpace = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (/\s/.test(char)) {
      // 前导空白直接丢弃；中间的连续空白只留一个空格占位。
      if (out.length > 0) pendingSpace = true
      continue
    }
    if (pendingSpace) {
      // 占位空格映射到「这一串空白的第一个字符」，切片时不会吞掉正文。
      map.push(index - 1)
      out.push(' ')
      pendingSpace = false
    }
    map.push(index)
    out.push(char)
  }

  return { text: out.join(''), map }
}

/**
 * 尽量做大小写折叠，同时保证长度不变。
 *
 * 极少数 Unicode 字符小写化后长度会变（如 `İ` → `i̇`），那会让匹配下标与
 * 原文错位，进而切出错误的片段。此时放弃折叠，退化为大小写敏感比较。
 * @param {string} text - 文本。
 * @returns {string} 折叠结果。
 */
function foldCase(text) {
  const lower = asText(text).toLowerCase()
  return lower.length === text.length ? lower : text
}

/**
 * 生成「折叠后的查询词」。
 *
 * 段落侧的 `foldCase` 可能因长度异常放弃折叠，查询侧必须做同样的判断，
 * 否则一边折叠、一边不折叠，两边永远匹配不上。
 * @param {string} text - 归一化后的查询文本（已折叠空白）。
 * @param {boolean} caseSensitive - 是否区分大小写。
 * @returns {string} 参与比较的查询词。
 */
function foldNeedle(text, caseSensitive) {
  return caseSensitive ? text : foldCase(text)
}

/**
 * 把一组区间按起止排序并合并相邻/重叠部分。
 * @param {{start: number, end: number}[]} spans - 原始区间。
 * @returns {{start: number, end: number}[]} 合并后的区间。
 */
function mergeSpans(spans) {
  const sorted = [...spans].sort((left, right) => left.start - right.start || left.end - right.end)
  const merged = []
  for (const span of sorted) {
    const last = merged[merged.length - 1]
    // 相邻（end 正好等于下一段 start）也合并：用户搜 "Web GUI" 的两个词时，
    // 结果应显示成一个连读的短语，而不是两段割裂的高亮。
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end)
      continue
    }
    merged.push({ start: span.start, end: span.end })
  }
  return merged
}

/**
 * 在一段已折叠空白的文本里找出全部关键词区间。
 * @param {string} haystack - 已折叠空白（并按需折叠大小写）的文本。
 * @param {string[]} needles - 关键词列表。
 * @param {{wholeWord?: boolean}} [options] - 是否要求单词边界。
 * @returns {{start: number, end: number}[]} 合并后的区间。
 */
function collectSpans(haystack, needles, options = {}) {
  const spans = []
  for (const needle of needles) {
    if (!needle) continue
    let from = 0
    while (from <= haystack.length - needle.length) {
      const at = haystack.indexOf(needle, from)
      if (at < 0) break
      const end = at + needle.length
      const bounded = options.wholeWord
        ? !isWordChar(haystack[at - 1] ?? '') && !isWordChar(haystack[end] ?? '')
        : true
      if (bounded) spans.push({ start: at, end })
      // 步进至少一个字符，避免零宽匹配造成死循环。
      from = at + Math.max(1, needle.length)
      if (spans.length >= MAX_SPANS) return mergeSpans(spans)
    }
  }
  return mergeSpans(spans)
}

/**
 * 归一化一次段落查询。
 * @param {unknown} raw - 原始查询（字符串或 `{text, mode, caseSensitive, wholeWord}`）。
 * @returns {{query: object|null, problem?: string}} 归一化结果。
 */
export function normalizeQuery(raw) {
  const value = raw && typeof raw === 'object' ? raw : { text: raw }
  const text = asText(value.text ?? value.query).trim()

  if (text === '') {
    return { query: null, problem: '查询内容为空' }
  }

  const mode = asText(value.mode || 'auto').trim().toLowerCase() || 'auto'
  const normalizedMode = QUERY_MODES.includes(mode) ? mode : 'auto'
  const query = {
    text,
    mode: normalizedMode,
    caseSensitive: asBool(value.caseSensitive, false),
    wholeWord: asBool(value.wholeWord, false),
  }

  const problem = QUERY_MODES.includes(mode)
    ? undefined
    : `未知的匹配方式 "${mode}"，已改用自动`

  if (normalizedMode === 'regex') {
    // 提前编译，把语法错误在归一化阶段暴露；非法正则退化为自动模式，
    // 至少还能给用户一个可用的结果，而不是一屏报错。
    try {
      // eslint-disable-next-line no-new
      new RegExp(text)
    } catch (error) {
      return {
        query: { ...query, mode: 'auto' },
        problem: `不是合法正则（${error instanceof Error ? error.message : String(error)}），已改用自动匹配`,
      }
    }
  }

  return { query, ...problem === undefined ? {} : { problem } }
}

/**
 * 把一段原文按区间切成「可渲染片段」。
 *
 * 返回的 `segments` 已包含命中标记与省略号，前端直接 `<mark>` 即可，
 * 不需要再自己找下标。换行被压成空格，因为这里是定位预览而非全文。
 * @param {string} text - 原文（未折叠）。
 * @param {{start: number, end: number}} span - 在原文中的命中区间。
 * @param {number} [contextChars] - 前后保留的字符数。
 * @returns {{segments: {text: string, hit: boolean}[], leading: boolean, trailing: boolean, hitText: string}} 片段。
 */
export function buildSnippet(text, span, contextChars = SNIPPET_CONTEXT) {
  const source = asText(text)
  const context = Math.max(0, asNumber(contextChars, SNIPPET_CONTEXT) ?? SNIPPET_CONTEXT)
  const start = Math.max(0, Math.min(span.start, source.length))
  const end = Math.max(start, Math.min(span.end, source.length))

  const from = Math.max(0, start - context)
  const to = Math.min(source.length, end + context)

  const flatten = (value) => value.replace(/\s+/g, ' ')

  const segments = []
  const before = flatten(source.slice(from, start))
  const hit = flatten(source.slice(start, end))
  const after = flatten(source.slice(end, to))

  if (before !== '') segments.push({ text: `${from > 0 ? '…' : ''}${before}`, hit: false })
  else if (from > 0) segments.push({ text: '…', hit: false })

  segments.push({ text: hit, hit: true })

  if (after !== '') segments.push({ text: `${after}${to < source.length ? '…' : ''}`, hit: false })
  else if (to < source.length) segments.push({ text: '…', hit: false })

  return {
    segments,
    leading: from > 0,
    trailing: to < source.length,
    // 用于展示的 hit 已把换行压成空格；写进规则的「查找原文」必须用未经
    // 改动的原始文本，否则跨行命中会被填成一段在原文里根本不存在的内容。
    hitText: source.slice(start, end),
  }
}

/**
 * 对单个段落跑一次查询。
 *
 * 三种策略的语义差别很重要：
 *  - `phrase`：整段查询文本作为一个连续短语出现（最精确）；
 *  - `terms`：查询文本按空白切词后，**每个词都出现**（顺序与间隔不限）；
 *  - `regex`：在折叠空白的原文上跑正则，跨行也能命中。
 * @param {{compact: string, folded: string}} target - 段落的折叠文本（原文 / 折叠大小写）。
 * @param {object} query - 归一化后的查询（含 `needle` / `terms`）。
 * @param {'phrase'|'terms'|'regex'} strategy - 实际使用的策略。
 * @returns {{start: number, end: number}[]} 命中区间（基于折叠文本下标）。
 */
function runQuery(target, query, strategy) {
  if (strategy === 'regex') {
    // 正则跑在**未折叠大小写**的文本上，只用 flags 控制大小写：
    // 折叠会破坏 `[A-Z]`、`\p{Lu}` 这类模式，结果是静默查不到。
    const flags = query.caseSensitive ? 'g' : 'gi'
    try {
      const pattern = new RegExp(query.text, flags)
      const spans = []
      for (const match of target.compact.matchAll(pattern)) {
        if (match[0] === '') continue
        spans.push({ start: match.index, end: match.index + match[0].length })
        if (spans.length >= MAX_SPANS) break
      }
      return mergeSpans(spans)
    } catch {
      return []
    }
  }

  // phrase / terms 在折叠大小写的文本上做字面比较。
  if (strategy === 'terms') {
    // 关键词模式要求每个词都必须至少产生一处有效命中（在满足 wholeWord 等条件下）。
    // 若某个词未能产生任何有效命中，整段直接判定为不匹配。
    const allSpans = []
    for (const term of query.terms) {
      if (!term) continue
      const termSpans = collectSpans(target.folded, [term], { wholeWord: query.wholeWord })
      if (termSpans.length === 0) return []
      allSpans.push(...termSpans)
    }
    return mergeSpans(allSpans)
  }

  return collectSpans(target.folded, [query.needle], { wholeWord: query.wholeWord })
}

/**
 * 在若干段落里定位一段文字。
 *
 * 这是「段落查询定位」的核心：给定一个词或一段话，返回命中它的段落列表，
 * 每段附命中次数与可直接渲染的上下文片段。
 * @param {object[]} sections - 段落列表（`{name, text, interpolate?}`）。
 * @param {unknown} rawQuery - 原始查询。
 * @param {{variables?: object, contextChars?: number, maxSnippets?: number}} [options] - 选项。
 * @returns {object} 查询结果；任何异常都转成 `ok: false` 而不是抛出。
 */
export function locateInSections(sections, rawQuery, options = {}) {
  const list = Array.isArray(sections) ? sections : []
  const variables = options.variables && typeof options.variables === 'object' ? options.variables : {}
  const contextChars = asNumber(options.contextChars, SNIPPET_CONTEXT) ?? SNIPPET_CONTEXT
  const maxSnippets = Math.max(1, asNumber(options.maxSnippets, MAX_SNIPPETS) ?? MAX_SNIPPETS)

  const { query, problem } = normalizeQuery(rawQuery)
  const base = {
    ok: true,
    query,
    problem: problem ?? null,
    strategy: null,
    matches: [],
    matchedSections: 0,
    totalSections: list.length,
    totalSpans: 0,
    message: '',
  }

  if (query === null) {
    return { ...base, ok: false, message: problem || '查询内容为空' }
  }

  try {
    // 预处理：每个段落的「展示文本」（插值后）+ 折叠副本。
    //  `compact` 保留大小写，只折叠空白——正则用它，`[A-Z]` 才有意义；
    //  `folded`  再折叠大小写——字面匹配用它，区分大小写时与 compact 相同。
    // 两者长度必须相等，否则下标映射会错位。
    const prepared = list.map((section, index) => {
      const raw = asText(section?.text)
      const display = section?.interpolate === false ? raw : interpolateLenient(raw, variables)
      const compact = compactWhitespace(display)
      return {
        index,
        name: asText(section?.name),
        display,
        compact: compact.text,
        folded: query.caseSensitive ? compact.text : foldCase(compact.text),
        map: compact.map,
      }
    })

    const needleSource = compactWhitespace(query.text)
    const baseQuery = {
      ...query,
      needle: foldNeedle(needleSource.text, query.caseSensitive),
      // 按空白切词：多词查询时要求「每个词都出现」，容忍顺序与间隔差异。
      terms: needleSource.text
        .split(' ')
        .map((item) => foldNeedle(item, query.caseSensitive))
        .filter((item) => item !== ''),
    }

    // auto 的两级降级：短语命中说明这段文字**原样存在**，可信度最高；
    // 短语一个都没命中时，再退回关键词，避免用户抄错一个标点就毫无结果。
    // 单词查询没有降级空间（短语与关键词等价），直接只跑一次。
    const order = query.mode === 'auto'
      ? (baseQuery.terms.length > 1 ? ['phrase', 'terms'] : ['phrase'])
      : [query.mode]

    let strategy = null
    let hits = []

    for (const candidate of order) {
      const found = prepared
        .map((entry) => ({ entry, spans: runQuery(entry, baseQuery, candidate) }))
        .filter((item) => item.spans.length > 0)

      if (found.length > 0) {
        strategy = candidate
        hits = found
        break
      }
    }

    if (strategy === null) {
      return {
        ...base,
        strategy: order[0],
        message: `没有任何段落包含「${query.text}」。可以试试更短的词、关闭大小写区分，或改用正则匹配。`,
      }
    }

    const matches = hits.map(({ entry, spans }) => {
      // 折叠副本的下标 → 原文下标。区间末端要 +1（slice 左闭右开），
      // 因此用「命中最后一个字符的下标」，而不是映射表的越界读取。
      const toOriginal = (span) => ({
        start: entry.map[span.start] ?? 0,
        end: (entry.map[span.end - 1] ?? Math.max(0, entry.display.length - 1)) + 1,
      })

      const snippets = spans.slice(0, maxSnippets).map((span) =>
        buildSnippet(entry.display, toOriginal(span), contextChars))

      // 片段被截断时额外给出「首个命中 → 末个命中」的原文范围，
      // 方便前端提示"还有 N 处未展示"，而不必把全文塞进响应。
      const first = toOriginal(spans[0])
      const last = toOriginal(spans[spans.length - 1])

      return {
        name: entry.name,
        index: entry.index + 1,
        length: entry.display.length,
        hits: spans.length,
        omitted: Math.max(0, spans.length - snippets.length),
        range: { from: first.start, to: last.end },
        snippets,
      }
    })

    // 命中越多越靠前；同分时按段落原始顺序，便于用户对照提示词结构。
    matches.sort((left, right) => right.hits - left.hits || left.index - right.index)

    const totalSpans = matches.reduce((sum, item) => sum + item.hits, 0)
    const strategyText = strategy === 'phrase' ? '按短语匹配' : strategy === 'terms' ? '按关键词匹配' : '按正则匹配'

    return {
      ...base,
      strategy,
      matches,
      matchedSections: matches.length,
      totalSpans,
      message: `共 ${matches.length} 个段落命中「${query.text}」（${strategyText}），合计 ${totalSpans} 处。`,
    }
  } catch (error) {
    // 查询是辅助功能，坏输入绝不能让设置页崩掉。
    return {
      ...base,
      ok: false,
      message: `查询失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * 构造一份便于阅读的默认配置。
 * @returns {object} 默认配置。
 */
export function defaultConfig() {
  return {
    enabled: true,
    rules: [],
    appendSections: [],
  }
}
