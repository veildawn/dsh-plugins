/**
 * The file tree can be refreshed, as a whole and one directory at a time.
 *
 * The tree caches one listing per directory, which is what makes expanding feel
 * instant. The cost is that a file created outside the drawer — a shell command,
 * a checkout, another editor — never appears until the whole drawer is closed
 * and reopened. Reported as "左侧目录树需要支持刷新功能", then refined to
 * "目录级别的刷新是否能支持（在右键菜单里添加）".
 *
 * What a refresh must NOT do is just as important: collapsing the reader's
 * expanded directories, losing the scroll position, or blanking the tree while
 * the network answers would each make the control more annoying than the gap it
 * closes.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientSource = readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8')

/** The body of the shared refresh worker, delimited by the declaration after it. */
const workerBody = (() => {
  const start = clientSource.indexOf('const refreshDirectories = (dirs) => {')
  const end = clientSource.indexOf('/** Re-read the root and every expanded directory', start)
  assert.ok(start > 0 && end > start, 'the refresh worker is delimited')
  return clientSource.slice(start, end)
})()

test('the refresh control lives inside the 文件 tab', () => {
  assert.match(clientSource, /const \[refreshing, setRefreshing\] = react\.useState\(false\)/)
  assert.match(clientSource, /className: "fv-side-refresh"/)
  assert.match(clientSource, /"aria-label": "刷新目录"/)

  // It used to be a third flex sibling of the two tabs, which read as a third
  // view and stole width from both labels. It is now a child of the 文件 tab,
  // so it is unambiguously about the files pane and disappears with it.
  const tabsStart = clientSource.indexOf('const sideTabs = react.createElement')
  const tabsBody = clientSource.slice(tabsStart, clientSource.indexOf('/** The hash the pane is describing', tabsStart))
  const filesTabAt = tabsBody.indexOf('"文件"')
  const refreshAt = tabsBody.indexOf('side === "files" ? refreshButton : null')
  const gitTabAt = tabsBody.indexOf('"Git"')
  assert.ok(filesTabAt > 0 && refreshAt > 0 && gitTabAt > 0, 'all three markers exist')
  assert.ok(refreshAt > filesTabAt && refreshAt < gitTabAt,
    'the refresh renders inside the 文件 tab, before the Git tab')

  // Nested styling, not the old standalone square.
  assert.match(clientSource, /\.fv-side-tab \.fv-side-refresh\{/)
  assert.equal(/^\s*\.fv-side-refresh\{/m.test(clientSource), false,
    'no top-level rule that would style it as a sibling control')
})

test('a whole-tree refresh re-reads the root and every expanded directory', () => {
  const start = clientSource.indexOf('const refreshTree = () => {')
  const end = clientSource.indexOf('/**\n         * Re-read one directory from its context menu', start)
  assert.ok(start > 0 && end > start, 'the toolbar handler is delimited')
  const body = clientSource.slice(start, end)
  // Re-reading only the root would leave an expanded folder showing its old
  // children, which is the exact staleness this feature exists to fix.
  assert.match(body, /refreshDirectories\(\["", \.\.\.expanded\]\)/)
})

test('a directory refresh is offered from the context menu', () => {
  assert.match(clientSource, /function ContextMenu\(\{ menu, rootPath, onClose, onMention, onToast, onDownload, onDelete, onRefresh \}\)/)
  assert.match(clientSource, /const handleRefresh = \(e\) => \{/)
  assert.match(clientSource, /const isDirectoryEntry = entry\.type === "directory" \|\| entry\.isDirectory === true/)
  // Only a directory has a listing to re-read.
  assert.match(clientSource, /isDirectoryEntry[\s\S]{0,60}\? react\.createElement\("button"[\s\S]{0,400}刷新此目录/)
  // And it is wired from the drawer's own menu instance.
  assert.match(clientSource, /onRefresh: refreshEntry,/)
})

test('a directory refresh covers the directory and its expanded descendants', () => {
  const start = clientSource.indexOf('const refreshEntry = (entry) => {')
  const end = clientSource.indexOf('};', start)
  const body = clientSource.slice(start, end)
  // A file entry has nothing to refresh; the menu hides the item, and this is
  // the belt to that brace.
  assert.match(body, /if \(!isDirectory\) return;/)
  // Refreshing only the clicked directory would leave an already-open child
  // directory stale, so the expanded descendants come along.
  assert.match(body, /expanded\.has\(target\)/)
  assert.match(body, /startsWith\(target \+ "\/"\)/)
})

test('a refresh preserves the tree rather than rebuilding it', () => {
  // Collapsing the tree would make the reader hunt for their place again, and
  // blanking it first would flash the sidebar empty on every click.
  assert.equal(/setExpanded/.test(workerBody), false, 'a refresh must not touch the expanded set')
  assert.equal(/setNodes\(new Map\(\)\)/.test(workerBody), false, 'a refresh must not blank the tree first')
  // The root row itself is refreshed in place.
  assert.match(workerBody, /if \(dirPath === ""\) setError\(null\)/)
})

test('a refresh invalidates in-flight listings instead of racing them', () => {
  // Without bumping the generation, an older arrival listing that resolves after
  // the refresh would overwrite the newer answer with stale rows.
  assert.match(workerBody, /treeGeneration\.current \+= 1/)
  assert.match(workerBody, /if \(treeGeneration\.current !== generation\) return/)
})

test('the refresh control reports that it is working', () => {
  assert.match(clientSource, /"data-spinning": refreshing \? "true" : "false"/)
  assert.match(clientSource, /disabled: refreshing/)
  assert.match(clientSource, /\.fv-side-refresh\[data-spinning="true"\] svg\{animation:fv-spin/)
  // A spinner that ignores the system preference is an accessibility bug, and
  // the spin is the only feedback this control has.
  assert.match(clientSource, /@media\(prefers-reduced-motion:reduce\)\{\.fv-side-refresh/)
})

test('the refresh state is a hook in the hook region', () => {
  // Declared beside the refresh handler it would sit past the component's early
  // returns and change the hook count between renders. The dedicated guard test
  // in package.test.mjs scans for that; this pins the reason.
  const hookAt = clientSource.indexOf('const [refreshing, setRefreshing] = react.useState(false)')
  const earlyReturnAt = clientSource.indexOf('if (!open) return null', clientSource.indexOf('function ViewerOverlay'))
  assert.ok(hookAt > 0, 'the hook exists')
  assert.ok(earlyReturnAt > 0, 'the early return exists')
  assert.ok(hookAt < earlyReturnAt, 'the hook is declared above the early return')
})
