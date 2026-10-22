// 从 DSH 前端抽取全部 dsh-client-ui-* 的 CSS Module 类名，生成仓库共享的 fixture。
// 使用者：dsh-theme-studio 的类名存活测试与「旧类名 → 模块槽位」对照表、
// dsh-mobile-adapter 的语义化改造与存活测试、dsh-zcode-theme 的兼容薄壳。
// 只在宿主升级后手动执行。
//
// 用法：
//   node scripts/harvest-host-classes.mjs                     # 默认读桌面版 app.asar（按平台推导路径）
//   node scripts/harvest-host-classes.mjs <app.asar>          # 指定 asar
//   node scripts/harvest-host-classes.mjs --all               # 桌面版 + Web 版一起采（推荐）
//   node scripts/harvest-host-classes.mjs --web              # 读 dsh web 的 node_modules
//   node scripts/harvest-host-classes.mjs --web <dsh-scope>  # 指定 @deepseek-ai 目录
//
// 环境变量：
//   DSH_APP_ASAR   显式指定桌面版 app.asar（非常规安装路径时用）
//   DSH_WEB_SCOPE  显式指定 Web 版的 @deepseek-ai 目录
//
// 为什么有两种来源：桌面版（Electron，前端打在 app.asar 里）与 Web 版（`dsh web`，
// 前端在 node_modules/@deepseek-ai/dsh-client-ui-*）是**两次独立构建**，CSS Module
// 哈希完全不同（同一时期桌面是 `BynINW_centerCol`、Web 是 `pI_x6G_centerCol`）。
// 主题要同时兼容两侧，fixture 就得把两套都收进来。
//
// 采集完之后**必须**再跑一次 `node scripts/build-host-class-slots.mjs`：
// 主题的跨构建定位靠的就是这张由 fixture 推导出的对照表。
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outFile = resolve(here, '../test/fixtures/host-classes.json')

/**
 * CSS Module 类名提取。
 *
 * 前缀由「两段 + 下划线」组成（`pI_x6G_frame` → 前缀 `pI_x6G`，部件名 `frame`），
 * 两段都可能是 1~2 个字符。旧正则要求首段至少 4 字符，会把 layout 这类
 * 2 字符前缀的 bundle 整个采成空集——fixture 里是 `[]`，测试于是「校验通过」，
 * 而主题的 `.BynINW_frame` 等规则在 Web 版全部失效。
 * 2026-10 的发送按钮白底白图标就是这条链路的后果。
 *
 * 前导下划线是**真实类名的一部分**，不是 CSS 转义技巧：CSS Modules 对以数字开头的
 * 类名会生成 `._7yHdaG_header`，DOM 上的 className 也是 `_7yHdaG_header`
 * （见各 bundle 里的 `{ "header": "_7yHdaG_header" }` 映射表）。
 * 因此这里两种写法都收，避免 fixture 与真实 className 只有一个能对上。
 */
const CLASS_RE = /\._?([A-Za-z0-9][A-Za-z0-9_-]*_[A-Za-z][A-Za-z0-9]*)/g

/** 从一段源码文本里收集类名。 */
function classesOf(text) {
  const classes = new Set()
  for (const match of text.matchAll(CLASS_RE)) {
    classes.add(match[1])
    if (/^[0-9]/.test(match[1])) classes.add('_' + match[1])
  }
  return [...classes].sort()
}

/**
 * 抽出 `{ "module.css": { part: "Hash_part" } }`。
 *
 * 只看 `.Hash_part` 的文本无法判断两个构建里哪两条是「同一个部件」：一个 bundle
 * 里有十几个 `root`、几十个 `title`，按后缀配对会张冠李戴。CSS Modules 在每个
 * 组件文件顶部留下 `const tagId = "@deepseek-ai/<bundle>/<file>.module.css"`，
 * 紧跟一份 `{ part: className }` 映射表——它是 JSX 真正使用的 className，
 * 拿它当配对键（bundle + 文件 + part）才是精确的。
 */
function modulesOf(text) {
  const out = {}
  const anchors = [...text.matchAll(/const tagId(?:\$\d+)? = "@deepseek-ai\/dsh-client-ui-[^"/]+\/([^"]+\.module\.css)";/g)]
  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i].index
    const end = i + 1 < anchors.length ? anchors[i + 1].index : text.length
    const chunk = text.slice(start, end)
    const block = chunk.match(/\{\s*\n((?:\s*"[^"]+":\s*"[^"]+",?\s*\n)+)\s*\};/)
    if (!block) continue
    const map = {}
    for (const pair of block[1].matchAll(/"([^"]+)":\s*"([^"]+)"/g)) map[pair[1]] = pair[2]
    if (Object.keys(map).length > 0) out[anchors[i][1]] = map
  }
  return out
}

/** 从 app.asar 读出 `{ bundle: { classes[], modules{} } }`。 */
function harvestAsar(asarPath) {
  const fd = openSync(asarPath, 'r')
  const sizeBuf = Buffer.alloc(8)
  readSync(fd, sizeBuf, 0, 8, 0)
  const headerPickleSize = sizeBuf.readUInt32LE(4)
  const headerPickle = Buffer.alloc(headerPickleSize)
  readSync(fd, headerPickle, 0, headerPickleSize, 8)
  const headerStringSize = headerPickle.readUInt32LE(4)
  const header = JSON.parse(headerPickle.subarray(8, 8 + headerStringSize).toString('utf8'))
  const dataOffset = 8 + headerPickleSize

  const entries = []
  function walk(node, prefix) {
    for (const [name, value] of Object.entries(node.files || {})) {
      const full = `${prefix}/${name}`
      if (value.files) walk(value, full)
      else entries.push({ path: full, size: value.size, offset: value.offset })
    }
  }
  walk(header, '')

  const byBundle = {}
  for (const entry of entries) {
    const matched = entry.path.match(/\/dsh-client-ui-([^/]+)\/lib\/client\.js$/)
    if (!matched) continue
    const buf = Buffer.alloc(entry.size)
    readSync(fd, buf, 0, entry.size, dataOffset + Number(entry.offset))
    const text = buf.toString('utf8')
    byBundle[matched[1]] = { classes: classesOf(text), modules: modulesOf(text) }
  }
  closeSync(fd)
  return byBundle
}

/** 从 Web 版 `@deepseek-ai` 目录读出 `{ bundle: { classes[], modules{} } }`。 */
function harvestWeb(scopeDir) {
  const byBundle = {}
  for (const name of readdirSync(scopeDir)) {
    if (!name.startsWith('dsh-client-ui-')) continue
    const file = join(scopeDir, name, 'lib', 'client.js')
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    byBundle[name.replace('dsh-client-ui-', '')] = { classes: classesOf(text), modules: modulesOf(text) }
  }
  return byBundle
}

/**
 * 合并多份来源。
 *
 * 类名取并集（存活校验需要两套哈希都算「存在」），但模块映射必须**按构建来源
 * 分开存**：桌面版与 Web 版对同一个 `InputBar.module.css` 都有 `primary`，
 * 合成一个对象时后写的会把先写的覆盖掉，配对信息就丢了。
 */
function mergeInto(target, source, kind) {
  for (const [bundle, value] of Object.entries(source)) {
    const slot = (target[bundle] ??= { classes: new Set(), modules: {} })
    for (const cls of value.classes) slot.classes.add(cls)
    for (const [file, map] of Object.entries(value.modules)) {
      slot.modules[file] = { ...(slot.modules[file] ?? {}), [kind]: map }
    }
  }
}

const args = process.argv.slice(2)
const sources = []

/** 默认的桌面版 app.asar 位置：按平台给出，并允许环境变量覆盖。 */
function defaultDesktopAsar() {
  if (process.env.DSH_APP_ASAR) return process.env.DSH_APP_ASAR
  if (process.platform === 'darwin') {
    return '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'
  }
  if (process.platform === 'win32') {
    // Windows 安装版默认在 %LOCALAPPDATA%\Programs，也常见于任意盘符的自定义目录。
    const local = process.env.LOCALAPPDATA
    const candidates = [local && join(local, 'Programs', 'DeepSeek Harness', 'resources', 'app.asar')]
    for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate
    return candidates[0]
  }
  return '/opt/DeepSeek Harness/resources/app.asar'
}

/**
 * Web 版 `@deepseek-ai` 目录：从 node 可执行文件向上找。
 *
 * 之前只认 `nvm` 的 `lib/node_modules`，Windows 的全局安装（`%APPDATA%\npm\node_modules`
 * 或 `D:\Apps\nodejs\node_modules`）一律命中不了，于是 `--all` 在 Windows 上永远只采到
 * 桌面版，fixture 的 `web` 一侧是空的 —— 主题的「双构建孪生」测试于是拿不到对照。
 */
function defaultWebScope() {
  if (process.env.DSH_WEB_SCOPE) return process.env.DSH_WEB_SCOPE
  let dir = dirname(process.execPath)
  for (let depth = 0; depth < 6; depth += 1) {
    const candidates = [
      join(dir, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'),
      join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'),
      join(dir, 'lib', 'node_modules', '@deepseek-ai'),
      join(dir, 'node_modules', '@deepseek-ai'),
    ]
    for (const candidate of candidates) {
      // 目录存在还不够：`@deepseek-ai` 可能是被别的包顺带建出来的空壳，
      // 真正的 UI 包要看里面有没有 `dsh-client-ui-*`。
      if (!existsSync(candidate)) continue
      try {
        if (readdirSync(candidate).some((name) => name.startsWith('dsh-client-ui-'))) return candidate
      } catch {
        // 读不到就当它不适用，继续找下一个候选。
      }
    }
    const next = dirname(dir)
    if (next === dir) break
    dir = next
  }
  return join(dirname(process.execPath), 'lib', 'node_modules', '@deepseek-ai')
}

// --all：桌面版与 Web 版同时采集并合并（推荐，主题要同时兼容两侧）。
if (args.includes('--all')) {
  const webScope = defaultWebScope()
  const asarPath = defaultDesktopAsar()
  if (existsSync(asarPath)) sources.push({ kind: 'desktop', label: asarPath, data: harvestAsar(asarPath) })
  else console.warn(`跳过桌面版（找不到 ${asarPath}）`)
  if (existsSync(webScope)) sources.push({ kind: 'web', label: webScope, data: harvestWeb(webScope) })
  else console.warn(`跳过 Web 版（找不到 ${webScope}）`)
} else if (args.includes('--web')) {
  const explicit = args.find((a) => a !== '--web')
  const scopeDir = explicit ?? defaultWebScope()
  if (!existsSync(scopeDir)) {
    console.error(`找不到 Web 版 @deepseek-ai 目录：${scopeDir}`)
    process.exit(1)
  }
  sources.push({ kind: 'web', label: scopeDir, data: harvestWeb(scopeDir) })
} else {
  const asarPath = args[0] ?? defaultDesktopAsar()
  if (!existsSync(asarPath)) {
    console.error(`找不到 app.asar：${asarPath}`)
    console.error('用法：node scripts/harvest-host-classes.mjs [--all | --web] [路径]')
    process.exit(1)
  }
  sources.push({ kind: 'desktop', label: asarPath, data: harvestAsar(asarPath) })
}

const byBundle = {}
for (const source of sources) mergeInto(byBundle, source.data, source.kind)

// 序列化。
// `bundles` 保持「bundle → 类名数组」的形状不变：主题与移动端适配的存活测试都直接
// `Object.values(bundles).flat()` 取全集，改结构会静默改变它们的判据。
// 新增的 CSS Module 映射（两套构建的 part → className 对照）单独放在顶层 `modules`。
const bundles = {}
const modules = {}
for (const [bundle, slot] of Object.entries(byBundle)) {
  bundles[bundle] = [...slot.classes].sort()
  if (Object.keys(slot.modules).length > 0) modules[bundle] = slot.modules
}

const payload = {
  // 来源与宿主版本：用于人工核对 fixture 是否过期。
  note: '由 scripts/harvest-host-classes.mjs 抽取，勿手改；宿主升级后重跑。桌面版与 Web 版哈希不同，两套都要收录。',
  sources: sources.map((s) => ({ kind: s.kind, label: s.label })),
  bundles,
  // 按 bundle + 模块文件 + part 给出两套构建的真实 className，用于校验主题是否
  // 同时覆盖了桌面版与 Web 版（只写一侧时，另一侧的选择器永远不命中）。
  modules,
}

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, `${JSON.stringify(payload, null, 1)}\n`)

const total = Object.values(bundles).reduce((sum, list) => sum + list.length, 0)
const moduleCount = Object.values(modules).reduce((sum, slot) => sum + Object.keys(slot).length, 0)
console.log(`写入 ${outFile}`)
console.log(`bundle 数 ${Object.keys(bundles).length}，类名 ${total} 个，CSS Module 映射 ${moduleCount} 份`)
