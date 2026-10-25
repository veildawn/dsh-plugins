/**
 * Pure helpers shared by the host half and the tests: format classification,
 * language hints, directory ordering, and text-window arithmetic. Nothing here
 * touches the filesystem or a Cordis context, so the whole decision surface is
 * testable without fakes.
 *
 * @module dsh-file-viewer/core
 */

/**
 * Largest binary payload the RPC viewer channel will base64-encode (20 MB).
 *
 * This budget belongs to the in-page preview path, which ships bytes as a
 * base64 string inside a JSON envelope: a 20 MB file already costs ~27 MB of
 * wire text plus an `atob` decode on the main thread. Raising it would make
 * every preview of a large PDF or image block the browser, so downloads —
 * which have their own streaming path — deliberately do not share it.
 */
export const MAX_BYTES = 20 * 1024 * 1024

/**
 * Largest file the download endpoint will stream (100 MB).
 *
 * Kept separate from {@link MAX_BYTES} on purpose: a download is consumed by
 * the save flow rather than decoded into the page, so it can afford a budget
 * the in-page preview path could never justify.
 */
export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024

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

/**
 * Bytes sampled to tell text from binary when the name says nothing. The same
 * 8 KB window git and `file(1)` inspect, and the window a probe must read
 * through `readByteRange` — not `readBytes`, whose cap is the whole file.
 */
export const TEXT_PROBE_BYTES = 8192

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
 * Whether a byte sample decodes as UTF-8 text.
 *
 * Complements {@link isTextContent}: a sample can be null-free and still not
 * be UTF-8 (GBK, Latin-1, raw binary that happens to avoid NUL). Promoting
 * such a file to `'text'` only moves the failure to the read, which rejects
 * non-UTF-8 content — so the probe checks decodability here and classifies
 * honestly instead.
 *
 * Decoded in streaming mode so a multi-byte character straddling the end of
 * the sample is held back rather than reported as malformed: a truncated
 * probe is not evidence of a non-text file.
 *
 * @param {Uint8Array} buffer - the sampled leading bytes.
 * @returns {boolean} true when the sample is valid, possibly truncated, UTF-8.
 */
export function isUtf8TextContent(buffer) {
  if (!buffer || buffer.length === 0) return true
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer, { stream: true })
    return true
  } catch {
    return false
  }
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
 * Every grammar the client's highlighter can actually load, as
 * `{ id, label }` pairs.
 *
 * This is the picker's option list and the allow-list for a user override: an
 * id outside it would be handed to shiki, which silently renders plain text,
 * so the UI would appear to accept a choice that does nothing. `plain` is
 * deliberately first — it is the "no highlighting" escape hatch, and it is
 * the only entry that is not a grammar id.
 *
 * Kept in sync with `@deepseek-ai/dsh-client-ui-primitives`'s `LANG_ALIASES`
 * (the canonical ids, not the aliases) by the `language catalog matches the
 * highlighter` test.
 */
export const LANGUAGE_CATALOG = Object.freeze([
  Object.freeze({ id: 'plain', label: '纯文本' }),
  Object.freeze({ id: 'typescript', label: 'TypeScript' }),
  Object.freeze({ id: 'json', label: 'JSON' }),
  Object.freeze({ id: 'yaml', label: 'YAML' }),
  Object.freeze({ id: 'toml', label: 'TOML' }),
  Object.freeze({ id: 'ini', label: 'INI / Properties' }),
  Object.freeze({ id: 'dotenv', label: '.env' }),
  Object.freeze({ id: 'xml', label: 'XML' }),
  Object.freeze({ id: 'html', label: 'HTML' }),
  Object.freeze({ id: 'css', label: 'CSS' }),
  Object.freeze({ id: 'scss', label: 'SCSS' }),
  Object.freeze({ id: 'less', label: 'Less' }),
  Object.freeze({ id: 'markdown', label: 'Markdown' }),
  Object.freeze({ id: 'mdx', label: 'MDX' }),
  Object.freeze({ id: 'vue', label: 'Vue' }),
  Object.freeze({ id: 'svelte', label: 'Svelte' }),
  Object.freeze({ id: 'python', label: 'Python' }),
  Object.freeze({ id: 'ruby', label: 'Ruby' }),
  Object.freeze({ id: 'go', label: 'Go' }),
  Object.freeze({ id: 'rust', label: 'Rust' }),
  Object.freeze({ id: 'java', label: 'Java' }),
  Object.freeze({ id: 'kotlin', label: 'Kotlin' }),
  Object.freeze({ id: 'scala', label: 'Scala' }),
  Object.freeze({ id: 'groovy', label: 'Groovy' }),
  Object.freeze({ id: 'c', label: 'C' }),
  Object.freeze({ id: 'cpp', label: 'C++' }),
  Object.freeze({ id: 'csharp', label: 'C#' }),
  Object.freeze({ id: 'swift', label: 'Swift' }),
  Object.freeze({ id: 'php', label: 'PHP' }),
  Object.freeze({ id: 'perl', label: 'Perl' }),
  Object.freeze({ id: 'lua', label: 'Lua' }),
  Object.freeze({ id: 'r', label: 'R' }),
  Object.freeze({ id: 'julia', label: 'Julia' }),
  Object.freeze({ id: 'dart', label: 'Dart' }),
  Object.freeze({ id: 'elixir', label: 'Elixir' }),
  Object.freeze({ id: 'erlang', label: 'Erlang' }),
  Object.freeze({ id: 'clojure', label: 'Clojure' }),
  Object.freeze({ id: 'haskell', label: 'Haskell' }),
  Object.freeze({ id: 'fsharp', label: 'F#' }),
  Object.freeze({ id: 'vb', label: 'Visual Basic' }),
  Object.freeze({ id: 'nix', label: 'Nix' }),
  Object.freeze({ id: 'shellscript', label: 'Shell' }),
  Object.freeze({ id: 'powershell', label: 'PowerShell' }),
  Object.freeze({ id: 'bat', label: 'Batch' }),
  Object.freeze({ id: 'fish', label: 'Fish' }),
  Object.freeze({ id: 'make', label: 'Makefile' }),
  Object.freeze({ id: 'cmake', label: 'CMake' }),
  Object.freeze({ id: 'sql', label: 'SQL' }),
  Object.freeze({ id: 'graphql', label: 'GraphQL' }),
  Object.freeze({ id: 'proto', label: 'Protocol Buffers' }),
  Object.freeze({ id: 'hcl', label: 'HCL / Terraform' }),
  Object.freeze({ id: 'http', label: 'HTTP' }),
  Object.freeze({ id: 'log', label: 'Log' }),
  Object.freeze({ id: 'csv', label: 'CSV' }),
  Object.freeze({ id: 'diff', label: 'Diff' }),
  Object.freeze({ id: 'rst', label: 'reStructuredText' }),
  Object.freeze({ id: 'latex', label: 'LaTeX' }),
  Object.freeze({ id: 'bibtex', label: 'BibTeX' }),
  Object.freeze({ id: 'asciidoc', label: 'AsciiDoc' }),
  Object.freeze({ id: 'verilog', label: 'Verilog' }),
  Object.freeze({ id: 'system-verilog', label: 'SystemVerilog' }),
])

/** Every selectable id, as a Set for O(1) validation of a user override. */
const LANGUAGE_IDS = Object.freeze(new Set(LANGUAGE_CATALOG.map((entry) => entry.id)))

/**
 * Whether a language id may be handed to the highlighter.
 *
 * `plain` is accepted because it is the picker's explicit "no highlighting"
 * choice; it is normalized to `undefined` before reaching the renderer.
 * @param {unknown} id - a candidate id, typically from storage or the RPC.
 * @returns {boolean} true when the id is one the picker offers.
 */
export function isKnownLanguage(id) {
  return typeof id === 'string' && LANGUAGE_IDS.has(id)
}

/**
 * Whether a name is shaped like a language id at all.
 *
 * Used to reject junk before it reaches the catalog: an arbitrary string from
 * storage or the wire must not become a highlight request. Deliberately
 * permissive about membership (that is {@link isKnownLanguage}'s job) so the
 * two checks stay independent.
 * @param {unknown} value - a candidate value.
 * @returns {boolean} true when the value is a plausible id.
 */
export function isLanguageIdShaped(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 32 && /^[a-z][a-z0-9-]*$/.test(value)
}

/**
 * Guess a language from a text sample when the file name says nothing.
 *
 * Only content with an unambiguous, cheaply checkable signature is claimed;
 * everything else returns `undefined` and renders as plain text. Guessing
 * wrong is worse than not guessing, because the highlight lands on tokens the
 * grammar does not expect and colours the file misleadingly — so each rule
 * here demands a positive structural marker, not merely "no contradiction".
 *
 * Ordered most-specific first: a shebang names its interpreter outright, then
 * exact first-token formats, then declaration-led markup, then loose
 * key/value shapes last.
 *
 * @param {string} sample - the decoded leading text of the file.
 * @returns {string | undefined} a grammar id from {@link LANGUAGE_CATALOG}, or undefined.
 */
export function detectLanguageFromText(sample) {
  if (typeof sample !== 'string') return undefined
  // A sample cut mid-line is still fine: every rule below reads whole leading
  // lines, and a truncated trailing line simply fails to match.
  const text = sample.replace(/^\uFEFF/, '')
  if (text.trim() === '') return undefined

  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n')).trim()

  // 1. Shebang names the interpreter directly, and is authoritative.
  if (firstLine.startsWith('#!')) {
    if (/\b(?:ba|z|k|c)?sh\b/.test(firstLine)) return 'shellscript'
    if (/\bfish\b/.test(firstLine)) return 'fish'
    if (/\b(?:python|python3)\b/.test(firstLine)) return 'python'
    if (/\bnode\b/.test(firstLine)) return 'typescript'
    if (/\bruby\b/.test(firstLine)) return 'ruby'
    if (/\bperl\b/.test(firstLine)) return 'perl'
    return undefined
  }

  // 2. Exact leading tokens that only one format uses.
  if (/^<\?xml\b/.test(text)) {
    // An SVG root is XML too, but the XML grammar renders it correctly.
    return 'xml'
  }
  if (/^<!DOCTYPE html\b/i.test(text) || /^<html[\s>]/i.test(text)) return 'html'
  if (/^%PDF-/.test(text)) return undefined // binary, handled by the caller
  if (/^%!PS/.test(text)) return undefined
  if (/^\\documentclass\b/.test(text) || /^\\begin\{document\}/.test(text)) return 'latex'
  if (/^@(?:article|book|inproceedings|misc|string)\s*\{/i.test(text)) return 'bibtex'
  if (/^=+[^=\n]+=+\s*$/m.test(text) && /^\S.*\n[-=]{3,}\s*$/m.test(text)) return 'rst'

  // 3. Declaration-led markup.
  if (/^\s*(?:syntax\s*=\s*"?proto3"?|package\s+[\w.]+\s*;)/m.test(text) && /\b(?:message|service|rpc)\s+\w+/.test(text)) return 'proto'
  if (/^\s*(?:terraform|resource|variable|provider|module|output|locals)\s+["{]/.test(text) || /^\s*terraform\s*\{/m.test(text)) return 'hcl'
  if (/^\s*(?:query|mutation|subscription|fragment)\s+\w+/.test(text) || /^\s*type\s+\w+\s*\{/m.test(text)) return 'graphql'

  // 4. JSON: must actually parse, not merely start with a brace. A truncated
  //    sample is common, so a failed parse falls through rather than deciding.
  const trimmed = text.trim()
  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && looksLikeCompleteJson(trimmed)) return 'json'

  // 5. Loose key/value shapes, weakest evidence, checked last.
  if (looksLikeYaml(text)) return 'yaml'
  if (looksLikeIni(text)) return 'ini'
  if (looksLikeDockerfile(text)) return 'shellscript'
  if (looksLikeCsv(text)) return 'csv'

  return undefined
}

/**
 * Whether a sample parses as a whole JSON document.
 * @param {string} text - the trimmed sample.
 * @returns {boolean} true when it parses.
 */
function looksLikeCompleteJson(text) {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/**
 * Whether a sample has YAML's shape: `key: value` lines, with no `=`-led
 * assignments (which would suggest INI) and no XML/HTML angle brackets.
 * @param {string} text - the sample.
 * @returns {boolean} true when the sample looks like YAML.
 */
function looksLikeYaml(text) {
  const lines = text.split('\n').filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))
  if (lines.length === 0) return false
  let mappings = 0
  for (const line of lines.slice(0, 40)) {
    // A YAML mapping is `key:` possibly followed by a value; a list item or a
    // document marker is also strong evidence.
    if (/^\s*-\s/.test(line) || /^\s*---\s*$/.test(line)) {
      mappings += 1
      continue
    }
    if (/^\s*[A-Za-z_][\w.-]*\s*:(?:\s|$)/.test(line)) {
      mappings += 1
      continue
    }
    // A bare `=` assignment points at INI, not YAML.
    if (/^\s*[A-Za-z_][\w.-]*\s*=/.test(line)) return false
  }
  // Require most lines to be mappings; prose would otherwise drift in.
  return mappings >= 2 && mappings >= Math.ceil(lines.slice(0, 40).length * 0.6)
}

/**
 * Whether a sample has INI's shape: at least one `[section]` and `key=value`
 * assignments.
 * @param {string} text - the sample.
 * @returns {boolean} true when the sample looks like INI.
 */
function looksLikeIni(text) {
  const lines = text.split('\n').filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#') && !line.trimStart().startsWith(';'))
  if (lines.length === 0) return false
  let sections = 0
  let assignments = 0
  for (const line of lines.slice(0, 40)) {
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) sections += 1
    else if (/^\s*[A-Za-z_][\w.-]*\s*=/.test(line)) assignments += 1
  }
  // A lone `key=value` is far too common to claim; require a section header or
  // several assignments before calling it INI.
  return sections >= 1 || assignments >= 3
}

/**
 * Whether a sample is a CSV document: several lines sharing one field count.
 *
 * A single comma-bearing line is not enough — JSON, prose and code all contain
 * commas — so this requires a rectangular shape across at least two rows, and
 * rejects anything with the braces or brackets of a structured format.
 * @param {string} text - the sample.
 * @returns {boolean} true when the sample looks like CSV.
 */
function looksLikeCsv(text) {
  if (/[{}[\]<>]/.test(text)) return false
  const rows = text.split('\n').filter((line) => line.trim() !== '')
  if (rows.length < 2) return false
  const split = (line) => line.split(',').map((field) => field.trim())
  const header = split(rows[0])
  if (header.length < 2 || header.length > 64) return false
  // Every row must share the header's field count; a ragged shape is prose.
  let matching = 0
  for (const row of rows.slice(1, 21)) {
    if (split(row).length === header.length) matching += 1
    else return false
  }
  if (matching < 1) return false
  // Fields must look like data, not sentences: prose has spaces and stops.
  return header.every((field) => field.length <= 64 && !/[.!?;]/.test(field))
}

/**
 * Whether a sample is a Dockerfile: its instructions are a closed vocabulary
 * and the file conventionally starts with FROM or a parser directive.
 * @param {string} text - the sample.
 * @returns {boolean} true when the sample looks like a Dockerfile.
 */
function looksLikeDockerfile(text) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
  if (lines.length === 0) return false
  if (!/^FROM\s+\S+/i.test(lines[0])) return false
  const INSTRUCTIONS = /^(?:FROM|RUN|CMD|LABEL|MAINTAINER|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL)\b/i
  // Every remaining line must be an instruction or a continuation, or this is
  // some other file that merely happens to start with FROM.
  return lines.slice(1, 40).every((line) => INSTRUCTIONS.test(line) || /^[&|]/.test(line) || /\$\{?[A-Z_]+\}?/.test(line))
}

/**
 * Resolve the language to highlight a file with, given every source of truth
 * in precedence order: an explicit user override, then the file name, then a
 * content guess.
 *
 * The override wins outright because it is the only signal that reflects
 * intent; the name beats content because a correct extension is stronger
 * evidence than a heuristic over 8 KB.
 *
 * @param {object} input - the resolution inputs.
 * @param {string} [input.override] - a validated user choice, or undefined.
 * @param {string} [input.path] - the file path.
 * @param {string} [input.sample] - decoded leading text, when content may be consulted.
 * @returns {{lang: string | undefined, source: 'override'|'name'|'content'|'none'}} the id and where it came from.
 */
export function resolveLanguage({ override, path, sample } = {}) {
  if (isKnownLanguage(override)) {
    return { lang: override === 'plain' ? undefined : override, source: 'override' }
  }
  const byName = typeof path === 'string' ? langOf(path) : undefined
  if (byName !== undefined) return { lang: byName, source: 'name' }
  const byContent = detectLanguageFromText(sample)
  if (byContent !== undefined) return { lang: byContent, source: 'content' }
  return { lang: undefined, source: 'none' }
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
 * Build a `Content-Disposition` value that survives non-ASCII file names.
 *
 * HTTP header values are ByteStrings: every code unit must be ≤ 0xFF, so a raw
 * Chinese or emoji name makes `Response` reject the whole header (and the
 * download fails with a 500). RFC 6266/5987 solves this with two parameters:
 * a plain `filename=` fallback restricted to ASCII, and `filename*=` carrying
 * the real name as percent-encoded UTF-8. Browsers prefer `filename*` when it
 * is present, so the fallback only has to stay legal, not pretty.
 *
 * The fallback drops anything outside printable ASCII, then collapses the
 * result so a name made entirely of non-ASCII characters still yields a usable
 * value instead of an empty one.
 * @param {string} name - the file name to advertise.
 * @returns {string} a header value safe for any byte-string header carrier.
 */
export function contentDispositionFor(name) {
  const raw = typeof name === 'string' ? name : ''
  // Strip CR/LF first: those would end the header rather than appear in it.
  const withoutBreaks = raw.replace(/[\r\n]+/g, ' ')
  // Printable ASCII minus the quote and backslash that would break the quoting.
  const ascii = withoutBreaks.replace(/[^\x20-\x7E]/g, '').replace(/["\\]/g, '')
  const trimmed = ascii.trim()
  const fallback = trimmed === '' || trimmed === '.' || trimmed === '..' ? 'download' : trimmed
  const encoded = encodeURIComponent(withoutBreaks)
  // encodeURIComponent leaves ' ( ) * ! unescaped; RFC 5987 forbids none of
  // them but a stray ' would be read as the charset/language separator, so it
  // is escaped explicitly.
  const extValue = encoded.replace(/'/g, '%27')
  return `attachment; filename="${fallback}"; filename*=UTF-8''${extValue}`
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
  if (relative === '~' || relative.startsWith('~/') || relative.startsWith('~\\')) return false
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
 * The working-tree path a file tree should highlight, for a given tab set.
 *
 * The tab strip and the tree are two views of one fact — "this file is open" —
 * so the highlight is derived from the active tab instead of from the last row
 * that was clicked. Deriving it from the tab's own `path` (not from its loaded
 * metadata) is what makes the row light up the instant the tab opens; a tab
 * knows where it points before its file has been read.
 *
 * Only tabs that describe a working-tree file qualify. A `commit` tab names a
 * blob inside history, which no tree row shows; a `change` tab names a path
 * whose diff is on screen; and a `file` tab carrying a commit hash is a
 * historical version whose path may not exist on disk any more. Highlighting
 * any of them would claim the tree lists something it does not.
 *
 * @param {null | Array<{id: string, kind: string, path?: string, commit?: string}>} tabs - the tab list.
 * @param {string} activeId - the tab on screen.
 * @returns {string} root-relative path to highlight, or '' for no highlight.
 */
export function pathOfActiveTab(tabs, activeId) {
  if (!Array.isArray(tabs) || tabs.length === 0) return ''
  if (typeof activeId !== 'string' || activeId === '') return ''
  const tab = tabs.find((row) => row !== null && row !== undefined && row.id === activeId)
  if (tab === undefined || tab.kind !== 'file') return ''
  if (typeof tab.commit === 'string' && tab.commit !== '') return ''
  return typeof tab.path === 'string' ? tab.path : ''
}

/**
 * How far a scrolling tree has to scroll to bring one row into view.
 *
 * Kept pure and host-side testable because the geometry cannot be observed in a
 * test environment that performs no layout: jsdom reports every rectangle as
 * zero. The three rules worth locking down are "reveal an off-screen row",
 * "leave a visible one alone" (so a reader who scrolled deliberately is not
 * yanked back) and "never produce a negative offset".
 *
 * @param {{rowTop: number, rowHeight: number, hostTop: number, hostHeight: number, scrollTop: number}} box
 *   Viewport-relative rectangles, exactly as `getBoundingClientRect` reports them.
 * @returns {number | null} the scrollTop to apply, or null when the row is
 *   already fully visible and nothing should move.
 */
export function scrollTargetForRow({ rowTop, rowHeight, hostTop, hostHeight, scrollTop } = {}) {
  const height = Number.isFinite(rowHeight) ? rowHeight : 0
  const visibleTop = Number.isFinite(hostTop) ? hostTop : 0
  const visibleHeight = Number.isFinite(hostHeight) ? hostHeight : 0
  const fromTop = (Number.isFinite(rowTop) ? rowTop : 0) - visibleTop
  const fromBottom = fromTop + height
  if (fromTop >= 0 && fromBottom <= visibleHeight) return null
  const base = Number.isFinite(scrollTop) ? scrollTop : 0
  const centred = base + fromTop - Math.max(0, (visibleHeight - height) / 2)
  return Math.max(0, Math.round(centred))
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
 * Insert a file reference at a specific character offset (caret position) in the text,
 * ensuring words are properly separated without destroying existing text.
 *
 * @param {string} currentText - the current draft text in the composer.
 * @param {string} displayPath - workspace-relative path of the file or folder.
 * @param {number} [caretIndex] - insertion offset. Defaults to the end of the text.
 * @returns {string} the text with the reference inserted at the caret position.
 */
export function insertMentionAtCaret(currentText, displayPath, caretIndex) {
  const path = typeof displayPath === 'string' ? displayPath.trim() : ''
  if (path === '') return typeof currentText === 'string' ? currentText : ''

  const quoted = /[\s`]/.test(path) ? '`' + path.replace(/`/g, '') + '`' : path
  const reference = '@' + quoted
  const current = typeof currentText === 'string' ? currentText : ''
  if (current === '') return reference + ' '

  const idx = typeof caretIndex === 'number' && Number.isFinite(caretIndex)
    ? Math.max(0, Math.min(current.length, Math.round(caretIndex)))
    : current.length

  const before = current.slice(0, idx)
  const after = current.slice(idx)
  const needPreSpace = before.length > 0 && !/\s$/.test(before)
  const needPostSpace = after.length === 0 || !/^\s/.test(after)
  return before + (needPreSpace ? ' ' : '') + reference + (needPostSpace ? ' ' : '') + after
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
 * Parse unified diff patch or whole new text into line-numbered diff rows.
 * Each row carries:
 * - `type`: 'add' | 'del' | 'normal' | 'hunk'
 * - `oldLine`: number | null (line number in original file)
 * - `newLine`: number | null (line number in modified file)
 * - `text`: string (line content)
 *
 * @param {string} patch - git unified diff patch text.
 * @param {string} [fallbackText] - full text of new file when patch is empty (e.g. untracked file).
 * @returns {Array<{type: 'add'|'del'|'normal'|'hunk', oldLine: number|null, newLine: number|null, text: string}>}
 */
export function parsePatchToRows(patch, fallbackText = '') {
  if (!patch || typeof patch !== 'string' || patch.trim() === '') {
    if (typeof fallbackText === 'string' && fallbackText !== '') {
      const lines = fallbackText.split('\n')
      return lines.map((text, idx) => ({
        type: 'add',
        oldLine: null,
        newLine: idx + 1,
        text,
      }))
    }
    return []
  }

  const rows = []
  const lines = patch.split('\n')
  let oldLine = 1
  let newLine = 1

  for (const line of lines) {
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      continue
    }
    if (line.startsWith('@@')) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/)
      if (match) {
        oldLine = parseInt(match[1], 10)
        newLine = parseInt(match[2], 10)
        rows.push({
          type: 'hunk',
          oldLine: null,
          newLine: null,
          text: line,
        })
      }
      continue
    }
    if (line.startsWith('+')) {
      rows.push({
        type: 'add',
        oldLine: null,
        newLine: newLine++,
        text: line.slice(1),
      })
    } else if (line.startsWith('-')) {
      rows.push({
        type: 'del',
        oldLine: oldLine++,
        newLine: null,
        text: line.slice(1),
      })
    } else if (line.startsWith(' ') || line === '') {
      rows.push({
        type: 'normal',
        oldLine: oldLine++,
        newLine: newLine++,
        text: line.startsWith(' ') ? line.slice(1) : line,
      })
    }
  }
  return rows
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
export function normalizeSafePaths(input, homeDir = '') {
  if (input === null || input === undefined) return []
  const items = []
  const expand = (p) => {
    if (!homeDir || typeof p !== 'string') return p
    if (p === '~') return homeDir
    if (p.startsWith('~/') || p.startsWith('~\\')) {
      return homeDir.replace(/[\\/]+$/, '') + '/' + p.slice(2)
    }
    return p
  }

  if (typeof input === 'string') {
    const parts = input.split(/[\r\n,;]+/)
    for (const part of parts) {
      const trimmed = part.trim()
      if (trimmed !== '') items.push({ path: expand(trimmed), label: '' })
    }
    return items
  }
  if (!Array.isArray(input)) return []
  for (const item of input) {
    if (typeof item === 'string') {
      const trimmed = item.trim()
      if (trimmed !== '') items.push({ path: expand(trimmed), label: '' })
    } else if (item && typeof item === 'object') {
      const p = typeof item.path === 'string' ? item.path.trim() : ''
      const l = typeof item.label === 'string' ? item.label.trim() : (typeof item.name === 'string' ? item.name.trim() : '')
      if (p !== '') items.push({ path: expand(p), label: l })
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

/* -------------------------------------------------------------------------- *
 * Git panel
 *
 * Everything the panel shows is derived from `git` output, which is only a
 * stable machine-readable format when it is asked for explicitly: the defaults
 * are colourised, paged, localized, and quote-escaped. The helpers below parse
 * the unambiguous shapes the host requests — `--format` with unit/record
 * separators, and `-z` name-status — and never try to re-parse human-facing
 * text. Keeping them here means the whole panel decision surface is testable
 * without spawning a process or owning a repository.
 * -------------------------------------------------------------------------- */

/** Commits requested per page, the size the panel opens with. */
export const GIT_COMMIT_PAGE_SIZE = 30

/** Hard ceiling for one page, so a forged request cannot pull all of history. */
export const GIT_COMMIT_PAGE_MAX = 100

/**
 * Subdirectories probed for nested repositories.
 *
 * A directory that holds many checkouts (a workspace of projects) has to be
 * scanned one level deep, but the scan costs one `git` process per candidate,
 * so it is bounded and the obvious dependency directories are skipped.
 */
export const GIT_REPO_SCAN_LIMIT = 32

/** Directories that never hold a checkout worth listing. */
const REPO_SCAN_SKIP = Object.freeze(['node_modules', 'bower_components', '__pycache__'])

/**
 * Normalize a path for comparison: forward slashes, no trailing separator.
 *
 * `git` prints POSIX separators on every platform, while a host root may
 * arrive with backslashes, so anything compared against git output goes
 * through here first.
 * @param {unknown} value - a path fragment.
 * @returns {string} the normalized path, or '' when nothing remains.
 */
export function normalizeGitPath(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.replace(/\\/g, '/').replace(/\/+$/, '')
  return trimmed === '.' ? '' : trimmed
}

/**
 * Whether `child` sits at or below `parent`, as a relative path.
 *
 * Windows resolves the same directory under either case, so the comparison
 * folds case there and stays exact everywhere else.
 * @param {string} parent - absolute directory path.
 * @param {string} child - absolute path to test.
 * @returns {string | null} '' when equal, the relative path when nested, null otherwise.
 */
export function relativePathWithin(parent, child) {
  const base = normalizeGitPath(parent)
  const target = normalizeGitPath(child)
  if (base === '' || target === '') return null
  const fold = (value) => (process.platform === 'win32' ? value.toLowerCase() : value)
  if (fold(base) === fold(target)) return ''
  if (!fold(target).startsWith(fold(base) + '/')) return null
  return target.slice(base.length + 1)
}

/**
 * Whether a name is a legitimate branch (or revision) name.
 *
 * This is `git check-ref-format`'s rule set, restated so the host can refuse a
 * bad name before it reaches git. The leading-dash rule matters most: the host
 * passes refs as argv entries, so `-D` or `--exec=…` would otherwise be parsed
 * as an option rather than a branch.
 * @param {unknown} name - a candidate branch name.
 * @returns {boolean} true when the name is safe to pass to git as a ref.
 */
export function isSafeBranchName(name) {
  if (typeof name !== 'string') return false
  if (name.length === 0 || name.length > 255) return false
  if (name.startsWith('-')) return false
  // Control characters, spaces and the glob/revision metacharacters git forbids.
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(name)) return false
  if (name.includes('..') || name.includes('@{') || name.includes('//')) return false
  if (name.endsWith('/') || name.endsWith('.')) return false
  for (const part of name.split('/')) {
    if (part === '' || part.startsWith('.') || part.endsWith('.lock')) return false
  }
  return true
}

/**
 * Whether a value is a concrete commit hash rather than a revision expression.
 * @param {unknown} value - a candidate hash.
 * @returns {boolean} true for 7–40 lowercase hex characters.
 */
export function isSafeCommitSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{7,40}$/.test(value)
}

/**
 * Clamp a requested commit page onto the supported window.
 * @param {{offset?: unknown, limit?: unknown}} [payload] - the client request.
 * @returns {{offset: number, limit: number}} the resolved page.
 */
export function normalizeCommitPage(payload) {
  const rawLimit = Number(payload?.limit)
  const rawOffset = Number(payload?.offset)
  const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, GIT_COMMIT_PAGE_MAX)
    : GIT_COMMIT_PAGE_SIZE
  const offset = Number.isSafeInteger(rawOffset) && rawOffset > 0 ? Math.min(rawOffset, 1_000_000) : 0
  return { offset, limit }
}

/**
 * Whether a subdirectory is worth probing for its own checkout.
 * @param {unknown} name - a directory entry name.
 * @returns {boolean} true when the scan should try it.
 */
export function isCandidateRepoDirectory(name) {
  if (typeof name !== 'string' || name === '') return false
  if (name.startsWith('.') || name.startsWith('$')) return false
  return !REPO_SCAN_SKIP.includes(name)
}

/**
 * Parse `git branch --format=%(HEAD)%09%(refname:short)…` output.
 *
 * The host asks for tab-separated fields precisely so a branch name (which git
 * forbids from containing whitespace) cannot be confused with the `*` marker.
 * @param {string} stdout - the format output.
 * @returns {{name: string, current: boolean, sha: string, date: string, upstream: string}[]} branches.
 */
export function parseGitBranches(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') return []
  const rows = []
  for (const rawLine of stdout.split('\n')) {
    if (rawLine.trim() === '') continue
    const fields = rawLine.split('\t')
    if (fields.length < 2) continue
    const name = fields[1].trim()
    if (name === '') continue
    rows.push({
      name,
      current: fields[0].trim() === '*',
      sha: (fields[2] || '').trim(),
      date: (fields[3] || '').trim(),
      upstream: (fields[4] || '').trim(),
    })
  }
  return rows
}

/**
 * Parse one `%x1f`-separated commit record into its fields.
 *
 * The two formats the host asks for differ by exactly one trailing field — the
 * list format ends at the subject, the detail format appends the raw message —
 * so the shape is a parameter rather than a guess. Guessing from the field
 * count would misread a subject that happens to contain the separator.
 *
 * @param {string} record - one record, already split on `%x1e`.
 * @param {boolean} withBody - whether a `%B` field follows the subject.
 * @returns {{commit: object, body: string} | null} the parsed commit.
 */
function parseCommitRecord(record, withBody) {
  const text = record.replace(/^\r?\n+/, '').replace(/\s+$/, '')
  if (text === '') return null
  const fields = text.split('\x1f')
  const sha = (fields[0] || '').trim()
  if (!isSafeCommitSha(sha)) return null
  // List format: everything after the fixed fields is the (single-line)
  // subject, separators included. Detail format: field 6 is the subject and
  // field 7 onward is the raw message, whose newlines are content.
  const subject = withBody ? (fields[6] || '').trim() : fields.slice(6).join('\x1f').trim()
  return {
    commit: {
      sha,
      shortSha: (fields[1] || '').trim() || sha.slice(0, 7),
      author: fields[2] || '',
      authorEmail: fields[3] || '',
      authoredAt: (fields[4] || '').trim(),
      committedAt: (fields[5] || '').trim(),
      subject,
    },
    body: withBody ? fields.slice(7).join('\x1f').trim() : '',
  }
}

/**
 * Parse `git log --format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%cI%x1f%s%x1e`.
 *
 * `%x1e` terminates each record and git appends a newline after it, so each
 * chunk is trimmed before the fields are read.
 * @param {string} stdout - the log output.
 * @returns {object[]} commits in the order git printed them.
 */
export function parseGitLog(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') return []
  const commits = []
  for (const record of stdout.split('\x1e')) {
    const parsed = parseCommitRecord(record, false)
    if (parsed !== null) commits.push(parsed.commit)
  }
  return commits
}

/**
 * Parse one commit header plus its message body.
 * @param {string} stdout - `git log -1 --format=…%x1f%B` output.
 * @returns {{commit: object, body: string} | null} the commit, or null when unparsable.
 */
export function parseGitCommitDetail(stdout) {
  if (typeof stdout !== 'string') return null
  for (const record of stdout.split('\x1e')) {
    const parsed = parseCommitRecord(record, true)
    if (parsed !== null) return parsed
  }
  return null
}

/**
 * Parse `git diff-tree -r -z --name-status` output.
 *
 * With `-z` every field is NUL-terminated and nothing is quoted, so a renamed
 * or non-ASCII path survives intact. A rename/copy status is followed by two
 * paths; every other status by one.
 * @param {string} stdout - the NUL-separated output.
 * @returns {{status: string, oldPath: string | null, path: string}[]} the changes.
 */
export function parseGitNameStatus(stdout) {
  if (typeof stdout !== 'string' || stdout === '') return []
  const tokens = stdout.split('\0')
  const changes = []
  let index = 0
  while (index < tokens.length) {
    const status = (tokens[index] || '').trim()
    index += 1
    if (!/^[A-Z]\d*$/.test(status)) continue
    const first = tokens[index] ?? ''
    index += 1
    const letter = status.charAt(0)
    if (letter === 'R' || letter === 'C') {
      const to = tokens[index] ?? ''
      index += 1
      changes.push({ status, oldPath: trimGitPath(first), path: trimGitPath(to) })
    } else {
      changes.push({ status, oldPath: null, path: trimGitPath(first) })
    }
  }
  return changes
}

/**
 * Strip git's record newline from a path field.
 *
 * Not a general trim: a path may legitimately end in a space, and only the
 * separator git itself adds should be removed.
 * @param {string} value - a raw `-z` field.
 * @returns {string} the path.
 */
function trimGitPath(value) {
  return String(value ?? '').replace(/[\r\n]+$/, '')
}

/**
 * The display form of one name-status code.
 * @param {unknown} status - e.g. `A`, `M`, `R100`.
 * @returns {{letter: string, label: string, tone: 'add'|'mod'|'del'}} the badge.
 */
export function gitChangeOf(status) {
  const letter = String(status ?? '').charAt(0).toUpperCase()
  switch (letter) {
    case 'A': return { letter: 'A', label: '新增', tone: 'add' }
    case 'D': return { letter: 'D', label: '删除', tone: 'del' }
    case 'R': return { letter: 'R', label: '重命名', tone: 'mod' }
    case 'C': return { letter: 'C', label: '复制', tone: 'mod' }
    case 'T': return { letter: 'T', label: '类型变更', tone: 'mod' }
    case 'U': return { letter: 'U', label: '冲突', tone: 'del' }
    case 'M': return { letter: 'M', label: '修改', tone: 'mod' }
    default: return { letter: letter === '' ? '?' : letter, label: '变更', tone: 'mod' }
  }
}

/**
 * Rebase a repository-relative change path onto the selected root.
 *
 * Two placements are possible and both have to be handled, because a root is
 * either inside a checkout (`rootRelative` names its position in the repo) or
 * above one or more checkouts (`prefix` names the checkout's position in the
 * root). Changes that fall outside the root are reported as such rather than
 * silently dropped: the panel can show them, it just cannot open them.
 * @param {{prefix?: string, rootRelative?: string}} placement - the root/repository relationship.
 * @param {string} filePath - repository-relative path from git.
 * @returns {{path: string, outsideRoot: boolean}} the root-relative path.
 */
export function commitPathWithinRoot(placement, filePath) {
  const prefix = normalizeGitPath(placement?.prefix)
  const rootRelative = normalizeGitPath(placement?.rootRelative)
  const relative = normalizeGitPath(filePath).replace(/^\/+/, '')
  if (relative === '') return { path: '', outsideRoot: false }
  if (prefix !== '') return { path: `${prefix}/${relative}`, outsideRoot: false }
  if (rootRelative === '') return { path: relative, outsideRoot: false }
  if (relative === rootRelative) return { path: '', outsideRoot: false }
  if (relative.startsWith(rootRelative + '/')) {
    return { path: relative.slice(rootRelative.length + 1), outsideRoot: false }
  }
  return { path: relative, outsideRoot: true }
}

/**
 * Translate a root-relative path back to the repository-relative path git wants.
 *
 * The inverse of {@link commitPathWithinRoot}, and the guard that keeps a
 * history read inside the root: a path that does not actually sit under the
 * chosen repository has no repository-relative form and is reported as `null`
 * rather than guessed at.
 *
 * @param {{prefix?: string, rootRelative?: string}} placement - the root/repository relationship.
 * @param {string} filePath - root-relative path from the client.
 * @returns {string | null} the repository-relative path, or null when it falls outside.
 */
export function repoRelativeFromRoot(placement, filePath) {
  const prefix = normalizeGitPath(placement?.prefix)
  const rootRelative = normalizeGitPath(placement?.rootRelative)
  const relative = normalizeGitPath(filePath).replace(/^\/+/, '')
  if (relative === '') return null
  // A repository below the root: the root path must start with the
  // repository's own place inside it, and the remainder is the git path.
  if (prefix !== '') {
    if (relative === prefix) return null
    if (!relative.startsWith(prefix + '/')) return null
    const rest = relative.slice(prefix.length + 1)
    return rest === '' ? null : rest
  }
  // The root sits inside the repository: everything the client names is
  // already relative to the root, so the root's own position is re-prepended.
  if (rootRelative === '') return relative
  return `${rootRelative}/${relative}`
}



/* -------------------------------------------------------------------------- *
 * Remote branches, working-tree changes and commit diffs
 *
 * The panel started with local branches and one commit's changed-file list.
 * The three pieces below extend it: remotes are a separate ref namespace that
 * must not be offered as something to check out; a working-tree change list has
 * to keep staged and unstaged state apart because they mean different things;
 * and a commit diff is one patch covering every file, which needs its own
 * parser rather than the single-file one.
 * -------------------------------------------------------------------------- */

/** How a branch reference relates to the local checkout. */
export const BRANCH_KINDS = Object.freeze(['local', 'remote'])

/**
 * Parse `git branch -a --format=%(HEAD)%09%(refname)%09%(refname:short)…`.
 *
 * Remote refs are reported with their full name so `origin/main` and a local
 * `origin/main` cannot collide, and the `refs/remotes/…/HEAD` symbolic entry is
 * dropped: it points at another remote branch and is not something a reader can
 * browse on its own.
 *
 * @param {string} stdout - the format output.
 * @param {string} [headPrefix] - ref prefix marking a remote-tracking ref.
 * @returns {{name: string, shortName: string, kind: 'local'|'remote', remote: string, current: boolean, sha: string, date: string, upstream: string}[]} branches.
 */
export function parseGitBranchList(stdout, headPrefix = 'refs/remotes/') {
  if (typeof stdout !== 'string' || stdout.trim() === '') return []
  const rows = []
  for (const rawLine of stdout.split('\n')) {
    if (rawLine.trim() === '') continue
    const fields = rawLine.split('\t')
    if (fields.length < 3) continue
    const full = fields[1].trim()
    const shortName = fields[2].trim()
    if (full === '' || shortName === '') continue
    const isRemote = full.startsWith(headPrefix)
    if (isRemote) {
      // `origin/HEAD` is a pointer to another branch, not a branch of its own.
      const tail = full.slice(headPrefix.length)
      if (tail.endsWith('/HEAD')) continue
    }
    // The remote's own name is the first path segment of a remote ref; a local
    // branch may legitimately contain a slash, so this only applies remotely.
    const remote = isRemote ? full.slice(headPrefix.length).split('/')[0] : ''
    rows.push({
      name: full,
      shortName,
      kind: isRemote ? 'remote' : 'local',
      remote,
      current: fields[0].trim() === '*',
      sha: (fields[3] || '').trim(),
      date: (fields[4] || '').trim(),
      upstream: (fields[5] || '').trim(),
    })
  }
  return rows
}

/**
 * The revision to hand git for a branch the panel selected.
 *
 * Remote refs are stored under `refs/remotes/…` and are not on the branch
 * namespace, so `git log origin/main` and `git log refs/remotes/origin/main`
 * are not interchangeable: only the fully qualified form is unambiguous when a
 * local branch shares the short name.
 * @param {{name?: string, kind?: string}} branch - one entry from discovery.
 * @returns {string} the revision to read.
 */
export function revisionOfBranch(branch) {
  const name = typeof branch?.name === 'string' ? branch.name : ''
  if (name === '') return ''
  return branch?.kind === 'remote' ? `refs/remotes/${name.replace(/^refs\/remotes\//, '')}` : name
}

/**
 * Whether a branch is something `git checkout` can switch to.
 *
 * A remote-tracking branch is read-only from the reader's point of view:
 * checking it out silently creates a detached HEAD or a new local branch,
 * depending on git's configuration. The panel therefore offers it for browsing
 * only, which is a decision that belongs here rather than in the UI.
 * @param {{kind?: string}} branch - one entry from discovery.
 * @returns {boolean} true when a checkout is meaningful.
 */
export function isCheckoutableBranch(branch) {
  return branch?.kind !== 'remote'
}

/**
 * Parse `git status --porcelain=v1 -z` into structured changes.
 *
 * `-z` is not cosmetic: without it git quotes non-ASCII paths and uses `->` to
 * separate a rename, which is ambiguous when a filename contains either. With
 * `-z` each record is NUL-terminated and a rename carries two NUL-separated
 * paths.
 *
 * Staged and unstaged state are kept apart because they answer different
 * questions ("what would be committed" vs "what is not staged"), and the panel
 * shows them as two groups the way a source-control view does.
 *
 * @param {string} stdout - the NUL-separated porcelain output.
 * @returns {{path: string, repoPath: string, index: string, worktree: string, staged: boolean, untracked: boolean, ignored: boolean, conflicted: boolean, oldPath: string | null}[]} changes.
 */
export function parseGitStatusEntries(stdout) {
  if (typeof stdout !== 'string' || stdout === '') return []
  const tokens = stdout.split('\0')
  const rows = []
  let index = 0
  while (index < tokens.length) {
    const record = tokens[index]
    index += 1
    if (typeof record !== 'string' || record.length < 4) continue
    const indexCode = record.charAt(0)
    const worktreeCode = record.charAt(1)
    const repoPath = record.slice(3)
    // A rename/copy record carries the original path as the next token.
    let oldPath = null
    if (indexCode === 'R' || indexCode === 'C') {
      const previous = tokens[index] ?? ''
      index += 1
      oldPath = previous === '' ? null : previous
    }
    if (repoPath === '') continue
    rows.push({
      path: repoPath,
      repoPath,
      index: indexCode,
      worktree: worktreeCode,
      // `X` is the index side, `Y` the working tree. `??` is untracked and `!!`
      // ignored; neither has a meaningful index state.
      staged: indexCode !== ' ' && indexCode !== '?' && indexCode !== '!',
      untracked: indexCode === '?',
      ignored: indexCode === '!',
      conflicted: indexCode === 'U' || worktreeCode === 'U'
        || (indexCode === 'A' && worktreeCode === 'A')
        || (indexCode === 'D' && worktreeCode === 'D'),
      oldPath,
    })
  }
  return rows
}

/**
 * The single-letter badge for one status record.
 *
 * A file can be staged and then edited again, which is two facts. The index
 * side wins because that is what a commit would capture, and the working-tree
 * side is reported separately so the row can show "staged, then modified".
 * @param {{index?: string, worktree?: string, untracked?: boolean, conflicted?: boolean}} change - one record.
 * @returns {{letter: string, label: string, tone: 'add'|'mod'|'del'}} the badge.
 */
export function gitStatusBadge(change) {
  if (change?.conflicted === true) return { letter: 'U', label: '冲突', tone: 'del' }
  if (change?.untracked === true) return { letter: '?', label: '未跟踪', tone: 'add' }
  const code = String(change?.index ?? ' ')
  const worktree = String(change?.worktree ?? ' ')
  const pick = code !== ' ' && code !== '?' ? code : worktree
  switch (pick) {
    case 'A': return { letter: 'A', label: '新增', tone: 'add' }
    case 'D': return { letter: 'D', label: '删除', tone: 'del' }
    case 'R': return { letter: 'R', label: '重命名', tone: 'mod' }
    case 'C': return { letter: 'C', label: '复制', tone: 'mod' }
    case 'M': return { letter: 'M', label: '修改', tone: 'mod' }
    default: return { letter: pick === ' ' ? 'M' : pick, label: '变更', tone: 'mod' }
  }
}

/**
 * Parse a multi-file unified diff into per-file sections.
 *
 * `git show`/`git diff` emit `diff --git a/x b/y` headers followed by one or
 * more `@@` hunks per file, so a commit's patch has to be split on those
 * headers before each file's rows are numbered — otherwise every file would
 * share the previous file's line numbers.
 *
 * @param {string} patch - the full patch text.
 * @returns {{path: string, oldPath: string, status: string, rows: object[], added: number, removed: number}[]} one entry per file.
 */
export function parseUnifiedDiffFiles(patch) {
  if (typeof patch !== 'string' || patch.trim() === '') return []
  const files = []
  let current = null
  const flush = () => {
    if (current === null) return
    const rows = parsePatchToRows(current.hunkText)
    let added = 0
    let removed = 0
    for (const row of rows) {
      if (row.type === 'add') added += 1
      else if (row.type === 'del') removed += 1
    }
    files.push({
      path: current.path,
      oldPath: current.oldPath,
      status: current.status,
      rows,
      added,
      removed,
    })
    current = null
  }

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush()
      // `diff --git a/<path> b/<path>` — both sides are quoted only when the
      // path needs escaping, which `-z` avoids elsewhere but not here.
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)
      current = {
        path: match ? match[2] : '',
        oldPath: match ? match[1] : '',
        status: 'M',
        hunkText: '',
      }
      continue
    }
    if (current === null) continue
    if (line.startsWith('new file mode')) { current.status = 'A'; continue }
    if (line.startsWith('deleted file mode')) { current.status = 'D'; continue }
    if (line.startsWith('rename from ')) { current.oldPath = line.slice('rename from '.length); current.status = 'R'; continue }
    if (line.startsWith('rename to ')) { current.path = line.slice('rename to '.length); current.status = 'R'; continue }
    // The `index`, `---` and `+++` lines carry no line content, and feeding
    // them to the hunk parser would misread `--- a/x` as a removed line.
    if (line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) continue
    current.hunkText += line + '\n'
  }
  flush()
  // A section with no hunks is a pure mode/rename change; keep it so the file
  // still appears in the list, but with no rows to draw.
  return files
}

/**
 * Split working-tree changes into the groups a source-control view shows.
 * @param {object[]} changes - records from {@link parseGitStatusEntries}.
 * @param {(path: string) => {path: string, outsideRoot: boolean}} rebase - maps a repo path onto the root.
 * @returns {{staged: object[], unstaged: object[], untracked: object[], conflicted: object[], outside: number}} the groups.
 */
export function groupGitChanges(changes, rebase) {
  const groups = { staged: [], unstaged: [], untracked: [], conflicted: [], outside: 0 }
  for (const change of Array.isArray(changes) ? changes : []) {
    if (change.ignored === true) continue
    const placement = typeof rebase === 'function'
      ? rebase(change.repoPath)
      : { path: change.repoPath, outsideRoot: false }
    if (placement.outsideRoot === true) {
      groups.outside += 1
      continue
    }
    const badge = gitStatusBadge(change)
    const row = {
      path: placement.path,
      repoPath: change.repoPath,
      oldPath: change.oldPath,
      index: change.index,
      worktree: change.worktree,
      letter: badge.letter,
      change: badge.label,
      tone: badge.tone,
      // A file staged and then edited again is two facts; the row keeps both.
      partiallyStaged: change.staged === true && change.worktree !== ' ' && change.worktree !== '?',
      untracked: change.untracked === true,
    }
    if (change.conflicted === true) groups.conflicted.push(row)
    else if (change.untracked === true) groups.untracked.push(row)
    else {
      if (change.staged === true) groups.staged.push(row)
      if (change.worktree !== ' ' && change.worktree !== '?' && change.worktree !== '!') groups.unstaged.push(row)
    }
  }
  return groups
}
