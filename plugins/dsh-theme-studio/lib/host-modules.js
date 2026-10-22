/**
 * 宿主 CSS Modules 映射探测：让主题选择器跟随「当前正在运行的宿主构建」。
 *
 * ## 为什么需要这一层
 *
 * 宿主前端由几十个 `dsh-client-ui-*` 插件组成，每个都用 CSS Modules。类名形如
 * `<hash>_<part>`，**hash 每次构建都重新生成**，而 part 是源码里的局部类名，
 * 跨构建稳定。
 *
 * 实测三套构建（2026-10，宿主 0.2.1-rc.2）：
 *
 * | 来源 | `AppFrame.frame` | `MessageItem.bubble` | `InputBar.card` |
 * | :--- | :--- | :--- | :--- |
 * | Web（`dsh web`） | `pI_x6G_frame` | `Sixlwa_bubble` | `uV2eYG_card` |
 * | macOS 桌面版 | `_LS25G_frame` | `P9wcjW_bubble` | `Qt4Hga_card` |
 * | Windows 桌面版 | `BynINW_frame` | `cJsG2q_bubble` | `RlGAzG_card` |
 *
 * 主题 CSS 写死的是前两套，所以第三套（用户实际装的那个）一条规则都命中不了：
 * 框架卡片、气泡、输入卡全部退回宿主默认配色 —— **没有任何报错**，只是「主题
 * 看起来没生效」。这正是桌面版不兼容的根因。
 *
 * ## 判据：模块文件 + 部件名
 *
 * 137 个模块文件的**部件名集合在三套构建里逐个完全一致**（`test/host-modules.test.mjs`
 * 守护这条前提）。所以 `模块文件 + 部件名` 是跨构建稳定、且在宿主内唯一的目标。
 *
 * 只按部件名（不带模块）不够：`root` 在 37 个模块里、`title` 在 36 个、`card` 在 21 个。
 * 精确到模块文件后，主题实际引用的 128 个类名可以 100% 对上唯一目标。
 *
 * ## 失败即退化
 *
 * 读不到宿主（CI、单元测试、未知安装布局）时不抛错、不告警，返回空索引；
 * `adaptCssToHost()` 于是原样返回 CSS，行为与本模块引入前完全一致。
 *
 * @module dsh-theme-studio/host-modules
 */

import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 宿主 UI 包名前缀。 */
const UI_BUNDLE_PREFIX = 'dsh-client-ui-'

/**
 * CSS Module 类名：`<hash>_<part>`。
 *
 * 宿主里这四类形态都真实存在，正则必须都覆盖：
 *
 * | 形态 | 例子 | 说明 |
 * | :--- | :--- | :--- |
 * | 普通 | `BynINW_frame` | hash 纯字母数字 |
 * | hash 带下划线 | `pI_x6G_centerCol` | 唯一合法切分点是**最后一个**下划线 |
 * | hash 带连字符 | `hHd-Xa_newSession` | |
 * | hash 以数字/连字符开头 | `_7yHdaG_header`、`-rlH6G_card` | 数字开头时 CSS Modules 会加前导下划线 |
 * | part 带连字符 | `RlGAzG_input-pending` | |
 *
 * 与 `scripts/host-classes.mjs` 的 `normalizeHostClass()` 同一套判据：
 * 切分点取最后一个下划线，hash 自身可能含下划线。
 *
 * 不匹配的形态（i18n 文案、版本号、`fv-scrim` 这类插件自有 kebab 类名）一律返回 null ——
 * 宁可不识别，也不能把中文文案当成类名去改写。
 */
const MODULE_CLASS_RE = /^_?([A-Za-z0-9-][A-Za-z0-9_-]*)_([A-Za-z][A-Za-z0-9-]*)$/

/** 在文本里找 `"part": "hash_part"` 形式的映射表条目。 */
const MAPPING_ENTRY_RE = /"([A-Za-z][A-Za-z0-9-]*)":\s*"(_?[A-Za-z0-9][A-Za-z0-9_-]*_[A-Za-z][A-Za-z0-9]*)"/g

/** 映射表变量声明：`var Foo_module_css_default = {`。 */
const MAPPING_HEADER_RE =
  /(?:var|const|let)\s+([A-Za-z_$][\w$]*_module_css(?:_default)?)\s*=\s*\{/g

/**
 * 模块文件名锚点。宿主给每个 CSS Modules 模块留一条 `tagId`：
 * `const tagId = "@deepseek-ai/dsh-client-ui-layout/AppFrame.module.css";`。
 *
 * 这是跨构建**唯一稳定**的模块身份 —— 映射表变量名（`AppFrame_module_css_default`）
 * 是从文件名机械推导的，但只有文件名本身是源码里真实存在的路径。
 */
const MODULE_TAG_RE =
  /const\s+tagId(?:\$\d+)?\s*=\s*"@deepseek-ai\/dsh-client-ui-[^"/]+\/([^"]+\.module\.css)"\s*;/g

/**
 * 把一个 CSS Module 类名拆成 `{ prefix, part }`。
 *
 * @param {string} className - 例如 `_LS25G_centerCol`、`BynINW_frame`、`pI_x6G_centerCol`。
 * @returns {{ prefix: string, part: string } | null}
 */
export function splitModuleClass(className) {
  if (typeof className !== 'string') return null
  const match = MODULE_CLASS_RE.exec(className)
  if (!match) return null
  return { prefix: match[1], part: match[2] }
}

/**
 * 把「bundle + 模块文件名 + 部件名」拼成跨构建稳定的槽位键。
 *
 * @param {string} bundle
 * @param {string} file
 * @param {string} part
 * @returns {string}
 */
export function slotKey(bundle, file, part) {
  return `${bundle}/${file}|${part}`
}

/**
 * 把映射表变量名还原成模块文件名（缺少 tagId 时的兜底）。
 *
 * `AppFrame_module_css_default` → `AppFrame.module.css`。
 * 还原不出来返回 null：宁可不定位，也不能猜错模块 —— 猜错就是给别的组件上色。
 *
 * @param {string | null} tableName
 * @returns {string | null}
 */
function tableToFile(tableName) {
  if (typeof tableName !== 'string') return null
  const match = /^(.+?)_module_css(?:_default)?$/.exec(tableName)
  if (!match) return null
  return `${match[1]}.module.css`
}

/**
 * 从一份宿主 bundle 源码里抽出「模块槽位」索引。
 *
 * @param {string} source - bundle 源码。
 * @param {string} bundle - bundle 名（去掉 `dsh-client-ui-` 前缀）。
 * @param {{ slots?: Map<string, string>, owners?: Map<string, Set<string>> }} [into]
 *   - `slots`：`bundle/file|part` → 当前构建的类名；
 *   - `owners`：part → 使用它的模块槽位集合（唯一性判定用）。
 * @returns {{ slots: Map<string, string>, owners: Map<string, Set<string>> }}
 */
export function collectMappings(source, bundle, into = {}) {
  const slots = into.slots instanceof Map ? into.slots : new Map()
  const owners = into.owners instanceof Map ? into.owners : new Map()
  if (typeof source !== 'string' || source === '') return { slots, owners }

  const tags = []
  const tables = []
  for (const match of source.matchAll(MODULE_TAG_RE)) tags.push({ at: match.index, value: match[1] })
  for (const match of source.matchAll(MAPPING_HEADER_RE)) tables.push({ at: match.index, value: match[1] })
  if (tags.length === 0 && tables.length === 0) return { slots, owners }

  /** 偏移量之前最近的 tagId（模块文件）。 */
  const nearestTag = (offset) => {
    let found = null
    for (const tag of tags) {
      if (tag.at > offset) break
      found = tag.value
    }
    return found
  }
  /** 偏移量之前最近的映射表变量名。 */
  const nearestTable = (offset) => {
    let found = null
    for (const table of tables) {
      if (table.at > offset) break
      found = table.value
    }
    return found
  }

  for (const match of source.matchAll(MAPPING_ENTRY_RE)) {
    const part = match[1]
    const className = match[2]
    const split = splitModuleClass(className)
    // 值必须真的以 `_part` 结尾：这条判据把「恰好长得像类名的普通字符串」
    // （版本号、URL、i18n key 里带下划线的词）挡在外面。
    if (!split || split.part !== part) continue

    const file = nearestTag(match.index) ?? tableToFile(nearestTable(match.index))
    if (file === null) continue
    const key = slotKey(bundle, file, part)
    slots.set(key, className)

    let owner = owners.get(part)
    if (!owner) {
      owner = new Set()
      owners.set(part, owner)
    }
    owner.add(key)
  }

  return { slots, owners }
}

/**
 * 读 asar 归档。
 *
 * 只依赖 asar 的公开格式（8 字节 pickle 头 + JSON 目录树 + 顺序数据区），
 * 不要求运行在 Electron 主进程里 —— CI 的普通 Node 也能据此做校验。
 *
 * @param {string} asarPath
 * @returns {{ read(entryPath: string): string | null, list(substring: string): string[] } | null}
 */
export function openAsar(asarPath) {
  let fd
  try {
    fd = openSync(asarPath, 'r')
    // Electron 把 asar 挂成一个虚拟目录：对它 open 能成功，但读到的是空文件，
    // 目录项不可遍历，`stat` 的 size 也是 0。此时必须改走 fs 的 asar 透明读取。
    const stat = fstatSync(fd)
    if (stat.size === 0) {
      closeSync(fd)
      fd = undefined
      return null
    }
    const sizeBuf = Buffer.alloc(8)
    readSync(fd, sizeBuf, 0, 8, 0)
    const headerPickleSize = sizeBuf.readUInt32LE(4)
    if (headerPickleSize <= 0 || headerPickleSize > 64 * 1024 * 1024) throw new Error('asar header size')
    const headerPickle = Buffer.alloc(headerPickleSize)
    readSync(fd, headerPickle, 0, headerPickleSize, 8)
    const headerStringSize = headerPickle.readUInt32LE(4)
    const header = JSON.parse(headerPickle.subarray(8, 8 + headerStringSize).toString('utf8'))
    const dataOffset = 8 + headerPickleSize

    const entries = new Map()
    const walk = (node, prefix) => {
      for (const [name, value] of Object.entries(node.files ?? {})) {
        const full = `${prefix}/${name}`
        if (value.files) walk(value, full)
        else if (typeof value.size === 'number') entries.set(full, { size: value.size, offset: Number(value.offset) })
      }
    }
    walk(header, '')

    return {
      list(substring) {
        return [...entries.keys()].filter((key) => key.includes(substring))
      },
      read(entryPath) {
        const entry = entries.get(entryPath)
        if (!entry) return null
        const buf = Buffer.alloc(entry.size)
        readSync(fd, buf, 0, entry.size, dataOffset + entry.offset)
        return buf.toString('utf8')
      },
    }
  } catch {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // 关闭失败不影响结论：本函数已经准备返回 null。
      }
    }
    return null
  }
}

/** 从 bundle 文件路径里取出 bundle 名。 */
export function bundleNameOf(path) {
  const match = /([^/\\]+)[/\\]lib[/\\]client\.js$/.exec(path)
  if (!match) return null
  const name = match[1]
  return name.startsWith(UI_BUNDLE_PREFIX) ? name.slice(UI_BUNDLE_PREFIX.length) : null
}

/**
 * 候选宿主根：按「最可能是当前正在运行的这份构建」排序。
 *
 * 四种安装形态都要覆盖，否则探测会静默退化（主题悄悄回到「只认写死的哈希」）：
 *
 * 1. **桌面版（Electron 主进程）**：`process.resourcesPath` 直接指向 `resources`；
 * 2. **桌面版（宿主 fork 出的普通 Node 子进程）**：argv 里带着 `…/app.asar/dsh/…`；
 * 3. **Web 版**：`node <prefix>/node_modules/@deepseek-ai/dsh/lib/bin.js web`，
 *    UI 包在 `<dsh>/node_modules/@deepseek-ai/` 下；
 * 4. **解包目录**：Electron 允许 `resources/app` 作为 asar 的替代。
 *
 * @returns {string[]}
 */
export function hostRootCandidates() {
  const roots = []
  const push = (value) => {
    if (typeof value !== 'string' || value === '') return
    if (!roots.includes(value)) roots.push(value)
  }

  /** 从一个文件路径出发，逐级向上找 `node_modules/@deepseek-ai`。 */
  const pushScopeAncestors = (from) => {
    if (typeof from !== 'string' || from === '') return
    let dir = dirname(from)
    for (let depth = 0; depth < 7; depth += 1) {
      push(join(dir, 'node_modules', '@deepseek-ai'))
      // dsh 把前端依赖装在自己的 node_modules 里。
      push(join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'))
      const next = dirname(dir)
      if (next === dir) break
      dir = next
    }
  }

  /** 从一个可执行文件/脚本路径出发，找桌面版的 asar。 */
  const pushAsarAncestors = (from) => {
    if (typeof from !== 'string' || from === '') return
    const dir = dirname(from)
    push(join(dir, 'resources', 'app.asar'))
    push(join(dirname(dir), 'resources', 'app.asar'))
    push(join(dir, 'app.asar'))
  }

  /**
   * 从一个**位于 asar 内部的脚本路径**取出 asar 本身的路径。
   *
   * 真实 dsh 进程就是这样启动的：
   *   `<electron> --expose-internals .../resources/app.asar/dsh/node_modules/.../bin.js`
   * 这里 argv[1] 直接落在 asar 里面，`dirname` 往上爬只会在 asar 内部打转，
   * 永远拼不出 `resources/app.asar`。必须按 `.asar` 后缀把前缀切出来。
   */
  const pushAsarOfScript = (from) => {
    if (typeof from !== 'string' || from === '') return
    const at = from.indexOf('.asar')
    if (at <= 0) return
    // 兼容 `…/app.asar` 与 `…/app.asar.unpacked` 两种写法。
    push(from.slice(0, at + 5))
  }

  if (typeof process !== 'undefined' && typeof process.resourcesPath === 'string') {
    push(join(process.resourcesPath, 'app.asar'))
    push(join(process.resourcesPath, 'app'))
  }
  if (process.env?.DSH_APP_ASAR) push(process.env.DSH_APP_ASAR)
  // 桌面版把真正的 Electron 可执行文件通过该变量交给子进程（见 runtime/bin/node）。
  // 处于 `ELECTRON_RUN_AS_NODE` 形态时 execPath 是它是 node shim，拿不到 resources。
  pushAsarAncestors(process.env?.DSH_DESKTOP_NODE_EXECUTABLE)
  // 宿主以 `<electron> <...>/app.asar/dsh/...` 启动时，argv 里就带着 asar 路径。
  for (const arg of process.argv ?? []) pushAsarOfScript(arg)
  pushAsarAncestors(process.execPath)
  pushAsarOfScript(process.argv?.[1])
  pushAsarAncestors(process.argv?.[1])
  pushScopeAncestors(process.execPath)
  pushScopeAncestors(process.argv?.[1])
  pushScopeAncestors(fileURLToPath(import.meta.url))
  return roots
}

/** 读文本文件（独立出来便于测试替换）。 */
function readFileUtf8(path) {
  const fd = openSync(path, 'r')
  try {
    const { size } = statSync(path)
    const buf = Buffer.alloc(size)
    readSync(fd, buf, 0, size, 0)
    return buf.toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/**
 * 判断当前进程是否是 Electron（无论主进程、渲染进程还是 `ELECTRON_RUN_AS_NODE`）。
 *
 * Electron 会全局安装 asar 支持：`app.asar` 及其内部文件可以**当普通路径**读，
 * 而原始字节读（`openSync(asar, 'r')`）拿到的是空内容。两者必须走不同分支。
 *
 * @returns {boolean}
 */
export function isElectronRuntime() {
  return typeof process !== 'undefined'
    && typeof process.versions?.electron === 'string'
    && process.versions.electron !== ''
}

/**
 * 通过 fs 的 asar 透明读取，枚举一个 asar 里的 UI bundle。
 *
 * Electron 把 asar 当目录，所以 `readdirSync('<...>/app.asar/dsh/node_modules/@deepseek-ai')`
 * 直接可用，不需要自己解析 asar 二进制。这是桌面版里唯一可行的路径。
 *
 * @param {string} asarPath
 * @returns {Array<{ path: string, text: string }>}
 */
function readBundlesViaFs(asarPath) {
  const out = []
  const candidates = [
    join(asarPath, 'dsh', 'node_modules', '@deepseek-ai'),
    join(asarPath, 'node_modules', '@deepseek-ai'),
  ]
  for (const scopeDir of candidates) {
    if (!existsSync(scopeDir)) continue
    let names
    try {
      names = readdirSync(scopeDir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.startsWith(UI_BUNDLE_PREFIX)) continue
      const file = join(scopeDir, name, 'lib', 'client.js')
      try {
        if (!statSync(file).isFile()) continue
      } catch {
        continue
      }
      let text
      try {
        text = readFileUtf8(file)
      } catch {
        continue
      }
      if (typeof text === 'string' && text !== '') out.push({ path: file, text })
    }
  }
  return out
}

/**
 * 解析出一个宿主根里的全部 UI bundle 源码。
 *
 * @param {string} root
 * @returns {Array<{ path: string, text: string }>}
 */
function readBundleSources(root) {
  if (typeof root !== 'string' || root === '') return []

  let asarPath = null
  if (root.endsWith('.asar')) asarPath = root
  else if (existsSync(join(root, 'app.asar'))) asarPath = join(root, 'app.asar')

  if (asarPath !== null) {
    if (!existsSync(asarPath)) return []
    // Electron 下 asar 被挂成目录：必须走 fs 透明读取。
    if (isElectronRuntime()) {
      const viaFs = readBundlesViaFs(asarPath)
      if (viaFs.length > 0) return viaFs
    }
    const asar = openAsar(asarPath)
    if (!asar) return []
    const out = []
    for (const entryPath of asar.list(`/${UI_BUNDLE_PREFIX}`)) {
      if (!entryPath.endsWith('/lib/client.js')) continue
      if (!bundleNameOf(entryPath)) continue
      const text = asar.read(entryPath)
      if (text) out.push({ path: entryPath, text })
    }
    return out
  }

  // 普通目录：Web 版是 `@deepseek-ai/dsh-client-ui-*`。
  const out = []
  const scan = (scopeDir) => {
    if (!existsSync(scopeDir)) return
    let names
    try {
      names = readdirSync(scopeDir)
    } catch {
      return
    }
    for (const name of names) {
      if (!name.startsWith(UI_BUNDLE_PREFIX)) continue
      const file = join(scopeDir, name, 'lib', 'client.js')
      try {
        if (!statSync(file).isFile()) continue
      } catch {
        continue
      }
      out.push({ path: file, text: null })
    }
  }
  scan(join(root, 'node_modules', '@deepseek-ai'))
  scan(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'))
  if (root.endsWith('@deepseek-ai')) scan(root)
  for (const item of out) {
    try {
      item.text = readFileUtf8(item.path)
    } catch {
      item.text = null
    }
  }
  return out.filter((item) => typeof item.text === 'string')
}

/**
 * 探测当前宿主的 CSS Modules 索引。
 *
 * @param {{ roots?: string[] }} [options] - 显式候选根，便于测试注入。
 * @returns {{ slots: Map<string, string>, owners: Map<string, Set<string>> }}
 *   - `slots`：`bundle/file.module.css|part` → 当前构建的类名；
 *   - `owners`：part → 使用它的槽位集合。
 */
export function detectHostModules(options = {}) {
  const empty = { slots: new Map(), owners: new Map() }
  const roots = Array.isArray(options.roots) && options.roots.length > 0
    ? options.roots
    : hostRootCandidates()

  for (const root of roots) {
    if (typeof root !== 'string' || root === '') continue
    const absolute = isAbsolute(root) ? root : resolve(root)
    if (!existsSync(absolute)) continue
    const sources = readBundleSources(absolute)
    if (sources.length === 0) continue

    const slots = new Map()
    const owners = new Map()
    for (const source of sources) {
      const bundle = bundleNameOf(source.path)
      if (!bundle) continue
      collectMappings(source.text, bundle, { slots, owners })
    }
    if (slots.size > 0) return { slots, owners }
  }
  return empty
}

/**
 * 判定某个部件名是否「整个宿主只有一处使用」。
 *
 * 只有唯一部件名才能在缺少模块归属信息时安全推导：`root`（37 处）、`title`（36 处）
 * 这类多义名字一旦补全，主题规则会糊到整个应用上。
 *
 * @param {{ owners: Map<string, Set<string>> }} index
 * @param {string} part
 * @returns {string} 唯一时的类名，否则空串。
 */
export function uniqueOwnerClass(index, part) {
  const owner = index?.owners?.get?.(part)
  if (!owner || owner.size !== 1) return ''
  const [key] = owner
  return index.slots.get(key) ?? ''
}

/**
 * 属性选择器里的模块哈希：`[class*="iWlSmW_trigger"]`、`[class~="hHd-Xa_tab"]`。
 *
 * 主题用这种写法来匹配「名字里带某段」的类名（权限触发器、上下文占用表的着色段）。
 * 它和 `.hash_part` 一样含构建哈希，同样会在别的构建里失效 —— 必须一并补全。
 * `[class*="_primary_"]`、`[class~="primary"]` 这类**不含哈希**的写法不匹配这里，
 * 它们本来就是跨构建稳定的。
 */
const ATTR_MODULE_RE = /\[class([*~|^$]?)=\s*"(_?[A-Za-z0-9-][A-Za-z0-9_-]*_[A-Za-z][A-Za-z0-9-]*)"\]/g

/**
 * 解析一个旧类名在当前宿主里的对应类名。
 *
 * 定位顺序（前者失败才走后者）：
 *
 * 1. **静态槽位表**：`hostClassSlots[旧类名]` → `bundle/file|part` → 当前类名。
 *    覆盖主题全部宿主类名，包括 `frame`、`card`、`root` 这些多义部件名；
 * 2. **唯一部件名**：类名不在静态表里时（主题新增了选择器、或宿主新增了模块），
 *    用「该部件名在宿主里唯一」推导。
 *
 * @param {string} token
 * @param {{ slots: Map<string, string>, owners: Map<string, Set<string>> }} index
 * @param {Record<string, string>} hostClassSlots
 * @param {Set<string>} unmatched - 收集「静态表指名的槽位在当前宿主里不存在」的键。
 * @returns {string} 当前宿主的类名，解析不出时为空串。
 */
export function resolveHostClass(token, index, hostClassSlots, unmatched) {
  const slots = index?.slots
  if (!(slots instanceof Map) || slots.size === 0) return ''

  const key = hostClassSlots?.[token]
  if (typeof key === 'string') {
    const mapped = slots.get(key)
    if (mapped !== undefined) return mapped === token ? '' : mapped
    // 静态表认识这个类名，但当前宿主没有这个模块 —— 记下来，由测试报出来。
    unmatched?.add(key)
  }

  const split = splitModuleClass(token)
  if (split === null) return ''
  const unique = uniqueOwnerClass(index, split.part)
  return unique === token ? '' : unique
}

/**
 * 去掉 CSS 注释。
 *
 * 主题的样式表里在注释中大量引用宿主类名（`宿主真实类名：2XZxNq_selector（ui-chat）`）。
 * 这些提及不是选择器，但用同一套正则扫下来会被当成「主题引用了这个类名」，
 * 于是在对照表里留下永远匹配不到的条目、或者让覆盖率检查误报。
 *
 * @param {string} css
 * @returns {string}
 */
export function stripCssComments(css) {
  if (typeof css !== 'string' || css === '') return ''
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ')
}

/**
 * 把一段 CSS 里写死的宿主类名，补全为「包含当前宿主类名」的候选集合。
 *
 * 两种写法都处理：
 * - `.hash_part` 类选择器；
 * - `[class*="hash_part"]` 属性选择器（主题用它匹配「名字里带某段」的类名）。
 *
 * 已有类名一个都不删 —— Web 版与 macOS 桌面版的写法原样保留，
 * 当前构建被追加为并列候选。`:is()` 的特异性取参数最高项，与单类相同（0,1,0），
 * 不会压过社区插件自写的单类规则。
 *
 * @param {string} css
 * @param {{ slots: Map<string, string>, owners: Map<string, Set<string>> }} index
 * @param {Record<string, string>} [hostClassSlots] - 旧类名 → 槽位键。
 * @returns {{ css: string, patched: number, parts: string[], unmatched: string[] }}
 */
export function adaptCssToHost(css, index, hostClassSlots = {}) {
  const none = { css, patched: 0, parts: [], unmatched: [] }
  if (typeof css !== 'string' || css === '') return none
  const slots = index?.slots
  if (!(slots instanceof Map) || slots.size === 0) return none

  // 只改写**选择器区域**：注释里出现的类名是说明文字，动它会破坏可读性，
  // 而且注释里的类名常常是不带前导下划线的简写（`2XZxNq_selector`），
  // 改写后反而与真实类名混淆。
  const segments = []
  let cursor = 0
  for (const comment of css.matchAll(/\/\*[\s\S]*?\*\//g)) {
    segments.push({ text: css.slice(cursor, comment.index), code: true })
    segments.push({ text: comment[0], code: false })
    cursor = comment.index + comment[0].length
  }
  segments.push({ text: css.slice(cursor), code: true })

  const patchedParts = new Set()
  const unmatched = new Set()
  let patched = 0

  const count = (token) => {
    const split = splitModuleClass(token)
    if (split !== null) patchedParts.add(split.part)
    patched += 1
  }

  const rewrite = (source) => {
    // —— 1. 属性选择器：`[class*="hash_part"]` → `:is([class*="…"], [class*="当前"])` ——
    // 必须先做：它的内部不是以 `.` 开头，交给下一步也不会被误伤，但先做能保证
    // `:is(` 前缀检查只针对类选择器。
    let out = source.replace(ATTR_MODULE_RE, (whole, operator, token) => {
      const current = resolveHostClass(token, index, hostClassSlots, unmatched)
      if (current === '') return whole
      count(token)
      return `:is(${whole}, [class${operator}="${current}"])`
    })

    // —— 2. 类选择器：`.hash_part` → `:is(.hash_part, .当前)` ——
    out = out.replace(
      /\.(_?[A-Za-z0-9-][A-Za-z0-9_-]*_[A-Za-z][A-Za-z0-9-]*)(?![\w-])/g,
      (whole, token, offset) => {
        if (splitModuleClass(token) === null) return whole
        const current = resolveHostClass(token, index, hostClassSlots, unmatched)
        if (current === '') return whole
        // 已经包在 `:is(` / `:where(` 里的类名不重复包裹。
        const before = out.slice(Math.max(0, offset - 5), offset)
        if (before.endsWith(':is(') || before.endsWith(':where(')) return whole
        count(token)
        // 逗号不能少：`:is(.a.b)` 是「同时带 a 和 b 两个类」，一个都命中不了。
        return `:is(${whole}, .${current})`
      },
    )
    return out
  }

  const output = segments.map((segment) => (segment.code ? rewrite(segment.text) : segment.text)).join('')

  return { css: output, patched, parts: [...patchedParts].sort(), unmatched: [...unmatched].sort() }
}
