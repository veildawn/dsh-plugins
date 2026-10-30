/**
 * dsh-repo-wiki — on-disk storage for the generated knowledge base.
 *
 * The layout is Qoder's, so an existing `.qoder/repowiki` export can be dropped
 * under `.dsh/repowiki` and read as-is:
 *
 *   <workspace>/<dataDir>/repowiki/
 *     ├── <language>/content/<category…>/<page>.md
 *     ├── <language>/meta/repowiki-metadata.json
 *     ├── knowledge/<language>/<module>/_module.yaml + <card>.md
 *     └── wiki_plan.yaml
 *
 * Reads never rewrite anything. Writes are limited to what the wiki owns: page
 * bodies, the metadata tables, knowledge cards, and the plan file. Every write
 * is atomic (temp file + rename) and serialized per wiki root, so an interrupted
 * generation can never leave a half-written `repowiki-metadata.json` behind.
 *
 * The metadata reader tolerates Qoder's `WikiEncrypted:` fields — those are
 * opaque blobs Qoder keeps for its own re-import path, and refusing to read a
 * file just because it carries one would make every Qoder export unreadable.
 *
 * @module dsh-repo-wiki/store
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  CATALOG_STATUS,
  ENCRYPTED_PREFIX,
  ERROR_CODES,
  LAYOUT,
  METADATA_TABLES,
  STATUS,
  qoderLocale,
} from './constants.js';

/** A failure the RPC layer can turn into a structured error envelope. */
export class WikiError extends Error {
  /**
   * @param {string} code one of {@link ERROR_CODES}
   * @param {string} message
   * @param {object} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WikiError';
    this.code = code;
    this.details = details;
  }
}

/* ------------------------------------------------------------------------- *
 * Paths
 * ------------------------------------------------------------------------- */

/** The `repowiki` root for a workspace. */
export function wikiRoot(workspace, settings) {
  const dataDir = normalizeDataDir(settings?.dataDir);
  return path.join(workspace, dataDir, 'repowiki');
}

/** `<root>/<language>` — the per-language product root. */
export function languageRoot(workspace, settings, language) {
  return path.join(wikiRoot(workspace, settings), normalizeLanguage(language ?? settings?.language));
}

/** `<root>/<language>/meta/repowiki-metadata.json`. */
export function metadataPath(workspace, settings, language) {
  return path.join(languageRoot(workspace, settings, language), LAYOUT.meta, LAYOUT.metadataFile);
}

/** `<root>/wiki_plan.yaml`. */
export function planPath(workspace, settings) {
  return path.join(wikiRoot(workspace, settings), LAYOUT.planFile);
}

/** `<root>/knowledge/<language>`. */
export function knowledgeRoot(workspace, settings, language) {
  return path.join(wikiRoot(workspace, settings), LAYOUT.knowledge, normalizeLanguage(language ?? settings?.language));
}

/** Normalize the configured data directory; refuses to escape the workspace. */
export function normalizeDataDir(dataDir) {
  const raw = typeof dataDir === 'string' && dataDir.trim() !== '' ? dataDir.trim() : '.dsh';
  const normalized = raw.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
  if (normalized === '' || normalized === '.') return '.dsh';
  if (normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized)) return '.dsh';
  if (normalized.split('/').includes('..')) return '.dsh';
  return normalized;
}

/** Fold a language tag onto the two languages we write. */
export function normalizeLanguage(language) {
  const raw = typeof language === 'string' ? language.trim().toLowerCase() : '';
  if (raw === '' ) return 'zh';
  if (raw === 'zh' || raw.startsWith('zh-') || raw === 'zh_cn') return 'zh';
  if (raw === 'en' || raw.startsWith('en-') || raw === 'en_us') return 'en';
  return 'zh';
}

/** Windows device names that cannot be used as a file stem. */
const RESERVED_STEMS = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

function guardReserved(stem, suffix) {
  return RESERVED_STEMS.has(stem.toLowerCase()) ? `${stem}${suffix}` : stem;
}

/**
 * Turn a page title into the file name Qoder's `Kbt` produces.
 *
 * Verified against the exporter in the extension bundle: every one of
 * `/ \ : * ? " < > |` becomes `_`, then the result is trimmed. Nothing else is
 * normalized — no length cap, no dot stripping, no empty fallback (a title made
 * only of illegal characters yields `''`, and Qoder skips exporting that page).
 * The only addition is the Windows reserved-stem guard, because a file named
 * `con.md` cannot be created there at all.
 * @param {string} title
 * @returns {string} a stem, or `''` when nothing legal remains
 */
export function pageFileName(title) {
  const stem = String(title ?? '').replace(/[/\\:*?"<>|]/gu, '_').trim();
  return stem === '' ? '' : guardReserved(stem, '-page');
}

/**
 * Turn a module path into the directory name Qoder's `$Mr` produces.
 *
 * `/` becomes `_`; ` \ : * ? " < > |` are *deleted* (not replaced); the result
 * is truncated to 80 code points, trimmed, and falls back to `_unnamed`.
 * @param {string} name
 * @returns {string}
 */
export function moduleFileName(name) {
  const stem = [...String(name ?? '').replace(/\//gu, '_').replace(/[\\:*?"<>|]/gu, '')]
    .slice(0, 80)
    .join('')
    .trim();
  return stem === '' ? '_unnamed' : guardReserved(stem, '-module');
}

/**
 * The name Qoder writes a card's Markdown under, per locale (`wMr`/`jbt`).
 *
 * Chinese locales map the fixed card types onto Chinese file names; every other
 * locale keeps the English card type verbatim.
 * @param {string} cardType e.g. `architecture_design`
 * @param {string} language
 * @returns {string}
 */
export function cardFileName(cardType, language) {
  const type = String(cardType ?? '');
  if (!String(language ?? '').toLowerCase().startsWith('zh')) return type;
  return CARD_TYPE_ZH[type] ?? type;
}

/** Qoder's `jbt` card-type → Chinese file name table. */
export const CARD_TYPE_ZH = Object.freeze({
  overview: '概述',
  architecture_design: '架构设计',
  tech_stack: '技术栈',
  coding_conventions: '编码规范',
  unique_setup_and_commands: '特殊配置与命令',
});

/**
 * Backwards-compatible alias: pages should use {@link pageFileName} and
 * knowledge modules {@link moduleFileName} — those are the rules Qoder
 * actually applies. This keeps the old "never empty" contract for callers that
 * need a guaranteed stem.
 * @param {string} title
 * @returns {string}
 */
export function safeFileName(title) {
  const stem = pageFileName(title);
  return stem === '' ? '_unnamed' : stem;
}

/**
 * The repo-relative path of one page, derived from its ancestor chain.
 *
 * This reproduces Qoder's own layout rule, verified against a real 71-page
 * export (71/71 paths match):
 *
 *   - a node with children becomes a **directory** named after it, and its own
 *     page lives inside that directory (`架构设计/架构设计.md`);
 *   - a leaf node becomes a **file** inside its nearest category ancestor's
 *     directory (`架构设计/模块化设计.md`);
 *   - top-level leaves live directly under `content/` (`快速开始.md`).
 *
 * @param {object} catalog the node itself
 * @param {Map<string, object>} byId id → node, used to walk up `parent_id`
 * @returns {string} the page's path relative to `<language>/content/`
 */
export function pagePath(catalog, byId) {
  const ownTitle = pageFileName(catalog?.name ?? catalog?.title ?? '');
  // Qoder skips a page whose title sanitizes to nothing.
  if (ownTitle === '') return '';
  // Walk up collecting only *category* ancestors: a leaf's home is the
  // directory of its nearest category ancestor, and a category's own page
  // lives in its own directory. Non-category ancestors contribute nothing to
  // the path because their pages are siblings, not parents, in the file tree.
  const ancestors = [];
  const seen = new Set();
  let parentId = catalog?.parent_id === undefined || catalog?.parent_id === null ? '' : String(catalog.parent_id);
  let guard = 0;
  while (parentId !== '' && guard < 64) {
    if (seen.has(parentId)) break;
    seen.add(parentId);
    const parent = byId?.get(parentId);
    if (parent === undefined) break;
    if (Array.isArray(parent.children) && parent.children.length > 0) {
      const segment = pageFileName(parent.name ?? parent.title ?? '');
      if (segment !== '') ancestors.unshift(segment);
    }
    parentId = parent.parent_id === undefined || parent.parent_id === null ? '' : String(parent.parent_id);
    guard += 1;
  }
  const isCategory = Array.isArray(catalog?.children) && catalog.children.length > 0;
  const segments = [...ancestors];
  if (isCategory) segments.push(ownTitle);
  segments.push(`${ownTitle}.md`);
  return segments.join('/');
}

/* ------------------------------------------------------------------------- *
 * Atomic writes + per-root serialization
 * ------------------------------------------------------------------------- */

const locks = new Map();

/**
 * Serialize work on one logical key.
 *
 * Two concurrent `writeMetadata` calls on the same wiki would otherwise race on
 * the rename and lose one table.
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
export function withLock(key, task) {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const guard = run.catch(() => {});
  locks.set(key, guard);
  void guard.then(() => {
    if (locks.get(key) === guard) locks.delete(key);
  });
  return run;
}

async function ensureDir(directory) {
  await fsp.mkdir(directory, { recursive: true });
}

/** Write `content` atomically: temp file in the same directory, then rename. */
async function writeAtomic(filePath, content) {
  const directory = path.dirname(filePath);
  await ensureDir(directory);
  const temp = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    await fsp.writeFile(temp, content, 'utf8');
    await fsp.rename(temp, filePath);
  } catch (error) {
    await fsp.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

/** Remove a file if present. */
async function removeFile(filePath) {
  try {
    await fsp.rm(filePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Remove a directory tree if present. */
async function removeTree(directory) {
  await fsp.rm(directory, { recursive: true, force: true });
}

/** Whether a path exists. */
export async function exists(target) {
  try {
    await fsp.stat(target);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------- *
 * Metadata
 * ------------------------------------------------------------------------- */

/** Whether a value is one of Qoder's opaque encrypted fields. */
export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

/** Drop encrypted and unknown top-level keys, normalizing the four tables. */
function normalizeMetadata(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  const repo = source.wiki_repo !== null && typeof source.wiki_repo === 'object' ? source.wiki_repo : {};
  const wikiRepo = {};
  for (const [key, value] of Object.entries(repo)) {
    if (isEncrypted(value)) continue;
    wikiRepo[key] = value;
  }
  const catalogs = Array.isArray(source.wiki_catalogs) ? source.wiki_catalogs : [];
  const items = Array.isArray(source.wiki_items) ? source.wiki_items : [];
  const relations = Array.isArray(source.knowledge_relations) ? source.knowledge_relations : [];
  return {
    wiki_repo: wikiRepo,
    wiki_catalogs: catalogs.filter((entry) => entry !== null && typeof entry === 'object'),
    wiki_items: items.filter((entry) => entry !== null && typeof entry === 'object'),
    knowledge_relations: relations.filter((entry) => entry !== null && typeof entry === 'object'),
  };
}

/**
 * Read the metadata for one language.
 *
 * Returns an empty skeleton when the file is absent (a fresh workspace is not an
 * error). Throws `metadata-corrupt` when the file exists but does not parse, and
 * leaves it untouched — silently replacing it would destroy the only record of
 * a Qoder export.
 * @param {string} workspace
 * @param {object} settings
 * @param {string} [language]
 * @returns {Promise<object>}
 */
export async function readMetadata(workspace, settings, language) {
  const file = metadataPath(workspace, settings, language);
  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyMetadata();
    throw new WikiError(ERROR_CODES.metadataCorrupt, `cannot read ${file}: ${error.message}`, { file });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new WikiError(ERROR_CODES.metadataCorrupt, `${file} is not valid JSON: ${error.message}`, { file });
  }
  return normalizeMetadata(parsed);
}

/** An empty metadata document with every table present. */
export function emptyMetadata() {
  return {
    wiki_repo: {
      progress_status: '',
      wiki_present_status: STATUS.WIKI_INIT,
      generation_type: 'FULL',
      total_catalogs: 0,
      completed_catalogs: 0,
      failed_catalogs: 0,
      last_commit_id: '',
      recovery_checkpoint: '',
    },
    wiki_catalogs: [],
    wiki_items: [],
    knowledge_relations: [],
  };
}

/**
 * Write the metadata atomically, refreshing `gmt_modified`.
 * @param {string} workspace
 * @param {object} settings
 * @param {string} [language]
 * @param {object} metadata
 * @returns {Promise<object>} the written value
 */
export async function writeMetadata(workspace, settings, language, metadata) {
  const root = languageRoot(workspace, settings, language);
  return withLock(root, async () => {
    const normalized = normalizeMetadata(metadata);
    const now = new Date().toISOString();
    normalized.wiki_repo = { ...normalized.wiki_repo, gmt_modified: now };
    if (typeof normalized.wiki_repo.gmt_create !== 'string' || normalized.wiki_repo.gmt_create === '') {
      normalized.wiki_repo.gmt_create = now;
    }
    // Qoder's own counters, kept consistent with the tables so an exported tree
    // shows the right progress in Qoder's UI.
    normalized.wiki_repo.total_catalogs = normalized.wiki_catalogs.length;
    normalized.wiki_repo.completed_catalogs = normalized.wiki_catalogs.filter(
      (entry) => entry.progress_status === CATALOG_STATUS.completed,
    ).length;
    normalized.wiki_repo.failed_catalogs = normalized.wiki_catalogs.filter(
      (entry) => entry.progress_status === CATALOG_STATUS.failed,
    ).length;
    await writeAtomic(metadataPath(workspace, settings, language), `${JSON.stringify(normalized, null, 2)}\n`);
    return normalized;
  });
}

/* ------------------------------------------------------------------------- *
 * Catalog tree
 * ------------------------------------------------------------------------- */

/**
 * Rebuild the catalog tree from the two sources Qoder allows.
 *
 * Parent links live in `knowledge_relations` in a Qoder export and in
 * `parent_id` in ours; both are honoured, with the relations table winning
 * because it is what Qoder itself reads.
 * @param {object} metadata
 * @returns {{ byId: Map<string, object>, roots: object[], order: object[] }}
 */
export function buildTree(metadata) {
  const byId = new Map();
  const order = [];
  const itemsByCatalog = new Map();
  for (const item of metadata?.wiki_items ?? []) {
    const catalogId = String(item?.catalog_id ?? '');
    if (catalogId !== '') itemsByCatalog.set(catalogId, item);
  }
  for (const catalog of metadata?.wiki_catalogs ?? []) {
    const id = String(catalog.id ?? '');
    if (id === '') continue;
    const item = itemsByCatalog.get(id);
    const node = {
      ...catalog,
      id,
      name: String(catalog.name ?? item?.title ?? ''),
      // Our own extension: the page row id, so relations can be written the way
      // Qoder writes them (item → item) while the tree stays catalog-keyed.
      item_id: String(item?.id ?? ''),
      parent_id: catalog.parent_id === undefined || catalog.parent_id === null ? '' : String(catalog.parent_id),
      order: Number.isInteger(catalog.order) ? catalog.order : order.length,
      page_path: typeof catalog.page_path === 'string' ? catalog.page_path : '',
      children: [],
    };
    byId.set(id, node);
    order.push(node);
  }

  // Parent links live in `knowledge_relations` in a Qoder export. Those rows
  // reference **wiki_items** ids (verified: all 57 rows of a real export point at
  // item ids, 0 at catalog ids), so resolve through the item id when the raw
  // value is not already a catalog id.
  const byItemId = new Map();
  for (const node of order) if (node.item_id !== '') byItemId.set(node.item_id, node);
  for (const relation of metadata?.knowledge_relations ?? []) {
    if (relation?.relationship_type !== 'PARENT_CHILD') continue;
    const rawTarget = String(relation.target_id ?? '');
    const rawSource = String(relation.source_id ?? '');
    const child = byId.get(rawTarget) ?? byItemId.get(rawTarget);
    const parent = byId.get(rawSource) ?? byItemId.get(rawSource);
    if (child === undefined || parent === undefined || child === parent) continue;
    child.parent_id = parent.id;
  }

  const roots = [];
  for (const node of order) {
    if (node.parent_id === '') {
      roots.push(node);
      continue;
    }
    const parent = byId.get(node.parent_id);
    if (parent === undefined) {
      // A dangling parent would hide the page entirely; treat it as a root.
      node.parent_id = '';
      roots.push(node);
      continue;
    }
    parent.children.push(node);
  }
  const sortRecursive = (nodes) => {
    nodes.sort((a, b) => (a.order === b.order ? a.name.localeCompare(b.name) : a.order - b.order));
    for (const node of nodes) sortRecursive(node.children);
  };
  sortRecursive(roots);
  return { byId, roots, order };
}

/**
 * Persist a tree back into the metadata tables.
 *
 * `parent_id` is written on the catalog (our extension) *and* as a
 * `knowledge_relations` row (Qoder's), so either reader sees the same shape.
 * @param {object} metadata
 * @param {{ byId: Map<string, object>, roots: object[], order: object[] }} tree
 * @returns {object} the same metadata object, mutated
 */
export function applyTree(metadata, tree) {
  const now = new Date().toISOString();
  const repoId = metadata.wiki_repo?.id ?? '';
  const catalogs = [];
  const items = [];
  const relations = [];
  const previousItems = new Map();
  for (const item of metadata.wiki_items ?? []) {
    if (item?.catalog_id !== undefined) previousItems.set(String(item.catalog_id), item);
  }
  let relationId = 0;

  const visit = (nodes, depth) => {
    for (const node of nodes) {
      const previous = previousItems.get(node.id);
      const itemId = node.item_id === undefined || node.item_id === '' ? previous?.id ?? randomUuid() : node.item_id;
      node.item_id = itemId;
      const createdAt = node.gmt_create ?? previous?.gmt_create ?? now;
      const catalogRow = {
        id: node.id,
        repo_id: node.repo_id ?? repoId,
        name: node.name,
        description: node.description ?? '',
        prompt: node.prompt ?? '',
        progress_status: node.progress_status ?? CATALOG_STATUS.pending,
        dependent_files: Array.isArray(node.dependent_files)
          ? node.dependent_files.join(',')
          : (node.dependent_files ?? ''),
        order: node.order,
        // The path this page was last written to. A page that gains children
        // becomes a category and moves into its own directory; recording the
        // old path is what lets the next write migrate the file instead of
        // orphaning it.
        page_path: node.page_path ?? '',
        gmt_create: createdAt,
        gmt_modified: node.gmt_modified ?? now,
      };
      // Qoder's exporter writes `parent_id` and `layer_level` only on non-root
      // rows — roots carry neither key.
      if (node.parent_id !== '') {
        catalogRow.parent_id = node.parent_id;
        catalogRow.layer_level = depth;
      }
      catalogs.push(catalogRow);
      items.push({
        catalog_id: node.id,
        title: node.name,
        description: node.description ?? '',
        extend: previous?.extend ?? '{}',
        progress_status: node.progress_status ?? CATALOG_STATUS.pending,
        repo_id: node.repo_id ?? repoId,
        reference_count: Array.isArray(node.dependent_files) ? node.dependent_files.length : 0,
        id: itemId,
        gmt_create: previous?.gmt_create ?? createdAt,
        gmt_modified: node.gmt_modified ?? now,
      });
      if (node.parent_id !== '') {
        relationId += 1;
        // Qoder's own rows reference item ids on both ends.
        const parentItemId = tree.byId.get(node.parent_id)?.item_id ?? node.parent_id;
        relations.push({
          id: relationId,
          source_id: parentItemId,
          target_id: itemId,
          source_type: 'WIKI_ITEM',
          target_type: 'WIKI_ITEM',
          relationship_type: 'PARENT_CHILD',
          gmt_create: createdAt,
          gmt_modified: node.gmt_modified ?? now,
        });
      }
      if (Array.isArray(node.children) && node.children.length > 0) visit(node.children, depth + 1);
    }
  };
  visit(tree.roots, 0);

  metadata.wiki_catalogs = catalogs;
  metadata.wiki_items = items;
  metadata.knowledge_relations = relations;
  return metadata;
}

/** A UUID v4; the store and the pipeline both need one. */
export function randomUuid() {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    let out = '';
    for (let i = 0; i < 32; i += 1) out += Math.floor(Math.random() * 16).toString(16);
    return `${out.slice(0, 8)}-${out.slice(8, 12)}-4${out.slice(13, 16)}-a${out.slice(17, 20)}-${out.slice(20, 32)}`;
  }
}

/**
 * Flatten the tree into a depth-first list, optionally capped.
 * @param {object} tree
 * @returns {object[]}
 */
export function flattenTree(tree) {
  const out = [];
  const visit = (nodes) => {
    for (const node of nodes) {
      out.push(node);
      visit(node.children ?? []);
    }
  };
  visit(tree.roots ?? []);
  return out;
}

/* ------------------------------------------------------------------------- *
 * Pages
 * ------------------------------------------------------------------------- */

/** Strip the H1 line so a stored page's title and body stay separable. */
function splitTitle(markdown, fallbackTitle) {
  const text = typeof markdown === 'string' ? markdown : '';
  const match = /^#\s+(.+?)\s*$/mu.exec(text);
  if (match === null) return { title: fallbackTitle, body: text };
  const rest = text.slice(match.index + match[0].length).replace(/^\s*\n/u, '');
  return { title: match[1].trim(), body: rest };
}

/**
 * Read one page's Markdown.
 * @param {string} workspace
 * @param {object} settings
 * @param {string} language
 * @param {object} catalog
 * @param {Map<string, object>} byId
 * @returns {Promise<string|null>}
 */
export async function readPage(workspace, settings, language, catalog, byId) {
  const contentRoot = path.join(languageRoot(workspace, settings, language), LAYOUT.content);
  // The recorded path wins: it is where the bytes actually are, and the derived
  // path may not exist yet for a page whose catalog changed shape.
  const recorded = typeof catalog?.page_path === 'string' && catalog.page_path !== '' ? catalog.page_path : '';
  const candidates = [recorded, pagePath(catalog, byId)].filter((entry) => entry !== '');
  for (const candidate of candidates) {
    try {
      return await fsp.readFile(path.join(contentRoot, candidate), 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return null;
}

/**
 * Write one page's Markdown atomically.
 * @returns {Promise<string>} the repo-relative path written (relative to the language root)
 */
export async function writePage(workspace, settings, language, catalog, markdown, byId) {
  const relative = pagePath(catalog, byId);
  // A title that sanitizes to nothing gets no file, matching Qoder's exporter.
  if (relative === '') return '';
  const root = languageRoot(workspace, settings, language);
  await withLock(root, async () => {
    await writeAtomic(path.join(root, LAYOUT.content, relative), ensureTrailingNewline(markdown));
  });
  catalog.page_path = relative;
  return relative;
}

/** Delete one page's Markdown, pruning the directory when it empties out. */
export async function deletePage(workspace, settings, language, catalog, byId) {
  const root = languageRoot(workspace, settings, language);
  const relative = typeof catalog?.page_path === 'string' && catalog.page_path !== '' ? catalog.page_path : pagePath(catalog, byId);
  const file = path.join(root, LAYOUT.content, relative);
  await withLock(root, async () => {
    await removeFile(file);
    // Walk back up removing empty directories, stopping at `content/`.
    let directory = path.dirname(file);
    const stop = path.join(root, LAYOUT.content);
    while (directory.startsWith(stop) && directory !== stop) {
      try {
        const entries = await fsp.readdir(directory);
        if (entries.length > 0) break;
        await fsp.rmdir(directory);
      } catch {
        break;
      }
      directory = path.dirname(directory);
    }
  });
  return relative;
}

function ensureTrailingNewline(text) {
  const value = typeof text === 'string' ? text : '';
  return value.endsWith('\n') ? value : `${value}\n`;
}

/**
 * Move page files whose catalog changed shape.
 *
 * A leaf that gains a child becomes a category, and a category's own page lives
 * inside its directory — so the file has to move. Without this, writing a child
 * page silently orphans its parent's Markdown at the old path.
 *
 * @param {string} workspace
 * @param {object} settings
 * @param {string} language
 * @param {{ byId: Map<string, object>, order: object[] }} tree
 * @returns {Promise<string[]>} the paths that moved
 */
export async function reconcilePagePaths(workspace, settings, language, tree) {
  const root = languageRoot(workspace, settings, language);
  const contentRoot = path.join(root, LAYOUT.content);
  const moved = [];
  for (const node of tree.order ?? []) {
    const next = pagePath(node, tree.byId);
    const previous = typeof node.page_path === 'string' ? node.page_path : '';
    if (previous === '' || previous === next) {
      node.page_path = next;
      continue;
    }
    const from = path.join(contentRoot, previous);
    const to = path.join(contentRoot, next);
    const exists = await fsp.stat(from).then(() => true, () => false);
    if (exists) {
      await ensureDir(path.dirname(to));
      await fsp.rename(from, to);
      // Prune the directory the page just left, stopping at `content/`.
      let directory = path.dirname(from);
      while (directory.startsWith(contentRoot) && directory !== contentRoot) {
        try {
          const entries = await fsp.readdir(directory);
          if (entries.length > 0) break;
          await fsp.rmdir(directory);
        } catch {
          break;
        }
        directory = path.dirname(directory);
      }
      moved.push(next);
    }
    node.page_path = next;
  }
  return moved;
}

/**
 * Render a page: `# title`, optional `<cite>` block, `## 目录`, then the body.
 *
 * This is Qoder's own document shape (verified against a real export), so pages
 * this plugin writes and pages Qoder wrote look the same in a Markdown viewer.
 * @param {{ title: string, refs?: string[], body?: string, maxCitations?: number }} input
 * @returns {string}
 */
export function renderPage(input) {
  const title = String(input?.title ?? '').trim() || 'untitled';
  const refs = Array.isArray(input?.refs) ? input.refs.filter((ref) => typeof ref === 'string' && ref !== '') : [];
  const max = Number.isInteger(input?.maxCitations) && input.maxCitations > 0 ? input.maxCitations : 40;
  const body = String(input?.body ?? '').trim();

  const parts = [`# ${title}`, ''];
  if (refs.length > 0) {
    const shown = refs.slice(0, max);
    const omitted = refs.length - shown.length;
    parts.push('<cite>', '**本文档引用的文件**');
    for (const ref of shown) {
      const normalized = ref.replaceAll('\\', '/').replace(/^\.\//u, '');
      const label = normalized.slice(normalized.lastIndexOf('/') + 1) || normalized;
      parts.push(`- [${label}](file://${normalized})`);
    }
    if (omitted > 0) parts.push(`- … 另有 ${omitted} 个文件未列出`);
    parts.push('</cite>', '');
  }

  const headings = extractHeadings(body);
  if (headings.length > 0) {
    parts.push('## 目录');
    headings.forEach((heading, index) => parts.push(`${index + 1}. [${heading}](#${anchorOf(heading)})`));
    parts.push('');
  }

  if (body !== '') parts.push(body, '');
  return parts.join('\n');
}

/** Top-level `##` headings in a body, excluding the generated `## 目录`. */
export function extractHeadings(body) {
  const out = [];
  const regex = /^##\s+(.+?)\s*$/gmu;
  let match;
  while ((match = regex.exec(String(body ?? ''))) !== null) {
    const text = match[1].trim();
    if (text === '' || text === '目录') continue;
    out.push(text);
  }
  return out;
}

/** GitHub-style anchor for a heading. */
export function anchorOf(heading) {
  return String(heading ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/gu, '-');
}

/** Strip the generated `<cite>` and `## 目录` prologue, returning the body. */
export function pageBody(markdown) {
  let text = String(markdown ?? '');
  text = text.replace(/^#\s+.+?\s*\n/u, '');
  text = text.replace(/^\s*<cite>[\s\S]*?<\/cite>\s*\n/u, '');
  text = text.replace(/^\s*##\s+目录\s*\n(?:\s*\d+\.\s*\[[^\]]*\]\([^)]*\)\s*\n)*/u, '');
  return text.trim();
}

/* ------------------------------------------------------------------------- *
 * Knowledge cards
 * ------------------------------------------------------------------------- */

/**
 * Write the knowledge-card tree for one language.
 *
 * `cards` is a list of `{ module, title, summary, files, dependsOn, relatedTo }`
 * plus optional per-category documents (`overview`, `architecture`, `conventions`).
 * @param {string} workspace
 * @param {object} settings
 * @param {string} language
 * @param {object[]} cards
 * @returns {Promise<number>} files written
 */
export async function writeKnowledge(workspace, settings, language, cards, info = {}) {
  const root = knowledgeRoot(workspace, settings, language);
  const list = Array.isArray(cards) ? cards : [];
  let written = 0;
  await withLock(root, async () => {
    await removeTree(root);
    // Qoder writes a root index before the module directories; keep the same
    // file so its own import path recognises the export.
    await writeAtomic(path.join(root, LAYOUT.indexFile), renderKnowledgeIndex(list, info, language));
    written += 1;
    for (const card of list) {
      const module = moduleFileName(card?.module ?? card?.title ?? 'module');
      const directory = path.join(root, module);
      const yaml = renderModuleYaml(card, module);
      await writeAtomic(path.join(directory, LAYOUT.moduleFile), yaml);
      written += 1;
      const documents = { ...(card?.documents ?? {}) };
      // A bare summary is the `overview` card.
      if (typeof card?.summary === 'string' && card.summary.trim() !== '' && documents.overview === undefined) {
        documents.overview = card.summary;
      }
      for (const [kind, content] of Object.entries(documents)) {
        if (typeof content !== 'string' || content.trim() === '') continue;
        const fileName = cardFileName(kind, language);
        if (fileName === '') continue;
        await writeAtomic(path.join(directory, `${fileName}.md`), ensureTrailingNewline(content));
        written += 1;
      }
    }
  });
  return written;
}

/**
 * A card's stable id.
 *
 * Qoder's language service assigns ids; on disk we derive them so a page at
 * `<module>/<type>` always answers to the same id across regenerations and
 * the `card://knowledge/open/<id>` links in the reader resolve.
 * @param {string} moduleDir the module's directory name
 * @param {string} category one of CARD_CATEGORIES
 * @returns {string}
 */
export function cardIdFor(moduleDir, category) {
  return `${moduleDir}/${category}`;
}

/** Chinese filename → category reverse lookup. */
const CARD_TYPE_FROM_ZH = Object.freeze(Object.fromEntries(
  Object.entries(CARD_TYPE_ZH).map(([type, zh]) => [zh, type]),
));

/**
 * Read every knowledge card under one language.
 *
 * Returns one row per card file in Qoder's `listCards` hit shape, plus the
 * module-level relation rows needed to render `linked_cards`. A module with a
 * bare `概述.md` still produces an `overview` card.
 * @returns {Promise<object[]>}
 */
export async function readKnowledge(workspace, settings, language) {
  const root = knowledgeRoot(workspace, settings, language);
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const cards = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const moduleDir = entry.name;
    const directory = path.join(root, moduleDir);
    const yaml = await readTextFileSafe(path.join(directory, LAYOUT.moduleFile));
    const moduleMeta = parseModuleYaml(yaml ?? '', moduleDir);
    let files = [];
    try {
      files = await fsp.readdir(directory);
    } catch {
      files = [];
    }
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const content = await readTextFileSafe(path.join(directory, file));
      if (content === null || content.trim() === '') continue;
      const stem = file.replace(/\.md$/u, '');
      const category = CARD_TYPE_FROM_ZH[stem] ?? stem;
      cards.push({
        id: cardIdFor(moduleDir, category),
        title: stem,
        category,
        content,
        module: moduleDir,
        module_path: moduleMeta.module_path,
        scope: moduleMeta.scope,
        related_to: moduleMeta.related_to,
        excerpt: content.trim().split(/\n+/u).find((line) => line.trim() !== '' && !line.startsWith('#'))?.trim().slice(0, 160) ?? '',
      });
    }
  }
  return cards;
}

/** Minimal `_module.yaml` reader — we wrote it, so a flat scan is enough. */
function parseModuleYaml(yaml, fallbackModule) {
  const meta = { module_path: fallbackModule, scope: [], related_to: [] };
  const lines = String(yaml ?? '').split('\n');
  let list = '';
  for (const line of lines) {
    const kv = /^([a-z_]+):\s*(.*)$/u.exec(line);
    if (kv !== null) {
      list = '';
      if (kv[1] === 'module_path') meta.module_path = kv[2].trim() || fallbackModule;
      else if (kv[1] === 'scope' || kv[1] === 'related_to') list = kv[1];
      continue;
    }
    const item = /^\s+-\s+path:\s*(.*)$/u.exec(line) ?? /^\s+-\s+(.*)$/u.exec(line);
    if (item !== null && list !== '') {
      const value = item[1].trim();
      if (value !== '' && value !== '[]') meta[list].push(value);
    }
  }
  return meta;
}

async function readTextFileSafe(file) {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Render the knowledge-card root index.
 *
 * Qoder's export opens with the literal header `# 知识卡导出索引文件`, then a
 * YAML document whose readable part is `schema_version`/`locale`/`commit`/
 * `nodes_managed` (`lMr`); `modules` mirrors what its exporter writes even
 * though its importer rebuilds the module list from the `_module.yaml` files.
 * @param {object[]} cards
 * @param {{ commit?: string, branch?: string }} [info]
 * @param {string} [language]
 * @returns {string}
 */
export function renderKnowledgeIndex(cards, info = {}, language = 'zh') {
  const list = Array.isArray(cards) ? cards : [];
  const lines = [
    '# 知识卡导出索引文件',
    'schema_version: 1',
    `locale: ${yamlScalar(qoderLocale(language))}`,
    `commit: ${yamlScalar(info.commit ?? '')}`,
    `branch: ${yamlScalar(info.branch ?? '')}`,
    `exported_at: ${JSON.stringify(new Date().toISOString())}`,
    'nodes_managed: false',
  ];
  if (list.length === 0) {
    lines.push('modules: {}');
    return `${lines.join('\n')}\n`;
  }
  lines.push('modules:');
  for (const card of list) {
    const modulePath = String(card?.modulePath ?? card?.module ?? card?.title ?? 'module');
    lines.push(`  ${yamlScalar(modulePath)}:`);
    lines.push(`    dir_name: ${yamlScalar(moduleFileName(card?.module ?? modulePath))}`);
    lines.push(`    title: ${yamlScalar(card?.title ?? modulePath)}`);
    const files = Array.isArray(card?.files) ? card.files : [];
    lines.push(files.length === 0 ? '    scope: []' : `    scope:\n${files.map((f) => `      - ${yamlScalar(f)}`).join('\n')}`);
    lines.push('    source_files: []');
    lines.push('    children: []');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Render `_module.yaml`, matching Qoder's `uMr` schema: `module_path`, `title`,
 * `scope`, and the relation lists as `{path, reason?}` objects.
 */
export function renderModuleYaml(card, module) {
  const files = Array.isArray(card?.files) ? card.files : [];
  const relation = (list) => {
    const entries = (Array.isArray(list) ? list : [])
      .map((entry) => (typeof entry === 'string' ? { path: entry } : entry))
      .filter((entry) => entry !== null && typeof entry === 'object' && String(entry.path ?? '') !== '');
    if (entries.length === 0) return '[]';
    return `\n${entries
      .map((entry) => {
        const reason = String(entry.reason ?? '');
        return reason === '' ? `    - path: ${yamlScalar(entry.path)}` : `    - path: ${yamlScalar(entry.path)}\n      reason: ${yamlScalar(reason)}`;
      })
      .join('\n')}`;
  };
  const lines = [
    `module_path: ${yamlScalar(card?.modulePath ?? module)}`,
    `title: ${yamlScalar(card?.title ?? module)}`,
  ];
  lines.push(files.length === 0 ? 'scope: []' : `scope:\n${files.map((f) => `    - ${yamlScalar(f)}`).join('\n')}`);
  lines.push(`depends_on: ${relation(card?.dependsOn)}`);
  lines.push(`related_to: ${relation(card?.relatedTo)}`);
  lines.push('version_of: []');
  lines.push('similar_to: []');
  return `${lines.join('\n')}\n`;
}

function yamlScalar(value) {
  const text = String(value ?? '');
  if (text === '') return '""';
  if (/^[\s#\-?:,[\]{}&*!|>'"%@`]/u.test(text) || /: /u.test(text) || /\s$/u.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

/* ------------------------------------------------------------------------- *
 * Index lifecycle
 * ------------------------------------------------------------------------- */

/**
 * Remove one language's whole product: `content/`, `meta/`, and `knowledge/`.
 * @returns {Promise<boolean>} whether anything existed
 */
export async function deleteIndex(workspace, settings, language) {
  const root = languageRoot(workspace, settings, language);
  const existed = await exists(root);
  await withLock(root, async () => {
    await removeTree(root);
  });
  const cards = knowledgeRoot(workspace, settings, language);
  await withLock(cards, async () => {
    await removeTree(cards);
  });
  return existed;
}

/** Whether a language has any generated content. */
export async function hasContent(workspace, settings, language) {
  return exists(path.join(languageRoot(workspace, settings, language), LAYOUT.content));
}

/** The names of the four metadata tables, for tests and diagnostics. */
export { METADATA_TABLES };
