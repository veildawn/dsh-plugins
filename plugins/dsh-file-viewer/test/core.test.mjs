import assert from 'node:assert/strict'
import test from 'node:test'

import {
  appendMention,
  insertMentionAtCaret,
  MAX_BYTES,
  MAX_DOWNLOAD_BYTES,
  WINDOW_LINES,
  LANGUAGE_CATALOG,
  ancestorsOf,
  baseNameOf,
  contentDispositionFor,
  detectLanguageFromText,
  flattenTree,
  extensionOf,
  formatBytes,
  formatDocTextToMarkdown,
  sanitizeDocHtml,
  isHiddenEntry,
  isSafeRelativePath,
  isTextContent,
  isUtf8TextContent,
  isWholeDocumentKind,
  isKnownLanguage,
  isLanguageIdShaped,
  joinPath,
  kindOf,
  langOf,
  mediaTypeOf,
  normalizeSafePaths,
  parseGitStatus,
  parseGitBranches,
  parseGitCommitDetail,
  parseGitLog,
  parseGitNameStatus,
  parsePatchToDiffs,
  parsePatchToRows,
  rebaseGitPaths,
  commitPathWithinRoot,
  parseGitBranchList,
  revisionOfBranch,
  isCheckoutableBranch,
  parseGitStatusEntries,
  gitStatusBadge,
  groupGitChanges,
  parseUnifiedDiffFiles,
  gitChangeOf,
  GIT_COMMIT_PAGE_MAX,
  GIT_COMMIT_PAGE_SIZE,
  isCandidateRepoDirectory,
  isSafeBranchName,
  isSafeCommitSha,
  normalizeCommitPage,
  normalizeGitPath,
  pathOfActiveTab,
  relativePathWithin,
  resolveLanguage,
  resolveWindow,
  scrollTargetForRow,
  sortEntries,
  splitLines,
  summarizeDiffs,
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
  assert.equal(langOf('src/App.vue'), 'html')
  assert.equal(langOf('src/Page.svelte'), 'html')
  assert.equal(langOf('src/index.astro'), 'html')
  assert.equal(langOf('build.bat'), 'shellscript')
  assert.equal(langOf('start.cmd'), 'shellscript')
  assert.equal(langOf('build.gradle'), 'java')
  assert.equal(langOf('api.proto'), 'cpp')
  assert.equal(langOf('notes.txt'), undefined)
  assert.equal(langOf('photo.png'), undefined)
  // The suffix-based table still says nothing for an unknown suffix — that is
  // exactly the gap the content guess and the picker exist to fill.
  assert.equal(langOf('config.yaml.prod'), undefined)
})

test('the language catalog offers every grammar the highlighter can load', () => {
  const ids = LANGUAGE_CATALOG.map((entry) => entry.id)
  // "plain" is the explicit no-highlighting choice, not a grammar.
  assert.equal(ids[0], 'plain', 'plain leads so "no highlighting" is the first escape hatch')
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique or the select has duplicate options')
  for (const entry of LANGUAGE_CATALOG) {
    assert.equal(typeof entry.label, 'string')
    assert.notEqual(entry.label, '', `${entry.id} needs a label`)
  }
  // Every offered grammar must be a real id: handing shiki an unknown one
  // renders plain text while the UI claims otherwise.
  const grammarIds = ids.filter((id) => id !== 'plain')
  assert.ok(grammarIds.length > 50, 'the catalog should cover the highlighter breadth')
  for (const id of grammarIds) {
    assert.ok(isLanguageIdShaped(id), `${id} must be shaped like an id`)
  }
  // The specific ids the picker is most likely to be used for.
  for (const expected of ['yaml', 'json', 'ini', 'toml', 'dotenv', 'shellscript', 'python', 'typescript']) {
    assert.ok(ids.includes(expected), `${expected} must be selectable`)
  }
})

test('isKnownLanguage accepts catalog ids plus plain and rejects everything else', () => {
  assert.equal(isKnownLanguage('yaml'), true)
  assert.equal(isKnownLanguage('plain'), true)
  // Unknown to the highlighter: must be refused rather than silently ignored.
  assert.equal(isKnownLanguage('constructor'), false)
  assert.equal(isKnownLanguage('__proto__'), false)
  assert.equal(isKnownLanguage('klingon'), false)
  assert.equal(isKnownLanguage(''), false)
  assert.equal(isKnownLanguage(undefined), false)
  assert.equal(isKnownLanguage(null), false)
  assert.equal(isKnownLanguage(42), false)
})

test('isLanguageIdShaped screens junk before it reaches the catalog', () => {
  assert.equal(isLanguageIdShaped('yaml'), true)
  assert.equal(isLanguageIdShaped('system-verilog'), true)
  assert.equal(isLanguageIdShaped('YAML'), false, 'ids are lowercase')
  assert.equal(isLanguageIdShaped('-leading'), false)
  assert.equal(isLanguageIdShaped('has space'), false)
  assert.equal(isLanguageIdShaped('a'.repeat(33)), false, 'absurd length is refused')
  assert.equal(isLanguageIdShaped(undefined), false)
})

test('detectLanguageFromText names a language only on positive evidence', () => {
  // Shebangs are authoritative: the interpreter is named outright.
  assert.equal(detectLanguageFromText('#!/bin/bash\nset -e\n'), 'shellscript')
  assert.equal(detectLanguageFromText('#!/usr/bin/env python3\nimport os\n'), 'python')
  assert.equal(detectLanguageFromText('#!/usr/bin/env node\nconsole.log(1)\n'), 'typescript')
  assert.equal(detectLanguageFromText('#!/usr/bin/env fish\n'), 'fish')
  assert.equal(detectLanguageFromText('#!/usr/bin/env ruby\n'), 'ruby')

  // Declaration-led markup.
  assert.equal(detectLanguageFromText('<?xml version="1.0"?>\n<root/>\n'), 'xml')
  assert.equal(detectLanguageFromText('<!DOCTYPE html>\n<html></html>\n'), 'html')
  assert.equal(detectLanguageFromText('\\documentclass{article}\n'), 'latex')
  assert.equal(detectLanguageFromText('syntax = "proto3";\nmessage Foo {\n  string a = 1;\n}\n'), 'proto')
  assert.equal(detectLanguageFromText('resource "aws_instance" "web" {\n  ami = "x"\n}\n'), 'hcl')
  assert.equal(detectLanguageFromText('query GetUser {\n  user { id }\n}\n'), 'graphql')

  // JSON must actually parse; a truncated sample is not evidence.
  assert.equal(detectLanguageFromText('{"a": 1, "b": [2, 3]}\n'), 'json')
  assert.equal(detectLanguageFromText('{"a": 1, "b": [2, 3'), undefined)

  // Loose key/value shapes.
  assert.equal(detectLanguageFromText('server:\n  port: 8080\nlog:\n  level: info\n'), 'yaml')
  assert.equal(detectLanguageFromText('- one\n- two\n- three\n'), 'yaml')
  assert.equal(detectLanguageFromText('[database]\nhost=localhost\nport=5432\n'), 'ini')
  assert.equal(detectLanguageFromText('name,age,city\nalice,30,nyc\nbob,25,la\n'), 'csv')
  assert.equal(detectLanguageFromText('FROM node:20\nRUN npm ci\nCOPY . .\n'), 'shellscript')
})

test('detectLanguageFromText refuses to guess without evidence', () => {
  // Guessing wrong colours a file misleadingly, so these must stay plain.
  assert.equal(detectLanguageFromText('This is just a note about the deploy.\n'), undefined)
  assert.equal(detectLanguageFromText('hello world\n'), undefined)
  assert.equal(detectLanguageFromText(''), undefined)
  assert.equal(detectLanguageFromText('   \n\n  '), undefined)
  assert.equal(detectLanguageFromText(undefined), undefined)
  assert.equal(detectLanguageFromText(null), undefined)
  // A single `key=value` is far too common to claim as INI.
  assert.equal(detectLanguageFromText('FOO=bar\n'), undefined)
  // Ragged comma-separated text is prose, not CSV.
  assert.equal(detectLanguageFromText('a, b, c\njust one field\nx, y\n'), undefined)
  // JSON braces must not be mistaken for CSV.
  assert.equal(detectLanguageFromText('{"a": 1, "b": 2'), undefined)
})

test('resolveLanguage prefers an override, then the name, then content', () => {
  const yamlText = 'server:\n  port: 8080\nlog:\n  level: info\n'

  // No override, unknown suffix: content decides.
  assert.deepEqual(
    resolveLanguage({ path: 'config.yaml.prod', sample: yamlText }),
    { lang: 'yaml', source: 'content' },
  )
  // A known suffix outranks content: an extension is stronger evidence than a
  // heuristic over the first 8 KB.
  assert.deepEqual(
    resolveLanguage({ path: 'app.py', sample: yamlText }),
    { lang: 'python', source: 'name' },
  )
  // The override outranks both, because it reflects intent.
  assert.deepEqual(
    resolveLanguage({ override: 'ini', path: 'app.py', sample: yamlText }),
    { lang: 'ini', source: 'override' },
  )
  assert.deepEqual(
    resolveLanguage({ override: 'ini', path: 'config.yaml.prod', sample: yamlText }),
    { lang: 'ini', source: 'override' },
  )
  // "plain" is an override that means no highlighting at all.
  assert.deepEqual(
    resolveLanguage({ override: 'plain', path: 'app.py', sample: yamlText }),
    { lang: undefined, source: 'override' },
  )
  // An unvalidated override is ignored, not trusted.
  assert.deepEqual(
    resolveLanguage({ override: '__proto__', path: 'app.py', sample: yamlText }),
    { lang: 'python', source: 'name' },
  )
  assert.deepEqual(
    resolveLanguage({ override: 'klingon', path: 'notes.unknown', sample: 'plain prose\n' }),
    { lang: undefined, source: 'none' },
  )
  // Nothing to go on at all.
  assert.deepEqual(resolveLanguage({}), { lang: undefined, source: 'none' })
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
  assert.equal(kindOf('legacy.doc'), 'doc')
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

test('content disposition keeps non-ASCII names legal for a byte-string header', () => {
  // A raw Chinese name would make the header construction throw, failing every
  // download of `报告.pdf` with a 500.
  const chinese = contentDispositionFor('报告.pdf')
  assert.doesNotThrow(() => new Response(null, { headers: { 'Content-Disposition': chinese } }))
  assert.equal(chinese.includes('报告'), false, 'the plain filename= fallback must stay ASCII')
  assert.match(chinese, /filename\*=UTF-8''%E6%8A%A5%E5%91%8A\.pdf/)

  // The fallback must still name the file when every character is non-ASCII.
  assert.match(contentDispositionFor('报告.pdf'), /filename="[^"]*"/)
  assert.equal(contentDispositionFor('报告.pdf').includes('filename=""'), false)

  // Emoji (astral plane) must not reach the header raw either.
  const emoji = contentDispositionFor('shot-😀.png')
  assert.doesNotThrow(() => new Response(null, { headers: { 'Content-Disposition': emoji } }))

  // A single quote would otherwise be read as the charset/language separator
  // inside `filename*`; the quoted `filename=` fallback may keep it.
  const apostrophe = contentDispositionFor("it's.txt")
  const extPart = apostrophe.slice(apostrophe.indexOf("filename*="))
  assert.equal(extPart.includes("it's"), false)
  assert.match(extPart, /it%27s\.txt/)
  assert.match(apostrophe, /filename="it's\.txt"/)

  // CR/LF would end the header instead of appearing in it.
  const injected = contentDispositionFor('evil\r\nX-Injected: 1.txt')
  assert.doesNotThrow(() => new Response(null, { headers: { 'Content-Disposition': injected } }))
  assert.equal(/[\r\n]/.test(injected), false)

  // Ordinary ASCII names stay readable in the fallback.
  assert.match(contentDispositionFor('report.pdf'), /filename="report\.pdf"/)
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
  assert.equal(isSafeRelativePath('~/secrets'), false)
  assert.equal(isSafeRelativePath('~'), false)
  assert.equal(isSafeRelativePath('~\\docs'), false)

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
  assert.equal(formatBytes(MAX_DOWNLOAD_BYTES), '100 MB')
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

test('the tree highlights the file of the active tab, whatever it is doing', () => {
  const tabs = [
    { id: 'file:src/a.ts', kind: 'file', path: 'src/a.ts', meta: null },
    { id: 'file:src/b.ts', kind: 'file', path: 'src/b.ts', meta: null },
  ]
  // The tab on screen is the one the tree marks. `meta` is still null on both
  // — the reads are in flight — and that must not matter: the highlight is a
  // fact about the tab, not about how far its file read has got.
  assert.equal(pathOfActiveTab(tabs, 'file:src/b.ts'), 'src/b.ts')
  // Closing the active tab moves the highlight with the survivor.
  assert.equal(pathOfActiveTab(tabs.slice(0, 1), 'file:src/a.ts'), 'src/a.ts')
  // No tabs at all: nothing is open, so nothing is highlighted.
  assert.equal(pathOfActiveTab(null, ''), '')
  assert.equal(pathOfActiveTab([], ''), '')
  // An id that names no tab is not a path (a tab closed between render and
  // effect must not leave a stale highlight behind).
  assert.equal(pathOfActiveTab(tabs, 'file:gone.ts'), '')
  assert.equal(pathOfActiveTab(tabs, ''), '')

  // Commit and change tabs are not files: their rows do not exist in the tree,
  // and highlighting a change would claim the reader sees the file rather than
  // its patch.
  assert.equal(pathOfActiveTab([{ id: 'commit:abc123', kind: 'commit', path: 'src/a.ts' }], 'commit:abc123'), '')
  assert.equal(pathOfActiveTab([{ id: 'change:src/a.ts', kind: 'change', path: 'src/a.ts' }], 'change:src/a.ts'), '')
  // A file tab read from history has the same shape as a working-tree tab, so
  // the commit hash is what keeps it from marking a row it does not describe.
  assert.equal(
    pathOfActiveTab([{ id: 'file:src/a.ts@abc123', kind: 'file', path: 'src/a.ts', commit: 'abc123' }], 'file:src/a.ts@abc123'),
    '',
  )
  // A malformed row cannot throw the drawer.
  assert.equal(pathOfActiveTab([{ id: 'file:x.ts', kind: 'file' }], 'file:x.ts'), '')
  assert.equal(pathOfActiveTab([null], 'file:x.ts'), '')
})

test('revealing a row scrolls only when it is off screen', () => {
  // A tree 200px tall whose scroller is at the top. The viewport-relative
  // coordinates are what `getBoundingClientRect` reports: the host starts at
  // y=100 in the page, so a row is visible when it sits within 100..300.
  const host = { hostTop: 100, hostHeight: 200, scrollTop: 0 }

  // Fully visible: nothing to do. A no-op is the important case — scrolling a
  // row that is already on screen fights a reader who scrolled deliberately.
  assert.equal(scrollTargetForRow({ ...host, rowTop: 150, rowHeight: 32 }), null)
  // Flush with both edges is still visible.
  assert.equal(scrollTargetForRow({ ...host, rowTop: 100, rowHeight: 200 }), null)

  // Below the fold: scroll down, centring the row. The row starts 300px below
  // the host's top and the viewport is 200px, so it is 300px from the top of
  // the visible area; centring a 32px row leaves (200 - 32) / 2 = 84px above it.
  assert.equal(scrollTargetForRow({ ...host, rowTop: 400, rowHeight: 32 }), 300 - 84)
  // Above the fold: scroll back up, and never past the start.
  assert.equal(scrollTargetForRow({ ...host, scrollTop: 500, rowTop: 60, rowHeight: 32 }), 500 - 40 - 84)
  assert.equal(scrollTargetForRow({ ...host, rowTop: 40, rowHeight: 32 }), 0)

  // Garbage in must not produce NaN or a negative offset: the tree would either
  // jump to an undefined position or refuse to move at all.
  assert.equal(scrollTargetForRow({}), null)
  assert.equal(scrollTargetForRow({ hostHeight: 200, rowTop: 400, rowHeight: 32, hostTop: 100 }), 216)
  assert.equal(scrollTargetForRow({ hostHeight: 0, hostTop: 0, rowTop: 10, rowHeight: 0, scrollTop: 0 }), 10)
})

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

test('isTextContent detects null bytes as binary', () => {
  // Empty buffer is text.
  assert.equal(isTextContent(new Uint8Array(0)), true)
  // Null buffer is text.
  assert.equal(isTextContent(null), true)
  assert.equal(isTextContent(undefined), true)

  // ASCII text: no null bytes.
  const text = new Uint8Array([72, 101, 108, 108, 111, 10, 119, 111, 114, 108, 100])
  assert.equal(isTextContent(text), true)

  // Single null byte makes it binary.
  const withNull = new Uint8Array([72, 101, 108, 108, 111, 0, 119, 111, 114, 108, 100])
  assert.equal(isTextContent(withNull), false)

  // Null at the very start.
  const nullStart = new Uint8Array([0, 72, 105])
  assert.equal(isTextContent(nullStart), false)

  // Null at position 8191 (the limit boundary).
  const atBoundary = new Uint8Array(8192)
  atBoundary.fill(65)
  atBoundary[8191] = 0
  assert.equal(isTextContent(atBoundary), false)

  // Null past the 8192 limit is not checked.
  const pastLimit = new Uint8Array(9000)
  pastLimit.fill(65)
  pastLimit[8192] = 0
  assert.equal(isTextContent(pastLimit), true)

  // UTF-8 text with multi-byte sequences.
  const utf8 = new Uint8Array([72, 101, 108, 108, 111, 32, 240, 159, 140, 142, 33])
  assert.equal(isTextContent(utf8), true)
})

test('isUtf8TextContent accepts text and rejects bytes that cannot decode', () => {
  // Empty and null samples carry no evidence of binary.
  assert.equal(isUtf8TextContent(new Uint8Array(0)), true)
  assert.equal(isUtf8TextContent(null), true)
  assert.equal(isUtf8TextContent(undefined), true)

  // Plain ASCII and multi-byte UTF-8 both decode.
  assert.equal(isUtf8TextContent(new Uint8Array([72, 105, 10])), true)
  assert.equal(isUtf8TextContent(new Uint8Array([0xe4, 0xb8, 0xad, 0xe6, 0x96, 0x87])), true)

  // A multi-byte character truncated by the sample boundary is held back by
  // streaming decode rather than reported malformed — a truncated probe is
  // not evidence of a non-text file.
  assert.equal(isUtf8TextContent(new Uint8Array([0x41, 0xe4, 0xb8])), true)

  // Genuinely invalid sequences are rejected: GBK bytes, a lone continuation
  // byte, and an overlong-looking stray lead byte.
  assert.equal(isUtf8TextContent(new Uint8Array([0xc5, 0xe4, 0xd6, 0xc3])), false)
  assert.equal(isUtf8TextContent(new Uint8Array([0x41, 0x80, 0x42])), false)
  assert.equal(isUtf8TextContent(new Uint8Array([0xff, 0xfe])), false)
})

test('appendMention appends a file reference to the draft', () => {
  // Empty draft: the reference plus a trailing space, ready to keep typing.
  assert.equal(appendMention('', 'src/index.js'), '@src/index.js ')

  // Never joins onto the previous word.
  assert.equal(appendMention('看看这个', 'a/b.txt'), '看看这个 @a/b.txt ')

  // Already spaced: no double space, so several references can follow.
  assert.equal(appendMention('前文 ', 'a.txt'), '前文 @a.txt ')
  assert.equal(appendMention(appendMention('', 'a.txt'), 'b.txt'), '@a.txt @b.txt ')

  // Whitespace in a path needs quoting or the agent cannot see where it ends.
  assert.equal(appendMention('', 'my docs/note.md'), '@`my docs/note.md` ')

  // Backticks inside a path would break out of the quoting.
  assert.equal(appendMention('', 'we`ird name/x.txt'), '@`weird name/x.txt` ')

  // A folder is referenced the same way.
  assert.equal(appendMention('', 'src/lib'), '@src/lib ')

  // Nothing to reference leaves the draft untouched.
  assert.equal(appendMention('保留', ''), '保留')
  assert.equal(appendMention('保留', '   '), '保留')
  assert.equal(appendMention(undefined, 'a.txt'), '@a.txt ')
})

test('insertMentionAtCaret inserts reference at caret position without clobbering', () => {
  // Empty text defaults to reference plus trailing space
  assert.equal(insertMentionAtCaret('', 'src/index.js'), '@src/index.js ')

  // Insertion at end behaves like appendMention
  assert.equal(insertMentionAtCaret('请看这个', 'a/b.txt'), '请看这个 @a/b.txt ')
  assert.equal(insertMentionAtCaret('请看这个', 'a/b.txt', 4), '请看这个 @a/b.txt ')

  // Insertion in the middle: preserves text before and after caret
  assert.equal(
    insertMentionAtCaret('请查看这个文件再继续', 'src/test.ts', 5),
    '请查看这个 @src/test.ts 文件再继续',
  )

  // Insertion at the very beginning (caret 0)
  assert.equal(
    insertMentionAtCaret('请分析逻辑', 'main.go', 0),
    '@main.go 请分析逻辑',
  )

  // Automatic spacing around insertion
  assert.equal(
    insertMentionAtCaret('前缀 后缀', 'a.txt', 3),
    '前缀 @a.txt 后缀',
  )

  // Spacing already present before and after
  assert.equal(
    insertMentionAtCaret('前缀  后缀', 'a.txt', 3),
    '前缀 @a.txt 后缀',
  )

  // Quoting paths with spaces
  assert.equal(
    insertMentionAtCaret('分析代码：', 'my docs/spec.md', 5),
    '分析代码： @`my docs/spec.md` ',
  )

  // Empty or invalid paths leave original text completely intact
  assert.equal(insertMentionAtCaret('原有珍贵内容', '', 2), '原有珍贵内容')
  assert.equal(insertMentionAtCaret('原有珍贵内容', '   ', 2), '原有珍贵内容')
  assert.equal(insertMentionAtCaret('原有珍贵内容', undefined, 2), '原有珍贵内容')

  // Out of bounds caret clamps gracefully to text boundaries
  assert.equal(insertMentionAtCaret('测试', 'a.txt', -10), '@a.txt 测试')
  assert.equal(insertMentionAtCaret('测试', 'a.txt', 999), '测试 @a.txt ')
})

test('parsePatchToDiffs converts unified diff into DiffBlock hunks and calculates stats', () => {
  assert.deepEqual(parsePatchToDiffs('', 'a.js'), [])
  assert.deepEqual(parsePatchToDiffs('   ', 'a.js'), [])

  const patch = `diff --git a/a.js b/a.js
index 123..456 100644
--- a/a.js
+++ b/a.js
@@ -1,4 +1,5 @@
 context 1
-old line 1
-old line 2
+new line 1
+new line 2
+new line 3
 context 2
@@ -20,2 +21,1 @@
-removed line
+added line
`

  const diffs = parsePatchToDiffs(patch, 'src/a.js')
  assert.equal(diffs.length, 2)
  assert.equal(diffs[0].path, 'src/a.js')
  assert.equal(diffs[0].oldText, 'old line 1\nold line 2')
  assert.equal(diffs[0].newText, 'new line 1\nnew line 2\nnew line 3')

  assert.equal(diffs[1].path, 'src/a.js')
  assert.equal(diffs[1].oldText, 'removed line')
  assert.equal(diffs[1].newText, 'added line')

  const summary = summarizeDiffs(diffs)
  assert.equal(summary.added, 4)
  assert.equal(summary.removed, 3)
})

test('parseGitStatus extracts modified and untracked file paths from porcelain output', () => {
  assert.deepEqual(parseGitStatus(''), { modified: [], untracked: [] })

  const porcelain = ` M plugins/dsh-file-viewer/lib/client.js
M  plugins/dsh-file-viewer/package.json
?? new-file.txt
?? "file with spaces.md"
 D deleted.js
`

  const status = parseGitStatus(porcelain)
  assert.deepEqual(status.modified, [
    'plugins/dsh-file-viewer/lib/client.js',
    'plugins/dsh-file-viewer/package.json',
    'deleted.js',
  ])
  assert.deepEqual(status.untracked, [
    'new-file.txt',
    'file with spaces.md',
  ])
})

test('rebaseGitPaths converts repo-relative paths onto the selected root', () => {
  // Selected root IS the repository root: paths pass through unchanged.
  assert.deepEqual(
    rebaseGitPaths(['plugins/dsh-file-viewer/lib/client.js', 'src/index.ts'], ''),
    ['plugins/dsh-file-viewer/lib/client.js', 'src/index.ts'],
  )

  // Selected root is a repo subdirectory: strip the repo-relative prefix.
  assert.deepEqual(
    rebaseGitPaths(['plugins/dsh-file-viewer/lib/client.js', 'plugins/dsh-file-viewer/package.json'], 'plugins/dsh-file-viewer'),
    ['lib/client.js', 'package.json'],
  )

  // Paths outside the selected root are dropped to keep badges honest.
  assert.deepEqual(
    rebaseGitPaths(['plugins/dsh-file-viewer/lib/client.js', 'other/pkg/x.ts'], 'plugins/dsh-file-viewer'),
    ['lib/client.js'],
  )

  // The selected root itself is not listed.
  assert.deepEqual(rebaseGitPaths(['plugins/dsh-file-viewer'], 'plugins/dsh-file-viewer'), [])

  // Windows backslashes are normalized.
  assert.deepEqual(rebaseGitPaths(['plugins\\dsh-file-viewer\\lib\\client.js'], 'plugins/dsh-file-viewer'), ['lib/client.js'])
})

test('normalizeSafePaths converts various formats into structured path-label records', () => {
  // Array of plain strings
  assert.deepEqual(normalizeSafePaths(['/opt/data', 'D:/Notes']), [
    { path: '/opt/data', label: '' },
    { path: 'D:/Notes', label: '' },
  ])

  // Array of objects with label or name
  assert.deepEqual(normalizeSafePaths([
    { path: '/opt/data', label: '数据目录' },
    { path: 'D:/Notes', name: '笔记目录' },
    { path: '/var/log' },
  ]), [
    { path: '/opt/data', label: '数据目录' },
    { path: 'D:/Notes', label: '笔记目录' },
    { path: '/var/log', label: '' },
  ])

  // Delimited strings (comma and newline separated)
  assert.deepEqual(normalizeSafePaths('/opt/data, /var/log; D:/Notes'), [
    { path: '/opt/data', label: '' },
    { path: '/var/log', label: '' },
    { path: 'D:/Notes', label: '' },
  ])
  assert.deepEqual(normalizeSafePaths('/opt/data\n/var/log\r\nD:/Notes'), [
    { path: '/opt/data', label: '' },
    { path: '/var/log', label: '' },
    { path: 'D:/Notes', label: '' },
  ])

  // Filters empty, whitespace, and non-string paths
  assert.deepEqual(normalizeSafePaths(['', '   ', null, undefined, 123, { path: '  ' }, { path: '/valid' }]), [
    { path: '/valid', label: '' },
  ])
  assert.deepEqual(normalizeSafePaths(null), [])
  assert.deepEqual(normalizeSafePaths(undefined), [])
  assert.deepEqual(normalizeSafePaths(''), [])
  assert.deepEqual(normalizeSafePaths(['~', '~/downloads'], '/home/testuser'), [
    { path: '/home/testuser', label: '' },
    { path: '/home/testuser/downloads', label: '' },
  ])
})

test('joinPath and baseNameOf handle root slash cleanly', () => {
  assert.equal(baseNameOf('/'), '/')
  assert.equal(baseNameOf('\\'), '/')
  assert.equal(joinPath('/', ''), '/')
  assert.equal(joinPath('/', 'etc'), '/etc')
  assert.equal(joinPath('/', '/etc/nginx'), '/etc/nginx')
  assert.equal(joinPath('/', 'var/log/syslog'), '/var/log/syslog')
})

test('formatDocTextToMarkdown converts raw document text into structured Markdown', () => {
  const raw = [
    '项目技术规格与实施方案',
    '目录',
    '第一章 项目概述\t3',
    '1.1 建设目标\t3',
    '第二章 方案设计\t6',
    '第一章 项目概述',
    '1.1 建设目标',
    '按照国家相关标准建设高可用云平台。',
    '采用先进微服务架构设计。',
    '（1）高可用性',
    '系统保证 99.99% 的在线率。',
    '服务器选型\t数量\t单价',
    '计算节点\t8\t10000',
    '存储节点\t4\t20000',
  ].join('\n')

  const md = formatDocTextToMarkdown(raw)

  // 1. Document title
  assert.match(md, /# 项目技术规格与实施方案/)

  // 2. TOC list
  assert.match(md, /## 目录/)
  assert.match(md, /- \*\*第一章 项目概述\*\* \.{10,} \*第 3 页\*/)

  // 3. Chapter and section hierarchy
  assert.match(md, /## 第一章 项目概述/)
  assert.match(md, /### 1.1 建设目标/)

  // 4. Bullet points and paragraphs
  assert.match(md, /\*\*（1）高可用性\*\*/)
  assert.match(md, /系统保证 99\.99% 的在线率。/)

  // 5. Table converted with header and separator
  assert.match(md, /\| 服务器选型 \| 数量 \| 单价 \|/)
  assert.match(md, /\| --- \| --- \| --- \|/)
  assert.match(md, /\| 计算节点 \| 8 \| 10000 \|/)
})

test('sanitizeDocHtml removes script and iframe tags while keeping tables and images', () => {
  const dirtyHtml = '<p>安全正文</p><script>alert(1)</script><iframe src="evil.html"></iframe><table><tr><td>表格内容</td></tr></table><img src="data:image/png;base64,123" /><a href="javascript:evil()">链接</a>'
  const clean = sanitizeDocHtml(dirtyHtml)
  assert.equal(clean.includes('<script>'), false)
  assert.equal(clean.includes('<iframe>'), false)
  assert.equal(clean.includes('javascript:'), false)
  assert.equal(clean.includes('<table><tr><td>表格内容</td></tr></table>'), true)
  assert.equal(clean.includes('<img src="data:image/png;base64,123" />'), true)
})

test('parsePatchToRows parses patch and untracked text into line-numbered rows', () => {
  // 1. Untracked file test
  const untrackedRows = parsePatchToRows('', 'line one\nline two\nline three')
  assert.equal(untrackedRows.length, 3)
  assert.equal(untrackedRows[0].type, 'add')
  assert.equal(untrackedRows[0].oldLine, null)
  assert.equal(untrackedRows[0].newLine, 1)
  assert.equal(untrackedRows[2].newLine, 3)

  // 2. Patch with hunks test
  const patch = [
    '@@ -10,3 +10,4 @@ header text',
    ' context line',
    '-old line',
    '+new line 1',
    '+new line 2',
  ].join('\n')
  const rows = parsePatchToRows(patch)
  assert.equal(rows.length, 5)
  assert.equal(rows[0].type, 'hunk')
  assert.equal(rows[1].type, 'normal')
  assert.equal(rows[1].oldLine, 10)
  assert.equal(rows[1].newLine, 10)
  assert.equal(rows[2].type, 'del')
  assert.equal(rows[2].oldLine, 11)
  assert.equal(rows[2].newLine, null)
  assert.equal(rows[3].type, 'add')
  assert.equal(rows[3].oldLine, null)
  assert.equal(rows[3].newLine, 11)
  assert.equal(rows[4].newLine, 12)
})





/* -------------------------------------------------------------------------- *
 * Git panel
 *
 * The host asks git for machine-readable output (`--format` with unit and
 * record separators, `-z` name-status), so these parsers only have to handle
 * the shapes git actually prints. The cases below are real output shapes,
 * including the ones that are easy to misread: quoted non-ASCII paths, a rename
 * carrying two paths, and a message body containing newlines.
 * -------------------------------------------------------------------------- */

test('branch names are validated as refs before they reach git', () => {
  for (const name of ['main', 'feature/git-panel', 'release-1.2', 'v1.0.0-rc.1']) {
    assert.equal(isSafeBranchName(name), true, `${name} must be accepted`)
  }
  // A leading dash would be parsed by git as an option, which is the one case
  // that turns a data value into command-line syntax.
  for (const name of ['-D', '--exec=rm -rf /', 'a..b', 'a b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[', 'a\\b',
    '/main', 'main/', '.main', 'a/.hidden', 'main.lock', 'a@{1}', 'a//b', '', 'HEAD~1']) {
    assert.equal(isSafeBranchName(name), false, `${JSON.stringify(name)} must be refused`)
  }
  assert.equal(isSafeBranchName(undefined), false)
  assert.equal(isSafeBranchName(42), false)
})

test('only concrete hex commit ids are accepted, never revision expressions', () => {
  assert.equal(isSafeCommitSha('a'.repeat(40)), true)
  assert.equal(isSafeCommitSha('0123456'), true)
  assert.equal(isSafeCommitSha('abc1234def'), true)
  for (const value of ['abc', 'HEAD', 'main', 'A'.repeat(40), 'a'.repeat(41), 'abc1234~1', '', undefined, 7]) {
    assert.equal(isSafeCommitSha(value), false, `${JSON.stringify(value)} must be refused`)
  }
})

test('a commit page is clamped onto the supported window', () => {
  const defaults = normalizeCommitPage({})
  assert.equal(defaults.offset, 0)
  assert.equal(defaults.limit, GIT_COMMIT_PAGE_SIZE)

  // A forged page cannot pull all of history or page backwards.
  assert.equal(normalizeCommitPage({ limit: 100000 }).limit, GIT_COMMIT_PAGE_MAX)
  assert.equal(normalizeCommitPage({ offset: -5 }).offset, 0)
  assert.equal(normalizeCommitPage({ limit: 0 }).limit, GIT_COMMIT_PAGE_SIZE)
  assert.deepEqual(normalizeCommitPage({ offset: 60, limit: 20 }), { offset: 60, limit: 20 })
})

test('git paths normalize for comparison without losing a drive letter', () => {
  assert.equal(normalizeGitPath('D:\\repo\\sub\\'), 'D:/repo/sub')
  assert.equal(normalizeGitPath('/repo/sub/'), '/repo/sub')
  assert.equal(normalizeGitPath('.'), '')
  assert.equal(normalizeGitPath(undefined), '')
})

test('relativePathWithin distinguishes equal, nested and unrelated paths', () => {
  assert.equal(relativePathWithin('/repo', '/repo'), '')
  assert.equal(relativePathWithin('/repo/', '/repo/src'), 'src')
  assert.equal(relativePathWithin('/repo', '/repo/src/app'), 'src/app')
  assert.equal(relativePathWithin('/repo', '/repository'), null)
  assert.equal(relativePathWithin('/repo/src', '/repo'), null)
  assert.equal(relativePathWithin('', '/repo'), null)
})

test('only plausible subdirectories are probed for their own checkout', () => {
  assert.equal(isCandidateRepoDirectory('packages'), true)
  assert.equal(isCandidateRepoDirectory('dsh-plugins'), true)
  // Dot directories are skipped in the tree already, and a dependency cache
  // never holds a checkout worth spending a git process on.
  assert.equal(isCandidateRepoDirectory('.git'), false)
  assert.equal(isCandidateRepoDirectory('.cache'), false)
  assert.equal(isCandidateRepoDirectory('node_modules'), false)
  assert.equal(isCandidateRepoDirectory(''), false)
  assert.equal(isCandidateRepoDirectory(undefined), false)
})

test('branch listing keeps the current marker, tip and upstream apart', () => {
  const stdout = [
    '*\tmain\ta1b2c3d\t2024-05-01T12:00:00+08:00\torigin/main',
    ' \tfeature/git-panel\te4f5a6b\t2024-04-28T09:30:00+08:00\t',
    ' \trelease-1.2\t0c1d2e3\t2024-04-01T18:00:00+08:00\torigin/release-1.2',
  ].join('\n')
  const branches = parseGitBranches(stdout)
  assert.equal(branches.length, 3)
  assert.deepEqual(branches[0], {
    name: 'main', current: true, sha: 'a1b2c3d', date: '2024-05-01T12:00:00+08:00', upstream: 'origin/main',
  })
  assert.equal(branches[1].current, false)
  assert.equal(branches[1].upstream, '')
  assert.equal(branches[2].name, 'release-1.2')

  // An empty repository prints nothing at all.
  assert.deepEqual(parseGitBranches(''), [])
  assert.deepEqual(parseGitBranches('   \n'), [])
  assert.deepEqual(parseGitBranches(undefined), [])
})

test('commit log records survive a subject containing the separators', () => {
  const unit = '\x1f'
  const record = '\x1e'
  const stdout = [
    `a1b2c3d4e5f6${unit}a1b2c3d${unit}张三${unit}zhang@example.com${unit}2024-05-01T12:00:00+08:00${unit}2024-05-01T12:00:05+08:00${unit}修复：文件路径分隔符${record}`,
    `\n0c1d2e3f4a5b${unit}0c1d2e3${unit}Li Si${unit}li@example.com${unit}2024-04-30T08:00:00+08:00${unit}2024-04-30T08:00:01+08:00${unit}feat: add${unit}panel${record}`,
  ].join('')

  const commits = parseGitLog(stdout)
  assert.equal(commits.length, 2)
  assert.equal(commits[0].sha, 'a1b2c3d4e5f6')
  assert.equal(commits[0].shortSha, 'a1b2c3d')
  assert.equal(commits[0].author, '张三')
  assert.equal(commits[0].authorEmail, 'zhang@example.com')
  assert.equal(commits[0].subject, '修复：文件路径分隔符')
  // A stray unit separator inside the subject is field content, not a new field.
  assert.equal(commits[1].subject, 'feat: add\x1fpanel')

  // Records that are not commits are dropped rather than rendered as blanks.
  assert.deepEqual(parseGitLog('garbage\n'), [])
  assert.deepEqual(parseGitLog(''), [])
})

test('one commit detail carries its message body and metadata', () => {
  const unit = '\x1f'
  const stdout = `a1b2c3d4${unit}a1b2c3d${unit}张三${unit}zhang@example.com${unit}2024-05-01T12:00:00+08:00${unit}2024-05-01T12:00:05+08:00${unit}标题行${unit}标题行\n\n正文第一段\n正文第二段\x1e\n`
  const parsed = parseGitCommitDetail(stdout)
  assert.notEqual(parsed, null)
  assert.equal(parsed.commit.subject, '标题行')
  assert.equal(parsed.body, '标题行\n\n正文第一段\n正文第二段')
  assert.equal(parsed.commit.authoredAt, '2024-05-01T12:00:00+08:00')

  assert.equal(parseGitCommitDetail(''), null)
  assert.equal(parseGitCommitDetail(undefined), null)
})

test('name-status parsing handles every change kind and both path shapes', () => {
  const stdout = [
    'M', 'src/app.ts', '',
    'A', 'docs/新文件.md', '',
    'D', 'legacy/old.js', '',
    'R100', 'src/before.ts', 'src/after.ts', '',
    'C075', 'src/a.ts', 'src/a-copy.ts', '',
  ].join('\0')

  const changes = parseGitNameStatus(stdout)
  assert.equal(changes.length, 5)
  assert.deepEqual(changes[0], { status: 'M', oldPath: null, path: 'src/app.ts' })
  assert.deepEqual(changes[1], { status: 'A', oldPath: null, path: 'docs/新文件.md' })
  assert.deepEqual(changes[3], { status: 'R100', oldPath: 'src/before.ts', path: 'src/after.ts' })
  assert.deepEqual(changes[4], { status: 'C075', oldPath: 'src/a.ts', path: 'src/a-copy.ts' })

  assert.deepEqual(parseGitNameStatus(''), [])
  assert.deepEqual(parseGitNameStatus(undefined), [])
})

test('a change code maps to one badge with a tone', () => {
  assert.deepEqual(gitChangeOf('A'), { letter: 'A', label: '新增', tone: 'add' })
  assert.deepEqual(gitChangeOf('M'), { letter: 'M', label: '修改', tone: 'mod' })
  assert.deepEqual(gitChangeOf('D'), { letter: 'D', label: '删除', tone: 'del' })
  assert.equal(gitChangeOf('R100').label, '重命名')
  assert.equal(gitChangeOf('C075').letter, 'C')
  // An unknown code still renders as a change rather than disappearing.
  assert.deepEqual(gitChangeOf('Z'), { letter: 'Z', label: '变更', tone: 'mod' })
  assert.deepEqual(gitChangeOf(undefined), { letter: '?', label: '变更', tone: 'mod' })
})

test('a changed path is rebased onto the root for both placements', () => {
  // The repository is a subdirectory of the root.
  assert.deepEqual(commitPathWithinRoot({ prefix: 'packages/app', rootRelative: '' }, 'src/index.ts'), {
    path: 'packages/app/src/index.ts', outsideRoot: false,
  })

  // The root is a subdirectory of the repository: only the files below it can
  // be opened, and the rest are reported rather than dropped silently.
  assert.deepEqual(commitPathWithinRoot({ prefix: '', rootRelative: 'sub/dir' }, 'sub/dir/a.ts'), {
    path: 'a.ts', outsideRoot: false,
  })
  assert.deepEqual(commitPathWithinRoot({ prefix: '', rootRelative: 'sub/dir' }, 'docs/readme.md'), {
    path: 'docs/readme.md', outsideRoot: true,
  })

  // The root is the checkout itself.
  assert.deepEqual(commitPathWithinRoot({ prefix: '', rootRelative: '' }, 'src/app.ts'), {
    path: 'src/app.ts', outsideRoot: false,
  })
})

/* -------------------------------------------------------------------------- *
 * Remote branches, working-tree changes, commit diffs
 * -------------------------------------------------------------------------- */

test('branch listing separates local and remote refs and drops origin/HEAD', () => {
  const stdout = [
    '*\trefs/heads/main\tmain\ta1b2c3d\t2024-05-01T12:00:00+08:00\torigin/main',
    ' \trefs/heads/dev\tdev\te4f5a6b\t2024-04-28T09:30:00+08:00\t',
    ' \trefs/remotes/origin/main\torigin/main\t0c1d2e3\t2024-04-01T18:00:00+08:00\t',
    ' \trefs/remotes/origin/feature/x\torigin/feature/x\t9a8b7c6\t2024-03-01T10:00:00+08:00\t',
    ' \trefs/remotes/origin/HEAD\torigin/HEAD\t0c1d2e3\t\t',
  ].join('\n')

  const branches = parseGitBranchList(stdout)
  assert.equal(branches.length, 4, 'origin/HEAD is a pointer, not a branch')
  assert.deepEqual(branches.map((b) => b.kind), ['local', 'local', 'remote', 'remote'])
  assert.equal(branches[0].current, true)
  assert.equal(branches[2].shortName, 'origin/main')
  assert.equal(branches[2].remote, 'origin')
  // A remote branch whose name contains a slash keeps the full remainder.
  assert.equal(branches[3].remote, 'origin')
  assert.equal(branches[3].name, 'refs/remotes/origin/feature/x')
  assert.equal(branches[3].shortName, 'origin/feature/x')

  assert.deepEqual(parseGitBranchList(''), [])
  assert.deepEqual(parseGitBranchList(undefined), [])
})

test('a branch ref maps to the revision git should read', () => {
  // A local branch is already unambiguous.
  assert.equal(revisionOfBranch({ name: 'refs/heads/main', kind: 'local' }), 'refs/heads/main')
  // A remote branch is not on the branch namespace, so it must stay qualified.
  assert.equal(
    revisionOfBranch({ name: 'refs/remotes/origin/main', kind: 'remote' }),
    'refs/remotes/origin/main',
  )
  // A remote short name is expanded back onto its namespace.
  assert.equal(
    revisionOfBranch({ name: 'origin/main', kind: 'remote' }),
    'refs/remotes/origin/main',
  )
  assert.equal(revisionOfBranch({ name: '' }), '')
  assert.equal(revisionOfBranch(undefined), '')
})

test('only local branches are checkoutable', () => {
  assert.equal(isCheckoutableBranch({ kind: 'local' }), true)
  assert.equal(isCheckoutableBranch({ kind: 'remote' }), false)
  // An unknown kind is treated as local, which is the conservative default for
  // a value that came from discovery rather than from a reader.
  assert.equal(isCheckoutableBranch({}), true)
  assert.equal(isCheckoutableBranch(undefined), true)
})

test('porcelain -z status keeps staged, unstaged, untracked and renames apart', () => {
  const stdout = [
    'M  staged.txt', '',        // staged modification
    ' M worktree.txt', '',      // unstaged modification
    'MM both.txt', '',          // staged and then edited again
    '?? new.txt', '',           // untracked
    'A  added.txt', '',         // staged addition
    'D  deleted.txt', '',       // staged deletion
    'R  renamed-new.txt', 'renamed-old.txt', '',  // rename: two paths
    'UU conflicted.txt', '',    // conflict
  ].join('\0')

  const entries = parseGitStatusEntries(stdout)
  assert.equal(entries.length, 8)

  const byPath = new Map(entries.map((entry) => [entry.path, entry]))
  assert.equal(byPath.get('staged.txt').staged, true)
  assert.equal(byPath.get('staged.txt').worktree, ' ')
  assert.equal(byPath.get('worktree.txt').staged, false)
  assert.equal(byPath.get('worktree.txt').worktree, 'M')
  assert.equal(byPath.get('both.txt').staged, true)
  assert.equal(byPath.get('both.txt').worktree, 'M')
  assert.equal(byPath.get('new.txt').untracked, true)
  assert.equal(byPath.get('added.txt').index, 'A')
  assert.equal(byPath.get('deleted.txt').index, 'D')
  // A rename carries the original path, NUL-separated, so no quoting is needed.
  assert.equal(byPath.get('renamed-new.txt').oldPath, 'renamed-old.txt')
  assert.equal(byPath.get('renamed-new.txt').index, 'R')
  assert.equal(byPath.get('conflicted.txt').conflicted, true)

  assert.deepEqual(parseGitStatusEntries(''), [])
})

test('a status record maps to one badge', () => {
  assert.deepEqual(gitStatusBadge({ index: 'A', worktree: ' ' }), { letter: 'A', label: '新增', tone: 'add' })
  assert.deepEqual(gitStatusBadge({ index: 'M', worktree: ' ' }), { letter: 'M', label: '修改', tone: 'mod' })
  assert.deepEqual(gitStatusBadge({ index: 'D', worktree: ' ' }), { letter: 'D', label: '删除', tone: 'del' })
  assert.deepEqual(gitStatusBadge({ index: 'R', worktree: ' ' }), { letter: 'R', label: '重命名', tone: 'mod' })
  assert.deepEqual(gitStatusBadge({ index: '?', worktree: '?', untracked: true }), { letter: '?', label: '未跟踪', tone: 'add' })
  assert.deepEqual(gitStatusBadge({ conflicted: true }), { letter: 'U', label: '冲突', tone: 'del' })
  // Staged as a modification but not yet edited again: the index side wins.
  assert.equal(gitStatusBadge({ index: 'M', worktree: 'M' }).letter, 'M')
  // Only a working-tree change still reports something.
  assert.equal(gitStatusBadge({ index: ' ', worktree: 'M' }).letter, 'M')
})

test('working-tree changes group by staged state and drop what is outside', () => {
  const changes = [
    { path: 'a.txt', repoPath: 'a.txt', index: 'M', worktree: ' ', staged: true, untracked: false, ignored: false, conflicted: false },
    { path: 'b.txt', repoPath: 'b.txt', index: ' ', worktree: 'M', staged: false, untracked: false, ignored: false, conflicted: false },
    { path: 'c.txt', repoPath: 'c.txt', index: 'M', worktree: 'M', staged: true, untracked: false, ignored: false, conflicted: false },
    { path: 'd.txt', repoPath: 'd.txt', index: '?', worktree: '?', staged: false, untracked: true, ignored: false, conflicted: false },
    { path: 'e.txt', repoPath: 'e.txt', index: 'U', worktree: 'U', staged: false, untracked: false, ignored: false, conflicted: true },
    { path: 'skip.txt', repoPath: 'skip.txt', index: '!', worktree: '!', staged: false, untracked: false, ignored: true, conflicted: false },
  ]
  const groups = groupGitChanges(changes, (repoPath) => (
    repoPath === 'outside.txt'
      ? { path: repoPath, outsideRoot: true }
      : { path: repoPath, outsideRoot: false }
  ))

  assert.deepEqual(groups.staged.map((row) => row.path), ['a.txt', 'c.txt'])
  assert.deepEqual(groups.unstaged.map((row) => row.path), ['b.txt', 'c.txt'])
  assert.deepEqual(groups.untracked.map((row) => row.path), ['d.txt'])
  assert.deepEqual(groups.conflicted.map((row) => row.path), ['e.txt'])
  // `c.txt` is staged and edited again, which the row records explicitly.
  assert.equal(groups.staged.find((row) => row.path === 'c.txt').partiallyStaged, true)
  assert.equal(groups.staged.find((row) => row.path === 'a.txt').partiallyStaged, false)
  // Ignored entries never surface.
  assert.equal(groups.staged.some((row) => row.path === 'skip.txt'), false)
})

test('a multi-file patch is split per file with its own line numbers', () => {
  const patch = [
    'diff --git a/src/app.ts b/src/app.ts',
    'index 111..222 100644',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1,2 +1,2 @@',
    ' keep',
    '-old line',
    '+new line',
    'diff --git a/gone.txt b/gone.txt',
    'deleted file mode 100644',
    'index 333..000',
    '--- a/gone.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-doomed',
    'diff --git a/added.txt b/added.txt',
    'new file mode 100644',
    'index 000..444',
    '--- /dev/null',
    '+++ b/added.txt',
    '@@ -0,0 +1 @@',
    '+brand new',
  ].join('\n')

  const files = parseUnifiedDiffFiles(patch)
  assert.equal(files.length, 3)

  const app = files[0]
  assert.equal(app.path, 'src/app.ts')
  assert.equal(app.status, 'M')
  assert.equal(app.added, 1)
  assert.equal(app.removed, 1)
  // The `---`/`+++` header lines must not be read as content.
  assert.equal(app.rows.some((row) => row.text === 'a/src/app.ts'), false)

  assert.equal(files[1].path, 'gone.txt')
  assert.equal(files[1].status, 'D')
  assert.equal(files[1].removed, 1)
  assert.equal(files[1].added, 0)

  assert.equal(files[2].path, 'added.txt')
  assert.equal(files[2].status, 'A')
  assert.equal(files[2].added, 1)

  assert.deepEqual(parseUnifiedDiffFiles(''), [])
})

test('a rename in a patch reports both sides', () => {
  const patch = [
    'diff --git a/old/name.ts b/new/name.ts',
    'similarity index 95%',
    'rename from old/name.ts',
    'rename to new/name.ts',
    '@@ -1 +1 @@',
    '-a',
    '+b',
  ].join('\n')

  const files = parseUnifiedDiffFiles(patch)
  assert.equal(files.length, 1)
  assert.equal(files[0].status, 'R')
  assert.equal(files[0].oldPath, 'old/name.ts')
  assert.equal(files[0].path, 'new/name.ts')
})
