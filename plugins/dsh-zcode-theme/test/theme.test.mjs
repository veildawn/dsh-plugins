/**
 * 兼容薄壳测试。
 *
 * 薄壳的价值只有一条：**行为与旧版一致，且不与主题工作室打架**。
 * 所以这里验证的不是「样式长什么样」（那由 dsh-theme-studio 的测试覆盖），
 * 而是：
 *
 *   - 注入的属性、样式标签 id 与旧版完全相同（升级时旧样式被精确替换）；
 *   - 薄壳产出的变量与主题工作室的 ZCode 主题**逐值相同**（不存在两套配色）；
 *   - 幂等：重复注入不产生第二份样式。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  STYLE_ID,
  THEME_ATTR,
  THEME_SCOPE,
  apply,
  legacyCss,
  patchIndex,
  themeInjections,
  themeScopeScript,
  themeStyleTag,
  withThemeAttribute,
} from '../lib/index.js'
import { BUILTIN_THEMES, themeVarsCss } from '@weniatall/dsh-theme-studio'

const HTML = '<html lang="zh"><head><title>t</title></head><body></body></html>'

test('样式标签 id 与旧版一致（升级时精确替换）', () => {
  assert.equal(STYLE_ID, 'dsh-zcode-theme')
  assert.equal(THEME_ATTR, 'data-dsh-theme')
  assert.equal(THEME_SCOPE, 'zcode')
  assert.match(themeStyleTag(), new RegExp(`^<style id="${STYLE_ID}">`))
  assert.match(themeStyleTag(), /<\/style>$/)
})

test('patchIndex 写入旧属性与样式标签', () => {
  const out = patchIndex(HTML)
  assert.match(out, new RegExp(`<html ${THEME_ATTR}="${THEME_SCOPE}"`))
  assert.match(out, new RegExp(`<style id="${STYLE_ID}">`))
  assert.ok(out.indexOf(`<style id="${STYLE_ID}">`) < out.indexOf('<body>'))
})

test('patchIndex 幂等', () => {
  const once = patchIndex(HTML)
  const twice = patchIndex(once)
  assert.equal(twice.split(`id="${STYLE_ID}"`).length - 1, 1, '样式标签重复')
  const htmlTag = twice.match(/<html[^>]*>/)[0]
  assert.equal((htmlTag.match(/data-dsh-theme/g) ?? []).length, 1, `html 属性重复：${htmlTag}`)
})

test('withThemeAttribute 保留其它属性', () => {
  const out = withThemeAttribute('<html lang="zh" class="x">')
  assert.match(out, /lang="zh"/)
  assert.match(out, /class="x"/)
  assert.match(out, new RegExp(`${THEME_ATTR}="${THEME_SCOPE}"`))
})

test('themeInjections 生成两行结构化注入', () => {
  const rows = themeInjections()
  assert.equal(rows.length, 2)
  assert.equal(rows[0].kind, 'script')
  assert.equal(rows[1].kind, 'html')
})

test('Scope 脚本只写旧属性（不与工作室抢新属性）', () => {
  const script = themeScopeScript()
  assert.match(script, /setAttribute\('data-dsh-theme', 'zcode'\)/)
  assert.equal(script.includes('data-theme-studio'), false)
})

test('薄壳变量与主题工作室的 ZCode 主题逐值相同', () => {
  const studio = BUILTIN_THEMES.find((theme) => theme.id === 'zcode')
  const studioCss = themeVarsCss(studio).replaceAll(
    'html[data-theme-studio="zcode"]',
    'html[data-dsh-theme="zcode"]',
  )
  assert.equal(legacyCss(), studioCss, '薄壳与工作室的 ZCode 主题产生了不同配色')
})

test('薄壳 CSS 只使用旧属性作用域', () => {
  const css = legacyCss()
  assert.match(css, /html\[data-dsh-theme="zcode"\] \{/)
  assert.equal(css.includes('data-theme-studio'), false, '薄壳不应引用新属性')
})

test('薄壳 CSS 含完整的宿主变量映射（不是空壳）', () => {
  const css = legacyCss()
  assert.match(css, /--dsw-alias-bg-base:/)
  assert.match(css, /--dsw-alias-label-primary:/)
  assert.match(css, /--color-foreground:/)
})

test('apply 在 Web 上下文挂上 tapIndex', () => {
  const taps = []
  apply({
    effect: (fn) => fn(),
    webServer: { tapIndex: (fn) => taps.push(fn) },
  }, {})
  assert.equal(taps.length, 1)
  assert.match(taps[0](HTML), new RegExp(THEME_ATTR))
})

test('apply 在桌面上下文推入结构化注入行', () => {
  const handlers = new Map()
  apply({
    effect: (fn) => fn(),
    on: (event, handler) => handlers.set(event, handler),
  }, {})
  const table = []
  handlers.get('webserver/index-inject')(table)
  assert.equal(table.length, 2)
})

test('apply 打印一次迁移提示', () => {
  const messages = []
  apply({
    effect: (fn) => fn(),
    logger: { warn: (message) => messages.push(message) },
  }, {})
  assert.equal(messages.length, 1)
  assert.match(messages[0], /dsh-theme-studio/)
})

test('缺少 logger 时不抛错', () => {
  assert.doesNotThrow(() => apply({ effect: (fn) => fn() }, {}))
})

test('薄壳与子路径导出兼容旧版符号', async () => {
  const index = await import('../lib/index.js')
  assert.ok(index.ZAI_PALETTE, '缺 ZAI_PALETTE 导出')
  assert.ok(index.HOST_TOKEN_MAP, '缺 HOST_TOKEN_MAP 导出')
  assert.ok(Array.isArray(index.STYLE_FILES), '缺 STYLE_FILES 导出')
  assert.equal(typeof index.loadThemeCss, 'function', '缺 loadThemeCss 导出')

  const tokens = await import('../lib/tokens.js')
  assert.ok(tokens.HOST_TOKEN_MAP, 'tokens 子路径导出失败')

  const css = await import('../lib/css.js')
  assert.ok(Array.isArray(css.STYLE_FILES), 'css 子路径导出失败')
})
