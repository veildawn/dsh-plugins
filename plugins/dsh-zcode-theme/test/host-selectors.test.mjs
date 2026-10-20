import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STYLE_FILES } from '../lib/css.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// fixture 由 scripts/harvest-host-classes.mjs 从宿主抽取，仓库级共享（移动端适配测试也用）。
const fixture = JSON.parse(await readFile(join(root, '../../test/fixtures/host-classes.json'), 'utf8'))
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
 * 前导下划线是真实类名的一部分：CSS Modules 给数字开头的类名生成 `._7yHdaG_header`，
 * DOM 上的 className 也是 `_7yHdaG_header`（见 bundle 里的
 * `{ "header": "_7yHdaG_header" }` 映射表）。fixture 两种写法都收，这里原样比对。
 */
test('主题里的 CSS Module 类名全部存在于宿主', async () => {
  const sources = await themeCssSources()
  const missing = []
  // 正则必须与 scripts/harvest-host-classes.mjs 的 CLASS_RE 一致。
  // 前缀可以极短：layout 是 `pI_x6G_*`（两段分别 2/3 字符），旧写法
  // `[A-Za-z0-9-]{3,10}` 要求首段至少 4 字符，会把整个 layout bundle 漏掉——
  // fixture 里该 bundle 是空数组，测试于是「通过」，而 6 条框架规则全部失效。
  for (const text of sources) {
    for (const match of text.matchAll(/\.(_?[A-Za-z0-9][A-Za-z0-9_-]*_[A-Za-z][A-Za-z0-9]*)/g)) {
      const cls = match[1]
      if (!hostClasses.has(cls) && !hostClasses.has(cls.replace(/^_/, ''))) missing.push(cls)
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
 *
 * 选择器里的哈希前缀不写死：宿主每次构建都会换（桌面版 `BynINW_*` → 现在
 * `pI_x6G_*`，Web 版又是另一套）。这里按「部件名」匹配，前缀交给上面的
 * 「类名全部存在于宿主」测试守护。
 */
test('三栏框架使用官方两层底色与圆角内容卡', async () => {
  const frame = await readFile(join(root, 'lib/styles/frame.css'), 'utf8')
  assert.match(frame, /\.[A-Za-z0-9_-]+_frame\s*\{[^}]*background:\s*var\(--color-background-win-alt\)/)
  assert.match(frame, /\.[A-Za-z0-9_-]+_centerCol\s*\{[^}]*background:\s*var\(--color-background\)/)
  assert.match(frame, /\.[A-Za-z0-9_-]+_centerCol\s*\{[^}]*border-radius:\s*6px/)
  assert.match(frame, /\.[A-Za-z0-9_-]+_sidebarCol\s*\{[^}]*border-right:\s*none/)
  assert.equal(STYLE_FILES.includes('frame.css'), true, 'frame.css 必须进入 STYLE_FILES')
})

/**
 * 主题不得再引用「按模块名猜」的历史选择器。
 *
 * 这批前缀在宿主 0.2.1-rc.2 已经全部不存在，且不在 fixture 里。清单必须写
 * **已废弃**的前缀，不能把当前正在用的写进来——2026-10 曾误把 `pI_x6G_`
 * 等在用前缀列进这里，导致测试永远失败。
 */
test('不再引用已失效的历史类名', async () => {
  const sources = await themeCssSources()
  const retired = ['hHd-Xa_', 'YDXeBa_', 'uV2eYG_', 'iWlSmW_', 'wSkVaW_', 'JObwrW_', 'EvIC1a_', 'Sixlwa_', 'lcKema_', 'pI_x6G_', 'ZuhsRW_', 'VOzbGW_', 'BInVoG_', 'rS3zOq_', 'CY-8Ka_', '_7KE1Ra_', '_5OnbHa_']
  // 只保留「确实不在当前 fixture 里」的前缀；在用的一律剔除，避免误伤。
  const live = retired.filter((prefix) => ![...hostClasses].some((cls) => cls.startsWith(prefix.replace(/^_/, ''))))
  for (const text of sources) {
    for (const name of live) {
      assert.equal(text.includes(name), false, `仍引用已失效的历史类名 ${name}`)
    }
  }
})

/**
 * 特异性护栏：主题是全局样式，通用元素规则必须低于社区插件自写的单类规则。
 *
 * 事故现场（2026-10）：主题写 `[data-dsh-theme="zcode"] input { color: ... }`
 * 特异性 0,1,1，压过 dsh-task-models 的 `.tm-input { color: ... }`（0,1,0）。
 * 插件配色再对也不生效，暗色下输入框成了「暗底深灰字」，对比度 1.08:1。
 * 修法是把通用元素选择器一律包进 :where()，降到 0,1,0 让插件赢。
 */
test('通用元素规则的 specificity 不高于插件单类规则', async () => {
  const sources = await themeCssSources()
  // 只盯表单控件与链接：body/html 是根作用域，不参与「压过插件」的竞争。
  // 允许的形态：[data-dsh-theme="zcode"] :where(button, input, ...)
  // 以及带属性/伪类限定的组件级选择器（button[data-variant="primary"] 之类）。
  const control = /\[data-dsh-theme="zcode"\]\s+(button|input|textarea|select|a)(\s*[,{])/g
  for (const text of sources) {
    for (const match of text.matchAll(control)) {
      assert.fail(`裸元素选择器会压过插件样式，请包 :where()：${match[0].trim()}`)
    }
  }
})

/**
 * 禁用态只表达不可交互，不得改写文字颜色。
 *
 * 事故现场（2026-10）：主题的 `:disabled { color: foreground-subtle }` 把
 * dsh-remote-control 的实心主按钮「验证密钥」压成深底深灰字，对比度 1.53:1。
 */
test('禁用态不改写文字颜色', async () => {
  const states = await readFile(join(root, 'lib/styles/states.css'), 'utf8')
  const rule = states.match(/:where\(:disabled[^{]*\{([^}]*)\}/)
  assert.ok(rule, '缺少禁用态规则')
  assert.equal(/(^|;)\s*color\s*:/.test(rule[1]), false, '禁用态不得覆盖 color')
  assert.match(rule[1], /opacity\s*:/)
  assert.match(rule[1], /pointer-events\s*:\s*none/)
})

/**
 * 主题的「次级按钮抬到 input 层」兜底规则不得吃掉插件的实心主按钮。
 *
 * 事故现场（2026-10）：`button.tm-button`（0,1,1）压过插件的 `.tm-primary`（0,1,0），
 * 主按钮的品牌底色与反色文字一起被换成次级按钮配色，暗色下成了暗底暗字。
 * 兜底规则必须用 :not([class~="..."]) 把各插件的主按钮排除掉。
 */
test('次级按钮兜底规则排除各插件的主按钮', async () => {
  const css = await readFile(join(root, 'lib/styles/buttons.css'), 'utf8')
  const pairs = [
    ['dm-action-btn', 'primary'],
    ['dam-btn', 'dam-action-primary'],
    ['fv-button', 'fv-btn-primary'],
    ['jev-btn', 'jev-btn-primary'],
    ['mr-button', 'mr-primary'],
    ['tm-button', 'tm-primary'],
  ]
  for (const [base, primary] of pairs) {
    const pattern = new RegExp(`button\\.${base}:not\\(\\[class~="${primary}"\\]\\)`)
    assert.match(css, pattern, `button.${base} 的兜底规则必须排除 .${primary}`)
  }
})

/**
 * 宿主的应用级浮层（文件查看器抽屉、命令面板、设置面板）都挂在
 * `[data-shell-overlay]` 里，整层被 `z-index: 20` 锁死——插件内部写多大的 z-index
 * 都出不了这一层。
 *
 * 主题曾为了让头部工具区的下拉菜单浮起来，把 `.headerUtilities` 抬到 25。结果是
 * 抽屉打开后，工具区（「在应用中打开」的 split 按钮 + 文件查看器入口）仍画在抽屉
 * 之上，和抽屉自己的刷新 / 安全路径 / 全屏 / 关闭图标叠成一团（2026-10 用户截图
 * 报障）。chrome 不得压过应用级浮层。
 */
test('头部工具区不得压过宿主应用级浮层', async () => {
  const css = await readFile(join(root, 'lib/styles/navigation.css'), 'utf8')
  const rule = css.match(/\.([A-Za-z0-9_-]+_headerUtilities)[^{]*\{([^}]*)\}/)
  assert.ok(rule, '缺少 headerUtilities 规则')
  const utilitiesZ = Number(/z-index:\s*(-?\d+)/.exec(rule[2])?.[1] ?? 0)
  // 宿主 overlay 层的层级；它不是主题的控制对象，只能让路。
  const HOST_OVERLAY_Z = 20
  assert.ok(
    utilitiesZ < HOST_OVERLAY_Z,
    `headerUtilities 的 z-index(${utilitiesZ}) 必须低于宿主 overlay 层(${HOST_OVERLAY_Z})，否则抽屉盖不住头部按钮`,
  )
  assert.match(rule[2], /overflow:\s*visible/, '仍需 overflow:visible，否则工具栏下拉菜单会被父级裁剪')
})
