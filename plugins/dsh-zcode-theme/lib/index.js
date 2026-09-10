/**
 * dsh-zcode-theme 宿主半侧。
 * 在 index.html 注入主题 CSS 与 html[data-dsh-theme=zcode]，保证首屏即使用 ZCode 视觉。
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
  ctx.effect(() => ctx.webServer.tapIndex(patchIndex), 'zcode-theme: visual tokens')
}
