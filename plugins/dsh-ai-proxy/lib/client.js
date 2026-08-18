window.__ModuleLoader__.load({
  id: "dsh-ai-proxy",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    let { BrandWordmark, IconApiOutline14, IconGlobeOutline14 } = require("@deepseek-ai/dsh-client-ui-primitives");

    const AUTH_RPC_CHANNEL = "/ai-proxy-auth";
    const REMOTE_CONTROL_RPC_CHANNEL = "/ai-proxy-remote-control";
    const SETTINGS_SLOT = "settings.section";
    const REMOTE_SECRET_STORAGE_KEY = "dsh-ai-proxy.remote-control-secret";
    const REMOTE_GATE_PRIORITY = -100;

    const inject = [
      "slots",
      "connection",
      "remote",
    ];

    const uiCss = `
      .ai-proxy-gate,.ai-proxy-settings{color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);color-scheme:light dark}
      .ai-proxy-gate{position:fixed;inset:0;z-index:2147483647;display:grid;min-height:100dvh;place-items:center;overflow:auto;padding:24px;box-sizing:border-box;background:var(--dsw-alias-background-base,var(--dsw-alias-bg-base))}
      .ai-proxy-gate-mask{position:absolute;inset:0;background:var(--dsw-alias-background-overlay,var(--dsw-alias-bg-mask-1));backdrop-filter:var(--dsw-mask-blur);-webkit-backdrop-filter:var(--dsw-mask-blur)}
      .ai-proxy-gate-card{position:relative;width:min(100%,430px);box-sizing:border-box;padding:24px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-xl,24px);background:var(--dsw-alias-background-surface,var(--dsw-alias-bg-layer-2));box-shadow:var(--dsw-shadow-lv3);animation:ai-proxy-gate-in var(--ds-transition-duration) var(--ds-ease-in-out)}
      .ai-proxy-gate-brand{display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin-bottom:24px;color:var(--dsw-alias-brand-primary,#4d6bfe)}
      .ai-proxy-gate-brand span{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-s-14);font-size:12px}
      .ai-proxy-gate h1{margin:0 0 8px;font:var(--dsw-font-l-20)}.ai-proxy-gate-copy{margin:0 0 20px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-s-14)}
      .ai-proxy-gate-status,.ai-proxy-status{display:flex;align-items:center;gap:10px;border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-m,8px);background:var(--dsw-alias-background-base,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-label-secondary);font:var(--dsw-font-s-14)}
      .ai-proxy-gate-status{margin-bottom:20px;padding:10px 12px}.ai-proxy-status{padding:10px 12px}
      .ai-proxy-dot{width:8px;height:8px;flex:none;border-radius:50%;background:var(--dsw-alias-label-quaternary,var(--dsw-alias-label-caption))}.ai-proxy-dot[data-active=true]{background:var(--dsw-alias-state-success-primary)}.ai-proxy-gate-dot{background:var(--dsw-alias-state-warn-primary)}.ai-proxy-gate-dot[data-enabled=true]{background:var(--dsw-alias-state-success-primary)}
      .ai-proxy-field{display:flex;flex-direction:column;gap:6px}.ai-proxy-gate-field{margin-bottom:12px}.ai-proxy-label{color:var(--dsw-alias-label-secondary);font:var(--dsw-font-s-14);font-weight:500}
      .ai-proxy-input{box-sizing:border-box;width:100%;height:36px;padding:0 12px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-m,8px);outline:none;background:var(--dsw-alias-background-base,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);transition:border-color var(--ds-transition-duration) var(--ds-ease-in-out),box-shadow var(--ds-transition-duration) var(--ds-ease-in-out)}
      .ai-proxy-input::placeholder{color:var(--dsw-alias-label-quaternary,var(--dsw-alias-label-caption))}.ai-proxy-input:focus-visible{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 18%,transparent)}.ai-proxy-input:disabled{cursor:default;opacity:.6}
      .ai-proxy-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;padding-top:2px}.ai-proxy-button{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;height:36px;padding:0 14px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-pill,18px);background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);text-decoration:none;cursor:pointer;transition:background-color var(--ds-transition-duration) var(--ds-ease-in-out)}
      .ai-proxy-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.ai-proxy-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:2px}.ai-proxy-button:disabled{cursor:default;opacity:.4}.ai-proxy-button-primary{border-color:transparent;background:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff)}.ai-proxy-button-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary,#4d6bfe))}
      .ai-proxy-gate-button{width:100%}.ai-proxy-error{min-height:18px;margin:8px 0 0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}.ai-proxy-gate-meta{margin:20px 0 0;color:var(--dsw-alias-label-quaternary,var(--dsw-alias-label-caption));font-size:12px;line-height:18px;text-align:center}
      .ai-proxy-settings{display:flex;flex-direction:column;gap:12px;width:100%;max-width:720px}.ai-proxy-settings h2{margin:0;font:var(--dsw-font-l-20)}.ai-proxy-intro{margin:0;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-s-14)}
      .ai-proxy-details{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.ai-proxy-toggle{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);cursor:pointer}.ai-proxy-toggle-input{clip:rect(0 0 0 0);width:1px;height:1px;position:absolute;overflow:hidden}.ai-proxy-toggle-track{width:20px;height:10px;margin-left:auto;border-radius:var(--dsw-radius-pill,5px);background:var(--dsw-alias-border-default,var(--dsw-alias-border-l2));flex:none;position:relative;transition:background-color var(--ds-transition-duration) var(--ds-ease-in-out)}.ai-proxy-toggle-thumb{position:absolute;top:2px;left:2px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-background-base,var(--dsw-alias-bg-layer-1));transition:transform var(--ds-transition-duration) var(--ds-ease-in-out)}.ai-proxy-toggle-input:checked~.ai-proxy-toggle-track{background:var(--dsw-alias-brand-primary,#4d6bfe)}.ai-proxy-toggle-input:checked~.ai-proxy-toggle-track .ai-proxy-toggle-thumb{transform:translateX(10px)}.ai-proxy-toggle-input:focus-visible~.ai-proxy-toggle-track{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:2px}.ai-proxy-toggle:has(.ai-proxy-toggle-input:disabled){cursor:default;opacity:.4}
      .ai-proxy-nav-label{display:inline-flex;align-items:center;gap:8px}
      @keyframes ai-proxy-gate-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.ai-proxy-gate-card{animation:none}.ai-proxy-button,.ai-proxy-input,.ai-proxy-toggle-track,.ai-proxy-toggle-thumb{transition:none}}@media(max-width:520px){.ai-proxy-gate{padding:16px}.ai-proxy-gate-card{padding:20px;border-radius:var(--dsw-radius-l,12px)}}
    `;

    function isRemoteBrowser() {
      const hostname = globalThis.location?.hostname;
      return typeof hostname === "string" && hostname.length > 0
        && hostname !== "localhost" && hostname !== "127.0.0.1";
    }

    function storedRemoteSecret() {
      try { return globalThis.localStorage?.getItem(REMOTE_SECRET_STORAGE_KEY) || ""; } catch { return ""; }
    }

    function saveRemoteSecret(value) {
      try {
        if (value) globalThis.localStorage?.setItem(REMOTE_SECRET_STORAGE_KEY, value);
        else globalThis.localStorage?.removeItem(REMOTE_SECRET_STORAGE_KEY);
      } catch {}
    }

    function normalizeGateway(value) {
      return value.trim().replace(/\/+$/, "");
    }

    function gatewayError(value) {
      const normalized = normalizeGateway(value);
      if (normalized.length === 0) return "请输入网关地址";
      try {
        const url = new URL(normalized);
        if (url.protocol !== "http:" && url.protocol !== "https:") return "网关地址必须使用 http 或 https";
      } catch {
        return "网关地址格式无效";
      }
      return "";
    }

    function apply(ctx) {
      const remoteBrowser = isRemoteBrowser();
      let currentRemoteSecret = storedRemoteSecret();
      // Local AI Proxy actions use the loopback channel; remote actions use
      // the already-authenticated remote-control channel with the same Host
      // dispatcher and validation.
      const authRequest = async (method, payload = {}) => {
        const result = remoteBrowser
          ? await remoteResult("call", { method: "aiProxy." + (method === "config" ? "gateway" : method), payload })
          : await ctx.connection.rpc.call(AUTH_RPC_CHANNEL, method, payload);
        if (!result || result.ok !== true) {
          throw new Error(result && result.error && typeof result.error.message === "string"
            ? result.error.message
            : "OAuth request failed");
        }
        return result.value;
      };

      // The upstream /api fence stays in place. Remote privileged calls go
      // straight through this authenticated channel; local calls keep their
      // direct path and use it only as a 403 fallback.
      const remoteResult = (method, payload = {}, signal, token = currentRemoteSecret) => ctx.connection.rpc.call(
        REMOTE_CONTROL_RPC_CHANNEL,
        method,
        Object.assign({}, payload, { token }),
        signal,
      );
      const remoteRequest = async (method, payload = {}, signal) => {
        const result = await remoteResult(method, payload, signal);
        if (!result || result.ok !== true) {
          throw new Error(result && result.error && typeof result.error.message === "string"
            ? result.error.message
            : "Remote Control request failed");
        }
        return result.value;
      };
      let disposeGate;
      let initialGateError = "";
      const unlockRemoteSession = () => {
        const dispose = disposeGate;
        disposeGate = undefined;
        dispose?.();
      };

      function RemoteGate() {
        const [secret, setSecret] = react.useState(storedRemoteSecret);
        const [gate, setGate] = react.useState({ checking: true, enabled: false, secretConfigured: false });
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
              currentRemoteSecret = token.trim();
              saveRemoteSecret(currentRemoteSecret);
              unlockRemoteSession();
              return;
            }
            setGate({ checking: false, enabled: next.enabled === true, secretConfigured: next.secretConfigured === true });
            if (!automatic || token) setError(token ? "访问密钥无效，请重试" : "请输入远程访问密钥");
          } catch (cause) {
            setGate((current) => Object.assign({}, current, { checking: false }));
            setError(cause instanceof Error ? cause.message : String(cause));
          } finally {
            setBusy(false);
          }
        };

        react.useEffect(() => {
          void check(secret, true);
        }, []);
        react.useEffect(() => {
          if (typeof document === "undefined") return;
          const previous = document.title;
          document.title = "DeepSeek Harness — 远程工作区已锁定";
          return () => { document.title = previous; };
        }, []);

        const status = gate.checking
          ? "正在检查宿主机远程访问状态…"
          : !gate.enabled
            ? "远程控制未在宿主机启用"
            : !gate.secretConfigured
              ? "宿主机尚未配置远程访问密钥"
              : "请输入远程访问密钥解锁";
        const unavailable = gate.checking || !gate.enabled || !gate.secretConfigured;

        return react.createElement("main", { className: "ai-proxy-gate", "aria-labelledby": "ai-proxy-gate-title" },
          react.createElement("style", null, uiCss),
          react.createElement("div", { className: "ai-proxy-gate-mask", "aria-hidden": "true" }),
          react.createElement("section", { className: "ai-proxy-gate-card", role: "dialog", "aria-modal": "true", "aria-labelledby": "ai-proxy-gate-title" },
            react.createElement("div", { className: "ai-proxy-gate-brand" },
              react.createElement(BrandWordmark, { size: 24 }),
              react.createElement("span", null, "AI Proxy · Remote Gate")
            ),
            react.createElement("h1", { id: "ai-proxy-gate-title" }, "远程工作区已锁定"),
            react.createElement("p", { className: "ai-proxy-gate-copy" }, "此工作区仅向已认证的远程会话开放。验证前不会加载工作区内容。"),
            react.createElement("div", { className: "ai-proxy-gate-status", role: "status", "aria-live": "polite" },
              react.createElement("span", { className: "ai-proxy-dot ai-proxy-gate-dot", "data-enabled": gate.enabled }),
              react.createElement("span", null, status)
            ),
            react.createElement("form", {
              onSubmit: (event) => {
                event.preventDefault();
                const token = secret.trim();
                if (token) void check(token);
              },
            },
            react.createElement("label", { className: "ai-proxy-field ai-proxy-gate-field" },
              react.createElement("span", { className: "ai-proxy-label" }, "远程访问密钥"),
              react.createElement("input", {
                className: "ai-proxy-input",
                type: "password",
                value: secret,
                autoComplete: "current-password",
                autoFocus: true,
                disabled: unavailable || busy,
                placeholder: "输入 Secret / Token",
                "aria-label": "远程访问密钥",
                "aria-invalid": error ? "true" : "false",
                onChange: (event) => setSecret(event.target.value),
              })
            ),
            react.createElement("button", {
              className: "ai-proxy-button ai-proxy-button-primary ai-proxy-gate-button",
              type: "submit",
              disabled: unavailable || busy || secret.trim().length === 0,
            }, busy ? "验证中…" : "解锁"),
            react.createElement("p", { className: "ai-proxy-error", role: "alert" }, error)
            ),
            react.createElement("p", { className: "ai-proxy-gate-meta" }, "凭证仅保存在此浏览器 · " + (globalThis.location?.host || "Remote Host"))
          )
        );
      }

      const mountRemoteGate = (error = "") => {
        if (!remoteBrowser || disposeGate) return;
        initialGateError = error;
        disposeGate = ctx.slots.register({ name: "root", priority: REMOTE_GATE_PRIORITY }, RemoteGate);
      };
      const lockRemoteSession = () => {
        currentRemoteSecret = "";
        saveRemoteSecret("");
        mountRemoteGate();
      };
      const startRemoteSession = async () => {
        if (!remoteBrowser) return;
        const token = currentRemoteSecret.trim();
        currentRemoteSecret = token;
        if (!token) {
          saveRemoteSecret("");
          mountRemoteGate();
          return;
        }
        let authenticated = false;
        try {
          const result = await remoteResult("status", {}, undefined, token);
          authenticated = result?.ok === true && result.value?.authenticated === true;
        } catch {}
        if (currentRemoteSecret !== token) return;
        if (authenticated) {
          saveRemoteSecret(token);
          return;
        }
        currentRemoteSecret = "";
        saveRemoteSecret("");
        mountRemoteGate("保存的访问密钥已失效，请重新输入");
      };
      void startRemoteSession();

      const privilegedMethods = {
        agentPresets: ["read", "copy", "openDocument", "remove"],
        host: ["pickDirectory", "openPath"],
        settings: ["describe", "openDocument", "update", "replace", "mutate"],
        credentials: ["describe", "set", "unset"],
        llm: ["discoverModels"],
      };
      for (const [domain, methods] of Object.entries(privilegedMethods)) {
        for (const method of methods) {
          const api = ctx.connection.api?.[domain];
          const direct = api?.[method];
          if (typeof direct !== "function" || direct.__remoteControlFallback) continue;
          const wrapped = async (payload, signal) => {
            if (remoteBrowser) {
              const result = await remoteResult("call", { method: domain === "agentPresets" ? "agentPreset." + method : domain + "." + method, payload }, signal);
              return { rpcId: "remote-control", result };
            }
            try {
              return await direct(payload, signal);
            } catch (error) {
              if (!/HTTP 403\b/.test(error instanceof Error ? error.message : String(error))) throw error;
              const result = await remoteResult("call", { method: domain === "agentPresets" ? "agentPreset." + method : domain + "." + method, payload }, signal);
              return { rpcId: "remote-control", result };
            }
          };
          wrapped.__remoteControlFallback = true;
          api[method] = wrapped;
        }
      }

      const aiProxyInject = () => ({ authRequest, remoteBrowser });
      const remoteControlInject = () => ({ authRequest, remoteRequest, remoteResult, remoteBrowser, lockRemoteSession });

      // ponytail: DSH hardcodes third-party section icons to a gear; remove
      // this label shim once settings.section accepts an icon option.
      const settingsLabel = (id, Icon, label) => () => react.createElement("span", {
        "data-settings-nav-label": id,
        className: "ai-proxy-nav-label",
      },
      react.createElement("style", null, "button:has([data-settings-nav-label]) > svg:first-child{display:none}.ai-proxy-nav-label{display:inline-flex;align-items:center;gap:8px}"),
      react.createElement(Icon, { size: 16 }),
      react.createElement("span", null, label));

      /**
       * Independent AI Proxy settings: gateway address, login status and
       * OAuth actions. An edited address is saved explicitly while signed in
       * and saved ahead of the browser flow when signing in.
       */
      function AiProxySettings(props) {
        const [gateway, setGateway] = react.useState("");
        const [saved, setSaved] = react.useState("");
        const [loaded, setLoaded] = react.useState(false);
        const [busy, setBusy] = react.useState(false);
        const [auth, setAuth] = react.useState({ state: "checking", message: "正在检查登录状态…" });
        const [authorizationCode, setAuthorizationCode] = react.useState("");
        const normalizedGateway = normalizeGateway(gateway);
        const invalidGateway = gatewayError(gateway);
        const gatewayChanged = loaded && normalizedGateway !== saved;
        const pending = busy || auth.state === "authorizing" || auth.state === "checking";

        react.useEffect(() => {
          let active = true;
          props.authRequest("config").then(
            (value) => {
              if (!active || typeof value?.baseURL !== "string") return;
              setGateway(value.baseURL);
              setSaved(normalizeGateway(value.baseURL));
              setLoaded(true);
            },
            () => { if (active) setLoaded(true); },
          );
          const refresh = () => {
            props.authRequest("status").then(
              (next) => { if (active) setAuth(next); },
              (error) => { if (active) setAuth({ state: "error", message: "无法读取登录状态: " + error.message }); },
            );
          };
          refresh();
          const dispose = ctx.remote.$on("credentials/updated", refresh);
          return () => {
            active = false;
            dispose();
          };
        }, []);
        react.useEffect(() => {
          if (auth.state !== "authorizing") return;
          const timer = setInterval(() => {
            props.authRequest("status").then(
              (next) => setAuth(next),
              (error) => setAuth({ state: "error", message: "无法读取登录状态: " + error.message }),
            );
          }, 1000);
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

        const withBusy = async (action, errorPrefix) => {
          setBusy(true);
          try {
            await action();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setAuth({ state: "error", message: errorPrefix + message });
          } finally {
            setBusy(false);
          }
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
            const message = error instanceof Error ? error.message : String(error);
            setAuth({ state: "error", message: (method === "login" ? "登录失败: " : "退出登录失败: ") + message });
          } finally {
            setBusy(false);
          }
        };

        const completeRemoteLogin = () => withBusy(async () => {
          const parts = authorizationCode.trim().split("#");
          if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("请粘贴授权页显示的完整 code#state");
          const next = await props.authRequest("completeLogin", { code: parts[0], state: parts[1] });
          setAuthorizationCode("");
          setAuth(next);
        }, "完成登录失败: ");

        return react.createElement("div", { className: "ai-proxy-settings" },
          react.createElement("style", null, uiCss),
          react.createElement("h2", null, "AI Proxy"),
          react.createElement("p", { className: "ai-proxy-intro" }, "连接 AI Proxy 网关并通过浏览器安全登录。"),
          react.createElement("label", { className: "ai-proxy-field" },
            react.createElement("span", { className: "ai-proxy-label" }, "网关地址"),
            react.createElement("input", {
              className: "ai-proxy-input",
              type: "url",
              value: gateway,
              placeholder: "http://localhost:18080",
              disabled: pending || !loaded,
              "aria-label": "网关地址",
              "aria-invalid": invalidGateway ? "true" : "false",
              onChange: (event) => setGateway(event.target.value),
            }),
            invalidGateway && gateway.length > 0 ? react.createElement("p", { className: "ai-proxy-error" }, invalidGateway) : null
          ),
          react.createElement("div", { className: "ai-proxy-status", role: "status", "aria-live": "polite" },
            react.createElement("span", { className: "ai-proxy-dot", "data-active": auth.state === "signed-in" }),
            react.createElement("span", null, auth.message)
          ),
          auth.state === "authorizing" && typeof auth.authorizeUrl === "string" ? react.createElement("a", {
            className: "ai-proxy-button ai-proxy-button-primary",
            href: auth.authorizeUrl,
            target: "_blank",
            rel: "noopener noreferrer",
          }, "点击前往授权") : null,
          auth.state === "authorizing" && props.remoteBrowser ? react.createElement("div", { className: "ai-proxy-field" },
            react.createElement("span", { className: "ai-proxy-label" }, "授权页返回的 code#state"),
            react.createElement("input", {
              className: "ai-proxy-input",
              type: "text",
              value: authorizationCode,
              autoComplete: "off",
              placeholder: "粘贴授权页显示的完整内容",
              "aria-label": "OAuth 授权码",
              onChange: (event) => setAuthorizationCode(event.target.value),
            }),
            react.createElement("button", {
              className: "ai-proxy-button",
              type: "button",
              disabled: busy || authorizationCode.trim().length === 0,
              onClick: completeRemoteLogin,
            }, "完成登录")
          ) : null,
          react.createElement("div", { className: "ai-proxy-actions" },
            auth.state === "signed-in" && gatewayChanged && !invalidGateway ? react.createElement("button", {
              className: "ai-proxy-button",
              type: "button",
              disabled: pending,
              onClick: () => withBusy(commitGateway, "保存网关地址失败: "),
            }, "保存") : null,
            auth.state === "signed-in" ? react.createElement("button", {
              className: "ai-proxy-button",
              type: "button",
              disabled: pending,
              onClick: () => runAuth("logout"),
            }, "退出登录") : react.createElement("button", {
              className: "ai-proxy-button ai-proxy-button-primary",
              type: "button",
              disabled: pending || Boolean(invalidGateway),
              onClick: () => runAuth("login", commitGateway),
            }, auth.state === "authorizing" ? "登录中…" : "登录")
          ),
          react.createElement("p", { className: "ai-proxy-details" }, "登录后会按账号权限同步可用模型与思考档位。"),
          react.createElement("p", { className: "ai-proxy-details" }, "模型调用与用量由 AI Proxy 网关统一统计。")
        );
      }

      function RemoteControlSettings(props) {
        const [busy, setBusy] = react.useState(false);
        const [remote, setRemote] = react.useState({ local: false, enabled: false, secretConfigured: false, authenticated: false, message: "正在检查远程控制状态…" });
        const [remoteEnabled, setRemoteEnabled] = react.useState(false);
        const [remoteSecret, setRemoteSecret] = react.useState(currentRemoteSecret);

        react.useEffect(() => {
          let active = true;
          const request = props.remoteBrowser ? props.remoteRequest("status") : props.authRequest("remoteConfig");
          request.then(
            (next) => {
              if (!active) return;
              const authenticated = next.authenticated === true;
              setRemote(Object.assign({}, next, {
                local: !props.remoteBrowser,
                authenticated,
                message: props.remoteBrowser
                  ? authenticated ? "远程控制已认证" : "远程控制未认证"
                  : "本机配置可用",
              }));
              setRemoteEnabled(next.enabled === true);
            },
            (error) => {
              if (active) setRemote((current) => Object.assign({}, current, { message: "无法读取远程控制状态: " + error.message }));
            },
          );
          return () => { active = false; };
        }, []);

        const withBusy = async (action, errorPrefix) => {
          setBusy(true);
          try {
            await action();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setRemote((current) => Object.assign({}, current, { message: errorPrefix + message }));
          } finally {
            setBusy(false);
          }
        };

        const verifyRemote = async () => {
          const token = remoteSecret.trim();
          const result = await props.remoteResult("status", {}, undefined, token);
          if (!result || result.ok !== true) throw new Error(result?.error?.message || "Remote Control request failed");
          const value = result.value;
          if (value.authenticated !== true) throw new Error("远程控制认证失败");
          currentRemoteSecret = token;
          saveRemoteSecret(currentRemoteSecret);
          setRemote((current) => Object.assign({}, current, value, { authenticated: true, message: "远程控制已认证" }));
        };

        const saveRemote = () => withBusy(async () => {
          const token = remoteSecret.trim();
          if (token) await props.authRequest("setRemoteSecret", { secret: token });
          const value = await props.authRequest("setRemoteAccess", { enabled: remoteEnabled });
          setRemote((current) => Object.assign({}, current, value, { local: true, message: "远程控制设置已保存" }));
        }, "保存远程控制失败: ");

        return react.createElement("div", { className: "ai-proxy-settings" },
          react.createElement("style", null, uiCss),
          react.createElement("h2", null, "远程控制 (Remote Control)"),
          react.createElement("p", { className: "ai-proxy-intro" }, "通过已认证密钥解锁远程设置与特权操作。密钥只保存在当前浏览器和 Host 凭据仓中。"),
          react.createElement("label", { className: "ai-proxy-toggle" },
            react.createElement("input", {
              className: "ai-proxy-toggle-input",
              type: "checkbox",
              role: "switch",
              checked: remoteEnabled,
              disabled: busy || !remote.local,
              "aria-label": "启用远程访问",
              onChange: (event) => setRemoteEnabled(event.target.checked),
            }),
            react.createElement("span", null, "启用远程访问"),
            react.createElement("span", { className: "ai-proxy-toggle-track", "aria-hidden": "true" },
              react.createElement("span", { className: "ai-proxy-toggle-thumb" })
            )
          ),
          react.createElement("label", { className: "ai-proxy-field" },
            react.createElement("span", { className: "ai-proxy-label" }, "远程访问密钥 / Token"),
            react.createElement("input", {
              className: "ai-proxy-input",
              type: "password",
              value: remoteSecret,
              autoComplete: "current-password",
              disabled: busy,
              "aria-label": "远程访问密钥",
              onChange: (event) => setRemoteSecret(event.target.value),
            })
          ),
          react.createElement("p", { className: "ai-proxy-details" }, "访问环境: " + (props.remoteBrowser ? "远程访问" : "本机访问")),
          react.createElement("p", { className: "ai-proxy-details" }, "当前 Host: " + (typeof location === "undefined" ? "本机" : location.host)),
          react.createElement("p", { className: "ai-proxy-details" }, "状态: " + remote.message),
          react.createElement("div", { className: "ai-proxy-actions" },
            props.remoteBrowser ? react.createElement("button", {
              className: "ai-proxy-button",
              type: "button",
              disabled: busy,
              onClick: () => {
                currentRemoteSecret = "";
                saveRemoteSecret("");
                setRemoteSecret("");
                setRemote((current) => Object.assign({}, current, { authenticated: false, message: "远程会话已锁定" }));
                props.lockRemoteSession();
              },
            }, "锁定远程会话 / 清除本地凭证") : null,
            remote.local ? react.createElement("button", {
              className: "ai-proxy-button",
              type: "button",
              disabled: busy,
              onClick: saveRemote,
            }, "保存远程控制") : null,
            react.createElement("button", {
              className: "ai-proxy-button ai-proxy-button-primary",
              type: "button",
              disabled: busy || remoteSecret.trim().length === 0,
              onClick: () => withBusy(verifyRemote, "远程控制认证失败: "),
            }, remote.authenticated ? "已验证" : "验证密钥")
          )
        );
      }

      ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({
        name: SETTINGS_SLOT,
        id: "ai-proxy",
        order: 25,
        label: settingsLabel("ai-proxy", IconApiOutline14, "AI Proxy"),
        inject: aiProxyInject,
      }, AiProxySettings));
      ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({
        name: SETTINGS_SLOT,
        id: "remote-control",
        order: 26,
        label: settingsLabel("remote-control", IconGlobeOutline14, "远程控制"),
        inject: remoteControlInject,
      }, RemoteControlSettings));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
