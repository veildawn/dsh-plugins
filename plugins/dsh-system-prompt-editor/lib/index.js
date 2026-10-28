/**
 * dsh-system-prompt-editor 宿主端。
 *
 * 职责：
 *  1. 把配置（settings 服务 / 本地 JSON）读进内存，并在变更时刷新；
 *  2. 通过 `system-prompt/assemble` waterfall 改写已组装的 sections；
 *  3. 通过 `systemPrompt.section()` 注册用户追加的自定义段落；
 *  4. 通过 `connection.rpc` 暴露设置页所需的方法。
 *
 * 为什么以 waterfall 为主通道：
 * `harness:identity`、`deployment:persona-prefix` 等 section 已在全局层硬编码
 * 注册，全局再注册同名会直接抛错（`prompt section "x" is already registered`）。
 * 而 waterfall 拿到的就是最终 assembly，返回值权威，因此全局插件也能安全地
 * 改写任意段落，且不会与其它插件抢占 section 命名空间。
 *
 * @module @weniatall/dsh-system-prompt-editor
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import z from '@deepseek-ai/schemastery'

import {
  CUSTOM_SECTION_PREFIX,
  NS,
  asText,
  applyRules,
  defaultConfig,
  findUnknownVariables,
  locateInSections,
  normalizeConfig,
  renderSections,
} from './core.js'

/** 前端设置页使用的 RPC 通道。 */
export const RPC_CHANNEL = '/dsh-system-prompt-editor'

/**
 * 组装上下文里的“旁路”标记。
 *
 * 设置页需要展示**真正的系统默认提示词**，但 `systemPrompt.assemble()` 会触发
 * 所有已注册的 waterfall —— 包括本插件自己。如果不加旁路，`baseline` 拿到的
 * 会是已经被本插件改写过的文本，用户就永远看不到“默认是什么样”。
 *
 * `AssembleContext` 是开放对象（官方类型允许模块扩展），额外字段对其它监听器
 * 无副作用：它们只会忽略不认识的键。
 */
const BYPASS_KEY = '__systemPromptEditorBypass'

/**
 * 配置 schema。
 *
 * 用 `z.any()` 承接规则数组：规则结构由 lib/core.js 的归一化函数校验，
 * 这里如果写成严格 schema，用户写错一个字段就会导致整个配置加载失败，
 * 而我们的设计是“坏规则只废掉那一条”。
 */
export const Config = z.object({
  enabled: z.boolean().default(true).description('总开关；关闭后所有规则与追加段落都不生效'),
  settingsFile: z
    .string()
    .default('')
    .description('本地持久化配置文件路径（留空则使用 ~/.dsh/system-prompt-editor/settings.json）'),
  rules: z.array(z.any()).default([]).description('提示词改写规则列表'),
  appendSections: z.array(z.any()).default([]).description('追加的自定义提示词段落列表'),
})

/** 插件名（Cordis 用于诊断与配置归属）。 */
export const name = 'system-prompt-editor'

/**
 * 依赖的服务。
 *
 * 必须与 `cordis.patch.yml` 的 `inject` 保持一致：`connection` 提供设置页
 * 所需的 RPC 通道，漏掉它则前端调用会得到 HTTP 405 —— UI 能正常渲染，
 * 但宿主端从未 register 过该通道。
 */
export const inject = ['systemPrompt', 'connection']

/**
 * 解析 dsh 主目录。
 * @returns {string} 配置根目录。
 */
export function resolveDshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/**
 * 默认的本地配置文件路径。
 * @returns {string} 绝对路径。
 */
export function defaultSettingsFilePath() {
  return path.join(resolveDshHome(), 'system-prompt-editor', 'settings.json')
}

/**
 * 解析用户配置的路径，支持 `~` 前缀。
 * @param {string} configured - 用户配置值。
 * @returns {string} 绝对路径。
 */
export function resolveSettingsFilePath(configured) {
  const trimmed = asText(configured).trim()
  if (trimmed === '') return defaultSettingsFilePath()
  if (trimmed === '~') return os.homedir()
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2))
  }
  return path.resolve(trimmed)
}

/**
 * 读取本地 JSON 配置；任何异常都返回 `null`，由调用方回退到默认值。
 * @param {string} filePath - 配置文件路径。
 * @returns {object|null} 解析结果。
 */
export function readPersistedSettings(filePath) {
  try {
    const target = filePath || defaultSettingsFilePath()
    if (!fs.existsSync(target)) return null
    const data = JSON.parse(fs.readFileSync(target, 'utf8'))
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    return data
  } catch {
    return null
  }
}

/**
 * 原子写入本地 JSON 配置。
 *
 * 先写临时文件再 `rename`：中途崩溃时旧文件保持完整，
 * 不会留下半截 JSON 让下次启动读失败。
 * @param {string} filePath - 目标路径。
 * @param {object} patch - 要合并的字段。
 * @returns {boolean} 是否写入成功。
 */
export function writePersistedSettings(filePath, patch) {
  const target = filePath || defaultSettingsFilePath()
  const temp = `${target}.${process.pid}.tmp`
  try {
    const current = readPersistedSettings(target) || {}
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    fs.renameSync(temp, target)
    return true
  } catch {
    try {
      if (fs.existsSync(temp)) fs.rmSync(temp, { force: true })
    } catch {
      // 清理失败不影响返回值。
    }
    return false
  }
}

/**
 * 从 agent 上尽力解析当前会话的预设 id 与会话 id。
 *
 * 这些字段来自 `dsh-session` / `dsh-agent`，并非所有部署都会提供；
 * 全部按可选处理，拿不到就返回 `null`，由 `ruleAppliesTo` 决定放行。
 * @param {unknown} agent - assembly 上下文里的 agent（可能不存在）。
 * @returns {{presetId: string|null, sessionId: string|null}} 上下文标识。
 */
export function resolveAgentIdentity(agent) {
  const result = { presetId: null, sessionId: null }
  if (!agent || typeof agent !== 'object') return result

  try {
    const header = agent.session?.header
    if (header && typeof header === 'object') {
      const preset = asText(header.agentPreset).trim()
      if (preset !== '') result.presetId = preset
      const id = asText(header.id ?? header.sessionId).trim()
      if (id !== '') result.sessionId = id
    }
  } catch {
    // 探测失败一律视为未知。
  }

  if (result.sessionId === null) {
    try {
      const id = asText(agent.session?.id).trim()
      if (id !== '') result.sessionId = id
    } catch {
      // 忽略。
    }
  }

  return result
}

/**
 * 最近一次 assembly 的短时缓存。
 *
 * 「段落查询定位」是输入即查的交互：用户每敲一个词就会发一次请求，若每次都
 * 重新 `assemble`，等于把整条 waterfall 链（含其它插件）反复跑一遍。
 * 缓存只保留极短时间（默认 3 秒），既能吸收连续输入，又不会让用户在改完
 * 规则后看到过期结果。
 * @type {WeakMap<object, {at: number, promise: Promise<object>}>}
 */
const assemblyCache = new WeakMap()

/** 缓存有效期（毫秒）。 */
const ASSEMBLY_CACHE_TTL = 3000

/**
 * 找出一个可以用来组装「完整提示词」的存活 agent。
 *
 * **为什么需要它**：`systemPrompt.assemble({ scope: undefined })` 只合并
 * **全局层**，而不少段落是注册在 **agent scope** 上的。典型例子是
 * `@deepseek-ai/dsh-file-reference-local`：
 *
 * ```js
 * agent.ctx.inject(['systemPrompt', 'tools'], (scope) => {
 *   scope.systemPrompt.section({ name: 'context:file-reference', ... })
 * })
 * ```
 *
 * 这段只有传入 agent 的 scope 才会被合并，并且它的 `text()` 还要用
 * `agent.ctx.tools.get('read', agent)` 判断是否输出。因此设置页若始终以
 * `scope: undefined` 组装，`context:file-reference` 就永远不出现在段落列表里，
 * 「段落查询定位」搜不到、按名称下拉框也选不到——用户明明能在会话提示词里
 * 看到这句话，却在编辑器里找不到它。
 *
 * 探测一律防御式：`ctx.agents` 是可选服务（peerDependencies 未声明），
 * 且测试用最小 ctx 构造，任何异常都退化为「没有 agent」。
 * @param {object} ctx - 插件上下文。
 * @returns {object|null} 存活 agent（含 `.ctx`）或 null。
 */
export function findLiveAgent(ctx) {
  try {
    const agents = ctx?.agents
    if (!agents || typeof agents.list !== 'function') return null
    const all = agents.list()
    if (!Array.isArray(all) || all.length === 0) return null

    // 优先顶层 agent：子代理（subagent）的 scope 会叠加父级分层，
    // 组装结果最完整，但它不是用户此刻在用的那个会话，容易误导。
    let roots = []
    try {
      if (typeof agents.roots === 'function') {
        const listed = agents.roots()
        if (Array.isArray(listed)) roots = listed
      }
    } catch {
      // 忽略：退化为 list() 的首个。
    }
    const candidate = roots[0] ?? all[0]
    return candidate && typeof candidate === 'object' ? candidate : null
  } catch {
    return null
  }
}

/**
 * 组装一次 baseline，必要时回退到 agent scope。
 *
 * 先用全局 scope 组装（兼容没有存活 agent 的部署，例如一次性 CLI 调用），
 * 再用 agent scope 组装一次，把**只在 agent 层注册**的段落补进来。
 * 两路按 section 名去重，全局已有的一律以全局为准——全局结果与旧行为完全
 * 一致，所以这项改动对原本能看到的段落没有任何影响。
 * @param {object} state - 插件运行时状态。
 * @param {object|null} agent - 存活 agent（可为 null）。
 * @returns {Promise<object>} 合并后的 assembly。
 */
async function assembleWithAgentScope(state, agent) {
  const base = await state.prompt.assemble({ scope: undefined, [BYPASS_KEY]: true })
  if (!agent) return base

  let scoped = null
  try {
    // **必须传 agent 对象本身，不能传 agent.ctx。**
    //
    // 这是实测出来的（v0.3.3 就是因为传错这里而完全没生效）：
    // `scopeOf(agent)` 返回 undefined，而 `scopeOf(agent.ctx)` 有值；但
    // `assemble({ scope })` 内部的 `chainLayers(scope)` 要的是 **agent 自己**——
    // 宿主把 agent 当作 scope 载体（`scopeTarget(agent, agent)`）。
    //
    // 实测同一个 agent 的三种传法：
    //   scope: agent        → 9 段，含 context:file-reference ✓
    //   scope: agent.ctx    → 8 段，不含                       ✗
    //   scope: scopeOf(...) → 8 段，不含                       ✗
    // 传对的两种情况差的就是全部 agent 级段落，正是用户查不到的那一段。
    scoped = await state.prompt.assemble({ scope: agent, agent, [BYPASS_KEY]: true })
  } catch {
    // agent scope 组装失败（例如会话正在销毁）不该让整个设置页报错：
    // 退回全局结果，至少保留原有能力。
    return base
  }

  const baseSections = Array.isArray(base?.sections) ? base.sections : []
  const scopedSections = Array.isArray(scoped?.sections) ? scoped.sections : []
  if (scopedSections.length === 0) return base

  const seen = new Set(baseSections.map((section) => asText(section?.name)))
  const merged = [...baseSections]
  for (const section of scopedSections) {
    const name = asText(section?.name)
    if (seen.has(name)) continue
    // 空文本段落**也要列出**。
    //
    // 反面教训（v0.3.2 → v0.3.3 的遗漏）：`context:file-reference` 的 text()
    // 在 agent 缺 `read` 工具时返回空串，我据此把空段落过滤掉，结果用户看到
    // 段落列表里根本没有这一项，误以为是查询功能坏了。事实是「段落存在，
    // 只是当前条件不输出」——这两种情况必须能被区分，所以保留它并打标记
    // （见 `inactive` 字段），由前端显示「当前未输出」。
    seen.add(name)
    merged.push({ ...section, inactive: asText(section?.text) === '' })
  }

  if (merged.length === baseSections.length) return base
  return { ...base, sections: merged }
}

/**
 * 取一份「纯默认」assembly（已带旁路标记，不含本插件的改写）。
 * @param {object} state - 插件运行时状态。
 * @param {{fresh?: boolean}} [options] - `fresh: true` 强制重新组装。
 * @returns {Promise<object>} assembly。
 */
async function getBaselineAssembly(state, options = {}) {
  const now = Date.now()
  const cached = assemblyCache.get(state)
  if (!options.fresh && cached && now - cached.at < ASSEMBLY_CACHE_TTL) {
    try {
      return await cached.promise
    } catch {
      // 缓存里的失败不该持续放大，丢掉后重新组装。
      assemblyCache.delete(state)
    }
  }

  const promise = assembleWithAgentScope(state, findLiveAgent(state.ctx))
  assemblyCache.set(state, { at: now, promise })
  return promise
}

/**
 * 在**当前系统提示词的段落**里定位一段文字。
 *
 * 查询对象与设置页「按名称」下拉框列出的是同一批段落（纯官方段落 + 用户追加
 * 的段落），因此查到结果后可以直接在下拉框里选中它去写规则——这正是本功能
 * 存在的意义：用户往往知道某句话在提示词里，但不知道它属于哪个 section。
 * @param {object} state - 插件运行时状态。
 * @param {unknown} rawQuery - 原始查询（字符串或 `{text, mode, ...}`）。
 * @param {{contextChars?: number, maxSnippets?: number, fresh?: boolean}} [options] - 选项。
 * @returns {Promise<object>} 查询结果；组装失败时返回 `ok: false` 而非抛错。
 */
export async function locatePrompt(state, rawQuery, options = {}) {
  try {
    const assembly = await getBaselineAssembly(state, options)
    const variables = assembly?.variables && typeof assembly.variables === 'object'
      ? assembly.variables
      : {}
    const sections = Array.isArray(assembly?.sections) ? assembly.sections : []

    const located = locateInSections(sections, rawQuery, {
      variables,
      contextChars: options.contextChars,
      maxSnippets: options.maxSnippets,
    })

    // 给每个命中段落补上「是否用户追加」与排序值：前者让前端能区分官方段与
    // 自定义段，后者方便用户理解它在提示词里的位置。
    const byName = new Map(sections.map((section) => [asText(section?.name), section]))
    const matches = located.matches.map((match) => {
      const section = byName.get(match.name)
      return {
        ...match,
        custom: match.name.startsWith(CUSTOM_SECTION_PREFIX),
        order: Number.isFinite(section?.order) ? section.order : null,
      }
    })

    return { ...located, matches, totalSections: sections.length }
  } catch (error) {
    return {
      ok: false,
      query: null,
      problem: null,
      strategy: null,
      matches: [],
      matchedSections: 0,
      totalSections: 0,
      totalSpans: 0,
      message: `无法组装提示词，暂时无法定位：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * 记录非致命诊断日志。
 * @param {object} ctx - 上下文。
 * @param {string} message - 日志内容。
 */
function warn(ctx, message) {
  try {
    if (typeof ctx?.logger?.warn === 'function') ctx.logger.warn(`[system-prompt-editor] ${message}`)
  } catch {
    // 诊断日志永不阻断主流程。
  }
}

/**
 * 组装给设置页的视图数据。
 *
 * 这是前端唯一的数据入口：它同时返回**当前配置**、**归一化后的真实生效规则**、
 * **当前系统提示词**（默认展示需求）以及**逐条规则命中情况**。
 * @param {object} state - 插件运行时状态。
 * @param {{preview?: object}} [options] - 预览模式：用候选配置渲染而不落盘。
 * @returns {Promise<object>} 视图数据。
 */
export async function buildSettingsView(state, options = {}) {
  const config = options.preview === undefined
    ? state.current()
    : normalizeConfig(options.preview)

  let baseline = null
  let effective = null
  let variables = {}
  let sections = []
  let ruleResults = []
  let failure = null

  try {
    // 组装一次“真正的系统默认提示词”：带上旁路标记，让本插件的 waterfall 跳过
    // 自己的改写，这样用户看到的 baseline 才是官方原始内容。
    // 必须带上存活 agent 的 scope：只在 agent 层注册的段落
    // （如 context:file-reference）否则不会出现在段落列表与预览里。
    const baselineAssembly = await assembleWithAgentScope(state, findLiveAgent(state.ctx))
    variables = baselineAssembly?.variables && typeof baselineAssembly.variables === 'object'
      ? baselineAssembly.variables
      : {}

    const originalSections = Array.isArray(baselineAssembly?.sections) ? baselineAssembly.sections : []
    // 追加段落是通过正式 section 注册进入 assembly 的，旁路标记拦不住它们，
    // 因此这里再按命名空间前缀剔除一次，保证 baseline 是“纯官方默认”。
    const officialSections = originalSections.filter(
      (section) => !asText(section?.name).startsWith(CUSTOM_SECTION_PREFIX),
    )
    baseline = renderSections(officialSections, variables)

    // 预览要包含自定义段落，否则用户看不到“追加”的效果；
    // 与宿主 waterfall 不同，这里 includeAppended 默认为 true。
    const rewritten = applyRules(officialSections, config, {})
    effective = renderSections(rewritten.sections, variables)
    ruleResults = rewritten.ruleResults

    sections = originalSections.map((section) => ({
      name: asText(section?.name),
      length: asText(section?.text).length,
      preview: asText(section?.text).slice(0, 240),
      // inactive：该段落已注册但当前不输出（text() 返回空串）。
      // 典型例子是 context:file-reference —— agent 没有 read 工具时它为空。
      // 前端据此显示「当前未输出」，把「段落不存在」与「条件不满足」区分开。
      inactive: section?.inactive === true || asText(section?.text) === '',
    }))
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }

  const unknownVariables = []
  const collectUnknown = (text) => {
    for (const varName of findUnknownVariables(text, variables)) {
      if (!unknownVariables.includes(varName)) unknownVariables.push(varName)
    }
  }
  for (const section of config.appendSections || []) {
    if (section.enabled) collectUnknown(section.text)
  }
  for (const rule of config.rules || []) {
    if (!rule.enabled || !rule.action) continue
    if (typeof rule.action.text === 'string') collectUnknown(rule.action.text)
    if (typeof rule.action.replace === 'string') collectUnknown(rule.action.replace)
  }

  return {
    ok: true,
    channel: RPC_CHANNEL,
    config,
    baseline,
    effective,
    variables,
    unknownVariables,
    sections,
    ruleResults,
    diagnostics: config.diagnostics || [],
    failure,
    settingsFile: state.settingsFile,
    storageKind: state.storageKind,
    hint: failure === null
      ? 'baseline 是当前系统默认提示词，effective 是套用规则后的结果。'
      : '无法组装提示词，请检查 systemPrompt 服务是否就绪。',
  }
}

/**
 * 插件入口。
 * @param {object} ctx - Cordis 上下文。
 * @param {object} config - 插件配置。
 */
export function apply(ctx, config) {
  let stored = normalizeConfig(config ?? defaultConfig())
  const listeners = new Set()

  const settingsFile = resolveSettingsFilePath(config?.settingsFile)

  // —— 配置来源 ——
  // 优先使用官方 settings 服务（配置会进入 profile 文档，随 profile 保存）；
  // 否则退化为本地 JSON 文件（file-viewer 已验证过的兼容路径）。
  let storageKind = 'memory'
  let scope = null

  try {
    if (typeof ctx.settings?.register === 'function') {
      const base = ctx.fiber?.entry?.options?.config ?? config ?? {}
      scope = ctx.settings.register(NS, Config, { base })
      storageKind = 'settings'
    }
  } catch (error) {
    warn(ctx, `settings 服务注册失败，回退到本地文件：${error instanceof Error ? error.message : String(error)}`)
  }

  // 走本地文件时必须监听 loader/volatile-update 重新读盘，
  // 否则另一个浏览器或编辑器改了同一份文件，本进程永远看不到新值。
  const usingFile = scope === null

  if (usingFile) {
    const persisted = readPersistedSettings(settingsFile)
    if (persisted !== null) stored = normalizeConfig(persisted)
    storageKind = 'file'
  }

  const current = () => {
    if (scope !== null) {
      try {
        return normalizeConfig(scope.get())
      } catch (error) {
        warn(ctx, `读取 settings 失败，沿用内存值：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return stored
  }

  // —— 主通道：waterfall 改写 ——
  const disposeWaterfall = ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const result = await next()
    try {
      // 设置页请求“纯默认”视图时跳过本插件的改写，否则 baseline 会被自己污染。
      if (context?.[BYPASS_KEY] === true) return result

      const active = current()
      if (active.enabled === false) return result
      if ((active.rules || []).length === 0) return result

      const identity = resolveAgentIdentity(context?.agent)
      // includeAppended: false —— 自定义段落已通过 systemPrompt.section() 正式注册，
      // 这里只负责改写已有段落，避免同一段文字出现两次。
      const outcome = applyRules(result?.sections || [], active, identity, { includeAppended: false })

      // 保留官方其它字段（contexts/tools/variables），只替换 sections。
      return { ...result, sections: outcome.sections }
    } catch (error) {
      // 任何异常都必须放行原始 assembly：宁可提示词没被改，也不能让会话挂掉。
      warn(ctx, `改写系统提示词失败，已回退原始内容：${error instanceof Error ? error.message : String(error)}`)
      return result
    }
  })
  ctx.on('dispose', disposeWaterfall)

  // —— 辅通道：追加自定义段落 ——
  // 这部分走正式的 section 注册，能享受官方排序与插值。
  // waterfall 里刻意不追加段落（includeAppended: false），否则会与这里重复。
  const disposers = []

  const syncSections = () => {
    while (disposers.length > 0) {
      const dispose = disposers.pop()
      try {
        if (typeof dispose === 'function') dispose()
      } catch {
        // 卸载失败无妨，后续会重新注册。
      }
    }

    const active = current()
    if (active.enabled === false) return

    for (const section of active.appendSections || []) {
      if (!section.enabled || !section.valid) continue
      try {
        const unregister = ctx.systemPrompt.section({
          name: section.name,
          order: section.order,
          text: section.text,
        })
        if (typeof unregister === 'function') disposers.push(unregister)
      } catch (error) {
        warn(ctx, `注册自定义段落 "${section.name}" 失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  syncSections()
  ctx.on('dispose', () => {
    while (disposers.length > 0) {
      const dispose = disposers.pop()
      try {
        if (typeof dispose === 'function') dispose()
      } catch {
        // 忽略。
      }
    }
  })

  // 配置变化时重新同步 section 注册。
  const notify = () => {
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // 单个监听器失败不影响其它。
      }
    }
  }

  let watchDispose = null
  if (scope !== null && typeof scope.watch === 'function') {
    watchDispose = scope.watch(() => {
      syncSections()
      notify()
    })
  } else if (typeof ctx.on === 'function') {
    watchDispose = ctx.on('loader/volatile-update', () => {
      const persisted = readPersistedSettings(settingsFile)
      if (persisted !== null) {
        stored = normalizeConfig(persisted)
        syncSections()
        notify()
      }
    })
  }
  if (typeof watchDispose === 'function') ctx.on('dispose', watchDispose)

  const state = {
    prompt: ctx.systemPrompt,
    // 供 findLiveAgent 探测 agent scope：只在 agent 层注册的段落
    // （如 context:file-reference）必须带 agent 组装才能取到。
    ctx,
    current,
    settingsFile,
    storageKind,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async save(patch) {
      const normalized = normalizeConfig(patch)
      if (scope !== null) {
        const section = {
          enabled: normalized.enabled,
          settingsFile: asText(config?.settingsFile),
          rules: normalized.rules,
          appendSections: normalized.appendSections,
        }
        if (typeof scope.replace === 'function') {
          await scope.replace(section)
        } else if (typeof scope.update === 'function') {
          await scope.update(section)
        }
      } else {
        const ok = writePersistedSettings(settingsFile, {
          enabled: normalized.enabled,
          rules: normalized.rules,
          appendSections: normalized.appendSections,
        })
        if (!ok) throw new Error(`写入配置文件失败：${settingsFile}`)
      }
      // 只有持久化成功后才更新内存值：若写入失败就抛错，外层不会走到这里，
      // 因此不会出现"用户以为没保存成功、规则却已经生效"的静默不一致。
      stored = normalized
      assemblyCache.delete(state)
      syncSections()
      notify()
      return normalized
    },
  }

  // —— RPC：设置页数据通道 ——
  if (ctx.connection?.rpc?.handle) {
    ctx.connection.rpc.handle(
      RPC_CHANNEL,
      async (method, payload) => {
        try {
          if (method === 'describe') {
            return { ok: true, value: await buildSettingsView(state) }
          }
          if (method === 'preview') {
            const view = await buildSettingsView(state, { preview: payload?.config })
            return { ok: true, value: view }
          }
          if (method === 'locate') {
            // 段落查询定位：输入即查，不落盘、不改配置。
            // `payload.query` 既可以是字符串，也可以是 {text, mode, caseSensitive, wholeWord}。
            const located = await locatePrompt(state, payload?.query, {
              contextChars: payload?.contextChars,
              maxSnippets: payload?.maxSnippets,
            })
            return { ok: true, value: located }
          }
          if (method === 'save') {
            const saved = await state.save(payload?.config ?? {})
            const view = await buildSettingsView(state)
            return { ok: true, value: { saved, view } }
          }
          if (method === 'reset') {
            const saved = await state.save(defaultConfig())
            const view = await buildSettingsView(state)
            return { ok: true, value: { saved, view } }
          }
          return { ok: false, error: { message: `未知方法：${String(method)}` } }
        } catch (error) {
          return {
            ok: false,
            error: { message: error instanceof Error ? error.message : String(error) },
          }
        }
      },
      { authority: 'trusted-host' },
    )
  } else {
    warn(ctx, 'connection.rpc 不可用，设置页将无法读取配置。')
  }
}

/** 便于测试与诊断的内部工具。 */
export const _internals = {
  normalizeConfig,
  resolveAgentIdentity,
  readPersistedSettings,
  writePersistedSettings,
  resolveSettingsFilePath,
  defaultSettingsFilePath,
  buildSettingsView,
  locatePrompt,
}
