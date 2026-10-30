/**
 * dsh-repo-wiki — identifiers shared by the host half, the preset half, and the
 * browser bundle.
 *
 * This module has no side effects and imports nothing, so `lib/index.js`
 * (host: RPC + pipeline), `lib/tools.js` (preset: tools and prompt), and
 * `lib/client.js` (browser) can all depend on it without depending on each
 * other.
 *
 * The status names, the progress formula inputs, and the metadata table names
 * are copied verbatim from Qoder CN 1.35.0 so an existing `.qoder/repowiki`
 * export keeps working. See the spec's Introduction for the byte offsets the
 * evidence came from.
 *
 * @module dsh-repo-wiki/constants
 */

/** Cordis plugin name of the host row; must match the loader row `name`. */
export const name = '@weniatall/dsh-repo-wiki';

/** Settings namespace (also the settings directory name under DSH home). */
export const NS = 'repo-wiki';

/** RPC channel served by the host row for the Web panel. */
export const RPC_CHANNEL = '/dsh-repo-wiki';

/** Tool names registered by the preset half. */
export const TOOL_NAMES = Object.freeze({
  list: 'list_wiki',
  read: 'read_wiki',
  write: 'write_wiki',
  edit: 'edit_wiki',
  delete: 'delete_wiki',
  search: 'search_wiki',
  listKnowledge: 'list_knowledge',
  readKnowledge: 'read_knowledge',
});

/**
 * Knowledge-card categories, in Qoder's `V4g` order and naming. A card's
 * `category` is exactly one of these; the UI's filter row and the agent's
 * `list_knowledge` filter both speak this vocabulary.
 */
export const CARD_CATEGORIES = Object.freeze([
  'overview',
  'architecture_design',
  'tech_stack',
  'coding_conventions',
  'unique_setup_and_commands',
]);

/**
 * The `wiki_present_status` state machine.
 *
 * Grouped exactly like Qoder's own predicates:
 *   - running: `WAITING`, `LINING`, `INITIALIZING`, `DIRECTORY_GENERATING`,
 *     `DOCUMENT_GENERATING`
 *   - success: `COMPLETED`, `PARTLY_COMPLETED`
 *   - failure: `INITIALIZING_FAILED`, `DIRECTORY_FAILED`, `DOCUMENT_FAILED`,
 *     `NOT_SOURCE_CONTROL_FAILED`, `TOO_MANY_FILES_FAILED`,
 *     `TOO_MANY_WORKSPACE_FAILED`, `NO_FILE_FAILED`,
 *     `NO_COMMIT_HISTORY_FAILED`, `INSUFFICIENT_REMAINING_SEATS_FAILED`
 *   - idle: `WIKI_INIT`, `PAUSED`
 *   - drift (an existing wiki that no longer matches HEAD):
 *     `WIKI_EXIST`, `WIKI_HAS_COMMIT`, `WIKI_HAS_CHANGE`, `WIKI_LOSS_COMMIT`,
 *     `WIKI_LOAD_FAIL`, `SERVICE_RECOVERING`, `NETWORK_ERROR`
 */
export const STATUS = Object.freeze({
  WIKI_INIT: 'WIKI_INIT',
  WAITING: 'WAITING',
  LINING: 'LINING',
  INITIALIZING: 'INITIALIZING',
  DIRECTORY_GENERATING: 'DIRECTORY_GENERATING',
  DOCUMENT_GENERATING: 'DOCUMENT_GENERATING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  PARTLY_COMPLETED: 'PARTLY_COMPLETED',
  INITIALIZING_FAILED: 'INITIALIZING_FAILED',
  DIRECTORY_FAILED: 'DIRECTORY_FAILED',
  DOCUMENT_FAILED: 'DOCUMENT_FAILED',
  NO_FILE_FAILED: 'NO_FILE_FAILED',
  TOO_MANY_FILES_FAILED: 'TOO_MANY_FILES_FAILED',
  TOO_MANY_WORKSPACE_FAILED: 'TOO_MANY_WORKSPACE_FAILED',
  NOT_SOURCE_CONTROL_FAILED: 'NOT_SOURCE_CONTROL_FAILED',
  NO_COMMIT_HISTORY_FAILED: 'NO_COMMIT_HISTORY_FAILED',
  INSUFFICIENT_REMAINING_SEATS_FAILED: 'INSUFFICIENT_REMAINING_SEATS_FAILED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  WIKI_EXIST: 'WIKI_EXIST',
  WIKI_HAS_COMMIT: 'WIKI_HAS_COMMIT',
  WIKI_HAS_CHANGE: 'WIKI_HAS_CHANGE',
  WIKI_LOSS_COMMIT: 'WIKI_LOSS_COMMIT',
  WIKI_LOAD_FAIL: 'WIKI_LOAD_FAIL',
  SERVICE_RECOVERING: 'SERVICE_RECOVERING',
});

/** States the pipeline is actively advancing through. */
export const RUNNING_STATUSES = Object.freeze([
  STATUS.WAITING,
  STATUS.LINING,
  STATUS.INITIALIZING,
  STATUS.DIRECTORY_GENERATING,
  STATUS.DOCUMENT_GENERATING,
]);

/** States that mean "a wiki exists and is readable". */
export const SUCCESS_STATUSES = Object.freeze([STATUS.COMPLETED, STATUS.PARTLY_COMPLETED]);

/** States that mean "the last attempt failed". */
export const FAILED_STATUSES = Object.freeze([
  STATUS.INITIALIZING_FAILED,
  STATUS.DIRECTORY_FAILED,
  STATUS.DOCUMENT_FAILED,
  STATUS.NO_FILE_FAILED,
  STATUS.TOO_MANY_FILES_FAILED,
  STATUS.TOO_MANY_WORKSPACE_FAILED,
  STATUS.NOT_SOURCE_CONTROL_FAILED,
  STATUS.NO_COMMIT_HISTORY_FAILED,
  STATUS.INSUFFICIENT_REMAINING_SEATS_FAILED,
  STATUS.NETWORK_ERROR,
]);

/** States where an existing wiki has drifted from the working tree. */
export const DRIFT_STATUSES = Object.freeze([
  STATUS.WIKI_EXIST,
  STATUS.WIKI_HAS_COMMIT,
  STATUS.WIKI_HAS_CHANGE,
  STATUS.WIKI_LOSS_COMMIT,
  STATUS.WIKI_LOAD_FAIL,
  STATUS.SERVICE_RECOVERING,
]);

/** Per-catalog progress values, matching Qoder's `progress_status` column. */
export const CATALOG_STATUS = Object.freeze({
  pending: 'pending',
  processing: 'processing',
  completed: 'completed',
  failed: 'failed',
});

/** Generation kind recorded in `wiki_repo.generation_type`. */
export const GENERATION_TYPE = Object.freeze({ full: 'FULL', increment: 'INCREMENT' });

/** The four metadata tables, in the order Qoder writes them. */
export const METADATA_TABLES = Object.freeze([
  'wiki_repo',
  'wiki_catalogs',
  'wiki_items',
  'knowledge_relations',
]);

/** Top-level directory names inside the repowiki root. */
export const LAYOUT = Object.freeze({
  content: 'content',
  meta: 'meta',
  knowledge: 'knowledge',
  metadataFile: 'repowiki-metadata.json',
  planFile: 'wiki_plan.yaml',
  moduleFile: '_module.yaml',
  indexFile: '_index.yaml',
});

/** Supported generation languages. */
export const LANGUAGES = Object.freeze(['zh', 'en']);

/** Languages Qoder also accepts, folded onto the two we write. */
export const LANGUAGE_ALIASES = Object.freeze({
  zh: 'zh',
  'zh-cn': 'zh',
  'zh-hans': 'zh',
  en: 'en',
  'en-us': 'en',
  'en-gb': 'en',
});

/**
 * The locale string Qoder itself uses inside `wiki_repo.extend_info` and the
 * repository-id hash seed. Real exports carry `"language":"zh-cn"`.
 * @param {string} language one of {@link LANGUAGES}
 * @returns {'zh-cn'|'en-us'}
 */
export function qoderLocale(language) {
  return String(language ?? '').toLowerCase().startsWith('en') ? 'en-us' : 'zh-cn';
}

/**
 * The pseudo-branch Qoder substitutes when the workspace is not a Git
 * repository, so the repository id is still derivable (`Mzg` in the frontend
 * bundle; the same literal is embedded in the backend binary).
 */
export const NON_GIT_BRANCH = 'Q0DeR-MaG1C-BrAnCh-Fo2-NoN-GiT-Or-No-C0MmIt';

/** Built-in settings; the saved settings file and profile config override. */
export const DEFAULT_SETTINGS = Object.freeze({
  /** Directory (relative to the workspace) that holds `repowiki/`. */
  dataDir: '.dsh',
  /** Generation/read language. */
  language: 'zh',
  /** Hard cap on analysable files; mirrors Qoder's 10,000 limit. */
  maxFiles: 10000,
  /** Maximum catalog tree depth before deeper pages are flattened. */
  maxDepth: 4,
  /** Maximum `<cite>` entries per page. */
  maxCitations: 40,
  /** Pages written concurrently during the document stage. */
  concurrency: 2,
  /** Auto-run an incremental update when HEAD moves. */
  autoUpdate: false,
  /** Debounce for auto-update, in milliseconds. */
  autoUpdateDelayMs: 60000,
  /** Emit the `<cite>` block at the top of every page. */
  citation: true,
  /** Explicit model route; empty means "ask the host default model". */
  provider: '',
  model: '',
  /** Prompt contributions (preset half only). */
  promptEnabled: true,
  /** Maximum catalog lines injected into the prompt. */
  promptMaxCatalogs: 40,
});

/** Settings keys that the browser settings page may write. */
export const EDITABLE_SETTINGS = Object.freeze([
  'dataDir',
  'language',
  'maxFiles',
  'maxDepth',
  'maxCitations',
  'concurrency',
  'autoUpdate',
  'autoUpdateDelayMs',
  'citation',
  'provider',
  'model',
  'promptEnabled',
  'promptMaxCatalogs',
]);

/** Reserved file name prefix Qoder uses for fields it encrypts at rest. */
export const ENCRYPTED_PREFIX = 'WikiEncrypted:';

/** Error codes surfaced over RPC and from tools. */
export const ERROR_CODES = Object.freeze({
  llmUnavailable: 'llm-unavailable',
  metadataCorrupt: 'metadata-corrupt',
  planInvalid: 'plan-invalid',
  noWorkspace: 'no-workspace',
  busy: 'busy',
  languageLocked: 'language-locked',
  catalogNotFound: 'catalog-not-found',
  pageNotFound: 'page-not-found',
  ambiguousEdit: 'ambiguous-edit',
  notFound: 'not-found',
  unknownMethod: 'unknown-method',
  internal: 'internal-error',
});
