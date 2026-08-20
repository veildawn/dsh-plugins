import React, { useState, useEffect, useRef, Fragment } from 'react'
import { IconCloseOutline16, IconFullscreenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

const RPC_CHANNEL = '/dsh-terminal'
const OVERLAY_SLOT = 'shell.overlay'
const HEADER_SLOT = 'conversation.session.header.utilities'
const COMPOSER_SLOT = 'conversation.input.left'
const SESSION_SLOT = 'conversation.input.overlay'
const STYLE_ID = 'dsh-terminal-styles'

const XTERM_CSS = `/**
 * Copyright (c) 2014 The xterm.js authors. All rights reserved.
 * Copyright (c) 2012-2013, Christopher Jeffrey (MIT License)
 * https://github.com/chjj/term.js
 * @license MIT
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * Originally forked from (with the author's permission):
 *   Fabrice Bellard's javascript vt100 for jslinux:
 *   http://bellard.org/jslinux/
 *   Copyright (c) 2011 Fabrice Bellard
 *   The original design remains. The terminal itself
 *   has been extended to include xterm CSI codes, among
 *   other features.
 */

/**
 *  Default styles for xterm.js
 */

.xterm {
    cursor: text;
    position: relative;
    user-select: none;
    -ms-user-select: none;
    -webkit-user-select: none;
}

.xterm.focus,
.xterm:focus {
    outline: none;
}

.xterm .xterm-helpers {
    position: absolute;
    top: 0;
    /**
     * The z-index of the helpers must be higher than the canvases in order for
     * IMEs to appear on top.
     */
    z-index: 5;
}

.xterm .xterm-helper-textarea {
    padding: 0;
    border: 0;
    margin: 0;
    /* Move textarea out of the screen to the far left, so that the cursor is not visible */
    position: absolute;
    opacity: 0;
    left: -9999em;
    top: 0;
    width: 0;
    height: 0;
    z-index: -5;
    /** Prevent wrapping so the IME appears against the textarea at the correct position */
    white-space: nowrap;
    overflow: hidden;
    resize: none;
}

.xterm .composition-view {
    /* TODO: Composition position got messed up somewhere */
    background: #000;
    color: #FFF;
    display: none;
    position: absolute;
    white-space: nowrap;
    z-index: 1;
}

.xterm .composition-view.active {
    display: block;
}

.xterm .xterm-viewport {
    /* On OS X this is required in order for the scroll bar to appear fully opaque */
    background-color: #000;
    overflow-y: scroll;
    cursor: default;
    position: absolute;
    right: 0;
    left: 0;
    top: 0;
    bottom: 0;
}

.xterm .xterm-screen {
    position: relative;
}

.xterm .xterm-screen canvas {
    position: absolute;
    left: 0;
    top: 0;
}

.xterm-char-measure-element {
    display: inline-block;
    visibility: hidden;
    position: absolute;
    top: 0;
    left: -9999em;
    line-height: normal;
}

.xterm.enable-mouse-events {
    /* When mouse events are enabled (eg. tmux), revert to the standard pointer cursor */
    cursor: default;
}

.xterm.xterm-cursor-pointer,
.xterm .xterm-cursor-pointer {
    cursor: pointer;
}

.xterm.column-select.focus {
    /* Column selection mode */
    cursor: crosshair;
}

.xterm .xterm-accessibility:not(.debug),
.xterm .xterm-message {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    right: 0;
    z-index: 10;
    color: transparent;
    pointer-events: none;
}

.xterm .xterm-accessibility-tree:not(.debug) *::selection {
  color: transparent;
}

.xterm .xterm-accessibility-tree {
  font-family: monospace;
  user-select: text;
  white-space: pre;
}

.xterm .xterm-accessibility-tree > div {
  transform-origin: left;
  width: fit-content;
}

.xterm .live-region {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
    overflow: hidden;
}

.xterm-dim {
    /* Dim should not apply to background, so the opacity of the foreground color is applied
     * explicitly in the generated class and reset to 1 here */
    opacity: 1 !important;
}

.xterm-underline-1 { text-decoration: underline; }
.xterm-underline-2 { text-decoration: double underline; }
.xterm-underline-3 { text-decoration: wavy underline; }
.xterm-underline-4 { text-decoration: dotted underline; }
.xterm-underline-5 { text-decoration: dashed underline; }

.xterm-overline {
    text-decoration: overline;
}

.xterm-overline.xterm-underline-1 { text-decoration: overline underline; }
.xterm-overline.xterm-underline-2 { text-decoration: overline double underline; }
.xterm-overline.xterm-underline-3 { text-decoration: overline wavy underline; }
.xterm-overline.xterm-underline-4 { text-decoration: overline dotted underline; }
.xterm-overline.xterm-underline-5 { text-decoration: overline dashed underline; }

.xterm-strikethrough {
    text-decoration: line-through;
}

.xterm-screen .xterm-decoration-container .xterm-decoration {
	z-index: 6;
	position: absolute;
}

.xterm-screen .xterm-decoration-container .xterm-decoration.xterm-decoration-top-layer {
	z-index: 7;
}

.xterm-decoration-overview-ruler {
    z-index: 8;
    position: absolute;
    top: 0;
    right: 0;
    pointer-events: none;
}

.xterm-decoration-top {
    z-index: 2;
    position: relative;
}



/* Derived from vs/base/browser/ui/scrollbar/media/scrollbar.css */

/* xterm.js customization: Override xterm's cursor style */
.xterm .xterm-scrollable-element > .scrollbar {
    cursor: default;
}

/* Arrows */
.xterm .xterm-scrollable-element > .scrollbar > .scra {
	cursor: pointer;
	font-size: 11px !important;
}

.xterm .xterm-scrollable-element > .visible {
	opacity: 1;

	/* Background rule added for IE9 - to allow clicks on dom node */
	background:rgba(0,0,0,0);

	transition: opacity 100ms linear;
	/* In front of peek view */
	z-index: 11;
}
.xterm .xterm-scrollable-element > .invisible {
	opacity: 0;
	pointer-events: none;
}
.xterm .xterm-scrollable-element > .invisible.fade {
	transition: opacity 800ms linear;
}

/* Scrollable Content Inset Shadow */
.xterm .xterm-scrollable-element > .shadow {
	position: absolute;
	display: none;
}
.xterm .xterm-scrollable-element > .shadow.top {
	display: block;
	top: 0;
	left: 3px;
	height: 3px;
	width: 100%;
	box-shadow: var(--vscode-scrollbar-shadow, #000) 0 6px 6px -6px inset;
}
.xterm .xterm-scrollable-element > .shadow.left {
	display: block;
	top: 3px;
	left: 0;
	height: 100%;
	width: 3px;
	box-shadow: var(--vscode-scrollbar-shadow, #000) 6px 0 6px -6px inset;
}
.xterm .xterm-scrollable-element > .shadow.top-left-corner {
	display: block;
	top: 0;
	left: 0;
	height: 3px;
	width: 3px;
}
.xterm .xterm-scrollable-element > .shadow.top.left {
	box-shadow: var(--vscode-scrollbar-shadow, #000) 6px 0 6px -6px inset;
}`

const CUSTOM_CSS = `
  .term-scrim {
    position: fixed;
    inset: 0;
    z-index: 950;
    display: flex;
    align-items: stretch;
    justify-content: flex-end;
    background: color-mix(in srgb, #000 45%, transparent);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    pointer-events: auto;
    color-scheme: dark;
    animation: term-fade 0.16s ease-out;
  }
  .term-drawer {
    display: flex;
    flex-direction: column;
    width: min(72vw, 1150px);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border-left: 1px solid var(--dsw-alias-border-l2);
    background: #0f1117;
    box-shadow: var(--dsw-shadow-lv3);
    font-family: var(--dsw-font-family);
    color: #e6edf3;
    animation: term-slide 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .term-drawer.term-fullscreen {
    width: 100vw;
    max-width: 100vw;
    border-left: none;
  }
  @keyframes term-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes term-slide { from { transform: translateX(100%); } to { transform: translateX(0); } }
  @media (prefers-reduced-motion: reduce) {
    .term-scrim, .term-drawer { animation: none; }
  }

  /* Header & Tabs */
  .term-head {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: #161b22;
    border-bottom: 1px solid #30363d;
  }
  .term-mobile-back-btn {
    display: none;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 32px;
    padding: 0 10px;
    border: 1px solid #30363d;
    border-radius: 8px;
    background: #21262d;
    color: #58a6ff;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    flex: none;
    user-select: none;
    outline: none;
  }
  .term-mobile-back-btn:active {
    background: #30363d;
  }
  .term-tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .term-tabs::-webkit-scrollbar { display: none; }
  .term-tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 180px;
    height: 28px;
    padding: 0 8px 0 10px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: #21262d;
    color: #8b949e;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
    transition: all 0.12s ease;
  }
  .term-tab:hover {
    background: #30363d;
    color: #c9d1d9;
  }
  .term-tab[aria-selected="true"] {
    background: #0f1117;
    color: #58a6ff;
    border-color: #388bfd40;
  }
  .term-tab-title {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .term-tab-close {
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border: none;
    border-radius: 4px;
    background: none;
    color: inherit;
    font-size: 11px;
    cursor: pointer;
    opacity: 0.6;
  }
  .term-tab-close:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.15);
  }
  .term-tab-add {
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex: none;
    border: 1px dashed #30363d;
    border-radius: 6px;
    background: none;
    color: #8b949e;
    cursor: pointer;
    font-size: 15px;
  }
  .term-tab-add:hover {
    border-color: #58a6ff;
    color: #58a6ff;
    background: #21262d;
  }
  .term-head-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: none;
  }
  .term-btn {
    display: inline-grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 6px;
    background: none;
    color: #8b949e;
    cursor: pointer;
  }
  .term-btn:hover, .term-btn:active {
    background: #30363d;
    color: #f0f6fc;
  }

  /* Composer toolbar button & tools popover */
  .term-composer-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .term-composer-btn {
    box-sizing: border-box;
    display: inline-grid;
    place-items: center;
    width: 32px;
    height: 32px;
    min-width: 32px;
    min-height: 32px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--dsw-alias-label-secondary);
    cursor: pointer;
    font-family: ui-monospace, monospace;
    font-weight: 700;
    font-size: 14px;
    line-height: 1;
    outline: none;
    transition: background 0.12s, color 0.12s;
  }
  .term-composer-btn:hover, .term-composer-btn:active, .term-composer-btn[aria-expanded="true"] {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-brand-primary, #4d6bfe);
  }
  .term-tools-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1250;
    background: transparent;
  }
  .term-tools-menu {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    z-index: 1260;
    min-width: 170px;
    padding: 5px;
    border: 1px solid var(--dsw-alias-border-l2);
    border-radius: 12px;
    background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-base)));
    box-shadow: var(--dsw-shadow-lv3);
    color: var(--dsw-alias-label-primary);
    font-family: var(--dsw-font-family);
    font-size: 13px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    animation: term-popover-in 0.12s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  @keyframes term-popover-in {
    from { opacity: 0; transform: translateY(6px) scale(0.96); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .term-tools-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 34px;
    padding: 0 10px;
    border: none;
    border-radius: 8px;
    background: none;
    color: inherit;
    font: inherit;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
    -webkit-tap-highlight-color: transparent;
  }
  .term-tools-item:hover {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-primary);
  }
  .term-tools-item:active {
    background: var(--dsw-alias-interactive-bg-hover-solid, var(--dsw-alias-interactive-bg-hover));
  }
  .term-tools-item-icon {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    flex: none;
    font-size: 14px;
  }
  .term-tools-divider {
    height: 1px;
    margin: 2px 4px;
    background: var(--dsw-alias-border-l1);
  }

  /* Body & xterm container */
  .term-body {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    background: #0f1117;
    overflow: hidden;
  }
  .term-xterm-container {
    width: 100%;
    height: 100%;
    padding: 6px 8px;
    box-sizing: border-box;
  }
  .term-xterm-container .xterm {
    height: 100%;
    padding: 0;
  }
  .term-xterm-container .xterm-viewport {
    background-color: #0f1117 !important;
  }

  /* Mobile Accessory Keyboard Toolbar */
  .term-mobile-bar {
    display: none;
    flex: none;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: #161b22;
    border-top: 1px solid #30363d;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .term-mobile-bar::-webkit-scrollbar { display: none; }
  .term-key-btn {
    flex: none;
    height: 36px;
    min-width: 42px;
    padding: 0 10px;
    border: 1px solid #30363d;
    border-radius: 6px;
    background: #21262d;
    color: #c9d1d9;
    font-family: ui-monospace, monospace;
    font-size: 13px;
    font-weight: 600;
    display: inline-grid;
    place-items: center;
    cursor: pointer;
    user-select: none;
    touch-action: manipulation;
  }
  .term-key-btn:active {
    background: #58a6ff;
    color: #ffffff;
  }
  .term-exit-btn {
    background: rgba(248, 81, 73, 0.15);
    border-color: rgba(248, 81, 73, 0.4);
    color: #ff7b72;
    margin-left: auto;
    font-weight: 700;
  }
  .term-exit-btn:active {
    background: #f85149;
    color: #ffffff;
  }

  /* Ensure overlay layer is raised above mobile navigation bar (z-index 900) */
  [data-slot="root"] .pI_x6G_overlayLayer:has(.term-scrim) {
    z-index: 1200 !important;
  }

  /* Mobile Media Query Overrides (<= 768px) */
  @media (max-width: 768px) {
    [data-slot="root"] .pI_x6G_overlayLayer:has(.term-scrim) {
      z-index: 1200 !important;
    }
    .term-scrim {
      position: fixed !important;
      inset: 0 !important;
      width: 100vw !important;
      height: var(--dsh-vvh, 100dvh) !important;
      z-index: 1200 !important;
      animation: none !important;
    }
    .term-drawer {
      box-sizing: border-box !important;
      width: 100vw !important;
      max-width: 100vw !important;
      height: 100% !important;
      border-left: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      animation: none !important;
      padding-top: var(--dsh-sat, 0px);
      padding-bottom: var(--dsh-sab, 0px);
    }
    .term-head {
      padding: calc(6px + var(--dsh-sat, 0px)) max(10px, var(--dsh-sar, 0px)) 8px max(10px, var(--dsh-sal, 0px));
    }
    .term-mobile-back-btn {
      display: inline-flex;
      height: 36px;
      min-width: 64px;
      touch-action: manipulation;
    }
    .term-mobile-bar {
      display: flex;
      padding-bottom: max(6px, var(--dsh-sab, 0px));
      padding-left: max(10px, var(--dsh-sal, 0px));
      padding-right: max(10px, var(--dsh-sar, 0px));
    }
    .term-btn[title*="全屏"] {
      display: none;
    }
    .term-head-actions .term-btn {
      width: 36px;
      height: 36px;
      background: #21262d;
      border: 1px solid #30363d;
      border-radius: 8px;
    }
  }
`

function ensureStyles(doc) {
  const target = doc || (typeof document !== 'undefined' ? document : null)
  if (!target || target.getElementById(STYLE_ID)) return
  const el = target.createElement('style')
  el.id = STYLE_ID
  el.textContent = XTERM_CSS + '\n' + CUSTOM_CSS
  target.head.appendChild(el)
}

function createStore(initial) {
  let state = initial
  const listeners = new Set()
  return {
    get: () => state,
    set: (next) => {
      state = typeof next === 'function' ? next(state) : next
      listeners.forEach((l) => l(state))
    },
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

function useStore(store) {
  const [state, setState] = useState(store.get())
  useEffect(() => store.subscribe(setState), [store])
  return state
}

function createRequest(connection) {
  return async (method, payload) => {
    const result = await connection.rpc.call(RPC_CHANNEL, method, payload || {})
    if (result && result.ok === true) return result.value
    const error = new Error((result && result.error && result.error.message) || 'terminal request failed')
    error.code = result && result.error && result.error.code
    throw error
  }
}

export function apply(ctx) {
  ensureStyles(typeof document === 'undefined' ? null : document)

  const openStore = createStore(null) // { sessionId } or null
  const sessionStore = createStore(undefined)
  const request = createRequest(ctx.connection)

  /** Individual xterm.js Terminal Instance for one Tab */
  function TerminalTabContent({ session, active, isFullscreen, onClose }) {
    const containerRef = useRef(null)
    const termRef = useRef(null)
    const fitAddonRef = useRef(null)
    const offsetRef = useRef(0)
    const pollTimerRef = useRef(null)

    // Send data to host PTY
    const sendData = (data) => {
      request('write', { id: session.id, data }).catch(() => {})
    }

    // Initialize xterm
    useEffect(() => {
      if (!containerRef.current) return

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace',
        theme: {
          background: '#0f1117',
          foreground: '#e6edf3',
          cursor: '#58a6ff',
          selectionBackground: '#388bfd40',
          black: '#484f58',
          red: '#ff7b72',
          green: '#7ee787',
          yellow: '#d29922',
          blue: '#58a6ff',
          magenta: '#bc8cff',
          cyan: '#39c5cf',
          white: '#b1bac4',
          brightBlack: '#6e7681',
          brightRed: '#ffa198',
          brightGreen: '#56d364',
          brightYellow: '#e3b341',
          brightBlue: '#79c0ff',
          brightMagenta: '#d2a8ff',
          brightCyan: '#56d4dd',
          brightWhite: '#ffffff',
        },
        convertEol: true,
      })

      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      term.open(containerRef.current)

      // Fit and sync size with backend
      try {
        fitAddon.fit()
        request('resize', { id: session.id, cols: term.cols, rows: term.rows }).catch(() => {})
      } catch (_) {}

      // Handle user keyboard / paste input directly from xterm
      term.onData((data) => {
        sendData(data)
      })

      termRef.current = term
      fitAddonRef.current = fitAddon

      return () => {
        term.dispose()
        termRef.current = null
        fitAddonRef.current = null
      }
    }, [session.id])

    // Fit on active / fullscreen change
    useEffect(() => {
      if (!active || !fitAddonRef.current || !termRef.current) return
      const timer = setTimeout(() => {
        try {
          fitAddonRef.current.fit()
          termRef.current.focus()
          request('resize', {
            id: session.id,
            cols: termRef.current.cols,
            rows: termRef.current.rows,
          }).catch(() => {})
        } catch (_) {}
      }, 50)
      return () => clearTimeout(timer)
    }, [active, isFullscreen])

    // Polling loop for output stream
    useEffect(() => {
      if (!active) return
      let mounted = true

      const poll = async () => {
        try {
          const res = await request('poll', { id: session.id, offset: offsetRef.current })
          if (!mounted) return
          if (res.data && termRef.current) {
            termRef.current.write(res.data)
            offsetRef.current = res.nextOffset
          }
        } catch (_) {}
        if (mounted) {
          pollTimerRef.current = setTimeout(poll, 40)
        }
      }

      poll()
      return () => {
        mounted = false
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
      }
    }, [session.id, active])

    return (
      <div
        className="term-body"
        style={{ display: active ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}
      >
        <div ref={containerRef} className="term-xterm-container" />
        {/* Mobile Accessory Toolbar */}
        <div className="term-mobile-bar">
          <button type="button" className="term-key-btn" onClick={() => sendData('\x1b')}>
            Esc
          </button>
          <button type="button" className="term-key-btn" onClick={() => sendData('\t')}>
            Tab
          </button>
          <button type="button" className="term-key-btn" onClick={() => sendData('\x03')}>
            ^C
          </button>
          <button type="button" className="term-key-btn" onClick={() => sendData('\x04')}>
            ^D
          </button>
          <button
            type="button"
            className="term-key-btn"
            onClick={() => {
              if (termRef.current) termRef.current.clear()
              sendData('\x0c')
            }}
          >
            Clear
          </button>
          <button type="button" className="term-key-btn" onClick={() => sendData('\x1b[A')}>
            ↑
          </button>
          <button type="button" className="term-key-btn" onClick={() => sendData('\x1b[B')}>
            ↓
          </button>
          <button type="button" className="term-key-btn" onClick={() => sendData('\x1b[D')}>
            ←
          </button>
          <button type="button" className="term-key-btn" onClick={() => sendData('\x1b[C')}>
            →
          </button>
          <button
            type="button"
            className="term-key-btn term-exit-btn"
            title="退出并返回"
            onClick={onClose}
          >
            ✕ 退出
          </button>
        </div>
      </div>
    )
  }

  /** Full Terminal Overlay & Multi-Tab Drawer */
  function TerminalOverlay(props) {
    const openState = useStore(openStore)
    const isOpen = openState !== null
    const [tabs, setTabs] = useState([])
    const [activeId, setActiveId] = useState(null)
    const [isFullscreen, setIsFullscreen] = useState(false)

    // Spawn first terminal session when opened and empty
    useEffect(() => {
      if (isOpen && tabs.length === 0) {
        createTab()
      }
    }, [isOpen])

    const createTab = async () => {
      try {
        const res = await request('create', {
          sessionId: openState?.sessionId,
          cols: 100,
          rows: 30,
        })
        setTabs((prev) => [...prev, res])
        setActiveId(res.id)
      } catch (err) {
        console.error('Failed to create terminal session:', err)
      }
    }

    const closeTab = async (id, e) => {
      if (e) e.stopPropagation()
      try {
        await request('close', { id })
      } catch (_) {}
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id)
        if (activeId === id) {
          setActiveId(next.length > 0 ? next[next.length - 1].id : null)
        }
        if (next.length === 0) {
          openStore.set(null)
        }
        return next
      })
    }

    if (!isOpen) return null

    return (
      <div className="term-scrim" onClick={() => openStore.set(null)}>
        <div
          className={'term-drawer' + (isFullscreen ? ' term-fullscreen' : '')}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="term-head">
            {/* Mobile prominent Return / Back button */}
            <button
              type="button"
              className="term-mobile-back-btn"
              onClick={() => openStore.set(null)}
            >
              ‹ 返回
            </button>

            <div className="term-tabs">
              {tabs.map((tab, idx) => (
                <div
                  key={tab.id}
                  className="term-tab"
                  aria-selected={activeId === tab.id}
                  onClick={() => setActiveId(tab.id)}
                >
                  <span className="term-tab-title">
                    {'>_ ' + (tab.shell || 'Terminal') + ' #' + (idx + 1)}
                  </span>
                  <button
                    type="button"
                    className="term-tab-close"
                    onClick={(e) => closeTab(tab.id, e)}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="term-tab-add"
                title="新建终端标签"
                onClick={createTab}
              >
                +
              </button>
            </div>
            <div className="term-head-actions">
              <button
                type="button"
                className="term-btn"
                title={isFullscreen ? '还原窗口' : '全屏展开'}
                onClick={() => setIsFullscreen(!isFullscreen)}
              >
                <IconFullscreenOutline16 size={16} />
              </button>
              <button
                type="button"
                className="term-btn"
                title="关闭终端并返回"
                onClick={() => openStore.set(null)}
              >
                <IconCloseOutline16 size={16} />
              </button>
            </div>
          </div>

          {/* Tab content bodies */}
          {tabs.map((tab) => (
            <TerminalTabContent
              key={tab.id}
              session={tab}
              active={activeId === tab.id}
              isFullscreen={isFullscreen}
              onClose={() => openStore.set(null)}
            />
          ))}
        </div>
      </div>
    )
  }

  /** Desktop Header Action Trigger */
  function TerminalHeaderAction(props) {
    const sessionId = props?.sessionId
    return (
      <button
        type="button"
        className="fv-icon-button"
        title="打开本地终端"
        aria-label="打开本地终端"
        onClick={() => openStore.set(openStore.get() === null ? { sessionId } : null)}
      >
        <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>&gt;_</span>
      </button>
    )
  }

  /** Unified Composer Toolbar Action Trigger (Files & Terminal Popover) */
  function TerminalComposerAction(props) {
    const currentSessionId = useStore(sessionStore)
    const [menuOpen, setMenuOpen] = useState(false)
    const isTermOpen = useStore(openStore) !== null

    const openTerminal = (e) => {
      e?.stopPropagation()
      setMenuOpen(false)
      openStore.set({ sessionId: currentSessionId })
    }

    const openFiles = (e) => {
      e?.stopPropagation()
      setMenuOpen(false)
      if (typeof window !== 'undefined' && typeof window.__dsh_open_file_viewer === 'function') {
        try {
          window.__dsh_open_file_viewer({ sessionId: currentSessionId })
          return
        } catch (_) {}
      }
      if (typeof window !== 'undefined') {
        try {
          window.dispatchEvent(new CustomEvent('dsh:open-file-viewer', { detail: { sessionId: currentSessionId } }))
        } catch (_) {}
      }
      if (typeof document !== 'undefined') {
        const btn = document.querySelector('button[aria-label="查看项目文件"], button[title="查看项目文件"], .fv-float-entry')
        if (btn) btn.click()
      }
    }

    return (
      <div className="term-composer-wrap">
        <button
          type="button"
          className="term-composer-btn"
          title="工作区工具（文件查看器 / 本地终端）"
          aria-label="工作区工具"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen((v) => !v)
          }}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="2.5" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M4.5 6L6.5 7.5L4.5 9M8.5 9H11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>

        {menuOpen && (
          <Fragment>
            <div className="term-tools-backdrop" onClick={() => setMenuOpen(false)} />
            <div className="term-tools-menu" role="menu" aria-label="工作区工具">
              <button type="button" className="term-tools-item" role="menuitem" onClick={openFiles}>
                <span className="term-tools-item-icon" aria-hidden="true">📁</span>
                <span>文件查看器</span>
              </button>
              <button type="button" className="term-tools-item" role="menuitem" onClick={openTerminal}>
                <span className="term-tools-item-icon" aria-hidden="true" style={{ fontFamily: 'monospace', fontWeight: 700 }}>&gt;_</span>
                <span>本地终端</span>
              </button>
            </div>
          </Fragment>
        )}
      </div>
    )
  }

  function SessionReporter(props) {
    const sessionId = props?.sessionId
    useEffect(() => {
      sessionStore.set(sessionId)
      return () => {
        if (sessionStore.get() === sessionId) sessionStore.set(undefined)
      }
    }, [sessionId])
    return null
  }

  // 1. Mount Overlay (Drawer) in shell.overlay
  ctx.slots.inject(OVERLAY_SLOT, () =>
    ctx.slots.register(
      {
        name: OVERLAY_SLOT,
        id: 'terminal-drawer-overlay',
        order: 40,
        inject: () => ({ api: ctx.connection.api }),
      },
      TerminalOverlay
    )
  )

  // 2. Mount Desktop Header Trigger
  ctx.slots.inject(HEADER_SLOT, () =>
    ctx.slots.register(
      {
        name: HEADER_SLOT,
        id: 'terminal-header-action',
        order: -8,
      },
      TerminalHeaderAction
    )
  )

  // 3. Mount Clean Toolbar Trigger inside Composer (Mobile & Desktop native bar, zero floating ball clutter)
  ctx.slots.inject(COMPOSER_SLOT, () =>
    ctx.slots.register(
      {
        name: COMPOSER_SLOT,
        id: 'terminal-composer-action',
        order: 10,
      },
      TerminalComposerAction
    )
  )

  // 4. Session Reporter
  ctx.slots.inject(SESSION_SLOT, () =>
    ctx.slots.register(
      {
        name: SESSION_SLOT,
        id: 'terminal-session-reporter',
        order: 0,
      },
      SessionReporter
    )
  )
}

export const inject = ['slots', 'connection']
