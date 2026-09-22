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
    `;

    function JevSettings(props) {
      const { rpcCall } = props || {};
      const [apiKey, setApiKey] = react.useState("");
      const [model, setModel] = react.useState("jev-latest");
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
            if (data.model) setModel(data.model);
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
          const res = await rpcCall("saveConfig", { apiKey: apiKey.trim(), model });
          if (res && res.ok) {
            setStatus({ ok: true, msg: "设置已保存成功！已写入本地配置" });
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
          const res = await rpcCall("testConnection", { apiKey: apiKey.trim(), model });
          if (res && res.durationMs !== undefined) {
            setStatus({ ok: true, msg: `✓ 连接成功！Jev 模型响应正常 (${res.durationMs}ms)` });
          } else {
            setStatus({ ok: false, msg: `连接失败：${res?.error || "未能连通 TypeSafe API"}` });
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
            react.createElement("span", { className: "jev-label" }, "默认决策模型"),
            react.createElement("input", {
              className: "jev-input",
              type: "text",
              value: model,
              onChange: (e) => setModel(e.target.value),
            })
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
