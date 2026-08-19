import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_BYTES,
  WINDOW_LINES,
  ancestorsOf,
  baseNameOf,
  flattenTree,
  extensionOf,
  formatBytes,
  isHiddenEntry,
  isSafeRelativePath,
  joinPath,
  kindOf,
  langOf,
  mediaTypeOf,
  resolveWindow,
  sortEntries,
  splitLines,
  windowRows,
} from '../lib/core.js'

test('path segmentation tolerates both separators and trailing slashes', () => {
  assert.equal(baseNameOf('src/app/main.ts'), 'main.ts')
  assert.equal(baseNameOf('D:\\CodeSpace\\repo\\lib\\core.js'), 'core.js')
  assert.equal(baseNameOf('src/app/'), 'app')
  assert.equal(baseNameOf('plain.txt'), 'plain.txt')
  assert.equal(baseNameOf(''), '')
  assert.equal(baseNameOf(undefined), '')

  assert.equal(extensionOf('main.TS'), 'ts')
  assert.equal(extensionOf('archive.tar.gz'), 'gz')
  assert.equal(extensionOf('Makefile'), '')
  // A leading dot names the file, it does not start an extension.
  assert.equal(extensionOf('.gitignore'), '')
})

test('language hints cover grammars the client can load and skip the rest', () => {
  assert.equal(langOf('lib/core.js'), 'javascript')
  assert.equal(langOf('src/App.tsx'), 'tsx')
  assert.equal(langOf('main.py'), 'python')
  assert.equal(langOf('Cargo.toml'), 'toml')
  assert.equal(langOf('deploy.sh'), 'shellscript')
  assert.equal(langOf('Dockerfile'), 'shellscript')
  assert.equal(langOf('.gitignore'), 'ini')
  assert.equal(langOf('notes.txt'), undefined)
  assert.equal(langOf('photo.png'), undefined)
})

test('kind classification routes every requested format to one viewer', () => {
  assert.equal(kindOf('README.md'), 'markdown')
  assert.equal(kindOf('package.json'), 'json')
  assert.equal(kindOf('lib/core.js'), 'text')
  assert.equal(kindOf('notes.txt'), 'text')
  assert.equal(kindOf('LICENSE'), 'text')
  assert.equal(kindOf('Makefile'), 'text')
  assert.equal(kindOf('shot.PNG'), 'image')
  assert.equal(kindOf('diagram.svg'), 'image')
  assert.equal(kindOf('manual.pdf'), 'pdf')
  assert.equal(kindOf('report.xlsx'), 'sheet')
  assert.equal(kindOf('spec.docx'), 'doc')
  assert.equal(kindOf('app.exe'), 'binary')
  assert.equal(kindOf('bundle.wasm'), 'binary')
})

test('media types are stamped only for formats the browser renders natively', () => {
  assert.equal(mediaTypeOf('shot.png'), 'image/png')
  assert.equal(mediaTypeOf('photo.JPG'), 'image/jpeg')
  assert.equal(mediaTypeOf('diagram.svg'), 'image/svg+xml')
  assert.equal(mediaTypeOf('manual.pdf'), 'application/pdf')
  assert.equal(mediaTypeOf('lib/core.js'), undefined)
})

test('default hiding collapses dotfiles and heavy directories', () => {
  assert.equal(isHiddenEntry('.git'), true)
  assert.equal(isHiddenEntry('node_modules'), true)
  assert.equal(isHiddenEntry('.env'), true)
  assert.equal(isHiddenEntry('lib'), false)
  assert.equal(isHiddenEntry(''), false)
})

test('entries sort directories first then case-insensitive by name', () => {
  const ordered = sortEntries([
    { name: 'README.md', type: 'file' },
    { name: 'lib', type: 'directory' },
    { name: 'Test', type: 'directory' },
    { name: 'app.js', type: 'file' },
    { name: 'Core.js', type: 'file' },
  ])
  assert.deepEqual(ordered.map((row) => row.name), ['lib', 'Test', 'app.js', 'Core.js', 'README.md'])
})

test('line splitting reports the dominant EOL and keeps every line', () => {
  assert.deepEqual(splitLines('a\nb\nc'), { lines: ['a', 'b', 'c'], eol: 'lf' })
  assert.deepEqual(splitLines('a\r\nb\r\nc'), { lines: ['a', 'b', 'c'], eol: 'crlf' })
  assert.deepEqual(splitLines('a\rb'), { lines: ['a', 'b'], eol: 'cr' })
  // A trailing newline yields a final empty line, matching editor line counts.
  assert.deepEqual(splitLines('a\n').lines, ['a', ''])
  assert.deepEqual(splitLines('').lines, [''])
})

test('windows clamp onto the file and stay inside it for absurd requests', () => {
  const first = resolveWindow(1200)
  assert.deepEqual(first, { offset: 1, limit: WINDOW_LINES, end: 500, hasBefore: false, hasAfter: true })

  const middle = resolveWindow(1200, 501)
  assert.deepEqual(middle, { offset: 501, limit: 500, end: 1000, hasBefore: true, hasAfter: true })

  const tail = resolveWindow(1200, 1101)
  assert.deepEqual(tail, { offset: 701, limit: 500, end: 1200, hasBefore: true, hasAfter: false })

  // Past the end lands on the last full window rather than erroring.
  const past = resolveWindow(1200, 99_999)
  assert.equal(past.end, 1200)
  assert.equal(past.hasAfter, false)

  const short = resolveWindow(12)
  assert.deepEqual(short, { offset: 1, limit: 500, end: 12, hasBefore: false, hasAfter: false })

  const empty = resolveWindow(0)
  assert.deepEqual(empty, { offset: 1, limit: 500, end: 0, hasBefore: false, hasAfter: false })

  // A caller cannot ask for an unbounded window.
  assert.equal(resolveWindow(1_000_000, 1, 999_999).limit, WINDOW_LINES * 4)
  assert.equal(resolveWindow(500, 1, -5).limit, WINDOW_LINES)
})

test('window rows carry absolute line numbers for the paged viewer', () => {
  const lines = ['one', 'two', 'three', 'four', 'five']
  assert.deepEqual(windowRows(lines, { offset: 2, end: 4 }), [
    { number: 2, text: 'two' },
    { number: 3, text: 'three' },
    { number: 4, text: 'four' },
  ])
  assert.deepEqual(windowRows(lines, { offset: 1, end: 0 }), [])
  // A window past the data yields empty text rather than undefined.
  assert.deepEqual(windowRows(['only'], { offset: 1, end: 2 }), [
    { number: 1, text: 'only' },
    { number: 2, text: '' },
  ])
})

test('relative paths that try to escape their root are refused', () => {
  assert.equal(isSafeRelativePath('lib/core.js'), true)
  assert.equal(isSafeRelativePath('a/b/c.txt'), true)
  assert.equal(isSafeRelativePath(''), true)
  assert.equal(isSafeRelativePath(undefined), true)

  assert.equal(isSafeRelativePath('../secrets'), false)
  assert.equal(isSafeRelativePath('lib/../../etc/passwd'), false)
  assert.equal(isSafeRelativePath('lib\\..\\..\\secrets'), false)
  assert.equal(isSafeRelativePath('/etc/passwd'), false)
  assert.equal(isSafeRelativePath('\\\\server\\share'), false)
  assert.equal(isSafeRelativePath('C:/Windows/System32'), false)
  assert.equal(isSafeRelativePath('lib/\0.js'), false)
  assert.equal(isSafeRelativePath(42), false)

  // '..' must be a whole segment to be an escape; a filename may contain dots.
  assert.equal(isSafeRelativePath('lib/..hidden'), true)
  assert.equal(isSafeRelativePath('lib/a..b/c.js'), true)
})

test('joining keeps one separator and tolerates redundant ones', () => {
  assert.equal(joinPath('D:/repo', 'lib/core.js'), 'D:/repo/lib/core.js')
  assert.equal(joinPath('D:/repo/', '/lib/core.js'), 'D:/repo/lib/core.js')
  assert.equal(joinPath('D:\\repo\\', 'lib'), 'D:\\repo/lib')
  assert.equal(joinPath('/home/me/repo', ''), '/home/me/repo')
  assert.equal(joinPath('/home/me/repo', undefined), '/home/me/repo')
})

test('byte sizes stay short enough for a listing column', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1024), '1 KB')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(20 * 1024 * 1024), '20 MB')
  assert.equal(formatBytes(MAX_BYTES), '20 MB')
  assert.equal(formatBytes(-1), '')
  assert.equal(formatBytes(Number.NaN), '')
})

test('ancestors list the directories leading to a path', () => {
  assert.deepEqual(ancestorsOf('a/b/c.js'), ['a', 'a/b'])
  assert.deepEqual(ancestorsOf('top.md'), [])
  assert.deepEqual(ancestorsOf(''), [])
  assert.deepEqual(ancestorsOf('a\\b\\c.js'), ['a', 'a/b'])
})

const dir = (name, path) => ({ name, path, type: 'directory' })
const file = (name, path) => ({ name, path, type: 'file', kind: 'text' })

test('a collapsed tree shows only the root listing', () => {
  const rows = flattenTree({
    expanded: new Set(),
    nodes: new Map([['', { status: 'ready', entries: [dir('lib', 'lib'), file('a.js', 'a.js')] }]]),
  })
  assert.deepEqual(rows.map((row) => [row.key, row.depth, row.expanded]), [['lib', 0, false], ['a.js', 0, false]])
})

test('expanding a directory nests its children one level deeper', () => {
  const rows = flattenTree({
    expanded: new Set(['lib']),
    nodes: new Map([
      ['', { status: 'ready', entries: [dir('lib', 'lib'), file('a.js', 'a.js')] }],
      ['lib', { status: 'ready', entries: [file('core.js', 'lib/core.js')] }],
    ]),
  })
  assert.deepEqual(rows.map((row) => [row.key, row.depth]), [['lib', 0], ['lib/core.js', 1], ['a.js', 0]])
  assert.equal(rows[0].expanded, true)
})

test('a directory expanded before its listing arrives shows a loading row', () => {
  // Without this the tree looks unresponsive while a slow listing is in flight.
  const rows = flattenTree({
    expanded: new Set(['lib']),
    nodes: new Map([
      ['', { status: 'ready', entries: [dir('lib', 'lib')] }],
      ['lib', { status: 'loading' }],
    ]),
  })
  assert.deepEqual(rows.map((row) => [row.kind, row.depth, row.state]), [
    ['entry', 0, undefined],
    ['status', 1, 'loading'],
  ])

  // A never-requested node is treated the same way.
  const unrequested = flattenTree({
    expanded: new Set(['lib']),
    nodes: new Map([['', { status: 'ready', entries: [dir('lib', 'lib')] }]]),
  })
  assert.equal(unrequested[1].state, 'loading')
})

test('failed and empty directories report inline instead of vanishing', () => {
  const rows = flattenTree({
    expanded: new Set(['bad', 'empty']),
    nodes: new Map([
      ['', { status: 'ready', entries: [dir('bad', 'bad'), dir('empty', 'empty')] }],
      ['bad', { status: 'error', error: { code: 'read-failed' } }],
      ['empty', { status: 'ready', entries: [] }],
    ]),
  })
  assert.deepEqual(rows.map((row) => row.state), [undefined, 'error', undefined, 'empty'])
  assert.equal(rows[1].error.code, 'read-failed')
})

test('deep nesting renders fully but is bounded against pathological depth', () => {
  const expanded = new Set()
  const nodes = new Map()
  let path = ''
  for (let depth = 0; depth < 40; depth += 1) {
    const child = path === '' ? `d${depth}` : `${path}/d${depth}`
    nodes.set(path, { status: 'ready', entries: [dir(`d${depth}`, child)] })
    expanded.add(child)
    path = child
  }
  nodes.set(path, { status: 'ready', entries: [] })
  const rows = flattenTree({ expanded, nodes, maxDepth: 8 })
  assert.equal(Math.max(...rows.map((row) => row.depth)), 8)

  const shallow = flattenTree({
    expanded: new Set(['a', 'a/b']),
    nodes: new Map([
      ['', { status: 'ready', entries: [dir('a', 'a')] }],
      ['a', { status: 'ready', entries: [dir('b', 'a/b')] }],
      ['a/b', { status: 'ready', entries: [file('deep.js', 'a/b/deep.js')] }],
    ]),
  })
  assert.deepEqual(shallow.map((row) => [row.key, row.depth]), [['a', 0], ['a/b', 1], ['a/b/deep.js', 2]])
})

test('the root itself shows status when empty or unreadable', () => {
  assert.deepEqual(
    flattenTree({ expanded: new Set(), nodes: new Map([['', { status: 'loading' }]]) }).map((r) => r.state),
    ['loading'],
  )
  assert.deepEqual(
    flattenTree({ expanded: new Set(), nodes: new Map([['', { status: 'ready', entries: [] }]]) }).map((r) => r.state),
    ['empty'],
  )
})
