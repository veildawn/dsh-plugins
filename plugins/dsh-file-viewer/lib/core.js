/**
 * Pure helpers shared by the host half and the tests: format classification,
 * language hints, directory ordering, and text-window arithmetic. Nothing here
 * touches the filesystem or a Cordis context, so the whole decision surface is
 * testable without fakes.
 *
 * @module dsh-file-viewer/core
 */

/** Largest binary payload the RPC channel will base64-encode for the browser. */
export const MAX_BYTES = 20 * 1024 * 1024

/** Largest text file the viewer reads as text at all. */
export const MAX_TEXT_BYTES = 8 * 1024 * 1024

/**
 * Largest document shipped whole for Markdown/JSON rendering. Those formats
 * are meaningless in line windows — half a document does not render — so they
 * travel complete, and past this budget the viewer honestly falls back to the
 * paged source view instead of rendering a partial document.
 */
export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024

/** Formats rendered from a whole document rather than a line window. */
export function isWholeDocumentKind(kind) {
  return kind === 'markdown' || kind === 'json'
}

/** Lines per text window. ReadBlock has no virtual scrolling, so the client pages. */
export const WINDOW_LINES = 500

/**
 * Extension to shiki language id. Only the grammars the client bundle can
 * actually load are mapped; anything else renders as plain monospace text,
 * which the highlighter handles without erroring.
 */
const LANG_BY_EXTENSION = Object.freeze({
  ts: 'typescript',
  tsx: 'tsx',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  py: 'python',
  pyi: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  cs: 'csharp',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  php: 'php',
  rb: 'ruby',
  lua: 'lua',
  sql: 'sql',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  fish: 'shellscript',
  ps1: 'shellscript',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  env: 'ini',
  properties: 'ini',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'mdx',
  html: 'html',
  htm: 'html',
  vue: 'html',
  svelte: 'html',
  astro: 'html',
  xml: 'xml',
  svg: 'xml',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  bat: 'shellscript',
  cmd: 'shellscript',
  gradle: 'java',
  proto: 'cpp',
})

/** Filenames without a useful extension that still have a known language. */
const LANG_BY_BASENAME = Object.freeze({
  dockerfile: 'shellscript',
  makefile: 'shellscript',
  '.gitignore': 'ini',
  '.gitattributes': 'ini',
  '.npmrc': 'ini',
  '.editorconfig': 'ini',
  '.env': 'ini',
})

const IMAGE_EXTENSIONS = Object.freeze(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg'])
const MEDIA_TYPE_BY_EXTENSION = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
})

/** Extensionless files that are text despite looking like nothing. */
const TEXT_BASENAMES = Object.freeze([
  'license', 'licence', 'readme', 'changelog', 'authors', 'contributing',
  'notice', 'copying', 'dockerfile', 'makefile', 'procfile', 'codeowners',
])

/** Extensions that are plain text but have no grammar worth naming. */
const TEXT_EXTENSIONS = Object.freeze([
  'txt', 'text', 'log', 'csv', 'tsv', 'diff', 'patch', 'lock', 'map',
  'gradle', 'bat', 'cmd', 'r', 'pl', 'vue', 'svelte', 'astro', 'graphql',
  'gql', 'proto', 'tf', 'tfvars', 'gitignore', 'gitattributes', 'npmrc',
  'editorconfig', 'nvmrc', 'prettierrc', 'eslintrc', 'babelrc',
])

/**
 * Heuristic: a buffer is text if it contains no null bytes within the first
 * 8 KB. This is the same approach used by git, the `file` command, and many
 * editors to distinguish text from binary data.
 *
 * @param {Uint8Array} buffer - the first bytes of the file.
 * @returns {boolean} true when the sample looks like text.
 */
export function isTextContent(buffer) {
  if (!buffer || buffer.length === 0) return true
  const limit = Math.min(buffer.length, 8192)
  for (let i = 0; i < limit; i += 1) {
    if (buffer[i] === 0) return false
  }
  return true
}

/**
 * Split a path into its basename, ignoring which separator the platform uses.
 * @param {string} path - any path, POSIX or Win32.
 * @returns {string} the trailing segment.
 */
export function baseNameOf(path) {
  if (typeof path !== 'string') return ''
  const isSlash = path === '/' || path === '\\'
  if (isSlash) return '/'
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut < 0 ? trimmed : trimmed.slice(cut + 1)
}

/**
 * Lowercased extension without the dot, or '' when there is none. A leading
 * dot does not start an extension (`.gitignore` has no extension).
 * @param {string} path - any path.
 * @returns {string} the extension, lowercased.
 */
export function extensionOf(path) {
  const base = baseNameOf(path)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

/**
 * The shiki language id for a path, or undefined to render as plain text.
 * @param {string} path - the file path.
 * @returns {string | undefined} a grammar id the client can request.
 */
export function langOf(path) {
  const base = baseNameOf(path).toLowerCase()
  if (Object.hasOwn(LANG_BY_BASENAME, base)) return LANG_BY_BASENAME[base]
  const ext = extensionOf(path)
  return ext !== '' && Object.hasOwn(LANG_BY_EXTENSION, ext) ? LANG_BY_EXTENSION[ext] : undefined
}

/**
 * The media type to stamp on a blob URL, for the formats the browser renders
 * natively. Text formats deliberately have none — they never become blobs.
 * @param {string} path - the file path.
 * @returns {string | undefined} an image or pdf media type.
 */
export function mediaTypeOf(path) {
  const ext = extensionOf(path)
  return Object.hasOwn(MEDIA_TYPE_BY_EXTENSION, ext) ? MEDIA_TYPE_BY_EXTENSION[ext] : undefined
}

/**
 * Which viewer renders this path. The client switches on this one word, so the
 * host and the client can never disagree about a file's kind.
 * @param {string} path - the file path.
 * @returns {'markdown'|'json'|'image'|'pdf'|'sheet'|'doc'|'text'|'binary'} the viewer kind.
 */
export function kindOf(path) {
  const base = baseNameOf(path).toLowerCase()
  const ext = extensionOf(path)
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return 'markdown'
  if (ext === 'json' || ext === 'jsonc' || ext === 'json5') return 'json'
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'xlsx' || ext === 'xlsm' || ext === 'xls') return 'sheet'
  if (ext === 'docx' || ext === 'doc') return 'doc'
  if (langOf(path) !== undefined) return 'text'
  if (TEXT_EXTENSIONS.includes(ext)) return 'text'
  if (ext === '' && TEXT_BASENAMES.includes(base.replace(/^\./, ''))) return 'text'
  return 'binary'
}

/** Directory entries that are noise in a file tree. */
const HIDDEN_ALWAYS = Object.freeze(['.git', '.hg', '.svn', 'node_modules', '.DS_Store', 'Thumbs.db'])

/**
 * Whether an entry is hidden by default. Dotfiles and heavy VCS/dependency
 * directories are collapsed unless the viewer explicitly asks for them.
 * @param {string} name - the entry basename.
 * @returns {boolean} true when it should be filtered by default.
 */
export function isHiddenEntry(name) {
  if (typeof name !== 'string' || name === '') return false
  return HIDDEN_ALWAYS.includes(name) || name.startsWith('.')
}

/**
 * Order entries for display: directories first, then files, each alphabetical
 * and case-insensitive with a stable tiebreak so equal keys never reorder.
 * @param {readonly {name: string, type: string}[]} entries - raw listing.
 * @returns {{name: string, type: string}[]} a new ordered array.
 */
export function sortEntries(entries) {
  const rows = [...(entries ?? [])]
  return rows.sort((left, right) => {
    const leftDir = left.type === 'directory'
    const rightDir = right.type === 'directory'
    if (leftDir !== rightDir) return leftDir ? -1 : 1
    const byName = String(left.name).localeCompare(String(right.name), undefined, { sensitivity: 'accent' })
    return byName !== 0 ? byName : String(left.name) < String(right.name) ? -1 : 1
  })
}

/**
 * Split text into lines, tolerating all three EOL conventions and reporting
 * which one dominates so the client can show it.
 * @param {string} text - the whole file.
 * @returns {{lines: string[], eol: 'lf'|'crlf'|'cr'}} split result.
 */
export function splitLines(text) {
  const body = typeof text === 'string' ? text : ''
  const crlf = (body.match(/\r\n/g) ?? []).length
  const cr = (body.match(/\r(?!\n)/g) ?? []).length
  const lf = (body.match(/(?<!\r)\n/g) ?? []).length
  const eol = crlf >= lf && crlf >= cr && crlf > 0 ? 'crlf' : cr > lf && cr > 0 ? 'cr' : 'lf'
  return { lines: body.split(/\r\n|\r|\n/), eol }
}

/**
 * Clamp a requested window onto a file's real line count. Offsets are 1-based
 * because that is what a reader types when jumping to a line, and an
 * out-of-range request lands on the last window instead of erroring.
 * @param {number} totalLines - lines in the file.
 * @param {number} [offset] - 1-based first line requested.
 * @param {number} [limit] - lines requested.
 * @returns {{offset: number, limit: number, end: number, hasBefore: boolean, hasAfter: boolean}} the resolved window.
 */
export function resolveWindow(totalLines, offset, limit) {
  const total = Number.isSafeInteger(totalLines) && totalLines > 0 ? totalLines : 0
  const size = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, WINDOW_LINES * 4) : WINDOW_LINES
  if (total === 0) return { offset: 1, limit: size, end: 0, hasBefore: false, hasAfter: false }
  const wanted = Number.isSafeInteger(offset) && offset > 0 ? offset : 1
  const start = Math.min(wanted, Math.max(1, total - size + 1))
  const end = Math.min(total, start + size - 1)
  return { offset: start, limit: size, end, hasBefore: start > 1, hasAfter: end < total }
}

/**
 * Build the numbered-line rows ReadBlock expects from a window of a file.
 * @param {readonly string[]} lines - every line in the file.
 * @param {{offset: number, end: number}} window - a window from {@link resolveWindow}.
 * @returns {{number: number, text: string}[]} rows carrying absolute line numbers.
 */
export function windowRows(lines, window) {
  const rows = []
  for (let n = window.offset; n <= window.end; n += 1) rows.push({ number: n, text: lines[n - 1] ?? '' })
  return rows
}

/**
 * Reject a path that tries to leave its root before it ever reaches the
 * filesystem. This is a cheap pre-filter for obvious attacks and absolute
 * paths; real containment is `ctx.fs.contains` on canonicalized targets,
 * which is the only check that survives symlinks.
 * @param {string} relative - the client-supplied path, relative to a root.
 * @returns {boolean} true when the shape is acceptable.
 */
export function isSafeRelativePath(relative) {
  if (relative === undefined || relative === null || relative === '') return true
  if (typeof relative !== 'string') return false
  if (relative.includes('\0')) return false
  if (relative.startsWith('/') || relative.startsWith('\\')) return false
  if (/^[A-Za-z]:/.test(relative)) return false
  return !relative.split(/[\\/]+/).includes('..')
}

/**
 * Join a root and a relative path with forward slashes. The host hands the
 * result to `ctx.fs.resolve`, which canonicalizes per platform, so the
 * separator here only has to be unambiguous.
 * @param {string} root - an absolute root path.
 * @param {string} [relative] - a path under it.
 * @returns {string} the joined path.
 */
export function joinPath(root, relative) {
  const str = String(root ?? '')
  const isSlash = str === '/' || str === '\\'
  const base = isSlash ? '/' : str.replace(/[\\/]+$/, '')
  if (relative === undefined || relative === null || relative === '') return base
  const rel = String(relative).replace(/^[\\/]+/, '')
  return isSlash ? `/${rel}` : `${base}/${rel}`
}

/**
 * Parent directory of a path, or '' when it has none.
 * @param {string} path - any path, POSIX or Win32.
 * @returns {string} parent directory path.
 */
export function parentOf(path) {
  const trimmed = String(path ?? '').replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut < 0 ? '' : trimmed.slice(0, cut)
}

/**
 * Every ancestor directory of a path, outermost first, excluding the path
 * itself. Used to reveal the directories leading to a file without collapsing
 * anything the reader already opened.
 * @param {string} path - a root-relative path.
 * @returns {string[]} ancestor paths, e.g. `a/b/c.js` -> `['a', 'a/b']`.
 */
export function ancestorsOf(path) {
  const parts = String(path ?? '').split(/[\\/]+/).filter((part) => part !== '')
  const rows = []
  let joined = ''
  for (const part of parts.slice(0, -1)) {
    joined = joined === '' ? part : `${joined}/${part}`
    rows.push(joined)
  }
  return rows
}

/**
 * Flatten a lazily-loaded directory tree into render rows.
 *
 * Only expanded directories contribute children, and a directory whose listing
 * has not arrived yet contributes a single placeholder row instead of nothing —
 * otherwise expanding a slow directory looks like it did nothing.
 *
 * @param {object} tree - the tree state.
 * @param {Set<string>} tree.expanded - directory paths currently open.
 * @param {Map<string, {status: string, entries?: readonly object[], error?: unknown}>} tree.nodes - per-directory listings keyed by path (root is '').
 * @param {number} [tree.maxDepth] - safety bound against pathological nesting.
 * @returns {{key: string, kind: 'entry'|'status', depth: number}[]} rows in display order.
 */
export function flattenTree({ expanded, nodes, maxDepth = 32 }) {
  const rows = []
  const open = expanded ?? new Set()
  const table = nodes ?? new Map()

  const walk = (dirPath, depth) => {
    if (depth > maxDepth) return
    const node = table.get(dirPath)
    if (node === undefined || node.status === 'loading') {
      rows.push({ kind: 'status', key: `${dirPath}\u0000loading`, depth, state: 'loading' })
      return
    }
    if (node.status === 'error') {
      rows.push({ kind: 'status', key: `${dirPath}\u0000error`, depth, state: 'error', error: node.error })
      return
    }
    const entries = node.entries ?? []
    if (entries.length === 0) {
      rows.push({ kind: 'status', key: `${dirPath}\u0000empty`, depth, state: 'empty' })
      return
    }
    for (const entry of entries) {
      const isDirectory = entry.type === 'directory'
      const isOpen = isDirectory && open.has(entry.path)
      rows.push({ kind: 'entry', key: entry.path, depth, entry, expanded: isOpen })
      if (isOpen) walk(entry.path, depth + 1)
    }
  }

  walk('', 0)
  return rows
}

/**
 * Human-readable byte size for file listings and oversize notices.
 * @param {number} bytes - a byte count.
 * @returns {string} e.g. `1.4 MB`.
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`
}

/**
 * Append a file reference to a draft, ready to submit.
 *
 * The agent reads paths from the prompt as plain text, so a reference is just
 * the path with an `@` marker. Paths containing whitespace are wrapped in
 * backticks, otherwise the agent cannot tell where the path ends.
 *
 * @param {string} draft - the composer's current text.
 * @param {string} displayPath - workspace-relative path of the file or folder.
 * @returns {string} the draft with the reference appended.
 */
export function appendMention(draft, displayPath) {
  const path = typeof displayPath === 'string' ? displayPath.trim() : ''
  if (path === '') return typeof draft === 'string' ? draft : ''

  const quoted = /[\s`]/.test(path) ? '`' + path.replace(/`/g, '') + '`' : path
  const reference = '@' + quoted
  const current = typeof draft === 'string' ? draft : ''
  if (current === '') return reference + ' '

  // Never join onto the previous word, but do not add a second space either —
  // the caller may append several references in a row.
  const separator = /\s$/.test(current) ? '' : ' '
  return current + separator + reference + ' '
}

/**
 * Parse a unified diff patch string (e.g. from git diff) into DiffBlock diff entries.
 * @param {string} patch - unified diff output.
 * @param {string} filePath - relative display path.
 * @returns {Array<{path: string, oldText: string | null, newText: string}>} hunk diffs.
 */
export function parsePatchToDiffs(patch, filePath) {
  if (typeof patch !== 'string' || patch.trim() === '') return []
  const lines = patch.split('\n')
  const hunks = []
  let currentOld = []
  let currentNew = [];
  let inHunk = false

  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (inHunk && (currentOld.length > 0 || currentNew.length > 0)) {
        hunks.push({
          path: filePath,
          oldText: currentOld.length > 0 ? currentOld.join('\n') : null,
          newText: currentNew.join('\n'),
        })
        currentOld = []
        currentNew = []
      }
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (line.startsWith('-')) {
      currentOld.push(line.slice(1))
    } else if (line.startsWith('+')) {
      currentNew.push(line.slice(1))
    }
  }

  if (inHunk && (currentOld.length > 0 || currentNew.length > 0)) {
    hunks.push({
      path: filePath,
      oldText: currentOld.length > 0 ? currentOld.join('\n') : null,
      newText: currentNew.join('\n'),
    })
  }

  return hunks
}

/**
 * Summarize total added and removed line counts across diff hunks.
 * @param {Array<{oldText: string | null, newText: string}>} diffs - diff entries.
 * @returns {{added: number, removed: number}} line statistics.
 */
export function summarizeDiffs(diffs) {
  let added = 0
  let removed = 0
  if (Array.isArray(diffs)) {
    for (const item of diffs) {
      if (typeof item.oldText === 'string' && item.oldText !== '') {
        removed += item.oldText.split('\n').length
      }
      if (typeof item.newText === 'string' && item.newText !== '') {
        added += item.newText.split('\n').length
      }
    }
  }
  return { added, removed }
}

/**
 * Parse porcelain git status output into modified and untracked file sets.
 * @param {string} statusText - stdout of git status --porcelain.
 * @returns {{modified: string[], untracked: string[]}} path lists.
 */
export function parseGitStatus(statusText) {
  if (typeof statusText !== 'string' || statusText.trim() === '') return { modified: [], untracked: [] }
  const modified = []
  const untracked = []
  for (const rawLine of statusText.split('\n')) {
    const line = rawLine.trimEnd()
    if (!line || line.length < 3) continue
    const code = line.slice(0, 2)
    // Handle quotes around filenames with spaces or unicode
    let file = line.slice(3).trim()
    if (file.startsWith('"') && file.endsWith('"')) {
      try { file = JSON.parse(file) } catch (_) {}
    }
    if (!file) continue
    if (code.includes('?')) {
      untracked.push(file)
    } else {
      modified.push(file)
    }
  }
  return { modified, untracked }
}

/**
 * Rebase a list of git-status paths (relative to the repository root) onto the
 * selected root so they match the tree's root-relative `entry.path`.
 *
 * `git status --porcelain` always reports paths relative to the repository root,
 * but a workspace root may be a subdirectory of that repository. Paths outside
 * the selected root are dropped, and the repository root itself is not listed.
 * @param {string[]} paths - repo-relative paths from git status.
 * @param {string} prefix - repo-relative path of the selected root ('' when the
 *   selected root is the repository root itself).
 * @returns {string[]} root-relative paths.
 */
export function rebaseGitPaths(paths, prefix) {
  if (!Array.isArray(paths)) return []
  const normalized = typeof prefix === 'string' ? prefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : ''
  const out = []
  for (let candidate of paths) {
    if (typeof candidate !== 'string') continue
    let p = candidate.replace(/\\/g, '/')
    let rootRelative
    if (normalized === '') {
      rootRelative = p
    } else if (p.startsWith(normalized + '/')) {
      rootRelative = p.slice(normalized.length + 1)
    } else if (p === normalized) {
      rootRelative = ''
    } else {
      continue
    }
    if (rootRelative !== '') out.push(rootRelative)
  }
  return out
}

/**
 * Normalize safe access paths from any supported configuration format
 * (array of strings, array of objects, or delimited string) into clean
 * `{ path, label }` records. Empty paths and non-string inputs are filtered.
 *
 * @param {unknown} input - configured safe paths.
 * @returns {{path: string, label: string}[]} normalized safe path list.
 */
export function normalizeSafePaths(input) {
  if (input === null || input === undefined) return []
  const items = []
  if (typeof input === 'string') {
    const parts = input.split(/[\r\n,;]+/)
    for (const part of parts) {
      const trimmed = part.trim()
      if (trimmed !== '') items.push({ path: trimmed, label: '' })
    }
    return items
  }
  if (!Array.isArray(input)) return []
  for (const item of input) {
    if (typeof item === 'string') {
      const trimmed = item.trim()
      if (trimmed !== '') items.push({ path: trimmed, label: '' })
    } else if (item && typeof item === 'object') {
      const p = typeof item.path === 'string' ? item.path.trim() : ''
      const l = typeof item.label === 'string' ? item.label.trim() : (typeof item.name === 'string' ? item.name.trim() : '')
      if (p !== '') items.push({ path: p, label: l })
    }
  }
  return items
}

/**
 * Intelligently convert raw text extracted from a Word .doc binary document
 * into clean, beautifully structured Markdown.
 *
 * It restores paragraph breaks (preventing Markdown from collapsing single
 * newlines into unreadable run-on text), auto-detects titles, chapters,
 * numbered subheadings, Chinese bullet lists, tables, and tables of contents.
 *
 * @param {string} rawText - raw body text from word-extractor.
 * @returns {string} structured Markdown.
 */
export function formatDocTextToMarkdown(rawText) {
  if (!rawText || typeof rawText !== 'string') return ''

  // 1. Strip OLE control codes and normalize newlines
  const cleaned = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')

  const rawLines = cleaned.split('\n')
  const blocks = []
  let currentTabGroup = []

  const flushTabGroup = () => {
    if (currentTabGroup.length === 0) return
    const lines = currentTabGroup
    currentTabGroup = []

    // Check if lines are a Table of Contents (title \t pageNumber)
    const isToc = lines.every((l) => {
      const parts = l.split('\t').map((p) => p.trim()).filter(Boolean)
      return parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])
    })

    if (isToc) {
      const tocFormatted = lines.map((l) => {
        const parts = l.split('\t').map((p) => p.trim()).filter(Boolean)
        const title = parts.slice(0, -1).join(' ')
        const page = parts[parts.length - 1]
        return `- **${title}** ................ *第 ${page} 页*`
      }).join('\n')
      blocks.push(tocFormatted)
      return
    }

    // Otherwise format as a Markdown table
    const rows = lines.map((l) => l.split('\t').map((c) => c.trim().replace(/\|/g, '\\|')))
    const maxCols = Math.max(...rows.map((r) => r.length))
    if (maxCols >= 2) {
      const padded = rows.map((r) => {
        const copy = [...r]
        while (copy.length < maxCols) copy.push('')
        return '| ' + copy.join(' | ') + ' |'
      })
      const divider = '| ' + Array(maxCols).fill('---').join(' | ') + ' |'
      padded.splice(1, 0, divider)
      blocks.push(padded.join('\n'))
    } else {
      blocks.push(lines.join('\n\n'))
    }
  }

  let titleEmitted = false

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim()
    // Skip empty lines, standalone dots or bullet markers left by Word
    if (!line || line === '.' || line === '•' || line === '·') continue

    // Tab-delimited lines are batched for table or TOC handling
    if (line.includes('\t')) {
      currentTabGroup.push(line)
      continue
    } else {
      flushTabGroup()
    }

    // TOC Section Heading
    if (line === '目录' || line === '目 录' || /^table\s+of\s+contents$/i.test(line) || /^contents$/i.test(line)) {
      blocks.push('## 目录')
      continue
    }

    // Document Title: the first standalone headline before sections
    if (!titleEmitted && blocks.length === 0 && line.length <= 80 && !/[。！？!?；;]$/.test(line)) {
      blocks.push('# ' + line)
      titleEmitted = true
      continue
    }

    // Major Chapter: 第一章 ... / 第二章 ... / 附录一 ...
    if (/^第[一二三四五六七八九十0-9]+[章节卷篇部]|^附录[0-9一二三四五六七八九十]/.test(line)) {
      blocks.push('## ' + line)
      continue
    }

    // English Major Chapter: Chapter 1, Section 2, Part III
    if (/^(chapter|section|part|appendix)\s+([0-9]+|[ivxlcdm]+)/i.test(line)) {
      blocks.push('## ' + line)
      continue
    }

    // Decimal subsections: 1.1 ..., 1.4.1 ..., A.1 ...
    if (/^[A-Za-z0-9]+(\.[A-Za-z0-9]+)+\s*[^\d\.]/.test(line)) {
      const depth = (line.match(/\./g) || []).length
      const prefix = depth >= 2 ? '#### ' : '### '
      const formatted = line.replace(/^([A-Za-z0-9]+(?:\.[A-Za-z0-9]+)+)\s*/, '$1 ')
      blocks.push(prefix + formatted)
      continue
    }

    // Chinese numerical sections: 一、 ..., 二、 ...
    if (/^[一二三四五六七八九十0-9]+[、.]\s*[\u4e00-\u9fa5]/.test(line) && line.length <= 40) {
      blocks.push('### ' + line)
      continue
    }

    // Enumerated bullet points: （1）..., (1)..., [1]...
    if (/^[（\(\[][0-9a-zA-Z一二三四五六七八九十]+[）\)\]]/.test(line)) {
      if (line.length <= 30 && !/[。！？!?；;]$/.test(line)) {
        blocks.push('**' + line + '**')
      } else {
        blocks.push('- ' + line)
      }
      continue
    }

    // Numbered list item: 1. ..., 2. ..., 3) ...
    if (/^[0-9]+[\.、\)]\s*[\u4e00-\u9fa5]/.test(line)) {
      blocks.push(line)
      continue
    }

    // Short section titles: concise standalone phrase (<= 30 chars) without punctuation
    // (Exclude pure date/time strings or front-matter metadata right under the title)
    const isDateOrMeta = /^\d{4}年|\d{1,2}月|\d{4}[-\/]\d{1,2}/.test(line) || (blocks.length <= 3 && !titleEmitted)
    if (!isDateOrMeta && line.length <= 30 && !/[。！？!?；;,，、：:]$/.test(line) && !/[，,。]/.test(line) && blocks.length > 2) {
      blocks.push('### ' + line)
      continue
    }

    // Standard paragraph: distinct block ensuring \n\n separation
    blocks.push(line)
  }

  flushTabGroup()

  return blocks.join('\n\n').trim()
}

/**
 * Sanitize HTML generated from Word documents (mammoth) to strip dangerous tags,
 * scripts, iframes, and event handlers while preserving safe layout tags
 * (p, h1-h6, strong, em, table, tr, td, th, ul, ol, li, img, a).
 *
 * @param {string} html - raw HTML string from mammoth.
 * @returns {string} sanitized HTML safe for browser rendering.
 */
export function sanitizeDocHtml(html) {
  if (!html || typeof html !== 'string') return ''
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s\S]*?<\/embed>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"')
    .replace(/<a\s+id=["']_Toc[^"']*["']><\/a>/gi, '')
    .trim()
}


