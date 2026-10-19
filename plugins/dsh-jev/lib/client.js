/**
 * dsh-jev 前端设置面板 (Client Settings UI)
 *
 * 在 DSH 的 Settings → 决策模型 中提供可视化配置：
 *   - 来源切换：dsh 已配置的提供商（下拉） / 手动配置（baseUrl + API Key + 模型 ID）
 *   - 提供商与模型下拉（模型列表来自 dsh 自身配置，决策模型排在前列）
 *   - 接口端点下拉（/v1/systemone 官方原生协议 与 /v1/decisions 兼容 OpenAI）
 *   - 代理地址（留空直连）
 *   - 保存设置 / 测试连接
 *
 * 默认为 TypeSafe Jev 官方地址，但不再绑定 TypeSafe：任何兼容决策协议的服务
 * 都可以通过「手动配置」或已经配置在 dsh 里的提供商接入。
 */

window.__ModuleLoader__.load({
  id: "@weniatall/dsh-jev",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");

    const SETTINGS_SLOT = "settings.section";
    const RPC_CHANNEL = "/dsh-jev-settings";

    const DEFAULT_BASE_URL = "https://api.typesafe.ai";
    const DEFAULT_ENDPOINTS = { manual: "/v1/systemone", provider: "/v1/decisions" };

    const css = `
      .jev-settings{display:flex;flex-direction:column;gap:14px;width:100%;max-width:760px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);color-scheme:light dark}
      .jev-settings h2,.jev-settings p{margin:0}
      .jev-settings h2{font:var(--dsw-font-l-20);display:flex;align-items:center;gap:8px}
      .jev-intro{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-s-14);line-height:20px}
      .jev-card{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-l,12px);background:var(--dsw-alias-background-base,var(--dsw-alias-bg-module-platform))}
      .jev-row{display:flex;gap:12px;flex-wrap:wrap}
      .jev-row>.jev-field{flex:1 1 220px}
      .jev-field{display:flex;flex-direction:column;gap:6px}
      .jev-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;display:flex;align-items:center;gap:6px}
      .jev-input{box-sizing:border-box;width:100%;height:36px;padding:0 12px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:8px;outline:none;background:var(--dsw-alias-background-base,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
      .jev-input:focus-visible{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 18%,transparent)}
      .jev-input:disabled{opacity:.6;cursor:default}
      select.jev-input{cursor:pointer}
      select.jev-input option{background:var(--dsw-alias-background-base,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary)}
      .jev-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:4px}
      .jev-btn{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 14px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:18px;background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);cursor:pointer}
      .jev-btn:disabled{cursor:default;opacity:.5}
      .jev-btn-primary{border-color:transparent;background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff}
      .jev-status{padding:10px 12px;border-radius:8px;font-size:12px;line-height:18px;white-space:pre-wrap}
      .jev-status.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 10%,transparent);color:var(--dsw-alias-state-success-primary,#22c55e)}
      .jev-status.err{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 10%,transparent);color:var(--dsw-alias-state-error-primary,#d84848)}
      .jev-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}
      .jev-tag{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 14%,transparent);color:var(--dsw-alias-brand-primary,#4d6bfe);font-size:11px;line-height:18px}
      .jev-tag.muted{background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#888) 16%,transparent);color:var(--dsw-alias-label-tertiary,#888)}
    `;

    /** 把 dsh 提供商行渲染成下拉选项。 */
    function providerOptions(providers, activeId) {
      const list = Array.isArray(providers) ? providers : [];
      if (list.length === 0) {
        return [react.createElement("option", { key: "empty", value: "" }, "（dsh 模型配置里没有提供商）")];
      }
      const options = list.map((p) =>
        react.createElement("option", { key: p.id, value: p.id },
          (p.name && p.name !== p.id ? p.name + "（" + p.id + "）" : p.id) +
          (Array.isArray(p.decisionModels) && p.decisionModels.length > 0
            ? " — " + p.decisionModels.length + " 个决策模型"
            : ""))
      );
      if (activeId && !list.some((p) => p.id === activeId)) {
        options.unshift(react.createElement("option", { key: "missing", value: activeId }, activeId + "（未在配置中找到）"));
      }
      return options;
    }

    /** 把模态数组渲染成人类可读的短标签（text+image → 文本+图像）。 */
    function modalityLabel(input) {
      const list = Array.isArray(input) ? input : [];
      if (list.length === 0) return "";
      const names = list.map((modality) => {
        if (modality === "text") return "文本";
        if (modality === "image") return "图像";
        return String(modality);
      });
      return names.join("+");
    }

    /** pi-ai 的 classifier 协议：命中时在模型标签上标出来源。 */
    const CLASSIFIER_APIS = ["typesafe-system-one", "cloudflare-workers-ai-system-one", "llama-cpp-classify", "openai-decisions"];

    /** 模型下拉项文字：id + 决策标记 + 接口 modality / 配置模态。 */
    function modelLabel(modelId, info) {
      if (!info) return modelId;
      const parts = [modelId];
      if (info.decisionModel) parts.push("决策模型");
      if (info.type && info.type !== "chat") parts.push("类型：" + info.type);
      if (info.modality) {
        // /v1/models 返回的 modality 是决策模型的直接依据，优先展示。
        parts.push("modality=" + info.modality);
      } else {
        const modalities = modalityLabel(info.input);
        if (modalities) parts.push(modalities);
      }
      // 只标出 classifier 协议：普通聊天路由的 openai-responses 之类对判断没有增量信息。
      if (info.api && CLASSIFIER_APIS.indexOf(String(info.api).toLowerCase()) !== -1) parts.push(info.api);
      return parts.join(" · ");
    }

    /** 模型下拉：决策模型优先，其余排后面；选项上附带模态/类型字段。 */
    function modelOptions(models, decisionModels, activeModel, modelInfo) {
      const preferred = Array.isArray(decisionModels) ? decisionModels : [];
      const rest = (Array.isArray(models) ? models : []).filter((m) => preferred.indexOf(m) === -1);
      const infoById = {};
      for (const entry of Array.isArray(modelInfo) ? modelInfo : []) {
        if (entry && typeof entry.id === "string") infoById[entry.id] = entry;
      }
      const options = [];
      if (preferred.length > 0) {
        options.push(react.createElement("optgroup", { key: "g-decision", label: "决策模型" },
          preferred.map((m) => react.createElement("option", { key: "decision-" + m, value: m }, modelLabel(m, infoById[m])))));
      }
      if (rest.length > 0) {
        options.push(react.createElement("optgroup", { key: "g-other", label: "其它模型（不保证支持决策协议）" },
          rest.map((m) => react.createElement("option", { key: "other-" + m, value: m }, modelLabel(m, infoById[m])))));
      }
      if (activeModel && preferred.indexOf(activeModel) === -1 && rest.indexOf(activeModel) === -1) {
        options.unshift(react.createElement("option", { key: "active", value: activeModel }, activeModel + "（当前）"));
      }
      if (options.length === 0) {
        options.push(react.createElement("option", { key: "empty", value: "" }, "（该提供商没有配置模型）"));
      }
      return options;
    }

    function JevSettings(props) {
      const { rpcCall } = props || {};
      const [source, setSource] = react.useState("manual");
      const [providers, setProviders] = react.useState([]);
      const [provider, setProvider] = react.useState("");
      const [models, setModels] = react.useState([]);
      const [decisionModels, setDecisionModels] = react.useState([]);
      const [model, setModel] = react.useState("jev-latest");
      const [modelInfo, setModelInfo] = react.useState([]);
      const [baseURL, setBaseURL] = react.useState(DEFAULT_BASE_URL);
      const [manualBaseURL, setManualBaseURL] = react.useState(DEFAULT_BASE_URL);
      const [baseURLLocked, setBaseURLLocked] = react.useState(false);
      const [endpoint, setEndpoint] = react.useState(DEFAULT_ENDPOINTS.manual);
      const [endpointDefaults, setEndpointDefaults] = react.useState({ ...DEFAULT_ENDPOINTS });
      const [endpointLocked, setEndpointLocked] = react.useState(false);
      const [apiKey, setApiKey] = react.useState("");
      const [manualApiKey, setManualApiKey] = react.useState("");
      const [apiKeyConfigured, setApiKeyConfigured] = react.useState(false);
      const [apiKeyFrom, setApiKeyFrom] = react.useState("");
      const [proxy, setProxy] = react.useState("");
      const [proxyLocked, setProxyLocked] = react.useState(false);
      const [configSource, setConfigSource] = react.useState("");
      const [modelWarning, setModelWarning] = react.useState("");
      const [modelsApi, setModelsApi] = react.useState(null);
      const [status, setStatus] = react.useState(null);
      const [loading, setLoading] = react.useState(false);
      const [testing, setTesting] = react.useState(false);

      react.useEffect(() => {
        let active = true;
        if (!rpcCall) return;
        setLoading(true);
        rpcCall("getConfig", {})
          .then((data) => {
            if (!active || !data) return;
            if (data.source) setSource(data.source);
            setProviders(Array.isArray(data.providers) ? data.providers : []);
            if (data.provider) setProvider(data.provider);
            setModels(Array.isArray(data.models) ? data.models : []);
            setDecisionModels(Array.isArray(data.decisionModels) ? data.decisionModels : []);
            setModelInfo(Array.isArray(data.modelInfo) ? data.modelInfo : []);
            if (data.model) setModel(data.model);
            if (typeof data.baseURL === "string") setBaseURL(data.baseURL);
            if (typeof data.manualBaseURL === "string" && data.manualBaseURL) setManualBaseURL(data.manualBaseURL);
            setBaseURLLocked(data.baseURLLocked === true);
            if (typeof data.endpoint === "string" && data.endpoint) setEndpoint(data.endpoint);
            setEndpointLocked(data.endpointLocked === true);
            if (data.endpointDefaults && typeof data.endpointDefaults === "object") {
              setEndpointDefaults({ ...DEFAULT_ENDPOINTS, ...data.endpointDefaults });
            }
            if (typeof data.apiKey === "string") setApiKey(data.apiKey);
            if (typeof data.manualApiKey === "string") setManualApiKey(data.manualApiKey);
            setApiKeyConfigured(data.configured === true);
            setApiKeyFrom(typeof data.apiKeyFrom === "string" ? data.apiKeyFrom : "");
            if (typeof data.proxy === "string") setProxy(data.proxy);
            setProxyLocked(data.proxyLocked === true);
            setConfigSource(typeof data.configSource === "string" ? data.configSource : "");
            setModelWarning(typeof data.modelWarning === "string" ? data.modelWarning : "");
            setModelsApi(data.modelsApi && typeof data.modelsApi === "object" ? data.modelsApi : null);
            if (data.configError) setStatus({ ok: false, msg: data.configError });
          })
          .catch((err) => {
            if (active) setStatus({ ok: false, msg: "读取配置失败: " + err.message });
          })
          .finally(() => {
            if (active) setLoading(false);
          });
        return () => { active = false; };
      }, [rpcCall]);

      /** 切换提供商时，把模型下拉收敛到该提供商（优先决策模型）。 */
      const applyProvider = (id) => {
        setProvider(id);
        const row = providers.find((p) => p.id === id);
        const nextModels = row && Array.isArray(row.models) ? row.models : [];
        const nextDecision = row && Array.isArray(row.decisionModels) ? row.decisionModels : [];
        setModels(nextModels);
        setDecisionModels(nextDecision);
        setModelInfo(row && Array.isArray(row.modelInfo) ? row.modelInfo : []);
        if (row && typeof row.baseURL === "string") setBaseURL(row.baseURL);
        if (nextModels.indexOf("jev-latest") !== -1) setModel("jev-latest");
        else if (nextDecision.length > 0) setModel(nextDecision[0]);
        else if (nextModels.length > 0) setModel(nextModels[0]);
        setModelWarning("");
      };

      /** 切换来源时，端点与接口地址跟随该来源的已保存/默认值（用户显式锁定的除外）。 */
      const switchSource = (next) => {
        const previous = source;
        setSource(next);
        if (!endpointLocked) {
          setEndpoint(endpointDefaults[next] || DEFAULT_ENDPOINTS[next] || DEFAULT_ENDPOINTS.manual);
        }
        if (next === "provider") {
          // 记住手写地址，切回手动配置时恢复，而不是把提供商的地址留在输入框里。
          if (previous === "manual") setManualBaseURL(baseURL);
          const current = providers.find((p) => p.id === provider);
          const id = current ? provider : (providers[0] ? providers[0].id : "");
          if (id) applyProvider(id);
        } else if (previous !== "manual") {
          setBaseURL(manualBaseURL || DEFAULT_BASE_URL);
          // 恢复手写配置自己的 Key 掩码，而不是沿用提供商的 Key 状态。
          setApiKey(manualApiKey || "");
          setApiKeyConfigured(Boolean(manualApiKey));
          setApiKeyFrom("");
        }
        setStatus(null);
      };

      const buildPayload = () => {
        // provider 模式下接口地址与 API Key 都由 dsh 提供商配置决定，界面不提供这两项。
        const payload = { source, endpoint, proxy: proxy.trim() };
        if (source === "provider") {
          payload.provider = provider;
          payload.model = model;
        } else {
          payload.baseURL = baseURL.trim();
          payload.model = model;
          payload.apiKey = apiKey.trim();
        }
        return payload;
      };

      const refresh = () => {
        rpcCall("getConfig", {}).then((data) => {
          if (!data) return;
          if (data.source) setSource(data.source);
          setProviders(Array.isArray(data.providers) ? data.providers : []);
          if (data.provider) setProvider(data.provider);
          setModels(Array.isArray(data.models) ? data.models : []);
          setDecisionModels(Array.isArray(data.decisionModels) ? data.decisionModels : []);
          setModelInfo(Array.isArray(data.modelInfo) ? data.modelInfo : []);
          if (data.model) setModel(data.model);
          if (typeof data.baseURL === "string") setBaseURL(data.baseURL);
          if (typeof data.manualBaseURL === "string" && data.manualBaseURL) setManualBaseURL(data.manualBaseURL);
          if (typeof data.endpoint === "string" && data.endpoint) setEndpoint(data.endpoint);
          if (typeof data.apiKey === "string") setApiKey(data.apiKey);
          if (typeof data.manualApiKey === "string") setManualApiKey(data.manualApiKey);
          setApiKeyConfigured(data.configured === true);
          setApiKeyFrom(typeof data.apiKeyFrom === "string" ? data.apiKeyFrom : "");
          if (typeof data.proxy === "string") setProxy(data.proxy);
          setModelWarning(typeof data.modelWarning === "string" ? data.modelWarning : "");
          setModelsApi(data.modelsApi && typeof data.modelsApi === "object" ? data.modelsApi : null);
        }).catch(() => {});
      };

      const save = async () => {
        if (!rpcCall) return;
        setLoading(true);
        setStatus(null);
        try {
          const res = await rpcCall("saveConfig", buildPayload());
          if (res === true || (res && res.ok !== false)) {
            setStatus({ ok: true, msg: "设置已保存！" });
            refresh();
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
          const res = await rpcCall("testConnection", buildPayload());
          if (res && res.durationMs !== undefined) {
            const target = (res.source === "provider" ? "提供商 " + res.provider + " " : "") +
              (res.baseURL || "") + (res.endpoint || "");
            setStatus({
              ok: true,
              msg: "✓ 连接成功！[" + target + "] 决策模型 " + res.model + " 响应正常（" +
                (res.apiKeyFrom ? "Key 来源：" + res.apiKeyFrom + "， " : "") + res.durationMs + "ms）",
            });
          } else {
            setStatus({ ok: false, msg: "连接失败：" + ((res && res.error) || "未能连通决策接口") });
          }
        } catch (err) {
          setStatus({ ok: false, msg: "测试请求失败：" + err.message });
        } finally {
          setTesting(false);
        }
      };

      const isProvider = source === "provider";
      const keyHint = apiKeyConfigured
        ? "Key 来源：" + (apiKeyFrom || "本地配置") + "。留空保存表示保持原值；清空后保存可删除已存 Key。"
        : "该 Key 只写入本机设置文件，不会进入模型上下文。";
      const providerKeyHint = providers.length === 0
        ? "未在 dsh 模型配置里找到提供商：可切到「手动配置」，或先在 Profile 的 llm-pi-ai 行里添加。"
        : "选中的提供商决定 baseUrl、请求头与 API Key 的来源。" +
          (apiKeyConfigured
            ? " 已从提供商配置解析到 Key。"
            : " 未解析到 Key，请检查该提供商的 apiKeyEnv 或 ~/.dsh/.credentials.yaml。");
      const modelsApiHint = modelsApi && modelsApi.ok === false
        ? "（/v1/models 探测失败：" + (modelsApi.error || "未知错误") + "，已回退到静态识别）"
        : (modelsApi && modelsApi.ok === true &&
            Array.isArray(modelsApi.remoteDecisionModels) && modelsApi.remoteDecisionModels.length > 0
          ? "（/v1/models 额外报告了 " + modelsApi.remoteDecisionModels.length + " 个决策模型：" +
            modelsApi.remoteDecisionModels.join("、") + "）"
          : "");

      return react.createElement("div", { className: "jev-settings" },
        react.createElement("style", null, css),
        react.createElement("h2", null, "决策模型设置"),
        react.createElement("p", { className: "jev-intro" },
          "配置 jev_decide 决策工具使用的接口。可以直接下拉选择 dsh 已配置的提供商与模型，" +
          "也可以手写任意兼容决策协议的服务地址与 API Key。默认为 TypeSafe Jev 官方地址 https://api.typesafe.ai，但不再局限于 TypeSafe。"
        ),
        react.createElement("div", { className: "jev-card" },
          // 来源切换
          react.createElement("label", { className: "jev-field" },
            react.createElement("span", { className: "jev-label" }, "配置来源"),
            react.createElement("select", {
              className: "jev-input",
              value: source,
              onChange: (e) => switchSource(e.target.value),
            },
              react.createElement("option", { value: "manual" }, "手动配置接口地址与 API Key"),
              react.createElement("option", { value: "provider" }, "dsh 已配置的提供商（下拉选择）")
            ),
            react.createElement("p", { className: "jev-hint" },
              isProvider
                ? "列表来自 dsh 自身的模型配置（llm-pi-ai 的 providers），baseUrl、请求头与 Key 都按提供商配置解析。"
                : "默认是 TypeSafe Jev 官方地址；也可填任意兼容 /v1/systemone 或 /v1/decisions 的服务。"
            )
          ),

          isProvider
            ? react.createElement("label", { className: "jev-field" },
              react.createElement("span", { className: "jev-label" }, "提供商"),
              react.createElement("select", {
                className: "jev-input",
                value: provider,
                onChange: (e) => applyProvider(e.target.value),
              }, providerOptions(providers, provider)),
              react.createElement("p", { className: "jev-hint" }, providerKeyHint)
            )
            : null,

          isProvider
            ? null
            : react.createElement("label", { className: "jev-field" },
              react.createElement("span", { className: "jev-label" }, "接口地址"),
              react.createElement("input", {
                className: "jev-input",
                type: "text",
                value: baseURL,
                disabled: baseURLLocked,
                placeholder: DEFAULT_BASE_URL,
                onChange: (e) => setBaseURL(e.target.value),
              }),
              react.createElement("p", { className: "jev-hint" },
                baseURLLocked
                  ? "接口地址已由插件配置（baseURL）固定，如需修改请编辑 Profile 配置后重启。"
                  : "默认为官方地址 https://api.typesafe.ai。可自定义为其它地址，如：本地接口服务地址（http://127.0.0.1:8000）。"
              )
            ),

          isProvider
            ? react.createElement("label", { className: "jev-field" },
              react.createElement("span", { className: "jev-label" },
                "模型",
                modelWarning ? react.createElement("span", { className: "jev-tag muted" }, "不在提供商模型列表") : null
              ),
              react.createElement("select", {
                className: "jev-input",
                value: model,
                onChange: (e) => setModel(e.target.value),
              }, modelOptions(models, decisionModels, model, modelInfo)),
              react.createElement("p", { className: "jev-hint" },
                (decisionModels.length > 0
                  ? "优先展示识别到的决策模型（依据 /v1/models 的 modality、classifier 协议、模型类型与名称）；其它模型也能选，但不保证支持决策协议。"
                  : "该提供商没有识别到决策模型，请确认所选模型支持决策协议。") + modelsApiHint
              )
            )
            : react.createElement("label", { className: "jev-field" },
              react.createElement("span", { className: "jev-label" }, "默认决策模型"),
              react.createElement("input", {
                className: "jev-input",
                type: "text",
                value: model,
                placeholder: "jev-latest",
                onChange: (e) => setModel(e.target.value),
              }),
              react.createElement("p", { className: "jev-hint" },
                "模型 ID，默认 jev-latest；以其它服务为准，例如自定义部署的决策模型名。"
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
              react.createElement("option", { value: "/v1/systemone" }, "/v1/systemone（官方原生协议）"),
              react.createElement("option", { value: "/v1/decisions" }, "/v1/decisions（兼容 OpenAI）")
            ),
            react.createElement("p", { className: "jev-hint" },
              endpointLocked
                ? "接口端点已由插件配置（endpoint）固定，如需修改请编辑 Profile 配置后重启。"
                : (isProvider
                  ? "默认为 /v1/decisions（dsh 提供商通常是 OpenAI 兼容网关）；若提供商直接暴露官方原生协议，可切回 /v1/systemone。"
                  : "默认为 /v1/systemone。如对接兼容 OpenAI 决策协议的本地或第三方服务，可切换为 /v1/decisions。")
            )
          ),

          isProvider
            ? null
            : react.createElement("label", { className: "jev-field" },
              react.createElement("span", { className: "jev-label" },
                "API Key",
                apiKeyConfigured
                  ? react.createElement("span", { className: "jev-tag" }, "已配置")
                  : null
              ),
              react.createElement("input", {
                className: "jev-input",
                type: "password",
                value: apiKey,
                placeholder: apiKeyConfigured ? "已保存（留空表示不修改）" : "ts-...",
                onChange: (e) => setApiKey(e.target.value),
              }),
              react.createElement("p", { className: "jev-hint" }, keyHint)
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
                : "留空表示直连。填写后，发往代理范围内主机的请求将全部经该代理转发。" +
                  "支持 http://、https://、socks5://、socks5h://；需要认证时写成 http://user:password@host:port。"
            )
          ),

          configSource
            ? react.createElement("p", { className: "jev-hint" }, "配置来源：" + configSource)
            : null,

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

    function IconDecision16({ size = 16 }) {
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
        react.createElement("circle", { cx: "8", cy: "3", r: "1.6" }),
        react.createElement("path", { d: "M8 4.6v2.2" }),
        react.createElement("path", { d: "M8 6.8 4.2 9.4" }),
        react.createElement("path", { d: "M8 6.8 11.8 9.4" }),
        react.createElement("circle", { cx: "4.2", cy: "11", r: "1.5" }),
        react.createElement("circle", { cx: "11.8", cy: "11", r: "1.5" })
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
        throw new Error(result?.error?.message || (typeof result?.error === "string" ? result.error : "请求失败"));
      };

      const label = () => react.createElement("span", {
        "data-settings-nav-label": "dsh-jev",
        style: { display: "inline-flex", alignItems: "center", gap: 8 },
      },
        react.createElement(IconDecision16, { size: 16 }),
        react.createElement("span", null, "决策模型")
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
