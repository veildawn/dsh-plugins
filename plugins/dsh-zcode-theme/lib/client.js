/**
 * dsh-zcode-theme 客户端半侧。
 *
 * 客户端 bundle 不能 import 宿主模块，所以 Token 映射在此内联一份；它与
 * `lib/tokens.js` 的 `HOST_TOKEN_MAP` 必须逐项一致，由 test/theme.test.mjs 守护。
 */
window.__ModuleLoader__.load({
  id: '@weniatall/dsh-zcode-theme',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports
    const inject = ['theme']
    const THEME_ATTR = 'data-dsh-theme'
    const THEME_SCOPE = 'zcode'
    const TOKEN_SOURCE = 'dsh-zcode-theme'

    // 与 lib/tokens.js 的 HOST_TOKEN_MAP 对齐；客户端 bundle 不能 import 宿主模块。
    const HOST_TOKEN_MAP = {
      "--dsw-alias-bg-base": { light: "#f8f8f8", dark: "#161616" },
      "--dsw-alias-bg-layer-1": { light: "#ffffff", dark: "#202020" },
      "--dsw-alias-bg-layer-2": { light: "#ffffff", dark: "#2b2b2b" },
      "--dsw-alias-bg-layer-3": { light: "#ffffff", dark: "#2b2b2b" },
      "--dsw-alias-bg-layer-4": { light: "#f0f0f0", dark: "#363636" },
      "--dsw-alias-bg-l1": { light: "#f8f8f8", dark: "#161616" },
      "--dsw-alias-fill-l1": { light: "rgba(13, 13, 13, 0.03)", dark: "rgba(255, 255, 255, 0.05)" },
      "--dsw-alias-fill-l2": { light: "rgba(13, 13, 13, 0.05)", dark: "rgba(255, 255, 255, 0.1)" },
      "--dsw-alias-fill-tsp-secondary": { light: "#e6e6e6", dark: "#363636" },
      "--dsw-alias-bg-module-platform": { light: "#ffffff", dark: "#2b2b2b" },
      "--dsw-alias-bg-overlay": { light: "#ffffff", dark: "#2b2b2b" },
      "--dsw-alias-bg-multi-select": { light: "#e6e6e6", dark: "#363636" },
      "--dsw-alias-bg-skeleton": { light: "rgba(13, 13, 13, 0.03)", dark: "rgba(255, 255, 255, 0.05)" },
      "--dsw-alias-bg-mask-1": { light: "#ececee", dark: "#2b2b2b" },
      "--dsw-alias-bg-mask-2": { light: "rgba(13, 13, 13, 0.03)", dark: "rgba(255, 255, 255, 0.05)" },
      "--dsw-alias-bg-mask-3": { light: "#ececee", dark: "#2b2b2b" },
      "--dsw-alias-bg-mask-photo": { light: "#ececee", dark: "#2b2b2b" },
      "--dsw-alias-bg-mask-drop": { light: "#f8f8f8", dark: "#161616" },
      "--dsw-alias-bg-document-preview": { light: "#ffffff", dark: "#202020" },
      "--dsw-alias-bg-document-selection": { light: "rgba(37, 99, 235, 0.4)", dark: "rgba(37, 99, 235, 0.4)" },
      "--dsw-alias-label-document-preview": { light: "color-mix(in oklab, #262626 60%, transparent)", dark: "color-mix(in oklab, #d4d4d4 60%, transparent)" },
      "--dsw-specific-sidebar-fill": { light: "#f0f0f0", dark: "#161616" },
      "--dsw-specific-sidebar-nav-item-active": { light: "#ffffff", dark: "#2b2b2b" },
      "--dsw-specific-sidebar-nav-item-active-accent": { light: "#262626", dark: "#d4d4d4" },
      "--dsw-specific-sidebar-nav-item-hover": { light: "rgba(13, 13, 13, 0.03)", dark: "rgba(255, 255, 255, 0.05)" },
      "--dsw-specific-input-major": { light: "#ffffff", dark: "#2b2b2b" },
      "--dsw-specific-login-input": { light: "#ffffff", dark: "#202020" },
      "--dsw-specific-bubble": { light: "#ffffff", dark: "#2b2b2b" },
      "--dsw-specific-bubble-highlight": { light: "#000000", dark: "#ffffff" },
      "--dsw-specific-menu": { light: "#ffffff", dark: "#2b2b2b" },
      "--dsw-specific-tip": { light: "#f0f0f0", dark: "#2b2b2b" },
      "--dsw-specific-selector": { light: "#e6e6e6", dark: "#363636" },
      "--dsw-alias-menu-group-header-fill": { light: "#ffffff", dark: "#202020" },
      "--dsw-alias-label-primary": { light: "#262626", dark: "#d4d4d4" },
      "--dsw-alias-label-secondary": { light: "color-mix(in oklab, #262626 60%, transparent)", dark: "color-mix(in oklab, #d4d4d4 60%, transparent)" },
      "--dsw-alias-label-tertiary": { light: "color-mix(in oklab, #262626 40%, transparent)", dark: "color-mix(in oklab, #d4d4d4 30%, transparent)" },
      "--dsw-alias-label-caption": { light: "color-mix(in oklab, #262626 40%, transparent)", dark: "color-mix(in oklab, #d4d4d4 30%, transparent)" },
      "--dsw-alias-label-quaternary": { light: "color-mix(in oklab, #262626 40%, transparent)", dark: "color-mix(in oklab, #d4d4d4 30%, transparent)" },
      "--dsw-alias-label-dimmed": { light: "color-mix(in oklab, #262626 40%, transparent)", dark: "color-mix(in oklab, #d4d4d4 30%, transparent)" },
      "--dsw-alias-label-primary-dimmed": { light: "color-mix(in oklab, #262626 60%, transparent)", dark: "color-mix(in oklab, #d4d4d4 60%, transparent)" },
      "--dsw-alias-label-primary-bluish": { light: "#262626", dark: "#d4d4d4" },
      "--dsw-alias-label-primary-inverted": { light: "#ffffff", dark: "#000000" },
      "--dsw-alias-label-primary-foreground": { light: "#ffffff", dark: "#000000" },
      "--dsw-alias-label-shimmer": { light: "color-mix(in oklab, #262626 40%, transparent)", dark: "color-mix(in oklab, #d4d4d4 30%, transparent)" },
      "--dsw-alias-label-deep-diving": { light: "#262626", dark: "#d4d4d4" },
      "--dsw-alias-label-deep-diving-shimmer": { light: "color-mix(in oklab, #262626 60%, transparent)", dark: "color-mix(in oklab, #d4d4d4 60%, transparent)" },
      "--dsw-alias-menu-icon": { light: "color-mix(in oklab, #262626 60%, transparent)", dark: "color-mix(in oklab, #d4d4d4 60%, transparent)" },
      "--dsw-alias-brand-primary": { light: "#000000", dark: "#ffffff" },
      "--dsw-alias-brand-text": { light: "#000000", dark: "#ffffff" },
      "--dsw-alias-brand-subtle": { light: "rgba(13, 13, 13, 0.03)", dark: "rgba(255, 255, 255, 0.05)" },
      "--dsw-alias-brand-primary-invert": { light: "#ffffff", dark: "#000000" },
      "--dsw-alias-brand-primary-new-colorprimary-new-color": { light: "#000000", dark: "#ffffff" },
      "--dsw-alias-button-primary-fill": { light: "#000000", dark: "#ffffff" },
      "--dsw-alias-button-primary-hover": { light: "#000000", dark: "#ffffff" },
      "--dsw-alias-button-primary-dimmed": { light: "#e6e6e6", dark: "#363636" },
      "--dsw-alias-button-info-fill": { light: "#000000", dark: "#ffffff" },
      "--dsw-alias-button-info-hover": { light: "#000000", dark: "#ffffff" },
      "--dsw-alias-button-contrast-fill": { light: "#000000", dark: "#ffffff" },
      "--dsw-alias-button-elevated-fill": { light: "#ffffff", dark: "#2b2b2b" },
      "--dsw-alias-button-floating-fill": { light: "#ffffff", dark: "#2b2b2b" },
      "--dsw-alias-button-floating-hover": { light: "#f0f0f0", dark: "#363636" },
      "--dsw-alias-button-ghost-active-fill": { light: "#e6e6e6", dark: "#363636" },
      "--dsw-alias-button-ghost-active-hover": { light: "#f0f0f0", dark: "#363636" },
      "--dsw-alias-button-ghost-active-border": { light: "rgba(13, 13, 13, 0.1)", dark: "rgba(255, 255, 255, 0.1)" },
      "--dsw-alias-button-tool-bar-fill": { light: "rgba(13, 13, 13, 0.05)", dark: "rgba(255, 255, 255, 0.1)" },
      "--dsw-alias-button-tool-bar-fill-invisible": { light: "rgba(13, 13, 13, 0.03)", dark: "rgba(255, 255, 255, 0.05)" },
      "--dsw-alias-button-tool-bar-hover": { light: "rgba(13, 13, 13, 0.05)", dark: "rgba(255, 255, 255, 0.1)" },
      "--dsw-alias-switch-thumb": { light: "#ffffff", dark: "#000000" },
      "--dsw-static-deepseek-200": { light: "#262626", dark: "#d4d4d4" },
      "--dsw-static-deepseek-400": { light: "color-mix(in oklab, #262626 60%, transparent)", dark: "color-mix(in oklab, #d4d4d4 60%, transparent)" },
      "--dsw-static-deepseek-450": { light: "color-mix(in oklab, #262626 60%, transparent)", dark: "color-mix(in oklab, #d4d4d4 60%, transparent)" },
      "--dsw-static-deepseek-500": { light: "color-mix(in oklab, #262626 60%, transparent)", dark: "color-mix(in oklab, #d4d4d4 60%, transparent)" },
      "--dsw-alias-border-l1": { light: "rgba(13, 13, 13, 0.1)", dark: "rgba(255, 255, 255, 0.1)" },
      "--dsw-alias-border-l2": { light: "rgba(13, 13, 13, 0.15)", dark: "rgba(255, 255, 255, 0.15)" },
      "--dsw-alias-border-l2-darkmode-thin": { light: "rgba(13, 13, 13, 0.1)", dark: "rgba(255, 255, 255, 0.1)" },
      "--dsw-alias-border-l3": { light: "rgba(13, 13, 13, 0.15)", dark: "rgba(255, 255, 255, 0.15)" },
      "--dsw-alias-border-l4": { light: "rgba(13, 13, 13, 0.15)", dark: "rgba(255, 255, 255, 0.15)" },
      "--dsw-alias-border-inverted": { light: "rgba(13, 13, 13, 0.03)", dark: "rgba(255, 255, 255, 0.05)" },
      "--dsw-alias-border-inverted2": { light: "rgba(13, 13, 13, 0.03)", dark: "rgba(255, 255, 255, 0.05)" },
      "--dsw-alias-separator-primary": { light: "rgba(13, 13, 13, 0.1)", dark: "rgba(255, 255, 255, 0.1)" },
      "--dsw-alias-interactive-bg-hover": { light: "rgba(13, 13, 13, 0.03)", dark: "rgba(255, 255, 255, 0.05)" },
      "--dsw-alias-interactive-bg-hover-solid": { light: "rgba(13, 13, 13, 0.05)", dark: "rgba(255, 255, 255, 0.1)" },
      "--dsw-alias-interactive-bg-hover-accent": { light: "rgba(13, 13, 13, 0.05)", dark: "rgba(255, 255, 255, 0.1)" },
      "--dsw-alias-interactive-bg-hover-danger": { light: "color-mix(in srgb, #e03131 10%, transparent)", dark: "color-mix(in srgb, #ff5c5c 16%, transparent)" },
      "--dsw-alias-interactive-bg-active": { light: "rgba(13, 13, 13, 0.05)", dark: "rgba(255, 255, 255, 0.1)" },
      "--dsw-alias-state-business-primary": { light: "#000000", dark: "#ffffff" },
      "--dsw-alias-state-business-tertiary": { light: "rgba(13, 13, 13, 0.03)", dark: "rgba(255, 255, 255, 0.05)" },
      "--dsw-alias-state-success-primary": { light: "#1e8a3e", dark: "#46bf72" },
      "--dsw-alias-state-success-secondary": { light: "#166b32", dark: "#87d9a4" },
      "--dsw-alias-state-success-tertiary": { light: "#eaf7ee", dark: "rgba(70, 191, 114, 0.16)" },
      "--dsw-alias-state-warn-primary": { light: "#e07b00", dark: "#ff8a30" },
      "--dsw-alias-state-warn-secondary": { light: "#914e00", dark: "#ffa159" },
      "--dsw-alias-state-warn-tertiary": { light: "color-mix(in srgb, #e07b00 12%, transparent)", dark: "color-mix(in srgb, #ff8a30 16%, transparent)" },
      "--dsw-alias-state-warn-label": { light: "#914e00", dark: "#ffa159" },
      "--dsw-alias-state-error-primary": { light: "#e03131", dark: "#ff5c5c" },
      "--dsw-alias-state-error-secondary": { light: "color-mix(in srgb, #e03131 10%, transparent)", dark: "color-mix(in srgb, #ff5c5c 16%, transparent)" },
      "--dsw-alias-state-idle-primary": { light: "#9e77ed", dark: "#7b5ce5" },
      "--dsw-alias-markdown-code-block": { light: "#f8f8f8", dark: "#161616" },
      "--dsw-alias-markdown-code-block-banner": { light: "#ffffff", dark: "#202020" },
      "--dsw-alias-markdown-inline-code": { light: "#e6e6e6", dark: "#363636" },
      "--dsw-alias-markdown-citation": { light: "#ffffff", dark: "#202020" },
      "--dsw-alias-markdown-tag": { light: "#e6e6e6", dark: "#363636" },
      "--dsw-alias-markdown-placeholder": { light: "#e6e6e6", dark: "#363636" },
      "--dsw-alias-markdown-code-segment-selected": { light: "#ffffff", dark: "#202020" },
      "--dsw-alias-markdown-code-segment-unselected": { light: "#e6e6e6", dark: "#363636" },
      "--dsw-alias-code-diff-added": { light: "color-mix(in srgb, #1e8a3e 8%, transparent)", dark: "color-mix(in srgb, #46bf72 12%, transparent)" },
      "--dsw-alias-code-diff-deleted": { light: "color-mix(in srgb, #e03131 8%, transparent)", dark: "color-mix(in srgb, #ff5c5c 12%, transparent)" },
      "--dsw-alias-file-diff-added-bg": { light: "color-mix(in srgb, #1e8a3e 12%, transparent)", dark: "color-mix(in srgb, #46bf72 16%, transparent)" },
      "--dsw-alias-file-diff-added-gutter": { light: "color-mix(in srgb, #1e8a3e 18%, transparent)", dark: "color-mix(in srgb, #46bf72 24%, transparent)" },
      "--dsw-alias-file-diff-added-marker": { light: "#1e8a3e", dark: "#46bf72" },
      "--dsw-alias-file-diff-deleted-bg": { light: "color-mix(in srgb, #e03131 12%, transparent)", dark: "color-mix(in srgb, #ff5c5c 16%, transparent)" },
      "--dsw-alias-file-diff-deleted-gutter": { light: "color-mix(in srgb, #e03131 18%, transparent)", dark: "color-mix(in srgb, #ff5c5c 24%, transparent)" },
      "--dsw-alias-file-diff-deleted-marker": { light: "#e03131", dark: "#ff5c5c" },
      "--dsw-alias-turn-trigger-bg": { light: "#f8f8f8", dark: "#161616" },
      "--dsw-alias-turn-trigger-bg-hover": { light: "rgba(13, 13, 13, 0.03)", dark: "rgba(255, 255, 255, 0.05)" },
      "--dsw-alias-toast-bg": { light: "#ffffff", dark: "#2b2b2b" },
      "--dsw-alias-toast-label": { light: "#262626", dark: "#d4d4d4" },
      "--dsw-alias-tooltip-bg": { light: "#f0f0f0", dark: "#2b2b2b" },
      "--dsw-alias-tooltip-key-bg": { light: "#e6e6e6", dark: "#363636" },
      "--dsw-alias-link": { light: "#000000", dark: "#ffffff" },
      "--dsw-alias-onboarding-accent": { light: "#000000", dark: "#ffffff" },
      "--dsw-alias-onboarding-card-fill": { light: "#ffffff", dark: "#2b2b2b" },
      "--dsw-alias-onboarding-secondary-fill": { light: "#e6e6e6", dark: "#363636" },
      "--dsw-alias-onboarding-checkbox-border": { light: "rgba(13, 13, 13, 0.15)", dark: "rgba(255, 255, 255, 0.15)" },
      "--dsw-alias-settings-card-fill": { light: "#ffffff", dark: "#2b2b2b" },
      "--dsw-alias-settings-card-stroke": { light: "rgba(13, 13, 13, 0.15)", dark: "rgba(255, 255, 255, 0.15)" },
      "--dsw-alias-scrollbar-bg-l1": { light: "#e6e6e6", dark: "#363636" },
      "--dsw-alias-scrollbar-bg-l2": { light: "#e6e6e6", dark: "#363636" },
      "--dsw-alias-scrollbar-hover-l1": { light: "#f0f0f0", dark: "#363636" },
      "--dsw-alias-scrollbar-hover-l2": { light: "#f0f0f0", dark: "#363636" },
      "--dsw-focus-ring-color": { light: "#262626", dark: "#d4d4d4" },
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
