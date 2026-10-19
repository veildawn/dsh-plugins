import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HOST_TOKEN_MAP,
  REQUIRED_HOST_TOKENS,
  ZAI_PALETTE,
  hostTokenOverrides,
  lightDark,
  tokensCss,
  zaiTokensCss,
} from '../lib/tokens.js'

test('Zai 品牌色为官方单色体系', () => {
  // 官方 .theme-zai-light: --color-brand: #000000；.theme-zai-dark: --color-brand: #ffffff
  assert.equal(ZAI_PALETTE.brand.light, '#000000')
  assert.equal(ZAI_PALETTE.brand.dark, '#ffffff')
  assert.equal(HOST_TOKEN_MAP['--dsw-alias-brand-primary'].light, '#000000')
  assert.equal(HOST_TOKEN_MAP['--dsw-alias-brand-primary'].dark, '#ffffff')
})

test('画布与表面层级与官方一致', () => {
  assert.equal(ZAI_PALETTE.background.dark, '#161616')
  assert.equal(ZAI_PALETTE.panel.dark, '#202020')
  assert.equal(ZAI_PALETTE.card.dark, '#2b2b2b')
  assert.equal(ZAI_PALETTE.input.dark, '#2b2b2b')
  assert.equal(ZAI_PALETTE.foreground.dark, '#d4d4d4')
  assert.equal(ZAI_PALETTE.border.dark, 'rgba(255, 255, 255, 0.1)')
  assert.equal(ZAI_PALETTE['border-hover'].dark, 'rgba(255, 255, 255, 0.15)')
  assert.equal(ZAI_PALETTE.surface.dark, 'rgba(255, 255, 255, 0.05)')
  assert.equal(ZAI_PALETTE['surface-hover'].dark, 'rgba(255, 255, 255, 0.1)')
})

test('浅色 Token 与暗色成对且背景/文字反转', () => {
  assert.equal(ZAI_PALETTE.background.light, '#f8f8f8')
  assert.equal(ZAI_PALETTE.background.dark, '#161616')
  assert.equal(ZAI_PALETTE.foreground.light, '#262626')
  assert.equal(ZAI_PALETTE.foreground.dark, '#d4d4d4')
  assert.equal(ZAI_PALETTE.border.light, 'rgba(13, 13, 13, 0.1)')
  assert.notEqual(ZAI_PALETTE.background.light, ZAI_PALETTE.background.dark)
  assert.notEqual(ZAI_PALETTE.foreground.light, ZAI_PALETTE.foreground.dark)
})

test('ZAI_PALETTE 每个条目都是 light/dark 成对字符串', () => {
  for (const [key, modes] of Object.entries(ZAI_PALETTE)) {
    assert.equal(typeof modes.light, 'string', `${key}.light`)
    assert.equal(typeof modes.dark, 'string', `${key}.dark`)
    assert.ok(modes.light.length > 0, `${key}.light 为空`)
    assert.ok(modes.dark.length > 0, `${key}.dark 为空`)
    // 生成阶段已展开所有 var()，落地值不应再含变量引用。
    assert.equal(/var\(/.test(modes.light), false, `${key}.light 残留 var()`)
    assert.equal(/var\(/.test(modes.dark), false, `${key}.dark 残留 var()`)
  }
})

test('官方终端、轨迹、mention、diff Token 全部落地', () => {
  const required = [
    // 终端 22 项（docs/ui/terminal-theme-tokens.md）
    'terminal-bg',
    'terminal-fg',
    'terminal-cursor',
    'terminal-cursor-accent',
    'terminal-selection',
    'terminal-selection-inactive',
    'terminal-black',
    'terminal-red',
    'terminal-green',
    'terminal-yellow',
    'terminal-blue',
    'terminal-magenta',
    'terminal-cyan',
    'terminal-white',
    'terminal-bright-black',
    'terminal-bright-red',
    'terminal-bright-green',
    'terminal-bright-yellow',
    'terminal-bright-blue',
    'terminal-bright-magenta',
    'terminal-bright-cyan',
    'terminal-bright-white',
    // 轨迹 5 项
    'trajectory-user',
    'trajectory-assistant',
    'trajectory-reasoning',
    'trajectory-tool-call',
    'trajectory-tool-result',
    // mention 6 类 × 3
    'file-node',
    'file-node-hover',
    'file-node-foreground',
    'skill-node',
    'skill-node-hover',
    'skill-node-foreground',
    'command-node',
    'command-node-hover',
    'command-node-foreground',
    'subagent-node',
    'subagent-node-hover',
    'subagent-node-foreground',
    'session-node',
    'session-node-hover',
    'session-node-foreground',
    'plugin-node',
    'plugin-node-hover',
    'plugin-node-foreground',
    // diff / git
    'diff-added',
    'diff-removed',
    'file-diff-added-bg',
    'file-diff-deleted-bg',
    'code-diff-added',
    'code-diff-deleted',
    'git-modified',
    'git-added',
    'git-deleted',
    'git-renamed',
    // 用量图
    'usage-chart-1',
    'context-breakdown-7',
  ]
  for (const key of required) {
    assert.ok(key in ZAI_PALETTE, `缺少官方 Token --color-${key}`)
  }
})

test('规范要求的宿主 Token 全部存在且映射到 Zai 色值', () => {
  for (const name of REQUIRED_HOST_TOKENS) {
    assert.equal(typeof HOST_TOKEN_MAP[name]?.dark, 'string', `缺少 ${name}`)
    assert.equal(typeof HOST_TOKEN_MAP[name]?.light, 'string', `缺少 ${name}.light`)
  }
  assert.equal(HOST_TOKEN_MAP['--dsw-alias-bg-base'].dark, ZAI_PALETTE.background.dark)
  assert.equal(HOST_TOKEN_MAP['--dsw-alias-bg-base'].light, ZAI_PALETTE.background.light)
  assert.equal(HOST_TOKEN_MAP['--dsw-specific-sidebar-fill'].dark, ZAI_PALETTE.sidebar.dark)
  assert.equal(HOST_TOKEN_MAP['--dsw-alias-label-primary'].dark, ZAI_PALETTE.foreground.dark)
  assert.equal(HOST_TOKEN_MAP['--dsw-alias-markdown-code-block'].dark, ZAI_PALETTE.background.dark)
})

test('overrideTokens 为每个 Token 提供 light/dark 成对值', () => {
  const overrides = hostTokenOverrides()
  for (const [name, modes] of Object.entries(overrides)) {
    assert.equal(typeof modes.light, 'string', `${name}.light`)
    assert.equal(typeof modes.dark, 'string', `${name}.dark`)
  }
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

test('zaiTokensCss 输出官方 --color-* 变量', () => {
  const css = zaiTokensCss()
  assert.match(css, /--color-background:\s*light-dark\(#f8f8f8, #161616\)/)
  assert.match(css, /--color-brand:\s*light-dark\(#000000, #ffffff\)/)
  assert.match(css, /--color-trajectory-reasoning:\s*light-dark\(#7c3aed, #a78bfa\)/)
  assert.match(css, /--color-terminal-bright-white:\s*light-dark\(#0d0d0d, #f8f8f8\)/)
})

test('宿主消费的语义 Token 全部有映射', () => {
  // 这几个别名宿主有组件直接 var() 引用，但官方 design-platform CSS 没有定义；
  // 漏映射就会回落到宿主默认蓝板，主题局部漏色。
  const hostConsumedAliases = [
    '--dsw-alias-bg-l1',
    '--dsw-alias-fill-l1',
    '--dsw-alias-fill-l2',
    '--dsw-alias-fill-tsp-secondary',
  ]
  for (const name of hostConsumedAliases) {
    assert.ok(name in HOST_TOKEN_MAP, `缺少宿主实际消费的 Token：${name}`)
    assert.equal(typeof HOST_TOKEN_MAP[name].light, 'string', `${name}.light`)
    assert.equal(typeof HOST_TOKEN_MAP[name].dark, 'string', `${name}.dark`)
  }
})

test('上下文用量表接入官方色阶', async () => {
  const { loadThemeCss } = await import('../lib/css.js')
  const css = loadThemeCss()
  // 宿主 ContextMeter 用 --meter-tint 分三段着色，主题必须把它指向官方色阶。
  for (const cls of ['JObwrW_colorSystem', 'JObwrW_colorTools', 'JObwrW_colorMessages']) {
    assert.ok(css.includes(cls), `缺少上下文用量表着色：${cls}`)
  }
  assert.match(css, /\.JObwrW_colorSystem\s*\{\s*--meter-tint:\s*var\(--color-context-breakdown-1\)/)
})
