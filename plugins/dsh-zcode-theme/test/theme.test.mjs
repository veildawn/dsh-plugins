import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply as applyHost, patchIndex, STYLE_ID, THEME_ATTR, THEME_SCOPE, themeInjections } from '../lib/index.js'
import { HOST_TOKEN_MAP, REQUIRED_HOST_TOKENS, ZAI_PALETTE } from '../lib/tokens.js'
import { loadThemeCss, STYLE_FILES } from '../lib/css.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let definition
const previousWindow = globalThis.window
globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
await import('../lib/client.js')
globalThis.window = previousWindow
const client = definition.factory()

test('Host 给 html 打上主题 Scope 并注入 CSS', () => {
  const html = '<html lang="zh"><head></head><body></body></html>'
  const patched = patchIndex(html)
  assert.match(patched, new RegExp(`<html ${THEME_ATTR}="${THEME_SCOPE}"`))
  assert.match(patched, new RegExp(`<style id="${STYLE_ID}">`))
  assert.match(patched, /--dsw-alias-bg-base:\s*light-dark\(#f8f8f8, #161616\)/)
  assert.match(patched, /--color-brand:\s*light-dark\(#000000, #ffffff\)/)
})

test('Host 幂等替换已有主题标签与属性', () => {
  const html = `<html ${THEME_ATTR}="other"><head><style id="${STYLE_ID}">__stale_theme__</style></head></html>`
  const patched = patchIndex(html)
  assert.match(patched, new RegExp(`${THEME_ATTR}="${THEME_SCOPE}"`))
  assert.equal(patched.includes('__stale_theme__'), false)
  assert.match(patched, /--dsw-alias-bg-base:\s*light-dark\(#f8f8f8, #161616\)/)
  assert.equal(patched.split(`id="${STYLE_ID}"`).length - 1, 1)
})

test('Host apply 把 patchIndex 挂到 webServer.tapIndex', () => {
  const taps = []
  applyHost({
    effect: (fn) => fn(),
    webServer: { tapIndex: (fn) => taps.push(fn) },
  })
  assert.equal(taps.length, 1)
  assert.equal(typeof taps[0], 'function')
  assert.match(taps[0]('<html><head></head></html>'), /data-dsh-theme="zcode"/)
})

test('Host themeInjections 生成桌面端与 Web 共用的结构化注入行', () => {
  const rows = themeInjections()
  assert.equal(rows.length, 2)

  const [scriptRow, htmlRow] = rows
  assert.equal(scriptRow.kind, 'script')
  assert.equal(scriptRow.placement, 'head')
  assert.match(scriptRow.text, new RegExp(`document\\.documentElement\\.setAttribute\\('${THEME_ATTR}', '${THEME_SCOPE}'\\)`))

  assert.equal(htmlRow.kind, 'html')
  assert.equal(htmlRow.placement, 'head')
  assert.match(htmlRow.html, new RegExp(`<style id="${STYLE_ID}">`))
  assert.match(htmlRow.html, /--color-brand:\s*light-dark\(#000000, #ffffff\)/)
})

test('Host apply 监听 webserver/index-inject 以支持桌面端 Electron IPC 回放', () => {
  const listeners = new Map()
  const taps = []
  const ctx = {
    on(event, fn) {
      listeners.set(event, fn)
    },
    effect(fn) {
      fn()
    },
    webServer: {
      tapIndex(fn) {
        taps.push(fn)
      },
    },
  }

  applyHost(ctx)
  assert.equal(taps.length, 1)
  assert.ok(listeners.has('webserver/index-inject'))

  const table = []
  listeners.get('webserver/index-inject')(table)
  assert.equal(table.length, 2)
  assert.equal(table[0].kind, 'script')
  assert.equal(table[1].kind, 'html')
})

test('Client 注入 theme 服务，Token 映射与宿主逐项一致', () => {
  assert.deepEqual(client.inject, ['theme'])
  assert.deepEqual(client.internals.HOST_TOKEN_MAP, HOST_TOKEN_MAP)
  for (const name of Object.keys(HOST_TOKEN_MAP)) {
    assert.deepEqual(client.internals.HOST_TOKEN_MAP[name], HOST_TOKEN_MAP[name], `${name} 客户端与宿主不一致`)
  }
  for (const name of REQUIRED_HOST_TOKENS) {
    assert.deepEqual(client.internals.HOST_TOKEN_MAP[name], HOST_TOKEN_MAP[name])
  }
})

test('Client mount 写入 Scope 并覆盖宿主 Token，卸载时还原', () => {
  const attrs = new Map()
  const document = {
    documentElement: {
      getAttribute: (name) => attrs.get(name) ?? null,
      setAttribute: (name, value) => attrs.set(name, value),
      removeAttribute: (name) => attrs.delete(name),
    },
  }
  const previousDocument = globalThis.document
  globalThis.document = document
  const layers = new Map()
  const ctx = {
    theme: {
      overrideTokens(source, tokens) {
        layers.set(source, tokens)
        return () => layers.delete(source)
      },
    },
  }
  const dispose = client.internals.mount(ctx)
  assert.equal(attrs.get(THEME_ATTR), THEME_SCOPE)
  assert.equal(layers.get('dsh-zcode-theme')['--dsw-alias-brand-primary'].dark, ZAI_PALETTE.brand.dark)
  assert.equal(layers.get('dsh-zcode-theme')['--dsw-alias-brand-primary'].light, ZAI_PALETTE.brand.light)
  dispose()
  assert.equal(attrs.has(THEME_ATTR), false)
  assert.equal(layers.size, 0)
  globalThis.document = previousDocument
})

test('CSS 覆盖规范列出的核心组件', () => {
  const css = loadThemeCss()
  const markers = [
    ['Sidebar', '.hIlkoa_sessionRow'],
    ['Sidebar Shell', '._2H3hWW_root'],
    ['New Session', '._2H3hWW_newSession'],
    ['Session', '.hIlkoa_sessionRow'],
    ['Workspace Row', '.hIlkoa_projectRow'],
    ['Frame', '.BynINW_frame'],
    ['Frame Center', '.BynINW_centerCol'],
    ['Turn Status (think)', '[data-variant="think"]'],
    ['Navigation', '.Dc7zOa_header'],
    ['Button', 'button[data-variant="primary"]'],
    ['Button Class', 'button[class*="_primary_"]'],
    ['Input', '[data-composer-card]'],
    ['Permission Trigger', '[class*="3HsggG_selector"]'],
    ['Composer', '.RlGAzG_primary'],
    ['Chip', '.rtYPxa_chip'],
    ['Chat Bubble', '.cJsG2q_bubble'],
    ['Code Block', '.md-code-block'],
    ['Terminal', '.pFy1Ka_terminalBody'],
    ['Modal', '[role="dialog"]'],
    ['Modal Backdrop', '.dm-modal-scrim'],
    ['Modal Backdrop', '.dam-backdrop'],
    ['File Viewer Scrim', '.fv-scrim'],
    ['Bottom Sheet', '[class*="sheet"]'],
    ['Toast', '[class*="toast"]'],
    ['Reduced Motion', 'prefers-reduced-motion'],
    ['Mention File', '[data-composer-chip="file"]'],
    ['Mention Skill', '[data-composer-chip="skill"]'],
    ['Mention Command', '[data-composer-chip="command"]'],
    ['Diff Added Token', 'file-diff-added-bg'],
    ['Diff Removed Token', 'file-diff-deleted-bg'],
    ['ANSI Black', '--color-terminal-black'],
    ['ANSI Bright White', '--color-terminal-bright-white'],
  ]
  for (const [label, needle] of markers) {
    assert.equal(css.includes(needle), true, `缺少 ${label} 覆盖：${needle}`)
  }
  assert.equal(css.includes('path[d*='), false, '权限态不得依赖 SVG path')
  assert.equal(css.includes('[data-dsh-theme="zcode"] [data-error]'), false, '不得用全局 [data-error]')
})

test('主对话流不套轨迹色，图标保持低侵入灰阶', () => {
  const css = loadThemeCss()
  // 官方 --color-trajectory-* 只服务于 ModelTrajectoryPane 这类调试视图；
  // 聊天流的工具摘要行 / 思考块一律是 foreground-subtlest。
  // 一旦有人在 [data-chat-flow-kind] 上挂轨迹色，整列工具卡会变成一排彩点。
  assert.equal(css.includes('--trajectory-accent'), false, '聊天流不得引入轨迹强调色变量')
  assert.equal(
    /\[data-chat-flow-kind[^\]]*\][^{]*\{[^}]*--color-trajectory-/.test(css),
    false,
    '不得在 [data-chat-flow-kind] 上赋轨迹色',
  )
})

test('主题 CSS 全部限定在 ZCode Scope 内，且几乎不用 !important', () => {
  const css = loadThemeCss()
  const rules = css.split('{').length - 1
  const scoped = (css.match(/\[data-dsh-theme="zcode"\]/g) ?? []).length
  assert.ok(scoped >= 8, 'Scope 选择器过少')
  assert.equal((css.match(/!important/g) ?? []).length, 4)
  assert.ok(rules > scoped / 4)
})

test('主题 CSS 绝不覆盖移动端顶栏 .dsh-mobile-bar 的定位与层级', () => {
  const css = loadThemeCss()
  const mobileBarRuleMatch = css.match(/\.dsh-mobile-bar\s*\{([^}]+)\}/)
  assert.ok(mobileBarRuleMatch, '必须包含 .dsh-mobile-bar 样式规则')
  const body = mobileBarRuleMatch[1]
  assert.equal(/position\s*:/i.test(body), false, '.dsh-mobile-bar 绝不能覆盖 position 定位')
  assert.equal(/z-index\s*:/i.test(body), false, '.dsh-mobile-bar 绝不能覆盖 z-index 层级')
})

test('规范目录结构齐全', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.name, '@weniatall/dsh-zcode-theme')
  assert.ok(manifest.files.includes('lib/styles'))
  assert.equal(STYLE_FILES.includes('tokens.css'), false)
  assert.ok(STYLE_FILES.includes('motion.css'))
  assert.ok(STYLE_FILES.includes('reset.css'))
})

test('主题关键选择器在宿主或社区插件语料中存活', async () => {
  const css = loadThemeCss()
  // 必须确保关键钩子在真实运行时中存活（宿主 0.2.1-rc.2 的真实类名）。
  const criticalSelectors = [
    '[class*="3HsggG_selector"]',
    'button[class*="_primary_"]',
    '[data-chat-flow-kind="assistant-step"]',
    '[data-variant="think"]',
    'div[class*="_indicator_"]',
    '[class*="_mask_"]',
    '.hIlkoa_sessionRow',
    '.RlGAzG_card',
    '.BynINW_centerCol',
  ]
  for (const sel of criticalSelectors) {
    assert.equal(css.includes(sel), true, `主题 CSS 必须包含修复后的活跃选择器: ${sel}`)
  }
})

test('主题 CSS 只引用官方或宿主真实存在的 Token', () => {
  const css = loadThemeCss()
  const referenced = [...new Set(css.match(/var\((--[a-z0-9-]+)/g) ?? [])].map((v) => v.slice(4))
  const official = new Set(Object.keys(ZAI_PALETTE).map((k) => `--color-${k}`))
  const host = new Set(Object.keys(HOST_TOKEN_MAP))
  const hostInfra = new Set([
    '--dsw-font-family',
    '--ds-font-family-code',
    '--dsw-radius-sm',
    '--dsw-focus-ring-color',
    '--dsw-focus-ring-width',
    '--dsw-elevation-prominent',
    '--dsh-content-font-size',
  ])
  const local = new Set([
    '--ui-font-size',
    '--zai-text-ui-base',
    '--zai-text-ui-sm',
    '--shiki-foreground',
    '--shiki-token-comment',
    '--trajectory-accent',
  ])
  const allowed = new Set([...official, ...host, ...hostInfra, ...local])
  for (const name of referenced) {
    assert.equal(allowed.has(name), true, `主题 CSS 引用了未定义的 Token：${name}`)
  }
})
