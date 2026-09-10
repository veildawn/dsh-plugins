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
      '--dsw-alias-bg-base': { light: '#F7F7F5', dark: '#1A1A1A' },
      '--dsw-alias-bg-layer-1': { light: '#FFFFFF', dark: '#222222' },
      '--dsw-alias-bg-layer-2': { light: '#FFFFFF', dark: '#262626' },
      '--dsw-alias-bg-layer-3': { light: '#F0F0EE', dark: '#2A2A2A' },
      '--dsw-alias-bg-module-platform': { light: '#F0F0EE', dark: '#2A2A2A' },
      '--dsw-alias-bg-overlay': { light: '#FFFFFF', dark: '#262626' },
      '--dsw-specific-sidebar-fill': { light: '#FFFFFF', dark: '#222222' },
      '--dsw-specific-sidebar-nav-item-active': { light: '#F0F0EE', dark: '#2A2A2A' },
      '--dsw-specific-sidebar-nav-item-active-accent': { light: '#E85D3A', dark: '#E85D3A' },
      '--dsw-specific-sidebar-nav-item-hover': { light: 'rgba(0,0,0,0.05)', dark: 'rgba(255,255,255,0.06)' },
      '--dsw-specific-input-major': { light: '#F0F0EE', dark: '#2A2A2A' },
      '--dsw-specific-bubble': { light: '#F0F0EE', dark: '#2A2A2A' },
      '--dsw-specific-menu': { light: '#FFFFFF', dark: '#262626' },
      '--dsw-specific-tip': { light: '#FFFFFF', dark: '#262626' },
      '--dsw-specific-selector': { light: '#F0F0EE', dark: '#2A2A2A' },
      '--dsw-alias-label-primary': { light: '#1A1A1A', dark: '#F2F2F2' },
      '--dsw-alias-label-secondary': { light: '#5C5C5C', dark: '#A3A3A3' },
      '--dsw-alias-label-tertiary': { light: '#8A8A8A', dark: '#737373' },
      '--dsw-alias-label-caption': { light: '#8A8A8A', dark: '#737373' },
      '--dsw-alias-label-primary-dimmed': { light: '#5C5C5C', dark: '#A3A3A3' },
      '--dsw-alias-label-primary-bluish': { light: '#5C5C5C', dark: '#A3A3A3' },
      '--dsw-alias-label-primary-inverted': { light: '#F7F7F5', dark: '#1A1A1A' },
      '--dsw-alias-brand-primary': { light: '#E85D3A', dark: '#E85D3A' },
      '--dsw-alias-brand-text': { light: '#E85D3A', dark: '#E85D3A' },
      '--dsw-alias-brand-subtle': { light: 'rgba(232,93,58,0.10)', dark: 'rgba(232,93,58,0.12)' },
      '--dsw-alias-button-primary-fill': { light: '#E85D3A', dark: '#E85D3A' },
      '--dsw-alias-button-primary-hover': { light: '#F06A48', dark: '#F06A48' },
      '--dsw-alias-button-primary-dimmed': { light: '#D14F2E', dark: '#D14F2E' },
      '--dsw-alias-button-elevated-fill': { light: '#F0F0EE', dark: '#2A2A2A' },
      '--dsw-alias-button-floating-fill': { light: '#F0F0EE', dark: '#2A2A2A' },
      '--dsw-alias-button-floating-hover': { light: 'rgba(0,0,0,0.05)', dark: 'rgba(255,255,255,0.06)' },
      '--dsw-alias-button-info-fill': { light: '#1A1A1A', dark: '#F2F2F2' },
      '--dsw-alias-button-info-hover': { light: '#000000', dark: '#FFFFFF' },
      '--dsw-static-deepseek-200': { light: '#1A1A1A', dark: '#F2F2F2' },
      '--dsw-static-deepseek-400': { light: '#5C5C5C', dark: '#A3A3A3' },
      '--dsw-static-deepseek-450': { light: '#5C5C5C', dark: '#A3A3A3' },
      '--dsw-static-deepseek-500': { light: '#5C5C5C', dark: '#A3A3A3' },
      '--dsw-alias-border-l1': { light: 'rgba(0,0,0,0.08)', dark: 'rgba(255,255,255,0.08)' },
      '--dsw-alias-border-l2': { light: 'rgba(0,0,0,0.12)', dark: 'rgba(255,255,255,0.12)' },
      '--dsw-alias-border-l3': { light: 'rgba(0,0,0,0.08)', dark: 'rgba(255,255,255,0.08)' },
      '--dsw-alias-border-l4': { light: 'rgba(0,0,0,0.08)', dark: 'rgba(255,255,255,0.08)' },
      '--dsw-alias-interactive-bg-hover': { light: 'rgba(0,0,0,0.05)', dark: 'rgba(255,255,255,0.06)' },
      '--dsw-alias-interactive-bg-hover-solid': { light: 'rgba(0,0,0,0.08)', dark: 'rgba(255,255,255,0.10)' },
      '--dsw-alias-interactive-bg-active': { light: '#F0F0EE', dark: '#2A2A2A' },
      '--dsw-alias-state-business-primary': { light: '#E85D3A', dark: '#E85D3A' },
      '--dsw-alias-state-business-tertiary': { light: 'rgba(232,93,58,0.10)', dark: 'rgba(232,93,58,0.12)' },
      '--dsw-alias-state-error-primary': { light: '#5C5C5C', dark: '#A3A3A3' },
      '--dsw-alias-state-error-secondary': { light: 'rgba(115, 115, 115, 0.18)', dark: 'rgba(163, 163, 163, 0.2)' },
      '--dsw-alias-state-warn-primary': { light: '#D97706', dark: '#F59E0B' },
      '--dsw-alias-state-warn-secondary': { light: 'rgba(217, 119, 6, 0.16)', dark: 'rgba(245, 158, 11, 0.2)' },
      '--dsw-alias-state-warn-tertiary': { light: '#F0F0EE', dark: '#2A2A2A' },
      '--dsw-alias-state-warn-label': { light: '#3F3F3F', dark: '#D4D4D4' },
      '--dsw-alias-markdown-code-block': { light: '#EFEFEA', dark: '#161616' },
      '--dsw-alias-markdown-code-block-banner': { light: '#FFFFFF', dark: '#222222' },
      '--dsw-alias-markdown-inline-code': { light: '#F0F0EE', dark: '#2A2A2A' },
      '--dsw-alias-toast-bg': { light: '#FFFFFF', dark: '#262626' },
      '--zcode-handle': { light: '#D4D4D4', dark: '#444444' },
      '--zcode-text-body': { light: '#3F3F3F', dark: '#D4D4D4' },
      '--zcode-text-strong': { light: '#111111', dark: '#F8FAFC' },
      '--zcode-inline-code': { light: '#1E1E1C', dark: '#E2E8F0' },
      '--zcode-success': { light: '#3D8B50', dark: '#5A9A6A' },
      '--zcode-error': { light: '#C45C5C', dark: '#C45C5C' },
      '--zcode-brand-focus': { light: 'rgba(232,93,58,0.22)', dark: 'rgba(232,93,58,0.25)' },
      '--zcode-border-input': { light: 'rgba(0,0,0,0.10)', dark: 'rgba(255,255,255,0.10)' },
      '--zcode-project': { light: '#38BDF8', dark: '#38BDF8' },
      '--zcode-project-subtle': { light: 'rgba(56, 189, 248, 0.12)', dark: 'rgba(56, 189, 248, 0.12)' },
      '--zcode-danger-access': { light: '#FF8A30', dark: '#FF8A30' },
      '--zcode-danger-access-hover': { light: '#FFA052', dark: '#FFA052' },
      '--zcode-danger-access-subtle': { light: 'rgba(255, 138, 48, 0.12)', dark: 'rgba(255, 138, 48, 0.12)' },
    }

    function hostTokenOverrides() {
      return HOST_TOKEN_MAP
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
