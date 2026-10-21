/**
 * 内置主题注册表。
 *
 * 六款主题，全部走同一份 Token 契约（`lib/tokens.js`）：
 *
 * | id              | 名称           | 明暗 | 风格基座 |
 * | :-------------- | :------------- | :--- | :------- |
 * | `zcode`         | ZCode 官方     | 跟随 | 单色品牌 + 灰阶层级 |
 * | `zcode-mono`    | ZCode 单色极简 | 跟随 | 上面一款的灰阶变体 |
 * | `glass`         | 苹果玻璃       | 跟随 | Liquid Glass 冷调 |
 * | `glass-color`   | 玻璃彩色       | 跟随 | Liquid Glass 带色相 |
 *
 * 「跟随」指主题本身同时携带 light / dark 两套色板，由宿主的明暗偏好决定取哪套，
 * 用户不需要为暗色再单独选一次主题——这正是 `light-dark()` 与
 * `ThemeRuntime.overrideTokens` 的成对契约。
 *
 * 每款主题声明：
 *   - `id`：切换时写入 `html[data-theme-studio]` 的值，也是持久化用的键；
 *   - `label` / `description`：设置面板展示文案；
 *   - `palette`：语义色板（必须能解析出全部 `HOST_TOKEN_MAP` 用到的键）；
 *   - `material`：材质覆盖（圆角、阴影、毛玻璃参数），可缺省；
 *   - `materialDark`：暗色专用材质覆盖（玻璃主题需要，ZCode 不需要）；
 *   - `legacyId`：兼容旧 `data-dsh-theme` 属性的取值（仅 ZCode 系列有）；
 *   - `surface`：设置面板里那张预览卡的取样色（纯展示，不参与运行时）。
 *
 * @module dsh-theme-studio/themes
 */

import { ZAI_PALETTE } from './zai-palette.js'
import { GLASS_PALETTE, GLASS_MATERIAL, GLASS_MATERIAL_DARK } from './glass-palette.js'
import { ZCODE_MONO_OVERRIDES } from './zcode-mono-palette.js'
import {
  GLASS_COLOR_OVERRIDES,
  GLASS_COLOR_MATERIAL,
  GLASS_COLOR_MATERIAL_DARK,
} from './glass-color-palette.js'
import { inheritPalette, inheritMaterial } from './inherit.js'

export { ZAI_PALETTE } from './zai-palette.js'
export { GLASS_PALETTE, GLASS_MATERIAL, GLASS_MATERIAL_DARK } from './glass-palette.js'
export { ZCODE_MONO_OVERRIDES } from './zcode-mono-palette.js'
export {
  GLASS_COLOR_OVERRIDES,
  GLASS_COLOR_MATERIAL,
  GLASS_COLOR_MATERIAL_DARK,
} from './glass-color-palette.js'
export { inheritPalette, inheritMaterial, paletteDiffKeys } from './inherit.js'

/** 系统默认（不使用主题）：保持 DSH 官方原生风格，不覆盖主题色板与组件样式。 */
export const NONE_THEME = Object.freeze({
  id: 'none',
  label: '系统默认',
  description: '保持 DeepSeek Harness 原生界面风格，不使用任何定制主题。',
  palette: Object.freeze({}),
  surface: { light: '#ffffff', dark: '#151517' },
})

/** ZCode 官方主题：直接使用上游 202 项官方色板，不做任何改动。 */
export const ZCODE_THEME = Object.freeze({
  id: 'zcode',
  label: 'ZCode 官方',
  description: 'ZCode 桌面与移动端官方视觉：单色品牌、灰阶层级、官方 202 项色板逐值对齐。',
  palette: ZAI_PALETTE,
  legacyId: 'zcode',
  surface: { light: '#f8f8f8', dark: '#161616' },
})

/** ZCode 单色极简：把装饰性彩色收敛为灰阶，仅保留 destructive 的红色。 */
export const ZCODE_MONO_THEME = Object.freeze({
  id: 'zcode-mono',
  label: 'ZCode 单色极简',
  description: '在 ZCode 基础上收敛所有装饰色为灰阶，适合长时间阅读与录屏。',
  palette: inheritPalette(ZAI_PALETTE, ZCODE_MONO_OVERRIDES),
  legacyId: 'zcode-mono',
  surface: { light: '#fafafa', dark: '#121212' },
})

/** 苹果玻璃：Liquid Glass 材质，低饱和冷调。 */
export const GLASS_THEME = Object.freeze({
  id: 'glass',
  label: '苹果玻璃',
  description: 'Apple Liquid Glass：真实背景模糊、饱和提升、轮廓光描边。',
  palette: GLASS_PALETTE,
  material: GLASS_MATERIAL,
  materialDark: GLASS_MATERIAL_DARK,
  surface: { light: '#eef1f6', dark: '#141519' },
})

/** 玻璃彩色：在玻璃材质上叠回系统色相。 */
export const GLASS_COLOR_THEME = Object.freeze({
  id: 'glass-color',
  label: '玻璃彩色',
  description: '彩色玻璃：更强模糊与色相折射，强调色使用 Apple 系统色。',
  palette: inheritPalette(GLASS_PALETTE, GLASS_COLOR_OVERRIDES),
  material: inheritMaterial(GLASS_MATERIAL, GLASS_COLOR_MATERIAL),
  materialDark: inheritMaterial(GLASS_MATERIAL_DARK, GLASS_COLOR_MATERIAL_DARK),
  surface: { light: '#eef0f9', dark: '#151520' },
})

/**
 * 全部内置主题，顺序即设置面板的展示顺序。
 *
 * 系统默认（不使用主题）排第一项，作为出厂默认值；用户自选时可切换到具体主题。
 */
export const BUILTIN_THEMES = Object.freeze([
  NONE_THEME,
  ZCODE_THEME,
  ZCODE_MONO_THEME,
  GLASS_THEME,
  GLASS_COLOR_THEME,
])

/** 默认主题 id：默认不使用主题，保持宿主原生风格。 */
export const DEFAULT_THEME_ID = 'none'

/** 内置主题 id 列表。 */
export const THEME_IDS = Object.freeze(BUILTIN_THEMES.map((theme) => theme.id))

/**
 * 按 id 取主题定义。
 *
 * @param {string} id
 * @returns {object | undefined}
 */
export function getTheme(id) {
  return BUILTIN_THEMES.find((theme) => theme.id === id)
}

/**
 * 把任意输入收敛为合法主题 id。
 *
 * @param {unknown} id
 * @param {string} [fallback]
 * @returns {string}
 */
export function normalizeThemeId(id, fallback = DEFAULT_THEME_ID) {
  if (typeof id !== 'string') return fallback
  return THEME_IDS.includes(id) ? id : fallback
}

/**
 * 供设置面板渲染的主题摘要（不含完整色板，减小 RPC 负载）。
 *
 * @returns {Array<{ id: string, label: string, description: string, surface: { light: string, dark: string } }>}
 */
export function themeCatalog() {
  return BUILTIN_THEMES.map(({ id, label, description, surface }) => ({
    id,
    label,
    description,
    surface,
  }))
}
