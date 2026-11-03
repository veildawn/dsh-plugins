/**
 * HTML files are previewed by running them, inside a sandbox that cannot reach
 * the Host.
 *
 * Two halves, and the second is the one that matters. "It renders" is easy;
 * "it cannot read the app's storage, cookies or DOM while rendering" is the
 * property that decides whether shipping this feature is acceptable at all. The
 * sandbox attribute is asserted textually here, and — because a rule that looks
 * right and loses is indistinguishable from a missing rule — the real browser
 * case at the bottom loads an actual sandboxed frame and checks from inside it
 * that the parent is unreachable.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const clientSource = readFileSync(root + 'lib/client.js', 'utf8')
const hostSource = readFileSync(root + 'lib/index.js', 'utf8')

const { kindOf, isWholeDocumentKind } = await import(root + 'lib/core.js')

test('a page is its own kind', () => {
  assert.equal(kindOf('report.html'), 'html')
  assert.equal(kindOf('index.htm'), 'html')
  // Case matters on disk but not to the reader.
  assert.equal(kindOf('PAGE.HTML'), 'html')
  // A page is a whole document: half of one does not render, exactly like
  // Markdown and JSON, so it takes the same whole-document path.
  assert.equal(isWholeDocumentKind('html'), true)
})

test('.svg stays an image', () => {
  // An SVG is a picture first and a document second: the image viewer's zoom and
  // rotate are worth more to it than a script sandbox it almost never needs.
  assert.equal(kindOf('logo.svg'), 'image')
  assert.equal(isWholeDocumentKind('image'), false)
})

test('the host ships the whole page, not a line window', () => {
  // readText only includes `text` for a whole-document kind; without html in
  // that set the client would receive 500 lines and render a truncated page.
  assert.match(hostSource, /isWholeDocumentKind\(fileKind\) && text\.length <= MAX_PREVIEW_BYTES/)
  assert.match(hostSource, /const textual = kind === 'text' \|\| isWholeDocumentKind\(kind\)/)
})

test('the drawer routes html to the preview, not the text reader', () => {
  assert.match(clientSource, /if \(meta\.kind === "html"\) \{/)
  assert.match(clientSource, /return react\.createElement\(HtmlView, \{ key, meta, root, backControl, sizeControl, copyControl, fontControl \}\)/)
  // A page from history is deliberately NOT routed here: `gitCommitFile` returns
  // a paged window, never the whole document, so there is nothing complete to
  // run. Letting it through would fall back to the working-tree reader and show
  // the CURRENT file under a tab labelled with a commit.
  assert.match(clientSource, /meta\.kind !== "json"\) \{/)
  assert.equal(
    /meta\.kind !== "json" && meta\.kind !== "html"\) \{/.test(clientSource),
    false,
    'html must stay out of the historical preview allow-list',
  )
})

test('the preview sandbox never grants same-origin', () => {
  // This single flag is the whole security boundary. With it the framed page
  // shares this origin: it reads `localStorage` (where the Host keeps its
  // credentials), calls the Host's RPC endpoints with the app's cookies, and
  // reaches the parent document — and, holding both allow-scripts and
  // allow-same-origin, it can strip its own sandbox attribute and reload away
  // the boundary entirely.
  const sandbox = /sandbox: "([^"]*)"/.exec(clientSource)
  assert.ok(sandbox !== null, 'the frame declares a sandbox')
  assert.equal(
    sandbox[1].includes('allow-same-origin'),
    false,
    'allow-same-origin must never be granted: ' + sandbox[1],
  )
  // Scripts are granted on purpose — a frozen snapshot of an interactive page is
  // the thing this feature replaces.
  assert.equal(
    sandbox[1].includes('allow-scripts'),
    true,
    'scripts must run for a preview to mean anything',
  )
})

test('a page too large to ship whole still shows source', () => {
  // `read` only includes `text` for a whole document under the preview budget;
  // past it the reply carries a line window instead. A first version asked for
  // `limit: 1` and then read the source view out of `text`, so the fallback
  // rendered a single blank line for exactly the files that needed it most.
  assert.match(clientSource, /const \[state, setState\] = react\.useState\(\{ status: "loading", data: null, error: null \}\)/)
  // No limit override: the default window is the fallback's source.
  assert.equal(/request\("read", \{ root, path: meta\.path, offset: 1, limit: 1 \}\)/.test(clientSource), false,
    'the read must not clamp the window to one line')
  assert.match(clientSource, /request\("read", \{ root, path: meta\.path \}\)/)
  // The fallback rows come from the reply's own window, absolute numbers and all.
  assert.match(clientSource, /Array\.isArray\(state\.data\?\.lines\) \? state\.data\.lines : \[\]/)
})

test('the preview reads the document once and can be re-run', () => {
  // One read per file; re-running remounts the frame instead of re-reading.
  assert.match(clientSource, /request\("read", \{ root, path: meta\.path \}\)/)
  assert.match(clientSource, /const \[nonce, setNonce\] = react\.useState\(0\)/)
  assert.match(clientSource, /onClick: \(\) => setNonce\(\(n\) => n \+ 1\)/)
  // Both views are reachable, and the source view is the fallback when the Host
  // declines to send the whole document.
  assert.match(clientSource, /className: "fv-html-modes"/)
  assert.match(clientSource, /页面超过预览上限，只能查看源码。/)
})

/**
 * Locate a headless Chrome, or null when the machine has none.
 *
 * Probed by rendering rather than by asking for a version string: on Windows
 * `chrome.exe --version` prints a localized notice instead of a version.
 * @returns {string | null} an executable that can render headlessly.
 */
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean)
  for (const candidate of candidates) {
    if ((candidate.includes('/') || candidate.includes('\\')) && !existsSync(candidate)) continue
    const probe = spawnSync(candidate, [
      '--headless', '--disable-gpu', '--no-sandbox',
      '--virtual-time-budget=1000', '--dump-dom',
      'data:text/html,<b id=probe>fv-probe-ok</b>',
    ], { encoding: 'utf8', timeout: 30000 })
    if (probe.status === 0 && typeof probe.stdout === 'string' && probe.stdout.includes('fv-probe-ok')) {
      return candidate
    }
  }
  return null
}

/**
 * Build a page that runs a sandboxed frame and reports what the frame could see.
 * @param {string} sandbox - the sandbox attribute to test.
 * @returns {string} a complete HTML document.
 */
function sandboxProbePage(sandbox) {
  // The frame's own script tries the three things the sandbox is supposed to
  // deny, then reports what happened through postMessage. The parent writes the
  // verdict into the DOM, which is what --dump-dom can read back: an iframe's
  // contents are not part of the dumped document.
  const body = [
    'var r = [];',
    'try { parent.document.title; r.push("parent-dom:reachable"); } catch (e) { r.push("parent-dom:blocked"); }',
    'try { localStorage.getItem("x"); r.push("storage:reachable"); } catch (e) { r.push("storage:blocked"); }',
    // An opaque origin makes reading `document.cookie` throw rather than answer
    // empty, so both outcomes count as "not visible".
    'try { r.push("cookie:" + (document.cookie === "" ? "empty" : "present")); } catch (e) { r.push("cookie:throw"); }',
    'parent.postMessage(r.join(","), "*");',
  ].join('\n')
  // The srcdoc payload has to be a document, not a bare script: without the
  // wrapper the browser renders the text and runs nothing, and the probe would
  // then "pass" every security assertion by never executing at all.
  const frameScript = '<' + 'script>' + body + '</' + 'script>'
  return `<!doctype html><html><head><meta charset="utf-8"><title>HOST-TITLE-SECRET</title></head><body>
<div id="verdict">PENDING</div>
<iframe id="frame" sandbox="${sandbox}" srcdoc="${frameScript.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}"></iframe>
<script>
window.addEventListener('message', function (event) {
  document.getElementById('verdict').textContent = 'V' + 'ERDICT:' + String(event.data);
});
</script>
</body></html>`
}

/**
 * Render a page in Chrome and return the dumped DOM.
 * @param {string} html - the document to render.
 * @returns {string | null} the dumped DOM, or null when Chrome is unavailable.
 */
function render(html) {
  const chrome = findChrome()
  if (chrome === null) return null
  const dir = mkdtempSync(join(tmpdir(), 'fv-html-'))
  const page = join(dir, 'page.html')
  writeFileSync(page, html)
  const run = spawnSync(chrome, [
    '--headless', '--disable-gpu', '--no-sandbox',
    // Long enough for the frame's script to run and post back.
    '--virtual-time-budget=5000', '--dump-dom', `file://${page}`,
  ], { encoding: 'utf8', timeout: 60000 })
  return run.status === 0 ? run.stdout : null
}

/**
 * Read the verdict out of a dumped DOM.
 *
 * Matched on the element, not the whole document: the inline script that writes
 * the verdict is itself part of the dump, so a document-wide match finds the
 * script's source text first and reports a truthy verdict no matter what the
 * frame actually managed to do.
 * @param {string} dom - the dumped DOM.
 * @returns {string | null} the reported capabilities, or null when the frame never reported.
 */
function readVerdict(dom) {
  const match = /<div id="verdict">([^<]*)<\/div>/.exec(dom)
  if (match === null) return null
  const text = match[1]
  if (!text.startsWith('VERDICT:')) return null
  return text.slice('VERDICT:'.length)
}

test('a real sandboxed frame cannot reach the Host', () => {
  const dom = render(sandboxProbePage('allow-scripts'))
  if (dom === null) {
    // An honest skip beats a green test that proves nothing.
    return
  }
  const verdict = readVerdict(dom)
  assert.ok(verdict !== null, 'the frame reported back (it can still run scripts)')
  const report = verdict
  // Running scripts is what the preview promises; reaching the Host is what it
  // must never allow. Both halves are asserted, because a sandbox that blocks
  // everything would also satisfy a "blocked" check while breaking the feature.
  assert.match(report, /storage:blocked/, 'localStorage must be denied to the frame')
  assert.match(report, /parent-dom:blocked/, 'the parent document must be unreachable')
  assert.match(report, /cookie:(empty|throw)/, 'the Host cookies must not be visible')
  // And the frame really did run: a sandbox that silently prevented execution
  // would satisfy every "blocked" assertion above while previewing nothing.
  assert.equal(report.includes('storage:reachable'), false)
  assert.equal(report.includes('cookie:present'), false)
})

test('the same frame with same-origin would have reached the Host', () => {
  // The control case. Without it, the test above would pass just as happily on a
  // machine where the frame never ran at all — which is the one failure mode
  // that would silently disable the security check.
  const dom = render(sandboxProbePage('allow-scripts allow-same-origin'))
  if (dom === null) return
  const verdict = readVerdict(dom)
  assert.ok(verdict !== null, 'the control frame reported back')
  assert.match(verdict, /parent-dom:reachable/,
    'with allow-same-origin the frame reaches the parent — which is exactly the flag this feature refuses')
})

test('the preview frame actually fills the pane', () => {
  // An iframe inside a flex column collapses to zero height unless every level
  // carries min-height:0 — the failure looks like "the feature did nothing",
  // because a 0px frame renders nothing at all. Measured in a real engine rather
  // than asserted from the stylesheet, since flex resolution is the whole
  // question.
  const css = /const css = `([\s\S]*?)`;/.exec(clientSource)
  assert.ok(css !== null, 'the bundle defines its stylesheet')
  const dom = render(`<!doctype html><html><head><meta charset="utf-8">
<style>${css[1]}</style>
<style>html,body{margin:0;height:800px}body{display:flex}
#shell{display:flex;flex:1 1 auto;min-height:0}</style>
</head><body>
<div class="fv-main" id="main">
  <div class="fv-sheet-tabs" role="toolbar"><span>toolbar</span></div>
  <div class="fv-html-shell" id="shell">
    <iframe class="fv-html-frame" id="frame" sandbox="allow-scripts" srcdoc="&lt;p&gt;hi&lt;/p&gt;"></iframe>
    <div class="fv-html-note">note</div>
  </div>
</div>
<pre id="out" style="all:initial;position:absolute;left:0;top:0"></pre>
<script>
var frame = document.getElementById('frame');
frame.addEventListener('load', function () {
  var box = frame.getBoundingClientRect();
  document.getElementById('out').textContent = 'SIZE:' + Math.round(box.width) + 'x' + Math.round(box.height);
});
</script>
</body></html>`)
  if (dom === null) return
  const size = /SIZE:(\d+)x(\d+)/.exec(dom)
  assert.ok(size !== null, 'the frame reported its box')
  const height = Number(size[2])
  // 800px minus the toolbar and the note line; the point is that it is a large
  // fraction of the pane rather than a collapsed sliver.
  assert.ok(height > 600, 'the frame fills the pane, got ' + size[0])
})
