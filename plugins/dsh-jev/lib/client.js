/**
 * dsh-jev 前端设置面板 (Client Settings UI)
 *
 * 在 DSH 的 Settings -> Jev 决策模型 中提供可视化的配置面板，
 * 允许用户在 Web 界面直接输入、查看与保存 TypeSafe API Key，
 * 并在前端提供即时测通验证。
 */

window.__ModuleLoader__.load({
  id: "dsh-jev",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");

    const SETTINGS_SLOT = "settings.section";
    const RPC_CHANNEL = "/dsh-jev-settings";

    const css = `
      .jev-settings{display:flex;flex-direction:column;gap:14px;width:100%;max-width:720px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);color-scheme:light dark}
      .jev-settings h2,.jev-settings p{margin:0}
      .jev-settings h2{font:var(--dsw-font-l-20);display:flex;align-items:center;gap:8px}
      .jev-intro{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-s-14);line-height:20px}
      .jev-card{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-l,12px);background:var(--dsw-alias-background-base,var(--dsw-alias-bg-module-platform))}
      .jev-field{display:flex;flex-direction:column;gap:6px}
      .jev-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500}
      .jev-input{box-sizing:border-box;width:100%;height:36px;padding:0 12px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:8px;outline:none;background:var(--dsw-alias-background-base,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
      .jev-input:focus-visible{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 18%,transparent)}
      .jev-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:4px}
      .jev-btn{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 14px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:18px;background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);cursor:pointer}
      .jev-btn:disabled{cursor:default;opacity:.5}
      .jev-btn-primary{border-color:transparent;background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff}
      .jev-status{padding:10px 12px;border-radius:8px;font-size:12px;line-height:18px}
      .jev-status.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 10%,transparent);color:var(--dsw-alias-state-success-primary,#22c55e)}
      .jev-status.err{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 10%,transparent);color:var(--dsw-alias-state-error-primary,#d84848)}
      .jev-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}
      .jev-input:disabled{opacity:.6;cursor:default}
      select.jev-input{cursor:pointer}
      select.jev-input option{background:var(--dsw-alias-background-base,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary)}
    `;

    function JevSettings(props) {
      const { rpcCall } = props || {};
      const [apiKey, setApiKey] = react.useState("");
      const [baseURL, setBaseURL] = react.useState("https://api.typesafe.ai");
      const [baseURLLocked, setBaseURLLocked] = react.useState(false);
      const [endpoint, setEndpoint] = react.useState("/v1/systemone");
      const [endpointLocked, setEndpointLocked] = react.useState(false);
      const [model, setModel] = react.useState("jev-latest");
      const [proxy, setProxy] = react.useState("");
      const [proxyLocked, setProxyLocked] = react.useState(false);
      const [status, setStatus] = react.useState(null);
      const [loading, setLoading] = react.useState(false);
      const [testing, setTesting] = react.useState(false);

      react.useEffect(() => {
        let active = true;
        if (!rpcCall) return;
        setLoading(true);
        rpcCall("getConfig", {})
          .then((data) => {
            if (!active) return;
            if (data.apiKey) setApiKey(data.apiKey);
            if (typeof data.baseURL === "string" && data.baseURL) setBaseURL(data.baseURL);
            setBaseURLLocked(data.baseURLLocked === true);
            if (typeof data.endpoint === "string" && data.endpoint) setEndpoint(data.endpoint);
            setEndpointLocked(data.endpointLocked === true);
            if (data.model) setModel(data.model);
            if (typeof data.proxy === "string") setProxy(data.proxy);
            setProxyLocked(data.proxyLocked === true);
            if (data.configured) {
              setStatus({ ok: true, msg: "已从系统环境或配置文件成功加载密钥" });
            }
          })
          .catch((err) => {
            if (active) setStatus({ ok: false, msg: "读取配置失败: " + err.message });
          })
          .finally(() => {
            if (active) setLoading(false);
          });
        return () => { active = false; };
      }, [rpcCall]);

      const save = async () => {
        if (!rpcCall) return;
        setLoading(true);
        try {
          const res = await rpcCall("saveConfig", {
            apiKey: apiKey.trim(),
            baseURL: baseURL.trim(),
            endpoint,
            model,
            proxy: proxy.trim(),
          });
          if (res === true || (res && res.ok)) {
            setStatus({ ok: true, msg: "设置已保存成功！已写入本地配置" });
            rpcCall("getConfig", {}).then((data) => {
              if (data && typeof data.baseURL === "string") {
                setBaseURL(data.baseURL);
              }
              if (data && typeof data.endpoint === "string") {
                setEndpoint(data.endpoint);
              }
            }).catch(() => {});
          } else {
            setStatus({ ok: false, msg: res?.error || "保存失败" });
          }
        } catch (err) {
          setStatus({ ok: false, msg: "保存发生异常：" + err.message });
        } finally {
          setLoading(false);
        }
      };

      const testCall = async () => {
        if (!rpcCall) return;
        setTesting(true);
        setStatus(null);
        try {
          const res = await rpcCall("testConnection", {
            apiKey: apiKey.trim(),
            baseURL: baseURL.trim(),
            endpoint,
            model,
            proxy: proxy.trim(),
          });
          if (res && res.durationMs !== undefined) {
            const via = proxy.trim() ? "（经代理）" : "（直连）";
            const target = (baseURL.trim() || "https://api.typesafe.ai") + (endpoint || "/v1/systemone");
            setStatus({ ok: true, msg: `✓ 连接成功！[${target}] Jev 模型响应正常 ${via} (${res.durationMs}ms)` });
          } else {
            setStatus({ ok: false, msg: `连接失败：${res?.error || "未能连通接口服务"}` });
          }
        } catch (err) {
          setStatus({ ok: false, msg: "测试请求失败：" + err.message });
        } finally {
          setTesting(false);
        }
      };

      return react.createElement("div", { className: "jev-settings" },
        react.createElement("style", null, css),
        react.createElement("h2", null, "TypeSafe Jev 设置"),
        react.createElement("p", { className: "jev-intro" },
          "TypeSafe Jev (System One) 决策模型配置。无需派生子进程，提供毫秒级强类型概率决策。"
        ),
        react.createElement("div", { className: "jev-card" },
          react.createElement("label", { className: "jev-field" },
            react.createElement("span", { className: "jev-label" }, "TypeSafe API Key"),
            react.createElement("input", {
              className: "jev-input",
              type: "password",
              value: apiKey,
              placeholder: "ts-...",
              onChange: (e) => setApiKey(e.target.value),
            })
          ),
          react.createElement("label", { className: "jev-field" },
            react.createElement("span", { className: "jev-label" }, "接口地址"),
            react.createElement("input", {
              className: "jev-input",
              type: "text",
              value: baseURL,
              disabled: baseURLLocked,
              placeholder: "https://api.typesafe.ai",
              onChange: (e) => setBaseURL(e.target.value),
            }),
            react.createElement("p", { className: "jev-hint" },
              baseURLLocked
                ? "接口地址已由插件配置（baseURL）固定，如需修改请编辑 Profile 配置后重启。"
                : "默认为官方地址 https://api.typesafe.ai。可自定义配置为其它地址，如：本地接口服务地址（http://127.0.0.1:8000）。"
            )
          ),
          react.createElement("label", { className: "jev-field" },
            react.createElement("span", { className: "jev-label" }, "接口端点"),
            react.createElement("select", {
              className: "jev-input",
              value: endpoint,
              disabled: endpointLocked,
              onChange: (e) => setEndpoint(e.target.value),
            },
              react.createElement("option", { value: "/v1/systemone" }, "/v1/systemone（官方默认）"),
              react.createElement("option", { value: "/v1/decisions" }, "/v1/decisions（兼容 OpenAI）")
            ),
            react.createElement("p", { className: "jev-hint" },
              endpointLocked
                ? "接口端点已由插件配置（endpoint）固定，如需修改请编辑 Profile 配置后重启。"
                : "默认为 /v1/systemone。如对接兼容 OpenAI 决策协议的本地或第三方服务，可切换为 /v1/decisions。"
            )
          ),
          react.createElement("label", { className: "jev-field" },
            react.createElement("span", { className: "jev-label" }, "默认决策模型"),
            react.createElement("input", {
              className: "jev-input",
              type: "text",
              value: model,
              onChange: (e) => setModel(e.target.value),
            })
          ),
          react.createElement("label", { className: "jev-field" },
            react.createElement("span", { className: "jev-label" }, "代理地址"),
            react.createElement("input", {
              className: "jev-input",
              type: "text",
              value: proxy,
              disabled: proxyLocked,
              placeholder: "http://127.0.0.1:7890",
              onChange: (e) => setProxy(e.target.value),
            }),
            react.createElement("p", { className: "jev-hint" },
              proxyLocked
                ? "代理地址已由插件配置（proxy）固定，如需修改请编辑 Profile 配置后重启。"
                : "留空表示直连。填写后，发往 *.typesafe.ai 的请求将全部经该代理转发。" +
                  "支持 http://、https://、socks5://、socks5h://；省略协议时按 http 处理；" +
                  "需要认证时写成 http://user:password@host:port。"
            )
          ),
          status ? react.createElement("div", { className: `jev-status ${status.ok ? "ok" : "err"}` }, status.msg) : null,
          react.createElement("div", { className: "jev-actions" },
            react.createElement("button", {
              className: "jev-btn",
              type: "button",
              disabled: loading || testing,
              onClick: testCall,
            }, testing ? "正在测试..." : "测试连接"),
            react.createElement("button", {
              className: "jev-btn jev-btn-primary",
              type: "button",
              disabled: loading || testing,
              onClick: save,
            }, loading ? "保存中..." : "保存设置")
          )
        )
      );
    }

    const NAV_STYLE_ID = "dsh-jev-nav-styles";
    const navCss = 'button:has([data-settings-nav-label="dsh-jev"]) > svg:first-child{display:none}';

    function IconSparkles16({ size = 16 }) {
      return react.createElement("svg", {
        width: size,
        height: size,
        viewBox: "0 0 16 16",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "1.3",
        strokeLinecap: "round",
        strokeLinejoin: "round",
      },
        react.createElement("path", { d: "m8 1 1.7 4.3L14 7l-4.3 1.7L8 13l-1.7-4.3L2 7l4.3-1.7z" }),
        react.createElement("path", { d: "M13 12l.6 1.4L15 14l-1.4.6L13 16l-.6-1.4L11 14l1.4-.6z" })
      );
    }

    function apply(ctx) {
      if (typeof document !== "undefined" && !document.getElementById(NAV_STYLE_ID)) {
        const style = document.createElement("style");
        style.id = NAV_STYLE_ID;
        style.textContent = navCss;
        document.head.appendChild(style);
      }

      const rpcCall = async (method, payload) => {
        const conn = ctx && ctx.connection;
        const rpc = conn && conn.rpc;
        if (!rpc || typeof rpc.call !== "function") {
          throw new Error("连接服务尚未就绪");
        }
        const result = await rpc.call(RPC_CHANNEL, method, payload || {});
        if (result && result.ok === true) return result.value;
        throw new Error(result?.error?.message || "请求失败");
      };

      const label = () => react.createElement("span", {
        "data-settings-nav-label": "dsh-jev",
        style: { display: "inline-flex", alignItems: "center", gap: 8 },
      },
        react.createElement(IconSparkles16, { size: 16 }),
        react.createElement("span", null, "Jev 决策模型")
      );

      ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({
        name: SETTINGS_SLOT,
        id: "dsh-jev",
        order: 36,
        label,
        inject: () => ({ rpcCall }),
      }, JevSettings));
    }

    exports.apply = apply;
    exports.inject = ["slots", "connection"];
    return module.exports;
  },
});
