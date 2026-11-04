/**
 * dsh-spec — Kiro task-list model.
 *
 * Kiro's task status lives in the Markdown checkbox itself, not in a sidecar:
 *
 *   - [ ] 1.   not_started   (also `[X]` reads as completed)
 *   - [-] 1.1  in_progress
 *   - [~] 1.1  queued
 *   - [x] 1.1  completed
 *
 * `- [ ]* 2.2 …` marks an optional subtask. Parents are completed by
 * propagation when every non-optional child is completed, a parent cannot be
 * completed while a required child is open, and execution follows the wave
 * graph in `## Task Dependency Graph` (linear order for bugfix specs).
 *
 * @module dsh-spec/tasks
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Kiro task statuses. */
export const TASK_STATUSES = ['not_started', 'queued', 'in_progress', 'completed'];

/** Checkbox character for each status (Kiro's exact mapping). */
export const STATUS_TO_BOX = {
  not_started: ' ',
  queued: '~',
  in_progress: '-',
  completed: 'x',
};

/** Parse a checkbox character into a status. */
export function boxToStatus(box) {
  switch (box) {
    case 'x':
    case 'X':
      return 'completed';
    case '-':
      return 'in_progress';
    case '~':
      return 'queued';
    default:
      return 'not_started';
  }
}

const CHECKBOX = /^(\s*)- \[([^\]])\](\\?)(\*?)(\s+)(\d+(?:\.\d+)*)(?:\.\s+|\s+)(.*)$/u;

/**
 * Parse one tasks.md into a hierarchy.
 *
 * A task keeps its exact line indices so status updates rewrite one line in
 * place instead of regenerating the document (which would destroy user edits,
 * notes, and formatting — the reason Kiro writes through the file too).
 *
 * @param {string} text
 * @returns {{tasks: object[], byId: Map<string, object>, top: object[]}}
 */
export function parseTasks(text) {
  const rows = String(text ?? '').replace(/\r\n?/gu, '\n').split('\n');
  const tasks = [];
  const byId = new Map();
  for (let index = 0; index < rows.length; index += 1) {
    const match = CHECKBOX.exec(rows[index]);
    if (match === null) continue;
    const task = {
      id: match[6],
      title: match[7].trim(),
      status: boxToStatus(match[2]),
      box: match[2],
      optional: match[4] === '*',
      depth: match[1].length,
      line: index,
      indent: match[1],
      children: [],
      parentId: null,
      body: [],
    };
    tasks.push(task);
    byId.set(task.id, task);
  }
  // Attach each task to the nearest preceding lower-numbered parent by id
  // prefix (1.2.1 -> 1.2), matching Kiro's task-number hierarchy.
  for (const task of tasks) {
    const parentId = task.id.includes('.') ? task.id.slice(0, task.id.lastIndexOf('.')) : null;
    task.parentId = parentId !== null && byId.has(parentId) ? parentId : null;
  }
  for (const task of tasks) {
    if (task.parentId !== null) byId.get(task.parentId).children.push(task);
  }
  // Body lines (indented bullets under the checkbox) belong to their task.
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    const next = index + 1 < tasks.length ? tasks[index + 1].line : rows.length;
    for (let cursor = task.line + 1; cursor < next; cursor += 1) {
      const row = rows[cursor];
      if (/^\s*## /u.test(row)) break;
      task.body.push(row);
    }
  }
  // Kiro completes a parent once every non-optional child is done, and an Agent
  // that edits tasks.md directly usually only checks the subtasks it ran. Derive
  // the parent's status from its subtree so a finished parent never reads as
  // "not started" just because its own box was left unchecked. `box` keeps the
  // raw file truth, and a completed parent keeps `box: 'x'` untouched.
  for (const task of tasks) {
    if (task.children.length === 0 || task.status === 'completed') continue;
    if (subtreeCompleted(task)) {
      task.status = 'completed';
      task.derived = true;
    }
  }
  for (const task of tasks) task.requirements = parseRequirementRefs(task.body);
  const top = tasks.filter((task) => task.parentId === null);
  return { tasks, byId, top };
}

/**
 * Whether every non-optional child of a parent is completed, following nested
 * parents through their own subtree. A parent with only optional children is
 * never derived: its own box stays the only statement about it.
 */
function subtreeCompleted(task) {
  const required = task.children.filter((child) => !child.optional);
  if (required.length === 0) return false;
  return required.every((child) => child.status === 'completed' || (child.children.length > 0 && subtreeCompleted(child)));
}

/** `_Requirements: 1.2, 2.3_` references inside one task body. */
export function parseRequirementRefs(body) {
  for (const row of body) {
    const match = /_(?:Requirements?|需求)[:：]\s*([^_]+)_/iu.exec(row);
    if (match !== null) {
      return match[1].split(',').map((part) => part.trim()).filter((part) => /^\d+(?:\.\d+)+$/u.test(part));
    }
  }
  return [];
}

/** True when a task is a leaf in the parsed hierarchy. */
export function isLeaf(task) {
  return task.children.length === 0;
}

/** Leaf tasks in document order (what Kiro schedules and graphs). */
export function leafTasks(parsed) {
  return parsed.tasks.filter((task) => isLeaf(task));
}

/**
 * True for Kiro's checkpoints ("N. Checkpoint - …", "N. Final checkpoint - …").
 *
 * A checkpoint is a validation gate, not work: Kiro never puts one in the
 * dependency graph, which is why the plugin's own template ships two of them
 * outside its waves. Scheduling still treats them as ordinary leaves — only the
 * "every leaf must be graphed" rule skips them.
 */
export function isCheckpoint(task) {
  return /checkpoint/iu.test(String(task?.title ?? ""));
}

/* ------------------------------------------------------------------------- *
 * Dependency graph
 * ------------------------------------------------------------------------- */

/** Extract and validate `## Task Dependency Graph` from tasks.md. */
export function parseDependencyGraph(text) {
  const rows = String(text ?? '').replace(/\r\n?/gu, '\n').split('\n');
  const index = rows.findIndex((row) => /^## Task Dependency Graph$/u.test(row.trimEnd()));
  if (index === -1) return { graph: null, issues: [] };
  let end = rows.length;
  for (let cursor = index + 1; cursor < rows.length; cursor += 1) {
    if (/^## /u.test(rows[cursor])) {
      end = cursor;
      break;
    }
  }
  const block = rows.slice(index + 1, end).join('\n');
  const match = /```json\s*\n?([\s\S]*?)```/u.exec(block);
  if (match === null) {
    return { graph: null, issues: [{ severity: 'error', rule: 'tasks/missing-dag-json', message: 'Task Dependency Graph section is missing a JSON code block with wave definitions.' }] };
  }
  let parsed;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return { graph: null, issues: [{ severity: 'error', rule: 'tasks/invalid-dag-json', message: 'Task Dependency Graph contains invalid JSON.' }] };
  }
  const problem = dependencyGraphProblem(parsed);
  if (problem !== null) {
    return { graph: null, issues: [{ severity: 'error', rule: 'tasks/invalid-dag-structure', message: problem }] };
  }
  return { graph: parsed, issues: [] };
}

function dependencyGraphProblem(graph) {
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) {
    return 'Dependency graph must be a JSON object with a "waves" array.';
  }
  if (graph.waves === undefined) return 'Dependency graph is missing the "waves" key.';
  if (!Array.isArray(graph.waves)) return 'Dependency graph "waves" must be an array.';
  for (let index = 0; index < graph.waves.length; index += 1) {
    const wave = graph.waves[index];
    if (wave === null || typeof wave !== 'object' || Array.isArray(wave)) {
      return `Wave at index ${index} must be an object {id, tasks}.`;
    }
    if (typeof wave.id !== 'number' || !Number.isFinite(wave.id)) {
      return `Wave at index ${index} has non-numeric id: ${JSON.stringify(wave.id)}.`;
    }
    if (!Array.isArray(wave.tasks)) return `Wave at index ${index} (id=${wave.id}) must have a "tasks" array.`;
    for (let cursor = 0; cursor < wave.tasks.length; cursor += 1) {
      if (typeof wave.tasks[cursor] !== 'string') {
        return `Wave at index ${index} task at index ${cursor} must be a string.`;
      }
    }
  }
  return null;
}

/**
 * Reconcile the graph against the parsed tasks: every work leaf must appear
 * exactly once (checkpoints are exempt — Kiro never graphs them), wave ids must
 * be contiguous, and unknown ids are reported.
 */
export function reconcileDependencyGraph(parsed, graph) {
  const issues = [];
  if (graph === null) return issues;
  const leaves = leafTasks(parsed);
  const leafIds = new Set(leaves.map((task) => task.id));
  const seen = new Map();
  graph.waves.forEach((wave, waveIndex) => {
    if (wave.id !== waveIndex) {
      issues.push({ severity: 'warning', rule: 'dag/non-contiguous-waves', message: `Wave ids must be contiguous from 0; found id ${wave.id} at position ${waveIndex}.`, params: { waveId: wave.id, position: waveIndex } });
    }
    for (const id of wave.tasks) {
      if (!leafIds.has(id)) {
        issues.push({ severity: 'warning', rule: 'dag/unknown-task', message: `Wave ${wave.id} contains "${id}", which is not a leaf task in tasks.md.`, params: { waveId: wave.id, taskId: id } });
      }
      if (seen.has(id)) {
        issues.push({ severity: 'warning', rule: 'dag/duplicate-task', message: `Task "${id}" appears in waves ${seen.get(id)} and ${wave.id}.`, params: { taskId: id, first: seen.get(id), second: wave.id } });
      } else {
        seen.set(id, wave.id);
      }
    }
  });
  for (const leaf of leaves) {
    // Checkpoints are gates Kiro deliberately leaves out of the graph; asking
    // for them here flagged every spec written from the plugin's own template.
    if (seen.has(leaf.id) || isCheckpoint(leaf)) continue;
    issues.push({ severity: 'info', rule: 'dag/missing-task', message: `Leaf task "${leaf.id}" is not in the dependency graph; it will be scheduled after the last wave.`, params: { taskId: leaf.id } });
  }
  return issues;
}

/**
 * Compute each task's dependencies. In wave mode every task in wave N waits
 * for all tasks in waves 0..N-1; without a graph, Kiro falls back to sibling
 * order (linear).
 */
export function attachWaveInfo(parsed, graph) {
  if (graph === null) {
    for (const task of parsed.tasks) task.wave = null;
    return parsed;
  }
  const waveOf = new Map();
  graph.waves.forEach((wave) => {
    for (const id of wave.tasks) waveOf.set(id, wave.id);
  });
  const byWave = new Map();
  for (const [id, waveId] of waveOf) {
    if (!byWave.has(waveId)) byWave.set(waveId, []);
    byWave.get(waveId).push(id);
  }
  let lastWave = -1;
  for (const [waveId] of byWave) lastWave = Math.max(lastWave, waveId);
  for (const task of parsed.tasks) {
    const waveId = waveOf.get(task.id);
    task.wave = waveId ?? null;
    if (waveId === undefined) continue;
    task.dependencies = [];
    for (let prior = 0; prior < waveId; prior += 1) {
      for (const id of byWave.get(prior) ?? []) task.dependencies.push(id);
    }
  }
  parsed.openTasks = parsed.tasks.filter((task) => (task.wave ?? lastWave + 1) > lastWave);
  return parsed;
}

/* ------------------------------------------------------------------------- *
 * Progress / next-task selection
 * ------------------------------------------------------------------------- */

/** Progress over leaf tasks (parents are derived, not counted twice). */
export function taskProgress(parsed) {
  const leaves = leafTasks(parsed);
  const required = leaves.filter((task) => !task.optional);
  const count = (status) => required.filter((task) => task.status === status).length;
  const done = count('completed');
  const percent = required.length === 0 ? 0 : Math.round((done / required.length) * 100);
  return {
    total: parsed.tasks.length,
    leaves: leaves.length,
    required: required.length,
    optional: leaves.length - required.length,
    completed: done,
    inProgress: leaves.filter((task) => task.status === 'in_progress').length,
    queued: leaves.filter((task) => task.status === 'queued').length,
    notStarted: leaves.filter((task) => task.status === 'not_started').length,
    percent,
  };
}

/** All dependencies of a task are completed. */
export function dependenciesDone(parsed, task) {
  for (const id of task.dependencies ?? []) {
    const dependency = parsed.byId.get(id);
    // Optional tasks may be skipped; they never gate a later wave.
    if (dependency === undefined || dependency.optional) continue;
    if (dependency.status !== 'completed') return false;
  }
  return true;
}

/**
 * Tasks Kiro would run next: non-optional leaves that are not completed and
 * whose wave dependencies are complete. With no graph, sibling order applies.
 */
export function readyTasks(parsed) {
  const leaves = leafTasks(parsed).filter((task) => !task.optional && task.status !== 'completed');
  if (leaves.length === 0) return [];
  const withWaves = leaves.some((task) => task.wave !== null && task.wave !== undefined);
  if (!withWaves) {
    const first = leaves[0];
    return first === undefined ? [] : [first];
  }
  return leaves.filter((task) => dependenciesDone(parsed, task));
}

/** Whether every non-optional child of a parent is completed. */
export function childrenCompleted(task) {
  return task.children.every((child) => child.optional || child.status === 'completed');
}

/** Remaining non-optional descendants blocking a parent completion. */
function openRequiredDescendants(task) {
  const open = [];
  for (const child of task.children) {
    if (child.optional) continue;
    if (child.status !== 'completed') open.push(child);
    open.push(...openRequiredDescendants(child));
  }
  return open;
}

/**
 * Plan a status change. Mutates nothing: returns the new status for the target
 * and every ancestor that auto-completes, mirroring Kiro's propagation.
 * @param {object} parsed
 * @param {string} id
 * @param {string} status
 */
export function planStatusChange(parsed, id, status) {
  const task = parsed.byId.get(id);
  if (task === undefined) throw new Error(`Task "${id}" not found`);
  if (!TASK_STATUSES.includes(status)) throw new Error(`Unknown task status "${status}"`);
  if (status === 'completed' && !isLeaf(task)) {
    const open = openRequiredDescendants(task);
    if (open.length > 0) {
      return {
        error: `Cannot complete parent task "${id}" while required subtasks are incomplete: ${open.map((child) => `"${child.id} ${child.title}"`).join(', ')}`,
      };
    }
  }
  const changes = [{ taskId: task.id, oldStatus: task.status, newStatus: status }];
  if (status === 'completed') {
    let parent = task.parentId === null ? undefined : parsed.byId.get(task.parentId);
    while (parent !== undefined) {
      if (parent.status !== 'completed' && childrenCompleted(parent)) {
        changes.push({ taskId: parent.id, oldStatus: parent.status, newStatus: 'completed' });
      }
      parent = parent.parentId === null ? undefined : parsed.byId.get(parent.parentId);
    }
  }
  return { changes, warnings: status === 'in_progress' ? orderWarnings(parsed, task) : [] };
}

/** Warn when a task starts before earlier required siblings are completed. */
function orderWarnings(parsed, task) {
  const siblings = task.parentId === null ? parsed.top : parsed.byId.get(task.parentId).children;
  const warnings = [];
  for (const sibling of siblings) {
    if (sibling.id === task.id) break;
    if (sibling.status !== 'completed' && !sibling.optional) {
      warnings.push(`Task "${sibling.id} ${sibling.title}" has not been completed yet and appears before this task.`);
    }
  }
  return warnings;
}

/* ------------------------------------------------------------------------- *
 * Writing status back
 * ------------------------------------------------------------------------- */

/** Replace the checkbox of one line, preserving indentation and optional `*`. */
export function writeStatusLine(line, status) {
  const match = CHECKBOX.exec(line);
  if (match === null) return line;
  // Preserve the original separator style (`1. Title` vs `1.1 Title`).
  const separator = match[0].includes(`${match[6]}. `) ? '. ' : ' ';
  return `${match[1]}- [${STATUS_TO_BOX[status]}]${match[3]}${match[4]}${match[5]}${match[6]}${separator}${match[7]}`;
}

/**
 * Apply a planned change set to the raw text. Handles `X` normalization: a
 * completed box is always written as lowercase `x`, exactly like Kiro.
 * @returns {string}
 */
export function applyStatusChanges(text, changes) {
  const rows = String(text).replace(/\r\n?/gu, '\n').split('\n');
  const parsed = parseTasks(text);
  for (const change of changes) {
    const task = parsed.byId.get(change.taskId);
    if (task === undefined) continue;
    rows[task.line] = writeStatusLine(rows[task.line], change.newStatus);
  }
  return rows.join('\n');
}

/* ------------------------------------------------------------------------- *
 * Sync `tasks.meta.json` (execution history / PBT results)
 * ------------------------------------------------------------------------- */

/** Path next to tasks.md. */
export function metadataPathFor(tasksPath) {
  return path.join(path.dirname(tasksPath), 'tasks.meta.json');
}

/** Empty metadata document. */
export function emptyMetadata() {
  return { pbtResults: {}, executionHistory: {} };
}

/**
 * Append one execution record, keeping Kiro's 10-entry cap.
 * @param {object} metadata
 * @param {string} taskId
 * @param {{ executionId: string, chatSessionId: string, timestamp?: number }} record
 */
export function recordExecution(metadata, taskId, record) {
  const history = metadata.executionHistory[taskId] ?? [];
  history.push({
    executionId: record.executionId,
    chatSessionId: record.chatSessionId,
    timestamp: record.timestamp ?? Date.now(),
  });
  metadata.executionHistory[taskId] = history.slice(-10);
  return metadata;
}

/** Record a property-test run for a PBT task. */
export function recordPbtResult(metadata, taskId, { status, failingExample, timestamp = Date.now() }) {
  // A passing run has no counterexample, and the key is left out rather than
  // written as `undefined`: `JSON.stringify` drops it anyway, so keeping it
  // would make the in-memory shape disagree with the file on disk.
  metadata.pbtResults[taskId] = failingExample === undefined
    ? { status, lastRunTimestamp: timestamp }
    : { status, failingExample, lastRunTimestamp: timestamp };
  return metadata;
}

/** Read tasks.meta.json (missing or malformed files yield an empty store). */
export async function readMetadata(tasksPath) {
  try {
    const raw = await readFile(metadataPathFor(tasksPath), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyMetadata();
    return {
      pbtResults: parsed.pbtResults && typeof parsed.pbtResults === 'object' ? parsed.pbtResults : {},
      executionHistory: parsed.executionHistory && typeof parsed.executionHistory === 'object' ? parsed.executionHistory : {},
    };
  } catch {
    return emptyMetadata();
  }
}
