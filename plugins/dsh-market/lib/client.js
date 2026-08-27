/**
 * dsh-market client bundle
 *
 * Renders the Visual Plugin Market in Settings -> Plugin Market (插件市场):
 * 1. 本仓库 (Monorepo) 插件与更新管理：实时拉取 GitHub Releases，比对当前
 *    profile 已安装版本，一键安装 / 更新（服务端执行 `dsh plugin add`，
 *    客户端轮询任务进度并显示日志）。
 * 2. 社区插件浏览：按分类筛选、搜索、一键安装（npm 包），来自
 *    awesome-dsh-plugin 社区目录。
 * 3. 配置页：仓库源 / 社区目录 URL / 镜像 / 自动检查开关。
 *
 * All data flows through the loopback RPC channel `/dsh-market-rpc`
 * (ctx.connection.rpc.call), the same wiring pattern as dsh-model-roles.
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
  id: "dsh-market",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");

    const MARKET_RPC_CHANNEL = "/dsh-market-rpc";
    const SETTINGS_SLOT = "settings.section";

    const css = `
      .dm-container{display:flex;flex-direction:column;gap:14px;width:100%;max-width:920px;color:var(--dsw-alias-label-primary,#1f2328);font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif);color-scheme:light dark}
      .dm-title{font-size:20px;font-weight:600;margin:0}.dm-subtitle{font-size:13px;color:var(--dsw-alias-label-tertiary,#656d76);margin:0;line-height:20px}
      .dm-tabs{display:flex;gap:8px;border-bottom:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,.1));padding-bottom:8px}
      .dm-tab-btn{padding:6px 14px;border-radius:6px;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#57606a);font-size:14px;cursor:pointer;font-weight:500;transition:all .15s ease}
      .dm-tab-btn:hover{background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary,#1f2328)}
      .dm-tab-btn.active{background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff}
      .dm-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
      .dm-search-box{flex:1;min-width:200px;height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-default,#d0d7de);background:var(--dsw-alias-background-base,#fff);color:var(--dsw-alias-label-primary,#1f2328);outline:none;font-size:13px}
      .dm-search-box:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 20%,transparent)}
      .dm-action-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 14px;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;border:1px solid var(--dsw-alias-border-default,#d0d7de);background:var(--dsw-alias-background-base,#fff);color:var(--dsw-alias-label-primary,#1f2328);transition:all .15s ease}
      .dm-action-btn:hover{background:var(--dsw-alias-bg-module-platform,#f6f8fa)}.dm-action-btn:disabled{opacity:.55;cursor:default}
      .dm-action-btn.primary{background:var(--dsw-alias-brand-primary,#4d6bfe);border-color:transparent;color:#fff}
      .dm-action-btn.primary:hover{opacity:.9}
      .dm-action-btn.success{border-color:transparent;background:#10b981;color:#fff}
      .dm-repo-banner{padding:12px 16px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 8%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 25%,transparent);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
      .dm-repo-info{font-size:13px;color:var(--dsw-alias-label-primary,#1f2328)}
      .dm-chips{display:flex;gap:6px;flex-wrap:wrap}
      .dm-chip{padding:4px 12px;border-radius:14px;border:1px solid var(--dsw-alias-border-default,#d0d7de);background:var(--dsw-alias-background-base,#fff);color:var(--dsw-alias-label-secondary,#57606a);font-size:12px;cursor:pointer;transition:all .15s ease}
      .dm-chip:hover{border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-brand-primary,#4d6bfe)}
      .dm-chip.active{background:var(--dsw-alias-brand-primary,#4d6bfe);border-color:transparent;color:#fff}
      .dm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}
      .dm-card{padding:14px;border-radius:10px;border:1px solid var(--dsw-alias-border-subtle,#e1e4e8);background:var(--dsw-alias-background-base,#fff);display:flex;flex-direction:column;justify-content:space-between;gap:10px;transition:box-shadow .15s ease}
      .dm-card:hover{box-shadow:0 4px 12px rgba(0,0,0,.06)}
      .dm-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
      .dm-card-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2328);margin:0}
      .dm-card-name{font-size:11px;color:var(--dsw-alias-label-tertiary,#656d76);margin:2px 0 0}
      .dm-badge{font-size:11px;padding:2px 6px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 12%,transparent);color:var(--dsw-alias-brand-primary,#4d6bfe);font-weight:500;white-space:nowrap}
      .dm-badge.repo{background:color-mix(in srgb,#10b981 15%,transparent);color:#059669}
      .dm-badge.update{background:color-mix(in srgb,#d98e00 15%,transparent);color:#b76e00}
      .dm-card-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#57606a);margin:0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
      .dm-version-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-tertiary,#656d76)}
      .dm-card-meta{display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--dsw-alias-label-tertiary,#656d76);border-top:1px solid var(--dsw-alias-border-subtle,#f0f0f0);padding-top:8px;gap:8px;flex-wrap:wrap}
      .dm-card-actions{display:flex;align-items:center;gap:6px}
      .dm-feedback{padding:9px 11px;border-radius:8px;font-size:12px;line-height:18px}.dm-feedback.ok{background:color-mix(in srgb,#10b981 10%,transparent);color:#059669}.dm-feedback.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 10%,transparent);color:var(--dsw-alias-state-error-primary,#d84848)}
      .dm-empty{padding:32px 16px;text-align:center;color:var(--dsw-alias-label-tertiary,#656d76);font-size:13px}
      .dm-install-box{border:1px solid var(--dsw-alias-border-default,#d0d7de);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#f6f8fa);overflow:hidden}
      .dm-install-head{padding:8px 12px;font-size:12px;font-weight:600;border-bottom:1px solid var(--dsw-alias-border-subtle,#e1e4e8);display:flex;justify-content:space-between;align-items:center;gap:8px}
      .dm-install-log{margin:0;padding:8px 12px;max-height:160px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#57606a);white-space:pre-wrap;word-break:break-all}
      .dm-config{display:flex;flex-direction:column;gap:12px;max-width:640px}
      .dm-field{display:flex;flex-direction:column;gap:5px}.dm-label{color:var(--dsw-alias-label-secondary,#57606a);font-size:12px;font-weight:500}
      .dm-input{box-sizing:border-box;width:100%;height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-default,#d0d7de);border-radius:8px;outline:none;background:var(--dsw-alias-background-base,#fff);color:var(--dsw-alias-label-primary,#1f2328);font-size:13px}
      .dm-input:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 18%,transparent)}
      .dm-check{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary,#57606a);font-size:13px}
      @media(max-width:640px){.dm-grid{grid-template-columns:1fr}.dm-toolbar{flex-direction:column;align-items:stretch}.dm-search-box{min-width:0}}
    `;

    const FALLBACK_REPO_PLUGINS = [
      { id: "dsh-market", name: "dsh-market", title: "插件市场与更新管理器", description: "DSH 官方社区插件市场，支持浏览、安装社区插件，以及一键检查与更新本仓库全量插件。", author: "veildawn", category: "tools", version: "0.1.0", latestVersion: "0.1.0", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-market@v0.1.0/dsh-market-0.1.0.tgz", isRepoPlugin: true, installedVersion: null, hasUpdate: false },
      { id: "dsh-model-roles", name: "dsh-model-roles", title: "模型角色分工与路由", description: "OMP 风格的多模型智能分工与角色路由，支持计划模式、识图子代理分析与顾问复核 (/advisor)。", author: "veildawn", category: "ai", version: "0.4.8", latestVersion: "0.4.8", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.8/dsh-model-roles-0.4.8.tgz", isRepoPlugin: true, installedVersion: null, hasUpdate: false },
      { id: "dsh-remote-control", name: "dsh-remote-control", title: "远程访问与安全通道", description: "Token 密钥认证、密码锁屏门禁 Unlock Screen、特权 RPC 白名单桥接与局域网无感放行。", author: "veildawn", category: "security", version: "0.1.6", latestVersion: "0.1.6", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-remote-control@v0.1.6/dsh-remote-control-0.1.6.tgz", isRepoPlugin: true, installedVersion: null, hasUpdate: false },
      { id: "dsh-ai-proxy", name: "dsh-ai-proxy", title: "AI Proxy 网关与 Provider", description: "AI Proxy Service 统一网关对接，支持 Chat/Anthropic/Responses 多协议智能适配与 OAuth 2.0 PKCE 认证。", author: "veildawn", category: "ai", version: "0.2.5", latestVersion: "0.2.5", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-ai-proxy@v0.2.5/dsh-ai-proxy-0.2.5.tgz", isRepoPlugin: true, installedVersion: null, hasUpdate: false },
      { id: "dsh-mobile-adapter", name: "dsh-mobile-adapter", title: "移动端全量体验优化", description: "原生图片上传、底部操作栏圆形统一规范、视口高度自适应、Segmented Control Tabs。", author: "veildawn", category: "ui", version: "0.1.27", latestVersion: "0.1.27", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-mobile-adapter@v0.1.27/dsh-mobile-adapter-0.1.27.tgz", isRepoPlugin: true, installedVersion: null, hasUpdate: false },
      { id: "dsh-file-viewer", name: "dsh-file-viewer", title: "工作区文件查看器", description: "会话头部抽屉式文件浏览器，支持全屏切换、语法高亮、Markdown/JSON、图片、PDF、Excel、Word 预览。", author: "veildawn", category: "tools", version: "0.1.8", latestVersion: "0.1.8", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-file-viewer@v0.1.8/dsh-file-viewer-0.1.8.tgz", isRepoPlugin: true, installedVersion: null, hasUpdate: false },
      { id: "dsh-terminal", name: "dsh-terminal", title: "跨平台交互式终端", description: "本地终端调用、移动端专属对话框底部工具箱二合一入口、多标签并发与触控辅助键盘。", author: "veildawn", category: "tools", version: "0.1.9", latestVersion: "0.1.9", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-terminal@v0.1.9/dsh-terminal-0.1.9.tgz", isRepoPlugin: true, installedVersion: null, hasUpdate: false },
    ];

    function installSourceOf(plugin, kind) {
      if (kind === "community") return plugin.npm || plugin.name;
      return plugin.downloadUrl || "";
    }

    function apply(ctx) {
      const rpc = ctx.connection.rpc;

      async function rpcCall(method, payload) {
        const result = await rpc.call(MARKET_RPC_CHANNEL, method, payload || {});
        if (result && result.ok === true) return result.value;
        throw new Error(result?.error?.message || "插件市场请求失败");
      }

      function MarketSection() {
        const [tab, setTab] = react.useState("repo");
        const [search, setSearch] = react.useState("");
        const [category, setCategory] = react.useState("");
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
        const [installTask, setInstallTask] = react.useState(null);

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

        const pollInstall = react.useCallback((taskId) => {
          window.setTimeout(async () => {
            try {
              const task = await rpcCall("getInstallTask", { taskId });
              setInstallTask(task);
              if (task.status === "running") {
                pollInstall(taskId);
              } else {
                if (task.status === "success") {
                  notify(`✓ ${task.name} 安装成功，已刷新列表`);
                  void loadRepo();
                } else {
                  notify(`✗ ${task.name} 安装失败：${task.error || "未知错误"}`, "error");
                }
              }
            } catch (err) {
              setInstallTask((prev) => prev ? { ...prev, status: "error", error: String(err.message || err) } : prev);
              notify("轮询安装状态失败：" + (err instanceof Error ? err.message : String(err)), "error");
            }
          }, 1200);
        }, []);

        const startInstall = async (name, kind) => {
          if (installTask && installTask.status === "running") {
            notify(`已有安装任务进行中（${installTask.name}），请等待完成`, "error");
            return;
          }
          try {
            const value = await rpcCall("installPlugin", { name, kind });
            setInstallTask({ id: value.taskId, name, kind, status: "running", log: [], error: null });
            pollInstall(value.taskId);
          } catch (err) {
            notify(err instanceof Error ? err.message : String(err), "error");
          }
        };

        const copyCommand = (plugin, kind) => {
          const source = installSourceOf(plugin, kind);
          const cmd = `dsh plugin add --profile ${profile} ${source}`;
          const done = () => { notify(`已复制指令：${cmd}`); };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(cmd).then(done, done);
          } else {
            window.prompt("复制以下安装/更新指令：", cmd);
          }
        };

        const categoryName = (id) => {
          const found = categories.find((c) => c.id === id);
          return found ? (found.zh || found.en || id) : id;
        };

        const busyFor = (name) => Boolean(installTask && installTask.status === "running" && installTask.name === name);

        const repoCard = (plugin) => {
          const installed = plugin.installedVersion;
          const update = Boolean(installed) && plugin.hasUpdate;
          const busy = busyFor(plugin.name);
          const primaryLabel = busy ? "安装中…" : (update ? "更新" : (installed ? "已是最新" : "安装"));
          const primaryDisabled = busy || (!update && Boolean(installed));
          return react.createElement("div", { className: "dm-card", key: plugin.id },
            react.createElement("div", { className: "dm-card-head" },
              react.createElement("div", null,
                react.createElement("h3", { className: "dm-card-title" }, plugin.title || plugin.name),
                react.createElement("p", { className: "dm-card-name" }, plugin.name)),
              react.createElement("span", { className: update ? "dm-badge update" : "dm-badge repo" }, update ? "可更新" : "本仓库")),
            react.createElement("p", { className: "dm-card-desc" }, plugin.description || "暂无描述"),
            react.createElement("div", { className: "dm-version-row" },
              installed
                ? react.createElement(react.Fragment, null,
                    react.createElement("span", null, "已安装 ", installed),
                    update ? react.createElement("span", null, "→ 最新 ", plugin.version) : react.createElement("span", null, "（已是最新）"))
                : react.createElement("span", null, "最新版本 ", plugin.version)),
            react.createElement("div", { className: "dm-card-meta" },
              react.createElement("span", null, `作者: ${plugin.author || "veildawn"}`),
              react.createElement("div", { className: "dm-card-actions" },
                react.createElement("button", { className: "dm-action-btn", type: "button", disabled: busy, onClick: () => copyCommand(plugin, "repo") }, "复制指令"),
                react.createElement("button", {
                  className: "dm-action-btn " + (update ? "primary" : "success"),
                  type: "button",
                  disabled: primaryDisabled,
                  onClick: () => void startInstall(plugin.name, "repo"),
                }, primaryLabel))));
        };

        const communityCard = (plugin) => {
          const busy = busyFor(plugin.name);
          const installable = Boolean(plugin.npm || plugin.name);
          return react.createElement("div", { className: "dm-card", key: plugin.id },
            react.createElement("div", { className: "dm-card-head" },
              react.createElement("div", null,
                react.createElement("h3", { className: "dm-card-title" }, plugin.title || plugin.name),
                react.createElement("p", { className: "dm-card-name" }, plugin.author ? `${plugin.author} / ${plugin.name}` : plugin.name)),
              plugin.category ? react.createElement("span", { className: "dm-badge" }, categoryName(plugin.category)) : null),
            react.createElement("p", { className: "dm-card-desc" }, plugin.description || "暂无描述"),
            react.createElement("div", { className: "dm-version-row" },
              react.createElement("span", null, "⭐ ", plugin.stars || 0),
              react.createElement("span", null, "⬇ ", plugin.downloads || 0),
              plugin.npm ? react.createElement("span", null, plugin.npm) : null),
            react.createElement("div", { className: "dm-card-meta" },
              react.createElement("span", null, plugin.added ? `收录于 ${plugin.added}` : ""),
              react.createElement("div", { className: "dm-card-actions" },
                plugin.homepage ? react.createElement("a", { className: "dm-action-btn", href: plugin.homepage, target: "_blank", rel: "noreferrer", style: { textDecoration: "none" } }, "源码") : null,
                react.createElement("button", { className: "dm-action-btn", type: "button", disabled: busy, onClick: () => copyCommand(plugin, "community") }, "复制指令"),
                installable ? react.createElement("button", {
                  className: "dm-action-btn primary",
                  type: "button",
                  disabled: busy,
                  onClick: () => void startInstall(plugin.name, "community"),
                }, busy ? "安装中…" : "安装") : null)));
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
        const filteredRepo = repoPlugins.filter((p) => {
          if (!q) return true;
          return [p.name, p.title, p.description, (p.tags || []).join(" ")].join(" ").toLowerCase().includes(q);
        });
        const filteredCommunity = communityPlugins.filter((p) => {
          if (category && p.category !== category) return false;
          if (!q) return true;
          return [p.name, p.title, p.description, p.npm, (p.tags || []).join(" ")].join(" ").toLowerCase().includes(q);
        });

        const installStatusText = installTask
          ? installTask.status === "running" ? "进行中…" : installTask.status === "success" ? "✓ 成功" : "✗ 失败"
          : "";

        return react.createElement("div", { className: "dm-container" },
          react.createElement("style", null, css),
          react.createElement("h2", { className: "dm-title" }, "🔌 插件市场"),
          react.createElement("p", { className: "dm-subtitle" }, "浏览并一键安装社区插件，管理本插件仓库（Monorepo）的独立版本发布与更新。"),
          feedback ? react.createElement("div", { className: `dm-feedback ${feedbackKind}`, role: "status" }, feedback) : null,
          react.createElement("div", { className: "dm-repo-banner" },
            react.createElement("div", { className: "dm-repo-info" },
              "📦 插件仓库: ", react.createElement("strong", null, repoOrigin),
              " · 当前 profile: ", react.createElement("strong", null, profile)),
            react.createElement("span", { className: "dm-badge repo" }, `本仓库 ${repoPlugins.length} 款 · 社区 ${communityPlugins.length} 款`)),
          installTask ? react.createElement("div", { className: "dm-install-box" },
            react.createElement("div", { className: "dm-install-head" },
              react.createElement("span", null, `安装任务：${installTask.name}（${installStatusText}）`),
              react.createElement("span", null, installTask.profile || "")),
            react.createElement("pre", { className: "dm-install-log" }, (installTask.log || []).slice(-15).join("\n") || "等待任务输出…"))
            : null,
          react.createElement("div", { className: "dm-tabs" },
            react.createElement("button", { className: `dm-tab-btn ${tab === "repo" ? "active" : ""}`, type: "button", onClick: () => setTab("repo") }, "本仓库插件与更新"),
            react.createElement("button", { className: `dm-tab-btn ${tab === "community" ? "active" : ""}`, type: "button", onClick: () => setTab("community") }, "社区插件"),
            react.createElement("button", { className: `dm-tab-btn ${tab === "config" ? "active" : ""}`, type: "button", onClick: () => setTab("config") }, "配置")),
          react.createElement("div", { className: "dm-toolbar" },
            react.createElement("input", { type: "text", className: "dm-search-box", placeholder: "搜索插件名称、描述或标签（如 terminal、vision、路由）…", value: search, onChange: (e) => setSearch(e.target.value) }),
            tab === "repo" ? react.createElement("button", { className: "dm-action-btn primary", type: "button", disabled: loading, onClick: () => void loadRepo() }, loading ? "正在同步…" : "🔄 检查最新更新") : null),
          tab === "repo" ? (
            filteredRepo.length === 0
              ? react.createElement("div", { className: "dm-empty" }, "没有匹配的插件")
              : react.createElement("div", { className: "dm-grid" }, ...filteredRepo.map(repoCard))
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
                      q || category ? "没有匹配的插件" : "社区插件索引为空或加载失败。",
                      react.createElement("br", null),
                      react.createElement("a", { href: "https://awesome-dsh-plugin.com", target: "_blank", rel: "noreferrer", style: { color: "var(--dsw-alias-brand-primary)" } }, "🌐 访问 Awesome DSH Plugins 官方导航"),
                      react.createElement("br", null),
                      react.createElement("button", { className: "dm-action-btn", type: "button", onClick: () => void loadCommunity() }, "重试"))
                  : react.createElement(react.Fragment, null,
                      filteredCommunity.length > 100
                        ? react.createElement("div", { className: "dm-empty", style: { padding: "6px" } }, `共 ${filteredCommunity.length} 个结果，显示前 100 个，请用搜索或分类缩小范围`)
                        : null,
                      react.createElement("div", { className: "dm-grid" }, ...filteredCommunity.slice(0, 100).map(communityCard))))
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

      const label = () => react.createElement("span", { "data-settings-nav-label": "market" }, "插件市场");
      ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({
        name: SETTINGS_SLOT,
        id: "market",
        order: 35,
        label,
        inject: () => ({ rpc }),
      }, MarketSection));
    }

    exports.apply = apply;
    exports.inject = ["slots", "connection"];
    return module.exports;
  },
});
