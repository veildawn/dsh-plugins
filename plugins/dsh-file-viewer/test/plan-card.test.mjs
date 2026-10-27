/**
 * Plan cards open the viewer, not the Host's artifact pane.
 *
 * A plan is the Markdown a Turn submitted through `exit_plan_mode`. The card in
 * the transcript's turn tail carries a tool call id and no path at all:
 *
 *   <div data-plan-artifacts>
 *     <button data-plan-card="call_...">…打开</button>
 *   </div>
 *
 * which is why it used to fall through every path-shaped rule and open the
 * Host's own preview. These tests lock both halves of the fix: the card has to
 * be recognised as a document control, and the host half has to turn the call id
 * into a real file inside a root the viewer may read.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

const clientSource = readFileSync(path.join(root, 'lib/client.js'), 'utf8')
const hostSource = readFileSync(path.join(root, 'lib/index.js'), 'utf8')

const { JSDOM } = require('jsdom')

/**
 * Load the client bundle against a throwaway document.
 * @param {string} markup - body markup for the probe document.
 * @returns {object} the bundle's internals.
 */
function loadInternals(markup) {
  const dom = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`, {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  })
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    localStorage: dom.window.localStorage,
  })) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  let definition
  dom.window.__ModuleLoader__ = { load(value) { definition = value } }
  new Function('window', clientSource)(dom.window)
  const bundle = definition.factory((id) => (
    id === 'react' ? { createElement: () => null } : new Proxy({}, { get: () => () => null })
  ))
  return { internals: bundle.internals, document: dom.window.document }
}

test('a plan card counts as a document control', () => {
  // Exactly the Host's own markup, minus the icon path data.
  const { internals, document } = loadInternals(`
    <div data-plan-artifacts="true">
      <button type="button" data-plan-card="call_00_mkzde3gd6kcnzrm2pm07tt0x">
        <span>接口代理（/api/v3）设计方案</span>
        <span>计划 · Markdown</span>
        <span>打开</span>
      </button>
    </div>`)
  const card = document.querySelector('[data-plan-card]')

  assert.equal(internals.isFileOpenControl(card), true, 'the card button itself is the control')

  // The click lands on whichever descendant is under the pointer, and every one
  // of them has to resolve to the card or the gesture dies halfway.
  for (const selector of ['span:nth-child(1)', 'span:nth-child(2)', 'span:nth-child(3)']) {
    const inner = document.querySelector(`[data-plan-card] > ${selector}`)
    assert.equal(internals.isFileOpenControl(inner), true, `${selector} belongs to the plan card`)
  }
})

test('a plan card is not mistaken for a file path', () => {
  const { internals, document } = loadInternals(`
    <div data-plan-artifacts="true">
      <button data-plan-card="call_abc"><span>接口代理（/api/v3）设计方案</span><span>打开</span></button>
    </div>`)
  const title = document.querySelector('[data-plan-card] > span')

  // The title contains slashes but is not a path; the interceptor must reach the
  // call id instead of bailing out on a failed `looksLikeFilePath`.
  assert.equal(internals.looksLikeFilePath(title.textContent), false)
  assert.equal(document.querySelector('[data-plan-card]').getAttribute('data-plan-card'), 'call_abc')
})

test('plan resources are parsed without inventing a path', () => {
  const { internals } = loadInternals('')

  assert.deepEqual(
    internals.parsePlanResource('dsh-resource://plan/session/session-abc/call_123'),
    { callId: 'call_123', sessionId: 'session-abc' },
  )
  assert.deepEqual(
    internals.parsePlanResource('dsh-resource://plan/subagent/session-abc/agent-1/call_xyz'),
    { callId: 'call_xyz', sessionId: undefined },
  )
  // A file address must not be claimed by the plan parser, or the drawer would
  // stop opening ordinary files.
  assert.equal(internals.parsePlanResource('dsh-resource://file/session/s/README.md'), null)
  assert.equal(internals.parsePlanResource('dsh-resource://plan/'), null)
})

test('a plan call id cannot spell a path', () => {
  // The id becomes a filename on the host, so the shape is part of the contract.
  // Read the literal straight out of the source: a hand-copied pattern here
  // would happily keep passing after the real one was loosened.
  const literal = /const PLAN_ID_PATTERN = \/(.+?)\//.exec(hostSource)
  assert.ok(literal !== null, 'the host declares a plan id pattern')
  const pattern = new RegExp(literal[1])
  for (const ok of ['call_00_mkzde3gd6kcnzrm2pm07tt0x', 'call_a-b_C9', 'x']) {
    assert.equal(pattern.test(ok), true, `${ok} is a valid plan id`)
  }
  for (const bad of ['../etc/passwd', 'a/b', 'a\\b', '', 'a'.repeat(129), 'a b']) {
    assert.equal(pattern.test(bad), false, `${JSON.stringify(bad)} is refused`)
  }
})

test('the host reads plans from the session log and materialises them', () => {
  // Contract assertions, not implementation trivia: these four hooks are what
  // make a plan card openable at all.
  assert.match(hostSource, /data\?\.name !== 'exit_plan_mode'/, 'plans are found by their tool name')
  assert.match(hostSource, /Array\.isArray\(session\.log\)/, 'the plan text comes from the event log')
  assert.match(hostSource, /await fsPromises\.mkdir\(directory, \{ recursive: true \}\)/, 'the plan directory is created on demand')
  assert.match(hostSource, /if \(existing !== markdown\) await fsPromises\.writeFile/, 'an unchanged plan does not rewrite the file')
  assert.match(hostSource, /openPlan,/, 'the RPC method is registered')
  assert.match(hostSource, /listPlans:/, 'the plan list is registered')
})

test('a plan lands in the workspace, not in a root of its own', () => {
  // Two earlier shapes were wrong. A root under the DSH home put a phantom
  // "计划文档" entry in the workspace picker that could not be switched away
  // from; a virtual document needed its own drawer pane and could not be closed.
  // Writing into the session's own workspace makes a plan an ordinary file, so
  // the tree, the tabs and the close button all already know what to do.
  assert.equal(/add\(plansRoot/.test(hostSource), false, 'no plan root is advertised')
  assert.match(hostSource, /const PLANS_DIR_NAME = '\.dsh-plans'/)
  assert.match(hostSource, /path\.join\(cwd, PLANS_DIR_NAME\)/, 'the directory is inside the workspace')
  assert.match(hostSource, /path\.relative\(cwd, filePath\)/, 'the reply is a root-relative path')
  // The client opens it as a file, like any other.
  assert.match(clientSource, /filePath: value\.path/)
})

test('a plan is opened as a file, not rendered as a special pane', () => {
  // The virtual-document view is gone on purpose: it is the version that could
  // not be closed and had to hide the tree.
  assert.equal(/PlanView/.test(clientSource), false, 'no plan-specific content view remains')
  assert.equal(/planMarkdown/.test(clientSource), false, 'no plan text is pushed into the drawer')
})

test('the workspace tree remains intact without being replaced by a plan list', () => {
  // Replacing the tree with a dedicated plan list blocked the user from
  // navigating other workspace files while reading a plan. Plans are ordinary
  // files now: the left column is always the project's Tree or GitPanel.
  assert.equal(/function PlanList/.test(clientSource), false, 'PlanList component is gone')
  assert.equal(/side === "plans"/.test(clientSource), false, 'no dedicated plans sidebar pane')

  // The .dsh-plans directory is allowed in directory listings even when hidden
  // files are not shown, so the user can see and open it directly from the tree.
  assert.match(hostSource, /entry\.name === PLANS_DIR_NAME/, 'plans directory is visible in tree')

  // Plan filenames include short callId suffix to avoid overwriting distinct plans with identical titles.
  assert.match(hostSource, /callId\.slice\(-8\)/, 'plan filenames avoid title collision')
})

test('opening a plan does not dirty the repository', () => {
  // Writing into the workspace means the user's own `git status` would start
  // reporting a directory the viewer created. The plan directory is ignored
  // via `.git/info/exclude` (a local git exclude file) rather than `.gitignore`,
  // so the user's tracked files and repository status stay completely clean.
  assert.match(hostSource, /async function ignorePlansDirectory\(cwd\)/)
  assert.match(hostSource, /const gitDir = path\.join\(cwd, '\.git'\)/)
  assert.match(hostSource, /await ignorePlansDirectory\(cwd\)/)
  assert.match(hostSource, /path\.join\(infoDir, 'exclude'\)/, 'uses .git/info/exclude')
  // Appending blindly would grow the file on every open.
  assert.match(hostSource, /if \(covered\) return/)
  // And a locked workspace must not make the plan unopenable.
  assert.match(hostSource, /A read-only or otherwise locked workspace is not a reason to fail/)
})

test('the interceptor hands plan cards over before the path pipeline', () => {
  const interceptor = clientSource.slice(
    clientSource.indexOf('function setupGlobalFileClickInterceptor'),
    clientSource.indexOf('function baseNameOf'),
  )
  const planAt = interceptor.indexOf('data-plan-card')
  const pathAt = interceptor.indexOf('extractClickedPath(el)')
  assert.ok(planAt > 0, 'the interceptor knows about plan cards')
  assert.ok(pathAt > planAt, 'plan cards are resolved before a path is extracted')
  // Without this the Host's own handler still runs and opens its artifact pane.
  assert.match(interceptor.slice(planAt, pathAt), /stopImmediatePropagation/)
})

test('a failed plan explains itself inside the drawer', () => {
  // The click is already intercepted when the host call happens, so silence
  // would read as a dead button.
  assert.match(clientSource, /正在读取计划…/)
  assert.match(clientSource, /request_\.planError/)
  assert.match(clientSource, /该计划无法打开/)
  // The host's own reason has to survive to the client rather than being
  // flattened into a generic failure.
  assert.match(hostSource, /plan-not-found/)
})

test('a plan read is a lookup, not a sweep', () => {
  // The measured failure this guards: sweeping every archive on the machine
  // (501 files, 438 MB) took 21 seconds, and a click nobody sees an answer to is
  // a click that did not work. The session id is a directory name, so the
  // target can be addressed directly.
  assert.match(hostSource, /async function archivesForSession\(sessionsDir, sessionId\)/)
  assert.match(hostSource, /path\.join\(sessionsDir, project, sessionId\)/)
  // The direct lookup must come FIRST and the sweep second — that ordering is
  // the entire performance fix. Asserting only that both functions exist would
  // pass even when the sweep runs first, which is what it did originally.
  const directAt = hostSource.indexOf('for (const file of await archivesForSession(sessionsDir, sessionId))')
  const sweepAt = hostSource.indexOf('for (const file of await recentArchives(sessionsDir))')
  assert.ok(directAt > 0, 'the direct lookup runs')
  assert.ok(sweepAt > 0, 'the bounded sweep exists')
  assert.ok(directAt < sweepAt, 'the direct lookup is tried before the sweep')
  // The bounded sweep exists only as the fallback, and is capped both ways.
  assert.match(hostSource, /const ARCHIVE_SWEEP_FILE_BUDGET = \d+/)
  assert.match(hostSource, /const ARCHIVE_SWEEP_TIME_BUDGET_MS = \d+/)
  assert.match(hostSource, /if \(Date\.now\(\) > deadline\) break/)
  // Newest first, so the likely candidate is tried before the budget runs out.
  assert.match(hostSource, /rows\.sort\(\(left, right\) => right\.at - left\.at\)/)
})

test('the built-in zstd decoder is never used for these archives', () => {
  // Verified by measurement, not assumption: the archives are multi-frame (one
  // frame per append). `zstdDecompressSync` and `createZstdDecompress` both
  // return only the first frame — 211 bytes of a 13 MB file — and the stream
  // throws "Unknown frame descriptor" on the rest. Using them would make every
  // historical plan look absent instead of unreadable.
  //
  // The names do appear in this module, but only inside the comment recording
  // that measurement; what must not exist is a *call* to them.
  assert.equal(/zstdDecompressSync\s*\(|createZstdDecompress\s*\(/.test(hostSource), false)
  assert.match(hostSource, /execFile\(\s*'zstd'/)
  assert.match(hostSource, /timeout: ARCHIVE_ZSTD_TIMEOUT_MS/)
})

test('a machine without zstd says so instead of denying the plan', () => {
  // "This deployment cannot read archives" and "no such plan" are different
  // answers; conflating them sent the previous round hunting a phantom bug.
  assert.match(hostSource, /error\.code === 'ENOENT'/)
  assert.match(hostSource, /plan-archive-unavailable/)
  assert.match(hostSource, /the zstd binary is not installed/)
})

test('a recovered plan is cached, and concurrent reads are not repeated', () => {
  assert.match(hostSource, /const planArchiveCache = new Map\(\)/)
  assert.match(hostSource, /const planArchivePending = new Map\(\)/)
  assert.match(hostSource, /const pending = planArchivePending\.get\(callId\)/)
  assert.match(hostSource, /planArchivePending\.delete\(callId\)/)
  // Only successes are cached: caching a timeout would make one slow read permanent.
  assert.match(hostSource, /if \(found !== null && found !== undefined\) \{\s*planArchiveCache\.set/)
})

test('a plan is never written into a guess of a workspace', () => {
  // The removed version fell back to `workspaces[0]`, which wrote one project's
  // plan into another project's tree (and, with a mis-joined path, into a
  // directory that did not exist).
  // Any "take the first one" shape is the bug, whatever the variable is called.
  assert.equal(/\bowned\[0\]|\bworkspaces\[0\]|\broots\[0\]\]?\s*\.path/.test(hostSource), false,
    'no "first workspace" fallback')
  assert.match(hostSource, /sessions\.includes\(sessionId\)/, 'membership is checked')
  assert.match(hostSource, /could not be determined, so it was not written anywhere/)
})

test('a slow plan read offers a way out instead of freezing', () => {
  // The wait is narrated in two stages, and past the slow threshold the reader
  // can hand the plan back to the Host's own pane.
  assert.match(clientSource, /const \[planWaitStage, setPlanWaitStage\] = react\.useState\(0\)/)
  assert.match(clientSource, /正在检索历史归档…/)
  assert.match(clientSource, /setTimeout\(\(\) => setPlanWaitStage\(3\), 8000\)/)
  assert.match(clientSource, /改用原生面板打开/)
  assert.match(clientSource, /liveFallbackPlan = \(sessionId, callId\) =>/)
})
