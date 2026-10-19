(function () {
  window.__ModuleLoader__.load({
    id: "@weniatall/dsh-task-models",
    factory: (require) => {
      var module = { exports: {} };
      var exports = module.exports;
      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
      const react = require("react");

      const NS = "task-models";
      const SETTINGS_RPC_CHANNEL = "/task-models-settings";
      const SETTINGS_SLOT = "settings.section";
      const NAV_STYLE_ID = "dsh-task-models-nav-styles";
      const FALLBACKS = ["taskRole", "llm"];
      const TASK_TEMPLATES = [
        { id: "explore", name: "探索与检索", detail: "搜索代码、定位实现、阅读上下文、收集事实。", keywords: ["搜索", "查找", "定位", "阅读", "explore", "search", "find", "locate", "grep", "read"] },
        { id: "implement", name: "实现与修改", detail: "编写或修改代码、修复缺陷、重构。", keywords: ["实现", "修改", "编写", "修复", "重构", "implement", "fix", "refactor", "code", "edit"] },
        { id: "review", name: "审查与复核", detail: "代码审查、正确性检查、安全与质量复核。", keywords: ["审查", "复核", "检查", "评审", "review", "audit", "verify", "check"] },
        { id: "test", name: "测试与验证", detail: "编写或运行测试、复现问题、验证行为。", keywords: ["测试", "验证", "复现", "test", "verify", "reproduce"] },
        { id: "research", name: "调研与分析", detail: "方案对比、资料调研、架构分析、取舍评估。", keywords: ["调研", "研究", "分析", "对比", "架构", "research", "analyze", "compare", "investigate"] },
        { id: "docs", name: "文档与说明", detail: "编写文档、注释、README、变更说明。", keywords: ["文档", "注释", "说明", "doc", "docs", "readme", "comment"] },
      ];
      const RESERVED_IDS = new Set(["default", "task", "general"]);
      const DEFAULT_ROUTING = {
        enabled: false,
        fallback: "taskRole",
        useJev: true,
        respectExplicitChildModel: true,
        decisionTimeoutMs: 5000,
        classifier: { provider: "", model: "", reasoningEffort: "" },
      };
      const DEFAULT_JEV = {
        enabled: false,
        baseURL: "https://api.typesafe.ai",
        model: "jev-latest",
        minConfidence: 0.6,
        timeoutMs: 3000,
        maxStateChars: 8000,
      };
      const INTRO_TEXT = "为不同类型的子任务选择不同模型；未命中时保持当前路由。";
      const css = `
        .tm-page{display:flex;flex-direction:column;gap:14px;width:100%;max-width:820px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);color-scheme:light dark}
        .tm-page h2,.tm-page h3,.tm-page p{margin:0}.tm-page h2{font:var(--dsw-font-l-20)}.tm-intro{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-s-14);line-height:20px}
        .tm-list{display:flex;flex-direction:column;gap:10px}.tm-card{display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-l,12px);background:var(--dsw-alias-background-base,var(--dsw-alias-bg-module-platform))}
        .tm-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.tm-title{font:var(--dsw-font-m-16);font-weight:600}.tm-detail{margin-top:3px!important;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
        .tm-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.tm-field{display:flex;flex-direction:column;gap:5px}.tm-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500}
        .tm-select,.tm-input{box-sizing:border-box;width:100%;height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:8px;outline:none;background:var(--dsw-alias-background-base,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
        .tm-select:focus-visible,.tm-input:focus-visible{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 18%,transparent)}.tm-select:disabled,.tm-input:disabled{opacity:.55}
        .tm-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px}.tm-button{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 14px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:18px;background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);cursor:pointer}.tm-button:disabled{cursor:default;opacity:.45}.tm-primary{border-color:transparent;background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff}.tm-danger{color:var(--dsw-alias-state-error-primary)}
        .tm-feedback{padding:9px 11px;border-radius:8px;font-size:12px;line-height:18px}.tm-feedback.tm-error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 10%,transparent);color:var(--dsw-alias-state-error-primary,#d84848)}.tm-feedback.tm-warn{background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d98e00) 12%,transparent);color:var(--dsw-alias-state-warning-primary,#d98e00);display:flex;align-items:center;justify-content:space-between;gap:8px}.tm-status{min-height:18px;color:var(--dsw-alias-label-tertiary);font-size:12px}
        .tm-preview-result{padding:10px 12px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 8%,transparent);font-size:12px;line-height:20px;display:flex;flex-direction:column;gap:4px}
        .tm-textarea{box-sizing:border-box;width:100%;min-height:72px;padding:8px 10px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:8px;outline:none;background:var(--dsw-alias-background-base,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);resize:vertical}
        .tm-textarea:focus-visible{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 18%,transparent)}.tm-textarea:disabled{opacity:.55}
        .tm-check{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:13px}.tm-note{padding:9px 11px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 7%,transparent);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
        .tm-grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}.tm-field-actions{justify-content:flex-end}.tm-actions-left{justify-content:flex-start}
        .tm-badge{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;font-size:11px;font-weight:510;white-space:nowrap;flex:none}
        .tm-badge-ok{color:var(--dsw-alias-state-success-primary,#22c55e);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 12%,transparent)}
        .tm-badge-warn{color:var(--dsw-alias-state-warning-primary,#d98e00);background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d98e00) 12%,transparent)}
        .tm-jev-status{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.tm-jev-status.tm-ok{color:var(--dsw-alias-state-success-primary,#22c55e)}.tm-jev-status.tm-warn{color:var(--dsw-alias-state-warning-primary,#d98e00)}
        .tm-wf-root{width:100%;min-width:0;display:flex;flex-direction:column;gap:2px}
        .tm-wf-header{box-sizing:border-box;width:100%;min-width:0;height:32px;padding:0 8px;border:0;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:6px;text-align:left;font:inherit;cursor:pointer}
        .tm-wf-header:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}
        .tm-wf-chevron{width:16px;flex:none;display:inline-flex;align-items:center;justify-content:center;color:inherit;font-size:11px}
        .tm-wf-title{max-width:42%;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dsh-content-font-size-secondary,13px);font-weight:510}
        .tm-wf-summary{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dsh-content-font-size-secondary,13px);color:var(--dsw-alias-label-tertiary)}
        .tm-wf-status{flex:none;white-space:nowrap;font-size:11px;font-weight:510;color:var(--dsw-alias-label-secondary)}
        .tm-wf-status.tm-wf-running{color:var(--dsw-alias-state-business-primary,#4d6bfe)}.tm-wf-status.tm-wf-failed{color:var(--dsw-alias-state-error-primary,#d84848)}.tm-wf-status.tm-wf-completed{color:var(--dsw-alias-state-success-primary,#22c55e)}
        .tm-wf-phase-list{display:flex;flex-direction:column;gap:4px;min-width:0;padding:4px 0 0 16px}
        .tm-wf-phase{min-width:0}
        .tm-wf-phase-header{box-sizing:border-box;width:100%;min-width:0;height:32px;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:6px;text-align:left;font:inherit;cursor:pointer}
        .tm-wf-phase-title{min-width:0;max-width:42%;flex:0 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dsh-content-font-size-secondary,13px)}
        .tm-wf-phase-count{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dsh-content-font-size-secondary,13px);color:var(--dsw-alias-label-tertiary)}
        .tm-wf-phase-status{flex:none;white-space:nowrap;font-size:var(--dsh-content-font-size-secondary,13px);color:var(--dsw-alias-label-secondary);text-align:right}
        .tm-wf-members{display:flex;flex-direction:column;gap:2px;min-width:0;padding:0 0 0 16px}
        .tm-wf-member{box-sizing:border-box;width:100%;min-width:0;min-height:24px;display:flex;align-items:center;gap:8px;padding:0 0 0 2px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);text-align:left;font:inherit}
        .tm-wf-member.tm-wf-clickable{cursor:pointer;border-radius:var(--dsw-radius-sm)}.tm-wf-member.tm-wf-clickable:hover .tm-wf-label{text-decoration:underline dotted;text-underline-offset:3px}
        .tm-wf-dot{width:10px;height:10px;flex:none;border-radius:50%;border:1.5px solid var(--dsw-alias-label-tertiary);box-sizing:border-box}
        .tm-wf-dot.tm-wf-running{border-color:var(--dsw-alias-state-business-primary,#4d6bfe);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 20%,transparent)}
        .tm-wf-dot.tm-wf-completed{border-color:var(--dsw-alias-state-success-primary,#22c55e);background:var(--dsw-alias-state-success-primary,#22c55e)}
        .tm-wf-dot.tm-wf-failed{border-color:var(--dsw-alias-state-error-primary,#d84848);background:var(--dsw-alias-state-error-primary,#d84848)}
        .tm-wf-dot.tm-wf-cancelled,.tm-wf-dot.tm-wf-interrupted{border-color:var(--dsw-alias-state-warning-primary,#d98e00)}
        .tm-wf-label{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dsh-content-font-size,14px);color:var(--dsw-alias-label-secondary);padding:0 2px}
        .tm-wf-model{max-width:46%;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 6px;border-radius:999px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-secondary) 9%,transparent);font-family:var(--dsw-font-family-mono,monospace)}
        .tm-wf-model.tm-wf-model-pending{opacity:.6;font-family:inherit}
        .tm-wf-member-status{width:64px;flex:none;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dsh-content-font-size-secondary,13px);color:var(--dsw-alias-label-secondary)}
        .tm-wf-empty{padding:0;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px)}
        @media(max-width:640px){.tm-grid,.tm-grid-3{grid-template-columns:1fr}.tm-card-head{flex-direction:column}.tm-actions{justify-content:stretch}.tm-button{flex:1}.tm-wf-phase-list,.tm-wf-members{padding-left:12px}.tm-wf-model{max-width:38%}}
      `;
      const navCss = 'button:has([data-settings-nav-label="task-models"]) > svg:first-child{display:none}';

      function modelKey(provider, model) { return JSON.stringify([provider, model]); }
      function parseModelKey(value) {
        if (!value) return null;
        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) && parsed.length === 2 ? { provider: parsed[0], model: parsed[1] } : null;
        } catch { return null; }
      }
      function normalizeId(value) { return String(value || "").trim().toLowerCase(); }
      function splitKeywords(value) {
        return String(value || "").split(/[,，]/u).map((entry) => entry.trim()).filter(Boolean);
      }
      function normalizeKeywords(value) {
        const seen = new Set();
        const out = [];
        for (const entry of Array.isArray(value) ? value : splitKeywords(value)) {
          if (typeof entry !== "string") continue;
          const keyword = entry.trim();
          if (keyword === "" || seen.has(keyword.toLowerCase())) continue;
          seen.add(keyword.toLowerCase());
          out.push(keyword);
        }
        return out;
      }
      function rowsFromGroups(groups) {
        return groups.flatMap((group) => group.models.map((model) => ({ group, model })));
      }
      function taskTemplateOf(id) {
        return TASK_TEMPLATES.find((template) => template.id === normalizeId(id));
      }
      function profileDefaults(id) {
        const template = taskTemplateOf(id);
        return template
          ? { id: template.id, name: template.name, detail: template.detail, keywords: [...template.keywords], provider: "", model: "", reasoningEffort: "", enabled: true }
          : { id: normalizeId(id), name: normalizeId(id), detail: "", keywords: [], provider: "", model: "", reasoningEffort: "", enabled: true };
      }
      function normalizeProfile(row) {
        const id = normalizeId(row?.id);
        const defaults = profileDefaults(id);
        return {
          ...defaults,
          ...row,
          id,
          name: typeof row?.name === "string" ? row.name : defaults.name,
          detail: typeof row?.detail === "string" ? row.detail : defaults.detail,
          keywords: normalizeKeywords(row?.keywords ?? defaults.keywords),
          provider: typeof row?.provider === "string" ? row.provider : "",
          model: typeof row?.model === "string" ? row.model : "",
          reasoningEffort: typeof row?.reasoningEffort === "string" ? row.reasoningEffort : "",
          enabled: row?.enabled !== false,
        };
      }
      function normalizeProfiles(rows) {
        return (Array.isArray(rows) ? rows : []).map(normalizeProfile);
      }
      function profilesById(rows) {
        return new Map((rows || []).map((row) => [normalizeId(row.id), row]));
      }
      function validateRouting(routing) {
        if (!FALLBACKS.includes(routing?.fallback)) return "子任务回退方式无效";
        if (routing?.decisionTimeoutMs !== undefined && routing?.decisionTimeoutMs !== null) {
          const ms = Number(routing.decisionTimeoutMs);
          if (!Number.isInteger(ms) || ms < 100 || ms > 60000) return "决策总超时须在 100 到 60000 毫秒之间";
        }
        const classifier = routing?.classifier || {};
        if ((classifier.provider === "") !== (classifier.model === "")) return "轻量分类模型需要同时选择 Provider 与模型";
        return "";
      }
      function buildDraftSection(draft) {
        const routing = draft?.routing;
        const profiles = draft?.profiles;
        const jev = draft?.jev;
        const normalizedProfiles = (Array.isArray(profiles) ? profiles : []).map((row) => ({
          id: normalizeId(row.id),
          name: row.name || "",
          detail: row.detail || "",
          keywords: normalizeKeywords(row.keywords),
          provider: row.provider,
          model: row.model,
          reasoningEffort: row.reasoningEffort || "",
          enabled: row.enabled !== false,
        }));
        const normJev = normalizeJev(jev);
        return {
          routing: {
            ...DEFAULT_ROUTING,
            ...(routing || {}),
            decisionTimeoutMs: clampNumber(Math.round(Number(routing?.decisionTimeoutMs) || DEFAULT_ROUTING.decisionTimeoutMs), DEFAULT_ROUTING.decisionTimeoutMs, 100, 60000),
            classifier: { ...DEFAULT_ROUTING.classifier, ...(routing?.classifier || {}) },
          },
          profiles: normalizedProfiles,
          jev: {
            enabled: normJev.enabled === true,
            baseURL: normJev.baseURL,
            model: normJev.model,
            minConfidence: clampNumber(normJev.minConfidence, DEFAULT_JEV.minConfidence, 0, 1),
            timeoutMs: clampNumber(normJev.timeoutMs, DEFAULT_JEV.timeoutMs, 100, 60000),
            maxStateChars: clampNumber(normJev.maxStateChars, DEFAULT_JEV.maxStateChars, 500, 100000),
          },
        };
      }
      function reconcileSettings({
        currentRevision,
        currentWritable,
        remoteRevision,
        remoteWritable,
        silent,
        dirty,
      }) {
        if (silent && dirty) {
          const conflict = remoteRevision !== currentRevision;
          return {
            conflict,
            revision: currentRevision,
            writable: currentWritable,
            shouldApplyRemote: false,
          };
        }
        return {
          conflict: false,
          revision: remoteRevision,
          writable: remoteWritable,
          shouldApplyRemote: !silent || !dirty,
        };
      }
      function formatRoutingDetail(reason) {
        const REASONS = {
          "rules-explicit-label": "规则匹配（显式标签）",
          "rules-keywords": "规则匹配（关键词）",
          "rules-unmatched": "规则未命中",
          "jev-selected": "Jev 决策",
          "llm-selected": "轻量模型分类",
          "no-match": "无规则命中",
          "rules-tie": "规则冲突平局",
          "classifier-unconfigured": "分类模型未配置",
          "jev-low-confidence": "Jev 置信度不足",
          "jev-invalid-response": "Jev 响应无效",
          "jev-unavailable": "Jev 服务不可用",
          "classifier-failed": "轻量模型分类失败",
          "decision-timeout": "决策超时",
          "route-unusable": "目标路由不可用",
          "explicit-child-model": "子代理指定模型",
          "routing-disabled": "任务路由已禁用",
          "no-profiles": "未配置任务模型",
          "internal-role": "内部角色",
          "plan-mode": "计划模式",
          "existing-request": "已有会话延续",
          "no-task": "无任务内容",
        };
        return (reason && REASONS[reason]) || (reason ? String(reason) : "原因未知");
      }
      function formatMemberTitle({ info, detail, pending }) {
        const effective = detail?.effectiveRoute || info;
        const hasEffectiveModel = Boolean(effective?.model);
        if (pending && !hasEffectiveModel && !detail) return "等待子代理首次请求";
        const parts = [];
        if (hasEffectiveModel) {
          const modelText = effective?.provider && effective?.model
            ? `${effective.provider}/${effective.model}${effective.reasoningEffort ? ` · ${effective.reasoningEffort}` : ""}`
            : (effective?.model || "");
          if (modelText) parts.push(modelText);
        } else if (detail?.selectedRoute) {
          if (detail.status === "adopted") {
            parts.push(`待请求头确认 (预选: ${detail.selectedRoute.provider}/${detail.selectedRoute.model})`);
          } else {
            parts.push(`未采用候选: ${detail.selectedRoute.provider}/${detail.selectedRoute.model}`);
          }
        } else if (pending) {
          parts.push("等待子代理首次请求");
        }
        if (detail) {
          const profile = detail.profileName || detail.profileId;
          if (profile) parts.push(`类别: ${profile}`);
          if (detail.source) {
            const sourceMap = { rules: "规则", jev: "Jev", llm: "轻量模型", current: "保持当前" };
            parts.push(`来源: ${sourceMap[detail.source] || detail.source}`);
          }
          if (typeof detail.confidence === "number") {
            parts.push(`置信度: ${Math.round(detail.confidence * 100)}%`);
          }
          if (typeof detail.durationMs === "number") {
            parts.push(`耗时: ${detail.durationMs}ms`);
          }
          if (detail.reason) {
            parts.push(`原因: ${formatRoutingDetail(detail.reason)}`);
          }
        } else if (hasEffectiveModel) {
          parts.push("原因未知");
        }
        return parts.join(" · ");
      }
      function formatNextStep(next) {
        const MAP = {
          rules: "规则命中",
          jev: "交由 Jev 决策",
          llm: "交由轻量模型分类",
          current: "保持当前路由",
        };
        return MAP[next] || (next ? String(next) : "未知走向");
      }
      function formatRuleAnalysisSummary(analysis) {
        if (!analysis || typeof analysis !== "object") return "";
        const parts = [];
        if (analysis.source) {
          const srcMap = {
            "explicit-label": "显式标签匹配",
            keywords: "关键词匹配",
            none: "无匹配",
            tie: "平局冲突",
          };
          parts.push(`来源: ${srcMap[analysis.source] || analysis.source}`);
        }
        if (analysis.profileId) {
          parts.push(`候选类型: ${analysis.profileId}`);
        }
        if (Array.isArray(analysis.matches) && analysis.matches.length > 0) {
          const details = analysis.matches.map((m) => {
            const kw = (m.matchedKeywords || []).map((k) => `${k.keyword}(${k.in === "label" ? "标题" : "内容"})`).join("、");
            return `${m.id}(${m.score}分${kw ? `: ${kw}` : ""})`;
          }).join("；");
          parts.push(`命中项: ${details}`);
        }
        if (Array.isArray(analysis.tiedIds) && analysis.tiedIds.length > 0) {
          parts.push(`平局: ${analysis.tiedIds.join("、")}`);
        }
        return parts.join(" | ");
      }
      function validateProfiles(rows) {
        const seen = new Set();
        for (const row of rows || []) {
          const id = normalizeId(row.id);
          if (!/^[a-z][a-z0-9_-]*$/u.test(id)) return `任务类型 ID“${row.id}”格式无效`;
          if (RESERVED_IDS.has(id)) return `任务类型 ID“${id}”与保留名冲突`;
          if (seen.has(id)) return `任务类型 ID“${id}”重复`;
          seen.add(id);
          if (!row.provider || !row.model) return `任务类型“${id}”尚未选择模型`;
        }
        return "";
      }
      function normalizeJev(value) {
        const source = value !== null && typeof value === "object" ? value : {};
        return {
          enabled: source.enabled === true,
          baseURL: typeof source.baseURL === "string" ? source.baseURL : DEFAULT_JEV.baseURL,
          model: typeof source.model === "string" ? source.model : DEFAULT_JEV.model,
          minConfidence: Number.isFinite(Number(source.minConfidence)) ? Number(source.minConfidence) : DEFAULT_JEV.minConfidence,
          timeoutMs: Number.isFinite(Number(source.timeoutMs)) ? Number(source.timeoutMs) : DEFAULT_JEV.timeoutMs,
          maxStateChars: Number.isFinite(Number(source.maxStateChars)) ? Number(source.maxStateChars) : DEFAULT_JEV.maxStateChars,
        };
      }
      function validateJev(jev) {
        if (!(Number(jev?.minConfidence) >= 0 && Number(jev?.minConfidence) <= 1)) return "Jev 置信度阈值须在 0 到 1 之间";
        if (!(Number(jev?.timeoutMs) >= 100 && Number(jev?.timeoutMs) <= 60000)) return "Jev 超时须在 100 到 60000 毫秒之间";
        if (!(Number(jev?.maxStateChars) >= 500 && Number(jev?.maxStateChars) <= 100000)) return "Jev 上下文字符上限须在 500 到 100000 之间";
        if (typeof jev?.baseURL !== "string" || jev.baseURL.trim() === "") return "Jev Base URL 不能为空";
        try {
          const url = new URL(jev.baseURL.trim());
          if (url.protocol !== "http:" && url.protocol !== "https:") return "Jev Base URL 必须是 http(s)";
        } catch {
          return "Jev Base URL 无效";
        }
        if (typeof jev?.model !== "string" || jev.model.trim() === "") return "Jev 模型不能为空";
        return "";
      }
      function clampNumber(value, fallback, min, max) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(max, Math.max(min, number));
      }
      function statusMessage(status, writable, dirty) {
        if (status === "loading") return "正在读取任务模型配置…";
        if (!writable) return "当前设置文档为只读。";
        if (dirty) return "有未保存的更改。";
        return "";
      }
      function createSettingsRequest(connectionRpc, defaultApi) {
        return async (method, payload = {}, api = defaultApi) => {
          try {
            const result = await connectionRpc.call(SETTINGS_RPC_CHANNEL, method, payload);
            if (result && result.ok === true) return result.value;
            throw new Error(result?.error?.message || "任务模型设置请求失败");
          } catch (error) {
            if (!/HTTP 403\b/u.test(error instanceof Error ? error.message : String(error)) || !api?.settings) throw error;
            if (method === "describe") {
              const desc = await api.settings.describe({});
              if (!desc.result.ok) throw new Error(desc.result.error.message);
              const entry = (desc.result.value.namespaces || []).find((entry) => entry.ns === NS);
              return {
                writable: desc.result.value.writable,
                value: entry?.value || {},
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
                value: resp.result.value.value || payload.section,
                revision: resp.result.value.revision || 0,
              };
            }
            throw error;
          }
        };
      }

      function TaskProfileCard(props) {
        const {
          profileId, template, profile, modelRows, groups, saving, writable = true, custom,
          onChangeModel, onSetField, onRemove, onRename,
        } = props;
        const disabled = saving || !writable;
        const selected = profile?.provider && profile?.model
          ? modelRows.find(({ group, model }) => group.id === profile.provider && model.id === profile.model)
          : null;
        const efforts = selected?.model?.reasoning?.efforts || [];
        const title = custom ? (profile?.name || "自定义任务") : template?.name || profileId;
        const detail = custom
          ? "自定义任务类型；匹配关键词，或用 Jev/轻量模型按名称与描述判断。"
          : template?.detail || "";
        const modelOptions = groups.map((group) => react.createElement("optgroup", { label: group.name, key: group.id },
          ...group.models.map((model) => react.createElement("option", {
            key: model.id, value: modelKey(group.id, model.id),
          }, model.name))));
        const effortOptions = efforts.map((effort) => react.createElement("option", {
          key: effort.id, value: effort.id,
        }, effort.name));
        const keywords = (profile?.keywords ?? template?.keywords ?? []).join(", ");
        return react.createElement("section", { className: "tm-card", key: profileId },
          react.createElement("div", { className: "tm-card-head" },
            react.createElement("div", null,
              react.createElement("h3", { className: "tm-title" }, title),
              react.createElement("p", { className: "tm-detail" }, detail)),
            custom ? react.createElement("button", {
              className: "tm-button tm-danger", type: "button", disabled, onClick: () => onRemove(profileId),
            }, "删除") : null),
          custom ? react.createElement("div", { className: "tm-grid" },
            react.createElement("label", { className: "tm-field" },
              react.createElement("span", { className: "tm-label" }, "任务类型 ID"),
              react.createElement("input", {
                className: "tm-input", value: profileId, disabled,
                onChange: (event) => onRename(profileId, event.target.value),
                "aria-label": `${profileId} 任务类型 ID`,
              })),
            react.createElement("label", { className: "tm-field" },
              react.createElement("span", { className: "tm-label" }, "显示名称"),
              react.createElement("input", {
                className: "tm-input", value: profile?.name ?? "", disabled,
                onChange: (event) => onSetField(profileId, { name: event.target.value }),
                "aria-label": `${profileId} 显示名称`,
              }))) : null,
          custom ? react.createElement("label", { className: "tm-field" },
            react.createElement("span", { className: "tm-label" }, "任务描述（供 Jev / 轻量模型判断）"),
            react.createElement("input", {
              className: "tm-input", value: profile?.detail ?? "", disabled,
              onChange: (event) => onSetField(profileId, { detail: event.target.value }),
              "aria-label": `${profileId} 任务描述`,
            })) : null,
          react.createElement("div", { className: "tm-grid" },
            react.createElement("label", { className: "tm-field" },
              react.createElement("span", { className: "tm-label" }, "模型"),
              react.createElement("select", {
                className: "tm-select", value: profile?.provider && profile?.model ? modelKey(profile.provider, profile.model) : "", disabled,
                onChange: (event) => onChangeModel(profileId, event.target.value), "aria-label": `${profileId} 任务模型`,
              },
              react.createElement("option", { value: "" }, "不启用（保持当前路由）"),
              ...modelOptions)),
            react.createElement("label", { className: "tm-field" },
              react.createElement("span", { className: "tm-label" }, "思考档位"),
              react.createElement("select", {
                className: "tm-select", value: profile?.reasoningEffort || "", disabled: !profile || efforts.length === 0 || disabled,
                onChange: (event) => onSetField(profileId, { reasoningEffort: event.target.value }), "aria-label": `${profileId} 任务思考档位`,
              },
              react.createElement("option", { value: "" }, "模型默认"),
              ...effortOptions))),
          react.createElement("label", { className: "tm-field" },
            react.createElement("span", { className: "tm-label" }, "匹配关键词（逗号分隔；留空则只依赖 Jev/轻量模型）"),
            react.createElement("input", {
              className: "tm-input", value: keywords, disabled: !profile || disabled,
              onChange: (event) => onSetField(profileId, { keywords: splitKeywords(event.target.value) }),
              "aria-label": `${profileId} 匹配关键词`,
            })),
          react.createElement("label", { className: "tm-check" },
            react.createElement("input", {
              type: "checkbox", checked: profile?.enabled !== false && profile !== undefined, disabled: !profile || disabled,
              onChange: (event) => onSetField(profileId, { enabled: event.target.checked }),
            }),
            "启用此任务类型"));
      }

      function apply(ctx) {
        if (typeof document !== "undefined" && !document.getElementById(NAV_STYLE_ID)) {
          const style = document.createElement("style");
          style.id = NAV_STYLE_ID;
          style.textContent = navCss;
          document.head.appendChild(style);
        }
        const settingsRequest = createSettingsRequest(ctx.connection.rpc, ctx.connection.api);

        const WORKFLOW_STYLE_ID = "dsh-task-models-styles";
        if (typeof document !== "undefined" && !document.getElementById(WORKFLOW_STYLE_ID)) {
          const style = document.createElement("style");
          style.id = WORKFLOW_STYLE_ID;
          style.textContent = css;
          document.head.appendChild(style);
        }

        function statusText(status) {
          return {
            running: "运行中",
            completed: "已完成",
            failed: "失败",
            cancelled: "已取消",
            interrupted: "已中断",
          }[status] || String(status || "");
        }

        function phaseStatusText(members) {
          const counts = new Map();
          for (const member of members) {
            const status = member.status || "running";
            counts.set(status, (counts.get(status) || 0) + 1);
          }
          return [...counts.entries()].map(([status, count]) => `${statusText(status)} ${count}`).join(" · ");
        }

        async function loadChildModels(childIds) {
          if (!Array.isArray(childIds) || childIds.length === 0) return {};
          const value = await settingsRequest("childModels", { childIds });
          return value?.models && typeof value.models === "object" ? value.models : {};
        }

        async function loadRoutingDetails(childIds) {
          if (!Array.isArray(childIds) || childIds.length === 0) return { models: {}, details: {} };
          const value = await settingsRequest("routingDetails", { childIds });
          return {
            models: value?.models && typeof value.models === "object" ? value.models : {},
            details: value?.details && typeof value.details === "object" ? value.details : {},
          };
        }

        function sameNavigable(next, previous) {
          if (next === previous) return true;
          if (!Array.isArray(next) || !Array.isArray(previous) || next.length !== previous.length) return false;
          return next.every((entry, index) => entry.id === previous[index].id && entry.mode === previous[index].mode);
        }

        function navigableMembers(sessions, phases, parentId, statuses) {
          const catalog = sessions?.projectionsBySession?.[parentId];
          const navigable = [];
          for (const phase of phases) {
            for (const member of phase.members) {
              const child = catalog?.values?.subagentCatalog?.find((entry) => entry.id === member.childId);
              const childRunning = statuses?.get?.(child?.id)?.running ?? sessions?.byId?.[child?.id]?.running;
              if (member.status === "running" && child !== undefined && childRunning === true
                && (child.mode === "one-shot" || child.mode === "continuable")) {
                navigable.push({ id: child.id, mode: child.mode });
              }
            }
          }
          return navigable;
        }

        /**
         * Shadow the host workflow-run renderer at a lower slot priority so
         * each member row can show the model that actually served its child
         * request. The durable node and Definition stay owned by the host.
         */
        function WorkflowRunPanel(props) {
          const { node, sessionId, openSession, loadModels, loadDetails, useSessions, useSessionStatus } = props;
          const phases = Array.isArray(node?.data?.phases) ? node.data.phases : [];
          const allMembers = phases.flatMap((phase) => (Array.isArray(phase.members) ? phase.members : []));
          const [runOpen, setRunOpen] = react.useState(node?.data?.status !== "completed");
          const [openPhases, setOpenPhases] = react.useState(() => new Set(
            phases.filter((phase) => (phase.members || []).some((member) => member.status !== "completed")).map((phase) => phase.key),
          ));
          const [models, setModels] = react.useState({});
          const [details, setDetails] = react.useState({});
          const statuses = typeof useSessionStatus === "function"
            ? useSessionStatus((value) => value)
            : new Map();
          const navigable = typeof useSessions === "function"
            ? useSessions((sessions) => navigableMembers(sessions, phases, sessionId, statuses), sameNavigable)
            : [];
          const childKey = allMembers
            .map((member) => member.childId)
            .filter((id) => typeof id === "string" && id !== "")
            .join("\u0000");
          const hasRunning = allMembers.some((member) => member.status === "running");

          react.useEffect(() => {
            const childIds = childKey === "" ? [] : childKey.split("\u0000");
            if (childIds.length === 0 || (typeof loadDetails !== "function" && typeof loadModels !== "function")) return () => {};
            let cancelled = false;
            let inFlight = false;
            const load = async () => {
              if (inFlight) return;
              inFlight = true;
              try {
                if (typeof loadDetails === "function") {
                  const res = await loadDetails(childIds);
                  if (!cancelled && res && typeof res === "object") {
                    if (res.models && typeof res.models === "object") setModels((prev) => ({ ...prev, ...res.models }));
                    if (res.details && typeof res.details === "object") setDetails((prev) => ({ ...prev, ...res.details }));
                  }
                } else if (typeof loadModels === "function") {
                  const res = await loadModels(childIds);
                  if (!cancelled && res && typeof res === "object") {
                    if ("models" in res || "details" in res) {
                      if (res.models && typeof res.models === "object") setModels((prev) => ({ ...prev, ...res.models }));
                      if (res.details && typeof res.details === "object") setDetails((prev) => ({ ...prev, ...res.details }));
                    } else {
                      setModels((prev) => ({ ...prev, ...res }));
                    }
                  }
                }
              } catch {
                // The model badge is additive; keep the last known values.
              } finally {
                inFlight = false;
              }
            };
            void load();
            const timer = hasRunning ? setInterval(load, 2000) : undefined;
            return () => {
              cancelled = true;
              if (timer !== undefined) clearInterval(timer);
            };
          }, [childKey, loadDetails, loadModels, hasRunning]);

          const toggleRun = () => setRunOpen((value) => !value);
          const togglePhase = (key) => setOpenPhases((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          });

          if (phases.length === 0) {
            return react.createElement("div", { className: "tm-wf-root" },
              react.createElement("div", { className: "tm-wf-empty" }, "没有启动成员"));
          }

          return react.createElement("div", { className: "tm-wf-root" },
            react.createElement("button", {
              className: "tm-wf-header", type: "button", "aria-expanded": runOpen, onClick: toggleRun,
            },
            react.createElement("span", { className: "tm-wf-chevron" }, runOpen ? "▾" : "▸"),
            react.createElement("span", { className: "tm-wf-title" }, node.data.name || "workflow"),
            react.createElement("span", { className: "tm-wf-summary" }, `${allMembers.length} 个成员`),
            react.createElement("span", { className: `tm-wf-status tm-wf-${node.data.status || "running"}` }, statusText(node.data.status || "running"))),
            runOpen ? react.createElement("div", { className: "tm-wf-phase-list" },
              ...phases.map((phase, phaseIndex) => {
                const members = Array.isArray(phase.members) ? phase.members : [];
                const phaseOpen = openPhases.has(phase.key);
                return react.createElement("div", { className: "tm-wf-phase", key: phase.key ?? phaseIndex },
                  react.createElement("button", {
                    className: "tm-wf-phase-header", type: "button", "aria-expanded": phaseOpen,
                    onClick: () => togglePhase(phase.key),
                  },
                  react.createElement("span", { className: "tm-wf-chevron" }, phaseOpen ? "▾" : "▸"),
                  react.createElement("span", { className: "tm-wf-phase-title" }, phase.phase || "默认阶段"),
                  react.createElement("span", { className: "tm-wf-phase-count" }, `${members.length} 个成员`),
                  react.createElement("span", { className: "tm-wf-phase-status" }, phaseStatusText(members))),
                  phaseOpen ? react.createElement("div", { className: "tm-wf-members" },
                    ...members.map((member, memberIndex) => {
                      const info = models[member.childId];
                      const detail = details[member.childId];
                      const effective = detail?.effectiveRoute || info;
                      const model = typeof effective?.model === "string" ? effective.model : "";
                      const pending = model === "" && member.status === "running";
                      const target = navigable.find((entry) => entry.id === member.childId);
                      const clickable = target !== undefined && typeof openSession === "function";
                      const tooltip = formatMemberTitle({ info, detail, pending });
                      const content = [
                        react.createElement("span", { className: `tm-wf-dot tm-wf-${member.status || "running"}`, key: "dot" }),
                        react.createElement("span", { className: "tm-wf-label", key: "label", title: member.label || "" }, member.label || "空成员名"),
                        model !== "" || pending
                          ? react.createElement("span", {
                              className: `tm-wf-model ${pending ? "tm-wf-model-pending" : ""}`,
                              key: "model",
                              title: tooltip,
                              "aria-label": tooltip,
                            }, model || "模型…")
                          : null,
                        react.createElement("span", { className: "tm-wf-member-status", key: "status" }, statusText(member.status || "running")),
                      ].filter(Boolean);
                      return clickable
                        ? react.createElement("button", {
                            className: "tm-wf-member tm-wf-clickable", type: "button", key: member.seq ?? memberIndex,
                            "data-member-status": member.status,
                            onClick: () => openSession({
                              parentSessionId: sessionId,
                              childSessionId: member.childId,
                              mode: target.mode,
                            }),
                          }, ...content)
                        : react.createElement("div", {
                            className: "tm-wf-member", key: member.seq ?? memberIndex, "data-member-status": member.status,
                          }, ...content);
                    })) : null);
              })) : null);
        }

        function TaskModelsSettings(props) {
          const [status, setStatus] = react.useState("loading");
          const [error, setError] = react.useState("");
          const [writable, setWritable] = react.useState(false);
          const [revision, setRevision] = react.useState(0);
          const [conflict, setConflict] = react.useState(false);
          const [groups, setGroups] = react.useState([]);
          const [failures, setFailures] = react.useState([]);
          const [routing, setRouting] = react.useState({ ...DEFAULT_ROUTING, classifier: { ...DEFAULT_ROUTING.classifier } });
          const [profiles, setProfiles] = react.useState([]);
          const [jev, setJev] = react.useState({ ...DEFAULT_JEV });
          const [jevStatus, setJevStatus] = react.useState({ configured: false, model: "" });
          const [jevKey, setJevKey] = react.useState("");
          const [jevTesting, setJevTesting] = react.useState(false);
          const [jevTest, setJevTest] = react.useState("");
          const [saved, setSaved] = react.useState("");
          const [saving, setSaving] = react.useState(false);

          const [previewLabel, setPreviewLabel] = react.useState("");
          const [previewText, setPreviewText] = react.useState("");
          const [previewRunning, setPreviewRunning] = react.useState(false);
          const [previewResult, setPreviewResult] = react.useState(null);
          const [previewError, setPreviewError] = react.useState("");

          const dirtyRef = react.useRef(false);
          const revisionRef = react.useRef(0);
          const writableRef = react.useRef(false);
          const previewReqIdRef = react.useRef(0);
          const jevTestReqIdRef = react.useRef(0);
          revisionRef.current = revision;
          writableRef.current = writable;

          const clearPreview = () => {
            previewReqIdRef.current++;
            setPreviewResult(null);
            setPreviewError("");
            setPreviewRunning(false);
          };

          const clearJevTest = () => {
            jevTestReqIdRef.current++;
            setJevTest("");
            setJevTesting(false);
          };

          const updateRouting = (updater) => {
            clearPreview();
            dirtyRef.current = true;
            setRouting(updater);
          };

          const updateProfiles = (updater) => {
            clearPreview();
            dirtyRef.current = true;
            setProfiles(updater);
          };

          const updateJev = (updater) => {
            clearPreview();
            clearJevTest();
            dirtyRef.current = true;
            setJev(updater);
          };

          const updateJevKey = (value) => {
            clearJevTest();
            dirtyRef.current = true;
            setJevKey(value);
          };

          const changePreviewLabel = (value) => {
            clearPreview();
            setPreviewLabel(value);
          };

          const changePreviewText = (value) => {
            clearPreview();
            setPreviewText(value);
          };

          const load = async (silent = false) => {
            if (!silent) {
              setStatus("loading");
              setError("");
            }
            try {
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
              const nextRouting = {
                ...DEFAULT_ROUTING,
                ...(settingsView.value?.routing || {}),
                decisionTimeoutMs: Number.isFinite(Number(settingsView.value?.routing?.decisionTimeoutMs))
                  ? clampNumber(Math.round(Number(settingsView.value?.routing?.decisionTimeoutMs)), DEFAULT_ROUTING.decisionTimeoutMs, 100, 60000)
                  : DEFAULT_ROUTING.decisionTimeoutMs,
                classifier: { ...DEFAULT_ROUTING.classifier, ...(settingsView.value?.routing?.classifier || {}) },
              };
              const nextProfiles = normalizeProfiles(settingsView.value?.profiles);
              const nextJev = normalizeJev(settingsView.value?.jev);
              setGroups(modelsValue.groups || []);
              setFailures(modelsValue.failures || []);

              const reconciliation = reconcileSettings({
                currentRevision: revisionRef.current,
                currentWritable: writableRef.current,
                remoteRevision: settingsView.revision,
                remoteWritable: settingsView.writable,
                silent,
                dirty: dirtyRef.current,
              });

              setConflict(reconciliation.conflict);
              setWritable(reconciliation.writable);
              setRevision(reconciliation.revision);

              if (reconciliation.shouldApplyRemote) {
                clearPreview();
                clearJevTest();
                setRouting(nextRouting);
                setProfiles(nextProfiles);
                setJev(nextJev);
                setSaved(JSON.stringify({ routing: nextRouting, profiles: nextProfiles, jev: nextJev }));
              }
              settingsRequest("jevStatus", {}, props.api)
                .then((value) => {
                  if (value && typeof value?.configured === "boolean") {
                    setJevStatus({
                      configured: value.configured,
                      model: typeof value?.model === "string" ? value.model : "",
                    });
                  }
                })
                .catch(() => {});
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

          const byProfile = profilesById(profiles);
          const customProfiles = profiles.filter((profile) => taskTemplateOf(profile.id) === undefined);
          const modelRows = rowsFromGroups(groups);
          const dirty = JSON.stringify({ routing, profiles, jev }) !== saved || jevKey.trim() !== "";
          dirtyRef.current = dirty;
          const validation = validateRouting(routing) || validateProfiles(profiles) || validateJev(jev);
          const feedback = error || validation;
          const statusText = statusMessage(status, writable, dirty);

          const setProfile = (id, patch) => {
            updateProfiles((current) => {
              const target = normalizeId(id);
              const index = current.findIndex((entry) => normalizeId(entry.id) === target);
              if (patch === null) return current.filter((entry) => normalizeId(entry.id) !== target);
              const previous = index < 0 ? profileDefaults(id) : current[index];
              const next = normalizeProfile({ ...previous, ...patch, id: previous.id ?? id });
              if (index < 0) return [...current, next];
              return current.map((entry, at) => at === index ? next : entry);
            });
          };

          const changeProfileModel = (id, value) => {
            const selected = parseModelKey(value);
            if (!selected) { setProfile(id, null); return; }
            const row = modelRows.find(({ group, model }) => group.id === selected.provider && model.id === selected.model);
            setProfile(id, {
              provider: selected.provider,
              model: selected.model,
              reasoningEffort: row?.model?.reasoning?.defaultEffort || "",
            });
          };

          const addProfile = () => {
            let suffix = 1;
            while (byProfile.has(`custom-${suffix}`)) suffix++;
            const id = `custom-${suffix}`;
            updateProfiles((current) => [...current, normalizeProfile({ id, name: `自定义任务 ${suffix}`, provider: "", model: "" })]);
          };

          const renameProfile = (oldId, nextValue) => {
            const target = normalizeId(oldId);
            updateProfiles((current) => current.map((entry) => normalizeId(entry.id) === target
              ? normalizeProfile({ ...entry, id: normalizeId(nextValue) })
              : entry));
          };

          const setProfileField = (id, patch) => setProfile(id, patch);

          const changeClassifier = (value) => {
            const selected = parseModelKey(value);
            if (!selected) {
              updateRouting((current) => ({ ...current, classifier: { provider: "", model: "", reasoningEffort: "" } }));
              return;
            }
            const row = modelRows.find(({ group, model }) => group.id === selected.provider && model.id === selected.model);
            updateRouting((current) => ({
              ...current,
              classifier: {
                provider: selected.provider,
                model: selected.model,
                reasoningEffort: row?.model?.reasoning?.defaultEffort || "",
              },
            }));
          };

          const refreshJevStatus = async () => {
            try {
              const value = await settingsRequest("jevStatus", {}, props.api);
              if (value && typeof value?.configured === "boolean") {
                setJevStatus({ configured: value.configured, model: typeof value?.model === "string" ? value.model : "" });
              }
            } catch {
              // 网络 status 失败不能误改已保存状态
            }
          };

          const testJev = async () => {
            const reqId = ++jevTestReqIdRef.current;
            setJevTesting(true);
            setJevTest("");
            try {
              const payload = { ...(jevKey.trim() === "" ? {} : { apiKey: jevKey.trim() }), jev: normalizeJev(jev) };
              const result = await settingsRequest("testJev", payload, props.api);
              if (jevTestReqIdRef.current === reqId) {
                setJevTest(`✓ Jev 连接测试成功${result?.latencyMs === undefined ? "" : `（${result.latencyMs}ms）`}`);
              }
            } catch (cause) {
              if (jevTestReqIdRef.current === reqId) {
                setJevTest(`Jev 测试失败：${cause instanceof Error ? cause.message : String(cause)}`);
              }
            } finally {
              if (jevTestReqIdRef.current === reqId) {
                setJevTesting(false);
              }
            }
          };

          const runPreview = async () => {
            if (validation || previewRunning || (!previewLabel.trim() && !previewText.trim())) return;
            const reqId = ++previewReqIdRef.current;
            setPreviewRunning(true);
            setPreviewError("");
            setPreviewResult(null);
            try {
              const section = buildDraftSection({ routing, profiles, jev });
              const res = await settingsRequest("previewRules", {
                label: previewLabel.slice(0, 300),
                text: previewText.slice(0, 6000),
                section,
              }, props.api);
              if (previewReqIdRef.current === reqId) {
                setPreviewResult(res);
              }
            } catch {
              // error不暴露原文任务或Key
              if (previewReqIdRef.current === reqId) {
                setPreviewError("规则试运行请求失败");
              }
            } finally {
              if (previewReqIdRef.current === reqId) {
                setPreviewRunning(false);
              }
            }
          };

          const save = async () => {
            if (validation || !dirty || !writable) return;
            setSaving(true);
            setError("");
            try {
              if (jevKey.trim() !== "") {
                await settingsRequest("saveJevKey", { apiKey: jevKey.trim() }, props.api);
                setJevKey("");
              }
              await settingsRequest("replace", {
                section: buildDraftSection({ routing, profiles, jev }),
                expectedRevision: revision,
              }, props.api);
              await load(false);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            } finally {
              setSaving(false);
            }
          };

          const jevStatusText = jevStatus.configured
            ? ""
            : "尚未配置 API Key";

          const classifier = routing.classifier || { provider: "", model: "", reasoningEffort: "" };
          const classifierRows = modelRows.find(({ group, model }) => group.id === classifier.provider && model.id === classifier.model);
          const classifierEfforts = classifierRows?.model?.reasoning?.efforts || [];

          return react.createElement("div", { className: "tm-page" },
            react.createElement("style", null, css),
            react.createElement("h2", null, "任务模型"),
            react.createElement("p", { className: "tm-intro" }, INTRO_TEXT),
            feedback ? react.createElement("div", { className: "tm-feedback tm-error", role: "alert" }, feedback) : null,
            conflict ? react.createElement("div", { className: "tm-feedback tm-warn", role: "alert" },
              react.createElement("span", null, "外部配置已更新，当前草稿存在冲突。"),
              react.createElement("button", {
                className: "tm-button", type: "button", style: { height: 26, padding: "0 10px", fontSize: 12 },
                onClick: () => load(false),
              }, "重新加载最新配置")) : null,
            react.createElement("section", { className: "tm-card" },
              react.createElement("div", null,
                react.createElement("h3", { className: "tm-title" }, "子任务路由"),
                react.createElement("p", { className: "tm-detail" }, "对所有会话委派的子任务生效；不要求任何 Agent Preset，也不会改写主会话模型。")),
              react.createElement("label", { className: "tm-check" },
                react.createElement("input", {
                  type: "checkbox", checked: routing.enabled, disabled: saving || !writable,
                  onChange: (event) => updateRouting((current) => ({ ...current, enabled: event.target.checked })),
                }),
                "启用按任务类型路由子任务"),
              react.createElement("div", { className: "tm-grid" },
                react.createElement("label", { className: "tm-field" },
                  react.createElement("span", { className: "tm-label" }, "规则未命中时"),
                  react.createElement("select", {
                    className: "tm-select", value: routing.fallback, disabled: saving || !writable,
                    onChange: (event) => updateRouting((current) => ({ ...current, fallback: event.target.value })),
                  },
                  react.createElement("option", { value: "taskRole" }, "保持当前路由"),
                  react.createElement("option", { value: "llm" }, "用轻量模型分类"))),
                react.createElement("label", { className: "tm-field" },
                  react.createElement("span", { className: "tm-label" }, "决策总超时（毫秒，100-60000）"),
                  react.createElement("input", {
                    className: "tm-input", type: "number", min: 100, max: 60000, step: 100,
                    value: routing.decisionTimeoutMs ?? DEFAULT_ROUTING.decisionTimeoutMs, disabled: saving || !writable,
                    onChange: (event) => updateRouting((current) => ({
                      ...current,
                      decisionTimeoutMs: clampNumber(Math.round(Number(event.target.value) || DEFAULT_ROUTING.decisionTimeoutMs), DEFAULT_ROUTING.decisionTimeoutMs, 100, 60000),
                    })),
                    "aria-label": "决策总超时",
                  }))),
              react.createElement("div", { className: "tm-field" },
                react.createElement("span", { className: "tm-label" }, "决策选项"),
                react.createElement("label", { className: "tm-check" },
                  react.createElement("input", {
                    type: "checkbox", checked: routing.useJev, disabled: saving || !writable,
                    onChange: (event) => updateRouting((current) => ({ ...current, useJev: event.target.checked })),
                  }),
                  "规则未命中时优先问 Jev"),
                react.createElement("label", { className: "tm-check" },
                  react.createElement("input", {
                    type: "checkbox", checked: routing.respectExplicitChildModel, disabled: saving || !writable,
                    onChange: (event) => updateRouting((current) => ({ ...current, respectExplicitChildModel: event.target.checked })),
                  }),
                  "尊重子任务显式选择的模型")),
              react.createElement("p", { className: "tm-note" }, "任务类型按子代理首次请求决定一次，后续请求沿用同一模型。规则并列时不会按配置顺序随机选择。")),
            react.createElement("div", { className: "tm-card" },
              react.createElement("div", null,
                react.createElement("h3", { className: "tm-title" }, "轻量分类模型（可选）"),
                react.createElement("p", { className: "tm-detail" }, "只有回退方式选择“轻量模型”时才使用；留空则回退保持当前路由。")),
              react.createElement("div", { className: "tm-grid" },
                react.createElement("label", { className: "tm-field" },
                  react.createElement("span", { className: "tm-label" }, "分类模型"),
                  react.createElement("select", {
                    className: "tm-select", value: classifier.provider && classifier.model ? modelKey(classifier.provider, classifier.model) : "", disabled: saving || !writable,
                    onChange: (event) => changeClassifier(event.target.value),
                  },
                  react.createElement("option", { value: "" }, "不配置"),
                  ...groups.map((group) => react.createElement("optgroup", { label: group.name, key: group.id },
                    ...group.models.map((model) => react.createElement("option", { key: model.id, value: modelKey(group.id, model.id) }, model.name)))))),
                react.createElement("label", { className: "tm-field" },
                  react.createElement("span", { className: "tm-label" }, "分类思考档位"),
                  react.createElement("select", {
                    className: "tm-select", value: classifier.reasoningEffort || "", disabled: classifierEfforts.length === 0 || saving || !writable,
                    onChange: (event) => updateRouting((current) => ({
                      ...current,
                      classifier: { ...current.classifier, reasoningEffort: event.target.value },
                    })),
                  },
                  react.createElement("option", { value: "" }, "模型默认"),
                  ...classifierEfforts.map((effort) => react.createElement("option", { key: effort.id, value: effort.id }, effort.name)))))),
            react.createElement("div", { className: "tm-list" },
              ...TASK_TEMPLATES.map((template) => react.createElement(TaskProfileCard, {
                key: template.id,
                profileId: template.id,
                template,
                profile: byProfile.get(template.id),
                modelRows,
                groups,
                saving,
                writable,
                custom: false,
                onChangeModel: changeProfileModel,
                onSetField: setProfileField,
                onRemove: setProfile,
                onRename: renameProfile,
              })),
              ...customProfiles.map((profile) => react.createElement(TaskProfileCard, {
                key: profile.id,
                profileId: profile.id,
                template: undefined,
                profile,
                modelRows,
                groups,
                saving,
                writable,
                custom: true,
                onChangeModel: changeProfileModel,
                onSetField: setProfileField,
                onRemove: setProfile,
                onRename: renameProfile,
              }))),
            react.createElement("div", { className: "tm-actions" },
              react.createElement("button", { className: "tm-button", type: "button", disabled: saving || !writable, onClick: addProfile }, "添加任务类型")),
            react.createElement("section", { className: "tm-card" },
              react.createElement("div", null,
                react.createElement("h3", { className: "tm-title" }, "规则试运行"),
                react.createElement("p", { className: "tm-detail" }, "输入子任务标题与描述，测试规则匹配与路由决策走向（含未保存草稿）；不调用任何模型或写配置。")),
              react.createElement("label", { className: "tm-field" },
                react.createElement("span", { className: "tm-label" }, "子任务 Label / 标题（最多 300 字符）"),
                react.createElement("input", {
                  className: "tm-input",
                  maxLength: 300,
                  value: previewLabel,
                  disabled: previewRunning || saving,
                  placeholder: "例如：实现用户登录校验",
                  onChange: (event) => changePreviewLabel(event.target.value),
                  "aria-label": "试运行任务 Label",
                })),
              react.createElement("label", { className: "tm-field" },
                react.createElement("span", { className: "tm-label" }, "子任务内容 / 描述（最多 6000 字符）"),
                react.createElement("textarea", {
                  className: "tm-textarea",
                  maxLength: 6000,
                  value: previewText,
                  disabled: previewRunning || saving,
                  placeholder: "例如：任务详细描述或提示词内容…",
                  onChange: (event) => changePreviewText(event.target.value),
                  "aria-label": "试运行任务内容",
                })),
              react.createElement("div", { className: "tm-actions tm-actions-left" },
                react.createElement("button", {
                  className: "tm-button tm-primary",
                  type: "button",
                  disabled: Boolean(validation) || previewRunning || saving || (!previewLabel.trim() && !previewText.trim()),
                  onClick: runPreview,
                }, previewRunning ? "试运行中…" : "试运行规则")),
              previewError ? react.createElement("p", { className: "tm-feedback tm-error", role: "alert" }, previewError) : null,
              previewResult ? react.createElement("div", { className: "tm-preview-result" },
                react.createElement("div", null,
                  react.createElement("strong", null, "走向："),
                  formatNextStep(previewResult.next),
                  " · ",
                  react.createElement("span", null, formatRoutingDetail(previewResult.reason))),
                previewResult.profile ? react.createElement("div", null,
                  react.createElement("strong", null, "目标模型："),
                  `${previewResult.profile.name || previewResult.profile.id} (${previewResult.profile.provider}/${previewResult.profile.model}${previewResult.profile.reasoningEffort ? ` · ${previewResult.profile.reasoningEffort}` : ""})`) : null,
                formatRuleAnalysisSummary(previewResult.ruleAnalysis) ? react.createElement("div", null,
                  react.createElement("strong", null, "规则分析："),
                  formatRuleAnalysisSummary(previewResult.ruleAnalysis)) : null
              ) : null),
            react.createElement("section", { className: "tm-card" },
              react.createElement("div", { className: "tm-card-head" },
                react.createElement("div", null,
                  react.createElement("h3", { className: "tm-title" }, "Jev 决策"),
                  react.createElement("p", { className: "tm-detail" }, "可选。规则未命中时由 TypeSafe Jev 在已配置任务类型中选择。")),
                jevStatus.configured
                  ? react.createElement("span", { className: "tm-badge tm-badge-ok" }, "已配置")
                  : react.createElement("span", { className: "tm-badge tm-badge-warn" }, "未配置")),
              react.createElement("label", { className: "tm-check" },
                react.createElement("input", {
                  type: "checkbox", checked: jev.enabled, disabled: saving || !writable,
                  onChange: (event) => updateJev((current) => ({ ...current, enabled: event.target.checked })),
                }),
                "启用 Jev 决策"),
              react.createElement("div", { className: "tm-grid" },
                react.createElement("label", { className: "tm-field" },
                  react.createElement("span", { className: "tm-label" }, "API Key"),
                  react.createElement("input", {
                    className: "tm-input", type: "password", value: jevKey, disabled: saving || !writable,
                    placeholder: jevStatus.configured ? "已保存，留空不修改" : "ts-...",
                    onChange: (event) => updateJevKey(event.target.value),
                  })),
                react.createElement("label", { className: "tm-field" },
                  react.createElement("span", { className: "tm-label" }, "Base URL"),
                  react.createElement("input", {
                    className: "tm-input", value: jev.baseURL, disabled: saving || !writable,
                    onChange: (event) => updateJev((current) => ({ ...current, baseURL: event.target.value })),
                  }))),
              react.createElement("div", { className: "tm-grid tm-grid-3" },
                react.createElement("label", { className: "tm-field" },
                  react.createElement("span", { className: "tm-label" }, "模型"),
                  react.createElement("input", {
                    className: "tm-input", value: jev.model, disabled: saving || !writable,
                    onChange: (event) => updateJev((current) => ({ ...current, model: event.target.value })),
                  })),
                react.createElement("label", { className: "tm-field" },
                  react.createElement("span", { className: "tm-label" }, "最低置信度"),
                  react.createElement("input", {
                    className: "tm-input", type: "number", min: 0, max: 1, step: 0.05, value: jev.minConfidence, disabled: saving || !writable,
                    onChange: (event) => updateJev((current) => ({ ...current, minConfidence: clampNumber(event.target.value, DEFAULT_JEV.minConfidence, 0, 1) })),
                  })),
                react.createElement("label", { className: "tm-field" },
                  react.createElement("span", { className: "tm-label" }, "超时（毫秒）"),
                  react.createElement("input", {
                    className: "tm-input", type: "number", min: 100, max: 60000, step: 100, value: jev.timeoutMs, disabled: saving || !writable,
                    onChange: (event) => updateJev((current) => ({ ...current, timeoutMs: clampNumber(event.target.value, DEFAULT_JEV.timeoutMs, 100, 60000) })),
                  }))),
              react.createElement("div", { className: "tm-grid" },
                react.createElement("label", { className: "tm-field" },
                  react.createElement("span", { className: "tm-label" }, "发送上下文字符上限"),
                  react.createElement("input", {
                    className: "tm-input", type: "number", min: 500, max: 100000, step: 500, value: jev.maxStateChars, disabled: saving || !writable,
                    onChange: (event) => updateJev((current) => ({ ...current, maxStateChars: clampNumber(event.target.value, DEFAULT_JEV.maxStateChars, 500, 100000) })),
                  })),
                react.createElement("div", { className: "tm-field tm-field-actions" },
                  react.createElement("span", { className: "tm-label" }, "连接"),
                  react.createElement("div", { className: "tm-actions tm-actions-left" },
                    react.createElement("button", { className: "tm-button", type: "button", disabled: saving || jevTesting, onClick: refreshJevStatus }, "刷新"),
                    react.createElement("button", { className: "tm-button", type: "button", disabled: saving || jevTesting, onClick: testJev }, jevTesting ? "测试中…" : "测试 Jev")))),
              jevTest ? react.createElement("p", { className: "tm-jev-status" }, jevTest) : null,
              jevStatusText ? react.createElement("p", { className: "tm-jev-status tm-warn" }, jevStatusText) : null),
            react.createElement("div", { className: "tm-actions" },
              react.createElement("button", { className: "tm-button", type: "button", disabled: saving || !dirty, onClick: () => load(false) }, "撤销"),
              react.createElement("button", {
                className: "tm-button tm-primary", type: "button",
                disabled: saving || !writable || !dirty || Boolean(validation), onClick: save,
              }, saving ? "保存中…" : "保存")),
            statusText ? react.createElement("p", { className: "tm-status", role: "status", "aria-live": "polite" }, statusText) : null);
        }

        const IconTaskBranch = ({ size = 16 }) => react.createElement("svg", {
          width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", stroke: "currentColor", strokeWidth: 1.3,
        },
          react.createElement("path", { d: "M1 8h4.7c.7 0 1.1 0 1.4-.1.3-.1.6-.2.9-.4.3-.2.6-.4 1.1-.9l1.9-1.9" }),
          react.createElement("circle", { cx: 12.5, cy: 3.7, r: 1.6 }),
          react.createElement("path", { d: "M7.6 7.8l1.4 1.4c.5.5.8.8 1.1.9.3.2.6.3.9.4.3.1.7.1 1.4.1h1.6" }),
          react.createElement("circle", { cx: 12.5, cy: 12.7, r: 1.6 }));

        const label = () => react.createElement("span", {
          "data-settings-nav-label": "task-models",
          style: { display: "inline-flex", alignItems: "center", gap: 8 },
        },
          react.createElement(IconTaskBranch, { size: 16 }),
          react.createElement("span", null, "任务模型"));
        ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({
          name: SETTINGS_SLOT, id: "task-models", order: 25, label,
          inject: () => ({ api: ctx.connection.api }),
        }, TaskModelsSettings));

        ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
          name: "conversation.chat.node",
          key: "workflow-run",
          priority: -1,
          inject: () => ({
            loadModels: loadChildModels,
            loadDetails: loadRoutingDetails,
            openSession: (target) => {
              if (typeof ctx.uiWorkspace?.openSession === "function") ctx.uiWorkspace.openSession(target);
            },
          }),
        }, WorkflowRunPanel));
      }

      exports.apply = apply;
      exports.inject = ["slots", "connection", "remote", "remote.session", "uiWorkspace"];
      exports.internals = {
        NS, SETTINGS_RPC_CHANNEL, SETTINGS_SLOT, NAV_STYLE_ID, navCss, FALLBACKS, TASK_TEMPLATES,
        RESERVED_IDS, DEFAULT_ROUTING, DEFAULT_JEV, INTRO_TEXT, modelKey, parseModelKey, normalizeId,
        splitKeywords, normalizeKeywords, rowsFromGroups, taskTemplateOf, profileDefaults, normalizeProfile,
        normalizeProfiles, profilesById, validateRouting, validateProfiles, normalizeJev, validateJev, clampNumber,
        statusMessage, createSettingsRequest, TaskProfileCard,
        buildDraftSection, reconcileSettings, formatRoutingDetail, formatMemberTitle,
        formatNextStep, formatRuleAnalysisSummary,
      };
      return module.exports;
    },
  });
})();
