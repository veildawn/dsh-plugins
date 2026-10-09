/**
 * dsh-zcode-theme 宿主半侧。
 * 在 index.html 注入主题 CSS 与 html[data-dsh-theme=zcode]，保证首屏即使用 ZCode 视觉。
 * 兼容 Web 端（服务端 HTML 模版直出）与桌面端（Electron 原生外壳 IPC 回放结构化注入行）。
 */
import { loadThemeCss } from './css.js'
import { STYLE_ID, THEME_ATTR, THEME_SCOPE } from './tokens.js'

export const name = 'zcode-theme'
export const inject = ['webServer']

export {
  FORBIDDEN_COLORS,
  FORBIDDEN_HOST_TOKENS,
  HOST_TOKEN_MAP,
  REQUIRED_HOST_TOKENS,
  STYLE_ID,
  THEME_ATTR,
  THEME_SCOPE,
  hostTokenOverrides,
  tokensCss,
  zcodeLightTokens,
  zcodeTokens,
} from './tokens.js'
export { STYLE_FILES, loadThemeCss } from './css.js'

const STYLE_RE = /<style\b[^>]*\bid\s*=\s*(?:"dsh-zcode-theme"|'dsh-zcode-theme'|dsh-zcode-theme)[^>]*>[\s\S]*?<\/style>/i
const HTML_TAG_RE = /<html\b[^>]*>/i

/** 生成带稳定 id 的主题 style 标签。 */
export function themeStyleTag() {
  return `<style id="${STYLE_ID}">${loadThemeCss()}</style>`
}

/** 生成设置根元素主题属性的内联脚本。 */
export function themeScopeScript() {
  return `document.documentElement.setAttribute('${THEME_ATTR}', '${THEME_SCOPE}')`
}

/**
 * 生成结构化 index 注入行。
 * 桌面端（Electron）直接加载打包的静态 index.html，不走服务端的 tapIndex 字符串变换，
 * 而是通过 collectIndexInjections() 获取结构化行并在前端引导层（hM）回放注入。
 */
export function themeInjections() {
  return [
    {
      kind: 'script',
      placement: 'head',
      text: themeScopeScript(),
    },
    {
      kind: 'html',
      placement: 'head',
      html: themeStyleTag(),
    },
  ]
}

/**
 * 给 html 打上主题 Scope，避免覆盖已有属性。
 * @param {string} tag 原始 `<html ...>` 标签
 */
export function withThemeAttribute(tag) {
  const attr = `${THEME_ATTR}="${THEME_SCOPE}"`
  const stripped = tag.replace(new RegExp(`\\s*${THEME_ATTR}\\s*=\\s*(['"]).*?\\1`, 'gi'), '')
  return stripped.replace(/<html/i, `<html ${attr}`)
}

/**
 * 把主题 CSS 与 Scope 写入宿主 index.html。
 * @param {string} html 原始 HTML
 */
export function patchIndex(html) {
  const style = themeStyleTag()
  let output = HTML_TAG_RE.test(html)
    ? html.replace(HTML_TAG_RE, withThemeAttribute)
    : html
  if (STYLE_RE.test(output)) return output.replace(STYLE_RE, style)
  if (/<\/head\s*>/i.test(output)) return output.replace(/<\/head\s*>/i, `${style}</head>`)
  if (/<head\b[^>]*>/i.test(output)) return output.replace(/<head\b[^>]*>/i, `$&${style}`)
  return `${style}${output}`
}

export function apply(ctx) {
  // 1. 结构化注入行：桌面端 Electron 从 collectIndexInjections() 收集并通过 IPC 传递给渲染进程
  if (typeof ctx.on === 'function') {
    ctx.on('webserver/index-inject', (table) => {
      table.push(...themeInjections())
    })
  }

  // 2. 传统 tapIndex 字符串变换：Web 端浏览器访问时直接在服务端变换 HTML 字符串直出
  if (ctx.webServer && typeof ctx.webServer.tapIndex === 'function') {
    ctx.effect(() => ctx.webServer.tapIndex(patchIndex), 'zcode-theme: visual tokens')
  }
}
