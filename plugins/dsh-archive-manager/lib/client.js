/**
 * dsh-archive-manager client bundle
 *
 * Follows the established client-bundle contract used by dsh-file-viewer /
 * dsh-remote-control / dsh-plugin-manager:
 * - `window.__ModuleLoader__.load({ id, factory: (require) => ... })` — the
 *   factory receives ONLY `require`; exports are assigned onto the module's
 *   own `exports` object.
 * - RPC over `ctx.connection.rpc.call(RPC_CHANNEL, method, payload)` with the
 *   `{ ok, value }` / `{ ok: false, error }` envelope.
 * - Entry slot: `sidebar.footer.action` (a real list-kind slot of the
 *   `sidebar` shell — see @deepseek-ai/dsh-client-ui-sidebar). Root-scope
 *   slot components automatically receive the `useWorkspaces` selector hook,
 *   which drives the reactive archive-count badge.
 * - Mobile: the sidebar shell renders inside the mobile drawer; the modal
 *   becomes a bottom sheet under 768px with full-width fit, vertical stack
 *   cards, and a `window.__dsh_open_archive_manager` global plus
 *   `dsh:open-archive-manager` window event for host-shell entry points.
 */

window.__ModuleLoader__.load({
  id: "dsh-archive-manager",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");

    const RPC_CHANNEL = "/dsh-archive-manager-rpc";
    const FOOTER_SLOT = "sidebar.footer.action";
    const STYLE_ID = "dsh-archive-manager-styles";
    const OPEN_EVENT = "dsh:open-archive-manager";
    const inject = ["slots", "connection", "workspaces"];
    /** Incremental-render window: long archive lists render in pages on mobile. */
    const PAGE_SIZE = 50;

    const css = `
      .dam-btn{display:flex;align-items:center;justify-content:space-between;box-sizing:border-box;width:100%;min-height:34px;padding:4px 10px;margin:2px 0;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);cursor:pointer;text-align:left;user-select:none}
      .dam-btn:hover,.dam-btn:active{background:var(--dsw-alias-interactive-bg-hover)}
      .dam-btn-main{display:flex;align-items:center;gap:8px;min-width:0}
      .dam-btn-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dam-badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-foreground,#fff);font-size:11px;font-weight:600;box-sizing:border-box}

      /* 弹窗遮罩与卡片 */
      .dam-backdrop{position:fixed;inset:0;z-index:2000;display:grid;place-items:center;padding:16px;box-sizing:border-box;background:rgba(0,0,0,.48);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);animation:dam-fade .14s ease-out;overflow:hidden}
      .dam-card{box-sizing:border-box;display:flex;flex-direction:column;gap:10px;width:min(100%,740px);max-width:100%;max-height:min(85vh,720px);padding:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff));box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);animation:dam-pop .16s cubic-bezier(.2,.8,.2,1);overflow:hidden}
      .dam-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:none}
      .dam-title{display:flex;align-items:center;gap:8px;font:var(--dsw-font-m-16);font-weight:600}
      .dam-close{display:inline-grid;place-items:center;width:32px;height:32px;border:0;border-radius:8px;background:none;color:var(--dsw-alias-label-secondary);font-size:18px;cursor:pointer}
      .dam-close:hover{background:var(--dsw-alias-interactive-bg-hover)}

      /* 顶部 Tabs */
      .dam-tabs{display:flex;gap:4px;padding:3px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);flex:none;overflow-x:auto;-webkit-overflow-scrolling:touch}
      .dam-tab{flex:1 1 0;min-width:max-content;height:30px;padding:0 10px;border:0;border-radius:8px;background:none;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-s-12);font-weight:500;cursor:pointer;white-space:nowrap}
      .dam-tab[data-active="true"]{background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv1)}

      /* 工具栏 */
      .dam-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;flex:none}
      .dam-search-wrap{position:relative;display:flex;align-items:center;flex:1 1 200px;min-width:0}
      .dam-search{box-sizing:border-box;width:100%;min-width:0;height:34px;padding:0 30px 0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
      .dam-search:focus-visible{border-color:var(--dsw-alias-brand-primary)}
      .dam-search-clear{position:absolute;right:4px;display:inline-grid;place-items:center;width:26px;height:26px;border:0;border-radius:50%;background:none;color:var(--dsw-alias-label-tertiary);font-size:13px;cursor:pointer}
      .dam-search-clear:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .dam-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
      .dam-action{display:inline-flex;align-items:center;justify-content:center;height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-13);font-weight:500;cursor:pointer;white-space:nowrap}
      .dam-action:disabled{opacity:.45;cursor:not-allowed}
      .dam-action-primary{border-color:transparent;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}
      .dam-action-danger{border-color:transparent;background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}

      /* 列表区域 */
      .dam-list{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:4px;background:var(--dsw-alias-bg-layer-1);box-sizing:border-box}
      .dam-empty{padding:40px 16px;text-align:center;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-s-14)}
      .dam-select-bar{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;font-size:12px;color:var(--dsw-alias-label-tertiary);border-bottom:1px solid var(--dsw-alias-border-l3);box-sizing:border-box}

      /* 列表项卡片 (桌面端) */
      .dam-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;box-sizing:border-box;cursor:pointer;-webkit-tap-highlight-color:transparent;border-bottom:1px solid var(--dsw-alias-border-l3)}
      .dam-item:last-child{border-bottom:none}
      .dam-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .dam-item input[type="checkbox"]{flex:none;width:16px;height:16px;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer;margin:0}
      .dam-item-info{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px}
      .dam-item-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:var(--dsw-font-s-14);font-weight:600;color:var(--dsw-alias-label-primary)}
      .dam-item-sub{display:flex;flex-wrap:wrap;gap:6px 12px;color:var(--dsw-alias-label-tertiary);font-size:12px;min-width:0}
      .dam-item-sub span{display:inline-flex;align-items:center;gap:3px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
      .dam-item-ops{display:flex;flex:none;align-items:center;gap:6px}
      .dam-op{height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-12);cursor:pointer;white-space:nowrap}
      .dam-op:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .dam-op-restore{color:var(--dsw-alias-state-business-primary)}
      .dam-op-danger{color:var(--dsw-alias-state-error-primary)}
      .dam-note{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;padding:0 4px}
      .dam-list-more{padding:10px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px}
      .dam-feedback{min-height:16px;color:var(--dsw-alias-state-warn-label);font-size:12px;padding:0 2px}

      @keyframes dam-fade{from{opacity:0}to{opacity:1}}
      @keyframes dam-pop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
      @media(prefers-reduced-motion:reduce){.dam-backdrop,.dam-card{animation:none}}

      /* 移动端深度适配 (≤768px) */
      @media(max-width:768px){
        .dam-backdrop{padding:0;align-items:flex-end}
        .dam-card{width:100vw;max-width:100vw;height:88vh;max-height:88vh;border-radius:16px 16px 0 0;padding:14px 12px calc(14px + env(safe-area-inset-bottom,0px));gap:8px}
        .dam-toolbar{flex-direction:column;align-items:stretch;gap:6px}
        .dam-search-wrap{width:100%;flex:none}
        .dam-search{height:38px;padding:0 34px 0 10px;font-size:15px}
        .dam-search-clear{width:32px;height:32px}
        .dam-actions{width:100%;justify-content:flex-end}
        .dam-action{flex:1 1 auto;height:34px;font-size:13px}
        
        /* 移动端卡片上下分层排版，彻底根绝横向溢出 */
        .dam-item{flex-direction:column;align-items:stretch;padding:10px 8px;gap:6px}
        .dam-item-header{display:flex;align-items:flex-start;gap:8px;width:100%;min-width:0}
        .dam-item input[type="checkbox"]{width:20px;height:20px;margin-top:1px}
        .dam-item-info{width:100%;min-width:0}
        .dam-item-title{font-size:14px;white-space:normal;line-height:1.4;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
        .dam-item-sub{display:flex;flex-direction:column;gap:3px;margin-top:4px;font-size:11px}
        .dam-item-sub-tags{display:flex;align-items:center;justify-content:space-between;gap:6px;width:100%}
        .dam-item-sub-path{color:var(--dsw-alias-label-quaternary, #9ca3af);font-size:10px;word-break:break-all}
        .dam-item-ops{width:100%;justify-content:flex-end;padding-top:6px;border-top:1px dashed var(--dsw-alias-border-l3);gap:8px}
        .dam-op{height:30px;padding:0 12px;font-size:12px}
        .dam-btn{min-height:44px;padding:6px 12px;font-size:14px}
        .dam-list{-webkit-overflow-scrolling:touch}
      }
    `;

    function ArchiveManagerModal({ open, onClose, rpc, useWorkspaces }) {
      const [tab, setTab] = react.useState("archived");
      const [list, setList] = react.useState([]);
      const [deleted, setDeleted] = react.useState([]);
      const [caps, setCaps] = react.useState({ physicalDelete: false, trashDir: "" });
      const [loading, setLoading] = react.useState(false);
      const [searchInput, setSearchInput] = react.useState("");
      const [search, setSearch] = react.useState("");
      const [selectedIds, setSelectedIds] = react.useState([]);
      const [feedback, setFeedback] = react.useState("");
      const [visibleCount, setVisibleCount] = react.useState(PAGE_SIZE);
      const searchRef = react.useRef(null);
      const listRef = react.useRef(null);

      const archivedIds = useWorkspaces((state) => state.archivedSessionIds) || [];
      const softRows = deleted.filter((item) => item.kind !== "physical");
      const physicalRows = deleted.filter((item) => item.kind === "physical");

      const notify = (text) => {
        setFeedback(text);
        window.setTimeout(() => setFeedback(""), 4000);
      };

      // 搜索防抖
      react.useEffect(() => {
        const timer = window.setTimeout(() => setSearch(searchInput), 150);
        return () => window.clearTimeout(timer);
      }, [searchInput]);

      react.useEffect(() => {
        setVisibleCount(PAGE_SIZE);
      }, [tab, search]);

      const loadData = react.useCallback(async () => {
        if (!rpc) return;
        setLoading(true);
        try {
          const [listValue, deletedValue, capsValue] = await Promise.all([
            rpc("list", {}),
            rpc("deleted", {}),
            rpc("capabilities", {}),
          ]);
          setList(listValue || []);
          setDeleted(deletedValue || []);
          setCaps(capsValue || { physicalDelete: false, trashDir: "" });
        } catch (error) {
          notify(error instanceof Error ? error.message : "加载归档列表失败");
        } finally {
          setLoading(false);
        }
      }, [rpc]);

      react.useEffect(() => {
        if (open) {
          setSearchInput("");
          setSearch("");
          setSelectedIds([]);
          setFeedback("");
          setVisibleCount(PAGE_SIZE);
          loadData();
        }
      }, [open, loadData]);

      // 监听全局打开事件，确保外部派发也可以唤起弹窗
      react.useEffect(() => {
        const handleOpenEvent = () => {
          if (!open) {
            setSearchInput("");
            setSearch("");
            setSelectedIds([]);
            setFeedback("");
            setVisibleCount(PAGE_SIZE);
            loadData();
          }
        };
        if (typeof window !== "undefined") {
          window.addEventListener(OPEN_EVENT, handleOpenEvent);
          return () => window.removeEventListener(OPEN_EVENT, handleOpenEvent);
        }
      }, [open, loadData]);

      const rows = tab === "archived" ? list : tab === "deleted" ? softRows : physicalRows;
      const filtered = react.useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter((item) =>
          (item.title && item.title.toLowerCase().includes(q)) ||
          (item.workspaceTitle && item.workspaceTitle.toLowerCase().includes(q)) ||
          (item.cwd && item.cwd.toLowerCase().includes(q))
        );
      }, [rows, search]);

      const visible = filtered.slice(0, visibleCount);

      const handleListScroll = () => {
        const el = listRef.current;
        if (!el) return;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
          setVisibleCount((count) => Math.min(count + PAGE_SIZE, filtered.length));
        }
      };

      const clearSearch = () => {
        setSearchInput("");
        setSearch("");
        searchRef.current?.focus?.();
      };

      const toggleSelect = (id) => {
        setSelectedIds((prev) =>
          prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
        );
      };

      const selectAll = () => {
        if (selectedIds.length === filtered.length) setSelectedIds([]);
        else setSelectedIds(filtered.map((item) => item.id));
      };

      const run = async (method, ids, success) => {
        if (!rpc || ids.length === 0) return;
        try {
          await rpc(method, { sessionIds: ids });
          setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
          await loadData();
          notify(success);
        } catch (error) {
          notify(error instanceof Error ? error.message : "操作失败");
        }
      };

      const handleRestore = (ids) => run("unarchive", ids, `已恢复 ${ids.length} 个会话`);
      const handleSoftDelete = (ids) => {
        if (typeof window !== "undefined" && !window.confirm(`确定删除选中的 ${ids.length} 个会话？删除后将从归档箱消失（日志文件保留，可在"已删除"中恢复）。`)) return;
        run("delete", ids, `已删除 ${ids.length} 个会话`);
      };
      const handleRestoreSoft = (ids) => run("restoreDeleted", ids, `已恢复 ${ids.length} 个会话到归档箱`);
      const handlePhysicalDelete = (ids) => {
        if (typeof window !== "undefined" && !window.confirm(
          `确定对 ${ids.length} 个会话执行物理删除？\n\n会话日志将从存储中移入回收站目录（${caps.trashDir || "默认回收站"}），并从归档列表移除。\n\n可在"物理回收站"标签页恢复。`
        )) return;
        run("deletePhysical", ids, `已将 ${ids.length} 个会话移入物理回收站`);
      };
      const handleRestorePhysical = (ids) => run("restorePhysical", ids, `已从回收站恢复 ${ids.length} 个会话`);
      const handleDestroy = (ids) => {
        if (typeof window !== "undefined" && !window.confirm(
          `确定销毁 ${ids.length} 个会话的日志文件？\n\n此操作不可逆，文件将被永久删除，无法恢复！`
        )) return;
        run("destroyPhysical", ids, `已永久销毁 ${ids.length} 个会话的日志`);
      };

      if (!open) return null;

      const bulk = selectedIds.length;
      const tabCount = (label, count) => `${label} (${count})`;
      return react.createElement("div", { className: "dam-backdrop", onClick: onClose },
        react.createElement("div", { className: "dam-card", role: "dialog", "aria-modal": "true", onClick: (e) => e.stopPropagation() },
          // Header
          react.createElement("div", { className: "dam-head" },
            react.createElement("div", { className: "dam-title" },
              react.createElement("span", { "aria-hidden": "true" }, "📦"),
              react.createElement("span", null, "归档管理"),
              react.createElement("span", { className: "dam-badge" }, archivedIds.length)
            ),
            react.createElement("button", { type: "button", className: "dam-close", "aria-label": "关闭", onClick: onClose }, "✕")
          ),
          // Tabs
          react.createElement("div", { className: "dam-tabs" },
            react.createElement("button", { type: "button", className: "dam-tab", "data-active": String(tab === "archived"), onClick: () => { setTab("archived"); setSelectedIds([]); } }, tabCount("归档列表", list.length)),
            react.createElement("button", { type: "button", className: "dam-tab", "data-active": String(tab === "deleted"), onClick: () => { setTab("deleted"); setSelectedIds([]); } }, tabCount("已删除", softRows.length)),
            caps.physicalDelete
              ? react.createElement("button", { type: "button", className: "dam-tab", "data-active": String(tab === "physical"), onClick: () => { setTab("physical"); setSelectedIds([]); } }, tabCount("物理回收站", physicalRows.length))
              : null
          ),
          // Toolbar
          react.createElement("div", { className: "dam-toolbar" },
            react.createElement("div", { className: "dam-search-wrap" },
              react.createElement("input", {
                ref: searchRef,
                className: "dam-search",
                type: "text",
                placeholder: "搜索标题或工作区...",
                value: searchInput,
                onChange: (e) => setSearchInput(e.target.value),
                autoComplete: "off",
                spellCheck: false,
                enterKeyHint: "search",
                "aria-label": "搜索归档会话",
              }),
              searchInput
                ? react.createElement("button", { type: "button", className: "dam-search-clear", "aria-label": "清除搜索", onClick: clearSearch }, "✕")
                : null
            ),
            react.createElement("div", { className: "dam-actions" },
              tab === "archived"
                ? react.createElement(react.Fragment, null,
                    react.createElement("button", { type: "button", className: "dam-action dam-action-primary", disabled: bulk === 0, onClick: () => handleRestore(selectedIds) }, `恢复 (${bulk})`),
                    react.createElement("button", { type: "button", className: "dam-action dam-action-danger", disabled: bulk === 0, onClick: () => handleSoftDelete(selectedIds) }, `删除 (${bulk})`),
                    caps.physicalDelete
                      ? react.createElement("button", { type: "button", className: "dam-action dam-action-danger", disabled: bulk === 0, onClick: () => handlePhysicalDelete(selectedIds) }, `物理删除 (${bulk})`)
                      : null
                  )
                : tab === "deleted"
                  ? react.createElement("button", { type: "button", className: "dam-action dam-action-primary", disabled: bulk === 0, onClick: () => handleRestoreSoft(selectedIds) }, `恢复到归档箱 (${bulk})`)
                  : react.createElement(react.Fragment, null,
                      react.createElement("button", { type: "button", className: "dam-action dam-action-primary", disabled: bulk === 0, onClick: () => handleRestorePhysical(selectedIds) }, `恢复 (${bulk})`),
                      react.createElement("button", { type: "button", className: "dam-action dam-action-danger", disabled: bulk === 0, onClick: () => handleDestroy(selectedIds) }, `销毁 (${bulk})`)
                    )
            )
          ),
          react.createElement("div", { className: "dam-feedback", role: "status" }, feedback),
          // List Container
          react.createElement("div", { className: "dam-list", ref: listRef, onScroll: handleListScroll },
            loading
              ? react.createElement("div", { className: "dam-empty" }, "正在加载...")
              : filtered.length === 0
                ? react.createElement("div", { className: "dam-empty" },
                    tab === "archived" ? "暂无已归档会话" : tab === "deleted" ? "暂无已删除会话" : "回收站为空"
                  )
                : react.createElement("div", null,
                    // 全选行
                    react.createElement("div", { className: "dam-select-bar" },
                      react.createElement("label", { style: { display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" } },
                        react.createElement("input", { type: "checkbox", checked: selectedIds.length === filtered.length && filtered.length > 0, onChange: selectAll }),
                        `全选 (${filtered.length})`
                      ),
                      selectedIds.length > 0 ? react.createElement("span", null, `已选中 ${selectedIds.length} 项`) : null
                    ),
                    visible.map((item) => {
                      const checked = selectedIds.includes(item.id);
                      return react.createElement("div", {
                        key: item.id,
                        className: "dam-item",
                        onClick: () => toggleSelect(item.id),
                        role: "button",
                        tabIndex: 0,
                        "aria-pressed": checked,
                        onKeyDown: (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleSelect(item.id);
                          }
                        },
                      },
                        // Header: Checkbox + Title
                        react.createElement("div", { className: "dam-item-header" },
                          react.createElement("input", {
                            type: "checkbox",
                            checked,
                            onChange: () => toggleSelect(item.id),
                            onClick: (e) => e.stopPropagation(),
                            "aria-label": "选择会话",
                          }),
                          react.createElement("div", { className: "dam-item-info" },
                            react.createElement("div", { className: "dam-item-title", title: item.title }, item.title),
                            react.createElement("div", { className: "dam-item-sub" },
                              react.createElement("div", { className: "dam-item-sub-tags" },
                                react.createElement("span", null, `📁 ${item.workspaceTitle}`),
                                item.createdAt || item.deletedAt
                                  ? react.createElement("span", null, `🕒 ${new Date(item.deletedAt || item.createdAt).toLocaleDateString()}`)
                                  : null
                              ),
                              item.cwd
                                ? react.createElement("div", { className: "dam-item-sub-path", title: item.cwd }, `📍 ${item.cwd}`)
                                : null,
                              item.trashPath
                                ? react.createElement("div", { className: "dam-item-sub-path", title: item.trashPath }, `🗑 ${item.trashPath}`)
                                : null
                            )
                          )
                        ),
                        // Action Buttons: 移动端自适应在卡片底部右对齐
                        react.createElement("div", { className: "dam-item-ops", onClick: (e) => e.stopPropagation() },
                          tab === "archived"
                            ? react.createElement(react.Fragment, null,
                                react.createElement("button", { type: "button", className: "dam-op dam-op-restore", onClick: () => handleRestore([item.id]) }, "恢复"),
                                react.createElement("button", { type: "button", className: "dam-op dam-op-danger", onClick: () => handleSoftDelete([item.id]) }, "删除"),
                                caps.physicalDelete
                                  ? react.createElement("button", { type: "button", className: "dam-op dam-op-danger", onClick: () => handlePhysicalDelete([item.id]) }, "物理删除")
                                  : null
                              )
                            : tab === "deleted"
                              ? react.createElement("button", { type: "button", className: "dam-op dam-op-restore", onClick: () => handleRestoreSoft([item.id]) }, "恢复")
                              : react.createElement(react.Fragment, null,
                                  react.createElement("button", { type: "button", className: "dam-op dam-op-restore", onClick: () => handleRestorePhysical([item.id]) }, "恢复"),
                                  react.createElement("button", { type: "button", className: "dam-op dam-op-danger", onClick: () => handleDestroy([item.id]) }, "销毁")
                                )
                        )
                      );
                    }),
                    visible.length < filtered.length
                      ? react.createElement("div", { className: "dam-list-more" }, `已显示 ${visible.length} / ${filtered.length}，向下滚动加载更多`)
                      : null
                  )
          ),
          tab === "archived" && caps.physicalDelete
            ? react.createElement("div", { className: "dam-note" }, "物理删除会将会话日志移入回收站目录（非即时销毁），仅对非运行中的会话生效。")
            : null
        )
      );
    }

    function ArchiveSidebarButton(props) {
      const [modalOpen, setModalOpen] = react.useState(false);
      const archivedIds = props.useWorkspaces((state) => state.archivedSessionIds) || [];
      const count = archivedIds.length;

      react.useEffect(() => {
        const handleOpen = () => setModalOpen(true);
        if (typeof window !== "undefined") {
          window.addEventListener(OPEN_EVENT, handleOpen);
          return () => window.removeEventListener(OPEN_EVENT, handleOpen);
        }
      }, []);

      return react.createElement(react.Fragment, null,
        react.createElement("button", {
          type: "button",
          className: "dam-btn",
          onClick: () => setModalOpen(true),
          title: "查看与管理已归档会话",
        },
          react.createElement("span", { className: "dam-btn-main" },
            react.createElement("span", { "aria-hidden": "true" }, "📦"),
            react.createElement("span", { className: "dam-btn-label" }, "归档箱")
          ),
          count > 0 ? react.createElement("span", { className: "dam-badge" }, count) : null
        ),
        react.createElement(ArchiveManagerModal, {
          open: modalOpen,
          onClose: () => setModalOpen(false),
          rpc: props.rpc,
          useWorkspaces: props.useWorkspaces,
        })
      );
    }

    function apply(ctx) {
      if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = css;
        document.head.appendChild(style);
      }

      const rpc = ctx.connection.rpc;
      async function rpcCall(method, payload) {
        const result = await rpc.call(RPC_CHANNEL, method, payload || {});
        if (result && result.ok === true) return result.value;
        throw new Error(result?.error?.message || "归档管理请求失败");
      }

      ctx.slots.inject(FOOTER_SLOT, () => ctx.slots.register({
        name: FOOTER_SLOT,
        id: "archive-manager",
        order: 40,
        inject: () => ({ rpc: rpcCall }),
      }, ArchiveSidebarButton));

      if (typeof window !== "undefined") {
        const openArchiveManager = () => {
          const event = new CustomEvent(OPEN_EVENT, { detail: {} });
          window.dispatchEvent(event);
        };
        window.__dsh_open_archive_manager = openArchiveManager;
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
