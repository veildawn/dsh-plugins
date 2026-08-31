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
 * - Mobile: bulletproof zero-overflow responsive layout, card-based item flow,
 *   touch-friendly targets, and `dsh:open-archive-manager` event listener.
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
    const PAGE_SIZE = 50;

    const css = `
      /* 侧边栏入口按钮 */
      .dam-btn{display:flex;align-items:center;justify-content:space-between;box-sizing:border-box;width:100%;min-height:36px;padding:4px 10px;margin:2px 0;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);cursor:pointer;text-align:left;user-select:none}
      .dam-btn:hover,.dam-btn:active{background:var(--dsw-alias-interactive-bg-hover)}
      .dam-btn-main{display:flex;align-items:center;gap:8px;min-width:0}
      .dam-btn-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dam-badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-foreground,#fff);font-size:11px;font-weight:600;box-sizing:border-box}

      /* 弹窗遮罩：采用全屏 fixed 并禁止横向滚动 */
      .dam-backdrop{position:fixed;top:0;left:0;right:0;bottom:0;width:100vw;height:100dvh;height:100vh;z-index:2147483640;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;padding:0;box-sizing:border-box;background:rgba(0,0,0,.52);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);animation:dam-fade .14s ease-out;overflow:hidden}

      /* 弹窗主卡片：移动端底部抽屉，桌面端居中卡片 */
      .dam-card{box-sizing:border-box;display:flex;flex-direction:column;width:100%;max-width:100vw;height:88dvh;height:88vh;max-height:88dvh;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#ffffff));border-top-left-radius:16px;border-top-right-radius:16px;border:1px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);animation:dam-slide-up .18s cubic-bezier(.16,1,.3,1);overflow:hidden;padding:14px 12px calc(14px + env(safe-area-inset-bottom,0px))}

      @media(min-width: 769px) {
        .dam-backdrop{justify-content:center;padding:20px}
        .dam-card{width:min(90vw,720px);max-width:720px;height:min(82vh,740px);max-height:740px;border-radius:16px;padding:16px;animation:dam-pop .16s cubic-bezier(.2,.8,.2,1)}
      }

      /* 头部导航 */
      .dam-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:none;width:100%;box-sizing:border-box;padding-bottom:2px}
      .dam-title{display:flex;align-items:center;gap:8px;font-size:16px;font-weight:600;min-width:0}
      .dam-close{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border:0;border-radius:8px;background:none;color:var(--dsw-alias-label-secondary);font-size:20px;cursor:pointer;flex:none}
      .dam-close:hover,.dam-close:active{background:var(--dsw-alias-interactive-bg-hover)}

      /* 顶部 Tabs 栏 */
      .dam-tabs{display:flex;gap:4px;padding:3px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);flex:none;width:100%;box-sizing:border-box;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
      .dam-tabs::-webkit-scrollbar{display:none}
      .dam-tab{flex:1 1 0;min-width:max-content;height:32px;padding:0 10px;border:0;border-radius:7px;background:none;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap}
      .dam-tab[data-active="true"]{background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv1);font-weight:600}

      /* 搜索与工具栏 */
      .dam-toolbar{display:flex;flex-direction:column;gap:8px;width:100%;box-sizing:border-box;flex:none;margin-top:2px}
      @media(min-width: 600px) {
        .dam-toolbar{flex-direction:row;align-items:center;justify-content:space-between}
      }

      .dam-search-wrap{position:relative;display:flex;align-items:center;width:100%;box-sizing:border-box;min-width:0;flex:1 1 auto}
      .dam-search{box-sizing:border-box;width:100%;min-width:0;height:36px;padding:0 32px 0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary);font-size:14px}
      .dam-search:focus{border-color:var(--dsw-alias-brand-primary)}
      .dam-search-clear{position:absolute;right:4px;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:50%;background:none;color:var(--dsw-alias-label-tertiary);font-size:14px;cursor:pointer}

      .dam-actions{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;flex:none;justify-content:flex-end}
      @media(min-width: 600px) {
        .dam-actions{width:auto}
      }
      .dam-action{display:inline-flex;align-items:center;justify-content:center;height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap;flex:1 1 auto;max-width:180px}
      @media(min-width: 600px) {
        .dam-action{flex:none}
      }
      .dam-action:disabled{opacity:.4;cursor:not-allowed}
      .dam-action-primary{border-color:transparent;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}
      .dam-action-danger{border-color:transparent;background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}

      /* 反馈与全选状态栏 */
      .dam-sub-bar{display:flex;align-items:center;justify-content:space-between;padding:4px 2px;font-size:12px;color:var(--dsw-alias-label-tertiary);box-sizing:border-box;width:100%;flex:none}

      /* 滚动列表容器 */
      .dam-list{flex:1 1 auto;min-height:0;width:100%;max-width:100%;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-sizing:border-box;padding:4px}
      .dam-empty{padding:48px 16px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:14px}

      /* 列表项卡片：标准垂直分层，100% 宽度不溢出 */
      .dam-card-item{display:flex;flex-direction:column;gap:6px;padding:10px 10px;border-radius:8px;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l3);margin-bottom:6px;box-sizing:border-box;width:100%;max-width:100%;cursor:pointer;-webkit-tap-highlight-color:transparent}
      .dam-card-item:hover{background:var(--dsw-alias-interactive-bg-hover)}

      /* 顶部行：勾选框 + 序号 + 标题 */
      .dam-card-top{display:flex;align-items:flex-start;gap:6px;width:100%;min-width:0;box-sizing:border-box}
      .dam-card-checkbox{flex:none;width:18px;height:18px;margin-top:2px;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}
      .dam-card-index{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:18px;padding:0 4px;margin-top:1px;border-radius:4px;background:var(--dsw-alias-bg-layer-2, #e5e7eb);color:var(--dsw-alias-label-tertiary, #6b7280);font-size:11px;font-weight:600;line-height:1}
      .dam-card-title{flex:1 1 auto;min-width:0;font-size:14px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary);word-break:break-word;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}

      /* 中间行：标签与元信息 */
      .dam-card-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary);width:100%;min-width:0;box-sizing:border-box;padding-left:26px}
      .dam-card-ws{display:inline-flex;align-items:center;gap:3px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:65%}
      .dam-card-date{flex:none;color:var(--dsw-alias-label-tertiary)}

      /* 路径行 (仅当存在时) */
      .dam-card-path{font-size:10px;color:var(--dsw-alias-label-tertiary);word-break:break-all;padding-left:26px;box-sizing:border-box;width:100%;line-height:1.3}

      /* 底部操作行 */
      .dam-card-ops{display:flex;align-items:center;justify-content:flex-end;gap:6px;width:100%;box-sizing:border-box;padding-top:4px;border-top:1px dashed var(--dsw-alias-border-l3);margin-top:2px}
      .dam-op-btn{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;white-space:nowrap}
      .dam-op-btn:hover,.dam-op-btn:active{background:var(--dsw-alias-interactive-bg-hover)}
      .dam-op-restore{color:var(--dsw-alias-state-business-primary);font-weight:500}
      .dam-op-danger{color:var(--dsw-alias-state-error-primary)}

      .dam-note{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;padding:4px 2px 0}
      .dam-list-more{padding:10px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px}

      @keyframes dam-fade{from{opacity:0}to{opacity:1}}
      @keyframes dam-slide-up{from{transform:translateY(100%)}to{transform:translateY(0)}}
      @keyframes dam-pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
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

      // 监听全局打开事件
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
          `确定对 ${ids.length} 个会话执行物理删除？\n\n会话日志将从存储中移入回收站目录（${caps.trashDir || "默认回收站"}），并从归档列表移除。移动前请确认会话未在运行。\n\n可在"物理回收站"标签页恢复。`
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
                  ? react.createElement("button", { type: "button", className: "dam-action dam-action-primary", disabled: bulk === 0, onClick: () => handleRestoreSoft(selectedIds) }, `恢复 (${bulk})`)
                  : react.createElement(react.Fragment, null,
                      react.createElement("button", { type: "button", className: "dam-action dam-action-primary", disabled: bulk === 0, onClick: () => handleRestorePhysical(selectedIds) }, `恢复 (${bulk})`),
                      react.createElement("button", { type: "button", className: "dam-action dam-action-danger", disabled: bulk === 0, onClick: () => handleDestroy(selectedIds) }, `销毁 (${bulk})`)
                    )
            )
          ),

          // Sub Bar (全选状态 / 操作反馈)
          react.createElement("div", { className: "dam-sub-bar" },
            filtered.length > 0
              ? react.createElement("label", { style: { display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" } },
                  react.createElement("input", { type: "checkbox", checked: selectedIds.length === filtered.length && filtered.length > 0, onChange: selectAll }),
                  `全选 (${filtered.length})`
                )
              : react.createElement("span", null),
            feedback ? react.createElement("span", { style: { color: "var(--dsw-alias-state-warn-label)" } }, feedback) : null
          ),

          // List Container
          react.createElement("div", { className: "dam-list", ref: listRef, onScroll: handleListScroll },
            loading
              ? react.createElement("div", { className: "dam-empty" }, "正在加载...")
              : filtered.length === 0
                ? react.createElement("div", { className: "dam-empty" },
                    tab === "archived" ? "暂无已归档会话" : tab === "deleted" ? "暂无已删除会话" : "回收站为空"
                  )
                : react.createElement("div", { style: { width: "100%", maxWidth: "100%", boxSizing: "border-box" } },
                    visible.map((item, index) => {
                      const checked = selectedIds.includes(item.id);
                      const itemIndex = index + 1;
                      return react.createElement("div", {
                        key: item.id,
                        className: "dam-card-item",
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
                        // Row 1: Checkbox + Index + Title
                        react.createElement("div", { className: "dam-card-top" },
                          react.createElement("input", {
                            type: "checkbox",
                            className: "dam-card-checkbox",
                            checked,
                            onChange: () => toggleSelect(item.id),
                            onClick: (e) => e.stopPropagation(),
                            "aria-label": `选择第 ${itemIndex} 项会话`,
                          }),
                          react.createElement("span", { className: "dam-card-index", "aria-hidden": "true" }, itemIndex),
                          react.createElement("div", { className: "dam-card-title", title: item.title }, item.title)
                        ),
                        // Row 2: Workspace + Date
                        react.createElement("div", { className: "dam-card-meta" },
                          react.createElement("div", { className: "dam-card-ws" }, `📁 ${item.workspaceTitle}`),
                          item.createdAt || item.deletedAt
                            ? react.createElement("div", { className: "dam-card-date" }, `🕒 ${new Date(item.deletedAt || item.createdAt).toLocaleDateString()}`)
                            : null
                        ),
                        // Row 3: Path (Optional)
                        item.cwd
                          ? react.createElement("div", { className: "dam-card-path", title: item.cwd }, `📍 ${item.cwd}`)
                          : null,
                        item.trashPath
                          ? react.createElement("div", { className: "dam-card-path", title: item.trashPath }, `🗑 ${item.trashPath}`)
                          : null,
                        // Row 4: Actions (Dedicated bottom right bar)
                        react.createElement("div", { className: "dam-card-ops", onClick: (e) => e.stopPropagation() },
                          tab === "archived"
                            ? react.createElement(react.Fragment, null,
                                react.createElement("button", { type: "button", className: "dam-op-btn dam-op-restore", onClick: () => handleRestore([item.id]) }, "恢复"),
                                react.createElement("button", { type: "button", className: "dam-op-btn dam-op-danger", onClick: () => handleSoftDelete([item.id]) }, "删除"),
                                caps.physicalDelete
                                  ? react.createElement("button", { type: "button", className: "dam-op-btn dam-op-danger", onClick: () => handlePhysicalDelete([item.id]) }, "物理删除")
                                  : null
                              )
                            : tab === "deleted"
                              ? react.createElement("button", { type: "button", className: "dam-op-btn dam-op-restore", onClick: () => handleRestoreSoft([item.id]) }, "恢复")
                              : react.createElement(react.Fragment, null,
                                  react.createElement("button", { type: "button", className: "dam-op-btn dam-op-restore", onClick: () => handleRestorePhysical([item.id]) }, "恢复"),
                                  react.createElement("button", { type: "button", className: "dam-op-btn dam-op-danger", onClick: () => handleDestroy([item.id]) }, "销毁")
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
