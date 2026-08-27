/**
 * dsh-market server plugin for DeepSeek Harness.
 *
 * Provides RPC services to:
 * 1. Fetch community & Monorepo plugin catalog (with a short cache and mirror support).
 * 2. Detect updates for the monorepo plugins by comparing the running profile's
 *    installed versions against the latest GitHub Releases.
 * 3. Read/write the market's own settings namespace (repo origin, catalog URL,
 *    auto-check, mirror).
 *
 * The RPC channel is registered on the connection service with the `loopback`
 * authority, so only the same host's own web UI can drive it — matching the
 * convention used by dsh-remote-control's configuration channel.
 */

import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_REPO_ORIGIN,
  DEFAULT_COMMUNITY_CATALOG_URL,
  LOCAL_MONOREPO_PLUGINS,
  formatMonorepoReleases,
  resolveRepoCatalog,
  mergeInstalledVersions,
  readInstalledList,
  checkPluginUpdates,
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

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'dsh-market-plugin', 'Accept': 'application/vnd.github.v3+json' },
    signal: AbortSignal.timeout(8000),
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

/**
 * Fetch community catalog (normalized to an array).
 */
export async function fetchCommunityCatalog(url) {
  try {
    const data = await fetchJson(url)
    if (Array.isArray(data)) return data
    if (data && Array.isArray(data.plugins)) return data.plugins
    return []
  } catch {
    return []
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
export async function handleMarketRpc(ctx, options, method, payload = {}) {
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
      const plugins = await fetchCommunityCatalog(resolved.communityCatalogUrl)
      return {
        ok: true,
        value: { plugins, catalogUrl: resolved.communityCatalogUrl, count: plugins.length },
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
      const fresh = typeof options === 'function' ? options() : { ...opt, ...payload }
      return { ok: true, value: resolveOptions(fresh) }
    }

    return errorResult(`Unknown market RPC method: ${method}`)
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err), 'internal')
  }
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
