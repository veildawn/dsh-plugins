export const name = 'mobile-adapter'
export const inject = ['webServer']

export const VIEWPORT_CONTENT = 'width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content'

const VIEWPORT_TAG = `<meta name="viewport" content="${VIEWPORT_CONTENT}" />`
const SAFE_AREA_TAG = '<style id="dsh-mobile-safe-area">:root{--dsh-sat:env(safe-area-inset-top,0px);--dsh-sab:env(safe-area-inset-bottom,0px);--dsh-sal:env(safe-area-inset-left,0px);--dsh-sar:env(safe-area-inset-right,0px)}</style>'
const VIEWPORT_RE = /<meta\b(?=[^>]*\bname\s*=\s*(?:"viewport"|'viewport'|viewport))[^>]*>/i
const SAFE_AREA_RE = /<style\b[^>]*\bid\s*=\s*(?:"dsh-mobile-safe-area"|'dsh-mobile-safe-area'|dsh-mobile-safe-area)[^>]*>[\s\S]*?<\/style>/i

export function patchIndex(html) {
  const viewport = VIEWPORT_RE.test(html)
    ? html.replace(VIEWPORT_RE, VIEWPORT_TAG)
    : html.replace(/<head\b[^>]*>/i, `$&${VIEWPORT_TAG}`)
  return SAFE_AREA_RE.test(viewport)
    ? viewport.replace(SAFE_AREA_RE, SAFE_AREA_TAG)
    : viewport.replace(/<\/head\s*>/i, `${SAFE_AREA_TAG}</head>`)
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.tapIndex(patchIndex), 'mobile-adapter: viewport')
}
