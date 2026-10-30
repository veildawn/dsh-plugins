import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply as applyHost, patchIndex, VIEWPORT_CONTENT } from '../lib/index.js'

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
/** 宿主类名快照，与 dsh-zcode-theme 共用仓库级 fixture（桌面版 + Web 版合并）。 */
const hostFixture = JSON.parse(
  await readFile(join(pluginRoot, '../../test/fixtures/host-classes.json'), 'utf8'),
)
const hostClasses = new Set(Object.values(hostFixture.bundles).flat())

let definition
const previousWindow = globalThis.window
const previousCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
let randomByte = 0
Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: { getRandomValues: (bytes) => bytes.fill(randomByte++ & 255) },
})
globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
await import('../lib/client.js')
globalThis.window = previousWindow
const polyfilledUUID = globalThis.crypto.randomUUID()
if (previousCrypto) Object.defineProperty(globalThis, 'crypto', previousCrypto)
else delete globalThis.crypto
const client = definition.factory()

/**
 * 断言视图：移动端样式给宿主类名加了"去哈希兜底"，形如
 * `:is(.H0stHa_details,[class$="_details"])`。这里把它展开回 `.H0stHa_details`，
 * 既有断言仍然只针对哈希选择器本身；需要检查兜底是否存在的用例读 rawCss。
 */
const rawCss = client.internals.css
const cssForAssertions = rawCss.replace(
  /:is\((\.[A-Za-z0-9_-]+),(?:[a-z]+\[class\$="[^"]+"\]|\[class\$="[^"]+"\])\)/g,
  '$1',
)

test('Client polyfills crypto.randomUUID in insecure contexts', () => {
  assert.match(polyfilledUUID, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

class Events {
  listeners = new Map()
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener))
  }
  emit(type, event = {}) {
    event.target ??= this
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

class Style {
  values = new Map()
  setProperty(name, value) { this.values.set(name, value) }
  removeProperty(name) { this.values.delete(name) }
  getPropertyValue(name) { return this.values.get(name) ?? '' }
}

class Element extends Events {
  constructor(tagName, document) {
    super()
    this.tagName = tagName.toUpperCase()
    this.ownerDocument = document
    this.attributes = new Map()
    this.children = []
    this.dataset = {}
    this.style = new Style()
    this.hidden = false
    this.inert = false
    this.textContent = ''
    this.className = ''
    this.parentElement = null
    this.isContentEditable = false
  }
  append(...children) {
    for (const child of children) {
      child.parentElement = this
      this.children.push(child)
    }
  }
  prepend(...children) {
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]
      child.parentElement = this
      this.children.unshift(child)
    }
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  hasAttribute(name) { return this.attributes.has(name) }
  removeAttribute(name) { this.attributes.delete(name) }
  focus() { this.ownerDocument.activeElement = this }
  click() {
    for (let node = this; node; node = node.parentElement) if (node.inert) return
    this.emit('click')
  }
  remove() {
    if (!this.parentElement) return
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this)
    this.parentElement = null
  }
  contains(candidate) {
    return candidate === this || this.children.some((child) => child.contains(candidate))
  }
}

class Document extends Events {
  constructor() {
    super()
    this.documentElement = new Element('html', this)
    // Fullscreen API 替身：只记录调用次数与当前全屏元素，不模拟真实渲染。
    this.fullscreenElement = null
    this.exitFullscreenCalls = 0
    this.documentElement.requestFullscreenCalls = 0
    this.documentElement.requestFullscreen = () => {
      this.documentElement.requestFullscreenCalls += 1
      this.fullscreenElement = this.documentElement
      return Promise.resolve()
    }
    this.documentElement.webkitRequestFullscreen = this.documentElement.requestFullscreen
    this.exitFullscreen = () => {
      this.exitFullscreenCalls += 1
      this.fullscreenElement = null
      return Promise.resolve()
    }
    this.webkitExitFullscreen = this.exitFullscreen
    this.head = new Element('head', this)
    this.body = new Element('body', this)
    this.root = new Element('div', this)
    this.root.id = 'root'
    this.frame = new Element('div', this)
    this.frame.setAttribute('data-sidebar-collapsed', 'true')
    this.sidebarColumn = new Element('div', this)
    this.sidebar = new Element('div', this)
    this.sidebar.parentElement = this.sidebarColumn
    this.startButton = new Element('button', this)
    this.startButton.parentElement = this.sidebar
    this.composer = new Element('div', this)
    this.card = new Element('div', this)
    this.card.parentElement = this.composer
    this.composer.append(this.card)
    this.tools = new Element('div', this)
    this.tools.className = 'ccegLa_tools'
    this.modelLabel = new Element('span', this)
    this.modelLabel.className = '_7KE1Ra_triggerLabel'
    this.modelLabel.textContent = 'antigravity/gemini-3-flash'
    this.effortLabel = new Element('span', this)
    this.effortLabel.className = '_7KE1Ra_triggerEffort'
    this.effortLabel.textContent = 'High'
    this.textarea = new Element('textarea', this)
    this.textarea.setAttribute('placeholder', '给智能体发消息')
    // 宿主 0.2.0-rc.2 的真实输入区：contenteditable div，占位文案挂在 data-placeholder。
    this.input = new Element('div', this)
    this.input.isContentEditable = true
    this.input.setAttribute('data-placeholder', '给智能体发消息')
    this.permission = new Element('button', this)
    this.permission.className = 'Sh0Q9G_trigger'
    this.permission.textContent = '只读'
    this.plan = false
    this.titleButton = new Element('button', this)
    this.titleButton.textContent = '移动端适配会话'
    this.chatTab = new Element('button', this)
    this.chatTab.textContent = '对话'
    this.chatTab.setAttribute('aria-selected', 'true')
    this.trajectoryTab = new Element('button', this)
    this.trajectoryTab.textContent = '轨迹'
    this.trajectoryTab.setAttribute('aria-selected', 'false')
    this.hero = false
    this.sessionPreset = ''
    this.heroPreset = ''
    this.running = false
    this.started = 0
    this.scrolled = 0
    this.startButton.addEventListener('click', () => { this.started++ })
    this.chatTab.addEventListener('click', () => {
      this.chatTab.setAttribute('aria-selected', 'true')
      this.trajectoryTab.setAttribute('aria-selected', 'false')
      this.notifyMutation?.()
    })
    this.trajectoryTab.addEventListener('click', () => {
      this.chatTab.setAttribute('aria-selected', 'false')
      this.trajectoryTab.setAttribute('aria-selected', 'true')
      this.notifyMutation?.()
    })
    this.composer.scrollIntoView = () => { this.scrolled++ }
    this.body.append(this.root)
  }
  createElement(tagName) { return new Element(tagName, this) }
  getElementById(id) {
    if (id === 'root') return this.root
    const visit = (node) => {
      if (node.id === id) return node
      for (const child of node.children) {
        const found = visit(child)
        if (found) return found
      }
    }
    return visit(this.head) ?? visit(this.body) ?? null
  }
  querySelector(selector) {
    if (selector === '[data-slot="root"]>div') return this.frame
    if (selector === '[data-slot="sidebar"]') return this.sidebar
    if (selector === '[data-slot="sidebar"] button') return this.startButton
    if (selector === '[data-slot="conversation.session.header"] nav button:disabled') return this.titleButton
    if (selector.startsWith('[data-composer-card] button[aria-label')) return this.running ? new Element('button', this) : null
    if (selector === '[data-slot="conversation"]>[data-phase="hero"]') return this.hero ? new Element('div', this) : null
    if (selector === '[data-slot="conversation.session.header"] .SVAs4q_label') {
      if (!this.sessionPreset) return null
      const preset = new Element('span', this)
      preset.textContent = this.sessionPreset
      return preset
    }
    if (selector === '[data-slot="conversation.hero.agentPreset"]') {
      if (!this.heroPreset) return null
      const preset = new Element('div', this)
      preset.textContent = this.heroPreset
      return preset
    }
    if (selector.startsWith('.Sh0Q9G_trigger,')) return this.permission
    if (selector === '.Sh0Q9G_triggerLabel') return null
    if (selector === '[data-composer-card] textarea') return this.textarea
    if (selector === '[data-composer-input]') return this.input
    if (selector.includes('tools')) return this.tools
    if (selector === '[data-composer-card]') return this.card
    if (selector === '._7KE1Ra_triggerLabel') return this.modelLabel
    if (selector === '._7KE1Ra_triggerEffort') return this.effortLabel
    if (selector === '.rS3zOq_chip') return this.plan ? new Element('button', this) : null
    if (selector === '[data-composer-seat]') return this.composer
    return null
  }
  querySelectorAll(selector) {
    if (selector === '[data-slot="conversation.session.header"] [role="tablist"] [role="tab"]') return [this.chatTab, this.trajectoryTab]
    return []
  }
}

class Media extends Events {
  constructor(matches) {
    super()
    this.matches = matches
  }
  addListener(listener) { this.addEventListener('change', listener) }
  removeListener(listener) { this.removeEventListener('change', listener) }
}

function fixture() {
  const doc = new Document()
  const media = new Media(true)
  const viewport = new Events()
  viewport.height = 700
  viewport.offsetTop = 0
  viewport.scale = 1
  let mutation
  let observerOptions
  class Observer {
    constructor(callback) { mutation = callback; doc.notifyMutation = callback }
    observe(_root, options) { observerOptions = options }
    disconnect() { this.disconnected = true }
  }
  const win = {
    innerHeight: 700,
    matchMedia: () => media,
    requestAnimationFrame: (callback) => { callback(); return 1 },
    visualViewport: viewport,
  }
  let toggles = 0
  let cleanup
  const ctx = {
    layout: {
      toggleSidebar() {
        toggles++
        if (doc.frame.hasAttribute('data-sidebar-collapsed')) doc.frame.removeAttribute('data-sidebar-collapsed')
        else doc.frame.setAttribute('data-sidebar-collapsed', 'true')
        mutation?.()
      },
    },
    effect(install) { cleanup = install() },
  }
  return { doc, media, viewport, win, ctx, Observer, cleanup: () => cleanup?.(), toggles: () => toggles, observerOptions: () => observerOptions }
}

test('Host index tap replaces viewport metadata and remains idempotent', () => {
  const source = '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body></body></html>'
  const once = patchIndex(source)
  const twice = patchIndex(once)
  assert.equal(once, twice)
  assert.equal((once.match(/name="viewport"/g) ?? []).length, 1)
  assert.match(once, new RegExp(`content="${VIEWPORT_CONTENT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`))
  assert.equal((once.match(/id="dsh-mobile-safe-area"/g) ?? []).length, 1)
  for (const variable of ['--dsh-sat', '--dsh-sab', '--dsh-sal', '--dsh-sar']) assert.match(once, new RegExp(variable))

  const inserted = patchIndex('<html><head><title>DSH</title></head><body></body></html>')
  assert.match(inserted, /<head><meta name="viewport"/)
})

test('Host plugin registers and disposes its tap through Cordis lifecycle', () => {
  let transform
  let disposed = false
  const ctx = {
    webServer: { tapIndex(value) { transform = value; return () => { disposed = true } } },
    effect(install) { this.cleanup = install() },
  }
  applyHost(ctx)
  assert.equal(transform, patchIndex)
  ctx.cleanup()
  assert.equal(disposed, true)
})

test('Client manifest loads after every adapted surface without dependencies', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-layout'))
  assert(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-trajectory'))
  assert.deepEqual(client.inject, ['layout'])
  assert.doesNotMatch(source, /scrollIntoView/)
  assert.doesNotMatch(source, /data-dsh-mobile-stats-expanded/)
  assert.equal(manifest.dependencies, undefined)
})

test('Mobile sidebar keeps one symmetric 12px content inset', () => {
  const css = cssForAssertions
  assert.match(css, /\[data-slot="root"\]>div>div:has\(>\[data-slot="sidebar"\]\)\{[^}]*box-sizing:border-box;[^}]*padding-left:var\(--dsh-sal\);padding-right:0/)
  assert.match(css, /\[data-slot="sidebar"\]\{--dsh-sidebar-inline-padding:12px!important;[^}]*width:100%!important;max-width:100%!important;[^}]*height:100%\}/)
  assert.match(css, /\.hHd-Xa_root\{--dsh-sidebar-inline-padding:12px!important;[^}]*width:100%!important;max-width:100%!important;[^}]*padding-left:12px!important;padding-right:12px!important\}/)
  assert.match(css, /\[data-slot="sidebar"\] :where\(\.hHd-Xa_newSession,[^)]*\[role="tree"\],\[role="treeitem"\],[^)]*\.VOzbGW_trigger\)\{[^}]*width:100%!important;max-width:100%!important;margin:0!important\}/)
  assert.match(css, /\[data-slot="sidebar"\] :where\(\.hHd-Xa_regionArea\)\{padding-left:0!important;padding-right:0!important\}/)
  // 会话树容器组件已被宿主移除（qDHVXG_* 在 0.1.0-rc.7 与 0.2.1-rc.2 均不存在），
  // 针对它的 scrollbar-gutter 规则属于死代码，不应再出现在 CSS 里。
  assert.doesNotMatch(css, /qDHVXG/, '已从宿主移除的会话树哈希不得残留')
  assert.doesNotMatch(css, /\[data-slot="sidebar"\]\{[^}]*padding-(?:left|right):12px/, 'the slot wrapper must not double the content padding')
  assert.match(css, /\.YDXeBa_projectRow \.YDXeBa_rowActions,[^}]*\.YDXeBa_sessionRow \.YDXeBa_rowActions\{display:inline-flex!important;gap:6px!important;height:28px!important;align-items:center!important\}/)
  assert.match(css, /\.YDXeBa_projectRow \.YDXeBa_rowActions \.YDXeBa_iconButton,[^}]*\.YDXeBa_sessionRow \.YDXeBa_rowActions \.YDXeBa_iconButton\{[^}]*width:28px!important;height:28px!important;[^}]*border-radius:50%!important/)
  assert.match(css, /\.YDXeBa_sessionRow \.YDXeBa_time\{display:none!important\}/)
})

test('CSS template literal is never terminated early by a stray backtick', async () => {
  // 注释里写一个反引号（例如把宿主类名包成 `code`）就会提前闭合 css 模板字符串：
  // 语法仍然合法，但后半段样式全部变成字符串字面量的一部分——表现为「改了半天没生效」。
  // 这次就是这么踩的，必须由测试兜住。
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const start = source.indexOf('const css = `')
  assert.notEqual(start, -1, '未找到 css 模板字符串')
  const end = source.indexOf('\n    `', start)
  assert.notEqual(end, -1, '未找到 css 模板字符串结尾')
  const body = source.slice(start + 'const css = `'.length, end)
  assert.equal(body.includes('`'), false, 'CSS 模板内不得出现反引号，否则模板会提前闭合')
  // 内容完整性抽查：结尾的 keyframes 必须在模板内，而不是被甩到字符串外。
  assert.equal(body.includes('@keyframes dsh-mobile-pulse'), true)
})

test('Conversation mobile CSS keeps a bounded scrollport and compact composer stats', () => {
  const css = cssForAssertions
  assert.match(css, /max-width:768px/)
  assert.match(css, /\.dsh-mobile-bar\{[^}]*display:flex/)
  // 全屏切换：只收起浏览器自身的地址栏与底部工具栏，应用自己的导航必须保留。
  // 手机上的「全屏」诉求是「别让浏览器 chrome 占地方」，不是「把应用顶栏也藏掉」。
  assert.doesNotMatch(css, /html\[data-dsh-mobile-fullscreen=true\] \.dsh-mobile-bar\{display:none/)
  assert.doesNotMatch(css, /html\[data-dsh-mobile-fullscreen=true\] \.wSkVaW_header/)
  assert.doesNotMatch(css, /html\[data-dsh-mobile-fullscreen=true\] \[data-slot="conversation\.session\.header"\]/)
  assert.doesNotMatch(css, /html\[data-dsh-mobile-fullscreen=true\] \[data-conversation-tabs\]\{display:none/)
  // 全屏按钮仍留在顶栏原位，不再搬到 body 当浮层
  assert.doesNotMatch(css, /html\[data-dsh-mobile-fullscreen=true\] \.dsh-mobile-fullscreen-toggle\{position:fixed/)
  assert.match(css, /\.dsh-mobile-fullscreen-toggle\{[^}]*width:40px/)
  // 浏览器全屏后视口变高，根容器必须跟随 100dvh 重铺；:fullscreen 伪类作双保险，
  // 覆盖用户通过浏览器菜单进入全屏（未经过我们的按钮）的场景。
  assert.match(css, /html\[data-dsh-mobile-fullscreen=true\],[\s\S]*html:fullscreen,[\s\S]*height:100dvh!important;overflow:hidden!important\}/)
  assert.match(css, /html:fullscreen #root\{height:100dvh!important\}/)
  assert.match(css, /\.dsh-mobile-status\{[^}]*font-size:11px;[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis/)
  assert.match(css, /\.dsh-mobile-status\[data-plan=true\]\{[^}]*color:var\(--dsw-alias-state-warn-label\);font-weight:600\}/)
  assert.match(css, /100dvh/)
  assert.doesNotMatch(css, /body\{position:fixed/)
  assert.match(css, /\[data-slot="root"\]>div\{height:100%!important;min-height:0/)
  assert.match(css, /\.pI_x6G_centerCol,[\s\S]*grid-column:2!important/)
  assert.match(css, /\.gehEqa_root,[^}]*--dsh-chat-content-width:100%!important/)
  assert.match(css, /\.gehEqa_widthHandle,[^}]*display:none!important/)
  assert.match(css, /\[data-slot="conversation"\]\{flex:1 1 0;height:100%;min-width:0;min-height:0/)
  assert.match(css, /\[data-conversation-scroll\]\{flex:1 1 0;min-width:0;min-height:0/)
  assert.match(css, /\[data-slot="conversation\.session\.header"\]>header\{display:none!important\}/)
  assert.match(css, /\.gehEqa_heroWorkspaceRow\{[^}]*width:100%;padding:0 20px!important;gap:4px!important;flex-wrap:wrap\}/)
  assert.match(css, /\.f0iH8G_workspace\{[^}]*min-width:0!important;max-width:100%!important;min-height:36px!important;flex:1 1 140px\}/)
  assert.match(css, /\[data-slot="conversation\.hero\.agentPreset"\]>span\{min-width:0;max-width:min\(50%,240px\);flex:0 1 auto\}/)
  assert.match(css, /\[data-slot="conversation\.hero\.agentPreset"\] \.cubgiG_seat\{[^}]*width:100%;min-width:0;max-width:100%;height:36px;min-height:36px;[^}]*border-radius:999px\}/)
  assert.match(css, /--dsh-keyboard-inset/)
  assert.match(css, /\[data-chat-flow\] \[class\*="_actions"\]\{[^}]*flex-wrap:wrap!important;[^}]*width:100%!important;[^}]*height:auto!important;[^}]*overflow:visible!important/)
  assert.match(css, /\[data-chat-flow\] \[class\*="_actions"\] button\{[^}]*flex:0 0 32px;[^}]*width:32px!important;[^}]*height:32px!important;[^}]*min-width:32px!important;[^}]*min-height:32px!important;[^}]*border-radius:50%!important/)
  assert.match(css, /\[class\*="_timeStart"\],\[class\*="_timeEnd"\][^}]*display:none!important/)
  // 统计药丸不能再整行隐藏：宿主把「N 轮 M 步 · tokens/s」「用量 · 缓存命中」
  // 渲染在输入卡片下方的 dock 里，用户反馈隐藏后「输入框下方的内容缺失」。
  // 现在改为保留内容 + 紧凑字号，由 balanceComposerDock() 动态配平高度。
  assert.doesNotMatch(css, /\[data-composer-stat\]\{display:none/,
    '统计药丸不允许再被整行隐藏，否则输入框下方会凭空空出一块')
  assert.match(css, /\[data-composer-dock\] \[data-composer-stat\][^{]*\{[^}]*font-size:10\.5px!important/,
    '统计药丸在移动端改用紧凑字号，单行三列里塞得下更多内容')
  assert.match(css, /\[data-composer-dock\],\[data-dsh-dock\]\{[^}]*flex-wrap:nowrap!important;[^}]*justify-content:space-between!important/,
    'dock 必须固定单行并均分三列，否则窄屏会被拆成多行')
  assert.match(css, /\[data-composer-dock\],\[data-dsh-dock\]\{[^}]*overflow:hidden!important/,
    'dock 不允许横向滚动：横滑在手机上难被发现，还会把圆环推出视野')
  assert.doesNotMatch(css, /\[data-composer-dock\],\[data-dsh-dock\]\{[^}]*overflow-x:auto/,
    'dock 不允许横向滚动')
  assert.doesNotMatch(css, /\[data-composer-dock\],\[data-dsh-dock\]\{[^}]*flex-wrap:wrap!important/,
    'dock 不允许折行：折行会把统计行拆成多行并撑高输入卡片')
  // 宿主把两个药丸装在 conversation.composer.dock 槽位里；该槽位一旦是 column，
  // 药丸就会上下堆叠——这正是「统计行没排成一行」的直接成因。
  assert.match(css, /\[data-slot="conversation\.composer\.dock"\]\{[^}]*flex-direction:row!important;[^}]*flex-wrap:nowrap!important/,
    'composer.dock 槽位必须是横向单行，不能是 column')
  assert.match(css, /\[data-plan-review-key\],\[data-plan-review-scroll\]\{[^}]*flex-direction:column!important/,
    '计划复核面板仍保持纵向布局')
  assert.doesNotMatch(css, /\[data-slot="conversation\.composer\.dock"\]\{[^}]*flex-direction:column/,
    'composer.dock 槽位不能是 column，否则统计药丸会上下堆叠')
  assert.match(css, /\[data-composer-dock\]>:last-child,\[data-dsh-dock\]>:last-child\{[^}]*flex:0 0 auto!important/,
    '上下文用量圆环列保持内容宽度，不被省略号截断')
  assert.match(css, /\[data-composer-dock\] \[data-composer-stat\] :is\(button,span\):last-child,[^{]*\{[^}]*text-overflow:ellipsis!important/,
    '统计文字超宽时必须走省略号，而不是换行或溢出')
  assert.match(css, /\[data-slot="conversation\.composer\.dock"\] \[data-composer-stat\]\{[^}]*flex:1 1 0!important/,
    '槽位内两个药丸必须等分宽度，否则会不均等截断')
  assert.match(css, /@media \(max-width:360px\)\{[\s\S]*?\[data-composer-dock\] \[data-composer-stat\] :is\(\[class\*="_sep"\]/,
    '超窄屏必须有降级：隐藏末位文字与分隔符，避免每段都被压成单字')
  assert.doesNotMatch(css, /\.FJxK0a_root\{display:none/, '失效的旧哈希类名规则必须移除')
  assert.doesNotMatch(css, /stats-expanded/)
  // 只断言当前宿主真实存在的前缀：p-xYUq / osXY9a 在 Web 版与桌面版都已不存在，
  // 留着它们只会让 check-host-hashes 报死前缀，规则本身也匹配不到任何元素。
  assert.match(css, /\._8_XoUG_action,\.TS9iAW_actions\{flex-wrap:wrap!important\}/)
  assert.doesNotMatch(css, /\[data-chat-flow\] button\{min-width:44px/)
  assert.match(css, /\.md-code-block pre/)
  assert.match(css, /scroll-behavior:smooth/)
  assert.match(css, /\[role="dialog"\]\[aria-modal="true"\]/)
})

test('Composer keeps complete mode labels together and wraps the trailing controls when needed', () => {
  const css = cssForAssertions
  assert.match(css, /\[data-composer-seat\]\{[^}]*padding-bottom:max\(8px,var\(--dsh-sab\)\)/)
  assert.match(css, /\[data-composer-card\]\{[^}]*padding:8px 10px 6px!important/)
  assert.match(css, /\[data-composer-card\]>:last-child\{[^}]*display:flex;[^}]*min-height:44px;[^}]*flex-direction:row!important;flex-wrap:wrap!important;[^}]*align-items:center!important;[^}]*justify-content:space-between;[^}]*gap:4px!important;[^}]*padding:4px 8px 8px!important/)
  assert.match(css, /\.ccegLa_tools,\.ccegLa_trailing\{[^}]*display:flex;[^}]*align-items:center;[^}]*min-width:0/)
  assert.match(css, /\[data-composer-card\]>:last-child\{[^}]*overflow:visible!important/)
  assert.match(css, /\.ccegLa_tools\{min-width:max-content;flex:1 1 auto;gap:4px!important;overflow:visible!important\}/)
  assert.match(css, /\.ccegLa_modes\{flex:none;flex-wrap:nowrap!important;[^}]*overflow:visible!important\}/)
  assert.doesNotMatch(css, /\.ccegLa_tools\{[^}]*overflow-y:hidden/)
  assert.match(css, /\.ccegLa_trailing\{flex:none;max-width:calc\(100% - 36px\);margin-left:auto;[^}]*gap:6px!important/)
  assert.match(css, /.ccegLa_add{display:none!important}/)
  assert.match(css, /\.uV2eYG_add,[^}]*\[class\*="_add"\][^}]*\{display:none!important\}/)
  assert.match(css, /button\[aria-haspopup="listbox"\]/)
  assert.match(css, /.dsh-mobile-upload-btn[^{]*{[^}]*width:32px!important;[^}]*height:32px!important;[^}]*border-radius:50%!important/)
  assert.match(css, /.ccegLa_primary{[^}]*width:32px!important;[^}]*height:32px!important;[^}]*min-width:32px!important;[^}]*min-height:32px!important;[^}]*border-radius:50%!important/)
  assert.match(css, /.ccegLa_primary{transform:none!important}/)
  assert.match(css, /.Sh0Q9G_trigger,.iWlSmW_trigger,.ccegLa_select{max-width:32px!important;min-width:32px!important}/)
  assert.match(css, /\.Sh0Q9G_trigger,\.iWlSmW_trigger[^{]*\{[^}]*width:32px!important/)
  assert.match(css, /.Sh0Q9G_triggerIcon,.iWlSmW_triggerIcon{display:inline-grid!important;place-items:center!important;flex:none;margin:0!important}/)
  assert.match(css, /.ccegLa_modes .Sh0Q9G_triggerLabel,.ccegLa_modes .iWlSmW_triggerLabel{display:none!important}/)
  assert.match(css, /.Sh0Q9G_triggerLabel,.iWlSmW_triggerLabel{display:none!important}/)
  assert.match(css, /.Sh0Q9G_chevron,.iWlSmW_chevron{display:none!important}/)
  assert.match(css, /.rS3zOq_chip{[^}]*width:max-content!important;[^}]*min-width:max-content!important;[^}]*padding:0 10px!important;[^}]*white-space:nowrap!important;overflow:visible!important;flex:none!important/)
  assert.match(css, /._7KE1Ra_root,\[data-composer-card\] :is\(button\[aria-haspopup="menu"\]\[aria-label\*="模型"\],[^{]*\{[^}]*width:32px!important/)
  assert.match(css, /._7KE1Ra_trigger[^{]*{[^}]*width:32px!important;[^}]*border-radius:50%!important/)
  assert.match(css, /._7KE1Ra_triggerLabel,._7KE1Ra_triggerEffort,._7KE1Ra_chevron,._7KE1Ra_triggerIcon,\[data-composer-card\] :is\(button\[aria-haspopup="menu"\]\[aria-label\*="模型"\],[^}]*\)>\*\{display:none!important\}/)
  assert.match(css, /.dsh-mobile-composer-info{[^}]*text-align:center/)
  // 上下文 meter：内容自适应药丸（不是 32x32 圆钮），避免百分比被裁掉
  assert.match(css, /\.NXnJXa_root\{width:auto!important;[^}]*height:32px!important/)
  assert.match(css, /\.NXnJXa_trigger\{[^}]*width:auto!important;[^}]*border-radius:999px!important;[^}]*display:inline-flex!important;[^}]*gap:6px!important/)
  assert.match(css, /\.NXnJXa_trigger>span\{display:inline-block!important/)
  assert.match(css, /\.ccegLa_dock>\[data-slot="conversation\.composer\.dock"\]\{flex:1 1 auto!important;width:auto!important;min-width:0!important/)
  assert.match(css, /\.dsh-mobile-upload-btn,\s*\.dsh-mobile-tools-btn,\s*\.Sh0Q9G_trigger,\s*\.iWlSmW_trigger,\s*\.term-composer-btn,\s*\._7KE1Ra_trigger,\s*\[data-composer-card\] button\[aria-haspopup="menu"\]\[aria-label\*="模型"\],\s*\[data-composer-card\] button\[aria-haspopup="menu"\]\[aria-label\*="Model" i\]\s*\{/,
    '统一圆钮规范的选择器列表不再包含 meter，且用语义属性覆盖模型选择器（不写死构建哈希）')
  // 上下文 meter 必须留在输入框内：卡片按 dock 的真实高度补底部内边距，dock 用
  // 同样的负边距收回卡内。旧实现用 :has(+dock …) + 固定 40px/-38px：浏览器不支持
  // :has()（Safari < 15.4 / Chrome < 105 / 部分移动端内核）时整条静默失效，圆环
  // 掉回卡片外，看起来就是「输入框下方的内容缺失」。现在由 balanceComposerDock()
  // 写入 --dsh-dock-reserve，CSS 只消费这个变量。
  assert.match(css, /\[data-composer-card\]\[data-dsh-dock-reserve\]\{padding-bottom:calc\(var\(--dsh-dock-reserve,0px\) \+ 2px\)!important\}/,
    '卡片底部必须按实测 dock 高度预留，不能再写死 40px')
  assert.match(css, /\[data-dsh-dock-balanced\]\{[^}]*margin-top:calc\(0px - var\(--dsh-dock-reserve,0px\)\)!important/,
    'dock 负边距必须与卡片预留高度用同一个变量配平')
  assert.match(css, /\[data-dsh-dock-balanced\]\{[^}]*position:relative!important;z-index:1!important/,
    'dock 抬高层级，否则会被 position:relative 的卡片背景盖住')
  // 配平样式只能由脚本标记驱动：宿主的 dock 类名/属性各版本不同（Qt4Hga_dock、
  // ccegLa_dock、uV2eYG_dock、data-composer-dock），CSS 认类名就会出现
  // 「JS 认得出、CSS 不认」的错配，圆环再次掉出卡片。
  assert.doesNotMatch(css, /\[data-dsh-dock-balanced\][^{]*\.ccegLa_dock/,
    '配平样式不得再与宿主类名绑定')
  assert.doesNotMatch(css, /:has\(\+[^)]*_dock/,
    '不允许再用 :has(+dock …) 做收卡：不支持 :has() 的内核上会整条失效')
  // 计划复核/待办面板在场时不收纳（JS 侧判断，见 balanceComposerDock 用例）。
  assert.match(css, /\[data-plan-review-key\],\[data-plan-review-scroll\]\{[^}]*width:100%!important/,
    '计划复核面板需要完整的纵向空间，不能被负边距叠到输入区上')
  // 宿主 0.2.0-rc.2 起输入区是 contenteditable（[data-composer-input]），不再是
  // [data-composer-card] textarea；防 iOS 聚焦自动放大的字号下限必须落在真实元素上。
  assert.match(css, /\[data-composer-input\],\[data-composer-placeholder\]\{font-size:max\(16px,var\(--dsh-content-font-size,14px\)\)!important\}/)
  assert.doesNotMatch(css, /\[data-composer-card\] textarea\{[^}]*font-size:16px!important/,
    '失效的 textarea 防放大选择器必须移除，否则留下不会命中的死规则')
  // 桌面版与 npm 版的 CSS Modules 哈希类名不同，防放大规则只能用稳定 data 属性。
  assert.doesNotMatch(css, /\[data-composer-input\][^{]*\.[A-Za-z0-9_-]+_placeholder/,
    '防放大选择器不得依赖哈希类名，否则会在其中一个宿主构建上全部失效')
  assert.doesNotMatch(css, /\[data-composer-card\] button[^}]*min-width:44px/)

  for (const viewportWidth of [320, 375, 390, 414]) {
    const cardWidth = viewportWidth - 40
    const rowWidth = cardWidth - 20
    const rowContentWidth = rowWidth - 16
    const trailingWidth = 110 + 24 + 32 + 2 * 6
    const toolsWidth = rowContentWidth - trailingWidth - 4
    assert.equal(trailingWidth <= rowContentWidth - 36, true, `${viewportWidth}px: trailing controls leave the add button visible`)
    assert.equal(toolsWidth >= 32, true, `${viewportWidth}px: the toolbar has space for its first control before wrapping`)
    const controlHeights = [32, 32, 32]
    assert.equal(controlHeights.every((height) => height === 32), true, `${viewportWidth}px: capsule and round controls share a 32px baseline`)
    assert.equal(4 + Math.max(...controlHeights) + 8, 44, `${viewportWidth}px: centered controls produce the compact 44px row`)

    const actionWidth = viewportWidth - 32
    const messageButtonsWidth = 5 * 32 + 4 * 6
    assert.equal(messageButtonsWidth <= actionWidth, true, `${viewportWidth}px: five message actions remain visible`)
  }
})

test('Plan mode chip and review takeover remain fully visible on small screens', () => {
  const css = cssForAssertions
  assert.match(css, /\[data-plan-review-key\],\[data-plan-review-scroll\]\{[^}]*width:100%!important;max-width:100%!important;min-width:0!important;min-height:0!important;display:flex!important;flex-direction:column!important;overflow:visible!important\}/,
    '计划复核面板保持纵向全宽布局')
  // composer.dock 槽位已改为横向单行（它装的是两个统计药丸，column 会让统计行堆叠）
  assert.match(css, /\[data-slot="conversation\.composer\.dock"\]\{[^}]*flex-direction:row!important/)
  assert.match(css, /\[data-plan-review-scroll\]\{max-height:min\(45dvh,360px\)!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch!important\}/)
  assert.doesNotMatch(css, /\[data-plan-review-(?:key|scroll)[^}]*display:none!important/)
})

test('Trajectory becomes a compact table with a full-size, closable mobile sheet', () => {
  const css = cssForAssertions
  assert.match(css, /\.Y0dWHa_split\{[^}]*flex-direction:column/)
  assert.match(css, /\.Y0dWHa_tablePane\{[^}]*overflow-y:auto/)
  assert.match(css, /\.Y0dWHa_eventColumn\{width:58px!important/)
  assert.match(css, /\.Y0dWHa_table th,\.Y0dWHa_table td\{height:36px!important/)
  assert.match(css, /\.Y0dWHa_details\{[^}]*position:fixed!important;[^}]*inset:calc\(52px \+ var\(--dsh-sat\)\) 0 var\(--dsh-keyboard-inset,0px\)!important;[^}]*width:100vw!important/)
  assert.match(css, /\.Y0dWHa_detailsResizeHandle\{display:none!important/)
  assert.match(css, /\.Y0dWHa_close\{width:44px!important;height:44px!important/)
  assert.match(css, /\.Y0dWHa_detailTabs\{height:44px!important/)
  assert.match(css, /\.Y0dWHa_promptDiff,\[aria-label="Event details"\] \[role="tree"\]\{overflow-x:auto/)
  assert.match(css, /\[data-conversation-composer-overlay\]>:first-child\{height:44px!important/)
  assert.match(css, /\[data-conversation-scroll\]:has\(\[data-conversation-composer-overlay\]\) \[data-composer-seat\]\{display:none!important\}/)
  assert.match(css, /--dsh-composer-height:0px!important/)
  assert.match(css, /@keyframes dsh-mobile-detail-in/)
})

test('Mobile dialogs and in-place menus stay usable without overwriting portal coordinates', () => {
  const css = cssForAssertions
  assert.match(css, /body>div\[role="presentation"\]:has\(>\[role="dialog"\]\[aria-modal="true"\]\)\{[^}]*position:fixed!important;[^}]*z-index:1200!important;[^}]*inset:0!important;[^}]*display:flex!important;[^}]*align-items:center!important;[^}]*justify-content:center!important;[^}]*background:rgba\(0,0,0,\.5\)!important;[^}]*overflow:visible!important/)
  assert.match(css, /body>div\[role="presentation"\]:has\(>\[role="dialog"\]\[aria-modal="true"\]\)>\[aria-hidden="true"\]\{position:absolute!important;inset:0!important;background:transparent!important/)
  assert.match(css, /body>div\[role="presentation"\]>\[role="dialog"\]\[aria-modal="true"\]\{[^}]*position:relative!important;[^}]*inset:auto!important;[^}]*width:min\(92vw,420px\)!important;[^}]*max-height:min\(85dvh,560px\)!important;[^}]*margin:auto!important;[^}]*border-radius:20px!important;[^}]*display:flex!important;flex-direction:column!important;[^}]*overflow-y:auto!important/)
  assert.match(css, /body>div\[role="presentation"\]>\[role="dialog"\]\[aria-modal="true"\]>\*\{min-width:0!important;min-height:0!important;max-width:100%!important\}/)
  assert.match(css, /\.ZuhsRW_dialog\.ZuhsRW_dialog\{[^}]*width:min\(92vw,420px\)!important;[^}]*max-height:min\(85dvh,560px\)!important;min-height:0!important;[^}]*display:flex!important;flex-direction:column!important;[^}]*overflow-y:auto!important/)
  assert.match(css, /\.ZuhsRW_content,\.ZuhsRW_millerRow,\.ZuhsRW_column,\[role="dialog"\] \[role="listbox"\]\{[^}]*width:100%!important;min-width:0!important;min-height:0!important;display:flex!important\}/)
  assert.match(css, /\.ZuhsRW_content,\.ZuhsRW_millerRow\{flex:1 1 0!important\}/)
  assert.match(css, /\.ZuhsRW_millerRow\{overflow-x:auto!important;-webkit-overflow-scrolling:touch!important\}/)
  assert.match(css, /\[role="dialog"\]\[aria-modal="true"\] label:has\(input\[type="checkbox"\]\)\{min-height:44px\}/)
  assert.match(css, /\[role="dialog"\] button\{min-width:44px;min-height:44px\}/)
  // 菜单容器保持 overflow:hidden（内部滚动区自己滚，见文件末尾的专项测试），
  // 这里只校验移动端的尺寸与层级约束。
  assert.match(css, /\[role="menu"\],\._7KE1Ra_menu,\._3e4SsG_menu\{[^}]*max-width:calc\(100vw - 24px\)!important;max-height:min\(360px,calc\(var\(--dsh-vvh,100dvh\) - 120px\)\)!important;[^}]*border-radius:14px!important;[^}]*background:[^;]+!important;border:1px solid var\(--dsw-alias-border-l2\)!important;overflow:hidden!important;overscroll-behavior:contain!important\}/)
  assert.match(css, /span>\[role="menu"\]\{position:absolute!important;bottom:calc\(100% \+ 4px\)!important;left:0!important;min-width:140px!important\}/)
  const portalMenu = css.match(/body>\[role="menu"\]\{([^}]*)\}/)?.[1]
  assert(portalMenu)
  assert.match(portalMenu, /min-width:180px!important/)
  assert.doesNotMatch(portalMenu, /(?:position|top|right|bottom|left):/)
  // 全局菜单规则只允许一条。按索引切取，避免注释里的花括号干扰正则。
  const menuRuleStart = css.indexOf('[role="menu"],._7KE1Ra_menu')
  assert.ok(menuRuleStart !== -1, '缺少全局 [role="menu"] 规则')
  const menuRuleBody = css.slice(css.indexOf('{', menuRuleStart) + 1, css.indexOf('}', menuRuleStart))
  assert.doesNotMatch(menuRuleBody, /(?:position|top|right|bottom|left|display|visibility):/)
  assert.match(css, /body>\[role="menu"\]:has\(\.cubgiG_item\)\{width:min\(300px,calc\(100vw - 24px\)\)!important\}/)
  assert.match(css, /body>\[role="menu"\]:has\(\.cubgiG_item\) \[role="menuitem"\]\{[^}]*min-height:56px;padding:8px 12px\}/)
  assert.match(css, /body>\[role="menu"\] \.cubgiG_item\{max-width:none;min-width:0\}/)
  assert.match(css, /body>\[role="menu"\] \.cubgiG_itemDesc\{overflow-wrap:anywhere\}/)
  assert.match(css, /\._3e4SsG_menu\{position:absolute!important;bottom:calc\(100% \+ 4px\)!important;left:0!important;right:auto!important;width:min\(320px,calc\(100vw - 24px\)\)!important\}/)
  assert.match(css, /\._3e4SsG_item\{[^}]*min-height:44px!important;padding:8px 12px!important\}/)
  assert.match(css, /\._3e4SsG_itemName\{max-width:50%!important;[^}]*text-overflow:ellipsis!important;white-space:nowrap!important\}/)
  assert.match(css, /\._7KE1Ra_menu,\[role="menu"\]\[aria-label\*="模型" i\]:not\(:has\(\[role="menuitem"\],[^{]*\{position:fixed!important;[^}]*right:12px!important;[^}]*z-index:1400!important\}/)
  assert.match(css, /\._7KE1Ra_option,\._7KE1Ra_cell,\[role="menu"\]\[aria-label\*="模型"\] \[class\$="_option"\][^{]*\{[^}]*width:100%!important;min-width:0!important\}/)
  assert.match(css, /\._7KE1Ra_modelName,\._7KE1Ra_description,\._7KE1Ra_cellLabel,\._7KE1Ra_cellValue,\[role="menu"\]\[aria-label\*="模型"\] :is\(\[class\$="_modelName"\],[^{]*\{min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important\}/)
  assert.doesNotMatch(css, /\[role="dialog"\]\[aria-modal="true"\]:(?:has\(>nav\)|not\(:has\(>nav\)\))\{/)
  assert.doesNotMatch(css, /inset:auto 0 0!important/)

  for (const viewportWidth of [320, 375, 390, 414, 768]) {
    assert(Math.min(280, viewportWidth - 24) <= viewportWidth - 24, `${viewportWidth}px: model menu stays inside 12px side gutters`)
    assert(Math.min(320, viewportWidth - 24) <= viewportWidth - 24, `${viewportWidth}px: command menu stays inside 12px side gutters`)
    assert(Math.min(viewportWidth * .92, 420) <= viewportWidth, `${viewportWidth}px: dialog stays inside the viewport`)
  }
  for (const viewportHeight of [360, 568, 667, 844]) {
    assert(Math.min(360, viewportHeight - 120) < viewportHeight, `${viewportHeight}px: menus leave vertical viewport room`)
    assert(Math.min(viewportHeight * .85, 560) <= viewportHeight, `${viewportHeight}px: dialogs stay inside the viewport`)
  }
})

test('Settings becomes a native full-screen mobile page with pill tabs and card controls', () => {
  const css = cssForAssertions
  assert.match(css, /\.VOzbGW_overlay\{[^}]*z-index:1100!important;[^}]*position:fixed!important;[^}]*width:100vw;[^}]*height:var\(--dsh-vvh,100dvh\)!important/)
  assert.match(css, /\.VOzbGW_mask\{display:none!important\}/)
  assert.match(css, /\.VOzbGW_panel\{[^}]*width:100vw!important;[^}]*height:100%!important;[^}]*max-width:none!important;[^}]*border-radius:0!important;[^}]*box-shadow:none!important;[^}]*flex-direction:column/)
  assert.match(css, /\.VOzbGW_navTitle\{[^}]*right:72px;left:72px;[^}]*height:44px;[^}]*justify-content:center;[^}]*text-align:center/)
  assert.match(css, /\.VOzbGW_header\{[^}]*height:calc\(44px \+ var\(--dsh-sat\)\)!important;[^}]*border-bottom:0;[^}]*align-items:center!important;justify-content:space-between!important/)
  assert.match(css, /\.VOzbGW_close\{width:44px!important;height:44px!important;[^}]*border-radius:12px!important/)
  assert.match(css, /\.VOzbGW_navList\{[^}]*width:100%!important;max-width:100%!important;[^}]*height:44px;[^}]*margin:0!important;padding:4px max\(12px,var\(--dsh-sar\)\) 4px max\(12px,var\(--dsh-sal\)\)!important;border-radius:0!important;border-bottom:1px solid var\(--dsw-alias-border-l1,rgba\(0,0,0,\.08\)\)!important;background:var\(--dsw-alias-bg-module-platform,rgba\(0,0,0,\.04\)\)!important;display:flex!important;[^}]*gap:4px!important;[^}]*overflow-x:auto!important;[^}]*scroll-behavior:smooth;scrollbar-width:none!important/)
  assert.match(css, /\.VOzbGW_navList::-webkit-scrollbar\{display:none!important\}/)
  assert.match(css, /\.VOzbGW_navCell\{[^}]*height:36px!important;[^}]*min-height:36px!important;[^}]*border:0!important;border-radius:10px!important;[^}]*color:var\(--dsw-alias-label-tertiary\)!important;[^}]*font-weight:500!important;[^}]*align-items:center!important;justify-content:center!important;[^}]*gap:6px!important;[^}]*transition:all \.2s cubic-bezier\(\.4,0,\.2,1\)!important/)
  assert.match(css, /\.VOzbGW_navCell\.VOzbGW_active\{background:var\(--dsw-alias-bg-layer-1,#fff\)!important;color:var\(--dsw-alias-label-primary\)!important;font-weight:600!important;box-shadow:0 2px 8px rgba\(0,0,0,\.08\),0 1px 2px rgba\(0,0,0,\.04\)!important\}/)
  assert.match(css, /\.VOzbGW_navIcon\{width:16px;height:16px;flex:none\}/)
  assert.match(css, /\.VOzbGW_navLabel\{[^}]*white-space:nowrap;overflow:visible\}/)
  assert.match(css, /\.VOzbGW_options\{[^}]*flex:1 1 0;[^}]*padding:4px [^}]* max\(24px,var\(--dsh-sab\)\) [^}]*!important;[^}]*overflow-y:auto/)
  assert.match(css, /\.VOzbGW_options>\[data-slot="settings\.section"\]>:has\(>\[data-slot="settings\.general\.item"\]\)\{[^}]*border:1px solid var\(--dsw-alias-border-l2\);border-radius:16px;background:var\(--dsw-alias-bg-layer-1\);overflow:hidden\}/)
  assert.match(css, /\.VOzbGW_options \[data-slot="settings\.general\.item"\]>\*\{[^}]*min-height:72px;padding:14px 16px!important\}/)
  assert.match(css, /\.VOzbGW_options \.oY77xG_row\{flex-wrap:wrap\}/)
  assert.match(css, /\.VOzbGW_options \.oY77xG_rowText\{flex:1 1 120px;padding-right:8px!important\}/)
  assert.match(css, /\.VOzbGW_options :where\(input[^}]*min-height:44px!important;[^}]*border-radius:12px!important;font-size:16px!important/)
  assert.match(css, /\.VOzbGW_options :where\(button,\[role="button"\],\[role="switch"\],summary\)\{min-width:44px;min-height:44px;touch-action:manipulation\}/)
  assert.match(css, /body>div\[role="presentation"\]:has\(>\.VOzbGW_panel\)\{[^}]*width:100vw!important;height:var\(--dsh-vvh,100dvh\)!important;padding:0!important/)
  assert.match(css, /body>div\[role="presentation"\]>\[role="dialog"\]\[aria-modal="true"\]\.VOzbGW_panel\{[^}]*width:100vw!important;height:100%!important;max-width:none!important;[^}]*margin:0!important/)
  assert.match(css, /\.VOzbGW_panel,\[data-shortcut-modal="settings"\]/)
  assert.match(css, /\.VOzbGW_navList,\[data-shortcut-modal="settings"\] \[class\*="_navList"\]\{[^}]*height:44px;min-height:44px;[^}]*display:flex!important;flex-direction:row!important/)
  assert.match(css, /\.VOzbGW_options \.dm-container :where\(button,\[role="button"\],\.dm-action-btn,\.dm-tab-btn,\.dm-filter-btn,\.dm-chip,\.dm-icon-mini-btn\)\{min-width:0;min-height:0\}/)
  assert.match(css, /\.VOzbGW_options \.dm-container :where\(button,\[role="button"\],\.dm-action-btn,\.dm-tab-btn,\.dm-filter-btn,\.dm-chip,\.dm-icon-mini-btn\)/)
})

test('Agent preset is extracted from active headers and new-session hero seats', () => {
  const active = new Document()
  active.sessionPreset = '标准模式'
  assert.deepEqual(client.internals.statusOf(active), {
    text: '就绪 · 标准模式 · 只读',
    running: false,
    plan: false,
    preset: '标准模式',
  })

  active.sessionPreset = 'PTC 模式'
  active.running = true
  active.permission.textContent = '完全访问'
  assert.equal(client.internals.statusOf(active).text, '运行中 · PTC 模式 · 完全访问')

  // English fallback from host 0.1.1-rc.2 (Workspace Write / Read Only / Full access)
  active.permission.textContent = 'Workspace Write'
  assert.equal(client.internals.statusOf(active).text, '运行中 · PTC 模式 · 工作区写入')

  active.permission.textContent = 'Read Only'
  assert.equal(client.internals.statusOf(active).text, '运行中 · PTC 模式 · 只读')

  active.permission.textContent = 'Full access'
  assert.equal(client.internals.statusOf(active).text, '运行中 · PTC 模式 · 完全访问')

  active.sessionPreset = '  创造模式  '
  active.plan = true
  assert.equal(client.internals.statusOf(active).text, '运行中 · 创造模式 · 完全访问 [计划]')

  const fresh = new Document()
  fresh.hero = true
  fresh.heroPreset = '极简模式'
  assert.deepEqual(client.internals.statusOf(fresh), {
    text: '新会话 · 极简模式',
    running: false,
    plan: false,
    preset: '极简模式',
  })

  fresh.heroPreset = 'PTC 模式'
  assert.equal(client.internals.statusOf(fresh).text, '新会话 · PTC 模式')
  fresh.heroPreset = '创造模式'
  assert.equal(client.internals.statusOf(fresh).text, '新会话 · 创造模式')
})

/** 构造一个最小的卡片 + dock 兄弟节点，用来验证收卡配平逻辑。 */
function dockFixture({ height = 28, plan = false, dataDock = true, dockClass = 'uV2eYG_dock' } = {}) {
  const makeElement = () => ({
    attributes: new Set(),
    setAttribute(name) { this.attributes.add(name) },
    hasAttribute(name) { return this.attributes.has(name) },
    removeAttribute(name) { this.attributes.delete(name) },
  })
  const card = { ...makeElement(), style: new Style() }
  const dock = {
    ...makeElement(),
    className: dockClass,
    style: new Style(),
    getBoundingClientRect: () => ({ height }),
    querySelector: () => (plan ? { tagName: 'DIV' } : null),
  }
  dock.hasAttribute = (name) => (name === 'data-composer-dock' ? dataDock : dock.attributes.has(name))
  card.nextElementSibling = dock
  const doc = { querySelector: (selector) => (selector === '[data-composer-card]' ? card : null) }
  return { doc, card, dock }
}

test('balanceComposerDock reserves the measured dock height and releases it on desktop', () => {
  const { doc, card, dock } = dockFixture({ height: 28 })
  client.internals.balanceComposerDock(doc, true)
  assert.equal(card.hasAttribute('data-dsh-dock-reserve'), true, '卡片必须进入配平态')
  assert.equal(dock.hasAttribute('data-dsh-dock-balanced'), true, 'dock 必须进入收纳态')
  assert.equal(dock.hasAttribute('data-dsh-dock'), true, 'dock 必须被打上脚本标记，配平样式只认这个标记')
  assert.equal(card.style.getPropertyValue('--dsh-dock-reserve'), '28px')
  assert.equal(dock.style.getPropertyValue('--dsh-dock-reserve'), '28px')

  // 统计行折行 / 宿主换代改变 meter 高度后，下一次 sync 必须按新高度重新配平
  dock.getBoundingClientRect = () => ({ height: 46 })
  client.internals.balanceComposerDock(doc, true)
  assert.equal(card.style.getPropertyValue('--dsh-dock-reserve'), '46px')
  assert.equal(dock.style.getPropertyValue('--dsh-dock-reserve'), '46px')

  client.internals.balanceComposerDock(doc, false)
  assert.equal(card.hasAttribute('data-dsh-dock-reserve'), false, '桌面端必须撤销卡片预留')
  assert.equal(dock.hasAttribute('data-dsh-dock-balanced'), false, '桌面端必须撤销 dock 收纳')
  assert.equal(dock.hasAttribute('data-dsh-dock'), false, '桌面端必须撤销 dock 标记')
  assert.equal(card.style.getPropertyValue('--dsh-dock-reserve'), '')
  assert.equal(dock.style.getPropertyValue('--dsh-dock-reserve'), '')
})

test('balanceComposerDock skips plan panels, non-dock siblings and unmeasured docks', () => {
  // 计划复核面板需要完整纵向空间，不能被负边距叠到输入区上
  const plan = dockFixture({ plan: true })
  client.internals.balanceComposerDock(plan.doc, true)
  assert.equal(plan.card.hasAttribute('data-dsh-dock-reserve'), false)
  assert.equal(plan.dock.hasAttribute('data-dsh-dock-balanced'), false)

  // 卡片后面跟的不是 composer dock（例如别的面板）时不处理
  const other = dockFixture({ dataDock: false, dockClass: 'Y0dWHa_panel' })
  client.internals.balanceComposerDock(other.doc, true)
  assert.equal(other.card.hasAttribute('data-dsh-dock-reserve'), false)

  // 旧宿主仍有 ccegLa_dock 类名，必须继续识别
  const legacy = dockFixture({ dataDock: false, dockClass: 'ccegLa_dock' })
  client.internals.balanceComposerDock(legacy.doc, true)
  assert.equal(legacy.card.hasAttribute('data-dsh-dock-reserve'), true)

  // dock 还没渲染出高度（例如 meter 尚未出现）时保持原样
  const empty = dockFixture({ height: 0 })
  client.internals.balanceComposerDock(empty.doc, true)
  assert.equal(empty.card.hasAttribute('data-dsh-dock-reserve'), false)
})

test('Client drawer, shortcuts, gestures, keyboard viewport, and cleanup work together', (t) => {
  const f = fixture()
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    MutationObserver: globalThis.MutationObserver,
  }
  globalThis.document = f.doc
  globalThis.window = f.win
  globalThis.MutationObserver = f.Observer
  t.after(() => {
    globalThis.document = previous.document
    globalThis.window = previous.window
    globalThis.MutationObserver = previous.MutationObserver
  })

  client.apply(f.ctx)
  const bar = f.doc.body.children.find((node) => node.className === 'dsh-mobile-bar')
  const backdrop = f.doc.body.children.find((node) => node.className === 'dsh-mobile-backdrop')
  // 顶栏结构：☰（标题左侧）/ 标题 / 下拉 / 全屏 四项可见；
  // 轨迹、会话操作、右侧面板三项保留在 DOM 中但 hidden（作为面板的点击代理）。
  const [menu, titleBox, menuToggle, fullscreenToggle, view, actionsBtn, cornerBtn] = bar.children
  const [title, status] = titleBox.children
  assert.equal(bar.hidden, false)
  assert.equal(title.textContent, '移动端适配会话')
  assert.equal(status.textContent, '就绪 · 只读')
  assert.equal(status.dataset.plan, 'false')
  assert.equal(menuToggle.getAttribute('aria-label'), '更多操作')
  assert.equal(view.getAttribute('aria-label'), '查看轨迹')
  assert.equal(actionsBtn.getAttribute('aria-label'), '会话操作')
  assert.equal(cornerBtn.getAttribute('aria-label'), '切换右侧面板')
  // ☰ 必须可见（最高频的导航动作保留在顶栏），其余三项隐藏
  assert.equal(menu.hidden, false, '☰ 会话侧栏按钮必须保留在顶栏')
  for (const node of [view, actionsBtn, cornerBtn]) {
    assert.equal(node.hidden, true, `${node.className} 必须标记 hidden`)
  }
  assert.equal(backdrop.hidden, true)
  assert.equal(f.doc.sidebarColumn.inert, true)
  assert.equal(f.doc.documentElement.style.getPropertyValue('--dsh-keyboard-inset'), '0px')
  assert.deepEqual(f.observerOptions().attributeFilter, ['data-sidebar-collapsed', 'data-phase', 'aria-label', 'aria-selected', 'placeholder', 'disabled', 'data-sidebar-right-open'])
  assert.equal(f.observerOptions().characterData, true)

  menu.emit('click')
  assert.equal(menu.getAttribute('aria-expanded'), 'true')
  assert.equal(backdrop.hidden, false)
  assert.equal(f.doc.sidebarColumn.inert, false)
  assert.equal(f.doc.activeElement, f.doc.startButton)

  backdrop.emit('click')
  assert.equal(menu.getAttribute('aria-expanded'), 'false')
  assert.equal(f.doc.activeElement, menu)

  view.emit('click')
  assert.equal(f.doc.trajectoryTab.getAttribute('aria-selected'), 'true')
  assert.equal(view.textContent, '← 对话')
  f.doc.emit('keydown', { key: 'Escape' })
  assert.equal(f.doc.chatTab.getAttribute('aria-selected'), 'true')
  assert.equal(view.textContent, '⌁ 轨迹')
  assert.equal(f.doc.activeElement, view)
  assert.equal(f.doc.started, 0, 'trajectory replaces the old new-session shortcut')

  const composerControl = { closest: (selector) => {
    assert.equal(selector, '[data-slot="sidebar"] [role="treeitem"]', 'composer controls are never inspected by stats logic')
    return null
  } }
  f.doc.emit('click', { target: composerControl })

  const outside = { closest: () => null }
  f.doc.emit('pointerdown', { clientX: 4, clientY: 100, isPrimary: true, target: outside })
  f.doc.emit('pointerup', { clientX: 80, clientY: 108, target: outside })
  assert.equal(menu.getAttribute('aria-expanded'), 'true', 'right edge swipe opens the drawer')

  const inside = { closest: () => f.doc.sidebar }
  f.doc.emit('pointerdown', { clientX: 180, clientY: 100, isPrimary: true, target: inside })
  f.doc.emit('pointerup', { clientX: 100, clientY: 105, target: inside })
  assert.equal(menu.getAttribute('aria-expanded'), 'false', 'left drawer swipe closes it')

  menu.emit('click')
  const treeItem = { closest: (selector) => selector.includes('treeitem') ? treeItem : null }
  f.doc.emit('click', { target: treeItem })
  assert.equal(menu.getAttribute('aria-expanded'), 'false', 'choosing a session closes the drawer')

  // 工作区（项目）行是展开/收起控件，不是会话选择：点它必须把抽屉留着，
  // 否则宿主刚展开的会话列表立刻被我们关掉，表现为「点文件夹毫无反应」。
  // 宿主用 aria-expanded 标记项目行，会话行没有该属性。
  menu.emit('click')
  assert.equal(menu.getAttribute('aria-expanded'), 'true')
  const projectRow = {
    hasAttribute: (name) => name === 'aria-expanded',
    closest: (selector) => selector.includes('treeitem') ? projectRow : null,
  }
  f.doc.emit('click', { target: projectRow })
  assert.equal(menu.getAttribute('aria-expanded'), 'true', 'tapping a workspace row keeps the drawer open')

  // 而同一容器里的会话行仍然要关闭抽屉。
  const sessionRow = {
    hasAttribute: () => false,
    closest: (selector) => selector.includes('treeitem') ? sessionRow : null,
  }
  f.doc.emit('click', { target: sessionRow })
  assert.equal(menu.getAttribute('aria-expanded'), 'false', 'a session row still dismisses the drawer')

  view.emit('click')
  assert.equal(f.doc.trajectoryTab.getAttribute('aria-selected'), 'true')
  view.emit('click')
  assert.equal(f.doc.chatTab.getAttribute('aria-selected'), 'true')

  f.doc.running = true
  f.doc.sessionPreset = '标准模式'
  f.doc.permission.textContent = '完全访问'
  f.doc.plan = true
  f.doc.titleButton.textContent = '正在执行'
  f.doc.root.emit('mutation')
  // The fake observer is notified by layout changes, so one toggle refreshes
  // title/status as the real MutationObserver would after React commits.
  menu.emit('click')
  assert.equal(title.textContent, '正在执行')
  assert.equal(status.textContent, '运行中 · 标准模式 · 完全访问 [计划]')
  assert.equal(status.dataset.running, 'true')
  assert.equal(status.dataset.plan, 'true')
  assert.equal(status.dataset.preset, '标准模式')
  backdrop.emit('click')

  f.doc.running = false
  f.doc.plan = false
  f.doc.textarea.setAttribute('placeholder', '描述你的任务以生成计划')
  f.doc.notifyMutation()
  assert.equal(status.textContent, '就绪 · 标准模式 · 完全访问 [计划]', 'plan placeholder is a fallback when the chip is absent')

  f.doc.activeElement = f.doc.textarea
  f.viewport.height = 481.6
  f.viewport.emit('resize')
  assert.equal(f.doc.documentElement.style.getPropertyValue('--dsh-vvh'), '482px')
  assert.equal(f.doc.documentElement.style.getPropertyValue('--dsh-keyboard-inset'), '218px')
  assert.equal(f.doc.scrolled, 0, 'viewport changes never force the composer to scroll')

  f.viewport.offsetTop = 20
  f.viewport.emit('scroll')
  assert.equal(f.doc.documentElement.style.getPropertyValue('--dsh-keyboard-inset'), '198px')

  // 宿主 0.2.0-rc.2 起输入区是 contenteditable 而非 textarea：只认 tagName 会让
  // 键盘内边距兜底恒为 0，顶栏与输入框会被弹出的键盘盖住。
  f.viewport.offsetTop = 0
  f.doc.activeElement = f.doc.input
  f.viewport.emit('resize')
  assert.equal(f.doc.documentElement.style.getPropertyValue('--dsh-keyboard-inset'), '218px',
    'contenteditable 输入区同样要算作正在编辑')

  f.viewport.scale = 2
  f.viewport.emit('resize')
  assert.equal(f.doc.documentElement.style.getPropertyValue('--dsh-keyboard-inset'), '0px', 'pinch zoom is not mistaken for a keyboard')

  f.viewport.scale = 1
  f.doc.activeElement = f.doc.body
  f.doc.emit('focusout')
  assert.equal(f.doc.documentElement.style.getPropertyValue('--dsh-keyboard-inset'), '0px')

  // —— 全屏切换 ——
  // 只收起浏览器自身的 chrome（地址栏/底部工具栏），应用自己的顶栏与会话头
  // 全部保留。全屏按钮始终留在顶栏原位，全屏前后位置完全一致、无跳变。
  assert.equal(fullscreenToggle.parentElement, bar, '全屏按钮默认在顶栏内')
  assert.equal(fullscreenToggle.getAttribute('aria-label'), null, '初始未写 aria-label')
  fullscreenToggle.emit('click')
  assert.equal(f.doc.documentElement.getAttribute('data-dsh-mobile-fullscreen'), 'true')
  assert.equal(fullscreenToggle.parentElement, bar, '进入全屏后按钮仍留在顶栏，不搬动')
  assert.equal(bar.hidden, false, '全屏不隐藏顶栏')
  assert.equal(fullscreenToggle.getAttribute('aria-label'), '退出全屏')
  assert.equal(fullscreenToggle.getAttribute('aria-pressed'), 'true')
  // 浏览器层必须真的调用 requestFullscreen：应用层再怎么排版也动不了浏览器
  // 自己的地址栏与底部工具栏，只有这个 API 能收起它们。
  assert.equal(f.doc.documentElement.requestFullscreenCalls, 1, '必须调用浏览器 Fullscreen API')
  assert.equal(f.doc.fullscreenElement, f.doc.documentElement, '进入全屏后 document.fullscreenElement 指向 html')

  fullscreenToggle.emit('click')
  assert.equal(f.doc.documentElement.getAttribute('data-dsh-mobile-fullscreen'), null)
  assert.equal(fullscreenToggle.parentElement, bar, '退出全屏后按钮仍在顶栏')
  assert.equal(fullscreenToggle.getAttribute('aria-label'), '进入全屏')
  assert.equal(fullscreenToggle.getAttribute('aria-pressed'), 'false')
  assert.equal(f.doc.exitFullscreenCalls, 1, '退出时必须调 exitFullscreen')
  assert.equal(f.doc.fullscreenElement, null)

  // 浏览器自行退出（用户按 Esc / 系统手势）时应用层标记要跟着复位，
  // 让按钮的 aria 状态与实际全屏状态一致。
  fullscreenToggle.emit('click')
  assert.equal(f.doc.documentElement.getAttribute('data-dsh-mobile-fullscreen'), 'true')
  f.doc.fullscreenElement = null
  f.doc.emit('fullscreenchange')
  assert.equal(f.doc.documentElement.getAttribute('data-dsh-mobile-fullscreen'), null,
    '浏览器层退出后应用层同步复位')
  assert.equal(fullscreenToggle.parentElement, bar, '复位后按钮回到顶栏')

  // 全屏时打开侧栏要先收起：否则抽屉会盖住刚铺满的内容区
  fullscreenToggle.emit('click')
  menu.emit('click')

  const uploadBtn = f.doc.tools.children.find((node) => node.className === 'dsh-mobile-upload-btn')
  assert(uploadBtn, 'upload button should be prepended into composer tools in mobile mode')
  assert.equal(uploadBtn.getAttribute('aria-label'), '添加附件')
  assert.equal(uploadBtn.title, '添加附件')

  const infoEl = f.doc.composer.children.find((node) => node.className === 'dsh-mobile-composer-info')
  assert(infoEl, 'composer info element should be rendered above card in mobile mode')
  assert.equal(infoEl.textContent, 'antigravity/gemini-3-flash · High')
  assert.equal(f.doc.composer.children.indexOf(infoEl) < f.doc.composer.children.indexOf(f.doc.card), true)

  const fileInput = f.doc.body.children.find((node) => node.tagName === 'INPUT' && node.type === 'file')
  assert(fileInput, 'hidden file input should be present in document body')

  let fileInputClicked = false
  fileInput.click = () => { fileInputClicked = true }
  uploadBtn.click()
  assert.equal(fileInputClicked, true, 'clicking upload button triggers hidden file input click')

  f.media.matches = false
  f.media.emit('change')
  assert.equal(bar.hidden, true)
  assert.equal(f.doc.tools.children.includes(uploadBtn), false, 'upload button is removed in desktop mode')
  assert.equal(f.doc.documentElement.style.getPropertyValue('--dsh-vvh'), '')
  assert.equal(f.doc.documentElement.style.getPropertyValue('--dsh-keyboard-inset'), '')

  f.cleanup()
  assert.equal(f.doc.getElementById('dsh-mobile-adapter-style'), null)
  assert.equal(f.doc.body.children.includes(bar), false)
  assert.equal(f.doc.body.children.includes(fileInput), false)
  assert.equal(f.doc.documentElement.style.getPropertyValue('--dsh-vvh'), '')
  assert.equal(f.doc.documentElement.style.getPropertyValue('--dsh-keyboard-inset'), '')
  f.viewport.emit('resize')
  assert.equal(f.doc.documentElement.style.getPropertyValue('--dsh-vvh'), '', 'viewport listener is removed on cleanup')
  assert(f.toggles() >= 8)
})

test('the file viewer drawer is adapted for phones', () => {
  const css = cssForAssertions

  // A 64vw drawer is unusable on a phone: it takes the whole screen instead.
  assert.match(css, /\.fv-scrim\{[^}]*width:100vw!important/)
  assert.match(css, /\.fv-shell\{[^}]*width:100vw!important[^}]*height:100%!important/)
  assert.match(css, /\.fv-shell\{[^}]*border-radius:0!important/)

  // Height must follow the visual viewport, not 100dvh, which some mobile
  // browsers report before the address bar settles.
  assert.match(css, /\.fv-scrim\{[^}]*height:var\(--dsh-vvh,100dvh\)!important/)

  // Safe-area insets on the header and both scroll regions.
  assert.match(css, /\.fv-head\{[^}]*var\(--dsh-sat\)[^}]*var\(--dsh-sal\)/)
  assert.match(css, /\.fv-tree,\.fv-content\{[^}]*var\(--dsh-sab\)/)

  // Touch targets reach 32px or 40px, and the slide-in is dropped since the drawer is
  // full-screen here.
  assert.match(css, /\.fv-icon-button\{[^}]*width:(?:32px|40px)!important;height:(?:32px|40px)!important/)
  assert.match(css, /\.fv-row\{min-height:40px!important\}/)
  assert.match(css, /\.fv-shell\{[^}]*animation:none!important/)

  // These rules only apply on the phone breakpoint.
  const mobileBlock = css.slice(css.indexOf('@media (max-width:768px)'))
  assert(mobileBlock.includes('.fv-scrim'), 'viewer rules must sit inside the mobile query')
})

test('the file viewer drawer clears the mobile bar', async () => {
  const css = cssForAssertions

  // The shell's overlay layer is its own stacking context at z-index 20, so a
  // z-index on the scrim cannot lift it past .dsh-mobile-bar at 900. The bar
  // covered the drawer's header and swallowed every control in it, including
  // close — the only way out on a phone. The layer itself has to be raised,
  // and the selector must key off the semantic attribute: the old
  // `.pI_x6G_overlayLayer:has(.fv-scrim)` spelling pinned a build hash and
  // stopped matching once the host renamed its CSS modules.
  assert.match(
    css,
    /:is\(\[data-shell-overlay\],\[class\$="_overlayLayer"\]\):has\(\[class\*="scrim"\],\[class\*="backdrop"\]\)\{z-index:1100!important\}/,
  )
  assert.match(css, /\.dsh-mobile-bar\{[^}]*z-index:900/)
  assert.doesNotMatch(
    css,
    /\.pI_x6G_overlayLayer:has\([^)]*\)\{/,
    '提层规则不得再绑定宿主哈希类名（注释里可以引用旧写法，但不能真的作为选择器）',
  )
})

test('the tools menu outranks its own backdrop despite the role="menu" rule', () => {
  const css = cssForAssertions

  // 回归：本菜单带 role="menu"，会被 [role="menu"]{z-index:1300!important} 命中，
  // 被压到 1300 后低于自己的遮罩(1340)，遮罩便盖在菜单之上。透明遮罩看不见，
  // 用户点“选项”实际点在遮罩上，遮罩关闭菜单 —— 表现为面板一点就消失、选项
  // 永远点不到、点终端位置还会穿透到下方输入框。菜单层级必须高于遮罩。
  const menu = css.match(/\.dsh-mobile-tools-menu\.dsh-mobile-tools-menu:not\(\[hidden\]\)\{[^}]*\}/)
  assert.ok(menu, 'tools menu rule must use a doubled class for specificity')
  const menuZ = Number(menu[0].match(/z-index:(\d+)/)[1])

  const backdrop = css.match(/\.dsh-mobile-tools-backdrop:not\(\[hidden\]\)\{[^}]*\}/)
  assert.ok(backdrop, 'tools backdrop rule must exist')
  const backdropZ = Number(backdrop[0].match(/z-index:(\d+)/)[1])

  const roleMenu = css.match(/\[role="menu"\][^{]*\{[^}]*\}/)
  const roleMenuZ = Number(roleMenu[0].match(/z-index:(\d+)/)[1])

  assert.ok(menuZ > backdropZ, `menu z-index ${menuZ} must exceed backdrop ${backdropZ}`)
  assert.ok(menuZ > roleMenuZ, `menu z-index ${menuZ} must exceed [role=menu] ${roleMenuZ}`)
  assert.match(menu[0], /z-index:\d+!important/)
})

test('the tools button sits after the shield at the same level as upload', async () => {
  // 工具箱位置在盾牌右侧，但必须与上传按钮同级挂在 .ccegLa_tools 上，
  // 而不是插进盾牌所在的子容器 modes。插进子容器会让工具箱吃内层
  // gap、上传按钮吃外层 gap，跨容器边界导致两档间距视觉不齐。
  // 同级挂载后所有间距统一由外层 gap:4px 决定，也就不需要任何 margin 补偿。
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(source, /const modes = shield\?\.parentElement \?\? null/)
  assert.match(source, /const anchor = modes != null && modes\.parentElement === toolsEl \? modes : uploadBtn/)
  assert.match(source, /toolsBtn\.parentElement !== toolsEl/)
  assert.match(source, /toolsBtn\.previousElementSibling !== anchor/)

  const css = cssForAssertions
  assert.doesNotMatch(css, /\.dsh-mobile-tools-btn\{[^}]*margin/)
  assert.match(css, /\.ccegLa_tools\{[^}]*gap:4px!important/)
})

test('the tools menu keeps its items tappable through the whole gesture', async () => {
  // 配套：按下阶段不得关闭菜单，否则手指抬起时该坐标已换成输入框，
  // 合成的 click 会落到输入框上。动作留给 click，外部关闭判定留给 pointerup。
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(source, /addEventListener\('pointerdown', holdGesture\)/)
  assert.match(source, /addEventListener\('click', \(e\) => runItem\(e, openFileViewer\)\)/)
  assert.match(source, /addEventListener\('click', \(e\) => runItem\(e, openTerminal\)\)/)
  assert.match(source, /if \(toolsPressedOutside && !toolsMenu\.hidden && !insideTools\(event\.target\)\)/)
})

test('the tools menu integrates prompt history when available', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(source, /__dsh_open_prompt_history/)
  assert.match(source, /openPromptHistory/)
  assert.match(source, /<span>提示词历史<\/span>/)
})

test('mobile right sidebar is adapted with top offset and back-to-conversation button', async () => {
  const css = cssForAssertions
  assert.match(css, /\[data-sidebar-right-session\]\s*\[class\*="P3OORG_panel"\]/)
  assert.match(css, /\[data-sidebar-right-session\]\s*\[data-sidebar-right-panel\]/)
  assert.match(css, /top:calc\(52px \+ var\(--dsh-sat\)\)!important/)
  assert.match(css, /height:calc\(100% - 52px - var\(--dsh-sat\)\)!important/)
  assert.match(css, /\[class\*="_tabStrip_"\]\{[^}]*min-height:44px!important/)
  assert.match(css, /\[data-sidebar-right-toggle\],[^}]*\[class\*="P3OORG_iconButton"\]\{[^}]*width:36px!important;[^}]*height:36px!important/)

  const f = fixture()
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    MutationObserver: globalThis.MutationObserver,
  }
  globalThis.document = f.doc
  globalThis.window = f.win
  globalThis.MutationObserver = f.Observer
  try {
    const rightbarPanel = new Element('div', f.doc)
    rightbarPanel.setAttribute('data-sidebar-right-open', 'true')
    f.doc.body.append(rightbarPanel)

    let toggleClicked = false
    const toggleBtn = new Element('button', f.doc)
    toggleBtn.setAttribute('data-sidebar-right-toggle', 'true')
    toggleBtn.addEventListener('click', () => {
      toggleClicked = true
      rightbarPanel.removeAttribute('data-sidebar-right-open')
    })
    f.doc.body.append(toggleBtn)

    const origQuerySelector = f.doc.querySelector.bind(f.doc)
    f.doc.querySelector = (sel) => {
      if (sel === '[data-sidebar-right-open]') {
        return rightbarPanel.hasAttribute('data-sidebar-right-open') ? rightbarPanel : null
      }
      if (sel.includes('[data-sidebar-right-toggle]')) {
        return toggleBtn
      }
      return origQuerySelector(sel)
    }

    client.apply(f.ctx)
    const bar = f.doc.body.children.find((node) => node.className === 'dsh-mobile-bar')
    // 顶栏顺序：menu / titleBox / menuToggle / fullscreenToggle / view / actionsBtn / cornerBtn
    const view = bar.children[4]

    // 此时右栏打开，顶部导航右上角按钮应显示 '← 对话'
    assert.equal(view.textContent, '← 对话')
    assert.equal(view.getAttribute('aria-label'), '收起右侧面板，返回对话')

    // 点击该按钮应关闭右栏
    view.emit('click')
    assert.equal(toggleClicked, true, 'clicking back button collapses rightbar')
    assert.equal(view.textContent, '⌁ 轨迹')
  } finally {
    globalThis.document = previous.document
    globalThis.window = previous.window
    globalThis.MutationObserver = previous.MutationObserver
  }
})

test('tools button mounts reliably with new and old host tools container class names', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(source, /\[data-composer-card\]\s*\.ccegLa_tools/)
  assert.match(source, /\[data-composer-card\]\s*\[class\*="_tools"\]/)

  const f = fixture()
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    MutationObserver: globalThis.MutationObserver,
  }
  globalThis.document = f.doc
  globalThis.window = f.win
  globalThis.MutationObserver = f.Observer
  try {
    f.win.__dsh_open_file_viewer = () => {}
    f.doc.tools.className = 'ccegLa_tools'
    client.apply(f.ctx)
    f.doc.notifyMutation()

    const toolsBtn = f.doc.tools.children.find((node) => node.className === 'dsh-mobile-tools-btn')
    assert.ok(toolsBtn, 'tools button must mount into .ccegLa_tools container')
    assert.equal(toolsBtn.getAttribute('aria-label'), '工作区工具')
  } finally {
    delete f.win.__dsh_open_file_viewer
    globalThis.document = previous.document
    globalThis.window = previous.window
    globalThis.MutationObserver = previous.MutationObserver
  }
})

test('mobile view permanently hides the add button via CSS and JS fallback', async () => {
  const css = cssForAssertions
  assert.match(css, /\.ccegLa_add\{display:none!important\}/)
  assert.match(css, /\.uV2eYG_add,[^}]*\{display:none!important\}/)
  assert.match(css, /\[data-composer-card\]\s*\[class\*="_add"\]/)
  assert.match(css, /\[data-composer-card\]\s*button\[aria-haspopup="listbox"\]/)

  const f = fixture()
  const addBtn = new Element('button', f.doc)
  addBtn.className = 'uV2eYG_add'
  addBtn.setAttribute('aria-haspopup', 'listbox')
  f.doc.tools.append(addBtn)

  const origQS = f.doc.querySelector.bind(f.doc)
  f.doc.querySelector = (sel) => {
    if (sel.includes('_add') || sel.includes('listbox')) return addBtn
    return origQS(sel)
  }

  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    MutationObserver: globalThis.MutationObserver,
  }
  globalThis.document = f.doc
  globalThis.window = f.win
  globalThis.MutationObserver = f.Observer
  try {
    client.apply(f.ctx)
    f.doc.notifyMutation()
    assert.equal(addBtn.style.getPropertyValue('display'), 'none')

    f.cleanup()
    assert.equal(addBtn.style.getPropertyValue('display'), '')
  } finally {
    globalThis.document = previous.document
    globalThis.window = previous.window
    globalThis.MutationObserver = previous.MutationObserver
  }
})

/**
 * 移动端样式里的宿主类名必须"要么当前宿主真的存在，要么是明确登记的历史版本兼容"。
 * 不存在的类名 = 死规则，静默失效：手机上的适配凭空消失，没有报错、没有日志。
 *
 * 登记项一旦重新出现在宿主里，说明多版本兼容已经没必要，应当删掉——2026-10 的
 * `p-xYUq_actions` / `XY9a_actions` 就是这样被清掉的。
 */
test('工作区行在触屏上常显展开箭头，不依赖 hover', () => {
  const css = rawCss
  // 宿主把三角藏在 :hover 里（.YDXeBa_projectRow .YDXeBa_chevron{display:none}），
  // 触屏没有 hover，展开状态就完全不可见、也点不到。
  assert.match(css, /\.YDXeBa_projectRow \.YDXeBa_chevron\{display:inline-flex!important/, '展开三角必须常显')
  // 宿主同时写了 :hover 时隐藏文件夹，触屏按下会让图标互相顶替；这里钉死常显。
  assert.match(css, /\.YDXeBa_projectRow:hover \.YDXeBa_folder\{display:inline-flex!important/, '文件夹图标不能被 hover 顶掉')
  // 展开状态由宿主的 aria-expanded 驱动旋转，避免只有图标换向而状态不明。
  assert.match(css, /\.YDXeBa_projectRow\[aria-expanded="true"\] \.YDXeBa_arrow\{transform:rotate\(90deg\)\}/)
  assert.match(css, /\.YDXeBa_projectRow\[aria-expanded="false"\] \.YDXeBa_arrow\{transform:rotate\(0deg\)\}/)
})

test('宿主类名要么当前存在，要么是登记在案的历史版本兼容', () => {
  // 宿主 0.1.x / 0.2.0 时代的旧哈希：当前版本的同一组件另有语义选择器或
  // [class$=…] 兜底，保留原类名只是为了在旧宿主上仍然生效。
  const historical = new Set([
    '7KE1Ra_description',
    'NXnJXa_root',
    'NXnJXa_trigger',
    'Sh0Q9G_chevron',
    'Sh0Q9G_trigger',
    'Sh0Q9G_triggerIcon',
    'Sh0Q9G_triggerLabel',
    'ccegLa_add',
    'ccegLa_dock',
    'ccegLa_modes',
    'ccegLa_primary',
    'ccegLa_select',
    'ccegLa_tools',
    'ccegLa_trailing',
    'f0iH8G_workspace',
    'gehEqa_heroWorkspaceRow',
    'gehEqa_root',
    'gehEqa_widthHandle',
    'hHd-Xa_navList',
  ])

  const used = new Set()
  for (const match of rawCss.matchAll(/\._?([A-Za-z0-9][A-Za-z0-9_-]*_[A-Za-z][A-Za-z0-9]*)/g)) {
    used.add(match[1].replace(/^_/, ''))
  }

  const unknown = [...used].filter((cls) => !hostClasses.has(cls) && !historical.has(cls)).sort()
  assert.deepEqual(unknown, [], `以下类名当前宿主不存在，也不是登记的历史兼容：${unknown.join(', ')}`)

  const revived = [...historical].filter((cls) => hostClasses.has(cls)).sort()
  assert.deepEqual(revived, [], `以下类名已重新出现在宿主中，请从历史兼容名单移除：${revived.join(', ')}`)
})

/**
 * 去哈希兜底（`:is(.H0stHa_details,[class$="_details"])`）只允许出现在语义作用域内，
 * 或者用元素类型收窄（`aside[class$="_details"]`）。
 *
 * 原因：局部名在宿主里大量重名（`_root` 被 37 个组件共用、`_chevron` 20 个、`_row` 29 个），
 * 裸写 `[class$="_root"]` 会把侧栏内边距糊到整个应用上。desktop 与 Web 是两次独立构建，
 * 同一组件有两个哈希，所以"哈希数量 == 1"这种判据在合并 fixture 下也不成立。
 */
test('去哈希兜底只出现在语义作用域内或带元素限定', () => {
  const violations = []
  for (const match of rawCss.matchAll(/([a-z]*)\[class\$="_([A-Za-z][A-Za-z0-9]*)"\]/g)) {
    const tag = match[1]
    const local = match[2]
    if (tag !== '') continue
    const offset = match.index
    const boundary = Math.max(rawCss.lastIndexOf('}', offset), rawCss.lastIndexOf('{', offset))
    const head = rawCss.slice(boundary + 1, offset)
    if (/\[(?:data-|role=|aria-)/.test(head)) continue
    violations.push(local)
  }
  assert.deepEqual([...new Set(violations)], [], `以下兜底选择器没有语义作用域收窄，会误伤其它组件：${[...new Set(violations)].join(', ')}`)
})

/**
 * 关键组件的兜底必须在场：宿主换 hash 时，这些规则是移动端布局的骨架
 * （顶栏留白、侧栏内边距、抽屉全屏、详情面板全屏）。
 */
test('关键宿主组件保留去哈希兜底', () => {
  for (const local of ['newSession', 'regionArea', 'settingsArea', 'footerActions', 'overlayLayer', 'details', 'seat']) {
    assert.match(rawCss, new RegExp(`\\[class\\$="_${local}"\\]`), `缺少 ${local} 的去哈希兜底`)
  }
})

test('菜单容器保持 overflow:hidden，让宿主菜单内部的滚动区接手滚动', () => {
  // 这里必须读 rawCss：cssForAssertions 会把 :is(.X,[class$="_x"]) 展开成 .X，
  // 菜单规则的多选择器结构会被改写，按原文匹配就找不到了。
  const css = rawCss
  // 宿主模型选择菜单是 display:flex + overflow:hidden，内部 ._7KE1Ra_groups
  // 才是真正的滚动区。若给容器加 overflow-y:auto，flex 布局下会重置子项的
  // min-height:auto 契约，内部滚动区被撑开，列表既不能滚也被裁切。
  const menuStart = css.indexOf('[role="menu"],:is(._7KE1Ra_menu')
  assert.ok(menuStart !== -1, '缺少菜单容器规则')
  const menuBody = css.slice(css.indexOf('{', menuStart) + 1, css.indexOf('}', menuStart))
  assert.match(menuBody, /overflow:hidden!important/, '菜单容器必须 overflow:hidden')
  assert.doesNotMatch(menuBody, /overflow-y:auto!important/, '不得给容器加 overflow-y:auto')

  // 内部滚动区必须显式保活
  const groups = css.match(/\._7KE1Ra_groups,\[role="menu"\]\[aria-label\*="模型"\] \[class\*="_groups"\][^{]*\{([^}]*)\}/)
  assert.ok(groups, '缺少模型菜单内部滚动区规则')
  assert.match(groups[1], /min-height:0!important/, '滚动区需要 min-height:0 才能收缩')
  assert.match(groups[1], /overflow-y:auto!important/, '滚动区必须 overflow-y:auto')
  assert.match(groups[1], /-webkit-overflow-scrolling:touch!important/, 'iOS 需要惯性滚动')

  // 停靠规则必须排除内层滚动区：宿主把 groups 也渲染成 role="menu"
  // （外层 aria-label 是「模型与推理等级」，内层是「模型」）。少了这条排除，
  // 给滚动区套上 position:fixed 会让列表彻底滚不动。
  const dock = css.match(/(\[role="menu"\]\[aria-label\*="模型" i\][^{]*)\{position:fixed!important/)
  assert.ok(dock, '缺少按 aria-label 锚定的悬浮窗停靠规则')
  assert.match(dock[1], /:not\(:has\(\[role="menuitem"\]/, '停靠规则必须排除内层滚动区，否则列表滚不动')
})

test('移动端顶栏 3 层融合成 1 层：隐藏宿主冗余 Tabs 与 Header 占位，顶栏承接全部功能', (t) => {  const css = rawCss
  // 1. 验证第 3 层原生 Tabs 被彻底隐藏（去重）
  assert.match(css, /\[data-slot="conversation"\] :is\(\.wSkVaW_tabs,\[data-conversation-tabs\],\[role="tablist"\]\)[\s\S]*display:none!important/)

  // 2. 验证宿主第 2 层 Header 移出普通流（0 高度占位）
  assert.match(css, /:is\(\.wSkVaW_header,header\[class\$="_header"\]:has\(>\[class\*="_titleRow"\]\)\)\{[^}]*position:fixed!important;[^}]*pointer-events:none!important;[^}]*opacity:0!important/)

  // 3. 验证真实标题提取优先读取 crumbCurrent，避免固定回退为「新会话」
  const fakeDocWithTitle = {
    querySelector: (sel) => {
      if (sel.includes('_crumbCurrent')) return { textContent: '文件多标签页右键菜单' }
      return null
    },
    querySelectorAll: () => [],
  }
  assert.equal(client.internals.titleOf(fakeDocWithTitle), '文件多标签页右键菜单')

  // 4. 验证顶栏包含全部 6 项单行控件
  const f = fixture()
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    MutationObserver: globalThis.MutationObserver,
  }
  globalThis.document = f.doc
  globalThis.window = f.win
  globalThis.MutationObserver = f.Observer
  t.after(() => {
    globalThis.document = previous.document
    globalThis.window = previous.window
    globalThis.MutationObserver = previous.MutationObserver
  })

  client.apply(f.ctx)
  const bar = f.doc.body.children.find((node) => node.className === 'dsh-mobile-bar')
  assert.ok(bar)

  // 顶栏可见项收口为 3 个：标题区 + 操作下拉 + 全屏。
  // 「会话侧栏 / 轨迹 / 会话操作 / 右侧面板」四个入口收进下拉面板，
  // 但它们作为点击代理仍留在 bar 里（hidden，不占位）。
  // 理由：52px 高的顶栏在 360px 窄屏上塞不下 6 项，标题会被挤成三个字加省略号。
  assert.equal(bar.children.length, 7, '顶栏 = 4 可见项 + 3 个隐藏代理')
  const [menu, titleBox, menuToggle, fullscreenToggle, view, actionsBtn, cornerBtn] = bar.children
  assert.equal(menu.hidden, false, '☰ 必须留在顶栏（标题左侧）')
  assert.equal(menu.textContent, '☰')
  for (const node of [view, actionsBtn, cornerBtn]) {
    assert.equal(node.hidden, true, `${node.className} 必须 hidden`)
  }
  assert.equal(titleBox.className, 'dsh-mobile-titlebox')
  assert.equal(menuToggle.className, 'dsh-mobile-menu-toggle')
  assert.equal(menuToggle.getAttribute('aria-label'), '更多操作')
  assert.equal(menuToggle.getAttribute('aria-haspopup'), 'menu')
  assert.equal(fullscreenToggle.className, 'dsh-mobile-fullscreen-toggle')

  // 四个入口必须在下拉面板里，且面板初始隐藏
  const panel = f.doc.body.children.find((node) => node.className === 'dsh-mobile-menu-panel')
  assert.ok(panel, '缺少顶栏操作下拉面板')
  assert.equal(panel.hidden, true, '面板初始必须隐藏')
  assert.equal(panel.getAttribute('role'), 'menu')
  const labels = panel.children
    .filter((node) => node.className === 'dsh-mobile-menu-item')
    .map((node) => node.getAttribute('data-label'))
  // 面板只放「顶栏上没有的」入口：
  // 会话侧栏已由顶栏左侧的 ☰ 承担，不该在面板里重复出现；
  // 会话操作没有独立可用的原生入口，也暂不列入。
  assert.deepEqual(labels, ['查看轨迹', '新建工作区', '右侧面板'], '面板须容纳三个二级入口')

  // 隐藏节点必须不占位（否则顶栏被撑开、标题再被挤扁）。
  // 规则是跨行选择器列表，所以只断言「三组隐藏选择器 + display:none」都存在。
  assert.match(css, /\.dsh-mobile-bar>\.dsh-mobile-icon\[hidden\]/, '缺少 icon 隐藏选择器')
  assert.match(css, /\.dsh-mobile-bar>\.dsh-mobile-view\[hidden\]/, '缺少 view 隐藏选择器')
  assert.match(css, /\.dsh-mobile-bar>\.dsh-mobile-btn\[hidden\]\{display:none!important\}/, '隐藏入口必须 display:none')
})

test('桌面端模式下 DOM 突变不会反复触发无效同步且 sync 具备防重入保护', (t) => {
  const f = fixture()
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    MutationObserver: globalThis.MutationObserver,
  }
  globalThis.document = f.doc
  globalThis.window = f.win
  let takeRecordsCalled = 0
  class SpyingObserver extends f.Observer {
    takeRecords() {
      takeRecordsCalled++
      return []
    }
  }
  globalThis.MutationObserver = SpyingObserver
  t.after(() => {
    globalThis.document = previous.document
    globalThis.window = previous.window
    globalThis.MutationObserver = previous.MutationObserver
  })

  // 1. 在桌面端启动
  f.media.matches = false
  client.apply(f.ctx)

  assert.equal(takeRecordsCalled >= 1, true, 'sync 执行结束时调用了 takeRecords 清理自身引起的微任务')

  // 2. 在桌面端触发多次 DOM 突变，验证不会反复触发无意义的 DOM 重算
  const initialToggles = f.toggles()
  f.doc.notifyMutation?.()
  f.doc.notifyMutation?.()
  f.doc.notifyMutation?.()
  assert.equal(f.toggles(), initialToggles, '桌面端 settled 后连续突变不再触发无效重算')
})


test('the composer model bar renders cleanly without injecting fragile attributes', async (t) => {
  // 模型条在移动端始终作为单例精准插入在输入卡片上方，
  // 动效完全由纯 CSS 规则 html[data-ts-status] 接管，不在 DOM 节点上注入脆弱的 live 属性。
  const f = fixture()
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    MutationObserver: globalThis.MutationObserver,
  }
  globalThis.document = f.doc
  globalThis.window = f.win
  globalThis.MutationObserver = f.Observer
  t.after(() => {
    globalThis.document = previous.document
    globalThis.window = previous.window
    globalThis.MutationObserver = previous.MutationObserver
  })

  const infoOf = () => f.doc.composer.children.find((node) => node.className === 'dsh-mobile-composer-info')

  client.apply(f.ctx)
  const infoEl = infoOf()
  assert(infoEl, 'model bar renders in composer')
  assert.equal(infoEl.textContent, 'antigravity/gemini-3-flash · High')
  assert.equal(f.doc.composer.children.indexOf(infoEl) < f.doc.composer.children.indexOf(f.doc.card), true)

  // 幂等性：连续多次 DOM 突变，模型条绝不被重复复制
  f.doc.notifyMutation()
  f.doc.notifyMutation()
  assert.equal(f.doc.composer.children.filter((node) => node.className === 'dsh-mobile-composer-info').length, 1)
})

test('every status tier the theme studio offers has a pure CSS mirrored rule that overrides themes', async () => {
  // 档位清单必须与 dsh-theme-studio 的 STATUS_EFFECTS 完全对齐：
  // 模型和推理强度条完全跟随状态条效果，不跟主题。
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const start = source.indexOf('const css = `')
  const end = source.indexOf('\n    `', start)
  const body = source.slice(start, end)

  // 档位清单直接从 dsh-theme-studio 的源码读取
  const themeRoot = new URL('../../dsh-theme-studio/lib/settings.js', import.meta.url)
  const themeSource = await readFile(themeRoot, 'utf8')
  const declared = [...themeSource.matchAll(/\{ id: '([a-z]+)', label:/g)].map((m) => m[1])
  assert(declared.length >= 10, '未从 dsh-theme-studio 读到档位清单: ' + declared.join(','))
  const tiers = declared.filter((id) => id !== 'none')
  for (const tier of tiers) {
    assert.equal(body.includes(`html[data-ts-status="${tier}"]`), true,
      `移动端缺少 ${tier} 档的镜像规则`)
  }

  // 分层承载：胶囊底色与外圈呼吸环由 ::before 垫底承载（z-index:-1），与文字流光彻底分层，
  // 避免文字裁剪把胶囊底色涂在文本上导致发虚发糊
  assert.equal(body.includes('html[data-ts-status] .dsh-mobile-composer-info::before{content:""!important'), true,
    '缺少胶囊底色与呼吸环的分层承载规则')

  // ── 级联正确性（真实事故守卫）─────────────────────────────────────────────
  // 曾因基础规则用 :not([data-ts-status="none"]) 把特异性抬到 (0,3,1)，反压了
  // 流光档的 (0,2,1)：基础规则的 background:none 清掉了流光渐变，而
  // -webkit-text-fill-color:transparent 仍在生效 —— 表现为「文字整个消失，
  // 只剩一个空胶囊」。这里断言：对每个档位，最终胜出的 background 不能是 none。
  const specificity = (sel) => {
    let s2 = sel.replace(/:not\(/g, ' ').replace(/\)/g, ' ')
    const a = (s2.match(/#[\w-]+/g) || []).length
    const b = (s2.match(/\.[\w-]+/g) || []).length + (s2.match(/\[[^\]]+\]/g) || []).length
    const c = (s2.match(/(?:^|[\s>+~,])([a-z][a-z0-9]*)(?![\w-])/g) || []).length
    return [a, b, c]
  }
  const cmp = (x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2])

  // 稳健解析：先剥离注释（注释里的 { } 会破坏块边界），再按 } 回扫最近的 {，
  // 得到 (选择器文本, 块体)。shimmer / flow 这类跨行选择器组会被一并取出。
  const stripped = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n')
  const bgDecls = []
  let scan = 0
  while (true) {
    const close = stripped.indexOf('}', scan)
    if (close === -1) break
    const open = stripped.lastIndexOf('{', close)
    scan = close + 1
    if (open === -1) continue
    const selText = stripped.slice(stripped.lastIndexOf('}', open) + 1, open).trim()
    const blockBody = stripped.slice(open + 1, close)
    if (!selText.includes('dsh-mobile-composer-info')) continue
    const bg = blockBody.match(/background:([^;]+)/)
    if (!bg) continue
    for (const one of selText.split(',').map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean)) {
      if (!one.includes('dsh-mobile-composer-info')) continue
      if (one.includes('::before') || one.includes('::after')) continue
      bgDecls.push({ sel: one, value: bg[1].trim().replace(/!important$/, ''), spec: specificity(one) })
    }
  }
  assert(bgDecls.length >= 2, '未采集到背景声明: ' + JSON.stringify(bgDecls.map((d) => d.sel)))

  // 只有「用 background-clip:text 把字形掏空」的档位才必须由渐变赢得 background。
  // 其他档位靠不透明的 color 上色，background 为 none 完全正常——把它也判为错误
  // 会制造误报（pulse / whale / neon 等档位本就不需要背景）。
  const clipToTextTiers = new Set(['shimmer', 'flow'])

  for (const tier of tiers) {
    const matched = bgDecls.filter((d) => {
      const m = d.sel.match(/\[data-ts-status(?:="([a-z]+)")?\]/)
      if (!m) return false
      return m[1] === undefined || m[1] === tier
    })
    assert(matched.length > 0, `${tier} 档没有任何背景规则`)
    // 特异性优先；同特异性取源码靠后者
    let winner = matched[0]
    for (const d of matched.slice(1)) {
      const c = cmp(d.spec, winner.spec)
      if (c > 0 || c === 0) winner = d
    }
    if (clipToTextTiers.has(tier)) {
      assert.equal(winner.value.includes('linear-gradient'), true,
        `${tier} 档把字形裁空了，background 必须由流光渐变赢得，否则文字会整个消失。` +
        `实际胜出者: ${winner.sel.slice(0, 70)} => ${winner.value.slice(0, 40)}`)
    }
  }

  // 反之：任何把 -webkit-text-fill-color 设成 transparent 的档位，都必须同时让
  // 渐变赢得 background —— 这条把「掏空字形」与「提供渐变」绑死，杜绝再次出现
  // 「透明文字 + none 背景 = 空胶囊」。
  const hollowTiers = []
  const ruleBlocks = []
  {
    let scan2 = 0
    while (true) {
      const close = stripped.indexOf('}', scan2)
      if (close === -1) break
      const open = stripped.lastIndexOf('{', close)
      scan2 = close + 1
      if (open === -1) continue
      const selText = stripped.slice(stripped.lastIndexOf('}', open) + 1, open).trim()
      const blockBody = stripped.slice(open + 1, close)
      if (!selText.includes('dsh-mobile-composer-info')) continue
      ruleBlocks.push({ sel: selText, body: blockBody })
    }
  }
  for (const rb of ruleBlocks) {
    if (rb.sel.includes('::before') || rb.sel.includes('::after')) continue
    if (!/webkit-text-fill-color:\s*transparent/.test(rb.body)) continue
    for (const m of rb.sel.matchAll(/\[data-ts-status="([a-z]+)"\]/g)) hollowTiers.push(m[1])
  }
  for (const tier of hollowTiers) {
    const matched = bgDecls.filter((d) => {
      const m = d.sel.match(/\[data-ts-status(?:="([a-z]+)")?\]/)
      return m && (m[1] === undefined || m[1] === tier)
    })
    let winner = matched[0]
    for (const d of matched.slice(1)) {
      const c = cmp(d.spec, winner.spec)
      if (c > 0 || c === 0) winner = d
    }
    assert.equal(winner.value.includes('linear-gradient'), true,
      `${tier} 档把文字设成透明却让 background=${winner.value.slice(0, 30)} 胜出，` +
      '会导致字形完全不可见（空胶囊）')
  }
  assert(hollowTiers.length > 0, '未找到任何掏空字形的档位，解析可能有误')

  // 零侵入约定：所有镜像规则都必须以 html[data-ts-status 开头，没有它时一条都不命中。
  const statusRules = body.split('\n').filter((line) => line.includes('dsh-mobile-composer-info') && line.includes('data-ts-status'))
  assert(statusRules.length > 0)
  for (const line of statusRules) {
    const trimmed = line.trim()
    if (!trimmed.includes('html[data-ts-status')) continue
    assert.equal(trimmed.startsWith('html[data-ts-status'), true,
      '镜像规则必须以 data-ts-status 限定，否则会污染原生观感: ' + trimmed.slice(0, 80))
  }

  // 动效只碰合成器属性：镜像块里不得出现 width/height/padding 等布局属性的动画。
  const mirroredBlock = body.slice(body.indexOf('模型和推理强度条完全跟随'))
  assert.equal(/@keyframes dsh-mobile-status-[a-z]+\{[^}]*(width|height|padding|margin):/.test(mirroredBlock), false,
    '状态栏动效不得动画化布局属性')
  assert.equal(mirroredBlock.includes('prefers-reduced-motion'), true,
    '镜像必须尊重减弱动效偏好')
  assert.equal(mirroredBlock.includes('prefers-contrast'), true,
    '镜像必须尊重高对比偏好')
})

test('移动端模型菜单悬浮窗按语义属性停靠在底部输入栏上方，不依赖任何构建哈希', async (t) => {
  // 悬浮窗必须用 position: fixed + bottom/right !important 强制停靠在底部右侧，
  // 杜绝宿主 place() 在移动端把浮层错误定位到屏幕中央。
  // 选择器锚定 aria-label 语义而不是类名哈希：宿主每次构建都换哈希，
  // 写死哈希会让这条规则在换代当天静默失效（浮层回到屏幕中央）。
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(
    source,
    /\[role="menu"\]\[aria-label\*="模型" i\]:not\(:has\(\[role="menuitem"\],\[role="menuitemradio"\]\)\)[^{]*\{position:fixed!important;top:auto!important;bottom:calc\(64px \+ var\(--dsh-keyboard-inset,0px\) \+ var\(--dsh-sab,0px\)\)!important;right:12px!important;left:auto!important;/,
    '必须包含 fixed + bottom/right 的强制停靠规则，且锚定 aria-label 语义并排除内层滚动区',
  )

  // DOM 提取：宿主换代后类名哈希变了（_7KE1Ra_* → _9r0rkG_*），
  // 靠 [class*="triggerLabel"] 兜底仍应取到模型名。
  const f = fixture()
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    MutationObserver: globalThis.MutationObserver,
  }
  globalThis.document = f.doc
  globalThis.window = f.win
  globalThis.MutationObserver = f.Observer
  t.after(() => {
    globalThis.document = previous.document
    globalThis.window = previous.window
    globalThis.MutationObserver = previous.MutationObserver
  })

  // 模拟换代后的宿主结构：旧哈希已不存在
  f.doc.modelLabel.className = 'SomeNew1_triggerLabel'
  f.doc.effortLabel.className = 'SomeNew1_triggerEffort'
  const prevQuery = f.doc.querySelector.bind(f.doc)
  f.doc.querySelector = (selector) => {
    if (selector.includes('class*="triggerLabel"')) return f.doc.modelLabel
    if (selector.includes('class*="triggerEffort"')) return f.doc.effortLabel
    if (selector.includes('triggerLabel')) return null
    if (selector.includes('triggerEffort')) return null
    return prevQuery(selector)
  }

  client.apply(f.ctx)
  const infoEl = f.doc.composer.children.find((node) => node.className === 'dsh-mobile-composer-info')
  assert.ok(infoEl, '换代后的类名下模型条必须仍能渲染（靠 class*= 语义兜底）')
  assert.equal(infoEl.textContent, 'antigravity/gemini-3-flash · High')
})

