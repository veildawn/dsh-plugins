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
    const { ReadBlock, MarkdownText, JsonTree, IconFolderOutline16, IconCloseOutline16 } = primitives;

    const RPC_CHANNEL = "/dsh-file-viewer";
    const OVERLAY_SLOT = "shell.overlay";
    const ACTION_SLOT = "sidebar.footer.action";
    const STYLE_ID = "dsh-file-viewer-styles";
    const WINDOW_LINES = 500;
    const inject = ["slots", "connection"];

    const css = `
      .fv-scrim{position:absolute;inset:0;z-index:40;display:flex;align-items:stretch;justify-content:center;padding:24px;background:color-mix(in srgb,#000 42%,transparent);pointer-events:auto;color-scheme:light dark}
      .fv-shell{display:flex;flex-direction:column;width:100%;max-width:1440px;min-height:0;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-base);box-shadow:var(--dsw-shadow-lv3);font-family:var(--dsw-font-family);color:var(--dsw-alias-label-primary)}
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
      .fv-body{display:flex;flex:1 1 auto;min-height:0}
      .fv-tree{display:flex;flex:none;flex-direction:column;width:280px;min-height:0;overflow-y:auto;border-right:1px solid var(--dsw-alias-border-l1);padding:6px;gap:1px;overscroll-behavior:contain}
      .fv-row{display:flex;align-items:center;gap:8px;width:100%;min-height:32px;padding:4px 8px;border:none;border-radius:8px;background:none;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);text-align:left;cursor:pointer}
      .fv-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .fv-row[aria-current="true"]{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover))}
      .fv-row-name{flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
      .fv-row-size{flex:none;color:var(--dsw-alias-label-caption);font-size:11px;font-variant-numeric:tabular-nums}
      .fv-glyph{flex:none;width:16px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:11px}
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
      @media(max-width:860px){
        .fv-scrim{padding:0}
        .fv-shell{max-width:none;border:none;border-radius:0}
        .fv-tree{width:100%;border-right:none}
        .fv-body[data-pane="content"] .fv-tree,.fv-body[data-pane="tree"] .fv-main{display:none}
        .fv-crumbs{font-size:11px}
      }
    `;

    /** Inject the stylesheet once per document. */
    function ensureStyles(doc) {
      if (!doc || doc.getElementById(STYLE_ID)) return;
      const tag = doc.createElement("style");
      tag.id = STYLE_ID;
      tag.textContent = css;
      doc.head.appendChild(tag);
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

    function baseNameOf(path) {
      const trimmed = String(path || "").replace(/[\\/]+$/, "");
      const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
      return cut < 0 ? trimmed : trimmed.slice(cut + 1);
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

    /** Path segments plus the cumulative path each one navigates to. */
    function crumbsOf(path) {
      const parts = String(path || "").split("/").filter((part) => part !== "");
      const rows = [];
      let joined = "";
      for (const part of parts) {
        joined = joined === "" ? part : joined + "/" + part;
        rows.push({ name: part, path: joined });
      }
      return rows;
    }

    function parentOf(path) {
      const trimmed = String(path || "").replace(/\/+$/, "");
      const cut = trimmed.lastIndexOf("/");
      return cut < 0 ? "" : trimmed.slice(0, cut);
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
      const openStore = createStore(false);
      const request = createRequest(ctx.connection);

      /** One directory listing pane. */
      function Tree({ root, path, entries, selected, loading, onOpen, onSelect }) {
        if (loading && entries.length === 0) {
          return react.createElement("div", { className: "fv-note" }, "正在读取目录…");
        }
        const rows = [];
        if (path !== "") {
          rows.push(react.createElement("button", {
            key: "..", type: "button", className: "fv-row", onClick: () => onOpen(parentOf(path)),
          },
            react.createElement("span", { className: "fv-glyph" }, "\u2191"),
            react.createElement("span", { className: "fv-row-name" }, "上一级")));
        }
        for (const entry of entries) {
          const isDirectory = entry.type === "directory";
          rows.push(react.createElement("button", {
            key: entry.path,
            type: "button",
            className: "fv-row",
            "aria-current": !isDirectory && entry.path === selected ? "true" : undefined,
            title: entry.name,
            onClick: () => (isDirectory ? onOpen(entry.path) : onSelect(entry)),
          },
            react.createElement("span", { className: "fv-glyph" }, isDirectory ? "\u25B8" : "\u00B7"),
            react.createElement("span", { className: "fv-row-name" }, entry.name),
            typeof entry.size === "number" && !isDirectory
              ? react.createElement("span", { className: "fv-row-size" }, formatBytes(entry.size))
              : null));
        }
        if (rows.length === 0) rows.push(react.createElement("div", { key: "empty", className: "fv-note" }, "空目录"));
        return react.createElement("div", { className: "fv-tree", role: "list", "aria-label": "文件列表" }, ...rows);
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
          react.createElement(MarkdownText, { text: state.markdown }),
          state.warnings.length > 0
            ? react.createElement("div", { className: "fv-note" }, `转换时有 ${state.warnings.length} 处格式降级（图片或复杂排版）。`)
            : null);
      }

      /** Text, Markdown and JSON: one windowed read, three renderings. */
      function TextView({ meta, root }) {
        const [state, setState] = react.useState({ status: "loading", data: null, error: null });
        const [offset, setOffset] = react.useState(1);
        const [raw, setRaw] = react.useState(false);
        react.useEffect(() => {
          setOffset(1);
          setRaw(false);
        }, [root, meta.path]);
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

        let body;
        if (data.kind === "markdown" && !raw && typeof data.text === "string") {
          body = react.createElement(MarkdownText, { text: data.text });
        } else if (data.kind === "json" && !raw && typeof data.text === "string") {
          body = jsonBodyOf(data.text);
        } else {
          body = react.createElement(ReadBlock, {
            label: data.name,
            lines: data.lines,
            totalLines: data.totalLines,
            lang: data.lang,
            maxLines: data.lines.length,
          });
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

        return react.createElement(react.Fragment, null,
          react.createElement("div", { className: "fv-content" },
            (data.kind === "markdown" || data.kind === "json") && typeof data.text === "string"
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
            return react.createElement(JsonTree, { data: parsed, expandTopLevel: true, copyable: true });
          }
        } catch (error) {
          void error;
        }
        return react.createElement(MarkdownText, { text: "```json\n" + text + "\n```" });
      }

      /** Pick the viewer for a file and keep unsupported formats useful. */
      function FileView({ meta, root, api }) {
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
        if (meta.kind === "image" || meta.kind === "pdf") return react.createElement(BinaryView, { meta, root });
        if (meta.kind === "sheet") {
          return react.createElement("div", { className: "fv-content" }, react.createElement(SheetView, { meta, root }));
        }
        if (meta.kind === "doc") {
          return react.createElement("div", { className: "fv-content" }, react.createElement(DocView, { meta, root }));
        }
        return react.createElement(TextView, { meta, root });
      }

      /** The overlay page: root picker, breadcrumbs, tree and viewer. */
      function ViewerOverlay(props) {
        const open = useStore(openStore);
        const [roots, setRoots] = react.useState([]);
        const [root, setRoot] = react.useState("");
        const [path, setPath] = react.useState("");
        const [entries, setEntries] = react.useState([]);
        const [listing, setListing] = react.useState(false);
        const [meta, setMeta] = react.useState(null);
        const [hidden, setHidden] = react.useState(false);
        const [error, setError] = react.useState(null);
        const [pane, setPane] = react.useState("tree");

        react.useEffect(() => {
          if (!open) return undefined;
          let live = true;
          request("roots").then((value) => {
            if (!live) return;
            setRoots(value.roots || []);
            setRoot((current) => (current !== "" ? current : (value.roots || [])[0]?.id || ""));
            setError(null);
          }).catch((problem) => {
            if (live) setError(problem);
          });
          return () => { live = false; };
        }, [open]);

        react.useEffect(() => {
          if (!open || root === "") return undefined;
          let live = true;
          setListing(true);
          request("list", { root, path, hidden }).then((value) => {
            if (!live) return;
            setEntries(value.entries || []);
            setError(null);
          }).catch((problem) => {
            if (!live) return;
            setEntries([]);
            setError(problem);
          }).finally(() => {
            if (live) setListing(false);
          });
          return () => { live = false; };
        }, [open, root, path, hidden]);

        react.useEffect(() => {
          if (!open) return undefined;
          const onKeyDown = (event) => {
            if (event.key === "Escape") openStore.set(false);
          };
          document.addEventListener("keydown", onKeyDown);
          return () => document.removeEventListener("keydown", onKeyDown);
        }, [open]);

        if (!open) return null;

        const openDirectory = (next) => {
          setPath(next);
          setMeta(null);
        };
        const selectFile = (entry) => {
          setPane("content");
          request("meta", { root, path: entry.path }).then((value) => {
            setMeta(value);
            setError(null);
          }).catch((problem) => {
            setMeta(null);
            setError(problem);
          });
        };

        const crumbs = crumbsOf(path);
        const activeRoot = roots.find((row) => row.id === root);

        return react.createElement("div", {
          className: "fv-scrim",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": "文件查看器",
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) openStore.set(false);
          },
        },
          react.createElement("div", { className: "fv-shell" },
            react.createElement("div", { className: "fv-head" },
              react.createElement("span", { className: "fv-title" }, "文件"),
              roots.length > 1
                ? react.createElement("select", {
                  className: "fv-root-select",
                  value: root,
                  "aria-label": "工作区",
                  onChange: (event) => {
                    setRoot(event.target.value);
                    setPath("");
                    setMeta(null);
                  },
                }, ...roots.map((row) => react.createElement("option", { key: row.id, value: row.id }, row.label)))
                : react.createElement("span", { className: "fv-crumbs" }, activeRoot ? activeRoot.label : ""),
              react.createElement("div", { className: "fv-crumbs" },
                react.createElement("button", { type: "button", className: "fv-crumb", onClick: () => openDirectory("") }, "根目录"),
                ...crumbs.flatMap((crumb, index) => [
                  react.createElement("span", { key: "sep" + index, className: "fv-crumb-sep" }, "/"),
                  react.createElement("button", {
                    key: crumb.path, type: "button", className: "fv-crumb", title: crumb.name,
                    onClick: () => openDirectory(crumb.path),
                  }, crumb.name),
                ])),
              react.createElement("button", {
                type: "button",
                className: "fv-icon-button",
                "aria-pressed": hidden ? "true" : "false",
                title: hidden ? "隐藏点文件" : "显示点文件",
                onClick: () => setHidden((current) => !current),
              }, react.createElement("span", { "aria-hidden": "true" }, "\u00B7*")),
              react.createElement("button", {
                type: "button", className: "fv-icon-button", "aria-label": "关闭", onClick: () => openStore.set(false),
              }, IconCloseOutline16
                ? react.createElement(IconCloseOutline16, { size: 16 })
                : react.createElement("span", { "aria-hidden": "true" }, "\u2715"))),
            react.createElement("div", { className: "fv-body", "data-pane": pane },
              react.createElement(Tree, {
                root, path, entries, loading: listing,
                selected: meta === null ? "" : meta.path,
                onOpen: openDirectory,
                onSelect: selectFile,
              }),
              react.createElement("div", { className: "fv-main" },
                react.createElement("div", { className: "fv-main-head" },
                  react.createElement("button", {
                    type: "button", className: "fv-icon-button", "aria-label": "返回文件列表", onClick: () => setPane("tree"),
                  }, react.createElement("span", { "aria-hidden": "true" }, "\u2039")),
                  react.createElement("span", { className: "fv-main-name" }, meta === null ? "未选择文件" : meta.name),
                  meta !== null && typeof meta.size === "number"
                    ? react.createElement("span", null, formatBytes(meta.size))
                    : null),
                error !== null && meta === null
                  ? react.createElement("div", { className: "fv-note fv-error" }, messageOf(error))
                  : react.createElement(FileView, { meta, root, api: props.api })))));
      }

      /** Sidebar entry button. */
      function ViewerAction(props) {
        return react.createElement("button", {
          type: "button",
          className: "fv-icon-button",
          title: "文件查看器",
          "aria-label": "文件查看器",
          onClick: () => openStore.set(!openStore.get()),
        }, IconFolderOutline16
          ? react.createElement(IconFolderOutline16, { size: 16 })
          : react.createElement("span", { "aria-hidden": "true" }, "\u{1F5C1}"),
          props && props.wide ? react.createElement("span", { style: { marginLeft: 8 } }, "文件") : null);
      }

      ctx.slots.inject(OVERLAY_SLOT, () => ctx.slots.register({
        name: OVERLAY_SLOT,
        id: "file-viewer",
        order: 30,
        inject: () => ({ api: ctx.connection.api }),
      }, ViewerOverlay));

      ctx.slots.inject(ACTION_SLOT, () => ctx.slots.register({
        name: ACTION_SLOT,
        id: "file-viewer",
        order: 30,
      }, ViewerAction));

      return { openStore };
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.internals = {
      RPC_CHANNEL, OVERLAY_SLOT, ACTION_SLOT, STYLE_ID, WINDOW_LINES, css,
      ERROR_COPY, baseNameOf, formatBytes, crumbsOf, parentOf, columnLabel,
      mediaTypeOf, messageOf, createStore, createRequest, blobOf, ensureStyles,
    };
    return module.exports;
  }
});
