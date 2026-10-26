/**
 * 选项「选中态」的层叠守卫。
 *
 * ## 这条测试为什么必须用真实浏览器
 *
 * 它守的是一个**规则都在、也都能命中、但看不见**的 bug（2026-10-26 用户报障
 * 「做选择的面板中选中了哪一个无法清晰看到」）。`settings.css` 里三条规则的
 * 特异性是这样的：
 *
 *   | 规则 | 特异性 | 声明 |
 *   | :--- | :--- | :--- |
 *   | 透明底 | (0,6,1) | `background: transparent` |
 *   | 悬停 | (0,5,1) | `background: var(--color-surface)` |
 *   | 选中 | (0,2,1) | `background: var(--color-selected)` |
 *
 * 透明底带了四个 `:not([class*="_options"])` 之类的排除项，特异性被抬到
 * (0,6,1)；而选中态只带一个 `:not()`，停在 (0,2,1)。**特异性高的先赢、
 * 与书写顺序无关**，于是透明底压掉了选中态——DOM 上确实有 `_optionSelected`
 * 类，规则也确实匹配，但背景被清空，用户看到的就是「点了没反应」。
 *
 * 断言「规则文本存在」「选择器包含 _optionSelected」全都通过，却什么都没证明。
 * 只有让真实引擎算一遍，才能发现「存在但输掉层叠」这种失效。
 *
 * 无 Chrome 的环境跳过而不是假装通过：一条什么都没验证的绿灯比诚实的 skip 更糟。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { composeThemeCss } from '../lib/css.js'
import { BUILTIN_THEMES } from '../lib/themes/index.js'

/**
 * 找一个能真正渲染页面的无头 Chrome，找不到返回 null。
 *
 * 判据是「能渲染」而不是「--version 有输出」：Windows 上 `chrome.exe --version`
 * 打印的是本地化提示而不是版本号，按版本串判会把一个完好的安装判成不可用。
 */
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean)
  for (const candidate of candidates) {
    if ((candidate.includes('/') || candidate.includes('\\')) && !existsSync(candidate)) continue
    const probe = spawnSync(candidate, [
      '--headless', '--disable-gpu', '--no-sandbox',
      '--virtual-time-budget=1000', '--dump-dom',
      'data:text/html,<b id=probe>osc-probe-ok</b>',
    ], { encoding: 'utf8', timeout: 30000 })
    if (probe.status === 0 && typeof probe.stdout === 'string' && probe.stdout.includes('osc-probe-ok')) {
      return candidate
    }
  }
  return null
}

/**
 * 宿主 `dsh-client-ui-user-questions` 里 `Mbwy4a` 模块的真实规则（节选）。
 *
 * 只保留与本 bug 相关的三条：选中态与悬停共用一条 `background`，以及选中态的
 * 描边。宿主把选中态的背景交给 `--dsw-alias-interactive-bg-hover`，主题把它
 * 映射到 `--color-surface`（0.09 的淡紫），在极光背景上几乎看不出来——这是
 * 用户即使忽略特异性问题也会觉得「不清晰」的第二重原因。
 */
const HOST_CSS = `
.Mbwy4a_options { display: flex; flex-direction: column; gap: 1px; margin: 8px 0 0; padding: 4px 12px; }
.Mbwy4a_option {
  border-radius: var(--dsw-radius-md); width: 100%; min-height: 40px; color: inherit;
  text-align: left; cursor: pointer; background: 0 0; border: 1px solid #0000;
  padding: 8px 12px 8px 8px; display: flex;
}
.Mbwy4a_option:hover:not(:disabled), .Mbwy4a_optionSelected { background: var(--dsw-alias-interactive-bg-hover); }
.Mbwy4a_optionSelected { border-color: var(--dsw-alias-border-l2); }
`

/**
 * 在真实引擎里算一次最终样式。
 *
 * 宿主样式表放在主题样式表**之前**——这是对主题最不利的顺序，主题必须靠
 * 特异性而不是「后来居上」赢。
 */
function computedStyles(themeId) {
  const chrome = findChrome()
  if (chrome === null) return null
  const dir = mkdtempSync(join(tmpdir(), 'osc-'))
  const page = join(dir, 'page.html')
  const html = `<!doctype html><html data-theme-studio="${themeId}" style="color-scheme: dark"><head><meta charset="utf-8">
<style id="host">${HOST_CSS}</style>
<style id="theme">${composeThemeCss(themeId, {})}</style>
</head><body>
<pre id="out" style="all:initial"></pre>
<div class="Mbwy4a_options">
  <button id="selected" class="Mbwy4a_option Mbwy4a_optionSelected">选中项</button>
  <button id="plain" class="Mbwy4a_option">未选中项</button>
</div>
<script>
const pick = (id) => {
  const s = getComputedStyle(document.getElementById(id));
  return { background: s.backgroundColor, shadow: s.boxShadow, color: s.color };
};
document.getElementById('out').textContent = JSON.stringify({
  selected: pick('selected'),
  plain: pick('plain'),
});
</script>
</body></html>`
  writeFileSync(page, html)
  const dumped = execFileSync(chrome, [
    '--headless', '--disable-gpu', '--no-sandbox',
    '--virtual-time-budget=3000', '--dump-dom', `file://${page}`,
  ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  const match = /<pre id="out"[^>]*>([\s\S]*?)<\/pre>/.exec(dumped)
  assert.ok(match, '探针页必须回报计算结果')
  return JSON.parse(
    match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
  )
}

/**
 * 逐主题验证，**不是只验极光**。
 *
 * 这个 bug 在 `settings.css`（所有主题共用的组件层）里，所以它同时影响
 * 全部五款主题——修复前实测 glass / glass-color / zcode / zcode-mono /
 * aurora 的选中项背景**全是** `rgba(0, 0, 0, 0)`。只测极光会漏掉
 * 「玻璃主题也坏了」这个事实，而用户下一句就会问「玻璃主题呢」。
 *
 * 遍历 `BUILTIN_THEMES` 而不是手写 id 列表：将来新增主题自动纳入。
 */
for (const theme of BUILTIN_THEMES) {
  if (theme.id === 'none') continue

  test(`选中态必须真的可见（${theme.id}）：背景不透明、且带主色竖条`, (t) => {
    const styles = computedStyles(theme.id)
    if (styles === null) {
      t.skip('本机没有可用的无头 Chrome')
      return
    }

    // 核心断言：选中项的背景**不能**是透明的。这正是 bug 的表现——
    // `background: transparent` 的 (0,6,1) 压掉了选中态的 (0,2,1)。
    assert.notEqual(
      styles.selected.background,
      'rgba(0, 0, 0, 0)',
      `${theme.id}: 选中项背景被透明的「排除项」规则压掉了——选中态规则的特异性低于透明底规则`,
    )
    // 未选中项应当仍是透明，否则整个列表都成了色块。
    assert.equal(styles.plain.background, 'rgba(0, 0, 0, 0)', `${theme.id}: 未选中项不该有底色`)

    // 第二重信号：左侧主色竖条。半透明表面上单靠底色（alpha 0.07~0.22）
    // 对比度太低，用户实测「看不出选中了哪个」。
    assert.match(
      styles.selected.shadow,
      /inset/,
      `${theme.id}: 选中项缺少 inset 主色竖条，仅靠底色在半透明主题上不可辨`,
    )
  })
}
