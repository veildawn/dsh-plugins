/**
 * 主题继承与合并。
 *
 * 变体主题（ZCode 单色极简、玻璃彩色）不重抄整份色板，只声明与基座不同的键，
 * 由 `inheritPalette()` 做一层浅合并。这保证：
 *   - 变体永远不会漏掉某个语义键（基座补齐），主题作者只写「哪里不一样」；
 *   - 基座色板升级（例如 ZCode 上游漂移）自动传导到所有变体，无需逐份改。
 *
 * 合并是**逐键**的：变体给出 `{ light, dark }` 就整体替换该键，不做字段级合并，
 * 避免出现「亮色取变体、暗色取基座」这种不自然的中间态。
 *
 * @module dsh-theme-studio/themes/inherit
 */

/**
 * 把变体色板合并到基座色板上。
 *
 * @param {Record<string, unknown>} base 基座色板
 * @param {Record<string, unknown>} [variant] 变体覆盖（可缺省）
 * @returns {Record<string, unknown>} 合并后的新对象（不修改入参）
 */
export function inheritPalette(base, variant = {}) {
  const merged = { ...base }
  for (const [key, value] of Object.entries(variant)) {
    merged[key] = value
  }
  return merged
}

/**
 * 合并材质覆盖。基座材质已含默认值，变体只需给出差异项。
 *
 * @param {Record<string, string>} base
 * @param {Record<string, string>} [variant]
 * @returns {Record<string, string>}
 */
export function inheritMaterial(base, variant = {}) {
  return { ...base, ...variant }
}

/**
 * 计算两个色板的差异键集合，供测试与文档使用。
 *
 * @param {Record<string, unknown>} base
 * @param {Record<string, unknown>} variant
 * @returns {string[]}
 */
export function paletteDiffKeys(base, variant) {
  return Object.keys(variant).filter((key) => !(key in base) || !sameEntry(base[key], variant[key]))
}

function sameEntry(a, b) {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  return a.light === b.light && a.dark === b.dark
}
