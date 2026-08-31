/**
 * dsh-market server plugin for DeepSeek Harness.
 *
 * Provides RPC services to:
 * 1. Fetch community & Monorepo plugin catalog (with a short cache and proxy/mirror support).
 * 2. Detect updates for the monorepo plugins by comparing the running profile's
 *    installed versions against the latest GitHub Releases.
 * 3. One-click install/update & Batch update: runs `dsh plugin add` on the host for sources
 *    validated against the catalogs (repo release URLs / community npm names).
 *    Only one task runs at a time; the web UI polls task status with streaming log.
 * 4. One-click remove: runs `dsh plugin remove` on the host.
 * 5. Async host restart: triggers graceful daemon restart in the background,
 *    allowing the web client to smoothly probe, reconnect and auto-reload.
 * 6. Read/write the market's own settings namespace (repo origin, catalog URL,
 *    auto-check, mirror).
 *
 * The RPC channel is registered on the connection service with the `trusted-host`
 * authority, allowing access from localhost and LAN clients configured under
 * connection.trustedHosts (matching dsh-model-roles / dsh-remote-control).
 */

import z from '@deepseek-ai/schemastery'
import { existsSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { EnvHttpProxyAgent, fetch as undiciFetch } from 'undici'
import {
  DEFAULT_REPO_ORIGIN,
  DEFAULT_COMMUNITY_CATALOG_URL,
  LOCAL_MONOREPO_PLUGINS,
  formatMonorepoReleases,
  resolveRepoCatalog,
  mergeInstalledVersions,
  readInstalledList,
  checkPluginUpdates,
  normalizeCommunityPlugins,
  communityCategories,
  safeProfileName,
  safePackageName,
  isAllowedRepoUrl,
  findProfileName,
} from './core.js'

export const name = 'plugin-manager'
export const inject = ['settings']
export const NS = 'plugin-manager'
export const MARKET_RPC_CHANNEL = '/dsh-plugin-manager-rpc'

export const Config = z.object({
  repoOrigin: z.string().default(DEFAULT_REPO_ORIGIN),
  communityCatalogUrl: z.string().default(DEFAULT_COMMUNITY_CATALOG_URL),
  autoCheckUpdates: z.boolean().default(true),
  mirrorUrl: z.string().default(''),
})

export function resolveOptions(raw = {}) {
  return {
    repoOrigin: typeof raw.repoOrigin === 'string' && raw.repoOrigin ? raw.repoOrigin : DEFAULT_REPO_ORIGIN,
    communityCatalogUrl: typeof raw.communityCatalogUrl === 'string' && raw.communityCatalogUrl ? raw.communityCatalogUrl : DEFAULT_COMMUNITY_CATALOG_URL,
    autoCheckUpdates: typeof raw.autoCheckUpdates === 'boolean' ? raw.autoCheckUpdates : true,
    mirrorUrl: typeof raw.mirrorUrl === 'string' ? raw.mirrorUrl : '',
  }
}

function errorResult(message, code = 'bad-request') {
  return {
    ok: false,
    error: {
      code,
      message,
      details: code === 'bad-request' ? { issues: [{ code: 'custom', path: [], message }] } : {},
    },
  }
}

/**
 * HTTP fetch with proxy support.
 *
 * Node's global fetch ignores http_proxy/https_proxy environment variables.
 * This host (like many LAN deployments) reaches the internet through a proxy,
 * so the market routes every outbound request through undici's
 * EnvHttpProxyAgent, which honors HTTP_PROXY / HTTPS_PROXY / NO_PROXY and
 * falls back to direct connections when no proxy is configured.
 */
const proxyAgent = new EnvHttpProxyAgent()
const defaultHttpFetch = (url, init = {}) => undiciFetch(url, { ...init, dispatcher: proxyAgent })
let httpFetch = defaultHttpFetch

/** Test hook: replace the underlying fetch implementation. */
export function _setHttpFetch(fn) {
  httpFetch = fn
}

/** Test hook: restore the default proxy-aware fetch. */
export function _resetHttpFetch() {
  httpFetch = defaultHttpFetch
}

async function fetchJson(url) {
  const res = await httpFetch(url, {
    headers: { 'User-Agent': 'dsh-market-plugin', 'Accept': 'application/vnd.github.v3+json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/**
 * In-memory cache for GitHub releases (rate-limit friendly: the anonymous
 * GitHub API is capped at ~60 requests/hour per IP).
 */
let cachedReleases = null
let lastReleasesFetchTime = 0
const CACHE_TTL_MS = 60 * 1000

/**
 * Fetch GitHub releases for repo (with cache fallback on network errors).
 */
export async function fetchGitHubReleases(repoOrigin) {
  const now = Date.now()
  if (cachedReleases && now - lastReleasesFetchTime < CACHE_TTL_MS) return cachedReleases

  const cleanRepo = repoOrigin.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
  const apiUrl = `https://api.github.com/repos/${cleanRepo}/releases?per_page=100`

  try {
    const data = await fetchJson(apiUrl)
    if (!Array.isArray(data)) return cachedReleases || []
    cachedReleases = data
    lastReleasesFetchTime = now
    return data
  } catch (err) {
    return cachedReleases || []
  }
}

let cachedCommunity = null
let lastCommunityFetchTime = 0

/** Reset in-memory caches (mainly for tests). */
export function resetMarketCaches() {
  cachedReleases = null
  lastReleasesFetchTime = 0
  cachedCommunity = null
  lastCommunityFetchTime = 0
}

/**
 * Fetch community catalog (normalized raw payload, cached).
 */
export async function fetchCommunityCatalog(url) {
  const now = Date.now()
  if (cachedCommunity && now - lastCommunityFetchTime < CACHE_TTL_MS) return cachedCommunity
  try {
    const data = await fetchJson(url)
    cachedCommunity = data
    lastCommunityFetchTime = now
    return data
  } catch {
    return cachedCommunity || { plugins: [], categories: {} }
  }
}

function applyMirror(plugins, mirrorUrl) {
  if (!mirrorUrl) return plugins
  return plugins.map((p) => ({
    ...p,
    downloadUrl: String(p.downloadUrl || '').replace('https://github.com/', mirrorUrl) || p.downloadUrl,
  }))
}

const CONFIG_KEYS = {
  repoOrigin: (v) => typeof v === 'string' && v !== '',
  communityCatalogUrl: (v) => typeof v === 'string' && v !== '',
  autoCheckUpdates: (v) => typeof v === 'boolean',
  mirrorUrl: (v) => typeof v === 'string',
}

/**
 * Handle Market RPC calls from the web UI.
 */
export async function handleMarketRpc(ctx, options, method, payload = {}, deps = {}) {
  const opt = typeof options === 'function' ? options() : options
  const resolved = resolveOptions(opt)

  try {
    if (method === 'getRepoPlugins') {
      const ghReleases = await fetchGitHubReleases(resolved.repoOrigin)
      const releaseMap = formatMonorepoReleases(ghReleases, resolved.repoOrigin)
      let catalog = resolveRepoCatalog(releaseMap, resolved.repoOrigin)
      catalog = applyMirror(catalog, resolved.mirrorUrl)
      const merged = mergeInstalledVersions(catalog)
      return {
        ok: true,
        value: {
          plugins: merged.plugins,
          repoOrigin: resolved.repoOrigin,
          profile: merged.profile,
          checkedAt: merged.checkedAt,
        },
      }
    }

    if (method === 'getCommunityPlugins') {
      const raw = await fetchCommunityCatalog(resolved.communityCatalogUrl)
      const plugins = normalizeCommunityPlugins(raw, 'zh')
      const categories = communityCategories(raw)
      return {
        ok: true,
        value: {
          plugins,
          categories,
          catalogUrl: resolved.communityCatalogUrl,
          count: plugins.length,
          updated: raw?.updated || '',
        },
      }
    }

    if (method === 'checkUpdates') {
      const ghReleases = await fetchGitHubReleases(resolved.repoOrigin)
      const releaseMap = formatMonorepoReleases(ghReleases, resolved.repoOrigin)
      let repoCatalog = resolveRepoCatalog(releaseMap, resolved.repoOrigin)
      repoCatalog = applyMirror(repoCatalog, resolved.mirrorUrl)
      const pluginNames = LOCAL_MONOREPO_PLUGINS.map((p) => p.name)
      const installed = readInstalledList(pluginNames)
      const results = checkPluginUpdates(installed, repoCatalog)
      return { ok: true, value: { results, profile: findProfileName() } }
    }

    if (method === 'getConfig') {
      return { ok: true, value: resolved }
    }

    if (method === 'updateConfig') {
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        return errorResult('Market configuration requests must carry an object')
      }
      const entries = Object.entries(payload).filter(([key]) => Object.hasOwn(CONFIG_KEYS, key))
      if (entries.length === 0) return errorResult('No valid configuration keys provided')
      for (const [key, value] of entries) {
        if (!CONFIG_KEYS[key](value)) return errorResult(`Invalid value for configuration key: ${key}`)
      }
      if (ctx && ctx.settings && typeof ctx.settings.mutate === 'function') {
        await ctx.settings.mutate(NS, entries.map(([key, value]) => ({ op: 'set', path: [key], value })))
      }
      if (Object.hasOwn(payload, 'repoOrigin')) {
        cachedReleases = null
        lastReleasesFetchTime = 0
      }
      if (Object.hasOwn(payload, 'communityCatalogUrl')) {
        cachedCommunity = null
        lastCommunityFetchTime = 0
      }
      const fresh = typeof options === 'function' ? options() : { ...opt, ...payload }
      return { ok: true, value: resolveOptions(fresh) }
    }

    if (method === 'installPlugin') {
      return handleInstallPlugin(options, payload, deps)
    }

    if (method === 'batchUpdatePlugins') {
      return handleBatchUpdatePlugins(options, payload, deps)
    }

    if (method === 'removePlugin') {
      return handleRemovePlugin(options, payload, deps)
    }

    if (method === 'restartHost') {
      return handleRestartHost(options, payload, deps)
    }

    if (method === 'getInstallTask') {
      if (payload === null || typeof payload !== 'object' || typeof payload.taskId !== 'string') {
        return errorResult('getInstallTask requests require a taskId string')
      }
      const task = installTasks.get(payload.taskId)
      if (!task) return errorResult('Install task not found: ' + payload.taskId)
      return { ok: true, value: { ...task, log: [...task.log] } }
    }

    return errorResult(`Unknown market RPC method: ${method}`)
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err), 'internal')
  }
}

/* ------------------------------------------------------------------ *
 * Execution tasks (Install / Batch Update / Remove / Async Restart)
 * ------------------------------------------------------------------ */

const installTasks = new Map()
let activeTaskId = null
const TASK_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/** Prune finished tasks older than TTL (called lazily on each new task). */
function pruneInstallTasks() {
  const cutoff = Date.now() - TASK_TTL_MS
  for (const [id, task] of installTasks) {
    if (task.finishedAt && new Date(task.finishedAt).getTime() < cutoff) {
      installTasks.delete(id)
    }
  }
}

/** Spawn the DSH CLI (`dsh plugin add/remove`). */
export function runDshPluginCommand(args, { onLog, timeoutMs = 600_000, spawnFn = spawn } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawnFn('dsh', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      })
    } catch (err) {
      resolve({ ok: false, code: null, stdout: '', stderr: String(err && err.message ? err.message : err) })
      return
    }
    let stdout = ''
    let stderr = ''
    const push = (text) => {
      if (text && onLog) onLog(text)
    }
    if (child.stdout) child.stdout.on('data', (d) => { const s = d.toString(); stdout += s; push(s) })
    if (child.stderr) child.stderr.on('data', (d) => { const s = d.toString(); stderr += s; push(s) })
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* already gone */ }
    }, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, code: null, stdout, stderr: stderr + String(err.message || err) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, code, stdout, stderr })
    })
  })
}

/**
 * Resolve and validate the install source for a plugin.
 * Returns { source, kind } or { error }.
 */
async function resolveInstallSource(name, kind, resolved) {
  if (kind === 'repo') {
    const ghReleases = await fetchGitHubReleases(resolved.repoOrigin)
    const releaseMap = formatMonorepoReleases(ghReleases, resolved.repoOrigin)
    const catalog = resolveRepoCatalog(releaseMap, resolved.repoOrigin)
    const plugin = catalog.find((p) => p.name === name)
    if (!plugin) return { error: `仓库中不存在插件: ${name}` }
    if (!isAllowedRepoUrl(plugin.downloadUrl, resolved.repoOrigin)) {
      return { error: `拒绝安装：来源不在白名单内（${plugin.downloadUrl}）` }
    }
    return { source: plugin.downloadUrl, kind: 'repo' }
  }
  if (kind === 'community') {
    const raw = await fetchCommunityCatalog(resolved.communityCatalogUrl)
    const catalog = normalizeCommunityPlugins(raw)
    const entry = catalog.find((p) => p.name === name)
    const pkg = safePackageName(entry && entry.npm)
    if (!entry || !pkg) return { error: `社区目录中不存在可安装的插件: ${name}` }
    return { source: pkg, kind: 'community' }
  }
  return { error: `未知插件来源: ${kind}` }
}

export function handleInstallPlugin(options, payload, deps = {}) {
  const opt = typeof options === 'function' ? options() : options
  const resolved = resolveOptions(opt)

  if (payload === null || typeof payload !== 'object') return errorResult('installPlugin requests must carry an object')
  const name = typeof payload.name === 'string' ? payload.name.trim() : ''
  const kind = payload.kind === 'repo' || payload.kind === 'community' ? payload.kind : ''
  if (!name || !kind) return errorResult('installPlugin requires name and kind (repo|community)')

  if (activeTaskId) {
    const active = installTasks.get(activeTaskId)
    return errorResult(`已有任务正在进行（${active?.name || activeTaskId}），请等待其完成`)
  }

  const profile = safeProfileName(findProfileName())
  if (!profile) return errorResult('无法解析当前 profile 名称，已拒绝安装')

  const taskId = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const task = {
    id: taskId,
    name,
    kind,
    profile,
    status: 'running',
    log: [],
    code: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  }
  pruneInstallTasks()
  installTasks.set(taskId, task)
  activeTaskId = taskId

  void (async () => {
    try {
      const { source, error } = await resolveInstallSource(name, kind, resolved)
      if (error) throw new Error(error)
      task.source = source
      task.log.push(`$ dsh plugin add --profile ${profile} ${source}`)
      const result = await runDshPluginCommand(['plugin', 'add', '--profile', profile, source], {
        onLog: (line) => { task.log.push(line.replace(/\s+$/, '')) },
        spawnFn: deps.spawnFn,
      })
      task.code = result.code
      if (result.ok) {
        task.status = 'success'
        task.log.push(`✓ ${name} 安装/更新完成`)
      } else {
        task.status = 'error'
        task.error = (result.stderr || result.stdout || '操作失败').split('\n').filter(Boolean).slice(-3).join(' ')
        task.log.push(`✗ 操作失败（exit code ${result.code ?? 'n/a'}）`)
      }
    } catch (err) {
      task.status = 'error'
      task.error = err instanceof Error ? err.message : String(err)
      task.log.push(`✗ ${task.error}`)
    } finally {
      task.finishedAt = new Date().toISOString()
      activeTaskId = null
    }
  })()

  return { ok: true, value: { taskId, name, kind } }
}

export function handleBatchUpdatePlugins(options, payload, deps = {}) {
  const opt = typeof options === 'function' ? options() : options
  const resolved = resolveOptions(opt)

  if (payload === null || typeof payload !== 'object') return errorResult('batchUpdatePlugins requests must carry an object')
  const kind = payload.kind === 'repo' || payload.kind === 'community' ? payload.kind : ''
  if (!kind) return errorResult('batchUpdatePlugins requires kind (repo|community)')

  if (activeTaskId) {
    const active = installTasks.get(activeTaskId)
    return errorResult(`已有任务正在进行（${active?.name || activeTaskId}），请等待其完成`)
  }

  const profile = safeProfileName(findProfileName())
  if (!profile) return errorResult('无法解析当前 profile 名称，已拒绝更新')

  const taskId = `task-batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const task = {
    id: taskId,
    name: kind === 'repo' ? '一键更新全部自有插件' : '一键更新全部社区插件',
    kind: 'batch-update',
    profile,
    status: 'running',
    log: [],
    code: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  }
  pruneInstallTasks()
  installTasks.set(taskId, task)
  activeTaskId = taskId

  void (async () => {
    let successCount = 0
    let failureCount = 0
    try {
      let targets = []
      if (kind === 'repo') {
        const ghReleases = await fetchGitHubReleases(resolved.repoOrigin)
        const releaseMap = formatMonorepoReleases(ghReleases, resolved.repoOrigin)
        const catalog = resolveRepoCatalog(releaseMap, resolved.repoOrigin)
        const merged = mergeInstalledVersions(catalog)
        targets = merged.plugins.filter((p) => p.installedVersion && p.hasUpdate)
      } else {
        const raw = await fetchCommunityCatalog(resolved.communityCatalogUrl)
        const plugins = normalizeCommunityPlugins(raw, 'zh')
        targets = plugins.filter((p) => p.installedVersion && p.hasUpdate && p.npm)
      }

      if (targets.length === 0) {
        task.status = 'success'
        task.log.push('✓ 所有插件均已是最新版本，无需更新')
        return
      }

      task.log.push(`🚀 开始批量更新 ${targets.length} 款插件...`)

      for (let i = 0; i < targets.length; i++) {
        const p = targets[i]
        task.log.push(`[${i + 1}/${targets.length}] 正在更新 ${p.name} (v${p.installedVersion} → v${p.version || p.latestVersion})...`)
        const { source, error } = await resolveInstallSource(p.name, kind, resolved)
        if (error) {
          task.log.push(`✗ ${p.name} 解析失败: ${error}`)
          failureCount++
          continue
        }
        const result = await runDshPluginCommand(['plugin', 'add', '--profile', profile, source], {
          onLog: (line) => { task.log.push(`  ${line.replace(/\s+$/, '')}`) },
          spawnFn: deps.spawnFn,
        })
        if (result.ok) {
          task.log.push(`✓ [${i + 1}/${targets.length}] ${p.name} 更新成功`)
          successCount++
        } else {
          const reason = (result.stderr || result.stdout || '未知错误').split('\n').filter(Boolean).slice(-2).join(' | ')
          task.log.push(`✗ [${i + 1}/${targets.length}] ${p.name} 更新失败: ${reason}`)
          failureCount++
        }
      }

      if (failureCount === 0) {
        task.status = 'success'
        task.log.push(`\n🎉 批量更新完成！成功 ${successCount} 款。`)
      } else {
        task.status = 'error'
        task.error = `批量更新完成：成功 ${successCount} 款，失败 ${failureCount} 款`
        task.log.push(`\n⚠️ ${task.error}`)
      }
    } catch (err) {
      task.status = 'error'
      task.error = err instanceof Error ? err.message : String(err)
      task.log.push(`✗ 批量更新异常: ${task.error}`)
    } finally {
      task.finishedAt = new Date().toISOString()
      activeTaskId = null
    }
  })()

  return { ok: true, value: { taskId, name: task.name, kind: 'batch-update' } }
}

export function handleRemovePlugin(options, payload, deps = {}) {
  if (payload === null || typeof payload !== 'object') return errorResult('removePlugin requests must carry an object')
  const rawName = typeof payload.name === 'string' ? payload.name.trim() : ''
  const name = safePackageName(rawName)
  if (!name) return errorResult('removePlugin requires a valid package name')

  if (activeTaskId) {
    const active = installTasks.get(activeTaskId)
    return errorResult(`已有任务正在进行（${active?.name || activeTaskId}），请等待其完成`)
  }

  const profile = safeProfileName(findProfileName())
  if (!profile) return errorResult('无法解析当前 profile 名称，已拒绝卸载')

  const taskId = `task-rm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const task = {
    id: taskId,
    name,
    kind: 'remove',
    profile,
    status: 'running',
    log: [],
    code: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  }
  pruneInstallTasks()
  installTasks.set(taskId, task)
  activeTaskId = taskId

  void (async () => {
    try {
      task.log.push(`$ dsh plugin remove --profile ${profile} ${name}`)
      const result = await runDshPluginCommand(['plugin', 'remove', '--profile', profile, name], {
        onLog: (line) => { task.log.push(line.replace(/\s+$/, '')) },
        spawnFn: deps.spawnFn,
      })
      task.code = result.code
      if (result.ok) {
        task.status = 'success'
        task.log.push(`✓ ${name} 卸载成功`)
      } else {
        task.status = 'error'
        task.error = (result.stderr || result.stdout || '卸载失败').split('\n').filter(Boolean).slice(-3).join(' ')
        task.log.push(`✗ 卸载失败（exit code ${result.code ?? 'n/a'}）`)
      }
    } catch (err) {
      task.status = 'error'
      task.error = err instanceof Error ? err.message : String(err)
      task.log.push(`✗ ${task.error}`)
    } finally {
      task.finishedAt = new Date().toISOString()
      activeTaskId = null
    }
  })()

  return { ok: true, value: { taskId, name, kind: 'remove' } }
}

/**
 * Handle async graceful restart of the host process.
 *
 * The service name is resolved in this order:
 *   1. payload.serviceName  (validated against an allowlist of systemd unit names)
 *   2. DSH_WEB_SERVICE env var
 *   3. 'dsh-web' (default unit used by the repo's systemd template)
 *
 * Restart strategy (safe by construction):
 *   - systemd (linux): schedule a detached `systemd-run --no-block` transient
 *     scope that executes `systemctl restart <unit>` AFTER a short delay. The
 *     transient scope lives OUTSIDE the service's own cgroup, so the restart
 *     command cannot be killed together with this service (the naive
 *     `spawn('sh', ['-c', 'sleep && systemctl restart ...'])` runs inside the
 *     service cgroup and gets SIGTERM'd by systemd before it can act).
 *     The unit existence is verified synchronously via spawnSync; if systemd
 *     or the unit is unavailable, restart is REFUSED with a clear error —
 *     never a silent process.exit(0) (which would not trigger Restart= and
 *     would leave the service dead).
 *   - win32: detached cmd.exe invoking the repo's dsh-web.cmd with an
 *     absolute repo path resolved from DSH_PLUGINS_REPO (fallback: cwd).
 *   - other: refused with a clear error (no supervisor contract to rely on).
 */
export function handleRestartHost(options, payload = {}, deps = {}) {
  const spawnFn = deps.spawnFn || spawn
  const spawnSyncFn = deps.spawnSyncFn || spawnSync

  const SYSTEMD_SERVICE_RE = /^[a-zA-Z0-9_.:-]+$/
  const serviceName = (
    (typeof payload?.serviceName === 'string' && SYSTEMD_SERVICE_RE.test(payload.serviceName) && payload.serviceName)
    || (typeof process.env.DSH_WEB_SERVICE === 'string' && SYSTEMD_SERVICE_RE.test(process.env.DSH_WEB_SERVICE) && process.env.DSH_WEB_SERVICE)
    || 'dsh-web'
  )

  const unavailable = (message) => ({
    ok: false,
    error: {
      code: 'restart-unavailable',
      message,
      details: { serviceName, platform: process.platform },
    },
  })

  if (process.platform === 'linux') {
    // 1. Verify systemd is running and the unit exists (sync probe).
    let probe
    try {
      probe = spawnSyncFn('systemctl', ['status', serviceName], { stdio: 'ignore' })
    } catch (err) {
      return unavailable(`无法调用 systemctl（${err instanceof Error ? err.message : String(err)}），请手动执行 systemctl restart ${serviceName}`)
    }
    if (probe.error) {
      return unavailable(`systemctl 不可用（${probe.error.message}），请手动执行 systemctl restart ${serviceName}`)
    }
    if (probe.status === 4) {
      return unavailable(`systemd 单元 ${serviceName} 不存在。请检查服务名（DSH_WEB_SERVICE 或 payload.serviceName）`)
    }

    // 2. Schedule a detached transient scope that survives our cgroup teardown.
    try {
      const child = spawnFn('systemd-run', [
        '--no-block',
        '--unit=dsh-plugin-manager-restart',
        '/bin/sh', '-c', `sleep 0.8 && systemctl restart ${serviceName}`,
      ], {
        detached: true,
        stdio: 'ignore',
      })
      if (child.unref) child.unref()
      return {
        ok: true,
        value: {
          scheduled: true,
          method: 'systemd',
          serviceName,
          message: `已调度异步重启 ${serviceName}（systemd 瞬态作用域），正在重启 DeepSeek Harness 服务...`,
        },
      }
    } catch (err) {
      return unavailable(`无法调度 systemd-run（${err instanceof Error ? err.message : String(err)}），请手动执行 systemctl restart ${serviceName}`)
    }
  }

  if (process.platform === 'win32') {
    try {
      const repoDir = process.env.DSH_PLUGINS_REPO || process.cwd()
      const script = `${repoDir.replace(/\\/g, '/')}/scripts/dsh-web.cmd`
      const child = spawnFn('cmd.exe', ['/c', `timeout /t 1 /nobreak >nul && "${script}" restart`], {
        detached: true,
        stdio: 'ignore',
      })
      if (child.unref) child.unref()
      return {
        ok: true,
        value: {
          scheduled: true,
          method: 'windows-cmd',
          serviceName,
          message: '已调度异步重启 dsh web 服务（Windows 脚本），正在重启 DeepSeek Harness 服务...',
        },
      }
    } catch (err) {
      return unavailable(`无法调度 Windows 重启（${err instanceof Error ? err.message : String(err)}）。请手动执行 scripts\\dsh-web.cmd restart`)
    }
  }

  return unavailable('当前环境不支持平滑重启（无法识别 systemd / Windows 服务管理）。请手动重启 DeepSeek Harness 服务。')
}

export function apply(ctx, config) {
  let current = () => config ?? {}
  const scope = ctx.settings.register(NS, Config, { base: config ?? {} })
  current = () => scope.get()
  const options = () => resolveOptions(current())

  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.connection.rpc.handle(
      MARKET_RPC_CHANNEL,
      (method, payload) => handleMarketRpc(connectionCtx, options, method, payload),
      { authority: 'trusted-host' },
    )
  })
}
