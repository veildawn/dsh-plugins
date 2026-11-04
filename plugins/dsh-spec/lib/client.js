(function () {
  window.__ModuleLoader__.load({
    id: "@weniatall/dsh-spec",
    factory: (require) => {
      var module = { exports: {} };
      var exports = module.exports;
      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
      const react = require("react");

      const CHANNEL = "/dsh-spec";
      // The Specs pane is one of the conversation's own view tabs, in the strip
      // beside 对话 and 轨迹 — not a right-sidebar tab and not an overlay. The
      // host's chat view uses order 0 and the trajectory view uses 10, so 20 puts
      // 规格 to the right of 轨迹.
      const VIEW_SLOT = "conversation.view";
      const SPEC_VIEW_ID = "spec";
      const SPEC_VIEW_LABEL = "规格";
      const SPEC_VIEW_ORDER = 20;
      const COMPOSER_SLOT = "conversation.input.left";
      // The dock above the composer where the host puts its own todo panel; the
      // Spec preset substitutes its wave-aware plan here.
      const PLAN_DOCK_SLOT = "conversation.input.dock";
      const NAV_STYLE_ID = "dsh-spec-nav-styles";

      const SPEC_TYPES = [
        { value: "feature", label: "Feature" },
        { value: "bugfix", label: "Bugfix" },
        { value: "quick-spec", label: "Quick spec" },
      ];
      const WORKFLOWS = [
        { value: "requirements-first", label: "Requirements → Design → Tasks" },
        { value: "design-first", label: "Design → Requirements → Tasks" },
        { value: "fast-task", label: "Fast task" },
        { value: "verify-first", label: "Verify first" },
      ];
      // Glyphs and checkbox characters are language-free; the words beside them
      // come from STRINGS (`status` / `phase` / `severity`), so a label is never
      // defined twice. These tables stay exported for tests and callers that
      // need the checkbox grammar.
      const TASK_STATUS = {
        not_started: { box: " ", icon: "☐" },
        queued: { box: "~", icon: "◷" },
        in_progress: { box: "-", icon: "◐" },
        completed: { box: "x", icon: "☑" },
      };

      // ---------------------------------------------------------------------
      // UI language
      // ---------------------------------------------------------------------
      // The panel follows the host's locale plugin (`ctx.locale`), which is the
      // same switch Settings → General writes and every other surface reads —
      // so a language change here needs no reload and no second setting. Before
      // `apply` binds the face, or on a host without the plugin, the browser tag
      // decides; `en` is the last resort.
      //
      // This is the UI only. The language the *documents* are written in is
      // resolved on the server (see lib/language.js) for the Agent's prompt, and
      // the panel's own copy of each finding arrives already localized.
      let localeFace = null;

      function systemLanguage() {
        try {
          const nav = typeof navigator !== "undefined" ? navigator : null;
          const tag = nav && typeof nav.language === "string" ? nav.language.toLowerCase() : "";
          return tag.startsWith("zh") ? "zh" : "en";
        } catch {
          return "en";
        }
      }

      /** The active UI language: the host's explicit choice, else the browser tag. */
      function uiLang() {
        if (localeFace !== null) {
          try {
            const active = localeFace.getSnapshot().active;
            if (active === "zh" || active === "en") return active;
          } catch {
            // a torn or disposed face reads like absence; fall through
          }
        }
        return systemLanguage();
      }

      /** React hook: re-renders the caller whenever the host locale switches. */
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

      /**
       * UI copy, `zh` first (this plugin's home language) and `en` second.
       *
       * Document names, heading text and EARS keywords are never translated:
       * they are the file format, not prose. Placeholders are process words
       * such as `{feature}`.
       */
      const STRINGS = {
        viewLabel: ["规格", "Specs"],
        specUnavailable: ["Spec 不可用", "Spec unavailable"],
        pickType: ["已选择 {type}，在「规格」页签新建。", "Selected {type}; create it in the Specs tab."],
        bound: ["已关联 {feature}，可在「规格」页签查看。", "Linked {feature}; open it in the Specs tab."],
        openTab: ["打开「规格」页签", "Open the Specs tab"],
        noSessionView: ["宿主未提供会话视图", "the host has no session view"],
        currentSpec: ["当前规格 {feature}，{phase}，打开规格页签", "Current spec {feature}, {phase}; open the Specs tab"],
        pickHint: ["选择新建类型或关联已有规格，或打开「规格」页签", "Pick a new type, link an existing spec, or open the Specs tab"],
        noSessionViewPanel: ["宿主未提供会话视图，Spec 面板不可用", "The host has no session view; the Spec panel is unavailable"],
        pickTypeHint: ["选择类型后，在「规格」页签新建", "Pick a type, then create it in the Specs tab"],
        linkExisting: ["关联本工作区已有规格", "Link an existing spec in this workspace"],
        planName: ["Spec 任务", "Spec tasks"],
        planAria: ["Spec 任务", "Spec tasks"],
        planDone: ["{count} 完成", "{count} done"],
        planRunning: ["{count} 进行中", "{count} running"],
        planPending: ["{count} 待开始", "{count} to do"],
        planTotal: ["{count} 个任务", "{count} tasks"],
        wave: ["Wave {id}", "Wave {id}"],
        waveNth: ["第 {n} 波", "Wave {n}"],
        notGraphed: ["未入依赖图", "Not in the graph"],
        graphNeeded: ["tasks.md 需要补图", "tasks.md needs a graph"],
        optional: ["可选", "optional"],
        derivedTag: ["随子任务", "follows subtasks"],
        derivedHint: ["由子任务状态决定：必需子任务全部完成后父任务即为完成", "Derived from its subtasks: the parent completes once every required subtask is done"],
        taskCheckAria: ["任务 {id} {title}", "Task {id} {title}"],
        taskStatusAria: ["设置任务 {id} 状态", "Set the status of task {id}"],
        phase: {
          requirements: ["需求阶段", "Requirements"],
          design: ["设计阶段", "Design"],
          tasks: ["任务阶段", "Tasks"],
          execution: ["任务执行", "Execution"],
          done: ["已完成", "Done"],
        },
        status: {
          not_started: ["未开始", "Not started"],
          queued: ["排队中", "Queued"],
          in_progress: ["进行中", "In progress"],
          completed: ["已完成", "Done"],
        },
        severity: { error: ["错误", "Error"], warning: ["警告", "Warning"], info: ["提示", "Info"] },
        noTasks: ["无任务", "No tasks"],
        requiredProgress: ["{done}/{total} 必需任务 · {percent}%", "{done}/{total} required · {percent}%"],
        parentAutoDone: ["父任务自动完成：{ids}", "Parent completed automatically: {ids}"],
        taskMoved: ["任务 {id} → {status}", "Task {id} → {status}"],
        updateFailed: ["更新失败：{error}", "Update failed: {error}"],
        titleRequired: ["请填写标题", "A title is required"],
        created: ["已创建 {feature}，并关联到当前会话", "Created {feature} and linked it to this session"],
        createFailed: ["创建失败：{error}", "Create failed: {error}"],
        checkDone: ["校验完成：{errors} 错误 / {warnings} 警告", "Check finished: {errors} errors / {warnings} warnings"],
        checkClean: ["校验完成", "Check finished"],
        checkFailed: ["校验失败：{error}", "Check failed: {error}"],
        linked: ["已关联 {feature}", "Linked {feature}"],
        linkedPlain: ["已关联", "Linked"],
        linkFailed: ["关联失败：{error}", "Link failed: {error}"],
        unlinked: ["已解除关联", "Unlinked"],
        unlinkFailed: ["解除失败：{error}", "Unlink failed: {error}"],
        saved: ["已保存", "Saved"],
        saveFailed: ["保存失败：{error}", "Save failed: {error}"],
        restored: ["已恢复默认", "Defaults restored"],
        restoreFailed: ["恢复失败：{error}", "Restore failed: {error}"],
        noSpecs: ["还没有 Spec", "No specs yet"],
        noSpecsBody: ["创建工作区里的第一份 Kiro 规格，或在 Spec 模式里让 Agent 用 spec_create 创建。", "Create this workspace's first Kiro spec, or have the Agent call spec_create in Spec mode."],
        convention: ["目录约定：", "Location: "],
        files: ["文件：", "Files: "],
        newSpec: ["新建 Spec", "New spec"],
        currentSession: ["当前会话", "This session"],
        errorCount: ["{count} 错误", "{count} errors"],
        issues: ["问题", "Findings"],
        issueCount: ["{count} 项", "{count}"],
        taskProgress: ["任务进度", "Task progress"],
        formatOk: ["格式通过", "Format OK"],
        hasErrors: ["存在错误", "Has errors"],
        requirementCount: ["{count} 需求 / {criteria} 条验收", "{count} requirements / {criteria} criteria"],
        propertyCount: ["{count} 条属性", "{count} properties"],
        missingDoc: ["{name}（缺失）", "{name} (missing)"],
        readyNow: ["接下来可执行", "Ready next"],
        linear: ["线性顺序", "linear"],
        allDone: ["全部必需任务已完成。", "Every required task is done."],
        nothingReady: ["当前阶段还没有可执行任务；若文档缺失，请让 Agent 继续编写对应阶段文档。", "No task is runnable at this stage; if a document is missing, ask the Agent to write it."],
        notSpecSession: ["当前会话没有运行 Spec 模式，模型侧没有 spec_* 工具。面板仍可读写规格；要让 Agent 参与，请新建一个 Spec 模式任务。", "This session is not in Spec mode, so the Agent has no spec_* tools. The panel can still read and write specs; to involve the Agent, start a task in Spec mode."],
        graphTitle: ["执行顺序", "Run order"],
        graphAria: ["任务依赖图", "Task dependency graph"],
        graphWaves: ["{count} 个波次", "{count} waves"],
        graphHint: ["同一行内并行执行", "Tasks on one row run in parallel"],
        graphNeededFull: ["tasks.md 的 Task Dependency Graph 需要补上", "tasks.md is missing its Task Dependency Graph"],
        parallel: ["并行", "parallel"],
        noTasksBody: ["让 Agent 编写 tasks.md；任务复选框会直接写回 Markdown。", "Ask the Agent to write tasks.md; task checkboxes write straight back to the Markdown."],
        taskList: ["任务清单", "Task list"],
        readingDoc: ["正在读取文档…", "Reading the document…"],
        retry: ["重试", "Retry"],
        pickSpec: ["从上方选择一个规格，或新建一个。", "Pick a spec above, or create one."],
        loading: ["正在加载…", "Loading…"],
        currentPhase: ["当前阶段", "Current phase"],
        done: ["已完成", "Done"],
        pending: ["待开始", "To do"],
        unlink: ["解除关联", "Unlink"],
        linkThis: ["关联本会话", "Link this session"],
        createHint: ["按 Kiro 的目录与文档模板创建；创建后自动关联到当前会话。", "Created from Kiro's directory and document templates, then linked to this session."],
        title: ["标题", "Title"],
        titlePlaceholder: ["例如：Login revamp", "e.g. Login revamp"],
        specType: ["Spec 类型", "Spec type"],
        workflow: ["工作流", "Workflow"],
        create: ["创建", "Create"],
        creating: ["创建中…", "Creating…"],
        cancel: ["取消", "Cancel"],
        settingsTitle: ["Spec 设置", "Spec settings"],
        settingsHint: ["只影响本机保存的插件配置；提示词策略保存后下一步生效。", "Saved on this machine only; the prompt policy applies from the next step."],
        kiroDir: ["Spec 根目录（相对工作区）", "Spec root (relative to the workspace)"],
        defaultSpecType: ["默认 Spec 类型", "Default spec type"],
        defaultWorkflow: ["默认工作流", "Default workflow"],
        languageLabel: ["语言", "Language"],
        languageFollow: ["跟随 DSH", "Follow DSH"],
        languageHint: ["文档、提示词与校验提示的语言。留空即跟随 DSH；界面文案始终跟随 DSH。", "Language of the documents, the prompt and the findings. Empty follows DSH; the panel itself always follows DSH."],
        injectPrompt: ["向系统提示词注入 Kiro Spec 契约", "Inject the Kiro spec contract into the system prompt"],
        listSpecs: ["在上下文中列出工作区 Spec", "List this workspace's specs in context"],
        strictMode: ["严格校验（警告也算失败）", "Strict (warnings count as failures)"],
        maxListed: ["最多列出", "List at most"],
        save: ["保存", "Save"],
        resetDefaults: ["恢复默认", "Restore defaults"],
        back: ["返回", "Back"],
        noBinding: ["未关联规格", "No spec linked"],
        boundTo: ["已关联 {feature}", "Linked to {feature}"],
        unlinkSession: ["解除关联本会话", "Unlink this session"],
        settingsMenu: ["Spec 设置…", "Spec settings…"],
        newSpecMenu: ["新建 Spec…", "New spec…"],
        reread: ["重新读取磁盘", "Re-read from disk"],
        kiroCompat: ["Kiro 兼容 · .kiro/specs", "Kiro compatible · .kiro/specs"],
        refresh: ["刷新", "Refresh"],
        check: ["校验", "Check"],
        createShort: ["新建", "New"],
        more: ["更多", "More"],
        connectionNotReady: ["连接服务尚未就绪", "The connection service is not ready"],
        requestFailed: ["请求失败", "Request failed"],
        readingSpecs: ["正在读取规格…", "Reading specs…"],
        specs: ["Specs", "Specs"],
        autoGenerated: ["(auto-generated)", "(auto-generated)"],
        fastTask: ["Fast task（静默流水线）", "Fast task (silent pipeline)"],
      };

      /** Interpolate `{name}` holes. */
      function fill(template, params) {
        if (params === undefined || params === null) return template;
        return template.replace(/\{(\w+)\}/gu, (match, key) => (params[key] === undefined ? match : String(params[key])));
      }

      /**
       * One entry of {@link STRINGS}, in `lang`.
       * `entryOf` accepts either a `[zh, en]` pair or a nested map of them.
       */
      function tr(lang, entry, params) {
        if (entry === undefined || entry === null) return "";
        if (Array.isArray(entry)) return fill(entry[lang === "zh" ? 0 : 1], params);
        return "";
      }

      /** Translate one flat key. */
      function t(lang, key, params) {
        return tr(lang, STRINGS[key], params);
      }

      /** Translate one key of a grouped map (`status`, `phase`, `severity`). */
      function tg(lang, group, key) {
        const pair = STRINGS[group]?.[key];
        return Array.isArray(pair) ? pair[lang === "zh" ? 0 : 1] : String(key ?? "");
      }

      /** Phase label for a host phase value, falling back to the raw value. */
      function phaseOf2(phase, lang = uiLang()) {
        return STRINGS.phase[phase] === undefined ? String(phase ?? "") : tg(lang, "phase", phase);
      }

      /** Spec-type label. Only "Fast task" is prose; the others are Kiro's names. */
      function specTypeLabel(value, lang = uiLang()) {
        const type = SPEC_TYPES.find((item) => item.value === value);
        if (type === undefined) return String(value ?? "");
        return value === "fast-task" ? t(lang, "fastTask") : type.label;
      }

      /** Workflow label, same rule: only the prose one moves. */
      function workflowLabel(value, lang = uiLang()) {
        const workflow = WORKFLOWS.find((item) => item.value === value);
        if (workflow === undefined) return String(value ?? "");
        return value === "fast-task" ? t(lang, "fastTask") : workflow.label;
      }

      const css = `
        .ks-pane{box-sizing:border-box;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family)}
        /* A conversation view: the host gives the strip the session's height, so
           the pane reserves the composer band and reads the tree beside the
           detail while the pane is wide enough to hold both. */
        .ks-view{height:var(--dsh-conversation-viewport-height,100%);min-width:0;padding-bottom:calc(var(--dsh-composer-height,152px) + 16px);container-type:inline-size}
        .ks-view .ks-pane-split{flex-direction:row;overflow:hidden}
        .ks-view .ks-tree-wrap{width:240px;max-width:32%;max-height:none;min-width:0;border-bottom:none;border-right:1px solid var(--dsw-alias-border-l1)}
        .ks-view .ks-detail{min-width:0}
        .ks-view .ks-pane-body>.ks-adv{flex:1;min-height:0}
        .ks-pane-head{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;flex-wrap:wrap}
        .ks-pane-head .ks-head-title{flex:1 1 auto;min-width:0}
        .ks-head-title{display:flex;flex-direction:column;gap:2px;min-width:0}
        .ks-head-title strong{font-size:14px;line-height:20px;font-weight:600}
        .ks-head-sub{font-size:10.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--ds-font-family-code,var(--dsw-font-code,monospace))}
        .ks-pane-body{flex:1 1 auto;min-height:0;overflow:hidden;display:flex;flex-direction:column}
        .ks-pane-split{display:flex;flex-direction:column;min-height:0;flex:1 1 auto}
        .ks-tree-wrap{flex:none;max-height:40%;overflow:auto;border-bottom:1px solid var(--dsw-alias-border-l1)}
        .ks-detail{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
        .ks-tree{display:flex;flex-direction:column;padding:4px}
        .ks-tree-group{display:flex;flex-direction:column}
        .ks-tree-row{display:flex;align-items:flex-start;gap:6px;width:100%;padding:7px 8px;border:none;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
        .ks-tree-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
        .ks-tree-row[data-active="true"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 8%,transparent)}
        .ks-tree-main{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 auto}
        .ks-tree-title{font-size:12.5px;font-weight:560;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .ks-tree-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
        .ks-caret{display:inline-block;flex:none;font-size:9px;line-height:1;color:var(--dsw-alias-label-tertiary);transition:transform .12s;margin-top:4px}
        .ks-caret[data-open="true"]{transform:rotate(90deg)}
        .ks-tree-children{display:flex;flex-direction:column;margin-left:14px;border-left:1px solid var(--dsw-alias-border-l1);padding-left:4px}
        .ks-tree-leaf{display:flex;align-items:center;gap:7px;width:100%;padding:5px 8px;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;text-align:left;cursor:pointer}
        .ks-tree-leaf:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
        .ks-tree-leaf[data-active="true"]{color:var(--dsw-alias-label-primary);font-weight:560;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 8%,transparent)}
        .ks-tree-leaf-label{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .ks-leaf-note{flex:none;font-size:9.5px;color:var(--dsw-alias-label-tertiary);font-style:italic}
        .ks-dot{width:7px;height:7px;border-radius:999px;flex:none;background:var(--dsw-alias-label-tertiary)}
        .ks-dot[data-state="done"]{background:var(--dsw-alias-state-success-primary,#22c55e)}
        .ks-dot[data-state="current"]{background:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 22%,transparent)}
        .ks-tree-leaf[data-state="pending"]{opacity:.62}
        .ks-doc-head{display:flex;align-items:center;gap:8px;padding:8px 10px 0;flex:none;flex-wrap:wrap}
        .ks-doc-title{font-size:13px;font-weight:600}
        .ks-doc-actions{display:flex;align-items:center;gap:6px;margin-left:auto;flex-wrap:wrap}
        .ks-doc-body{flex:1 1 auto;min-height:0;overflow:auto;padding:8px 10px 12px;display:flex;flex-direction:column;gap:10px}
        /* Document body is a scroll container: its children keep their own
           height instead of being squashed to fit the box. */
        .ks-doc-body>*{flex:none}
        /* Rendered Markdown. Sizes are deliberately a step below the chat's body
           text — this is a reference document read beside the conversation, and
           the pane is narrow. */
        .ks-md{display:flex;flex-direction:column;gap:8px;font-size:12.5px;line-height:1.72;color:var(--dsw-alias-label-primary);word-break:break-word}
        .ks-md > *{margin:0}
        .ks-md .ks-md-heading{margin-top:6px;font-weight:600;line-height:1.35;color:var(--dsw-alias-label-primary)}
        .ks-md .ks-md-heading[data-level="1"]{font-size:16px;letter-spacing:-.01em;padding-bottom:6px;border-bottom:1px solid var(--dsw-alias-border-l1);margin-top:0}
        .ks-md .ks-md-heading[data-level="2"]{font-size:14px}
        .ks-md .ks-md-heading[data-level="3"]{font-size:13px}
        .ks-md .ks-md-heading[data-level="4"],.ks-md .ks-md-heading[data-level="5"],.ks-md .ks-md-heading[data-level="6"]{font-size:12.5px;color:var(--dsw-alias-label-secondary)}
        .ks-md .ks-md-p{color:var(--dsw-alias-label-secondary)}
        .ks-md .ks-md-list{display:flex;flex-direction:column;gap:4px;padding-left:20px;margin:0;color:var(--dsw-alias-label-secondary)}
        .ks-md .ks-md-list .ks-md-list{gap:3px;margin-top:4px}
        .ks-md .ks-md-li{padding-left:1px}
        .ks-md .ks-md-li::marker{color:var(--dsw-alias-label-tertiary)}
        .ks-md .ks-md-strong{font-weight:600;color:var(--dsw-alias-label-primary)}
        .ks-md .ks-md-em{font-style:italic}
        .ks-md code{font-family:var(--ds-font-family-code,var(--dsw-font-code,monospace));font-size:11.5px}
        .ks-md .ks-md-code{padding:1px 4px;border-radius:5px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 10%,transparent);color:var(--dsw-alias-label-primary);word-break:break-word}
        .ks-md .ks-md-pre{margin:2px 0;padding:10px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-label-secondary) 5%,transparent);overflow:auto;max-height:420px;line-height:1.6;tab-size:2}
        .ks-md .ks-md-pre code{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:pre}
        .ks-md .ks-md-quote{padding:6px 12px;border-left:3px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}
        .ks-md .ks-md-rule{height:1px;border:none;background:var(--dsw-alias-border-l1);margin:4px 0}
        .ks-md .ks-md-link{color:var(--dsw-alias-brand-primary,#4d6bfe);text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 35%,transparent)}
        .ks-md .ks-md-link:hover{text-decoration:underline}
        .ks-md .ks-md-table-wrap{overflow-x:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:10px}
        .ks-md .ks-md-table{width:100%;border-collapse:collapse;font-size:11.5px;line-height:1.6}
        .ks-md .ks-md-table th{position:sticky;top:0;padding:6px 9px;text-align:left;font-weight:600;white-space:nowrap;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 7%,var(--dsw-alias-bg-layer-1,#fff));color:var(--dsw-alias-label-primary);border-bottom:1px solid var(--dsw-alias-border-l1)}
        .ks-md .ks-md-table td{padding:6px 9px;vertical-align:top;color:var(--dsw-alias-label-secondary);border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 60%,transparent)}
        .ks-md .ks-md-table tr:last-child td{border-bottom:none}
        .ks-md .ks-md-table tbody tr:hover td{background:var(--dsw-alias-interactive-bg-hover)}
        .ks-badge{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:999px;font-size:10px;font-weight:600;white-space:nowrap;flex:none}
        .ks-badge[data-tone="ok"]{color:var(--dsw-alias-state-success-primary,#22c55e);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 12%,transparent)}
        .ks-badge[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-warning-primary,#d98e00));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-warning-primary,#d98e00)) 13%,transparent)}
        .ks-badge[data-tone="err"]{color:var(--dsw-alias-state-error-primary,#d84848);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 12%,transparent)}
        .ks-badge[data-tone="muted"]{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-secondary) 10%,transparent)}
        .ks-badge[data-tone="brand"]{color:var(--dsw-alias-brand-primary,#4d6bfe);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 12%,transparent)}
        .ks-progress{display:flex;flex-direction:column;gap:6px}
        .ks-progress-head{display:flex;justify-content:space-between;font-size:11px;color:var(--dsw-alias-label-tertiary)}
        .ks-bar{height:7px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 14%,transparent);overflow:hidden}
        .ks-bar-fill{height:100%;border-radius:999px;background:var(--dsw-alias-state-success-primary,#22c55e);transition:width .2s}
        .ks-section{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1,transparent);overflow:hidden}
        .ks-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px;font-weight:600}
        .ks-section-body{padding:10px 12px;display:flex;flex-direction:column;gap:8px}
        .ks-task{display:flex;align-items:flex-start;gap:8px;padding:5px 0}
        .ks-task[data-depth="2"]{padding-left:20px}
        .ks-task[data-depth="3"]{padding-left:40px}
        .ks-check{width:16px;height:16px;margin-top:1px;flex:none;cursor:pointer;accent-color:var(--dsw-alias-brand-primary,#4d6bfe)}
        .ks-task-main{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1 1 auto}
        .ks-task-title{display:flex;gap:6px;align-items:baseline;font-size:12.5px;line-height:19px;font-weight:560;word-break:break-word;color:var(--dsw-alias-label-primary)}
        .ks-task-title[data-done="true"]{color:var(--dsw-alias-label-tertiary)}
        .ks-task-title[data-done="true"] .ks-task-id{text-decoration:none}
        .ks-task-title[data-done="true"] > span:last-child{text-decoration:line-through}
        .ks-task-id{flex:none;font-family:var(--ds-font-family-code,var(--dsw-font-code,monospace));font-size:10.5px;font-weight:400;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);padding-top:1px}
        /* The explanatory rest of a title: secondary, clamped, never competing
           with the heading for attention. The full text stays in the tooltip. */
        .ks-task-detail{margin:1px 0 0;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary);word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
        .ks-task-detail[data-done="true"]{opacity:.62}
        .ks-task-sub{display:flex;flex-wrap:wrap;gap:6px;font-size:10px;color:var(--dsw-alias-label-tertiary)}
        .ks-select{height:24px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;padding:0 4px;flex:none}
        .ks-note{padding:9px 11px;border-radius:9px;font-size:12px;line-height:18px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 7%,transparent);color:var(--dsw-alias-label-secondary)}
        .ks-error{padding:9px 11px;border-radius:9px;font-size:12px;line-height:18px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 11%,transparent);color:var(--dsw-alias-state-error-primary,#d84848)}
        .ks-issue{display:flex;gap:8px;padding:7px 0;border-bottom:1px dashed var(--dsw-alias-border-l1);font-size:12px;line-height:18px}
        .ks-issue:last-child{border-bottom:none}
        .ks-issue-rule{font-family:var(--ds-font-family-code,var(--dsw-font-code,monospace));font-size:10px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none}
        .ks-empty{display:flex;flex-direction:column;align-items:flex-start;gap:10px;padding:28px 10px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
        .ks-empty strong{color:var(--dsw-alias-label-primary);font-weight:600;font-size:15px}
        .ks-callout{padding:10px 12px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-secondary) 4%,transparent)}
        .ks-callout code{font-family:var(--ds-font-family-code,var(--dsw-font-code,monospace));font-size:11px}
        .ks-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;cursor:pointer;white-space:nowrap}
        .ks-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
        .ks-button:disabled{opacity:.45;cursor:default}
        .ks-button[data-tone="primary"]{border-color:transparent;background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff}
        .ks-icon-btn{display:inline-grid;place-items:center;width:26px;height:26px;padding:0;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:15px;cursor:pointer;flex:none}
        .ks-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-primary)}
        .ks-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
        .ks-field{display:flex;flex-direction:column;gap:5px;min-width:0}
        .ks-label{font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary)}
        .ks-input,.ks-textarea{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:7px 9px;outline:none}
        .ks-input:focus,.ks-textarea:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
        .ks-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
        .ks-check-row{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
        .ks-status{font-size:11px;color:var(--dsw-alias-label-tertiary);min-height:16px}
        .ks-spinner{display:inline-block;width:12px;height:12px;border:2px solid color-mix(in srgb,var(--dsw-alias-label-tertiary) 40%,transparent);border-top-color:var(--dsw-alias-brand-primary,#4d6bfe);border-radius:50%;animation:ks-spin .8s linear infinite;vertical-align:-2px;margin-right:6px}
        @keyframes ks-spin{to{transform:rotate(360deg)}}
        .ks-menu-wrap{position:relative;display:inline-flex;flex:none}
        .ks-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:45;display:flex;flex-direction:column;gap:2px;min-width:208px;padding:5px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:var(--dsw-shadow-lv2)}
        .ks-menu-item{display:flex;align-items:center;gap:8px;width:100%;padding:7px 9px;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer;white-space:nowrap}
        .ks-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
        .ks-menu-item[data-tone="danger"]{color:var(--dsw-alias-state-error-primary,#d84848)}
        .ks-menu-sep{height:1px;margin:4px 2px;background:var(--dsw-alias-border-l1)}
        .ks-menu-label{padding:4px 9px;font-size:10px;color:var(--dsw-alias-label-tertiary)}
        .ks-adv{display:flex;flex-direction:column;gap:10px;padding:12px;overflow:auto}
        .ks-adv h3{margin:0;font-size:13px;font-weight:600}
        .ks-link{border:none;background:transparent;padding:0;color:var(--dsw-alias-brand-primary,#4d6bfe);font:inherit;font-size:11px;cursor:pointer}
        .ks-type-picker{position:relative;display:inline-flex;flex:none}
        .ks-type-pill{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;cursor:pointer;white-space:nowrap;flex:none}
        .ks-type-pill:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
        .ks-type-pill[data-tone="locked"]{cursor:default;border-color:transparent;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 12%,transparent);color:var(--dsw-alias-brand-primary,#4d6bfe)}
        .ks-type-pill[data-tone="muted"],.ks-type-pill[data-tone="err"]{cursor:default}
        .ks-type-pill[data-tone="err"]{border-color:var(--dsw-alias-state-error-primary,#d84848);color:var(--dsw-alias-state-error-primary,#d84848)}
        .ks-type-dot{width:6px;height:6px;border-radius:999px;background:currentColor;flex:none;opacity:.75}
        .ks-type-lock{font-size:9.5px;opacity:.8}
        .ks-type-menu{position:absolute;bottom:calc(100% + 6px);left:0;z-index:40;display:flex;flex-direction:column;gap:2px;min-width:190px;padding:5px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:var(--dsw-shadow-lv2)}
        .ks-type-option{display:flex;align-items:center;width:100%;padding:6px 8px;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer;white-space:nowrap}
        .ks-type-option:hover{background:var(--dsw-alias-interactive-bg-hover)}
        .ks-type-option[data-active="true"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 10%,transparent);color:var(--dsw-alias-brand-primary,#4d6bfe);font-weight:560}
        .ks-type-hint{padding:3px 8px 5px;font-size:10px;color:var(--dsw-alias-label-tertiary);border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:2px}
        @media(max-width:820px){
          .ks-grid{grid-template-columns:1fr}
          .ks-doc-body{padding:8px}
        }
        @container(max-width:620px){
          .ks-view .ks-pane-split{flex-direction:column}
          .ks-view .ks-tree-wrap{width:auto;max-width:none;max-height:34%;border-right:none;border-bottom:1px solid var(--dsw-alias-border-l1)}
        }
        /* Dependency graph: one row per wave, tasks side by side inside the row,
           a rail on the left joining the waves. A "#1 [2.1, 3.1, 4.1]" text line
           was technically the graph but nobody could read it. */
        .ks-waves{display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1,transparent);padding:10px 12px}
        .ks-waves-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
        .ks-waves-title{font-size:12px;font-weight:600}
        .ks-waves-hint{margin-left:auto;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
        .ks-waves-list{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}
        .ks-wave{display:flex;gap:10px;min-width:0}
        .ks-wave-rail{display:flex;flex-direction:column;align-items:center;flex:none;width:18px}
        .ks-wave-node{display:grid;place-items:center;width:18px;height:18px;margin-top:3px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1,#fff);font-size:9.5px;font-weight:600;color:var(--dsw-alias-label-tertiary);flex:none}
        .ks-wave[data-open="true"] .ks-wave-node{border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-brand-primary,#4d6bfe)}
        .ks-wave-line{flex:1 1 auto;width:1px;margin:2px 0;background:var(--dsw-alias-border-l1)}
        .ks-wave-main{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1 1 auto;padding:2px 0 10px}
        .ks-wave:last-child .ks-wave-main{padding-bottom:0}
        .ks-wave-head{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
        .ks-wave-label{font-weight:600}
        .ks-wave-count{font-variant-numeric:tabular-nums}
        .ks-wave-parallel{padding:0 5px;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 10%,transparent);color:var(--dsw-alias-brand-primary,#4d6bfe);font-size:9.5px;line-height:15px}
        /* The parallel batch: tasks share one row and wrap only when narrow. */
        .ks-wave-tasks{display:flex;flex-wrap:wrap;gap:5px;margin:0;padding:0;list-style:none}
        /* Chips are capped so several fit one row: agents write paragraph-long
           task titles, and an uncapped chip filled the row alone, which made a
           parallel wave look like a vertical list. */
        .ks-wave-task{display:inline-flex;align-items:center;gap:5px;flex:0 1 auto;max-width:min(100%,300px);padding:3px 8px 3px 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base,transparent);font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary);min-width:0}
        .ks-wave-task[data-status="in_progress"]{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 45%,transparent);color:var(--dsw-alias-label-primary)}
        .ks-wave-task[data-status="completed"]{color:var(--dsw-alias-label-tertiary)}
        .ks-wave-id{flex:none;font-size:10px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code,var(--dsw-font-code,monospace))}
        .ks-wave-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        @container(min-width:640px){.ks-wave-task{max-width:min(100%,460px)}}
        .ks-wave-task[data-status="completed"] .ks-wave-name{text-decoration:line-through}
        .ks-waves-loose{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-tertiary)}
        .ks-waves-loose-label{font-weight:600;color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-warning-primary,#d98e00))}
        .ks-waves-loose-hint{font-size:10px}
        @container(max-width:520px){
          .ks-wave-name{max-width:120px}
        }
        /* Plan dock: same footprint and elevation as the host's own todo dock so
           swapping it in does not shift the composer. */
        .ks-plan{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance,0px) - var(--dsh-composer-side-clearance,0px) - var(--dsh-composer-dock-inset,0px) - var(--dsh-composer-dock-inset,0px));max-width:var(--dsh-composer-card-max-width,760px);margin:0 auto;flex:none;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1,#fff));box-shadow:var(--dsw-elevation-panel);overflow:hidden}
        .ks-plan-body{display:flex;flex-direction:column;gap:6px;padding:6px 12px}
        .ks-plan-head{display:flex;align-items:center;gap:8px;width:100%;padding:0;border:none;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
        .ks-plan-lead{flex:none;font-size:9px;line-height:1;color:var(--dsw-alias-label-tertiary)}
        .ks-plan-name{flex:none;font-size:13px;font-weight:500;line-height:24px;color:var(--dsw-alias-label-primary)}
        .ks-plan-progress{flex:1 1 auto;min-width:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .ks-plan-feature{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code,var(--dsw-font-code,monospace))}
        .ks-plan-wave{display:flex;flex-direction:column;gap:2px}
        .ks-plan-wave-head{display:flex;align-items:center;gap:6px;font-size:10.5px;font-weight:600;color:var(--dsw-alias-label-tertiary);letter-spacing:.02em}
        .ks-plan-wave-meta{margin-left:auto;font-weight:400;font-variant-numeric:tabular-nums}
        .ks-plan-list{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;max-height:150px;overflow-y:auto}
        .ks-plan-task{display:flex;align-items:center;gap:7px;min-width:0;font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-secondary)}
        .ks-plan-task[data-status="completed"]{color:var(--dsw-alias-label-tertiary)}
        .ks-plan-task[data-status="completed"] .ks-plan-title{text-decoration:line-through}
        .ks-plan-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-border-l2,var(--dsw-alias-border-l1))}
        .ks-plan-dot[data-status="in_progress"]{background:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 22%,transparent);animation:ks-plan-pulse 1.6s ease-in-out infinite}
        .ks-plan-dot[data-status="completed"]{background:var(--dsw-alias-state-success-primary,#22c55e)}
        .ks-plan-dot[data-status="queued"]{background:var(--dsw-alias-label-tertiary)}
        .ks-plan-id{flex:none;font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code,var(--dsw-font-code,monospace))}
        .ks-plan-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .ks-plan-tag{flex:none;padding:0 5px;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 8%,transparent);font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
        @keyframes ks-plan-pulse{0%,100%{opacity:1}50%{opacity:.45}}
        @media(prefers-reduced-motion:reduce){.ks-plan-dot[data-status="in_progress"]{animation:none}}
        @media(prefers-reduced-motion:reduce){.ks-spinner{animation-duration:2s}}
      `;

      function ensureStyles() {
        if (typeof document === "undefined") return;
        const existing = document.getElementById(NAV_STYLE_ID);
        const style = existing || document.createElement("style");
        style.id = NAV_STYLE_ID;
        // Older releases used this id for navigation-only CSS. Reuse the tag,
        // but refresh its contents so pane/picker styles survive an upgrade.
        style.setAttribute("data-plugin", "@weniatall/dsh-spec");
        if (style.textContent !== css) style.textContent = css;
        if (!existing) (document.head || document.body).appendChild(style);
      }

      // The module loader inventories styles while materializing the factory;
      // injecting only in apply() misses that lifecycle and can leave stale CSS.
      ensureStyles();

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

      const h = react.createElement;

      function formatDate(value) {
        if (typeof value !== "number") return "";
        try {
          return new Date(value).toLocaleString();
        } catch {
          return "";
        }
      }

      function statusTone(ok, counts) {
        if (!ok) return "err";
        if (counts && counts.warning > 0) return "warn";
        return "ok";
      }

      function progressText(progress, lang = uiLang()) {
        if (!progress) return t(lang, "noTasks");
        return t(lang, "requiredProgress", { done: progress.completed, total: progress.required, percent: progress.percent });
      }

      // ---------------------------------------------------------------------
      // Pure presentation rules (exported via internals for direct testing)
      // ---------------------------------------------------------------------

      /** Document node labels, identical to Kiro's SpecExplorer tree. */
      const DOCUMENT_LABEL = {
        requirements: "Requirements",
        bugfix: "Bugfix",
        design: "Design",
        tasks: "Tasks",
      };

      /** Document labels are file names, so they stay as they are in both languages. */
      function documentLabel(kind, lang = uiLang()) {
        return DOCUMENT_LABEL[kind] ?? String(kind ?? "");
      }

      /** Phase metadata: label plus which document the phase is waiting on. */
      const PHASE_META = {
        requirements: { current: "requirements", done: [] },
        design: { current: "design", done: ["requirements", "bugfix"] },
        tasks: { current: "tasks", done: ["requirements", "bugfix", "design"] },
        execution: { current: "tasks", done: ["requirements", "bugfix", "design"] },
        done: { current: null, done: ["requirements", "bugfix", "design", "tasks"] },
      };

      /**
       * Document nodes for one spec, in Kiro's order.
       *
       * Kiro's SpecExplorerTreeProvider lists requirements/bugfix/design/tasks,
       * except for the fast-task workflow, which lists tasks first and marks
       * requirements and design as auto-generated. Only documents that exist on
       * disk are listed, so a fresh spec shows one node rather than three empty
       * placeholders.
       *
       * @param {{workflowType?: string, specType?: string}} config
       * @param {string[]|Record<string, boolean>} present - document kinds that exist
       * @param {string} [phase] - server-derived phase; falls back to presence
       * @param {'zh'|'en'} [lang] - UI language for the labels
       * @returns {Array<{kind: string, label: string, secondary: boolean, state: string}>}
       */
      function documentOrder(config, present, phase, lang = uiLang()) {
        const workflow = (config && config.workflowType) || "requirements-first";
        const fastTask = workflow === "fast-task";
        const order = fastTask
          ? ["tasks", "requirements", "design"]
          : ["requirements", "bugfix", "design", "tasks"];
        const secondary = fastTask ? ["requirements", "design"] : [];
        const available = new Set(
          Array.isArray(present)
            ? present
            : Object.entries(present || {}).filter(([, exists]) => exists === true).map(([kind]) => kind),
        );
        const meta = PHASE_META[phase] || PHASE_META[phaseOf(config, [...available])] || PHASE_META.requirements;
        const nodes = [];
        for (const kind of order) {
          if (!available.has(kind)) continue;
          let state = "pending";
          if (meta.done.indexOf(kind) !== -1) state = "done";
          if (meta.current === kind) state = "current";
          // A bugfix spec stores its requirements in bugfix.md; requirements.md
          // and bugfix.md are the same stage, so both follow the requirements slot.
          if (kind === "bugfix" && meta.current === "requirements") state = "current";
          nodes.push({ kind, label: documentLabel(kind, lang), secondary: secondary.indexOf(kind) !== -1, state });
        }
        return nodes;
      }

      /**
       * Phase from the documents that exist, mirroring lib/model.js.
       *
       * Only a fallback: the panel renders the server's phase, because task
       * progress (and therefore `done`) is not derivable from presence alone.
       *
       * @param {{workflowType?: string, specType?: string}} config
       * @param {string[]} present
       * @returns {string}
       */
      function phaseOf(config, present) {
        const available = new Set(present || []);
        const requirementsKind = config && config.specType === "bugfix" ? "bugfix" : "requirements";
        if (!available.has(requirementsKind)) return "requirements";
        if (!available.has("design")) return "design";
        if (!available.has("tasks")) return "tasks";
        return "execution";
      }

      /** Short label for a phase value coming from the host. */
      function phaseView(phase, lang = uiLang()) {
        const label = STRINGS.phase[phase] === undefined ? String(phase || "") : tg(lang, "phase", phase);
        return { label, tone: phase === "done" ? "ok" : phase === "execution" ? "brand" : "muted" };
      }

      // ---------------------------------------------------------------------
      // Markdown (inlined: the client bundle is a classic script registered via
      // __ModuleLoader__, so it cannot import a sibling ES module)
      // ---------------------------------------------------------------------

      /**
       * Split a document into blocks.
       *
       * Not CommonMark: it covers what Kiro's own templates use — headings,
       * lists, fenced code, tables, quotes, rules — and anything it does not
       * recognise becomes a paragraph rather than disappearing, because a
       * document must never lose content to a token the renderer did not know.
       *
       * The order of the branches is the grammar: a fence swallows everything to
       * its closing line, so a `#` inside a code sample is never a heading.
       *
       * @param {string} text
       * @returns {object[]}
       */
      function parseBlocks(text) {
        const rows = String(text ?? "").replace(/\r\n?/gu, "\n").split("\n");
        const blocks = [];
        let index = 0;
        while (index < rows.length) {
          const row = rows[index];
          if (row.trim() === "") {
            index += 1;
            continue;
          }

          const fence = /^\s*(`{3,}|~{3,})(.*)$/u.exec(row);
          if (fence !== null) {
            const marker = fence[1];
            const lang = fence[2].trim();
            const closing = new RegExp(`^\\s*${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`, "u");
            const body = [];
            let closed = false;
            index += 1;
            while (index < rows.length) {
              if (closing.test(rows[index])) {
                index += 1;
                closed = true;
                break;
              }
              body.push(rows[index]);
              index += 1;
            }
            // A document that ends inside a fence has no closing line, so its
            // trailing newline shows up as one empty row — trailing blanks are
            // formatting, not code.
            if (!closed) while (body.length > 0 && body[body.length - 1].trim() === "") body.pop();
            blocks.push({ kind: "code", lang, text: body.join("\n") });
            continue;
          }

          const heading = /^(#{1,6})\s+(.*)$/u.exec(row);
          if (heading !== null) {
            blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
            index += 1;
            continue;
          }

          if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/u.test(row)) {
            blocks.push({ kind: "rule" });
            index += 1;
            continue;
          }

          if (row.includes("|") && index + 1 < rows.length && isTableDelimiter(rows[index + 1])) {
            const header = splitTableRow(row);
            const align = splitTableRow(rows[index + 1]).map(alignmentOf);
            index += 2;
            const body = [];
            while (index < rows.length && rows[index].trim() !== "" && rows[index].includes("|")) {
              body.push(splitTableRow(rows[index]));
              index += 1;
            }
            blocks.push({ kind: "table", header, align, body });
            continue;
          }

          if (/^\s{0,3}>/u.test(row)) {
            const body = [];
            while (index < rows.length && /^\s{0,3}>/u.test(rows[index])) {
              body.push(rows[index].replace(/^\s{0,3}>\s?/u, ""));
              index += 1;
            }
            blocks.push({ kind: "quote", text: body.join("\n") });
            continue;
          }

          const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/u.exec(row);
          if (item !== null) {
            const ordered = /\d/u.test(item[2]);
            const items = [];
            while (index < rows.length) {
              const current = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/u.exec(rows[index]);
              if (current !== null && /\d/u.test(current[2]) === ordered) {
                items.push({ indent: current[1].length, text: current[3] });
                index += 1;
                continue;
              }
              // An indented continuation line belongs to the item above it.
              if (items.length > 0 && /^\s{2,}\S/u.test(rows[index])) {
                items[items.length - 1].text += ` ${rows[index].trim()}`;
                index += 1;
                continue;
              }
              break;
            }
            blocks.push({ kind: "list", ordered, items });
            continue;
          }

          const paragraph = [];
          while (index < rows.length && rows[index].trim() !== "" && !startsBlock(rows[index])) {
            paragraph.push(rows[index].trim());
            index += 1;
          }
          if (paragraph.length > 0) {
            blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
            continue;
          }
          blocks.push({ kind: "paragraph", text: row.trim() });
          index += 1;
        }
        return blocks;
      }

      function isTableDelimiter(row) {
        return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/u.test(row);
      }

      function splitTableRow(row) {
        let text = row.trim();
        if (text.startsWith("|")) text = text.slice(1);
        if (text.endsWith("|")) text = text.slice(0, -1);
        return text.split("|").map((cell) => cell.trim());
      }

      function alignmentOf(cell) {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        if (left && right) return "center";
        if (right) return "right";
        if (left) return "left";
        return null;
      }

      function startsBlock(row) {
        return /^\s*(`{3,}|~{3,})/u.test(row)
          || /^#{1,6}\s/u.test(row)
          || /^\s{0,3}>/u.test(row)
          || /^(\s*)([-*+]|\d+[.)])\s+/u.test(row)
          || /^\s{0,3}([-*_])(\s*\1){2,}\s*$/u.test(row);
      }

      /**
       * Split inline Markdown into text and marks.
       *
       * Scans left to right so a backtick span wins over the emphasis rules
       * inside it — `**Spec** \`a_b_c\`` keeps `a_b_c` literal.
       *
       * @param {string} text
       * @returns {{type: "text"|"code"|"strong"|"em"|"link", text: string, href?: string}[]}
       */
      function parseInline(text) {
        const source = String(text ?? "");
        const out = [];
        let buffer = "";
        let index = 0;
        const flush = () => {
          if (buffer !== "") {
            out.push({ type: "text", text: buffer });
            buffer = "";
          }
        };
        while (index < source.length) {
          const rest = source.slice(index);

          if (rest.startsWith("`")) {
            const end = source.indexOf("`", index + 1);
            if (end !== -1) {
              flush();
              out.push({ type: "code", text: source.slice(index + 1, end) });
              index = end + 1;
              continue;
            }
          }

          const strong = /^(\*\*|__)(.+?)\1/u.exec(rest);
          if (strong !== null) {
            flush();
            out.push({ type: "strong", text: strong[2] });
            index += strong[0].length;
            continue;
          }

          const em = /^(\*|_)(?!\s)(.+?)\1(?!\w)/u.exec(rest);
          if (em !== null) {
            flush();
            out.push({ type: "em", text: em[2] });
            index += em[0].length;
            continue;
          }

          const link = /^\[([^\]]+)\]\(([^)\s]+)\)/u.exec(rest);
          if (link !== null) {
            flush();
            out.push({ type: "link", text: link[1], href: link[2] });
            index += link[0].length;
            continue;
          }

          buffer += source[index];
          index += 1;
        }
        flush();
        return out.length === 0 ? [{ type: "text", text: "" }] : out;
      }

      /**
       * Render a document to React nodes.
       *
       * Deliberately no `dangerouslySetInnerHTML`: the text is model-written, so
       * it must reach the page as nodes, never as markup.
       *
       * @param {string} text
       * @returns {object[]}
       */
      function renderMarkdown(text) {
        const inline = (value) => parseInline(value).map((token, position) => {
          if (token.type === "text") return token.text;
          if (token.type === "link") {
            return h("a", { key: `l${position}`, className: "ks-md-link", href: token.href, target: "_blank", rel: "noreferrer noopener" }, token.text);
          }
          return h(token.type, { key: `${token.type}${position}`, className: `ks-md-${token.type}` }, token.text);
        });

        return parseBlocks(text).map((block, position) => {
          const key = `b${position}`;
          switch (block.kind) {
            case "heading":
              return h(`h${Math.min(block.level + 1, 6)}`, { key, className: "ks-md-heading", "data-level": String(block.level) }, ...inline(block.text));
            case "code":
              return h("pre", { key, className: "ks-md-pre", "data-lang": block.lang || undefined }, h("code", null, block.text));
            case "rule":
              return h("hr", { key, className: "ks-md-rule" });
            case "quote":
              return h("blockquote", { key, className: "ks-md-quote" }, ...inline(block.text));
            case "table": {
              const head = h("tr", { key: "h" }, ...block.header.map((cell, column) => h("th", {
                key: `h${column}`,
                style: block.align[column] ? { textAlign: block.align[column] } : undefined,
              }, ...inline(cell))));
              const body = block.body.map((row, rowIndex) => h("tr", { key: `r${rowIndex}` }, ...row.map((cell, column) => h("td", {
                key: `c${column}`,
                style: block.align[column] ? { textAlign: block.align[column] } : undefined,
              }, ...inline(cell)))));
              return h("div", { key, className: "ks-md-table-wrap" },
                h("table", { className: "ks-md-table" }, h("thead", null, head), h("tbody", null, ...body)));
            }
            case "list": {
              const tag = block.ordered ? "ol" : "ul";
              return h(tag, { key, className: "ks-md-list" }, ...block.items.map((item, itemIndex) => h("li", {
                key: `i${itemIndex}`,
                className: "ks-md-li",
                style: item.indent > 0 ? { marginLeft: `${Math.min(item.indent, 8) * 2}px` } : undefined,
              }, ...inline(item.text))));
            }
            case "paragraph":
            default:
              return h("p", { key, className: "ks-md-p" }, ...inline(block.text));
          }
        });
      }

      /**
       * Split a task title into a heading and its explanatory rest.
       *
       * Agents write `1.1 Create the package manifest: \`package.json\` with
       * "type": "module", "bin": { … }, "scripts": { … }, "engines": {…}, and no
       * dependencies` — the first clause is the task, the rest is what it means.
       * Shown as one string it reads as a paragraph of code, and the id, the
       * title and the detail all blur together.
       *
       * Split on the first `: ` / `：` / ` — ` / ` - ` whose left side is a
       * plausible heading (2–80 characters); otherwise leave the title whole,
       * because a split in the middle of a sentence is worse than a long line.
       *
       * @param {string} title
       * @returns {{heading: string, detail: string}}
       */
      function splitTaskTitle(title) {
        const text = String(title ?? "").trim();
        // Full-width punctuation has no trailing space in Chinese text, so the
        // colon may be followed directly by the detail.
        const separators = [/[:：]\s*/u, /\s+[—–]\s+/u, /\s+-\s+/u];
        for (const separator of separators) {
          const match = separator.exec(text);
          if (match === null) continue;
          const heading = text.slice(0, match.index).trim();
          // A colon is consumed by the slice; a dash separator must be dropped too.
          const detail = text.slice(match.index + 1).replace(/^[—–-]\s*/u, "").trim();
          if (heading.length >= 2 && heading.length <= 80 && detail.length > 0) return { heading, detail };
        }
        return { heading: text, detail: "" };
      }

      function TaskRow(props) {
        const task = props.task;
        const lang = useLang();
        const depth = Math.min(task.depth || 0, 2);
        const statusLabel = tg(lang, "status", TASK_STATUS[task.status] === undefined ? "not_started" : task.status);
        const checked = task.status === "completed";
        // A parent whose required children are all done reads as completed even
        // when its own box was never checked, so its controls cannot change
        // anything: the subtree decides. Say so instead of offering a control
        // that silently reverts.
        const derived = task.derived === true;
        const locked = props.busy || derived;
        const split = splitTaskTitle(task.title);
        const heading = split.heading;
        const derivedHint = derived ? t(lang, "derivedHint") : undefined;
        return h("div", { className: "ks-task", "data-depth": depth, "data-derived": derived ? "true" : undefined },
          h("input", {
            className: "ks-check",
            type: "checkbox",
            checked,
            disabled: locked,
            title: derivedHint,
            "aria-label": t(lang, "taskCheckAria", { id: task.id, title: task.title }),
            onChange: () => props.onToggle(task, checked ? "not_started" : "completed"),
          }),
          h("div", { className: "ks-task-main" },
            h("span", { className: "ks-task-title", "data-done": String(checked), title: task.title },
              h("span", { className: "ks-task-id" }, task.id),
              h("span", null, heading)),
            split.detail === "" ? null : h("p", { className: "ks-task-detail", "data-done": String(checked) }, split.detail),
            h("span", { className: "ks-task-sub" },
              h("span", null, statusLabel),
              derived ? h("span", { className: "ks-badge", "data-tone": "muted", title: derivedHint }, t(lang, "derivedTag")) : null,
              task.optional ? h("span", { className: "ks-badge", "data-tone": "muted" }, t(lang, "optional")) : null,
              task.wave !== null && task.wave !== undefined ? h("span", null, `wave ${task.wave}`) : null,
              task.requirements && task.requirements.length > 0 ? h("span", null, task.requirements.join(", ")) : null)),
          h("select", {
            className: "ks-select",
            value: task.status,
            disabled: locked,
            title: derivedHint,
            "aria-label": t(lang, "taskStatusAria", { id: task.id }),
            onChange: (event) => props.onToggle(task, event.target.value),
          }, Object.keys(TASK_STATUS).map((value) => h("option", { key: value, value }, tg(lang, "status", value)))));
      }

      // ---------------------------------------------------------------------
      // Chat composer entry — only inside the Spec agent preset
      // ---------------------------------------------------------------------
      /**
       * The composer entry.
       *
       * Two honest states:
       *   - unbound: choose what to create (the choice is persisted on the host
       *     and consumed by `create`), or associate an existing spec;
       *   - bound: a chip naming the spec the session works on.
       *
       * It renders nothing outside the Spec preset, so a standard conversation
       * never carries a Spec control.
       */
      function SpecComposerEntry(props) {
        const rpcCall = props.rpcCall;
        const lang = useLang();
        // `openSpecView` switches the conversation to the 规格 tab, injected by
        // `apply`. A host whose conversation service is missing leaves it
        // undefined: the entry then says so instead of calling into a service
        // that is not there.
        const openSpecView = props.openSpecView;
        const canOpenTab = typeof props.canOpenSpecView === "function"
          ? props.canOpenSpecView()
          : typeof openSpecView === "function";
        const hasPresetSource = typeof props.useSessions === "function";
        const preset = hasPresetSource
          ? props.useSessions((sessions) => sessions.byId[props.sessionId]?.projectionValues?.agentPreset)
          : undefined;
        const [state, setState] = react.useState({ sessionId: null, loading: true, presetActive: false, activeSpec: null, specs: [], error: "" });
        const [open, setOpen] = react.useState(false);
        const [busy, setBusy] = react.useState("");
        const [notice, setNotice] = react.useState("");
        const [requests] = react.useState(() => ({ generation: 0 }));

        const load = async (generation = requests.generation) => {
          if (!props.sessionId) return;
          try {
            const data = await rpcCall("describe", { sessionId: props.sessionId });
            if (generation !== requests.generation) return;
            setState({
              sessionId: props.sessionId,
              loading: false,
              presetActive: data.presetActive === true,
              activeSpec: data.activeSpec || null,
              specs: data.specs || [],
              error: "",
            });
          } catch (error) {
            if (generation !== requests.generation) return;
            setState((current) => ({
              ...current,
              sessionId: props.sessionId,
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        };

        react.useEffect(() => {
          const generation = ++requests.generation;
          setOpen(false);
          setNotice("");
          setState({ sessionId: props.sessionId, loading: true, presetActive: false, activeSpec: null, specs: [], error: "" });
          if (props.sessionId && (!hasPresetSource || preset === "spec")) void load(generation);
          return () => { requests.generation += 1; };
        }, [props.sessionId, hasPresetSource, preset, rpcCall]);

        // Unknown/loading hosts must not leak a Spec control into a conversation.
        if (!props.sessionId) return null;
        if (hasPresetSource ? preset !== "spec" : state.presetActive !== true) return null;
        if (state.sessionId !== props.sessionId) return null;

        const chooseType = async (specType) => {
          if (busy !== "") return;
          setBusy(specType);
          setOpen(false);
          try {
            await rpcCall("saveDraft", { sessionId: props.sessionId, specType });
            setNotice(t(lang, "pickType", { type: specTypeLabel(specType, lang) }));
          } catch (error) {
            setState((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }));
          } finally {
            setBusy("");
          }
        };

        const associate = async (feature) => {
          if (busy !== "") return;
          setBusy(feature);
          setOpen(false);
          try {
            await rpcCall("bind", { sessionId: props.sessionId, feature });
            await load();
            setNotice(t(lang, "bound", { feature }));
          } catch (error) {
            setState((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }));
          } finally {
            setBusy("");
          }
        };

        if (state.error !== "") {
          return h("button", { type: "button", className: "ks-type-pill", "data-tone": "err", title: state.error, disabled: true }, t(lang, "specUnavailable"));
        }
        if (state.loading) return null;

        const openTab = () => {
          if (!canOpenTab) return;
          openSpecView(props.sessionId);
        };

        const active = state.activeSpec;
        if (active !== null) {
          const phase = phaseOf2(active.phase, lang);
          return h("button", {
            type: "button",
            className: "ks-type-pill",
            "data-tone": "locked",
            title: canOpenTab
              ? `${active.feature} · ${phase} · ${t(lang, "openTab")}`
              : `${active.feature} · ${phase} · ${t(lang, "noSessionView")}`,
            "aria-label": t(lang, "currentSpec", { feature: active.feature, phase }),
            disabled: !canOpenTab,
            onClick: openTab,
          },
          h("span", { className: "ks-type-dot" }),
          h("span", null, active.feature),
          h("span", { className: "ks-type-lock" }, phase));
        }

        return h("div", { className: "ks-type-picker" },
          h("button", {
            type: "button",
            className: "ks-type-pill",
            "data-tone": "open",
            "aria-haspopup": "menu",
            "aria-expanded": String(open),
            title: notice || (canOpenTab ? t(lang, "pickHint") : t(lang, "noSessionViewPanel")),
            onClick: () => setOpen((current) => !current),
          },
          h("span", { className: "ks-type-dot" }),
          h("span", null, busy === "" ? "Spec" : "…"),
          h("span", { className: "ks-caret", "data-open": String(open) }, "\u25b8")),
          open ? h("div", { className: "ks-type-menu", role: "menu" },
            canOpenTab ? h("button", {
              type: "button",
              role: "menuitem",
              className: "ks-type-option",
              onClick: () => { setOpen(false); openTab(); },
            }, t(lang, "openTab")) : null,
            canOpenTab ? h("div", { className: "ks-type-hint", style: { marginTop: "2px" } }, t(lang, "pickTypeHint")) : null,
            SPEC_TYPES.map((item) => h("button", {
              key: item.value,
              type: "button",
              role: "menuitem",
              className: "ks-type-option",
              disabled: busy !== "",
              onClick: () => void chooseType(item.value),
            }, specTypeLabel(item.value, lang))),
            state.specs.length === 0 ? null : h(react.Fragment, null,
              h("div", { className: "ks-type-hint", style: { marginTop: "4px" } }, t(lang, "linkExisting")),
              state.specs.map((spec) => h("button", {
                key: spec.feature,
                type: "button",
                role: "menuitem",
                className: "ks-type-option",
                disabled: busy !== "",
                onClick: () => void associate(spec.feature),
              }, `${spec.feature} · ${phaseOf2(spec.phase, lang)}`)))) : null,
          notice === "" ? null : h("span", { className: "ks-status", role: "status", style: { marginLeft: "6px" } }, notice));
      }

      // ---------------------------------------------------------------------
      // The Specs pane: the body of the 规格 conversation view
      // ---------------------------------------------------------------------
      // ---------------------------------------------------------------------
      // Plan dock — the Spec preset's own task list
      // ---------------------------------------------------------------------
      /**
       * The plan dock.
       *
       * The host's `todo_write` stores a flat list of three statuses and cannot
       * express Kiro's waves, so a Spec session that used it showed one list
       * here and a different one in the 规格 tab. This dock reads the `specPlan`
       * projection the Spec tools publish on every task write, so it speaks the
       * same vocabulary as tasks.md: waves, optional `*` tasks, checkpoints
       * excluded, and several tasks running in parallel in the same wave.
       *
       * Live by construction: the projection is a fold over session events, so
       * a checkbox the Agent moves mid-turn arrives here without polling.
       */
      /**
       * Re-sync the dock with `tasks.md` once per mount when nothing has been
       * published in this session yet.
       *
       * The projection is the live path and stays the only writer during a
       * turn; this is the cold-start path for an existing spec bound to a new
       * session. `spec_resync` reads the file, publishes the whole plan as a
       * `spec/plan` event, and returns the same snapshot so the dock can paint
       * before the event arrives — one source of truth, two deliveries.
       *
       * @param {((method: string, payload: object) => Promise<unknown>) | undefined} rpcCall
       * @param {object | null} projected
       * @returns {object | null} the snapshot fetched by the re-sync, if any
       */
      function usePlanResync(rpcCall, projected) {
        const [fetched, setFetched] = react.useState(null);
        react.useEffect(() => {
          if (typeof rpcCall !== "function" || projected !== null) return undefined;
          let live = true;
          void rpcCall("resync").then((value) => {
            if (!live || value === null || value === undefined) return;
            setFetched(value);
          }).catch(() => {
            // A failed re-sync leaves the dock hidden, which is exactly the
            // pre-0.7.0 behaviour; it must never take the composer down.
          });
          return () => { live = false; };
        }, [rpcCall, projected === null]);
        return fetched;
      }

      function PlanDock(props) {
        const lang = useLang();
        // The dock slot hands every entry the host's `useProjection`; the plan
        // arrives on the preset-scoped `specPlan` projection. A host without it
        // renders nothing rather than guessing the plan from RPC (the panel's
        // RPC has no live edge, and a polled copy is exactly the disagreement
        // this dock replaces).
        const useProjection = props.useProjection;
        const projected = typeof useProjection === "function" ? useProjection("specPlan") : null;
        const [collapsed, setCollapsed] = react.useState(true);
        const resync = usePlanResync(props.rpcCall, projected);
        // The projection only learns about a spec when a tool writes it: an
        // existing spec bound to a new session has a plan on disk and nothing
        // in this session's event log. The re-sync below reads the file once and
        // publishes it; until that lands, render the snapshot it returned.
        const plan = projected ?? resync;
        if (plan === null || plan === undefined || !Array.isArray(plan.waves)) return null;
        const counts = plan.counts || {};
        const running = plan.waves.flatMap((wave) => wave.tasks).filter((task) => task.status === "in_progress");
        const summary = [
          counts.done > 0 ? t(lang, "planDone", { count: counts.done }) : null,
          running.length > 0 ? t(lang, "planRunning", { count: running.length }) : null,
          counts.pending > 0 ? t(lang, "planPending", { count: counts.pending }) : null,
        ].filter(Boolean).join(" · ");
        const rowOf = (task) => h("li", { className: "ks-plan-task", "data-status": task.status, key: task.id },
          h("span", { className: "ks-plan-dot", "data-status": task.status }),
          h("span", { className: "ks-plan-id" }, task.id),
          h("span", { className: "ks-plan-title", title: task.title }, task.title),
          task.optional ? h("span", { className: "ks-plan-tag" }, t(lang, "optional")) : null,
          task.derived ? h("span", { className: "ks-plan-tag" }, t(lang, "derivedTag")) : null);
        return h("section", { className: "ks-plan", "data-spec-plan": plan.feature, "aria-label": t(lang, "planAria") },
          h("div", { className: "ks-plan-body" },
            h("button", {
              className: "ks-plan-head", type: "button", "aria-expanded": String(!collapsed),
              onClick: () => setCollapsed((value) => !value),
            },
              h("span", { className: "ks-plan-lead" }, collapsed ? "▸" : "▾"),
              h("span", { className: "ks-plan-name" }, t(lang, "planName")),
              h("span", { className: "ks-plan-progress" }, summary === "" ? t(lang, "planTotal", { count: counts.total || 0 }) : summary),
              h("span", { className: "ks-plan-feature" }, plan.feature)),
            collapsed ? null : [
              ...plan.waves.map((wave) => h("div", { className: "ks-plan-wave", key: `w${wave.id}` },
                h("div", { className: "ks-plan-wave-head" },
                  h("span", null, t(lang, "wave", { id: wave.id })),
                  h("span", { className: "ks-plan-wave-meta" }, `${wave.tasks.filter((task) => task.status === "completed").length}/${wave.tasks.length}`)),
                h("ul", { className: "ks-plan-list" }, wave.tasks.map(rowOf)))),
              plan.unscheduled && plan.unscheduled.length > 0
                ? h("div", { className: "ks-plan-wave", key: "loose" },
                  h("div", { className: "ks-plan-wave-head" }, h("span", null, t(lang, "notGraphed")), h("span", { className: "ks-plan-wave-meta" }, t(lang, "graphNeeded"))),
                  h("ul", { className: "ks-plan-list" }, plan.unscheduled.map(rowOf)))
                : null,
            ]));
      }

      /**
       * The Specs pane.
       *
       * Kiro's model: the tree selects a feature and one of its documents; the
       * document is the body. There is no second layer of "overview / design /
       * tasks" tabs over the same content, which is what made the old pane feel
       * like an admin console rather than an editor.
       */
      function SpecView(props) {
        const rpcCall = props.rpcCall;
        const sessionId = props.sessionId;
        const lang = useLang();
        const active = props.active !== false;

        const [state, setState] = react.useState({
          list: null, detail: null, selected: null, document: null,
          documentText: null, documentError: "", loading: false, error: "",
        });
        const [busy, setBusy] = react.useState("");
        const [flash, setFlash] = react.useState("");
        const [menuOpen, setMenuOpen] = react.useState(false);
        const [showCreate, setShowCreate] = react.useState(false);
        const [showAdvanced, setShowAdvanced] = react.useState(false);
        const [form, setForm] = react.useState({ title: "", specType: "feature", workflowType: "requirements-first" });
        const [settingsForm, setSettingsForm] = react.useState(null);
        const [tokens] = react.useState(() => ({ list: 0, detail: 0, doc: 0 }));
        // Latest selection, readable from the activation effect without making
        // it depend on every selection change (which would reload twice).
        const [live] = react.useState(() => ({ mounted: false, selected: null, document: null }));
        live.selected = state.selected;
        live.document = state.document;

        const withSession = (payload) => (sessionId ? { sessionId, ...payload } : payload);

        const loadList = async () => {
          const token = ++tokens.list;
          try {
            const list = await rpcCall("describe", withSession({}));
            if (token !== tokens.list) return null;
            setState((current) => ({ ...current, list, error: "" }));
            return list;
          } catch (error) {
            if (token !== tokens.list) return null;
            setState((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }));
            return null;
          }
        };

        const loadDetail = async (feature) => {
          if (!feature) return null;
          const token = ++tokens.detail;
          try {
            const detail = await rpcCall("get", withSession({ feature }));
            if (token !== tokens.detail) return null;
            setState((current) => (current.selected === feature ? { ...current, detail, error: "" } : current));
            return detail;
          } catch (error) {
            if (token !== tokens.detail) return null;
            setState((current) => (current.selected === feature
              ? { ...current, detail: null, error: error instanceof Error ? error.message : String(error) }
              : current));
            return null;
          }
        };

        const loadDocument = async (feature, kind) => {
          if (!feature || !kind) return null;
          const token = ++tokens.doc;
          try {
            const value = await rpcCall("document", withSession({ feature, document: kind }));
            if (token !== tokens.doc) return null;
            setState((current) => (current.selected === feature && current.document === kind
              ? { ...current, documentText: value.content, documentError: "" }
              : current));
            return value;
          } catch (error) {
            if (token !== tokens.doc) return null;
            setState((current) => (current.selected === feature && current.document === kind
              ? { ...current, documentText: null, documentError: error instanceof Error ? error.message : String(error) }
              : current));
            return null;
          }
        };

        // Read on mount and whenever the pane becomes active again: the Agent may
        // have rewritten documents while the user was chatting. The binding, when
        // present, decides what opens; otherwise the tree stays unselected.
        react.useEffect(() => {
          let cancelled = false;
          setState((current) => ({ ...current, loading: true }));
          void (async () => {
            const list = await loadList();
            if (cancelled) return;
            setState((current) => ({ ...current, loading: false }));
            if (list === null) return;
            // A bound session opens its spec; an unbound one keeps the tree
            // collapsed until the user picks a feature.
            setState((current) => {
              if (current.selected !== null) return current;
              const bound = list.activeSpec ? list.activeSpec.feature : null;
              return bound === null ? current : { ...current, selected: bound };
            });
            if (!live.mounted) {
              live.mounted = true;
              return;
            }
            if (!active) return;
            // Becoming active again re-reads everything: the Agent may have
            // rewritten any document while the pane was in the background.
            if (live.selected) {
              await loadDetail(live.selected);
              if (live.document) await loadDocument(live.selected, live.document);
            }
          })();
          return () => {
            cancelled = true;
            // The tab body may be retained while another tab is shown, and the
            // host may unmount it outright. Invalidate all in-flight reads
            // either way, so a late response cannot land on the next mount.
            tokens.list += 1;
            tokens.detail += 1;
            tokens.doc += 1;
          };
        }, [active, sessionId]);

        react.useEffect(() => {
          if (state.selected) void loadDetail(state.selected);
        }, [state.selected]);

        react.useEffect(() => {
          if (state.selected && state.document) void loadDocument(state.selected, state.document);
        }, [state.selected, state.document]);

        const list = state.list;
        const detail = state.detail;
        const specs = list ? list.specs : [];
        const selectedSpec = specs.find((spec) => spec.feature === state.selected) || null;
        const bindingFeature = list && list.activeSpec ? list.activeSpec.feature : null;

        const refreshAll = async () => {
          setFlash("");
          tokens.detail += 1;
          tokens.doc += 1;
          const next = await loadList();
          const feature = state.selected ?? (next && next.activeSpec ? next.activeSpec.feature : null);
          if (feature) {
            await loadDetail(feature);
            if (state.document) await loadDocument(feature, state.document);
          }
        };

        const selectFeature = (feature) => {
          tokens.detail += 1;
          tokens.doc += 1;
          const next = feature === state.selected ? null : feature;
          setState((current) => ({ ...current, selected: next, detail: null, document: null, documentText: null, documentError: "" }));
          setShowCreate(false);
          setShowAdvanced(false);
          setFlash("");
        };

        const selectDocument = (kind) => {
          tokens.doc += 1;
          setState((current) => ({ ...current, document: kind, documentText: null, documentError: "" }));
          setFlash("");
        };

        const toggleTask = async (task, status) => {
          if (!state.selected || busy !== "") return;
          setBusy(task.id);
          setFlash("");
          try {
            const result = await rpcCall("taskUpdate", withSession({ feature: state.selected, taskId: task.id, status }));
            const notes = [];
            if (result.propagated && result.propagated.length > 0) notes.push(t(lang, "parentAutoDone", { ids: result.propagated.map((item) => item.taskId).join(", ") }));
            if (result.warnings && result.warnings.length > 0) notes.push(...result.warnings);
            notes.push(t(lang, "taskMoved", { id: task.id, status: STRINGS.status[status] === undefined ? status : tg(lang, "status", status) }));
            setFlash(notes.join(lang === "zh" ? "；" : "; "));
            await loadDetail(state.selected);
            await loadList();
          } catch (error) {
            setFlash(t(lang, "updateFailed", { error: error instanceof Error ? error.message : String(error) }));
          } finally {
            setBusy("");
          }
        };

        const openCreate = () => {
          const settings = list ? list.settings.values : {};
          const draft = list && list.draft ? list.draft : {};
          setForm({
            title: "",
            specType: draft.specType || settings.defaultSpecType || "feature",
            workflowType: draft.workflowType || settings.defaultWorkflow || "requirements-first",
          });
          setShowCreate(true);
          setShowAdvanced(false);
          setFlash("");
        };

        const createSpec = async () => {
          if (form.title.trim() === "") {
            setFlash(t(lang, "titleRequired"));
            return;
          }
          setBusy("create");
          setFlash("");
          try {
            const result = await rpcCall("create", withSession({ title: form.title, specType: form.specType, workflowType: form.workflowType }));
            setShowCreate(false);
            await loadList();
            setState((current) => ({ ...current, selected: result.feature, document: null, detail: null, documentText: null }));
            setFlash(t(lang, "created", { feature: result.feature }));
          } catch (error) {
            setFlash(t(lang, "createFailed", { error: error instanceof Error ? error.message : String(error) }));
          } finally {
            setBusy("");
          }
        };

        const checkNow = async () => {
          if (!state.selected) return;
          setBusy("check");
          try {
            const result = await rpcCall("check", withSession({ feature: state.selected }));
            const summary = result.specs && result.specs[0];
            setFlash(summary ? t(lang, "checkDone", { errors: summary.counts.error, warnings: summary.counts.warning }) : t(lang, "checkClean"));
            await loadDetail(state.selected);
            if (state.document) await loadDocument(state.selected, state.document);
          } catch (error) {
            setFlash(t(lang, "checkFailed", { error: error instanceof Error ? error.message : String(error) }));
          } finally {
            setBusy("");
          }
        };

        const bindSelected = async () => {
          if (!state.selected) return;
          setBusy("bind");
          try {
            await rpcCall("bind", withSession({ feature: state.selected }));
            const next = await loadList();
            setFlash(next && next.activeSpec ? t(lang, "linked", { feature: next.activeSpec.feature }) : t(lang, "linkedPlain"));
          } catch (error) {
            setFlash(t(lang, "linkFailed", { error: error instanceof Error ? error.message : String(error) }));
          } finally {
            setBusy("");
          }
        };

        const unbind = async () => {
          setBusy("unbind");
          try {
            await rpcCall("unbind", withSession({}));
            await loadList();
            setFlash(t(lang, "unlinked"));
          } catch (error) {
            setFlash(t(lang, "unlinkFailed", { error: error instanceof Error ? error.message : String(error) }));
          } finally {
            setBusy("");
          }
        };

        const openAdvanced = () => {
          setMenuOpen(false);
          if (list) {
            const values = list.settings.values;
            setSettingsForm({
              kiroDir: values.kiroDir,
              promptEnabled: values.promptEnabled,
              includeActiveSpecs: values.includeActiveSpecs,
              promptMaxSpecs: values.promptMaxSpecs,
              strict: values.strict,
              defaultSpecType: values.defaultSpecType,
              defaultWorkflow: values.defaultWorkflow,
              language: values.language ?? "",
            });
          }
          setShowAdvanced(true);
          setShowCreate(false);
          setFlash("");
        };

        const saveAdvanced = async () => {
          if (settingsForm === null) return;
          setBusy("settings");
          setFlash("");
          try {
            const data = await rpcCall("saveSettings", withSession({ values: settingsForm }));
            setState((current) => (current.list === null ? current : { ...current, list: { ...current.list, settings: data.settings } }));
            setShowAdvanced(false);
            setFlash(t(lang, "saved"));
          } catch (error) {
            setFlash(t(lang, "saveFailed", { error: error instanceof Error ? error.message : String(error) }));
          } finally {
            setBusy("");
          }
        };

        const resetAdvanced = async () => {
          setBusy("settings");
          try {
            const data = await rpcCall("resetSettings", withSession({}));
            setState((current) => (current.list === null ? current : { ...current, list: { ...current.list, settings: data.settings } }));
            const values = data.settings.values;
            setSettingsForm({
              kiroDir: values.kiroDir,
              promptEnabled: values.promptEnabled,
              includeActiveSpecs: values.includeActiveSpecs,
              promptMaxSpecs: values.promptMaxSpecs,
              strict: values.strict,
              defaultSpecType: values.defaultSpecType,
              defaultWorkflow: values.defaultWorkflow,
              language: values.language ?? "",
            });
            setFlash(t(lang, "restored"));
          } catch (error) {
            setFlash(t(lang, "restoreFailed", { error: error instanceof Error ? error.message : String(error) }));
          } finally {
            setBusy("");
          }
        };

        const renderTree = () => {
          if (specs.length === 0) {
            return h("div", { className: "ks-empty" },
              h("strong", null, t(lang, "noSpecs")),
              h("span", null, t(lang, "noSpecsBody")),
              h("div", { className: "ks-callout" },
                t(lang, "convention"), h("code", null, ".kiro/specs/<feature>/"),
                h("br"), t(lang, "files"), "requirements.md / design.md / tasks.md + .config.kiro"),
              h("button", { className: "ks-button", "data-tone": "primary", type: "button", onClick: openCreate }, t(lang, "newSpec")));
          }
          return h("div", { className: "ks-tree", role: "tree", "aria-label": t(lang, "specs") }, specs.map((spec) => {
            const expanded = spec.feature === state.selected;
            const meta = phaseView(spec.phase, lang);
            const bound = bindingFeature === spec.feature;
            const documents = documentOrder(
              { workflowType: spec.workflowType, specType: spec.specType },
              spec.documents || {},
              spec.phase,
              lang,
            );
            return h("div", { key: spec.feature, className: "ks-tree-group" },
              h("button", {
                className: "ks-tree-row",
                type: "button",
                role: "treeitem",
                "aria-expanded": String(expanded),
                "data-active": String(expanded),
                onClick: () => selectFeature(spec.feature),
              },
              h("span", { className: "ks-caret", "data-open": String(expanded) }, "\u25b8"),
              h("span", { className: "ks-tree-main" },
                h("span", { className: "ks-tree-title" }, spec.feature),
                h("span", { className: "ks-tree-meta" },
                  h("span", { className: "ks-badge", "data-tone": bound ? "brand" : meta.tone }, bound ? t(lang, "currentSession") : meta.label),
                  h("span", null, progressText(spec.progress, lang)),
                  spec.ok ? null : h("span", { className: "ks-badge", "data-tone": "err" }, t(lang, "errorCount", { count: spec.issues.error }))))),
              expanded ? h("div", { className: "ks-tree-children", role: "group" }, documents.map((node) => h("button", {
                key: node.kind,
                className: "ks-tree-leaf",
                type: "button",
                role: "treeitem",
                "data-state": node.state,
                "data-active": String(state.document === node.kind),
                onClick: () => selectDocument(node.kind),
              },
              h("span", { className: "ks-dot", "data-state": node.state }),
              h("span", { className: "ks-tree-leaf-label" }, node.label),
              node.secondary ? h("span", { className: "ks-leaf-note" }, t(lang, "autoGenerated")) : null))) : null);
          }));
        };

        const renderIssues = (file) => {
          if (!detail) return null;
          const issues = file === undefined ? detail.issues : detail.issues.filter((issue) => issue.file === file);
          if (issues.length === 0) return null;
          return h("div", { className: "ks-section" },
            h("div", { className: "ks-section-head" },
              h("span", null, t(lang, "issues")),
              h("span", { className: "ks-badge", "data-tone": detail.counts.error > 0 ? "err" : "warn" }, t(lang, "issueCount", { count: issues.length }))),
            h("div", { className: "ks-section-body" }, issues.map((issue, index) => h("div", { key: `${issue.rule}-${index}`, className: "ks-issue" },
              h("span", { className: "ks-badge", "data-tone": issue.severity === "error" ? "err" : issue.severity === "warning" ? "warn" : "muted" }, tg(lang, "severity", issue.severity)),
              h("span", { style: { flex: "1 1 auto", minWidth: 0 } }, issue.message),
              issue.rule ? h("span", { className: "ks-issue-rule" }, `${issue.file || ""}${issue.line ? `:${issue.line}` : ""}`) : null))));
        };

        const renderOverview = () => {
          if (!detail) return null;
          const documents = [
            { name: "requirements.md", exists: detail.documents.some((doc) => doc.name === "requirements.md" && doc.exists) },
            { name: "bugfix.md", exists: detail.documents.some((doc) => doc.name === "bugfix.md" && doc.exists) },
            { name: "design.md", exists: detail.documents.some((doc) => doc.name === "design.md" && doc.exists) },
            { name: "tasks.md", exists: detail.documents.some((doc) => doc.name === "tasks.md" && doc.exists) },
          ].filter((doc) => doc.name !== "bugfix.md" || detail.config.specType === "bugfix");
          return h(react.Fragment, null,
            h("div", { className: "ks-progress" },
              h("div", { className: "ks-progress-head" }, h("span", null, t(lang, "taskProgress")), h("span", null, progressText(detail.progress, lang))),
              h("div", { className: "ks-bar" }, h("div", { className: "ks-bar-fill", style: { width: `${detail.progress ? detail.progress.percent : 0}%` } }))),
            h("div", { className: "ks-row" },
              h("span", { className: "ks-badge", "data-tone": statusTone(detail.ok, detail.counts) }, detail.ok ? t(lang, "formatOk") : t(lang, "hasErrors")),
              h("span", { className: "ks-badge", "data-tone": "muted" }, t(lang, "requirementCount", { count: detail.requirements.length, criteria: detail.requirements.reduce((sum, item) => sum + item.criteria.length, 0) })),
              h("span", { className: "ks-badge", "data-tone": "muted" }, t(lang, "propertyCount", { count: detail.properties.length }))),
            h("div", { className: "ks-row" }, documents.map((doc) => h("span", {
              key: doc.name,
              className: "ks-badge",
              "data-tone": doc.exists ? "ok" : "muted",
            }, doc.exists ? doc.name : t(lang, "missingDoc", { name: doc.name })))),
            detail.ready.length > 0 ? h("div", { className: "ks-section" },
              h("div", { className: "ks-section-head" }, h("span", null, t(lang, "readyNow")), h("span", { className: "ks-badge", "data-tone": "brand" }, "READY")),
              h("div", { className: "ks-section-body" }, detail.ready.map((task) => h("div", { key: task.id, className: "ks-task" },
                h("span", { className: "ks-task-main" },
                  h("span", { className: "ks-task-title" }, `${task.id} ${task.title}`),
                  h("span", { className: "ks-task-sub" }, task.wave === null ? t(lang, "linear") : `wave ${task.wave}`, task.optional ? ` · ${t(lang, "optional")}` : "")))))) : h("div", { className: "ks-note" },
              detail.phase === "done" ? t(lang, "allDone") : t(lang, "nothingReady")),
            list && list.presetActive === false ? h("div", { className: "ks-callout" }, t(lang, "notSpecSession")) : null,
            renderIssues());
        };

        /**
         * The dependency graph as a picture, not a list of ids.
         *
         * `#1 [2.1, 3.1, 4.1, 6.1]` is technically the graph and unreadable to a
         * person: a wave is a row of *parallel* work, so it renders as one row
         * per wave whose tasks sit side by side, each with its own status dot
         * and title, and each row's header says how many are done.
         *
         * The rows are ordered by wave id and joined by a connector, so the eye
         * reads "these run together, then these". A task missing from the graph
         * is called out below instead of being dropped — that is a document
         * defect the user needs to see.
         */
        const renderWaves = (value) => {
          const graph = value.dependencyGraph;
          const waves = Array.isArray(graph.waves) ? graph.waves : [];
          if (waves.length === 0) return null;
          const byId = new Map((value.tasks || []).map((task) => [task.id, task]));
          // The chip shows the task's heading, not the paragraph the agent
          // wrote after the colon; the full title stays in the tooltip.
          const titleOf = (id) => {
            const task = byId.get(id);
            return task === undefined ? id : splitTaskTitle(task.title).heading;
          };
          const statusOf = (id) => {
            const task = byId.get(id);
            return task === undefined ? "not_started" : task.status;
          };
          const scheduled = new Set(waves.flatMap((wave) => wave.tasks));
          const loose = (value.tasks || []).filter((task) => task.depth > 0 && task.children.length === 0
            && !scheduled.has(task.id) && !/checkpoint/iu.test(task.title));
          return h("section", { className: "ks-waves", "aria-label": t(lang, "graphAria") },
            h("div", { className: "ks-waves-head" },
              h("span", { className: "ks-waves-title" }, t(lang, "graphTitle")),
              h("span", { className: "ks-badge", "data-tone": "muted" }, t(lang, "graphWaves", { count: waves.length })),
              h("span", { className: "ks-waves-hint" }, t(lang, "graphHint"))),
            h("ol", { className: "ks-waves-list" },
              waves.map((wave, index) => {
                const done = wave.tasks.filter((id) => statusOf(id) === "completed").length;
                const open = done < wave.tasks.length;
                return h("li", { className: "ks-wave", key: `wave-${wave.id}`, "data-open": open ? "true" : "false" },
                  h("div", { className: "ks-wave-rail", "aria-hidden": "true" },
                    h("span", { className: "ks-wave-node" }, String(index + 1)),
                    index < waves.length - 1 ? h("span", { className: "ks-wave-line" }) : null),
                  h("div", { className: "ks-wave-main" },
                    h("div", { className: "ks-wave-head" },
                      h("span", { className: "ks-wave-label" }, t(lang, "waveNth", { n: index + 1 })),
                      h("span", { className: "ks-wave-count" }, `${done}/${wave.tasks.length}`),
                      wave.tasks.length > 1 ? h("span", { className: "ks-wave-parallel" }, t(lang, "parallel")) : null),
                    h("ul", { className: "ks-wave-tasks" },
                      wave.tasks.map((id) => {
                        const task = byId.get(id);
                        return h("li", { className: "ks-wave-task", key: id, "data-status": statusOf(id), title: task === undefined ? id : `${id} ${task.title}` },
                          h("span", { className: "ks-plan-dot", "data-status": statusOf(id) }),
                          h("span", { className: "ks-wave-id" }, id),
                          h("span", { className: "ks-wave-name" }, titleOf(id)),
                          task && task.optional ? h("span", { className: "ks-plan-tag" }, t(lang, "optional")) : null,
                          task && task.derived ? h("span", { className: "ks-plan-tag" }, t(lang, "derivedTag")) : null);
                      }))));
              })),
            loose.length > 0
              ? h("div", { className: "ks-waves-loose" },
                h("span", { className: "ks-waves-loose-label" }, t(lang, "notGraphed")),
                h("span", null, loose.map((task) => `${task.id} ${task.title}`).join(" · ")),
                h("span", { className: "ks-waves-loose-hint" }, t(lang, "graphNeededFull")))
              : null);
        };

        const renderTasks = () => {
          if (!detail) return null;
          if (!detail.tasks || detail.tasks.length === 0) {
            return h("div", { className: "ks-empty" }, h("strong", null, t(lang, "noTasks")), h("span", null, t(lang, "noTasksBody")));
          }
          return h("div", { className: "ks-section" },
            h("div", { className: "ks-section-head" },
              h("span", null, t(lang, "taskList")),
              h("span", { className: "ks-badge", "data-tone": "muted" }, detail.progress ? `${detail.progress.completed}/${detail.progress.required}` : "")),
            h("div", { className: "ks-section-body" },
              detail.tasks.map((task) => h(TaskRow, { key: task.id, task, busy: busy !== "", onToggle: toggleTask }))),
            detail.dependencyGraph ? renderWaves(detail) : null);
        };

        const renderDocument = () => {
          if (state.documentError !== "") return h("div", { className: "ks-error", role: "alert" }, state.documentError);
          if (state.documentText === null) return h("div", { className: "ks-empty" }, h("span", { className: "ks-spinner" }), h("span", null, t(lang, "readingDoc")));
          return h("div", { className: "ks-md" }, renderMarkdown(state.documentText));
        };

        const renderDetail = () => {
          if (state.error !== "" && detail === null) {
            return h("div", { className: "ks-doc-body" },
              h("div", { className: "ks-error", role: "alert" }, state.error),
              h("button", { className: "ks-button", type: "button", onClick: () => void refreshAll() }, t(lang, "retry")));
          }
          if (state.selected === null) {
            return h("div", { className: "ks-empty" }, h("span", null, t(lang, "pickSpec")));
          }
          if (detail === null) {
            return h("div", { className: "ks-empty" }, h("span", { className: "ks-spinner" }), h("span", null, t(lang, "loading")));
          }
          const node = state.document
            ? documentOrder({ workflowType: detail.config.workflowType, specType: detail.config.specType }, detail.documents.reduce((acc, doc) => {
              const kind = doc.name.replace(/\.md$/u, "");
              acc[kind === "bugfix" ? "bugfix" : kind] = doc.exists;
              return acc;
            }, {}), detail.phase, lang).find((item) => item.kind === state.document)
            : null;
          const title = state.document ? documentLabel(state.document, lang) : detail.feature;
          return h(react.Fragment, null,
            h("div", { className: "ks-doc-head" },
              h("span", { className: "ks-doc-title" }, title),
              node ? h("span", { className: "ks-badge", "data-tone": node.state === "current" ? "brand" : node.state === "done" ? "ok" : "muted" }, node.state === "current" ? t(lang, "currentPhase") : node.state === "done" ? t(lang, "done") : t(lang, "pending")) : null,
              h("span", { className: "ks-doc-actions" },
                bindingFeature === detail.feature
                  ? h("button", { className: "ks-button", type: "button", disabled: busy !== "", onClick: () => void unbind() }, t(lang, "unlink"))
                  : h("button", { className: "ks-button", type: "button", disabled: busy !== "", onClick: () => void bindSelected() }, t(lang, "linkThis")))),
            h("div", { className: "ks-doc-body" },
              flash === "" ? null : h("div", { className: "ks-note", role: "status" }, flash),
              state.document === "tasks" ? renderTasks() : state.document ? h(react.Fragment, null, renderDocument(), renderIssues(`${state.document}.md`)) : renderOverview(),
              state.document === "tasks" ? renderIssues("tasks.md") : null));
        };

        const renderCreate = () => h("div", { className: "ks-adv" },
          h("h3", null, t(lang, "newSpec")),
          h("p", { className: "ks-hint", style: { margin: 0, fontSize: 11, color: "var(--dsw-alias-label-tertiary)" } }, t(lang, "createHint")),
          h("label", { className: "ks-field" },
            h("span", { className: "ks-label" }, t(lang, "title")),
            h("input", { className: "ks-input", value: form.title, placeholder: t(lang, "titlePlaceholder"), onChange: (event) => setForm({ ...form, title: event.target.value }) })),
          h("div", { className: "ks-grid" },
            h("label", { className: "ks-field" },
              h("span", { className: "ks-label" }, t(lang, "specType")),
              h("select", { className: "ks-input", value: form.specType, onChange: (event) => setForm({ ...form, specType: event.target.value }) },
                SPEC_TYPES.map((item) => h("option", { key: item.value, value: item.value }, specTypeLabel(item.value, lang))))),
            h("label", { className: "ks-field" },
              h("span", { className: "ks-label" }, t(lang, "workflow")),
              h("select", { className: "ks-input", value: form.workflowType, onChange: (event) => setForm({ ...form, workflowType: event.target.value }) },
                WORKFLOWS.map((item) => h("option", { key: item.value, value: item.value }, workflowLabel(item.value, lang)))))),
          flash === "" ? null : h("div", { className: "ks-error", role: "alert" }, flash),
          h("div", { className: "ks-row" },
            h("button", { className: "ks-button", "data-tone": "primary", type: "button", disabled: busy === "create", onClick: () => void createSpec() }, busy === "create" ? t(lang, "creating") : t(lang, "create")),
            h("button", { className: "ks-button", type: "button", onClick: () => { setShowCreate(false); setFlash(""); } }, t(lang, "cancel"))));

        const renderAdvanced = () => {
          if (settingsForm === null) return null;
          const update = (key, value) => setSettingsForm((current) => ({ ...current, [key]: value }));
          return h("div", { className: "ks-adv" },
            h("h3", null, t(lang, "settingsTitle")),
            h("p", { className: "ks-hint", style: { margin: 0, fontSize: 11, color: "var(--dsw-alias-label-tertiary)" } }, t(lang, "settingsHint")),
            h("label", { className: "ks-field" },
              h("span", { className: "ks-label" }, t(lang, "kiroDir")),
              h("input", { className: "ks-input", value: settingsForm.kiroDir, onChange: (event) => update("kiroDir", event.target.value) })),
            h("div", { className: "ks-grid" },
              h("label", { className: "ks-field" },
                h("span", { className: "ks-label" }, t(lang, "defaultSpecType")),
                h("select", { className: "ks-input", value: settingsForm.defaultSpecType, onChange: (event) => update("defaultSpecType", event.target.value) },
                  SPEC_TYPES.map((item) => h("option", { key: item.value, value: item.value }, specTypeLabel(item.value, lang))))),
              h("label", { className: "ks-field" },
                h("span", { className: "ks-label" }, t(lang, "defaultWorkflow")),
                h("select", { className: "ks-input", value: settingsForm.defaultWorkflow, onChange: (event) => update("defaultWorkflow", event.target.value) },
                  WORKFLOWS.map((item) => h("option", { key: item.value, value: item.value }, workflowLabel(item.value, lang))))) ),
            // The language the panel speaks and the documents are written in.
            // Empty means "follow DSH", which is what almost everyone wants and
            // what makes a switch in Settings take effect everywhere at once.
            h("label", { className: "ks-field" },
              h("span", { className: "ks-label" }, t(lang, "languageLabel")),
              h("select", { className: "ks-input", value: settingsForm.language ?? "", onChange: (event) => update("language", event.target.value) },
                h("option", { value: "" }, t(lang, "languageFollow")),
                h("option", { value: "zh" }, "中文"),
                h("option", { value: "en" }, "English")),
              h("span", { className: "ks-hint", style: { fontSize: 10.5, color: "var(--dsw-alias-label-tertiary)" } }, t(lang, "languageHint"))),
            h("label", { className: "ks-check-row" },
              h("input", { type: "checkbox", checked: settingsForm.promptEnabled, onChange: (event) => update("promptEnabled", event.target.checked) }),
              t(lang, "injectPrompt")),
            h("label", { className: "ks-check-row" },
              h("input", { type: "checkbox", checked: settingsForm.includeActiveSpecs, onChange: (event) => update("includeActiveSpecs", event.target.checked) }),
              t(lang, "listSpecs")),
            h("label", { className: "ks-check-row" },
              h("input", { type: "checkbox", checked: settingsForm.strict, onChange: (event) => update("strict", event.target.checked) }),
              t(lang, "strictMode")),
            h("label", { className: "ks-field" },
              h("span", { className: "ks-label" }, t(lang, "maxListed")),
              h("input", {
                className: "ks-input", type: "number", min: 0, max: 50, value: settingsForm.promptMaxSpecs,
                onChange: (event) => update("promptMaxSpecs", Math.max(0, Math.min(50, Number(event.target.value) || 0))),
              })),
            flash === "" ? null : h("div", { className: "ks-note", role: "status" }, flash),
            h("div", { className: "ks-row" },
              h("button", { className: "ks-button", "data-tone": "primary", type: "button", disabled: busy !== "", onClick: () => void saveAdvanced() }, t(lang, "save")),
              h("button", { className: "ks-button", type: "button", disabled: busy !== "", onClick: () => void resetAdvanced() }, t(lang, "resetDefaults")),
              h("button", { className: "ks-button", type: "button", onClick: () => { setShowAdvanced(false); setFlash(""); } }, t(lang, "back"))));
        };

        const body = showAdvanced
          ? renderAdvanced()
          : showCreate
            ? renderCreate()
            : list === null
              ? h("div", { className: "ks-doc-body" },
                state.error === ""
                  ? h("div", { className: "ks-empty" }, h("span", { className: "ks-spinner" }), h("span", null, t(lang, "readingSpecs")))
                  : h(react.Fragment, null,
                    h("div", { className: "ks-error", role: "alert" }, state.error),
                    h("button", { className: "ks-button", type: "button", onClick: () => void refreshAll() }, t(lang, "retry"))))
              : h("div", { className: "ks-pane-split" },
                h("div", { className: "ks-tree-wrap" }, renderTree()),
                h("div", { className: "ks-detail" }, renderDetail()));

        const menu = menuOpen ? h("div", { className: "ks-menu", role: "menu" },
          h("div", { className: "ks-menu-label" }, bindingFeature === null ? t(lang, "noBinding") : t(lang, "boundTo", { feature: bindingFeature })),
          state.selected === null ? null : h("button", {
            className: "ks-menu-item", type: "button", role: "menuitem", disabled: busy !== "",
            onClick: () => {
              setMenuOpen(false);
              if (bindingFeature === state.selected) void unbind();
              else void bindSelected();
            },
          }, bindingFeature === state.selected ? t(lang, "unlinkSession") : t(lang, "linkThis")),
          h("div", { className: "ks-menu-sep" }),
          h("button", { className: "ks-menu-item", type: "button", role: "menuitem", onClick: openAdvanced }, t(lang, "settingsMenu")),
          h("button", { className: "ks-menu-item", type: "button", role: "menuitem", onClick: openCreate }, t(lang, "newSpecMenu")),
          h("div", { className: "ks-menu-sep" }),
          h("button", { className: "ks-menu-item", type: "button", role: "menuitem", onClick: () => { setMenuOpen(false); void refreshAll(); } }, t(lang, "reread"))) : null;

        const header = h("div", { className: "ks-pane-head" },
          h("div", { className: "ks-head-title" },
            h("strong", null, t(lang, "viewLabel")),
            h("span", { className: "ks-head-sub" }, list ? list.root : t(lang, "kiroCompat"))),
          h("div", { className: "ks-row" },
            h("button", { className: "ks-button", type: "button", disabled: busy !== "", onClick: () => void refreshAll() }, t(lang, "refresh")),
            h("button", { className: "ks-button", type: "button", disabled: busy !== "" || state.selected === null, onClick: () => void checkNow() }, t(lang, "check")),
            h("button", { className: "ks-button", "data-tone": "primary", type: "button", disabled: busy !== "", onClick: openCreate }, t(lang, "createShort")),
            h("div", { className: "ks-menu-wrap" },
              h("button", {
                className: "ks-icon-btn", type: "button", "aria-label": t(lang, "more"),
                "aria-expanded": String(menuOpen), onClick: () => setMenuOpen((current) => !current),
              }, "\u22ef"),
              menu)));

        const banner = state.error !== "" && detail !== null
          ? h("div", { className: "ks-error", role: "alert" }, state.error)
          : null;

        // `data-conversation-composer-overlay` is the host's own contract for a
        // self-scrolling conversation view (the trajectory view sets it too):
        // with it the host pins the view area to `flex:1 1 0; overflow:hidden`
        // and makes the composer an absolute overlay instead of a sticky block
        // in a page that scrolls. Without it the page keeps the chat's scroll
        // position, and this pane's header lands above the viewport.
        return h("div", {
          className: "ks-pane ks-view",
          "aria-label": t(lang, "viewLabel"),
          "data-spec-view": SPEC_VIEW_ID,
          "data-conversation-composer-overlay": "",
        },
          header,
          h("div", { className: "ks-pane-body" }, banner, body));
      }

      /** Fail closed for a stale/retained view occurrence during session switches. */
      function SpecOnlyView(props) {
        const preset = typeof props.useSessions === "function"
          ? props.useSessions((sessions) => sessions.byId[props.sessionId]?.projectionValues?.agentPreset)
          : undefined;
        if (!props.sessionId || preset !== "spec") return null;
        return h(SpecView, props);
      }

      /**
       * The Specs tab label, resolved on every host locale revision.
       *
       * A plain string would freeze the tab in its mount-time language: the
       * host re-resolves a thunk label when the locale switches, which is what
       * makes the whole strip move together. Only the Spec tab's own entry is
       * ours — 对话 and 轨迹 belong to the host.
       */
      function specViewLabel() {
        return t(uiLang(), "viewLabel");
      }

      /**
       * The host's view roster is global, so returning null from the body would
       * leave an empty 规格 tab in every standard-mode session. Register the
       * entry only while the native main-session binding resolves to the Spec
       * preset. Never infer the active session from the last RPC or the first
       * workspace/session.
       */
      function watchSpecView(ctx, rpcCall) {
        const service = (name) => {
          try { return typeof ctx.get === "function" ? ctx.get(name, false) : undefined; }
          catch { return undefined; }
        };
        const sessions = service("sessions")?.list;
        const current = service("uiSession")?.adapter?.current;
        if (!sessions?.getSnapshot || !sessions?.subscribe || !current?.getSnapshot || !current?.subscribe) return () => {};
        let stopped = false;
        let visible = false;
        let disposeView;
        const reconcile = () => {
          if (stopped) return;
          const sessionId = current.getSnapshot()?.key;
          const preset = sessionId ? sessions.getSnapshot()?.byId?.[sessionId]?.projectionValues?.agentPreset : undefined;
          const next = preset === "spec";
          if (next === visible) return;
          visible = next; // Set before registry notifications can re-enter us.
          if (next) {
            disposeView = ctx.slots.inject(VIEW_SLOT, () => ctx.slots.register({
              name: VIEW_SLOT,
              id: SPEC_VIEW_ID,
              order: SPEC_VIEW_ORDER,
              label: specViewLabel,
              inject: (id) => ({ rpcCall, sessionId: id }),
            }, SpecOnlyView));
          } else {
            const dispose = disposeView;
            disposeView = undefined;
            dispose?.();
          }
        };
        const offSession = sessions.subscribe(reconcile);
        const offCurrent = current.subscribe(reconcile);
        reconcile();
        return () => {
          stopped = true;
          offSession();
          offCurrent();
          disposeView?.();
          disposeView = undefined;
        };
      }

      function apply(ctx) {
        ensureStyles();
        const rpcCall = async (method, payload) => {
          const rpc = ctx && ctx.connection && ctx.connection.rpc;
          if (!rpc || typeof rpc.call !== "function") throw new Error(t(uiLang(), "connectionNotReady"));
          const result = await rpc.call(CHANNEL, method, payload || {});
          if (result && result.ok === true) return result.value;
          throw new Error(result && result.error ? result.error.message : t(uiLang(), "requestFailed"));
        };

        // Every service is read softly: a read of an un-injected property throws
        // on the Cordis proxy, so `ctx.get(name, false)` is the only safe way to
        // ask whether the host exposes something at all.
        const service = (name) => {
          try { return typeof ctx.get === "function" ? ctx.get(name, false) : undefined; }
          catch { return undefined; }
        };
        const conversation = () => {
          const ui = service("uiConversation");
          return ui && typeof ui.binding === "function" ? ui : undefined;
        };

        // The host's locale runtime decides the panel's language (Settings →
        // General, then the browser tag). Bind the live face so both the
        // imperative reads and the `useLang` hook follow a switch at once;
        // `locale` is in `inject`, so it is present in a normal Web composition
        // and merely absent where that plugin is not mounted, which the browser
        // tag covers.
        const locale = service("locale");
        if (locale !== undefined && locale !== null && typeof locale.getSnapshot === "function") {
          localeFace = locale;
          if (typeof ctx.effect === "function") {
            ctx.effect(() => () => {
              if (localeFace === locale) localeFace = null;
            }, "dsh-spec: locale face binding");
          }
        }

        // The host's locale runtime decides the panel's language (Settings →
        // General, then the browser tag). Bind the live face so an imperative
        // read and the React hook both follow a switch at once; `locale` is in
        // `inject`, so this is present in a normal Web composition and absent
        // only where the plugin is not mounted — the browser tag covers that.

        /**
         * Switch this session's conversation to the 规格 view.
         *
         * The tab strip is the host's: selecting a view means activating it on
         * the session's conversation binding, not writing to the DOM. A host
         * without `uiConversation`, or one that refuses the switch, reports
         * failure instead of breaking the click handler.
         * @returns {boolean} whether the host accepted the switch.
         */
        const openSpecView = (sessionId) => {
          const ui = conversation();
          if (ui === undefined || !sessionId) return false;
          try {
            const binding = ui.binding(sessionId);
            if (!binding || typeof binding.activate !== "function") return false;
            binding.activate(SPEC_VIEW_ID);
            return true;
          } catch (error) {
            console.warn("[dsh-spec] cannot switch to the Specs view:", error);
            return false;
          }
        };

        // 1. The view entry itself, registered only while the main session runs
        //    the Spec preset. The host's roster is global, so an always-on entry
        //    would leave an empty 规格 tab in every standard-mode session.
        const installVisibility = (scope) => {
          if (typeof scope.effect === "function") scope.effect(() => watchSpecView(scope, rpcCall), "dsh-spec: Spec-only conversation tab");
          else {
            const dispose = watchSpecView(scope, rpcCall);
            scope.on?.("dispose", dispose);
          }
        };
        // Wait for the host's real Session sources; no unconditional tab fallback.
        if (typeof ctx.inject === "function") ctx.inject(["sessions", "uiSession"], installVisibility);
        else installVisibility(ctx);

        // 2. The composer entry stays Spec-preset-only and is the way in: its
        //    chip switches the conversation to the 规格 tab above, and says so
        //    when the host cannot switch views instead of calling into a service
        //    that is not there.
        ctx.slots.inject(COMPOSER_SLOT, () => ctx.slots.register({
          name: COMPOSER_SLOT,
          id: "dsh-spec-composer",
          order: 1,
          inject: (sessionId) => ({ rpcCall, sessionId, openSpecView, canOpenSpecView: () => conversation() !== undefined }),
        }, SpecComposerEntry));

        // 3. The plan dock above the composer, replacing the host's todo dock in
        //    Spec sessions. It renders only when the projection carries a plan,
        //    and the projection only exists inside the Spec preset — so a
        //    standard-mode session never sees it, and there is no stale copy to
        //    hide. `order: -10` puts it above the host's dock (0) even in a
        //    deployment that still mounts `todo_write` somewhere.
        ctx.slots.inject(PLAN_DOCK_SLOT, () => ctx.slots.register({
          name: PLAN_DOCK_SLOT,
          id: "dsh-spec-plan",
          order: -10,
          // The dock's props are the host's (`useProjection`) merged with what
          // `inject` returns: the re-sync needs both the RPC handle and the
          // session it belongs to.
          inject: (sessionId) => ({ rpcCall, sessionId }),
        }, PlanDock));
      }

      exports.apply = apply;
      exports.inject = ["slots", "connection", "locale"];
      exports.internals = {
        CHANNEL, VIEW_SLOT, SPEC_VIEW_ID, SPEC_VIEW_LABEL, SPEC_VIEW_ORDER, COMPOSER_SLOT, PLAN_DOCK_SLOT,
        STRINGS, t, tg, uiLang, specViewLabel, specTypeLabel, workflowLabel, phaseOf2,
        TASK_STATUS, PHASE_META, DOCUMENT_LABEL, SPEC_TYPES, WORKFLOWS,
        createStore, formatDate, progressText, statusTone,
        documentOrder, phaseOf, phaseView,
        parseBlocks, parseInline, renderMarkdown, usePlanResync, splitTaskTitle,
      };
      return module.exports;
    },
  });
})();
