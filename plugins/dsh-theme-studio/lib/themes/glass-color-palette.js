/**
 * 玻璃彩色（Glass Color）变体。
 *
 * 基座玻璃主题刻意保持低饱和冷调（贴近 Apple 原生观感）。本变体把**色相**
 * 加回来，但只加在「表面」与「强调」两处，文字与边框仍保持中性：
 *
 *   - 表面层（面板、卡片、输入框、侧栏）叠一层柔和的紫蓝渐变色相，
 *     让玻璃透出的不是灰白，而是有色玻璃；
 *   - 强调色（品牌、选中态、mention 节点、轨迹、用量图）使用更鲜艳的
 *     Apple 系统色（SystemIndigo / SystemPink / SystemTeal），
 *     与 macOS「多彩外观」一致；
 *   - **文字与边框不改**——这是它仍然可读的原因。彩色玻璃最怕的是把文字
 *     也染上色相，那样对比度会随背景漂移，暗色下尤其糟。
 *
 * 材质上调高模糊与饱和度，让色相在层间产生真实的「折射」层次。
 *
 * @module dsh-theme-studio/themes/glass-color-palette
 */

/** 相对 GLASS_PALETTE 的覆盖项。 */
export const GLASS_COLOR_OVERRIDES = {
  // —— 表面：带色相的半透明玻璃 ——
  // 亮色偏冷紫，暗色偏深靛蓝；透明度略高于基座，让色相透出来。
  // 同基座：内容卡必须半透明，否则壁纸透不进来（见 glass-palette.js 的说明）
  background: { light: 'rgba(238, 240, 249, 0.82)', dark: 'rgba(21, 21, 32, 0.8)' },
  'background-alt': {
    light: 'color-mix(in oklab, #eef0f9 70%, transparent)',
    dark: 'color-mix(in oklab, #1e1e2e 60%, transparent)',
  },
  'background-win-alt': { light: '#e3e6f4', dark: '#0f0f18' },
  panel: { light: 'rgba(244, 246, 255, 0.64)', dark: 'rgba(34, 36, 50, 0.66)' },
  card: { light: 'rgba(250, 251, 255, 0.76)', dark: 'rgba(46, 48, 66, 0.76)' },
  input: { light: 'rgba(250, 251, 255, 0.70)', dark: 'rgba(48, 50, 68, 0.72)' },
  menu: { light: 'rgba(248, 249, 255, 0.72)', dark: 'rgba(40, 42, 58, 0.74)' },
  popover: { light: 'rgba(248, 249, 255, 0.76)', dark: 'rgba(42, 44, 60, 0.78)' },
  'popover-header': { light: 'rgba(244, 245, 255, 0.9)', dark: 'rgba(40, 42, 58, 0.92)' },
  sidebar: { light: 'rgba(238, 240, 252, 0.58)', dark: 'rgba(20, 21, 30, 0.60)' },
  header: { light: 'rgba(250, 251, 255, 0.6)', dark: 'rgba(26, 27, 40, 0.6)' },
  'tab-active': { light: 'rgba(255, 255, 255, 0.92)', dark: 'rgba(68, 70, 94, 0.9)' },
  toast: { light: 'rgba(250, 251, 255, 0.94)', dark: 'rgba(52, 54, 74, 0.94)' },
  tooltip: { light: 'rgba(248, 249, 255, 0.94)', dark: 'rgba(46, 48, 66, 0.94)' },
  'card-selected': { light: 'rgba(255, 255, 255, 0.95)', dark: 'rgba(64, 66, 88, 0.94)' },
  'card-border': { light: 'rgba(255, 255, 255, 0.60)', dark: 'rgba(160, 170, 255, 0.08)' },
  'input-focused': { light: 'rgba(255, 255, 255, 0.97)', dark: 'rgba(68, 70, 94, 0.94)' },

  // —— 强调：SystemIndigo，比基座的系统蓝更有「彩色玻璃」味道 ——
  brand: { light: '#5e5ce6', dark: '#7d7aff' },
  primary: { light: '#5e5ce6', dark: '#7d7aff' },
  'primary-foreground': { light: '#ffffff', dark: '#ffffff' },
  'input-border-focused': { light: '#5e5ce6', dark: '#7d7aff' },
  selected: { light: 'rgba(94, 92, 230, 0.14)', dark: 'rgba(125, 122, 255, 0.22)' },
  accent: { light: 'rgba(94, 92, 230, 0.1)', dark: 'rgba(125, 122, 255, 0.16)' },

  // —— 选中态 / 状态：SystemPink、SystemTeal 作为辅助色相 ——
  'idle-task': { light: '#bf5af2', dark: '#da8fff' },
  'idle-task-surface': { light: 'rgba(191, 90, 242, 0.12)', dark: 'rgba(218, 143, 255, 0.18)' },
  success: { light: '#0d9488', dark: '#66d4cf' },
  'success-surface': { light: 'rgba(13, 148, 136, 0.12)', dark: 'rgba(102, 212, 207, 0.18)' },
  'success-surface-foreground': { light: '#0b7268', dark: '#8ce0da' },
  'git-added': { light: '#0d9488', dark: '#66d4cf' },
  'git-untracked': { light: '#0d9488', dark: '#66d4cf' },
  'diff-added': { light: '#0d9488', dark: '#66d4cf' },
  'file-diff-added-marker': { light: '#0d9488', dark: '#66d4cf' },
  'terminal-green': { light: '#0d9488', dark: '#66d4cf' },
  'terminal-bright-green': { light: '#14b8a6', dark: '#8ce0da' },
  'code-diff-added': { light: 'rgba(13, 148, 136, 0.1)', dark: 'rgba(102, 212, 207, 0.14)' },
  'file-diff-added-bg': { light: 'rgba(13, 148, 136, 0.13)', dark: 'rgba(102, 212, 207, 0.16)' },
  'file-diff-added-gutter': { light: 'rgba(13, 148, 136, 0.2)', dark: 'rgba(102, 212, 207, 0.24)' },
  'usage-chart-2': { light: '#0d9488', dark: '#66d4cf' },

  // —— mention 节点：整组换成系统色，色相更鲜明 ——
  'file-node': { light: 'rgba(94, 92, 230, 0.12)', dark: 'rgba(125, 122, 255, 0.2)' },
  'file-node-foreground': { light: '#4a48c4', dark: '#a9a7ff' },
  'file-node-hover': { light: 'rgba(94, 92, 230, 0.18)', dark: 'rgba(125, 122, 255, 0.28)' },
  'skill-node': { light: 'rgba(191, 90, 242, 0.12)', dark: 'rgba(218, 143, 255, 0.2)' },
  'skill-node-foreground': { light: '#9b3fc4', dark: '#e0b0ff' },
  'skill-node-hover': { light: 'rgba(191, 90, 242, 0.18)', dark: 'rgba(218, 143, 255, 0.28)' },
  'subagent-node': { light: 'rgba(13, 148, 136, 0.12)', dark: 'rgba(102, 212, 207, 0.2)' },
  'subagent-node-foreground': { light: '#0b7268', dark: '#8ce0da' },
  'subagent-node-hover': { light: 'rgba(13, 148, 136, 0.18)', dark: 'rgba(102, 212, 207, 0.28)' },
  'session-node': { light: 'rgba(255, 159, 10, 0.14)', dark: 'rgba(255, 179, 64, 0.2)' },
  'session-node-foreground': { light: '#a04a00', dark: '#ffc078' },
  'session-node-hover': { light: 'rgba(255, 159, 10, 0.2)', dark: 'rgba(255, 179, 64, 0.28)' },
  'plugin-node': { light: 'rgba(255, 55, 95, 0.12)', dark: 'rgba(255, 105, 140, 0.2)' },
  'plugin-node-foreground': { light: '#c4183c', dark: '#ff8fa8' },
  'plugin-node-hover': { light: 'rgba(255, 55, 95, 0.18)', dark: 'rgba(255, 105, 140, 0.28)' },

  // —— 轨迹：多彩但保持系统色 ——
  'trajectory-user': { light: '#5e5ce6', dark: '#7d7aff' },
  'trajectory-assistant': { light: '#0d9488', dark: '#66d4cf' },
  'trajectory-reasoning': { light: '#bf5af2', dark: '#da8fff' },
  'trajectory-tool-call': { light: '#c93400', dark: '#ff9f0a' },
  'trajectory-tool-result': { light: '#0071e3', dark: '#64d2ff' },

  // —— 用量图 / 上下文分解：紫蓝主调 ——
  'usage-chart-1': { light: '#5e5ce6', dark: '#7d7aff' },
  'usage-chart-3': { light: '#bf5af2', dark: '#da8fff' },
  'usage-chart-6': { light: '#0071e3', dark: '#64d2ff' },
  'context-breakdown-1': { light: '#5e5ce6', dark: '#7d7aff' },
  'context-breakdown-2': { light: '#7c7ae8', dark: '#9593ff' },
  'context-breakdown-3': { light: '#9998ec', dark: '#aeacff' },
  'context-breakdown-4': { light: '#b5b4f1', dark: '#c7c5ff' },
  'context-breakdown-5': { light: '#cccbf5', dark: '#d9d8ff' },
  'context-breakdown-6': { light: '#dedef9', dark: '#e6e5ff' },
  'context-breakdown-7': { light: '#eeeefc', dark: '#f0f0ff' },
  'usage-heatmap-1': { light: 'rgba(94, 92, 230, 0.18)', dark: 'rgba(125, 122, 255, 0.24)' },
  'usage-heatmap-2': { light: 'rgba(94, 92, 230, 0.36)', dark: 'rgba(125, 122, 255, 0.44)' },
  'usage-heatmap-3': { light: 'rgba(94, 92, 230, 0.58)', dark: 'rgba(125, 122, 255, 0.66)' },
  'usage-heatmap-4': { light: 'rgba(74, 72, 196, 0.82)', dark: 'rgba(169, 167, 255, 0.82)' },

  // —— 终端：保留彩色但换成系统色相 ——
  'terminal-cursor': { light: '#5e5ce6', dark: '#7d7aff' },
  'terminal-selection': { light: 'rgba(94, 92, 230, 0.22)', dark: 'rgba(125, 122, 255, 0.3)' },
  'terminal-blue': { light: '#5e5ce6', dark: '#7d7aff' },
  'terminal-bright-blue': { light: '#7c7ae8', dark: '#9593ff' },
  'terminal-magenta': { light: '#bf5af2', dark: '#da8fff' },
  'terminal-bright-magenta': { light: '#d187f5', dark: '#e8b8ff' },
  'terminal-cyan': { light: '#0071e3', dark: '#64d2ff' },
  'terminal-bright-cyan': { light: '#3d9bf0', dark: '#8ee5ff' },
  'terminal-red': { light: '#d70015', dark: '#ff453a' },
  'terminal-bright-red': { light: '#ff3b30', dark: '#ff6961' },

  // —— 远程环境标签：跟随主色相 ——
  'remote-ssh-surface': { light: 'rgba(94, 92, 230, 0.12)', dark: 'rgba(125, 122, 255, 0.18)' },
  'remote-ssh-border': { light: 'rgba(94, 92, 230, 0.28)', dark: 'rgba(125, 122, 255, 0.42)' },
  'remote-ssh-foreground': { light: '#4a48c4', dark: '#a9a7ff' },
  'remote-docker-surface': { light: 'rgba(191, 90, 242, 0.12)', dark: 'rgba(218, 143, 255, 0.18)' },
  'remote-docker-border': { light: 'rgba(191, 90, 242, 0.28)', dark: 'rgba(218, 143, 255, 0.42)' },
  'remote-docker-foreground': { light: '#9b3fc4', dark: '#e0b0ff' },
  'remote-wsl-surface': { light: 'rgba(13, 148, 136, 0.12)', dark: 'rgba(102, 212, 207, 0.18)' },
  'remote-wsl-border': { light: 'rgba(13, 148, 136, 0.28)', dark: 'rgba(102, 212, 207, 0.42)' },
  'remote-wsl-foreground': { light: '#0b7268', dark: '#8ce0da' },

  // —— 其它强调 ——
  'interaction-ask-surface': { light: 'rgba(94, 92, 230, 0.1)', dark: 'rgba(125, 122, 255, 0.16)' },
  'interaction-ask-foreground': { light: '#4a48c4', dark: '#a9a7ff' },
  'interaction-ask-fill': { light: 'rgba(94, 92, 230, 0.18)', dark: 'rgba(125, 122, 255, 0.24)' },
  'interaction-confirmation-surface': { light: 'rgba(13, 148, 136, 0.12)', dark: 'rgba(102, 212, 207, 0.16)' },
  'interaction-confirmation-foreground': { light: '#0b7268', dark: '#8ce0da' },
  'progress-surface': { light: 'rgba(94, 92, 230, 0.12)', dark: 'rgba(125, 122, 255, 0.18)' },
  'progress-surface-foreground': { light: '#4a48c4', dark: '#a9a7ff' },
  'plugin-paid-plan-badge': { light: 'rgba(191, 90, 242, 0.18)', dark: 'rgba(218, 143, 255, 0.24)' },
  'plugin-paid-plan-badge-foreground': { light: '#7a2f9e', dark: '#e8c4ff' },
  'resize-handle': { light: 'rgba(94, 92, 230, 0.6)', dark: 'rgba(125, 122, 255, 0.7)' },
  'find-highlight': { light: 'rgba(191, 90, 242, 0.22)', dark: 'rgba(218, 143, 255, 0.26)' },
  'find-highlight-active': { light: 'rgba(191, 90, 242, 0.5)', dark: 'rgba(218, 143, 255, 0.54)' },
}

/**
 * 彩色玻璃的材质：模糊更强、饱和更高，让色相在层间折射。
 * 其余（圆角、阴影）沿用基座玻璃。
 */
export const GLASS_COLOR_MATERIAL = {
  '--ts-blur': '36px',
  '--ts-saturate': '200%',
  '--ts-glass-tint': 'rgba(226, 228, 255, 0.44)',
  '--ts-glass-highlight': 'rgba(255, 255, 255, 0.60)',
  '--ts-glass-edge': 'rgba(228, 230, 255, 0.55)',
  '--ts-surface-alpha': '84%',
}

/** 彩色玻璃的暗色材质。 */
export const GLASS_COLOR_MATERIAL_DARK = {
  '--ts-glass-tint': 'rgba(120, 122, 200, 0.10)',
  '--ts-glass-highlight': 'rgba(190, 192, 255, 0.08)',
  '--ts-glass-edge': 'rgba(170, 172, 255, 0.08)',
}
