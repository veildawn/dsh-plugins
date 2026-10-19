/**
 * ZCode 官方 Zai 主题色板。
 *
 * 真源：zai-org/ZCode 的 `packages/ui/src/styles.css` —— `.theme-zai-light` /
 * `.theme-zai-dark` 两块，叠加它们引用的 Tailwind v4 基础色。所有 `var()`
 * 引用在生成阶段展开为具体值，因此本文件与官方渲染结果逐值一致。
 *
 * key 一律沿用官方 `--color-<key>` 的 kebab 名，不做任何反向映射：读代码时
 * 可以直接和上游 styles.css 对照。
 *
 * 每个条目都是 `{ light, dark }` 成对值 —— 宿主 ThemeRuntime.overrideTokens
 * 与 CSS `light-dark()` 都要求成对，避免切换明暗时出现不可读组合。
 */

/** 官方 Zai 语义色板 + 少量由官方 diff 色派生的宿主扩展语义。 */
export const ZAI_PALETTE = {
  accent: { light: "#ebf4ff", dark: "#001d3d" },
  "amber-600": { light: "#d97706", dark: "#d97706" },
  background: { light: "#f8f8f8", dark: "#161616" },
  "background-alt": { light: "color-mix(in oklab, #f8f8f8 70%, transparent)", dark: "color-mix(in oklab, #2b2b2b 60%, transparent)" },
  "background-win-alt": { light: "#ececee", dark: "#2b2b2b" },
  "bg-document-selection": { light: "rgba(37, 99, 235, 0.4)", dark: "rgba(37, 99, 235, 0.4)" }, // 文档预览选区
  "blue-300": { light: "#93c5fd", dark: "#93c5fd" },
  "blue-50": { light: "#eff6ff", dark: "#eff6ff" },
  "blue-700": { light: "#1d4ed8", dark: "#1d4ed8" },
  border: { light: "rgba(13, 13, 13, 0.1)", dark: "rgba(255, 255, 255, 0.1)" },
  "border-hover": { light: "rgba(13, 13, 13, 0.15)", dark: "rgba(255, 255, 255, 0.15)" },
  brand: { light: "#000000", dark: "#ffffff" },
  card: { light: "#ffffff", dark: "#2b2b2b" },
  "card-border": { light: "rgba(13, 13, 13, 0.1)", dark: "rgba(255, 255, 255, 0.1)" },
  "card-selected": { light: "#ffffff", dark: "#2b2b2b" },
  "code-diff-added": { light: "color-mix(in srgb, #1e8a3e 8%, transparent)", dark: "color-mix(in srgb, #46bf72 12%, transparent)" }, // 行内 diff 新增底色
  "code-diff-deleted": { light: "color-mix(in srgb, #e03131 8%, transparent)", dark: "color-mix(in srgb, #ff5c5c 12%, transparent)" }, // 行内 diff 删除底色
  "command-node": { light: "rgba(86, 98, 112, 0.1)", dark: "rgba(154, 166, 180, 0.14)" },
  "command-node-foreground": { light: "#566270", dark: "#b5c0cc" },
  "command-node-hover": { light: "rgba(86, 98, 112, 0.16)", dark: "rgba(154, 166, 180, 0.2)" },
  "context-breakdown-1": { light: "#0b7fff", dark: "#4099ff" },
  "context-breakdown-2": { light: "#338fff", dark: "#66adff" },
  "context-breakdown-3": { light: "#5ca7ff", dark: "#80beff" },
  "context-breakdown-4": { light: "#85bbff", dark: "#9dceff" },
  "context-breakdown-5": { light: "#acd0ff", dark: "#b9ddff" },
  "context-breakdown-6": { light: "#c8ddff", dark: "#d0e8ff" },
  "context-breakdown-7": { light: "#e0ecff", dark: "#e4f1ff" },
  destructive: { light: "#e03131", dark: "#ff5c5c" },
  "destructive-foreground": { light: "#ffffff", dark: "#ffffff" },
  "destructive-surface": { light: "color-mix(in srgb, #e03131 10%, transparent)", dark: "color-mix(in srgb, #ff5c5c 16%, transparent)" },
  "destructive-surface-foreground": { light: "#b42020", dark: "#ff8585" },
  "diff-added": { light: "#1e8a3e", dark: "#46bf72" },
  "diff-added-foreground": { light: "#ffffff", dark: "#000000" },
  "diff-removed": { light: "#e03131", dark: "#ff5c5c" },
  "diff-removed-foreground": { light: "#ffffff", dark: "#000000" },
  "feedback-privacy-hint": { light: "#ca8a04", dark: "#fde047" },
  "file-diff-added-bg": { light: "color-mix(in srgb, #1e8a3e 12%, transparent)", dark: "color-mix(in srgb, #46bf72 16%, transparent)" }, // 文件 diff 新增行底色
  "file-diff-added-gutter": { light: "color-mix(in srgb, #1e8a3e 18%, transparent)", dark: "color-mix(in srgb, #46bf72 24%, transparent)" }, // 文件 diff 新增行号槽
  "file-diff-added-marker": { light: "#1e8a3e", dark: "#46bf72" }, // 文件 diff 新增标记
  "file-diff-deleted-bg": { light: "color-mix(in srgb, #e03131 12%, transparent)", dark: "color-mix(in srgb, #ff5c5c 16%, transparent)" }, // 文件 diff 删除行底色
  "file-diff-deleted-gutter": { light: "color-mix(in srgb, #e03131 18%, transparent)", dark: "color-mix(in srgb, #ff5c5c 24%, transparent)" }, // 文件 diff 删除行号槽
  "file-diff-deleted-marker": { light: "#e03131", dark: "#ff5c5c" }, // 文件 diff 删除标记
  "file-node": { light: "rgba(26, 112, 184, 0.1)", dark: "rgba(112, 174, 224, 0.16)" },
  "file-node-foreground": { light: "#1a70b8", dark: "#8fc5ef" },
  "file-node-hover": { light: "rgba(26, 112, 184, 0.16)", dark: "rgba(112, 174, 224, 0.22)" },
  "find-highlight": { light: "#fff4eb", dark: "#542500" },
  "find-highlight-active": { light: "#ffb26b", dark: "#ff8a30" },
  foreground: { light: "#262626", dark: "#d4d4d4" },
  "foreground-inverse": { light: "#ffffff", dark: "#000000" },
  "foreground-subtle": { light: "color-mix(in oklab, #262626 60%, transparent)", dark: "color-mix(in oklab, #d4d4d4 60%, transparent)" },
  "foreground-subtlest": { light: "color-mix(in oklab, #262626 40%, transparent)", dark: "color-mix(in oklab, #d4d4d4 30%, transparent)" },
  "git-added": { light: "#1e8a3e", dark: "#46bf72" },
  "git-deleted": { light: "#e03131", dark: "#ff5c5c" },
  "git-descendant": { light: "#e07b00", dark: "#ff8a30" },
  "git-ignored": { light: "color-mix(in oklab, #262626 40%, transparent)", dark: "color-mix(in oklab, #d4d4d4 30%, transparent)" },
  "git-modified": { light: "#e07b00", dark: "#ff8a30" },
  "git-none": { light: "#262626", dark: "#d4d4d4" },
  "git-renamed": { light: "#0b7fff", dark: "#4099ff" },
  "git-untracked": { light: "#1e8a3e", dark: "#46bf72" },
  "green-50": { light: "#f0fdf4", dark: "#f0fdf4" },
  "green-500": { light: "#22c55e", dark: "#22c55e" },
  "green-600": { light: "#16a34a", dark: "#16a34a" },
  "green-700": { light: "#15803d", dark: "#15803d" },
  header: { light: "#ffffff", dark: "#202020" },
  hover: { light: "rgba(13, 13, 13, 0.05)", dark: "rgba(255, 255, 255, 0.05)" },
  "icon-blue": { light: "#0066dd", dark: "#80beff" },
  "icon-purple": { light: "#9e77ed", dark: "#a888f2" },
  "idle-task": { light: "#9e77ed", dark: "#7b5ce5" },
  "idle-task-surface": { light: "#f5f3ff", dark: "#160d38" },
  input: { light: "#ffffff", dark: "#2b2b2b" },
  "input-border": { light: "rgba(13, 13, 13, 0.1)", dark: "rgba(255, 255, 255, 0.1)" },
  "input-border-focused": { light: "rgba(13, 13, 13, 0.15)", dark: "rgba(255, 255, 255, 0.15)" },
  "input-border-hover": { light: "rgba(13, 13, 13, 0.15)", dark: "rgba(255, 255, 255, 0.15)" },
  "input-focused": { light: "#ffffff", dark: "#2b2b2b" },
  "interaction-ask-fill": { light: "rgba(70, 191, 114, 0.2)", dark: "rgba(70, 191, 114, 0.24)" },
  "interaction-ask-foreground": { light: "#0066dd", dark: "#80beff" },
  "interaction-ask-surface": { light: "#ebf4ff", dark: "#001d3d" },
  "interaction-confirmation-foreground": { light: "#166b32", dark: "#87d9a4" },
  "interaction-confirmation-surface": { light: "#eaf7ee", dark: "rgba(70, 191, 114, 0.16)" },
  "markdown-inline-code": { light: "#e6e6e6", dark: "#363636" },
  menu: { light: "#ffffff", dark: "#2b2b2b" },
  "menu-hover": { light: "#f0f0f0", dark: "#363636" },
  "neutral-100": { light: "#f5f5f5", dark: "#f5f5f5" },
  "neutral-200": { light: "#e5e5e5", dark: "#e5e5e5" },
  "neutral-300": { light: "#d4d4d4", dark: "#d4d4d4" },
  "neutral-400": { light: "#a3a3a3", dark: "#a3a3a3" },
  "neutral-50": { light: "#fafafa", dark: "#fafafa" },
  "neutral-500": { light: "#737373", dark: "#737373" },
  "neutral-600": { light: "#525252", dark: "#525252" },
  "neutral-700": { light: "#404040", dark: "#404040" },
  "neutral-800": { light: "#262626", dark: "#262626" },
  "neutral-900": { light: "#171717", dark: "#171717" },
  "neutral-950": { light: "#0a0a0a", dark: "#0a0a0a" },
  panel: { light: "#ffffff", dark: "#202020" },
  "plugin-node": { light: "rgba(184, 122, 26, 0.1)", dark: "rgba(224, 174, 112, 0.16)" },
  "plugin-node-foreground": { light: "#b87a1a", dark: "#efc58f" },
  "plugin-node-hover": { light: "rgba(184, 122, 26, 0.16)", dark: "rgba(224, 174, 112, 0.22)" },
  "plugin-paid-plan-badge": { light: "#ffe3c8", dark: "#5a341b" },
  "plugin-paid-plan-badge-foreground": { light: "#4b280f", dark: "#ffd8b8" },
  popover: { light: "#ffffff", dark: "#2b2b2b" },
  "popover-border": { light: "rgba(13, 13, 13, 0.1)", dark: "rgba(255, 255, 255, 0.1)" },
  "popover-foreground": { light: "#262626", dark: "#d4d4d4" },
  "popover-header": { light: "#f8f8f8", dark: "#202020" },
  primary: { light: "#000000", dark: "#ffffff" },
  "primary-foreground": { light: "#ffffff", dark: "#000000" },
  "progress-surface": { light: "#eff6ff", dark: "rgba(70, 130, 240, 0.16)" },
  "progress-surface-foreground": { light: "#1d4ed8", dark: "#93c5fd" },
  "red-500": { light: "#ef4444", dark: "#ef4444" },
  "red-600": { light: "#dc2626", dark: "#dc2626" },
  "remote-docker-border": { light: "#d4caff", dark: "rgba(159, 132, 255, 0.42)" },
  "remote-docker-foreground": { light: "#6047b4", dark: "#bfaaff" },
  "remote-docker-surface": { light: "#f2efff", dark: "rgba(159, 132, 255, 0.16)" },
  "remote-foreground-muted": { light: "#595959", dark: "#b3b3b3" },
  "remote-ssh-border": { light: "#bad9ff", dark: "rgba(64, 153, 255, 0.42)" },
  "remote-ssh-foreground": { light: "#0867ce", dark: "#8fc0ff" },
  "remote-ssh-surface": { light: "#ebf4ff", dark: "rgba(64, 153, 255, 0.16)" },
  "remote-wsl-border": { light: "#b7e0c2", dark: "rgba(70, 191, 114, 0.42)" },
  "remote-wsl-foreground": { light: "#166b32", dark: "#87d9a4" },
  "remote-wsl-surface": { light: "#eaf7ee", dark: "rgba(70, 191, 114, 0.16)" },
  "resize-handle": { light: "#0ea5e9", dark: "#38bdf8" },
  secondary: { light: "#e6e6e6", dark: "#363636" },
  selected: { light: "rgba(13, 13, 13, 0.05)", dark: "rgba(255, 255, 255, 0.1)" },
  "session-node": { light: "rgba(20, 128, 122, 0.1)", dark: "rgba(104, 196, 188, 0.16)" },
  "session-node-foreground": { light: "#14807a", dark: "#93d8d2" },
  "session-node-hover": { light: "rgba(20, 128, 122, 0.16)", dark: "rgba(104, 196, 188, 0.22)" },
  sidebar: { light: "#f0f0f0", dark: "#161616" },
  "skill-node": { light: "rgba(116, 83, 176, 0.1)", dark: "rgba(166, 137, 218, 0.16)" },
  "skill-node-foreground": { light: "#7453b0", dark: "#bda5e6" },
  "skill-node-hover": { light: "rgba(116, 83, 176, 0.16)", dark: "rgba(166, 137, 218, 0.22)" },
  "sky-400": { light: "#38bdf8", dark: "#38bdf8" },
  "sky-500": { light: "#0ea5e9", dark: "#0ea5e9" },
  "sky-600": { light: "#0284c7", dark: "#0284c7" },
  "slate-500": { light: "#64748b", dark: "#64748b" },
  "slate-600": { light: "#475569", dark: "#475569" },
  "subagent-node": { light: "rgba(111, 122, 47, 0.1)", dark: "rgba(183, 189, 117, 0.16)" },
  "subagent-node-foreground": { light: "#6f7a2f", dark: "#c8cd90" },
  "subagent-node-hover": { light: "rgba(111, 122, 47, 0.16)", dark: "rgba(183, 189, 117, 0.22)" },
  success: { light: "#1e8a3e", dark: "#46bf72" },
  "success-foreground": { light: "#ffffff", dark: "#000000" },
  "success-surface": { light: "#eaf7ee", dark: "rgba(70, 191, 114, 0.16)" },
  "success-surface-foreground": { light: "#166b32", dark: "#87d9a4" },
  surface: { light: "rgba(13, 13, 13, 0.03)", dark: "rgba(255, 255, 255, 0.05)" },
  "surface-hover": { light: "rgba(13, 13, 13, 0.05)", dark: "rgba(255, 255, 255, 0.1)" },
  tab: { light: "#f0f0f0", dark: "#202020" },
  "tab-active": { light: "#ffffff", dark: "#161616" },
  "tab-border": { light: "rgba(13, 13, 13, 0.1)", dark: "rgba(255, 255, 255, 0.1)" },
  tag: { light: "#e6e6e6", dark: "#363636" },
  "teal-600": { light: "#0d9488", dark: "#0d9488" },
  "terminal-bg": { light: "#f8f8f8", dark: "#161616" },
  "terminal-black": { light: "#5c5c5c", dark: "#363636" },
  "terminal-blue": { light: "#0b7fff", dark: "#4099ff" },
  "terminal-bright-black": { light: "#888888", dark: "#747474" },
  "terminal-bright-blue": { light: "#0066dd", dark: "#80beff" },
  "terminal-bright-cyan": { light: "#0aa7a7", dark: "#8ee5e5" },
  "terminal-bright-green": { light: "#1e8a3e", dark: "#87d9a4" },
  "terminal-bright-magenta": { light: "#9e77ed", dark: "#a888f2" },
  "terminal-bright-red": { light: "#e03131", dark: "#ff9999" },
  "terminal-bright-white": { light: "#0d0d0d", dark: "#f8f8f8" },
  "terminal-bright-yellow": { light: "#e07b00", dark: "#ffb26b" },
  "terminal-cursor": { light: "#0d0d0d", dark: "#f8f8f8" },
  "terminal-cursor-accent": { light: "#f8f8f8", dark: "#161616" },
  "terminal-cyan": { light: "#0aa7a7", dark: "#42c8c8" },
  "terminal-fg": { light: "#262626", dark: "#d4d4d4" },
  "terminal-green": { light: "#1e8a3e", dark: "#46bf72" },
  "terminal-magenta": { light: "#9e77ed", dark: "#7b5ce5" },
  "terminal-red": { light: "#e03131", dark: "#ff5c5c" },
  "terminal-selection": { light: "rgba(11, 127, 255, 0.22)", dark: "rgba(64, 153, 255, 0.28)" },
  "terminal-selection-inactive": { light: "rgba(13, 13, 13, 0.1)", dark: "rgba(255, 255, 255, 0.1)" },
  "terminal-white": { light: "#adadad", dark: "#adadad" },
  "terminal-yellow": { light: "#e07b00", dark: "#ff8a30" },
  toast: { light: "#ffffff", dark: "#2b2b2b" },
  tooltip: { light: "#f0f0f0", dark: "#2b2b2b" },
  "tooltip-foreground": { light: "#0d0d0d", dark: "#f8f8f8" },
  "tooltip-tag": { light: "#e6e6e6", dark: "#363636" },
  "tooltip-tag-foreground": { light: "#5c5c5c", dark: "#adadad" },
  "trajectory-assistant": { light: "#0f766e", dark: "#2dd4bf" },
  "trajectory-reasoning": { light: "#7c3aed", dark: "#a78bfa" },
  "trajectory-tool-call": { light: "#d97706", dark: "#f59e0b" },
  "trajectory-tool-result": { light: "#0284c7", dark: "#38bdf8" },
  "trajectory-user": { light: "#2563eb", dark: "#60a5fa" },
  "usage-chart-1": { light: "#0b7fff", dark: "#4099ff" },
  "usage-chart-2": { light: "#1e8a3e", dark: "#46bf72" },
  "usage-chart-3": { light: "#9e77ed", dark: "#7b5ce5" },
  "usage-chart-4": { light: "#e03131", dark: "#ff5c5c" },
  "usage-chart-5": { light: "#e07b00", dark: "#ff8a30" },
  "usage-chart-6": { light: "#0aa7a7", dark: "#42c8c8" },
  "usage-heatmap-0": { light: "color-mix(in oklab, #0b7fff 0%, rgba(13, 13, 13, 0.03))", dark: "color-mix(in oklab, #4099ff 0%, rgba(255, 255, 255, 0.05))" },
  "usage-heatmap-1": { light: "color-mix(in oklab, #0b7fff 18%, rgba(13, 13, 13, 0.03))", dark: "color-mix(in oklab, #4099ff 24%, rgba(255, 255, 255, 0.05))" },
  "usage-heatmap-2": { light: "color-mix(in oklab, #0b7fff 36%, rgba(13, 13, 13, 0.03))", dark: "color-mix(in oklab, #4099ff 42%, rgba(255, 255, 255, 0.05))" },
  "usage-heatmap-3": { light: "color-mix(in oklab, #0b7fff 58%, rgba(13, 13, 13, 0.03))", dark: "color-mix(in oklab, #4099ff 62%, rgba(255, 255, 255, 0.05))" },
  "usage-heatmap-4": { light: "color-mix(in oklab, #0066dd 82%, rgba(13, 13, 13, 0.03))", dark: "color-mix(in oklab, #80beff 78%, rgba(255, 255, 255, 0.05))" },
  "violet-600": { light: "#7c3aed", dark: "#7c3aed" },
  warning: { light: "#e07b00", dark: "#ff8a30" },
  "warning-foreground": { light: "#ffffff", dark: "#000000" },
  "warning-surface": { light: "color-mix(in srgb, #e07b00 12%, transparent)", dark: "color-mix(in srgb, #ff8a30 16%, transparent)" },
  "warning-surface-foreground": { light: "#914e00", dark: "#ffa159" },
  white: { light: "#ffffff", dark: "#ffffff" },
  "workflow-rule": { light: "rgba(13, 13, 13, 0.055)", dark: "rgba(255, 255, 255, 0.065)" },
  "workflow-trace": { light: "rgba(13, 13, 13, 0.3)", dark: "rgba(255, 255, 255, 0.35)" },
  "workflow-trace-strong": { light: "rgba(13, 13, 13, 0.55)", dark: "rgba(255, 255, 255, 0.6)" },
  "yellow-300": { light: "#fde047", dark: "#fde047" },
  "yellow-600": { light: "#ca8a04", dark: "#ca8a04" },
}

export const THEME_SCOPE = 'zcode'
export const THEME_ATTR = 'data-dsh-theme'
export const STYLE_ID = 'dsh-zcode-theme'
export const TOKEN_SOURCE = 'dsh-zcode-theme'

const lightColors = Object.fromEntries(Object.entries(ZAI_PALETTE).map(([k, v]) => [k, v.light]))
const darkColors = Object.fromEntries(Object.entries(ZAI_PALETTE).map(([k, v]) => [k, v.dark]))

/** 规范要求覆盖的宿主 Token。 */
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

/** 宿主不存在，主题 CSS / JS 禁止引用。 */
export const FORBIDDEN_HOST_TOKENS = [
  '--dsw-alias-bg-inverse',
  '--dsw-alias-label-inverse',
]

/** 宿主默认品牌蓝，以及已废弃的自拟暖橙红：主题产物中不得残留。 */
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

/**
 * 宿主 `--dsw-*` → Zai 语义色的映射。
 * 每个值都是 ZAI_PALETTE 里某个 key 的对应模式值，色值只有一份。
 */
function hostMap(c) {
  return {
    // 背景层级
    '--dsw-alias-bg-base': c.background,
    '--dsw-alias-bg-layer-1': c.panel,
    '--dsw-alias-bg-layer-2': c.card,
    '--dsw-alias-bg-layer-3': c.input,
    '--dsw-alias-bg-layer-4': c['menu-hover'],
    // 显式补齐：这几个别名宿主有组件直接 var() 引用，但官方 design-platform CSS
    // 里没有定义，不覆盖就会回落到宿主默认蓝板，导致主题局部漏色。
    '--dsw-alias-bg-l1': c.background,
    '--dsw-alias-fill-l1': c.surface,
    '--dsw-alias-fill-l2': c['surface-hover'],
    '--dsw-alias-fill-tsp-secondary': c.secondary,
    '--dsw-alias-bg-module-platform': c.input,
    '--dsw-alias-bg-overlay': c.card,
    '--dsw-alias-bg-multi-select': c.secondary,
    '--dsw-alias-bg-skeleton': c.surface,
    '--dsw-alias-bg-mask-1': c['background-win-alt'],
    '--dsw-alias-bg-mask-2': c.surface,
    '--dsw-alias-bg-mask-3': c['background-win-alt'],
    '--dsw-alias-bg-mask-photo': c['background-win-alt'],
    '--dsw-alias-bg-mask-drop': c.background,
    '--dsw-alias-bg-document-preview': c.panel,
    '--dsw-alias-bg-document-selection': c['bg-document-selection'],
    '--dsw-alias-label-document-preview': c['foreground-subtle'],

    // 侧边栏
    '--dsw-specific-sidebar-fill': c.sidebar,
    '--dsw-specific-sidebar-nav-item-active': c.input,
    '--dsw-specific-sidebar-nav-item-active-accent': c.foreground,
    '--dsw-specific-sidebar-nav-item-hover': c.surface,
    '--dsw-specific-input-major': c.input,
    '--dsw-specific-login-input': c.panel,
    '--dsw-specific-bubble': c.card,
    '--dsw-specific-bubble-highlight': c.primary,
    '--dsw-specific-menu': c.menu,
    '--dsw-specific-tip': c.tooltip,
    '--dsw-specific-selector': c.secondary,
    '--dsw-alias-menu-group-header-fill': c.panel,

    // 文字
    '--dsw-alias-label-primary': c.foreground,
    '--dsw-alias-label-secondary': c['foreground-subtle'],
    '--dsw-alias-label-tertiary': c['foreground-subtlest'],
    '--dsw-alias-label-caption': c['foreground-subtlest'],
    '--dsw-alias-label-quaternary': c['foreground-subtlest'],
    '--dsw-alias-label-dimmed': c['foreground-subtlest'],
    '--dsw-alias-label-primary-dimmed': c['foreground-subtle'],
    '--dsw-alias-label-primary-bluish': c.foreground,
    '--dsw-alias-label-primary-inverted': c['primary-foreground'],
    '--dsw-alias-label-primary-foreground': c['primary-foreground'],
    '--dsw-alias-label-shimmer': c['foreground-subtlest'],
    '--dsw-alias-label-deep-diving': c.foreground,
    '--dsw-alias-label-deep-diving-shimmer': c['foreground-subtle'],
    '--dsw-alias-menu-icon': c['foreground-subtle'],

    // 品牌与主操作（Zai 为单色）
    '--dsw-alias-brand-primary': c.brand,
    '--dsw-alias-brand-text': c.brand,
    '--dsw-alias-brand-subtle': c.surface,
    '--dsw-alias-brand-primary-invert': c['primary-foreground'],
    '--dsw-alias-brand-primary-new-colorprimary-new-color': c.brand,
    '--dsw-alias-button-primary-fill': c.primary,
    '--dsw-alias-button-primary-hover': c.primary,
    '--dsw-alias-button-primary-dimmed': c.secondary,
    '--dsw-alias-button-info-fill': c.primary,
    '--dsw-alias-button-info-hover': c.primary,
    '--dsw-alias-button-contrast-fill': c.primary,
    '--dsw-alias-button-elevated-fill': c.card,
    '--dsw-alias-button-floating-fill': c.card,
    '--dsw-alias-button-floating-hover': c['menu-hover'],
    '--dsw-alias-button-ghost-active-fill': c.secondary,
    '--dsw-alias-button-ghost-active-hover': c['menu-hover'],
    '--dsw-alias-button-ghost-active-border': c.border,
    '--dsw-alias-button-tool-bar-fill': c['surface-hover'],
    '--dsw-alias-button-tool-bar-fill-invisible': c.surface,
    '--dsw-alias-button-tool-bar-hover': c['surface-hover'],
    '--dsw-alias-switch-thumb': c['primary-foreground'],

    // 静态色（宿主历史组件按名字取色）
    '--dsw-static-deepseek-200': c.foreground,
    '--dsw-static-deepseek-400': c['foreground-subtle'],
    '--dsw-static-deepseek-450': c['foreground-subtle'],
    '--dsw-static-deepseek-500': c['foreground-subtle'],

    // 边框
    '--dsw-alias-border-l1': c.border,
    '--dsw-alias-border-l2': c['border-hover'],
    '--dsw-alias-border-l2-darkmode-thin': c.border,
    '--dsw-alias-border-l3': c['border-hover'],
    '--dsw-alias-border-l4': c['border-hover'],
    '--dsw-alias-border-inverted': c.surface,
    '--dsw-alias-border-inverted2': c.surface,
    '--dsw-alias-separator-primary': c.border,

    // 交互态
    '--dsw-alias-interactive-bg-hover': c.surface,
    '--dsw-alias-interactive-bg-hover-solid': c['surface-hover'],
    '--dsw-alias-interactive-bg-hover-accent': c['surface-hover'],
    '--dsw-alias-interactive-bg-hover-danger': c['destructive-surface'],
    '--dsw-alias-interactive-bg-active': c['surface-hover'],

    // 状态
    '--dsw-alias-state-business-primary': c.brand,
    '--dsw-alias-state-business-tertiary': c.surface,
    '--dsw-alias-state-success-primary': c.success,
    '--dsw-alias-state-success-secondary': c['success-surface-foreground'],
    '--dsw-alias-state-success-tertiary': c['success-surface'],
    '--dsw-alias-state-warn-primary': c.warning,
    '--dsw-alias-state-warn-secondary': c['warning-surface-foreground'],
    '--dsw-alias-state-warn-tertiary': c['warning-surface'],
    '--dsw-alias-state-warn-label': c['warning-surface-foreground'],
    '--dsw-alias-state-error-primary': c.destructive,
    '--dsw-alias-state-error-secondary': c['destructive-surface'],
    '--dsw-alias-state-idle-primary': c['idle-task'],

    // 代码与 Markdown
    '--dsw-alias-markdown-code-block': c.background,
    '--dsw-alias-markdown-code-block-banner': c.panel,
    '--dsw-alias-markdown-inline-code': c['markdown-inline-code'],
    '--dsw-alias-markdown-citation': c.panel,
    '--dsw-alias-markdown-tag': c.tag,
    '--dsw-alias-markdown-placeholder': c.secondary,
    '--dsw-alias-markdown-code-segment-selected': c.panel,
    '--dsw-alias-markdown-code-segment-unselected': c.secondary,
    '--dsw-alias-code-diff-added': c['code-diff-added'],
    '--dsw-alias-code-diff-deleted': c['code-diff-deleted'],
    '--dsw-alias-file-diff-added-bg': c['file-diff-added-bg'],
    '--dsw-alias-file-diff-added-gutter': c['file-diff-added-gutter'],
    '--dsw-alias-file-diff-added-marker': c['file-diff-added-marker'],
    '--dsw-alias-file-diff-deleted-bg': c['file-diff-deleted-bg'],
    '--dsw-alias-file-diff-deleted-gutter': c['file-diff-deleted-gutter'],
    '--dsw-alias-file-diff-deleted-marker': c['file-diff-deleted-marker'],
    '--dsw-alias-turn-trigger-bg': c.background,
    '--dsw-alias-turn-trigger-bg-hover': c.surface,

    // 浮层
    '--dsw-alias-toast-bg': c.toast,
    '--dsw-alias-toast-label': c.foreground,
    '--dsw-alias-tooltip-bg': c.tooltip,
    '--dsw-alias-tooltip-key-bg': c['tooltip-tag'],
    '--dsw-alias-link': c.brand,
    '--dsw-alias-onboarding-accent': c.brand,
    '--dsw-alias-onboarding-card-fill': c.card,
    '--dsw-alias-onboarding-secondary-fill': c.secondary,
    '--dsw-alias-onboarding-checkbox-border': c['border-hover'],
    '--dsw-alias-settings-card-fill': c.card,
    '--dsw-alias-settings-card-stroke': c['border-hover'],

    // 滚动条
    '--dsw-alias-scrollbar-bg-l1': c.secondary,
    '--dsw-alias-scrollbar-bg-l2': c.secondary,
    '--dsw-alias-scrollbar-hover-l1': c['menu-hover'],
    '--dsw-alias-scrollbar-hover-l2': c['menu-hover'],

    // 焦点环
    '--dsw-focus-ring-color': c.foreground,
  }
}

const LIGHT_MAP = hostMap(lightColors)
const DARK_MAP = hostMap(darkColors)

/** 宿主 `--dsw-*` 映射。每个 Token 为 `{ light, dark }`。 */
export const HOST_TOKEN_MAP = Object.fromEntries(
  Object.keys(DARK_MAP).map((name) => [name, { light: LIGHT_MAP[name], dark: DARK_MAP[name] }]),
)

/** 宿主 ThemeRuntime.overrideTokens 需要 { light, dark } 成对赋值。 */
export function hostTokenOverrides(map = HOST_TOKEN_MAP) {
  return map
}

export function lightDark(lightValue, darkValue) {
  return lightValue === darkValue ? darkValue : `light-dark(${lightValue}, ${darkValue})`
}

/** 注入用 Token CSS，跟随 html color-scheme。 */
export function tokensCss(map = HOST_TOKEN_MAP) {
  const lines = Object.entries(map).map(([name, modes]) => `  ${name}: ${lightDark(modes.light, modes.dark)};`)
  return `[data-dsh-theme="zcode"] {\n${lines.join('\n')}\n}\n`
}

/**
 * 官方 `--color-*` 语义色，原样落地为同名变量供主题 CSS 直接引用。
 * 传入被引用的名字集合时只输出这些——宿主不读 `--color-*`，多写的都是死变量。
 * @param names 需要输出的 Token 名（不含 `--color-` 前缀）；缺省输出整份色板。
 */
export function zaiTokensCss(names = Object.keys(ZAI_PALETTE)) {
  const lines = names.map(
    (name) => `  --color-${name}: ${lightDark(ZAI_PALETTE[name].light, ZAI_PALETTE[name].dark)};`,
  )
  return `[data-dsh-theme="zcode"] {\n${lines.join('\n')}\n}\n`
}
