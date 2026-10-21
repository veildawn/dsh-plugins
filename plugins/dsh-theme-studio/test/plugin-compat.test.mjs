/**
 * 插件兼容性测试——需求「统一 Token，对仓库内所有插件兼容」的落地保证。
 *
 * 做法：**扫描仓库内每个插件真实引用的 `--dsw-*` 变量名**，逐个检查主题是否
 * 提供了定义。这条测试的价值在于它跟随仓库演进——新插件引入新的别名、
 * 或者有人把 `var(--dsw-xxx)` 换成另一个宿主不存在的名字时，这里先失败，
 * 而不是等到用户看见「主题没覆盖到某个面板」。
 *
 * 为什么不能只看「宿主定义了哪些 Token」：仓库里的插件大量引用
 * `--dsw-alias-border-default`、`--dsw-alias-background-base` 这类
 * **宿主从未定义**的别名，写法是 `var(--dsw-alias-border-default, var(--dsw-alias-border-l2))`。
 * 宿主没有该变量时插件只能回落到 fallback（有些 fallback 直接是 `#fff`），
 * 主题就管不到它。本插件显式定义这些别名，插件的所有表面才会跟随主题。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { HOST_TOKEN_MAP, MATERIAL_DEFAULTS, MATERIAL_KEYS } from '../lib/tokens.js'
import { STYLE_FILES, GLASS_STYLE_FILE, readStyleFile } from '../lib/css.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pluginsDir = join(root, '..')

/** 本插件自己的目录名：扫描时要排除，避免自我满足。 */
const SELF = 'dsh-theme-studio'

/** 收集仓库内所有插件客户端源码引用到的宿主变量。 */
function collectPluginTokenRefs() {
  const refs = new Map()
  for (const name of readdirSync(pluginsDir)) {
    if (name === SELF || name.startsWith('.')) continue
    const libDir = join(pluginsDir, name, 'lib')
    if (!existsSync(libDir) || !statSync(libDir).isDirectory()) continue
    for (const file of readdirSync(libDir)) {
      if (!file.endsWith('.js')) continue
      const text = readFileSync(join(libDir, file), 'utf8')
      for (const match of text.matchAll(/var\((--dsw-[a-zA-Z0-9-]+)/g)) {
        if (!refs.has(match[1])) refs.set(match[1], new Set())
        refs.get(match[1]).add(`${name}/${file}`)
      }
    }
    // 插件可能把样式放在子目录里
    for (const sub of readdirSync(libDir)) {
      const subDir = join(libDir, sub)
      if (!statSync(subDir).isDirectory()) continue
      for (const file of readdirSync(subDir)) {
        if (!file.endsWith('.css')) continue
        const text = readFileSync(join(subDir, file), 'utf8')
        for (const match of text.matchAll(/var\((--dsw-[a-zA-Z0-9-]+)/g)) {
          if (!refs.has(match[1])) refs.set(match[1], new Set())
          refs.get(match[1]).add(`${name}/lib/${sub}/${file}`)
        }
      }
    }
  }
  return refs
}

const pluginRefs = collectPluginTokenRefs()

test('仓库里能扫到插件引用的宿主变量（防止扫描器失效导致假通过）', () => {
  assert.ok(pluginRefs.size > 20, `只扫到 ${pluginRefs.size} 个变量，扫描器可能失效`)
})

test('插件引用的每一个 --dsw-* 变量都由主题定义', () => {
  const missing = []
  for (const [token, sources] of pluginRefs) {
    if (token in HOST_TOKEN_MAP) continue
    if (token in MATERIAL_DEFAULTS) continue
    missing.push(`${token}  ← ${[...sources].sort().join(', ')}`)
  }
  assert.deepEqual(
    missing,
    [],
    `以下宿主变量被插件引用但主题没有定义，对应界面不会跟随主题：\n${missing.join('\n')}`,
  )
})

test('插件引用的变量不会落到禁止名单里', () => {
  // 反向保护：如果某个插件引用了宿主不存在的 inverse Token，我们要知道自己
  // 没有映射它（而不是悄悄补一个不存在的值）。
  const forbidden = ['--dsw-alias-bg-inverse', '--dsw-alias-label-inverse']
  for (const token of forbidden) {
    assert.equal(token in HOST_TOKEN_MAP, false)
  }
})

test('主题 CSS 只引用已定义的宿主变量与材质变量', () => {
  const sources = [...STYLE_FILES, GLASS_STYLE_FILE].map((name) => ({
    name,
    text: readStyleFile(name),
  }))
  const unknown = []
  for (const { name, text } of sources) {
    for (const match of text.matchAll(/var\((--(?:dsw|ds|ts)-[a-zA-Z0-9-]+)/g)) {
      const token = match[1]
      if (token in HOST_TOKEN_MAP) continue
      if (token in MATERIAL_DEFAULTS) continue
      if (token.startsWith('--color-')) continue
      if (token.startsWith('--dsh-')) continue // 宿主按运行时写入的变量
      if (token.startsWith('--shiki-')) continue // Shiki 自己的变量
      unknown.push(`${name}: ${token}`)
    }
  }
  assert.deepEqual([...new Set(unknown)], [], `主题 CSS 引用了未定义的变量：\n${[...new Set(unknown)].join('\n')}`)
})

test('主题 CSS 引用的 --color-* 键在每款主题色板中都存在', async () => {
  const { BUILTIN_THEMES } = await import('../lib/themes/index.js')
  const sources = [...STYLE_FILES, GLASS_STYLE_FILE].map(readStyleFile)
  const referenced = new Set()
  for (const text of sources) {
    for (const match of text.matchAll(/var\(--color-([a-z0-9-]+)/g)) referenced.add(match[1])
  }
  assert.ok(referenced.size > 20, `只引用到 ${referenced.size} 个语义色，可能是正则失效`)

  for (const theme of BUILTIN_THEMES) {
    if (theme.id === 'none') continue
    const missing = [...referenced].filter((key) => !(key in theme.palette))
    assert.deepEqual(missing, [], `主题 ${theme.id} 缺少被 CSS 引用的语义色：${missing.join(', ')}`)
  }
})

test('材质键清单与默认材质保持一致', () => {
  assert.deepEqual([...MATERIAL_KEYS].sort(), Object.keys(MATERIAL_DEFAULTS).sort())
})

test('玻璃材质层被装配进每一款主题的 CSS', async () => {
  const { composeThemeCss } = await import('../lib/css.js')
  const glassCss = readStyleFile(GLASS_STYLE_FILE)
  const marker = 'backdrop-filter: blur(var(--ts-blur))'
  assert.ok(glassCss.includes(marker), '玻璃样式表缺少核心 backdrop-filter 规则')
  for (const id of ['zcode', 'zcode-mono', 'glass', 'glass-color']) {
    assert.ok(composeThemeCss(id).includes(marker), `${id} 的产物里缺玻璃材质层`)
  }
})
