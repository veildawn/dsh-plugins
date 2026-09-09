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
import { STYLE_FILES, loadThemeCss } from '../lib/css.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

async function collectSources() {
  // 扫描主题 CSS / 生成 CSS / 客户端与宿主实现。tokens.js 里的黑名单字面量本身不计入残留。
  const files = [
    'lib/css.js',
    'lib/index.js',
    'lib/client.js',
    ...STYLE_FILES.map((name) => `lib/styles/${name}`),
  ]
  const texts = []
  for (const file of files) {
    texts.push(await readFile(join(root, file), 'utf8'))
  }
  texts.push(loadThemeCss())
  const tokenMap = await readFile(join(root, 'lib/tokens.js'), 'utf8')
  texts.push(tokenMap.replace(/export const FORBIDDEN[\s\S]*?^]/gm, ''))
  return texts.join('\n')
}

test('主题产物不含宿主默认蓝色', async () => {
  const source = await collectSources()
  for (const color of FORBIDDEN_COLORS) {
    assert.equal(source.includes(color), false, `残留 ${color}`)
  }
})

test('主题产物不引用不存在的宿主 Token', async () => {
  const source = await collectSources()
  for (const token of FORBIDDEN_HOST_TOKENS) {
    assert.equal(source.includes(token), false, `引用了禁止 Token ${token}`)
  }
})

test('HOST_TOKEN_MAP 自身不含禁止色与禁止 Token', () => {
  const blob = JSON.stringify(HOST_TOKEN_MAP)
  for (const color of FORBIDDEN_COLORS) assert.equal(blob.includes(color), false)
  for (const token of FORBIDDEN_HOST_TOKENS) {
    assert.equal(Object.hasOwn(HOST_TOKEN_MAP, token), false)
  }
})

test('styles 目录只有规范列出的 CSS 文件', async () => {
  const names = (await readdir(join(root, 'lib/styles'))).filter((name) => name.endsWith('.css')).sort()
  assert.deepEqual(names, [...STYLE_FILES].sort())
  assert.equal(names.includes('mobile.css'), false)
  assert.equal(names.includes('desktop.css'), false)
})
