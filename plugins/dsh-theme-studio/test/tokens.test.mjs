/**
 * Token 契约测试。
 *
 * 守的是「统一 Token」这件事本身：主题色板必须能解析出全部宿主 Token，
 * 且每一对值都必须是明暗成对的——这是宿主 `overrideTokens` 与 CSS
 * `light-dark()` 的硬性要求，缺一半会让切换明暗时出现不可读组合。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FORBIDDEN_COLORS,
  FORBIDDEN_HOST_TOKENS,
  HOST_TOKEN_MAP,
  MATERIAL_DEFAULTS,
  REQUIRED_HOST_TOKENS,
  buildHostTokens,
  buildMaterialTokens,
  isBodyScopedToken,
  lightDark,
  resolveKey,
  themeVarsCss,
} from '../lib/tokens.js'
import { BUILTIN_THEMES, THEME_IDS, getTheme, normalizeThemeId } from '../lib/themes/index.js'

test('每款主题都能解析出全部宿主 Token', () => {
  for (const theme of BUILTIN_THEMES) {
    const tokens = buildHostTokens(theme.palette)
    assert.deepEqual(
      Object.keys(tokens).sort(),
      Object.keys(HOST_TOKEN_MAP).sort(),
      `主题 ${theme.id} 的宿主 Token 数量与映射表不一致`,
    )
    for (const [name, modes] of Object.entries(tokens)) {
      assert.equal(typeof modes.light, 'string', `${theme.id} 的 ${name} 缺 light`)
      assert.equal(typeof modes.dark, 'string', `${theme.id} 的 ${name} 缺 dark`)
      assert.notEqual(modes.light.trim(), '', `${theme.id} 的 ${name} light 为空`)
      assert.notEqual(modes.dark.trim(), '', `${theme.id} 的 ${name} dark 为空`)
    }
  }
})

test('规范要求的宿主 Token 全部被映射', () => {
  for (const name of REQUIRED_HOST_TOKENS) {
    assert.ok(name in HOST_TOKEN_MAP, `缺少必需 Token ${name}`)
  }
})

test('禁止引用的宿主 Token 不在映射表里', () => {
  for (const name of FORBIDDEN_HOST_TOKENS) {
    assert.equal(name in HOST_TOKEN_MAP, false, `不应映射不存在的 Token ${name}`)
  }
})

test('主题产物不含废弃品牌色', () => {
  for (const theme of BUILTIN_THEMES) {
    const css = themeVarsCss(theme).toLowerCase()
    for (const color of FORBIDDEN_COLORS) {
      assert.equal(css.includes(color.toLowerCase()), false, `主题 ${theme.id} 残留废弃色 ${color}`)
    }
  }
})

test('语义键支持 @ 引用与循环检测', () => {
  const palette = {
    base: { light: '#111111', dark: '#eeeeee' },
    alias: '@base',
  }
  assert.deepEqual(resolveKey(palette, 'alias'), { light: '#111111', dark: '#eeeeee' })

  const cyclic = { a: '@b', b: '@a' }
  assert.throws(() => resolveKey(cyclic, 'a'), /循环引用/)
})

test('缺少语义键时抛出可读错误', () => {
  assert.throws(() => resolveKey({}, 'missing'), /缺少语义键 "missing"/)
})

test('裸字符串语义键在明暗两侧取同值', () => {
  assert.deepEqual(resolveKey({ x: '#abcdef' }, 'x'), { light: '#abcdef', dark: '#abcdef' })
})

test('light-dark 在两态相同时退化为裸值', () => {
  assert.equal(lightDark('#fff', '#fff'), '#fff')
  assert.equal(lightDark('#fff', '#000'), 'light-dark(#fff, #000)')
})

test('body 级 Token 判定与宿主定义位置一致', () => {
  // 宿主把 alias / static / specific 定义在 body 上
  assert.equal(isBodyScopedToken('--dsw-alias-bg-base'), true)
  assert.equal(isBodyScopedToken('--dsw-static-deepseek-500'), true)
  assert.equal(isBodyScopedToken('--dsw-specific-sidebar-fill'), true)
  assert.equal(isBodyScopedToken('--dsw-font-family'), true)
  // 宿主把圆角 / 阴影定义在 :root 上
  assert.equal(isBodyScopedToken('--dsw-radius-sm'), false)
  assert.equal(isBodyScopedToken('--dsw-shadow-lv3'), false)
  // 主题自有材质
  assert.equal(isBodyScopedToken('--ts-blur'), false)
})

test('主题变量块把 body 级 Token 写在 body 选择器上', () => {
  for (const theme of BUILTIN_THEMES) {
    const css = themeVarsCss(theme)
    const htmlBlock = css.match(/^html\[data-theme-studio="[^"]+"\] \{([\s\S]*?)\n\}/)
    assert.ok(htmlBlock, `${theme.id} 缺少 html 变量块`)
    // alias 绝不能落在 html 块里：宿主 body 上的同名定义会盖掉它
    assert.equal(
      /--dsw-alias-/.test(htmlBlock[1]),
      false,
      `${theme.id} 的 --dsw-alias-* 泄漏到了 html 块，会被宿主 body 定义覆盖`,
    )
    const bodyBlock = css.match(/^html\[data-theme-studio="[^"]+"\] body \{([\s\S]*?)\n\}/m)
    assert.ok(bodyBlock, `${theme.id} 缺少 body 变量块`)
    assert.match(bodyBlock[1], /--dsw-alias-bg-base:/, `${theme.id} 的 body 块缺 --dsw-alias-bg-base`)
    // 圆角属于 :root 层，应留在 html 块
    assert.match(htmlBlock[1], /--dsw-radius-sm:/, `${theme.id} 的圆角应在 html 块`)
  }
})

test('材质 Token 覆盖未知键时报错', () => {
  assert.throws(() => buildMaterialTokens({ '--ts-unknown': '1px' }), /未知材质 Token/)
  const merged = buildMaterialTokens({ '--ts-blur': '40px' })
  assert.equal(merged['--ts-blur'], '40px')
  // 未覆盖的键仍取默认值
  assert.equal(merged['--ts-saturate'], MATERIAL_DEFAULTS['--ts-saturate'])
})

test('玻璃主题的暗色材质覆盖只作用于被覆盖的键', () => {
  const glass = getTheme('glass')
  const css = themeVarsCss(glass)
  const darkBlock = css.match(/body\[data-ds-dark-theme\] \{([\s\S]*?)\n\}/)
  assert.ok(darkBlock, '玻璃主题缺少暗色材质块')
  assert.match(darkBlock[1], /--ts-glass-highlight:/)
  // 未被 material 覆盖的默认材质不应出现在暗色块里（那是噪音）
  assert.equal(/--dsw-radius-sm:/.test(darkBlock[1]), false)
})

test('ZCode 主题没有暗色材质块', () => {
  const css = themeVarsCss(getTheme('zcode'))
  assert.equal(/body\[data-ds-dark-theme\]/.test(css), false)
})

test('主题 id 规范化', () => {
  assert.equal(normalizeThemeId('glass'), 'glass')
  assert.equal(normalizeThemeId('nope'), 'zcode')
  assert.equal(normalizeThemeId(undefined), 'zcode')
  assert.equal(normalizeThemeId(null, 'glass'), 'glass')
})

test('内置主题 id 与顺序稳定', () => {
  assert.deepEqual([...THEME_IDS], ['zcode', 'zcode-mono', 'glass', 'glass-color'])
  assert.equal(BUILTIN_THEMES.length, 4)
})
