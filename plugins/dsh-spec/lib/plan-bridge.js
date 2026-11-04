/**
 * dsh-spec/plan — the Spec preset's task dock.
 *
 * The host's `todo_write` keeps a flat three-status list with no notion of Kiro
 * waves, so a Spec session that used it carried two task lists that disagreed.
 * This module replaces it for Spec sessions: it registers a `specPlan` session
 * projection and publishes the plan on every spec write, and the client renders
 * it in `conversation.input.dock`.
 *
 * Registered from the preset's own scope (same package half as the tools), so a
 * session that never selected the Spec preset has neither the projection nor
 * the dock.
 *
 * @module dsh-spec/plan
 */

import { planProjectionDefinition, planState } from './plan.js?dsh-spec=0.8.2';

/** Cordis plugin name; must match the preset row `name`. */
export const name = '@weniatall/dsh-spec/plan';

/**
 * `sessionProjections` is required — the dock has no other data path. The
 * registry is a Host service, and this row lives inside the preset's scope: a
 * preset row may *read* a Host service, which is what this does (it registers a
 * fold, it does not publish a service).
 */
export const inject = ['sessionProjections'];

/** Event type the tools append and this projection folds. */
export const PLAN_EVENT = 'spec/plan';

/**
 * Derive the wire state from a loaded spec.
 *
 * `spec.tasks` is the parsed tree from `parseTasks`; the dependency graph is
 * the `## Task Dependency Graph` block. A spec without tasks.md has nothing to
 * schedule, and the dock renders nothing for it rather than an empty shell.
 *
 * @param {{feature: string, phase: string, config?: object, tasks: object|null, graph?: object|null}} spec
 * @returns {object | null}
 */
export function planFor(spec) {
  if (spec?.tasks === null || spec?.tasks === undefined) return null;
  return planState({
    feature: spec.feature,
    phase: spec.phase,
    workflowType: spec.config?.workflowType ?? null,
    parsed: spec.tasks,
    graph: spec.graph ?? null,
  });
}

/**
 * Append one whole-plan snapshot to the calling Agent's session.
 *
 * Whole value, never a delta: the projection framework's rule is that a
 * state-carrying event carries the complete post-change state, which keeps the
 * fold trivial and every served value self-describing.
 *
 * Called by the Spec tools after a write, so the dock updates while the turn
 * that changed tasks.md is still running — the Agent does not have to finish
 * before the user sees progress.
 *
 * @param {object} ctx - Cordis context (preset scope).
 * @param {{feature: string, phase: string, config?: object, tasks: object|null, graph?: object|null}} spec
 * @returns {object | null} the published plan, or null when there is none.
 */
export function publishPlan(ctx, exec, spec, sessionId) {
  const plan = planFor(spec);
  if (plan === null) return null;
  // Two callers publish: an Agent tool call (which owns `exec.agent.session`,
  // the same handle `todo_write` appends to) and the panel's own RPC toggle,
  // which has no agent — for that one the payload's sessionId names the session
  // whose dock must follow the checkbox.
  const session = exec?.agent?.session ?? agentSession(ctx, sessionId);
  if (typeof session?.append === 'function') {
    try {
      session.append(PLAN_EVENT, { plan });
    } catch (error) {
      // A session that cannot accept the event must not fail the tool call: the
      // file on disk is written either way, and the dock simply shows the
      // previous snapshot.
      warnOnce(ctx, `spec: could not publish the plan event: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return plan;
}

/**
 * Resolve an Agent session from its id, for callers that are not agents.
 *
 * The host's preset registry exposes `agents.get(sessionId)`, and an Agent
 * record carries its `session` handle. Absent service or unknown id means the
 * plan simply is not published — never an error, because a panel toggle on a
 * session the server does not know about is not a tool failure.
 *
 * @param {object} ctx - Cordis context (preset scope).
 * @param {string} [sessionId]
 * @returns {object | undefined}
 */
function agentSession(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined;
  let agents;
  try {
    agents = typeof ctx?.get === 'function' ? ctx.get('agents', false) : undefined;
  } catch {
    return undefined;
  }
  const agent = agents?.get?.(sessionId);
  return agent?.session ?? agent;
}

const warned = new Set();
function warnOnce(ctx, message) {
  if (warned.has(message)) return;
  warned.add(message);
  try {
    if (typeof ctx?.logger?.warn === 'function') ctx.logger.warn(message);
  } catch {
    // diagnostics never break load
  }
}

/**
 * Mount the plan dock's data half.
 * @param {object} ctx - Cordis context of the preset scope.
 */
export function apply(ctx) {
  const unregister = ctx.sessionProjections.register(planProjectionDefinition());
  ctx.on?.('dispose', () => {
    try {
      unregister?.();
    } catch {
      // the registry may already be gone with the scope
    }
  });
}
