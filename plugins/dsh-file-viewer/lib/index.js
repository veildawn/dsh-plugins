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
import z from '@deepseek-ai/schemastery'

import {
  MAX_BYTES,
  MAX_PREVIEW_BYTES,
  MAX_TEXT_BYTES,
  baseNameOf,
  isHiddenEntry,
  isSafeRelativePath,
  isWholeDocumentKind,
  joinPath,
  kindOf,
  langOf,
  langOf as languageOf,
  resolveWindow,
  sortEntries,
  splitLines,
  windowRows,
} from './core.js'

export {
  MAX_BYTES,
  MAX_PREVIEW_BYTES,
  MAX_TEXT_BYTES,
  baseNameOf,
  isHiddenEntry,
  isSafeRelativePath,
  isWholeDocumentKind,
  joinPath,
  kindOf,
  langOf,
  resolveWindow,
  sortEntries,
  splitLines,
  windowRows,
}

export const name = 'file-viewer'
export const inject = ['fs', 'connection', 'settings', 'workspaceRegistry', 'sessions']
export const NS = 'file-viewer'
export const RPC_CHANNEL = '/dsh-file-viewer'

export const Config = z.object({
  extraRoots: z.array(z.string()).default([]),
  maxBytes: z.natural().default(MAX_BYTES),
})

/** Structured failures the client switches on; messages never echo a path. */
export class ViewerError extends Error {
  /**
   * @param {string} code - stable machine-readable reason.
   * @param {string} message - operator-facing summary, free of path details.
   */
  constructor(code, message) {
    super(message)
    this.name = 'ViewerError'
    this.code = code
  }
}

/**
 * Collect the directories this deployment is willing to serve: every
 * registered workspace, every live session's cwd, and any operator-configured
 * extras. There is no host-side notion of an "active" workspace — that lives
 * only in browser UI state — so the client picks from this set.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => {extraRoots: string[]}} options - resolved config reader.
 * @returns {{id: string, label: string, path: string}[]} ordered, de-duplicated roots.
 */
export function collectRoots(ctx, options) {
  const seen = new Map()
  const add = (path, label) => {
    if (typeof path !== 'string' || path === '') return
    const key = path.replace(/[\\/]+$/, '')
    if (key === '' || seen.has(key)) return
    seen.set(key, { id: key, label: label || baseNameOf(key) || key, path: key })
  }

  for (const workspace of ctx.workspaceRegistry?.list?.() ?? []) add(workspace?.path, workspace?.name)
  for (const session of ctx.sessions?.list?.() ?? []) add(session?.header?.cwd)
  for (const extra of options().extraRoots) add(extra)
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
 * @param {() => {extraRoots: string[]}} options - resolved config reader.
 * @param {{root?: string, path?: string}} payload - client request.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<{root: {id: string, path: string}, target: object, relative: string, absolute: string}>} the vetted target.
 */
export async function resolveInRoot(ctx, options, payload, signal) {
  const roots = collectRoots(ctx, options)
  if (roots.length === 0) throw new ViewerError('no-roots', 'no workspace roots are available to browse')

  const requested = payload?.root
  const root = requested === undefined || requested === null || requested === ''
    ? roots[0]
    : roots.find((candidate) => candidate.id === String(requested).replace(/[\\/]+$/, ''))
  if (root === undefined) throw new ViewerError('unknown-root', 'the requested root is not served by this deployment')

  const relative = payload?.path === undefined || payload?.path === null ? '' : String(payload.path)
  if (!isSafeRelativePath(relative)) throw new ViewerError('outside-root', 'the requested path escapes its root')

  const rootTarget = await ctx.fs.resolve(root.path, { signal })
  const target = relative === '' ? rootTarget : await ctx.fs.resolve(joinPath(root.path, relative), { signal })
  if (target.targetKey !== rootTarget.targetKey && !ctx.fs.contains(rootTarget, target)) {
    throw new ViewerError('outside-root', 'the requested path escapes its root')
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
  const kind = kindOf(naming)
  const lang = languageOf(naming)
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
  const fileKind = kindOf(naming)
  const lang = languageOf(naming)
  return {
    root: root.id,
    path: relative,
    name: baseNameOf(naming),
    displayPath: target.displayPath,
    kind: fileKind,
    ...(lang === undefined ? {} : { lang }),
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

  let mammoth
  try {
    mammoth = (await import('mammoth')).default
  } catch {
    throw new ViewerError('unsupported', 'the host is missing the document reader dependency')
  }

  const bytes = await ctx.fs.readBytes(target, signal, options().maxBytes)
  const converted = await mammoth.convertToMarkdown({ buffer: Buffer.from(bytes) })
  return {
    root: root.id,
    path: relative,
    name: baseNameOf(relative),
    markdown: converted.value ?? '',
    warnings: (converted.messages ?? []).map((entry) => entry?.message ?? String(entry)),
  }
}

/**
 * Resolve which root a session belongs to, so the viewer opens on the project
 * the reader is working in rather than the first registered workspace.
 *
 * A session's `cwd` may sit inside a workspace rather than be one, so the
 * deepest containing root wins and the remainder is returned as a path to
 * reveal in the tree.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - resolved config reader.
 * @param {{sessionId?: string}} payload - client request.
 * @returns {{roots: object[], root?: string, reveal?: string}} roots plus the session's position.
 */
export function resolveSessionRoot(ctx, options, payload) {
  const roots = collectRoots(ctx, options)
  const sessionId = payload?.sessionId
  if (typeof sessionId !== 'string' || sessionId === '') return { roots }

  const session = ctx.sessions?.get?.(sessionId)
  const cwd = session?.header?.cwd ?? session?.header?.meta?.cwd
  if (typeof cwd !== 'string' || cwd === '') return { roots }

  // Compare on one separator style and case-insensitively: roots come from the
  // registry, sessions and hand-written config, so `D:\repo\a` and `D:/repo`
  // can legitimately describe the same tree.
  const key = cwd.replace(/[\\/]+$/, '').replace(/\\/g, '/')
  const fold = (value) => value.toLowerCase()
  let best
  for (const root of roots) {
    const rootKey = root.id.replace(/[\\/]+$/, '').replace(/\\/g, '/')
    const sameRoot = fold(key) === fold(rootKey)
    if (sameRoot || fold(key).startsWith(fold(rootKey) + '/')) {
      if (best === undefined || rootKey.length > best.rootKey.length) best = { root, rootKey, sameRoot }
    }
  }
  if (best === undefined) return { roots }
  return { roots, root: best.root.id, reveal: best.sameRoot ? '' : key.slice(best.rootKey.length + 1) }
}

/** Method table; each entry receives `(ctx, options, payload, signal)`. */
const METHODS = Object.freeze({
  roots: (ctx, options, payload) => resolveSessionRoot(ctx, options, payload),
  list: listDirectory,
  meta: describeFile,
  read: readText,
  bytes: readBytes,
  sheet: readSheet,
  doc: readDoc,
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
      return { ok: false, error: { code: error.code, message: error.message, details: {} } }
    }
    const code = typeof error?.code === 'string' ? error.code : 'internal'
    ctx.logger?.warn?.(`file-viewer: ${method} failed with ${code}`)
    return { ok: false, error: { code: 'read-failed', message: 'the file could not be read', details: { reason: code } } }
  }
}

/**
 * Register the browser-facing channel.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {object} [config] - plugin config.
 */
export function apply(ctx, config = {}) {
  const scope = ctx.settings?.register?.(NS, Config, { base: config })
  let settings = scope?.get?.() ?? Config(config)
  scope?.watch?.((next) => {
    settings = next
  })
  const options = () => ({
    extraRoots: settings?.extraRoots ?? [],
    maxBytes: settings?.maxBytes ?? MAX_BYTES,
  })

  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.connection.rpc.handle(
      RPC_CHANNEL,
      (method, payload, signal) => handleRpc(ctx, options, method, payload, signal),
      { authority: 'trusted-host' },
    )
  })
}
