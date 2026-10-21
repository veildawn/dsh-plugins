/**
 * 主题 CSS 装配与文件读取。
 *
 * 输出顺序是这个插件最关键的不变式，写在这里而不是散落在各处：
 *
 *   1. `baseTone`   —— `color-scheme` 与 shiki 变量这类「无主题」的基础声明；
 *   2. `themeVars`  —— 当前主题的 `--color-*` / `--dsw-*` / `--ts-*` 变量；
 *   3. `styles`     —— 组件级规则（frame / chat / composer …），引用上面的变量；
 *   4. `glass`      —— 玻璃材质层，只在玻璃主题下命中；
 *   5. `custom`     —— 用户自定义（背景、字体、字段色），**必须最后**，
 *                      这样它才能压过主题内置值。
 *
 * 把顺序写死在 `composeThemeCss()` 里，任何新增样式表只能插到 3（组件层），
 * 不能越过 5——否则「用户设置优先级最高」这条契约就破了。
 *
 * @module dsh-theme-studio/css
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { THEME_ATTR, themeVarsCss } from './tokens.js'
import { BUILTIN_THEMES, getTheme } from './themes/index.js'

/**
 * 组件级样式表的加载顺序。
 *
 * 顺序有意义：`reset` 先铺底，`surfaces`/`frame` 定层级，`typography` 在
 * 组件之前（否则组件里的字号会被正文规则覆盖），`motion` 最后覆盖一切。
 */
export const STYLE_FILES = [
  'reset.css',
  'surfaces.css',
  'frame.css',
  'typography.css',
  'navigation.css',
  'sidebar.css',
  'chat.css',
  'composer.css',
  'buttons.css',
  'chips.css',
  'code.css',
  'terminal.css',
  'modal.css',
  'states.css',
  'motion.css',
]

/** 玻璃材质层单独一份：它只在玻璃主题下命中，不该混进组件层。 */
export const GLASS_STYLE_FILE = 'glass.css'

/** 样式目录的绝对路径。 */
export function stylesDir() {
  return join(dirname(fileURLToPath(import.meta.url)), 'styles')
}

/**
 * 读取一份样式表。
 *
 * @param {string} name
 * @returns {string}
 */
export function readStyleFile(name) {
  return readFileSync(join(stylesDir(), name), 'utf8')
}

/**
 * 基础声明：与主题无关，但必须在变量之前就位。
 *
 * **刻意不写 `color-scheme`**：宿主在 `html` 上按当前偏好写入 `light` / `dark`，
 * `light-dark()` 只认最近的 `color-scheme` 祖先。这里一旦写 `light dark`，
 * 取值会退回跟随操作系统偏好——应用是暗色、系统却是亮色时，主题色全部解析到
 * 亮色侧，与宿主已成对写入的暗色 Token 打架。
 *
 * 返回的是**声明列表**（不含选择器与花括号），由 `themeVarsCss()` 合并进同一个
 * `html[attr]` 块。早先的实现自己输出一个完整的 `html[attr] { }`，结果同一份
 * CSS 里出现两个同名选择器块——功能上无害（CSS 会合并），但排查时容易误判
 * 「变量怎么没进那个块」。合成一块后，用 grep 定位选择器时不会再被空壳块干扰。
 *
 * @returns {string[]} 每项是一条声明（含行首缩进）
 */
export function baseToneDeclarations() {
  return [
    '  /* Shiki 代码高亮默认前景与注释色，跟随主题前景阶梯 */',
    '  --shiki-foreground: var(--color-foreground);',
    '  --shiki-token-comment: var(--color-foreground-subtle);',
  ]
}

/**
 * 兼容层：`html[data-theme-studio="<id>"]` 之外再挂一份旧属性
 * `html[data-dsh-theme="zcode"]`，让仍在读旧属性的消费者
 * （dsh-mobile-adapter 的移动端规则等）继续工作。
 *
 * 只对声明了 `legacyId` 的主题生成。
 *
 * @param {object} theme
 * @returns {string}
 */
export function legacyVarsCss(theme) {
  if (!theme.legacyId) return ''
  const css = themeVarsCss(theme)
  const attributed = css.replace(
    `html[${THEME_ATTR}="${theme.id}"]`,
    `html[data-dsh-theme="${theme.legacyId}"]`,
  )
  return attributed
}

/**
 * 装配某一个主题的完整 CSS。
 *
 * @param {string} themeId
 * @param {{ custom?: string, includeAllThemes?: boolean }} [options]
 *   - `custom`：用户自定义层，追加在最后；
 *   - `includeAllThemes`：为 true 时输出全部主题（切换时无需重新注入），
 *     为 false 时只输出指定主题（首屏按已保存主题直出，体积更小）。
 * @returns {string}
 */
export function composeThemeCss(themeId, options = {}) {
  const theme = getTheme(themeId)
  if (!theme) throw new Error(`未知主题 "${themeId}"`)

  const files = STYLE_FILES.map(readStyleFile)
  // shiki 基础声明并入主题变量块，避免产出两个同名的 html[attr] 选择器块。
  const base = baseToneDeclarations()

  if (options.includeAllThemes) {
    // 全部主题的变量块都输出：每块都带自己的 id 选择器，同一时刻只有一块命中，
    // 因此切换主题只是换 html 上的属性值，不需要重新插入样式表。
    const vars = BUILTIN_THEMES.map((item) => {
      // 基础声明只挂在当前主题上即可：它是 `var(--color-*)` 引用，
      // 只要当前主题块命中就生效，其它主题块不需要重复一份。
      const extra = item.id === theme.id ? base : []
      return `${themeVarsCss(item, { extraDeclarations: extra })}${legacyVarsCss(item)}`
    }).join('\n')
    return [
      vars,
      files.join('\n'),
      readStyleFile(GLASS_STYLE_FILE),
      options.custom ?? '',
    ].join('\n')
  }

  return [
    themeVarsCss(theme, { extraDeclarations: base }),
    legacyVarsCss(theme),
    files.join('\n'),
    // 玻璃材质层始终包含：它在选择器里自带主题限定，非玻璃主题下不命中任何元素。
    // 这样避免「先选 ZCode 再切玻璃」时需要重新注入整份样式表。
    readStyleFile(GLASS_STYLE_FILE),
    options.custom ?? '',
  ].join('\n')
}

/**
 * 主题 CSS 里真正被 `var(--color-*)` 引用到的语义键。
 *
 * 用于裁剪变量输出：宿主不读 `--color-*`，只有主题 CSS 引用的那些才需要落地，
 * 其余写出来是死变量。完整色板仍在色板模块里，由快照测试守护。
 *
 * @param {string[]} sources
 * @returns {string[]}
 */
export function referencedColorNames(sources) {
  const names = new Set()
  for (const text of sources) {
    for (const match of text.matchAll(/var\(--color-([a-z0-9-]+)/g)) names.add(match[1])
  }
  return [...names]
}

/**
 * 生成设置面板用的完整样式（全部主题 + 空自定义层）。
 * 首屏注入用这个：一次注入，之后切换主题零成本。
 *
 * @param {string} activeId
 * @param {string} [custom]
 * @returns {string}
 */
export function fullThemeCss(activeId, custom = '') {
  return composeThemeCss(activeId, { includeAllThemes: true, custom })
}
