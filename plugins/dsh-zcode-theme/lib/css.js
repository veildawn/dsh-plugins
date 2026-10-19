/**
 * 读取分文件主题 CSS，供 Host 注入 index.html 与测试扫描。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tokensCss, zaiTokensCss } from './tokens.js'

export const STYLE_FILES = [
  'reset.css',
  'surfaces.css',
  'typography.css',
  'navigation.css',
  'sidebar.css',
  'chat.css',
  'composer.css',
  'buttons.css',
  'chips.css',
  'code.css',
  'terminal.css',
  'modal.css',
  'states.css',
  'motion.css',
]

export function stylesDir() {
  return join(dirname(fileURLToPath(import.meta.url)), 'styles')
}

/** 主题 CSS 里真正被 `var(--color-*)` 引用到的官方 Token 名。 */
export function referencedColorNames(sources) {
  const names = new Set()
  for (const text of sources) {
    for (const match of text.matchAll(/var\(--color-([a-z0-9-]+)/g)) names.add(match[1])
  }
  return names
}

/** 按规范目录顺序拼接全部主题 CSS。Token 由 tokens.js 生成。 */
export function loadThemeCss() {
  const dir = stylesDir()
  const files = STYLE_FILES.map((name) => readFileSync(join(dir, name), 'utf8'))
  // 只输出被主题 CSS 引用到的官方色：宿主本身不读 --color-*，其余 130 多项
  // 落地也是死变量。完整色板仍在 ZAI_PALETTE 里，由快照测试守护。
  return [zaiTokensCss([...referencedColorNames(files)]), tokensCss(), ...files].join('\n')
}
