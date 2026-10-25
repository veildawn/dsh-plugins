import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * Cascade tests for the reading-size stepper.
 *
 * Asserting that a rule exists is not enough, and this file exists because that
 * distinction shipped a bug: the stepper worked in the source view and did
 * nothing at all in the Markdown and JSON previews. Every rule involved was
 * present and looked correct — the preview roots simply pinned their size with
 * their own `font:` shorthand, which outranks an inherited `font-size`, so the
 * custom property never reached the text.
 *
 * A rule that exists but loses the cascade is indistinguishable from a missing
 * rule, so these tests compute the actual value in a real engine. jsdom cannot
 * do that: it does not resolve `var()` and performs no cascade. Chrome is used
 * when present; without it the cascade assertions are skipped rather than
 * faked, because a green test that proves nothing is worse than an honest skip.
 */
const root = fileURLToPath(new URL('..', import.meta.url))

/** Locate a headless Chrome, or null when the machine has none. */
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
  ].filter(Boolean)
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' })
    if (probe.status === 0 && typeof probe.stdout === 'string' && /Chrome|Chromium/i.test(probe.stdout)) {
      return candidate
    }
  }
  return null
}

/**
 * The stylesheet the bundle installs, read straight out of the source.
 *
 * The bundle cannot be imported (it registers itself on a host loader), and the
 * CSS lives in one template literal, so it is extracted textually. This is the
 * same string `ensureStyles` writes into the document.
 */
function bundleCss() {
  const source = readFileSync(root + 'lib/client.js', 'utf8')
  const match = /const css = `([\s\S]*?)`;/.exec(source)
  assert(match, 'the bundle must define its stylesheet as one template literal')
  return match[1]
}

/**
 * Render one page and read computed values back out of it.
 *
 * Each cell is `[selector, property]`; the result is the computed value of that
 * property on that element, after the host sheet, the plugin sheet and any
 * custom property the caller set have all been applied by the real engine.
 */
function computedStyles({ hostCss, cells, fontSize }) {
  const chrome = findChrome()
  if (chrome === null) return null
  const dir = mkdtempSync(join(tmpdir(), 'fv-cascade-'))
  const page = join(dir, 'page.html')
  // The host sheet comes FIRST so the plugin sheet is later in document order —
  // the unfavourable case for the plugin, and the one the bug lived in. The
  // rules must win on specificity, not on being loaded last.
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style id="host">${hostCss}</style>
<style id="plugin">${bundleCss()}</style>
</head><body>
<pre id="out" style="all:initial;display:block"></pre>
<div class="fv-content" id="c" data-wrap="off">
  ${cells.map(([selector], index) => `<div id="probe${index}" class="${selector.replace(/^\./, '')}"></div>`).join('\n  ')}
</div>
<script>
const cells = ${JSON.stringify(cells)};
const wrap = document.getElementById('c');
${fontSize === undefined ? '' : `wrap.style.setProperty('--fv-font-size', ${JSON.stringify(fontSize)});`}
const values = cells.map(([, property], index) =>
  getComputedStyle(document.getElementById('probe' + index))[property]);
document.getElementById('out').textContent = JSON.stringify(values);
</script>
</body></html>`
  writeFileSync(page, html)
  const dumped = execFileSync(chrome, [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--virtual-time-budget=3000',
    '--dump-dom',
    `file://${page}`,
  ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  const match = /<pre id="out"[^>]*>([\s\S]*?)<\/pre>/.exec(dumped)
  assert(match, 'the probe page must report its computed values')
  // The dump is HTML, so the JSON payload is entity-escaped.
  const payload = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
  return JSON.parse(payload)
}

/** The host rules that made the previews ignore the setting. */
const HOST_CSS = `
/* MarkdownText.module.css: the preview root pins size via the font shorthand. */
._markdown_h4sh { font: 15px/1.6 system-ui, sans-serif; color: #111; }
._markdown_h4sh h1 { font: 600 2em system-ui, sans-serif; }
._markdown_h4sh pre { font: 12px/1.5 monospace; }
/* JsonTree.module.css: same idea, fixed px in the shorthand. */
._root_h4sh { font: 12px/16px monospace; }
`

const SKIP = findChrome() === null
  ? 'no headless Chrome on this machine, so the cascade cannot be computed for real'
  : false

test('the reading-size stepper drives both preview roots, not just the source view', { skip: SKIP }, () => {
  const cells = [
    ['._markdown_h4sh', 'fontSize'],
    ['._root_h4sh', 'fontSize'],
  ]

  // Default: the previews keep the sizes the host would give them.
  const defaults = computedStyles({ hostCss: HOST_CSS, cells })
  assert.deepEqual(defaults, ['13px', '12px'])

  // Turned up: BOTH previews must follow. This is the exact expression of the
  // reported bug — before the fix these stayed at 13px and 12px.
  const larger = computedStyles({ hostCss: HOST_CSS, cells, fontSize: '20px' })
  assert.deepEqual(larger, ['20px', '20px'])

  // Turned down: likewise, so the stepper is not merely a "grow" button.
  const smaller = computedStyles({ hostCss: HOST_CSS, cells, fontSize: '11px' })
  assert.deepEqual(smaller, ['11px', '11px'])
})

test('text nested inside a preview scales with the root instead of keeping host sizes', { skip: SKIP }, () => {
  const cells = [
    ['._markdown_h4sh', 'fontSize'],
    ['._markdown_h4sh', 'lineHeight'],
  ]
  // The root re-declares line height beside the size: the host's shorthand set
  // both, and leaving line height fixed makes larger text overlap itself.
  const values = computedStyles({ hostCss: HOST_CSS, cells, fontSize: '20px' })
  assert.deepEqual(values, ['20px', '33px'])
})

test('the source view keeps the size it already had', { skip: SKIP }, () => {
  // A regression guard rather than a new feature: the code card was the one
  // view the stepper did drive, and the preview fix must not disturb it.
  const host = `
._card_h4sh { font: 13px/1.6 system-ui, sans-serif; }
._body_h4sh { padding: 12px 0; font: 13px/1.6 monospace; }
._line_h4sh { display: flex; line-height: 20px; }
`
  const cells = [['._body_h4sh', 'fontSize'], ['._line_h4sh', 'fontSize']]
  assert.deepEqual(computedStyles({ hostCss: host, cells, fontSize: '22px' }), ['22px', '22px'])
})

/* -------------------------------------------------------------------------- *
 * Desktop title-bar clearance
 *
 * The same class of bug as the reading size, with worse consequences: a rule
 * that looks right but loses the cascade leaves the drawer's own header buttons
 * underneath the operating system's window buttons, where they cannot be
 * clicked at all. Source-shape assertions cannot catch that (the 0.2.8 fix was
 * source-shaped and silently regressed in 0.3.6), so the geometry is measured
 * in a real engine — the drawer's header must start at or below the strip the
 * host reserves, and must start at the frame's edge when there is no strip.
 * -------------------------------------------------------------------------- */

/** Render the drawer in a given desktop environment and measure its header. */
function measureDrawer({ htmlAttrs, cssVars, fullscreen = false }) {
  const chrome = findChrome()
  if (chrome === null) return null
  const dir = mkdtempSync(join(tmpdir(), 'fv-cascade-geo-'))
  const page = join(dir, 'page.html')
  const vars = Object.entries(cssVars).map(([name, value]) => `${name}: ${value};`).join(' ')
  const html = `<!doctype html><html ${htmlAttrs} style="${vars}">
<head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; }
/* The shell overlay seat spans the frame's padding box, as the host's does. */
body > div[role="presentation"] { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; }
/* The slide-in animation runs from translateX(100%); measuring mid-flight
   would report the drawer off-screen and hide any real overlap. */
.fv-scrim, .fv-shell { animation: none !important; transition: none !important; }
</style><style id="plugin">${bundleCss()}</style></head>
<body><pre id="out" style="all:initial;display:block;position:fixed;bottom:0;z-index:99999"></pre>
<div role="presentation">
  <div class="fv-scrim" role="dialog" aria-modal="true">
    <div class="fv-shell" data-fullscreen="${fullscreen ? 'true' : 'false'}" data-mobile="false">
      <div class="fv-head" id="head"><span class="fv-title">文件</span></div>
    </div>
  </div>
</div>
<script>
const head = document.getElementById('head').getBoundingClientRect();
const shell = document.querySelector('.fv-shell').getBoundingClientRect();
document.getElementById('out').textContent = JSON.stringify({
  headTop: Math.round(head.top),
  headBottom: Math.round(head.bottom),
  shellRight: Math.round(shell.right),
  viewport: window.innerWidth,
});
</script></body></html>`
  writeFileSync(page, html)
  const dumped = execFileSync(chrome, [
    '--headless', '--disable-gpu', '--no-sandbox',
    '--window-size=1280,800', '--virtual-time-budget=3000', '--dump-dom', `file://${page}`,
  ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  const match = /<pre id="out"[^>]*>([\s\S]*?)<\/pre>/.exec(dumped)
  assert(match, 'the probe page must report the drawer geometry')
  const payload = match[1]
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  return JSON.parse(payload)
}

test('on Windows the drawer header starts below the caption strip', { skip: SKIP }, () => {
  for (const scale of ['40px', '50px', '60px']) {
    const box = measureDrawer({
      htmlAttrs: 'data-windows-titlebar',
      cssVars: { '--dsh-windows-titlebar-height': scale },
    })
    const strip = Number.parseFloat(scale)
    assert(
      box.headTop >= strip,
      `the drawer header must clear the ${strip}px caption strip, got top=${box.headTop}`,
    )
    // The drawer still hugs the trailing edge; clearing the strip must not
    // shrink or shift the panel sideways.
    assert.equal(box.shellRight, box.viewport, 'the drawer must stay flush with the trailing edge')
  }
})

test('on macOS the drawer header starts below the traffic lights', { skip: SKIP }, () => {
  // The host folds platform and fullscreen into --dsh-frame-overlay-top; when it
  // publishes it, that value wins.
  const both = measureDrawer({
    htmlAttrs: 'data-platform="darwin"',
    cssVars: { '--dsh-frame-top-clearance': '48px', '--dsh-frame-overlay-top': '68px' },
  })
  assert.equal(both.headTop, 68, 'the host-computed overlay top must win over the raw clearance')

  // With only the raw clearance published, the drawer still clears it.
  const rawOnly = measureDrawer({
    htmlAttrs: 'data-platform="darwin"',
    cssVars: { '--dsh-frame-top-clearance': '48px' },
  })
  assert.equal(rawOnly.headTop, 48, 'the raw clearance must be honoured when overlay-top is absent')

  // A document that publishes neither must not invent an offset: a phantom
  // band above the drawer would be a dead zone the reader cannot click through.
  const neither = measureDrawer({ htmlAttrs: 'data-platform="darwin"', cssVars: {} })
  assert.equal(neither.headTop, 0, 'no published clearance means no offset')
})

test('the offset disappears in fullscreen on both desktops', { skip: SKIP }, () => {
  // The strip and the traffic lights are both hidden in fullscreen, so keeping
  // the offset would leave an unclickable band above the drawer.
  const win = measureDrawer({
    htmlAttrs: 'data-windows-titlebar data-fullscreen',
    cssVars: { '--dsh-windows-titlebar-height': '40px' },
    fullscreen: true,
  })
  assert.equal(win.headTop, 0, 'fullscreen on Windows must remove the caption-strip offset')

  const mac = measureDrawer({
    htmlAttrs: 'data-platform="darwin" data-fullscreen',
    cssVars: { '--dsh-frame-top-clearance': '48px', '--dsh-frame-overlay-top': '68px' },
    fullscreen: true,
  })
  assert.equal(mac.headTop, 0, 'fullscreen on macOS must remove the traffic-light offset')
})

test('a plain web browser keeps the drawer at the frame edge', { skip: SKIP }, () => {
  // No desktop markers means no native chrome to avoid; an offset here would be
  // a permanent empty band on a normal web session.
  const box = measureDrawer({ htmlAttrs: '', cssVars: { '--dsh-windows-titlebar-height': '40px' } })
  assert.equal(box.headTop, 0, 'a web session must not be offset by desktop-only rules')
})
