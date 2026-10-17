/**
 * Workspace file viewer — host half.
 *
 * Exposes one RPC channel the browser calls to browse and read files. Reads go
 * through `ctx.fs`, which canonicalizes paths, but its sandbox fences only
 * mutations ("every mode permits reading"), so containment is this plugin's
 * job: every request resolves against a declared root and is refused unless
 * `ctx.fs.contains` puts it under that root. The channel is `trusted-host`, so
 * it inherits the `/api` browser-trust fence (Host/Origin) instead of opening
 * an unauthenticated HTTP route of its own.
 *
 * @module dsh-file-viewer
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'

import z from '@deepseek-ai/schemastery'

import {
  LANGUAGE_CATALOG,
  MAX_BYTES,
  MAX_PREVIEW_BYTES,
  MAX_TEXT_BYTES,
  TEXT_PROBE_BYTES,
  appendMention,
  baseNameOf,
  detectLanguageFromText,
  extensionOf,
  formatDocTextToMarkdown,
  insertMentionAtCaret,
  parentOf,
  isHiddenEntry,
  isSafeRelativePath,
  isTextContent,
  isUtf8TextContent,
  isWholeDocumentKind,
  isKnownLanguage,
  joinPath,
  kindOf,
  langOf,
  normalizeSafePaths,
  parseGitStatus,
  parsePatchToDiffs,
  parsePatchToRows,
  rebaseGitPaths,
  resolveLanguage,
  resolveWindow,
  sanitizeDocHtml,
  sortEntries,
  splitLines,
  summarizeDiffs,
  windowRows,
} from './core.js'

export {
  LANGUAGE_CATALOG,
  MAX_BYTES,
  MAX_PREVIEW_BYTES,
  MAX_TEXT_BYTES,
  TEXT_PROBE_BYTES,
  appendMention,
  baseNameOf,
  detectLanguageFromText,
  extensionOf,
  formatDocTextToMarkdown,
  insertMentionAtCaret,
  parentOf,
  sanitizeDocHtml,
  isHiddenEntry,
  isSafeRelativePath,
  isTextContent,
  isUtf8TextContent,
  isWholeDocumentKind,
  isKnownLanguage,
  joinPath,
  kindOf,
  langOf,
  normalizeSafePaths,
  parseGitStatus,
  parsePatchToDiffs,
  parsePatchToRows,
  rebaseGitPaths,
  resolveLanguage,
  resolveWindow,
  sortEntries,
  splitLines,
  summarizeDiffs,
  windowRows,
}

const execFileAsync = promisify(execFile)

export const name = 'file-viewer'
export const inject = ['fs', 'connection', 'settings', 'workspaceRegistry', 'sessions']
export const NS = 'file-viewer'
export const RPC_CHANNEL = '/dsh-file-viewer'

const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

export function liveField(schema) {
  return typeof schema?.volatile === 'function' ? schema.volatile() : schema
}

export function isVolatileRef(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  if (typeof value.get !== 'function') return false
  return VOLATILE_WRITE in value || Object.keys(value).length === 0
}

export function unwrapConfig(value, seen = new Set()) {
  if (isVolatileRef(value)) return unwrapConfig(value.get(), seen)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return value
  if (Array.isArray(value)) return value.map((item) => unwrapConfig(item, seen))
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unwrapConfig(item, seen)]))
}

export function settingsBase(ctx, config) {
  return unwrapConfig(ctx.fiber?.entry?.options?.config ?? config ?? {})
}

export function settingsNamespace(ctx, fallback = NS) {
  if (typeof ctx.settings?.register === 'function') return fallback
  const id = ctx.fiber?.entry?.options?.id
  return typeof id === 'string' && id.length > 0 ? id : fallback
}

export function resolveDshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

export function defaultSettingsFilePath() {
  return path.join(resolveDshHome(), 'file-viewer', 'settings.json')
}

export function resolveSettingsFilePath(configuredPath) {
  if (typeof configuredPath !== 'string' || configuredPath.trim() === '') {
    return defaultSettingsFilePath()
  }
  const trimmed = configuredPath.trim()
  const home = os.homedir()
  if (trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(home, trimmed.slice(2))
  }
  return path.resolve(trimmed)
}

export function readPersistedSettings(filePath) {
  try {
    const target = filePath || defaultSettingsFilePath()
    if (!fs.existsSync(target)) return null
    const text = fs.readFileSync(target, 'utf8')
    const data = JSON.parse(text)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    return data
  } catch (_) {
    return null
  }
}

export function writePersistedSettings(filePath, patch) {
  try {
    const target = filePath || defaultSettingsFilePath()
    const current = readPersistedSettings(target) || {}
    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify(next, null, 2) + '\n', 'utf8')
    return true
  } catch (_) {
    return false
  }
}

export function openSettingsScope(ctx, config) {
  if (typeof ctx.settings?.register === 'function') {
    const scope = ctx.settings.register(NS, Config, { base: settingsBase(ctx, config) })
    return { ...scope, get: () => unwrapConfig(scope.get()) }
  }
  const ns = settingsNamespace(ctx, NS)
  const read = () => {
    const raw = typeof ctx.settings?.get === 'function' ? ctx.settings.get(ns) : config
    return unwrapConfig(Config(unwrapConfig(raw ?? {})))
  }
  return {
    get: read,
    watch(listener) {
      if (typeof ctx.on !== 'function') return () => {}
      return ctx.on('loader/volatile-update', () => listener(read()))
    },
    async update(patch) {
      if (typeof ctx.settings?.mutate !== 'function') return
      const ops = Object.entries(patch).map(([key, value]) => ({ op: 'set', path: [key], value }))
      await ctx.settings.mutate(ns, ops)
    },
    async replace(section) {
      if (typeof ctx.settings?.replace !== 'function') return
      await ctx.settings.replace(ns, section)
    },
  }
}

const PathEntry = z.union([
  z.string(),
  z.object({
    path: z.string(),
    label: z.string().default(''),
    name: z.string().default(''),
  }),
])

export const Config = z.object({
  safePaths: liveField(z.union([z.array(PathEntry), z.string()]).default([])).description('安全访问路径（除工作区外的可访问路径列表）'),
  safeAccessPaths: liveField(z.union([z.array(PathEntry), z.string()]).default([])).description('安全访问路径（safePaths 别名）'),
  extraRoots: liveField(z.union([z.array(PathEntry), z.string()]).default([])).description('额外根目录（向后兼容 safePaths）'),
  maxBytes: z.natural().default(MAX_BYTES),
  settingsFile: z.string().default('').description('安全访问路径本地持久化配置文件路径（留空则默认保存在 ~/.dsh/file-viewer/settings.json）'),
})

/**
 * Resolve the viewer kind for a file and, when the name said nothing, the
 * leading text a language guess can read.
 *
 * Path-based heuristics (kindOf) classify every known format, but files with
 * unrecognised extensions — `env.dev`, `env.staging`, `config.yaml.prod`,
 * shell scripts without a known suffix, config files without a recognised
 * basename, dotfiles, etc. — fall through to `'binary'`. This function peeks
 * at the first bytes of such files and promotes them to `'text'` when they
 * contain no null bytes, matching the heuristic used by git and `file(1)`.
 *
 * The probe reads a *window* through `readByteRange`, deliberately not
 * `readBytes`: that primitive's `maxBytes` bounds the complete file and it
 * fails with `FS_TOO_LARGE` instead of truncating, so probing an unknown
 * 16 KB file with an 8 KB cap threw and every such file stayed `'binary'`.
 * A window is bounded by its own length regardless of file size, which is
 * what makes this a probe rather than a read.
 *
 * The same window answers the language guess, so an unknown file costs one
 * read, not two. The sample is returned only when the probe actually ran and
 * the bytes decoded as UTF-8; a name-classified file carries none, because
 * its extension already decided the language.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {object} target - a resolved fs target from resolveInRoot.
 * @param {string} naming - the display name / relative path.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<{kind: string, sample: string | undefined}>} the viewer kind and optional sample.
 */
async function resolveKind(ctx, target, naming, signal) {
  const kind = kindOf(naming)
  if (kind !== 'binary') return { kind, sample: undefined }
  // Content-based detection for any file classified as binary by name alone.
  // The null-byte heuristic (same as git and file(1)) is reliable: genuine
  // binary formats (ELF, PE, PNG, MP4, etc.) almost always contain a null
  // byte within the first 8 KB, while text files rarely do.
  try {
    const bytes = await readProbe(ctx, target, signal)
    if (isTextContent(bytes) && isUtf8TextContent(bytes)) {
      // Decoded non-fatally: the sample already passed the UTF-8 check, and a
      // character split by the window boundary must not lose the whole probe.
      return { kind: 'text', sample: new TextDecoder('utf-8').decode(bytes) }
    }
  } catch {
    // Read failure is not a classification failure — stay 'binary'.
  }
  return { kind, sample: undefined }
}

/**
 * Read the leading bytes of a file for text/binary classification.
 *
 * Prefers `readByteRange`, whose window is the bound. Falls back to
 * `readBytes` for hosts that predate that primitive, where the cap must be
 * the probe size and an oversized file therefore stays classified by name.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {object} target - a resolved fs target.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<Uint8Array>} at most TEXT_PROBE_BYTES leading bytes.
 */
async function readProbe(ctx, target, signal) {
  if (typeof ctx.fs.readByteRange === 'function') {
    return ctx.fs.readByteRange(target, { offset: 0, length: TEXT_PROBE_BYTES }, signal)
  }
  return ctx.fs.readBytes(target, signal, TEXT_PROBE_BYTES)
}

/** Structured failures the client switches on; messages never echo a path. */
export class ViewerError extends Error {
  /**
   * @param {string} code - stable machine-readable reason.
   * @param {string} message - operator-facing summary, free of path details.
   * @param {object} [details] - structured machine-readable payload.
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'ViewerError'
    this.code = code
    this.details = details
  }
}

/**
 * Collect the directories this deployment is willing to serve: every
 * registered workspace, every live session's cwd, and configured safe access paths
 * (or legacy extra roots). There is no host-side notion of an "active" workspace — that lives
 * only in browser UI state — so the client picks from this set.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => {safePaths?: unknown, safeAccessPaths?: unknown, extraRoots?: unknown}} options - resolved config reader.
 * @returns {{id: string, label: string, path: string, kind: 'workspace'|'session'|'safe-path'}[]} ordered, de-duplicated roots.
 */
export function collectRoots(ctx, options) {
  const seen = new Map()
  const add = (path, label, kind = 'workspace') => {
    if (typeof path !== 'string' || path === '') return
    const isSlash = path === '/' || path === '\\'
    const key = isSlash ? '/' : path.replace(/[\\/]+$/, '')
    if (key === '' || seen.has(key)) return
    const defaultLabel = isSlash ? '根目录 (/)' : (baseNameOf(key) || key)
    seen.set(key, { id: key, label: label || defaultLabel, path: key, kind })
  }

  for (const workspace of ctx.workspaceRegistry?.list?.() ?? []) add(workspace?.path, workspace?.name, 'workspace')
  for (const session of ctx.sessions?.list?.() ?? []) add(session?.header?.cwd, undefined, 'session')

  const opts = typeof options === 'function' ? (options() ?? {}) : (options ?? {})
  const home = os.homedir()
  const safeEntries = [
    ...normalizeSafePaths(opts.safePaths, home),
    ...normalizeSafePaths(opts.safeAccessPaths, home),
    ...normalizeSafePaths(opts.extraRoots, home),
  ]
  for (const entry of safeEntries) {
    add(entry.path, entry.label, 'safe-path')
  }
  return [...seen.values()]
}

/**
 * Resolve `{root, path}` into a target proven to sit under a declared root.
 *
 * Two fences, deliberately layered: the cheap shape check rejects absolute
 * paths and `..` segments before touching the disk, and `ctx.fs.contains`
 * compares canonicalized identities afterwards, which is the only check a
 * symlink cannot walk around.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => {safePaths?: unknown, safeAccessPaths?: unknown, extraRoots?: unknown}} options - resolved config reader.
 * @param {{root?: string, path?: string}} payload - client request.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<{root: {id: string, path: string, kind?: string}, target: object, relative: string, absolute: string}>} the vetted target.
 */
export async function resolveInRoot(ctx, options, payload, signal) {
  const roots = collectRoots(ctx, options)
  if (roots.length === 0) throw new ViewerError('no-roots', 'no workspace roots are available to browse')

  const requested = payload?.root
  const home = os.homedir()
  const normReq = typeof requested === 'string' && (requested === '~' || requested.startsWith('~/') || requested.startsWith('~\\'))
    ? path.join(home, requested === '~' ? '' : requested.slice(2))
    : requested
  const isSlash = normReq === '/' || normReq === '\\'
  const reqKey = isSlash ? '/' : String(normReq ?? '').replace(/[\\/]+$/, '')
  const root = requested === undefined || requested === null || requested === ''
    ? roots[0]
    : roots.find((candidate) => candidate.id === reqKey)
  if (root === undefined) throw new ViewerError('unknown-root', 'the requested root is not served by this deployment')

  const relative = payload?.path === undefined || payload?.path === null ? '' : String(payload.path)
  if (!isSafeRelativePath(relative)) throw new ViewerError('outside-root', 'the requested path escapes its root')

  const rootTarget = await ctx.fs.resolve(root.path, { signal })
  const target = relative === '' ? rootTarget : await ctx.fs.resolve(joinPath(root.path, relative), { signal })
  if (target.targetKey !== rootTarget.targetKey && !ctx.fs.contains(rootTarget, target)) {
    // If the path escapes the current root (e.g. symlink to an external target),
    // check if the real target is contained within any other authorized root
    // (such as a configured safe access path or another registered workspace).
    let allowedByOtherRoot = false
    for (const candidateRoot of roots) {
      if (candidateRoot === root) continue
      try {
        const candidateTarget = await ctx.fs.resolve(candidateRoot.path, { signal })
        if (target.targetKey === candidateTarget.targetKey || ctx.fs.contains(candidateTarget, target)) {
          allowedByOtherRoot = true
          break
        }
      } catch (_) {}
    }
    if (!allowedByOtherRoot) {
      throw new ViewerError('outside-root', 'the requested path escapes its root', {
        realPath: String(target.targetKey ?? target.displayPath),
      })
    }
  }
  return { root, target, relative, absolute: ctx.fs.processPath?.(target) ?? target.displayPath }
}

/**
 * List one directory, ordered for display.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - resolved config reader.
 * @param {{root?: string, path?: string, hidden?: boolean}} payload - client request.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<object>} the listing.
 */
export async function listDirectory(ctx, options, payload, signal) {
  const { root, target, relative } = await resolveInRoot(ctx, options, payload, signal)
  const info = await ctx.fs.stat(target, signal)
  if (info === undefined) throw new ViewerError('not-found', 'the requested directory does not exist')
  if (info.type !== 'directory') throw new ViewerError('not-a-directory', 'the requested path is not a directory')

  const showHidden = payload?.hidden === true
  const entries = await ctx.fs.listDir(target, signal)
  const rows = entries
    .filter((entry) => showHidden || !isHiddenEntry(entry.name))
    .map((entry) => ({
      name: entry.name,
      type: entry.type,
      path: relative === '' ? entry.name : `${relative.replace(/[\\/]+$/, '')}/${entry.name}`,
      ...(entry.type === 'file' ? { kind: kindOf(entry.name) } : {}),
      ...(typeof entry.size === 'number' ? { size: entry.size } : {}),
    }))
  return { root: root.id, path: relative, entries: sortEntries(rows) }
}

/**
 * Describe one file so the client can choose a viewer before fetching content.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => {maxBytes: number}} options - resolved config reader.
 * @param {{root?: string, path?: string}} payload - client request.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<object>} file metadata plus the chosen viewer kind.
 */
export async function describeFile(ctx, options, payload, signal) {
  const { root, target, relative } = await resolveInRoot(ctx, options, payload, signal)
  const info = await ctx.fs.stat(target, signal)
  if (info === undefined) throw new ViewerError('not-found', 'the requested file does not exist')
  if (info.type === 'directory') throw new ViewerError('is-a-directory', 'the requested path is a directory')

  const size = typeof info.size === 'number' ? info.size : undefined
  const naming = relative === '' ? target.displayPath : relative
  const probe = await resolveKind(ctx, target, naming, signal)
  const kind = probe.kind
  // The override travels with the request so the picker's choice survives a
  // reload without the host having to store per-file preferences.
  const detected = resolveLanguage({ override: payload?.lang, path: naming, sample: probe.sample })
  const lang = detected.lang
  const textual = kind === 'text' || isWholeDocumentKind(kind)
  const limit = textual ? MAX_TEXT_BYTES : options().maxBytes
  return {
    root: root.id,
    path: relative,
    name: baseNameOf(naming),
    displayPath: target.displayPath,
    kind,
    ...(size === undefined ? {} : { size }),
    ...(lang === undefined ? {} : { lang }),
    langSource: detected.source,
    // What the picker should show. "auto" whenever the user has not pinned a
    // grammar: a content-detected language is the host's decision, not the
    // user's, and showing it as the selected option would misrepresent an
    // automatic guess as an explicit choice. The resolved id is reported
    // separately in `lang`, and `langSource` explains how it was reached.
    langChoice: isKnownLanguage(payload?.lang) ? payload.lang : 'auto',
    tooLarge: size !== undefined && size > limit,
    limit,
  }
}

/**
 * Read one window of a text file as numbered rows.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - resolved config reader.
 * @param {{root?: string, path?: string, offset?: number, limit?: number}} payload - client request.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<object>} the window plus totals for paging.
 */
export async function readText(ctx, options, payload, signal) {
  const { root, target, relative } = await resolveInRoot(ctx, options, payload, signal)
  const info = await ctx.fs.stat(target, signal)
  if (info === undefined) throw new ViewerError('not-found', 'the requested file does not exist')
  if (info.type === 'directory') throw new ViewerError('is-a-directory', 'the requested path is a directory')
  if (typeof info.size === 'number' && info.size > MAX_TEXT_BYTES) {
    throw new ViewerError('too-large', 'the requested file is too large to read as text')
  }

  const text = await ctx.fs.readText(target, signal)
  const { lines, eol } = splitLines(text)
  const window = resolveWindow(lines.length, payload?.offset, payload?.limit)
  const naming = relative === '' ? target.displayPath : relative
  const probe = await resolveKind(ctx, target, naming, signal)
  const fileKind = probe.kind
  // The whole file is in hand here, so the language guess reads the real text
  // rather than the 8 KB probe window — the richest sample available.
  const detected = resolveLanguage({ override: payload?.lang, path: naming, sample: text })
  const lang = detected.lang
  return {
    root: root.id,
    path: relative,
    name: baseNameOf(naming),
    displayPath: target.displayPath,
    kind: fileKind,
    ...(lang === undefined ? {} : { lang }),
    langSource: detected.source,
    // See describeFile: "auto" unless the user pinned a grammar themselves.
    langChoice: isKnownLanguage(payload?.lang) ? payload.lang : 'auto',
    eol,
    totalLines: lines.length,
    offset: window.offset,
    end: window.end,
    hasBefore: window.hasBefore,
    hasAfter: window.hasAfter,
    lines: windowRows(lines, window),
    // Markdown and JSON render from the whole document — a window would show
    // half a table or a truncated object — so they ship complete regardless of
    // paging, up to a budget past which the client keeps the paged source view.
    ...(isWholeDocumentKind(fileKind) && text.length <= MAX_PREVIEW_BYTES ? { text } : {}),
  }
}

/**
 * Read a bounded binary file as base64 for a blob URL in the browser.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => {maxBytes: number}} options - resolved config reader.
 * @param {{root?: string, path?: string}} payload - client request.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<object>} base64 bytes plus the media type to stamp.
 */
export async function readBytes(ctx, options, payload, signal) {
  const { root, target, relative } = await resolveInRoot(ctx, options, payload, signal)
  const info = await ctx.fs.stat(target, signal)
  if (info === undefined) throw new ViewerError('not-found', 'the requested file does not exist')
  if (info.type === 'directory') throw new ViewerError('is-a-directory', 'the requested path is a directory')

  const maxBytes = options().maxBytes
  if (typeof info.size === 'number' && info.size > maxBytes) {
    throw new ViewerError('too-large', 'the requested file is larger than the viewer limit')
  }

  const bytes = await ctx.fs.readBytes(target, signal, maxBytes)
  return {
    root: root.id,
    path: relative,
    name: baseNameOf(relative === '' ? target.displayPath : relative),
    kind: kindOf(relative === '' ? target.displayPath : relative),
    size: bytes.length,
    base64: Buffer.from(bytes).toString('base64'),
  }
}

/** Rows past this are dropped; a viewer cannot usefully show more at once. */
export const MAX_SHEET_ROWS = 2000

/** Columns past this are dropped for the same reason. */
export const MAX_SHEET_COLUMNS = 64

/**
 * Render one ExcelJS cell as a display string. Formula cells show their cached
 * result, rich text collapses to its runs, and dates use ISO day precision so
 * the browser never has to guess a locale.
 * @param {unknown} value - `cell.value` from ExcelJS.
 * @returns {string} the display text.
 */
export function cellText(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value.richText)) return value.richText.map((run) => run?.text ?? '').join('')
  if (value.text !== undefined) return String(value.text)
  if (value.result !== undefined) return String(value.result)
  if (value.hyperlink !== undefined) return String(value.hyperlink)
  if (value.error !== undefined) return String(value.error)
  return ''
}

/**
 * Read a workbook into plain row arrays.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - resolved config reader.
 * @param {{root?: string, path?: string}} payload - client request.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<object>} one entry per worksheet.
 */
export async function readSheet(ctx, options, payload, signal) {
  const { root, target, relative } = await resolveInRoot(ctx, options, payload, signal)
  const info = await ctx.fs.stat(target, signal)
  if (info === undefined) throw new ViewerError('not-found', 'the requested file does not exist')
  if (info.type === 'directory') throw new ViewerError('is-a-directory', 'the requested path is a directory')

  let ExcelJS
  try {
    ExcelJS = (await import('exceljs')).default
  } catch {
    throw new ViewerError('unsupported', 'the host is missing the spreadsheet reader dependency')
  }

  const bytes = await ctx.fs.readBytes(target, signal, options().maxBytes)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(bytes))

  const sheets = workbook.worksheets.map((worksheet) => {
    const columns = Math.min(worksheet.columnCount || 0, MAX_SHEET_COLUMNS)
    const rows = []
    let truncated = worksheet.rowCount > MAX_SHEET_ROWS || (worksheet.columnCount || 0) > MAX_SHEET_COLUMNS
    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      if (rowNumber > MAX_SHEET_ROWS) return
      const cells = []
      for (let column = 1; column <= columns; column += 1) cells.push(cellText(row.getCell(column).value))
      // Drop trailing empties so a sparse sheet does not render a wall of blanks.
      while (cells.length > 0 && cells.at(-1) === '') cells.pop()
      rows.push(cells)
    })
    while (rows.length > 0 && rows.at(-1).length === 0) rows.pop()
    if (rows.length > MAX_SHEET_ROWS) {
      rows.length = MAX_SHEET_ROWS
      truncated = true
    }
    return { name: worksheet.name, rows, truncated }
  })

  return { root: root.id, path: relative, name: baseNameOf(relative), sheets }
}

/**
 * Try converting a .doc file to .docx using host tools (soffice / libreoffice) if available.
 * Returns null if no host tool is available, or if conversion fails/times out.
 * @param {string} filePath - absolute path on host.
 * @param {AbortSignal} [signal] - cancellation signal.
 * @returns {Promise<Buffer|null>} converted docx buffer or null.
 */
async function tryConvertDocWithHost(filePath, signal) {
  if (typeof filePath !== 'string' || filePath === '') return null
  const candidates = process.platform === 'win32'
    ? ['soffice.exe', 'soffice']
    : ['soffice', 'libreoffice']

  for (const cmd of candidates) {
    try {
      const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'dsh-doc-'))
      try {
        await execFileAsync(cmd, [
          '--headless',
          '--invisible',
          '--nologo',
          '--convert-to',
          'docx',
          filePath,
          '--outdir',
          tmpDir,
        ], { timeout: 8000, signal })

        const convertedName = path.basename(filePath, path.extname(filePath)) + '.docx'
        const convertedPath = path.join(tmpDir, convertedName)
        const docxBuffer = await fsPromises.readFile(convertedPath)
        if (docxBuffer && docxBuffer.length > 0) return docxBuffer
      } finally {
        await fsPromises.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      }
    } catch (_) {
      // Command absent or conversion failed -> try next or fallback
    }
  }
  return null
}

/**
 * Convert a Word document to Markdown. Markdown rather than mammoth's HTML on
 * purpose: the client renders it with `MarkdownText`, which already refuses raw
 * HTML and unsafe protocols, so an untrusted document cannot inject markup.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - resolved config reader.
 * @param {{root?: string, path?: string}} payload - client request.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<object>} the Markdown plus conversion warnings.
 */
export async function readDoc(ctx, options, payload, signal) {
  const { root, target, relative } = await resolveInRoot(ctx, options, payload, signal)
  const info = await ctx.fs.stat(target, signal)
  if (info === undefined) throw new ViewerError('not-found', 'the requested file does not exist')
  if (info.type === 'directory') throw new ViewerError('is-a-directory', 'the requested path is a directory')

  const bytes = await ctx.fs.readBytes(target, signal, options().maxBytes)
  const ext = extensionOf(relative)

  // 1. For legacy .doc binary files:
  if (ext === 'doc') {
    // 1a. Try host office conversion (soffice / libreoffice) if available
    const hostPath = ctx.fs.processPath?.(target) ?? target.displayPath
    const convertedDocx = await tryConvertDocWithHost(hostPath, signal)
    if (convertedDocx) {
      try {
        const mammoth = (await import('mammoth')).default
        const converted = await mammoth.convertToMarkdown({ buffer: convertedDocx })
        return {
          root: root.id,
          path: relative,
          name: baseNameOf(relative),
          markdown: converted.value ?? '',
          warnings: (converted.messages ?? []).map((entry) => entry?.message ?? String(entry)),
        }
      } catch (_) {}
    }

    // 1b. Universal pure Node.js fallback: word-extractor + formatDocTextToMarkdown
    let WordExtractor
    try {
      WordExtractor = (await import('word-extractor')).default
    } catch {
      throw new ViewerError('unsupported', 'the host is missing the document reader dependency')
    }
    try {
      const extractor = new WordExtractor()
      const doc = await extractor.extract(Buffer.from(bytes))
      const body = doc.getBody({ filterUnicode: false }) ?? ''
      const footers = (doc.getFootnotes({ filterUnicode: false }) ?? '').trim()
      let markdown = formatDocTextToMarkdown(body)
      if (footers) {
        markdown += '\n\n---\n**脚注 / 尾注：**\n\n' + formatDocTextToMarkdown(footers)
      }
      return {
        root: root.id,
        path: relative,
        name: baseNameOf(relative),
        markdown: markdown || '',
        warnings: [],
      }
    } catch (err) {
      ctx.logger?.warn?.(`file-viewer: word-extractor failed on ${relative}: ${err?.message}`)
      throw new ViewerError('read-failed', '无法解析该 .doc 文档，文件可能已损坏或格式不兼容')
    }
  }

  // 2. For .docx files, use mammoth for rich HTML and Markdown conversion
  let mammoth
  try {
    mammoth = (await import('mammoth')).default
  } catch {
    throw new ViewerError('unsupported', 'the host is missing the document reader dependency')
  }

  try {
    const convertedHtml = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })
    const convertedMd = await mammoth.convertToMarkdown({ buffer: Buffer.from(bytes) })
    return {
      root: root.id,
      path: relative,
      name: baseNameOf(relative),
      html: sanitizeDocHtml(convertedHtml.value ?? ''),
      markdown: convertedMd.value ?? '',
      warnings: (convertedHtml.messages ?? []).map((entry) => entry?.message ?? String(entry)),
    }
  } catch (err) {
    // If mammoth failed (e.g. non-standard docx or renamed doc), fallback to word-extractor
    try {
      const WordExtractor = (await import('word-extractor')).default
      const extractor = new WordExtractor()
      const doc = await extractor.extract(Buffer.from(bytes))
      const body = doc.getBody({ filterUnicode: false }) ?? ''
      return {
        root: root.id,
        path: relative,
        name: baseNameOf(relative),
        markdown: formatDocTextToMarkdown(body),
        warnings: ['由备用文档提取器解析'],
      }
    } catch {
      throw new ViewerError('read-failed', '无法解析该文档内容')
    }
  }
}

/**
 * Resolve which root a session or path belongs to, so the viewer opens on the
 * project the reader is working in and can directly select a target file.
 *
 * A session's `cwd` or target path may sit inside a workspace rather than be
 * one, so the deepest containing root wins and the remainder is returned as a
 * path to reveal in the tree (and optionally select as active file).
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - resolved config reader.
 * @param {{sessionId?: string, path?: string, filePath?: string}} payload - client request.
 * @returns {Promise<{roots: object[], root?: string, reveal?: string, selectFile?: string}>} roots plus the target position.
 */
export async function resolveSessionRoot(ctx, options, payload) {
  const roots = collectRoots(ctx, options)
  const sessionId = payload?.sessionId
  const targetPath = typeof payload?.filePath === 'string' && payload.filePath !== ''
    ? payload.filePath
    : typeof payload?.path === 'string' && payload.path !== ''
      ? payload.path
      : ''

  const session = typeof sessionId === 'string' && sessionId !== '' ? ctx.sessions?.get?.(sessionId) : undefined
  const cwd = session?.header?.cwd ?? session?.header?.meta?.cwd

  const home = os.homedir()
  const expandHome = (p) => {
    if (typeof p !== 'string' || !p) return ''
    if (p === '~') return home
    if (p.startsWith('~/') || p.startsWith('~\\')) {
      return path.join(home, p.slice(2))
    }
    return p
  }

  // If a target path is given, resolve it either absolutely or relative to cwd/roots
  let candidatePath = ''
  if (targetPath !== '') {
    const isHome = targetPath === '~' || targetPath.startsWith('~/') || targetPath.startsWith('~\\')
    if (isHome) {
      candidatePath = expandHome(targetPath)
    } else if (isSafeRelativePath(targetPath) && !/^[A-Za-z]:|^[\\/]/.test(targetPath) && typeof cwd === 'string' && cwd !== '') {
      candidatePath = joinPath(cwd, targetPath)
    } else {
      candidatePath = targetPath
    }
  } else if (typeof cwd === 'string' && cwd !== '') {
    candidatePath = expandHome(cwd)
  }

  if (candidatePath === '') return { roots }

  const isSlashCandidate = candidatePath === '/' || candidatePath === '\\'
  const key = isSlashCandidate ? '/' : candidatePath.replace(/[\\/]+$/, '').replace(/\\/g, '/')
  const fold = (value) => value.toLowerCase()
  let best
  for (const root of roots) {
    const isSlash = root.id === '/' || root.id === '\\'
    const rootKey = isSlash ? '/' : root.id.replace(/[\\/]+$/, '').replace(/\\/g, '/')
    const sameRoot = fold(key) === fold(rootKey)
    if (sameRoot || (isSlash ? fold(key).startsWith('/') : fold(key).startsWith(fold(rootKey) + '/'))) {
      if (best === undefined || rootKey.length > best.rootKey.length) best = { root, rootKey, sameRoot, isSlash }
    }
  }

  if (best === undefined) {
    // An unanchored relative path (no session cwd matched any root) has no
    // trustworthy root; only resolve it when it provably exists under the
    // default root, otherwise leave the picker on the plain root list.
    if (targetPath !== '' && isSafeRelativePath(targetPath) && roots.length > 0) {
      const defaultRoot = roots[0]
      const rel = targetPath.replace(/\\/g, '/').replace(/^\.?\//, '')
      try {
        const rootTarget = await ctx.fs.resolve(defaultRoot.path)
        const target = await ctx.fs.resolve(joinPath(defaultRoot.path, rel))
        if (ctx.fs.contains(rootTarget, target)) {
          const stat = await ctx.fs.stat(target)
          if (stat !== undefined) {
            const isFile = stat.type === 'file'
            return {
              roots,
              root: defaultRoot.id,
              reveal: isFile ? parentOf(rel) : rel,
              ...(isFile ? { selectFile: rel } : {}),
            }
          }
        }
      } catch (_) {}
    }
    return { roots }
  }

  const relative = best.sameRoot
    ? ''
    : best.isSlash
      ? key.replace(/^\/+/, '')
      : key.slice(best.rootKey.length + 1)
  // The exists-guard applies only to a clicked target path, never to the
  // session cwd reveal: the working directory must always open in the tree
  // even when the backing store cannot stat it (e.g. an empty fake in tests,
  // or a shallow-mounted root).
  if (targetPath === '') {
    return { roots, root: best.root.id, reveal: relative }
  }

  let isFile = false
  let exists = false
  if (relative !== '') {
    try {
      const rootTarget = await ctx.fs.resolve(best.root.path)
      const target = await ctx.fs.resolve(joinPath(best.root.path, relative))
      if (ctx.fs.contains(rootTarget, target)) {
        const stat = await ctx.fs.stat(target)
        exists = stat !== undefined
        isFile = stat?.type === 'file'
      }
    } catch (_) {}
  }

  return {
    roots,
    root: best.root.id,
    // Only reveal/select a target that actually exists; a stale file click
    // (deleted since render) degrades to the plain root listing instead of
    // navigating to a missing directory.
    reveal: exists ? (isFile ? parentOf(relative) : relative) : '',
    ...(exists && isFile ? { selectFile: relative } : {}),
  }
}

/**
 * Obtain git diff for a single file within a vetted root.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - config reader.
 * @param {{root?: string, path?: string}} payload - client request.
 * @param {AbortSignal} [signal] - cancellation signal.
 * @returns {Promise<{hasDiff: boolean, source?: string, diffs: Array<{path: string, oldText: string | null, newText: string}>, summary?: {added: number, removed: number}}>}
 */
export async function getFileDiff(ctx, options, payload, signal) {
  const { root, target, relative } = await resolveInRoot(ctx, options, payload, signal)
  if (relative === '') return { hasDiff: false, diffs: [] }

  const absPath = ctx.fs.processPath?.(target) ?? target.displayPath
  const fileDir = path.dirname(absPath)
  const normRel = relative.replace(/\\/g, '/')

  // 1. Locate the nearest git repository containing this file by checking fileDir
  let repoRoot = ''
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd: fileDir,
      encoding: 'utf8',
      signal,
    })
    repoRoot = stdout.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  } catch (_) {
    // If not found from fileDir, try root.path
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
        cwd: root.path,
        encoding: 'utf8',
        signal,
      })
      repoRoot = stdout.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    } catch (_) {
      return { hasDiff: false, diffs: [] }
    }
  }

  // Path of the file relative to the git repo root
  let repoRel = path.relative(repoRoot, absPath).replace(/\\/g, '/')
  if (repoRel.startsWith('..')) {
    repoRel = normRel
  }

  // Parse a patch into hunks but always stamp the root-relative display path (normRel).
  const parseForDisplay = (patch) => parsePatchToDiffs(patch, normRel).map((hunk) => ({ ...hunk, path: normRel }))

  // 2. Try working tree diff (covers both staged and unstaged edits)
  try {
    const { stdout: diffStdout } = await execFileAsync('git', ['diff', 'HEAD', '--', repoRel], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      signal,
    })
    if (diffStdout && diffStdout.trim() !== '') {
      const diffs = parseForDisplay(diffStdout)
      const rows = parsePatchToRows(diffStdout)
      if (diffs.length > 0 || rows.length > 0) {
        return { hasDiff: true, source: 'working-tree', diffs, rows, patch: diffStdout, summary: summarizeDiffs(diffs) }
      }
    }
  } catch (_) {}

  // 3. Check untracked files
  try {
    const { stdout: statusStdout } = await execFileAsync('git', ['status', '--porcelain', '--', repoRel], {
      cwd: repoRoot,
      encoding: 'utf8',
      signal,
    })
    if (statusStdout && (statusStdout.trim().startsWith('??') || statusStdout.trim().startsWith('A '))) {
      const text = await ctx.fs.readText(target, signal)
      const diffs = [{ path: normRel, oldText: null, newText: text }]
      const rows = parsePatchToRows('', text)
      return { hasDiff: true, source: 'untracked', diffs, rows, summary: summarizeDiffs(diffs) }
    }
  } catch (_) {}

  // 4. Fallback to latest commit diff for the file
  try {
    const { stdout: logStdout } = await execFileAsync('git', ['log', '-p', '-1', '--', repoRel], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      signal,
    })
    if (logStdout && logStdout.trim() !== '') {
      const diffs = parseForDisplay(logStdout)
      const rows = parsePatchToRows(logStdout)
      if (diffs.length > 0 || rows.length > 0) {
        return { hasDiff: true, source: 'latest-commit', diffs, rows, patch: logStdout, summary: summarizeDiffs(diffs) }
      }
    }
  } catch (_) {}

  return { hasDiff: false, diffs: [] }
}

/**
 * Obtain workspace-wide git status for badges in the tree.
 *
 * `git status --porcelain` reports paths relative to the repository root, but
 * the tree's `entry.path` is relative to the selected root, which may be a
 * subdirectory or parent directory of git repositories.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - config reader.
 * @param {{root?: string}} payload - client request.
 * @param {AbortSignal} [signal] - cancellation signal.
 * @returns {Promise<{modified: string[], untracked: string[]}>}
 */
export async function getWorkspaceGitStatus(ctx, options, payload, signal) {
  const { root } = await resolveInRoot(ctx, options, { root: payload?.root, path: '' }, signal)
  const rootPath = root.path

  const allModified = new Set()
  const allUntracked = new Set()

  let isSingleRepo = false
  try {
    const { stdout: toplevelOut } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd: rootPath,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      signal,
    })
    const repoRoot = toplevelOut.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    const rootKey = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
    let prefix = ''
    if (rootKey !== repoRoot) {
      if (rootKey.startsWith(repoRoot + '/')) {
        prefix = rootKey.slice(repoRoot.length + 1)
      } else {
        return { modified: [], untracked: [] }
      }
    }

    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: rootPath,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      signal,
    })
    const raw = parseGitStatus(stdout)
    for (const p of rebaseGitPaths(raw.modified, prefix)) allModified.add(p)
    for (const p of rebaseGitPaths(raw.untracked, prefix)) allUntracked.add(p)
    isSingleRepo = true
  } catch (_) {}

  // If rootPath itself is not a git repo, discover git repos in subdirectories
  if (!isSingleRepo) {
    try {
      const entries = await fsPromises.readdir(rootPath, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const subDir = path.join(rootPath, entry.name)
        try {
          await fsPromises.stat(path.join(subDir, '.git'))
          const { stdout: subStatus } = await execFileAsync('git', ['status', '--porcelain'], {
            cwd: subDir,
            encoding: 'utf8',
            maxBuffer: 4 * 1024 * 1024,
            signal,
          })
          const raw = parseGitStatus(subStatus)
          for (const item of raw.modified) allModified.add(entry.name + '/' + item)
          for (const item of raw.untracked) allUntracked.add(entry.name + '/' + item)
        } catch (_) {}
      }
    } catch (_) {}
  }

  return {
    modified: [...allModified],
    untracked: [...allUntracked],
  }
}

/**
 * Retrieve current safe access paths configuration along with built-in workspaces.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - config reader.
 * @returns {Promise<{safePaths: Array<{path: string, label: string}>, builtInWorkspaces: Array<{path: string, name: string}>}>}
 */
export async function getSafePathsConfig(ctx, options) {
  const opts = typeof options === 'function' ? options() : options
  const home = os.homedir()
  const safePaths = [
    ...normalizeSafePaths(opts?.safePaths, home),
    ...normalizeSafePaths(opts?.safeAccessPaths, home),
    ...normalizeSafePaths(opts?.extraRoots, home),
  ]
  const builtInWorkspaces = (ctx.workspaceRegistry?.list?.() ?? []).map((w) => ({
    path: w?.path ?? '',
    name: w?.name || baseNameOf(w?.path) || '',
  }))
  return {
    safePaths,
    builtInWorkspaces,
  }
}

/**
 * Update safe access paths configuration dynamically from Web UI.
 * Updates settings scope if available, and updates runtime options state.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - config reader.
 * @param {{safePaths?: unknown}} payload - client request.
 * @returns {Promise<{ok: boolean, safePaths: Array<{path: string, label: string}>}>}
 */
export async function updateSafePathsConfig(ctx, options, payload) {
  const normalized = normalizeSafePaths(payload?.safePaths)
  const opts = typeof options === 'function' ? options() : options
  if (typeof opts?._updateSafePaths === 'function') {
    await opts._updateSafePaths(normalized)
  }
  return { ok: true, safePaths: normalized }
}

/** Method table; each entry receives `(ctx, options, payload, signal)`. */
const METHODS = Object.freeze({
  roots: (ctx, options, payload) => resolveSessionRoot(ctx, options, payload),
  list: listDirectory,
  meta: describeFile,
  read: readText,
  diff: getFileDiff,
  status: getWorkspaceGitStatus,
  getSafePaths: getSafePathsConfig,
  updateSafePaths: updateSafePathsConfig,
  bytes: readBytes,
  sheet: readSheet,
  doc: readDoc,
  // The picker's option list comes from the host so both halves cannot drift:
  // the catalog is the same allow-list a submitted override is validated
  // against, so the UI can only ever offer a choice the host accepts.
  languages: () => ({ languages: LANGUAGE_CATALOG }),
})

/**
 * Dispatch one RPC call into the method table, mapping every failure onto a
 * structured result so a thrown path never reaches the browser verbatim.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - resolved config reader.
 * @param {string} method - requested method name.
 * @param {object} payload - request payload.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<{ok: true, value: unknown} | {ok: false, error: object}>} the RPC result.
 */
export async function handleRpc(ctx, options, method, payload, signal) {
  const handler = Object.hasOwn(METHODS, method) ? METHODS[method] : undefined
  if (handler === undefined) {
    return { ok: false, error: { code: 'unknown-method', message: `unknown method "${method}"`, details: {} } }
  }
  try {
    return { ok: true, value: await handler(ctx, options, payload ?? {}, signal) }
  } catch (error) {
    if (error instanceof ViewerError) {
      return { ok: false, error: { code: error.code, message: error.message, details: error.details ?? {} } }
    }
    const code = typeof error?.code === 'string' ? error.code : 'internal'
    ctx.logger?.warn?.(`file-viewer: ${method} failed with ${code}`)
    // A file that passed the text probe but failed the text read is not a
    // permissions problem: the backend rejects non-UTF-8 and binary content
    // with FS_NOT_TEXT. Report that honestly so the client can explain it.
    if (code === 'FS_NOT_TEXT') {
      return { ok: false, error: { code: 'not-text', message: 'the file is not UTF-8 text', details: { reason: code } } }
    }
    return { ok: false, error: { code: 'read-failed', message: 'the file could not be read', details: { reason: code } } }
  }
}

/**
 * Register the browser-facing channel.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {object} [config] - plugin config.
 */
export function apply(ctx, config = {}) {
  const scope = openSettingsScope(ctx, config)
  let settings = scope.get()
  scope.watch?.((next) => {
    settings = next
  })

  const settingsFile = resolveSettingsFilePath(settings?.settingsFile)
  const persisted = readPersistedSettings(settingsFile)
  let dynamicSafePaths = Array.isArray(persisted?.safePaths) ? persisted.safePaths : null

  const updateSafePaths = async (paths) => {
    dynamicSafePaths = paths
    // 1. 本地持久化文件保存（防止断电、重启或独立环境配置丢失）
    try {
      writePersistedSettings(settingsFile, { safePaths: paths })
    } catch (err) {
      ctx.logger?.warn?.(`file-viewer: failed to write settingsFile: ${err?.message || err}`)
    }
    // 2. 宿主 Profile 设置保存（落盘到 profile cordis.patch.yml）
    try {
      if (typeof scope?.update === 'function') {
        await scope.update({ safePaths: paths })
      }
    } catch (err) {
      ctx.logger?.warn?.(`file-viewer: update settings scope failed: ${err?.message || err}`)
    }
  }

  const options = () => {
    let rawSafe = dynamicSafePaths
    if (rawSafe === null) {
      const disk = readPersistedSettings(settingsFile)
      if (Array.isArray(disk?.safePaths)) {
        rawSafe = disk.safePaths
      } else {
        rawSafe = settings?.safePaths ?? []
      }
    }
    return {
      safePaths: rawSafe,
      safeAccessPaths: settings?.safeAccessPaths ?? [],
      extraRoots: settings?.extraRoots ?? [],
      maxBytes: settings?.maxBytes ?? MAX_BYTES,
      _updateSafePaths: updateSafePaths,
      _settingsFile: settingsFile,
    }
  }

  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.connection.rpc.handle(
      RPC_CHANNEL,
      (method, payload, signal) => handleRpc(ctx, options, method, payload, signal),
      { authority: 'trusted-host' },
    )
  })
}
