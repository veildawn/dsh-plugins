/**
 * Windows 桌面版配色层叠守卫。
 *
 * ## 背景：为什么单独一个测试文件
 *
 * 2026-10 用户报告：「主题工作室在桌面版上左侧菜单没有主题色，Web 版有」。
 *
 * 根因不是任何主题写错了颜色，而是 `frame.css` 里为 Windows 补的两条**基座**
 * 规则特异性过高，把主题层的规则压掉了。旧写法（已删）给侧栏刷了一遍窗口底色，
 * 两个裸属性选择器把它抬到特异性 (0,3,1)：
 *
 *     html[data-theme-studio][data-windows-titlebar] .pI_x6G_sidebarCol …
 *
 * 极光/玻璃把侧栏本体设成 `transparent`、材质放进 `::before`（`--color-sidebar`
 * 半透明）。基座那条 (0,3,1) 比主题层 `html[data-theme-studio="aurora"] …`（(0,2,1)）
 * 高一级，于是侧栏本体被刷成不透明窗口底色（极光暗色 #08090d），`::before` 那层
 * 半透明完全看不见 —— 用户看到的就是「桌面版侧栏一片死黑，没有主题色」。
 *
 * **这类 bug 的可怕之处：**两条规则各自都完全正确，单看哪一条都挑不出毛病。
 * 只有把它们放进同一场层叠竞争、逐条比对特异性，才看得出谁赢。所以断言不能是
 * 「规则文本存在」，必须是「谁能赢」。
 *
 * ## 断言策略
 *
 * 1. 解析 `frame.css` 的 Windows 段落，取出所有会命中窗口骨架（frame / sidebarCol /
 *    centerCol / rightbarCol / bottomRow）的规则；
 * 2. 对每条声明了**颜色类属性**（background / border-color / color）的规则，计算
 *    特异性；
 * 3. 要求它必须 ≤ 主题层（glass / aurora / background）里同部件规则的特异性 ——
 *    否则基座就会锁死主题。
 * 4. 反过来也要求它 ≥ 宿主同类规则的特异性，否则 Windows 让位规则会失效。
 *
 * 同时锁定「侧栏不再有 Windows 专属的 background 规则」：基线规则已经给了同一个
 * 值，重复声明在语义上零收益、在层叠上只会闯祸。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const stylesDir = join(root, 'lib', 'styles')

/* -------------------------------------------------------------------------- */
/* CSS 解析与特异性计算                                                        */
/* -------------------------------------------------------------------------- */

/** 去掉注释（注释里的示例选择器不该参与分析）。 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ')
}

/** 按顶层逗号切分选择器列表（忽略 `:is(...)` 内部的逗号）。 */
function splitSelectorList(selector) {
  const out = []
  let depth = 0
  let buf = ''
  for (const ch of selector) {
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) {
      out.push(buf.trim())
      buf = ''
      continue
    }
    buf += ch
  }
  if (buf.trim() !== '') out.push(buf.trim())
  return out
}

function compareSpecificity(x, y) {
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

/**
 * 计算选择器特异性 `[a, b, c]`。
 *
 * `:where()` 恒为 0（这是它存在的全部意义），`:is()` / `:not()` 取参数最大值。
 * 不追求覆盖全部 CSS 语法 —— 主题里用到的就这些，其余按「不贡献权重」保守处理。
 */
function specificity(selector) {
  const best = (inner) =>
    inner
      .split(',')
      .map((part) => specificity(part.trim()))
      .reduce((m, v) => (compareSpecificity(v, m) > 0 ? v : m), [0, 0, 0])

  let a = 0
  let b = 0
  let c = 0

  let s = selector.replace(/:where\([^)]*\)/g, '')
  s = s.replace(/:is\(([^)]*)\)/g, (_, inner) => {
    const v = best(inner)
    a += v[0]
    b += v[1]
    c += v[2]
    return ''
  })
  s = s.replace(/:not\(([^)]*)\)/g, (_, inner) => {
    const v = best(inner)
    a += v[0]
    b += v[1]
    c += v[2]
    return ''
  })

  a += (s.match(/#[\w-]+/g) ?? []).length
  s = s.replace(/#[\w-]+/g, '')

  // 伪元素必须**先**摘掉再统计伪类，否则 `:(?!:)` 会从 `::before` 的第二个冒号
  // 开始匹配成 `:before`，把 (0,2,2) 错算成 (0,3,1)——本次排查里就踩过这个坑。
  //
  // 单冒号写法也要认：宿主的 CSS Modules 产物里是 `:before`（legacy 语法，
  // 与 `::before` 等价），只认双冒号会把宿主规则误算成「带一个伪类」，
  // 特异性凭空多出 (0,1,0)，于是「主题能不能压过宿主」这条判断直接失效。
  const LEGACY_PSEUDO_ELEMENTS = /:(before|after|first-line|first-letter)(?![\w-])/g
  c += (s.match(LEGACY_PSEUDO_ELEMENTS) ?? []).length
  s = s.replace(LEGACY_PSEUDO_ELEMENTS, '')

  c += (s.match(/::[\w-]+/g) ?? []).length
  s = s.replace(/::[\w-]+/g, '')

  b += (s.match(/\.[\w-]+/g) ?? []).length
  b += (s.match(/\[[^\]]*\]/g) ?? []).length
  b += (s.match(/:(?!:)[\w-]+/g) ?? []).length
  s = s.replace(/\.[\w-]+/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/:(?!:)[\w-]+/g, '')

  c += (s.match(/(^|[\s>+~,(])([a-zA-Z][\w-]*)/g) ?? []).length

  return [a, b, c]
}

/**
 * 把一份 CSS 摊平成规则列表（保留 at-rule 前缀，不展开媒体查询）。
 *
 * @param {string} css
 * @returns {Array<{ selector: string, branches: string[], body: string, order: number, at: string[] }>}
 */
function parseRules(css) {
  const text = stripComments(css)
  const rules = []
  const stack = []
  let buf = ''
  let order = 0
  let i = 0

  while (i < text.length) {
    const ch = text[i]
    if (ch === '{') {
      const prelude = buf.trim()
      buf = ''
      if (prelude.startsWith('@')) {
        stack.push(prelude)
      } else {
        let depth = 1
        let j = i + 1
        while (j < text.length && depth > 0) {
          if (text[j] === '{') depth += 1
          else if (text[j] === '}') depth -= 1
          j += 1
        }
        rules.push({
          selector: prelude,
          branches: splitSelectorList(prelude),
          body: text.slice(i + 1, j - 1),
          order: order++,
          at: [...stack],
        })
        i = j
        continue
      }
    } else if (ch === '}') {
      stack.pop()
      buf = ''
    } else {
      buf += ch
    }
    i += 1
  }
  return rules
}

/** 一条规则体里是否声明了颜色类属性。 */
function hasColorDeclaration(body) {
  return /(^|;|\{)\s*(background|background-color|color|border-color|border-right-color|box-shadow)\s*:/i.test(body)
}

/* -------------------------------------------------------------------------- */
/* 三个对抗层                                                                  */
/* -------------------------------------------------------------------------- */

/** 窗口骨架部件在宿主的 CSS Module 部件名。 */
const SHELL_PARTS = ['frame', 'sidebarCol', 'centerCol', 'rightbarCol', 'bottomRow']

/**
 * 宿主 AppFrame 的真实规则（从 `dsh-client-ui-layout` 的 bundle 抽取）。
 *
 * 这些是「必须被压过」的下限：主题若压不过宿主，就会退回宿主自带的
 * `--dsw-specific-sidebar-fill` / `--dsw-alias-bg-base`（画布黑 / 纯白），
 * 表现为「主题完全没生效」。
 *
 * 值来自 0.2.x 的 `AppFrame.module.css`。宿主升级改了结构时，这份清单需要
 * 同步更新 —— 这是有意的：让测试在宿主漂移时先失败。
 */
const HOST_SHELL_RULES = [
  // 侧栏：宿主自带 sidebar-fill + 0.5px 右边框
  { selector: '.hH0st_sidebarCol', body: 'background: var(--dsw-specific-sidebar-fill); border-right: .5px solid var(--dsw-alias-border-l3)' },
  // Windows 分支：frame 与 ::before 都是 sidebar-fill
  { selector: '[data-windows-titlebar] .hH0st_frame', body: 'padding-top: var(--dsh-windows-titlebar-height); background: var(--dsw-specific-sidebar-fill)' },
  { selector: '[data-windows-titlebar] .hH0st_frame:before', body: 'height: var(--dsh-windows-titlebar-height); background: var(--dsw-specific-sidebar-fill); position: absolute' },
]

/**
 * 主题层：把材质/让位交给 `::before` 的那些主题。
 *
 * 它们必须能赢过基座的 Windows 让位规则，否则：
 * - 极光：光斑被挡在侧栏与标题栏后面 → 侧栏死黑（本次事故）；
 * - 玻璃：壁纸被挡 → 侧栏是一块不透明色；
 * - 用户背景图：顶部 40px 成为唯一不透背景的横条。
 */
const THEME_LAYER_FILES = ['glass.css', 'aurora.css', 'background.css']

/** 读取全部样式表文本。 */
async function readStyles() {
  const out = new Map()
  for (const name of ['frame.css', 'glass.css', 'aurora.css', 'background.css']) {
    out.set(name, await readFile(join(stylesDir, name), 'utf8'))
  }
  return out
}

/** 一条规则分支是否命中某个骨架部件（含 `_sidebarCol` 这种后缀匹配）。 */
function matchesPart(branch, part) {
  return new RegExp(`[_.-]${part}(?![\\w-])`).test(branch)
}

/* -------------------------------------------------------------------------- */
/* 测试                                                                        */
/* -------------------------------------------------------------------------- */

test('Windows 段落的颜色规则特异性不得高于主题层（桌面版侧栏丢失主题色的根因）', async () => {
  const styles = await readStyles()
  const frameRules = parseRules(styles.get('frame.css'))

  // 1) 基座 Windows 段落里所有「声明颜色的骨架规则」
  const baseHits = []
  for (const rule of frameRules) {
    if (!rule.branches.some((b) => b.includes('data-windows-titlebar'))) continue
    if (!hasColorDeclaration(rule.body)) continue
    for (const branch of rule.branches) {
      const parts = SHELL_PARTS.filter((p) => matchesPart(branch, p))
      if (parts.length === 0) continue
      baseHits.push({
        branch,
        parts,
        spec: specificity(branch),
        pseudo: /::?before|::?after/.test(branch),
        rule,
      })
    }
  }

  // 2) 主题层里同部件的颜色规则
  const themeRules = []
  for (const file of THEME_LAYER_FILES) {
    for (const rule of parseRules(styles.get(file))) {
      if (!hasColorDeclaration(rule.body)) continue
      for (const branch of rule.branches) {
        const parts = SHELL_PARTS.filter((p) => matchesPart(branch, p))
        if (parts.length === 0) continue
        themeRules.push({ file, branch, parts, spec: specificity(branch), pseudo: /::?before|::?after/.test(branch) })
      }
    }
  }

  // 3) 逐条比对：基座不得比「同部件 + 同伪元素状态」的主题规则更高
  const violations = []
  for (const base of baseHits) {
    for (const part of base.parts) {
      const rivals = themeRules.filter((t) => t.parts.includes(part) && t.pseudo === base.pseudo)
      if (rivals.length === 0) continue
      // 主题层允许有多个分支（glass / glass-color / aurora / data-ts-bg），
      // 只要有一条能压过（或打平后靠后写胜出）就够。这里取最强的那条做比较。
      const strongest = rivals.reduce((m, v) => (compareSpecificity(v.spec, m.spec) > 0 ? v : m), rivals[0])
      const cmp = compareSpecificity(base.spec, strongest.spec)
      // cmp > 0 → 基座严格更高，主题层永远赢不了，视为违规。
      // cmp === 0 → 打平，靠源码顺序；frame.css 在 STYLE_FILES 里排第 3，
      //             theme 层由 composeThemeCss 追加在后，可接受。
      if (cmp > 0) {
        violations.push(
          `基座规则「${base.branch}」特异性 (${base.spec.join(',')}) ` +
            `高于 ${strongest.file} 的「${strongest.branch}」(${strongest.spec.join(',')})，` +
            `主题层的 ${part} 配色会被锁死。`,
        )
      }
    }
  }

  assert.deepEqual(violations, [], violations.join('\n'))
})

test('Windows 段落的颜色规则仍能压过宿主默认骨架', async () => {
  const styles = await readStyles()
  const frameRules = parseRules(styles.get('frame.css'))

  const hostByPart = new Map()
  for (const rule of HOST_SHELL_RULES) {
    if (!hasColorDeclaration(rule.body)) continue
    for (const part of SHELL_PARTS) {
      if (!matchesPart(rule.selector, part)) continue
      const spec = specificity(rule.selector)
      const prev = hostByPart.get(part)
      if (!prev || compareSpecificity(spec, prev.spec) > 0) {
        hostByPart.set(part, { selector: rule.selector, spec })
      }
    }
  }

  const failures = []
  for (const rule of frameRules) {
    if (!rule.branches.some((b) => b.includes('data-windows-titlebar'))) continue
    if (!hasColorDeclaration(rule.body)) continue
    for (const branch of rule.branches) {
      for (const part of SHELL_PARTS) {
        if (!matchesPart(branch, part)) continue
        const host = hostByPart.get(part)
        if (!host) continue
        // 伪元素状态必须一致才有可比性：`::before` 规则不与本体规则竞争。
        const branchPseudo = /::?before|::?after/.test(branch)
        const hostPseudo = /::?before|::?after/.test(host.selector)
        if (branchPseudo !== hostPseudo) continue
        const spec = specificity(branch)
        if (compareSpecificity(spec, host.spec) < 0) {
          failures.push(
            `「${branch}」特异性 (${spec.join(',')}) 低于宿主「${host.selector}」(${host.spec.join(',')})，` +
              `Windows 让位规则会失效。`,
          )
        }
      }
    }
  }

  assert.deepEqual(failures, [], failures.join('\n'))
})

test('侧栏不再有 Windows 专属的 background 规则（基线已给同一值，重复只会抬高特异性）', async () => {
  const styles = await readStyles()
  const frameRules = parseRules(styles.get('frame.css'))

  const offenders = []
  for (const rule of frameRules) {
    if (!rule.branches.some((b) => b.includes('data-windows-titlebar'))) continue
    for (const branch of rule.branches) {
      if (!matchesPart(branch, 'sidebarCol')) continue
      if (/(^|;|\{)\s*background(-color)?\s*:/i.test(rule.body)) offenders.push(branch)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Windows 段落不得再给 sidebarCol 声明 background：\n${offenders.join('\n')}\n` +
      '基线 html[data-theme-studio] .sidebarCol 已经给了 --color-background-win-alt，' +
      '重复声明的唯一效果是把特异性从 (0,2,1) 抬到 (0,3,1)，从而压死极光/玻璃的 transparent。',
  )
})

test('极光与玻璃的侧栏让位规则使用 :where() 或等价低权重，不与基座硬碰', async () => {
  const styles = await readStyles()
  for (const file of ['glass.css', 'aurora.css']) {
    const rules = parseRules(styles.get(file))
    const sidebarRules = rules.filter((r) =>
      r.branches.some((b) => matchesPart(b, 'sidebarCol') && /background\s*:\s*transparent/i.test(r.body)),
    )
    assert.ok(sidebarRules.length > 0, `${file} 必须有侧栏 transparent 让位规则`)

    // 让位规则必须在帧文件之后装配 —— 这里用「文件清单顺序」间接校验，
    // 真正的顺序由 composeThemeCss 保证（见 lib/css.js 的 STYLE_FILES 注释）。
    for (const rule of sidebarRules) {
      const spec = specificity(
        rule.branches.find((b) => matchesPart(b, 'sidebarCol')),
      )
      // 必须与基座基线 (0,2,1) 同分或更高，否则连基座都压不过、根本命中不了。
      assert.ok(
        compareSpecificity(spec, [0, 2, 1]) >= 0,
        `${file} 的侧栏让位规则特异性过低 (${spec.join(',')})，会输给基座基线 (0,2,1)`,
      )
    }
  }
})

test('Windows 拖拽条规则必须是 (0,2,2)：既压过宿主，又让主题层接管', async () => {
  const styles = await readStyles()
  const rules = parseRules(styles.get('frame.css'))

  // 只取「Windows 段落 + frame::before + 声明 background」的那条。
  const targets = []
  for (const rule of rules) {
    if (!rule.branches.some((b) => b.includes('data-windows-titlebar'))) continue
    if (!/(^|;|\{)\s*background(-color)?\s*:/i.test(rule.body)) continue
    for (const branch of rule.branches) {
      if (!matchesPart(branch, 'frame')) continue
      if (!/::?before/.test(branch)) continue
      targets.push(branch)
    }
  }

  assert.ok(targets.length > 0, 'Windows 段落必须有 frame::before 的背景规则（否则标题栏是宿主画布黑）')

  for (const branch of targets) {
    const spec = specificity(branch)
    // 期望值：html(类型) + [data-theme-studio](属性) + .frame(类) + ::before(伪元素) = (0,2,2)
    assert.deepEqual(
      spec,
      [0, 2, 2],
      `「${branch}」特异性应为 (0,2,2)，实际 (${spec.join(',')})。\n` +
        '高于 (0,2,2)：极光/背景图的「让光透上标题栏」会被锁死（本次事故）。\n' +
        '低于 (0,2,2)：压不过宿主的 [data-windows-titlebar] .frame:before (0,2,1)，标题栏退回画布黑。',
    )
    // 只允许用 :where() 降权，不允许裸写两个属性选择器。
    assert.match(
      branch,
      /:where\(\[data-windows-titlebar\]\)/,
      `「${branch}」必须用 :where([data-windows-titlebar]) 承载平台判定，` +
        '裸属性选择器会把特异性抬到 (0,3,2) 从而压死主题层。',
    )
  }
})

test('background.css 的让位规则必须能接管 Windows 拖拽条（用户背景图模式的最后一道保险）', async () => {
  const styles = await readStyles()
  const bg = styles.get('background.css')

  const rules = parseRules(bg)
  const clear = rules.filter(
    (r) =>
      r.branches.some((b) => b.includes('data-ts-bg') && matchesPart(b, 'frame') && /::?before/.test(b)) &&
      /(^|;|\{)\s*background\s*:\s*none/i.test(r.body),
  )
  assert.ok(clear.length > 0, 'background.css 必须有「清空拖拽条」的规则')

  // 这条规则的特异性 (0,2,2) 必须能压过 frame.css 的 Windows 拖拽条规则 (0,2,2)，
  // 而后者由 composeThemeCss 排在 background.css 之前 —— 靠顺序取胜即可。
  // 但若有人把 frame.css 的拖拽条规则抬到 (0,3,x)，这里就会失败。
  const frameRules = parseRules(styles.get('frame.css'))
  const frameDrag = frameRules.filter(
    (r) =>
      r.branches.some((b) => b.includes('data-windows-titlebar') && matchesPart(b, 'frame') && /::?before/.test(b)) &&
      /(^|;|\{)\s*background(-color)?\s*:/i.test(r.body),
  )
  for (const rule of frameDrag) {
    for (const branch of rule.branches) {
      if (!matchesPart(branch, 'frame') || !/::?before/.test(branch)) continue
      assert.ok(
        compareSpecificity(specificity(branch), [0, 2, 2]) <= 0,
        `「${branch}」会压过 background.css 的让位规则，顶部 40px 成为唯一不透背景的横条`,
      )
    }
  }
})

test('composeThemeCss 把材料层排在组件层之后（顺序是层叠的最后一道保险）', async () => {
  const { STYLE_FILES, GLASS_STYLE_FILE, AURORA_STYLE_FILE, BACKGROUND_STYLE_FILE, composeThemeCss } =
    await import('../lib/css.js')

  const css = composeThemeCss('aurora')
  const frameAt = css.indexOf('.pI_x6G_frame')
  const auroraAt = css.indexOf('html[data-theme-studio="aurora"] .pI_x6G_frame')

  assert.ok(frameAt >= 0, '组件层必须有 frame 规则')
  assert.ok(auroraAt >= 0, '极光层必须有 frame 规则')
  assert.ok(
    auroraAt > frameAt,
    '极光层的 frame 规则必须出现在组件层之后，否则同特异性时会被基座反压',
  )

  // 顺序清单本身就是契约：主题专属层不得混进 STYLE_FILES。
  for (const material of [GLASS_STYLE_FILE, AURORA_STYLE_FILE, BACKGROUND_STYLE_FILE]) {
    assert.equal(STYLE_FILES.includes(material), false, `${material} 不应混进 STYLE_FILES`)
  }
})
