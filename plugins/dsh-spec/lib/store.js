/**
 * dsh-spec — workspace storage.
 *
 * Reads never rewrite anything; writes are limited to what Kiro itself owns:
 *
 *   - create one spec directory from the official document skeletons
 *     (`.config.kiro` + the documents for the chosen workflow/spec type),
 *   - flip one task checkbox in place, keeping its indentation, optional
 *     marker and surrounding text byte-identical,
 *   - append/replace `tasks.meta.json` (execution history, PBT results),
 *   - write a document the caller supplies (whole-document replacement only —
 *     there is no line-level editing API, which is what keeps `design.md`
 *     authored by a human safe).
 *
 * Every write is atomic (temp file + rename) and serialized per spec.
 *
 * @module dsh-spec/store
 */

import { promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  CONFIG_FILE,
  SpecError,
  assertFeatureName,
  listSpecs,
  loadSpec,
  resolveFeatureName,
  specsRoot,
} from './model.js?dsh-spec=0.8.0';
import {
  applyStatusChanges,
  metadataPathFor,
  planStatusChange,
  readMetadata,
  readyTasks,
  recordExecution,
  recordPbtResult,
} from './tasks.js?dsh-spec=0.8.0';
import { documentSet, requirementsFileName } from './templates.js?dsh-spec=0.8.0';

const locks = new Map();

/** Serialize work on one logical key. */
export function withLock(key, task) {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const guard = run.catch(() => {});
  locks.set(key, guard);
  guard.then(() => {
    if (locks.get(key) === guard) locks.delete(key);
  });
  return run;
}

/** DSH home (`DSH_HOME` aware). */
export function dshHome() {
  return process.env.DSH_HOME || path.join(homedir(), '.dsh');
}

/** Plugin settings file. */
export function settingsFilePath() {
  return path.join(dshHome(), 'spec', 'settings.json');
}

/**
 * The active profile's patch layer (`cordis.patch.yml`).
 *
 * The Web client persists the user's language choice there (the `locale`
 * plugin's config), and the host exposes no RPC for it — so this is where the
 * server half reads "the language the user picked for DSH". `DSH_PROFILE` names
 * the profile the service was started with; the web profile is the only one a
 * browser client talks to.
 */
export function profilePatchPath(env = process.env) {
  const profile = typeof env.DSH_PROFILE === 'string' && env.DSH_PROFILE !== '' ? env.DSH_PROFILE : 'web';
  return path.join(dshHome(), 'profiles', profile, 'cordis.patch.yml');
}

/**
 * Session state file: which spec each Web session is working on, plus the
 * draft type/workflow chosen before a spec exists.
 *
 * This is DSH state, not Kiro state: `.config.kiro` stays byte-compatible with
 * Kiro and never records which chat session created a spec.
 */
export function sessionsFilePath() {
  return path.join(dshHome(), 'spec', 'sessions.json');
}

const EMPTY_SESSION_STATE = { bindings: {}, drafts: {} };

/** Read the session state, tolerating an absent or malformed file. */
export async function readSessionState() {
  let raw;
  try {
    raw = await readJson(sessionsFilePath());
  } catch {
    return { ...EMPTY_SESSION_STATE, bindings: {}, drafts: {} };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { bindings: {}, drafts: {} };
  }
  const bindings = {};
  for (const [sessionId, value] of Object.entries(raw.bindings ?? {})) {
    if (value !== null && typeof value === 'object' && typeof value.feature === 'string' && value.feature !== '') {
      bindings[sessionId] = { feature: value.feature, boundAt: typeof value.boundAt === 'number' ? value.boundAt : 0 };
    }
  }
  const drafts = {};
  for (const [sessionId, value] of Object.entries(raw.drafts ?? {})) {
    if (value !== null && typeof value === 'object') {
      drafts[sessionId] = {
        specType: typeof value.specType === 'string' ? value.specType : undefined,
        workflowType: typeof value.workflowType === 'string' ? value.workflowType : undefined,
        updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
      };
    }
  }
  return { bindings, drafts };
}

/** Apply one mutation to the session state under a single lock. */
async function mutateSessionState(mutate) {
  const file = sessionsFilePath();
  return withLock(`sessions:${file}`, async () => {
    const state = await readSessionState();
    const next = mutate({ bindings: { ...state.bindings }, drafts: { ...state.drafts } });
    await writeJson(file, next);
    return next;
  });
}

/** Bind one session to a spec feature. */
export async function bindSession(sessionId, feature) {
  const next = await mutateSessionState((state) => {
    state.bindings[sessionId] = { feature, boundAt: Date.now() };
    delete state.drafts[sessionId];
    return state;
  });
  return next.bindings[sessionId] ?? null;
}

/** Drop one session's binding and draft. */
export async function unbindSession(sessionId) {
  const next = await mutateSessionState((state) => {
    delete state.bindings[sessionId];
    delete state.drafts[sessionId];
    return state;
  });
  return next.bindings[sessionId] ?? null;
}

/** Store the draft type/workflow a session chose before creating a spec. */
export async function saveSessionDraft(sessionId, draft) {
  const next = await mutateSessionState((state) => {
    const previous = state.drafts[sessionId] ?? {};
    state.drafts[sessionId] = {
      specType: draft.specType ?? previous.specType,
      workflowType: draft.workflowType ?? previous.workflowType,
      updatedAt: Date.now(),
    };
    return state;
  });
  return next.drafts[sessionId] ?? null;
}

async function exists(target) {
  try {
    await fsp.stat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function writeAtomic(filePath, content) {
  const directory = path.dirname(filePath);
  await fsp.mkdir(directory, { recursive: true });
  const temp = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  try {
    await fsp.writeFile(temp, content, 'utf8');
    await fsp.rename(temp, filePath);
  } catch (error) {
    await fsp.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

/** Read JSON, returning `undefined` when absent. */
export async function readJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Write JSON atomically. */
export async function writeJson(file, value) {
  await writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Create one spec directory from Kiro's templates.
 *
 * @param {string} workspace
 * @param {{ feature?: string, title?: string, specType?: string, workflowType?: string, documents?: string[] }} options
 * @returns {Promise<{feature: string, directory: string, files: string[]}>}
 */
export async function createSpecDirectory(workspace, options) {
  const specType = options.specType === 'bugfix' ? 'bugfix' : options.specType === 'quick-spec' ? 'quick-spec' : 'feature';
  const workflowType = ['requirements-first', 'design-first', 'fast-task', 'verify-first'].includes(options.workflowType)
    ? options.workflowType
    : 'requirements-first';
  const root = typeof options.root === 'string' && options.root !== '' ? options.root : specsRoot(workspace);
  return withLock(`root:${root}`, async () => {
    const feature = await resolveFeatureName(root, options);
    const directory = path.join(root, feature);
    await fsp.mkdir(directory, { recursive: true });
    try {
      const config = {
        specId: crypto.randomUUID(),
        workflowType,
        specType,
      };
      await writeJson(path.join(directory, CONFIG_FILE), config);
      const set = documentSet({ feature, specType, workflowType });
      const wanted = Array.isArray(options.documents) && options.documents.length > 0
        ? options.documents
        : ['requirements', 'design', 'tasks'];
      const files = [];
      for (const doc of wanted) {
        if (typeof set[doc] !== 'string') continue;
        const name = doc === 'requirements' ? requirementsFileName(specType) : `${doc}.md`;
        await writeAtomic(path.join(directory, name), set[doc]);
        files.push(name);
      }
      return { feature, directory, files };
    } catch (error) {
      await fsp.rm(directory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  });
}

/** Resolve one spec directory or throw. */
export async function requireSpec(root, feature) {
  const name = assertFeatureName(feature);
  const directory = path.join(root, name);
  if (!(await exists(directory))) {
    throw new SpecError('spec-not-found', `spec "${name}" does not exist in ${root}`, { feature: name, root });
  }
  return { name, directory };
}

/**
 * Replace one whole document. The caller is responsible for the content; this
 * is how an agent commits a generated `design.md`.
 */
export async function writeDocument(root, feature, fileName, text) {
  const allowed = new Set(['requirements.md', 'bugfix.md', 'design.md', 'tasks.md']);
  if (!allowed.has(fileName)) {
    throw new SpecError('invalid-document', `"${fileName}" is not a spec document`, { fileName });
  }
  const { name, directory } = await requireSpec(root, feature);
  return withLock(`spec:${directory}`, async () => {
    if (typeof text !== 'string' || text.trim() === '') {
      throw new SpecError('invalid-document', 'document content must be a non-empty string');
    }
    await writeAtomic(path.join(directory, fileName), text.endsWith('\n') ? text : `${text}\n`);
    return { feature: name, file: fileName, path: path.join(directory, fileName) };
  });
}

/**
 * Apply a task status change, propagating parent completion and syncing
 * `tasks.meta.json`, exactly like Kiro's `task_update`.
 *
 * @param {string} workspace
 * @param {string} feature
 * @param {string} taskId
 * @param {'not_started'|'queued'|'in_progress'|'completed'} status
 * @param {{ executionId?: string, chatSessionId?: string }} [context]
 */
export async function updateTaskStatus(workspace, feature, taskId, status, context = {}) {
  const root = typeof context.root === 'string' && context.root !== '' ? context.root : specsRoot(workspace);
  const { directory } = await requireSpec(root, feature);
  return withLock(`spec:${directory}`, async () => {
    const spec = await loadSpec(root, feature);
    if (spec.tasks === null) {
      throw new SpecError('missing-document', `spec "${feature}" has no tasks.md`, { feature });
    }
    const plan = planStatusChange(spec.tasks, taskId, status);
    if (plan.error !== undefined) throw new SpecError('invalid-task-transition', plan.error, { taskId });
    const file = path.join(directory, 'tasks.md');
    const original = await fsp.readFile(file, 'utf8');
    const next = applyStatusChanges(original, plan.changes);
    if (next !== original) await writeAtomic(file, next);

    const metadataFile = metadataPathFor(file);
    const metadata = await readMetadata(file);
    if (context.executionId !== undefined && context.chatSessionId !== undefined) {
      recordExecution(metadata, taskId, {
        executionId: context.executionId,
        chatSessionId: context.chatSessionId,
      });
    }
    await writeJson(metadataFile, metadata);

    let ready = [];
    try {
      const reread = await loadSpec(root, feature);
      if (reread.tasks !== null) ready = readyTasks(reread.tasks).map((task) => ({ id: task.id, title: task.title, optional: task.optional }));
    } catch {
      ready = [];
    }

    return {
      feature,
      taskId,
      status,
      propagated: plan.changes.filter((change) => change.taskId !== taskId),
      warnings: plan.warnings ?? [],
      ready,
    };
  });
}

/** Record a PBT task result in tasks.meta.json. */
export async function updatePbtStatus(workspace, feature, taskId, result, rootOverride) {
  const root = typeof rootOverride === 'string' && rootOverride !== '' ? rootOverride : specsRoot(workspace);
  const { directory } = await requireSpec(root, feature);
  return withLock(`spec:${directory}`, async () => {
    const tasksFile = path.join(directory, 'tasks.md');
    if (!(await exists(tasksFile))) {
      throw new SpecError('missing-document', `spec "${feature}" has no tasks.md`, { feature });
    }
    const metadata = await readMetadata(tasksFile);
    const recorded = recordPbtResult(metadata, taskId, result).pbtResults[taskId];
    await writeJson(metadataPathFor(tasksFile), metadata);
    // Return the record that was written, not the caller's arguments. The host
    // snapshots every tool result as lossless JSON, and an `undefined` property
    // (a passing run's `failingExample`) is rejected with a tool output error —
    // so echoing the arguments made every passing spec_pbt call fail even
    // though the result had already landed in tasks.meta.json.
    return { feature, taskId, ...recorded };
  });
}

/** Read the spec list without throwing on missing roots. */
export async function readSpecIndex(workspace, rootOverride) {
  const root = typeof rootOverride === 'string' && rootOverride !== '' ? rootOverride : specsRoot(workspace);
  return listSpecs(root);
}

/** Read one spec + metadata. */
export async function readSpec(workspace, feature, rootOverride) {
  const root = typeof rootOverride === 'string' && rootOverride !== '' ? rootOverride : specsRoot(workspace);
  const spec = await loadSpec(root, feature);
  const metadata = spec.documents['tasks.md'] === undefined
    ? { pbtResults: {}, executionHistory: {} }
    : await readMetadata(path.join(spec.directory, 'tasks.md'));
  return { spec, metadata };
}

/** Whether this workspace has a spec root (cheap prompt-context probe). */
export async function hasSpecs(workspace, rootOverride) {
  const root = typeof rootOverride === 'string' && rootOverride !== '' ? rootOverride : specsRoot(workspace);
  return exists(root);
}
