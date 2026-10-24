/**
 * 主题 CSS 装配与文件读取。
 *
 * 输出顺序是这个插件最关键的不变式，写在这里而不是散落在各处：
 *
 *   1. `baseTone`   —— `color-scheme` 与 shiki 变量这类「无主题」的基础声明；
 *   2. `themeVars`  —— 当前主题的 `--color-*` / `--dsw-*` / `--ts-*` 变量；
 *   3. `styles`     —— 组件级规则（frame / chat / composer …），引用上面的变量；
 *   4. `glass`      —— 玻璃材质层，只在玻璃主题下命中；
 *   5. `aurora`     —— 极光动效层，只在极光主题下命中（必须排在 4 之后）；
 *   6. `custom`     —— 用户自定义（背景、字体、字段色），**必须最后**，
 *                      这样它才能压过主题内置值。
 *
 * 把顺序写死在 `composeThemeCss()` 里，任何新增样式表只能插到 3（组件层），
 * 不能越过 6——否则「用户设置优先级最高」这条契约就破了。
 *
 * @module dsh-theme-studio/css
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { THEME_ATTR, themeVarsCss } from './tokens.js'
import { BUILTIN_THEMES, getTheme } from './themes/index.js'
import { adaptCssToHost, detectHostModules } from './host-modules.js'
import { HOST_CLASS_SLOTS } from './host-class-slots.js'

/**
 * 组件级样式表的加载顺序。
 *
 * 顺序有意义：`reset` 先铺底，`surfaces`/`frame` 定层级，`typography` 在
 * 组件之前（否则组件里的字号会被正文规则覆盖），`motion` 最后覆盖一切。
 *
 * `background.css` 必须排在 `glass.css` **之后**：它要在玻璃材质定好之后
 * 才有资格调整 `.centerCol` 的填充（否则会被玻璃规则反向压掉），
 * 见该文件头部注释。
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
  'plugins.css',
  'chips.css',
  'code.css',
  'terminal.css',
  'modal.css',
  'settings.css',
  'states.css',
  'status.css',
  'motion.css',
]

/** 玻璃材质层单独一份：它只在玻璃主题下命中，不该混进组件层。 */
export const GLASS_STYLE_FILE = 'glass.css'

/**
 * 极光流光的动效层。
 *
 * 与玻璃同属「主题专属样式」：只在 `html[data-theme-studio="aurora"]` 下命中，
 * 因此可以像玻璃层一样**始终包含**在产物里——切换主题只是换 html 上的属性值，
 * 不需要重新注入整份样式表。这是本插件「切换零成本」契约的一部分。
 *
 * 为什么不能塞进 `STYLE_FILES`：那一层是**所有主题共用**的组件样式，
 * 每款主题都会加载。把 `@keyframes` 与 `body::before` 光斑放进去，
 * ZCode 用户也会白白下载 200 行永不命中的规则。
 */
export const AURORA_STYLE_FILE = 'aurora.css'

/**
 * 用户自定义背景的让位层。
 *
 * 单独一份而不是塞进 `STYLE_FILES`：它必须排在玻璃材质层**之后**，而
 * `STYLE_FILES` 整体排在玻璃层之前。装配顺序见 `composeThemeCss()`。
 */
export const BACKGROUND_STYLE_FILE = 'background.css'

/**
 * 磁盘上全部样式表，**按装配顺序**排列。
 *
 * 测试用它遍历 `lib/styles/`，保证「目录里有的都在清单里，清单里有的都在目录里」
 * 这条不变式不会因为新增一份样式表而悄悄失效。
 */
export const ALL_STYLE_FILES = Object.freeze([
  ...STYLE_FILES,
  GLASS_STYLE_FILE,
  AURORA_STYLE_FILE,
  BACKGROUND_STYLE_FILE,
])

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
 * 宿主 CSS Modules 索引的进程级缓存。
 *
 * 探测要读遍宿主 54 个 bundle（asar 里 18000+ 条目），只在进程首启做一次；
 * 宿主换了构建必然重启 dsh，那时缓存自然失效，不需要文件监听。
 *
 * @type {{ slots: Map<string, string>, owners: Map<string, Set<string>> } | undefined}
 */
let hostIndexCache

/**
 * 取当前宿主的 CSS Modules 索引（只探测一次）。
 *
 * @param {{ refresh?: boolean, roots?: string[] }} [options]
 * @returns {{ slots: Map<string, string>, owners: Map<string, Set<string>> }}
 */
export function hostModuleIndex(options = {}) {
  if (options.refresh === true) hostIndexCache = undefined
  if (hostIndexCache === undefined) {
    try {
      hostIndexCache = detectHostModules(options)
    } catch {
      // 探测失败必须退化而不是抛错：主题的首要职责是把写死在 CSS 里的那几套
      // 哈希原样交付，自适应层只是增量。
      hostIndexCache = { slots: new Map(), owners: new Map() }
    }
  }
  return hostIndexCache
}

/**
 * 把一份样式表按当前宿主补全类名。
 *
 * @param {string} css
 * @param {{ slots: Map<string, string>, owners: Map<string, Set<string>> }} [index]
 * @returns {string}
 */
export function adaptStyleCss(css, index) {
  const resolved = index ?? hostModuleIndex()
  return adaptCssToHost(css, resolved, HOST_CLASS_SLOTS).css
}

/** 组件层样式表的缓存（读盘 + 自适应改写后）。 */
let styleFilesCache

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
 * 组件层与玻璃层的读取 + 自适应改写结果（进程内缓存一次）。
 *
 * 首屏直出每次请求都要拼一份完整样式表，不缓存的话每次都要重新读 16 个文件并做
 * 一遍正则改写。宿主映射在进程生命周期内不变（换构建必然重启），所以缓存安全。
 *
 * @returns {{ files: string[], glass: string, aurora: string, background: string }}
 */
function adaptedStyleLayers() {
  if (styleFilesCache === undefined) {
    const index = hostModuleIndex()
    styleFilesCache = {
      files: STYLE_FILES.map((name) => adaptStyleCss(readStyleFile(name), index)),
      glass: adaptStyleCss(readStyleFile(GLASS_STYLE_FILE), index),
      aurora: adaptStyleCss(readStyleFile(AURORA_STYLE_FILE), index),
      background: adaptStyleCss(readStyleFile(BACKGROUND_STYLE_FILE), index),
    }
  }
  return styleFilesCache
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

  // 用户自定义层**不参与**宿主自适应：它只由颜色/字体组成的白名单值构成，
  // 一旦混进正则改写，任何形如 `xxx_yyy` 的合法字体名都可能被误当成模块类名。
  const layers = adaptedStyleLayers()
  const files = layers.files
  const glass = layers.glass
  const aurora = layers.aurora
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
      glass,
      aurora,
      layers.background,
      options.custom ?? '',
    ].join('\n')
  }

  return [
    themeVarsCss(theme, { extraDeclarations: base }),
    legacyVarsCss(theme),
    files.join('\n'),
    // 玻璃材质层始终包含：它在选择器里自带主题限定，非玻璃主题下不命中任何元素。
    // 这样避免「先选 ZCode 再切玻璃」时需要重新注入整份样式表。
    glass,
    // 极光动效层同理：只在 `html[data-theme-studio="aurora"]` 下命中。
    // 它必须排在玻璃层**之后**——极光沿用玻璃的表面结构，但把其中几条
    // （内容卡填充、顶栏材质）改写成自己的取值；反过来排会被玻璃压回去。
    aurora,
    // 让位层同样始终包含：它由 `html[data-ts-bg]` 开关，没设背景时不命中。
    layers.background,
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
