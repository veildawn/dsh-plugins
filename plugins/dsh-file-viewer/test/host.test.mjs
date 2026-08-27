import assert from 'node:assert/strict'
import test from 'node:test'

import { RPC_CHANNEL, ViewerError, collectRoots, handleRpc } from '../lib/index.js'

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
      return tree[target.targetKey]
    },
    async listDir(target) {
      const node = tree[target.targetKey]
      if (node === undefined) throw new ViewerError('not-found', 'missing')
      return node.entries ?? []
    },
    async readText(target) {
      this.calls.push(['readText', target.targetKey])
      return tree[target.targetKey]?.text ?? ''
    },
    async readBytes(target, _signal, maxBytes) {
      this.calls.push(['readBytes', target.targetKey, maxBytes])
      return tree[target.targetKey]?.bytes ?? new Uint8Array()
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

const options = (overrides = {}) => () => ({ extraRoots: [], maxBytes: 20 * 1024 * 1024, ...overrides })

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
  assert.deepEqual(fs.calls.at(-1), ['readBytes', `${ROOT}/shot.png`, 20 * 1024 * 1024])

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
    [`${ROOT}/huge.pdf`]: { type: 'file', size: 40 * 1024 * 1024 },
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