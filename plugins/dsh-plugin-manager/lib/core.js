/**
 * Core engine for dsh-market (DeepSeek Harness Community Plugin Market & Repo Manager)
 *
 * Provides:
 * - Semantic version comparison and update detection
 * - Monorepo GitHub Release tag parser (<plugin>@v<version> or v<version>)
 * - Community & Repo catalog fetching and normalization
 * - Local profile plugin inspection (installed versions) and update-state merge
 */

import { closeSync, existsSync, openSync, readFileSync, readdirSync, readSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

export const DEFAULT_REPO_ORIGIN = 'veildawn/dsh-plugins'
export const DEFAULT_COMMUNITY_CATALOG_URL = 'https://awesome-dsh-plugin.com/plugins.json'
export const DSH_PACKAGE_NAME = '@deepseek-ai/dsh'
export const DSH_REPO_SLUG = 'deepseek-ai/deepseek-harness'
export const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org'

/**
 * Compare two semver strings (e.g. "0.4.8" vs "0.4.7", "v1.2.0" vs "1.1.9")
 * Returns:
 *   1 if a > b
 *  -1 if a < b
 *   0 if a === b
 */
export function compareVersions(a, b) {
  if (a === b) return 0
  const parse = (v) => {
    if (!v || typeof v !== 'string') return { major: 0, minor: 0, patch: 0, prerelease: [] }
    const clean = v.replace(/^[^\d]*/, '').trim()
    const [core, ...preParts] = clean.split('-')
    const [major = 0, minor = 0, patch = 0] = (core || '').split('.').map((n) => parseInt(n, 10) || 0)
    const pre = preParts.length ? preParts.join('-').split('.') : []
    return { major, minor, patch, prerelease: pre }
  }

  const pA = parse(a)
  const pB = parse(b)

  if (pA.major !== pB.major) return pA.major > pB.major ? 1 : -1
  if (pA.minor !== pB.minor) return pA.minor > pB.minor ? 1 : -1
  if (pA.patch !== pB.patch) return pA.patch > pB.patch ? 1 : -1

  // Normal release > pre-release when major.minor.patch match
  if (pA.prerelease.length === 0 && pB.prerelease.length > 0) return 1
  if (pA.prerelease.length > 0 && pB.prerelease.length === 0) return -1
  if (pA.prerelease.length === 0 && pB.prerelease.length === 0) return 0

  const maxLen = Math.max(pA.prerelease.length, pB.prerelease.length)
  for (let i = 0; i < maxLen; i++) {
    const idA = pA.prerelease[i]
    const idB = pB.prerelease[i]
    if (idA === undefined) return -1
    if (idB === undefined) return 1
    if (idA === idB) continue

    const numA = parseInt(idA, 10)
    const numB = parseInt(idB, 10)
    const isNumA = !Number.isNaN(numA) && String(numA) === idA
    const isNumB = !Number.isNaN(numB) && String(numB) === idB

    if (isNumA && isNumB) return numA > numB ? 1 : -1
    if (isNumA && !isNumB) return -1
    if (!isNumA && isNumB) return 1
    return idA > idB ? 1 : -1
  }
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
 * - "dsh-model-roles@v0.4.7"             -> { name: "dsh-model-roles", version: "0.4.7" }
 * - "dsh-file-viewer@0.1.8"              -> { name: "dsh-file-viewer", version: "0.1.8" }
 * - "@weniatall/dsh-terminal@v0.1.16"    -> { name: "@weniatall/dsh-terminal", version: "0.1.16" }
 * - "v1.0.0"                             -> { name: null, version: "1.0.0" }
 *
 * The scoped form is why this scans from the right: `indexOf('@')` returns 0
 * for "@scope/name@v1.2.3", which used to produce an empty name and made every
 * release silently vanish from the catalog (formatMonorepoReleases drops
 * nameless entries without warning).
 */
export function parseReleaseTag(tag) {
  if (!tag || typeof tag !== 'string') return null
  const atIdx = tag.lastIndexOf('@')
  if (atIdx > 0) {
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
 * Parse GitHub repository releases.atom XML feed into release objects.
 * Used as a zero-rate-limit fallback when anonymous GitHub REST API (60 req/hr) is exhausted.
 */
export function parseReleasesAtom(atomText) {
  if (typeof atomText !== 'string' || !atomText) return []
  const entries = []
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g
  let match
  while ((match = entryRegex.exec(atomText)) !== null) {
    const block = match[1]
    const tagMatch = block.match(/\/releases\/tag\/([^"/?#\s]+)/)
    const publishedMatch = block.match(/<updated>([^<]+)<\/updated>/)
    const contentMatch = block.match(/<content[^>]*>([\s\S]*?)<\/content>/)
    if (tagMatch) {
      const tag_name = decodeURIComponent(tagMatch[1])
      entries.push({
        tag_name,
        published_at: publishedMatch ? publishedMatch[1] : null,
        body: contentMatch ? contentMatch[1].replace(/<[^>]+>/g, '').trim() : '',
        draft: false,
        prerelease: false,
        assets: [],
      })
    }
  }
  return entries
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
 * 本仓库插件的 npm scope。
 *
 * 12 个插件已发布到 npm（`@weniatall/dsh-*`）：无 scope 的包名
 * （dsh-terminal、dsh-file-viewer 等 9 个）已被第三方占用且不可转让，
 * 因此统一迁移到 scope 下。安装、更新、版本检测都应以 npm 包名为准，
 * GitHub Release 的 tarball 仅作为历史/离线兜底渠道保留。
 */
export const NPM_PLUGIN_SCOPE = '@weniatall'

/**
 * 由仓库内插件短名推出 npm 包名。
 *
 * 短名与包名的对应关系是固定的前缀拼接（dsh-terminal ->
 * @weniatall/dsh-terminal），不需要额外映射表；已经是 scope 形态的
 * 名称原样返回，保证幂等。
 *
 * @param name 插件短名或已带 scope 的包名。
 * @returns npm 包名；name 非法时返回空串。
 */
export function npmNameOf(name) {
  if (typeof name !== 'string') return ''
  const trimmed = name.trim()
  if (trimmed === '') return ''
  if (trimmed.startsWith('@')) return trimmed
  return `${NPM_PLUGIN_SCOPE}/${trimmed}`
}

/**
 * 判断一个安装来源（profile 的 dependencies 值）是不是 npm registry 形态。
 *
 * profile 的 dependencies 值有四种历史形态：
 *   - `^1.2.3` / `1.2.3`      -> npm registry 语义化版本
 *   - `file:/path/to/x.tgz`   -> 本地 tarball（插件管理器下载缓存）
 *   - `https://.../x.tgz`     -> 远端 tarball（GitHub Release）
 *   - `github:owner/repo`     -> git 源
 * 只有第一种才算「走 npm 安装」。
 *
 * @param spec profile dependencies 里的值。
 * @returns 是否为 npm registry 语义化版本区间。
 */
export function isNpmRegistrySpec(spec) {
  if (typeof spec !== 'string') return false
  const value = spec.trim()
  if (value === '') return false
  if (/^(?:file|link|portal|workspace):/i.test(value)) return false
  // 同 installChannelOf：`git+https://` 也算 git 源，不能当成 npm 版本区间。
  if (/^git(?:\+[a-z0-9]+)?:\/\//i.test(value)) return false
  if (/^(?:git|github|gitlab|bitbucket):/i.test(value)) return false
  if (/^https?:\/\//i.test(value)) return false
  if (/^\.{1,2}(?:[/\\]|$)/.test(value)) return false
  return true
}

/**
 * 从 profile 的 dependencies 值判断该插件的安装渠道。
 *
 * @param spec profile dependencies 里的值。
 * @returns 'npm' | 'tarball' | 'path' | 'git' | 'unknown'
 */
export function installChannelOf(spec) {
  if (typeof spec !== 'string' || spec.trim() === '') return 'unknown'
  const value = spec.trim()
  if (/^(?:file|link|portal):/i.test(value)) return 'path'
  // git 源有三种写法：git:、git+<transport>:、以及 github:/gitlab:/bitbucket: 简写。
  // `git+https://...` 必须在这里先被拦下，否则会落到下面的 npm 分支。
  if (/^git(?:\+[a-z0-9]+)?:\/\//i.test(value)) return 'git'
  if (/^(?:git|github|gitlab|bitbucket):/i.test(value)) return 'git'
  if (/^https?:\/\//i.test(value)) return 'tarball'
  if (/^\.{1,2}(?:[/\\]|$)/.test(value)) return 'path'
  if (/^(?:workspace):/i.test(value)) return 'path'
  return 'npm'
}

/**
 * 解析当前环境生效的 npm registry 地址。
 * 优先级：
 * 1. 环境变量 npm_config_registry / NPM_CONFIG_REGISTRY
 * 2. profile 目录下的 .npmrc (registry=...)
 * 3. DEFAULT_NPM_REGISTRY (https://registry.npmjs.org)
 */
export function resolveNpmRegistry({ home = findDshHome(), profile = findProfileName() } = {}) {
  const envRegistry = process.env.npm_config_registry || process.env.NPM_CONFIG_REGISTRY
  if (typeof envRegistry === 'string' && envRegistry.trim().startsWith('http')) {
    return envRegistry.trim().replace(/\/+$/, '')
  }

  try {
    const npmrcPath = join(home, 'profiles', profile, '.npmrc')
    if (existsSync(npmrcPath)) {
      const text = readFileSync(npmrcPath, 'utf8')
      for (const rawLine of text.split('\n')) {
        const line = rawLine.trim()
        if (line.startsWith('#') || !line.includes('=')) continue
        const [k, ...v] = line.split('=')
        if (k.trim() === 'registry') {
          const val = v.join('=').trim()
          if (val.startsWith('http')) return val.replace(/\/+$/, '')
        }
      }
    }
  } catch {}

  return DEFAULT_NPM_REGISTRY
}

/**
 * 本仓库插件的 npm 包名清单（供版本检测批量查询用）。
 */
export function monorepoNpmNames() {
  return LOCAL_MONOREPO_PLUGINS.map((plugin) => npmNameOf(plugin.name))
}

/**
 * 已废弃（deprecated）的自有插件清单。
 *
 * 语义是「只允许卸载，不允许安装与更新」：插件管理器必须在三个层面同时执行，
 * 任何一层漏掉都会让用户装回一个已停止维护的包：
 *   1. catalog：条目带 `deprecated: true`，UI 据此渲染废弃徽章并隐藏安装/更新；
 *   2. 更新检测：mergeInstalledVersions / checkPluginUpdates 强制 hasUpdate=false，
 *      否则「一键更新全部」会把它们重新拉起来；
 *   3. 服务端：resolveInstallSource 拒绝解析，即使前端被绕过也装不上。
 *
 * 键是插件短名（与 LOCAL_MONOREPO_PLUGINS 的 name 一致）；判定时同时接受
 * 短名与 `@weniatall/...` scope 包名，见 isDeprecatedRepoPlugin。
 */
export const DEPRECATED_REPO_PLUGINS = Object.freeze({
  'dsh-terminal': Object.freeze({
    reason: '该插件已停止维护，不再发布新版本。',
    replacement: '',
  }),
  'dsh-zcode-theme': Object.freeze({
    reason: 'ZCode 主题已并入主题工作室（内置 zcode / zcode-mono 两款主题），本包仅作兼容薄壳保留。',
    replacement: 'dsh-theme-studio',
  }),
})

/**
 * 判断某个插件是否已废弃。同时接受短名（`dsh-terminal`）与 scope 包名
 * （`@weniatall/dsh-terminal`），因为 catalog、UI 与 profile 依赖三处使用的
 * 名称形态并不统一。
 *
 * @param name 插件短名、scope 包名或 catalog 条目。
 * @returns 是否已废弃。
 */
export function isDeprecatedRepoPlugin(name) {
  const raw = typeof name === 'string' ? name : name?.name || name?.id
  if (typeof raw !== 'string') return false
  const trimmed = raw.trim()
  if (trimmed === '') return false
  const bare = trimmed.startsWith('@') ? trimmed.slice(trimmed.indexOf('/') + 1) : trimmed
  return Object.hasOwn(DEPRECATED_REPO_PLUGINS, bare.toLowerCase()) ||
    Object.hasOwn(DEPRECATED_REPO_PLUGINS, bare)
}

/**
 * 取废弃插件的废弃说明（含替代方案提示）；未废弃时返回空串。
 *
 * @param name 插件短名、scope 包名或 catalog 条目。
 * @returns 面向用户的中文说明。
 */
export function deprecatedRepoPluginReason(name) {
  const raw = typeof name === 'string' ? name : name?.name || name?.id
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  const bare = trimmed.startsWith('@') ? trimmed.slice(trimmed.indexOf('/') + 1) : trimmed
  const entry = DEPRECATED_REPO_PLUGINS[bare] || DEPRECATED_REPO_PLUGINS[bare.toLowerCase()]
  if (!entry) return ''
  const replacement = entry.replacement ? `建议改用 ${entry.replacement}。` : ''
  return `${entry.reason}${replacement}已废弃插件仅支持卸载。`
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
    title: '跨平台交互式终端（已废弃）',
    description: '本地终端调用、移动端专属对话框底部工具箱二合一入口、多标签并发与触控辅助键盘。',
    author: 'veildawn',
    category: 'tools',
    tags: ['terminal', 'pty', 'shell', 'xterm', 'mobile'],
    icon: 'terminal',
    repo: 'veildawn/dsh-plugins',
    path: 'plugins/dsh-terminal',
    isRepoPlugin: true,
    deprecated: true,
  },
  {
    id: 'dsh-archive-manager',
    name: 'dsh-archive-manager',
    title: '会话归档管理器',
    description: '会话归档管理：侧边栏实时归档计数徽章、一键恢复会话与彻底删除清理磁盘空间。',
    author: 'veildawn',
    category: 'tools',
    tags: ['archive-manager', 'archive', 'session', 'cleanup'],
    icon: 'archive',
    repo: 'veildawn/dsh-plugins',
    path: 'plugins/dsh-archive-manager',
    isRepoPlugin: true,
  },
  {
    id: 'dsh-prompt-history',
    name: 'dsh-prompt-history',
    title: '提示词历史与修改重发',
    description: '提示词历史导航、气泡悬浮修改重发、自适应底部抽屉与跨端持久化漫游。',
    author: 'veildawn',
    category: 'tools',
    tags: ['prompt-history', 'history', 'resend', 'composer', 'mobile'],
    icon: 'history',
    repo: 'veildawn/dsh-plugins',
    path: 'plugins/dsh-prompt-history',
    isRepoPlugin: true,
  },
  {
    id: 'dsh-im-bot',
    name: 'dsh-im-bot',
    title: '集成机器人（企业微信 / 个人微信）',
    description: '把企业微信智能机器人与个人微信接入 DSH：微信发消息即可驱动会话，回合完成或失败时自动把结果推回发起聊天，并支持 /new、/use、/sessions、/stop 等内置命令与扫码登录。',
    author: 'veildawn',
    category: 'tools',
    tags: ['im', 'bot', 'wechat', 'weixin', 'wecom', 'notification'],
    icon: 'message',
    repo: 'veildawn/dsh-plugins',
    path: 'plugins/dsh-im-bot',
    isRepoPlugin: true,
  },
  {
    id: 'dsh-theme-studio',
    name: 'dsh-theme-studio',
    title: '主题工作室',
    description: 'DSH 官方多主题与视觉定制中心：默认保持原生界面风格，内置 ZCode 官方、ZCode 单色极简、苹果玻璃、玻璃彩色 4 款主题，支持自定义背景图/背景色、字体、字号与字段颜色，统一 Token 契约兼容所有插件。',
    author: 'veildawn',
    category: 'ui',
    tags: ['theme', 'glass', 'apple', 'zcode', 'design-system', 'tokens', 'ui'],
    icon: 'palette',
    repo: 'veildawn/dsh-plugins',
    path: 'plugins/dsh-theme-studio',
    isRepoPlugin: true,
  },
  {
    id: 'dsh-zcode-theme',
    name: 'dsh-zcode-theme',
    title: 'ZCode 视觉主题（已废弃，兼容薄壳）',
    description: '兼容薄壳：ZCode 主题已并入 dsh-theme-studio 的 zcode / zcode-mono 内置主题，本包仅保留旧属性与样式标签 id 以保证平滑升级。',
    author: 'veildawn',
    category: 'ui',
    tags: ['theme', 'zcode', 'deprecated', 'compat'],
    icon: 'palette',
    repo: 'veildawn/dsh-plugins',
    path: 'plugins/dsh-zcode-theme',
    isRepoPlugin: true,
    deprecated: true,
  },
  {
    id: 'dsh-jev',
    name: 'dsh-jev',
    title: 'TypeSafe Jev 决策模型',
    description: 'TypeSafe Jev (System One 决策模型) 原生工具插件：70ms 极速结构化决策、意图分流与状态打分，支持前端设置 API Key。',
    author: 'veildawn',
    category: 'ai',
    tags: ['jev', 'typesafe', 'system-one', 'decision', 'ai'],
    icon: 'sparkles',
    repo: 'veildawn/dsh-plugins',
    path: 'plugins/dsh-jev',
    isRepoPlugin: true,
  },
  {
    id: 'dsh-image-gen',
    name: 'dsh-image-gen',
    title: '文生图与图像生成',
    description: 'DSH 原生文生图插件，支持配置/下拉提供商与模型、尺寸与画质选择，内置 HTTP/HTTPS/SOCKS5 代理。',
    author: 'veildawn',
    category: 'ai',
    tags: ['image', 'image-gen', 'draw', 'text-to-image', 'ai'],
    icon: 'image',
    repo: 'veildawn/dsh-plugins',
    path: 'plugins/dsh-image-gen',
    isRepoPlugin: true,
  },
  {
    id: 'dsh-task-models',
    name: 'dsh-task-models',
    title: '子任务模型路由',
    description: '按任务类型为子代理选择模型：规则命中零额外调用，可选 TypeSafe Jev 决策与轻量分类回退，并标注 workflow 成员实际模型。',
    author: 'veildawn',
    category: 'ai',
    tags: ['task-models', 'subagent', 'routing', 'jev', 'workflow'],
    icon: 'branch',
    repo: 'veildawn/dsh-plugins',
    path: 'plugins/dsh-task-models',
    isRepoPlugin: true,
  },
  {
    id: 'dsh-system-prompt-editor',
    name: 'dsh-system-prompt-editor',
    title: '系统提示词编辑器',
    description: '可视化查看并调整系统提示词：默认展示当前真实提示词，按名称（下拉框列出真实段落）等方式定位，追加、替换或删除任意段落，支持按预设或会话限定生效范围。',
    author: 'veildawn',
    category: 'tools',
    tags: ['system-prompt', 'prompt', 'persona', 'editor', 'tools'],
    icon: 'edit',
    repo: 'veildawn/dsh-plugins',
    path: 'plugins/dsh-system-prompt-editor',
    isRepoPlugin: true,
  },
  {
    id: 'dsh-repo-wiki',
    name: 'dsh-repo-wiki',
    title: '仓库知识库',
    description: '代码仓库结构化知识库生成与管理：通过目录规划与逐页写作两阶段流水线自动生成 Markdown 知识库，提供左侧全局面板、六项知识库工具与代码变更持续追踪。',
    author: 'veildawn',
    category: 'tools',
    tags: ['repo-wiki', 'wiki', 'knowledge-base', 'documentation', 'qoder'],
    icon: 'book',
    repo: 'veildawn/dsh-plugins',
    path: 'plugins/dsh-repo-wiki',
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
      // Find asset matching the exact parsed plugin name and version, or fallback to any matching name, or standard URL
      const expectedFileName = `${parsed.name}-${parsed.version}.tgz`
      const exactAsset = (rel.assets || []).find((a) => a?.name === expectedFileName)
      const asset = exactAsset || (rel.assets || []).find((a) => a?.name?.startsWith(`${parsed.name}-`) && a?.name?.endsWith('.tgz')) || (rel.assets || []).find((a) => a?.name?.endsWith('.tgz'))
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
    /* 废弃状态以 DEPRECATED_REPO_PLUGINS 为唯一权威：静态条目上的 deprecated
       字段只用于可读性，两者不一致时以废弃表为准，避免漏标一个已下线插件。 */
    const deprecated = isDeprecatedRepoPlugin(name) || plugin.deprecated === true
    results.push({
      ...plugin,
      deprecated,
      deprecatedReason: deprecated ? deprecatedRepoPluginReason(name) : '',
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
      let dynamicDesc = '自有仓库新增插件'
      if (releaseInfo.releaseNotes) {
        const lines = releaseInfo.releaseNotes.split('\n')
        for (const rawLine of lines) {
          const line = rawLine.replace(/^[#\s*`]+/, '').trim()
          if (line && !line.startsWith('📦') && !line.startsWith('一键安装') && !line.startsWith('```') && !line.startsWith('dsh plugin add')) {
            dynamicDesc = line
            break
          }
        }
      }
      results.push({
        id: name,
        name,
        title: name,
        description: dynamicDesc,
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
        deprecated: isDeprecatedRepoPlugin(name),
        deprecatedReason: deprecatedRepoPluginReason(name),
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
  if (process.env.DSH_PROFILE) {
    return process.env.DSH_PROFILE
  }
  // Desktop host passes profile directory path as an argument, e.g.:
  // .../dsh-desktop-host/lib/index.js <runtimeDir> <home>/profiles/desktop <primaryRuntime> ...
  for (const arg of argv) {
    if (typeof arg === 'string') {
      const match = arg.match(/[\\/]profiles[\\/]([^\\/]+)/)
      if (match && match[1]) {
        return match[1]
      }
    }
  }
  return 'web'
}

/**
 * Detect whether the host is running in Desktop mode and discover its CLI paths and environment.
 */
export function resolveDesktopEnvironment({ processArgs = process.argv } = {}) {
  const argv = processArgs || process.argv
  const hasDesktopProfile = argv.some((arg) => typeof arg === 'string' && /[\\/]profiles[\\/]desktop/.test(arg))
  const hasDesktopExe = (typeof process.execPath === 'string' && process.execPath.includes('DeepSeek Harness'))
    || argv.some((arg) => typeof arg === 'string' && /DeepSeek Harness(?:\.exe)?/i.test(arg))
  const isDesktop = hasDesktopProfile
    || Boolean(process.env.DSH_DESKTOP_NODE_EXECUTABLE)
    || hasDesktopExe

  if (!isDesktop) {
    return { isDesktop: false, platform: process.platform }
  }

  let execPath = process.env.DSH_DESKTOP_NODE_EXECUTABLE || process.execPath
  if (!execPath || !execPath.includes('DeepSeek Harness')) {
    const exeArg = argv.find((arg) => typeof arg === 'string' && /DeepSeek Harness(?:\.exe)?/i.test(arg))
    if (exeArg) execPath = exeArg
  }

  const execDir = dirname(execPath)
  const candidateResources = [
    join(execDir, 'resources'),
    join(execDir, '..', 'Resources'),
    join(execDir, 'Contents', 'Resources'),
  ]

  let cliPath = null
  const relCli = join('dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
  for (const resDir of candidateResources) {
    const asarFile = join(resDir, 'app.asar')
    if (existsInAsar(asarFile, relCli.replace(/\\/g, '/'))) {
      cliPath = join(asarFile, relCli)
      break
    }
    const unpackedCli = join(resDir, 'app.asar.unpacked', relCli)
    if (existsSync(unpackedCli)) {
      cliPath = unpackedCli
      break
    }
  }

  return {
    isDesktop: true,
    platform: process.platform,
    execPath,
    cliPath,
  }
}

/**
 * Format a user-facing CLI command string for installing or managing a plugin.
 * In desktop mode, formats the command with the proper Electron runtime invocation.
 */
export function formatPluginCliCommand(subcommand, profile, source, desktopEnv = resolveDesktopEnvironment()) {
  if (!desktopEnv.isDesktop || profile !== 'desktop') {
    return `dsh plugin --profile ${profile} ${subcommand} ${source}`
  }

  const { platform, execPath, cliPath } = desktopEnv

  if (cliPath && execPath) {
    if (platform === 'win32') {
      return `$env:ELECTRON_RUN_AS_NODE="1"; & "${execPath}" --expose-internals "${cliPath}" plugin --profile desktop ${subcommand} "${source}"`
    }
    return `ELECTRON_RUN_AS_NODE=1 "${execPath}" --expose-internals "${cliPath}" plugin --profile desktop ${subcommand} "${source}"`
  }

  // Fallback if specific path wasn't found but isDesktop
  if (platform === 'win32') {
    return `$env:ELECTRON_RUN_AS_NODE="1"; & "$env:LOCALAPPDATA\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe" --expose-internals "$env:LOCALAPPDATA\\Programs\\DeepSeek Harness\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js" plugin --profile desktop ${subcommand} "${source}"`
  }
  return `ELECTRON_RUN_AS_NODE=1 "/opt/DeepSeek Harness/deepseek-harness" --expose-internals "/opt/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js" plugin --profile desktop ${subcommand} "${source}"`
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
                // 同时也以物理相对路径注册，如 @weniatall/dsh-model-roles
                const relPath = `${entry}/${sub}`
                if (pkg.version) map.set(relPath, pkg.version)
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
            if (pkg.version) map.set(entry, pkg.version)
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
  const installedMap = readAllInstalledPackages({ home, profile })
  return resolveInstalledVersion(installedMap, { name: pkgName })
}

/**
 * Resolve the installed version for one catalog entry, tolerating the scope
 * migration.
 *
 * The repo's plugins used to publish unscoped (`dsh-terminal`), then moved to
 * `@weniatall/dsh-terminal`. A profile installed before the move still holds
 * the unscoped key in node_modules while the catalog now reports the scoped
 * name; without this fallback every such plugin reads as "not installed" and
 * its update check silently disappears.
 *
 * When both an unscoped legacy package and the new scoped package are present
 * in node_modules, this prefers the scoped package (or the higher semantic
 * version) so that updating to the scoped package immediately reflects the
 * new version in the UI instead of sticking to the stale legacy folder.
 *
 * @param installedMap - Map<packageName, version> from readAllInstalledPackages.
 * @param entry - catalog entry carrying `name` and `id`.
 * @returns the installed version string, or null.
 */
export function resolveInstalledVersion(installedMap, entry) {
  const candidates = [entry?.name, entry?.id].filter((value) => typeof value === 'string' && value !== '')
  const matched = new Set()
  for (const candidate of candidates) {
    const scoped = candidate.startsWith('@') ? candidate : `${NPM_PLUGIN_SCOPE}/${candidate}`
    const bare = candidate.startsWith('@') ? candidate.slice(candidate.indexOf('/') + 1) : candidate
    for (const key of [scoped, candidate, bare]) {
      const v = installedMap.get(key)
      if (v !== undefined && v !== null && v !== '') matched.add(v)
    }
  }
  if (matched.size === 0) return null
  // 两个或多个版本并存时，按语义化版本排序取最高者（优先认新装的 scope 版）
  return [...matched].sort((a, b) => compareVersions(b, a))[0]
}

/**
 * Resolve the package name a `dsh plugin remove` / `pnpm remove` must target.
 *
 * The UI hands over whatever the catalog entry carries, which for repo plugins
 * may be the unscoped short name (`dsh-model-roles`) even though the profile
 * declares the scoped package (`@weniatall/dsh-model-roles`). Passing the short
 * name to `pnpm remove` fails with "Command failed with exit code 1" because no
 * such dependency exists.
 *
 * The profile's own dependency keys are authoritative: pick the declared key
 * that matches the requested name in any of its historical spellings, and fall
 * back to the scoped form when nothing is declared.
 *
 * @param name - Requested name, scoped or short.
 * @param dependencies - Record from readProfileDependencies.
 * @returns the name to remove, or null when the input is not a valid package name.
 */
export function resolveRemoveTarget(name, dependencies = {}) {
  const valid = safePackageName(name)
  if (!valid) return null
  const scoped = valid.startsWith('@') ? valid : npmNameOf(valid)
  const bare = valid.startsWith('@') ? valid.slice(valid.indexOf('/') + 1) : valid
  const wanted = [scoped.toLowerCase(), bare.toLowerCase()]

  for (const key of Object.keys(dependencies || {})) {
    if (typeof key !== 'string') continue
    const lowered = key.toLowerCase()
    if (wanted.includes(lowered)) return key
  }
  return scoped
}

/**
 * Detect whether a plugin has conflicting duplicate installations in the profile
 * (e.g. legacy unscoped vs new scoped package names across dependencies, bundles,
 * or node_modules directories).
 */
export function detectPluginConflict(pluginOrName, {
  home = findDshHome(),
  profile = findProfileName(),
  dependencies = null,
  bundles = null,
  installedMap = null,
} = {}) {
  const name = typeof pluginOrName === 'string' ? pluginOrName : pluginOrName?.name
  const valid = safePackageName(name)
  if (!valid) return { hasConflict: false }

  const bareName = valid.startsWith('@') ? valid.slice(valid.indexOf('/') + 1) : valid
  const isMonorepo = valid.startsWith(`${NPM_PLUGIN_SCOPE}/`) || LOCAL_MONOREPO_PLUGINS.some((p) => p.name.toLowerCase() === bareName.toLowerCase())
  if (!isMonorepo) return { hasConflict: false }

  const scopedName = valid.startsWith('@') ? valid : npmNameOf(valid)
  if (bareName.toLowerCase() === scopedName.toLowerCase()) return { hasConflict: false }

  const deps = dependencies || readProfileDependencies({ home, profile })
  let bundlesList = bundles
  if (!bundlesList) {
    try {
      const manifestPath = join(home, 'profiles', profile, 'package.json')
      if (existsSync(manifestPath)) {
        const m = JSON.parse(readFileSync(manifestPath, 'utf8'))
        bundlesList = Array.isArray(m?.dsh?.profile?.bundles) ? m.dsh.profile.bundles : []
      }
    } catch {
      bundlesList = []
    }
  }

  // 1. dependencies check: both bare and scoped keys declared?
  const hasBareDep = Object.keys(deps).some((k) => k.toLowerCase() === bareName.toLowerCase())
  const hasScopedDep = Object.keys(deps).some((k) => k.toLowerCase() === scopedName.toLowerCase())
  const depConflict = hasBareDep && hasScopedDep

  // 2. bundles check: both bare and scoped bundles listed?
  const hasBareBundle = (bundlesList || []).some((b) => b.toLowerCase() === bareName.toLowerCase())
  const hasScopedBundle = (bundlesList || []).some((b) => b.toLowerCase() === scopedName.toLowerCase())
  const bundleConflict = hasBareBundle && hasScopedBundle

  // 3. node_modules physical directory check: both bare dir and scoped dir exist?
  const pDir = profilePluginDir(home, profile)
  const bareDirExists = existsSync(join(pDir, bareName))
  const scopedDirExists = existsSync(join(pDir, scopedName))
  const dirConflict = bareDirExists && scopedDirExists

  // 4. legacy single unscoped check (only unscoped is installed, but repo standard is scoped)
  const isLegacyUnscoped = (hasBareDep && !hasScopedDep) || (bareDirExists && !scopedDirExists && !hasScopedDep)

  const hasConflict = depConflict || bundleConflict || dirConflict

  const reasons = []
  if (depConflict) reasons.push('dependencies 中同时存在旧短名与 scope 包名')
  if (bundleConflict) reasons.push('bundles 配置中同时注册了旧短名与 scope 包名')
  if (dirConflict) reasons.push('node_modules 中同时存在旧短名目录与 scope 目录')

  return {
    hasConflict,
    isLegacyUnscoped,
    bareName,
    scopedName,
    hasBareDep,
    hasScopedDep,
    hasBareBundle,
    hasScopedBundle,
    bareDirExists,
    scopedDirExists,
    reasons,
  }
}

/**
 * Update a profile manifest's dsh.profile.bundles in place.
 * Replaces the first matching variant (bareName or scopedName) at its original index,
 * preserving bundle load order (and patch layering precedence), then strips any
 * subsequent duplicate variants. If no variant was present, pushes to the end.
 *
 * @param {object} manifest - parsed package.json object
 * @param {string} bundleName - modern target bundle name (e.g. "@weniatall/dsh-file-viewer")
 * @returns {{ modified: boolean, index: number }}
 */
export function syncProfileBundle(manifest, bundleName) {
  if (!manifest || typeof manifest !== 'object') return { modified: false, index: -1 }
  manifest.dsh = manifest.dsh || {}
  manifest.dsh.profile = manifest.dsh.profile || {}
  const bundles = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : []

  const bareName = bundleName.startsWith('@') ? bundleName.slice(bundleName.indexOf('/') + 1) : bundleName
  const scopedName = bundleName.startsWith('@') ? bundleName : npmNameOf(bundleName)
  const isMatch = (b) => {
    const lower = String(b).toLowerCase()
    return lower === bundleName.toLowerCase() || lower === bareName.toLowerCase() || lower === scopedName.toLowerCase()
  }

  let firstIndex = -1
  const filtered = []
  for (let i = 0; i < bundles.length; i++) {
    const item = bundles[i]
    if (isMatch(item)) {
      if (firstIndex === -1) {
        firstIndex = filtered.length
        filtered.push(bundleName)
      }
    } else {
      filtered.push(item)
    }
  }

  if (firstIndex === -1) {
    firstIndex = filtered.length
    filtered.push(bundleName)
  }

  const modified = JSON.stringify(bundles) !== JSON.stringify(filtered)
  manifest.dsh.profile.bundles = filtered
  return { modified, index: firstIndex }
}

/**
 * Migrate or strip legacy bare names from cordis.patch.yml top-level patch rows.
 *
 * Why: In DSH (@deepseek-ai/dsh-app-boot applyEntryPatches), if a patch row declares
 * `name: "dsh-file-viewer"` while the newly installed bundle's entry target is
 * `"@weniatall/dsh-file-viewer"`, DSH triggers `name mismatch ..., skipping` and
 * completely drops the user's config overrides!
 * Removing the `name` field from the top-level patch row lets Cordis match purely on `id`,
 * making the configuration resilient across package renames.
 *
 * @param {string|object} pluginOrName - plugin object or package name
 * @returns {{ migrated: boolean, logs: string[], patchPath: string }}
 */
export function migrateProfilePatch(pluginOrName, { home = findDshHome(), profile = findProfileName() } = {}) {
  const patchPath = join(home, 'profiles', profile, 'cordis.patch.yml')
  if (!existsSync(patchPath)) return { migrated: false, logs: [], patchPath }

  const name = typeof pluginOrName === 'string' ? pluginOrName : pluginOrName?.name
  const valid = safePackageName(name)
  if (!valid) return { migrated: false, logs: [], patchPath }

  const bareName = valid.startsWith('@') ? valid.slice(valid.indexOf('/') + 1) : valid
  const logs = []
  let changed = false

  try {
    const content = readFileSync(patchPath, 'utf8')
    const lines = content.split('\n')
    const newLines = []
    let insideInsert = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Detect insert: block start vs top-level list items
      if (/^-\s+insert:/.test(line)) {
        insideInsert = true
      } else if (/^-\s+id:\s*/.test(line)) {
        insideInsert = false
      } else if (/^-\s+/.test(line) && !line.startsWith('  ')) {
        insideInsert = false
      }

      // Only strip legacy name from top-level override rows (not inside insert: blocks)
      if (!insideInsert) {
        const nameMatch = line.match(/^(\s*)name:\s*(['"]?)([^'"\n]+)\2\s*$/)
        if (nameMatch) {
          const val = nameMatch[3].trim()
          if (val.toLowerCase() === bareName.toLowerCase()) {
            changed = true
            logs.push(`已从 cordis.patch.yml 移除 ${val} 的旧 name 字段（防止 name mismatch 导致配置被跳过）`)
            continue
          }
        }
      }

      newLines.push(line)
    }

    if (changed) {
      writeFileSync(patchPath, newLines.join('\n'), 'utf8')
    }
  } catch (err) {
    logs.push(`迁移 cordis.patch.yml 异常: ${err.message}`)
    return { migrated: false, logs, patchPath }
  }

  return { migrated: changed, logs, patchPath }
}

/**
 * Clean up duplicate/legacy conflict for a plugin in the profile.
 * Retains the scoped version (@weniatall/dsh-xxx) and purges the legacy
 * unscoped version (dsh-xxx) from dependencies, bundles, lockfile, and node_modules.
 */
export function cleanupPluginConflict(pluginOrName, {
  home = findDshHome(),
  profile = findProfileName(),
  removeOrphanDir = true,
} = {}) {
  const name = typeof pluginOrName === 'string' ? pluginOrName : pluginOrName?.name
  const valid = safePackageName(name)
  if (!valid) return { cleaned: false, error: 'invalid plugin name' }

  const bareName = valid.startsWith('@') ? valid.slice(valid.indexOf('/') + 1) : valid
  const isMonorepo = valid.startsWith(`${NPM_PLUGIN_SCOPE}/`) || LOCAL_MONOREPO_PLUGINS.some((p) => p.name.toLowerCase() === bareName.toLowerCase())
  if (!isMonorepo) return { cleaned: false }

  const scopedName = valid.startsWith('@') ? valid : npmNameOf(valid)
  if (bareName.toLowerCase() === scopedName.toLowerCase()) return { cleaned: false }

  const logs = []
  let modifiedManifest = false
  const manifestPath = join(home, 'profiles', profile, 'package.json')

  try {
    if (existsSync(manifestPath)) {
      const raw = readFileSync(manifestPath, 'utf8')
      const manifest = JSON.parse(raw)
      if (manifest && typeof manifest === 'object') {
        // 1. Clean dependencies: remove bareName if scopedName or another dep exists
        if (manifest.dependencies && typeof manifest.dependencies === 'object') {
          for (const key of Object.keys(manifest.dependencies)) {
            if (key.toLowerCase() === bareName.toLowerCase()) {
              delete manifest.dependencies[key]
              modifiedManifest = true
              logs.push(`已从 dependencies 移除旧依赖键 ${key}`)
            }
          }
        }
        // 2. In-place sync bundles: replace bareName with scopedName in original position
        if (manifest.dsh?.profile && Array.isArray(manifest.dsh.profile.bundles)) {
          const syncRes = syncProfileBundle(manifest, scopedName)
          if (syncRes.modified) {
            modifiedManifest = true
            logs.push(`已在 bundles 原地同步 ${scopedName}（保持原有加载顺序）`)
          }
        }
        if (modifiedManifest) {
          writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
        }
      }
    }
  } catch (err) {
    return { cleaned: false, error: `修改 package.json 失败: ${err.message}` }
  }

  // 3. Clean lockfile
  try {
    const lockRes = stripPluginFromLockfile(bareName, { home, profile })
    if (lockRes.removed > 0) {
      logs.push(`已从 lockfile 清理 ${lockRes.removed} 条旧短名记录`)
    }
  } catch {}

  // 4. Remove orphan directory in node_modules
  if (removeOrphanDir) {
    try {
      const pDir = profilePluginDir(home, profile)
      const orphanPath = join(pDir, bareName)
      if (existsSync(orphanPath) && statSync(orphanPath).isDirectory()) {
        rmSync(orphanPath, { recursive: true, force: true })
        logs.push(`已清理 node_modules/${bareName} 物理目录`)
      }
    } catch (err) {
      logs.push(`清理目录 node_modules/${bareName} 异常: ${err.message}`)
    }
  }

  // 5. Migrate cordis.patch.yml to prevent name mismatch drops
  try {
    const patchRes = migrateProfilePatch(name, { home, profile })
    if (patchRes.migrated && patchRes.logs?.length > 0) {
      logs.push(...patchRes.logs)
    }
  } catch (err) {
    logs.push(`迁移 cordis.patch.yml 异常: ${err.message}`)
  }

  return { cleaned: true, bareName, scopedName, logs }
}

/**
 * Attach installed-version facts (installedVersion / hasUpdate) to a repo catalog.
 */
export function mergeInstalledVersions(catalog, { home = findDshHome(), profile = findProfileName() } = {}) {
  const installedMap = readAllInstalledPackages({ home, profile })
  const profileDeps = readProfileDependencies({ home, profile })
  let profileBundles = []
  try {
    const manifestPath = join(home, 'profiles', profile, 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      profileBundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
    }
  } catch {}

  const plugins = catalog.map((p) => {
    const installedVersion = resolveInstalledVersion(installedMap, p)
    const duplicateConflict = detectPluginConflict(p, {
      home,
      profile,
      dependencies: profileDeps,
      bundles: profileBundles,
      installedMap,
    })
    /* 废弃插件只允许卸载：即使远端版本更高也必须压住 hasUpdate，否则
       「一键更新全部」会把它重新装回来，与「只能卸载」的语义冲突。 */
    const deprecated = p.deprecated === true || isDeprecatedRepoPlugin(p)
    return {
      ...p,
      deprecated,
      deprecatedReason: deprecated ? (p.deprecatedReason || deprecatedRepoPluginReason(p)) : '',
      installedVersion,
      hasUpdate: (!deprecated && installedVersion)
        ? isUpgrade(installedVersion, p.version || p.latestVersion)
        : false,
      hasDuplicate: duplicateConflict.hasConflict,
      duplicateConflict,
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
    version: resolveInstalledVersion(installedMap, { name }),
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
    // 废弃插件不参与更新检测，见 DEPRECATED_REPO_PLUGINS。
    if (isDeprecatedRepoPlugin(inst.name || inst.id) || remote.deprecated === true) {
      return { ...inst, hasUpdate: false, deprecated: true, latestVersion: remote.version || remote.latestVersion }
    }
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
export function isAllowedRepoUrl(downloadUrl, repoOrigin, mirrorUrl = '') {
  if (typeof downloadUrl !== 'string') return false
  const cleanRepo = String(repoOrigin).replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
  const prefix = `https://github.com/${cleanRepo}/releases/download/`

  let unmirrored = downloadUrl
  if (mirrorUrl && typeof mirrorUrl === 'string' && unmirrored.startsWith(mirrorUrl)) {
    unmirrored = unmirrored.replace(mirrorUrl, 'https://github.com/')
  }

  if (!unmirrored.startsWith(prefix)) return false
  const tail = unmirrored.slice(prefix.length)
  // <plugin>@v<version>/<plugin>-<version>.tgz — version may be URL-encoded (@ -> %40)
  const decoded = tail.includes('%40') ? tail.replace(/%40/g, '@') : tail
  const match = decoded.match(/^([a-z0-9-]+)@v(\d+\.\d+\.\d+)\/\1-(\d+\.\d+\.\d+)\.tgz$/i)
  // Plugin name must match the asset filename AND tag version must equal asset version.
  return Boolean(match && match[2] === match[3])
}

/**
 * Profile pnpm-lock.yaml path.
 */
export function profileLockfilePath({ home = findDshHome(), profile = findProfileName() } = {}) {
  return join(home, 'profiles', profile, 'pnpm-lock.yaml')
}

/**
 * Read a profile's pnpm-lock.yaml as text. Returns '' when missing/unreadable.
 */
export function readProfileLockfile({ home = findDshHome(), profile = findProfileName() } = {}) {
  try {
    const p = profileLockfilePath({ home, profile })
    if (!existsSync(p)) return ''
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

/**
 * YAML indentation (number of leading spaces) of a line.
 */
function lockfileIndent(line) {
  return line.length - line.trimStart().length
}

/**
 * Whether a lockfile key line is the entry for one dependency path.
 * Keys are `depPath:` in `packages:` and `depPath:` / `depPath(peer@ver):` in
 * `snapshots:`, so only a `:` or `(` may follow the path.
 */
function lockfileKeyMatchesDepPath(line, depPath) {
  const text = line.trimStart()
  // Strip optional quotes around YAML key: 'depPath': or "depPath":
  const unquoted = text.replace(/^['"]/, '')
  const cleanDep = depPath.replace(/^['"]/, '').replace(/['"]$/, '')
  if (!unquoted.startsWith(cleanDep)) return false
  const rest = unquoted.slice(cleanDep.length).replace(/^['"]/, '')
  return rest.startsWith(':') || rest.startsWith('(')
}

/**
 * Drop the `packages:` / `snapshots:` entry blocks of the given dependency
 * paths, leaving the `importers:` references in place so pnpm keeps the
 * dependency and re-resolves it on the next install.
 *
 * @param depPaths - dependency paths (e.g. "dsh-jev@<tarball-url>")
 * @returns { removed, rewritten, lockfilePath }
 */
function stripLockfileDepPaths(depPaths, { home = findDshHome(), profile = findProfileName() } = {}) {
  const lockfilePath = profileLockfilePath({ home, profile })
  const text = readProfileLockfile({ home, profile })
  if (!text || depPaths.length === 0) return { removed: 0, rewritten: false, lockfilePath }

  const lines = text.split('\n')
  const drop = new Array(lines.length).fill(false)
  let removed = 0
  let section = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const indent = lockfileIndent(line)
    if (indent === 0) {
      section = trimmed.endsWith(':') ? trimmed.slice(0, -1) : null
      continue
    }
    if ((section !== 'packages' && section !== 'snapshots') || indent !== 2) continue
    if (!depPaths.some((depPath) => lockfileKeyMatchesDepPath(line, depPath))) continue

    drop[i] = true
    removed++
    let j = i + 1
    while (j < lines.length) {
      const next = lines[j]
      if (next.trim() === '' || next.trim().startsWith('#')) { j++; continue }
      if (lockfileIndent(next) <= 2) break
      drop[j] = true
      j++
    }
  }

  if (removed === 0) return { removed: 0, rewritten: false, lockfilePath }

  const kept = []
  for (let i = 0; i < lines.length; i++) {
    if (drop[i]) continue
    if (lines[i].trim() === '' && kept.length > 0 && kept[kept.length - 1].trim() === '') continue
    kept.push(lines[i])
  }
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop()

  try {
    writeFileSync(lockfilePath, kept.join('\n') + '\n', 'utf8')
  } catch {
    return { removed, rewritten: false, lockfilePath }
  }
  return { removed, rewritten: true, lockfilePath }
}

/**
 * List every `packages:` entry whose `resolution` has no `integrity` field.
 *
 * pnpm >= 10.16 (and v11) refuses to install *anything* while such an entry
 * exists — `ERR_PNPM_MISSING_TARBALL_INTEGRITY` — so one half-written entry
 * from an earlier aborted run blocks every later install in that profile.
 *
 * @returns dependency paths, e.g. ["dsh-jev@https://.../dsh-jev-0.1.8.tgz"]
 */
export function findLockfilePackagesMissingIntegrity({ home = findDshHome(), profile = findProfileName() } = {}) {
  const text = readProfileLockfile({ home, profile })
  if (!text) return []

  const lines = text.split('\n')
  const missing = []
  let inPackages = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const indent = lockfileIndent(line)
    if (indent === 0) {
      inPackages = trimmed === 'packages:'
      continue
    }
    if (!inPackages || indent !== 2) continue

    let hasIntegrity = false
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]
      if (next.trim() === '' || next.trim().startsWith('#')) continue
      if (lockfileIndent(next) <= 2) break
      if (next.includes('integrity:')) { hasIntegrity = true; break }
    }
    if (!hasIntegrity) {
      const cleanKey = trimmed.replace(/:$/, '').replace(/^['"]/, '').replace(/['"]$/, '')
      missing.push(cleanKey)
    }
  }

  return missing
}

/**
 * Repair a profile lockfile poisoned by entries without `integrity`.
 *
 * Why writing the real hash (instead of deleting the entry) is the fix:
 * the desktop bundles pnpm v11, which *writes* URL-tarball entries without an
 * `integrity` field and then *refuses to read that same lockfile back*
 * (`ERR_PNPM_MISSING_TARBALL_INTEGRITY`). Deleting the entry does not help:
 * the very next install re-adds it in the same integrity-less shape, so the
 * profile stays poisoned forever after the first URL install. Fetching the
 * tarball and recording its sha512 breaks the cycle permanently.
 *
 * @param fetchIntegrity - async (url) => "sha512-..." (or null on failure)
 * @returns { injected, stripped, rewritten, lockfilePath, names }
 */
export async function repairLockfileIntegrity({ home = findDshHome(), profile = findProfileName(), fetchIntegrity } = {}) {
  const lockfilePath = profileLockfilePath({ home, profile })
  const names = findLockfilePackagesMissingIntegrity({ home, profile })
  if (names.length === 0) return { injected: 0, stripped: 0, rewritten: false, lockfilePath, names: [] }

  const fixes = []
  const unresolvable = []
  for (const depPath of names) {
    const url = tarballUrlFromDepPath(depPath)
    if (!url || typeof fetchIntegrity !== 'function') { unresolvable.push(depPath); continue }
    let integrity = null
    try {
      integrity = await fetchIntegrity(url)
    } catch {
      integrity = null
    }
    if (integrity) fixes.push({ depPath, integrity })
    else unresolvable.push(depPath)
  }

  let injected = 0
  let rewritten = false
  if (fixes.length > 0) {
    const text = readProfileLockfile({ home, profile })
    const patched = applyLockfileIntegrity(text, fixes)
    if (patched.injected > 0) {
      try {
        writeFileSync(lockfilePath, patched.text, 'utf8')
        injected = patched.injected
        rewritten = true
      } catch {
        injected = 0
      }
    }
  }

  // Anything whose tarball could not be hashed falls back to removal so pnpm
  // can at least try to re-resolve it.
  const strip = stripLockfileDepPaths(unresolvable, { home, profile })
  if (strip.rewritten) rewritten = true

  return { injected, stripped: strip.removed, rewritten, lockfilePath, names }
}

/**
 * Insert `integrity` into the `resolution: {...}` line of each `packages:`
 * entry, preserving every other byte of the lockfile.
 *
 * Line-based on purpose: the lockfile is YAML with `@`/`%40`/`:` inside keys,
 * so regex key matching is fragile, while indentation is well-defined.
 *
 * @param text - lockfile contents
 * @param fixes - [{ depPath, integrity }]
 * @returns { text, injected }
 */
export function applyLockfileIntegrity(text, fixes) {
  if (!text || fixes.length === 0) return { text, injected: 0 }

  const byPath = new Map(fixes.map((f) => [f.depPath, f.integrity]))
  const lines = text.split('\n')
  let injected = 0
  let section = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const indent = lockfileIndent(line)
    if (indent === 0) {
      section = trimmed.endsWith(':') ? trimmed.slice(0, -1) : null
      continue
    }
    if (section !== 'packages' || indent !== 2) continue

    const key = trimmed.replace(/:$/, '').replace(/^['"]/, '').replace(/['"]$/, '')
    const integrity = byPath.get(key)
    if (integrity === undefined) continue

    // Patch the resolution line inside this entry's block.
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]
      if (next.trim() === '' || next.trim().startsWith('#')) continue
      if (lockfileIndent(next) <= 2) break
      if (!next.includes('resolution:')) continue
      if (next.includes('integrity:')) break
      const open = next.indexOf('{')
      if (open === -1) {
        lines[j] = next.replace(/resolution:\s*$/, `resolution: {integrity: ${integrity}}`)
      } else {
        lines[j] = next.slice(0, open + 1) + `integrity: ${integrity}, ` + next.slice(open + 1)
      }
      injected++
      break
    }
  }

  return { text: lines.join('\n'), injected }
}

/**
 * Extract the tarball URL embedded in a lockfile depPath, if any.
 * `dsh-jev@https://host/x.tgz` -> `https://host/x.tgz`
 */
export function tarballUrlFromDepPath(depPath) {
  if (typeof depPath !== 'string') return null
  for (const marker of ['@https://', '@http://']) {
    const idx = depPath.indexOf(marker)
    if (idx !== -1) return depPath.slice(idx + 1)
  }
  return null
}

/**
 * Strip a plugin from the profile's package.json dependencies, so that pnpm
 * treats `dsh plugin add <pkg>` as a fresh install and resolves the latest
 * version rather than skipping resolution due to existing version constraints.
 *
 * @param pluginName - package name (e.g. "dsh-better-sidebar")
 * @returns { removed, manifestPath }
 */
export function stripPluginFromPackageJson(pluginName, { home = findDshHome(), profile = findProfileName() } = {}) {
  try {
    const manifestPath = join(home, 'profiles', profile, 'package.json')
    if (!existsSync(manifestPath)) return { removed: false, manifestPath }
    const raw = readFileSync(manifestPath, 'utf8')
    const manifest = JSON.parse(raw)
    let removed = false
    if (manifest && typeof manifest === 'object' && manifest.dependencies) {
      // 容忍 scope 迁移：传入 @weniatall/dsh-x 时顺便清理旧的无 scope 键 dsh-x，
      // 反之亦然，避免 dependencies 出现同一插件的双份依赖约束。
      const bareName = pluginName.startsWith('@') ? pluginName.slice(pluginName.indexOf('/') + 1) : pluginName
      const scopedName = pluginName.startsWith('@') ? pluginName : `${NPM_PLUGIN_SCOPE}/${pluginName}`
      const targets = new Set([
        pluginName.toLowerCase(),
        bareName.toLowerCase(),
        scopedName.toLowerCase(),
      ])

      for (const key of Object.keys(manifest.dependencies)) {
        if (targets.has(key.toLowerCase())) {
          delete manifest.dependencies[key]
          removed = true
        }
      }
    }
    if (removed) {
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    }
    return { removed, manifestPath }
  } catch {
    return { removed: false, manifestPath: null }
  }
}

/**
 * Strip a plugin's references from the profile's pnpm-lock.yaml so that pnpm
 * re-resolves the package from scratch on the next install.
 *
 * Fixes ERR_PNPM_TARBALL_INTEGRITY during updates: pnpm verifies every
 * tarball entry already present in the lockfile while adding the new version,
 * and a stale entry (e.g. an old release tarball that was re-uploaded upstream
 * and thus changed its hash) fails that check and aborts the whole install —
 * even though the NEW version downloaded fine. Removing the old plugin entries
 * lets pnpm re-resolve only the target.
 *
 * Line-based, indentation-aware YAML surgery (no YAML dep); safe because the
 * lockfile is regenerated by pnpm anyway.
 *
 * @param pluginName - package name (e.g. "dsh-file-viewer")
 * @returns { removed, rewritten, lockfilePath }
 */
export function stripPluginFromLockfile(pluginName, { home = findDshHome(), profile = findProfileName() } = {}) {
  const text = readProfileLockfile({ home, profile })
  const lockfilePath = profileLockfilePath({ home, profile })
  if (!text) return { removed: 0, rewritten: false, lockfilePath }

  const lines = text.split('\n')
  const drop = new Array(lines.length).fill(false)
  let removed = 0

  // --- packages section: drop entry blocks whose key references the plugin ---
  let inPackages = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const indent = lockfileIndent(line)
    if (trimmed === 'packages:') { inPackages = true; continue }
    if (indent === 0 && trimmed !== 'packages:') { inPackages = false }
    if (!inPackages || indent !== 2) continue
    const unquoted = line.trimStart().replace(/^['"]/, '')
    if (unquoted.toLowerCase().startsWith(pluginName.toLowerCase() + '@')) {
      drop[i] = true
      removed++
      let j = i + 1
      while (j < lines.length) {
        const l = lines[j]
        if (l.trim() === '' || l.trim().startsWith('#')) { j++; continue }
        if (lockfileIndent(l) <= 2) break
        drop[j] = true
        j++
      }
    }
  }

  // --- snapshots section: drop entry blocks whose key references the plugin ---
  let inSnapshots = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const indent = lockfileIndent(line)
    if (trimmed === 'snapshots:') { inSnapshots = true; continue }
    if (indent === 0 && trimmed !== 'snapshots:') { inSnapshots = false }
    if (!inSnapshots || indent !== 2) continue
    const unquoted = line.trimStart().replace(/^['"]/, '')
    if (unquoted.toLowerCase().startsWith(pluginName.toLowerCase() + '@')) {
      drop[i] = true
      removed++
      let j = i + 1
      while (j < lines.length) {
        const l = lines[j]
        if (l.trim() === '' || l.trim().startsWith('#')) { j++; continue }
        if (lockfileIndent(l) <= 2) break
        drop[j] = true
        j++
      }
    }
  }

  // --- importers section: drop the plugin's dependency block ---
  let inImporters = false
  let inDependencies = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const indent = lockfileIndent(line)
    if (trimmed === 'importers:') { inImporters = true; inDependencies = false; continue }
    if (!inImporters) continue
    if (indent === 0) { inImporters = false; inDependencies = false; continue }
    if (trimmed === 'dependencies:' && indent === 4) { inDependencies = true; continue }
    if (trimmed.endsWith(':') && indent === 4 && trimmed !== 'dependencies:') { inDependencies = false; continue }
    if (!inDependencies) continue
    const depKey = line.trimStart().replace(/:$/, '').replace(/^['"]/, '').replace(/['"]$/, '')
    if (indent === 6 && depKey.toLowerCase() === pluginName.toLowerCase()) {
      drop[i] = true
      removed++
      let j = i + 1
      while (j < lines.length) {
        const l = lines[j]
        if (l.trim() === '' || l.trim().startsWith('#')) { j++; continue }
        if (lockfileIndent(l) <= 6) break
        drop[j] = true
        j++
      }
    }
  }

  if (removed === 0) return { removed: 0, rewritten: false, lockfilePath }

  // Collapse consecutive blank lines so the YAML stays tidy.
  const kept = []
  for (let i = 0; i < lines.length; i++) {
    if (drop[i]) continue
    if (lines[i].trim() === '' && kept.length > 0 && kept[kept.length - 1].trim() === '') continue
    kept.push(lines[i])
  }
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop()

  try {
    writeFileSync(lockfilePath, kept.join('\n') + '\n', 'utf8')
  } catch {
    return { removed, rewritten: false, lockfilePath }
  }
  return { removed, rewritten: true, lockfilePath }
}

/**
 * Scan the profile lockfile for tarball-URL entries referencing a plugin.
 * Returns array of { key, url } for packages entries whose key includes the
 * plugin name, plus a tarballUrl extracted from the resolution when present.
 */
export function listLockfilePluginEntries(pluginName, { home = findDshHome(), profile = findProfileName() } = {}) {
  const text = readProfileLockfile({ home, profile })
  if (!text) return []
  const lines = text.split('\n')
  const out = []
  // Scan both packages and snapshots sections (both use 2-space entry keys).
  let inSection = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const indent = lockfileIndent(line)
    if (trimmed === 'packages:' || trimmed === 'snapshots:') { inSection = true; continue }
    if (indent === 0 && trimmed !== 'packages:' && trimmed !== 'snapshots:') { inSection = false }
    if (!inSection || indent !== 2) continue
    const unquoted = line.trimStart().replace(/^['"]/, '')
    if (unquoted.startsWith(pluginName + '@')) {
      const key = unquoted.replace(/:$/, '').replace(/['"]$/, '')
      let tarballUrl = ''
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const rl = lines[j]
        if (lockfileIndent(rl) <= 2) break
        const rm = rl.match(/tarball:\s*([^\s}]+)/)
        if (rm) { tarballUrl = rm[1].replace(/^['"]/, '').replace(/['"]$/, ''); break }
      }
      // When no resolution/tarball line exists (e.g. snapshots entries), fall
      // back to the key but strip the "<plugin>@" name prefix and the trailing
      // peer-dependency suffix like "(<url>(@peer@1.0.0):)".
      let url = tarballUrl
      if (!url) {
        url = key.slice(pluginName.length + 1).replace(/\(@.*\):?$/, '').replace(/\(.*\)$/, '').replace(/:$/, '')
      }
      out.push({ key, url })
    }
  }
  return out
}

/**
 * Compare an installed plugin's lockfile state against a target tarball URL.
 * Returns a lockfile "health" summary for one plugin.
 */
export function lockfileHealthForPlugin(pluginName, targetUrl, { home = findDshHome(), profile = findProfileName() } = {}) {
  const entries = listLockfilePluginEntries(pluginName, { home, profile })
  const normTarget = normalizeTarballUrl(targetUrl)

  // pnpm v10.16+/v11 aborts the whole install when ANY packages entry lacks
  // integrity, so one poisoned entry anywhere makes the lockfile unhealthy.
  const missingIntegrity = findLockfilePackagesMissingIntegrity({ home, profile })

  const stale = entries.filter((e) => normalizeTarballUrl(e.url) !== normTarget)
  return {
    name: pluginName,
    entries,
    targetUrl,
    staleCount: stale.length,
    stale,
    missingIntegrity,
    healthy: stale.length === 0 && missingIntegrity.length === 0,
  }
}

/** Strip scheme-encoding variance (%40 vs @) when comparing tarball URLs. */
export function normalizeTarballUrl(url) {
  if (!url) return ''
  return String(url).replace(/%40/g, '@').replace(/#.*$/, '')
}


export const DSH_HOST_PACKAGE_NAMES = new Set([
  DSH_PACKAGE_NAME,
  '@deepseek-ai/dsh-desktop',
  '@deepseek-ai/dsh-desktop-runtime',
  '@deepseek-ai/dsh-desktop-host',
])

// 精确版本号，不含 ^ ~ >= 等范围前缀。
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?$/

/**
 * Extract DSH host version from a parsed package.json object.
 * Only an exact version counts: a dependency range like "^0.2.0" describes no installed build.
 */
export function extractDshVersionFromPkg(pkg) {
  if (!pkg || typeof pkg !== 'object') return null
  if (pkg.name === DSH_PACKAGE_NAME && pkg.version) return pkg.version
  const declared = pkg.dependencies && pkg.dependencies[DSH_PACKAGE_NAME]
  if (typeof declared === 'string' && EXACT_VERSION_RE.test(declared.trim())) {
    return declared.trim()
  }
  if (DSH_HOST_PACKAGE_NAMES.has(pkg.name) && pkg.version) {
    return pkg.version
  }
  return null
}

/**
 * Read and parse JSON file from inside an Electron asar archive without dependencies.
 */
export function readPackageJsonFromAsar(asarPath, entryRelativePath) {
  try {
    const directPath = join(asarPath, entryRelativePath)
    if (existsSync(directPath)) {
      return JSON.parse(readFileSync(directPath, 'utf8'))
    }
  } catch {}

  let fd = null
  const prevNoAsar = process.noAsar
  try {
    process.noAsar = true
    fd = openSync(asarPath, 'r')
    const sizeBuf = Buffer.alloc(16)
    readSync(fd, sizeBuf, 0, 16, 0)
    const jsonLen = sizeBuf.readUInt32LE(12)
    if (!jsonLen || jsonLen > 32 * 1024 * 1024) return null
    const headerBuf = Buffer.alloc(jsonLen)
    readSync(fd, headerBuf, 0, jsonLen, 16)
    const header = JSON.parse(headerBuf.toString('utf8'))

    const parts = entryRelativePath.replace(/\\/g, '/').split('/').filter(Boolean)
    let cur = header
    for (const part of parts) {
      if (!cur.files || !cur.files[part]) return null
      cur = cur.files[part]
    }
    if (!cur.size || cur.offset == null) return null
    const baseOffset = 16 + jsonLen
    const fileOffset = baseOffset + parseInt(cur.offset, 10)
    const fileBuf = Buffer.alloc(cur.size)
    readSync(fd, fileBuf, 0, cur.size, fileOffset)
    return JSON.parse(fileBuf.toString('utf8'))
  } catch {
    return null
  } finally {
    if (fd != null) {
      try { closeSync(fd) } catch {}
    }
    if (prevNoAsar === undefined) {
      delete process.noAsar
    } else {
      process.noAsar = prevNoAsar
    }
  }
}

/**
 * Check whether a relative path exists inside an Electron asar archive.
 */
export function existsInAsar(asarPath, entryRelativePath) {
  try {
    const directPath = join(asarPath, entryRelativePath)
    if (existsSync(directPath)) return true
  } catch {}

  let fd = null
  const prevNoAsar = process.noAsar
  try {
    process.noAsar = true
    fd = openSync(asarPath, 'r')
    const sizeBuf = Buffer.alloc(16)
    readSync(fd, sizeBuf, 0, 16, 0)
    const jsonLen = sizeBuf.readUInt32LE(12)
    if (!jsonLen || jsonLen > 32 * 1024 * 1024) return false
    const headerBuf = Buffer.alloc(jsonLen)
    readSync(fd, headerBuf, 0, jsonLen, 16)
    const header = JSON.parse(headerBuf.toString('utf8'))

    const parts = entryRelativePath.replace(/\\/g, '/').split('/').filter(Boolean)
    let cur = header
    for (const part of parts) {
      if (!cur.files || !cur.files[part]) return false
      cur = cur.files[part]
    }
    return true
  } catch {
    return false
  } finally {
    if (fd != null) {
      try { closeSync(fd) } catch {}
    }
    if (prevNoAsar === undefined) {
      delete process.noAsar
    } else {
      process.noAsar = prevNoAsar
    }
  }
}

function inspectAsarForDshVersion(asarPath) {
  const candidateEntries = [
    'dsh/node_modules/@deepseek-ai/dsh/package.json',
    'dsh/package.json',
    'package.json',
    'node_modules/@deepseek-ai/dsh/package.json',
  ]
  for (const entry of candidateEntries) {
    const pkg = readPackageJsonFromAsar(asarPath, entry)
    const v = extractDshVersionFromPkg(pkg)
    if (v) return v
  }
  return null
}

function inspectDirForDshVersion(dir) {
  if (!dir || typeof dir !== 'string') return null
  const asarMatch = dir.match(/^(.+?\.asar)(?:[\\/]|$)/i)
  if (asarMatch) {
    const v = inspectAsarForDshVersion(asarMatch[1])
    if (v) return v
  }
  try {
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      const v = extractDshVersionFromPkg(pkg)
      if (v) return v
    }
  } catch {}
  try {
    const nested = join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    if (existsSync(nested)) {
      const pkg = JSON.parse(readFileSync(nested, 'utf8'))
      const v = extractDshVersionFromPkg(pkg)
      if (v) return v
    }
  } catch {}
  try {
    const asarFile = join(dir, 'app.asar')
    if (existsSync(asarFile)) {
      const v = inspectAsarForDshVersion(asarFile)
      if (v) return v
    }
  } catch {}
  return null
}

/**
 * Detect the running host DSH version.
 * First inspects Desktop environment, resources, and process.argv / running script path.
 * Falls back to executing CLI if spawnFn is provided or available on PATH.
 */
export function readHostDshVersion({ spawnFn = null, processArgs = process.argv } = {}) {
  const desktopEnv = resolveDesktopEnvironment({ processArgs })
  if (desktopEnv.isDesktop && desktopEnv.execPath) {
    const execDir = dirname(desktopEnv.execPath)
    const candidateResourceDirs = [
      join(execDir, 'resources'),
      join(execDir, '..', 'Resources'),
      join(execDir, 'Contents', 'Resources'),
    ]
    for (const resDir of candidateResourceDirs) {
      const v = inspectDirForDshVersion(resDir)
      if (v) return v
    }
  }

  const candidates = [...(processArgs || [])]
  for (const raw of candidates) {
    if (!raw || typeof raw !== 'string') continue
    try {
      const asarMatch = raw.match(/^(.+?\.asar)(?:[\\/]|$)/i)
      if (asarMatch) {
        const v = inspectAsarForDshVersion(asarMatch[1])
        if (v) return v
      }
      const real = realpathSync(raw)
      let dir = statSync(real).isDirectory() ? real : dirname(real)
      for (let i = 0; i < 6; i++) {
        const v = inspectDirForDshVersion(dir)
        if (v) return v
        const parent = dirname(dir)
        if (parent === dir) break
        dir = parent
      }
    } catch {}
  }

  if (desktopEnv.isDesktop && desktopEnv.cliPath && desktopEnv.execPath) {
    try {
      const runner = spawnFn || spawnSync
      const res = runner(desktopEnv.execPath, ['--expose-internals', desktopEnv.cliPath, '--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      if (res && res.status === 0) {
        const match = String(res.stdout || '').trim().match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/)
        if (match) return match[1]
      }
    } catch {}
  }

  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which'
    const runner = spawnFn || spawnSync
    const whichRes = runner(whichCmd, ['dsh'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    if (whichRes && whichRes.status === 0 && whichRes.stdout) {
      const cliCandidates = whichRes.stdout.trim().split(/\r?\n/)
      for (const raw of cliCandidates) {
        if (!raw || typeof raw !== 'string') continue
        try {
          const real = realpathSync(raw)
          let dir = statSync(real).isDirectory() ? real : dirname(real)
          for (let i = 0; i < 6; i++) {
            const v = inspectDirForDshVersion(dir)
            if (v) return v
            const parent = dirname(dir)
            if (parent === dir) break
            dir = parent
          }
        } catch {}
      }
    }
  } catch {}

  try {
    const runner = spawnFn || spawnSync
    const res = runner('dsh', ['--version'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (res && res.status === 0) {
      const match = String(res.stdout || '').trim().match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/)
      if (match) return match[1]
    }
  } catch {}

  return null
}

/**
 * Extract version from DSH release tag (e.g. "dsh-v0.1.5-rc.1" or "v0.1.5-rc.1" -> "0.1.5-rc.1").
 */
export function parseDshReleaseTag(tag) {
  if (!tag || typeof tag !== "string") return null;
  const match = tag.trim().match(/(?:^dsh-?v?|^v)?(\d+\.\d+\.\d+(?:-[\w.]+)?)$/);
  return match ? match[1] : null;
}

/**
 * Compare local host DSH version against remote latest version.
 */
export function checkDshUpdate({ currentVersion, latestVersion, releaseUrl, releaseNotes, publishedAt, distTags = {} } = {}) {
  const hasUpdate = Boolean(currentVersion && latestVersion && compareVersions(latestVersion, currentVersion) > 0);
  return {
    name: DSH_PACKAGE_NAME,
    currentVersion: currentVersion || null,
    latestVersion: latestVersion || null,
    hasUpdate,
    releaseUrl: releaseUrl || "https://github.com/deepseek-ai/deepseek-harness/releases",
    releaseNotes: releaseNotes || "",
    publishedAt: publishedAt || null,
    distTags: distTags || {},
  };
}
