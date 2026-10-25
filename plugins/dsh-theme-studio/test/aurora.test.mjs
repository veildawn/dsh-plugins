/**
 * 极光流光（Aurora Flow）主题的专属守卫。
 *
 * 这份测试守的不是「色板对不对」（那由 `tokens.test.mjs` 的通用契约覆盖），
 * 而是**这款主题独有的四条设计约束**——它们每一条都对应一种「看起来能用、
 * 实际坏掉」的失效方式：
 *
 *   1. 光斑层必须能被看见（半透明表面 + 骨架让位），否则动效全被盖住；
 *   2. 流光边框必须不吞点击（`pointer-events: none`），否则输入框点不进去；
 *   3. 动效必须只碰合成器属性，否则中端设备直接掉帧；
 *   4. 无障碍偏好必须真的关掉动效，而不只是「把时长压到 0.01ms」。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { readStyleFile, AURORA_STYLE_FILE, ALL_STYLE_FILES, composeThemeCss } from '../lib/css.js'
import { getTheme, BUILTIN_THEMES } from '../lib/themes/index.js'
import { MATERIAL_DEFAULTS } from '../lib/tokens.js'

const css = readStyleFile(AURORA_STYLE_FILE)

/**
 * 取出所有「选择器 { 声明 }」块，供逐条检查。
 *
 * **不能用 `/([^{}]+)\{([^{}]*)\}/g`**：那份朴素正则在 `@keyframes` 的嵌套
 * 花括号上会错位——`@keyframes x { 0% { … } }` 里的内层块会被当成顶层规则，
 * 之后每一条的选择器都错开一格，断言就会在错误的块上通过或失败。
 * 这里做一个能感知花括号层级的顶层解析，注释一并跳过。
 */
function blocks(text = css) {
  const out = []
  let i = 0
  const n = text.length
  while (i < n) {
    // 跳过注释
    if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      continue
    }
    // 跳过空白
    if (/\s/.test(text[i])) {
      i += 1
      continue
    }
    // 收集选择器直到 '{'
    const braceAt = text.indexOf('{', i)
    if (braceAt === -1) break
    const selector = text.slice(i, braceAt).trim()
    // 找匹配的 '}'
    let depth = 0
    let j = braceAt
    for (; j < n; j += 1) {
      if (text[j] === '{') depth += 1
      else if (text[j] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    const body = text.slice(braceAt + 1, j)
    out.push({ selector, body, atRule: selector.startsWith('@') })
    i = j + 1
  }
  return out
}

test('极光动效层进入样式清单，且排在玻璃层之后', () => {
  assert.ok(ALL_STYLE_FILES.includes(AURORA_STYLE_FILE), 'aurora.css 必须在 ALL_STYLE_FILES 里')
  const glassAt = ALL_STYLE_FILES.indexOf('glass.css')
  const auroraAt = ALL_STYLE_FILES.indexOf(AURORA_STYLE_FILE)
  assert.ok(
    auroraAt > glassAt,
    '极光层必须排在玻璃层之后：它沿用玻璃的表面结构并改写其中几条取值，反过来会被压回去',
  )
})

test('极光主题的产物包含动效层，且始终注入（切换零成本）', () => {
  // 无论当前是哪个主题，产物里都带极光层：它自带 `[data-theme-studio="aurora"]`
  // 限定，非极光主题下不命中任何元素，因此不需要在切换时重新注入。
  for (const id of ['none', 'zcode', 'aurora']) {
    const out = composeThemeCss(id, { includeAllThemes: true })
    assert.match(out, /@keyframes ts-aurora-drift/, `${id} 的产物缺少极光动效层`)
  }
})

/**
 * 状态条特效：默认原生（无属性），选档后才动。
 *
 * 这是本插件的产品决策而非实现细节：状态条是每轮对话都出现的高频元素，
 * 安装主题不应强制改变它。`status.css` 的全部规则必须以
 * `html[data-ts-status="<档位>"]` 开头——写 `html[data-theme-studio]`
 * 会让所有主题用户无条件获得动效，属于回归。
 */
test('状态条特效默认关闭，只在 data-ts-status 有值时生效', async () => {
  const { readStyleFile } = await import('../lib/css.js')
  const css = readStyleFile('status.css')
  // 所有动效规则都必须带档位限定。
  // 匹配 `html[data-ts-status="..."]`（具体档位）——无障碍降级段用的是
  // `html[data-ts-status]`（无值，覆盖全部档位），那是刻意的，不算违规。
  const animated = [...css.matchAll(/html\[data-ts-status(?:="[^"]*")?\][^{]*\{[^}]*animation:/g)].map((m) => m[0])
  assert.ok(animated.length >= 4, `只找到 ${animated.length} 条动效规则，正则可能失效`)
  for (const rule of animated) {
    assert.match(
      rule,
      /html\[data-ts-status/,
      `这条动效规则没有档位限定，会让所有主题用户无条件获得动效：\n${rule.slice(0, 120)}`,
    )
  }
  // 反向：不能出现用 html[data-theme-studio] 限定的动效规则（那会让所有主题无条件动）
  assert.equal(
    /html\[data-theme-studio[^\]]*\][^{]*\{[^}]*animation:/.test(css),
    false,
    'status.css 不得写 html[data-theme-studio] 动效规则',
  )
})

test('光斑层画在 body::before 上并落到块级背景之下', () => {
  const glow = blocks().find((b) => b.selector.includes('body::before'))
  assert.ok(glow, '缺少 body::before 光斑层')
  // z-index: -1 是它「可见但不遮挡内容」的唯一依据
  assert.match(glow.body, /z-index:\s*-1/, '光斑层必须 z-index:-1，否则压在内容之上')
  assert.match(glow.body, /position:\s*fixed/, '光斑层必须 fixed 铺满视口')
  // 必须比视口大一圈，平移时边缘才不会露出空白
  assert.match(glow.body, /inset:\s*-/, '光斑层必须用负 inset 外扩，否则漂移时露边')
})

test('光斑层不能吞掉指针事件', () => {
  const glow = blocks().find((b) => b.selector.includes('body::before'))
  assert.match(glow.body, /pointer-events:\s*none/, '光斑层必须 pointer-events:none')
})

test('blur 是静态值，不得进入 keyframes（否则每帧重算全屏高斯模糊）', () => {
  const keyframes = [...css.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1])
  // 状态条动效已移出主题层（改由 status.css 的档位控制），
  // aurora.css 现在只剩光斑漂移 + 扫光旋转 + 停止按钮脉冲三条。
  assert.ok(keyframes.length >= 3, `只找到 ${keyframes.length} 条 keyframes，正则可能失效`)
  for (const body of keyframes) {
    assert.doesNotMatch(
      body,
      /filter\s*:\s*blur/,
      'keyframes 里出现 filter:blur —— 每一帧都要重做全屏模糊，中端手机会掉到 20fps',
    )
    assert.doesNotMatch(body, /\b(top|left|width|height|margin|padding)\s*:/, 'keyframes 里出现了会触发重排的属性')
  }
})

/**
 * 状态条动效**不得**再由主题层实现。
 *
 * 状态条有独立的设置项（`data-ts-status` 档位），若主题层也写一份
 * `runningContent` / `runningIcon` 的动画，用户关掉特效后仍会被主题强制加动效——
 * 两条控制线打架，用户看到的永远是「关不掉」。
 */
test('主题层不得再实现状态条动效（统一由 status.css 档位控制）', async () => {
  const { readStyleFile, GLASS_STYLE_FILE, AURORA_STYLE_FILE } = await import('../lib/css.js')
  for (const file of [GLASS_STYLE_FILE, AURORA_STYLE_FILE]) {
    // 必须先剥掉注释：本文件与 glass.css 的注释里会提到「runningContent」
    // 来解释迁移，那是说明文字不是规则，不该被判违规。
    const text = readStyleFile(file).replace(/\/\*[\s\S]*?\*\//g, '')
    const statusParts = ['runningContent', 'runningIcon', 'runningWhale', 'runningDivider', 'runningText']
    const offenders = []
    for (const part of statusParts) {
      const re = new RegExp(`[^{}]*${part}[^{}]*\\{([^}]*)\\}`, 'g')
      let m
      while ((m = re.exec(text)) !== null) {
        if (/animation\s*:/.test(m[1])) offenders.push(`${file}: ${part}`)
      }
    }
    assert.deepEqual(
      [...new Set(offenders)],
      [],
      `主题层给状态条加了动画，会与 data-ts-status 档位开关打架：\n${offenders.join('\n')}`,
    )
  }
})

test('扫光边框不吞点击，且用遮罩裁环而不是 overflow:hidden', () => {
  const beam = blocks().find(
    (b) => b.selector.includes('[data-composer-card]::after') && b.body.includes('conic-gradient'),
  )
  assert.ok(beam, '缺少输入卡的扫光边框规则')
  assert.match(beam.body, /pointer-events:\s*none/, '扫光边框必须 pointer-events:none，否则输入框点不进去')
  // 用 mask-composite 裁出环，父级不需要 overflow:hidden（那会裁掉下拉菜单）
  assert.match(beam.body, /mask-composite:\s*exclude/, '必须用 mask-composite:exclude 裁出边框环')
  assert.match(beam.body, /-webkit-mask-composite:\s*xor/, 'Chromium/Safari 需要 -webkit-mask-composite:xor')
  // 圆角必须继承，写死数值会在宿主改圆角时错位
  assert.match(beam.body, /border-radius:\s*inherit/, '边框环的圆角必须 inherit')
})

test('扫光角度注册为可插值的 <angle>，否则旋转是跳变的', () => {
  assert.match(css, /@property\s+--ts-beam-angle/, '缺少 @property 注册')
  const prop = css.match(/@property\s+--ts-beam-angle\s*\{([^}]*)\}/)[1]
  assert.match(prop, /syntax:\s*'<angle>'/, 'syntax 必须是 <angle>，否则浏览器无法插值')
  assert.match(prop, /inherits:\s*false/, 'inherits 应为 false：伪元素取 initial-value，不依赖继承')
  // 注册的变量必须同时登记在材质默认值里，否则「只引用已定义变量」那条守卫会失败
  assert.ok('--ts-beam-angle' in MATERIAL_DEFAULTS, '--ts-beam-angle 必须登记进 MATERIAL_DEFAULTS')
})

test('状态条动效的双构建哈希在 status.css 里成对（少写一侧那一端完全没有动效）', async () => {
  const { readStyleFile } = await import('../lib/css.js')
  const statusCss = readStyleFile('status.css')
  for (const part of ['runningContent', 'runningIcon', 'runningWhaleAnimated', 'runningDivider', 'runningText']) {
    assert.ok(statusCss.includes(`EvIC1a_${part}`), `status.css 缺少 Web 版 .EvIC1a_${part}`)
    assert.ok(statusCss.includes(`_6nxh1G_${part}`), `status.css 缺少桌面版 ._6nxh1G_${part}`)
  }
})

test('动效只在聚焦或运行态触发，不常驻', () => {
  // 扫光动画必须挂在 :focus-within 上；裸卡片规则里不能有 animation
  const beamBlocks = blocks().filter((b) => b.selector.includes('::after') && b.selector.includes('data-composer-card'))
  assert.ok(beamBlocks.length >= 2, '应有「默认静止」与「聚焦启动」两条规则')
  const alwaysOn = beamBlocks.filter(
    (b) => /animation:/.test(b.body) && !/:focus-within/.test(b.selector),
  )
  assert.deepEqual(
    alwaysOn.map((b) => b.selector.slice(0, 80)),
    [],
    '扫光动画不得常驻：常驻旋转会让整页持续合成，笔记本电池与手机发热都受影响',
  )
})

test('停止生成按钮动效必须限定状态，不得误伤普通发送按钮导致常驻重绘', () => {
  const stopBlocks = blocks().filter((b) => b.body.includes('ts-aurora-stop'))
  assert.ok(stopBlocks.length >= 1, '应有停止生成按钮动效规则')
  for (const block of stopBlocks) {
    if (/animation:\s*none/.test(block.body)) continue
    assert.match(
      block.selector,
      /:is\(\[aria-label\*="停止"\],|:has\(svg rect\)/,
      `停止按钮动画规则没有状态限定，会导致日常发送按钮持续触发 GPU 重绘：\n${block.selector}`,
    )
  }
})

test('无障碍：减弱动效时必须真的关掉，而不只是压短时长', () => {
  // 不能用非贪婪正则取媒体查询块：块内还有嵌套规则，
  // `([\s\S]*?)\n\}` 会在第一个内层 `}` 处截断，导致断言在残缺片段上失败。
  // 这里按花括号层级取出完整的 @media 块。
  const start = css.indexOf('@media (prefers-reduced-motion: reduce)')
  assert.notEqual(start, -1, '缺少 prefers-reduced-motion 媒体查询')
  let depth = 0
  let end = start
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) { end = i; break }
    }
  }
  const body = css.slice(start, end + 1)
  assert.ok(body.length > 100, `媒体查询块异常短（${body.length} 字符）`)
  assert.match(body, /body::before\s*\{[^}]*animation:\s*none/, '减弱动效时光斑必须 animation:none')
  // 移动端模型徽标的动效也要关（它在同一份文件的另一段 @media 里，
  // 这里只断言「文件里存在对应的关闭规则」）
  assert.match(
    css,
    /\.dsh-mobile-composer-info\s*\{[^}]*animation:\s*none\s*!important/,
    '减弱动效时移动端徽标动效必须关掉',
  )
})

test('无障碍：降低透明度与高对比偏好都要关掉光斑层', () => {
  for (const query of ['prefers-reduced-transparency', 'prefers-contrast']) {
    const block = css.match(new RegExp(`@media\\s*\\(${query}[^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`))
    assert.ok(block, `缺少 ${query} 媒体查询`)
    assert.match(block[1], /body::before\s*\{[^}]*display:\s*none/, `${query} 下必须关掉光斑层`)
  }
})

/**
 * 光斑层必须保持「廉价渲染」：不得有 filter / 加色混合。
 *
 * 这是**性能契约**，不是审美偏好。实测（Chromium 1200x800，120 帧 rAF）：
 *
 *   | 配置                              | FPS |
 *   | :---                              | :--- |
 *   | filter: blur(56px) + plus-lighter | 11  |
 *   | 去掉 blur                          | 19  |
 *   | 去掉 blur + normal 混合            | 29  |
 *
 * 核显上 `filter` 会为光斑层建一张比视口还大的离屏缓冲区并每帧重新光栅化，
 * `plus-lighter` 再要求一次额外合成——两者叠加就是「切到极光主题后卡顿」。
 * 柔和感由径向渐变的多段色标提供，不需要模糊。
 */
test('光斑层不得使用 filter 与加色混合（核显性能契约）', () => {
  const glow = blocks().find((b) => b.selector === 'html[data-theme-studio="aurora"] body::before')
  assert.ok(glow, '缺少光斑层基础规则')
  // 规则块里含大段解释性注释（说明为什么不能加 blur），断言前必须先剥掉注释，
  // 否则会把「不要加 filter:blur」这句说明本身判成违规。
  const decl = glow.body.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(decl, /filter:\s*none/, '光斑层必须 filter:none，blur 会让核显每帧重做全屏离屏模糊')
  assert.doesNotMatch(decl, /filter:\s*blur/, '光斑层不得使用 filter:blur')
  assert.match(decl, /mix-blend-mode:\s*normal/, '光斑层必须用 normal 混合')

  // 不允许任何规则再把暗色光斑切回 plus-lighter
  const plusLighter = blocks().filter((b) =>
    /plus-lighter/.test(b.body.replace(/\/\*[\s\S]*?\*\//g, '')),
  )
  assert.deepEqual(
    plusLighter.map((b) => b.selector.slice(0, 80)),
    [],
    'plus-lighter 会让光斑层多一次合成，实测 FPS 从 19 掉到 11',
  )
})

test('光斑柔和度由多段色标提供（去掉 blur 后仍不成硬边）', () => {
  const glow = blocks().find((b) => b.selector === 'html[data-theme-studio="aurora"] body::before')
  assert.ok(glow, '缺少光斑层基础规则')
  // 四层光斑（3 个 radial + 1 个 linear）合计至少 6 个 color-mix 中间色标，
  // 才能保证每层都是「多段淡出」而不是单段硬衰减（单段会露出圆形等高线）。
  const decl2 = glow.body.replace(/\/\*[\s\S]*?\*\//g, '')
  const colorMixes = (decl2.match(/color-mix\(/g) ?? []).length
  assert.ok(colorMixes >= 6, `色标只有 ${colorMixes} 个，衰减过陡会露出圆形光团（至少 6 个）`)
})

test('相位差与 animation 简写写在同一条规则里（简写会重置 delay）', () => {
  const glow = blocks().find((b) => b.selector === 'html[data-theme-studio="aurora"] body::before')
  assert.ok(glow, '缺少光斑层规则')
  // animation 简写里必须带一个负的 delay，否则三层光斑同步漂移
  const anim = glow.body.match(/animation:\s*([^;]+);/)
  assert.ok(anim, '光斑层缺少 animation 声明')
  assert.match(
    anim[1],
    /calc\(\s*-/,
    'animation 简写里必须带负 delay（相位差），分两条规则写会被简写重置',
  )
})

test('用户设了背景图时，光斑层让位（两套背景叠在一起只会互相糊掉）', () => {
  const rule = blocks().find((b) => b.selector.includes('data-ts-bg') && b.selector.includes('body::before'))
  assert.ok(rule, '缺少用户背景图下的光斑让位规则')
  assert.match(rule.body, /display:\s*none/, '用户设了背景图时光斑层必须隐藏')
})

test('材质挂在 ::before 上，容器本体不得携带 backdrop-filter', () => {
  // 与玻璃同一处坑：backdrop-filter 会把元素变成后代 fixed 的包含块，
  // 并把整栏锁成层叠上下文，社区插件的全屏遮罩会被裁进栏内。
  const bad = []
  for (const { selector, body } of blocks()) {
    if (!/_(?:sidebarCol|centerCol)\b/.test(selector)) continue
    if (/::?before/.test(selector)) continue
    if (!/(?:^|[;\s])-?(?:webkit-)?backdrop-filter\s*:\s*(?!none)[^;]+/.test(body)) continue
    bad.push(selector.slice(0, 100))
  }
  assert.deepEqual(bad, [], `这些容器本体带了 backdrop-filter：\n${bad.join('\n')}`)

  // 正例必须存在
  assert.match(
    css,
    /_(?:sidebarCol|centerCol)[^{,]*::before[^{]*\{[^}]*backdrop-filter:\s*blur\(/s,
    '极光主题必须把容器材质放在 ::before 上',
  )
})

test('极光主题沿用玻璃的语义结构（继承生效，不会漏色）', () => {
  const aurora = getTheme('aurora')
  const glass = getTheme('glass')
  // 未覆盖的键必须与玻璃逐值一致
  for (const key of Object.keys(glass.palette)) {
    assert.ok(key in aurora.palette, `极光主题缺少继承键 ${key}`)
  }
  // 但关键表面确实被改过（否则就只是玻璃换了个名字）
  assert.notDeepEqual(aurora.palette.background, glass.palette.background)
  assert.notDeepEqual(aurora.palette.primary, glass.palette.primary)
})

test('极光主题的语义色板完整且明暗成对', () => {
  const aurora = getTheme('aurora')
  for (const [key, value] of Object.entries(aurora.palette)) {
    if (typeof value === 'string') {
      assert.ok(value.length > 0, `${key} 是空字符串`)
      continue
    }
    assert.equal(typeof value.light, 'string', `${key} 缺 light`)
    assert.equal(typeof value.dark, 'string', `${key} 缺 dark`)
  }
})

test('光斑与扫光材质必须是半透明或有效色值，不能留 transparent 占位', () => {
  const aurora = getTheme('aurora')
  for (const key of ['--ts-aurora-glow-1', '--ts-aurora-glow-2', '--ts-aurora-glow-3']) {
    const value = aurora.material[key]
    assert.equal(typeof value, 'object', `${key} 必须是 { light, dark } 成对值`)
    for (const mode of ['light', 'dark']) {
      assert.notEqual(value[mode], 'transparent', `${key}.${mode} 还是占位值，光斑层将不可见`)
      // 光斑必须是半透明色：不透明色块会把界面变成一块实色
      const alpha = Number.parseFloat(value[mode].match(/,\s*([0-9.]+)\s*\)$/)?.[1] ?? '1')
      assert.ok(alpha > 0 && alpha < 0.6, `${key}.${mode} 的 alpha 应在 (0, 0.6)：${value[mode]}`)
    }
  }
  // 三段扫光色必须互相不同，否则扫光看不出流动
  const beam = ['--ts-beam-a', '--ts-beam-b', '--ts-beam-c'].map((k) => aurora.material[k].dark)
  assert.equal(new Set(beam).size, 3, `三段扫光色必须互不相同：${beam.join(', ')}`)
})

test('表面必须足够透明，光斑才能透上来', () => {
  const aurora = getTheme('aurora')
  for (const mode of ['light', 'dark']) {
    for (const key of ['background', 'card', 'panel']) {
      const value = aurora.palette[key][mode]
      assert.match(value, /^rgba\(/, `${key}.${mode} 必须是半透明：${value}`)
      const alpha = Number.parseFloat(value.match(/,\s*([0-9.]+)\s*\)$/)?.[1] ?? '1')
      assert.ok(alpha < 0.9, `${key}.${mode} 不透明度应 < 0.9，否则光斑被整层盖住：${value}`)
    }
  }
})

/**
 * 主内容区底色不透明度是极光可见度的**决定性变量**。
 *
 * 实测（Chromium 1200x800，对设计稿做像素统计后逐档对比）：
 *
 *   | --ts-canvas-alpha | 主区彩度 p90 | 正文对比度 |
 *   | :---              | :---         | :---       |
 *   | 72%（= --color-background 原值） | 45 | 15.7:1 |
 *   | 38%               | 86           | 13.1:1    |
 *
 * 72% 时主区彩度只有 45，而设计稿是 67——界面看着像「一层灰玻璃」而不是极光。
 * 降到 38% 后彩度翻倍，正文对比度仍有 13.1:1（WCAG AAA 要求 7:1）。
 *
 * 这条测试守的是「不要把它改回实色」：那会让整个动效层的可见度归零，
 * 而单看任何一条 CSS 都发现不了。
 */
test('主内容区底色不透明度必须足够低，否则极光透不上来', () => {
  const aurora = getTheme('aurora')
  const value = aurora.material['--ts-canvas-alpha']
  assert.match(value, /^\d+%$/, `--ts-canvas-alpha 应为百分比：${value}`)
  const alpha = Number.parseInt(value, 10)
  assert.ok(alpha <= 45, `主区底色不透明度 ${alpha}% 过高，极光会被整层盖住（上限 45%）`)
  assert.ok(alpha >= 25, `主区底色不透明度 ${alpha}% 过低，正文可读性会失控（下限 25%）`)
})

test('aurora.css 用 --ts-canvas-alpha 而不是直接取 --color-background', () => {
  // 直接取 --color-background（72%）会盖住光斑；必须走可调的不透明度变量
  const rule = blocks().find(
    (b) => /_(?:centerCol)/.test(b.selector) && /::before/.test(b.selector) && /background/.test(b.body),
  )
  assert.ok(rule, '缺少 centerCol 的 ::before 材质规则')
  assert.match(
    rule.body,
    /var\(--ts-canvas-alpha/,
    'centerCol 的底色必须引用 --ts-canvas-alpha，否则无法独立调低',
  )
})

test('底部极光带用线性渐变（radial 只能照亮一小块）', () => {
  const glow = blocks().find((b) => b.selector === 'html[data-theme-studio="aurora"] body::before')
  const bg = glow.body
  assert.match(bg, /linear-gradient\(/, '底部必须是 linear-gradient：设计稿的底部是横贯左右的光带')
  // radial 层数：左上 / 右上 / 中部 三层（底部已改成 linear）
  const radials = bg.match(/radial-gradient\(/g) ?? []
  assert.ok(radials.length >= 3, `只找到 ${radials.length} 层 radial，中部会死黑`)
})

test('光斑衰减用多段色标，避免露出圆形等高线', () => {
  const glow = blocks().find((b) => b.selector === 'html[data-theme-studio="aurora"] body::before')
  const bg = glow.body
  // 单段衰减（0% → transparent 100%）斜率太陡，blur 抹不掉那条圆边
  assert.match(
    bg,
    /radial-gradient\(\s*[\d.]+% [\d.]+% at [\d.]+% [\d.]+%,\s*var\(--ts-aurora-glow-\d[^)]*\) 0%,\s*color-mix/,
    'radial 光斑必须用多段 color-mix 色标，否则会出现可见的圆形光团',
  )
})

test('极光主题在主题清单里，且排在玻璃之后（面板展示顺序）', () => {
  const ids = BUILTIN_THEMES.map((t) => t.id)
  assert.ok(ids.includes('aurora'), '极光主题未注册')
  assert.ok(ids.indexOf('aurora') > ids.indexOf('glass-color'), '极光应排在玻璃系列之后')
})

test('全屏大容器在默认极光动态背景下不得开启 backdrop-filter 高斯模糊（杜绝 GPU 暴增雪崩）', () => {
  // 核心性能契约：底层 body::before 在跑平移动画时，覆于其上的全屏大容器
  // （centerCol / sidebarCol / header / card）若声明 blur()，会导致 GPU 每一帧
  // 必须对 2K/4K 视口执行纹理拷贝与双通道高斯卷积，导致核显 100% 满载与 20fps 掉帧。
  for (const b of blocks()) {
    if (!/html\[data-theme-studio="aurora"\]/.test(b.selector)) continue
    // 用户自设背景时（data-ts-bg）底层光斑已隐藏（静态壁纸），此时允许适度模糊
    if (/data-ts-bg/.test(b.selector)) continue
    // 弹窗与独立菜单是小面积交互浮层，不属于常驻全屏大容器
    if (/\[role="dialog"\]|\[role="menu"\]|Toast|toast/.test(b.selector)) continue

    // 检查 centerCol / sidebarCol / header / composer-card
    if (/(?:centerCol|sidebarCol|header|data-composer-card|dsh-mobile-bar)/.test(b.selector)) {
      assert.doesNotMatch(
        b.body,
        /(?:^|[;\s])-?(?:webkit-)?backdrop-filter\s*:\s*blur\(/,
        `容器 ${b.selector.slice(0, 80)} 在动态极光背景下带了 backdrop-filter:blur，会引发每帧全屏高斯卷积死锁`,
      )
    }
  }
})

test('移动端模型徽标不得常驻运行 conic-gradient 扫光动画', () => {
  // conic-gradient 角度插值在 Chromium 每一帧都会触发重光栅化，
  // 只有输入框聚焦 :focus-within 时才允许运行，常驻徽标伪元素不得带 ts-aurora-beam 动画。
  const badgeBefore = blocks().find(
    (b) => b.selector.includes('.dsh-mobile-composer-info::before'),
  )
  assert.ok(badgeBefore, '缺少移动端模型徽标 ::before 规则')
  assert.doesNotMatch(
    badgeBefore.body,
    /animation:\s*[^;]*ts-aurora-beam/,
    '移动端徽标不得常驻运行 ts-aurora-beam，否则每帧重光栅化导致高 GPU',
  )
})

test('移动端顶栏在极光主题下保持原生贯通式，无圆角、无四周缝隙', () => {
  const barBlocks = blocks().filter((b) => b.selector.includes('.dsh-mobile-bar'))
  assert.ok(barBlocks.length >= 1, '缺少 .dsh-mobile-bar 规则')
  for (const block of barBlocks) {
    if (block.selector.includes('.dsh-mobile-view')) continue
    const m = block.body.match(/border-radius:\s*([^;!]+)/)
    if (m) {
      assert.equal(m[1].trim(), '0', '移动端顶栏圆角必须为 0')
    }
  }

  // 必须有重置为 0 的贯通式声明与移动端容器让位
  assert.match(css, /\.dsh-mobile-bar[^{]*\{[^}]*border-radius:\s*0/s, '移动端顶栏必须显式重置 border-radius: 0')
  assert.match(
    css,
    /body:has\(\.dsh-mobile-bar\)[^{]*_(?:centerCol|sidebarCol)[^{]*\{[^}]*border-radius:\s*0/s,
    '存在移动端顶栏时主区必须重置 border-radius: 0，避免在顶栏下方和四周留出圆角与缝隙',
  )
})
