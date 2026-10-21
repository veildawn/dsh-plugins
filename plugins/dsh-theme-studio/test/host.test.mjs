/**
 * 宿主注入与首屏零闪烁测试。
 *
 * 覆盖 Web（服务端直出 `tapIndex`）与桌面端（Electron 结构化注入行）两条路径：
 * 两条都必须把主题属性与完整 CSS 写进首屏，否则用户会先看到宿主默认配色再闪成主题色。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BACKGROUND_ROUTE_PREFIX,
  FONT_SIZE_RANGES,
  SETTINGS_RPC_CHANNEL,
  STYLE_ID,
  THEME_ATTR,
  apply,
  backgroundUrl,
  buildSettingsView,
  decodeBackgroundUpload,
  patchIndex,
  themeInjections,
  themeScopeScript,
  themeStyleTag,
  withThemeAttribute,
} from '../lib/index.js'
import { BUILTIN_THEMES, THEME_IDS } from '../lib/themes/index.js'

const HTML = '<html lang="zh"><head><title>t</title></head><body><div id="root"></div></body></html>'

test('patchIndex 写入主题属性与样式标签', () => {
  const out = patchIndex(HTML, { themeId: 'glass' })
  assert.match(out, new RegExp(`<html ${THEME_ATTR}="glass"`))
  assert.match(out, new RegExp(`<style id="${STYLE_ID}">`))
  // 样式必须在 head 里、且在 body 之前
  assert.ok(out.indexOf(`<style id="${STYLE_ID}">`) < out.indexOf('<body>'))
})

test('patchIndex 幂等替换已有样式与属性', () => {
  const first = patchIndex(HTML, { themeId: 'glass' })
  const second = patchIndex(first, { themeId: 'zcode' })
  assert.equal(second.split(`id="${STYLE_ID}"`).length - 1, 1, '样式标签重复')
  assert.match(second, new RegExp(`<html ${THEME_ATTR}="zcode"`))
  // 旧主题只该留在兼容选择器里，`<html>` 标签上不能再出现 glass
  const htmlTag = second.match(/<html[^>]*>/)[0]
  assert.equal(htmlTag.includes('glass'), false, `html 标签残留旧主题：${htmlTag}`)
})

test('patchIndex 覆盖旧插件属性 data-dsh-theme', () => {
  const legacy = `<html data-dsh-theme="zcode"><head></head></html>`
  const out = patchIndex(legacy, { themeId: 'glass' })
  const htmlTag = out.match(/<html[^>]*>/)[0]
  assert.match(htmlTag, /data-dsh-theme="glass"/)
  // html 标签上只能有一个旧属性（兼容选择器里出现的不算）
  assert.equal((htmlTag.match(/data-dsh-theme/g) ?? []).length, 1, `html 标签属性重复：${htmlTag}`)
})

test('每款主题都能直出，且产物包含该主题自己的变量块', () => {
  for (const id of THEME_IDS) {
    const out = patchIndex(HTML, { themeId: id })
    assert.match(out, new RegExp(`<html ${THEME_ATTR}="${id}"`), `${id} 缺主题属性`)
    assert.match(out, new RegExp(`html\\[${THEME_ATTR}="${id}"\\] \\{`), `${id} 缺变量块`)
  }
})

test('首屏产物包含全部四套主题（切换零成本）', () => {
  const out = patchIndex(HTML, { themeId: 'zcode' })
  for (const id of THEME_IDS) {
    assert.match(out, new RegExp(`html\\[${THEME_ATTR}="${id}"\\]`), `缺 ${id} 的变量块`)
  }
})

test('首屏产物带玻璃材质层', () => {
  const out = patchIndex(HTML, { themeId: 'zcode' })
  assert.match(out, /backdrop-filter: blur\(var\(--ts-blur\)\)/)
})

test('首屏产物写入用户自定义层，且排在主题变量之后', () => {
  const out = patchIndex(HTML, {
    themeId: 'glass',
    settings: {
      fonts: { text: 'Inter' },
      fieldColors: { foreground: '#010203' },
    },
  })
  const themeAt = out.indexOf(`html[${THEME_ATTR}="glass"] {`)
  const customAt = out.indexOf('--dsw-font-family: Inter')
  assert.ok(themeAt > 0 && customAt > 0)
  assert.ok(customAt > themeAt, '自定义层必须排在主题变量之后才能覆盖它')
})

test('themeScopeScript 同时写新旧两套属性', () => {
  const script = themeScopeScript('zcode-mono')
  assert.match(script, new RegExp(`${THEME_ATTR}', "zcode-mono"`))
  assert.match(script, /data-dsh-theme', "zcode-mono"/)
})

test('玻璃主题的旧属性回落到自身 id', () => {
  const script = themeScopeScript('glass')
  assert.match(script, /data-dsh-theme', "glass"/)
})

test('themeInjections 生成 script + html 两行', () => {
  const rows = themeInjections('glass')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].kind, 'script')
  assert.equal(rows[0].placement, 'head')
  assert.equal(rows[1].kind, 'html')
  assert.match(rows[1].html, new RegExp(`id="${STYLE_ID}"`))
})

test('withThemeAttribute 不破坏其它属性', () => {
  const out = withThemeAttribute('<html lang="zh" class="x">', 'zcode')
  assert.match(out, /lang="zh"/)
  assert.match(out, /class="x"/)
  assert.match(out, new RegExp(`${THEME_ATTR}="zcode"`))
})

test('themeStyleTag 无 settings 时也能生成', () => {
  const tag = themeStyleTag()
  assert.match(tag, new RegExp(`^<style id="${STYLE_ID}">`))
  assert.match(tag, /<\/style>$/)
})

test('backgroundUrl 编码文件名', () => {
  assert.equal(backgroundUrl('bg-1.png'), `${BACKGROUND_ROUTE_PREFIX}bg-1.png`)
  assert.equal(backgroundUrl('a b.png'), `${BACKGROUND_ROUTE_PREFIX}a%20b.png`)
  assert.equal(backgroundUrl(null), null)
})

test('decodeBackgroundUpload 解析 data URL', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  const result = decodeBackgroundUpload({ dataUrl: `data:image/png;base64,${png.toString('base64')}` })
  assert.equal(result.mime, 'image/png')
  assert.deepEqual([...result.data], [...png])
})

test('decodeBackgroundUpload 拒绝非法输入', () => {
  assert.ok('error' in decodeBackgroundUpload({}))
  assert.ok('error' in decodeBackgroundUpload({ dataUrl: 'not-a-data-url' }))
  assert.ok('error' in decodeBackgroundUpload({ dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }))
  assert.ok('error' in decodeBackgroundUpload({ dataUrl: 'data:image/png;base64,' }))
})

test('buildSettingsView 提供稳定的 effective 结构', () => {
  const view = buildSettingsView({}, '/tmp/theme/settings.json')
  // 空设置时 settings 是 {}（不落盘噪音），但 effective 必须是完整形状，
  // 否则面板里每个输入框都要写 `?? ''` 兜底，还容易漏。
  assert.deepEqual(view.settings, {})
  assert.equal(view.effective.theme, 'zcode')
  assert.equal(view.effective.background.mode, 'none')
  assert.equal(view.effective.background.fit, 'cover')
  assert.equal(view.effective.background.opacity, 100)
  assert.equal(view.effective.fonts.text, '')
  assert.deepEqual(view.effective.fieldColors, {})
  assert.deepEqual(view.effective.fontSizes, {})
})

test('buildSettingsView 的 effective 不覆盖用户已设的值', () => {
  const view = buildSettingsView({
    theme: 'glass',
    background: { mode: 'color', value: '#123456' },
    fonts: { text: 'Inter' },
    fontSizes: { text: 16 },
  }, '/tmp/x.json')
  assert.equal(view.effective.theme, 'glass')
  assert.equal(view.effective.background.mode, 'color')
  assert.equal(view.effective.background.value, '#123456')
  // 未设的键仍取默认
  assert.equal(view.effective.background.fit, 'cover')
  assert.equal(view.effective.fonts.text, 'Inter')
  assert.equal(view.effective.fonts.code, '')
})

test('buildSettingsView 暴露面板所需的全部字段', () => {
  const view = buildSettingsView({}, '/tmp/theme/settings.json')
  assert.equal(view.themes.length, BUILTIN_THEMES.length)
  assert.ok(view.fieldColorRoles.length > 5)
  assert.deepEqual(Object.keys(view.fontSizeRanges).sort(), Object.keys(FONT_SIZE_RANGES).sort())
  assert.equal(view.settingsFile, '/tmp/theme/settings.json')
  assert.ok(view.limits.maxBackgroundBytes > 0)
  // 面板不该拿到完整色板（体积与泄密）
  assert.equal(view.themes.some((theme) => 'palette' in theme), false)
})

test('apply 在 Web 上下文挂上 tapIndex', () => {
  const taps = []
  const ctx = {
    effect: (fn) => fn(),
    webServer: { tapIndex: (fn) => taps.push(fn) },
  }
  apply(ctx, {})
  assert.equal(taps.length, 1)
  assert.match(taps[0](HTML), new RegExp(THEME_ATTR))
})

test('apply 在桌面上下文推入结构化注入行', () => {
  const handlers = new Map()
  const ctx = {
    effect: (fn) => fn(),
    on: (event, handler) => handlers.set(event, handler),
  }
  apply(ctx, {})
  const table = []
  handlers.get('webserver/index-inject')(table)
  assert.equal(table.length, 2)
  assert.equal(table[0].kind, 'script')
})

test('apply 注册背景图路由', () => {
  const routes = []
  const ctx = {
    effect: (fn) => fn(),
    webServer: { get: (path, handler) => routes.push({ path, handler }) },
  }
  apply(ctx, {})
  assert.equal(routes.length, 1)
  assert.match(routes[0].path, /background/)
})

test('apply 注册设置 RPC 并响应 describe', async () => {
  let registered
  const ctx = {
    effect: (fn) => fn(),
    connection: {
      rpc: {
        handle: (channel, handler) => {
          registered = { channel, handler }
        },
      },
    },
  }
  apply(ctx, {})
  assert.equal(registered.channel, SETTINGS_RPC_CHANNEL)
  const result = await registered.handler('describe', {})
  assert.equal(result.ok, true)
  assert.equal(result.value.themes.length, BUILTIN_THEMES.length)
})

test('apply 的 save / reset 走完整链路', async () => {
  let registered
  const ctx = {
    effect: (fn) => fn(),
    connection: {
      rpc: {
        handle: (channel, handler) => {
          registered = { channel, handler }
        },
      },
    },
  }
  // 用临时设置文件，避免读写开发机上的真实配置
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'theme-studio-apply-'))
  try {
    apply(ctx, { settingsFile: join(dir, 'settings.json') })

    const saved = await registered.handler('save', { settings: { theme: 'glass', fonts: { text: 'Inter' } } })
    assert.equal(saved.ok, true)
    assert.equal(saved.value.settings.theme, 'glass')
    assert.equal(saved.value.settings.fonts.text, 'Inter')

    const reset = await registered.handler('reset', {})
    assert.equal(reset.ok, true)
    assert.deepEqual(reset.value.settings, {})

    const unknown = await registered.handler('nope', {})
    assert.equal(unknown.ok, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('未知方法返回错误而不是抛异常', async () => {
  let registered
  apply({
    effect: (fn) => fn(),
    connection: { rpc: { handle: (_c, handler) => { registered = { handler } } } },
  }, {})
  const result = await registered.handler('bogus', {})
  assert.equal(result.ok, false)
  assert.match(result.error.message, /未知方法/)
})

test('模块 inject 与 cordis.patch.yml 的 inject 必须包含 connection 且保持一致', async () => {
  const { readFileSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')

  const hostSource = readFileSync(join(root, 'lib', 'index.js'), 'utf8')
  const patchSource = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')

  const moduleInject = hostSource.match(/export const inject = \[([^\]]*)\]/)
  assert.ok(moduleInject, 'lib/index.js 必须导出 inject')
  const moduleList = [...moduleInject[1].matchAll(/'([^']+)'/g)].map((item) => item[1])

  const patchMatch = patchSource.match(/inject:\n((?:\s*-\s*\S+\n)+)/)
  assert.ok(patchMatch, '未能从 cordis.patch.yml 解析出 inject 列表')
  const patchList = [...patchMatch[1].matchAll(/-\s*(\S+)/g)].map((item) => item[1])

  assert.ok(moduleList.includes('connection'), 'lib/index.js 的 inject 必须包含 connection，否则前端所有 RPC 调用报 HTTP 405')
  assert.ok(patchList.includes('connection'), 'cordis.patch.yml 必须注入 connection，否则宿主不会注入 connection 服务')
  assert.deepEqual([...moduleList].sort(), [...patchList].sort(), '模块 inject 与 cordis.patch.yml 声明的 inject 必须一致')
})
