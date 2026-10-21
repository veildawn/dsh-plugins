/**
 * 主题工作室的设置读写。
 *
 * 设置文件保存用户对视听的**全部**自定义：选了哪款主题、背景（纯色或图片）、
 * 字体、字段色、字号、玻璃模糊强度。
 *
 * 路径：`~/.dsh/theme-studio/settings.json`（与仓库内其它插件的设置模式一致）。
 * 之所以放服务端而不是 localStorage：背景图需要落地成文件，且桌面端（Electron）
 * 与 Web 端要看到同一份配置。
 *
 * ## 设计约束
 *
 * - **每个字段都可缺省**：缺省即「跟随主题」，不写默认值到磁盘。这样主题升级
 *   后用户能自动拿到新配色，不会被一份陈旧的默认值锁死。
 * - **写入前必须校验**：设置来自前端表单与手改文件两个入口，两者都可能传来
 *   非法值（负数字号、`url(javascript:)`、超长字符串）。校验失败的项被丢弃而
 *   不是整体拒绝——用户改错一个字段不该丢掉其它设置。
 * - **颜色只接受可安全嵌入 CSS 的形式**：`#rgb`/`#rrggbb`/`#rrggbbaa`、
 *   `rgba()`/`rgb()`、`hsl()`/`hsla()`、以及有限的 `color-mix()`。拒绝任何
 *   含 `;` `}` `<` 或换行的输入，防止把设置文件当 CSS 注入点。
 *
 * @module dsh-theme-studio/settings
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'
import { HOST_TOKEN_MAP, resolveKey } from './tokens.js'
import { getTheme } from './themes/index.js'

/** 默认设置文件位置。 */
export const DEFAULT_SETTINGS_PATH = path.join(homedir(), '.dsh', 'theme-studio', 'settings.json')

/** 背景图的子目录（相对设置文件所在目录）。 */
export const BACKGROUND_DIR = 'backgrounds'

/** 背景图最大字节数（8 MB）。超过就是用户误传了大图，不是主题该背的包袱。 */
export const MAX_BACKGROUND_BYTES = 8 * 1024 * 1024

/** 允许的背景图 MIME → 扩展名。 */
export const BACKGROUND_MIME = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
})

/** 字体名的最大长度（一个大字体栈足够，再长就是垃圾输入）。 */
const MAX_FONT_LENGTH = 512

/** 字段色的语义角色：设置面板里逐项可改。 */
export const FIELD_COLOR_ROLES = Object.freeze([
  { key: 'foreground', label: '正文文字', variable: '--color-foreground' },
  { key: 'foreground-subtle', label: '次级文字', variable: '--color-foreground-subtle' },
  { key: 'foreground-subtlest', label: '辅助文字', variable: '--color-foreground-subtlest' },
  { key: 'background', label: '画布背景', variable: '--color-background' },
  { key: 'panel', label: '面板背景', variable: '--color-panel' },
  { key: 'card', label: '卡片背景', variable: '--color-card' },
  { key: 'input', label: '输入框背景', variable: '--color-input' },
  { key: 'border', label: '边框', variable: '--color-border' },
  { key: 'brand', label: '品牌强调', variable: '--color-brand' },
  { key: 'primary', label: '主操作填充', variable: '--color-primary' },
  { key: 'primary-foreground', label: '主操作文字', variable: '--color-primary-foreground' },
])

/** 字段色角色的 key 列表（校验用）。 */
export const FIELD_COLOR_KEYS = Object.freeze(FIELD_COLOR_ROLES.map((role) => role.key))

/**
 * 某个语义键在宿主层对应的 `--dsw-*` 名单。
 *
 * 从 `HOST_TOKEN_MAP` 反查，不手抄：新增映射时自动跟随。
 *
 * 为什么需要它：用户改「正文文字」时，主题 CSS 读的是 `--color-foreground`，
 * 但**宿主自绘的组件**读的是 `--dsw-alias-label-primary`。只改语义层的话，
 * 宿主原生组件（输入框、菜单、对话框标题等）会停在旧配色上，
 * 表现为「改了一半」——这是字段色最容易踩的坑。
 *
 * @param {string} key 语义键
 * @returns {string[]} 宿主 Token 名
 */
export function hostTokensFor(key) {
  return Object.entries(HOST_TOKEN_MAP)
    .filter(([, modes]) => modes.light === key)
    .map(([name]) => name)
}

/**
 * 把设置文件路径展开成绝对路径（支持 `~/`）。
 *
 * @param {string | undefined} value
 * @returns {string}
 */
export function resolveSettingsPath(value) {
  if (typeof value !== 'string' || value.trim() === '') return DEFAULT_SETTINGS_PATH
  const trimmed = value.trim()
  if (trimmed === '~' || trimmed.startsWith('~/')) return path.join(homedir(), trimmed.slice(1))
  return path.resolve(trimmed)
}

/**
 * 颜色值校验。**白名单式**：只放行明确认识的语法，其余一律丢弃。
 *
 * @param {unknown} value
 * @returns {string | null} 规范化后的颜色，或 null（非法）
 */
export function normalizeColor(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '' || text.length > 128) return null
  // 任何会提前闭合声明块 / 标签的字符都是注入面，直接拒绝
  if (/[;{}<>\\\r\n]/.test(text)) return null

  if (/^#[0-9a-fA-F]{3}$/.test(text)) return text
  if (/^#[0-9a-fA-F]{4}$/.test(text)) return text
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text
  if (/^#[0-9a-fA-F]{8}$/.test(text)) return text

  // rgb() / rgba() / hsl() / hsla()：只允许数字、逗号、百分号、空格、斜杠、点
  if (/^(rgba?|hsla?)\(\s*[0-9a-zA-Z.%\s,/+-]+\)$/i.test(text)) return text

  // color-mix()：允许 `#hex`、嵌套函数与百分比。字符集严格受限，
  // 但必须包含 `#`（色值）与 `.`（小数百分比）。
  if (/^color-mix\([0-9a-zA-Z#().,%\s/+-]+\)$/i.test(text)) return text

  // 具名色：只接受纯字母（transparent、currentColor 等）
  if (/^[a-zA-Z]{3,24}$/.test(text)) return text

  return null
}

/**
 * 字体栈校验。
 *
 * 前端传来的是一整串 CSS font-family（例如 `"PingFang SC", sans-serif`）。
 * 这里不允许 `;` `}` 之类的注入字符，也不允许 url()/var()——字体名不该带函数。
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeFontFamily(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '') return ''
  if (text.length > MAX_FONT_LENGTH) return null
  if (/[;{}<>\\\r\n]/.test(text)) return null
  if (/url\s*\(/i.test(text)) return null
  return text
}

/**
 * 字号校验：整数 px，落在 [min, max] 内。
 *
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @returns {number | null}
 */
export function normalizeFontSize(value, min, max) {
  const num = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(num)) return null
  if (!Number.isInteger(num)) return null
  if (num < min || num > max) return null
  return num
}

/**
 * 背景配置规范化。
 *
 * 支持三种模式：
 *   - `none`：不覆盖，用主题自身的画布；
 *   - `color`：纯色背景，`value` 是颜色；
 *   - `image`：图片背景，`file` 是上传后的文件名（不含路径，防目录穿越），
 *     `value` 是降级底色（图片加载失败或半透明区域用的底色）。
 *
 * @param {unknown} raw
 * @returns {{ mode: 'none' | 'color' | 'image', value: string, file: string | null, fit: string, opacity: number }}
 */
export function normalizeBackground(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const mode = source.mode === 'color' || source.mode === 'image' ? source.mode : 'none'
  const color = normalizeColor(source.value) ?? ''
  const fit = ['cover', 'contain', 'repeat'].includes(source.fit) ? source.fit : 'cover'
  const opacityRaw = Number(source.opacity)
  const opacity = Number.isFinite(opacityRaw) ? Math.min(100, Math.max(0, Math.round(opacityRaw))) : 100

  let file = null
  if (mode === 'image' && typeof source.file === 'string') {
    // 只允许纯文件名：任何路径分隔符或上级引用都拒绝，避免越出 backgrounds/
    const name = source.file.trim()
    if (name !== '' && !/[/\\]/.test(name) && !name.includes('..') && /^[a-zA-Z0-9._-]+$/.test(name)) {
      file = name
    }
  }

  return { mode, value: color, file, fit, opacity }
}

/**
 * 完整设置的默认值。**所有字段都可缺省**，这里只描述结构。
 */
export function defaultSettings() {
  return {
    theme: undefined,
    background: { mode: 'none', value: '', file: null, fit: 'cover', opacity: 100 },
    fonts: { text: '', code: '' },
    fontSizes: {},
    fieldColors: {},
    glass: {},
  }
}

/**
 * 校验并规范化整份设置。
 *
 * 校验失败的**单项**会被丢弃（返回 undefined），而不是让整次保存失败——
 * 用户在设置面板里改错一个颜色，不该连带丢掉刚选的背景图。
 *
 * @param {unknown} raw
 * @param {{ isThemeId?: (id: string) => boolean, fontSizeRanges?: Record<string, { min: number, max: number }> }} [options]
 * @returns {object}
 */
export function normalizeSettings(raw, options = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const { isThemeId, fontSizeRanges = {} } = options
  const out = {}

  if (typeof source.theme === 'string' && (!isThemeId || isThemeId(source.theme))) {
    out.theme = source.theme
  }

  const background = normalizeBackground(source.background)
  // 只有确实改动了才落盘：全默认值的 background 不写，避免设置文件噪音
  if (background.mode !== 'none' || background.value !== '' || background.file !== null) {
    out.background = background
  }

  const fontsSource = source.fonts && typeof source.fonts === 'object' ? source.fonts : {}
  const fonts = {}
  for (const key of ['text', 'code']) {
    const value = normalizeFontFamily(fontsSource[key])
    if (value !== null && value !== '') fonts[key] = value
  }
  if (Object.keys(fonts).length > 0) out.fonts = fonts

  const sizesSource = source.fontSizes && typeof source.fontSizes === 'object' ? source.fontSizes : {}
  const sizes = {}
  for (const [key, range] of Object.entries(fontSizeRanges)) {
    const value = normalizeFontSize(sizesSource[key], range.min, range.max)
    if (value !== null) sizes[key] = value
  }
  if (Object.keys(sizes).length > 0) out.fontSizes = sizes

  const colorsSource = source.fieldColors && typeof source.fieldColors === 'object' ? source.fieldColors : {}
  const colors = {}
  for (const key of FIELD_COLOR_KEYS) {
    const value = normalizeColor(colorsSource[key])
    if (value !== null) colors[key] = value
  }
  if (Object.keys(colors).length > 0) out.fieldColors = colors

  const glassSource = source.glass && typeof source.glass === 'object' ? source.glass : {}
  const glass = {}
  const blur = Number(glassSource.blur)
  if (Number.isFinite(blur) && blur >= 0 && blur <= 80) glass.blur = Math.round(blur)
  const saturate = Number(glassSource.saturate)
  if (Number.isFinite(saturate) && saturate >= 100 && saturate <= 300) glass.saturate = Math.round(saturate)
  if (Object.keys(glass).length > 0) out.glass = glass

  return out
}

/** 读取设置文件；缺失或损坏时返回 null（由调用方兜底为空设置）。 */
export function readSettingsFile(filePath) {
  try {
    if (!existsSync(filePath)) return null
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * 原子写入设置文件。
 *
 * 先写 `.tmp` 再 `rename`：进程在写入中途被杀掉时，磁盘上要么是旧文件、
 * 要么是新文件，不会出现半个 JSON。这一点很重要——设置文件损坏会让插件
 * 每次启动都回落到默认值，用户会以为「设置没保存」。
 *
 * @param {string} filePath
 * @param {object} settings
 * @returns {{ ok: boolean, error?: string }}
 */
export function writeSettingsFile(filePath, settings) {
  const tmp = `${filePath}.tmp`
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
    renameSync(tmp, filePath)
    return { ok: true }
  } catch (error) {
    try {
      if (existsSync(tmp)) renameSync(tmp, `${tmp}.stale`)
    } catch {
      // 清理失败不影响主流程：真正的错误在下面返回
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 加载设置（已规范化）。
 *
 * @param {string} [filePath]
 * @param {object} [options] 与 normalizeSettings 相同
 * @returns {{ settings: object, path: string, hasFile: boolean }}
 */
export function loadSettings(filePath, options = {}) {
  const resolved = resolveSettingsPath(filePath)
  const raw = readSettingsFile(resolved)
  return {
    settings: normalizeSettings(raw ?? {}, options),
    path: resolved,
    hasFile: raw !== null,
  }
}

/** 背景图目录的绝对路径（与设置文件同级）。 */
export function backgroundDir(settingsPath) {
  return path.join(path.dirname(resolveSettingsPath(settingsPath)), BACKGROUND_DIR)
}

/**
 * 把上传的背景图数据写成文件。
 *
 * @param {string} settingsPath 设置文件路径（决定背景图落盘位置）
 * @param {{ mime: string, data: Buffer | Uint8Array }} upload
 * @param {string} [stamp] 文件名时间戳（测试注入固定值用）
 * @returns {{ ok: true, file: string } | { ok: false, error: string }}
 */
export function saveBackgroundImage(settingsPath, upload, stamp = String(Date.now())) {
  const mime = typeof upload?.mime === 'string' ? upload.mime.toLowerCase() : ''
  const ext = BACKGROUND_MIME[mime]
  if (!ext) {
    return { ok: false, error: `不支持的图片类型：${mime || '(未声明)'}，可选 ${Object.keys(BACKGROUND_MIME).join(' / ')}` }
  }
  const data = upload?.data
  if (!data || typeof data.length !== 'number' || data.length === 0) {
    return { ok: false, error: '背景图内容为空' }
  }
  if (data.length > MAX_BACKGROUND_BYTES) {
    return {
      ok: false,
      error: `背景图 ${(data.length / 1024 / 1024).toFixed(1)}MB 超过上限 ${MAX_BACKGROUND_BYTES / 1024 / 1024}MB`,
    }
  }
  const dir = backgroundDir(settingsPath)
  const name = `bg-${stamp.replace(/[^a-zA-Z0-9]/g, '')}.${ext}`
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, name), data)
    return { ok: true, file: name }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 读取已保存的背景图字节（供 Web 路由回传）。
 *
 * @param {string} settingsPath
 * @param {string} file
 * @returns {{ ok: true, data: Buffer, mime: string } | { ok: false, error: string }}
 */
export function readBackgroundImage(settingsPath, file) {
  // 再校验一次：路由层是外部输入入口，不能只依赖 normalizeBackground
  if (typeof file !== 'string' || file === '' || /[/\\]/.test(file) || file.includes('..')) {
    return { ok: false, error: '非法文件名' }
  }
  const match = /\.([a-z0-9]+)$/i.exec(file)
  const ext = match ? match[1].toLowerCase() : ''
  const mime = Object.entries(BACKGROUND_MIME).find(([, value]) => value === ext)?.[0]
  if (!mime) return { ok: false, error: '未知图片类型' }
  const full = path.join(backgroundDir(settingsPath), file)
  try {
    if (!existsSync(full)) return { ok: false, error: '背景图不存在' }
    const data = readFileSync(full)
    if (data.length > MAX_BACKGROUND_BYTES) return { ok: false, error: '背景图超过上限' }
    return { ok: true, data, mime }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 把设置编译成注入 CSS。
 *
 * 输出两层：
 *   1. `html[data-theme-studio]` —— 主题无关的自定义（背景图、背景色、字体）；
 *   2. `html[data-theme-studio] body[data-ds-dark-theme]` —— 暗色下的同项覆盖。
 *
 * 为什么自定义层必须排在主题变量之后：它代表「用户的最终决定」，要能压过
 * 主题内置值。同一特异性下后写者胜，所以注入顺序是 主题变量 → 自定义层。
 *
 * @param {object} settings 已规范化的设置
 * @param {{ backgroundUrl?: string }} [options]
 * @returns {string}
 */
export function customCss(settings, options = {}) {
  const lines = []
  const backgroundLines = []
  const background = settings.background ?? { mode: 'none' }

  // 背景必须写在 `body` 上，不能写在 `html` 上。
  //
  // 原因：玻璃主题的「壁纸」渐变画在 body（见 glass.css），而 body 比 html
  // 更靠近所有内容——写在 html 上的背景会被 body 的壁纸整层盖住，用户设了
  // 图片却看不到，表现是「上传成功但界面没变」。写 body 后，自定义层
  // （注入顺序最后）自然压过主题壁纸。
  if (background.mode === 'color' && background.value) {
    backgroundLines.push(`  background-color: ${background.value};`)
    backgroundLines.push('  background-image: none;')
  } else if (background.mode === 'image' && options.backgroundUrl) {
    const fit = background.fit === 'contain' ? 'contain' : background.fit === 'repeat' ? 'auto' : 'cover'
    const repeat = background.fit === 'repeat' ? 'repeat' : 'no-repeat'
    if (background.value) backgroundLines.push(`  background-color: ${background.value};`)
    backgroundLines.push(`  background-image: url("${options.backgroundUrl}");`)
    backgroundLines.push(`  background-size: ${fit};`)
    backgroundLines.push(`  background-repeat: ${repeat};`)
    backgroundLines.push('  background-position: center center;')
    backgroundLines.push('  background-attachment: fixed;')
  }
  const hasBackgroundImage = backgroundLines.length > 0 && background.mode === 'image'

  if (settings.fonts?.text) lines.push(`  --dsw-font-family: ${settings.fonts.text};`)
  if (settings.fonts?.code) {
    lines.push(`  --ds-font-family-code: ${settings.fonts.code};`)
    lines.push(`  --dsw-font-family-mono: ${settings.fonts.code};`)
    lines.push(`  --dsw-font-mono: ${settings.fonts.code};`)
    lines.push(`  --dsw-font-code: ${settings.fonts.code};`)
  }
  if (settings.fontSizes?.text) {
    lines.push(`  --dsh-content-font-size: ${settings.fontSizes.text}px;`)
    lines.push(`  --ui-font-size: ${settings.fontSizes.text}px;`)
  }
  if (settings.fontSizes?.code) lines.push(`  --dsh-code-font-size: ${settings.fontSizes.code}px;`)
  if (settings.fontSizes?.terminal) lines.push(`  --dsh-terminal-font-size: ${settings.fontSizes.terminal}px;`)

  if (settings.glass?.blur !== undefined) lines.push(`  --ts-blur: ${settings.glass.blur}px;`)
  if (settings.glass?.saturate !== undefined) lines.push(`  --ts-saturate: ${settings.glass.saturate}%;`)

  // 字段色：同时覆盖语义层与宿主层。
  //
  // 只改语义层 `--color-*` 是不够的：主题 CSS 全部读语义层，所以主题自己画的
  // 组件会跟随；但**宿主自绘的组件**读 `--dsw-*`（它自己那份映射），
  // 看不到变化。两处都写，用户改一次「正文文字」，整个界面（含宿主原生控件）
  // 才一起变。
  const fieldLines = []
  for (const role of FIELD_COLOR_ROLES) {
    const value = settings.fieldColors?.[role.key]
    if (!value) continue
    fieldLines.push(`  ${role.variable}: ${value};`)
    for (const token of hostTokensFor(role.key)) {
      fieldLines.push(`  ${token}: ${value};`)
    }
  }

  let css = ''
  if (lines.length > 0) {
    css += `html[data-theme-studio] {\n${lines.join('\n')}\n}\n`
  }
  if (backgroundLines.length > 0) {
    // 背景挂 body：玻璃主题的壁纸也在 body 上，同级且自定义层后注入 → 压过它。
    // 暗色块同样要写，否则宿主 `body[data-ds-dark-theme]` 上的规则会在暗色下回弹。
    css += `html[data-theme-studio] body {\n${backgroundLines.join('\n')}\n}\n`
    css += `html[data-theme-studio] body[data-ds-dark-theme] {\n${backgroundLines.join('\n')}\n}\n`
  }
  if (fieldLines.length > 0) {
    // 字段色挂在 body 上：宿主的 --dsw-* 定义在 body / body[data-ds-dark-theme]，
    // 语义 --color-* 定义在我们的主题块里。挂在 html 上会被宿主的 body 规则
    // 反向压掉，挂到 body 才与之同级且后写者胜。
    css += `html[data-theme-studio] body {\n${fieldLines.join('\n')}\n}\n`
    // 宿主暗色块的特异性是 (0,1,1)，下面这条 (0,1,2) 压过它。
    css += `html[data-theme-studio] body[data-ds-dark-theme] {\n${fieldLines.join('\n')}\n}\n`
  }
  if (hasBackgroundImage && background.opacity < 100) {
    // 图片透明度：只用 ::before 叠一层半透明白/黑，而不是改元素本身的 opacity
    // ——改元素 opacity 会连带把子元素（整个应用）一起变透明。
    css +=
      `html[data-theme-studio] body::before {\n` +
      `  content: "";\n` +
      `  position: fixed;\n` +
      `  inset: 0;\n` +
      `  pointer-events: none;\n` +
      `  z-index: -1;\n` +
      `  background: var(--color-background);\n` +
      `  opacity: ${((100 - background.opacity) / 100).toFixed(2)};\n` +
      `}\n`
  }

  return css
}
