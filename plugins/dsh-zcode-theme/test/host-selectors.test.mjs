import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STYLE_FILES } from '../lib/css.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// fixture 由 scripts/harvest-host-classes.mjs 从宿主 app.asar 抽取。
const fixture = JSON.parse(await readFile(join(root, 'test/fixtures/host-classes.json'), 'utf8'))
const hostClasses = new Set(Object.values(fixture.bundles).flat())

async function themeCssSources() {
  const names = (await readdir(join(root, 'lib/styles'))).filter((name) => name.endsWith('.css'))
  assert.deepEqual(names.sort(), [...STYLE_FILES].sort(), 'styles 目录与 STYLE_FILES 不一致')
  const texts = []
  for (const name of names) texts.push(await readFile(join(root, 'lib/styles', name), 'utf8'))
  return texts
}

/**
 * 主题里出现的每一个 CSS Module 类名（形如 `abc123_root` 或 `Hqq-bq_badge`）都必须是
 * 宿主真实存在的类名。宿主升级换了 hash 时，这条测试会先失败，而不是等到用户看见
 * 「主题没生效」才发现。
 *
 * 注意：fixture 记录的是不带前导下划线的类名（`2H3hWW_root`），而 CSS 里合法写法是
 * `._2H3hWW_root`——前导下划线只是为了避开 CSS 的「数字开头必须转义」限制。
 */
test('主题里的 CSS Module 类名全部存在于宿主', async () => {
  const sources = await themeCssSources()
  const missing = []
  for (const text of sources) {
    for (const match of text.matchAll(/\.(_?[A-Za-z0-9][A-Za-z0-9-]{3,10}_[A-Za-z][A-Za-z0-9]*)/g)) {
      const cls = match[1].replace(/^_/, '')
      if (!hostClasses.has(cls)) missing.push(match[1])
    }
  }
  assert.deepEqual([...new Set(missing)], [], `以下类名在宿主不存在，选择器永远不命中：${[...new Set(missing)].join(', ')}`)
})

/**
 * 以数字开头的 CSS Module 类名在 CSS 里必须写成十六进制转义（`\33 `），
 * 写错会让整条规则被浏览器丢弃。主题统一改用 [class*="..."]，这里守护这个约定。
 */
test('数字开头的宿主类名一律用属性选择器，不写 CSS 转义', async () => {
  const sources = await themeCssSources()
  for (const text of sources) {
    assert.equal(/\.\\+[0-9a-fA-F]+\s/.test(text), false, '发现 CSS 十六进制转义类名，请改用 [class*="..."]')
  }
})

/**
 * 社区插件（dsh-plugin-manager 等）自绘主按钮时，底色取 `--dsw-alias-brand-primary`、
 * 文字却硬编码 `#fff`。Zai 主题把 brand-primary 映射成单色（暗色 #ffffff），
 * 两者叠加就是白底白字、按钮「消失」——2026-10 真实出现过一次。
 * 这里锁定「类名含 primary 词元的按钮必须由主题接管前景/背景」。
 */
test('社区插件的 primary 按钮必须同时覆盖背景与前景', async () => {
  const css = await readFile(join(root, 'lib/styles/buttons.css'), 'utf8')
  const rule = css.match(/button\[class~="primary"\][^{]*\{([^}]*)\}/)
  assert.ok(rule, '缺少 button[class~="primary"] 兜底规则')
  assert.match(rule[1], /background:\s*var\(--color-primary\)/)
  assert.match(rule[1], /color:\s*var\(--color-primary-foreground\)/)
  // 必须是词元匹配：class*="primary" 会误伤 primaryButton 之类。
  assert.equal(css.includes('button[class*="primary"]'), false, '请用 [class~="primary"] 词元匹配')
})

/**
 * 社区插件把 --dsw-alias-bg-base 当普通按钮底色，Zai 主题下它是画布黑，
 * 放在 card 上会比卡片更暗、看起来像空洞。锁定次级按钮被抬到 input 层。
 */
test('社区插件次级按钮抬到 input 层，不留暗洞', async () => {
  const css = await readFile(join(root, 'lib/styles/buttons.css'), 'utf8')
  const rule = css.match(/button\.dm-action-btn:not\(\[class~="primary"\]\)[^{]*\{([^}]*)\}/)
  assert.ok(rule, '缺少 dm-action-btn 次级按钮规则')
  assert.match(rule[1], /background:\s*var\(--color-input\)/)
})

/**
 * 宿主把 [data-slot] 当插槽系统标识，DOM 上只渲染 root 等少数取值；拿它当组件
 * 选择器（[data-slot="sidebar"] 之类）永远不会命中。组件一律走真实 CSS Module 类名。
 */
test('不把 data-slot 当组件选择器', async () => {
  const sources = await themeCssSources()
  for (const text of sources) {
    const hits = [...text.matchAll(/\[data-slot=["'][^"']+["']\]/g)].map((m) => m[0])
    assert.deepEqual(hits, [], `data-slot 不是组件钩子：${hits.join(', ')}`)
  }
})

/**
 * 框架层的两层底色是「左右两边像不像官方」的关键：窗口用 background-win-alt，
 * 内容卡用 background 并带圆角与描边。少任何一条都会退回单色平板。
 */
test('三栏框架使用官方两层底色与圆角内容卡', async () => {
  const frame = await readFile(join(root, 'lib/styles/frame.css'), 'utf8')
  assert.match(frame, /\.BynINW_frame\s*\{[^}]*background:\s*var\(--color-background-win-alt\)/)
  assert.match(frame, /\.BynINW_centerCol\s*\{[^}]*background:\s*var\(--color-background\)/)
  assert.match(frame, /\.BynINW_centerCol\s*\{[^}]*border-radius:\s*6px/)
  assert.match(frame, /\.BynINW_sidebarCol\s*\{[^}]*border-right:\s*none/)
  assert.equal(STYLE_FILES.includes('frame.css'), true, 'frame.css 必须进入 STYLE_FILES')
})

/**
 * 主题不得再引用「按模块名猜」的历史选择器。这批类名在宿主 0.2.1-rc.2 已经全部不存在。
 */
test('不再引用已失效的历史类名', async () => {
  const sources = await themeCssSources()
  const retired = ['hHd-Xa_', 'YDXeBa_', 'uV2eYG_', 'iWlSmW_', 'wSkVaW_', 'JObwrW_', 'EvIC1a_', 'Sixlwa_', 'lcKema_', 'pI_x6G_', 'ZuhsRW_', 'VOzbGW_', 'BInVoG_', 'rS3zOq_', 'CY-8Ka_', '_7KE1Ra_', '_5OnbHa_']
  for (const text of sources) {
    for (const name of retired) {
      assert.equal(text.includes(name), false, `仍引用已失效的历史类名 ${name}`)
    }
  }
})
