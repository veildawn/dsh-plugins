/**
 * dsh-prompt-history host module
 *
 * Exposes a trusted-host RPC channel for persisting prompt history per session
 * on the host filesystem (~/.dsh/prompt-history/<sessionId>.json).
 * Synchronizes history across different browsers and client instances.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import {
  RPC_CHANNEL,
  sessionFilePath,
  getPromptHistoryDir,
  pushHistory,
  sanitizeHistory,
  DEFAULT_MAX_HISTORY,
  GLOBAL_SESSION_ID,
} from './core.js';

export const name = 'prompt-history';
export const inject = ['connection'];
export { RPC_CHANNEL };

/**
 * Read session prompt history from host filesystem.
 * @param {string} sessionId
 * @returns {Promise<string[]>}
 */
export async function loadSessionHistory(sessionId) {
  const filePath = sessionFilePath(sessionId);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const history = parsed && Array.isArray(parsed.history) ? parsed.history : [];
    return sanitizeHistory(history, DEFAULT_MAX_HISTORY);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return [];
    }
    return [];
  }
}

/**
 * Save session prompt history to host filesystem (atomic rename).
 * @param {string} sessionId
 * @param {string[]} history
 * @returns {Promise<void>}
 */
export async function saveSessionHistory(sessionId, history) {
  const dir = getPromptHistoryDir();
  await fs.mkdir(dir, { recursive: true });
  const filePath = sessionFilePath(sessionId);
  const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  const clean = sanitizeHistory(history, DEFAULT_MAX_HISTORY);
  const data = JSON.stringify({
    sessionId: sessionId || GLOBAL_SESSION_ID,
    history: clean,
    updatedAt: new Date().toISOString(),
  }, null, 2);

  await fs.writeFile(tmpPath, data, 'utf8');
  await fs.rename(tmpPath, filePath);
}

/**
 * Record a new prompt into session history on host.
 * @param {string} sessionId
 * @param {string} prompt
 * @returns {Promise<string[]>}
 */
export async function recordSessionPrompt(sessionId, prompt) {
  const existing = await loadSessionHistory(sessionId);
  const updated = pushHistory(existing, prompt, DEFAULT_MAX_HISTORY);
  await saveSessionHistory(sessionId, updated);
  return updated;
}

/**
 * RPC Request Dispatcher
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {string} method
 * @param {object} payload
 * @returns {Promise<{ ok: boolean, value?: any, error?: { message: string } }>}
 */
export async function handleRpc(ctx, method, payload = {}) {
  try {
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : GLOBAL_SESSION_ID;
    switch (method) {
      case 'load': {
        const history = await loadSessionHistory(sessionId);
        return { ok: true, value: { history, sessionId } };
      }
      case 'record': {
        const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
        if (!prompt.trim()) {
          const history = await loadSessionHistory(sessionId);
          return { ok: true, value: { history, sessionId } };
        }
        const updated = await recordSessionPrompt(sessionId, prompt);
        return { ok: true, value: { history: updated, sessionId } };
      }
      case 'clear': {
        const filePath = sessionFilePath(sessionId);
        try {
          await fs.unlink(filePath);
        } catch (e) {
          if (e && e.code !== 'ENOENT') throw e;
        }
        return { ok: true, value: { history: [], sessionId } };
      }
      default:
        return { ok: false, error: { message: `Unknown method: ${method}` } };
    }
  } catch (err) {
    return { ok: false, error: { message: err?.message || 'Host RPC execution failed' } };
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
