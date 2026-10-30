/**
 * dsh-repo-wiki — the operations shared by the RPC channel and the agent tools.
 *
 * Everything the Web panel can do and everything the `*_wiki` tools can do is
 * implemented here exactly once, against plain arguments. `lib/index.js` wraps
 * these in the RPC envelope; `lib/tools.js` wraps the same functions in tool
 * schemas. That keeps the two surfaces from drifting: a fix to the delete
 * cascade applies to both, and a tool test exercises the same code the panel
 * runs.
 *
 * @module dsh-repo-wiki/ops
 */

import { promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  CARD_CATEGORIES,
  CATALOG_STATUS,
  DEFAULT_SETTINGS,
  EDITABLE_SETTINGS,
  ERROR_CODES,
  GENERATION_TYPE,
  LANGUAGES,
  STATUS,
} from './constants.js';
import { emptyPlanYaml, hasDocumentWhitelist, parsePlan, renderPlanYaml } from './plan.js';
import {
  changedFiles,
  currentBranch,
  headCommit,
  isGitRepo,
  listRepoFiles,
  wikiExists,
} from './scan.js';
import {
  WikiError,
  applyTree,
  buildTree,
  cardIdFor,
  deletePage,
  emptyMetadata,
  flattenTree,
  hasContent,
  normalizeLanguage,
  pageBody,
  pagePath,
  planPath,
  readKnowledge,
  readMetadata,
  readPage,
  reconcilePagePaths,
  renderPage,
  safeFileName,
  withLock,
  writeMetadata,
  writePage,
} from './store.js';
import { deriveStatus, hasWiki, isRunning, progressPercent } from './status.js';
import { WikiPipeline, randomId } from './pipeline.js';

/** DSH home (`DSH_HOME` aware). */
export function dshHome() {
  return process.env.DSH_HOME || path.join(homedir(), '.dsh');
}

/** Settings file path. */
export function settingsFilePath() {
  return path.join(dshHome(), 'repo-wiki', 'settings.json');
}

/* ------------------------------------------------------------------------- *
 * Settings
 * ------------------------------------------------------------------------- */

/** Coerce one stored value to its declared type, or `undefined` when unusable. */
function coerceSetting(key, value) {
  switch (key) {
    case 'dataDir': {
      if (typeof value !== 'string' || value.trim() === '') return undefined;
      const normalized = value.trim().replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
      if (normalized === '' || normalized.startsWith('/') || normalized.split('/').includes('..')) return undefined;
      return normalized;
    }
    case 'language': {
      if (typeof value !== 'string') return undefined;
      const normalized = normalizeLanguage(value);
      return LANGUAGES.includes(normalized) ? normalized : undefined;
    }
    case 'maxFiles':
      return clampInt(value, 100, 200000, undefined);
    case 'maxDepth':
      return clampInt(value, 1, 8, undefined);
    case 'maxCitations':
      return clampInt(value, 0, 500, undefined);
    case 'concurrency':
      return clampInt(value, 1, 8, undefined);
    case 'autoUpdateDelayMs':
      return clampInt(value, 5000, 3600000, undefined);
    case 'promptMaxCatalogs':
      return clampInt(value, 0, 500, undefined);
    case 'autoUpdate':
    case 'citation':
    case 'promptEnabled':
      return typeof value === 'boolean' ? value : undefined;
    case 'provider':
    case 'model':
      return typeof value === 'string' ? value.trim() : undefined;
    default:
      return undefined;
  }
}

function clampInt(value, lo, hi, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(lo, Math.min(hi, Math.floor(number)));
}

/**
 * Normalize the settings object from profile config.
 *
 * `config` may use either the flat shape or a nested `prompt: {…}` block (the
 * shipped patch uses the nested one, because it reads better in YAML).
 * @param {unknown} config
 * @returns {{ values: object, warnings: string[] }}
 */
export function configSettings(config) {
  const source = config !== null && typeof config === 'object' ? config : {};
  const flat = { ...source };
  if (source.prompt !== null && typeof source.prompt === 'object') {
    if (source.prompt.enabled !== undefined) flat.promptEnabled = source.prompt.enabled;
    if (source.prompt.maxCatalogs !== undefined) flat.promptMaxCatalogs = source.prompt.maxCatalogs;
  }
  const values = {};
  const warnings = [];
  for (const key of EDITABLE_SETTINGS) {
    if (flat[key] === undefined) continue;
    const coerced = coerceSetting(key, flat[key]);
    if (coerced === undefined) {
      warnings.push(`config.${key} has an unusable value and was ignored`);
      continue;
    }
    values[key] = coerced;
  }
  return { values, warnings };
}

/** Normalize a saved settings document. */
export function sanitizeSettings(document) {
  const source = document !== null && typeof document === 'object' ? document : {};
  const values = {};
  const warnings = [];
  for (const key of EDITABLE_SETTINGS) {
    if (source[key] === undefined) continue;
    const coerced = coerceSetting(key, source[key]);
    if (coerced === undefined) {
      warnings.push(`settings.${key} has an unusable value and was ignored`);
      continue;
    }
    values[key] = coerced;
  }
  for (const key of Object.keys(source)) {
    // `workspaces` is the per-workspace override map, not a setting.
    if (key !== 'workspaces' && !EDITABLE_SETTINGS.includes(key)) warnings.push(`settings.${key} is not a known setting and was ignored`);
  }
  return { values, warnings };
}

async function readJsonFile(file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    return undefined;
  }
}

/**
 * Effective settings, per workspace.
 *
 * Qoder stores `quest.knowledge.repoWikiConfig` in PROFILE scope keyed by
 * workspace, so each repository carries its own dataDir/language/autoUpdate.
 * Our settings file mirrors that: top-level keys are the global defaults and a
 * `workspaces` object holds per-repository overrides. Precedence, weakest to
 * strongest: built-in defaults → profile config → global stored values → the
 * workspace's stored values.
 * @param {unknown} config
 * @param {string|null} [workspace] absolute workspace path, when scoped
 * @returns {Promise<{ values: object, file: string, stored: boolean, warnings: string[] }>}
 */
export async function effectiveSettings(config, workspace = null) {
  const file = settingsFilePath();
  const stored = await readJsonFile(file);
  const fromConfig = configSettings(config);
  const fromStore = stored === undefined ? { values: {}, warnings: [] } : sanitizeSettings(stored);
  const scopedSource =
    workspace !== null && stored !== null && typeof stored === 'object' && stored.workspaces !== null && typeof stored.workspaces === 'object'
      ? stored.workspaces[workspace]
      : undefined;
  const scoped = scopedSource === undefined ? { values: {}, warnings: [] } : sanitizeSettings(scopedSource);
  return {
    values: { ...DEFAULT_SETTINGS, ...fromConfig.values, ...fromStore.values, ...scoped.values },
    file,
    stored: stored !== undefined,
    warnings: [...fromConfig.warnings, ...fromStore.warnings, ...scoped.warnings],
  };
}

/**
 * Persist settings, atomically.
 *
 * With a workspace the patch lands under `workspaces[workspace]` — the Qoder
 * per-repository config; without one it updates the global defaults.
 */
export async function saveSettings(config, patch, workspace = null) {
  const file = settingsFilePath();
  const current = (await readJsonFile(file)) ?? {};
  const sanitized = sanitizeSettings(patch ?? {}).values;
  const merged = workspace === null
    ? { ...current, ...sanitized }
    : {
        ...current,
        workspaces: {
          ...(typeof current.workspaces === 'object' && current.workspaces !== null ? current.workspaces : {}),
          [workspace]: {
            ...(typeof current.workspaces?.[workspace] === 'object' && current.workspaces[workspace] !== null ? current.workspaces[workspace] : {}),
            ...sanitized,
          },
        },
      };
  return withLock(`settings:${file}`, async () => {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(temp, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    await fsp.rename(temp, file);
    return effectiveSettings(config, workspace);
  });
}

/**
 * Reset settings. With a workspace only that repository's overrides are
 * removed; without one the whole file goes, falling back to profile config +
 * defaults.
 */
export async function resetSettings(config, workspace = null) {
  const file = settingsFilePath();
  if (workspace === null) {
    await fsp.rm(file, { force: true });
    return effectiveSettings(config);
  }
  const current = (await readJsonFile(file)) ?? {};
  const workspaces = typeof current.workspaces === 'object' && current.workspaces !== null ? { ...current.workspaces } : {};
  delete workspaces[workspace];
  const merged = { ...current, workspaces };
  return withLock(`settings:${file}`, async () => {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(temp, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    await fsp.rename(temp, file);
    return effectiveSettings(config, workspace);
  });
}

/** Reset global values without removing any workspace-specific overrides. */
async function resetGlobalSettings(config) {
  const file = settingsFilePath();
  return withLock(`settings:${file}`, async () => {
    const current = (await readJsonFile(file)) ?? {};
    const workspaces = current.workspaces;
    if (!workspaces || typeof workspaces !== 'object' || Object.keys(workspaces).length === 0) {
      await fsp.rm(file, { force: true });
    } else {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      await fsp.writeFile(temp, `${JSON.stringify({ workspaces }, null, 2)}\n`, 'utf8');
      await fsp.rename(temp, file);
    }
    return effectiveSettings(config);
  });
}

/* ------------------------------------------------------------------------- *
 * Workspace resolution
 * ------------------------------------------------------------------------- */

function safeService(ctx, key) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(key, false) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the workspace for a call.
 *
 * Order: the tool's execution context, then the session named by the payload,
 * then the first registered workspace — and otherwise `null`, never the host's
 * process cwd. The tool path and the panel path must agree, so both go through
 * this function.
 * @param {object} ctx
 * @param {object} [exec]
 * @param {object} [payload]
 * @returns {string|null} `null` when nothing resolves a workspace
 */
export function workspaceFor(ctx, exec, payload = {}) {
  const direct = exec?.agent?.session?.header?.cwd;
  if (typeof direct === 'string' && direct.trim() !== '') return direct;
  // A root-scope panel has no session, so it names the workspace explicitly.
  // Only an absolute path is accepted: a RELATIVE value would silently resolve
  // against the host's cwd, which is not the workspace.
  if (typeof payload.workspace === 'string' && payload.workspace.trim() !== '') {
    const named = payload.workspace.trim();
    if (path.isAbsolute(named)) return named;
  }
  if (typeof payload.sessionId === 'string' && payload.sessionId !== '') {
    const sessions = safeService(ctx, 'sessions');
    const cwd = sessions?.get?.(payload.sessionId)?.header?.cwd;
    if (typeof cwd === 'string' && cwd.trim() !== '') return cwd;
  }
  const registry = safeService(ctx, 'workspaceRegistry');
  const fromRegistry = registry?.list?.()?.[0]?.path;
  if (typeof fromRegistry === 'string' && fromRegistry.trim() !== '') return fromRegistry;
  // Deliberately NOT `process.cwd()`. In this deployment the host process runs
  // with its cwd set to the *profile* directory, so falling back there would
  // read and write a wiki under `~/.dsh/profiles/desktop/.dsh/repowiki` — a
  // directory the user never asked about. Reporting "no workspace" is the honest
  // answer and the panel can prompt for one.
  return null;
}

/**
 * Resolve the workspace or fail with an actionable error.
 *
 * Every operation that touches the filesystem goes through this: a null
 * workspace must surface as a message the user can act on, not as a wiki
 * quietly materialising in the profile directory.
 * @param {object} ctx
 * @param {object} [exec]
 * @param {object} [payload]
 * @returns {string}
 * @throws {WikiError} with code `no-workspace`
 */
export function requireWorkspace(ctx, exec, payload = {}) {
  const workspace = workspaceFor(ctx, exec, payload);
  if (workspace === null) {
    throw new WikiError(
      ERROR_CODES.noWorkspace,
      'no workspace is open; open a folder in DSH before using Repo Wiki',
    );
  }
  return workspace;
}

/**
 * List the host's registered workspaces and resolve a composer session safely.
 *
 * `includeStatus` makes each item carry `{ status, language }` — one round
 * trip for the project-card wall instead of N `describe` calls. Per-workspace
 * failures degrade to `status: null` rather than sinking the whole list.
 */
export async function workspacesOp(ctx, config, _exec, payload = {}) {
  const registry = safeService(ctx, 'workspaceRegistry');
  const registered = typeof registry?.list === 'function' ? registry.list() ?? [] : [];
  const seen = new Set();
  const items = [];
  let sessionWorkspace = '';
  for (const workspace of registered) {
    const absolute = typeof workspace?.path === 'string' ? workspace.path : '';
    if (!path.isAbsolute(absolute) || seen.has(absolute)) continue;
    seen.add(absolute);
    items.push({ path: absolute, title: workspace.title || path.basename(absolute) || absolute });
    if (payload.sessionId && Array.from(workspace.sessionIds ?? []).some((id) => String(id) === String(payload.sessionId))) {
      sessionWorkspace = absolute;
    }
  }
  // An unresolved session must not silently select the first workspace.
  if (payload.includeStatus === true) {
    const pipeline = pipelineFor(ctx, config);
    await Promise.all(items.map(async (item) => {
      try {
        const effective = await effectiveSettings(config, item.path);
        const language = normalizeLanguage(effective.values.language);
        item.language = language;
        item.status = await pipeline.status(item.path, { ...effective.values, language });
      } catch {
        item.language = '';
        item.status = null;
      }
    }));
  }
  return { items, sessionWorkspace };
}

function settingsWorkspace(ctx, exec, payload) {
  return payload?.scope === 'global' ? null : workspaceFor(ctx, exec, payload);
}

/* ------------------------------------------------------------------------- *
 * Read operations
 * ------------------------------------------------------------------------- */

/**
 * The panel's bootstrap call: workspace, settings, status, and tree in one
 * round trip so opening the tab is one request rather than four.
 * @returns {Promise<object>}
 */
export async function describeOp(ctx, config, exec, payload) {
  const workspace = requireWorkspace(ctx, exec, payload);
  const effective = await effectiveSettings(config, workspace);
  const language = normalizeLanguage(payload?.language ?? effective.values.language);
  const settings = { ...effective.values, language };
  const pipeline = pipelineFor(ctx, config);
  const status = await pipeline.status(workspace, settings);
  const tree = await readTree(workspace, settings, language, { completedOnly: true });
  return {
    workspace,
    language,
    languages: [...LANGUAGES],
    settings: {
      values: effective.values,
      defaults: { ...DEFAULT_SETTINGS },
      file: effective.file,
      stored: effective.stored,
      warnings: effective.warnings,
    },
    plan: planPath(workspace, settings),
    status,
    catalogs: tree.catalogs,
    git: await gitSummary(workspace),
  };
}

/** Git facts the panel shows next to the status. */
async function gitSummary(workspace) {
  const [git, head, branch] = await Promise.all([
    isGitRepo(workspace),
    headCommit(workspace),
    currentBranch(workspace),
  ]);
  return { isRepo: git, head, branch };
}

/**
 * Settings-only read, for the settings page.
 *
 * Deliberately workspace-free: changing the model or the data directory must
 * work before a folder is open, and a settings page that fails with
 * "no workspace" would be a dead end with no way out.
 * @returns {Promise<object>}
 */
export async function settingsOp(ctx, config, exec, payload) {
  const workspace = settingsWorkspace(ctx, exec, payload);
  const effective = await effectiveSettings(config, workspace);
  return {
    settings: {
      values: effective.values,
      defaults: { ...DEFAULT_SETTINGS },
      file: effective.file,
      stored: effective.stored,
      warnings: effective.warnings,
    },
    plan: workspace === null ? '' : planPath(workspace, effective.values),
  };
}

/** Read and flatten the catalog tree for one language. */
export async function readTree(workspace, settings, language, options = {}) {
  let metadata;
  try {
    metadata = await readMetadata(workspace, settings, language);
  } catch (error) {
    if (error instanceof WikiError && error.code === ERROR_CODES.metadataCorrupt) {
      return { catalogs: [], flat: [], byId: new Map(), error: error.message };
    }
    throw error;
  }
  const tree = buildTree(metadata);
  const flat = flattenTree(tree);
  // Qoder's catalog query is `WHERE progress_status='completed'`: pending and
  // failed rows exist in the store but are invisible to readers.
  const visible = options.completedOnly === true
    ? flat.filter((node) => node.progress_status === CATALOG_STATUS.completed)
    : flat;
  const visibleIds = new Set(visible.map((node) => node.id));
  const catalogs = visible.map((node) => ({
    catalog_id: node.id,
    title: node.name,
    path: pagePath(node, tree.byId),
    parent_id: node.parent_id === '' ? null : node.parent_id,
    order: node.order,
    depth: depthOf(node, tree.byId),
    progress_status: node.progress_status ?? CATALOG_STATUS.pending,
    description: node.description ?? '',
    has_children: (node.children ?? []).some((child) => visibleIds.has(child.id)),
    dependent_files: typeof node.dependent_files === 'string' ? node.dependent_files.split(',').filter(Boolean) : [],
  }));
  return { catalogs, flat, byId: tree.byId, tree, metadata, error: '' };
}

function depthOf(node, byId) {
  let depth = 0;
  let cursor = node.parent_id === '' ? undefined : byId.get(node.parent_id);
  while (cursor !== undefined && depth < 64) {
    depth += 1;
    cursor = cursor.parent_id === '' ? undefined : byId.get(cursor.parent_id);
  }
  return depth;
}

/** Status for the panel. */
export async function statusOp(ctx, config, exec, payload) {
  const workspace = requireWorkspace(ctx, exec, payload);
  const effective = await effectiveSettings(config, workspace);
  const language = normalizeLanguage(payload?.language ?? effective.values.language);
  const status = await pipelineFor(ctx, config).status(workspace, { ...effective.values, language });
  const { catalogs } = await readTree(workspace, { ...effective.values, language }, language, { completedOnly: true });
  return { language, status, catalogs };
}

/** Catalogs for the panel. */
export async function catalogsOp(ctx, config, exec, payload) {
  const workspace = requireWorkspace(ctx, exec, payload);
  const effective = await effectiveSettings(config, workspace);
  const language = normalizeLanguage(payload?.language ?? effective.values.language);
  const { catalogs } = await readTree(workspace, { ...effective.values, language }, language, { completedOnly: true });
  const status = await pipelineFor(ctx, config).status(workspace, { ...effective.values, language });
  return { language, status, catalogs };
}

/**
 * One page's Markdown.
 * @returns {Promise<{ catalog_id: string, title: string, path: string, content: string }>}
 */
export async function contentOp(ctx, config, exec, payload) {
  const workspace = requireWorkspace(ctx, exec, payload);
  const effective = await effectiveSettings(config, workspace);
  const language = normalizeLanguage(payload?.language ?? effective.values.language);
  const settings = { ...effective.values, language };
  const { byId } = await readTree(workspace, settings, language);
  const node = byId.get(String(payload?.catalogId ?? payload?.catalog_id ?? ''));
  if (node === undefined) {
    throw new WikiError(ERROR_CODES.catalogNotFound, `no catalog "${payload?.catalogId ?? payload?.catalog_id ?? ''}"`);
  }
  const markdown = await readPage(workspace, settings, language, node, byId);
  return {
    catalog_id: node.id,
    title: node.name,
    path: pagePath(node, byId),
    content: markdown ?? '',
    missing: markdown === null,
  };
}

/* ------------------------------------------------------------------------- *
 * Plan
 * ------------------------------------------------------------------------- */

/**
 * Validate `wiki_plan.yaml`, in Qoder's `{valid, error_message, config_path}`
 * shape so a client written against Qoder keeps working.
 */
export async function validatePlanOp(ctx, config, exec, payload) {
  const workspace = requireWorkspace(ctx, exec, payload);
  const effective = await effectiveSettings(config, workspace);
  const file = planPath(workspace, { ...effective.values });
  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        valid: true, exists: false,
        error_message: '', config_path: file, diagnostics: [], rejection: null,
        errorMessage: '', configPath: file, plan: null,
      };
    }
    return {
      valid: false, exists: true,
      error_message: error.message, config_path: file, diagnostics: [error.message], rejection: 'io_error',
      errorMessage: error.message, configPath: file, plan: null,
    };
  }
  const result = parsePlan(text, file);
  return {
    valid: result.valid,
    exists: true,
    // Qoder's RPC returns snake_case (`error_message`, `config_path`,
    // `diagnostics`); the camelCase aliases stay for the existing panel.
    error_message: result.errorMessage,
    config_path: file,
    diagnostics: result.diagnostics,
    rejection: result.rejection,
    errorMessage: result.errorMessage,
    configPath: file,
    plan: result.plan,
  };
}

/** Write the starter `wiki_plan.yaml` when it is absent. */
export async function scaffoldPlanOp(ctx, config, exec, payload) {
  const workspace = requireWorkspace(ctx, exec, payload);
  const effective = await effectiveSettings(config, workspace);
  const file = planPath(workspace, effective.values);
  const exists = await fsp.access(file).then(() => true, () => false);
  if (exists && payload?.force !== true) {
    return { written: false, configPath: file };
  }
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, payload?.yaml ?? emptyPlanYaml(), 'utf8');
  return { written: true, configPath: file };
}

/* ------------------------------------------------------------------------- *
 * Generation controls
 * ------------------------------------------------------------------------- */

/**
 * The pipeline bound to this context.
 *
 * One instance per Cordis context, cached on a WeakMap: the run state (abort
 * controller, pause flag) has to be shared between the panel's `start` and its
 * `pause`, and it has to die with the context.
 */
const pipelines = new WeakMap();

function pipelineFor(ctx, config) {
  let pipeline = pipelines.get(ctx);
  if (pipeline === undefined) {
    pipeline = new WikiPipeline(ctx, config);
    pipelines.set(ctx, pipeline);
  }
  return pipeline;
}

/** Reset the cached pipeline for a context (tests and profile reloads). */
export function resetPipeline(ctx) {
  pipelines.delete(ctx);
}

/** Shared argument prep for every generation endpoint. */
async function generationArgs(ctx, config, exec, payload) {
  const workspace = requireWorkspace(ctx, exec, payload);
  const effective = await effectiveSettings(config, workspace);
  const language = normalizeLanguage(payload?.language ?? effective.values.language);
  return { workspace, settings: { ...effective.values, language }, language };
}

/** Start a full generation. */
export async function startOp(ctx, config, exec, payload) {
  const { workspace, settings, language } = await generationArgs(ctx, config, exec, payload);
  // wait:false: the panel polls `status`; returning early is what makes the
  // "start" call respond immediately instead of after the whole run.
  return pipelineFor(ctx, config).start(workspace, settings, {
    language,
    type: typeof payload?.type === 'string' ? payload.type : 'start',
    wait: false,
  });
}

/** Regenerate from scratch. */
export async function regenerateOp(ctx, config, exec, payload) {
  const { workspace, settings } = await generationArgs(ctx, config, exec, payload);
  return pipelineFor(ctx, config).regenerate(workspace, settings, { wait: false });
}

/** Incremental update. */
export async function updateOp(ctx, config, exec, payload) {
  const { workspace, settings } = await generationArgs(ctx, config, exec, payload);
  return pipelineFor(ctx, config).update(workspace, settings, { wait: false });
}

/** Pause the in-flight run. */
export async function pauseOp(ctx, config, exec, payload) {
  const { workspace } = await generationArgs(ctx, config, exec, payload);
  const paused = pipelineFor(ctx, config).pause(workspace);
  return { paused, status: await statusOp(ctx, config, exec, payload) };
}

/** Resume a paused run. */
export async function resumeOp(ctx, config, exec, payload) {
  const { workspace, settings } = await generationArgs(ctx, config, exec, payload);
  return pipelineFor(ctx, config).resume(workspace, settings, { wait: false });
}

/** Retry only the failed/pending pages of a `PARTLY_COMPLETED` run. */
export async function retryOp(ctx, config, exec, payload) {
  const { workspace, settings } = await generationArgs(ctx, config, exec, payload);
  return pipelineFor(ctx, config).retry(workspace, settings, { wait: false });
}

/** Cancel the in-flight run. */
export async function cancelOp(ctx, config, exec, payload) {
  const { workspace } = await generationArgs(ctx, config, exec, payload);
  const cancelled = pipelineFor(ctx, config).cancel(workspace);
  return { cancelled, status: await statusOp(ctx, config, exec, payload) };
}

/** Ask the pipeline to schedule an auto-update when HEAD moved. */
export async function maybeAutoUpdateOp(ctx, config, exec, payload) {
  const { workspace, settings } = await generationArgs(ctx, config, exec, payload);
  return pipelineFor(ctx, config).maybeAutoUpdate(workspace, settings);
}

/** Delete one language's index. */
export async function deleteIndexOp(ctx, config, exec, payload) {
  const { workspace, settings, language } = await generationArgs(ctx, config, exec, payload);
  const status = await pipelineFor(ctx, config).remove(workspace, settings, language);
  return { removed: true, status };
}

/** Regenerate one catalog subtree. */
export async function regenerateCatalogOp(ctx, config, exec, payload) {
  const { workspace, settings } = await generationArgs(ctx, config, exec, payload);
  const catalogId = String(payload?.catalogId ?? payload?.catalog_id ?? '');
  if (catalogId === '') throw new WikiError(ERROR_CODES.catalogNotFound, 'catalogId is required');
  return pipelineFor(ctx, config).regenerateCatalog(workspace, settings, catalogId);
}

/**
 * Change the language.
 *
 * Refused while a run is in flight: the pages being written and the tree being
 * read would disagree about which language directory they belong to.
 */
export async function changeLanguageOp(ctx, config, exec, payload) {
  const workspace = requireWorkspace(ctx, exec, payload);
  const effective = await effectiveSettings(config, workspace);
  const status = await pipelineFor(ctx, config).status(workspace, effective.values);
  if (isRunning(status.status)) {
    throw new WikiError(ERROR_CODES.languageLocked, 'cannot change the language while a generation is running', {
      status: status.status,
    });
  }
  const language = normalizeLanguage(payload?.language);
  await saveSettings(config, { language }, workspace);
  const settings = { ...(await effectiveSettings(config, workspace)).values, language };
  const tree = await readTree(workspace, settings, language, { completedOnly: true });
  return {
    language,
    status: await pipelineFor(ctx, config).status(workspace, settings),
    catalogs: tree.catalogs,
  };
}

/**
 * Import/export between the metadata store and the on-disk Markdown.
 *
 * `file_to_db` re-reads every page from disk and refreshes the metadata rows, so
 * a hand edit in an editor (or a `git pull` of someone else's export) is picked
 * up. `db_to_file` rewrites every page from the metadata — which for this plugin
 * is a no-op because the metadata never stores bodies, so it reports what it
 * would touch instead of pretending to do work.
 */
export async function synchronizeOp(ctx, config, exec, payload) {
  const { workspace, settings, language } = await generationArgs(ctx, config, exec, payload);
  const direction = payload?.direction === 'db_to_file' ? 'db_to_file' : 'file_to_db';
  const { byId, metadata } = await readTree(workspace, settings, language);
  const tree = buildTree(metadata);
  if (direction === 'db_to_file') {
    return {
      direction,
      imported: 0,
      exported: tree.order.length,
      note: 'page bodies live only on disk; db_to_file is a no-op for this plugin',
    };
  }
  let imported = 0;
  for (const node of tree.order) {
    const markdown = await readPage(workspace, settings, language, node, byId);
    if (markdown === null) {
      if (node.progress_status !== CATALOG_STATUS.failed) node.progress_status = CATALOG_STATUS.pending;
      continue;
    }
    node.progress_status = CATALOG_STATUS.completed;
    imported += 1;
  }
  applyTree(metadata, tree);
  metadata.wiki_repo = {
    ...metadata.wiki_repo,
    wiki_present_status: imported > 0 ? STATUS.COMPLETED : STATUS.WIKI_INIT,
    recovery_checkpoint: imported > 0 ? 'wiki_generation_completed' : '',
  };
  await writeMetadata(workspace, settings, language, metadata);
  return { direction, imported, exported: 0, note: '' };
}

/* ------------------------------------------------------------------------- *
 * Agent tool operations
 * ------------------------------------------------------------------------- */

/** `list_wiki`: the catalog tree, optionally filtered. */
export async function listWiki(ctx, config, exec, payload) {
  const workspace = requireWorkspace(ctx, exec, payload);
  const effective = await effectiveSettings(config, workspace);
  const language = normalizeLanguage(payload?.language ?? effective.values.language);
  const settings = { ...effective.values, language };
  const exists = await wikiExists(workspace, settings.dataDir);
  const { catalogs, error } = exists
    ? await readTree(workspace, settings, language, { completedOnly: true })
    : { catalogs: [], error: '' };
  const prefix = String(payload?.path ?? '').replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '');
  const filtered =
    prefix === '' || prefix === '.'
      ? catalogs
      : catalogs.filter((catalog) => catalog.path === prefix || catalog.path.startsWith(`${prefix}/`));
  return {
    workspace,
    language,
    generated: catalogs.length > 0,
    root: path.join(workspace, settings.dataDir, 'repowiki'),
    catalogs: filtered.map((catalog) => ({
      catalog_id: catalog.catalog_id,
      title: catalog.title,
      path: catalog.path,
      parent_id: catalog.parent_id,
      progress_status: catalog.progress_status,
      depth: catalog.depth,
    })),
    error,
  };
}

/** `read_wiki`: one page by id, or a search when `query` is given. */
export async function readWiki(ctx, config, exec, payload) {
  const workspace = requireWorkspace(ctx, exec, payload);
  const effective = await effectiveSettings(config, workspace);
  const language = normalizeLanguage(payload?.language ?? effective.values.language);
  const settings = { ...effective.values, language };
  const catalogId = String(payload?.catalogId ?? payload?.catalog_id ?? payload?.title ?? '').trim();
  if (catalogId === '') {
    const query = String(payload?.query ?? '').trim();
    if (query === '') throw new WikiError(ERROR_CODES.notFound, 'either catalog_id, title or query is required');
    return searchWiki(ctx, config, exec, { ...payload, query });
  }
  const { byId } = await readTree(workspace, settings, language);
  const node = byId.get(catalogId);
  if (node === undefined) {
    // Accept a title or a path as a convenience: an agent that just ran
    // list_wiki has ids, but a human pasting a title should not get an error.
    const match = [...byId.values()].find(
      (candidate) => candidate.name === catalogId || pagePath(candidate, byId) === catalogId,
    );
    if (match === undefined) {
      throw new WikiError(ERROR_CODES.catalogNotFound, `no catalog "${catalogId}"`, { catalogId });
    }
    return pageResult(workspace, settings, language, match, byId);
  }
  return pageResult(workspace, settings, language, node, byId);
}

async function pageResult(workspace, settings, language, node, byId) {
  const markdown = await readPage(workspace, settings, language, node, byId);
  return {
    catalog_id: node.id,
    title: node.name,
    path: pagePath(node, byId),
    content: markdown ?? '',
    missing: markdown === null,
    references: typeof node.dependent_files === 'string' ? node.dependent_files.split(',').filter(Boolean) : [],
  };
}

/**
 * `search_wiki`: substring search over titles and bodies.
 *
 * Case-insensitive, returns one hit per page with a context snippet. Bodies are
 * read from disk rather than from an index: a wiki is tens of pages, and keeping
 * an index in sync with hand edits is a worse trade than re-reading.
 */
export async function searchWiki(ctx, config, exec, payload) {
  const workspace = requireWorkspace(ctx, exec, payload);
  const effective = await effectiveSettings(config, workspace);
  const language = normalizeLanguage(payload?.language ?? effective.values.language);
  const settings = { ...effective.values, language };
  const query = String(payload?.query ?? '').trim();
  if (query === '') return { query, results: [] };
  const limit = clampInt(payload?.limit, 1, 100, 20);
  const { byId, flat } = await readTree(workspace, settings, language);
  const needle = query.toLowerCase();
  const results = [];
  for (const node of flat) {
    if (results.length >= limit) break;
    const markdown = await readPage(workspace, settings, language, node, byId);
    const haystack = `${node.name}\n${markdown ?? ''}`;
    const at = haystack.toLowerCase().indexOf(needle);
    if (at < 0) continue;
    results.push({
      catalog_id: node.id,
      title: node.name,
      path: pagePath(node, byId),
      snippet: snippetAround(haystack, at, query.length),
    });
  }
  return { query, results };
}

/** A one-line window around a match, with ellipses. */
export function snippetAround(text, index, length, radius = 60) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  const raw = text.slice(start, end).replace(/\s+/gu, ' ').trim();
  return `${start > 0 ? '…' : ''}${raw}${end < text.length ? '…' : ''}`;
}

/* ------------------------------------------------------------------------- *
 * Knowledge cards (Qoder's `listCards`/`getCard` surface)
 * ------------------------------------------------------------------------- */

/**
 * `list_knowledge`: the knowledge-card catalog for a workspace.
 *
 * Mirrors Qoder's `listCards` RPC: `{workspace_path, locale, protocol_version,
 * filters:[{key:'category'|'repository',value}], search:{mode,query}}` in,
 * `{hits:[{card}], total}` out. Cards without a body still appear — Qoder's
 * list is the module row, and an empty card is how the UI says "this module
 * has no notes in this category yet".
 */
export async function listKnowledge(ctx, config, exec, payload) {
  const workspace = requireWorkspace(ctx, exec, payload);
  const effective = await effectiveSettings(config, workspace);
  const language = normalizeLanguage(payload?.language ?? payload?.locale ?? effective.values.language);
  const cards = await readKnowledge(workspace, { ...effective.values, language }, language);

  const filters = Array.isArray(payload?.filters) ? payload.filters : [];
  const categories = filters
    .filter((entry) => entry && typeof entry === 'object' && (entry.key === 'category' || entry.key === 'categories'))
    .flatMap((entry) => Array.isArray(entry.value) ? entry.value : [entry.value])
    .map((value) => String(value ?? ''))
    .filter((value) => value !== '');
  const repositories = filters
    .filter((entry) => entry && typeof entry === 'object' && entry.key === 'repository')
    .flatMap((entry) => Array.isArray(entry.value) ? entry.value : [entry.value])
    .map((value) => String(value ?? ''));
  const query = typeof payload?.search === 'object' && payload.search !== null
    ? String(payload.search.query ?? '').trim().toLowerCase()
    : String(payload?.query ?? '').trim().toLowerCase();

  const hits = cards
    .filter((card) => categories.length === 0 || categories.includes(card.category))
    .filter((card) => repositories.length === 0 || repositories.some((repo) => workspace.endsWith(repo) || repo === workspace))
    .filter((card) => query === '' || `${card.title}\n${card.module}\n${card.excerpt}\n${card.content}`.toLowerCase().includes(query))
    .map((card) => ({
      card: {
        id: card.id,
        title: card.title,
        category: card.category,
        module: card.module,
        module_path: card.module_path,
        scope: card.scope,
        excerpt: card.excerpt,
        // `listCards` does not ship the body; the panel fetches it lazily via
        // getCard. Keeping it here is harmless and saves the panel a round
        // trip, but the field name stays `content` to match Qoder.
        content: card.content,
      },
    }));
  return { hits, total: hits.length, workspace, language };
}

/**
 * `read_knowledge`: one card plus its linked cards.
 *
 * `linked_cards` is Qoder's three-way split (parent/child/related). Our
 * `_module.yaml` only persists `related_to`, so parents and children are the
 * wiki tree's own hierarchy over the same module, not stored edges.
 */
export async function getKnowledge(ctx, config, exec, payload) {
  const workspace = requireWorkspace(ctx, exec, payload);
  const effective = await effectiveSettings(config, workspace);
  const language = normalizeLanguage(payload?.language ?? payload?.locale ?? effective.values.language);
  const id = String(payload?.id ?? payload?.card_id ?? '');
  if (id === '') throw new WikiError(ERROR_CODES.catalogNotFound, 'no card id given');
  const cards = await readKnowledge(workspace, { ...effective.values, language }, language);
  const card = cards.find((entry) => entry.id === id);
  if (card === undefined) {
    throw new WikiError(ERROR_CODES.catalogNotFound, `no knowledge card "${id}"`);
  }
  // Cards in the same module are each other's context: an overview pairs with
  // its architecture and conventions. Qoder's `link_type` splits parents,
  // children and plain relations; a flat module has no parent/child direction,
  // so related covers everything the module links to.
  const byModule = new Map();
  for (const entry of cards) {
    if (!byModule.has(entry.module)) byModule.set(entry.module, []);
    byModule.get(entry.module).push(entry);
  }
  const linked = (card.related_to ?? [])
    .map((modulePath) => modulePath.replace(/[/\\]/gu, '_'))
    .flatMap((moduleDir) => byModule.get(moduleDir) ?? [])
    .map((entry) => ({ link_type: 'related', card: { id: entry.id, title: entry.title, category: entry.category, module: entry.module } }));
  const siblings = (byModule.get(card.module) ?? [])
    .filter((entry) => entry.id !== card.id)
    .map((entry) => ({ link_type: 'related', card: { id: entry.id, title: entry.title, category: entry.category, module: entry.module } }));
  return {
    card: { ...card },
    linkedCards: [...siblings, ...linked],
    workspace,
    language,
  };
}

/** `write_wiki`: whole-page write, creating the catalog when absent. */
export async function writeWiki(ctx, config, exec, payload) {
  const workspace = requireWorkspace(ctx, exec, payload);
  const effective = await effectiveSettings(config, workspace);
  const language = normalizeLanguage(payload?.language ?? effective.values.language);
  const settings = { ...effective.values, language };
  const content = String(payload?.content ?? '');
  if (content.trim() === '') throw new WikiError(ERROR_CODES.internal, 'content must not be empty');

  const { metadata } = await readTree(workspace, settings, language);
  const tree = buildTree(metadata.wiki_catalogs.length === 0 ? emptyMetadata() : metadata);
  const requestedId = String(payload?.catalogId ?? payload?.catalog_id ?? '').trim();
  const title = String(payload?.title ?? '').trim();

  const requestedPath = String(payload?.path ?? '').replaceAll('\\', '/').replace(/^\.\//u, '').trim();
  let node = requestedId === '' ? undefined : tree.byId.get(requestedId);
  if (node === undefined && title !== '') {
    node = [...tree.byId.values()].find((candidate) => candidate.name === title);
  }
  if (node === undefined && requestedPath !== '') {
    node = [...tree.byId.values()].find((candidate) => pagePath(candidate, tree.byId) === requestedPath);
  }
  const created = node === undefined;
  if (created) {
    if (title === '') throw new WikiError(ERROR_CODES.internal, 'title is required when creating a page');
    const parentId = String(payload?.parentId ?? payload?.parent_id ?? '').trim();
    const parent = parentId === '' ? undefined : tree.byId.get(parentId);
    node = {
      id: `catalog-${randomId().slice(0, 8)}`,
      name: title,
      description: String(payload?.description ?? '').trim(),
      prompt: '',
      dependent_files: [],
      parent_id: parent === undefined ? '' : parent.id,
      order: (parent?.children?.length ?? tree.roots.length),
      progress_status: CATALOG_STATUS.completed,
      children: [],
    };
    tree.byId.set(node.id, node);
    if (parent === undefined) tree.roots.push(node);
    else parent.children.push(node);
  }

  // A page that just gained its first child became a category, so its own
  // Markdown has to move into the new directory before we write the child.
  await reconcilePagePaths(workspace, settings, language, tree);
  const markdown = content.trimStart().startsWith('# ')
    ? content
    : renderPage({
        title: node.name,
        refs: Array.isArray(payload?.references) ? payload.references : [],
        body: content,
        maxCitations: settings.maxCitations,
      });
  const references = Array.isArray(payload?.references) ? payload.references : [];
  const relative = await writePage(workspace, settings, language, node, markdown, tree.byId);
  node.progress_status = CATALOG_STATUS.completed;
  // Keep the citation list on the catalog so `read_wiki` can report it and the
  // next generation can reuse it as the page's dependency set.
  if (references.length > 0) node.dependent_files = references.join(',');
  applyTree(metadata, tree);
  metadata.wiki_repo = {
    ...metadata.wiki_repo,
    wiki_present_status: STATUS.COMPLETED,
    recovery_checkpoint: 'wiki_generation_completed',
  };
  await writeMetadata(workspace, settings, language, metadata);
  return { catalog_id: node.id, title: node.name, path: relative, created };
}

/** `edit_wiki`: find/replace inside one page. */
export async function editWiki(ctx, config, exec, payload) {
  const workspace = requireWorkspace(ctx, exec, payload);
  const effective = await effectiveSettings(config, workspace);
  const language = normalizeLanguage(payload?.language ?? effective.values.language);
  const settings = { ...effective.values, language };
  const catalogId = String(payload?.catalogId ?? payload?.catalog_id ?? payload?.title ?? '').trim();
  if (catalogId === '') throw new WikiError(ERROR_CODES.catalogNotFound, 'catalog_id is required');

  const { byId } = await readTree(workspace, settings, language);
  const node = byId.get(catalogId) ?? [...byId.values()].find((candidate) => candidate.name === catalogId);
  if (node === undefined) throw new WikiError(ERROR_CODES.catalogNotFound, `no catalog "${catalogId}"`, { catalogId });

  // Qoder's edit_wiki replaces the whole body. Support that shape first, then
  // fall back to a substring patch.
  if (typeof payload?.content === 'string' && payload.content.trim() !== '') {
    const references = Array.isArray(payload?.references) ? payload.references : [];
    const markdown = renderPage({
      title: node.name,
      refs: references,
      body: payload.content,
      maxCitations: settings.maxCitations,
    });
    await writePage(workspace, settings, language, node, markdown, byId);
    return { catalog_id: node.id, title: node.name, replacements: 1, wholePage: true };
  }

  const find = String(payload?.find ?? '');
  const replace = String(payload?.replace ?? '');
  if (find === '') throw new WikiError(ERROR_CODES.internal, 'either content, or find+replace, is required');
  const markdown = await readPage(workspace, settings, language, node, byId);
  if (markdown === null) throw new WikiError(ERROR_CODES.pageNotFound, `"${node.name}" has no page yet`, { catalogId });

  const all = payload?.all === true;
  const occurrences = countOccurrences(markdown, find);
  if (occurrences === 0) throw new WikiError(ERROR_CODES.notFound, `"${find}" does not appear in "${node.name}"`);
  if (!all && occurrences > 1) {
    throw new WikiError(ERROR_CODES.ambiguousEdit, `"${find}" appears ${occurrences} times in "${node.name}"; pass all:true or use a longer find string`, {
      occurrences,
    });
  }
  const next = all ? markdown.split(find).join(replace) : markdown.replace(find, replace);
  await writePage(workspace, settings, language, node, next, byId);
  return { catalog_id: node.id, title: node.name, replacements: all ? occurrences : 1 };
}

/** Count non-overlapping occurrences. */
export function countOccurrences(haystack, needle) {
  if (needle === '') return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * `delete_wiki`: remove a page and, by default, its subtree.
 * @returns {Promise<{ deleted: string[], skipped: string[] }>}
 */
export async function deleteWiki(ctx, config, exec, payload) {
  const workspace = requireWorkspace(ctx, exec, payload);
  const effective = await effectiveSettings(config, workspace);
  const language = normalizeLanguage(payload?.language ?? effective.values.language);
  const settings = { ...effective.values, language };
  const rawTarget = String(payload?.catalogId ?? payload?.catalog_id ?? payload?.title ?? payload?.path ?? '').trim();
  if (rawTarget === '') throw new WikiError(ERROR_CODES.catalogNotFound, 'catalog_id, title or path is required');

  const { metadata } = await readTree(workspace, settings, language);
  const tree = buildTree(metadata);
  const node =
    tree.byId.get(rawTarget) ??
    [...tree.byId.values()].find((candidate) => candidate.name === rawTarget) ??
    [...tree.byId.values()].find((candidate) => pagePath(candidate, tree.byId) === rawTarget);
  if (node === undefined) throw new WikiError(ERROR_CODES.catalogNotFound, `no catalog "${rawTarget}"`, { catalogId: rawTarget });

  const cascade = payload?.cascade !== false;
  const removed = [];
  const collect = (current) => {
    removed.push(current);
    for (const child of current.children ?? []) collect(child);
  };
  if (cascade) {
    collect(node);
  } else {
    // Non-cascading delete promotes the children to the deleted node's parent.
    // This has to move them in the *tree*, not just set `parent_id`: `applyTree`
    // derives the persisted parent link from the tree's shape, so a bare
    // `parent_id` assignment would be discarded on the next write.
    removed.push(node);
    const promotedTo = node.parent_id === '' ? null : node.parent_id;
    const siblings = promotedTo === null ? tree.roots : tree.byId.get(promotedTo)?.children ?? tree.roots;
    const index = siblings.indexOf(node);
    const children = node.children ?? [];
    for (const child of children) child.parent_id = promotedTo ?? '';
    if (index >= 0) siblings.splice(index, 1, ...children);
    else siblings.push(...children);
    node.children = [];
  }

  const deleted = [];
  for (const target of removed) {
    await deletePage(workspace, settings, language, target, tree.byId);
    deleted.push(target.id);
  }

  const removedIds = new Set(deleted);
  const prune = (nodes) => {
    for (const current of [...nodes]) {
      if (removedIds.has(current.id)) {
        nodes.splice(nodes.indexOf(current), 1);
        tree.byId.delete(current.id);
        continue;
      }
      prune(current.children ?? []);
    }
  };
  prune(tree.roots);
  // A category that just lost its last child becomes a leaf again; move its page
  // back out of the now-empty directory.
  await reconcilePagePaths(workspace, settings, language, tree);
  applyTree(metadata, tree);
  if (tree.order.length === 0) metadata.wiki_repo.wiki_present_status = STATUS.WIKI_INIT;
  await writeMetadata(workspace, settings, language, metadata);
  return { deleted, skipped: [] };
}

/* ------------------------------------------------------------------------- *
 * RPC dispatch
 * ------------------------------------------------------------------------- */

/**
 * Enumerate the model routes the host can actually serve.
 *
 * The settings page needs a dropdown, not two free-text boxes: a user does not
 * know that their provider route is called `deepseek-official` or that the model
 * id is `deepseek-v4-flash`. This asks the host instead of guessing.
 *
 * Providers come from `ctx.llm.listProviders()`; models from
 * `llm.listModels(provider)` — an adapter that cannot enumerate models (an
 * OpenAI-compatible endpoint without a catalog, say) contributes its provider
 * row with an empty model list, and the client falls back to a text input for
 * that provider rather than hiding it.
 *
 * @returns {Promise<{ providers: object[], defaultRoute: object|null, llmAvailable: boolean, error: string }>}
 */
export async function modelsOp(ctx) {
  const llm = safeService(ctx, 'llm');
  if (llm === undefined || llm === null) {
    return {
      providers: [],
      defaultRoute: null,
      llmAvailable: false,
      error: 'the host exposes no llm service; mount a provider adapter to pick a model',
    };
  }

  const providers = [];
  const errors = [];
  let list = [];
  try {
    list = typeof llm.listProviders === 'function' ? llm.listProviders() ?? [] : [];
  } catch (error) {
    errors.push(`listProviders failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const entry of list) {
    const id = typeof entry?.id === 'string' ? entry.id : typeof entry?.provider === 'string' ? entry.provider : '';
    if (id === '') continue;
    const models = [];
    try {
      if (typeof llm.listModels === 'function') {
        for (const model of (await llm.listModels(id)) ?? []) {
          if (typeof model?.id !== 'string' || model.id === '') continue;
          models.push({
            id: model.id,
            name: typeof model.name === 'string' && model.name !== '' ? model.name : model.id,
            description: typeof model.description === 'string' ? model.description : '',
            inputModalities: Array.isArray(model.inputModalities) ? model.inputModalities : [],
          });
        }
      }
    } catch (error) {
      // A provider that cannot list models is still selectable; the client then
      // offers a free-text model field for it.
      errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    providers.push({
      id,
      name: typeof entry?.name === 'string' && entry.name !== '' ? entry.name : id,
      models,
      enumerable: models.length > 0,
    });
  }

  // The deployment default, so the settings page can show what "empty" means.
  let defaultRoute = null;
  const defaults = safeService(ctx, 'agentDefaultModel');
  if (defaults !== undefined && defaults !== null) {
    try {
      const selection =
        typeof defaults.currentSelection === 'function'
          ? defaults.currentSelection()
          : typeof defaults.get === 'function'
            ? defaults.get()
            : undefined;
      if (selection?.provider && selection?.model) {
        defaultRoute = { provider: selection.provider, model: selection.model };
      }
    } catch {
      // an unreadable default is not fatal
    }
  }

  return {
    providers,
    defaultRoute,
    llmAvailable: true,
    error: errors.length === 0 ? '' : errors.join('; '),
  };
}

/** The RPC method table. */
const RPC = {
  describe: describeOp,
  workspaces: workspacesOp,
  models: modelsOp,
  settings: settingsOp,
  status: statusOp,
  catalogs: catalogsOp,
  content: contentOp,
  validatePlan: validatePlanOp,
  scaffoldPlan: scaffoldPlanOp,
  start: startOp,
  regenerate: regenerateOp,
  update: updateOp,
  maybeAutoUpdate: maybeAutoUpdateOp,
  pause: pauseOp,
  resume: resumeOp,
  retry: retryOp,
  cancel: cancelOp,
  deleteIndex: deleteIndexOp,
  regenerateCatalog: regenerateCatalogOp,
  changeLanguage: changeLanguageOp,
  synchronize: synchronizeOp,
  saveSettings: async (ctx, config, exec, payload) => {
    const workspace = settingsWorkspace(ctx, exec, payload);
    const effective = await saveSettings(config, payload?.values ?? {}, workspace);
    return { settings: { values: effective.values, defaults: { ...DEFAULT_SETTINGS }, file: effective.file, stored: effective.stored, warnings: effective.warnings }, workspace };
  },
  resetSettings: async (ctx, config, exec, payload) => {
    const workspace = settingsWorkspace(ctx, exec, payload);
    const effective = payload?.scope === 'global'
      ? await resetGlobalSettings(config)
      : await resetSettings(config, workspace);
    return { settings: { values: effective.values, defaults: { ...DEFAULT_SETTINGS }, file: effective.file, stored: effective.stored, warnings: effective.warnings }, workspace };
  },
  // Tool surface over RPC, so the panel can reuse the exact same code paths.
  listWiki,
  readWiki,
  writeWiki,
  editWiki,
  deleteWiki,
  searchWiki,
  listKnowledge,
  getKnowledge,
};

/** Whether a method name is served. */
export function hasRpcMethod(method) {
  return Object.hasOwn(RPC, method);
}

/**
 * Dispatch one RPC call.
 * @param {object} ctx
 * @param {unknown} config
 * @param {string} method
 * @param {object} payload
 * @returns {Promise<unknown>}
 */
export async function dispatchRpc(ctx, config, method, payload) {
  const handler = RPC[method];
  if (handler === undefined) {
    throw new WikiError(ERROR_CODES.unknownMethod, `unknown RPC endpoint "${String(method)}"`, { method });
  }
  return handler(ctx, config, null, payload !== null && typeof payload === 'object' ? payload : {});
}

/** Whether the workspace has a readable wiki (used by the prompt section). */
export async function hasWikiFor(workspace, settings, language) {
  const exists = await wikiExists(workspace, settings.dataDir);
  if (!exists) return false;
  const content = await hasContent(workspace, settings, language);
  if (!content) return false;
  const { catalogs } = await readTree(workspace, settings, language, { completedOnly: true });
  return catalogs.length > 0;
}

/** Catalog prompt lines for the dynamic prompt section. */
export async function catalogPromptLines(workspace, settings, language, limit) {
  const { catalogs, metadata } = await readTree(workspace, settings, language, { completedOnly: true });
  const status = metadata?.wiki_repo?.wiki_present_status ?? STATUS.WIKI_INIT;
  const lines = [];
  for (const catalog of catalogs.slice(0, limit)) {
    const indent = '  '.repeat(Math.min(catalog.depth, 6));
    lines.push(`${indent}- ${catalog.title} (${catalog.path}) [${catalog.progress_status}]`);
  }
  return { status, lines, total: catalogs.length };
}

export { deriveStatus, hasWiki, progressPercent, pageBody, readKnowledge, safeFileName, writeMetadata };
