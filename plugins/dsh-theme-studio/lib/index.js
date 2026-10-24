/**
 * dsh-theme-studio 宿主半侧。
 *
 * 三件事：
 *
 * 1. **首屏零闪烁注入**：把「全部主题变量 + 组件样式 + 用户自定义」一次性写进
 *    `index.html` 的 `<head>`，并给 `html` 打上 `data-theme-studio="<已保存主题>"`。
 *    服务端直出（Web）与结构化注入行（Electron）两条路径都覆盖——与
 *    dsh-zcode-theme 时代的做法一致，避免用户看到宿主默认配色闪一下再变。
 *
 * 2. **设置 RPC**：设置面板通过 `ctx.connection.rpc` 读写设置、上传背景图、
 *    预览主题。设置落盘到 `~/.dsh/theme-studio/settings.json`。
 *
 * 3. **背景图路由**：`GET /api/dsh-theme-studio/background?file=<name>` 回传图片字节。
 *    不把图片塞进 CSS 的 data URI：8MB 的图 base64 后是 11MB 的内联样式，
 *    每次首屏都要重新传输，还会卡住解析。
 *
 *    路由挂在 `connection.fetch` 而不是 `webServer.get`：宿主的 `webServer`
 *    只暴露 `register` / `tapIndex` / `registerFallback`，**没有** `get(path, handler)`
 *    这个方法（早期实现照着 Express 的习惯写，`typeof ctx.webServer.get === 'function'`
 *    恒为 false，路由从未注册成功，表现为「背景图上传成功但界面没变化」——
 *    图片请求 404，CSS 里的 `url()` 解析失败）。
 *    走 `connection.fetch` 还顺带拿到 `/api` 通道的浏览器鉴权：`<img>` 与
 *    CSS 背景请求都会自动带上同源 cookie，不需要额外的 token 机制。
 *
 * ## 与 dsh-zcode-theme 的关系
 *
 * ZCode 全平台视觉主题已迁入本插件的内置主题（`zcode` / `zcode-mono`）。
 * 旧插件保留为兼容薄壳：它仍会注入 `data-dsh-theme="zcode"` 与一份等价 CSS，
 * 供已安装但尚未迁移的用户使用；两者同时存在时以本插件为准（见 css.js 的
 * `legacyVarsCss`，本插件同时满足新旧两套属性）。
 *
 * @module dsh-theme-studio
 */

import { BACKGROUND_ATTR, LEGACY_THEME_ATTR, STATUS_ATTR, THEME_ATTR, STYLE_ID, themeVarsCss } from './tokens.js'
import { BUILTIN_THEMES, DEFAULT_THEME_ID, THEME_IDS, getTheme, normalizeThemeId } from './themes/index.js'
import { fullThemeCss } from './css.js'
import {
  BACKGROUND_MIME,
  CODE_FONT_OPTIONS,
  DEFAULT_STATUS_EFFECT,
  FIELD_COLOR_ROLES,
  MAX_BACKGROUND_BYTES,
  STATUS_EFFECTS,
  STATUS_EFFECT_IDS,
  TEXT_FONT_OPTIONS,
  activeBackgroundMode,
  backgroundDir,
  customCss,
  loadSettings,
  normalizeSettings,
  readBackgroundImage,
  resolveSettingsPath,
  saveBackgroundImage,
  writeSettingsFile,
} from './settings.js'

export const name = 'theme-studio'

/** webServer 供 tapIndex / 路由使用；connection 供 rpc.handle 注册设置页 RPC 通道。必须注入 connection，否则前端调用报 HTTP 405。 */
export const inject = ['webServer', 'connection']

/** 设置面板的 RPC 通道。 */
export const SETTINGS_RPC_CHANNEL = '/dsh-theme-studio-settings'

/**
 * 背景图 HTTP 路由（精确路径，文件名走 `?file=` 查询参数）。
 *
 * 为什么不是 `/api/.../background/<file>` 这种路径参数形式：宿主的
 * `connection.fetch.register()` 只接受**精确路径**，不支持 `:param` 占位符
 * （见 `assertFetchRoute`：路径必须能被 `endpointFromPath('/api', path)` 解析，
 * 也就是固定的 `/api/<段>/<段>`，不含通配）。查询参数是这里唯一能传文件名的方式。
 */
export const BACKGROUND_ROUTE_PATH = '/api/dsh-theme-studio/background'

/**
 * 背景图 URL 前缀（含 `?file=`，用于拼接完整 URL）。
 *
 * 保留 `BACKGROUND_ROUTE_PREFIX` 这个名字给下游/测试，语义已改为「带查询串的前缀」。
 */
export const BACKGROUND_ROUTE_PREFIX = `${BACKGROUND_ROUTE_PATH}?file=`

/** 字体号的取值范围（与宿主 ui-theme 的 FONT_SIZE_SPECS 对齐）。 */
export const FONT_SIZE_RANGES = Object.freeze({
  text: { min: 10, max: 22 },
  code: { min: 10, max: 16 },
  terminal: { min: 10, max: 20 },
})

export {
  BACKGROUND_ATTR,
  THEME_ATTR,
  STYLE_ID,
  THEME_IDS,
  BUILTIN_THEMES,
  DEFAULT_THEME_ID,
  getTheme,
  normalizeThemeId,
}
export { FIELD_COLOR_ROLES, FONT_SIZE_RANGES as FONT_SIZES, TEXT_FONT_OPTIONS, CODE_FONT_OPTIONS }
export { loadSettings, normalizeSettings, customCss, resolveSettingsPath }
// 供兼容薄壳（dsh-zcode-theme）及下游复用同一份变量与色板定义。
export { themeVarsCss }
export {
  FORBIDDEN_COLORS,
  FORBIDDEN_HOST_TOKENS,
  HOST_TOKEN_MAP,
  REQUIRED_HOST_TOKENS,
  buildHostTokens,
  buildMaterialTokens,
  lightDark,
  resolveKey,
} from './tokens.js'
export { ZAI_PALETTE, GLASS_PALETTE } from './themes/index.js'
export { composeThemeCss, fullThemeCss, readStyleFile, STYLE_FILES, GLASS_STYLE_FILE, BACKGROUND_STYLE_FILE } from './css.js'
export { customCss as buildCustomCss, activeBackgroundMode, computeMobileFontSize } from './settings.js'
// 供测试与下游直接构造/校验背景图落盘行为（与 RPC 走同一条实现）。
export { saveBackgroundImage, readBackgroundImage, backgroundDir } from './settings.js'

const STYLE_RE = new RegExp(
  `<style\\b[^>]*\\bid\\s*=\\s*(?:"${STYLE_ID}"|'${STYLE_ID}'|${STYLE_ID})[^>]*>[\\s\\S]*?<\\/style>`,
  'i',
)
const HTML_TAG_RE = /<html\b[^>]*>/i
/** 同时匹配新旧两套主题属性，重写前统一剥掉，避免重复或残留。 */
const ATTR_RE = new RegExp(
  `\\s*(?:${THEME_ATTR}|data-dsh-theme)\\s*=\\s*(['"]).*?\\1`,
  'gi',
)

/**
 * 背景图的公开 URL。
 *
 * 文件名走查询参数：`connection.fetch` 的精确路由不支持路径占位符，
 * 而文件名可能含 `.` `-` `_`，放进查询串最省事且不会被路径解析改写。
 *
 * @param {string | null} file
 * @returns {string | null}
 */
export function backgroundUrl(file) {
  return file ? `${BACKGROUND_ROUTE_PREFIX}${encodeURIComponent(file)}` : null
}

/**
 * 生成主题 `<style>` 标签。
 *
 * @param {{ themeId?: string, settings?: object }} [options]
 * @returns {string}
 */
export function themeStyleTag(options = {}) {
  const themeId = normalizeThemeId(options.themeId, DEFAULT_THEME_ID)
  const settings = options.settings ?? {}
  const custom = customCss(settings, { backgroundUrl: backgroundUrl(settings.background?.file) })
  return `<style id="${STYLE_ID}">${fullThemeCss(themeId, custom)}</style>`
}

/**
 * 生成设置根属性的内联脚本。
 *
 * 当用户未选择主题或选择「系统默认」时，移除主题属性，让宿主完全保持官方原生样式；
 * 当选择具体主题时，同时写新旧两套属性（旧属性用于兼容读 data-dsh-theme 的插件）。
 *
 * `data-ts-bg` 是「用户设了背景」的开关：主题样式表靠它决定是否把
 * `#root` / 框架层 / 内容卡的填充让位给 body 上的背景图。没有它，三个不透明
 * 表面会把 body 背景整层盖住（详见 `setBackgroundFlagScript`）。
 *
 * @param {string} [themeId]
 * @param {{ background?: object }} [settings] 已规范化的设置（决定 data-ts-bg）
 * @returns {string}
 */
export function themeScopeScript(themeId, settings = {}) {
  const id = normalizeThemeId(themeId, DEFAULT_THEME_ID)
  const attrPart =
    id === 'none'
      ? `document.documentElement.removeAttribute('${THEME_ATTR}');` +
        `document.documentElement.removeAttribute('data-dsh-theme');`
      : `document.documentElement.setAttribute('${THEME_ATTR}', ${JSON.stringify(id)});` +
        `document.documentElement.setAttribute('data-dsh-theme', ${JSON.stringify(
          getTheme(id)?.legacyId ?? id,
        )});`
  return attrPart + setStatusEffectScript(settings.statusEffect) + setBackgroundFlagScript(settings.background)
}

/**
 * 生成「状态条特效档位」的开关脚本。
 *
 * **默认（`none`）时移除属性**：状态条是每轮对话都出现的高频元素，动效必须由
 * 用户在设置面板主动选择，安装主题不应强制改变它。`status.css` 的全部规则
 * 都以 `html[data-ts-status="<档位>"]` 开头，没有该属性时一条都不命中。
 *
 * @param {string} [effect] 档位 id（`none` / `shimmer` / `pulse` / `whale` / `flow`）
 * @returns {string}
 */
export function setStatusEffectScript(effect) {
  const id = typeof effect === 'string' && effect !== '' ? effect : DEFAULT_STATUS_EFFECT
  return id === DEFAULT_STATUS_EFFECT
    ? `document.documentElement.removeAttribute('${STATUS_ATTR}');`
    : `document.documentElement.setAttribute('${STATUS_ATTR}', ${JSON.stringify(id)});`
}

/**
 * 生成「用户是否设了背景」的开关脚本。
 *
 * 为什么需要这个属性：背景写在 `body` 上，而主题骨架里**有三层不透明填充**
 * 压在 body 之上——`#root`（surfaces.css）、框架层 `.frame`（frame.css）、
 * 主区 `.centerCol`（frame.css）。三层任意一层不透明，body 的背景图就完全
 * 看不见，表现是「设置保存成功、界面一点没变」。所以只要用户设了背景，
 * 就把这三层改成 `background: none` 让位——但**仅在这一条件下**，
 * 否则正常主题会因为失去骨架底色而透出宿主默认白底。
 *
 * `mode` 为 `none` 时移除属性，主题骨架恢复原样。
 *
 * @param {object} [background] 已规范化的 background
 * @returns {string}
 */
export function setBackgroundFlagScript(background) {
  const mode = activeBackgroundMode(background)
  return mode === 'none'
    ? `document.documentElement.removeAttribute('${BACKGROUND_ATTR}');`
    : `document.documentElement.setAttribute('${BACKGROUND_ATTR}', ${JSON.stringify(mode)});`
}

/**
 * 生成结构化 index 注入行（桌面端 Electron 走这条路径）。
 *
 * 桌面版与 Web 端的**渲染时机完全不同**，这是这里必须传 `settings` 的原因：
 *
 * - Web 端：`tapIndex` 在服务端渲染 index 时同步跑 `patchIndex(html, { themeId, settings })`；
 * - 桌面版：主进程从 `webServer.collectIndexInjections()` 取一次行表，
 *   经 IPC 交给渲染进程，由前端 `PZ()` 在应用挂载前逐行执行：
 *   `script` 行 → `document.createElement('script')` + `textContent`，
 *   `html` 行 → `head.insertAdjacentHTML('beforeend', row.html)`。
 *
 * 所以两行各司其职：`script` 行负责把 `data-theme-studio` 写到 `documentElement`
 * （没有它，`html[data-theme-studio] …` 全部不命中），`html` 行负责样式表本体。
 *
 * 早期实现只传了 `themeId`，没传 `settings`：Web 端有自定义背景/字体/字段色，
 * 桌面版首屏却是「主题色生效、用户自定义丢失」，要等客户端 `applyToDocument()`
 * 通过 RPC 拿到设置后才补上——表现为**桌面版启动后自定义样式闪一下才出现**。
 *
 * @param {string} [themeId]
 * @param {object} [settings] 已规范化的用户设置（与 Web 端 `patchIndex` 同一份）
 * @returns {Array<{ kind: string, placement: string, text?: string, html?: string }>}
 */
export function themeInjections(themeId, settings = {}) {
  return [
    { kind: 'script', placement: 'head', text: themeScopeScript(themeId, settings) },
    { kind: 'html', placement: 'head', html: themeStyleTag({ themeId, settings }) },
  ]
}

/**
 * 给 `<html>` 打上主题 Scope，避免覆盖其它属性。
 *
 * 默认「系统默认」（none）时不给 html 打任何主题属性，保持干净原生；
 * 仅当选择了具体主题时才打上 data-theme-studio 与兼容属性。
 *
 * `data-ts-bg` 与主题属性独立：用户可以在「系统默认」主题下设背景图
 * （此时主题骨架规则一条都不命中，背景直接铺在宿主原生画布上），
 * 所以这个属性不看 themeId，只看 background.mode。
 *
 * @param {string} tag
 * @param {string} [themeId]
 * @param {object} [settings] 已规范化的设置（决定 data-ts-bg）
 * @returns {string}
 */
export function withThemeAttribute(tag, themeId, settings = {}) {
  const id = normalizeThemeId(themeId, DEFAULT_THEME_ID)
  // 三个根属性都由本插件独占，重写前统一剥掉，避免重复或残留旧值。
  const stripped = tag
    .replace(ATTR_RE, '')
    .replace(new RegExp(`\\s*${BACKGROUND_ATTR}\\s*=\\s*(['"]).*?\\1`, 'gi'), '')
    .replace(new RegExp(`\\s*${STATUS_ATTR}\\s*=\\s*(['"]).*?\\1`, 'gi'), '')
  const mode = activeBackgroundMode(settings.background)
  const bgAttr = mode === 'none' ? '' : ` ${BACKGROUND_ATTR}="${mode}"`
  // 状态条特效：默认 none 不写属性（保持 DSH 原生观感，零侵入）。
  const effect = settings.statusEffect ?? DEFAULT_STATUS_EFFECT
  const statusAttr = effect === DEFAULT_STATUS_EFFECT ? '' : ` ${STATUS_ATTR}="${effect}"`
  if (id === 'none') {
    const extra = `${statusAttr}${bgAttr}`
    return extra === '' ? stripped : stripped.replace(/<html/i, `<html${extra}`)
  }
  const theme = getTheme(id)
  const legacy = theme?.legacyId ?? id
  return stripped.replace(
    /<html/i,
    `<html ${THEME_ATTR}="${id}" data-dsh-theme="${legacy}"${statusAttr}${bgAttr}`,
  )
}

/**
 * 把主题 CSS 与 Scope 写入宿主 index.html。
 *
 * @param {string} html
 * @param {{ themeId?: string, settings?: object }} [options]
 * @returns {string}
 */
export function patchIndex(html, options = {}) {
  const style = themeStyleTag(options)
  let output = HTML_TAG_RE.test(html)
    ? html.replace(HTML_TAG_RE, (tag) => withThemeAttribute(tag, options.themeId, options.settings ?? {}))
    : html
  if (STYLE_RE.test(output)) return output.replace(STYLE_RE, style)
  if (/<\/head\s*>/i.test(output)) return output.replace(/<\/head\s*>/i, `${style}</head>`)
  if (/<head\b[^>]*>/i.test(output)) return output.replace(/<head\b[^>]*>/i, `$&${style}`)
  return `${style}${output}`
}

/**
 * 构建设置面板需要的完整视图。
 *
 * `settings` 是**规范化后**的对象：全默认值的字段不落盘、也不会出现在这里
 * （见 `normalizeSettings` 的「不产生噪音字段」约定）。但面板需要稳定的结构，
 * 所以这里额外给出填好默认值的 `effective`——它只用于 UI 渲染，
 * 不会被写回磁盘。
 *
 * @param {object} settings
 * @param {string} settingsPath
 * @returns {object}
 */
export function buildSettingsView(settings, settingsPath) {
  const effective = {
    theme: normalizeThemeId(settings.theme, DEFAULT_THEME_ID),
    statusEffect: settings.statusEffect ?? DEFAULT_STATUS_EFFECT,
    background: { mode: 'none', value: '', file: null, fit: 'cover', opacity: 100, ...(settings.background ?? {}) },
    fonts: { text: '', code: '', ...(settings.fonts ?? {}) },
    fontSizes: { ...(settings.fontSizes ?? {}) },
    fieldColors: { ...(settings.fieldColors ?? {}) },
    glass: { ...(settings.glass ?? {}) },
  }
  return {
    settings,
    effective,
    themes: BUILTIN_THEMES.map(({ id, label, description, surface }) => ({
      id,
      label,
      description,
      surface,
    })),
    fieldColorRoles: FIELD_COLOR_ROLES,
    fontSizeRanges: FONT_SIZE_RANGES,
    fontOptions: {
      text: TEXT_FONT_OPTIONS,
      code: CODE_FONT_OPTIONS,
    },
    // 状态条特效档位清单：面板用小卡片渲染，默认「原生」。
    statusEffects: STATUS_EFFECTS,
    backgroundUrl: backgroundUrl(settings.background?.file),
    backgroundDir: backgroundDir(settingsPath),
    settingsFile: settingsPath,
    limits: {
      maxBackgroundBytes: MAX_BACKGROUND_BYTES,
      backgroundMime: Object.keys(BACKGROUND_MIME),
    },
  }
}

/**
 * 读取 base64 上传体并落盘。
 *
 * 前端把图片读成 data URL 传上来（`data:image/png;base64,...`），
 * 这里拆出 MIME 与字节。不用 multipart：宿主 RPC 的载荷是 JSON，
 * 走 base64 少一层解析依赖。
 *
 * @param {{ dataUrl?: string, mime?: string }} payload
 * @returns {{ mime: string, data: Buffer } | { error: string }}
 */
export function decodeBackgroundUpload(payload) {
  const dataUrl = typeof payload?.dataUrl === 'string' ? payload.dataUrl : ''
  const match = /^data:([a-z0-9.+/-]+);base64,([a-zA-Z0-9+/=\s]+)$/i.exec(dataUrl)
  if (!match) return { error: '背景图必须是 data URL（data:image/png;base64,...）' }
  const mime = match[1].toLowerCase()
  if (!(mime in BACKGROUND_MIME)) {
    return { error: `不支持的图片类型：${mime}，可选 ${Object.keys(BACKGROUND_MIME).join(' / ')}` }
  }
  const data = Buffer.from(match[2], 'base64')
  if (data.length === 0) return { error: '背景图内容为空' }
  if (data.length > MAX_BACKGROUND_BYTES) {
    return { error: `背景图超过上限 ${MAX_BACKGROUND_BYTES / 1024 / 1024}MB` }
  }
  return { mime, data }
}

/**
 * 插件主体。
 *
 * @param {object} ctx Cordis 上下文
 * @param {object} [config] Profile 里的 config 段
 */
export function apply(ctx, config = {}) {
  const settingsPath = resolveSettingsPath(config.settingsFile)
  const isThemeId = (id) => THEME_IDS.includes(id)
  const normalizeOptions = { isThemeId, fontSizeRanges: FONT_SIZE_RANGES }

  // 内存中的当前设置。启动时读盘；读不到就是空设置（全部跟随主题）。
  let current = loadSettings(settingsPath, normalizeOptions)
  let settings = current.settings

  /** 当前生效的主题 id。 */
  const activeThemeId = () => normalizeThemeId(settings.theme, DEFAULT_THEME_ID)

  /** 重新读取设置（外部手改文件后调用）。 */
  const reload = () => {
    current = loadSettings(settingsPath, normalizeOptions)
    settings = current.settings
    return settings
  }

  /**
   * 保存设置。
   * @param {unknown} patch 完整设置或部分补丁
   * @param {{ merge?: boolean }} [opts]
   */
  const save = (patch, opts = {}) => {
    const source = opts.merge === false ? patch : { ...settings, ...(patch && typeof patch === 'object' ? patch : {}) }
    const normalized = normalizeSettings(source, normalizeOptions)
    const result = writeSettingsFile(settingsPath, normalized)
    if (!result.ok) return { ok: false, error: result.error }
    settings = normalized
    return { ok: true, settings }
  }

  // —— 1. 结构化注入行：桌面端 Electron 从 collectIndexInjections() 收集 ——
  // 桌面版**只**走这条路径：主进程 `/` 请求由 Electron 自己读静态文件（见 app.asar 的
  // `serveWebDocument`），不经过 renderIndex / tapIndex，所以 tapIndex 在桌面上一次都不会执行。
  // 必须把 settings 一并带上，否则自定义背景/字体在桌面版首屏会丢失。
  if (typeof ctx.on === 'function') {
    ctx.on('webserver/index-inject', (table) => {
      table.push(...themeInjections(activeThemeId(), settings))
    })
  }

  // —— 2. 传统 tapIndex：Web 端浏览器访问时服务端变换 HTML 直出 ——
  if (ctx.webServer && typeof ctx.webServer.tapIndex === 'function') {
    ctx.effect(
      () => ctx.webServer.tapIndex((html) => patchIndex(html, { themeId: activeThemeId(), settings })),
      'theme-studio: visual tokens',
    )
  }

  // —— 3. 背景图路由 ——
  //
  // 走 `connection.fetch.register()`：这是宿主唯一支持「带鉴权的自定义 HTTP 路由」
  // 的公开入口（`webServer` 没有 `get`，见文件头注释）。它要求精确路径 + 显式
  // 方法列表，并且只在 owner 身份下应答——浏览器用同源 cookie 访问，天然通过。
  //
  // 注册失败必须降级而不是抛错：重复路径会在宿主里 throw，而背景图缺失只是
  // 「背景不显示」，不该连带把主题、设置面板一起拖垮。
  if (ctx.connection?.fetch?.register) {
    try {
      ctx.connection.fetch.register({
        path: BACKGROUND_ROUTE_PATH,
        methods: ['GET', 'HEAD'],
        requestBody: 'buffered',
        fetch: (request) => {
          const file = new URL(request.url, 'http://dsh.local').searchParams.get('file') ?? ''
          const result = readBackgroundImage(settingsPath, file)
          if (!result.ok) {
            return new Response(result.error, {
              status: 404,
              headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
            })
          }
          return new Response(request.method === 'HEAD' ? null : result.data, {
            status: 200,
            headers: {
              'Content-Type': result.mime,
              // 文件名带时间戳（`bg-<stamp>.<ext>`），内容永不原地变化，可以长缓存；
              // 换图必然换文件名，不会看到旧图。
              'Cache-Control': 'private, max-age=31536000, immutable',
              'X-Content-Type-Options': 'nosniff',
            },
          })
        },
      })
    } catch (error) {
      ctx.logger?.warn?.(`theme-studio: 背景图路由注册失败，背景图将不可用（${error?.message ?? error}）`)
    }
  }

  // —— 4. 设置 RPC ——
  if (ctx.connection?.rpc?.handle) {
    ctx.connection.rpc.handle(
      SETTINGS_RPC_CHANNEL,
      async (method, payload) => {
        try {
          if (method === 'describe') {
            return { ok: true, value: buildSettingsView(settings, settingsPath) }
          }
          if (method === 'save') {
            const saved = save(payload?.settings ?? payload ?? {})
            if (!saved.ok) return { ok: false, error: { message: saved.error } }
            return { ok: true, value: buildSettingsView(saved.settings, settingsPath) }
          }
          if (method === 'reset') {
            const saved = save({}, { merge: false })
            if (!saved.ok) return { ok: false, error: { message: saved.error } }
            return { ok: true, value: buildSettingsView(saved.settings, settingsPath) }
          }
          if (method === 'uploadBackground') {
            const decoded = decodeBackgroundUpload(payload)
            if ('error' in decoded) return { ok: false, error: { message: decoded.error } }
            const stored = saveBackgroundImage(settingsPath, decoded)
            if (!stored.ok) return { ok: false, error: { message: stored.error } }
            // 上传成功即切换为图片背景，省掉用户再点一次「应用」
            const next = save(
              { background: { ...settings.background, mode: 'image', file: stored.file } },
              { merge: true },
            )
            if (!next.ok) return { ok: false, error: { message: next.error } }
            return { ok: true, value: buildSettingsView(next.settings, settingsPath) }
          }
          if (method === 'clearBackground') {
            const next = save({ background: { mode: 'none', value: '', file: null } }, { merge: true })
            if (!next.ok) return { ok: false, error: { message: next.error } }
            return { ok: true, value: buildSettingsView(next.settings, settingsPath) }
          }
          if (method === 'reload') {
            reload()
            return { ok: true, value: buildSettingsView(settings, settingsPath) }
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
  }
}
