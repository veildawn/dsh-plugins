/**
 * ZCode 单色极简（Monochrome）变体。
 *
 * 设计意图：ZCode 官方主题已经是「单色品牌 + 灰阶层级」，但保留了相当多的
 * 彩色语义（蓝、绿、橙、紫、青）用于 diff / 轨迹 / mention / 终端。在需要
 * 长时间阅读、或投屏/录屏不希望出现彩色干扰的场景，这些颜色反而分散注意力。
 *
 * 本变体把所有**装饰性**彩色收敛到中性灰阶，只保留两个必要的功能色：
 *   - `destructive` 保留红色（危险操作必须一眼可辨，这是安全语义不是装饰）；
 *   - `success` 收敛成深灰（成功态靠图标与文案表达即可）。
 *
 * 终端 ANSI 16 色同样压成灰阶阶梯——这与 ZCode 官方「单色体系」的设计哲学
 * 一脉相承，只是推到了极致。
 *
 * 注意：本变体**不**改布局、圆角、字号，只改色。这样它可以在任何屏幕密度下
 * 与基座互换而不产生版式抖动。
 *
 * @module dsh-theme-studio/themes/zcode-mono-palette
 */

/** 单色变体的灰阶（亮色）。 */
const L = {
  ink: '#1a1a1a',
  ink70: 'color-mix(in oklab, #1a1a1a 68%, transparent)',
  ink45: 'color-mix(in oklab, #1a1a1a 46%, transparent)',
  ink32: 'color-mix(in oklab, #1a1a1a 32%, transparent)',
  paper: '#fafafa',
  panel: '#ffffff',
  card: '#f2f2f2',
  input: '#ffffff',
  hover: 'rgba(0, 0, 0, 0.06)',
  line: 'rgba(0, 0, 0, 0.1)',
  lineStrong: 'rgba(0, 0, 0, 0.18)',
  chip: 'rgba(0, 0, 0, 0.055)',
}

/** 单色变体的灰阶（暗色）。 */
const D = {
  ink: '#e6e6e6',
  ink70: 'color-mix(in oklab, #e6e6e6 66%, transparent)',
  ink45: 'color-mix(in oklab, #e6e6e6 44%, transparent)',
  ink32: 'color-mix(in oklab, #e6e6e6 30%, transparent)',
  paper: '#121212',
  panel: '#1a1a1a',
  card: '#242424',
  input: '#2c2c2c',
  hover: 'rgba(255, 255, 255, 0.08)',
  line: 'rgba(255, 255, 255, 0.1)',
  lineStrong: 'rgba(255, 255, 255, 0.18)',
  chip: 'rgba(255, 255, 255, 0.07)',
}

/**
 * 相对 ZAI_PALETTE 的覆盖项。
 *
 * 只写需要变化的键；其余（圆角、字体、终端以外的材质）全部继承基座。
 */
export const ZCODE_MONO_OVERRIDES = {
  // —— 表面：把 ZCode 的两层底色再压平一档，强化「纸面」感 ——
  background: { light: L.paper, dark: D.paper },
  'background-alt': {
    light: 'color-mix(in oklab, #fafafa 70%, transparent)',
    dark: 'color-mix(in oklab, #1a1a1a 60%, transparent)',
  },
  'background-win-alt': { light: '#ededed', dark: '#0d0d0d' },
  panel: { light: L.panel, dark: D.panel },
  card: { light: L.card, dark: D.card },
  input: { light: L.input, dark: D.input },
  menu: { light: '#fafafa', dark: '#2c2c2c' },
  'menu-hover': { light: L.hover, dark: D.hover },
  sidebar: { light: '#ededed', dark: '#0d0d0d' },
  header: { light: '#fafafa', dark: '#1a1a1a' },
  tab: { light: '#ededed', dark: '#1a1a1a' },
  'tab-active': { light: '#ffffff', dark: '#242424' },
  toast: { light: '#fafafa', dark: '#2c2c2c' },
  tooltip: { light: '#ededed', dark: '#2c2c2c' },
  popover: { light: '#fafafa', dark: '#2c2c2c' },
  'popover-header': { light: '#fafafa', dark: '#1a1a1a' },

  // —— 文字：中性灰阶，去蓝调 ——
  foreground: { light: L.ink, dark: D.ink },
  'foreground-subtle': { light: L.ink70, dark: D.ink70 },
  'foreground-subtlest': { light: L.ink45, dark: D.ink45 },
  'remote-foreground-muted': { light: '#595959', dark: '#b3b3b3' },

  // —— 边框 ——
  border: { light: L.line, dark: D.line },
  'border-hover': { light: L.lineStrong, dark: D.lineStrong },
  'card-border': { light: L.line, dark: D.line },
  'input-border': { light: L.line, dark: D.line },
  'input-border-hover': { light: L.lineStrong, dark: D.lineStrong },
  'input-border-focused': { light: L.lineStrong, dark: D.lineStrong },
  'popover-border': { light: L.line, dark: D.line },
  'tab-border': { light: L.line, dark: D.line },

  // —— 交互 ——
  surface: { light: 'rgba(0, 0, 0, 0.04)', dark: 'rgba(255, 255, 255, 0.06)' },
  'surface-hover': { light: L.hover, dark: D.hover },
  hover: { light: 'rgba(0, 0, 0, 0.04)', dark: 'rgba(255, 255, 255, 0.06)' },
  selected: { light: L.chip, dark: D.chip },
  secondary: { light: L.chip, dark: D.chip },
  tag: { light: L.chip, dark: D.chip },
  'tooltip-tag': { light: L.chip, dark: D.chip },
  'markdown-inline-code': { light: '#ececec', dark: '#333333' },

  // —— 状态：仅保留 destructive 的红色（安全语义），其余收敛为灰 ——
  success: { light: '#3d3d3d', dark: '#c4c4c4' },
  'success-foreground': { light: '#ffffff', dark: '#000000' },
  'success-surface': { light: 'rgba(0, 0, 0, 0.06)', dark: 'rgba(255, 255, 255, 0.08)' },
  'success-surface-foreground': { light: '#3d3d3d', dark: '#c4c4c4' },
  warning: { light: '#5c5c5c', dark: '#a8a8a8' },
  'warning-foreground': { light: '#ffffff', dark: '#000000' },
  'warning-surface': { light: 'rgba(0, 0, 0, 0.05)', dark: 'rgba(255, 255, 255, 0.07)' },
  'warning-surface-foreground': { light: '#4a4a4a', dark: '#bdbdbd' },
  destructive: { light: '#b42318', dark: '#f97066' },
  'destructive-foreground': { light: '#ffffff', dark: '#000000' },
  'destructive-surface': { light: 'rgba(180, 35, 24, 0.1)', dark: 'rgba(249, 112, 102, 0.16)' },
  'destructive-surface-foreground': { light: '#8f1c13', dark: '#fda29b' },
  'idle-task': { light: '#737373', dark: '#8c8c8c' },
  'idle-task-surface': { light: 'rgba(0, 0, 0, 0.05)', dark: 'rgba(255, 255, 255, 0.07)' },

  // —— diff / git：加号减号用灰阶，只保留删除的红 ——
  'diff-added': { light: '#3d3d3d', dark: '#c4c4c4' },
  'diff-added-foreground': { light: '#ffffff', dark: '#000000' },
  'diff-removed': { light: '#b42318', dark: '#f97066' },
  'diff-removed-foreground': { light: '#ffffff', dark: '#000000' },
  'code-diff-added': { light: 'rgba(0, 0, 0, 0.05)', dark: 'rgba(255, 255, 255, 0.07)' },
  'code-diff-deleted': { light: 'rgba(180, 35, 24, 0.07)', dark: 'rgba(249, 112, 102, 0.12)' },
  'file-diff-added-bg': { light: 'rgba(0, 0, 0, 0.055)', dark: 'rgba(255, 255, 255, 0.075)' },
  'file-diff-added-gutter': { light: 'rgba(0, 0, 0, 0.09)', dark: 'rgba(255, 255, 255, 0.11)' },
  'file-diff-added-marker': { light: '#3d3d3d', dark: '#c4c4c4' },
  'file-diff-deleted-bg': { light: 'rgba(180, 35, 24, 0.08)', dark: 'rgba(249, 112, 102, 0.13)' },
  'file-diff-deleted-gutter': { light: 'rgba(180, 35, 24, 0.14)', dark: 'rgba(249, 112, 102, 0.2)' },
  'file-diff-deleted-marker': { light: '#b42318', dark: '#f97066' },
  'git-added': { light: '#3d3d3d', dark: '#c4c4c4' },
  'git-deleted': { light: '#b42318', dark: '#f97066' },
  'git-modified': { light: '#6b6b6b', dark: '#9e9e9e' },
  'git-descendant': { light: '#6b6b6b', dark: '#9e9e9e' },
  'git-renamed': { light: '#525252', dark: '#a8a8a8' },
  'git-untracked': { light: '#3d3d3d', dark: '#c4c4c4' },

  // —— mention 节点：全部灰阶，靠深浅区分类型 ——
  'file-node': { light: 'rgba(0, 0, 0, 0.06)', dark: 'rgba(255, 255, 255, 0.08)' },
  'file-node-foreground': { light: '#333333', dark: '#d6d6d6' },
  'file-node-hover': { light: 'rgba(0, 0, 0, 0.1)', dark: 'rgba(255, 255, 255, 0.12)' },
  'skill-node': { light: 'rgba(0, 0, 0, 0.08)', dark: 'rgba(255, 255, 255, 0.1)' },
  'skill-node-foreground': { light: '#2b2b2b', dark: '#e0e0e0' },
  'skill-node-hover': { light: 'rgba(0, 0, 0, 0.12)', dark: 'rgba(255, 255, 255, 0.14)' },
  'command-node': { light: 'rgba(0, 0, 0, 0.05)', dark: 'rgba(255, 255, 255, 0.07)' },
  'command-node-foreground': { light: '#4a4a4a', dark: '#c9c9c9' },
  'command-node-hover': { light: 'rgba(0, 0, 0, 0.09)', dark: 'rgba(255, 255, 255, 0.11)' },
  'subagent-node': { light: 'rgba(0, 0, 0, 0.07)', dark: 'rgba(255, 255, 255, 0.09)' },
  'subagent-node-foreground': { light: '#3a3a3a', dark: '#d2d2d2' },
  'subagent-node-hover': { light: 'rgba(0, 0, 0, 0.11)', dark: 'rgba(255, 255, 255, 0.13)' },
  'session-node': { light: 'rgba(0, 0, 0, 0.06)', dark: 'rgba(255, 255, 255, 0.08)' },
  'session-node-foreground': { light: '#404040', dark: '#cccccc' },
  'session-node-hover': { light: 'rgba(0, 0, 0, 0.1)', dark: 'rgba(255, 255, 255, 0.12)' },
  'plugin-node': { light: 'rgba(0, 0, 0, 0.08)', dark: 'rgba(255, 255, 255, 0.1)' },
  'plugin-node-foreground': { light: '#2b2b2b', dark: '#e0e0e0' },
  'plugin-node-hover': { light: 'rgba(0, 0, 0, 0.12)', dark: 'rgba(255, 255, 255, 0.14)' },

  // —— 轨迹：灰阶阶梯 ——
  'trajectory-user': { light: '#1a1a1a', dark: '#e6e6e6' },
  'trajectory-assistant': { light: '#4a4a4a', dark: '#bdbdbd' },
  'trajectory-reasoning': { light: '#6b6b6b', dark: '#9e9e9e' },
  'trajectory-tool-call': { light: '#7d7d7d', dark: '#8c8c8c' },
  'trajectory-tool-result': { light: '#5c5c5c', dark: '#a8a8a8' },

  // —— 终端：ANSI 压成灰阶阶梯（官方单色哲学的极端版）——
  'terminal-bg': { light: L.paper, dark: D.paper },
  'terminal-fg': { light: L.ink, dark: D.ink },
  'terminal-black': { light: '#4a4a4a', dark: '#2c2c2c' },
  'terminal-red': { light: '#b42318', dark: '#f97066' },
  'terminal-green': { light: '#3d3d3d', dark: '#c4c4c4' },
  'terminal-yellow': { light: '#5c5c5c', dark: '#a8a8a8' },
  'terminal-blue': { light: '#333333', dark: '#d0d0d0' },
  'terminal-magenta': { light: '#525252', dark: '#b3b3b3' },
  'terminal-cyan': { light: '#454545', dark: '#c0c0c0' },
  'terminal-white': { light: '#a8a8a8', dark: '#adadad' },
  'terminal-bright-black': { light: '#8a8a8a', dark: '#757575' },
  'terminal-bright-red': { light: '#d92d20', dark: '#fda29b' },
  'terminal-bright-green': { light: '#5c5c5c', dark: '#dcdcdc' },
  'terminal-bright-yellow': { light: '#757575', dark: '#c9c9c9' },
  'terminal-bright-blue': { light: '#454545', dark: '#e8e8e8' },
  'terminal-bright-magenta': { light: '#6b6b6b', dark: '#c4c4c4' },
  'terminal-bright-cyan': { light: '#525252', dark: '#d6d6d6' },
  'terminal-bright-white': { light: '#1a1a1a', dark: '#f5f5f5' },
  'terminal-cursor': { light: L.ink, dark: D.ink },
  'terminal-cursor-accent': { light: L.paper, dark: D.paper },
  'terminal-selection': { light: 'rgba(0, 0, 0, 0.14)', dark: 'rgba(255, 255, 255, 0.18)' },
  'terminal-selection-inactive': { light: 'rgba(0, 0, 0, 0.08)', dark: 'rgba(255, 255, 255, 0.1)' },

  // —— 用量图 / 上下文分解：单色深浅阶梯 ——
  'usage-chart-1': { light: '#1a1a1a', dark: '#e6e6e6' },
  'usage-chart-2': { light: '#3d3d3d', dark: '#c4c4c4' },
  'usage-chart-3': { light: '#5c5c5c', dark: '#a8a8a8' },
  'usage-chart-4': { light: '#7d7d7d', dark: '#8c8c8c' },
  'usage-chart-5': { light: '#9e9e9e', dark: '#6b6b6b' },
  'usage-chart-6': { light: '#bdbdbd', dark: '#525252' },
  'context-breakdown-1': { light: '#1a1a1a', dark: '#e6e6e6' },
  'context-breakdown-2': { light: '#404040', dark: '#c9c9c9' },
  'context-breakdown-3': { light: '#666666', dark: '#adadad' },
  'context-breakdown-4': { light: '#8c8c8c', dark: '#8f8f8f' },
  'context-breakdown-5': { light: '#b0b0b0', dark: '#707070' },
  'context-breakdown-6': { light: '#cccccc', dark: '#575757' },
  'context-breakdown-7': { light: '#e6e6e6', dark: '#404040' },
  'usage-heatmap-0': { light: 'rgba(0, 0, 0, 0.04)', dark: 'rgba(255, 255, 255, 0.05)' },
  'usage-heatmap-1': { light: 'rgba(0, 0, 0, 0.16)', dark: 'rgba(255, 255, 255, 0.2)' },
  'usage-heatmap-2': { light: 'rgba(0, 0, 0, 0.32)', dark: 'rgba(255, 255, 255, 0.36)' },
  'usage-heatmap-3': { light: 'rgba(0, 0, 0, 0.52)', dark: 'rgba(255, 255, 255, 0.54)' },
  'usage-heatmap-4': { light: 'rgba(0, 0, 0, 0.76)', dark: 'rgba(255, 255, 255, 0.78)' },

  // —— 远程环境标签：靠灰度与边框区分，不用色相 ——
  'remote-ssh-surface': { light: 'rgba(0, 0, 0, 0.05)', dark: 'rgba(255, 255, 255, 0.07)' },
  'remote-ssh-border': { light: L.line, dark: D.line },
  'remote-ssh-foreground': { light: '#3d3d3d', dark: '#c4c4c4' },
  'remote-docker-surface': { light: 'rgba(0, 0, 0, 0.07)', dark: 'rgba(255, 255, 255, 0.09)' },
  'remote-docker-border': { light: L.lineStrong, dark: D.lineStrong },
  'remote-docker-foreground': { light: '#2b2b2b', dark: '#d6d6d6' },
  'remote-wsl-surface': { light: 'rgba(0, 0, 0, 0.06)', dark: 'rgba(255, 255, 255, 0.08)' },
  'remote-wsl-border': { light: L.line, dark: D.line },
  'remote-wsl-foreground': { light: '#333333', dark: '#d0d0d0' },

  // —— 其它装饰色 ——
  'interaction-ask-surface': { light: 'rgba(0, 0, 0, 0.05)', dark: 'rgba(255, 255, 255, 0.07)' },
  'interaction-ask-foreground': { light: '#333333', dark: '#d0d0d0' },
  'interaction-ask-fill': { light: 'rgba(0, 0, 0, 0.09)', dark: 'rgba(255, 255, 255, 0.11)' },
  'interaction-confirmation-surface': { light: 'rgba(0, 0, 0, 0.06)', dark: 'rgba(255, 255, 255, 0.08)' },
  'interaction-confirmation-foreground': { light: '#3d3d3d', dark: '#c4c4c4' },
  'progress-surface': { light: 'rgba(0, 0, 0, 0.06)', dark: 'rgba(255, 255, 255, 0.08)' },
  'progress-surface-foreground': { light: '#3d3d3d', dark: '#c4c4c4' },
  'plugin-paid-plan-badge': { light: 'rgba(0, 0, 0, 0.08)', dark: 'rgba(255, 255, 255, 0.1)' },
  'plugin-paid-plan-badge-foreground': { light: '#2b2b2b', dark: '#e0e0e0' },
  'feedback-privacy-hint': { light: '#6b6b6b', dark: '#9e9e9e' },
  'resize-handle': { light: '#8a8a8a', dark: '#757575' },
  'find-highlight': { light: 'rgba(0, 0, 0, 0.1)', dark: 'rgba(255, 255, 255, 0.14)' },
  'find-highlight-active': { light: 'rgba(0, 0, 0, 0.26)', dark: 'rgba(255, 255, 255, 0.3)' },
}
