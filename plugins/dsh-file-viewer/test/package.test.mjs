import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const manifest = require('../package.json')
const root = fileURLToPath(new URL('..', import.meta.url))
const read = (relative) => readFileSync(root + relative, 'utf8')

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
  assert.deepEqual(client.inject, ['slots', 'connection'])
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
  assert.doesNotMatch(source, /fv-entry/)
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
  // measured on a 390x844 viewport, plus the safe area.
  assert.match(source, /\.fv-float-entry\{[^}]*bottom:calc\(148px \+ var\(--dsh-sab,0px\)\)/)
  assert.match(source, /\.fv-float-entry\{[^}]*z-index:39/)
  assert.match(source, /\.fv-float-entry\{[^}]*width:46px;height:46px/)
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

  // The phone entry is a solid filled circle, not a faint outline.
  assert.match(source, /\.fv-float-entry\{[^}]*background:var\(--dsw-alias-bg-inverse/)
  assert.match(source, /\.fv-float-entry\{[^}]*box-shadow:0 4px 14px/)
  assert.match(source, /\.fv-float-entry\{[^}]*border:0/)
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

  // Offered only when a composer is actually present.
  assert.match(source, /onMention: composer === null \? undefined : mention/)

  // Closing after inserting leaves the draft visible and sendable.
  assert.match(source, /target\.setDraft\(appendMention\(target\.draft, shown\)\);\s*openStore\.set\(null\)/)

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
