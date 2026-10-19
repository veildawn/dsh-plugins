import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ZAI_PALETTE } from '../lib/tokens.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const snapshot = JSON.parse(readFileSync(join(root, 'test/fixtures/zai-palette.json'), 'utf8'))

/** 由官方 diff 色派生的宿主扩展语义：不在官方 CSS 里，但必须可追溯到官方值。 */
const DERIVED = [
  'bg-document-selection',
  'code-diff-added',
  'code-diff-deleted',
  'file-diff-added-bg',
  'file-diff-added-gutter',
  'file-diff-added-marker',
  'file-diff-deleted-bg',
  'file-diff-deleted-gutter',
  'file-diff-deleted-marker',
]

test('ZAI_PALETTE 与官方快照逐值一致', () => {
  for (const [key, modes] of Object.entries(snapshot.tokens)) {
    const actual = ZAI_PALETTE[key]
    assert.ok(actual !== undefined, `ZAI_PALETTE 缺少官方 Token --color-${key}`)
    assert.equal(actual.light, modes.light, `--color-${key} 亮色值与官方不一致`)
    assert.equal(actual.dark, modes.dark, `--color-${key} 暗色值与官方不一致`)
  }
})

test('ZAI_PALETTE 不包含快照与派生清单之外的来源不明色', () => {
  for (const key of Object.keys(ZAI_PALETTE)) {
    const known = key in snapshot.tokens || DERIVED.includes(key)
    assert.equal(known, true, `--color-${key} 既不在官方快照里也不在派生清单里`)
  }
})

test('派生 Token 全部由官方 diff 色派生', () => {
  const added = (mode) => snapshot.tokens['diff-added'][mode]
  const removed = (mode) => snapshot.tokens['diff-removed'][mode]

  for (const mode of ['light', 'dark']) {
    // 标记色必须等于官方 diff 色本身
    assert.equal(ZAI_PALETTE['file-diff-added-marker'][mode], added(mode))
    assert.equal(ZAI_PALETTE['file-diff-deleted-marker'][mode], removed(mode))

    // 其余派生项必须是「官方 diff 色 + color-mix」的形式，不允许写死无关色值
    for (const key of ['code-diff-added', 'file-diff-added-bg', 'file-diff-added-gutter']) {
      const value = ZAI_PALETTE[key][mode]
      assert.match(value, /^color-mix\(in srgb, /, `${key}.${mode} 不是 color-mix 派生`)
      assert.ok(value.includes(added(mode)), `${key}.${mode} 未引用官方 diff-added 色`)
    }
    for (const key of ['code-diff-deleted', 'file-diff-deleted-bg', 'file-diff-deleted-gutter']) {
      const value = ZAI_PALETTE[key][mode]
      assert.match(value, /^color-mix\(in srgb, /, `${key}.${mode} 不是 color-mix 派生`)
      assert.ok(value.includes(removed(mode)), `${key}.${mode} 未引用官方 diff-removed 色`)
    }
  }
})

test('快照本身覆盖官方全部关键 Token 组', () => {
  const names = Object.keys(snapshot.tokens)
  const groups = {
    terminal: /^terminal-/,
    trajectory: /^trajectory-/,
    mention: /-(node|node-hover|node-foreground)$/,
    diff: /^(diff-|file-diff-|code-diff-)/,
    git: /^git-/,
    usage: /^(usage-chart-|context-breakdown-|usage-heatmap-)/,
  }
  const minimums = {
    terminal: 22,
    trajectory: 5,
    mention: 18,
    diff: 4,
    git: 8,
    usage: 18,
  }
  for (const [group, re] of Object.entries(groups)) {
    const matched = names.filter((n) => re.test(n))
    assert.ok(
      matched.length >= minimums[group],
      `${group} 组只有 ${matched.length} 项，官方至少 ${minimums[group]} 项`,
    )
  }
})
