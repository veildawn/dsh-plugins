/**
 * 苹果玻璃（Apple Glass）主题色板。
 *
 * 设计目标不是「半透明 + 模糊」这么简单，而是复刻 macOS Sonoma / iOS 17 之后
 * Apple 的 **Liquid Glass** 材质观感，四条可辨识特征：
 *
 *   1. **色相来自壁纸，而非固定色**：Apple 的玻璃层本身几乎无色，观感由壁纸
 *      透上来。这里用一层低饱和的冷调 tint（亮：雾蓝；暗：深空灰蓝）模拟壁纸，
 *      再让卡片以 72%~86% 的透明度叠上去。
 *   2. **描边是「光」不是「线」**：玻璃边缘靠一条 1px 高光（亮色模式在顶部，
 *      暗色模式在整圈）把面板从背景里「切」出来，而不是用灰色 hairline。
 *      对应 `--ts-glass-edge` / `--ts-glass-highlight`。
 *   3. **饱和提升**：背景透过来时会被 `backdrop-filter: saturate()` 提饱和，
 *      这是玻璃看起来「润」而非「脏」的关键。对应 `--ts-saturate`。
 *   4. **前景色偏冷且高对比**：正文是冷调近黑 `#1d1d1f`（Apple 官方 body 色），
 *      不是纯黑；暗色是 `#f5f5f7`。次级文字用 Apple 的 secondaryLabel 语义。
 *
 * 品牌色取 Apple 系统蓝 `#0071e3`（官网按钮色）/ `#0a84ff`（暗色系统蓝），
 * 这是 Apple 产品界面上唯一稳定的强调色。
 *
 * @module dsh-theme-studio/themes/glass-palette
 */

/** 苹果玻璃主题的语义色板。 */
export const GLASS_PALETTE = {
  // —— 基础层：低饱和冷调，模拟壁纸透上来的观感 ——
  accent: { light: '#e8f0fe', dark: '#0b1a2e' },
  // `background` 是「内容卡」的填充（frame.css 把它用在 centerCol 上）。
  // 玻璃主题下它必须半透明，否则整张卡片是不透光的实色，壁纸被完全挡住，
  // 玻璃就只剩「一层灰色」——这是玻璃主题最关键的取值。
  background: { light: 'rgba(238, 241, 246, 0.82)', dark: 'rgba(20, 21, 25, 0.8)' },
  'background-alt': {
    light: 'color-mix(in oklab, #eef1f6 70%, transparent)',
    dark: 'color-mix(in oklab, #1c1d22 60%, transparent)',
  },
  'background-win-alt': { light: '#e4e8ef', dark: '#0e0f12' },
  'bg-document-selection': { light: 'rgba(0, 113, 227, 0.28)', dark: 'rgba(10, 132, 255, 0.34)' },

  // —— 表面层：半透明 + 由主题 CSS 叠 backdrop-filter ——
  // 亮色模式卡片比画布更亮（玻璃反光），暗色模式卡片比画布更亮一档（玻璃透光）。
  panel: { light: 'rgba(255, 255, 255, 0.65)', dark: 'rgba(34, 36, 44, 0.65)' },
  card: { light: 'rgba(255, 255, 255, 0.76)', dark: 'rgba(42, 45, 54, 0.74)' },
  input: { light: 'rgba(255, 255, 255, 0.70)', dark: 'rgba(42, 45, 56, 0.72)' },
  menu: { light: 'rgba(255, 255, 255, 0.72)', dark: 'rgba(32, 34, 42, 0.74)' },
  'menu-hover': { light: 'rgba(0, 0, 0, 0.06)', dark: 'rgba(255, 255, 255, 0.1)' },
  popover: { light: 'rgba(255, 255, 255, 0.75)', dark: 'rgba(36, 38, 48, 0.78)' },
  'popover-border': { light: 'rgba(0, 0, 0, 0.08)', dark: 'rgba(255, 255, 255, 0.12)' },
  'popover-foreground': '@foreground',
  'popover-header': { light: 'rgba(246, 248, 252, 0.9)', dark: 'rgba(38, 40, 47, 0.92)' },
  sidebar: { light: 'rgba(240, 244, 250, 0.58)', dark: 'rgba(18, 19, 23, 0.60)' },
  header: { light: 'rgba(255, 255, 255, 0.62)', dark: 'rgba(24, 25, 30, 0.6)' },
  tab: { light: 'rgba(0, 0, 0, 0.04)', dark: 'rgba(255, 255, 255, 0.06)' },
  'tab-active': { light: 'rgba(255, 255, 255, 0.9)', dark: 'rgba(62, 65, 74, 0.9)' },
  'tab-border': { light: 'rgba(0, 0, 0, 0.08)', dark: 'rgba(255, 255, 255, 0.1)' },
  toast: { light: 'rgba(255, 255, 255, 0.94)', dark: 'rgba(48, 51, 59, 0.94)' },
  tooltip: { light: 'rgba(250, 251, 253, 0.94)', dark: 'rgba(44, 46, 54, 0.94)' },
  'tooltip-foreground': '@foreground',
  'tooltip-tag': { light: 'rgba(0, 0, 0, 0.06)', dark: 'rgba(255, 255, 255, 0.1)' },
  'tooltip-tag-foreground': '@foreground-subtle',
  tag: { light: 'rgba(0, 0, 0, 0.06)', dark: 'rgba(255, 255, 255, 0.1)' },
  secondary: { light: 'rgba(0, 0, 0, 0.06)', dark: 'rgba(255, 255, 255, 0.1)' },
  surface: { light: 'rgba(0, 0, 0, 0.04)', dark: 'rgba(255, 255, 255, 0.06)' },
  'surface-hover': { light: 'rgba(0, 0, 0, 0.07)', dark: 'rgba(255, 255, 255, 0.12)' },
  selected: { light: 'rgba(0, 113, 227, 0.1)', dark: 'rgba(10, 132, 255, 0.18)' },
  hover: { light: 'rgba(0, 0, 0, 0.05)', dark: 'rgba(255, 255, 255, 0.08)' },

  // —— 文字：Apple 的 label 阶梯，冷调近黑 / 近白 ——
  foreground: { light: '#1d1d1f', dark: '#f5f5f7' },
  'foreground-inverse': { light: '#ffffff', dark: '#000000' },
  'foreground-subtle': {
    light: 'color-mix(in oklab, #1d1d1f 62%, transparent)',
    dark: 'color-mix(in oklab, #f5f5f7 64%, transparent)',
  },
  'foreground-subtlest': {
    light: 'color-mix(in oklab, #1d1d1f 42%, transparent)',
    dark: 'color-mix(in oklab, #f5f5f7 42%, transparent)',
  },
  'remote-foreground-muted': { light: '#6e6e73', dark: '#a1a1a6' },

  // —— 品牌与主操作：Apple 系统蓝 ——
  brand: { light: '#0071e3', dark: '#0a84ff' },
  primary: { light: '#0071e3', dark: '#0a84ff' },
  'primary-foreground': { light: '#ffffff', dark: '#ffffff' },

  // —— 边框：玻璃用「光」而非灰线 ——
  border: { light: 'rgba(0, 0, 0, 0.08)', dark: 'rgba(255, 255, 255, 0.12)' },
  'border-hover': { light: 'rgba(0, 0, 0, 0.14)', dark: 'rgba(255, 255, 255, 0.2)' },
  'card-border': { light: 'rgba(255, 255, 255, 0.9)', dark: 'rgba(255, 255, 255, 0.14)' },
  'card-selected': { light: 'rgba(255, 255, 255, 0.94)', dark: 'rgba(56, 59, 68, 0.94)' },
  'input-border': { light: 'rgba(0, 0, 0, 0.1)', dark: 'rgba(255, 255, 255, 0.14)' },
  'input-border-focused': { light: '#0071e3', dark: '#0a84ff' },
  'input-border-hover': { light: 'rgba(0, 0, 0, 0.16)', dark: 'rgba(255, 255, 255, 0.22)' },
  'input-focused': { light: 'rgba(255, 255, 255, 0.96)', dark: 'rgba(60, 63, 72, 0.94)' },

  // —— 状态：Apple 系统语义色 ——
  success: { light: '#248a3d', dark: '#30d158' },
  'success-foreground': { light: '#ffffff', dark: '#000000' },
  'success-surface': { light: 'rgba(36, 138, 61, 0.12)', dark: 'rgba(48, 209, 88, 0.18)' },
  'success-surface-foreground': { light: '#1a6b2f', dark: '#6ee787' },
  warning: { light: '#c93400', dark: '#ff9f0a' },
  'warning-foreground': { light: '#ffffff', dark: '#000000' },
  'warning-surface': { light: 'rgba(255, 149, 0, 0.14)', dark: 'rgba(255, 159, 10, 0.18)' },
  'warning-surface-foreground': { light: '#96400a', dark: '#ffc078' },
  destructive: { light: '#d70015', dark: '#ff453a' },
  'destructive-foreground': { light: '#ffffff', dark: '#ffffff' },
  'destructive-surface': { light: 'rgba(215, 0, 21, 0.1)', dark: 'rgba(255, 69, 58, 0.18)' },
  'destructive-surface-foreground': { light: '#a50011', dark: '#ff8a80' },
  'idle-task': { light: '#5e5ce6', dark: '#7d7aff' },
  'idle-task-surface': { light: 'rgba(94, 92, 230, 0.12)', dark: 'rgba(125, 122, 255, 0.18)' },

  // —— Diff / Git ——
  'diff-added': { light: '#248a3d', dark: '#30d158' },
  'diff-added-foreground': { light: '#ffffff', dark: '#000000' },
  'diff-removed': { light: '#d70015', dark: '#ff453a' },
  'diff-removed-foreground': { light: '#ffffff', dark: '#000000' },
  'code-diff-added': { light: 'rgba(36, 138, 61, 0.1)', dark: 'rgba(48, 209, 88, 0.14)' },
  'code-diff-deleted': { light: 'rgba(215, 0, 21, 0.09)', dark: 'rgba(255, 69, 58, 0.14)' },
  'file-diff-added-bg': { light: 'rgba(36, 138, 61, 0.13)', dark: 'rgba(48, 209, 88, 0.16)' },
  'file-diff-added-gutter': { light: 'rgba(36, 138, 61, 0.2)', dark: 'rgba(48, 209, 88, 0.24)' },
  'file-diff-added-marker': { light: '#248a3d', dark: '#30d158' },
  'file-diff-deleted-bg': { light: 'rgba(215, 0, 21, 0.11)', dark: 'rgba(255, 69, 58, 0.16)' },
  'file-diff-deleted-gutter': { light: 'rgba(215, 0, 21, 0.18)', dark: 'rgba(255, 69, 58, 0.24)' },
  'file-diff-deleted-marker': { light: '#d70015', dark: '#ff453a' },
  'git-added': { light: '#248a3d', dark: '#30d158' },
  'git-deleted': { light: '#d70015', dark: '#ff453a' },
  'git-modified': { light: '#b25000', dark: '#ff9f0a' },
  'git-descendant': { light: '#b25000', dark: '#ff9f0a' },
  'git-renamed': { light: '#0071e3', dark: '#0a84ff' },
  'git-untracked': { light: '#248a3d', dark: '#30d158' },
  'git-ignored': '@foreground-subtlest',
  'git-none': '@foreground',

  // —— Mention 节点：Apple 系统色，饱和度压低一档以贴合玻璃质感 ——
  'file-node': { light: 'rgba(0, 113, 227, 0.12)', dark: 'rgba(10, 132, 255, 0.2)' },
  'file-node-foreground': { light: '#0062c4', dark: '#7db9ff' },
  'file-node-hover': { light: 'rgba(0, 113, 227, 0.18)', dark: 'rgba(10, 132, 255, 0.28)' },
  'skill-node': { light: 'rgba(137, 68, 171, 0.12)', dark: 'rgba(191, 90, 242, 0.2)' },
  'skill-node-foreground': { light: '#8944ab', dark: '#d8a2f5' },
  'skill-node-hover': { light: 'rgba(137, 68, 171, 0.18)', dark: 'rgba(191, 90, 242, 0.28)' },
  'command-node': { light: 'rgba(99, 99, 102, 0.12)', dark: 'rgba(174, 174, 178, 0.2)' },
  'command-node-foreground': { light: '#636366', dark: '#c7c7cc' },
  'command-node-hover': { light: 'rgba(99, 99, 102, 0.18)', dark: 'rgba(174, 174, 178, 0.28)' },
  'subagent-node': { light: 'rgba(0, 137, 123, 0.12)', dark: 'rgba(102, 212, 207, 0.2)' },
  'subagent-node-foreground': { light: '#007c70', dark: '#8ce0da' },
  'subagent-node-hover': { light: 'rgba(0, 137, 123, 0.18)', dark: 'rgba(102, 212, 207, 0.28)' },
  'session-node': { light: 'rgba(178, 80, 0, 0.12)', dark: 'rgba(255, 159, 10, 0.2)' },
  'session-node-foreground': { light: '#a04a00', dark: '#ffc078' },
  'session-node-hover': { light: 'rgba(178, 80, 0, 0.18)', dark: 'rgba(255, 159, 10, 0.28)' },
  'plugin-node': { light: 'rgba(94, 92, 230, 0.12)', dark: 'rgba(125, 122, 255, 0.2)' },
  'plugin-node-foreground': { light: '#4a48c4', dark: '#a9a7ff' },
  'plugin-node-hover': { light: 'rgba(94, 92, 230, 0.18)', dark: 'rgba(125, 122, 255, 0.28)' },

  // —— 轨迹 ——
  'trajectory-user': { light: '#0071e3', dark: '#0a84ff' },
  'trajectory-assistant': { light: '#007c70', dark: '#66d4cf' },
  'trajectory-reasoning': { light: '#8944ab', dark: '#bf5af2' },
  'trajectory-tool-call': { light: '#b25000', dark: '#ff9f0a' },
  'trajectory-tool-result': { light: '#0062c4', dark: '#64d2ff' },

  // —— 代码 / Markdown ——
  'markdown-inline-code': { light: 'rgba(0, 0, 0, 0.06)', dark: 'rgba(255, 255, 255, 0.1)' },
  'find-highlight': { light: 'rgba(255, 214, 10, 0.35)', dark: 'rgba(255, 214, 10, 0.3)' },
  'find-highlight-active': { light: 'rgba(255, 159, 10, 0.6)', dark: 'rgba(255, 179, 64, 0.6)' },

  // —— 终端：Apple Terminal 的「Basic」配色，暗色用 Pro 主题 ——
  'terminal-bg': { light: 'rgba(250, 251, 253, 0.86)', dark: 'rgba(22, 23, 28, 0.86)' },
  'terminal-fg': { light: '#1d1d1f', dark: '#f5f5f7' },
  'terminal-black': { light: '#1d1d1f', dark: '#48484a' },
  'terminal-red': { light: '#c41a16', dark: '#ff453a' },
  'terminal-green': { light: '#007400', dark: '#32d74b' },
  'terminal-yellow': { light: '#826b28', dark: '#ffd60a' },
  'terminal-blue': { light: '#0000ff', dark: '#0a84ff' },
  'terminal-magenta': { light: '#8b008b', dark: '#bf5af2' },
  'terminal-cyan': { light: '#007c7c', dark: '#64d2ff' },
  'terminal-white': { light: '#c7c7cc', dark: '#d1d1d6' },
  'terminal-bright-black': { light: '#8e8e93', dark: '#8e8e93' },
  'terminal-bright-red': { light: '#ff3b30', dark: '#ff6961' },
  'terminal-bright-green': { light: '#32d74b', dark: '#5ce67a' },
  'terminal-bright-yellow': { light: '#ffcc00', dark: '#ffd60a' },
  'terminal-bright-blue': { light: '#007aff', dark: '#64a8ff' },
  'terminal-bright-magenta': { light: '#bf5af2', dark: '#da8fff' },
  'terminal-bright-cyan': { light: '#5ac8fa', dark: '#8ee5ff' },
  'terminal-bright-white': { light: '#f5f5f7', dark: '#ffffff' },
  'terminal-cursor': { light: '#0071e3', dark: '#0a84ff' },
  'terminal-cursor-accent': { light: '#ffffff', dark: '#141519' },
  'terminal-selection': { light: 'rgba(0, 113, 227, 0.22)', dark: 'rgba(10, 132, 255, 0.3)' },
  'terminal-selection-inactive': { light: 'rgba(0, 0, 0, 0.08)', dark: 'rgba(255, 255, 255, 0.12)' },

  // —— 用量图 / 上下文分解 ——
  'usage-chart-1': { light: '#0071e3', dark: '#0a84ff' },
  'usage-chart-2': { light: '#248a3d', dark: '#30d158' },
  'usage-chart-3': { light: '#8944ab', dark: '#bf5af2' },
  'usage-chart-4': { light: '#d70015', dark: '#ff453a' },
  'usage-chart-5': { light: '#b25000', dark: '#ff9f0a' },
  'usage-chart-6': { light: '#007c7c', dark: '#64d2ff' },
  'context-breakdown-1': { light: '#0071e3', dark: '#0a84ff' },
  'context-breakdown-2': { light: '#3b93e8', dark: '#4a9dff' },
  'context-breakdown-3': { light: '#6aaee9', dark: '#7db9ff' },
  'context-breakdown-4': { light: '#94c5ee', dark: '#a8d0ff' },
  'context-breakdown-5': { light: '#b8d8f2', dark: '#c9e0ff' },
  'context-breakdown-6': { light: '#d3e6f7', dark: '#dceaff' },
  'context-breakdown-7': { light: '#e8f1fa', dark: '#eaf2ff' },
  'usage-heatmap-0': { light: 'rgba(0, 113, 227, 0.04)', dark: 'rgba(10, 132, 255, 0.06)' },
  'usage-heatmap-1': { light: 'rgba(0, 113, 227, 0.18)', dark: 'rgba(10, 132, 255, 0.24)' },
  'usage-heatmap-2': { light: 'rgba(0, 113, 227, 0.36)', dark: 'rgba(10, 132, 255, 0.44)' },
  'usage-heatmap-3': { light: 'rgba(0, 113, 227, 0.58)', dark: 'rgba(10, 132, 255, 0.66)' },
  'usage-heatmap-4': { light: 'rgba(0, 98, 196, 0.82)', dark: 'rgba(125, 185, 255, 0.82)' },

  // —— 远程环境标签 ——
  'remote-ssh-surface': { light: 'rgba(0, 113, 227, 0.12)', dark: 'rgba(10, 132, 255, 0.18)' },
  'remote-ssh-border': { light: 'rgba(0, 113, 227, 0.28)', dark: 'rgba(10, 132, 255, 0.42)' },
  'remote-ssh-foreground': { light: '#0062c4', dark: '#8fc0ff' },
  'remote-docker-surface': { light: 'rgba(94, 92, 230, 0.12)', dark: 'rgba(125, 122, 255, 0.18)' },
  'remote-docker-border': { light: 'rgba(94, 92, 230, 0.28)', dark: 'rgba(125, 122, 255, 0.42)' },
  'remote-docker-foreground': { light: '#4a48c4', dark: '#bfaaff' },
  'remote-wsl-surface': { light: 'rgba(36, 138, 61, 0.12)', dark: 'rgba(48, 209, 88, 0.18)' },
  'remote-wsl-border': { light: 'rgba(36, 138, 61, 0.28)', dark: 'rgba(48, 209, 88, 0.42)' },
  'remote-wsl-foreground': { light: '#1a6b2f', dark: '#87d9a4' },

  // —— 其它 ——
  'interaction-ask-surface': { light: 'rgba(0, 113, 227, 0.1)', dark: 'rgba(10, 132, 255, 0.16)' },
  'interaction-ask-foreground': { light: '#0062c4', dark: '#8fc0ff' },
  'interaction-ask-fill': { light: 'rgba(0, 113, 227, 0.18)', dark: 'rgba(10, 132, 255, 0.24)' },
  'interaction-confirmation-surface': { light: 'rgba(36, 138, 61, 0.12)', dark: 'rgba(48, 209, 88, 0.16)' },
  'interaction-confirmation-foreground': { light: '#1a6b2f', dark: '#87d9a4' },
  'progress-surface': { light: 'rgba(0, 113, 227, 0.12)', dark: 'rgba(10, 132, 255, 0.18)' },
  'progress-surface-foreground': { light: '#0062c4', dark: '#93c5fd' },
  'plugin-paid-plan-badge': { light: 'rgba(255, 149, 0, 0.18)', dark: 'rgba(255, 159, 10, 0.24)' },
  'plugin-paid-plan-badge-foreground': { light: '#8a4b00', dark: '#ffd8b8' },
  'feedback-privacy-hint': { light: '#b25000', dark: '#ffd60a' },
  'resize-handle': { light: 'rgba(0, 113, 227, 0.6)', dark: 'rgba(10, 132, 255, 0.7)' },
  'workflow-rule': { light: 'rgba(0, 0, 0, 0.055)', dark: 'rgba(255, 255, 255, 0.07)' },
  'workflow-trace': { light: 'rgba(0, 0, 0, 0.28)', dark: 'rgba(255, 255, 255, 0.34)' },
  'workflow-trace-strong': { light: 'rgba(0, 0, 0, 0.52)', dark: 'rgba(255, 255, 255, 0.58)' },
  white: { light: '#ffffff', dark: '#ffffff' },
}

/**
 * 苹果玻璃的材质参数：大圆角、真实模糊、饱和提升、双层轮廓光。
 *
 * 这些值由 `glass.css` 消费。之所以放在 token 层而不是 CSS 字面量，是为了让
 * 用户自定义（背景模糊强度等）能在运行时覆盖，而不必重写整份样式表。
 */
export const GLASS_MATERIAL = {
  '--ts-blur': '30px',
  '--ts-saturate': '180%',
  '--ts-glass-tint': 'rgba(255, 255, 255, 0.42)',
  '--ts-glass-highlight': 'rgba(255, 255, 255, 0.72)',
  '--ts-glass-edge': 'rgba(255, 255, 255, 0.9)',
  '--ts-surface-alpha': '82%',
  // 「壁纸」：两层低饱和径向渐变，模拟 macOS 默认壁纸的柔焦观感。
  // 亮色是冷白偏蓝的晨光，暗色是深空蓝紫的夜光。
  //
  // 透明度经过实测调校：太淡（<0.3）在深色画布上几乎看不见，玻璃就失去
  // 「有东西透上来」的依据；太浓（>0.7）会和半透明卡片叠成脏色。
  '--ts-wallpaper-1': {
    light: 'rgba(186, 208, 245, 0.85)',
    dark: 'rgba(58, 92, 160, 0.85)',
  },
  '--ts-wallpaper-2': {
    light: 'rgba(226, 214, 245, 0.8)',
    dark: 'rgba(104, 62, 148, 0.75)',
  },
  // Apple 的连续圆角观感：比 ZCode 的 6px 面板大得多
  '--dsw-radius-sm': '10px',
  '--dsw-radius-md': '14px',
  '--dsw-radius-lg': '18px',
  '--dsw-radius-xl': '22px',
  '--dsw-radius-panel': '26px',
  '--dsw-radius-s': '10px',
  '--dsw-radius-m': '14px',
  '--dsw-radius-l': '18px',
  // 玻璃的阴影要「软而远」，不是硬投影
  '--dsw-shadow-lv1': '0 1px 3px 0 rgba(0, 0, 0, 0.06), 0 1px 2px 0 rgba(0, 0, 0, 0.04)',
  '--dsw-shadow-lv2': '0 4px 16px 0 rgba(0, 0, 0, 0.08), 0 1px 4px 0 rgba(0, 0, 0, 0.04)',
  '--dsw-shadow-lv3':
    '0 12px 40px 0 rgba(0, 0, 0, 0.14), 0 2px 8px 0 rgba(0, 0, 0, 0.06), 0 0 0 0.5px rgba(0, 0, 0, 0.06)',
  '--dsw-elevation-soft': '0 1px 3px 0 rgba(0, 0, 0, 0.06)',
  '--dsw-elevation-panel': '0 10px 32px 0 rgba(0, 0, 0, 0.12)',
  '--dsw-elevation-prominent':
    '0 24px 64px 0 rgba(0, 0, 0, 0.2), 0 0 0 0.5px rgba(255, 255, 255, 0.24) inset',
  '--dsw-elevation-stroke-color': 'rgba(255, 255, 255, 0.5)',
  '--dsw-mask-blur': 'blur(3px)',
}

/**
 * 玻璃主题的暗色材质覆盖。
 *
 * 亮色玻璃靠「白色高光」立起来，暗色玻璃必须换成「冷调轮廓光」——
 * 同一条 0.72 白高光放到深色背景上会变成刺眼的白边。
 */
export const GLASS_MATERIAL_DARK = {
  '--ts-glass-tint': 'rgba(120, 140, 180, 0.14)',
  '--ts-glass-highlight': 'rgba(255, 255, 255, 0.16)',
  '--ts-glass-edge': 'rgba(255, 255, 255, 0.2)',
}
