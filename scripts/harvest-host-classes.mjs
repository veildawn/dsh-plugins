// 从 DSH 宿主 asar 抽取全部 dsh-client-ui-* 的 CSS Module 类名，生成主题防腐测试的 fixture。
// 只在宿主升级后手动执行：node scripts/harvest-host-classes.mjs
import { closeSync, openSync, readSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outFile = resolve(here, '../plugins/dsh-zcode-theme/test/fixtures/host-classes.json')

const asarPath =
  process.argv[2] ?? resolve(process.env.DSH_APP_ASAR ?? 'D:/Program Files/DSH/resources/app.asar')

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
  const classes = new Set()
  // 哈希段可能带连字符（如 Hqq-bq_previewBadge），字符类必须放进 -。
  for (const match of text.matchAll(/\._?([A-Za-z0-9][A-Za-z0-9-]{3,10}_[A-Za-z][A-Za-z0-9]*)/g)) {
    classes.add(match[1])
  }
  byBundle[matched[1]] = [...classes].sort()
}
closeSync(fd)

const payload = {
  // 宿主版本：用于人工核对 fixture 是否过期。
  note: '由 scripts/harvest-host-classes.mjs 从 DSH app.asar 抽取，勿手改；宿主升级后重跑。',
  bundles: byBundle,
}

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, `${JSON.stringify(payload, null, 1)}\n`)

const total = Object.values(byBundle).reduce((sum, list) => sum + list.length, 0)
console.log(`写入 ${outFile}`)
console.log(`bundle 数 ${Object.keys(byBundle).length}，类名 ${total} 个`)
