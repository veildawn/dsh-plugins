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
  id: "@weniatall/dsh-remote-control",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    let primitives = {};
    try { primitives = require("@deepseek-ai/dsh-client-ui-primitives") || {}; } catch {}
    function DefaultBrandWordmark({ size = 24, className }) {
      return react.createElement("svg", {
        width: size, height: size, className, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true"
      },
        react.createElement("path", {
          d: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
          stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round"
        })
      );
    }
    const BrandWordmark = primitives.BrandWordmark || DefaultBrandWordmark;
    function DefaultIconGlobeOutline({ size = 14, className }) {
      return react.createElement("svg", {
        width: size, height: size, className, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", strokeWidth: 1.3
      },
        react.createElement("path", {
          d: "M7.99986 14.0887C11.3626 14.0887 14.0886 11.3627 14.0886 7.99998C14.0886 4.63727 11.3626 1.91125 7.99986 1.91125C4.63715 1.91125 1.91113 4.63727 1.91113 7.99998C1.91113 11.3627 4.63715 14.0887 7.99986 14.0887Z",
          stroke: "currentColor"
        }),
        react.createElement("path", { d: "M2.34619 8H13.6538", stroke: "currentColor", strokeLinecap: "square" }),
        react.createElement("path", {
          d: "M7.99976 14.0889C9.23509 14.0889 10.1743 11.3629 10.1743 8.00006C10.1743 4.63739 9.23509 1.91138 7.99976 1.91138",
          stroke: "currentColor"
        }),
        react.createElement("path", {
          d: "M7.99973 14.0889C6.76445 14.0889 5.8252 11.3629 5.8252 8.00006C5.8252 4.63739 6.76445 1.91138 7.99973 1.91138",
          stroke: "currentColor"
        })
      );
    }
    const IconGlobeOutline14 = primitives.IconGlobeOutline14 || primitives.IconGlobeOutlineMedium || primitives.IconGlobeOutlineRegular || DefaultIconGlobeOutline;

    function CopyIcon({ size = 13, className }) {
      return react.createElement("svg", {
        width: size, height: size, className, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true"
      },
        react.createElement("rect", { x: "5.5", y: "5.5", width: "8", height: "8", rx: "1.5" }),
        react.createElement("path", { d: "M3.5 10.5H2.5A1.5 1.5 0 0 1 1 9V2.5A1.5 1.5 0 0 1 2.5 1H9a1.5 1.5 0 0 1 1.5 1.5v1" })
      );
    }

    function CheckIcon({ size = 13, className }) {
      return react.createElement("svg", {
        width: size, height: size, className, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true"
      },
        react.createElement("path", { d: "M3 8.5l3.5 3.5 6.5-7" })
      );
    }

    const REMOTE_CONTROL_RPC_CHANNEL = "/dsh-remote-control";
    const CONFIG_RPC_CHANNEL = "/dsh-remote-control-config";
    const SESSION_PATH = "/dsh-remote-control/session";
    const STORAGE_KEY = "dsh-remote-control.secret";
    const LEGACY_STORAGE_KEY = "dsh-ai-proxy.remote-control-secret";
    const SETTINGS_SLOT = "settings.section";
    const ICON_SLOT = "settings.section.icon";
    const GATE_PRIORITY = -100;
    const inject = ["slots", "connection"];

    const uiCss = `
      .dsh-remote-gate,.dsh-remote-settings{color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family)}
      .dsh-remote-gate{position:fixed;inset:0;z-index:2147483647;display:grid;min-height:100dvh;place-items:center;overflow:auto;padding:24px;box-sizing:border-box;background:var(--dsw-alias-background-base,var(--dsw-alias-bg-base))}
      .dsh-remote-gate-mask{position:absolute;inset:0;background:var(--dsw-alias-background-overlay,var(--dsw-alias-bg-mask-1));backdrop-filter:var(--dsw-mask-blur);-webkit-backdrop-filter:var(--dsw-mask-blur)}
      .dsh-remote-gate-card{position:relative;width:min(100%,430px);box-sizing:border-box;padding:24px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-xl,24px);background:var(--dsw-alias-background-surface,var(--dsw-alias-bg-layer-2));box-shadow:var(--dsw-shadow-lv3);animation:dsh-remote-gate-in var(--ds-transition-duration) var(--ds-ease-in-out)}
      .dsh-remote-brand{display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin-bottom:24px;color:var(--dsw-alias-brand-primary,#4d6bfe)}.dsh-remote-brand span{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-s-14);font-size:12px}
      .dsh-remote-gate h1{margin:0 0 8px;font:var(--dsw-font-l-20)}.dsh-remote-copy{margin:0 0 20px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-s-14)}
      .dsh-remote-status{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-m,8px);background:var(--dsw-alias-background-base,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-label-secondary);font:var(--dsw-font-s-14)}.dsh-remote-gate .dsh-remote-status{margin-bottom:20px}
      .dsh-remote-dot{width:8px;height:8px;flex:none;border-radius:50%;background:var(--dsw-alias-state-warn-primary)}.dsh-remote-dot[data-active=true]{background:var(--dsw-alias-state-success-primary)}
      .dsh-remote-field{display:flex;flex-direction:column;gap:8px}.dsh-remote-gate-field{margin-bottom:12px}.dsh-remote-label{color:var(--dsw-alias-label-secondary);font:var(--dsw-font-s-14);font-weight:500}
      .dsh-remote-input{box-sizing:border-box;width:100%;height:38px;padding:0 12px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-m,8px);outline:none;background:var(--dsw-alias-background-base,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);transition:border-color .15s ease, box-shadow .15s ease}.dsh-remote-input:focus-visible{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 18%,transparent)}.dsh-remote-input:disabled{opacity:.8;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1));cursor:not-allowed}
      .dsh-remote-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:10px;margin-top:4px}
      .dsh-remote-button{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;height:34px;padding:0 16px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-pill,18px);background:var(--dsw-alias-background-surface,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);font-weight:500;cursor:pointer;transition:all .15s ease}.dsh-remote-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(125,125,125,0.08));border-color:var(--dsw-alias-border-l3,var(--dsw-alias-border-l2))}.dsh-remote-button:disabled{cursor:not-allowed;opacity:.75;border-color:var(--dsw-alias-border-l1)}.dsh-remote-button-primary:disabled{color:var(--dsw-alias-label-primary-foreground,#fff)}
      .dsh-remote-button-primary{border-color:transparent;background:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff)}.dsh-remote-button-primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 88%,#000);border-color:transparent}.dsh-remote-gate-button{width:100%}
      .dsh-remote-error{min-height:18px;margin:8px 0 0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}.dsh-remote-meta,.dsh-remote-details{color:var(--dsw-alias-label-quaternary,var(--dsw-alias-label-caption));font-size:12px;line-height:18px}.dsh-remote-meta{margin:20px 0 0;text-align:center}.dsh-remote-details{margin:0}

      /* 远程控制设置面板样式规范化与现代卡片层级设计 */
      .dsh-remote-settings{display:flex;flex-direction:column;gap:18px;width:100%;max-width:720px;padding:4px 0 24px}
      .dsh-remote-header{display:flex;flex-direction:column;gap:6px}
      .dsh-remote-settings h2{margin:0;font:var(--dsw-font-l-20);letter-spacing:-0.01em;font-weight:600}
      .dsh-remote-intro{margin:0;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-s-14);line-height:1.5}

      .dsh-remote-card{display:flex;flex-direction:column;gap:14px;padding:16px;border-radius:var(--dsw-radius-l,12px);border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));background:var(--dsw-alias-background-surface,var(--dsw-alias-bg-layer-2));box-sizing:border-box}
      .dsh-remote-card-header{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .dsh-remote-card-title{display:inline-flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}

      /* 开关项 */
      .dsh-remote-toggle-row{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-radius:var(--dsw-radius-m,8px);background:var(--dsw-alias-background-base,var(--dsw-alias-bg-module-platform));border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));cursor:pointer;user-select:none}
      .dsh-remote-toggle-text{display:flex;flex-direction:column;gap:2px}
      .dsh-remote-toggle-title{font-size:14px;font-weight:500;color:var(--dsw-alias-label-primary)}
      .dsh-remote-toggle-sub{font-size:12px;color:var(--dsw-alias-label-tertiary)}

      /* Switch 开关：配色与交互对齐宿主官方 switch（ui-primitives）。
         关键点：开启态的轨道是 --dsw-alias-brand-primary，Zai 主题下暗色是白色；
         圆点必须取反色的 --dsw-alias-label-primary-foreground（暗色=黑），
         绝不能硬编码 #ffffff——白圆点压在白轨道上会整个消失，开关看起来只有
         一块白色胶囊，分不清开还是关。关闭态圆点用 --dsw-alias-switch-thumb。 */
      .dsh-remote-switch{position:relative;display:inline-block;width:38px;height:22px;flex:none;cursor:pointer;overflow:hidden}
      /* 移动端适配会按 [role="switch"] 给 44px 触摸目标，会把透明 checkbox 撑成方块盖住滑块，
         这里显式压回 0 并 !important，保证开关始终是 38×22。 */
      .dsh-remote-switch input{opacity:0;width:0!important;height:0!important;min-width:0!important;min-height:0!important;margin:0;padding:0;border:0;appearance:none}
      .dsh-remote-slider{position:absolute;cursor:pointer;inset:0;background-color:var(--dsw-alias-border-l3,rgba(125,125,125,0.25));border-radius:22px;transition:.2s cubic-bezier(0.4, 0, 0.2, 1)}
      .dsh-remote-slider:before{position:absolute;content:"";height:16px;width:16px;left:3px;bottom:3px;background-color:var(--dsw-alias-switch-thumb,#ffffff);border-radius:50%;transition:transform .2s cubic-bezier(0.4, 0, 0.2, 1),background-color .2s cubic-bezier(0.4, 0, 0.2, 1);box-shadow:0 1px 3px rgba(0,0,0,0.2)}
      .dsh-remote-switch input:checked + .dsh-remote-slider{background-color:var(--dsw-alias-brand-primary,#4d6bfe)}
      .dsh-remote-switch input:checked + .dsh-remote-slider:before{transform:translateX(16px);background-color:var(--dsw-alias-label-primary-foreground,#ffffff)}
      .dsh-remote-switch input:disabled + .dsh-remote-slider{opacity:.4;cursor:default}

      /* 状态与诊断徽标条 */
      .dsh-remote-status-banner{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border-radius:var(--dsw-radius-m,8px);background:var(--dsw-alias-background-base,var(--dsw-alias-bg-module-platform));border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));font-size:12px}
      .dsh-remote-status-group{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary)}

      /* 网络信息卡片 */
      .dsh-remote-network-card{display:flex;flex-direction:column;gap:12px;padding:16px;border-radius:var(--dsw-radius-l,12px);border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));background:var(--dsw-alias-background-surface,var(--dsw-alias-bg-layer-2));font:var(--dsw-font-s-14)}
      .dsh-remote-network-title{display:flex;align-items:center;gap:8px;font-weight:600;color:var(--dsw-alias-label-primary)}
      .dsh-remote-network-list{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
      .dsh-remote-network-item{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px;background:var(--dsw-alias-background-base,var(--dsw-alias-bg-module-platform));padding:8px 12px;border-radius:var(--dsw-radius-m,8px);border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));transition:border-color .15s ease}
      .dsh-remote-network-item:hover{border-color:var(--dsw-alias-border-default,var(--dsw-alias-border-l2))}
      .dsh-remote-network-url{color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:12.5px;text-decoration:none;user-select:all;word-break:break-all}
      .dsh-remote-item-right{display:inline-flex;align-items:center;gap:6px;flex:none}
      .dsh-remote-tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:500;background:var(--dsw-alias-border-subtle,rgba(125,125,125,0.12));color:var(--dsw-alias-label-secondary)}
      .dsh-remote-copy-btn{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:4px;background:var(--dsw-alias-background-surface,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary) !important;font-size:11px;cursor:pointer;transition:all .15s ease}
      .dsh-remote-copy-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(125,125,125,0.12));color:var(--dsw-alias-label-primary) !important;border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
      .dsh-remote-copy-btn.copied{color:var(--dsw-alias-state-success-primary,#10b981) !important;border-color:var(--dsw-alias-state-success-primary,#10b981)}
      .dsh-remote-host-switch{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-background-base,var(--dsw-alias-bg-module-platform));border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));font-size:13px}
      /* 标签、输入框、按钮一律不收缩不换行，三者占一行；
         说明文字独占整行（flex-basis:100%），空间不够时整段下移而不是被压窄或截断。 */
      .dsh-remote-port-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-background-base,var(--dsw-alias-bg-module-platform));border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));font-size:13px;line-height:20px}
      .dsh-remote-port-row>*{flex:none;white-space:nowrap}
      .dsh-remote-port-hint{flex:1 0 100%;white-space:normal;line-height:18px}
      .dsh-remote-host-btn{display:inline-flex;align-items:center;justify-content:center;flex:none;white-space:nowrap;line-height:20px;padding:4px 12px;border-radius:12px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));background:var(--dsw-alias-background-surface,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);font-size:12px;font-weight:500;cursor:pointer;transition:all .15s ease}
      .dsh-remote-host-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(125,125,125,0.08));border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
      .dsh-remote-host-btn:disabled{opacity:.75;border-color:var(--dsw-alias-border-l1);cursor:not-allowed}
      @keyframes dsh-remote-gate-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.dsh-remote-gate-card{animation:none}}@media(max-width:520px){.dsh-remote-gate{padding:16px}.dsh-remote-gate-card{padding:20px;border-radius:var(--dsw-radius-l,12px)}}

      /* 远程浏览器的站内目录选择框：宿主在远程访问下没有可用的 browse 后端，
         这里自带一个，样式与宿主对话框同族但独立命名，避免被设置面板样式污染。

         关于桌面端标题栏：这份遮罩**故意不**避让 Windows 原生标题栏。它只在
         远程浏览器上挂载（isRemoteBrowser() 排除了 dsh-app: 与 file: 协议），
         Electron 桌面端永远不会渲染它，而远程设备（手机/平板/别的电脑）没有那排
         按钮 —— 加 --dsh-windows-titlebar-height 偏移反而会在顶部留一条死区。 */
      .dsh-remote-dir-scrim{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:var(--dsw-alias-background-overlay,rgba(0,0,0,.45));pointer-events:auto}
      /* overflow:hidden 必须留着：圆角 + max-height 下靠它把溢出的内容收在卡片内，
         否则子元素会画到卡片边框外面。 */
      .dsh-remote-dir-card{display:flex;flex-direction:column;width:min(100%,560px);max-height:min(80vh,620px);max-height:min(80dvh,620px);padding:20px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-l,12px);background:var(--dsw-alias-background-surface,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);box-shadow:var(--dsw-shadow-lv3);overflow:hidden;pointer-events:auto}
      .dsh-remote-dir-title{margin:0;font:var(--dsw-font-l-20);font-weight:600}
      /* 路径栏就是一个可编辑输入框：回车跳到该路径，失焦退回当前实际路径。 */
      .dsh-remote-dir-path{display:flex;align-items:center;gap:8px;margin:12px 0 0}
      .dsh-remote-dir-path input{flex:1 1 auto;min-width:0;height:30px;padding:0 10px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-m,8px);background:var(--dsw-alias-background-base,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
      .dsh-remote-dir-path input:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 18%,transparent)}
      /* 盘符行：没有它就只能困在 C 盘里。 */
      .dsh-remote-dir-drives{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:8px 0 0}
      .dsh-remote-dir-drive{flex:none;white-space:nowrap;padding:2px 10px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-pill,18px);background:var(--dsw-alias-background-base,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-label-secondary);font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;cursor:pointer}
      .dsh-remote-dir-drive:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
      .dsh-remote-dir-drive[data-current=true]{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
      .dsh-remote-dir-crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin:8px 0 0;padding:0;list-style:none;font-size:12px}
      .dsh-remote-dir-crumb{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 8px;border:1px solid transparent;border-radius:6px;background:var(--dsw-alias-background-base,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;cursor:pointer}
      .dsh-remote-dir-crumb:hover{border-color:var(--dsw-alias-border-default,var(--dsw-alias-border-l2));color:var(--dsw-alias-label-primary)}
      .dsh-remote-dir-crumb[data-current=true]{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
      .dsh-remote-dir-sep{color:var(--dsw-alias-label-quaternary,var(--dsw-alias-label-caption))}
      /* 列表高度用 max-height 钉死，不指望 flex 收缩：只有 max-height 的 flex 容器
         在某些流式布局里不会让子项收缩，内容会被静默裁掉却又不产生滚动。 */
      .dsh-remote-dir-list{flex:1 1 auto;min-height:80px;max-height:min(46vh,340px);max-height:min(46dvh,340px);margin:10px 0 0;padding:4px;overflow-y:auto;overscroll-behavior:contain;list-style:none;border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-m,8px);background:var(--dsw-alias-background-base,var(--dsw-alias-bg-module-platform));scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l3,rgba(125,125,125,.55)) transparent}
      .dsh-remote-dir-list::-webkit-scrollbar{width:10px}
      .dsh-remote-dir-list::-webkit-scrollbar-thumb{border:2px solid transparent;border-radius:5px;background:var(--dsw-alias-border-l3,rgba(125,125,125,.55));background-clip:content-box}
      .dsh-remote-dir-entry{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);text-align:left;cursor:pointer}
      .dsh-remote-dir-entry:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(125,125,125,0.1))}
      .dsh-remote-dir-empty{display:grid;place-items:center;min-height:80px;color:var(--dsw-alias-label-tertiary);font-size:13px}
      .dsh-remote-dir-note{margin:6px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px}
      .dsh-remote-dir-footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-top:14px}
      .dsh-remote-dir-create{display:flex;align-items:center;gap:8px;flex:1 1 240px}
      .dsh-remote-dir-create input{flex:1 1 auto;min-width:0;height:32px;padding:0 10px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-m,8px);background:var(--dsw-alias-background-base,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
      /* 按钮不许被 flex 压扁：「创建」曾经被挤成竖排两个字。 */
      .dsh-remote-dir-create button{flex:none;white-space:nowrap}
      .dsh-remote-dir-actions{display:flex;align-items:center;gap:8px;flex:none;margin-left:auto}
      .dsh-remote-dir-actions button{flex:none;white-space:nowrap}
      /* 只有列表吸收伸缩。标题/路径/盘符/面包屑/页脚都是固定内容，若不锁住，
         小屏上它们会被压扁，甚至把页脚按钮挤出卡片（卡片 overflow:hidden 会裁掉）。 */
      .dsh-remote-dir-title,.dsh-remote-dir-path,.dsh-remote-dir-drives,.dsh-remote-dir-crumbs,.dsh-remote-dir-note,.dsh-remote-dir-footer{flex:none}
    `;

    /**
     * 判断当前是否为远程浏览器访问。
     * 本地环境免除远程锁屏：
     * 1. 本机 Web 访问：localhost、127.0.0.1、IPv6 回环 [::1]；
     * 2. Electron 桌面端原生协议：dsh-app://app/... 或 file:// 协议，以及 hostname 为 "app"。
     */
    function isRemoteBrowser() {
      const protocol = globalThis.location?.protocol;
      if (protocol === "dsh-app:" || protocol === "file:") return false;
      const hostname = globalThis.location?.hostname;
      return typeof hostname === "string" && hostname.length > 0
        && hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "[::1]" && hostname !== "app";
    }

    function storedSecret() {
      try {
        return globalThis.localStorage?.getItem(STORAGE_KEY)
          || globalThis.localStorage?.getItem(LEGACY_STORAGE_KEY)
          || "";
      } catch { return ""; }
    }

    function saveSecret(value) {
      try {
        if (value) globalThis.localStorage?.setItem(STORAGE_KEY, value);
        else globalThis.localStorage?.removeItem(STORAGE_KEY);
        globalThis.localStorage?.removeItem(LEGACY_STORAGE_KEY);
      } catch {}
    }

    /**
     * 目录流程槽位：宿主 ui-workspace 为「添加工作区」声明了三个 single 洞，
     * 由当前 composition 挂载的 directory-picker 后端配套的客户端占用者填充。
     */
    const DIRECTORY_FLOW_SLOTS = [
      "conversation.hero.workspace.directoryFlow",
      "sidebar.workspaces.directoryFlow",
      "workspace.picker.directoryFlow",
    ];
    /**
     * 远程浏览器占用者的优先级。
     *
     * `single` 孔洞只渲染排序后的第一个条目。宿主本就会让动态注册的条目前排，
     * 但这个值显式钉死顺序：不依赖宿主未文档化的默认优先级，也不必猜测随包
     * 发布的 native/browse 占用者用了什么值。
     */
    const REMOTE_DIRECTORY_PRIORITY = -100;

    /**
     * 把目录原语的失败码翻译成给操作者看的话。
     *
     * 宿主机侧已经把插件内部的失败码投影成宿主的 `directory-picker/*` 词汇
     * （见 lib/index.js 的 DIRECTORY_BROWSE_WIRE_CODES），所以这里按码措辞，
     * 而不是把「cannot list C:\foo: EACCES」这种后端句子原样丢给用户。
     * @param error - 注入面抛出的错误，可能带 code。
     * @returns 展示文本。
     */
    function directoryFailureText(error) {
      const code = error?.code;
      if (code === "directory-picker/exists") return "同名文件夹已存在，请换一个名字。";
      if (code === "directory-picker/unreadable") return "这个文件夹读不了：可能没有权限，或它已经被删除。";
      if (code === "directory-picker/create-failed") return "新建文件夹失败：名字可能不合法，或该位置不可写。";
      return error instanceof Error ? error.message : String(error);
    }

    /**
     * 站内目录选择对话框。
     *
     * 远程浏览器的「添加工作区」必须落在页面里：宿主的 directory-picker 后端在
     * boot 时一次性确定（桌面端落到 native，即在宿主屏幕上弹系统对话框），
     * 远程客户端点下去只会让宿主机弹窗。这个组件替代那个占用者，通过注入的
     * 目录原语在宿主机上列举/创建目录，交互完全在浏览器里完成。
     *
     * @param props - 槽位 owner 的会话（open/busy/onPicked/onCancel/onError）加上注入的目录原语。
     */
    function RemoteDirectoryFlow(props) {
      const { open, busy, onPicked, onCancel, listDirectory, createDirectory, listDrives } = props;
      const [listing, setListing] = react.useState(null);
      const [failure, setFailure] = react.useState("");
      const [draft, setDraft] = react.useState("");
      const [creating, setCreating] = react.useState(false);
      const [drives, setDrives] = react.useState([]);
      // null 表示「跟随 listing.path」；输入时是用户正在敲的文本。
      // 这样列举成功后输入框自动变成新路径，失败时退回原路径。
      const [pathDraft, setPathDraft] = react.useState(null);
      // 卸载后不再回写状态：关掉对话框时可能还有列举请求在飞。
      // 挂载时**同时**置回 true —— 只置 false 的话，StrictMode 的双挂载
      // （mount → unmount → mount）会让它永久停在 false，对话框卡在「加载中…」。
      const alive = react.useRef(true);
      react.useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; };
      }, []);
      // 请求序号：只认最后一次列举的结果。点两下目录时，慢的那个回来后不能
      // 把界面拽回旧层级 —— 否则用户以为停在 B，点「选择此文件夹」提交的却是 A。
      const seq = react.useRef(0);

      const load = async (path) => {
        const mine = (seq.current += 1);
        if (alive.current) setFailure("");
        try {
          const next = await listDirectory(path);
          if (alive.current && seq.current === mine) setListing(next);
        } catch (error) {
          if (!alive.current || seq.current !== mine) return;
          // 失败就地展示，不调 owner 的 onError：宿主官方的 browse 占用者同样
          // 把「读不了 / 建不了」留在对话框自己的提示里，owner 的错误面留给
          // 「选择器根本不存在」这类流程级故障。这里对话框本身还能继续导航。
          setFailure(directoryFailureText(error));
        }
      };

      // 盘符列表：没有它，目录树走到 `C:\` 就到头了，选不了别的盘。失败就静默
      // 留空（用户仍可手输路径），不要用盘符探测失败去打断主流程。
      const loadDrives = async () => {
        if (typeof listDrives !== "function") return;
        try {
          const next = await listDrives();
          if (alive.current && Array.isArray(next)) setDrives(next);
        } catch {
          // 静默：盘符枚举只是便利入口。
        }
      };

      /** 提交路径栏里手输的路径；空输入等价于放弃编辑。 */
      const submitPath = () => {
        const target = (pathDraft ?? "").trim();
        setPathDraft(null);
        if (target === "") return;
        void load(target);
      };

      // 只挂在 `open` 的上升沿上：注入面每次渲染都是新函数，把 load 放进依赖会
      // 让失败后 listing 仍为 null 的那一帧再次触发 effect —— 一次读不到的目录
      // 会变成无休止的重试。层级导航全部由点击驱动，不需要 effect 参与。
      react.useEffect(() => {
        if (!open) {
          // 作废所有在飞请求：关掉再打开时，上一次的响应不能落到新的层级上。
          seq.current += 1;
          setListing(null);
          setFailure("");
          setDraft("");
          setPathDraft(null);
          return;
        }
        void load(undefined);
        void loadDrives();
      }, [open]);

      // Escape 关闭。用 ref 拿最新的 onCancel：owner 每次渲染可能给新函数，
      // 直接放进依赖会让监听器每渲染一次就重绑一遍。
      const cancelRef = react.useRef(onCancel);
      cancelRef.current = onCancel;
      react.useEffect(() => {
        if (!open) return;
        if (typeof globalThis.addEventListener !== "function") return;
        const onKeyDown = (event) => {
          if (event.key === "Escape") cancelRef.current();
        };
        globalThis.addEventListener("keydown", onKeyDown);
        return () => globalThis.removeEventListener("keydown", onKeyDown);
      }, [open]);

      const create = async () => {
        const name = draft.trim();
        if (!name || listing === null) return;
        setCreating(true);
        setFailure("");
        try {
          // 创建后不自动提交：用户可能还要再看一眼层级，宿主原生对话框同样是
          // 「建好 → 停在新目录」而不是直接选定。
          const created = await createDirectory(listing.path, name);
          if (!alive.current) return;
          setDraft("");
          await load(created);
        } catch (error) {
          if (!alive.current) return;
          setFailure(directoryFailureText(error));
        } finally {
          if (alive.current) setCreating(false);
        }
      };

      if (!open) return null;

      const crumbs = listing?.crumbs ?? [];
      const entries = listing?.entries ?? [];
      const rows = entries.length === 0
        ? [react.createElement("li", { key: "__empty", className: "dsh-remote-dir-empty" },
            listing === null ? "加载中…" : "这里没有子文件夹")]
        : entries.map((entry) => react.createElement("li", { key: entry.path },
            react.createElement("button", {
              type: "button",
              className: "dsh-remote-dir-entry",
              onClick: () => { void load(entry.path); },
            }, entry.name)));

      return react.createElement("div", {
        className: "dsh-remote-dir-scrim",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": "选择工作区目录",
        onMouseDown: (event) => { if (event.target === event.currentTarget) onCancel(); },
      }, react.createElement("div", { className: "dsh-remote-dir-card" },
        react.createElement("h2", { className: "dsh-remote-dir-title" }, "选择工作区目录"),
        // 路径栏本身可编辑：支持直接键入路径跳转，不必逐层点进去。
        react.createElement("div", { className: "dsh-remote-dir-path" },
          react.createElement("input", {
            type: "text",
            "aria-label": "目录路径",
            spellCheck: false,
            placeholder: "输入目录路径后回车跳转",
            value: pathDraft ?? listing?.path ?? "",
            onChange: (event) => setPathDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === "Enter") submitPath();
              if (event.key === "Escape") { setPathDraft(null); }
            },
            // 失焦退回实际路径：没提交的编辑不该继续显示成一个并不存在的当前位置。
            onBlur: () => setPathDraft(null),
          })),
        // 盘符入口：只有探测到多个驱动器时才出现（POSIX 上只有 "/"，显示它没意义）。
        drives.length > 1
          ? react.createElement("div", { className: "dsh-remote-dir-drives" },
              drives.map((drive) => react.createElement("button", {
                key: drive.path,
                type: "button",
                className: "dsh-remote-dir-drive",
                "data-current": String(drive.name).slice(0, 2).toUpperCase() === String(listing?.path ?? "").slice(0, 2).toUpperCase() ? "true" : "false",
                title: drive.path,
                onClick: () => { void load(drive.path); },
              }, drive.name)))
          : null,
        react.createElement("ul", { className: "dsh-remote-dir-crumbs" },
          crumbs.map((crumb, index) => react.createElement("li", { key: crumb.path },
            index > 0 ? react.createElement("span", { className: "dsh-remote-dir-sep" }, "›") : null,
            react.createElement("button", {
              type: "button",
              className: "dsh-remote-dir-crumb",
              "data-current": crumb.path === listing?.path ? "true" : "false",
              title: crumb.path,
              onClick: () => { void load(crumb.path); },
            }, crumb.name)))),
        react.createElement("ul", { className: "dsh-remote-dir-list" }, rows),
        listing?.truncated === true
          ? react.createElement("p", { className: "dsh-remote-dir-note" }, "文件夹过多，仅显示开头部分。")
          : null,
        failure ? react.createElement("p", { className: "dsh-remote-error" }, failure) : null,
        react.createElement("div", { className: "dsh-remote-dir-footer" },
          react.createElement("div", { className: "dsh-remote-dir-create" },
            react.createElement("input", {
              className: "dsh-remote-input",
              placeholder: "新建文件夹",
              value: draft,
              disabled: creating || listing === null,
              onChange: (event) => setDraft(event.target.value),
              onKeyDown: (event) => { if (event.key === "Enter") void create(); },
            }),
            react.createElement("button", {
              type: "button",
              className: "dsh-remote-button",
              disabled: creating || listing === null || draft.trim() === "",
              onClick: () => { void create(); },
            }, creating ? "创建中…" : "创建")),
          react.createElement("div", { className: "dsh-remote-dir-actions" },
            react.createElement("button", {
              type: "button", className: "dsh-remote-button", onClick: onCancel,
            }, "取消"),
            react.createElement("button", {
              type: "button",
              className: "dsh-remote-button dsh-remote-button-primary",
              disabled: busy || listing === null,
              onClick: () => { if (listing !== null) onPicked(listing.path); },
            }, busy ? "处理中…" : "选择此文件夹")))));
    }

    function apply(ctx) {
      if (typeof document !== "undefined" && !document.getElementById("dsh-remote-control-styles")) {
        const style = document.createElement("style");
        style.id = "dsh-remote-control-styles";
        style.textContent = uiCss;
        document.head.appendChild(style);
      }
      const remoteBrowser = isRemoteBrowser();
      if (ctx.connection) {
        ctx.connection.isLoopback = true;
      }
      let currentSecret = storedSecret();
      const rpc = (channel, method, payload = {}, signal) => ctx.connection.rpc.call(channel, method, payload, signal);
      const remoteResult = (method, payload = {}, signal, token = currentSecret) => rpc(
        REMOTE_CONTROL_RPC_CHANNEL,
        method,
        Object.assign({}, payload, { token }),
        signal,
      );
      const remoteRequest = async (method, payload = {}, signal) => {
        const result = await remoteResult(method, payload, signal);
        if (!result || result.ok !== true) throw new Error(result?.error?.message || "Remote Control request failed");
        return result.value;
      };
      const configRequest = async (method, payload = {}) => {
        const result = await rpc(CONFIG_RPC_CHANNEL, method, payload);
        if (!result || result.ok !== true) throw new Error(result?.error?.message || "Remote Control configuration failed");
        return result.value;
      };

      /**
       * Complete the host-side browser session once the shared secret is verified.
       * The gate alone cannot carry the workspace: every /api request — including
       * the remote.mux stream behind connection.state — stays fenced by Connection's
       * process-token cookie, so without this exchange a remote page unlocks and then
       * sits at 自动重连中 forever. A missing endpoint (older host build) degrades to
       * the previous behaviour instead of locking the user out.
       */
      const openSession = async (token) => {
        if (typeof globalThis.fetch !== "function") return { ok: true, skipped: true };
        try {
          const response = await globalThis.fetch(SESSION_PATH, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token }),
            credentials: "same-origin",
          });
          if (response.status === 404 || response.status === 405) return { ok: true, unsupported: true };
          let payload;
          try {
            payload = await response.json();
          } catch {
            payload = undefined;
          }
          if (response.status !== 200) {
            const message = payload?.error?.message;
            return {
              ok: false,
              message: typeof message === "string" && message ? message : "HTTP " + String(response.status),
            };
          }
          if (payload?.ok !== true) return { ok: false, message: "Host 未确认浏览器会话" };
          return { ok: true, minted: payload.minted === true };
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
      };

      /**
       * A page that reached the gate without a host session booted against a dead
       * /api surface, so restart it once the freshly minted cookie exists. The
       * reloaded page re-runs the automatic check and finds the session already
       * alive, which keeps this from turning into a reload loop.
       */
      const reloadForFreshSession = (session) => {
        if (session.minted !== true) return false;
        const reload = globalThis.location?.reload;
        if (typeof reload !== "function") return false;
        reload.call(globalThis.location);
        return true;
      };

      /** Drop the official session this browser minted; failures keep the gate usable. */
      const closeSession = async (token) => {
        if (typeof globalThis.fetch !== "function" || !token) return;
        try {
          await globalThis.fetch(SESSION_PATH, {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token }),
            credentials: "same-origin",
          });
        } catch {}
      };

      const syncSettingsMirror = () => {
        try {
          if (ctx.connection) ctx.connection.isLoopback = true;
          const settingsScope = ctx.get("settingsScope");
          const mirror = settingsScope?.describe?.();
          if (mirror) {
            mirror.persistence = "host";
            if (mirror.store && typeof mirror.store.getSnapshot === "function") {
              const snapshot = mirror.store.getSnapshot();
              if (snapshot && (snapshot.status === "unavailable" || snapshot.view === void 0)) {
                mirror.store.set(Object.assign({}, snapshot, { status: "idle" }));
              }
            }
            mirror.load?.();
          }
        } catch (err) {
          console.error("[dsh-remote-control] failed to sync settings mirror:", err);
        }
      };

      ctx.inject(["settingsScope"], () => {
        syncSettingsMirror();
      });

      let disposeGate;
      let initialGateError = "";
      const unlock = () => {
        const dispose = disposeGate;
        disposeGate = undefined;
        dispose?.();
        syncSettingsMirror();
        try {
          ctx.connection?.reconnect?.();
        } catch {}
      };

      function UnlockScreen() {
        const [secret, setSecret] = react.useState(storedSecret);
        const [state, setState] = react.useState({ checking: true, enabled: false, secretConfigured: false });
        const [busy, setBusy] = react.useState(false);
        const [error, setError] = react.useState(initialGateError);
        const check = async (token, automatic = false) => {
          setBusy(true);
          if (!automatic) setError("");
          try {
            const result = await remoteResult("status", {}, undefined, token);
            if (!result || result.ok !== true) throw new Error(result?.error?.message || "无法读取远程控制状态");
            const next = result.value || {};
            if (next.authenticated === true) {
              const session = await openSession(token.trim());
              if (session.ok !== true) {
                setState({ checking: false, enabled: next.enabled === true, secretConfigured: next.secretConfigured === true });
                setError("密钥校验通过，但未能建立官方浏览器会话: " + session.message);
                return;
              }
              currentSecret = token.trim();
              saveSecret(currentSecret);
              if (reloadForFreshSession(session)) return;
              unlock();
              return;
            }
            if (automatic && token) {
              currentSecret = "";
              saveSecret("");
              setSecret("");
            }
            setState({ checking: false, enabled: next.enabled === true, secretConfigured: next.secretConfigured === true });
            if (!automatic || token) setError(automatic && token ? "保存的访问密钥已失效，请重新输入" : token ? "访问密钥无效，请重试" : "请输入远程访问密钥");
          } catch (cause) {
            setState((value) => Object.assign({}, value, { checking: false }));
            setError(cause instanceof Error ? cause.message : String(cause));
          } finally {
            setBusy(false);
          }
        };
        react.useEffect(() => { void check(secret, true); }, []);
        react.useEffect(() => {
          if (typeof document === "undefined") return;
          const previous = document.title;
          document.title = "DeepSeek Harness — 远程工作区已锁定";
          return () => { document.title = previous; };
        }, []);
        const text = state.checking
          ? "正在检查宿主机远程访问状态…"
          : !state.enabled
            ? "远程控制未在宿主机启用"
            : !state.secretConfigured
              ? "宿主机尚未配置远程访问密钥"
              : "请输入远程访问密钥解锁";
        const unavailable = state.checking || !state.enabled || !state.secretConfigured;
        return react.createElement("main", { className: "dsh-remote-gate", "aria-labelledby": "dsh-remote-gate-title" },
          react.createElement("style", null, uiCss),
          react.createElement("div", { className: "dsh-remote-gate-mask", "aria-hidden": "true" }),
          react.createElement("section", { className: "dsh-remote-gate-card", role: "dialog", "aria-modal": "true", "aria-labelledby": "dsh-remote-gate-title" },
            react.createElement("div", { className: "dsh-remote-brand" },
              react.createElement(BrandWordmark, { size: 24 }),
              react.createElement("span", null, "DSH · Remote Control")
            ),
            react.createElement("h1", { id: "dsh-remote-gate-title" }, "远程工作区已锁定"),
            react.createElement("p", { className: "dsh-remote-copy" }, "验证前不会加载工作区内容或开放特权接口。"),
            react.createElement("div", { className: "dsh-remote-status", role: "status", "aria-live": "polite" },
              react.createElement("span", { className: "dsh-remote-dot", "data-active": state.enabled }),
              react.createElement("span", null, text)
            ),
            react.createElement("form", { onSubmit: (event) => {
              event.preventDefault();
              const token = secret.trim();
              if (token) void check(token);
            } },
              react.createElement("label", { className: "dsh-remote-field dsh-remote-gate-field" },
                react.createElement("span", { className: "dsh-remote-label" }, "远程访问密钥"),
                react.createElement("input", {
                  className: "dsh-remote-input", type: "password", value: secret,
                  autoComplete: "current-password", autoFocus: true, disabled: unavailable || busy,
                  "aria-label": "远程访问密钥", "aria-invalid": error ? "true" : "false",
                  onChange: (event) => setSecret(event.target.value),
                })
              ),
              react.createElement("button", {
                className: "dsh-remote-button dsh-remote-button-primary dsh-remote-gate-button",
                type: "submit", disabled: unavailable || busy || secret.trim().length === 0,
              }, busy ? "验证中…" : "解锁"),
              react.createElement("p", { className: "dsh-remote-error", role: "alert" }, error)
            ),
            react.createElement("p", { className: "dsh-remote-meta" }, "凭证仅保存在此浏览器 · " + (globalThis.location?.host || "Local Host"))
          )
        );
      }

      const mountGate = (error = "") => {
        if (!remoteBrowser || disposeGate) return;
        initialGateError = error;
        disposeGate = ctx.slots.register({ name: "root", priority: GATE_PRIORITY }, UnlockScreen);
      };
      const lock = () => {
        const token = currentSecret;
        currentSecret = "";
        saveSecret("");
        void closeSession(token);
        mountGate();
      };
      mountGate();

      const privilegedMethods = {
        agentPresets: ["read", "copy", "openDocument", "remove"],
        host: ["pickDirectory", "openPath"],
        settings: ["describe", "openDocument", "update", "replace", "mutate"],
        credentials: ["describe", "set", "unset"],
        llm: ["providers", "models", "discoverModels"],
      };
      for (const [domain, methods] of Object.entries(privilegedMethods)) {
        for (const method of methods) {
          const api = ctx.connection.api?.[domain];
          const direct = api?.[method];
          if (typeof direct !== "function" || direct.__dshRemoteControl) continue;
          const wrapped = async (payload, signal) => {
            if (!remoteBrowser) {
              try { return await direct(payload, signal); }
              catch (error) {
                if (!/HTTP 403\b/.test(error instanceof Error ? error.message : String(error))) throw error;
              }
            }
            const result = await remoteResult("call", {
              method: domain === "agentPresets" ? "agentPreset." + method : domain + "." + method,
              payload,
            }, signal);
            return { rpcId: "remote-control", result };
          };
          wrapped.__dshRemoteControl = true;
          api[method] = wrapped;
        }
      }

      function RemoteControlSettings(props) {
        const [busy, setBusy] = react.useState(false);
        const [remote, setRemote] = react.useState({ enabled: false, secretConfigured: false, authenticated: false, message: "正在检查远程控制状态…" });
        const [enabled, setEnabled] = react.useState(false);
        const [secret, setSecret] = react.useState(currentSecret);
        const [copiedIp, setCopiedIp] = react.useState("");
        const [portInput, setPortInput] = react.useState("");

        const copyText = async (text, id) => {
          let ok = false;
          if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
            try { await navigator.clipboard.writeText(text); ok = true; } catch {}
          }
          if (!ok && typeof document !== "undefined") {
            try {
              const el = document.createElement("textarea");
              el.value = text;
              el.style.position = "fixed";
              el.style.opacity = "0";
              document.body.appendChild(el);
              el.select();
              ok = document.execCommand("copy");
              document.body.removeChild(el);
            } catch {}
          }
          if (ok) {
            setCopiedIp(id);
            setTimeout(() => setCopiedIp((curr) => curr === id ? "" : curr), 1800);
          }
        };

        react.useEffect(() => {
          let active = true;
          const request = props.remoteBrowser ? props.remoteRequest("status") : props.configRequest("status");
          request.then((next) => {
            if (!active) return;
            setRemote(Object.assign({}, next, {
              message: props.remoteBrowser
                ? next.authenticated ? "远程控制已认证" : "远程控制未认证"
                : "本机配置可用",
            }));
            setEnabled(next.enabled === true);
            /* 宿主绑回环时（桌面端固定、web 也可这么配），对外端口由插件反代提供 */
            const lanEntryNext = next.bindLocked || next.lanGatewayActive;
            const shownPort = lanEntryNext ? next.lanGatewayPort : next.port;
            setPortInput(shownPort === undefined ? "" : String(shownPort));
          }, (error) => {
            if (active) setRemote((value) => Object.assign({}, value, { message: "无法读取远程控制状态: " + error.message }));
          });
          return () => { active = false; };
        }, []);
        const withBusy = async (action, prefix) => {
          setBusy(true);
          try { await action(); }
          catch (error) { setRemote((value) => Object.assign({}, value, { message: prefix + (error instanceof Error ? error.message : String(error)) })); }
          finally { setBusy(false); }
        };
        const verify = async () => {
          const token = secret.trim();
          const result = await props.remoteResult("status", {}, undefined, token);
          if (!result || result.ok !== true || result.value?.authenticated !== true) throw new Error(result?.error?.message || "远程控制认证失败");
          currentSecret = token;
          saveSecret(token);
          const session = await openSession(token);
          if (session.ok !== true) throw new Error("未能建立官方浏览器会话: " + session.message);
          if (reloadForFreshSession(session)) return;
          setRemote(Object.assign({}, result.value, { message: "远程控制已认证" }));
          syncSettingsMirror();
        };
        const save = () => withBusy(async () => {
          if (secret.trim()) await props.configRequest("setSecret", { secret: secret.trim() });
          const next = await props.configRequest("setEnabled", { enabled });
          setRemote((current) => Object.assign({}, current, next, {
            message: "远程控制设置已保存",
          }));
        }, "保存远程控制失败: ");
        const switchBindHost = (targetHost) => withBusy(async () => {
          const next = await props.configRequest("setBindHost", { host: targetHost });
          /* 宿主会把请求地址规范化成具体网卡 IP，界面以返回值为准 */
          const host = next?.host || targetHost;
          setRemote((current) => Object.assign({}, current, next, {
            host,
            isAllInterfaces: host !== "127.0.0.1" && host !== "localhost" && host !== "::1",
            message: "网络绑定已切换为 " + host + "（重启客户端或热重载后生效）",
          }));
        }, "切换网络绑定失败: ");
        const applyPort = () => withBusy(async () => {
          const port = Number(String(portInput).trim());
          if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口必须是 1 到 65535 之间的整数");
          /* 宿主绑回环时改的是插件自己监听的对外端口，宿主端口保持不动。 */
          const lanEntry = remote.bindLocked || remote.lanGatewayActive;
          const next = lanEntry
            ? await props.configRequest("setLanGatewayPort", { port })
            : await props.configRequest("setBindHost", { port });
          setRemote((current) => Object.assign({}, current, next, {
            message: "对外端口已改为 " + port + "（重启客户端后生效）",
          }));
          setPortInput(String(port));
        }, "修改端口失败: ");
        /* 宿主绑回环时（桌面端固定、web 也可这么配），对外端口由插件反代提供 */
        const lanEntry = remote.bindLocked || remote.lanGatewayActive;
        return react.createElement("div", { className: "dsh-remote-settings" },
          react.createElement("style", null, uiCss),
          react.createElement("div", { className: "dsh-remote-header" },
            react.createElement("h2", null, "远程控制 (Remote Control)"),
            react.createElement("p", { className: "dsh-remote-intro" }, "配置共享访问密钥，允许局域网设备通过浏览器访问当前工作区并执行受控操作。")
          ),

          /* 基础配置卡片 */
          react.createElement("div", { className: "dsh-remote-card" },
            /* 整行是唯一的 label，点击由原生 activation 触发一次 change；
               不可再嵌一层 label 或手写 onClick 翻转，否则会连发两次点击互相抵消 */
            react.createElement("label", { className: "dsh-remote-toggle-row" },
              react.createElement("div", { className: "dsh-remote-toggle-text" },
                react.createElement("span", { className: "dsh-remote-toggle-title" }, "启用远程访问"),
                react.createElement("span", { className: "dsh-remote-toggle-sub" }, "开启后宿主机将放行已通过密钥验证的远程设备请求")
              ),
              react.createElement("span", { className: "dsh-remote-switch" },
                react.createElement("input", {
                  type: "checkbox", role: "switch", checked: enabled, disabled: busy || props.remoteBrowser,
                  "aria-label": "启用远程访问", onChange: (event) => setEnabled(event.target.checked),
                }),
                react.createElement("span", { className: "dsh-remote-slider" })
              )
            ),
            react.createElement("label", { className: "dsh-remote-field" },
              react.createElement("span", { className: "dsh-remote-label" }, "远程访问密钥 / Token"),
              react.createElement("input", {
                className: "dsh-remote-input", type: "password", value: secret, autoComplete: "current-password",
                placeholder: "输入用于认证的访问密码或 Token",
                disabled: busy, "aria-label": "远程访问密钥", onChange: (event) => setSecret(event.target.value),
              })
            ),
            react.createElement("div", { className: "dsh-remote-status-banner" },
              react.createElement("div", { className: "dsh-remote-status-group" },
                react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)" } }, "访问环境:"),
                react.createElement("span", { className: "dsh-remote-tag" }, props.remoteBrowser ? "远程访问" : "本机访问")
              ),
              react.createElement("div", { className: "dsh-remote-status-group" },
                react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)" } }, "状态:"),
                react.createElement("span", { style: {
                  fontWeight: 500,
                  color: remote.authenticated || remote.message?.includes?.("已保存") || remote.message?.includes?.("本机配置可用")
                    ? "var(--dsw-alias-state-success-primary,#10b981)"
                    : "var(--dsw-alias-label-primary)"
                } }, remote.message)
              )
            )
          ),

          /* 网络服务与访问端口卡片 */
          remote.port ? react.createElement("div", { className: "dsh-remote-network-card" },
            react.createElement("div", { className: "dsh-remote-card-header" },
              react.createElement("div", { className: "dsh-remote-network-title" },
                react.createElement(IconGlobeOutline14, { size: 15 }),
                react.createElement("span", null, "网络服务与访问端口")
              ),
              react.createElement("span", { className: "dsh-remote-tag" }, "Port " + remote.port)
            ),
            !props.remoteBrowser ? react.createElement("div", { className: "dsh-remote-host-switch" },
              react.createElement("span", { style: { color: "var(--dsw-alias-label-secondary)" } },
                "监听地址: ",
                react.createElement("strong", { style: { color: "var(--dsw-alias-label-primary)", fontFamily: "ui-monospace,monospace" } }, remote.host || "127.0.0.1"),
                remote.isAllInterfaces ? " (已开放局域网)" : " (仅本机)"
              ),
              /* 宿主只接受具体网卡 IP，通配 0.0.0.0 会让整个 profile 起不来，
                 因此「开放局域网」绑到第一块非回环网卡，并把地址显示出来。
                 桌面端宿主写死连 127.0.0.1，改绑会让应用启动失败，故不提供切换按钮。 */
              remote.bindLocked || remote.lanGatewayActive
                ? react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px" } },
                    remote.bindLocked
                      ? "桌面端固定 127.0.0.1，不可改绑"
                      : "宿主固定 127.0.0.1，局域网由插件代理端口转发")
                : react.createElement("div", { style: { display: "flex", gap: "6px" } },
                    !remote.isAllInterfaces && Array.isArray(remote.lanIps) && remote.lanIps.length > 0 ? react.createElement("button", {
                      className: "dsh-remote-host-btn", type: "button", disabled: busy,
                      onClick: () => switchBindHost(remote.lanIps[0]),
                    }, "开放局域网 (" + remote.lanIps[0] + ")") : null,
                    remote.isAllInterfaces ? react.createElement("button", {
                      className: "dsh-remote-host-btn", type: "button", disabled: busy,
                      onClick: () => switchBindHost("127.0.0.1"),
                    }, "切换为 127.0.0.1 (仅本机)") : null
                  )
            ) : react.createElement("div", { className: "dsh-remote-details" },
              "绑定宿主: " + (remote.host || "127.0.0.1") + (remote.isAllInterfaces ? " (已开放局域网)" : " (仅本机回环)")
            ),
            /* 端口可自定义：host 受宿主限制，port 不受，两种 profile 都能改。 */
            !props.remoteBrowser ? react.createElement("div", { className: "dsh-remote-port-row" },
              react.createElement("span", { style: { color: "var(--dsw-alias-label-secondary)" } },
                lanEntry ? "局域网对外端口:" : "监听端口:"),
              react.createElement("input", {
                className: "dsh-remote-input", type: "number", min: 1, max: 65535,
                value: portInput, disabled: busy,
                "aria-label": lanEntry ? "局域网对外端口" : "监听端口",
                onChange: (event) => setPortInput(event.target.value),
                style: { width: "110px" },
              }),
              react.createElement("button", {
                className: "dsh-remote-host-btn", type: "button", disabled: busy,
                onClick: applyPort,
              }, "应用端口"),
              react.createElement("span", { className: "dsh-remote-port-hint", style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px" } },
                lanEntry ? "宿主端口不动，此端口由插件代理对外" : "重启客户端后生效")
            ) : null,
            /* 局域网访问地址：走插件代理端口，或宿主直接绑定的端口 */
            Array.isArray(remote.lanIps) && remote.lanIps.length > 0 ? react.createElement("ul", { className: "dsh-remote-network-list" },
              remote.lanIps.map((ip) => {
                const lanPort = lanEntry ? (remote.lanGatewayPort || remote.port) : remote.port;
                const url = "http://" + ip + ":" + lanPort;
                const isCopied = copiedIp === ip;
                return react.createElement("li", { key: ip, className: "dsh-remote-network-item" },
                  react.createElement("span", { className: "dsh-remote-network-url" }, url),
                  react.createElement("div", { className: "dsh-remote-item-right" },
                    react.createElement("button", {
                      type: "button",
                      className: "dsh-remote-copy-btn" + (isCopied ? " copied" : ""),
                      title: "复制访问地址",
                      onClick: () => copyText(url, ip),
                    },
                      isCopied ? react.createElement(CheckIcon, { size: 12 }) : react.createElement(CopyIcon, { size: 12 }),
                      react.createElement("span", null, isCopied ? "已复制" : "复制")
                    ),
                    react.createElement("span", { className: "dsh-remote-tag" }, "局域网")
                  )
                );
              })
            ) : null,
            /* 端口冲突提示：网关会为每块网卡各起一个监听，某个地址没起来时
               必须让用户看到原因，而不是以为「地址列出来就一定通」。 */
            Array.isArray(remote.lanGatewayFailures) && remote.lanGatewayFailures.length > 0
              ? react.createElement("div", {
                  className: "dsh-remote-port-conflict",
                  role: "alert",
                  style: {
                    marginTop: "8px",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    fontSize: "12px",
                    lineHeight: "1.5",
                    color: "var(--dsw-alias-label-primary)",
                    background: "var(--dsw-alias-bg-warning, rgba(255,170,0,0.12))",
                  },
                },
                  react.createElement("div", { style: { fontWeight: 600, marginBottom: "2px" } },
                    "部分地址未能监听"),
                  react.createElement("ul", { style: { margin: 0, paddingLeft: "16px" } },
                    remote.lanGatewayFailures.map((failure, index) =>
                      react.createElement("li", { key: failure.bindHost || index }, failure.message)
                    )
                  ),
                  react.createElement("div", { style: { marginTop: "4px", opacity: 0.8 } },
                    "换一个「局域网对外端口」即可避开冲突。")
                )
              : null
          ) : null,

          /* 底部操作区 */
          react.createElement("div", { className: "dsh-remote-actions" },
            props.remoteBrowser ? react.createElement("button", {
              className: "dsh-remote-button", type: "button", disabled: busy,
              onClick: () => { setSecret(""); lock(); },
            }, "锁定远程会话 / 清除本地凭证") : null,
            !props.remoteBrowser ? react.createElement("button", {
              className: "dsh-remote-button", type: "button", disabled: busy, onClick: save,
            }, "保存远程控制") : null,
            react.createElement("button", {
              className: "dsh-remote-button dsh-remote-button-primary", type: "button",
              disabled: busy || secret.trim().length === 0,
              onClick: () => withBusy(verify, "远程控制认证失败: "),
            }, remote.authenticated ? "已验证" : "验证密钥")
          )
        );
      }

      /**
       * 通过本插件的 RPC 通道跑一个目录原语。
       *
       * `rpc.call` 会把宿主 `handleRemoteControlRpc` 的返回值原样交回：成功是
       * `{ok:true,value}`，失败是 `{ok:false,error:{code,message}}`。失败折叠成
       * 一个带 code 的 Error，供 `directoryFailureText` 按码措辞。
       * @param method - `directory.list` 或 `directory.create`。
       * @param payload - 原语参数。
       */
      const directoryCall = async (method, payload) => {
        // 用内存里的 currentSecret 而不是 storedSecret()：后者依赖 localStorage
        // 写入成功，而在无痕/受限 WebView 里 saveSecret 会静默失败 —— 那时设置页
        // 一切正常，只有「添加工作区」恒定报认证失败，极难排查。
        const result = await ctx.connection.rpc.call(REMOTE_CONTROL_RPC_CHANNEL, "call", {
          token: currentSecret,
          method,
          payload,
        })
        if (result?.ok === true) return result.value;
        const error = new Error(result?.error?.message || "目录操作失败");
        error.code = result?.error?.code;
        throw error;
      };

      /**
       * 目录流程的注入面：官方 browse 后端从 `ctx.uiWorkspace` 取同样的两个原语，
       * 远程浏览器在拿不到宿主 browse 后端时改走本插件的 RPC。
       */
      const directoryInjected = () => ({
        listDrives: () => directoryCall("directory.drives", {}),
        listDirectory: (path) => directoryCall("directory.list", path === undefined ? {} : { path }),
        createDirectory: (path, name) => directoryCall("directory.create", { path, name }),
      });

      // 图标走宿主的 settings.section.icon 槽位，label 只放文本：外壳（0.2.x）
      // 把默认图标包进 span.navIcon，旧写法「label 内嵌图标 + CSS 隐藏外壳的
      // 直接子 svg」不再匹配，默认图标与自绘图标同时出现（双图标）。
      const label = () => "远程控制";
      ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({
        name: SETTINGS_SLOT,
        id: "remote-control",
        order: 26,
        label,
        inject: () => ({ remoteBrowser, remoteResult, remoteRequest, configRequest }),
      }, RemoteControlSettings));
      ctx.slots.inject(ICON_SLOT, () => ctx.slots.register({
        name: ICON_SLOT,
        id: "remote-control",
        order: 26,
      }, ({ size }) => react.createElement(IconGlobeOutline14, { size: size ?? 16 })));

      /*
       * 远程浏览器接管「添加工作区」的目录选择。
       *
       * 宿主的 directory-picker 后端由 `dsh-host-directory-picker-auto` 在 boot 时
       * 一次性选定（桌面端绑回环 + win32 → native，web profile 绑非回环 → browse），
       * 这个决定对所有客户端共用，且不考虑「本插件已开远程访问」。落到 native 时，
       * 远程浏览器点「添加工作区」，真正弹出来的是**宿主机屏幕**上的系统对话框，
       * 远程页面看起来毫无反应 —— 这就是要修的问题。
       *
       * 这里只在远程浏览器上注册；本机 Web 与 Electron 桌面端不进这个分支，
       * 宿主原生行为原样保留。
       *
       * 注意：**不能**用「ctx.uiWorkspace.listDirectory 是否存在」来判断宿主有没有
       * browse 后端。它是 UiWorkspaceService 的无条件实例方法，内部转发到
       * `directoryPicker.list()`，native 后端下只是调用时抛
       * `directory-picker/unavailable`，方法本身永远存在 —— 拿它做判据会恒为真，
       * 导致这里永不注册，bug 依旧。
       */
      if (remoteBrowser) {
        // `single` 孔洞取排序后的第一个（宿主 SlotCore.entriesOfSlot）。宿主会给
        // 动态注册的条目前排（其 root 槽位注释原话：dynamically registered entry
        // is assigned a lower priority than the shipped one），但那是内部行为；
        // 这里显式声明一个足够小的值，无论宿主是否这么做都能稳定排在 native
        // 占用者之前 —— 不依赖未文档化的默认值。
        ctx.slots.inject(DIRECTORY_FLOW_SLOTS[0], () =>
          ctx.slots.inject(DIRECTORY_FLOW_SLOTS[1], () =>
            ctx.slots.inject(DIRECTORY_FLOW_SLOTS[2], function* () {
              for (const slot of DIRECTORY_FLOW_SLOTS) {
                yield ctx.slots.register({
                  name: slot,
                  priority: REMOTE_DIRECTORY_PRIORITY,
                  inject: directoryInjected,
                }, RemoteDirectoryFlow);
              }
            })));
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
