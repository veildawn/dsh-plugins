/**
 * 插件兼容性测试——需求「统一 Token，对仓库内所有插件兼容」的落地保证。
 *
 * 做法：**扫描仓库内每个插件真实引用的 `--dsw-*` 变量名**，逐个检查主题是否
 * 提供了定义。这条测试的价值在于它跟随仓库演进——新插件引入新的别名、
 * 或者有人把 `var(--dsw-xxx)` 换成另一个宿主不存在的名字时，这里先失败，
 * 而不是等到用户看见「主题没覆盖到某个面板」。
 *
 * 为什么不能只看「宿主定义了哪些 Token」：仓库里的插件大量引用
 * `--dsw-alias-border-default`、`--dsw-alias-background-base` 这类
 * **宿主从未定义**的别名，写法是 `var(--dsw-alias-border-default, var(--dsw-alias-border-l2))`。
 * 宿主没有该变量时插件只能回落到 fallback（有些 fallback 直接是 `#fff`），
 * 主题就管不到它。本插件显式定义这些别名，插件的所有表面才会跟随主题。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { HOST_TOKEN_MAP, MATERIAL_DEFAULTS, MATERIAL_KEYS } from '../lib/tokens.js'
import { ALL_STYLE_FILES, GLASS_STYLE_FILE, readStyleFile } from '../lib/css.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pluginsDir = join(root, '..')

/** 本插件自己的目录名：扫描时要排除，避免自我满足。 */
const SELF = 'dsh-theme-studio'

/** 收集仓库内所有插件客户端源码引用到的宿主变量。 */
function collectPluginTokenRefs() {
  const refs = new Map()
  for (const name of readdirSync(pluginsDir)) {
    if (name === SELF || name.startsWith('.')) continue
    const libDir = join(pluginsDir, name, 'lib')
    if (!existsSync(libDir) || !statSync(libDir).isDirectory()) continue
    for (const file of readdirSync(libDir)) {
      if (!file.endsWith('.js')) continue
      const text = readFileSync(join(libDir, file), 'utf8')
      for (const match of text.matchAll(/var\((--dsw-[a-zA-Z0-9-]+)/g)) {
        if (!refs.has(match[1])) refs.set(match[1], new Set())
        refs.get(match[1]).add(`${name}/${file}`)
      }
    }
    // 插件可能把样式放在子目录里
    for (const sub of readdirSync(libDir)) {
      const subDir = join(libDir, sub)
      if (!statSync(subDir).isDirectory()) continue
      for (const file of readdirSync(subDir)) {
        if (!file.endsWith('.css')) continue
        const text = readFileSync(join(subDir, file), 'utf8')
        for (const match of text.matchAll(/var\((--dsw-[a-zA-Z0-9-]+)/g)) {
          if (!refs.has(match[1])) refs.set(match[1], new Set())
          refs.get(match[1]).add(`${name}/lib/${sub}/${file}`)
        }
      }
    }
  }
  return refs
}

const pluginRefs = collectPluginTokenRefs()

test('仓库里能扫到插件引用的宿主变量（防止扫描器失效导致假通过）', () => {
  assert.ok(pluginRefs.size > 20, `只扫到 ${pluginRefs.size} 个变量，扫描器可能失效`)
})

test('插件引用的每一个 --dsw-* 变量都由主题定义', () => {
  const missing = []
  for (const [token, sources] of pluginRefs) {
    if (token in HOST_TOKEN_MAP) continue
    if (token in MATERIAL_DEFAULTS) continue
    missing.push(`${token}  ← ${[...sources].sort().join(', ')}`)
  }
  assert.deepEqual(
    missing,
    [],
    `以下宿主变量被插件引用但主题没有定义，对应界面不会跟随主题：\n${missing.join('\n')}`,
  )
})

test('插件引用的变量不会落到禁止名单里', () => {
  // 反向保护：如果某个插件引用了宿主不存在的 inverse Token，我们要知道自己
  // 没有映射它（而不是悄悄补一个不存在的值）。
  const forbidden = ['--dsw-alias-bg-inverse', '--dsw-alias-label-inverse']
  for (const token of forbidden) {
    assert.equal(token in HOST_TOKEN_MAP, false)
  }
})

test('主题 CSS 只引用已定义的宿主变量与材质变量', () => {
  const sources = ALL_STYLE_FILES.map((name) => ({
    name,
    text: readStyleFile(name),
  }))
  const unknown = []
  for (const { name, text } of sources) {
    for (const match of text.matchAll(/var\((--(?:dsw|ds|ts)-[a-zA-Z0-9-]+)/g)) {
      const token = match[1]
      if (token in HOST_TOKEN_MAP) continue
      if (token in MATERIAL_DEFAULTS) continue
      if (token.startsWith('--color-')) continue
      if (token.startsWith('--dsh-')) continue // 宿主按运行时写入的变量
      if (token.startsWith('--shiki-')) continue // Shiki 自己的变量
      unknown.push(`${name}: ${token}`)
    }
  }
  assert.deepEqual([...new Set(unknown)], [], `主题 CSS 引用了未定义的变量：\n${[...new Set(unknown)].join('\n')}`)
})

test('主题 CSS 引用的 --color-* 键在每款主题色板中都存在', async () => {
  const { BUILTIN_THEMES } = await import('../lib/themes/index.js')
  const sources = ALL_STYLE_FILES.map(readStyleFile)
  const referenced = new Set()
  for (const text of sources) {
    for (const match of text.matchAll(/var\(--color-([a-z0-9-]+)/g)) referenced.add(match[1])
  }
  assert.ok(referenced.size > 20, `只引用到 ${referenced.size} 个语义色，可能是正则失效`)

  for (const theme of BUILTIN_THEMES) {
    if (theme.id === 'none') continue
    const missing = [...referenced].filter((key) => !(key in theme.palette))
    assert.deepEqual(missing, [], `主题 ${theme.id} 缺少被 CSS 引用的语义色：${missing.join(', ')}`)
  }
})

test('材质键清单与默认材质保持一致', () => {
  assert.deepEqual([...MATERIAL_KEYS].sort(), Object.keys(MATERIAL_DEFAULTS).sort())
})

test('玻璃材质层被装配进每一款主题的 CSS', async () => {
  const { composeThemeCss } = await import('../lib/css.js')
  const glassCss = readStyleFile(GLASS_STYLE_FILE)
  const marker = 'backdrop-filter: blur(var(--ts-blur))'
  assert.ok(glassCss.includes(marker), '玻璃样式表缺少核心 backdrop-filter 规则')
  for (const id of ['zcode', 'zcode-mono', 'glass', 'glass-color']) {
    assert.ok(composeThemeCss(id).includes(marker), `${id} 的产物里缺玻璃材质层`)
  }
})

test('文件查看插件的右键菜单背景层（.fv-context-backdrop）保持透明且不带模糊滤镜', () => {
  const modalCss = readStyleFile('modal.css')
  // 必须显式声明透明
  assert.match(modalCss, /\.fv-context-backdrop\s*\{[^}]*background:\s*transparent\s*!important/, 'fv-context-backdrop 必须声明为 transparent')
  assert.match(modalCss, /\.fv-context-backdrop\s*\{[^}]*backdrop-filter:\s*none\s*!important/, 'fv-context-backdrop 必须声明 backdrop-filter: none')
  // 不得混在半透明遮罩选择器列表里
  assert.doesNotMatch(
    modalCss,
    /\.fv-context-backdrop[^{]*\{[^}]*rgba\(0,\s*0,\s*0/s,
    'fv-context-backdrop 绝不能被套上半透明黑遮罩',
  )
})

test('文件查看插件的侧边抽屉（.fv-shell）在玻璃主题下使用厚重防穿透材质且禁用模糊以保护右键菜单定位', () => {
  const glassCss = readStyleFile('glass.css')
  assert.match(glassCss, /\.fv-shell[^{]*\{[^}]*background:\s*var\(--color-drawer\)\s*!important/)
  assert.match(glassCss, /\.fv-shell[^{]*\{[^}]*backdrop-filter:\s*none\s*!important/)
})

test('Tooltip 气泡在浅色与深色模式下均保持文字高对比度可读', () => {
  const modalCss = readStyleFile('modal.css')
  assert.match(modalCss, /html\[data-theme-studio\] span\[class\*="_bubble_"\]/)
  assert.match(modalCss, /color:\s*var\(--color-foreground,\s*var\(--dsw-alias-label-primary\)\)\s*!important/)
})


/**
 * 回归：布局容器的玻璃材质必须挂在 ::before 上，不能挂在容器本体。
 *
 * 事故背景（2026-10-23）：用户报告「归档箱打开后跑到了会话区下面」，
 * 且**只在玻璃主题出现**，系统默认与 ZCode 主题正常。
 *
 * 根因不是归档箱插件，而是 `backdrop-filter` 的规范副作用：任何非 none 的
 * filter / backdrop-filter 都会把元素变成后代 `position: fixed` 的**包含块**。
 * 侧栏是 `sidebar.footer.action` 槽位的宿主，归档箱的全屏遮罩
 * （`.dam-backdrop{position:fixed;inset:0}`）就挂在这里。材质写在
 * sidebarCol 本体上时，遮罩不再相对视口，而是缩成侧栏那一栏、再被
 * 侧栏自带的 `overflow:hidden` 裁掉——看上去就是「弹窗跑到会话区下面」。
 *
 * 实测（Chromium，侧栏 250px / 视口 780px）：
 *   - 本体带 backdrop-filter  → 后代 fixed 250×493（被裁到侧栏）
 *   - 材质移到 ::before       → 后代 fixed 780×493（恢复视口）
 *
 * 另有一条必须同时守住的约束：**不能加 `isolation:isolate`**。
 * 它虽然也建立层叠上下文，但会把整栏锁成一个层叠容器，`z-index` 巨大的遮罩
 * 反而被压在 centerCol 之下，弹窗同样不可见（实测变体 3 复现）。
 */
test('玻璃主题的布局容器把 backdrop-filter 挂在 ::before，本体不得携带（否则后代 fixed 浮层被裁进侧栏）', () => {
  const glassCss = readStyleFile(GLASS_STYLE_FILE)

  // 取出所有「选择器块」，逐个检查：凡命中 sidebarCol / centerCol 的规则，
  // 只要声明了非 none 的 backdrop-filter，选择器就必须带 ::before。
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g
  let m
  const offenders = []
  while ((m = ruleRe.exec(glassCss)) !== null) {
    const selector = m[1]
    const body = m[2]
    if (!/(^|[\s,>])[^{]*_(sidebarCol|centerCol)\b/.test(selector)) continue
    // 只要有一条非 none 的 backdrop-filter 声明（含 -webkit-）
    const hasMaterial = /(?:^|[;\s])-?(?:webkit-)?backdrop-filter\s*:\s*(?!none)[^;]+/.test(body)
    if (!hasMaterial) continue
    // 该条规则的选择器里若出现没有 ::before 的容器选择器，就是漏网
    const bare = selector
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /_(sidebarCol|centerCol)\b/.test(s) && !/::?before/.test(s))
    if (bare.length > 0) offenders.push(bare.join(', '))
  }
  assert.deepEqual(
    offenders,
    [],
    `这些规则把材质写在了容器本体上，会让后代 fixed 浮层被裁进容器：\n${offenders.join('\n')}`,
  )

  // 正例必须存在：材质确实下沉到了伪元素，而不是被整体删掉。
  assert.match(
    glassCss,
    /_(?:sidebarCol|centerCol)[^{,]*::before[^{]*\{[^}]*backdrop-filter:\s*blur\(/s,
    '玻璃主题必须把容器材质放在 ::before 上',
  )
})

test('玻璃主题的布局容器不得用 isolation 建立层叠上下文（会把 fixed 遮罩压到 centerCol 之下）', () => {
  const glassCss = readStyleFile(GLASS_STYLE_FILE)
  // 只针对承载 fixed 浮层的两个容器。
  const blocks = [...glassCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  const bad = []
  for (const [, selector, body] of blocks) {
    if (!/_(sidebarCol|centerCol)\b/.test(selector)) continue
    if (/isolation\s*:\s*isolate/.test(body)) bad.push(selector.trim().slice(0, 120))
  }
  assert.deepEqual(bad, [], `这些容器不能加 isolation:isolate：\n${bad.join('\n')}`)
})

test('用户设了背景图时，减弱后的材质同样挂在 ::before 上', () => {
  const bgCss = readStyleFile('background.css')
  const blocks = [...bgCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  const bad = []
  for (const [, selector, body] of blocks) {
    if (!/_(sidebarCol|centerCol)\b/.test(selector)) continue
    if (!/(?:^|[;\s])-?(?:webkit-)?backdrop-filter\s*:\s*(?!none)[^;]+/.test(body)) continue
    const bare = selector
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /_(sidebarCol|centerCol)\b/.test(s) && !/::?before/.test(s))
    if (bare.length > 0) bad.push(bare.join(', '))
  }
  assert.deepEqual(bad, [], `背景图让位层不得把材质写回容器本体：\n${bad.join('\n')}`)
})

/**
 * 同一事故的第二个机制：`backdrop-filter` 还会建立层叠上下文。
 *
 * 即便假设包含块那关被绕过（例如 fixed 尺寸已正确），只要容器本体的
 * backdrop-filter 还在，它就是一个层叠上下文——栏内所有 z-index 被锁在这一栏，
 * 整栏再作为一个整体与兄弟比较。centerCol 在 DOM 中靠后、默认层叠更高，
 * 于是 `.dam-backdrop` 里 `z-index: 2147483640` 的遮罩依然被压在下面。
 *
 * 实测对照（`elementFromPoint(视口中心)`）：
 *   - 本体现在带 backdrop-filter → 命中会话区（遮罩不可见）
 *   - 材质在 ::before            → 命中遮罩本身（正确）
 */
test('玻璃主题的布局容器本体不得直接携带 backdrop-filter（同时触发包含块与层叠上下文两个问题）', () => {
  const glassCss = readStyleFile(GLASS_STYLE_FILE)
  const blocks = [...glassCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  const bad = []
  for (const [, selector, body] of blocks) {
    if (!/_(?:sidebarCol|centerCol)\b/.test(selector)) continue
    // 只有伪元素上的材质是安全的
    if (/::?before/.test(selector)) continue
    if (!/(?:^|[;\s])-?(?:webkit-)?backdrop-filter\s*:\s*(?!none)[^;]+/.test(body)) continue
    bad.push(selector.trim().split('\n')[0].slice(0, 100))
  }
  assert.deepEqual(
    bad,
    [],
    `容器本体出现 backdrop-filter 会建立层叠上下文并锁定后代 z-index：\n${bad.join('\n')}`,
  )
})

/**
 * 用户设了背景图时，::before 不得再铺一层底色。
 *
 * 材质下沉到伪元素后，glass.css 的 `::before` 会带上 `var(--color-background)`
 * （玻璃主题下是 82% 不透明）。而 background.css 已经在 `centerCol` 本体写了
 * 38% 的让位底色。两层叠加 → 合成接近实色，用户照片被冲成一片灰白。
 * 实测：背景图几乎完全消失，退回「设置了却没有效果」的老问题。
 *
 * 约定：用户设了背景图时，底色只由本体那条 38% 规则承担；
 * 伪元素只负责降档后的模糊（8px）。
 */
test('用户设背景图时，centerCol 的 ::before 只承载模糊、不再铺底色（否则照片被冲成灰白）', () => {
  const bgCss = readStyleFile('background.css')
  const blocks = [...bgCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  const bad = []
  let seen = false
  for (const [, selector, body] of blocks) {
    if (!/_(?:sidebarCol|centerCol)\b/.test(selector)) continue
    if (!/::?before/.test(selector)) continue
    if (!/backdrop-filter/.test(body)) continue
    seen = true
    // 必须显式把底色清零
    if (!/background\s*:\s*none/.test(body)) {
      bad.push(selector.trim().split('\n')[0].slice(0, 90))
    }
  }
  assert.ok(seen, 'background.css 必须接管伪元素上的降档模糊')
  assert.deepEqual(
    bad,
    [],
    `这些伪元素规则必须声明 background: none，否则与本体 38% 底色叠加：\n${bad.join('\n')}`,
  )
})
