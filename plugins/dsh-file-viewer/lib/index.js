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
  GIT_COMMIT_PAGE_MAX,
  GIT_COMMIT_PAGE_SIZE,
  GIT_REPO_SCAN_LIMIT,
  LANGUAGE_CATALOG,
  MAX_BYTES,
  MAX_DOWNLOAD_BYTES,
  MAX_PREVIEW_BYTES,
  MAX_TEXT_BYTES,
  TEXT_PROBE_BYTES,
  appendMention,
  baseNameOf,
  commitPathWithinRoot,
  contentDispositionFor,
  detectLanguageFromText,
  extensionOf,
  formatDocTextToMarkdown,
  gitChangeOf,
  gitStatusBadge,
  groupGitChanges,
  insertMentionAtCaret,
  isCheckoutableBranch,
  isCandidateRepoDirectory,
  isHiddenEntry,
  isSafeBranchName,
  isSafeCommitSha,
  isSafeRelativePath,
  isTextContent,
  isUtf8TextContent,
  isWholeDocumentKind,
  isKnownLanguage,
  joinPath,
  kindOf,
  langOf,
  mediaTypeOf,
  normalizeCommitPage,
  normalizeGitPath,
  normalizeSafePaths,
  parentOf,
  parseGitBranchList,
  parseGitBranches,
  parseGitCommitDetail,
  parseGitLog,
  parseGitNameStatus,
  parseGitStatus,
  parseGitStatusEntries,
  parsePatchToDiffs,
  parsePatchToRows,
  parseUnifiedDiffFiles,
  rebaseGitPaths,
  relativePathWithin,
  repoRelativeFromRoot,
  revisionOfBranch,
  resolveLanguage,
  resolveWindow,
  sanitizeDocHtml,
  sortEntries,
  splitLines,
  summarizeDiffs,
  windowRows,
} from './core.js'

export {
  GIT_COMMIT_PAGE_MAX,
  GIT_COMMIT_PAGE_SIZE,
  GIT_REPO_SCAN_LIMIT,
  LANGUAGE_CATALOG,
  MAX_BYTES,
  MAX_DOWNLOAD_BYTES,
  MAX_PREVIEW_BYTES,
  MAX_TEXT_BYTES,
  TEXT_PROBE_BYTES,
  appendMention,
  baseNameOf,
  commitPathWithinRoot,
  contentDispositionFor,
  detectLanguageFromText,
  extensionOf,
  formatDocTextToMarkdown,
  gitChangeOf,
  insertMentionAtCaret,
  isCandidateRepoDirectory,
  parentOf,
  sanitizeDocHtml,
  isHiddenEntry,
  isSafeBranchName,
  isSafeCommitSha,
  isSafeRelativePath,
  isTextContent,
  isUtf8TextContent,
  isWholeDocumentKind,
  isKnownLanguage,
  joinPath,
  kindOf,
  langOf,
  mediaTypeOf,
  normalizeCommitPage,
  normalizeGitPath,
  normalizeSafePaths,
  parseGitBranchList,
  parseGitBranches,
  parseGitCommitDetail,
  parseGitLog,
  parseGitNameStatus,
  parseGitStatus,
  parseGitStatusEntries,
  parsePatchToDiffs,
  parsePatchToRows,
  parseUnifiedDiffFiles,
  rebaseGitPaths,
  relativePathWithin,
  repoRelativeFromRoot,
  resolveLanguage,
  resolveWindow,
  revisionOfBranch,
  gitStatusBadge,
  groupGitChanges,
  isCheckoutableBranch,
  sortEntries,
  splitLines,
  summarizeDiffs,
  windowRows,
}

const execFileAsync = promisify(execFile)

export const name = 'file-viewer'
// webServer 必须一并注入：connection.rpc.handle 在调用方 ctx 上读 webServer 注册路由，
// 缺这一项会让插件在 webServer 就绪前就执行 apply 并以 "without inject" 激活失败。
export const inject = ['fs', 'connection', 'settings', 'workspaceRegistry', 'sessions', 'webServer']
export const NS = 'file-viewer'
export const RPC_CHANNEL = '/dsh-file-viewer'
export const PLANS_DIR_NAME = '.dsh-plans'

/**
 * Exact Fetch route that streams one file to the browser's save flow.
 *
 * Lives below `/api` so the Connection carrier applies its Host/Origin fence
 * and browser-cookie admission before this handler ever runs; only an owner
 * Peer (the same principal the RPC channel serves) reaches it.
 */
export const DOWNLOAD_ROUTE = '/api/file-viewer/download'

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
  maxBytes: z.natural().default(MAX_BYTES).description('在线预览（图片/PDF/表格等）单文件上限，默认 20 MB'),
  maxDownloadBytes: z.natural().default(MAX_DOWNLOAD_BYTES).description('下载到本地单文件上限，默认 100 MB'),
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
    // The plan directory is dot-prefixed so Git ignores it easily, but it belongs
    // to the workspace and the reader must be able to see and navigate to it
    // without having to turn on "show hidden files" for the entire project.
    .filter((entry) => showHidden || !isHiddenEntry(entry.name) || entry.name === PLANS_DIR_NAME)
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
 * Collapse a root-relative path to its significant segments.
 *
 * Used to decide whether a path names the root itself (`''`, `'.'`, `'./'`,
 * `'sub/..'` all do). Deliberately not `path.normalize`: that keeps a trailing
 * separator and would answer `'./'` with `'./'`. Returning `''` for the root
 * matches how `resolveInRoot` reports the root everywhere else.
 *
 * A path that climbs above the root (`'../x'`) keeps its leading `..` so it
 * does not masquerade as the root — that case is rejected by
 * `isSafeRelativePath` afterwards, and collapsing it here would hide it.
 * @param {string} relative - any caller-supplied relative path.
 * @returns {string} normalized segments joined by `/`, or `''` for the root.
 */
function normalizeRelativeSegments(relative) {
  const parts = String(relative ?? '').replace(/\\/g, '/').split('/')
  const kept = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      // Popping a real segment is what `..` means; popping past the start is an
      // escape attempt and is preserved so the caller's shape check sees it.
      if (kept.length > 0 && kept[kept.length - 1] !== '..') kept.pop()
      else kept.push('..')
      continue
    }
    kept.push(part)
  }
  return kept.join('/')
}

/**
 * Delete one file, or one directory and everything below it.
 *
 * The host's `fs` service is read-only (it offers `writeText` and `editText`,
 * but nothing that unlinks), so this is the one place the plugin reaches the
 * disk with Node's own fs module. That makes the fences below load-bearing
 * rather than defensive:
 *
 *   - the path goes through `resolveInRoot` first, which is the same gate every
 *     read passes: shape check for absolute paths and `..`, then
 *     `ctx.fs.contains` on canonicalized identities so a symlink cannot point
 *     the deletion outside the roots;
 *   - the root itself is never deletable, whatever the payload says — removing
 *     a workspace from a file tree would be a surprise of the worst kind;
 *   - `recursive` is required explicitly to remove a non-empty directory. A
 *     caller that meant "delete this file" and hit a directory instead gets a
 *     refusal, not a wiped tree.
 *
 * The absolute path is never echoed in the error: fs failures embed it in
 * `error.message`, which is exactly what the rest of this file avoids.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - resolved config reader.
 * @param {{root?: string, path?: string, recursive?: boolean}} payload - what to delete.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<{root: string, path: string, type: string, recursive: boolean}>} what was removed.
 */
export async function deleteEntry(ctx, options, payload, signal) {
  const relative = payload?.path === undefined || payload?.path === null ? '' : String(payload.path)
  // A path that names the root itself. Checked before resolving so the refusal
  // names the real reason rather than surfacing as a generic error.
  //
  // Stripping separators alone is not enough: `./`, `.`, `//` and `sub/..` all
  // normalize to the root while leaving non-empty text behind. A test caught
  // exactly that — `path: "./"` walked past the first version of this guard and
  // would have deleted the whole workspace. So the segments are resolved the
  // way `path.posix.normalize` would, and the result is compared against the
  // empty string that denotes the root everywhere else in this file.
  if (normalizeRelativeSegments(relative) === '') {
    throw new ViewerError('cannot-delete-root', 'the workspace root itself cannot be deleted')
  }

  const { root, target, relative: vetted } = await resolveInRoot(ctx, options, payload, signal)
  const info = await ctx.fs.stat(target, signal)
  if (info === undefined) throw new ViewerError('not-found', 'the file no longer exists')

  const type = info.type === 'directory' ? 'directory' : 'file'
  const recursive = payload?.recursive === true
  const absolute = ctx.fs.processPath?.(target) ?? target.displayPath

  if (type === 'directory') {
    if (!recursive) {
      // Refuse rather than silently deleting a subtree: a caller that did not
      // ask for recursion is telling us it believes the target is a file.
      throw new ViewerError('is-a-directory', 'the target is a directory and recursive deletion was not requested')
    }
    try {
      await fsPromises.rm(absolute, { recursive: true, force: false })
    } catch (error) {
      throw new ViewerError('delete-failed', 'the directory could not be deleted', { reason: error?.code ?? 'unknown' })
    }
    return { root: root.id, path: vetted, type, recursive: true }
  }

  try {
    await fsPromises.unlink(absolute)
  } catch (error) {
    throw new ViewerError('delete-failed', 'the file could not be deleted', { reason: error?.code ?? 'unknown' })
  }
  return { root: root.id, path: vetted, type, recursive: false }
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

/* -------------------------------------------------------------------------- *
 * Git panel
 *
 * The panel has to work for two shapes of workspace, and they are not the same
 * problem: a root that *is* a checkout (or lives inside one), and a root that
 * merely *holds* checkouts. Both are resolved here, and the client never sends
 * a filesystem path back: it sends a repository id from the discovery result,
 * so `git` can only ever be run in a directory this host enumerated under a
 * vetted root.
 *
 * Every ref and revision that travels as argv is validated first. `execFile`
 * does not involve a shell, but git still parses a leading dash as an option,
 * which is why {@link isSafeBranchName} rejects it outright.
 * -------------------------------------------------------------------------- */

/** Field/record separators git is asked for: neither may appear in a ref. */
const GIT_FIELD = '%x1f'
const GIT_RECORD = '%x1e'

/** One commit per record, with the fields the panel actually renders. */
const GIT_LOG_FORMAT = `%H${GIT_FIELD}%h${GIT_FIELD}%an${GIT_FIELD}%ae${GIT_FIELD}%aI${GIT_FIELD}%cI${GIT_FIELD}%s${GIT_RECORD}`

/** The same fields plus the full message body, for one commit's detail. */
const GIT_COMMIT_FORMAT = `%H${GIT_FIELD}%h${GIT_FIELD}%an${GIT_FIELD}%ae${GIT_FIELD}%aI${GIT_FIELD}%cI${GIT_FIELD}%s${GIT_FIELD}%B${GIT_RECORD}`

/**
 * Branch listing, tab separated: `*` marker, full ref, short name, tip, date,
 * upstream.
 *
 * The full ref is requested as well as the short name because a remote branch
 * and a local branch can share a short name (`origin/main` as a local branch is
 * legal), and only the full ref distinguishes what may be checked out.
 */
const GIT_BRANCH_FORMAT = '%(HEAD)%09%(refname)%09%(refname:short)%09%(objectname:short)%09%(committerdate:iso-strict)%09%(upstream:short)'

/**
 * Environment for every git call.
 *
 * A viewer must never block on a credential prompt or open a pager, and the
 * optional-locks switch keeps a read-only listing from refreshing the index of
 * a repository the user is working in.
 *
 * `GIT_DIR`, `GIT_WORK_TREE` and friends are removed rather than overridden:
 * they are inherited from whatever launched DSH, and any one of them redirects
 * git at a repository outside the root this plugin vetted. `cwd` alone must
 * decide which repository a call touches.
 */
const GIT_ENV = Object.freeze({
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
  GIT_PAGER: 'cat',
  LC_ALL: 'C',
})

/**
 * Environment variables that bind a git call to a repository or an index.
 *
 * Inheriting one of these silently relocates every command, including
 * `git checkout`, which is the one call in this plugin that writes. They are
 * deleted from the child environment so the `cwd` passed by the caller is the
 * only thing that selects a repository.
 */
const GIT_REPOSITORY_ENV = Object.freeze([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
])

/**
 * Build the child environment for one git call.
 *
 * Exported because the removal of the repository-binding variables is the
 * security-relevant half of confinement and is worth asserting directly.
 * @param {NodeJS.ProcessEnv} [base] - the ambient environment.
 * @returns {NodeJS.ProcessEnv} the environment a git child may see.
 */
export function gitChildEnv(base = process.env) {
  const env = { ...base, ...GIT_ENV }
  for (const key of GIT_REPOSITORY_ENV) delete env[key]
  return env
}

/**
 * Run one git command and report failure as data rather than an exception.
 *
 * A missing binary, a directory that is not a checkout and a repository with
 * no commits are all ordinary states the panel renders, so the caller decides
 * what each means instead of unwinding through an error path.
 * @param {string} cwd - absolute directory to run in.
 * @param {string[]} args - argv, never a shell string.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>} the result.
 */
async function runGitCommand(cwd, args, signal) {
  try {
    const { stdout } = await execFileAsync('git', ['--no-pager', ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      signal,
      // Confinement, not convenience: an inherited GIT_DIR would point git at
      // a repository outside the root the caller was allowed to read.
      env: gitChildEnv(),
    })
    return { ok: true, stdout: stdout ?? '', stderr: '' }
  } catch (error) {
    // Cancellation is the caller's own signal, not a git failure.
    if (signal?.aborted) throw error
    // `ENOENT` means the binary is missing, which is a deployment problem and
    // must not be reported as "this directory is not a repository".
    if (error?.code === 'ENOENT') return { ok: false, stdout: '', stderr: '', missing: true }
    return { ok: false, stdout: '', stderr: String(error?.stderr ?? error?.message ?? '') }
  }
}

/**
 * The git runner for this deployment.
 *
 * Reads an injectable runner from the resolved config so the host tests can
 * exercise discovery and paging without a real repository; production never
 * sets it and gets the subprocess runner above.
 * @param {(() => object) | object} options - resolved config reader.
 * @returns {(cwd: string, args: string[], signal?: AbortSignal) => Promise<object>} the runner.
 */
function gitRunnerFrom(options) {
  const opts = typeof options === 'function' ? (options() ?? {}) : (options ?? {})
  return typeof opts?._runGit === 'function' ? opts._runGit : runGitCommand
}

/**
 * Read one line of `git rev-parse` output, or '' when git refused.
 * @param {Function} run - the git runner.
 * @param {string} cwd - directory to run in.
 * @param {string[]} args - arguments after `rev-parse`.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<string>} the first output line.
 */
async function gitRevisionOf(run, cwd, args, signal) {
  const result = await run(cwd, ['rev-parse', ...args], signal)
  if (result?.ok !== true) return ''
  return String(result.stdout ?? '').split('\n')[0].trim()
}

/**
 * Whether a failed git call means the binary is absent rather than the
 * directory being something other than a checkout.
 *
 * The two used to collapse into "no repository here", which turns a broken
 * deployment into a confident, wrong answer. Only a spawn failure sets
 * `missing`; git's own "not a git repository" is an ordinary negative answer.
 * @param {object} result - one runner result.
 * @returns {boolean} true when git itself could not be started.
 */
function gitUnavailable(result) {
  return result?.missing === true
}

/**
 * Enumerate the checkouts visible from one root.
 *
 * The root's own checkout wins when the root sits inside one (a workspace that
 * is a subdirectory of a repository still reads that repository's history).
 * Direct subdirectories are probed next, one bounded level deep: only a
 * directory carrying its own `.git` marker can start a new checkout, so a
 * single stat rules out every ordinary directory before a git process is
 * spawned — which matters because this runs each time the panel opens.
 *
 * Two things are reported instead of hidden:
 *   - `truncated`, when the probe budget ran out before every candidate was
 *     examined, so the client can say the list is incomplete;
 *   - `scope`, when the root is a subdirectory of the checkout rather than the
 *     checkout itself, because a checkout there writes outside the root.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - resolved config reader.
 * @param {{root?: string}} payload - client request.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<{root: object, rootPath: string, repositories: object[], truncated: boolean}>} the placements.
 */
async function discoverRepositories(ctx, options, payload, signal) {
  const { root, target, absolute } = await resolveInRoot(ctx, options, { root: payload?.root, path: '' }, signal)
  const rootPath = absolute
  const run = gitRunnerFrom(options)
  const repositories = []
  const seen = new Set()
  let missing = false

  const add = (id, name, toplevel, prefix, rootRelative) => {
    if (toplevel === '') return
    const key = process.platform === 'win32' ? toplevel.toLowerCase() : toplevel
    if (seen.has(key)) return
    seen.add(key)
    const normalizedTop = normalizeGitPath(toplevel)
    const normalizedRoot = normalizeGitPath(rootPath)
    repositories.push({
      id,
      name,
      path: prefix,
      toplevel,
      rootRelative,
      // `root` means checking a branch out here rewrites exactly the directory
      // the reader is browsing; `parent` means the checkout lives above it and
      // a checkout would touch files this root was never allowed to change.
      scope: normalizedTop === normalizedRoot ? 'root' : 'parent',
    })
  }

  const probe = async (cwd, args) => {
    const result = await run(cwd, ['rev-parse', ...args], signal)
    if (gitUnavailable(result)) missing = true
    if (result?.ok !== true) return ''
    return String(result.stdout ?? '').split('\n')[0].trim()
  }

  const toplevel = await probe(rootPath, ['--show-toplevel'])
  if (toplevel !== '') {
    // `--show-prefix` is git's own answer for "where is this directory inside
    // the checkout", which avoids comparing paths across symlinked temp dirs.
    const inside = await probe(rootPath, ['--show-prefix'])
    add('.', baseNameOf(toplevel) || toplevel, toplevel, '', inside)
  }

  if (missing) throw new ViewerError('git-unavailable', 'this host cannot run git')

  let entries = []
  try {
    entries = await ctx.fs.listDir(target, signal)
  } catch {
    entries = []
  }
  // Directory listings arrive in filesystem order, which is not stable. Sorting
  // makes the truncated case reproducible instead of "whichever 32 came first".
  const candidates = entries
    .filter((entry) => entry?.type === 'directory' && isCandidateRepoDirectory(entry.name))
    .sort((left, right) => String(left.name).localeCompare(String(right.name)))

  let scanned = 0
  let truncated = false
  for (const entry of candidates) {
    if (scanned >= GIT_REPO_SCAN_LIMIT) {
      // The budget bounds *probes*, not discoveries; running out means there
      // may be more checkouts, which the client has to be able to say.
      truncated = true
      break
    }
    scanned += 1
    try {
      const childPath = joinPath(rootPath, entry.name)
      const childTarget = await ctx.fs.resolve(childPath, { signal })
      // A symlinked directory can point outside the root, and running git
      // there would step over the containment fence this plugin is built on.
      if (childTarget.targetKey === target.targetKey || !ctx.fs.contains(target, childTarget)) continue
      const marker = await ctx.fs.stat(await ctx.fs.resolve(joinPath(childPath, '.git'), { signal }), signal)
      if (marker === undefined) continue
      const childPhysical = ctx.fs.processPath?.(childTarget) ?? childTarget.targetKey
      const childTop = await probe(childPhysical, ['--show-toplevel'])
      if (childTop === '') continue
      // A nested directory of the parent checkout reports the parent's
      // toplevel too; it only owns a checkout when git agrees it is the root.
      const childInside = await probe(childPhysical, ['--show-prefix'])
      if (childInside !== '') continue
      const placement = relativePathWithin(rootPath, childTop)
      if (placement !== null && placement !== entry.name) continue
      add(entry.name, entry.name, childTop, entry.name, '')
    } catch {
      // One unreadable child must not hide the others.
    }
  }

  if (missing) throw new ViewerError('git-unavailable', 'this host cannot run git')

  return { root, rootPath, repositories, truncated }
}

/**
 * Read a checkout's branches and checked-out state.
 * @param {Function} run - the git runner.
 * @param {object} repo - a repository from discovery.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<{branches: object[], current: string, detached: boolean, empty: boolean}>} the state.
 */
async function readRepositoryState(run, repo, signal) {
  const listing = await run(repo.toplevel, ['branch', '--all', '--no-color', `--format=${GIT_BRANCH_FORMAT}`], signal)
  const branches = listing?.ok === true ? parseGitBranchList(listing.stdout) : []
  const head = await gitRevisionOf(run, repo.toplevel, ['--abbrev-ref', 'HEAD'], signal)
  const detached = head === 'HEAD'
  return {
    branches,
    current: detached || head === '' ? '' : head,
    detached,
    // No HEAD commit yet: a freshly initialized repository has no history.
    empty: branches.filter((branch) => branch.kind === 'local').length === 0 && head === '',
  }
}

/**
 * Read a checkout's remotes so the panel can say where a branch came from and
 * whether it is behind.
 * @param {Function} run - the git runner.
 * @param {string} toplevel - the checkout root.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<{name: string, url: string}[]>} configured remotes.
 */
async function readRemotes(run, toplevel, signal) {
  const result = await run(toplevel, ['remote', '-v'], signal)
  if (result?.ok !== true) return []
  const seen = new Map()
  for (const line of String(result.stdout ?? '').split('\n')) {
    // `<name>\t<url> (fetch|push)`
    const match = /^(\S+)\t(\S+)\s+\((fetch|push)\)$/.exec(line.trim())
    if (match === null) continue
    const [, name, url, kind] = match
    if (kind !== 'fetch' || seen.has(name)) continue
    seen.set(name, { name, url })
  }
  return [...seen.values()]
}

/**
 * List every branch name in a checkout, used as the allow-list for a checkout
 * request so an arbitrary revision expression can never be selected.
 * @param {Function} run - the git runner.
 * @param {string} toplevel - the checkout root.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<string[]>} branch names.
 */
async function readBranchNames(run, toplevel, signal) {
  const result = await run(toplevel, ['branch', '--all', '--no-color', '--format=%(refname)'], signal)
  if (result?.ok !== true) return []
  return String(result.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/**
 * Resolve the branch a request names into the revision git should read.
 *
 * The client sends the full ref it was given (`refs/heads/main`,
 * `refs/remotes/origin/main`), never a bare name, so a local branch and a
 * remote-tracking branch with the same short name stay distinguishable and a
 * forged name cannot reach a different ref than the one listed.
 *
 * @param {Function} run - the git runner.
 * @param {string} toplevel - the checkout root.
 * @param {unknown} requested - the client's branch reference.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<{ref: string, kind: string, shortName: string}>} the resolved branch.
 */
async function resolveBranchRef(run, toplevel, requested, signal) {
  const wanted = typeof requested === 'string' ? requested : ''
  if (wanted === '') return { ref: 'HEAD', kind: 'head', shortName: 'HEAD' }
  if (!isSafeBranchName(wanted) || wanted.startsWith('refs/tags/')) {
    throw new ViewerError('invalid-branch', '分支名不合法')
  }
  const known = await readBranchNames(run, toplevel, signal)
  if (!known.includes(wanted)) throw new ViewerError('unknown-branch', '该分支不存在')
  const kind = wanted.startsWith('refs/remotes/') ? 'remote' : 'local'
  // `%(refname:short)` strips exactly the namespace prefix git itself uses.
  const shortName = wanted.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, '')
  return { ref: wanted, kind, shortName }
}

/**
 * Resolve the repository a request names, re-discovering it from the root.
 *
 * The client sends an id it was given, never a path, so a forged request cannot
 * aim git at a directory outside the vetted root.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - resolved config reader.
 * @param {{root?: string, repo?: string}} payload - client request.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<{root: object, repo: object, run: Function}>} the located repository.
 */
async function locateRepository(ctx, options, payload, signal) {
  const { root, repositories } = await discoverRepositories(ctx, options, payload, signal)
  if (repositories.length === 0) {
    throw new ViewerError('not-a-git-repo', '该目录及其子目录都不是 Git 仓库')
  }
  const requested = typeof payload?.repo === 'string' && payload.repo !== '' ? payload.repo : repositories[0].id
  const repo = repositories.find((candidate) => candidate.id === requested)
  if (repo === undefined) throw new ViewerError('unknown-repository', '请求的仓库不在当前根目录内')
  return { root, repo, run: gitRunnerFrom(options) }
}

/**
 * List the repositories under one root, each with its branches.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - resolved config reader.
 * @param {{root?: string}} payload - client request.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<{repos: object[], truncated: boolean}>} the repositories.
 */
export async function listGitRepositories(ctx, options, payload, signal) {
  const { repositories, truncated } = await discoverRepositories(ctx, options, payload, signal)
  const run = gitRunnerFrom(options)
  const repos = []
  for (const repo of repositories) {
    const state = await readRepositoryState(run, repo, signal)
    const remotes = await readRemotes(run, repo.toplevel, signal)
    repos.push({
      id: repo.id,
      name: repo.name,
      path: repo.path,
      // `root` vs `parent` decides whether a checkout stays inside the
      // directory the reader is browsing, so the client can warn before it.
      scope: repo.scope,
      current: state.current,
      detached: state.detached,
      empty: state.empty,
      remotes,
      branches: state.branches.map((branch) => ({
        // `refname` is the stable identifier: a local branch may share its
        // short name with a remote-tracking branch, and only the full ref
        // says which one a checkout or a history read refers to.
        name: branch.name,
        shortName: branch.shortName,
        kind: branch.kind,
        remote: branch.remote,
        current: branch.current,
        sha: branch.sha,
        date: branch.date,
        upstream: branch.upstream,
        // Browsing a remote branch is read-only; checking it out silently
        // creates a detached HEAD or a new local branch.
        checkoutable: branch.kind !== 'remote',
      })),
    })
  }
  return { repos, truncated }
}

/**
 * Page one branch's commit history.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - resolved config reader.
 * @param {{root?: string, repo?: string, branch?: string, offset?: number, limit?: number}} payload - client request.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<object>} the page plus the totals the pager needs.
 */
export async function listGitCommits(ctx, options, payload, signal) {
  const { repo, run } = await locateRepository(ctx, options, payload, signal)
  const page = normalizeCommitPage(payload)

  // No branch named: follow whatever is checked out. A remote-tracking branch
  // is a legitimate choice here, which is why the resolution is shared with
  // checkout instead of reading a bare `abbrev-ref`.
  const resolved = await resolveBranchRef(run, repo.toplevel, payload?.branch, signal)
  const branch = resolved.ref === 'HEAD' ? '' : resolved.ref
  const rev = resolved.ref

  const count = await run(repo.toplevel, ['rev-list', '--count', rev, '--'], signal)
  if (count?.ok !== true) {
    // An empty checkout has no history to page; that is a state, not a fault.
    return {
      repository: repo.id, branch, branchKind: resolved.kind, shortName: resolved.shortName,
      total: 0, offset: 0, limit: page.limit, commits: [], hasMore: false,
    }
  }
  const parsedTotal = Number.parseInt(String(count.stdout ?? '').trim(), 10)

  const log = await run(repo.toplevel, [
    'log', rev,
    `--max-count=${page.limit}`,
    `--skip=${page.offset}`,
    '--no-color',
    '--no-decorate',
    `--format=${GIT_LOG_FORMAT}`,
    '--',
  ], signal)
  if (log?.ok !== true) throw new ViewerError('git-failed', '无法读取提交记录')

  const commits = parseGitLog(log.stdout)
  const safeTotal = Number.isSafeInteger(parsedTotal) && parsedTotal >= 0 ? parsedTotal : page.offset + commits.length
  return {
    repository: repo.id,
    // The full ref, so the client can keep selecting the same branch; plus what
    // kind it is, because a remote branch is browse-only.
    branch,
    branchKind: resolved.kind,
    shortName: resolved.shortName,
    total: safeTotal,
    offset: page.offset,
    limit: page.limit,
    commits,
    hasMore: page.offset + commits.length < safeTotal,
  }
}

/**
 * Read one commit's metadata and the files it changed.
 *
 * The diff is taken against the first parent, which is what "the changes in
 * this commit" means for a merge as well; a root commit is compared against the
 * empty tree instead.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - resolved config reader.
 * @param {{root?: string, repo?: string, sha?: string}} payload - client request.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<{repository: string, commit: object, files: object[]}>} the detail.
 */
export async function readGitCommitFiles(ctx, options, payload, signal) {
  const sha = String(payload?.sha ?? '').toLowerCase()
  if (!isSafeCommitSha(sha)) throw new ViewerError('invalid-commit', '提交标识不合法')
  const { repo, run } = await locateRepository(ctx, options, payload, signal)

  const header = await run(repo.toplevel, [
    'log', '-1', '--no-color', `--format=${GIT_COMMIT_FORMAT}`, sha, '--',
  ], signal)
  const parsed = header?.ok === true ? parseGitCommitDetail(header.stdout) : null
  if (parsed === null) throw new ViewerError('unknown-commit', '找不到该提交')

  const parents = await run(repo.toplevel, ['rev-list', '--parents', '--max-count=1', sha, '--'], signal)
  const parentSha = parents?.ok === true ? String(parents.stdout ?? '').trim().split(/\s+/)[1] ?? '' : ''
  const diffArgs = parentSha === '' || !isSafeCommitSha(parentSha)
    ? ['diff-tree', '--root', '--no-commit-id', '-r', '-z', '--name-status', sha]
    : ['diff-tree', '--no-commit-id', '-r', '-z', '--name-status', '-M', parentSha, sha]
  const diff = await run(repo.toplevel, diffArgs, signal)
  // A failed diff is not an empty commit. Reporting zero files here would tell
  // the reader the commit changed nothing, which is a different claim entirely.
  if (diff?.ok !== true) throw new ViewerError('git-failed', '无法读取该提交的改动文件')
  const changes = parseGitNameStatus(diff.stdout)

  const placement = { prefix: repo.path, rootRelative: repo.rootRelative }
  const files = changes.map((change) => {
    const current = commitPathWithinRoot(placement, change.path)
    const previous = change.oldPath === null ? null : commitPathWithinRoot(placement, change.oldPath)
    const view = gitChangeOf(change.status)
    return {
      // Root-relative, so clicking the row can open it in the same preview
      // pane the file tree uses; `repoPath` keeps git's own wording.
      path: current.path,
      repoPath: change.path,
      oldPath: previous === null ? null : previous.path,
      status: change.status,
      letter: view.letter,
      change: view.label,
      tone: view.tone,
      outsideRoot: current.outsideRoot,
    }
  })

  return {
    repository: repo.id,
    commit: { ...parsed.commit, body: parsed.body },
    // The first parent, when there is one. A deletion's contents live here, so
    // the client needs the hash to open "what the file was before this commit"
    // instead of asking for a path the commit no longer contains.
    parentSha: parentSha !== '' && isSafeCommitSha(parentSha) ? parentSha : '',
    files,
  }
}

/**
 * Read one file as it existed in a commit.
 *
 * This is what makes "click a changed file" honest: the preview shows the bytes
 * of that commit, not whatever the working tree happens to contain now. A file
 * deleted by the commit, or a path that has since moved, still renders, and a
 * commit on another branch no longer previews the wrong content.
 *
 * `rev` is the commit's own blob path, so the request is bounded to a commit
 * that `readGitCommitFiles` already listed under this repository — the client
 * cannot ask for an arbitrary revision, only a concrete hash.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - resolved config reader.
 * @param {{root?: string, repo?: string, sha?: string, path?: string, offset?: number, limit?: number}} payload - client request.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<object>} the same shape `read` returns, so the preview reuses it.
 */
export async function readGitCommitFile(ctx, options, payload, signal) {
  const sha = String(payload?.sha ?? '').toLowerCase()
  if (!isSafeCommitSha(sha)) throw new ViewerError('invalid-commit', '提交标识不合法')
  const filePath = typeof payload?.path === 'string' ? payload.path : ''
  if (filePath === '') throw new ViewerError('not-found', '缺少文件路径')
  // A deletion removed the path from this commit; its contents are still in the
  // parent. The caller may name that parent explicitly, and it is verified to be
  // a commit of this repository before it is used.
  const requestedFrom = payload?.from === undefined ? '' : String(payload.from).toLowerCase()
  if (requestedFrom !== '' && !isSafeCommitSha(requestedFrom)) {
    throw new ViewerError('invalid-commit', '提交标识不合法')
  }

  const { repo, run } = await locateRepository(ctx, options, payload, signal)
  const from = requestedFrom === '' ? sha : requestedFrom
  if (from !== sha) {
    // Only a commit that actually exists here may be read: the hash came from
    // the client, and a random object name must not become a read primitive.
    const verify = await run(repo.toplevel, ['cat-file', '-e', `${from}^{commit}`], signal)
    if (verify?.ok !== true) throw new ViewerError('unknown-commit', '找不到该提交')
  }

  // The requested path is root-relative; git wants it repository-relative, and
  // the placement says which way to translate. A path that does not resolve
  // back inside the root is refused rather than guessed at.
  const placement = { prefix: repo.path, rootRelative: repo.rootRelative }
  const repoPath = repoRelativeFromRoot(placement, filePath)
  if (repoPath === null) throw new ViewerError('outside-root', '该文件不在当前根目录内')

  // `--` separates the revision from the path, so a path that looks like a
  // revision expression cannot be reinterpreted as one.
  const result = await run(repo.toplevel, ['show', `${from}:${repoPath}`], signal)
  if (result?.ok !== true) {
    const stderr = String(result?.stderr ?? '')
    // A path absent from that commit is the ordinary "this file did not exist
    // yet / was already deleted" case, distinct from a broken repository.
    if (/does not exist|exists on disk, but not in|invalid object name|Path .* does not exist/i.test(stderr)) {
      throw new ViewerError('not-found', '该提交中不存在这个文件')
    }
    throw new ViewerError('git-failed', '无法读取该提交中的文件')
  }

  const text = String(result.stdout ?? '')
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
    throw new ViewerError('too-large', 'the file in this commit is too large to read as text')
  }

  const name = baseNameOf(filePath)
  const { lines, eol } = splitLines(text)
  const window = resolveWindow(lines.length, payload?.offset, payload?.limit)
  const fileKind = kindOf(filePath)
  // A blob from history has no file on disk to probe, so the name decides the
  // kind and the content decides the language.
  const detected = resolveLanguage({ override: payload?.lang, path: filePath, sample: text })
  const lang = detected.lang
  return {
    root: repo.id,
    path: filePath,
    name,
    // Kept so the header can show where the bytes came from; the client labels
    // the pane as history rather than the working tree.
    commit: from,
    displayPath: `${name} @ ${from.slice(0, 7)}`,
    kind: fileKind,
    ...(lang === undefined ? {} : { lang }),
    langSource: detected.source,
    langChoice: isKnownLanguage(payload?.lang) ? payload.lang : 'auto',
    eol,
    totalLines: lines.length,
    offset: window.offset,
    end: window.end,
    hasBefore: window.hasBefore,
    hasAfter: window.hasAfter,
    lines: windowRows(lines, window),
    ...(isWholeDocumentKind(fileKind) && text.length <= MAX_PREVIEW_BYTES ? { text } : {}),
  }
}

/**
 * Read the working tree's pending changes, grouped for a source-control view.
 *
 * Staged and unstaged entries are kept apart because they answer different
 * questions, and untracked files are their own group because they are not part
 * of any commit yet. Paths are rebased onto the selected root, and the number
 * that fell outside it is reported rather than silently dropped.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - resolved config reader.
 * @param {{root?: string, repo?: string}} payload - client request.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<object>} the grouped changes.
 */
export async function listGitWorkspaceChanges(ctx, options, payload, signal) {
  const { repo, run } = await locateRepository(ctx, options, payload, signal)
  // `-z` keeps non-ASCII paths and renames unambiguous; `--untracked-files=all`
  // lists files inside a new directory instead of just the directory.
  const result = await run(repo.toplevel, [
    // `-z` keeps non-ASCII paths and renames unambiguous; listing every
    // untracked file (rather than its directory) is what makes them openable.
    'status', '--porcelain=v1', '-z', '--untracked-files=all',
  ], signal)
  if (result?.ok !== true) throw new ViewerError('git-failed', '无法读取工作区状态')

  const entries = parseGitStatusEntries(result.stdout)
  const placement = { prefix: repo.path, rootRelative: repo.rootRelative }
  const groups = groupGitChanges(entries, (repoPath) => commitPathWithinRoot(placement, repoPath))

  // The current branch is part of the answer: "changes on main" is not the same
  // fact as "changes on dev", and the panel shows both together.
  const head = await gitRevisionOf(run, repo.toplevel, ['--abbrev-ref', 'HEAD'], signal)
  return {
    repository: repo.id,
    current: head === 'HEAD' ? '' : head,
    detached: head === 'HEAD',
    staged: groups.staged,
    unstaged: groups.unstaged,
    untracked: groups.untracked,
    conflicted: groups.conflicted,
    outside: groups.outside,
    total: groups.staged.length + groups.unstaged.length + groups.untracked.length + groups.conflicted.length,
  }
}

/**
 * Read one file's working-tree diff, staged or unstaged.
 *
 * `git diff` with no revision shows the unstaged side; `--cached` shows what a
 * commit would capture. Both are offered because a file can appear in each.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - resolved config reader.
 * @param {{root?: string, repo?: string, path?: string, staged?: boolean}} payload - client request.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<object>} the patch plus parsed rows.
 */
export async function readGitWorkspaceDiff(ctx, options, payload, signal) {
  const filePath = typeof payload?.path === 'string' ? payload.path : ''
  if (filePath === '') throw new ViewerError('not-found', '缺少文件路径')
  const { repo, run } = await locateRepository(ctx, options, payload, signal)

  const placement = { prefix: repo.path, rootRelative: repo.rootRelative }
  const repoPath = repoRelativeFromRoot(placement, filePath)
  if (repoPath === null) throw new ViewerError('outside-root', '该文件不在当前根目录内')

  const staged = payload?.staged === true
  const args = staged
    ? ['diff', '--cached', '--no-color', '--', repoPath]
    : ['diff', '--no-color', '--', repoPath]
  const result = await run(repo.toplevel, args, signal)

  if (result?.ok === true && String(result.stdout ?? '').trim() !== '') {
    const patch = String(result.stdout)
    const files = parseUnifiedDiffFiles(patch)
    const rows = files.length > 0 ? files[0].rows : parsePatchToRows(patch)
    const diffs = parsePatchToDiffs(patch, filePath)
    return { hasDiff: true, staged, path: filePath, patch, rows, diffs, summary: summarizeDiffs(diffs) }
  }

  // An untracked file has no diff at all: every line is an addition. Rendering
  // it as one keeps an untracked row useful instead of opening an empty pane.
  const tracked = await run(repo.toplevel, ['ls-files', '--error-unmatch', '--', repoPath], signal)
  if (tracked?.ok !== true && staged === false) {
    const file = await run(repo.toplevel, ['show', `:0:${repoPath}`], signal)
    void file
    const read = await ctx.fs.readText(
      await ctx.fs.resolve(joinPath(repo.toplevel, repoPath), { signal }),
      signal,
    ).catch(() => '')
    if (typeof read === 'string' && read !== '') {
      const rows = parsePatchToRows('', read)
      return { hasDiff: true, staged: false, untracked: true, path: filePath, rows, patch: '', diffs: [] }
    }
  }

  return { hasDiff: false, staged, path: filePath, rows: [], diffs: [] }
}

/**
 * Read one commit's complete patch, every file in one view.
 *
 * The changed-file list answers "what did this commit touch"; the diff answers
 * "what exactly changed inside it". Both come from the same revision pair as
 * the list, so the two views cannot disagree about which parent is the baseline.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - resolved config reader.
 * @param {{root?: string, repo?: string, sha?: string, path?: string}} payload - client request.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<object>} per-file patches.
 */
export async function readGitCommitDiff(ctx, options, payload, signal) {
  const sha = String(payload?.sha ?? '').toLowerCase()
  if (!isSafeCommitSha(sha)) throw new ViewerError('invalid-commit', '提交标识不合法')
  const { repo, run } = await locateRepository(ctx, options, payload, signal)

  const parents = await run(repo.toplevel, ['rev-list', '--parents', '--max-count=1', sha, '--'], signal)
  const parentSha = parents?.ok === true ? String(parents.stdout ?? '').trim().split(/\s+/)[1] ?? '' : ''
  const hasParent = parentSha !== '' && isSafeCommitSha(parentSha)

  // One path narrows the patch to that file; no path returns the whole commit.
  const placement = { prefix: repo.path, rootRelative: repo.rootRelative }
  const wanted = typeof payload?.path === 'string' && payload.path !== ''
    ? repoRelativeFromRoot(placement, payload.path)
    : null
  if (wanted === null && typeof payload?.path === 'string' && payload.path !== '') {
    throw new ViewerError('outside-root', '该文件不在当前根目录内')
  }
  // A rename has two paths, and filtering by only one of them defeats rename
  // detection: git then reports the pair as an unrelated delete plus an add
  // (measured — `-- new-name` prints "new file mode", `-- old-name` prints
  // "deleted file mode"). Passing both keeps `-M` able to pair them.
  const wantedOld = typeof payload?.oldPath === 'string' && payload.oldPath !== ''
    ? repoRelativeFromRoot(placement, payload.oldPath)
    : null
  if (wantedOld === null && typeof payload?.oldPath === 'string' && payload.oldPath !== '') {
    throw new ViewerError('outside-root', '该文件不在当前根目录内')
  }

  const base = hasParent
    ? ['diff', '--no-color', '-M', parentSha, sha]
    : ['show', '--no-color', '--format=', '--first-parent', sha]
  const paths = wanted === null
    ? []
    : [...new Set([wanted, ...(wantedOld === null ? [] : [wantedOld])])]
  const args = paths.length === 0 ? base : [...base, '--', ...paths]
  const result = await run(repo.toplevel, args, signal)
  if (result?.ok !== true) throw new ViewerError('git-failed', '无法读取该提交的改动内容')

  const patch = String(result.stdout ?? '')
  const files = parseUnifiedDiffFiles(patch).map((file) => {
    // The patch's own paths are repository-relative; the client addresses
    // files by root-relative path.
    const current = commitPathWithinRoot(placement, file.path)
    const previous = file.oldPath === '' ? null : commitPathWithinRoot(placement, file.oldPath)
    const badge = gitChangeOf(file.status)
    return {
      path: current.path,
      repoPath: file.path,
      oldPath: previous === null ? null : previous.path,
      status: file.status,
      letter: badge.letter,
      change: badge.label,
      tone: badge.tone,
      outsideRoot: current.outsideRoot,
      added: file.added,
      removed: file.removed,
      rows: file.rows,
    }
  })

  const added = files.reduce((sum, file) => sum + file.added, 0)
  const removed = files.reduce((sum, file) => sum + file.removed, 0)
  return {
    repository: repo.id,
    sha,
    parentSha: hasParent ? parentSha : '',
    patch,
    files,
    // Counted here so the header can show `+N −M` without re-walking rows.
    summary: { added, removed },
    outside: files.filter((file) => file.outsideRoot).length,
  }
}

/**
 * Check out one branch in a repository.
 *
 * This is the only writing operation the panel performs, and it refuses
 * anything that is not an existing branch of the located checkout: the branch
 * name is validated as a ref, then compared against git's own branch list, so
 * a detached checkout cannot be created by accident.
 *
 * When the root is a *subdirectory* of the checkout, the branch lives above the
 * directory the reader is browsing and checking it out rewrites files this
 * plugin was never allowed to read, let alone change. That case is refused
 * unless the caller explicitly passes `allowOutsideRoot`, which the UI only
 * sends after showing the reader what the operation actually covers.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - resolved config reader.
 * @param {{root?: string, repo?: string, branch?: string, allowOutsideRoot?: boolean}} payload - client request.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<{ok: true, branch: string, previous: string, changed: boolean, scope: string}>} the new state.
 */
export async function checkoutGitBranch(ctx, options, payload, signal) {
  const branch = payload?.branch
  if (!isSafeBranchName(branch)) throw new ViewerError('invalid-branch', '分支名不合法')
  // A remote-tracking branch is not a local branch: `git checkout origin/main`
  // produces a detached HEAD (or a new local branch, depending on config)
  // rather than switching to something the panel could then show as current.
  if (String(branch).startsWith('refs/remotes/')) {
    throw new ViewerError('remote-branch-readonly', '远程分支只能查看，不能直接检出')
  }
  const { repo, run } = await locateRepository(ctx, options, payload, signal)

  // A checkout above the root would touch files outside it; that needs an
  // explicit, informed consent from the caller, not a default.
  if (repo.scope === 'parent' && payload?.allowOutsideRoot !== true) {
    throw new ViewerError('checkout-outside-root', '该分支所在的仓库位于当前根目录的上级，检出会影响根目录以外的文件', {
      scope: repo.scope,
    })
  }

  const known = await readBranchNames(run, repo.toplevel, signal)
  if (!known.includes(branch)) throw new ViewerError('unknown-branch', '该分支不存在')

  const head = await gitRevisionOf(run, repo.toplevel, ['--abbrev-ref', 'HEAD'], signal)
  const previous = head === 'HEAD' ? '' : head
  // `previous` is a short name while `branch` is a full ref; compare like with
  // like or a checkout of the current branch would look like a change.
  const branchShort = String(branch).replace(/^refs\/heads\//, '')
  if (previous === branchShort) {
    return { ok: true, branch, previous, changed: false, scope: repo.scope }
  }

  // Hooks and aliases are user code this plugin was never granted the right to
  // run: a viewer that silently executes a repository's `post-checkout` turns
  // a read-only panel into an arbitrary-execution surface. An empty
  // `core.hooksPath` disables hooks for this one invocation only.
  const result = await run(repo.toplevel, ['-c', 'core.hooksPath=', 'checkout', branchShort], signal)
  if (result?.ok !== true) {
    const stderr = String(result?.stderr ?? '')
    // git refuses a checkout that would overwrite local edits. That is the
    // common, explainable outcome, so it gets its own code and message.
    if (/would be overwritten|local changes|Please commit your changes|Please stash/i.test(stderr)) {
      throw new ViewerError('git-dirty', '工作区有未提交的改动，无法切换分支')
    }
    throw new ViewerError('git-failed', '切换分支失败')
  }
  return { ok: true, branch, previous, changed: true, scope: repo.scope }
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

/**
 * Plans are ordinary documents once they land on disk.
 *
 * A plan is the Markdown a Turn submitted through `exit_plan_mode`. It lives in
 * the Session's event log, and the Host renders it from there into its own
 * sidebar (`dsh-resource://plan/<callId>`), so the transcript's plan card is a
 * button with no path anywhere on it — which is why the viewer used to ignore it
 * and the Host's built-in artifact pane opened instead.
 *
 * The viewer is a file viewer, so the honest way to show a plan is to give it a
 * real file **inside the session's own workspace**: every plan is written once
 * under `<cwd>/.dsh-plans/`, and from there it is an ordinary Markdown document
 * that inherits the tree, the outline, the font controls and the md preview for
 * free.
 *
 * Two earlier shapes were worse, and the reasons are worth keeping:
 *
 *  - A separate root under the DSH home put a phantom "计划文档" entry in the
 *    workspace picker that could not be switched away from.
 *  - A virtual document rendered from an RPC reply needed its own drawer pane,
 *    one more piece of state to keep in sync, and had no way to be closed. Once
 *    a plan is a file, every question about it ("how do I get back to the tree",
 *    "how do I close it", "how do I reveal it") is already answered by the tabs
 *    and the tree that exist for files.
 *
 * @module dsh-file-viewer/plans
 */

/** A plan id becomes a filename, so it must not be able to spell a path. */
const PLAN_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/** The heading a plan's title is read from, matching the Host's own rule. */
const PLAN_TITLE_PATTERN = /^#\s+(\S[^\r\n]*)/

/**
 * The directory a Session's plans are written into.
 *
 * Inside the workspace, so it needs no root of its own and the user can browse,
 * reveal and delete plans with the same tree they use for everything else.
 * @param {string} cwd - the Session's workspace root.
 * @returns {string} absolute directory path, not guaranteed to exist yet.
 */
function plansDirectory(cwd) {
  return path.join(cwd, PLANS_DIR_NAME)
}

/**
 * The workspace root a Session is attached to.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {string} sessionId - the Session.
 * @returns {string} absolute path, or '' when it cannot be determined.
 */
function sessionWorkspace(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return ''
  const session = ctx.sessions?.get?.(sessionId)
  const cwd = session?.header?.cwd ?? session?.header?.meta?.cwd
  return typeof cwd === 'string' && path.isAbsolute(cwd) ? cwd : ''
}

/**
 * The Session's complete event log.
 *
 * `session.log` is the canonical, append-only array (the same one the Host folds
 * its chat from), and it covers inherited fork history too. A Session that is no
 * longer live is not readable this way, which is why both callers below treat a
 * missing log as "no plans" rather than as an error.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {string} sessionId - owning Session.
 * @returns {Array<object>} events, oldest first (empty when unavailable).
 */
function sessionEvents(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return []
  const session = ctx.sessions?.get?.(sessionId)
  if (session === undefined) return []
  if (Array.isArray(session.log)) return session.log
  if (Array.isArray(session.events)) return session.events
  return []
}

/**
 * Pull the plan text out of one logged `exit_plan_mode` call.
 * @param {object} event - a `tool/call` event.
 * @returns {{callId: string, title: string, markdown: string, seq: number} | null} the plan, or null for any other event.
 */
function planFromEvent(event) {
  if (event?.type !== 'tool/call') return null
  const data = event.data
  if (data?.name !== 'exit_plan_mode') return null
  const callId = typeof data.callId === 'string' ? data.callId : ''
  if (!PLAN_ID_PATTERN.test(callId)) return null
  let args = data.arguments
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      return null
    }
  }
  const markdown = typeof args?.plan === 'string' ? args.plan : ''
  if (markdown === '') return null
  return { callId, title: PLAN_TITLE_PATTERN.exec(markdown.trim())?.[1] ?? callId, markdown, seq: event.seq ?? 0 }
}

/**
 * Search disk session archives for a plan by its tool call id.
 *
 * A plan card from a Session that is no longer live has no in-memory event log to
 * read, but the Host keeps every Session's history on disk under
 * `~/.dsh/sessions/<encoded-cwd>/<sessionId>/`. Reading it back is what keeps an
 * old card openable after a restart.
 *
 * The cost of getting this wrong is the whole point of this function. A first
 * version walked every archive on the machine — 501 files, 438 MB — decompressing
 * each one to look for the id. That took **21 seconds**, long past the point where
 * a user concludes the click did nothing. Three things fix it:
 *
 *  1. **The session id is a directory name.** The card's address already carries
 *     it, so the target archive can be addressed directly instead of searched for.
 *     Measured: 14 ms to locate, 280 ms to decompress, versus 21 s to sweep.
 *  2. **A sweep is bounded.** Only when the direct hit fails does the walk run,
 *     and then newest-first, stopped by both a file budget and a wall-clock
 *     budget, so the worst case is a few seconds rather than tens.
 *  3. **`zlib`'s zstd is not a substitute for the `zstd` binary.** These archives
 *     are multi-frame (one frame per append). `zstdDecompressSync` and
 *     `createZstdDecompress` both return only the first frame — 211 bytes of a
 *     13 MB file — and the stream throws `Unknown frame descriptor` on the rest.
 *     That failure is silent (or nearly), which would make plans look absent
 *     rather than unreadable, so the binary is used and its absence is reported.
 *
 * @module dsh-file-viewer/plans-archive
 */

/** Files the bounded sweep may decompress before giving up. */
const ARCHIVE_SWEEP_FILE_BUDGET = 80

/** Wall-clock ceiling for the bounded sweep, in milliseconds. */
const ARCHIVE_SWEEP_TIME_BUDGET_MS = 5000

/** Per-file `zstd` deadline, so one pathological archive cannot stall the sweep. */
const ARCHIVE_ZSTD_TIMEOUT_MS = 3000

/** Ceiling on decompressed bytes, matching the largest plausible archive. */
const ARCHIVE_MAX_BYTES = 64 * 1024 * 1024

/**
 * Plans already recovered from disk, keyed by tool call id.
 *
 * Re-opening the same card is common (the reader closes the tab, then wants it
 * back), and a recovered plan never changes — the call id identifies one logged
 * invocation. Failures are deliberately NOT cached: a timeout is a property of
 * this moment's load, and caching it would make one slow read permanent.
 * @type {Map<string, {plan: object, cwd: string}>}
 */
const planArchiveCache = new Map()

/** Successes kept before the oldest entry is dropped. */
const PLAN_ARCHIVE_CACHE_LIMIT = 64

/**
 * In-flight recoveries, so N rapid clicks on one card do one decompression.
 * @type {Map<string, Promise<{plan: object, cwd: string} | null>>}
 */
const planArchivePending = new Map()

/**
 * The archives belonging to one Session.
 *
 * The directory name is the Session id the Host chose, so this is a direct
 * lookup rather than a search — no recursion, no listing of unrelated projects.
 * @param {string} sessionsDir - the Host's sessions root.
 * @param {string} sessionId - the Session the card belongs to.
 * @returns {Promise<string[]>} matching archive paths, newest first.
 */
async function archivesForSession(sessionsDir, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '' || PLAN_ID_PATTERN.test(sessionId) === false) {
    // Same shape rule the Host uses for its directory names: refuse anything that
    // could spell a path.
    return []
  }
  const projects = await fsPromises.readdir(sessionsDir).catch(() => [])
  const found = []
  for (const project of projects) {
    const directory = path.join(sessionsDir, project, sessionId)
    const entries = await fsPromises.readdir(directory).catch(() => null)
    if (entries === null) continue
    for (const name of entries) {
      if (name.endsWith('.jsonl') || name.endsWith('.jsonl.zstd')) {
        found.push(path.join(directory, name))
      }
    }
  }
  return found
}

/**
 * Every archive on the machine, newest first, capped at the sweep budget.
 *
 * Sorted by mtime because the plan being opened is far more likely to be recent
 * than ancient; the cap is what turns "scan everything" into "scan the plausible
 * candidates". Directories are walked explicitly rather than recursively so a
 * stray symlink cannot lead the scan outside the sessions root.
 * @param {string} sessionsDir - the Host's sessions root.
 * @returns {Promise<string[]>} candidate archive paths.
 */
async function recentArchives(sessionsDir) {
  const projects = await fsPromises.readdir(sessionsDir).catch(() => [])
  const rows = []
  for (const project of projects) {
    const projectPath = path.join(sessionsDir, project)
    const sessions = await fsPromises.readdir(projectPath).catch(() => [])
    for (const session of sessions) {
      const sessionPath = path.join(projectPath, session)
      const entries = await fsPromises.readdir(sessionPath).catch(() => [])
      for (const name of entries) {
        if (!name.endsWith('.jsonl') && !name.endsWith('.jsonl.zstd')) continue
        const full = path.join(sessionPath, name)
        const stat = await fsPromises.stat(full).catch(() => null)
        if (stat === null || !stat.isFile()) continue
        rows.push({ full, at: stat.mtimeMs })
      }
    }
  }
  rows.sort((left, right) => right.at - left.at)
  return rows.slice(0, ARCHIVE_SWEEP_FILE_BUDGET).map((row) => row.full)
}

/**
 * Read one archive as text, or report why it could not be read.
 *
 * `zstd` is an external binary here on purpose; see the module comment for the
 * measured reason the built-in decoder cannot stand in for it.
 * @param {string} file - archive path.
 * @returns {Promise<{text: string} | {missing: true} | {failed: true}>} the text, or the failure kind.
 */
async function readArchive(file) {
  if (!file.endsWith('.zstd')) {
    return fsPromises.readFile(file, 'utf8').then((text) => ({ text }), () => ({ failed: true }))
  }
  return new Promise((resolve) => {
    execFile(
      'zstd',
      ['-dc', file],
      { maxBuffer: ARCHIVE_MAX_BYTES, timeout: ARCHIVE_ZSTD_TIMEOUT_MS },
      (error, stdout) => {
        // ENOENT means this machine has no `zstd` at all, which is a different
        // answer from "this archive is corrupt" and has to reach the user.
        if (error !== null && error !== undefined && error.code === 'ENOENT') {
          resolve({ missing: true })
          return
        }
        if (error !== null && error !== undefined) {
          resolve({ failed: true })
          return
        }
        resolve({ text: stdout })
      },
    )
  })
}

/**
 * Pull the plan and the workspace path out of one archive's text.
 * @param {string} text - decompressed JSONL.
 * @param {string} callId - the plan's tool call id.
 * @returns {{plan: object, cwd: string} | null} the plan with its workspace, or null.
 */
function planFromArchiveText(text, callId) {
  // A cheap pre-filter first: most archives mention neither the id nor a plan.
  if (!text.includes(callId)) return null
  let cwd = ''
  let plan = null
  for (const line of text.split('\n')) {
    if (line === '') continue
    // The workspace is recorded once, in the leading `session` event.
    if (cwd === '' && line.includes('"type":"session"')) {
      try {
        const header = JSON.parse(line)
        if (header.type === 'session' && typeof header.cwd === 'string') cwd = header.cwd
      } catch (_) {}
      continue
    }
    if (!line.includes(callId)) continue
    try {
      const candidate = planFromEvent(JSON.parse(line))
      if (candidate !== null && candidate.callId === callId) plan = candidate
    } catch (_) {}
  }
  return plan === null ? null : { plan, cwd }
}

/**
 * Recover one plan from the Session archives on disk.
 *
 * Direct lookup first, bounded sweep second. Throws a `ViewerError` with
 * `plan-archive-unavailable` when the machine has no `zstd`, because "this
 * deployment cannot read archives" must not be reported as "no such plan".
 *
 * @param {string} callId - the plan's tool call id.
 * @param {string} sessionId - the Session the card belongs to, when known.
 * @returns {Promise<{plan: object, cwd: string} | null>} the plan, or null when absent.
 */
async function findPlanFromDisk(callId, sessionId) {
  if (planArchiveCache.has(callId)) return planArchiveCache.get(callId)
  const pending = planArchivePending.get(callId)
  if (pending !== undefined) return pending

  const task = (async () => {
    const sessionsDir = path.join(resolveDshHome(), 'sessions')
    let sawMissingZstd = false

    /**
     * Try one archive and answer with a plan, or a machine-readable miss.
     * @param {string} file - archive path.
     * @returns {Promise<{plan: object, cwd: string} | 'missing' | null>}
     */
    const attempt = async (file) => {
      const read = await readArchive(file)
      if (read.missing === true) {
        sawMissingZstd = true
        return 'missing'
      }
      if (read.failed === true) return null
      return planFromArchiveText(read.text, callId)
    }

    // Stage 1: the Session's own archives. Milliseconds, and it is the path every
    // card from a known Session takes.
    for (const file of await archivesForSession(sessionsDir, sessionId)) {
      const found = await attempt(file)
      if (found === 'missing') break
      if (found !== null) return found
    }

    // Stage 2: a bounded sweep, only when the direct hit found nothing.
    if (sawMissingZstd) return null
    const deadline = Date.now() + ARCHIVE_SWEEP_TIME_BUDGET_MS
    for (const file of await recentArchives(sessionsDir)) {
      if (Date.now() > deadline) break
      const found = await attempt(file)
      if (found === 'missing') {
        sawMissingZstd = true
        break
      }
      if (found !== null) return found
    }

    if (sawMissingZstd) {
      throw new ViewerError(
        'plan-archive-unavailable',
        'this deployment cannot read plan archives: the zstd binary is not installed',
      )
    }
    return null
  })()

  planArchivePending.set(callId, task)
  try {
    const found = await task
    if (found !== null && found !== undefined) {
      planArchiveCache.set(callId, found)
      if (planArchiveCache.size > PLAN_ARCHIVE_CACHE_LIMIT) {
        // Oldest insertion first; Map preserves it.
        const oldest = planArchiveCache.keys().next().value
        if (oldest !== undefined) planArchiveCache.delete(oldest)
      }
    }
    return found === undefined ? null : found
  } finally {
    planArchivePending.delete(callId)
  }
}

/**
 * Read one plan's Markdown out of a Session's event log.
 *
 * The newest matching call wins: a Turn may resubmit a plan under the same id in
 * principle, and the card the user just clicked is always the latest one.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {string} sessionId - owning Session.
 * @param {string} callId - tool call id from the card.
 * @returns {{callId: string, title: string, markdown: string, seq: number} | null} the plan, or null.
 */
function findPlanInSession(ctx, sessionId, callId) {
  const events = sessionEvents(ctx, sessionId)
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const plan = planFromEvent(events[index])
    if (plan !== null && plan.callId === callId) return plan
  }
  return null
}

/**
 * Write a plan's Markdown into the workspace and return where it landed.
 *
 * The file name is the plan's own title, because that is what the user will see
 * in the tree and in their editor. It falls back to the call id only when the
 * title cleans down to nothing usable. An existing file under the same name is
 * overwritten only when its content actually differs, so re-opening a card does
 * not churn the mtime and invalidate the client's cache.
 *
 * @param {string} directory - the workspace's plan directory.
 * @param {{callId: string, title: string}} plan - the plan.
 * @param {string} markdown - plan text.
 * @returns {Promise<string>} absolute path of the written file.
 */
async function materialisePlan(directory, plan, markdown) {
  await fsPromises.mkdir(directory, { recursive: true })
  const target = path.join(directory, planFileName(plan))
  const existing = await fsPromises.readFile(target, 'utf8').catch(() => null)
  if (existing !== markdown) await fsPromises.writeFile(target, markdown, 'utf8')
  return target
}

/**
 * Turn a plan card click into a real file the viewer opens like any other.
 *
 * A plan lands in the Session's own workspace (`<cwd>/.dsh-plans/<title>.md`), so
 * from the client's point of view this is an ordinary Markdown file: the drawer
 * opens it in a tab, the tree reveals it, the outline works, and closing the tab
 * closes the plan. None of that needs plan-specific state.
 *
 * The `plans` list still comes back so the drawer can offer the Session's other
 * plans — but only while this plan's tab is the one on screen.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {() => object} options - resolved config reader.
 * @param {{sessionId?: string, callId?: string}} payload - card identity.
 * @returns {Promise<object>} the written file, its workspace root, and the plan list.
 */
async function openPlan(ctx, options, payload) {
  const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : ''
  const callId = typeof payload?.callId === 'string' ? payload.callId : ''
  if (!PLAN_ID_PATTERN.test(callId)) {
    throw new ViewerError('invalid-plan', 'the plan id is not a usable file name')
  }

  let plan = findPlanInSession(ctx, sessionId, callId)
  let cwd = sessionWorkspace(ctx, sessionId)

  // Stage 1: the Session named by the card. In memory this is instant; after a
  // restart it falls through to the archive on disk.
  if (plan === null) {
    for (const s of ctx.sessions?.list?.() ?? []) {
      const p = findPlanInSession(ctx, s.id, callId)
      if (p !== null) {
        plan = p
        if (cwd === '') cwd = s?.header?.cwd ?? s?.header?.meta?.cwd ?? ''
        break
      }
    }
  }

  // Stage 2: the disk archives. The session id makes this a lookup rather than a
  // sweep (see `findPlanFromDisk`); without it the sweep still runs, bounded.
  if (plan === null) {
    const fromDisk = await findPlanFromDisk(callId, sessionId)
    if (fromDisk !== null) {
      plan = fromDisk.plan
      if (cwd === '' && fromDisk.cwd) cwd = fromDisk.cwd
    }
  }

  // The workspace the plan belongs to is part of the plan's identity, not a
  // preference: guessing would write one project's plan into another's tree.
  // `workspaceRegistry` is only consulted for the Session's own membership, and
  // failing that the user is told which piece is missing instead of being handed
  // an arbitrary directory.
  if (cwd === '') {
    const owned = ctx.workspaceRegistry?.list?.() ?? []
    const match = owned.find((workspace) => {
      const sessions = workspace?.sessionIds
      return Array.isArray(sessions) && sessionId !== '' && sessions.includes(sessionId)
    })
    if (match !== undefined && typeof match.path === 'string') cwd = match.path
  }

  if (plan === null && cwd === '') {
    // Both halves are missing: nothing can be opened and nothing can be written.
    throw new ViewerError(
      'no-workspace',
      'this plan could not be found in the Session history, and the Session is not attached to a workspace',
    )
  }
  if (plan === null) {
    throw new ViewerError('plan-not-found', 'this plan is no longer part of the Session history')
  }
  if (cwd === '') {
    throw new ViewerError(
      'no-workspace',
      'the workspace this plan belongs to could not be determined, so it was not written anywhere',
    )
  }
  const directory = plansDirectory(cwd)
  let filePath
  try {
    filePath = await materialisePlan(directory, plan, plan.markdown)
  } catch (error) {
    throw new ViewerError('plan-write-failed', 'the plan could not be written into the workspace', {
      reason: typeof error?.code === 'string' ? error.code : 'unknown',
    })
  }
  // Plans are the viewer's own working files, not part of the user's project, so
  // an existing repository should not start reporting them as untracked. Best
  // effort: a workspace without `.git` is not a repository and needs nothing.
  await ignorePlansDirectory(cwd)
  return {
    callId,
    // The drawer works in root-relative paths, so it needs both halves.
    root: cwd,
    path: path.relative(cwd, filePath).split(path.sep).join('/'),
    name: path.basename(filePath),
    title: plan.title,
    plans: listSessionPlans(ctx, sessionId, cwd),
  }
}

/**
 * Keep the plan directory out of the workspace's Git status.
 *
 * Written to `.git/info/exclude` rather than the root `.gitignore`: that way the
 * repository's Git status ignores `.dsh-plans/` without dirtying any tracked
 * file or creating an unexpected diff in the user's project.
 *
 * Only a real repository is touched (`.git` must exist) and only one line is
 * appended, so the file is left alone when the entry is already there.
 * @param {string} cwd - the workspace root.
 * @returns {Promise<void>} resolves even when the workspace is not a repository.
 */
async function ignorePlansDirectory(cwd) {
  try {
    const gitDir = path.join(cwd, '.git')
    const stat = await fsPromises.stat(gitDir).catch(() => null)
    if (stat === null) return
    const infoDir = path.join(gitDir, 'info')
    await fsPromises.mkdir(infoDir, { recursive: true }).catch(() => null)
    const ignoreFile = path.join(infoDir, 'exclude')
    const current = await fsPromises.readFile(ignoreFile, 'utf8').catch(() => null)
    if (current === null) {
      await fsPromises.writeFile(ignoreFile, `${PLANS_DIR_NAME}/\n`, 'utf8')
      return
    }
    // Match the entry as its own line; `PLAN.md` must not count as covered.
    const covered = current.split(/\r?\n/).some((line) => {
      const trimmed = line.trim()
      return trimmed === `${PLANS_DIR_NAME}/` || trimmed === PLANS_DIR_NAME
    })
    if (covered) return
    const separator = current === '' || current.endsWith('\n') ? '' : '\n'
    await fsPromises.appendFile(ignoreFile, `${separator}${PLANS_DIR_NAME}/\n`, 'utf8')
  } catch {
    // A read-only or otherwise locked workspace is not a reason to fail the
    // open: the plan still opens, it just shows up as untracked.
  }
}

/**
 * The display name for a plan.
 *
 * Derived from the title with a short call id suffix so the tab reads like a
 * document while ensuring multiple plans or updated plans with the same title
 * never overwrite each other. The characters stripped here are Windows'
 * forbidden set (`<>:"/\|?*` plus control characters); enforcing the strictest
 * platform everywhere keeps one rule instead of three, and a title containing
 * `:` would otherwise break the download route on Windows only.
 * @param {{callId: string, title: string}} plan - the plan.
 * @returns {string} a safe `.md` file name.
 */
function planFileName(plan) {
  const title = typeof plan.title === 'string' ? plan.title : ''
  const cleaned = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80)
  const callId = typeof plan.callId === 'string' ? plan.callId : ''
  const suffix = callId.length > 8 ? callId.slice(-8) : callId
  // A title that cleans down to nothing (or to dots, which would name a hidden
  // or invalid file) falls back to the call id.
  const stem = cleaned === '' || /^\.+$/.test(cleaned)
    ? (callId || 'plan')
    : (suffix ? `${cleaned}-${suffix}` : cleaned)
  return `${stem}.md`
}

/**
 * The plans a Session submitted, newest first, as openable documents.
 *
 * Nothing is written here: browsing the list must not create files as a side
 * effect, so a listed plan only becomes a file when it is actually opened.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {string} sessionId - owning Session.
 * @returns {Array<{callId: string, title: string, path: string}>} plans in reverse submission order.
 */
function listSessionPlans(ctx, sessionId, cwd) {
  const events = sessionEvents(ctx, sessionId)
  const workspace = typeof cwd === 'string' && cwd !== '' ? cwd : sessionWorkspace(ctx, sessionId)
  const directory = workspace === '' ? '' : plansDirectory(workspace)
  const seen = new Set()
  const plans = []
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const plan = planFromEvent(events[index])
    if (plan === null || seen.has(plan.callId)) continue
    seen.add(plan.callId)
    const fileName = planFileName(plan)
    plans.push({
      callId: plan.callId,
      title: plan.title,
      // Root-relative, like every other path the drawer works with; empty when
      // the Session has no workspace, in which case the entry is not openable.
      path: directory === '' ? '' : path.relative(workspace, path.join(directory, fileName)).split(path.sep).join('/'),
    })
  }
  return plans
}

/** Method table; each entry receives `(ctx, options, payload, signal)`. */
const METHODS = Object.freeze({
  roots: (ctx, options, payload) => resolveSessionRoot(ctx, options, payload),
  // A plan is not a file, so it cannot come through `roots`/`read`: the card
  // hands over a tool call id and the host does the writing.
  openPlan,
  listPlans: (ctx, options, payload) => listSessionPlans(ctx, payload?.sessionId),
  list: listDirectory,
  // The only destructive method on this channel. Its payload is vetted exactly
  // like a read (`resolveInRoot`), and the root itself is refused.
  delete: deleteEntry,
  meta: describeFile,
  read: readText,
  diff: getFileDiff,
  status: getWorkspaceGitStatus,
  // The Git panel: discovery, paged history, one commit's files, checkout.
  gitRepos: listGitRepositories,
  gitCommits: listGitCommits,
  gitCommitFiles: readGitCommitFiles,
  gitCommitFile: readGitCommitFile,
  // One commit's complete patch, and the working tree's pending changes.
  gitCommitDiff: readGitCommitDiff,
  gitStatusChanges: listGitWorkspaceChanges,
  gitWorkspaceDiff: readGitWorkspaceDiff,
  gitCheckout: checkoutGitBranch,
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
 * Map one thrown value onto a status plus a body that is safe to echo.
 *
 * Two rules matter here and both are enforced by the existing RPC channel
 * (`handleRpc`), so the streaming route must not be a weaker door:
 *   - backend fs failures carry host codes (`FS_TOO_LARGE`, `FS_NOT_FOUND`,
 *     …) and must land on the status the client already switches on, or the
 *     "exceeds 100 MB" notice never fires;
 *   - the body is an opaque reason, never `error.message`, because fs errors
 *     embed absolute host paths (`EACCES: … 'D:/repo/secret/.env'`).
 * @param {unknown} error - the thrown value.
 * @returns {{status: number, reason: string}} status and a path-free reason.
 */
export function downloadFailure(error) {
  if (error instanceof ViewerError) {
    const viewerStatus = {
      'not-found': 404,
      'not-a-directory': 403,
      'is-a-directory': 403,
      'unknown-root': 404,
      'no-roots': 404,
      'outside-root': 403,
      'access-denied': 403,
      'too-large': 413,
      unsupported: 415,
    }
    return { status: viewerStatus[error.code] ?? 400, reason: error.code }
  }
  const code = typeof error?.code === 'string' ? error.code : ''
  const fsStatus = {
    FS_NOT_FOUND: 404,
    FS_NOT_DIRECTORY: 403,
    FS_NOT_REGULAR_FILE: 403,
    FS_PERMISSION_DENIED: 403,
    FS_SANDBOX_DENIED: 403,
    FS_TOO_LARGE: 413,
    FS_ABORTED: 499,
    FS_IO_ERROR: 500,
  }
  if (Object.hasOwn(fsStatus, code)) return { status: fsStatus[code], reason: code }
  return { status: 500, reason: 'download-failed' }
}

/**
 * Stream one file to the browser's save flow under the authenticated API fence.
 *
 * Files are read through `ctx.fs` with the caller's signal so a cancelled
 * download stops the host read, and the byte budget comes from
 * `maxDownloadBytes` rather than the much smaller in-page preview budget.
 */
export async function handleDownloadRequest(ctx, options, request) {
  try {
    const url = new URL(request.url, 'http://dsh.local')
    const root = url.searchParams.get('root') || undefined
    const path = url.searchParams.get('path') || ''
    const customFilename = url.searchParams.get('filename') || ''

    const { target, relative } = await resolveInRoot(ctx, options, { root, path }, request.signal)
    const info = await ctx.fs.stat(target, request.signal)
    if (info === undefined) {
      return new Response('not-found', { status: 404 })
    }
    if (info.type === 'directory') {
      return new Response('is-a-directory', { status: 403 })
    }

    const maxBytes = options().maxDownloadBytes ?? MAX_DOWNLOAD_BYTES
    if (typeof info.size === 'number' && info.size > maxBytes) {
      return new Response('too-large', { status: 413 })
    }

    const naming = relative === '' ? target.displayPath : relative
    const filename = customFilename || baseNameOf(naming)
    const mime = mediaTypeOf(naming) || 'application/octet-stream'

    const headers = {
      'Content-Type': mime,
      'Content-Disposition': contentDispositionFor(filename),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    }

    if (request.method === 'HEAD') {
      if (info.size !== undefined) headers['Content-Length'] = String(info.size)
      return new Response(null, { headers })
    }

    // `readBytes` enforces the same budget, so a backend that reports no size
    // still cannot hand back more than the download limit.
    const bytes = await ctx.fs.readBytes(target, request.signal, maxBytes)
    headers['Content-Length'] = String(bytes.byteLength)
    return new Response(bytes, { headers })
  } catch (error) {
    const { status, reason } = downloadFailure(error)
    ctx.logger?.warn?.(`file-viewer: download failed with ${reason}`)
    return new Response(reason, { status })
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
      maxDownloadBytes: settings?.maxDownloadBytes ?? MAX_DOWNLOAD_BYTES,
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
    /*
     * The download route is an optimization, not a requirement: the RPC
     * `bytes` method still downloads anything the streaming path cannot
     * reach. Registering a duplicate path throws inside `connection.fetch`
     * (its exact-route table rejects collisions), so a failure here must
     * degrade to the RPC path instead of aborting the whole plugin apply.
     */
    try {
      if (typeof connectionCtx.connection?.fetch?.register === 'function') {
        connectionCtx.connection.fetch.register({
          path: DOWNLOAD_ROUTE,
          methods: ['GET', 'HEAD'],
          requestBody: 'buffered',
          fetch: (request) => handleDownloadRequest(ctx, options, request),
        })
      }
    } catch (error) {
      ctx.logger?.warn?.(`file-viewer: download route unavailable, falling back to RPC (${error?.message || error})`)
    }
  })
}
