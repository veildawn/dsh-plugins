/**
 * dsh-dynamic-workflow client bundle.
 *
 * A floating workflow timeline card in the composer dock (`conversation.input.dock`).
 * Renders a borderless horizontal Phase Station rail (green completed lamps,
 * pulsing orange running lamp, hollow pending lamps, `settled/observed` fractions,
 * edge fade masks, and pinned `+N ●—●—●` overflow ledges when scrolled) with
 * vertical stacks of rounded-full capsule pills directly beneath each phase.
 *
 * Every `agent()` pill carries a 20×20 squircle GrokBot/ZCode dynamic expression
 * puppet (`wf-face`) with autonomous blinking, gaze scanning, focused/confused
 * morphs, celebratory hops on completion, frustrated shakes on failure, and
 * wave-dots while waiting.
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
      const CHAT_SLOT = "conversation.chat.node";
      const CHAT_KEY = "workflow-run";
      // Smaller priority wins a keyed cell; this shadows the host's card.
      const CHAT_PRIORITY = -100;
      const HIDE_AFTER_MS = 6000;
      const COLLAPSE_DELAY_MS = 1400;
      const COLUMN_GAP = 20;
      const PILL_WIDTH = 184;
      const STATION_PITCH = PILL_WIDTH + COLUMN_GAP; // 184px pill column + 20px gap
      const WHEEL_LINE_PX = 16;

      const revealers = new Map();
      function reveal(sessionId, hint) {
        const fn = revealers.get(sessionId);
        if (typeof fn === "function") fn(hint);
      }

      function useBoxRef(initial) {
        if (typeof react.useRef === "function") return react.useRef(initial);
        const [box] = react.useState(() => ({ current: initial }));
        return box;
      }

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
        title: ["工作流", "Workflow"],
        defaultName: ["工作流脚本", "Workflow script"],
        kind_running: ["工作流运行中", "Workflow running"],
        kind_completed: ["工作流已完成", "Workflow completed"],
        kind_failed: ["工作流出错", "Workflow failed"],
        kind_error: ["工作流出错", "Workflow failed"],
        kind_cancelled: ["工作流已停止", "Workflow stopped"],
        kind_interrupted: ["工作流已中断", "Workflow interrupted"],
        phases: ["{n} 个阶段", "{n} phases"],
        agentsWorking: ["{n} 个子代理工作中", "{n} subagents working"],
        subagents: ["{n} 个子代理", "{n} subagents"],
        agents: ["{done}/{n} 个子代理", "{done}/{n} subagents"],
        moreAgents: ["还有 {n} 个子代理", "{n} more subagents"],
        foldAgents: ["收起其余子代理", "Collapse extra subagents"],
        phaseNone: ["工作流", "Workflow"],
        plannedAgent: ["子代理", "Subagent"],
        scriptNode: ["脚本", "Script"],
        showDock: ["在输入框上方查看工作流", "Show workflow above the input"],
        locateActive: ["定位当前阶段", "Locate active phase"],
        stopWorkflow: ["停止工作流", "Stop workflow"],
        stoppingWorkflow: ["正在停止…", "Stopping…"],
        expandDetails: ["展开工作流", "Expand workflow"],
        collapseDetails: ["收起工作流", "Collapse workflow"],
        jumpPhase: ["定位阶段：{title}", "Jump to phase: {title}"],
        jumpStart: ["回到起始阶段", "Jump to first phase"],
        jumpEnd: ["跳至末尾阶段", "Jump to last phase"],
        modelPlanned: ["计划", "planned"],
        dismiss: ["关闭", "Dismiss"],
        openAgent: ["点击打开该子代理会话", "Click to open this subagent's session"],
        aria: ["动态工作流进度", "Workflow progress"],
        empty: ["暂无阶段节点", "No phase nodes yet"],
        connectionNotReady: ["连接未就绪", "Connection not ready"],
        requestFailed: ["请求失败", "Request failed"],
        status_pending: ["等待中", "Pending"],
        status_running: ["运行中", "Running"],
        status_completed: ["已完成", "Completed"],
        status_done: ["已完成", "Completed"],
        status_failed: ["失败", "Failed"],
        status_error: ["出错", "Error"],
        status_cancelled: ["已取消", "Cancelled"],
        status_interrupted: ["已中断", "Interrupted"],
        status_skipped: ["已跳过", "Skipped"],
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

      function summarizeError(raw) {
        if (typeof raw !== "string" || raw.trim() === "") return "";
        const lines = raw
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter((line) => line !== "" && !/^at\s+/u.test(line));
        return lines[0] || raw.trim().split(/\r?\n/u)[0];
      }

      // -------------------------------------------------------------------
      // GrokBot / ZCode 20×20 Squircle Dynamic Expression Puppet (`wf-face`)
      // -------------------------------------------------------------------
      const BOT_COLORS = [
        "#54B9A6", "#F19D38", "#6464EF", "#885CF5", "#3C82F6",
        "#ED712E", "#EB4699", "#5BC67A", "#EA4045",
      ];

      function hashName(text) {
        let hash = 0;
        const s = typeof text === "string" ? text : "";
        for (const ch of s) hash = (hash * 31 + (ch.codePointAt(0) || 0)) % 360;
        return hash;
      }

      function botColor(seqOrSlot, label, avatarSlot) {
        if (Number.isInteger(avatarSlot) && avatarSlot >= 0) {
          return BOT_COLORS[avatarSlot % BOT_COLORS.length];
        }
        if (Number.isInteger(seqOrSlot) && seqOrSlot >= 1 && (!label || typeof label !== "string")) {
          return BOT_COLORS[(seqOrSlot - 1) % BOT_COLORS.length];
        }
        if (typeof label === "string" && label.trim() !== "") {
          return BOT_COLORS[hashName(label) % BOT_COLORS.length];
        }
        if (Number.isInteger(seqOrSlot) && seqOrSlot >= 1) {
          return BOT_COLORS[(seqOrSlot - 1) % BOT_COLORS.length];
        }
        return BOT_COLORS[0];
      }

      function faceStateOf(status) {
        if (status === "running") return "scanning";
        if (status === "completed" || status === "done") return "content";
        if (status === "failed" || status === "error") return "sad";
        if (status === "cancelled" || status === "interrupted" || status === "skipped") return "sleepy";
        return "waiting";
      }

      const FACE_DEFAULT_EXP = {
        waiting: "dots",
        scanning: "pill",
        content: "happy",
        sad: "sad",
        sleepy: "sleepy",
      };

      const SCANNING_MOODS = ["focused", "confused"];

      const SCANNING_GAZES = ["-2px", "-3.6px", "0px"];

      function restingFaceX(state, seed = 0) {
        if (state === "waiting") return "0px";
        if (state === "scanning") return SCANNING_GAZES[Math.abs(seed) % SCANNING_GAZES.length];
        return "-2px";
      }

      function driveAvatarMotion(el, state, seed = 0) {
        if (!el || typeof window === "undefined") return undefined;
        const media = typeof window.matchMedia === "function"
          ? window.matchMedia("(prefers-reduced-motion: reduce)")
          : null;
        let timer = null;
        let visible = true;
        let gazeIdx = Math.abs(seed) % SCANNING_GAZES.length;
        let cycles = 0;
        let lastMood = "";

        const rand = (min, max) => min + Math.random() * (max - min);
        const later = (ms, fn) => {
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(fn, ms);
        };
        const setMotion = (m) => { el.dataset.motion = m; };
        const resetPose = () => {
          el.dataset.expression = FACE_DEFAULT_EXP[state] || "pill";
          setMotion("idle");
          el.style.setProperty("--wf-face-x", restingFaceX(state, seed));
          el.style.setProperty("--wf-face-y", state === "sad" ? "0.3px" : "0px");
        };
        const morphTo = (exp, next) => {
          setMotion("morph");
          later(80, () => {
            el.dataset.expression = exp;
            later(100, () => { setMotion("idle"); next(); });
          });
        };
        const rest = () => {
          setMotion("idle");
          const waitMs = state === "waiting" ? rand(1500, 3000)
            : state === "scanning" ? rand(1400, 3200)
            : state === "sad" ? rand(1800, 4000)
            : rand(6000, 10000);
          later(waitMs, act);
        };

        function act() {
          if (state === "waiting") {
            setMotion("dots-wave");
            later(900, rest);
            return;
          }
          if (state === "sleepy") {
            el.style.setProperty("--wf-floats", "1");
            setMotion("float");
            later(700, rest);
            return;
          }
          if (state === "sad") {
            const floats = Math.random() < 0.5 ? 1 : 2;
            el.style.setProperty("--wf-floats", String(floats));
            setMotion("float");
            later(floats * 600, () => {
              if (Math.random() >= 0.4) { rest(); return; }
              morphTo("focused", () => {
                const shakes = 3 + Math.floor(Math.random() * 3);
                el.style.setProperty("--wf-shakes", String(shakes));
                setMotion("shake");
                later(shakes * 90, () => {
                  setMotion("idle");
                  later(rand(500, 1000), () => morphTo("sad", rest));
                });
              });
            });
            return;
          }
          if (state === "content") {
            const hops = Math.random() < 0.5 ? 2 : 3;
            el.style.setProperty("--wf-hops", String(hops));
            setMotion("hop");
            later(hops * 240, () => {
              el.dataset.expression = "pill";
              setMotion("idle");
              later(250, () => {
                const dur = Math.round(rand(260, 320));
                el.style.setProperty("--wf-blinks", "1");
                el.style.setProperty("--wf-blink-time", `${dur}ms`);
                setMotion("blink");
                later(dur, () => { el.dataset.expression = "happy"; rest(); });
              });
            });
            return;
          }
          // `scanning`: double/triple blink -> left/center/right glance -> occasional focused/confused morph
          const blinks = Math.random() < 0.5 ? 2 : 3;
          const dur = Math.round(rand(200, 260));
          el.style.setProperty("--wf-blinks", String(blinks));
          el.style.setProperty("--wf-blink-time", `${dur}ms`);
          setMotion("blink");
          later(blinks * dur, () => {
            setMotion("glance");
            gazeIdx = (gazeIdx + 1) % SCANNING_GAZES.length;
            el.style.setProperty("--wf-face-x", SCANNING_GAZES[gazeIdx]);
            later(360, () => {
              cycles += 1;
              if (cycles < 2 || Math.random() >= 0.45) { rest(); return; }
              cycles = 0;
              const pool = SCANNING_MOODS.filter((m) => m !== lastMood);
              const pick = (pool.length ? pool : SCANNING_MOODS)[Math.floor(Math.random() * (pool.length || SCANNING_MOODS.length))];
              lastMood = pick;
              const hold = pick === "confused" ? rand(2200, 3600) : rand(900, 1800);
              morphTo(pick, () => later(hold, () => morphTo("pill", rest)));
            });
          });
        }

        const restart = () => {
          if (timer !== null) { clearTimeout(timer); timer = null; }
          cycles = 0;
          gazeIdx = Math.abs(seed) % SCANNING_GAZES.length;
          resetPose();
          const hidden = typeof document !== "undefined" && document.hidden === true;
          if (!hidden && !(media && media.matches) && visible) {
            const initialWait = state === "content"
              ? rand(120, 380) + (Math.abs(seed) % 4) * 85
              : rand(650, 2200) + (Math.abs(seed) % 5) * 190;
            later(initialWait, act);
          }
        };

        const observer = typeof IntersectionObserver === "function"
          ? new IntersectionObserver((entries) => {
              const next = entries[0] ? entries[0].isIntersecting : true;
              if (next !== visible) { visible = next; restart(); }
            })
          : null;
        if (observer) observer.observe(el);
        if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
          document.addEventListener("visibilitychange", restart);
        }
        if (media && typeof media.addEventListener === "function") {
          media.addEventListener("change", restart);
        }
        restart();

        return () => {
          if (timer !== null) clearTimeout(timer);
          if (observer) observer.disconnect();
          if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
            document.removeEventListener("visibilitychange", restart);
          }
          if (media && typeof media.removeEventListener === "function") {
            media.removeEventListener("change", restart);
          }
          resetPose();
        };
      }

      function FaceEyes() {
        return h("g", { className: "dwf-face-eyes" },
          h("g", { className: "dwf-face-bounce" },
            h("g", { className: "dwf-face-lids" },
              h("g", { "data-eye-expression": "dots" },
                h("circle", { cx: 5, cy: 10, r: 1.5 }),
                h("circle", { cx: 10, cy: 10, r: 1.5 }),
                h("circle", { cx: 15, cy: 10, r: 1.5 })),
              h("g", { "data-eye-expression": "pill" },
                h("rect", { x: 7, y: 6, width: 4, height: 6, rx: 2 }),
                h("rect", { x: 13, y: 6, width: 4, height: 6, rx: 2 })),
              h("g", { "data-eye-expression": "confused" },
                h("rect", { x: 7, y: 6, width: 4, height: 6, rx: 2 }),
                h("rect", { x: 13, y: 8, width: 4, height: 4, rx: 2 })),
              h("g", { "data-eye-expression": "happy" },
                h("path", { transform: "translate(7 0)", d: "M0 11 V8 A2 2 0 0 1 4 8 V11 Z" }),
                h("path", { transform: "translate(13 0)", d: "M0 11 V8 A2 2 0 0 1 4 8 V11 Z" })),
              h("g", { "data-eye-expression": "sleepy" },
                h("path", { transform: "translate(7 0)", d: "M0 8 L4 7 V9 A2 2 0 0 1 0 9 Z" }),
                h("path", { transform: "translate(13 0)", d: "M0 7 L4 8 V9 A2 2 0 0 1 0 9 Z" })),
              h("g", { "data-eye-expression": "focused" },
                h("path", { transform: "translate(7 0)", d: "M0 6 L4 8 V10 A2 2 0 0 1 0 10 Z" }),
                h("path", { transform: "translate(13 0)", d: "M0 8 L4 6 V10 A2 2 0 0 1 0 10 Z" })),
              h("g", { "data-eye-expression": "sad" },
                h("path", { transform: "translate(7 0)", d: "M0 8 L4 6 V10 A2 2 0 0 1 0 10 Z" }),
                h("path", { transform: "translate(13 0)", d: "M0 6 L4 8 V10 A2 2 0 0 1 0 10 Z" }))),
            h("g", { className: "dwf-face-closed" },
              h("rect", { x: 7, y: 8, width: 4, height: 2, rx: 1 }),
              h("rect", { x: 13, y: 8, width: 4, height: 2, rx: 1 }))));
      }

      /** Single Agent's 20×20 squircle GrokBot puppet (`wf-face`). */
      function AgentAvatar({ seq, label, status, avatarSlot, size = "md" }) {
        const svgRef = useBoxRef(null);
        const faceState = faceStateOf(status);
        const color = botColor(seq, label, avatarSlot);
        const seed = Number.isInteger(seq) ? seq : (Number.isInteger(avatarSlot) ? avatarSlot : hashName(label));
        react.useEffect(() => {
          if (!svgRef.current) return undefined;
          return driveAvatarMotion(svgRef.current, faceState, seed);
        }, [faceState, seed]);

        return h("svg", {
          ref: svgRef,
          className: `dwf-face dwf-face-${size}`,
          viewBox: "0 0 20 20",
          "aria-hidden": "true",
          "data-subagent-avatar": "true",
          "data-face-state": faceState,
          "data-expression": FACE_DEFAULT_EXP[faceState] || "pill",
          "data-motion": "idle",
          style: {
            "--wf-face-body": color,
            "--wf-face-x": restingFaceX(faceState, seed),
            "--wf-face-y": faceState === "sad" ? "0.3px" : "0px",
          },
        },
          h("rect", { className: "dwf-face-body", width: 20, height: 20, rx: 7 }),
          h(FaceEyes, null));
      }

      /** Stacked overlapping mini puppet deck for overflow rows and chat summary. */
      function AvatarDeck({ agents, max = 4 }) {
        const list = Array.isArray(agents) ? agents : [];
        if (list.length === 0) return null;
        const shown = list.slice(0, max);
        return h("span", { className: "dwf-deck", "aria-hidden": "true" },
          shown.map((item, idx) => h("span", { key: item.key || item.seq || idx, className: "dwf-deck-slot" },
            h(AgentAvatar, {
              seq: item.seq || idx + 1,
              label: item.label,
              status: item.status,
              avatarSlot: item.avatarSlot,
              size: "sm",
            }))));
      }

      // -------------------------------------------------------------------
      // Crisp Vector Icons (matching ZCode workflow timeline card)
      // -------------------------------------------------------------------
      function WorkflowIcon({ className = "dwf-ico" }) {
        return h("svg", {
          className, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor",
          strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
        },
          h("circle", { cx: 4.5, cy: 4.5, r: 2 }),
          h("circle", { cx: 11.5, cy: 11.5, r: 2 }),
          h("path", { d: "M6.1 5.8L9.9 10.2" }));
      }

      function TerminalScriptIcon() {
        return h("svg", {
          className: "dwf-script-ico", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor",
          strokeWidth: 1.45, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
        },
          h("path", { d: "M3.2 5L6.8 8.2L3.2 11.4" }),
          h("path", { d: "M8.2 11.4H12.8" }));
      }

      function LocateIcon() {
        return h("svg", {
          className: "dwf-btn-ico", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor",
          strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
        },
          h("circle", { cx: 8, cy: 8, r: 4.8 }),
          h("circle", { cx: 8, cy: 8, r: 1.6, fill: "currentColor", stroke: "none" }),
          h("path", { d: "M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6" }));
      }

      function StopSquareIcon({ stopping }) {
        if (stopping) {
          return h("svg", {
            className: "dwf-btn-ico dwf-stop-ico dwf-stop-spin", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true",
          },
            h("path", { d: "M14 8a6 6 0 1 1-2.1-4.55", stroke: "currentColor", strokeWidth: 1.45, strokeLinecap: "round" }),
            h("rect", { x: 5.4, y: 5.4, width: 5.2, height: 5.2, rx: 1.2, fill: "currentColor" }));
        }
        return h("svg", {
          className: "dwf-btn-ico dwf-stop-ico", viewBox: "0 0 16 16", fill: "currentColor", "aria-hidden": "true",
        }, h("rect", { x: 3.2, y: 3.2, width: 9.6, height: 9.6, rx: 2 }));
      }

      function ExpandCollapseIcon({ collapsed }) {
        return h("svg", {
          className: "dwf-btn-ico", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor",
          strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
        }, collapsed
          ? h("path", { d: "M9.5 2.5h4v4M13.5 2.5L8.8 7.2M6.5 13.5h-4v-4M2.5 13.5l4.7-4.7" })
          : h("path", { d: "M13.5 6.5h-4v-4M9.5 6.5l4.2-4.2M2.5 9.5h4v4M6.5 9.5l-4.2 4.2" }));
      }

      function CloseIcon() {
        return h("svg", {
          className: "dwf-btn-ico", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor",
          strokeWidth: 1.45, strokeLinecap: "round", "aria-hidden": "true",
        }, h("path", { d: "M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2" }));
      }

      function PillStatusMark({ status, title }) {
        if (!status || status === "pending") return null;
        if (status === "running") {
          return h("span", { className: "dwf-mark dwf-mark-spin", role: "img", "aria-label": title, title },
            h("svg", { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.45, strokeLinecap: "round", "aria-hidden": "true" },
              h("path", { d: "M14 8a6 6 0 1 1-2.1-4.55" })));
        }
        if (status === "completed" || status === "done") {
          return h("span", { className: "dwf-mark dwf-mark-ok", role: "img", "aria-label": title, title },
            h("svg", { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.35, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
              h("circle", { cx: 8, cy: 8, r: 6 }),
              h("path", { d: "M5.6 8.2l1.6 1.6 3.3-3.4" })));
        }
        if (status === "failed" || status === "error") {
          return h("span", { className: "dwf-mark dwf-mark-err", role: "img", "aria-label": title, title },
            h("svg", { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.45, strokeLinecap: "round", "aria-hidden": "true" },
              h("circle", { cx: 8, cy: 8, r: 6 }),
              h("path", { d: "M8 5.2v3.2M8 10.8h.01" })));
        }
        return h("span", { className: "dwf-mark", role: "img", "aria-label": title, title },
          h("svg", { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.35, strokeLinecap: "round", "aria-hidden": "true" },
            h("circle", { cx: 8, cy: 8, r: 6 }),
            h("path", { d: "M5.5 8h5" })));
      }

      function ChevronRightMini() {
        return h("svg", {
          viewBox: "0 0 16 16", fill: "none", stroke: "currentColor",
          strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
        }, h("path", { d: "M6 3.5L10.5 8 6 12.5" }));
      }

      // -------------------------------------------------------------------
      // Styles: Borderless Timeline Stations + Capsule Pills + GrokBot Faces
      // -------------------------------------------------------------------
      const css = `
.dwf-dock{--dwf-surface-solid:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#ffffff));--dwf-rail-idle:rgba(112,118,130,.64);--dwf-rail-done:rgba(78,85,98,.84);--dwf-lamp-idle:rgba(102,108,120,.88);--dwf-pill-bg:rgba(127,127,127,.065);--dwf-pill-bg-hover:rgba(127,127,127,.115);box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-dock-inset,0px) - var(--dsh-composer-dock-inset,0px));max-width:var(--dsh-composer-card-max-width,760px);margin:0 auto;flex:none;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-l1,rgba(0,0,0,.1)));border-radius:var(--dsw-radius-lg,14px);background:var(--dwf-surface-solid);box-shadow:var(--dsw-elevation-soft,var(--dsw-elevation-panel,0 1px 2px rgba(0,0,0,.04)));overflow:hidden;color:var(--dsw-alias-label-primary);isolation:isolate;transition:border-color .22s ease,box-shadow .22s ease}
html[data-theme-studio="glass"] .dwf-dock,html[data-theme-studio="glass-color"] .dwf-dock,html[data-theme-studio="aurora"] .dwf-dock{--dwf-surface-solid:var(--dsw-alias-bg-mask-1,#ffffff);border-color:var(--ts-glass-edge,var(--dsw-alias-border-l2));box-shadow:inset 0 1px 0 var(--ts-glass-highlight,transparent),var(--dsw-elevation-soft,var(--dsw-elevation-panel,0 1px 3px rgba(0,0,0,.06)))}
@supports (color:rgb(from red r g b / 1)){
  :is(.dwf-dock,html[data-theme-studio] .dwf-dock){--dwf-surface-solid:rgb(from var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#ffffff)) r g b / 1)}
}
@supports (color:color-mix(in srgb,red,red)){
  .dwf-dock{--dwf-rail-idle:color-mix(in srgb,var(--dsw-alias-label-primary,#1f2329) 45%,transparent);--dwf-rail-done:color-mix(in srgb,var(--dsw-alias-label-primary,#1f2329) 64%,transparent);--dwf-lamp-idle:color-mix(in srgb,var(--dsw-alias-label-primary,#1f2329) 64%,transparent);--dwf-pill-bg:color-mix(in srgb,var(--dsw-alias-label-primary,#1f2329) 5.8%,transparent);--dwf-pill-bg-hover:color-mix(in srgb,var(--dsw-alias-label-primary,#1f2329) 11%,transparent)}
}
:is(.dwf-dock,html[data-theme-studio] .dwf-dock)[data-flash="true"]{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 52%,var(--dsw-alias-border-l2,rgba(0,0,0,.14)));box-shadow:inset 0 1px 0 var(--ts-glass-highlight,transparent),0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 18%,transparent),var(--dsw-elevation-soft,var(--dsw-elevation-panel,0 1px 2px rgba(0,0,0,.04)))}
.dwf-body{display:flex;flex-direction:column;gap:10px;padding:12px 16px 14px}
.dwf-dock[data-collapsed="true"] .dwf-body{padding:9px 16px;gap:0}

/* Header row */
.dwf-head{display:flex;align-items:center;gap:8px;width:100%;min-width:0}
.dwf-toggle{display:flex;align-items:center;gap:8px;flex:1 1 120px;min-width:0;padding:0;border:none;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dwf-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:2px;border-radius:6px}
.dwf-ico{flex:none;width:16px;height:16px;color:var(--dsw-alias-label-tertiary)}
.dwf-kind{flex:none;font-size:13.5px;font-weight:600;line-height:20px;white-space:nowrap}
.dwf-kind[data-live="true"]{background:linear-gradient(90deg,var(--dsw-alias-label-primary) 0%,var(--dsw-alias-label-primary) 34%,var(--dsw-alias-label-tertiary) 50%,var(--dsw-alias-label-primary) 66%,var(--dsw-alias-label-primary) 100%);background-size:280% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;animation:dwf-kind-flow 3.8s linear infinite}
.dwf-kind[data-err="true"]{color:var(--dsw-alias-state-error-primary,#e5484d)}
.dwf-name{flex:1 1 auto;min-width:36px;font-size:13.5px;line-height:20px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dwf-head-right{margin-left:auto;display:flex;align-items:center;gap:6px;flex:0 1 auto;min-width:0}
.dwf-progress{flex:0 1 auto;min-width:0;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:360px;margin-right:2px;font-variant-numeric:tabular-nums}
@media (max-width:560px){.dwf-progress{max-width:148px}}
.dwf-actions{display:inline-flex;align-items:center;gap:2px;flex:none}
.dwf-icon-btn{flex:none;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:6px;padding:0;transition:background-color .15s ease,color .15s ease,opacity .15s ease,transform .12s ease}
.dwf-icon-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--dwf-pill-bg-hover));color:var(--dsw-alias-label-primary)}
.dwf-icon-btn:active:not(:disabled){transform:scale(.93)}
.dwf-icon-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}
.dwf-icon-btn:disabled{opacity:.55;cursor:default}
.dwf-btn-ico{width:14px;height:14px}
.dwf-stop-ico{color:var(--dsw-alias-label-primary)}
.dwf-stop-spin path{transform-origin:8px 8px;animation:dwf-spin .85s linear infinite}

/* Mini station rail (collapsed dock & chat row) */
.dwf-mini-rail{display:inline-flex;align-items:center;flex:none;margin-right:2px}
.dwf-mini-seg{width:7px;height:1.75px;border-radius:999px;background:var(--dwf-rail-idle)}
.dwf-mini-seg[data-ink="done"]{background:var(--dwf-rail-done)}
.dwf-mini-seg[data-ink="march"]{background:#ea7915}
.dwf-mini-seg[data-ink="next"]{background:linear-gradient(90deg,rgba(234,121,21,.85) 0%,var(--dwf-rail-idle) 76%)}
.dwf-mini-seg[data-ink="err"]{background:var(--dsw-alias-state-error-primary,#e5484d)}
.dwf-mini-dot{position:relative;width:6.5px;height:6.5px;border-radius:999px;flex:none;transition:transform .15s ease}
.dwf-mini-dot[data-interactive="true"]{cursor:pointer}
.dwf-mini-dot[data-interactive="true"]::after{content:"";position:absolute;inset:-5px}
.dwf-mini-dot[data-interactive="true"]:hover{transform:scale(1.32)}
.dwf-mini-dot:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:2px}
.dwf-mini-dot[data-s="done"]{background:var(--dsw-alias-state-success-primary,#16a34a)}
.dwf-mini-dot[data-s="running"]{background:#ea7915;animation:dwf-pulse-dot 1.6s ease-in-out infinite}
.dwf-mini-dot[data-s="failed"]{background:var(--dsw-alias-state-error-primary,#e5484d)}
.dwf-mini-dot[data-s="cancelled"]{border:1.4px solid var(--dwf-lamp-idle);box-sizing:border-box;background:var(--dwf-pill-bg)}
.dwf-mini-dot[data-s="pending"],.dwf-mini-dot[data-s="skipped"]{border:1.4px solid var(--dwf-lamp-idle);box-sizing:border-box;background:transparent}

/* Horizontal Station Timeline, Unified Adaptive Lanes & Edge-Only Scroll */
.dwf-timeline{position:relative;min-width:0;overscroll-behavior-x:contain}
.dwf-scroller{width:100%;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain}
.dwf-scroller[data-vscroll="true"]{max-height:276px;overflow-y:auto;overscroll-behavior:contain}
.dwf-scroller[data-dragging="true"],.dwf-scroller[data-dragging="true"] *{cursor:grabbing!important;user-select:none}
.dwf-scroller::-webkit-scrollbar{width:4px;height:0}
.dwf-scroller::-webkit-scrollbar-track{background:transparent}
.dwf-scroller::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgba(128,128,128,.28));border-radius:999px}
.dwf-scroller::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2,rgba(128,128,128,.45))}
.dwf-scroller::-webkit-scrollbar-corner{background:transparent}
@supports not selector(::-webkit-scrollbar){
  .dwf-scroller{scrollbar-width:none}
  .dwf-scroller[data-vscroll="true"]{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(128,128,128,.28)) transparent}
}
.dwf-scroller[data-fade="left"]{-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 52px);mask-image:linear-gradient(90deg,transparent 0,#000 52px)}
.dwf-scroller[data-fade="right"]{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 52px),transparent 100%);mask-image:linear-gradient(90deg,#000 calc(100% - 52px),transparent 100%)}
.dwf-scroller[data-fade="both"]{-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 52px,#000 calc(100% - 52px),transparent 100%);mask-image:linear-gradient(90deg,transparent 0,#000 52px,#000 calc(100% - 52px),transparent 100%)}
.dwf-scroller[data-vscroll="true"][data-fade="right"]{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 48px),rgba(0,0,0,.24) 100%);mask-image:linear-gradient(90deg,#000 calc(100% - 48px),rgba(0,0,0,.24) 100%)}
.dwf-scroller[data-vscroll="true"][data-fade="both"]{-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 52px,#000 calc(100% - 48px),rgba(0,0,0,.24) 100%);mask-image:linear-gradient(90deg,transparent 0,#000 52px,#000 calc(100% - 48px),rgba(0,0,0,.24) 100%)}
.dwf-lanes{display:flex;align-items:stretch;width:100%}
.dwf-lane{flex:1 0 204px;max-width:316px;min-width:0;padding-right:20px;box-sizing:border-box;display:flex;flex-direction:column}
.dwf-lane[data-last="true"]{flex:1 0 184px;max-width:296px;padding-right:0}
.dwf-lanes[data-compact="true"] .dwf-lane{flex-shrink:1;min-width:176px}
.dwf-lanes[data-compact="true"] .dwf-lane[data-last="true"]{min-width:156px}
.dwf-station{position:sticky;top:0;z-index:3;box-sizing:border-box;display:flex;align-items:center;height:32px;padding:0 1px 6px 0;margin-right:-21px;min-width:0;flex:none;background:var(--dwf-surface-solid)}
.dwf-station>*{transition:opacity .16s ease}
.dwf-lane[data-last="true"] .dwf-station{margin-right:0;padding-right:0}
.dwf-station[data-folded="true"]>*{opacity:0;pointer-events:none}
.dwf-lamp{flex:none;width:10px;height:10px;border-radius:999px;margin:0 8px 0 6px;box-sizing:border-box;transition:background-color .24s ease,box-shadow .24s ease,transform .18s ease}
.dwf-lamp[data-s="done"]{background:var(--dsw-alias-state-success-primary,#16a34a)}
.dwf-lamp[data-s="running"]{background:#ea7915;box-shadow:0 0 0 3.5px rgba(234,121,21,.22);animation:dwf-lamp-beat 1.7s ease-in-out infinite}
.dwf-lamp[data-s="failed"]{background:var(--dsw-alias-state-error-primary,#e5484d);box-shadow:0 0 0 3px rgba(229,72,77,.2)}
.dwf-lamp[data-s="cancelled"]{background:var(--dwf-pill-bg);border:1.65px solid var(--dwf-lamp-idle)}
.dwf-lamp[data-s="pending"],.dwf-lamp[data-s="skipped"]{background:transparent;border:1.65px solid var(--dwf-lamp-idle)}
.dwf-station-head{display:flex;align-items:center;gap:6px;min-width:0;flex:0 1 auto;max-width:calc(100% - 58px)}
.dwf-lane[data-last="true"] .dwf-station-head{max-width:calc(100% - 24px)}
.dwf-station-title{font-size:12.5px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1 1 auto}
.dwf-station[data-s="pending"] .dwf-station-title,.dwf-station[data-s="skipped"] .dwf-station-title,.dwf-station[data-s="cancelled"] .dwf-station-title{font-weight:400;color:var(--dsw-alias-label-secondary)}
.dwf-station-frac{flex:none;font-size:12px;line-height:1;font-family:var(--dsw-font-code,monospace);color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dwf-rail-line{flex:1 1 auto;min-width:18px;height:2px;margin:0 4px 0 10px;border:none;border-radius:999px;background:var(--dwf-rail-idle);transition:background-color .24s ease}
.dwf-rail-line[data-ink="done"]{background:var(--dwf-rail-done)}
.dwf-rail-line[data-ink="march"]{background:#ea7915}
.dwf-rail-line[data-ink="next"]{background:linear-gradient(90deg,rgba(234,121,21,.85) 0%,var(--dwf-rail-idle) 74%)}
.dwf-rail-line[data-ink="err"]{background:var(--dsw-alias-state-error-primary,#e5484d)}

/* Pinned overflow ledges (+N ●—●—●────) */
.dwf-ledge{position:absolute;top:0;box-sizing:border-box;height:32px;padding-bottom:6px;display:flex;align-items:center;pointer-events:none;z-index:4}
.dwf-ledge-left{left:0;padding-left:4px;background:linear-gradient(90deg,var(--dwf-surface-solid) 36px,transparent 64px)}
.dwf-ledge-right{right:0;padding-right:4px;background:linear-gradient(270deg,var(--dwf-surface-solid) 36px,transparent 64px)}
.dwf-ledge-more{font-size:11px;font-family:var(--dsw-font-code,monospace);color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;margin:0 5px 0 2px;cursor:pointer;pointer-events:auto;border-radius:4px;padding:1px 2px;transition:color .15s ease,background-color .15s ease}
.dwf-ledge-more:hover{color:var(--dsw-alias-label-primary);background:var(--dwf-pill-bg-hover)}
.dwf-ledge-more:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}
.dwf-ledge-right .dwf-ledge-more{margin:0 2px 0 5px}
.dwf-ledge-dot{position:relative;border:none;padding:0;margin:0;cursor:pointer;pointer-events:auto;background:transparent}
.dwf-ledge-dot::after{content:"";position:absolute;inset:-5px}
.dwf-ledge-dot:hover{transform:scale(1.25)}
.dwf-ledge-dot:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:2px}
.dwf-ledge-seg{width:8px;height:2px;border-radius:999px;background:var(--dwf-rail-idle);flex:none}
.dwf-ledge-stub{height:2px;border-radius:999px;background:var(--dwf-rail-idle);flex:none;margin:0 4px}
.dwf-ledge-left .dwf-ledge-stub{margin-right:0}
.dwf-ledge-right .dwf-ledge-stub{margin-left:0}
.dwf-ledge-seg[data-ink="done"],.dwf-ledge-stub[data-ink="done"]{background:var(--dwf-rail-done)}
.dwf-ledge-seg[data-ink="march"],.dwf-ledge-stub[data-ink="march"]{background:#ea7915}
.dwf-ledge-seg[data-ink="next"],.dwf-ledge-stub[data-ink="next"]{background:linear-gradient(90deg,rgba(234,121,21,.85) 0%,var(--dwf-rail-idle) 76%)}
.dwf-ledge-seg[data-ink="err"],.dwf-ledge-stub[data-ink="err"]{background:var(--dsw-alias-state-error-primary,#e5484d)}

/* Vertical stacks of rounded-full capsule pills */
.dwf-col{width:100%;min-width:0;display:flex;flex-direction:column;gap:6px}
.dwf-pill{box-sizing:border-box;width:100%;height:32px;border-radius:9999px;padding:0 10px 0 7px;display:flex;align-items:center;gap:8px;min-width:0;border:none;font:inherit;font-size:12.5px;text-align:left;background:var(--dwf-pill-bg);color:var(--dsw-alias-label-primary);transition:background-color .16s ease,transform .12s ease}
.dwf-pill[data-open="true"]{cursor:pointer}
.dwf-pill[data-open="true"]:hover,.dwf-pill[data-open="true"]:focus-visible{background:var(--dwf-pill-bg-hover)}
.dwf-pill[data-open="true"]:active{transform:scale(.985)}
.dwf-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}
.dwf-pill-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:18px}
.dwf-pill[data-s="pending"] .dwf-pill-name,.dwf-pill[data-s="cancelled"] .dwf-pill-name,.dwf-pill[data-s="interrupted"] .dwf-pill-name{color:var(--dsw-alias-label-secondary)}
.dwf-pill-script{flex:none;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary)}
.dwf-pill[data-s="pending"] .dwf-pill-script{color:var(--dsw-alias-label-tertiary)}
.dwf-script-ico{width:14px;height:14px}
.dwf-pill-tail{flex:none;width:14px;height:14px;display:grid;place-items:center}
.dwf-pill-tail>*{grid-area:1/1}
.dwf-mark{width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);transition:opacity .15s ease,transform .15s ease}
.dwf-mark svg{width:14px;height:14px}
.dwf-mark-ok{color:var(--dsw-alias-label-secondary)}
.dwf-mark-spin{color:var(--dsw-alias-label-secondary)}
.dwf-mark-spin svg{animation:dwf-spin .9s linear infinite}
.dwf-mark-err{color:var(--dsw-alias-state-error-primary,#e5484d)}
.dwf-pill-go{width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-primary);opacity:0;transform:translateX(-2px);transition:opacity .15s ease,transform .15s ease}
.dwf-pill-go svg{width:14px;height:14px}
.dwf-pill[data-open="true"]:hover .dwf-mark,.dwf-pill[data-open="true"]:focus-visible .dwf-mark{opacity:0;transform:scale(.6)}
.dwf-pill[data-open="true"]:hover .dwf-pill-go,.dwf-pill[data-open="true"]:focus-visible .dwf-pill-go{opacity:1;transform:none}

/* GrokBot / ZCode 20×20 Squircle Face */
.dwf-face{--wf-face-body:#54b9a6;--wf-face-x:-2px;--wf-face-y:0px;flex:none;overflow:visible;display:block}
.dwf-face-md{width:18px;height:18px}
.dwf-face-sm{width:15px;height:15px}
.dwf-face-body{fill:var(--wf-face-body);transition:fill .25s ease,opacity .25s ease}
.dwf-face[data-face-state="sleepy"] .dwf-face-body{opacity:.65}
.dwf-face-eyes{transform:translate(var(--wf-face-x),var(--wf-face-y));transition:transform .36s ease-in-out}
.dwf-face-lids{fill:#fff;transform-box:fill-box;transform-origin:50% 50%}
.dwf-face [data-eye-expression]{display:none}
.dwf-face[data-expression="dots"] [data-eye-expression="dots"],
.dwf-face[data-expression="pill"] [data-eye-expression="pill"],
.dwf-face[data-expression="happy"] [data-eye-expression="happy"],
.dwf-face[data-expression="sleepy"] [data-eye-expression="sleepy"],
.dwf-face[data-expression="focused"] [data-eye-expression="focused"],
.dwf-face[data-expression="sad"] [data-eye-expression="sad"],
.dwf-face[data-expression="confused"] [data-eye-expression="confused"]{display:inline}
.dwf-face-closed{fill:#fff;opacity:0}
.dwf-face[data-motion="blink"] .dwf-face-lids{animation:dwf-face-blink var(--wf-blink-time,230ms) ease-in-out var(--wf-blinks,2)}
.dwf-face[data-motion="blink"] .dwf-face-closed{animation:dwf-face-closed-blink var(--wf-blink-time,230ms) ease-in-out var(--wf-blinks,2)}
.dwf-face[data-motion="morph"] .dwf-face-lids{animation:dwf-face-morph 180ms ease-in-out}
.dwf-face[data-motion="morph"] .dwf-face-closed{animation:dwf-face-closed-morph 180ms ease-in-out}
.dwf-face[data-motion="hop"] .dwf-face-bounce{animation:dwf-face-hop 240ms ease-in-out var(--wf-hops,2)}
.dwf-face[data-motion="float"] .dwf-face-bounce{animation:dwf-face-float 600ms ease-in-out var(--wf-floats,1)}
.dwf-face[data-motion="shake"] .dwf-face-bounce{animation:dwf-face-shake 90ms linear var(--wf-shakes,3)}
.dwf-face[data-motion="dots-wave"] [data-eye-expression="dots"] circle{animation:dwf-face-dot-float 500ms ease-in-out both}
.dwf-face[data-motion="dots-wave"] [data-eye-expression="dots"] circle:nth-child(2){animation-delay:.18s}
.dwf-face[data-motion="dots-wave"] [data-eye-expression="dots"] circle:nth-child(3){animation-delay:.36s}

/* Stacked mini puppet deck */
.dwf-deck{display:inline-flex;align-items:center;flex:none}
.dwf-deck-slot{display:inline-flex;border-radius:35%;box-shadow:0 0 0 1.5px var(--dwf-surface-solid,var(--dsw-alias-bg-base,#fff));transition:margin-left .18s ease}
.dwf-deck-slot+.dwf-deck-slot{margin-left:-5px}
.dwf-pill:hover .dwf-deck-slot+.dwf-deck-slot,.dwf-row:hover .dwf-deck-slot+.dwf-deck-slot{margin-left:-2px}

/* Message-flow one-line replacement row */
.dwf-row{--dwf-rail-idle:rgba(112,118,130,.64);--dwf-rail-done:rgba(78,85,98,.84);--dwf-lamp-idle:rgba(102,108,120,.88);box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-width:0;min-height:32px;padding:4px 10px;border:none;border-radius:var(--dsw-radius-md,8px);background:rgba(127,127,127,.06);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;text-align:left;cursor:pointer;transition:background-color .16s ease,transform .12s ease}
.dwf-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.11))}
@supports (color:color-mix(in srgb,red,red)){
  .dwf-row{--dwf-rail-idle:color-mix(in srgb,var(--dsw-alias-label-primary,#1f2329) 45%,transparent);--dwf-rail-done:color-mix(in srgb,var(--dsw-alias-label-primary,#1f2329) 64%,transparent);--dwf-lamp-idle:color-mix(in srgb,var(--dsw-alias-label-primary,#1f2329) 64%,transparent);background:color-mix(in srgb,var(--dsw-alias-label-primary,#1f2329) 5.5%,transparent)}
  .dwf-row:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary,#1f2329) 10%,transparent)}
}
.dwf-row:active{transform:scale(.995)}
.dwf-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}
.dwf-row-name{color:var(--dsw-alias-label-primary);font-weight:500;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dwf-row-meta{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dwf-row-go{flex:none;width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);opacity:.55;transform:translateX(-1px);transition:opacity .15s ease,transform .15s ease,color .15s ease}
.dwf-row-go svg{width:14px;height:14px}
.dwf-row:hover .dwf-row-go{opacity:1;transform:translateX(1px);color:var(--dsw-alias-label-primary)}
.dwf-empty{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dwf-flash{font-size:12px;line-height:1.45;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.dwf-flash[data-err="true"]{color:var(--dsw-alias-state-error-primary,#e5484d)}

@keyframes dwf-kind-flow{0%{background-position:100% 0}100%{background-position:-100% 0}}
@keyframes dwf-spin{to{transform:rotate(360deg)}}
@keyframes dwf-pulse-dot{0%,100%{opacity:1}50%{opacity:.45}}
@keyframes dwf-lamp-beat{0%,100%{box-shadow:0 0 0 3px rgba(234,121,21,.2),0 0 0 3px rgba(234,121,21,0);transform:scale(1)}18%{transform:scale(1.12)}70%{box-shadow:0 0 0 3.5px rgba(234,121,21,.22),0 0 0 8px rgba(234,121,21,0);transform:scale(1)}}
@keyframes dwf-face-blink{0%,70%,100%{opacity:1;transform:scaleY(1)}35%{opacity:0;transform:scaleY(.333333)}}
@keyframes dwf-face-closed-blink{0%,70%,100%{opacity:0}35%{opacity:1}}
@keyframes dwf-face-morph{0%,100%{opacity:1;transform:scaleY(1)}40%,50%{opacity:0;transform:scaleY(.333333)}}
@keyframes dwf-face-closed-morph{0%,100%{opacity:0}40%,50%{opacity:1}}
@keyframes dwf-face-hop{0%,100%{transform:translateY(0)}35%{transform:translateY(-1.1px)}70%{transform:translateY(.7px)}}
@keyframes dwf-face-float{0%,100%{transform:translateY(0)}30%{transform:translateY(-.5px)}70%{transform:translateY(.5px)}}
@keyframes dwf-face-shake{0%,100%{transform:translate(0,0)}25%{transform:translate(-.9px,-.35px)}75%{transform:translate(.9px,.35px)}}
@keyframes dwf-face-dot-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}
@media (prefers-reduced-motion:reduce){
  .dwf-kind[data-live="true"]{animation:none;background:none;color:var(--dsw-alias-label-primary);-webkit-text-fill-color:currentColor}
  .dwf-lamp,.dwf-mark-spin svg,.dwf-stop-spin path,.dwf-mini-dot,.dwf-face [data-eye-expression="dots"] circle,.dwf-face-lids,.dwf-face-closed,.dwf-face-eyes,.dwf-face-bounce{animation:none!important;transition:none!important}
}
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
      // Helpers: Counts, Active Model, Header Progress Summary
      // -------------------------------------------------------------------
      function doneCount(run) {
        const counts = run.counts || {};
        return (counts.completed || 0) + (counts.failed || 0) + (counts.cancelled || 0) + (counts.interrupted || 0);
      }

      function primaryModel(run) {
        const nodes = Array.isArray(run && run.nodes) ? run.nodes : [];
        for (const node of nodes) {
          if (node.status === "running" && node.model) return node.model;
        }
        for (let i = nodes.length - 1; i >= 0; i -= 1) {
          if (nodes[i].model) return nodes[i].model;
        }
        const lanes = run && run.graph && Array.isArray(run.graph.lanes) ? run.graph.lanes : [];
        for (const lane of lanes) {
          if (lane.model) return lane.model;
        }
        if (run && typeof run.model === "string" && run.model !== "") return run.model;
        return "";
      }

      /**
       * Header detail line aligned with the reference screenshot:
       * e.g. `9 个阶段 · 1 个子代理工作中 · deepseek-v4.1-flash`
       */
      function progressText(run, lang) {
        const lanes = run && run.graph && Array.isArray(run.graph.lanes) ? run.graph.lanes : [];
        const phaseTotal = lanes.length || run.phases || 0;
        const counts = run.counts || {};
        const working = counts.running || 0;
        const totalAgents = run.agents || 0;
        const done = doneCount(run);
        const parts = [];
        if (phaseTotal > 0) parts.push(t(lang, "phases", { n: phaseTotal }));
        if (run.status === "running") {
          if (working > 0) parts.push(t(lang, "agentsWorking", { n: working }));
          else if (totalAgents > 0) parts.push(t(lang, "agents", { done, n: totalAgents }));
        } else if (totalAgents > 0) {
          parts.push(t(lang, "subagents", { n: totalAgents }));
        }
        const model = primaryModel(run);
        if (model) parts.push(model);
        const dur = formatDuration(run.startedAt, run.endedAt);
        if (run.status !== "running" && dur) parts.push(dur);
        return parts.filter(Boolean).join(" · ");
      }

      function railInkBetween(leftLane, rightLane) {
        if (!leftLane || !rightLane) return "solid";
        if (rightLane.state === "running") return "march";
        if (leftLane.state === "running") return "next";
        if (leftLane.state === "done" && rightLane.state === "failed") return "err";
        if (leftLane.state === "done" && (rightLane.state === "done" || rightLane.state === "cancelled")) return "done";
        return "solid";
      }

      function MiniStationRail({ lanes, onSelectPhase, lang }) {
        const list = Array.isArray(lanes) ? lanes : [];
        if (list.length === 0) return null;
        const interactive = typeof onSelectPhase === "function";
        const maxDots = 10;
        let start = 0;
        if (list.length > maxDots) {
          const runIdx = list.findIndex((lane) => lane.state === "running");
          const focusIdx = runIdx >= 0 ? runIdx : list.findIndex((lane) => lane.state === "failed");
          if (focusIdx >= maxDots) {
            start = Math.min(list.length - maxDots, focusIdx - (maxDots - 3));
          }
        }
        const shown = list.slice(start, start + maxDots);
        const items = [];
        shown.forEach((lane, idx) => {
          const realIdx = start + idx;
          if (idx > 0) {
            items.push(h("span", {
              key: `s${realIdx}`,
              className: "dwf-mini-seg",
              "data-ink": railInkBetween(shown[idx - 1], lane),
              "aria-hidden": "true",
            }));
          }
          const phaseTitle = lane.title || t(lang || "zh", "phaseNone");
          const tip = interactive ? t(lang || "zh", "jumpPhase", { title: phaseTitle }) : (lane.title || "");
          items.push(h("span", {
            key: lane.id || realIdx,
            className: "dwf-mini-dot",
            "data-s": lane.state || "pending",
            "data-interactive": interactive ? "true" : undefined,
            role: interactive ? "button" : undefined,
            tabIndex: interactive ? 0 : undefined,
            title: tip,
            "aria-label": interactive ? tip : undefined,
            onClick: interactive ? (e) => {
              if (e && typeof e.stopPropagation === "function") e.stopPropagation();
              onSelectPhase(realIdx);
            } : undefined,
            onKeyDown: interactive ? (e) => {
              if (e && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                e.stopPropagation();
                onSelectPhase(realIdx);
              }
            } : undefined,
          }));
        });
        return h("span", { className: "dwf-mini-rail", "aria-hidden": interactive ? undefined : "true" }, items);
      }

      // -------------------------------------------------------------------
      // Agent Capsule Pill & Station Timeline (`Graph`)
      // -------------------------------------------------------------------
      function formatAgentLabel(node, lang) {
        const raw = typeof (node && node.label) === "string" ? node.label.trim() : "";
        const generic = raw === "" ? null : /^(?:agent|subagent)s?(?:[\s·•\-_:：#]*(\d+))?$/iu.exec(raw);
        if (raw === "" || generic !== null) {
          const seq = (generic && generic[1]) ? Number(generic[1]) : (node && node.seq);
          return seq ? `${t(lang, "plannedAgent")} #${seq}` : t(lang, "plannedAgent");
        }
        return raw;
      }

      function buildNodeTooltip(node, displayName, lang, canOpenAgent) {
        const parts = [node.seq && !displayName.includes(`#${node.seq}`) ? `#${node.seq} ${displayName}` : displayName];
        if (node.model) {
          const fullModel = node.provider ? `${node.provider}/${node.model}` : node.model;
          parts.push(node.modelDeclared ? `${fullModel} (${t(lang, "modelPlanned")})` : fullModel);
        }
        const dur = formatDuration(node.startedAt, node.endedAt);
        if (dur) parts.push(dur);
        const status = node.status || "pending";
        parts.push(t(lang, `status_${status}`));
        if (canOpenAgent) parts.push(t(lang, "openAgent"));
        return parts.join(" · ");
      }

      function AgentPill({ node, lang, openNode }) {
        const isScript = node.kind === "script";
        const canOpen = Boolean(!isScript && openNode && node.childId);
        const status = node.status || "pending";
        const displayName = isScript
          ? (node.label || t(lang, "scriptNode"))
          : formatAgentLabel(node, lang);
        const tooltip = buildNodeTooltip(node, displayName, lang, canOpen);
        const showTail = (status && status !== "pending") || canOpen;
        const tag = canOpen ? "button" : "div";

        return h(tag, {
          className: "dwf-pill",
          type: canOpen ? "button" : undefined,
          "data-s": status,
          "data-kind": isScript ? "script" : "agent",
          "data-seq": node.seq != null ? node.seq : undefined,
          "data-open": String(canOpen),
          title: tooltip,
          "aria-label": canOpen ? tooltip : undefined,
          onClick: canOpen ? () => openNode(node) : undefined,
        },
          isScript
            ? h("span", { className: "dwf-pill-script", "aria-hidden": "true" }, h(TerminalScriptIcon, null))
            : h(AgentAvatar, { seq: node.seq, label: displayName, status, avatarSlot: node.avatarSlot, size: "md" }),
          h("span", { className: "dwf-pill-name" }, displayName),
          showTail ? h("span", { className: "dwf-pill-tail" },
            h(PillStatusMark, { status, title: t(lang, `status_${status}`) }),
            canOpen ? h("span", { className: "dwf-pill-go", "aria-hidden": "true" }, h(ChevronRightMini, null)) : null) : null);
      }

      const ORDER_RANK = { running: 0, failed: 1, error: 1, pending: 2, completed: 3, cancelled: 4, interrupted: 4 };
      function splitStationNodes(nodes, expanded) {
        if (nodes.length <= 6 || expanded) return { shown: nodes, rest: [] };
        const sorted = nodes
          .map((node, i) => ({ node, i }))
          .sort((a, b) => (ORDER_RANK[a.node.status] ?? 3) - (ORDER_RANK[b.node.status] ?? 3) || a.i - b.i)
          .map((x) => x.node);
        return { shown: sorted.slice(0, 5), rest: sorted.slice(5) };
      }

      function resolveLaneItems(lanes, allNodes) {
        const bySeq = new Map((allNodes || []).map((node) => [node.seq, node]));
        const roleSlots = new Map();
        return lanes.map((lane) => {
          const raw = Array.isArray(lane.items)
            ? lane.items
            : (lane.nodes || []).map((seq) => bySeq.get(seq)).filter(Boolean);
          const seenInLane = new Map();
          return raw.map((item, idx) => {
            if (item.kind === "script" || Number.isInteger(item.avatarSlot)) return item;
            const label = item.label || `#${item.seq || idx + 1}`;
            const occ = (seenInLane.get(label) || 0) + 1;
            seenInLane.set(label, occ);
            const roleKey = `${label}@${occ}`;
            if (!roleSlots.has(roleKey)) roleSlots.set(roleKey, roleSlots.size);
            return { ...item, avatarSlot: roleSlots.get(roleKey) };
          });
        });
      }

      function translateTimelineWheel(metrics, event) {
        if (!metrics || !event || event.ctrlKey) return 0;
        const {
          scrollLeft = 0,
          scrollWidth = 0,
          clientWidth = 0,
          scrollHeight = 0,
          clientHeight = 0,
        } = metrics;
        if (scrollWidth <= clientWidth + 4) return 0;
        const mode = Number(event.deltaMode) || 0;
        const scale = mode === 1 ? WHEEL_LINE_PX : mode === 2 ? (clientWidth || 1) : 1;
        const dx = (Number(event.deltaX) || 0) * scale;
        const dy = (Number(event.deltaY) || 0) * scale;
        if (Math.abs(dx) >= Math.abs(dy) || dy === 0) return 0;
        const verticalOverflow = scrollHeight > clientHeight + 2;
        const forceHorizontal = Boolean(event.shiftKey || event.onStation);
        if (verticalOverflow && !forceHorizontal) return 0;
        if (dy < 0 && scrollLeft <= 0.5) return 0;
        if (dy > 0 && scrollLeft + clientWidth >= scrollWidth - 1) return 0;
        return dy;
      }

      function StationLedge({ side, indices, lanes, scrollLeft, clientWidth, nextLaneLeft, prevLaneRight, onSelectIndex, lang }) {
        if (!indices || indices.length === 0) return null;
        const isLeft = side === "left";
        const extra = Math.max(0, indices.length - 3);
        const shown = isLeft ? indices.slice(-3) : indices.slice(0, 3);
        const children = [];
        const jumpMoreIdx = isLeft ? 0 : Math.max(0, lanes.length - 1);
        const jumpMoreTip = t(lang || "zh", isLeft ? "jumpStart" : "jumpEnd");
        const moreWidth = extra >= 10 ? 32 : extra > 0 ? 25 : 0;
        const used = moreWidth + shown.length * 10 + Math.max(0, shown.length - 1) * 8;

        if (!isLeft) {
          const firstFoldedIdx = indices[0];
          const lastVisIdx = firstFoldedIdx - 1;
          const rawInk = lastVisIdx >= 0 ? railInkBetween(lanes[lastVisIdx], lanes[firstFoldedIdx]) : "solid";
          const fadeStart = clientWidth > 0 ? clientWidth - 56 : Infinity;
          const rawJoin = prevLaneRight != null ? prevLaneRight - scrollLeft - 5 : 0;
          const stubInk = rawInk === "next" && rawJoin <= fadeStart + 8 ? "solid" : rawInk;
          let stubW = 16;
          if (lastVisIdx >= 0 && clientWidth > 0 && prevLaneRight != null) {
            const targetLeft = Math.max(8, Math.min(rawJoin, fadeStart));
            const firstDotLeft = clientWidth - 4 - used;
            stubW = Math.max(10, Math.min(240, Math.round(firstDotLeft - 4 - targetLeft)));
          }
          children.push(h("span", { key: "stub-l", className: "dwf-ledge-stub", "data-ink": stubInk, style: { width: `${stubW}px` } }));
        }
        if (isLeft && extra > 0) {
          children.push(h("span", {
            key: "more",
            className: "dwf-ledge-more",
            role: "button",
            tabIndex: 0,
            title: jumpMoreTip,
            "aria-label": jumpMoreTip,
            onClick: () => onSelectIndex(jumpMoreIdx),
            onKeyDown: (e) => { if (e && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelectIndex(jumpMoreIdx); } },
          }, `+${extra}`));
        }
        shown.forEach((sIdx, k) => {
          if (k > 0) {
            children.push(h("span", {
              key: `seg-${sIdx}`,
              className: "dwf-ledge-seg",
              "data-ink": railInkBetween(lanes[shown[k - 1]], lanes[sIdx]),
            }));
          }
          const lane = lanes[sIdx];
          const phaseTitle = (lane && lane.title) || t(lang || "zh", "phaseNone");
          const tip = t(lang || "zh", "jumpPhase", { title: phaseTitle });
          children.push(h("button", {
            key: `dot-${sIdx}`,
            type: "button",
            className: "dwf-lamp dwf-ledge-dot",
            "data-s": (lane && lane.state) || "pending",
            title: tip,
            "aria-label": tip,
            onClick: () => onSelectIndex(sIdx),
          }));
        });
        if (!isLeft && extra > 0) {
          children.push(h("span", {
            key: "more",
            className: "dwf-ledge-more",
            role: "button",
            tabIndex: 0,
            title: jumpMoreTip,
            "aria-label": jumpMoreTip,
            onClick: () => onSelectIndex(jumpMoreIdx),
            onKeyDown: (e) => { if (e && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelectIndex(jumpMoreIdx); } },
          }, `+${extra}`));
        }
        if (isLeft) {
          const lastFoldedIdx = indices[indices.length - 1];
          const firstVis = lastFoldedIdx + 1;
          const laneX = nextLaneLeft != null ? nextLaneLeft : firstVis * STATION_PITCH;
          const nextLampX = firstVis < lanes.length ? laneX - scrollLeft + 6 : 28;
          const stubW = Math.max(10, Math.min(240, Math.round(nextLampX - used - 14)));
          const stubInk = railInkBetween(lanes[lastFoldedIdx], lanes[firstVis]);
          children.push(h("span", { key: "stub-r", className: "dwf-ledge-stub", "data-ink": stubInk, style: { width: `${stubW}px` } }));
        }

        return h("div", {
          className: `dwf-ledge dwf-ledge-${side}`,
          "data-ledge": side,
        }, children);
      }

      function Graph({ run, lang, openNode, scrollerRef: externalRef, focusRequest, onAwayChange }) {
        const lanes = run.graph && Array.isArray(run.graph.lanes) ? run.graph.lanes : [];
        const localScroller = useBoxRef(null);
        const scrollerRef = externalRef || localScroller;
        const timelineRef = useBoxRef(null);
        const lanesRef = useBoxRef(null);
        const [viewport, setViewport] = react.useState({ scrollLeft: 0, clientWidth: 0, scrollWidth: 0 });
        const [openLanes, setOpenLanes] = react.useState(() => new Set());
        const [dragging, setDragging] = react.useState(false);
        const followRef = useBoxRef({ paused: false, programmaticUntil: 0, lastAway: false, progTimer: null, measure: null });
        const dragRef = useBoxRef({ down: false, moved: false, startX: 0, startY: 0, startLeft: 0, pointerId: null, suppressUntil: 0 });

        const runningIdx = lanes.findIndex((lane) => lane.state === "running");
        const activeIdx = runningIdx >= 0 ? runningIdx : lanes.findIndex((lane) => lane.state === "failed");

        const laneBox = (idx) => {
          const host = lanesRef.current;
          const child = host && host.children && host.children[idx];
          if (child && typeof child.offsetLeft === "number" && child.offsetWidth > 0) {
            return { left: child.offsetLeft, width: child.offsetWidth };
          }
          return { left: idx * STATION_PITCH, width: STATION_PITCH };
        };

        const interruptProgrammaticScroll = (el, nextLeft) => {
          if (!el) return;
          const wasProgrammatic = Date.now() <= followRef.current.programmaticUntil;
          if (followRef.current.progTimer !== null) {
            clearTimeout(followRef.current.progTimer);
            followRef.current.progTimer = null;
          }
          followRef.current.programmaticUntil = 0;
          const maxLeft = Math.max(0, (el.scrollWidth || 0) - (el.clientWidth || 0));
          const targetLeft = nextLeft === undefined
            ? (el.scrollLeft || 0)
            : Math.max(0, Math.min(maxLeft, nextLeft));
          if (wasProgrammatic && typeof el.scrollTo === "function") {
            el.scrollTo({ left: targetLeft, behavior: "instant" });
          }
          if (nextLeft !== undefined) {
            el.scrollLeft = targetLeft;
          }
          if (wasProgrammatic && typeof followRef.current.measure === "function") {
            followRef.current.measure(true);
          }
        };

        const scrollLaneIntoView = (idx, alignRight) => {
          const el = scrollerRef.current;
          if (!el || idx < 0 || idx >= lanes.length || el.scrollWidth <= el.clientWidth) return;
          const box = laneBox(idx);
          const leftClearance = idx === 0 ? 0 : idx >= 13 ? 104 : idx >= 4 ? 96 : idx === 3 ? 70 : 56;
          const desiredRight = idx + 1 < lanes.length
            ? box.left + box.width + PILL_WIDTH - el.clientWidth
            : box.left + box.width - el.clientWidth + 24;
          const raw = alignRight
            ? Math.max(0, Math.min(desiredRight, Math.max(0, box.left - leftClearance)))
            : Math.max(0, box.left - leftClearance);
          const clamped = Math.min(raw, Math.max(0, el.scrollWidth - el.clientWidth));
          followRef.current.programmaticUntil = Date.now() + 680;
          if (followRef.current.progTimer !== null) clearTimeout(followRef.current.progTimer);
          followRef.current.progTimer = setTimeout(() => {
            followRef.current.progTimer = null;
            if (typeof followRef.current.measure === "function") followRef.current.measure();
          }, 700);
          if (typeof el.scrollTo === "function") el.scrollTo({ left: clamped, behavior: "smooth" });
          else el.scrollLeft = clamped;
        };

        react.useEffect(() => () => {
          if (followRef.current.progTimer !== null) {
            clearTimeout(followRef.current.progTimer);
            followRef.current.progTimer = null;
          }
        }, []);

        react.useEffect(() => {
          setOpenLanes((prev) => (prev.size > 0 ? new Set() : prev));
          if (followRef.current.progTimer !== null) clearTimeout(followRef.current.progTimer);
          followRef.current.paused = false;
          followRef.current.programmaticUntil = 0;
          followRef.current.lastAway = false;
          followRef.current.progTimer = null;
        }, [run && run.id]);

        react.useEffect(() => {
          if (openLanes.size === 0 && scrollerRef.current && scrollerRef.current.scrollTop) {
            scrollerRef.current.scrollTop = 0;
          }
        }, [openLanes.size]);

        react.useEffect(() => {
          if (runningIdx < 0 || followRef.current.paused) return;
          scrollLaneIntoView(runningIdx, true);
        }, [runningIdx, lanes.length]);

        react.useEffect(() => {
          const el = scrollerRef.current;
          if (!el) return undefined;
          const measure = (fromScroll) => {
            const scrollLeft = el.scrollLeft || 0;
            const clientWidth = el.clientWidth || 0;
            const scrollWidth = el.scrollWidth || 0;
            setViewport((prev) => (
              prev.scrollLeft === scrollLeft && prev.clientWidth === clientWidth && prev.scrollWidth === scrollWidth
                ? prev
                : { scrollLeft, clientWidth, scrollWidth }
            ));
            if (activeIdx >= 0 && clientWidth > 0 && scrollWidth > clientWidth + 8) {
              const box = laneBox(activeIdx);
              const away = (box.left + box.width - 28 < scrollLeft) || (box.left + 48 > scrollLeft + clientWidth);
              const inProgrammatic = Date.now() <= followRef.current.programmaticUntil;
              if (!inProgrammatic) {
                if (fromScroll === true) followRef.current.paused = away;
                else if (!away) followRef.current.paused = false;
              }
              if ((!inProgrammatic || !away) && followRef.current.lastAway !== away) {
                followRef.current.lastAway = away;
                if (typeof onAwayChange === "function") onAwayChange(away);
              }
            } else {
              followRef.current.paused = false;
              if (followRef.current.lastAway) {
                followRef.current.lastAway = false;
                if (typeof onAwayChange === "function") onAwayChange(false);
              }
            }
          };
          const onScroll = () => measure(true);
          const onResize = () => measure(false);
          const wheelScale = (e) => {
            const mode = Number(e.deltaMode) || 0;
            return mode === 1 ? WHEEL_LINE_PX : mode === 2 ? (el.clientWidth || 1) : 1;
          };
          const onWheel = (e) => {
            if (!e) return;
            const target = e.target;
            const onStation = Boolean(target && typeof target.closest === "function" && target.closest(".dwf-station, .dwf-ledge"));
            const scrollWidth = el.scrollWidth || 0;
            const clientWidth = el.clientWidth || 0;
            const delta = translateTimelineWheel({
              scrollLeft: el.scrollLeft || 0,
              scrollWidth,
              clientWidth,
              scrollHeight: el.scrollHeight || 0,
              clientHeight: el.clientHeight || 0,
            }, {
              deltaX: e.deltaX,
              deltaY: e.deltaY,
              deltaMode: e.deltaMode,
              shiftKey: e.shiftKey,
              ctrlKey: e.ctrlKey,
              onStation,
            });
            if (delta !== 0) {
              if (typeof e.preventDefault === "function") e.preventDefault();
              interruptProgrammaticScroll(el, (el.scrollLeft || 0) + delta);
              return;
            }
            const scale = wheelScale(e);
            const dx = (Number(e.deltaX) || 0) * scale;
            const dy = (Number(e.deltaY) || 0) * scale;
            if (!e.ctrlKey && dx !== 0 && Math.abs(dx) >= Math.abs(dy) && scrollWidth > clientWidth + 4) {
              interruptProgrammaticScroll(el);
            }
          };
          const timelineEl = timelineRef.current;
          const onLedgeWheel = (e) => {
            if (!e || (typeof el.contains === "function" && el.contains(e.target))) return;
            const scale = wheelScale(e);
            const dx = (Number(e.deltaX) || 0) * scale;
            const dy = (Number(e.deltaY) || 0) * scale;
            if (!e.ctrlKey && dx !== 0 && Math.abs(dx) >= Math.abs(dy)) {
              if (typeof e.preventDefault === "function") e.preventDefault();
              if ((el.scrollWidth || 0) > (el.clientWidth || 0) + 4) {
                interruptProgrammaticScroll(el, (el.scrollLeft || 0) + dx);
              }
              return;
            }
            onWheel(e);
          };
          followRef.current.measure = measure;
          measure(false);
          if (typeof el.addEventListener === "function") {
            el.addEventListener("scroll", onScroll, { passive: true });
            el.addEventListener("wheel", onWheel, { passive: false });
          }
          if (timelineEl && timelineEl !== el && typeof timelineEl.addEventListener === "function") {
            timelineEl.addEventListener("wheel", onLedgeWheel, { passive: false });
          }
          const ro = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
          if (ro) {
            ro.observe(el);
            if (lanesRef.current) ro.observe(lanesRef.current);
          }
          return () => {
            followRef.current.measure = null;
            if (typeof el.removeEventListener === "function") {
              el.removeEventListener("scroll", onScroll);
              el.removeEventListener("wheel", onWheel);
            }
            if (timelineEl && timelineEl !== el && typeof timelineEl.removeEventListener === "function") {
              timelineEl.removeEventListener("wheel", onLedgeWheel);
            }
            if (ro) ro.disconnect();
          };
        }, [lanes.length, activeIdx]);

        react.useEffect(() => {
          if (!focusRequest || !focusRequest.seq) return;
          const idx = Number.isInteger(focusRequest.idx)
            ? focusRequest.idx
            : (activeIdx >= 0 ? activeIdx : Math.max(0, lanes.length - 1));
          const willPause = activeIdx >= 0 && idx !== activeIdx;
          followRef.current.paused = willPause;
          if (!willPause) {
            followRef.current.lastAway = false;
            if (typeof onAwayChange === "function") onAwayChange(false);
          }
          scrollLaneIntoView(idx, false);
        }, [focusRequest && focusRequest.seq]);

        if (lanes.length === 0) return h("div", { className: "dwf-empty" }, t(lang, "empty"));

        const laneItemsList = resolveLaneItems(lanes, run.nodes);

        const hasLeft = viewport.scrollLeft > 8;
        const hasRight = viewport.scrollWidth > viewport.clientWidth && viewport.scrollLeft < viewport.scrollWidth - viewport.clientWidth - 8;
        const fade = hasLeft && hasRight ? "both" : hasLeft ? "left" : hasRight ? "right" : undefined;

        const leftFolded = [];
        const rightFolded = [];
        if (viewport.clientWidth > 0 && viewport.scrollWidth > viewport.clientWidth + 4) {
          lanes.forEach((_, idx) => {
            const box = laneBox(idx);
            const leftClear = leftFolded.length >= 13 ? 100 : leftFolded.length >= 4 ? 92 : leftFolded.length === 3 ? 66 : 48;
            const afterCount = lanes.length - 1 - idx;
            const rightClear = afterCount >= 13 ? 96 : afterCount >= 4 ? 88 : afterCount === 3 ? 62 : afterCount === 2 ? 44 : 28;
            const rightEdge = afterCount === 0 ? box.left + Math.min(box.width, 148) : box.left + box.width - 4;
            const rightLimit = viewport.scrollLeft + viewport.clientWidth - (afterCount === 0 ? 0 : rightClear);
            if (hasLeft && box.left < viewport.scrollLeft + leftClear) leftFolded.push(idx);
            else if (hasRight && rightEdge > rightLimit) rightFolded.push(idx);
          });
        }
        const foldedSet = new Set([...leftFolded, ...rightFolded]);
        const firstVisIdx = leftFolded.length > 0 ? leftFolded[leftFolded.length - 1] + 1 : 0;
        const nextLaneLeft = firstVisIdx < lanes.length ? laneBox(firstVisIdx).left : undefined;
        const lastVisIdx = rightFolded.length > 0 ? rightFolded[0] - 1 : -1;
        const prevBox = lastVisIdx >= 0 ? laneBox(lastVisIdx) : null;
        const prevLaneRight = prevBox ? prevBox.left + prevBox.width : undefined;

        const scrollToIndex = (idx) => {
          followRef.current.paused = activeIdx >= 0 && idx !== activeIdx;
          scrollLaneIntoView(idx, false);
        };

        const toggleLaneExpand = (id) => {
          setOpenLanes((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        };

        const onPointerDown = (e) => {
          const el = scrollerRef.current;
          if (!el || !e || e.button !== 0 || e.pointerType === "touch" || el.scrollWidth <= el.clientWidth + 4) return;
          dragRef.current = {
            down: true,
            moved: false,
            startX: e.clientX || 0,
            startY: e.clientY || 0,
            startLeft: el.scrollLeft || 0,
            pointerId: e.pointerId,
            suppressUntil: dragRef.current.suppressUntil,
          };
        };

        const onPointerMove = (e) => {
          const st = dragRef.current;
          const el = scrollerRef.current;
          if (!st.down || !el || !e) return;
          const dx = (e.clientX || 0) - st.startX;
          const dy = (e.clientY || 0) - st.startY;
          if (!st.moved) {
            if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
              st.down = false;
              return;
            }
            if (Math.abs(dx) > 6 && Math.abs(dx) >= Math.abs(dy)) {
              st.moved = true;
              setDragging(true);
              if (typeof el.setPointerCapture === "function" && st.pointerId != null) {
                try { el.setPointerCapture(st.pointerId); } catch { /* ignore */ }
              }
            }
          }
          if (st.moved) {
            interruptProgrammaticScroll(el, st.startLeft - dx);
          }
        };

        const finishDrag = (e) => {
          const st = dragRef.current;
          if (!st.down) return;
          const wasMoved = st.moved;
          st.down = false;
          st.moved = false;
          if (wasMoved) {
            st.suppressUntil = Date.now() + 180;
            setDragging(false);
            const el = scrollerRef.current;
            if (el && typeof el.releasePointerCapture === "function" && e && e.pointerId != null) {
              try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
            }
          }
        };

        const onClickCapture = (e) => {
          if (Date.now() < dragRef.current.suppressUntil && e && typeof e.stopPropagation === "function") {
            e.preventDefault();
            e.stopPropagation();
          }
        };

        const laneColumns = lanes.map((lane, index) => {
          const isLast = index === lanes.length - 1;
          const nextLane = lanes[index + 1];
          const items = laneItemsList[index];
          const observed = items.filter((n) => n.status && n.status !== "pending").length;
          const settled = items.filter((n) => n.status && n.status !== "pending" && n.status !== "running").length;
          const showFraction = lane.state !== "pending" && lane.state !== "skipped" && observed > 0;
          const ink = railInkBetween(lane, nextLane);
          const expanded = openLanes.has(lane.id);
          const folded = foldedSet.has(index);
          const { shown, rest } = splitStationNodes(items, expanded);

          return h("div", {
            key: lane.id,
            className: "dwf-lane",
            "data-last": isLast ? "true" : undefined,
          },
            h("div", {
              className: "dwf-station",
              "data-s": lane.state,
              "data-lane": lane.title,
              "data-folded": folded ? "true" : undefined,
              title: folded ? undefined : (lane.detail ? `${lane.title || t(lang, "phaseNone")} — ${lane.detail}` : (lane.title || t(lang, "phaseNone"))),
            },
              h("span", { className: "dwf-lamp", "data-s": lane.state, "aria-hidden": "true" }),
              h("span", { className: "dwf-station-head" },
                h("span", { className: "dwf-station-title" }, lane.title || t(lang, "phaseNone")),
                showFraction ? h("span", { className: "dwf-station-frac" }, `${settled}/${observed}`) : null),
              !isLast ? h("span", { className: "dwf-rail-line", "data-ink": ink, "aria-hidden": "true" }) : null),
            h("div", { className: "dwf-col", "data-col-lane": lane.id },
              shown.map((node, i) => h(AgentPill, {
                key: node.key || node.seq || `i${i}`,
                node,
                lang,
                openNode,
              })),
              rest.length > 0 || (expanded && items.length > 6)
                ? h("button", {
                    type: "button",
                    className: "dwf-pill",
                    "data-open": "true",
                    "data-more": String(rest.length),
                    onClick: () => toggleLaneExpand(lane.id),
                  },
                    !expanded ? h(AvatarDeck, { agents: rest.filter((x) => x.kind !== "script"), max: 3 }) : null,
                    h("span", { className: "dwf-pill-name" },
                      expanded ? t(lang, "foldAgents") : t(lang, "moreAgents", { n: rest.length })))
                : null));
        });

        return h("div", { ref: timelineRef, className: "dwf-timeline", role: "list" },
          h("div", {
            ref: scrollerRef,
            className: "dwf-scroller",
            "data-fade": fade,
            "data-vscroll": openLanes.size > 0 ? "true" : undefined,
            "data-dragging": dragging ? "true" : undefined,
            onPointerDown,
            onPointerMove,
            onPointerUp: finishDrag,
            onPointerCancel: finishDrag,
            onClickCapture,
          },
            h("div", {
              ref: lanesRef,
              className: "dwf-lanes",
              "data-compact": lanes.length <= 3 ? "true" : undefined,
            }, laneColumns)),
          h(StationLedge, {
            side: "left",
            indices: leftFolded,
            lanes,
            scrollLeft: viewport.scrollLeft,
            nextLaneLeft,
            onSelectIndex: scrollToIndex,
            lang,
          }),
          h(StationLedge, {
            side: "right",
            indices: rightFolded,
            lanes,
            scrollLeft: viewport.scrollLeft,
            clientWidth: viewport.clientWidth,
            prevLaneRight,
            onSelectIndex: scrollToIndex,
            lang,
          }));
      }

      // -------------------------------------------------------------------
      // The floating composer-dock card
      // -------------------------------------------------------------------
      function visibleRun(run, dismissed) {
        if (!run) return null;
        if (run.status !== "running" && dismissed.has(run.id)) return null;
        return run;
      }

      function runFromChatHint(hint) {
        if (!hint || typeof hint !== "object") return null;
        if (!hint.runId && !hint.id && !hint.name && !Array.isArray(hint.phases)) return null;
        const phases = Array.isArray(hint.phases) ? hint.phases : [];
        const status = hint.status || "completed";
        const nodes = [];
        const counts = { running: 0, completed: 0, failed: 0, cancelled: 0, interrupted: 0 };
        const lanes = phases.map((phase, idx) => {
          const list = Array.isArray(phase && phase.members) ? phase.members : [];
          const laneNodes = [];
          for (const m of list) {
            const seq = m.seq || nodes.length + 1;
            const mStatus = m.status || (status === "running" ? "running" : "completed");
            if (counts[mStatus] !== undefined) counts[mStatus] += 1;
            else if (mStatus === "error") counts.failed += 1;
            laneNodes.push(seq);
            nodes.push({
              seq,
              label: m.label || "",
              status: mStatus,
              phase: (phase && phase.phase) || "",
              childId: m.childId || m.childSessionId || null,
              model: m.model || null,
              provider: m.provider || null,
              startedAt: m.startedAt || 0,
              endedAt: m.endedAt || 0,
            });
          }
          let state = "pending";
          if (list.some((m) => m.status === "running")) state = "running";
          else if (list.some((m) => m.status === "failed" || m.status === "error")) state = "failed";
          else if (list.length > 0 && list.some((m) => m.status === "cancelled" || m.status === "interrupted") && !list.every((m) => m.status === "completed")) state = "cancelled";
          else if (list.length > 0 && list.every((m) => m.status === "pending" || m.status === "skipped")) state = "pending";
          else if (list.length > 0) state = "done";
          else if (status === "cancelled" || status === "interrupted") state = "cancelled";
          return {
            id: (phase && phase.key) || `p${idx}`,
            title: (phase && phase.phase) || "",
            state,
            detail: "",
            nodes: laneNodes,
          };
        });
        return {
          id: hint.runId || hint.id || `chat:${hint.name || "workflow"}:${phases.length}:${nodes.length}`,
          name: hint.name || "",
          status,
          phases: lanes.length,
          agents: nodes.length,
          counts,
          startedAt: hint.startedAt || 0,
          endedAt: hint.endedAt || 0,
          error: hint.error || null,
          graph: { lanes },
          nodes,
        };
      }

      function WorkflowDock(props) {
        const { rpcCall, sessionId, openSession } = props;
        const lang = useLang();
        const [run, setRun] = react.useState(null);
        const [collapsed, setCollapsed] = react.useState(false);
        const [stopping, setStopping] = react.useState(false);
        const [awayFromActive, setAwayFromActive] = react.useState(false);
        const [focusRequest, setFocusRequest] = react.useState(null);
        const [flash, setFlash] = react.useState(false);
        const scrollerRef = useBoxRef(null);
        const [live] = react.useState(() => ({
          dismissed: new Set(),
          runId: null,
          status: null,
          lastRun: null,
          collapseTimer: null,
          hideTimer: null,
          flashTimer: null,
          hovered: false,
          pendingFinishId: null,
          alreadyCollapsed: false,
          stopped: false,
        }));

        const clearAutoTimers = () => {
          if (live.collapseTimer !== null) { clearTimeout(live.collapseTimer); live.collapseTimer = null; }
          if (live.hideTimer !== null) { clearTimeout(live.hideTimer); live.hideTimer = null; }
        };
        const clearFlashTimer = () => {
          if (live.flashTimer !== null) { clearTimeout(live.flashTimer); live.flashTimer = null; }
        };
        const cancelFinish = () => {
          live.pendingFinishId = null;
          live.alreadyCollapsed = false;
          clearAutoTimers();
        };
        const dismiss = (id) => {
          cancelFinish();
          if (id) live.dismissed.add(id);
          setRun(null);
        };
        const scheduleFinish = (id) => {
          clearAutoTimers();
          if (live.stopped || !id || live.pendingFinishId !== id || live.hovered) return;
          const queueHide = () => {
            live.hideTimer = setTimeout(() => {
              live.hideTimer = null;
              if (live.stopped || live.pendingFinishId !== id || live.hovered) return;
              dismiss(id);
            }, HIDE_AFTER_MS);
          };
          if (live.alreadyCollapsed) {
            queueHide();
            return;
          }
          live.collapseTimer = setTimeout(() => {
            live.collapseTimer = null;
            if (live.stopped || live.pendingFinishId !== id || live.hovered) return;
            live.alreadyCollapsed = true;
            setCollapsed(true);
            queueHide();
          }, COLLAPSE_DELAY_MS);
        };

        react.useEffect(() => {
          if (!sessionId || typeof rpcCall !== "function") return undefined;
          live.stopped = false;
          let since = -1;
          const apply = (next) => {
            live.lastRun = next || null;
            if (next && next.id) live.runId = next.id;
            const shown = visibleRun(next, live.dismissed);
            if (shown === null) { setRun(null); return; }
            if (live.status === null || live.lastShownId !== shown.id) {
              live.lastShownId = shown.id;
              live.status = null;
              cancelFinish();
              setCollapsed(false);
              setStopping(false);
              setAwayFromActive(false);
            }
            if (shown.status !== "running") setStopping(false);
            if (live.status === "running" && shown.status === "completed") {
              live.pendingFinishId = shown.id;
              live.alreadyCollapsed = false;
              scheduleFinish(shown.id);
            } else if (shown.status === "running") {
              cancelFinish();
            }
            live.status = shown.status;
            setRun(shown);
          };
          const loop = async () => {
            while (!live.stopped) {
              try {
                const value = await rpcCall("dock", { sessionId, since, timeoutMs: 20000 });
                if (live.stopped) return;
                if (value && value.rev !== since) {
                  since = value.rev;
                  apply(value.run);
                }
              } catch {
                if (live.stopped) return;
                await new Promise((resolve) => setTimeout(resolve, 3000));
              }
            }
          };
          void loop();
          revealers.set(sessionId, (hint) => {
            cancelFinish();
            const hintId = (hint && typeof hint === "object" && (hint.runId || hint.id)) || "";
            const hintName = (hint && typeof hint === "object" && typeof hint.name === "string") ? hint.name : "";
            const targetsDifferentRun = Boolean(
              live.lastRun && (
                (hintId && hintId !== live.lastRun.id)
                || (!hintId && hintName && hintName !== live.lastRun.name)
              ),
            );
            if (targetsDifferentRun) {
              const fallback = runFromChatHint(hint);
              if (fallback) {
                live.dismissed.delete(fallback.id);
                setCollapsed(false);
                setStopping(false);
                setAwayFromActive(false);
                live.lastShownId = fallback.id;
                live.status = fallback.status;
                setRun(fallback);
                setFocusRequest((prev) => ({ idx: null, seq: (prev ? prev.seq : 0) + 1 }));
                (async () => {
                  let targetId = hintId;
                  if (!targetId && hintName) {
                    const listed = await rpcCall("runs", { sessionId });
                    const all = Array.isArray(listed && listed.runs) ? listed.runs : [];
                    const matched = all.find((r) => r && r.name === hintName);
                    if (matched && matched.id) targetId = matched.id;
                  }
                  if (!targetId) return;
                  const detail = await rpcCall("run", { sessionId, runId: targetId });
                  if (!live.stopped && detail && detail.id && live.lastShownId === fallback.id) {
                    live.dismissed.delete(detail.id);
                    live.lastShownId = detail.id;
                    live.status = detail.status;
                    setRun(detail);
                  }
                })().catch(() => {});
              }
            } else {
              const knownId = (live.lastRun && live.lastRun.id) || live.runId;
              if (knownId) live.dismissed.delete(knownId);
              setCollapsed(false);
              if (live.lastRun) {
                live.lastShownId = live.lastRun.id;
                live.status = live.lastRun.status;
                setRun(live.lastRun);
                setFocusRequest((prev) => ({ idx: null, seq: (prev ? prev.seq : 0) + 1 }));
              } else {
                const fallback = runFromChatHint(hint);
                if (fallback) {
                  live.lastShownId = fallback.id;
                  live.status = fallback.status;
                  setRun(fallback);
                }
                rpcCall("dock", { sessionId, since: -1, timeoutMs: 0 }).then((value) => {
                  if (!live.stopped && value && value.run) {
                    since = value.rev;
                    apply(value.run);
                  }
                }, () => {});
                since = -1;
              }
            }
            clearFlashTimer();
            setFlash(true);
            live.flashTimer = setTimeout(() => {
              live.flashTimer = null;
              if (!live.stopped) setFlash(false);
            }, 850);
          });
          return () => {
            live.stopped = true;
            cancelFinish();
            clearFlashTimer();
            revealers.delete(sessionId);
          };
        }, [sessionId]);

        const [, setTick] = react.useState(0);
        react.useEffect(() => {
          if (!run || run.status !== "running") return undefined;
          const timer = setInterval(() => setTick((n) => n + 1), 1000);
          return () => clearInterval(timer);
        }, [run && run.id, run && run.status]);

        if (!run) return null;
        const finished = run.status !== "running";
        const lanes = run.graph && Array.isArray(run.graph.lanes) ? run.graph.lanes : [];
        const isErr = run.status === "failed" || run.status === "error";

        const requestFocusPhase = (idx) => {
          cancelFinish();
          if (collapsed) setCollapsed(false);
          setFocusRequest((prev) => ({ idx, seq: (prev ? prev.seq : 0) + 1 }));
        };

        const onStop = () => {
          if (stopping || typeof rpcCall !== "function") return;
          cancelFinish();
          setStopping(true);
          rpcCall("stop", { sessionId, runId: run.id }).catch(() => {
            setStopping(false);
          });
        };

        const onMouseEnter = () => {
          live.hovered = true;
          clearAutoTimers();
        };
        const onMouseLeave = () => {
          live.hovered = false;
          if (live.pendingFinishId) scheduleFinish(live.pendingFinishId);
        };
        const onFocusCapture = () => {
          live.hovered = true;
          clearAutoTimers();
        };
        const onBlurCapture = (e) => {
          const current = e && e.currentTarget;
          const related = e && e.relatedTarget;
          if (current && related && typeof current.contains === "function" && current.contains(related)) return;
          live.hovered = false;
          if (live.pendingFinishId) scheduleFinish(live.pendingFinishId);
        };

        const stopTitle = t(lang, stopping ? "stoppingWorkflow" : "stopWorkflow");

        return h("section", {
          className: "dwf-dock",
          "data-dsh-dynamic-workflow": run.id,
          "data-collapsed": String(collapsed),
          "data-flash": flash ? "true" : undefined,
          "aria-label": t(lang, "aria"),
          onMouseEnter,
          onMouseLeave,
          onFocusCapture,
          onBlurCapture,
        },
          h("div", { className: "dwf-body" },
            h("div", { className: "dwf-head" },
              h("button", {
                className: "dwf-toggle",
                type: "button",
                "aria-expanded": String(!collapsed),
                onClick: () => { cancelFinish(); setCollapsed((value) => !value); },
              },
                h(WorkflowIcon, null),
                h("span", {
                  className: "dwf-kind",
                  "data-live": String(run.status === "running"),
                  "data-err": String(isErr),
                }, t(lang, `kind_${run.status}`)),
                h("span", { className: "dwf-name" }, run.name || t(lang, "defaultName"))),
              h("div", { className: "dwf-head-right" },
                collapsed ? h(MiniStationRail, {
                  lanes,
                  lang,
                  onSelectPhase: (idx) => requestFocusPhase(idx),
                }) : null,
                h("span", { className: "dwf-progress" }, progressText(run, lang)),
                h("span", { className: "dwf-actions" },
                  !collapsed && awayFromActive ? h("button", {
                    className: "dwf-icon-btn",
                    type: "button",
                    "data-action": "locate",
                    title: t(lang, "locateActive"),
                    "aria-label": t(lang, "locateActive"),
                    onClick: () => requestFocusPhase(null),
                  }, h(LocateIcon, null)) : null,
                  !finished ? h("button", {
                    className: "dwf-icon-btn",
                    type: "button",
                    "data-action": "stop",
                    disabled: stopping,
                    title: stopTitle,
                    "aria-label": stopTitle,
                    onClick: onStop,
                  }, h(StopSquareIcon, { stopping })) : null,
                  h("button", {
                    className: "dwf-icon-btn",
                    type: "button",
                    "data-action": "collapse",
                    title: t(lang, collapsed ? "expandDetails" : "collapseDetails"),
                    "aria-label": t(lang, collapsed ? "expandDetails" : "collapseDetails"),
                    "aria-expanded": String(!collapsed),
                    onClick: () => { cancelFinish(); setCollapsed((value) => !value); },
                  }, h(ExpandCollapseIcon, { collapsed })),
                  finished ? h("button", {
                    className: "dwf-icon-btn",
                    type: "button",
                    "data-action": "dismiss",
                    title: t(lang, "dismiss"),
                    "aria-label": t(lang, "dismiss"),
                    onClick: () => dismiss(run.id),
                  }, h(CloseIcon, null)) : null))),
            collapsed ? null : [
              h(Graph, {
                key: `graph-${run.id}`,
                run,
                lang,
                scrollerRef,
                focusRequest,
                onAwayChange: setAwayFromActive,
                openNode: typeof openSession === "function" ? (node) => openSession(sessionId, node.childId) : undefined,
              }),
              run.error ? h("div", { key: "err", className: "dwf-flash", "data-err": "true", title: run.error }, summarizeError(run.error)) : null,
            ]));
      }

      /** Done/total, current phase and status from the host's chat-node data. */
      function chatSummary(data) {
        const phases = Array.isArray(data && data.phases) ? data.phases : [];
        const overall = (data && data.status) || "running";
        let total = 0;
        let done = 0;
        let current = null;
        for (const phase of phases) {
          for (const member of phase.members || []) {
            total += 1;
            const st = member.status || (overall === "completed" ? "completed" : "running");
            if (st === "running") current = phase.phase || current;
            else if (st !== "pending" && st !== "skipped") done += 1;
          }
        }
        return { total, done, current, status: overall };
      }

      function chatLanesAndMembers(data) {
        const phases = Array.isArray(data && data.phases) ? data.phases : [];
        const overallStatus = (data && data.status) || "running";
        const lanes = [];
        const members = [];
        const roleSlots = new Map();
        phases.forEach((phase, idx) => {
          const list = Array.isArray(phase.members) ? phase.members : [];
          let state = "pending";
          if (list.some((m) => m.status === "running")) state = "running";
          else if (list.some((m) => m.status === "failed" || m.status === "error")) state = "failed";
          else if (list.length > 0 && list.some((m) => m.status === "cancelled" || m.status === "interrupted") && !list.every((m) => m.status === "completed")) state = "cancelled";
          else if (list.length > 0 && list.every((m) => m.status === "pending" || m.status === "skipped")) state = "pending";
          else if (list.length > 0) state = "done";
          else if (overallStatus === "cancelled" || overallStatus === "interrupted") state = "cancelled";
          lanes.push({ id: phase.key || `p${idx}`, title: phase.phase || "", state });
          const seenInPhase = new Map();
          for (const m of list) {
            const label = m.label || `#${m.seq || members.length + 1}`;
            const occ = (seenInPhase.get(label) || 0) + 1;
            seenInPhase.set(label, occ);
            const roleKey = `${label}@${occ}`;
            if (!roleSlots.has(roleKey)) roleSlots.set(roleKey, roleSlots.size);
            members.push({
              seq: m.seq || members.length + 1,
              label: m.label || "",
              status: m.status || "running",
              avatarSlot: roleSlots.get(roleKey),
            });
          }
        });
        return { lanes, members };
      }

      /** One-line replacement for the host's message-flow workflow card. */
      function WorkflowChatRow(props) {
        const lang = useLang();
        const data = props.node && props.node.data ? props.node.data : {};
        const sum = chatSummary(data);
        const { lanes, members } = chatLanesAndMembers(data);
        const meta = [t(lang, "agents", { done: sum.done, n: sum.total })];
        if (sum.status === "running" && sum.current) meta.push(sum.current);
        return h("button", {
          className: "dwf-row",
          type: "button",
          "data-dsh-dynamic-workflow-row": data.name || "",
          title: t(lang, "showDock"),
          onClick: () => reveal(props.sessionId, data),
        },
          h(WorkflowIcon, null),
          h(MiniStationRail, { lanes }),
          h("span", { className: "dwf-row-name" }, data.name || t(lang, "defaultName")),
          h(AvatarDeck, { agents: members, max: 4 }),
          h("span", { className: "dwf-row-meta" }, meta.join(" · ")),
          h("span", { className: "dwf-row-go", "aria-hidden": "true" }, h(ChevronRightMini, null)));
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
        const openChild = (parentSessionId, childSessionId) => {
          const workspace = service("uiWorkspace");
          if (!workspace || typeof workspace.openSession !== "function" || !childSessionId) return;
          const fallbackOpen = (firstError) => {
            if (parentSessionId) {
              try {
                const retry = workspace.openSession({ parentSessionId, childSessionId, mode: "unknown" });
                if (retry && typeof retry.catch === "function") {
                  retry.catch(() => console.warn("[dsh-dynamic-workflow] cannot open agent session:", firstError));
                }
                return;
              } catch { /* fall through */ }
            }
            console.warn("[dsh-dynamic-workflow] cannot open agent session:", firstError);
          };
          try {
            const res = workspace.openSession(childSessionId);
            if (res && typeof res.catch === "function") res.catch(fallbackOpen);
          } catch (firstError) {
            fallbackOpen(firstError);
          }
        };
        ctx.slots.inject(DOCK_SLOT, () => ctx.slots.register({
          name: DOCK_SLOT,
          id: DOCK_ID,
          order: DOCK_ORDER,
          inject: (sessionId) => ({ rpcCall, sessionId, openSession: openChild }),
        }, WorkflowDock));
        ctx.slots.inject(CHAT_SLOT, () => ctx.slots.register({
          name: CHAT_SLOT,
          key: CHAT_KEY,
          priority: CHAT_PRIORITY,
        }, WorkflowChatRow));
      }

      exports.apply = apply;
      exports.inject = ["slots", "connection", "locale", "uiWorkspace"];
      exports.internals = {
        CHANNEL, DOCK_SLOT, DOCK_ID, DOCK_ORDER, STRINGS, t, uiLang,
        CHAT_SLOT, CHAT_KEY, CHAT_PRIORITY, STATION_PITCH, PILL_WIDTH, WHEEL_LINE_PX,
        HIDE_AFTER_MS, COLLAPSE_DELAY_MS,
        BOT_COLORS, botColor, faceStateOf, driveAvatarMotion,
        AgentAvatar, AvatarDeck, AgentPill, StationLedge, MiniStationRail,
        railInkBetween, translateTimelineWheel, resolveLaneItems, formatAgentLabel,
        formatDuration, summarizeError, progressText, primaryModel, doneCount, visibleRun,
        runFromChatHint, chatSummary, chatLanesAndMembers, reveal, revealers,
        Graph, WorkflowDock, WorkflowChatRow,
      };
      return module.exports;
    },
  });
})();
