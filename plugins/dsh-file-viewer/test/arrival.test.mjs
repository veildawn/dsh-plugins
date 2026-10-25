import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * Behavioural tests for the drawer's arrival path.
 *
 * The package tests assert the SOURCE SHAPE of the two effects that used to
 * fight over the tab list, which is exactly the kind of check that stays green
 * while the running code is wrong: both effects looked correct on their own, and
 * only their real execution order (React 18, automatic batching, real commit
 * ordering) produced the bug. So this file mounts the actual registered overlay
 * component with real React and clicks a file the way a conversation link does.
 *
 * Everything the component needs from the host — the RPC carrier, the slot
 * registry — is a small fake; the component itself is the shipped bundle.
 */
const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))

/**
 * React only implements `act` in its development build, and `react-dom` picks
 * that build the first time it is imported. The runner starts without NODE_ENV,
 * which would resolve to the production build and make every `act` call throw.
 *
 * This is set before any `require('react')` below — the react packages are
 * loaded lazily inside the helpers on purpose, so nothing has been resolved yet
 * when this line runs. Doing it here rather than in the npm script keeps the
 * suite working however it is invoked (`node --test`, an IDE, a single file).
 */
process.env.NODE_ENV = 'development'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Install a DOM and hand back the modules that need it.
 *
 * React reads `window`/`document` at import time, so the globals have to be in
 * place before `react-dom/client` is loaded. They are installed once per process
 * because `react-dom` caches its environment on first import.
 */
async function loadDom() {
  if (globalThis.document !== undefined) return
  const { JSDOM } = require('jsdom')
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
  })
  // `navigator` is a read-only accessor on modern Node, so a plain assignment
  // throws; define it like the other globals React probes for.
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver,
    requestAnimationFrame: dom.window.requestAnimationFrame,
    cancelAnimationFrame: dom.window.cancelAnimationFrame,
    getComputedStyle: dom.window.getComputedStyle,
    // `act` refuses to run outside an act-enabled environment. React reads this
    // flag off `globalThis` on every call, so it must survive for the whole file.
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    })
  }
}

/**
 * Evaluate the shipped bundle and hand back its module exports.
 *
 * The bundle registers itself with the host's loader off `window` rather than
 * exporting anything, so it has to be run with that shape in place. `react` is
 * forwarded to the real library (the component is driven, not just rendered),
 * and the primitives package is stubbed: `ReadBlock` and friends are the host's
 * renderers, not this plugin's logic.
 */
function loadBundle() {
  const React = require('react')
  const source = readFileSync(root + 'lib/client.js', 'utf8')
  let definition
  const previous = globalThis.window.__ModuleLoader__
  globalThis.window.__ModuleLoader__ = { load(value) { definition = value } }
  try {
    new Function('window', source)(globalThis.window)
  } finally {
    if (previous === undefined) delete globalThis.window.__ModuleLoader__
    else globalThis.window.__ModuleLoader__ = previous
  }
  const Placeholder = (props) => React.createElement('div', { 'data-stub': 'block' },
    props && Array.isArray(props.lines) ? props.lines.join('\n') : '')
  const primitives = new Proxy({}, {
    get: (_target, key) => {
      if (key === 'writeClipboard') return () => Promise.resolve(true)
      if (key === 'ReadBlock' || key === 'MarkdownText' || key === 'JsonTree' || key === 'DiffBlock') return Placeholder
      return null
    },
  })
  const reactShim = {
    createElement: React.createElement,
    cloneElement: React.cloneElement,
    Fragment: React.Fragment,
    Children: React.Children,
    isValidElement: React.isValidElement,
    useState: React.useState,
    useEffect: React.useEffect,
    useLayoutEffect: React.useLayoutEffect,
    useRef: React.useRef,
    useMemo: React.useMemo,
    useCallback: React.useCallback,
    useReducer: React.useReducer,
    useContext: React.useContext,
    useId: React.useId,
    useTransition: React.useTransition,
    useDeferredValue: React.useDeferredValue,
    useSyncExternalStore: React.useSyncExternalStore,
    useImperativeHandle: React.useImperativeHandle,
    createContext: React.createContext,
    createRef: React.createRef,
    memo: React.memo,
    forwardRef: React.forwardRef,
    Component: React.Component,
    PureComponent: React.PureComponent,
    StrictMode: React.StrictMode,
    Suspense: React.Suspense,
    startTransition: React.startTransition,
  }
  return definition.factory((id) => (id === 'react' ? reactShim : primitives))
}

/**
 * A host fake that answers just enough RPC to render one text file.
 *
 * `roots` is the interesting one: it reports the workspace root, the directory to
 * reveal, and the file the arrival path asked for — the exact payload a
 * conversation link produces. `listings` lets a test describe a real tree, which
 * is what the tab ↔ tree link needs: a highlight can only be observed on a row
 * that actually exists.
 */
function createHost({ filePath = 'src/a.ts', rootId = '/ws', listings = null, reveal = 'src' } = {}) {
  const calls = []
  const registrations = []
  // Default: one flat directory, which is all the older tests need.
  const tree = listings ?? { '': [] }
  const entryOf = (dirPath, entry) => ({
    name: entry.split('/').pop(),
    // The host reports root-relative paths, so a child of `src` is `src/lib`,
    // not `lib`. Building it from the bare name here would make the tree
    // disagree with the tab about which path is open.
    path: dirPath === '' ? entry : `${dirPath}/${entry}`,
    type: entry.includes('.') ? 'file' : 'directory',
    kind: 'text',
    size: 11,
  })
  const host = {
    calls,
    registrations,
    ctx: {
      slots: {
        inject: (_name, fn) => {
          try { fn() } catch { /* the seat itself is irrelevant here */ }
        },
        register: (spec, component) => {
          registrations.push({ spec, component })
          return {}
        },
      },
      connection: {
        rpc: {
          call: async (_channel, method, payload) => {
            calls.push({ method, payload })
            if (method === 'roots') {
              return {
                ok: true,
                value: {
                  roots: [{ id: rootId, path: rootId, label: 'ws' }],
                  root: rootId,
                  reveal,
                  // Mirror the host: the payload names the file to select, so a
                  // second open on another path must not resolve back to the
                  // first one.
                  selectFile: typeof payload.filePath === 'string' ? payload.filePath : filePath,
                },
              }
            }
            if (method === 'meta') {
              return {
                ok: true,
                value: {
                  path: payload.path,
                  displayPath: payload.path,
                  name: payload.path.split('/').pop(),
                  kind: 'text',
                  size: 11,
                  lang: 'ts',
                },
              }
            }
            if (method === 'read') {
              return {
                ok: true,
                value: {
                  path: payload.path,
                  name: payload.path.split('/').pop(),
                  kind: 'text',
                  lines: ['const a = 1'],
                  totalLines: 1,
                  offset: 1,
                  end: 1,
                  hasBefore: false,
                  hasAfter: false,
                  lang: 'ts',
                  text: 'const a = 1',
                },
              }
            }
            if (method === 'diff') return { ok: true, value: { hasDiff: false, diffs: [] } }
            if (method === 'status') return { ok: true, value: { modified: [], untracked: [] } }
            if (method === 'list') {
              const children = tree[payload.path] ?? []
              return { ok: true, value: { entries: children.map((child) => entryOf(payload.path, child)) } }
            }
            if (method === 'languages') return { ok: true, value: { languages: [] } }
            return { ok: true, value: {} }
          },
        },
        api: {},
      },
      logger: { warn() {}, info() {}, debug() {} },
      get: () => undefined,
      inject: () => {},
    },
  }
  return host
}

/**
 * Mount the registered overlay and drive one arrival.
 *
 * Returns what the reader would see: which pane is on screen, which tabs exist,
 * whether the content area shows the file rather than an empty prompt, and —
 * the point of the tab ↔ tree link — which tree row is highlighted.
 */
async function driveArrival(options) {
  await loadDom()
  const React = require('react')
  const { createRoot } = require('react-dom/client')
  const bundle = loadBundle()
  const host = createHost(options)
  bundle.apply(host.ctx)

  const overlay = host.registrations.find((row) => row.spec.name === 'shell.overlay')
  assert(overlay, 'the overlay seat must be registered')

  const container = globalThis.document.createElement('div')
  globalThis.document.body.appendChild(container)
  const reactRoot = createRoot(container)
  // Rows the tree currently marks as "this is the file on screen". Read off the
  // rendered DOM, not off the source, because the whole bug being guarded here
  // was a rule that looked right and never matched an element.
  const highlighted = () => [...container.querySelectorAll('.fv-tree .fv-row-seat[aria-current="true"]')]
    .map((seat) => seat.getAttribute('data-path'))
  try {
    await React.act(async () => {
      reactRoot.render(React.createElement(overlay.component))
    })
    await React.act(async () => { await sleep(20) })

    // The click that used to do nothing: open the drawer on one path.
    await React.act(async () => {
      globalThis.window.__dsh_open_file_viewer({ filePath: options?.filePath ?? 'src/a.ts' })
      await sleep(80)
    })

    // A second click, the way a reader moves between open files.
    if (typeof options?.thenClick === 'string') {
      await React.act(async () => {
        globalThis.window.__dsh_open_file_viewer({ filePath: options.thenClick })
        await sleep(80)
      })
    }

    const scrim = container.querySelector('.fv-scrim')
    const body = container.querySelector('.fv-body')
    const tabCells = [...container.querySelectorAll('.fv-tab-cell')]
    // Resolve the paint rule against the live DOM before the container is torn
    // down: a rule that exists but matches nothing is exactly the regression.
    const seat = container.querySelector('.fv-tree .fv-row-seat[aria-current="true"]')
    return {
      opened: scrim !== null,
      pane: body === null ? null : body.getAttribute('data-pane'),
      tabs: tabCells.map((cell) => cell.getAttribute('title')),
      activeTabs: tabCells
        .filter((cell) => cell.getAttribute('aria-selected') === 'true')
        .map((cell) => cell.getAttribute('title')),
      highlighted: highlighted(),
      // Whether the highlighted seat is one the stylesheet's `.fv-row-seat > .fv-row`
      // rule can reach — i.e. whether the row would actually be painted.
      seatHasPaintableRow: seat !== null && seat.querySelector(':scope > .fv-row') !== null,
      // The stylesheet the bundle installs, so a test can check the rule itself.
      stylesheet: globalThis.document.getElementById('dsh-file-viewer-styles')?.textContent
        ?? [...globalThis.document.querySelectorAll('style')].map((tag) => tag.textContent).join('\n'),
      treeRows: [...container.querySelectorAll('.fv-tree .fv-row-seat[data-path]')]
        .map((seat) => seat.getAttribute('data-path')),
      note: container.querySelector('.fv-note')?.textContent ?? '',
      calls: host.calls.map((call) => call.method),
    }
  } finally {
    await React.act(async () => { reactRoot.unmount() })
    container.remove()
  }
}

test('the first click on a file path opens that file, not an empty pane', async () => {
  const seen = await driveArrival({ filePath: 'src/a.ts' })

  assert.equal(seen.opened, true, 'the drawer must open')
  // The regression: the tree-building effect re-ran on the commit that resolved
  // `root`, cleared the tabs the arrival had just opened, and left the drawer on
  // the tree pane. The reader had to click a second time to get anywhere.
  assert.equal(seen.pane, 'content', 'arriving on a file must land on the content pane')
  assert.deepEqual(seen.tabs, ['src/a.ts'], 'the file must be open in a tab on the first click')
  assert.equal(seen.note.includes('从左侧选择一个文件'), false, 'the pane must not ask the reader to pick a file')
  // And the file was actually read, so this is a loaded preview rather than a
  // tab that merely exists.
  assert.equal(seen.calls.includes('meta'), true, 'the arrival must read the file metadata')
})

test('the tree highlights the file the open tab is showing', async () => {
  // A real tree: the file lives two directories down, so its row can only be
  // highlighted if the tree actually opens the path to it.
  const seen = await driveArrival({
    filePath: 'src/lib/a.ts',
    reveal: '',
    listings: {
      '': ['src'],
      src: ['lib'],
      'src/lib': ['a.ts'],
    },
  })

  assert.equal(seen.opened, true, 'the drawer must open')
  assert.deepEqual(seen.activeTabs, ['src/lib/a.ts'], 'the file must be the active tab')
  // The link itself: exactly one row is marked, and it is the open file.
  assert.deepEqual(seen.highlighted, ['src/lib/a.ts'], 'the tree must highlight the open file')
  // A highlight is worthless on a row that is not rendered, so the ancestors
  // had to open for it to exist at all.
  assert.deepEqual(seen.treeRows, ['src', 'src/lib', 'src/lib/a.ts'], 'the path to the file must be open')

  // And the rule that paints it must actually select the rendered element. The
  // shipped regression was exactly this: `aria-current` was rendered on the row
  // SEAT while the rule only matched the inner `.fv-row`, so every assertion
  // about "the attribute is set" passed while no row was ever highlighted.
  assert.match(
    seen.stylesheet,
    /\.fv-row-seat\[aria-current="true"\]>\.fv-row/,
    'the stylesheet must target the seat that carries the attribute',
  )
  // The row that the browser would paint is the row we marked: prove the
  // selector resolves against the live DOM, not just against the CSS text.
  assert.equal(seen.seatHasPaintableRow, true, 'the highlighted seat must contain the row the rule paints')
})

test('switching tabs moves the highlight with the tab, not the last click', async () => {
  const seen = await driveArrival({
    filePath: 'src/a.ts',
    reveal: '',
    listings: { '': ['src'], src: ['a.ts', 'b.ts'] },
    thenClick: 'src/b.ts',
  })

  // Both files are open, the second is on screen, and the tree agrees with the
  // tab strip instead of remembering whichever row was pressed last.
  assert.deepEqual(seen.tabs, ['src/a.ts', 'src/b.ts'])
  assert.deepEqual(seen.activeTabs, ['src/b.ts'], 'the second file must be the active tab')
  assert.deepEqual(seen.highlighted, ['src/b.ts'], 'the highlight must follow the active tab')
})

test('closing the active tab clears or moves the highlight with it', async () => {
  await loadDom()
  const React = require('react')
  const { createRoot } = require('react-dom/client')
  const bundle = loadBundle()
  const host = createHost({
    filePath: 'src/a.ts',
    reveal: '',
    listings: { '': ['src'], src: ['a.ts', 'b.ts'] },
  })
  bundle.apply(host.ctx)
  const overlay = host.registrations.find((row) => row.spec.name === 'shell.overlay')

  const container = globalThis.document.createElement('div')
  globalThis.document.body.appendChild(container)
  const reactRoot = createRoot(container)
  const highlighted = () => [...container.querySelectorAll('.fv-tree .fv-row-seat[aria-current="true"]')]
    .map((seat) => seat.getAttribute('data-path'))
  try {
    await React.act(async () => { reactRoot.render(React.createElement(overlay.component)) })
    await React.act(async () => { await sleep(20) })
    await React.act(async () => {
      globalThis.window.__dsh_open_file_viewer({ filePath: 'src/a.ts' })
      await sleep(80)
    })
    assert.deepEqual(highlighted(), ['src/a.ts'])

    // Close the only tab: nothing is on screen, so nothing may stay lit. A
    // highlight left behind would claim a file is open when the pane is empty.
    await React.act(async () => {
      container.querySelector('.fv-tab-close')?.dispatchEvent(
        new globalThis.window.MouseEvent('click', { bubbles: true }),
      )
      await sleep(80)
    })
    assert.deepEqual(
      [...container.querySelectorAll('.fv-tab-cell')].map((cell) => cell.getAttribute('title')),
      [],
      'closing the last tab leaves no tabs',
    )
    assert.deepEqual(highlighted(), [], 'closing the last tab must clear the highlight')
  } finally {
    await React.act(async () => { reactRoot.unmount() })
    container.remove()
  }
})

test('a second click on the same path does not stack a duplicate tab', async () => {
  await loadDom()
  const React = require('react')
  const { createRoot } = require('react-dom/client')
  const bundle = loadBundle()
  const host = createHost({ filePath: 'src/a.ts' })
  bundle.apply(host.ctx)
  const overlay = host.registrations.find((row) => row.spec.name === 'shell.overlay')

  const container = globalThis.document.createElement('div')
  globalThis.document.body.appendChild(container)
  const reactRoot = createRoot(container)
  try {
    await React.act(async () => { reactRoot.render(React.createElement(overlay.component)) })
    await React.act(async () => { await sleep(20) })
    await React.act(async () => {
      globalThis.window.__dsh_open_file_viewer({ filePath: 'src/a.ts' })
      await sleep(80)
    })
    await React.act(async () => {
      globalThis.window.__dsh_open_file_viewer({ filePath: 'src/a.ts' })
      await sleep(80)
    })
    const tabs = [...container.querySelectorAll('.fv-tab-cell')].map((cell) => cell.getAttribute('title'))
    assert.deepEqual(tabs, ['src/a.ts'], 're-clicking a path must focus its tab, not duplicate it')
    const body = container.querySelector('.fv-body')
    assert.equal(body?.getAttribute('data-pane'), 'content')
  } finally {
    await React.act(async () => { reactRoot.unmount() })
    container.remove()
  }
})

test('a drawer that is merely hidden keeps its tabs when reopened', async () => {
  await loadDom()
  const React = require('react')
  const { createRoot } = require('react-dom/client')
  const bundle = loadBundle()
  const host = createHost({ filePath: 'src/a.ts' })
  bundle.apply(host.ctx)
  const overlay = host.registrations.find((row) => row.spec.name === 'shell.overlay')

  const container = globalThis.document.createElement('div')
  globalThis.document.body.appendChild(container)
  const reactRoot = createRoot(container)
  try {
    await React.act(async () => { reactRoot.render(React.createElement(overlay.component)) })
    await React.act(async () => { await sleep(20) })
    await React.act(async () => {
      globalThis.window.__dsh_open_file_viewer({ filePath: 'src/a.ts' })
      await sleep(80)
    })
    // Close: the overlay stays mounted, only the render is gated.
    await React.act(async () => {
      container.querySelector('.fv-scrim')?.dispatchEvent(
        new globalThis.window.MouseEvent('mousedown', { bubbles: true }),
      )
      await sleep(20)
    })
    // Reopen against the same root: the previous visit must survive.
    await React.act(async () => {
      globalThis.window.__dsh_open_file_viewer({ filePath: 'src/a.ts' })
      await sleep(80)
    })
    const tabs = [...container.querySelectorAll('.fv-tab-cell')].map((cell) => cell.getAttribute('title'))
    assert.deepEqual(tabs, ['src/a.ts'], 'reopening must not throw the reader’s tabs away')
    const body = container.querySelector('.fv-body')
    assert.equal(body?.getAttribute('data-pane'), 'content')
  } finally {
    await React.act(async () => { reactRoot.unmount() })
    container.remove()
  }
})
