import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_BYTES,
  WINDOW_LINES,
  baseNameOf,
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
