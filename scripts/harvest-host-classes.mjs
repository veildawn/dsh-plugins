// 从 DSH 前端抽取全部 dsh-client-ui-* 的 CSS Module 类名，生成仓库共享的 fixture。
// 使用者：dsh-zcode-theme 的类名存活测试、dsh-mobile-adapter 的语义化改造与存活测试。
// 只在宿主升级后手动执行。
//
// 用法：
//   node scripts/harvest-host-classes.mjs                     # 默认读桌面版 app.asar（macOS 路径）
//   node scripts/harvest-host-classes.mjs <app.asar>          # 指定 asar
//   node scripts/harvest-host-classes.mjs --web              # 读 dsh web 的 node_modules
//   node scripts/harvest-host-classes.mjs --web <dsh-scope>  # 指定 @deepseek-ai 目录
//
// 为什么有两种来源：桌面版（Electron，前端打在 app.asar 里）与 Web 版（`dsh web`，
// 前端在 node_modules/@deepseek-ai/dsh-client-ui-*）是**两次独立构建**，CSS Module
// 哈希完全不同（同一时期桌面是 `Qt4Hga_primary`、Web 是 `uV2eYG_primary`）。
// 主题要同时兼容两侧，fixture 就得把两套都收进来。
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

/** 从 app.asar 读出 `{ bundle: classes[] }`。 */
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
    byBundle[matched[1]] = classesOf(buf.toString('utf8'))
  }
  closeSync(fd)
  return byBundle
}

/** 从 Web 版 `@deepseek-ai` 目录读出 `{ bundle: classes[] }`。 */
function harvestWeb(scopeDir) {
  const byBundle = {}
  for (const name of readdirSync(scopeDir)) {
    if (!name.startsWith('dsh-client-ui-')) continue
    const file = join(scopeDir, name, 'lib', 'client.js')
    if (!existsSync(file)) continue
    byBundle[name.replace('dsh-client-ui-', '')] = classesOf(readFileSync(file, 'utf8'))
  }
  return byBundle
}

/** 合并多份来源：同一 bundle 取并集，这样两套哈希都能被测试认可。 */
function mergeInto(target, source) {
  for (const [bundle, list] of Object.entries(source)) {
    const set = new Set([...(target[bundle] ?? []), ...list])
    target[bundle] = [...set].sort()
  }
}

const args = process.argv.slice(2)
const sources = []

// --all：桌面版与 Web 版同时采集并合并（推荐，主题要同时兼容两侧）。
if (args.includes('--all')) {
  const webScope = resolve(
    dirname(process.execPath),
    '../lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai',
  )
  const asarPath = resolve('/Applications/DeepSeek Harness.app/Contents/Resources/app.asar')
  if (existsSync(asarPath)) sources.push({ kind: 'desktop', label: asarPath, data: harvestAsar(asarPath) })
  else console.warn(`跳过桌面版（找不到 ${asarPath}）`)
  if (existsSync(webScope)) sources.push({ kind: 'web', label: webScope, data: harvestWeb(webScope) })
  else console.warn(`跳过 Web 版（找不到 ${webScope}）`)
} else if (args.includes('--web')) {
  const explicit = args.find((a) => a !== '--web')
  const defaultScope = resolve(
    dirname(process.execPath),
    '../lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai',
  )
  const scopeDir = explicit ?? process.env.DSH_WEB_SCOPE ?? defaultScope
  if (!existsSync(scopeDir)) {
    console.error(`找不到 Web 版 @deepseek-ai 目录：${scopeDir}`)
    process.exit(1)
  }
  sources.push({ kind: 'web', label: scopeDir, data: harvestWeb(scopeDir) })
} else {
  const asarPath =
    args[0] ?? process.env.DSH_APP_ASAR ?? resolve('/Applications/DeepSeek Harness.app/Contents/Resources/app.asar')
  if (!existsSync(asarPath)) {
    console.error(`找不到 app.asar：${asarPath}`)
    console.error('用法：node scripts/harvest-host-classes.mjs [--all | --web] [路径]')
    process.exit(1)
  }
  sources.push({ kind: 'desktop', label: asarPath, data: harvestAsar(asarPath) })
}

const byBundle = {}
for (const source of sources) mergeInto(byBundle, source.data)

const payload = {
  // 来源与宿主版本：用于人工核对 fixture 是否过期。
  note: '由 scripts/harvest-host-classes.mjs 抽取，勿手改；宿主升级后重跑。桌面版与 Web 版哈希不同，两套都要收录。',
  sources: sources.map((s) => ({ kind: s.kind, label: s.label })),
  bundles: byBundle,
}

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, `${JSON.stringify(payload, null, 1)}\n`)

const total = Object.values(byBundle).reduce((sum, list) => sum + list.length, 0)
console.log(`写入 ${outFile}`)
console.log(`bundle 数 ${Object.keys(byBundle).length}，类名 ${total} 个`)
