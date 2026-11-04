/**
 * dsh-dynamic-workflow client bundle.
 *
 * Adds a 编排 / Workflows tab to the conversation view strip. The tab shows the
 * workflow runs of the current session as a live graph — phase lanes left to
 * right, one card per `agent()` call, phase edges between lanes — plus the
 * run's log and script, and the saved-workflow library with save / launch /
 * delete actions. Live updates come from long-polling the host's `watch`
 * method; every revision bump re-reads the run list and the open run.
 */
(function () {
  window.__ModuleLoader__.load({
    id: "@weniatall/dsh-dynamic-workflow",
    factory: (require) => {
      var module = { exports: {} };
      var exports = module.exports;
      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
      const react = require("react");
      const h = react.createElement;

      const CHANNEL = "/dsh-dynamic-workflow";
      const VIEW_SLOT = "conversation.view";
      const VIEW_ID = "dynamic-workflow";
      const VIEW_ORDER = 30;
      const STYLE_ID = "dsh-dynamic-workflow-styles";

      // -------------------------------------------------------------------
      // Language
      // -------------------------------------------------------------------
      let localeFace = null;
      function uiLang() {
        if (localeFace !== null) {
          try {
            const active = localeFace.getSnapshot().active;
            if (active === "zh" || active === "en") return active;
          } catch { /* fall through */ }
        }
        try {
          const tag = typeof navigator !== "undefined" && typeof navigator.language === "string" ? navigator.language.toLowerCase() : "";
          return tag.startsWith("zh") ? "zh" : "en";
        } catch {
          return "en";
        }
      }
      function useLang() {
        const [lang, setLang] = react.useState(uiLang);
        react.useEffect(() => {
          if (localeFace === null || typeof localeFace.subscribe !== "function") return undefined;
          const sync = () => setLang(uiLang());
          sync();
          return localeFace.subscribe(sync);
        }, []);
        return lang;
      }

      const STRINGS = {
        viewLabel: ["编排", "Workflows"],
        runs: ["运行记录", "Runs"],
        saved: ["已保存", "Saved"],
        noRuns: ["本会话还没有 workflow 运行。让模型调用 workflow 工具，或从「已保存」启动一个。", "No workflow runs in this session yet. Ask the model to use the workflow tool, or launch a saved one."],
        noSaved: ["还没有保存的 workflow。运行结束后可在运行详情里保存。", "No saved workflows. Save one from a run's detail."],
        allSessions: ["全部会话", "All sessions"],
        agents: ["{n} 个 agent", "{n} agents"],
        phaseNone: ["（未分组）", "(no phase)"],
        log: ["日志", "Log"],
        script: ["脚本", "Script"],
        graph: ["编排图", "Graph"],
        save: ["保存", "Save"],
        saveProject: ["保存到项目", "Save to project"],
        saveGlobal: ["保存为全局", "Save globally"],
        savedOk: ["已保存 {name}（{scope}）", "Saved {name} ({scope})"],
        launch: ["启动", "Launch"],
        launched: ["已在当前会话启动 {name}", "Launched {name} in this session"],
        remove: ["删除", "Delete"],
        confirmRemove: ["删除已保存的 workflow「{name}」？", "Delete saved workflow \"{name}\"?"],
        confirmRemoveRun: ["删除这条运行记录？", "Delete this run record?"],
        argsPlaceholder: ["启动参数（JSON 对象，可留空）", "Launch args (JSON object, optional)"],
        badArgs: ["参数必须是 JSON 对象", "Args must be a JSON object"],
        noScript: ["该运行没有记录到脚本，无法保存", "This run has no recorded script to save"],
        empty: ["暂无", "None"],
        project: ["项目", "project"],
        global: ["全局", "global"],
        connectionNotReady: ["连接未就绪", "Connection not ready"],
        requestFailed: ["请求失败", "Request failed"],
        status_running: ["运行中", "Running"],
        status_completed: ["已完成", "Completed"],
        status_failed: ["失败", "Failed"],
        status_error: ["出错", "Error"],
        status_cancelled: ["已取消", "Cancelled"],
        status_interrupted: ["已中断", "Interrupted"],
        state_pending: ["等待", "Pending"],
        state_running: ["进行中", "Running"],
        state_done: ["完成", "Done"],
        state_failed: ["有失败", "Failed"],
        state_skipped: ["未执行", "Skipped"],
        duration: ["耗时 {d}", "{d}"],
      };
      function t(lang, key, vars) {
        const pair = STRINGS[key];
        let text = pair ? pair[lang === "zh" ? 0 : 1] : key;
        if (vars) for (const name of Object.keys(vars)) text = text.split(`{${name}}`).join(String(vars[name]));
        return text;
      }
      function viewLabel() {
        return t(uiLang(), "viewLabel");
      }

      function formatDuration(start, end) {
        if (!start) return "";
        const ms = Math.max(0, (end || Date.now()) - start);
        const s = Math.round(ms / 1000);
        if (s < 60) return `${s}s`;
        const m = Math.floor(s / 60);
        return `${m}m${String(s % 60).padStart(2, "0")}s`;
      }
      function formatTime(ms) {
        if (!ms) return "";
        const d = new Date(ms);
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
      }

      // -------------------------------------------------------------------
      // Styles
      // -------------------------------------------------------------------
      const css = `
.dwf-view{height:var(--dsh-conversation-viewport-height,100%);min-width:0;display:flex;flex-direction:column;padding:12px 16px calc(var(--dsh-composer-height,152px) + 16px);box-sizing:border-box;gap:10px;overflow:hidden;color:var(--dsw-alias-label-primary,inherit);font-family:var(--dsw-font-family,inherit)}
.dwf-top{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.dwf-tab{border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));background:transparent;color:inherit;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:13px}
.dwf-tab[data-on="true"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 12%,transparent);border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dwf-check{font-size:12px;color:var(--dsw-alias-label-secondary,#888);display:inline-flex;gap:4px;align-items:center;margin-left:auto}
.dwf-body{flex:1;min-height:0;display:flex;gap:12px}
.dwf-list{width:260px;flex:none;overflow:auto;display:flex;flex-direction:column;gap:6px}
.dwf-item{border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));border-radius:10px;padding:8px 10px;cursor:pointer;background:transparent;text-align:left;color:inherit;font-size:13px}
.dwf-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08))}
.dwf-item[data-active="true"]{border-color:var(--dsw-alias-brand-primary,#4d6bfe);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 8%,transparent)}
.dwf-item-title{font-weight:600;display:flex;gap:6px;align-items:center;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.dwf-item-sub{font-size:12px;color:var(--dsw-alias-label-tertiary,#999);margin-top:2px}
.dwf-detail{flex:1;min-width:0;overflow:auto;display:flex;flex-direction:column;gap:10px}
.dwf-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.dwf-head h3{margin:0;font-size:15px}
.dwf-desc{font-size:12px;color:var(--dsw-alias-label-secondary,#888)}
.dwf-badge{font-size:11px;border-radius:999px;padding:1px 8px;border:1px solid currentColor;white-space:nowrap}
.dwf-badge[data-s="running"]{color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dwf-badge[data-s="completed"],.dwf-badge[data-s="done"]{color:var(--dsw-alias-state-success-primary,#2a9d55)}
.dwf-badge[data-s="failed"],.dwf-badge[data-s="error"]{color:var(--dsw-alias-state-error-primary,#d93025)}
.dwf-badge[data-s="cancelled"],.dwf-badge[data-s="interrupted"],.dwf-badge[data-s="skipped"],.dwf-badge[data-s="pending"]{color:var(--dsw-alias-label-tertiary,#999)}
.dwf-graph{display:flex;align-items:stretch;gap:0;overflow-x:auto;padding:4px 2px 8px}
.dwf-lane{min-width:180px;max-width:240px;flex:none;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));border-radius:12px;padding:8px;display:flex;flex-direction:column;gap:6px;background:var(--dsw-alias-bg-layer-1,transparent)}
.dwf-lane[data-state="running"]{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 20%,transparent)}
.dwf-lane[data-state="pending"],.dwf-lane[data-state="skipped"]{opacity:.6;border-style:dashed}
.dwf-lane-title{font-size:13px;font-weight:600;display:flex;justify-content:space-between;gap:6px;align-items:center}
.dwf-lane-detail{font-size:11px;color:var(--dsw-alias-label-tertiary,#999)}
.dwf-edge{flex:none;width:28px;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary,#999);font-size:16px}
.dwf-node{border-radius:8px;padding:6px 8px;font-size:12px;border-left:3px solid var(--dsw-alias-label-tertiary,#999);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.06));display:flex;flex-direction:column;gap:2px}
.dwf-node[data-s="running"]{border-left-color:var(--dsw-alias-brand-primary,#4d6bfe);animation:dwf-pulse 1.6s ease-in-out infinite}
.dwf-node[data-s="completed"]{border-left-color:var(--dsw-alias-state-success-primary,#2a9d55)}
.dwf-node[data-s="failed"]{border-left-color:var(--dsw-alias-state-error-primary,#d93025)}
.dwf-node-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.dwf-node-meta{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;display:flex;justify-content:space-between}
.dwf-empty{font-size:12px;color:var(--dsw-alias-label-tertiary,#999);padding:4px 0}
.dwf-section{border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));border-radius:10px;padding:8px 10px}
.dwf-section>summary{cursor:pointer;font-size:13px;font-weight:600}
.dwf-pre{font-family:var(--dsw-font-code,monospace);font-size:12px;white-space:pre-wrap;word-break:break-word;max-height:280px;overflow:auto;margin:6px 0 0}
.dwf-btn{border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));background:transparent;color:inherit;border-radius:8px;padding:3px 10px;cursor:pointer;font-size:12px}
.dwf-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08))}
.dwf-btn[disabled]{opacity:.5;cursor:default}
.dwf-btn-primary{border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dwf-btn-danger{color:var(--dsw-alias-state-error-primary,#d93025)}
.dwf-flash{font-size:12px;color:var(--dsw-alias-label-secondary,#888)}
.dwf-flash[data-err="true"]{color:var(--dsw-alias-state-error-primary,#d93025)}
.dwf-input{width:100%;box-sizing:border-box;font-family:var(--dsw-font-code,monospace);font-size:12px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));border-radius:8px;padding:6px;background:transparent;color:inherit;resize:vertical;min-height:52px}
.dwf-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
@keyframes dwf-pulse{0%,100%{opacity:1}50%{opacity:.55}}
@media (prefers-reduced-motion:reduce){.dwf-node[data-s="running"]{animation:none}}
@container (max-width:640px){.dwf-body{flex-direction:column}.dwf-list{width:auto;max-height:180px}}
`;
      function ensureStyles() {
        if (typeof document === "undefined") return;
        const existing = document.getElementById(STYLE_ID);
        const style = existing || document.createElement("style");
        style.id = STYLE_ID;
        style.setAttribute("data-plugin", "@weniatall/dsh-dynamic-workflow");
        if (style.textContent !== css) style.textContent = css;
        if (!existing) (document.head || document.body).appendChild(style);
      }
      ensureStyles();

      // -------------------------------------------------------------------
      // Graph
      // -------------------------------------------------------------------
      function Graph({ run, lang }) {
        const lanes = run.graph && Array.isArray(run.graph.lanes) ? run.graph.lanes : [];
        if (lanes.length === 0) return h("div", { className: "dwf-empty" }, t(lang, "empty"));
        const bySeq = new Map((run.nodes || []).map((node) => [node.seq, node]));
        const children = [];
        lanes.forEach((lane, index) => {
          if (index > 0) children.push(h("div", { key: `e${index}`, className: "dwf-edge", "aria-hidden": "true" }, "→"));
          const nodes = lane.nodes.map((seq) => bySeq.get(seq)).filter(Boolean);
          children.push(h("div", { key: lane.id, className: "dwf-lane", "data-state": lane.state, "data-lane": lane.title },
            h("div", { className: "dwf-lane-title" },
              h("span", null, lane.title || t(lang, "phaseNone")),
              h("span", { className: "dwf-badge", "data-s": lane.state }, t(lang, `state_${lane.state}`))),
            lane.detail ? h("div", { className: "dwf-lane-detail" }, lane.detail) : null,
            nodes.length === 0
              ? h("div", { className: "dwf-empty" }, "—")
              : nodes.map((node) => h("div", { key: node.seq, className: "dwf-node", "data-s": node.status, "data-seq": node.seq, title: node.label },
                h("div", { className: "dwf-node-label" }, `#${node.seq} ${node.label}`),
                h("div", { className: "dwf-node-meta" },
                  h("span", null, t(lang, `status_${node.status}`)),
                  h("span", null, formatDuration(node.startedAt, node.endedAt)))))));
        });
        return h("div", { className: "dwf-graph", role: "list" }, children);
      }

      // -------------------------------------------------------------------
      // Run detail
      // -------------------------------------------------------------------
      function RunDetail({ run, lang, rpcCall, sessionId, onFlash, onDeleted, onSaved }) {
        const [busy, setBusy] = react.useState(false);
        const save = async (scope) => {
          setBusy(true);
          try {
            const saved = await rpcCall("saveRun", { runId: run.id, scope, sessionId });
            onFlash(t(lang, "savedOk", { name: saved.name, scope: t(lang, saved.scope) }), false);
            onSaved();
          } catch (error) {
            onFlash(error.message, true);
          } finally {
            setBusy(false);
          }
        };
        const removeRun = async () => {
          if (typeof window.confirm === "function" && !window.confirm(t(lang, "confirmRemoveRun"))) return;
          try {
            await rpcCall("deleteRun", { runId: run.id });
            onDeleted();
          } catch (error) {
            onFlash(error.message, true);
          }
        };
        return h("div", { className: "dwf-detail", "data-run": run.id },
          h("div", { className: "dwf-head" },
            h("h3", null, run.name || run.id),
            h("span", { className: "dwf-badge", "data-s": run.status }, t(lang, `status_${run.status}`)),
            h("span", { className: "dwf-desc" }, `${t(lang, "agents", { n: run.agents })} · ${formatDuration(run.startedAt, run.endedAt)}`),
            h("span", { className: "dwf-actions", style: { marginLeft: "auto" } },
              h("button", { className: "dwf-btn dwf-btn-primary", disabled: busy || !run.hasScript, title: run.hasScript ? "" : t(lang, "noScript"), onClick: () => save("project") }, t(lang, "saveProject")),
              h("button", { className: "dwf-btn", disabled: busy || !run.hasScript, onClick: () => save("global") }, t(lang, "saveGlobal")),
              run.status !== "running" ? h("button", { className: "dwf-btn dwf-btn-danger", onClick: removeRun }, t(lang, "remove")) : null)),
          run.description ? h("div", { className: "dwf-desc" }, run.description) : null,
          run.error ? h("div", { className: "dwf-flash", "data-err": "true" }, run.error) : null,
          h(Graph, { run, lang }),
          h("details", { className: "dwf-section", open: true },
            h("summary", null, `${t(lang, "log")} (${(run.logs || []).length})`),
            h("pre", { className: "dwf-pre" }, (run.logs || []).map((line) => `${formatTime(line.time)}  ${line.text}`).join("\n") || t(lang, "empty"))),
          h("details", { className: "dwf-section" },
            h("summary", null, t(lang, "script")),
            h("pre", { className: "dwf-pre" }, run.script || t(lang, "noScript"))));
      }

      // -------------------------------------------------------------------
      // Saved library
      // -------------------------------------------------------------------
      function SavedList({ lang, rpcCall, sessionId, items, onFlash, reload }) {
        const [args, setArgs] = react.useState({});
        const launch = async (wf) => {
          const raw = (args[`${wf.scope}:${wf.name}`] || "").trim();
          let parsed;
          if (raw !== "") {
            try {
              parsed = JSON.parse(raw);
            } catch {
              onFlash(t(lang, "badArgs"), true);
              return;
            }
            if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
              onFlash(t(lang, "badArgs"), true);
              return;
            }
          }
          try {
            await rpcCall("launch", { sessionId, name: wf.name, scope: wf.scope, ...(parsed ? { args: parsed } : {}) });
            onFlash(t(lang, "launched", { name: wf.name }), false);
          } catch (error) {
            onFlash(error.message, true);
          }
        };
        const remove = async (wf) => {
          if (typeof window.confirm === "function" && !window.confirm(t(lang, "confirmRemove", { name: wf.name }))) return;
          try {
            await rpcCall("deleteWorkflow", { sessionId, name: wf.name, scope: wf.scope });
            reload();
          } catch (error) {
            onFlash(error.message, true);
          }
        };
        if (items.length === 0) return h("div", { className: "dwf-empty" }, t(lang, "noSaved"));
        return h("div", { className: "dwf-detail" }, items.map((wf) => {
          const key = `${wf.scope}:${wf.name}`;
          return h("div", { key, className: "dwf-section", "data-workflow": wf.name },
            h("div", { className: "dwf-head" },
              h("h3", null, wf.name),
              h("span", { className: "dwf-badge", "data-s": "pending" }, t(lang, wf.scope)),
              wf.phases.length ? h("span", { className: "dwf-desc" }, wf.phases.join(" → ")) : null),
            wf.description ? h("div", { className: "dwf-desc" }, wf.description) : null,
            h("textarea", {
              className: "dwf-input",
              placeholder: t(lang, "argsPlaceholder"),
              value: args[key] || "",
              onChange: (event) => setArgs({ ...args, [key]: event.target.value }),
            }),
            h("div", { className: "dwf-actions" },
              h("button", { className: "dwf-btn dwf-btn-primary", disabled: !sessionId, onClick: () => launch(wf) }, t(lang, "launch")),
              h("button", { className: "dwf-btn dwf-btn-danger", onClick: () => remove(wf) }, t(lang, "remove"))));
        }));
      }

      // -------------------------------------------------------------------
      // View
      // -------------------------------------------------------------------
      function WorkflowView(props) {
        const { rpcCall, sessionId } = props;
        const active = props.active !== false;
        const lang = useLang();
        const [tab, setTab] = react.useState("runs");
        const [all, setAll] = react.useState(false);
        const [runs, setRuns] = react.useState([]);
        const [selected, setSelected] = react.useState(null);
        const [detail, setDetail] = react.useState(null);
        const [saved, setSaved] = react.useState([]);
        const [flash, setFlash] = react.useState({ text: "", err: false });
        const [rev, setRev] = react.useState(-1);
        const [live] = react.useState(() => ({ selected: null, all: false }));
        live.selected = selected;
        live.all = all;

        const onFlash = (text, err) => setFlash({ text, err: err === true });

        const loadRuns = async () => {
          try {
            const value = await rpcCall("runs", { sessionId, all: live.all });
            setRuns(value.runs);
            const current = live.selected;
            const pick = current && value.runs.some((run) => run.id === current) ? current : (value.runs[0] ? value.runs[0].id : null);
            if (pick !== current) setSelected(pick);
            if (pick) setDetail(await rpcCall("run", { runId: pick }));
            else setDetail(null);
          } catch (error) {
            onFlash(error.message, true);
          }
        };
        const loadSaved = async () => {
          try {
            setSaved((await rpcCall("workflows", { sessionId })).workflows);
          } catch (error) {
            onFlash(error.message, true);
          }
        };

        // Re-read on every revision the host reports.
        react.useEffect(() => {
          if (!active) return undefined;
          void loadRuns();
          void loadSaved();
          return undefined;
        }, [active, sessionId, rev, all]);

        // Open a run when the user picks one.
        react.useEffect(() => {
          if (!selected) return undefined;
          let stale = false;
          rpcCall("run", { runId: selected }).then((value) => { if (!stale) setDetail(value); }, () => {});
          return () => { stale = true; };
        }, [selected]);

        // Long-poll loop; stops when the tab is hidden or unmounted.
        react.useEffect(() => {
          if (!active) return undefined;
          let stopped = false;
          let since = -1;
          const loop = async () => {
            while (!stopped) {
              try {
                const value = await rpcCall("watch", { since, timeoutMs: 20000 });
                if (stopped) return;
                if (value.rev !== since) {
                  since = value.rev;
                  setRev(value.rev);
                }
              } catch {
                await new Promise((resolve) => setTimeout(resolve, 3000));
              }
            }
          };
          void loop();
          return () => { stopped = true; };
        }, [active, sessionId]);

        // Running durations tick even without host events.
        const [, setTick] = react.useState(0);
        react.useEffect(() => {
          if (!detail || detail.status !== "running") return undefined;
          const timer = setInterval(() => setTick((n) => n + 1), 1000);
          return () => clearInterval(timer);
        }, [detail && detail.id, detail && detail.status]);

        const list = tab === "runs"
          ? h("div", { className: "dwf-list" }, runs.length === 0
            ? h("div", { className: "dwf-empty" }, t(lang, "noRuns"))
            : runs.map((run) => h("button", {
              key: run.id,
              className: "dwf-item",
              "data-active": String(run.id === selected),
              onClick: () => setSelected(run.id),
            },
            h("div", { className: "dwf-item-title" },
              h("span", { className: "dwf-badge", "data-s": run.status }, t(lang, `status_${run.status}`)),
              h("span", null, run.name || run.id)),
            h("div", { className: "dwf-item-sub" }, `${formatTime(run.startedAt)} · ${t(lang, "agents", { n: run.agents })} · ${formatDuration(run.startedAt, run.endedAt)}`))))
          : null;

        return h("div", { className: "dwf-view", "data-dsh-dynamic-workflow": "view" },
          h("div", { className: "dwf-top" },
            h("button", { className: "dwf-tab", "data-on": String(tab === "runs"), onClick: () => setTab("runs") }, `${t(lang, "runs")} (${runs.length})`),
            h("button", { className: "dwf-tab", "data-on": String(tab === "saved"), onClick: () => setTab("saved") }, `${t(lang, "saved")} (${saved.length})`),
            flash.text ? h("span", { className: "dwf-flash", "data-err": String(flash.err) }, flash.text) : null,
            tab === "runs" ? h("label", { className: "dwf-check" },
              h("input", { type: "checkbox", checked: all, onChange: (event) => setAll(event.target.checked) }),
              t(lang, "allSessions")) : null),
          tab === "runs"
            ? h("div", { className: "dwf-body" }, list,
              detail
                ? h(RunDetail, { run: detail, lang, rpcCall, sessionId, onFlash, onSaved: loadSaved, onDeleted: () => { setSelected(null); setDetail(null); void loadRuns(); } })
                : h("div", { className: "dwf-detail" }))
            : h(SavedList, { lang, rpcCall, sessionId, items: saved, onFlash, reload: loadSaved }));
      }

      function apply(ctx) {
        ensureStyles();
        const service = (name) => {
          try { return typeof ctx.get === "function" ? ctx.get(name, false) : undefined; } catch { return undefined; }
        };
        const locale = service("locale");
        if (locale && typeof locale.getSnapshot === "function") {
          localeFace = locale;
          if (typeof ctx.effect === "function") ctx.effect(() => () => { if (localeFace === locale) localeFace = null; }, "dsh-dynamic-workflow: locale");
        }
        const rpcCall = async (method, payload) => {
          const rpc = ctx && ctx.connection && ctx.connection.rpc;
          if (!rpc || typeof rpc.call !== "function") throw new Error(t(uiLang(), "connectionNotReady"));
          const result = await rpc.call(CHANNEL, method, payload || {});
          if (result && result.ok === true) return result.value;
          throw new Error(result && result.error ? result.error.message : t(uiLang(), "requestFailed"));
        };
        ctx.slots.inject(VIEW_SLOT, () => ctx.slots.register({
          name: VIEW_SLOT,
          id: VIEW_ID,
          order: VIEW_ORDER,
          label: viewLabel,
          inject: (sessionId) => ({ rpcCall, sessionId }),
        }, WorkflowView));
      }

      exports.apply = apply;
      exports.inject = ["slots", "connection", "locale"];
      exports.internals = { CHANNEL, VIEW_SLOT, VIEW_ID, STRINGS, t, uiLang, viewLabel, formatDuration, Graph, WorkflowView };
      return module.exports;
    },
  });
})();
