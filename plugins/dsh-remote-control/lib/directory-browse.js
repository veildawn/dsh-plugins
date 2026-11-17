/**
 * 远程浏览器的目录列举能力（插件自备的 browse 后端）。
 *
 * 为什么需要它：宿主用 `@deepseek-ai/dsh-host-directory-picker-auto` 在**启动时**
 * 一次性决定 directory-picker 的后端。桌面端宿主把 `--host 127.0.0.1` 写死，且没有
 * 任何非回环 `trustedHosts`，于是判定落到 `native`，挂载的是「在宿主机器屏幕上弹
 * 系统对话框」的那个后端。这个决定对整个 boot 只做一次、所有客户端共用，因此通过
 * 本插件反向代理进来的局域网浏览器也拿到同一个人面——点「添加工作区」，系统文件
 * 选择框弹在**桌面端本机**，远程浏览器这边看起来什么都没发生。
 *
 * 宿主的判定条件（远程 authority / 非回环绑定）没有「插件开了远程访问」这一项，
 * 插件改不了它，也不该改（改宿主 `webserver.host` 会让 Electron 应用起不来）。
 * 因此这里由插件自己在宿主机上提供等价的 browse 原语：一级目录列举 + 子目录创建，
 * 让远程浏览器的「添加工作区」在页面内完成。
 *
 * 权限边界与宿主 browse 后端一致：能列举整个文件系统的目录、能在已列出的目录下
 * 建子目录；调用方必须持有官方浏览器会话（见 index.js 的路由鉴权）。
 *
 * @module dsh-remote-control/directory-browse
 */
import { mkdir, opendir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, posix, resolve, win32 } from 'node:path'

/** 一次列举最多返回的子目录数，与宿主 browse 后端的默认上限一致。 */
export const DEFAULT_DIRECTORY_ENTRY_LIMIT = 1000

/** 目录操作的封闭失败码，客户端按码区分「读不了」和「目标已存在」。 */
export const DIRECTORY_BROWSE_FAILURES = Object.freeze({
  unreadable: 'directory-unreadable',
  exists: 'directory-exists',
  createFailed: 'directory-create-failed',
})

/**
 * 带封闭失败码的目录浏览错误。
 *
 * 宿主 browse 后端用同名错误（`DirectoryPickerError`）表达同一组失败；本插件是
 * 独立包，不能依赖宿主的内部模块，所以自带一份等价的类型。
 */
export class DirectoryBrowseError extends Error {
  /**
   * @param {string} code - {@link DIRECTORY_BROWSE_FAILURES} 之一。
   * @param {string} path - 出问题的绝对路径。
   * @param {string} message - 给人看的说明。
   */
  constructor(code, path, message) {
    super(message)
    this.name = 'DirectoryBrowseError'
    this.code = code
    this.path = path
  }
}

/**
 * 判断路径是否完全限定，不依赖进程当前目录。
 *
 * POSIX 上只要绝对路径即可；Windows 上只接受盘符限定（`C:\…`）与完整 UNC
 * （`\\server\share…`）——`\foo`、`/foo` 这类「有根无盘」形式仍然会按进程当前盘
 * 解析，把它们当绝对路径会让一次列举落到用户没指定的位置。
 *
 * @param {unknown} target - 待判定路径。
 * @param {NodeJS.Platform} platform - 平台，测试可注入。
 * @returns {boolean} 是否完全限定。
 */
export function fullyQualified(target, platform = process.platform) {
  if (typeof target !== 'string' || target.length === 0) return false
  if (platform === 'win32') {
    return win32.isAbsolute(target) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(target)
  }
  return posix.isAbsolute(target)
}

/**
 * 从文件系统根到 `target`（含自身）的祖先链，供界面渲染面包屑。
 * 根节点的 basename 是空串，用完整路径当标签（`/`、`C:\`）。
 *
 * @param {string} target - 绝对路径。
 * @returns {{name: string, path: string, hidden: boolean}[]} 根在前的面包屑。
 */
export function ancestryCrumbs(target) {
  const crumbs = []
  let current = target
  for (;;) {
    const parent = dirname(current)
    crumbs.unshift({
      name: parent === current ? current : basename(current),
      path: current,
      hidden: false,
    })
    if (parent === current) return crumbs
    current = parent
  }
}

/** 未知抛出值的可读文本。 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 列举一层目录里的子目录。
 *
 * 只返回可进入的目录（符号链接按 `stat` 结果判定，断链与环链跳过），与宿主
 * browse 后端的选择一致：浏览器要展示的是「能进去的东西」。
 *
 * 截断语义与宿主一致：返回**按名字排序后最小的** `limit` 个，`truncated` 表示
 * 还有更多被略去。不能按文件系统遍历顺序截断——目录项顺序本身无定义，那样每次
 * 刷新看到的子集可能不同，被略掉的也不一定是字典序尾部。
 *
 * @param {string|undefined} target - 绝对目录；省略表示调用方的主目录。
 * @param {{limit?: number, home?: string, signal?: AbortSignal}} [options] - 上限、
 *   主目录覆盖（测试用）与取消信号（调用方断开时停止扫描）。
 * @returns {Promise<{path: string, home: string, crumbs: object[], entries: object[], truncated: boolean}>} 一级列举。
 */
export async function listDirectory(target, options = {}) {
  const home = options.home ?? homedir()
  const limit = Number.isInteger(options.limit) && options.limit > 0
    ? options.limit
    : DEFAULT_DIRECTORY_ENTRY_LIMIT
  const signal = options.signal
  if (target !== undefined && target !== null && !fullyQualified(target)) {
    throw new DirectoryBrowseError(
      DIRECTORY_BROWSE_FAILURES.unreadable,
      String(target),
      `cannot list "${String(target)}": not a fully qualified path`,
    )
  }
  const resolved = resolve(target ?? home)
  /** @type {{name: string, path: string, hidden: boolean}[]} */
  const candidates = []
  try {
    const level = await opendir(resolved)
    // for-await 在 break 与抛错时都会关闭句柄，无需手工 close。
    for await (const dirent of level) {
      // 远程页面已关闭 / 断线时不要再扫描：对不可达网络路径逐条 stat 会挂很久。
      signal?.throwIfAborted()
      let enterable = dirent.isDirectory()
      if (!enterable && dirent.isSymbolicLink()) {
        try {
          enterable = (await stat(join(resolved, dirent.name))).isDirectory()
        } catch {
          // 断链或环链：不可进入，跳过。
          enterable = false
        }
      }
      if (!enterable) continue
      candidates.push({
        name: dirent.name,
        path: join(resolved, dirent.name),
        hidden: dirent.name.startsWith('.'),
      })
    }
  } catch (error) {
    if (signal?.aborted) return { path: resolved, home, crumbs: ancestryCrumbs(resolved), entries: [], truncated: false }
    throw new DirectoryBrowseError(
      DIRECTORY_BROWSE_FAILURES.unreadable,
      resolved,
      `cannot list ${resolved}: ${messageOf(error)}`,
    )
  }
  candidates.sort((left, right) => left.name.localeCompare(right.name))
  const entries = candidates.length > limit ? candidates.slice(0, limit) : candidates
  return {
    path: resolved,
    home,
    crumbs: ancestryCrumbs(resolved),
    entries,
    truncated: candidates.length > limit,
  }
}

/**
 * 名字是否是 Windows 上会被静默规范化的形式。
 *
 * Win32 在 API 层会去掉每个路径部件**末尾的空格与点**，所以 `'.. '`、`'a.'`
 * 这类名字到不了文件系统就已被折叠：`join(parent, '.. ')` 仍是一段字符串，
 * 但 `CreateDirectoryW` 会把它当成 `..` 处理。逐项拒绝，别指望后端替我们挡。
 *
 * @param {string} name - 待判定的目录名。
 * @returns {boolean} 是否会被 Windows 规范化。
 */
function windowsNormalized(name) {
  return /[ .]$/.test(name)
}

/**
 * 在已存在的父目录下创建一个子目录。
 *
 * 非递归：父目录必须已经存在（界面上父目录正是用户看到的那个层级，父目录缺失是
 * 真失败，而不是可以替用户补出来的层级）。名字必须是单个路径段。
 *
 * @param {string} path - 绝对且已存在的父目录。
 * @param {string} name - 单个路径段名字。
 * @param {{signal?: AbortSignal}} [options] - 取消信号（调用方断开时放弃）。
 * @returns {Promise<string>} 新建目录的绝对路径。
 */
export async function createDirectory(path, name, options = {}) {
  if (!fullyQualified(path)) {
    throw new DirectoryBrowseError(
      DIRECTORY_BROWSE_FAILURES.createFailed,
      String(path),
      `cannot create under "${String(path)}": not a fully qualified parent path`,
    )
  }
  const rejected = typeof name !== 'string'
    || name.trim() === ''
    || name === '.'
    || name === '..'
    || /[/\\]/.test(name)
    || (process.platform === 'win32' && windowsNormalized(name))
  if (rejected) {
    throw new DirectoryBrowseError(
      DIRECTORY_BROWSE_FAILURES.createFailed,
      join(resolve(path), String(name)),
      `"${String(name)}" is not a single path segment`,
    )
  }
  const parent = resolve(path)
  const target = join(parent, name)
  try {
    await mkdir(target)
    return target
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') {
      throw new DirectoryBrowseError(DIRECTORY_BROWSE_FAILURES.exists, target, `${target} already exists`)
    }
    throw new DirectoryBrowseError(
      DIRECTORY_BROWSE_FAILURES.createFailed,
      target,
      `cannot create ${target}: ${messageOf(error)}`,
    )
  }
}
