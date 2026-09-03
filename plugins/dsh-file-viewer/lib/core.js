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
  if (ext === 'docx') return 'doc'
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
  const base = String(root).replace(/[\\/]+$/, '')
  if (relative === undefined || relative === null || relative === '') return base
  return base + '/' + String(relative).replace(/^[\\/]+/, '')
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