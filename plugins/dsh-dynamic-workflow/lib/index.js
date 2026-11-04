/**
 * dsh-dynamic-workflow — host half.
 *
 * Mirrors ZCode's `/workflow` surface on top of DSH's own workflow seam:
 *
 *   - every run of the model-facing `workflow` tool is folded into a live
 *     graph (phase lanes → agent nodes → phase edges) from two sources: the
 *     engine's `workflow/*` events and the parent session's `tool-workflow/*`
 *     records plus the `tool/call` that carried the script;
 *   - a run's script can be saved as a named workflow, project-scoped
 *     (`<workspace>/.dsh/workflows`) or global (`$DSH_HOME/dynamic-workflow/workflows`);
 *   - a saved workflow is re-launched into a session as a follow-up turn that
 *     asks the model to call the `workflow` tool with the saved arguments
 *     verbatim (ZCode's `workflowLaunch` turn origin), from the panel or with
 *     `/workflow <name> [json-args]`.
 *
 * The Web panel reads all of it over the trusted-host `/dsh-dynamic-workflow`
 * RPC channel and long-polls `watch` for live updates.
 *
 * @module dsh-dynamic-workflow
 */
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

import { createRunStore } from './store.js?dsh-dynamic-workflow=0.1.0';
import { createWorkflowLibrary, launchPrompt, parseCommandInput } from './library.js?dsh-dynamic-workflow=0.1.0';

export const name = 'dynamic-workflow';
export const RPC_CHANNEL = '/dsh-dynamic-workflow';
export const inject = ['connection'];

const WORKFLOW_TOOL = 'workflow';
const MAX_WATCH_MS = 25_000;

function dshHome() {
  return process.env.DSH_HOME || path.join(homedir(), '.dsh');
}

function safeGet(ctx, key) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(key, false) : undefined;
  } catch {
    return undefined;
  }
}

function warn(ctx, message) {
  try { ctx?.logger?.warn?.(message); } catch { /* diagnostics never break load */ }
}

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function str(value, field, { optional = false, max = 512 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return undefined;
    throw new RpcError('invalid-argument', `${field} is required`);
  }
  if (typeof value !== 'string' || value.length > max) throw new RpcError('invalid-argument', `${field} must be a string`);
  return value;
}

/** Workspace of a live session, used for project-scoped workflows. */
function sessionCwd(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined;
  const cwd = safeGet(ctx, 'sessions')?.get?.(sessionId)?.header?.cwd;
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : undefined;
}

/** Build a user message, preferring the host factory so ids/freezing match. */
let createUserMessage;
async function userMessage(text) {
  if (createUserMessage === undefined) {
    try {
      createUserMessage = (await import('@deepseek-ai/dsh-llm')).createUserMessage ?? null;
    } catch {
      createUserMessage = null;
    }
  }
  const input = { content: [{ type: 'text', text }], source: { kind: 'user' } };
  if (typeof createUserMessage === 'function') return createUserMessage(input);
  return Object.freeze({ id: randomUUID(), role: 'user', ...input });
}

/**
 * Wire the store to the host's event bus. Exported for tests.
 * @returns {() => void} detach
 */
export function subscribe(ctx, store, notify) {
  const offs = [];
  const on = (event, handler) => {
    if (typeof ctx?.on !== 'function') return;
    const off = ctx.on(event, (...args) => {
      try {
        handler(...args);
        notify();
      } catch (error) {
        warn(ctx, `dynamic-workflow: ${event} handler failed: ${error?.message ?? error}`);
      }
    });
    if (typeof off === 'function') offs.push(off);
  };
  on('workflow/start', (info) => store.runStart(info));
  on('workflow/phase', (info, title) => store.phase(info, title));
  on('workflow/log', (info, message) => store.log(info, message));
  on('workflow/agent-start', (info, agent) => store.agentStart(info?.id, agent));
  on('workflow/agent-end', (info, agent) => store.agentEnd(info?.id, agent));
  on('workflow/end', (info, result) => store.runEnd(info?.id, result));
  on('session/event', (session, event) => {
    const sessionId = session?.id;
    const data = event?.data;
    switch (event?.type) {
      case 'tool/call':
        if (data?.name === WORKFLOW_TOOL) store.toolCall(sessionId, data.callId, data.arguments);
        break;
      case 'tool-workflow/run-start':
        store.sessionRunStart(sessionId, data);
        break;
      case 'tool-workflow/agent-start':
        store.agentStart(data?.runId, data);
        break;
      case 'tool-workflow/agent-end':
        store.agentEnd(data?.runId, data);
        break;
      case 'tool-workflow/run-end':
        store.runEnd(data?.runId, { stopReason: data?.stopReason });
        break;
      default:
        break;
    }
  });
  return () => { for (const off of offs.splice(0)) try { off(); } catch { /* ignore */ } };
}

/** Long-poll hub: resolves waiters as soon as the store revision moves. */
function createWatchHub(store) {
  const waiters = new Set();
  return {
    notify() {
      for (const waiter of [...waiters]) {
        if (store.rev > waiter.since) {
          waiters.delete(waiter);
          clearTimeout(waiter.timer);
          waiter.resolve(store.rev);
        }
      }
    },
    wait(since, timeoutMs) {
      if (store.rev > since) return Promise.resolve(store.rev);
      return new Promise((resolve) => {
        const waiter = { since, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          waiters.delete(waiter);
          resolve(store.rev);
        }, timeoutMs);
        waiters.add(waiter);
      });
    },
    close() {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.resolve(store.rev);
      }
      waiters.clear();
    },
  };
}

/** Launch a saved workflow into a session as a follow-up turn. */
async function launch(ctx, library, { sessionId, name: workflowName, scope, args }) {
  const agent = safeGet(ctx, 'agents')?.get?.(sessionId);
  if (!agent || typeof agent.followup !== 'function') throw new RpcError('session-unavailable', `session ${sessionId} is not live`);
  const saved = await library.get(workflowName, { scope, cwd: sessionCwd(ctx, sessionId) });
  if (saved === null) throw new RpcError('not-found', `workflow "${workflowName}" is not saved`);
  agent.followup(await userMessage(launchPrompt(saved, args)));
  return { launched: saved.name, scope: saved.scope };
}

/** RPC dispatch. Exported for tests. */
export async function dispatch(ctx, deps, method, payload) {
  const { store, library, hub } = deps;
  const sessionId = str(payload.sessionId, 'sessionId', { optional: true });
  const cwd = sessionCwd(ctx, sessionId);
  switch (method) {
    case 'describe':
      return {
        rev: store.rev,
        toolName: WORKFLOW_TOOL,
        projectDir: cwd ? library.projectDir(cwd) : null,
        globalDir: library.globalDir,
      };
    case 'watch': {
      const since = Number.isSafeInteger(payload.since) ? payload.since : -1;
      const timeout = Math.min(Math.max(Number(payload.timeoutMs) || MAX_WATCH_MS, 1000), MAX_WATCH_MS);
      return { rev: await hub.wait(since, timeout) };
    }
    case 'runs':
      return store.list(payload.all === true ? {} : { sessionId });
    case 'run': {
      const run = store.get(str(payload.runId, 'runId'));
      if (run === null) throw new RpcError('not-found', 'run not found');
      return run;
    }
    case 'deleteRun':
      return { deleted: await store.remove(str(payload.runId, 'runId')) };
    case 'workflows':
      return { workflows: await library.list({ cwd }) };
    case 'workflow': {
      const saved = await library.get(str(payload.name, 'name', { max: 64 }), { scope: payload.scope, cwd });
      if (saved === null) throw new RpcError('not-found', 'workflow not found');
      return saved;
    }
    case 'saveRun': {
      const raw = store.raw(str(payload.runId, 'runId'));
      if (raw === undefined) throw new RpcError('not-found', 'run not found');
      if (raw.script === '') throw new RpcError('no-script', 'this run carries no recorded script');
      const meta = { ...(raw.meta ?? {}), name: str(payload.name, 'name', { optional: true, max: 64 }) ?? raw.meta?.name ?? raw.name };
      return library.save({ meta, script: raw.script, args: raw.args ?? undefined }, { scope: payload.scope, cwd, sourceRunId: raw.id });
    }
    case 'deleteWorkflow':
      return { deleted: await library.remove(str(payload.name, 'name', { max: 64 }), { scope: payload.scope, cwd }) };
    case 'launch':
      return launch(ctx, library, {
        sessionId: str(payload.sessionId, 'sessionId'),
        name: str(payload.name, 'name', { max: 64 }),
        scope: payload.scope,
        args: payload.args,
      });
    default:
      throw new RpcError('unknown-method', `unknown method ${method}`);
  }
}

/** `/workflow` slash command: list saved workflows or launch one. */
function commandDefinition(ctx, library) {
  return {
    name: 'workflow',
    description: 'Run a saved dynamic workflow: /workflow <name> [json-args]; /workflow lists them',
    input: { hint: '<name> [json-args]' },
    async handler(invocation) {
      const sessionId = invocation.agent?.session?.id ?? invocation.agent?.sessionId;
      const cwd = invocation.agent?.session?.header?.cwd ?? sessionCwd(ctx, sessionId);
      let parsed;
      try {
        parsed = parseCommandInput(invocation.rawInput);
      } catch (error) {
        return { kind: 'error', text: error.message };
      }
      if (parsed.name === '') {
        const all = await library.list({ cwd });
        if (all.length === 0) return { kind: 'success', text: 'No saved workflows. Save one from the 编排 / Workflows tab after a run.' };
        return {
          kind: 'success',
          text: all.map((wf) => `- ${wf.name} [${wf.scope}]${wf.description ? ` — ${wf.description}` : ''}`).join('\n'),
        };
      }
      const saved = await library.get(parsed.name, { scope: parsed.scope, cwd });
      if (saved === null) return { kind: 'error', text: `workflow "${parsed.name}" is not saved` };
      invocation.agent.followup(await userMessage(launchPrompt(saved, parsed.args)));
      return { kind: 'success', text: `Launching workflow "${saved.name}" (${saved.scope})` };
    },
  };
}

export function apply(ctx, config = {}) {
  const home = path.join(dshHome(), 'dynamic-workflow');
  const store = createRunStore({ dir: config.persist === false ? undefined : home, logger: ctx.logger, maxRuns: config.maxRuns ?? 200 });
  const library = createWorkflowLibrary({ globalDir: path.join(home, 'workflows') });
  const hub = createWatchHub(store);
  const deps = { store, library, hub };

  const detach = subscribe(ctx, store, () => hub.notify());
  void store.load().then(() => hub.notify(), (error) => warn(ctx, `dynamic-workflow: load failed: ${error?.message ?? error}`));

  const connection = ctx.connection;
  let disposeRpc;
  if (connection?.rpc && typeof connection.rpc.handle === 'function') {
    disposeRpc = connection.rpc.handle(
      RPC_CHANNEL,
      async (method, payload) => {
        try {
          return { ok: true, value: await dispatch(ctx, deps, method, payload !== null && typeof payload === 'object' ? payload : {}) };
        } catch (error) {
          return { ok: false, error: { code: error?.code ?? 'internal-error', message: error instanceof Error ? error.message : String(error) } };
        }
      },
      { authority: 'trusted-host' },
    );
  } else {
    warn(ctx, 'dynamic-workflow: connection.rpc is unavailable; the panel cannot read runs');
  }

  const installCommand = (scope) => {
    const commands = scope?.commands ?? safeGet(scope, 'commands');
    if (!commands || typeof commands.register !== 'function') return undefined;
    try {
      return commands.register(commandDefinition(ctx, library));
    } catch (error) {
      warn(ctx, `dynamic-workflow: cannot register /workflow: ${error?.message ?? error}`);
      return undefined;
    }
  };
  if (typeof ctx.inject === 'function') {
    ctx.inject(['commands'], (scope) => {
      const off = installCommand(scope);
      if (typeof off === 'function') scope.on?.('dispose', off);
    });
  } else {
    const off = installCommand(ctx);
    if (typeof off === 'function') ctx.on?.('dispose', off);
  }

  ctx.on?.('dispose', () => {
    detach();
    hub.close();
    if (typeof disposeRpc === 'function') void disposeRpc();
    void store.close();
  });

  return deps;
}
