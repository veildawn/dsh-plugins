/**
 * dsh-market client bundle
 *
 * Renders the Visual Plugin Market in Settings -> Plugin Market (插件市场):
 * 1. 本仓库 (Monorepo) 插件与更新管理：实时拉取 GitHub Releases，比对当前
 *    profile 已安装版本，标记可更新项并一键复制安装/更新指令。
 * 2. 社区插件浏览：从配置的 catalog（awesome-dsh-plugin）拉取并搜索。
 * 3. 配置页：仓库源 / 镜像 / 自动检查开关（写入 market 设置命名空间）。
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
      .dm-container{display:flex;flex-direction:column;gap:16px;width:100%;max-width:880px;color:var(--dsw-alias-label-primary,#1f2328);font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif);color-scheme:light dark}
      .dm-title{font-size:20px;font-weight:600;margin:0}.dm-subtitle{font-size:13px;color:var(--dsw-alias-label-tertiary,#656d76);margin:0;line-height:20px}
      .dm-tabs{display:flex;gap:8px;border-bottom:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,.1));padding-bottom:8px}
      .dm-tab-btn{padding:6px 14px;border-radius:6px;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#57606a);font-size:14px;cursor:pointer;font-weight:500;transition:all .15s ease}
      .dm-tab-btn:hover{background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary,#1f2328)}
      .dm-tab-btn.active{background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff}
      .dm-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
      .dm-search-box{flex:1;min-width:200px;height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-default,#d0d7de);background:var(--dsw-alias-background-base,#fff);color:var(--dsw-alias-label-primary,#1f2328);outline:none;font-size:13px}
      .dm-search-box:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 20%,transparent)}
      .dm-action-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 14px;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;border:1px solid var(--dsw-alias-border-default,#d0d7de);background:var(--dsw-alias-background-base,#fff);color:var(--dsw-alias-label-primary,#1f2328);transition:all .15s ease}
      .dm-action-btn:hover{background:var(--dsw-alias-bg-module-platform,#f6f8fa)}.dm-action-btn:disabled{opacity:.55;cursor:default}
      .dm-action-btn.primary{background:var(--dsw-alias-brand-primary,#4d6bfe);border-color:transparent;color:#fff}
      .dm-action-btn.primary:hover{opacity:.9}
      .dm-action-btn.success{border-color:transparent;background:#10b981;color:#fff}
      .dm-repo-banner{padding:12px 16px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 8%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 25%,transparent);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
      .dm-repo-info{font-size:13px;color:var(--dsw-alias-label-primary,#1f2328)}
      .dm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px}
      .dm-card{padding:14px;border-radius:10px;border:1px solid var(--dsw-alias-border-subtle,#e1e4e8);background:var(--dsw-alias-background-base,#fff);display:flex;flex-direction:column;justify-content:space-between;gap:10px;transition:box-shadow .15s ease}
      .dm-card:hover{box-shadow:0 4px 12px rgba(0,0,0,.06)}
      .dm-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
      .dm-card-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2328);margin:0}
      .dm-card-name{font-size:11px;color:var(--dsw-alias-label-tertiary,#656d76);margin:2px 0 0}
      .dm-badge{font-size:11px;padding:2px 6px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 12%,transparent);color:var(--dsw-alias-brand-primary,#4d6bfe);font-weight:500;white-space:nowrap}
      .dm-badge.repo{background:color-mix(in srgb,#10b981 15%,transparent);color:#059669}
      .dm-badge.update{background:color-mix(in srgb,#d98e00 15%,transparent);color:#b76e00}
      .dm-card-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#57606a);margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .dm-version-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-tertiary,#656d76)}
      .dm-card-meta{display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--dsw-alias-label-tertiary,#656d76);border-top:1px solid var(--dsw-alias-border-subtle,#f0f0f0);padding-top:8px;gap:8px;flex-wrap:wrap}
      .dm-card-actions{display:flex;align-items:center;gap:6px}
      .dm-feedback{padding:9px 11px;border-radius:8px;font-size:12px;line-height:18px}.dm-feedback.ok{background:color-mix(in srgb,#10b981 10%,transparent);color:#059669}.dm-feedback.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 10%,transparent);color:var(--dsw-alias-state-error-primary,#d84848)}
      .dm-empty{padding:32px 16px;text-align:center;color:var(--dsw-alias-label-tertiary,#656d76);font-size:13px}
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
      { id: "dsh-remote-control", name: "dsh-remote-control", title: "远程访问与安全通道", description: "Token 密钥认证、密码锁屏门禁 Unlock Screen、特权 RPC 白名单桥接与局域网无感放行。", author: "veildawn", category: "security", version: "0.1.5", latestVersion: "0.1.5", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-remote-control@v0.1.5/dsh-remote-control-0.1.5.tgz", isRepoPlugin: true, installedVersion: null, hasUpdate: false },
      { id: "dsh-ai-proxy", name: "dsh-ai-proxy", title: "AI Proxy 网关与 Provider", description: "AI Proxy Service 统一网关对接，支持 Chat/Anthropic/Responses 多协议智能适配与 OAuth 2.0 PKCE 认证。", author: "veildawn", category: "ai", version: "0.2.5", latestVersion: "0.2.5", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-ai-proxy@v0.2.5/dsh-ai-proxy-0.2.5.tgz", isRepoPlugin: true, installedVersion: null, hasUpdate: false },
      { id: "dsh-mobile-adapter", name: "dsh-mobile-adapter", title: "移动端全量体验优化", description: "原生图片上传、底部操作栏圆形统一规范、视口高度自适应、Segmented Control Tabs。", author: "veildawn", category: "ui", version: "0.1.26", latestVersion: "0.1.26", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-mobile-adapter@v0.1.26/dsh-mobile-adapter-0.1.26.tgz", isRepoPlugin: true, installedVersion: null, hasUpdate: false },
      { id: "dsh-file-viewer", name: "dsh-file-viewer", title: "工作区文件查看器", description: "会话头部抽屉式文件浏览器，支持全屏切换、语法高亮、Markdown/JSON、图片、PDF、Excel、Word 预览。", author: "veildawn", category: "tools", version: "0.1.8", latestVersion: "0.1.8", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-file-viewer@v0.1.8/dsh-file-viewer-0.1.8.tgz", isRepoPlugin: true, installedVersion: null, hasUpdate: false },
      { id: "dsh-terminal", name: "dsh-terminal", title: "跨平台交互式终端", description: "本地终端调用、移动端专属对话框底部工具箱二合一入口、多标签并发与触控辅助键盘。", author: "veildawn", category: "tools", version: "0.1.9", latestVersion: "0.1.9", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-terminal@v0.1.9/dsh-terminal-0.1.9.tgz", isRepoPlugin: true, installedVersion: null, hasUpdate: false },
    ];

    function installCommand(plugin, profile) {
      const url = plugin.downloadUrl || "";
      const target = url ? ` ${url}` : ` ${plugin.name || plugin.id}`;
      return `dsh plugin add --profile ${profile || "web"}${target}`;
    }

    function PluginCard(props) {
      const { plugin, profile, copiedId, onCopy, mode } = props;
      const latest = plugin.version || plugin.latestVersion || "0.1.0";
      const installed = plugin.installedVersion || null;
      const update = Boolean(installed) && plugin.hasUpdate;
      const isCommunity = mode === "community";
      return react.createElement("div", { className: "dm-card" },
        react.createElement("div", { className: "dm-card-head" },
          react.createElement("div", null,
            react.createElement("h3", { className: "dm-card-title" }, plugin.title || plugin.name || plugin.id),
            react.createElement("p", { className: "dm-card-name" }, plugin.name || plugin.id)),
          react.createElement("span", { className: isCommunity ? "dm-badge" : update ? "dm-badge update" : "dm-badge repo" },
            isCommunity ? "社区" : update ? "可更新" : "本仓库")),
        react.createElement("p", { className: "dm-card-desc" }, plugin.description || plugin.summary || "暂无描述"),
        react.createElement("div", { className: "dm-version-row" },
          installed
            ? react.createElement(react.Fragment, null,
                react.createElement("span", null, "已安装 ", installed),
                update ? react.createElement("span", null, "→ 最新 ", latest) : react.createElement("span", null, "（已是最新）"))
            : react.createElement("span", null, "最新版本 ", latest)),
        react.createElement("div", { className: "dm-card-meta" },
          react.createElement("span", null, `作者: ${plugin.author || "社区"}`),
          react.createElement("div", { className: "dm-card-actions" },
            plugin.homepage
              ? react.createElement("a", { className: "dm-action-btn", href: plugin.homepage, target: "_blank", rel: "noreferrer", style: { textDecoration: "none" } }, "源码")
              : null,
            react.createElement("button", { className: "dm-action-btn", type: "button", onClick: () => onCopy(plugin) },
              copiedId === plugin.id ? "✓ 已复制指令" : (installed && update ? "复制更新指令" : "复制安装指令")))));
    }

    function apply(ctx) {
      const rpc = ctx.connection.rpc;

      async function rpcCall(method, payload) {
        const result = await rpc.call(MARKET_RPC_CHANNEL, method, payload || {});
        if (result && result.ok === true) return result.value;
        throw new Error(result?.error?.message || "插件市场请求失败");
      }

      function MarketSection(props) {
        const [tab, setTab] = react.useState("repo");
        const [search, setSearch] = react.useState("");
        const [repoPlugins, setRepoPlugins] = react.useState(FALLBACK_REPO_PLUGINS);
        const [communityPlugins, setCommunityPlugins] = react.useState([]);
        const [repoOrigin, setRepoOrigin] = react.useState("veildawn/dsh-plugins");
        const [profile, setProfile] = react.useState("web");
        const [loading, setLoading] = react.useState(false);
        const [loadingCommunity, setLoadingCommunity] = react.useState(false);
        const [copiedId, setCopiedId] = react.useState(null);
        const [feedback, setFeedback] = react.useState("");
        const [feedbackKind, setFeedbackKind] = react.useState("ok");
        const [config, setConfig] = react.useState(null);
        const [draft, setDraft] = react.useState(null);

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
            notify(`已同步最新发布信息（检查于 ${new Date(value.checkedAt).toLocaleTimeString()}）`);
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
          if (communityPlugins.length > 0) return;
          setLoadingCommunity(true);
          try {
            const value = await rpcCall("getCommunityPlugins", {});
            setCommunityPlugins(value.plugins || []);
          } catch {
            setCommunityPlugins([]);
          } finally {
            setLoadingCommunity(false);
          }
        }, [communityPlugins.length]);

        react.useEffect(() => {
          if (tab === "community") void loadCommunity();
        }, [tab, loadCommunity]);

        const copyCommand = (plugin) => {
          const cmd = installCommand(plugin, profile);
          const done = () => {
            setCopiedId(plugin.id);
            window.setTimeout(() => setCopiedId(null), 2500);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(cmd).then(done, () => done());
          } else {
            // Non-secure contexts: fall back to prompt so the command is never lost.
            window.prompt("复制以下安装/更新指令：", cmd);
          }
        };

        const filteredRepo = repoPlugins.filter((p) => {
          const q = search.trim().toLowerCase();
          if (!q) return true;
          const haystack = [p.name, p.title, p.description, (p.tags || []).join(" ")].join(" ").toLowerCase();
          return haystack.includes(q);
        });

        const filteredCommunity = communityPlugins.filter((p) => {
          const q = search.trim().toLowerCase();
          if (!q) return true;
          const haystack = [p.name, p.title, p.description, p.summary, (p.tags || []).join(" ")].join(" ").toLowerCase();
          return haystack.includes(q);
        });

        const saveConfig = async (next) => {
          try {
            const value = await rpcCall("updateConfig", next);
            setConfig(value);
            setDraft({ ...value });
            notify("配置已保存");
            void loadRepo();
          } catch (err) {
            notify(err instanceof Error ? err.message : String(err), "error");
          }
        };

        return react.createElement("div", { className: "dm-container" },
          react.createElement("style", null, css),
          react.createElement("h2", { className: "dm-title" }, "🔌 插件市场"),
          react.createElement("p", { className: "dm-subtitle" }, "浏览社区插件，并一键管理本插件仓库（Monorepo）的独立版本发布与更新。"),
          feedback ? react.createElement("div", { className: `dm-feedback ${feedbackKind}`, role: "status" }, feedback) : null,
          react.createElement("div", { className: "dm-repo-banner" },
            react.createElement("div", { className: "dm-repo-info" },
              "📦 插件仓库: ", react.createElement("strong", null, repoOrigin),
              " · 当前 profile: ", react.createElement("strong", null, profile)),
            react.createElement("span", { className: "dm-badge repo" }, `共 ${repoPlugins.length} 款插件`)),
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
              : react.createElement("div", { className: "dm-grid" },
                  ...filteredRepo.map((plugin) => react.createElement(PluginCard, { key: plugin.id, plugin, profile, copiedId, onCopy: copyCommand, mode: "repo" })))
          ) : null,
          tab === "community" ? (
            loadingCommunity
              ? react.createElement("div", { className: "dm-empty" }, "正在加载社区插件索引…")
              : (filteredCommunity.length === 0
                  ? react.createElement("div", { className: "dm-empty" },
                      "社区插件索引为空或加载失败。",
                      react.createElement("br", null),
                      react.createElement("a", { href: "https://awesome-dsh-plugin.com", target: "_blank", rel: "noreferrer", style: { color: "var(--dsw-alias-brand-primary)" } }, "🌐 访问 Awesome DSH Plugins 官方导航"))
                  : react.createElement("div", { className: "dm-grid" },
                      ...filteredCommunity.slice(0, 60).map((plugin) => react.createElement(PluginCard, { key: plugin.id || plugin.name, plugin, profile, copiedId, onCopy: copyCommand, mode: "community" }))))
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
