/**
 * dsh-theme-studio 客户端半侧。
 *
 * 两件事：
 *
 * 1. **运行时应用设置**：把主题属性写进 DOM，把自定义（背景、字体、字段色、字号）
 *    写成一个独立的 `<style>` 层。之所以不重算整份主题 CSS，是因为主题变量块
 *    已经全部注入（`fullThemeCss` 一次给全 4 套），切换主题只是换 html 上的属性值——
 *    零闪烁、零重排、零网络请求。
 *
 * 2. **设置面板**：注册到 `settings.section`，提供主题选择、背景（纯色/图片）、
 *    字体、字号、字段色、玻璃模糊强度。所有改动走 RPC 落盘到
 *    `~/.dsh/theme-studio/settings.json`。
 *
 * 客户端 bundle 不能 import 宿主模块，所以主题字段色角色、字号范围与
 * 自定义 CSS 生成逻辑在此**内联一份**；与服务端的一致性由
 * `test/client-parity.test.mjs` 守护。
 *
 * 面板用 React.createElement 构建（不能用 JSX）。深层嵌套会难以核对括号，
 * 因此拆成若干小的构建函数（`segmented()`、`field()` 等），每个只负责一层。
 */

window.__ModuleLoader__.load({
  id: '@weniatall/dsh-theme-studio',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')
    const h = react.createElement

    const SETTINGS_SLOT = 'settings.section'
    const RPC_CHANNEL = '/dsh-theme-studio-settings'
    const THEME_ATTR = 'data-theme-studio'
    const LEGACY_ATTR = 'data-dsh-theme'
    const STYLE_ID = 'dsh-theme-studio'
    const CUSTOM_STYLE_ID = 'dsh-theme-studio-custom'
    const PANEL_CSS_ID = 'dsh-theme-studio-panel-css'

    // 与服务端 lib/settings.js 的 FIELD_COLOR_ROLES 逐项一致（测试守护）。
    const FIELD_COLOR_ROLES = [
      { key: 'foreground', label: '正文文字', variable: '--color-foreground' },
      { key: 'foreground-subtle', label: '次级文字', variable: '--color-foreground-subtle' },
      { key: 'foreground-subtlest', label: '辅助文字', variable: '--color-foreground-subtlest' },
      { key: 'background', label: '画布背景', variable: '--color-background' },
      { key: 'panel', label: '面板背景', variable: '--color-panel' },
      { key: 'card', label: '卡片背景', variable: '--color-card' },
      { key: 'input', label: '输入框背景', variable: '--color-input' },
      { key: 'border', label: '边框', variable: '--color-border' },
      { key: 'brand', label: '品牌强调', variable: '--color-brand' },
      { key: 'primary', label: '主操作填充', variable: '--color-primary' },
      { key: 'primary-foreground', label: '主操作文字', variable: '--color-primary-foreground' },
    ]

    // 字段色的宿主层映射：用户改一个语义角色时，除了语义层 --color-*，
    // 还要覆盖这些 --dsw-*（宿主自绘组件读的是它们）。与服务端
    // settings.js 的 hostTokensFor() 输出逐项一致（测试守护）。
    const FIELD_HOST_TOKENS = {
      'foreground': [
        '--dsw-specific-sidebar-nav-item-active-accent',
        '--dsw-alias-label-primary',
        '--dsw-alias-label-primary-bluish',
        '--dsw-alias-label-deep-diving',
        '--dsw-static-deepseek-200',
        '--dsw-alias-toast-label',
        '--dsw-focus-ring-color',
      ],
      'foreground-subtle': [
        '--dsw-alias-label-document-preview',
        '--dsw-alias-label-secondary',
        '--dsw-alias-label-primary-dimmed',
        '--dsw-alias-label-deep-diving-shimmer',
        '--dsw-alias-menu-icon',
        '--dsw-static-deepseek-400',
        '--dsw-static-deepseek-450',
        '--dsw-static-deepseek-500',
      ],
      'foreground-subtlest': [
        '--dsw-alias-label-tertiary',
        '--dsw-alias-label-caption',
        '--dsw-alias-label-quaternary',
        '--dsw-alias-label-dimmed',
        '--dsw-alias-label-shimmer',
      ],
      'background': [
        '--dsw-alias-bg-base',
        '--dsw-alias-bg-l1',
        '--dsw-alias-bg-mask-drop',
        '--dsw-alias-markdown-code-block',
        '--dsw-alias-turn-trigger-bg',
      ],
      'panel': [
        '--dsw-alias-bg-layer-1',
        '--dsw-alias-bg-document-preview',
        '--dsw-specific-login-input',
        '--dsw-alias-menu-group-header-fill',
        '--dsw-alias-markdown-code-block-banner',
        '--dsw-alias-markdown-citation',
        '--dsw-alias-markdown-code-segment-selected',
        '--dsw-alias-background-base',
      ],
      'card': [
        '--dsw-alias-bg-layer-2',
        '--dsw-alias-bg-overlay',
        '--dsw-specific-bubble',
        '--dsw-alias-button-elevated-fill',
        '--dsw-alias-button-floating-fill',
        '--dsw-alias-onboarding-card-fill',
        '--dsw-alias-settings-card-fill',
        '--dsw-hovercard-bg',
        '--dsw-alias-background-surface',
        '--dsw-alias-background-overlay',
        '--dsw-alias-surface-l2',
      ],
      'input': [
        '--dsw-alias-bg-layer-3',
        '--dsw-alias-bg-module-platform',
        '--dsw-specific-sidebar-nav-item-active',
        '--dsw-specific-input-major',
      ],
      'border': [
        '--dsw-alias-button-ghost-active-border',
        '--dsw-alias-border-l1',
        '--dsw-alias-border-l2-darkmode-thin',
        '--dsw-alias-separator-primary',
        '--dsw-alias-border-subtle',
      ],
      'brand': [
        '--dsw-alias-brand-primary',
        '--dsw-alias-brand-text',
        '--dsw-alias-brand-primary-new-colorprimary-new-color',
        '--dsw-alias-state-business-primary',
        '--dsw-alias-link',
        '--dsw-alias-onboarding-accent',
      ],
      'primary': [
        '--dsw-specific-bubble-highlight',
        '--dsw-alias-button-primary-fill',
        '--dsw-alias-button-primary-hover',
        '--dsw-alias-button-info-fill',
        '--dsw-alias-button-info-hover',
        '--dsw-alias-button-contrast-fill',
      ],
      'primary-foreground': [
        '--dsw-alias-label-primary-inverted',
        '--dsw-alias-label-primary-foreground',
        '--dsw-alias-brand-primary-invert',
        '--dsw-alias-switch-thumb',
      ],
    }

    // 与服务端 settings.js 的 TEXT_FONT_OPTIONS 保持一致（测试守护）。
    const TEXT_FONT_OPTIONS = [
      { value: '', label: '跟随主题 / 系统原生默认' },
      {
        value: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", Helvetica, Arial, sans-serif',
        label: '苹方 / San Francisco (Apple 风格)',
      },
      {
        value: 'Segoe UI, "Microsoft YaHei UI", "Microsoft YaHei", -apple-system, sans-serif',
        label: '微软雅黑 / Segoe UI (Windows 推荐)',
      },
      {
        value: '"Noto Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", -apple-system, sans-serif',
        label: '思源黑体 (Noto Sans SC 均衡)',
      },
      {
        value: 'Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
        label: 'Inter (国际现代极简)',
      },
      {
        value: '"LXGW WenKai", "霞鹜文楷", "STKaiti", "KaiTi", serif',
        label: '霞鹜文楷 / 楷体 (人文舒适阅读)',
      },
    ]

    // 与服务端 settings.js 的 CODE_FONT_OPTIONS 保持一致（测试守护）。
    const CODE_FONT_OPTIONS = [
      { value: '', label: '跟随主题 / 系统等宽默认' },
      {
        value: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "PingFang SC", "Microsoft YaHei", monospace',
        label: 'JetBrains Mono (现代编程推荐)',
      },
      {
        value: '"Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "PingFang SC", "Microsoft YaHei", monospace',
        label: 'Fira Code (经典连字)',
      },
      {
        value: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "PingFang SC", "Microsoft YaHei", monospace',
        label: 'SF Mono / Menlo (Apple 终端)',
      },
      {
        value: '"Cascadia Code", Consolas, "Segoe UI Mono", "Microsoft YaHei", monospace',
        label: 'Cascadia Code / Consolas (微软代码栈)',
      },
      {
        value: '"Source Code Pro", Consolas, Monaco, "PingFang SC", "Microsoft YaHei", monospace',
        label: 'Source Code Pro (Adobe 经典等宽)',
      },
    ]

    // 与服务端 FONT_SIZE_RANGES 一致（测试守护）。
    const FONT_SIZE_RANGES = {
      text: { min: 10, max: 22, label: '正文' },
      code: { min: 10, max: 16, label: '代码' },
      terminal: { min: 10, max: 20, label: '终端' },
    }

    /** 主题 id → 旧属性值（与服务端 legacyId 规则一致）。 */
    function legacyIdOf(themeId) {
      const id = typeof themeId === 'string' && themeId !== '' ? themeId : 'none'
      if (id === 'none') return null
      if (id === 'zcode') return 'zcode'
      if (id === 'zcode-mono') return 'zcode-mono'
      return id
    }

    /**
     * 生成用户自定义层 CSS。
     *
     * 与服务端 `lib/settings.js` 的 `customCss()` 是同一份逻辑的两处实现：
     * 服务端那份用于首屏直出（零闪烁），这份用于面板里的即时预览。
     *
     * @param {object} settings
     * @param {string | null} [backgroundUrl]
     * @returns {string}
     */
    function customLayerCss(settings, backgroundUrl) {
      const lines = []
      const background = settings?.background ?? { mode: 'none' }
      const fonts = settings?.fonts ?? {}
      const sizes = settings?.fontSizes ?? {}
      const glass = settings?.glass ?? {}
      const fieldColors = settings?.fieldColors ?? {}

      // 背景写 body（不是 html）：玻璃主题的壁纸在 body 上，写 html 会被它盖住。
      // 与服务端 settings.js 的 customCss() 保持一致（测试逐字节比对）。
      const backgroundLines = []
      if (background.mode === 'color' && background.value) {
        backgroundLines.push(`  background-color: ${background.value};`)
        backgroundLines.push('  background-image: none;')
      } else if (background.mode === 'image' && backgroundUrl) {
        const fit = background.fit === 'contain' ? 'contain' : background.fit === 'repeat' ? 'auto' : 'cover'
        const repeat = background.fit === 'repeat' ? 'repeat' : 'no-repeat'
        if (background.value) backgroundLines.push(`  background-color: ${background.value};`)
        backgroundLines.push(`  background-image: url("${backgroundUrl}");`)
        backgroundLines.push(`  background-size: ${fit};`)
        backgroundLines.push(`  background-repeat: ${repeat};`)
        backgroundLines.push('  background-position: center center;')
        backgroundLines.push('  background-attachment: fixed;')
      }

      if (fonts.text) lines.push(`  --dsw-font-family: ${fonts.text};`)
      if (fonts.code) {
        lines.push(`  --ds-font-family-code: ${fonts.code};`)
        lines.push(`  --dsw-font-family-mono: ${fonts.code};`)
        lines.push(`  --dsw-font-mono: ${fonts.code};`)
        lines.push(`  --dsw-font-code: ${fonts.code};`)
      }

      if (sizes.text) {
        lines.push(`  --dsh-content-font-size: ${sizes.text}px;`)
        lines.push(`  --ui-font-size: ${sizes.text}px;`)
      }
      if (sizes.code) lines.push(`  --dsh-code-font-size: ${sizes.code}px;`)
      if (sizes.terminal) lines.push(`  --dsh-terminal-font-size: ${sizes.terminal}px;`)

      if (typeof glass.blur === 'number') lines.push(`  --ts-blur: ${glass.blur}px;`)
      if (typeof glass.saturate === 'number') lines.push(`  --ts-saturate: ${glass.saturate}%;`)

      const fieldLines = []
      for (const role of FIELD_COLOR_ROLES) {
        const value = fieldColors[role.key]
        if (!value) continue
        fieldLines.push(`  ${role.variable}: ${value};`)
        for (const token of FIELD_HOST_TOKENS[role.key] ?? []) {
          fieldLines.push(`  ${token}: ${value};`)
        }
      }

      const scope = `:is(html[${THEME_ATTR}], html:root)`
      let css = ''
      if (lines.length > 0) css += `${scope} {\n${lines.join('\n')}\n}\n`
      if (backgroundLines.length > 0) {
        css += `${scope} body {\n${backgroundLines.join('\n')}\n}\n`
        css += `${scope} body[data-ds-dark-theme] {\n${backgroundLines.join('\n')}\n}\n`
      }
      if (fieldLines.length > 0) {
        css += `${scope} body {\n${fieldLines.join('\n')}\n}\n`
        css += `${scope} body[data-ds-dark-theme] {\n${fieldLines.join('\n')}\n}\n`
      }
      if (background.mode === 'image' && backgroundUrl && background.opacity < 100) {
        const fade = ((100 - background.opacity) / 100).toFixed(2)
        css +=
          `${scope} body::before {\n` +
          '  content: "";\n' +
          '  position: fixed;\n' +
          '  inset: 0;\n' +
          '  pointer-events: none;\n' +
          '  z-index: -1;\n' +
          '  background: var(--color-background, var(--dsw-alias-bg-base));\n' +
          `  opacity: ${fade};\n` +
          '}\n'
      }
      return css
    }

    /**
     * 把主题与自定义应用到 DOM。
     *
     * @param {{ themeId?: string, settings?: object, backgroundUrl?: string | null }} input
     */
    function applyToDocument(input) {
      if (typeof document === 'undefined') return
      const themeId = input?.themeId || 'none'
      const root = document.documentElement
      if (themeId === 'none') {
        root.removeAttribute(THEME_ATTR)
        root.removeAttribute(LEGACY_ATTR)
      } else {
        root.setAttribute(THEME_ATTR, themeId)
        const legacy = legacyIdOf(themeId)
        if (legacy) root.setAttribute(LEGACY_ATTR, legacy)
        else root.removeAttribute(LEGACY_ATTR)
      }

      const css = customLayerCss(input?.settings ?? {}, input?.backgroundUrl)
      let style = document.getElementById(CUSTOM_STYLE_ID)
      if (css === '') {
        if (style) style.remove()
        return
      }
      if (!style) {
        style = document.createElement('style')
        style.id = CUSTOM_STYLE_ID
        document.head.appendChild(style)
      }
      style.textContent = css
    }

    // —— 面板样式（全部走主题 Token，面板自身也被主题染色）——
    const PANEL_CSS = `
.ts-wrap{display:flex;flex-direction:column;gap:18px;width:100%;max-width:860px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family)}
.ts-wrap h2,.ts-wrap p{margin:0}
.ts-wrap h2{font:var(--dsw-font-l-20);display:flex;align-items:center;gap:8px}
.ts-intro{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-s-14);line-height:20px}
.ts-section{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1)}
.ts-section-title{font:var(--dsw-font-s-strong-14);color:var(--dsw-alias-label-primary);display:flex;align-items:center;justify-content:space-between;gap:8px}
.ts-section-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}
.ts-themes{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}
.ts-theme{position:relative;display:flex;flex-direction:column;gap:8px;padding:10px;border:1.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);cursor:pointer;text-align:left;transition:border-color .15s ease,transform .15s ease;font-family:inherit}
.ts-theme:hover{border-color:var(--dsw-alias-border-l3);transform:translateY(-1px)}
.ts-theme[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.ts-theme-swatch{height:44px;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l1);display:flex;align-items:flex-end;justify-content:flex-end;padding:4px;gap:3px}
.ts-theme-dot{width:11px;height:11px;border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,.12)}
.ts-theme-name{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.ts-theme-desc{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.ts-row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}
.ts-field{display:flex;flex-direction:column;gap:6px;flex:1 1 200px;min-width:0}
.ts-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;display:flex;align-items:center;gap:6px}
.ts-input{box-sizing:border-box;width:100%;height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);outline:none;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);font-family:inherit}
.ts-input:focus-visible{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 20%,transparent)}
.ts-input[type=color]{padding:2px;height:34px;cursor:pointer;flex:0 0 40px;width:40px}
.ts-input[type=range]{padding:0;height:24px;cursor:pointer}
.ts-input[type=file]{padding-top:5px}
.ts-seg{display:inline-flex;padding:2px;gap:2px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover)}
.ts-seg button{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;padding:5px 12px;border-radius:calc(var(--dsw-radius-sm) - 2px);cursor:pointer;font-family:inherit}
.ts-seg button[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.ts-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}
.ts-btn{display:inline-flex;align-items:center;justify-content:center;height:34px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);font-family:inherit;cursor:pointer}
.ts-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.ts-btn:disabled{cursor:default;opacity:.5}
.ts-btn-primary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
.ts-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent)}
.ts-btn-mini{height:28px;padding:0 8px;font-size:11px}
.ts-status{padding:10px 12px;border-radius:var(--dsw-radius-sm);font-size:12px;line-height:18px;white-space:pre-wrap}
.ts-status.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary)}
.ts-status.err{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}
.ts-bg-preview{height:88px;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l1);background-color:var(--dsw-alias-bg-layer-2);background-size:cover;background-position:center;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);font-size:12px}
.ts-colors{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
.ts-color{display:flex;align-items:center;gap:8px}
.ts-color .ts-input[type=text]{flex:1 1 auto;min-width:0}
.ts-hint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin:0;word-break:break-all}
select.ts-input{cursor:pointer;padding-right:24px}
select.ts-input option{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
`

    /** 读取文件为 data URL。 */
    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
        reader.readAsDataURL(file)
      })
    }

    /** 把颜色字符串回填到 input[type=color]（它只接受 #rrggbb）。 */
    function toColorInputValue(value, fallback) {
      if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) return value
      return fallback
    }

    /** 分段控件。 */
    function segmented(options, current, onPick) {
      return h('div', { className: 'ts-seg' },
        options.map((option) =>
          h('button', {
            key: option.value,
            type: 'button',
            'aria-pressed': current === option.value,
            onClick: () => onPick(option.value),
          }, option.label)))
    }

    /** 带标签的字段容器。 */
    function field(label, children, style) {
      return h('label', { className: 'ts-field', style },
        h('span', { className: 'ts-label' }, label),
        children)
    }

    /** 字体下拉选择控件（只选不填，防止输错与 CSS 注入）。 */
    function fontSelect(options, current, onPick) {
      const val = typeof current === 'string' ? current : ''
      const hasMatch = options.some((opt) => opt.value === val)
      return h('select', {
        className: 'ts-input',
        value: val,
        onChange: (e) => onPick(e.target.value),
      },
        !hasMatch && val !== ''
          ? h('option', { key: 'current-custom', value: val }, `当前已存自定义: ${val.slice(0, 32)}…`)
          : null,
        options.map((opt) =>
          h('option', { key: opt.label, value: opt.value }, opt.label)
        )
      )
    }

    /** 主题卡片。 */
    function themeCard(theme, active, onPick) {
      return h('button', {
        key: theme.id,
        type: 'button',
        className: 'ts-theme',
        'aria-pressed': active === theme.id,
        onClick: () => onPick(theme.id),
      },
        h('div', {
          className: 'ts-theme-swatch',
          style: { background: theme.surface?.light ?? 'transparent' },
        }, h('span', {
          className: 'ts-theme-dot',
          style: { background: theme.surface?.dark ?? 'transparent' },
        })),
        h('div', { className: 'ts-theme-name' }, theme.label),
        h('div', { className: 'ts-theme-desc' }, theme.description))
    }

    function ThemeStudioSettings(props) {
      const rpcCall = props?.rpcCall
      const [view, setView] = react.useState(null)
      const [draft, setDraft] = react.useState(null)
      const [loading, setLoading] = react.useState(true)
      const [busy, setBusy] = react.useState(false)
      const [status, setStatus] = react.useState(null)
      const fileRef = react.useRef(null)

      const syncDocument = (nextView) => {
        applyToDocument({
          themeId: nextView?.effective?.theme ?? nextView?.settings?.theme,
          settings: nextView?.effective ?? nextView?.settings,
          backgroundUrl: nextView?.backgroundUrl,
        })
      }

      const adopt = (nextView) => {
        setView(nextView)
        // 草稿用 effective（服务端已填好默认值），这样控件永远读到确定的形状，
        // 不必在每个输入框里写 `?? ''` 兜底。保存时服务端会再规范化一次，
        // 全默认值字段不会被写回磁盘。
        const seed = nextView?.effective ?? nextView?.settings ?? {}
        setDraft(JSON.parse(JSON.stringify(seed)))
        setLoading(false)
        setBusy(false)
        syncDocument(nextView)
      }

      const fail = (error) => {
        setStatus({ ok: false, msg: error?.message || String(error) })
        setBusy(false)
      }

      react.useEffect(() => {
        if (!rpcCall) return undefined
        let cancelled = false
        setLoading(true)
        rpcCall('describe', {})
          .then((next) => {
            if (!cancelled) adopt(next)
          })
          .catch((error) => {
            if (!cancelled) {
              setLoading(false)
              fail(error)
            }
          })
        return () => {
          cancelled = true
        }
      }, [rpcCall])

      /** 更新草稿并即时预览。 */
      const patch = (mutate) => {
        setDraft((prev) => {
          const next = mutate(prev ?? {})
          applyToDocument({
            themeId: next.theme,
            settings: next,
            backgroundUrl: view?.backgroundUrl,
          })
          return next
        })
      }

      const patchBackground = (key, value) => {
        patch((prev) => ({
          ...prev,
          background: { ...(prev.background ?? {}), [key]: value },
        }))
      }

      const patchFont = (key, value) => {
        patch((prev) => ({ ...prev, fonts: { ...(prev.fonts ?? {}), [key]: value } }))
      }

      const patchSize = (role, value) => {
        patch((prev) => ({ ...prev, fontSizes: { ...(prev.fontSizes ?? {}), [role]: value } }))
      }

      const patchGlass = (key, value) => {
        patch((prev) => ({ ...prev, glass: { ...(prev.glass ?? {}), [key]: value } }))
      }

      const patchColor = (key, value) => {
        patch((prev) => {
          const next = { ...(prev.fieldColors ?? {}) }
          if (value === '') delete next[key]
          else next[key] = value
          return { ...prev, fieldColors: next }
        })
      }

      const run = async (method, payload, okMessage) => {
        if (!rpcCall) return
        setBusy(true)
        setStatus(null)
        try {
          const next = await rpcCall(method, payload ?? {})
          adopt(next)
          setStatus({ ok: true, msg: okMessage })
        } catch (error) {
          fail(error)
        }
      }

      const uploadBackground = async (event) => {
        const file = event?.target?.files?.[0]
        if (!file || !rpcCall) return
        const maxBytes = view?.limits?.maxBackgroundBytes ?? 8 * 1024 * 1024
        if (file.size > maxBytes) {
          const mb = (file.size / 1024 / 1024).toFixed(1)
          const cap = (maxBytes / 1024 / 1024).toFixed(0)
          setStatus({ ok: false, msg: `图片 ${mb}MB 超过上限 ${cap}MB` })
          return
        }
        setBusy(true)
        setStatus(null)
        try {
          const dataUrl = await readFileAsDataUrl(file)
          const next = await rpcCall('uploadBackground', { dataUrl })
          adopt(next)
          setStatus({ ok: true, msg: `背景图已上传（${(file.size / 1024).toFixed(0)}KB）。` })
        } catch (error) {
          fail(error)
        } finally {
          if (fileRef.current) fileRef.current.value = ''
        }
      }

      if (loading) {
        return h('div', { className: 'ts-wrap' }, h('p', { className: 'ts-intro' }, '正在读取主题设置…'))
      }

      const themes = view?.themes ?? []
      const activeTheme = draft?.theme ?? 'none'
      const background = draft?.background ?? { mode: 'none', value: '', fit: 'cover', opacity: 100 }
      const fonts = draft?.fonts ?? {}
      const sizes = draft?.fontSizes ?? {}
      const glass = draft?.glass ?? {}
      const fieldColors = draft?.fieldColors ?? {}
      const isGlass = activeTheme === 'glass' || activeTheme === 'glass-color'

      // —— 背景类型控件 ——
      const modeControl = field('类型', segmented(
        [
          { value: 'none', label: '主题默认' },
          { value: 'color', label: '纯色' },
          { value: 'image', label: '图片' },
        ],
        background.mode ?? 'none',
        (mode) => patchBackground('mode', mode),
      ), { flex: '0 0 auto' })

      const colorControl = background.mode === 'color'
        ? field('背景色', h('input', {
            className: 'ts-input',
            type: 'color',
            value: toColorInputValue(background.value, '#1a1a1a'),
            onChange: (e) => patchBackground('value', e.target.value),
          }))
        : null

      // —— 背景图片控件 ——
      const imageRow = background.mode === 'image'
        ? h('div', { className: 'ts-row' },
            field('图片', h('input', {
              ref: fileRef,
              className: 'ts-input',
              type: 'file',
              accept: (view?.limits?.backgroundMime ?? []).join(','),
              disabled: busy,
              onChange: uploadBackground,
            }), { flex: '1 1 260px' }),
            field('铺满方式', segmented(
              [
                { value: 'cover', label: '铺满' },
                { value: 'contain', label: '留白' },
                { value: 'repeat', label: '平铺' },
              ],
              background.fit ?? 'cover',
              (fit) => patchBackground('fit', fit),
            ), { flex: '0 0 auto' }),
            field(`不透明度 ${background.opacity ?? 100}%`, h('input', {
              className: 'ts-input',
              type: 'range',
              min: 10,
              max: 100,
              step: 5,
              value: background.opacity ?? 100,
              onChange: (e) => patchBackground('opacity', Number(e.target.value)),
            }), { flex: '1 1 160px' }))
        : null

      const imagePreview = background.mode === 'image'
        ? h('div', {
            className: 'ts-bg-preview',
            style: view?.backgroundUrl ? { backgroundImage: `url("${view.backgroundUrl}")` } : undefined,
          }, view?.backgroundUrl ? null : '尚未上传图片')
        : null

      const clearRow = background.mode === 'image' && view?.backgroundUrl
        ? h('div', { className: 'ts-actions' },
            h('button', {
              className: 'ts-btn ts-btn-danger',
              type: 'button',
              disabled: busy,
              onClick: () => run('clearBackground', {}, '已移除背景图。'),
            }, '移除背景图'))
        : null

      // —— 字体与字号 ——
      const textOptions = view?.fontOptions?.text ?? TEXT_FONT_OPTIONS
      const codeOptions = view?.fontOptions?.code ?? CODE_FONT_OPTIONS
      const fontRow = h('div', { className: 'ts-row' },
        field('正文字体', fontSelect(textOptions, fonts.text, (val) => patchFont('text', val))),
        field('代码字体', fontSelect(codeOptions, fonts.code, (val) => patchFont('code', val))))

      const sizeRow = h('div', { className: 'ts-row' },
        Object.entries(FONT_SIZE_RANGES).map(([role, spec]) =>
          field(`${spec.label}字号 ${sizes[role] ?? '跟随'}`, h('input', {
            key: role,
            className: 'ts-input',
            type: 'range',
            min: spec.min,
            max: spec.max,
            step: 1,
            value: sizes[role] ?? spec.min,
            onChange: (e) => patchSize(role, Number(e.target.value)),
          }))))

      // —— 字段颜色 ——
      const colorGrid = h('div', { className: 'ts-colors' },
        FIELD_COLOR_ROLES.map((role) => {
          const current = fieldColors[role.key]
          return h('div', { key: role.key, className: 'ts-color' },
            h('input', {
              className: 'ts-input',
              type: 'color',
              title: role.label,
              value: toColorInputValue(current, '#888888'),
              onChange: (e) => patchColor(role.key, e.target.value),
            }),
            h('input', {
              className: 'ts-input',
              type: 'text',
              placeholder: role.label,
              value: current ?? '',
              onChange: (e) => patchColor(role.key, e.target.value.trim()),
            }),
            current
              ? h('button', {
                  className: 'ts-btn ts-btn-mini',
                  type: 'button',
                  onClick: () => patchColor(role.key, ''),
                }, '复位')
              : null)
        }))

      // —— 玻璃材质 ——
      const glassRow = isGlass
        ? h('div', { className: 'ts-row' },
            field(`模糊强度 ${glass.blur ?? '主题默认'}`, h('input', {
              className: 'ts-input',
              type: 'range',
              min: 0,
              max: 80,
              step: 2,
              value: glass.blur ?? 30,
              onChange: (e) => patchGlass('blur', Number(e.target.value)),
            })),
            field(`饱和度 ${glass.saturate ?? '主题默认'}`, h('input', {
              className: 'ts-input',
              type: 'range',
              min: 100,
              max: 300,
              step: 10,
              value: glass.saturate ?? 180,
              onChange: (e) => patchGlass('saturate', Number(e.target.value)),
            })))
        : null

      const statusRow = status
        ? h('div', { className: `ts-status ${status.ok ? 'ok' : 'err'}` }, status.msg)
        : null

      return h('div', { className: 'ts-wrap' },
        h('h2', null, '主题工作室'),
        h('p', { className: 'ts-intro' },
          '切换内置主题，并自定义背景、字体、字号与字段颜色。所有主题共用同一套 Token，仓库内所有插件都会跟随。'),

        h('div', { className: 'ts-section' },
          h('div', { className: 'ts-section-title' }, '内置主题'),
          h('p', { className: 'ts-section-hint' },
            '每款主题都同时带明暗两套色板，跟随宿主的明暗偏好自动切换。'),
          h('div', { className: 'ts-themes' },
            themes.map((theme) => themeCard(theme, activeTheme, (id) => patch((prev) => ({ ...prev, theme: id })))))),

        h('div', { className: 'ts-section' },
          h('div', { className: 'ts-section-title' }, '背景'),
          h('div', { className: 'ts-row' }, modeControl, colorControl),
          imageRow,
          imagePreview,
          clearRow),

        h('div', { className: 'ts-section' },
          h('div', { className: 'ts-section-title' }, '字体与字号'),
          h('p', { className: 'ts-section-hint' },
            '字体留空表示使用主题自带的字体栈。字号留空表示跟随宿主设置。'),
          fontRow,
          sizeRow),

        h('div', { className: 'ts-section' },
          h('div', { className: 'ts-section-title' }, '字段颜色'),
          h('p', { className: 'ts-section-hint' },
            '留空表示使用主题配色。改动同时作用于宿主组件与所有社区插件。'),
          colorGrid),

        glassRow
          ? h('div', { className: 'ts-section' },
              h('div', { className: 'ts-section-title' }, '玻璃材质'),
              h('p', { className: 'ts-section-hint' },
                '只在苹果玻璃主题下生效。模糊越强越「毛」，饱和度越高色相越鲜明。'),
              glassRow)
          : null,

        statusRow,

        h('div', { className: 'ts-actions' },
          h('button', {
            className: 'ts-btn',
            type: 'button',
            disabled: busy,
            onClick: () => run('reset', {}, '已恢复默认（保持原生风格、无自定义背景与字体）。'),
          }, '恢复默认'),
          h('button', {
            className: 'ts-btn ts-btn-primary',
            type: 'button',
            disabled: busy,
            onClick: () => run('save', { settings: draft }, '已保存。设置立即生效，并在服务端持久化。'),
          }, busy ? '保存中…' : '保存设置')),

        h('p', { className: 'ts-hint' }, `设置文件：${view?.settingsFile ?? ''}`),
        h('p', { className: 'ts-hint' }, `背景图目录：${view?.backgroundDir ?? ''}`))
    }

    const NAV_STYLE_ID = 'dsh-theme-studio-nav-styles'
    const NAV_CSS = 'button:has([data-settings-nav-label="dsh-theme-studio"]) > svg:first-child{display:none}'

    function IconPalette16({ size = 16 }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: '1.3',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
        h('path', { d: 'M8 2.2a5.8 5.8 0 1 0 0 11.6c.7 0 1.1-.5 1.1-1.1 0-.3-.1-.5-.3-.7-.2-.2-.3-.4-.3-.7 0-.6.5-1.1 1.1-1.1h.8a3.4 3.4 0 0 0 3.4-3.4c0-2.5-2.6-4.6-5.8-4.6Z' }),
        h('circle', { cx: '5.4', cy: '6.4', r: '.85' }),
        h('circle', { cx: '8.2', cy: '4.9', r: '.85' }),
        h('circle', { cx: '5.1', cy: '9.4', r: '.85' }))
    }

    /** 注入一段只加一次的样式。 */
    function ensureStyle(id, css) {
      if (typeof document === 'undefined') return
      if (document.getElementById(id)) return
      const style = document.createElement('style')
      style.id = id
      style.textContent = css
      document.head.appendChild(style)
    }

    function apply(ctx) {
      ensureStyle(NAV_STYLE_ID, NAV_CSS)
      ensureStyle(PANEL_CSS_ID, PANEL_CSS)

      const rpcCall = async (method, payload) => {
        const conn = ctx && ctx.connection
        const rpc = conn && conn.rpc
        if (!rpc || typeof rpc.call !== 'function') throw new Error('连接服务尚未就绪')
        const result = await rpc.call(RPC_CHANNEL, method, payload || {})
        if (result && result.ok === true) return result.value
        const message = result && result.error && result.error.message
        throw new Error(message || (typeof result?.error === 'string' ? result.error : '请求失败'))
      }

      // 启动时同步一次：服务端已直出首屏，这里覆盖「用户在另一个窗口改了设置」的情况。
      if (typeof document !== 'undefined') {
        rpcCall('describe', {})
          .then((view) => applyToDocument({
            themeId: view?.effective?.theme ?? view?.settings?.theme,
            settings: view?.effective ?? view?.settings,
            backgroundUrl: view?.backgroundUrl,
          }))
          .catch(() => {
            // 服务端不可用时静默：首屏已由注入 CSS 渲染，不该在控制台刷错误
          })
      }

      const label = () =>
        h('span', {
          'data-settings-nav-label': 'dsh-theme-studio',
          style: { display: 'inline-flex', alignItems: 'center', gap: 8 },
        },
          h('span', { style: { display: 'inline-flex' } }, h(IconPalette16, { size: 16 })),
          h('span', null, '主题工作室'))

      ctx.slots.inject(SETTINGS_SLOT, () =>
        ctx.slots.register({
          name: SETTINGS_SLOT,
          id: 'dsh-theme-studio',
          order: 12,
          label,
          inject: () => ({ rpcCall }),
        }, ThemeStudioSettings))
    }

    exports.apply = apply
    exports.inject = ['slots', 'connection']
    exports.internals = {
      THEME_ATTR,
      LEGACY_ATTR,
      STYLE_ID,
      CUSTOM_STYLE_ID,
      FIELD_COLOR_ROLES,
      FIELD_HOST_TOKENS,
      FONT_SIZE_RANGES,
      TEXT_FONT_OPTIONS,
      CODE_FONT_OPTIONS,
      legacyIdOf,
      applyToDocument,
      customLayerCss,
    }
    return module.exports
  },
})
