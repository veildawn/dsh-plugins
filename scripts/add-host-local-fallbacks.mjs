// 给移动端适配样式里的宿主 CSS Module 类名加"去哈希兜底"。
//
// 宿主用 CSS Modules，类名是 `<hash>_<local>`，hash 每次构建都可能变。移动端样式
// 直接写完整类名（`.Y0dWHa_details`）时，宿主一升级就静默失效——没有报错、没有日志，
// 只是手机上的适配突然不生效。
//
// 改造方式：把 `.HASH_local` 换成 `:is(.HASH_local,[class$="_local"])`
//   - 保留原类名，当前宿主行为完全不变；
//   - 追加按后缀匹配的兜底，宿主换 hash 后仍能命中；
//   - `:is()` 特异度取最高项，与原来的单类名一致（0,1,0），不会压过社区插件；
//   - 在 `:where()` / `:has()` 内部同样成立，不需要解析选择器结构。
//
// 但不是所有 local 名都能裸兜底：`_root`/`_chevron`/`_trigger` 这类在宿主里被几十个
// 组件共用，裸写 `[class$="_root"]` 会把侧栏内边距糊到整个应用上。所以默认只在
// 「规则已经带了语义作用域」（`[data-slot=…]`、`[data-composer-…]`、`[role=…]`、
// `[aria-…]`）时加兜底——作用域已经把误伤面收窄，宿主换 hash 后仍然命中。
//
// 唯一性判据只在 fixture 来自**单一构建**时可用：桌面版与 Web 版是两次独立构建，
// 同一个组件会有两个哈希（`BynINW_centerCol` / `pI_x6G_centerCol`），合并采集后
// 连 `_centerCol` 都会被算成"重名"。所以多来源 fixture 一律退化为只按作用域加兜底，
// 其余类名交给 fixture 存活测试 + 重跑 harvest 来对齐。
//
// 用法：
//   node scripts/add-host-local-fallbacks.mjs           改写 client.js
//   node scripts/add-host-local-fallbacks.mjs --check   只报告（CI/本地检查用）
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { localUniqueness, normalizeHostClass } from './host-classes.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = resolve(here, '../plugins/dsh-mobile-adapter/lib/client.js')
const fixturePath = resolve(here, '../test/fixtures/host-classes.json')
const checkOnly = process.argv.includes('--check')

/** 语义作用域：规则选择器里已经出现这些钩子时，兜底的误伤面已被收窄。 */
const SCOPED = /\[(?:data-|role=|aria-)/

const source = readFileSync(clientPath, 'utf8')
const CSS_HEAD = 'const css = `'
const CSS_TAIL = '\n    `'
const cssStart = source.indexOf(CSS_HEAD)
if (cssStart === -1) throw new Error('没有找到移动端适配的 css 模板字符串')
const cssEnd = source.indexOf(CSS_TAIL, cssStart)
if (cssEnd === -1) throw new Error('没有找到 css 模板字符串结尾')
const css = source.slice(cssStart, cssEnd)

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
// 只有单来源（单次构建）的 fixture 才能用"local 名唯一"作判据；桌面 + Web 合并后
// 同一组件有多个哈希，唯一性失效，只能靠语义作用域。
const singleBuild = (fixture.sources?.length ?? 1) <= 1
const uniqueness = singleBuild ? localUniqueness(fixture) : new Map()
// 类名字符集要包含 `_`：宿主的 hash 段自身可能带下划线（`pI_x6G_centerCol`），
// 只按 `[A-Za-z0-9-]` 匹配会被截成 `pI_x6G`，兜底就落到了错误的 local 名上。
// 真正的切分交给 normalizeHostClass（从右往左找合法的 local 段）。
const PATTERN = /\.(_?[A-Za-z0-9][A-Za-z0-9_-]*)/g
const FALLBACK_OPEN = ':is('

/** 当前匹配位置所在规则的"选择器头部"：用于判断是否已有语义作用域。 */
function ruleHeadOf(text, offset) {
  const boundary = Math.max(text.lastIndexOf('}', offset), text.lastIndexOf('{', offset))
  const lineStart = text.lastIndexOf('\n', offset)
  return text.slice(Math.max(boundary, lineStart) + 1, offset).trim()
}

let wrapped = 0
let keptUnique = 0
const keptShared = new Set()

const cssOut = css.replace(PATTERN, (whole, token, offset) => {
  const normalized = normalizeHostClass(token)
  if (normalized === undefined) return whole
  if (css.slice(Math.max(0, offset - FALLBACK_OPEN.length), offset) === FALLBACK_OPEN) return whole

  // 取最后一段：hash 自身可能带下划线（`pI_x6G`），第一个下划线后面是 hash 的尾巴。
  const local = normalized.slice(normalized.lastIndexOf('_') + 1)
  const hashes = uniqueness.get(local)?.size ?? 0
  const scoped = SCOPED.test(ruleHeadOf(css, offset))

  if ((singleBuild && hashes === 1) || scoped) {
    wrapped += 1
    if (singleBuild && hashes === 1) keptUnique += 1
    return `:is(${whole},[class$="_${local}"])`
  }
  keptShared.add(local)
  return whole
})

console.log(`已加去哈希兜底 ${wrapped} 处（其中 local 唯一 ${keptUnique} 处）`)
console.log(`未加兜底、仅保留原哈希的 local 名 ${keptShared.size} 个：${[...keptShared].sort().join('、')}`)
if (!singleBuild) console.log('fixture 含多个构建来源，唯一性判据已关闭：只按语义作用域加兜底')

if (checkOnly) {
  // --check 只关心"当前文件是否还有可加而未加的兜底"：有则以非零退出，方便 CI 拦截
  // "新增了宿主类名却没走 :is(...) 兜底"的情况。
  process.exitCode = wrapped === 0 ? 0 : 1
} else {
  writeFileSync(clientPath, source.slice(0, cssStart) + cssOut + source.slice(cssEnd))
  console.log('已写入', clientPath)
}
