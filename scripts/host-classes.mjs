// 共享的宿主 CSS Module 类名解析规则：harvest 脚本与主题防腐测试都用它，
// 保证「采集到什么」和「测试检查什么」是同一套判断。
//
// 宿主用 CSS Modules，类名形如 `<hash>_<local>`：
//   - hash 可能是 `2H3hWW`、`hHd-Xa`、`_7yHdaG`，甚至自带下划线的 `pI_x6G`；
//   - local 是 camelCase（`root`、`headerUtilities`、`tabActive`）。
// 所以不能只看第一个下划线：`pI_x6G_frame` 的唯一合法切分点是最后一个下划线。

/** CSS Module 的 local 名：字母开头的 camelCase，不含连字符与下划线。 */
const LOCAL = /^[A-Za-z][A-Za-z0-9]*$/

/** hash 段的合理长度（去掉前导下划线后计算）。 */
const MIN_HASH = 2
const MAX_HASH = 14

/**
 * 判断一个候选类名 token 是否是宿主 CSS Module 类名，并返回去掉前导下划线的规范形式。
 * @param {string} token - 例如 `wSkVaW_header`、`pI_x6G_frame`、`_7yHdaG_header`、`fv-scrim`。
 * @returns {string | undefined} 规范类名；不符合 CSS Module 形态时返回 undefined。
 */
export function normalizeHostClass(token) {
  if (typeof token !== 'string' || token.length < MIN_HASH + 2) return undefined
  const bare = token.startsWith('_') ? token.slice(1) : token
  // 连字符只允许出现在 hash 段；local 一旦含连字符就说明这是插件自己的类名（`fv-scrim`）。
  for (let at = bare.length - 1; at > 0; at -= 1) {
    if (bare[at] !== '_') continue
    const hash = bare.slice(0, at)
    const local = bare.slice(at + 1)
    if (!LOCAL.test(local)) continue
    if (hash.length < MIN_HASH || hash.length > MAX_HASH) return undefined
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(hash)) return undefined
    return `${hash}_${local}`
  }
  return undefined
}

/** 在一段源码里抽出全部宿主 CSS Module 类名（去重排序）。 */
export function hostClassesIn(text) {
  const found = new Set()
  // 类名字符集要包含 `-` 与 `_`，否则 `pI_x6G_frame` 会被截断成 `pI_x6G`。
  for (const match of text.matchAll(/\.(_?[A-Za-z0-9][A-Za-z0-9_-]*)/g)) {
    const normalized = normalizeHostClass(match[1])
    if (normalized !== undefined) found.add(normalized)
  }
  return [...found].sort()
}

/**
 * 统计每个 local 名在宿主里被多少个哈希前缀共用。
 * 只有 size === 1 的 local 才能裸写 `[class$="_local"]` 兜底：
 * `root` 这类名字在宿主里有 30+ 个组件共用，裸兜底会把样式糊到整个应用上。
 * @param {{ bundles: Record<string, string[]> }} fixture - 宿主类名快照。
 * @returns {Map<string, Set<string>>} local 名 → 共用它的哈希前缀集合。
 */
export function localUniqueness(fixture) {
  const byLocal = new Map()
  for (const list of Object.values(fixture.bundles)) {
    for (const cls of list) {
      // 从右往左切：hash 段可能自带下划线（`pI_x6G_centerCol`）。
      const at = cls.lastIndexOf('_')
      if (at <= 0) continue
      const local = cls.slice(at + 1)
      if (!byLocal.has(local)) byLocal.set(local, new Set())
      byLocal.get(local).add(cls.slice(0, at))
    }
  }
  return byLocal
}
