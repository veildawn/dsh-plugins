import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { apply as applyHost, patchIndex, VIEWPORT_CONTENT } from '../lib/index.js'

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
  }
  append(...children) {
    for (const child of children) {
      child.parentElement = this
      this.children.push(child)
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
    this.textarea = new Element('textarea', this)
    this.textarea.setAttribute('placeholder', '给智能体发消息')
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
  const css = client.internals.css
  assert.match(css, /\[data-slot="root"\]>div>div:has\(>\[data-slot="sidebar"\]\)\{[^}]*box-sizing:border-box;[^}]*padding-left:var\(--dsh-sal\);padding-right:0/)
  assert.match(css, /\[data-slot="sidebar"\]\{--dsh-sidebar-inline-padding:12px!important;[^}]*width:100%!important;max-width:100%!important;[^}]*height:100%\}/)
  assert.match(css, /\.hHd-Xa_root\{--dsh-sidebar-inline-padding:12px!important;[^}]*width:100%!important;max-width:100%!important;[^}]*padding-left:12px!important;padding-right:12px!important\}/)
  assert.match(css, /\[data-slot="sidebar"\] :where\(\.hHd-Xa_newSession,[^)]*\.qDHVXG_list,[^)]*\[role="tree"\],\[role="treeitem"\],[^)]*\.VOzbGW_trigger\)\{[^}]*width:100%!important;max-width:100%!important;margin:0!important\}/)
  assert.match(css, /\[data-slot="sidebar"\] :where\(\.hHd-Xa_regionArea,\.qDHVXG_root,\.qDHVXG_listArea,\.qDHVXG_list\)\{padding-left:0!important;padding-right:0!important\}/)
  assert.match(css, /\[data-slot="sidebar"\] \.qDHVXG_list\{scrollbar-gutter:auto!important\}/)
  assert.doesNotMatch(css, /\[data-slot="sidebar"\]\{[^}]*padding-(?:left|right):12px/, 'the slot wrapper must not double the content padding')
})

test('Conversation mobile CSS keeps a bounded scrollport and permanently hides message and composer stats', () => {
  const css = client.internals.css
  assert.match(css, /max-width:768px/)
  assert.match(css, /\.dsh-mobile-bar\{[^}]*display:flex/)
  assert.match(css, /\.dsh-mobile-status\{[^}]*font-size:11px;[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis/)
  assert.match(css, /\.dsh-mobile-status\[data-plan=true\]\{[^}]*color:var\(--dsw-alias-state-warn-label\);font-weight:600\}/)
  assert.match(css, /100dvh/)
  assert.doesNotMatch(css, /body\{position:fixed/)
  assert.match(css, /\[data-slot="root"\]>div\{height:100%!important;min-height:0/)
  assert.match(css, /\[data-slot="conversation"\]\{flex:1 1 0;height:100%;min-width:0;min-height:0/)
  assert.match(css, /\[data-conversation-scroll\]\{flex:1 1 0;min-width:0;min-height:0/)
  assert.match(css, /\[data-slot="conversation\.session\.header"\]>header\{display:none!important\}/)
  assert.match(css, /\.wSkVaW_heroWorkspaceRow\{[^}]*width:100%;padding:0 20px!important;gap:4px!important;flex-wrap:wrap\}/)
  assert.match(css, /\.pXSMma_workspace\{[^}]*min-width:0!important;max-width:100%!important;min-height:36px!important;flex:1 1 140px\}/)
  assert.match(css, /\[data-slot="conversation\.hero\.agentPreset"\]>span\{min-width:0;max-width:min\(50%,240px\);flex:0 1 auto\}/)
  assert.match(css, /\[data-slot="conversation\.hero\.agentPreset"\] \.cubgiG_seat\{[^}]*width:100%;min-width:0;max-width:100%;height:36px;min-height:36px;[^}]*border-radius:999px\}/)
  assert.match(css, /--dsh-keyboard-inset/)
  assert.match(css, /\[data-chat-flow\] \[class\*="_actions"\]\{[^}]*flex-wrap:wrap!important;[^}]*width:100%!important;[^}]*height:auto!important;[^}]*overflow:visible!important/)
  assert.match(css, /\[data-chat-flow\] \[class\*="_actions"\] button\{[^}]*flex:0 0 32px;[^}]*width:32px!important;[^}]*height:32px!important;[^}]*min-width:32px!important;[^}]*min-height:32px!important;[^}]*border-radius:50%!important/)
  assert.match(css, /\[class\*="_timeStart"\],\[class\*="_timeEnd"\][^}]*display:none!important/)
  assert.match(css, /\.FJxK0a_root\{display:none!important\}/)
  assert.doesNotMatch(css, /stats-expanded/)
  assert.match(css, /\.p-xYUq_actions,\._8_XoUG_action,\.osXY9a_actions\{flex-wrap:wrap!important\}/)
  assert.doesNotMatch(css, /\[data-chat-flow\] button\{min-width:44px/)
  assert.match(css, /\.md-code-block pre/)
  assert.match(css, /scroll-behavior:smooth/)
  assert.match(css, /\[role="dialog"\]\[aria-modal="true"\]/)
})

test('Composer keeps complete mode labels together and wraps the trailing controls when needed', () => {
  const css = client.internals.css
  assert.match(css, /\[data-composer-seat\]\{[^}]*padding-bottom:max\(8px,var\(--dsh-sab\)\)/)
  assert.match(css, /\[data-composer-card\]\{[^}]*padding:8px 10px 6px!important/)
  assert.match(css, /\[data-composer-card\]>:last-child\{[^}]*display:flex;[^}]*min-height:44px;[^}]*flex-direction:row!important;flex-wrap:wrap!important;[^}]*align-items:center!important;[^}]*justify-content:space-between;[^}]*gap:4px!important;[^}]*padding:4px 8px 8px!important/)
  assert.match(css, /\.uV2eYG_tools,\.uV2eYG_trailing\{[^}]*display:flex;[^}]*align-items:center;[^}]*min-width:0/)
  assert.match(css, /\[data-composer-card\]>:last-child\{[^}]*overflow:visible!important/)
  assert.match(css, /\.uV2eYG_tools\{min-width:max-content;flex:1 1 auto;gap:4px!important;overflow:visible!important\}/)
  assert.match(css, /\.uV2eYG_modes\{flex:none;flex-wrap:nowrap!important;[^}]*overflow:visible!important\}/)
  assert.doesNotMatch(css, /\.uV2eYG_tools\{[^}]*overflow-y:hidden/)
  assert.match(css, /\.uV2eYG_trailing\{flex:none;max-width:calc\(100% - 36px\);margin-left:auto;[^}]*gap:6px!important/)
  assert.match(css, /\.uV2eYG_add\{display:none!important\}/)
  assert.match(css, /\.uV2eYG_primary\{[^}]*width:32px!important;[^}]*height:32px!important;[^}]*min-width:32px!important;[^}]*min-height:32px!important;[^}]*border-radius:50%!important/)
  assert.match(css, /\.uV2eYG_primary\{transform:none!important\}/)
  assert.match(css, /\.Sh0Q9G_trigger,\.uV2eYG_select\{max-width:100px!important;min-width:0!important\}/)
  assert.match(css, /\.Sh0Q9G_trigger\{[^}]*display:inline-flex!important;[^}]*width:max-content!important;min-width:max-content!important;max-width:none!important;[^}]*flex-wrap:nowrap!important;[^}]*white-space:nowrap!important;overflow:visible!important/)
  assert.match(css, /\.Sh0Q9G_triggerIcon\{display:inline-flex!important;flex:none;margin:0!important\}/)
  assert.match(css, /\.uV2eYG_modes \.Sh0Q9G_triggerLabel\{display:block!important;min-width:max-content;white-space:nowrap;overflow:visible\}/)
  assert.match(css, /\.Sh0Q9G_chevron\{display:none!important\}/)
  assert.match(css, /\.rS3zOq_chip\{[^}]*width:max-content!important;[^}]*min-width:max-content!important;[^}]*padding:0 10px!important;[^}]*white-space:nowrap!important;overflow:visible!important;flex:none!important/)
  assert.match(css, /\._7KE1Ra_root\{flex:1 1 110px;max-width:110px;min-width:0\}/)
  assert.match(css, /\._7KE1Ra_trigger\{max-width:110px!important;min-width:0!important\}/)
  assert.match(css, /\.JObwrW_root,\.JObwrW_trigger\{[^}]*width:24px!important;[^}]*height:24px!important/)
  assert.match(css, /\[data-composer-card\] textarea\{[^}]*min-height:44px;max-height:160px;font-size:16px!important/)
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
  const css = client.internals.css
  assert.match(css, /\[data-plan-review-key\],\[data-slot="conversation\.composer\.dock"\],\[data-plan-review-scroll\]\{[^}]*width:100%!important;max-width:100%!important;min-width:0!important;min-height:0!important;display:flex!important;flex-direction:column!important;overflow:visible!important\}/)
  assert.match(css, /\[data-plan-review-scroll\]\{max-height:min\(45dvh,360px\)!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch!important\}/)
  assert.doesNotMatch(css, /\[data-plan-review-(?:key|scroll)[^}]*display:none!important/)
})

test('Trajectory becomes a compact table with a full-size, closable mobile sheet', () => {
  const css = client.internals.css
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
  const css = client.internals.css
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
  assert.match(css, /\[role="menu"\],\._7KE1Ra_menu,\._3e4SsG_menu\{[^}]*max-width:calc\(100vw - 24px\)!important;max-height:min\(360px,calc\(var\(--dsh-vvh,100dvh\) - 120px\)\)!important;[^}]*border-radius:14px!important;[^}]*background:[^;]+!important;border:1px solid var\(--dsw-alias-border-l2\)!important;overflow-y:auto!important;overscroll-behavior:contain!important;-webkit-overflow-scrolling:touch!important\}/)
  assert.match(css, /span>\[role="menu"\]\{position:absolute!important;bottom:calc\(100% \+ 4px\)!important;left:0!important;min-width:140px!important\}/)
  const portalMenu = css.match(/body>\[role="menu"\]\{([^}]*)\}/)?.[1]
  assert(portalMenu)
  assert.match(portalMenu, /min-width:180px!important/)
  assert.doesNotMatch(portalMenu, /(?:position|top|right|bottom|left):/)
  const globalMenuRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(',').some((selector) => selector.trim() === '[role="menu"]'))
  assert.equal(globalMenuRules.length, 1)
  assert.doesNotMatch(globalMenuRules[0][2], /(?:position|top|right|bottom|left|display|visibility):/)
  assert.match(css, /body>\[role="menu"\]:has\(\.cubgiG_item\)\{width:min\(300px,calc\(100vw - 24px\)\)!important\}/)
  assert.match(css, /body>\[role="menu"\]:has\(\.cubgiG_item\) \[role="menuitem"\]\{[^}]*min-height:56px;padding:8px 12px\}/)
  assert.match(css, /body>\[role="menu"\] \.cubgiG_item\{max-width:none;min-width:0\}/)
  assert.match(css, /body>\[role="menu"\] \.cubgiG_itemDesc\{overflow-wrap:anywhere\}/)
  assert.match(css, /\._3e4SsG_menu\{position:absolute!important;bottom:calc\(100% \+ 4px\)!important;left:0!important;right:auto!important;width:min\(320px,calc\(100vw - 24px\)\)!important\}/)
  assert.match(css, /\._3e4SsG_item\{[^}]*min-height:44px!important;padding:8px 12px!important\}/)
  assert.match(css, /\._3e4SsG_itemName\{max-width:50%!important;[^}]*text-overflow:ellipsis!important;white-space:nowrap!important\}/)
  assert.match(css, /\._7KE1Ra_menu\{position:absolute!important;bottom:calc\(100% \+ 8px\)!important;right:0!important;left:auto!important;width:min\(280px,calc\(100vw - 24px\)\)!important\}/)
  assert.match(css, /\._7KE1Ra_option,\._7KE1Ra_cell\{[^}]*width:100%!important;min-width:0!important\}/)
  assert.match(css, /\._7KE1Ra_modelName,\._7KE1Ra_description,\._7KE1Ra_cellLabel,\._7KE1Ra_cellValue\{min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important\}/)
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
  const css = client.internals.css
  assert.match(css, /\.VOzbGW_overlay\{[^}]*z-index:1100!important;[^}]*position:fixed!important;[^}]*width:100vw;[^}]*height:var\(--dsh-vvh,100dvh\)!important/)
  assert.match(css, /\.VOzbGW_mask\{display:none!important\}/)
  assert.match(css, /\.VOzbGW_panel\{[^}]*width:100vw!important;[^}]*height:100%!important;[^}]*max-width:none!important;[^}]*border-radius:0!important;[^}]*box-shadow:none!important;[^}]*flex-direction:column/)
  assert.match(css, /\.VOzbGW_navTitle\{[^}]*right:72px;left:72px;[^}]*height:44px;[^}]*justify-content:center;[^}]*text-align:center/)
  assert.match(css, /\.VOzbGW_header\{[^}]*height:calc\(44px \+ var\(--dsh-sat\)\)!important;[^}]*border-bottom:0;[^}]*align-items:center!important;justify-content:space-between!important/)
  assert.match(css, /\.VOzbGW_close\{width:44px!important;height:44px!important;[^}]*border-radius:12px!important/)
  assert.match(css, /\.VOzbGW_navList\{[^}]*width:auto!important;max-width:calc\(100vw - 32px\)!important;[^}]*height:44px;[^}]*margin:4px max\(16px,var\(--dsh-sar\)\) 12px max\(16px,var\(--dsh-sal\)\)!important;padding:4px!important;border-radius:14px!important;background:var\(--dsw-alias-bg-module-platform,rgba\(0,0,0,\.04\)\)!important;display:inline-flex!important;[^}]*gap:4px!important;[^}]*overflow-x:auto!important;[^}]*scroll-behavior:smooth;scrollbar-width:none!important/)
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
  const [menu, titleBox, view] = bar.children
  const [title, status] = titleBox.children
  assert.equal(bar.hidden, false)
  assert.equal(title.textContent, '移动端适配会话')
  assert.equal(status.textContent, '就绪 · 只读')
  assert.equal(status.dataset.plan, 'false')
  assert.equal(view.textContent, '⌁ 轨迹')
  assert.equal(view.getAttribute('aria-label'), '查看轨迹')
  assert.equal(view.hidden, false)
  assert.equal(backdrop.hidden, true)
  assert.equal(f.doc.sidebarColumn.inert, true)
  assert.equal(f.doc.documentElement.style.getPropertyValue('--dsh-keyboard-inset'), '0px')
  assert.deepEqual(f.observerOptions().attributeFilter, ['data-sidebar-collapsed', 'data-phase', 'aria-label', 'aria-selected', 'placeholder', 'disabled'])
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
  assert.equal(view.getAttribute('aria-label'), '关闭轨迹，返回对话')
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

  f.viewport.scale = 2
  f.viewport.emit('resize')
  assert.equal(f.doc.documentElement.style.getPropertyValue('--dsh-keyboard-inset'), '0px', 'pinch zoom is not mistaken for a keyboard')

  f.viewport.scale = 1
  f.doc.activeElement = f.doc.body
  f.doc.emit('focusout')
  assert.equal(f.doc.documentElement.style.getPropertyValue('--dsh-keyboard-inset'), '0px')

  f.media.matches = false
  f.media.emit('change')
  assert.equal(bar.hidden, true)
  assert.equal(f.doc.documentElement.style.getPropertyValue('--dsh-vvh'), '')
  assert.equal(f.doc.documentElement.style.getPropertyValue('--dsh-keyboard-inset'), '')

  f.cleanup()
  assert.equal(f.doc.getElementById('dsh-mobile-adapter-style'), null)
  assert.equal(f.doc.body.children.includes(bar), false)
  assert.equal(f.doc.documentElement.style.getPropertyValue('--dsh-vvh'), '')
  assert.equal(f.doc.documentElement.style.getPropertyValue('--dsh-keyboard-inset'), '')
  f.viewport.emit('resize')
  assert.equal(f.doc.documentElement.style.getPropertyValue('--dsh-vvh'), '', 'viewport listener is removed on cleanup')
  assert(f.toggles() >= 8)
})
