/**
 * 极简 React 测试驱动。
 *
 * client.js 是给浏览器用的 `window.__ModuleLoader__` 模块，依赖 React hooks。
 * Node 下没有 DOM 也没有 React 运行时，所以这里实现一份**语义足够**的替身：
 *
 *  - `useState` / `useCallback` / `useRef` / `useMemo` / `useEffect` 按调用顺序存放；
 *  - `setState` 只标脏，由统一的 `run()` 重渲染（接近 React 的批处理）；
 *  - `createElement` 产出普通对象树，可直接遍历断言。
 *
 * 目的不是复刻 React，而是让「输入 → RPC → 渲染结果」这条链路能在单测里真正
 * 跑一遍。渲染次数设了上限，状态写错时会明确报错而不是挂死。
 */

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_PATH = path.join(__dirname, '..', 'lib', 'client.js')

/** 单次挂载期间使用的 hook 实现，由 mount() 注入。 */
const hookBridge = {
  use: {},
}

/** 构造 React 替身：hook 都是转调，指向当前挂载的实例。 */
function createReact() {
  const react = {
    createElement: (type, props, ...children) => ({
      type,
      props: {
        ...(props || {}),
        children: children
          .flat(Infinity)
          .filter((item) => item === 0 || (item !== null && item !== undefined && item !== false && item !== '')),
      },
    }),
    Fragment: Symbol('Fragment'),
  }
  for (const name of ['useState', 'useCallback', 'useRef', 'useMemo', 'useEffect']) {
    react[name] = (...args) => hookBridge.use[name](...args)
  }
  return react
}

/**
 * 在沙箱里加载 client.js，取出设置页组件。
 * @returns {{exports: object, SystemPromptEditor: Function, source: string, react: object}} 模块与组件。
 */
export function loadClientModule() {
  const source = fs.readFileSync(CLIENT_PATH, 'utf8')
  const react = createReact()
  let captured = null

  // client.js 顶部直接调用 window.__ModuleLoader__.load，必须先造出 window。
  const localWindow = {
    __ModuleLoader__: {
      load(spec) {
        captured = spec
      },
    },
  }

  const sandbox = {
    get window() {
      return globalThis.window ? Object.assign(globalThis.window, localWindow) : localWindow
    },
    get document() {
      return globalThis.document
    },
    get navigator() {
      return globalThis.navigator
    },
    console,
    setTimeout,
    clearTimeout,
    Promise,
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })

  if (captured === null) throw new Error('client.js 没有调用 __ModuleLoader__.load')
  if (captured.id !== '@weniatall/dsh-system-prompt-editor') {
    throw new Error(`模块 id 不符：${captured.id}`)
  }

  const exports = captured.factory((name) => {
    if (name === 'react') return react
    throw new Error(`测试环境不支持 require('${name}')`)
  })

  // 只记录注册参数的 slots 替身，用来把组件抓出来。
  let registered = null
  exports.apply({
    slots: {
      inject(slot, fn) {
        fn()
        return { slot }
      },
      register(options, component) {
        registered = component
        return { id: options.id }
      },
    },
    connection: { rpc: { call: async () => ({ ok: false, error: { message: '未连接' } }) } },
  })

  if (typeof registered !== 'function') throw new Error('设置页组件未注册到 settings.section 插槽')
  return { exports, SystemPromptEditor: registered, source, react }
}

/**
 * 挂载组件并驱动重渲染。
 * @param {Function} component - 组件函数。
 * @param {object} props - 组件 props。
 * @returns {Promise<object>} 句柄：`tree` / `act()` / `settle()`。
 */
export async function mount(component, props = {}) {
  const slots = []
  const effects = []
  let cursor = 0
  let dirty = false
  let tree = null
  let rendered = 0

  const sameDeps = (left, right) => Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((item, index) => Object.is(item, right[index]))

  const slotAt = (factory) => {
    const at = cursor
    cursor += 1
    if (slots[at] === undefined) slots[at] = factory()
    return slots[at]
  }

  hookBridge.use = {
    useState(initial) {
      const slot = slotAt(() => ({ value: typeof initial === 'function' ? initial() : initial }))
      const set = (next) => {
        const value = typeof next === 'function' ? next(slot.value) : next
        if (Object.is(value, slot.value)) return
        slot.value = value
        dirty = true
      }
      return [slot.value, set]
    },
    useRef(initial) {
      return slotAt(() => ({ current: initial }))
    },
    useCallback(fn, deps) {
      const slot = slotAt(() => ({ fn, deps }))
      if (!sameDeps(slot.deps, deps)) {
        slot.fn = fn
        slot.deps = deps
      }
      return slot.fn
    },
    useMemo(fn, deps) {
      const slot = slotAt(() => ({ value: fn(), deps }))
      if (!sameDeps(slot.deps, deps)) {
        slot.value = fn()
        slot.deps = deps
      }
      return slot.value
    },
    useEffect(fn, deps) {
      const slot = slotAt(() => ({ deps: null }))
      if (!sameDeps(slot.deps, deps)) {
        slot.deps = deps
        effects.push(fn)
      }
    },
  }

  const render = () => {
    cursor = 0
    rendered += 1
    if (rendered > 200) throw new Error('渲染次数超过上限，疑似状态更新死循环')
    tree = component({ ...props })
    return tree
  }

  /** 渲染并把排队的 effect 全部跑完，直到不再产生新的更新。 */
  const run = async () => {
    for (let round = 0; round < 40; round += 1) {
      dirty = false
      render()
      while (effects.length > 0) {
        const task = effects.shift()
        task()
        // effect 里常有 Promise / 微任务，必须让出事件循环。
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      if (!dirty) return tree
    }
    throw new Error('effect 反复触发更新，未能在 40 轮内稳定')
  }

  const handle = {
    get tree() {
      return tree
    },
    get renderCount() {
      return rendered
    },
    /** 在 settle 之外手动触发一次状态更新（用于点击/输入）。 */
    async act(mutate) {
      await mutate()
      dirty = true
      return run()
    },
    /** 等待异步数据（RPC 响应）落地并稳定。 */
    async settle(rounds = 8) {
      for (let round = 0; round < rounds; round += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (dirty || effects.length > 0) await run()
      }
      return tree
    },
  }

  await run()
  await handle.settle()
  return handle
}

/** 深度遍历元素树。 */
export function walk(node, visit, ancestors = []) {
  if (node === null || node === undefined || node === false) return
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit, ancestors)
    return
  }
  if (typeof node === 'string' || typeof node === 'number') {
    visit({ type: '#text', props: { children: String(node) } }, ancestors)
    return
  }
  if (typeof node !== 'object' || node.type === undefined) return

  visit(node, ancestors)
  const children = node.props ? node.props.children : undefined
  if (children === undefined) return
  const next = [...ancestors, node]
  if (Array.isArray(children)) {
    for (const child of children) walk(child, visit, next)
  } else {
    walk(children, visit, next)
  }
}

/** 把整棵树拼成纯文本，用于「界面上有没有这句说明」这类断言。 */
export function textOf(tree) {
  const parts = []
  walk(tree, (node) => {
    if (node.type === '#text') parts.push(node.props.children)
    else if (typeof node.props?.children === 'string') parts.push(node.props.children)
  })
  return parts.join(' ')
}

/** 找出所有满足条件的元素。 */
export function findAll(tree, predicate) {
  const found = []
  walk(tree, (node) => {
    if (node.type !== '#text' && predicate(node)) found.push(node)
  })
  return found
}

/** 按 className 找元素（精确到单个 class）。 */
export function byClass(tree, className) {
  return findAll(tree, (node) => typeof node.props?.className === 'string'
    && node.props.className.split(/\s+/).includes(className))
}

/** 按标签名找元素。 */
export function byTag(tree, tag) {
  return findAll(tree, (node) => node.type === tag)
}
