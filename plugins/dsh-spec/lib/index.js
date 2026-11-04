/**
 * dsh-spec — the host half.
 *
 * Mounted by the loader row `spec` in this package's `cordis.patch.yml`. This
 * half owns exactly one thing: the trusted-host RPC channel the Web panel calls
 * to read specs, check them, write documents, and flip task checkboxes.
 *
 * It registers NO tools and NO system-prompt contributions. Those belong to the
 * `spec` Agent preset (`presets/spec.patch.yml`), whose child row mounts
 * `@weniatall/dsh-spec/tools` inside that preset's scope. A session that did not
 * select the Spec preset therefore never sees a `spec_*` tool or the Kiro
 * policy section, while the Web panel keeps working in every session.
 *
 * @module dsh-spec
 */

// Version every internal edge, not only this entry: the host may reload the
// entry while Node still caches its old unqualified dependencies.
import {
  DEFAULT_SETTINGS,
  NS,
  RPC_CHANNEL,
  TOOL_NAMES,
  name,
} from './constants.js?dsh-spec=0.8.1';
import { readLocalePreference, resolveLanguage } from './language.js?dsh-spec=0.8.1';
import { localizeIssues } from './messages.js?dsh-spec=0.8.1';
import {
  DEFAULT_SPEC_TYPE,
  DEFAULT_WORKFLOW,
  SpecError,
  checkSpec,
  summaryOf,
} from './model.js?dsh-spec=0.8.1';
import {
  checkSpecOp,
  createSpec,
  effectiveSettings,
  listSpecsOp,
  nextOp,
  pbtOp,
  readSpecOp,
  resetSettings,
  resyncOp,
  saveSettings,
  listView,
  specLocation,
  stateView,
  taskUpdateOp,
  writeSpecOp,
} from './ops.js?dsh-spec=0.8.1';
import {
  bindSession,
  profilePatchPath,
  readSessionState,
  readSpec,
  readSpecIndex,
  saveSessionDraft,
  unbindSession,
} from './store.js?dsh-spec=0.8.1';

export { DEFAULT_SETTINGS, NS, RPC_CHANNEL, TOOL_NAMES, name };

/** Required host services: the RPC carrier and nothing else. */
export const inject = ['connection'];

/* ------------------------------------------------------------------------- *
 * RPC channel
 * ------------------------------------------------------------------------- */

function rpcOk(value) {
  return { ok: true, value };
}

function rpcError(error) {
  return {
    ok: false,
    error: {
      code: error instanceof SpecError ? error.code : 'internal-error',
      message: error instanceof Error ? error.message : String(error),
      details: error instanceof SpecError ? error.details : {},
    },
  };
}

function publicSettings(effective) {
  return {
    values: effective.settings,
    defaults: { ...DEFAULT_SETTINGS },
    file: effective.file,
    stored: effective.storedExists,
    warnings: effective.warnings,
  };
}

/**
 * Whether the calling session runs the `spec` Agent preset.
 *
 * Display-only: the Web panel shows a hint when the model has no `spec_*`
 * tools, and nothing is gated on this answer.
 * @param {object} ctx
 * @param {string} [sessionId]
 * @returns {boolean | undefined} undefined when the preset registry is absent.
 */
function presetActive(ctx, sessionId) {
  const presets = safeGet(ctx, 'agentPresets');
  if (presets === undefined || presets === null) return undefined;
  const composed = typeof presets.composedPreset === 'function' ? presets.composedPreset : undefined;
  if (composed === undefined) return undefined;
  const agent = sessionId === undefined ? undefined : safeGet(ctx, 'agents')?.get?.(sessionId);
  if (agent === undefined) return false;
  try {
    return composed.call(presets, agent.ctx) === 'spec';
  } catch {
    return false;
  }
}

/**
 * The spec a session is working on.
 *
 * Explicit is the whole rule: a payload `feature`, or the binding this session
 * recorded when it created/associated a spec. There is no "most recently
 * touched spec in the workspace" fallback — that made a brand-new session
 * inherit somebody else's locked type and made the sidebar, the tab title and
 * the composer disagree about which spec was open.
 *
 * @param {object} ctx
 * @param {object|null} config
 * @param {{sessionId?: string, feature?: string}} payload
 * @returns {Promise<{workspace: string, root: string, activeSpec: object|null, binding: object|null}>}
 */
async function sessionSpec(ctx, config, payload) {
  const effective = await effectiveSettings(config);
  const { workspace, root } = specLocation(ctx, null, payload, effective.settings);
  const sessionId = typeof payload.sessionId === 'string' && payload.sessionId !== '' ? payload.sessionId : undefined;
  let feature = typeof payload.feature === 'string' && payload.feature !== '' ? payload.feature : undefined;
  let bound = false;
  if (feature === undefined && sessionId !== undefined) {
    const state = await readSessionState();
    const binding = state.bindings[sessionId];
    if (binding !== undefined) {
      feature = binding.feature;
      bound = true;
    }
  }
  if (feature === undefined) return { workspace, root, activeSpec: null, binding: null };
  try {
    const { spec } = await readSpec(workspace, feature, root);
    return {
      workspace,
      root,
      activeSpec: { feature: spec.feature, specType: spec.config.specType, phase: spec.phase },
      binding: bound ? { feature: spec.feature } : null,
    };
  } catch {
    // A binding whose spec disappeared is reported as unbound; the next create
    // or explicit bind replaces it.
    return { workspace, root, activeSpec: null, binding: null };
  }
}

/** The draft type/workflow this session chose before a spec existed. */
async function sessionDraft(ctx, payload) {
  const sessionId = typeof payload.sessionId === 'string' && payload.sessionId !== '' ? payload.sessionId : undefined;
  if (sessionId === undefined) return null;
  const state = await readSessionState();
  const draft = state.drafts[sessionId];
  if (draft === undefined) return null;
  return {
    specType: draft.specType ?? null,
    workflowType: draft.workflowType ?? null,
  };
}

/**
 * The UI language for this panel.
 *
 * `reported` is the browser's answer, which is also what the panel's own copy
 * renders in — the two halves must never disagree, or the panel speaks Chinese
 * while its findings are English. Settings still win (an explicit pin), and the
 * DSH preference, the OS and English are the fallbacks for a caller that is not
 * the panel (the Agent's prompt, an older bundle).
 *
 * @param {object} settings
 * @param {string} [reported] - `payload.language` sent by the panel
 */
function panelLanguage(settings, reported) {
  return resolveLanguage({ settings, panel: reported, localePreference: readLocalePreference(profilePatchPath()) });
}

async function rpcDescribe(ctx, config, payload) {
  const effective = await effectiveSettings(config);
  const located = await sessionSpec(ctx, config, payload);
  const specs = await readSpecIndex(located.workspace, located.root);
  return {
    workspace: located.workspace,
    root: located.root,
    settings: publicSettings(effective),
    // The language everything user-facing renders in. The panel's own report
    // comes first (it is the only caller that can see the host's locale
    // runtime); settings, the DSH preference and the OS are the fallbacks for
    // anything calling without one.
    language: panelLanguage(effective.settings, payload.language),
    specs: listView(specs),
    presetActive: presetActive(ctx, typeof payload.sessionId === 'string' ? payload.sessionId : undefined),
    // Optional: lets the composer lock its type picker once a spec exists.
    activeSpec: located.activeSpec,
    binding: located.binding,
    draft: await sessionDraft(ctx, payload),
  };
}

async function rpcGet(ctx, config, payload) {
  const effective = await effectiveSettings(config);
  const { workspace, root } = specLocation(ctx, null, payload, effective.settings);
  const { spec, metadata } = await readSpec(workspace, payload.feature, root);
  const state = stateView(spec, checkSpec(spec), metadata);
  // The panel is read by a person: findings arrive in their language. The
  // Agent's copy (`spec_check`) stays English — that is the contract it is
  // graded against.
  return { ...state, issues: localizeIssues(state.issues, panelLanguage(effective.settings, payload.language)) };
}

/** Record which spec this session is working on. */
async function rpcBind(ctx, config, payload) {
  const effective = await effectiveSettings(config);
  const { workspace, root } = specLocation(ctx, null, payload, effective.settings);
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
  if (sessionId === '') throw new SpecError('invalid-argument', 'sessionId is required to bind a spec');
  if (typeof payload.feature !== 'string' || payload.feature === '') {
    throw new SpecError('invalid-argument', 'feature is required to bind a spec');
  }
  // Reading first rejects a feature that is not a spec, so a binding can never
  // point at a directory the panel cannot render.
  const { spec } = await readSpec(workspace, payload.feature, root);
  await bindSession(sessionId, spec.feature);
  return {
    binding: { feature: spec.feature },
    activeSpec: { feature: spec.feature, specType: spec.config.specType, phase: spec.phase },
    draft: null,
  };
}

/** Forget this session's spec binding and draft. */
async function rpcUnbind(ctx, payload) {
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
  if (sessionId === '') throw new SpecError('invalid-argument', 'sessionId is required to unbind a spec');
  await unbindSession(sessionId);
  return { binding: null, activeSpec: null, draft: null };
}

/** Stage the type/workflow the next spec should be created with. */
async function rpcSaveDraft(ctx, config, payload) {
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
  if (sessionId === '') throw new SpecError('invalid-argument', 'sessionId is required to save a draft');
  const effective = await effectiveSettings(config);
  const specType = payload.specType === undefined ? undefined : String(payload.specType);
  const workflowType = payload.workflowType === undefined ? undefined : String(payload.workflowType);
  if (specType !== undefined && !['feature', 'bugfix', 'quick-spec'].includes(specType)) {
    throw new SpecError('invalid-argument', `unknown spec type "${specType}"`);
  }
  if (workflowType !== undefined && !['requirements-first', 'design-first', 'fast-task', 'verify-first'].includes(workflowType)) {
    throw new SpecError('invalid-argument', `unknown workflow "${workflowType}"`);
  }
  const draft = await saveSessionDraft(sessionId, { specType, workflowType });
  return {
    draft: { specType: draft.specType ?? effective.settings.defaultSpecType, workflowType: draft.workflowType ?? effective.settings.defaultWorkflow },
    binding: null,
    activeSpec: null,
  };
}

/**
 * RPC method table. Settings saves need no prompt refresh here: the preset half
 * reads the settings file at every assembly.
 */
async function dispatchRpc(ctx, config, method, payload) {
  switch (method) {
    case 'describe':
    case 'list':
      return rpcDescribe(ctx, config, payload);
    case 'get':
      return rpcGet(ctx, config, payload);
    case 'document': {
      const effective = await effectiveSettings(config);
      const { workspace, root } = specLocation(ctx, null, payload, effective.settings);
      const { spec } = await readSpec(workspace, payload.feature, root);
      let name = `${String(payload.document ?? 'requirements').replace(/\.md$/u, '')}.md`;
      if (name === 'requirements.md' && spec.config.specType === 'bugfix') name = 'bugfix.md';
      const content = spec.documents[name];
      if (content === undefined) {
        throw new SpecError('document-not-found', `spec "${spec.feature}" has no ${name}`, { feature: spec.feature, document: name });
      }
      return { feature: spec.feature, document: name, content, phase: spec.phase };
    }
    case 'check':
      return checkSpecOp(ctx, config, null, payload);
    case 'create': {
      const effective = await effectiveSettings(config);
      const sessionId = typeof payload.sessionId === 'string' && payload.sessionId !== '' ? payload.sessionId : undefined;
      const draft = await sessionDraft(ctx, payload);
      const created = await createSpec(ctx, config, null, {
        ...payload,
        title: payload.title ?? payload.feature,
        specType: payload.specType ?? draft?.specType ?? undefined,
        workflowType: payload.workflowType ?? draft?.workflowType ?? undefined,
      });
      const { workspace, root } = specLocation(ctx, null, payload, effective.settings);
      const { spec } = await readSpec(workspace, created.feature, root);
      if (sessionId !== undefined) await bindSession(sessionId, created.feature);
      return {
        ...created,
        state: stateView(spec, checkSpec(spec)),
        binding: sessionId === undefined ? null : { feature: spec.feature },
        draft: null,
      };
    }
    case 'write':
      return writeSpecOp(ctx, config, null, payload);
    case 'taskUpdate':
      return taskUpdateOp(ctx, config, null, payload);
    case 'next':
      return nextOp(ctx, config, null, payload);
    case 'pbt':
      return pbtOp(ctx, config, null, payload);
    case 'resync':
      // Cold-start path for the Spec dock: publish the plan of the spec this
      // session is bound to, so a session that never wrote tasks.md still shows
      // it. Returns the plan it published (null when there is none).
      return resyncOp(ctx, config, null, payload);
    case 'bind':
      return rpcBind(ctx, config, payload);
    case 'unbind':
      return rpcUnbind(ctx, payload);
    case 'saveDraft':
      return rpcSaveDraft(ctx, config, payload);
    case 'saveSettings': {
      const effective = await saveSettings(config, payload.values);
      const { workspace, root } = specLocation(ctx, null, payload, effective.settings);
      return {
        settings: publicSettings(effective),
        workspace,
        root,
      };
    }
    case 'resetSettings': {
      const effective = await resetSettings(config);
      const { workspace, root } = specLocation(ctx, null, payload, effective.settings);
      return {
        settings: publicSettings(effective),
        workspace,
        root,
      };
    }
    default:
      throw new SpecError('unknown-method', `unknown RPC endpoint "${String(method)}"`, { method });
  }
}

/** Read a service without throwing when it is absent. */
function safeGet(ctx, key) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(key, false) : undefined;
  } catch {
    return undefined;
  }
}

function noteDiagnostic(ctx, message) {
  try {
    if (typeof ctx?.logger?.warn === 'function') ctx.logger.warn(message);
  } catch {
    // diagnostics never break load
  }
}

/* ------------------------------------------------------------------------- *
 * Entry
 * ------------------------------------------------------------------------- */

/**
 * Mount the host half.
 *
 * Nothing here touches the tool or prompt registries: this row must stay inert
 * for every Agent that did not select the Spec preset.
 * @param {object} ctx - Cordis context.
 * @param {unknown} [config] - profile config.
 */
export function apply(ctx, config) {
  const connection = ctx.connection;
  if (connection?.rpc && typeof connection.rpc.handle === 'function') {
    const dispose = connection.rpc.handle(
      RPC_CHANNEL,
      async (method, payload) => {
        try {
          return rpcOk(await dispatchRpc(ctx, config, method, payload !== null && typeof payload === 'object' ? payload : {}));
        } catch (error) {
          return rpcError(error);
        }
      },
      { authority: 'trusted-host' },
    );
    if (typeof dispose === 'function') ctx.on?.('dispose', () => void dispose());
  } else {
    noteDiagnostic(ctx, 'spec: connection.rpc is unavailable; the Web panel cannot read specs');
  }
}

export { DEFAULT_SPEC_TYPE, DEFAULT_WORKFLOW, checkSpec, summaryOf };
