/**
 * dsh-spec — operations shared by the host half and the preset half.
 *
 * Everything here is transport-agnostic: settings resolution, workspace
 * resolution, the derived views, the eight tool bodies, and the small render
 * helpers the tool definitions use. `lib/index.js` reaches this module for the
 * RPC channel; `lib/tools.js` reaches it for the tool definitions. Neither
 * module imports the other.
 *
 * @module dsh-spec/ops
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SPEC_TYPE,
  DEFAULT_WORKFLOW,
  SpecError,
  SPEC_TYPES,
  WORKFLOW_TYPES,
  checkSpec,
  featureNameFor,
  specsRoot,
  summaryOf,
} from './model.js?dsh-spec=0.8.0';
import { TASK_STATUSES, leafTasks, readyTasks, taskProgress } from './tasks.js?dsh-spec=0.8.0';
import {
  createSpecDirectory,
  readJson,
  readSessionState,
  readSpec,
  readSpecIndex,
  settingsFilePath,
  updatePbtStatus,
  updateTaskStatus,
  writeDocument,
  writeJson,
} from './store.js?dsh-spec=0.8.0';
import { publishPlan } from './plan-bridge.js?dsh-spec=0.8.0';
import { DEFAULT_SETTINGS, TOOL_NAMES } from './constants.js?dsh-spec=0.8.0';
import { LANGUAGES } from './language.js?dsh-spec=0.8.0';


/** Task status aliases accepted from agents, mapped to Kiro's enum. */
export const STATUS_ALIASES = Object.freeze({
  todo: 'not_started',
  'not-started': 'not_started',
  notstarted: 'not_started',
  pending: 'not_started',
  doing: 'in_progress',
  'in-progress': 'in_progress',
  inprogress: 'in_progress',
  active: 'in_progress',
  done: 'completed',
  complete: 'completed',
  completed: 'completed',
  queued: 'queued',
  open: 'not_started',
});

export function normalizeTaskStatus(value) {
  const key = String(value ?? '').trim().toLowerCase().replace(/\s+/gu, '_');
  const status = STATUS_ALIASES[key] ?? (TASK_STATUSES.includes(key) ? key : undefined);
  if (status === undefined) {
    throw new SpecError('invalid-status', `unknown task status "${String(value)}" (use not_started, queued, in_progress or completed)`, { value });
  }
  return status;
}
/* ------------------------------------------------------------------------- *
 * Settings
 * ------------------------------------------------------------------------- */

function validSetting(key, value) {
  switch (key) {
    case 'kiroDir': {
      if (typeof value !== 'string' || value.trim() === '') return { ok: false, message: 'must be a non-empty string' };
      if (value.includes('\0')) return { ok: false, message: 'contains a NUL byte' };
      if (path.isAbsolute(value)) return { ok: false, message: 'must be relative to the workspace' };
      return { ok: true, value: value.trim().replace(/\/+$/u, '') || '.kiro' };
    }
    case 'promptMaxSpecs': {
      if (!Number.isInteger(value) || value < 0 || value > 50) return { ok: false, message: 'must be an integer between 0 and 50' };
      return { ok: true, value };
    }
    case 'defaultSpecType': {
      if (!SPEC_TYPES.includes(value)) return { ok: false, message: `must be one of ${SPEC_TYPES.join(', ')}` };
      return { ok: true, value };
    }
    case 'defaultWorkflow': {
      if (!WORKFLOW_TYPES.includes(value)) return { ok: false, message: `must be one of ${WORKFLOW_TYPES.join(', ')}` };
      return { ok: true, value };
    }
    case 'language': {
      // Empty is a real choice: follow DSH itself.
      if (value === '') return { ok: true, value };
      if (!LANGUAGES.includes(value)) return { ok: false, message: `must be empty (follow DSH) or one of ${LANGUAGES.join(', ')}` };
      return { ok: true, value };
    }
    default: {
      if (typeof value !== 'boolean') return { ok: false, message: 'must be a boolean' };
      return { ok: true, value };
    }
  }
}

/** Keep only valid settings; strict mode throws, lenient mode reports. */
export function sanitizeSettings(raw, options = {}) {
  const strict = options.strict === true;
  const values = {};
  const issues = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    if (strict) throw new SpecError('invalid-setting', 'settings must be an object');
    return { values, issues: ['settings must be an object'] };
  }
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (raw[key] === undefined) continue;
    const result = validSetting(key, raw[key]);
    if (result.ok) values[key] = result.value;
    else {
      const message = `settings.${key} ${result.message}`;
      if (strict) throw new SpecError('invalid-setting', message);
      issues.push(message);
    }
  }
  return { values, issues };
}

/** Flatten profile config (flat keys or `prompt`/`lint` groups). */
export function configSettings(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return { values: {}, issues: [] };
  const prompt = config.prompt && typeof config.prompt === 'object' ? config.prompt : {};
  const raw = {};
  const assign = (key, ...candidates) => {
    for (const candidate of candidates) {
      if (candidate !== undefined) {
        raw[key] = candidate;
        return;
      }
    }
  };
  assign('kiroDir', config.kiroDir);
  assign('promptEnabled', config.promptEnabled, prompt.enabled);
  assign('includeActiveSpecs', config.includeActiveSpecs, prompt.includeActiveSpecs);
  assign('promptMaxSpecs', config.promptMaxSpecs, prompt.maxSpecs);
  assign('strict', config.strict);
  assign('defaultSpecType', config.defaultSpecType);
  assign('defaultWorkflow', config.defaultWorkflow);
  assign('language', config.language);
  return sanitizeSettings(raw);
}

/** Read the saved settings file. */
export async function readStoredSettings() {
  let raw;
  try {
    raw = await readJson(settingsFilePath());
  } catch (error) {
    return { values: {}, issues: [`settings file is unreadable: ${error.message}`], exists: true };
  }
  if (raw === undefined) return { values: {}, issues: [], exists: false };
  const { values, issues } = sanitizeSettings(raw);
  return { values, issues, exists: true };
}

/** Effective settings: defaults ← config ← saved file. */
export async function effectiveSettings(config) {
  const configPart = configSettings(config);
  const stored = await readStoredSettings();
  return {
    settings: { ...DEFAULT_SETTINGS, ...configPart.values, ...stored.values },
    storedValues: stored.values,
    storedExists: stored.exists,
    file: settingsFilePath(),
    warnings: [...configPart.issues, ...stored.issues],
  };
}

/** Save a settings patch (validated strictly, merged over the file). */
export async function saveSettings(config, values) {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    throw new SpecError('invalid-argument', 'settings values must be an object');
  }
  const stored = await readStoredSettings();
  const merged = { ...stored.values, ...values };
  const clean = sanitizeSettings(merged, { strict: true }).values;
  await fsp.mkdir(path.dirname(settingsFilePath()), { recursive: true });
  await writeJson(settingsFilePath(), clean);
  return effectiveSettings(config);
}

/** Remove the settings file. */
export async function resetSettings(config) {
  await fsp.rm(settingsFilePath(), { force: true });
  return effectiveSettings(config);
}
/* ------------------------------------------------------------------------- *
 * Workspace resolution
 * ------------------------------------------------------------------------- */

function safeService(ctx, key) {
  try {
    if (typeof ctx?.get === 'function') return ctx.get(key, false);
    return ctx?.[key];
  } catch {
    return undefined;
  }
}

/** Resolve the workspace from the tool execution, RPC payload, or registry. */
export function workspaceFor(ctx, exec, payload = {}) {
  const direct = exec?.agent?.session?.header?.cwd;
  if (typeof direct === 'string' && direct.trim() !== '') return direct;
  if (typeof payload.sessionId === 'string' && payload.sessionId !== '') {
    const sessions = safeService(ctx, 'sessions');
    const cwd = sessions?.get?.(payload.sessionId)?.header?.cwd;
    if (typeof cwd === 'string' && cwd.trim() !== '') return cwd;
  }
  const registry = safeService(ctx, 'workspaceRegistry');
  const fromRegistry = registry?.list?.()?.[0]?.path;
  if (typeof fromRegistry === 'string' && fromRegistry.trim() !== '') return fromRegistry;
  return process.cwd();
}

/**
 * Workspace + spec root for one operation.
 *
 * Every read and write goes through this pair so a custom `kiroDir` cannot
 * make the displayed root and the written root disagree, and so an RPC call
 * carrying `sessionId` cannot silently fall back to another workspace.
 *
 * @param {object} ctx
 * @param {object|null} exec - tool execution, when called by the Agent.
 * @param {object} args - tool arguments or RPC payload.
 * @param {{kiroDir?: string}} settings
 * @returns {{workspace: string, root: string}}
 */
export function specLocation(ctx, exec, args, settings) {
  const workspace = workspaceFor(ctx, exec, args ?? {});
  return { workspace, root: rootFor(workspace, settings ?? {}) };
}

export function rootFor(workspace, settings) {
  return specsRoot(workspace, settings.kiroDir ?? '.kiro');
}
/* ------------------------------------------------------------------------- *
 * Views
 * ------------------------------------------------------------------------- */

function taskView(task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    // A parent completed by its subtree reports `completed` without its own box
    // being checked. The client needs to know that, so it can show the state
    // without offering a control the subtree would immediately override.
    derived: task.derived === true,
    optional: task.optional,
    depth: task.depth,
    wave: task.wave ?? null,
    parent: task.parentId,
    requirements: task.requirements ?? [],
    line: task.line + 1,
    children: task.children.map((child) => child.id),
  };
}

/** Full, model-facing state of one spec. */
export function stateView(spec, check, metadata) {
  const progress = spec.tasks === null ? null : taskProgress(spec.tasks);
  const ready = spec.tasks === null ? [] : readyTasks(spec.tasks);
  return {
    feature: spec.feature,
    directory: spec.directory,
    config: spec.config,
    phase: spec.phase,
    documents: ['requirements.md', 'bugfix.md', 'design.md', 'tasks.md'].map((name) => ({
      name,
      exists: spec.documents[name] !== undefined,
      bytes: spec.documents[name] === undefined ? 0 : spec.documents[name].length,
    })),
    requirements: spec.requirements.requirements.map((requirement) => ({
      id: requirement.id,
      title: requirement.title,
      userStory: requirement.userStory,
      criteria: requirement.acceptance.map((clause) => ({ id: clause.id, text: clause.text })),
    })),
    properties: spec.properties.map((property) => ({ number: property.number, title: property.title, kind: property.kind, validates: property.validates })),
    tasks: spec.tasks === null ? [] : spec.tasks.tasks.map(taskView),
    dependencyGraph: spec.graph,
    progress,
    ready: ready.map((task) => ({ id: task.id, title: task.title, optional: task.optional, wave: task.wave ?? null })),
    issues: check.issues,
    counts: check.counts,
    ok: check.ok,
    metadata: metadata ?? { pbtResults: {}, executionHistory: {} },
  };
}

export function listView(specs) {
  return specs.map((spec) => {
    const check = checkSpec(spec);
    const has = (name) => spec.documents[name] !== undefined;
    return {
      feature: spec.feature,
      specType: spec.config.specType,
      workflowType: spec.config.workflowType,
      phase: spec.phase,
      directory: spec.directory,
      // Real on-disk presence: the panel must never infer a document from the
      // phase, which is what made a requirements-only spec show a Design node.
      documents: {
        requirements: has('requirements.md'),
        bugfix: has('bugfix.md'),
        design: has('design.md'),
        tasks: has('tasks.md'),
      },
      requirements: spec.requirements.requirements.length,
      clauses: spec.requirements.clauses.length,
      properties: spec.properties.length,
      progress: spec.tasks === null ? null : taskProgress(spec.tasks),
      ready: spec.tasks === null ? [] : readyTasks(spec.tasks).map((task) => ({ id: task.id, title: task.title })),
      issues: check.counts,
      ok: check.ok,
    };
  });
}
/* ------------------------------------------------------------------------- *
 * Operations
 * ------------------------------------------------------------------------- */

export async function createSpec(ctx, config, exec, args) {
  const { settings } = await effectiveSettings(config);
  const { workspace, root } = specLocation(ctx, exec, args, settings);
  const explicitFeature = typeof args.feature === 'string' && args.feature.trim() !== '';
  const requested = explicitFeature
    ? args.feature.trim()
    : featureNameFor(args.title ?? args.idea ?? '', 'spec');
  if (explicitFeature) {
    const existing = await readSpecIndex(workspace, root);
    if (existing.some((spec) => spec.feature === requested)) {
      throw new SpecError('spec-exists', `spec "${requested}" already exists; read it with ${TOOL_NAMES.read}`, { feature: requested });
    }
  }
  const specType = args.specType ?? settings.defaultSpecType;
  const workflowType = args.workflowType ?? settings.defaultWorkflow;
  const documents = Array.isArray(args.documents) && args.documents.length > 0
    ? args.documents
    : ['requirements'];
  const created = await createSpecDirectory(workspace, {
    root,
    feature: explicitFeature ? requested : undefined,
    title: typeof args.title === 'string' ? args.title : args.feature,
    specType,
    workflowType,
    documents,
  });
  const { spec } = await readSpec(workspace, created.feature, root);
  const check = checkSpec(spec);
  return {
    feature: created.feature,
    directory: created.directory,
    files: created.files,
    specType,
    workflowType,
    phase: spec.phase,
    summary: summaryOf(spec),
    issues: check.issues,
    counts: check.counts,
  };
}

/**
 * Publish the plan for the spec bound to one session, and return it.
 *
 * This is the cold-start path for the dock: the projection is a fold over
 * session events, so a spec that was written in an earlier session (or by the
 * panel, or by hand) has a plan on disk and nothing in this session's log.
 * The caller is the client on mount, which paints the returned snapshot and
 * lets the published event keep it live afterwards — one derivation, two
 * deliveries.
 *
 * No bound spec means no plan, and that is not an error: the dock simply stays
 * hidden.
 *
 * @returns {Promise<object | null>} the plan, or null when the session has none.
 */
export async function resyncOp(ctx, config, exec, args) {
  const { settings } = await effectiveSettings(config);
  const { workspace, root } = specLocation(ctx, exec, args, settings);
  const sessionId = typeof args.sessionId === 'string' && args.sessionId !== '' ? args.sessionId : undefined;
  const bound = sessionId === undefined ? null : (await readSessionState()).bindings[sessionId] ?? null;
  if (bound === null || typeof bound.feature !== 'string' || bound.feature === '') return null;
  let spec;
  try {
    ({ spec } = await readSpec(workspace, bound.feature, root));
  } catch {
    // A binding may outlive its directory (the spec was deleted or the session
    // moved workspace). That is a stale binding, not a failure to report to the
    // composer: the dock hides and the panel's own list shows the truth.
    return null;
  }
  return publishPlan(ctx, exec, spec, sessionId);
}

export async function listSpecsOp(ctx, config, exec, args = {}) {
  const { settings } = await effectiveSettings(config);
  const { workspace, root } = specLocation(ctx, exec, args, settings);
  const specs = await readSpecIndex(workspace, root);
  return { workspace, root, specs: listView(specs) };
}

export async function readSpecOp(ctx, config, exec, args) {
  const { settings } = await effectiveSettings(config);
  const { workspace, root } = specLocation(ctx, exec, args, settings);
  const { spec, metadata } = await readSpec(workspace, args.feature, root);
  const check = checkSpec(spec);
  if (typeof args.document === 'string' && args.document !== '') {
    let name = args.document.endsWith('.md') ? args.document : `${args.document}.md`;
    // `requirements` names the requirements-side document: bugfix specs own bugfix.md.
    if (name === 'requirements.md' && spec.config.specType === 'bugfix') name = 'bugfix.md';
    const content = spec.documents[name];
    if (content === undefined) {
      throw new SpecError('document-not-found', `spec "${spec.feature}" has no ${name}`, { feature: spec.feature, document: name });
    }
    return {
      feature: spec.feature,
      document: name,
      content,
      issues: check.issues.filter((item) => item.file === name),
      phase: spec.phase,
      directory: spec.directory,
    };
  }
  return stateView(spec, check, metadata);
}

export async function writeSpecOp(ctx, config, exec, args) {
  const { settings } = await effectiveSettings(config);
  const { workspace, root } = specLocation(ctx, exec, args, settings);
  const { spec: before } = await readSpec(workspace, args.feature, root);
  // `requirements` means "the requirements-side document": bugfix specs own
  // bugfix.md instead, exactly like Kiro's documentType mapping.
  let fileName = args.document.endsWith('.md') ? args.document : `${args.document}.md`;
  if (fileName === 'requirements.md' && before.config.specType === 'bugfix') fileName = 'bugfix.md';
  const written = await writeDocument(root, args.feature, fileName, args.content);
  const { spec } = await readSpec(workspace, args.feature, root);
  const check = checkSpec(spec);
  // tasks.md is the plan dock's source; publish it as soon as the file lands so
  // a running turn updates the dock instead of waiting for the turn to end.
  if (spec.tasks !== null) publishPlan(ctx, exec, spec, args.sessionId);
  return {
    feature: written.feature,
    document: written.file,
    path: written.path,
    phase: spec.phase,
    ok: check.ok,
    counts: check.counts,
    issues: check.issues.filter((item) => item.file === written.file || item.rule.startsWith('spec/')),
  };
}

export async function checkSpecOp(ctx, config, exec, args) {
  const { settings } = await effectiveSettings(config);
  const { workspace, root } = specLocation(ctx, exec, args, settings);
  const specs = args.feature === undefined
    ? await readSpecIndex(workspace, root)
    : [(await readSpec(workspace, args.feature, root)).spec];
  const strict = args.strict === undefined ? settings.strict : args.strict === true;
  const results = specs.map((spec) => {
    const check = checkSpec(spec);
    return {
      feature: spec.feature,
      phase: spec.phase,
      ok: strict ? check.counts.error === 0 && check.counts.warning === 0 : check.ok,
      counts: check.counts,
      issues: check.issues,
      summary: check.summary,
    };
  });
  return {
    root,
    strict,
    ok: results.every((result) => result.ok),
    specs: results,
    totals: {
      error: results.reduce((sum, result) => sum + result.counts.error, 0),
      warning: results.reduce((sum, result) => sum + result.counts.warning, 0),
      info: results.reduce((sum, result) => sum + result.counts.info, 0),
    },
  };
}

export async function taskUpdateOp(ctx, config, exec, args) {
  const { settings } = await effectiveSettings(config);
  const { workspace, root } = specLocation(ctx, exec, args, settings);
  const status = normalizeTaskStatus(args.status);
  const context = {
    root,
    executionId: exec?.callId,
    chatSessionId: exec?.agent?.session?.id ?? exec?.agent?.id,
  };
  if (typeof args.taskId !== 'string' || args.taskId.trim() === '') {
    if (status !== 'queued') {
      throw new SpecError('invalid-argument', 'taskId is required unless status is "queued"', { field: 'taskId' });
    }
    const { spec } = await readSpec(workspace, args.feature, root);
    if (spec.tasks === null) throw new SpecError('missing-document', `spec "${args.feature}" has no tasks.md`);
    const targets = leafTasks(spec.tasks).filter((task) => !task.optional && task.status === 'not_started');
    const results = [];
    for (const task of targets) {
      results.push(await updateTaskStatus(workspace, args.feature, task.id, 'queued', context));
    }
    return { feature: args.feature, status: 'queued', queued: targets.map((task) => task.id), results };
  }
  const result = await updateTaskStatus(workspace, args.feature, args.taskId, status, context);
  // The dock follows the checkbox as it moves: publish the whole plan after the
  // write so parallel waves and their live statuses are always current.
  const { spec } = await readSpec(workspace, args.feature, root);
  publishPlan(ctx, exec, spec, args.sessionId);
  return result;
}

export async function nextOp(ctx, config, exec, args) {
  const { settings } = await effectiveSettings(config);
  const { workspace, root } = specLocation(ctx, exec, args, settings);
  const { spec } = await readSpec(workspace, args.feature, root);
  const check = checkSpec(spec);
  const progress = spec.tasks === null ? null : taskProgress(spec.tasks);
  const ready = spec.tasks === null ? [] : readyTasks(spec.tasks);
  const includeOptional = args.includeOptional === true;
  const candidates = includeOptional ? ready : ready.filter((task) => !task.optional);
  return {
    feature: spec.feature,
    phase: spec.phase,
    progress,
    ok: check.ok,
    counts: check.counts,
    ready: candidates.map((task) => ({
      id: task.id,
      title: task.title,
      wave: task.wave ?? null,
      requirements: task.requirements ?? [],
      optional: task.optional,
    })),
  };
}

export async function pbtOp(ctx, config, exec, args) {
  const { settings } = await effectiveSettings(config);
  const { workspace, root } = specLocation(ctx, exec, args, settings);
  const status = args.status === 'failed' ? 'failed' : args.status === 'passed' ? 'passed' : undefined;
  if (status === undefined) {
    throw new SpecError('invalid-argument', 'status must be "passed" or "failed"', { field: 'status' });
  }
  return updatePbtStatus(workspace, args.feature, args.taskId, {
    status,
    failingExample: typeof args.failingExample === 'string' ? args.failingExample : undefined,
  }, root);
}
/* ------------------------------------------------------------------------- *
 * Tool schemas
 * ------------------------------------------------------------------------- */

const TEXT = { type: 'string' };
const INT = { type: 'integer' };
const NULLABLE_TEXT = { oneOf: [{ type: 'string' }, { type: 'null' }] };
const ISSUE = {
  type: 'object',
  additionalProperties: true,
  required: ['severity', 'message'],
  properties: {
    severity: { type: 'string', enum: ['error', 'warning', 'info'] },
    message: { type: 'string' },
    rule: { type: 'string' },
    file: { type: 'string' },
    line: { type: 'number' },
    itemId: { type: 'string' },
  },
};
const NUMBER = { type: 'number' };
const COUNTS = {
  type: 'object',
  additionalProperties: false,
  required: ['error', 'warning', 'info'],
  properties: { error: NUMBER, warning: NUMBER, info: NUMBER },
};
const PROGRESS = {
  type: 'object',
  additionalProperties: true,
  required: ['total', 'leaves', 'required', 'completed', 'percent'],
  properties: {
    total: NUMBER, leaves: NUMBER, required: NUMBER, optional: NUMBER,
    completed: NUMBER, inProgress: NUMBER, queued: NUMBER, notStarted: NUMBER, percent: NUMBER,
  },
};
const NULLABLE_NUMBER = { oneOf: [{ type: 'number' }, { type: 'null' }] };
const TASK_BRIEF = {
  type: 'object',
  additionalProperties: true,
  required: ['id', 'title'],
  properties: { id: TEXT, title: TEXT, optional: { type: 'boolean' }, wave: NULLABLE_NUMBER, requirements: { type: 'array', items: TEXT } },
};
const SPEC_LIST_ENTRY = {
  type: 'object',
  additionalProperties: true,
  required: ['feature', 'specType', 'workflowType', 'phase', 'ok'],
  properties: {
    feature: TEXT,
    specType: TEXT,
    workflowType: TEXT,
    phase: TEXT,
    requirements: NUMBER,
    clauses: NUMBER,
    properties: NUMBER,
    progress: { oneOf: [PROGRESS, { type: 'null' }] },
    ready: { type: 'array', items: TASK_BRIEF },
    issues: COUNTS,
    ok: { type: 'boolean' },
  },
};

function textContent(text) {
  return [{ type: 'text', text }];
}

function renderIssues(issues, limit = 12) {
  return issues.slice(0, limit).map((issue) => `- [${issue.severity}] ${issue.rule === undefined ? '' : `${issue.rule}: `}${issue.message}${issue.file === undefined ? '' : ` (${issue.file}${issue.line === undefined || issue.line === 0 ? '' : `:${issue.line}`})`}`);
}

function renderCreate(value) {
  return [
    `Created spec "${value.feature}" at ${value.directory}`,
    `Type: ${value.specType} · workflow: ${value.workflowType} · phase: ${value.phase}`,
    `Files: ${value.files.join(', ')}`,
    `Next: write ${value.phase === 'requirements' ? 'requirements.md' : `${value.phase}.md`} with ${TOOL_NAMES.write}, then run ${TOOL_NAMES.check}.`,
    ...(value.issues.length === 0 ? [] : ['', 'Findings:', ...renderIssues(value.issues)]),
  ].join('\n');
}

function renderList(value) {
  if (value.specs.length === 0) {
    return `No specs in ${value.root}.\nCreate one with ${TOOL_NAMES.create} (title, optional specType/workflowType).`;
  }
  const lines = [`Specs in ${value.root}:`];
  for (const spec of value.specs) {
    const progress = spec.progress === null ? 'no tasks' : `${spec.progress.completed}/${spec.progress.required} required tasks (${spec.progress.percent}%)`;
    const ready = spec.ready.length === 0 ? '' : ` · next: ${spec.ready.map((task) => task.id).join(', ')}`;
    lines.push(`- ${spec.feature} [${spec.specType}/${spec.workflowType}] ${spec.phase} — ${spec.requirements} reqs, ${spec.clauses} criteria · ${progress}${ready} · ${spec.ok ? 'format OK' : `${spec.issues.error} errors`}`);
  }
  return lines.join('\n');
}

function renderState(value) {
  const lines = [
    `Spec ${value.feature} — phase ${value.phase}`,
    `Directory: ${value.directory}`,
    `Type: ${value.config.specType} · workflow: ${value.config.workflowType}`,
    `Requirements: ${value.requirements.length} (${value.requirements.reduce((sum, req) => sum + req.criteria.length, 0)} criteria) · properties: ${value.properties.length}`,
  ];
  if (value.progress !== null) {
    lines.push(`Tasks: ${value.progress.completed}/${value.progress.required} required complete (${value.progress.percent}%)${value.progress.inProgress > 0 ? `, ${value.progress.inProgress} in progress` : ''}`);
  }
  if (value.ready.length > 0) lines.push(`Ready: ${value.ready.map((task) => `${task.id} ${task.title}${task.wave === null ? '' : ` (wave ${task.wave})`}`).join(' | ')}`);
  if (value.requirements.length > 0) {
    lines.push('', 'Requirements:');
    for (const requirement of value.requirements) {
      lines.push(`- ${requirement.id} ${requirement.title}${requirement.userStory === '' ? '' : ` — ${requirement.userStory}`}`);
      for (const criterion of requirement.criteria) lines.push(`  - ${criterion.id} ${criterion.text}`);
    }
  }
  if (value.properties.length > 0) {
    lines.push('', 'Correctness properties:');
    for (const property of value.properties) lines.push(`- Property ${property.number} ${property.title} [${property.kind}] validates ${property.validates.join(', ') || '—'}`);
  }
  if (value.issues.length > 0) lines.push('', `Findings (${value.counts.error} errors, ${value.counts.warning} warnings):`, ...renderIssues(value.issues));
  return lines.join('\n');
}

function renderCheck(value) {
  const lines = [`Spec check — ${value.ok ? 'OK' : 'NOT OK'}${value.strict ? ' (strict)' : ''}`, `Root: ${value.root} · ${value.specs.length} spec(s) · ${value.totals.error} errors, ${value.totals.warning} warnings, ${value.totals.info} info.`];
  for (const spec of value.specs) {
    lines.push('', `## ${spec.feature} [${spec.phase}] — ${spec.ok ? 'OK' : `${spec.counts.error} errors`}`);
    if (spec.issues.length === 0) {
      lines.push('- No findings.');
      continue;
    }
    lines.push(...renderIssues(spec.issues, 20));
  }
  return lines.join('\n');
}

function renderTaskResult(value) {
  const lines = [`Task ${value.taskId} → ${value.status} (${value.feature})`];
  if (value.propagated.length > 0) lines.push(`Auto-completed parents: ${value.propagated.map((change) => change.taskId).join(', ')}`);
  if (value.warnings.length > 0) lines.push('Warnings:', ...value.warnings.map((warning) => `- ${warning}`));
  if (value.ready.length > 0) lines.push(`Newly ready: ${value.ready.map((task) => `${task.id} ${task.title}`).join(' | ')}`);
  return lines.join('\n');
}