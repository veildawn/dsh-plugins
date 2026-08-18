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
  id: "dsh-ai-proxy",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const { IconApiOutline14 } = require("@deepseek-ai/dsh-client-ui-primitives");

    const AUTH_RPC_CHANNEL = "/ai-proxy-auth";
    const SETTINGS_SLOT = "settings.section";
    const inject = ["slots", "connection", "remote"];
    const uiCss = `
      .ai-proxy-settings{display:flex;flex-direction:column;gap:12px;width:100%;max-width:720px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);color-scheme:light dark}
      .ai-proxy-settings h2{margin:0;font:var(--dsw-font-l-20)}.ai-proxy-intro{margin:0;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-s-14)}
      .ai-proxy-field{display:flex;flex-direction:column;gap:6px}.ai-proxy-label{color:var(--dsw-alias-label-secondary);font:var(--dsw-font-s-14);font-weight:500}
      .ai-proxy-input{box-sizing:border-box;width:100%;height:36px;padding:0 12px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-m,8px);outline:none;background:var(--dsw-alias-background-base,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
      .ai-proxy-input:focus-visible{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 18%,transparent)}.ai-proxy-input:disabled{opacity:.6}
      .ai-proxy-status{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-m,8px);background:var(--dsw-alias-background-base,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-label-secondary);font:var(--dsw-font-s-14)}
      .ai-proxy-dot{width:8px;height:8px;flex:none;border-radius:50%;background:var(--dsw-alias-label-quaternary,var(--dsw-alias-label-caption))}.ai-proxy-dot[data-active=true]{background:var(--dsw-alias-state-success-primary)}
      .ai-proxy-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}.ai-proxy-button{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;height:36px;padding:0 14px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-pill,18px);background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);text-decoration:none;cursor:pointer}.ai-proxy-button:disabled{cursor:default;opacity:.4}.ai-proxy-button-primary{border-color:transparent;background:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff)}
      .ai-proxy-error{min-height:18px;margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}.ai-proxy-details{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.ai-proxy-nav-label{display:inline-flex;align-items:center;gap:8px}
    `;

    function normalizeGateway(value) {
      return value.trim().replace(/\/+$/, "");
    }

    function gatewayError(value) {
      const normalized = normalizeGateway(value);
      if (!normalized) return "请输入网关地址";
      try {
        const url = new URL(normalized);
        if (url.protocol !== "http:" && url.protocol !== "https:") return "网关地址必须使用 http 或 https";
      } catch { return "网关地址格式无效"; }
      return "";
    }

    function apply(ctx) {
      const authRequest = async (method, payload = {}) => {
        const result = await ctx.connection.rpc.call(AUTH_RPC_CHANNEL, method, payload);
        if (!result || result.ok !== true) throw new Error(result?.error?.message || "OAuth request failed");
        return result.value;
      };

      function AiProxySettings(props) {
        const [gateway, setGateway] = react.useState("");
        const [saved, setSaved] = react.useState("");
        const [loaded, setLoaded] = react.useState(false);
        const [busy, setBusy] = react.useState(false);
        const [auth, setAuth] = react.useState({ state: "checking", message: "正在检查登录状态…" });
        const normalizedGateway = normalizeGateway(gateway);
        const invalidGateway = gatewayError(gateway);
        const gatewayChanged = loaded && normalizedGateway !== saved;
        const pending = busy || auth.state === "authorizing" || auth.state === "checking";

        react.useEffect(() => {
          let active = true;
          props.authRequest("config").then((value) => {
            if (!active || typeof value?.baseURL !== "string") return;
            setGateway(value.baseURL);
            setSaved(normalizeGateway(value.baseURL));
            setLoaded(true);
          }, () => { if (active) setLoaded(true); });
          const refresh = () => props.authRequest("status").then(
            (next) => { if (active) setAuth(next); },
            (error) => { if (active) setAuth({ state: "error", message: "无法读取登录状态: " + error.message }); },
          );
          refresh();
          const dispose = ctx.remote.$on("credentials/updated", refresh);
          return () => { active = false; dispose(); };
        }, []);
        react.useEffect(() => {
          if (auth.state !== "authorizing") return;
          const timer = setInterval(() => props.authRequest("status").then(
            setAuth,
            (error) => setAuth({ state: "error", message: "无法读取登录状态: " + error.message }),
          ), 1000);
          timer.unref?.();
          return () => clearInterval(timer);
        }, [auth.state]);

        const commitGateway = async () => {
          if (invalidGateway) throw new Error(invalidGateway);
          if (!gatewayChanged) return;
          const value = await props.authRequest("setBaseURL", { baseURL: normalizedGateway });
          if (typeof value?.baseURL === "string") {
            setGateway(value.baseURL);
            setSaved(normalizeGateway(value.baseURL));
          }
        };
        const withBusy = async (action, prefix) => {
          setBusy(true);
          try { await action(); }
          catch (error) { setAuth({ state: "error", message: prefix + (error instanceof Error ? error.message : String(error)) }); }
          finally { setBusy(false); }
        };
        const runAuth = async (method, before) => {
          let popup;
          if (method === "login") {
            setAuth({ state: "authorizing", message: "正在准备授权链接…" });
            try { popup = globalThis.open?.("about:blank", "_blank"); } catch {}
          }
          setBusy(true);
          try {
            if (before) await before();
            const next = await props.authRequest(method);
            setAuth(next);
            if (method === "login" && typeof next?.authorizeUrl === "string") {
              try {
                if (popup) popup.location.href = next.authorizeUrl;
                else globalThis.open?.(next.authorizeUrl, "_blank");
              } catch {}
            }
          } catch (error) {
            popup?.close?.();
            setAuth({ state: "error", message: (method === "login" ? "登录失败: " : "退出登录失败: ") + (error instanceof Error ? error.message : String(error)) });
          } finally { setBusy(false); }
        };

        return react.createElement("div", { className: "ai-proxy-settings" },
          react.createElement("style", null, uiCss),
          react.createElement("h2", null, "AI Proxy"),
          react.createElement("p", { className: "ai-proxy-intro" }, "连接 AI Proxy 网关并通过 OAuth 2.0 PKCE 安全登录。"),
          react.createElement("label", { className: "ai-proxy-field" },
            react.createElement("span", { className: "ai-proxy-label" }, "网关地址"),
            react.createElement("input", {
              className: "ai-proxy-input", type: "url", value: gateway,
              placeholder: "http://localhost:18080", disabled: pending || !loaded,
              "aria-label": "网关地址", "aria-invalid": invalidGateway ? "true" : "false",
              onChange: (event) => setGateway(event.target.value),
            }),
            invalidGateway && gateway.length > 0 ? react.createElement("p", { className: "ai-proxy-error" }, invalidGateway) : null
          ),
          react.createElement("div", { className: "ai-proxy-status", role: "status", "aria-live": "polite" },
            react.createElement("span", { className: "ai-proxy-dot", "data-active": auth.state === "signed-in" }),
            react.createElement("span", null, auth.message)
          ),
          auth.state === "authorizing" && typeof auth.authorizeUrl === "string" ? react.createElement("a", {
            className: "ai-proxy-button ai-proxy-button-primary", href: auth.authorizeUrl,
            target: "_blank", rel: "noopener noreferrer",
          }, "点击前往授权") : null,
          react.createElement("div", { className: "ai-proxy-actions" },
            auth.state === "signed-in" && gatewayChanged && !invalidGateway ? react.createElement("button", {
              className: "ai-proxy-button", type: "button", disabled: pending,
              onClick: () => withBusy(commitGateway, "保存网关地址失败: "),
            }, "保存") : null,
            auth.state === "signed-in" ? react.createElement("button", {
              className: "ai-proxy-button", type: "button", disabled: pending,
              onClick: () => runAuth("logout"),
            }, "退出登录") : react.createElement("button", {
              className: "ai-proxy-button ai-proxy-button-primary", type: "button",
              disabled: pending || Boolean(invalidGateway), onClick: () => runAuth("login", commitGateway),
            }, auth.state === "authorizing" ? "登录中…" : "登录")
          ),
          react.createElement("p", { className: "ai-proxy-details" }, "登录后会按账号权限同步可用模型与思考档位。"),
          react.createElement("p", { className: "ai-proxy-details" }, "模型调用与用量由 AI Proxy 网关统一统计。")
        );
      }

      const label = () => react.createElement("span", {
        "data-settings-nav-label": "ai-proxy", className: "ai-proxy-nav-label",
      },
      react.createElement("style", null, "button:has([data-settings-nav-label]) > svg:first-child{display:none}"),
      react.createElement(IconApiOutline14, { size: 16 }),
      react.createElement("span", null, "AI Proxy"));
      ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({
        name: SETTINGS_SLOT,
        id: "ai-proxy",
        order: 25,
        label,
        inject: () => ({ authRequest }),
      }, AiProxySettings));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
