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
 * 3. **背景图路由**：`GET /api/dsh-theme-studio/background/<file>` 回传图片字节。
 *    不把图片塞进 CSS 的 data URI：8MB 的图 base64 后是 11MB 的内联样式，
 *    每次首屏都要重新传输，还会卡住解析。
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

import { THEME_ATTR, STYLE_ID, themeVarsCss } from './tokens.js'
import { BUILTIN_THEMES, DEFAULT_THEME_ID, THEME_IDS, getTheme, normalizeThemeId } from './themes/index.js'
import { fullThemeCss } from './css.js'
import {
  BACKGROUND_MIME,
  FIELD_COLOR_ROLES,
  MAX_BACKGROUND_BYTES,
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

/** 背景图 HTTP 前缀。 */
export const BACKGROUND_ROUTE_PREFIX = '/api/dsh-theme-studio/background/'

/** 字体号的取值范围（与宿主 ui-theme 的 FONT_SIZE_SPECS 对齐）。 */
export const FONT_SIZE_RANGES = Object.freeze({
  text: { min: 10, max: 22 },
  code: { min: 10, max: 16 },
  terminal: { min: 10, max: 20 },
})

export { THEME_ATTR, STYLE_ID, THEME_IDS, BUILTIN_THEMES, DEFAULT_THEME_ID, getTheme, normalizeThemeId }
export { FIELD_COLOR_ROLES, FONT_SIZE_RANGES as FONT_SIZES }
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
export { composeThemeCss, fullThemeCss, readStyleFile, STYLE_FILES, GLASS_STYLE_FILE } from './css.js'
export { customCss as buildCustomCss } from './settings.js'

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
 * @param {string} [themeId]
 * @returns {string}
 */
export function themeScopeScript(themeId) {
  const id = normalizeThemeId(themeId, DEFAULT_THEME_ID)
  if (id === 'none') {
    return (
      `document.documentElement.removeAttribute('${THEME_ATTR}');` +
      `document.documentElement.removeAttribute('data-dsh-theme');`
    )
  }
  const theme = getTheme(id)
  const legacy = theme?.legacyId ?? id
  return (
    `document.documentElement.setAttribute('${THEME_ATTR}', ${JSON.stringify(id)});` +
    `document.documentElement.setAttribute('data-dsh-theme', ${JSON.stringify(legacy)});`
  )
}

/**
 * 生成结构化 index 注入行（桌面端 Electron 走这条路径）。
 *
 * @param {string} [themeId]
 * @returns {Array<{ kind: string, placement: string, text?: string, html?: string }>}
 */
export function themeInjections(themeId) {
  return [
    { kind: 'script', placement: 'head', text: themeScopeScript(themeId) },
    { kind: 'html', placement: 'head', html: themeStyleTag({ themeId }) },
  ]
}

/**
 * 给 `<html>` 打上主题 Scope，避免覆盖其它属性。
 *
 * 默认「系统默认」（none）时不给 html 打任何主题属性，保持干净原生；
 * 仅当选择了具体主题时才打上 data-theme-studio 与兼容属性。
 *
 * @param {string} tag
 * @param {string} [themeId]
 * @returns {string}
 */
export function withThemeAttribute(tag, themeId) {
  const id = normalizeThemeId(themeId, DEFAULT_THEME_ID)
  const stripped = tag.replace(ATTR_RE, '')
  if (id === 'none') {
    return stripped
  }
  const theme = getTheme(id)
  const legacy = theme?.legacyId ?? id
  return stripped.replace(
    /<html/i,
    `<html ${THEME_ATTR}="${id}" data-dsh-theme="${legacy}"`,
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
    ? html.replace(HTML_TAG_RE, (tag) => withThemeAttribute(tag, options.themeId))
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
  if (typeof ctx.on === 'function') {
    ctx.on('webserver/index-inject', (table) => {
      table.push(...themeInjections(activeThemeId()))
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
  if (ctx.webServer && typeof ctx.webServer.get === 'function') {
    ctx.webServer.get(`${BACKGROUND_ROUTE_PREFIX}:file`, (req, res) => {
      const file = String(req?.params?.file ?? '')
      const result = readBackgroundImage(settingsPath, decodeURIComponent(file))
      if (!result.ok) {
        res.statusCode = 404
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end(result.error)
        return
      }
      res.statusCode = 200
      res.setHeader('Content-Type', result.mime)
      res.setHeader('Cache-Control', 'public, max-age=3600')
      res.end(result.data)
    })
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
