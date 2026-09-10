import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply as applyHost, patchIndex, STYLE_ID, THEME_ATTR, THEME_SCOPE } from '../lib/index.js'
import { HOST_TOKEN_MAP, REQUIRED_HOST_TOKENS } from '../lib/tokens.js'
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
  assert.match(patched, /--dsw-alias-bg-base:\s*light-dark\(#F7F7F5, #1A1A1A\)/)
  assert.match(patched, /--dsw-alias-brand-primary:\s*#E85D3A/)
})

test('Host 幂等替换已有主题标签与属性', () => {
  const html = `<html ${THEME_ATTR}="other"><head><style id="${STYLE_ID}">__stale_theme__</style></head></html>`
  const patched = patchIndex(html)
  assert.match(patched, new RegExp(`${THEME_ATTR}="${THEME_SCOPE}"`))
  assert.equal(patched.includes('__stale_theme__'), false)
  assert.match(patched, /--dsw-alias-bg-base:\s*light-dark\(#F7F7F5, #1A1A1A\)/)
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

test('Client 注入 theme 服务，Token 映射与宿主一致', () => {
  assert.deepEqual(client.inject, ['theme'])
  assert.deepEqual(client.internals.HOST_TOKEN_MAP, HOST_TOKEN_MAP)
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
  assert.equal(layers.get('dsh-zcode-theme')['--dsw-alias-brand-primary'].dark, '#E85D3A')
  dispose()
  assert.equal(attrs.has(THEME_ATTR), false)
  assert.equal(layers.size, 0)
  globalThis.document = previousDocument
})

test('CSS 覆盖规范列出的核心组件', () => {
  const css = loadThemeCss()
  const markers = [
    ['Sidebar', '[data-slot="sidebar"]'],
    ['New Session', '.hHd-Xa_newSession'],
    ['Session', '.YDXeBa_sessionRow'],
    ['Turn Status', '.EvIC1a_turnStatus'],
    ['Navigation', '.wSkVaW_header'],
    ['Button', 'button[data-variant="primary"]'],
    ['Input', '[data-composer-card]'],
    ['Composer', '.uV2eYG_primary'],
    ['Chip', '.rS3zOq_chip'],
    ['Chat Bubble', '.Sixlwa_bubble'],
    ['Code Block', '.md-code-block'],
    ['Terminal', '.CY-8Ka_terminal'],
    ['Modal', '[role="dialog"]'],
    ['Bottom Sheet', '[class*="sheet"]'],
    ['Toast', '[class*="toast"]'],
    ['Reduced Motion', 'prefers-reduced-motion'],
    ['Session Accent', 'inset 3px 0 0 var(--dsw-specific-sidebar-nav-item-active-accent)'],
  ]
  for (const [label, needle] of markers) {
    assert.equal(css.includes(needle), true, `缺少 ${label} 覆盖：${needle}`)
  }
  assert.equal(css.includes('path[d*='), false, '权限态不得依赖 SVG path')
  assert.equal(css.includes('[data-dsh-theme="zcode"] [data-error]'), false, '不得用全局 [data-error]')
})

test('主题 CSS 全部限定在 ZCode Scope 内，且几乎不用 !important', () => {
  const css = loadThemeCss()
  const rules = css.split('{').length - 1
  const scoped = (css.match(/\[data-dsh-theme="zcode"\]/g) ?? []).length
  assert.ok(scoped >= 8, 'Scope 选择器过少')
  assert.equal((css.match(/!important/g) ?? []).length, 4)
  assert.ok(rules > scoped / 4)
})

test('规范目录结构齐全', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.name, 'dsh-zcode-theme')
  assert.ok(manifest.files.includes('lib/styles'))
  assert.equal(STYLE_FILES.includes('tokens.css'), false)
  assert.ok(STYLE_FILES.includes('motion.css'))
  assert.ok(STYLE_FILES.includes('reset.css'))
})
