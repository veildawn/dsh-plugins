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
})
