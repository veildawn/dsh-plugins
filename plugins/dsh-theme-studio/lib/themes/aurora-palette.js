/**
 * 极光流光（Aurora Flow）主题色板。
 *
 * 设计定位：玻璃材质 + **动态有机光**。与「苹果玻璃」的区别不在透明度，
 * 而在光从哪来——
 *
 *   - 苹果玻璃的光来自**壁纸**：低饱和冷调径向渐变，静态、克制，复刻
 *     macOS Sonoma 之后的 Liquid Glass 观感；
 *   - 极光流光的光来自**自身**：三层高饱和青→紫光斑在画布上缓慢漂移、
 *     缩放、换相，再叠加一道绕卡片循环的流光边框。它是「活的」。
 *
 * 因此这份色板有两个特殊之处：
 *
 *   1. **表面层比玻璃更透**（0.62~0.74，玻璃是 0.76~0.86）。光斑必须能
 *      明显透上来，否则界面上只剩一层灰玻璃，动效全被挡住。
 *   2. **强调色是高饱和的青紫双色相**，而不是 Apple 的系统蓝单色相。
 *      青（Cyan）是「极光」的识别色，紫（Violet）负责纵深；两者之间的
 *      过渡由 `--ts-beam-*` 三段色与 `--ts-aurora-glow-*` 三层光斑承担。
 *
 * ## 明暗两态是同一套设计的两种曝光
 *
 * 亮色态叫「晨曦极光」（Aurora Mist）：光斑降到低饱和的晨雾青紫，画布是
 * 半透白；暗色态叫「极光流光」（Aurora Flow）：光斑全饱和，画布近黑。
 * 两态共用全部结构，只有取值不同——这也是本插件对每款主题的硬性要求
 * （明暗成对，由宿主的偏好决定取哪套）。
 *
 * ## 为什么继承玻璃的键集合
 *
 * 本主题的**语义结构**与玻璃完全一致（都是「半透明表面 + 轮廓光描边」），
 * 差异只在色值与动效材质。用 `inheritPalette(GLASS_PALETTE, …)` 继承，
 * 保证玻璃主题将来新增语义键时本主题自动跟上，不会出现「切到极光后某个
 * 面板没颜色」——那是这类变体主题最典型的漏色方式。
 *
 * @module dsh-theme-studio/themes/aurora-palette
 */

/**
 * 相对 GLASS_PALETTE 的覆盖项。
 *
 * 只写与玻璃不同的键：表面（更透）、文字（冷调近黑/近白）、强调（青紫双色相）、
 * 状态与节点（青紫系重排）。未列出的键（`white`、`workflow-*` 等）沿用玻璃。
 */
export const AURORA_OVERRIDES = {
  // —— 基础层：近黑曜石 / 晨雾白，都是「让光斑透上来」的底 ——
  accent: { light: 'rgba(79, 70, 229, 0.1)', dark: 'rgba(124, 92, 255, 0.16)' },
  // 内容卡必须半透明：不透明就等于把三层光斑整层盖住，动效全部看不见。
  // 透明度比玻璃再低一档（0.72 vs 0.82），因为光斑需要更高的穿透率。
  background: { light: 'rgba(247, 250, 255, 0.72)', dark: 'rgba(13, 15, 23, 0.72)' },
  'background-alt': {
    light: 'color-mix(in oklab, #f2f6ff 68%, transparent)',
    dark: 'color-mix(in oklab, #171a26 58%, transparent)',
  },
  'background-win-alt': { light: '#eaf0fa', dark: '#08090d' },
  'bg-document-selection': { light: 'rgba(79, 70, 229, 0.26)', dark: 'rgba(124, 92, 255, 0.34)' },

  // —— 表面层：比玻璃更薄，光斑才是主角 ——
  panel: { light: 'rgba(255, 255, 255, 0.62)', dark: 'rgba(24, 28, 40, 0.62)' },
  card: { light: 'rgba(255, 255, 255, 0.74)', dark: 'rgba(30, 35, 50, 0.70)' },
  // 抽屉是长文本 + 列表容器，必须比卡片更实，否则滚动时文字在光斑上漂移。
  drawer: { light: 'rgba(252, 254, 255, 0.94)', dark: 'rgba(16, 19, 28, 0.95)' },
  input: { light: 'rgba(255, 255, 255, 0.70)', dark: 'rgba(28, 33, 48, 0.68)' },
  menu: { light: 'rgba(255, 255, 255, 0.74)', dark: 'rgba(22, 26, 38, 0.76)' },
  'menu-hover': { light: 'rgba(79, 70, 229, 0.08)', dark: 'rgba(124, 92, 255, 0.14)' },
  popover: { light: 'rgba(255, 255, 255, 0.78)', dark: 'rgba(26, 31, 45, 0.80)' },
  'popover-border': { light: 'rgba(79, 70, 229, 0.16)', dark: 'rgba(124, 92, 255, 0.22)' },
  'popover-foreground': '@foreground',
  'popover-header': { light: 'rgba(246, 249, 255, 0.9)', dark: 'rgba(28, 33, 48, 0.92)' },
  sidebar: { light: 'rgba(242, 247, 255, 0.56)', dark: 'rgba(10, 12, 18, 0.56)' },
  header: { light: 'rgba(252, 254, 255, 0.60)', dark: 'rgba(14, 17, 26, 0.58)' },
  tab: { light: 'rgba(79, 70, 229, 0.06)', dark: 'rgba(124, 92, 255, 0.10)' },
  'tab-active': { light: 'rgba(255, 255, 255, 0.92)', dark: 'rgba(48, 54, 76, 0.90)' },
  'tab-border': { light: 'rgba(79, 70, 229, 0.14)', dark: 'rgba(124, 92, 255, 0.20)' },
  toast: { light: 'rgba(255, 255, 255, 0.94)', dark: 'rgba(34, 39, 56, 0.94)' },
  tooltip: { light: 'rgba(250, 252, 255, 0.95)', dark: 'rgba(30, 35, 50, 0.95)' },
  'tooltip-foreground': '@foreground',
  'tooltip-tag': { light: 'rgba(79, 70, 229, 0.08)', dark: 'rgba(124, 92, 255, 0.14)' },
  'tooltip-tag-foreground': '@foreground-subtle',
  tag: { light: 'rgba(79, 70, 229, 0.07)', dark: 'rgba(124, 92, 255, 0.12)' },
  secondary: { light: 'rgba(79, 70, 229, 0.07)', dark: 'rgba(124, 92, 255, 0.12)' },
  surface: { light: 'rgba(79, 70, 229, 0.055)', dark: 'rgba(124, 92, 255, 0.09)' },
  'surface-hover': { light: 'rgba(79, 70, 229, 0.10)', dark: 'rgba(124, 92, 255, 0.16)' },
  selected: { light: 'rgba(79, 70, 229, 0.14)', dark: 'rgba(124, 92, 255, 0.22)' },
  hover: { light: 'rgba(79, 70, 229, 0.06)', dark: 'rgba(124, 92, 255, 0.10)' },

  // —— 文字：冷调近黑 / 近白，带一点蓝，与青紫光晕同色温 ——
  foreground: { light: '#0b1220', dark: '#eef2fb' },
  'foreground-inverse': { light: '#ffffff', dark: '#000000' },
  'foreground-subtle': {
    light: 'color-mix(in oklab, #0b1220 64%, transparent)',
    dark: 'color-mix(in oklab, #eef2fb 66%, transparent)',
  },
  'foreground-subtlest': {
    light: 'color-mix(in oklab, #0b1220 44%, transparent)',
    dark: 'color-mix(in oklab, #eef2fb 44%, transparent)',
  },
  'remote-foreground-muted': { light: '#5b6478', dark: '#9aa4bb' },

  // —— 品牌与主操作：极光青（识别色） + 电光紫（纵深） ——
  //
  // 主操作填充用紫而非青：白字压在中饱和青上对比度只有 3.4:1，达不到 AA；
  // 靛紫（亮色 #4f46e5 / 暗色 #6d4aff）配白字分别是 6.3:1 与 4.8:1。
  // 青色则专门用于「文字型强调」（链接、品牌名、选中指示），
  // 因为它在白底上足够深、在深底上足够亮，两端都能读。
  brand: { light: '#0d8fa8', dark: '#22d3ee' },
  primary: { light: '#4f46e5', dark: '#6d4aff' },
  'primary-foreground': { light: '#ffffff', dark: '#ffffff' },

  // —— 边框：青紫微光，而不是中性灰线 ——
  border: { light: 'rgba(79, 70, 229, 0.12)', dark: 'rgba(124, 92, 255, 0.16)' },
  'border-hover': { light: 'rgba(79, 70, 229, 0.22)', dark: 'rgba(124, 92, 255, 0.30)' },
  'card-border': { light: 'rgba(255, 255, 255, 0.62)', dark: 'rgba(160, 174, 255, 0.12)' },
  'card-selected': { light: 'rgba(255, 255, 255, 0.95)', dark: 'rgba(52, 58, 82, 0.94)' },
  'input-border': { light: 'rgba(79, 70, 229, 0.14)', dark: 'rgba(124, 92, 255, 0.18)' },
  'input-border-focused': { light: '#4f46e5', dark: '#7c5cff' },
  'input-border-hover': { light: 'rgba(79, 70, 229, 0.26)', dark: 'rgba(124, 92, 255, 0.34)' },
  'input-focused': { light: 'rgba(255, 255, 255, 0.97)', dark: 'rgba(52, 58, 82, 0.94)' },

  // —— 状态：青绿 / 琥珀 / 玫红 / 紫，全部往极光色温上偏 ——
  success: { light: '#0f766e', dark: '#2dd4bf' },
  'success-foreground': { light: '#ffffff', dark: '#000000' },
  'success-surface': { light: 'rgba(15, 118, 110, 0.12)', dark: 'rgba(45, 212, 191, 0.18)' },
  'success-surface-foreground': { light: '#0b5f59', dark: '#7ee9dc' },
  warning: { light: '#b45309', dark: '#fbbf24' },
  'warning-foreground': { light: '#ffffff', dark: '#000000' },
  'warning-surface': { light: 'rgba(180, 83, 9, 0.13)', dark: 'rgba(251, 191, 36, 0.18)' },
  'warning-surface-foreground': { light: '#8a3f07', dark: '#fcd98a' },
  destructive: { light: '#be123c', dark: '#fb7185' },
  'destructive-foreground': { light: '#ffffff', dark: '#ffffff' },
  'destructive-surface': { light: 'rgba(190, 18, 60, 0.11)', dark: 'rgba(251, 113, 133, 0.18)' },
  'destructive-surface-foreground': { light: '#9f1239', dark: '#fda4af' },
  'idle-task': { light: '#7c3aed', dark: '#a78bfa' },
  'idle-task-surface': { light: 'rgba(124, 58, 237, 0.12)', dark: 'rgba(167, 139, 250, 0.18)' },

  // —— Diff / Git ——
  'diff-added': { light: '#0f766e', dark: '#2dd4bf' },
  'diff-added-foreground': { light: '#ffffff', dark: '#000000' },
  'diff-removed': { light: '#be123c', dark: '#fb7185' },
  'diff-removed-foreground': { light: '#ffffff', dark: '#000000' },
  'code-diff-added': { light: 'rgba(15, 118, 110, 0.10)', dark: 'rgba(45, 212, 191, 0.14)' },
  'code-diff-deleted': { light: 'rgba(190, 18, 60, 0.09)', dark: 'rgba(251, 113, 133, 0.14)' },
  'file-diff-added-bg': { light: 'rgba(15, 118, 110, 0.13)', dark: 'rgba(45, 212, 191, 0.16)' },
  'file-diff-added-gutter': { light: 'rgba(15, 118, 110, 0.20)', dark: 'rgba(45, 212, 191, 0.24)' },
  'file-diff-added-marker': { light: '#0f766e', dark: '#2dd4bf' },
  'file-diff-deleted-bg': { light: 'rgba(190, 18, 60, 0.11)', dark: 'rgba(251, 113, 133, 0.16)' },
  'file-diff-deleted-gutter': { light: 'rgba(190, 18, 60, 0.18)', dark: 'rgba(251, 113, 133, 0.24)' },
  'file-diff-deleted-marker': { light: '#be123c', dark: '#fb7185' },
  'git-added': { light: '#0f766e', dark: '#2dd4bf' },
  'git-deleted': { light: '#be123c', dark: '#fb7185' },
  'git-modified': { light: '#b45309', dark: '#fbbf24' },
  'git-descendant': { light: '#b45309', dark: '#fbbf24' },
  'git-renamed': { light: '#0d8fa8', dark: '#22d3ee' },
  'git-untracked': { light: '#0f766e', dark: '#2dd4bf' },
  'git-ignored': '@foreground-subtlest',
  'git-none': '@foreground',

  // —— Mention 节点：六类引用各占一个极光色相，饱和度统一 ——
  'file-node': { light: 'rgba(79, 70, 229, 0.12)', dark: 'rgba(124, 92, 255, 0.20)' },
  'file-node-foreground': { light: '#4338ca', dark: '#b4a6ff' },
  'file-node-hover': { light: 'rgba(79, 70, 229, 0.18)', dark: 'rgba(124, 92, 255, 0.28)' },
  'skill-node': { light: 'rgba(168, 85, 247, 0.12)', dark: 'rgba(192, 132, 252, 0.20)' },
  'skill-node-foreground': { light: '#7e22ce', dark: '#d8b4fe' },
  'skill-node-hover': { light: 'rgba(168, 85, 247, 0.18)', dark: 'rgba(192, 132, 252, 0.28)' },
  'command-node': { light: 'rgba(13, 143, 168, 0.12)', dark: 'rgba(34, 211, 238, 0.20)' },
  'command-node-foreground': { light: '#0b7285', dark: '#7de3f5' },
  'command-node-hover': { light: 'rgba(13, 143, 168, 0.18)', dark: 'rgba(34, 211, 238, 0.28)' },
  'subagent-node': { light: 'rgba(13, 148, 136, 0.12)', dark: 'rgba(45, 212, 191, 0.20)' },
  'subagent-node-foreground': { light: '#0b7268', dark: '#8ce0da' },
  'subagent-node-hover': { light: 'rgba(13, 148, 136, 0.18)', dark: 'rgba(45, 212, 191, 0.28)' },
  'session-node': { light: 'rgba(180, 83, 9, 0.12)', dark: 'rgba(251, 191, 36, 0.20)' },
  'session-node-foreground': { light: '#8a3f07', dark: '#fcd98a' },
  'session-node-hover': { light: 'rgba(180, 83, 9, 0.18)', dark: 'rgba(251, 191, 36, 0.28)' },
  'plugin-node': { light: 'rgba(139, 92, 246, 0.12)', dark: 'rgba(167, 139, 250, 0.20)' },
  'plugin-node-foreground': { light: '#6d28d9', dark: '#c4b5fd' },
  'plugin-node-hover': { light: 'rgba(139, 92, 246, 0.18)', dark: 'rgba(167, 139, 250, 0.28)' },

  // —— 轨迹：用户紫、助手青、思考紫红、工具琥珀、结果蓝 ——
  'trajectory-user': { light: '#4f46e5', dark: '#7c5cff' },
  'trajectory-assistant': { light: '#0d8fa8', dark: '#22d3ee' },
  'trajectory-reasoning': { light: '#a21caf', dark: '#e879f9' },
  'trajectory-tool-call': { light: '#b45309', dark: '#fbbf24' },
  'trajectory-tool-result': { light: '#0369a1', dark: '#38bdf8' },

  // —— 代码 / Markdown ——
  'markdown-inline-code': { light: 'rgba(79, 70, 229, 0.08)', dark: 'rgba(124, 92, 255, 0.14)' },
  'find-highlight': { light: 'rgba(255, 214, 10, 0.38)', dark: 'rgba(255, 214, 10, 0.32)' },
  'find-highlight-active': { light: 'rgba(251, 191, 36, 0.62)', dark: 'rgba(251, 191, 36, 0.62)' },

  // —— 终端：深空底 + 极光 ANSI ——
  'terminal-bg': { light: 'rgba(250, 252, 255, 0.88)', dark: 'rgba(12, 14, 21, 0.88)' },
  'terminal-fg': { light: '#0b1220', dark: '#eef2fb' },
  'terminal-black': { light: '#1e2433', dark: '#3a4256' },
  'terminal-red': { light: '#be123c', dark: '#fb7185' },
  'terminal-green': { light: '#0f766e', dark: '#2dd4bf' },
  'terminal-yellow': { light: '#a16207', dark: '#fbbf24' },
  'terminal-blue': { light: '#1d4ed8', dark: '#60a5fa' },
  'terminal-magenta': { light: '#a21caf', dark: '#e879f9' },
  'terminal-cyan': { light: '#0e7490', dark: '#22d3ee' },
  'terminal-white': { light: '#94a3b8', dark: '#cbd5e1' },
  'terminal-bright-black': { light: '#64748b', dark: '#7c889e' },
  'terminal-bright-red': { light: '#e11d48', dark: '#fda4af' },
  'terminal-bright-green': { light: '#14b8a6', dark: '#5eead4' },
  'terminal-bright-yellow': { light: '#eab308', dark: '#fde047' },
  'terminal-bright-blue': { light: '#3b82f6', dark: '#93c5fd' },
  'terminal-bright-magenta': { light: '#c026d3', dark: '#f0abfc' },
  'terminal-bright-cyan': { light: '#22d3ee', dark: '#a5f3fc' },
  'terminal-bright-white': { light: '#f8fafc', dark: '#ffffff' },
  'terminal-cursor': { light: '#4f46e5', dark: '#7c5cff' },
  'terminal-cursor-accent': { light: '#ffffff', dark: '#0d0f17' },
  'terminal-selection': { light: 'rgba(79, 70, 229, 0.22)', dark: 'rgba(124, 92, 255, 0.30)' },
  'terminal-selection-inactive': { light: 'rgba(79, 70, 229, 0.08)', dark: 'rgba(124, 92, 255, 0.12)' },

  // —— 用量图 / 上下文分解：青 → 紫的连续色阶 ——
  'usage-chart-1': { light: '#4f46e5', dark: '#7c5cff' },
  'usage-chart-2': { light: '#0f766e', dark: '#2dd4bf' },
  'usage-chart-3': { light: '#a21caf', dark: '#e879f9' },
  'usage-chart-4': { light: '#be123c', dark: '#fb7185' },
  'usage-chart-5': { light: '#b45309', dark: '#fbbf24' },
  'usage-chart-6': { light: '#0e7490', dark: '#22d3ee' },
  'context-breakdown-1': { light: '#4f46e5', dark: '#7c5cff' },
  'context-breakdown-2': { light: '#6366f1', dark: '#8b7bff' },
  'context-breakdown-3': { light: '#7c83f5', dark: '#a396ff' },
  'context-breakdown-4': { light: '#939ef8', dark: '#bab0ff' },
  'context-breakdown-5': { light: '#a9b8fb', dark: '#cfc7ff' },
  'context-breakdown-6': { light: '#c3d1fd', dark: '#e0daff' },
  'context-breakdown-7': { light: '#dde6fe', dark: '#eeeaff' },
  'usage-heatmap-0': { light: 'rgba(79, 70, 229, 0.04)', dark: 'rgba(124, 92, 255, 0.06)' },
  'usage-heatmap-1': { light: 'rgba(79, 70, 229, 0.18)', dark: 'rgba(124, 92, 255, 0.24)' },
  'usage-heatmap-2': { light: 'rgba(79, 70, 229, 0.36)', dark: 'rgba(124, 92, 255, 0.44)' },
  'usage-heatmap-3': { light: 'rgba(79, 70, 229, 0.58)', dark: 'rgba(124, 92, 255, 0.66)' },
  'usage-heatmap-4': { light: 'rgba(67, 56, 202, 0.84)', dark: 'rgba(180, 166, 255, 0.82)' },

  // —— 远程环境标签 ——
  'remote-ssh-surface': { light: 'rgba(13, 143, 168, 0.12)', dark: 'rgba(34, 211, 238, 0.18)' },
  'remote-ssh-border': { light: 'rgba(13, 143, 168, 0.28)', dark: 'rgba(34, 211, 238, 0.42)' },
  'remote-ssh-foreground': { light: '#0b7285', dark: '#8fe6f7' },
  'remote-docker-surface': { light: 'rgba(79, 70, 229, 0.12)', dark: 'rgba(124, 92, 255, 0.18)' },
  'remote-docker-border': { light: 'rgba(79, 70, 229, 0.28)', dark: 'rgba(124, 92, 255, 0.42)' },
  'remote-docker-foreground': { light: '#4338ca', dark: '#c4b5fd' },
  'remote-wsl-surface': { light: 'rgba(15, 118, 110, 0.12)', dark: 'rgba(45, 212, 191, 0.18)' },
  'remote-wsl-border': { light: 'rgba(15, 118, 110, 0.28)', dark: 'rgba(45, 212, 191, 0.42)' },
  'remote-wsl-foreground': { light: '#0b5f59', dark: '#8ce0da' },

  // —— 其它 ——
  'interaction-ask-surface': { light: 'rgba(79, 70, 229, 0.10)', dark: 'rgba(124, 92, 255, 0.16)' },
  'interaction-ask-foreground': { light: '#4338ca', dark: '#b4a6ff' },
  'interaction-ask-fill': { light: 'rgba(79, 70, 229, 0.18)', dark: 'rgba(124, 92, 255, 0.24)' },
  'interaction-confirmation-surface': { light: 'rgba(15, 118, 110, 0.12)', dark: 'rgba(45, 212, 191, 0.16)' },
  'interaction-confirmation-foreground': { light: '#0b5f59', dark: '#8ce0da' },
  'progress-surface': { light: 'rgba(79, 70, 229, 0.12)', dark: 'rgba(124, 92, 255, 0.18)' },
  'progress-surface-foreground': { light: '#4338ca', dark: '#b4a6ff' },
  'plugin-paid-plan-badge': { light: 'rgba(180, 83, 9, 0.18)', dark: 'rgba(251, 191, 36, 0.24)' },
  'plugin-paid-plan-badge-foreground': { light: '#7c3a06', dark: '#fde9b8' },
  'feedback-privacy-hint': { light: '#b45309', dark: '#fbbf24' },
  'resize-handle': { light: 'rgba(79, 70, 229, 0.6)', dark: 'rgba(124, 92, 255, 0.7)' },
  'workflow-rule': { light: 'rgba(79, 70, 229, 0.10)', dark: 'rgba(124, 92, 255, 0.14)' },
  'workflow-trace': { light: 'rgba(79, 70, 229, 0.30)', dark: 'rgba(124, 92, 255, 0.36)' },
  'workflow-trace-strong': { light: 'rgba(79, 70, 229, 0.54)', dark: 'rgba(124, 92, 255, 0.60)' },
}

/**
 * 极光流光的材质参数。
 *
 * 与玻璃的差异集中在三点：
 *
 *   1. **圆角更大**（26~30px）：流光边框是沿圆角外侧跑的光，圆角越小越像
 *      「描边」，越大越像「光在绕行」。这是本主题的识别特征之一。
 *   2. **光斑三层**：`--ts-aurora-glow-1/2/3` 是三个独立色相的半透明色，
 *      aurora.css 把它们画成三个 `radial-gradient` 并用不同周期漂移。
 *      三层是「有机」的下限——两层会看出周期规律，四层以上性能收益递减。
 *   3. **动效倍率**：`--ts-motion-scale` 统一缩放所有动画时长，
 *      便于无障碍降档，也便于将来做「动效强度」设置项。
 *
 * 注意所有辉光值都必须半透明：它们会被 `filter: blur()` 叠加在画布上，
 * 不透明的色块会让整个界面变成一块实色。
 */
export const AURORA_MATERIAL = {
  '--ts-blur': '26px',
  '--ts-saturate': '165%',
  '--ts-glass-tint': 'rgba(255, 255, 255, 0.38)',
  '--ts-glass-highlight': 'rgba(255, 255, 255, 0.52)',
  '--ts-glass-edge': 'rgba(79, 70, 229, 0.20)',
  '--ts-surface-alpha': '74%',
  /* 主内容区底色不透明度：极光必须透上来，这一层是压在光斑上的第一道遮挡。
     实测 72% 时主区彩度 p90 只有 45，降到 38% 后提到 86（设计稿 67）。
     正文对比度代价：15.7:1 → 13.1:1，仍在 AAA（7:1）之上。 */
  '--ts-canvas-alpha': '38%',
  '--ts-canvas-alpha-light': '82%',

  // 「壁纸」：极光的静态底。亮色是晨雾，暗色是深空。
  // 透明度比玻璃低（0.55~0.7 vs 0.75~0.85），因为动态光斑会叠在它上面，
  // 两层都浓的话会糊成一片脏色。
  '--ts-wallpaper-1': {
    light: 'rgba(186, 226, 245, 0.70)',
    dark: 'rgba(18, 84, 122, 0.66)',
  },
  '--ts-wallpaper-2': {
    light: 'rgba(214, 206, 245, 0.66)',
    dark: 'rgba(72, 44, 148, 0.62)',
  },

  // —— 三层动态光斑：青 / 紫 / 青绿 ——
  //
  // 取值依据是**对设计稿的像素统计**，不是手感：设计稿（aurora-flow-desktop-ui.jpg）
  // 各背景区的彩度 p90 为「左上青 65 / 中部深蓝紫 67 / 底部青紫 64」。
  // 初版把暗色 alpha 压到 0.22~0.30，实测各区域彩度 p90 只有 12~38，
  // 中部与底部几乎看不到极光——那是「有一层灰玻璃」而不是「极光」。
  //
  // 现在的暗色取值（0.52~0.62）把实测彩度拉到设计稿同一量级。仍然 < 0.65
  // 是硬上限：再高会盖住正文，深底上的长文本对比度掉得比观感更快。
  //
  // 亮色态相反，必须更低（0.30~0.38）：白底上同样的 alpha 会让正文区域染色，
  // 对比度直接不可读。设计稿的亮色版（aurora-mist）本就是「晨雾」而非「极光」。
  // 亮色态光斑：0.34 时 saturate(2.5) 会把青紫推到荧光，整片界面被染色。
  // 实测截图中主区被极光淹没、正文完全不可读。降到 0.14~0.18 是「晨光可见、
  // 文字可读」的边界——再低就退化成纯白玻璃，再高就回到荧光。
  '--ts-aurora-glow-1': {
    light: 'rgba(34, 211, 238, 0.16)',
    dark: 'rgba(0, 242, 254, 0.58)',
  },
  '--ts-aurora-glow-2': {
    light: 'rgba(167, 139, 250, 0.14)',
    dark: 'rgba(138, 43, 226, 0.54)',
  },
  '--ts-aurora-glow-3': {
    light: 'rgba(45, 212, 191, 0.13)',
    dark: 'rgba(16, 185, 129, 0.52)',
  },

  // —— 流光边框三段色：青 → 靛 → 紫 ——
  //
  // 必须三个色相：两个色相在 conic-gradient 的 360° 接缝处会硬跳，
  // 中间加一个过渡色相才能让扫光首尾相接。
  '--ts-beam-a': { light: '#06b6d4', dark: '#22d3ee' },
  '--ts-beam-b': { light: '#4f46e5', dark: '#6366f1' },
  '--ts-beam-c': { light: '#8b5cf6', dark: '#a855f7' },

  // Agent 运行态的呼吸波纹：颜色 + 扩散半径
  '--ts-pulse-color': {
    light: 'rgba(13, 143, 168, 0.45)',
    dark: 'rgba(34, 211, 238, 0.60)',
  },
  '--ts-pulse-spread': '14px',

  // 动效整体倍率（1 = 主题默认速度）
  '--ts-motion-scale': '1',

  // —— 圆角：比玻璃更大，流光才有「绕行」的余地 ——
  '--dsw-radius-sm': '12px',
  '--dsw-radius-md': '16px',
  '--dsw-radius-lg': '20px',
  '--dsw-radius-xl': '24px',
  '--dsw-radius-panel': '28px',
  '--dsw-radius-s': '12px',
  '--dsw-radius-m': '16px',
  '--dsw-radius-l': '20px',

  // —— 阴影：带青紫色相的柔和辉光，而不是中性灰投影 ——
  '--dsw-shadow-lv1': '0 1px 3px 0 rgba(13, 15, 23, 0.08), 0 0 12px -4px rgba(79, 70, 229, 0.18)',
  '--dsw-shadow-lv2': '0 4px 18px 0 rgba(13, 15, 23, 0.10), 0 0 24px -8px rgba(79, 70, 229, 0.22)',
  '--dsw-shadow-lv3':
    '0 12px 44px 0 rgba(13, 15, 23, 0.18), 0 0 48px -16px rgba(124, 92, 255, 0.26), 0 0 0 0.5px rgba(79, 70, 229, 0.12)',
  '--dsw-elevation-soft': '0 1px 3px 0 rgba(13, 15, 23, 0.08)',
  '--dsw-elevation-panel': '0 10px 36px 0 rgba(13, 15, 23, 0.14), 0 0 40px -14px rgba(79, 70, 229, 0.22)',
  '--dsw-elevation-prominent':
    '0 24px 68px 0 rgba(13, 15, 23, 0.24), 0 0 64px -20px rgba(124, 92, 255, 0.34), 0 0 0 0.5px rgba(255, 255, 255, 0.24) inset',
  '--dsw-elevation-stroke-color': 'rgba(79, 70, 229, 0.28)',
  '--dsw-mask-blur': 'blur(4px)',
}

/**
 * 极光流光的暗色材质覆盖。
 *
 * 暗色下有三处必须换值，否则光会「糊掉」或「刺眼」：
 *
 *   - **轮廓光**：亮色靠白色高光立边，暗色下同一条高光会变成刺眼白线，
 *     改用低不透明的冷白（0.10）。
 *   - **玻璃描边**：亮色是靛蓝 0.20，暗色必须提亮到 0.28 才能从近黑底上浮起来。
 *   - **辉光色**：暗色态的青色要更纯（0, 242, 254 而非 34, 211, 238），
 *     否则在近黑背景上会显灰。
 */
export const AURORA_MATERIAL_DARK = {
  '--ts-glass-tint': 'rgba(120, 140, 190, 0.06)',
  '--ts-glass-highlight': 'rgba(255, 255, 255, 0.10)',
  '--ts-glass-edge': 'rgba(124, 92, 255, 0.28)',
  '--dsw-elevation-stroke-color': 'rgba(124, 92, 255, 0.34)',
}
