/**
 * 设置导航「双图标」回归测试：插件用 CSS 藏掉外壳的默认图标。
 *
 * 外壳（0.2.x）的导航行是 `<button class="…_navCell"><span class="…_navIcon">
 * {默认齿轮}</span><span class="…_navLabel">{label}</span></button>`：`span.navIcon`
 * 永远渲染默认齿轮，`settings.section.icon` 又是 list 槽位，注册的图形只能被
 * **追加**在齿轮后面，于是每行两个图标。插件无法替换默认图标，只能自己注入一条
 * 规则把 `.navIcon` 藏起来、只留自绘的那个。
 *
 * 这里锁定三件事：
 * 1. 每个候选插件都在 `apply()` 期间注入这条样式（不是只在设置面板挂载时）；
 * 2. 规则带 `!important`，能压过外壳 `.VOzbGW_navIcon{display:flex}`（特异性 0,1,0）；
 * 3. 规则同时覆盖外壳固化的 `VOzbGW_*` 类名和其他构建的哈希 `_navIcon` 类名，
 *    且多条风格选择器指向同一份样式 id（后加载的插件不会重复插入）。
 *
 * 断言的是「渲染时确实会生效」，而不只是「源码里出现了这段字符串」。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const PLUGINS = [
  'dsh-ai-proxy',
  'dsh-theme-studio',
  'dsh-repo-wiki',
  'dsh-plugin-manager',
  'dsh-model-roles',
]

/** 极简 DOM 替身：只要 `getElementById` / `createElement` / `head.appendChild`。 */
function installFakeDocument() {
  const nodes = new Map()
  let created = 0
  const head = {
    children: [],
    appendChild(node) {
      head.children.push(node)
      nodes.set(node.id, node)
      return node
    },
  }
  const document = {
    head,
    getElementById(id) {
      return nodes.get(id) ?? null
    },
    createElement(tag) {
      created += 1
      return { tag, id: '', textContent: '', setAttribute() {} }
    },
  }
  return { document, nodes, created: () => created }
}

let loaded = 0

/**
 * 载入一个插件的客户端 bundle，并执行它的 `apply(ctx)`。
 * @param {string} name 插件目录名
 * @param {{document: object}} [shared] 复用的文档替身；省略则新建一个空文档
 */
async function applyPlugin(name, shared) {
  let definition
  const previousWindow = globalThis.window
  globalThis.window = {
    __ModuleLoader__: {
      load(value) {
        definition = value
      },
    },
  }
  try {
    // 每个插件是独立 bundle，测试进程里只求值一次；用查询串避开 ESM 模块缓存。
    await import(`../plugins/${name}/lib/client.js?case=${name}-${(loaded += 1)}`)
  } finally {
    globalThis.window = previousWindow
  }
  assert.ok(definition, `${name}: bundle 没有调用 __ModuleLoader__.load`)

  let plugin
  const previous = {
    document: globalThis.document,
    navigator: globalThis.navigator,
  }
  const fake = shared ?? installFakeDocument()
  globalThis.document = fake.document
  Object.defineProperty(globalThis, 'navigator', {
    value: { language: 'zh-CN', languages: ['zh-CN'] },
    configurable: true,
  })
  try {
    plugin = definition.factory((id) => {
      if (id === 'react') {
        return {
          Fragment: Symbol('Fragment'),
          createElement: () => null,
          useState: (initial) => [initial, () => {}],
          useEffect: () => {},
          useRef: () => ({ current: null }),
          useMemo: (factory) => factory(),
          useCallback: (factory) => factory,
          useContext: () => ({}),
        }
      }
      if (id === 'react-dom') return { createPortal: (node) => node }
      // 其余宿主模块（primitives 等）都由 usage 处的 try/catch 兜底。
      throw new Error(`unexpected dependency: ${id}`)
    })
    const noop = () => {}
    const ctx = {
      get: (key) => (key === 'locale' ? undefined : undefined),
      effect: noop,
      connection: {
        rpc: { call: async () => ({ ok: true, value: {} }) },
        api: { settings: {}, llm: {} },
      },
      remote: { $on: () => noop, session: { modelCatalog: async () => ({ ok: true, value: { groups: [], failures: [] } }) } },
      slots: {
        inject: (_name, install) => install(),
        register: () => noop,
      },
      logger: () => ({ warn: noop, info: noop, debug: noop, error: noop }),
    }
    plugin.apply(ctx)
  } finally {
    if (previous.document === undefined) delete globalThis.document
    else globalThis.document = previous.document
    Object.defineProperty(globalThis, 'navigator', { value: previous.navigator, configurable: true })
  }
  return fake
}

function hideIconCss(fake) {
  const style = fake.nodes.get('dsh-settings-nav-default-icon')
  assert.ok(style, '必须注入 dsh-settings-nav-default-icon 样式')
  return style.textContent
}

for (const name of PLUGINS) {
  test(`${name}: 注入的规则能压过外壳默认图标`, async () => {
    const fake = await applyPlugin(name)
    const css = hideIconCss(fake)

    // 1. 同时覆盖外壳固化的类名与其他构建的哈希类名。
    assert.match(css, /\.VOzbGW_navIcon/, '必须覆盖外壳固化的 .VOzbGW_navIcon')
    assert.match(css, /\[class\*='?_navIcon'?\]/, '必须覆盖其他构建的哈希 _navIcon 类名')

    // 2. 外壳写的是 `.VOzbGW_navIcon{display:flex}`（特异性 0,1,0），
    //    没有 !important 的 display 声明赢不了它，图标会继续显示。
    const rules = css.split('}').filter((rule) => rule.trim() !== '')
    assert.ok(rules.length > 0)
    for (const rule of rules) {
      assert.match(rule, /display\s*:\s*none\s*!important/u, `每条规则都必须 display:none!important：${rule}}`)
      // 3. 选择器自身特异性不能低于外壳的 0,1,0，`!important` 才有意义。
      const selector = rule.split('{')[0]
      assert.match(selector, /_navCell/u, '必须用导航行作为上下文，避免误伤其他图标')
    }
  })
}

test('样式 id 统一，多个插件不会各插一份', async () => {
  // 同一份文档里先后 mount 所有插件，样式节点只能有一个，内容也必须一致。
  const fake = installFakeDocument()
  const previousDocument = globalThis.document
  globalThis.document = fake.document
  try {
    for (const name of PLUGINS) await applyPlugin(name, fake)
    const navStyles = fake.document.head.children.filter((node) => node.id === 'dsh-settings-nav-default-icon')
    assert.equal(navStyles.length, 1, '隐藏默认图标的样式只允许一个节点')
    for (const node of fake.document.head.children) {
      assert.equal(
        node.textContent.includes('.VOzbGW_navIcon'),
        node.id === 'dsh-settings-nav-default-icon',
        `只有 dsh-settings-nav-default-icon 能携带该规则，实际来自 ${node.id}`,
      )
    }
    const css = hideIconCss(fake)
    for (const name of PLUGINS) {
      assert.match(css, /\.VOzbGW_navIcon/u, `${name} 写入的规则被覆盖了`)
    }
  } finally {
    globalThis.document = previousDocument
  }
})

test('客户端 bundle 里真的调用了注入函数', async () => {
  for (const name of PLUGINS) {
    const source = await readFile(new URL(`../plugins/${name}/lib/client.js`, import.meta.url), 'utf8')
    const expected = name === 'dsh-repo-wiki'
      // repo-wiki 的样式统一由 ensureStyles() 注入，apply() 开头就调用它。
      ? /function ensureStyles\(\)\s*\{\s*(?:if \([^)]*\) return;?\s*)?hideDefaultNavIcon\(\)/u
      : /function apply\(ctx\)\s*\{\s*hideDefaultNavIcon\(\)/u
    assert.match(source, expected, `${name}: apply() 期间必须立即注入隐藏规则`)
  }
})
