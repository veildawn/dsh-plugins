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
  assert.equal(client.internals.ACTION_SLOT, 'sidebar.footer.action')
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
  assert.deepEqual(internals.crumbsOf('a/b/c'), [
    { name: 'a', path: 'a' },
    { name: 'b', path: 'a/b' },
    { name: 'c', path: 'a/b/c' },
  ])
  assert.deepEqual(internals.crumbsOf(''), [])

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
