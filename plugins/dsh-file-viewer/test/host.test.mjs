import assert from 'node:assert/strict'
import test from 'node:test'

import { MAX_BYTES, MAX_DOWNLOAD_BYTES, RPC_CHANNEL, ViewerError, collectRoots, handleRpc, handleDownloadRequest } from '../lib/index.js'

const ROOT = 'D:/repo'
const OTHER_ROOT = 'D:/other'

/**
 * A filesystem fake mirroring the parts of `ctx.fs` this plugin uses. Targets
 * carry a canonical key so `contains` can model realpath containment, which is
 * how symlink escapes are caught in production.
 */
function createFs(tree, { links = {} } = {}) {
  const canonical = (path) => {
    const normalized = String(path).replace(/\\/g, '/').replace(/\/+$/, '')
    // Resolve '..' and rewrite symlinked ancestors one segment at a time, the
    // way realpath does — an escape hidden behind a parent link only shows up
    // if containment sees the rewritten path.
    let resolved = ''
    for (const part of normalized.split('/')) {
      if (part === '.' || part === '') continue
      if (part === '..') {
        resolved = resolved.slice(0, Math.max(0, resolved.lastIndexOf('/')))
        continue
      }
      resolved = resolved === '' ? part : `${resolved}/${part}`
      if (Object.hasOwn(links, resolved)) resolved = links[resolved]
    }
    return resolved
  }
  const canonicalTree = {}
  for (const [k, v] of Object.entries(tree)) {
    canonicalTree[canonical(k)] = v
  }
  return {
    calls: [],
    async resolve(path) {
      const key = canonical(path)
      return { targetKey: key, displayPath: key }
    },
    processPath(target) {
      return target.displayPath
    },
    contains(parent, child) {
      return child.targetKey === parent.targetKey || child.targetKey.startsWith(parent.targetKey + '/')
    },
    async stat(target) {
      return canonicalTree[target.targetKey]
    },
    async listDir(target) {
      const node = canonicalTree[target.targetKey]
      if (node === undefined) throw new ViewerError('not-found', 'missing')
      return node.entries ?? []
    },
    async readText(target) {
      this.calls.push(['readText', target.targetKey])
      return canonicalTree[target.targetKey]?.text ?? ''
    },
    async readBytes(target, _signal, maxBytes) {
      this.calls.push(['readBytes', target.targetKey, maxBytes])
      // The real seam bounds the COMPLETE file and fails rather than
      // truncating; a mock that returned a short buffer regardless of size
      // hid the bug where an 8 KB probe of a larger unknown file threw.
      const bytes = canonicalTree[target.targetKey]?.bytes ?? new Uint8Array()
      if (bytes.length > maxBytes) {
        throw new ViewerError('too-large', `${bytes.length} bytes exceeds the ${maxBytes}-byte limit`)
      }
      return bytes
    },
    async readByteRange(target, range, _signal) {
      this.calls.push(['readByteRange', target.targetKey, range.offset, range.length])
      const bytes = canonicalTree[target.targetKey]?.bytes ?? new Uint8Array()
      return bytes.subarray(range.offset, range.offset + range.length)
    },
  }
}

function createCtx(fs, { workspaces = [ROOT], sessions = [] } = {}) {
  return {
    fs,
    logger: { warn() {} },
    workspaceRegistry: { list: () => workspaces.map((path) => ({ path, name: undefined })) },
    sessions: { list: () => sessions.map((cwd) => ({ header: { cwd } })) },
  }
}

const options = (overrides = {}) => () => ({ extraRoots: [], maxBytes: MAX_BYTES, ...overrides })

test('roots merge workspaces, session cwds and configured extras without duplicates', () => {
  const ctx = createCtx(createFs({}), { workspaces: [ROOT, ROOT + '/'], sessions: [OTHER_ROOT, ROOT] })
  const roots = collectRoots(ctx, options({ extraRoots: ['D:/extra', OTHER_ROOT] }))
  assert.deepEqual(roots.map((row) => row.path), [ROOT, OTHER_ROOT, 'D:/extra'])
  // The label defaults to the directory name so the picker stays readable.
  assert.deepEqual(roots.map((row) => row.label), ['repo', 'other', 'extra'])
})

test('a deployment with no workspaces refuses every request', async () => {
  const ctx = createCtx(createFs({}), { workspaces: [], sessions: [] })
  const result = await handleRpc(ctx, options(), 'list', {})
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'no-roots')
})

test('listing orders directories first and hides noise unless asked', async () => {
  const fs = createFs({
    [ROOT]: {
      type: 'directory',
      entries: [
        { name: 'README.md', type: 'file', size: 120 },
        { name: 'lib', type: 'directory' },
        { name: '.git', type: 'directory' },
        { name: 'node_modules', type: 'directory' },
        { name: 'app.js', type: 'file', size: 40 },
      ],
    },
  })
  const ctx = createCtx(fs)

  const listed = await handleRpc(ctx, options(), 'list', {})
  assert.equal(listed.ok, true)
  assert.deepEqual(listed.value.entries.map((row) => row.name), ['lib', 'app.js', 'README.md'])
  // File rows carry the viewer kind so the client never re-derives it.
  assert.deepEqual(
    listed.value.entries.filter((row) => row.type === 'file').map((row) => row.kind),
    ['text', 'markdown'],
  )
  assert.equal(listed.value.entries[1].size, 40)

  const withHidden = await handleRpc(ctx, options(), 'list', { hidden: true })
  assert.deepEqual(withHidden.value.entries.map((row) => row.name), ['.git', 'lib', 'node_modules', 'app.js', 'README.md'])
})

test('child paths are addressed relative to the root', async () => {
  const fs = createFs({
    [ROOT]: { type: 'directory', entries: [] },
    [`${ROOT}/lib`]: { type: 'directory', entries: [{ name: 'core.js', type: 'file', size: 10 }] },
  })
  const listed = await handleRpc(createCtx(fs), options(), 'list', { path: 'lib' })
  assert.equal(listed.ok, true)
  assert.deepEqual(listed.value.entries, [{ name: 'core.js', type: 'file', path: 'lib/core.js', kind: 'text', size: 10 }])
})

test('paths that escape the root are refused before and after canonicalization', async () => {
  const fs = createFs(
    {
      [ROOT]: { type: 'directory', entries: [] },
      'D:/secrets': { type: 'directory', entries: [{ name: 'id_rsa', type: 'file' }] },
      'D:/secrets/id_rsa': { type: 'file', size: 12, text: 'PRIVATE KEY' },
    },
    // 'escape' is a symlink out of the root: the shape check cannot see it,
    // only canonicalized containment can.
    { links: { 'D:/repo/escape': 'D:/secrets' } },
  )
  const ctx = createCtx(fs)

  for (const path of ['../secrets', 'lib/../../secrets', '/etc/passwd', 'C:/Windows', 'lib\\..\\..\\secrets']) {
    const result = await handleRpc(ctx, options(), 'list', { path })
    assert.equal(result.ok, false, `${path} must be refused`)
    assert.equal(result.error.code, 'outside-root')
  }

  const viaSymlink = await handleRpc(ctx, options(), 'list', { path: 'escape' })
  assert.equal(viaSymlink.ok, false)
  assert.equal(viaSymlink.error.code, 'outside-root')

  const readThroughSymlink = await handleRpc(ctx, options(), 'read', { path: 'escape/id_rsa' })
  assert.equal(readThroughSymlink.ok, false)
  assert.equal(readThroughSymlink.error.code, 'outside-root')
  // Nothing was read from disk.
  assert.deepEqual(fs.calls, [])
})

test('an unknown root is refused even when the path is harmless', async () => {
  const ctx = createCtx(createFs({ [ROOT]: { type: 'directory', entries: [] } }))
  const result = await handleRpc(ctx, options(), 'list', { root: 'D:/elsewhere', path: 'lib' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'unknown-root')
})

test('reading returns a numbered window with paging flags', async () => {
  const lines = Array.from({ length: 1200 }, (_, index) => `line ${index + 1}`)
  const fs = createFs({
    [ROOT]: { type: 'directory', entries: [] },
    [`${ROOT}/big.js`]: { type: 'file', size: 9000, text: lines.join('\n') },
  })
  const ctx = createCtx(fs)

  const first = await handleRpc(ctx, options(), 'read', { path: 'big.js' })
  assert.equal(first.ok, true)
  assert.equal(first.value.totalLines, 1200)
  assert.equal(first.value.offset, 1)
  assert.equal(first.value.end, 500)
  assert.equal(first.value.hasAfter, true)
  assert.equal(first.value.hasBefore, false)
  assert.equal(first.value.lang, 'javascript')
  assert.equal(first.value.eol, 'lf')
  assert.deepEqual(first.value.lines[0], { number: 1, text: 'line 1' })
  assert.equal(first.value.lines.length, 500)
  // A windowed read must not ship the whole document as well.
  assert.equal(first.value.text, undefined)

  const second = await handleRpc(ctx, options(), 'read', { path: 'big.js', offset: 501 })
  assert.deepEqual(second.value.lines[0], { number: 501, text: 'line 501' })
  assert.equal(second.value.hasBefore, true)
})

test('a file that fits in one window ships its full text for markdown and json', async () => {
  const fs = createFs({
    [ROOT]: { type: 'directory', entries: [] },
    [`${ROOT}/README.md`]: { type: 'file', size: 12, text: '# Title\n\nBody' },
  })
  const result = await handleRpc(createCtx(fs), options(), 'read', { path: 'README.md' })
  assert.equal(result.ok, true)
  assert.equal(result.value.kind, 'markdown')
  assert.equal(result.value.text, '# Title\n\nBody')
  assert.equal(result.value.hasAfter, false)
})

test('oversize text is refused instead of buffered', async () => {
  const fs = createFs({
    [ROOT]: { type: 'directory', entries: [] },
    [`${ROOT}/huge.log`]: { type: 'file', size: 9 * 1024 * 1024, text: 'x' },
  })
  const result = await handleRpc(createCtx(fs), options(), 'read', { path: 'huge.log' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'too-large')
  assert.deepEqual(fs.calls, [])
})

test('binary reads are base64 encoded and bounded by the configured limit', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const fs = createFs({
    [ROOT]: { type: 'directory', entries: [] },
    [`${ROOT}/shot.png`]: { type: 'file', size: bytes.length, bytes },
    [`${ROOT}/movie.mp4`]: { type: 'file', size: 999 * 1024 * 1024 },
  })
  const ctx = createCtx(fs)

  const image = await handleRpc(ctx, options(), 'bytes', { path: 'shot.png' })
  assert.equal(image.ok, true)
  assert.equal(image.value.kind, 'image')
  assert.equal(image.value.base64, Buffer.from(bytes).toString('base64'))
  assert.deepEqual(fs.calls.at(-1), ['readBytes', `${ROOT}/shot.png`, MAX_BYTES])

  const huge = await handleRpc(ctx, options(), 'bytes', { path: 'movie.mp4' })
  assert.equal(huge.ok, false)
  assert.equal(huge.error.code, 'too-large')

  const tighter = await handleRpc(ctx, options({ maxBytes: 4 }), 'bytes', { path: 'shot.png' })
  assert.equal(tighter.ok, false)
  assert.equal(tighter.error.code, 'too-large')
})

test('metadata picks the viewer and flags oversize before any content is fetched', async () => {
  const fs = createFs({
    [ROOT]: { type: 'directory', entries: [] },
    [`${ROOT}/report.xlsx`]: { type: 'file', size: 4096 },
    [`${ROOT}/huge.pdf`]: { type: 'file', size: 120 * 1024 * 1024 },
    [`${ROOT}/lib`]: { type: 'directory', entries: [] },
  })
  const ctx = createCtx(fs)

  const sheet = await handleRpc(ctx, options(), 'meta', { path: 'report.xlsx' })
  assert.equal(sheet.value.kind, 'sheet')
  assert.equal(sheet.value.tooLarge, false)
  assert.equal(sheet.value.name, 'report.xlsx')

  const pdf = await handleRpc(ctx, options(), 'meta', { path: 'huge.pdf' })
  assert.equal(pdf.value.kind, 'pdf')
  assert.equal(pdf.value.tooLarge, true)

  const directory = await handleRpc(ctx, options(), 'meta', { path: 'lib' })
  assert.equal(directory.ok, false)
  assert.equal(directory.error.code, 'is-a-directory')

  assert.deepEqual(fs.calls, [])
})

test('missing paths and wrong types report distinct codes', async () => {
  const fs = createFs({
    [ROOT]: { type: 'directory', entries: [] },
    [`${ROOT}/app.js`]: { type: 'file', size: 4, text: 'code' },
  })
  const ctx = createCtx(fs)

  const missing = await handleRpc(ctx, options(), 'read', { path: 'nope.js' })
  assert.equal(missing.error.code, 'not-found')

  const notDirectory = await handleRpc(ctx, options(), 'list', { path: 'app.js' })
  assert.equal(notDirectory.error.code, 'not-a-directory')
})

test('unknown methods and backend failures never leak a path', async () => {
  const fs = createFs({ [ROOT]: { type: 'directory', entries: [] }, [`${ROOT}/a.js`]: { type: 'file', size: 1 } })
  fs.readText = async () => {
    const error = new Error('EACCES: permission denied, open D:/repo/a.js')
    error.code = 'EACCES'
    throw error
  }
  const ctx = createCtx(fs)

  const unknown = await handleRpc(ctx, options(), 'destroyEverything', {})
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.code, 'unknown-method')

  const failed = await handleRpc(ctx, options(), 'read', { path: 'a.js' })
  assert.equal(failed.ok, false)
  assert.equal(failed.error.code, 'read-failed')
  assert.equal(failed.error.details.reason, 'EACCES')
  assert.doesNotMatch(failed.error.message, /repo|a\.js/)
})

test('the channel name is stable', () => {
  assert.equal(RPC_CHANNEL, '/dsh-file-viewer')
})

test('workbook cells collapse to display text for every ExcelJS value shape', async () => {
  const { cellText } = await import('../lib/index.js')
  assert.equal(cellText(null), '')
  assert.equal(cellText(undefined), '')
  assert.equal(cellText(42), '42')
  assert.equal(cellText('plain'), 'plain')
  assert.equal(cellText(true), 'true')
  assert.equal(cellText(new Date('2026-08-19T10:00:00Z')), '2026-08-19')
  // Formula cells show the cached result, not the formula.
  assert.equal(cellText({ formula: 'SUM(A1:A2)', result: 7 }), '7')
  assert.equal(cellText({ richText: [{ text: 'bold' }, { text: ' tail' }] }), 'bold tail')
  assert.equal(cellText({ text: 'link text', hyperlink: 'https://example.com' }), 'link text')
  assert.equal(cellText({ error: '#DIV/0!' }), '#DIV/0!')
  assert.equal(cellText({ unexpected: true }), '')
})

test('sheet and doc reads enforce the same containment as text reads', async () => {
  const fs = createFs(
    { [ROOT]: { type: 'directory', entries: [] }, 'D:/secrets/book.xlsx': { type: 'file', size: 10 } },
    { links: { 'D:/repo/out': 'D:/secrets' } },
  )
  const ctx = createCtx(fs)

  for (const method of ['sheet', 'doc']) {
    const escaped = await handleRpc(ctx, options(), method, { path: 'out/book.xlsx' })
    assert.equal(escaped.ok, false, `${method} must refuse a symlinked escape`)
    assert.equal(escaped.error.code, 'outside-root')

    const missing = await handleRpc(ctx, options(), method, { path: 'nope.xlsx' })
    assert.equal(missing.error.code, 'not-found')
  }
  assert.deepEqual(fs.calls, [])
})

test('markdown and json ship the whole document even when paged', async () => {
  // Regression: the preview only shipped `text` for files that fit in one
  // window, so any markdown over 500 lines silently lost its rendered preview.
  const long = Array.from({ length: 900 }, (_, index) => `paragraph ${index + 1}`).join('\n')
  const json = '{\n' + Array.from({ length: 700 }, (_, index) => `  "k${index}": ${index}`).join(',\n') + '\n}'
  const fs = createFs({
    [ROOT]: { type: 'directory', entries: [] },
    [`${ROOT}/long.md`]: { type: 'file', size: long.length, text: long },
    [`${ROOT}/big.json`]: { type: 'file', size: json.length, text: json },
    [`${ROOT}/big.js`]: { type: 'file', size: long.length, text: long },
  })
  const ctx = createCtx(fs)

  const markdown = await handleRpc(ctx, options(), 'read', { path: 'long.md' })
  assert.equal(markdown.value.hasAfter, true, 'the file must be paged')
  assert.equal(markdown.value.text, long, 'a paged markdown file still needs its whole text')
  assert.equal(markdown.value.lines.length, 500, 'the window still comes along for the source view')

  const structured = await handleRpc(ctx, options(), 'read', { path: 'big.json' })
  assert.equal(structured.value.hasAfter, true)
  assert.equal(structured.value.text, json)

  // Code files stay windowed: ReadBlock renders from `lines`, so shipping the
  // whole file would be wasted bytes.
  const code = await handleRpc(ctx, options(), 'read', { path: 'big.js' })
  assert.equal(code.value.hasAfter, true)
  assert.equal(code.value.text, undefined)
})

test('a document past the preview budget falls back to windowed source', async () => {
  const { MAX_PREVIEW_BYTES } = await import('../lib/index.js')
  const huge = 'x\n'.repeat(MAX_PREVIEW_BYTES)
  const fs = createFs({
    [ROOT]: { type: 'directory', entries: [] },
    [`${ROOT}/huge.md`]: { type: 'file', size: huge.length, text: huge },
  })
  const result = await handleRpc(createCtx(fs), options(), 'read', { path: 'huge.md' })
  assert.equal(result.ok, true)
  assert.equal(result.value.kind, 'markdown')
  // No partial preview: the client shows source and says why.
  assert.equal(result.value.text, undefined)
  assert(result.value.lines.length > 0)
})

test('metadata derives kind and language from the root itself when no path is given', async () => {
  // Regression: `lang` was read from the empty relative path, so a root-level
  // target reported no language.
  const fs = createFs({ 'D:/repo/notes.md': { type: 'file', size: 4, text: 'text' } })
  const ctx = createCtx(fs, { workspaces: ['D:/repo/notes.md'] })
  const result = await handleRpc(ctx, options(), 'meta', {})
  assert.equal(result.ok, true)
  assert.equal(result.value.name, 'notes.md')
  assert.equal(result.value.kind, 'markdown')
  assert.equal(result.value.lang, 'markdown')
})

test('a session resolves to the deepest root containing its working directory', async () => {
  const fs = createFs({})
  const ctx = createCtx(fs, { workspaces: ['D:/repo', 'D:/repo/packages/app', 'D:/other'] })
  ctx.sessions = {
    get: (id) => ({
      'in-root': { header: { cwd: 'D:/repo' } },
      'in-subdir': { header: { cwd: 'D:\\repo\\plugins\\viewer' } },
      // A nested workspace must win over its parent.
      'in-nested': { header: { cwd: 'D:/repo/packages/app/src' } },
      'outside': { header: { cwd: 'D:/elsewhere' } },
      'no-cwd': { header: {} },
      // Resumed sessions carry cwd under meta.
      'from-meta': { header: { meta: { cwd: 'D:/other' } } },
    })[id],
    list: () => [],
  }

  const root = await handleRpc(ctx, options(), 'roots', { sessionId: 'in-root' })
  assert.equal(root.value.root, 'D:/repo')
  assert.equal(root.value.reveal, '')

  const sub = await handleRpc(ctx, options(), 'roots', { sessionId: 'in-subdir' })
  assert.equal(sub.value.root, 'D:/repo')
  assert.equal(sub.value.reveal, 'plugins/viewer', 'a windows cwd must reveal with forward slashes')

  const nested = await handleRpc(ctx, options(), 'roots', { sessionId: 'in-nested' })
  assert.equal(nested.value.root, 'D:/repo/packages/app', 'the deepest containing root wins')
  assert.equal(nested.value.reveal, 'src')

  const meta = await handleRpc(ctx, options(), 'roots', { sessionId: 'from-meta' })
  assert.equal(meta.value.root, 'D:/other')

  // A cwd outside every root, a session without one, and no session at all all
  // fall back to the plain root list rather than guessing.
  for (const sessionId of ['outside', 'no-cwd', 'missing-session', undefined]) {
    const result = await handleRpc(ctx, options(), 'roots', sessionId === undefined ? {} : { sessionId })
    assert.equal(result.ok, true)
    assert.equal(result.value.root, undefined, `${sessionId} must not resolve a root`)
    assert.equal(result.value.roots.length, 3)
  }
})
test('target file path resolves root, reveal parent directory, and selects file', async () => {
  const fs = createFs({
    'D:/repo': { type: 'directory', entries: [] },
    'D:/repo/src': { type: 'directory', entries: [] },
    'D:/repo/src/index.ts': { type: 'file', size: 100 },
    'D:/other/readme.md': { type: 'file', size: 50 },
  })
  const ctx = createCtx(fs, { workspaces: ['D:/repo', 'D:/other'] })
  ctx.sessions = {
    get: (id) => ({
      'sess-1': { header: { cwd: 'D:/repo' } },
    })[id],
    list: () => [],
  }

  // Relative file path with sessionId
  const rel = await handleRpc(ctx, options(), 'roots', { sessionId: 'sess-1', filePath: 'src/index.ts' })
  assert.equal(rel.value.root, 'D:/repo')
  assert.equal(rel.value.reveal, 'src')
  assert.equal(rel.value.selectFile, 'src/index.ts')

  // Absolute file path across another root
  const abs = await handleRpc(ctx, options(), 'roots', { filePath: 'D:/other/readme.md' })
  assert.equal(abs.value.root, 'D:/other')
  assert.equal(abs.value.reveal, '')
  assert.equal(abs.value.selectFile, 'readme.md')
})

test('an unanchored relative target without a session resolves only when it exists', async () => {
  const fs = createFs({
    'D:/repo': { type: 'directory', entries: [] },
    'D:/repo/src/index.ts': { type: 'file', size: 100 },
  })
  const ctx = createCtx(fs, { workspaces: ['D:/repo'] })
  ctx.sessions = { get: () => undefined, list: () => [] }

  // A root-relative path that provably exists under the default root resolves:
  // this is how a session-less click on an existing file degrades usefully.
  const existing = await handleRpc(ctx, options(), 'roots', { filePath: 'src/index.ts' })
  assert.equal(existing.ok, true)
  assert.equal(existing.value.root, 'D:/repo')
  assert.equal(existing.value.reveal, 'src')
  assert.equal(existing.value.selectFile, 'src/index.ts')

  // The same click with a leading ./ behaves identically.
  const dotted = await handleRpc(ctx, options(), 'roots', { filePath: './src/index.ts' })
  assert.equal(dotted.value.root, 'D:/repo')
  assert.equal(dotted.value.selectFile, 'src/index.ts')

  // A relative path that does NOT exist under the default root, with no
  // session to anchor it, resolves nothing — guessing would open a missing
  // directory.
  const missing = await handleRpc(ctx, options(), 'roots', { filePath: 'nope/missing.txt' })
  assert.equal(missing.ok, true)
  assert.equal(missing.value.root, undefined)
  assert.equal(missing.value.reveal, undefined)
  assert.equal(missing.value.selectFile, undefined)
})

test('a stale target path resolves no reveal and no selection', async () => {
  const fs = createFs({
    'D:/repo': { type: 'directory', entries: [] },
  })
  const ctx = createCtx(fs, { workspaces: ['D:/repo'] })
  ctx.sessions = {
    get: (id) => ({ 'sess-1': { header: { cwd: 'D:/repo' } } })[id],
    list: () => [],
  }

  // The file was deleted since the click; the drawer must not navigate into
  // a missing directory and must not try to select anything.
  const result = await handleRpc(ctx, options(), 'roots', { sessionId: 'sess-1', filePath: 'deleted.txt' })
  assert.equal(result.ok, true)
  assert.equal(result.value.root, 'D:/repo')
  assert.equal(result.value.reveal, '')
  assert.equal(result.value.selectFile, undefined)
})

test('extensionless text files are detected by content in meta', async () => {
  const textBytes = new Uint8Array([72, 101, 108, 108, 111, 44, 32, 119, 111, 114, 108, 100, 33, 10])
  const fs = createFs({
    'D:/repo': { type: 'directory', entries: [] },
    'D:/repo/notes': { type: 'file', size: textBytes.length, bytes: textBytes },
  })
  const ctx = createCtx(fs)
  const result = await handleRpc(ctx, options(), 'meta', { path: 'notes' })
  assert.equal(result.ok, true)
  assert.equal(result.value.kind, 'text', 'extensionless text file must be detected as text')
})

test('extensionless binary files stay binary in meta', async () => {
  // ELF header has null bytes at positions 4-15; isTextContent picks them up.
  const binaryBytes = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  const fs = createFs({
    'D:/repo': { type: 'directory', entries: [] },
    'D:/repo/elf': { type: 'file', size: binaryBytes.length, bytes: binaryBytes },
  })
  const ctx = createCtx(fs)
  const result = await handleRpc(ctx, options(), 'meta', { path: 'elf' })
  assert.equal(result.ok, true)
  assert.equal(result.value.kind, 'binary', 'extensionless ELF binary must stay binary')
})

test('extensionless text files are readable as text', async () => {
  const textBytes = new Uint8Array([72, 101, 108, 108, 111, 33, 10])
  const fs = createFs({
    'D:/repo': { type: 'directory', entries: [] },
    'D:/repo/hello': { type: 'file', size: textBytes.length, bytes: textBytes, text: 'Hello!\n' },
  })
  const ctx = createCtx(fs)
  const result = await handleRpc(ctx, options(), 'read', { path: 'hello' })
  assert.equal(result.ok, true)
  assert.equal(result.value.kind, 'text', 'extensionless text file must be readable as text')
  // 'Hello!\n' splits into two lines (trailing newline yields an empty last line).
  assert.equal(result.value.totalLines, 2)
  assert.equal(result.value.lines[0].text, 'Hello!')
})

test('extensionless file with null bytes is read as text but reported binary', async () => {
  // readText calls ctx.fs.readText unconditionally (the kind check is in the
  // client, which uses meta to decide whether to call read or readBytes).
  // The resolveKind call in readText is only for the response kind field.
  const binaryBytes = new Uint8Array([0, 255, 0, 255])
  const fs = createFs({
    'D:/repo': { type: 'directory', entries: [] },
    'D:/repo/data': { type: 'file', size: binaryBytes.length, bytes: binaryBytes, text: '\x00\xff\x00\xff' },
  })
  const ctx = createCtx(fs)
  const result = await handleRpc(ctx, options(), 'read', { path: 'data' })
  assert.equal(result.ok, true)
  assert.equal(result.value.kind, 'binary', 'extensionless file with null bytes must be reported as binary')
  assert.equal(result.value.totalLines, 1)
})

test('files with known extension are also probed by content when classified binary', async () => {
  // A .exe file with no null bytes in the first 8KB is now detected as text.
  const textBytes = new Uint8Array(8192)
  for (let i = 0; i < 8192; i += 1) textBytes[i] = 65 + (i % 26)
  const fs = createFs({
    'D:/repo': { type: 'directory', entries: [] },
    'D:/repo/app.exe': { type: 'file', size: textBytes.length, bytes: textBytes },
  })
  const ctx = createCtx(fs)
  const result = await handleRpc(ctx, options(), 'meta', { path: 'app.exe' })
  assert.equal(result.ok, true)
  assert.equal(result.value.kind, 'text', 'exe with no null bytes is detected as text by content probe')
})

test('a genuine binary exe with null bytes stays binary', async () => {
  // PE executable header starts with "MZ" followed by null bytes at offset 2-3.
  const binaryBytes = new Uint8Array([0x4d, 0x5a, 0, 0, 0x50, 0x45, 0, 0])
  const fs = createFs({
    'D:/repo': { type: 'directory', entries: [] },
    'D:/repo/real.exe': { type: 'file', size: binaryBytes.length, bytes: binaryBytes },
  })
  const ctx = createCtx(fs)
  const result = await handleRpc(ctx, options(), 'meta', { path: 'real.exe' })
  assert.equal(result.ok, true)
  assert.equal(result.value.kind, 'binary', 'exe with null bytes stays binary')
})

test('the languages RPC serves the picker catalog the host validates against', async () => {
  const ctx = createCtx(createFs({ [ROOT]: { type: 'directory', entries: [] } }))
  const result = await handleRpc(ctx, options(), 'languages', {})
  assert.equal(result.ok, true)
  const ids = result.value.languages.map((entry) => entry.id)
  assert.equal(ids[0], 'plain')
  assert.ok(ids.includes('yaml') && ids.includes('json'), 'the common grammars must be offered')
  for (const entry of result.value.languages) {
    assert.equal(typeof entry.label, 'string')
  }
})

test('meta reports a content-detected language for an unknown suffix', async () => {
  // The headline feature: an unrecognised suffix still gets highlighted when
  // the content names its format unambiguously.
  const body = 'server:\n  port: 8080\n  host: 0.0.0.0\nlog:\n  level: info\n'
  const fs = createFs({
    [ROOT]: { type: 'directory', entries: [] },
    [`${ROOT}/config.yaml.prod`]: {
      type: 'file', size: body.length, text: body,
      bytes: new TextEncoder().encode(body),
    },
  })
  const ctx = createCtx(fs)
  const result = await handleRpc(ctx, options(), 'meta', { path: 'config.yaml.prod' })
  assert.equal(result.ok, true)
  assert.equal(result.value.kind, 'text')
  assert.equal(result.value.lang, 'yaml')
  assert.equal(result.value.langSource, 'content')
  assert.equal(result.value.langChoice, 'auto')
})

test('meta keeps a known suffix authoritative over content', async () => {
  const body = 'server:\n  port: 8080\nlog:\n  level: info\n'
  const fs = createFs({
    [ROOT]: { type: 'directory', entries: [] },
    [`${ROOT}/app.py`]: {
      type: 'file', size: body.length, text: body,
      bytes: new TextEncoder().encode(body),
    },
  })
  const ctx = createCtx(fs)
  const result = await handleRpc(ctx, options(), 'meta', { path: 'app.py' })
  assert.equal(result.value.lang, 'python')
  assert.equal(result.value.langSource, 'name')
})

test('meta honours a valid language override and ignores an invalid one', async () => {
  const body = 'server:\n  port: 8080\nlog:\n  level: info\n'
  const fs = createFs({
    [ROOT]: { type: 'directory', entries: [] },
    [`${ROOT}/app.py`]: {
      type: 'file', size: body.length, text: body,
      bytes: new TextEncoder().encode(body),
    },
  })
  const ctx = createCtx(fs)

  const chosen = await handleRpc(ctx, options(), 'meta', { path: 'app.py', lang: 'ini' })
  assert.equal(chosen.value.lang, 'ini')
  assert.equal(chosen.value.langSource, 'override')
  assert.equal(chosen.value.langChoice, 'ini')

  // "plain" is a real choice meaning no highlighting.
  const plain = await handleRpc(ctx, options(), 'meta', { path: 'app.py', lang: 'plain' })
  assert.equal(plain.value.lang, undefined)
  assert.equal(plain.value.langSource, 'override')
  assert.equal(plain.value.langChoice, 'plain')

  // An id the host does not know must not reach the renderer; the file falls
  // back to its name-derived language rather than erroring.
  const bogus = await handleRpc(ctx, options(), 'meta', { path: 'app.py', lang: 'klingon' })
  assert.equal(bogus.value.lang, 'python')
  assert.equal(bogus.value.langSource, 'name')
  assert.equal(bogus.value.langChoice, 'auto', 'an invalid override reports as auto, not as the junk value')

  // Prototype-pollution shaped ids are refused like any other unknown id.
  const proto = await handleRpc(ctx, options(), 'meta', { path: 'app.py', lang: '__proto__' })
  assert.equal(proto.value.lang, 'python')
  assert.equal(proto.value.langChoice, 'auto')
})

test('read resolves the language from the whole file, not the probe window', async () => {
  // The read already holds the entire text, so a signature that only appears
  // past the 8 KB probe boundary is still found here.
  const filler = 'x'.repeat(9000)
  const body = `# ${filler}\n[section]\nkey=value\nother=1\n`
  const fs = createFs({
    [ROOT]: { type: 'directory', entries: [] },
    [`${ROOT}/settings.unknown`]: { type: 'file', size: body.length, text: body },
  })
  const ctx = createCtx(fs)
  const result = await handleRpc(ctx, options(), 'read', { path: 'settings.unknown' })
  assert.equal(result.ok, true)
  assert.equal(result.value.kind, 'text')
  assert.equal(result.value.lang, 'ini')
  assert.equal(result.value.langSource, 'content')
})

test('read applies the override and reports it back', async () => {
  const body = 'server:\n  port: 8080\n'
  const fs = createFs({
    [ROOT]: { type: 'directory', entries: [] },
    [`${ROOT}/config.yaml.prod`]: { type: 'file', size: body.length, text: body },
  })
  const ctx = createCtx(fs)
  const result = await handleRpc(ctx, options(), 'read', { path: 'config.yaml.prod', lang: 'json' })
  assert.equal(result.ok, true)
  assert.equal(result.value.lang, 'json')
  assert.equal(result.value.langSource, 'override')
  assert.equal(result.value.langChoice, 'json')
})

test('an unrecognised-extension text file larger than the probe window is still text', async () => {
  // Regression: `config.yaml.prod` (16 KB) was reported as binary. The probe
  // asked readBytes for 8 KB, but that primitive bounds the COMPLETE file and
  // fails with FS_TOO_LARGE instead of truncating — so the throw was swallowed
  // and every unknown-extension file above 8 KB stayed classified by name.
  const body = 'server:\n  port: 8080\n'
  const big = new Uint8Array(16 * 1024)
  for (let i = 0; i < big.length; i += 1) big[i] = body.charCodeAt(i % body.length)
  const fs = createFs({
    'D:/repo': { type: 'directory', entries: [] },
    'D:/repo/config.yaml.prod': { type: 'file', size: big.length, bytes: big, text: body },
  })
  const ctx = createCtx(fs)
  const result = await handleRpc(ctx, options(), 'meta', { path: 'config.yaml.prod' })
  assert.equal(result.ok, true)
  assert.equal(result.value.kind, 'text', '16 KB unknown-extension text file must be text')
  // The probe must read a window, never the whole file.
  assert.ok(
    fs.calls.some((call) => call[0] === 'readByteRange'),
    'classification must probe through readByteRange',
  )
  assert.ok(
    !fs.calls.some((call) => call[0] === 'readBytes'),
    'classification must not use the whole-file readBytes primitive',
  )
})

test('the probe window is bounded even for a very large text file', async () => {
  // The window is the bound, not the file: a 20 MB unknown-extension text file
  // must classify as text without the host ever buffering it whole.
  const big = new Uint8Array(20 * 1024 * 1024)
  big.fill(65)
  const fs = createFs({
    'D:/repo': { type: 'directory', entries: [] },
    'D:/repo/huge.cfg.local': { type: 'file', size: big.length, bytes: big },
  })
  const ctx = createCtx(fs)
  const result = await handleRpc(ctx, options(), 'meta', { path: 'huge.cfg.local' })
  assert.equal(result.ok, true)
  assert.equal(result.value.kind, 'text')
  const probe = fs.calls.find((call) => call[0] === 'readByteRange')
  assert.ok(probe, 'must probe by window')
  assert.equal(probe[3], 8192, 'probe reads exactly the 8 KB sample window')
})

test('a null-free but non-UTF-8 file is not promoted to text', async () => {
  // GBK-encoded content has no null bytes, so the null-byte heuristic alone
  // would call it text — but the text read rejects non-UTF-8, moving the
  // failure from classification to read. The probe must classify honestly.
  const gbk = new Uint8Array([0xc5, 0xe4, 0xd6, 0xc3, 0x0a, 0xc5, 0xe4, 0xd6, 0xc3])
  const fs = createFs({
    'D:/repo': { type: 'directory', entries: [] },
    'D:/repo/legacy.conf.bak': { type: 'file', size: gbk.length, bytes: gbk },
  })
  const ctx = createCtx(fs)
  const result = await handleRpc(ctx, options(), 'meta', { path: 'legacy.conf.bak' })
  assert.equal(result.ok, true)
  assert.equal(result.value.kind, 'binary', 'non-UTF-8 content stays binary rather than failing at read')
})

test('a multi-byte character straddling the probe boundary still reads as text', async () => {
  // A 3-byte character split by the 8 KB window must not look malformed: a
  // truncated sample is not evidence of a non-text file.
  const big = new Uint8Array(16 * 1024)
  big.fill(0x41)
  big[8191] = 0xe4
  big[8192] = 0xb8
  big[8193] = 0xad
  const fs = createFs({
    'D:/repo': { type: 'directory', entries: [] },
    'D:/repo/notes.zh.txt.bak': { type: 'file', size: big.length, bytes: big },
  })
  const ctx = createCtx(fs)
  const result = await handleRpc(ctx, options(), 'meta', { path: 'notes.zh.txt.bak' })
  assert.equal(result.ok, true)
  assert.equal(result.value.kind, 'text', 'a split multi-byte char must not force a binary verdict')
})

test('a text read rejected as non-UTF-8 reports not-text, not a permissions failure', async () => {
  // The backend rejects non-UTF-8 and binary content with FS_NOT_TEXT. That is
  // a content verdict, not an access failure, so it must not surface as the
  // generic read-failed ("可能没有访问权限") message.
  const fs = createFs({
    'D:/repo': { type: 'directory', entries: [] },
    'D:/repo/legacy.conf.bak': { type: 'file', size: 6, bytes: new Uint8Array([0xc5, 0xe4, 0xd6, 0xc3, 0x0a, 0x41]) },
  })
  const failure = new Error('cannot read: binary file')
  failure.code = 'FS_NOT_TEXT'
  fs.readText = async () => { throw failure }
  const ctx = createCtx(fs)

  const result = await handleRpc(ctx, options(), 'read', { path: 'legacy.conf.bak' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'not-text')
  assert.equal(result.error.details.reason, 'FS_NOT_TEXT')
})

test('an ordinary read failure still reports read-failed', async () => {
  const fs = createFs({
    'D:/repo': { type: 'directory', entries: [] },
    'D:/repo/secret.txt': { type: 'file', size: 5, text: 'hello' },
  })
  const failure = new Error('permission denied')
  failure.code = 'EACCES'
  fs.readText = async () => { throw failure }
  const ctx = createCtx(fs)

  const result = await handleRpc(ctx, options(), 'read', { path: 'secret.txt' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'read-failed')
})

test('diff RPC returns hasDiff false when git is not applicable or file has no diff', async () => {
  const fs = createFs({
    'D:/repo': { type: 'directory', entries: [] },
    'D:/repo/notes.txt': { type: 'file', size: 10, text: 'hello' },
  })
  const ctx = createCtx(fs)
  const result = await handleRpc(ctx, options(), 'diff', { path: 'notes.txt' })
  assert.equal(result.ok, true)
  assert.equal(typeof result.value.hasDiff, 'boolean')
})
test('status RPC returns modified and untracked lists gracefully', async () => {
  const fs = createFs({
    'D:/repo': { type: 'directory', entries: [] },
  })
  const ctx = createCtx(fs)
  const result = await handleRpc(ctx, options(), 'status', {})
  assert.equal(result.ok, true)
  assert(Array.isArray(result.value.modified))
  assert(Array.isArray(result.value.untracked))
})

test('safePaths configures safe access paths outside workspace with labels and kinds', () => {
  const ctx = createCtx(createFs({}), { workspaces: ['D:/repo'], sessions: [] })
  const roots = collectRoots(ctx, options({
    safePaths: [
      { path: 'D:/external-data', label: '外部数据盘' },
      'D:/logs',
      '/',
    ],
  }))

  assert.equal(roots.length, 4)
  assert.deepEqual(roots[0], { id: 'D:/repo', label: 'repo', path: 'D:/repo', kind: 'workspace' })
  assert.deepEqual(roots[1], { id: 'D:/external-data', label: '外部数据盘', path: 'D:/external-data', kind: 'safe-path' })
  assert.deepEqual(roots[2], { id: 'D:/logs', label: 'logs', path: 'D:/logs', kind: 'safe-path' })
  assert.deepEqual(roots[3], { id: '/', label: '根目录 (/)', path: '/', kind: 'safe-path' })
})

test('safeAccessPaths and extraRoots merge into safe access paths', () => {
  const ctx = createCtx(createFs({}), { workspaces: ['D:/repo'], sessions: [] })
  const roots = collectRoots(ctx, options({
    safeAccessPaths: ['D:/safe1'],
    extraRoots: ['D:/extra1', 'D:/safe1'],
  }))

  assert.deepEqual(roots.map((r) => r.path), ['D:/repo', 'D:/safe1', 'D:/extra1'])
  assert.equal(roots[1].kind, 'safe-path')
  assert.equal(roots[2].kind, 'safe-path')
})

test('file operations succeed in safe access paths outside the workspace', async () => {
  const SAFE_DIR = 'D:/safe-zone'
  const fs = createFs({
    [ROOT]: { type: 'directory', entries: [] },
    [SAFE_DIR]: {
      type: 'directory',
      entries: [
        { name: 'config.json', type: 'file', size: 30 },
        { name: 'data.txt', type: 'file', size: 20 },
      ],
    },
    [`${SAFE_DIR}/config.json`]: { type: 'file', size: 30, text: '{"enabled": true}' },
    [`${SAFE_DIR}/data.txt`]: { type: 'file', size: 20, text: 'safe content here\n' },
  })
  const ctx = createCtx(fs, { workspaces: [ROOT] })
  const opts = options({ safePaths: [{ path: SAFE_DIR, label: '安全目录' }] })

  // 1. list directory in safe path
  const listResult = await handleRpc(ctx, opts, 'list', { root: SAFE_DIR })
  assert.equal(listResult.ok, true)
  assert.equal(listResult.value.entries.length, 2)
  assert.equal(listResult.value.entries[0].name, 'config.json')

  // 2. read text in safe path
  const readResult = await handleRpc(ctx, opts, 'read', { root: SAFE_DIR, path: 'data.txt' })
  assert.equal(readResult.ok, true)
  assert.equal(readResult.value.lines[0].text, 'safe content here')

  // 3. describe file in safe path
  const metaResult = await handleRpc(ctx, opts, 'meta', { root: SAFE_DIR, path: 'config.json' })
  assert.equal(metaResult.ok, true)
  assert.equal(metaResult.value.kind, 'json')
  assert.equal(metaResult.value.name, 'config.json')

  // 4. accessing path escaping the safe path is refused
  const outsideResult = await handleRpc(ctx, opts, 'read', { root: SAFE_DIR, path: '../other.txt' })
  assert.equal(outsideResult.ok, false)
  assert.equal(outsideResult.error.code, 'outside-root')
})

test('resolveSessionRoot resolves target file located in safe access path', async () => {
  const SAFE_DIR = 'D:/safe-zone'
  const fs = createFs({
    'D:/repo': { type: 'directory', entries: [] },
    [SAFE_DIR]: { type: 'directory', entries: [] },
    [`${SAFE_DIR}/logs`]: { type: 'directory', entries: [] },
    [`${SAFE_DIR}/logs/app.log`]: { type: 'file', size: 100 },
  })
  const ctx = createCtx(fs, { workspaces: ['D:/repo'] })
  const opts = options({ safePaths: [SAFE_DIR] })

  const res = await handleRpc(ctx, opts, 'roots', { filePath: `${SAFE_DIR}/logs/app.log` })
  assert.equal(res.ok, true)
  assert.equal(res.value.root, SAFE_DIR)
  assert.equal(res.value.reveal, 'logs')
  assert.equal(res.value.selectFile, 'logs/app.log')
})

test('resolveSessionRoot resolves target file with tilde path ~/ when home directory is in safe access paths', async () => {
  const os = (await import('node:os')).default
  const home = os.homedir()

  const fs = createFs({
    'D:/repo': { type: 'directory', entries: [] },
    [home]: { type: 'directory', entries: [] },
    [`${home}/docs`]: { type: 'directory', entries: [] },
    [`${home}/docs/test.png`]: { type: 'file', size: 200 },
  })
  const ctx = createCtx(fs, { workspaces: ['D:/repo'] })
  const opts = options({ safePaths: [home] })

  // 1. Target with ~/docs/test.png
  const res = await handleRpc(ctx, opts, 'roots', { filePath: '~/docs/test.png' })
  assert.equal(res.ok, true)
  assert.equal(res.value.root, home)
  assert.equal(res.value.reveal, 'docs')
  assert.equal(res.value.selectFile, 'docs/test.png')

  // 2. Target directly in home ~/test.png
  const fs2 = createFs({
    'D:/repo': { type: 'directory', entries: [] },
    [home]: { type: 'directory', entries: [] },
    [`${home}/test.png`]: { type: 'file', size: 200 },
  })
  const ctx2 = createCtx(fs2, { workspaces: ['D:/repo'] })
  const res2 = await handleRpc(ctx2, opts, 'roots', { filePath: '~/test.png' })
  assert.equal(res2.ok, true)
  assert.equal(res2.value.root, home)
  assert.equal(res2.value.selectFile, 'test.png')
})

test('getSafePaths and updateSafePaths RPC methods support dynamic web configuration', async () => {
  const fs = createFs({
    'D:/repo': { type: 'directory', entries: [] },
  })
  const ctx = createCtx(fs, { workspaces: ['D:/repo'] })
  let currentPaths = [{ path: 'D:/init', label: '初始安全路径' }]

  const opts = () => ({
    safePaths: currentPaths,
    _updateSafePaths: async (newPaths) => { currentPaths = newPaths },
  })

  // 1. getSafePaths returns current safe paths and builtInWorkspaces
  const getRes = await handleRpc(ctx, opts, 'getSafePaths', {})
  assert.equal(getRes.ok, true)
  assert.deepEqual(getRes.value.safePaths, [{ path: 'D:/init', label: '初始安全路径' }])
  assert.equal(getRes.value.builtInWorkspaces.length, 1)
  assert.equal(getRes.value.builtInWorkspaces[0].path, 'D:/repo')

  // 2. updateSafePaths updates the safe paths dynamically
  const updateRes = await handleRpc(ctx, opts, 'updateSafePaths', {
    safePaths: [
      { path: 'D:/init', label: '初始安全路径' },
      { path: '/var/data', label: 'Web添加路径' },
    ],
  })
  assert.equal(updateRes.ok, true)
  assert.equal(updateRes.value.safePaths.length, 2)

  // 3. getSafePaths reflects the new state
  const getResAfter = await handleRpc(ctx, opts, 'getSafePaths', {})
  assert.equal(getResAfter.value.safePaths.length, 2)
  assert.equal(getResAfter.value.safePaths[1].path, '/var/data')
})

test('symlink in workspace pointing to an authorized safe path is allowed, but unauthorized symlink is rejected', async () => {
  const SAFE_DIR = 'D:/safe_pics'
  const UNTRUSTED_DIR = 'D:/untrusted'

  const fs = createFs({
    'D:/workspace': { type: 'directory', entries: [] },
    [`${SAFE_DIR}`]: { type: 'directory', entries: [] },
    [`${SAFE_DIR}/photo.png`]: { type: 'file', size: 1024, content: 'img data' },
    [`${UNTRUSTED_DIR}`]: { type: 'directory', entries: [] },
    [`${UNTRUSTED_DIR}/passwd`]: { type: 'file', size: 200, content: 'root:x:0:0' },
  })

  // Custom resolve to simulate symlinks
  const originalResolve = fs.resolve.bind(fs)
  fs.resolve = async (p, opts) => {
    if (p === 'D:/workspace/valid_link.png') {
      return { targetKey: `${SAFE_DIR}/photo.png`, displayPath: p }
    }
    if (p === 'D:/workspace/untrusted_link.txt') {
      return { targetKey: `${UNTRUSTED_DIR}/passwd`, displayPath: p }
    }
    return originalResolve(p, opts)
  }

  const ctx = createCtx(fs, { workspaces: ['D:/workspace'] })
  const opts = options({ safePaths: [SAFE_DIR] })

  // 1. Symlink pointing to safe path should succeed
  const metaOk = await handleRpc(ctx, opts, 'meta', { root: 'D:/workspace', path: 'valid_link.png' })
  assert.equal(metaOk.ok, true)
  assert.equal(metaOk.value.kind, 'image')
  assert.equal(metaOk.value.name, 'valid_link.png')

  // 2. Symlink pointing to untrusted path outside safe paths should be rejected
  const metaBlocked = await handleRpc(ctx, opts, 'meta', { root: 'D:/workspace', path: 'untrusted_link.txt' })
  assert.equal(metaBlocked.ok, false)
  assert.equal(metaBlocked.error.code, 'outside-root')
  assert.equal(metaBlocked.error.details?.realPath, `${UNTRUSTED_DIR}/passwd`)
})

test('readDoc supports .doc files via word-extractor', async () => {
  const fsSync = (await import('fs')).default
  const sampleDocx = fsSync.readFileSync(new URL('../node_modules/mammoth/test/test-data/single-paragraph.docx', import.meta.url))

  const fs = createFs({
    'D:/repo': { type: 'directory', entries: [] },
    'D:/repo/sample.doc': { type: 'file', size: sampleDocx.length },
  })
  fs.readBytes = async () => sampleDocx

  const ctx = createCtx(fs, { workspaces: ['D:/repo'] })

  // 1. Meta identifies .doc as 'doc'
  const metaRes = await handleRpc(ctx, options(), 'meta', { path: 'sample.doc' })
  assert.equal(metaRes.ok, true)
  assert.equal(metaRes.value.kind, 'doc')

  // 2. doc RPC extracts content
  const docRes = await handleRpc(ctx, options(), 'doc', { path: 'sample.doc' })
  assert.equal(docRes.ok, true)
  assert.match(docRes.value.markdown, /Walking on imported air/)
})

test('safe paths are persisted to disk settings file and survive reload / restart', async () => {
  const tmpDir = (await import('node:os')).tmpdir()
  const path = (await import('node:path')).default
  const fsSync = (await import('node:fs')).default
  const { apply, readPersistedSettings } = await import('../lib/index.js')

  const testSettingsFile = path.join(tmpDir, `fv-test-settings-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  try {
    // 1. Initial fake context without settings file
    let capturedHandler = null
    const mockCtx = {
      workspaceRegistry: { list: () => [{ path: 'D:/work' }] },
      fs: { homedir: () => 'D:/Users/tester' },
      inject: (deps, cb) => cb({
        connection: {
          rpc: {
            handle: (channel, handler) => { capturedHandler = handler },
          },
        },
      }),
    }

    apply(mockCtx, { settingsFile: testSettingsFile })
    assert.ok(capturedHandler, 'rpc handler registered')

    // 2. Initial state has no custom safe paths
    const initialGet = await capturedHandler('getSafePaths', {})
    assert.equal(initialGet.ok, true)
    assert.equal(initialGet.value.safePaths.length, 0)

    // 3. Update safe paths from Web UI
    const updateRes = await capturedHandler('updateSafePaths', {
      safePaths: [
        { path: 'D:/Custom/Photos', label: '我的相册' },
        { path: 'D:/Notes', label: '笔记' },
      ],
    })
    assert.equal(updateRes.ok, true)
    assert.equal(updateRes.value.safePaths.length, 2)

    // 4. Verify disk file was written
    const diskData = readPersistedSettings(testSettingsFile)
    assert.ok(diskData, 'settings file was created')
    assert.equal(diskData.safePaths.length, 2)
    assert.equal(diskData.safePaths[0].path, 'D:/Custom/Photos')
    assert.equal(diskData.safePaths[1].label, '笔记')

    // 5. Simulate DSH restart: create brand new plugin instance with same settingsFile
    let restartedHandler = null
    const restartedCtx = {
      workspaceRegistry: { list: () => [{ path: 'D:/work' }] },
      fs: { homedir: () => 'D:/Users/tester' },
      inject: (deps, cb) => cb({
        connection: {
          rpc: {
            handle: (channel, handler) => { restartedHandler = handler },
          },
        },
      }),
    }
    apply(restartedCtx, { settingsFile: testSettingsFile })

    // 6. getSafePaths on new instance restores safe paths from disk
    const restoredGet = await restartedHandler('getSafePaths', {})
    assert.equal(restoredGet.ok, true)
    assert.equal(restoredGet.value.safePaths.length, 2)
    assert.equal(restoredGet.value.safePaths[0].path, 'D:/Custom/Photos')
    assert.equal(restoredGet.value.safePaths[1].path, 'D:/Notes')

    // 7. Deletion test: remove one path and save
    const deleteRes = await restartedHandler('updateSafePaths', {
      safePaths: [
        { path: 'D:/Notes', label: '笔记' },
      ],
    })
    assert.equal(deleteRes.ok, true)
    assert.equal(deleteRes.value.safePaths.length, 1)

    // 8. Disk file reflects deletion
    const diskAfterDelete = readPersistedSettings(testSettingsFile)
    assert.equal(diskAfterDelete.safePaths.length, 1)
    assert.equal(diskAfterDelete.safePaths[0].path, 'D:/Notes')
  } finally {
    try { fsSync.unlinkSync(testSettingsFile) } catch (_) {}
  }
})

test('handleDownloadRequest serves direct HTTP downloads up to 100MB for browser handoff', async () => {
  const fileBytes = Buffer.from('hello-world-direct-download')
  const fs = createFs({
    [ROOT]: { type: 'directory', entries: [] },
    [`${ROOT}/hello.txt`]: { type: 'file', size: fileBytes.length, bytes: fileBytes },
    [`${ROOT}/huge.bin`]: { type: 'file', size: 120 * 1024 * 1024 },
  })
  const ctx = createCtx(fs)

  // 1. Successful GET download
  const req = new Request(`http://127.0.0.1:3080/api/file-viewer/download?root=${encodeURIComponent(ROOT)}&path=hello.txt&filename=my-hello.txt`, {
    method: 'GET',
  })
  const res = await handleDownloadRequest(ctx, options(), req)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Content-Length'), String(fileBytes.length))
  assert.match(res.headers.get('Content-Disposition'), /attachment; filename="my-hello\.txt"/)
  const downloadedBytes = Buffer.from(await res.arrayBuffer())
  assert.deepEqual(downloadedBytes, fileBytes)

  // 2. HEAD request metadata only
  const headReq = new Request(`http://127.0.0.1:3080/api/file-viewer/download?root=${encodeURIComponent(ROOT)}&path=hello.txt`, {
    method: 'HEAD',
  })
  const headRes = await handleDownloadRequest(ctx, options(), headReq)
  assert.equal(headRes.status, 200)
  assert.equal(headRes.headers.get('Content-Length'), String(fileBytes.length))
  assert.equal(await headRes.text(), '')

  // 3. File exceeding 100MB limit returns 413
  const hugeReq = new Request(`http://127.0.0.1:3080/api/file-viewer/download?root=${encodeURIComponent(ROOT)}&path=huge.bin`, {
    method: 'GET',
  })
  const hugeRes = await handleDownloadRequest(ctx, options(), hugeReq)
  assert.equal(hugeRes.status, 413)

  // 4. Missing file returns 404
  const missingReq = new Request(`http://127.0.0.1:3080/api/file-viewer/download?root=${encodeURIComponent(ROOT)}&path=notfound.txt`, {
    method: 'GET',
  })
  const missingRes = await handleDownloadRequest(ctx, options(), missingReq)
  assert.equal(missingRes.status, 404)

  // 5. Escaping path returns 403
  const escapeReq = new Request(`http://127.0.0.1:3080/api/file-viewer/download?root=${encodeURIComponent(ROOT)}&path=../secret.txt`, {
    method: 'GET',
  })
  const escapeRes = await handleDownloadRequest(ctx, options(), escapeReq)
  assert.equal(escapeRes.status, 403)
})

test('handleDownloadRequest survives non-ASCII names and hides host paths', async () => {
  const bytes = Buffer.from('pdf-bytes')
  const fs = createFs({
    [ROOT]: { type: 'directory', entries: [] },
    [`${ROOT}/报告.pdf`]: { type: 'file', size: bytes.length, bytes },
    [`${ROOT}/shot-😀.png`]: { type: 'file', size: bytes.length, bytes },
  })
  const ctx = createCtx(fs)

  // A Chinese name must download, not fail the header construction with a 500.
  const chineseReq = new Request(
    `http://127.0.0.1:3080/api/file-viewer/download?root=${encodeURIComponent(ROOT)}&path=${encodeURIComponent('报告.pdf')}`,
    { method: 'GET' },
  )
  const chineseRes = await handleDownloadRequest(ctx, options(), chineseReq)
  assert.equal(chineseRes.status, 200)
  assert.deepEqual(Buffer.from(await chineseRes.arrayBuffer()), bytes)
  const disposition = chineseRes.headers.get('Content-Disposition')
  assert.match(disposition, /filename\*=UTF-8''%E6%8A%A5%E5%91%8A\.pdf/)
  // The plain fallback must not carry the raw CJK characters.
  assert.equal(disposition.includes('报告'), false)

  // An emoji name takes the same path.
  const emojiRes = await handleDownloadRequest(
    ctx,
    options(),
    new Request(
      `http://127.0.0.1:3080/api/file-viewer/download?root=${encodeURIComponent(ROOT)}&path=${encodeURIComponent('shot-😀.png')}`,
      { method: 'GET' },
    ),
  )
  assert.equal(emojiRes.status, 200)

  // A backend failure must not echo an absolute host path to the browser.
  const leakyFs = createFs({ [ROOT]: { type: 'directory', entries: [] } })
  leakyFs.resolve = () => {
    throw Object.assign(new Error("EACCES: permission denied, open 'D:/repo/secret/.env'"), { code: 'EACCES' })
  }
  const leakyCtx = createCtx(leakyFs)
  const leakyRes = await handleDownloadRequest(
    leakyCtx,
    options(),
    new Request(`http://127.0.0.1:3080/api/file-viewer/download?root=${encodeURIComponent(ROOT)}&path=x`, { method: 'GET' }),
  )
  const leakyBody = await leakyRes.text()
  assert.equal(leakyRes.status, 500)
  assert.equal(leakyBody.includes('D:/repo'), false, 'host paths must never reach the browser')
  assert.equal(leakyBody, 'download-failed')
})

test('handleDownloadRequest maps host fs codes onto the statuses the client switches on', async () => {
  const ROOT_ENTRY = { [ROOT]: { type: 'directory', entries: [] } }

  // A backend that reports no size can only fail at read time; the client needs
  // 413 to show the "exceeds 100 MB" notice instead of a generic failure.
  const sizeUnknown = createFs(ROOT_ENTRY)
  sizeUnknown.resolve = () => Promise.resolve({ targetKey: 'f', displayPath: `${ROOT}/huge.bin`, kind: 'file' })
  sizeUnknown.stat = () => Promise.resolve({ type: 'file' })
  sizeUnknown.readBytes = () => {
    throw Object.assign(new Error('too large'), { code: 'FS_TOO_LARGE' })
  }
  const tooLargeRes = await handleDownloadRequest(
    createCtx(sizeUnknown),
    options(),
    new Request(`http://127.0.0.1:3080/api/file-viewer/download?root=${encodeURIComponent(ROOT)}&path=huge.bin`, { method: 'GET' }),
  )
  assert.equal(tooLargeRes.status, 413)
  assert.equal(await tooLargeRes.text(), 'FS_TOO_LARGE')

  // Sandbox denials are permissions failures, not server errors.
  const denied = createFs(ROOT_ENTRY)
  denied.resolve = () => Promise.resolve({ targetKey: 'f', displayPath: `${ROOT}/secret.txt`, kind: 'file' })
  denied.stat = () => Promise.resolve({ type: 'file', size: 4 })
  denied.readBytes = () => {
    throw Object.assign(new Error('denied'), { code: 'FS_SANDBOX_DENIED' })
  }
  const deniedRes = await handleDownloadRequest(
    createCtx(denied),
    options(),
    new Request(`http://127.0.0.1:3080/api/file-viewer/download?root=${encodeURIComponent(ROOT)}&path=secret.txt`, { method: 'GET' }),
  )
  assert.equal(deniedRes.status, 403)
})

test('the download budget is separate from the in-page preview budget', async () => {
  // A 50 MB file is too big to preview but must still download.
  const size = 50 * 1024 * 1024
  const bytes = new Uint8Array(size)
  const fs = createFs({
    [ROOT]: { type: 'directory', entries: [] },
    [`${ROOT}/big.bin`]: { type: 'file', size, bytes },
  })
  const ctx = createCtx(fs)
  const downloadOptions = () => ({ extraRoots: [], maxBytes: MAX_BYTES, maxDownloadBytes: MAX_DOWNLOAD_BYTES })

  const meta = await handleRpc(ctx, downloadOptions, 'meta', { path: 'big.bin' })
  assert.equal(meta.value.tooLarge, true, 'preview budget still refuses it')

  const res = await handleDownloadRequest(
    ctx,
    downloadOptions,
    new Request(`http://127.0.0.1:3080/api/file-viewer/download?root=${encodeURIComponent(ROOT)}&path=big.bin`, { method: 'GET' }),
  )
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Content-Length'), String(size))
})



