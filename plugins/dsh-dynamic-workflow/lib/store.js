/**
 * Run store: folds DSH workflow-engine events and the parent session's
 * `tool-workflow/*` records into one graph per run, the same shape ZCode's
 * causality graph renders (phases as lanes, agents as nodes, phase edges in
 * declaration order).
 *
 * Every handler is an idempotent upsert, because the same fact can arrive
 * twice: once from the engine (`workflow/agent-start`) and once from the
 * session log (`tool-workflow/agent-start`). Either source alone is enough to
 * build the graph; the engine adds phases and log lines, the session adds the
 * owning session id.
 *
 * @module dsh-dynamic-workflow/store
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const RUN_STATUS = ['running', 'completed', 'error', 'cancelled', 'interrupted'];
export const NODE_STATUS = ['running', 'completed', 'failed', 'cancelled', 'interrupted'];

const MAX_LOGS = 400;
const MAX_SCRIPT = 256_000;
const UNPHASED = '';

function text(value, max = 2000) {
  if (typeof value !== 'string') return '';
  return value.length > max ? value.slice(0, max) : value;
}

function stopToStatus(reason) {
  if (reason === 'completed') return 'completed';
  if (reason === 'cancelled') return 'cancelled';
  return 'error';
}

/**
 * Build the phase lanes for one run: declared phases first, in `meta.phases`
 * order, then phases only seen at runtime, then an unphased lane when needed.
 */
export function phaseLanes(run) {
  const order = [];
  const seen = new Set();
  const push = (title) => {
    if (seen.has(title)) return;
    seen.add(title);
    order.push(title);
  };
  for (const phase of run.declaredPhases) push(phase.title);
  for (const title of run.seenPhases) push(title);
  for (const node of run.nodes) push(node.phase ?? UNPHASED);
  return order.map((title, index) => {
    const declared = run.declaredPhases.find((phase) => phase.title === title);
    const nodes = run.nodes.filter((node) => (node.phase ?? UNPHASED) === title);
    const counts = { running: 0, completed: 0, failed: 0, cancelled: 0, interrupted: 0 };
    for (const node of nodes) counts[node.status] = (counts[node.status] ?? 0) + 1;
    let state = 'pending';
    if (counts.running > 0) state = 'running';
    else if (nodes.length > 0) state = counts.failed > 0 ? 'failed' : 'done';
    if (state === 'pending' && run.currentPhase === title && run.status === 'running') state = 'running';
    if (state === 'pending' && run.status !== 'running' && nodes.length === 0) state = 'skipped';
    return {
      id: `p${index}`,
      title,
      detail: declared?.detail ?? '',
      model: declared?.model ?? '',
      declared: declared !== undefined,
      state,
      counts,
      nodes: nodes.map((node) => node.seq),
    };
  });
}

/** Phase edges in lane order: the orchestration a reader follows left to right. */
export function phaseEdges(lanes) {
  const edges = [];
  for (let i = 1; i < lanes.length; i += 1) edges.push({ from: lanes[i - 1].id, to: lanes[i].id });
  return edges;
}

export function summaryOf(run) {
  const counts = { running: 0, completed: 0, failed: 0, cancelled: 0, interrupted: 0 };
  for (const node of run.nodes) counts[node.status] = (counts[node.status] ?? 0) + 1;
  return {
    id: run.id,
    name: run.name,
    description: run.description,
    sessionId: run.sessionId,
    status: run.status,
    currentPhase: run.currentPhase,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    agents: run.nodes.length,
    counts,
    phases: run.declaredPhases.length || run.seenPhases.length,
    error: run.error,
    rev: run.rev,
    hasScript: run.script !== '',
  };
}

export function detailOf(run) {
  const lanes = phaseLanes(run);
  return {
    ...summaryOf(run),
    whenToUse: run.whenToUse,
    background: run.background,
    agentsStarted: run.agentsStarted,
    graph: { lanes, edges: phaseEdges(lanes) },
    nodes: run.nodes.map((node) => ({ ...node })),
    logs: run.logs.slice(-MAX_LOGS),
    script: run.script,
    args: run.args,
    meta: run.meta,
  };
}

function freshRun(id, now) {
  return {
    id,
    name: '',
    description: '',
    whenToUse: '',
    meta: null,
    declaredPhases: [],
    seenPhases: [],
    sessionId: null,
    callId: null,
    status: 'running',
    currentPhase: null,
    startedAt: now,
    endedAt: null,
    stopReason: null,
    error: '',
    agentsStarted: 0,
    background: false,
    nodes: [],
    logs: [],
    script: '',
    args: null,
    rev: 0,
  };
}

function applyMeta(run, meta) {
  if (meta === null || typeof meta !== 'object') return;
  run.meta = {
    name: text(meta.name, 200),
    description: text(meta.description, 500),
    ...(typeof meta.whenToUse === 'string' ? { whenToUse: text(meta.whenToUse, 500) } : {}),
    ...(Array.isArray(meta.phases) ? { phases: meta.phases } : {}),
  };
  if (run.name === '') run.name = run.meta.name;
  run.description = run.meta.description;
  run.whenToUse = run.meta.whenToUse ?? '';
  if (Array.isArray(meta.phases)) {
    run.declaredPhases = meta.phases
      .filter((phase) => phase && typeof phase.title === 'string' && phase.title !== '')
      .slice(0, 32)
      .map((phase) => ({
        title: text(phase.title, 128),
        ...(typeof phase.detail === 'string' ? { detail: text(phase.detail, 300) } : {}),
        ...(typeof phase.model === 'string' ? { model: text(phase.model, 100) } : {}),
      }));
  }
}

/**
 * Create the in-memory store with optional JSON persistence under `dir`.
 * @param {{dir?: string, now?: () => number, maxRuns?: number, persistDelayMs?: number, logger?: object}} options
 */
export function createRunStore(options = {}) {
  const now = options.now ?? Date.now;
  const maxRuns = options.maxRuns ?? 200;
  const dir = options.dir ? path.join(options.dir, 'runs') : null;
  const persistDelayMs = options.persistDelayMs ?? 400;
  const logger = options.logger;
  const runs = new Map();
  /** sessionId -> workflow tool calls not yet matched to a run, oldest first. */
  const pendingCalls = new Map();
  const timers = new Map();
  let rev = 0;
  let closed = false;

  const warn = (message) => {
    try { logger?.warn?.(message); } catch { /* never break the host */ }
  };

  async function writeRun(run) {
    if (dir === null) return;
    try {
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${run.id}.json`);
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(run));
      await rename(tmp, file);
    } catch (error) {
      warn(`dynamic-workflow: cannot persist run ${run.id}: ${error?.message ?? error}`);
    }
  }

  function schedulePersist(run) {
    if (dir === null || closed) return;
    if (timers.has(run.id)) return;
    timers.set(run.id, setTimeout(() => {
      timers.delete(run.id);
      void writeRun(run);
    }, run.status === 'running' ? persistDelayMs : 0));
  }

  function touch(run) {
    rev += 1;
    run.rev = rev;
    schedulePersist(run);
  }

  async function prune() {
    if (runs.size <= maxRuns) return;
    const ordered = [...runs.values()].sort((a, b) => a.startedAt - b.startedAt);
    for (const run of ordered.slice(0, runs.size - maxRuns)) {
      if (run.status === 'running') continue;
      runs.delete(run.id);
      if (dir !== null) await rm(path.join(dir, `${run.id}.json`), { force: true }).catch(() => {});
    }
  }

  function ensure(id) {
    let run = runs.get(id);
    if (run === undefined) {
      run = freshRun(id, now());
      runs.set(id, run);
      void prune();
    }
    return run;
  }

  /** Attach the oldest unmatched `workflow` tool call of this session with the same name. */
  function claimCall(run) {
    if (run.sessionId === null || run.script !== '') return;
    const queue = pendingCalls.get(run.sessionId);
    if (!queue || queue.length === 0) return;
    let index = queue.findIndex((call) => call.name === run.name);
    if (index === -1) index = 0;
    const [call] = queue.splice(index, 1);
    run.callId = call.callId;
    run.script = call.script;
    run.args = call.args;
    run.background = call.background;
    if (run.meta === null) applyMeta(run, call.meta);
  }

  function upsertNode(run, agent) {
    const seq = Number(agent.seq);
    if (!Number.isSafeInteger(seq) || seq < 1) return null;
    let node = run.nodes.find((candidate) => candidate.seq === seq);
    if (node === undefined) {
      node = {
        seq,
        label: text(agent.label, 200) || `agent #${seq}`,
        phase: typeof agent.phase === 'string' && agent.phase !== '' ? text(agent.phase, 128) : (run.currentPhase ?? null),
        childId: typeof agent.childId === 'string' ? agent.childId : null,
        status: 'running',
        startedAt: now(),
        endedAt: null,
      };
      run.nodes.push(node);
      run.nodes.sort((a, b) => a.seq - b.seq);
      if (node.phase !== null && !run.seenPhases.includes(node.phase)) run.seenPhases.push(node.phase);
    } else {
      if (typeof agent.label === 'string' && agent.label !== '') node.label = text(agent.label, 200);
      if (typeof agent.phase === 'string' && agent.phase !== '') node.phase = text(agent.phase, 128);
      if (typeof agent.childId === 'string') node.childId = agent.childId;
    }
    return node;
  }

  function pushLog(run, kind, message) {
    run.logs.push({ time: now(), kind, text: text(message, 2000) });
    if (run.logs.length > MAX_LOGS) run.logs.splice(0, run.logs.length - MAX_LOGS);
  }

  const api = {
    get rev() { return rev; },

    /** Engine `workflow/start`. */
    runStart(info) {
      if (!info || typeof info.id !== 'string') return;
      const run = ensure(info.id);
      applyMeta(run, info.meta);
      pushLog(run, 'start', `▶ ${run.name}`);
      claimCall(run);
      touch(run);
    },

    /** Engine `workflow/phase`. */
    phase(info, title) {
      if (!info || typeof info.id !== 'string' || typeof title !== 'string') return;
      const run = ensure(info.id);
      if (run.meta === null) applyMeta(run, info.meta);
      run.currentPhase = text(title, 128);
      if (!run.seenPhases.includes(run.currentPhase)) run.seenPhases.push(run.currentPhase);
      pushLog(run, 'phase', `▸ ${run.currentPhase}`);
      touch(run);
    },

    /** Engine `workflow/log`. */
    log(info, message) {
      if (!info || typeof info.id !== 'string') return;
      const run = ensure(info.id);
      pushLog(run, 'log', String(message ?? ''));
      touch(run);
    },

    /** Engine `workflow/agent-start` or session `tool-workflow/agent-start`. */
    agentStart(runId, agent) {
      if (typeof runId !== 'string' || !agent) return;
      const run = ensure(runId);
      const before = run.nodes.length;
      const node = upsertNode(run, agent);
      if (node === null) return;
      if (run.nodes.length !== before) pushLog(run, 'agent', `#${node.seq} ${node.label} started`);
      touch(run);
    },

    /** Engine `workflow/agent-end` or session `tool-workflow/agent-end`. */
    agentEnd(runId, agent) {
      if (typeof runId !== 'string' || !agent) return;
      const run = ensure(runId);
      const node = upsertNode(run, agent);
      if (node === null) return;
      const status = NODE_STATUS.includes(agent.outcome) ? agent.outcome : 'failed';
      if (node.status === status && node.endedAt !== null) return;
      node.status = status;
      node.endedAt = now();
      pushLog(run, 'agent', `#${node.seq} ${node.label} ${status}`);
      touch(run);
    },

    /** Engine `workflow/end` or session `tool-workflow/run-end`. */
    runEnd(runId, result) {
      if (typeof runId !== 'string') return;
      const run = ensure(runId);
      const reason = result?.stopReason ?? 'completed';
      const already = run.status !== 'running';
      run.stopReason = reason;
      run.status = stopToStatus(reason);
      if (typeof result?.error === 'string') run.error = text(result.error, 2000);
      if (Number.isSafeInteger(result?.agentsStarted)) run.agentsStarted = result.agentsStarted;
      if (run.endedAt === null) run.endedAt = now();
      for (const node of run.nodes) {
        if (node.status === 'running') {
          node.status = run.status === 'completed' ? 'completed' : 'cancelled';
          node.endedAt = run.endedAt;
        }
      }
      if (!already) pushLog(run, 'end', `■ ${reason}${run.error ? `: ${run.error}` : ''}`);
      run.currentPhase = null;
      touch(run);
    },

    /** Session `tool-workflow/run-start`: binds the run to its owning session. */
    sessionRunStart(sessionId, data) {
      if (typeof sessionId !== 'string' || !data || typeof data.runId !== 'string') return;
      const run = ensure(data.runId);
      run.sessionId = sessionId;
      if (run.name === '' && typeof data.name === 'string') run.name = text(data.name, 200);
      claimCall(run);
      touch(run);
    },

    /** Session `tool/call` named `workflow`: keeps the script for display and re-saving. */
    toolCall(sessionId, callId, argumentsJson) {
      if (typeof sessionId !== 'string') return;
      let args;
      try { args = JSON.parse(argumentsJson); } catch { return; }
      if (!args || typeof args.script !== 'string') return;
      const queue = pendingCalls.get(sessionId) ?? [];
      queue.push({
        callId: typeof callId === 'string' ? callId : null,
        name: typeof args.meta?.name === 'string' ? args.meta.name : '',
        meta: args.meta ?? null,
        script: args.script.slice(0, MAX_SCRIPT),
        args: args.args ?? null,
        background: args.run_in_background === true,
      });
      if (queue.length > 16) queue.shift();
      pendingCalls.set(sessionId, queue);
      // The run may already exist when the engine event raced ahead.
      for (const run of runs.values()) {
        if (run.sessionId === sessionId && run.script === '') {
          claimCall(run);
          touch(run);
        }
      }
    },

    list(filter = {}) {
      const all = [...runs.values()]
        .filter((run) => (filter.sessionId ? run.sessionId === filter.sessionId : true))
        .sort((a, b) => b.startedAt - a.startedAt);
      return { rev, runs: all.map(summaryOf) };
    },

    get(runId) {
      const run = runs.get(runId);
      return run === undefined ? null : detailOf(run);
    },

    raw(runId) {
      return runs.get(runId);
    },

    async remove(runId) {
      const run = runs.get(runId);
      if (run === undefined) return false;
      if (run.status === 'running') throw new Error('cannot delete a running workflow');
      runs.delete(runId);
      rev += 1;
      if (dir !== null) await rm(path.join(dir, `${runId}.json`), { force: true });
      return true;
    },

    /** Load persisted runs; anything still `running` belonged to a dead process. */
    async load() {
      if (dir === null) return 0;
      let names = [];
      try { names = await readdir(dir); } catch { return 0; }
      let loaded = 0;
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        try {
          const run = JSON.parse(await readFile(path.join(dir, name), 'utf8'));
          if (!run || typeof run.id !== 'string' || runs.has(run.id)) continue;
          const merged = { ...freshRun(run.id, run.startedAt ?? now()), ...run };
          if (merged.status === 'running') {
            merged.status = 'interrupted';
            merged.endedAt = merged.endedAt ?? now();
            for (const node of merged.nodes) if (node.status === 'running') node.status = 'interrupted';
            schedulePersist(merged);
          }
          rev += 1;
          merged.rev = rev;
          runs.set(merged.id, merged);
          loaded += 1;
        } catch (error) {
          warn(`dynamic-workflow: skipped unreadable run file ${name}: ${error?.message ?? error}`);
        }
      }
      await prune();
      return loaded;
    },

    /** Flush pending writes; used on dispose and in tests. */
    async flush() {
      const pending = [...timers.keys()];
      for (const id of pending) {
        clearTimeout(timers.get(id));
        timers.delete(id);
        const run = runs.get(id);
        if (run) await writeRun(run);
      }
    },

    async close() {
      await api.flush();
      closed = true;
    },
  };
  return api;
}
