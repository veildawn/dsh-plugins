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

    /**
     * Clean UI SVG Icons (replacing unicode emojis)
     */
    function IconRefresh({ size = 14, className }) {
      return react.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", className },
        react.createElement("path", { d: "M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19" })
      );
    }

    function IconRocket({ size = 14, className }) {
      return react.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", className },
        react.createElement("path", { d: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" }),
        react.createElement("path", { d: "m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" }),
        react.createElement("path", { d: "M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" }),
        react.createElement("path", { d: "M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" })
      );
    }

    function IconTrash({ size = 14, className }) {
      return react.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", className },
        react.createElement("path", { d: "M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6" })
      );
    }

    function IconSearch({ size = 14, className }) {
      return react.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", className },
        react.createElement("circle", { cx: "11", cy: "11", r: "8" }),
        react.createElement("path", { d: "m21 21-4.3-4.3" })
      );
    }

    function IconTag({ size = 13, className }) {
      return react.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", className },
        react.createElement("path", { d: "M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" }),
        react.createElement("path", { d: "M7 7h.01" })
      );
    }

    function IconAlertTriangle({ size = 20, className }) {
      return react.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", className },
        react.createElement("path", { d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" }),
        react.createElement("line", { x1: "12", y1: "9", x2: "12", y2: "13" }),
        react.createElement("line", { x1: "12", y1: "17", x2: "12.01", y2: "17" })
      );
    }

    function IconCheck({ size = 14, className }) {
      return react.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.2", strokeLinecap: "round", strokeLinejoin: "round", className },
        react.createElement("polyline", { points: "20 6 9 17 4 12" })
      );
    }

    function IconGlobe({ size = 13, className }) {
      return react.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", className },
        react.createElement("circle", { cx: "12", cy: "12", r: "10" }),
        react.createElement("line", { x1: "2", y1: "12", x2: "22", y2: "12" }),
        react.createElement("path", { d: "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" })
      );
    }

    function IconArrowDown({ size = 13, className }) {
      return react.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", className },
        react.createElement("path", { d: "M12 5v14M19 12l-7 7-7-7" })
      );
    }

    /**
     * Plugin Category/Type Avatar Generator
     */
    function getPluginIcon(plugin) {
      const name = plugin.name || plugin.id || "";
      const size = 20;
      if (name.includes("role") || name.includes("model")) {
        return react.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" },
          react.createElement("path", { d: "M12 8V4H8" }),
          react.createElement("rect", { width: "16", height: "12", x: "4", y: "8", rx: "2" }),
          react.createElement("path", { d: "M2 14h2" }),
          react.createElement("path", { d: "M20 14h2" }),
          react.createElement("path", { d: "M15 13v2" }),
          react.createElement("path", { d: "M9 13v2" })
        );
      }
      if (name.includes("terminal")) {
        return react.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" },
          react.createElement("polyline", { points: "4 17 10 11 4 5" }),
          react.createElement("line", { x1: "12", y1: "19", x2: "20", y2: "19" })
        );
      }
      if (name.includes("file") || name.includes("viewer")) {
        return react.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" },
          react.createElement("path", { d: "M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" }),
          react.createElement("polyline", { points: "14 2 14 8 20 8" }),
          react.createElement("line", { x1: "16", y1: "13", x2: "8", y2: "13" }),
          react.createElement("line", { x1: "16", y1: "17", x2: "8", y2: "17" })
        );
      }
      if (name.includes("remote") || name.includes("control") || name.includes("lock")) {
        return react.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" },
          react.createElement("rect", { width: "18", height: "11", x: "3", y: "11", rx: "2", ry: "2" }),
          react.createElement("path", { d: "M7 11V7a5 5 0 0 1 10 0v4" })
        );
      }
      if (name.includes("proxy") || name.includes("ai")) {
        return react.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" },
          react.createElement("polygon", { points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2" })
        );
      }
      if (name.includes("mobile")) {
        return react.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" },
          react.createElement("rect", { width: "14", height: "20", x: "5", y: "2", rx: "2", ry: "2" }),
          react.createElement("line", { x1: "12", y1: "18", x2: "12.01", y2: "18" })
        );
      }
      if (name.includes("archive")) {
        return react.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" },
          react.createElement("polyline", { points: "21 8 21 21 3 21 3 8" }),
          react.createElement("rect", { width: "22", height: "5", x: "1", y: "3" }),
          react.createElement("line", { x1: "10", y1: "12", x2: "14", y2: "12" })
        );
      }
      return react.createElement(IconPluginManager16, { size: size });
    }

    const css = `
      .dm-container{display:flex;flex-direction:column;gap:14px;width:100%;max-width:960px;min-width:0;overflow-x:hidden;color:var(--dsw-alias-label-primary,#1f2328);font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif);color-scheme:light dark;-webkit-tap-highlight-color:transparent}
      .dm-container button,.dm-container input,.dm-container a.dm-action-btn{-webkit-appearance:none;appearance:none;font:inherit;color:inherit}
      .dm-container button{margin:0}
      .dm-title{font-size:18px;font-weight:600;margin:0;display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-primary,#1f2328)}
      .dm-subtitle{font-size:12.5px;color:var(--dsw-alias-label-tertiary,#656d76);margin:0;line-height:18px}
      .dm-repo-banner{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 14px;border-radius:8px;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1,#f6f8fa));border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-subtle,#e1e4e8))}
      .dm-repo-info{font-size:12px;color:var(--dsw-alias-label-secondary,#57606a);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
      .dm-repo-info strong{color:var(--dsw-alias-label-primary,#1f2328);font-weight:600}
      .dm-repo-badge{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-subtle,#e1e4e8));color:var(--dsw-alias-label-secondary,#57606a)}
      .dm-tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-subtle,#e1e4e8));padding-bottom:0}
      .dm-tab-btn{padding:7px 12px;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#57606a);font-size:13px;cursor:pointer;font-weight:500;white-space:nowrap;border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .15s ease}
      .dm-tab-btn:hover{color:var(--dsw-alias-label-primary,#1f2328)}
      .dm-tab-btn.active{color:var(--dsw-alias-label-primary,#1f2328);border-bottom-color:var(--dsw-alias-brand-primary,var(--dsw-alias-label-primary,#1f2328));font-weight:600}
      .dm-filter-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
      .dm-filter-group{display:inline-flex;align-items:center;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1,#f6f8fa));border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-subtle,#e1e4e8))}
      .dm-filter-btn{padding:5px 11px;border-radius:6px;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#57606a);font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap;transition:all .15s ease}
      .dm-filter-btn:hover{color:var(--dsw-alias-label-primary,#1f2328)}
      .dm-filter-btn.active{background:var(--dsw-alias-bg-base,var(--dsw-alias-background-base,#fff));color:var(--dsw-alias-label-primary,#1f2328);box-shadow:var(--dsw-shadow-lv1,0 1px 3px rgba(0,0,0,.08));font-weight:600}
      .dm-search-wrap{position:relative;width:100%;box-sizing:border-box}
      .dm-search-icon{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--dsw-alias-label-tertiary,#656d76);pointer-events:none;display:flex;align-items:center}
      .dm-search-box{box-sizing:border-box;width:100%;height:36px;padding:0 32px 0 32px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-default,#d0d7de));background:var(--dsw-alias-bg-base,var(--dsw-alias-background-base,#fff));color:var(--dsw-alias-label-primary,#1f2328);outline:none;font-size:13px}
      .dm-search-box:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 18%,transparent)}
      .dm-search-clear{position:absolute;right:8px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#656d76);cursor:pointer;padding:4px;font-size:12px;line-height:1}
      .dm-search-clear:hover{color:var(--dsw-alias-label-primary,#1f2328)}
      .dm-chips-box{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1,#f6f8fa));border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-subtle,#e1e4e8))}
      .dm-chips-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .dm-chips-title{font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary,#57606a);display:inline-flex;align-items:center;gap:5px}
      .dm-chips-toggle{padding:0;border:0;background:transparent;color:var(--dsw-alias-brand-primary,#4d6bfe);font-size:12px;font-weight:500;cursor:pointer}
      .dm-chips-toggle:hover{text-decoration:underline}
      .dm-chips{display:flex;gap:6px;flex-wrap:wrap}
      .dm-chip{box-sizing:border-box;height:26px;padding:0 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,transparent);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,#57606a);font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap;line-height:24px;transition:all .15s ease}
      .dm-chip:hover{border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-brand-primary,#4d6bfe)}
      .dm-chip.active{background:var(--dsw-alias-brand-primary,#4d6bfe);border-color:transparent;color:#fff}
      .dm-toolbar-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .dm-action-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:30px;padding:0 11px;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-default,#d0d7de));background:var(--dsw-alias-bg-base,var(--dsw-alias-background-base,#fff));color:var(--dsw-alias-label-primary,#1f2328);white-space:nowrap;text-decoration:none;transition:all .15s ease}
      .dm-action-btn:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-module-platform,#f6f8fa))}
      .dm-action-btn:disabled{opacity:.45;cursor:default}
      .dm-action-btn.primary{background:var(--dsw-alias-brand-primary,var(--dsw-alias-button-primary-fill,#4d6bfe));border-color:transparent;color:#fff}
      .dm-action-btn.primary:hover{opacity:.9}
      .dm-action-btn.success{background:#10b981;border-color:transparent;color:#fff}
      .dm-action-btn.warning{border-color:var(--dsw-alias-border-l2,var(--dsw-alias-border-default,#d0d7de));color:var(--dsw-alias-label-primary,#1f2328)}
      .dm-action-btn.danger{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 45%,transparent);color:var(--dsw-alias-state-error-primary,#d84848)}
      .dm-action-btn.danger:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 12%,transparent)}
      .dm-close-btn{padding:2px 6px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#656d76);font-size:12px;cursor:pointer}
      .dm-close-btn:hover{color:var(--dsw-alias-label-primary,#1f2328)}
      .dm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:10px}
      .dm-card{box-sizing:border-box;padding:12px 14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-subtle,#e1e4e8));background:var(--dsw-alias-bg-base,var(--dsw-alias-background-base,#fff));display:flex;gap:12px;align-items:flex-start;transition:border-color .15s ease,box-shadow .15s ease}
      .dm-card:hover{border-color:var(--dsw-alias-border-l2,var(--dsw-alias-border-default,#d0d7de));box-shadow:var(--dsw-shadow-lv1,0 2px 8px rgba(0,0,0,.04))}
      .dm-card-icon{width:36px;height:36px;border-radius:8px;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1,#f6f8fa));display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-primary,#1f2328);flex-shrink:0;border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-subtle,#e1e4e8))}
      .dm-card-body{display:flex;flex-direction:column;gap:6px;flex:1;min-width:0}
      .dm-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
      .dm-card-title-row{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}
      .dm-card-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2328);margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dm-card-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#57606a);margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .dm-badge{font-size:11px;padding:2px 6px;border-radius:4px;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1,#f6f8fa));color:var(--dsw-alias-label-secondary,#57606a);font-weight:500;white-space:nowrap;flex-shrink:0}
      .dm-badge.installed{color:var(--dsw-alias-label-primary,#1f2328)}
      .dm-badge.update{color:#b45309;background:color-mix(in srgb,#f59e0b 16%,transparent);font-weight:600}
      .dm-badge.uninstalled{color:var(--dsw-alias-label-tertiary,#656d76)}
      .dm-version-row{display:flex;align-items:center;gap:4px;flex-wrap:wrap;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#656d76);line-height:16px}
      .dm-ver-installed{color:var(--dsw-alias-label-primary,#1f2328);font-weight:500}
      .dm-ver-latest{color:var(--dsw-alias-label-primary,#1f2328);font-weight:600}
      .dm-ver-uptodate{color:var(--dsw-alias-label-tertiary,#656d76)}
      .dm-card-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:4px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.05))}
      .dm-card-meta-text{font-size:11px;color:var(--dsw-alias-label-tertiary,#656d76);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dm-card-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}
      .dm-feedback{padding:8px 12px;border-radius:8px;font-size:12px;line-height:18px;display:flex;align-items:center;gap:6px}.dm-feedback.ok{background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1,#f6f8fa));color:var(--dsw-alias-label-primary,#1f2328);border:1px solid var(--dsw-alias-border-l1,#e1e4e8)}.dm-feedback.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 10%,transparent);color:var(--dsw-alias-state-error-primary,#d84848)}
      .dm-empty{padding:28px 16px;text-align:center;color:var(--dsw-alias-label-tertiary,#656d76);font-size:13px}
      .dm-install-box{border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-subtle,#e1e4e8));border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1,#f6f8fa))}
      .dm-install-head{padding:8px 12px;font-size:12px;font-weight:600;border-bottom:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-subtle,#e1e4e8));display:flex;justify-content:space-between;align-items:center;gap:8px}
      .dm-install-log{margin:0;padding:8px 12px;max-height:160px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#57606a);white-space:pre-wrap;word-break:break-all}
      .dm-restart-modal{padding:14px;border-radius:8px;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1,#f6f8fa));border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-subtle,#e1e4e8));display:flex;flex-direction:column;gap:8px;align-items:flex-start}
      @keyframes dm-fade-in{from{opacity:0}to{opacity:1}}
      @keyframes dm-pop-in{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
      .dm-modal-scrim{position:fixed;inset:0;z-index:2147483640;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;background:rgba(0,0,0,.45);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);animation:dm-fade-in .15s ease-out}
      .dm-modal-card{box-sizing:border-box;width:min(92vw,420px);max-width:100%;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-default,#d0d7de));border-radius:12px;background:var(--dsw-alias-bg-base,var(--dsw-alias-background-base,#fff));box-shadow:var(--dsw-shadow-lv3,0 16px 40px rgba(0,0,0,.22));overflow:hidden;display:flex;flex-direction:column;animation:dm-pop-in .15s cubic-bezier(.16,1,.3,1)}
      .dm-modal-head{display:flex;align-items:center;gap:12px;padding:18px 20px 12px}
      .dm-modal-icon{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:10px;flex-shrink:0}
      .dm-modal-icon.warning{background:color-mix(in srgb,#f59e0b 16%,transparent);color:#b45309}
      .dm-modal-icon.danger{background:color-mix(in srgb,#ef4444 16%,transparent);color:#b91c1c}
      .dm-modal-icon.primary{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 16%,transparent);color:var(--dsw-alias-brand-primary,#4d6bfe)}
      .dm-modal-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2328);margin:0}
      .dm-modal-body{padding:0 20px 18px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#57606a);word-break:break-word}
      .dm-modal-foot{display:flex;justify-content:flex-end;align-items:center;gap:10px;padding:12px 20px;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1,#f6f8fa));border-top:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-subtle,#e1e4e8))}
      .dm-modal-foot .dm-action-btn{height:32px;padding:0 14px;font-size:12.5px;border-radius:6px}
      .dm-config{display:flex;flex-direction:column;gap:12px;max-width:640px}
      .dm-field{display:flex;flex-direction:column;gap:5px}.dm-label{color:var(--dsw-alias-label-secondary,#57606a);font-size:12px;font-weight:500}
      .dm-input{box-sizing:border-box;width:100%;height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-default,#d0d7de));border-radius:8px;outline:none;background:var(--dsw-alias-bg-base,var(--dsw-alias-background-base,#fff));color:var(--dsw-alias-label-primary,#1f2328);font-size:13px}
      .dm-input:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 18%,transparent)}
      .dm-check{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary,#57606a);font-size:13px}
      @media(max-width:768px){
        .dm-container{gap:10px;padding-bottom:max(16px,env(safe-area-inset-bottom,16px))}
        .dm-grid{grid-template-columns:1fr;gap:8px}
        .dm-filter-bar{flex-direction:column;align-items:stretch;gap:8px}
        .dm-filter-group{width:100%;display:grid;grid-template-columns:1fr 1fr 1fr;text-align:center}
        .dm-filter-btn{text-align:center;padding:6px 4px}
        .dm-toolbar-right{width:100%;display:grid;grid-template-columns:1fr 1fr;gap:6px}
        .dm-toolbar-right .dm-action-btn{width:100%;height:34px}
        .dm-card-footer{flex-direction:column;align-items:stretch;gap:8px}
        .dm-card-actions{justify-content:flex-end}
      }
      @media(max-width:480px){
        .dm-toolbar-right{grid-template-columns:1fr}
      }
    `;

    const FALLBACK_REPO_PLUGINS = [
      { id: "dsh-plugin-manager", name: "dsh-plugin-manager", title: "插件管理", description: "DSH 插件管理与更新中心，支持自有插件更新/卸载/一键批量更新，浏览 2200+ 社区插件并一键安装。", author: "veildawn", category: "tools", version: "0.2.0", latestVersion: "0.2.0", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-plugin-manager@v0.2.0/dsh-plugin-manager-0.2.0.tgz", isRepoPlugin: true },
      { id: "dsh-model-roles", name: "dsh-model-roles", title: "模型角色分工与路由", description: "OMP 风格的多模型智能分工与角色路由，支持计划模式、识图子代理分析与顾问复核 (/advisor)。", author: "veildawn", category: "ai", version: "0.4.8", latestVersion: "0.4.8", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.8/dsh-model-roles-0.4.8.tgz", isRepoPlugin: true },
      { id: "dsh-remote-control", name: "dsh-remote-control", title: "远程访问与安全通道", description: "Token 密钥认证、密码锁屏门禁 Unlock Screen、特权 RPC 白名单桥接与局域网无感放行。", author: "veildawn", category: "security", version: "0.2.0", latestVersion: "0.2.0", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-remote-control@v0.1.6/dsh-remote-control-0.1.6.tgz", isRepoPlugin: true },
      { id: "dsh-ai-proxy", name: "dsh-ai-proxy", title: "AI Proxy 网关与 Provider", description: "AI Proxy Service 统一网关对接，支持 Chat/Anthropic/Responses 多协议智能适配与 OAuth 2.0 PKCE 认证。", author: "veildawn", category: "ai", version: "0.2.5", latestVersion: "0.2.5", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-ai-proxy@v0.2.5/dsh-ai-proxy-0.2.5.tgz", isRepoPlugin: true },
      { id: "dsh-mobile-adapter", name: "dsh-mobile-adapter", title: "移动端全量体验优化", description: "原生图片上传、底部操作栏圆形统一规范、视口高度自适应、Segmented Control Tabs。", author: "veildawn", category: "ui", version: "0.1.28", latestVersion: "0.1.28", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-mobile-adapter@v0.1.28/dsh-mobile-adapter-0.1.28.tgz", isRepoPlugin: true },
      { id: "dsh-file-viewer", name: "dsh-file-viewer", title: "工作区文件查看器", description: "会话头部抽屉式文件浏览器，支持全屏切换、语法高亮、Markdown/JSON、图片、PDF、Excel、Word 预览。", author: "veildawn", category: "tools", version: "0.2.0", latestVersion: "0.2.0", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-file-viewer@v0.1.8/dsh-file-viewer-0.1.8.tgz", isRepoPlugin: true },
      { id: "dsh-terminal", name: "dsh-terminal", title: "跨平台交互式终端", description: "本地终端调用、移动端专属对话框底部工具箱二合一入口、多标签并发与触控辅助键盘。", author: "veildawn", category: "tools", version: "0.2.0", latestVersion: "0.2.0", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-terminal@v0.1.9/dsh-terminal-0.1.9.tgz", isRepoPlugin: true },
      { id: "dsh-archive-manager", name: "dsh-archive-manager", title: "会话归档管理器", description: "DeepSeek Harness 会话归档管理：恢复、永久删除、计数徽章，全移动端响应式适配。", author: "veildawn", category: "tools", version: "0.1.0", latestVersion: "0.1.0", downloadUrl: "https://github.com/veildawn/dsh-plugins/releases/download/dsh-archive-manager@v0.1.0/dsh-archive-manager-0.1.0.tgz", isRepoPlugin: true },
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

      // Lazy access to the connection RPC surface (like dsh-remote-control).
      // The host may not have injected the connection service when apply() runs,
      // so any eager `ctx.connection.rpc` access would crash the whole client
      // bundle and blank the settings panel.
      const rpcCall = async (method, payload) => {
        const conn = ctx && ctx.connection;
        const rpc = conn && conn.rpc;
        if (!rpc || typeof rpc.call !== "function") {
          throw new Error("插件管理连接服务尚未就绪，请稍后重试");
        }
        const result = await rpc.call(MARKET_RPC_CHANNEL, method, payload || {});
        if (result && result.ok === true) return result.value;
        throw new Error(result?.error?.message || "插件管理请求失败");
      };

      function PluginManagerSection(props) {
        const { rpcCall: callRpc } = props || {};
        const [tab, setTab] = react.useState("repo");
        const [search, setSearch] = react.useState("");
        const [category, setCategory] = react.useState("");
        const [showAllCategories, setShowAllCategories] = react.useState(false);
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
        const [confirmState, setConfirmState] = react.useState(null);
        const confirmResolverRef = react.useRef(null);
        const probeTimerRef = react.useRef(null);
        const mountedRef = react.useRef(true);

        const askConfirm = react.useCallback(({
          title = "确认操作",
          message = "确定要继续吗？",
          icon = null,
          confirmText = "确定",
          cancelText = "取消",
          variant = "primary",
        } = {}) => {
          return new Promise((resolve) => {
            confirmResolverRef.current = resolve;
            setConfirmState({
              title,
              message,
              icon,
              confirmText,
              cancelText,
              variant,
            });
          });
        }, []);

        const closeConfirm = react.useCallback((result) => {
          if (confirmResolverRef.current) {
            confirmResolverRef.current(Boolean(result));
            confirmResolverRef.current = null;
          }
          setConfirmState(null);
        }, []);

        react.useEffect(() => {
          if (!confirmState) return;
          const onKeyDown = (e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              closeConfirm(false);
            }
          };
          window.addEventListener("keydown", onKeyDown, true);
          return () => window.removeEventListener("keydown", onKeyDown, true);
        }, [confirmState, closeConfirm]);

        react.useEffect(() => () => {
          mountedRef.current = false;
          if (confirmResolverRef.current) {
            confirmResolverRef.current(false);
            confirmResolverRef.current = null;
          }
          if (probeTimerRef.current) {
            window.clearInterval(probeTimerRef.current);
            probeTimerRef.current = null;
          }
        }, []);

        const notify = (text, kind = "ok") => {
          setFeedback(text);
          setFeedbackKind(kind);
          window.setTimeout(() => setFeedback(""), 4000);
        };

        const loadRepo = react.useCallback(async () => {
          setLoading(true);
          try {
            const value = await callRpc("getRepoPlugins", {});
            // Merge server list with fallback list to guarantee newly added repo
            // plugins are never lost even when the server returns a partial list.
            const serverList = (value && Array.isArray(value.plugins)) ? value.plugins : [];
            const byName = new Map();
            for (const p of [...FALLBACK_REPO_PLUGINS, ...serverList]) {
              byName.set(p.name || p.id, p);
            }
            setRepoPlugins(Array.from(byName.values()));
            if (value && value.repoOrigin) setRepoOrigin(value.repoOrigin);
            if (value && value.profile) setProfile(value.profile);
          } catch (err) {
            notify("获取自有插件失败，已展示内置列表：" + (err instanceof Error ? err.message : String(err)), "error");
          } finally {
            setLoading(false);
          }
        }, []);

        const loadConfig = react.useCallback(async () => {
          try {
            const value = await callRpc("getConfig", {});
            setConfig(value);
            setDraft({ ...value });
          } catch { /* non-fatal */ }
        }, []);

        const autoCleanLockfile = react.useCallback(async () => {
          try {
            const health = await callRpc("getLockfileHealth", {});
            if (health && Array.isArray(health.plugins) && health.staleCount > 0) {
              const staleNames = health.plugins.filter((p) => !p.healthy).map((p) => p.name);
              if (staleNames.length > 0) {
                await callRpc("repairLockfile", { names: staleNames });
              }
            }
          } catch {
            // Completely silent: user does not need to be interrupted
          }
        }, []);

        const loadCommunity = react.useCallback(async (retriesLeft = 3, silent = false) => {
          if (!silent) setLoadingCommunity(true);
          try {
            const value = await callRpc("getCommunityPlugins", {});
            if (value && Array.isArray(value.plugins) && value.plugins.length > 0) {
              setCommunityPlugins(value.plugins);
              setCategories(value.categories || []);
              if (!silent) notify(`已同步 ${value.plugins.length} 款社区插件`);
            } else {
              throw new Error("社区目录数据为空");
            }
          } catch (err) {
            if (retriesLeft > 1) {
              // Exponential retry in background
              const delay = (4 - retriesLeft) * 1500;
              window.setTimeout(() => {
                void loadCommunity(retriesLeft - 1, silent);
              }, delay);
            } else {
              if (!silent) {
                notify("获取社区插件失败：" + (err instanceof Error ? err.message : String(err)), "error");
              }
            }
          } finally {
            if (!silent) setLoadingCommunity(false);
          }
        }, []);

        // Preload both repo and community data in background on mount
        react.useEffect(() => {
          void loadRepo();
          void loadConfig();
          void autoCleanLockfile();
          void loadCommunity(3, true); // Background preload with 3 automatic retries
          // Greet the user after a smooth restart reload.
          try {
            if (window.sessionStorage.getItem("dsh-pm-restarted")) {
              window.sessionStorage.removeItem("dsh-pm-restarted");
              notify("服务已平滑重启完成，欢迎回来", "ok");
            }
          } catch {}
        }, [loadRepo, loadConfig, autoCleanLockfile, loadCommunity]);

        const pollTask = react.useCallback((taskId) => {
          window.setTimeout(async () => {
            try {
              const task = await callRpc("getInstallTask", { taskId });
              setTaskState(task);
              if (task.status === "running") {
                pollTask(taskId);
              } else {
                const actionName = task.kind === "remove" ? "卸载" : "安装/更新";
                if (task.status === "success") {
                  notify(`${task.name} ${actionName}成功，已刷新列表`);
                  void loadRepo();
                  if (tab === "community") void loadCommunity();
                } else {
                  notify(`${task.name} 操作失败：${task.error || "未知错误"}`, "error");
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
            const value = await callRpc("installPlugin", { name, kind });
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

          const ok = await askConfirm({
            title: "一键批量更新",
            message: `确定要一键更新全部 ${targetList.length} 款插件吗？（注意：更新后不会自动重启 DSH）`,
            icon: react.createElement(IconRocket, { size: 20 }),
            confirmText: `更新全部 (${targetList.length})`,
            variant: "primary",
          });

          try {
            const value = await callRpc("batchUpdatePlugins", { kind });
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
          const ok = await askConfirm({
            title: "卸载插件",
            message: `确定要从当前 profile (${profile}) 卸载插件 ${name} 吗？卸载后该插件功能将不可用。`,
            icon: react.createElement(IconTrash, { size: 20 }),
            confirmText: "确认卸载",
            variant: "danger",
          });
          try {
            const value = await callRpc("removePlugin", { name });
            setTaskState({ id: value.taskId, name, kind: "remove", status: "running", log: [], error: null });
            pollTask(value.taskId);
          } catch (err) {
            notify(err instanceof Error ? err.message : String(err), "error");
          }
        };

        const startAsyncRestart = async () => {
          const ok = await askConfirm({
            title: "平滑重启服务",
            message: "确定要平滑重启 DeepSeek Harness 服务吗？前端会在后台自动探测端口并在就绪后恢复连接。",
            icon: react.createElement(IconRefresh, { size: 20 }),
            confirmText: "立即重启",
            variant: "warning",
          });
          try {
            setRestartingState("triggering");
            await callRpc("restartHost", {});
            notify("已调度异步重启，正在等待服务拉起…", "ok");
            setRestartingState("probing");

            let seenDown = false;
            let successHits = 0;
            let done = false;
            const probeStartedAt = Date.now();
            const probeDeadline = probeStartedAt + 90_000;
            // The systemd-run wrapper sleeps 0.8s before restarting; the actual
            // down window can be as short as ~1-2s. If our probe interval never
            // happens to hit it, seenDown stays false forever and the old logic
            // would never recover. So also recover once we have waited past the
            // worst-case restart time AND observed several consecutive healthy
            // responses — regardless of whether we caught the down window.
            const minWaitMs = 8_000;
            const recoverAfterQuiet = 3;

            // The HTML body of the DSH web app must contain this marker;
            // checking it prevents a false "recovered" when some other process
            // happens to answer on the same port during the restart window.
            const isDshPage = (text) =>
              typeof text === "string" &&
              (text.includes("__ModuleLoader__") || text.includes("dsh"));

            let inflight = false;
            const finish = (state) => {
              if (done) return;
              done = true;
              window.clearInterval(probeTimerRef.current);
              probeTimerRef.current = null;
              if (!mountedRef.current) return; // component unmounted mid-restart
              setRestartingState(state);
              if (state === "ready") {
                // Remember that we just restarted so the freshly loaded page
                // can greet the user instead of silently dropping context.
                try { window.sessionStorage.setItem("dsh-pm-restarted", "1"); } catch {}
                window.setTimeout(() => { window.location.reload(); }, 1200);
              }
            };

            probeTimerRef.current = window.setInterval(async () => {
              if (done || inflight) return;
              inflight = true;
              const elapsed = Date.now() - probeStartedAt;
              if (elapsed > probeDeadline - probeStartedAt) {
                finish("timeout");
                inflight = false;
                return;
              }
              try {
                const resp = await fetch("/?_ping=" + Date.now(), {
                  cache: "no-store",
                  signal: AbortSignal.timeout(3000),
                });
                if (resp.ok) {
                  const text = await resp.text();
                  if (isDshPage(text)) {
                    if (seenDown) {
                      successHits++;
                      if (successHits >= 2) finish("ready");
                    } else if (elapsed >= minWaitMs) {
                      // Restart window may have been missed entirely; the
                      // service has been healthy for a while — treat as done.
                      successHits++;
                      if (successHits >= recoverAfterQuiet) finish("ready");
                    }
                  }
                }
              } catch {
                seenDown = true;
                successHits = 0;
              } finally {
                inflight = false;
              }
            }, 500);
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
         * Streamlined Card Component: modern ZCode-style layout with SVG avatar,
         * uncluttered meta details, clean status badge and responsive buttons.
         */
        const renderPluginCard = (plugin, kind) => {
          const installed = plugin.installedVersion || null;
          const isInstalled = Boolean(installed);
          const remoteVer = plugin.version || plugin.latestVersion || null;
          const update = isInstalled && Boolean(plugin.hasUpdate);
          const busy = busyFor(plugin.name);

          // Status badge: only show when meaningful (has update or community category tag)
          let badgeClass = null;
          let badgeText = null;
          if (update) {
            badgeClass = "dm-badge update";
            badgeText = "可更新";
          } else if (!isInstalled && kind === "community" && plugin.category) {
            badgeClass = "dm-badge uninstalled";
            badgeText = categoryName(plugin.category);
          }

          // Clean version indication
          let versionDetails = null;
          if (isInstalled && update) {
            versionDetails = react.createElement(react.Fragment, null,
              react.createElement("span", { className: "dm-ver-installed" }, `v${installed}`),
              react.createElement("span", null, " → "),
              react.createElement("span", { className: "dm-ver-latest" }, `v${remoteVer}`));
          } else if (isInstalled) {
            versionDetails = react.createElement("span", { className: "dm-ver-installed" }, `v${installed}`);
          } else if (remoteVer) {
            versionDetails = react.createElement("span", { className: "dm-ver-latest" }, `v${remoteVer}`);
          } else if (plugin.npm) {
            versionDetails = react.createElement("span", { className: "dm-ver-latest" }, plugin.npm);
          }

          // Primary button label & disabled
          let btnLabel = "安装";
          let btnClass = "dm-action-btn primary";
          let btnDisabled = busy;

          if (busy) {
            btnLabel = "处理中…";
            btnDisabled = true;
          } else if (update) {
            btnLabel = "更新";
            btnClass = "dm-action-btn primary";
            btnDisabled = false;
          } else if (isInstalled) {
            // When plugin is already installed and up to date, do not show a fake disabled button.
            btnLabel = null;
          } else {
            btnLabel = "安装";
            btnClass = "dm-action-btn primary";
            btnDisabled = false;
          }

          const canInstall = kind === "repo" || Boolean(plugin.npm || plugin.name);

          return react.createElement("div", { className: "dm-card", key: plugin.id },
            react.createElement("div", { className: "dm-card-icon" }, getPluginIcon(plugin)),
            react.createElement("div", { className: "dm-card-body" },
              react.createElement("div", { className: "dm-card-head" },
                react.createElement("div", { className: "dm-card-title-row" },
                  react.createElement("h3", { className: "dm-card-title" }, plugin.title || plugin.name),
                  badgeClass ? react.createElement("span", { className: badgeClass }, badgeText) : null
                ),
                react.createElement("div", { className: "dm-version-row" },
                  versionDetails,
                  plugin.stars ? react.createElement("span", null, ` · ⭐ ${plugin.stars}`) : null,
                  plugin.downloads ? react.createElement("span", null, ` · ⬇ ${plugin.downloads}`) : null
                )
              ),
              react.createElement("p", { className: "dm-card-desc" }, plugin.description || "暂无描述"),
              react.createElement("div", { className: "dm-card-footer" },
                react.createElement("span", { className: "dm-card-meta-text" },
                  plugin.author ? `作者: ${plugin.author}` : (plugin.added ? `收录于 ${plugin.added}` : "")
                ),
                react.createElement("div", { className: "dm-card-actions" },
                  plugin.homepage ? react.createElement("a", {
                    className: "dm-action-btn",
                    href: plugin.homepage,
                    target: "_blank",
                    rel: "noreferrer",
                    title: "查看源码"
                  }, "源码") : null,
                  react.createElement("button", {
                    className: "dm-action-btn",
                    type: "button",
                    disabled: busy,
                    onClick: () => copyCommand(plugin, kind)
                  }, "复制指令"),
                  isInstalled ? react.createElement("button", {
                    className: "dm-action-btn danger",
                    type: "button",
                    disabled: busy,
                    onClick: () => void startRemove(plugin.name),
                  }, "卸载") : null,
                  btnLabel && canInstall ? react.createElement("button", {
                    className: btnClass,
                    type: "button",
                    disabled: btnDisabled,
                    onClick: () => void startInstall(plugin.name, kind),
                  }, btnLabel) : null
                )
              )
            )
          );
        };

        const saveConfig = async (next) => {
          try {
            const value = await callRpc("updateConfig", next);
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
          ? taskState.status === "running" ? "进行中…" : taskState.status === "success" ? "成功" : "失败"
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
            react.createElement("div", { style: { fontSize: "14px", fontWeight: "600", display: "flex", alignItems: "center", gap: "6px" } },
              restartingState === "ready" ? "服务重启完成"
                : restartingState === "timeout" ? "服务重启超时"
                  : "正在平滑重启 DeepSeek Harness 服务…"),
            react.createElement("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary)" } },
              restartingState === "ready" ? "新实例已就绪，正在自动刷新页面恢复..."
                : restartingState === "timeout" ? "90 秒内未能确认新实例就绪。请检查服务进程状态或稍后手动重试。"
                  : "后台正在重新拉起守护进程，前端正自动探测端口并在就绪后无缝恢复，请稍候..."),
            restartingState === "timeout" ? react.createElement("button", {
              className: "dm-action-btn primary",
              type: "button",
              onClick: () => setRestartingState(null),
            }, "知道了") : null)
            : null,
          react.createElement("div", { className: "dm-repo-banner" },
            react.createElement("div", { className: "dm-repo-info" },
              "仓库: ", react.createElement("strong", null, repoOrigin),
              " · 当前 profile: ", react.createElement("strong", null, profile)),
            react.createElement("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
              react.createElement("button", {
                className: "dm-action-btn warning",
                type: "button",
                disabled: Boolean(restartingState),
                onClick: startAsyncRestart,
              },
                react.createElement(IconRefresh, { size: 13 }),
                react.createElement("span", null, restartingState ? "重启中…" : "立即重启服务")
              ),
              react.createElement("span", { className: "dm-repo-badge" }, `自有 ${repoPlugins.length} 款 · 社区 ${communityPlugins.length} 款`))),
          taskState ? react.createElement("div", { className: "dm-install-box" },
            react.createElement("div", { className: "dm-install-head" },
              react.createElement("span", null, taskHeaderTitle),
              react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
                react.createElement("span", { style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary)" } }, taskState.profile || ""),
                react.createElement("button", {
                  className: "dm-close-btn",
                  type: "button",
                  title: "关闭任务日志面板",
                  onClick: () => setTaskState(null),
                }, "✕")
              )),
            react.createElement("pre", { className: "dm-install-log" }, (taskState.log || []).slice(-20).join("\n") || "等待任务输出…"))
            : null,
          react.createElement("div", { className: "dm-tabs" },
            react.createElement("button", { className: `dm-tab-btn ${tab === "repo" ? "active" : ""}`, type: "button", onClick: () => setTab("repo") }, "自有插件"),
            react.createElement("button", { className: `dm-tab-btn ${tab === "community" ? "active" : ""}`, type: "button", onClick: () => setTab("community") }, "社区插件"),
            react.createElement("button", { className: `dm-tab-btn ${tab === "config" ? "active" : ""}`, type: "button", onClick: () => setTab("config") }, "配置")),
          tab !== "config" ? react.createElement(react.Fragment, null,
            react.createElement("div", { className: "dm-filter-bar" },
              tab === "community" ? react.createElement("div", { className: "dm-filter-group" },
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
                }, `未安装 (${uninstalledCount})`)) : react.createElement("div", null),
              react.createElement("div", { className: "dm-toolbar-right" },
                tab === "repo" ? react.createElement(react.Fragment, null,
                  react.createElement("button", {
                    className: "dm-action-btn primary",
                    type: "button",
                    disabled: Boolean(taskState && taskState.status === "running") || repoUpdateCount === 0,
                    onClick: () => void startBatchUpdate("repo"),
                  },
                    react.createElement(IconRocket, { size: 13 }),
                    react.createElement("span", null, `一键更新全部 (${repoUpdateCount})`)
                  ),
                  react.createElement("button", {
                    className: "dm-action-btn",
                    type: "button",
                    disabled: loading,
                    onClick: () => void loadRepo()
                  },
                    react.createElement(IconRefresh, { size: 13 }),
                    react.createElement("span", null, loading ? "正在同步…" : "检查更新")
                  )
                )
                  : null,
                tab === "community" ? react.createElement(react.Fragment, null,
                  react.createElement("button", {
                    className: "dm-action-btn primary",
                    type: "button",
                    disabled: Boolean(taskState && taskState.status === "running") || communityUpdateCount === 0,
                    onClick: () => void startBatchUpdate("community"),
                  },
                    react.createElement(IconRocket, { size: 13 }),
                    react.createElement("span", null, `一键更新全部 (${communityUpdateCount})`)
                  ),
                  react.createElement("button", {
                    className: "dm-action-btn",
                    type: "button",
                    disabled: loadingCommunity,
                    onClick: () => void loadCommunity(1, false)
                  },
                    react.createElement(IconRefresh, { size: 13 }),
                    react.createElement("span", null, loadingCommunity ? "正在刷新…" : "刷新目录")
                  )
                ) : null
              )
            ),
            react.createElement("div", { className: "dm-search-wrap" },
              react.createElement("div", { className: "dm-search-icon" }, react.createElement(IconSearch, { size: 14 })),
              react.createElement("input", {
                type: "text",
                className: "dm-search-box",
                placeholder: "搜索插件名称、描述或标签（如 terminal、vision、路由）…",
                value: search,
                onChange: (e) => setSearch(e.target.value),
              }),
              search ? react.createElement("button", {
                className: "dm-search-clear",
                type: "button",
                onClick: () => setSearch(""),
                title: "清空搜索",
              }, "✕") : null
            )
          ) : null,
          tab === "repo" ? (
            filteredRepo.length === 0
              ? react.createElement("div", { className: "dm-empty" }, "没有匹配的自有插件")
              : react.createElement("div", { className: "dm-grid" }, ...filteredRepo.map((p) => renderPluginCard(p, "repo")))
          ) : null,
          tab === "community" ? react.createElement(react.Fragment, null,
            categories.length > 0 ? (() => {
              const selectedIdx = categories.findIndex((c) => c.id === category);
              const isExpanded = showAllCategories || (selectedIdx >= 10);
              const visibleCategories = isExpanded ? categories : categories.slice(0, 10);
              return react.createElement("div", { className: "dm-chips-box" },
                react.createElement("div", { className: "dm-chips-head" },
                  react.createElement("span", { className: "dm-chips-title" },
                    react.createElement(IconTag, { size: 13 }),
                    react.createElement("span", null, `目录分类 (${categories.length})`)
                  ),
                  categories.length > 10 ? react.createElement("button", {
                    className: "dm-chips-toggle",
                    type: "button",
                    onClick: () => setShowAllCategories((v) => !v),
                  }, isExpanded ? "收起 ▴" : `展开全部 (${categories.length}) ▾`) : null
                ),
                react.createElement("div", { className: "dm-chips" },
                  react.createElement("button", { className: `dm-chip ${category === "" ? "active" : ""}`, type: "button", onClick: () => setCategory("") }, "全部"),
                  ...visibleCategories.map((c) => react.createElement("button", {
                    className: `dm-chip ${category === c.id ? "active" : ""}`,
                    type: "button",
                    key: c.id,
                    onClick: () => setCategory(c.id),
                  }, c.zh || c.en || c.id))
                )
              );
            })() : null,
            loadingCommunity
              ? react.createElement("div", { className: "dm-empty" }, "正在加载社区插件索引…")
              : (filteredCommunity.length === 0
                  ? react.createElement("div", { className: "dm-empty" },
                      q || category || filterStatus !== "all" ? "没有匹配的社区插件" : "社区插件索引为空或加载失败。",
                      react.createElement("br", null),
                      react.createElement("a", { href: "https://awesome-dsh-plugin.com", target: "_blank", rel: "noreferrer", style: { color: "var(--dsw-alias-brand-primary)", display: "inline-flex", alignItems: "center", gap: "4px" } },
                        react.createElement(IconGlobe, { size: 13 }),
                        react.createElement("span", null, "访问 Awesome DSH Plugins 官方导航")
                      ),
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
          ) : null,
          confirmState ? react.createElement("div", {
            className: "dm-modal-scrim",
            role: "dialog",
            "aria-modal": "true",
            onClick: () => closeConfirm(false),
          },
            react.createElement("div", {
              className: "dm-modal-card",
              onClick: (e) => e.stopPropagation(),
            },
              react.createElement("div", { className: "dm-modal-head" },
                react.createElement("div", { className: `dm-modal-icon ${confirmState.variant || "primary"}` },
                  confirmState.icon || react.createElement(IconAlertTriangle, { size: 20 })
                ),
                react.createElement("h3", { className: "dm-modal-title" }, confirmState.title || "确认操作")
              ),
              react.createElement("div", { className: "dm-modal-body" }, confirmState.message),
              react.createElement("div", { className: "dm-modal-foot" },
                react.createElement("button", {
                  className: "dm-action-btn",
                  type: "button",
                  onClick: () => closeConfirm(false),
                }, confirmState.cancelText || "取消"),
                react.createElement("button", {
                  className: `dm-action-btn ${confirmState.variant || "primary"}`,
                  type: "button",
                  autoFocus: true,
                  onClick: () => closeConfirm(true),
                }, confirmState.confirmText || "确定")
              )
            )
          ) : null
        );
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
        inject: () => ({ rpcCall }),
      }, PluginManagerSection));
    }

    exports.apply = apply;
    exports.inject = ["slots", "connection"];
    return module.exports;
  },
});
