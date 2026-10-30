(function () {
  window.__ModuleLoader__.load({
    id: "@weniatall/dsh-repo-wiki",
    factory: (require) => {
      var module = { exports: {} };
      var exports = module.exports;
      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
      const react = require("react");
      /**
       * Hyperscript alias for `react.createElement`.
       *
       * Every component below is written in the `h(type, props, ...children)`
       * style, so this binding is load-bearing: without it the first render
       * throws `ReferenceError: h is not defined`, and because the host does not
       * isolate slot render errors, one broken entry takes the whole settings
       * dialog (and the sidebar row) down with it.
       */
      const h = react.createElement;

      const CHANNEL = "/dsh-repo-wiki";
      const SETTINGS_SLOT = "settings.section";
      /** Left-sidebar navigation row; `id` doubles as the main-panel key. */
      const PANEL_LIST_SLOT = "sidebar.panellist";
      /** Keyed main-content seat, selected by `layout.selectPanel(id)`. */
      const MAIN_SLOT = "main";
      const COMPOSER_SLOT = "conversation.input.left";
      /** Panel id: the nav row's id and the main seat's key. */
      const PANEL_ID = "repo-wiki";
      const NAV_STYLE_ID = "dsh-repo-wiki-nav-styles";

      const I18N = {
        zh: {
          repoWiki: "Repo Wiki",
          knowledgeCard: "知识卡片",
          projects: "项目",
          backToProjects: "项目",
          refresh: "刷新",
          refreshList: "刷新列表",
          searchPlaceholder: "搜索页面标题或路径…",
          searchCardsPlaceholder: "搜索知识卡片…",
          expandAll: "全部展开",
          collapseAll: "全部折叠",
          collapseSidebar: "收起目录",
          expandSidebar: "展开目录",
          contents: "目录",
          articlesCount: (n) => `${n} 篇`,
          cardsCount: (n) => `${n} 张`,
          matchPages: (n) => `匹配 ${n} 个页面`,
          noMatchPages: "没有匹配的页面。",
          noMatchCards: "未找到匹配的知识卡片。",
          tocEmpty: "目录生成后会显示在这里。",
          emptyPageNotice: "这个页面还没有内容。",
          referencedFiles: (n) => `本文档引用的源文件 (${n})`,
          relatedKnowledgeCards: (n) => `关联知识卡片 (${n})`,
          selectPageHint: "从左侧目录中选择页面查看内容。",
          selectCardHint: "从左侧选择一张知识卡片查看详细内容。",
          loading: "加载中…",
          retry: "重试",
          checkUpdates: "检查更新",
          regenerate: "重新生成",
          pause: "暂停",
          resume: "继续生成",
          cancelGen: "取消生成",
          generateWiki: "生成 Repo Wiki",
          openWiki: "打开 Wiki",
          viewProgress: "查看进度",
          starting: "启动中…",
          docLanguage: "文档语言",
          knowledgeBanner: "Repo Wiki（为您准备）和知识卡片（为 Agent 准备）将基于您的代码库一起生成和更新。",
          noKnowledgeCards: "暂无知识卡片",
          noKnowledgeCardsDesc: "Repo Wiki 生成时会自动从代码库提取概览、架构设计、技术栈、编码规范和配置命令，沉淀为知识卡片。",
          projectWallTitle: "代码库 Wiki 概览",
          projectWallSubtitle: "为每个代码仓库生成与维护结构化架构文档与 AI 知识卡片",
          noProjects: "没有已注册的项目",
          notGenerated: "尚未生成 Wiki",
          updatedAt: (t) => `更新于 ${t}`,
          confirmRegenTitle: "重新生成当前语言的 Wiki？",
          confirmRegenDesc: "当前语言已有的页面和索引会被删除，然后重新生成。请先备份需要保留的内容。",
          confirmCancelTitle: "取消本次生成？",
          confirmCancelDesc: "当前任务会停止，已完成的页面会保留。",
          confirmRegenBtn: "确认重新生成",
          confirmCancelBtn: "确认取消生成",
          returnBtn: "返回",
          branch: "分支",
          categoryAll: "全部",
          categoryOverview: "概览",
          categoryArchitecture: "架构设计",
          categoryTechStack: "技术栈",
          categoryConventions: "编码规范",
          categoryCommands: "配置与命令",
          // Settings
          settingsTitle: "Repo Wiki 设置",
          settingsScope: "设置作用范围",
          settingsScopeDesc: "选择设置作用范围。工作区设置会覆盖全局默认值。",
          globalDefault: "全局默认",
          modelConfig: "生成模型",
          modelConfigDesc: "选择用于生成 Wiki 的大语言模型。留空则使用系统默认模型。",
          provider: "模型提供商",
          model: "模型名称",
          refreshModels: "刷新模型列表",
          useDefaultModel: "改用默认模型",
          usingDefaultModelHint: "当前使用宿主默认模型。",
          needSelectModelHint: "已选提供商，还需要选一个模型。",
          docLangTitle: "生成语言与自动同步",
          docLangDesc: "默认生成的 Wiki 文档语言，以及代码变更时的自动同步策略。",
          docLanguageLabel: "生成语言",
          autoUpdateCheck: "代码库检测到新提交（Commit）时自动增量更新 Wiki",
          scopeGlobal: "全局默认设置",
          scopeWorkspace: "工作区专属设置",
          scopeGlobalHint: "未单独配置的项目将继承此默认配置",
          scopeWorkspaceHint: "覆盖全局配置，仅对当前工作区生效",
          autoUpdateTitle: "代码变更自动增量更新",
          autoUpdateSub: "检测到 Git 新提交时，后台自动增量同步 Wiki 与知识卡片",
          saving: "保存中…",
          unsavedChanges: "有未保存的修改",
          confirmResetWorkspace: "确定恢复当前工作区设置为默认值？",
          confirmResetGlobal: "确定恢复全局默认设置为初始状态？",
          confirmResetBtn: "确认恢复",
          configFileLabel: "配置文件",
          defaultOption: "使用系统默认",
          defaultRouteBadge: "默认路由",
          customRouteBadge: "独立配置",
          llmNotMounted: "LLM 服务尚未就绪",
          resetSuccess: "已恢复为默认设置",
          advancedSettings: "高级设置",
          advancedSettingsHint: "目录深度、单步并发与文件限制等底层参数（通常使用默认值即可）",
          dataDir: "数据存储目录",
          dataDirHint: (dir) => `Wiki 产物保存在 <workspace>/${dir || ".dsh"}/repowiki`,
          maxFiles: "扫描文件数上限",
          maxDepth: "目录最大深度",
          maxCitations: "每页引用文件上限",
          concurrency: "逐页生成并发数",
          timeoutMs: "单步超时时间 (毫秒)",
          autoUpdateDelayMs: "自动同步延时 (毫秒)",
          saveBtn: "保存设置",
          savedMsg: "设置已保存",
          resetBtn: "恢复默认",
          unsavedWarning: "当前设置尚未保存，切换范围会丢弃这次修改。",
          discardAndSwitch: "放弃修改并切换",
          continueEditing: "继续编辑",
          expand: "展开",
          collapse: "收起"
        },
        en: {
          repoWiki: "Repo Wiki",
          knowledgeCard: "Knowledge Cards",
          projects: "Projects",
          backToProjects: "Projects",
          refresh: "Refresh",
          refreshList: "Refresh List",
          searchPlaceholder: "Search pages or paths...",
          searchCardsPlaceholder: "Search knowledge cards...",
          expandAll: "Expand All",
          collapseAll: "Collapse All",
          collapseSidebar: "Collapse",
          expandSidebar: "Expand",
          contents: "Contents",
          articlesCount: (n) => `${n} pages`,
          cardsCount: (n) => `${n} cards`,
          matchPages: (n) => `${n} matched`,
          noMatchPages: "No matching pages found.",
          noMatchCards: "No matching cards found.",
          tocEmpty: "Documentation outline will appear here.",
          emptyPageNotice: "This page does not have content yet.",
          referencedFiles: (n) => `Referenced source files (${n})`,
          relatedKnowledgeCards: (n) => `Related Knowledge Cards (${n})`,
          selectPageHint: "Select a page from the outline to view content.",
          selectCardHint: "Select a card from the left to view details.",
          loading: "Loading...",
          retry: "Retry",
          checkUpdates: "Check Updates",
          regenerate: "Regenerate",
          pause: "Pause",
          resume: "Resume",
          cancelGen: "Cancel",
          generateWiki: "Generate Wiki",
          openWiki: "Open Wiki",
          viewProgress: "View Progress",
          starting: "Starting...",
          docLanguage: "Language",
          knowledgeBanner: "Repo Wiki (for you) and Knowledge Cards (for Agent) are generated and maintained from your codebase.",
          noKnowledgeCards: "No Knowledge Cards",
          noKnowledgeCardsDesc: "When Repo Wiki is generated, architecture, overview, tech stack, conventions, and commands are automatically extracted into Knowledge Cards.",
          projectWallTitle: "Repository Wiki Dashboard",
          projectWallSubtitle: "Generate and maintain architectural documentation and AI knowledge graphs for your codebases",
          noProjects: "No registered workspaces found",
          notGenerated: "Wiki not generated",
          updatedAt: (t) => `Updated at ${t}`,
          confirmRegenTitle: "Regenerate Wiki for current language?",
          confirmRegenDesc: "Existing pages and indexes for this language will be removed and rebuilt. Please backup if needed.",
          confirmCancelTitle: "Cancel generation?",
          confirmCancelDesc: "The running task will stop; completed pages will be kept.",
          confirmRegenBtn: "Confirm Regenerate",
          confirmCancelBtn: "Confirm Cancel",
          returnBtn: "Back",
          branch: "branch",
          categoryAll: "All",
          categoryOverview: "Overview",
          categoryArchitecture: "Architecture",
          categoryTechStack: "Tech Stack",
          categoryConventions: "Conventions",
          categoryCommands: "Config & Commands",
          // Settings
          settingsTitle: "Repo Wiki Settings",
          settingsScope: "Settings Scope",
          settingsScopeDesc: "Choose scope. Workspace settings override global defaults.",
          globalDefault: "Global Default",
          modelConfig: "Model Configuration",
          modelConfigDesc: "Choose the model used to generate Wiki. Leave blank to use system default.",
          provider: "Provider",
          model: "Model",
          refreshModels: "Refresh Models",
          useDefaultModel: "Use Default Model",
          usingDefaultModelHint: "Currently using host default model.",
          needSelectModelHint: "Provider selected; please choose a model.",
          docLangTitle: "Language & Auto-Sync",
          docLangDesc: "Language for generated documentation and incremental synchronization policy.",
          docLanguageLabel: "Language",
          autoUpdateCheck: "Automatically update Wiki incrementally when new commits are detected",
          scopeGlobal: "Global Default Settings",
          scopeWorkspace: "Workspace Specific Settings",
          scopeGlobalHint: "Projects without custom config will inherit these defaults",
          scopeWorkspaceHint: "Overrides global settings, applies only to this workspace",
          autoUpdateTitle: "Auto Incremental Update on Commit",
          autoUpdateSub: "Automatically synchronize Wiki and Knowledge Cards incrementally when new Git commits are detected",
          saving: "Saving...",
          unsavedChanges: "Unsaved changes",
          confirmResetWorkspace: "Reset this workspace settings to defaults?",
          confirmResetGlobal: "Reset global settings to initial defaults?",
          confirmResetBtn: "Confirm Reset",
          configFileLabel: "Config file",
          defaultOption: "Use System Default",
          defaultRouteBadge: "Default Route",
          customRouteBadge: "Custom Config",
          llmNotMounted: "LLM service is not mounted",
          resetSuccess: "Reset to default complete",
          advancedSettings: "Advanced Settings",
          advancedSettingsHint: "Directory depth, concurrency and file limits (default values are recommended)",
          dataDir: "Storage Directory",
          dataDirHint: (dir) => `Wiki outputs saved in <workspace>/${dir || ".dsh"}/repowiki`,
          maxFiles: "Max Scanned Files",
          maxDepth: "Max Directory Depth",
          maxCitations: "Max File Citations per Page",
          concurrency: "Page Generation Concurrency",
          timeoutMs: "Step Timeout (ms)",
          autoUpdateDelayMs: "Auto Update Delay (ms)",
          saveBtn: "Save Settings",
          savedMsg: "Settings saved",
          resetBtn: "Reset to Default",
          unsavedWarning: "You have unsaved changes. Switching workspace will discard them.",
          discardAndSwitch: "Discard & Switch",
          continueEditing: "Continue Editing",
          expand: "Expand",
          collapse: "Collapse"
        }
      };

      function t(key, lang = "zh") {
        const dict = I18N[lang] || I18N.zh;
        return dict[key] || I18N.zh[key] || key;
      }

      function getCategoryLabel(key, lang = "zh") {
        if (lang === "en") {
          const map = {
            all: "All",
            overview: "Overview",
            architecture: "Architecture",
            architecture_design: "Architecture",
            tech_stack: "Tech Stack",
            conventions: "Conventions",
            commands: "Config & Commands",
          };
          return map[key] || key;
        }
        return CATEGORY_NAMES[key] || key;
      }

      const LANGUAGES = [
        { value: "zh", label: "简体中文" },
        { value: "en", label: "English" },
      ];

      /**
       * Status presentation.
       *
       * Mirrors `lib/status.js` so the panel and the host agree; the host's
       * `status` RPC already returns `progress` and a tone, so these tables are
       * only the fallback for a status the client renders before a refresh.
       */
      const STATUS_LABEL = {
        WIKI_INIT: "未生成",
        WAITING: "等待中",
        LINING: "排队中",
        INITIALIZING: "初始化中",
        DIRECTORY_GENERATING: "生成目录中",
        DOCUMENT_GENERATING: "生成文档中",
        PAUSED: "已暂停",
        COMPLETED: "已完成",
        PARTLY_COMPLETED: "部分完成",
        INITIALIZING_FAILED: "初始化失败",
        DIRECTORY_FAILED: "目录生成失败",
        DOCUMENT_FAILED: "文档生成失败",
        NO_FILE_FAILED: "无文件",
        TOO_MANY_FILES_FAILED: "文件过多",
        NOT_SOURCE_CONTROL_FAILED: "非版本控制",
        NO_COMMIT_HISTORY_FAILED: "无提交历史",
        TOO_MANY_WORKSPACE_FAILED: "代码库数量超限",
        INSUFFICIENT_REMAINING_SEATS_FAILED: "体验限额已用完",
        NETWORK_ERROR: "网络错误",
        WIKI_EXIST: "Wiki 已存在",
        WIKI_HAS_COMMIT: "Wiki 有提交",
        WIKI_HAS_CHANGE: "Wiki 有变更",
        WIKI_LOSS_COMMIT: "Wiki 丢失提交",
        WIKI_LOAD_FAIL: "Wiki 加载失败",
        SERVICE_RECOVERING: "服务自动恢复中，请等待或重启",
      };

      const STATUS_TONE = {
        COMPLETED: "ok",
        PARTLY_COMPLETED: "ok",
        WIKI_EXIST: "ok",
        PAUSED: "warn",
        WIKI_HAS_COMMIT: "warn",
        WIKI_HAS_CHANGE: "warn",
        WIKI_LOSS_COMMIT: "warn",
        INITIALIZING_FAILED: "err",
        DIRECTORY_FAILED: "err",
        DOCUMENT_FAILED: "err",
        NO_FILE_FAILED: "err",
        TOO_MANY_FILES_FAILED: "err",
        NOT_SOURCE_CONTROL_FAILED: "err",
        NO_COMMIT_HISTORY_FAILED: "err",
        TOO_MANY_WORKSPACE_FAILED: "err",
        INSUFFICIENT_REMAINING_SEATS_FAILED: "err",
        NETWORK_ERROR: "err",
        WIKI_LOAD_FAIL: "err",
        WAITING: "brand",
        LINING: "brand",
        INITIALIZING: "brand",
        DIRECTORY_GENERATING: "brand",
        DOCUMENT_GENERATING: "brand",
        SERVICE_RECOVERING: "brand",
      };

      const CATALOG_TONE = {
        completed: "ok",
        failed: "err",
        processing: "brand",
        pending: "muted",
        waiting: "muted",
      };

      const css = `
        .rw-root{box-sizing:border-box;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);color-scheme:light dark;container-type:inline-size;overflow:hidden}
        
        /* Top Navigation Header */
        .rw-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base,transparent);flex:none;position:relative;min-height:48px;box-sizing:border-box}
        .rw-head-left{display:flex;align-items:center;gap:8px;min-width:0;flex:0 1 auto}
        .rw-head-center{display:flex;align-items:center;justify-content:center;flex:1 1 auto;min-width:0}
        .rw-head-right{display:flex;align-items:center;gap:8px;flex:0 0 auto}
        .rw-head-divider{width:1px;height:16px;background:var(--dsw-alias-border-l1);margin:0 2px;flex:none}
        .rw-head-repo-title{font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px}
        .rw-head-ref-badge{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 10%,transparent);color:var(--dsw-alias-label-secondary);font-size:11px;font-family:var(--dsw-font-code,monospace);white-space:nowrap;flex:none}
        .rw-back-btn{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;flex:none;transition:all .12s}
        .rw-back-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
        .rw-head-title{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}
        .rw-head-title strong{font-size:14px;font-weight:600}
        .rw-head-sub{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--dsw-font-code,monospace)}
        .rw-head .rw-field{max-width:min(260px,100%)}
        .rw-head .rw-select{max-width:100%}
        
        /* Slim animated progress line on topbar */
        .rw-progress-line{position:absolute;bottom:0;left:0;right:0;height:2.5px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 15%,transparent);overflow:hidden;z-index:10}
        .rw-progress-line-fill{height:100%;background:var(--dsw-alias-brand-primary,#4d6bfe);transition:width .3s ease}
        
        /* In-progress status strip */
        .rw-status-strip{display:flex;align-items:center;gap:8px;padding:6px 16px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 8%,transparent);border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 16%,transparent);font-size:11.5px;color:var(--dsw-alias-label-secondary);flex:none}
        .rw-status-strip-count{margin-left:auto;font-family:var(--dsw-font-code,monospace);font-size:11px;color:var(--dsw-alias-brand-primary,#4d6bfe);font-weight:600}
        
        /* Segmented Navigation Tabs */
        .rw-nav-tabs{display:inline-flex;align-items:center;gap:2px;padding:3px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 8%,transparent);border:1px solid var(--dsw-alias-border-l1);flex:none}
        .rw-nav-tab{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 11px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;cursor:pointer;transition:all .15s}
        .rw-nav-tab:hover{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 10%,transparent);color:var(--dsw-alias-label-primary)}
        .rw-nav-tab[data-active="true"]{background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.08)}
        .rw-tab-count{font-size:10.5px;padding:1px 5px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 14%,transparent);color:var(--dsw-alias-brand-primary,#4d6bfe);font-weight:600}
        
        /* Buttons & Badges */
        .rw-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:30px;padding:0 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;flex:none;transition:all .12s}
        .rw-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
        .rw-btn:disabled{opacity:.45;cursor:default}
        .rw-btn[data-tone="primary"]{border-color:transparent;background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff}
        .rw-btn[data-tone="primary"]:hover:not(:disabled){opacity:.9}
        .rw-btn[data-tone="danger"]{border-color:var(--dsw-alias-state-error-primary,#d84848);color:var(--dsw-alias-state-error-primary,#d84848)}
        .rw-btn:focus-visible,.rw-tree-row:focus-visible,.rw-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:2px}
        .rw-icon-btn{display:inline-grid;place-items:center;width:28px;height:28px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer;flex:none;transition:all .12s}
        .rw-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
        
        .rw-status{display:flex;flex-direction:column;gap:7px;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}
        .rw-status-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
        .rw-badge{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;border-radius:999px;font-size:10.5px;font-weight:600;white-space:nowrap;flex:none}
        .rw-badge[data-tone="ok"]{color:var(--dsw-alias-state-success-primary,#22c55e);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 12%,transparent)}
        .rw-badge[data-tone="warn"]{color:var(--dsw-alias-state-warning-primary,#d98e00);background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d98e00) 13%,transparent)}
        .rw-badge[data-tone="err"]{color:var(--dsw-alias-state-error-primary,#d84848);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 12%,transparent)}
        .rw-badge[data-tone="muted"]{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-secondary) 10%,transparent)}
        .rw-badge[data-tone="brand"]{color:var(--dsw-alias-brand-primary,#4d6bfe);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 12%,transparent)}
        .rw-desc{font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary)}
        .rw-bar{height:5px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 14%,transparent);overflow:hidden}
        .rw-bar-fill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary,#4d6bfe);transition:width .25s}
        
        /* Main Body & Split Columns */
        .rw-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden}
        .rw-split{display:grid;grid-template-columns:280px minmax(0,1fr);min-height:0;flex:1 1 auto;overflow:hidden}
        .rw-split[data-tree-collapsed="true"]{grid-template-columns:48px minmax(0,1fr)}
        
        /* Sidebar (Directory Tree) */
        .rw-sidebar{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-base,transparent) 98%,transparent)}
        .rw-sidebar-head{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);min-height:38px;box-sizing:border-box}
        .rw-sidebar-title-row{display:flex;align-items:center;gap:6px;flex:1;min-width:0}
        .rw-sidebar-title-row strong{font-size:12.5px;color:var(--dsw-alias-label-primary)}
        .rw-sidebar-count{font-size:10.5px;padding:1px 6px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 12%,transparent);color:var(--dsw-alias-label-secondary);font-weight:500;margin-right:auto}
        .rw-tree-actions{display:flex;align-items:center;gap:3px;flex:none}
        .rw-tool-btn{display:inline-flex;align-items:center;justify-content:center;height:24px;padding:0 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer;white-space:nowrap;transition:all .12s}
        .rw-tool-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
        .rw-search{display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;position:relative}
        .rw-input{box-sizing:border-box;flex:1 1 auto;min-width:0;height:30px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:0 8px;outline:none;transition:border-color .15s}
        .rw-input:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
        .rw-search-status{padding:3px 12px 6px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
        
        .rw-tree-wrap{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:6px 4px}
        .rw-tree{display:flex;flex-direction:column;gap:2px}
        .rw-tree-row{display:flex;align-items:center;gap:6px;width:100%;padding:6px 8px;border:none;border-radius:6px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background-color .1s;box-sizing:border-box;border-left:3px solid transparent}
        .rw-tree-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
        .rw-tree-row[data-active="true"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 10%,transparent);border-left-color:var(--dsw-alias-brand-primary,#4d6bfe)}
        .rw-tree-row[data-active="true"] .rw-tree-title{color:var(--dsw-alias-brand-primary,#4d6bfe);font-weight:600}
        .rw-caret{display:inline-block;flex:none;width:11px;font-size:9px;line-height:1;color:var(--dsw-alias-label-tertiary);transition:transform .12s;text-align:center}
        .rw-caret[data-open="true"]{transform:rotate(90deg)}
        .rw-caret[data-leaf="true"]{visibility:hidden}
        .rw-tree-main{display:flex;align-items:center;gap:6px;min-width:0;flex:1 1 auto}
        .rw-tree-title{font-size:12.5px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1 1 auto;min-width:0}
        .rw-tree-icon{flex:none;color:var(--dsw-alias-label-tertiary)}
        .rw-tree-row[data-active="true"] .rw-tree-icon{color:var(--dsw-alias-brand-primary,#4d6bfe)}
        .rw-tree-meta{display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--dsw-alias-label-tertiary);margin-left:auto;flex:none}
        .rw-file-count{font-size:10px;padding:0 4px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 10%,transparent);color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-code,monospace)}
        .rw-dot{width:6px;height:6px;border-radius:999px;flex:none;background:var(--dsw-alias-label-tertiary)}
        .rw-dot[data-tone="ok"]{background:var(--dsw-alias-state-success-primary,#22c55e)}
        .rw-dot[data-tone="err"]{background:var(--dsw-alias-state-error-primary,#d84848)}
        .rw-dot[data-tone="brand"]{background:var(--dsw-alias-brand-primary,#4d6bfe)}
        .rw-match{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 25%,transparent);color:inherit;border-radius:2px;padding:0 1px}
        
        /* Detail Content View */
        .rw-detail{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base,transparent)}
        .rw-detail-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 24px;border-bottom:1px solid var(--dsw-alias-border-l1);min-height:42px;box-sizing:border-box;flex:none}
        .rw-breadcrumbs{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-tertiary);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .rw-breadcrumbs strong{color:var(--dsw-alias-label-primary);font-weight:600}
        .rw-crumb-sep{color:var(--dsw-alias-label-tertiary);opacity:.5}
        .rw-detail-title{flex:1 1 auto;min-width:0;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .rw-detail-path{font-size:10.5px;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-code,monospace);padding:2px 7px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 8%,transparent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px;flex:none}
        .rw-content{flex:1 1 auto;min-height:0;overflow-y:auto;padding:24px 36px}
        .rw-content-inner{max-width:860px;margin:0 auto}
        
        /* Markdown & Document Elements */
        .rw-md{font-size:14px;line-height:1.75;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;font-family:inherit}
        .rw-md h1,.rw-md h2,.rw-md h3{font-weight:600;line-height:1.35;color:var(--dsw-alias-label-primary)}
        .rw-md h1{font-size:18px;margin:22px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--dsw-alias-border-l1)}
        .rw-md h2{font-size:15px;margin:18px 0 8px;padding-bottom:5px;border-bottom:1px solid var(--dsw-alias-border-l1)}
        .rw-md h3{font-size:13.5px;margin:14px 0 6px}
        .rw-md code{font-family:var(--dsw-font-code,monospace);font-size:11.5px;padding:2px 5px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 12%,transparent)}
        .rw-md pre{margin:10px 0;padding:12px 14px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 8%,transparent);border:1px solid var(--dsw-alias-border-l1);overflow:auto}
        .rw-md pre code{padding:0;background:transparent;font-size:11.5px;line-height:1.6}
        .rw-md ul,.rw-md ol{margin:8px 0;padding-left:22px}
        .rw-md li{margin:3px 0}
        .rw-md a{color:var(--dsw-alias-brand-primary,#4d6bfe);text-decoration:none}
        .rw-md a:hover{text-decoration:underline}
        
        .rw-cite{margin:0 0 18px;padding:10px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 4%,transparent);font-size:11.5px;line-height:18px}
        .rw-cite-title{display:flex;align-items:center;gap:6px;margin-bottom:6px;font-weight:600;color:var(--dsw-alias-label-primary);font-size:11.5px}
        .rw-cite-pills{display:flex;flex-wrap:wrap;gap:6px}
        .rw-cite-pill{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 10%,transparent);font-family:var(--dsw-font-code,monospace);font-size:11px;color:var(--dsw-alias-label-secondary)}
        .rw-cite strong{display:block;margin-bottom:4px;font-weight:600;color:var(--dsw-alias-label-primary)}
        .rw-cite ul{margin:0;padding-left:16px}
        
        .rw-table-wrap{margin:14px 0;overflow-x:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px}
        .rw-table{width:100%;border-collapse:collapse;font-size:12.5px;line-height:1.5;text-align:left}
        .rw-table th{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 8%,transparent);color:var(--dsw-alias-label-primary);font-weight:600;padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);white-space:nowrap}
        .rw-table td{padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);vertical-align:top}
        .rw-table tr:last-child td{border-bottom:none}
        .rw-table tr:hover td{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 4%,transparent)}
        
        .rw-mermaid{margin:12px 0;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 4%,transparent);overflow:auto}
        .rw-mermaid-label{display:block;margin-bottom:6px;font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);font-weight:600}
        .rw-mermaid-svg{display:flex;justify-content:center;white-space:normal}
        .rw-mermaid-svg svg{max-width:100%;height:auto}
        .rw-mermaid-src{white-space:pre;overflow:auto;margin:0;font-family:var(--dsw-font-code,monospace);font-size:11px;color:var(--dsw-alias-label-secondary)}
        
        /* Knowledge Cards */
        .rw-kc-banner{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 16px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 8%,transparent);color:var(--dsw-alias-label-secondary);font-size:12px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 15%,transparent);flex:none}
        .rw-kc-banner-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .rw-kc-categories{display:flex;gap:4px;padding:8px 10px;overflow-x:auto;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}
        .rw-kc-category-btn{display:inline-flex;align-items:center;height:24px;padding:0 9px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer;white-space:nowrap;transition:all .12s}
        .rw-kc-category-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
        .rw-kc-category-btn[data-active="true"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 15%,transparent);border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-brand-primary,#4d6bfe);font-weight:600}
        .rw-kc-list{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow-y:auto}
        .rw-kc-card{position:relative;display:flex;flex-direction:column;gap:4px;padding:10px 14px;border:none;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer;text-align:left;background:transparent;color:inherit;font:inherit;border-left:3px solid transparent;transition:background-color .1s,border-left-color .15s;width:100%;box-sizing:border-box}
        .rw-kc-card:hover{background:var(--dsw-alias-interactive-bg-hover)}
        .rw-kc-card[data-active="true"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 8%,transparent);border-left-color:var(--dsw-alias-brand-primary,#4d6bfe)}
        .rw-kc-card-top{display:flex;align-items:center;justify-content:space-between;gap:6px}
        .rw-kc-card-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .rw-kc-badge{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:4px;font-size:10.5px;font-weight:500;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 12%,transparent);color:var(--dsw-alias-brand-primary,#4d6bfe);white-space:nowrap;flex:none}
        .rw-kc-card-module{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .rw-kc-card-desc{font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
        .rw-kc-linked{margin-top:24px;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l1)}
        .rw-kc-linked-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-bottom:8px}
        .rw-kc-linked-list{display:flex;flex-wrap:wrap;gap:8px}
        .rw-kc-linked-item{display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-primary);transition:all .12s}
        .rw-kc-linked-item:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-brand-primary,#4d6bfe)}
        
        /* Empty / Alert / Setup Views */
        .rw-empty{display:flex;flex-direction:column;align-items:flex-start;gap:9px;padding:24px 16px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:19px}
        .rw-empty strong{color:var(--dsw-alias-label-primary);font-weight:600;font-size:14px}
        .rw-setup{box-sizing:border-box;width:calc(100% - 32px);max-width:680px;gap:16px;margin:24px auto;padding:24px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px}
        .rw-setup-details{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 14px;margin:0;font-size:12px}
        .rw-setup-details dt{color:var(--dsw-alias-label-tertiary)}
        .rw-setup-details dd{margin:0;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
        .rw-confirm{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid var(--dsw-alias-state-warning-primary,#d98e00);border-radius:8px;font-size:12px;line-height:18px}
        .rw-progress-label{font-variant-numeric:tabular-nums}
        .rw-note{padding:8px 12px;border-radius:8px;font-size:11.5px;line-height:17px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 7%,transparent);color:var(--dsw-alias-label-secondary)}
        .rw-error{padding:8px 12px;border-radius:8px;font-size:11.5px;line-height:17px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 11%,transparent);color:var(--dsw-alias-state-error-primary,#d84848)}
        .rw-spinner{display:inline-block;width:11px;height:11px;border:2px solid color-mix(in srgb,var(--dsw-alias-label-tertiary) 40%,transparent);border-top-color:var(--dsw-alias-brand-primary,#4d6bfe);border-radius:50%;animation:rw-spin .8s linear infinite;vertical-align:-2px;margin-right:5px}
        @keyframes rw-spin{to{transform:rotate(360deg)}}
        .rw-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
        .rw-field{display:flex;flex-direction:column;gap:4px;min-width:0}
        .rw-label{font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary)}
        .rw-hint{font-size:10.5px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
        .rw-select{box-sizing:border-box;height:32px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background-color:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:0 30px 0 10px;cursor:pointer;appearance:none;-webkit-appearance:none;-moz-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888888' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");background-repeat:no-repeat;background-position:calc(100% - 10px) center;background-size:12px 12px;outline:none;transition:border-color .15s ease,box-shadow .15s ease}
        .rw-select:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
        .rw-select:focus-visible{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 20%,transparent)}
        .rw-select:disabled{opacity:.5;cursor:not-allowed}
        
        
        /* Settings Modern Layout */
        .rw-settings{display:flex;flex-direction:column;gap:14px;width:100%;max-width:760px;margin:0 auto;padding:20px;font-family:var(--dsw-font-family);color:var(--dsw-alias-label-primary);box-sizing:border-box}
        .rw-settings-head{display:flex;flex-direction:column;gap:4px;padding-bottom:12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
        .rw-settings-head h2{margin:0;font-size:19px;font-weight:650;color:var(--dsw-alias-label-primary)}
        .rw-settings-head p{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
        
        .rw-scope-card{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 3%,transparent);flex-wrap:wrap}
        .rw-scope-info{display:flex;flex-direction:column;gap:2px}
        .rw-scope-title{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary)}
        .rw-scope-desc{font-size:11px;color:var(--dsw-alias-label-tertiary)}
        
        .rw-set-card{display:flex;flex-direction:column;gap:11px;padding:15px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-base,transparent);transition:border-color .15s}
        .rw-set-card:hover{border-color:var(--dsw-alias-border-l2)}
        .rw-set-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
        .rw-set-card-title-group{display:flex;align-items:center;gap:8px}
        .rw-set-card-title-group h3{margin:0;font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary)}
        .rw-set-card-desc{margin:0;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary)}
        
        .rw-switch-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 12px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 4%,transparent);cursor:pointer;user-select:none;transition:background-color .12s}
        .rw-switch-row:hover{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 7%,transparent)}
        .rw-switch-label-group{display:flex;flex-direction:column;gap:2px}
        .rw-switch-title{font-size:12.5px;font-weight:550;color:var(--dsw-alias-label-primary)}
        .rw-switch-sub{font-size:11px;color:var(--dsw-alias-label-tertiary)}
        .rw-switch{position:relative;display:inline-block;width:38px;height:22px;flex:none}
        .rw-switch input{opacity:0;width:0;height:0}
        .rw-switch-slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 25%,transparent);transition:.2s;border-radius:22px}
        .rw-switch-slider:before{position:absolute;content:"";height:16px;width:16px;left:3px;bottom:3px;background:white;transition:.2s;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.15)}
        .rw-switch input:checked + .rw-switch-slider{background:var(--dsw-alias-brand-primary,#4d6bfe)}
        .rw-switch input:checked + .rw-switch-slider:before{transform:translateX(16px)}
        
        .rw-settings-footer{display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:14px 0 4px;margin-top:8px;border-top:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap}
        .rw-settings-file{font-size:11px;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-code,monospace);display:inline-flex;align-items:center;gap:5px}
        .rw-settings-actions{display:flex;align-items:center;gap:8px;margin-left:auto}

        
        /* Project Dashboard (Wall) */
        .rw-projects{box-sizing:border-box;display:flex;flex-direction:column;gap:18px;width:100%;max-width:1080px;margin:0 auto;padding:24px 28px}
        .rw-projects-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
        .rw-projects-title{display:flex;flex-direction:column;gap:3px}
        .rw-projects-title strong{font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary)}
        .rw-projects-title span{font-size:12px;color:var(--dsw-alias-label-tertiary)}
        .rw-projects-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}
        .rw-project-card{display:flex;flex-direction:column;gap:10px;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-base,transparent);cursor:pointer;text-align:left;font:inherit;color:inherit;width:100%;box-sizing:border-box;transition:all .15s ease}
        .rw-project-card:hover{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 4px 14px rgba(0,0,0,.06);background:var(--dsw-alias-interactive-bg-hover)}
        .rw-project-card[data-active="true"]{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 45%,transparent)}
        .rw-project-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:2px}
        .rw-project-card-head{display:flex;align-items:center;gap:10px;width:100%}
        .rw-project-icon-box{display:grid;place-items:center;width:34px;height:34px;flex:none;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 12%,transparent);color:var(--dsw-alias-brand-primary,#4d6bfe)}
        .rw-project-name-wrap{display:flex;align-items:center;gap:8px;min-width:0;flex:1 1 auto}
        .rw-project-name-text{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .rw-project-path-text{font-size:11px;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-code,monospace);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .rw-project-card-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px}
        .rw-project-icon{display:grid;place-items:center;width:36px;height:36px;flex:none;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 10%,transparent);color:var(--dsw-alias-brand-primary,#4d6bfe);font-size:13px;font-weight:700}
        .rw-project-main{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 auto}
        .rw-project-name{display:flex;align-items:center;gap:8px;min-width:0;font-size:13.5px;font-weight:600}
        .rw-project-name>span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .rw-project-path{font-size:10.5px;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-code,monospace);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .rw-project-side{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:none}
        .rw-project-hint{font-size:11px;color:var(--dsw-alias-label-tertiary)}
        .rw-back{display:inline-flex;align-items:center;gap:5px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;cursor:pointer;padding:4px 8px 4px 0;border-radius:7px;flex:none}
        .rw-back:hover{color:var(--dsw-alias-label-primary)}
        
        .rw-card{display:flex;flex-direction:column;gap:9px;padding:13px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-base,transparent)}
        .rw-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
        .rw-check-row{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
        .rw-num{box-sizing:border-box;width:100%;height:32px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:0 10px;outline:none;transition:border-color .15s,box-shadow .15s}
        .rw-num:focus-visible{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 20%,transparent)}
        .rw-composer{box-sizing:border-box;display:inline-grid;place-items:center;width:28px;height:28px;padding:0;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;line-height:1;transition:color .12s,background-color .12s,transform .1s}
        .rw-composer:hover{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-primary)}
        .rw-composer:active{transform:scale(.95)}
        .rw-composer[data-busy="true"]{color:var(--dsw-alias-brand-primary,#4d6bfe)}
        .rw-composer svg{display:block}
        button:has([data-settings-nav-label="dsh-repo-wiki"]) > svg:first-child{display:none !important}
        .rw-nav-label{display:inline-flex;align-items:center;gap:8px}
        .rw-nav-label svg{flex:none}
        
        @media(max-width:680px){
          .rw-split{display:flex;flex-direction:column}
          .rw-sidebar{max-height:38%;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}
          .rw-grid{grid-template-columns:1fr}
          .rw-content{padding:12px 14px}
          .rw-head{padding:8px 10px;flex-wrap:wrap}
          .rw-projects{padding:16px 14px}
          .rw-projects-grid{grid-template-columns:1fr}
        }
        @container (max-width:680px){
          .rw-split,.rw-split[data-tree-collapsed="true"]{display:flex;flex-direction:column}
          .rw-sidebar{max-height:38%;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}
          .rw-content{padding:12px 14px}
          .rw-head{padding:8px 10px;flex-wrap:wrap}
          .rw-projects{padding:16px 14px}
          .rw-projects-grid{grid-template-columns:1fr}
        }
        @media(prefers-reduced-motion:reduce){.rw-spinner{animation-duration:2s}.rw-bar-fill{transition:none}}
      `;

      function ensureStyles() {
        if (typeof document === "undefined") return;
        if (document.getElementById(NAV_STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = NAV_STYLE_ID;
        style.textContent = css;
        (document.head || document.body).appendChild(style);
      }

      /* ----------------------------------------------------------------- *
       * Pure helpers (exported for tests)
       * ----------------------------------------------------------------- */

      /** Flatten a nested catalog list into rows with depth, honouring collapse. */
      function flattenTree(catalogs, expanded) {
        const byParent = new Map();
        const ids = new Set(catalogs.map((catalog) => String(catalog.catalog_id)));
        for (const catalog of catalogs) {
          const parent = catalog.parent_id === null || catalog.parent_id === undefined ? "" : String(catalog.parent_id);
          // A completed page can arrive before its parent while generation is
          // running; keep it readable until the parent appears.
          const key = parent && ids.has(parent) && parent !== String(catalog.catalog_id) ? parent : "";
          if (!byParent.has(key)) byParent.set(key, []);
          byParent.get(key).push(catalog);
        }
        for (const list of byParent.values()) list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const rows = [];
        const walk = (parentKey, depth) => {
          for (const catalog of byParent.get(parentKey) ?? []) {
            const hasChildren = (byParent.get(String(catalog.catalog_id)) ?? []).length > 0;
            rows.push({ catalog, depth, hasChildren });
            const open = expanded === null || expanded === undefined ? true : expanded[String(catalog.catalog_id)] !== false;
            if (hasChildren && open) walk(String(catalog.catalog_id), depth + 1);
          }
        };
        walk("", 0);
        return rows;
      }

      function catalogMatches(catalog, query) {
        const needle = String(query ?? "").trim().toLowerCase();
        return needle === "" || `${catalog.title ?? ""}\n${catalog.path ?? ""}`.toLowerCase().includes(needle);
      }

      function changedSettings(values, baseline) {
        return Object.fromEntries(Object.entries(values ?? {}).filter(([key, value]) => !Object.is(value, baseline?.[key])));
      }

      /** Filter catalogs by a case-insensitive substring of title or path. */
      function filterTree(catalogs, query) {
        const needle = String(query ?? "").trim().toLowerCase();
        if (needle === "") return catalogs;
        const byId = new Map(catalogs.map((catalog) => [String(catalog.catalog_id), catalog]));
        const included = new Set();
        for (const catalog of catalogs) {
          if (!catalogMatches(catalog, needle)) continue;
          let current = catalog;
          while (current && !included.has(String(current.catalog_id))) {
            included.add(String(current.catalog_id));
            current = byId.get(String(current.parent_id ?? ""));
          }
        }
        return catalogs.filter((catalog) => included.has(String(catalog.catalog_id)));
      }

      /** The status label, falling back to the raw value. */
      function statusLabel(status) {
        return STATUS_LABEL[status] ?? String(status ?? "");
      }

      /** The status tone, falling back to muted. */
      function statusTone(status) {
        return STATUS_TONE[status] ?? "muted";
      }

      /** Whether the panel should show a progress bar. */
      function showsProgress(status) {
        return (
          status === "WAITING" ||
          status === "LINING" ||
          status === "INITIALIZING" ||
          status === "DIRECTORY_GENERATING" ||
          status === "DOCUMENT_GENERATING"
        );
      }

      /** Whether the status is a terminal failure worth a retry button. */
      function isRetryable(status) {
        return (
          status === "INITIALIZING_FAILED" ||
          status === "DIRECTORY_FAILED" ||
          status === "DOCUMENT_FAILED" ||
          status === "NETWORK_ERROR" ||
          status === "PARTLY_COMPLETED"
        );
      }

      /**
       * Whether the status means a wiki is readable.
       *
       * Qoder's `Bgo` set: the six states that keep the tree visible — paused
       * runs and load failures are deliberately not in it.
       */
      function hasContent(status) {
        return (
          status === "COMPLETED" ||
          status === "PARTLY_COMPLETED" ||
          status === "WIKI_EXIST" ||
          status === "WIKI_HAS_COMMIT" ||
          status === "WIKI_HAS_CHANGE" ||
          status === "WIKI_LOSS_COMMIT"
        );
      }

      /**
       * Qoder's `Hgo` action mapping: which button a status offers.
       * `retry` reruns only the unfinished pages; `synchronize` imports
       * on-disk edits; infrastructure failures retry the whole run.
       */
      function statusAction(status) {
        switch (status) {
          case "PARTLY_COMPLETED":
            return { label: "重试失败页面", method: "retry" };
          case "WIKI_HAS_COMMIT":
            return { label: "增量更新", method: "update" };
          case "WIKI_HAS_CHANGE":
            return { label: "导入", method: "synchronize", payload: { direction: "file_to_db" } };
          case "COMPLETED":
          case "WIKI_EXIST":
          case "WIKI_LOAD_FAIL":
          case "WIKI_LOSS_COMMIT":
            return { label: "重新生成", method: "regenerate" };
          case "INITIALIZING_FAILED":
          case "DIRECTORY_FAILED":
          case "DOCUMENT_FAILED":
          case "NETWORK_ERROR":
            return { label: "重试", method: "regenerate" };
          default:
            return null;
        }
      }

      /**
       * Qoder's `Ngo` precondition view: a `wiki.pre.*` server error code at
       * WIKI_INIT replaces the welcome copy with a dedicated title.
       */
      function serverErrorView(status, details) {
        if (status !== "WIKI_INIT" && status !== "" && status !== undefined && status !== null) return null;
        const code = details && typeof details.server_error_code === "string" ? details.server_error_code : "";
        if (!code.startsWith("wiki.pre.")) return null;
        return code === "wiki.pre.indexing"
          ? { title: "Indexing in Progress", desc: "Indexing, please wait" }
          : { title: code, desc: "" };
      }

      /** The tab title, showing a status dot when something needs attention. */
      function tabTitle(state) {
        if (!state) return "Repo Wiki";
        if (state.busy) return "Repo Wiki · 生成中";
        if (state.error) return "Repo Wiki · 出错";
        if (state.status === "WIKI_HAS_COMMIT") return "Repo Wiki · 待更新";
        if (state.status === "WIKI_HAS_CHANGE") return "Repo Wiki · 待导入";
        return "Repo Wiki";
      }

      /** Format an ISO timestamp for display, or return an empty string. */
      function formatDate(value) {
        if (typeof value !== "string" || value === "") return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        const pad = (n) => String(n).padStart(2, "0");
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
      }

      /* ----------------------------------------------------------------- *
       * Markdown rendering
       * ----------------------------------------------------------------- */

      /**
       * Split a page into its `<cite>` block, its table of contents, and the body.
       *
       * The generator writes a fixed prologue; rendering it as structure (a
       * callout and a real list) rather than as literal Markdown is what makes
       * the citation useful instead of noisy.
       * @param {string} markdown
       * @returns {{ title: string, references: string[], body: string }}
       */
      function splitPage(markdown) {
        const text = String(markdown ?? "");
        const titleMatch = /^#\s+(.+?)\s*$/mu.exec(text);
        const title = titleMatch === null ? "" : titleMatch[1].trim();
        let rest = titleMatch === null ? text : text.slice(titleMatch.index + titleMatch[0].length);
        const references = [];
        const citeMatch = /<cite>([\s\S]*?)<\/cite>/u.exec(rest);
        if (citeMatch !== null) {
          const linkRegex = /\[([^\]]*)\]\(([^)]*)\)/gu;
          let link;
          while ((link = linkRegex.exec(citeMatch[1])) !== null) {
            const href = link[2].startsWith("file://") ? link[2].slice("file://".length) : link[2];
            references.push({ label: link[1], path: href });
          }
          rest = rest.replace(citeMatch[0], "");
        }
        rest = rest.replace(/^\s*##\s+目录\s*\n(?:\s*\d+\.\s*\[[^\]]*\]\([^)]*\)\s*\n)*/u, "");
        return { title, references, body: rest.trim() };
      }

      function splitTableRow(row) {
        let trimmed = String(row ?? "").trim();
        if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
        if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
        return trimmed.split("|").map((cell) => cell.trim());
      }

      function isTableDelimiter(row) {
        if (!row.includes("-")) return false;
        const cells = splitTableRow(row);
        if (cells.length === 0) return false;
        return cells.every((cell) => /^:?-+:?$/u.test(cell));
      }

      // Handcrafted Vector SVG Icons
      function IconRepoWiki({ size = 16, className = "" } = {}) {
        return h("svg", {
          width: size, height: size, viewBox: "0 0 24 24", fill: "none",
          stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round",
          className, "aria-hidden": "true"
        },
        h("path", { d: "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" }),
        h("path", { d: "M8 7h8" }),
        h("path", { d: "M8 11h5" }),
        h("path", { d: "M10 16l2-2 2 2" }));
      }

      function IconBook({ size = 14, className = "" } = {}) {
        return h("svg", {
          width: size, height: size, viewBox: "0 0 24 24", fill: "none",
          stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
          className, "aria-hidden": "true"
        },
        h("path", { d: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" }),
        h("path", { d: "M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" }));
      }

      function IconCards({ size = 14, className = "" } = {}) {
        return h("svg", {
          width: size, height: size, viewBox: "0 0 24 24", fill: "none",
          stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
          className, "aria-hidden": "true"
        },
        h("rect", { x: "2", y: "6", width: "15", height: "13", rx: "2" }),
        h("path", { d: "M7 3h12a2 2 0 0 1 2 2v11" }));
      }

      function IconRepo({ size = 15, className = "" } = {}) {
        return h("svg", {
          width: size, height: size, viewBox: "0 0 24 24", fill: "none",
          stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
          className, "aria-hidden": "true"
        },
        h("path", { d: "M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2Z" }),
        h("circle", { cx: "12", cy: "13", r: "2" }));
      }

      function IconBranch({ size = 11, className = "" } = {}) {
        return h("svg", {
          width: size, height: size, viewBox: "0 0 24 24", fill: "none",
          stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
          className, "aria-hidden": "true"
        },
        h("line", { x1: "6", y1: "3", x2: "6", y2: "15" }),
        h("circle", { cx: "18", cy: "6", r: "3" }),
        h("circle", { cx: "6", cy: "18", r: "3" }),
        h("path", { d: "M18 9a9 9 0 0 1-9 9" }));
      }

      function IconChevronLeft({ size = 13, className = "" } = {}) {
        return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": "true" },
          h("polyline", { points: "15 18 9 12 15 6" }));
      }

      function IconChevronRight({ size = 13, className = "" } = {}) {
        return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": "true" },
          h("polyline", { points: "9 18 15 12 9 6" }));
      }

      function IconChevronDown({ size = 13, className = "" } = {}) {
        return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": "true" },
          h("polyline", { points: "6 9 12 15 18 9" }));
      }

      function IconChevronUp({ size = 13, className = "" } = {}) {
        return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": "true" },
          h("polyline", { points: "18 15 12 9 6 15" }));
      }

      function IconRefresh({ size = 13, className = "" } = {}) {
        return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": "true" },
          h("path", { d: "M21 12a9 9 0 1 1-9-9c2.52 0 4.85.83 6.72 2.24L21 8" }),
          h("polyline", { points: "21 3 21 8 16 8" }));
      }

      function IconSearch({ size = 12, className = "" } = {}) {
        return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": "true" },
          h("circle", { cx: "11", cy: "11", r: "8" }),
          h("line", { x1: "21", y1: "21", x2: "16.65", y2: "16.65" }));
      }

      function IconClose({ size = 12, className = "" } = {}) {
        return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": "true" },
          h("line", { x1: "18", y1: "6", x2: "6", y2: "18" }),
          h("line", { x1: "6", y1: "6", x2: "18", y2: "18" }));
      }

      function IconBulb({ size = 14, className = "" } = {}) {
        return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": "true" },
          h("path", { d: "M9 18h6M10 22h4" }),
          h("path", { d: "M12 2a7 7 0 0 0-7 7c0 2.5 1.5 4.5 3 6h8c1.5-1.5 3-3.5 3-6a7 7 0 0 0-7-7z" }));
      }

      function IconLink({ size = 12, className = "" } = {}) {
        return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": "true" },
          h("path", { d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" }),
          h("path", { d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" }));
      }

      function IconGlobe({ size = 13, className = "" } = {}) {
        return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": "true" },
          h("circle", { cx: "12", cy: "12", r: "10" }),
          h("line", { x1: "2", y1: "12", x2: "22", y2: "12" }),
          h("path", { d: "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" }));
      }

      function IconSliders({ size = 13, className = "" } = {}) {
        return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": "true" },
          h("line", { x1: "4", y1: "21", x2: "4", y2: "14" }),
          h("line", { x1: "4", y1: "10", x2: "4", y2: "3" }),
          h("line", { x1: "12", y1: "21", x2: "12", y2: "12" }),
          h("line", { x1: "12", y1: "8", x2: "12", y2: "3" }),
          h("line", { x1: "20", y1: "21", x2: "20", y2: "16" }),
          h("line", { x1: "20", y1: "12", x2: "20", y2: "3" }),
          h("line", { x1: "1", y1: "14", x2: "7", y2: "14" }),
          h("line", { x1: "9", y1: "8", x2: "15", y2: "8" }),
          h("line", { x1: "17", y1: "16", x2: "23", y2: "16" }));
      }

      function IconSidebarToggle({ size = 13, className = "" } = {}) {
        return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": "true" },
          h("rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }),
          h("line", { x1: "9", y1: "3", x2: "9", y2: "21" }));
      }

      function IconFolder({ open = false, size = 14, className = "rw-tree-icon" } = {}) {
        return h("svg", {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          className,
          "aria-hidden": "true",
        },
        open
          ? [h("path", { key: "p1", d: "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" }),
             h("path", { key: "p2", d: "M2 10h20" })]
          : h("path", { d: "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" }));
      }

      function IconFile({ size = 13, className = "rw-tree-icon" } = {}) {
        return h("svg", {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          className,
          "aria-hidden": "true",
        },
        h("path", { d: "M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" }),
        h("polyline", { points: "14 2 14 8 20 8" }),
        h("line", { x1: "8", y1: "13", x2: "16", y2: "13" }));
      }

      function IconSparkles({ size = 15, className = "" } = {}) {
        return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": "true" },
          h("path", { d: "M12 3c.5 3 2.5 5 5.5 5.5-3 .5-5 2.5-5.5 5.5-.5-3-2.5-5-5.5-5.5 3-.5 5-2.5 5.5-5.5z" }),
          h("path", { d: "M19 16c.3 1.5 1.2 2.5 2.7 2.7-1.5.3-2.4 1.2-2.7 2.7-.3-1.5-1.2-2.4-2.7-2.7 1.5-.3 2.4-1.2 2.7-2.7z" }),
          h("path", { d: "M5 16c.3 1.2 1 2 2.2 2.2-1.2.3-1.9 1-2.2 2.2-.3-1.2-1-1.9-2.2-2.2 1.2-.3 1.9-1 2.2-2.2z" }));
      }

      function IconSave({ size = 13, className = "" } = {}) {
        return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": "true" },
          h("path", { d: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" }),
          h("polyline", { points: "17 21 17 13 7 13 7 21" }),
          h("polyline", { points: "7 3 7 8 15 8" }));
      }

      function IconReset({ size = 13, className = "" } = {}) {
        return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": "true" },
          h("polyline", { points: "1 4 1 10 7 10" }),
          h("path", { d: "M3.51 15a9 9 0 1 0 2.13-9.36L1 10" }));
      }

      function IconCheck({ size = 13, className = "" } = {}) {
        return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": "true" },
          h("polyline", { points: "20 6 9 17 4 12" }));
      }

      function IconClock({ size = 12, className = "" } = {}) {
        return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": "true" },
          h("circle", { cx: "12", cy: "12", r: "10" }),
          h("polyline", { points: "12 6 12 12 16 14" }));
      }

      function IconCode({ size = 13, className = "" } = {}) {
        return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": "true" },
          h("polyline", { points: "16 18 22 12 16 6" }),
          h("polyline", { points: "8 6 2 12 8 18" }));
      }

      function IconExpandAll({ size = 12, className = "" } = {}) {
        return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": "true" },
          h("polyline", { points: "7 8 12 3 17 8" }),
          h("polyline", { points: "7 16 12 21 17 16" }));
      }

      function IconCollapseAll({ size = 12, className = "" } = {}) {
        return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": "true" },
          h("polyline", { points: "7 3 12 8 17 3" }),
          h("polyline", { points: "7 21 12 16 17 21" }));
      }

      function highlightMatch(text, query, h, nextKey) {
        const needle = String(query ?? "").trim();
        if (!needle) return text;
        const lowerText = text.toLowerCase();
        const lowerNeedle = needle.toLowerCase();
        const idx = lowerText.indexOf(lowerNeedle);
        if (idx === -1) return text;
        return [
          text.slice(0, idx),
          h("mark", { key: nextKey ? nextKey() : "m-0", className: "rw-match" }, text.slice(idx, idx + needle.length)),
          text.slice(idx + needle.length),
        ];
      }

      const KNOWLEDGE_CATEGORIES = [
        { key: "all", label: "全部" },
        { key: "overview", label: "概览" },
        { key: "architecture_design", label: "架构设计" },
        { key: "tech_stack", label: "技术栈" },
        { key: "coding_conventions", label: "编码规范" },
        { key: "unique_setup_and_commands", label: "配置与命令" },
      ];

      const CATEGORY_NAMES = {
        overview: "概览",
        architecture_design: "架构设计",
        tech_stack: "技术栈",
        coding_conventions: "编码规范",
        unique_setup_and_commands: "配置与命令",
      };

      /**
       * Render a Markdown subset to React nodes.
       *
       * Not a full CommonMark implementation: it covers what the generator
       * emits (headings, lists, fenced code, inline code, links, bold) and
       * treats mermaid fences as a labelled diagram block rather than pretending
       * to draw them. Deliberately no `dangerouslySetInnerHTML` — the content is
       * model-written, so it must never become raw HTML in the page.
       * @param {string} markdown
       * @param {object} h react createElement
       * @returns {object[]}
       */
      function renderMarkdown(markdown, h) {
        const lines = String(markdown ?? "").split(/\r?\n/u);
        const nodes = [];
        let index = 0;
        let key = 0;
        const nextKey = () => `md-${key++}`;

        while (index < lines.length) {
          const line = lines[index];
          if (line.trim() === "") {
            index += 1;
            continue;
          }
          const fence = /^```\s*([A-Za-z0-9_+-]*)\s*$/u.exec(line);
          if (fence !== null) {
            const language = fence[1];
            const body = [];
            index += 1;
            while (index < lines.length && !/^```\s*$/u.test(lines[index])) {
              body.push(lines[index]);
              index += 1;
            }
            index += 1;
            const text = body.join("\n");
            if (language === "mermaid") {
              nodes.push(h(MermaidBlock, { key: nextKey(), source: text }));
            } else {
              nodes.push(h("pre", { key: nextKey() }, h("code", null, text)));
            }
            continue;
          }
          const heading = /^(#{1,6})\s+(.*)$/u.exec(line);
          if (heading !== null) {
            const level = Math.min(heading[1].length + 1, 6);
            nodes.push(h(`h${level}`, { key: nextKey() }, inline(heading[2], h, nextKey)));
            index += 1;
            continue;
          }
          const bullet = /^\s*[-*+]\s+(.*)$/u.exec(line);
          const ordered = /^\s*\d+[.)]\s+(.*)$/u.exec(line);
          if (bullet !== null || ordered !== null) {
            const items = [];
            const test = bullet !== null ? /^\s*[-*+]\s+(.*)$/u : /^\s*\d+[.)]\s+(.*)$/u;
            while (index < lines.length) {
              const match = test.exec(lines[index]);
              if (match === null) break;
              items.push(h("li", { key: nextKey() }, inline(match[1], h, nextKey)));
              index += 1;
            }
            nodes.push(h(bullet !== null ? "ul" : "ol", { key: nextKey() }, items));
            continue;
          }
          if (line.includes("|") && index + 1 < lines.length && isTableDelimiter(lines[index + 1])) {
            const headerCells = splitTableRow(line);
            const delimCells = splitTableRow(lines[index + 1]);
            const alignments = delimCells.map((d) => {
              if (d.startsWith(":") && d.endsWith(":")) return "center";
              if (d.endsWith(":")) return "right";
              if (d.startsWith(":")) return "left";
              return null;
            });
            index += 2;
            const bodyRows = [];
            while (index < lines.length && lines[index].trim() !== "" && lines[index].includes("|")) {
              bodyRows.push(splitTableRow(lines[index]));
              index += 1;
            }
            nodes.push(h("div", { key: nextKey(), className: "rw-table-wrap" },
              h("table", { className: "rw-table" },
                h("thead", null,
                  h("tr", null, headerCells.map((th, i) =>
                    h("th", { key: `th-${i}`, style: alignments[i] ? { textAlign: alignments[i] } : undefined },
                      inline(th, h, nextKey)
                    )
                  ))
                ),
                h("tbody", null,
                  bodyRows.map((rowCells, rIdx) =>
                    h("tr", { key: `tr-${rIdx}` },
                      headerCells.map((_, cIdx) =>
                        h("td", { key: `td-${cIdx}`, style: alignments[cIdx] ? { textAlign: alignments[cIdx] } : undefined },
                          inline(rowCells[cIdx] ?? "", h, nextKey)
                        )
                      )
                    )
                  )
                )
              )
            ));
            continue;
          }
          const paragraph = [];
          while (index < lines.length && lines[index].trim() !== "" && !/^```/u.test(lines[index])) {
            if (/^#{1,6}\s+/u.test(lines[index]) || /^\s*[-*+]\s+/u.test(lines[index]) || /^\s*\d+[.)]\s+/u.test(lines[index])) break;
            if (lines[index].includes("|") && index + 1 < lines.length && isTableDelimiter(lines[index + 1])) break;
            paragraph.push(lines[index]);
            index += 1;
          }
          if (paragraph.length > 0) {
            nodes.push(h("p", { key: nextKey() }, inline(paragraph.join(" "), h, nextKey)));
          } else {
            index += 1;
          }
        }
        return nodes;
      }

      /** Inline Markdown: code, bold, links. */
      function inline(text, h, nextKey) {
        const parts = [];
        const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/gu;
        let last = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
          if (match.index > last) parts.push(text.slice(last, match.index));
          const token = match[0];
          if (token.startsWith("`")) {
            parts.push(h("code", { key: nextKey() }, token.slice(1, -1)));
          } else if (token.startsWith("**")) {
            parts.push(h("strong", { key: nextKey() }, token.slice(2, -2)));
          } else {
            const link = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(token);
            parts.push(
              h("a", {
                key: nextKey(),
                href: link[2],
                target: "_blank",
                rel: "noreferrer",
              }, link[1]),
            );
          }
          last = match.index + token.length;
        }
        if (last < text.length) parts.push(text.slice(last));
        return parts;
      }

      /* ----------------------------------------------------------------- *
       * Mermaid
       * ----------------------------------------------------------------- */

      /**
       * Load mermaid once, lazily.
       *
       * The bundle is vendored no further than this `import()` — the plugin
       * cannot serve its own static files, so the module comes from jsDelivr.
       * A failed load leaves the code block on screen, which is the honest
       * degradation for a wiki viewed on a machine with no model access
       * anyway.
       */
      let mermaidModule = null;
      async function loadMermaid() {
        if (mermaidModule !== null) return mermaidModule;
        try {
          const mod = await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");
          mod.default.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme: "default",
          });
          mermaidModule = mod.default;
        } catch {
          mermaidModule = null;
        }
        return mermaidModule;
      }

      let mermaidSerial = 0;

      /**
       * One ` ```mermaid ` fence, rendered as an SVG diagram.
       *
       * The block starts life as a labelled code block; the effect swaps it
       * for the rendered SVG once the library resolves. On any failure —
       * offline, a parse error, a diagram type the model invented — the
       * source stays, so the page never loses the information.
       */
      function MermaidBlock({ source }) {
        const host = react.useRef(null);
        const [failed, setFailed] = react.useState(false);
        react.useEffect(() => {
          let active = true;
          let cancelled = false;
          void (async () => {
            const mermaid = await loadMermaid();
            if (!active || cancelled || mermaid === null) {
              if (active && !cancelled) setFailed(true);
              return;
            }
            try {
              const id = `rw-mmd-${++mermaidSerial}`;
              const { svg } = await mermaid.render(id, source);
              if (!active || cancelled || host.current === null) return;
              host.current.innerHTML = svg;
            } catch {
              if (active && !cancelled) setFailed(true);
            }
          })();
          return () => {
            active = false;
            cancelled = true;
          };
        }, [source]);
        return h("div", { className: "rw-mermaid", "data-rendered": String(!failed && host.current?.firstChild !== undefined) },
          h("div", { ref: host, className: "rw-mermaid-svg" }),
          failed ? h("pre", { className: "rw-mermaid-src" }, source) : null);
      }

      /* ----------------------------------------------------------------- *
       * Workspace resolution
       * ----------------------------------------------------------------- */

      /**
       * Enumerate workspaces through RPC instead of conditionally calling a
       * host store hook. Every panel request names its selected workspace.
       */
      const NO_WORKSPACE_HINT = "请先在左侧添加工作区，再选择要查看的仓库。";

      function modelRouteLabel(values, models) {
        values = values ?? {};
        const provider = String(values.provider ?? "").trim();
        const model = String(values.model ?? "").trim();
        if (provider && model) return `${provider} / ${model}`;
        if (provider || model) return "模型配置不完整，请在设置中检查";
        if (models?.llmAvailable === false) return "模型服务不可用，请在设置中检查";
        if (models?.defaultRoute) return `${models.defaultRoute.provider} / ${models.defaultRoute.model}（宿主默认）`;
        return "宿主默认模型（请在设置中确认）";
      }

      /* ----------------------------------------------------------------- *
       * Main panel
       * ----------------------------------------------------------------- */

      function RepoWikiPanel(props) {
        const rpcCall = props.rpcCall;
        const [initialSession] = react.useState(() => props.peekPanelSession ? props.peekPanelSession() : "");
        const [state, setState] = react.useState({
          workspaces: null, workspace: "", language: "", loading: false,
          error: "", data: null, catalogs: [], selected: null, content: "",
          contentLoading: false, contentError: "", contentRevision: 0,
          query: "", expanded: {}, treeCollapsed: false, busy: "", pending: {},
          flash: "", confirm: "", models: null,
          activeTab: "repoWiki",
          knowledgeCards: null,
          knowledgeLoading: false,
          knowledgeError: "",
          knowledgeCategory: "all",
          knowledgeQuery: "",
          selectedCard: null,
          selectedCardDetail: null,
          cardDetailLoading: false,
          cardDetailError: "",
          dismissKnowledgeBanner: false,
        });
        const scope = react.useRef({ workspace: "", language: "" });
        const requestNumber = react.useRef(0);
        const activeRefresh = react.useRef("");
        const pendingRuns = react.useRef(new Set());

        const loadWorkspaces = react.useCallback(async () => {
          try {
            const result = await rpcCall("workspaces", {
              includeStatus: true,
              ...(initialSession ? { sessionId: initialSession } : {}),
            });
            const workspaces = Array.isArray(result.items) ? result.items : [];
            // A composer entry deep-links into its session's project; the nav
            // row shows the project wall instead.
            const linked = initialSession && result.sessionWorkspace
              && workspaces.some((item) => item.path === result.sessionWorkspace)
              ? result.sessionWorkspace : "";
            setState((current) => ({ ...current, workspaces, error: "" }));
            if (linked && scope.current.workspace === "") {
              scope.current = { workspace: linked, language: "" };
              setState((current) => ({ ...current, workspace: linked, loading: true }));
            }
          } catch (error) {
            setState((current) => ({ ...current, workspaces: [], error: String(error?.message ?? error) }));
          }
        }, [rpcCall, initialSession]);

        /** Merge a fresh status into the project wall card for `workspace`. */
        const applySummary = react.useCallback((workspace, language, status, catalogs) => {
          setState((current) => {
            if (current.workspaces === null) return current;
            const workspaces = current.workspaces.map((item) => item.path === workspace
              ? { ...item, language, status: status ? { ...status, total_catalogs: catalogs.length } : item.status }
              : item);
            return { ...current, workspaces };
          });
        }, []);

        const refresh = react.useCallback(async (workspace, language, options) => {
          if (!workspace) return;
          const refreshKey = `${workspace}\u0000${language}`;
          if (activeRefresh.current === refreshKey) return;
          activeRefresh.current = refreshKey;
          const request = ++requestNumber.current;
          try {
            // `catalogs` answers {language,status,catalogs} — much cheaper than
            // `describe`, and it is enough to drive this view and the wall card.
            const result = await rpcCall("catalogs", { workspace, ...(language ? { language } : {}) });
            const resolvedLanguage = result.language || language || "zh";
            applySummary(workspace, resolvedLanguage, result.status, result.catalogs ?? []);
            if (request !== requestNumber.current || scope.current.workspace !== workspace || scope.current.language !== language) return;
            scope.current = { workspace, language: resolvedLanguage };
            setState((current) => {
              const catalogs = result.catalogs ?? [];
              const selected = options?.keepSelection && current.selected
                ? catalogs.find((item) => item.catalog_id === current.selected.catalog_id) ?? null : null;
              const justFinished = showsProgress(current.data?.status?.status) && !showsProgress(result.status?.status);
              if (justFinished && current.activeTab === "knowledgeCard") {
                void loadKnowledgeCards(workspace, resolvedLanguage);
              }
              return {
                ...current, loading: false, error: "",
                data: { status: result.status, language: resolvedLanguage },
                language: resolvedLanguage, catalogs, selected,
                content: selected ? current.content : "", contentError: selected ? current.contentError : "",
                contentRevision: current.contentRevision + (selected && justFinished ? 1 : 0),
                flash: result.status?.status === "PAUSED" ? "" : current.flash,
              };
            });
          } catch (error) {
            if (request !== requestNumber.current || scope.current.workspace !== workspace || scope.current.language !== language) return;
            setState((current) => ({ ...current, loading: false, error: String(error?.message ?? error) }));
          } finally {
            if (activeRefresh.current === refreshKey) activeRefresh.current = "";
          }
        }, [rpcCall, applySummary]);

        react.useEffect(() => {
          props.clearPanelSession?.(initialSession);
          void loadWorkspaces();
          void rpcCall("models", {}).then((models) => setState((current) => ({ ...current, models }))).catch(() => {});
        }, [loadWorkspaces, rpcCall]);

        react.useEffect(() => {
          if (state.workspace) void refresh(state.workspace, state.language);
        }, [state.workspace, state.language, refresh]);

        const loadKnowledgeCards = react.useCallback(async (workspace, language) => {
          if (!workspace) return;
          setState((current) => ({ ...current, knowledgeLoading: true, knowledgeError: "" }));
          try {
            const result = await rpcCall("listKnowledge", { workspace, language: language || "zh" });
            const hits = Array.isArray(result?.hits) ? result.hits : [];
            const cards = hits.map((h) => h.card).filter(Boolean);
            setState((current) => {
              const selected = current.selectedCard
                ? cards.find((c) => c.id === current.selectedCard.id) ?? cards[0] ?? null
                : cards[0] ?? null;
              return {
                ...current,
                knowledgeCards: cards,
                knowledgeLoading: false,
                selectedCard: selected,
              };
            });
          } catch (error) {
            setState((current) => ({
              ...current,
              knowledgeLoading: false,
              knowledgeError: String(error?.message ?? error),
            }));
          }
        }, [rpcCall]);

        const loadCardDetail = react.useCallback(async (workspace, language, cardId) => {
          if (!cardId || !workspace) return;
          setState((current) => ({ ...current, cardDetailLoading: true, cardDetailError: "" }));
          try {
            const result = await rpcCall("getKnowledge", {
              workspace,
              language: language || "zh",
              id: cardId,
            });
            setState((current) => ({
              ...current,
              selectedCardDetail: result,
              cardDetailLoading: false,
            }));
          } catch (error) {
            setState((current) => ({
              ...current,
              cardDetailLoading: false,
              cardDetailError: String(error?.message ?? error),
            }));
          }
        }, [rpcCall]);

        react.useEffect(() => {
          if (state.activeTab === "knowledgeCard" && state.workspace && state.knowledgeCards === null && !state.knowledgeLoading) {
            void loadKnowledgeCards(state.workspace, state.language);
          }
        }, [state.activeTab, state.workspace, state.language, state.knowledgeCards, state.knowledgeLoading, loadKnowledgeCards]);

        react.useEffect(() => {
          if (state.selectedCard?.id && state.workspace) {
            void loadCardDetail(state.workspace, state.language, state.selectedCard.id);
          }
        }, [state.selectedCard?.id, state.workspace, state.language, loadCardDetail]);

        // Open the first readable page automatically and refresh its content
        // independently of status polling. Late responses cannot overwrite a
        // newer page or another workspace.
        react.useEffect(() => {
          if (!state.workspace || state.loading || state.selected || state.catalogs.length === 0) return;
          const first = flattenTree(state.catalogs, null)[0]?.catalog;
          if (!first) return;
          setState((current) => current.workspace === state.workspace && current.language === state.language && !current.selected
            ? { ...current, selected: first, content: "", contentError: "" } : current);
        }, [state.workspace, state.language, state.loading, state.selected, state.catalogs]);

        react.useEffect(() => {
          const catalogId = state.selected?.catalog_id;
          const workspace = state.workspace;
          const language = state.language;
          if (!workspace || !language || !catalogId) return undefined;
          let active = true;
          setState((current) => ({ ...current, contentLoading: true, contentError: "" }));
          void rpcCall("content", { workspace, language, catalogId }).then((result) => {
            if (!active) return;
            setState((current) => current.workspace !== workspace || current.language !== language || current.selected?.catalog_id !== catalogId
              ? current : { ...current, content: result.content ?? "", contentLoading: false });
          }).catch((error) => {
            if (!active) return;
            setState((current) => current.workspace !== workspace || current.language !== language || current.selected?.catalog_id !== catalogId
              ? current : { ...current, contentLoading: false, contentError: String(error?.message ?? error) });
          });
          return () => { active = false; };
        }, [rpcCall, state.workspace, state.language, state.selected?.catalog_id, state.contentRevision]);

        const statusCode = state.data?.status?.status ?? "WIKI_INIT";
        const running = showsProgress(statusCode);
        const launching = Boolean(state.pending[state.workspace]);
        react.useEffect(() => {
          if (!state.workspace || (!running && !launching)) return undefined;
          const timer = setInterval(() => void refresh(state.workspace, state.language, { keepSelection: true }), 2000);
          return () => clearInterval(timer);
        }, [state.workspace, state.language, running, launching, refresh]);

        const changeWorkspace = (workspace) => {
          requestNumber.current += 1;
          scope.current = { workspace, language: "" };
          setState((current) => ({
            ...current, workspace, language: "", loading: Boolean(workspace),
            data: null, catalogs: [], selected: null, content: "", contentError: "",
            query: "", expanded: {}, treeCollapsed: false, error: "", flash: "", confirm: "",
            activeTab: "repoWiki", knowledgeCards: null, knowledgeLoading: false, knowledgeError: "",
            knowledgeQuery: "", selectedCard: null, selectedCardDetail: null, cardDetailLoading: false,
            cardDetailError: "",
          }));
        };
        const backToProjects = () => {
          requestNumber.current += 1;
          scope.current = { workspace: "", language: "" };
          setState((current) => ({
            ...current, workspace: "", language: "", loading: false,
            data: null, catalogs: [], selected: null, content: "", contentError: "",
            query: "", expanded: {}, treeCollapsed: false, error: "", flash: "", confirm: "",
            activeTab: "repoWiki", knowledgeCards: null, knowledgeLoading: false, knowledgeError: "",
            knowledgeQuery: "", selectedCard: null, selectedCardDetail: null, cardDetailLoading: false,
            cardDetailError: "",
          }));
          void loadWorkspaces();
        };
        /** Start generation straight from a project card, then open the project. */
        const startFor = async (workspace) => {
          if (pendingRuns.current.has(workspace)) return;
          pendingRuns.current.add(workspace);
          setState((current) => ({ ...current, pending: { ...current.pending, [workspace]: true }, error: "" }));
          try {
            const result = await rpcCall("start", { workspace });
            const language = typeof result?.language === "string" ? result.language : "";
            const summary = await rpcCall("status", { workspace, ...(language ? { language } : {}) }).catch(() => null);
            if (summary) applySummary(workspace, summary.language ?? language, summary.status, summary.catalogs ?? []);
            changeWorkspace(workspace);
          } catch (error) {
            setState((current) => ({ ...current, error: String(error?.message ?? error) }));
          } finally {
            pendingRuns.current.delete(workspace);
            setState((current) => {
              const pending = { ...current.pending };
              delete pending[workspace];
              return { ...current, pending };
            });
          }
        };
        const changeLanguage = (language) => {
          requestNumber.current += 1;
          scope.current = { workspace: state.workspace, language };
          setState((current) => ({ ...current, language, loading: true, data: null, catalogs: [],
            selected: null, content: "", contentError: "", query: "", expanded: {}, treeCollapsed: false, error: "", flash: "", confirm: "" }));
        };
        const select = (catalog) => {
          setState((current) => ({ ...current, selected: catalog, contentLoading: true, content: "", contentError: "",
            contentRevision: current.contentRevision + (current.selected?.catalog_id === catalog.catalog_id ? 1 : 0) }));
        };
        const perform = async (method, payload, longRunning) => {
          const workspace = state.workspace;
          const language = state.language;
          if (!workspace || (longRunning && pendingRuns.current.has(workspace))) return;
          if (longRunning) pendingRuns.current.add(workspace);
          setState((current) => ({ ...current, busy: longRunning ? current.busy : method, error: "", flash: "", confirm: "",
            pending: longRunning ? { ...current.pending, [workspace]: true } : current.pending }));
          try {
            const result = await rpcCall(method, { ...(payload ?? {}), workspace, language });
            if (scope.current.workspace === workspace && scope.current.language === language) {
              if (method === "pause" && result?.paused) {
                setState((current) => ({ ...current, flash: "暂停请求已发送，当前模型调用结束后暂停。" }));
              }
              if (method === "cancel" && result?.cancelled) {
                setState((current) => ({ ...current, flash: "取消请求已发送，已完成的页面会保留。" }));
              }
              await refresh(workspace, language, { keepSelection: true });
              if (longRunning) setState((current) => current.workspace === workspace && current.language === language
                ? { ...current, contentRevision: current.contentRevision + 1 } : current);
            }
          } catch (error) {
            if (scope.current.workspace === workspace && scope.current.language === language) {
              setState((current) => ({ ...current, error: String(error?.message ?? error) }));
            }
          } finally {
            if (longRunning) pendingRuns.current.delete(workspace);
            setState((current) => {
              const pending = { ...current.pending };
              if (longRunning) delete pending[workspace];
              return { ...current, pending, busy: longRunning ? current.busy : "" };
            });
          }
        };
        const runAction = (action) => {
          if (action.method === "regenerate") {
            setState((current) => ({ ...current, confirm: "regenerate" }));
          } else {
            void perform(action.method, action.payload, ["start", "update", "resume", "retry"].includes(action.method));
          }
        };

        const data = state.data;
        const status = data?.status;
        const details = status?.details ?? {};
        const busy = Boolean(state.busy);
        const lockLanguage = running || launching || busy;
        const lang = state.language || "zh";

        const languageSelect = data ? h("label", { className: "rw-field", style: { margin: 0, marginRight: "6px", flexDirection: "row", alignItems: "center", gap: "6px" } },
          h(IconGlobe, null),
          h("select", { className: "rw-select", value: state.language, disabled: lockLanguage,
            "aria-label": t("docLanguage", lang),
            onChange: (event) => changeLanguage(event.target.value) },
            LANGUAGES.map((item) => h("option", { key: item.value, value: item.value }, item.label)))) : null;

        const projectTitle = state.workspace
          ? (state.workspaces ?? []).find((item) => item.path === state.workspace)?.title ?? state.workspace
          : "";

        const actions = [];
        if (running) {
          actions.push(h("button", { key: "pause", className: "rw-btn", type: "button", disabled: busy,
            onClick: () => void perform("pause", null, false) }, t("pause", lang)));
          actions.push(h("button", { key: "cancel", className: "rw-btn", "data-tone": "danger", type: "button", disabled: busy,
            onClick: () => setState((current) => ({ ...current, confirm: "cancel" })) }, t("cancelGen", lang)));
        } else if (!launching && statusCode === "PAUSED") {
          actions.push(h("button", { key: "resume", className: "rw-btn", "data-tone": "primary", type: "button", disabled: busy,
            onClick: () => void perform("resume", null, true) }, t("resume", lang)));
        } else if (!launching) {
          const action = statusCode === "DIRECTORY_FAILED" && state.catalogs.length === 0
            ? { label: t("retry", lang), method: "start" }
            : (statusAction(statusCode)
              ?? (/FAILED$/.test(statusCode) || statusCode === "NETWORK_ERROR" ? { label: t("retry", lang), method: "start" } : null));
          if (statusCode === "COMPLETED") actions.push(h("button", { key: "update", className: "rw-btn", "data-tone": "primary", type: "button", disabled: busy,
            onClick: () => void perform("update", null, true) }, t("checkUpdates", lang)));
          if (action) {
            const actionLabel = action.method === "regenerate" ? t("regenerate", lang) : (action.method === "start" ? t("retry", lang) : action.label);
            actions.push(h("button", { key: action.method, className: "rw-btn", "data-tone": action.method === "regenerate" ? undefined : "primary", type: "button", disabled: busy,
              onClick: () => runAction(action) }, actionLabel));
          }
        }

        const progress = Math.max(0, Math.min(100, Number(status?.progress) || 0));

        // Top Navigation Header
        const header = h("div", { className: "rw-head" },
          // Left: back button, repo title, branch, status badge
          h("div", { className: "rw-head-left" },
            state.workspace ? h("button", { className: "rw-back-btn", type: "button", "aria-label": t("backToProjects", lang),
              onClick: backToProjects }, h(IconChevronLeft), t("projects", lang)) : null,
            state.workspace ? h("div", { className: "rw-head-divider" }) : null,
            h("strong", { className: "rw-head-repo-title", title: state.workspace ? projectTitle : t("repoWiki", lang) },
              state.workspace ? projectTitle : t("repoWiki", lang)),
            state.workspace && details.branch ? h("span", { className: "rw-head-ref-badge", title: `${t("branch", lang)}: ${details.branch}` },
              h(IconBranch), details.branch) : null,
            state.workspace && data ? h("span", { className: "rw-badge", "data-tone": statusTone(statusCode) },
              launching && !running && statusCode === "WIKI_INIT" ? t("starting", lang)
                : running ? `${statusLabel(statusCode, lang)} ${progress}%`
                : statusLabel(statusCode, lang)) : null),

          // Center: Segmented Navigation Tabs
          (state.workspace && data && (state.catalogs.length > 0 || (state.knowledgeCards && state.knowledgeCards.length > 0)))
            ? h("div", { className: "rw-head-center" },
                h("div", { className: "rw-nav-tabs" },
                  h("button", {
                    className: "rw-nav-tab",
                    "data-active": String(state.activeTab === "repoWiki"),
                    type: "button",
                    onClick: () => setState((current) => ({ ...current, activeTab: "repoWiki" }))
                  }, h(IconBook), t("repoWiki", lang), state.catalogs.length ? h("span", { className: "rw-tab-count" }, String(state.catalogs.length)) : null),
                  h("button", {
                    className: "rw-nav-tab",
                    "data-active": String(state.activeTab === "knowledgeCard"),
                    type: "button",
                    onClick: () => {
                      setState((current) => ({ ...current, activeTab: "knowledgeCard" }));
                      if (state.knowledgeCards === null) void loadKnowledgeCards(state.workspace, state.language);
                    }
                  }, h(IconCards), t("knowledgeCard", lang), state.knowledgeCards ? h("span", { className: "rw-tab-count" }, String(state.knowledgeCards.length)) : null)))
            : h("div", { className: "rw-head-center" }),

          // Right: Language, Actions, Refresh
          h("div", { className: "rw-head-right" },
            languageSelect,
            actions,
            state.workspace ? h("button", {
              className: "rw-icon-btn",
              type: "button",
              title: t("refresh", lang),
              "aria-label": t("refresh", lang),
              disabled: busy,
              onClick: () => {
                setState((current) => ({ ...current, contentRevision: current.contentRevision + 1 }));
                void refresh(state.workspace, state.language, { keepSelection: true });
                if (state.activeTab === "knowledgeCard") void loadKnowledgeCards(state.workspace, state.language);
              }
            }, h(IconRefresh)) : h("button", { className: "rw-btn", type: "button", onClick: () => void loadWorkspaces() }, h(IconRefresh), " ", t("refreshList", lang))),

          // Progress line along bottom edge of topBar
          running ? h("div", { className: "rw-progress-line", role: "progressbar", "aria-label": "Progress", "aria-valuenow": progress },
            h("div", { className: "rw-progress-line-fill", style: { width: `${progress}%` } })) : null
        );

        // Status banner when in-flight
        const statusArea = running ? h("div", { className: "rw-status-strip", "aria-live": "polite" },
          h("span", { className: "rw-spinner" }),
          h("span", null, launching && !running && statusCode === "WIKI_INIT" ? t("starting", lang) : statusDescription(statusCode, details, lang)),
          details.total_catalogs ? h("span", { className: "rw-status-strip-count" }, `${details.completed_catalogs ?? 0} / ${details.total_catalogs}`) : null) : null;

        const serverError = (statusTone(statusCode) === "err" && (details.server_error_hint || details.server_error_code || status?.error))
          ? h("div", { className: "rw-error", role: "alert", style: { margin: "8px 16px 0" } },
              details.server_error_hint || status?.error || `Error: ${details.server_error_code}`)
          : null;

        const confirmation = state.confirm ? h("div", { className: "rw-confirm", role: "alert", style: { margin: "10px 16px 0" } },
          h("strong", null, state.confirm === "regenerate" ? t("confirmRegenTitle", lang) : t("confirmCancelTitle", lang)),
          h("span", null, state.confirm === "regenerate" ? t("confirmRegenDesc", lang) : t("confirmCancelDesc", lang)),
          h("div", { className: "rw-row" },
            h("button", { className: "rw-btn", "data-tone": "danger", type: "button", onClick: () => void perform(state.confirm === "regenerate" ? "regenerate" : "cancel", null, state.confirm === "regenerate") },
              state.confirm === "regenerate" ? t("confirmRegenBtn", lang) : t("confirmCancelBtn", lang)),
            h("button", { className: "rw-btn", type: "button", onClick: () => setState((current) => ({ ...current, confirm: "" })) }, t("returnBtn", lang)))) : null;

        /** Primary action a project card offers for its wiki status. */
        const cardAction = (item) => {
          if (state.pending[item.path]) return { label: t("starting", lang), disabled: true };
          const code = item.status?.status ?? "";
          if (item.status === null) return null;
          if (showsProgress(code)) return { label: t("viewProgress", lang), tone: "primary" };
          if (code === "PAUSED") return { label: t("resume", lang), tone: "primary" };
          if (hasContent(code) || code === "WIKI_LOAD_FAIL") return { label: t("openWiki", lang) };
          if (/FAILED$/.test(code) || code === "NETWORK_ERROR") return { label: t("retry", lang), method: "start", tone: "primary" };
          return { label: t("generateWiki", lang), method: "start", tone: "primary" };
        };

        const projectWall = () => {
          const items = state.workspaces ?? [];
          if (items.length === 0) {
            return h("div", { className: "rw-empty rw-setup" },
              h("strong", null, t("noProjects", lang)),
              h("span", null, NO_WORKSPACE_HINT),
              h("button", { className: "rw-btn", type: "button", onClick: () => void loadWorkspaces() }, t("refreshList", lang)));
          }
          return h("div", { className: "rw-projects" },
            h("div", { className: "rw-projects-head" },
              h("div", { className: "rw-projects-title" },
                h("strong", null, t("projectWallTitle", lang)),
                h("span", null, t("projectWallSubtitle", lang))),
              h("button", { className: "rw-btn", type: "button", onClick: () => void loadWorkspaces() },
                h(IconRefresh), " ", t("refreshList", lang))),
            h("div", { className: "rw-projects-grid" },
              items.map((item) => {
                const code = item.status?.status ?? "";
                const detail = item.status?.details ?? {};
                const action = cardAction(item);
                const progress = showsProgress(code) ? Math.max(0, Math.min(100, Number(item.status?.progress) || 0)) : null;
                const updateTime = detail.update_time || detail.last_update_time;
                return h("div", {
                  key: item.path,
                  className: "rw-project-card",
                  tabIndex: 0,
                  role: "button",
                  onClick: () => {
                    if (action?.method === "start") void startFor(item.path);
                    else changeWorkspace(item.path);
                  },
                  onKeyDown: (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (action?.method === "start") void startFor(item.path);
                      else changeWorkspace(item.path);
                    }
                  }
                },
                h("div", { className: "rw-project-card-head" },
                  h("div", { className: "rw-project-icon-box" }, h(IconRepo)),
                  h("div", { className: "rw-project-name-wrap" },
                    h("span", { className: "rw-project-name-text", title: item.title || item.path }, item.title || item.path),
                    detail.branch ? h("span", { className: "rw-head-ref-badge" }, h(IconBranch), detail.branch) : null),
                  code ? h("span", { className: "rw-badge", "data-tone": statusTone(code) },
                    progress !== null ? `${statusLabel(code, lang)} ${progress}%` : statusLabel(code, lang)) : null),
                h("div", { className: "rw-project-path-text", title: item.path }, item.path),
                progress !== null ? h("div", { className: "rw-bar", style: { height: "4px" } },
                  h("div", { className: "rw-bar-fill", style: { width: `${progress}%` } })) : null,
                h("div", { className: "rw-project-card-foot" },
                  updateTime ? h("span", { className: "rw-project-hint", style: { display: "inline-flex", alignItems: "center", gap: "4px" } }, h(IconClock), t("updatedAt", lang)(formatDate(updateTime))) : h("span", { className: "rw-project-hint" }, t("notGenerated", lang)),
                  action ? h("span", {
                    className: "rw-btn",
                    "data-tone": action.tone,
                    style: action.disabled ? { opacity: ".45", pointerEvents: "none" } : undefined
                  }, action.label) : null));
              })));
        };

        const knowledgeView = () => {
          if (state.knowledgeLoading && state.knowledgeCards === null) {
            return h("div", { className: "rw-empty" }, h("span", { className: "rw-spinner" }), t("loading", lang));
          }
          if (state.knowledgeError) {
            return h("div", { className: "rw-empty rw-error" },
              h("div", null, `Error: ${state.knowledgeError}`),
              h("button", { className: "rw-btn", type: "button", onClick: () => void loadKnowledgeCards(state.workspace, state.language) }, t("retry", lang)));
          }
          const allCards = state.knowledgeCards ?? [];
          if (allCards.length === 0) {
            return h("div", { className: "rw-empty rw-setup" },
              h("strong", null, t("noKnowledgeCards", lang)),
              h("span", null, t("noKnowledgeCardsDesc", lang)),
              statusCode === "COMPLETED"
                ? h("button", { className: "rw-btn", "data-tone": "primary", type: "button", onClick: () => void loadKnowledgeCards(state.workspace, state.language) }, t("refresh", lang))
                : null);
          }

          const query = state.knowledgeQuery.trim().toLowerCase();
          const filteredCards = allCards.filter((card) => {
            if (state.knowledgeCategory !== "all" && card.category !== state.knowledgeCategory) return false;
            if (query !== "") {
              const hay = `${card.title}\n${card.module}\n${card.module_path}\n${card.excerpt}\n${card.content}`.toLowerCase();
              if (!hay.includes(query)) return false;
            }
            return true;
          });

          const sidebar = h("div", { className: "rw-sidebar" },
            h("div", { className: "rw-sidebar-head" },
              h("strong", null, t("knowledgeCard", lang)),
              h("span", { className: "rw-sidebar-count" }, t("cardsCount", lang)(filteredCards.length))),
            h("div", { className: "rw-search" },
              h(IconSearch),
              h("input", {
                className: "rw-input",
                type: "search",
                placeholder: t("searchCardsPlaceholder", lang),
                "aria-label": t("searchCardsPlaceholder", lang),
                value: state.knowledgeQuery,
                onChange: (event) => setState((current) => ({ ...current, knowledgeQuery: event.target.value })),
                onKeyDown: (event) => { if (event.key === "Escape") { event.preventDefault(); setState((current) => ({ ...current, knowledgeQuery: "" })); } }
              }),
              state.knowledgeQuery ? h("button", { className: "rw-icon-btn", type: "button", "aria-label": "Clear", onClick: () => setState((current) => ({ ...current, knowledgeQuery: "" })) }, h(IconClose)) : null),
            h("div", { className: "rw-kc-categories" },
              KNOWLEDGE_CATEGORIES.map((cat) => {
                const count = cat.key === "all" ? allCards.length : allCards.filter((c) => c.category === cat.key).length;
                return h("button", {
                  key: cat.key,
                  className: "rw-kc-category-btn",
                  "data-active": String(state.knowledgeCategory === cat.key),
                  type: "button",
                  onClick: () => setState((current) => ({ ...current, knowledgeCategory: cat.key }))
                }, `${getCategoryLabel(cat.key, lang)} (${count})`);
              })),
            h("div", { className: "rw-kc-list" },
              filteredCards.length === 0
                ? h("div", { className: "rw-empty" }, state.knowledgeQuery ? t("noMatchCards", lang) : t("noKnowledgeCards", lang))
                : filteredCards.map((card) => {
                    const isSelected = (state.selectedCardDetail?.card?.id ?? state.selectedCard?.id) === card.id;
                    return h("button", {
                      key: card.id,
                      className: "rw-kc-card",
                      type: "button",
                      "data-active": String(isSelected),
                      onClick: () => setState((current) => ({ ...current, selectedCard: card }))
                    },
                    h("div", { className: "rw-kc-card-top" },
                      h("span", { className: "rw-kc-card-title" }, highlightMatch(card.title, state.knowledgeQuery, h)),
                      h("span", { className: "rw-kc-badge" }, getCategoryLabel(card.category, lang))),
                    h("span", { className: "rw-kc-card-module" }, card.module),
                    card.excerpt ? h("span", { className: "rw-kc-card-desc" }, card.excerpt) : null);
                  })));

          const currentCard = state.selectedCardDetail?.card ?? state.selectedCard;
          const linkedCards = state.selectedCardDetail?.linkedCards ?? [];
          const detail = !currentCard
            ? h("div", { className: "rw-empty" }, t("selectCardHint", lang))
            : h("div", { className: "rw-detail" },
                h("div", { className: "rw-detail-head" },
                  h("div", { className: "rw-breadcrumbs" },
                    h("span", { style: { opacity: 0.7 } }, t("knowledgeCard", lang)),
                    h("span", { className: "rw-crumb-sep" }, "/"),
                    h("span", { style: { opacity: 0.7 } }, getCategoryLabel(currentCard.category, lang)),
                    h("span", { className: "rw-crumb-sep" }, "/"),
                    h("strong", null, currentCard.title)),
                  h("span", { className: "rw-detail-path", title: currentCard.module_path || currentCard.module }, currentCard.module_path || currentCard.module)),
                h("div", { className: "rw-content" },
                  h("div", { className: "rw-content-inner" },
                    state.cardDetailLoading
                      ? h("div", { className: "rw-empty" }, h("span", { className: "rw-spinner" }), t("loading", lang))
                      : h(react.Fragment, null,
                          h("div", { className: "rw-md" }, renderMarkdown(currentCard.content, h)),
                          linkedCards.length > 0 ? h("div", { className: "rw-kc-linked" },
                            h("div", { className: "rw-kc-linked-title" }, h(IconLink), " ", t("relatedKnowledgeCards", lang)(linkedCards.length)),
                            h("div", { className: "rw-kc-linked-list" },
                              linkedCards.map((lc, idx) => {
                                const targetCard = allCards.find((c) => c.id === lc.card.id);
                                return h("button", {
                                  key: `linked-${idx}`,
                                  className: "rw-kc-linked-item",
                                  type: "button",
                                  onClick: () => {
                                    if (targetCard) setState((current) => ({ ...current, selectedCard: targetCard }));
                                  }
                                },
                                h(IconCards),
                                h("span", null, `${lc.card.title} (${lc.card.module})`),
                                h("span", { className: "rw-kc-badge" }, getCategoryLabel(lc.card.category, lang)));
                              }))) : null))));

          return h("div", { style: { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 } },
            !state.dismissKnowledgeBanner ? h("div", { className: "rw-kc-banner" },
              h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
                h(IconBulb),
                h("span", { className: "rw-kc-banner-text" }, t("knowledgeBanner", lang))),
              h("button", { className: "rw-icon-btn", type: "button", "aria-label": "Close", onClick: () => setState((current) => ({ ...current, dismissKnowledgeBanner: true })) }, h(IconClose))) : null,
            h("div", { className: "rw-split" }, sidebar, detail));
        };

        let body;
        if (!state.workspace) {
          body = state.workspaces === null
            ? h("div", { className: "rw-empty" }, h("span", { className: "rw-spinner" }), t("loading", lang))
            : projectWall();
        } else if (state.loading && !data) {
          body = h("div", { className: "rw-empty" }, h("span", { className: "rw-spinner" }), t("loading", lang));
        } else if (!data) {
          body = h("div", { className: "rw-empty" }, h("span", null, "Cannot load Wiki."),
            h("button", { className: "rw-btn", type: "button", onClick: () => void refresh(state.workspace, state.language) }, t("retry", lang)));
        } else if (state.activeTab === "knowledgeCard") {
          body = knowledgeView();
        } else if (statusCode === "WIKI_INIT" && !running && !launching && state.catalogs.length === 0) {
          const preflightError = serverErrorView(statusCode, details);
          body = h("div", { className: "rw-empty rw-setup" },
            h("strong", null, preflightError ? preflightError.title : t("generateWiki", lang)),
            h("span", null, preflightError?.desc || "Will scan repo files and plan structured documentation."),
            h("dl", { className: "rw-setup-details" },
              h("dt", null, "Workspace"), h("dd", null, state.workspace),
              h("dt", null, "Model"), h("dd", null, modelRouteLabel(details.user_config, state.models)),
              h("dt", null, "Location"), h("dd", null, `${state.workspace}/.dsh/repowiki`)),
            h("button", { className: "rw-btn", "data-tone": "primary", type: "button", disabled: busy || state.models?.llmAvailable === false,
              onClick: () => void perform("start", null, true) }, t("generateWiki", lang)));
        } else if (state.catalogs.length === 0 && !running && !launching) {
          body = h("div", { className: "rw-empty rw-setup" }, h("strong", null, t("tocEmpty", lang)));
        } else {
          const filtered = filterTree(state.catalogs, state.query);
          const rows = flattenTree(filtered, state.query.trim() ? null : state.expanded);
          const matchCount = state.catalogs.filter((catalog) => catalogMatches(catalog, state.query)).length;
          const tree = h("div", { className: "rw-tree", role: "tree", "aria-label": t("contents", lang) }, rows.map((row) => {
            const catalog = row.catalog;
            const active = state.selected?.catalog_id === catalog.catalog_id;
            const open = state.expanded[String(catalog.catalog_id)] !== false;
            const toggle = (event) => {
              if (event) event.stopPropagation();
              setState((current) => ({ ...current,
                expanded: { ...current.expanded, [catalog.catalog_id]: current.expanded[String(catalog.catalog_id)] === false } }));
            };
            return h("button", { key: catalog.catalog_id, className: "rw-tree-row", type: "button", role: "treeitem",
              "aria-level": row.depth + 1, "aria-selected": active, "aria-expanded": row.hasChildren ? String(open) : undefined,
              "data-active": String(active), style: { paddingLeft: `${8 + row.depth * 14}px` },
              onClick: () => {
                select(catalog);
                if (row.hasChildren) toggle();
              }, onKeyDown: (event) => {
                if (row.hasChildren && ((event.key === "ArrowLeft" && open) || (event.key === "ArrowRight" && !open))) { event.preventDefault(); toggle(event); }
              } },
              h("span", { className: "rw-caret", "data-open": String(open), "data-leaf": String(!row.hasChildren),
                onClick: (event) => { if (row.hasChildren) { toggle(event); } } }, open ? h(IconChevronDown) : h(IconChevronRight)),
              row.hasChildren ? h(IconFolder, { open }) : h(IconFile, null),
              h("span", { className: "rw-tree-title" }, highlightMatch(catalog.title, state.query, h)),
              h("span", { className: "rw-tree-meta" },
                h("span", { className: "rw-dot", "data-tone": CATALOG_TONE[catalog.progress_status] ?? "muted" }),
                catalog.dependent_files?.length ? h("span", { className: "rw-file-count", title: `${catalog.dependent_files.length} files` }, String(catalog.dependent_files.length)) : null));
          }));
          const page = splitPage(state.content);
          const selectedParent = state.selected?.parent_id
            ? state.catalogs.find((c) => c.catalog_id === state.selected.parent_id)
            : null;
          const detail = state.selected === null
            ? h("div", { className: "rw-empty" }, state.catalogs.length ? t("selectPageHint", lang) : t("tocEmpty", lang))
            : h("div", { className: "rw-detail" },
                h("div", { className: "rw-detail-head" },
                  h("div", { className: "rw-breadcrumbs" },
                    h("span", { style: { opacity: 0.7 } }, t("repoWiki", lang)),
                    h("span", { className: "rw-crumb-sep" }, "/"),
                    selectedParent ? h("span", { style: { opacity: 0.7 } }, selectedParent.title) : null,
                    selectedParent ? h("span", { className: "rw-crumb-sep" }, "/") : null,
                    h("strong", null, state.selected.title)),
                  h("span", { className: "rw-detail-path", title: state.selected.path }, state.selected.path)),
                h("div", { className: "rw-content", "aria-live": "polite" },
                  h("div", { className: "rw-content-inner" },
                    state.contentLoading ? h("div", { className: "rw-empty" }, h("span", { className: "rw-spinner" }), t("loading", lang))
                    : state.contentError ? h("div", { className: "rw-error" }, h("div", null, `Error: ${state.contentError}`),
                        h("button", { className: "rw-btn", type: "button", onClick: () => setState((current) => ({ ...current, contentRevision: current.contentRevision + 1 })) }, t("retry", lang)))
                    : !state.content ? t("emptyPageNotice", lang)
                    : h(react.Fragment, null,
                        page.references.length ? h("div", { className: "rw-cite" },
                          h("div", { className: "rw-cite-title" },
                            h(IconCode),
                            h("span", null, t("referencedFiles", lang)(page.references.length))),
                          h("div", { className: "rw-cite-pills" },
                            page.references.map((reference, i) =>
                              h("span", { key: `ref-${i}`, className: "rw-cite-pill", title: reference.path },
                                h("code", null, reference.path))))) : null,
                        h("div", { className: "rw-md" }, renderMarkdown(page.body, h))))));

          body = h("div", { className: "rw-split", "data-tree-collapsed": String(state.treeCollapsed) }, h("div", { className: "rw-sidebar" },
            h("div", { className: "rw-sidebar-head" },
              state.treeCollapsed ? null : h("div", { className: "rw-sidebar-title-row" },
                h("strong", null, t("contents", lang)),
                h("span", { className: "rw-sidebar-count" }, t("articlesCount", lang)(rows.length)),
                h("div", { className: "rw-tree-actions" },
                  h("button", {
                    className: "rw-tool-btn",
                    type: "button",
                    title: t("expandAll", lang),
                    "aria-label": t("expandAll", lang),
                    onClick: () => {
                      const next = {};
                      for (const c of state.catalogs) next[String(c.catalog_id)] = true;
                      setState((current) => ({ ...current, expanded: next }));
                    }
                  }, h(IconExpandAll), " ", t("expand", lang)),
                  h("button", {
                    className: "rw-tool-btn",
                    type: "button",
                    title: t("collapseAll", lang),
                    "aria-label": t("collapseAll", lang),
                    onClick: () => {
                      const next = {};
                      for (const c of state.catalogs) next[String(c.catalog_id)] = false;
                      setState((current) => ({ ...current, expanded: next }));
                    }
                  }, h(IconCollapseAll), " ", t("collapse", lang)))),
              h("button", {
                className: "rw-tool-btn",
                type: "button",
                title: state.treeCollapsed ? t("expandSidebar", lang) : t("collapseSidebar", lang),
                "aria-label": state.treeCollapsed ? t("expandSidebar", lang) : t("collapseSidebar", lang),
                "aria-expanded": !state.treeCollapsed,
                onClick: () => setState((current) => ({ ...current, treeCollapsed: !current.treeCollapsed }))
              }, h(IconSidebarToggle))),
            state.treeCollapsed ? null : h("div", { className: "rw-search" },
              h(IconSearch),
              h("input", { className: "rw-input", type: "search", placeholder: t("searchPlaceholder", lang),
                "aria-label": t("searchPlaceholder", lang), value: state.query, onChange: (event) => setState((current) => ({ ...current, query: event.target.value })),
                onKeyDown: (event) => { if (event.key === "Escape") { event.preventDefault(); setState((current) => ({ ...current, query: "" })); } } }),
              state.query ? h("button", { className: "rw-icon-btn", type: "button", "aria-label": "Clear", onClick: () => setState((current) => ({ ...current, query: "" })) }, h(IconClose)) : null),
            !state.treeCollapsed && state.query.trim() ? h("div", { className: "rw-search-status", role: "status" }, t("matchPages", lang)(matchCount)) : null,
            state.treeCollapsed ? null : h("div", { className: "rw-tree-wrap" }, rows.length ? tree : h("div", { className: "rw-empty" }, state.query ? t("noMatchPages", lang) : t("tocEmpty", lang)))), detail);
        }

        return h("div", { className: "rw-root", "aria-label": "Repo Wiki" },
          header,
          statusArea,
          serverError,
          confirmation,
          state.flash ? h("div", { className: "rw-note", role: "status", style: { margin: "8px 16px 0" } }, state.flash) : null,
          state.error ? h("div", { className: "rw-error", role: "alert", style: { margin: "8px 16px 0" } }, state.error) : null,
          h("div", { className: "rw-body" }, body));
      }

      function statusDescription(status, details) {
        const total = details && details.total_catalogs ? details.total_catalogs : 0;
        const done = details && details.completed_catalogs ? details.completed_catalogs : 0;
        const failed = details && details.failed_catalogs ? details.failed_catalogs : 0;
        if (status === "INITIALIZING") return "正在扫描仓库结构";
        if (status === "DIRECTORY_GENERATING") return "正在规划文档目录";
        if (status === "DOCUMENT_GENERATING") {
          if (total > 0) return `已完成 ${done}/${total}${failed > 0 ? `，失败 ${failed}` : ""}`;
          return "正在生成文档内容";
        }
        if (status === "COMPLETED") return total > 0 ? `已完成 ${done}/${total}` : "文档生成完成";
        if (status === "PARTLY_COMPLETED") return `已完成 ${done}/${total}，失败 ${failed}`;
        if (status === "PAUSED") return "生成已暂停";
        if (status === "LINING") return "排队等待处理";
        if (status === "WAITING") {
          return details && details.generation_type === "INCREMENT" ? "等待开始分析代码变更" : "等待开始分析";
        }
        if (status === "WIKI_INIT") return "选择语言后可以生成知识库";
        if (status === "WIKI_EXIST") return "已有 Wiki，可以查看或重新生成。";
        if (status === "WIKI_HAS_COMMIT") return "代码已更新，可增量更新 Wiki";
        if (status === "WIKI_HAS_CHANGE") return "检测到本地 repowiki 目录有更新，是否导入到数据库？";
        if (status === "WIKI_LOSS_COMMIT") return "无法复用已有 Wiki 进行更新，是否重新生成 Wiki？";
        if (status === "WIKI_LOAD_FAIL") return "Git 目录变更导致 Wiki 加载失败。 是否重新生成？";
        if (status === "SERVICE_RECOVERING") return "服务自动恢复中，请等待或重启";
        if (status === "NO_FILE_FAILED") return "当前目录没有可分析的文件";
        if (status === "TOO_MANY_FILES_FAILED") return `文件数超过上限 ${details.max_file_count ?? 10000}`;
        if (status === "TOO_MANY_WORKSPACE_FAILED") return "已超出账号可分析的代码库数量限制。";
        if (status === "INSUFFICIENT_REMAINING_SEATS_FAILED") return "您已达到该功能 Beta 期间提供的免费体验限额，暂时无法继续体验，请等待该功能正式发布后按需增购。";
        if (status === "NOT_SOURCE_CONTROL_FAILED") return "增量更新需要 Git 版本控制项目";
        if (status === "NO_COMMIT_HISTORY_FAILED") return "当前工程无提交记录，无法生成 Wiki。请提交代码。";
        if (status === "NETWORK_ERROR") return "请检查网络连接后重试。";
        if (status && status.indexOf("FAILED") >= 0) return "生成失败，请重试";
        return "";
      }

      /* ----------------------------------------------------------------- *
       * Composer entry
       * ----------------------------------------------------------------- */

      /** The composer shortcut only opens the panel for this session. */
      function RepoWikiComposerButton(props) {
        return h("button", {
          className: "rw-composer",
          type: "button",
          title: "打开 Repo Wiki",
          "aria-label": "Repo Wiki",
          disabled: props.canOpenPanel === false,
          onClick: () => props.openPanel(props.sessionId),
        },
        h(IconRepoWiki, { size: 16 }));
      }

      /**
       * The left-sidebar nav row glyph.
       *
       * The sidebar renders whatever this returns inside its own row button, so
       * it must be an icon only — the label is supplied separately by the
       * registration's `label`.
       */
      function RepoWikiPanelIcon() {
        return h("svg", {
          width: 18,
          height: 18,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.8,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
        },
        h("path", { d: "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" }),
        h("path", { d: "M8 7h8" }),
        h("path", { d: "M8 11h5" }),
        h("path", { d: "M10 16l2-2 2 2" }));
      }

      /** Settings-page nav label: clean single handcrafted icon plus text label. */
      function RepoWikiNavIcon() {
        return h("span", {
          className: "rw-nav-label",
          "data-settings-nav-label": "dsh-repo-wiki",
          style: { display: "inline-flex", alignItems: "center", gap: "8px" },
        },
          h(IconRepoWiki, { size: 16 }),
          h("span", null, "Repo Wiki"));
      }

      /* ----------------------------------------------------------------- *
       * Settings
       * ----------------------------------------------------------------- */

      function RepoSettings(props) {
        const rpcCall = props.rpcCall;
        const [state, setState] = react.useState({
          loading: true,
          workspace: "",
          workspaces: [],
          saving: false,
          confirmReset: false,
          pendingWorkspace: null,
          values: null,
          baseline: null,
          defaults: null,
          file: "",
          stored: false,
          warnings: [],
          models: null,
          error: "",
          flash: "",
          showAdvanced: false,
        });

        const settingsScope = react.useRef("");
        const settingsRequest = react.useRef(0);
        const scopePayload = (workspace) => workspace ? { workspace } : { scope: "global" };
        const load = react.useCallback(async (workspace, keepFlash = false) => {
          const request = ++settingsRequest.current;
          try {
            const data = await rpcCall("settings", scopePayload(workspace));
            if (request !== settingsRequest.current || settingsScope.current !== workspace) return;
            setState((current) => ({
              ...current,
              loading: false,
              values: data.settings.values,
              baseline: { ...data.settings.values },
              defaults: data.settings.defaults,
              file: data.settings.file,
              stored: data.settings.stored,
              warnings: data.settings.warnings,
              error: "",
              flash: keepFlash ? current.flash : "",
            }));
          } catch (error) {
            if (request !== settingsRequest.current || settingsScope.current !== workspace) return;
            setState((current) => ({
              ...current,
              loading: false,
              error: String(error && error.message ? error.message : error),
              errorCode: (error && error.code) || "",
            }));
          }
        }, [rpcCall]);

        const loadModels = react.useCallback(async () => {
          try {
            const models = await rpcCall("models", {});
            setState((current) => ({ ...current, models }));
          } catch (error) {
            setState((current) => ({
              ...current,
              models: { providers: [], defaultRoute: null, llmAvailable: false, error: String(error && error.message ? error.message : error) },
            }));
          }
        }, [rpcCall]);

        react.useEffect(() => {
          void loadModels();
          void rpcCall("workspaces", {}).then((result) => setState((current) => ({ ...current, workspaces: result.items ?? [] }))).catch(() => {});
        }, [loadModels, rpcCall]);
        react.useEffect(() => { void load(state.workspace); }, [load, state.workspace]);

        const update = (key, value) => {
          setState((current) => ({ ...current, values: { ...current.values, [key]: value }, flash: "" }));
        };

        const save = async () => {
          const workspace = state.workspace;
          const changes = changedSettings(state.values, state.baseline);
          if (Object.keys(changes).length === 0) return;
          setState((current) => ({ ...current, saving: true, error: "" }));
          try {
            await rpcCall("saveSettings", { ...scopePayload(workspace), values: changes });
            setState((current) => ({ ...current, flash: t("savedMsg", lang), pendingWorkspace: null }));
            await load(workspace, true);
          } catch (error) {
            setState((current) => ({ ...current, error: String(error && error.message ? error.message : error) }));
          } finally {
            setState((current) => ({ ...current, saving: false }));
          }
        };

        const switchSettingsWorkspace = (workspace) => {
          settingsScope.current = workspace;
          settingsRequest.current += 1;
          setState((current) => ({ ...current, workspace, loading: true, flash: "", error: "", confirmReset: false, pendingWorkspace: null }));
        };

        const reset = async () => {
          const workspace = state.workspace;
          setState((current) => ({ ...current, saving: true, error: "" }));
          try {
            await rpcCall("resetSettings", scopePayload(workspace));
            setState((current) => ({ ...current, flash: t("resetSuccess", lang) }));
            await load(workspace, true);
          } catch (error) {
            setState((current) => ({ ...current, error: String(error && error.message ? error.message : error) }));
          } finally {
            setState((current) => ({ ...current, saving: false }));
          }
        };

        const values = state.values ?? {};
        const dirty = Object.keys(changedSettings(values, state.baseline)).length > 0;
        const lang = values.language || "zh";

        if (state.loading) return h("div", { className: "rw-settings" },
          h("div", { className: "rw-empty" }, h("span", { className: "rw-spinner" }), t("loading", lang)));

        const renderModelCard = () => {
          const models = state.models;
          const providers = models && Array.isArray(models.providers) ? models.providers : [];
          const currentProvider = values.provider ?? "";
          const currentModel = values.model ?? "";
          const selected = providers.find((entry) => entry.id === currentProvider);
          const usingDefault = currentProvider === "" && currentModel === "";
          const defaultLabel = models && models.defaultRoute
            ? `${t("defaultOption", lang)} (${models.defaultRoute.provider} / ${models.defaultRoute.model})`
            : t("defaultOption", lang);

          return h("div", { className: "rw-set-card" },
            h("div", { className: "rw-set-card-head" },
              h("div", { className: "rw-set-card-title-group" },
                h(IconSparkles, { size: 16 }),
                h("h3", null, t("modelConfig", lang))),
              h("span", {
                className: "rw-badge",
                "data-tone": usingDefault ? "brand" : "ok",
              }, usingDefault ? t("defaultRouteBadge", lang) : t("customRouteBadge", lang))),
            h("p", { className: "rw-set-card-desc" }, t("modelConfigDesc", lang)),
            models && models.llmAvailable === false
              ? h("div", { className: "rw-error", role: "alert" },
                  models.error || t("llmNotMounted", lang))
              : null,
            h("div", { className: "rw-grid" },
              h("label", { className: "rw-field" },
                h("span", { className: "rw-label" }, t("provider", lang)),
                h("select", {
                  className: "rw-select",
                  value: currentProvider,
                  onChange: (event) => {
                    const next = event.target.value;
                    update("provider", next);
                    update("model", "");
                  },
                },
                h("option", { value: "" }, defaultLabel),
                providers.map((entry) => h("option", { key: entry.id, value: entry.id }, entry.name)))),
              h("label", { className: "rw-field" },
                h("span", { className: "rw-label" }, t("model", lang)),
                selected !== undefined && selected.enumerable
                  ? h("select", {
                      className: "rw-select",
                      value: currentModel,
                      onChange: (event) => update("model", event.target.value),
                    },
                    h("option", { value: "" }, t("defaultOption", lang)),
                    selected.models.map((m) => h("option", { key: m.id, value: m.id }, m.name || m.id)))
                  : h("input", {
                      className: "rw-num",
                      value: currentModel,
                      placeholder: t("defaultOption", lang),
                      disabled: currentProvider === "",
                      onChange: (event) => update("model", event.target.value),
                    }))),
            usingDefault ? h("span", { className: "rw-hint" }, t("usingDefaultModelHint", lang)) : null,
            currentProvider !== "" && currentModel === "" ? h("span", { className: "rw-hint" }, t("needSelectModelHint", lang)) : null,
            h("div", { className: "rw-row", style: { marginTop: "4px" } },
              h("button", { className: "rw-btn", type: "button", onClick: () => void loadModels() },
                h(IconRefresh), " ", t("refreshModels", lang)),
              (!usingDefault)
                ? h("button", { className: "rw-btn", type: "button", onClick: () => { update("provider", ""); update("model", ""); } },
                    h(IconReset), " ", t("useDefaultModel", lang))
                : null));
        };

        const currentWorkspaceItem = state.workspaces.find((item) => item.path === state.workspace);

        return h("div", { className: "rw-settings" },
          // Header
          h("div", { className: "rw-settings-head" },
            h("h2", null, t("settingsTitle", lang)),
            h("p", null, t("settingsScopeDesc", lang))),

          // Scope Card
          h("div", { className: "rw-scope-card" },
            h("div", { className: "rw-scope-info" },
              h("span", { className: "rw-scope-title" }, state.workspace ? t("scopeWorkspace", lang) : t("scopeGlobal", lang)),
              h("span", { className: "rw-scope-desc" }, state.workspace
                ? (currentWorkspaceItem ? `${currentWorkspaceItem.title} — ${t("scopeWorkspaceHint", lang)}` : t("scopeWorkspaceHint", lang))
                : t("scopeGlobalHint", lang))),
            h("label", { className: "rw-field", style: { margin: 0, minWidth: "220px" } },
              h("select", {
                className: "rw-select",
                value: state.workspace,
                disabled: state.saving,
                onChange: (event) => {
                  const workspace = event.target.value;
                  if (dirty) setState((current) => ({ ...current, pendingWorkspace: workspace, confirmReset: false }));
                  else switchSettingsWorkspace(workspace);
                }
              },
                h("option", { value: "" }, t("globalDefault", lang)),
                state.workspaces.map((item) => h("option", { key: item.path, value: item.path }, `${item.title} (${item.path})`))))),

          // Unsaved switch confirmation
          state.pendingWorkspace !== null ? h("div", { className: "rw-confirm", role: "alert" },
            h("strong", null, t("unsavedWarning", lang)),
            h("div", { className: "rw-row" },
              h("button", { className: "rw-btn", "data-tone": "danger", type: "button", onClick: () => switchSettingsWorkspace(state.pendingWorkspace) }, t("discardAndSwitch", lang)),
              h("button", { className: "rw-btn", type: "button", onClick: () => setState((current) => ({ ...current, pendingWorkspace: null })) }, t("continueEditing", lang)))) : null,

          // 1. Model Configuration
          renderModelCard(),

          // 2. Language & Auto-update (Clean like Qoder)
          h("div", { className: "rw-set-card" },
            h("div", { className: "rw-set-card-head" },
              h("div", { className: "rw-set-card-title-group" },
                h(IconGlobe, { size: 16 }),
                h("h3", null, t("docLangTitle", lang)))),
            h("p", { className: "rw-set-card-desc" }, t("docLangDesc", lang)),
            h("div", { className: "rw-field", style: { maxWidth: "280px" } },
              h("span", { className: "rw-label" }, t("docLanguageLabel", lang)),
              h("select", {
                className: "rw-select",
                value: values.language ?? "zh",
                onChange: (event) => update("language", event.target.value),
              }, LANGUAGES.map((item) => h("option", { key: item.value, value: item.value }, item.label)))),
            h("div", {
              className: "rw-switch-row",
              onClick: () => update("autoUpdate", !(values.autoUpdate ?? true))
            },
              h("div", { className: "rw-switch-label-group" },
                h("span", { className: "rw-switch-title" }, t("autoUpdateTitle", lang)),
                h("span", { className: "rw-switch-sub" }, t("autoUpdateSub", lang))),
              h("label", { className: "rw-switch", onClick: (e) => e.stopPropagation() },
                h("input", {
                  type: "checkbox",
                  checked: values.autoUpdate ?? true,
                  onChange: (event) => update("autoUpdate", event.target.checked),
                }),
                h("span", { className: "rw-switch-slider" })))),

          // 3. Collapsible Advanced Settings (Hides raw pipeline parameters)
          h("div", { className: "rw-set-card", style: { background: "color-mix(in srgb, var(--dsw-alias-label-secondary) 2%, transparent)" } },
            h("div", {
              style: { display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" },
              onClick: () => setState((c) => ({ ...c, showAdvanced: !c.showAdvanced }))
            },
              h("div", { className: "rw-set-card-title-group" },
                h(IconSliders, { size: 16 }),
                h("div", null,
                  h("h3", { style: { margin: 0 } }, t("advancedSettings", lang)),
                  h("p", { className: "rw-set-card-desc", style: { margin: "2px 0 0" } }, t("advancedSettingsHint", lang)))),
              h("button", { className: "rw-tool-btn", type: "button" },
                state.showAdvanced ? h(IconChevronDown) : h(IconChevronRight),
                " ", state.showAdvanced ? t("collapse", lang) : t("expand", lang))),
            state.showAdvanced ? h("div", { className: "rw-grid", style: { marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--dsw-alias-border-l1)" } },
              h("label", { className: "rw-field" },
                h("span", { className: "rw-label" }, t("dataDir", lang)),
                h("input", { className: "rw-num", value: values.dataDir ?? "", placeholder: ".dsh", onChange: (e) => update("dataDir", e.target.value) }),
                h("span", { className: "rw-hint" }, t("dataDirHint", lang)(values.dataDir || ".dsh"))),
              h("label", { className: "rw-field" },
                h("span", { className: "rw-label" }, t("maxFiles", lang)),
                h("input", { className: "rw-num", type: "number", min: 100, max: 200000, value: values.maxFiles ?? 10000, onChange: (e) => update("maxFiles", Number(e.target.value)) })),
              h("label", { className: "rw-field" },
                h("span", { className: "rw-label" }, t("maxDepth", lang)),
                h("input", { className: "rw-num", type: "number", min: 1, max: 8, value: values.maxDepth ?? 4, onChange: (e) => update("maxDepth", Number(e.target.value)) })),
              h("label", { className: "rw-field" },
                h("span", { className: "rw-label" }, t("maxCitations", lang)),
                h("input", { className: "rw-num", type: "number", min: 0, max: 500, value: values.maxCitations ?? 40, onChange: (e) => update("maxCitations", Number(e.target.value)) })),
              h("label", { className: "rw-field" },
                h("span", { className: "rw-label" }, t("concurrency", lang)),
                h("input", { className: "rw-num", type: "number", min: 1, max: 8, value: values.concurrency ?? 2, onChange: (e) => update("concurrency", Number(e.target.value)) })),
              h("label", { className: "rw-field" },
                h("span", { className: "rw-label" }, t("timeoutMs", lang)),
                h("input", { className: "rw-num", type: "number", min: 5000, max: 600000, step: 1000, value: values.timeoutMs ?? 120000, onChange: (e) => update("timeoutMs", Number(e.target.value)) })),
              h("label", { className: "rw-field" },
                h("span", { className: "rw-label" }, t("autoUpdateDelayMs", lang)),
                h("input", { className: "rw-num", type: "number", min: 5000, max: 3600000, step: 1000, value: values.autoUpdateDelayMs ?? 60000, onChange: (e) => update("autoUpdateDelayMs", Number(e.target.value)) }))) : null),

          state.warnings.length > 0 ? h("div", { className: "rw-note" }, state.warnings.join("; ")) : null,
          state.error !== "" ? h("div", { className: "rw-error", role: "alert" }, state.error) : null,
          state.flash !== "" ? h("div", { className: "rw-note", role: "status", style: { display: "flex", alignItems: "center", gap: "6px" } },
            h(IconCheck), state.flash) : null,

          // Settings Action Footer
          h("div", { className: "rw-settings-footer" },
            h("div", { className: "rw-settings-actions" },
              dirty ? h("span", { className: "rw-badge", "data-tone": "warn" }, t("unsavedChanges", lang)) : null,
              h("button", {
                className: "rw-btn",
                type: "button",
                disabled: state.saving,
                onClick: () => setState((current) => ({ ...current, confirmReset: true, pendingWorkspace: null }))
              }, h(IconReset), " ", t("resetBtn", lang)),
              h("button", {
                className: "rw-btn",
                "data-tone": "primary",
                type: "button",
                disabled: state.saving || !dirty,
                onClick: () => void save()
              }, state.saving ? h("span", { className: "rw-spinner" }) : h(IconSave), " ", state.saving ? t("saving", lang) : t("saveBtn", lang)))),

          // Reset confirmation dialog
          state.confirmReset ? h("div", { className: "rw-confirm", role: "alert" },
            h("strong", null, state.workspace ? t("confirmResetWorkspace", lang) : t("confirmResetGlobal", lang)),
            h("div", { className: "rw-row" },
              h("button", { className: "rw-btn", "data-tone": "danger", type: "button", disabled: state.saving, onClick: () => { setState((c) => ({ ...c, confirmReset: false })); void reset(); } }, t("confirmResetBtn", lang)),
              h("button", { className: "rw-btn", type: "button", onClick: () => setState((c) => ({ ...c, confirmReset: false })) }, t("returnBtn", lang)))) : null);
      }

      /* ----------------------------------------------------------------- *
       * Mount
       * ----------------------------------------------------------------- */

      function apply(ctx) {
        ensureStyles();
        const rpcCall = async (method, payload) => {
          const rpc = ctx && ctx.connection && ctx.connection.rpc;
          if (!rpc || typeof rpc.call !== "function") throw new Error("连接服务尚未就绪");
          const result = await rpc.call(CHANNEL, method, payload || {});
          if (result && result.ok === true) return result.value;
          const error = new Error(result && result.error ? result.error.message : "请求失败");
          // Keep the host's structured code: the panel branches on
          // `no-workspace` to show guidance instead of a retry button.
          error.code = result && result.error ? result.error.code : "internal-error";
          throw error;
        };
        // `layout` may be absent (older host, or a composition without the main
        // column service); the composer entry then degrades to a no-op rather
        // than throwing during activation.
        // `layout.selectPanel` is the host's own main-panel switch; it throws
        // when no main slot owns the key, so a click handler must not let that
        // escape as an unhandled rejection.
        const layout = typeof ctx.get === "function" ? ctx.get("layout", false) : undefined;
        let panelSessionId = "";
        const openPanel = (sessionId) => {
          if (!layout || typeof layout.selectPanel !== "function") return;
          try {
            panelSessionId = typeof sessionId === "string" ? sessionId : "";
            layout.selectPanel(PANEL_ID);
          } catch (error) {
            panelSessionId = "";
            if (typeof console !== "undefined" && console.warn) {
              console.warn("dsh-repo-wiki: cannot open the Repo Wiki panel:", error && error.message ? error.message : error);
            }
          }
        };
        const peekPanelSession = () => panelSessionId;
        const clearPanelSession = (sessionId) => {
          if (panelSessionId === sessionId) panelSessionId = "";
        };
        const canOpenPanel = Boolean(layout && typeof layout.selectPanel === "function");

        ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({
          name: SETTINGS_SLOT,
          id: "dsh-repo-wiki",
          order: 37,
          label: RepoWikiNavIcon,
          inject: () => ({ rpcCall }),
        }, RepoSettings));

        // The left sidebar row is the panel's entry in the global-panel list, and
        // the `main` seat keyed by the same id is its body. This is the pair the
        // host's own plugin-manager and schedule panels use: `layout.selectPanel`
        // swaps the main area to whatever the nav row selected.
        ctx.slots.inject(PANEL_LIST_SLOT, () => ctx.slots.register({
          name: PANEL_LIST_SLOT,
          id: PANEL_ID,
          order: 20,
          label: () => "Repo Wiki",
        }, RepoWikiPanelIcon));

        ctx.slots.inject(MAIN_SLOT, () => ctx.slots.register({
          name: MAIN_SLOT,
          key: PANEL_ID,
          inject: () => ({ rpcCall, peekPanelSession, clearPanelSession }),
        }, RepoWikiPanel));

        ctx.slots.inject(COMPOSER_SLOT, () => ctx.slots.register({
          name: COMPOSER_SLOT,
          id: "dsh-repo-wiki-composer",
          order: 2,
          inject: (sessionId) => ({
            rpcCall,
            sessionId,
            openPanel,
            canOpenPanel,
          }),
        }, RepoWikiComposerButton));
      }

      exports.apply = apply;
      exports.inject = ["slots", "connection", "layout"];
      exports.internals = {
        CHANNEL, SETTINGS_SLOT, PANEL_LIST_SLOT, MAIN_SLOT, COMPOSER_SLOT, PANEL_ID,
        LANGUAGES, STATUS_LABEL, STATUS_TONE, CATALOG_TONE, KNOWLEDGE_CATEGORIES, CATEGORY_NAMES,
        flattenTree, filterTree, changedSettings, statusLabel, statusTone, showsProgress, isRetryable,
        hasContent, statusAction, serverErrorView, tabTitle, formatDate, splitPage, renderMarkdown, inline, statusDescription,
        I18N, t, getCategoryLabel,
      };
      return module.exports;
    },
  });
})();
