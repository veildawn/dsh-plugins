/**
 * 读取分文件主题 CSS，供 Host 注入 index.html 与测试扫描。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const STYLE_FILES = [
  'reset.css',
  'tokens.css',
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

/** 按规范目录顺序拼接全部主题 CSS。 */
export function loadThemeCss() {
  const dir = stylesDir()
  return STYLE_FILES.map((name) => readFileSync(join(dir, name), 'utf8')).join('\n')
}
