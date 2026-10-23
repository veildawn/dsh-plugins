/**
 * 背景图端到端回归测试。
 *
 * 这两条测试对应一次真实故障的**两个独立根因**——「背景图设置过后没有效果」。
 * 两者都必须单独守住，因为任一单独失效时症状完全相同（上传成功、界面没变），
 * 而修复其中一处后另一处仍然会让功能不可用：
 *
 *   1. **路由根本没注册**：旧代码调 `ctx.webServer.get(path, handler)`，
 *      但宿主的 `WebServer` 没有 `get` 方法（只有 `register` / `tapIndex` /
 *      `registerFallback` / `registerUpgrade`）。`typeof ... === 'function'`
 *      恒为 false，路由被静默跳过，图片请求 404。
 *
 *   2. **背景被不透明层遮住**：即使图片能取到，`#root` / `.frame` /
 *      `.centerCol` 三层实色填充也会把 body 上的背景整层盖住。
 *
 * 第 1 条测试用**真实宿主 API 形状**构造 ctx（webServer 没有 get），
 * 而不是给一个假的 get——假 get 正是让这个 bug 通过测试的原因。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BACKGROUND_ATTR,
  BACKGROUND_ROUTE_PATH,
  THEME_ATTR,
  apply,
  backgroundUrl,
  customCss,
  loadSettings,
  patchIndex,
  setBackgroundFlagScript,
  themeScopeScript,
} from '../lib/index.js'
import { BACKGROUND_STYLE_FILE, composeThemeCss, readStyleFile } from '../lib/css.js'
import { activeBackgroundMode } from '../lib/settings.js'

const HTML = '<html lang="zh"><head><title>t</title></head><body><div id="root"></div></body></html>'

/** 造一个与真实宿主同形的 ctx：webServer 没有 get，路由只能走 connection.fetch。 */
function realHostContext() {
  const routes = []
  const rpcHandlers = new Map()
  const ctx = {
    effect: (fn) => fn(),
    on: () => {},
    // 宿主 WebServer 的真实方法集（见 dsh-host-webserver/lib/index.js）。
    webServer: {
      tapIndex: () => {},
      register: () => {},
      registerFallback: () => {},
      registerUpgrade: () => {},
    },
    connection: {
      fetch: { register: (route) => routes.push(route) },
      rpc: { handle: (channel, handler) => rpcHandlers.set(channel, handler) },
    },
  }
  return { ctx, routes, rpcHandlers }
}

test('路由必须注册在 connection.fetch 上，因为宿主 webServer 没有 get 方法', () => {
  const { ctx, routes } = realHostContext()
  // 前置断言：如果将来宿主真的加了 get，这条测试会先提醒我们重新评估。
  assert.equal(typeof ctx.webServer.get, 'undefined', '宿主 WebServer 不应有 get 方法')
  apply(ctx, {})
  assert.equal(routes.length, 1, '背景图路由没有注册——图片会 404，背景永远不显示')
  assert.equal(routes[0].path, BACKGROUND_ROUTE_PATH)
})

test('背景图 URL 是 connection.fetch 能接受的精确路径 + 查询参数', () => {
  const url = backgroundUrl('bg-1700000000000.jpg')
  assert.ok(url.startsWith(BACKGROUND_ROUTE_PATH))
  // 宿主的 endpointFromPath 只认固定段，路径里不能出现文件名。
  assert.equal(new URL(url, 'http://x').pathname, BACKGROUND_ROUTE_PATH)
  assert.equal(new URL(url, 'http://x').searchParams.get('file'), 'bg-1700000000000.jpg')
})

test('整条链路：上传 → 落盘 → 首屏 CSS 指向可访问的 URL', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'theme-studio-bg-e2e-'))
  try {
    const settingsFile = join(dir, 'settings.json')
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3])
    writeFileSync(settingsFile, JSON.stringify({
      theme: 'glass',
      background: { mode: 'image', file: 'bg-1700000000000.png', fit: 'cover', opacity: 100 },
    }))
    // 直接把图片放进背景目录（与 uploadBackground 的落盘位置一致）。
    const { backgroundDir } = await import('../lib/settings.js')
    const { mkdirSync, writeFileSync: write } = await import('node:fs')
    mkdirSync(backgroundDir(settingsFile), { recursive: true })
    write(join(backgroundDir(settingsFile), 'bg-1700000000000.png'), png)

    const { ctx, routes } = realHostContext()
    apply(ctx, { settingsFile })
    assert.equal(routes.length, 1)

    // ① 首屏 CSS 里的 URL 必须能被这条路由应答。
    const { settings } = loadSettings(settingsFile, { isThemeId: () => true, fontSizeRanges: {} })
    const css = customCss(settings, { backgroundUrl: backgroundUrl(settings.background.file) })
    const inCss = /background-image: url\("([^"]+)"\)/.exec(css)
    assert.ok(inCss, 'CSS 里没有 background-image')
    const response = await routes[0].fetch(new Request(`http://x${inCss[1]}`))
    assert.equal(response.status, 200, 'CSS 引用的背景图 URL 取不到图')
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [...png])

    // ② 首屏 HTML 必须带上让位开关，否则图片能取到也看不见。
    const html = patchIndex(HTML, { themeId: 'glass', settings })
    assert.match(html, new RegExp(`${BACKGROUND_ATTR}="image"`), '首屏没有 data-ts-bg，背景会被骨架层盖住')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('data-ts-bg 只在确实有背景可画时出现', () => {
  // mode=image 但没有文件名 → 不会生成 background-image，也就不能让位。
  assert.equal(activeBackgroundMode({ mode: 'image', file: null }), 'none')
  assert.equal(activeBackgroundMode({ mode: 'image', file: 'a.png' }), 'image')
  // mode=color 但没有色值 → 同上。
  assert.equal(activeBackgroundMode({ mode: 'color', value: '' }), 'none')
  assert.equal(activeBackgroundMode({ mode: 'color', value: '#123456' }), 'color')
  assert.equal(activeBackgroundMode({ mode: 'none' }), 'none')
  assert.equal(activeBackgroundMode(undefined), 'none')

  const image = { background: { mode: 'image', file: 'a.png' } }
  const blankImage = { background: { mode: 'image', file: null } }
  assert.match(themeScopeScript('glass', image), new RegExp(`${BACKGROUND_ATTR}', "image"`))
  assert.match(themeScopeScript('glass', blankImage), new RegExp(`removeAttribute\\('${BACKGROUND_ATTR}'\\)`))
  assert.match(setBackgroundFlagScript({ mode: 'color', value: '#fff' }), /"color"/)
})

test('「系统默认」主题也能设背景：data-ts-bg 与主题属性互相独立', () => {
  const settings = { background: { mode: 'image', file: 'a.png' } }
  const html = patchIndex(HTML, { themeId: 'none', settings })
  const tag = /<html[^>]*>/.exec(html)[0]
  assert.equal(tag.includes(THEME_ATTR), false, '系统默认时不该有主题属性')
  assert.match(tag, new RegExp(`${BACKGROUND_ATTR}="image"`), '系统默认时仍要挂背景开关')
})

test('重写 html 标签时不会留下重复的 data-ts-bg', () => {
  const once = patchIndex(HTML, { themeId: 'glass', settings: { background: { mode: 'color', value: '#123' } } })
  const twice = patchIndex(once, { themeId: 'glass', settings: {} })
  const tag = /<html[^>]*>/.exec(twice)[0]
  assert.equal((tag.match(/data-ts-bg/g) ?? []).length, 0, `清空背景后属性残留：${tag}`)

  const image = patchIndex(HTML, { themeId: 'glass', settings: { background: { mode: 'image', file: 'a.png' } } })
  const tag2 = /<html[^>]*>/.exec(image)[0]
  assert.equal((tag2.match(/data-ts-bg/g) ?? []).length, 1, `属性重复：${tag2}`)
})

/**
 * 让位层本身的三条不变式。
 *
 * 这些规则错任何一条，用户都会回到「上传成功但界面没变」，或者更糟：
 * 骨架层在没背景时也让位，界面透出宿主白底。
 */
test('让位层覆盖全部不透明骨架，并且只在 data-ts-bg 下生效', () => {
  const css = readStyleFile(BACKGROUND_STYLE_FILE)
  // 每一条规则都必须带 html[data-ts-bg] 前缀——否则没有背景的用户界面会塌。
  const selectors = [...css.matchAll(/(^|\})\s*([^{}@]+?)\s*\{/g)].map((m) => m[2].trim())
  const unscoped = selectors.filter((sel) => sel !== '' && !sel.includes(`[${BACKGROUND_ATTR}]`))
  assert.deepEqual(unscoped, [], `让位层存在不带 data-ts-bg 的规则：\n${unscoped.join('\n')}`)

  for (const part of ['_frame', '_centerCol', '_sidebarCol', '_rightbarCol', '_bottomRow']) {
    assert.ok(css.includes(part), `让位层漏掉了 ${part}`)
  }
  // 左侧栏内容容器也必须清掉实色底，否则侧边栏整列挡住背景。
  assert.ok(css.includes('hHd-Xa_root'), '让位层必须清掉左侧栏 hHd-Xa_root')
  assert.ok(css.includes('ixJ31a_root'), '让位层必须清掉桌面左侧栏 ixJ31a_root')
  assert.match(css, new RegExp(`\\[${BACKGROUND_ATTR}\\]\\s+#root`), '让位层必须清掉 #root 的实色底')
})

test('会话层也让位，否则背景图被挡在会话区域后面', () => {
  const css = readStyleFile(BACKGROUND_STYLE_FILE)

  // 这是「设了背景图却只在外层边缘看得见」的根因：`.centerCol` 只是外层容器，
  // 宿主在里面铺了 ConversationRoot（wSkVaW_root / _1O6vqW_root），自带纯白实底！
  // 并且会话消息列与输入框底座也都有不透明背景。
  for (const part of ['wSkVaW_root', '_1O6vqW_root', 'wSkVaW_composerSeat', '_1O6vqW_composerSeat', 'EvIC1a_root', 'EvIC1a_scroll', 'EvIC1a_column', 'data-chat-flow']) {
    assert.ok(css.includes(part), `会话层让位漏掉了 ${part}`)
  }
  // 也覆盖 0.3.x 的类名哈希。
  assert.ok(css.includes('_6nxh1G_root'), '会话层让位必须同时覆盖 _6nxh1G_* 哈希')

  // 这几层必须是 transparent，不能只是降低不透明度：它们铺满滚动区，
  // 任何实色都会把照片整块挡掉。底色由 .centerCol 那 38% 统一承担。
  const chatBlock = /html\[data-ts-bg\][^{]*wSkVaW_root[^{]*\{([^}]*)\}/.exec(css)
  assert(chatBlock, '会话层让位规则必须存在')
  assert.match(chatBlock[1], /background:\s*transparent/)
})

test('让位层排在玻璃层之后（否则玻璃的填充会反压回来）', () => {
  const css = composeThemeCss('glass')
  const glassAt = css.indexOf('backdrop-filter: blur(var(--ts-blur))')
  const letGoAt = css.indexOf(`[${BACKGROUND_ATTR}]`)
  assert.ok(glassAt > 0 && letGoAt > 0)
  assert.ok(letGoAt > glassAt, '让位层必须在玻璃层之后装配')
})

test('没设背景时首屏产物里让位规则不命中任何元素', () => {
  const html = patchIndex(HTML, { themeId: 'glass', settings: {} })
  assert.equal(html.includes(`${BACKGROUND_ATTR}=`), false, '没背景却写了 data-ts-bg')
  // 样式表里虽然有让位规则，但 html 上没有开关属性 → 选择器不命中。
  assert.ok(html.includes(`[${BACKGROUND_ATTR}]`), '让位规则应始终在样式表里（由属性开关）')
})

/**
 * 玻璃主题在「用户设了背景图」时不得使用主题的强模糊。
 *
 * 事故背景：玻璃主题默认 blur 30~36px，那是给低饱和渐变壁纸调的。用户传真实
 * 照片后，36px 会把照片糊成一片纯色块——内容完全认不出，用户反馈为
 * 「玻璃主题下背景图被挡住了」。降到 8px 既柔化照片、又保留可辨识度。
 */
test('玻璃主题在用户设了背景图时使用弱模糊（否则照片被糊成色块）', async () => {
  const { readStyleFile, BACKGROUND_STYLE_FILE } = await import('../lib/css.js')
  const css = readStyleFile(BACKGROUND_STYLE_FILE)
  const blocks = [...css.matchAll(/[^{}]*data-theme-studio="glass[^"]*"[^{}]*\{([^}]*)\}/g)]
  assert.ok(blocks.length > 0, '让位层缺少玻璃主题的 backdrop-filter 覆盖')
  for (const block of blocks) {
    const body = block[1]
    if (!body.includes('backdrop-filter')) continue
    // 不允许再引用主题的强模糊变量。
    assert.equal(
      /blur\(var\(--ts-blur\)\)/.test(body),
      false,
      '用户设了背景图时不应沿用主题的 30~36px 强模糊',
    )
    const blur = /blur\((\d+)px\)/.exec(body)
    assert.ok(blur, '缺少明确的模糊半径')
    assert.ok(Number(blur[1]) <= 12, `模糊半径 ${blur[1]}px 过大，会把用户照片糊成色块`)
  }
})
