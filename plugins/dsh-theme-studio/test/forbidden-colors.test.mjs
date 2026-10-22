/**
 * 禁用色与禁用 Token 残留测试。
 *
 * 两类历史事故的回归保护：
 *
 *   - **废弃品牌色回流**：ZCode 早期自拟过暖橙红 `#E85D3A` 系，后来对齐官方
 *     单色体系后删掉了。这份测试确保它不会从某个新主题里偷偷回来。
 *   - **引用宿主不存在的 Token**：宿主从未定义 `--dsw-alias-bg-inverse` /
 *     `--dsw-alias-label-inverse`，引用了就永远取不到值，表现是「局部没有颜色」。
 *
 * 扫描范围是**全部产物**（样式表、生成器、客户端、装配后的完整 CSS），
 * 而不只是手写的 CSS——生成器里拼出来的字符串同样会进页面。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  FORBIDDEN_COLORS,
  FORBIDDEN_HOST_TOKENS,
  HOST_TOKEN_MAP,
} from '../lib/tokens.js'
import { ALL_STYLE_FILES, fullThemeCss } from '../lib/css.js'
import { BUILTIN_THEMES } from '../lib/themes/index.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 收集全部产物源码。 */
async function collectSources() {
  const files = [
    'lib/css.js',
    'lib/index.js',
    'lib/client.js',
    'lib/settings.js',
    'lib/themes/index.js',
    'lib/themes/zai-palette.js',
    'lib/themes/glass-palette.js',
    'lib/themes/glass-color-palette.js',
    'lib/themes/zcode-mono-palette.js',
    'lib/themes/inherit.js',
    ...[...ALL_STYLE_FILES].map((name) => `lib/styles/${name}`),
  ]
  const texts = []
  for (const file of files) texts.push(await readFile(join(root, file), 'utf8'))
  // 装配后的完整产物（最能代表用户实际拿到的东西）
  texts.push(fullThemeCss('zcode'))
  // 黑名单字面量与它的排坑说明本身不算「残留」：说明文字与数组元素里必然
  // 出现那些色值 / Token 名。逐行剔除「提到任一条目」的行，比写复杂正则更稳。
  const tokensSource = await readFile(join(root, 'lib/tokens.js'), 'utf8')
  const banned = [...FORBIDDEN_HOST_TOKENS, ...FORBIDDEN_COLORS]
  const scrubbed = tokensSource
    .split('\n')
    .filter((line) => !banned.some((entry) => line.includes(entry)))
    .join('\n')
  texts.push(scrubbed)
  return texts.join('\n')
}

test('主题产物不含宿主默认蓝与已废弃的暖橙红', async () => {
  const source = await collectSources()
  for (const color of FORBIDDEN_COLORS) {
    assert.equal(source.includes(color), false, `残留 ${color}`)
  }
})

test('主题产物不引用宿主不存在的 Token', async () => {
  const source = await collectSources()
  for (const token of FORBIDDEN_HOST_TOKENS) {
    assert.equal(source.includes(token), false, `引用了禁止 Token ${token}`)
  }
})

test('HOST_TOKEN_MAP 不含禁止色与禁止 Token', () => {
  const blob = JSON.stringify(HOST_TOKEN_MAP)
  for (const color of FORBIDDEN_COLORS) assert.equal(blob.includes(color), false)
  for (const token of FORBIDDEN_HOST_TOKENS) {
    assert.equal(Object.hasOwn(HOST_TOKEN_MAP, token), false)
  }
})

test('四款主题的色板都不含废弃暖橙红', () => {
  for (const theme of BUILTIN_THEMES) {
    const blob = JSON.stringify(theme.palette).toUpperCase()
    for (const banned of ['#E85D3A', '#F06A48', '#D14F2E', '#F06A35']) {
      assert.equal(blob.includes(banned), false, `主题 ${theme.id} 残留 ${banned}`)
    }
  }
})

test('styles 目录与清单严格一致', async () => {
  const names = (await readdir(join(root, 'lib/styles'))).filter((name) => name.endsWith('.css')).sort()
  const expected = [...ALL_STYLE_FILES].sort()
  assert.deepEqual(names, expected, 'styles 目录与 ALL_STYLE_FILES 不一致')
})

test('不把移动端 / 桌面端样式拆成独立文件（由 dsh-mobile-adapter 承担）', async () => {
  const names = (await readdir(join(root, 'lib/styles'))).filter((name) => name.endsWith('.css'))
  assert.equal(names.includes('mobile.css'), false)
  assert.equal(names.includes('desktop.css'), false)
})
