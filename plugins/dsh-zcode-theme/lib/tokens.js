/**
 * ZCode Design Tokens。
 * 色值与圆角只在此维护一份，CSS / 宿主 Token 映射均由此派生。
 */

export const THEME_SCOPE = 'zcode'
export const THEME_ATTR = 'data-dsh-theme'
export const STYLE_ID = 'dsh-zcode-theme'
export const TOKEN_SOURCE = 'dsh-zcode-theme'

export const zcodeTokens = {
  color: {
    bgBase: '#1A1A1A',
    bgLayer1: '#222222',
    bgLayer2: '#262626',
    bgModule: '#2A2A2A',
    bgCode: '#161616',

    textPrimary: '#F2F2F2',
    textSecondary: '#A3A3A3',
    textTertiary: '#737373',
    textOnBrand: '#FFFFFF',

    brand: '#E85D3A',
    brandHover: '#F06A48',
    brandActive: '#D14F2E',
    brandSubtle: 'rgba(232,93,58,0.12)',
    brandFocus: 'rgba(232,93,58,0.25)',

    borderL1: 'rgba(255,255,255,0.08)',
    borderL2: 'rgba(255,255,255,0.12)',
    borderInput: 'rgba(255,255,255,0.10)',

    interactiveHover: 'rgba(255,255,255,0.06)',
    interactivePressed: 'rgba(255,255,255,0.10)',

    handle: '#444444',
    success: '#5A9A6A',
    error: '#C45C5C',
  },

  radius: {
    small: '8px',
    session: '10px',
    button: '12px',
    input: '14px',
    card: '16px',
    dialog: '20px',
    pill: '999px',
  },

  touch: {
    min: '44px',
  },

  motion: {
    blur: '18px',
    sendScale: '0.95',
  },
}

/** 规范要求覆盖的宿主 Token（测试 28.1）。 */
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
]

/** 宿主不存在，主题 CSS / JS 禁止引用。 */
export const FORBIDDEN_HOST_TOKENS = [
  '--dsw-alias-bg-inverse',
  '--dsw-alias-label-inverse',
]

/** 宿主默认品牌蓝，主题产物中不得残留。 */
export const FORBIDDEN_COLORS = [
  '#4d6bfe',
  '#4D6BFE',
]

const C = zcodeTokens.color

/**
 * 宿主 `--dsw-*` 映射。规范表之外补了会残留蓝色的真实 Token
 *（主按钮悬停、业务强调色、输入/气泡/代码块表面）。
 */
export const HOST_TOKEN_MAP = {
  '--dsw-alias-bg-base': C.bgBase,
  '--dsw-alias-bg-layer-1': C.bgLayer1,
  '--dsw-alias-bg-layer-2': C.bgLayer2,
  '--dsw-alias-bg-layer-3': C.bgModule,
  '--dsw-alias-bg-module-platform': C.bgModule,
  '--dsw-alias-bg-overlay': C.bgLayer2,
  '--dsw-specific-sidebar-fill': C.bgLayer1,
  '--dsw-specific-sidebar-nav-item-active': C.bgModule,
  '--dsw-specific-sidebar-nav-item-active-accent': C.brand,
  '--dsw-specific-sidebar-nav-item-hover': C.interactiveHover,
  '--dsw-specific-input-major': C.bgModule,
  '--dsw-specific-bubble': C.bgModule,
  '--dsw-specific-menu': C.bgLayer2,
  '--dsw-specific-tip': C.bgLayer2,
  '--dsw-specific-selector': C.bgModule,
  '--dsw-alias-label-primary': C.textPrimary,
  '--dsw-alias-label-secondary': C.textSecondary,
  '--dsw-alias-label-tertiary': C.textTertiary,
  '--dsw-alias-label-caption': C.textTertiary,
  '--dsw-alias-label-primary-dimmed': C.textSecondary,
  '--dsw-alias-label-primary-bluish': C.textSecondary,
  '--dsw-alias-label-primary-inverted': C.bgBase,
  '--dsw-alias-brand-primary': C.brand,
  '--dsw-alias-brand-text': C.brand,
  '--dsw-alias-brand-subtle': C.brandSubtle,
  '--dsw-alias-button-primary-fill': C.brand,
  '--dsw-alias-button-primary-hover': C.brandHover,
  '--dsw-alias-button-primary-dimmed': C.brandActive,
  '--dsw-alias-button-elevated-fill': C.bgModule,
  '--dsw-alias-button-floating-fill': C.bgModule,
  '--dsw-alias-button-floating-hover': C.interactiveHover,
  '--dsw-alias-button-info-fill': C.textPrimary,
  '--dsw-alias-button-info-hover': C.textOnBrand,
  '--dsw-static-deepseek-200': C.textPrimary,
  '--dsw-static-deepseek-400': C.textSecondary,
  '--dsw-static-deepseek-450': C.textSecondary,
  '--dsw-static-deepseek-500': C.textSecondary,
  '--dsw-alias-border-l1': C.borderL1,
  '--dsw-alias-border-l2': C.borderL2,
  '--dsw-alias-border-l3': C.borderL1,
  '--dsw-alias-border-l4': C.borderL1,
  '--dsw-alias-interactive-bg-hover': C.interactiveHover,
  '--dsw-alias-interactive-bg-hover-solid': C.interactivePressed,
  '--dsw-alias-interactive-bg-active': C.bgModule,
  '--dsw-alias-state-business-primary': C.brand,
  '--dsw-alias-state-business-tertiary': C.brandSubtle,
  '--dsw-alias-state-error-primary': '#A3A3A3',
  '--dsw-alias-state-error-secondary': 'rgba(163, 163, 163, 0.2)',
  '--dsw-alias-state-warn-primary': '#F59E0B',
  '--dsw-alias-state-warn-secondary': 'rgba(245, 158, 11, 0.2)',
  '--dsw-alias-state-warn-tertiary': '#2A2A2A',
  '--dsw-alias-state-warn-label': '#D4D4D4',
  '--dsw-alias-markdown-code-block': C.bgCode,
  '--dsw-alias-markdown-code-block-banner': C.bgLayer1,
  '--dsw-alias-markdown-inline-code': C.bgModule,
  '--dsw-alias-toast-bg': C.bgLayer2,
}

/**
 * 宿主 ThemeRuntime.overrideTokens 需要 { light, dark } 成对赋值。
 * ZCode 是暗色体系，两套色板使用同一组值。
 */
export function hostTokenOverrides(map = HOST_TOKEN_MAP) {
  const overrides = {}
  for (const [name, value] of Object.entries(map)) {
    overrides[name] = { light: value, dark: value }
  }
  return overrides
}
