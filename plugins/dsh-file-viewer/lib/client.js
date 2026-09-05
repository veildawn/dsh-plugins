(function ensureCryptoRandomUUID() {
  if (typeof globalThis === "undefined") return;
  const crypto = globalThis.crypto || (globalThis.crypto = {});
  if (typeof crypto.randomUUID === "function") return;
  crypto.randomUUID = function randomUUID() {
    if (typeof crypto.getRandomValues === "function") {
      return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (digit) =>
        (digit ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> digit / 4).toString(16)
      );
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (placeholder) => {
      const random = Math.random() * 16 | 0;
      return (placeholder === "x" ? random : random & 3 | 8).toString(16);
    });
  };
})();

window.__ModuleLoader__.load({
  id: "dsh-file-viewer",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    const { ReadBlock, MarkdownText, JsonTree, IconFolderOpen16, IconFolderOutline16, IconCloseOutline16, IconFullscreenOutline16, writeClipboard } = primitives;

    const Component = react.Component || class Component { constructor(props) { this.props = props; this.state = {}; } setState(s) { Object.assign(this.state, typeof s === "function" ? s(this.state) : s); } };
    class ErrorBoundary extends Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      componentDidCatch(error) {
        try { console.error("[dsh-file-viewer] render error caught by boundary:", error); } catch (_) {}
      }
      componentDidUpdate(prevProps) {
        if (prevProps && prevProps.resetKey !== this.props.resetKey && this.state.error !== null) {
          this.setState({ error: null });
        }
      }
      render() {
        if (this.state.error !== null) {
          if (typeof this.props.fallback === "function") {
            return this.props.fallback(this.state.error, () => this.setState({ error: null }));
          }
          return react.createElement("div", { className: "fv-note fv-error" },
            react.createElement("span", null, "查看文件时出错：" + (this.state.error?.message || "未知错误"))
          );
        }
        return this.props.children;
      }
    }

    const MARKDOWN_LABELS = Object.freeze({
      code: Object.freeze({ copyLabel: "复制", copiedLabel: "复制成功" }),
      footnotes: "脚注",
    });
    const MARKDOWN_CODE_LABELS = Object.freeze({
      copyLabel: "复制",
      copiedLabel: "复制成功",
    });
    // Host ReadBlock/JsonTree now require localized copy for banners, copy
    // buttons and expand/collapse. Missing these throws during render:
    // "Cannot read properties of undefined (reading 'copy'|'window')".
    const READ_BLOCK_LABELS = Object.freeze({
      copy: "复制",
      copied: "已复制",
      window: (shown, total) => `第 ${shown} / ${total} 行`,
      collapse: "收起",
      expand: (hidden) => `展开其余 ${hidden} 行`,
      collapseAria: "收起隐藏行",
      expandAria: (hidden) => `展开其余 ${hidden} 行`,
    });
    const JSON_TREE_LABELS = Object.freeze({
      copy: "复制",
      copied: "已复制",
      copyFailed: "复制失败",
      copyValue: "复制值",
      copyPrettyJson: "复制格式化 JSON",
    });

    const IconFullscreenExitOutline16 = ({ size = 16, className }) => react.createElement("svg", {
      width: size,
      height: size,
      className,
      viewBox: "0 0 16 16",
      fill: "none",
      xmlns: "http://www.w3.org/2000/svg",
    },
      react.createElement("path", {
        d: "M6.59167 8.33777L2.58875 12.3407L1.19324 10.9452V15.8906H6.13854V14.4951L1.79869 14.4951L5.80162 10.4922L6.87291 11.5625L6.59167 8.33777Z",
        fill: "currentColor",
      }),
      react.createElement("path", {
        d: "M9.40808 7.66296L13.411 3.66003L14.8065 5.05457V0.109238H9.86121V1.50475L14.2011 1.50475L10.1981 5.50768L9.12684 4.43737L9.40808 7.66296Z",
        fill: "currentColor",
      })
    );

    async function copyToClipboard(text) {
      if (typeof writeClipboard === "function") {
        try { const ok = await writeClipboard(text); if (ok) return true; } catch (_) {}
      }
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
      }
      if (typeof document !== "undefined") {
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand("copy");
          ta.remove();
          return ok;
        } catch (_) {}
      }
      return false;
    }

    const RPC_CHANNEL = "/dsh-file-viewer";
    const OVERLAY_SLOT = "shell.overlay";
    // Session-scoped utilities sit at the far right of the conversation header;
    // the contract reserves `actions` for context and lineage controls, so an
    // optional tool belongs here and cannot disturb their order.
    const HEADER_SLOT = "conversation.session.header.utilities";
    // The session header is not rendered for a session with no messages, so the
    // header entry cannot be the only source of the active session id. This slot
    // hangs off the composer, which exists even in an empty session.
    const SESSION_SLOT = "conversation.input.overlay";
    // Seat on the composer's own toolbar row. Its props carry the input state,
    // which is the only place a plugin can read the draft and write it back, so
    // the mention button needs a component mounted here even though it draws
    // nothing itself.
    const COMPOSER_SLOT = "conversation.input.left";
    const STYLE_ID = "dsh-file-viewer-styles";
    // Per-browser UI state, so it lives in localStorage rather than plugin
    // settings; the key follows the `<plugin>.<setting>` form used elsewhere.
    const ENTRY_POSITION_KEY = "dsh-file-viewer.entry-position";
    const TREE_WIDTH_KEY = "dsh-file-viewer.tree-width";
    const DEFAULT_TREE_WIDTH = 280;
    const MIN_TREE_WIDTH = 160;
    const MAX_TREE_WIDTH = 700;
    // Below this much travel a press is a tap. Large enough to absorb the slip of
    // a finger on a touch target, small enough that a deliberate drag registers.
    const DRAG_SLOP = 8;
    const WINDOW_LINES = 500;
    const inject = ["slots", "connection", "workspaces"];

    const css = `
      .fv-scrim{position:absolute;inset:0;z-index:40;display:flex;align-items:stretch;justify-content:flex-end;background:color-mix(in srgb,#000 32%,transparent);pointer-events:auto;color-scheme:light dark;animation:fv-fade .16s ease-out}
      .fv-shell{display:flex;flex-direction:column;width:min(64vw,1100px);min-width:0;min-height:0;overflow:hidden;border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff));box-shadow:var(--dsw-shadow-lv3);font-family:var(--dsw-font-family);color:var(--dsw-alias-label-primary);animation:fv-slide .2s cubic-bezier(.2,.8,.2,1);transition:width .2s cubic-bezier(.2,.8,.2,1)}
      .fv-shell[data-fullscreen="true"]{width:100vw;border-left:none}
      @keyframes fv-fade{from{opacity:0}to{opacity:1}}
      @keyframes fv-slide{from{transform:translateX(100%)}to{transform:translateX(0)}}
      @media(prefers-reduced-motion:reduce){.fv-scrim,.fv-shell{animation:none}}
      .fv-head{display:flex;flex:none;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
      .fv-title{flex:none;font:var(--dsw-font-m-16);font-weight:600}
      .fv-root-select{max-width:280px;height:30px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none;background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
      .fv-crumbs{display:flex;flex:1 1 auto;min-width:0;align-items:center;gap:2px;overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:12px}
      .fv-crumb{max-width:220px;overflow:hidden;padding:2px 4px;border:none;border-radius:6px;background:none;color:inherit;font:inherit;white-space:nowrap;text-overflow:ellipsis;cursor:pointer}
      .fv-crumb:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .fv-crumb-sep{flex:none;opacity:.5}
      .fv-icon-button{display:inline-grid;flex:none;place-items:center;width:30px;height:30px;border:none;border-radius:8px;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer}
      .fv-icon-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .fv-icon-button[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .fv-wrap-glyph{font-size:15px;line-height:1}
      .fv-body{display:flex;flex:1 1 auto;min-height:0}
      .fv-body[data-resizing="true"]{cursor:col-resize;user-select:none}
      .fv-body[data-resizing="true"] *{pointer-events:none!important}
      .fv-body[data-resizing="true"] .fv-resizer{pointer-events:auto!important}
      .fv-tree{box-sizing:border-box;display:flex;flex:none;flex-direction:column;width:var(--fv-tree-width,280px);min-width:160px;max-width:min(700px,calc(100% - 160px));min-height:0;overflow-y:auto;border-right:1px solid var(--dsw-alias-border-l1);padding:6px;gap:1px;overscroll-behavior:contain}
      .fv-resizer{position:relative;flex:none;width:5px;margin-left:-3px;margin-right:-2px;cursor:col-resize;user-select:none;touch-action:none;z-index:2;background:transparent;transition:background-color .15s ease}
      .fv-resizer:hover,.fv-resizer[data-dragging="true"]{background:var(--dsw-alias-brand-primary,#4d6bfe)}
      .fv-resizer::after{content:"";position:absolute;top:0;bottom:0;left:-3px;right:-3px}
      .fv-row{display:flex;align-items:center;gap:8px;min-width:0;min-height:32px;padding:4px 8px;border:none;border-radius:8px;background:none;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);text-align:left;cursor:pointer;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
      .fv-row-seat{position:relative;display:flex;align-items:center;gap:2px;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;width:100%;min-width:0;max-width:100%}
      .fv-row-seat>.fv-row{flex:1 1 auto;min-width:0}
      /* Always visible rather than revealed on hover. Hiding it behind hover
         made it unreachable wherever hover is unreliable — touch screens, but
         also phones with a paired mouse, where (hover:none) reports false. It is
         kept quiet with a muted colour instead, and the row's hover only
         strengthens it. */
      .fv-mention{flex:none;width:26px;height:26px;margin-right:4px;padding:0;border:0;border-radius:6px;background:none;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-s-strong-14);line-height:1;cursor:pointer;opacity:.5}
      .fv-row-seat:hover .fv-mention,.fv-mention:focus-visible{opacity:1}
      .fv-mention:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);opacity:1}
      @media(hover:none),(pointer:coarse){.fv-mention{opacity:1}}
      .fv-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .fv-row[aria-current="true"]{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover))}
      .fv-row-name{flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
      .fv-row-size{flex:none;color:var(--dsw-alias-label-caption);font-size:11px;font-variant-numeric:tabular-nums}
      .fv-glyph{flex:none;width:16px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:11px;transition:transform .12s}
      .fv-glyph-open{transform:rotate(90deg)}
      .fv-tree-status{padding:4px 8px;color:var(--dsw-alias-label-caption);font-size:12px;line-height:20px}
      .fv-main{display:flex;flex:1 1 auto;flex-direction:column;min-width:0;min-height:0}
      .fv-main-head{display:flex;flex:none;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:12px}
      .fv-main-name{flex:1 1 auto;min-width:0;overflow:hidden;color:var(--dsw-alias-label-primary);font-weight:500;white-space:nowrap;text-overflow:ellipsis}
      .fv-content{flex:1 1 auto;min-height:0;overflow:auto;padding:12px;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
      .fv-content>*{max-width:100%}
      .fv-note{display:flex;flex-direction:column;gap:10px;align-items:flex-start;padding:16px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
      .fv-note strong{color:var(--dsw-alias-label-primary);font-weight:600}
      .fv-error{color:var(--dsw-alias-state-error-primary)}
      .fv-button{display:inline-flex;align-items:center;justify-content:center;height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:none;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);cursor:pointer}
      .fv-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
      .fv-button:disabled{opacity:.45;cursor:default}
      .fv-pager{display:flex;flex:none;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:12px}
      .fv-pager-spacer{flex:1 1 auto}
      .fv-image-wrap{display:grid;place-items:center;min-height:100%;padding:8px}
      .fv-image{max-width:100%;max-height:calc(100% - 16px);object-fit:contain;background:repeating-conic-gradient(var(--dsw-alias-border-l1) 0% 25%,transparent 0% 50%) 50%/16px 16px}
      .fv-frame{width:100%;height:100%;min-height:420px;border:none;background:var(--dsw-alias-bg-layer-1,#fff)}
      .fv-sheet-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
      .fv-tab{height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:none;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}
      .fv-tab[aria-selected="true"]{border-color:transparent;background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff}
      .fv-table-wrap{overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:10px}
      .fv-table{border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
      .fv-table th,.fv-table td{max-width:320px;padding:5px 9px;border:1px solid var(--dsw-alias-border-l1);overflow:hidden;text-align:left;white-space:pre-wrap;vertical-align:top;word-break:break-word}
      .fv-table th{position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-secondary);font-weight:600}
      .fv-table th:first-child,.fv-table td:first-child{position:sticky;left:0;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-caption);text-align:right}
      /* Soft wrap for code. ReadBlock's class names carry a build hash, so the
         rules key off its structure: a scrolling body of flex rows, each with a
         gutter span followed by a content span, all white-space:pre. */
      .fv-content[data-wrap="on"] div[class*="_body_"]{overflow-x:hidden}
      .fv-content[data-wrap="on"] div[class*="_line_"]{align-items:flex-start}
      .fv-content[data-wrap="on"] span[class*="_gutter_"]{flex:none;white-space:pre}
      .fv-content[data-wrap="on"] span[class*="_content_"]{min-width:0;flex:1 1 auto;white-space:pre-wrap;overflow-wrap:anywhere}
      .fv-context-backdrop{position:fixed;inset:0;z-index:99;background:transparent;touch-action:none}
      .fv-context-menu{position:fixed;z-index:100;min-width:190px;padding:5px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base)));box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:13px;display:flex;flex-direction:column;gap:3px;animation:fv-menu-in .12s cubic-bezier(.2,.8,.2,1);touch-action:manipulation}
      @keyframes fv-menu-in{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
      .fv-context-item{display:flex;align-items:center;gap:10px;width:100%;height:34px;padding:0 10px;border:none;border-radius:8px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent}
      .fv-context-item:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .fv-context-item:active{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover))}
      .fv-context-item-icon{display:inline-grid;place-items:center;width:18px;height:18px;flex:none;color:var(--dsw-alias-label-secondary);font-size:14px}
      .fv-context-item-label{flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}
      .fv-context-divider{height:1px;margin:3px 4px;background:var(--dsw-alias-border-l1)}
      .fv-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:110;padding:8px 18px;border:1px solid var(--dsw-alias-border-l2);border-radius:20px;background:var(--dsw-alias-button-floating-fill,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;box-shadow:var(--dsw-shadow-lv3);pointer-events:none;animation:fv-toast-in .15s ease-out}
      @keyframes fv-toast-in{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
      .fv-float-entry{display:none}
      @media(max-width:1100px){.fv-shell{width:min(82vw,900px)}}
      /* Below the mobile-adapter breakpoint the drawer takes the full width and
         the two panes swap instead of sitting side by side. */
      @media(max-width:768px){
        /* The narrow layout replaces the session header, so the header entry is
           unreachable there and this floating one takes over. It clears the
           composer and the safe area, and sits under the drawer's z-index.

           Styled after the host's own round floating button (its scroll-to-bottom
           control): a floating fill, a hairline border and shadow-lv2. The
           previous rule named --dsw-alias-bg-inverse and --dsw-alias-label-inverse,
           neither of which the theme defines, so it always rendered the literal
           fallbacks and stayed dark under a light theme.

           Placement comes from the two custom properties rather than fixed
           offsets, so a dragged position needs no inline right/bottom and the
           default still reads from the safe area. touch-action is none because a
           drag would otherwise be claimed by the page scroller. */
        .fv-float-entry{box-sizing:border-box;position:fixed;z-index:39;left:var(--fv-entry-left,auto);right:var(--fv-entry-right,calc(14px + var(--dsh-sar,0px)));bottom:var(--fv-entry-bottom,calc(148px + var(--dsh-sab,0px)));width:48px;height:48px;border:1px solid var(--dsw-alias-border-l2);border-radius:50%;background:var(--dsw-alias-button-floating-fill);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv2);display:grid;place-items:center;cursor:pointer;font-family:var(--dsw-font-family);touch-action:none;-webkit-tap-highlight-color:transparent;transition:transform var(--ds-transition-duration-fast,.1s) var(--ds-ease-in-out)}
        .fv-float-entry:active{background:var(--dsw-alias-button-floating-hover,var(--dsw-alias-button-floating-fill));transform:scale(.94)}
        /* Lifted while dragging so it reads as picked up, and the transition is
           dropped so the button tracks the finger exactly instead of lagging. */
        .fv-float-entry[data-dragging="true"]{box-shadow:var(--dsw-shadow-lv3);transform:scale(1.04);transition:none;cursor:grabbing}
        /* Nested inside this breakpoint rather than beside the other reduce rule
           near the top: at equal specificity the later rule wins, and the entry's
           own transition is declared here, so an earlier one had no effect. */
        @media(prefers-reduced-motion:reduce){
          .fv-float-entry,.fv-float-entry:active,.fv-float-entry[data-dragging="true"]{transition:none;transform:none}
        }
        /* 44px is the smallest comfortable touch target. */
        .fv-mention{width:44px;height:44px;margin-right:2px;opacity:1}
        .fv-shell{width:100%!important;border-left:none!important}
        .fv-btn-fullscreen{display:none!important}
        .fv-resizer{display:none!important}
        .fv-tree{width:100%!important;border-right:none}
        .fv-body[data-pane="content"] .fv-tree,.fv-body[data-pane="tree"] .fv-main{display:none}
        .fv-crumbs{font-size:11px}
        .fv-file-path{display:none!important}
        .fv-context-backdrop{background:rgba(0,0,0,.45);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);animation:fv-fade .16s ease-out}
        .fv-context-menu{position:fixed!important;bottom:max(16px,var(--dsh-sab,0px))!important;left:max(16px,var(--dsh-sal,0px))!important;right:max(16px,var(--dsh-sar,0px))!important;top:auto!important;width:auto!important;max-width:none!important;border-radius:18px!important;padding:8px!important;box-shadow:var(--dsw-shadow-lv3)!important;animation:fv-menu-slide-up .2s cubic-bezier(.2,.8,.2,1)!important}
        @keyframes fv-menu-slide-up{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)}}
        .fv-context-item{height:46px!important;font-size:15px!important;padding:0 14px!important;border-radius:12px!important}
        .fv-context-item-icon{width:22px!important;height:22px!important;font-size:16px!important}
      }
    `;

    /**
     * Inject the stylesheet, refreshing it when the content has changed.
     *
     * Bailing out on the id alone left a stale sheet in place whenever the tag
     * outlived the module — the script would update while the rules did not,
     * which shows up as a layout fault that no reload seems to fix.
     */
    function ensureStyles(doc) {
      if (!doc) return;
      const existing = doc.getElementById(STYLE_ID);
      if (existing) {
        if (existing.textContent !== css) existing.textContent = css;
        return;
      }
      const tag = doc.createElement("style");
      tag.id = STYLE_ID;
      tag.textContent = css;
      doc.head.appendChild(tag);
    }

    /**
     * Write the draft straight to the composer's textarea.
     *
     * The bridge on the composer seat is the clean path, but it only works when
     * the host hands that seat the input props. Where it does not, the button
     * would disappear entirely, so fall back to the element itself: React tracks
     * the value on the node, hence the prototype setter plus a synthetic event
     * rather than a plain assignment, which React would overwrite on the next
     * render.
     */
    function writeDraftToDom(doc, text) {
      const area = doc && doc.querySelector("[data-composer-card] textarea, textarea");
      if (!area) return false;
      const proto = Object.getPrototypeOf(area);
      const setter = Object.getOwnPropertyDescriptor(proto, "value");
      if (setter && typeof setter.set === "function") setter.set.call(area, text);
      else area.value = text;
      area.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }

    /**
     * Resolve where a dragged entry button comes to rest.
     *
     * Horizontally it snaps to whichever edge the button's own centre ended up
     * nearest, so the button never parks mid-screen over the conversation.
     * Vertically it keeps the released height, clamped so it stays clear of the
     * mobile top bar and the bottom safe area — without that clamp a rotation or
     * a keyboard opening can strand it off-screen where it cannot be tapped
     * again.
     *
     * `bottom` is returned rather than `top` because that is the axis the CSS
     * already positions against, and it keeps the button anchored above the
     * composer as the viewport shrinks.
     */
    function settleEntry(input) {
      const box = input || {};
      const size = Number(box.size) > 0 ? Number(box.size) : 48;
      const width = Number(box.width) > 0 ? Number(box.width) : size;
      const height = Number(box.height) > 0 ? Number(box.height) : size;
      const margin = Number.isFinite(Number(box.margin)) ? Number(box.margin) : 14;
      const safe = box.safe || {};
      const top = Math.max(0, Number(safe.top) || 0);
      const bottomInset = Math.max(0, Number(safe.bottom) || 0);
      const left = Math.max(0, Number(safe.left) || 0);
      const right = Math.max(0, Number(safe.right) || 0);

      const centre = (Number(box.x) || 0) + size / 2;
      const side = centre < width / 2 ? "left" : "right";
      const offset = side === "left" ? margin + left : margin + right;

      // Measured from the viewport's bottom, so a larger value sits higher up.
      const fromBottom = height - ((Number(box.y) || 0) + size);
      const lowest = margin + bottomInset;
      const highest = Math.max(lowest, height - top - margin - size);
      return { side, offset, bottom: Math.round(Math.min(Math.max(fromBottom, lowest), highest)) };
    }

    /**
     * Read the stored entry position, discarding anything malformed.
     *
     * Storage can hold a value written by an older build or hand-edited, and a
     * bad one would place the button off-screen with no way to drag it back, so
     * the shape is checked rather than trusted. Reaching localStorage at all
     * throws in some privacy modes, hence the catch around the access itself.
     */
    function readEntryPosition() {
      try {
        const raw = globalThis.localStorage?.getItem(ENTRY_POSITION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const side = parsed?.side;
        const bottom = Number(parsed?.bottom);
        if (side !== "left" && side !== "right") return null;
        if (!Number.isFinite(bottom) || bottom < 0) return null;
        return { side, bottom };
      } catch { return null; }
    }

    function writeEntryPosition(position) {
      try {
        if (position === null) globalThis.localStorage?.removeItem(ENTRY_POSITION_KEY);
        else globalThis.localStorage?.setItem(ENTRY_POSITION_KEY, JSON.stringify(position));
      } catch { /* storage is unavailable; the position is simply not remembered */ }
    }

    function readTreeWidth() {
      try {
        const raw = globalThis.localStorage?.getItem(TREE_WIDTH_KEY);
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed >= MIN_TREE_WIDTH && parsed <= MAX_TREE_WIDTH) {
          return Math.round(parsed);
        }
      } catch { /* storage is unavailable */ }
      return DEFAULT_TREE_WIDTH;
    }

    function writeTreeWidth(width) {
      try {
        if (typeof width === "number" && Number.isFinite(width)) {
          globalThis.localStorage?.setItem(TREE_WIDTH_KEY, String(Math.round(width)));
        }
      } catch { /* storage is unavailable */ }
    }

    /**
     * Minimal subscribable store. The sidebar button and the overlay live in
     * separate slots, so open state cannot be React state inside either one.
     */
    function createStore(initial) {
      let value = initial;
      const listeners = new Set();
      return {
        get: () => value,
        set(next) {
          if (next === value) return;
          value = next;
          for (const listener of [...listeners]) listener(value);
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    }

    function useStore(store) {
      const [value, setValue] = react.useState(store.get());
      react.useEffect(() => store.subscribe(setValue), [store]);
      return value;
    }

    // Guard so a hot reload or re-apply never double-wraps shared open
    // handlers; older hosts used workspaces.openPath.
    const wiredOpenPath = typeof WeakSet !== "undefined" ? new WeakSet() : null;

    function openViewerForPath(openStore, sessionStore, path) {
      const sid = sessionStore.get();
      openStore.set({ filePath: path, sessionId: sid, _t: Date.now() });
    }

    function wrapWorkspaceOpenPath(ctx, openStore, sessionStore) {
      const workspaces = ctx.workspaces;
      if (!workspaces || typeof workspaces.openPath !== "function" || wiredOpenPath === null || wiredOpenPath.has(workspaces)) return;
      wiredOpenPath.add(workspaces);
      workspaces.openPath = async function(path) {
        openViewerForPath(openStore, sessionStore, path);
      };
    }

    function looksLikeFilePath(value) {
      if (!value) return false;
      if (value.includes("/") || value.includes("\\")) return true;
      return /\.[A-Za-z0-9_-]{1,16}$/.test(value);
    }

    function normalizeClickedPath(raw) {
      if (typeof raw !== "string") return "";
      let value = raw.trim();
      if (value === "") return "";
      const labeled = value.match(/^(?:打开|open)\s+(.+)$/i);
      if (labeled) value = labeled[1].trim();
      value = value.replace(/^@+/, "").trim();
      if ((value.startsWith("`") && value.endsWith("`")) || (value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1).trim();
      }
      value = value.replace(/[.,;:!?，。；：！？]+$/g, "").trim();
      return looksLikeFilePath(value) ? value : "";
    }

    function extractClickedPath(element) {
      if (!element) return "";
      const sources = [
        element.getAttribute("data-file-path"),
        element.getAttribute("data-path"),
        element.getAttribute("title"),
        element.getAttribute("aria-label"),
        element.textContent,
      ];
      for (const source of sources) {
        const path = normalizeClickedPath(source);
        if (path) return path;
      }
      return "";
    }

    function isFileOpenControl(element) {
      if (!element) return false;
      if (element.hasAttribute("data-file-path") || element.hasAttribute("data-path") || element.hasAttribute("data-produced-files-row")) return true;
      if (element.closest("code") || element.closest("[data-produced-files-row]")) return true;
      const cls = typeof element.className === "string" ? element.className : "";
      if (cls.includes("fileMention") || cls.includes("file-mention")) return true;
      return Boolean(extractClickedPath(element));
    }

    function setupGlobalFileClickInterceptor(openStore, sessionStore) {
      if (typeof document === "undefined") return;
      document.addEventListener("click", (event) => {
        const target = event.target;
        if (!target || typeof target.closest !== "function") return;
        const btn = target.closest("button, [role='button'], a");
        if (!btn) return;
        if (btn.closest(".fv-shell") || btn.closest(".fv-float-entry") || btn.closest(".fv-context-menu") || btn.closest(".fv-scrim")) return;
        if (!isFileOpenControl(btn)) return;
        const path = extractClickedPath(btn);
        if (!path) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openViewerForPath(openStore, sessionStore, path);
      }, true);
    }

    function baseNameOf(path) {
      const trimmed = String(path || "").replace(/[\\/]+$/, "");
      const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
      return cut < 0 ? trimmed : trimmed.slice(cut + 1);
    }

    /**
     * Append a file reference to a draft. Mirrors core.js's appendMention; this
     * file is the browser bundle and cannot import from the host half.
     * @param {string} draft - the composer's current text.
     * @param {string} displayPath - workspace-relative path.
     * @returns {string} the draft with the reference appended.
     */
    function appendMention(draft, displayPath) {
      const path = typeof displayPath === "string" ? displayPath.trim() : "";
      if (path === "") return typeof draft === "string" ? draft : "";
      const quoted = /[\s`]/.test(path) ? "`" + path.replace(/`/g, "") + "`" : path;
      const reference = "@" + quoted;
      const current = typeof draft === "string" ? draft : "";
      if (current === "") return reference + " ";
      const separator = /\s$/.test(current) ? "" : " ";
      return current + separator + reference + " ";
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes < 0) return "";
      if (bytes < 1024) return bytes + " B";
      const units = ["KB", "MB", "GB", "TB"];
      let value = bytes / 1024;
      let unit = 0;
      while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
      return (value >= 10 ? Math.round(value) : Math.round(value * 10) / 10) + " " + units[unit];
    }

    function parentOf(path) {
      const trimmed = String(path || "").replace(/\/+$/, "");
      const cut = trimmed.lastIndexOf("/");
      return cut < 0 ? "" : trimmed.slice(0, cut);
    }

    /** Every ancestor directory of a path, outermost first. Mirrors lib/core.js. */
    function ancestorsOf(path) {
      const parts = String(path || "").split(/[\\/]+/).filter((part) => part !== "");
      const rows = [];
      let joined = "";
      for (const part of parts.slice(0, -1)) {
        joined = joined === "" ? part : joined + "/" + part;
        rows.push(joined);
      }
      return rows;
    }

    /**
     * Flatten the lazily-loaded tree into render rows. Mirrors `flattenTree` in
     * lib/core.js, which is where it is unit tested — the browser bundle is one
     * hand-written file and cannot import from the host half.
     *
     * A directory whose listing is still in flight contributes a placeholder
     * row rather than nothing, so expanding a slow directory looks like it did
     * something.
     */
    function flattenTree({ expanded, nodes, maxDepth = 32 }) {
      const rows = [];
      const open = expanded || new Set();
      const table = nodes || new Map();

      const walk = (dirPath, depth) => {
        if (depth > maxDepth) return;
        const node = table.get(dirPath);
        if (node === undefined || node.status === "loading") {
          rows.push({ kind: "status", key: dirPath + "\u0000loading", depth, state: "loading" });
          return;
        }
        if (node.status === "error") {
          rows.push({ kind: "status", key: dirPath + "\u0000error", depth, state: "error", error: node.error });
          return;
        }
        const entries = node.entries || [];
        if (entries.length === 0) {
          rows.push({ kind: "status", key: dirPath + "\u0000empty", depth, state: "empty" });
          return;
        }
        for (const entry of entries) {
          const isDirectory = entry.type === "directory";
          const isOpen = isDirectory && open.has(entry.path);
          rows.push({ kind: "entry", key: entry.path, depth, entry, expanded: isOpen });
          if (isOpen) walk(entry.path, depth + 1);
        }
      };

      walk("", 0);
      return rows;
    }

    /** Human-readable copy for each structured host failure. */
    const ERROR_COPY = {
      "no-roots": "没有可浏览的工作区。请先在 DSH 中打开一个工作区。",
      "unknown-root": "该根目录不在本部署的可访问范围内。",
      "outside-root": "该路径超出了工作区范围，已拒绝访问。",
      "not-found": "文件或目录不存在。",
      "not-a-directory": "该路径不是目录。",
      "is-a-directory": "该路径是目录。",
      "too-large": "文件超过查看器大小上限。",
      "read-failed": "读取失败，可能没有访问权限。",
      "unsupported": "宿主端缺少解析该格式所需的依赖。",
    };

    function messageOf(error) {
      const code = error && error.code;
      if (code && Object.hasOwn(ERROR_COPY, code)) return ERROR_COPY[code];
      return (error && error.message) || "操作失败。";
    }

    /**
     * Wrap the RPC channel so callers see values or throw a coded error. The
     * host answers `{ok, value|error}` and never throws a path back at us.
     */
    function createRequest(connection) {
      return async (method, payload) => {
        const result = await connection.rpc.call(RPC_CHANNEL, method, payload || {});
        if (result && result.ok === true) return result.value;
        const error = new Error((result && result.error && result.error.message) || "file-viewer request failed");
        error.code = result && result.error && result.error.code;
        throw error;
      };
    }

    /** Decode base64 into a Blob without a data: URL round-trip. */
    function blobOf(base64, mediaType) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return new Blob([bytes], mediaType ? { type: mediaType } : undefined);
    }

    const MEDIA_TYPES = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
      webp: "image/webp", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon",
      svg: "image/svg+xml", pdf: "application/pdf",
    };

    function mediaTypeOf(path) {
      const base = baseNameOf(path);
      const dot = base.lastIndexOf(".");
      const ext = dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
      return Object.hasOwn(MEDIA_TYPES, ext) ? MEDIA_TYPES[ext] : undefined;
    }

    /** Spreadsheet column letters: 0 -> A, 26 -> AA. */
    function columnLabel(index) {
      let label = "";
      let value = index;
      do {
        label = String.fromCharCode(65 + (value % 26)) + label;
        value = Math.floor(value / 26) - 1;
      } while (value >= 0);
      return label;
    }

    function apply(ctx) {
      ensureStyles(typeof document === "undefined" ? null : document);
      // `null` is closed; an object is open. Carrying the requesting session lets
      // the overlay land on that session's project instead of the first
      // workspace, and a fresh object per open re-runs the resolution.
      // The outline variant reads as faint at icon sizes, so prefer the filled
      // one and keep outline only as a fallback.
      const FolderIcon = IconFolderOpen16 ?? IconFolderOutline16 ?? null;
      const openStore = createStore(null);
      // Which session the conversation header currently belongs to. The phone
      // entry is drawn outside that header and cannot receive its props.
      const sessionStore = createStore(undefined);
      // The composer's draft accessors, captured from the slot that receives
      // them. The drawer renders in a different subtree and cannot reach the
      // input state through props.
      const composerStore = createStore(null);
      const request = createRequest(ctx.connection);

      /**
       * The file tree. Directories expand in place rather than replacing the
       * listing, and a directory's children are requested the first time it
       * opens, so opening the viewer costs one listing regardless of tree size.
       */
      function TreeRow({ row, selected, onToggle, onSelect, onMention, onContextMenu }) {
        const entry = row.entry;
        const isDirectory = entry.type === "directory";
        const indent = { paddingLeft: 8 + row.depth * 14 + "px" };
        const timerRef = react.useRef(null);
        const startPos = react.useRef(null);
        const longPressedRef = react.useRef(false);

        const clearLongPress = () => {
          if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
          }
          startPos.current = null;
        };

        const handlePointerDown = (event) => {
          if (event.button !== 0 && event.button !== undefined) return;
          longPressedRef.current = false;
          startPos.current = { x: event.clientX, y: event.clientY };
          if (timerRef.current !== null) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            longPressedRef.current = true;
            clearLongPress();
            if (onContextMenu) {
              onContextMenu({ x: event.clientX, y: event.clientY, entry });
            }
          }, 450);
        };

        const handlePointerMove = (event) => {
          if (!startPos.current) return;
          const dist = Math.abs(event.clientX - startPos.current.x) + Math.abs(event.clientY - startPos.current.y);
          if (dist > 10) clearLongPress();
        };

        const handleClick = (event) => {
          if (longPressedRef.current) {
            longPressedRef.current = false;
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          clearLongPress();
          if (isDirectory) onToggle(entry.path);
          else onSelect(entry);
        };

        const handleContextMenu = (event) => {
          event.preventDefault();
          event.stopPropagation();
          clearLongPress();
          if (onContextMenu) {
            onContextMenu({ x: event.clientX, y: event.clientY, entry });
          }
        };

        return react.createElement("div", {
          className: "fv-row-seat",
          role: "treeitem",
          "aria-level": row.depth + 1,
          ...(isDirectory ? { "aria-expanded": row.expanded ? "true" : "false" } : {}),
          "aria-current": !isDirectory && entry.path === selected ? "true" : undefined,
          onContextMenu: handleContextMenu,
        },
          react.createElement("button", {
            type: "button",
            className: "fv-row",
            style: indent,
            title: entry.name,
            onPointerDown: handlePointerDown,
            onPointerMove: handlePointerMove,
            onPointerUp: (e) => {
              if (longPressedRef.current) {
                e.preventDefault();
                e.stopPropagation();
              }
              clearLongPress();
            },
            onPointerCancel: clearLongPress,
            onClick: handleClick,
          },
            react.createElement("span", {
              className: row.expanded ? "fv-glyph fv-glyph-open" : "fv-glyph",
              "aria-hidden": "true",
            }, isDirectory ? "▸" : "·"),
            react.createElement("span", { className: "fv-row-name" }, entry.name),
            typeof entry.size === "number" && !isDirectory
              ? react.createElement("span", { className: "fv-row-size" }, formatBytes(entry.size))
              : null),
          onMention === undefined
            ? null
            : react.createElement("button", {
              type: "button",
              className: "fv-mention",
              title: "引用到输入框",
              "aria-label": "引用 " + entry.name + " 到输入框",
              onClick: (event) => {
                event.stopPropagation();
                onMention(entry);
              },
            }, react.createElement("span", { "aria-hidden": "true" }, "@")));
      }

      function Tree({ rows, selected, onToggle, onSelect, onMention, onContextMenu, width }) {
        const children = rows.map((row) => {
          const indent = { paddingLeft: 8 + row.depth * 14 + "px" };
          if (row.kind === "status") {
            const copy = row.state === "loading" ? "正在读取…"
              : row.state === "error" ? messageOf(row.error)
              : "空目录";
            return react.createElement("div", {
              key: row.key,
              className: row.state === "error" ? "fv-tree-status fv-error" : "fv-tree-status",
              style: indent,
            }, copy);
          }
          return react.createElement(TreeRow, {
            key: row.key,
            row,
            selected,
            onToggle,
            onSelect,
            onMention,
            onContextMenu,
          });
        });
        return react.createElement("div", {
          className: "fv-tree", role: "tree", "aria-label": "文件树",
          style: typeof width === "number" ? { width: width + "px" } : undefined,
        }, ...children);
      }

      /** Images and PDFs: fetch bytes once, hand a blob URL to the browser. */
      function BinaryView({ meta, root }) {
        const [state, setState] = react.useState({ status: "loading", url: "", error: null });
        react.useEffect(() => {
          let url = "";
          let live = true;
          setState({ status: "loading", url: "", error: null });
          request("bytes", { root, path: meta.path }).then((value) => {
            if (!live) return;
            url = URL.createObjectURL(blobOf(value.base64, mediaTypeOf(meta.path)));
            setState({ status: "ready", url, error: null });
          }).catch((error) => {
            if (live) setState({ status: "error", url: "", error });
          });
          return () => {
            live = false;
            if (url !== "") URL.revokeObjectURL(url);
          };
        }, [root, meta.path]);

        if (state.status === "loading") return react.createElement("div", { className: "fv-note" }, "正在加载…");
        if (state.status === "error") {
          return react.createElement("div", { className: "fv-note fv-error" }, messageOf(state.error));
        }
        if (meta.kind === "image") {
          return react.createElement("div", { className: "fv-image-wrap" },
            react.createElement("img", { className: "fv-image", src: state.url, alt: meta.name }));
        }
        return react.createElement(react.Fragment, null,
          react.createElement("iframe", { className: "fv-frame", src: state.url, title: meta.name }),
          react.createElement("div", { className: "fv-note" },
            react.createElement("button", {
              type: "button", className: "fv-button", onClick: () => window.open(state.url, "_blank", "noopener"),
            }, "在新标签页打开")));
      }

      /** Excel workbooks: sheet tabs over a plain table. */
      function SheetView({ meta, root }) {
        const [state, setState] = react.useState({ status: "loading", sheets: [], error: null });
        const [active, setActive] = react.useState(0);
        react.useEffect(() => {
          let live = true;
          setState({ status: "loading", sheets: [], error: null });
          setActive(0);
          request("sheet", { root, path: meta.path }).then((value) => {
            if (live) setState({ status: "ready", sheets: value.sheets || [], error: null });
          }).catch((error) => {
            if (live) setState({ status: "error", sheets: [], error });
          });
          return () => { live = false; };
        }, [root, meta.path]);

        if (state.status === "loading") return react.createElement("div", { className: "fv-note" }, "正在解析工作簿…");
        if (state.status === "error") {
          return react.createElement("div", { className: "fv-note fv-error" }, messageOf(state.error));
        }
        const sheet = state.sheets[active];
        if (sheet === undefined) return react.createElement("div", { className: "fv-note" }, "工作簿没有可显示的工作表。");
        const columns = sheet.rows.reduce((widest, row) => Math.max(widest, row.length), 0);
        return react.createElement(react.Fragment, null,
          state.sheets.length > 1
            ? react.createElement("div", { className: "fv-sheet-tabs", role: "tablist" },
              ...state.sheets.map((entry, index) => react.createElement("button", {
                key: entry.name + index,
                type: "button",
                role: "tab",
                className: "fv-tab",
                "aria-selected": index === active ? "true" : "false",
                onClick: () => setActive(index),
              }, entry.name)))
            : null,
          react.createElement("div", { className: "fv-table-wrap" },
            react.createElement("table", { className: "fv-table" },
              react.createElement("thead", null,
                react.createElement("tr", null,
                  react.createElement("th", { scope: "col" }, ""),
                  ...Array.from({ length: columns }, (_, index) => react.createElement("th", { key: index, scope: "col" },
                    columnLabel(index))))),
              react.createElement("tbody", null,
                ...sheet.rows.map((row, rowIndex) => react.createElement("tr", { key: rowIndex },
                  react.createElement("td", null, rowIndex + 1),
                  ...Array.from({ length: columns }, (_, cell) => react.createElement("td", { key: cell },
                    row[cell] === undefined || row[cell] === null ? "" : String(row[cell])))))))),
          sheet.truncated
            ? react.createElement("div", { className: "fv-note" }, `工作表较大，仅显示前 ${sheet.rows.length} 行。`)
            : null);
      }

      /** Word documents: host converts to Markdown, MarkdownText sanitizes it. */
      function DocView({ meta, root }) {
        const [state, setState] = react.useState({ status: "loading", markdown: "", warnings: [], error: null });
        react.useEffect(() => {
          let live = true;
          setState({ status: "loading", markdown: "", warnings: [], error: null });
          request("doc", { root, path: meta.path }).then((value) => {
            if (live) setState({ status: "ready", markdown: value.markdown || "", warnings: value.warnings || [], error: null });
          }).catch((error) => {
            if (live) setState({ status: "error", markdown: "", warnings: [], error });
          });
          return () => { live = false; };
        }, [root, meta.path]);

        if (state.status === "loading") return react.createElement("div", { className: "fv-note" }, "正在转换文档…");
        if (state.status === "error") {
          return react.createElement("div", { className: "fv-note fv-error" }, messageOf(state.error));
        }
        if (state.markdown.trim() === "") {
          return react.createElement("div", { className: "fv-note" }, "文档没有可提取的文本内容。");
        }
        return react.createElement(react.Fragment, null,
          react.createElement(MarkdownText, {
            text: state.markdown,
            labels: MARKDOWN_LABELS,
            codeLabels: MARKDOWN_CODE_LABELS,
          }),
          state.warnings.length > 0
            ? react.createElement("div", { className: "fv-note" }, `转换时有 ${state.warnings.length} 处格式降级（图片或复杂排版）。`)
            : null);
      }

      /** Text, Markdown and JSON: one windowed read, three renderings. */
      function TextView({ meta, root, wrap }) {
        // Callers mount this with a per-file key, so paging state starts fresh
        // for every file instead of leaking the previous file's window into the
        // first request.
        const [state, setState] = react.useState({ status: "loading", data: null, error: null });
        const [offset, setOffset] = react.useState(1);
        const [raw, setRaw] = react.useState(false);
        react.useEffect(() => {
          let live = true;
          setState((current) => ({ status: "loading", data: current.data, error: null }));
          request("read", { root, path: meta.path, offset, limit: WINDOW_LINES }).then((value) => {
            if (live) setState({ status: "ready", data: value, error: null });
          }).catch((error) => {
            if (live) setState({ status: "error", data: null, error });
          });
          return () => { live = false; };
        }, [root, meta.path, offset]);

        if (state.status === "error") {
          return react.createElement("div", { className: "fv-note fv-error" }, messageOf(state.error));
        }
        const data = state.data;
        if (data === null) return react.createElement("div", { className: "fv-note" }, "正在读取…");

        // A rendered preview needs the whole document. Past the host's preview
        // budget only windowed lines arrive, so the source view is all there is.
        const canPreview = (data.kind === "markdown" || data.kind === "json") && typeof data.text === "string";
        let body;
        if (canPreview && !raw && data.kind === "markdown") {
          body = react.createElement(ErrorBoundary, {
            resetKey: data.path,
            fallback: (err) => react.createElement("div", { className: "fv-note fv-error" },
              react.createElement("span", null, "渲染 Markdown 预览失败（" + (err && err.message ? err.message : "格式解析错误") + "）。"),
              react.createElement("button", {
                type: "button",
                className: "fv-button",
                onClick: () => setRaw(true),
              }, "切换到源码模式")
            ),
          }, react.createElement(MarkdownText, {
            text: data.text,
            labels: MARKDOWN_LABELS,
            codeLabels: MARKDOWN_CODE_LABELS,
          }));
        } else if (canPreview && !raw) {
          body = react.createElement(ErrorBoundary, {
            resetKey: data.path,
            fallback: () => react.createElement("div", { className: "fv-note fv-error" },
              react.createElement("span", null, "渲染 JSON 结构失败。"),
              react.createElement("button", {
                type: "button",
                className: "fv-button",
                onClick: () => setRaw(true),
              }, "切换到源码模式")
            ),
          }, jsonBodyOf(data.text));
        } else {
          body = react.createElement(ErrorBoundary, {
            resetKey: data.path + ":source",
            fallback: (err) => react.createElement("div", { className: "fv-note fv-error" },
              react.createElement("span", null, "查看源码失败（" + (err && err.message ? err.message : "未知错误") + "）。")),
          }, react.createElement(ReadBlock, {
            label: data.name,
            lines: data.lines,
            totalLines: data.totalLines,
            lang: data.lang,
            maxLines: data.lines.length,
            labels: READ_BLOCK_LABELS,
          }));
        }

        const pager = data.hasBefore || data.hasAfter
          ? react.createElement("div", { className: "fv-pager" },
            react.createElement("button", {
              type: "button", className: "fv-button", disabled: !data.hasBefore || state.status === "loading",
              onClick: () => setOffset(Math.max(1, data.offset - WINDOW_LINES)),
            }, "上一页"),
            react.createElement("button", {
              type: "button", className: "fv-button", disabled: !data.hasAfter || state.status === "loading",
              onClick: () => setOffset(data.end + 1),
            }, "下一页"),
            react.createElement("span", { className: "fv-pager-spacer" }),
            react.createElement("span", null, `第 ${data.offset}–${data.end} 行 / 共 ${data.totalLines} 行`))
          : null;

        const previewUnavailable = !canPreview && (data.kind === "markdown" || data.kind === "json");

        // Only the source view scrolls sideways; a rendered preview already
        // reflows, so the attribute is pointless there and would just confuse.
        const wrapping = wrap && (!canPreview || raw);
        return react.createElement(react.Fragment, null,
          react.createElement("div", { className: "fv-content", "data-wrap": wrapping ? "on" : "off" },
            previewUnavailable
              ? react.createElement("div", { className: "fv-note" },
                data.kind === "markdown" ? "文档过大，仅显示源码。" : "文件过大，仅显示源码。")
              : null,
            canPreview
              ? react.createElement("div", { className: "fv-sheet-tabs" },
                react.createElement("button", {
                  type: "button", className: "fv-tab", "aria-selected": raw ? "false" : "true", onClick: () => setRaw(false),
                }, data.kind === "markdown" ? "预览" : "结构"),
                react.createElement("button", {
                  type: "button", className: "fv-tab", "aria-selected": raw ? "true" : "false", onClick: () => setRaw(true),
                }, "源码"))
              : null,
            body),
          pager);
      }

      /** Render JSON as a tree, falling back to text when it does not parse. */
      function jsonBodyOf(text) {
        try {
          const parsed = JSON.parse(text);
          if (parsed !== null && typeof parsed === "object") {
            return react.createElement(JsonTree, { data: parsed, expandTopLevel: true, copyable: true, labels: JSON_TREE_LABELS });
          }
        } catch (error) {
          void error;
        }
        return react.createElement(MarkdownText, {
          text: "```json\n" + text + "\n```",
          labels: MARKDOWN_LABELS,
          codeLabels: MARKDOWN_CODE_LABELS,
        });
      }

      /** Pick the viewer for a file and keep unsupported formats useful. */
      function FileView({ meta, root, api, wrap }) {
        if (meta === null) {
          return react.createElement("div", { className: "fv-note" }, "从左侧选择一个文件。");
        }
        if (meta.tooLarge || meta.kind === "binary") {
          return react.createElement("div", { className: "fv-note" },
            react.createElement("strong", null, meta.name),
            react.createElement("span", null, meta.tooLarge
              ? `文件大小 ${formatBytes(meta.size)}，超过查看器上限 ${formatBytes(meta.limit)}。`
              : "这是二进制文件，查看器无法显示其内容。"),
            api && api.host
              ? react.createElement("button", {
                type: "button",
                className: "fv-button",
                onClick: () => api.host.openPath({ path: meta.displayPath }),
              }, "用本地程序打开")
              : null);
        }
        // The key remounts each viewer per file so no per-file state (paging,
        // active sheet, blob URL) survives a switch.
        const key = root + "\u0000" + meta.path;
        if (meta.kind === "image" || meta.kind === "pdf") return react.createElement(BinaryView, { key, meta, root });
        if (meta.kind === "sheet") {
          return react.createElement("div", { className: "fv-content" }, react.createElement(SheetView, { key, meta, root }));
        }
        if (meta.kind === "doc") {
          return react.createElement("div", { className: "fv-content" }, react.createElement(DocView, { key, meta, root }));
        }
        return react.createElement(TextView, { key, meta, root, wrap });
      }

      /** Right-click context menu for file and directory items. */
      function ContextMenu({ menu, rootPath, onClose, onMention, onToast }) {
        const ref = react.useRef(null);
        const mountTimeRef = react.useRef(Date.now());
        react.useEffect(() => {
          mountTimeRef.current = Date.now();
          const handlePointerDown = (e) => {
            if (Date.now() - mountTimeRef.current < 400) return;
            if (ref.current && !ref.current.contains(e.target)) onClose();
          };
          const handleKeyDown = (e) => {
            if (e.key === "Escape") onClose();
          };
          const handleWindowScroll = (e) => {
            if (Date.now() - mountTimeRef.current < 400) return;
            if (e.target === window || e.target === document || e.target === document.body) onClose();
          };
          window.addEventListener("pointerdown", handlePointerDown);
          window.addEventListener("keydown", handleKeyDown);
          window.addEventListener("scroll", handleWindowScroll);
          window.addEventListener("resize", onClose);
          return () => {
            window.removeEventListener("pointerdown", handlePointerDown);
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("scroll", handleWindowScroll);
            window.removeEventListener("resize", onClose);
          };
        }, [onClose]);

        if (!menu) return null;
        const { x, y, entry } = menu;
        const relPath = entry.displayPath || entry.path;
        const absPath = rootPath
          ? (rootPath.includes("\\")
            ? (rootPath.replace(/[\\/]+$/, "") + "\\" + relPath.replace(/\//g, "\\"))
            : (rootPath.replace(/[\\/]+$/, "") + "/" + relPath.replace(/\\/g, "/")))
          : relPath;

        const handleCopyRel = (e) => {
          e.stopPropagation();
          copyToClipboard(relPath).then((ok) => {
            if (onToast) onToast(ok ? "已复制相对路径" : "复制失败");
            onClose();
          });
        };

        const handleCopyAbs = (e) => {
          e.stopPropagation();
          copyToClipboard(absPath).then((ok) => {
            if (onToast) onToast(ok ? "已复制绝对路径" : "复制失败");
            onClose();
          });
        };

        const handleMention = (e) => {
          e.stopPropagation();
          if (onMention) onMention(entry);
          onClose();
        };

        const winW = typeof window !== "undefined" ? window.innerWidth : 1000;
        const winH = typeof window !== "undefined" ? window.innerHeight : 800;
        const top = Math.max(8, Math.min(y, winH - 140)) + "px";
        const left = Math.max(8, Math.min(x, winW - 190)) + "px";

        return react.createElement(react.Fragment, null,
          react.createElement("div", {
            className: "fv-context-backdrop",
            onClick: (e) => {
              e.stopPropagation();
              if (Date.now() - mountTimeRef.current < 400) return;
              onClose();
            },
            onContextMenu: (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (Date.now() - mountTimeRef.current < 400) return;
              onClose();
            },
          }),
          react.createElement("div", {
            ref,
            className: "fv-context-menu",
            style: { top, left },
            role: "menu",
            "aria-label": "文件操作",
            onContextMenu: (e) => e.preventDefault(),
          },
            react.createElement("button", {
              type: "button",
              className: "fv-context-item",
              role: "menuitem",
              onClick: handleCopyRel,
            },
              react.createElement("span", { className: "fv-context-item-icon", "aria-hidden": "true" }, "📋"),
              react.createElement("span", { className: "fv-context-item-label" }, "复制相对路径")),
            react.createElement("button", {
              type: "button",
              className: "fv-context-item",
              role: "menuitem",
              onClick: handleCopyAbs,
            },
              react.createElement("span", { className: "fv-context-item-icon", "aria-hidden": "true" }, "📁"),
              react.createElement("span", { className: "fv-context-item-label" }, "复制绝对路径")),
            react.createElement("div", { className: "fv-context-divider", "aria-hidden": "true" }),
            react.createElement("button", {
              type: "button",
              className: "fv-context-item",
              role: "menuitem",
              onClick: handleMention,
            },
              react.createElement("span", { className: "fv-context-item-icon", "aria-hidden": "true" }, "@"),
              react.createElement("span", { className: "fv-context-item-label" }, "引用到输入框 (@)"))));
      }

      /** Transient toast notification. */
      function ToastView({ toast }) {
        if (!toast) return null;
        return react.createElement("div", { className: "fv-toast", role: "status" }, toast);
      }

      /** The overlay page: root picker, breadcrumbs, tree and viewer. */
      function ViewerOverlay(props) {
        const request_ = useStore(openStore);
        const open = request_ !== null;
        // 抽屉挂载时刻：遮罩铺满全屏后，开启这次抽屉的那一次触摸的尾部事件
        // 会落在刚出现的遮罩上，若不设防会立刻自关（表现为“点了选项但抽屉没出来”）。
        const openedAtRef = react.useRef(0);
        react.useEffect(() => {
          if (open) openedAtRef.current = Date.now();
        }, [open]);
        const [roots, setRoots] = react.useState([]);
        const [root, setRoot] = react.useState("");
        // The tree is an expansion set plus a per-directory listing cache; a
        // directory is fetched the first time it opens and then remembered, so
        // collapsing and reopening costs nothing.
        const [expanded, setExpanded] = react.useState(() => new Set());
        const [nodes, setNodes] = react.useState(() => new Map());
        const [meta, setMeta] = react.useState(null);
        const [hidden, setHidden] = react.useState(false);
        const [treeWidth, setTreeWidth] = react.useState(readTreeWidth);
        const [isResizing, setIsResizing] = react.useState(false);
        const resizeRef = react.useRef(null);
        const treeWidthRef = react.useRef(treeWidth);
        treeWidthRef.current = treeWidth;

        const onResizerPointerDown = (event) => {
          if (event.button !== 0 && event.button !== undefined) return;
          event.preventDefault();
          const startX = event.clientX;
          const startW = treeWidthRef.current;
          resizeRef.current = { startX, startW };
          setIsResizing(true);
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) {}
        };

        const onResizerPointerMove = (event) => {
          if (!resizeRef.current) return;
          const { startX, startW } = resizeRef.current;
          const delta = event.clientX - startX;
          const bodyEl = event.currentTarget.parentElement;
          const maxBound = bodyEl ? Math.max(MIN_TREE_WIDTH, bodyEl.clientWidth - 180) : MAX_TREE_WIDTH;
          const nextWidth = Math.round(Math.min(Math.min(MAX_TREE_WIDTH, maxBound), Math.max(MIN_TREE_WIDTH, startW + delta)));
          setTreeWidth(nextWidth);
        };

        const onResizerPointerUp = (event) => {
          if (!resizeRef.current) return;
          resizeRef.current = null;
          setIsResizing(false);
          try { event.currentTarget.releasePointerCapture(event.pointerId); } catch (_) {}
          writeTreeWidth(treeWidthRef.current);
        };

        const onResizerDoubleClick = () => {
          setTreeWidth(DEFAULT_TREE_WIDTH);
          writeTreeWidth(DEFAULT_TREE_WIDTH);
        };
        // Soft wrap for source views. Off by default: code is written with
        // meaningful line breaks and wrapping obscures them.
        const [wrap, setWrap] = react.useState(false);
        const [fullscreen, setFullscreen] = react.useState(false);
        const [contextMenu, setContextMenu] = react.useState(null);
        const [toast, setToast] = react.useState(null);
        const toastTimer = react.useRef(null);
        const showToast = react.useCallback((msg) => {
          setToast(msg);
          if (toastTimer.current) clearTimeout(toastTimer.current);
          toastTimer.current = setTimeout(() => setToast(null), 2000);
        }, []);
        // Subscribed so the drawer re-renders when the bridge appears and the
        // clean setDraft path takes over from the DOM fallback.
        useStore(composerStore);

        /**
         * Append a reference to the composer and close the drawer, so the draft
         * is visible and can be sent without a second gesture.
         */
        const mention = (entry) => {
          const shown = entry.displayPath === undefined ? entry.path : entry.displayPath;
          const target = composerStore.get();
          if (target !== null) {
            target.setDraft(appendMention(target.draft, shown));
            openStore.set(null);
            return;
          }
          // No bridge on this host, so read the current text off the element and
          // append to that instead of the snapshot the bridge would have carried.
          const doc = typeof document === "undefined" ? null : document;
          const area = doc && doc.querySelector("[data-composer-card] textarea, textarea");
          if (!writeDraftToDom(doc, appendMention(area ? area.value : "", shown))) return;
          openStore.set(null);
        };
        const [error, setError] = react.useState(null);
        const [pane, setPane] = react.useState("tree");
        // Directory to open on arrival, relative to the resolved root: the
        // session's working directory when it sits below the workspace root.
        const [reveal, setReveal] = react.useState("");
        const metaTicket = react.useRef(0);
        const treeGeneration = react.useRef(0);

        // Resolve the root set on every open. When the request came from a
        // conversation header or a file click, the host also reports which root
        // that session/file belongs to, the directory path to reveal, and any
        // file to automatically select and preview.
        react.useEffect(() => {
          if (request_ === null) return undefined;
          let live = true;
          const payload = {
            ...(request_.sessionId !== undefined ? { sessionId: request_.sessionId } : {}),
            ...(request_.filePath !== undefined ? { filePath: request_.filePath } : {}),
            ...(request_.path !== undefined ? { path: request_.path } : {}),
          };
          request("roots", payload)
            .then((value) => {
              if (!live) return;
              setRoots(value.roots || []);
              const resolvedRoot = value.root || (value.roots || [])[0]?.id || "";
              setRoot(resolvedRoot);
              setReveal(typeof value.reveal === "string" ? value.reveal : "");
              setError(null);
              if (typeof value.selectFile === "string" && value.selectFile !== "") {
                setPane("content");
                const ticket = ++metaTicket.current;
                request("meta", { root: resolvedRoot, path: value.selectFile }).then((metaVal) => {
                  if (metaTicket.current !== ticket) return;
                  setMeta(metaVal);
                }).catch(() => {});
              }
            }).catch((problem) => {
              if (live) setError(problem);
            });
          return () => { live = false; };
        }, [request_]);

        /**
         * Request one directory listing and file it into the node cache.
         *
         * Deliberately not an effect: an effect that writes `nodes` while also
         * depending on it re-runs itself, and its cleanup then cancels the very
         * request it just issued, leaving the tree on "loading" forever. Loads
         * are triggered explicitly instead, and staleness is judged by a
         * generation token bumped on every root or filter change.
         */
        const loadDirectory = (dirPath) => {
          const generation = treeGeneration.current;
          setNodes((current) => new Map(current).set(dirPath, { status: "loading" }));
          request("list", { root, path: dirPath, hidden }).then((value) => {
            if (treeGeneration.current !== generation) return;
            setNodes((current) => new Map(current).set(dirPath, { status: "ready", entries: value.entries || [] }));
            if (dirPath === "") setError(null);
          }).catch((problem) => {
            if (treeGeneration.current !== generation) return;
            setNodes((current) => new Map(current).set(dirPath, { status: "error", error: problem }));
            if (dirPath === "") setError(problem);
          });
        };

        // A new root or filter invalidates every cached listing; the bumped
        // generation makes any in-flight response from the old tree stale.
        // When the host named a directory to reveal, its whole ancestor chain
        // opens at once so the session's project is visible on arrival.
        react.useEffect(() => {
          if (!open || root === "") return;
          treeGeneration.current += 1;
          setNodes(new Map());
          setMeta(null);
          const chain = reveal === "" ? [] : [...ancestorsOf(reveal), reveal];
          setExpanded(new Set(chain));
          for (const dirPath of ["", ...chain]) loadDirectory(dirPath);
        }, [open, root, hidden, reveal]);

        react.useEffect(() => {
          if (!open) return undefined;
          const onKeyDown = (event) => {
            if (event.key === "Escape") openStore.set(null);
          };
          document.addEventListener("keydown", onKeyDown);
          return () => document.removeEventListener("keydown", onKeyDown);
        }, [open]);

        // A phone has no Escape key, and beside a full-screen drawer there is no
        // scrim left to tap, so the back gesture has to close it. Without a
        // history entry of our own that gesture leaves the app entirely.
        react.useEffect(() => {
          if (!open) return undefined;
          window.history.pushState({ fileViewer: true }, "");
          // 忽略开启手势尾部引发的 popstate：移动端在同一次触摸里把刚压入的
          // 历史项判成可回退时，抽屉会在渲染出来之前就被关掉（表现为“点了选项
          // 面板消失、没有任何其它反应”）。
          const onPopState = () => {
            if (Date.now() - openedAtRef.current < 400) return;
            openStore.set(null);
          };
          window.addEventListener("popstate", onPopState);
          return () => {
            window.removeEventListener("popstate", onPopState);
            // Drop our entry when the drawer was closed some other way, or the
            // next back press would be spent undoing it and appear to do nothing.
            const state = window.history.state;
            if (state !== null && state !== undefined && state.fileViewer === true) window.history.back();
          };
        }, [open]);

        // Re-checked on every open, not just at startup: the stylesheet outlives
        // this module across a client reload, and a stale sheet renders the
        // drawer with old rules while the script is current.
        react.useEffect(() => {
          if (!open) return;
          ensureStyles(typeof document === "undefined" ? null : document);
        }, [open]);

        if (!open) return null;

        // Expanding fetches the listing the first time only; collapsing keeps
        // the cache so reopening is instant.
        const toggleDirectory = (dirPath) => {
          const isOpen = expanded.has(dirPath);
          setExpanded((current) => {
            const next = new Set(current);
            if (isOpen) next.delete(dirPath);
            else next.add(dirPath);
            return next;
          });
          if (!isOpen && !nodes.has(dirPath)) loadDirectory(dirPath);
        };

        // Re-read every directory the reader currently has open, keeping the
        // tree's shape.
        const refresh = () => {
          treeGeneration.current += 1;
          setNodes(new Map());
          for (const dirPath of ["", ...expanded]) loadDirectory(dirPath);
        };

        // Clicking two files quickly must not let the slower answer win: only
        // the newest request may write state.
        const selectFile = (entry) => {
          setPane("content");
          const ticket = metaTicket.current + 1;
          metaTicket.current = ticket;
          request("meta", { root, path: entry.path }).then((value) => {
            if (metaTicket.current !== ticket) return;
            setMeta(value);
            setError(null);
          }).catch((problem) => {
            if (metaTicket.current !== ticket) return;
            setMeta(null);
            setError(problem);
          });
        };

        const activeRoot = roots.find((row) => row.id === root);
        const treeRows = flattenTree({ expanded, nodes });

        return react.createElement("div", {
          className: "fv-scrim",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": "文件查看器",
          onMouseDown: (event) => {
            if (event.target !== event.currentTarget) return;
            if (Date.now() - openedAtRef.current < 400) return;
            openStore.set(null);
          },
        },
          react.createElement("div", { className: "fv-shell", "data-fullscreen": fullscreen ? "true" : "false" },
            react.createElement("div", { className: "fv-head" },
              react.createElement("span", { className: "fv-title" }, "文件"),
              roots.length > 1
                ? react.createElement("select", {
                  className: "fv-root-select",
                  value: root,
                  "aria-label": "工作区",
                  onChange: (event) => setRoot(event.target.value),
                }, ...roots.map((row) => react.createElement("option", { key: row.id, value: row.id }, row.label)))
                : react.createElement("span", { className: "fv-crumbs" }, activeRoot ? activeRoot.label : ""),
              // The tree shows structure, so the header carries the selected
              // file's path instead of navigable breadcrumbs.
              react.createElement("div", { className: "fv-crumbs fv-file-path", title: meta === null ? "" : meta.path },
                meta === null ? "" : meta.path),
              // Only offered where it changes anything: images, PDFs, sheets and
              // documents do not scroll sideways the way source lines do.
              meta !== null && !meta.tooLarge && (meta.kind === "text" || meta.kind === "markdown" || meta.kind === "json")
                ? react.createElement("button", {
                  type: "button",
                  className: "fv-icon-button",
                  "aria-pressed": wrap ? "true" : "false",
                  "aria-label": wrap ? "取消自动换行" : "自动换行",
                  title: wrap ? "取消自动换行" : "自动换行",
                  onClick: () => setWrap((current) => !current),
                }, react.createElement("span", { className: "fv-wrap-glyph", "aria-hidden": "true" }, "↩"))
                : null,
              react.createElement("button", {
                type: "button", className: "fv-icon-button", "aria-label": "刷新", title: "刷新", onClick: refresh,
              }, react.createElement("span", { "aria-hidden": "true" }, "\u21BB")),
              react.createElement("button", {
                type: "button",
                className: "fv-icon-button",
                "aria-pressed": hidden ? "true" : "false",
                title: hidden ? "隐藏点文件" : "显示点文件",
                onClick: () => setHidden((current) => !current),
              }, react.createElement("span", { "aria-hidden": "true" }, "\u00B7*")),
              react.createElement("button", {
                type: "button",
                className: "fv-icon-button fv-btn-fullscreen",
                "aria-pressed": fullscreen ? "true" : "false",
                "aria-label": fullscreen ? "退出全屏" : "全屏",
                title: fullscreen ? "退出全屏" : "全屏",
                onClick: () => setFullscreen((current) => !current),
              }, fullscreen
                ? (typeof IconFullscreenExitOutline16 === "function" ? react.createElement(IconFullscreenExitOutline16, { size: 16 }) : react.createElement("span", { "aria-hidden": "true" }, "\u2922"))
                : (IconFullscreenOutline16 ? react.createElement(IconFullscreenOutline16, { size: 16 }) : react.createElement("span", { "aria-hidden": "true" }, "\u26F6"))),
              react.createElement("button", {
                type: "button", className: "fv-icon-button", "aria-label": "关闭", onClick: () => openStore.set(null),
              }, IconCloseOutline16
                ? react.createElement(IconCloseOutline16, { size: 16 })
                : react.createElement("span", { "aria-hidden": "true" }, "\u2715"))),
            react.createElement("div", { className: "fv-body", "data-pane": pane, "data-resizing": isResizing ? "true" : "false" },
              react.createElement(Tree, {
                rows: treeRows,
                selected: meta === null ? "" : meta.path,
                onToggle: toggleDirectory,
                onSelect: selectFile,
                // Always offered: the DOM fallback covers hosts that leave the
                // bridge without input props, where gating on the store made the
                // button vanish with no way to reach it.
                onMention: mention,
                onContextMenu: (ctx) => setContextMenu(ctx),
                width: treeWidth,
              }),
              react.createElement("div", {
                className: "fv-resizer",
                role: "separator",
                "aria-orientation": "vertical",
                "aria-valuenow": treeWidth,
                "aria-valuemin": MIN_TREE_WIDTH,
                "aria-valuemax": MAX_TREE_WIDTH,
                "aria-label": "调整目录宽度",
                title: "拖动调整目录宽度，双击恢复默认",
                "data-dragging": isResizing ? "true" : "false",
                onPointerDown: onResizerPointerDown,
                onPointerMove: onResizerPointerMove,
                onPointerUp: onResizerPointerUp,
                onPointerCancel: onResizerPointerUp,
                onDoubleClick: onResizerDoubleClick,
              }),
              react.createElement("div", { className: "fv-main" },
                react.createElement("div", { className: "fv-main-head" },
                  react.createElement("button", {
                    type: "button", className: "fv-icon-button", "aria-label": "返回文件列表", onClick: () => setPane("tree"),
                  }, react.createElement("span", { "aria-hidden": "true" }, "‹")),
                  react.createElement("span", { className: "fv-main-name" }, meta === null ? "未选择文件" : meta.name),
                  meta !== null && typeof meta.size === "number"
                    ? react.createElement("span", null, formatBytes(meta.size))
                    : null),
                error !== null && meta === null
                  ? react.createElement("div", { className: "fv-note fv-error" }, messageOf(error))
                  : react.createElement(ErrorBoundary, {
                    resetKey: meta ? meta.path : "",
                  }, react.createElement(FileView, { meta, root, api: props.api, wrap })))),
            contextMenu !== null
              ? react.createElement(ContextMenu, {
                menu: contextMenu,
                rootPath: activeRoot ? (activeRoot.path || activeRoot.id) : root,
                onClose: () => setContextMenu(null),
                onMention: mention,
                onToast: showToast,
              })
              : null,
            toast !== null ? react.createElement(ToastView, { toast }) : null));
      }

      /**
       * Conversation header entry. Session-scoped, so it can name the session
       * and have the host open the viewer on that session's project directory.
       */
      /**
       * Conversation header entry, session-scoped so the host can open the
       * viewer on that session's project directory. SessionReporter publishes
       * the id separately, since this header is absent in an empty session.
       */
      function ViewerHeaderAction(props) {
        const sessionId = props === undefined ? undefined : props.sessionId;
        return react.createElement("button", {
          type: "button",
          className: "fv-icon-button",
          title: "查看项目文件",
          "aria-label": "查看项目文件",
          onClick: () => openStore.set(openStore.get() === null ? { sessionId } : null),
        }, FolderIcon === null
          ? react.createElement("span", { "aria-hidden": "true" }, "\u{1F4C1}")
          : react.createElement(FolderIcon, { size: 16 }));
      }

      /**
       * Reports the active session without drawing anything. The header entry
       * used to be the only reporter, but an empty session renders no header at
       * all — the host omits it along with every plugin registered there — so
       * the phone entry had nothing to work from and stayed hidden.
       */
      function SessionReporter(props) {
        const sessionId = props === undefined ? undefined : props.sessionId;
        react.useEffect(() => {
          sessionStore.set(sessionId);
          return () => { if (sessionStore.get() === sessionId) sessionStore.set(undefined); };
        }, [sessionId]);
        return null;
      }

      /**
       * Publishes the composer's draft accessors without drawing anything. Only
       * a component seated on the composer receives them, and the drawer that
       * needs them renders in a different subtree.
       */
      function ComposerBridge(props) {
        // The draft text lives on the input state snapshot; writing it back is a
        // separate action object. Neither is reachable from the drawer's subtree.
        const draft = props && props.input ? props.input.draft : undefined;
        const setDraft = props && props.inputActions ? props.inputActions.setDraft : undefined;
        react.useEffect(() => {
          if (typeof setDraft !== "function") return undefined;
          composerStore.set({ draft: typeof draft === "string" ? draft : "", setDraft });
          return () => { composerStore.set(null); };
        }, [draft, setDraft]);
        return null;
      }

      /**
       * Phone entry, rendered from the overlay seat because that one is not
       * inside the header the narrow layout hides. CSS shows it only below the
       * same breakpoint, so it never doubles up with the header button.
       */
      function ViewerFloatingAction() {
        const sessionId = useStore(sessionStore);
        const isOpen = useStore(openStore) !== null;
        // Restored from storage on the first render so the button does not visibly
        // jump from the default corner to where it was left.
        const [placement, setPlacement] = react.useState(readEntryPosition);
        const node = react.useRef(null);
        const drag = react.useRef(null);
        // Survives from the release to the click the browser fires straight after,
        // which is the only way to tell that click apart from a real tap.
        const dragged = react.useRef(false);

        // Applied as custom properties instead of inline right/bottom so the
        // stylesheet keeps ownership of the default corner and the safe-area maths.
        react.useEffect(() => {
          const element = node.current;
          if (!element) return;
          const style = element.style;
          if (placement === null) {
            style.removeProperty("--fv-entry-left");
            style.removeProperty("--fv-entry-right");
            style.removeProperty("--fv-entry-bottom");
            return;
          }
          const edge = `${Math.round(placement.offset ?? 14)}px`;
          style.setProperty("--fv-entry-left", placement.side === "left" ? edge : "auto");
          style.setProperty("--fv-entry-right", placement.side === "left" ? "auto" : edge);
          style.setProperty("--fv-entry-bottom", `${Math.round(placement.bottom)}px`);
        }, [placement]);

        const insets = (element) => {
          const view = element.ownerDocument?.defaultView;
          if (!view) return { top: 0, bottom: 0, left: 0, right: 0 };
          const root = view.getComputedStyle(element.ownerDocument.documentElement);
          const read = (name) => Number.parseFloat(root.getPropertyValue(name)) || 0;
          // The mobile bar occupies the top inset plus its own 52px, and the
          // keyboard inset lifts the floor while the composer is focused.
          return {
            top: read("--dsh-sat") + 52,
            bottom: read("--dsh-sab") + read("--dsh-keyboard-inset"),
            left: read("--dsh-sal"),
            right: read("--dsh-sar"),
          };
        };

        const onPointerDown = (event) => {
          // Secondary touches during a pinch must not hijack an active drag.
          if (event.isPrimary === false || event.button > 0) return;
          const element = event.currentTarget;
          const box = element.getBoundingClientRect();
          // Cleared here rather than in the click handler: a touch drag does not
          // reliably emit a click, and a flag left armed swallowed the next
          // genuine tap instead of the release that set it.
          dragged.current = false;
          drag.current = {
            id: event.pointerId,
            grabX: event.clientX - box.left,
            grabY: event.clientY - box.top,
            startX: event.clientX,
            startY: event.clientY,
            moved: false,
          };
          // Capture keeps the move and release events coming once the finger
          // leaves the button, which it does almost immediately when dragging.
          try { element.setPointerCapture(event.pointerId); } catch { /* capture is best effort */ }
        };

        const onPointerMove = (event) => {
          const state = drag.current;
          if (state === null || state.id !== event.pointerId) return;
          if (!state.moved) {
            const travelled = Math.abs(event.clientX - state.startX) + Math.abs(event.clientY - state.startY);
            if (travelled < DRAG_SLOP) return;
            state.moved = true;
            event.currentTarget.setAttribute("data-dragging", "true");
          }
          // Positioned live off the left edge so the button tracks the finger;
          // the right/bottom pair is restored when it settles.
          const element = event.currentTarget;
          const style = element.style;
          style.setProperty("--fv-entry-left", `${Math.round(event.clientX - state.grabX)}px`);
          style.setProperty("--fv-entry-right", "auto");
          const view = element.ownerDocument?.defaultView;
          const height = view?.visualViewport?.height ?? view?.innerHeight ?? 0;
          style.setProperty("--fv-entry-bottom", `${Math.round(height - (event.clientY - state.grabY) - element.offsetHeight)}px`);
        };

        const finishDrag = (event) => {
          const state = drag.current;
          if (state === null || state.id !== event.pointerId) return;
          drag.current = null;
          const element = event.currentTarget;
          element.removeAttribute("data-dragging");
          try { element.releasePointerCapture(event.pointerId); } catch { /* already released */ }
          if (!state.moved) return;
          dragged.current = true;
          const view = element.ownerDocument?.defaultView;
          const settled = settleEntry({
            x: event.clientX - state.grabX,
            y: event.clientY - state.grabY,
            size: element.offsetWidth,
            width: view?.visualViewport?.width ?? view?.innerWidth ?? 0,
            height: view?.visualViewport?.height ?? view?.innerHeight ?? 0,
            safe: insets(element),
          });
          setPlacement(settled);
          writeEntryPosition({ side: settled.side, bottom: settled.bottom });
        };

        const onPointerCancel = (event) => {
          const state = drag.current;
          if (state === null || state.id !== event.pointerId) return;
          drag.current = null;
          const element = event.currentTarget;
          element.removeAttribute("data-dragging");
          try { element.releasePointerCapture(event.pointerId); } catch { /* already released */ }
          if (state.moved) dragged.current = true;
          // A cancelled gesture keeps the last committed position, so the live
          // properties written while moving have to be rolled back. A new object
          // is needed for the effect to re-run and rewrite them.
          setPlacement((current) => (current === null ? null : { ...current }));
          if (placement === null && state.moved) {
            const style = element.style;
            style.removeProperty("--fv-entry-left");
            style.removeProperty("--fv-entry-right");
            style.removeProperty("--fv-entry-bottom");
          }
        };

        // Not gated on knowing a session: the host falls back to the workspace
        // roots when none is given, and requiring one made the button depend on
        // a slot that is not always rendered — an empty session drops the
        // conversation header, and the button vanished with it.
        if (isOpen) return null;
        return react.createElement("button", {
          type: "button",
          ref: node,
          className: "fv-float-entry",
          title: "查看项目文件（可拖动）",
          "aria-label": "查看项目文件",
          onPointerDown,
          onPointerMove,
          onPointerUp: finishDrag,
          onPointerCancel,
          // A release that ended a drag still fires a click, which would open the
          // drawer the user was only repositioning.
          onClick: () => {
            if (dragged.current) return;
            openStore.set({ sessionId });
          },
        }, FolderIcon === null
          ? react.createElement("span", { "aria-hidden": "true" }, "\u{1F4C1}")
          : react.createElement(FolderIcon, { size: 20 }));
      }

      // The overlay seat carries both the drawer and the phone entry: it sits
      // outside the session header, which the narrow layout hides wholesale.
      function ViewerSurfaces(props) {
        return react.createElement(react.Fragment, null,
          react.createElement(ViewerOverlay, props),
          react.createElement(ViewerFloatingAction, null));
      }

      ctx.slots.inject(OVERLAY_SLOT, () => ctx.slots.register({
        name: OVERLAY_SLOT,
        id: "file-viewer",
        order: 30,
        inject: () => ({ api: ctx.connection.api }),
      }, ViewerSurfaces));

      ctx.slots.inject(COMPOSER_SLOT, () => ctx.slots.register({
        name: COMPOSER_SLOT,
        id: "file-viewer-composer",
        order: 0,
      }, ComposerBridge));

      ctx.slots.inject(SESSION_SLOT, () => ctx.slots.register({
        name: SESSION_SLOT,
        id: "file-viewer-session",
        order: 0,
      }, SessionReporter));

      // Ahead of the session-log download, which registers without an order
      // and so sorts at 0; the list is ordered ascending.
      ctx.slots.inject(HEADER_SLOT, () => ctx.slots.register({
        name: HEADER_SLOT,
        id: "file-viewer",
        order: -10,
      }, ViewerHeaderAction));

      // Global capture click listener catches file mentions before host handlers
      setupGlobalFileClickInterceptor(openStore, sessionStore);

      // Wrap legacy workspaces.openPath (workspaces is declared in inject)
      wrapWorkspaceOpenPath(ctx, openStore, sessionStore);

      if (typeof window !== "undefined") {
        const triggerOpen = (payload) => {
          const sid = (payload && payload.sessionId) || sessionStore.get();
          openStore.set({ ...(payload || {}), sessionId: sid, _t: Date.now() });
        };
        window.__dsh_open_file_viewer = triggerOpen;
        window.addEventListener("dsh:open-file-viewer", (e) => triggerOpen(e.detail));
      }

      return { openStore };
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.internals = {
      RPC_CHANNEL, OVERLAY_SLOT, HEADER_SLOT, SESSION_SLOT, COMPOSER_SLOT, STYLE_ID, WINDOW_LINES, css,
      ERROR_COPY, appendMention, baseNameOf, formatBytes, parentOf, ancestorsOf, flattenTree, columnLabel,
      mediaTypeOf, messageOf, createStore, createRequest, blobOf, ensureStyles,
      ENTRY_POSITION_KEY, DRAG_SLOP, settleEntry, readEntryPosition, writeEntryPosition,
      TREE_WIDTH_KEY, DEFAULT_TREE_WIDTH, MIN_TREE_WIDTH, MAX_TREE_WIDTH, readTreeWidth, writeTreeWidth,
      MARKDOWN_LABELS, MARKDOWN_CODE_LABELS, READ_BLOCK_LABELS, JSON_TREE_LABELS, ErrorBoundary,
      openViewerForPath, wrapWorkspaceOpenPath, setupGlobalFileClickInterceptor, extractClickedPath, normalizeClickedPath, looksLikeFilePath,
    };
    return module.exports;
  }
});
