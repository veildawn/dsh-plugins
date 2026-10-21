/**
 * 主题工作室的统一 Token 契约。
 *
 * 三层结构，任一层都可独立扩展，主题作者只需关心最上面一层：
 *
 *   1. 语义层 `--color-*`：主题唯一需要提供的东西。键名沿用 ZCode 官方
 *      `--color-<key>` 的 kebab 名，读代码时可以直接和上游 styles.css 对照。
 *      新增一款主题 = 提供一份 `{ key: { light, dark } }` 色板，不改任何映射代码。
 *
 *   2. 宿主层 `--dsw-*`：DSH 宿主组件实际消费的语义别名。由 `HOST_TOKEN_MAP`
 *      从语义层派生——**一份映射服务全部主题**，这是「统一 Token」的核心：
 *      主题之间不复制映射表，只换色板。
 *
 *   3. 兼容层：仓库内各社区插件实际引用、但宿主 design-platform 并未定义的
 *      别名（`--dsw-alias-background-base`、`--dsw-alias-border-default` 等）
 *      以及字体 / 圆角 / 阴影 / 模糊这类材质 Token。插件写法是
 *      `var(--dsw-alias-border-default, var(--dsw-alias-border-l2))`，宿主没有
 *      这个变量时会回落到硬编码值甚至 `#fff`，主题就管不到它。显式定义这些
 *      别名后，插件的所有表面都会跟随主题——这是「对所有插件兼容」的落地方式。
 *
 * 设计约束（与 dsh-zcode-theme 的历史契约一致）：
 *   - 每个色值都必须是 `{ light, dark }` 成对值，宿主 `ThemeRuntime.overrideTokens`
 *     与 CSS `light-dark()` 都要求成对，避免切换明暗时出现不可读组合。
 *   - 主题 CSS 只引用 `--color-*` / `--ts-*`，绝不硬编码色值。
 */

/** 主题切换作用的根属性。`html[data-theme-studio="<id>"]`。 */
export const THEME_ATTR = 'data-theme-studio'

/** 主题 CSS 与客户端脚本共用的稳定 id。 */
export const STYLE_ID = 'dsh-theme-studio'

/** overrideTokens 的层标识（一个 source 对应一层，重复调用即替换）。 */
export const TOKEN_SOURCE = 'dsh-theme-studio'

/** 兼容旧插件的根属性：dsh-zcode-theme 时代的产物，薄壳继续沿用。 */
export const LEGACY_THEME_ATTR = 'data-dsh-theme'

/**
 * 宿主不存在、主题 CSS / JS 禁止引用的 Token。
 * 排坑：宿主从未定义 `--dsw-alias-bg-inverse` / `--dsw-alias-label-inverse`。
 */
export const FORBIDDEN_HOST_TOKENS = ['--dsw-alias-bg-inverse', '--dsw-alias-label-inverse']

/** 宿主默认品牌蓝，以及 ZCode 早期自拟的暖橙红：主题产物中不得残留。 */
export const FORBIDDEN_COLORS = [
  '#4d6bfe',
  '#4D6BFE',
  '#E85D3A',
  '#F06A35',
  '#F06A48',
  '#D14F2E',
  'rgba(232,93,58',
  'rgba(232, 93, 58',
]

/** 规范要求覆盖的宿主 Token（测试守护，缺一即主题漏色）。 */
export const REQUIRED_HOST_TOKENS = [
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-module-platform',
  '--dsw-specific-sidebar-fill',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-brand-primary',
  '--dsw-alias-button-primary-fill',
  '--dsw-alias-brand-subtle',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-interactive-bg-hover-solid',
  '--dsw-alias-markdown-code-block',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-code-diff-added',
  '--dsw-alias-code-diff-deleted',
]

/**
 * 宿主 `--dsw-*` → 语义键的映射。**一份服务全部主题。**
 *
 * 值写成语义键名字符串（不是色值），由 `buildHostTokens()` 在生成阶段按当前
 * 主题查表解析。这样新增主题时映射零改动，也不会出现某款主题漏映射。
 */
const HOST_KEY_MAP = {
  // —— 背景层级 ——
  '--dsw-alias-bg-base': 'background',
  '--dsw-alias-bg-layer-1': 'panel',
  '--dsw-alias-bg-layer-2': 'card',
  '--dsw-alias-bg-layer-3': 'input',
  '--dsw-alias-bg-layer-4': 'menu-hover',
  // 显式补齐：宿主有组件直接 var() 引用，但 design-platform CSS 里没定义，
  // 不覆盖就会回落到宿主默认蓝板，导致主题局部漏色。
  '--dsw-alias-bg-l1': 'background',
  '--dsw-alias-fill-l1': 'surface',
  '--dsw-alias-fill-l2': 'surface-hover',
  '--dsw-alias-fill-tsp-secondary': 'secondary',
  '--dsw-alias-bg-module-platform': 'input',
  '--dsw-alias-bg-overlay': 'card',
  '--dsw-alias-bg-multi-select': 'secondary',
  '--dsw-alias-bg-skeleton': 'surface',
  '--dsw-alias-bg-mask-1': 'background-win-alt',
  '--dsw-alias-bg-mask-2': 'surface',
  '--dsw-alias-bg-mask-3': 'background-win-alt',
  '--dsw-alias-bg-mask-photo': 'background-win-alt',
  '--dsw-alias-bg-mask-drop': 'background',
  '--dsw-alias-bg-document-preview': 'panel',
  '--dsw-alias-bg-document-selection': 'bg-document-selection',
  '--dsw-alias-label-document-preview': 'foreground-subtle',

  // —— 侧边栏 / 社区面板 ——
  '--dsw-specific-sidebar-fill': 'sidebar',
  '--dsw-specific-sidebar-nav-item-active': 'input',
  '--dsw-specific-sidebar-nav-item-active-accent': 'foreground',
  '--dsw-specific-sidebar-nav-item-hover': 'surface',
  '--dsw-specific-input-major': 'input',
  '--dsw-specific-login-input': 'panel',
  '--dsw-specific-bubble': 'card',
  '--dsw-specific-bubble-highlight': 'primary',
  '--dsw-specific-menu': 'menu',
  '--dsw-specific-tip': 'tooltip',
  '--dsw-specific-selector': 'secondary',
  '--dsw-alias-menu-group-header-fill': 'panel',

  // —— 文字 ——
  '--dsw-alias-label-primary': 'foreground',
  '--dsw-alias-label-secondary': 'foreground-subtle',
  '--dsw-alias-label-tertiary': 'foreground-subtlest',
  '--dsw-alias-label-caption': 'foreground-subtlest',
  '--dsw-alias-label-quaternary': 'foreground-subtlest',
  '--dsw-alias-label-dimmed': 'foreground-subtlest',
  '--dsw-alias-label-primary-dimmed': 'foreground-subtle',
  '--dsw-alias-label-primary-bluish': 'foreground',
  '--dsw-alias-label-primary-inverted': 'primary-foreground',
  '--dsw-alias-label-primary-foreground': 'primary-foreground',
  '--dsw-alias-label-shimmer': 'foreground-subtlest',
  '--dsw-alias-label-deep-diving': 'foreground',
  '--dsw-alias-label-deep-diving-shimmer': 'foreground-subtle',
  '--dsw-alias-label-error': 'destructive',
  '--dsw-alias-menu-icon': 'foreground-subtle',

  // —— 品牌与主操作 ——
  '--dsw-alias-brand-primary': 'brand',
  '--dsw-alias-brand-text': 'brand',
  '--dsw-alias-brand-subtle': 'surface',
  '--dsw-alias-brand-primary-invert': 'primary-foreground',
  '--dsw-alias-brand-primary-new-colorprimary-new-color': 'brand',
  '--dsw-alias-button-primary-fill': 'primary',
  '--dsw-alias-button-primary-hover': 'primary',
  '--dsw-alias-button-primary-dimmed': 'secondary',
  '--dsw-alias-button-info-fill': 'primary',
  '--dsw-alias-button-info-hover': 'primary',
  '--dsw-alias-button-contrast-fill': 'primary',
  '--dsw-alias-button-elevated-fill': 'card',
  '--dsw-alias-button-floating-fill': 'card',
  '--dsw-alias-button-floating-hover': 'menu-hover',
  '--dsw-alias-button-ghost-active-fill': 'secondary',
  '--dsw-alias-button-ghost-active-hover': 'menu-hover',
  '--dsw-alias-button-ghost-active-border': 'border',
  '--dsw-alias-button-tool-bar-fill': 'surface-hover',
  '--dsw-alias-button-tool-bar-fill-invisible': 'surface',
  '--dsw-alias-button-tool-bar-hover': 'surface-hover',
  '--dsw-alias-switch-thumb': 'primary-foreground',

  // —— 静态色（宿主历史组件按名字取色）——
  '--dsw-static-deepseek-200': 'foreground',
  '--dsw-static-deepseek-400': 'foreground-subtle',
  '--dsw-static-deepseek-450': 'foreground-subtle',
  '--dsw-static-deepseek-500': 'foreground-subtle',

  // —— 边框 ——
  '--dsw-alias-border-l1': 'border',
  '--dsw-alias-border-l2': 'border-hover',
  '--dsw-alias-border-l2-darkmode-thin': 'border',
  '--dsw-alias-border-l3': 'border-hover',
  '--dsw-alias-border-l4': 'border-hover',
  '--dsw-alias-border-inverted': 'surface',
  '--dsw-alias-border-inverted2': 'surface',
  '--dsw-alias-separator-primary': 'border',

  // —— 交互态 ——
  '--dsw-alias-interactive-bg-hover': 'surface',
  '--dsw-alias-interactive-bg-hover-solid': 'surface-hover',
  '--dsw-alias-interactive-bg-hover-accent': 'surface-hover',
  '--dsw-alias-interactive-bg-hover-danger': 'destructive-surface',
  '--dsw-alias-interactive-bg-active': 'surface-hover',

  // —— 状态 ——
  '--dsw-alias-state-business-primary': 'brand',
  '--dsw-alias-state-business-tertiary': 'surface',
  '--dsw-alias-state-success-primary': 'success',
  '--dsw-alias-state-success-secondary': 'success-surface-foreground',
  '--dsw-alias-state-success-tertiary': 'success-surface',
  '--dsw-alias-state-warn-primary': 'warning',
  '--dsw-alias-state-warn-secondary': 'warning-surface-foreground',
  '--dsw-alias-state-warn-tertiary': 'warning-surface',
  '--dsw-alias-state-warn-label': 'warning-surface-foreground',
  '--dsw-alias-state-error-primary': 'destructive',
  '--dsw-alias-state-error-secondary': 'destructive-surface',
  '--dsw-alias-state-idle-primary': 'idle-task',

  // —— 代码与 Markdown ——
  '--dsw-alias-markdown-code-block': 'background',
  '--dsw-alias-markdown-code-block-banner': 'panel',
  '--dsw-alias-markdown-inline-code': 'markdown-inline-code',
  '--dsw-alias-markdown-citation': 'panel',
  '--dsw-alias-markdown-tag': 'tag',
  '--dsw-alias-markdown-placeholder': 'secondary',
  '--dsw-alias-markdown-code-segment-selected': 'panel',
  '--dsw-alias-markdown-code-segment-unselected': 'secondary',
  '--dsw-alias-code-diff-added': 'code-diff-added',
  '--dsw-alias-code-diff-deleted': 'code-diff-deleted',
  '--dsw-alias-file-diff-added-bg': 'file-diff-added-bg',
  '--dsw-alias-file-diff-added-gutter': 'file-diff-added-gutter',
  '--dsw-alias-file-diff-added-marker': 'file-diff-added-marker',
  '--dsw-alias-file-diff-deleted-bg': 'file-diff-deleted-bg',
  '--dsw-alias-file-diff-deleted-gutter': 'file-diff-deleted-gutter',
  '--dsw-alias-file-diff-deleted-marker': 'file-diff-deleted-marker',
  '--dsw-alias-turn-trigger-bg': 'background',
  '--dsw-alias-turn-trigger-bg-hover': 'surface',

  // —— 浮层 ——
  '--dsw-alias-toast-bg': 'toast',
  '--dsw-alias-toast-label': 'foreground',
  '--dsw-alias-tooltip-bg': 'tooltip',
  '--dsw-alias-tooltip-key-bg': 'tooltip-tag',
  '--dsw-alias-link': 'brand',
  '--dsw-alias-onboarding-accent': 'brand',
  '--dsw-alias-onboarding-card-fill': 'card',
  '--dsw-alias-onboarding-secondary-fill': 'secondary',
  '--dsw-alias-onboarding-checkbox-border': 'border-hover',
  '--dsw-alias-settings-card-fill': 'card',
  '--dsw-alias-settings-card-stroke': 'border-hover',
  '--dsw-hovercard-bg': 'card',

  // —— 滚动条 ——
  '--dsw-alias-scrollbar-bg-l1': 'secondary',
  '--dsw-alias-scrollbar-bg-l2': 'secondary',
  '--dsw-alias-scrollbar-hover-l1': 'menu-hover',
  '--dsw-alias-scrollbar-hover-l2': 'menu-hover',

  // —— 焦点环 ——
  '--dsw-focus-ring-color': 'foreground',
}

/**
 * 仓库内插件实际引用、但宿主 design-platform **未定义**的别名。
 *
 * 逐个来自各插件 `lib/client.js` 的 `var(--dsw-...)` 扫描结果。插件写法通常带
 * fallback（`var(--dsw-alias-border-default, var(--dsw-alias-border-l2))`），
 * 宿主没有该变量时才会回落到 fallback；一旦我们定义了它，插件的表面、输入框、
 * 卡片会立刻跟随当前主题，而不是停在某个硬编码的 `#fff` / `#d0d7de`。
 *
 * 这张表由 `test/plugin-compat.test.mjs` 守护：仓库里出现任何新的 `--dsw-*`
 * 引用而这里与 HOST_KEY_MAP 都没覆盖，测试即失败。
 */
const PLUGIN_ALIAS_MAP = {
  // 表面：插件把 `--dsw-alias-background-*` 当作「普通背景」使用
  '--dsw-alias-background-base': 'panel',
  '--dsw-alias-background-surface': 'card',
  '--dsw-alias-background-subtle': 'surface',
  '--dsw-alias-background-muted': 'secondary',
  '--dsw-alias-background-overlay': 'card',
  '--dsw-alias-surface-l2': 'card',
  '--dsw-alias-interactive-bg-subtle': 'surface',
  // 边框：插件自绘卡片 / 输入框
  '--dsw-alias-border-default': 'border-hover',
  '--dsw-alias-border-subtle': 'border',
  // 状态：插件用的是 warning 而不是宿主真实的 warn
  '--dsw-alias-state-warning-primary': 'warning',
  '--dsw-alias-status-warning': 'warning',
  '--dsw-alias-bg-warning': 'warning-surface',
}

/**
 * 材质 Token：字体栈、字号阶梯、圆角、阴影、毛玻璃参数。
 *
 * 与颜色一样按主题区分——玻璃主题需要更大的圆角、真实的模糊半径与双层轮廓光，
 * ZCode 主题则必须保持官方 6px 面板圆角与发丝边。主题作者只覆盖需要改的键，
 * 其余取 `MATERIAL_DEFAULTS`。
 */
export const MATERIAL_DEFAULTS = {
  '--dsw-font-family':
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", ' +
    '"Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", "Helvetica Neue", Helvetica, Arial, sans-serif',
  '--ds-font-family-code':
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", ' +
    '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", monospace',
  // 插件实际引用的字体别名
  '--dsw-font-family-mono': 'var(--ds-font-family-code)',
  '--dsw-font-mono': 'var(--ds-font-family-code)',
  '--dsw-font-code': 'var(--ds-font-family-code)',
  // 半径：宿主真实存在的四档 + 插件使用的别名
  '--dsw-radius-xs': '4px',
  '--dsw-radius-sm': '8px',
  '--dsw-radius-md': '12px',
  '--dsw-radius-lg': '16px',
  '--dsw-radius-xl': '20px',
  '--dsw-radius-panel': '28px',
  '--dsw-radius-s': '8px',
  '--dsw-radius-m': '12px',
  '--dsw-radius-l': '16px',
  '--dsw-radius-pill': '999px',
  // 字体简写：宿主在 body 上定义了整套 `--dsw-font-*`（`<weight> <size>/<lh> <family>`），
  // 插件直接 `font: var(--dsw-font-s-14)` 取用。它们内部引用
  // `var(--dsw-font-family)`，因此用户自定义字体通过这一层自动传导到所有插件。
  //
  // 这里必须显式重定义：宿主的简写是**编译期字面量**，不会因为
  // `--dsw-font-family` 变了就自动重算（它展开成 `500 20px/28px var(--dsw-font-family)`，
  // 其中 family 部分确实会跟随，但 size/line-height 不会）。重定义后我们还能让
  // 字号跟随用户的 `--dsh-content-font-size`，实现「改字号，整个界面按比例缩放」。
  '--dsw-font-l-20': '500 20px/28px var(--dsw-font-family)',
  '--dsw-font-m-18': '500 16px/28px var(--dsw-font-family)',
  '--dsw-font-base-16': '16px/24px var(--dsw-font-family)',
  '--dsw-font-base-strong-16': '500 16px/24px var(--dsw-font-family)',
  '--dsw-font-s-14': '14px/22px var(--dsw-font-family)',
  '--dsw-font-s-strong-14': '500 14px/22px var(--dsw-font-family)',
  // 焦点环宽度：宿主定义在 :root，插件直接引用。主题不改变它，只是确保
  // 主题自绘的 focus 规则有值可读（宿主缺失时 outline-width 会退化）。
  '--dsw-focus-ring-width': '2px',
  // 阴影
  '--dsw-shadow-lv1': '0 2px 4px 0 rgba(0, 0, 0, 0.05)',
  '--dsw-shadow-lv2': '0 4px 12px 0 rgba(0, 0, 0, 0.02), 0 2px 8px 0 rgba(0, 0, 0, 0.04)',
  '--dsw-shadow-lv3':
    '0 0 1px 0 rgba(0, 0, 0, 0.2), 0 0 4px 0 rgba(0, 0, 0, 0.02), 0 12px 32px 0 rgba(0, 0, 0, 0.08)',
  '--dsw-elevation-soft': '0 1px 2px 0 rgba(0, 0, 0, 0.04)',
  '--dsw-elevation-panel': '0 8px 24px 0 rgba(0, 0, 0, 0.10)',
  '--dsw-elevation-prominent': '0 16px 48px 0 rgba(0, 0, 0, 0.18)',
  '--dsw-elevation-stroke-color': 'var(--color-border)',
  '--dsw-mask-blur': 'none',
  // 主题工作室自有材质（供主题 CSS 引用，不属于宿主契约）
  '--ts-blur': '0px',
  '--ts-saturate': '100%',
  '--ts-glass-tint': 'transparent',
  '--ts-glass-highlight': 'transparent',
  '--ts-glass-edge': 'transparent',
  '--ts-surface-alpha': '100%',
  '--ts-font-scale': '1',
  // 「壁纸」：玻璃主题的根画布径向渐变。非玻璃主题留空即不绘制。
  '--ts-wallpaper-1': 'transparent',
  '--ts-wallpaper-2': 'transparent',
}

/** 主题 CSS 可引用的材质键（测试用于校验主题没有写未知材质）。 */
export const MATERIAL_KEYS = Object.freeze(Object.keys(MATERIAL_DEFAULTS))

/** 由语义键派生的全部宿主 Token 名（含插件兼容别名）。 */
export const HOST_TOKEN_MAP = Object.freeze({
  ...Object.fromEntries(
    Object.entries(HOST_KEY_MAP).map(([token, key]) => [token, { light: key, dark: key }]),
  ),
  ...Object.fromEntries(
    Object.entries(PLUGIN_ALIAS_MAP).map(([token, key]) => [token, { light: key, dark: key }]),
  ),
})

/**
 * 把语义层的一个键解析成成对色值。
 *
 * 主题色板里允许两种写法：
 *   - 裸字符串：`'#161616'`，明暗同值；
 *   - `{ light, dark }`：分别取值。
 * 还允许占位引用另一个语义键（`'@foreground'`），用于「和主文字同色」这类派生，
 * 避免每款主题把同一色值抄两遍。
 *
 * @param {Record<string, string | { light: string, dark: string }>} palette 主题色板
 * @param {string} key 语义键
 * @param {{ seen?: Set<string> }} [state] 循环引用检测
 * @returns {{ light: string, dark: string }}
 */
export function resolveKey(palette, key, state = {}) {
  const seen = state.seen ?? new Set()
  if (seen.has(key)) {
    throw new Error(`主题色板存在循环引用：${[...seen, key].join(' -> ')}`)
  }
  const raw = palette[key]
  if (raw === undefined) {
    throw new Error(`主题色板缺少语义键 "${key}"（主题必须提供该键，或由基座继承）`)
  }
  if (typeof raw === 'string' && raw.startsWith('@')) {
    seen.add(key)
    return resolveKey(palette, raw.slice(1), { seen })
  }
  if (typeof raw === 'string') return { light: raw, dark: raw }
  if (raw && typeof raw === 'object' && typeof raw.light === 'string' && typeof raw.dark === 'string') {
    return { light: raw.light, dark: raw.dark }
  }
  throw new Error(`语义键 "${key}" 的值必须是字符串或 { light, dark }，实际为 ${JSON.stringify(raw)}`)
}

/**
 * 把主题色板解析为宿主 Token 表（`--dsw-*` → `{ light, dark }`）。
 *
 * @param {Record<string, string | { light: string, dark: string }>} palette
 * @returns {Record<string, { light: string, dark: string }>}
 */
export function buildHostTokens(palette) {
  const out = {}
  for (const [token, modes] of Object.entries(HOST_TOKEN_MAP)) {
    out[token] = resolveKey(palette, modes.light)
  }
  return out
}

/**
 * 合并主题材质覆盖与默认材质。
 *
 * 材质值支持两种写法：
 *   - 裸字符串：明暗同值；
 *   - `{ light, dark }`：分别取值，输出为 `light-dark()`。玻璃主题的「壁纸」
 *     与轮廓光必须区分明暗——同一组半透明白光放到深色背景上会变成刺眼白边。
 *
 * @param {Record<string, string | { light: string, dark: string }>} [overrides]
 * @returns {Record<string, string | { light: string, dark: string }>}
 */
export function buildMaterialTokens(overrides = {}) {
  const merged = { ...MATERIAL_DEFAULTS, ...overrides }
  for (const key of Object.keys(overrides)) {
    if (!(key in MATERIAL_DEFAULTS)) {
      throw new Error(`主题声明了未知材质 Token "${key}"（可选键见 MATERIAL_DEFAULTS）`)
    }
  }
  return merged
}

/** 把材质值格式化为 CSS 声明值（成对值走 `light-dark()`）。 */
function materialValue(value) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && typeof value.light === 'string' && typeof value.dark === 'string') {
    return lightDark(value.light, value.dark)
  }
  throw new Error(`材质 Token 的值必须是字符串或 { light, dark }，实际为 ${JSON.stringify(value)}`)
}

/** 生成 `light-dark()` 值；两态相同时退化为裸值，避免无意义的函数包裹。 */
export function lightDark(lightValue, darkValue) {
  return lightValue === darkValue ? darkValue : `light-dark(${lightValue}, ${darkValue})`
}

/**
 * 判断一个 Token 必须挂在 `body` 上才能生效。
 *
 * 这是本插件最容易被忽略、也最容易导致「主题不生效」的一条宿主事实：
 *
 *   - 宿主把 `--dsw-alias-*` / `--dsw-static-*` / `--dsw-specific-*` 与
 *     `--dsw-font-family`、`--ds-font-family-code` **定义在 `body` 上**
 *     （见 ui-theme 的 design-platform.css）；
 *   - `--dsw-radius-*` / `--dsw-shadow-*` / `--dsw-elevation-*` 定义在 `:root`；
 *   - `--dsw-focus-ring-color` / `--dsw-hovercard-bg` 宿主**从未定义**（只被引用），
 *     属于我们补的兼容别名。
 *
 * CSS 变量沿继承链查找最近的定义。若主题只有 `html[attr] { --dsw-alias-bg-base }`，
 * body 上宿主的同名定义更近，主题值会被静默吃掉——这正是 dsh-zcode-theme 当年
 * 必须依赖宿主 `ThemeRuntime.overrideTokens()` 写内联 style（内联最高）的原因。
 *
 * 本插件改用选择器特异性解决：把 body 级 Token 写在
 * `html[attr] body`（0,1,2）上，压过宿主的 `body`（0,0,1）与
 * `body[data-ds-dark-theme]`（0,1,1）。这样不依赖任何运行时 API，
 * 服务端直出即刻生效，桌面端与 Web 端行为一致。
 *
 * @param {string} token
 * @returns {boolean}
 */
export function isBodyScopedToken(token) {
  if (
    token.startsWith('--dsw-alias-') ||
    token.startsWith('--dsw-static-') ||
    token.startsWith('--dsw-specific-')
  ) {
    return true
  }
  return BODY_SCOPED_EXTRAS.has(token)
}

/** 除前缀规则外，还必须挂 body 的 Token（宿主在 body 上定义或从未定义）。 */
const BODY_SCOPED_EXTRAS = new Set([
  '--dsw-font-family',
  '--ds-font-family-code',
  '--dsw-focus-ring-color',
  '--dsw-hovercard-bg',
])

/**
 * 输出主题的变量声明块。
 *
 * 刻意分成两块：
 *
 *   - `html[data-theme-studio="<id>"]`（0,1,1）：语义层 `--color-*`、
 *     材质层 `--ts-*`、以及宿主定义在 `:root` 的圆角 / 阴影 / 模糊。
 *     `--color-*` 是主题 CSS 的取值来源，宿主不定义它们，无冲突；
 *     `--dsw-radius-*` 等与宿主 `:root`（0,1,0）同级特异性但后注入，稳赢。
 *
 *   - `html[data-theme-studio="<id>"] body`（0,1,2）：`--dsw-alias/static/specific-*`
 *     与字体栈。这些宿主定义在 `body` 上，必须压过它。
 *
 * `--color-*` 不重复写在 body 块里：body 没有重新定义它们，沿继承链从 html
 * 拿到，省掉一份重复声明。
 *
 * @param {{ id: string, palette: Record<string, unknown>, material?: Record<string, unknown>, materialDark?: Record<string, unknown> }} theme
 * @param {{ includeColorVars?: boolean }} [options]
 * @returns {string}
 */
export function themeVarsCss(theme, options = {}) {
  const { includeColorVars = true, extraDeclarations = [] } = options
  const base = `html[${THEME_ATTR}="${theme.id}"]`
  const htmlLines = [...extraDeclarations]
  const bodyLines = []

  if (includeColorVars) {
    for (const key of Object.keys(theme.palette)) {
      const { light, dark } = resolveKey(theme.palette, key)
      htmlLines.push(`  --color-${key}: ${lightDark(light, dark)};`)
    }
  }

  for (const [token, modes] of Object.entries(buildHostTokens(theme.palette))) {
    const line = `  ${token}: ${lightDark(modes.light, modes.dark)};`
    if (isBodyScopedToken(token)) bodyLines.push(line)
    else htmlLines.push(line)
  }

  const material = buildMaterialTokens(theme.material)
  for (const [token, value] of Object.entries(material)) {
    const line = `  ${token}: ${materialValue(value)};`
    if (isBodyScopedToken(token)) bodyLines.push(line)
    else htmlLines.push(line)
  }

  let css = `${base} {\n${htmlLines.join('\n')}\n}\n`
  if (bodyLines.length > 0) {
    css += `${base} body {\n${bodyLines.join('\n')}\n}\n`
  }

  // 暗色专用材质：玻璃主题的轮廓光、壁纸、玻璃 tint 在明暗两侧必须不同。
  // 宿主暗色标记的规则是 `body[data-ds-dark-theme]`（0,1,1）；下面这条
  // (0,1,3) 压过它，同时不会影响用户自定义层（它写在更后面、且同样带 body）。
  //
  // 只输出 `materialDark` **显式声明**的键：其余键在亮色块里已经给过值，
  // 再写一遍只会增加体积，还会掩盖「这个键的暗色到底有没有被特意调过」。
  const darkDeclared = Object.keys(theme.materialDark ?? {})
  const darkMaterial = buildMaterialTokens(theme.materialDark)
  const darkLines = darkDeclared.map((token) => `  ${token}: ${materialValue(darkMaterial[token])};`)
  if (darkLines.length > 0) {
    css += `${base} body[data-ds-dark-theme] {\n${darkLines.join('\n')}\n}\n`
  }

  return css
}

/**
 * 兼容旧插件 `data-dsh-theme="zcode"` 的属性：把同一份变量也挂到旧属性上，
 * 让 dsh-mobile-adapter 之类仍在用旧属性的消费者继续工作。
 *
 * @param {{ id: string, legacyId?: string }} theme
 * @returns {string[]}
 */
export function legacySelectors(theme) {
  if (!theme.legacyId) return []
  return [`html[${LEGACY_THEME_ATTR}="${theme.legacyId}"]`]
}
