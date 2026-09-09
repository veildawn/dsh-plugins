window.__ModuleLoader__.load({
  id: 'dsh-zcode-theme',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports
    const inject = ['theme']
    const THEME_ATTR = 'data-dsh-theme'
    const THEME_SCOPE = 'zcode'
    const TOKEN_SOURCE = 'dsh-zcode-theme'

    // 与 lib/tokens.js 的 HOST_TOKEN_MAP 对齐；客户端 bundle 不能 import 宿主模块。
    const HOST_TOKEN_MAP = {
      '--dsw-alias-bg-base': '#1A1A1A',
      '--dsw-alias-bg-layer-1': '#222222',
      '--dsw-alias-bg-layer-2': '#262626',
      '--dsw-alias-bg-layer-3': '#2A2A2A',
      '--dsw-alias-bg-module-platform': '#2A2A2A',
      '--dsw-alias-bg-overlay': '#262626',
      '--dsw-specific-sidebar-fill': '#222222',
      '--dsw-specific-sidebar-nav-item-active': '#2A2A2A',
      '--dsw-specific-sidebar-nav-item-active-accent': '#E85D3A',
      '--dsw-specific-sidebar-nav-item-hover': 'rgba(255,255,255,0.06)',
      '--dsw-specific-input-major': '#2A2A2A',
      '--dsw-specific-bubble': '#2A2A2A',
      '--dsw-specific-menu': '#262626',
      '--dsw-specific-tip': '#262626',
      '--dsw-specific-selector': '#2A2A2A',
      '--dsw-alias-label-primary': '#F2F2F2',
      '--dsw-alias-label-secondary': '#A3A3A3',
      '--dsw-alias-label-tertiary': '#737373',
      '--dsw-alias-label-caption': '#737373',
      '--dsw-alias-label-primary-dimmed': '#A3A3A3',
      '--dsw-alias-label-primary-bluish': '#A3A3A3',
      '--dsw-alias-label-primary-inverted': '#1A1A1A',
      '--dsw-alias-brand-primary': '#E85D3A',
      '--dsw-alias-brand-text': '#E85D3A',
      '--dsw-alias-brand-subtle': 'rgba(232,93,58,0.12)',
      '--dsw-alias-button-primary-fill': '#E85D3A',
      '--dsw-alias-button-primary-hover': '#F06A48',
      '--dsw-alias-button-primary-dimmed': '#D14F2E',
      '--dsw-alias-button-elevated-fill': '#2A2A2A',
      '--dsw-alias-button-floating-fill': '#2A2A2A',
      '--dsw-alias-button-floating-hover': 'rgba(255,255,255,0.06)',
      '--dsw-alias-button-info-fill': '#F2F2F2',
      '--dsw-alias-button-info-hover': '#FFFFFF',
      '--dsw-static-deepseek-200': '#F2F2F2',
      '--dsw-static-deepseek-400': '#A3A3A3',
      '--dsw-static-deepseek-450': '#A3A3A3',
      '--dsw-static-deepseek-500': '#A3A3A3',
      '--dsw-alias-border-l1': 'rgba(255,255,255,0.08)',
      '--dsw-alias-border-l2': 'rgba(255,255,255,0.12)',
      '--dsw-alias-border-l3': 'rgba(255,255,255,0.08)',
      '--dsw-alias-border-l4': 'rgba(255,255,255,0.08)',
      '--dsw-alias-interactive-bg-hover': 'rgba(255,255,255,0.06)',
      '--dsw-alias-interactive-bg-hover-solid': 'rgba(255,255,255,0.10)',
      '--dsw-alias-interactive-bg-active': '#2A2A2A',
      '--dsw-alias-state-business-primary': '#E85D3A',
      '--dsw-alias-state-business-tertiary': 'rgba(232,93,58,0.12)',
      '--dsw-alias-state-error-primary': '#A3A3A3',
      '--dsw-alias-state-error-secondary': 'rgba(163, 163, 163, 0.2)',
      '--dsw-alias-state-warn-primary': '#F59E0B',
      '--dsw-alias-state-warn-secondary': 'rgba(245, 158, 11, 0.2)',
      '--dsw-alias-state-warn-tertiary': '#2A2A2A',
      '--dsw-alias-state-warn-label': '#D4D4D4',
      '--dsw-alias-markdown-code-block': '#161616',
      '--dsw-alias-markdown-code-block-banner': '#222222',
      '--dsw-alias-markdown-inline-code': '#2A2A2A',
      '--dsw-alias-toast-bg': '#262626',
    }

    function hostTokenOverrides() {
      const overrides = {}
      for (const [name, value] of Object.entries(HOST_TOKEN_MAP)) {
        overrides[name] = { light: value, dark: value }
      }
      return overrides
    }

    function applyScope(doc) {
      const root = doc.documentElement
      if (!root) return () => {}
      const previous = root.getAttribute(THEME_ATTR)
      root.setAttribute(THEME_ATTR, THEME_SCOPE)
      return () => {
        if (previous == null) root.removeAttribute(THEME_ATTR)
        else root.setAttribute(THEME_ATTR, previous)
      }
    }

    function mount(ctx) {
      const doc = globalThis.document
      const restoreScope = doc ? applyScope(doc) : () => {}
      let disposeTokens = () => {}
      try {
        disposeTokens = ctx.theme.overrideTokens(TOKEN_SOURCE, hostTokenOverrides())
      } catch (error) {
        console.warn('zcode-theme: 覆盖宿主 Token 失败', error)
      }
      return () => {
        disposeTokens()
        restoreScope()
      }
    }

    function apply(ctx) {
      ctx.effect(() => mount(ctx), 'zcode-theme: visual system')
    }

    exports.apply = apply
    exports.inject = inject
    exports.internals = {
      THEME_ATTR,
      THEME_SCOPE,
      TOKEN_SOURCE,
      HOST_TOKEN_MAP,
      hostTokenOverrides,
      applyScope,
      mount,
    }
    return module.exports
  },
})
