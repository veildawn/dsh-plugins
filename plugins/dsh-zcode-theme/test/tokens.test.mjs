import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HOST_TOKEN_MAP,
  REQUIRED_HOST_TOKENS,
  hostTokenOverrides,
  zcodeTokens,
} from '../lib/tokens.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

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

test('规范要求的宿主 Token 全部存在且映射到 ZCode 色值', () => {
  for (const name of REQUIRED_HOST_TOKENS) {
    assert.equal(typeof HOST_TOKEN_MAP[name], 'string', `缺少 ${name}`)
    assert.notEqual(HOST_TOKEN_MAP[name], '')
  }
  assert.equal(HOST_TOKEN_MAP['--dsw-alias-bg-base'], zcodeTokens.color.bgBase)
  assert.equal(HOST_TOKEN_MAP['--dsw-specific-sidebar-fill'], zcodeTokens.color.bgLayer1)
  assert.equal(HOST_TOKEN_MAP['--dsw-alias-brand-primary'], zcodeTokens.color.brand)
  assert.equal(HOST_TOKEN_MAP['--dsw-alias-button-primary-fill'], zcodeTokens.color.brand)
  assert.equal(HOST_TOKEN_MAP['--dsw-alias-brand-subtle'], zcodeTokens.color.brandSubtle)
})

test('overrideTokens 为每个 Token 提供 light/dark 成对值', () => {
  const overrides = hostTokenOverrides()
  for (const name of REQUIRED_HOST_TOKENS) {
    assert.equal(overrides[name].light, HOST_TOKEN_MAP[name])
    assert.equal(overrides[name].dark, HOST_TOKEN_MAP[name])
  }
})

test('tokens.css 与 HOST_TOKEN_MAP 一致', async () => {
  const css = await readFile(join(root, 'lib/styles/tokens.css'), 'utf8')
  for (const [name, value] of Object.entries(HOST_TOKEN_MAP)) {
    assert.match(css, new RegExp(`${name}:\\s*${value.replace(/[()]/g, '\\$&')}`), `${name} 未写入 tokens.css`)
  }
})
