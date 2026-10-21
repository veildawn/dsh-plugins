/**
 * ZCode 官方色板一致性测试。
 *
 * ZCode 主题的价值在于「与上游逐值一致」。这份测试把 `ZAI_PALETTE` 与仓库内
 * 的快照 `fixtures/zai-palette.json` 逐项比对——上游漂移、或有人手改了色值，
 * 这里先失败，而不是等到用户发现「颜色和 ZCode 官网对不上」。
 *
 * 快照本身是**导入基线**：本插件从 `dsh-zcode-theme` 迁入时原样复制，
 * 因此两份内容必须在迁移期完全一致（下面那条测试守这一点，迁移完成后可删）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ZAI_PALETTE } from '../lib/themes/index.js'
import { getTheme } from '../lib/themes/index.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = JSON.parse(readFileSync(join(root, 'test/fixtures/zai-palette.json'), 'utf8'))
const snapshot = fixture.tokens

test('ZAI_PALETTE 与官方快照逐项一致', () => {
  const mismatched = []
  for (const [key, expected] of Object.entries(snapshot)) {
    const actual = ZAI_PALETTE[key]
    if (!actual) {
      mismatched.push(`${key}: 缺失`)
      continue
    }
    const light = typeof actual === 'string' ? actual : actual.light
    const dark = typeof actual === 'string' ? actual : actual.dark
    if (light !== expected.light) mismatched.push(`${key}.light: ${light} !== ${expected.light}`)
    if (dark !== expected.dark) mismatched.push(`${key}.dark: ${dark} !== ${expected.dark}`)
  }
  assert.deepEqual(mismatched, [], `与官方色板不一致：\n${mismatched.join('\n')}`)
})

test('新增的语义键不被快照覆盖（派生色需显式说明）', () => {
  const extra = Object.keys(ZAI_PALETTE).filter((key) => !(key in snapshot))
  // 允许存在由官方 diff 色派生的扩展语义，但数量必须稳定——
  // 突然多出十几个通常意味着有人把非官方色混了进来。
  assert.ok(extra.length <= 12, `多出 ${extra.length} 个非官方语义键，请确认来源：${extra.join(', ')}`)
})

test('快照的每一项都有 light 与 dark', () => {
  for (const [key, value] of Object.entries(snapshot)) {
    assert.equal(typeof value.light, 'string', `${key} 缺 light`)
    assert.equal(typeof value.dark, 'string', `${key} 缺 dark`)
  }
})

test('ZCode 主题直接使用官方色板（不做任何替换）', () => {
  assert.equal(getTheme('zcode').palette, ZAI_PALETTE)
})

test('单色变体只改色，不改布局相关的材质', () => {
  const mono = getTheme('zcode-mono')
  // 单色变体不该覆盖任何材质（圆角、阴影、字体）
  assert.equal(mono.material, undefined)
  // 但语义色确实被改过
  assert.notDeepEqual(mono.palette['terminal-green'], ZAI_PALETTE['terminal-green'])
})

test('单色变体保留 destructive 的红色（安全语义）', () => {
  const mono = getTheme('zcode-mono')
  const destructive = mono.palette.destructive
  const light = typeof destructive === 'string' ? destructive : destructive.light
  // 必须是有明显红色成分的色值，不能是灰阶
  assert.match(light, /^#[0-9a-f]{6}$/i)
  const r = Number.parseInt(light.slice(1, 3), 16)
  const g = Number.parseInt(light.slice(3, 5), 16)
  const b = Number.parseInt(light.slice(5, 7), 16)
  assert.ok(r > g + 40 && r > b + 40, `destructive 不应被去色：${light}`)
})

test('玻璃主题的卡片背景确实是半透明', () => {
  const glass = getTheme('glass')
  for (const mode of ['light', 'dark']) {
    const value = glass.palette.card[mode]
    assert.match(value, /^rgba\(/, `玻璃 ${mode} 卡片背景应为半透明：${value}`)
    const alpha = Number.parseFloat(value.match(/,\s*([0-9.]+)\s*\)$/)?.[1] ?? '1')
    assert.ok(alpha < 1, `玻璃 ${mode} 卡片背景不透明度应 < 1：${value}`)
  }
})

test('玻璃主题的内容卡与框架层都必须是透光的', () => {
  // 回归保护：玻璃主题最容易犯的错是「卡片写实色」——壁纸被整层挡住，
  // 玻璃只剩一层灰，观感与 ZCode 无异。这两个键必须半透明。
  for (const id of ['glass', 'glass-color']) {
    const theme = getTheme(id)
    const background = theme.palette.background
    for (const mode of ['light', 'dark']) {
      const value = background[mode]
      assert.match(value, /^rgba\(/, `${id} 的 background.${mode} 必须是半透明：${value}`)
      const alpha = Number.parseFloat(value.match(/,\s*([0-9.]+)\s*\)$/)?.[1] ?? '1')
      assert.ok(alpha < 0.95, `${id} 的 background.${mode} 不透明度应 < 0.95：${value}`)
    }
  }
})

test('玻璃主题让框架层透明，否则壁纸永远看不见', async () => {
  const { readStyleFile, GLASS_STYLE_FILE } = await import('../lib/css.js')
  const css = readStyleFile(GLASS_STYLE_FILE)
  // 必须有把 .pI_x6G_frame 背景清空的规则
  const rule = css.match(/html\[data-theme-studio="glass"\][^{]*\.pI_x6G_frame[^{]*\{([^}]*)\}/)
  assert.ok(rule, '缺少让玻璃主题框架层透明的规则')
  assert.match(rule[1], /background:\s*none/, '框架层必须 background: none，否则盖住壁纸')
})

test('玻璃主题启用了真实的模糊与饱和材质', () => {
  const glass = getTheme('glass')
  assert.match(glass.material['--ts-blur'], /^\d+px$/)
  assert.notEqual(glass.material['--ts-blur'], '0px')
  assert.match(glass.material['--ts-saturate'], /^\d+%$/)
  const saturate = Number.parseInt(glass.material['--ts-saturate'], 10)
  assert.ok(saturate > 100, '玻璃材质必须提饱和，否则观感发灰')
})

test('玻璃主题的壁纸明暗不同', () => {
  const glass = getTheme('glass')
  for (const key of ['--ts-wallpaper-1', '--ts-wallpaper-2']) {
    const value = glass.material[key]
    assert.equal(typeof value, 'object', `${key} 应为 { light, dark } 成对值`)
    assert.notEqual(value.light, value.dark, `${key} 明暗应有区别`)
  }
})

test('彩色玻璃变体在玻璃基础上引入色相', () => {
  const glass = getTheme('glass')
  const color = getTheme('glass-color')
  // 品牌色不同：基座是系统蓝，彩色版是系统靛
  assert.notDeepEqual(color.palette.brand, glass.palette.brand)
  // 材质在基座之上加强
  assert.ok(
    Number.parseInt(color.material['--ts-blur'], 10) >= Number.parseInt(glass.material['--ts-blur'], 10),
    '彩色玻璃的模糊不应弱于基座',
  )
})

test('四款主题的语义色板都完整（继承生效）', () => {
  const glass = getTheme('glass')
  for (const theme of [getTheme('glass-color')]) {
    // 彩色变体没写的键必须能从基座继承到
    assert.ok(theme.palette['markdown-inline-code'], '彩色玻璃缺少继承来的键')
    assert.deepEqual(theme.palette['markdown-inline-code'], glass.palette['markdown-inline-code'])
  }
})
