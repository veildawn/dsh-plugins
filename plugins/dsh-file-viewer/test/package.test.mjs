import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const manifest = require('../package.json')
const root = fileURLToPath(new URL('..', import.meta.url))
const read = (relative) => readFileSync(root + relative, 'utf8')

/**
 * Evaluate the browser bundle and hand back its module exports.
 *
 * The bundle registers itself with the host's loader off `window` rather than
 * exporting anything, so it has to be run with that shape in place and the
 * definition caught as it registers.
 */
const loadClient = () => {
  const previousWindow = globalThis.window
  let definition
  globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
  try {
    new Function('window', read('lib/client.js'))(globalThis.window)
  } finally {
    globalThis.window = previousWindow
  }
  return definition.factory((id) => (id === 'react'
    ? {
      // A tree-building stub rather than a null one: the Git panel tests read
      // what a component actually rendered, and children are how that arrives.
      createElement: (type, props, ...children) => ({
        type,
        props: props || {},
        children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false),
      }),
      Fragment: 'fragment',
      useRef: () => ({ current: null }),
      useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
      useEffect: () => {},
      useCallback: (fn) => fn,
    }
    : { ReadBlock: null, MarkdownText: null, JsonTree: null }))
}

test('the manifest is a loadable DSH plugin', () => {
  assert.equal(manifest.name, '@weniatall/dsh-file-viewer')
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.main, 'lib/index.js')

  // The client-modules loader hard-errors when `dsh.client` is declared
  // without a './client' subpath export.
  assert.equal(manifest.exports['.'], './lib/index.js')
  assert.equal(manifest.exports['./client'], './lib/client.js')
  assert.equal(manifest.exports['./core'], './lib/core.js')
  assert.equal(manifest.exports['./package.json'], './package.json')

  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  for (const dependency of [
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-connection',
  ]) {
    assert(manifest.dsh.client.inject.includes(dependency), `client inject must declare ${dependency}`)
  }

  for (const file of ['lib/index.js', 'lib/core.js', 'lib/client.js', 'README.md', 'cordis.patch.yml']) {
    assert(manifest.files.includes(file), `files must ship ${file}`)
  }
})

test('the cordis patch mounts the host half under a stable id', () => {
  const patch = read('cordis.patch.yml')
  assert.match(patch, /id: file-viewer/)
  assert.match(patch, /name: '@weniatall\/dsh-file-viewer'/)
})

test('host parsing dependencies are pinned, not floating', () => {
  // These run in Node on the host, where size and CJS-only formats are fine,
  // but a viewer that silently changes parsers on install is not.
  assert.equal(manifest.dependencies.exceljs, '4.4.0')
  assert.equal(manifest.dependencies.mammoth, '1.12.1')
  for (const [name, range] of Object.entries(manifest.dependencies)) {
    assert.match(range, /^\d+\.\d+\.\d+$/, `${name} must be pinned exactly`)
  }
})

test('the host half declares its services as a flat array', async () => {
  // The loader reads `inject` as service names; an object form leaves the
  // entry pending forever with "waiting for services: required, optional".
  // Cordis also throws on ANY service access missing from this list, so
  // optional chaining on `ctx.settings` is not a substitute for declaring it.
  const host = await import('../lib/index.js')
  assert(Array.isArray(host.inject), 'inject must be an array of service names')
  assert.deepEqual(host.inject, ['fs', 'connection', 'settings', 'workspaceRegistry', 'sessions', 'webServer'])
  assert.equal(host.name, 'file-viewer')
})

test('the host half registers one trusted-host RPC channel and no HTTP route', () => {
  const source = read('lib/index.js')
  assert.match(source, /connection\.rpc\.handle\(/)
  assert.match(source, /authority: 'trusted-host'/)
  // Opening a bare route would bypass the /api browser-trust fence; the only
  // webServer usage allowed is the inject declaration rpc.handle itself needs.
  assert.doesNotMatch(source, /webServer\.(register|registerUpgrade|registerFallback)/)
  assert.match(source, /export const inject = \[[^\]]*'webServer'\]/)
  // Containment is the whole security story for reads; never drop it.
  assert.match(source, /ctx\.fs\.contains\(/)
  assert.match(source, /isSafeRelativePath\(/)
})

test('the client bundle registers through the module loader with declared deps', () => {
  const previousWindow = globalThis.window
  let definition
  globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
  try {
    // The bundle is a hand-written IIFE, not ESM: evaluating it registers.
    new Function('window', read('lib/client.js'))(globalThis.window)
  } finally {
    globalThis.window = previousWindow
  }

  assert(definition)
  assert.equal(definition.id, manifest.name)

  const seen = []
  const client = definition.factory((id) => {
    seen.push(id)
    if (id === 'react') return { useState: () => [], useEffect: () => {}, useRef: () => ({ current: 0 }), createElement: () => null, Fragment: 'fragment' }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      return { ReadBlock: 'ReadBlock', MarkdownText: 'MarkdownText', JsonTree: 'JsonTree' }
    }
    // A dependency outside the platform seed list would fail at runtime.
    assert.fail('unexpected browser dependency: ' + id)
  })

  assert.deepEqual(seen, ['react', '@deepseek-ai/dsh-client-ui-primitives'])
  assert.equal(typeof client.apply, 'function')
  assert.deepEqual(client.inject, ['slots', 'connection', 'workspaces'])
  assert.equal(client.internals.RPC_CHANNEL, '/dsh-file-viewer')
  assert.equal(client.internals.OVERLAY_SLOT, 'shell.overlay')
  assert.equal(client.internals.HEADER_SLOT, 'conversation.session.header.utilities')
})

test('the client bundle polyfills randomUUID for insecure contexts', () => {
  const previousWindow = globalThis.window
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  globalThis.window = { __ModuleLoader__: { load() {} } }
  // LAN access over plain HTTP is not a secure context, so randomUUID is absent.
  // Node exposes `crypto` as a getter-only accessor, hence defineProperty.
  Object.defineProperty(globalThis, 'crypto', {
    value: { getRandomValues: (array) => array.fill(7) },
    configurable: true,
    writable: true,
  })
  try {
    new Function('window', read('lib/client.js'))(globalThis.window)
    assert.equal(typeof globalThis.crypto.randomUUID, 'function')
    assert.match(globalThis.crypto.randomUUID(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  } finally {
    globalThis.window = previousWindow
    if (cryptoDescriptor === undefined) delete globalThis.crypto
    else Object.defineProperty(globalThis, 'crypto', cryptoDescriptor)
  }
})

test('client helpers agree with the host about paths and formats', () => {
  const previousWindow = globalThis.window
  let definition
  globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
  try {
    new Function('window', read('lib/client.js'))(globalThis.window)
  } finally {
    globalThis.window = previousWindow
  }
  const { internals } = definition.factory((id) =>
    id === 'react' ? { createElement: () => null } : { ReadBlock: null, MarkdownText: null, JsonTree: null })

  assert.equal(internals.baseNameOf('lib/core.js'), 'core.js')
  assert.equal(internals.parentOf('a/b/c.js'), 'a/b')
  assert.equal(internals.parentOf('top'), '')
  // The bundle carries its own copy of flattenTree (it cannot import the host
  // half), so it must behave identically to the unit-tested original.
  const rows = internals.flattenTree({
    expanded: new Set(['lib']),
    nodes: new Map([
      ['', { status: 'ready', entries: [{ name: 'lib', path: 'lib', type: 'directory' }] }],
      ['lib', { status: 'ready', entries: [{ name: 'core.js', path: 'lib/core.js', type: 'file' }] }],
    ]),
  })
  assert.deepEqual(rows.map((row) => [row.key, row.depth]), [['lib', 0], ['lib/core.js', 1]])
  assert.equal(internals.flattenTree({ expanded: new Set(['x']), nodes: new Map([['', { status: 'ready', entries: [{ name: 'x', path: 'x', type: 'directory' }] }]]) })[1].state, 'loading')

  assert.equal(internals.mediaTypeOf('shot.PNG'), 'image/png')
  assert.equal(internals.mediaTypeOf('manual.pdf'), 'application/pdf')
  assert.equal(internals.mediaTypeOf('core.js'), undefined)

  // Spreadsheet column letters must roll over past Z.
  assert.equal(internals.columnLabel(0), 'A')
  assert.equal(internals.columnLabel(25), 'Z')
  assert.equal(internals.columnLabel(26), 'AA')
  assert.equal(internals.columnLabel(27), 'AB')

  assert.equal(internals.formatBytes(1536), '1.5 KB')

  // Every host error code needs copy, or the user sees a raw code.
  for (const code of ['no-roots', 'unknown-root', 'outside-root', 'not-found', 'too-large', 'read-failed', 'not-text', 'unsupported']) {
    assert.equal(typeof internals.ERROR_COPY[code], 'string', `${code} needs user-facing copy`)
  }
  assert.equal(internals.messageOf({ code: 'outside-root' }), internals.ERROR_COPY['outside-root'])
  assert.equal(internals.messageOf({ message: 'boom' }), 'boom')
})

test('the store notifies subscribers and ignores redundant writes', () => {
  const previousWindow = globalThis.window
  let definition
  globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
  try {
    new Function('window', read('lib/client.js'))(globalThis.window)
  } finally {
    globalThis.window = previousWindow
  }
  const { internals } = definition.factory((id) =>
    id === 'react' ? { createElement: () => null } : { ReadBlock: null, MarkdownText: null, JsonTree: null })

  const store = internals.createStore(false)
  const seen = []
  const unsubscribe = store.subscribe((value) => seen.push(value))
  store.set(true)
  store.set(true)
  store.set(false)
  unsubscribe()
  store.set(true)
  assert.deepEqual(seen, [true, false])
  assert.equal(store.get(), true)
})

test('the request wrapper surfaces host error codes', async () => {
  const previousWindow = globalThis.window
  let definition
  globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
  try {
    new Function('window', read('lib/client.js'))(globalThis.window)
  } finally {
    globalThis.window = previousWindow
  }
  const { internals } = definition.factory((id) =>
    id === 'react' ? { createElement: () => null } : { ReadBlock: null, MarkdownText: null, JsonTree: null })

  const calls = []
  const request = internals.createRequest({
    rpc: {
      call(channel, method, payload) {
        calls.push([channel, method, payload])
        if (method === 'roots') return Promise.resolve({ ok: true, value: { roots: [] } })
        return Promise.resolve({ ok: false, error: { code: 'outside-root', message: 'refused' } })
      },
    },
  })

  assert.deepEqual(await request('roots'), { roots: [] })
  assert.deepEqual(calls[0], ['/dsh-file-viewer', 'roots', {}])

  await assert.rejects(() => request('read', { path: '../x' }), (error) => {
    assert.equal(error.code, 'outside-root')
    return true
  })
})

test('viewers remount per file and never render a partial preview', () => {
  const source = read('lib/client.js')

  // Regression: paging state used to persist across a file switch, so the first
  // request for a new file carried the previous file's offset.
  assert.match(source, /const key = root \+ .+ \+ meta\.path/, 'each file needs a distinct remount key')
  for (const view of ['ImageView', 'BinaryView', 'SheetView', 'DocView', 'TextView']) {
    assert(source.includes(`createElement(${view}, { key,`), `${view} must be keyed per file`)
  }

  // Regression: a rendered preview requires the whole document; without it the
  // toggle silently disappeared instead of explaining the fallback.
  assert.match(source, /const canPreview = /)
  assert.match(source, /previewUnavailable/)
  assert.match(source, /仅显示源码/)

  // Regression: a slower in-flight meta response could overwrite a newer one.
  // With tabs the guard is per tab, because two files are read in parallel and
  // one shared counter would cancel the other file's read.
  assert.match(source, /const metaTickets = react\.useRef\(new Map\(\)\)/)
  assert.match(source, /if \(tickets\.get\(id\) !== ticket\) return/)
})

test('the viewer opens as a right-hand drawer with no sidebar entry', () => {
  const source = read('lib/client.js')

  // The conversation header is the only entry; the sidebar button is gone
  // along with its styles and slot registration.
  assert.doesNotMatch(source, /sidebar\.footer\.action/)
  assert.doesNotMatch(source, /ViewerAction\b/)
  // The removed sidebar button owned the .fv-entry class. Matched as a class
  // rather than as a bare substring so the --fv-entry-* placement properties on
  // the phone entry do not read as a return of that button.
  assert.doesNotMatch(source, /\.fv-entry[{ ,:]/)
  assert(!manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar'))
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-client-ui-sidebar'], undefined)

  // A drawer, not a centred dialog: the scrim pins the panel to the trailing
  // edge and the panel is full height with only a left border.
  assert.match(source, /\.fv-scrim\{[^}]*justify-content:flex-end/)
  assert.doesNotMatch(source, /\.fv-scrim\{[^}]*justify-content:center/)
  assert.match(source, /\.fv-shell\{[^}]*width:min\(64vw,1100px\)/)
  assert.match(source, /\.fv-shell\{[^}]*border-left:1px solid/)
  assert.doesNotMatch(source, /\.fv-shell\{[^}]*border-radius:14px/)

  // It slides in from the right, and honours reduced-motion.
  assert.match(source, /@keyframes fv-slide\{from\{transform:translateX\(100%\)\}/)
  assert.match(source, /prefers-reduced-motion:reduce/)

  // Below the mobile-adapter breakpoint the drawer is full width.
  assert.match(source, /@media\(max-width:768px\)\{[\s\S]*?\.fv-shell\{width:100%/)
})

test('the tree expands in place and loads children lazily', () => {
  const source = read('lib/client.js')

  // Directories must toggle, not navigate: the old tree replaced the listing
  // and offered an "up one level" row instead of showing structure.
  assert.match(source, /onToggle/)
  assert.match(source, /const toggleDirectory = /)
  assert.doesNotMatch(source, /上一级/)
  assert.doesNotMatch(source, /const openDirectory = /)

  // Children are fetched on first expand only; a cached listing is reused when
  // a directory is reopened.
  assert.match(source, /if \(!isOpen && !nodes\.has\(dirPath\)\) loadDirectory\(dirPath\)/)

  // Regression: loading must not sit in an effect that both writes and depends
  // on `nodes`. Such an effect re-runs itself and its cleanup cancels the very
  // request it issued, leaving the tree on "loading" forever with no request
  // ever completing.
  assert.match(source, /const loadDirectory = \(dirPath\) => \{/)
  assert.doesNotMatch(source, /wanted/)

  // Staleness is judged by a generation token, bumped on root/filter change and
  // on refresh, so a response from a previous tree cannot be grafted on.
  assert.match(source, /treeGeneration\.current \+= 1/)
  assert.match(source, /if \(treeGeneration\.current !== generation\) return/)

  // Accessibility: a tree needs roles and per-row expansion state.
  assert.match(source, /role: "tree"/)
  assert.match(source, /role: "treeitem"/)
  assert.match(source, /"aria-expanded": row\.expanded \? "true" : "false"/)
  assert.match(source, /"aria-level": row\.depth \+ 1/)

  // Depth is expressed as indentation.
  assert.match(source, /paddingLeft: 8 \+ row\.depth \* 14/)
})

test('the viewer entry is seated exclusively on the composer toolbar (conversation.input.left)', () => {
  const source = read('lib/client.js')

  // Seated exclusively on the composer toolbar so it is visible in both new/blank sessions
  // (hero composer centered) and regular sessions, while keeping the top header clean.
  assert.match(source, /const COMPOSER_SLOT = "conversation\.input\.left"/)
  assert.match(source, /ctx\.slots\.inject\(COMPOSER_SLOT/)
  assert.match(source, /className: "fv-composer-entry"/)

  // Session scope or sessionStore lets the host resolve that session's project directory.
  assert.match(source, /const sid = \(props && props\.sessionId\) \|\| sessionStore\.get\(\)/)
  assert.match(source, /openStore\.set\(openStore\.get\(\) === null \? \{ sessionId: sid \} : null\)/)

  // Open state is a payload, not a boolean, so the overlay knows which session
  // asked; a fresh object per open re-runs root resolution.
  assert.match(source, /const openStore = createStore\(null\)/)
  assert.doesNotMatch(source, /openStore\.set\(false\)/)
  assert.doesNotMatch(source, /openStore\.set\(true\)/)

  // The revealed directory's whole ancestor chain opens on arrival, on top of
  // whatever the reader had already expanded.
  assert.match(source, /const chain = revealChanged && reveal !== "" \? \[\.\.\.ancestorsOf\(reveal\), reveal\] : \[\]/)
  assert.match(source, /for \(const dirPath of listings\) loadDirectory\(dirPath\)/)
})

test('registering in a conversation slot is declared in the manifest', () => {
  // The slot must exist before registration runs, which is what `dsh.client.inject`
  // guarantees; without this the composer entry silently never appears.
  assert(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'))
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-client-ui-conversation'], '>=0.1.0-rc.6')
})

test('floating button is strictly disabled and PC entry is seated on composer toolbar', () => {
  const source = read('lib/client.js')

  // Floating button is disabled across both PC and mobile platforms
  assert.match(source, /\.fv-float-entry\{display:none!important\}/)

  // ViewerSurfaces does NOT render ViewerFloatingAction anymore
  assert.doesNotMatch(source, /react\.createElement\(ViewerFloatingAction, null\)/)
  assert.match(source, /function ViewerFloatingAction\(\)[\s\S]*?return null;/)

  // Session reporting continues to track active sessionId
  assert.match(source, /const sessionStore = createStore\(undefined\)/)
  assert.match(source, /sessionStore\.set\(sessionId\)/)

  // Composer button geometry must match the host's native "+" button (.uV2eYG_add):
  // 28x28 with radius-sm, NOT a 999px pill — a pill reads as a foreign solid dot
  // wedged between the native square-ish toolbar buttons.
  assert.match(source, /\.fv-composer-entry\{[^}]*width:28px;height:28px/)
  assert.match(source, /\.fv-composer-entry\{[^}]*border-radius:var\(--dsw-radius-sm\)/)
  assert.match(source, /\.fv-composer-entry\{[^}]*background:var\(--dsw-specific-selector\)/)
  assert.doesNotMatch(source, /\.fv-composer-entry\{[^}]*border-radius:999px/)
  assert.match(source, /@media\(max-width:768px\)\{\.fv-composer-entry\{display:none!important\}\}/)
})

test('the drawer can be dismissed on a phone', () => {
  const source = read('lib/client.js')

  // A phone has no Escape key, and a full-screen drawer leaves no scrim to tap,
  // so the back gesture must close it. A history entry of our own is what stops
  // that gesture from leaving the app.
  assert.match(source, /window\.history\.pushState\(\{ fileViewer: true \}, ""\)/)
  assert.match(source, /window\.addEventListener\("popstate", onPopState\)/)

  // Closing by any other route must retract that entry, or the next back press
  // is spent undoing it and looks like nothing happened.
  assert.match(source, /state\.fileViewer === true\) window\.history\.back\(\)/)

  // The close button stays in the head on every width.
  assert.match(source, /"aria-label": "关闭",[^}]*onClick: \(\) => openStore\.set\(null\)/)
})

test('the entry reads clearly and renders a native folder icon in composer toolbar', () => {
  const source = read('lib/client.js')

  // The outline folder is faint at icon sizes; the filled variant is used with
  // outline kept only as a fallback.
  assert.match(source, /const FolderIcon = IconFolderOpen16 \?\? IconFolderOutline16 \?\? null/)
  assert.match(source, /react\.createElement\(FolderIcon, \{ size: 16 \}\)/)

  // Floating button is permanently suppressed
  assert.match(source, /\.fv-float-entry\{display:none!important\}/)

  // The composer entry follows native styling: 28x28 with radius-sm and the
  // same specific-selector fill as the host's own "+" button.
  assert.match(source, /\.fv-composer-entry\{[^}]*width:28px;height:28px/)
  assert.match(source, /\.fv-composer-entry\{[^}]*border-radius:var\(--dsw-radius-sm\)/)
  assert.match(source, /className: "fv-composer-entry"/)
  assert.match(source, /"aria-label": "查看项目文件"/)
})

test('source views can be soft wrapped from the toolbar', () => {
  const source = read('lib/client.js')

  // Off by default: code carries meaning in its line breaks.
  assert.match(source, /const \[wrap, setWrap\] = react\.useState\(false\)/)

  // The toggle is offered only where sideways scrolling actually happens —
  // images, PDFs, sheets and documents do not.
  assert.match(source, /meta\.kind === "text" \|\| meta\.kind === "markdown" \|\| meta\.kind === "json"/)
  assert.match(source, /"aria-pressed": wrap \? "true" : "false"/)
  assert.match(source, /"aria-label": wrap \? "取消自动换行" : "自动换行"/)

  // A rendered preview already reflows, so the attribute only applies to source.
  assert.match(source, /const wrapping = wrap && \(!canPreview \|\| raw\)/)
  assert.match(source, /"data-wrap": wrapping \? "on" : "off"/)

  // ReadBlock's class names carry a build hash, so the rules key off structure:
  // a scrolling body of flex rows, each a gutter span then a content span.
  assert.match(source, /\.fv-content\[data-wrap="on"\] div\[class\*="_body_"\]\{overflow-x:hidden\}/)
  assert.match(source, /\.fv-content\[data-wrap="on"\] span\[class\*="_gutter_"\]\{flex:none;white-space:pre\}/)
  assert.match(source, /\.fv-content\[data-wrap="on"\] span\[class\*="_content_"\]\{min-width:0;flex:1 1 auto;white-space:pre-wrap;overflow-wrap:anywhere\}/)

  // The pressed state has to be visible, or the toggle looks inert.
  assert.match(source, /\.fv-icon-button\[aria-pressed="true"\]\{background:/)
})

test('drawer supports fullscreen toggle on PC and hides it on mobile', () => {
  const source = read('lib/client.js')

  // Fullscreen state
  assert.match(source, /const \[fullscreen, setFullscreen\] = react\.useState\(false\)/)

  // Fullscreen button in header
  assert.match(source, /className: "fv-icon-button fv-btn-fullscreen"/)
  assert.match(source, /"aria-label": fullscreen \? "退出全屏" : "全屏"/)
  assert.match(source, /"aria-pressed": fullscreen \? "true" : "false"/)

  // PC CSS attributes & transitions
  assert.match(source, /\.fv-shell\[data-fullscreen="true"\]\{width:100vw;border-left:none\}/)

  // Hidden on mobile
  assert.match(source, /@media\(max-width:768px\)\{[\s\S]*?\.fv-btn-fullscreen\{display:none!important\}/)
})

test('the drawer clears the Windows caption strip instead of sliding under it', () => {
  const source = read('lib/client.js')

  // The desktop shell marks <html> with data-windows-titlebar and publishes the
  // strip height as a custom property. The native caption buttons live in that
  // strip, above every page layer, so a trailing-edge drawer that starts at the
  // frame's top edge has its header controls covered by them. The scrim must
  // therefore start below the strip.
  assert.match(
    source,
    /html\[data-windows-titlebar\]:not\(\[data-fullscreen\]\) \.fv-scrim\{top:var\(--dsh-windows-titlebar-height,40px\)\}/,
    'the drawer must offset below the Windows caption strip and publish no offset elsewhere',
  )

  // Fullscreen removes the strip, so the rule has to stay scoped away from it;
  // an unconditional offset would leave a dead band above the drawer there.
  assert.doesNotMatch(source, /html\[data-windows-titlebar\] \.fv-scrim\{top:/)

  // The offset belongs to the shell overlay seat only: the mobile bottom-sheet
  // context menu and the centred modals are positioned independently.
  assert.doesNotMatch(source, /html\[data-windows-titlebar\][^{]*\.fv-modal-scrim\{[^}]*top:/)
})

test('the Host native open control is intercepted like any other file control', () => {
  const source = read('lib/client.js')

  // The Desktop Host answers canOpenWorkspacePath with true and mounts its own
  // "open in application" button beside file paths and inside the changes card.
  // That button takes the click, so without recognizing it the viewer never
  // opens on Desktop while it works on the Web, where the button is absent.
  assert.match(source, /element\.closest\("\[data-open-path-open\]"\)/)

  // Its label is the action, never the path: the path comes from the hidden
  // description span the surrounding row publishes.
  assert.match(source, /element\.closest\("\[data-open-path-open\]"\)\) \{[\s\S]{0,400}?span\[hidden\]/)

  // The application picker chevron is a menu, not a plain open, so it must stay
  // with the Host.
  assert.doesNotMatch(source, /isFileOpenControl[\s\S]{0,600}?data-open-path-more/)
})

test('the changes card native open route is taken over on Desktop', () => {
  const source = read('lib/client.js')

  // The changes card POSTs /api/changes.open?sessionId&seq&index, which hands the
  // file to the OS. It never touches the RPC carrier, so wrapping rpc.call alone
  // left Desktop opening the system editor while Web opened the viewer.
  assert.match(source, /function wrapChangesOpenFetch\(/)
  assert.match(source, /\\\/api\\\/changes\\\.open/)
  assert.match(source, /\/api\/changes\.summary\?/)

  // The synthetic response must satisfy the Host's success check, and the real
  // request has to go through whenever the coordinates cannot be resolved.
  assert.match(source, /new Response\(null, \{ status: 204 \}\)/)
  assert.match(source, /return originalFetch\.apply\(this, arguments\)/)

  // It is installed from apply, next to the other open-path wrappers.
  assert.match(source, /wrapChangesOpenFetch\(openStore, sessionStore\)/)
  assert.match(source, /wrapChangesOpenFetch,/)
})

test('an open request lands on the store the mounted overlay subscribes to', () => {
  const source = read('lib/client.js')

  // Regression: the Host wrappers closed over the store of whichever apply
  // installed them. A re-apply left them writing the previous store, so clicks
  // were swallowed and the viewer looked like it had stopped listening.
  assert.match(source, /let liveOpenStore = null/)
  assert.match(source, /let liveSessionStore = null/)
  assert.match(source, /const target = liveOpenStore \|\| openStore/)
  assert.match(source, /liveOpenStore = openStore/)
  assert.match(source, /liveSessionStore = sessionStore/)
})

test('the selected file path is hidden in the mobile header', () => {
  const source = read('lib/client.js')
  // Desktop still shows the selected path in the header; phones do not have
  // room for it, so the dedicated path crumb is hidden at the mobile breakpoint.
  assert.match(source, /className: "fv-crumbs fv-file-path"/)
  assert.match(source, /@media\(max-width:768px\)\{[\s\S]*?\.fv-file-path\{display:none!important\}/)
})

test('session reporter survives a session with no messages and publishes sessionId', () => {
  const source = read('lib/client.js')

  // The session reporter hangs off SESSION_SLOT so empty/blank sessions
  // reliably publish the active sessionId to sessionStore.
  assert.match(source, /const SESSION_SLOT = "conversation\.input\.overlay"/)
  assert.match(source, /function SessionReporter\(props\)/)
  assert.match(source, /sessionStore\.set\(sessionId\)/)
  assert.match(source, /\}, SessionReporter\)\)/)

  // It draws nothing; it exists only to publish the id.
  assert.match(source, /function SessionReporter[\s\S]*?return null;/)

  // The header entry no longer reports, so there is one source of truth.
  assert.doesNotMatch(source, /function ViewerHeaderAction[\s\S]{0,400}sessionStore\.set/)
})

test('tree rows can reference a file into the composer', () => {
  const source = read('lib/client.js')

  // The draft is only reachable from a component seated on the composer, and the
  // drawer renders in a different subtree, so a bridge publishes the accessors.
  assert.match(source, /const COMPOSER_SLOT = "conversation\.input\.left"/)
  assert.match(source, /function ComposerBridge\(props\)/)
  // The draft text is on the input snapshot; writing it back is a separate
  // action object. Reading setDraft off the snapshot silently yields undefined.
  assert.match(source, /props\.input \? props\.input\.draft : undefined/)
  assert.match(source, /props\.inputActions \? props\.inputActions\.setDraft : undefined/)
  assert.match(source, /composerStore\.set\(\{[\s\S]*?draft:[\s\S]*?setDraft[\s\S]*?insertText[\s\S]*?captureInsertion/)
  assert.match(source, /\}, ComposerBridge\)\)/)

  // Rows became wrappers because a button cannot nest inside another button.
  assert.match(source, /className: "fv-row-seat"/)
  assert.match(source, /className: "fv-mention"/)

  // Without stopPropagation the row's own click also fires, expanding the
  // directory or switching the preview.
  assert.match(source, /event\.stopPropagation\(\);\s*onMention\(entry\)/)

  // Folders are referenceable too, so the button is not gated on entry type.
  assert.doesNotMatch(source, /onMention[\s\S]{0,120}isDirectory \? null/)

  // Inserting at caret uses host inputActions.insertText without clobbering, closing drawer afterwards.
  assert.match(source, /target\.inputActions\.insertText\(textToInsert, span\)/)
  assert.match(source, /openStore\.set\(null\);/)

  // Never gated behind hover. Hiding it that way made it unreachable wherever
  // hover is unreliable, including phones with a paired mouse where
  // (hover:none) reports false — it is muted rather than hidden.
  assert.match(source, /\.fv-mention\{[^}]*opacity:\.5\}/)
  assert.doesNotMatch(source, /\.fv-mention\{[^}]*opacity:0\}/)
  assert.match(source, /@media\(hover:none\),\(pointer:coarse\)\{\.fv-mention\{opacity:1\}\}/)

  // The tree pads itself while sized at 100%, so without border-box it measures
  // 12px wider than the viewport and pushes the row's trailing edge — the size
  // label and this button — off screen on a narrow phone.
  assert.match(source, /\.fv-tree\{box-sizing:border-box;/)

  // The row is a flex child now; width:100% would claim the whole seat and
  // squeeze the button out of the row entirely.
  assert.match(source, /\.fv-row\{[^}]*min-width:0;min-height:32px/)
  assert.doesNotMatch(source, /\.fv-row\{[^}]*width:100%/)
  assert.match(source, /\.fv-row-seat\{[^}]*width:100%;min-width:0;max-width:100%\}/)

  // 44px is the smallest comfortable touch target.
  assert.match(source, /@media\(max-width:768px\)\{[\s\S]*?\.fv-mention\{width:44px;height:44px;margin-right:2px;opacity:1\}/)
})

test('an existing stylesheet is refreshed rather than left stale', () => {
  const source = read('lib/client.js')

  // Bailing out on the id alone left old rules in place whenever the tag
  // outlived the module, so the script updated while the layout did not.
  assert.match(source, /if \(existing\.textContent !== css\) existing\.textContent = css/)
  assert.doesNotMatch(source, /if \(!doc \|\| doc\.getElementById\(STYLE_ID\)\) return/)

  // Checked on every open, not only at startup: apply() runs once while the
  // stylesheet can outlive the module across a client reload.
  assert.match(source, /if \(!open\) return;\s*ensureStyles\(/)
})

test('the mention button survives a host that gives the bridge no input props', () => {
  const source = read('lib/client.js')

  // Gating on the store made the button vanish outright wherever the composer
  // seat arrives without inputActions, with nothing the user could do about it.
  assert.doesNotMatch(source, /onMention: composer === null \? undefined : mention/)
  assert.match(source, /onMention: mention,/)

  // React tracks the value on the node, so a plain assignment is overwritten on
  // the next render — hence the prototype setter and the synthetic event.
  assert.match(source, /function writeDraftToDom\(doc, text\)/)
  assert.match(source, /Object\.getOwnPropertyDescriptor\(proto, "value"\)/)
  assert.match(source, /area\.dispatchEvent\(new Event\("input", \{ bubbles: true \}\)\)/)
})

test('a dragged entry settles against the nearest edge inside the safe area', () => {
  const { internals } = loadClient()
  const { settleEntry } = internals
  const viewport = { width: 360, height: 780, size: 48 }
  const safe = { top: 52, bottom: 34, left: 0, right: 0 }

  // Horizontal placement is decided by the button's centre, not its left edge,
  // so a button whose left sits past the midpoint but whose centre does not
  // still returns to the near side.
  assert.equal(settleEntry({ ...viewport, x: 10, y: 400, safe }).side, 'left')
  assert.equal(settleEntry({ ...viewport, x: 300, y: 400, safe }).side, 'right')
  assert.equal(settleEntry({ ...viewport, x: 155, y: 400, safe }).side, 'left')
  assert.equal(settleEntry({ ...viewport, x: 157, y: 400, safe }).side, 'right')

  // Vertically the released height is kept, expressed from the bottom.
  assert.equal(settleEntry({ ...viewport, x: 300, y: 400, safe }).bottom, 780 - 400 - 48)

  // Dragged off the bottom it stops at the safe-area floor rather than leaving
  // the screen, and off the top it stops below the mobile bar. Without those
  // clamps a rotation could strand the button where it cannot be tapped.
  assert.equal(settleEntry({ ...viewport, x: 300, y: 5000, safe }).bottom, 14 + 34)
  assert.equal(settleEntry({ ...viewport, x: 300, y: -5000, safe }).bottom, 780 - 52 - 14 - 48)

  // The horizontal inset clears the safe area on the side it lands on.
  assert.equal(settleEntry({ ...viewport, x: 0, y: 400, safe: { ...safe, left: 20 } }).offset, 34)
  assert.equal(settleEntry({ ...viewport, x: 340, y: 400, safe: { ...safe, right: 20 } }).offset, 34)

  // A viewport shorter than the insets it must respect cannot satisfy both, and
  // the floor wins so the button stays reachable.
  const cramped = settleEntry({ width: 360, height: 90, size: 48, x: 300, y: 0, safe })
  assert.equal(cramped.bottom, 14 + 34)
})

test('a stored entry position is validated before it is trusted', () => {
  const { internals } = loadClient()
  const { readEntryPosition, writeEntryPosition, ENTRY_POSITION_KEY } = internals
  const previous = globalThis.localStorage
  const store = new Map()
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
  try {
    assert.equal(ENTRY_POSITION_KEY, 'dsh-file-viewer.entry-position')
    assert.equal(readEntryPosition(), null)

    writeEntryPosition({ side: 'left', bottom: 200 })
    assert.deepEqual(readEntryPosition(), { side: 'left', bottom: 200 })

    // A value from an older build or edited by hand would otherwise place the
    // button off-screen with no way to drag it back.
    for (const bad of ['not json', '{}', '{"side":"middle","bottom":10}', '{"side":"left"}', '{"side":"left","bottom":-5}']) {
      store.set(ENTRY_POSITION_KEY, bad)
      assert.equal(readEntryPosition(), null, bad)
    }

    writeEntryPosition(null)
    assert.equal(readEntryPosition(), null)
  } finally {
    if (previous === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previous
  }
})

test('reading a position survives storage that throws on access', () => {
  const { internals } = loadClient()
  const previous = globalThis.localStorage
  // Privacy modes throw on the property access itself, not just on the call.
  Object.defineProperty(globalThis, 'localStorage', {
    get() { throw new Error('SecurityError') },
    configurable: true,
  })
  try {
    assert.equal(internals.readEntryPosition(), null)
    assert.doesNotThrow(() => internals.writeEntryPosition({ side: 'left', bottom: 10 }))
  } finally {
    delete globalThis.localStorage
    if (previous !== undefined) globalThis.localStorage = previous
  }
})

test('a language override is remembered per file and validated on read', () => {
  const { internals } = loadClient()
  const previous = globalThis.localStorage
  const store = new Map()
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: (key) => { store.delete(key) },
  }
  try {
    // Nothing remembered yet: the file follows automatic detection.
    assert.equal(internals.readLangOverride('/repo', 'a.conf'), 'auto')

    internals.writeLangOverride('/repo', 'a.conf', 'yaml')
    assert.equal(internals.readLangOverride('/repo', 'a.conf'), 'yaml')

    // Per file, not per suffix or per root: a sibling is untouched, and the
    // same path under another root is a different file.
    assert.equal(internals.readLangOverride('/repo', 'b.conf'), 'auto')
    assert.equal(internals.readLangOverride('/other', 'a.conf'), 'auto')

    // "auto" clears the override rather than storing a literal choice.
    internals.writeLangOverride('/repo', 'a.conf', 'auto')
    assert.equal(internals.readLangOverride('/repo', 'a.conf'), 'auto')
  } finally {
    delete globalThis.localStorage
    if (previous !== undefined) globalThis.localStorage = previous
  }
})

test('stored language overrides are re-validated rather than trusted', () => {
  const { internals } = loadClient()
  const previous = globalThis.localStorage
  const store = new Map()
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: (key) => { store.delete(key) },
  }
  try {
    // The catalog is what makes validation strict, so load it the way the
    // drawer does before trusting any stored id.
    internals.setLanguageCatalog([
      { id: 'plain', label: '纯文本' },
      { id: 'yaml', label: 'YAML' },
      { id: 'json', label: 'JSON' },
    ])

    // A hand-edited or older-build payload: junk ids, junk shapes, junk types.
    store.set(internals.LANG_OVERRIDES_KEY, JSON.stringify({
      '/repo\u0000good.conf': { lang: 'yaml', at: 1 },
      '/repo\u0000bad-id.conf': { lang: 'klingon', at: 2 },
      '/repo\u0000proto.conf': { lang: '__proto__', at: 3 },
      '/repo\u0000no-lang.conf': { at: 4 },
      '/repo\u0000num.conf': { lang: 42, at: 5 },
      '/repo\u0000no-at.conf': { lang: 'json' },
    }))
    const clean = internals.readLangOverrides()
    assert.equal(clean['/repo\u0000good.conf'].lang, 'yaml')
    assert.equal(clean['/repo\u0000no-at.conf'].lang, 'json')
    assert.equal(clean['/repo\u0000no-at.conf'].at, 0, 'a missing timestamp defaults rather than dropping the entry')
    // Everything unusable is dropped, so a bad id can never reach the renderer
    // and leave the select showing a value that is not among its options.
    for (const key of ['/repo\u0000bad-id.conf', '/repo\u0000proto.conf', '/repo\u0000no-lang.conf', '/repo\u0000num.conf']) {
      assert.equal(Object.hasOwn(clean, key), false, `${key} must be dropped`)
    }

    // Wholesale junk must not throw, and must not be mistaken for entries.
    for (const raw of ['not json', '[]', 'null', '"a string"', '42']) {
      store.set(internals.LANG_OVERRIDES_KEY, raw)
      assert.deepEqual(internals.readLangOverrides(), {})
    }
  } finally {
    delete globalThis.localStorage
    if (previous !== undefined) globalThis.localStorage = previous
  }
})

test('before the catalog arrives, only the id shape is checked', () => {
  // The drawer renders before the `languages` response lands. A shape check is
  // the strongest thing possible then, and the host re-validates every
  // override on the way in, so a stale id still cannot change the rendering.
  const { internals } = loadClient()
  assert.deepEqual(internals.getLanguageCatalog(), [], 'the catalog starts empty')
  assert.equal(internals.isKnownLanguageId('yaml'), true, 'a well-shaped id passes')
  assert.equal(internals.isKnownLanguageId('klingon'), true, 'membership is unknowable before the catalog')
  assert.equal(internals.isKnownLanguageId('__proto__'), false, 'the shape check still rejects junk')
  assert.equal(internals.isKnownLanguageId('has space'), false)
  assert.equal(internals.isKnownLanguageId(''), false)

  // Once it arrives, membership becomes strict.
  internals.setLanguageCatalog([{ id: 'yaml', label: 'YAML' }])
  assert.equal(internals.isKnownLanguageId('yaml'), true)
  assert.equal(internals.isKnownLanguageId('klingon'), false, 'the loaded catalog makes the check strict')
})

test('a malformed catalog response is ignored rather than replacing a good one', () => {
  const { internals } = loadClient()
  internals.setLanguageCatalog([{ id: 'yaml', label: 'YAML' }])
  // Entries missing an id or a label are not usable options.
  internals.setLanguageCatalog([{ id: '', label: 'x' }, { id: 'yaml' }, null, 'nope'])
  assert.deepEqual(internals.getLanguageCatalog(), [{ id: 'yaml', label: 'YAML' }], 'the previous catalog stands')
  // A non-array response is ignored outright.
  internals.setLanguageCatalog(undefined)
  internals.setLanguageCatalog('nope')
  assert.deepEqual(internals.getLanguageCatalog(), [{ id: 'yaml', label: 'YAML' }])
})

test('the override map is capped so storage cannot grow without bound', () => {
  const { internals } = loadClient()
  const previous = globalThis.localStorage
  const store = new Map()
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: (key) => { store.delete(key) },
  }
  try {
    const map = {}
    for (let i = 0; i < internals.LANG_OVERRIDES_MAX + 50; i += 1) {
      map[`/repo\u0000f${i}.conf`] = { lang: 'yaml', at: i }
    }
    internals.writeLangOverrides(map)
    const stored = internals.readLangOverrides()
    assert.equal(Object.keys(stored).length, internals.LANG_OVERRIDES_MAX)
    // The newest survive; the oldest are the ones evicted.
    assert.ok(Object.hasOwn(stored, `/repo\u0000f${internals.LANG_OVERRIDES_MAX + 49}.conf`), 'the newest entry survives')
    assert.equal(Object.hasOwn(stored, '/repo\u0000f0.conf'), false, 'the oldest entry is evicted')
  } finally {
    delete globalThis.localStorage
    if (previous !== undefined) globalThis.localStorage = previous
  }
})

test('language override storage survives a localStorage that throws', () => {
  const { internals } = loadClient()
  const previous = globalThis.localStorage
  Object.defineProperty(globalThis, 'localStorage', {
    get() { throw new Error('SecurityError') },
    configurable: true,
  })
  try {
    assert.deepEqual(internals.readLangOverrides(), {})
    assert.equal(internals.readLangOverride('/repo', 'a.conf'), 'auto')
    assert.doesNotThrow(() => internals.writeLangOverride('/repo', 'a.conf', 'yaml'))
  } finally {
    delete globalThis.localStorage
    if (previous !== undefined) globalThis.localStorage = previous
  }
})

test('the language picker offers auto plus the host catalog', () => {
  const source = read('lib/client.js')

  // Options come from the host so the two halves cannot disagree about what is
  // selectable, and the host is what validates a submitted override.
  assert.match(source, /request\("languages", \{\}\)/)
  assert.match(source, /setLanguageCatalog\(value\?\.languages\)/)
  // "auto" is always first and is the default state.
  assert.match(source, /react\.createElement\("option", \{ value: "auto" \}, "自动"\)/)
  // A native select keeps keyboard and screen-reader support for free.
  assert.match(source, /className: "fv-lang-select"/)
  assert.match(source, /"aria-label": "语法高亮语言"/)
  // The resolved language is what the read actually highlighted with, so the
  // choice travels on the request rather than being applied client-side.
  assert.match(source, /const langPayload = lang === undefined \|\| lang === "auto" \? \{\} : \{ lang \}/)
  // The same read payload is built once and either sent as a working-tree read
  // or, when a commit is being previewed, as a blob lookup for that commit.
  assert.match(source, /const readPayload = fromCommit/)
  assert.match(source, /request\(readMethod, readPayload\)/)
  // Choosing persists per file and re-reads immediately.
  assert.match(source, /writeLangOverride\(root, current\.meta\.path, next\)/)
  assert.match(source, /lang: readLangOverride\(chosenRoot, path\)/)
  // The choice lives on the tab, so switching tabs switches the pin with it
  // instead of applying one file's grammar to the next file opened.
  assert.match(source, /const localeTagOfActive = activeTab === null \? "auto" : \(activeTab\.lang \|\| "auto"\)/)
  assert.match(source, /lang: localeTagOfActive/)
  // The picker is contextual to a source view; an image or sheet has no grammar.
  assert.match(source, /meta\.kind === "text" \|\| meta\.kind === "markdown" \|\| meta\.kind === "json"\)/)
})

test('the picker reports how the language was decided', () => {
  const source = read('lib/client.js')

  // A guess must be visible as a guess, or the user cannot tell that the
  // highlighting is automatic — which is the whole point of the override.
  assert.match(source, /source === "content" \? "按内容识别"/)
  assert.match(source, /source === "name" \? "按后缀识别"/)
  assert.match(source, /: "未识别"/)
  assert.match(source, /choice !== "auto"/)
})

test('floating entry is disabled with display:none!important and composer entry supports active hover state', () => {
  const source = read('lib/client.js')

  // Floating button is strictly disabled across both PC and mobile platforms
  assert.match(source, /\.fv-float-entry\{display:none!important\}/)

  // Composer entry styles
  assert.match(source, /\.fv-composer-entry:hover\{/)
  assert.match(source, /\.fv-composer-entry:active\{/)
  assert.match(source, /\.fv-composer-entry svg\{/)
})

test('tree rows support right-click context menu with relative/absolute path copy and mention', () => {
  const source = read('lib/client.js')

  // Context menu elements and styling
  assert.match(source, /\.fv-context-menu\{/)
  assert.match(source, /\.fv-context-item\{/)
  assert.match(source, /\.fv-toast\{/)

  // Context menu handles onContextMenu on tree rows
  assert.match(source, /onContextMenu:\s*(?:\(event\)\s*=>|handleContextMenu)/)
  assert.match(source, /复制相对路径/)
  assert.match(source, /复制绝对路径/)
  assert.match(source, /引用到输入框 \(@\)/)
  assert.match(source, /copyToClipboard\(relPath\)/)
  assert.match(source, /copyToClipboard\(absPath\)/)
})

test('the drawer scrim ignores the gesture that opened it', () => {
  // 回归：抽屉遮罩铺满全屏后，打开抽屉那一次触摸的尾部事件会落在新出现的遮罩
  // 上。缺少 target 守卫与挂载防抖时，抽屉会在同一次触摸里立刻自关，表现为
  // “点了工具箱选项，面板关了但抽屉没出来”。
  const source = read('lib/client.js')
  assert.match(source, /openedAtRef/)
  assert.match(source, /if \(event\.target !== event\.currentTarget\) return/)
  assert.match(source, /Date\.now\(\) - openedAtRef\.current < 400/)
})

test('the back-gesture handler ignores the gesture that opened the drawer', () => {
  // 回归：抽屉打开时 pushState 压入历史项，移动端会在同一次触摸里把它判成可
  // 回退并立刻派发 popstate，抽屉在渲染出来之前就被关掉（表现为“点了选项，
  // 面板消失且没有任何其它反应”）。
  const source = read('lib/client.js')
  assert.match(source, /const onPopState = \(\) => \{[\s\S]{0,200}openedAtRef\.current < 400/)
})

test('workspaces.openPath redirects to file-viewer on remote access or failure', () => {
  const source = read('lib/client.js')
  // The inject list includes workspaces, and the service is accessed directly.
  assert.match(source, /const inject = \["slots", "connection", "workspaces"\]/)
  assert.match(source, /wrapWorkspaceOpenPath\(ctx, openStore, sessionStore\)/)
  assert.match(source, /wiredOpenPath\.has\(workspaces\)/)
  assert.match(source, /workspaces\.openPath = async function\(path\)/)
  assert.match(source, /openViewerForPath\(openStore, sessionStore, path\)/)
  assert.doesNotMatch(source, /nativeOpenPath\(path\)/)
  assert.doesNotMatch(source, /ctx\.get\?\.\("workspaces"\)/)
})

test('connection.rpc.call intercepts openWorkspacePath to open file-viewer and stop xdg-open', async () => {
  const previousWindow = globalThis.window
  let definition
  globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
  try {
    new Function('window', read('lib/client.js'))(globalThis.window)
  } finally {
    globalThis.window = previousWindow
  }
  const { internals } = definition.factory((id) =>
    id === 'react' ? { createElement: () => null } : { ReadBlock: null, MarkdownText: null, JsonTree: null })

  let openedPath = null
  const fakeOpenStore = { set: (val) => { openedPath = val?.filePath } }
  const fakeSessionStore = { get: () => 'sess-1' }

  let originalCalled = false
  const fakeRpc = {
    call: async (channel, endpoint, payload) => {
      originalCalled = true
      return { ok: false, error: 'xdg-open failed' }
    }
  }

  internals.wrapConnectionRpc({ connection: { rpc: fakeRpc } }, fakeOpenStore, fakeSessionStore)

  // Call with tool call / mention style openWorkspacePath
  const res = await fakeRpc.call('/api', 'session/openWorkspacePath', {
    args: { request: { path: '/root/CodeSpace/dsh-plugins/plugins/dsh-file-viewer/package.json' } }
  })

  assert.equal(res.ok, true)
  assert.equal(res.value.opened, true)
  assert.equal(openedPath, '/root/CodeSpace/dsh-plugins/plugins/dsh-file-viewer/package.json')
  assert.equal(originalCalled, false, 'original xdg-open RPC must not be called')

  // Unrelated RPC calls must pass through to original
  await fakeRpc.call('/api', 'other/call', {})
  assert.equal(originalCalled, true)
})

test('global file click interceptor captures file mention clicks directly into the file viewer', () => {
  const source = read('lib/client.js')
  // Chat clicks and deliverable file clicks must be intercepted at the DOM
  // capture phase before host handlers invoke native desktop commands.
  assert.match(source, /setupGlobalFileClickInterceptor\(openStore, sessionStore\)/)
  assert.match(source, /event\.stopPropagation\(\)/)
  assert.match(source, /event\.stopImmediatePropagation\(\)/)
  assert.match(source, /openViewerForPath\(openStore, sessionStore, path\)/)
  // Ensure we do not access undeclared services on ctx
  assert.doesNotMatch(source, /ctx\.remote/)
  assert.doesNotMatch(source, /ctx\["remote\.session"\]/)
  assert.doesNotMatch(source, /ctx\.inject\(\["remote/)
})

test('clicked path extraction keeps Chinese filenames and prefers title over basename', () => {
  const previousWindow = globalThis.window
  let definition
  globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
  try {
    new Function('window', read('lib/client.js'))(globalThis.window)
  } finally {
    globalThis.window = previousWindow
  }
  const { internals } = definition.factory((id) =>
    id === 'react' ? { createElement: () => null } : { ReadBlock: null, MarkdownText: null, JsonTree: null })

  assert.equal(internals.normalizeClickedPath('20万落地国产纯电SUV选车报告.md'), '20万落地国产纯电SUV选车报告.md')
  assert.equal(internals.normalizeClickedPath('打开 20万落地国产纯电SUV选车报告.md'), '20万落地国产纯电SUV选车报告.md')
  assert.equal(internals.normalizeClickedPath('已编辑 clientip.go'), 'clientip.go')
  assert.equal(internals.normalizeClickedPath('已修改 main.py'), 'main.py')
  assert.equal(internals.normalizeClickedPath('查看 clientip.go 的改动'), 'clientip.go')
  assert.equal(internals.normalizeClickedPath('在侧边栏预览 clientip.go'), 'clientip.go')
  assert.equal(internals.normalizeClickedPath('在侧边栏打开 index.ts'), 'index.ts')
  assert.equal(internals.normalizeClickedPath('@`src/App.vue`'), 'src/App.vue')
  assert.equal(internals.normalizeClickedPath('普通按钮'), '')
  assert.equal(internals.normalizeClickedPath('application/json'), '')
  assert.equal(internals.normalizeClickedPath('true/false'), '')
  assert.equal(internals.normalizeClickedPath('2026/09/11'), '')
  assert.equal(internals.normalizeClickedPath('item.id'), '')
  assert.equal(internals.normalizeClickedPath('v1.0.0'), '')
  assert.equal(internals.normalizeClickedPath('a / b'), '')
  assert.equal(internals.normalizeClickedPath('https://github.com/foo/bar'), '')
  assert.equal(internals.normalizeClickedPath('D:/Notes/a.go'), 'D:/Notes/a.go')
  assert.equal(internals.normalizeClickedPath('C:/Users/foo/bar.md'), 'C:/Users/foo/bar.md')
  assert.equal(internals.normalizeClickedPath('D:\\Notes\\a.go'), 'D:\\Notes\\a.go')
  assert.equal(internals.normalizeClickedPath('~/docs/test.png'), '~/docs/test.png')
  assert.equal(internals.normalizeClickedPath('~/.dsh/config.json'), '~/.dsh/config.json')
  assert.equal(internals.normalizeClickedPath('@~/docs/test.png'), '~/docs/test.png')
  assert.equal(internals.normalizeClickedPath('@`~/.dsh/profiles/web/package.json`'), '~/.dsh/profiles/web/package.json')

  const button = {
    getAttribute: (name) => ({
      title: '/root/CodeSpace/dsh-workspace/20万落地国产纯电SUV选车报告.md',
      'aria-label': '打开 20万落地国产纯电SUV选车报告.md',
    })[name] || null,
    textContent: '20万落地国产纯电SUV选车报告.md',
  }
  assert.equal(internals.extractClickedPath(button), '/root/CodeSpace/dsh-workspace/20万落地国产纯电SUV选车报告.md')
})

test('model selector and ordinary buttons are not treated as file-open controls', () => {
  const previousWindow = globalThis.window
  let definition
  globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
  try {
    new Function('window', read('lib/client.js'))(globalThis.window)
  } finally {
    globalThis.window = previousWindow
  }
  const { internals } = definition.factory((id) =>
    id === 'react' ? { createElement: () => null } : { ReadBlock: null, MarkdownText: null, JsonTree: null })

  const fakeEl = (overrides = {}) => ({
    getAttribute: () => null,
    hasAttribute: () => false,
    closest: () => null,
    className: '',
    title: '',
    textContent: '',
    ...overrides,
  })

  const modelButton = fakeEl({
    className: 'model-select-trigger',
    textContent: 'deepseek-v4-flash',
    title: 'deepseek-v4-flash',
  })
  assert.equal(internals.isFileOpenControl(modelButton), false)

  const ordinaryButton = fakeEl({
    className: 'settings-item',
    textContent: '模型选择',
  })
  assert.equal(internals.isFileOpenControl(ordinaryButton), false)

  const mentionButton = fakeEl({
    className: 'w1_fileMention',
    textContent: 'src/App.vue',
    closest: (sel) => sel === 'code' ? {} : null,
  })
  assert.equal(internals.isFileOpenControl(mentionButton), true)

  const producedButton = fakeEl({
    className: 'P4kPIW_file',
    title: '/root/CodeSpace/dsh-workspace/20万落地国产纯电SUV选车报告.md',
    textContent: '20万落地国产纯电SUV选车报告.md',
    closest: (sel) => sel === '[data-produced-files-row]' ? {} : null,
  })
  assert.equal(internals.isFileOpenControl(producedButton), true)

  const toolRowFileLink = fakeEl({
    className: 'o3BgMG_fileLink',
    textContent: 'lib/client.js',
  })
  assert.equal(internals.isFileOpenControl(toolRowFileLink), true)

  const changedFilesCard = fakeEl({
    className: 'nyYjTG_header',
    textContent: '已编辑 clientip.go 在侧边栏预览',
    closest: (sel) => (sel.includes('data-changed-files') ? {} : null),
  })
  assert.equal(internals.isFileOpenControl(changedFilesCard), true)

  const presentedFileCard = fakeEl({
    className: 'nyYjTG_cardPreview',
    title: '/root/project/clientip.go',
    closest: (sel) => (sel.includes('data-presented-file') ? {} : null),
  })
  assert.equal(internals.isFileOpenControl(presentedFileCard), true)

  // Plain code tags are NOT file open controls
  const plainCode = fakeEl({
    tagName: 'CODE',
    textContent: 'application/json',
    closest: () => null,
  })
  assert.equal(internals.isFileOpenControl(plainCode), false)
  assert.equal(internals.isFileMentionCode(plainCode), false)

  // Code inside <pre> is NEVER a file mention
  const preCode = fakeEl({
    tagName: 'CODE',
    textContent: '@/root/CodeSpace/admin-go/backend/main.go',
    closest: (sel) => sel === 'pre' ? {} : null,
  })
  assert.equal(internals.isFileMentionCode(preCode), false)

  // Explicit @file mention inline code IS recognized
  const mentionCode = fakeEl({
    tagName: 'CODE',
    textContent: '@backend/internal/logic/script/env_vars.go',
    closest: (sel) => sel === 'code' ? mentionCode : null,
  })
  assert.equal(internals.isFileMentionCode(mentionCode), true)
})

test('wrapSidebarRight intercepts file addresses and routes them to openStore', () => {
  const previousWindow = globalThis.window
  let definition
  globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
  try {
    new Function('window', read('lib/client.js'))(globalThis.window)
  } finally {
    globalThis.window = previousWindow
  }
  const { internals } = definition.factory((id) =>
    id === 'react' ? { createElement: () => null } : { ReadBlock: null, MarkdownText: null, JsonTree: null })

  const opened = []
  const openStore = {
    set: (val) => opened.push(val),
  }
  const sessionStore = {
    get: () => 'sess-current',
  }

  let originalCalled = false
  const fakeSidebarRight = {
    openResource: (address, opts) => { originalCalled = true; },
    openResourceIn: (sid, address, opts) => { originalCalled = true; },
  }

  internals.wrapSidebarRight(fakeSidebarRight, openStore, sessionStore)

  // File address should be intercepted
  fakeSidebarRight.openResource('dsh-resource://file/session/sess-1/src/test.js')
  assert.equal(originalCalled, false)
  assert.equal(opened.length, 1)
  assert.equal(opened[0].filePath, 'src/test.js')
  assert.equal(opened[0].sessionId, 'sess-1')

  // changes-review address should also be intercepted and not passed through to original
  fakeSidebarRight.openResource('dsh-resource://changes-review/session/sess-2/12/3', { params: { index: 0 } })
  assert.equal(originalCalled, false)

  // Non-file address should pass through
  fakeSidebarRight.openResource('dsh-resource://other/something')
  assert.equal(originalCalled, true)
})

test('apply resolves sidebarRight through cordis accessors only', () => {
  // The bundle keeps the `window` it was evaluated with, and `apply` attaches
  // its event listener through it, so this loader stub needs the DOM surface.
  const previousWindow = globalThis.window
  let definition
  globalThis.window = {
    __ModuleLoader__: { load(value) { definition = value } },
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  try {
    new Function('window', read('lib/client.js'))(globalThis.window)
  } finally {
    globalThis.window = previousWindow
  }
  const client = definition.factory((id) => (id === 'react'
    ? { createElement: () => null, useRef: () => ({ current: null }), useState: (v) => [typeof v === 'function' ? v() : v, () => {}], useEffect: () => {} }
    : { ReadBlock: null, MarkdownText: null, JsonTree: null }))

  const makeContext = ({ sidebarRight, deliverByInject }) => {
    const base = {
      slots: { inject: (slot, callback) => { callback(); return () => {} }, register: () => () => {} },
      connection: { api: {}, rpc: { call: async () => ({ ok: true, value: {} }) } },
      workspaces: { openPath: async () => {} },
      get: () => (deliverByInject ? undefined : sidebarRight),
      inject: (names, callback) => {
        if (deliverByInject && names.includes('sidebarRight')) callback({ sidebarRight })
      },
    }
    // A cordis context resolves services through the fiber's `inject`: reading
    // one this plugin never declared throws instead of returning undefined, so
    // a bare `ctx.sidebarRight` read would abort the whole loader entry.
    return new Proxy(base, {
      get(target, property, receiver) {
        if (typeof property === 'symbol' || property in target) {
          const value = Reflect.get(target, property, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        }
        throw new Error(`cannot get property "${String(property)}" without inject`)
      },
    })
  }

  for (const deliverByInject of [false, true]) {
    const sidebarRight = { forwarded: [], openResource(address) { this.forwarded.push(address); return 'original' } }
    assert.doesNotThrow(() => client.apply(makeContext({ sidebarRight, deliverByInject })))

    // File addresses are intercepted whether the service was already provided
    // or only arrived after this plugin loaded.
    sidebarRight.openResource('dsh-resource://file/session/sess-1/src/a.js')
    assert.deepEqual(sidebarRight.forwarded, [], `deliverByInject=${deliverByInject}`)
    sidebarRight.openResource('dsh-resource://other/thing')
    assert.equal(sidebarRight.forwarded.length, 1, `deliverByInject=${deliverByInject}`)
  }
})

test('tree resizer supports dragging to adjust tree width and persists to storage', () => {
  const previousWindow = globalThis.window
  let definition
  globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
  try {
    new Function('window', read('lib/client.js'))(globalThis.window)
  } finally {
    globalThis.window = previousWindow
  }
  const { internals } = definition.factory((id) =>
    id === 'react' ? { createElement: () => null } : { ReadBlock: null, MarkdownText: null, JsonTree: null })

  assert.equal(internals.DEFAULT_TREE_WIDTH, 280)
  assert.equal(internals.MIN_TREE_WIDTH, 160)
  assert.equal(internals.MAX_TREE_WIDTH, 700)
  assert.equal(internals.TREE_WIDTH_KEY, 'dsh-file-viewer.tree-width')

  // Storage reads and bounds validation
  const storage = new Map()
  const fakeStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, val) => storage.set(key, String(val)),
    removeItem: (key) => storage.delete(key),
  }
  const previousStorage = globalThis.localStorage
  Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage, configurable: true, writable: true })

  try {
    // Default when unconfigured
    assert.equal(internals.readTreeWidth(), 280)

    // Valid persisted value
    internals.writeTreeWidth(350)
    assert.equal(internals.readTreeWidth(), 350)

    // Out of bounds: too narrow fallback to default
    internals.writeTreeWidth(100)
    assert.equal(internals.readTreeWidth(), 280)

    // Out of bounds: too wide fallback to default
    internals.writeTreeWidth(9999)
    assert.equal(internals.readTreeWidth(), 280)

    // Non-numeric fallback to default
    storage.set(internals.TREE_WIDTH_KEY, 'garbage')
    assert.equal(internals.readTreeWidth(), 280)
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage
    else Object.defineProperty(globalThis, 'localStorage', { value: previousStorage, configurable: true, writable: true })
  }

  // Resizer DOM and CSS rules in bundle
  const source = read('lib/client.js')
  assert.match(source, /\.fv-resizer\{/)
  assert.match(source, /cursor:\s*col-resize/)
  assert.match(source, /onPointerDown:\s*onResizerPointerDown/)
  assert.match(source, /onPointerMove:\s*onResizerPointerMove/)
  assert.match(source, /onPointerUp:\s*onResizerPointerUp/)
  assert.match(source, /onDoubleClick:\s*onResizerDoubleClick/)
  assert.match(source, /@media\(max-width:768px\)\{[\s\S]*?\.fv-resizer\{display:none!important\}/)
  assert.match(source, /\.fv-body\[data-resizing="true"\]\{cursor:col-resize;user-select:none\}/)
})

test('markdown rendering passes required labels and is protected by ErrorBoundary against crashes', () => {
  const previousWindow = globalThis.window
  let definition
  globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
  try {
    new Function('window', read('lib/client.js'))(globalThis.window)
  } finally {
    globalThis.window = previousWindow
  }
  const { internals } = definition.factory((id) =>
    id === 'react' ? { createElement: () => null } : { ReadBlock: null, MarkdownText: null, JsonTree: null })

  // Validate labels contract expected by dsh-client-ui-primitives MarkdownText
  assert(internals.MARKDOWN_LABELS, 'MARKDOWN_LABELS must be defined')
  assert.equal(typeof internals.MARKDOWN_LABELS.code?.copyLabel, 'string')
  assert.equal(typeof internals.MARKDOWN_LABELS.code?.copiedLabel, 'string')
  assert.equal(typeof internals.MARKDOWN_LABELS.footnotes, 'string')

  assert(internals.MARKDOWN_CODE_LABELS, 'MARKDOWN_CODE_LABELS must be defined')
  assert.equal(typeof internals.MARKDOWN_CODE_LABELS.copyLabel, 'string')
  assert.equal(typeof internals.MARKDOWN_CODE_LABELS.copiedLabel, 'string')

  // ErrorBoundary component exists
  assert(internals.ErrorBoundary, 'ErrorBoundary must be exposed')
  assert.equal(typeof internals.ErrorBoundary.getDerivedStateFromError, 'function')
  const derived = internals.ErrorBoundary.getDerivedStateFromError(new Error('boom'))
  assert.equal(derived.error.message, 'boom')

  // Source checks: all MarkdownText calls pass labels and codeLabels
  const source = read('lib/client.js')
  assert.match(source, /labels:\s*MARKDOWN_LABELS/)
  assert.match(source, /codeLabels:\s*MARKDOWN_CODE_LABELS/)

  // TextView and ViewerOverlay are protected by ErrorBoundary
  assert.match(source, /body\s*=\s*react\.createElement\(ErrorBoundary,\s*\{[\s\S]*?MarkdownText/)
  assert.match(source, /react\.createElement\(ErrorBoundary,\s*\{[\s\S]*?FileView/)
})

test('ReadBlock and JsonTree receive required host labels so source views do not crash', () => {
  const previousWindow = globalThis.window
  let definition
  globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
  try {
    new Function('window', read('lib/client.js'))(globalThis.window)
  } finally {
    globalThis.window = previousWindow
  }
  const { internals } = definition.factory((id) =>
    id === 'react' ? { createElement: () => null } : { ReadBlock: null, MarkdownText: null, JsonTree: null })

  // Host ReadBlock accesses labels.copy / labels.window / expand-collapse copy.
  assert.equal(typeof internals.READ_BLOCK_LABELS.copy, 'string')
  assert.equal(typeof internals.READ_BLOCK_LABELS.copied, 'string')
  assert.equal(typeof internals.READ_BLOCK_LABELS.window, 'function')
  assert.equal(internals.READ_BLOCK_LABELS.window(12, 40), '第 12 / 40 行')
  assert.equal(typeof internals.READ_BLOCK_LABELS.collapse, 'string')
  assert.equal(typeof internals.READ_BLOCK_LABELS.expand, 'function')
  assert.equal(typeof internals.READ_BLOCK_LABELS.collapseAria, 'string')
  assert.equal(typeof internals.READ_BLOCK_LABELS.expandAria, 'function')
  assert.equal(internals.READ_BLOCK_LABELS.expand(8), '展开其余 8 行')

  // Host JsonTree accesses labels.copyValue / copied / copyFailed / copyPrettyJson.
  assert.equal(typeof internals.JSON_TREE_LABELS.copy, 'string')
  assert.equal(typeof internals.JSON_TREE_LABELS.copied, 'string')
  assert.equal(typeof internals.JSON_TREE_LABELS.copyFailed, 'string')
  assert.equal(typeof internals.JSON_TREE_LABELS.copyValue, 'string')
  assert.equal(typeof internals.JSON_TREE_LABELS.copyPrettyJson, 'string')
  assert.equal(typeof internals.JSON_TREE_LABELS.copyCompactJson, 'string')
  assert.equal(typeof internals.JSON_TREE_LABELS.copyJson, 'string')
  assert.equal(typeof internals.JSON_TREE_LABELS.copyPath, 'string')
  assert.equal(typeof internals.JSON_TREE_LABELS.collapseNode, 'string')
  assert.equal(typeof internals.JSON_TREE_LABELS.expandNode, 'string')
  assert.equal(typeof internals.JSON_TREE_LABELS.copyButtonTitle, 'function')
  assert.equal(internals.JSON_TREE_LABELS.copyButtonTitle('复制值'), '复制选项：复制值')

  const source = read('lib/client.js')
  assert.match(source, /labels:\s*READ_BLOCK_LABELS/)
  assert.match(source, /labels:\s*JSON_TREE_LABELS/)
  assert.match(source, /react\.createElement\(ReadBlock,\s*\{[\s\S]*?labels:\s*READ_BLOCK_LABELS/)
  assert.match(source, /react\.createElement\(JsonTree,\s*\{[\s\S]*?labels:\s*JSON_TREE_LABELS/)
  assert.match(source, /resetKey:\s*data\.path \+ ":source"/)
})

test('mobile tree layout wraps long filenames and tightens indentation', () => {
  const source = read('lib/client.js')
  // On mobile screens, file names must wrap up to 3 lines without ellipsis
  // truncation so users can see full Chinese and English filenames.
  assert.match(source, /@media\(max-width:768px\)\{[\s\S]*?\.fv-row-name\{[^}]*white-space:normal;word-break:break-all;overflow-wrap:anywhere/)
  assert.match(source, /@media\(max-width:768px\)\{[\s\S]*?-webkit-line-clamp:3/)
  // Mobile uses compact per-level depth indentation override
  assert.match(source, /@media\(max-width:768px\)\{[\s\S]*?padding-left:calc\(4px \+ var\(--fv-depth,0\) \* 8px\)!important/)
  // Context menu on mobile displays full file title and path header
  assert.match(source, /className: "fv-context-head"/)
  assert.match(source, /className: "fv-context-title"/)
  assert.match(source, /className: "fv-context-path"/)

  // Runtime mobile responsiveness: data-mobile="true" guarantees single-pane fullwidth
  assert.match(source, /\.fv-shell\[data-mobile="true"\]\{width:100%!important;border-left:none!important\}/)
  assert.match(source, /\.fv-shell\[data-mobile="true"\] \.fv-body\[data-pane="tree"\] \.fv-main\{display:none!important\}/)
  assert.match(source, /"data-mobile": isMobile \? "true" : "false"/)
  assert.match(source, /width: isMobile \? undefined : treeWidth/)
  assert.match(source, /\.fv-tree\{flex:1 1 auto!important;width:100%!important;min-width:0!important;max-width:none!important/)
})

test('diff tab and DiffBlock labels are properly configured for viewing modifications', () => {
  const previousWindow = globalThis.window
  let definition
  globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
  try {
    new Function('window', read('lib/client.js'))(globalThis.window)
  } finally {
    globalThis.window = previousWindow
  }
  const { internals } = definition.factory((id) =>
    id === 'react' ? { createElement: () => null } : { ReadBlock: null, MarkdownText: null, JsonTree: null, DiffBlock: null })

  // Verify DIFF_BLOCK_LABELS contract
  assert.equal(typeof internals.DIFF_BLOCK_LABELS.copy, 'string')
  assert.equal(typeof internals.DIFF_BLOCK_LABELS.copied, 'string')
  assert.equal(typeof internals.DIFF_BLOCK_LABELS.files, 'function')
  assert.equal(internals.DIFF_BLOCK_LABELS.files(1), '1 个文件')
  assert.equal(typeof internals.DIFF_BLOCK_LABELS.expand, 'function')
  assert.equal(internals.DIFF_BLOCK_LABELS.expand(5), '展开其余 5 行')
  assert.equal(typeof internals.DIFF_BLOCK_LABELS.collapse, 'string')
  assert.equal(typeof internals.DIFF_BLOCK_LABELS.expandAria, 'function')
  assert.equal(typeof internals.DIFF_BLOCK_LABELS.collapseAria, 'string')

  const source = read('lib/client.js')
  assert.match(source, /DiffBlock/)
  assert.match(source, /labels:\s*DIFF_BLOCK_LABELS/)
  assert.match(source, /className:\s*"fv-tab fv-tab-diff"/)
  assert.match(source, /className:\s*"fv-badge fv-badge-mod"/)
  assert.match(source, /className:\s*"fv-badge fv-badge-add"/)
})

test('renderRootOptions groups safe access paths and workspaces into optgroups', () => {
  const previousWindow = globalThis.window
  let definition
  globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
  try {
    new Function('window', read('lib/client.js'))(globalThis.window)
  } finally {
    globalThis.window = previousWindow
  }
  const { internals } = definition.factory((id) =>
    id === 'react' ? { createElement: (type, props, ...children) => ({ type, props, children }) } : { ReadBlock: null, MarkdownText: null, JsonTree: null, DiffBlock: null })

  const { renderRootOptions } = internals
  assert.equal(typeof renderRootOptions, 'function')

  // Only workspaces: flat options without optgroups
  const workspaceOnly = [
    { id: 'D:/ws1', label: '项目一', kind: 'workspace' },
    { id: 'D:/ws2', label: '项目二', kind: 'workspace' },
  ]
  const flatOpts = renderRootOptions(workspaceOnly)
  assert.equal(flatOpts.length, 2)
  assert.equal(flatOpts[0].type, 'option')
  assert.equal(flatOpts[0].props.value, 'D:/ws1')

  // Workspaces + safe paths: optgroup for each
  const mixed = [
    { id: 'D:/ws1', label: '工作区项目', kind: 'workspace' },
    { id: 'D:/data', label: '数据盘', kind: 'safe-path' },
    { id: '/var/log', label: '日志目录', kind: 'safe-path' },
  ]
  const groupedOpts = renderRootOptions(mixed)
  assert.equal(groupedOpts.length, 2)
  assert.equal(groupedOpts[0].type, 'optgroup')
  assert.equal(groupedOpts[0].props.label, '工作区')
  assert.equal(groupedOpts[0].children.length, 1)
  assert.equal(groupedOpts[1].type, 'optgroup')
  assert.equal(groupedOpts[1].props.label, '安全访问路径')
  assert.equal(groupedOpts[1].children.length, 2)
})

test('client bundle contains SafePathsModal and toolbar safepaths button for web configuration', () => {
  const source = read('lib/client.js')
  assert.match(source, /className:\s*"fv-icon-button fv-btn-safepaths"/)
  assert.match(source, /"aria-label":\s*"安全访问路径设置"/)
  assert.match(source, /function SafePathsModal\(/)
  assert.match(source, /request\("getSafePaths"/)
  assert.match(source, /request\("updateSafePaths"/)
  assert.match(source, /配置安全访问路径/)
  assert.match(source, /\.fv-modal-scrim\{/)
  assert.match(source, /\.fv-safe-item\{/)
})

test('preview source and diff tabs stay pinned outside the scrolling content pane', () => {
  const source = read('lib/client.js')
  assert.match(source, /const tabs = showTabs/)
  // The tabs sit outside the scrolling pane, and the pane now sits inside a
  // positioning wrapper so the Markdown outline can float over the reading
  // area without scrolling away with it.
  assert.match(source, /tabs,\s*\n\s*react\.createElement\("div", \{ className: "fv-content-wrap"/)
  assert.match(source, /className: "fv-content",\s*\n\s*"data-wrap": wrapping/)
  assert.match(source, /\.fv-content-wrap\{position:relative;flex:1 1 auto;min-height:0/)
  assert.match(source, /\.fv-content \.fv-sheet-tabs\{[^}]*position:sticky/)
})

test('client apply returns a valid Cordis effect (disposer function or undefined), never an ordinary object', () => {
  const previousWindow = globalThis.window
  let definition
  globalThis.window = {
    __ModuleLoader__: { load(value) { definition = value } },
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  try {
    new Function('window', read('lib/client.js'))(globalThis.window)
  } finally {
    globalThis.window = previousWindow
  }

  const client = definition.factory((id) => (id === 'react'
    ? { createElement: () => null, useRef: () => ({ current: null }), useState: (v) => [typeof v === 'function' ? v() : v, () => {}], useEffect: () => {} }
    : { ReadBlock: null, MarkdownText: null, JsonTree: null }))

  const mockCtx = {
    slots: { inject: () => {}, register: () => () => {} },
    connection: { api: {}, rpc: { call: async () => ({ ok: true, value: {} }) } },
    workspaces: { openPath: async () => {} },
    get: () => undefined,
    inject: () => {},
  }

  // 1. 在没有 window 的环境下，apply 应返回 undefined 或函数，绝不能返回普通 object
  const effectNode = client.apply(mockCtx)
  assert(
    effectNode === undefined || typeof effectNode === 'function',
    `effect in node environment must be undefined or function, got ${typeof effectNode}`
  )

  // 2. 在有 window 的浏览器环境下，apply 应返回清理函数
  const fakeWin = {
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  const prevWin = globalThis.window
  globalThis.window = fakeWin
  try {
    const effectBrowser = client.apply(mockCtx)
    assert(
      effectBrowser === undefined || typeof effectBrowser === 'function',
      `effect in browser environment must be undefined or cleanup function, got ${typeof effectBrowser}`
    )
    if (typeof effectBrowser === 'function') {
      // 执行清理函数不应报错
      assert.doesNotThrow(() => effectBrowser())
    }
  } finally {
    globalThis.window = prevWin
  }
})

test('client bundle contains ImageView with zoom pan rotate toolbar and dimensions', () => {
  const source = read('lib/client.js')
  assert.match(source, /function ImageView\(/)
  assert.match(source, /className:\s*"fv-image-viewer"/)
  assert.match(source, /className:\s*"fv-image-toolbar"/)
  assert.match(source, /className:\s*"fv-image-canvas/)
  assert.match(source, /addEventListener\("wheel"/)
  assert.match(source, /放大/)
  assert.match(source, /缩小/)
  assert.match(source, /适应/)
  assert.match(source, /1:1/)
  assert.match(source, /向左旋转/)
  assert.match(source, /向右旋转/)
  assert.match(source, /水平翻转/)
  assert.match(source, /fv-image-dims/)
})

test('client mention inserts reference at caret position without clobbering input', () => {
  const { internals } = loadClient()
  assert.equal(typeof internals.insertMentionAtCaret, 'function')
  assert.equal(
    internals.insertMentionAtCaret('你好 世界', 'a.txt', 2),
    '你好 @a.txt 世界',
  )
  assert.equal(
    internals.insertMentionAtCaret('', 'a.txt'),
    '@a.txt ',
  )
  assert.equal(
    internals.insertMentionAtCaret('Existing content', 'src/app.ts', 16),
    'Existing content @src/app.ts ',
  )
})

test('floating button is strictly banned and composer entry provides the clean PC entry point', () => {
  const source = read('lib/client.js')
  // Must contain .fv-float-entry{display:none!important}
  assert.match(source, /\.fv-float-entry\{display:none!important\}/)
  // Must render composer entry inside conversation.input.left
  assert.match(source, /className: "fv-composer-entry"/)
  assert.match(source, /"aria-label": "查看项目文件"/)
  assert.match(source, /const sid = \(props && props\.sessionId\) \|\| sessionStore\.get\(\)/)
})

test('triggerDownload and performDownload handle client-side file downloads with toast feedback', async () => {
  const { internals } = loadClient()
  assert.equal(typeof internals.triggerDownload, 'function')
  assert.equal(typeof internals.performDownload, 'function')

  // Mock DOM
  const prevWindow = globalThis.window
  const prevDocument = globalThis.document
  const createdUrls = []
  const revokedUrls = []
  const clickedAnchors = []

  globalThis.window = {
    URL: {
      createObjectURL(blob) {
        const u = 'blob:test/' + Math.random().toString(36).slice(2)
        createdUrls.push({ url: u, blob })
        return u
      },
      revokeObjectURL(u) {
        revokedUrls.push(u)
      },
    },
  }

  const appendedChildren = []
  globalThis.document = {
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        style: {},
        click() {
          clickedAnchors.push({ href: this.href, download: this.download })
        },
      }
    },
    body: {
      appendChild(node) {
        appendedChildren.push(node)
      },
      removeChild(node) {
        const idx = appendedChildren.indexOf(node)
        if (idx !== -1) appendedChildren.splice(idx, 1)
      },
    },
  }

  try {
    const testBlob = new Blob(['hello world'], { type: 'text/plain' })
    const ok = internals.triggerDownload(testBlob, 'hello.txt')
    assert.equal(ok, true)
    assert.equal(clickedAnchors.length, 1)
    assert.equal(clickedAnchors[0].download, 'hello.txt')
    assert.match(clickedAnchors[0].href, /^blob:/)

    // performDownload success case
    const toasts = []
    const fakeRequest = async (method, payload) => {
      assert.equal(method, 'bytes')
      assert.equal(payload.root, 'root-1')
      assert.equal(payload.path, 'src/test.txt')
      return {
        path: 'src/test.txt',
        name: 'test.txt',
        base64: Buffer.from('file-content').toString('base64'),
      }
    }

    const downloadOk = await internals.performDownload(fakeRequest, 'root-1', 'src/test.txt', 'test.txt', (msg) => {
      toasts.push(msg)
    })
    assert.equal(downloadOk, true)
    assert.ok(toasts.some((t) => t.includes('正在准备下载')))
    assert.ok(toasts.some((t) => t.includes('已开始下载 test.txt')))

    // performDownload too-large error case
    const failToasts = []
    const tooLargeRequest = async () => {
      const err = new Error('too large')
      err.code = 'too-large'
      throw err
    }
    const failOk = await internals.performDownload(tooLargeRequest, 'root-1', 'big.bin', 'big.bin', (msg) => {
      failToasts.push(msg)
    })
    assert.equal(failOk, false)
    assert.ok(failToasts.some((t) => t.includes('文件超过下载限制（上限 100MB）')))
  } finally {
    globalThis.window = prevWindow
    globalThis.document = prevDocument
  }
})

test('performDownload falls back to a direct link when the page has no fetch', async () => {
  const { internals } = loadClient()

  const prevWindow = globalThis.window
  const prevDocument = globalThis.document
  const clickedAnchors = []

  // No `fetch`: the only channel left is handing the URL to the shell.
  globalThis.window = {
    location: { origin: 'http://127.0.0.1:3080' },
  }

  globalThis.document = {
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        style: {},
        click() {
          clickedAnchors.push({ href: this.href, download: this.download })
        },
      }
    },
    body: {
      appendChild() {},
      removeChild() {},
    },
  }

  try {
    const toasts = []
    const neverCalledRequest = async () => {
      throw new Error('should not call RPC when a direct link is available')
    }

    const ok = await internals.performDownload(neverCalledRequest, 'root-1', 'big-file.zip', 'big-file.zip', (msg) => {
      toasts.push(msg)
    })

    assert.equal(ok, true)
    assert.equal(clickedAnchors.length, 1)
    assert.equal(clickedAnchors[0].download, 'big-file.zip')
    assert.equal(
      clickedAnchors[0].href,
      '/api/file-viewer/download?root=root-1&path=big-file.zip&filename=big-file.zip',
    )
    assert.ok(toasts.some((t) => t.includes('已交由浏览器下载 big-file.zip')))
  } finally {
    globalThis.window = prevWindow
    globalThis.document = prevDocument
  }
})

test('performDownload hands a browser its own download manager after a size probe', async () => {
  const { internals } = loadClient()

  const prevWindow = globalThis.window
  const prevDocument = globalThis.document
  const clickedAnchors = []
  const calls = []

  // A browser: fetch exists, the UA is not Electron. The download manager owns
  // progress, pause and the save location, so the URL must go straight to it
  // rather than streaming bytes into the page.
  globalThis.window = {
    location: { origin: 'http://127.0.0.1:3080' },
    navigator: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0 Safari/537.36' },
    fetch: async (url, init) => {
      calls.push({ url, method: init?.method })
      return { ok: true, status: 200, headers: { get: () => null } }
    },
  }

  globalThis.document = {
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        style: {},
        click() {
          clickedAnchors.push({ href: this.href, download: this.download })
        },
      }
    },
    body: { appendChild() {}, removeChild() {} },
  }

  try {
    const toasts = []
    const ok = await internals.performDownload(
      async () => { throw new Error('the RPC byte channel must stay unused') },
      'root-1',
      'archive.zip',
      'archive.zip',
      (msg) => toasts.push(msg),
    )

    assert.equal(ok, true)
    // Only the HEAD probe runs; the body is never read into the page.
    assert.equal(calls.length, 1)
    assert.equal(calls[0].method, 'HEAD')
    assert.equal(clickedAnchors.length, 1)
    assert.equal(clickedAnchors[0].download, 'archive.zip')
    assert.match(clickedAnchors[0].href, /\/api\/file-viewer\/download\?/)
    assert.ok(toasts.some((t) => t.includes('已交由浏览器下载 archive.zip')))
  } finally {
    globalThis.window = prevWindow
    globalThis.document = prevDocument
  }
})

test('performDownload reports the 100 MB limit from the probe instead of starting a download', async () => {
  const { internals } = loadClient()

  const prevWindow = globalThis.window
  const prevDocument = globalThis.document
  const clickedAnchors = []

  globalThis.window = {
    location: { origin: 'http://127.0.0.1:3080' },
    navigator: { userAgent: 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36' },
    fetch: async () => ({ ok: false, status: 413, headers: { get: () => null } }),
  }

  globalThis.document = {
    createElement(tag) {
      return { tagName: tag.toUpperCase(), style: {}, click() { clickedAnchors.push(this.href) } }
    },
    body: { appendChild() {}, removeChild() {} },
  }

  try {
    const toasts = []
    const ok = await internals.performDownload(
      async () => { throw new Error('unused') },
      'root-1',
      'huge.bin',
      'huge.bin',
      (msg) => toasts.push(msg),
    )

    assert.equal(ok, false)
    assert.equal(clickedAnchors.length, 0, 'an oversize file must not start a download')
    assert.ok(toasts.some((t) => t.includes('文件超过下载限制（上限 100MB）')))
  } finally {
    globalThis.window = prevWindow
    globalThis.document = prevDocument
  }
})

test('isDesktopShell recognises the Electron UA and process marker', () => {
  const { internals } = loadClient()

  assert.equal(internals.isDesktopShell({ navigator: { userAgent: 'Mozilla/5.0 Chrome/120 Electron/28.0.0' } }), true)
  assert.equal(internals.isDesktopShell({ navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' } }), false)
  assert.equal(internals.isDesktopShell({ process: { versions: { electron: '28.0.0' } } }), true)
  // A shell that hides both signals must not throw.
  assert.equal(internals.isDesktopShell({}), false)
  assert.equal(internals.isDesktopShell(null), false)
  assert.equal(internals.isDesktopShell({ get navigator() { throw new Error('blocked') } }), false)
})

test('performDownload handles streaming download with real-time progress for Desktop and Web', async () => {
  const { internals } = loadClient()

  const prevWindow = globalThis.window
  const prevDocument = globalThis.document
  const clickedAnchors = []

  const chunk1 = Buffer.from('hello-')
  const chunk2 = Buffer.from('stream-download')
  const totalLength = chunk1.length + chunk2.length

  let readCount = 0
  const fakeReader = {
    async read() {
      if (readCount === 0) {
        readCount++
        return { done: false, value: new Uint8Array(chunk1) }
      }
      if (readCount === 1) {
        readCount++
        return { done: false, value: new Uint8Array(chunk2) }
      }
      return { done: true, value: undefined }
    },
  }

  globalThis.window = {
    location: { origin: 'http://127.0.0.1:3080' },
    // The Desktop shell is the host without a download panel, so it is the one
    // that streams bytes and draws its own progress.
    navigator: { userAgent: 'Mozilla/5.0 Chrome/120.0 Safari/537.36 Electron/28.0.0' },
    URL: {
      createObjectURL(blob) {
        return 'blob:http://127.0.0.1:3080/' + Math.random().toString(36).slice(2)
      },
      revokeObjectURL() {},
    },
    fetch: async (url) => {
      assert.ok(url.includes('/api/file-viewer/download'))
      return {
        ok: true,
        status: 200,
        headers: {
          get(h) {
            if (h.toLowerCase() === 'content-length') return String(totalLength)
            if (h.toLowerCase() === 'content-type') return 'application/octet-stream'
            return null
          },
        },
        body: { getReader: () => fakeReader },
      }
    },
  }

  globalThis.document = {
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        style: {},
        click() {
          clickedAnchors.push({ href: this.href, download: this.download })
        },
      }
    },
    body: {
      appendChild() {},
      removeChild() {},
    },
  }

  try {
    const toasts = []
    const ok = await internals.performDownload(null, 'root-1', 'stream.bin', 'stream.bin', (msg) => {
      toasts.push(msg)
    })

    assert.equal(ok, true)
    assert.equal(clickedAnchors.length, 1)
    assert.equal(clickedAnchors[0].download, 'stream.bin')
    assert.match(clickedAnchors[0].href, /^blob:/)
    assert.ok(toasts.some((t) => t.includes('正在准备下载')))
    assert.ok(toasts.some((t) => t.includes('正在下载 stream.bin')))
    assert.ok(toasts.some((t) => t.includes('✓ 下载完成 stream.bin')))
  } finally {
    globalThis.window = prevWindow
    globalThis.document = prevDocument
  }
})

test('client bundle UI wires download button in head, context menu item, and binary note fallback', () => {
  const source = read('lib/client.js')

  // Top header download button
  assert.match(source, /className: "fv-icon-button fv-btn-download"/)
  assert.match(source, /title: "下载文件"/)
  assert.match(source, /onClick: \(\) => handleDownloadItem\(meta\)/)

  // Context menu download item
  assert.match(source, /className: "fv-context-item fv-context-item-download"/)
  assert.match(source, /react\.createElement\("span", \{ className: "fv-context-item-label" \}, "下载文件"\)/)

  // Binary/oversize fallback card download button
  assert.match(source, /className: "fv-button fv-btn-download-note"/)
  assert.match(source, /下载到本地/)

  // SvgIconDownload
  assert.match(source, /function SvgIconDownload/)
})
/**
 * 宿主只提供 `--dsw-font-base-strong-16`，没有 `--dsw-font-m-16`。
 * 引用不存在的 token 会让整条 `font:` 简写失效——标题静默退回默认字号，没有报错。
 * 统一要求：字阶 token 必须带完整 fallback，宿主换名字时至少退化成正确字号。
 */
test('标题字阶引用宿主真实 token，并带字号 fallback', () => {
  const source = read('lib/client.js')
  for (const selector of ['.fv-title', '.fv-modal-title']) {
    const rule = source.match(new RegExp(`\\${selector}\\{[^}]*\\}`))?.[0]
    assert.ok(rule, `缺少 ${selector} 规则`)
    assert.match(
      rule,
      /var\(--dsw-font-base-strong-16,600 16px\/24px var\(--dsw-font-family\)\)/,
      `${selector} 必须用宿主真实存在的字阶 token 并带 fallback`,
    )
    assert.doesNotMatch(rule, /--dsw-font-m-16/, `${selector} 引用了宿主不存在的 --dsw-font-m-16`)
  }
})

/**
 * 品牌色块的文字必须走 `--dsw-alias-label-primary-foreground`。
 * Zai 这类主题会把 `--dsw-alias-brand-primary` 映射成单色（亮色 #000 / 暗色 #fff），
 * 硬编码 `#fff` 在暗色下就是白底白字；反过来，主题的 foreground 一定与 brand 反色。
 */
test('品牌色按钮的前景走宿主 token，不硬编码白色', () => {
  const source = read('lib/client.js')
  const rules = [
    ...source.matchAll(/\.fv-tab\[aria-selected="true"\]\{[^}]*\}/g),
    ...source.matchAll(/\.fv-btn-primary\{[^}]*\}/g),
    ...source.matchAll(/\.fv-input-row \.fv-button\{[^}]*\}/g),
  ].map((match) => match[0])
  assert.equal(rules.length, 3, '品牌色块规则数量变化，请同步更新这条断言')
  for (const rule of rules) {
    assert.match(rule, /background:var\(--dsw-alias-brand-primary/)
    assert.match(rule, /color:var\(--dsw-alias-label-primary-foreground/)
    assert.doesNotMatch(rule, /(?:^|;)color:#fff/, `硬编码白色会在暗色主题下白底白字：${rule.slice(0, 80)}`)
  }
  // 选中态里的 diff 统计同样跟着前景 token 走，否则暗色下增减行号会看不见。
  assert.match(
    source,
    /\.fv-tab\[aria-selected="true"\] \.fv-diff-add,\.fv-tab\[aria-selected="true"\] \.fv-diff-del\{color:var\(--dsw-alias-label-primary-foreground/,
  )
})

/* -------------------------------------------------------------------------- *
 * Git panel
 *
 * The panel talks to four host methods and keeps one snapshot for both of its
 * panes, so these tests exercise the controller directly (with a fake RPC) and
 * then check that the bundle wires the pieces together. The controller tests
 * matter most: they cover the concurrency rule that a slow answer for an old
 * branch or commit must never overwrite a newer one.
 * -------------------------------------------------------------------------- */

const GIT_SHA_A = 'a'.repeat(40)
const GIT_SHA_B = 'b'.repeat(40)

/**
 * One repository as the host reports it.
 *
 * Branches are keyed by full ref and carry the short name and kind, because a
 * local branch may share its short name with a remote-tracking one and only the
 * full ref says which is which.
 */
const gitRepo = (overrides = {}) => ({
  id: '.',
  name: 'repo',
  path: '',
  scope: 'root',
  remotes: [{ name: 'origin', url: 'https://example.test/repo.git' }],
  current: 'main',
  detached: false,
  empty: false,
  branches: [
    { name: 'refs/heads/main', shortName: 'main', kind: 'local', remote: '', current: true, checkoutable: true },
    { name: 'refs/heads/dev', shortName: 'dev', kind: 'local', remote: '', current: false, checkoutable: true },
  ],
  ...overrides,
})

const gitCommit = (sha, subject) => ({
  sha,
  shortSha: sha.slice(0, 7),
  author: '张三',
  authorEmail: 'zhang@example.com',
  authoredAt: '2024-05-01T12:00:00+08:00',
  committedAt: '2024-05-01T12:00:05+08:00',
  subject,
})

test('the Git controller opens the checked-out branch and pages its history', async () => {
  const { internals } = loadClient()
  const calls = []
  const request = async (method, payload) => {
    calls.push({ method, payload })
    if (method === 'gitRepos') return { repos: [gitRepo()] }
    if (method === 'gitCommits') {
      const offset = payload.offset
      return {
        repository: payload.repo,
        branch: payload.branch,
        total: 40,
        offset,
        limit: payload.limit,
        commits: [gitCommit(offset === 0 ? GIT_SHA_A : GIT_SHA_B, offset === 0 ? '第一个' : '第二个')],
        hasMore: offset === 0,
      }
    }
    throw new Error(`unexpected ${method}`)
  }

  const git = internals.createGitController(request)
  git.reset('/repo')
  await git.loadRepos()

  let state = git.store.get()
  assert.equal(state.repos.length, 1)
  assert.equal(state.repoId, '.')
  assert.equal(state.branch, 'refs/heads/main')
  assert.equal(state.current, 'refs/heads/main')
  assert.deepEqual(state.branches.map((branch) => branch.name), ['refs/heads/main', 'refs/heads/dev'])
  assert.equal(state.commits.length, 1)
  assert.equal(state.total, 40)
  assert.equal(state.hasMore, true)

  // The panel opens on the checked-out branch, first page.
  const firstPage = calls.find((call) => call.method === 'gitCommits')
  assert.deepEqual(firstPage.payload, { root: '/repo', repo: '.', branch: 'refs/heads/main', offset: 0, limit: internals.GIT_PAGE_SIZE })

  await git.loadMore()
  state = git.store.get()
  assert.equal(state.commits.length, 2)
  assert.equal(state.commits[1].sha, GIT_SHA_B)
  assert.equal(state.hasMore, false)

  // Paging past the end is a no-op, not another request.
  const before = calls.length
  await git.loadMore()
  assert.equal(calls.length, before)
})

test('choosing another branch reloads its history without touching the checkout', async () => {
  const { internals } = loadClient()
  const calls = []
  const request = async (method, payload) => {
    calls.push({ method, payload })
    if (method === 'gitRepos') return { repos: [gitRepo()] }
    if (method === 'gitCommits') {
      return { repository: payload.repo, branch: payload.branch, total: 1, offset: 0, limit: 30, commits: [gitCommit(GIT_SHA_A, payload.branch)], hasMore: false }
    }
    throw new Error(`unexpected ${method}`)
  }

  const git = internals.createGitController(request)
  git.reset('/repo')
  await git.loadRepos()
  await git.pickBranch('refs/heads/dev')

  const state = git.store.get()
  assert.equal(state.branch, 'refs/heads/dev')
  // The fake echoes the requested branch as the subject, which is now a ref.
  assert.equal(state.commits[0].subject, 'refs/heads/dev')
  // Browsing a branch is read-only: only an explicit checkout may write.
  assert.equal(calls.some((call) => call.method === 'gitCheckout'), false)
})

test('a checkout that git refuses reports it and clears the busy flag', async () => {
  const { internals } = loadClient()
  const request = async (method) => {
    if (method === 'gitRepos') return { repos: [gitRepo()] }
    if (method === 'gitCommits') return { repository: '.', branch: 'main', total: 0, offset: 0, limit: 30, commits: [], hasMore: false }
    if (method === 'gitCheckout') {
      const error = new Error('工作区有未提交的改动')
      error.code = 'git-dirty'
      throw error
    }
    throw new Error(`unexpected ${method}`)
  }

  const git = internals.createGitController(request)
  git.reset('/repo')
  await git.loadRepos()
  await git.checkout('dev')

  const state = git.store.get()
  assert.equal(state.busy, false)
  assert.match(state.notice, /未提交的改动/)
  // The working tree never moved, so the displayed branch is unchanged.
  assert.equal(state.branch, 'main')
})

test('a successful checkout notices and re-reads the repository', async () => {
  const { internals } = loadClient()
  let repoCalls = 0
  const request = async (method, payload) => {
    if (method === 'gitRepos') {
      repoCalls += 1
      return { repos: [gitRepo({ current: repoCalls > 1 ? 'dev' : 'main' })] }
    }
    if (method === 'gitCommits') return { repository: '.', branch: payload.branch, total: 0, offset: 0, limit: 30, commits: [], hasMore: false }
    if (method === 'gitCheckout') return { ok: true, branch: 'dev', previous: 'main', changed: true }
    throw new Error(`unexpected ${method}`)
  }

  const git = internals.createGitController(request)
  git.reset('/repo')
  await git.loadRepos()
  await git.checkout('dev')

  const state = git.store.get()
  assert.equal(state.busy, false)
  assert.match(state.notice, /已切换到 dev/)
  assert.equal(repoCalls, 2)
  assert.equal(state.current, 'refs/heads/dev')
  assert.equal(state.branch, 'refs/heads/dev')
})

test('a commit detail is read by hash and dropped on reset', async () => {
  const { internals } = loadClient()
  const request = async (method, payload) => {
    if (method === 'gitRepos') return { repos: [gitRepo()] }
    if (method === 'gitCommits') return { repository: '.', branch: 'main', total: 0, offset: 0, limit: 30, commits: [], hasMore: false }
    if (method === 'gitCommitFiles') {
      assert.deepEqual(payload, { root: '/repo', repo: '.', sha: GIT_SHA_A })
      return {
        repository: '.',
        commit: { ...gitCommit(GIT_SHA_A, '修改入口'), body: '修改入口\n\n正文' },
        files: [{ path: 'src/app.ts', oldPath: null, status: 'M', letter: 'M', change: '修改', tone: 'mod', outsideRoot: false }],
      }
    }
    throw new Error(`unexpected ${method}`)
  }

  const git = internals.createGitController(request)
  git.reset('/repo')
  await git.loadRepos()
  await git.openCommit(GIT_SHA_A)

  let state = git.store.get()
  assert.equal(state.detailStatus, 'ready')
  assert.equal(state.detail.commit.sha, GIT_SHA_A)
  assert.equal(state.detail.commit.body, '修改入口\n\n正文')
  assert.equal(state.detail.files[0].path, 'src/app.ts')

  git.reset('/repo')
  state = git.store.get()
  assert.equal(state.detail, null)
  assert.equal(state.detailStatus, 'idle')
})

test('a slow commit answer cannot overwrite a newer selection', async () => {
  const { internals } = loadClient()
  const pending = []
  const request = async (method, payload) => {
    if (method === 'gitRepos') return { repos: [gitRepo()] }
    if (method === 'gitCommits') return { repository: '.', branch: 'main', total: 0, offset: 0, limit: 30, commits: [], hasMore: false }
    if (method === 'gitCommitFiles') {
      return new Promise((resolve) => pending.push({ sha: payload.sha, resolve }))
    }
    throw new Error(`unexpected ${method}`)
  }

  const git = internals.createGitController(request)
  git.reset('/repo')
  await git.loadRepos()

  const first = git.openCommit(GIT_SHA_A)
  const second = git.openCommit(GIT_SHA_B)
  assert.equal(pending.length, 2)

  // The newer selection answers first; the older one arrives afterwards and
  // must be discarded rather than replacing what the reader is looking at.
  pending[1].resolve({ repository: '.', commit: { ...gitCommit(GIT_SHA_B, '新') }, files: [] })
  await second
  pending[0].resolve({ repository: '.', commit: { ...gitCommit(GIT_SHA_A, '旧') }, files: [] })
  await first

  const state = git.store.get()
  assert.equal(state.detail.commit.sha, GIT_SHA_B)
  assert.equal(state.detail.commit.subject, '新')
})

test('the Git sidebar renders a repository, branches and history without crashing', () => {
  const { internals } = loadClient()
  assert.equal(typeof internals.GitSidebar, 'function')
  assert.equal(typeof internals.CommitDetail, 'function')
  assert.equal(typeof internals.createGitController, 'function')

  const state = {
    root: '/repo',
    repos: [gitRepo(), gitRepo({ id: 'packages/app', name: 'packages/app', current: 'dev' })],
    reposStatus: 'ready',
    reposError: null,
    repoId: '.',
    branches: [{ name: 'main', current: true }, { name: 'dev', current: false }],
    current: 'main',
    detached: false,
    branch: 'dev',
    commits: [gitCommit(GIT_SHA_A, '第一个提交')],
    commitsStatus: 'ready',
    commitsError: null,
    total: 40,
    hasMore: true,
    detail: null,
    detailStatus: 'idle',
    detailError: null,
    busy: false,
    notice: '已在该分支上',
  }
  const handlers = {
    onPickRepo() {},
    onPickBranch() {},
    onCheckout() {},
    onSelectCommit() {},
    onLoadMore() {},
    onRetry() {},
  }

  // Multi-repository, an unhidden checkout button for a non-current branch, a
  // page counter and a "load more" affordance.
  assert.doesNotThrow(() => internals.GitSidebar({ state, width: 280, header: null, selectedSha: '', ...handlers }))
  // Empty and error states are separate branches with no repository to read.
  assert.doesNotThrow(() => internals.GitSidebar({ state: { ...state, repos: [], reposStatus: 'empty' }, header: null, ...handlers }))
  assert.doesNotThrow(() => internals.GitSidebar({ state: { ...state, reposStatus: 'error', reposError: new Error('x') }, header: null, ...handlers }))
})

test('the commit pane renders changed files and disables ones outside the root', () => {
  const { internals } = loadClient()
  const base = {
    repos: [gitRepo()],
    branch: 'main',
    total: 0,
    hasMore: false,
    commits: [],
  }
  const detail = {
    repository: '.',
    commit: { ...gitCommit(GIT_SHA_A, '标题'), body: '标题\n\n正文段落' },
    files: [
      { path: 'src/app.ts', oldPath: null, status: 'M', letter: 'M', change: '修改', tone: 'mod', outsideRoot: false },
      { path: 'img/logo.png', oldPath: 'img/old-logo.png', status: 'R100', letter: 'R', change: '重命名', tone: 'mod', outsideRoot: false },
      { path: 'outside/file.txt', oldPath: null, status: 'M', letter: 'M', change: '修改', tone: 'mod', outsideRoot: true },
    ],
  }

  assert.doesNotThrow(() => internals.CommitDetail({
    state: { ...base, detail, detailStatus: 'ready' },
    selectedPath: 'src/app.ts',
    onSelectFile() {},
  }))
  // Loading and failed states never read a half-populated detail.
  assert.doesNotThrow(() => internals.CommitDetail({ state: { ...base, detail: null, detailStatus: 'loading' }, selectedPath: '', onSelectFile() {} }))
  assert.doesNotThrow(() => internals.CommitDetail({ state: { ...base, detail: null, detailStatus: 'error', detailError: new Error('x') }, selectedPath: '', onSelectFile() {} }))
})

/* -------------------------------------------------------------------------- *
 * The viewer must not be treated as a centred modal card
 *
 * The overlay seat is mounted inside a plain div[role="presentation"], and
 * dsh-mobile-adapter turns any such container holding a
 * [role="dialog"][aria-modal="true"] into a full-screen rgba(0,0,0,.5) scrim
 * with blur(4px), while shrinking the dialog to a 420px centred card. The
 * viewer is a full-height drawer pinned to the right edge, so that treatment
 * blacked out the whole app behind it — reported as "the right-click menu has
 * an opaque mask" — and fought the drawer's own width. These assertions pin the
 * opt-out, which is what actually removes the mask.
 * -------------------------------------------------------------------------- */

test('the viewer opts out of the host modal-card treatment', () => {
  const source = read('lib/client.js')

  // The container that holds this drawer loses the dark scrim and the blur.
  assert.match(
    source,
    /body>div\[role="presentation"\]:has\(\.fv-scrim\)\{background:transparent!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important/,
  )
  // The adapter's own sibling scrim is not rendered either.
  assert.match(source, /body>div\[role="presentation"\]:has\(\.fv-scrim\)>\[aria-hidden="true"\]\{display:none!important\}/)
  // And the drawer keeps its full-bleed, right-aligned shape instead of
  // becoming a 420px rounded card.
  const drawer = /\.fv-scrim\[role="dialog"\]\{([^}]*)\}/.exec(source)
  assert(drawer, 'the drawer override must exist')
  for (const undo of ['position:absolute!important', 'inset:0!important', 'max-width:none!important',
    'max-height:none!important', 'border-radius:0!important', 'backdrop-filter:none!important']) {
    assert(drawer[1].includes(undo), `the drawer must restore ${undo}`)
  }

  // Every opt-out is scoped to THIS drawer, so no other dialog on the page
  // changes behaviour because the file viewer is installed.
  const scoped = [...source.matchAll(/body>div\[role="presentation"\][^{]*\{/g)].map((m) => m[0])
  assert(scoped.length >= 2, 'the opt-out rules must be present')
  for (const selector of scoped) {
    assert(
      /:has\(\.fv-scrim\)|^\.fv-scrim\[role="dialog"\]/.test(selector),
      `an opt-out escaped its scope: ${selector}`,
    )
  }
})

test('the context menu refuses the glass theme treatment', () => {
  const source = read('lib/client.js')

  // The glass theme paints `[role="menu"]` with a translucent background and a
  // large backdrop blur. This menu carries role="menu", so the blur smeared the
  // full-screen backdrop behind it — the whole app went hazy and only the menu
  // outline stayed readable.
  //
  // Measured in Chromium: the theme's selector
  //   :is(html[data-theme-studio=...]) [role="menu"]:not(:is(...))
  // outranks every class-based override, and its sheet loads after this bundle,
  // so class-level !important lost. An id wins regardless of order.
  assert.match(source, /const CONTEXT_MENU_ID = "dsh-fv-context-menu"/)
  const menus = source.match(/id: CONTEXT_MENU_ID,/g) || []
  assert.equal(menus.length, 2, 'both menus (tree and tabs) must carry the id')

  const rule = /#dsh-fv-context-menu\{([^}]*)\}/.exec(source)
  assert(rule, 'the id-scoped override must exist')
  const body = rule[1]
  assert.match(body, /-webkit-backdrop-filter:none!important/)
  assert.match(body, /backdrop-filter:none!important/)
  assert.match(body, /isolation:isolate/)
})

test('the context menu uses an opaque surface, not the host translucent one', () => {
  const source = read('lib/client.js')

  // The host's menu token is --dsw-specific-menu -> --dsw-menu-surface-fill,
  // measured as #f8f9fa94 (58% opaque) in light and #43454a73 (45%) in dark.
  // Those values assume the host's own backdrop blur sits behind them. This
  // menu deliberately has no blur (see the glass-theme test), so reusing the
  // token painted a translucent panel with the page's text showing through —
  // the "still glassy under the default theme" report.
  assert.doesNotMatch(source, /--dsw-specific-menu/, 'the translucent host token must not be used')

  // Every menu background instead resolves to an opaque layer colour, with the
  // base colour as the final fallback.
  const rules = [...source.matchAll(/\.fv-context-menu\{([^}]*)\}/g)].map((m) => m[1])
    .concat([...(/\.fv-context-menu\{background-color:([^}]*)\}/.exec(source) || [])[1] || '']
      ? [/\.fv-context-menu\{background-color:([^}]*)\}/.exec(source)[1]]
      : [])
    .concat([...(/#dsh-fv-context-menu\{([^}]*)\}/.exec(source) || [])[1] || '']
      ? [/#dsh-fv-context-menu\{([^}]*)\}/.exec(source)[1]]
      : [])
  assert(rules.length >= 2, 'the menu background rules must be present')
  for (const rule of rules) {
    if (!/background/.test(rule)) continue
    assert.match(rule, /var\(--dsw-alias-bg-layer-2,var\(--dsw-alias-bg-base/, `menu background must use an opaque layer colour: ${rule}`)
  }
})

test('the context menu backdrop itself stays transparent', () => {
  const source = read('lib/client.js')
  const rules = [...source.matchAll(/\.fv-context-backdrop\{([^}]*)\}/g)].map((m) => m[1])
  assert(rules.length >= 2, 'the base rule and the mobile override must both exist')
  for (const body of rules) {
    assert.match(body, /background:transparent/, `every backdrop rule must stay transparent: ${body}`)
    assert.doesNotMatch(body, /backdrop-filter:(?!none)/, `no blur may be reintroduced: ${body}`)
  }
  // The mobile menu keeps its own bottom-sheet styling; that is what gives it
  // focus now that no scrim does.
  assert.match(source, /\.fv-context-menu\{position:fixed!important;bottom:max\(16px,var\(--dsh-sab,0px\)\)!important/)
})

test('the bundle wires the Git panel to the host RPC methods and its own styles', () => {
  const source = read('lib/client.js')

  // One method per panel capability; the names must match the host table.
  for (const method of ['gitRepos', 'gitCommits', 'gitCommitFiles', 'gitCheckout']) {
    assert.match(source, new RegExp(`request\\("${method}"`), `the client must call the ${method} RPC`)
  }

  // Sidebar: two tabs sharing one seat, and the tree keeps its container class
  // so the existing mobile pane-swap rules still apply to the Git panel.
  assert.match(source, /className: "fv-side-tabs"/)
  assert.match(source, /className: "fv-tree fv-git-panel"/)
  assert.match(source, /"aria-selected": side === "git"/)
  assert.match(source, /side === "git"\s*\n\s*\? react\.createElement\(GitSidebar/)

  // Commit rows and file rows exist as real controls, with the diff letters.
  assert.match(source, /className: "fv-git-commit"/)
  assert.match(source, /className: "fv-commit-file"/)
  assert.match(source, /className: "fv-commit-status"/)
  assert.match(source, /该文件在当前根目录之外/)

  // Clicking a changed file reuses the file preview rather than a second viewer.
  assert.match(source, /const openCommitFile = /)
  assert.match(source, /selectFile\(\{ path: file\.path/)

  // Styles for the panel and its phone layout.
  assert.match(source, /\.fv-git-commit\{/)
  assert.match(source, /\.fv-commit-file\{/)
  assert.match(source, /\.fv-side-tab\{height:32px!important/)

  // The list is only requested when the tab is first opened.
  assert.match(source, /git\.ensure\(\)/)
  // Switching roots drops cached history.
  assert.match(source, /git\.reset\(root\)/)
})

/* -------------------------------------------------------------------------- *
 * Git panel: the failures the first round could not see
 * -------------------------------------------------------------------------- */

test('loading more while opening a commit does not strand the pager', async () => {
  const { internals } = loadClient()
  let releaseMore
  const request = async (method, payload) => {
    if (method === 'gitRepos') return { repos: [gitRepo()], truncated: false }
    if (method === 'gitCommits') {
      if (payload.offset === 0) {
        return { repository: '.', branch: 'main', total: 40, offset: 0, limit: 30, commits: [gitCommit(GIT_SHA_A, 'a')], hasMore: true }
      }
      // The second page stays in flight until the test releases it.
      return new Promise((resolve) => {
        releaseMore = () => resolve({
          repository: '.', branch: 'main', total: 40, offset: 1, limit: 30,
          commits: [gitCommit(GIT_SHA_B, 'b')], hasMore: false,
        })
      })
    }
    if (method === 'gitCommitFiles') {
      return { repository: '.', commit: { ...gitCommit(GIT_SHA_A, 'a') }, files: [] }
    }
    throw new Error(`unexpected ${method}`)
  }

  const git = internals.createGitController(request)
  git.reset('/repo')
  await git.loadRepos()

  const more = git.loadMore()
  assert.equal(git.store.get().commitsStatus, 'more')

  // Opening a commit used to share the counter with the list and cancel this
  // request, leaving the button disabled forever.
  await git.openCommit(GIT_SHA_A)
  assert.equal(git.store.get().detailStatus, 'ready')

  releaseMore()
  await more
  const state = git.store.get()
  assert.equal(state.commitsStatus, 'ready')
  assert.equal(state.commits.length, 2)
  // And the detail survived the list update.
  assert.equal(state.detailStatus, 'ready')
})

test('a refresh keeps the branch being browsed', async () => {
  const { internals } = loadClient()
  let repoCalls = 0
  const request = async (method, payload) => {
    if (method === 'gitRepos') {
      repoCalls += 1
      // The checkout never moves; only browsing changes.
      return { repos: [gitRepo()], truncated: false }
    }
    if (method === 'gitCommits') {
      return { repository: '.', branch: payload.branch, total: 1, offset: 0, limit: 30, commits: [], hasMore: false }
    }
    throw new Error(`unexpected ${method}`)
  }

  const git = internals.createGitController(request)
  git.reset('/repo')
  await git.loadRepos()
  await git.pickBranch('refs/heads/dev')
  assert.equal(git.store.get().branch, 'refs/heads/dev')

  // A refresh must come back to `dev`, not jump to the checked-out `main`.
  await git.loadRepos()
  assert.equal(git.store.get().branch, 'refs/heads/dev')
  assert.equal(repoCalls, 2)
})

test('a checkout lands on the branch that was checked out', async () => {
  const { internals } = loadClient()
  let repoCalls = 0
  const request = async (method, payload) => {
    if (method === 'gitRepos') {
      repoCalls += 1
      const current = repoCalls > 1 ? 'dev' : 'main'
      return { repos: [gitRepo({ current })], truncated: false }
    }
    if (method === 'gitCommits') {
      return { repository: '.', branch: payload.branch, total: 0, offset: 0, limit: 30, commits: [], hasMore: false }
    }
    if (method === 'gitCheckout') {
      assert.equal(payload.allowOutsideRoot, undefined, 'a root-scope checkout needs no consent flag')
      return { ok: true, branch: 'dev', previous: 'main', changed: true, scope: 'root' }
    }
    throw new Error(`unexpected ${method}`)
  }

  const git = internals.createGitController(request)
  git.reset('/repo')
  await git.loadRepos()
  await git.pickBranch('main')
  await git.checkout('refs/heads/dev')
  assert.equal(git.store.get().branch, 'refs/heads/dev')
  assert.equal(git.store.get().current, 'refs/heads/dev')
})

test('a parent-scope checkout sends its consent flag', async () => {
  const { internals } = loadClient()
  const seen = []
  const request = async (method, payload) => {
    if (method === 'gitRepos') {
      return { repos: [gitRepo({ scope: 'parent' })], truncated: false }
    }
    if (method === 'gitCommits') {
      return { repository: '.', branch: payload.branch, total: 0, offset: 0, limit: 30, commits: [], hasMore: false }
    }
    if (method === 'gitCheckout') {
      seen.push(payload.allowOutsideRoot)
      return { ok: true, branch: 'dev', previous: 'main', changed: true, scope: 'parent' }
    }
    throw new Error(`unexpected ${method}`)
  }

  const git = internals.createGitController(request)
  git.reset('/repo')
  await git.loadRepos()
  assert.equal(git.store.get().scope, 'parent')
  await git.checkout('dev', true)
  assert.deepEqual(seen, [true])
})

test('a checkout without consent on a parent repository reports the refusal', async () => {
  const { internals } = loadClient()
  const request = async (method) => {
    if (method === 'gitRepos') return { repos: [gitRepo({ scope: 'parent' })], truncated: false }
    if (method === 'gitCommits') return { repository: '.', branch: 'main', total: 0, offset: 0, limit: 30, commits: [], hasMore: false }
    if (method === 'gitCheckout') {
      const error = new Error('outside root')
      error.code = 'checkout-outside-root'
      throw error
    }
    throw new Error(`unexpected ${method}`)
  }

  const git = internals.createGitController(request)
  git.reset('/repo')
  await git.loadRepos()
  await git.checkout('dev')
  const state = git.store.get()
  assert.equal(state.busy, false)
  assert.match(state.notice, /根目录以外的文件/)
})

test('a truncated scan is surfaced to the sidebar', () => {
  const { internals } = loadClient()
  const state = {
    root: '/repo',
    repos: [gitRepo()],
    reposStatus: 'ready',
    reposError: null,
    truncated: true,
    repoId: '.',
    branches: [{ name: 'main', current: true }],
    current: 'main',
    detached: false,
    scope: 'parent',
    branch: 'main',
    commits: [],
    commitsStatus: 'ready',
    commitsError: null,
    total: 0,
    hasMore: false,
    detail: null,
    detailStatus: 'idle',
    detailError: null,
    busy: false,
    notice: '',
  }
  const handlers = {
    onPickRepo() {}, onPickBranch() {}, onCheckout() {}, onSelectCommit() {}, onLoadMore() {}, onRetry() {},
  }
  const tree = internals.GitSidebar({ state, header: null, selectedSha: '', ...handlers })
  // The bundle's `createElement` stub keeps children in their own array, so the
  // walk has to follow that shape rather than React's props.children.
  const texts = []
  const walk = (node) => {
    if (node === null || node === undefined || node === false) return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (typeof node === 'string' || typeof node === 'number') { texts.push(String(node)); return }
    walk(node.children)
  }
  walk(tree)
  const joined = texts.join('|')
  // Both warnings appear: the list may be incomplete, and a checkout here
  // would reach outside the root.
  assert.match(joined, /列表可能不完整/)
  assert.match(joined, /检出范围提醒/)
})

test('a commit preview reads the commit blob and says so', () => {
  const source = read('lib/client.js')

  // The read is routed by whether a commit is being previewed.
  assert.match(source, /const fromCommit = typeof commit === "string" && commit !== ""/)
  assert.match(source, /const readMethod = fromCommit \? "gitCommitFile" : "read"/)
  // A historical file is diffed against its own commit, not the index — the
  // working-tree comparison would answer a different question. When the commit
  // is unknown there is nothing to diff against at all.
  assert.match(source, /request\("gitCommitDiff", \{/)
  assert.match(source, /if \(fromCommit\) \{\s*\n\s*if \(diffSha === ""\) \{\s*\n\s*setDiffData\(null\)/)
  // The pane states its provenance rather than looking like the current file.
  assert.match(source, /className: "fv-history-banner"/)
  assert.match(source, /这是历史版本，不是工作区当前内容/)
  // Clicking a changed file opens that commit, not the working tree. The tab
  // that row opens carries the hash the viewer later reads its blob from.
  assert.match(source, /const sha = commitSha/)
  assert.match(source, /commit: readSha/)
  assert.match(source, /const readMethod = fromCommit \? "gitCommitFile" : "read"/)
  // A deletion (and a rename's old path) has no blob in this commit, so the
  // parent is read instead; the row's own letter decides which.
  assert.match(source, /const fromParent = \(letter === "D" \|\| letter === "R"\) && parentSha !== ""/)
  assert.match(source, /const readSha = fromParent \? parentSha : sha/)
})

test('a refresh restores the open commit after re-reading the repository', () => {
  const source = read('lib/client.js')
  // The branch is reloaded first, then the commit is put back: loadRepos clears
  // the detail by design, so the order matters.
  assert.match(source, /git\.loadRepos\(\)\.then\(\(\) => \{\s*\n\s*if \(keepSha !== ""\) git\.openCommit\(keepSha\)/)
})

/* -------------------------------------------------------------------------- *
 * Remote branches, working-tree changes, commit diffs (client)
 * -------------------------------------------------------------------------- */

const remoteRepo = () => gitRepo({
  branches: [
    { name: 'refs/heads/main', shortName: 'main', kind: 'local', remote: '', current: true, checkoutable: true },
    { name: 'refs/heads/dev', shortName: 'dev', kind: 'local', remote: '', current: false, checkoutable: true },
    { name: 'refs/remotes/origin/release', shortName: 'origin/release', kind: 'remote', remote: 'origin', current: false, checkoutable: false },
  ],
})

test('the controller reads the working tree on demand and groups it', async () => {
  const { internals } = loadClient()
  const calls = []
  const request = async (method, payload) => {
    calls.push({ method, payload })
    if (method === 'gitRepos') return { repos: [gitRepo()], truncated: false }
    if (method === 'gitCommits') return { repository: '.', branch: payload.branch, total: 0, offset: 0, limit: 30, commits: [], hasMore: false }
    if (method === 'gitStatusChanges') {
      return {
        repository: '.', current: 'main', detached: false, outside: 0, total: 2,
        staged: [{ path: 'a.txt', letter: 'M', change: '修改', tone: 'mod' }],
        unstaged: [{ path: 'b.txt', letter: 'M', change: '修改', tone: 'mod' }],
        untracked: [], conflicted: [],
      }
    }
    throw new Error(`unexpected ${method}`)
  }

  const git = internals.createGitController(request)
  git.reset('/repo')
  await git.loadRepos()
  await git.loadChanges()

  const state = git.store.get()
  assert.equal(state.changesStatus, 'ready')
  assert.equal(state.changes.total, 2)
  assert.equal(state.changes.staged[0].path, 'a.txt')
  assert.deepEqual(calls.find((call) => call.method === 'gitStatusChanges').payload, { root: '/repo', repo: '.' })
})

test('a failed status read is an error, not an empty working tree', async () => {
  const { internals } = loadClient()
  const request = async (method) => {
    if (method === 'gitRepos') return { repos: [gitRepo()], truncated: false }
    if (method === 'gitCommits') return { repository: '.', branch: 'refs/heads/main', total: 0, offset: 0, limit: 30, commits: [], hasMore: false }
    if (method === 'gitStatusChanges') {
      const error = new Error('boom')
      error.code = 'git-failed'
      throw error
    }
    throw new Error(`unexpected ${method}`)
  }
  const git = internals.createGitController(request)
  git.reset('/repo')
  await git.loadRepos()
  await git.loadChanges()
  const state = git.store.get()
  assert.equal(state.changesStatus, 'error')
  assert.equal(state.changes, null)
})

test('the commit diff is read per commit and cleared on a new selection', async () => {
  const { internals } = loadClient()
  const calls = []
  const request = async (method, payload) => {
    calls.push({ method, payload })
    if (method === 'gitRepos') return { repos: [gitRepo()], truncated: false }
    if (method === 'gitCommits') return { repository: '.', branch: 'refs/heads/main', total: 0, offset: 0, limit: 30, commits: [], hasMore: false }
    if (method === 'gitCommitFiles') return { repository: '.', commit: { ...gitCommit(GIT_SHA_A, 'x') }, files: [] }
    if (method === 'gitCommitDiff') {
      return {
        repository: '.', sha: payload.sha, parentSha: GIT_SHA_B, patch: '', outside: 0,
        summary: { added: 3, removed: 1 },
        files: [{ path: 'a.txt', oldPath: null, status: 'M', letter: 'M', tone: 'mod', added: 3, removed: 1, rows: [] }],
      }
    }
    throw new Error(`unexpected ${method}`)
  }

  const git = internals.createGitController(request)
  git.reset('/repo')
  await git.loadRepos()
  await git.openCommit(GIT_SHA_A)
  await git.loadCommitDiff(GIT_SHA_A)

  let state = git.store.get()
  assert.equal(state.commitDiffStatus, 'ready')
  assert.deepEqual(state.commitDiff.summary, { added: 3, removed: 1 })
  assert.deepEqual(calls.find((call) => call.method === 'gitCommitDiff').payload, { root: '/repo', repo: '.', sha: GIT_SHA_A })

  // Selecting another commit invalidates the patch before it can be shown
  // under the wrong header.
  await git.openCommit(GIT_SHA_B)
  state = git.store.get()
  assert.equal(state.commitDiff, null)
  assert.equal(state.commitDiffStatus, 'idle')
})

test('the branch picker groups local and remote and disables checkout for remotes', () => {
  const { internals } = loadClient()
  const state = {
    root: '/repo',
    repos: [remoteRepo()],
    reposStatus: 'ready',
    reposError: null,
    truncated: false,
    remotes: [{ name: 'origin', url: 'https://example.test/repo.git' }],
    repoId: '.',
    branches: remoteRepo().branches,
    current: 'refs/heads/main',
    currentShort: 'main',
    detached: false,
    scope: 'root',
    // A remote branch is selected: the checkout control must not offer a write.
    branch: 'refs/remotes/origin/release',
    commits: [], commitsStatus: 'ready', commitsError: null, total: 0, hasMore: false,
    changes: null, changesStatus: 'ready', changesError: null,
    detail: null, detailStatus: 'idle', detailError: null,
    commitDiff: null, commitDiffStatus: 'idle', commitDiffError: null,
    busy: false, notice: '',
  }
  const handlers = {
    onPickRepo() {}, onPickBranch() {}, onCheckout() {}, onSelectCommit() {},
    onLoadMore() {}, onRetry() {}, onSelectChange() {}, onRefreshChanges() {},
  }

  const tree = internals.GitSidebar({ state, header: null, selectedSha: '', ...handlers })
  const texts = []
  const walk = (node) => {
    if (node === null || node === undefined || node === false) return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (typeof node === 'string' || typeof node === 'number') { texts.push(String(node)); return }
    // An `<optgroup>` carries its heading as an attribute, not a text child.
    if (node.type === 'optgroup' && node.props && node.props.label) texts.push(String(node.props.label))
    walk(node.children)
  }
  walk(tree)
  const joined = texts.join('|')
  assert.match(joined, /本地分支/)
  assert.match(joined, /远程分支/)
  assert.match(joined, /只读/)

  const checkouts = []
  const walkButtons = (node) => {
    if (node === null || node === undefined || node === false) return
    if (Array.isArray(node)) { node.forEach(walkButtons); return }
    if (node.props && node.props.className === 'fv-git-checkout') checkouts.push(node)
    walkButtons(node.children)
  }
  walkButtons(tree)
  // Selecting a remote branch yields a disabled, browse-only control.
  assert.equal(checkouts.length, 1)
  assert.equal(checkouts[0].props.disabled, true)
})

test('the workspace change pane lists grouped rows and opens a diff', () => {
  const { internals } = loadClient()
  const opened = []
  const state = {
    root: '/repo',
    repos: [gitRepo()],
    reposStatus: 'ready', reposError: null, truncated: false, remotes: [],
    repoId: '.',
    branches: gitRepo().branches,
    current: 'refs/heads/main', currentShort: 'main', detached: false, scope: 'root',
    branch: 'refs/heads/main',
    commits: [], commitsStatus: 'ready', commitsError: null, total: 0, hasMore: false,
    changes: {
      repository: '.', current: 'main', detached: false, outside: 1, total: 4,
      staged: [{ path: 'a.txt', letter: 'M', change: '修改', tone: 'mod', partiallyStaged: true }],
      unstaged: [{ path: 'a.txt', letter: 'M', change: '修改', tone: 'mod' }],
      untracked: [{ path: 'new.txt', letter: '?', change: '未跟踪', tone: 'add' }],
      conflicted: [{ path: 'c.txt', letter: 'U', change: '冲突', tone: 'del' }],
    },
    changesStatus: 'ready', changesError: null,
    detail: null, detailStatus: 'idle', detailError: null,
    commitDiff: null, commitDiffStatus: 'idle', commitDiffError: null,
    busy: false, notice: '',
  }
  const tree = internals.GitSidebar({
    state, header: null, selectedSha: '',
    onPickRepo() {}, onPickBranch() {}, onCheckout() {}, onSelectCommit() {},
    onLoadMore() {}, onRetry() {},
    onSelectChange: (row) => opened.push(row.path),
    onRefreshChanges() {},
  })

  const texts = []
  const walk = (node) => {
    if (node === null || node === undefined || node === false) return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (typeof node === 'string' || typeof node === 'number') { texts.push(String(node)); return }
    walk(node.children)
  }
  walk(tree)
  const joined = texts.join('|')
  for (const group of ['工作区改动', '已暂存', '未暂存', '未跟踪', '冲突']) {
    assert.match(joined, new RegExp(group), `the ${group} group must render`)
  }
  assert.match(joined, /部分暂存/)
  assert.match(joined, /1 个改动在根目录之外/)

  // The row is a real control that opens the diff.
  const rows = []
  const walkRows = (node) => {
    if (node === null || node === undefined || node === false) return
    if (Array.isArray(node)) { node.forEach(walkRows); return }
    if (node.props && node.props.className === 'fv-commit-file' && node.props.onClick) rows.push(node)
    walkRows(node.children)
  }
  walkRows(tree)
  assert(rows.length >= 4)
  rows[0].props.onClick()
  assert.equal(opened.length, 1)
})

test('the commit pane switches between files and the full patch', () => {
  const { internals } = loadClient()
  const switches = []
  const loads = []
  const state = {
    detailStatus: 'ready',
    detail: {
      repository: '.',
      commit: { ...gitCommit(GIT_SHA_A, '标题'), body: '标题' },
      parentSha: GIT_SHA_B,
      files: [{ path: 'a.txt', oldPath: null, status: 'M', letter: 'M', change: '修改', tone: 'mod', outsideRoot: false }],
    },
    commitDiff: {
      repository: '.', sha: GIT_SHA_A, parentSha: GIT_SHA_B, patch: '', outside: 0,
      summary: { added: 2, removed: 1 },
      files: [{
        path: 'a.txt', oldPath: null, status: 'M', letter: 'M', change: '修改', tone: 'mod',
        added: 2, removed: 1, rows: [{ type: 'del', oldLine: 1, newLine: null, text: 'old' }, { type: 'add', oldLine: null, newLine: 1, text: 'new' }],
      }],
    },
    commitDiffStatus: 'ready',
    commitDiffError: null,
  }

  // The files tab renders the changed-file rows.
  const filesView = internals.CommitDetail({
    state, selectedPath: '', onSelectFile() {},
    view: 'files', onSwitchView: (v) => switches.push(v), onLoadDiff: () => loads.push(true),
  })
  const collect = (node, out = []) => {
    if (node === null || node === undefined || node === false) return out
    if (Array.isArray(node)) { node.forEach((n) => collect(n, out)); return out }
    if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
    collect(node.children, out)
    return out
  }
  const filesText = collect(filesView).join('|')
  assert.match(filesText, /变更文件/)
  assert.match(filesText, /改动内容/)
  assert.match(filesText, /a\.txt/)

  // The diff tab renders per-file patches with their counts.
  const diffView = internals.CommitDetail({
    state, selectedPath: '', onSelectFile() {},
    view: 'diff', onSwitchView: (v) => switches.push(v), onLoadDiff: () => loads.push(true),
  })
  const diffText = collect(diffView).join('|')
  assert.match(diffText, /\+2 -1/)

  // Clicking the diff tab asks for the patch.
  const tabs = []
  const walkTabs = (node) => {
    if (node === null || node === undefined || node === false) return
    if (Array.isArray(node)) { node.forEach(walkTabs); return }
    if (node.props && node.props.className === 'fv-tab fv-tab-diff') tabs.push(node)
    walkTabs(node.children)
  }
  walkTabs(filesView)
  assert.equal(tabs.length, 1)
  tabs[0].props.onClick()
  assert.deepEqual(switches, ['diff'])
  assert.equal(loads.length, 1)
})

test('the bundle wires the three new host methods', () => {
  const source = read('lib/client.js')
  for (const method of ['gitStatusChanges', 'gitWorkspaceDiff', 'gitCommitDiff']) {
    assert.match(source, new RegExp(`request\\("${method}"`), `the client must call ${method}`)
  }
  // Remote branches are grouped and browse-only.
  assert.match(source, /label: "本地分支"/)
  assert.match(source, /label: "远程分支"/)
  assert.match(source, /远程分支只能查看，不能直接检出/)
  // The working-tree list is loaded with the tab, not behind a second click.
  assert.match(source, /git\.loadChanges\(\)/)
  // The diff reuses the existing renderer rather than a second one.
  assert.match(source, /react\.createElement\(DiffView, \{ diffData: \{ rows: file\.rows, diffs: \[\] \}/)
  // Styles for the new panes.
  assert.match(source, /\.fv-git-changes\{/)
  assert.match(source, /\.fv-commit-diff-file\{/)
})

/* -------------------------------------------------------------------------- *
 * Resizing the whole drawer from its leading edge
 *
 * The sidebar handle only redistributes space *inside* the panel. Widening the
 * panel itself needs its own handle on the leading edge, its own persisted
 * width, and its own clamping — the three things these tests pin down.
 * -------------------------------------------------------------------------- */

test('the drawer width is clamped to the frame, never below its own minimum', () => {
  const { internals } = loadClient()
  const min = internals.MIN_SHELL_WIDTH

  // Below the floor is raised: a narrower panel cannot hold the sidebar plus a
  // readable preview.
  assert.equal(internals.clampShellWidth(100, 1400), min)
  assert.equal(internals.clampShellWidth(0, 1400), min)
  // Beyond the frame is cut back, so the panel can never push its own close
  // button off screen.
  assert.equal(internals.clampShellWidth(5000, 1400), 1400)
  // A value inside the range is honoured exactly.
  assert.equal(internals.clampShellWidth(900, 1400), 900)
  // Junk falls back to the floor rather than producing NaN in a style string.
  assert.equal(internals.clampShellWidth(NaN, 1400), min)
  assert.equal(internals.clampShellWidth('abc', 1400), min)
  // With no measurable viewport the value still survives, so a width is not
  // lost while the window is being resized.
  assert.equal(internals.clampShellWidth(900, 0), 900)
})

test('the drawer width is remembered separately from the sidebar width', () => {
  const { internals } = loadClient()
  const previous = globalThis.localStorage
  const store = new Map()
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
  try {
    // Two independent keys: dragging the edge must not move the sidebar handle
    // and vice versa.
    assert.notEqual(internals.SHELL_WIDTH_KEY, internals.TREE_WIDTH_KEY)

    assert.equal(internals.readShellWidth(), 0, 'an untouched drawer uses the stylesheet default')
    internals.writeShellWidth(860)
    assert.equal(internals.readShellWidth(), 860)
    assert.equal(store.get(internals.SHELL_WIDTH_KEY), '860')
    // The sidebar key is untouched by a drawer resize.
    assert.equal(store.has(internals.TREE_WIDTH_KEY), false)

    // Writing 0 forgets the preference, which is what double-click means.
    internals.writeShellWidth(0)
    assert.equal(internals.readShellWidth(), 0)
    assert.equal(store.has(internals.SHELL_WIDTH_KEY), false)

    // A stored value below the floor is ignored rather than applied.
    store.set(internals.SHELL_WIDTH_KEY, '100')
    assert.equal(internals.readShellWidth(), 0)
  } finally {
    if (previous === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previous
  }
})

test('the drawer renders a leading-edge handle and applies the dragged width', () => {
  const source = read('lib/client.js')

  // The handle exists, is positioned over the leading border, and is a real
  // separator for assistive technology.
  assert.match(source, /className: "fv-edge"/)
  assert.match(source, /role: "separator"/)
  assert.match(source, /"aria-label": "调整文件查看器宽度"/)
  assert.match(source, /tabIndex: 0/)
  assert.match(source, /\.fv-edge\{position:absolute;top:0;bottom:0;left:-4px/)

  // The dragged width overrides the stylesheet default on the shell itself.
  assert.match(source, /style: shellWidth > 0 && !fullscreen \? \{ width: shellWidth \+ "px" \} : undefined/)

  // Dragging left widens, because the panel is pinned to the trailing edge.
  assert.match(source, /const delta = drag\.startX - event\.clientX/)

  // The width transition is dropped mid-gesture, or the panel lags the pointer.
  assert.match(source, /\.fv-shell\[data-edge-resizing="true"\]\{transition:none\}/)
  assert.match(source, /"data-edge-resizing": edgeResizing \? "true" : "false"/)

  // It is meaningless where the panel already spans the frame.
  assert.match(source, /isMobile \|\| fullscreen\s*\n\s*\? null/)
  assert.match(source, /\.fv-shell\[data-fullscreen="true"\] \.fv-edge\{display:none!important\}/)
  assert.match(source, /\.fv-shell\[data-mobile="true"\] \.fv-edge\{display:none!important\}/)

  // A pointer-only handle would be inaccessible; arrows and Home/End work too.
  assert.match(source, /const onEdgeKeyDown = \(event\) => \{/)
  assert.match(source, /event\.key === "ArrowLeft"/)
  assert.match(source, /event\.shiftKey \? 64 : 16/)
  // Double-click restores the default.
  assert.match(source, /const onEdgeDoubleClick = \(\) => \{/)
  assert.match(source, /writeShellWidth\(0\)/)
})

/* -------------------------------------------------------------------------- *
 * The back control in the main pane
 *
 * It used to call `setPane("tree")` unconditionally, which on desktop did
 * nothing at all: the sidebar and the preview sit side by side, and only the
 * narrow-screen rules hide one pane based on `data-pane`. From a commit's
 * changed-file list the reader also expects to return to that list, not to the
 * file tree. Both are pinned here.
 * -------------------------------------------------------------------------- */

test('the back control records where a file preview came from', () => {
  const source = read('lib/client.js')

  // The origin is recorded when a commit's file row is opened, on the tab that
  // row becomes: a tab knows what it came from, not the drawer.
  assert.match(source, /origin: \{ kind: "commit", sha: sha \}/)
  // ...and the button names the step it will undo.
  assert.match(source, /const originKind = previewOrigin === null \|\| previewOrigin === undefined \? null : previewOrigin\.kind/)
  assert.match(source, /const backTarget = originKind === "commit"/)
  assert.match(source, /返回变更文件列表/)
  assert.match(source, /返回工作区改动列表/)
  // A button that silently does nothing reads as broken, so it is disabled
  // when there is nowhere to go.
  assert.match(source, /disabled: !canGoBack/)
  // And it no longer jumps straight to the tree.
  assert.match(source, /const goBack = \(\) => \{/)
  assert.match(source, /if \(origin !== null && origin !== undefined && origin\.kind === "commit"\) \{/)
  assert.match(source, /if \(origin !== null && origin !== undefined && origin\.kind === "changes"\) \{/)
})

test('a disabled control is visibly unavailable', () => {
  const source = read('lib/client.js')
  // A disabled back button that still looks clickable reads as broken, which
  // is the very thing the disabled state exists to avoid.
  assert.match(source, /\.fv-icon-button:disabled\{opacity:\.35;cursor:default\}/)
  assert.match(source, /\.fv-icon-button:disabled:hover\{background:none;color:var\(--dsw-alias-label-secondary\)\}/)
})

test('returning from a commit file restores the changed-file list', () => {
  const source = read('lib/client.js')
  // The commit branch re-opens the commit's file list instead of leaving the
  // pane; the hash is already loaded, so nothing is re-fetched for the list.
  const commitBranch = /if \(origin !== null && origin !== undefined && origin\.kind === "commit"\) \{([\s\S]*?)\n\s*return;/.exec(source)
  assert(commitBranch, 'the commit branch must exist')
  const body = commitBranch[1]
  assert.match(body, /commitView: "files"/)
  assert.match(body, /setPane\("content"\)/)
  assert.match(body, /openCommit\(\{ sha: origin\.sha \}\)/)
  // The stale blob hash is cleared so the next preview cannot inherit it.
  assert.match(body, /commit: ""/)
})

test('leaving the preview entirely clears the selection', () => {
  const source = read('lib/client.js')
  // The final fallback must not merely switch panes: on desktop that had no
  // visible effect, which is exactly the reported bug. With tabs it closes the
  // tab, which leaves the pane showing "nothing is open" — the same place.
  const tail = source.slice(source.indexOf('const goBack = () => {'))
  const fallback = tail.slice(0, tail.indexOf('\n        };'))
  assert.match(fallback, /closeTab\(activeTabId\)/)
  assert.match(fallback, /setError\(null\)/)
  assert.match(fallback, /setPane\("tree"\)/)
})

test('a working-tree change is diffed for the row that was clicked', () => {
  const source = read('lib/client.js')
  // The row used to be discarded (`void row`), so the pane diffed whichever
  // file had been selected before.
  assert.doesNotMatch(source, /void row;/)
  assert.match(source, /changePath: row\.path/)
  // The tab's id is the path too, so clicking the same change twice focuses
  // its tab instead of opening a second pane on the same file.
  assert.match(source, /id: "change:" \+ row\.path/)
  // The pane receives that path, not `meta.path` from an unrelated selection.
  assert.match(source, /path: previewChangePath/)
})

test('a renamed file is read from its old path but highlighted as clicked', () => {
  const source = read('lib/client.js')
  // Reading the new path would 404 in the parent commit; highlighting the old
  // path would leave the clicked row unselected.
  assert.match(source, /rowPath: file\.path/)
  assert.match(source, /selectedPath: meta === null \? "" : \(meta\.rowPath \|\| meta\.path\)/)
})

/* -------------------------------------------------------------------------- *
 * The drawer is reused between visits
 *
 * `open` only gates rendering — the overlay component itself stays mounted — so
 * every view state survives from one visit to the next. Browsing Git and then
 * opening a file from a conversation link used to inherit the old commit hash
 * and the Git sidebar, and the file rendered as a "history preview" instead of
 * its content. Opening is a fresh session and must clear all of it.
 * -------------------------------------------------------------------------- */

test('closing and reopening the drawer keeps the previous visit intact', () => {
  const source = read('lib/client.js')

  // Closing the drawer only hides it: the overlay stays mounted, so reopening
  // must land on the same tabs, the same sidebar pane and the same expansion
  // set. Wiping them on every open is what this test now guards against.
  const start = source.indexOf('if (request_ === null) return undefined;')
  assert(start > 0, 'the roots effect must exist')
  const body = source.slice(start, start + 3000)

  // Nothing is cleared before the root is known; the decision needs the answer.
  const rootsCall = body.indexOf('request("roots"')
  const clearTabs = body.indexOf('setTabs(null)')
  assert(rootsCall > 0, 'the roots request must be there')
  assert(clearTabs > rootsCall, 'tabs may only be dropped once the resolved root is known')

  // The reset is conditional on the visit changing, keyed by the resolved root.
  assert.match(body, /const sameContext = resolvedRoot !== "" && resolvedRoot === visitContextRef\.current/)
  assert.match(body, /if \(!sameContext\) \{/)
  assert.match(body, /visitContextRef\.current = resolvedRoot/)
  // Everything the tab model replaced (showCommit/previewCommit/...) is gone,
  // so there is no per-view flag left to leak between visits either.
  for (const gone of ['setShowCommit', 'setPreviewCommit', 'setPreviewOrigin', 'setMeta(null)']) {
    assert.equal(body.includes(gone), false, `${gone} must not exist any more`)
  }
  // The sidebar pane is deliberately NOT reset on reopen: the reader left the
  // Git panel open and expects to find it there.
  assert.equal(body.includes('setSide("files")'), false, 'reopening must keep the sidebar pane')
})

test('the Git panel is not wiped when the drawer merely reopens', () => {
  const source = read('lib/client.js')
  const start = source.indexOf('const gitRootRef = react.useRef(null);')
  assert(start > 0, 'the git root ref must exist')
  const body = source.slice(start, start + 700)
  // A commit tab reopened from the previous visit needs its detail, and the
  // branch the reader was browsing is part of "the same visit".
  assert.match(body, /if \(gitRootRef\.current === root\) return;/)
  assert.match(body, /git\.reset\(root\)/)
  // Null (never initialised) is distinct from the empty root of the first
  // render, so the very first resolution still initialises the controller.
  assert.match(source, /const gitRootRef = react\.useRef\(null\)/)
})

test('the tree is only rebuilt when its context actually changed', () => {
  const source = read('lib/client.js')
  assert.match(source, /const treeBuiltForRef = react\.useRef\(\{ root: "", hidden: null, reveal: "" \}\)/)
  const start = source.indexOf('const built = treeBuiltForRef.current;')
  assert(start > 0, 'the tree build guard must exist')
  // Read to the end of the effect rather than a fixed window, so the assertions
  // below cannot silently race a comment being added inside the same effect.
  const body = source.slice(start, source.indexOf('}, [open, root, hidden, reveal]);', start))
  // Reopening with the same root/filter/reveal is not a rebuild: the reader's
  // expansion set survives, which is what "comes back the way I left it" means.
  assert.match(body, /if \(!rootChanged && !filterChanged && !revealChanged\) return;/)
  // A reopen still re-reads the listings the tree is showing, so the contents
  // are current even though the shape is remembered.
  assert.match(body, /for \(const dirPath of listings\) loadDirectory\(dirPath\)/)
})

test('a different root starts over, because paths only mean one thing there', () => {
  const source = read('lib/client.js')

  // The tree keeps its shape across a reopen but not across a root switch.
  assert.match(source, /const rootChanged = built\.root !== root/)
  assert.match(source, /if \(!rootChanged && !filterChanged && !revealChanged\) return/)
  // A root switch drops the tabs, the expansion set and returns to the tree.
  const block = /if \(rootChanged\) \{([\s\S]*?)\n\s*\}/.exec(source)
  assert(block, 'the rootChanged branch must exist')
  for (const effect of ['setTabs(null)', 'setExpanded(new Set())', 'setPane("tree")']) {
    assert(block[1].includes(effect), `a root switch must ${effect}`)
  }
  // And the listing is rebuilt for the new root instead of being reused.
  assert.match(source, /for \(const dirPath of listings\) loadDirectory\(dirPath\)/)
})

test('a plain file is never read as a history blob', () => {
  const source = read('lib/client.js')

  // A preview only becomes a blob lookup when an actual commit hash is carried.
  assert.match(source, /const fromCommit = typeof commit === "string" && commit !== ""/)
  // And that hash only comes from opening a row inside a commit's file list.
  // Tabs opened from the tree always carry the empty string.
  const openers = source.match(/commit: (readSha|""|previewCommit)/g) || []
  assert(openers.length >= 2, 'both openers must declare their commit source')
  for (const opener of openers) {
    assert(
      /commit: (readSha|""|previewCommit)/.test(opener),
      `unexpected preview commit source: ${opener}`,
    )
  }
  // The tree opener is empty by construction.
  assert.match(source, /kind: "file",[\s\S]{0,400}?commit: "",/)
})

/* -------------------------------------------------------------------------- *
 * A file opened from a commit offers both its diff and its contents
 *
 * Clicking a row in a commit's changed-file list means "show me what changed
 * here". The pane therefore lands on the diff and keeps the full text one press
 * away — and for a rename the patch must stay a rename rather than degrading
 * into an unrelated delete plus add.
 * -------------------------------------------------------------------------- */

test('a commit file records the commit to diff against and its old path', () => {
  const source = read('lib/client.js')
  // The blob may come from the parent (a deletion), so the commit being viewed
  // is recorded separately from the commit being read.
  assert.match(source, /diffSha: sha,/)
  // A rename's old path is handed to the host so `-M` can still pair the two.
  assert.match(source, /oldPath: typeof file\.oldPath === "string" && file\.oldPath !== "" \? file\.oldPath : null,/)
})

test('a historical file is diffed against its own commit', () => {
  const source = read('lib/client.js')
  assert.match(source, /request\("gitCommitDiff", \{\s*\n\s*root,\s*\n\s*repo,\s*\n\s*sha: diffSha,/)
  // The clicked row addresses the path, so a rename's old path is not used here.
  assert.match(source, /path: meta\.rowPath \|\| meta\.path,/)
  // The per-file section is what this pane shows.
  assert.match(source, /const first = val !== null && Array\.isArray\(val\.files\) \? val\.files\[0\] : null;/)
})

test('the diff tab appears for a file loaded as rows', () => {
  const source = read('lib/client.js')
  // A commit's per-file section arrives pre-parsed as rows, not as hunks; a
  // check that only looked at `diffs` would hide the tab entirely.
  assert.match(source, /\(Array\.isArray\(diffData\.rows\) && diffData\.rows\.length > 0\)/)
  assert.match(source, /\(Array\.isArray\(diffData\.diffs\) && diffData\.diffs\.length > 0\)/)
})

test('opening from a commit lands on the diff, and the choice then sticks', () => {
  const source = read('lib/client.js')
  // A ref records that the reader chose a view, so the automatic landing does
  // not fight them afterwards.
  assert.match(source, /const viewChosen = react\.useRef\(false\);/)
  assert.match(source, /if \(!viewChosen\.current && loaded !== null && loaded\.hasDiff\) \{/)
  assert.match(source, /viewChosen\.current = true;\s*\n\s*setDiffMode\(true\);/)
  // Every tab press counts as a choice.
  const presses = source.match(/onClick: \(\) => \{ viewChosen\.current = true;/g) || []
  assert(presses.length >= 3, 'each tab press must record the choice')
})

test('the diff leads only for a file opened from a commit', () => {
  const source = read('lib/client.js')
  // A working-tree file keeps the content tab first: there the reader opened
  // the file itself, not a change to it.
  assert.match(source, /\.\.\.\(fromCommit && diffTab !== null\s*\n\s*\? \[diffTab, contentTab, sourceTab\]\s*\n\s*: \[contentTab, sourceTab, diffTab\]\)/)
  // The label is explicit when the two views are siblings.
  assert.match(source, /fromCommit \? "完整内容" : "内容"/)
})

/* -------------------------------------------------------------------------- *
 * The content area is a set of tabs
 *
 * One preview used to be the whole pane, so opening a second file silently
 * replaced the first. The pane is now a tab list: every open file, commit and
 * working-tree change keeps its own description, and a right-click on any tab
 * offers 刷新当前 / 关闭当前 / 关闭其它 / 关闭所有.
 * -------------------------------------------------------------------------- */

test('the content area holds tabs instead of a single preview', () => {
  const source = read('lib/client.js')

  // The list, its active id and its menu are the only content-area state; the
  // per-view flags the single preview needed are derived from the active tab.
  assert.match(source, /const \[tabs, setTabs\] = react\.useState\(null\)/)
  assert.match(source, /const \[activeTabId, setActiveTabId\] = react\.useState\(""\)/)
  assert.match(source, /const activeTab = \(\(\) => \{/)
  // The derived values keep every existing handler reading the same names.
  assert.match(source, /const meta = activeTab === null \? null :/)
  assert.match(source, /const previewCommit = activeTab === null \? "" :/)
  assert.match(source, /const showCommit = activeTab !== null && \(activeTab\.kind === "commit" \|\| activeTab\.kind === "change"\)/)

  // A tab is identified by what it shows, so re-opening focuses rather than
  // duplicating, and the ids of the three kinds cannot collide.
  assert.match(source, /const id = "file:" \+ path/)
  assert.match(source, /const id = "file:" \+ blobPath \+ "\\u0000" \+ readSha/)
  assert.match(source, /id: "change:" \+ row\.path/)
  assert.match(source, /const id = "commit:" \+ sha/)
})

/* -------------------------------------------------------------------------- *
 * The Markdown outline
 *
 * Headings are read from the SOURCE, not from the rendered DOM: the renderer's
 * node shapes belong to the host and can change, while ATX syntax is fixed by
 * CommonMark. These cases pin the parsing rules that decide what a reader sees
 * in the outline.
 * -------------------------------------------------------------------------- */

test('headings are read from the markdown source with their levels', () => {
  const { parseHeadings } = loadClient().internals
  const md = [
    '# Title',
    '',
    'Intro paragraph.',
    '',
    '## Section A',
    '### Nested under A',
    '## Section B',
  ].join('\n')
  const rows = parseHeadings(md)
  assert.deepEqual(rows.map((r) => [r.level, r.text]), [
    [1, 'Title'],
    [2, 'Section A'],
    [3, 'Nested under A'],
    [2, 'Section B'],
  ])
  // The source line is carried so a jump can be mapped back to the document.
  assert.deepEqual(rows.map((r) => r.line), [0, 4, 5, 6])
  // Keys are unique even when two sections share a label.
  const dup = parseHeadings('# A\n# A')
  assert.equal(new Set(dup.map((r) => r.key)).size, 2)
})

test('a heading needs a space, and fenced code is not a section', () => {
  const { parseHeadings } = loadClient().internals

  // `#nospace` is not a heading (CommonMark), nor is `#######` (7 hashes).
  assert.deepEqual(parseHeadings('#nospace').map((r) => r.text), [])
  assert.deepEqual(parseHeadings('####### too deep').map((r) => r.text), [])

  // A shell comment inside a fenced block must not appear in the outline.
  const fenced = [
    '# Real',
    '```bash',
    '# not a heading',
    'echo hi',
    '```',
    '## Also real',
  ].join('\n')
  assert.deepEqual(parseHeadings(fenced).map((r) => r.text), ['Real', 'Also real'])

  // An unterminated fence swallows the rest, which is what the renderer does.
  assert.deepEqual(parseHeadings('# A\n```\n# B').map((r) => r.text), ['A'])
  // Tilde fences work the same way.
  assert.deepEqual(parseHeadings('~~~\n# x\n~~~\n# y').map((r) => r.text), ['y'])
})

test('heading labels drop markup that adds nothing to navigation', () => {
  const { parseHeadings } = loadClient().internals
  const md = [
    '## **Bold** title',
    '## `code` and [link](https://example.com)',
    '## Closing hashes ##',
    '## _emphasised_',
  ].join('\n')
  assert.deepEqual(parseHeadings(md).map((r) => r.text), [
    'Bold title',
    'code and link',
    'Closing hashes',
    'emphasised',
  ])
  // A heading with no text left is skipped rather than rendered as an empty row.
  assert.deepEqual(parseHeadings('##  ').map((r) => r.text), [])
})

test('no hook is declared after an early return in TextView', () => {
  const source = read('lib/client.js')

  // React matches hooks by call order, so a hook that only runs once a document
  // has loaded changes the order between the loading render and the loaded one.
  // That shipped once as "Minified React error #310" the moment a Markdown file
  // was opened — the outline hooks had been placed below TextView's early
  // returns. This walks the function and fails if it happens again.
  const start = source.indexOf('function TextView(')
  assert(start > 0, 'TextView must exist')
  const end = source.indexOf('\n      /** Render JSON as a tree', start)
  assert(end > start, 'TextView body must be delimited')
  const lines = source.slice(start, end).split('\n')

  const earlyReturn = /^\s*if \(state\.status === "error"\)|^\s*if \(data === null\) return|^\s*if \(state\.status === "loading"\) return/
  const hookCall = /react\.(useState|useEffect|useMemo|useCallback|useRef|useContext|useReducer)\(/
  let afterReturn = false
  const violations = []
  lines.forEach((line, index) => {
    if (earlyReturn.test(line)) afterReturn = true
    if (afterReturn && hookCall.test(line)) violations.push(`${index + 1}: ${line.trim()}`)
  })
  assert.deepEqual(violations, [], `hooks must all be declared before any early return, found: ${violations.join(' | ')}`)

  // The outline's own hooks are part of that invariant, and they read the
  // pre-return snapshot rather than the post-return binding.
  assert.match(source, /const loaded = state\.data;/)
  assert.match(source, /const outlineText = outlineVisible \? loaded\.text : "";/)
})

test('the outline is only offered for a rendered markdown preview', () => {
  const source = read('lib/client.js')

  // Source mode and the JSON tree have no headings, and an oversized document
  // never reaches the preview, so the rail must not appear in those states.
  // The gate reads the loaded snapshot directly, because the hooks that use it
  // run above TextView's early returns (see the hooks-order test below).
  assert.match(source, /const outlineVisible = loaded !== null && loaded !== undefined/)
  assert.match(source, /&& loaded\.kind === "markdown" && typeof loaded\.text === "string"/)
  assert.match(source, /const headings = react\.useMemo\(/)
  // The rail is rendered beside the content, inside the positioning wrapper.
  assert.match(source, /outlineVisible\s*\n\s*\? react\.createElement\(MarkdownOutline, \{/)
  // It drives the drawer's own scroller instead of the window.
  assert.match(source, /host\.scrollTo\(\{ top: host\.scrollTop \+ offset - 8/)
  // And the current section is measured on scroll, not guessed.
  assert.match(source, /if \(elements\[index\]\.getBoundingClientRect\(\)\.top - top <= 24\) current = row\.key;/)
  // The outline must have higher stacking precedence than code-block sticky headers (z-index: 6),
  // and content scrolling area must isolate its stacking context.
  assert.match(source, /\.fv-content\{[^}]*isolation:isolate/)
  assert.match(source, /\.fv-outline\{[^}]*z-index:10/)
})

test('the tab strip renders and marks the active tab', () => {
  const source = read('lib/client.js')

  assert.match(source, /function TabStrip\(\{ tabs, activeId, onActivate, onClose, onContextMenu, menuFor \}\)/)
  assert.match(source, /className: "fv-tab-cell"/)
  assert.match(source, /"aria-selected": selected \? "true" : "false"/)
  assert.match(source, /role: "tablist"/)
  // The strip is rendered inside the content area, above the head.
  assert.match(source, /react\.createElement\(TabStrip, \{/)
  assert.match(source, /className: "fv-tabs"/)
  // An empty content area says so rather than rendering nothing at all.
  assert.match(source, /className: "fv-tabs-empty"/)
  assert.match(source, /未打开文件/)
})

test('a tab offers refresh, close, close others and close all', () => {
  const source = read('lib/client.js')

  // The four items, asserted by their labels: they are what the request named.
  assert.match(source, /label: "刷新当前"/)
  assert.match(source, /label: "关闭当前"/)
  assert.match(source, /label: "关闭其它"/)
  assert.match(source, /label: "关闭所有"/)

  // Right-click on a tab opens its own menu, not the file tree's.
  assert.match(source, /onContextMenu: \(event\) => \{\s*\n\s*event\.preventDefault\(\);\s*\n\s*event\.stopPropagation\(\);\s*\n\s*onContextMenu\(\{ tabId: tab\.id, x: event\.clientX, y: event\.clientY \}\);/)
  assert.match(source, /function TabContextMenu\(\{ menu, tabs, onClose, onAction \}\)/)
  assert.match(source, /react\.createElement\(TabContextMenu, \{/)

  // Every item maps to one list operation.
  assert.match(source, /if \(action === "refresh"\) refreshTab\(id\);/)
  assert.match(source, /else if \(action === "close"\) closeTab\(id\);/)
  assert.match(source, /else if \(action === "others"\) closeTabs\(current\.filter\(\(tab\) => tab\.id !== id\)\.map\(\(tab\) => tab\.id\)\);/)
  assert.match(source, /else if \(action === "all"\) closeTabs\(current\.map\(\(tab\) => tab\.id\)\);/)
})

test('closing tabs lands on a neighbour and never resurrects the closed one', () => {
  const { tabsAfterClose } = loadClient().internals
  const list = ['a', 'b', 'c', 'd'].map((id) => ({ id }))
  const ids = (rows) => rows.map((row) => row.id)

  // Closing the tab that was on screen lands on its RIGHT neighbour, measured
  // in the list as it was — closing a middle tab must not jump to the end.
  assert.deepEqual(ids(tabsAfterClose(list, 'b', ['b']).tabs), ['a', 'c', 'd'])
  assert.equal(tabsAfterClose(list, 'b', ['b']).activeId, 'c')
  // The rightmost tab has no right neighbour, so it falls back to the left.
  assert.equal(tabsAfterClose(list, 'd', ['d']).activeId, 'c')
  // The leftmost tab falls forward to its right neighbour.
  assert.equal(tabsAfterClose(list, 'a', ['a']).activeId, 'b')
  // Closing a tab other than the one on screen keeps the reader where they were.
  const kept = tabsAfterClose(list, 'c', ['b'])
  assert.deepEqual(ids(kept.tabs), ['a', 'c', 'd'])
  assert.equal(kept.activeId, 'c')

  // "Close others" and "close all" are the same operation with a different set.
  const others = tabsAfterClose(list, 'c', ['a', 'b', 'd'])
  assert.deepEqual(ids(others.tabs), ['c'])
  assert.equal(others.activeId, 'c')
  const all = tabsAfterClose(list, 'a', ['a', 'b', 'c', 'd'])
  assert.deepEqual(ids(all.tabs), [])
  // An empty active id is exactly what the pane reads as "no tab open", which
  // is what hands the content area back to the sidebar.
  assert.equal(all.activeId, '')
  // Nothing to close, and unknown ids, must be no-ops rather than resurrecting
  // or clearing the list.
  assert.equal(tabsAfterClose(list, 'a', []), null)
  assert.equal(tabsAfterClose(list, 'a', ['zzz']), null)
  // Closing into an already empty list is a no-op too, not a phantom result.
  assert.equal(tabsAfterClose([], '', ['a']), null)
})

test('opening an already open file focuses its tab instead of duplicating it', () => {
  const { tabsAfterUpsert } = loadClient().internals
  const first = tabsAfterUpsert([], '', { id: 'file:a.ts', title: 'a.ts', path: 'a.ts' })
  assert.equal(first.tabs.length, 1)
  assert.equal(first.activeId, 'file:a.ts')
  const second = tabsAfterUpsert(first.tabs, 'file:a.ts', { id: 'file:b.ts', title: 'b.ts', path: 'b.ts' })
  assert.deepEqual(second.tabs.map((tab) => tab.id), ['file:a.ts', 'file:b.ts'])
  assert.equal(second.activeId, 'file:b.ts', 'a new tab comes forward')

  // Re-opening the first one keeps two tabs, updates in place and focuses it.
  const again = tabsAfterUpsert(second.tabs, 'file:b.ts', { id: 'file:a.ts', title: 'a.ts (re)', path: 'a.ts' })
  assert.equal(again.tabs.length, 2, 'an already open file must not open a second tab')
  assert.deepEqual(again.tabs.map((tab) => tab.id), ['file:a.ts', 'file:b.ts'], 'the tab keeps its seat')
  assert.equal(again.tabs[0].title, 'a.ts (re)', 'the description is refreshed in place')
  assert.equal(again.activeId, 'file:a.ts')
  // A draft never opened through a commit carries no origin, which the back
  // control reads as "nowhere to go back to".
  assert.equal(first.tabs[0].origin, null)
})

test('returning to a tab whose git detail was replaced re-reads it', () => {
  const source = read('lib/client.js')
  // The Git controller holds one commit's detail at a time; coming back to a
  // commit tab must re-read rather than render another commit under its title.
  assert.match(source, /if \(tab\.kind === "commit"\) \{\s*\n\s*const sha = id\.slice\("commit:"\.length\);/)
  assert.match(source, /if \(!loaded\) git\.openCommit\(sha\);/)
  // The tab's own hash is what its header and diff read, not the controller's.
  assert.match(source, /const activeCommitSha = activeTab !== null && activeTab\.kind === "commit"/)
  assert.match(source, /const commitSha = activeCommitSha !== ""/)
  // An unknown id is ignored instead of being created on the spot.
  assert.match(source, /const activateTab = \(id\) => \{\s*\n\s*const current = tabList\(\);/)
  assert.match(source, /if \(tab === undefined\) return;/)
})

test('the top toolbar refresh also re-reads the tab on screen', () => {
  const source = read('lib/client.js')
  const start = source.indexOf('const refresh = () => {')
  const body = source.slice(start, start + 1200)
  // Refreshing the tree around a stale preview leaves the file the reader is
  // actually looking at unchanged, which reads as "refresh does nothing".
  assert.match(body, /if \(activeTabId !== ""\) refreshTab\(activeTabId\);/)
  // The commit to restore belongs to the tab on screen, not to whichever
  // detail the Git controller holds.
  assert.match(body, /const keepSha = activeTab !== null && activeTab\.kind === "commit"/)
})

test('refreshing a tab re-reads what that tab shows', () => {
  const source = read('lib/client.js')

  assert.match(source, /const refreshTab = \(id\) => \{/)
  // A commit tab re-runs the commit read; a file tab re-reads its metadata;
  // a historical blob has nothing to re-read but its bytes, so it remounts.
  assert.match(source, /if \(tab\.kind === "commit"\) \{\s*\n\s*git\.openCommit\(tab\.id\.slice\("commit:"\.length\)\);/)
  assert.match(source, /patchTab\(id, \(current\) => \(\{ \.\.\.current, status: "loading", epoch: \(current\.epoch \|\| 0\) \+ 1 \}\)\);/)
  assert.match(source, /request\("meta", \{ root, path: tab\.path \}\)/)
  // The epoch is part of the remount key, which is what makes the refresh
  // visible instead of returning the same cached subtree.
  assert.match(source, /resetKey: activeTab === null\s*\n\s*\? ""\s*\n\s*: activeTab\.id \+ "\\u0000" \+ \(activeTab\.epoch \|\| 0\),/)
})

test('switching tabs switches the file, the language pin and the origin', () => {
  const source = read('lib/client.js')

  // Everything the pane shows comes from the active tab, so two tabs cannot
  // bleed into one another the way one shared preview state did.
  assert.match(source, /const previewChangePath = activeTab === null \? "" : \(activeTab\.changePath \|\| ""\);/)
  assert.match(source, /const localeTagOfActive = activeTab === null \? "auto" : \(activeTab\.lang \|\| "auto"\);/)
  assert.match(source, /const previewOrigin = activeTab === null \? null : \(activeTab\.origin \|\| null\);/)
  assert.match(source, /const commitView = activeTab === null \? "files" : \(activeTab\.commitView \|\| "files"\);/)
  // The language picker writes to the tab it applies to.
  assert.match(source, /patchTab\(current\.id, \(tab\) => \(\{ \.\.\.tab, lang: next \}\)\);/)
  // Switching the commit pane's view is a tab update, not a drawer-wide flag.
  assert.match(source, /patchTab\(activeTab\.id, \(tab\) => \(\{ \.\.\.tab, commitView: next \}\)\);/)
})

test('the tab set is dropped when the drawer reopens or the root changes', () => {
  const source = read('lib/client.js')

  // Two resets, both for the same reason: a tab names a path that only means
  // one thing under the root it was opened in.
  const resets = source.match(/tabsRef\.current = null;/g) || []
  assert(resets.length >= 2, 'both the open path and the root path must drop the tabs')
  assert.match(source, /tabsRef\.current = null;\s*\n\s*setTabs\(null\);\s*\n\s*activeTabIdRef\.current = "";\s*\n\s*setActiveTabId\(""\);/)
})
