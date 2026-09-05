/**
 * dsh-prompt-history host module
 *
 * Trusted-host RPC channel that persists prompt history per session under
 * ~/.dsh/prompt-history/<sessionId>.json so browsers and terminals share one
 * source of truth. Writes for a given sessionId are serialized.
 */

import fs from 'node:fs/promises';
import {
  RPC_CHANNEL,
  sessionFilePath,
  getPromptHistoryDir,
  pushHistory,
  sanitizeHistory,
  DEFAULT_MAX_HISTORY,
  normalizeSessionId,
  rpcFailure,
  rpcOk,
} from './core.js';

export const name = 'prompt-history';
export const inject = ['connection'];
export { RPC_CHANNEL };

/** @type {Map<string, Promise<unknown>>} */
const sessionLocks = new Map();

/**
 * Run `fn` after any in-flight work for the same sessionId settles.
 * @template T
 * @param {string} sessionId
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withSessionLock(sessionId, fn) {
  const id = normalizeSessionId(sessionId);
  const prev = sessionLocks.get(id) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  sessionLocks.set(id, next);
  return next.finally(() => {
    if (sessionLocks.get(id) === next) sessionLocks.delete(id);
  });
}

/**
 * @param {string} sessionId
 * @returns {Promise<{ history: string[], missing: boolean }>}
 */
export async function loadSessionHistory(sessionId) {
  const filePath = sessionFilePath(sessionId);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const history = parsed && Array.isArray(parsed.history) ? parsed.history : [];
    return { history: sanitizeHistory(history, DEFAULT_MAX_HISTORY), missing: false };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { history: [], missing: true };
    }
    const code = typeof err?.code === 'string' ? err.code : 'read-failed';
    const error = new Error(err?.message || 'failed to read prompt history');
    error.code = code;
    throw error;
  }
}

/**
 * Atomic write: tmp file next to the target, then rename. Windows overwrites
 * by unlinking first. Temp files are removed on failure.
 * @param {string} sessionId
 * @param {string[]} history
 */
export async function saveSessionHistory(sessionId, history) {
  const dir = getPromptHistoryDir();
  await fs.mkdir(dir, { recursive: true });
  const filePath = sessionFilePath(sessionId);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  const clean = sanitizeHistory(history, DEFAULT_MAX_HISTORY);
  const data = JSON.stringify({
    sessionId: normalizeSessionId(sessionId),
    history: clean,
    updatedAt: new Date().toISOString(),
  }, null, 2);

  try {
    await fs.writeFile(tmpPath, data, 'utf8');
    try {
      await fs.rename(tmpPath, filePath);
    } catch (err) {
      if (err && (err.code === 'EEXIST' || err.code === 'EPERM')) {
        await fs.rm(filePath, { force: true });
        await fs.rename(tmpPath, filePath);
      } else {
        throw err;
      }
    }
  } catch (err) {
    try { await fs.rm(tmpPath, { force: true }); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * @param {string} sessionId
 * @param {string} prompt
 * @returns {Promise<string[]>}
 */
export async function recordSessionPrompt(sessionId, prompt) {
  return withSessionLock(sessionId, async () => {
    const { history } = await loadSessionHistory(sessionId);
    const updated = pushHistory(history, prompt, DEFAULT_MAX_HISTORY);
    await saveSessionHistory(sessionId, updated);
    return updated;
  });
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {string} method
 * @param {object} payload
 */
export async function handleRpc(ctx, method, payload = {}) {
  try {
    const sessionId = normalizeSessionId(payload?.sessionId);
    switch (method) {
      case 'load': {
        const { history } = await loadSessionHistory(sessionId);
        return rpcOk({ history, sessionId });
      }
      case 'record': {
        const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
        if (!prompt.trim()) {
          const { history } = await loadSessionHistory(sessionId);
          return rpcOk({ history, sessionId });
        }
        const updated = await recordSessionPrompt(sessionId, prompt);
        return rpcOk({ history: updated, sessionId });
      }
      case 'clear': {
        await withSessionLock(sessionId, async () => {
          const filePath = sessionFilePath(sessionId);
          try {
            await fs.unlink(filePath);
          } catch (e) {
            if (e && e.code !== 'ENOENT') throw e;
          }
        });
        return rpcOk({ history: [], sessionId });
      }
      default:
        return rpcFailure('unknown-method', `Unknown method: ${method}`, { method });
    }
  } catch (err) {
    const code = typeof err?.code === 'string' ? err.code : 'internal';
    ctx?.logger?.warn?.(`prompt-history: ${method} failed with ${code}`);
    return rpcFailure(code, err?.message || 'Host RPC execution failed', {});
  }
}

export function apply(ctx) {
  ctx.inject(['connection'], (connCtx) => {
    if (connCtx.connection?.rpc && typeof connCtx.connection.rpc.handle === 'function') {
      connCtx.connection.rpc.handle(
        RPC_CHANNEL,
        (method, payload) => handleRpc(ctx, method, payload),
        { authority: 'trusted-host' },
      );
    }
  });
}
