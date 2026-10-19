/**
 * dsh-image-gen 前端设置面板 (Client Settings UI)
 *
 * 在 DSH 的 Settings → 生图模型 中提供可视化配置：
 *   - 来源切换：dsh 已配置的提供商（下拉） / 手动配置（baseUrl + API Key）
 *   - 提供商与模型下拉（模型列表来自 dsh 自身配置，生图模型排在前列）
 *   - 尺寸与画质下拉
 *   - 代理地址（留空直连）
 *   - 保存设置 / 测试连接（测试会真正出一张 512x512 小图）
 */

window.__ModuleLoader__.load({
  id: "@weniatall/dsh-image-gen",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");

    const SETTINGS_SLOT = "settings.section";
    const RPC_CHANNEL = "/dsh-image-gen-settings";

    const css = `
      .img-settings{display:flex;flex-direction:column;gap:14px;width:100%;max-width:760px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family)}
      .img-settings h2,.img-settings p{margin:0}
      .img-settings h2{font:var(--dsw-font-l-20);display:flex;align-items:center;gap:8px}
      .img-intro{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-s-14);line-height:20px}
      .img-card{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-l,12px);background:var(--dsw-alias-background-base,var(--dsw-alias-bg-module-platform))}
      .img-row{display:flex;gap:12px;flex-wrap:wrap}
      .img-row>.img-field{flex:1 1 220px}
      .img-field{display:flex;flex-direction:column;gap:6px}
      .img-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;display:flex;align-items:center;gap:6px}
      .img-input{box-sizing:border-box;width:100%;height:36px;padding:0 12px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:8px;outline:none;background:var(--dsw-alias-background-base,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
      .img-input:focus-visible{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 18%,transparent)}
      .img-input:disabled{opacity:.6;cursor:default}
      select.img-input{cursor:pointer}
      select.img-input option{background:var(--dsw-alias-background-base,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary)}
      .img-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:4px}
      .img-btn{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 14px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:18px;background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);cursor:pointer}
      .img-btn:disabled{cursor:default;opacity:.5}
      .img-btn-primary{border-color:transparent;background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff}
      .img-status{padding:10px 12px;border-radius:8px;font-size:12px;line-height:18px;white-space:pre-wrap}
      .img-status.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 10%,transparent);color:var(--dsw-alias-state-success-primary,#22c55e)}
      .img-status.err{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 10%,transparent);color:var(--dsw-alias-state-error-primary,#d84848)}
      .img-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}
      .img-tag{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 14%,transparent);color:var(--dsw-alias-brand-primary,#4d6bfe);font-size:11px;line-height:18px}
      .img-tag.muted{background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#888) 16%,transparent);color:var(--dsw-alias-label-tertiary,#888)}
    `;

    /** 把 dsh 提供商行渲染成下拉选项。 */
    function providerOptions(providers, activeId) {
      const list = Array.isArray(providers) ? providers : [];
      if (list.length === 0) {
        return [react.createElement("option", { key: "empty", value: "" }, "（dsh 模型配置里没有提供商）")];
      }
      const options = list.map((p) =>
        react.createElement("option", { key: p.id, value: p.id },
          (p.name && p.name !== p.id ? `${p.name}（${p.id}）` : p.id) +
          (Array.isArray(p.imageModels) && p.imageModels.length > 0 ? ` — ${p.imageModels.length} 个生图模型` : ""))
      );
      if (activeId && !list.some((p) => p.id === activeId)) {
        options.unshift(react.createElement("option", { key: "missing", value: activeId }, `${activeId}（未在配置中找到）`));
      }
      return options;
    }

    /** 模型下拉：生图模型优先，其余排后面。 */
    function modelOptions(models, imageModels, activeModel) {
      const preferred = Array.isArray(imageModels) ? imageModels : [];
      const rest = (Array.isArray(models) ? models : []).filter((m) => preferred.indexOf(m) === -1);
      const options = [];
      if (preferred.length > 0) {
        options.push(react.createElement("optgroup", { key: "g-img", label: "生图模型" },
          preferred.map((m) => react.createElement("option", { key: `img-${m}`, value: m }, m))));
      }
      if (rest.length > 0) {
        options.push(react.createElement("optgroup", { key: "g-other", label: "其它模型（不保证支持生图）" },
          rest.map((m) => react.createElement("option", { key: `other-${m}`, value: m }, m))));
      }
      if (activeModel && (preferred.indexOf(activeModel) === -1 && rest.indexOf(activeModel) === -1)) {
        options.unshift(react.createElement("option", { key: "active", value: activeModel }, `${activeModel}（当前）`));
      }
      if (options.length === 0) {
        options.push(react.createElement("option", { key: "empty", value: "" }, "（该提供商没有配置模型）"));
      }
      return options;
    }

    function ImageGenSettings(props) {
      const { rpcCall } = props || {};
      const [source, setSource] = react.useState("provider");
      const [providers, setProviders] = react.useState([]);
      const [provider, setProvider] = react.useState("");
      const [models, setModels] = react.useState([]);
      const [imageModels, setImageModels] = react.useState([]);
      const [model, setModel] = react.useState("");
      const [baseURL, setBaseURL] = react.useState("");
      const [apiKey, setApiKey] = react.useState("");
      const [apiKeyEnv, setApiKeyEnv] = react.useState("");
      const [apiKeyConfigured, setApiKeyConfigured] = react.useState(false);
      const [sizeOptions, setSizeOptions] = react.useState([]);
      const [size, setSize] = react.useState("1024x1024");
      const [qualityOptions, setQualityOptions] = react.useState([]);
      const [quality, setQuality] = react.useState("auto");
      const [proxy, setProxy] = react.useState("");
      const [proxyLocked, setProxyLocked] = react.useState(false);
      const [locked, setLocked] = react.useState({});
      const [configSource, setConfigSource] = react.useState("");
      const [profile, setProfile] = react.useState("");
      const [dshHome, setDshHome] = react.useState("");
      const [profilesOnDisk, setProfilesOnDisk] = react.useState([]);
      const [profileConfigFiles, setProfileConfigFiles] = react.useState([]);
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
            if (data.source) setSource(data.source);
            setProviders(Array.isArray(data.providers) ? data.providers : []);
            if (data.provider) setProvider(data.provider);
            setModels(Array.isArray(data.availableModels) ? data.availableModels : []);
            setImageModels(Array.isArray(data.availableImageModels) ? data.availableImageModels : []);
            if (data.model) setModel(data.model);
            if (typeof data.baseURL === "string") setBaseURL(data.baseURL);
            if (data.apiKeyEnv) setApiKeyEnv(data.apiKeyEnv);
            setApiKeyConfigured(data.apiKeyConfigured === true);
            if (Array.isArray(data.sizeOptions) && data.sizeOptions.length > 0) setSizeOptions(data.sizeOptions);
            if (data.size) setSize(data.size);
            if (Array.isArray(data.qualityOptions) && data.qualityOptions.length > 0) setQualityOptions(data.qualityOptions);
            if (data.quality) setQuality(data.quality);
            if (typeof data.proxy === "string") setProxy(data.proxy);
            setProxyLocked(data.proxyLocked === true);
            setLocked(data.locked || {});
            setConfigSource(typeof data.configSource === "string" ? data.configSource : "");
            setProfile(typeof data.profile === "string" ? data.profile : "");
            setDshHome(typeof data.dshHome === "string" ? data.dshHome : "");
            setProfilesOnDisk(Array.isArray(data.profilesOnDisk) ? data.profilesOnDisk : []);
            setProfileConfigFiles(Array.isArray(data.profileConfigFiles) ? data.profileConfigFiles : []);
            if (data.apiKeyConfigured === true) {
              setApiKey("");
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

      /** 切换提供商时，把模型下拉收敛到该提供商的生图模型。 */
      const onProviderChange = (next) => {
        setProvider(next);
        const row = providers.find((p) => p.id === next);
        const nextModels = row && Array.isArray(row.models) ? row.models : [];
        const nextImage = row && Array.isArray(row.imageModels) ? row.imageModels : [];
        setModels(nextModels);
        setImageModels(nextImage);
        if (nextImage.length > 0) {
          setModel(nextImage[0]);
        } else if (nextModels.length > 0) {
          setModel(nextModels[0]);
        }
      };

      const save = async () => {
        if (!rpcCall) return;
        setLoading(true);
        setStatus(null);
        try {
          const payload = { source, provider, model, size, quality, proxy: proxy.trim() };
          if (source === "manual") payload.baseURL = baseURL.trim();
          if (apiKey.trim()) payload.apiKey = apiKey.trim();
          const res = await rpcCall("saveConfig", payload);
          if (res === true || (res && res.ok !== false)) {
            setApiKey("");
            setStatus({ ok: true, msg: "设置已保存！" + (source === "provider" ? "已写入本地生图配置" : "") });
            if (res && res.configSource) setConfigSource(res.configSource);
            if (res && res.apiKeyConfigured !== undefined) setApiKeyConfigured(res.apiKeyConfigured === true);
          } else {
            setStatus({ ok: false, msg: (res && (res.error?.message || res.error)) || "保存失败" });
          }
        } catch (err) {
          setStatus({ ok: false, msg: "保存发生异常：" + (err?.message || err) });
        } finally {
          setLoading(false);
        }
      };

      const testCall = async () => {
        if (!rpcCall) return;
        setTesting(true);
        setStatus(null);
        try {
          const payload = { source, provider, model, size, quality, proxy: proxy.trim() };
          if (source === "manual") payload.baseURL = baseURL.trim();
          if (apiKey.trim()) payload.apiKey = apiKey.trim();
          const res = await rpcCall("testConnection", payload);
          if (res && res.durationMs !== undefined) {
            setStatus({
              ok: true,
              msg: "✓ 连接成功！模型 " + res.model + " 正常出图（" + res.via + "，实际尺寸 " + res.actualSize + "，耗时 " + res.durationMs + "ms）\n测试图已保存到 " + res.savePath,
            });
          } else {
            setStatus({ ok: false, msg: "连接失败：" + ((res && res.error) || "未能连通生图接口") });
          }
        } catch (err) {
          setStatus({ ok: false, msg: "测试请求失败：" + err.message });
        } finally {
          setTesting(false);
        }
      };

      const isManual = source === "manual";
      const sizeList = sizeOptions.length > 0 ? sizeOptions : [{ value: "1024x1024", label: "1024 × 1024" }];
      const qualityList = qualityOptions.length > 0 ? qualityOptions : [{ value: "auto", label: "auto" }];

      return react.createElement("div", { className: "img-settings" },
        react.createElement("style", null, css),
        react.createElement("h2", null, "生图模型设置"),
        react.createElement("p", { className: "img-intro" },
          "配置文生图工具（image_generate）使用的提供商、模型、尺寸与画质。可以直接下拉选择 dsh 已配置的提供商与模型，也可以手写一个 OpenAI 兼容的 baseUrl 与 API Key。"
        ),
        react.createElement("div", { className: "img-card" },
          // 来源切换
          react.createElement("label", { className: "img-field" },
            react.createElement("span", { className: "img-label" }, "配置来源"),
            react.createElement("select", {
              className: "img-input",
              value: source,
              onChange: (e) => setSource(e.target.value),
            },
              react.createElement("option", { value: "provider" }, "dsh 已配置的提供商（下拉选择）"),
              react.createElement("option", { value: "manual" }, "手动配置 baseUrl 与 API Key")
            ),
            react.createElement("p", { className: "img-hint" },
              isManual
                ? "手写一个 OpenAI 兼容的生图接口地址（形如 http://host:port/v1），并填写该服务的 API Key。"
                : "列表来自 dsh 自身的模型配置（llm-pi-ai 的 providers），API Key 会按 apiKeyEnv 自动解析。"
            )
          ),

          isManual ? null : react.createElement("label", { className: "img-field" },
            react.createElement("span", { className: "img-label" }, "提供商"),
            react.createElement("select", {
              className: "img-input",
              value: provider,
              disabled: locked.provider === true,
              onChange: (e) => onProviderChange(e.target.value),
            }, providerOptions(providers, provider)),
            react.createElement("p", { className: "img-hint" },
              locked.provider === true
                ? "提供商已由插件配置（provider）固定，如需修改请编辑 Profile 配置后重启。"
                : (providers.length === 0
                  ? "未在 dsh 模型配置里找到提供商：可切到「手动配置」先用手写地址，" +
                    "或确认该 profile 的 llm-pi-ai 行里有 providers。本次读取：profile=" +
                    (profile || "web") + "，主目录=" + (dshHome || "~/.dsh") +
                    (profilesOnDisk.length > 0 ? "，现有 profile：" + profilesOnDisk.join("、") : "") +
                    "。检查 " +
                    (profileConfigFiles.length > 0 ? profileConfigFiles.join("、") : "该 profile 的 cordis.patch.yml") +
                    " 里的 llm-pi-ai providers。"
                  : "选中的提供商决定 baseUrl、请求头与 API Key 的来源。")
            )
          ),

          isManual ? react.createElement("label", { className: "img-field" },
            react.createElement("span", { className: "img-label" }, "接口地址 baseUrl"),
            react.createElement("input", {
              className: "img-input",
              type: "text",
              value: baseURL,
              disabled: locked.baseURL === true,
              placeholder: "http://192.168.1.253:8319/v1",
              onChange: (e) => setBaseURL(e.target.value),
            }),
            react.createElement("p", { className: "img-hint" },
              locked.baseURL === true
                ? "接口地址已由插件配置（baseURL）固定，如需修改请编辑 Profile 配置后重启。"
                : "OpenAI 兼容的生图接口根地址，末尾可带或不带 /v1。"
            )
          ) : null,

          isManual ? react.createElement("label", { className: "img-field" },
            react.createElement("span", { className: "img-label" },
              "API Key",
              apiKeyConfigured
                ? react.createElement("span", { className: "img-tag" }, "已配置")
                : null
            ),
            react.createElement("input", {
              className: "img-input",
              type: "password",
              value: apiKey,
              placeholder: apiKeyConfigured ? "已保存（留空表示不修改）" : "sk-...",
              onChange: (e) => setApiKey(e.target.value),
            }),
            react.createElement("p", { className: "img-hint" },
              apiKeyConfigured
                ? "已从本地配置读取到 Key，留空保存即保持原值不变。"
                : "该 Key 只写入本机设置文件，不会进入模型上下文。"
            )
          ) : null,

          react.createElement("label", { className: "img-field" },
            react.createElement("span", { className: "img-label" },
              "模型",
              locked.model === true ? react.createElement("span", { className: "img-tag muted" }, "已由配置固定") : null
            ),
            isManual
              ? react.createElement("input", {
                  className: "img-input",
                  type: "text",
                  value: model,
                  disabled: locked.model === true,
                  placeholder: "例如 gemini-3.1-flash-image、grok-imagine-image",
                  onChange: (e) => setModel(e.target.value),
                })
              : react.createElement("select", {
                  className: "img-input",
                  value: model,
                  disabled: locked.model === true,
                  onChange: (e) => setModel(e.target.value),
                }, modelOptions(models, imageModels, model)),
            react.createElement("p", { className: "img-hint" },
              isManual
                ? "填写该生图服务支持的模型 ID，例如 gemini-3.1-flash-image、grok-imagine-image 或自定义模型名。"
                : (imageModels.length > 0
                  ? "优先展示识别到的生图模型；其它模型也能选，但不保证支持文生图。"
                  : "该提供商没有识别到生图模型，请手动确认模型 ID 是否支持文生图。")
            )
          ),

          react.createElement("div", { className: "img-row" },
            react.createElement("label", { className: "img-field" },
              react.createElement("span", { className: "img-label" }, "图片尺寸"),
              react.createElement("select", {
                className: "img-input",
                value: size,
                onChange: (e) => setSize(e.target.value),
              }, sizeList.map((option) =>
                react.createElement("option", { key: option.value, value: option.value }, option.label || option.value))),
              react.createElement("p", { className: "img-hint" }, "默认尺寸；调用 image_generate 时可用 size 参数临时覆盖。")
            ),
            react.createElement("label", { className: "img-field" },
              react.createElement("span", { className: "img-label" }, "画质"),
              react.createElement("select", {
                className: "img-input",
                value: quality,
                onChange: (e) => setQuality(e.target.value),
              }, qualityList.map((option) =>
                react.createElement("option", { key: option.value, value: option.value }, option.label || option.value))),
              react.createElement("p", { className: "img-hint" }, "auto 表示不发送 quality 字段，由提供商自行决定。")
            )
          ),

          react.createElement("label", { className: "img-field" },
            react.createElement("span", { className: "img-label" }, "代理地址"),
            react.createElement("input", {
              className: "img-input",
              type: "text",
              value: proxy,
              disabled: proxyLocked,
              placeholder: "http://127.0.0.1:7890",
              onChange: (e) => setProxy(e.target.value),
            }),
            react.createElement("p", { className: "img-hint" },
              proxyLocked
                ? "代理地址已由插件配置（proxy）固定，如需修改请编辑 Profile 配置后重启。"
                : "留空表示直连。支持 http://、https://、socks5://、socks5h://；需要认证时写成 http://user:password@host:port。"
            )
          ),

          configSource
            ? react.createElement("p", { className: "img-hint" }, "配置来源：" + configSource + "（" + "设置文件：" + (props.settingsFile || "") + "）")
            : null,

          status ? react.createElement("div", { className: `img-status ${status.ok ? "ok" : "err"}` }, status.msg) : null,

          react.createElement("div", { className: "img-actions" },
            react.createElement("button", {
              className: "img-btn",
              type: "button",
              disabled: loading || testing,
              onClick: testCall,
            }, testing ? "正在测试..." : "测试连接"),
            react.createElement("button", {
              className: "img-btn img-btn-primary",
              type: "button",
              disabled: loading || testing,
              onClick: save,
            }, loading ? "保存中..." : "保存设置")
          )
        )
      );
    }

    const NAV_STYLE_ID = "dsh-image-gen-nav-styles";
    const navCss = 'button:has([data-settings-nav-label="dsh-image-gen"]) > svg:first-child{display:none}';

    function IconImage16({ size = 16 }) {
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
        react.createElement("rect", { x: "2", y: "3", width: "12", height: "10", rx: "2" }),
        react.createElement("circle", { cx: "5.8", cy: "6.6", r: "1.2" }),
        react.createElement("path", { d: "M2.6 12.2 6 9.2l2.4 2.1 2.6-2.4 2.4 2.2" })
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
        throw new Error(result?.error?.message || (typeof result?.error === 'string' ? result.error : "请求失败"));
      };

      const label = () => react.createElement("span", {
        "data-settings-nav-label": "dsh-image-gen",
        style: { display: "inline-flex", alignItems: "center", gap: 8 },
      },
        react.createElement(IconImage16, { size: 16 }),
        react.createElement("span", null, "生图模型")
      );

      ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({
        name: SETTINGS_SLOT,
        id: "dsh-image-gen",
        order: 34,
        label,
        inject: () => ({ rpcCall }),
      }, ImageGenSettings));
    }

    exports.apply = apply;
    exports.inject = ["slots", "connection"];
    return module.exports;
  },
});
