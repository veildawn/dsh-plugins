/**
 * 兼容薄壳客户端测试。
 *
 * 关键契约是**让位**：如果主题工作室在场（`html` 上有 `data-theme-studio`），
 * 薄壳不得再写 `data-dsh-theme`，否则用户切到玻璃主题后旧属性仍指向 zcode，
 * 仍在读旧属性的消费者（移动端适配器等）会拿到错误的主题标识。
 *
 * 另一条是**不再调用 overrideTokens**：那是旧版与主题工作室冲突的根源。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

let definition
const previousWindow = globalThis.window
globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
await import('../lib/client.js')
globalThis.window = previousWindow

const client = definition.factory()

/** 构造一个最小的 documentElement 替身。 */
function fakeDocument(initial = {}) {
  const attrs = new Map(Object.entries(initial))
  return {
    attrs,
    documentElement: {
      hasAttribute: (name) => attrs.has(name),
      getAttribute: (name) => attrs.get(name) ?? null,
      setAttribute: (name, value) => attrs.set(name, value),
      removeAttribute: (name) => attrs.delete(name),
    },
  }
}

test('bundle 注册正确的 id 与注入列表', () => {
  assert.equal(definition.id, '@weniatall/dsh-zcode-theme')
  assert.deepEqual(client.inject, [])
})

test('工作室不在场时写旧属性', () => {
  const doc = fakeDocument()
  client.internals.applyScope(doc)
  assert.equal(doc.attrs.get('data-dsh-theme'), 'zcode')
})

test('工作室在场时让位（不写旧属性）', () => {
  const doc = fakeDocument({ 'data-theme-studio': 'glass' })
  client.internals.applyScope(doc)
  assert.equal(doc.attrs.has('data-dsh-theme'), false, '薄壳不应覆盖工作室管理的属性')
})

test('还原函数恢复原有属性值', () => {
  const doc = fakeDocument({ 'data-dsh-theme': 'something-else' })
  const restore = client.internals.applyScope(doc)
  assert.equal(doc.attrs.get('data-dsh-theme'), 'zcode')
  restore()
  assert.equal(doc.attrs.get('data-dsh-theme'), 'something-else')
})

test('原本没有属性时，还原会删掉它', () => {
  const doc = fakeDocument()
  const restore = client.internals.applyScope(doc)
  restore()
  assert.equal(doc.attrs.has('data-dsh-theme'), false)
})

test('shouldDefer 只看 data-theme-studio', () => {
  assert.equal(client.internals.shouldDefer(fakeDocument()), false)
  assert.equal(client.internals.shouldDefer(fakeDocument({ 'data-theme-studio': 'zcode' })), true)
  assert.equal(client.internals.shouldDefer(undefined), false)
})

test('不再调用 ctx.theme.overrideTokens（与工作室冲突的根源）', () => {
  const calls = []
  const ctx = {
    effect: (fn) => fn(),
    theme: {
      overrideTokens: (...args) => {
        calls.push(args)
        return () => {}
      },
    },
  }
  client.apply(ctx)
  assert.equal(calls.length, 0, '薄壳不应再注册 token 覆盖层')
})

test('mount 返回可释放的函数', () => {
  const ctx = { effect: (fn) => fn(), theme: { overrideTokens: () => () => {} } }
  assert.doesNotThrow(() => client.apply(ctx))
})
