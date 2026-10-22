/**
 * 设置持久化与校验测试。
 *
 * 这些校验不是形式主义：设置来自两个入口（前端表单、手改 JSON 文件），
 * 两者都可能传来恶意或错误的值，而设置最终会被拼进 `<style>`。
 * 一旦 `}` 或 `;` 漏进去，整份主题 CSS 会被提前闭合——表现是「主题突然失效」，
 * 排查成本极高。所以颜色 / 字体 / 文件名一律白名单式校验。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BACKGROUND_MIME,
  FIELD_COLOR_KEYS,
  MAX_BACKGROUND_BYTES,
  backgroundDir,
  customCss,
  defaultSettings,
  loadSettings,
  normalizeBackground,
  normalizeColor,
  normalizeFontFamily,
  normalizeFontSize,
  hostTokensFor,
  normalizeSettings,
  readBackgroundImage,
  readSettingsFile,
  saveBackgroundImage,
  writeSettingsFile,
} from '../lib/settings.js'
import { HOST_TOKEN_MAP } from '../lib/tokens.js'
import { THEME_IDS } from '../lib/themes/index.js'

const normalizeOptions = {
  isThemeId: (id) => THEME_IDS.includes(id),
  fontSizeRanges: {
    text: { min: 10, max: 22 },
    code: { min: 10, max: 16 },
    terminal: { min: 10, max: 20 },
  },
}

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'theme-studio-test-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('颜色白名单接受合法形式', () => {
  const ok = [
    '#fff',
    '#ffff',
    '#ffffff',
    '#ffffffcc',
    'rgba(0, 0, 0, 0.5)',
    'rgb(255 255 255)',
    'hsl(210, 40%, 50%)',
    'transparent',
    'currentColor',
    'color-mix(in oklab, #262626 60%, transparent)',
  ]
  for (const value of ok) assert.equal(normalizeColor(value), value, `应接受 ${value}`)
})

test('颜色白名单拒绝注入与非法值', () => {
  const bad = [
    '#ff; } body { color: red',
    'red; }',
    'url(javascript:alert(1))',
    '<script>',
    'rgb(0,0,0)}',
    '',
    '   ',
    null,
    42,
    'x'.repeat(200),
  ]
  for (const value of bad) assert.equal(normalizeColor(value), null, `应拒绝 ${JSON.stringify(value)}`)
})

test('字体栈拒绝注入字符与 url()', () => {
  assert.equal(normalizeFontFamily('"PingFang SC", sans-serif'), '"PingFang SC", sans-serif')
  assert.equal(normalizeFontFamily(''), '')
  assert.equal(normalizeFontFamily('Arial; }'), null)
  assert.equal(normalizeFontFamily('url(evil.woff)'), null)
  assert.equal(normalizeFontFamily('x'.repeat(600)), null)
})

test('字号必须是范围内整数', () => {
  assert.equal(normalizeFontSize(14, 10, 22), 14)
  assert.equal(normalizeFontSize('14', 10, 22), 14)
  assert.equal(normalizeFontSize(9, 10, 22), null)
  assert.equal(normalizeFontSize(23, 10, 22), null)
  assert.equal(normalizeFontSize(14.5, 10, 22), null)
  assert.equal(normalizeFontSize('abc', 10, 22), null)
  assert.equal(normalizeFontSize(undefined, 10, 22), null)
})

test('背景文件名拒绝路径穿越', () => {
  const base = { mode: 'image', fit: 'cover', opacity: 100 }
  assert.equal(normalizeBackground({ ...base, file: 'bg-1.png' }).file, 'bg-1.png')
  assert.equal(normalizeBackground({ ...base, file: '../../etc/passwd' }).file, null)
  assert.equal(normalizeBackground({ ...base, file: 'a/b.png' }).file, null)
  assert.equal(normalizeBackground({ ...base, file: '..' }).file, null)
  assert.equal(normalizeBackground({ ...base, file: 'ok.png; rm -rf /' }).file, null)
})

test('背景模式与铺满方式收敛到合法值', () => {
  assert.equal(normalizeBackground({ mode: 'weird' }).mode, 'none')
  assert.equal(normalizeBackground({ mode: 'image', fit: 'weird' }).fit, 'cover')
  assert.equal(normalizeBackground({ mode: 'image', fit: 'repeat' }).fit, 'repeat')
  assert.equal(normalizeBackground({ mode: 'image', opacity: 250 }).opacity, 100)
  assert.equal(normalizeBackground({ mode: 'image', opacity: -5 }).opacity, 0)
})

test('非法单项被丢弃但其它项保留', () => {
  const result = normalizeSettings({
    theme: 'glass',
    background: { mode: 'color', value: 'not a color; }' },
    fonts: { text: 'Inter, sans-serif', code: 'bad; }' },
    fontSizes: { text: 16, code: 999 },
    fieldColors: { foreground: '#123456', border: 'nope; }' },
    glass: { blur: 40, saturate: 9999 },
  }, normalizeOptions)

  assert.equal(result.theme, 'glass')
  assert.equal(result.fonts.text, 'Inter, sans-serif')
  assert.equal(result.fonts.code, undefined, '非法字体应被丢弃')
  assert.equal(result.fontSizes.text, 16)
  assert.equal(result.fontSizes.code, undefined, '超范围字号应被丢弃')
  assert.equal(result.fieldColors.foreground, '#123456')
  assert.equal(result.fieldColors.border, undefined, '非法颜色应被丢弃')
  assert.equal(result.glass.blur, 40)
  assert.equal(result.glass.saturate, undefined, '超范围饱和度应被丢弃')
})

test('未知主题 id 被丢弃', () => {
  assert.equal(normalizeSettings({ theme: 'not-a-theme' }, normalizeOptions).theme, undefined)
  assert.equal(normalizeSettings({ theme: 'zcode-mono' }, normalizeOptions).theme, 'zcode-mono')
})

test('全默认设置不产生噪音字段', () => {
  const result = normalizeSettings({}, normalizeOptions)
  assert.deepEqual(result, {})
  assert.deepEqual(normalizeSettings(defaultSettings(), normalizeOptions), {})
})

test('设置文件原子写入后可读回', () => withTempDir((dir) => {
  const file = join(dir, 'settings.json')
  const payload = { theme: 'glass', fonts: { text: 'Inter' } }
  const result = writeSettingsFile(file, payload)
  assert.equal(result.ok, true)
  assert.deepEqual(readSettingsFile(file), payload)
  // 不应残留临时文件
  assert.equal(existsSync(`${file}.tmp`), false)
}))

test('损坏的设置文件返回 null 而不抛错', () => withTempDir((dir) => {
  const file = join(dir, 'settings.json')
  writeFileSync(file, '{ not json')
  assert.equal(readSettingsFile(file), null)
}))

test('loadSettings 对缺失文件回落为空设置', () => withTempDir((dir) => {
  const loaded = loadSettings(join(dir, 'nope.json'), normalizeOptions)
  assert.deepEqual(loaded.settings, {})
  assert.equal(loaded.hasFile, false)
}))

test('背景图落盘与读回', () => withTempDir((dir) => {
  const settingsPath = join(dir, 'settings.json')
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const saved = saveBackgroundImage(settingsPath, { mime: 'image/png', data: png }, '1700000000000')
  assert.equal(saved.ok, true)
  assert.equal(saved.file, 'bg-1700000000000.png')
  assert.ok(existsSync(join(backgroundDir(settingsPath), saved.file)))

  const read = readBackgroundImage(settingsPath, saved.file)
  assert.equal(read.ok, true)
  assert.equal(read.mime, 'image/png')
  assert.deepEqual([...read.data], [...png])
}))

test('背景图拒绝不支持的 MIME 与超限字节', () => withTempDir((dir) => {
  const settingsPath = join(dir, 'settings.json')
  assert.equal(saveBackgroundImage(settingsPath, { mime: 'image/svg+xml', data: Buffer.from('x') }).ok, false)
  assert.equal(saveBackgroundImage(settingsPath, { mime: 'image/png', data: Buffer.alloc(0) }).ok, false)
  const huge = Buffer.alloc(MAX_BACKGROUND_BYTES + 1)
  assert.equal(saveBackgroundImage(settingsPath, { mime: 'image/png', data: huge }).ok, false)
}))

test('读取背景图拒绝路径穿越', () => {
  assert.equal(readBackgroundImage('/tmp/none/settings.json', '../../etc/passwd').ok, false)
  assert.equal(readBackgroundImage('/tmp/none/settings.json', 'a/b.png').ok, false)
  assert.equal(readBackgroundImage('/tmp/none/settings.json', 'x.exe').ok, false)
})

test('支持的图片格式清单非空且完整', () => {
  const keys = Object.keys(BACKGROUND_MIME)
  assert.ok(keys.length >= 4)
  for (const key of keys) assert.match(key, /^image\//)
})

test('customCss：纯色背景写在 body 上（不会被玻璃壁纸盖住）', () => {
  const css = customCss({ background: { mode: 'color', value: '#123456' } })
  assert.match(css, /background-color: #123456;/)
  // 必须落在 body 块：写 html 会被玻璃主题画在 body 上的壁纸整层盖住
  assert.match(css, /:is\(html\[data-theme-studio\], html:root\) body \{\s*background-color: #123456;/)
  assert.match(css, /:is\(html\[data-theme-studio\], html:root\) body\[data-ds-dark-theme\] \{\s*background-color: #123456;/)
})

test('customCss：图片背景含 URL 与铺满方式，且写在 body 上', () => {
  const css = customCss(
    { background: { mode: 'image', file: 'bg.png', fit: 'contain', opacity: 100 } },
    { backgroundUrl: '/api/x/bg.png' },
  )
  assert.match(css, /url\("\/api\/x\/bg\.png"\)/)
  assert.match(css, /background-size: contain;/)
  assert.match(css, /background-repeat: no-repeat;/)
  // 背景图同样必须挂在 body 上
  assert.match(css, /:is\(html\[data-theme-studio\], html:root\) body \{\s*background-image: url\("\/api\/x\/bg\.png"\)/)
})

/**
 * 不透明度必须用**背景盖层**实现，不能用 `::before` 蒙版。
 *
 * 旧实现生成 `body::before { z-index:-1; opacity:… }`，它只有在「body 自己建立了
 * 层叠上下文」时才画在背景图前面。宿主当前碰巧在 body 上写了 `isolation:isolate`，
 * 但那是实现细节而非插件契约：一旦宿主改掉，蒙版就跑到背景图**后面**，
 * 不透明度看起来完全没生效，而且不报错、不告警，只能靠肉眼发现。
 *
 * 盖层与图片同属 body 的多层背景，绘制顺序由声明顺序决定，不依赖任何宿主前提。
 */
test('customCss：不透明度用背景盖层，不用 body::before 蒙版', () => {
  const css = customCss(
    { background: { mode: 'image', file: 'bg.png', fit: 'cover', opacity: 60 } },
    { backgroundUrl: '/api/x/bg.png' },
  )
  // 盖层：把主题画布色调到 40% 不透明，叠在图片之上（声明在前 = 绘制在上）。
  assert.match(css, /background-image: linear-gradient\(color-mix\(in srgb, var\(--color-background[^;]*40%, transparent\)/)
  assert.match(css, /url\("\/api\/x\/bg\.png"\)/)
  // 两层背景必须各自给出尺寸/重复/位置，否则图片层会继承盖层的取值。
  assert.match(css, /background-size: 100% 100%, cover;/)
  assert.match(css, /background-repeat: no-repeat, no-repeat;/)
  assert.match(css, /background-position: center center, center center;/)
  // 不能有蒙版伪元素，也不能给 body 加 opacity（后者会把整个应用变透明）。
  assert.equal(css.includes('body::before'), false, '不应再生成 ::before 蒙版')
  assert.equal(/body\s*\{[^}]*\bopacity:/.test(css), false, '不应给 body 加 opacity')
})

test('customCss：不透明度 100 时不生成盖层（保持单层背景）', () => {
  const css = customCss(
    { background: { mode: 'image', file: 'bg.png', fit: 'cover', opacity: 100 } },
    { backgroundUrl: '/api/x/bg.png' },
  )
  assert.match(css, /background-image: url\("\/api\/x\/bg\.png"\);/)
  assert.equal(css.includes('linear-gradient'), false, '不透明度 100 不该有盖层')
  assert.equal(css.includes('color-mix'), false, '不透明度 100 不该有色混合')
})

test('customCss：盖层变量必须有 fallback（不选主题时 --color-background 未定义）', () => {
  const css = customCss(
    { background: { mode: 'image', file: 'bg.png', opacity: 50 } },
    { backgroundUrl: '/api/x/bg.png' },
  )
  // 变量未定义会让整条 background-image 在 computed-value 阶段失效，
  // 背景图直接消失——比不透明度不准严重得多，所以 fallback 是硬要求。
  assert.match(css, /var\(--color-background, var\(--dsw-alias-bg-base, #808080\)\)/)
})

test('customCss：字体同时覆盖四个别名', () => {
  const css = customCss({ fonts: { text: 'Inter', code: 'Fira Code' } })
  for (const token of ['--dsw-font-family', '--ds-font-family-code', '--dsw-font-family-mono', '--dsw-font-mono', '--dsw-font-code']) {
    assert.match(css, new RegExp(`${token}: `), `缺少 ${token}`)
  }
})

test('customCss：字段色同时写 body 与暗色 body', () => {
  const css = customCss({ fieldColors: { foreground: '#010203' } })
  assert.match(css, /:is\(html\[data-theme-studio\], html:root\) body \{[\s\S]*--color-foreground: #010203;/)
  assert.match(css, /body\[data-ds-dark-theme\] \{[\s\S]*--color-foreground: #010203;/)
})

test('customCss：字段色同时覆盖宿主层 Token', () => {
  const css = customCss({ fieldColors: { foreground: '#010203', background: '#040506' } })
  // 宿主自绘组件读的是 --dsw-*，只改语义层会「改了一半」
  assert.match(css, /--dsw-alias-label-primary: #010203;/)
  assert.match(css, /--dsw-alias-bg-base: #040506;/)
})

test('hostTokensFor 从映射表反查，不手抄', () => {
  const tokens = hostTokensFor('foreground')
  assert.ok(tokens.includes('--dsw-alias-label-primary'))
  // 反查结果必须与映射表一致
  for (const token of tokens) {
    assert.equal(HOST_TOKEN_MAP[token].light, 'foreground', `${token} 并不映射到 foreground`)
  }
  // 每个字段色角色都至少有一个宿主 Token
  for (const key of FIELD_COLOR_KEYS) {
    assert.ok(hostTokensFor(key).length > 0, `${key} 没有任何宿主 Token 映射`)
  }
})

test('customCss：空设置产出空字符串', () => {
  assert.equal(customCss({}), '')
  assert.equal(customCss(defaultSettings()), '')
})

test('字段色角色清单覆盖核心语义', () => {
  for (const key of ['foreground', 'background', 'border', 'brand', 'primary']) {
    assert.ok(FIELD_COLOR_KEYS.includes(key), `字段色角色缺 ${key}`)
  }
})

test('customCss 产物能被真实文件行数校验（无注入残留）', () => withTempDir((dir) => {
  const css = customCss({
    background: { mode: 'color', value: '#abcdef' },
    fonts: { text: 'Inter' },
    fieldColors: { border: '#333333' },
  })
  const file = join(dir, 'out.css')
  writeFileSync(file, css)
  const text = readFileSync(file, 'utf8')
  // 大括号必须配平，否则整份样式表会被提前闭合
  const open = (text.match(/\{/g) ?? []).length
  const close = (text.match(/\}/g) ?? []).length
  assert.equal(open, close, '大括号不配平，CSS 会被提前闭合')
}))
