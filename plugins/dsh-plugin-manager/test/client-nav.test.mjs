/**
 * 设置导航图标的回归测试。
 *
 * 宿主 0.2.x 的导航行是 `<button><span class=navIcon>{默认图标}</span><span
 * class=navLabel>{label}</span></button>`，而 0.1.x 是 `<button><svg/>{label}
 * </button>`。旧代码把自绘图标塞进 label，再用
 * `button:has([data-settings-nav-label="…"]) > svg:first-child{display:none}`
 * 隐藏宿主的默认 svg —— 结构一改，第一条选择器不再命中，默认图标和 label 内的
 * 图标同时出现，导航行变成两个齿轮。
 *
 * 现在的契约：图形只走 `settings.section.icon`，label 只承载文本。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

let definition
const previousWindow = globalThis.window
globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
await import('../lib/client.js')
globalThis.window = previousWindow
assert.ok(definition, '客户端 bundle 没有调用 __ModuleLoader__.load')

test('设置导航图标走 settings.section.icon，label 只放文本', () => {
  const client = definition.factory((id) => {
    if (id === 'react') {
      return {
        Fragment: Symbol('Fragment'),
        createElement: () => null,
        useState: () => [null, () => {}],
        useEffect: () => {},
        useRef: () => ({ current: null }),
      }
    }
    // 本包对 react-dom 是 try/catch 的可选依赖
    throw new Error(`未预期的依赖：${id}`)
  })

  const registrations = []
  const ctx = {
    connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
    slots: {
      inject(name, install) {
        assert.ok(
          ['settings.section', 'settings.section.icon'].includes(name),
          `未预期的槽位：${name}`,
        )
        return install()
      },
      register(entry, component) {
        registrations.push({ entry, component })
        return () => {}
      },
    },
  }

  assert.doesNotThrow(() => client.apply(ctx))

  const section = registrations.find(({ entry }) => entry.name === 'settings.section')
  assert.ok(section, '必须注册设置分区')
  assert.equal(section.entry.id, 'plugin-manager')
  assert.equal(section.entry.label(), '插件管理', 'label 只能是文本')

  const icon = registrations.find(({ entry }) => entry.name === 'settings.section.icon')
  assert.ok(icon, '必须注册 settings.section.icon 导航图标')
  assert.equal(icon.entry.id, 'plugin-manager', '图标 id 必须与分区 id 一致')
  assert.equal(typeof icon.component, 'function')
})
