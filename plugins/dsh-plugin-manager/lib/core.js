/**
 * Core engine for dsh-market (DeepSeek Harness Community Plugin Market & Repo Manager)
 *
 * Provides:
 * - Semantic version comparison and update detection
 * - Monorepo GitHub Release tag parser (<plugin>@v<version> or v<version>)
 * - Community & Repo catalog fetching and normalization
 * - Local profile plugin inspection (installed versions) and update-state merge
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_REPO_ORIGIN = 'veildawn/dsh-plugins'
export const DEFAULT_COMMUNITY_CATALOG_URL = 'https://awesome-dsh-plugin.com/plugins.json'

/**
 * Compare two semver strings (e.g. "0.4.8" vs "0.4.7", "v1.2.0" vs "1.1.9")
 * Returns:
 *   1 if a > b
 *  -1 if a < b
 *   0 if a === b
 */
export function compareVersions(a, b) {
  const parse = (v) => {
    if (!v || typeof v !== 'string') return [0, 0, 0]
    const clean = v.replace(/^[^\d]*/, '').split('-')[0]
    return clean.split('.').map((n) => parseInt(n, 10) || 0)
  }
  const [a1 = 0, a2 = 0, a3 = 0] = parse(a)
  const [b1 = 0, b2 = 0, b3 = 0] = parse(b)

  if (a1 !== b1) return a1 > b1 ? 1 : -1
  if (a2 !== b2) return a2 > b2 ? 1 : -1
  if (a3 !== b3) return a3 > b3 ? 1 : -1
  return 0
}

/**
 * Determine if targetVersion is an upgrade compared to currentVersion
 */
export function isUpgrade(currentVersion, targetVersion) {
  return compareVersions(targetVersion, currentVersion) > 0
}

/**
 * Parse release tag to extract plugin name and version
 * Supports formats:
 * - "dsh-model-roles@v0.4.7" -> { name: "dsh-model-roles", version: "0.4.7" }
 * - "dsh-file-viewer@0.1.8"  -> { name: "dsh-file-viewer", version: "0.1.8" }
 * - "v1.0.0"                 -> { name: null, version: "1.0.0" }
 */
export function parseReleaseTag(tag) {
  if (!tag || typeof tag !== 'string') return null
  const atIdx = tag.indexOf('@')
  if (atIdx !== -1) {
    const name = tag.slice(0, atIdx).trim()
    const verPart = tag.slice(atIdx + 1).trim()
    const version = verPart.replace(/^v/, '')
    return { name, version, tag }
  }
  const match = tag.match(/^(?:v)?(\d+\.\d+\.\d+(?:-[\w.]+)?)$/)
  if (match) {
    return { name: null, version: match[1], tag }
  }
  return { name: null, version: tag.replace(/^v/, ''), tag }
}

/**
 * Build standard Monorepo Release download URL
 */
export function buildReleaseDownloadUrl(repo, pluginName, version) {
  const cleanRepo = repo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
  const tag = `${pluginName}@v${version}`
  const fileName = `${pluginName}-${version}.tgz`
  return `https://github.com/${cleanRepo}/releases/download/${tag}/${fileName}`
}

/**
 * Static metadata definition for plugins hosted directly in this monorepo
 */
export const LOCAL_MONOREPO_PLUGINS = [
  {
    id: 'dsh-plugin-manager',
    name: 'dsh-plugin-manager',
    title: '插件管理',
    description: 'DSH 插件管理与更新中心，支持自有插件更新/卸载/一键批量更新，浏览 2200+ 社区插件并一键安装。',
    author: 'veildawn',
    category: 'tools',
    tags: ['plugin-manager', 'manager', 'updater', 'tools'],
    icon: 'puzzle',
    repo: 'veildawn/dsh-plugins',
    path: 'plugins/dsh-plugin-manager',
    isRepoPlugin: true,
  },
  {
    id: 'dsh-model-roles',
    name: 'dsh-model-roles',
    title: '模型角色分工与路由',
    description: 'OMP 风格的多模型智能分工与角色路由，支持计划模式、识图子代理分析与顾问复核 (/advisor)。',
    author: 'veildawn',
    category: 'ai',
    tags: ['model-roles', 'routing', 'omp', 'vision', 'advisor'],
    icon: 'branch',
    repo: 'veildawn/dsh-plugins',
    path: 'plugins/dsh-model-roles',
    isRepoPlugin: true,
  },
  {
    id: 'dsh-remote-control',
    name: 'dsh-remote-control',
    title: '远程访问与安全通道',
    description: 'Token 密钥认证、密码锁屏门禁 Unlock Screen、特权 RPC 白名单桥接与局域网无感放行。',
    author: 'veildawn',
    category: 'security',
    tags: ['remote', 'security', 'token', 'lock-screen'],
    icon: 'globe',
    repo: 'veildawn/dsh-plugins',
    path: 'plugins/dsh-remote-control',
    isRepoPlugin: true,
  },
  {
    id: 'dsh-ai-proxy',
    name: 'dsh-ai-proxy',
    title: 'AI Proxy 网关与 Provider',
    description: 'AI Proxy Service 统一网关对接，支持 Chat/Anthropic/Responses 多协议智能适配与 OAuth 2.0 PKCE 认证。',
    author: 'veildawn',
    category: 'ai',
    tags: ['ai-proxy', 'llm', 'provider', 'gateway'],
    icon: 'cloud',
    repo: 'veildawn/dsh-plugins',
    path: 'plugins/dsh-ai-proxy',
    isRepoPlugin: true,
  },
  {
    id: 'dsh-mobile-adapter',
    name: 'dsh-mobile-adapter',
    title: '移动端全量体验优化',
    description: '原生图片上传、底部操作栏圆形统一规范、视口高度自适应、Segmented Control Tabs。',
    author: 'veildawn',
    category: 'ui',
    tags: ['mobile', 'ui', 'adapter', 'responsive'],
    icon: 'mobile',
    repo: 'veildawn/dsh-plugins',
    path: 'plugins/dsh-mobile-adapter',
    isRepoPlugin: true,
  },
  {
    id: 'dsh-file-viewer',
    name: 'dsh-file-viewer',
    title: '工作区文件查看器',
    description: '会话头部抽屉式文件浏览器，支持全屏切换、语法高亮、Markdown/JSON、图片、PDF、Excel、Word 预览。',
    author: 'veildawn',
    category: 'tools',
    tags: ['file-viewer', 'workspace', 'preview', 'editor'],
    icon: 'folder',
    repo: 'veildawn/dsh-plugins',
    path: 'plugins/dsh-file-viewer',
    isRepoPlugin: true,
  },
  {
    id: 'dsh-terminal',
    name: 'dsh-terminal',
    title: '跨平台交互式终端',
    description: '本地终端调用、移动端专属对话框底部工具箱二合一入口、多标签并发与触控辅助键盘。',
    author: 'veildawn',
    category: 'tools',
    tags: ['terminal', 'pty', 'shell', 'xterm', 'mobile'],
    icon: 'terminal',
    repo: 'veildawn/dsh-plugins',
    path: 'plugins/dsh-terminal',
    isRepoPlugin: true,
  },
]

/**
 * Filter and format releases from GitHub Releases API for monorepo
 */
export function formatMonorepoReleases(githubReleases, repoOrigin = DEFAULT_REPO_ORIGIN) {
  if (!Array.isArray(githubReleases)) return new Map()
  const releaseMap = new Map()

  for (const rel of githubReleases) {
    if (!rel || typeof rel !== 'object' || rel.draft || rel.prerelease) continue
    const parsed = parseReleaseTag(rel.tag_name)
    if (!parsed || !parsed.name) continue

    const existing = releaseMap.get(parsed.name)
    if (!existing || compareVersions(parsed.version, existing.version) > 0) {
      // Find asset
      const asset = (rel.assets || []).find((a) => a?.name?.endsWith('.tgz'))
      const downloadUrl = asset?.browser_download_url || buildReleaseDownloadUrl(repoOrigin, parsed.name, parsed.version)
      releaseMap.set(parsed.name, {
        name: parsed.name,
        version: parsed.version,
        tag: rel.tag_name,
        publishedAt: rel.published_at,
        releaseNotes: typeof rel.body === 'string' ? rel.body : '',
        downloadUrl,
      })
    }
  }

  return releaseMap
}

/**
 * Renamed / superseded plugin names that must never surface as standalone
 * entries in the repo catalog. They are historical names of plugins that are
 * now published under a new package name (e.g. dsh-market → dsh-plugin-manager).
 */
export const REPO_RENAMED_PLUGINS = Object.freeze({
  'dsh-market': 'dsh-plugin-manager',
})

/**
 * Merge local repo plugins metadata with live GitHub releases data.
 * Supports dynamically discovering newly added plugins in the repository
 * (either from new GitHub Releases or from workspace plugins/ subdirectories)
 * without requiring hardcoded updates to LOCAL_MONOREPO_PLUGINS.
 * Historical/renamed plugin names (REPO_RENAMED_PLUGINS) are excluded.
 */
export function resolveRepoCatalog(releasesMap = new Map(), repoOrigin = DEFAULT_REPO_ORIGIN) {
  const knownMap = new Map(LOCAL_MONOREPO_PLUGINS.map((p) => [p.name, { ...p }]))
  const results = []

  // 1. Process known base plugins
  for (const [name, plugin] of knownMap) {
    const releaseInfo = releasesMap.get(name)
    const latestVersion = releaseInfo?.version || '0.1.0'
    const downloadUrl = releaseInfo?.downloadUrl || buildReleaseDownloadUrl(repoOrigin, name, latestVersion)
    results.push({
      ...plugin,
      version: latestVersion,
      latestVersion,
      downloadUrl,
      releaseNotes: releaseInfo?.releaseNotes || '',
      publishedAt: releaseInfo?.publishedAt || null,
      updateAvailable: false,
    })
  }

  // 2. Dynamically discover any newly released plugins in the repo from releasesMap,
  //    skipping renamed/superseded historical names.
  for (const [name, releaseInfo] of releasesMap) {
    if (!knownMap.has(name) && name.startsWith('dsh-') && !Object.hasOwn(REPO_RENAMED_PLUGINS, name)) {
      const latestVersion = releaseInfo.version || '0.1.0'
      const downloadUrl = releaseInfo.downloadUrl || buildReleaseDownloadUrl(repoOrigin, name, latestVersion)
      results.push({
        id: name,
        name,
        title: name,
        description: releaseInfo.releaseNotes ? releaseInfo.releaseNotes.split('\n')[0].replace(/^#+\s*/, '') : '自有仓库新增插件',
        author: 'veildawn',
        category: 'tools',
        tags: ['repo', name],
        icon: 'puzzle',
        repo: repoOrigin,
        path: `plugins/${name}`,
        isRepoPlugin: true,
        version: latestVersion,
        latestVersion,
        downloadUrl,
        releaseNotes: releaseInfo.releaseNotes || '',
        publishedAt: releaseInfo.publishedAt || null,
        updateAvailable: false,
      })
    }
  }

  return results
}

/**
 * Read installed plugin versions from the running profile's node_modules
 */
export function findDshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function findProfileName() {
  const argv = process.argv
  const idx = argv.indexOf('--profile')
  if (idx !== -1 && idx + 1 < argv.length && !argv[idx + 1].startsWith('-')) {
    return argv[idx + 1]
  }
  return process.env.DSH_PROFILE || 'web'
}

export function profilePluginDir(home, profile) {
  return join(home, 'profiles', profile, 'node_modules')
}

/**
 * Read declared dependencies from the profile's package.json.
 * Returns Record<string, string> (e.g. { "dsh-file-viewer": "github:veildawn/dsh-plugins#path:/plugins/dsh-file-viewer" }).
 */
export function readProfileDependencies({ home = findDshHome(), profile = findProfileName() } = {}) {
  try {
    const manifestPath = join(home, 'profiles', profile, 'package.json')
    if (!existsSync(manifestPath)) return {}
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return (manifest && typeof manifest.dependencies === 'object' && manifest.dependencies) ? manifest.dependencies : {}
  } catch {
    return {}
  }
}

/**
 * Scan all installed packages in profile node_modules (including scoped @org/pkg).
 * Returns Map<packageName, version>.
 */
export function readAllInstalledPackages({ home = findDshHome(), profile = findProfileName() } = {}) {
  const map = new Map()
  const dir = profilePluginDir(home, profile)
  if (!existsSync(dir)) return map

  try {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      if (entry.startsWith('@')) {
        const scopeDir = join(dir, entry)
        if (statSync(scopeDir).isDirectory()) {
          for (const sub of readdirSync(scopeDir)) {
            const pkgPath = join(scopeDir, sub, 'package.json')
            if (existsSync(pkgPath)) {
              try {
                const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
                if (pkg.name && pkg.version) map.set(pkg.name, pkg.version)
              } catch {}
            }
          }
        }
      } else {
        const pkgPath = join(dir, entry, 'package.json')
        if (existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
            if (pkg.name && pkg.version) map.set(pkg.name, pkg.version)
          } catch {}
        }
      }
    }
  } catch {}

  return map
}

/**
 * Read installed version of a plugin from the profile manifest.
 * Returns null when the plugin is not installed in the profile (or unreadable).
 */
export function readInstalledVersion(pkgName, { home = findDshHome(), profile = findProfileName() } = {}) {
  try {
    const manifestPath = join(profilePluginDir(home, profile), pkgName, 'package.json')
    if (!existsSync(manifestPath)) return null
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return typeof manifest.version === 'string' && manifest.version ? manifest.version : null
  } catch {
    return null
  }
}

/**
 * Attach installed-version facts (installedVersion / hasUpdate) to a repo catalog.
 */
export function mergeInstalledVersions(catalog, { home = findDshHome(), profile = findProfileName() } = {}) {
  const installedMap = readAllInstalledPackages({ home, profile })
  const plugins = catalog.map((p) => {
    const installedVersion = installedMap.get(p.name) || installedMap.get(p.id) || null
    return {
      ...p,
      installedVersion,
      hasUpdate: installedVersion ? isUpgrade(installedVersion, p.version || p.latestVersion) : false,
    }
  })
  return {
    plugins,
    profile,
    home,
    checkedAt: new Date().toISOString(),
  }
}

/**
 * Read installed plugin versions from profile manifests into a plain list
 * (used by the checkUpdates RPC path).
 */
export function readInstalledList(pluginNames, { home = findDshHome(), profile = findProfileName() } = {}) {
  const installedMap = readAllInstalledPackages({ home, profile })
  return pluginNames.map((name) => ({
    name,
    version: installedMap.get(name) || null,
  })).filter((entry) => entry.version !== null)
}

/**
 * Check installed plugins against a remote catalog and flag available updates
 */
export function checkPluginUpdates(installedList, catalogList) {
  const catalogMap = new Map(catalogList.map((p) => [p.name || p.id, p]))
  return installedList.map((inst) => {
    const remote = catalogMap.get(inst.name || inst.id)
    if (!remote) return { ...inst, hasUpdate: false }
    const hasUpdate = isUpgrade(inst.version, remote.version || remote.latestVersion)
    return {
      ...inst,
      hasUpdate,
      latestVersion: remote.version || remote.latestVersion,
      downloadUrl: remote.downloadUrl,
      releaseNotes: remote.releaseNotes,
    }
  })
}

/**
 * Normalize the awesome-dsh-plugin community catalog into a flat card list,
 * enriched with local installed version and update availability.
 *
 * Raw entry shape (from awesome-dsh-plugin.com/plugins.json):
 *   { name, owner, url, category, description: {en, zh}, npm, stars,
 *     downloads, install, added, page }
 */
export function normalizeCommunityPlugins(raw, locale = 'zh', { home = findDshHome(), profile = findProfileName() } = {}) {
  if (!raw || !Array.isArray(raw.plugins)) return []
  const installedMap = readAllInstalledPackages({ home, profile })
  const profileDeps = readProfileDependencies({ home, profile })
  const repoPluginNames = new Set(LOCAL_MONOREPO_PLUGINS.map((p) => p.name))

  return raw.plugins.map((p) => {
    const desc = (p.description && typeof p.description === 'object')
      ? (p.description[locale] || p.description.en || p.description.zh || '')
      : (typeof p.description === 'string' ? p.description : '')

    const pkgName = p.npm || p.name || p.id
    const rawSpec = profileDeps[pkgName] || (p.name ? profileDeps[p.name] : undefined)
    const isInstalledInProfile = rawSpec !== undefined

    // Precise disambiguation: if the plugin installed in this profile came from
    // this monorepo (e.g. github:veildawn/dsh-plugins, release tarballs, or local path),
    // it belongs to "自有插件" and must NOT be marked as an installed community plugin!
    const isInstalledAsRepo = Boolean(
      (rawSpec && (rawSpec.includes('veildawn/dsh-plugins') || rawSpec.includes('releases/download/dsh-') || rawSpec.startsWith('file:')))
      || (repoPluginNames.has(pkgName) && isInstalledInProfile)
    )

    // Only flag as installed in community view when it's genuinely installed from an npm/community source
    let installedVersion = null
    if (isInstalledInProfile && !isInstalledAsRepo) {
      installedVersion = (pkgName ? installedMap.get(pkgName) : null) || (p.name ? installedMap.get(p.name) : null) || null
    }

    const latestVersion = p.version || null
    const hasUpdate = (installedVersion && latestVersion) ? isUpgrade(installedVersion, latestVersion) : false

    return {
      id: p.name || p.id,
      name: p.name || p.id,
      title: p.name || p.id,
      description: desc || p.summary || '',
      category: p.category || '',
      stars: Number(p.stars) || 0,
      downloads: Number(p.downloads) || 0,
      homepage: p.url || p.homepage || '',
      npm: p.npm || '',
      install: p.install || '',
      added: p.added || '',
      author: p.owner || '',
      version: latestVersion,
      latestVersion,
      installedVersion,
      hasUpdate,
    }
  })
}

/**
 * Extract the category dictionary ({ id, en, zh }[]) from the catalog.
 */
export function communityCategories(raw) {
  const map = (raw && typeof raw.categories === 'object') ? raw.categories : {}
  return Object.entries(map).map(([id, names]) => ({
    id,
    en: (names && names.en) || id,
    zh: (names && names.zh) || id,
  }))
}

/** Sanitize a profile name for CLI arguments (no shell metacharacters). */
export function safeProfileName(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9_-]+$/.test(name) ? name : null
}

/** Sanitize a package name for `dsh plugin add` (plain or @scope/name). */
export function safePackageName(name) {
  return typeof name === 'string' && /^(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9-_.]*$/i.test(name) ? name : null
}

/**
 * Verify that an install source is allowed before executing it.
 *
 * - repo plugins: must be one of the monorepo release download URLs
 *   (github.com/<origin>/releases/download/<name>@v<version>/<name>-<version>.tgz)
 * - community plugins: must be a package name present in the community catalog
 */
export function isAllowedRepoUrl(downloadUrl, repoOrigin) {
  if (typeof downloadUrl !== 'string') return false
  const cleanRepo = String(repoOrigin).replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
  const prefix = `https://github.com/${cleanRepo}/releases/download/`
  if (!downloadUrl.startsWith(prefix)) return false
  const tail = downloadUrl.slice(prefix.length)
  // <plugin>@v<version>/<plugin>-<version>.tgz — version may be URL-encoded (@ -> %40)
  const decoded = tail.includes('%40') ? tail.replace(/%40/g, '@') : tail
  const match = decoded.match(/^([a-z0-9-]+)@v(\d+\.\d+\.\d+)\/\1-(\d+\.\d+\.\d+)\.tgz$/i)
  // Plugin name must match the asset filename AND tag version must equal asset version.
  return Boolean(match && match[2] === match[3])
}
