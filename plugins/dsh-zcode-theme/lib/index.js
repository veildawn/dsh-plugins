/**
 * dsh-zcode-theme —— 兼容薄壳（deprecated）。
 *
 * ZCode 全平台视觉主题已经迁入 **`@weniatall/dsh-theme-studio`** 的内置主题
 * （`zcode` 官方版与 `zcode-mono` 单色极简版），并成为该插件 4 款主题中的两款。
 *
 * ## 为什么保留这个包
 *
 * 已安装本插件的用户升级到新版本时，如果包直接消失，`dsh plugin add` 的依赖
 * 会断掉；更糟的是，如果他们同时装了 theme-studio，两份等价 CSS 会互相覆盖，
 * 排查起来毫无头绪。所以这里保留一个**薄壳**：
 *
 *   - 不复制任何样式表，只把 theme-studio 的产物转发出来；
 *   - 行为与旧版一致：注入 `data-dsh-theme="zcode"` 与等价 CSS；
 *   - 一旦 theme-studio 存在，两者输出**逐字节相同**（同一份 token 与 CSS 源），
 *     因此谁后注入都无所谓——不存在「两套主题打架」。
 *
 * ## 迁移路径
 *
 * ```bash
 * dsh plugin --profile web remove @weniatall/dsh-zcode-theme
 * dsh plugin --profile web add @weniatall/dsh-theme-studio
 * ```
 *
 * 迁移后可在「设置 → 主题工作室」里切换主题、自定义背景与字体。
 *
 * ## 依赖声明
 *
 * `@weniatall/dsh-theme-studio` 是 peerDependency：装本壳必须同时装主题工作室。
 * 这样「薄壳」不会退化成一份需要单独维护的 CSS 副本。
 *
 * @module dsh-zcode-theme
 */

import {
  BUILTIN_THEMES,
  DEFAULT_THEME_ID,
  THEME_ATTR as STUDIO_ATTR,
  backgroundUrl,
  customCss,
  loadSettings,
  patchIndex as studioPatchIndex,
  resolveSettingsPath,
  themeInjections as studioInjections,
  themeStyleTag as studioStyleTag,
  themeVarsCss,
} from '@weniatall/dsh-theme-studio'

/** Cordis 插件名（保持不变，避免 Profile 里的引用失效）。 */
export const name = 'zcode-theme'

/** 本壳固定的主题 id。 */
export const THEME_SCOPE = 'zcode'

/** 旧插件使用的根属性。 */
export const THEME_ATTR = 'data-dsh-theme'

/** 旧插件的样式标签 id（保持稳定：用户浏览器里的旧样式会被精确替换掉）。 */
export const STYLE_ID = 'dsh-zcode-theme'

/** 提示用户迁移（只在宿主日志里打一次，不打扰界面）。 */
const DEPRECATION_NOTICE =
  'dsh-zcode-theme 已并入 @weniatall/dsh-theme-studio（内置主题 zcode / zcode-mono）。' +
  '建议迁移：dsh plugin remove @weniatall/dsh-zcode-theme && dsh plugin add @weniatall/dsh-theme-studio'

/** 取 ZCode 官方主题定义（薄壳只提供这一款）。 */
function zcodeTheme() {
  return BUILTIN_THEMES.find((theme) => theme.id === THEME_SCOPE) ?? BUILTIN_THEMES[0]
}

/**
 * 生成与旧版等价的样式标签，但内容来自 theme-studio。
 *
 * 标签 id 仍是 `dsh-zcode-theme`：这样从旧版升级上来时，旧样式会被同名标签
 * 精确替换，不会出现「两份 CSS 同时存在」。
 *
 * @returns {string}
 */
export function themeStyleTag() {
  return `<style id="${STYLE_ID}">${legacyCss()}</style>`
}

/**
 * 旧版等价的 CSS。
 *
 * 与 theme-studio 的差别只有一处：变量挂在旧属性
 * `html[data-dsh-theme="zcode"]` 上，而不是新属性。其余（组件样式、玻璃层、
 * 自定义层）全部复用主题工作室的产物。
 *
 * @returns {string}
 */
export function legacyCss() {
  const theme = zcodeTheme()
  const css = themeVarsCss(theme)
  const reattributed = css.replaceAll(
    `html[${STUDIO_ATTR}="${theme.id}"]`,
    `html[${THEME_ATTR}="${THEME_SCOPE}"]`,
  )
  return reattributed
}

/**
 * 生成设置根元素属性的内联脚本。
 *
 * 只写旧属性：如果同时装了 theme-studio，由它写新属性；本壳不抢这个职责，
 * 避免两边互相覆盖。
 *
 * @returns {string}
 */
export function themeScopeScript() {
  return `document.documentElement.setAttribute('${THEME_ATTR}', '${THEME_SCOPE}')`
}

/**
 * 结构化 index 注入行（桌面端 Electron 走这条）。
 *
 * @returns {Array<{ kind: string, placement: string, text?: string, html?: string }>}
 */
export function themeInjections() {
  return [
    { kind: 'script', placement: 'head', text: themeScopeScript() },
    { kind: 'html', placement: 'head', html: themeStyleTag() },
  ]
}

/**
 * 给 `<html>` 打上旧属性。
 *
 * @param {string} tag
 * @returns {string}
 */
export function withThemeAttribute(tag) {
  const attr = `${THEME_ATTR}="${THEME_SCOPE}"`
  const stripped = tag.replace(new RegExp(`\\s*${THEME_ATTR}\\s*=\\s*(['"]).*?\\1`, 'gi'), '')
  return stripped.replace(/<html/i, `<html ${attr}`)
}

/**
 * 把样式与属性写入宿主 index.html。
 *
 * @param {string} html
 * @returns {string}
 */
export function patchIndex(html) {
  const style = themeStyleTag()
  let output = /<html\b[^>]*>/i.test(html) ? html.replace(/<html\b[^>]*>/i, withThemeAttribute) : html
  const styleRe = new RegExp(
    `<style\\b[^>]*\\bid\\s*=\\s*(?:"${STYLE_ID}"|'${STYLE_ID}'|${STYLE_ID})[^>]*>[\\s\\S]*?<\\/style>`,
    'i',
  )
  if (styleRe.test(output)) return output.replace(styleRe, style)
  if (/<\/head\s*>/i.test(output)) return output.replace(/<\/head\s*>/i, `${style}</head>`)
  if (/<head\b[^>]*>/i.test(output)) return output.replace(/<head\b[^>]*>/i, `$&${style}`)
  return `${style}${output}`
}

/**
 * 插件主体。
 *
 * 与旧版一样挂 tapIndex 与结构化注入行。若 theme-studio 同时在场，两者都写
 * `data-dsh-theme="zcode"`，值相同，因此不存在冲突。
 *
 * @param {object} ctx
 * @param {object} [config]
 */
export function apply(ctx, config = {}) {
  const warn = ctx?.logger?.warn ?? ctx?.logger?.info
  if (typeof warn === 'function') {
    ctx.effect(() => {
      warn.call(ctx.logger, DEPRECATION_NOTICE)
    }, 'zcode-theme: deprecation notice')
  }

  if (typeof ctx.on === 'function') {
    ctx.on('webserver/index-inject', (table) => {
      table.push(...themeInjections())
    })
  }

  if (ctx.webServer && typeof ctx.webServer.tapIndex === 'function') {
    ctx.effect(() => ctx.webServer.tapIndex(patchIndex), 'zcode-theme: visual tokens (compat shell)')
  }
}

// —— 兼容旧版导出，避免下游 `import { ZAI_PALETTE } from 'dsh-zcode-theme'` 断掉 ——
export {
  BUILTIN_THEMES,
  DEFAULT_THEME_ID,
  FORBIDDEN_COLORS,
  FORBIDDEN_HOST_TOKENS,
  HOST_TOKEN_MAP,
  REQUIRED_HOST_TOKENS,
  STYLE_FILES,
  ZAI_PALETTE,
  backgroundUrl,
  customCss,
  loadSettings,
  resolveSettingsPath,
} from '@weniatall/dsh-theme-studio'

export {
  studioInjections,
  studioPatchIndex,
  studioStyleTag,
}

/** 兼容旧版 loadThemeCss 命名。 */
export const loadThemeCss = legacyCss
