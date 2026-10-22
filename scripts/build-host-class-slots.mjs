/**
 * 生成「旧宿主类名 → 模块槽位」对照表。
 *
 * 主题 CSS 里写死的类名来自两套构建（Web 版、macOS 桌面版）。要把它映射到**当前**
 * 宿主的类名，必须先知道每个旧类名属于哪个模块 —— 只有 `bundle + 模块文件名 + 部件名`
 * 这个三元组是跨构建稳定的，单靠部件名会张冠李戴（`root` 在宿主里有 37 个）。
 *
 * 输入是仓库共享的宿主类名快照 `test/fixtures/host-classes.json`，它的 `modules`
 * 段按 `bundle → 模块文件 → { desktop, web } → { part: className }` 记录了两套构建的
 * 完整映射，正好是建立这张对照表所需的全部信息。
 *
 * 注意快照里还混着**不是类名**的条目：`accessibility.module.css` 这类模块的映射值
 * 是 i18n 文案（`"已完成"`、`"{count} 次工具调用"`）。它们由同一套「抽 `"k": "v"``
 * 的采集逻辑顺带收进来，必须在这里静默跳过——判据交给共享的 `splitModuleClass()`，
 * 与运行时改写 CSS 时用的是同一份规则。
 *
 * 产物 `lib/host-class-slots.js` 是源码的一部分（随插件发布）：运行时只做
 * 「旧类名 → 槽位键 → 当前类名」两次查表，不需要在宿主上做任何文本扫描。
 *
 * 用法（仓库根目录执行）：
 *   node scripts/build-host-class-slots.mjs            # 写入 lib/host-class-slots.js
 *   node scripts/build-host-class-slots.mjs --check    # 只校验产物是否过期
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { splitModuleClass, stripCssComments } from '../plugins/dsh-theme-studio/lib/host-modules.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const pluginRoot = join(repoRoot, 'plugins', 'dsh-theme-studio')
const fixturePath = join(repoRoot, 'test', 'fixtures', 'host-classes.json')
const outPath = join(pluginRoot, 'lib', 'host-class-slots.js')
const checkOnly = process.argv.includes('--check')

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))

/** 旧类名 → 槽位键。同一类名在 desktop / web 两侧必须指向同一槽位。 */
const slots = new Map()
/** 真冲突：同一个类名被两套构建指到不同槽位（说明快照自相矛盾）。 */
const conflicts = []
/** 静默跳过的非类名条目数（i18n 文案）。 */
let skipped = 0

for (const [bundle, files] of Object.entries(fixture.modules ?? {})) {
  for (const [file, kinds] of Object.entries(files)) {
    for (const side of ['desktop', 'web']) {
      const map = kinds?.[side]
      if (!map) continue
      for (const [part, value] of Object.entries(map)) {
        const split = splitModuleClass(value)
        // 不是类名（i18n 文案、版本号等）—— 与主题无关，跳过。
        if (split === null) {
          skipped += 1
          continue
        }
        // 映射表 key 与类名尾段必须一致，否则说明这条映射被采错了位置。
        if (split.part !== part) {
          skipped += 1
          continue
        }
        const key = `${bundle}/${file}|${part}`
        const previous = slots.get(value)
        if (previous !== undefined && previous !== key) {
          conflicts.push(`${value} 同时指向 ${previous} 与 ${key}`)
          continue
        }
        slots.set(value, key)
      }
    }
  }
}

if (conflicts.length > 0) {
  console.error('宿主类名快照存在无法消解的冲突：')
  for (const line of conflicts) console.error('  ' + line)
  process.exit(1)
}
if (slots.size === 0) {
  console.error('没有解析出任何宿主类名，快照可能已损坏：' + fixturePath)
  process.exit(1)
}

const sorted = [...slots.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
const bundleNames = new Set(sorted.map(([, key]) => key.slice(0, key.indexOf('/'))))

/**
 * 随包发布的只有**主题真正用到**的那部分。
 *
 * 完整表有 4300+ 条（300KB+），但主题 CSS 里最多引用 130 来个宿主类名。
 * 其余条目运行时永远查不到，只是白白撑大插件包、拖慢启动时的 JSON 解析。
 *
 * 判据是「主题的 CSS 源文件里出现过这个完整类名」——按完整类名而不是按部件名匹配，
 * 因为 `root`、`title`、`card` 这类部件名在宿主里有几十个，按部件名会把整张表拉回来。
 *
 * ## 前导下划线必须原样保留
 *
 * 宿主给「以数字开头的类名」生成 `._2XZxNq_selector`（CSS Modules 加前导下划线），
 * DOM 上的 className 就是 `_2XZxNq_selector`，主题 CSS 里也写成 `._2XZxNq_selector`。
 *
 * 提取 token 时**不能**把这里的前导下划线当可选前缀吃掉：`.2XZxNq_selector` 是另一个
 * 类名（不存在），拿它查表必然落空，那批规则就被静默裁掉。实测这个写法漏过
 * `_2XZxNq_selector`、`_7KE1Ra_trigger` 等条目 —— 主题照样加载、也不报错，
 * 只是这些部件在桌面版上不生效。
 *
 * 所以正则的前导 `.` 显式可选，下划线一定属于 token。
 */
function referencedByThemeSlots() {
  const styleDir = join(pluginRoot, 'lib', 'styles')
  const referenced = new Set()
  for (const name of readdirSync(styleDir)) {
    if (!name.endsWith('.css')) continue
    // 注释里提到的类名是说明文字，不是选择器 —— 必须先剥掉，否则会往对照表里
    // 塞进一批永远匹配不到的条目，或让覆盖率检查误报。
    const text = stripCssComments(readFileSync(join(styleDir, name), 'utf8'))
    // 三种写法都要覆盖：`.hash_part`、`._hash_part`、`[class*="hash_part"]`。
    for (const match of text.matchAll(/\.?(_?[A-Za-z0-9-][A-Za-z0-9_-]*_[A-Za-z][A-Za-z0-9-]*)/g)) {
      const token = match[1]
      if (slots.get(token) !== undefined) referenced.add(token)
    }
  }
  // 兜底：主题以后新增了选择器但没重建这张表时，运行时还能靠「唯一部件名」推导，
  // 所以这里只裁剪、不保证完备 —— 完备性由 test/host-modules.test.mjs 的
  // 「静态对照表覆盖主题引用的每一个宿主类名」那条判据守护。
  return new Map([...referenced].map((token) => [token, slots.get(token)]))
}

const shipped = referencedByThemeSlots()
if (shipped.size === 0) {
  console.error('主题 CSS 里没有匹配到任何宿主类名，slot 表的裁剪判据已失效')
  process.exit(1)
}
const shippedSorted = [...shipped.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
const shippedBundleNames = new Set(shippedSorted.map(([, key]) => key.slice(0, key.indexOf('/'))))

const banner = `/**
 * 自动生成，请勿手改。
 *
 * 生成器：\`node scripts/build-host-class-slots.mjs\`（仓库根目录执行）
 * 数据源：\`test/fixtures/host-classes.json\`（由 \`scripts/harvest-host-classes.mjs\` 采集）
 *
 * 这张表回答一个问题：主题 CSS 里写死的 \`.<hash>_<part>\`，属于宿主的哪个模块？
 *
 * ## 为什么需要它
 *
 * 宿主每次构建都会重新生成 CSS Modules 的哈希前缀。同一个组件在 Web 版、macOS 桌面版、
 * Windows 桌面版里是三个完全不同的类名（例如 \`AppFrame.centerCol\` 分别是
 * \`pI_x6G_centerCol\`、\`_LS25G_centerCol\`、\`BynINW_centerCol\`）。主题只能把其中两套
 * 写进 CSS，第三套就一条规则都命中不了，而且不会报错。
 *
 * 而 \`bundle + 模块文件名 + 部件名\` 这个三元组跨构建稳定 —— 拿到它，就能在当前宿主里
 * 查回正确的类名。
 *
 * ## 为什么必须精确到模块文件
 *
 * 只按部件名匹配会张冠李戴：\`root\` 在宿主里有 37 个模块在用、\`title\` 有 36 个、
 * \`card\` 有 21 个。精确到模块文件后，主题引用的每个类名都能唯一对上目标。
 *
 * @module dsh-theme-studio/host-class-slots
 */

/** 旧宿主类名 → \`bundle/模块文件|部件名\`。共 ${shippedSorted.length} 条，覆盖 ${shippedBundleNames.size} 个 bundle。 */
export const HOST_CLASS_SLOTS = Object.freeze(${JSON.stringify(Object.fromEntries(shippedSorted), null, 2)})

export default HOST_CLASS_SLOTS
`

if (checkOnly) {
  let current = null
  try {
    current = readFileSync(outPath, 'utf8')
  } catch {
    current = null
  }
  if (current !== banner) {
    console.error(`${outPath} 已过期，请重新生成：node scripts/build-host-class-slots.mjs`)
    process.exit(1)
  }
  console.log(`host-class-slots 产物是最新的（${shippedSorted.length} 条）`)
  process.exit(0)
}

writeFileSync(outPath, banner)
console.log(`写入 ${outPath}`)
console.log(
  `随包发布 ${shippedSorted.length} 条（主题实际引用），`
  + `快照共 ${sorted.length} 条，覆盖 ${shippedBundleNames.size} 个 bundle（跳过非类名条目 ${skipped} 条）`,
)
