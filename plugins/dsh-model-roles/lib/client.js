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
  id: "dsh-model-roles",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const { IconBranchOutline16 } = require("@deepseek-ai/dsh-client-ui-primitives");

    const NS = "model-roles";
    const SETTINGS_RPC_CHANNEL = "/model-roles-settings";
    const SETTINGS_SLOT = "settings.section";
    const NAV_STYLE_ID = "dsh-model-roles-nav-styles";
    const OMP_ROLES = ["default", "smol", "slow", "vision", "plan", "designer", "commit", "tiny", "task", "advisor"];
    const BUILTIN = OMP_ROLES.filter((role) => role !== "default");
    const ROLE_PATTERN = /^[a-z][a-z0-9_-]*$/;
    const inject = ["slots", "connection", "remote"];
    const copy = {
      smol: { title: "快速", detail: "自动用于短小、机械、低风险、适合低成本模型的任务。" },
      slow: { title: "深度", detail: "自动用于复杂推理、疑难调试、架构、研究或高风险正确性任务。" },
      vision: { title: "识图", detail: "图片会交给一次性识图子代理分析，结果以文本带回主会话，避免主角色长期占用识图模型。" },
      plan: { title: "计划", detail: "会话进入 /plan 后自动使用；未配置时使用当前会话模型。" },
      designer: { title: "设计", detail: "自动用于 UI、UX、视觉、交互、布局、样式和产品设计任务。" },
      commit: { title: "提交", detail: "自动用于提交信息生成及提交专用分析。" },
      tiny: { title: "轻量后台", detail: "用于自动任务分类、会话标题和压缩等 DSH 后台调用。" },
      task: { title: "任务", detail: "DSH 委派创建的子代理自动使用；未配置时使用当前会话模型。" },
      advisor: { title: "顾问", detail: "顾问复核开启后，DSH 会启动独立子代理评审每个已完成回合，并将重要建议送回主会话。" },
    };
    const INTRO_TEXT = "系统会自动为任务选择合适模型；未命中已配置角色时使用当前会话选择的模型。";
    const ADVISOR_HELP_TEXT = "请先为顾问选择模型。";
    const css = `
      .mr-page{display:flex;flex-direction:column;gap:14px;width:100%;max-width:780px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);color-scheme:light dark}
      .mr-page h2,.mr-page h3,.mr-page p{margin:0}.mr-page h2{font:var(--dsw-font-l-20)}.mr-intro{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-s-14);line-height:20px}
      .mr-list{display:flex;flex-direction:column;gap:10px}.mr-card{display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-l,12px);background:var(--dsw-alias-background-base,var(--dsw-alias-bg-module-platform))}
      .mr-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.mr-title{font:var(--dsw-font-m-16);font-weight:600}.mr-detail{margin-top:3px!important;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.mr-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(150px,1fr);gap:10px}
      .mr-field{display:flex;flex-direction:column;gap:5px}.mr-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500}.mr-select,.mr-input{box-sizing:border-box;width:100%;height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:8px;outline:none;background:var(--dsw-alias-background-base,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
      .mr-select:focus-visible,.mr-input:focus-visible{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 18%,transparent)}.mr-select:disabled,.mr-input:disabled{opacity:.55}
      .mr-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px}.mr-button{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 14px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:18px;background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);cursor:pointer}.mr-button:disabled{cursor:default;opacity:.45}.mr-primary{border-color:transparent;background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff}.mr-danger{color:var(--dsw-alias-state-error-primary)}
      .mr-feedback{padding:9px 11px;border-radius:8px;font-size:12px;line-height:18px}.mr-feedback.mr-error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 10%,transparent);color:var(--dsw-alias-state-error-primary,#d84848)}.mr-status{min-height:18px;color:var(--dsw-alias-label-tertiary);font-size:12px}.mr-warning{padding:9px 11px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d98e00) 10%,transparent);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
      .mr-advisor{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.mr-check{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:13px}
      @media(max-width:640px){.mr-grid,.mr-advisor{grid-template-columns:1fr}.mr-card-head{flex-direction:column}.mr-actions{justify-content:stretch}.mr-button{flex:1}}
    `;
    const navCss = 'button:has([data-settings-nav-label="model-roles"]) > svg:first-child{display:none}';

    function modelKey(provider, model) { return JSON.stringify([provider, model]); }
    function parseModelKey(value) {
      if (!value) return null;
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) && parsed.length === 2 ? { provider: parsed[0], model: parsed[1] } : null;
      } catch { return null; }
    }
    function normalizeRole(value) { return String(value || "").trim().toLowerCase(); }
    function configurableRoutes(roles) {
      return (roles || []).filter((route) => normalizeRole(route?.role) !== "default");
    }
    function rowsFromGroups(groups) {
      return groups.flatMap((group) => group.models.map((model) => ({ group, model })));
    }
    function routeMap(roles) { return new Map((roles || []).map((route) => [route.role, route])); }
    function validateRoles(roles) {
      const seen = new Set();
      for (const route of roles) {
        const role = normalizeRole(route.role);
        if (!ROLE_PATTERN.test(role)) return `角色 ID“${route.role}”格式无效`;
        if (role === "default") return "默认模型由当前会话选择，无需配置";
        if (seen.has(role)) return `角色 ID“${role}”重复`;
        seen.add(role);
        if (!route.provider || !route.model) return `角色“${role}”尚未选择模型`;
      }
      return "";
    }
    function statusMessage(status, writable, dirty) {
      if (status === "loading") return "正在读取模型与角色配置…";
      if (!writable) return "当前设置文档为只读。";
      if (dirty) return "有未保存的更改。";
      return "";
    }
    function createSettingsRequest(connectionRpc, defaultApi) {
      return async (method, payload = {}, api = defaultApi) => {
        try {
          const result = await connectionRpc.call(SETTINGS_RPC_CHANNEL, method, payload);
          if (result && result.ok === true) return result.value;
          throw new Error(result?.error?.message || "模型角色设置请求失败");
        } catch (error) {
          if (!/HTTP 403\b/.test(error instanceof Error ? error.message : String(error)) || !api?.settings) {
            throw error;
          }
          if (method === "describe") {
            const desc = await api.settings.describe({});
            if (!desc.result.ok) throw new Error(desc.result.error.message);
            const entry = (desc.result.value.namespaces || []).find((n) => n.ns === NS);
            return {
              writable: desc.result.value.writable,
              value: entry?.value || { roles: [] },
              revision: entry?.revision || 0,
            };
          }
          if (method === "replace") {
            const resp = await api.settings.replace({
              ns: NS,
              section: payload.section,
              expectedRevision: payload.expectedRevision,
            });
            if (!resp.result.ok) throw new Error(resp.result.error.message);
            return {
              writable: true,
              value: resp.result.value.value || { roles: [] },
              revision: resp.result.value.revision || 0,
            };
          }
          throw error;
        }
      };
    }

    function RoleCard(props) {
      const {
        role, customRole, route, modelRows, groups, saving,
        onSetRoute, onChangeModel, onRenameCustom,
      } = props;
      const selected = route ? modelRows.find(({ group, model }) => group.id === route.provider && model.id === route.model) : null;
      const efforts = selected?.model?.reasoning?.efforts || [];
      const title = customRole ? "Preset" : copy[role].title;
      const detail = customRole ? "当 Agent Preset ID 与此角色 ID 相同时自动使用。" : copy[role].detail;
      const modelOptions = groups.map((group) => react.createElement("optgroup", { label: group.name, key: group.id },
        ...group.models.map((model) => {
          const visionUnsupported = role === "vision" && Array.isArray(model.inputModalities) && !model.inputModalities.includes("image");
          return react.createElement("option", {
            key: model.id, value: modelKey(group.id, model.id), disabled: visionUnsupported,
          }, visionUnsupported ? `${model.name}（不支持图片）` : model.name);
        })));
      const effortOptions = efforts.map((effort) => react.createElement("option", {
        key: effort.id, value: effort.id,
      }, effort.name));
      return react.createElement("section", { className: "mr-card", key: role },
        react.createElement("div", { className: "mr-card-head" },
          react.createElement("div", null,
            react.createElement("h3", { className: "mr-title" }, title),
            react.createElement("p", { className: "mr-detail" }, detail)),
          customRole ? react.createElement("button", { className: "mr-button mr-danger", type: "button", disabled: saving, onClick: () => onSetRoute(role, null) }, "删除") : null),
        customRole ? react.createElement("label", { className: "mr-field" },
          react.createElement("span", { className: "mr-label" }, "角色 ID（须与 Agent Preset ID 一致）"),
          react.createElement("input", { className: "mr-input", value: role, disabled: saving, onChange: (event) => onRenameCustom(role, event.target.value), "aria-label": `${role} 角色 ID` })) : null,
        react.createElement("div", { className: "mr-grid" },
          react.createElement("label", { className: "mr-field" },
            react.createElement("span", { className: "mr-label" }, "模型"),
            react.createElement("select", {
              className: "mr-select", value: route ? modelKey(route.provider, route.model) : "", disabled: saving,
              onChange: (event) => onChangeModel(role, event.target.value), "aria-label": `${role} 模型`,
            },
            react.createElement("option", { value: "" }, role === "tiny" ? "继承快速角色 / 使用会话模型" : "使用当前会话模型"),
            ...modelOptions)),
          react.createElement("label", { className: "mr-field" },
            react.createElement("span", { className: "mr-label" }, "思考档位"),
            react.createElement("select", {
              className: "mr-select", value: route?.reasoningEffort || "", disabled: !route || efforts.length === 0 || saving,
              onChange: (event) => onSetRoute(role, { reasoningEffort: event.target.value }), "aria-label": `${role} 思考档位`,
            },
            react.createElement("option", { value: "" }, "模型默认"),
            ...effortOptions))));
    }

    function apply(ctx) {
      if (typeof document !== "undefined" && !document.getElementById(NAV_STYLE_ID)) {
        const style = document.createElement("style");
        style.id = NAV_STYLE_ID;
        style.textContent = navCss;
        document.head.appendChild(style);
      }
      const settingsRequest = createSettingsRequest(ctx.connection.rpc, ctx.connection.api);
      function ModelRolesSettings(props) {
        const [status, setStatus] = react.useState("loading");
        const [error, setError] = react.useState("");
        const [writable, setWritable] = react.useState(false);
        const [revision, setRevision] = react.useState(0);
        const [groups, setGroups] = react.useState([]);
        const [failures, setFailures] = react.useState([]);
        const [roles, setRoles] = react.useState([]);
        const [advisor, setAdvisor] = react.useState({ enabled: false, subagents: false, provider: "spawn", maxTranscriptChars: 60000 });
        const [saved, setSaved] = react.useState("");
        const [saving, setSaving] = react.useState(false);
        const dirtyRef = react.useRef(false);

        const load = async (silent = false) => {
          if (!silent) {
            setStatus("loading");
            setError("");
          }
          try {
            // DSH >= 0.1.2-rc.1 removed connection.api; the model catalog moved to
            // the typed remote namespace (session.modelCatalog). Older deployments
            // that still expose connection.api.llm.models keep the legacy path.
            const catalogPromise = ctx.remote?.session?.modelCatalog
              ? ctx.remote.session.modelCatalog()
              : props.api?.llm?.models({});
            const [settingsView, modelsResponse] = await Promise.all([
              settingsRequest("describe", {}, props.api), catalogPromise,
            ]);
            const modelsValue = modelsResponse.ok === true
              ? modelsResponse.value
              : modelsResponse.result?.ok === true ? modelsResponse.result.value : null;
            if (!modelsValue) {
              const detail = modelsResponse.ok === false
                ? modelsResponse.error?.message
                : modelsResponse.result?.error?.message;
              throw new Error(detail || "模型目录请求失败");
            }
            const next = configurableRoutes(settingsView.value?.roles).map((route) => ({ ...route }));
            const nextAdvisor = {
              enabled: false, subagents: false, provider: "spawn", maxTranscriptChars: 60000,
              ...(settingsView.value?.advisor || {}),
            };
            setWritable(settingsView.writable);
            setRevision(settingsView.revision);
            setGroups(modelsValue.groups || []);
            setFailures(modelsValue.failures || []);
            if (!silent || !dirtyRef.current) {
              setRoles(next);
              setAdvisor(nextAdvisor);
              setSaved(JSON.stringify({ roles: next, advisor: nextAdvisor }));
            }
            setStatus("ready");
          } catch (cause) {
            if (!silent) {
              setStatus("error");
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          }
        };

        react.useEffect(() => {
          let active = true;
          const reload = () => { if (active) void load(true); };
          void load(false);
          const stops = [
            ctx.remote.$on("llm/adapters-updated", reload),
            ctx.remote.$on("settings/document-updated", (ns) => { if (ns === NS) reload(); }),
          ];
          return () => { active = false; for (const stop of stops) stop(); };
        }, []);

        const byRole = routeMap(roles);
        const custom = roles.filter((route) => !BUILTIN.includes(route.role));
        const modelRows = rowsFromGroups(groups);
        const dirty = JSON.stringify({ roles, advisor }) !== saved;
        dirtyRef.current = dirty;
        const validation = validateRoles(roles);
        const feedback = error || validation;
        const statusText = statusMessage(status, writable, dirty);

        const setRoute = (role, patch) => {
          setRoles((current) => {
            const index = current.findIndex((entry) => entry.role === role);
            if (patch === null) return current.filter((entry) => entry.role !== role);
            const previous = index < 0 ? { role, provider: "", model: "", reasoningEffort: "" } : current[index];
            const next = { ...previous, ...patch, role };
            if (index < 0) return [...current, next];
            return current.map((entry, at) => at === index ? next : entry);
          });
        };

        const changeModel = (role, value) => {
          const selected = parseModelKey(value);
          if (!selected) { setRoute(role, null); return; }
          const row = modelRows.find(({ group, model }) => group.id === selected.provider && model.id === selected.model);
          setRoute(role, {
            provider: selected.provider,
            model: selected.model,
            reasoningEffort: row?.model?.reasoning?.defaultEffort || "",
          });
        };

        const addPreset = () => {
          let suffix = 1;
          while (byRole.has(`preset-${suffix}`)) suffix++;
          setRoles((current) => [...current, { role: `preset-${suffix}`, provider: "", model: "", reasoningEffort: "" }]);
        };

        const renameCustom = (oldRole, nextValue) => {
          const nextRole = normalizeRole(nextValue);
          setRoles((current) => current.map((entry) => entry.role === oldRole ? { ...entry, role: nextRole } : entry));
        };

        const save = async () => {
          if (validation || !dirty || !writable) return;
          setSaving(true);
          setError("");
          try {
            const normalized = configurableRoutes(roles).map((route) => ({
              role: normalizeRole(route.role), provider: route.provider, model: route.model,
              reasoningEffort: route.reasoningEffort || "",
            }));
            await settingsRequest("replace", {
              section: { roles: normalized, advisor }, expectedRevision: revision,
            }, props.api);
            await load(false);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          } finally { setSaving(false); }
        };

        return react.createElement("div", { className: "mr-page" },
          react.createElement("style", null, css),
          react.createElement("h2", null, "模型角色"),
          react.createElement("p", { className: "mr-intro" }, INTRO_TEXT),
          feedback ? react.createElement("div", { className: "mr-feedback mr-error", role: "alert" }, feedback) : null,
          react.createElement("section", { className: "mr-card" },
            react.createElement("div", null,
              react.createElement("h3", { className: "mr-title" }, "顾问复核运行时"),
              react.createElement("p", { className: "mr-detail" }, ADVISOR_HELP_TEXT)),
            react.createElement("div", { className: "mr-advisor" },
              react.createElement("label", { className: "mr-check" },
                react.createElement("input", { type: "checkbox", checked: advisor.enabled, disabled: saving, onChange: (event) => setAdvisor((current) => ({ ...current, enabled: event.target.checked })) }),
                "默认开启每回合复核"),
              react.createElement("label", { className: "mr-check" },
                react.createElement("input", { type: "checkbox", checked: advisor.subagents, disabled: saving, onChange: (event) => setAdvisor((current) => ({ ...current, subagents: event.target.checked })) }),
                "同时复核任务子代理"),
              react.createElement("label", { className: "mr-field" },
                react.createElement("span", { className: "mr-label" }, "DSH 子代理 Provider"),
                react.createElement("input", { className: "mr-input", value: advisor.provider, disabled: saving, onChange: (event) => setAdvisor((current) => ({ ...current, provider: event.target.value })) })),
              react.createElement("label", { className: "mr-field" },
                react.createElement("span", { className: "mr-label" }, "送审上下文字符上限"),
                react.createElement("input", { className: "mr-input", type: "number", min: 1000, max: 1000000, step: 1000, value: advisor.maxTranscriptChars, disabled: saving, onChange: (event) => setAdvisor((current) => ({ ...current, maxTranscriptChars: Math.min(1000000, Math.max(1000, Number(event.target.value) || 60000)) })) })))),
          failures.length ? react.createElement("div", { className: "mr-warning" }, `有 ${failures.length} 个模型 Provider 目录加载失败；其余 Provider 仍可配置。`) : null,
          react.createElement("div", { className: "mr-list" },
            ...BUILTIN.map((role) => react.createElement(RoleCard, {
              key: role,
              role,
              customRole: false,
              route: byRole.get(role),
              modelRows,
              groups,
              saving,
              onSetRoute: setRoute,
              onChangeModel: changeModel,
              onRenameCustom: renameCustom,
            })),
            ...custom.map((route) => react.createElement(RoleCard, {
              key: route.role,
              role: route.role,
              customRole: true,
              route,
              modelRows,
              groups,
              saving,
              onSetRoute: setRoute,
              onChangeModel: changeModel,
              onRenameCustom: renameCustom,
            }))),
          react.createElement("div", { className: "mr-actions" },
            react.createElement("button", { className: "mr-button", type: "button", disabled: saving || !writable, onClick: addPreset }, "添加 Preset"),
            react.createElement("button", { className: "mr-button", type: "button", disabled: saving || !dirty, onClick: () => load(false) }, "撤销"),
            react.createElement("button", { className: "mr-button mr-primary", type: "button", disabled: saving || !writable || !dirty || Boolean(validation), onClick: save }, saving ? "保存中…" : "保存")),
          statusText ? react.createElement("p", { className: "mr-status", role: "status", "aria-live": "polite" }, statusText) : null);
      }

      const label = () => react.createElement("span", {
        "data-settings-nav-label": "model-roles",
        className: "mr-nav-label",
        style: { display: "inline-flex", alignItems: "center", gap: 8 },
      },
        react.createElement(IconBranchOutline16, { size: 16 }),
        react.createElement("span", null, "模型角色"));
      ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({
        name: SETTINGS_SLOT, id: "model-roles", order: 24, label,
        inject: () => ({ api: ctx.connection.api }),
      }, ModelRolesSettings));
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.internals = { OMP_ROLES, BUILTIN, ROLE_PATTERN, SETTINGS_RPC_CHANNEL, SETTINGS_SLOT, NAV_STYLE_ID, navCss, copy, INTRO_TEXT, ADVISOR_HELP_TEXT, modelKey, parseModelKey, normalizeRole, configurableRoutes, rowsFromGroups, routeMap, validateRoles, statusMessage, css, createSettingsRequest, RoleCard };
    return module.exports;
  }
});
