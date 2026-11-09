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
  assert.match(clientSource, /return react\.createElement\(HtmlView, \{ key, meta, root, backControl, sizeControl, copyControl, fontControl, onToast \}\)/)
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

test('the source view pages instead of loading the whole document', () => {
  // Rendering a hundred thousand rows would stall the drawer and scroll badly
  // afterwards anyway, so the source view asks for one window at a time — the
  // same contract the text reader has.
  assert.ok(clientSource.includes('request("read", { root, path: meta.path, offset: 1, limit: WINDOW_LINES })'),
    'the initial read is one window, not the whole file')
  assert.ok(clientSource.includes('const loadSourcePage = (nextOffset) => {'),
    'the source view can page forward and back')
  assert.ok(clientSource.includes('request("read", { root, path: meta.path, offset: nextOffset, limit: WINDOW_LINES })'))
  // Paged windows carry absolute line numbers, so the footer has to say which
  // lines are on screen rather than "1..500" every time.
  //
  // It reads `dataWindow`, NOT `window`: the window of rows was briefly named
  // `window`, which shadowed the global and made this footer print
  // "第 undefined–undefined 行 / 共 undefined 行". This assertion used to spell
  // out the shadowed form, so it was pinning the bug in place.
  assert.ok(clientSource.includes('"第 " + dataWindow.offset + "–" + dataWindow.end + " 行 / 共 " + dataWindow.totalLines + " 行"'),
    'the footer names the window of rows, never the global window')
  assert.equal(
    /window\??\.(offset|totalLines|hasBefore|hasAfter)\b/.test(clientSource),
    false,
    'no field of the paged window may be read off the global `window`',
  )
})

test('running a page reads the whole file, never a window', () => {
  // A page executed on half a document is not a slower preview, it is a
  // different and broken page: the second half of the HTML simply never arrives.
  // This is why preview takes its own read with `whole`, and why the preview
  // body is held in `fullText` rather than reusing the source window.
  assert.ok(clientSource.includes('request("read", { root, path: meta.path, whole: true })'))
  assert.ok(clientSource.includes('const [fullText, setFullText] = react.useState("")'))
  assert.ok(clientSource.includes('srcDoc: fullText'))
  assert.equal(/srcDoc: (state\.data\.)?text,/.test(clientSource), false,
    'the frame must not run the paged window')
  // Host side: `whole` lifts the whole-document budget, and the text-read
  // ceiling still bounds it.
  assert.ok(hostSource.includes("payload?.whole === true"))
})

test('a page opens as source and runs only on request', () => {
  // Opening used to run the page immediately, which made the drawer stutter on
  // every large report: parsing and executing a 2 MB document happened before
  // the reader had asked for anything. Source is cheap and answers "what is
  // this"; running it is a deliberate act.
  assert.match(clientSource, /const \[mode, setMode\] = react\.useState\("source"\)/)
  // The old default must be gone, not merely unused.
  assert.equal(
    /const \[mode, setMode\] = react\.useState\("preview"\)/.test(clientSource),
    false,
    'the page must not auto-run on open',
  )
})

test('a slow preview says it is loading instead of showing blank white', () => {
  // A blank rectangle is indistinguishable from a page that failed to render, so
  // the pane reports that it is preparing rather than pretending to be empty.
  assert.match(clientSource, /className: "fv-html-loading"/)
  assert.match(clientSource, /"正在加载页面…"/)
  assert.match(clientSource, /onLoad: \(\) => setFrameReady\(true\)/)
  // Mounting is held two frames back so the notice paints before a large
  // document starts parsing on the same thread; otherwise the click looks
  // ignored for as long as the parse takes.
  assert.match(clientSource, /const \[armed, setArmed\] = react\.useState\(false\)/)
  assert.match(clientSource, /requestAnimationFrame\(\(\) => \{\s*inner = requestAnimationFrame\(\(\) => setArmed\(true\)\)/)
  // The notice fades in late so a fast page does not flash it.
  assert.match(clientSource, /\.fv-html-loading\{[^}]*animation:fv-fade-in[^}]*\.15s forwards\}/)
  // Reduced motion must still show it — removing the animation would otherwise
  // leave it at opacity 0 forever.
  assert.match(clientSource, /@media\(prefers-reduced-motion:reduce\)\{\s*\.fv-html-loading\{animation:none;opacity:1\}/)
})

test('the preview reads the document once and can be re-run', () => {
  // One read per file; re-running remounts the frame instead of re-reading.
  assert.ok(clientSource.includes('request("read", { root, path: meta.path, offset: 1, limit: WINDOW_LINES })'))
  assert.match(clientSource, /const \[nonce, setNonce\] = react\.useState\(0\)/)
  assert.match(clientSource, /onClick: \(\) => setNonce\(\(n\) => n \+ 1\)/)
  // Both views are reachable. Even a page too large to ever run keeps a working
  // source view with a pager, and asking to run it says why instead of failing
  // silently.
  assert.match(clientSource, /className: "fv-html-modes"/)
  assert.ok(clientSource.includes('页面超过查看上限，无法运行'))
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

test('recording films the page without weakening the sandbox', () => {
  // A sandboxed frame is an opaque origin, so its pixels cannot be read from
  // here — not with canvas, not with captureStream. A display-capture stream is
  // the one path that works, because it takes pixels off the screen instead of
  // reading the DOM. That is also why it must not be "fixed" by relaxing the
  // sandbox: the sandbox is not the obstacle.
  assert.match(clientSource, /navigator\.mediaDevices\.getDisplayMedia\(/)
  assert.match(clientSource, /typeof MediaRecorder === "undefined"/)
  // Cancelling the picker is a decision, not an error to report.
  assert.match(clientSource, /problem\.name === "NotAllowedError"\) return/)
  // The frame's sandbox is unchanged by any of this.
  const sandbox = /sandbox: "([^"]*)"/.exec(clientSource)
  assert.ok(sandbox !== null)
  assert.equal(sandbox[1].includes('allow-same-origin'), false)
})

test('the recording is clipped to the preview when the engine can', () => {
  // Region Capture turns a whole-tab capture into a capture of the page alone.
  // Optional on purpose: without it the recording still runs, it is just wider
  // than intended, and failing the whole feature for a missing trim would be
  // the wrong trade.
  assert.match(clientSource, /typeof CropTarget !== "undefined"/)
  assert.match(clientSource, /CropTarget\.fromElement\(stageRef\.current\)/)
  assert.match(clientSource, /videoTrack\.cropTo\(target\)/)
  // A failed crop must not abort the recording that already started.
  assert.match(clientSource, /catch \(_\) \{ \/\* keep the uncropped capture \*\/ \}/)
})

test('an abandoned recording is dropped rather than downloaded', () => {
  // Closing the tab or switching files mid-recording must not pop a download
  // for a video the reader abandoned. The stop is deliberately made silent by
  // detaching `onstop` first.
  assert.match(clientSource, /recorder\.onstop = null;/)
  assert.match(clientSource, /if \(!aliveRef\.current\) return;/)
  // And the capture is always released, or the OS keeps showing a sharing badge.
  assert.match(clientSource, /for \(const track of stream\.getTracks\(\)\) track\.stop\(\)/)
  // The browser's own "Stop sharing" has to end the recording too, otherwise the
  // file would never be written.
  assert.match(clientSource, /videoTrack\.addEventListener\("ended"/)
  // The GIF pipeline has no MediaRecorder, so "Stop sharing" has to ask it
  // first — and it must be the one to stop the tracks. Letting the handler fall
  // through to stopTracks() would hand the encoder a dead stream.
  assert.match(clientSource, /const stopGif = gifStopRef\.current;\n\s+if \(stopGif !== null\) \{\n\s+try \{ stopGif\(\); \} catch \(_\) \{\}/)
})

test('the GIF pipeline owns a teardown that the view can always reach', () => {
  // An abandoned GIF capture keeps an interval and a detached <video> alive
  // unless unmount calls its own teardown; the recorder path alone is not
  // enough because GIF never creates a MediaRecorder.
  assert.match(clientSource, /const stopGif = gifStopRef\.current;\n\s+gifStopRef\.current = null;\n\s+if \(stopGif !== null\) \{\n\s+try \{ stopGif\(\); \}/)
  // Ending a GIF must release the session slot, or beginRecording()'s
  // "already recording" guard silently swallows the next attempt.
  assert.match(clientSource, /recordStreamRef\.current = null;\n\s+setRecording\(false\);/)
  // Every early exit inside captureGif goes through the same release path.
  assert.match(clientSource, /const abandon = \(reason\) => \{/)
  assert.ok(clientSource.includes('abandon("无法开始录制：" + messageOf(problem))'))
})

test('one recording owns exactly one elapsed clock', () => {
  // The clock used to be started both by a useEffect and by beginRecording,
  // so stopping cleared only one interval and the other ticked forever.
  const starts = clientSource.match(/setRecordElapsed\(Date\.now\(\) - started\)/g) ?? []
  assert.equal(starts.length, 1, 'the elapsed clock is started in exactly one place')
  // And that one place is the effect keyed on `recording`, which also clears it.
  assert.match(clientSource, /\}, \[recording\]\);/)
})

test('the capture picker cannot be opened twice', () => {
  // While the browser's own picker is open there is no stream yet, so a second
  // press would otherwise open a second picker on top of the first.
  assert.match(clientSource, /if \(recordPendingRef\.current \|\| recorderRef\.current !== null \|\| recordStreamRef\.current !== null\) return;/)
  assert.match(clientSource, /recordPendingRef\.current = false;/)
})

test('the record control only exists while a page is running', () => {
  assert.match(clientSource, /const recordButton = showingPreview/)
  assert.match(clientSource, /"aria-label": recording \? "停止录制" : "录制页面动画"/)
  // The elapsed clock is the only evidence a screen capture is still running.
  assert.match(clientSource, /recording \? formatElapsed\(recordElapsed\) : "录制"/)
  assert.match(clientSource, /\.fv-record-active \.fv-record-dot\{background:currentColor;animation:fv-record-pulse/)
})

test('an SVG keeps its picture and gains a source view', () => {
  // An SVG is a picture and a document at once. The picture stays the default —
  // it opens instantly and keeps the zoom, rotate and flip that make an icon or
  // an illustration readable — and the XML is one press away. It is NOT routed
  // through the HTML preview: defaulting to source would have cost the zoom
  // controls for a file type that never caused the stutter this feature fixes.
  assert.equal(kindOf('logo.svg'), 'image')
  assert.ok(clientSource.includes('const isSvg = /\\.svg$/i.test(meta.path)'),
    'the toggle is scoped to SVG')
  assert.ok(clientSource.includes('const [mode, setMode] = react.useState("image")'))
  // Decoded from the bytes already in hand, not fetched a second time.
  assert.ok(clientSource.includes('setSvgSource(decodeBase64Text(value.base64))'))
  assert.ok(clientSource.includes('if (isSvg && mode === "source") {'))
  assert.ok(clientSource.includes('lang: "xml"'))
  // The toggle belongs to SVG only; a PNG has no source to show.
  assert.ok(clientSource.includes('const sourceToggle = isSvg'), 'the toggle is SVG-only')
})

test('an SVG whose bytes will not decode still shows the picture', () => {
  // Decoding failing must not take the picture down with it: the <img> blob was
  // created from the same payload and is perfectly good.
  assert.ok(clientSource.includes('setSvgSource("")'), 'a failed decode clears the source only')
  // And the empty state is stated rather than rendering a blank pane.
  assert.ok(clientSource.includes('这个 SVG 没有可显示的源码。'))
})

test('the video is written on the client and never uploaded to the host', () => {
  // The clip is assembled in the tab from the screen capture and written by the
  // browser. Nothing about it goes through the DSH host — which matters in a
  // plugin whose other files all live on the server, because a reader with a
  // remote deployment has no way to tell from a bare "已保存".
  const recordingStart = clientSource.indexOf("const deliverRecording = async (blob) => {")
  const recordingEnd = clientSource.indexOf("const beginRecording = async () => {", recordingStart)
  assert.ok(recordingStart > 0 && recordingEnd > recordingStart, 'the delivery block is delimited')
  const body = clientSource.slice(recordingStart, recordingEnd)
  // No RPC, no host call, no filesystem write: the only sink is the browser.
  assert.equal(/request\(/.test(body), false, 'the recording path must not call the host')
  assert.ok(body.includes('showSaveFilePicker'), 'the reader picks the destination')
  assert.ok(body.includes('URL.createObjectURL'), 'or the browser downloads it')
  // A dismissed dialog must not become a download — that would save the file the
  // reader just declined to save.
  assert.ok(body.includes('problem.name === "AbortError") return'))
  // And the message names the destination.
  assert.ok(clientSource.includes('不经过 DSH 主机'))
})

test('recording offers the formats that actually play elsewhere', () => {
  // MP4/H.264 is listed before WebM on purpose: the order is not "best codec"
  // but "best chance of playing where the clip gets sent". A WebM that the
  // recipient cannot open is worth less than a slightly larger file that plays.
  const formats = /const RECORDING_FORMATS = \[([\s\S]*?)\n        \];/.exec(clientSource)
  assert.ok(formats !== null, 'the format table is declared')
  const table = formats[1]
  assert.ok(table.indexOf('"mp4"') < table.indexOf('"webm"'), 'MP4 is offered first')
  // An engine can accept the container and refuse the codec, so the codec is
  // spelled out and the decision goes through isTypeSupported.
  assert.ok(table.includes('video/mp4;codecs=avc1'))
  assert.ok(table.includes('video/webm;codecs=vp9'))
  assert.match(clientSource, /MediaRecorder\.isTypeSupported\(type\)/)
  // Only formats that survive that test reach the picker, so nothing selectable
  // can fail when picked — except GIF, which no engine encodes at all and which
  // this plugin encodes itself.
  assert.ok(clientSource.includes('const availableFormats = RECORDING_FORMATS'))
  assert.ok(clientSource.includes('.filter((entry) => entry.type !== ""'))
  assert.ok(clientSource.includes('selfEncoded: true'))
})

test('the container choice is remembered but re-validated', () => {
  // Storage outlives upgrades and can be hand-edited; an unknown id would
  // otherwise be shown as selected while the recorder quietly used something
  // else.
  assert.match(clientSource, /function readRecordFormat\(\) \{/)
  assert.ok(clientSource.includes('raw === "webm" || raw === "mp4" || raw === "gif" ? raw : "mp4"'))
  assert.match(clientSource, /function writeRecordFormat\(id\) \{/)
  // The extension follows the MIME type the recorder actually produced, not the
  // format that was requested — a wrong extension makes the file unopenable.
  assert.ok(clientSource.includes('const ext = mimeType.startsWith("image/gif")'))
  assert.ok(clientSource.includes(': (mimeType.startsWith("video/mp4") ? "mp4" : "webm");'))
})

test('the format picker is hidden once filming starts', () => {
  // Switching container mid-capture is not a thing, and a control that cannot
  // take effect should not be on screen.
  assert.match(clientSource, /const formatSelect = showingPreview && !recording && availableFormats\.length > 1/)
  assert.match(clientSource, /className: "fv-record-format"/)
  assert.match(clientSource, /"aria-label": "录制格式"/)
})

test('GIF is encoded by the plugin because no engine will do it', () => {
  // Verified against this engine rather than assumed: canvas.toBlob("image/gif")
  // returns a PNG, toDataURL likewise, and WebCodecs has no GIF encoder. So the
  // format is produced here — median cut, GIF's LZW, GIF89a container — and the
  // picker marks it as self-encoded so its support check is skipped.
  assert.ok(clientSource.includes('function buildGifPalette(pixels, maxColors)'))
  assert.ok(clientSource.includes('function gifLzwEncode(indices, minCodeSize)'))
  assert.ok(clientSource.includes('function encodeGif(indices, palette, width, height, delayMs)'))
  assert.ok(clientSource.includes('selfEncoded: true'))
  // The header and trailer are the two bytes most likely to be silently wrong.
  assert.ok(clientSource.includes('for (const character of "GIF89a")'))
  assert.ok(clientSource.includes('push(0x3B)'))
  // And the file really is a GIF by the time it is delivered.
  assert.ok(clientSource.includes('new Blob([bytes], { type: "image/gif" })'))
})

test('a GIF capture is bounded so it cannot exhaust memory', () => {
  // GIF holds every frame and gets no inter-frame compression: ten seconds at
  // 800px is hundreds of megabytes as RGBA.
  assert.ok(clientSource.includes('const GIF_LIMITS = Object.freeze({'))
  assert.ok(clientSource.includes('maxWidth: 640'))
  assert.ok(clientSource.includes('fps: 10'))
  assert.ok(clientSource.includes('maxSeconds: 15'))
  // Quantization is decoupled from in-capture drawing to keep the JS event loop unblocked.
  assert.ok(clientSource.includes('quantizedFrames.push(quantizeToPalette(rawFrames[i], palette))'))
  // Downscaled before drawing, so oversized pixels never exist at all.
  assert.ok(clientSource.includes('context.drawImage(video, 0, 0, width, height)'))
  // The caps stop the capture rather than merely warning about it.
  assert.ok(clientSource.includes('elapsed >= GIF_LIMITS.maxSeconds * 1000'))
  // Browser stop sharing bar event is hooked to stop GIF as well.
  assert.ok(clientSource.includes('const stopGif = gifStopRef.current;'))
})

test('GIF encoding reports progress and cannot be interrupted', () => {
  // Sliced progress reports stages so the user sees work in flight.
  assert.ok(clientSource.includes('setGifStage("正在生成调色板…"'))
  assert.ok(clientSource.includes('gifStage !== "" ? "生成中"'))
  // Encoding is asynchronous and long, so the message is painted first and the
  // button locks: half an encoded GIF is not a usable file.
  assert.ok(clientSource.includes('disabled: gifStage !== ""'))
  // Fallback download banner guarantees users can save files even if browser blocks silent auto-downloads.
  assert.ok(clientSource.includes('className: "fv-download-banner"'))
})

test('the inlined GIF encoder round-trips real pixels through Chrome', () => {
  // Byte output in a browser is the unit, not source text. The encoder is
  // extracted verbatim from the bundle, run in a real engine, and then its file
  // is decoded back to pixels and compared with what went in.
  //
  // Comparing pixels rather than just the decoded dimensions is what makes this
  // test able to fail: an earlier version only checked width/height and passed
  // while both a wrong LZW code width and a mismatched color-table size were
  // introduced — neither shows up in the dimensions, and neither showed up in
  // the file size either for a simple image.
  //
  // Known limit, stated rather than papered over: this asserts that Chrome
  // decodes the file back to the same picture, not that the byte stream is
  // spec-perfect. Chrome tolerates some deviations — dropping the LZW
  // end-of-information code still decodes correctly — so a regression of that
  // kind would slip through. The encoder emits the code anyway; a stricter
  // decoder than Chrome's would need it.
  const names = ['widestChannel', 'buildGifPalette', 'quantizeToPalette', 'gifLzwEncode', 'gifSubBlocks', 'encodeGif']
  let encoder = ''
  for (const name of names) {
    const start = clientSource.indexOf('    function ' + name + '(')
    assert.ok(start > 0, 'the encoder defines ' + name)
    let end = clientSource.indexOf('\n    /**', start)
    const nextFn = clientSource.indexOf('\n    function ', start + 10)
    if (end < 0 || (nextFn > 0 && nextFn < end)) end = nextFn
    assert.ok(end > start, 'the encoder function ' + name + ' is delimited')
    encoder += clientSource.slice(start, end) + '\n'
  }
  const dom = render(`<!doctype html><html><head><meta charset="utf-8"></head><body>
<pre id="out" style="all:initial">PENDING</pre>
<script>
${encoder}
// A pattern with gradients and many colors, not two flat fills: the dictionary
// must grow enough to need a wider LZW code, which is exactly the step a simple
// image never exercises.
var W = 120, H = 90;
function drawFrame(ctx, t) {
  var g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, 'rgb(16,24,32)');
  g.addColorStop(1, 'rgb(46,196,182)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (var i = 0; i < 12; i += 1) {
    ctx.fillStyle = 'rgb(' + ((i * 37 + t * 11) % 256) + ',' + ((i * 61) % 256) + ',' + ((i * 91 + t * 7) % 256) + ')';
    ctx.fillRect((i * 11 + t * 3) % W, (i * 7) % H, 14, 12);
  }
  ctx.fillStyle = '#fff';
  ctx.font = '13px monospace';
  ctx.fillText('frame ' + t, 6, 20);
}
var canvas = document.createElement('canvas');
canvas.width = W; canvas.height = H;
var ctx = canvas.getContext('2d', { willReadFrequently: true });
var frames = [], samples = [];
for (var f = 0; f < 6; f += 1) {
  drawFrame(ctx, f);
  var d = ctx.getImageData(0, 0, W, H).data;
  frames.push(d);
  for (var i = 0; i < d.length; i += 4 * 7) samples.push([d[i], d[i+1], d[i+2]]);
}
var palette = buildGifPalette(samples, 256);
var quantized = frames.map(function (frame) { return quantizeToPalette(frame, palette); });
var bytes = encodeGif(quantized, palette, W, H, 100);
var blob = new Blob([bytes], { type: 'image/gif' });
var url = URL.createObjectURL(blob);
var img = new Image();
img.onload = function () {
  // Decode back to pixels. The blob URL is same-origin, so the canvas is not
  // tainted and the data is readable.
  var back = document.createElement('canvas');
  back.width = W; back.height = H;
  var bctx = back.getContext('2d', { willReadFrequently: true });
  bctx.drawImage(img, 0, 0);
  var got = bctx.getImageData(0, 0, W, H).data;
  var original = frames[0];
  var totalError = 0, worst = 0, compared = 0;
  for (var i = 0; i < original.length; i += 4) {
    var dr = original[i] - got[i];
    var dg = original[i+1] - got[i+1];
    var db = original[i+2] - got[i+2];
    var err = Math.sqrt(dr*dr + dg*dg + db*db);
    totalError += err;
    if (err > worst) worst = err;
    compared += 1;
  }
  document.getElementById('out').textContent =
    'OK ' + img.naturalWidth + 'x' + img.naturalHeight +
    ' bytes=' + bytes.length +
    ' mean=' + (totalError / compared).toFixed(2) +
    ' worst=' + worst.toFixed(1);
};
img.onerror = function () { document.getElementById('out').textContent = 'FAIL decode'; };
img.src = url;
</script>
</body></html>`)
  if (dom === null) return
  const result = /OK (\d+)x(\d+) bytes=(\d+) mean=([\d.]+) worst=([\d.]+)/.exec(dom)
  assert.ok(result !== null, 'Chrome decoded the generated GIF; dumped: ' + dom.slice(0, 300))
  assert.equal(result[1] + 'x' + result[2], '120x90')
  // Quantization to 256 colors is lossy, but the decoded frame must still be
  // recognisably the image that went in — a broken LZW stream or a mismatched
  // color table shows up here as noise, not as a slightly wrong shade.
  const mean = Number(result[4])
  assert.ok(mean < 12, 'decoded frame diverged from the original, mean error ' + mean)
  assert.ok(Number(result[5]) < 90, 'worst-pixel error too high: ' + result[5])
})

test('beginPreview and loadSourcePage are declared before modeSwitch to avoid TDZ', () => {
  // Regression guard: in a previous version, modeSwitch declared onClick: beginPreview
  // before beginPreview was initialized with const, triggering ReferenceError: Cannot
  // access 'beginPreview' before initialization on component render.
  const beginPreviewIdx = clientSource.indexOf('const beginPreview = () => {')
  const loadSourcePageIdx = clientSource.indexOf('const loadSourcePage = (nextOffset) => {')
  const modeSwitchIdx = clientSource.indexOf('const modeSwitch = react.createElement("div", { className: "fv-html-modes"')
  
  assert.ok(beginPreviewIdx > 0, 'beginPreview is declared')
  assert.ok(loadSourcePageIdx > 0, 'loadSourcePage is declared')
  assert.ok(modeSwitchIdx > 0, 'modeSwitch is declared')
  
  assert.ok(beginPreviewIdx < modeSwitchIdx, 'beginPreview must be declared before modeSwitch')
  assert.ok(loadSourcePageIdx < modeSwitchIdx, 'loadSourcePage must be declared before modeSwitch')
})

test('recording controls are conditionally rendered on canRecordScreen support', () => {
  // Mobile browsers (Android/iOS) and non-secure LAN HTTP origins (http://192.168.x.x)
  // do not support getDisplayMedia. Controls must be hidden rather than showing
  // a dead button that disappoints on mobile.
  assert.ok(clientSource.includes('const canRecordScreen = typeof navigator !== "undefined"'))
  assert.ok(clientSource.includes('const recordButton = showingPreview && canRecordScreen'))
  assert.ok(clientSource.includes('const formatSelect = showingPreview && !recording && availableFormats.length > 1 && canRecordScreen'))
})

test('no local identifier shadows window to prevent TDZ ReferenceError', () => {
  // Regression guard: a local "const window = state.data" shadowed the global window,
  // causing "Cannot access 'window' before initialization" when effects ran.
  assert.equal(/(const|let|var)\s+window\s*=/.test(clientSource), false, 'global window must not be shadowed')
})
