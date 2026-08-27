/**
 * dsh-market server plugin for DeepSeek Harness.
 *
 * Provides RPC services to:
 * 1. Fetch community & Monorepo plugin catalog (with a short cache and mirror support).
 * 2. Detect updates for the monorepo plugins by comparing the running profile's
 *    installed versions against the latest GitHub Releases.
 * 3. One-click install/update: runs `dsh plugin add` on the host for sources
 *    validated against the catalogs (repo release URLs / community npm names).
 *    Only one install task runs at a time; the web UI polls task status.
 * 4. Read/write the market's own settings namespace (repo origin, catalog URL,
 *    auto-check, mirror).
 *
 * The RPC channel is registered on the connection service with the `loopback`
 * authority, so only the same host's own web UI can drive it — matching the
 * convention used by dsh-remote-control's configuration channel.
 */

import z from '@deepseek-ai/schemastery'
import { spawn } from 'node:child_process'
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

export const name = 'market'
export const inject = ['settings']
export const NS = 'market'
export const MARKET_RPC_CHANNEL = '/dsh-market-rpc'

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
 * In-memory cache for GitHub releases (rate-limit friendly: the anonymous
 * GitHub API is capped at ~60 requests/hour per IP).
 */
let cachedReleases = null
let lastReleasesFetchTime = 0
const CACHE_TTL_MS = 60 * 1000

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
    // Network/rate-limit failures degrade to the last successful snapshot.
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
      // Persist through the settings service when available (loopback UI).
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
 * One-click install / update
 * ------------------------------------------------------------------ */

const installTasks = new Map()
let activeTaskId = null

/** Spawn the DSH CLI (`dsh plugin add --profile <profile> <source>`). */
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
    // Only entries that declare an npm package are installable; never fall
    // back to the plugin name, which may not exist on npm.
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
    return errorResult(`已有安装任务正在进行（${active?.name || activeTaskId}），请等待其完成`)
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
        task.log.push(`✓ ${name} 安装成功（${kind === 'repo' ? '仓库版本' : 'npm 包'}）`)
      } else {
        task.status = 'error'
        task.error = (result.stderr || result.stdout || '安装失败').split('\n').filter(Boolean).slice(-3).join(' ')
        task.log.push(`✗ 安装失败（exit code ${result.code ?? 'n/a'}）`)
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

export function apply(ctx, config) {
  let current = () => config ?? {}
  const scope = ctx.settings.register(NS, Config, { base: config ?? {} })
  current = () => scope.get()
  const options = () => resolveOptions(current())

  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.connection.rpc.handle(
      MARKET_RPC_CHANNEL,
      (method, payload) => handleMarketRpc(connectionCtx, options, method, payload),
      { authority: 'loopback' },
    )
  })
}
