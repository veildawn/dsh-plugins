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
  id: "@weniatall/dsh-file-viewer",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    function DefaultFolderIcon({ size = 16, className }) {
      return react.createElement("svg", {
        width: size, height: size, className, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true"
      },
        react.createElement("path", {
          d: "M1.5 3.5C1.5 2.67157 2.17157 2 3 2H6.08579C6.4836 2 6.86508 2.15804 7.14645 2.43934L8.70711 4H13C13.8284 4 14.5 4.67157 14.5 5.5V12.5C14.5 13.3284 13.8284 14 13 14H3C2.17157 14 1.5 13.3284 1.5 12.5V3.5Z",
          fill: "currentColor"
        })
      );
    }
    const { ReadBlock, MarkdownText, JsonTree, DiffBlock, writeClipboard } = primitives;
    const IconFolderOpen16 = primitives.IconFolderOpen16 || primitives.IconFolderOpenRegular || primitives.IconFolderOpenMedium || DefaultFolderIcon;
    const IconFolderOutline16 = primitives.IconFolderOutline16 || primitives.IconFolderOpenOutlineRegular || DefaultFolderIcon;
    const IconCloseOutline16 = primitives.IconCloseOutline16 || primitives.IconCloseOutlineRegular;
    const IconFullscreenOutline16 = primitives.IconFullscreenOutline16 || primitives.IconFullscreenOutlineRegular;
    const IconRefreshOutline16 = primitives.IconRefreshOutline16 || primitives.IconRefreshOutlineRegular;

    // 统一风格的矢量线性图标 (16x16, 统一 currentColor 与线条粗细)
    function SvgIconWrap({ size = 15 }) {
      return react.createElement("svg", {
        width: size, height: size, viewBox: "0 0 16 16", fill: "none",
        stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round"
      },
        react.createElement("path", { d: "M2.5 4h11" }),
        react.createElement("path", { d: "M2.5 8h7.5a2.5 2.5 0 0 1 2.5 2.5v0a2.5 2.5 0 0 1-2.5 2.5H5" }),
        react.createElement("path", { d: "M7 10.5L4.5 13 7 15.5" })
      );
    }

    /** Outline / table-of-contents glyph: short bars stepping in by level. */
    function SvgIconOutline({ size = 15 }) {
      return react.createElement("svg", {
        width: size, height: size, viewBox: "0 0 16 16", fill: "none",
        stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round"
      },
        react.createElement("path", { d: "M2.5 3.5h11" }),
        react.createElement("path", { d: "M2.5 7h7.5" }),
        react.createElement("path", { d: "M2.5 10.5h9" }),
        react.createElement("path", { d: "M2.5 14h5.5" })
      );
    }

    function SvgIconRefresh({ size = 15 }) {
      return react.createElement("svg", {
        width: size, height: size, viewBox: "0 0 16 16", fill: "none",
        stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round"
      },
        react.createElement("path", { d: "M13.5 8A5.5 5.5 0 1 1 12 4.1L13.8 2.5" }),
        react.createElement("path", { d: "M10 2.5h3.8V6.3" })
      );
    }

    function SvgIconDotfiles({ size = 15 }) {
      return react.createElement("svg", {
        width: size, height: size, viewBox: "0 0 16 16", fill: "none",
        stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round"
      },
        react.createElement("circle", { cx: "4", cy: "8", r: "1.5", fill: "currentColor", stroke: "none" }),
        react.createElement("path", { d: "M10.5 5.5v5" }),
        react.createElement("path", { d: "M8.3 6.8l4.4 2.4" }),
        react.createElement("path", { d: "M8.3 9.2l4.4-2.4" })
      );
    }

    function SvgIconShield({ size = 15 }) {
      return react.createElement("svg", {
        width: size, height: size, viewBox: "0 0 16 16", fill: "none",
        stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round"
      },
        react.createElement("path", { d: "M8 1.8L2.5 4.2v4c0 3.3 2.3 5.8 5.5 6.8 3.2-1 5.5-3.5 5.5-6.8v-4L8 1.8z" }),
        react.createElement("path", { d: "M6 7.8l1.5 1.5L10.5 6" })
      );
    }

    function SvgIconFullscreen({ size = 15, exit = false }) {
      return react.createElement("svg", {
        width: size, height: size, viewBox: "0 0 16 16", fill: "none",
        stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round"
      },
        exit
          ? react.createElement(react.Fragment, null,
              react.createElement("path", { d: "M5.5 2v3.5H2" }),
              react.createElement("path", { d: "M10.5 2v3.5H14" }),
              react.createElement("path", { d: "M10.5 14v-3.5H14" }),
              react.createElement("path", { d: "M5.5 14v-3.5H2" }))
          : react.createElement(react.Fragment, null,
              react.createElement("path", { d: "M2.5 5.5V2.5H5.5" }),
              react.createElement("path", { d: "M10.5 2.5h3v3" }),
              react.createElement("path", { d: "M13.5 10.5v3h-3" }),
              react.createElement("path", { d: "M5.5 13.5h-3v-3" }))
      );
    }

    function SvgIconClose({ size = 15 }) {
      return react.createElement("svg", {
        width: size, height: size, viewBox: "0 0 16 16", fill: "none",
        stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round"
      },
        react.createElement("path", { d: "M3.5 3.5l9 9" }),
        react.createElement("path", { d: "M12.5 3.5l-9 9" })
      );
    }

    /** Source-control entry marker: a branch with two commits. */
    function SvgIconBranch({ size = 15 }) {
      return react.createElement("svg", {
        width: size, height: size, viewBox: "0 0 16 16", fill: "none",
        stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round"
      },
        react.createElement("circle", { cx: "4.5", cy: "3.5", r: "1.6" }),
        react.createElement("circle", { cx: "4.5", cy: "12.5", r: "1.6" }),
        react.createElement("circle", { cx: "11.5", cy: "6.5", r: "1.6" }),
        react.createElement("path", { d: "M4.5 5.1v5.8" }),
        react.createElement("path", { d: "M11.5 8.1c0 2-2.4 2.6-4.6 3.2" })
      );
    }

    /** One commit in the history list. */
    function SvgIconCommit({ size = 15 }) {
      return react.createElement("svg", {
        width: size, height: size, viewBox: "0 0 16 16", fill: "none",
        stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round"
      },
        react.createElement("circle", { cx: "8", cy: "8", r: "2.4" }),
        react.createElement("path", { d: "M1.5 8h4.1" }),
        react.createElement("path", { d: "M10.4 8h4.1" })
      );
    }

    function SvgIconDownload({ size = 15 }) {
      return react.createElement("svg", {
        width: size, height: size, viewBox: "0 0 16 16", fill: "none",
        stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round"
      },
        react.createElement("path", { d: "M8 2.5v7.5" }),
        react.createElement("path", { d: "M4.5 7L8 10.5 11.5 7" }),
        react.createElement("path", { d: "M2.5 13.5h11" })
      );
    }

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
    const READ_BLOCK_LABELS = new Proxy({
      copy: "复制",
      copied: "已复制",
      window: (shown, total) => `第 ${shown} / ${total} 行`,
      collapse: "收起",
      expand: (hidden) => `展开其余 ${hidden} 行`,
      collapseAria: "收起隐藏行",
      expandAria: (hidden) => `展开其余 ${hidden} 行`,
    }, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop === "string" && (prop === "window" || prop === "expand" || prop.endsWith("Aria"))) {
          return (...args) => String(args[0] ?? "");
        }
        return "复制";
      }
    });
    const JSON_TREE_LABELS = new Proxy({
      copy: "复制",
      copied: "已复制",
      copyFailed: "复制失败",
      copyValue: "复制值",
      copyJson: "复制 JSON",
      copyPrettyJson: "复制格式化 JSON",
      copyCompactJson: "复制紧凑 JSON",
      copyPath: "复制属性路径",
      collapseNode: "折叠节点",
      expandNode: "展开节点",
      copyButtonTitle: (action) => (action ? `复制选项：${action}` : "复制选项"),
    }, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop === "string" && prop.endsWith("Title")) {
          return (action) => (action ? `复制选项：${action}` : "复制选项");
        }
        return "复制";
      }
    });

    const DIFF_BLOCK_LABELS = new Proxy({
      copy: "复制",
      copied: "已复制",
      files: (count) => `${count} 个文件`,
      expand: (hidden) => `展开其余 ${hidden} 行`,
      collapse: "收起",
      expandAria: (hidden) => `展开其余 ${hidden} 行`,
      collapseAria: "收起隐藏行",
    }, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop === "string" && (prop === "files" || prop === "expand" || prop.endsWith("Aria"))) {
          return (...args) => String(args[0] ?? "");
        }
        return "复制";
      }
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
    /**
     * The id both context menus carry.
     *
     * It exists purely so the stylesheet can win against a theme's glass rule.
     * The glass theme paints `[role="menu"]` with a translucent background and
     * a large backdrop blur; its selector is long enough (a :is() chain plus
     * :not()) that no class-based override beats it, and it loads after this
     * bundle. An id selector outranks any combination of classes and
     * attributes, so the fix does not depend on sheet order. Only one menu is
     * mounted at a time, so sharing the id is safe.
     */
    const CONTEXT_MENU_ID = "dsh-fv-context-menu";
    // Per-browser UI state, so it lives in localStorage rather than plugin
    // settings; the key follows the `<plugin>.<setting>` form used elsewhere.
    const ENTRY_POSITION_KEY = "dsh-file-viewer.entry-position";
    const TREE_WIDTH_KEY = "dsh-file-viewer.tree-width";
    // The drawer's own width, set by dragging its left edge. Stored separately
    // from the tree width: they answer different questions ("how wide is the
    // sidebar" vs "how wide is the whole panel"), and dragging one must not
    // move the other.
    const SHELL_WIDTH_KEY = "dsh-file-viewer.shell-width";
    // Per-file language overrides, keyed by the file's path within its root.
    // Per-file rather than per-extension because the user chose this file, and
    // a whole suffix could be shared by files that genuinely differ.
    const LANG_OVERRIDES_KEY = "dsh-file-viewer.lang-overrides";
    /** Overrides past this are dropped oldest-first, so storage cannot grow without bound. */
    const LANG_OVERRIDES_MAX = 200;
    const DEFAULT_TREE_WIDTH = 280;
    const MIN_TREE_WIDTH = 160;
    const MAX_TREE_WIDTH = 700;
    /**
     * Smallest width the drawer may be dragged to.
     *
     * It has to hold the sidebar at its own minimum (160) plus enough of the
     * preview to be worth reading, otherwise a drag can squeeze the content
     * pane into a sliver that cannot be widened again by its own handle.
     */
    const MIN_SHELL_WIDTH = 420;
    // Below this much travel a press is a tap. Large enough to absorb the slip of
    // a finger on a touch target, small enough that a deliberate drag registers.
    const DRAG_SLOP = 8;
    const WINDOW_LINES = 500;
    const inject = ["slots", "connection", "workspaces"];

    const css = `
      /* ---------------------------------------------------------------------
         Opt out of the "every modal becomes a centred card" treatment.

         The host mounts overlay seats inside a plain div[role="presentation"],
         and dsh-mobile-adapter turns that container into a full-screen
         rgba(0,0,0,.5) + blur(4px) scrim whenever it CONTAINS a
         [role="dialog"][aria-modal="true"] — and shrinks the dialog itself to a
         420px centred card. That is right for a small confirm dialog and wrong
         for this drawer: the viewer is a full-height panel pinned to the right
         edge, and being treated as a card blacked out the app behind it (read
         by the user as "the right-click menu has an opaque mask") and fought
         the drawer's own width.

         The adapter keys on containment (:has(...)), not on being the parent,
         so these overrides use the descendant form too: wherever the host nests
         this viewer, the same container is neutralised. Every rule is scoped to
         a container that actually holds .fv-scrim, so no other dialog on the
         page is affected. !important is required because the adapter's own
         declarations use it.
         --------------------------------------------------------------------- */
      body>div[role="presentation"]:has(.fv-scrim){background:transparent!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;padding:0!important;display:block!important;align-items:stretch!important;justify-content:flex-start!important}
      body>div[role="presentation"]:has(.fv-scrim)>[aria-hidden="true"]{display:none!important}
      .fv-scrim[role="dialog"]{position:absolute!important;inset:0!important;width:auto!important;max-width:none!important;max-height:none!important;min-height:0!important;margin:0!important;border:none!important;border-radius:0!important;box-shadow:none!important;background:transparent!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;overflow:visible!important}
      .fv-scrim{position:absolute;inset:0;z-index:40;display:flex;align-items:stretch;justify-content:flex-end;background:transparent;pointer-events:auto;animation:fv-fade .16s ease-out}
      .fv-shell{display:flex;flex-direction:column;width:min(64vw,1100px);min-width:0;min-height:0;overflow:hidden;border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff));box-shadow:var(--dsw-shadow-lv3);font-family:var(--dsw-font-family);color:var(--dsw-alias-label-primary);animation:fv-slide .2s cubic-bezier(.2,.8,.2,1);transition:width .2s cubic-bezier(.2,.8,.2,1)}
      .fv-shell[data-fullscreen="true"]{width:100vw;border-left:none}
      /* The leading edge is the drawer's own resize handle. It is positioned
         over the border rather than beside it so the panel does not shift when
         it appears, and it overhangs slightly on both sides to be easy to grab
         with a pointer or a finger. */
      .fv-shell{position:relative}
      .fv-edge{position:absolute;top:0;bottom:0;left:-4px;z-index:6;width:9px;cursor:col-resize;touch-action:none;background:transparent;transition:background-color .15s ease}
      .fv-edge::after{content:"";position:absolute;top:0;bottom:0;left:4px;width:1px;background:transparent;transition:background-color .15s ease}
      .fv-edge:hover,.fv-edge:focus-visible{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 18%,transparent)}
      .fv-edge:hover::after,.fv-edge:focus-visible::after{background:var(--dsw-alias-brand-primary,#4d6bfe)}
      .fv-edge[data-dragging="true"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 26%,transparent)}
      .fv-edge[data-dragging="true"]::after{background:var(--dsw-alias-brand-primary,#4d6bfe)}
      .fv-edge:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:-2px}
      /* While dragging, the width transition would lag the pointer by its own
         duration, so it is dropped for the duration of the gesture. */
      .fv-shell[data-edge-resizing="true"]{transition:none}
      .fv-shell[data-edge-resizing="true"] *{pointer-events:none!important;user-select:none}
      .fv-shell[data-edge-resizing="true"] .fv-edge{pointer-events:auto!important}
      /* Windows desktop paints the native caption buttons (minimize, maximize,
         close) in a strip across the top of the window, above every page layer.
         The shell's overlay seat spans the whole frame — padding box included —
         so a trailing-edge drawer would start underneath that strip and its
         header controls could never be clicked. Start the drawer below the
         strip instead, which also leaves the strip free to drag the window.
         The host sets data-fullscreen while the window is fullscreen and the
         strip is hidden, so the offset has to drop then. */
      html[data-windows-titlebar]:not([data-fullscreen]) .fv-scrim{top:var(--dsh-windows-titlebar-height,40px)}
      @keyframes fv-fade{from{opacity:0}to{opacity:1}}
      @keyframes fv-slide{from{transform:translateX(100%)}to{transform:translateX(0)}}
      @media(prefers-reduced-motion:reduce){.fv-scrim,.fv-shell{animation:none}}
      .fv-head{display:flex;flex:none;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
      .fv-title{flex:none;font:var(--dsw-font-base-strong-16,600 16px/24px var(--dsw-font-family));font-weight:600}
      .fv-root-select{max-width:280px;height:30px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none;background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
      .fv-crumbs{display:flex;flex:1 1 auto;min-width:0;align-items:center;gap:2px;overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:12px}
      .fv-crumb{max-width:220px;overflow:hidden;padding:2px 4px;border:none;border-radius:6px;background:none;color:inherit;font:inherit;white-space:nowrap;text-overflow:ellipsis;cursor:pointer}
      .fv-crumb:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .fv-crumb-sep{flex:none;opacity:.5}
      .fv-icon-button{display:inline-grid;flex:none;place-items:center;width:30px;height:30px;padding:0;border:none;border-radius:8px;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:color .12s,background .12s;line-height:1}
      /* A control with nowhere to go must look unavailable, not merely behave
         that way — otherwise a disabled back button reads as broken. */
      .fv-icon-button:disabled{opacity:.35;cursor:default}
      .fv-icon-button:disabled:hover{background:none;color:var(--dsw-alias-label-secondary)}
      .fv-icon-button svg{display:block;flex:none}
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
      .fv-row-name{flex:1 1 auto;min-width:0;line-height:1.35;word-break:break-all;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .fv-row-size{flex:none;color:var(--dsw-alias-label-caption);font-size:11px;font-variant-numeric:tabular-nums}
      .fv-glyph{flex:none;width:16px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:11px;transition:transform .12s}
      .fv-glyph-open{transform:rotate(90deg)}
      .fv-tree-status{padding:4px 8px;color:var(--dsw-alias-label-caption);font-size:12px;line-height:20px}
      .fv-main{display:flex;flex:1 1 auto;flex-direction:column;min-width:0;min-height:0}
      /* 主内容区的多标签栏：一行横向滚动，每个标签是一个带关闭按钮的按钮组。
         标签本身不是按钮里套按钮（HTML 不允许），所以外面是 div[role=tab]，
         内部的关闭与标题各是一个 button。 */
      .fv-tabs{display:flex;flex:none;align-items:stretch;gap:2px;padding:4px 6px 0;overflow-x:auto;overflow-y:hidden;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1,transparent);scrollbar-width:thin}
      .fv-tabs::-webkit-scrollbar{height:4px}
      .fv-tabs-empty{flex:1 1 auto;padding:4px 8px 6px;color:var(--dsw-alias-label-caption);font-size:12px;white-space:nowrap}
      .fv-tab-cell{display:inline-flex;flex:none;align-items:center;gap:2px;max-width:220px;min-width:0;height:30px;padding:0 2px 0 10px;border:1px solid transparent;border-bottom:none;border-radius:8px 8px 0 0;background:none;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent}
      .fv-tab-cell:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .fv-tab-cell[aria-selected="true"]{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary);font-weight:500}
      .fv-tab-cell[data-menu="true"]{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:-2px}
      .fv-tab-label{flex:0 1 auto;min-width:0;max-width:170px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;background:none;border:none;padding:0;color:inherit;font:inherit;cursor:pointer;text-align:left}
      .fv-tab-dir{flex:0 0 auto;color:var(--dsw-alias-label-caption);font-size:11px;max-width:96px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
      .fv-tab-close{flex:none;display:inline-grid;place-items:center;width:18px;height:18px;padding:0;border:none;border-radius:4px;background:none;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:14px;line-height:1;cursor:pointer}
      .fv-tab-close:hover{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-primary)}
      .fv-main-head{display:flex;flex:none;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:12px}
      .fv-main-name{flex:1 1 auto;min-width:0;overflow:hidden;color:var(--dsw-alias-label-primary);font-weight:500;white-space:nowrap;text-overflow:ellipsis}
      .fv-lang{display:inline-flex;flex:none;align-items:center;gap:4px;min-width:0}
      .fv-lang-hint{flex:none;color:var(--dsw-alias-label-caption);font-size:11px;white-space:nowrap}
      .fv-lang-select{box-sizing:border-box;max-width:132px;height:24px;padding:0 4px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:22px;cursor:pointer}
      .fv-lang-select:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3,var(--dsw-alias-border-l2))}
      .fv-lang-select:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:1px}
      .fv-content{flex:1 1 auto;min-height:0;overflow:auto;padding:12px;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;isolation:isolate}
      .fv-content>*{max-width:100%}
      /* The Markdown outline: a rail pinned to the reading area's trailing edge.
         The wrapper is the positioning context, so the rail stays put while the
         text inside .fv-content scrolls. */
      .fv-content-wrap{position:relative;flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
      .fv-content-wrap>.fv-content{flex:1 1 auto}
      .fv-outline{position:absolute;top:8px;right:8px;z-index:10;display:flex;flex-direction:column;align-items:flex-end;gap:6px;max-height:calc(100% - 16px);pointer-events:none}
      .fv-outline>*{pointer-events:auto}
      .fv-outline-toggle{display:inline-grid;place-items:center;width:28px;height:28px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff));box-shadow:var(--dsw-shadow-lv2,0 2px 8px rgba(0,0,0,.08));color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;transition:color .12s,background-color .12s}
      .fv-outline-toggle:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover))}
      .fv-outline[data-open="true"] .fv-outline-toggle{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-primary)}
      .fv-outline-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:1px}
      /* The panel scrolls on its own: a long document can have fifty headings,
         and the rail must never push past the reading area. */
      .fv-outline-panel{display:flex;flex-direction:column;min-height:0;max-height:min(60vh,420px);width:min(280px,52vw);padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff));box-shadow:var(--dsw-shadow-lv3);animation:fv-menu-in .12s cubic-bezier(.2,.8,.2,1)}
      .fv-outline-head{flex:none;padding:4px 8px 6px;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:4px;color:var(--dsw-alias-label-caption);font-size:11px;font-weight:600;letter-spacing:.02em}
      .fv-outline-list{display:flex;flex-direction:column;gap:1px;min-height:0;overflow-y:auto;overscroll-behavior:contain}
      .fv-outline-item{display:block;width:100%;padding:5px 8px;border:none;border-radius:6px;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1.4;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
      .fv-outline-item:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .fv-outline-item[aria-current="true"]{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-primary);font-weight:600}
      .fv-outline-item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:-2px}
      /* Indentation comes from the DOM order and the level, so a document that
         starts at level two is not silently pushed one level in. */
      .fv-outline-item[data-level="1"]{padding-left:20px}
      .fv-outline-item[data-level="2"]{padding-left:32px}
      .fv-outline-item[data-level="3"]{padding-left:44px}
      .fv-outline-item[data-level="4"]{padding-left:56px}
      .fv-outline-item[data-level="5"]{padding-left:68px}
      .fv-doc-article{max-width:880px;margin:0 auto;padding:12px 16px;line-height:1.8;font-size:14px;word-break:break-word}
      .fv-doc-article h1{font-size:22px;font-weight:700;margin:28px 0 16px;line-height:1.35;border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:8px}
      .fv-doc-article h2{font-size:18px;font-weight:600;margin:24px 0 12px;line-height:1.4;border-bottom:1px dashed var(--dsw-alias-border-l1);padding-bottom:6px}
      .fv-doc-article h3{font-size:16px;font-weight:600;margin:18px 0 8px;line-height:1.4}
      .fv-doc-article h4{font-size:14px;font-weight:600;margin:14px 0 6px}
      .fv-doc-article p{margin:12px 0;text-align:justify}
      .fv-doc-article ul,.fv-doc-article ol{padding-left:24px;margin:12px 0}
      .fv-doc-article li{margin:6px 0}
      .fv-doc-article table{width:100%;border-collapse:collapse;margin:16px 0;font-size:13px}
      .fv-doc-article th,.fv-doc-article td{border:1px solid var(--dsw-alias-border-l1);padding:8px 12px;text-align:left}
      .fv-doc-article th{background:var(--dsw-alias-surface-l2,rgba(0,0,0,.03));font-weight:600}
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
      .fv-image-viewer{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0;height:100%;overflow:hidden;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff))}
      .fv-image-toolbar{display:flex;align-items:center;gap:6px;padding:6px 12px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03));border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;font-size:12px;user-select:none;color:var(--dsw-alias-label-secondary)}
      .fv-image-btn{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:26px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;line-height:1;transition:background-color .1s;text-decoration:none}
      .fv-image-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .fv-image-scale-text{font-variant-numeric:tabular-nums;font-size:11px;min-width:38px;text-align:center;color:var(--dsw-alias-label-primary);font-weight:600}
      .fv-image-sep{width:1px;height:16px;background:var(--dsw-alias-border-l1);margin:0 2px}
      .fv-image-dims,.fv-image-size{font-size:11px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;margin-right:6px}
      .fv-image-canvas{position:relative;flex:1 1 auto;min-width:0;min-height:0;overflow:hidden;display:grid;place-items:center;cursor:grab;user-select:none;touch-action:none;background:repeating-conic-gradient(var(--dsw-alias-border-l1) 0% 25%,transparent 0% 50%) 50%/16px 16px}
      .fv-image-canvas.fv-image-dragging{cursor:grabbing}
      .fv-image-element{max-width:calc(100% - 32px);max-height:calc(100% - 32px);object-fit:contain;transition:transform .05s ease-out;pointer-events:none;box-shadow:var(--dsw-shadow-lv2,0 4px 12px rgba(0,0,0,.08))}
      .fv-frame{width:100%;height:100%;min-height:420px;border:none;background:var(--dsw-alias-bg-layer-1,#fff)}
      .fv-sheet-tabs{display:flex;flex-wrap:wrap;flex:none;align-items:center;gap:6px;padding:8px 12px;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff));border-bottom:1px solid var(--dsw-alias-border-l1);z-index:2}
      .fv-content .fv-sheet-tabs{position:sticky;top:0;margin:-12px -12px 10px;padding:12px 12px 8px}
      .fv-tab{height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:none;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}
      .fv-tab[aria-selected="true"]{border-color:transparent;background:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff)}
      .fv-tab-diff{display:inline-flex;align-items:center;gap:4px}
      .fv-diff-stat{font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;margin-left:2px}
      .fv-diff-add{color:var(--dsw-alias-state-success-primary,#10b981)}
      .fv-diff-del{color:var(--dsw-alias-state-error-primary,#ef4444)}
      .fv-tab[aria-selected="true"] .fv-diff-add,.fv-tab[aria-selected="true"] .fv-diff-del{color:var(--dsw-alias-label-primary-foreground,#fff)}
      .fv-diff-view{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base,#fff);overflow:hidden;font-family:var(--dsw-font-code,monospace);margin:4px 0}
      .fv-diff-toolbar{display:flex;align-items:center;padding:8px 12px;background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.02));border-bottom:1px solid var(--dsw-alias-border-l1);font-family:var(--dsw-font-family);font-size:12px}
      .fv-diff-source-tag{font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 12%,transparent);color:var(--dsw-alias-brand-primary,#4d6bfe)}
      .fv-diff-table{display:flex;flex-direction:column;overflow-x:auto;min-width:0;font-size:12px;line-height:20px;font-family:var(--dsw-font-code,monospace)}
      .fv-diff-line{display:flex;min-width:max-content;align-items:stretch;transition:background-color .08s}
      .fv-diff-num{flex:none;width:44px;padding:0 6px;text-align:right;user-select:none;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-caption);opacity:.65;font-size:11px}
      .fv-diff-num-new{border-right:1px solid var(--dsw-alias-border-l1)}
      .fv-diff-sign{flex:none;width:20px;text-align:center;user-select:none;font-weight:600}
      .fv-diff-text{flex:1 1 auto;white-space:pre;padding-right:16px;min-width:0}
      .fv-diff-table[data-wrap="on"] .fv-diff-text{white-space:pre-wrap;word-break:break-all}
      .fv-diff-hunk{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 8%,transparent);color:var(--dsw-alias-label-secondary);font-style:italic}
      .fv-diff-hunk-gutter{color:var(--dsw-alias-brand-primary,#4d6bfe);opacity:.6}
      .fv-diff-add-line{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#10b981) 14%,transparent)}
      .fv-diff-add-line .fv-diff-sign{color:var(--dsw-alias-state-success-primary,#10b981)}
      .fv-diff-del-line{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 14%,transparent)}
      .fv-diff-del-line .fv-diff-sign{color:var(--dsw-alias-state-error-primary,#ef4444)}
      .fv-diff-ctx-line:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .fv-badge{display:inline-block;padding:0 4px;font-size:10px;font-weight:600;line-height:14px;border-radius:4px;margin-left:4px;flex:none}
      .fv-badge-mod{background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d97706) 18%,transparent);color:var(--dsw-alias-state-warning-primary,#d97706)}
      .fv-badge-add{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#10b981) 18%,transparent);color:var(--dsw-alias-state-success-primary,#10b981)}
      /* --- Git panel -------------------------------------------------------
         Modelled on VSCode's source-control view: a two-tab sidebar (files /
         Git), then repository, branch, paged history, and — in the main pane —
         the files of the selected commit. The sidebar keeps the tree's own
         container class so every existing mobile rule (full width, pane swap,
         no resizer) applies to it unchanged. */
      .fv-side-tabs{position:sticky;top:0;z-index:2;display:flex;flex:none;gap:2px;padding:2px;margin:-6px -6px 4px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff))}
      .fv-side-tab{display:inline-flex;flex:1 1 0;align-items:center;justify-content:center;gap:5px;min-width:0;height:28px;padding:0 8px;border:none;border-radius:6px;background:none;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-s-14);text-decoration:none;white-space:nowrap;cursor:pointer}
      .fv-side-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .fv-side-tab[aria-selected="true"]{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-primary);font-weight:600}
      .fv-side-tab svg{display:block;flex:none}
      .fv-git-panel{overflow:hidden!important}
      .fv-git{display:flex;flex:1 1 auto;flex-direction:column;min-height:0;gap:2px;padding-bottom:6px}
      .fv-git-toolbar{display:flex;flex:none;flex-direction:column;gap:4px;padding:2px 2px 6px;border-bottom:1px solid var(--dsw-alias-border-l1)}
      .fv-git-row{display:flex;min-width:0;align-items:center;gap:6px}
      .fv-git-label{flex:none;font-size:11px;color:var(--dsw-alias-label-caption)}
      .fv-select{box-sizing:border-box;flex:1 1 auto;min-width:0;max-width:100%;height:26px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:24px;cursor:pointer}
      .fv-select:hover{border-color:var(--dsw-alias-border-l3,var(--dsw-alias-border-l2))}
      .fv-select:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:1px}
      .fv-git-checkout{flex:none;height:26px;padding:0 10px;border:1px solid var(--dsw-alias-brand-primary,#4d6bfe);border-radius:6px;background:none;color:var(--dsw-alias-brand-primary,#4d6bfe);font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}
      .fv-git-checkout:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 12%,transparent)}
      .fv-git-checkout:disabled{opacity:.45;cursor:default}
      .fv-git-current{display:inline-flex;align-items:center;gap:4px;max-width:100%;overflow:hidden;font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis}
      .fv-git-section{display:flex;flex:none;align-items:center;justify-content:space-between;gap:6px;padding:6px 8px 2px;color:var(--dsw-alias-label-caption);font-size:11px;font-weight:600}
      .fv-git-count{font-weight:400;font-variant-numeric:tabular-nums}
      .fv-git-list{display:flex;flex:1 1 auto;flex-direction:column;gap:1px;min-height:0;overflow-y:auto;overscroll-behavior:contain}
      .fv-git-commit{display:flex;flex-direction:column;gap:2px;width:100%;min-width:0;padding:6px 8px;border:none;border-radius:8px;background:none;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
      .fv-git-commit:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .fv-git-commit[aria-current="true"]{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover))}
      .fv-git-subject{display:-webkit-box;overflow:hidden;font-size:13px;line-height:1.35;word-break:break-word;-webkit-box-orient:vertical;-webkit-line-clamp:2}
      .fv-git-meta{display:flex;min-width:0;align-items:center;gap:6px;color:var(--dsw-alias-label-caption);font-size:11px;font-variant-numeric:tabular-nums}
      .fv-git-sha{flex:none;font-family:var(--dsw-font-code,monospace);color:var(--dsw-alias-label-tertiary)}
      .fv-git-author{flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
      .fv-git-date{flex:none}
      .fv-git-more{flex:none;height:30px;margin:4px 2px 0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
      .fv-git-more:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .fv-git-more:disabled{opacity:.5;cursor:default}
      .fv-git-hint{flex:none;padding:2px 8px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:18px}
      .fv-git-note{display:flex;flex:none;flex-direction:column;align-items:flex-start;gap:8px;padding:10px 8px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
      .fv-commit{display:flex;flex:1 1 auto;flex-direction:column;min-height:0;overflow:hidden}
      .fv-commit-head{display:flex;flex:none;flex-direction:column;gap:4px;padding:12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1,transparent)}
      .fv-commit-subject{font-size:14px;font-weight:600;line-height:1.4;word-break:break-word}
      .fv-commit-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;color:var(--dsw-alias-label-caption);font-size:11px}
      .fv-commit-sha{font-family:var(--dsw-font-code,monospace);color:var(--dsw-alias-label-tertiary)}
      .fv-commit-body{max-height:220px;overflow:auto;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-code,monospace);font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
      .fv-commit-files{display:flex;flex:1 1 auto;flex-direction:column;gap:1px;min-height:0;padding:6px;overflow-y:auto;overscroll-behavior:contain}
      .fv-commit-file{display:flex;align-items:center;gap:8px;width:100%;min-width:0;min-height:30px;padding:4px 8px;border:none;border-radius:8px;background:none;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;text-align:left;cursor:pointer}
      .fv-commit-file:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
      .fv-commit-file:disabled{opacity:.55;cursor:default}
      .fv-commit-file[aria-current="true"]{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover))}
      .fv-commit-status{flex:none;width:18px;text-align:center;font-family:var(--dsw-font-code,monospace);font-size:11px;font-weight:700}
      .fv-commit-status[data-tone="add"]{color:var(--dsw-alias-state-success-primary,#10b981)}
      .fv-commit-status[data-tone="del"]{color:var(--dsw-alias-state-error-primary,#ef4444)}
      .fv-commit-status[data-tone="mod"]{color:var(--dsw-alias-state-warning-primary,#d97706)}
      .fv-commit-path{flex:1 1 auto;min-width:0;font-family:var(--dsw-font-code,monospace);font-size:12px;line-height:1.45;word-break:break-all}
      .fv-commit-tag{flex:none;padding:1px 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-3,rgba(0,0,0,.05));color:var(--dsw-alias-label-caption);font-family:var(--dsw-font-family);font-size:10px}
      /* Working-tree changes and a commit's patch share the commit-row visuals
         so the two panels read as one surface. */
      .fv-git-changes{display:flex;flex:none;flex-direction:column;gap:1px;max-height:38%;overflow-y:auto;overscroll-behavior:contain;border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:4px}
      .fv-git-change-group{display:flex;flex-direction:column;gap:1px}
      .fv-git-refresh{width:22px;height:22px;margin-left:auto}
      .fv-commit-diff{display:flex;flex:1 1 auto;flex-direction:column;gap:2px;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:4px 6px}
      .fv-commit-diff-file{display:flex;flex:none;flex-direction:column;gap:2px;margin-bottom:8px}
      .fv-commit-diff-file .fv-git-section{padding:2px 2px 0}
      .fv-commit-diff-file .fv-diff-view{margin:2px 0}
      .fv-git-warn{display:flex;align-items:flex-start;gap:6px;padding:6px 8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d97706) 45%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d97706) 10%,transparent);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5}
      .fv-git-warn strong{color:var(--dsw-alias-state-warning-primary,#d97706)}
      .fv-history-banner{display:flex;flex:none;flex-direction:column;gap:2px;margin:6px 6px 0;padding:7px 10px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 40%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 10%,transparent);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
      .fv-history-hint{color:var(--dsw-alias-label-caption);font-size:11px}
      .fv-modal-scrim{position:fixed;inset:0;z-index:70;display:grid;place-items:center;padding:16px;background:color-mix(in srgb,#000 45%,transparent);animation:fv-fade .15s ease-out}
      .fv-modal{width:min(94vw,560px);max-height:86vh;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff));box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);overflow:hidden;font-family:var(--dsw-font-family)}
      .fv-modal-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--dsw-alias-border-l1)}
      .fv-modal-title{font:var(--dsw-font-base-strong-16,600 16px/24px var(--dsw-font-family));font-weight:600;display:flex;align-items:center;gap:6px}
      .fv-modal-body{flex:1 1 auto;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:16px}
      .fv-modal-sec{display:flex;flex-direction:column;gap:8px}
      .fv-modal-sec-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
      .fv-modal-sec-hint{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:1.4}
      .fv-tag-list{display:flex;flex-wrap:wrap;gap:6px}
      .fv-tag{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-3,rgba(0,0,0,.05));font-size:12px;color:var(--dsw-alias-label-secondary);word-break:break-all}
      .fv-safe-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1,transparent);font-size:13px}
      .fv-safe-item-info{display:flex;flex-direction:column;min-width:0;flex:1 1 auto}
      .fv-safe-item-path{font-family:monospace;font-size:12px;word-break:break-all;color:var(--dsw-alias-label-primary)}
      .fv-safe-item-label{font-size:11px;color:var(--dsw-alias-label-tertiary)}
      .fv-btn-del{border:none;background:none;color:var(--dsw-alias-state-error-primary,#ef4444);font-size:12px;cursor:pointer;padding:4px 8px;border-radius:4px}
      .fv-btn-del:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 10%,transparent)}
      .fv-add-box{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.02));border:1px dashed var(--dsw-alias-border-l2)}
      .fv-input-row{display:flex;gap:8px}
      .fv-input{flex:1 1 auto;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary);font-size:13px;outline:none}
      .fv-input:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
      .fv-modal-foot{display:flex;justify-content:flex-end;gap:10px;padding:12px 18px;border-top:1px solid var(--dsw-alias-border-l1)}
      .fv-btn-primary{background:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff);border-color:transparent}
      .fv-btn-primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 85%,#000)}
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
      .fv-context-backdrop{position:fixed;inset:0;z-index:99;background:transparent!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;touch-action:none}
      /* 菜单是实底卡片，不吃主题的毛玻璃。
         玻璃主题（glass.css）里有一条规则，给 [role="menu"] 套上
         background:var(--color-menu) 和 backdrop-filter:blur(...)；我们的菜单正好
         带 role="menu"，于是被套上半透明底 + 几十 px 的模糊。backdrop-filter 会把
         **它背后的一切**糊掉，而背后正是铺满全屏的遮罩层，所以整屏发虚、只剩菜单
         轮廓；系统默认主题没有这条规则，因此只有玻璃主题下才看得到。
         这里把三样都钉死：清掉模糊、底色用宿主菜单底（不透明），确保菜单里的文字
         永远落在实色上、背后也不会被糊。 */
      .fv-context-menu{position:fixed;z-index:100;min-width:190px;padding:5px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff));box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:13px;display:flex;flex-direction:column;gap:3px;animation:fv-menu-in .12s cubic-bezier(.2,.8,.2,1);touch-action:manipulation;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;isolation:isolate}
      /* 底色单独一条，且带 !important：玻璃主题用 background:var(--color-menu)
         !important 把菜单底改成 rgba(248,249,255,.72)，不压住它菜单会透出背后的
         正文，读起来像半透明脏块。这条把菜单底钉回宿主的实色值，主题换色也不影响
         可读性。 */
      .fv-context-menu{background-color:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff))!important}
      /* 上面两条还不够。玻璃主题的样式表在插件之后注入，两条 !important 规则
         特异性相同时「后加载者胜」，实测菜单仍拿到 blur(41.6px) 与
         rgba(248,249,255,.72)。这条把选择器抬到 html + 重复类 + 属性同时命中，
         特异性稳稳高过主题的 :is(html[data-...]) [role="menu"]，与加载顺序无关。 */
      /* 用 id 选择器（特异性 1-0-0）压过主题：玻璃主题的选择器是
         :is(html[data-theme-studio=...]) [role="menu"]:not(...)，叠加后仍属类/
         属性级别，且它的样式表在本插件之后注入；实测类级 !important 会输给它，
         id 级则与加载顺序无关地胜出。 */
      #dsh-fv-context-menu{-webkit-backdrop-filter:none!important;backdrop-filter:none!important;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff))!important;background-color:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff))!important;isolation:isolate!important}
      @keyframes fv-menu-in{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
      .fv-context-item{display:flex;align-items:center;gap:10px;width:100%;height:34px;padding:0 10px;border:none;border-radius:8px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent}
      .fv-context-item:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .fv-context-item:active{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover))}
      .fv-context-item-icon{display:inline-grid;place-items:center;width:18px;height:18px;flex:none;color:var(--dsw-alias-label-secondary);font-size:14px}
      .fv-context-item-label{flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}
      .fv-context-divider{height:1px;margin:3px 4px;background:var(--dsw-alias-border-l1)}
      .fv-context-head{padding:4px 8px 6px;border-bottom:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:2px;margin-bottom:3px}
      .fv-context-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);word-break:break-all;line-height:1.3}
      .fv-context-path{font-size:11px;color:var(--dsw-alias-label-tertiary);word-break:break-all;line-height:1.3}
      .fv-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:110;padding:8px 18px;border:1px solid var(--dsw-alias-border-l2);border-radius:20px;background:var(--dsw-alias-button-floating-fill,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;box-shadow:var(--dsw-shadow-lv3);pointer-events:none;animation:fv-toast-in .15s ease-out}
      @keyframes fv-toast-in{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
      /* Floating entry button is strictly disabled across both PC and mobile. */
      .fv-float-entry{display:none!important}
      /* Composer toolbar entry (PC): seated in conversation.input.left beside the + command button.
         几何必须与宿主原生「+」(.uV2eYG_add) 对齐：28×28、radius-sm、specific-selector 底色、
         label-primary 前景。此前用 999px 圆角 + label-secondary，夹在原生按钮中间显得是一枚
         突兀的实心圆扣，尺寸与圆角都对不上。 */
      .fv-composer-entry{box-sizing:border-box;display:inline-grid;place-items:center;width:28px;height:28px;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:var(--dsw-specific-selector);color:var(--dsw-alias-label-primary);cursor:pointer;flex:none;line-height:1;corner-shape:round;transition:background-color .12s,color .12s,transform .1s}
      .fv-composer-entry:hover{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-primary)}
      .fv-composer-entry:active{transform:scale(.95)}
      .fv-composer-entry svg{display:block;flex:none;width:16px;height:16px}
      @media(max-width:768px){.fv-composer-entry{display:none!important}}
      @media(max-width:1100px){.fv-shell{width:min(82vw,900px)}}
      .fv-shell[data-mobile="true"]{width:100%!important;border-left:none!important}
      .fv-shell[data-mobile="true"] .fv-btn-fullscreen{display:none!important}
      .fv-shell[data-mobile="true"] .fv-resizer{display:none!important}
      .fv-shell[data-mobile="true"] .fv-edge{display:none!important}
      .fv-shell[data-fullscreen="true"] .fv-edge{display:none!important}
      .fv-shell[data-mobile="true"] .fv-tree{flex:1 1 auto!important;width:100%!important;min-width:0!important;max-width:none!important;border-right:none!important;padding:6px 6px!important}
      .fv-shell[data-mobile="true"] .fv-row-seat{width:100%!important;max-width:none!important}
      .fv-shell[data-mobile="true"] .fv-row{flex:1 1 auto!important;min-height:38px;padding:6px 6px;align-items:flex-start;padding-left:calc(4px + var(--fv-depth,0) * 8px)!important}
      .fv-shell[data-mobile="true"] .fv-tree-status{padding-left:calc(4px + var(--fv-depth,0) * 8px)!important}
      .fv-shell[data-mobile="true"] .fv-row .fv-glyph{margin-top:2px}
      .fv-shell[data-mobile="true"] .fv-row-name{white-space:normal;word-break:break-all;overflow-wrap:anywhere;line-height:1.35;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;font-size:13px}
      .fv-shell[data-mobile="true"] .fv-row-size{margin-top:2px;font-size:10px;opacity:.85;flex-shrink:0;margin-left:auto}
      .fv-shell[data-mobile="true"] .fv-body[data-pane="content"] .fv-tree,
      .fv-shell[data-mobile="true"] .fv-body[data-pane="tree"] .fv-main{display:none!important}
      .fv-shell[data-mobile="true"] .fv-crumbs{font-size:11px}
      .fv-shell[data-mobile="true"] .fv-file-path{display:none!important}
      /* The head is cramped on a phone: drop the provenance hint, keep the
         control, and give the select a full touch target. */
      .fv-shell[data-mobile="true"] .fv-lang-hint{display:none!important}
      .fv-shell[data-mobile="true"] .fv-lang-select{max-width:104px;height:32px;font-size:13px;line-height:30px}
      @media(max-width:960px), (pointer:coarse) and (max-width:1100px){
        .fv-shell{width:100%!important;border-left:none!important}
        .fv-btn-fullscreen{display:none!important}
        .fv-resizer{display:none!important}
        .fv-tree{flex:1 1 auto!important;width:100%!important;min-width:0!important;max-width:none!important;border-right:none!important;padding:6px 6px!important}
        .fv-row-seat{width:100%!important;max-width:none!important}
        .fv-row{flex:1 1 auto!important;min-height:38px;padding:6px 6px;align-items:flex-start;padding-left:calc(4px + var(--fv-depth,0) * 8px)!important}
        .fv-tree-status{padding-left:calc(4px + var(--fv-depth,0) * 8px)!important}
        .fv-row .fv-glyph{margin-top:2px}
        .fv-row-name{white-space:normal;word-break:break-all;overflow-wrap:anywhere;line-height:1.35;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;font-size:13px}
        .fv-row-size{margin-top:2px;font-size:10px;opacity:.85;flex-shrink:0;margin-left:auto}
        .fv-body[data-pane="content"] .fv-tree,.fv-body[data-pane="tree"] .fv-main{display:none!important}
        .fv-crumbs{font-size:11px}
        .fv-file-path{display:none!important}
      }
      /* Below the mobile-adapter breakpoint the drawer takes the full width and
         the two panes swap instead of sitting side by side. */
      @media(max-width:768px){
        .fv-head{gap:4px!important;padding:8px 8px!important}
        .fv-root-select{flex:1 1 90px!important;min-width:70px!important;max-width:none!important}
        .fv-icon-button{width:32px!important;height:32px!important;min-width:32px!important;min-height:32px!important;flex:none!important}
        .fv-btn-close{flex:none!important;margin-left:auto!important}
        /* 44px is the smallest comfortable touch target. */
        .fv-mention{width:44px;height:44px;margin-right:2px;opacity:1}
        .fv-row-seat .fv-mention{align-self:center}
        .fv-shell{width:100%!important;border-left:none!important}
        .fv-btn-fullscreen{display:none!important}
        .fv-resizer{display:none!important}
        .fv-tree{flex:1 1 auto!important;width:100%!important;min-width:0!important;max-width:none!important;border-right:none;padding:6px 6px}
        .fv-row-seat{width:100%!important;max-width:none!important}
        .fv-row{flex:1 1 auto!important;min-height:38px;padding:6px 6px;align-items:flex-start;padding-left:calc(4px + var(--fv-depth,0) * 8px)!important}
        .fv-tree-status{padding-left:calc(4px + var(--fv-depth,0) * 8px)!important}
        .fv-row .fv-glyph{margin-top:2px}
        .fv-row-name{white-space:normal;word-break:break-all;overflow-wrap:anywhere;line-height:1.35;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;font-size:13px}
        .fv-row-size{margin-top:2px;font-size:10px;opacity:.85;flex-shrink:0;margin-left:auto}
        .fv-body[data-pane="content"] .fv-tree,.fv-body[data-pane="tree"] .fv-main{display:none!important}
        .fv-crumbs{font-size:11px}
        .fv-file-path{display:none!important}
        /* 遮罩只用来接住「点菜单外面关闭」，不该遮住内容。
           它曾经在这里被涂成 rgba(0,0,0,.45) 并加了模糊，等于把整个抽屉
           盖黑。手机上菜单本身已经是贴底的独立面板，靠自身圆角与阴影就能
           立住，不需要再压一层遮罩。 */
        .fv-context-backdrop{background:transparent!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
        .fv-context-menu{position:fixed!important;bottom:max(16px,var(--dsh-sab,0px))!important;left:max(16px,var(--dsh-sal,0px))!important;right:max(16px,var(--dsh-sar,0px))!important;top:auto!important;width:auto!important;max-width:none!important;border-radius:18px!important;padding:8px!important;box-shadow:var(--dsw-shadow-lv3)!important;animation:fv-menu-slide-up .2s cubic-bezier(.2,.8,.2,1)!important}
        .fv-context-head{padding:4px 8px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:2px;margin-bottom:4px}
        .fv-context-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);word-break:break-all;line-height:1.3}
        .fv-context-path{font-size:11px;color:var(--dsw-alias-label-tertiary);word-break:break-all;line-height:1.3}
        @keyframes fv-menu-slide-up{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)}}
        .fv-context-item{height:46px!important;font-size:15px!important;padding:0 14px!important;border-radius:12px!important}
        .fv-context-item-icon{width:22px!important;height:22px!important;font-size:16px!important}
        /* 手机上标签栏同样要能滚动，关闭按钮放大到可点面积。 */
        .fv-tabs{padding:4px 4px 0!important}
        .fv-tab-cell{height:34px!important;max-width:190px!important}
        .fv-tab-label{max-width:120px!important}
        .fv-tab-dir{display:none!important}
        .fv-tab-close{width:24px!important;height:24px!important;font-size:16px!important}
        .fv-main-head{padding:6px 8px!important;gap:6px!important}
        /* 手机上的目录：按钮放大到可点面积，面板几乎占满宽度，
           并让正文在目录展开时仍能读到。 */
        .fv-outline{top:6px!important;right:6px!important;max-height:calc(100% - 12px)!important}
        .fv-outline-toggle{width:34px!important;height:34px!important;border-radius:10px!important}
        .fv-outline-panel{width:min(78vw,320px)!important;max-height:min(56vh,380px)!important;border-radius:12px!important}
        .fv-outline-item{padding:9px 10px!important;font-size:13px!important;border-radius:8px!important}
        .fv-outline-item[data-level="1"]{padding-left:22px!important}
        .fv-outline-item[data-level="2"]{padding-left:34px!important}
        .fv-outline-item[data-level="3"]{padding-left:46px!important}
        .fv-outline-item[data-level="4"]{padding-left:58px!important}
        .fv-outline-item[data-level="5"]{padding-left:70px!important}
        /* SafePathsModal 移动端自适应优化：输入框与添加按钮纵向铺满，防溢出 */
        .fv-modal-scrim{padding:10px!important}
        .fv-modal{width:min(96vw,560px)!important;max-height:min(90dvh,90vh,680px)!important;border-radius:16px!important}
        .fv-modal-head{padding:12px 14px!important}
        .fv-modal-body{padding:12px 14px!important;gap:14px!important}
        .fv-modal-foot{padding:10px 14px!important}
        .fv-input-row{flex-direction:column!important;gap:8px!important}
        .fv-input-row .fv-input{width:100%!important;max-width:100%!important;height:38px!important;font-size:14px!important;border-radius:8px!important}
        .fv-input-row .fv-button{width:100%!important;height:38px!important;min-height:38px!important;border-radius:8px!important;border-color:transparent!important;background:var(--dsw-alias-brand-primary,#4d6bfe)!important;color:var(--dsw-alias-label-primary-foreground,#fff)!important;font-weight:500!important}
        .fv-safe-item{padding:8px 8px!important}
        .fv-safe-item-path{font-size:11.5px!important;line-height:1.4!important}
        .fv-btn-del{height:32px!important;min-width:44px!important;font-size:13px!important;padding:4px 8px!important}
        /* Git panel on a phone: the selects and the commit rows are the two
           places a finger has to land precisely, so both get a full touch
           target while the secondary text stays compact. */
        .fv-side-tabs{margin:-6px -6px 4px!important;padding:2px!important}
        .fv-side-tab{height:32px!important;font-size:13px!important}
        .fv-select{height:32px!important;font-size:13px!important;line-height:30px!important}
        .fv-git-checkout{height:32px!important;padding:0 12px!important;font-size:13px!important}
        .fv-git-commit{min-height:44px!important;padding:8px!important}
        .fv-git-subject{font-size:13.5px!important;-webkit-line-clamp:3!important}
        .fv-git-more{height:38px!important;font-size:13px!important}
        .fv-commit-file{min-height:42px!important;font-size:13.5px!important}
        .fv-commit-path{font-size:12px!important}
        .fv-git-changes{max-height:none!important}
        .fv-commit-diff-file .fv-diff-table{font-size:12px!important}
      }
    `;

    /**
     * Strip any full-screen blur / darkening that other layers put over the app
     * while this drawer is open.
     *
     * The drawer is a right-hand panel, not a modal dialog: content behind it
     * stays visible and interactive. Other layers disagree — dsh-mobile-adapter
     * turns the host's role="presentation" wrapper into a blurred
     * rgba(0,0,0,.5) scrim, and glass themes paint backdrop-filter on anything
     * they consider a floating surface. Both are keyed on selectors this plugin
     * does not own (role attributes, sibling scrims), so overriding them from
     * CSS depends on winning a specificity fight against third-party sheets that
     * load after ours.
     *
     * Walking up from the drawer and neutralising those properties in place is
     * source-agnostic: it removes whatever a theme or adapter applied, no matter
     * which rule did it, and it is re-applied on every open because those layers
     * can re-render. The original inline values are restored on close so no
     * other feature inherits our override.
     *
     * @param {Element | null} scrim - this drawer's root element.
     * @param {boolean} active - true while the drawer is open.
     * @returns {() => void} a function that restores what was changed.
     */
    function suppressBackdropEffects(scrim, active) {
      if (!scrim || typeof window === "undefined") return () => {};
      const view = scrim.ownerDocument?.defaultView || window;
      const touched = [];
      const clear = (element) => {
        if (!element || element.nodeType !== 1) return;
        const style = view.getComputedStyle(element);
        const backdrop = style.backdropFilter || style.webkitBackdropFilter || "";
        const background = style.backgroundColor || "";
        // Only touch what actually has an effect: a transparent background and a
        // `none` filter mean there is nothing to undo, and writing to them would
        // burn a style recalculation for no visible reason.
        const hasBlur = backdrop !== "" && backdrop !== "none";
        const isDark = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/.test(background)
          && !/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/.test(background)
          && parseFloat(/rgba?\([^)]*?([\d.]+)\)$/.exec(background)?.[1] ?? "1") > 0.05;
        if (!hasBlur && !isDark) return;
        touched.push({
          element,
          backdrop: element.style.backdropFilter,
          webkitBackdrop: element.style.webkitBackdropFilter,
          background: element.style.backgroundColor,
        });
        if (hasBlur) {
          element.style.setProperty("backdrop-filter", "none", "important");
          element.style.setProperty("-webkit-backdrop-filter", "none", "important");
        }
        if (isDark) element.style.setProperty("background-color", "transparent", "important");
      };
      if (active) {
        // The wrapper the host mounts this seat into, plus its own sibling
        // scrims, are the two places a modal treatment shows up.
        let node = scrim.parentElement;
        for (let depth = 0; node && depth < 4; depth += 1) {
          clear(node);
          for (const sibling of node.children) {
            if (sibling !== scrim && sibling.getAttribute("aria-hidden") === "true") clear(sibling);
          }
          node = node.parentElement;
        }
      }
      return () => {
        for (const entry of touched) {
          entry.element.style.backdropFilter = entry.backdrop;
          entry.element.style.webkitBackdropFilter = entry.webkitBackdrop;
          entry.element.style.backgroundColor = entry.background;
        }
      };
    }

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
     * Track the last focused caret/selection inside the composer input.
     * When the user clicks the file viewer drawer, the composer loses focus.
     * Tracking this ensures "@" mentions insert at the exact caret position
     * instead of clobbering existing text or appending blindly to the end.
     */
    let lastComposerSelection = null;

    if (typeof document !== "undefined") {
      const recordSelection = () => {
        try {
          const activeEl = document.activeElement;
          if (activeEl && (activeEl.tagName === "TEXTAREA" || activeEl.tagName === "INPUT")) {
            if (activeEl.closest("[data-composer-card]") || activeEl.getAttribute("data-composer-input") !== null) {
              lastComposerSelection = {
                type: "textarea",
                element: activeEl,
                start: activeEl.selectionStart,
                end: activeEl.selectionEnd,
                value: activeEl.value,
                time: Date.now(),
              };
              return;
            }
          }
          const sel = typeof window !== "undefined" && window.getSelection ? window.getSelection() : null;
          if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            const container = range.commonAncestorContainer;
            const inputEl = container.nodeType === 1
              ? container.closest("[data-composer-input]")
              : (container.parentElement ? container.parentElement.closest("[data-composer-input]") : null);
            if (inputEl) {
              lastComposerSelection = {
                type: "contenteditable",
                element: inputEl,
                range: range.cloneRange(),
                time: Date.now(),
              };
            }
          }
        } catch (_) {}
      };
      document.addEventListener("selectionchange", recordSelection, true);
      document.addEventListener("keyup", recordSelection, true);
      document.addEventListener("mouseup", recordSelection, true);
      document.addEventListener("touchend", recordSelection, true);
    }

    /**
     * Write text to the composer DOM element, supporting both textarea and Lexical contenteditable.
     */
    function writeDraftToDom(doc, text) {
      if (!doc) return false;
      const inputEl = doc.querySelector("[data-composer-input]");
      if (inputEl && inputEl.isContentEditable) {
        try {
          inputEl.focus();
          if (doc.execCommand) {
            doc.execCommand("selectAll", false, null);
            doc.execCommand("insertText", false, text);
          } else {
            inputEl.textContent = text;
            inputEl.dispatchEvent(new Event("input", { bubbles: true }));
          }
          return true;
        } catch (_) {}
      }
      const area = doc.querySelector("[data-composer-card] textarea, textarea");
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

    /**
     * The drawer width to open with.
     *
     * Zero means "use the stylesheet default", which is what an untouched
     * drawer should do: the default is a fraction of the viewport, and caching
     * a resolved pixel value would pin it to whatever window happened to be
     * open at the time.
     * @returns {number} the stored width, or 0 when unset.
     */
    function readShellWidth() {
      try {
        const raw = globalThis.localStorage?.getItem(SHELL_WIDTH_KEY);
        const parsed = raw === null || raw === undefined ? 0 : Number(raw);
        if (Number.isFinite(parsed) && parsed >= MIN_SHELL_WIDTH) return Math.round(parsed);
      } catch (_) {}
      return 0;
    }

    /**
     * Remember the drawer width, or forget it when it equals the default.
     * @param {number} width - the width to store; 0 clears the entry.
     */
    function writeShellWidth(width) {
      try {
        if (!(width > 0)) globalThis.localStorage?.removeItem(SHELL_WIDTH_KEY);
        else globalThis.localStorage?.setItem(SHELL_WIDTH_KEY, String(Math.round(width)));
      } catch (_) {}
    }

    /**
     * Clamp a requested drawer width onto what this viewport can honour.
     *
     * The upper bound is the frame itself: a panel wider than the window would
     * push its own header out of reach, so the drag stops at the edge instead
     * of letting the reader lose the close button.
     * @param {number} width - requested width in pixels.
     * @param {number} viewportWidth - available width in pixels.
     * @returns {number} the width to apply.
     */
    function clampShellWidth(width, viewportWidth) {
      const ceiling = Number.isFinite(viewportWidth) && viewportWidth > 0
        ? Math.max(MIN_SHELL_WIDTH, viewportWidth)
        : 1200;
      const floor = Math.min(MIN_SHELL_WIDTH, ceiling);
      return Math.round(Math.min(ceiling, Math.max(floor, Number(width) || 0)));
    }

    function writeTreeWidth(width) {
      try {
        if (typeof width === "number" && Number.isFinite(width)) {
          globalThis.localStorage?.setItem(TREE_WIDTH_KEY, String(Math.round(width)));
        }
      } catch { /* storage is unavailable */ }
    }

    /**
     * Read the per-file language overrides.
     *
     * Every entry is re-validated on read: storage survives upgrades and can be
     * hand-edited, and an id the highlighter does not know would silently
     * render plain while the picker claimed otherwise. Entries are stored as
     * `{ [key]: { lang, at } }` so the oldest can be evicted.
     */
    function readLangOverrides() {
      try {
        const raw = globalThis.localStorage?.getItem(LANG_OVERRIDES_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const clean = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof key !== "string" || key === "") continue;
          const lang = value?.lang;
          if (!isKnownLanguageId(lang)) continue;
          const at = Number(value?.at);
          clean[key] = { lang, at: Number.isFinite(at) ? at : 0 };
        }
        return clean;
      } catch { return {}; }
    }

    /** Persist the override map, evicting the oldest entries past the cap. */
    function writeLangOverrides(map) {
      try {
        const entries = Object.entries(map || {});
        if (entries.length > LANG_OVERRIDES_MAX) {
          entries.sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0));
          map = Object.fromEntries(entries.slice(0, LANG_OVERRIDES_MAX));
        }
        globalThis.localStorage?.setItem(LANG_OVERRIDES_KEY, JSON.stringify(map));
      } catch { /* storage is unavailable; the choice simply is not remembered */ }
    }

    /**
     * The selectable languages, as the host reports them.
     *
     * Module-scoped because the storage helpers below are plain functions, not
     * component hooks. Starts empty: until the host answers, only the id shape
     * is checked, and the host re-validates every override regardless.
     */
    let languageCatalog = [];

    /** Replace the cached catalog from a `languages` response, ignoring a malformed one. */
    function setLanguageCatalog(value) {
      if (!Array.isArray(value)) return;
      const clean = value.filter((entry) => entry !== null && typeof entry === "object"
        && typeof entry.id === "string" && entry.id !== ""
        && typeof entry.label === "string");
      if (clean.length > 0) languageCatalog = clean;
    }

    /**
     * Whether an id is one the picker offers.
     *
     * The catalog arrives from the host, so this consults the live list rather
     * than a second copy that could drift.
     */
    function isKnownLanguageId(id) {
      if (typeof id !== "string" || id === "") return false;
      if (languageCatalog.length === 0) {
        // Before the catalog arrives, accept only the shape; the host
        // re-validates every override anyway, so a stale id cannot take effect.
        return /^[a-z][a-z0-9-]{0,31}$/.test(id);
      }
      return languageCatalog.some((entry) => entry.id === id);
    }

    /** The storage key for one file: root plus path, so equal paths in different roots differ. */
    function langOverrideKey(root, path) {
      return `${root ?? ""}\u0000${path ?? ""}`;
    }

    /** The remembered language choice for a file, or "auto" when none is stored. */
    function readLangOverride(root, path) {
      const stored = readLangOverrides()[langOverrideKey(root, path)];
      return stored === undefined ? "auto" : stored.lang;
    }

    /**
     * Remember, or forget, the language choice for one file.
     * @param {string} root - the workspace root id.
     * @param {string} path - the file's path within that root.
     * @param {string} lang - the chosen id, or "auto" to clear the override.
     */
    function writeLangOverride(root, path, lang) {
      const key = langOverrideKey(root, path);
      const map = readLangOverrides();
      if (lang === "auto") delete map[key];
      else map[key] = { lang, at: Date.now() };
      writeLangOverrides(map);
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
    // The wrappers below outlive a single apply. They were closing over the
    // store of whichever apply installed them, so a second apply left the Host
    // calling the previous store: the click was swallowed, the drawer never
    // opened, and the file viewer looked like it had stopped listening. These
    // pointers are refreshed on every apply so the wrappers always write the
    // store the mounted overlay is actually subscribed to.
    let liveOpenStore = null;
    let liveSessionStore = null;

    /**
     * Open the drawer on one path.
     *
     * `sessionId` is optional: a `dsh-resource://file/session/<id>/…` address
     * names the session it belongs to, and honouring it keeps the drawer on that
     * session's project instead of whatever session happens to be current.
     */
    function openViewerForPath(openStore, sessionStore, path, sessionId) {
      const target = liveOpenStore || openStore;
      const session = liveSessionStore || sessionStore;
      const sid = sessionId !== undefined && sessionId !== "" ? sessionId : (session ? session.get() : undefined);
      target.set({ filePath: path, sessionId: sid, _t: Date.now() });
    }

    function parseFileResource(address) {
      if (typeof address !== "string" || !address.startsWith("dsh-resource://file/")) return null;
      try {
        const end = address.search(/[?#]/);
        const sliced = address.slice("dsh-resource://file/".length, end === -1 ? undefined : end);
        const parts = sliced.split("/");
        const scope = parts[0];
        if (scope === "session") {
          const sessionId = decodeURIComponent(parts[1] || "");
          const path = parts.slice(2).map(decodeURIComponent).join("/");
          return { scope, sessionId, path };
        }
        if (scope === "absolute") {
          const path = "/" + parts.slice(1).map(decodeURIComponent).join("/");
          return { scope, path };
        }
      } catch {}
      return null;
    }

    function parseChangesReviewResource(address) {
      if (typeof address !== "string" || !address.startsWith("dsh-resource://changes-review/session/")) return null;
      try {
        const end = address.search(/[?#]/);
        const sliced = address.slice("dsh-resource://changes-review/session/".length, end === -1 ? undefined : end);
        const parts = sliced.split("/");
        if (parts.length >= 2) {
          const sessionId = decodeURIComponent(parts[0] || "");
          const seq = Number(parts[1]);
          return { sessionId, seq };
        }
      } catch {}
      return null;
    }

    function wrapSidebarRight(sr, openStore, sessionStore) {
      if (!sr || typeof sr.openResource !== "function" || wiredOpenPath === null || wiredOpenPath.has(sr)) return;
      wiredOpenPath.add(sr);
      const originalOpenResource = sr.openResource.bind(sr);
      sr.openResource = function(address, options) {
        const parsed = parseFileResource(address);
        if (parsed && parsed.path) {
          openViewerForPath(openStore, sessionStore, parsed.path, parsed.sessionId);
          return;
        }
        const review = parseChangesReviewResource(address);
        if (review && review.sessionId) {
          const sid = review.sessionId;
          // Query changes summary to locate the requested file index
          const seq = review.seq;
          const idx = (options && options.params && typeof options.params.index === "number") ? options.params.index : 0;
          fetch(`/api/changes.summary?${new URLSearchParams({ sessionId: sid, seq: String(seq) })}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
              const file = data?.files?.[idx]?.path || data?.files?.[0]?.path;
              if (file) {
                openViewerForPath(openStore, sessionStore, file);
              }
            })
            .catch(() => {});
          return;
        }
        return originalOpenResource(address, options);
      };
      if (typeof sr.openResourceIn === "function") {
        const originalOpenResourceIn = sr.openResourceIn.bind(sr);
        sr.openResourceIn = function(sessionId, address, options) {
          const parsed = parseFileResource(address);
          if (parsed && parsed.path) {
            openViewerForPath(openStore, sessionStore, parsed.path, sessionId || parsed.sessionId);
            return;
          }
          const review = parseChangesReviewResource(address);
          if (review) {
            const sid = sessionId || review.sessionId;
            const seq = review.seq;
            const idx = (options && options.params && typeof options.params.index === "number") ? options.params.index : 0;
            fetch(`/api/changes.summary?${new URLSearchParams({ sessionId: sid, seq: String(seq) })}`)
              .then((res) => (res.ok ? res.json() : null))
              .then((data) => {
                const file = data?.files?.[idx]?.path || data?.files?.[0]?.path;
                if (file) {
                  openViewerForPath(openStore, sessionStore, file, sid);
                }
              })
              .catch(() => {});
            return;
          }
          return originalOpenResourceIn(sessionId, address, options);
        };
      }
    }

    function wrapWorkspaceOpenPath(ctx, openStore, sessionStore) {
      const workspaces = ctx.workspaces;
      if (!workspaces || typeof workspaces.openPath !== "function" || wiredOpenPath === null || wiredOpenPath.has(workspaces)) return;
      wiredOpenPath.add(workspaces);
      workspaces.openPath = async function(path) {
        openViewerForPath(openStore, sessionStore, path);
      };
    }

    function wrapConnectionRpc(ctx, openStore, sessionStore) {
      const rpc = ctx && ctx.connection && ctx.connection.rpc;
      if (!rpc || typeof rpc.call !== "function" || (wiredOpenPath !== null && wiredOpenPath.has(rpc))) return;
      wiredOpenPath.add(rpc);
      const originalCall = rpc.call.bind(rpc);
      rpc.call = async function(channel, endpoint, payload, signal) {
        if (typeof endpoint === "string" && endpoint.includes("openWorkspacePath")) {
          const path = payload?.args?.request?.path ||
                       payload?.args?.path ||
                       payload?.request?.path ||
                       payload?.path || "";
          if (path) {
            openViewerForPath(openStore, sessionStore, path);
            return { ok: true, value: { opened: true } };
          }
        }
        return originalCall(channel, endpoint, payload, signal);
      };
    }

    /**
     * Take over the Desktop Host's changed-file open route.
     *
     * The changes card's native open control does not go through the RPC
     * carrier: it POSTs `/api/changes.open?sessionId=…&seq=…&index=…`, which
     * hands the file to the operating system. Nothing in the RPC path can see
     * that call, so on Desktop the changes card opened the system editor while
     * the Web build (where the control is not mounted at all) opened the
     * viewer. Resolving the same coordinates through the summary route gives the
     * path, and a synthetic OK response keeps the Host's card state settled.
     */
    function wrapChangesOpenFetch(openStore, sessionStore) {
      if (typeof window === "undefined" || typeof window.fetch !== "function") return;
      const originalFetch = window.fetch;
      if (wiredOpenPath === null || wiredOpenPath.has(originalFetch)) return;
      wiredOpenPath.add(originalFetch);

      const summaryPath = (sessionId, seq) =>
        `/api/changes.summary?${new URLSearchParams({ sessionId, seq: String(seq) })}`;

      window.fetch = function(input, init) {
        const requestUrl = typeof input === "string" ? input : (input && typeof input.url === "string" ? input.url : "");
        const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
        if (method !== "POST" || !/\/api\/changes\.open\b/.test(requestUrl)) {
          return originalFetch.apply(this, arguments);
        }
        let coordinates;
        try {
          const query = new URLSearchParams(requestUrl.split("?")[1] || "");
          coordinates = {
            sessionId: query.get("sessionId") || "",
            seq: Number(query.get("seq")),
            index: Number(query.get("index") || 0),
          };
        } catch (_) {
          coordinates = null;
        }
        if (!coordinates || !coordinates.sessionId || !Number.isFinite(coordinates.seq)) {
          return originalFetch.apply(this, arguments);
        }
        const { sessionId, seq, index } = coordinates;
        return originalFetch(summaryPath(sessionId, seq), { signal: init && init.signal })
          .then((response) => (response && response.ok ? response.json() : null))
          .then((data) => {
            const files = Array.isArray(data && data.files) ? data.files : [];
            const entry = files[Number.isFinite(index) ? index : 0] || files[0];
            const file = entry && entry.path;
            if (!file) return originalFetch.apply(this, arguments);
            openViewerForPath(openStore, sessionStore, file, sessionId);
            // The Host only reads `response.ok`; a bodiless 204 settles its card
            // without claiming the OS actually opened anything.
            return new Response(null, { status: 204 });
          })
          .catch(() => originalFetch.apply(this, arguments));
      };
    }

    const COMMON_FILE_EXTENSIONS = new Set([
      "go", "ts", "js", "tsx", "jsx", "mjs", "cjs", "py", "java", "c", "cpp", "h", "hpp", "rs", "php", "rb", "swift", "kt", "scala",
      "md", "markdown", "txt", "json", "jsonc", "yaml", "yml", "toml", "xml", "html", "css", "scss", "less", "vue", "svelte",
      "sql", "sh", "bash", "zsh", "ps1", "bat", "cmd", "env", "conf", "config", "ini",
      "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "pdf", "doc", "docx", "xls", "xlsx", "csv"
    ]);

    function looksLikeFilePath(value) {
      if (!value || typeof value !== "string") return false;
      let str = value.trim();
      str = str.replace(/^@+/, "").trim();
      if ((str.startsWith("`") && str.endsWith("`")) || (str.startsWith("\"") && str.endsWith("\"")) || (str.startsWith("'") && str.endsWith("'"))) {
        str = str.slice(1, -1).trim();
      }
      str = str.replace(/[.,;:!?，。；：！？]+$/g, "").trim();

      // Multi-line, empty, or too long
      if (!str || str.includes("\n") || str.length > 260) return false;

      // Exclude URLs and protocol schemes
      if (/^[a-zA-Z][a-zA-Z0-9+-.]*:\/\//.test(str)) return false;

      // Exclude common non-path slash patterns
      if (/^(?:application|text|image|audio|video|multipart|font)\/[a-zA-Z0-9._+-]+$/i.test(str)) return false;
      if (/^(?:and\/or|true\/false|yes\/no|on\/off|in\/out|left\/right|read\/write|up\/down|import\/export)$/i.test(str)) return false;
      if (/^\d{4}[\/-]\d{1,2}[\/-]\d{1,2}/.test(str)) return false; // Date e.g. 2026/09/11

      // Exclude math or shell flags (e.g. "a / b", "-f /path")
      if (/\s[\/\\]\s/.test(str)) return false;
      if (str.startsWith("-") || str.startsWith("+") || str.includes(" = ") || str.includes(" == ")) return false;

      // Exclude illegal path characters. Colon is allowed only as a Windows
      // drive prefix (D:/Notes, C:\Users\...), not in URLs or MIME leftovers.
      if (/[*?<>"|;]/.test(str)) return false;
      if (str.includes(":") && !/^[A-Za-z]:[\\/]/.test(str)) return false;

      const hasSlash = str.includes("/") || str.includes("\\");

      // Check file extension
      const extMatch = str.match(/\.([A-Za-z0-9_-]{1,16})$/);
      if (!extMatch) {
        // If no extension, must look like an absolute path, home path, or relative dir path
        if (str === "~" || str.startsWith("~/") || str.startsWith("~\\") || str.startsWith("/") || str.startsWith("./") || str.startsWith("../") || /^[a-zA-Z]:[\\/]/.test(str)) {
          return true;
        }
        return false;
      }

      const ext = extMatch[1].toLowerCase();
      // If extension is purely numeric (e.g. 1.0, 3.14, 0.1.33) -> NOT a file path
      if (/^\d+$/.test(ext)) return false;

      // If it has a slash (e.g. internal/logic/script/env_vars.go)
      if (hasSlash) {
        return true;
      }

      // If no slash (e.g. just a filename "env_vars.go" or "report.md")
      if (COMMON_FILE_EXTENSIONS.has(ext)) return true;
      // If it contains Chinese characters and has valid extension
      if (/[\u4e00-\u9fa5]/.test(str) && ext.length >= 1 && ext.length <= 8) return true;

      return false;
    }

    function normalizeClickedPath(raw) {
      if (typeof raw !== "string") return "";
      let value = raw.trim();
      if (value === "") return "";
      // Strip common card action prefixes:
      // "打开 xxx", "open xxx", "已编辑 xxx", "已修改 xxx", "修改 xxx", "新建 xxx", "edited xxx", "查看 xxx 的改动", "在侧边栏预览 xxx", "在侧边栏打开 xxx"
      const prefixMatch = value.match(/^(?:打开|open|已编辑|已修改|修改|新建|edited|view)\s+(.+)$/i);
      if (prefixMatch) value = prefixMatch[1].trim();
      const diffMatch = value.match(/^(?:查看|view)\s+(.+?)\s+(?:的改动|changes)$/i);
      if (diffMatch) value = diffMatch[1].trim();
      const previewMatch = value.match(/^(?:在侧边栏预览|在侧边栏打开|preview in sidebar|open in sidebar)\s+(.+)$/i);
      if (previewMatch) value = previewMatch[1].trim();

      value = value.replace(/^@+/, "").trim();
      if ((value.startsWith("`") && value.endsWith("`")) || (value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1).trim();
      }
      value = value.replace(/[.,;:!?，。；：！？]+$/g, "").trim();
      return looksLikeFilePath(value) ? value : "";
    }

    function extractClickedPath(element) {
      if (!element) return "";
      // 1. If inside a card with aria-describedby pointing to hidden path description, prefer that full path
      const describedBy = element.getAttribute("aria-describedby");
      if (describedBy && typeof document !== "undefined") {
        const descEl = document.getElementById(describedBy);
        if (descEl && descEl.textContent) {
          const p = normalizeClickedPath(descEl.textContent);
          if (p) return p;
        }
      }
      // 2. If element itself or ancestor card has hidden path description
      const parentCard = element.closest ? element.closest("[data-changed-files], [data-presented-file]") : null;
      if (parentCard && typeof document !== "undefined") {
        const hiddenPathSpan = parentCard.querySelector("span[hidden]");
        if (hiddenPathSpan && hiddenPathSpan.textContent) {
          const p = normalizeClickedPath(hiddenPathSpan.textContent);
          if (p) return p;
        }
        // In single file card, title attribute on cardPreview button has resolved full path
        const cardPreviewBtn = parentCard.querySelector("button[title]");
        if (cardPreviewBtn && cardPreviewBtn.title) {
          const p = normalizeClickedPath(cardPreviewBtn.title);
          if (p) return p;
        }
      }

      // 3. The Host's native open control carries no path of its own: its label
      //    is the action ("Open", "Open in …"), never the file. The path is
      //    published by the surrounding row in a hidden description span, so
      //    walk up a few levels and take the first span that holds a path. The
      //    walk is bounded and every candidate still has to pass the path
      //    shape check, so a miss falls through to the Host rather than opening
      //    the wrong file.
      if (element.closest && element.closest("[data-open-path-open]")) {
        let scope = element.parentElement;
        for (let depth = 0; scope && depth < 4; depth += 1) {
          const hiddenPath = scope.querySelector ? scope.querySelector("span[hidden]") : null;
          if (hiddenPath && hiddenPath.textContent) {
            const p = normalizeClickedPath(hiddenPath.textContent);
            if (p) return p;
          }
          scope = scope.parentElement;
        }
      }

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
      if (element.hasAttribute("data-file-path") || element.hasAttribute("data-path")) return true;
      // The Desktop Host answers `canOpenWorkspacePath` with true, so the shell
      // mounts its native "open in application" button beside every file path
      // (the changes card included). That button sits above the path control and
      // takes the click, so it has to count as a file control or the viewer
      // never sees the gesture. The `-more` chevron is a menu of applications,
      // not a plain open, so it is deliberately left to the Host.
      if (element.closest("[data-open-path-open]")) return true;
      if (element.closest("[data-produced-files-row]")) return true;
      // Support deliverables: changed files card (ChangedFiles) and presented file cards (PresentedFileCard)
      if (element.closest("[data-changed-files], [data-presented-file], [data-presented-files-row]")) return true;
      const cls = typeof element.className === "string" ? element.className : "";
      if (cls.includes("fileMention") || cls.includes("file-mention")) return true;
      if (cls.includes("fileLink") || cls.includes("file-link")) return true;
      if (cls.includes("cardPreview") || cls.includes("previewCard")) return true;
      if (element.getAttribute("data-role") === "file-mention") return true;
      return false;
    }

    function isFileMentionCode(element) {
      if (!element) return false;
      const codeEl = element.tagName === "CODE" ? element : (element.closest ? element.closest("code") : null);
      if (!codeEl) return false;
      // Code blocks (<pre><code>) are never file mentions
      if (codeEl.closest && codeEl.closest("pre")) return false;
      const text = (codeEl.textContent || "").trim();
      // Intentional file references starting with @ (e.g. @src/index.ts) or home-anchored path (~/foo/bar.txt)
      const isExplicitPath = text.startsWith("@") || text === "~" || text.startsWith("~/") || text.startsWith("~\\");
      return isExplicitPath && looksLikeFilePath(text);
    }

    function setupGlobalFileClickInterceptor(openStore, sessionStore) {
      if (typeof document === "undefined") return;
      document.addEventListener("click", (event) => {
        // 1. If text is currently selected (user is dragging/highlighting to copy), never intercept
        const sel = typeof window !== "undefined" && window.getSelection ? window.getSelection()?.toString()?.trim() : "";
        if (sel) return;

        const target = event.target;
        if (!target || typeof target.closest !== "function") return;

        // 2. Ignore clicks inside file-viewer drawer, modals, context menus, floating entries
        if (target.closest(".fv-shell") || target.closest(".fv-float-entry") || target.closest(".fv-context-menu") || target.closest(".fv-scrim") || target.closest(".fv-modal-scrim")) return;

        // 3. Ignore if inside code blocks (<pre>) or input fields
        if (target.closest("pre, textarea, input, select")) return;

        // 4. Must be an intentional file control or explicit @file mention
        const isControl = isFileOpenControl(target) || isFileOpenControl(target.closest("button, [role='button'], a"));
        const isMention = isFileMentionCode(target);

        if (!isControl && !isMention) return;

        const el = target.closest("button, [role='button'], a, code") || target;
        const path = extractClickedPath(el);
        if (!path || !looksLikeFilePath(path)) return;

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
     * The directory part of a root-relative path, or "" at the top level.
     *
     * Used as the secondary line on a tab: two open files with the same name
     * from different folders would otherwise be indistinguishable.
     * @param {string} path - root-relative path.
     * @returns {string} its directory, without a trailing separator.
     */
    function directoryOf(path) {
      const trimmed = String(path || "").replace(/[\\/]+$/, "");
      const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
      return cut <= 0 ? "" : trimmed.slice(0, cut);
    }

    /**
     * The headings a Markdown document declares, in document order.
     *
     * Read from the SOURCE rather than from the rendered DOM: the renderer's
     * node shapes are the host's business and can change, while the ATX heading
     * syntax is fixed by CommonMark. The outline therefore stays correct even if
     * the primitives package swaps its renderer.
     *
     * ATX headings only (`# Title`). Setext headings (`Title` underlined with
     * `===` / `---`) are not recognised, which mirrors what the outline can
     * usefully show — a document using them mixes styles and the extra rules
     * would risk mis-reading a table separator as a heading.
     *
     * Fenced code blocks are skipped: a `# comment` inside a shell snippet is
     * not a section, and listing it would scroll the reader into a code block.
     *
     * @param {string} text - the Markdown source.
     * @returns {Array<{level: number, text: string, line: number, key: string}>}
     *   headings from `level` 1..6, in order, with their 0-based source line.
     */
    function parseHeadings(text) {
      const source = typeof text === "string" ? text : "";
      if (source === "") return [];
      const headings = [];
      const lines = source.split(/\r?\n/);
      // Fence tracking: ``` or ~~~ toggles; a closing fence must use the same
      // character and be at least as long as the opener (CommonMark).
      let fence = null;
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
        if (fenceMatch !== null) {
          const marker = fenceMatch[1];
          if (fence === null) fence = marker;
          else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
          continue;
        }
        if (fence !== null) continue;
        // A heading is at most three leading spaces, then 1..6 #, then a space
        // or end of line. `#nospace` is not a heading.
        const match = /^\s{0,3}(#{1,6})(?:\s+|$)(.*)$/.exec(line);
        if (match === null) continue;
        const level = match[1].length;
        // Strip the optional closing sequence (`## Title ##`) and inline
        // markers that add nothing to a navigation label.
        let label = match[2].replace(/\s+#+\s*$/, "").trim();
        label = label
          .replace(/`([^`]*)`/g, "$1")
          .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
          .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
          .trim();
        if (label === "") continue;
        headings.push({ level, text: label, line: index, key: index + "\u0000" + label });
      }
      return headings;
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

    /**
     * Insert a file reference at a specific character offset (caret position) in the text,
     * ensuring words are properly separated without destroying existing text.
     */
    function insertMentionAtCaret(currentText, displayPath, caretIndex) {
      const path = typeof displayPath === "string" ? displayPath.trim() : "";
      if (path === "") return typeof currentText === "string" ? currentText : "";

      const quoted = /[\s`]/.test(path) ? "`" + path.replace(/`/g, "") + "`" : path;
      const reference = "@" + quoted;
      const current = typeof currentText === "string" ? currentText : "";
      if (current === "") return reference + " ";

      const idx = typeof caretIndex === "number" && Number.isFinite(caretIndex)
        ? Math.max(0, Math.min(current.length, Math.round(caretIndex)))
        : current.length;

      const before = current.slice(0, idx);
      const after = current.slice(idx);
      const needPreSpace = before.length > 0 && !/\s$/.test(before);
      const needPostSpace = after.length === 0 || !/^\s/.test(after);
      return before + (needPreSpace ? " " : "") + reference + (needPostSpace ? " " : "") + after;
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
      "outside-root": "该路径超出安全访问路径或工作区范围，已拒绝访问。",
      "not-found": "文件或目录不存在。",
      "not-a-directory": "该路径不是目录。",
      "is-a-directory": "该路径是目录。",
      "too-large": "文件超过查看器大小上限。",
      "read-failed": "读取失败，可能没有访问权限。",
      "not-text": "该文件不是 UTF-8 文本（可能是其他编码或二进制内容），查看器无法显示。",
      "unsupported": "宿主端缺少解析该格式所需的依赖。",
      // Git panel. These mirror the host's codes exactly; an unknown code falls
      // back to the host's own message, which is written for an operator and is
      // therefore less specific than these.
      "not-a-git-repo": "当前根目录及其子目录都不是 Git 仓库。",
      "unknown-repository": "请求的仓库不在当前根目录内。",
      "invalid-branch": "分支名不合法。",
      "unknown-branch": "该分支不存在。",
      "invalid-commit": "提交标识不合法。",
      "unknown-commit": "找不到该提交。",
      "git-dirty": "工作区有未提交的改动，无法切换分支。",
      "git-failed": "Git 命令执行失败。",
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

    /** Commits per page; the host clamps anything larger to its own ceiling. */
    const GIT_PAGE_SIZE = 30;

    /** Date part of an ISO timestamp, which is all a history row needs. */
    function formatCommitDate(value) {
      const text = typeof value === "string" ? value : "";
      return text.length >= 10 ? text.slice(0, 10) : text;
    }

    /** Date and minute of an ISO timestamp, for the commit detail header. */
    function formatCommitTimestamp(value) {
      const text = typeof value === "string" ? value : "";
      return text.length >= 16 ? text.slice(0, 16).replace("T", " ") : text;
    }

    /**
     * State and requests for the Git panel.
     *
     * Deliberately one controller rather than state spread across the drawer:
     * the sidebar (repository, branch, paged history) and the main pane (one
     * commit's changed files) read the same snapshot, and a checkout has to
     * invalidate both at once. A generation counter makes the newest request
     * win, so a slow answer can never overwrite a newer branch's history.
     */
    function createGitController(request) {
      const store = createStore({
        root: "",
        repos: [], reposStatus: "idle", reposError: null, truncated: false,
        repoId: "",
        branches: [], current: "", detached: false, scope: "root",
        branch: "",
        commits: [], commitsStatus: "idle", commitsError: null,
        total: 0, hasMore: false,
        detail: null, detailStatus: "idle", detailError: null,
        // One commit's complete patch, keyed by the commit it belongs to.
        commitDiff: null, commitDiffStatus: "idle", commitDiffError: null,
        // The working tree's pending changes, grouped like a source-control view.
        changes: null, changesStatus: "idle", changesError: null,
        busy: false, notice: "",
      });

      // Two counters, because the list and the detail are independent
      // requests: sharing one made a detail read cancel an in-flight page,
      // which left the pager stuck on "loading more" with its button disabled.
      let listGeneration = 0;
      let detailGeneration = 0;
      // The commit diff and the workspace change list are separate reads again:
      // opening the diff must not cancel a page load, and refreshing the working
      // tree must not cancel the diff being read.
      let diffGeneration = 0;
      let changesGeneration = 0;

      const patch = (next) => {
        store.set({ ...store.get(), ...next });
      };

      const activeRepo = () => {
        const state = store.get();
        return state.repos.find((repo) => repo.id === state.repoId) || state.repos[0] || null;
      };

      /** Drop every cached answer; profile changes make all of them stale. */
      const reset = (root) => {
        listGeneration += 1;
        detailGeneration += 1;
        store.set({
          root: typeof root === "string" ? root : "",
          repos: [], reposStatus: "idle", reposError: null, truncated: false, repoId: "",
          branches: [], current: "", detached: false, scope: "root", branch: "",
          commits: [], commitsStatus: "idle", commitsError: null, total: 0, hasMore: false,
          detail: null, detailStatus: "idle", detailError: null,
          commitDiff: null, commitDiffStatus: "idle", commitDiffError: null,
          changes: null, changesStatus: "idle", changesError: null,
          busy: false, notice: "",
        });
      };

      /**
       * Read one page of history and append or replace the list.
       * @param {string} branch - branch to page, or "" for the checked-out HEAD.
       * @param {number} offset - commits to skip.
       */
      const loadCommits = (branch, offset) => {
        const repo = activeRepo();
        if (repo === null) return Promise.resolve();
        const root = store.get().root;
        const ticket = ++listGeneration;
        patch({ commitsStatus: offset > 0 ? "more" : "loading", commitsError: null });
        return request("gitCommits", {
          root,
          repo: repo.id,
          ...(branch === "" ? {} : { branch }),
          offset,
          limit: GIT_PAGE_SIZE,
        }).then((value) => {
          if (ticket !== listGeneration) return;
          const page = Array.isArray(value?.commits) ? value.commits : [];
          const previousRows = offset > 0 ? store.get().commits : [];
          patch({
            commits: previousRows.concat(page),
            commitsStatus: "ready",
            commitsError: null,
            total: Number.isFinite(Number(value?.total)) ? Number(value.total) : previousRows.length + page.length,
            hasMore: Boolean(value?.hasMore),
            branch: typeof value?.branch === "string" ? value.branch : branch,
          });
        }).catch((problem) => {
          if (ticket !== listGeneration) return;
          patch({ commitsStatus: "error", commitsError: problem });
        });
      };

      /**
       * Re-discover the repositories under the current root and page history.
       *
       * `keepBranch` names the branch to come back to. A refresh passes the one
       * being browsed, so it does not silently jump to the checked-out branch;
       * a checkout passes the branch it just switched to, so the panel lands
       * where the reader asked to go.
       * @param {string} [keepBranch] - branch to select after the reload.
       */
      const loadRepos = (keepBranch) => {
        const root = store.get().root;
        const before = store.get();
        const keptBranch = typeof keepBranch === "string" && keepBranch !== ""
          ? keepBranch
          : (typeof before.branch === "string" && before.branch !== "" ? before.branch : "");
        const ticket = ++listGeneration;
        patch({ reposStatus: "loading", reposError: null, notice: "", detail: null, detailStatus: "idle" });
        return request("gitRepos", { root }).then((value) => {
          if (ticket !== listGeneration) return;
          const repos = Array.isArray(value?.repos) ? value.repos : [];
          const truncated = value?.truncated === true;
          if (repos.length === 0) {
            patch({
              repos: [], reposStatus: "empty", reposError: null, truncated, repoId: "",
              branches: [], current: "", detached: false, scope: "root", branch: "",
              commits: [], commitsStatus: "idle", total: 0, hasMore: false,
            });
            return;
          }
          // Keep the repository the reader already selected when it is still
          // present, so a refresh does not jump back to the first checkout.
          const preferred = store.get().repoId;
          const repo = repos.find((row) => row.id === preferred) || repos[0];
          const branches = Array.isArray(repo.branches) ? repo.branches : [];
          // The checked-out branch is a *short* name from git, while the list
          // is keyed by full ref; resolve it so the select has a real value.
          const checkedOut = typeof repo.current === "string" && repo.current !== ""
            ? (branches.find((row) => row.kind === "local" && row.shortName === repo.current) || null)
            : null;
          const current = checkedOut === null ? "" : checkedOut.name;
          // The kept branch only survives if it still exists here; otherwise
          // fall back to the checked-out one so the select always has a value.
          const branch = keptBranch !== "" && branches.some((row) => row.name === keptBranch)
            ? keptBranch
            : current;
          patch({
            repos,
            reposStatus: "ready",
            reposError: null,
            truncated,
            remotes: Array.isArray(repo.remotes) ? repo.remotes : [],
            repoId: repo.id,
            branches,
            // Full ref of the checked-out branch, plus what the reader sees.
            current,
            currentShort: typeof repo.current === "string" ? repo.current : "",
            detached: Boolean(repo.detached),
            scope: repo.scope === "parent" ? "parent" : "root",
            branch,
            commits: [],
            commitsStatus: "idle",
            commitsError: null,
            total: 0,
            hasMore: false,
          });
          // Returned so a caller that awaits loadRepos also observes the first
          // page of history, which is what makes the panel testable end to end.
          return loadCommits(store.get().branch, 0);
        }).catch((problem) => {
          if (ticket !== listGeneration) return;
          patch({ repos: [], reposStatus: "error", reposError: problem, truncated: false });
        });
      };

      /** Load on first use, and retry after a failed load. */
      const ensure = () => {
        const status = store.get().reposStatus;
        if (status === "idle" || status === "error") return loadRepos();
        return Promise.resolve();
      };

      /** Switch which repository the panel describes (kept across reloads). */
      const pickRepo = (repoId) => {
        const repo = store.get().repos.find((row) => row.id === repoId);
        if (repo === undefined) return Promise.resolve();
        detailGeneration += 1;
        diffGeneration += 1;
        changesGeneration += 1;
        const repoBranches = Array.isArray(repo.branches) ? repo.branches : [];
        const checkedOut = typeof repo.current === "string" && repo.current !== ""
          ? (repoBranches.find((row) => row.kind === "local" && row.shortName === repo.current) || null)
          : null;
        patch({
          repoId: repo.id,
          remotes: Array.isArray(repo.remotes) ? repo.remotes : [],
          branches: repoBranches,
          current: checkedOut === null ? "" : checkedOut.name,
          currentShort: typeof repo.current === "string" ? repo.current : "",
          detached: Boolean(repo.detached),
          scope: repo.scope === "parent" ? "parent" : "root",
          branch: checkedOut === null ? "" : checkedOut.name,
          changes: null, changesStatus: "idle",
          commitDiff: null, commitDiffStatus: "idle",
          commits: [],
          commitsStatus: "idle",
          total: 0,
          hasMore: false,
          detail: null,
          detailStatus: "idle",
          notice: "",
        });
        return loadCommits(store.get().branch, 0);
      };

      /** Read another branch's history without touching the working tree. */
      const pickBranch = (branch) => {
        if (typeof branch !== "string" || branch === "") return Promise.resolve();
        // The commit pane belongs to the branch that was on screen, so it is
        // dropped rather than left describing history the reader just left.
        detailGeneration += 1;
        diffGeneration += 1;
        patch({
          branch,
          commits: [], commitsStatus: "idle", total: 0, hasMore: false,
          detail: null, detailStatus: "idle",
          commitDiff: null, commitDiffStatus: "idle",
          notice: "",
        });
        return loadCommits(branch, 0);
      };

      /**
       * Check the selected branch out, then re-read the whole panel.
       *
       * A checkout whose repository lives above the root is sent only with
       * explicit consent: `allowOutsideRoot` is what the confirmation the
       * reader just accepted means on the wire.
       */
      const checkout = (branch, allowOutsideRoot) => {
        const repo = activeRepo();
        const state = store.get();
        if (repo === null || state.busy || typeof branch !== "string" || branch === "") return Promise.resolve();
        patch({ busy: true, notice: "" });
        const payload = { root: state.root, repo: repo.id, branch };
        if (allowOutsideRoot === true) payload.allowOutsideRoot = true;
        return request("gitCheckout", payload).then((value) => {
          const notice = value && value.changed === false ? "已在该分支上" : "已切换到 " + branch;
          // Set after the reload: loadRepos clears the notice on purpose, since
          // a stale message about a previous action would outlive it.
          // Land on the branch that was just checked out: `loadRepos` would
          // otherwise restore the branch the reader had been browsing.
          return loadRepos(branch).then(() => patch({ busy: false, notice }));
        }).catch((problem) => {
          const code = problem && problem.code;
          patch({
            busy: false,
            notice: code === "git-dirty"
              ? "工作区有未提交的改动，无法切换分支"
              : code === "checkout-outside-root"
                ? "该仓库位于根目录的上级，检出会影响根目录以外的文件"
                : (problem && problem.message) || "切换分支失败",
          });
        });
      };

      /** Read one commit's metadata and changed files. */
      const openCommit = (sha) => {
        const repo = activeRepo();
        const state = store.get();
        if (repo === null || typeof sha !== "string" || sha === "") return Promise.resolve();
        // A detail read is independent of the list: bumping the shared counter
        // here used to cancel an in-flight page and strand the pager.
        const ticket = ++detailGeneration;
        // The diff belongs to the commit that was on screen; a new selection
        // invalidates it before it can be shown under the wrong header.
        diffGeneration += 1;
        patch({ detailStatus: "loading", detail: null, detailError: null, commitDiff: null, commitDiffStatus: "idle" });
        return request("gitCommitFiles", { root: state.root, repo: repo.id, sha }).then((value) => {
          if (ticket !== detailGeneration) return;
          patch({ detailStatus: "ready", detail: value, detailError: null });
        }).catch((problem) => {
          if (ticket !== detailGeneration) return;
          patch({ detailStatus: "error", detail: null, detailError: problem });
        });
      };

      /**
       * Read the working tree's pending changes.
       *
       * Called when the Git tab opens and after a checkout, because both are
       * moments where "what is uncommitted" can have changed underneath the
       * reader.
       */
      const loadChanges = () => {
        const repo = activeRepo();
        if (repo === null) return Promise.resolve();
        const root = store.get().root;
        const ticket = ++changesGeneration;
        patch({ changesStatus: "loading", changesError: null });
        return request("gitStatusChanges", { root, repo: repo.id }).then((value) => {
          if (ticket !== changesGeneration) return;
          patch({ changes: value, changesStatus: "ready", changesError: null });
        }).catch((problem) => {
          if (ticket !== changesGeneration) return;
          // A repository that cannot report status is not an empty one; the
          // message explains rather than showing "no changes".
          patch({ changes: null, changesStatus: "error", changesError: problem });
        });
      };

      /**
       * Read one commit's complete patch.
       * @param {string} sha - the commit to read.
       */
      const loadCommitDiff = (sha) => {
        const repo = activeRepo();
        if (repo === null || typeof sha !== "string" || sha === "") return Promise.resolve();
        const root = store.get().root;
        const ticket = ++diffGeneration;
        patch({ commitDiffStatus: "loading", commitDiff: null, commitDiffError: null });
        return request("gitCommitDiff", { root, repo: repo.id, sha }).then((value) => {
          if (ticket !== diffGeneration) return;
          patch({ commitDiffStatus: "ready", commitDiff: value, commitDiffError: null });
        }).catch((problem) => {
          if (ticket !== diffGeneration) return;
          patch({ commitDiffStatus: "error", commitDiff: null, commitDiffError: problem });
        });
      };

      /** Append the next page of history. */
      const loadMore = () => {
        const state = store.get();
        if (!state.hasMore) return Promise.resolve();
        if (state.commitsStatus === "loading" || state.commitsStatus === "more") return Promise.resolve();
        return loadCommits(state.branch, state.commits.length);
      };

      return {
        store, reset, ensure, loadRepos, pickRepo, pickBranch, checkout,
        openCommit, loadMore, loadChanges, loadCommitDiff, activeRepo,
      };
    }

    /**
     * The Git sidebar: repository picker, branch picker and paged history.
     *
     * The branch select only chooses which history is shown; checking a
     * branch out rewrites the working tree, so it stays a separate press.
     * That split is the difference between browsing and mutating, and it is
     * also what makes it safe to switch branches in a hurry on a phone.
     */
    function GitSidebar({ state, width, header, onPickRepo, onPickBranch, onCheckout, onSelectCommit, onLoadMore, onRetry, selectedSha, onSelectChange, onRefreshChanges }) {
      // Every field is read defensively: this is a pure view over a snapshot,
      // and a partially populated one (first paint, a failed load) must render
      // as an empty pane rather than throwing inside the drawer.
      const repos = Array.isArray(state.repos) ? state.repos : [];
      const repo = repos.find((row) => row.id === state.repoId) || repos[0] || null;
      const branches = Array.isArray(state.branches) ? state.branches : [];
      const commits = Array.isArray(state.commits) ? state.commits : [];
      const current = typeof state.current === "string" ? state.current : "";
      const selectedBranch = typeof state.branch === "string" ? state.branch : "";
      // A detached checkout has no branch to preselect; the history shown is
      // HEAD's, which the select describes with its own entry.
      const viewingBranch = selectedBranch !== ""
        ? selectedBranch
        : (state.detached === true ? "" : current);
      const localBranches = branches.filter((branch) => branch.kind !== "remote");
      const remoteBranches = branches.filter((branch) => branch.kind === "remote");
      const selectedEntry = branches.find((branch) => branch.name === viewingBranch) || null;
      // A remote branch is browse-only: checking it out would produce a detached
      // HEAD (or a new local branch) rather than the switch the reader expects.
      const checkoutable = selectedEntry === null || selectedEntry.kind !== "remote";
      const canCheckout = repo !== null && viewingBranch !== "" && viewingBranch !== current
        && checkoutable && state.busy !== true;

      const wrap = (...children) => react.createElement("div", {
        className: "fv-tree fv-git-panel",
        role: "group",
        "aria-label": "Git 面板",
        style: typeof width === "number" ? { width: width + "px" } : undefined,
      }, header, ...children);

      if (state.reposStatus === "loading" || state.reposStatus === "idle") {
        return wrap(react.createElement("div", { className: "fv-git-note" }, "正在读取仓库…"));
      }
      if (state.reposStatus === "error") {
        return wrap(react.createElement("div", { className: "fv-git-note" },
          react.createElement("span", { className: "fv-error" }, messageOf(state.reposError)),
          react.createElement("button", { type: "button", className: "fv-button", onClick: onRetry }, "重试")));
      }
      if (repo === null) {
        return wrap(react.createElement("div", { className: "fv-git-note" },
          react.createElement("span", null, "当前根目录下没有 Git 仓库。"),
          react.createElement("span", null, "如果仓库在子目录里，请在上方切换到包含它们的根目录。")));
      }

      const toolbar = react.createElement("div", { className: "fv-git-toolbar" },
        repos.length > 1
          ? react.createElement("div", { className: "fv-git-row" },
            react.createElement("span", { className: "fv-git-label" }, "仓库"),
            react.createElement("select", {
              className: "fv-select",
              value: repo.id,
              "aria-label": "选择仓库",
              onChange: (event) => onPickRepo(event.target.value),
            }, ...repos.map((row) => react.createElement("option", { key: row.id, value: row.id }, row.name || row.id))))
          : react.createElement("div", { className: "fv-git-current", title: repo.name || repo.id },
            react.createElement(SvgIconBranch, { size: 13 }),
            react.createElement("span", null, repo.name || repo.id)),
        react.createElement("div", { className: "fv-git-row" },
          react.createElement("span", { className: "fv-git-label" }, "分支"),
          branches.length === 0
            ? react.createElement("span", { className: "fv-git-current" }, repo.empty ? "尚无提交" : current || "未知")
            : react.createElement("select", {
              className: "fv-select",
              value: viewingBranch,
              "aria-label": "查看分支",
              onChange: (event) => onPickBranch(event.target.value),
            },
              // A detached HEAD has no branch to preselect; offer it as its
              // own entry so the select can still describe what is shown.
              state.detached === true ? react.createElement("option", { value: "" }, "HEAD（游离）") : null,
              // Local and remote branches are grouped because only the local
              // ones can be checked out; mixing them would invite a click that
              // silently creates a detached HEAD.
              localBranches.length > 0
                ? react.createElement("optgroup", { label: "本地分支" },
                  ...localBranches.map((branch) => react.createElement("option", {
                    key: branch.name,
                    value: branch.name,
                  }, (branch.shortName || branch.name) + (branch.name === current ? "  · 当前" : ""))))
                : null,
              remoteBranches.length > 0
                ? react.createElement("optgroup", { label: "远程分支" },
                  ...remoteBranches.map((branch) => react.createElement("option", {
                    key: branch.name,
                    value: branch.name,
                  }, (branch.shortName || branch.name) + "  · 只读")))
                : null),
          repo !== null && viewingBranch !== "" && viewingBranch !== current
            ? react.createElement("button", {
              type: "button",
              className: "fv-git-checkout",
              disabled: !canCheckout,
              title: checkoutable ? "检出该分支到工作区" : "远程分支只能查看，不能直接检出",
              onClick: () => onCheckout(viewingBranch),
            }, state.busy === true ? "切换中…" : (checkoutable ? "检出" : "只读"))
            : null),
        typeof state.notice === "string" && state.notice !== ""
          ? react.createElement("span", { className: "fv-git-hint", role: "status" }, state.notice)
          : null,
        // Checking a branch out here rewrites the checkout that *contains* the
        // root, which is wider than the directory being browsed. Saying so is
        // the difference between an informed action and a surprise.
        state.scope === "parent"
          ? react.createElement("div", { className: "fv-git-warn" },
            react.createElement("span", null,
              react.createElement("strong", null, "检出范围提醒："),
              "该仓库位于当前根目录的上级，检出分支会一并改写根目录以外的文件。"))
          : null,
        // The discovery budget ran out, so this list may be incomplete.
        state.truncated === true
          ? react.createElement("div", { className: "fv-git-warn" },
            react.createElement("span", null,
              react.createElement("strong", null, "列表可能不完整："),
              "子目录探测已达到上限，未列出的目录里可能还有仓库。"))
          : null);

      // --- Working-tree changes -------------------------------------------
      // Grouped the way a source-control view does: what a commit would capture,
      // what is not staged yet, and what git is not tracking at all.
      const changes = state.changes || null;
      const changeGroup = (title, rows, extra) => {
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return react.createElement("div", { className: "fv-git-change-group" },
          react.createElement("div", { className: "fv-git-section" },
            react.createElement("span", null, title),
            react.createElement("span", { className: "fv-git-count" }, String(rows.length))),
          ...rows.map((row) => react.createElement("button", {
            key: title + "\u0000" + row.path,
            type: "button",
            className: "fv-commit-file",
            title: extra === undefined ? row.path : extra,
            onClick: () => onSelectChange(row),
          },
            react.createElement("span", {
              className: "fv-commit-status",
              "data-tone": row.tone || "mod",
              "aria-label": row.change || "变更",
            }, row.letter || "M"),
            react.createElement("span", { className: "fv-commit-path" }, row.path),
            // Staged and then edited again: the row says so rather than
            // pretending the file is in one state.
            row.partiallyStaged === true
              ? react.createElement("span", { className: "fv-commit-tag" }, "部分暂存")
              : null)));
      };

      let changesBody;
      if (state.changesStatus === "loading" || state.changesStatus === "idle") {
        changesBody = react.createElement("div", { className: "fv-git-hint" }, "正在读取工作区改动…");
      } else if (state.changesStatus === "error") {
        changesBody = react.createElement("div", { className: "fv-git-hint fv-error" }, messageOf(state.changesError));
      } else if (changes === null || changes.total === 0) {
        changesBody = react.createElement("div", { className: "fv-git-hint" }, "工作区没有未提交的改动。");
      } else {
        changesBody = react.createElement(react.Fragment, null,
          changeGroup("冲突", changes.conflicted),
          changeGroup("已暂存", changes.staged),
          changeGroup("未暂存", changes.unstaged),
          changeGroup("未跟踪", changes.untracked),
          changes.outside > 0
            ? react.createElement("div", { className: "fv-git-hint" }, changes.outside + " 个改动在根目录之外")
            : null);
      }

      const changesSection = react.createElement("div", { className: "fv-git-changes" },
        react.createElement("div", { className: "fv-git-section" },
          react.createElement("span", null, "工作区改动"),
          react.createElement("span", { className: "fv-git-count" },
            changes !== null && typeof changes.total === "number" ? String(changes.total) : ""),
          react.createElement("button", {
            type: "button",
            className: "fv-icon-button fv-git-refresh",
            "aria-label": "刷新工作区改动",
            title: "刷新工作区改动",
            onClick: onRefreshChanges,
          }, react.createElement(SvgIconRefresh, { size: 13 }))),
        changesBody);

      const commitRows = commits.map((commit) => react.createElement("button", {
        key: commit.sha,
        type: "button",
        className: "fv-git-commit",
        "aria-current": selectedSha === commit.sha ? "true" : undefined,
        title: commit.subject,
        onClick: () => onSelectCommit(commit),
      },
        react.createElement("span", { className: "fv-git-subject" }, commit.subject || "(无提交信息)"),
        react.createElement("span", { className: "fv-git-meta" },
          react.createElement("span", { className: "fv-git-sha" }, commit.shortSha || commit.sha.slice(0, 7)),
          react.createElement("span", { className: "fv-git-author" }, commit.author || ""),
          react.createElement("span", { className: "fv-git-date" }, formatCommitDate(commit.committedAt || commit.authoredAt)))));

      let listBody;
      if (state.commitsStatus === "loading" || state.commitsStatus === "idle") {
        listBody = react.createElement("div", { className: "fv-git-hint" }, "正在读取提交记录…");
      } else if (state.commitsStatus === "error") {
        listBody = react.createElement("div", { className: "fv-git-hint fv-error" }, messageOf(state.commitsError));
      } else if (commitRows.length === 0) {
        listBody = react.createElement("div", { className: "fv-git-hint" }, repo.empty ? "该仓库还没有提交。" : "该分支没有提交记录。");
      } else {
        listBody = commitRows;
      }

      const shownCount = commits.length;
      // A counter with no number and a button that cannot appear would leave an
      // empty strip under a short history, so the footer exists only when it
      // has something to say.
      const footer = state.total > 0 || state.hasMore
        ? react.createElement("div", null,
          state.total > 0
            ? react.createElement("div", { className: "fv-git-hint" }, `已显示 ${shownCount} / ${state.total}`)
            : null,
          state.hasMore
            ? react.createElement("button", {
              type: "button",
              className: "fv-git-more",
              disabled: state.commitsStatus === "more",
              onClick: onLoadMore,
            }, state.commitsStatus === "more" ? "正在加载…" : "加载更多")
            : null)
        : null;

      return wrap(toolbar,
        changesSection,
        react.createElement("div", { className: "fv-git-section" },
          react.createElement("span", null, "提交记录"),
          react.createElement("span", { className: "fv-git-count" }, state.total > 0 ? String(state.total) : "")),
        react.createElement("div", { className: "fv-git-list" }, listBody),
        footer);
    }

    function DiffView({ diffData, wrap }) {
      const rows = react.useMemo(() => {
        if (Array.isArray(diffData?.rows) && diffData.rows.length > 0) {
          return diffData.rows;
        }
        if (Array.isArray(diffData?.diffs)) {
          const fallback = [];
          let nLine = 1;
          for (const hunk of diffData.diffs) {
            if (hunk.oldText) {
              for (const l of hunk.oldText.split("\n")) {
                fallback.push({ type: "del", oldLine: null, newLine: null, text: l });
              }
            }
            if (hunk.newText) {
              for (const l of hunk.newText.split("\n")) {
                fallback.push({ type: "add", oldLine: null, newLine: nLine++, text: l });
              }
            }
          }
          return fallback;
        }
        return [];
      }, [diffData]);

      const [copied, setCopied] = react.useState(false);

      const onCopy = () => {
        const rawText = rows.map((r) => {
          const prefix = r.type === "add" ? "+" : (r.type === "del" ? "-" : (r.type === "hunk" ? "" : " "));
          return prefix + r.text;
        }).join("\n");
        if (typeof writeClipboard === "function") {
          writeClipboard(rawText).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }
      };

      if (rows.length === 0) {
        if (Array.isArray(diffData?.diffs) && diffData.diffs.length > 0) {
          return react.createElement(DiffBlock, {
            diffs: diffData.diffs,
            labels: DIFF_BLOCK_LABELS,
            maxLines: Infinity,
          });
        }
        return react.createElement("div", { className: "fv-note" }, "暂无改动差异。");
      }

      return react.createElement("div", { className: "fv-diff-view" },
        react.createElement("div", { className: "fv-diff-toolbar" },
          react.createElement("span", { className: "fv-diff-source-tag" },
            diffData?.source === "untracked" ? "未跟踪新文件" : (diffData?.source === "working-tree" ? "工作区未提交改动" : "最新提交改动")),
          react.createElement("div", { style: { flex: "1 1 auto" } }),
          react.createElement("button", {
            type: "button",
            className: "fv-button",
            style: { height: "26px", fontSize: "12px", padding: "0 10px" },
            onClick: onCopy,
          }, copied ? "已复制" : "复制 Diff")),
        react.createElement("div", {
          className: "fv-diff-table",
          "data-wrap": wrap ? "on" : "off",
        },
          rows.map((row, idx) => {
            if (row.type === "hunk") {
              return react.createElement("div", { key: idx, className: "fv-diff-line fv-diff-hunk" },
                react.createElement("span", { className: "fv-diff-num fv-diff-hunk-gutter" }, "⋯"),
                react.createElement("span", { className: "fv-diff-num fv-diff-hunk-gutter fv-diff-num-new" }, "⋯"),
                react.createElement("span", { className: "fv-diff-sign" }),
                react.createElement("span", { className: "fv-diff-text" }, row.text));
            }
            const isAdd = row.type === "add";
            const isDel = row.type === "del";
            const lineCls = "fv-diff-line " + (isAdd ? "fv-diff-add-line" : (isDel ? "fv-diff-del-line" : "fv-diff-ctx-line"));
            return react.createElement("div", { key: idx, className: lineCls },
              react.createElement("span", { className: "fv-diff-num fv-diff-num-old" }, row.oldLine !== null ? String(row.oldLine) : ""),
              react.createElement("span", { className: "fv-diff-num fv-diff-num-new" }, row.newLine !== null ? String(row.newLine) : ""),
              react.createElement("span", { className: "fv-diff-sign" }, isAdd ? "+" : (isDel ? "-" : " ")),
              react.createElement("span", { className: "fv-diff-text" }, row.text || " "));
          })));
    }

        /**
     * The main pane for one working-tree change.
     *
     * Shows the patch rather than the file contents, because that is what the
     * row represents: a deletion has nothing to open, and an untracked file has
     * no before-state to compare against — both still render here.
     *
     * @param {{state: object, path: string}} props - panel snapshot and the file to diff.
     */
    function WorkspaceChangeDetail({ state, path: filePath, request, repo }) {
      const [diff, setDiff] = react.useState({ status: "idle", data: null, error: null });
      // A change can be staged, unstaged, or both. The reader picks which side
      // to look at instead of the pane guessing.
      const [side, setSide] = react.useState("worktree");

      const changes = state.changes || null;
      const row = changes === null
        ? null
        : [...(changes.staged || []), ...(changes.unstaged || []), ...(changes.untracked || []), ...(changes.conflicted || [])]
          .find((candidate) => candidate.path === filePath) || null;
      // A file that is only staged has no working-tree diff and vice versa, so
      // the side follows what the row actually contains.
      const bothSides = row !== null && changes !== null
        && (changes.staged || []).some((candidate) => candidate.path === filePath)
        && (changes.unstaged || []).some((candidate) => candidate.path === filePath);

      const effectiveSide = bothSides
        ? side
        : (changes !== null && (changes.staged || []).some((candidate) => candidate.path === filePath)
          ? "staged"
          : "worktree");

      // The diff is fetched per file and per side: staged and unstaged are two
      // different patches for the same path, and neither is a superset.
      react.useEffect(() => {
        if (typeof filePath !== "string" || filePath === "" || typeof request !== "function") return undefined;
        let live = true;
        setDiff((current) => ({ status: "loading", data: current.data, error: null }));
        request("gitWorkspaceDiff", {
          root: state.root,
          repo,
          path: filePath,
          staged: effectiveSide === "staged",
        }).then((value) => {
          if (live) setDiff({ status: "ready", data: value, error: null });
        }).catch((problem) => {
          if (live) setDiff({ status: "error", data: null, error: problem });
        });
        return () => { live = false; };
      }, [filePath, effectiveSide, repo, request, state.root]);

      const body = diff.status === "error"
        ? react.createElement("div", { className: "fv-note fv-error" }, messageOf(diff.error))
        : diff.status === "ready" && diff.data !== null
          ? (diff.data.hasDiff === true
            ? react.createElement(DiffView, { diffData: diff.data, wrap: false })
            : react.createElement("div", { className: "fv-note" }, "该文件在" + (effectiveSide === "staged" ? "暂存区" : "工作区") + "没有差异。"))
          : react.createElement("div", { className: "fv-note" }, "正在读取改动…");

      return react.createElement("div", { className: "fv-commit" },
        react.createElement("div", { className: "fv-commit-head" },
          react.createElement("span", { className: "fv-commit-subject" }, filePath || "工作区改动"),
          react.createElement("span", { className: "fv-commit-meta" },
            row !== null
              ? react.createElement("span", null, (row.change || "变更") + (row.partiallyStaged === true ? " · 部分暂存" : ""))
              : null,
            react.createElement("span", null, "工作区，未提交"))),
        bothSides
          ? react.createElement("div", { className: "fv-sheet-tabs", role: "tablist" },
            react.createElement("button", {
              type: "button", className: "fv-tab", "aria-selected": effectiveSide === "staged" ? "true" : "false",
              onClick: () => setSide("staged"),
            }, "已暂存"),
            react.createElement("button", {
              type: "button", className: "fv-tab", "aria-selected": effectiveSide === "worktree" ? "true" : "false",
              onClick: () => setSide("worktree"),
            }, "未暂存"))
          : null,
        react.createElement("div", { className: "fv-commit-diff" }, body));
    }

    /**
     * The main pane for one commit: header, message, and changed files.
     *
     * A file row opens the ordinary preview, so the panel never grows a
     * second viewer; a row that lands outside the current root stays visible
     * but disabled rather than silently disappearing.
     */
    function CommitDetail({ state, selectedPath, onSelectFile, view, onSwitchView, onLoadDiff }) {
      if (state.detailStatus === "loading" || state.detailStatus === "idle") {
        return react.createElement("div", { className: "fv-note" }, "正在读取提交详情…");
      }
      if (state.detailStatus === "error") {
        return react.createElement("div", { className: "fv-note fv-error" }, messageOf(state.detailError));
      }
      const detail = state.detail;
      if (detail === null || detail === undefined || detail.commit === undefined) {
        return react.createElement("div", { className: "fv-note" }, "未选择提交。");
      }
      const commit = detail.commit;
      const files = Array.isArray(detail.files) ? detail.files : [];
      const author = typeof commit.author === "string" ? commit.author : "";
      const authorEmail = typeof commit.authorEmail === "string" ? commit.authorEmail : "";
      const message = typeof commit.body === "string" ? commit.body : "";
      const extraMessage = message !== "" && message !== commit.subject ? message : "";

      const fileRows = files.length === 0
        ? [react.createElement("div", { key: "__none", className: "fv-git-hint" }, "该提交没有文件改动。")]
        : files.map((file) => {
          const renamed = typeof file.oldPath === "string" && file.oldPath !== "" && file.oldPath !== file.path;
          const shown = renamed ? file.oldPath + " → " + file.path : file.path;
          return react.createElement("button", {
            key: (file.oldPath || "") + "\u0000" + file.path,
            type: "button",
            className: "fv-commit-file",
            "aria-current": selectedPath !== "" && selectedPath === file.path ? "true" : undefined,
            title: file.outsideRoot ? "该文件在当前根目录之外，无法在这里打开" : shown,
            disabled: file.outsideRoot === true,
            onClick: () => { if (file.outsideRoot !== true) onSelectFile(file); },
          },
            react.createElement("span", {
              className: "fv-commit-status",
              "data-tone": file.tone || "mod",
              "aria-label": file.change || "变更",
            }, file.letter || "?"),
            react.createElement("span", { className: "fv-commit-path" }, shown),
            file.outsideRoot === true
              ? react.createElement("span", { className: "fv-commit-tag" }, "根目录外")
              : null);
        });

      // Two views of one commit: which files changed, and what changed inside
      // them. Both come from the same revision pair, so they cannot disagree.
      const tabs = react.createElement("div", { className: "fv-sheet-tabs", role: "tablist" },
        react.createElement("button", {
          type: "button", className: "fv-tab", "aria-selected": view !== "diff" ? "true" : "false",
          onClick: () => onSwitchView("files"),
        }, "变更文件", react.createElement("span", { className: "fv-git-count" }, String(files.length))),
        react.createElement("button", {
          type: "button", className: "fv-tab fv-tab-diff", "aria-selected": view === "diff" ? "true" : "false",
          onClick: () => {
            onSwitchView("diff");
            if (onLoadDiff !== undefined) onLoadDiff();
          },
        }, "改动内容",
          state.commitDiff !== null && state.commitDiff !== undefined && state.commitDiff.summary !== undefined
            ? react.createElement("span", { className: "fv-diff-stat" },
              state.commitDiff.summary.added > 0
                ? react.createElement("span", { className: "fv-diff-add" }, "+" + state.commitDiff.summary.added)
                : null,
              state.commitDiff.summary.added > 0 && state.commitDiff.summary.removed > 0 ? " " : "",
              state.commitDiff.summary.removed > 0
                ? react.createElement("span", { className: "fv-diff-del" }, "-" + state.commitDiff.summary.removed)
                : null)
            : null));

      let patchBody;
      if (state.commitDiffStatus === "loading" || state.commitDiffStatus === "idle") {
        patchBody = react.createElement("div", { className: "fv-note" }, "正在读取改动内容…");
      } else if (state.commitDiffStatus === "error") {
        patchBody = react.createElement("div", { className: "fv-note fv-error" }, messageOf(state.commitDiffError));
      } else {
        const diff = state.commitDiff;
        const diffFiles = diff !== null && diff !== undefined && Array.isArray(diff.files) ? diff.files : [];
        if (diffFiles.length === 0) {
          patchBody = react.createElement("div", { className: "fv-note" }, "该提交没有可显示的文本改动。");
        } else {
          patchBody = react.createElement("div", { className: "fv-commit-diff" },
            ...diffFiles.map((file, index) => react.createElement("div", {
              key: file.path + "\u0000" + index,
              className: "fv-commit-diff-file",
            },
              react.createElement("div", { className: "fv-git-section" },
                react.createElement("span", { className: "fv-commit-status", "data-tone": file.tone || "mod" }, file.letter || "M"),
                react.createElement("span", { className: "fv-commit-path" },
                  file.oldPath !== null && file.oldPath !== file.path
                    ? file.oldPath + " → " + file.path
                    : file.path),
                react.createElement("span", { className: "fv-git-count" },
                  "+" + (file.added || 0) + " -" + (file.removed || 0))),
              // Reuses the existing diff renderer, so a commit's patch and a
              // working-tree diff look and behave the same way.
              react.createElement(DiffView, { diffData: { rows: file.rows, diffs: [] }, wrap: false }))));
        }
      }

      return react.createElement("div", { className: "fv-commit" },
        react.createElement("div", { className: "fv-commit-head" },
          react.createElement("span", { className: "fv-commit-subject" }, commit.subject || "(无提交信息)"),
          react.createElement("span", { className: "fv-commit-meta" },
            react.createElement("span", { className: "fv-commit-sha" }, commit.sha || ""),
            author !== ""
              ? react.createElement("span", null, author + (authorEmail !== "" ? " <" + authorEmail + ">" : ""))
              : null,
            react.createElement("span", null, formatCommitTimestamp(commit.committedAt || commit.authoredAt)))),
        extraMessage === "" ? null : react.createElement("div", { className: "fv-commit-body" }, extraMessage),
        tabs,
        view === "diff"
          ? patchBody
          : react.createElement("div", { className: "fv-commit-files" }, ...fileRows));
    }

        /** Decode base64 into a Blob without a data: URL round-trip. */
    function blobOf(base64, mediaType) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return new Blob([bytes], mediaType ? { type: mediaType } : undefined);
    }

    /**
     * Classify a path the way the host's `kindOf` does.
     *
     * The bundle is one hand-written file and cannot import `lib/core.js`, and
     * a file opened from a commit has no on-disk metadata to ask about, so the
     * name alone has to decide which previewer to mount.
     * @param {string} path - a file path.
     * @returns {string} the kind the viewer switches on.
     */
    function kindOfPath(path) {
      const base = baseNameOf(path).toLowerCase();
      const dot = base.lastIndexOf(".");
      const ext = dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
      if (ext === "md" || ext === "markdown" || ext === "mdx") return "markdown";
      if (ext === "json" || ext === "jsonc" || ext === "json5") return "json";
      if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "gif" || ext === "webp"
        || ext === "avif" || ext === "bmp" || ext === "ico" || ext === "svg") return "image";
      if (ext === "pdf") return "pdf";
      if (ext === "xlsx" || ext === "xlsm" || ext === "xls") return "sheet";
      if (ext === "docx" || ext === "doc") return "doc";
      return "text";
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

    /**
     * Trigger browser file download from a Blob or URL using an ephemeral anchor tag.
     */
    function triggerDownload(target, filename) {
      const currentWin = typeof globalThis !== "undefined" && globalThis.window ? globalThis.window : (typeof window !== "undefined" ? window : null);
      const currentDoc = typeof globalThis !== "undefined" && globalThis.document ? globalThis.document : (typeof document !== "undefined" ? document : null);
      if (!currentWin || !currentDoc) return false;
      try {
        const isBlob = typeof Blob !== "undefined" && target instanceof Blob;
        const url = isBlob ? (currentWin.URL?.createObjectURL?.(target) || URL.createObjectURL(target)) : String(target);
        const anchor = currentDoc.createElement("a");
        anchor.href = url;
        anchor.download = filename || "download";
        anchor.style.display = "none";
        currentDoc.body.appendChild(anchor);
        anchor.click();
        currentDoc.body.removeChild(anchor);
        if (isBlob) {
          const timer = setTimeout(() => {
            try { (currentWin.URL?.revokeObjectURL || URL.revokeObjectURL)(url); } catch (_) {}
          }, 60000);
          if (typeof timer?.unref === "function") timer.unref();
        }
        return true;
      } catch (_) {
        return false;
      }
    }

    /**
     * Whether this page runs inside the Desktop (Electron) shell.
     *
     * The Desktop host ships this same UI inside Electron, where `<a download>`
     * has no download panel to report progress in: the shell saves to a default
     * folder or opens its own dialog, and a 100 MB transfer gives the user no
     * feedback while it runs. A real browser owns progress, pause, resume and
     * the save location, so handing it the URL is strictly better there than
     * buffering the bytes in the page.
     *
     * Electron identifies itself in the UA (and in `process.versions`). A wrong
     * answer only changes which transfer strategy runs, never which files may
     * be read, so the probe stays cheap and silent.
     * @param {any} win - the window to inspect.
     * @returns {boolean} true when the page is the Desktop shell.
     */
    function isDesktopShell(win) {
      try {
        if (/Electron\//i.test(String(win?.navigator?.userAgent ?? ""))) return true;
        const versions = win?.process?.versions;
        return typeof versions?.electron === "string";
      } catch (_) {
        return false;
      }
    }

    /**
     * Download one file, choosing the transfer that fits the host shell.
     *
     * Two strategies, because the two shells have opposite needs:
     *   - a browser has a download manager that owns progress, pause, resume
     *     and the save location, so the authenticated URL is handed straight
     *     to it — a HEAD probe first turns "413" and "404" into an immediate
     *     notice instead of a failed download entry;
     *   - the Desktop shell has no such panel, so the bytes stream through
     *     `fetch` with a real-time percentage, then reach the save flow as a
     *     blob. That path keeps the page responsive and is the only one that
     *     can show progress inside the drawer.
     * Both fall back to the RPC `bytes` method when the streaming route is
     * unavailable, so an older host or a blocked route still downloads.
     * @param {(method: string, payload: object) => Promise<any>} requestFn - RPC caller.
     * @param {string} root - root id the file belongs to.
     * @param {string} path - path relative to that root.
     * @param {string} [name] - display name to save under.
     * @param {(message: string) => void} [onToast] - progress and result sink.
     * @returns {Promise<boolean>} whether a download was started.
     */
    async function performDownload(requestFn, root, path, name, onToast) {
      if (!root || !path) {
        if (onToast) onToast("未指定下载文件路径");
        return false;
      }
      const filename = name || baseNameOf(path);
      const currentWin = typeof globalThis !== "undefined" && globalThis.window ? globalThis.window : (typeof window !== "undefined" ? window : null);
      const currentDoc = typeof globalThis !== "undefined" && globalThis.document ? globalThis.document : (typeof document !== "undefined" ? document : null);

      if (currentWin && currentDoc && currentWin.location && currentWin.location.origin) {
        const downloadUrl = `/api/file-viewer/download?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}&filename=${encodeURIComponent(filename)}`;
        const canFetch = typeof currentWin.fetch === "function";

        // 浏览器：把鉴权后的 URL 直接交给原生下载管理器（进度、暂停、续传、保存位置都由它负责）
        if (canFetch && !isDesktopShell(currentWin)) {
          try {
            const head = await currentWin.fetch(downloadUrl, { method: "HEAD", credentials: "same-origin" });
            if (head.status === 413) {
              if (onToast) onToast("文件超过下载限制（上限 100MB）");
              return false;
            }
            if (!head.ok) throw new Error(`HTTP ${head.status}`);
          } catch (_) {
            // A failed probe is not a failed download: the browser still owns
            // the request and reports its own outcome.
          }
          const handed = triggerDownload(downloadUrl, filename);
          if (handed) {
            if (onToast) onToast(`已交由浏览器下载 ${filename}`);
            return true;
          }
        }

        // 桌面端（或直链不可用）：流式读取并实时显示百分比进度
        if (canFetch) {
          try {
            if (onToast) onToast(`正在准备下载 ${filename}...`);
            const resp = await currentWin.fetch(downloadUrl, { method: "GET", credentials: "same-origin" });
            if (!resp.ok) {
              if (resp.status === 413) {
                if (onToast) onToast("文件超过下载限制（上限 100MB）");
                return false;
              }
              throw new Error(`HTTP ${resp.status}`);
            }

            const contentLength = Number(resp.headers?.get?.("content-length")) || 0;
            const total = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : 0;

            let blob;
            if (resp.body && typeof resp.body.getReader === "function") {
              const reader = resp.body.getReader();
              const chunks = [];
              let loaded = 0;
              let lastUpdate = 0;

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) {
                  chunks.push(value);
                  loaded += value.byteLength;
                  const now = Date.now();
                  if (now - lastUpdate > 100 || (total > 0 && loaded >= total)) {
                    lastUpdate = now;
                    const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
                    const progressText = total > 0
                      ? `正在下载 ${filename} (${percent}% - ${formatBytes(loaded)} / ${formatBytes(total)})...`
                      : `正在下载 ${filename} (${formatBytes(loaded)})...`;
                    if (onToast) onToast(progressText);
                  }
                }
              }
              const mime = resp.headers?.get?.("content-type") || "application/octet-stream";
              blob = new Blob(chunks, { type: mime });
            } else if (typeof resp.blob === "function") {
              blob = await resp.blob();
            } else {
              blob = new Blob([await resp.arrayBuffer()]);
            }

            const ok = triggerDownload(blob, filename);
            if (onToast) {
              onToast(ok ? `✓ 下载完成 ${filename} (${formatBytes(blob.size)})` : "下载触发失败，请重试");
            }
            return ok;
          } catch (err) {
            if (err?.message?.includes("413") || err?.code === "too-large") {
              if (onToast) onToast("文件超过下载限制（上限 100MB）");
              return false;
            }
            // 流式通道异常时继续尝试直链与 RPC
          }
        }

        // 无 fetch 环境：只能把 URL 交给宿主处理
        const direct = triggerDownload(downloadUrl, filename);
        if (direct) {
          if (onToast) onToast(`已交由浏览器下载 ${filename}`);
          return true;
        }
      }

      if (typeof requestFn !== "function") {
        if (onToast) onToast("未配置有效的下载通道");
        return false;
      }

      if (onToast) onToast(`正在准备下载 ${filename}...`);
      return requestFn("bytes", { root, path })
        .then((res) => {
          if (!res || typeof res.base64 !== "string") {
            throw new Error("服务端未返回有效文件数据");
          }
          const mime = mediaTypeOf(res.path || path) || "application/octet-stream";
          const blob = blobOf(res.base64, mime);
          const ok = triggerDownload(blob, res.name || filename);
          if (onToast) onToast(ok ? `已开始下载 ${res.name || filename}` : "浏览器拦截了下载操作");
          return ok;
        })
        .catch((err) => {
          const msg = err?.code === "too-large"
            ? "文件超过下载限制（上限 100MB）"
            : `下载失败: ${err?.message || "网络异常"}`;
          if (onToast) onToast(msg);
          return false;
        });
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

    /** Render root selector options, grouping safe access paths separately if present. */
    /**
     * The syntax-language picker.
     *
     * A native `<select>` on purpose: it is keyboard- and screen-reader-
     * accessible for free, and on a phone it opens the platform's own
     * picker, which a hand-rolled listbox would only imitate badly.
     *
     * "自动" is always first and is the default. The entry shows how the
     * current language was decided, so a guess is visible as a guess rather
     * than looking like a fact about the file.
     */
    function LanguagePicker({ choice, catalog, source, resolved, onChange }) {
      const options = catalog.length > 0
        ? catalog
        : [{ id: "plain", label: "纯文本" }];
      // How the language was decided, shown beside the control. Only "auto"
      // can be a guess, so only "auto" explains itself.
      const hint = choice !== "auto"
        ? "已指定"
        : source === "content" ? "按内容识别"
          : source === "name" ? "按后缀识别"
            : "未识别";
      return react.createElement("label", { className: "fv-lang" },
        react.createElement("span", { className: "fv-lang-hint", title: "语言识别来源" }, hint),
        react.createElement("select", {
          className: "fv-lang-select",
          value: choice,
          "aria-label": "语法高亮语言",
          title: resolved === undefined ? "语法高亮语言" : `语法高亮：${resolved}`,
          onChange: (event) => onChange(event.target.value),
        },
          react.createElement("option", { value: "auto" }, "自动"),
          options.map((entry) => react.createElement("option", {
            key: entry.id, value: entry.id,
          }, entry.label))));
    }


    function renderRootOptions(roots) {
      const hasSafe = Array.isArray(roots) && roots.some((row) => row.kind === "safe-path");
      if (!hasSafe) {
        return (roots || []).map((row) => react.createElement("option", { key: row.id, value: row.id }, row.label));
      }
      const workspaces = roots.filter((row) => row.kind !== "safe-path");
      const safePaths = roots.filter((row) => row.kind === "safe-path");
      const groups = [];
      if (workspaces.length > 0) {
        groups.push(react.createElement("optgroup", { key: "workspaces", label: "工作区" },
          ...workspaces.map((row) => react.createElement("option", { key: row.id, value: row.id }, row.label))));
      }
      if (safePaths.length > 0) {
        groups.push(react.createElement("optgroup", { key: "safe-paths", label: "安全访问路径" },
          ...safePaths.map((row) => react.createElement("option", { key: row.id, value: row.id }, row.label))));
      }
      return groups;
    }

    /**
     * The items a tab's context menu offers, in order.
     *
     * Exported (through `internals`) rather than inlined so the labels are
     * asserted by the tests instead of drifting from the request that named
     * them: 刷新当前 / 关闭当前 / 关闭其它 / 关闭所有.
     *
     * @type {Array<{key: string, icon: string, label: string}>}
     */
    const TAB_MENU_ITEMS = [
      { key: "refresh", icon: "↻", label: "刷新当前" },
      { key: "close", icon: "×", label: "关闭当前" },
      { key: "others", icon: "⇤", label: "关闭其它" },
      { key: "all", icon: "⊗", label: "关闭所有" },
    ];

    /**
     * Apply closes to a tab list and say which tab is on screen afterwards.
     *
     * Pure so the rule is testable without a renderer, and so the three menu
     * items ("close current / others / all") are one implementation instead of
     * three: they differ only in the set of ids handed to this function.
     *
     * The landing tab is the neighbour on the right of the tab that was on
     * screen, then the one on the left, and finally the first survivor — the
     * order every tabbed editor uses. When nothing survives, the active id
     * becomes the empty string, which is what the pane reads as "no tab".
     *
     * Returns null when the closes would change nothing, so callers can skip a
     * re-render (and so closing an id that is not in the list is a no-op rather
     * than a resurrection).
     *
     * @param {Array<{id: string}>} tabs - the current list.
     * @param {string} activeId - the tab on screen now.
     * @param {Array<string>} ids - tabs to close.
     * @returns {{tabs: Array<object>, activeId: string} | null}
     */
    function tabsAfterClose(tabs, activeId, ids) {
      const current = Array.isArray(tabs) ? tabs : [];
      const doomed = new Set(Array.isArray(ids) ? ids : []);
      if (doomed.size === 0) return null;
      const next = current.filter((tab) => !doomed.has(tab.id));
      if (next.length === current.length) return null;
      if (!doomed.has(activeId) && next.some((tab) => tab.id === activeId)) {
        return { tabs: next, activeId };
      }
      if (next.length === 0) return { tabs: next, activeId: "" };
      // Measured in the OLD list: closing a middle tab must land on its right
      // neighbour, not on whatever ends up at the same index afterwards.
      const index = current.findIndex((tab) => tab.id === activeId);
      const right = current.slice(index + 1).find((tab) => !doomed.has(tab.id));
      const left = current.slice(0, Math.max(0, index)).reverse().find((tab) => !doomed.has(tab.id));
      const landing = right || left || next[0];
      return { tabs: next, activeId: landing.id };
    }

    /**
     * The tab that should be on screen after `activate` is brought forward.
     *
     * Only meaningful for the "reopen an already open file" path: the reader
     * expects the tab to come forward, not to be replaced, and definitely not
     * to be duplicated.
     *
     * @param {Array<object>} tabs - the current list.
     * @param {string} activeId - the tab on screen now.
     * @param {object} draft - the tab to open or update (must carry an `id`).
     * @returns {{tabs: Array<object>, activeId: string}}
     */
    function tabsAfterUpsert(tabs, activeId, draft) {
      const current = Array.isArray(tabs) ? tabs : [];
      const existing = current.find((tab) => tab.id === draft.id);
      if (existing === undefined) {
        return { tabs: current.concat([{ ...draft, origin: draft.origin === undefined ? null : draft.origin }]), activeId: draft.id };
      }
      // Updating in place keeps the tab where it already sits in the strip.
      return { tabs: current.map((tab) => (tab.id === draft.id ? { ...tab, ...draft } : tab)), activeId: draft.id };
    }

    /**
     * The content area's tab strip.
     *
     * One tab per opened file, commit or working-tree change. The strip is a
     * plain horizontal scroller: the drawer is narrow and a wrapping strip
     * would eat the space the preview needs, so overflow scrolls instead.
     *
     * Right-clicking any tab opens the four-item menu the reader asked for
     * (refresh / close / close others / close all); the same menu is reachable
     * from the keyboard via Shift+F10 or the ContextMenu key, because a
     * pointer-only affordance is a defect on a phone.
     *
     * @param {{tabs: Array<object>, activeId: string, onActivate: Function, onClose: Function, onContextMenu: Function, menuFor: string}} props
     */
    function TabStrip({ tabs, activeId, onActivate, onClose, onContextMenu, menuFor }) {
      const rows = Array.isArray(tabs) ? tabs : [];
      if (rows.length === 0) {
        return react.createElement("div", { className: "fv-tabs", role: "tablist", "aria-label": "已打开的文件" },
          react.createElement("span", { className: "fv-tabs-empty" }, "未打开文件"));
      }
      return react.createElement("div", {
        className: "fv-tabs",
        role: "tablist",
        "aria-label": "已打开的文件",
      }, ...rows.map((tab) => {
        const selected = tab.id === activeId;
        // The directory part is a secondary hint: two files with the same
        // name from different folders would otherwise look identical.
        const directory = typeof tab.dir === "string" ? tab.dir : "";
        return react.createElement("div", {
          key: tab.id,
          className: "fv-tab-cell",
          role: "tab",
          "aria-selected": selected ? "true" : "false",
          "data-menu": menuFor === tab.id ? "true" : "false",
          title: tab.path !== "" ? tab.path : tab.title,
          onClick: () => onActivate(tab.id),
          onContextMenu: (event) => {
            event.preventDefault();
            event.stopPropagation();
            onContextMenu({ tabId: tab.id, x: event.clientX, y: event.clientY });
          },
          onKeyDown: (event) => {
            // Shift+F10 and the dedicated ContextMenu key are what a keyboard
            // has instead of a right click.
            if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
              event.preventDefault();
              const box = event.currentTarget.getBoundingClientRect();
              onContextMenu({ tabId: tab.id, x: box.left + 12, y: box.bottom - 4 });
              return;
            }
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onActivate(tab.id);
              return;
            }
            // Arrow keys walk the strip the way a tablist is expected to.
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              const index = rows.findIndex((row) => row.id === tab.id);
              const step = event.key === "ArrowRight" ? 1 : -1;
              const next = rows[(index + step + rows.length) % rows.length];
              if (next !== undefined) onActivate(next.id);
            }
          },
          tabIndex: selected ? 0 : -1,
        },
          react.createElement("button", {
            type: "button",
            className: "fv-tab-label",
            // The tab cell already handles activation; this button exists so
            // the label is a real control for screen readers and touch.
            onClick: (event) => { event.stopPropagation(); onActivate(tab.id); },
            title: tab.path !== "" ? tab.path : tab.title,
          }, tab.title),
          directory !== ""
            ? react.createElement("span", { className: "fv-tab-dir" }, directory)
            : null,
          react.createElement("button", {
            type: "button",
            className: "fv-tab-close",
            "aria-label": "关闭 " + tab.title,
            title: "关闭",
            onClick: (event) => { event.stopPropagation(); onClose(tab.id); },
          }, "×"));
      }));
    }

    /**
     * The four-item menu a tab offers on right click.
     *
     * Deliberately its own component instead of a mode of the file-tree menu:
     * the subjects differ (a tab versus a path), and merging them produced
     * items that made no sense on one of the two.
     *
     * @param {{menu: object, tabs: Array<object>, onClose: Function, onAction: Function}} props
     */
    function TabContextMenu({ menu, tabs, onClose, onAction }) {
      const ref = react.useRef(null);
      const mountTimeRef = react.useRef(Date.now());
      react.useEffect(() => {
        mountTimeRef.current = Date.now();
        const handlePointerDown = (event) => {
          if (Date.now() - mountTimeRef.current < 400) return;
          if (ref.current && !ref.current.contains(event.target)) onClose();
        };
        const handleKeyDown = (event) => {
          if (event.key === "Escape") onClose();
        };
        const handleScroll = (event) => {
          if (Date.now() - mountTimeRef.current < 400) return;
          if (event.target === window || event.target === document || event.target === document.body) onClose();
        };
        window.addEventListener("pointerdown", handlePointerDown);
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("scroll", handleScroll);
        window.addEventListener("resize", onClose);
        return () => {
          window.removeEventListener("pointerdown", handlePointerDown);
          window.removeEventListener("keydown", handleKeyDown);
          window.removeEventListener("scroll", handleScroll);
          window.removeEventListener("resize", onClose);
        };
      }, [onClose]);

      if (menu === null || menu === undefined) return null;
      const rows = Array.isArray(tabs) ? tabs : [];
      const target = rows.find((tab) => tab.id === menu.tabId) || null;
      const winW = typeof window !== "undefined" ? window.innerWidth : 1000;
      const winH = typeof window !== "undefined" ? window.innerHeight : 800;
      const top = Math.max(8, Math.min(menu.y, winH - 240)) + "px";
      const left = Math.max(8, Math.min(menu.x, winW - 210)) + "px";

      // Which items can do anything is decided from the list, not left to
      // the view: "close others" with one tab open is a no-op that would
      // look like a broken button.
      const disabled = {
        refresh: target === null,
        close: target === null,
        others: rows.length < 2,
        all: rows.length === 0,
      };

      return react.createElement(react.Fragment, null,
        react.createElement("div", {
          className: "fv-context-backdrop",
          onClick: (event) => {
            event.stopPropagation();
            if (Date.now() - mountTimeRef.current < 400) return;
            onClose();
          },
          onContextMenu: (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (Date.now() - mountTimeRef.current < 400) return;
            onClose();
          },
        }),
        react.createElement("div", {
          ref,
          // The id exists so the stylesheet can outrank a theme's glass rule
          // (an id beats any class/attribute selector, so it does not matter
          // which sheet loads last). Only one menu is ever mounted at a time.
          id: CONTEXT_MENU_ID,
          className: "fv-context-menu",
          style: { top, left },
          role: "menu",
          "aria-label": "标签操作",
          onContextMenu: (event) => event.preventDefault(),
        },
          react.createElement("div", { className: "fv-context-head" },
            react.createElement("div", { className: "fv-context-title" }, target === null ? "标签" : target.title),
            target !== null && target.path !== "" && target.path !== target.title
              ? react.createElement("div", { className: "fv-context-path" }, target.path)
              : null),
          ...TAB_MENU_ITEMS.map((item) => react.createElement("button", {
            key: item.key,
            type: "button",
            className: "fv-context-item",
            role: "menuitem",
            disabled: disabled[item.key] === true,
            onClick: (event) => {
              event.stopPropagation();
              onClose();
              onAction(item.key, menu.tabId);
            },
          },
            react.createElement("span", { className: "fv-context-item-icon", "aria-hidden": "true" }, item.icon),
            react.createElement("span", { className: "fv-context-item-label" }, item.label)))));
    }

    /**
     * The outline of a rendered Markdown document.
     *
     * Modelled on the session's turn navigator: a compact rail on the right
     * edge that stays out of the reading column, expands into a labelled list
     * on demand, marks the section currently on screen, and jumps on click.
     *
     * The headings come from the source (see `parseHeadings`), while the
     * scroll target is the Nth rendered heading element. Matching by position
     * rather than by text keeps it working when the renderer rewrites labels
     * (smart quotes, inline code, links) — the two lists are built from the
     * same document in the same order, so index N in one is index N in the
     * other.
     *
     * @param {{headings: Array<object>, scrollerRef: object, activeKey: string,
     *   open: boolean, onToggle: Function, onPick: Function}} props
     */
    function MarkdownOutline({ headings, open, activeKey, onToggle, onPick }) {
      const rows = Array.isArray(headings) ? headings : [];
      if (rows.length === 0) return null;
      // One indent step per nesting level, measured from the shallowest
      // heading present: a document starting at `##` should not indent every
      // row by one level of nothing.
      const baseLevel = rows.reduce((min, row) => Math.min(min, row.level), 6);
      return react.createElement("div", {
        className: "fv-outline",
        "data-open": open ? "true" : "false",
      },
        react.createElement("button", {
          type: "button",
          className: "fv-outline-toggle",
          "aria-expanded": open ? "true" : "false",
          "aria-label": open ? "收起目录" : "展开目录",
          title: open ? "收起目录" : "目录",
          onClick: onToggle,
        }, react.createElement(SvgIconOutline, { size: 15 })),
        open
          ? react.createElement("nav", {
            className: "fv-outline-panel",
            "aria-label": "文档目录",
          },
            react.createElement("div", { className: "fv-outline-head" }, "目录"),
            react.createElement("div", { className: "fv-outline-list" },
              ...rows.map((row) => react.createElement("button", {
                key: row.key,
                type: "button",
                className: "fv-outline-item",
                "data-level": row.level - baseLevel,
                "aria-current": activeKey === row.key ? "true" : undefined,
                title: row.text,
                onClick: () => onPick(row),
              }, row.text))))
          : null);
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
      // Publish this apply's stores to the Host wrappers. A re-apply installs new
      // stores but the wrappers are already in place, so they must follow the
      // ones the freshly mounted overlay subscribes to.
      liveOpenStore = openStore;
      liveSessionStore = sessionStore;
      // The composer's draft accessors, captured from the slot that receives
      // them. The drawer renders in a different subtree and cannot reach the
      // input state through props.
      const composerStore = createStore(null);
      const request = createRequest(ctx.connection);
      // One controller for the whole drawer: the Git sidebar and the commit
      // pane read the same snapshot, and a checkout invalidates both.
      const git = createGitController(request);

      /**
       * The file tree. Directories expand in place rather than replacing the
       * listing, and a directory's children are requested the first time it
       * opens, so opening the viewer costs one listing regardless of tree size.
       */
      function TreeRow({ row, selected, onToggle, onSelect, onMention, onContextMenu, gitStatus }) {
        const entry = row.entry;
        const isDirectory = entry.type === "directory";
        const indent = { "--fv-depth": row.depth, paddingLeft: 8 + row.depth * 14 + "px" };
        const timerRef = react.useRef(null);
        const startPos = react.useRef(null);
        const longPressedRef = react.useRef(false);
        const isModified = !isDirectory && Boolean(gitStatus?.modified?.has(entry.path));
        const isUntracked = !isDirectory && Boolean(gitStatus?.untracked?.has(entry.path));

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
            }, isDirectory ? "▸" : (entry?.kind === "image" ? "🖼" : "·")),
            react.createElement("span", { className: "fv-row-name" }, (entry && (entry.name || baseNameOf(entry.path) || entry.path)) || ""),
            isModified
              ? react.createElement("span", { className: "fv-badge fv-badge-mod", title: "工作区已修改" }, "M")
              : isUntracked
                ? react.createElement("span", { className: "fv-badge fv-badge-add", title: "新添加文件" }, "U")
                : null,
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

      function Tree({ rows, selected, onToggle, onSelect, onMention, onContextMenu, width, gitStatus, header }) {
        const children = rows.map((row) => {
          const indent = { "--fv-depth": row.depth, paddingLeft: 8 + row.depth * 14 + "px" };
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
            gitStatus,
          });
        });
        return react.createElement("div", {
          className: "fv-tree", role: "tree", "aria-label": "文件树",
          style: typeof width === "number" ? { width: width + "px" } : undefined,
        }, header === undefined ? null : header, ...children);
      }

      /** Dedicated Image Previewer: zoom, pan, rotate, dimensions, toolbar, and reset. */
      function ImageView({ meta, root }) {
        const [state, setState] = react.useState({ status: "loading", url: "", error: null });
        const [scale, setScale] = react.useState(1);
        const [rotate, setRotate] = react.useState(0);
        const [flipH, setFlipH] = react.useState(false);
        const [offset, setOffset] = react.useState({ x: 0, y: 0 });
        const [isDragging, setIsDragging] = react.useState(false);
        const [naturalSize, setNaturalSize] = react.useState(null);
        const dragStartRef = react.useRef({ x: 0, y: 0, startOffsetX: 0, startOffsetY: 0 });

        react.useEffect(() => {
          let url = "";
          let live = true;
          setState({ status: "loading", url: "", error: null });
          setScale(1);
          setRotate(0);
          setFlipH(false);
          setOffset({ x: 0, y: 0 });
          setNaturalSize(null);

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

        const containerRef = react.useRef(null);
        react.useEffect(() => {
          const el = containerRef.current;
          if (!el) return;
          const handleWheel = (e) => {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.15 : -0.15;
            setScale((s) => Math.min(10, Math.max(0.1, Math.round((s + delta) * 100) / 100)));
          };
          el.addEventListener("wheel", handleWheel, { passive: false });
          return () => {
            el.removeEventListener("wheel", handleWheel);
          };
        }, []);

        const onPointerDown = (e) => {
          if (e.button !== 0) return;
          setIsDragging(true);
          dragStartRef.current = {
            x: e.clientX,
            y: e.clientY,
            startOffsetX: offset.x,
            startOffsetY: offset.y,
          };
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
        };

        const onPointerMove = (e) => {
          if (!isDragging) return;
          const dx = e.clientX - dragStartRef.current.x;
          const dy = e.clientY - dragStartRef.current.y;
          setOffset({
            x: dragStartRef.current.startOffsetX + dx,
            y: dragStartRef.current.startOffsetY + dy,
          });
        };

        const onPointerUp = (e) => {
          if (isDragging) {
            setIsDragging(false);
            try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
          }
        };

        const onDoubleClick = () => {
          if (scale === 1 && offset.x === 0 && offset.y === 0) {
            setScale(1.5);
          } else {
            setScale(1);
            setOffset({ x: 0, y: 0 });
          }
        };

        const onImageLoad = (e) => {
          const img = e.currentTarget;
          if (img) {
            setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
          }
        };

        const zoomIn = () => setScale((s) => Math.min(10, Math.round((s + 0.25) * 100) / 100));
        const zoomOut = () => setScale((s) => Math.max(0.1, Math.round((s - 0.25) * 100) / 100));
        const resetView = () => {
          setScale(1);
          setRotate(0);
          setFlipH(false);
          setOffset({ x: 0, y: 0 });
        };
        const rotateLeft = () => setRotate((r) => (r - 90) % 360);
        const rotateRight = () => setRotate((r) => (r + 90) % 360);
        const toggleFlipH = () => setFlipH((f) => !f);

        if (state.status === "loading") {
          return react.createElement("div", { className: "fv-note" }, "正在加载图片…");
        }
        if (state.status === "error") {
          return react.createElement("div", { className: "fv-note fv-error" }, messageOf(state.error));
        }

        const transform = `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotate}deg) scaleX(${flipH ? -1 : 1})`;

        return react.createElement("div", { className: "fv-image-viewer" },
          react.createElement("div", { className: "fv-image-toolbar" },
            react.createElement("button", {
              type: "button",
              className: "fv-image-btn",
              title: "放大 (+)",
              onClick: zoomIn,
            }, "+"),
            react.createElement("button", {
              type: "button",
              className: "fv-image-btn",
              title: "缩小 (-)",
              onClick: zoomOut,
            }, "−"),
            react.createElement("span", { className: "fv-image-scale-text" }, `${Math.round(scale * 100)}%`),
            react.createElement("div", { className: "fv-image-sep" }),
            react.createElement("button", {
              type: "button",
              className: "fv-image-btn",
              title: "适应窗口 (重置)",
              onClick: resetView,
            }, "适应"),
            react.createElement("button", {
              type: "button",
              className: "fv-image-btn",
              title: "原始尺寸 (1:1)",
              onClick: () => { setScale(1); setOffset({ x: 0, y: 0 }); },
            }, "1:1"),
            react.createElement("div", { className: "fv-image-sep" }),
            react.createElement("button", {
              type: "button",
              className: "fv-image-btn",
              title: "向左旋转 90°",
              onClick: rotateLeft,
            }, "↺"),
            react.createElement("button", {
              type: "button",
              className: "fv-image-btn",
              title: "向右旋转 90°",
              onClick: rotateRight,
            }, "↻"),
            react.createElement("button", {
              type: "button",
              className: "fv-image-btn",
              title: "水平翻转",
              onClick: toggleFlipH,
            }, "⇄"),
            react.createElement("div", { style: { flex: "1 1 auto" } }),
            naturalSize
              ? react.createElement("span", { className: "fv-image-dims" }, `${naturalSize.width} × ${naturalSize.height} px`)
              : null,
            meta.size
              ? react.createElement("span", { className: "fv-image-size" }, formatBytes(meta.size))
              : null,
            react.createElement("a", {
              href: state.url,
              download: meta.name || "image",
              target: "_blank",
              rel: "noopener noreferrer",
              className: "fv-image-btn",
              title: "新标签页查看 / 下载原图",
            }, "⤓")),
          react.createElement("div", {
            ref: containerRef,
            className: "fv-image-canvas" + (isDragging ? " fv-image-dragging" : ""),
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onPointerCancel: onPointerUp,
            onDoubleClick,
          },
            react.createElement("img", {
              className: "fv-image-element",
              src: state.url,
              alt: meta.name,
              draggable: false,
              onLoad: onImageLoad,
              style: { transform },
            })));
      }

      /** PDFs and generic binaries: fetch bytes once, hand a blob URL to the browser iframe. */
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

      /** Word documents: host converts to HTML/Markdown, styled cleanly. */
      function DocView({ meta, root }) {
        const [state, setState] = react.useState({ status: "loading", html: "", markdown: "", warnings: [], error: null });
        react.useEffect(() => {
          let live = true;
          setState({ status: "loading", html: "", markdown: "", warnings: [], error: null });
          request("doc", { root, path: meta.path }).then((value) => {
            if (live) setState({
              status: "ready",
              html: value?.html || "",
              markdown: value?.markdown || "",
              warnings: value?.warnings || [],
              error: null,
            });
          }).catch((error) => {
            if (live) setState({ status: "error", html: "", markdown: "", warnings: [], error });
          });
          return () => { live = false; };
        }, [root, meta.path]);

        if (state.status === "loading") return react.createElement("div", { className: "fv-note" }, "正在转换文档…");
        if (state.status === "error") {
          return react.createElement("div", { className: "fv-note fv-error" }, messageOf(state.error));
        }
        if (!state.html && !state.markdown.trim()) {
          return react.createElement("div", { className: "fv-note" }, "文档没有可提取的文本内容。");
        }
        return react.createElement("div", { className: "fv-doc-article" },
          state.html
            ? react.createElement("div", { dangerouslySetInnerHTML: { __html: state.html } })
            : react.createElement(MarkdownText, {
              text: state.markdown,
              labels: MARKDOWN_LABELS,
              codeLabels: MARKDOWN_CODE_LABELS,
            }),
          state.warnings.length > 0
            ? react.createElement("div", { className: "fv-note", style: { marginTop: "16px" } }, `转换时有 ${state.warnings.length} 处格式降级（图片或复杂排版）。`)
            : null);
      }

      /** Line-numbered diff viewer with dual line number gutters. */
      /** Text, Markdown and JSON: one windowed read, three renderings. */
      function TextView({ meta, root, wrap, lang, commit, repo }) {
        // Callers mount this with a per-file key, so paging state starts fresh
        // for every file instead of leaking the previous file's window into the
        // first request.
        const [state, setState] = react.useState({ status: "loading", data: null, error: null });
        const [offset, setOffset] = react.useState(1);
        const [raw, setRaw] = react.useState(false);
        const [diffMode, setDiffMode] = react.useState(false);
        const [diffData, setDiffData] = react.useState(null);
        // The Markdown outline: whether it is expanded, which section is on
        // screen, and the scroll container it drives. The container is owned
        // here rather than by the outline so the outline never has to reach
        // across the tree to find it.
        const [outlineOpen, setOutlineOpen] = react.useState(false);
        const [activeHeading, setActiveHeading] = react.useState("");
        const contentRef = react.useRef(null);
        // A file opened from a commit is read from that commit's blob, never
        // from the working tree: the two differ exactly when the history is
        // interesting, and a deleted file has no working-tree copy at all.
        const fromCommit = typeof commit === "string" && commit !== "";
        // Whether the reader has picked a view themselves. The automatic landing
        // on the diff happens once per mount and then stays out of the way.
        const viewChosen = react.useRef(false);

        react.useEffect(() => {
          let live = true;
          setState((current) => ({ status: "loading", data: current.data, error: null }));
          setDiffMode(false);
          // The override rides on the request, so the host resolves the
          // language and the client never highlights on its own authority.
          const langPayload = lang === undefined || lang === "auto" ? {} : { lang };
          const readMethod = fromCommit ? "gitCommitFile" : "read";
          // `meta.commit` is the commit the bytes come from; for a deletion that
          // is the parent, and `meta.sha` names the commit being viewed.
          const readPayload = fromCommit
            ? { root, repo, sha: commit, path: meta.path, offset, limit: WINDOW_LINES, ...langPayload }
            : { root, path: meta.path, offset, limit: WINDOW_LINES, ...langPayload };
          request(readMethod, readPayload).then((value) => {
            if (live) setState({ status: "ready", data: value, error: null });
          }).catch((error) => {
            if (live) setState({ status: "error", data: null, error });
          });
          // A historical file is diffed against its own commit, not against the
          // index: the working-tree comparison would answer a different
          // question and show changes made after this commit.
          const diffSha = typeof meta.diffSha === "string" && meta.diffSha !== "" ? meta.diffSha : "";
          if (fromCommit) {
            if (diffSha === "") {
              setDiffData(null);
              return () => { live = false; };
            }
            request("gitCommitDiff", {
              root,
              repo,
              sha: diffSha,
              path: meta.rowPath || meta.path,
              ...(meta.oldPath ? { oldPath: meta.oldPath } : {}),
            }).then((val) => {
              if (!live) return;
              // `gitCommitDiff` returns per-file sections; this view shows the
              // one file it asked for.
              const first = val !== null && Array.isArray(val.files) ? val.files[0] : null;
              const loaded = first === null || first === undefined
                ? null
                : { hasDiff: first.rows.length > 0, rows: first.rows, diffs: [], summary: { added: first.added, removed: first.removed } };
              setDiffData(loaded);
              // The reader opened this file *from* the change list, so the
              // change is what they came to see; the full text is one press
              // away and their own choice wins from then on.
              if (!viewChosen.current && loaded !== null && loaded.hasDiff) {
                viewChosen.current = true;
                setDiffMode(true);
              }
            }).catch(() => {
              if (live) setDiffData(null);
            });
            return () => { live = false; };
          }
          request("diff", { root, path: meta.path }).then((val) => {
            if (live) setDiffData(val);
          }).catch(() => {
            if (live) setDiffData(null);
          });
          return () => { live = false; };
        }, [root, meta.path, offset, lang, fromCommit, commit, repo, meta.diffSha, meta.rowPath, meta.oldPath]);

        // ------------------------------------------------------------------
        // Markdown outline
        //
        // These hooks sit ABOVE the early returns below. React matches hooks by
        // call order, so a hook that only runs once a document has loaded would
        // change the order between the loading render and the loaded one — the
        // exact shape of "Minified React error #310" (too many/few hooks).
        // Everything here therefore reads `state.data` defensively instead of
        // the post-return `data` binding.
        // ------------------------------------------------------------------
        const loaded = state.data;
        // The outline only exists for a rendered Markdown preview. In source
        // mode the text is a code block, and a JSON tree has no headings.
        const outlineVisible = loaded !== null && loaded !== undefined
          && loaded.kind === "markdown" && typeof loaded.text === "string"
          && !raw && !diffMode;
        const outlineText = outlineVisible ? loaded.text : "";
        const headings = react.useMemo(
          () => (outlineText === "" ? [] : parseHeadings(outlineText)),
          [outlineText],
        );

        /**
         * The rendered heading elements, in document order.
         *
         * Kept as a plain lookup instead of state: the elements are owned by
         * the renderer and re-created on every render, so caching them would
         * hand out detached nodes.
         */
        const headingElements = () => {
          const host = contentRef.current;
          if (!host) return [];
          return [...host.querySelectorAll("h1,h2,h3,h4,h5,h6")];
        };

        // Mark the section currently at the top of the reading area. Measured
        // on scroll rather than with an IntersectionObserver because the
        // "current" section is the last heading above the fold, which is a
        // comparison between two positions, not a visibility test.
        react.useEffect(() => {
          if (!outlineVisible || headings.length === 0) {
            setActiveHeading("");
            return undefined;
          }
          const host = contentRef.current;
          if (!host) return undefined;
          let frame = 0;
          const measure = () => {
            frame = 0;
            const elements = host.querySelectorAll("h1,h2,h3,h4,h5,h6");
            if (elements.length === 0) return;
            const top = host.getBoundingClientRect().top;
            let current = "";
            for (let index = 0; index < elements.length; index += 1) {
              const row = headings[index];
              if (row === undefined) continue;
              // 24px of slack keeps a heading that is exactly at the edge from
              // flickering between two rows while the reader scrolls past it.
              if (elements[index].getBoundingClientRect().top - top <= 24) current = row.key;
              else break;
            }
            setActiveHeading(current);
          };
          const onScroll = () => {
            if (frame !== 0) return;
            frame = requestAnimationFrame(measure);
          };
          measure();
          host.addEventListener("scroll", onScroll, { passive: true });
          return () => {
            if (frame !== 0) cancelAnimationFrame(frame);
            host.removeEventListener("scroll", onScroll);
          };
        }, [outlineVisible, headings]);

        if (state.status === "error") {
          return react.createElement("div", { className: "fv-note fv-error" }, messageOf(state.error));
        }
        const data = state.data;
        if (data === null) return react.createElement("div", { className: "fv-note" }, "正在读取…");

        // A rendered preview needs the whole document. Past the host's preview
        // budget only windowed lines arrive, so the source view is all there is.
        const canPreview = (data.kind === "markdown" || data.kind === "json") && typeof data.text === "string";
        const hasDiff = Boolean(diffData && diffData.hasDiff && (
          (Array.isArray(diffData.rows) && diffData.rows.length > 0)
          || (Array.isArray(diffData.diffs) && diffData.diffs.length > 0)
        ));
        const diffSummary = diffData && diffData.summary;
        const showTabs = canPreview || hasDiff;

        let body;
        if (diffMode && hasDiff) {
          body = react.createElement(ErrorBoundary, {
            resetKey: data.path + ":diff",
            fallback: () => react.createElement("div", { className: "fv-note fv-error" }, "渲染改动对比失败。"),
          }, react.createElement(DiffView, {
            diffData,
            filePath: data.path,
            wrap,
          }));
        } else if (canPreview && !raw && data.kind === "markdown") {
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
            fallback: (err) => react.createElement("div", { className: "fv-note fv-error" },
              react.createElement("span", null, "渲染 JSON 结构失败（" + (err && err.message ? err.message : "未知错误") + "）。"),
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
        // Both answers belong to the same question when a file is opened from a
        // commit: "what changed here" and "what does it contain". The diff leads
        // in that case, because it is what the reader came for; opening the
        // working-tree copy keeps the content tab first.
        const diffTab = hasDiff
          ? react.createElement("button", {
            key: "diff",
            type: "button", className: "fv-tab fv-tab-diff", "aria-selected": diffMode ? "true" : "false",
            onClick: () => { viewChosen.current = true; setDiffMode(true); },
          },
            "改动",
            diffSummary && (diffSummary.added > 0 || diffSummary.removed > 0)
              ? react.createElement("span", { className: "fv-diff-stat" },
                  diffSummary.added > 0 ? react.createElement("span", { className: "fv-diff-add" }, `+${diffSummary.added}`) : null,
                  (diffSummary.added > 0 && diffSummary.removed > 0) ? " " : "",
                  diffSummary.removed > 0 ? react.createElement("span", { className: "fv-diff-del" }, `-${diffSummary.removed}`) : null)
              : null)
          : null;
        const contentTab = react.createElement("button", {
          key: "content",
          type: "button", className: "fv-tab", "aria-selected": (!raw && !diffMode) ? "true" : "false",
          onClick: () => { viewChosen.current = true; setRaw(false); setDiffMode(false); },
        }, canPreview ? (data.kind === "markdown" ? "预览" : "结构") : (fromCommit ? "完整内容" : "内容"));
        const sourceTab = canPreview
          ? react.createElement("button", {
            key: "source",
            type: "button", className: "fv-tab", "aria-selected": (raw && !diffMode) ? "true" : "false",
            onClick: () => { viewChosen.current = true; setRaw(true); setDiffMode(false); },
          }, "源码")
          : null;

        const tabs = showTabs
          ? react.createElement("div", { className: "fv-sheet-tabs", role: "tablist" },
            ...(fromCommit && diffTab !== null
              ? [diffTab, contentTab, sourceTab]
              : [contentTab, sourceTab, diffTab]).filter((tab) => tab !== null))
          : null;


        /** Scroll the section for one outline row into view. */
        const pickHeading = (row) => {
          const index = headings.findIndex((candidate) => candidate.key === row.key);
          const element = headingElements()[index];
          if (!element) return;
          const host = contentRef.current;
          // Scroll the container, not the window: the drawer is its own
          // scroller and scrollIntoView would also move the page behind it.
          if (host) {
            const offset = element.getBoundingClientRect().top - host.getBoundingClientRect().top;
            const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
            host.scrollTo({ top: host.scrollTop + offset - 8, behavior: reduce ? "auto" : "smooth" });
          } else {
            element.scrollIntoView({ block: "start" });
          }
          setActiveHeading(row.key);
          // On a phone the panel would cover the text it just jumped to.
          if (typeof window !== "undefined" && window.innerWidth <= 768) setOutlineOpen(false);
        };

        return react.createElement(react.Fragment, null,
          tabs,
          react.createElement("div", { className: "fv-content-wrap" },
            react.createElement("div", {
              className: "fv-content",
              "data-wrap": wrapping ? "on" : "off",
              ref: contentRef,
            },
              previewUnavailable
                ? react.createElement("div", { className: "fv-note" },
                  data.kind === "markdown" ? "文档过大，仅显示源码。" : "文件过大，仅显示源码。")
                : null,
              body),
            outlineVisible
              ? react.createElement(MarkdownOutline, {
                headings,
                open: outlineOpen,
                activeKey: activeHeading,
                onToggle: () => setOutlineOpen((current) => !current),
                onPick: pickHeading,
              })
              : null),
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
      function FileView({ meta, root, api, wrap, lang, onDownload, commit, repo, loading }) {
        if (meta === null) {
          // A tab exists but its metadata is still in flight. Saying "pick a
          // file" there would be a lie, and the reader would click again.
          return react.createElement("div", { className: "fv-note" },
            loading === true ? "正在读取文件…" : "从左侧选择一个文件。");
        }
        if (meta.tooLarge || meta.kind === "binary") {
          return react.createElement("div", { className: "fv-note" },
            react.createElement("strong", null, meta.name),
            react.createElement("span", null, meta.tooLarge
              ? `文件大小 ${formatBytes(meta.size)}，超过查看器上限 ${formatBytes(meta.limit)}。`
              : "这是二进制文件，查看器无法显示其内容。"),
            react.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "4px" } },
              api && api.host
                ? react.createElement("button", {
                  type: "button",
                  className: "fv-button",
                  onClick: () => api.host.openPath({ path: meta.displayPath }),
                }, "用本地程序打开")
                : null,
              react.createElement("button", {
                type: "button",
                className: "fv-button fv-btn-download-note",
                onClick: () => onDownload && onDownload(meta),
              }, "下载到本地")));
        }
        // The key remounts each viewer per file so no per-file state (paging,
        // active sheet, blob URL) survives a switch.
        const key = root + "\u0000" + meta.path + (commit ? "\u0000" + commit : "");
        // A blob read from history is not the file on disk. Say which commit it
        // came from, and call out a deletion, so the preview cannot be mistaken
        // for the current contents.
        const fromHistory = typeof commit === "string" && commit !== "";
        const banner = fromHistory
          ? react.createElement("div", { className: "fv-history-banner" },
            react.createElement("span", null,
              "以下内容来自提交 " + commit.slice(0, 7) + (meta.change ? "，该文件本次为「" + meta.change + "」" : "")),
            react.createElement("span", { className: "fv-history-hint" }, "这是历史版本，不是工作区当前内容。"))
          : null;
        if (fromHistory && meta.kind !== "text" && meta.kind !== "markdown" && meta.kind !== "json") {
          return react.createElement(react.Fragment, null, banner,
            react.createElement("div", { className: "fv-note" },
              "该提交中的文件是 " + meta.kind + " 格式，历史版本暂不支持预览。"));
        }
        if (meta.kind === "image") return react.createElement(ImageView, { key, meta, root });
        if (meta.kind === "pdf") return react.createElement(BinaryView, { key, meta, root });
        if (meta.kind === "sheet") {
          return react.createElement("div", { className: "fv-content" }, react.createElement(SheetView, { key, meta, root }));
        }
        if (meta.kind === "doc") {
          return react.createElement("div", { className: "fv-content" }, react.createElement(DocView, { key, meta, root }));
        }
        return react.createElement(react.Fragment, null, banner,
          react.createElement(TextView, { key, meta, root, wrap, lang, commit, repo }));
      }


      /** Right-click context menu for file and directory items. */
      function ContextMenu({ menu, rootPath, onClose, onMention, onToast, onDownload }) {
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

        const handleDownload = (e) => {
          e.stopPropagation();
          onClose();
          if (onDownload) onDownload(entry);
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
            id: CONTEXT_MENU_ID,
            className: "fv-context-menu",
            style: { top, left },
            role: "menu",
            "aria-label": "文件操作",
            onContextMenu: (e) => e.preventDefault(),
          },
            react.createElement("div", { className: "fv-context-head" },
              react.createElement("div", { className: "fv-context-title" }, entry.name || relPath),
              (relPath && relPath !== entry.name)
                ? react.createElement("div", { className: "fv-context-path" }, relPath)
                : null),
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
              react.createElement("span", { className: "fv-context-item-label" }, "引用到输入框 (@)")),
            entry.type !== "directory" && !entry.isDirectory
              ? react.createElement("button", {
                type: "button",
                className: "fv-context-item fv-context-item-download",
                role: "menuitem",
                onClick: handleDownload,
              },
                react.createElement("span", { className: "fv-context-item-icon", "aria-hidden": "true" }, "⬇️"),
                react.createElement("span", { className: "fv-context-item-label" }, "下载文件"))
              : null));
      }

      /** Transient toast notification. */
      function ToastView({ toast }) {
        if (!toast) return null;
        return react.createElement("div", { className: "fv-toast", role: "status" }, toast);
      }



      /** Safe Access Paths Configuration Dialog */
      function SafePathsModal({ open, onClose, onToast, onUpdated, prefillPath }) {
        const [loading, setLoading] = react.useState(false);
        const [saving, setSaving] = react.useState(false);
        const [safePaths, setSafePaths] = react.useState([]);
        const [workspaces, setWorkspaces] = react.useState([]);
        const [newPath, setNewPath] = react.useState("");
        const [newLabel, setNewLabel] = react.useState("");

        react.useEffect(() => {
          if (!open) return;
          setLoading(true);
          if (prefillPath) setNewPath(prefillPath);
          request("getSafePaths", {})
            .then((res) => {
              setSafePaths(res?.safePaths || []);
              setWorkspaces(res?.builtInWorkspaces || []);
              setLoading(false);
            })
            .catch(() => setLoading(false));
        }, [open, prefillPath]);

        if (!open) return null;

        const handleAdd = () => {
          const p = newPath.trim();
          if (!p) return;
          if (safePaths.some((item) => item.path === p)) {
            if (onToast) onToast("该路径已在安全路径列表中");
            return;
          }
          setSafePaths([...safePaths, { path: p, label: newLabel.trim() }]);
          setNewPath("");
          setNewLabel("");
        };

        const handleRemove = (idx) => {
          setSafePaths(safePaths.filter((_, i) => i !== idx));
        };

        const handleSave = () => {
          setSaving(true);
          const currentList = [...safePaths];
          const p = newPath.trim();
          if (p && !currentList.some((item) => item.path === p)) {
            currentList.push({ path: p, label: newLabel.trim() });
          }
          request("updateSafePaths", { safePaths: currentList })
            .then(() => {
              setSaving(false);
              if (onToast) onToast("安全访问路径已更新");
              if (onUpdated) onUpdated();
              onClose();
            })
            .catch((err) => {
              setSaving(false);
              if (onToast) onToast("保存失败：" + (err?.message || "未知错误"));
            });
        };

        const workspacesSection = react.createElement("div", { className: "fv-modal-sec" },
          react.createElement("span", { className: "fv-modal-sec-title" }, "内置工作区（默认可访问）"),
          react.createElement("span", { className: "fv-modal-sec-hint" }, "以下为当前环境已注册的工作区目录，文件查看器内置默认放行，无需重复添加："),
          react.createElement("div", { className: "fv-tag-list" },
            workspaces.length > 0
              ? workspaces.map((w, idx) => react.createElement("span", { key: idx, className: "fv-tag" },
                react.createElement("span", { "aria-hidden": "true" }, "\u{1F4C1}"),
                w.name ? (w.name + " (" + w.path + ")") : w.path))
              : react.createElement("span", { className: "fv-modal-sec-hint" }, "暂无内置工作区")));

        const safePathsList = loading
          ? react.createElement("div", { className: "fv-tree-status" }, "加载配置中...")
          : (safePaths.length === 0
            ? react.createElement("div", { className: "fv-tree-status" }, "暂未添加任何外部安全路径。添加后即可在下拉菜单中直接浏览。")
            : react.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } },
              ...safePaths.map((item, idx) => react.createElement("div", { key: idx, className: "fv-safe-item" },
                react.createElement("div", { className: "fv-safe-item-info" },
                  react.createElement("span", { className: "fv-safe-item-path" }, item.path),
                  item.label ? react.createElement("span", { className: "fv-safe-item-label" }, item.label) : null),
                react.createElement("button", {
                  type: "button",
                  className: "fv-btn-del",
                  onClick: () => handleRemove(idx),
                }, "删除")))));

        const safePathsSection = react.createElement("div", { className: "fv-modal-sec" },
          react.createElement("span", { className: "fv-modal-sec-title" }, "额外安全访问路径"),
          react.createElement("span", { className: "fv-modal-sec-hint" }, "允许文件查看器访问工作区以外的指定安全目录或磁盘路径："),
          safePathsList);

        const addSection = react.createElement("div", { className: "fv-add-box" },
          react.createElement("span", { style: { fontSize: "12px", fontWeight: 600 } }, "添加安全访问路径"),
          react.createElement("div", { className: "fv-input-row" },
            react.createElement("input", {
              className: "fv-input",
              placeholder: "例如 /opt/data 或 D:/Notes",
              value: newPath,
              onChange: (e) => setNewPath(e.target.value),
              onKeyDown: (e) => { if (e.key === "Enter") handleAdd(); },
            }),
            react.createElement("input", {
              className: "fv-input",
              style: { maxWidth: "130px" },
              placeholder: "名称 (可选)",
              value: newLabel,
              onChange: (e) => setNewLabel(e.target.value),
              onKeyDown: (e) => { if (e.key === "Enter") handleAdd(); },
            }),
            react.createElement("button", {
              type: "button",
              className: "fv-button",
              onClick: handleAdd,
            }, "添加")));

        return react.createElement("div", {
          className: "fv-modal-scrim",
          onClick: (e) => { if (e.target === e.currentTarget) onClose(); },
        },
          react.createElement("div", { className: "fv-modal", role: "dialog", "aria-modal": "true" },
            react.createElement("div", { className: "fv-modal-head" },
              react.createElement("span", { className: "fv-modal-title" },
                react.createElement("span", { "aria-hidden": "true" }, "\u{1F6E1}"),
                "安全访问路径配置"),
              react.createElement("button", {
                type: "button", className: "fv-icon-button", "aria-label": "关闭", onClick: onClose,
              }, react.createElement("span", { "aria-hidden": "true" }, "\u2715"))),
            react.createElement("div", { className: "fv-modal-body" },
              workspacesSection,
              safePathsSection,
              addSection),
            react.createElement("div", { className: "fv-modal-foot" },
              react.createElement("button", {
                type: "button",
                className: "fv-button",
                onClick: onClose,
              }, "取消"),
              react.createElement("button", {
                type: "button",
                className: "fv-button fv-btn-primary",
                disabled: saving,
                onClick: handleSave,
              }, saving ? "保存中..." : "保存并应用"))));
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
        // The drawer is a panel, not a modal: whatever layer wraps it must not
        // dim or blur the app behind it. The CSS in this bundle opts out of the
        // known cases, and this walks the real DOM for the rest — a theme or
        // adapter may paint those properties from a rule this plugin cannot name
        // in advance. Re-applied on every open because those layers re-render.
        react.useEffect(() => {
          if (!open) return undefined;
          const scrim = typeof document === "undefined" ? null : document.querySelector(".fv-scrim");
          const restore = suppressBackdropEffects(scrim, true);
          return () => { restore(); };
        }, [open]);
        // The tree is an expansion set plus a per-directory listing cache; a
        // directory is fetched the first time it opens and then remembered, so
        // collapsing and reopening costs nothing.
        const [expanded, setExpanded] = react.useState(() => new Set());
        const [nodes, setNodes] = react.useState(() => new Map());
        // The preview's own metadata is no longer a standalone piece of state:
        // it belongs to the tab that opened it, so switching tabs switches the
        // file. `meta` is derived from the active tab further down.
        const [hidden, setHidden] = react.useState(false);
        const [safeModalOpen, setSafeModalOpen] = react.useState(false);
        const [prefillPath, setPrefillPath] = react.useState("");
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

        // --- Resizing the whole drawer from its leading edge ---------------
        // 0 means "whatever the stylesheet picked"; a stored value is only kept
        // once the reader has actually dragged the edge.
        const [shellWidth, setShellWidth] = react.useState(readShellWidth);
        const [edgeResizing, setEdgeResizing] = react.useState(false);
        const edgeRef = react.useRef(null);
        const shellWidthRef = react.useRef(shellWidth);
        shellWidthRef.current = shellWidth;

        const onEdgePointerDown = (event) => {
          if (event.button !== 0 && event.button !== undefined) return;
          event.preventDefault();
          event.stopPropagation();
          const shellEl = edgeRef.current ? edgeRef.current.parentElement : null;
          // Measure the rendered panel rather than trusting state: on a fresh
          // open the width still comes from the stylesheet and no drag has
          // happened yet.
          const startW = shellEl ? shellEl.getBoundingClientRect().width : (shellWidthRef.current || 0);
          edgeRef.current._drag = { startX: event.clientX, startW };
          setEdgeResizing(true);
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) {}
        };

        const onEdgePointerMove = (event) => {
          const drag = edgeRef.current ? edgeRef.current._drag : null;
          if (!drag) return;
          // Dragging left widens: the panel is pinned to the right edge, so the
          // pointer moving away from that edge grows it.
          const delta = drag.startX - event.clientX;
          const available = typeof window === "undefined" ? 0 : (window.visualViewport?.width ?? window.innerWidth ?? 0);
          const next = clampShellWidth(drag.startW + delta, available);
          setShellWidth(next);
        };

        const onEdgePointerUp = (event) => {
          const node = edgeRef.current;
          if (!node || !node._drag) return;
          node._drag = null;
          setEdgeResizing(false);
          try { event.currentTarget.releasePointerCapture(event.pointerId); } catch (_) {}
          writeShellWidth(shellWidthRef.current);
        };

        const onEdgeDoubleClick = () => {
          // Double-click restores the stylesheet width, which is the same
          // "forget my preference" gesture the sidebar handle uses.
          setShellWidth(0);
          writeShellWidth(0);
        };

        /** Keyboard resizing: a drag handle that only a pointer can use is a defect. */
        const onEdgeKeyDown = (event) => {
          const available = typeof window === "undefined" ? 0 : (window.visualViewport?.width ?? window.innerWidth ?? 0);
          const shellEl = edgeRef.current ? edgeRef.current.parentElement : null;
          const current = shellEl ? shellEl.getBoundingClientRect().width : (shellWidthRef.current || 0);
          const step = event.shiftKey ? 64 : 16;
          let next = current;
          if (event.key === "ArrowLeft") next = current + step;
          else if (event.key === "ArrowRight") next = current - step;
          else if (event.key === "Home") next = MIN_SHELL_WIDTH;
          else if (event.key === "End") next = available;
          else return;
          event.preventDefault();
          const clamped = clampShellWidth(next, available);
          setShellWidth(clamped);
          writeShellWidth(clamped);
        };
        // Soft wrap for source views. Off by default: code is written with
        // meaningful line breaks and wrapping obscures them.
        const [wrap, setWrap] = react.useState(false);
        // The language override now lives on the tab it applies to (see
        // `localeTagOfActive`), so switching tabs switches the pin with it.
        const [fullscreen, setFullscreen] = react.useState(false);
        const [isMobile, setIsMobile] = react.useState(() => {
          if (typeof window === "undefined") return false;
          const w = window.visualViewport?.width ?? window.innerWidth ?? 0;
          if (w > 0 && w <= 960) return true;
          if (window.matchMedia && window.matchMedia("(max-width: 960px), (pointer: coarse) and (max-width: 1100px)").matches) return true;
          if (typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) && w <= 1200) return true;
          return false;
        });

        react.useEffect(() => {
          if (!open) return undefined;
          const update = () => {
            const w = window.visualViewport?.width ?? window.innerWidth ?? 0;
            const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
            const mobileUa = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
            setIsMobile(Boolean((w > 0 && w <= 960) || (coarse && w <= 1100) || (mobileUa && w <= 1200)));
          };
          update();
          window.addEventListener("resize", update);
          window.visualViewport?.addEventListener("resize", update);
          return () => {
            window.removeEventListener("resize", update);
            window.visualViewport?.removeEventListener("resize", update);
          };
        }, [open]);

        const [contextMenu, setContextMenu] = react.useState(null);
        const [gitStatus, setGitStatus] = react.useState({ modified: new Set(), untracked: new Set() });
        // Which sidebar pane is showing, and whether the main pane is a commit
        // rather than a file. Both live here because the drawer owns the split.
        const [side, setSide] = react.useState("files");
        /**
         * The right-hand content area is a set of tabs.
         *
         * Every tab owns the *complete* description of what the pane shows:
         * the file preview (`meta`, which commit it was read from, the language
         * pinned for it) as well as the commit-shaped views (`detail` /
         * `changes`). Keeping one object per tab is what lets an inactive tab
         * be restored exactly, instead of inheriting whatever the last opened
         * file happened to leave behind.
         *
         * `null` (never an empty array) means the content area has no tabs at
         * all, which is the state the drawer opens in.
         *
         * @type {null | Array<{id: string, kind: "file" | "commit" | "change", title: string, path: string, label: string, meta: object | null, commit: string, commitView: string, changePath: string, lang: string}>}
         */
        const [tabs, setTabs] = react.useState(null);
        // Which tab is on screen. Kept beside the list rather than inside it so
        // closing the active tab can pick a neighbour with the list in hand.
        const [activeTabId, setActiveTabId] = react.useState("");
        // The tab whose context menu is open, plus where the pointer asked for
        // it. Kept apart from the tree's `contextMenu`: the two menus describe
        // different subjects and must never be confused for one another.
        const [tabMenu, setTabMenu] = react.useState(null);
        const tabsRef = react.useRef(null);
        tabsRef.current = tabs;
        const activeTabIdRef = react.useRef("");
        activeTabIdRef.current = activeTabId;
        // The tab a language pin was last applied to, so a pin made on one tab
        // is not mistaken for one made on another after a switch.
        const gitState = useStore(git.store);

        react.useEffect(() => {
          if (!open || !root) return undefined;
          let live = true;
          request("status", { root }).then((val) => {
            if (!live) return;
            setGitStatus({
              modified: new Set(val?.modified || []),
              untracked: new Set(val?.untracked || []),
            });
          }).catch(() => {});
          return () => { live = false; };
        }, [open, root]);

        /**
         * The root the Git controller was last initialised for.
         *
         * Reopening the drawer must not wipe the panel: a commit tab reopened
         * from the previous visit needs its detail, and the branch the reader
         * was browsing is part of what "the same visit" means. Only an actual
         * root change discards the cached repositories, branches and pages.
         *
         * Null means "never initialised", which is distinct from the empty root
         * the first render sees before the host has resolved anything.
         */
        const gitRootRef = react.useRef(null);

        // The Git panel describes one root; switching roots drops every cached
        // repository, branch and page rather than showing another project's
        // history under the new name.
        react.useEffect(() => {
          if (!open) return;
          if (gitRootRef.current === root) return;
          gitRootRef.current = root;
          git.reset(root);
        }, [open, root]);

        // Loaded on first use, never on open: most visits never touch the Git
        // tab, and discovery spawns a git process per candidate repository.
        react.useEffect(() => {
          if (!open || side !== "git" || root === "") return;
          git.ensure();
          // The working-tree list is part of the panel's first paint, not a
          // second click: "what is uncommitted" is the first thing to look at.
          git.loadChanges();
        }, [open, side, root]);
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
         * Insert a file reference at the composer's caret position without overwriting existing content.
         */
        const mention = (entry) => {
          const shown = entry.displayPath === undefined ? entry.path : entry.displayPath;
          const quoted = /[\s`]/.test(shown) ? "`" + shown.replace(/`/g, "") + "`" : shown;
          const refToken = "@" + quoted;
          const target = composerStore.get();
          const doc = typeof document === "undefined" ? null : document;
          let inserted = false;

          // 1. Primary: use official host inputActions.insertText at the caret
          if (target && target.inputActions && typeof target.inputActions.insertText === "function") {
            try {
              const span = typeof target.inputActions.captureInsertion === "function"
                ? target.inputActions.captureInsertion()
                : null;
              if (span) {
                const draftStr = typeof target.draft === "string" ? target.draft : "";
                const at = typeof span.start === "number" ? span.start : draftStr.length;
                const before = draftStr.slice(0, at);
                const needPreSpace = before.length > 0 && !/\s$/.test(before);
                const textToInsert = (needPreSpace ? " " : "") + refToken + " ";
                if (target.inputActions.insertText(textToInsert, span)) {
                  inserted = true;
                }
              }
            } catch (_) {}
          }

          // 2. Fallback: DOM insertion for Lexical contenteditable
          if (!inserted && doc) {
            const inputEl = (lastComposerSelection?.type === "contenteditable" && lastComposerSelection.element)
              || doc.querySelector("[data-composer-input]");
            if (inputEl) {
              try {
                inputEl.focus();
                const sel = window.getSelection ? window.getSelection() : null;
                if (sel) {
                  if (lastComposerSelection?.type === "contenteditable" && lastComposerSelection.range) {
                    sel.removeAllRanges();
                    sel.addRange(lastComposerSelection.range);
                  }
                  const text = inputEl.textContent || "";
                  const needSpace = text.length > 0 && !/\s$/.test(text);
                  const insertStr = (needSpace ? " " : "") + refToken + " ";
                  if (doc.execCommand && doc.execCommand("insertText", false, insertStr)) {
                    inserted = true;
                  }
                }
              } catch (_) {}
            }
          }

          // 3. Fallback: DOM insertion for textarea at caret
          if (!inserted && doc) {
            const area = (lastComposerSelection?.type === "textarea" && lastComposerSelection.element)
              || doc.querySelector("[data-composer-card] textarea, textarea");
            if (area && typeof area.value === "string") {
              try {
                const val = area.value;
                const hasSel = typeof area.selectionStart === "number";
                const start = hasSel ? area.selectionStart : (lastComposerSelection?.start ?? val.length);
                const end = hasSel ? area.selectionEnd : (lastComposerSelection?.end ?? start);
                const before = val.slice(0, start);
                const after = val.slice(end);
                const needPreSpace = before.length > 0 && !/\s$/.test(before);
                const needPostSpace = after.length === 0 || !/^\s/.test(after);
                const insertStr = (needPreSpace ? " " : "") + refToken + (needPostSpace ? " " : "");
                const nextVal = before + insertStr + after;
                if (writeDraftToDom(doc, nextVal)) {
                  try {
                    area.focus();
                    area.selectionStart = area.selectionEnd = start + insertStr.length;
                  } catch (_) {}
                  inserted = true;
                }
              } catch (_) {}
            }
          }

          // 4. Safe fallback: setDraft using DOM or draft text, NEVER clobber with empty
          if (!inserted && target && typeof target.setDraft === "function") {
            const domText = doc ? (doc.querySelector("[data-composer-input]")?.textContent || doc.querySelector("[data-composer-card] textarea, textarea")?.value) : "";
            const currentDraft = (domText !== undefined && domText !== null && domText !== "") ? domText : (target.draft || "");
            target.setDraft(appendMention(currentDraft, shown));
            inserted = true;
          }

          // 5. Ultimate DOM fallback
          if (!inserted && doc) {
            const area = doc.querySelector("[data-composer-card] textarea, textarea");
            const domText = area ? area.value : "";
            writeDraftToDom(doc, appendMention(domText, shown));
          }

          openStore.set(null);
        };
        const [error, setError] = react.useState(null);
        const [pane, setPane] = react.useState("tree");
        // Directory to open on arrival, relative to the resolved root: the
        // session's working directory when it sits below the workspace root.
        const [reveal, setReveal] = react.useState("");
        // One ticket per tab id, so a read that is slow for one file cannot
        // cancel a read that is fast for another. A single drawer-wide counter
        // would have done exactly that once tabs made concurrent reads normal.
        const metaTickets = react.useRef(new Map());
        const treeGeneration = react.useRef(0);
        /**
         * Which root (and therefore which project) the current state describes.
         *
         * Closing the drawer keeps everything mounted, so reopening lands on
         * the previous visit's tabs, sidebar and expansion set — that is the
         * whole point. This ref is how "the same visit" is recognised: as long
         * as the host resolves the same root, nothing is thrown away.
         */
        const visitContextRef = react.useRef("");

        // Resolve the root set on every open. When the request came from a
        // conversation header or a file click, the host also reports which root
        // that session/file belongs to, the directory path to reveal, and any
        // file to automatically select and preview.
        //
        // The drawer stays mounted while closed (`open` only gates rendering),
        // so everything is still here when it reopens — and that is the point:
        // closing the viewer is not "ending a session", it is hiding a panel,
        // and it must come back the way it was left. The one thing that CANNOT
        // survive is a tab opened under a different root or a different session,
        // because its paths mean something else there; that case is handled
        // below, against the root the host resolves.
        react.useEffect(() => {
          if (request_ === null) return undefined;
          let live = true;
          setError(null);
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
              // A reopen against the same root and the same session keeps every
              // tab, the active one included. Anything else is a different
              // project, and carrying the tabs over would point them at files
              // that merely share a name.
              const sameContext = resolvedRoot !== "" && resolvedRoot === visitContextRef.current;
              if (!sameContext) {
                tabsRef.current = null;
                setTabs(null);
                activeTabIdRef.current = "";
                setActiveTabId("");
                setTabMenu(null);
                setPane("tree");
                // The tree belongs to the previous root too; the listing effect
                // below re-reads it from scratch.
                setExpanded(new Set());
              }
              visitContextRef.current = resolvedRoot;
              setRoot(resolvedRoot);
              setReveal(typeof value.reveal === "string" ? value.reveal : "");
              setError(null);
              if (typeof value.selectFile === "string" && value.selectFile !== "") {
                setPane("content");
                // Arriving on a file from a link: it opens in its own tab, the
                // same way clicking it in the tree would.
                openFileTab(resolvedRoot, value.selectFile, { activate: true });
              }
            }).catch((problem) => {
              if (live) setError(problem);
            });
          return () => { live = false; };
        }, [request_]);

        // The picker's options come from the host, which also validates every
        // override, so the two halves cannot disagree about what is selectable.
        react.useEffect(() => {
          if (!open) return undefined;
          let live = true;
          request("languages", {}).then((value) => {
            if (live) setLanguageCatalog(value?.languages);
          }).catch(() => {});
          return () => { live = false; };
        }, [open]);

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

        /**
         * What the tree was last built for.
         *
         * Opening and closing the drawer must not rebuild the tree: the reader
         * expands a few directories, looks at a file, hides the panel and
         * expects the same shape when it comes back. Only a real context change
         * — a different root, a different dotfile filter, a different directory
         * to reveal — starts over.
         */
        const treeBuiltForRef = react.useRef({ root: "", hidden: null, reveal: "" });

        // A new root or filter invalidates every cached listing; the bumped
        // generation makes any in-flight response from the old tree stale.
        // When the host named a directory to reveal, its whole ancestor chain
        // opens at once so the session's project is visible on arrival.
        react.useEffect(() => {
          if (!open || root === "") return;
          const built = treeBuiltForRef.current;
          const rootChanged = built.root !== root;
          const filterChanged = built.hidden !== hidden;
          // The reveal chain is only worth re-opening when the host names a
          // different directory; the reader's own expansions stay put.
          const revealChanged = built.reveal !== reveal;
          if (!rootChanged && !filterChanged && !revealChanged) return;
          treeBuiltForRef.current = { root, hidden, reveal };
          treeGeneration.current += 1;
          setNodes(new Map());
          if (rootChanged) {
            // Tabs describe paths inside the root that opened them; carrying
            // one across a root switch would point it at a different file with
            // the same name, so the whole set is dropped with the old tree.
            // (The open path already cleared them; this covers a root switched
            // from the picker while the drawer stays open.)
            tabsRef.current = null;
            setTabs(null);
            activeTabIdRef.current = "";
            setActiveTabId("");
            setTabMenu(null);
            setExpanded(new Set());
            setPane("tree");
          }
          const chain = revealChanged && reveal !== "" ? [...ancestorsOf(reveal), reveal] : [];
          if (chain.length > 0) {
            setExpanded((current) => {
              const next = new Set(current);
              for (const dirPath of chain) next.add(dirPath);
              return next;
            });
          }
          // Reload the root plus whatever the tree is actually showing, so a
          // reopen shows current contents rather than a stale listing.
          const visible = rootChanged ? chain : [...expanded];
          const listings = [...new Set(["", ...chain, ...visible])];
          for (const dirPath of listings) loadDirectory(dirPath);
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

        // ------------------------------------------------------------------
        // Tabs
        //
        // The content area holds a list of tabs instead of one preview. Every
        // operation below works on that list, and `activeTab` (plus the values
        // derived from it) is what the render body and the previously existing
        // handlers read. Keeping the list as one piece of state is what makes
        // "close others" and "close all" correct by construction: they are list
        // operations, not four separate flags that could disagree.
        // ------------------------------------------------------------------

        /**
         * The tab on screen, or null.
         *
         * Never compute this from `tabs[0]`: the active tab can be the last
         * one closed, and falling back to a neighbour silently would show a
         * file the reader just dismissed.
         */
        const activeTab = (() => {
          if (tabs === null || tabs.length === 0) return null;
          const found = tabs.find((tab) => tab.id === activeTabId);
          return found === undefined ? null : found;
        })();
        const meta = activeTab === null ? null : (activeTab.meta === undefined ? null : activeTab.meta);
        const previewCommit = activeTab === null ? "" : (activeTab.commit || "");
        const previewChangePath = activeTab === null ? "" : (activeTab.changePath || "");
        const localeTagOfActive = activeTab === null ? "auto" : (activeTab.lang || "auto");
        const showCommit = activeTab !== null && (activeTab.kind === "commit" || activeTab.kind === "change");
        const commitView = activeTab === null ? "files" : (activeTab.commitView || "files");
        const previewOrigin = activeTab === null ? null : (activeTab.origin || null);

        /**
         * Read the list, tolerating the "no tabs yet" state.
         *
         * The render body runs before any tab exists, and every list operation
         * must be safe there rather than special-casing null at each call site.
         */
        const tabList = () => (tabsRef.current === null ? [] : tabsRef.current);

        /**
         * Open a tab, or update the one with the same id and bring it forward.
         *
         * Ids are content-derived (`file:<path>`, `commit:<sha>`,
         * `change:<path>`), which is what makes re-clicking an already open
         * file focus its tab instead of stacking a duplicate.
         */
        const upsertTab = (draft, options) => {
          const result = tabsAfterUpsert(tabList(), activeTabIdRef.current, draft);
          tabsRef.current = result.tabs;
          setTabs(result.tabs);
          // A caller that does not want to move the reader's focus (an arrival
          // path that resolves in the background) keeps the current tab.
          if (options === undefined || options.activate !== false) {
            activeTabIdRef.current = result.activeId;
            setActiveTabId(result.activeId);
          }
          setTabMenu(null);
          return result.activeId;
        };

        /** Focus one existing tab; a missing one is ignored rather than resurrected. */
        const activateTab = (id) => {
          const current = tabList();
          const tab = current.find((row) => row.id === id);
          if (tab === undefined) return;
          activeTabIdRef.current = id;
          setActiveTabId(id);
          setTabMenu(null);
          // The Git controller holds one commit's detail at a time, so coming
          // back to a commit tab whose detail has since been replaced has to
          // re-read it — otherwise the pane would show a different commit
          // under this tab's title.
          if (tab.kind === "commit") {
            const sha = id.slice("commit:".length);
            const detail = git.store.get().detail;
            const loaded = detail !== null && detail !== undefined && detail.commit !== undefined
              && detail.commit.sha === sha;
            if (!loaded) git.openCommit(sha);
          }
        };

        /** Patch one tab by id. Used by asynchronous reads that outlive a switch. */
        const patchTab = (id, mutator) => {
          const current = tabList();
          if (!current.some((tab) => tab.id === id)) return;
          const next = current.map((tab) => (tab.id === id
            ? (typeof mutator === "function" ? mutator(tab) : { ...tab, ...mutator })
            : tab));
          tabsRef.current = next;
          setTabs(next);
        };

        const findTab = (id) => {
          const found = tabList().find((tab) => tab.id === id);
          return found === undefined ? null : found;
        };

        /**
         * Close tabs and land on a sensible neighbour.
         *
         * The list maths lives in `tabsAfterClose` so it can be exercised
         * without a renderer: "which tab is active afterwards" is the one rule
         * a reader notices immediately when it is wrong.
         */
        const closeTabs = (ids) => {
          const current = tabList();
          const result = tabsAfterClose(current, activeTabIdRef.current, Array.isArray(ids) ? ids : [ids]);
          if (result === null) return;
          tabsRef.current = result.tabs;
          setTabs(result.tabs);
          setTabMenu(null);
          activeTabIdRef.current = result.activeId;
          setActiveTabId(result.activeId);
          if (result.tabs.length === 0) setPane("tree");
        };

        const closeTab = (id) => { closeTabs([id]); };

        /**
         * Re-read what one tab shows, without disturbing the others.
         *
         * What "refresh" means depends on what the tab is: a working-tree file
         * re-reads its metadata and forces the viewer to remount, a commit or a
         * change re-runs the Git read that produced it.
         */
        const refreshTab = (id) => {
          const tab = findTab(id);
          if (tab === null) return;
          if (tab.kind === "commit") {
            git.openCommit(tab.id.slice("commit:".length));
            return;
          }
          if (tab.kind === "change") {
            git.loadChanges();
            // The diff itself is fetched by the child's own effect, which is
            // keyed on the path; bumping the epoch remounts it so a re-read
            // happens even when the path did not change.
            patchTab(id, (current) => ({ ...current, epoch: (current.epoch || 0) + 1 }));
            return;
          }
          if (tab.commit !== "" && tab.commit !== undefined) {
            // A blob from history has no metadata to re-read; remounting the
            // viewer is what asks the host for the bytes again.
            patchTab(id, (current) => ({ ...current, epoch: (current.epoch || 0) + 1 }));
            return;
          }
          patchTab(id, (current) => ({ ...current, status: "loading", epoch: (current.epoch || 0) + 1 }));
          // A ticket per tab, not per drawer: refreshing B after A must not
          // cancel A's read, which is what a shared counter would do.
          const tickets = metaTickets.current;
          const ticket = (tickets.get(id) || 0) + 1;
          tickets.set(id, ticket);
          request("meta", { root, path: tab.path }).then((value) => {
            if (tickets.get(id) !== ticket) return;
            patchTab(id, (current) => ({ ...current, meta: value, status: "ready", error: null }));
          }).catch((problem) => {
            if (tickets.get(id) !== ticket) return;
            patchTab(id, (current) => ({ ...current, status: "error", error: problem }));
          });
        };

        /** The four items a tab's context menu offers. */
        const onTabAction = (action, id) => {
          const current = tabList();
          if (action === "refresh") refreshTab(id);
          else if (action === "close") closeTab(id);
          else if (action === "others") closeTabs(current.filter((tab) => tab.id !== id).map((tab) => tab.id));
          else if (action === "all") closeTabs(current.map((tab) => tab.id));
          setTabMenu(null);
        };

        // Re-read every directory the reader currently has open, keeping the
        // tree's shape, plus the status badges a checkout or external edit
        // invalidates.
        const reloadWorkingTree = () => {
          treeGeneration.current += 1;
          setNodes(new Map());
          for (const dirPath of ["", ...expanded]) loadDirectory(dirPath);
          request("status", { root }).then((val) => {
            setGitStatus({
              modified: new Set(val?.modified || []),
              untracked: new Set(val?.untracked || []),
            });
          }).catch(() => {});
        };

        /**
         * The top toolbar's refresh: the tree, the Git panel, and the tab on
         * screen.
         *
         * The tab is refreshed too because that is what the reader is looking
         * at — refreshing the tree around a stale preview would leave the file
         * they care about unchanged.
         */
        const refresh = () => {
          reloadWorkingTree();
          if (side === "git") {
            const state = git.store.get();
            // The commit to come back to belongs to the tab on screen, not to
            // whichever detail the controller happens to hold.
            const keepSha = activeTab !== null && activeTab.kind === "commit"
              ? activeTab.id.slice("commit:".length)
              : "";
            if (state.root !== root) git.reset(root);
            git.loadRepos().then(() => {
              if (keepSha !== "") git.openCommit(keepSha);
            });
          }
          if (activeTabId !== "") refreshTab(activeTabId);
        };

        /** Open one commit in its own tab, or activate the tab already showing it. */
        const openCommit = (commit) => {
          if (commit === null || commit === undefined || typeof commit.sha !== "string") return;
          const sha = commit.sha;
          const title = commit.shortSha || sha.slice(0, 7);
          const id = "commit:" + sha;
          setPane("content");
          // Re-opening the commit already on screen costs nothing: its detail
          // does not depend on the working tree, only on the commit itself.
          const cached = git.store.get();
          const alreadyLoaded = cached.detailStatus === "ready" && cached.detail !== null && cached.detail !== undefined
            && cached.detail.commit !== undefined && cached.detail.commit.sha === sha;
          upsertTab({
            id,
            kind: "commit",
            path: "",
            title,
            // The subject is the useful second line; the hash is already the
            // title, so repeating it would say nothing.
            dir: typeof commit.subject === "string" ? commit.subject : "",
            meta: null,
            commitView: "files",
            commit: "",
            changePath: "",
            origin: null,
            lang: "auto",
          }, { activate: true });
          if (!alreadyLoaded) git.openCommit(sha);
        };

        /**
         * Open one file from a commit in its own tab.
         *
         * The row's path is already root-relative (the host rebased it), so it
         * goes straight through the same `meta` request the tree uses; files
         * outside the root are disabled in the list and never reach here.
         */
        const openCommitFile = (file) => {
          if (file === null || file === undefined || file.outsideRoot === true) return;
          if (typeof file.path !== "string" || file.path === "") return;
          const sha = commitSha;
          // A deleted file has nothing on disk, and any other file may differ
          // from the version this commit recorded. The preview therefore reads
          // the commit's blob, which needs the file's metadata from the same
          // source rather than a `meta` lookup that would hit the disk.
          if (sha !== "") {
            const component = kindOfPath(file.path);
            // A deletion has no blob in this commit, and a rename's old path
            // does too. Both still have their previous contents in the parent,
            // which is the version the reader is asking to see.
            const letter = typeof file.letter === "string" ? file.letter : "";
            const detail = gitState.detail;
            const parentSha = detail && typeof detail.parentSha === "string" ? detail.parentSha : "";
            const fromParent = (letter === "D" || letter === "R") && parentSha !== "";
            // A rename shows the old path, because that is the side that still
            // has content in the parent commit.
            const blobPath = fromParent && typeof file.oldPath === "string" && file.oldPath !== ""
              ? file.oldPath
              : file.path;
            const readSha = fromParent ? parentSha : sha;
            setPane("content");
            const known = detail && Array.isArray(detail.files)
              ? detail.files.find((row) => row.path === file.path)
              : null;
            const id = "file:" + blobPath + "\u0000" + readSha;
            upsertTab({
              id,
              kind: "file",
              path: blobPath,
              rowPath: file.path,
              title: baseNameOf(blobPath) + " @ " + readSha.slice(0, 7),
              dir: baseNameOf(blobPath) + " @ " + readSha.slice(0, 7),
              meta: {
                root: root,
                // The blob path is what the host reads; the display path keeps the
                // row the reader clicked.
                path: blobPath,
                // A rename is read from its old path but highlighted as the row
                // the reader actually clicked.
                rowPath: file.path,
                name: baseNameOf(blobPath),
                displayPath: baseNameOf(blobPath) + " @ " + readSha.slice(0, 7),
                kind: component,
                commit: readSha,
                // Opening a changed file must offer both halves of the question:
                // what this commit changed in it, and what the file looks like.
                // `diffSha` is the commit being viewed (the blob may come from
                // its parent for a deletion), and `oldPath` is what lets the host
                // keep rename detection intact when filtering the patch.
                diffSha: sha,
                oldPath: typeof file.oldPath === "string" && file.oldPath !== "" ? file.oldPath : null,
                // The commit records whether the file was added, modified or
                // deleted; the preview says so instead of looking like a normal
                // working-tree file.
                change: known ? known.change : "",
                changeLetter: known ? known.letter : "",
                deleted: known ? known.letter === "D" : false,
              },
              commit: readSha,
              // Back must return to the changed-file list this row came from,
              // not to the file tree, which is somewhere else entirely.
              origin: { kind: "commit", sha: sha },
              lang: "auto",
            }, { activate: true });
            setError(null);
            return;
          }
          selectFile({ path: file.path, name: baseNameOf(file.path), type: "file" });
        };

        /**
         * Step back one place from the active tab.
         *
         * Three destinations, in the order the reader arrived from: a commit's
         * changed-file list, the working-tree change list, or the file tree.
         * Each step clears the state that belonged to the place being left, so
         * a stale hash or blob path cannot leak into the next preview.
         */
        const goBack = () => {
          const current = activeTab;
          const origin = current === null || current === undefined ? null : current.origin;
          if (origin !== null && origin !== undefined && origin.kind === "commit") {
            // Re-open the changed-file view of the commit this file came from;
            // its hash is what the sidebar is highlighting.
            setPane("content");
            patchTab(current.id, (tab) => ({ ...tab, commitView: "files", commit: "", origin: null }));
            openCommit({ sha: origin.sha });
            return;
          }
          if (origin !== null && origin !== undefined && origin.kind === "changes") {
            setPane("content");
            patchTab(current.id, (tab) => ({ ...tab, commitView: "changes", commit: "", origin: null }));
            return;
          }
          // Nothing to undo inside the pane: hand control back to the sidebar.
          // On a phone that actually swaps panes; on desktop the tree is
          // already alongside, so the selection is cleared instead of the
          // button doing nothing at all.
          closeTab(activeTabId);
          setError(null);
          setPane("tree");
        };

        /**
         * Open one working-tree change as a diff, in its own tab.
         *
         * The main pane shows the patch rather than the file: a deletion has no
         * file to open, and "what changed" is the question the row answers.
         */
        const openWorkspaceChange = (row) => {
          if (row === null || row === undefined || typeof row.path !== "string" || row.path === "") return;
          setPane("content");
          // The pane diffs exactly this path; ignoring the row left it reading
          // whatever file happened to be selected before.
          upsertTab({
            id: "change:" + row.path,
            kind: "change",
            path: row.path,
            title: row.path,
            dir: row.change || "工作区",
            meta: null,
            commitView: "changes",
            changePath: row.path,
            lang: "auto",
          }, { activate: true });
        };

        /**
         * Open one working-tree file as a tab, reading its metadata.
         *
         * Split out from `selectFile` because the drawer's arrival path (a
         * conversation link that names a file) has to open a tab against the
         * root it just resolved, before that root has reached `root` state.
         *
         * @param {string} rootPath - root the path belongs to.
         * @param {string} path - root-relative file path.
         * @param {{activate?: boolean, name?: string}} [options]
         */
        const openFileTab = (rootPath, path, options) => {
          if (typeof path !== "string" || path === "") return;
          const chosenRoot = typeof rootPath === "string" && rootPath !== "" ? rootPath : root;
          const name = options && typeof options.name === "string" ? options.name : baseNameOf(path);
          const id = "file:" + path;
          const existing = findTab(id);
          // A tab already open for this path is re-activated rather than
          // re-read: its contents are on screen already, and the refresh item
          // in its context menu is how the reader asks for a re-read.
          if (existing !== null) {
            activateTab(id);
            return;
          }
          // Selecting from the file tree is always the working tree, so any
          // commit a preview was read from is dropped here — and there is no
          // intermediate pane to return to.
          upsertTab({
            id,
            kind: "file",
            path,
            title: name,
            dir: directoryOf(path),
            meta: null,
            // A brand-new tab has nothing to show yet; `status` is what the
            // pane reads to tell "loading" from "the file is empty".
            status: "loading",
            commit: "",
            commitView: "files",
            changePath: "",
            origin: null,
            // The remembered choice for this file takes effect immediately, so
            // the read that follows is already resolved with it.
            lang: readLangOverride(chosenRoot, path),
          }, { activate: options === undefined || options.activate !== false });
          // Clicking two files quickly must not let the slower answer win: only
          // the newest request for THIS tab may write its state. Tabs are read
          // in parallel now, so the ticket is kept per id.
          const tickets = metaTickets.current;
          const ticket = (tickets.get(id) || 0) + 1;
          tickets.set(id, ticket);
          request("meta", { root: chosenRoot, path }).then((value) => {
            if (tickets.get(id) !== ticket) return;
            patchTab(id, (tab) => ({ ...tab, meta: value, status: "ready", error: null }));
            setError(null);
          }).catch((problem) => {
            if (tickets.get(id) !== ticket) return;
            patchTab(id, (tab) => ({ ...tab, meta: null, status: "error", error: problem }));
            setError(problem);
          });
        };

        const selectFile = (entry) => {
          if (entry === null || entry === undefined || typeof entry.path !== "string") return;
          setPane("content");
          openFileTab(root, entry.path, { name: entry.name });
        };

        /**
         * Pin, or unpin, the language for the active tab's file.
         *
         * The choice is remembered per file and sent with every read, so the
         * host stays the only thing that decides what grammar applies.
         */
        const chooseLang = (next) => {
          const current = activeTab;
          if (current === null || current.meta === null || current.meta === undefined) return;
          patchTab(current.id, (tab) => ({ ...tab, lang: next }));
          writeLangOverride(root, current.meta.path, next);
        };

        const activeRoot = roots.find((row) => row.id === root);
        const treeRows = flattenTree({ expanded, nodes });

        /**
         * The sidebar's two-pane switch, kept out of the tree component so the
         * Git panel and the file tree share exactly one control and one seat.
         */
        const sideTabs = react.createElement("div", {
          className: "fv-side-tabs",
          role: "tablist",
          "aria-label": "侧栏视图",
        },
          react.createElement("button", {
            type: "button",
            role: "tab",
            className: "fv-side-tab",
            "aria-selected": side === "files" ? "true" : "false",
            title: "浏览项目文件",
            onClick: () => {
              // Switching the sidebar back to the tree does not touch the
              // content area: the open tabs stay open, which is the whole point
              // of having them.
              setSide("files");
            },
          }, "文件"),
          react.createElement("button", {
            type: "button",
            role: "tab",
            className: "fv-side-tab",
            "aria-selected": side === "git" ? "true" : "false",
            title: "查看 Git 分支、提交与改动文件",
            onClick: () => {
              setSide("git");
              git.ensure();
            },
          }, react.createElement(SvgIconBranch, { size: 13 }), "Git"));

        /**
         * The hash the pane is describing.
         *
         * A commit tab names its own sha, which is what the header and the diff
         * read: the Git controller holds one detail at a time, so trusting it
         * alone would label this tab with whichever commit was opened last.
         */
        const activeCommitSha = activeTab !== null && activeTab.kind === "commit"
          ? activeTab.id.slice("commit:".length)
          : "";
        const commitSha = activeCommitSha !== ""
          ? activeCommitSha
          : (gitState.detail !== null && gitState.detail !== undefined && gitState.detail.commit !== undefined
            ? gitState.detail.commit.sha
            : "");
        // The main pane is showing something commit-shaped whenever it is not
        // the ordinary file preview: a commit, or one working-tree change.
        const commitHeadline = commitView === "changes"
          ? "工作区改动"
          : (showCommit && activeTab !== null && activeTab.kind === "commit"
            ? "提交 " + (commitSha === "" ? "" : commitSha.slice(0, 7))
            : "");

        const handleDownloadItem = (entry) => {
          if (!entry) return;
          const targetPath = entry.path || entry.displayPath;
          const targetName = entry.name || baseNameOf(targetPath);
          performDownload(request, root, targetPath, targetName, showToast);
        };

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
          react.createElement("div", {
            className: "fv-shell",
            "data-fullscreen": fullscreen ? "true" : "false",
            "data-mobile": isMobile ? "true" : "false",
            "data-edge-resizing": edgeResizing ? "true" : "false",
            // Only a dragged width overrides the stylesheet default; 0 leaves
            // the responsive `min(64vw, 1100px)` in charge.
            style: shellWidth > 0 && !fullscreen ? { width: shellWidth + "px" } : undefined,
          },
            // The drawer's own resize handle, seated on its leading edge. It is
            // skipped on a phone and in fullscreen, where the panel already
            // spans the frame and there is nothing to widen into.
            isMobile || fullscreen
              ? null
              : react.createElement("div", {
                ref: edgeRef,
                className: "fv-edge",
                role: "separator",
                tabIndex: 0,
                "aria-orientation": "vertical",
                "aria-label": "调整文件查看器宽度",
                "aria-valuenow": shellWidth > 0 ? shellWidth : undefined,
                "aria-valuemin": MIN_SHELL_WIDTH,
                "aria-valuemax": 4000,
                title: "拖动调整查看器宽度，双击恢复默认",
                "data-dragging": edgeResizing ? "true" : "false",
                onPointerDown: onEdgePointerDown,
                onPointerMove: onEdgePointerMove,
                onPointerUp: onEdgePointerUp,
                onPointerCancel: onEdgePointerUp,
                onDoubleClick: onEdgeDoubleClick,
                onKeyDown: onEdgeKeyDown,
              }),
            react.createElement("div", { className: "fv-head" },
              // The title names the pane the sidebar is showing, so the drawer
              // never claims to be a file browser while listing Git history.
              react.createElement("span", { className: "fv-title" }, side === "git" ? "Git" : "文件"),
              roots.length > 1
                ? react.createElement("select", {
                  className: "fv-root-select",
                  value: root,
                  "aria-label": "工作区与安全路径",
                  onChange: (event) => setRoot(event.target.value),
                }, ...renderRootOptions(roots))
                : react.createElement("span", { className: "fv-crumbs" }, activeRoot ? activeRoot.label : ""),
              // The tree shows structure, so the header carries the selected
              // file's path instead of navigable breadcrumbs.
              react.createElement("div", { className: "fv-crumbs fv-file-path", title: showCommit ? "" : (meta === null ? "" : meta.path) },
                showCommit ? "" : (meta === null ? "" : meta.path)),
              // Only offered where it changes anything: images, PDFs, sheets and
              // documents do not scroll sideways the way source lines do.
              !showCommit && meta !== null && !meta.tooLarge && (meta.kind === "text" || meta.kind === "markdown" || meta.kind === "json")
                ? react.createElement("button", {
                  type: "button",
                  className: "fv-icon-button",
                  "aria-pressed": wrap ? "true" : "false",
                  "aria-label": wrap ? "取消自动换行" : "自动换行",
                  title: wrap ? "取消自动换行" : "自动换行",
                  onClick: () => setWrap((current) => !current),
                }, react.createElement(SvgIconWrap, { size: 15 }))
                : null,
              !showCommit && meta !== null && meta.kind !== "directory"
                ? react.createElement("button", {
                  type: "button",
                  className: "fv-icon-button fv-btn-download",
                  "aria-label": "下载文件",
                  title: "下载文件",
                  onClick: () => handleDownloadItem(meta),
                }, react.createElement(SvgIconDownload, { size: 15 }))
                : null,
              react.createElement("button", {
                type: "button", className: "fv-icon-button", "aria-label": "刷新", title: "刷新", onClick: refresh,
              }, react.createElement(SvgIconRefresh, { size: 15 })),
              react.createElement("button", {
                type: "button",
                className: "fv-icon-button",
                "aria-pressed": hidden ? "true" : "false",
                "aria-label": hidden ? "隐藏点文件" : "显示点文件",
                title: hidden ? "隐藏点文件" : "显示点文件",
                onClick: () => setHidden((current) => !current),
              }, react.createElement(SvgIconDotfiles, { size: 15 })),
              react.createElement("button", {
                type: "button",
                className: "fv-icon-button fv-btn-safepaths",
                "aria-label": "安全访问路径设置",
                title: "安全访问路径设置",
                onClick: () => setSafeModalOpen(true),
              }, react.createElement(SvgIconShield, { size: 15 })),
              react.createElement("button", {
                type: "button",
                className: "fv-icon-button fv-btn-fullscreen",
                "aria-pressed": fullscreen ? "true" : "false",
                "aria-label": fullscreen ? "退出全屏" : "全屏",
                title: fullscreen ? "退出全屏" : "全屏",
                onClick: () => setFullscreen((current) => !current),
              }, react.createElement(SvgIconFullscreen, { size: 15, exit: Boolean(fullscreen) })),
              react.createElement("button", {
                type: "button", className: "fv-icon-button fv-btn-close", "aria-label": "关闭", title: "关闭文件查看器", onClick: () => openStore.set(null),
              }, react.createElement(SvgIconClose, { size: 15 }))),
            react.createElement("div", { className: "fv-body", "data-pane": pane, "data-resizing": isResizing ? "true" : "false", "data-mobile": isMobile ? "true" : "false" },
              side === "git"
                ? react.createElement(GitSidebar, {
                  state: gitState,
                  width: isMobile ? undefined : treeWidth,
                  header: sideTabs,
                  selectedSha: commitSha,
                  onPickRepo: git.pickRepo,
                  onPickBranch: git.pickBranch,
                  onCheckout: (branch) => {
                    // A checkout rewrites the working tree, so the tree's
                    // modified/untracked badges have to be re-read too. The
                    // commit being viewed survives: it is history, not the
                    // working tree, and reloading the repository clears it.
                    const keepSha = commitSha;
                    const state = git.store.get();
                    // The repository lives above this root, so the checkout
                    // reaches outside it. The host refuses without an explicit
                    // consent flag, which is exactly what this question is.
                    const consent = state.scope === "parent"
                      ? (typeof window === "undefined" || typeof window.confirm !== "function"
                        || window.confirm("该分支所在的仓库位于当前根目录的上级，检出会一并改写根目录以外的文件。确定继续吗？"))
                      : true;
                    if (!consent) return;
                    git.checkout(branch, state.scope === "parent").then(() => {
                      reloadWorkingTree();
                      if (keepSha !== "") git.openCommit(keepSha);
                    });
                  },
                  onSelectCommit: openCommit,
                  onSelectChange: openWorkspaceChange,
                  onRefreshChanges: git.loadChanges,
                  onLoadMore: git.loadMore,
                  onRetry: git.loadRepos,
                })
                : react.createElement(Tree, {
                  rows: treeRows,
                  selected: meta === null ? "" : meta.path,
                  onToggle: toggleDirectory,
                  onSelect: selectFile,
                  // Always offered: the DOM fallback covers hosts that leave the
                  // bridge without input props, where gating on the store made the
                  // button vanish with no way to reach it.
                  onMention: mention,
                  onContextMenu: (ctx) => setContextMenu(ctx),
                  width: isMobile ? undefined : treeWidth,
                  gitStatus,
                  header: sideTabs,
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
                // The tab strip sits above the head so the head keeps naming
                // the active tab alone; the two together read as "these are
                // open, this one is on screen".
                react.createElement(TabStrip, {
                  tabs,
                  activeId: activeTabId,
                  onActivate: activateTab,
                  onClose: closeTab,
                  onContextMenu: (menu) => setTabMenu(menu),
                  menuFor: tabMenu === null || tabMenu === undefined ? "" : tabMenu.tabId,
                }),
                react.createElement("div", { className: "fv-main-head" },
                  (() => {
                    // The control returns one step, so it names that step and
                    // is disabled when there is nowhere to go — a button that
                    // silently does nothing reads as broken.
                    const originKind = previewOrigin === null || previewOrigin === undefined ? null : previewOrigin.kind;
                    const backTarget = originKind === "commit"
                      ? "返回变更文件列表"
                      : (originKind === "changes" ? "返回工作区改动列表" : "返回文件列表");
                    // On a phone the panes are exclusive, so leaving the content
                    // pane is always meaningful; on desktop the sidebar is
                    // already visible and only an origin is worth returning to.
                    const canGoBack = isMobile || pane === "content"
                      ? (previewOrigin !== null || meta !== null || showCommit)
                      : false;
                    return react.createElement("button", {
                      type: "button",
                      className: "fv-icon-button fv-btn-back",
                      "aria-label": backTarget,
                      title: backTarget,
                      disabled: !canGoBack,
                      onClick: goBack,
                    }, react.createElement("span", { "aria-hidden": "true" }, "‹"));
                  })(),
                  react.createElement("span", { className: "fv-main-name" },
                    commitHeadline !== ""
                      ? commitHeadline
                      : (activeTab === null
                        ? "未选择文件"
                        : (meta === null ? activeTab.title : meta.name))),
                  meta !== null && !showCommit && typeof meta.size === "number"
                    ? react.createElement("span", null, formatBytes(meta.size))
                    : null,
                  // The language picker sits with the file it applies to, and
                  // is offered only for source views: an image, sheet or
                  // document has no grammar to choose.
                  meta !== null && !showCommit && !meta.tooLarge && (meta.kind === "text" || meta.kind === "markdown" || meta.kind === "json")
                    ? react.createElement(LanguagePicker, {
                      choice: localeTagOfActive,
                      catalog: languageCatalog,
                      source: meta.langSource,
                      resolved: meta.lang,
                      onChange: chooseLang,
                    })
                    : null),
                error !== null && meta === null && !showCommit && activeTab === null
                  ? react.createElement("div", { className: "fv-note fv-error" },
                    react.createElement("span", null, messageOf(error)),
                    error?.code === "outside-root"
                      ? react.createElement("button", {
                        type: "button",
                        className: "fv-button",
                        style: { marginTop: "6px" },
                        onClick: () => {
                          const reqPath = error?.details?.realPath || request_?.filePath || request_?.path || "";
                          setPrefillPath(reqPath ? parentOf(reqPath) : "");
                          setSafeModalOpen(true);
                        },
                      }, "配置安全访问路径")
                      : null)
                  : activeTab !== null && activeTab.status === "error" && activeTab.error !== null && activeTab.error !== undefined
                    ? react.createElement("div", { className: "fv-note fv-error" },
                      react.createElement("span", null, messageOf(activeTab.error)),
                      activeTab.error?.code === "outside-root"
                        ? react.createElement("button", {
                          type: "button",
                          className: "fv-button",
                          style: { marginTop: "6px" },
                          onClick: () => {
                            const reqPath = activeTab.error?.details?.realPath || activeTab.path || "";
                            setPrefillPath(reqPath ? parentOf(reqPath) : "");
                            setSafeModalOpen(true);
                          },
                        }, "配置安全访问路径")
                        : null)
                    : showCommit
                      ? react.createElement(ErrorBoundary, {
                        // The epoch is part of the key so "刷新当前" remounts the
                        // pane instead of showing the same cached answer.
                        resetKey: "commit\u0000" + commitSha + "\u0000" + (activeTab === null ? 0 : (activeTab.epoch || 0)),
                      }, commitView === "changes"
                        ? react.createElement(WorkspaceChangeDetail, {
                          key: (activeTab === null ? "" : activeTab.id) + "\u0000" + (activeTab === null ? 0 : (activeTab.epoch || 0)),
                          state: gitState,
                          path: previewChangePath,
                          request,
                          repo: gitState.repoId,
                        })
                        : react.createElement(CommitDetail, {
                          state: gitState,
                          // A rename is read from its old path but highlighted as
                          // the row that was clicked, so the two stay in step.
                          selectedPath: meta === null ? "" : (meta.rowPath || meta.path),
                          onSelectFile: openCommitFile,
                          view: commitView,
                          onSwitchView: (next) => {
                            if (activeTab !== null) patchTab(activeTab.id, (tab) => ({ ...tab, commitView: next }));
                          },
                          onLoadDiff: () => {
                            const sha = commitSha;
                            if (sha !== "") git.loadCommitDiff(sha);
                          },
                        }))
                      : react.createElement(ErrorBoundary, {
                        // One viewer per tab (and per refresh epoch), so no
                        // paging or blob state survives a tab switch.
                        resetKey: activeTab === null
                          ? ""
                          : activeTab.id + "\u0000" + (activeTab.epoch || 0),
                      }, activeTab === null
                        ? react.createElement(FileView, {
                          meta: null,
                          root,
                          api: props.api,
                          wrap,
                          lang: "auto",
                          onDownload: handleDownloadItem,
                          commit: "",
                          repo: gitState.repoId,
                        })
                        : react.createElement(FileView, {
                          meta,
                          root,
                          api: props.api,
                          wrap,
                          lang: localeTagOfActive,
                          onDownload: handleDownloadItem,
                          // Empty for a working-tree file; a hash for one opened
                          // from history, which makes the read a blob lookup.
                          commit: previewCommit,
                          repo: gitState.repoId,
                          // A tab is created before its metadata arrives, so the
                          // pane has to say "reading" instead of "pick a file".
                          loading: activeTab.status === "loading",
                        })))),
            contextMenu !== null
              ? react.createElement(ContextMenu, {
                menu: contextMenu,
                rootPath: activeRoot ? (activeRoot.path || activeRoot.id) : root,
                onClose: () => setContextMenu(null),
                onMention: mention,
                onToast: showToast,
                onDownload: handleDownloadItem,
              })
              : null,
            // The tab menu is a separate component with a separate subject; it
            // is rendered last so it stacks above the tree's menu if both were
            // somehow open, which cannot happen but must not paint twice.
            tabMenu !== null && tabMenu !== undefined
              ? react.createElement(TabContextMenu, {
                menu: tabMenu,
                tabs,
                onClose: () => setTabMenu(null),
                onAction: onTabAction,
              })
              : null,
            safeModalOpen
              ? react.createElement(SafePathsModal, {
                open: safeModalOpen,
                onClose: () => { setSafeModalOpen(false); setPrefillPath(""); },
                onToast: showToast,
                onUpdated: () => {
                  request("roots", {}).then((val) => {
                    setRoots(val?.roots || []);
                  }).catch(() => {});
                },
                prefillPath,
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
       * Seated on the composer toolbar (conversation.input.left).
       * 1. Publishes the composer's draft accessors so tree row mentions can insert at caret;
       * 2. Renders the native 28x28 icon button to open/toggle the file viewer drawer.
       */
      function ComposerBridge(props) {
        // The draft text lives on the input state snapshot; writing it back is a
        // separate action object. Neither is reachable from the drawer's subtree.
        const draft = props && props.input ? props.input.draft : undefined;
        const setDraft = props && props.inputActions ? props.inputActions.setDraft : undefined;
        react.useEffect(() => {
          if (typeof setDraft !== "function") return undefined;
          composerStore.set({
            draft: typeof draft === "string" ? draft : "",
            setDraft,
            insertText: props.inputActions ? props.inputActions.insertText : undefined,
            captureInsertion: props.inputActions ? props.inputActions.captureInsertion : undefined,
            inputActions: props.inputActions,
            input: props.input,
          });
          return () => { composerStore.set(null); };
        }, [draft, setDraft, props && props.inputActions]);

        return react.createElement("button", {
          type: "button",
          className: "fv-composer-entry",
          title: "查看项目文件",
          "aria-label": "查看项目文件",
          onClick: () => {
            const sid = (props && props.sessionId) || sessionStore.get();
            openStore.set(openStore.get() === null ? { sessionId: sid } : null);
          },
        }, FolderIcon === null
          ? react.createElement("span", { "aria-hidden": "true" }, "\u{1F4C1}")
          : react.createElement(FolderIcon, { size: 16 }));
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

        // Floating button is strictly disabled; return null across all platforms.
        return null;
      }

      // The overlay seat carries the drawer.
      function ViewerSurfaces(props) {
        return react.createElement(ViewerOverlay, props);
      }

      ctx.slots.inject(OVERLAY_SLOT, () => ctx.slots.register({
        name: OVERLAY_SLOT,
        id: "file-viewer",
        order: 30,
        inject: () => ({ api: ctx.connection.api }),
      }, ViewerSurfaces));

      // Seated exclusively on the composer toolbar (conversation.input.left).
      // Available both during blank new sessions (centered hero composer) and regular sessions.
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

      // Global capture click listener catches file mentions before host handlers
      setupGlobalFileClickInterceptor(openStore, sessionStore);

      // Wrap legacy workspaces.openPath (workspaces is declared in inject)
      wrapWorkspaceOpenPath(ctx, openStore, sessionStore);

      // Intercept any openWorkspacePath RPC calls (connection is declared in inject)
      wrapConnectionRpc(ctx, openStore, sessionStore);

      // The changes card's native open route bypasses the RPC carrier entirely.
      wrapChangesOpenFetch(openStore, sessionStore);

      // Wrap sidebarRight if already registered or whenever injected. Direct
      // property access is not safe here: sidebarRight is not part of this
      // plugin's inject, so cordis would reject the read outright.
      if (typeof ctx.get === "function") {
        try {
          const sr = ctx.get("sidebarRight", false);
          if (sr) wrapSidebarRight(sr, openStore, sessionStore);
        } catch (_) {}
      }
      if (typeof ctx.inject === "function") {
        try {
          ctx.inject(["sidebarRight"], (srCtx) => {
            if (srCtx && srCtx.sidebarRight) {
              wrapSidebarRight(srCtx.sidebarRight, openStore, sessionStore);
            }
          });
        } catch (_) {}
      }

      if (typeof window !== "undefined") {
        const triggerOpen = (payload) => {
          const sid = (payload && payload.sessionId) || sessionStore.get();
          openStore.set({ ...(payload || {}), sessionId: sid, _t: Date.now() });
        };
        const handleOpen = (e) => triggerOpen(e.detail);
        window.__dsh_open_file_viewer = triggerOpen;
        window.addEventListener("dsh:open-file-viewer", handleOpen);
        return () => {
          window.removeEventListener("dsh:open-file-viewer", handleOpen);
          if (window.__dsh_open_file_viewer === triggerOpen) {
            delete window.__dsh_open_file_viewer;
          }
        };
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.internals = {
      RPC_CHANNEL, OVERLAY_SLOT, HEADER_SLOT, SESSION_SLOT, COMPOSER_SLOT, STYLE_ID, WINDOW_LINES, css,
      ERROR_COPY, appendMention, insertMentionAtCaret, baseNameOf, formatBytes, parentOf, ancestorsOf, flattenTree, columnLabel,
      mediaTypeOf, messageOf, createStore, createRequest, blobOf, ensureStyles,
      ENTRY_POSITION_KEY, DRAG_SLOP, settleEntry, readEntryPosition, writeEntryPosition,
      TREE_WIDTH_KEY, DEFAULT_TREE_WIDTH, MIN_TREE_WIDTH, MAX_TREE_WIDTH, readTreeWidth, writeTreeWidth,
      SHELL_WIDTH_KEY, MIN_SHELL_WIDTH, readShellWidth, writeShellWidth, clampShellWidth,
      LANG_OVERRIDES_KEY, LANG_OVERRIDES_MAX, readLangOverrides, writeLangOverrides, readLangOverride, writeLangOverride,
      langOverrideKey, isKnownLanguageId, setLanguageCatalog, getLanguageCatalog: () => languageCatalog, LanguagePicker,
      MARKDOWN_LABELS, MARKDOWN_CODE_LABELS, READ_BLOCK_LABELS, JSON_TREE_LABELS, DIFF_BLOCK_LABELS, ErrorBoundary,
      openViewerForPath, wrapWorkspaceOpenPath, wrapConnectionRpc, wrapChangesOpenFetch, wrapSidebarRight, parseFileResource, setupGlobalFileClickInterceptor, extractClickedPath, normalizeClickedPath, looksLikeFilePath, isFileOpenControl, isFileMentionCode, renderRootOptions,
      triggerDownload, performDownload, isDesktopShell, SvgIconDownload, SvgIconBranch, SvgIconCommit,
      // Git panel: controller, views and the small formatters they share.
      GIT_PAGE_SIZE, createGitController, GitSidebar, CommitDetail, WorkspaceChangeDetail, DiffView, kindOfPath,
      formatCommitDate, formatCommitTimestamp,
      // Content-area tabs: the strip, its four-item menu and the path helper
      // that gives a tab its secondary directory line.
      directoryOf, TabStrip, TabContextMenu, parseHeadings, MarkdownOutline, SvgIconOutline,
      TAB_MENU_ITEMS, tabsAfterClose, tabsAfterUpsert,
    };
    return module.exports;
  }
});
