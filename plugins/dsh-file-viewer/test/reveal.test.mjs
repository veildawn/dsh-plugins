/**
 * Revealing a path in the host machine's own file browser.
 *
 * Both entry points — the tree's right-click menu and the toolbar's 操作 menu —
 * exist to answer "where is this file on disk" without making the reader leave
 * DSH. The rule that matters is the one about files: a file manager cannot
 * preview a file, so a file reveals its CONTAINING FOLDER, while a directory
 * reveals itself.
 *
 * The other half of the contract is the fence. This is the only method on the
 * channel that hands a path to a program outside the process, so it must be
 * vetted exactly like a read: an absolute path, a `..` escape or a target that
 * no longer exists is refused before anything is spawned.
 *
 * Nothing here may actually launch a file manager: the successful path is
 * covered by asserting the command `revealCommand` would build, never by
 * running it. Every test below either stops before the spawn or inspects the
 * plan.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { revealCommand, revealInFileManager } from '../lib/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..') + path.sep
const read = (relative) => readFileSync(root + relative, 'utf8')
const clientSource = read('lib/client.js')

/** The smallest host context `resolveInRoot` needs, with one declared root. */
function createHost(tree) {
  const fs = {
    async resolve(candidate) {
      const key = String(candidate).replace(/[\\/]+$/, '') || '/'
      return { targetKey: key, displayPath: key }
    },
    processPath: (target) => target.displayPath,
    contains(parent, child) {
      return child.targetKey === parent.targetKey || child.targetKey.startsWith(parent.targetKey + '/')
    },
    async stat(target) {
      return tree[target.targetKey]
    },
  }
  return {
    fs,
    logger: { warn() {} },
    workspaceRegistry: { list: () => [{ path: '/repo', name: undefined }] },
    sessions: { list: () => [] },
  }
}

const options = () => ({ extraRoots: [], safePaths: [], safeAccessPaths: [] })

test('the command opens the containing folder for a file, and the directory itself', () => {
  // An unusable path stays unusable: there is nothing to hand a file manager.
  assert.equal(revealCommand('', false), null)
  assert.equal(revealCommand(undefined, true), null)

  const forFile = revealCommand('/tmp/docs/a.md', false)
  const forDirectory = revealCommand('/tmp/docs', true)
  assert.ok(forFile, 'a file still produces a plan')
  assert.ok(forDirectory, 'a directory produces a plan')
  assert.equal(forFile.opened, 'parent', 'a file reveals where it lives')
  assert.equal(forDirectory.opened, 'directory', 'a directory reveals itself')

  // The platform detail is asserted per platform, because each one names the
  // folder differently; what must never differ is which folder is named.
  if (process.platform === 'win32') {
    assert.equal(forFile.command, 'explorer.exe')
    assert.equal(forDirectory.command, 'explorer.exe')
    assert.deepEqual(forDirectory.args, ['/tmp/docs'])
    // `/select,` is what makes Explorer show the parent AND highlight the file.
    assert.deepEqual(forFile.args, ['/select,/tmp/docs/a.md'])
    // Explorer exits non-zero even on success, so the caller must not read the
    // status as a failure.
    assert.equal(forFile.ignoreExitCode, true)
  } else if (process.platform === 'darwin') {
    assert.equal(forFile.command, 'open')
    assert.deepEqual(forFile.args, ['-R', '/tmp/docs/a.md'])
    assert.deepEqual(forDirectory.args, ['/tmp/docs'])
  } else {
    assert.equal(forFile.command, 'xdg-open')
    // No portable "reveal" flag exists on Linux, so the folder is the contract.
    assert.deepEqual(forFile.args, ['/tmp/docs'])
    assert.deepEqual(forDirectory.args, ['/tmp/docs'])
  }
})

test('a path that does not exist is refused before anything is spawned', async () => {
  // The tree only ever asks for rows it listed, so a missing target means the
  // file went away between the listing and the click.
  await assert.rejects(
    () => revealInFileManager(createHost({}), options, { root: '/repo', path: 'gone.md' }),
    (error) => {
      assert.equal(error.code, 'not-found')
      // These strings reach the browser; the absolute path must not be in them.
      assert.doesNotMatch(error.message, /\/repo/)
      return true
    },
  )
})

test('a path that escapes its root is refused, whatever the payload says', async () => {
  const host = createHost({ '/repo': { type: 'directory' }, '/etc': { type: 'file' } })

  // The shape check runs before the disk is touched, so `..` never resolves.
  await assert.rejects(
    () => revealInFileManager(host, options, { root: '/repo', path: '../etc/passwd' }),
    (error) => error.code === 'outside-root',
  )
  // An absolute path is not a root-relative one, even when it points inside.
  await assert.rejects(
    () => revealInFileManager(host, options, { root: '/repo', path: '/repo/inside.md' }),
    (error) => error.code === 'outside-root',
  )
})

test('the tree menu offers revealing, wired to the drawer', () => {
  // The prop travels from the overlay into the menu; a menu that renders the
  // item without the handler would be a dead button.
  assert.match(clientSource, /onReveal: revealEntry,/)
  assert.match(clientSource, /const handleReveal = \(e\) => \{/)
  assert.match(clientSource, /react\.createElement\("span", \{ className: "fv-context-item-label" \}, "文件浏览器中打开"\)\)/)

  // It is handed the row's root-relative path, never the display path: the
  // host resolves the path itself and must not be given a second way in.
  const revealEntry = /const revealEntry = \(entry\) => \{([\s\S]*?)\n        \};/.exec(clientSource)
  assert.ok(revealEntry, 'revealEntry must exist')
  assert.match(revealEntry[1], /revealInHostBrowser\(request, \{ root: root, path: entry\.path \}, showToast\)/)
  assert.doesNotMatch(revealEntry[1], /displayPath/, 'the display path is for showing, not for revealing')

  // The menu grew, so its viewport clamp grew with it.
  assert.match(clientSource, /winH - 262/)
})

test('the toolbar entry is called 操作 and carries the same reveal action', () => {
  // Renamed from 复制路径: the menu is no longer only about paths.
  assert.match(clientSource, /react\.createElement\("span", \{ className: "fv-tab-text" \}, "操作"\)/)
  assert.match(clientSource, /"aria-label": "操作"/)
  assert.doesNotMatch(clientSource, /"aria-label": "路径复制"/)

  // The reveal item lives in the dropdown and goes through the same helper.
  assert.match(clientSource, /className: "fv-path-copy-item fv-path-copy-item-reveal"/)
  assert.match(clientSource, /onClick: handleReveal/)
  assert.match(
    clientSource,
    /revealInHostBrowser\(liveRequest, \{ root: root, path: relPath \}, onToast\)/,
    'the toolbar menu must reveal through the shared helper',
  )

  // Without a root the host could only guess which deployment the path belongs
  // to, so the click explains itself instead.
  assert.match(clientSource, /if \(!root\) \{/)
})

/** Evaluate the browser bundle and hand back its exports. */
function loadClient() {
  const previousWindow = globalThis.window
  let definition
  globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
  try {
    new Function('window', clientSource)(globalThis.window)
  } finally {
    globalThis.window = previousWindow
  }
  return definition.factory((id) => (id === 'react'
    ? {
      createElement: (type, props, ...children) => ({
        type,
        props: props || {},
        children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false),
      }),
      Fragment: 'fragment',
      useRef: () => ({ current: null }),
      useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
      useEffect: () => {},
      useCallback: (fn) => fn,
    }
    : { ReadBlock: null, MarkdownText: null, JsonTree: null }))
}

test('the shared helper asks the host and reports both outcomes', async () => {
  const { internals } = loadClient()
  assert.equal(typeof internals.revealInHostBrowser, 'function')

  // A call published before the connection is ready must say so rather than
  // reject into nothing.
  const early = []
  assert.equal(await internals.revealInHostBrowser(null, { root: '/repo', path: 'a.md' }, (t) => early.push(t)), false)
  assert.deepEqual(early, ['连接服务尚未就绪'])

  // Success: one reveal call with the vetted payload, and a toast that says it
  // happened (the file manager opens outside the page, so the only feedback is
  // this notice).
  const calls = []
  const ok = []
  const request = async (method, payload) => { calls.push([method, payload]); return { opened: 'parent' } }
  assert.equal(await internals.revealInHostBrowser(request, { root: '/repo', path: 'docs/a.md' }, (t) => ok.push(t)), true)
  assert.deepEqual(calls, [['reveal', { root: '/repo', path: 'docs/a.md' }]])
  assert.deepEqual(ok, ['已在文件浏览器中打开'])

  // Failure keeps the host's code meaningful to a reader instead of surfacing
  // an operator-facing English message.
  const refused = []
  const failing = async () => { const error = new Error('no file browser is available on this host'); error.code = 'reveal-unsupported'; throw error }
  assert.equal(await internals.revealInHostBrowser(failing, { root: '/repo', path: 'a.md' }, (t) => refused.push(t)), false)
  assert.deepEqual(refused, ['当前系统没有可用的文件浏览器。'])
})

test('the toolbar dropdown renders one 操作 control', () => {
  const { internals } = loadClient()
  const dropdown = internals.PathCopyDropdown({
    meta: { path: 'docs/a.md', displayPath: '/repo/docs/a.md', name: 'a.md' },
    root: '/repo',
    onToast: () => {},
  })
  assert.equal(dropdown.props.className, 'fv-path-copy-wrap')
  const button = dropdown.children[0]
  assert.equal(button.props['aria-label'], '操作')
  // The visible label is its own node so the icon and the arrow keep their
  // spacing; asserting the text node is asserting what the reader sees.
  assert.equal(button.children[1].children[0], '操作')
})
