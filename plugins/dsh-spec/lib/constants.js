/**
 * dsh-spec — identifiers shared by the host half and the preset half.
 *
 * This module has no side effects and imports nothing, so both
 * `lib/index.js` (host: RPC channel) and `lib/tools.js` (preset: tools and
 * prompt) can depend on it without depending on each other.
 *
 * @module dsh-spec/constants
 */

/** Cordis plugin name of the host row; must match the loader row `name`. */
export const name = '@weniatall/dsh-spec';

/** Settings namespace. */
export const NS = 'spec';

/** RPC channel served by the host row for the Web panel. */
export const RPC_CHANNEL = '/dsh-spec';

/** Tool names registered by the preset half. */
export const TOOL_NAMES = Object.freeze({
  create: 'spec_create',
  list: 'spec_list',
  read: 'spec_read',
  write: 'spec_write',
  check: 'spec_check',
  taskUpdate: 'spec_task_update',
  next: 'spec_next',
  pbt: 'spec_pbt',
});

/** Built-in settings; profile config and the saved settings file override. */
export const DEFAULT_SETTINGS = Object.freeze({
  kiroDir: '.kiro',
  promptEnabled: true,
  includeActiveSpecs: true,
  promptMaxSpecs: 5,
  strict: false,
  defaultSpecType: 'feature',
  defaultWorkflow: 'requirements-first',
  // Empty means "follow DSH's own language" (Settings → General). Setting it
  // pins the UI language and the language the documents are written in, which
  // is what someone wants when their OS language is not the language they
  // write specs in.
  language: '',
});
