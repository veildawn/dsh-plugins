/**
 * dsh-spec — the Spec model over Kiro's on-disk layout.
 *
 * A spec is a directory:
 *
 *   .kiro/specs/<feature>/
 *     .config.kiro      {"specId", "workflowType", "specType"}
 *     requirements.md   (or bugfix.md for specType "bugfix")
 *     design.md
 *     tasks.md
 *     tasks.meta.json   execution history + PBT results
 *
 * The Markdown files are the source of truth. This module only reads and
 * derives: phases, requirement clauses, progress, and readiness. Writes are
 * narrow (skeleton creation, task checkbox updates, metadata) so a spec that
 * was hand-edited or produced by Kiro itself keeps working unchanged.
 *
 * @module dsh-spec/model
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  SPEC_TYPES,
  WORKFLOW_TYPES,
  documentKindOf,
  lintRequirementsSemantics,
  validateDocument,
} from './validate.js?dsh-spec=0.8.1';
import {
  attachWaveInfo,
  parseDependencyGraph,
  parseTasks,
  readyTasks,
  reconcileDependencyGraph,
  taskProgress,
} from './tasks.js?dsh-spec=0.8.1';

export { SPEC_TYPES, WORKFLOW_TYPES, DOCUMENT_TYPES, documentKindOf } from './validate.js?dsh-spec=0.8.1';

/** Directory Kiro uses for specs and settings. */
export const KIRO_DIR = '.kiro';
export const SPECS_DIR = path.join(KIRO_DIR, 'specs');
export const CONFIG_FILE = '.config.kiro';
export const DOCUMENTS = ['requirements.md', 'bugfix.md', 'design.md', 'tasks.md'];

/** Default workflow when `.config.kiro` is missing or unreadable. */
export const DEFAULT_WORKFLOW = 'requirements-first';
export const DEFAULT_SPEC_TYPE = 'feature';

/** Phase order per workflow (Kiro's orchestrator). */
export const WORKFLOW_PHASES = {
  'requirements-first': ['requirements', 'design', 'tasks'],
  'design-first': ['design', 'requirements', 'tasks'],
  'fast-task': ['requirements', 'design', 'tasks'],
  'verify-first': ['requirements', 'design', 'tasks'],
  bugfix: ['requirements', 'design', 'tasks'],
};

/**
 * A model-level failure with a stable code the tool/RPC layer can surface.
 */
export class SpecError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SpecError';
    this.code = code;
    this.details = details;
  }
}

/** Directory containing all specs for a workspace. */
export function specsRoot(workspace, kiroDir = KIRO_DIR) {
  return path.resolve(workspace, kiroDir, 'specs');
}

/** Kiro's feature-name rule: lowercase kebab-case, max 64. */
export function normalizeFeatureName(value) {
  const text = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60)
    .replace(/-+$/gu, '');
  return text;
}

/**
 * Derive a usable feature name. Titles with no latin/digit characters (for
 * example Chinese titles) slugify to the empty string; those fall back to
 * `spec` and are disambiguated by the caller, rather than failing creation.
 * @param {string} value
 * @param {string} [fallback]
 */
export function featureNameFor(value, fallback = 'spec') {
  const text = normalizeFeatureName(value);
  return text === '' ? fallback : text;
}

/** Assert a feature name is already canonical (no silent rewriting). */
export function assertFeatureName(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(text)) {
    throw new SpecError('invalid-feature-name', `"${String(value)}" is not a valid feature name (lowercase kebab-case)`, { value });
  }
  return text;
}

/** Directory for one spec; rejects traversal. */
export function specDirectory(root, feature) {
  return path.join(root, assertFeatureName(feature));
}

/** True when a file exists. */
async function exists(target) {
  try {
    await fsp.stat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function readTextOrNull(file) {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

/** Read `.config.kiro`; tolerate Kiro's non-strict JSON and unknown values. */
export async function readConfig(directory) {
  const file = path.join(directory, CONFIG_FILE);
  const raw = await readTextOrNull(file);
  const fallback = { specId: '', workflowType: DEFAULT_WORKFLOW, specType: DEFAULT_SPEC_TYPE, reported: false };
  if (raw === null) return fallback;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  return {
    specId: typeof parsed.specId === 'string' ? parsed.specId : '',
    workflowType: WORKFLOW_TYPES.includes(parsed.workflowType) ? parsed.workflowType : DEFAULT_WORKFLOW,
    specType: SPEC_TYPES.includes(parsed.specType) ? parsed.specType : DEFAULT_SPEC_TYPE,
    reported: true,
  };
}

/** Documents that exist on disk, with their text. */
export async function readDocuments(directory) {
  const result = {};
  for (const name of DOCUMENTS) {
    const text = await readTextOrNull(path.join(directory, name));
    if (text !== null) result[name] = text;
  }
  return result;
}

/**
 * Parse requirements (or bugfix) clauses.
 *
 * Feature documents group criteria under `### Requirement N:` and number them
 * 1..m inside each block. Their stable identity is therefore `N.M`, which is
 * exactly the reference format used by `_Requirements:` in tasks.md and
 * `**Validates: Requirements N.M**` in design.md.
 *
 * @param {string} text
 * @param {'feature'|'bugfix'|'quick-spec'} specType
 */
export function parseRequirements(text, specType = 'feature') {
  const rows = String(text ?? '').replace(/\r\n?/gu, '\n').split('\n');
  const requirements = [];
  const clauses = [];
  if (specType === 'bugfix') {
    const sections = [
      { key: 'defect', heading: '### Current Behavior (Defect)' },
      { key: 'expected', heading: '### Expected Behavior (Correct)' },
      { key: 'preserved', heading: '### Unchanged Behavior (Regression Prevention)' },
    ];
    let current = null;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index].trimEnd();
      const section = sections.find((entry) => row === entry.heading);
      if (section !== undefined) {
        current = section;
        continue;
      }
      const clause = /^\s*(\d+)\.(\d+)\s+(.*)$/u.exec(row);
      if (clause !== null && current !== null) {
        clauses.push({
          id: `${clause[1]}.${clause[2]}`,
          number: clause[2],
          section: current.key,
          text: clause[3].trim(),
          line: index,
        });
      }
    }
    for (const section of sections) {
      const group = clauses.filter((clause) => clause.section === section.key);
      requirements.push({
        id: `section-${section.key}`,
        number: section.key,
        title: section.heading.replace(/^### /u, ''),
        userStory: '',
        acceptance: group.map((clause) => ({ id: clause.id, text: clause.text, line: clause.line })),
        line: 0,
      });
    }
    return { requirements, clauses };
  }
  let current = null;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const heading = /^###\s+(?:Requirement|需求)\s*(\d+)\s*[:：]?\s*(.*)$/u.exec(row.trimEnd());
    if (heading !== null) {
      current = {
        id: heading[1],
        number: heading[1],
        title: heading[2].trim(),
        userStory: '',
        acceptance: [],
        line: index,
      };
      requirements.push(current);
      continue;
    }
    if (current === null) continue;
    if (/^### /u.test(row)) {
      current = null;
      continue;
    }
    const story = /^\*\*User Story:\*\*\s*(.*)$/u.exec(row.trim());
    if (story !== null) current.userStory = story[1].trim();
    const clause = /^\s*(\d+)\.\s+(.*)$/u.exec(row);
    if (clause !== null && clause[2].trim() !== '') {
      current.acceptance.push({ id: `${current.id}.${clause[1]}`, text: clause[2].trim(), line: index });
    }
  }
  for (const requirement of requirements) clauses.push(...requirement.acceptance);
  return { requirements, clauses };
}

/** Parse `### Property N: Title` plus `**Validates: Requirements X.Y**`. */
export function parseProperties(text) {
  const properties = [];
  const rows = String(text ?? '').replace(/\r\n?/gu, '\n').split('\n');
  let current = null;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index].trimEnd();
    const heading = /^(?:### )?Property (\d+):\s*(.*)$/u.exec(row);
    if (heading !== null) {
      const title = heading[2].trim();
      const kind = /preservation/iu.test(title) ? 'preservation' : /bug/iu.test(title) ? 'bug-condition' : 'property';
      current = { number: Number(heading[1]), title, kind, validates: [], line: index };
      properties.push(current);
      continue;
    }
    if (current === null) continue;
    if (/^#{2,3} /u.test(row)) {
      current = null;
      continue;
    }
    const validates = /\*\*Validates:\s*Requirements\s+([\d.,\s]+)\*\*/u.exec(row);
    if (validates !== null) {
      current.validates = validates[1].split(',').map((part) => part.trim()).filter((part) => /^\d+(?:\.\d+)*$/u.test(part));
    }
  }
  return properties;
}

/**
 * True when a task is a property-test task.
 *
 * Kiro's template writes the marker in the task's body (`**Property 1: …**`),
 * but agents routinely name it in the title instead ("Write property-based
 * tests for …") and leave the body to the requirement reference. Only checking
 * the body made such a spec look like it had no property test at all, so the
 * `spec/missing-pbt-task` finding kept firing after the work was done and the
 * agent went hunting for a task that was already there.
 *
 * @param {{title?: string, body?: string[]}} task
 * @returns {boolean}
 */
export function isPropertyTask(task) {
  const text = `${task.title ?? ''}\n${(task.body ?? []).join('\n')}`;
  return /\bProperty\s+\d+/u.test(text) || /\bproperty[- ]based|property test/iu.test(text);
}

/** Determine which phase a spec is in, from documents and task progress. */
export function detectPhase(documents, parsedTasks) {
  const hasRequirements = documents['requirements.md'] !== undefined || documents['bugfix.md'] !== undefined;
  const hasDesign = documents['design.md'] !== undefined;
  const hasTasks = documents['tasks.md'] !== undefined;
  if (!hasTasks) return hasDesign ? 'tasks' : hasRequirements ? 'design' : 'requirements';
  if (parsedTasks !== undefined && parsedTasks !== null) {
    const progress = taskProgress(parsedTasks);
    if (progress.required > 0 && progress.completed === progress.required) return 'done';
    if (progress.completed > 0 || progress.inProgress > 0) return 'execution';
  }
  return 'tasks';
}

/**
 * Load one spec directory.
 * @param {string} root - `<workspace>/.kiro/specs`
 * @param {string} feature
 */
export async function loadSpec(root, feature) {
  const name = assertFeatureName(feature);
  const directory = path.join(root, name);
  if (!(await exists(directory))) {
    throw new SpecError('spec-not-found', `spec "${name}" does not exist in ${root}`, { feature: name, root });
  }
  const config = await readConfig(directory);
  const documents = await readDocuments(directory);
  const requirementsText = documents['bugfix.md'] ?? documents['requirements.md'] ?? '';
  const requirements = parseRequirements(requirementsText, config.specType);
  const properties = parseProperties(documents['design.md'] ?? '');
  let parsedTasks = null;
  let graph = null;
  if (documents['tasks.md'] !== undefined) {
    parsedTasks = parseTasks(documents['tasks.md']);
    graph = parseDependencyGraph(documents['tasks.md']).graph;
    attachWaveInfo(parsedTasks, graph);
  }
  return {
    feature: name,
    directory,
    config,
    documents,
    requirements,
    properties,
    tasks: parsedTasks,
    graph,
    phase: detectPhase(documents, parsedTasks),
  };
}

/** List every spec directory under the root (missing root = empty list). */
export async function listSpecs(root) {
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const specs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try {
      specs.push(await loadSpec(root, entry.name));
    } catch {
      // A directory without readable documents is not a spec; Kiro ignores it too.
    }
  }
  specs.sort((a, b) => a.feature.localeCompare(b.feature));
  return specs;
}

/** Files that are expected, and whether each exists. */
export function documentInventory(documents, specType = 'feature') {
  const required = specType === 'bugfix'
    ? ['bugfix.md', 'design.md', 'tasks.md']
    : ['requirements.md', 'design.md', 'tasks.md'];
  return required.map((name) => ({ name, exists: documents[name] !== undefined }));
}

/**
 * Full check for one loaded spec: Kiro format rules plus dsh-spec semantics
 * (EARS quality, requirement coverage, flow consistency).
 *
 * @param {object} spec - result of `loadSpec`
 * @returns {{ok: boolean, issues: object[], counts: object, summary: object}}
 */
export function checkSpec(spec) {
  const issues = [];
  const add = (severity, message, extra = {}) => issues.push({ severity, message, ...extra });
  const documents = spec.documents;
  const specType = spec.config.specType;

  // Documents belonging to a later phase are not expected yet: a fresh spec
  // must not look broken just because design.md/tasks.md do not exist. Once a
  // document exists (or the spec has reached that phase), its absence is real.
  const requirementsName = specType === 'bugfix' ? 'bugfix.md' : 'requirements.md';
  const phaseOrder = ['requirements', 'design', 'tasks', 'execution', 'done'];
  const phaseIndex = phaseOrder.indexOf(spec.phase);
  for (const entry of documentInventory(documents, specType)) {
    if (entry.exists) continue;
    const requiredIndex = entry.name === 'tasks.md' ? 2 : entry.name === 'design.md' ? 1 : 0;
    if (requiredIndex > phaseIndex) continue;
    add('warning', `Document not written yet: ${entry.name}`, { rule: 'spec/missing-document', file: entry.name, params: { file: entry.name } });
  }
  for (const [name, text] of Object.entries(documents)) {
    const kind = documentKindOf(name);
    if (kind === undefined) continue;
    for (const found of validateDocument(text, kind, specType)) {
      issues.push({ ...found, file: name });
    }
  }
  if (typeof documents[requirementsName] === 'string') {
    for (const found of lintRequirementsSemantics(documents[requirementsName])) {
      issues.push({ ...found, file: requirementsName });
    }
  }

  const clauseIds = new Set(spec.requirements.clauses.map((clause) => clause.id));
  const allTasks = spec.tasks === null ? [] : spec.tasks.tasks;
  const linked = new Set();
  for (const task of allTasks) {
    for (const id of task.requirements ?? []) {
      if (!clauseIds.has(id)) {
        add('warning', `Task ${task.id} references unknown requirement ${id}`, { rule: 'spec/unknown-requirement', file: 'tasks.md', itemId: task.id, params: { taskId: task.id, requirement: id } });
      } else {
        linked.add(id);
      }
    }
  }
  for (const property of spec.properties) {
    for (const id of property.validates) {
      if (!clauseIds.has(id)) {
        add('warning', `Property ${property.number} validates unknown requirement ${id}`, { rule: 'spec/unknown-validates', file: 'design.md', params: { property: property.number, requirement: id } });
      }
    }
  }
  if (spec.tasks !== null) {
    for (const id of clauseIds) {
      if (specType !== 'bugfix' && !linked.has(id)) {
        add('info', `Requirement ${id} is not referenced by any task`, { rule: 'spec/unlinked-requirement', file: 'requirements.md', itemId: id, params: { requirement: id } });
      }
    }
    const graphResult = parseDependencyGraph(documents['tasks.md']);
    for (const found of graphResult.issues) add(found.severity, found.message, { rule: found.rule, file: 'tasks.md' });
    if (graphResult.graph !== null) {
      for (const found of reconcileDependencyGraph(spec.tasks, graphResult.graph)) {
        add(found.severity, found.message, { rule: found.rule, file: 'tasks.md' });
      }
    }
    if (specType === 'bugfix' && graphResult.graph !== null) {
      add('error', 'A bugfix task list must not contain a Task Dependency Graph', { rule: 'spec/bugfix-dag', file: 'tasks.md' });
    }
    const progress = taskProgress(spec.tasks);
    if (progress.required > 0 && progress.completed === progress.required && documents['design.md'] !== undefined) {
      const propertyTasks = allTasks.filter((task) => isPropertyTask(task));
      if (spec.properties.length > 0 && propertyTasks.length === 0) {
        add('info', 'Design defines correctness properties but no property-test task exists', { rule: 'spec/missing-pbt-task', file: 'tasks.md' });
      }
    }
  }

  const rank = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9)
    || String(a.file ?? '').localeCompare(String(b.file ?? ''))
    || String(a.rule ?? '').localeCompare(String(b.rule ?? '')));
  const counts = {
    error: issues.filter((item) => item.severity === 'error').length,
    warning: issues.filter((item) => item.severity === 'warning').length,
    info: issues.filter((item) => item.severity === 'info').length,
  };
  return { ok: counts.error === 0, issues, counts, summary: summaryOf(spec) };
}

/** Compact summary used by tools, prompts, and the panel list. */
export function summaryOf(spec) {
  const progress = spec.tasks === null ? null : taskProgress(spec.tasks);
  const ready = spec.tasks === null ? [] : readyTasks(spec.tasks);
  return {
    feature: spec.feature,
    workflowType: spec.config.workflowType,
    specType: spec.config.specType,
    phase: spec.phase,
    documents: documentInventory(spec.documents, spec.config.specType),
    requirements: spec.requirements.requirements.length,
    clauses: spec.requirements.clauses.length,
    properties: spec.properties.length,
    tasks: progress,
    ready: ready.map((task) => ({ id: task.id, title: task.title, optional: task.optional })),
  };
}

/** Validate a candidate feature directory name before creation. */
export async function assertCreatable(root, feature) {
  const name = assertFeatureName(feature);
  if (await exists(path.join(root, name))) {
    throw new SpecError('spec-exists', `spec "${name}" already exists in ${root}`, { feature: name });
  }
  return name;
}

/**
 * Resolve a non-colliding feature name for a new spec. An explicit `feature`
 * is authoritative and must already be canonical; a derived title slug gets a
 * numeric suffix when taken.
 * @param {string} root
 * @param {{ feature?: string, title?: string }} options
 */
export async function resolveFeatureName(root, options) {
  if (typeof options.feature === 'string' && options.feature.trim() !== '') {
    return assertCreatable(root, options.feature.trim());
  }
  const base = featureNameFor(options.title ?? options.feature);
  let candidate = base;
  for (let attempt = 1; attempt <= 200; attempt += 1) {
    if (!(await exists(path.join(root, candidate)))) return candidate;
    candidate = `${base.slice(0, 57)}-${attempt + 1}`;
  }
  throw new SpecError('feature-name-exhausted', `could not derive a free feature name from "${base}"`);
}
