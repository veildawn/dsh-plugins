/**
 * dsh-dynamic-workflow client bundle.
 *
 * A floating card in the composer dock (`conversation.input.dock`, the slot the
 * host's task list uses). As soon as the model starts a `workflow` run in this
 * session the card appears above the input box and shows the orchestration
 * live: phase lanes left to right joined by arrows, one node per `agent()`
 * call with its status and duration. A finished run stays until dismissed and
 * can be saved as a project or global workflow, to re-run with `/workflow`.
 * Live updates come from long-polling the host's `watch` method.
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
      const DOCK_SLOT = "conversation.input.dock";
      const DOCK_ID = "dsh-dynamic-workflow";
      // Above the host's todo dock (0), below dsh-spec's plan (-10).
      const DOCK_ORDER = -5;
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
        title: ["编排", "Workflow"],
        agents: ["{done}/{n} 个 agent", "{done}/{n} agents"],
        phaseNone: ["（未分组）", "(no phase)"],
        saveProject: ["保存到项目", "Save to project"],
        saveGlobal: ["保存为全局", "Save globally"],
        savedOk: ["已保存为 {name}，可用 /workflow {name} 重新运行", "Saved as {name}; re-run with /workflow {name}"],
        noScript: ["该运行没有记录到脚本，无法保存", "This run has no recorded script to save"],
        dismiss: ["关闭", "Dismiss"],
        aria: ["动态编排进度", "Workflow progress"],
        empty: ["暂无节点", "No nodes yet"],
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
      };
      function t(lang, key, vars) {
        const pair = STRINGS[key];
        let text = pair ? pair[lang === "zh" ? 0 : 1] : key;
        if (vars) for (const name of Object.keys(vars)) text = text.split(`{${name}}`).join(String(vars[name]));
        return text;
      }

      function formatDuration(start, end) {
        if (!start) return "";
        const ms = Math.max(0, (end || Date.now()) - start);
        const s = Math.round(ms / 1000);
        if (s < 60) return `${s}s`;
        const m = Math.floor(s / 60);
        return `${m}m${String(s % 60).padStart(2, "0")}s`;
      }

      // -------------------------------------------------------------------
      // Styles: same card geometry as the host / dsh-spec task dock
      // -------------------------------------------------------------------
      const css = `
.dwf-dock{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance,0px) - var(--dsh-composer-side-clearance,0px) - var(--dsh-composer-dock-inset,0px) - var(--dsh-composer-dock-inset,0px));max-width:var(--dsh-composer-card-max-width,760px);margin:0 auto;flex:none;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1,#fff));box-shadow:var(--dsw-elevation-panel);overflow:hidden;color:var(--dsw-alias-label-primary)}
.dwf-body{display:flex;flex-direction:column;gap:6px;padding:6px 12px}
.dwf-head{display:flex;align-items:center;gap:8px;width:100%;min-width:0}
.dwf-toggle{display:flex;align-items:center;gap:8px;flex:1 1 auto;min-width:0;padding:0;border:none;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dwf-lead{flex:none;font-size:9px;line-height:1;color:var(--dsw-alias-label-tertiary)}
.dwf-title{flex:none;font-size:13px;font-weight:500;line-height:24px}
.dwf-name{flex:0 1 auto;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-code,monospace);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dwf-progress{flex:1 1 auto;min-width:0;font-size:12.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.dwf-badge{flex:none;font-size:11px;border-radius:999px;padding:0 7px;line-height:18px;border:1px solid currentColor;white-space:nowrap}
.dwf-badge[data-s="running"]{color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dwf-badge[data-s="completed"],.dwf-badge[data-s="done"]{color:var(--dsw-alias-state-success-primary,#2a9d55)}
.dwf-badge[data-s="failed"],.dwf-badge[data-s="error"]{color:var(--dsw-alias-state-error-primary,#d93025)}
.dwf-badge[data-s="cancelled"],.dwf-badge[data-s="interrupted"],.dwf-badge[data-s="skipped"],.dwf-badge[data-s="pending"]{color:var(--dsw-alias-label-tertiary,#999)}
.dwf-x{flex:none;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:14px;line-height:1;padding:2px 4px;border-radius:6px}
.dwf-x:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dwf-graph{display:flex;align-items:stretch;overflow-x:auto;padding:2px 0 4px;max-height:220px}
.dwf-lane{min-width:150px;max-width:220px;flex:none;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:6px;display:flex;flex-direction:column;gap:4px;overflow-y:auto}
.dwf-lane[data-state="running"]{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dwf-lane[data-state="pending"],.dwf-lane[data-state="skipped"]{opacity:.6;border-style:dashed}
.dwf-lane-title{font-size:12px;font-weight:600;display:flex;justify-content:space-between;gap:6px;align-items:center}
.dwf-lane-title>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dwf-edge{flex:none;width:22px;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);font-size:14px}
.dwf-node{border-radius:6px;padding:4px 6px;font-size:12px;border-left:3px solid var(--dsw-alias-label-tertiary,#999);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.06));display:flex;flex-direction:column;gap:1px}
.dwf-node[data-s="running"]{border-left-color:var(--dsw-alias-brand-primary,#4d6bfe);animation:dwf-pulse 1.6s ease-in-out infinite}
.dwf-node[data-s="completed"]{border-left-color:var(--dsw-alias-state-success-primary,#2a9d55)}
.dwf-node[data-s="failed"]{border-left-color:var(--dsw-alias-state-error-primary,#d93025)}
.dwf-node-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dwf-node-meta{color:var(--dsw-alias-label-tertiary);font-size:11px;display:flex;justify-content:space-between;gap:6px;font-variant-numeric:tabular-nums}
.dwf-empty{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dwf-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.dwf-btn{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;border-radius:8px;padding:2px 10px;cursor:pointer;font-size:12px}
.dwf-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dwf-btn[disabled]{opacity:.5;cursor:default}
.dwf-flash{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dwf-flash[data-err="true"]{color:var(--dsw-alias-state-error-primary,#d93025)}
@keyframes dwf-pulse{0%,100%{opacity:1}50%{opacity:.55}}
@media (prefers-reduced-motion:reduce){.dwf-node[data-s="running"]{animation:none}}
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
      // Graph: phase lanes → agent nodes, arrows between lanes
      // -------------------------------------------------------------------
      function Graph({ run, lang }) {
        const lanes = run.graph && Array.isArray(run.graph.lanes) ? run.graph.lanes : [];
        if (lanes.length === 0) return h("div", { className: "dwf-empty" }, t(lang, "empty"));
        const bySeq = new Map((run.nodes || []).map((node) => [node.seq, node]));
        const children = [];
        lanes.forEach((lane, index) => {
          if (index > 0) children.push(h("div", { key: `e${index}`, className: "dwf-edge", "aria-hidden": "true" }, "→"));
          const nodes = lane.nodes.map((seq) => bySeq.get(seq)).filter(Boolean);
          children.push(h("div", { key: lane.id, className: "dwf-lane", "data-state": lane.state, "data-lane": lane.title, title: lane.detail || "" },
            h("div", { className: "dwf-lane-title" },
              h("span", null, lane.title || t(lang, "phaseNone")),
              h("span", { className: "dwf-badge", "data-s": lane.state }, t(lang, `state_${lane.state}`))),
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

      /** Header progress line: done/total agents, current phase, elapsed. */
      function progressText(run, lang) {
        const counts = run.counts || {};
        const done = (counts.completed || 0) + (counts.failed || 0) + (counts.cancelled || 0) + (counts.interrupted || 0);
        const parts = [t(lang, "agents", { done, n: run.agents || 0 })];
        if (run.currentPhase) parts.push(run.currentPhase);
        parts.push(formatDuration(run.startedAt, run.endedAt));
        return parts.filter(Boolean).join(" · ");
      }

      // -------------------------------------------------------------------
      // The floating card
      // -------------------------------------------------------------------
      /** The run to float: the newest run of this session, unless dismissed. */
      function pickRun(runs, dismissed) {
        const latest = Array.isArray(runs) && runs.length > 0 ? runs[0] : null;
        if (latest === null) return null;
        if (latest.status !== "running" && dismissed.has(latest.id)) return null;
        return latest;
      }

      function WorkflowDock(props) {
        const { rpcCall, sessionId } = props;
        const lang = useLang();
        const [run, setRun] = react.useState(null);
        const [collapsed, setCollapsed] = react.useState(false);
        const [busy, setBusy] = react.useState(false);
        const [flash, setFlash] = react.useState({ text: "", err: false });
        const [live] = react.useState(() => ({ dismissed: new Set(), runId: null }));

        // Long-poll the host; every revision re-reads this session's newest run.
        react.useEffect(() => {
          if (!sessionId || typeof rpcCall !== "function") return undefined;
          let stopped = false;
          let since = -1;
          const refresh = async () => {
            const value = await rpcCall("runs", { sessionId });
            const pick = pickRun(value.runs, live.dismissed);
            if (stopped) return;
            if (pick === null) {
              live.runId = null;
              setRun(null);
              return;
            }
            const detail = await rpcCall("run", { runId: pick.id });
            if (stopped) return;
            if (live.runId !== detail.id) {
              live.runId = detail.id;
              setCollapsed(false);
              setFlash({ text: "", err: false });
            }
            setRun(detail);
          };
          const loop = async () => {
            while (!stopped) {
              try {
                const value = await rpcCall("watch", { since, timeoutMs: 20000 });
                if (stopped) return;
                if (value.rev !== since) {
                  since = value.rev;
                  await refresh();
                }
              } catch {
                await new Promise((resolve) => setTimeout(resolve, 3000));
              }
            }
          };
          void loop();
          return () => { stopped = true; };
        }, [sessionId]);

        // Running durations tick between host events.
        const [, setTick] = react.useState(0);
        react.useEffect(() => {
          if (!run || run.status !== "running") return undefined;
          const timer = setInterval(() => setTick((n) => n + 1), 1000);
          return () => clearInterval(timer);
        }, [run && run.id, run && run.status]);

        if (!run) return null;

        const save = async (scope) => {
          setBusy(true);
          try {
            const saved = await rpcCall("saveRun", { runId: run.id, scope, sessionId });
            setFlash({ text: t(lang, "savedOk", { name: saved.name }), err: false });
          } catch (error) {
            setFlash({ text: error.message, err: true });
          } finally {
            setBusy(false);
          }
        };
        const dismiss = () => {
          live.dismissed.add(run.id);
          live.runId = null;
          setRun(null);
        };
        const finished = run.status !== "running";

        return h("section", { className: "dwf-dock", "data-dsh-dynamic-workflow": run.id, "aria-label": t(lang, "aria") },
          h("div", { className: "dwf-body" },
            h("div", { className: "dwf-head" },
              h("button", {
                className: "dwf-toggle", type: "button", "aria-expanded": String(!collapsed),
                onClick: () => setCollapsed((value) => !value),
              },
                h("span", { className: "dwf-lead" }, collapsed ? "▸" : "▾"),
                h("span", { className: "dwf-title" }, t(lang, "title")),
                h("span", { className: "dwf-name" }, run.name || run.id),
                h("span", { className: "dwf-badge", "data-s": run.status }, t(lang, `status_${run.status}`)),
                h("span", { className: "dwf-progress" }, progressText(run, lang))),
              finished ? h("button", { className: "dwf-x", type: "button", title: t(lang, "dismiss"), "aria-label": t(lang, "dismiss"), onClick: dismiss }, "×") : null),
            collapsed ? null : [
              h(Graph, { key: "graph", run, lang }),
              run.error ? h("div", { key: "err", className: "dwf-flash", "data-err": "true" }, run.error) : null,
              finished ? h("div", { key: "actions", className: "dwf-actions" },
                h("button", { className: "dwf-btn", type: "button", disabled: busy || !run.hasScript, title: run.hasScript ? "" : t(lang, "noScript"), onClick: () => save("project") }, t(lang, "saveProject")),
                h("button", { className: "dwf-btn", type: "button", disabled: busy || !run.hasScript, onClick: () => save("global") }, t(lang, "saveGlobal")),
                flash.text ? h("span", { className: "dwf-flash", "data-err": String(flash.err) }, flash.text) : null) : null,
            ]));
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
        ctx.slots.inject(DOCK_SLOT, () => ctx.slots.register({
          name: DOCK_SLOT,
          id: DOCK_ID,
          order: DOCK_ORDER,
          inject: (sessionId) => ({ rpcCall, sessionId }),
        }, WorkflowDock));
      }

      exports.apply = apply;
      exports.inject = ["slots", "connection", "locale"];
      exports.internals = { CHANNEL, DOCK_SLOT, DOCK_ID, DOCK_ORDER, STRINGS, t, uiLang, formatDuration, progressText, pickRun, Graph, WorkflowDock };
      return module.exports;
    },
  });
})();
