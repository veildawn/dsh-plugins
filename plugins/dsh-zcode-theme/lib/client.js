/**
 * dsh-zcode-theme 客户端半侧 —— 兼容薄壳。
 *
 * ## 为什么这里几乎什么都不做
 *
 * 旧版客户端内联了 130 项 `HOST_TOKEN_MAP` 并通过 `ctx.theme.overrideTokens()`
 * 写内联 style。那套做法有两个问题：
 *
 *   1. **重复维护**：同一份映射在 `tokens.js` 与 `client.js` 各存一份，
 *      靠测试逐项比对防止漂移——每次改色都要改两处。
 *   2. **与主题工作室冲突**：两个插件各调一次 `overrideTokens`，后注册的那层
 *      覆盖前一层。用户切到玻璃主题后，本壳的 ZCode 内联 style 仍然压在
 *      `body` 上，玻璃主题的颜色被静默盖掉——这是最难排查的一类问题。
 *
 * 所以薄壳客户端**不再调用 overrideTokens**：它只负责把旧属性
 * `data-dsh-theme="zcode"` 打上，供仍在读旧属性的消费者
 * （dsh-mobile-adapter 的移动端规则等）继续工作。配色完全由服务端注入的
 * CSS 变量提供——而那份 CSS 与主题工作室同源（见 `lib/index.js` 的 `legacyCss`）。
 *
 * 若用户同时装了主题工作室，工作室会写 `data-theme-studio` 与
 * `data-dsh-theme`（值取自当前主题）；本壳只会在工作室不存在时补上旧属性，
 * 存在时让位（见下面的 `shouldDefer`）。
 *
 * @module dsh-zcode-theme/client
 */

window.__ModuleLoader__.load({
  id: '@weniatall/dsh-zcode-theme',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports

    const THEME_ATTR = 'data-dsh-theme'
    const THEME_SCOPE = 'zcode'
    const STUDIO_ATTR = 'data-theme-studio'

    /**
     * 主题工作室是否已经在管理主题属性。
     *
     * 判据是「html 上有 `data-theme-studio`」——工作室无论在首屏注入还是客户端
     * 启动时都会写它。存在即说明工作室在场，本壳不该再抢旧属性。
     *
     * @param {Document} doc
     * @returns {boolean}
     */
    function shouldDefer(doc) {
      return Boolean(doc?.documentElement?.hasAttribute?.(STUDIO_ATTR))
    }

    /**
     * 打上旧属性（仅当工作室不在场）。
     *
     * @param {Document} doc
     * @returns {() => void} 还原函数
     */
    function applyScope(doc) {
      if (!doc?.documentElement) return () => {}
      if (shouldDefer(doc)) return () => {}
      const root = doc.documentElement
      const previous = root.getAttribute(THEME_ATTR)
      root.setAttribute(THEME_ATTR, THEME_SCOPE)
      return () => {
        if (previous == null) root.removeAttribute(THEME_ATTR)
        else root.setAttribute(THEME_ATTR, previous)
      }
    }

    function mount(ctx) {
      const doc = typeof document === 'undefined' ? undefined : document
      const restore = doc ? applyScope(doc) : () => {}
      // 旧版这里还有 ctx.theme.overrideTokens(TOKEN_SOURCE, ...)；已移除，
      // 原因见文件头。配色由服务端注入的 CSS 变量负责。
      return () => restore()
    }

    function apply(ctx) {
      ctx.effect(() => mount(ctx), 'zcode-theme: compat scope')
    }

    exports.apply = apply
    // 与旧版一致：客户端不注入额外服务（旧版声明了 theme，现已不需要）
    exports.inject = []
    exports.internals = {
      THEME_ATTR,
      THEME_SCOPE,
      STUDIO_ATTR,
      shouldDefer,
      applyScope,
      mount,
    }
    return module.exports
  },
})
