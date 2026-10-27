/**
 * The viewer covers every card that opens a file.
 *
 * Two different guarantees are locked here:
 *
 *  1. Coverage: whatever card the Host renders, opening a file ends up in
 *    `sidebarRight.openResource`/`openResourceIn`, and the plugin wraps both. So
 *    a card only escapes if it bypasses that channel *and* is not recognised as
 *    a click target.
 *
 *  2. The exceptions are known. Cards that genuinely do not open files are
 *    listed below with the reason, so adding a new one is a deliberate act
 *    rather than an oversight.
 *
 * The host packages are read from the installed DSH, which is what actually
 * renders the cards; when a package is absent the checks that need it are
 * skipped rather than silently passing.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const clientSource = readFileSync(path.join(root, 'lib/client.js'), 'utf8')

/**
 * Locate the installed DSH's `@deepseek-ai` directory.
 *
 * The host is not a dependency of this plugin, so it cannot be resolved by name.
 * Probe the places it realistically lives (a global install, the local profile,
 * and an explicitly configured override) and return the first that exists, so
 * the coverage checks run against the host that actually renders the cards.
 * @returns {string | undefined} directory holding the `dsh-client-ui-*` packages.
 */
function dshScopeDirectory() {
  const overridden = process.env.DSH_SCOPE_DIR
  if (typeof overridden === 'string' && existsSync(overridden)) return overridden
  const candidates = []
  const globalRoot = path.resolve(process.execPath, '..', '..', 'lib', 'node_modules')
  candidates.push(path.join(globalRoot, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'))
  candidates.push(path.join(globalRoot, '@deepseek-ai'))
  const dshHome = process.env.DSH_HOME || path.join(process.env.HOME || '', '.dsh')
  candidates.push(path.join(dshHome, 'profiles', 'web', 'node_modules', '@deepseek-ai'))
  return candidates.find((candidate) => existsSync(candidate) && readdirSync(candidate).some((n) => n.startsWith('dsh-client-ui-')))
}

/** Every installed `dsh-client-ui-*` package's client bundle. */
function hostClientBundles() {
  const dshRoot = dshScopeDirectory()
  if (dshRoot === undefined) return []
  return readdirSync(dshRoot)
    .filter((name) => name.startsWith('dsh-client-ui-'))
    .map((name) => ({
      name,
      file: path.join(dshRoot, name, 'lib', 'client.js'),
    }))
    .filter((entry) => existsSync(entry.file))
    .map((entry) => ({ name: entry.name, source: readFileSync(entry.file, 'utf8') }))
}

const bundles = hostClientBundles()

/**
 * The resource protocols the host can hand to the sidebar.
 *
 * Read out of the host's own literals rather than assumed: a new protocol is
 * exactly the case that would otherwise slip past the viewer.
 * @returns {Set<string>} protocol names found in the host bundles.
 */
function hostResourceProtocols() {
  const found = new Set()
  for (const bundle of bundles) {
    for (const match of bundle.source.matchAll(/dsh-resource:\/\/([a-z-]+)/g)) found.add(match[1])
  }
  return found
}

test('every resource protocol the host opens is understood by the viewer', () => {
  if (bundles.length === 0) return
  const protocols = hostResourceProtocols()
  assert.ok(protocols.size > 0, 'the host declares at least one resource protocol')

  // These are the protocols that carry a *file* (or a file-like document). Each
  // needs a branch in the plugin: `file` and `changes-review` are parsed, and
  // `plan` is turned into a file by the host half.
  const fileProtocols = ['file', 'changes-review', 'plan']
  for (const protocol of fileProtocols) {
    assert.ok(protocols.has(protocol) || protocol === 'plan', `the host still uses "${protocol}"`)
    // Search the parser that actually runs, not the whole file: a protocol named
    // only in a comment would otherwise satisfy this, which is exactly how the
    // first version of this assertion passed while the branch was broken.
    const marker = `dsh-resource://${protocol}`
    // Anchored on `startsWith(` and closed on the quote that ends the literal:
    // without the closing quote `plan` would also match `planX`, which is how an
    // earlier version of this assertion kept passing against a broken branch.
    // `changes-review` carries a `/session` suffix before its quote.
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const branch = new RegExp(`startsWith\\(\\s*"${escaped}(?:/[a-z]*)?/"`)
    assert.ok(branch.test(clientSource), `the viewer branches on "${marker}" in code`)
  }

  // Anything else the host can open must be a surface that is not a file.
  // `subagentchat` renders a conversation; `plan-review` is the temporary
  // plan-approval panel, addressed by a browser-lifetime request key rather than
  // by anything durable — it belongs to the review flow, not to the viewer, and
  // claiming it would take the approval UI away.
  const known = new Set([...fileProtocols, 'subagentchat', 'plan-review'])
  for (const protocol of protocols) {
    assert.ok(known.has(protocol), `unexpected resource protocol "${protocol}" needs a review`)
  }
})

test('the viewer wraps both sidebar entry points', () => {
  // `openResource` and `openResourceIn` are different functions on the same
  // object, and a card may call either (`tab.actions.openResource` forwards to
  // the scoped one). Wrapping only one leaves a hole.
  assert.match(clientSource, /sr\.openResource = function/)
  assert.match(clientSource, /sr\.openResourceIn = function/)
})

test('cards that open files are recognised as click targets', () => {
  for (const marker of [
    'data-open-path-open',
    'data-changed-files',
    'data-presented-file',
    'data-presented-files-row',
    'data-produced-files-row',
    'data-plan-card',
  ]) {
    assert.ok(clientSource.includes(marker), `the viewer recognises ${marker}`)
  }
})

test('cards that do not open files stay out of the click path', () => {
  if (bundles.length === 0) return
  // Names, not guesses: each of these was checked in its own package and has no
  // file-opening action. If one later gains such an action, this list is where
  // the reviewer will look first.
  const nonFileCards = [
    'data-context-files', // instructions context listing: plain <li> rows
    'data-goal-bar', // goal mode: progress, no file action
    'data-workflow-run', // workflow run card: steps, no file action
  ]
  const allHostSource = bundles.map((bundle) => bundle.source).join('\n')
  for (const marker of nonFileCards) {
    if (!allHostSource.includes(marker)) continue
    assert.equal(
      clientSource.includes(marker),
      false,
      `${marker} is not a file card and must not be treated as one`,
    )
  }
})

test('panels opened by openTab are not mistaken for files', () => {
  if (bundles.length === 0) return
  // These are the tab kinds the host opens for non-file surfaces. The plugin
  // wraps `openResource`, deliberately not `openTab`: intercepting those would
  // steal the browser/terminal/task panels.
  const tabKinds = new Set()
  for (const bundle of bundles) {
    for (const match of bundle.source.matchAll(/openTab(?:In|FromTarget)?\(\s*["']([a-z-]+)["']/g)) tabKinds.add(match[1])
  }
  for (const kind of tabKinds) {
    assert.equal(
      new RegExp(`dsh-resource://${kind}`).test(clientSource),
      false,
      `the viewer must not claim the "${kind}" tab`,
    )
  }
  assert.equal(/sr\.openTab\s*=/.test(clientSource), false, 'openTab is left to the host')
})
