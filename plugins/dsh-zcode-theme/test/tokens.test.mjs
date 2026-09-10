import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HOST_TOKEN_MAP,
  REQUIRED_HOST_TOKENS,
  hostTokenOverrides,
  lightDark,
  tokensCss,
  zcodeLightTokens,
  zcodeTokens,
} from '../lib/tokens.js'

test('ZCode Token 色值符合设计规范', () => {
  const { color, radius, touch } = zcodeTokens
  assert.equal(color.bgBase, '#1A1A1A')
  assert.equal(color.bgLayer1, '#222222')
  assert.equal(color.bgLayer2, '#262626')
  assert.equal(color.bgModule, '#2A2A2A')
  assert.equal(color.bgCode, '#161616')
  assert.equal(color.textPrimary, '#F2F2F2')
  assert.equal(color.textSecondary, '#A3A3A3')
  assert.equal(color.textTertiary, '#737373')
  assert.equal(color.brand, '#E85D3A')
  assert.equal(color.brandHover, '#F06A48')
  assert.equal(color.brandActive, '#D14F2E')
  assert.equal(color.brandSubtle, 'rgba(232,93,58,0.12)')
  assert.equal(color.brandFocus, 'rgba(232,93,58,0.25)')
  assert.equal(color.borderL1, 'rgba(255,255,255,0.08)')
  assert.equal(color.borderL2, 'rgba(255,255,255,0.12)')
  assert.equal(color.interactiveHover, 'rgba(255,255,255,0.06)')
  assert.equal(color.interactivePressed, 'rgba(255,255,255,0.10)')
  assert.equal(radius.small, '8px')
  assert.equal(radius.button, '12px')
  assert.equal(radius.input, '14px')
  assert.equal(radius.card, '16px')
  assert.equal(radius.dialog, '20px')
  assert.equal(radius.pill, '999px')
  assert.equal(touch.min, '44px')
})

test('浅色 Token 与暗色成对且背景/文字反转', () => {
  const dark = zcodeTokens.color
  const light = zcodeLightTokens.color
  assert.equal(light.brand, dark.brand)
  assert.equal(light.bgBase, '#F7F7F5')
  assert.equal(light.textPrimary, '#1A1A1A')
  assert.equal(light.borderL1, 'rgba(0,0,0,0.08)')
  assert.notEqual(light.bgBase, dark.bgBase)
  assert.notEqual(light.textPrimary, dark.textPrimary)
})

test('规范要求的宿主 Token 全部存在且映射到 ZCode 色值', () => {
  for (const name of REQUIRED_HOST_TOKENS) {
    assert.equal(typeof HOST_TOKEN_MAP[name]?.dark, 'string', `缺少 ${name}`)
    assert.equal(typeof HOST_TOKEN_MAP[name]?.light, 'string', `缺少 ${name}.light`)
  }
  assert.equal(HOST_TOKEN_MAP['--dsw-alias-bg-base'].dark, zcodeTokens.color.bgBase)
  assert.equal(HOST_TOKEN_MAP['--dsw-alias-bg-base'].light, zcodeLightTokens.color.bgBase)
  assert.equal(HOST_TOKEN_MAP['--dsw-specific-sidebar-fill'].dark, zcodeTokens.color.bgLayer1)
  assert.equal(HOST_TOKEN_MAP['--dsw-alias-brand-primary'].dark, zcodeTokens.color.brand)
  assert.equal(HOST_TOKEN_MAP['--dsw-alias-button-primary-fill'].dark, zcodeTokens.color.brand)
  assert.equal(HOST_TOKEN_MAP['--dsw-alias-brand-subtle'].dark, zcodeTokens.color.brandSubtle)
})

test('overrideTokens 为每个 Token 提供 light/dark 成对值', () => {
  const overrides = hostTokenOverrides()
  for (const name of REQUIRED_HOST_TOKENS) {
    assert.equal(overrides[name].light, HOST_TOKEN_MAP[name].light)
    assert.equal(overrides[name].dark, HOST_TOKEN_MAP[name].dark)
  }
})

test('生成的 Token CSS 用 light-dark 覆盖宿主变量', () => {
  const css = tokensCss()
  for (const [name, modes] of Object.entries(HOST_TOKEN_MAP)) {
    const value = lightDark(modes.light, modes.dark).replace(/[()]/g, '\\$&')
    assert.match(css, new RegExp(`${name}:\\s*${value}`), `${name} 未写入 tokensCss`)
  }
})
