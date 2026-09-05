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
    ? { createElement: () => null, useRef: () => ({ current: null }), useState: (v) => [typeof v === 'function' ? v() : v, () => {}], useEffect: () => {} }
    : { ReadBlock: null, MarkdownText: null, JsonTree: null }))
}

test('the manifest is a loadable DSH plugin', () => {
  assert.equal(manifest.name, 'dsh-file-viewer')
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
  assert.match(patch, /name: dsh-file-viewer/)
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
  assert.deepEqual(host.inject, ['fs', 'connection', 'settings', 'workspaceRegistry', 'sessions'])
  assert.equal(host.name, 'file-viewer')
})

test('the host half registers one trusted-host RPC channel and no HTTP route', () => {
  const source = read('lib/index.js')
  assert.match(source, /connection\.rpc\.handle\(/)
  assert.match(source, /authority: 'trusted-host'/)
  // Opening a bare route would bypass the /api browser-trust fence.
  assert.doesNotMatch(source, /webServer/)
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
  for (const code of ['no-roots', 'unknown-root', 'outside-root', 'not-found', 'too-large', 'read-failed', 'unsupported']) {
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
  for (const view of ['BinaryView', 'SheetView', 'DocView', 'TextView']) {
    assert(source.includes(`createElement(${view}, { key,`), `${view} must be keyed per file`)
  }

  // Regression: a rendered preview requires the whole document; without it the
  // toggle silently disappeared instead of explaining the fallback.
  assert.match(source, /const canPreview = /)
  assert.match(source, /previewUnavailable/)
  assert.match(source, /仅显示源码/)

  // Regression: a slower in-flight meta response could overwrite a newer one.
  assert.match(source, /metaTicket\.current !== ticket/)
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

test('the conversation header carries a session-scoped entry', () => {
  const source = read('lib/client.js')

  // The contract reserves `header.actions` for context and lineage controls;
  // optional session tools go in `utilities` so they cannot reorder those.
  assert.match(source, /const HEADER_SLOT = "conversation\.session\.header\.utilities"/)
  assert.match(source, /ctx\.slots\.inject\(HEADER_SLOT/)

  // Session scope means the component receives sessionId, which is what lets
  // the host resolve that session's project directory.
  assert.match(source, /props === undefined \? undefined : props\.sessionId/)
  assert.match(source, /openStore\.set\(openStore\.get\(\) === null \? \{ sessionId \} : null\)/)

  // Open state is a payload, not a boolean, so the overlay knows which session
  // asked; a fresh object per open re-runs root resolution.
  assert.match(source, /const openStore = createStore\(null\)/)
  assert.doesNotMatch(source, /openStore\.set\(false\)/)
  assert.doesNotMatch(source, /openStore\.set\(true\)/)

  // The revealed directory's whole ancestor chain opens on arrival.
  assert.match(source, /const chain = reveal === "" \? \[\] : \[\.\.\.ancestorsOf\(reveal\), reveal\]/)
  assert.match(source, /for \(const dirPath of \["", \.\.\.chain\]\) loadDirectory\(dirPath\)/)
})

test('registering in a conversation slot is declared in the manifest', () => {
  // The slot must exist before registration runs, which is what `dsh.client.inject`
  // guarantees; without this the header entry silently never appears.
  assert(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'))
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-client-ui-conversation'], '^0.1.0-rc.6')
})

test('the phone entry is drawn outside the header the narrow layout hides', () => {
  const source = read('lib/client.js')

  // dsh-mobile-adapter replaces the whole session header with its own bar, so a
  // button registered in that header still mounts but renders inside a hidden
  // subtree. Reaching into that header from the adapter was tried and rejected:
  // it exposed controls the phone layout deliberately hides and broke the bar's
  // own layout. The viewer draws its own entry instead.
  assert.match(source, /function ViewerFloatingAction\(\)/)
  assert.match(source, /className: "fv-float-entry"/)

  // It renders from the overlay seat, which is outside that header.
  assert.match(source, /react\.createElement\(ViewerFloatingAction, null\)/)
  assert.match(source, /\}, ViewerSurfaces\)\)/)

  // The header component publishes the session id, since the phone entry cannot
  // receive that header's props.
  assert.match(source, /const sessionStore = createStore\(undefined\)/)
  assert.match(source, /sessionStore\.set\(sessionId\)/)

  // Only one of the two is ever on screen, decided by the same breakpoint the
  // adapter uses, and the phone entry yields once the drawer is open.
  assert.match(source, /\.fv-float-entry\{display:none\}/)
  assert.match(source, /@media\(max-width:768px\)\{[\s\S]*?\.fv-float-entry\{[^}]*position:fixed/)
  // Not gated on a known session: the host falls back to workspace roots, and
  // requiring one tied the button to a slot that is not always rendered.
  assert.match(source, /if \(isOpen\) return null/)
  assert.doesNotMatch(source, /if \(sessionId === undefined \|\| isOpen\)/)

  // It must clear the composer and the safe area, and stay under the drawer.
  // Clears the composer (100px) and the adapter's info strip (20px) below it,
  // measured on a 390x844 viewport, plus the safe area. That default is now the
  // fallback of the placement property a drag overrides.
  assert.match(source, /\.fv-float-entry\{[^}]*bottom:var\(--fv-entry-bottom,calc\(148px \+ var\(--dsh-sab,0px\)\)\)/)
  assert.match(source, /\.fv-float-entry\{[^}]*z-index:39/)
  assert.match(source, /\.fv-float-entry\{[^}]*width:48px;height:48px/)
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
  assert.match(source, /"aria-label": "关闭", onClick: \(\) => openStore\.set\(null\)/)
})

test('the entry reads clearly and precedes the session log download', () => {
  const source = read('lib/client.js')

  // The outline folder is faint at icon sizes; the filled variant is used with
  // outline kept only as a fallback.
  assert.match(source, /const FolderIcon = IconFolderOpen16 \?\? IconFolderOutline16 \?\? null/)
  assert.match(source, /react\.createElement\(FolderIcon, \{ size: 16 \}\)/)
  assert.match(source, /react\.createElement\(FolderIcon, \{ size: 20 \}\)/)

  // The utilities list sorts ascending and session-log-download registers with
  // no order, so it sits at 0; a negative order puts this button to its left.
  assert.match(source, /order: -10,\s*\}, ViewerHeaderAction\)\)/)

  // The phone entry follows the host's own round floating button: a floating
  // fill, a hairline border and shadow-lv2. The earlier rule named
  // --dsw-alias-bg-inverse and --dsw-alias-label-inverse, which the theme does
  // not define, so it always rendered its literal fallbacks and stayed dark
  // under a light theme.
  assert.match(source, /\.fv-float-entry\{[^}]*background:var\(--dsw-alias-button-floating-fill\)/)
  assert.match(source, /\.fv-float-entry\{[^}]*color:var\(--dsw-alias-label-primary\)/)
  assert.match(source, /\.fv-float-entry\{[^}]*box-shadow:var\(--dsw-shadow-lv2\)/)
  assert.match(source, /\.fv-float-entry\{[^}]*border:1px solid var\(--dsw-alias-border-l2\)/)
  // Matched as var() references, since the comment above the rule names both
  // tokens to explain why they are gone.
  assert.doesNotMatch(source, /var\(--dsw-alias-bg-inverse/)
  assert.doesNotMatch(source, /var\(--dsw-alias-label-inverse/)
  assert.doesNotMatch(source, /box-shadow:0 4px 14px/)
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

test('the phone entry survives a session with no messages', () => {
  const source = read('lib/client.js')

  // Regression: the header entry was the only reporter of the active session,
  // but the host renders no session header at all for an empty session — every
  // plugin registered there vanishes, the built-in session log included. On a
  // phone that left no entry, which looked like the button disappearing after a
  // refresh that landed on an existing empty session.
  assert.match(source, /const SESSION_SLOT = "conversation\.input\.overlay"/)
  assert.match(source, /function SessionReporter\(props\)/)
  assert.match(source, /sessionStore\.set\(sessionId\)/)
  assert.match(source, /\}, SessionReporter\)\)/)

  // It draws nothing; it exists only to publish the id.
  assert.match(source, /return null;\s*\}\s*\/\*\*\s*\*\s*Phone entry/)

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
  assert.match(source, /composerStore\.set\(\{ draft: typeof draft === "string" \? draft : "", setDraft \}\)/)
  assert.match(source, /\}, ComposerBridge\)\)/)

  // Rows became wrappers because a button cannot nest inside another button.
  assert.match(source, /className: "fv-row-seat"/)
  assert.match(source, /className: "fv-mention"/)

  // Without stopPropagation the row's own click also fires, expanding the
  // directory or switching the preview.
  assert.match(source, /event\.stopPropagation\(\);\s*onMention\(entry\)/)

  // Folders are referenceable too, so the button is not gated on entry type.
  assert.doesNotMatch(source, /onMention[\s\S]{0,120}isDirectory \? null/)

  // Closing after inserting leaves the draft visible and sendable.
  assert.match(source, /target\.setDraft\(appendMention\(target\.draft, shown\)\);\s*openStore\.set\(null\);/)

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

test('the entry can be dragged without the release opening the drawer', () => {
  const source = read('lib/client.js')

  // Capture keeps the move and release events coming once the finger leaves the
  // button, which happens almost at once when dragging.
  assert.match(source, /element\.setPointerCapture\(event\.pointerId\)/)
  assert.match(source, /releasePointerCapture\(event\.pointerId\)/)
  // A gesture the system interrupts must not leave the drag armed.
  assert.match(source, /onPointerCancel/)
  // Otherwise the page scroller claims the drag.
  assert.match(source, /\.fv-float-entry\{[^}]*touch-action:none/)
  // Secondary touches during a pinch must not hijack an active drag.
  assert.match(source, /event\.isPrimary === false \|\| event\.button > 0/)

  // A release that ended a drag still fires a click, which would open the
  // drawer the user was only repositioning.
  assert.match(source, /if \(dragged\.current\) return;/)
  // Cleared when the next press begins, not in the click handler: a touch drag
  // does not reliably emit a click, and a flag left armed swallowed the next
  // genuine tap instead of the release that set it.
  assert.match(source, /dragged\.current = false;\s*drag\.current = \{/)
  // Below the slop a press stays a tap.
  assert.match(source, /travelled < DRAG_SLOP/)

  // Placement travels through custom properties so the stylesheet keeps the
  // default corner and its safe-area maths.
  assert.match(source, /setProperty\("--fv-entry-left"/)
  assert.match(source, /setProperty\("--fv-entry-bottom"/)
  assert.match(source, /\.fv-float-entry\{[^}]*left:var\(--fv-entry-left,auto\)/)

  // Lifted while dragging, and the transition is dropped so it tracks exactly.
  assert.match(source, /\.fv-float-entry\[data-dragging="true"\]\{[^}]*transition:none/)
  // The reduce block has to cover transitions too, not just animations.
  assert.match(source, /prefers-reduced-motion:reduce\)\{[\s\S]*?\.fv-float-entry[^{]*\{transition:none/)
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
  assert.match(source, /const workspaces = ctx\.workspaces/)
  assert.match(source, /wiredOpenPath\.has\(workspaces\)/)
  assert.match(source, /workspaces\.openPath = async function\(path\)/)
  assert.match(source, /const isLoopback = ctx\.connection && ctx\.connection\.isLoopback === true/)
  assert.match(source, /openStore\.set\(\{\s*filePath: path/)
  assert.doesNotMatch(source, /ctx\.get\?\.\("workspaces"\)/)
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