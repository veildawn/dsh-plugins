/**
 * dsh-archive-manager host core
 *
 * Real DSH contracts used here (verified against the installed packages):
 *
 * - `ctx.workspaceRegistry` (@deepseek-ai/dsh-workspace): public surface is
 *   `archivedSessionIds` (read-only) + `archiveSession(id)` (add-only). DSH
 *   core ships NO unarchive API, so this plugin reaches the registry's
 *   operation queue and domain state through the runtime-visible private
 *   methods `enqueueOperation` / `requireState` / `setState`, exactly as the
 *   registry's own public methods do internally. Feature detection guards the
 *   shape; a changed DSH release fails loud with a clear message instead of a
 *   silent no-op.
 * - `ctx.sessionPersistence` (@deepseek-ai/dsh-session-persistence): public
 *   `list()` (one header per session, disk-backed) and `locate(header)` —
 *   which resolves the ABSOLUTE path of the backend-owned artifact (JSONL
 *   backend: `logPath(root, cwd, id, compression)`). `list()` scans the disk,
 *   so moving a session's artifact makes it disappear from listings and the
 *   SQLite search index self-heals on its next observation cycle.
 *
 * Physical deletion strategy (see README "Physical deletion"):
 *
 *   1. A session that is LIVE (present in `ctx.get('sessions')`) is refused —
 *      its event stream is backed by the artifact and moving the file under a
 *      live writer would corrupt the log.
 *   2. The artifact is MOVED (rename) into a plugin-owned trash directory —
 *      never unlinked — so the operation is reversible and the persistence
 *      coordinator never observes a vanished file it still expects.
 *   3. The id is removed from the archive set through the registry operation
 *      queue, so the badge/list stay honest.
 *   4. A tombstone `{ kind: 'physical', trashPath, originalPath }` is stored
 *      in plugin settings; restore renames the file back; destroy unlinks it.
 *
 * The sandboxed bash/pwsh tool services (dsh-bash-sandbox / dsh-pwsh-sandbox)
 * are deliberately NOT used: their `workspace-write` mode only allows writes
 * under the workspace root + tmp, and the session logs live under the DSH
 * home (`~/.dsh/...`), so shell deletion would be denied unless escalated to
 * `danger-full-access` (an approval flow) — and the plugin host process
 * already runs outside the sandbox with direct Node fs access.
 */

import { join, dirname, basename } from 'node:path'
import * as nodeFs from 'node:fs/promises'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

const RPC_CHANNEL = '/dsh-archive-manager-rpc'

/** Settings namespace: durable tombstones + feature options. */
export const NS = 'archive-manager'

export function resolveOptions(raw = {}) {
  const tombstones = Array.isArray(raw.tombstones) ? raw.tombstones : []
  return {
    physicalDelete: raw.physicalDelete === true,
    trashDir: typeof raw.trashDir === 'string' && raw.trashDir ? raw.trashDir : '',
    tombstones: tombstones
      .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.deletedAt === 'string')
      .map((entry) => ({
        id: entry.id,
        kind: entry.kind === 'physical' ? 'physical' : 'soft',
        deletedAt: entry.deletedAt,
        trashPath: typeof entry.trashPath === 'string' && entry.trashPath ? entry.trashPath : null,
        originalPath: typeof entry.originalPath === 'string' && entry.originalPath ? entry.originalPath : null,
      })),
  }
}

export function resolveTrashDir(options) {
  if (options.trashDir) return options.trashDir
  try {
    return dshHomePath('archive-manager', 'trash')
  } catch {
    return ''
  }
}

export function errorResult(message, code = 'bad-request', details = {}) {
  return {
    ok: false,
    error: {
      code,
      message,
      details: typeof details === 'object' && details !== null && !Array.isArray(details) ? details : {},
    },
  }
}

export function okResult(value) {
  return { ok: true, value }
}

/**
 * Safely look up a Cordis service without triggering the Proxy getter trap
 * that throws "cannot get property ... without inject".
 * Tries ctx.get(name) first, falling back to ctx[name] safely.
 */
export function getService(ctx, name) {
  if (!ctx) return undefined
  try {
    if (typeof ctx.get === 'function') {
      const val = ctx.get(name)
      if (val !== undefined) return val
    }
  } catch {}
  try {
    return ctx[name]
  } catch {
    return undefined
  }
}

/**
 * Remove ids from the registry-global archive set, routed through the
 * registry's own serialized operation queue so it cannot interleave with
 * concurrent archive/create/delete operations. A session whose id is not in
 * the set resolves without writing (mirrors archiveSession's idempotence).
 */
export async function unarchiveSessions(ctx, sessionIds) {
  const registry = getService(ctx, 'workspaceRegistry')
  if (!registry || typeof registry.enqueueOperation !== 'function' || typeof registry.setState !== 'function' || typeof registry.requireState !== 'function') {
    throw new Error('workspace registry does not expose the state surface required for unarchive (DSH version mismatch?)')
  }
  const target = new Set(sessionIds.map(String))
  await registry.enqueueOperation(async () => {
    const state = registry.requireState()
    const current = Array.isArray(state.archivedSessionIds) ? state.archivedSessionIds : []
    const next = current.filter((id) => !target.has(String(id)))
    if (next.length === current.length) return
    await registry.setState({ ...state, archivedSessionIds: next })
  })
}

/**
 * Soft-delete: record a `soft` tombstone in plugin settings. The archive-set
 * membership is left untouched so the session stays hidden from every
 * grouping surface; this plugin's own list filters tombstoned ids out. The
 * underlying log is retained and restorable.
 */
export async function deleteSessions(scope, sessionIds) {
  const current = resolveOptions(scope.get()).tombstones
  const existing = new Set(current.map((entry) => entry.id))
  const now = new Date().toISOString()
  const added = sessionIds.filter((id) => !existing.has(id)).map((id) => ({ id, kind: 'soft', deletedAt: now, trashPath: null, originalPath: null }))
  if (added.length === 0) return []
  await scope.update({ tombstones: [...current, ...added] })
  return added.map((entry) => entry.id)
}

/** Clear soft tombstones: the sessions reappear in the archive manager list. */
export async function restoreDeleted(scope, sessionIds) {
  const target = new Set(sessionIds)
  const current = resolveOptions(scope.get()).tombstones
  const restored = []
  const remaining = []
  for (const entry of current) {
    if (entry.kind === 'soft' && target.has(entry.id)) {
      restored.push(entry.id)
      continue
    }
    remaining.push(entry)
  }
  if (restored.length === 0) return []
  await scope.replace({ tombstones: remaining })
  return restored
}

/** Resolve the backend artifact path for one session, or `undefined`. */
async function resolveArtifactPath(ctx, sessionId, headers) {
  const sessionsService = getService(ctx, 'sessions')
  const live = sessionsService?.get?.(sessionId)
  const header = live?.header ?? headers.get(String(sessionId))
  if (!header) return undefined
  const persistence = getService(ctx, 'sessionPersistence')
  if (typeof persistence?.locate !== 'function') return undefined
  const located = persistence.locate(header)
  if (!located || typeof located.path !== 'string') return undefined
  return { header, path: located.path, kind: located.kind }
}

/**
 * Physical delete: refuse live sessions, move the artifact into the plugin
 * trash directory (reversible), remove the id from the archive set, and
 * record a `physical` tombstone. Returns per-id outcomes.
 */
export async function physicalDeleteSessions(ctx, scope, sessionIds, options, fsd = nodeFs) {
  const current = resolveOptions(scope.get()).tombstones
  const existing = new Set(current.map((entry) => entry.id))
  const trashDir = resolveTrashDir(options)
  const headers = new Map()
  try {
    const persistence = getService(ctx, 'sessionPersistence')
    const listed = await persistence?.list?.() || []
    for (const item of listed) {
      const header = item?.header ?? item
      if (header?.id) headers.set(String(header.id), header)
    }
  } catch {
    // best-effort; live headers still resolve below
  }

  const now = new Date().toISOString()
  const moved = []
  const skipped = []
  for (const sessionId of sessionIds) {
    if (existing.has(sessionId)) {
      skipped.push({ id: sessionId, reason: 'already deleted' })
      continue
    }
    const agentsService = getService(ctx, 'agents')
    const agent = agentsService?.get?.(sessionId)
    if (agent?.status === 'running') {
      skipped.push({ id: sessionId, reason: 'session is live and actively running; close it first' })
      continue
    }
    const sessionsService = getService(ctx, 'sessions')
    const live = sessionsService?.get?.(sessionId)
    if (live) {
      try {
        const entry = sessionsService.liveEntryFor?.(live)
        if (entry) sessionsService.detachEntered?.(entry)
      } catch {}
    }
    const artifact = await resolveArtifactPath(ctx, sessionId, headers)
    if (!artifact) {
      skipped.push({ id: sessionId, reason: 'no artifact location resolved for this session' })
      continue
    }
    let trashPath = null
    if (trashDir) {
      const exists = await fsd.stat(artifact.path).then(() => true, () => false)
      if (exists) {
        await fsd.mkdir(trashDir, { recursive: true })
        let dest = join(trashDir, basename(artifact.path))
        if (await fsd.stat(dest).then(() => true, () => false)) {
          dest = join(trashDir, `${basename(artifact.path)}.${Date.now()}`)
        }
        await fsd.rename(artifact.path, dest)
        trashPath = dest
      }
    }
    const entry = { id: sessionId, kind: 'physical', deletedAt: now, trashPath, originalPath: artifact.path }
    await scope.update({ tombstones: [...resolveOptions(scope.get()).tombstones, entry] })
    moved.push({ id: sessionId, trashPath, originalPath: artifact.path })
  }

  const movedIds = moved.map((entry) => entry.id)
  if (movedIds.length > 0) {
    await unarchiveSessions(ctx, movedIds)
  }
  return { moved, skipped }
}

/** Move a physical tombstone's artifact back to its original location. */
export async function restorePhysicalSessions(ctx, scope, sessionIds, fsd = nodeFs) {
  const target = new Set(sessionIds)
  const current = resolveOptions(scope.get()).tombstones
  const restored = []
  const remaining = []
  for (const entry of current) {
    if (entry.kind === 'physical' && target.has(entry.id)) {
      if (entry.trashPath && entry.originalPath) {
        await fsd.mkdir(dirname(entry.originalPath), { recursive: true })
        await fsd.rename(entry.trashPath, entry.originalPath)
      }
      restored.push(entry.id)
      continue
    }
    remaining.push(entry)
  }
  if (restored.length > 0) await scope.replace({ tombstones: remaining })
  return restored
}

/** Irreversibly unlink a physical tombstone's artifact and drop the record. */
export async function destroyPhysicalSessions(ctx, scope, sessionIds, fsd = nodeFs) {
  const target = new Set(sessionIds)
  const current = resolveOptions(scope.get()).tombstones
  const destroyed = []
  const remaining = []
  for (const entry of current) {
    if (entry.kind === 'physical' && target.has(entry.id)) {
      if (entry.trashPath) {
        await fsd.unlink(entry.trashPath).catch(() => {})
      }
      destroyed.push(entry.id)
      continue
    }
    remaining.push(entry)
  }
  if (destroyed.length > 0) await scope.replace({ tombstones: remaining })
  return destroyed
}

/**
 * Completely and irreversibly purge sessions from disk, registry and tombstones.
 * 1. Checks if session's agent is actively running (refuses only if active).
 * 2. Detaches idle live sessions from the memory store so files can be deleted safely.
 * 3. Locates artifact path, determines its session directory, and deletes via rm -rf.
 * 4. Cleans up any trashPath if it was previously moved.
 * 5. Cleans up projection cache files and cleans up from archivedSessionIds.
 * 6. Purges any matching tombstone from plugin settings.
 */
export async function permanentPurgeSessions(ctx, scope, sessionIds, fsd = nodeFs) {
  const current = resolveOptions(scope.get()).tombstones
  const target = new Set(sessionIds.map(String))
  const purged = []
  const skipped = []

  const headers = new Map()
  try {
    const persistence = getService(ctx, 'sessionPersistence')
    const listed = await persistence?.list?.() || []
    for (const item of listed) {
      const header = item?.header ?? item
      if (header?.id) headers.set(String(header.id), header)
    }
  } catch {}

  const sessionsService = getService(ctx, 'sessions')
  const agentsService = getService(ctx, 'agents')

  for (const sessionId of sessionIds) {
    const sid = String(sessionId)
    // 1. 只有当智能体正在运行/生成时才拒绝
    const agent = agentsService?.get?.(sid)
    if (agent?.status === 'running') {
      skipped.push({ id: sid, reason: '会话正在执行后台任务中，无法删除' })
      continue
    }

    // 2. 若会话常驻于内存 sessions store 中，安全卸载释放
    const live = sessionsService?.get?.(sid)
    if (live) {
      try {
        const entry = sessionsService.liveEntryFor?.(live)
        if (entry) sessionsService.detachEntered?.(entry)
      } catch {}
    }

    // 3. 若曾移入回收站，删除其回收站中的文件
    const tombstone = current.find((t) => String(t.id) === sid)
    if (tombstone?.trashPath) {
      try {
        await fsd.rm(tombstone.trashPath, { recursive: true, force: true }).catch(() => {})
      } catch {}
    }

    // 4. 定位并物理抹除原始会话目录 (整个 sessionDir)
    const artifact = await resolveArtifactPath(ctx, sid, headers)
    if (artifact?.path) {
      try {
        const sessionDir = dirname(artifact.path)
        await fsd.rm(sessionDir, { recursive: true, force: true }).catch(() => {})
      } catch (err) {
        console.warn(`[archive-manager] Failed to rm sessionDir for ${sid}:`, err)
      }
    }

    // 5. 跨项目直接清理 ~/.dsh/sessions/ 各目录下的专属 sessionId 文件夹 (兜底防御)
    try {
      const rootSessions = dshHomePath('sessions')
      const projects = await fsd.readdir(rootSessions).catch(() => [])
      for (const p of projects) {
        const targetDir = join(rootSessions, p, sid)
        await fsd.rm(targetDir, { recursive: true, force: true }).catch(() => {})
      }
    } catch {}

    // 6. 清理 session_projcache 缓存文件
    try {
      const cacheFile = dshHomePath('storages', 'session_projcache', 'sessions', `${sid}.json`)
      await fsd.unlink(cacheFile).catch(() => {})
    } catch {}

    purged.push(sid)
  }

  // 7. 从归档集合完全移出
  if (purged.length > 0) {
    await unarchiveSessions(ctx, purged)
    // 8. 清除 tombstones 记录
    const remaining = current.filter((t) => !target.has(String(t.id)))
    await scope.replace({ tombstones: remaining })
  }

  return { purged, skipped }
}

/**
 * Resolve the durable session title:
 * 1. Live session -> `ctx.sessionTitle.get(session)` (real-time folded title).
 * 2. Cold session -> `ctx.sessionProjectionCache.cachedSnapshot(header, 0)` —
 *    the `title` projection key (string | null), zero-I/O checkpoint read.
 *    Note: cachedSnapshot requires inheritedEventCount (pass 0).
 * 3. Fallback -> the cwd basename.
 * Wrapped in try-catch so an unexpected fault in title resolution never breaks
 * listing the archived sessions.
 */
function resolveSessionTitle(ctx, sessionId, liveSessions, headers) {
  try {
    const live = liveSessions?.get?.(sessionId)
    if (live) {
      const service = getService(ctx, 'sessionTitle')
      const snapshot = typeof service?.get === 'function' ? service.get(live) : undefined
      if (snapshot && typeof snapshot.title === 'string' && snapshot.title) return snapshot.title
    }
    const header = live?.header ?? headers.get(String(sessionId))
    if (header) {
      const cache = getService(ctx, 'sessionProjectionCache')
      if (cache) {
        if (typeof cache.cachedSnapshot === 'function') {
          const snapshot = cache.cachedSnapshot(header, 0)
          const title = snapshot?.values?.title
          if (typeof title === 'string' && title) return title
        }
        if (typeof cache.cachedPredecessorTitle === 'function') {
          const snapshot = cache.cachedPredecessorTitle(header, 0)
          const title = snapshot?.values?.title
          if (typeof title === 'string' && title) return title
        }
      }
    }
    // Direct table lookup from sessionProjectionCache storage domain table if available
    try {
      const cache = getService(ctx, 'sessionProjectionCache')
      const tableRecord = cache?.table?.get?.(String(sessionId))
      const tableTitle = tableRecord?.rows?.title?.val
      if (typeof tableTitle === 'string' && tableTitle) return tableTitle
    } catch {}

    const cwd = header?.cwd
    if (cwd) return cwd.split(/[\\/]/).filter(Boolean).pop() || cwd
  } catch {
    // Fall through to fallback
  }
  return `会话 ${String(sessionId)}`
}

/**
 * Summaries for every archived session not tombstoned. Uses only the cheap
 * metadata surfaces: `sessionPersistence.list()` (disk-backed header listing,
 * no log parse), `workspaceRegistry.list()` (in-memory), and the zero-I/O
 * `title` projection checkpoint (falling back to the cwd basename).
 */
export async function listSummaries(ctx, scope) {
  const registry = getService(ctx, 'workspaceRegistry')
  const archivedIds = Array.isArray(registry?.archivedSessionIds) ? registry.archivedSessionIds : []
  if (archivedIds.length === 0) return []

  const tombstoned = new Set(resolveOptions(scope.get()).tombstones.map((entry) => entry.id))
  const workspaces = registry?.list?.() || []
  const headers = new Map()
  try {
    const persistence = getService(ctx, 'sessionPersistence')
    const listed = await persistence?.list?.() || []
    for (const item of listed) {
      const header = item?.header ?? item
      if (header?.id) headers.set(String(header.id), header)
    }
  } catch {
    // best-effort; live sessions still resolve below.
  }
  const liveSessions = getService(ctx, 'sessions')
  const resolveHeader = (id) => liveSessions?.get?.(id)?.header ?? headers.get(String(id))

  const summaries = []
  for (const sessionId of archivedIds) {
    if (tombstoned.has(sessionId)) continue
    const header = resolveHeader(sessionId)
    const ws = workspaces.find((w) => Array.isArray(w.sessionIds) && w.sessionIds.includes(sessionId))
    const cwd = header?.cwd
    summaries.push({
      id: sessionId,
      title: resolveSessionTitle(ctx, sessionId, liveSessions, headers),
      cwd: cwd ?? null,
      workspaceId: ws ? String(ws.id) : null,
      workspaceTitle: ws ? ws.title : '未分组 (Ungrouped)',
      createdAt: header?.createdAt != null ? new Date(header.createdAt).toISOString() : null,
      origin: header?.origin ?? null,
    })
  }

  return summaries.sort((a, b) => {
    const at = a.createdAt ? Date.parse(a.createdAt) : 0
    const bt = b.createdAt ? Date.parse(b.createdAt) : 0
    return bt - at || String(a.id).localeCompare(String(b.id))
  })
}

/** Tombstoned summaries: soft ones (still archived) and physical ones (always). */
export async function listDeleted(ctx, scope) {
  const registry = getService(ctx, 'workspaceRegistry')
  const archivedIds = new Set(Array.isArray(registry?.archivedSessionIds) ? registry.archivedSessionIds : [])
  const tombstones = resolveOptions(scope.get()).tombstones
  const headers = new Map()
  try {
    const persistence = getService(ctx, 'sessionPersistence')
    const listed = await persistence?.list?.() || []
    for (const item of listed) {
      const header = item?.header ?? item
      if (header?.id) headers.set(String(header.id), header)
    }
  } catch {
    // best-effort
  }
  const liveSessions = getService(ctx, 'sessions')
  const workspaces = registry?.list?.() || []
  const rows = []
  for (const entry of tombstones) {
    if (entry.kind === 'soft' && !archivedIds.has(entry.id)) continue
    const header = liveSessions?.get?.(entry.id)?.header ?? headers.get(String(entry.id))
    const ws = workspaces.find((w) => Array.isArray(w.sessionIds) && w.sessionIds.includes(entry.id))
    const cwd = header?.cwd
    rows.push({
      id: entry.id,
      kind: entry.kind,
      title: resolveSessionTitle(ctx, entry.id, liveSessions, headers),
      cwd: cwd ?? null,
      workspaceTitle: ws ? ws.title : '未分组 (Ungrouped)',
      deletedAt: entry.deletedAt,
      trashPath: entry.kind === 'physical' ? entry.trashPath : null,
      originalPath: entry.kind === 'physical' ? entry.originalPath : null,
      createdAt: header?.createdAt != null ? new Date(header.createdAt).toISOString() : null,
    })
  }
  return rows.sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt))
}

/**
 * RPC dispatch for the trusted-host channel. Every handler answers the
 * `{ ok, value }` / `{ ok: false, error }` envelope the client expects.
 */
export async function handleArchiveRpc(ctx, scope, options, method, payload) {
  const body = payload && typeof payload === 'object' ? payload : {}
  const ids = (list) => Array.isArray(list) ? list.filter((id) => typeof id === 'string') : []
  const disabled = () => errorResult('物理删除未启用：请在设置中开启 "physicalDelete" 后再试', 'disabled')
  try {
    switch (method) {
      case 'list': {
        return okResult(await listSummaries(ctx, scope))
      }
      case 'deleted': {
        return okResult(await listDeleted(ctx, scope))
      }
      case 'capabilities': {
        return okResult({
          physicalDelete: options.physicalDelete,
          trashDir: resolveTrashDir(options),
        })
      }
      case 'unarchive': {
        const sessionIds = ids(body.sessionIds)
        if (sessionIds.length === 0) return errorResult('unarchive requires sessionIds')
        await unarchiveSessions(ctx, sessionIds)
        return okResult({ unarchivedIds: sessionIds })
      }
      case 'delete': {
        const sessionIds = ids(body.sessionIds)
        if (sessionIds.length === 0) return errorResult('delete requires sessionIds')
        const deletedIds = await deleteSessions(scope, sessionIds)
        return okResult({ deletedIds })
      }
      case 'restoreDeleted': {
        const sessionIds = ids(body.sessionIds)
        if (sessionIds.length === 0) return errorResult('restoreDeleted requires sessionIds')
        const restoredIds = await restoreDeleted(scope, sessionIds)
        return okResult({ restoredIds })
      }
      case 'deletePhysical': {
        if (!options.physicalDelete) return disabled()
        const sessionIds = ids(body.sessionIds)
        if (sessionIds.length === 0) return errorResult('deletePhysical requires sessionIds')
        const result = await physicalDeleteSessions(ctx, scope, sessionIds, options)
        return okResult(result)
      }
      case 'restorePhysical': {
        if (!options.physicalDelete) return disabled()
        const sessionIds = ids(body.sessionIds)
        if (sessionIds.length === 0) return errorResult('restorePhysical requires sessionIds')
        const restoredIds = await restorePhysicalSessions(ctx, scope, sessionIds)
        return okResult({ restoredIds })
      }
      case 'destroyPhysical': {
        if (!options.physicalDelete) return disabled()
        const sessionIds = ids(body.sessionIds)
        if (sessionIds.length === 0) return errorResult('destroyPhysical requires sessionIds')
        const destroyedIds = await destroyPhysicalSessions(ctx, scope, sessionIds)
        return okResult({ destroyedIds })
      }
      case 'permanentPurge': {
        const sessionIds = ids(body.sessionIds)
        if (sessionIds.length === 0) return errorResult('permanentPurge requires sessionIds')
        const result = await permanentPurgeSessions(ctx, scope, sessionIds)
        return okResult(result)
      }
      default:
        return errorResult(`unknown method '${method}'`, 'method-not-found')
    }
  } catch (error) {
    console.error('[dsh-archive-manager] RPC error in ' + method + ':', error);
    return errorResult(error instanceof Error ? error.message : String(error), 'internal');
  }
}

export { RPC_CHANNEL }
