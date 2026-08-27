/**
 * dsh-plugin-manager client bundle
 *
 * Renders the Visual Plugin Manager in Settings -> Plugin Manager (插件管理):
 * 1. 全局状态筛选：支持「全部 (N)」、「已安装 (N)」、「未安装 (N)」三大状态快速过滤。
 * 2. 自有插件 (Monorepo)：实时拉取 GitHub Releases，比对当前 profile 已安装版本，
 *    清晰展示当前版本与远程最新版本，支持「一键更新全部(N)」、单个安装 / 更新 / 卸载。
 * 3. 社区插件浏览：按 21 种分类筛选、搜索，自动匹配本地已安装状态与版本，
 *    支持「一键更新全部(N)」、单个安装 / 更新 / 卸载。
 * 4. 异步平滑重启与自动恢复：手动点击后服务端延迟异步重启 DSH 守护进程，
 *    前端无感自动探测端口并在就绪后自动刷新恢复页面。
 * 5. 配置页：仓库源 / 社区目录 URL / 镜像 / 自动检查开关。
 * 6. 独立插件图标：专属 SVG 拼图插件图标，无感覆盖宿主默认插槽图标。
 *
 * All data flows through the trusted-host RPC channel `/dsh-plugin-manager-rpc`
 * (ctx.connection.rpc.call), matching dsh-model-roles / dsh-remote-control.
 */

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
  id: "dsh-plugin-manager",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");

    const MARKET_RPC_CHANNEL = "/dsh-plugin-manager-rpc";
    const SETTINGS_SLOT = "settings.section";
    const NAV_STYLE_ID = "dsh-plugin-manager-nav-styles";
    const navCss = 'button:has([data-settings-nav-label="plugin-manager"]) > svg:first-child{display:none}';

    /**
     * Dedicated SVG Icon for Plugin Manager (Puzzle piece silhouette)
     */
    function IconPluginManager16({ size = 16, className }) {
      return react.createElement("svg", {
        width: size,
        height: size,
        viewBox: "0 0 16 16",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "1.3",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        className,
        "aria-hidden": "true",
      },
        react.createElement("path", {
          d: "M6 2H4a2 2 0 0 0-2 2v2.5a1.5 1.5 0 0 1 0 3V12a2 2 0 0 0 2 2h2.5a1.5 1.5 0 0 1 3 0H12a2 2 0 0 0 2-2V9.5a1.5 1.5 0 0 0 0-3V4a2 2 0 0 0-2-2h-2.5a1.5 1.5 0 0 0-3 0z"
        })
      );
    }

    const css = `
      .dm-container{display:flex;flex-direction:column;gap:14px;width:100%;max-width:920px;color:var(--dsw-alias-label-primary,#1f2328);font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif);color-scheme:light dark;-webkit-tap-highlight-color:transparent}
      .dm-title{font-size:20px;font-weight:600;margin:0;display:flex;align-items:center;gap:8px}.dm-subtitle{font-size:13px;color:var(--dsw-alias-label-tertiary,#656d76);margin:0;line-height:20px}
      .dm-tabs{display:flex;gap:8px;border-bottom:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,.1));padding-bottom:8px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
      .dm-tabs::-webkit-scrollbar{display:none}
      .dm-tab-btn{padding:6px 14px;border-radius:6px;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#57606a);font-size:14px;cursor:pointer;font-weight:500;transition:all .15s ease;white-space:nowrap;flex-shrink:0}
      .dm-tab-btn:hover{background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary,#1f2328)}
      .dm-tab-btn.active{background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff}
      .dm-filter-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .dm-filter-group{display:inline-flex;align-items:center;padding:2px;border-radius:8px;border:1px solid var(--dsw-alias-border-default,#d0d7de);background:var(--dsw-alias-bg-layer-1,#f6f8fa)}
      .dm-filter-btn{padding:4px 10px;border-radius:6px;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#57606a);font-size:12px;font-weight:500;cursor:pointer;transition:all .15s ease;white-space:nowrap}
      .dm-filter-btn:hover{color:var(--dsw-alias-label-primary,#1f2328)}
      .dm-filter-btn.active{background:var(--dsw-alias-background-base,#fff);color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 1px 3px rgba(0,0,0,.08);font-weight:600}
      .dm-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
      .dm-toolbar-left{display:flex;align-items:center;gap:10px;flex:1;min-width:240px}
      .dm-toolbar-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .dm-search-box{box-sizing:border-box;width:100%;height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-default,#d0d7de);background:var(--dsw-alias-background-base,#fff);color:var(--dsw-alias-label-primary,#1f2328);outline:none;font-size:13px}
      .dm-search-box:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 20%,transparent)}
      .dm-action-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:34px;padding:0 12px;border-radius:6px;font-size:12.5px;font-weight:500;cursor:pointer;border:1px solid var(--dsw-alias-border-default,#d0d7de);background:var(--dsw-alias-background-base,#fff);color:var(--dsw-alias-label-primary,#1f2328);transition:all .15s ease;white-space:nowrap;touch-action:manipulation}
      .dm-action-btn:hover{background:var(--dsw-alias-bg-module-platform,#f6f8fa)}.dm-action-btn:disabled{opacity:.55;cursor:default}
      .dm-action-btn.primary{background:var(--dsw-alias-brand-primary,#4d6bfe);border-color:transparent;color:#fff}
      .dm-action-btn.primary:hover{opacity:.9}
      .dm-action-btn.success{border-color:transparent;background:#10b981;color:#fff}
      .dm-action-btn.warning{border-color:transparent;background:#f59e0b;color:#fff}
      .dm-action-btn.danger{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 35%,transparent);color:var(--dsw-alias-state-error-primary,#d84848)}
      .dm-action-btn.danger:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 10%,transparent)}
      .dm-repo-banner{padding:12px 14px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 8%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 25%,transparent);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
      .dm-repo-info{font-size:13px;color:var(--dsw-alias-label-primary,#1f2328);line-height:18px}
      .dm-chips{display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px;scrollbar-width:none}
      .dm-chips::-webkit-scrollbar{display:none}
      .dm-chip{box-sizing:border-box;padding:5px 12px;border-radius:14px;border:1px solid var(--dsw-alias-border-default,#d0d7de);background:var(--dsw-alias-background-base,#fff);color:var(--dsw-alias-label-secondary,#57606a);font-size:12px;cursor:pointer;transition:all .15s ease;white-space:nowrap;flex-shrink:0;touch-action:manipulation}
      .dm-chip:hover{border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-brand-primary,#4d6bfe)}
      .dm-chip.active{background:var(--dsw-alias-brand-primary,#4d6bfe);border-color:transparent;color:#fff}
      .dm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
      .dm-card{box-sizing:border-box;padding:14px;border-radius:10px;border:1px solid var(--dsw-alias-border-subtle,#e1e4e8);background:var(--dsw-alias-background-base,#fff);display:flex;flex-direction:column;justify-content:space-between;gap:10px;transition:box-shadow .15s ease}
      .dm-card:hover{box-shadow:0 4px 12px rgba(0,0,0,.06)}
      .dm-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
      .dm-card-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2328);margin:0}
      .dm-card-name{font-size:11px;color:var(--dsw-alias-label-tertiary,#656d76);margin:2px 0 0}
      .dm-badge{font-size:11px;padding:2px 6px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 12%,transparent);color:var(--dsw-alias-brand-primary,#4d6bfe);font-weight:500;white-space:nowrap;flex-shrink:0}
      .dm-badge.installed{background:color-mix(in srgb,#10b981 15%,transparent);color:#059669}
      .dm-badge.update{background:color-mix(in srgb,#d98e00 18%,transparent);color:#b76e00;font-weight:600}
      .dm-badge.uninstalled{background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.06));color:var(--dsw-alias-label-tertiary,#656d76)}
      .dm-card-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#57606a);margin:0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
      .dm-version-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11.5px;color:var(--dsw-alias-label-secondary,#57606a);line-height:18px}
      .dm-ver-installed{color:#059669;font-weight:500}
      .dm-ver-latest{color:var(--dsw-alias-label-primary,#1f2328);font-weight:600}
      .dm-ver-uptodate{color:var(--dsw-alias-label-tertiary,#656d76);font-size:11px}
      .dm-card-meta{display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--dsw-alias-label-tertiary,#656d76);border-top:1px solid var(--dsw-alias-border-subtle,#f0f0f0);padding-top:8px;gap:8px;flex-wrap:wrap}
      .dm-card-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
      .dm-feedback{padding:9px 12px;border-radius:8px;font-size:12px;line-height:18px}.dm-feedback.ok{background:color-mix(in srgb,#10b981 10%,transparent);color:#059669}.dm-feedback.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 10%,transparent);color:var(--dsw-alias-state-error-primary,#d84848)}
      .dm-empty{padding:28px 14px;text-align:center;color:var(--dsw-alias-label-tertiary,#656d76);font-size:13px}
      .dm-install-box{border:1px solid var(--dsw-alias-border-default,#d0d7de);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#f6f8fa);overflow:hidden}
      .dm-install-head{padding:8px 12px;font-size:12px;font-weight:600;border-bottom:1px solid var(--dsw-alias-border-subtle,#e1e4e8);display:flex;justify-content:space-between;align-items:center;gap:8px}
      .dm-install-log{margin:0;padding:8px 12px;max-height:160px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#57606a);white-space:pre-wrap;word-break:break-all}
      .dm-restart-modal{padding:18px;border-radius:10px;background:color-mix(in srgb,#f59e0b 12%,transparent);border:1px solid color-mix(in srgb,#f59e0b 35%,transparent);display:flex;flex-direction:column;gap:8px;align-items:center;text-align:center}
      .dm-config{display:flex;flex-direction:column;gap:12px;max-width:640px}
      .dm-field{display:flex;flex-direction:column;gap:5px}.dm-label{color:var(--dsw-alias-label-secondary,#57606a);font-size:12px;font-weight:500}
      .dm-input{box-sizing:border-box;width:100%;height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-default,#d0d7de);border-radius:8px;outline:none;background:var(--dsw-alias-background-base,#fff);color:var(--dsw-alias-label-primary,#1f2328);font-size:13px}
      .dm-input:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 18%,transparent)}
      .dm-check{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary,#57606a);font-size:13px}
      @media(max-width:768px){
        .dm-container{gap:10px;padding-bottom:max(16px,env(safe-area-inset-bottom,16px))}
        .dm-grid{grid-template-columns:1fr;gap:10px}
        .dm-toolbar{flex-direction:column;align-items:stretch;gap:8px}
        .dm-toolbar-left{width:100%;min-width:0;flex-direction:column;align-items:stretch;gap:8px}
        .dm-filter-group{width:100%;display:grid;grid-template-columns:1fr 1fr 1fr;text-align:center}
        .dm-filter-btn{text-align:center;padding:6px 4px}
        .dm-toolbar-right{width:100%;display:grid;grid-template-columns:1fr 1fr;gap:6px}
        .dm-toolbar-right .dm-action-btn{width:100%;height:36px}
        .dm-repo-banner{flex-direction:column;align-items:stretch;gap:8px}
        .dm-repo-banner>div:last-child{width:100%;display:flex;justify-content:space-between;align-items:center}
        .dm-repo-banner .dm-action-btn{flex:1}
        .dm-card{padding:12px;gap:8px}
        .dm-card-meta{flex-direction:column;align-items:stretch;gap:8px}
        .dm-card-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));width:100%;gap:6px}
        .dm-card-actions .dm-action-btn{height:36px;width:100%}
        .dm-search-box{height:38px;font-size:14px}
        .dm-tab-btn{padding:8px 14px;font-size:13.5px}
      }
      @media(max-width:480px){
        .dm-toolbar-right{grid-template-columns:1fr}
        .dm-card-actions{grid-template-columns:1fr 1fr}
      }
    `;

    const FALLBACK_REPO_PLUGINS = [
      { id: "dsh-plugin-manager", name: "dsh-plugin-manager", title: "插件管理", description: "DSH 插件管理与更新中心，支持自有插件更新/卸载/一键批量更新，浏览 2200+ 社区插件并一键安装。", author: "veildawn", category: "tools", version: "0.1.1", latestVersion: "0.1.1", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-plugin-manager@v0.1.1/dsh-plugin-manager-0.1.1.tgz", isRepoPlugin: true },
      { id: "dsh-model-roles", name: "dsh-model-roles", title: "模型角色分工与路由", description: "OMP 风格的多模型智能分工与角色路由，支持计划模式、识图子代理分析与顾问复核 (/advisor)。", author: "veildawn", category: "ai", version: "0.4.8", latestVersion: "0.4.8", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.8/dsh-model-roles-0.4.8.tgz", isRepoPlugin: true },
      { id: "dsh-remote-control", name: "dsh-remote-control", title: "远程访问与安全通道", description: "Token 密钥认证、密码锁屏门禁 Unlock Screen、特权 RPC 白名单桥接与局域网无感放行。", author: "veildawn", category: "security", version: "0.1.6", latestVersion: "0.1.6", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-remote-control@v0.1.6/dsh-remote-control-0.1.6.tgz", isRepoPlugin: true },
      { id: "dsh-ai-proxy", name: "dsh-ai-proxy", title: "AI Proxy 网关与 Provider", description: "AI Proxy Service 统一网关对接，支持 Chat/Anthropic/Responses 多协议智能适配与 OAuth 2.0 PKCE 认证。", author: "veildawn", category: "ai", version: "0.2.5", latestVersion: "0.2.5", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-ai-proxy@v0.2.5/dsh-ai-proxy-0.2.5.tgz", isRepoPlugin: true },
      { id: "dsh-mobile-adapter", name: "dsh-mobile-adapter", title: "移动端全量体验优化", description: "原生图片上传、底部操作栏圆形统一规范、视口高度自适应、Segmented Control Tabs。", author: "veildawn", category: "ui", version: "0.1.28", latestVersion: "0.1.28", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-mobile-adapter@v0.1.28/dsh-mobile-adapter-0.1.28.tgz", isRepoPlugin: true },
      { id: "dsh-file-viewer", name: "dsh-file-viewer", title: "工作区文件查看器", description: "会话头部抽屉式文件浏览器，支持全屏切换、语法高亮、Markdown/JSON、图片、PDF、Excel、Word 预览。", author: "veildawn", category: "tools", version: "0.1.8", latestVersion: "0.1.8", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-file-viewer@v0.1.8/dsh-file-viewer-0.1.8.tgz", isRepoPlugin: true },
      { id: "dsh-terminal", name: "dsh-terminal", title: "跨平台交互式终端", description: "本地终端调用、移动端专属对话框底部工具箱二合一入口、多标签并发与触控辅助键盘。", author: "veildawn", category: "tools", version: "0.1.9", latestVersion: "0.1.9", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-terminal@v0.1.9/dsh-terminal-0.1.9.tgz", isRepoPlugin: true },
    ];

    function installSourceOf(plugin, kind) {
      if (kind === "community") return plugin.npm || plugin.name;
      return plugin.downloadUrl || "";
    }

    function apply(ctx) {
      if (typeof document !== "undefined" && !document.getElementById(NAV_STYLE_ID)) {
        const style = document.createElement("style");
        style.id = NAV_STYLE_ID;
        style.textContent = navCss;
        document.head.appendChild(style);
      }

      const rpc = ctx.connection.rpc;

      async function rpcCall(method, payload) {
        const result = await rpc.call(MARKET_RPC_CHANNEL, method, payload || {});
        if (result && result.ok === true) return result.value;
        throw new Error(result?.error?.message || "插件管理请求失败");
      }

      function PluginManagerSection() {
        const [tab, setTab] = react.useState("repo");
        const [search, setSearch] = react.useState("");
        const [category, setCategory] = react.useState("");
        const [filterStatus, setFilterStatus] = react.useState("all"); // 'all' | 'installed' | 'uninstalled'
        const [repoPlugins, setRepoPlugins] = react.useState(FALLBACK_REPO_PLUGINS);
        const [communityPlugins, setCommunityPlugins] = react.useState([]);
        const [categories, setCategories] = react.useState([]);
        const [repoOrigin, setRepoOrigin] = react.useState("veildawn/dsh-plugins");
        const [profile, setProfile] = react.useState("web");
        const [loading, setLoading] = react.useState(false);
        const [loadingCommunity, setLoadingCommunity] = react.useState(false);
        const [feedback, setFeedback] = react.useState("");
        const [feedbackKind, setFeedbackKind] = react.useState("ok");
        const [config, setConfig] = react.useState(null);
        const [draft, setDraft] = react.useState(null);
        const [taskState, setTaskState] = react.useState(null);
        const [restartingState, setRestartingState] = react.useState(null);

        const notify = (text, kind = "ok") => {
          setFeedback(text);
          setFeedbackKind(kind);
          window.setTimeout(() => setFeedback(""), 4000);
        };

        const loadRepo = react.useCallback(async () => {
          setLoading(true);
          try {
            const value = await rpcCall("getRepoPlugins", {});
            setRepoPlugins(value.plugins || FALLBACK_REPO_PLUGINS);
            if (value.repoOrigin) setRepoOrigin(value.repoOrigin);
            if (value.profile) setProfile(value.profile);
          } catch (err) {
            notify(err instanceof Error ? err.message : String(err), "error");
          } finally {
            setLoading(false);
          }
        }, []);

        react.useEffect(() => { void loadRepo(); }, [loadRepo]);

        const loadConfig = react.useCallback(async () => {
          try {
            const value = await rpcCall("getConfig", {});
            setConfig(value);
            setDraft({ ...value });
          } catch { /* non-fatal */ }
        }, []);

        react.useEffect(() => { void loadConfig(); }, [loadConfig]);

        const loadCommunity = react.useCallback(async () => {
          setLoadingCommunity(true);
          try {
            const value = await rpcCall("getCommunityPlugins", {});
            setCommunityPlugins(value.plugins || []);
            setCategories(value.categories || []);
            if (value.count === 0) {
              notify("社区目录为空或加载失败，可检查配置中的目录 URL", "error");
            }
          } catch (err) {
            setCommunityPlugins([]);
            notify(err instanceof Error ? err.message : String(err), "error");
          } finally {
            setLoadingCommunity(false);
          }
        }, []);

        react.useEffect(() => {
          if (tab === "community") void loadCommunity();
        }, [tab, loadCommunity]);

        const pollTask = react.useCallback((taskId) => {
          window.setTimeout(async () => {
            try {
              const task = await rpcCall("getInstallTask", { taskId });
              setTaskState(task);
              if (task.status === "running") {
                pollTask(taskId);
              } else {
                if (task.status === "success") {
                  const actionName = task.kind === "remove" ? "卸载" : "安装/更新";
                  notify(`✓ ${task.name} ${actionName}成功，已刷新列表`);
                  void loadRepo();
                  if (tab === "community") void loadCommunity();
                } else {
                  notify(`✗ ${task.name} 操作失败：${task.error || "未知错误"}`, "error");
                }
              }
            } catch (err) {
              setTaskState((prev) => prev ? { ...prev, status: "error", error: String(err.message || err) } : prev);
              notify("轮询任务状态失败：" + (err instanceof Error ? err.message : String(err)), "error");
            }
          }, 1200);
        }, [tab, loadRepo, loadCommunity]);

        const startInstall = async (name, kind) => {
          if (taskState && taskState.status === "running") {
            notify(`已有任务进行中（${taskState.name}），请等待完成`, "error");
            return;
          }
          try {
            const value = await rpcCall("installPlugin", { name, kind });
            setTaskState({ id: value.taskId, name, kind, status: "running", log: [], error: null });
            pollTask(value.taskId);
          } catch (err) {
            notify(err instanceof Error ? err.message : String(err), "error");
          }
        };

        const startBatchUpdate = async (kind) => {
          if (taskState && taskState.status === "running") {
            notify(`已有任务进行中（${taskState.name}），请等待完成`, "error");
            return;
          }
          const targetList = kind === "repo"
            ? repoPlugins.filter((p) => p.installedVersion && p.hasUpdate)
            : communityPlugins.filter((p) => p.installedVersion && p.hasUpdate && p.npm);

          if (targetList.length === 0) {
            notify("当前没有可更新的插件", "ok");
            return;
          }

          if (!window.confirm(`确定要一键更新全部 ${targetList.length} 款插件吗？（注意：更新后不会自动重启 DSH）`)) {
            return;
          }

          try {
            const value = await rpcCall("batchUpdatePlugins", { kind });
            setTaskState({ id: value.taskId, name: value.name, kind: "batch-update", status: "running", log: [], error: null });
            pollTask(value.taskId);
          } catch (err) {
            notify(err instanceof Error ? err.message : String(err), "error");
          }
        };

        const startRemove = async (name) => {
          if (taskState && taskState.status === "running") {
            notify(`已有任务进行中（${taskState.name}），请等待完成`, "error");
            return;
          }
          if (!window.confirm(`确定要从当前 profile (${profile}) 卸载插件 ${name} 吗？`)) {
            return;
          }
          try {
            const value = await rpcCall("removePlugin", { name });
            setTaskState({ id: value.taskId, name, kind: "remove", status: "running", log: [], error: null });
            pollTask(value.taskId);
          } catch (err) {
            notify(err instanceof Error ? err.message : String(err), "error");
          }
        };

        const startAsyncRestart = async () => {
          if (!window.confirm("确定要平滑重启 DeepSeek Harness 服务吗？前端会在服务就绪后自动恢复连接。")) {
            return;
          }
          try {
            setRestartingState("triggering");
            await rpcCall("restartHost", {});
            notify("已调度异步重启，正在等待服务拉起…", "ok");
            setRestartingState("probing");

            let seenDown = false;
            let successHits = 0;
            let done = false;
            const probeDeadline = Date.now() + 90_000;
            const probeInterval = window.setInterval(async () => {
              if (done) return;
              if (Date.now() > probeDeadline) {
                window.clearInterval(probeInterval);
                done = true;
                setRestartingState("timeout");
                return;
              }
              try {
                const resp = await fetch("/?_ping=" + Date.now(), { cache: "no-store" });
                if (resp.ok) {
                  if (seenDown) {
                    successHits++;
                    if (successHits >= 2) {
                      window.clearInterval(probeInterval);
                      done = true;
                      setRestartingState("ready");
                      window.setTimeout(() => { window.location.reload(); }, 1200);
                    }
                  }
                }
              } catch {
                seenDown = true;
                successHits = 0;
              }
            }, 1000);
          } catch (err) {
            setRestartingState(null);
            notify("调度重启失败：" + (err instanceof Error ? err.message : String(err)), "error");
          }
        };

        const copyCommand = (plugin, kind) => {
          const source = installSourceOf(plugin, kind);
          const cmd = `dsh plugin add --profile ${profile} ${source}`;
          const done = () => { notify(`已复制指令到剪贴板：${cmd}`); };
          
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(cmd).then(done).catch(() => {
              execCopy(cmd);
              done();
            });
          } else {
            execCopy(cmd);
            done();
          }
        };

        const execCopy = (text) => {
          try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.top = "0";
            ta.style.left = "0";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
          } catch {}
        };

        const categoryName = (id) => {
          const found = categories.find((c) => c.id === id);
          return found ? (found.zh || found.en || id) : id;
        };

        const busyFor = (name) => Boolean(taskState && taskState.status === "running" && taskState.name === name);

        /**
         * Unified Card Component: used for both Monorepo (自有插件) and Community plugins.
         */
        const renderPluginCard = (plugin, kind) => {
          const installed = plugin.installedVersion || null;
          const isInstalled = Boolean(installed);
          const remoteVer = plugin.version || plugin.latestVersion || null;
          const update = isInstalled && Boolean(plugin.hasUpdate);
          const busy = busyFor(plugin.name);

          // Badge logic
          let badgeClass = "dm-badge uninstalled";
          let badgeText = "未安装";
          if (update) {
            badgeClass = "dm-badge update";
            badgeText = "可更新";
          } else if (isInstalled) {
            badgeClass = "dm-badge installed";
            badgeText = "已安装";
          } else if (kind === "repo") {
            badgeClass = "dm-badge uninstalled";
            badgeText = "自有";
          } else if (plugin.category) {
            badgeClass = "dm-badge uninstalled";
            badgeText = categoryName(plugin.category);
          }

          // Version row text
          let versionDetails = null;
          if (isInstalled && update) {
            versionDetails = react.createElement(react.Fragment, null,
              react.createElement("span", { className: "dm-ver-installed" }, `当前版本: v${installed}`),
              react.createElement("span", null, " → "),
              react.createElement("span", { className: "dm-ver-latest" }, `远程最新: v${remoteVer}`));
          } else if (isInstalled && !update) {
            versionDetails = react.createElement(react.Fragment, null,
              react.createElement("span", { className: "dm-ver-installed" }, `当前版本: v${installed}`),
              remoteVer ? react.createElement("span", { className: "dm-ver-uptodate" }, ` · 远程最新: v${remoteVer} (已是最新)`) : react.createElement("span", { className: "dm-ver-uptodate" }, " (已是最新)"));
          } else {
            versionDetails = react.createElement("span", { className: "dm-ver-latest" }, remoteVer ? `最新版本: v${remoteVer}` : (plugin.npm ? `包名: ${plugin.npm}` : ""));
          }

          // Primary button label & disabled
          let btnLabel = "⬇ 安装";
          let btnClass = "dm-action-btn primary";
          let btnDisabled = busy;

          if (busy) {
            btnLabel = "正在处理…";
            btnDisabled = true;
          } else if (update) {
            btnLabel = "🔄 更新";
            btnClass = "dm-action-btn primary";
            btnDisabled = false;
          } else if (isInstalled) {
            btnLabel = "✓ 已是最新";
            btnClass = "dm-action-btn";
            btnDisabled = true;
          } else {
            btnLabel = "⬇ 安装";
            btnClass = "dm-action-btn success";
            btnDisabled = false;
          }

          const canInstall = kind === "repo" || Boolean(plugin.npm || plugin.name);

          return react.createElement("div", { className: "dm-card", key: plugin.id },
            react.createElement("div", { className: "dm-card-head" },
              react.createElement("div", null,
                react.createElement("h3", { className: "dm-card-title" }, plugin.title || plugin.name),
                react.createElement("p", { className: "dm-card-name" }, plugin.author ? `${plugin.author} / ${plugin.name}` : plugin.name)),
              react.createElement("span", { className: badgeClass }, badgeText)),
            react.createElement("p", { className: "dm-card-desc" }, plugin.description || "暂无描述"),
            react.createElement("div", { className: "dm-version-row" },
              versionDetails,
              plugin.stars ? react.createElement("span", null, ` · ⭐ ${plugin.stars}`) : null,
              plugin.downloads ? react.createElement("span", null, ` · ⬇ ${plugin.downloads}`) : null),
            react.createElement("div", { className: "dm-card-meta" },
              react.createElement("span", null, plugin.added ? `收录于 ${plugin.added}` : (plugin.author ? `作者: ${plugin.author}` : "")),
              react.createElement("div", { className: "dm-card-actions" },
                plugin.homepage ? react.createElement("a", { className: "dm-action-btn", href: plugin.homepage, target: "_blank", rel: "noreferrer", style: { textDecoration: "none" } }, "源码") : null,
                react.createElement("button", { className: "dm-action-btn", type: "button", disabled: busy, onClick: () => copyCommand(plugin, kind) }, "复制指令"),
                isInstalled ? react.createElement("button", {
                  className: "dm-action-btn danger",
                  type: "button",
                  disabled: busy,
                  onClick: () => void startRemove(plugin.name),
                }, "🗑️ 卸载") : null,
                canInstall ? react.createElement("button", {
                  className: btnClass,
                  type: "button",
                  disabled: btnDisabled,
                  onClick: () => void startInstall(plugin.name, kind),
                }, btnLabel) : null)));
        };

        const saveConfig = async (next) => {
          try {
            const value = await rpcCall("updateConfig", next);
            setConfig(value);
            setDraft({ ...value });
            notify("配置已保存");
            void loadRepo();
            if (tab === "community") void loadCommunity();
          } catch (err) {
            notify(err instanceof Error ? err.message : String(err), "error");
          }
        };

        const q = search.trim().toLowerCase();

        // Status counts for current active tab
        const currentTabList = tab === "repo" ? repoPlugins : communityPlugins;
        const totalCount = currentTabList.length;
        const installedCount = currentTabList.filter((p) => Boolean(p.installedVersion)).length;
        const uninstalledCount = totalCount - installedCount;

        const filteredRepo = repoPlugins.filter((p) => {
          const isInst = Boolean(p.installedVersion);
          if (filterStatus === "installed" && !isInst) return false;
          if (filterStatus === "uninstalled" && isInst) return false;
          if (!q) return true;
          return [p.name, p.title, p.description, (p.tags || []).join(" ")].join(" ").toLowerCase().includes(q);
        });

        const filteredCommunity = communityPlugins.filter((p) => {
          const isInst = Boolean(p.installedVersion);
          if (filterStatus === "installed" && !isInst) return false;
          if (filterStatus === "uninstalled" && isInst) return false;
          if (category && p.category !== category) return false;
          if (!q) return true;
          return [p.name, p.title, p.description, p.npm, (p.tags || []).join(" ")].join(" ").toLowerCase().includes(q);
        });

        const repoUpdateCount = repoPlugins.filter((p) => p.installedVersion && p.hasUpdate).length;
        const communityUpdateCount = communityPlugins.filter((p) => p.installedVersion && p.hasUpdate && p.npm).length;

        const taskStatusText = taskState
          ? taskState.status === "running" ? "进行中…" : taskState.status === "success" ? "✓ 成功" : "✗ 失败"
          : "";

        const taskHeaderTitle = taskState
          ? `${taskState.kind === "remove" ? "卸载任务" : taskState.kind === "batch-update" ? "批量更新任务" : "安装/更新任务"}：${taskState.name}（${taskStatusText}）`
          : "";

        return react.createElement("div", { className: "dm-container" },
          react.createElement("style", null, css),
          react.createElement("h2", { className: "dm-title" },
            react.createElement(IconPluginManager16, { size: 20 }),
            react.createElement("span", null, "插件管理")),
          react.createElement("p", { className: "dm-subtitle" }, "管理自有插件更新与卸载，浏览并一键安装 2200+ 社区精选插件。"),
          feedback ? react.createElement("div", { className: `dm-feedback ${feedbackKind}`, role: "status" }, feedback) : null,
          restartingState ? react.createElement("div", { className: "dm-restart-modal" },
            react.createElement("div", { style: { fontSize: "15px", fontWeight: "600" } },
              restartingState === "ready" ? "✓ 服务重启完成！"
                : restartingState === "timeout" ? "⚠️ 服务重启超时"
                  : "🔄 正在平滑重启 DeepSeek Harness 服务…"),
            react.createElement("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary)" } },
              restartingState === "ready" ? "新实例已就绪，正在自动刷新页面恢复..."
                : restartingState === "timeout" ? "90 秒内未能确认新实例就绪。请检查服务进程或稍后手动重试。"
                  : "后台正在重新拉起守护进程，前端正自动探测端口并在就绪后无缝恢复，请稍候..."),
            restartingState === "timeout" ? react.createElement("button", {
              className: "dm-action-btn primary",
              type: "button",
              onClick: () => setRestartingState(null),
            }, "知道了") : null)
            : null,
          react.createElement("div", { className: "dm-repo-banner" },
            react.createElement("div", { className: "dm-repo-info" },
              "📦 自有仓库: ", react.createElement("strong", null, repoOrigin),
              " · 当前 profile: ", react.createElement("strong", null, profile)),
            react.createElement("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
              react.createElement("button", {
                className: "dm-action-btn warning",
                type: "button",
                disabled: Boolean(restartingState),
                onClick: startAsyncRestart,
              }, restartingState ? "重启中…" : "🔄 立即重启 DSH 服务"),
              react.createElement("span", { className: "dm-badge repo" }, `自有 ${repoPlugins.length} 款 · 社区 ${communityPlugins.length} 款`))),
          taskState ? react.createElement("div", { className: "dm-install-box" },
            react.createElement("div", { className: "dm-install-head" },
              react.createElement("span", null, taskHeaderTitle),
              react.createElement("span", null, taskState.profile || "")),
            react.createElement("pre", { className: "dm-install-log" }, (taskState.log || []).slice(-20).join("\n") || "等待任务输出…"))
            : null,
          react.createElement("div", { className: "dm-tabs" },
            react.createElement("button", { className: `dm-tab-btn ${tab === "repo" ? "active" : ""}`, type: "button", onClick: () => setTab("repo") }, "自有插件"),
            react.createElement("button", { className: `dm-tab-btn ${tab === "community" ? "active" : ""}`, type: "button", onClick: () => setTab("community") }, "社区插件"),
            react.createElement("button", { className: `dm-tab-btn ${tab === "config" ? "active" : ""}`, type: "button", onClick: () => setTab("config") }, "配置")),
          tab !== "config" ? react.createElement("div", { className: "dm-toolbar" },
            react.createElement("div", { className: "dm-toolbar-left" },
              react.createElement("div", { className: "dm-filter-group" },
                react.createElement("button", {
                  className: `dm-filter-btn ${filterStatus === "all" ? "active" : ""}`,
                  type: "button",
                  onClick: () => setFilterStatus("all"),
                }, `全部 (${totalCount})`),
                react.createElement("button", {
                  className: `dm-filter-btn ${filterStatus === "installed" ? "active" : ""}`,
                  type: "button",
                  onClick: () => setFilterStatus("installed"),
                }, `已安装 (${installedCount})`),
                react.createElement("button", {
                  className: `dm-filter-btn ${filterStatus === "uninstalled" ? "active" : ""}`,
                  type: "button",
                  onClick: () => setFilterStatus("uninstalled"),
                }, `未安装 (${uninstalledCount})`)),
              react.createElement("input", {
                type: "text",
                className: "dm-search-box",
                placeholder: "搜索插件名称、描述或标签（如 terminal、vision、路由）…",
                value: search,
                onChange: (e) => setSearch(e.target.value),
              })),
            react.createElement("div", { className: "dm-toolbar-right" },
              tab === "repo" ? react.createElement(react.Fragment, null,
                react.createElement("button", {
                  className: "dm-action-btn primary",
                  type: "button",
                  disabled: Boolean(taskState && taskState.status === "running") || repoUpdateCount === 0,
                  onClick: () => void startBatchUpdate("repo"),
                }, `🚀 一键更新全部 (${repoUpdateCount})`),
                react.createElement("button", { className: "dm-action-btn", type: "button", disabled: loading, onClick: () => void loadRepo() }, loading ? "正在同步…" : "🔄 检查最新更新"))
                : null,
              tab === "community" ? react.createElement(react.Fragment, null,
                react.createElement("button", {
                  className: "dm-action-btn primary",
                  type: "button",
                  disabled: Boolean(taskState && taskState.status === "running") || communityUpdateCount === 0,
                  onClick: () => void startBatchUpdate("community"),
                }, `🚀 一键更新全部 (${communityUpdateCount})`),
                react.createElement("button", { className: "dm-action-btn", type: "button", disabled: loadingCommunity, onClick: () => void loadCommunity() }, loadingCommunity ? "正在刷新…" : "🔄 刷新社区目录"))
                : null)) : null,
          tab === "repo" ? (
            filteredRepo.length === 0
              ? react.createElement("div", { className: "dm-empty" }, "没有匹配的自有插件")
              : react.createElement("div", { className: "dm-grid" }, ...filteredRepo.map((p) => renderPluginCard(p, "repo")))
          ) : null,
          tab === "community" ? react.createElement(react.Fragment, null,
            categories.length > 0 ? react.createElement("div", { className: "dm-chips" },
              react.createElement("button", { className: `dm-chip ${category === "" ? "active" : ""}`, type: "button", onClick: () => setCategory("") }, "全部"),
              ...categories.map((c) => react.createElement("button", { className: `dm-chip ${category === c.id ? "active" : ""}`, type: "button", key: c.id, onClick: () => setCategory(c.id) }, c.zh || c.en || c.id)))
              : null,
            loadingCommunity
              ? react.createElement("div", { className: "dm-empty" }, "正在加载社区插件索引…")
              : (filteredCommunity.length === 0
                  ? react.createElement("div", { className: "dm-empty" },
                      q || category || filterStatus !== "all" ? "没有匹配的社区插件" : "社区插件索引为空或加载失败。",
                      react.createElement("br", null),
                      react.createElement("a", { href: "https://awesome-dsh-plugin.com", target: "_blank", rel: "noreferrer", style: { color: "var(--dsw-alias-brand-primary)" } }, "🌐 访问 Awesome DSH Plugins 官方导航"),
                      react.createElement("br", null),
                      react.createElement("button", { className: "dm-action-btn", type: "button", onClick: () => void loadCommunity() }, "重试"))
                  : react.createElement(react.Fragment, null,
                      filteredCommunity.length > 100
                        ? react.createElement("div", { className: "dm-empty", style: { padding: "6px" } }, `共 ${filteredCommunity.length} 个结果，显示前 100 个，请用搜索或分类缩小范围`)
                        : null,
                      react.createElement("div", { className: "dm-grid" }, ...filteredCommunity.slice(0, 100).map((p) => renderPluginCard(p, "community")))))
          ) : null,
          tab === "config" ? (
            react.createElement("div", { className: "dm-config" },
              react.createElement("label", { className: "dm-field" },
                react.createElement("span", { className: "dm-label" }, "插件仓库 (GitHub origin)"),
                react.createElement("input", { className: "dm-input", value: draft?.repoOrigin || "", placeholder: "owner/repo", onChange: (e) => setDraft((d) => ({ ...d, repoOrigin: e.target.value })) })),
              react.createElement("label", { className: "dm-field" },
                react.createElement("span", { className: "dm-label" }, "社区插件目录 URL"),
                react.createElement("input", { className: "dm-input", value: draft?.communityCatalogUrl || "", placeholder: "https://…/plugins.json", onChange: (e) => setDraft((d) => ({ ...d, communityCatalogUrl: e.target.value })) })),
              react.createElement("label", { className: "dm-field" },
                react.createElement("span", { className: "dm-label" }, "下载镜像前缀 (可选，如 https://gh-proxy.com/)"),
                react.createElement("input", { className: "dm-input", value: draft?.mirrorUrl || "", placeholder: "留空则直接使用 GitHub", onChange: (e) => setDraft((d) => ({ ...d, mirrorUrl: e.target.value })) })),
              react.createElement("label", { className: "dm-check" },
                react.createElement("input", { type: "checkbox", checked: Boolean(draft?.autoCheckUpdates), onChange: (e) => setDraft((d) => ({ ...d, autoCheckUpdates: e.target.checked })) }),
                "打开市场时自动检查更新"),
              react.createElement("div", { className: "dm-card-actions" },
                react.createElement("button", { className: "dm-action-btn", type: "button", onClick: () => setDraft({ ...config }) }, "撤销"),
                react.createElement("button", { className: "dm-action-btn primary", type: "button", onClick: () => saveConfig(draft || {}) }, "保存配置")))
          ) : null);
      }

      const label = () => react.createElement("span", {
        "data-settings-nav-label": "plugin-manager",
        style: { display: "inline-flex", alignItems: "center", gap: 8 },
      },
        react.createElement(IconPluginManager16, { size: 16 }),
        react.createElement("span", null, "插件管理")
      );

      ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({
        name: SETTINGS_SLOT,
        id: "plugin-manager",
        order: 35,
        label,
        inject: () => ({ rpc }),
      }, PluginManagerSection));
    }

    exports.apply = apply;
    exports.inject = ["slots", "connection"];
    return module.exports;
  },
});
