/**
 * The safe-path dialog's built-in workspace list starts folded.
 *
 * That list is reference material — it says "these directories are already
 * allowed, you do not need to add them" — and the user cannot edit it there. On
 * a machine with a dozen registered workspaces it pushed the paths the user does
 * manage off the panel entirely, so it opens closed and remembers being opened.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const clientSource = readFileSync(path.join(root, 'lib/client.js'), 'utf8')

const { JSDOM } = require('jsdom')

/**
 * Load the client bundle against a throwaway document.
 * @param {object} [options] - overrides.
 * @param {string} [options.storage] - prefilled localStorage entry, as "k=v".
 * @returns {object} internals plus the window for localStorage assertions.
 */
function loadInternals(options = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  })
  if (typeof options.storage === 'string' && options.storage !== '') {
    const at = options.storage.indexOf('=')
    dom.window.localStorage.setItem(options.storage.slice(0, at), options.storage.slice(at + 1))
  }
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    localStorage: dom.window.localStorage,
  })) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  let definition
  dom.window.__ModuleLoader__ = { load(value) { definition = value } }
  new Function('window', clientSource)(dom.window)
  const bundle = definition.factory((id) => (
    id === 'react' ? { createElement: () => null } : new Proxy({}, { get: () => () => null })
  ))
  return { internals: bundle.internals, window: dom.window }
}

test('the workspace list is closed until the user opens it', () => {
  const { internals } = loadInternals()
  assert.equal(internals.readWorkspacesOpen(), false, 'first visit starts folded')
})

test('the workspace list remembers being opened, in both directions', () => {
  for (const startOpen of [true, false]) {
    const { internals, window } = loadInternals({
      storage: `${'dsh-file-viewer.workspaces-open'}=${String(startOpen)}`,
    })
    assert.equal(internals.readWorkspacesOpen(), startOpen, `starts ${startOpen ? 'open' : 'closed'}`)

    // Flip it, then read the stored value back: the toggle must persist what it
    // just showed, or the dialog would reopen in the other state than the user
    // left it in.
    const next = !startOpen
    internals.writeWorkspacesOpen(next)
    assert.equal(window.localStorage.getItem('dsh-file-viewer.workspaces-open'), String(next))
    assert.equal(internals.readWorkspacesOpen(), next)
  }
})

test('the workspace fold is not the sidebar fold', () => {
  // Sharing the key would make collapsing the sidebar silently collapse this
  // dialog section too — and vice versa, which is far more confusing.
  assert.notEqual(internals_key('TREE_COLLAPSED_KEY'), internals_key('WORKSPACES_OPEN_KEY'))
  const { internals } = loadInternals({ storage: 'dsh-file-viewer.tree-collapsed=true' })
  assert.equal(internals.readWorkspacesOpen(), false, 'a collapsed sidebar does not open this list')
})

/**
 * Read one exported storage key by name from a freshly loaded bundle.
 * @param {string} name - export name.
 * @returns {string} the key literal.
 */
function internals_key(name) {
  const { internals } = loadInternals()
  return internals[name]
}

test('the toggle is a real disclosure control', () => {
  // A plain title span looked like a heading, so nobody clicked it. The control
  // has to be a button with aria-expanded and an owning relationship.
  assert.match(clientSource, /className: "fv-ws-toggle"/)
  assert.match(clientSource, /"aria-expanded": workspacesOpen \? "true" : "false"/)
  assert.match(clientSource, /"aria-controls": "fv-workspaces-list"/)
  assert.match(clientSource, /writeWorkspacesOpen\(next\)/)
})

test('the folded state hides the list rather than merely shrinking it', () => {
  // The point of folding is reclaiming panel height, so the rows must not be
  // rendered at all when closed — a CSS collapse would still take the space.
  const section = clientSource.slice(
    clientSource.indexOf('const workspacesSection'),
    clientSource.indexOf('const safePathsList'),
  )
  assert.match(section, /workspacesOpen\s*\?\s*react\.createElement\(react\.Fragment/)
  assert.match(section, /: null\);/)
})
