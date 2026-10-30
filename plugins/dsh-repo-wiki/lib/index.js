/**
 * dsh-repo-wiki — the host half.
 *
 * Mounted by the loader row `repo-wiki` in this package's `cordis.patch.yml`.
 * This half owns exactly two things: the trusted-host RPC channel the Web panel
 * calls, and the generation pipeline behind it.
 *
 * It registers NO tools and NO system-prompt contributions. Those belong to the
 * `repo-wiki` Agent preset (`presets/repo-wiki.patch.yml`), whose child row
 * mounts `@weniatall/dsh-repo-wiki/tools` inside that preset's scope. A session
 * that did not select the Repo Wiki preset therefore never sees a `*_wiki` tool
 * or the wiki policy section, while the Web panel keeps working in every
 * session.
 *
 * `llm` is looked up softly rather than injected: a host without a model service
 * must still serve the panel (browse an existing wiki, use the tools) and only
 * report `llm-unavailable` when generation is actually requested. Injecting it
 * would make the whole row fail to activate on such a host.
 *
 * @module dsh-repo-wiki
 */

import {
  DEFAULT_SETTINGS,
  ERROR_CODES,
  NS,
  RPC_CHANNEL,
  STATUS,
  TOOL_NAMES,
  name,
} from './constants.js';
import {
  dispatchRpc,
  hasWikiFor,
  catalogPromptLines,
  dshHome,
  effectiveSettings,
  sanitizeSettings,
  settingsFilePath,
  workspaceFor,
} from './ops.js';
import { WikiError } from './store.js';
import { WikiPipeline } from './pipeline.js';

export { DEFAULT_SETTINGS, NS, RPC_CHANNEL, STATUS, TOOL_NAMES, name };

/** Required host services: the RPC carrier. `llm` is looked up softly. */
export const inject = ['connection'];

/* ------------------------------------------------------------------------- *
 * RPC envelope
 * ------------------------------------------------------------------------- */

function rpcOk(value) {
  return { ok: true, value };
}

function rpcError(error) {
  return {
    ok: false,
    error: {
      code: error instanceof WikiError ? error.code : 'internal-error',
      message: error instanceof Error ? error.message : String(error),
      details: error instanceof WikiError ? error.details : {},
    },
  };
}

/* ------------------------------------------------------------------------- *
 * Diagnostics
 * ------------------------------------------------------------------------- */

function noteDiagnostic(ctx, message) {
  try {
    if (typeof ctx?.logger?.warn === 'function') ctx.logger.warn(message);
  } catch {
    // diagnostics never break load
  }
}

function safeGet(ctx, key) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(key, false) : undefined;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------------- *
 * Entry
 * ------------------------------------------------------------------------- */

/**
 * Mount the host half.
 * @param {object} ctx Cordis context.
 * @param {unknown} [config] profile config.
 */
export function apply(ctx, config) {
  const connection = ctx.connection;
  if (connection?.rpc && typeof connection.rpc.handle === 'function') {
    const dispose = connection.rpc.handle(
      RPC_CHANNEL,
      async (method, payload) => {
        try {
          const value = await dispatchRpc(
            ctx,
            config,
            method,
            payload !== null && typeof payload === 'object' ? payload : {},
          );
          return rpcOk(value);
        } catch (error) {
          return rpcError(error);
        }
      },
      { authority: 'trusted-host' },
    );
    if (typeof dispose === 'function') ctx.on?.('dispose', () => void dispose());
  } else {
    noteDiagnostic(ctx, 'repo-wiki: connection.rpc is unavailable; the Web panel cannot reach the wiki');
  }

  // A host without a model service is a supported configuration: the panel and
  // the tools work against an existing wiki, and only generation reports the
  // missing capability. Record it once so the log says why.
  if (safeGet(ctx, 'llm') === undefined) {
    noteDiagnostic(
      ctx,
      'repo-wiki: no llm service is mounted; browsing an existing wiki works, generation returns llm-unavailable',
    );
  }

  // Surface the resolved locations once, so a support log answers "where did it
  // put the files?" without asking the user to run anything.
  try {
    if (typeof ctx?.logger?.info === 'function') {
      ctx.logger.info(`repo-wiki: RPC ${RPC_CHANNEL}, settings ${settingsFilePath()}, home ${dshHome()}`);
    }
  } catch {
    // logging is best-effort
  }
}

export { WikiPipeline, WikiError, effectiveSettings, sanitizeSettings, workspaceFor, hasWikiFor, catalogPromptLines };
export { ERROR_CODES };
