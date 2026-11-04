/**
 * Spec task plan projection.
 *
 * The host's own todo module (`todo_write`) keeps a flat list of three statuses
 * and knows nothing about Kiro's wave scheduling, so a Spec session that used it
 * ended up with two disagreeing task lists. This module is the Spec preset's
 * replacement: the plan dock renders `tasks.md` itself, grouped by the
 * `## Task Dependency Graph` waves so parallel work is visible as parallel.
 *
 * Pure derivation lives here (no Cordis, no I/O) so it is testable on its own;
 * `./plan.js` wires it to the session projection and the tools.
 *
 * @module plan
 */

/** Statuses the dock paints, in Kiro's vocabulary. */
const DONE = 'completed';

/**
 * Group a parsed task tree into the waves the dock renders.
 *
 * Rules:
 * - Only leaf tasks are scheduled (Kiro graphs leaves, never parents).
 * - A leaf's wave comes from the dependency graph; a task that is not in the
 *   graph falls into a trailing "unscheduled" bucket instead of being dropped,
 *   because a document can be mid-edit and the dock must still show the work.
 * - Checkpoints are not work: they are excluded like Kiro excludes them from
 *   scheduling, so the dock never shows "run the checkpoint" as a parallel task.
 *
 * @param {{tasks: object[]}} parsed - result of `parseTasks`.
 * @param {{waves?: {id: number, tasks: string[]}[]} | null} graph
 * @returns {{waves: {id: number|null, tasks: object[]}[], unscheduled: object[]}}
 */
export function planWaves(parsed, graph) {
  const leaves = parsed.tasks.filter((task) => task.children.length === 0 && !isCheckpointTask(task));
  const byId = new Map(leaves.map((task) => [task.id, task]));
  const waves = [];
  const scheduled = new Set();
  for (const wave of graph?.waves ?? []) {
    const tasks = [];
    for (const id of wave.tasks ?? []) {
      const task = byId.get(id);
      if (task === undefined) continue; // the graph may name a parent or a stale id
      scheduled.add(id);
      tasks.push(task);
    }
    if (tasks.length > 0) waves.push({ id: wave.id, tasks });
  }
  const unscheduled = leaves.filter((task) => !scheduled.has(task.id));
  return { waves, unscheduled };
}

/** Kiro checkpoints are planned work markers, not schedulable tasks. */
function isCheckpointTask(task) {
  return /checkpoint/iu.test(String(task?.title ?? ''));
}

/**
 * The counts the dock header shows. Parents are never counted, so a task is
 * counted once no matter how deep the tree is.
 *
 * @param {object[]} leaves
 * @returns {{total: number, done: number, active: number, pending: number, queued: number, percent: number}}
 */
export function planCounts(leaves) {
  const total = leaves.length;
  let done = 0;
  let active = 0;
  let queued = 0;
  for (const task of leaves) {
    if (task.status === DONE) done += 1;
    else if (task.status === 'in_progress') active += 1;
    else if (task.status === 'queued') queued += 1;
  }
  return {
    total,
    done,
    active,
    queued,
    pending: total - done - active - queued,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}

/**
 * The wire state of the `specPlan` projection.
 *
 * Deliberately flat and small: it is re-sent on every task change, and the dock
 * needs nothing beyond what it paints. `feature` is null when the session has no
 * bound spec, which is how the dock knows to render nothing.
 *
 * @param {{feature: string, phase: string, parsed: object, graph: object|null, document?: object}} spec
 * @returns {object}
 */
export function planState(spec) {
  const { waves, unscheduled } = planWaves(spec.parsed, spec.graph);
  const leaves = [...waves.flatMap((wave) => wave.tasks), ...unscheduled];
  const counts = planCounts(leaves);
  return {
    feature: spec.feature,
    phase: spec.phase,
    workflowType: spec.workflowType ?? null,
    counts,
    waves: waves.map((wave) => ({
      id: wave.id,
      tasks: wave.tasks.map(taskState),
      // "open" means the wave still has work in it; the dock paints a finished
      // wave without its running dot rather than hiding it, so the plan always
      // reads as a whole and a wave never disappears mid-turn.
      open: wave.tasks.some((task) => task.status !== DONE),
    })),
    unscheduled: unscheduled.map(taskState),
    // Kept apart from `waves` because the dock renders them under a hint: an
    // un-graphed leaf is a document defect, not a scheduling decision.
    updatedAt: spec.updatedAt ?? null,
  };
}

/** One task as the dock paints it. */
function taskState(task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    optional: task.optional === true,
    derived: task.derived === true,
    requirements: task.requirements ?? [],
  };
}

/**
 * A minimal `.parse` surface for the projection framework.
 *
 * `SessionProjectionRegistry` calls `stateSchema.parse` when it restores a
 * checkpoint row and `viewSchema.parse` on every value it serves, so the two
 * slots cannot be null — but the framework only needs `.parse` to return the
 * value or throw. Writing the check here keeps the plugin dependency-free (its
 * package contract asserts zero runtime dependencies) while still failing loud
 * on a malformed event instead of serving it to the dock.
 *
 * @param {(value: unknown) => void} check - throws when the value is unusable.
 * @returns {{parse: (value: unknown) => unknown}}
 */
function validator(check) {
  return {
    parse(value) {
      check(value);
      return value;
    },
  };
}

/** Accept null (nothing reported yet) or a plan state of the documented shape. */
const planSchema = validator((value) => {
  if (value === null || value === undefined) return;
  if (typeof value !== 'object') throw new Error('spec plan: state must be an object or null');
  const { feature, counts, waves, unscheduled } = value;
  if (typeof feature !== 'string') throw new Error('spec plan: "feature" must be a string');
  if (counts === null || typeof counts !== 'object') throw new Error('spec plan: "counts" must be an object');
  if (!Array.isArray(waves)) throw new Error('spec plan: "waves" must be an array');
  if (!Array.isArray(unscheduled)) throw new Error('spec plan: "unscheduled" must be an array');
  for (const wave of waves) {
    if (wave === null || typeof wave !== 'object' || !Array.isArray(wave.tasks)) {
      throw new Error('spec plan: every wave needs a "tasks" array');
    }
  }
});

/**
 * The projection definition, registered on `ctx.sessionProjections` from the
 * preset's own scope. The state is derived by this module; the payload arrives
 * in `spec/plan` session events that the Spec tools append after every write.
 *
 * A plan is **not** cleared on `turn/start`: it is derived from `tasks.md` on
 * disk, not from what one turn happened to do, so the same spec must show the
 * same plan before, during and after a turn. Clearing it made the dock vanish
 * at the start of every turn and reappear only after the first task write,
 * which read as a panel that kept disappearing. What *is* transient is the
 * `in_progress` status, and that lives in the document's checkboxes — an agent
 * that finished a turn leaves the file honest.
 *
 * @returns {object}
 */
export function planProjectionDefinition() {
  return {
    key: 'specPlan',
    stateSchema: planSchema,
    init: () => null,
    apply: (state, event) => {
      if (event.type === 'spec/plan') return event.data?.plan ?? null;
      return state;
    },
    wire: {
      viewSchema: planSchema,
      view: (state) => state,
    },
    stateVersion: 1,
  };
}
