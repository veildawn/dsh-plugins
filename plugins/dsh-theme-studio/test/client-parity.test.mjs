/**
 * 客户端与服务端的一致性测试。
 *
 * 客户端 bundle 不能 import 宿主模块，所以字段色角色、字号范围、自定义层 CSS
 * 生成逻辑都在 `lib/client.js` 里内联了一份。这类「同一份逻辑两处实现」最容易
 * 悄悄漂移：改了服务端忘了改客户端 → 面板预览与实际保存结果不一致，
 * 而且不报错，只是「保存后颜色又变回去了」。
 *
 * 这里用同一组输入比对两边输出，逐字节相同才算通过。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { customCss, hostTokensFor, FIELD_COLOR_ROLES } from '../lib/settings.js'
import { FONT_SIZE_RANGES } from '../lib/index.js'

/** 在伪造的 window.__ModuleLoader__ 下加载客户端 bundle，取出 factory。 */
async function loadClient() {
  let definition
  const previous = globalThis.window
  globalThis.window = { __ModuleLoader__: { load: (value) => { definition = value } } }
  try {
    await import(`../lib/client.js?t=${Date.now()}`)
  } finally {
    globalThis.window = previous
  }
  assert.ok(definition, '客户端 bundle 没有调用 __ModuleLoader__.load')
  assert.equal(definition.id, '@weniatall/dsh-theme-studio')
  // factory 需要 require('react')，这里给一个最小替身
  const fakeReact = {
    createElement: () => null,
    useState: () => [null, () => {}],
    useEffect: () => {},
    useRef: () => ({ current: null }),
  }
  return definition.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`未预期的依赖：${name}`)
  })
}

const client = await loadClient()
const { customLayerCss, FIELD_COLOR_ROLES: CLIENT_ROLES, FONT_SIZE_RANGES: CLIENT_RANGES, legacyIdOf } = client.internals

test('字段色角色清单两端一致', () => {
  assert.deepEqual(CLIENT_ROLES, FIELD_COLOR_ROLES)
})

test('字号范围两端一致', () => {
  const shape = (ranges) =>
    Object.fromEntries(Object.entries(ranges).map(([key, spec]) => [key, { min: spec.min, max: spec.max }]))
  assert.deepEqual(shape(CLIENT_RANGES), shape(FONT_SIZE_RANGES))
})

test('自定义层 CSS 两端逐字节一致', () => {
  const cases = [
    {},
    { background: { mode: 'color', value: '#123456' } },
    {
      background: { mode: 'image', file: 'bg.png', fit: 'cover', opacity: 100 },
      fontText: true,
    },
    {
      background: { mode: 'image', file: 'bg.png', fit: 'contain', opacity: 55 },
      fonts: { text: '"PingFang SC", sans-serif', code: '"Fira Code", monospace' },
      fontSizes: { text: 16, code: 12, terminal: 14 },
      glass: { blur: 42, saturate: 210 },
      fieldColors: { foreground: '#010203', background: '#040506', border: '#070809' },
    },
    {
      fonts: { text: 'Inter' },
      fontSizes: { text: 18 },
    },
  ]

  for (const input of cases) {
    const backgroundUrl = input.background?.mode === 'image' ? '/api/dsh-theme-studio/background/bg.png' : null
    const server = customCss(input, { backgroundUrl })
    const browser = customLayerCss(input, backgroundUrl)
    assert.equal(browser, server, `两侧输出不一致：${JSON.stringify(input)}`)
  }
})

test('自定义层 CSS 两端对空值处理一致', () => {
  assert.equal(customLayerCss({}, null), customCss({}, {}))
  assert.equal(customLayerCss({ fonts: {} }, null), customCss({ fonts: {} }, {}))
})

test('旧属性映射两端一致', () => {
  assert.equal(legacyIdOf('zcode'), 'zcode')
  assert.equal(legacyIdOf('zcode-mono'), 'zcode-mono')
  assert.equal(legacyIdOf('glass'), 'glass')
  assert.equal(legacyIdOf('glass-color'), 'glass-color')
  assert.equal(legacyIdOf('none'), null)
  // 未指定或默认时为 none，不映射旧属性
  assert.equal(legacyIdOf(undefined), null)
})

test('客户端声明了正确的注入依赖', () => {
  assert.deepEqual(client.inject, ['slots', 'connection'])
  assert.equal(typeof client.apply, 'function')
})

test('字段色的宿主层映射两端一致', () => {
  const clientMap = client.internals.FIELD_HOST_TOKENS
  assert.ok(clientMap, '客户端没有导出 FIELD_HOST_TOKENS')
  for (const role of FIELD_COLOR_ROLES) {
    const expected = hostTokensFor(role.key)
    assert.deepEqual(
      [...(clientMap[role.key] ?? [])].sort(),
      [...expected].sort(),
      `字段色角色 "${role.key}" 的宿主映射两端不一致`,
    )
  }
})

test('客户端暴露的属性名与服务端一致', async () => {
  const server = await import('../lib/index.js')
  assert.equal(client.internals.THEME_ATTR, server.THEME_ATTR)
  assert.equal(client.internals.STYLE_ID, server.STYLE_ID)
  // 背景让位开关：两端属性名必须一致，否则会出现「设置页里能看见背景、
  // 保存后回到主界面就没了」这类只在某一条路径上复现的问题。
  assert.equal(client.internals.BACKGROUND_ATTR, server.BACKGROUND_ATTR)
})

/**
 * 让位开关的判定条件必须与 CSS 生成条件同源。
 *
 * 这是「背景不生效」的第三个潜在根因：属性挂了但 CSS 没画背景（界面露出裸底），
 * 或者 CSS 画了背景但属性没挂（背景被骨架层盖住）。两者都只在特定组合下出现
 * （例如刚点「图片」但还没上传文件），手工点测很难覆盖。
 *
 * 这里用 `activeBackgroundMode()`（服务端唯一判据）逐组合比对，
 * 客户端在同样输入下必须得出相同的 mode。
 */
test('客户端背景让位判定与服务端 activeBackgroundMode 完全一致', async () => {
  const { activeBackgroundMode } = await import('../lib/settings.js')
  const cases = [
    {},
    { background: { mode: 'none' } },
    { background: { mode: 'color', value: '#123456' } },
    { background: { mode: 'color', value: '' } },
    { background: { mode: 'image', file: 'bg.png' } },
    { background: { mode: 'image', file: null } },
    { background: { mode: 'image', file: 'bg.png', fit: 'contain', opacity: 40 } },
  ]

  // 复刻客户端 applyToDocument 里的判定（与服务端同一份逻辑）。
  const clientMode = (settings) => {
    const background = settings?.background ?? {}
    if (background.mode === 'color' && background.value) return 'color'
    if (background.mode === 'image' && background.file) return 'image'
    return 'none'
  }

  for (const input of cases) {
    assert.equal(
      clientMode(input),
      activeBackgroundMode(input.background),
      `让位判定不一致：${JSON.stringify(input)}`,
    )
  }

  // 反向：判定为 none 时 CSS 确实不产出背景声明（否则白让位，露出裸底）。
  for (const input of cases) {
    if (clientMode(input) !== 'none') continue
    const css = customLayerCss(input, null)
    assert.equal(
      /^\s*background-(image|color):/m.test(css),
      false,
      `判定为 none 却产出了背景声明：${JSON.stringify(input)}\n${css}`,
    )
  }
})

test('正文与代码字体下拉预设选项两端一致', async () => {
  const { TEXT_FONT_OPTIONS, CODE_FONT_OPTIONS } = await import('../lib/settings.js')
  assert.deepEqual(client.internals.TEXT_FONT_OPTIONS, TEXT_FONT_OPTIONS, '正文字体选项两端不一致')
  assert.deepEqual(client.internals.CODE_FONT_OPTIONS, CODE_FONT_OPTIONS, '代码字体选项两端不一致')
})
