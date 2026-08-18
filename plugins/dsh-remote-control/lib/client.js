window.__ModuleLoader__.load({
  id: "dsh-remote-control",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const { BrandWordmark, IconGlobeOutline14 } = require("@deepseek-ai/dsh-client-ui-primitives");

    const REMOTE_CONTROL_RPC_CHANNEL = "/dsh-remote-control";
    const CONFIG_RPC_CHANNEL = "/dsh-remote-control-config";
    const STORAGE_KEY = "dsh-remote-control.secret";
    const LEGACY_STORAGE_KEY = "dsh-ai-proxy.remote-control-secret";
    const SETTINGS_SLOT = "settings.section";
    const GATE_PRIORITY = -100;
    const inject = ["slots", "connection"];

    const uiCss = `
      .dsh-remote-gate,.dsh-remote-settings{color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);color-scheme:light dark}
      .dsh-remote-gate{position:fixed;inset:0;z-index:2147483647;display:grid;min-height:100dvh;place-items:center;overflow:auto;padding:24px;box-sizing:border-box;background:var(--dsw-alias-background-base,var(--dsw-alias-bg-base))}
      .dsh-remote-gate-mask{position:absolute;inset:0;background:var(--dsw-alias-background-overlay,var(--dsw-alias-bg-mask-1));backdrop-filter:var(--dsw-mask-blur);-webkit-backdrop-filter:var(--dsw-mask-blur)}
      .dsh-remote-gate-card{position:relative;width:min(100%,430px);box-sizing:border-box;padding:24px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-xl,24px);background:var(--dsw-alias-background-surface,var(--dsw-alias-bg-layer-2));box-shadow:var(--dsw-shadow-lv3);animation:dsh-remote-gate-in var(--ds-transition-duration) var(--ds-ease-in-out)}
      .dsh-remote-brand{display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin-bottom:24px;color:var(--dsw-alias-brand-primary,#4d6bfe)}.dsh-remote-brand span{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-s-14);font-size:12px}
      .dsh-remote-gate h1{margin:0 0 8px;font:var(--dsw-font-l-20)}.dsh-remote-copy{margin:0 0 20px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-s-14)}
      .dsh-remote-status{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-m,8px);background:var(--dsw-alias-background-base,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-label-secondary);font:var(--dsw-font-s-14)}.dsh-remote-gate .dsh-remote-status{margin-bottom:20px}
      .dsh-remote-dot{width:8px;height:8px;flex:none;border-radius:50%;background:var(--dsw-alias-state-warn-primary)}.dsh-remote-dot[data-active=true]{background:var(--dsw-alias-state-success-primary)}
      .dsh-remote-field{display:flex;flex-direction:column;gap:6px}.dsh-remote-gate-field{margin-bottom:12px}.dsh-remote-label{color:var(--dsw-alias-label-secondary);font:var(--dsw-font-s-14);font-weight:500}
      .dsh-remote-input{box-sizing:border-box;width:100%;height:36px;padding:0 12px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-m,8px);outline:none;background:var(--dsw-alias-background-base,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}.dsh-remote-input:focus-visible{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 18%,transparent)}.dsh-remote-input:disabled{opacity:.6}
      .dsh-remote-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}.dsh-remote-button{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;height:36px;padding:0 14px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-pill,18px);background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);cursor:pointer}.dsh-remote-button:disabled{cursor:default;opacity:.4}.dsh-remote-button-primary{border-color:transparent;background:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff)}.dsh-remote-gate-button{width:100%}
      .dsh-remote-error{min-height:18px;margin:8px 0 0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}.dsh-remote-meta,.dsh-remote-details{color:var(--dsw-alias-label-quaternary,var(--dsw-alias-label-caption));font-size:12px;line-height:18px}.dsh-remote-meta{margin:20px 0 0;text-align:center}.dsh-remote-details{margin:0}
      .dsh-remote-settings{display:flex;flex-direction:column;gap:12px;width:100%;max-width:720px}.dsh-remote-settings h2{margin:0;font:var(--dsw-font-l-20)}.dsh-remote-intro{margin:0;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-s-14)}
      .dsh-remote-toggle{display:flex;align-items:center;gap:8px;font:var(--dsw-font-s-14);cursor:pointer}.dsh-remote-toggle input{width:16px;height:16px;margin-left:auto}.dsh-remote-nav-label{display:inline-flex;align-items:center;gap:8px}
      @keyframes dsh-remote-gate-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.dsh-remote-gate-card{animation:none}}@media(max-width:520px){.dsh-remote-gate{padding:16px}.dsh-remote-gate-card{padding:20px;border-radius:var(--dsw-radius-l,12px)}}
    `;

    function isRemoteBrowser() {
      const hostname = globalThis.location?.hostname;
      return typeof hostname === "string" && hostname.length > 0
        && hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "[::1]";
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

    function apply(ctx) {
      const remoteBrowser = isRemoteBrowser();
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

      let disposeGate;
      let initialGateError = "";
      const unlock = () => {
        const dispose = disposeGate;
        disposeGate = undefined;
        dispose?.();
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
              currentSecret = token.trim();
              saveSecret(currentSecret);
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
        currentSecret = "";
        saveSecret("");
        mountGate();
      };
      mountGate();

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
          setRemote(Object.assign({}, result.value, { message: "远程控制已认证" }));
        };
        const save = () => withBusy(async () => {
          if (secret.trim()) await props.configRequest("setSecret", { secret: secret.trim() });
          const next = await props.configRequest("setEnabled", { enabled });
          setRemote(Object.assign({}, next, { message: "远程控制设置已保存" }));
        }, "保存远程控制失败: ");
        return react.createElement("div", { className: "dsh-remote-settings" },
          react.createElement("style", null, uiCss),
          react.createElement("h2", null, "远程控制 (Remote Control)"),
          react.createElement("p", { className: "dsh-remote-intro" }, "通过共享密钥解锁远程设置与特权操作。"),
          react.createElement("label", { className: "dsh-remote-toggle" },
            react.createElement("span", null, "启用远程访问"),
            react.createElement("input", {
              type: "checkbox", role: "switch", checked: enabled, disabled: busy || props.remoteBrowser,
              "aria-label": "启用远程访问", onChange: (event) => setEnabled(event.target.checked),
            })
          ),
          react.createElement("label", { className: "dsh-remote-field" },
            react.createElement("span", { className: "dsh-remote-label" }, "远程访问密钥 / Token"),
            react.createElement("input", {
              className: "dsh-remote-input", type: "password", value: secret, autoComplete: "current-password",
              disabled: busy, "aria-label": "远程访问密钥", onChange: (event) => setSecret(event.target.value),
            })
          ),
          react.createElement("p", { className: "dsh-remote-details" }, "访问环境: " + (props.remoteBrowser ? "远程访问" : "本机访问")),
          react.createElement("p", { className: "dsh-remote-details" }, "状态: " + remote.message),
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

      const label = () => react.createElement("span", {
        "data-settings-nav-label": "remote-control", className: "dsh-remote-nav-label",
      },
      react.createElement("style", null, "button:has([data-settings-nav-label]) > svg:first-child{display:none}"),
      react.createElement(IconGlobeOutline14, { size: 16 }),
      react.createElement("span", null, "远程控制"));
      ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({
        name: SETTINGS_SLOT,
        id: "remote-control",
        order: 26,
        label,
        inject: () => ({ remoteBrowser, remoteResult, remoteRequest, configRequest }),
      }, RemoteControlSettings));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
