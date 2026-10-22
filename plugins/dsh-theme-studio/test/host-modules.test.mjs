/**
 * 宿主 CSS Modules 自适应层的测试。
 *
 * 这一层解决的是真实事故：内置主题原本把两套哈希（Web 版 + macOS 桌面版）写死在
 * CSS 里，而 Windows 桌面版 0.2.1-rc.2 是第三套哈希，于是主题在桌面端**整体失效**
 * 且没有任何报错 —— 框架卡片、气泡、输入卡全部退回宿主默认配色。
 *
 * 判据分三组：
 *
 * 1. **纯函数**：类名切分、映射抽取、唯一性判定、CSS 改写形态；
 * 2. **跨构建前提**：137 个模块的部件名在 fixture 的三套构建里逐个一致 ——
 *    这是「按部件名匹配」成立的根本依据，宿主换构建时必须先在这里失败；
 * 3. **真实宿主**：能从本机 app.asar / node_modules 里探测到映射，且主题里
 *    那些**唯一**部件名确实被补全了。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  adaptCssToHost,
  collectMappings,
  detectHostModules,
  isElectronRuntime,
  openAsar,
  slotKey,
  splitModuleClass,
  stripCssComments,
  uniqueOwnerClass,
} from '../lib/host-modules.js'
import { HOST_CLASS_SLOTS } from '../lib/host-class-slots.js'
import { GLASS_STYLE_FILE, STYLE_FILES, readStyleFile } from '../lib/css.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixturePath = join(root, '../../test/fixtures/host-classes.json')

/**
 * fixture 里出现过的全部宿主部件名。
 *
 * 用来把「主题里恰好带下划线的自有类名」与「真的宿主模块类名」区分开：
 * 前者不该出现在对照表里，后者缺了就是桌面版静默失效。
 */
const HOST_PART_NAMES = new Set()
{
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
  for (const files of Object.values(fixture.modules ?? {})) {
    for (const kinds of Object.values(files)) {
      for (const side of ['desktop', 'web']) {
        for (const cls of Object.values(kinds?.[side] ?? {})) {
          const split = splitModuleClass(cls)
          if (split !== null) HOST_PART_NAMES.add(split.part)
        }
      }
    }
  }
}

test('splitModuleClass 按最后一个下划线切分（hash 自身可含下划线）', () => {
  assert.deepEqual(splitModuleClass('BynINW_frame'), { prefix: 'BynINW', part: 'frame' })
  assert.deepEqual(splitModuleClass('_LS25G_centerCol'), { prefix: 'LS25G', part: 'centerCol' })
  // Web 版 layout 的前缀是 `pI_x6G`，唯一合法切分点是最后一个下划线。
  assert.deepEqual(splitModuleClass('pI_x6G_centerCol'), { prefix: 'pI_x6G', part: 'centerCol' })
  // 带连字符的 hash。
  assert.deepEqual(splitModuleClass('hHd-Xa_newSession'), { prefix: 'hHd-Xa', part: 'newSession' })
  // 带连字符的 part（宿主真实存在：`input-pending`）。
  assert.deepEqual(splitModuleClass('RlGAzG_input-pending'), { prefix: 'RlGAzG', part: 'input-pending' })
  // 非 CSS Module 形态：插件自己的 kebab 类名、纯大写常量、中文文案。
  assert.equal(splitModuleClass('fv-scrim'), null)
  assert.equal(splitModuleClass('API'), null)
  assert.equal(splitModuleClass('_primary_'), null)
  assert.equal(splitModuleClass('已完成'), null)
  assert.equal(splitModuleClass('已添加工具：{name}'), null)
})

test('collectMappings 只收「值确实以 _part 结尾」的映射条目', () => {
  const source = `
    const tagId = "@deepseek-ai/dsh-client-ui-sidebar/SidebarRoot.module.css";
    var SidebarRoot_module_css_default = {
      "brand": "_2H3hWW_brand",
      "newSession": "_2H3hWW_newSession",
      "buildVersion": "_2H3hWW_buildVersion"
    };
    const tagId$1 = "@deepseek-ai/dsh-client-ui-sidebar/Other.module.css";
    var Other_module_css_default = {
      "brand": "kh1pJG_brand"
    };
    const unrelated = { "version": "0.2.1-rc.2", "asset": "a_b_c" };
  `
  const { slots, owners } = collectMappings(source, 'sidebar')
  assert.deepEqual([...slots.keys()].sort(), [
    'sidebar/Other.module.css|brand',
    'sidebar/SidebarRoot.module.css|brand',
    'sidebar/SidebarRoot.module.css|buildVersion',
    'sidebar/SidebarRoot.module.css|newSession',
  ])
  // 多义部件名：两个模块都在用，不能靠「唯一性」推导。
  assert.equal(owners.get('brand')?.size, 2)
  assert.equal(uniqueOwnerClass({ slots, owners }, 'brand'), '')
  assert.equal(uniqueOwnerClass({ slots, owners }, 'newSession'), '_2H3hWW_newSession')
})

test('collectMappings 在没有 tagId 时按映射表变量名还原模块文件名', () => {
  const source = 'var AppFrame_module_css_default = { "frame": "BynINW_frame" };'
  const { slots } = collectMappings(source, 'layout')
  assert.equal(slots.get('layout/AppFrame.module.css|frame'), 'BynINW_frame')
})

test('uniqueOwnerClass 对未知部件名返回空串', () => {
  const { slots, owners } = collectMappings('var A_module_css_default = { "frame": "abc123_frame" };', 'layout')
  assert.equal(uniqueOwnerClass({ slots, owners }, 'nope'), '')
  assert.equal(uniqueOwnerClass({ slots, owners }, 'frame'), 'abc123_frame')
})

test('adaptCssToHost 按静态槽位表补全，且保留原有类名', () => {
  const index = {
    slots: new Map([
      [slotKey('layout', 'AppFrame.module.css', 'centerCol'), 'BynINW_centerCol'],
      [slotKey('conversation', 'InputBar.module.css', 'card'), 'RlGAzG_card'],
    ]),
    owners: new Map([
      ['centerCol', new Set([slotKey('layout', 'AppFrame.module.css', 'centerCol')])],
      [
        'card',
        new Set([
          slotKey('conversation', 'InputBar.module.css', 'card'),
          slotKey('chat', 'X.module.css', 'card'),
        ]),
      ],
    ]),
  }
  const hostClassSlots = {
    '_LS25G_centerCol': slotKey('layout', 'AppFrame.module.css', 'centerCol'),
    'pI_x6G_centerCol': slotKey('layout', 'AppFrame.module.css', 'centerCol'),
    // card 是多义部件名，但静态槽位表精确指名了模块，所以也能补全。
    'uV2eYG_card': slotKey('conversation', 'InputBar.module.css', 'card'),
  }
  const css = [
    'html[data-theme-studio] ._LS25G_centerCol { background: red; }',
    'html[data-theme-studio] .pI_x6G_centerCol { background: red; }',
    'html[data-theme-studio] .uV2eYG_card { background: blue; }',
  ].join('\n')

  const result = adaptCssToHost(css, index, hostClassSlots)
  // macOS 桌面版和 Web 版的类名都原样保留，当前宿主类名作为并列候选追加 ——
  // 必须是并列候选（逗号），`:is(.a.b)` 会变成「同时带两个类」，一个都命中不了。
  assert.match(result.css, /:is\(\._LS25G_centerCol, \.BynINW_centerCol\)/)
  assert.match(result.css, /:is\(\.pI_x6G_centerCol, \.BynINW_centerCol\)/)
  assert.match(result.css, /:is\(\.uV2eYG_card, \.RlGAzG_card\)/)
  assert.equal(result.patched, 3)
  assert.deepEqual(result.parts, ['card', 'centerCol'])
  assert.deepEqual(result.unmatched, [])
})

test('adaptCssToHost 在静态表缺失时退回「唯一部件名」推导', () => {
  const index = {
    slots: new Map([[slotKey('layout', 'AppFrame.module.css', 'frame'), 'BynINW_frame']]),
    owners: new Map([['frame', new Set([slotKey('layout', 'AppFrame.module.css', 'frame')])]]),
  }
  // 静态表里没有 `_LS25G_frame`（模拟主题新增了选择器、表还没重建）。
  const css = 'html[data-theme-studio] ._LS25G_frame { background: none; }'
  const result = adaptCssToHost(css, index, {})
  assert.match(result.css, /:is\(\._LS25G_frame, \.BynINW_frame\)/)
  assert.equal(result.patched, 1)
})

test('adaptCssToHost 不重复包裹已带 :is() 的类名', () => {
  const index = {
    slots: new Map([[slotKey('layout', 'AppFrame.module.css', 'frame'), 'BynINW_frame']]),
    owners: new Map([['frame', new Set([slotKey('layout', 'AppFrame.module.css', 'frame')])]]),
  }
  const css = ':is(html[data-theme-studio="glass"], html[data-theme-studio="glass-color"]) .pI_x6G_frame { background: none; }'
  const result = adaptCssToHost(css, index, {})
  // `:is(...)` 里的主题属性选择器不是模块类名，只有末尾的 `.pI_x6G_frame` 会被处理。
  assert.match(result.css, /:is\(\.pI_x6G_frame, \.BynINW_frame\)/)
  assert.equal(result.css.match(/\.BynINW_frame/g)?.length, 1)
})

test('adaptCssToHost 遇到空索引时原样返回（宿主不可探测即退化）', () => {
  const css = 'html[data-theme-studio] .pI_x6G_frame { background: none; }'
  for (const index of [{ slots: new Map(), owners: new Map() }, null, undefined]) {
    const result = adaptCssToHost(css, index, HOST_CLASS_SLOTS)
    assert.equal(result.css, css)
    assert.equal(result.patched, 0)
  }
})

test('adaptCssToHost 幂等：对已补全的产物再跑一次不叠加', () => {
  const index = {
    slots: new Map([[slotKey('layout', 'AppFrame.module.css', 'centerCol'), 'BynINW_centerCol']]),
    owners: new Map([['centerCol', new Set([slotKey('layout', 'AppFrame.module.css', 'centerCol')])]]),
  }
  const css = 'html[data-theme-studio] ._LS25G_centerCol { background: red; }'
  const once = adaptCssToHost(css, index, {}).css
  const twice = adaptCssToHost(once, index, {}).css
  assert.equal(twice, once, '重复补全会在选择器里堆叠同名类名')
})

/**
 * 属性选择器里的哈希同样会失效。
 *
 * 主题用 `[class*="iWlSmW_trigger"]` 匹配权限触发器、用 `[class*="JObwrW_colorSystem"]`
 * 给上下文占用表着色。这两处含构建哈希，在别的构建上一条都命中不了 —— 和 `.hash_part`
 * 一样必须补全，否则「权限触发器配色」「用量图分段色」在桌面版上全部退回宿主默认。
 */
test('adaptCssToHost 也补全属性选择器里的模块哈希', () => {
  const index = {
    slots: new Map([
      [slotKey('permission-presets', 'PermissionSelect.module.css', 'trigger'), 'dlU_AG_trigger'],
      [slotKey('conversation', 'ContextMeter.module.css', 'colorSystem'), '_2WTFBq_colorSystem'],
    ]),
    owners: new Map([
      ['trigger', new Set([slotKey('permission-presets', 'PermissionSelect.module.css', 'trigger')])],
      ['colorSystem', new Set([slotKey('conversation', 'ContextMeter.module.css', 'colorSystem')])],
    ]),
  }
  const hostClassSlots = {
    iWlSmW_trigger: slotKey('permission-presets', 'PermissionSelect.module.css', 'trigger'),
    qVH09a_trigger: slotKey('permission-presets', 'PermissionSelect.module.css', 'trigger'),
    JObwrW_colorSystem: slotKey('conversation', 'ContextMeter.module.css', 'colorSystem'),
  }
  const css = [
    'html[data-theme-studio] [class*="iWlSmW_trigger"] { height: 28px; }',
    'html[data-theme-studio] [class*="qVH09a_trigger"] { height: 28px; }',
    'html[data-theme-studio] [class*="JObwrW_colorSystem"] { --meter-tint: red; }',
  ].join('\n')

  const result = adaptCssToHost(css, index, hostClassSlots)
  assert.match(result.css, /:is\(\[class\*="iWlSmW_trigger"\], \[class\*="dlU_AG_trigger"\]\)/)
  assert.match(result.css, /:is\(\[class\*="qVH09a_trigger"\], \[class\*="dlU_AG_trigger"\]\)/)
  assert.match(result.css, /:is\(\[class\*="JObwrW_colorSystem"\], \[class\*="_2WTFBq_colorSystem"\]\)/)
  assert.equal(result.patched, 3)
})

test('adaptCssToHost 不动不含哈希的属性选择器', () => {
  const index = {
    slots: new Map([[slotKey('conversation', 'InputBar.module.css', 'primary'), 'RlGAzG_primary']]),
    owners: new Map([['primary', new Set([slotKey('conversation', 'InputBar.module.css', 'primary')])]]),
  }
  // `_primary_` 是「名字里含 _primary_」，`primary` 是词元匹配 —— 都不含构建哈希，
  // 跨构建天然稳定，改写它们只会把社区插件的按钮也卷进来。
  const css = [
    'html[data-theme-studio] button[class*="_primary_"] { background: red; }',
    'html[data-theme-studio] button[class~="primary"] { background: red; }',
  ].join('\n')
  const result = adaptCssToHost(css, index, {})
  assert.equal(result.css, css)
  assert.equal(result.patched, 0)
})

test('adaptCssToHost 记录「静态表指名但当前宿主没有」的槽位', () => {
  const index = {
    slots: new Map([[slotKey('layout', 'AppFrame.module.css', 'centerCol'), 'BynINW_centerCol']]),
    owners: new Map([['centerCol', new Set([slotKey('layout', 'AppFrame.module.css', 'centerCol')])]]),
  }
  const css = 'html[data-theme-studio] .Gone1_gonePart { color: red; }'
  const result = adaptCssToHost(css, index, { Gone1_gonePart: slotKey('legacy', 'Removed.module.css', 'gonePart') })
  assert.deepEqual(result.unmatched, ['legacy/Removed.module.css|gonePart'])
  assert.equal(result.css, css, '解析不出对应类名时不得改动 CSS')
})

test('adaptCssToHost 不把 `_primary_` 这类写法当成模块类名的一部分', () => {
  const index = {
    slots: new Map([[slotKey('conversation', 'InputBar.module.css', 'primary'), 'RlGAzG_primary']]),
    owners: new Map([['primary', new Set([slotKey('conversation', 'InputBar.module.css', 'primary')])]]),
  }
  // `.tm-primary` 里的 `-primary` 不是模块类名；`_primary_` 也不是。
  const css = 'html[data-theme-studio] .tm-primary { color: red; }'
  const result = adaptCssToHost(css, index, {})
  assert.equal(result.css, css)
})

/**
 * 跨构建前提：部件名集合在 Web 版、macOS 桌面版、Windows 桌面版之间逐个一致。
 *
 * 这是「按部件名匹配」能成立的唯一依据。一旦宿主在某个构建里改了这个内部 local 名
 * （CSS Modules 会随之改名），按部件名补全就会指错元素 —— 必须先在测试里失败，
 * 而不是等用户看见错位的配色。
 */
test('137 个宿主模块的部件名在两套构建之间逐个一致', async () => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
  const bySide = { desktop: new Map(), web: new Map() }
  for (const [bundle, files] of Object.entries(fixture.modules ?? {})) {
    for (const [file, kinds] of Object.entries(files)) {
      for (const side of ['desktop', 'web']) {
        const map = kinds?.[side]
        if (!map) continue
        bySide[side].set(`${bundle}/${file}`, Object.keys(map).sort())
      }
    }
  }
  assert.ok(bySide.desktop.size > 100, `fixture 的模块数异常：${bySide.desktop.size}`)
  assert.deepEqual(
    [...bySide.desktop.keys()].sort(),
    [...bySide.web.keys()].sort(),
    '两套构建收录的模块文件不一致',
  )
  const mismatched = []
  for (const [key, desktopParts] of bySide.desktop) {
    const webParts = bySide.web.get(key)
    if (JSON.stringify(desktopParts) !== JSON.stringify(webParts)) {
      mismatched.push(`${key}: desktop=${desktopParts.join(',')} web=${webParts.join(',')}`)
    }
  }
  assert.deepEqual(mismatched, [], `部件名在两套构建里不一致：\n  ${mismatched.join('\n  ')}`)
})

/**
 * 主题 CSS 里出现的每个宿主部件名，都必须在 fixture 里存在。
 *
 * 这条守的是「拼错一个字母」：`_triggerEffort` 写成 `_triggerEfort` 时宿主里
 * 什么都没有，规则静默失效。哈希前缀由 fixture 存活测试守护，部件名由这里守护。
 */
test('主题引用的宿主部件名全部存在于 fixture 的模块映射里', async () => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
  const hostParts = new Set()
  for (const files of Object.values(fixture.modules ?? {})) {
    for (const kinds of Object.values(files)) {
      for (const side of ['desktop', 'web']) {
        for (const cls of Object.values(kinds?.[side] ?? {})) {
          const split = splitModuleClass(cls)
          if (split) hostParts.add(split.part)
        }
      }
    }
  }
  assert.ok(hostParts.size > 1000, `fixture 的部件名数量异常：${hostParts.size}`)

  const missing = new Set()
  for (const name of [...STYLE_FILES, GLASS_STYLE_FILE]) {
    const css = readStyleFile(name)
    for (const match of css.matchAll(/\._?[A-Za-z0-9][A-Za-z0-9_-]*?_([A-Za-z][A-Za-z0-9]*)\b/g)) {
      if (!hostParts.has(match[1])) missing.add(`${match[1]}（${name}）`)
    }
  }
  assert.deepEqual([...missing].sort(), [], `以下部件名在宿主里不存在：${[...missing].join(', ')}`)
})

/**
 * 真实宿主联调：能从本机探测到映射，且 CSS 里写死的旧哈希被补成包含当前构建的
 * `:is()`。宿主不可探测时跳过（CI 没有安装 dsh 的场合），不判失败。
 */
test('能从本机宿主探测到 CSS Modules 映射（不可探测时跳过）', async (t) => {
  const index = detectHostModules()
  if (index.slots.size === 0) {
    t.skip('本机没有可探测的 dsh 宿主')
    return
  }
  assert.ok(index.slots.size > 1000, `探测到的模块槽位过少：${index.slots.size}`)
  // 框架三列是主题最关键的部件，必须能被唯一定位。
  for (const part of ['centerCol', 'sidebarCol', 'rightbarCol', 'bottomRow', 'handle']) {
    const owners = index.owners.get(part)
    assert.equal(owners?.size, 1, `${part} 应当在整个宿主里唯一`)
  }
  // 多义部件名必须保持多义，不能被当成唯一。
  for (const part of ['root', 'title', 'card', 'header']) {
    const owners = index.owners.get(part)
    assert.ok(owners && owners.size > 1, `${part} 应当是多义部件名`)
    assert.equal(uniqueOwnerClass(index, part), '')
  }
})

test('本机探测到的槽位键与静态对照表的槽位键完全一致', async (t) => {
  const index = detectHostModules()
  if (index.slots.size === 0) {
    t.skip('本机没有可探测的 dsh 宿主')
    return
  }
  const staticKeys = new Set(Object.values(HOST_CLASS_SLOTS))
  const missing = [...staticKeys].filter((key) => !index.slots.has(key))
  // 静态表来自 fixture（可能含旧版已删除的模块）。只要主题真正引用的槽位都在即可，
  // 这里给出总量对比作为提示，硬判据放在下一条测试里。
  const coverage = 1 - missing.length / staticKeys.size
  assert.ok(
    coverage > 0.9,
    `静态槽位表与本机宿主的重合度过低（${(coverage * 100).toFixed(1)}%），`
    + `说明 fixture 已严重过期，请重跑 scripts/harvest-host-classes.mjs --all`,
  )
})

test('接入后：主题 CSS 里每个宿主类名都补全为包含当前构建类的 :is()', async (t) => {
  const index = detectHostModules()
  if (index.slots.size === 0) {
    t.skip('本机没有可探测的 dsh 宿主')
    return
  }
  const failures = []
  let patched = 0
  for (const name of [...STYLE_FILES, GLASS_STYLE_FILE]) {
    const css = readStyleFile(name)
    const result = adaptCssToHost(css, index, HOST_CLASS_SLOTS)
    patched += result.patched
    for (const key of result.unmatched) failures.push(`${name}: 槽位 ${key} 在当前宿主里不存在`)
  }
  assert.deepEqual(failures, [], failures.join('\n'))
  assert.ok(patched > 200, `补全数量异常偏低：${patched}`)

  // 原有写法（Web / macOS 桌面版）必须原样保留，否则会破坏那两个平台。
  const frame = adaptCssToHost(readStyleFile('frame.css'), index, HOST_CLASS_SLOTS).css
  assert.match(frame, /pI_x6G_centerCol/, 'Web 版哈希被删掉了')
  assert.match(frame, /_LS25G_centerCol/, 'macOS 桌面版哈希被删掉了')
  const currentCenterCol = index.slots.get(slotKey('layout', 'AppFrame.module.css', 'centerCol'))
  assert.ok(currentCenterCol && frame.includes(currentCenterCol), `当前宿主的 ${currentCenterCol} 没被补进去`)
})

/**
 * Windows 桌面版的标题栏布局。
 *
 * 桌面版 preload（`app.asar/lib/preload-app.cjs`）在 Windows 上做两件事：
 * `html.dataset.windowsTitlebar = ""`，并把 `--dsh-windows-titlebar-height` 设成 40px。
 * 宿主 UI 于是切换成 Windows 11 骨架：顶部 40px 拖拽条 + 内容卡只切左上 16px 圆角。
 *
 * 主题原先只有 macOS 那套「四周内缩 4px + 6px 全圆角」。在 Windows 上两者叠加，
 * 内容卡会从拖拽条下沿再往里缩一圈，圆角压在宿主已画好的 16px 圆角上形成「双层圆角」，
 * 窗口右上角还会露一块直角底色。这三条判据锁死修复。
 */
test('Windows 桌面版：让位宿主的标题栏几何，不再叠加 macOS 的内缩与全圆角', async () => {
  const frame = await readFile(join(root, 'lib', 'styles', 'frame.css'), 'utf8')

  // 必须存在 Windows 专用段落，且用平台属性限定（不是靠选择器猜）。
  assert.match(frame, /\[data-windows-titlebar\]/, '缺少 Windows 桌面版的让位规则')

  // ① 主列在 Windows 下不再保留 4px 内缩。
  const marginRule = frame.match(
    /html\[data-theme-studio\]\[data-windows-titlebar\][^{]*_centerCol[^{]*\{([^}]*)\}/,
  )
  assert.ok(marginRule, '缺少 Windows 下 _centerCol 的几何规则')
  assert.match(marginRule[1], /margin:\s*0/, 'Windows 下主列必须取消 macOS 的 4px 内缩')
  assert.equal(
    /margin:\s*4px/.test(marginRule[1]),
    false,
    'Windows 下不得继续使用 macOS 的 4px 内缩',
  )

  // ② 圆角必须跟随宿主的 --dsh-windows-content-radius，而不是写死 6px。
  assert.match(
    marginRule[1],
    /border-radius:\s*var\(--dsh-windows-content-radius/,
    'Windows 下圆角必须取宿主的 --dsh-windows-content-radius',
  )

  // ③ 拖拽条与侧栏的底色必须是窗口底色，不能是 --color-sidebar
  //    （主题把它映射成画布黑，会在标题栏形成一条不同的深色带）。
  const beforeRule = frame.match(
    /html\[data-theme-studio\]\[data-windows-titlebar\][^{]*_frame::before[^{]*\{([^}]*)\}/,
  )
  assert.ok(beforeRule, '缺少拖拽条的配色规则')
  assert.match(beforeRule[1], /background:\s*var\(--color-background-win-alt\)/)
})

test('Windows 桌面版规则不写死 40px 标题栏高度', async () => {
  const frame = await readFile(join(root, 'lib', 'styles', 'frame.css'), 'utf8')
  // 宿主按 DPI 写入 --dsh-windows-titlebar-height，写死像素值在 125%/150% 缩放下会错位。
  assert.equal(
    /--dsh-windows-titlebar-height:\s*\d+px/.test(frame),
    false,
    '不得覆盖宿主按 DPI 写入的 --dsh-windows-titlebar-height',
  )
  assert.equal(
    /height:\s*40px/.test(frame),
    false,
    '不得写死 40px 拖拽条高度',
  )
})

/**
 * Electron 下 asar 是「虚拟目录」，原始字节读会拿到空文件。
 *
 * 事故现场（2026-10）：探测在普通 Node 里能读到 2141 个槽位，装进桌面版后却是 0 ——
 * Electron 给 asar 装了透明读取层，`openSync('<...>/app.asar', 'r')` 能成功打开，
 * 但 `fstat().size === 0`、读出来是空内容。于是自己解析 asar 二进制的分支直接失败，
 * 自适应整层静默退化成「只认写死的哈希」，桌面版又回到原来的问题。
 *
 * 判据：`openAsar()` 遇到读不出内容的路径必须安静返回 null（而不是抛错），
 * 由调用方改走 fs 的 asar 透明读取。
 */
test('openAsar 对无法解析的输入安静返回 null，不中断探测', async () => {
  // 不存在的路径
  assert.equal(openAsar(join(root, 'test', 'definitely-not-here.asar')), null)
  // 存在的普通文本文件（不是 asar 格式）
  assert.equal(openAsar(join(root, 'package.json')), null)
  // 空文件（Electron 眼里 asar 就长这样：能打开、size 为 0）
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'empty-asar-'))
  try {
    const empty = join(dir, 'app.asar')
    writeFileSync(empty, '')
    assert.equal(openAsar(empty), null, '空 asar 必须返回 null 而不是抛错')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('isElectronRuntime 在纯 Node 下为 false', () => {
  // CI 跑的是普通 Node；桌面版由 Electron 提供 process.versions.electron。
  assert.equal(typeof isElectronRuntime(), 'boolean')
  assert.equal(isElectronRuntime(), false, '纯 Node 环境不应被判定为 Electron')
})

/**
 * 对照表必须覆盖主题 CSS 里引用的**每一个**宿主类名。
 *
 * `lib/host-class-slots.js` 是生成产物，只收「主题真正引用的类名」以控制包体积。
 * 裁剪判据写错时（例如把前导下划线当可选前缀吃掉，`_7yHdaG_header` 被提成
 * `7yHdaG_header` 再查不到），那批规则会被静默落下 —— 主题照样能加载、也不报错，
 * 只是那些部件在桌面版上不生效。实测这个写法漏掉过 27 个类名。
 */
test('静态对照表覆盖主题引用的每一个宿主类名', async () => {
  const missing = new Map()
  for (const name of [...STYLE_FILES, GLASS_STYLE_FILE]) {
    // 只扫选择器：注释里提到的类名是说明文字，不是「主题引用了它」。
    const css = stripCssComments(readStyleFile(name))
    // 与生成器同一条判据：前导 `.` 可选，下划线属于 token 本身。
    for (const match of css.matchAll(/\.?(_?[A-Za-z0-9-][A-Za-z0-9_-]*_[A-Za-z][A-Za-z0-9-]*)/g)) {
      const token = match[1]
      if (splitModuleClass(token) === null) continue
      // 只关心「宿主真实存在的类名」：`dsh-mobile-*` 这类插件自有类名恰好带下划线，
      // 不该进对照表，用 fixture 的部件名集合把它们排除。
      const part = splitModuleClass(token).part
      if (!HOST_PART_NAMES.has(part)) continue
      if (HOST_CLASS_SLOTS[token] === undefined) {
        if (!missing.has(token)) missing.set(token, new Set())
        missing.get(token).add(name)
      }
    }
  }
  assert.deepEqual(
    [...missing.keys()].sort(),
    [],
    `以下宿主类名没有进对照表，桌面版等其它构建上将查不到对应类名：\n  ${
      [...missing].map(([token, files]) => `${token}（${[...files].join(', ')}）`).join('\n  ')
    }`,
  )
})
