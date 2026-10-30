/**
 * dsh-repo-wiki — the generation pipeline.
 *
 * Qoder runs this on Alibaba Cloud: a planning call produces the catalog tree,
 * then one call per page writes the Markdown. This module is the same two-stage
 * pipeline, executed in the host against the user's own configured model, with
 * the same status machine, the same progress accounting, and the same
 * pause/resume/cancel semantics.
 *
 * Three design choices are worth stating up front:
 *
 * 1. **Every model call is bounded and cancellable.** A repository-wide
 *    generation is dozens of sequential requests; without an abort signal a
 *    user who closes the panel would leave them running.
 * 2. **Progress is persisted, not held in memory.** The status lives in
 *    `repowiki-metadata.json`, so a host restart mid-run is recoverable: the
 *    next `status()` sees an in-flight status and reports `PAUSED`.
 * 3. **One page failing does not fail the run.** The document stage records the
 *    failure on that catalog and continues, ending in `PARTLY_COMPLETED`. Losing
 *    a whole generation to one bad response is worse than a page with a gap.
 *
 * @module dsh-repo-wiki/pipeline
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  CARD_CATEGORIES,
  CATALOG_STATUS,
  ERROR_CODES,
  GENERATION_TYPE,
  LAYOUT,
  NON_GIT_BRANCH,
  STATUS,
  qoderLocale,
} from './constants.js';
import { PlanError, hasDocumentWhitelist, parsePlan, renderPlanPrompt } from './plan.js';
import {
  applyScope,
  changedFiles,
  currentBranch,
  headCommit,
  isAncestor,
  isGitRepo,
  listRepoFiles,
  readTextFile,
  renderTreeDigest,
  wikiExists,
} from './scan.js';
import {
  WikiError,
  applyTree,
  buildTree,
  deleteIndex,
  emptyMetadata,
  languageRoot,
  metadataPath,
  moduleFileName,
  pageBody,
  planPath,
  readMetadata,
  readPage,
  renderPage,
  writeKnowledge,
  writeMetadata,
  writePage,
} from './store.js';
import { deriveStatus, isIncremental, progressPercent } from './status.js';

/** How many model calls one page may take before it is marked failed. */
const PAGE_ATTEMPTS = 2;
/** How many model calls the planning stage may take. */
const PLAN_ATTEMPTS = 2;
/** Files whose contents are pasted into the planning prompt, at most. */
const PLAN_SAMPLE_FILES = 24;
/** Bytes of each sampled file pasted into the planning prompt. */
const PLAN_SAMPLE_BYTES = 6000;
/** Bytes of each dependent file pasted into a writing prompt. */
const PAGE_SAMPLE_BYTES = 8000;
/** Maximum dependent files pasted into one writing prompt. */
const PAGE_SAMPLE_FILES = 12;
/** Default per-call token budget. */
const DEFAULT_MAX_TOKENS = 8192;

/** Raised when the pipeline is asked to run while it already is. */
export class PipelineBusyError extends WikiError {
  constructor(status) {
    super(ERROR_CODES.busy, 'a generation is already running', { status });
    this.name = 'PipelineBusyError';
  }
}

/** Persist only a safe, actionable category, never raw provider errors. */
export function failureHint(error) {
  const code = String(error?.details?.code ?? error?.code ?? '');
  if (/quota|balance|payment|insufficient/iu.test(code)) return '模型配额或余额不足，请充值或更换提供商后重试。';
  if (/auth|unauthori[sz]ed|credential/iu.test(code)) return '模型认证失败，请检查提供商的登录状态或凭据。';
  const message = String(error?.message ?? error ?? '');
  if (/no parsable JSON|listed no catalogs/iu.test(message)) return '模型没有返回可用的目录，请重试或更换模型。';
  if (/returned no text/iu.test(message)) return '模型没有返回内容，请检查模型配置后重试。';
  if (/unauthori[sz]ed|authentication|invalid.?api.?key|\b401\b|\b403\b/iu.test(message)) return '模型认证失败，请检查提供商的登录状态或凭据。';
  if (/rate.?limit|throttl|\b429\b/iu.test(message)) return '模型请求受到限流，请稍后重试。';
  if (/quota|insufficient.?balance|insufficient.?quota|payment/iu.test(message)) return '模型配额或余额不足，请充值或更换提供商后重试。';
  if (/network|fetch|timeout|timed out|connection/iu.test(message)) return '连接模型失败，请检查网络和提供商设置。';
  return '模型请求或目录解析失败，请检查模型设置后重试。';
}

/* ------------------------------------------------------------------------- *
 * Prompts
 * ------------------------------------------------------------------------- */

const PLANNING_SYSTEM = `You are a senior software architect building a repository wiki.

Your job is to plan the wiki's table of contents. You will be shown the repository's file tree and a sample of key files. Design a catalog of Markdown pages that a new engineer would need in order to understand this repository: its purpose, architecture, modules, data flow, and operational concerns.

Rules:
- Output a single JSON object and nothing else. No prose, no Markdown fences.
- The object is {"catalogs": [ ... ]}.
- Each catalog is {"title": string, "description": string, "parent": string, "files": string[], "prompt": string}.
  - "title": the page title, in the requested language.
  - "description": one short sentence describing what the page covers.
  - "parent": the title of the parent page, or "" for a top-level page.
  - "files": repository-relative paths this page will document. Use paths you actually saw.
  - "prompt": one or two sentences telling the writer what this page must cover.
- Produce between 8 and 40 pages. Prefer breadth over depth: at most 3 levels.
- Top-level pages should number between 3 and 8.
- Never invent file paths. If you are unsure, leave "files" empty.
- Page titles must be unique.`;

const WRITING_SYSTEM = `You are a senior software engineer writing one page of a repository wiki.

Write the page body in Markdown, in the requested language. Follow these rules:
- Do NOT emit an H1 title; the title is added for you. Start with the first "##" section.
- Do NOT emit a citation block; it is added for you.
- Ground every claim in the source files you are given. Do not invent behaviour.
- Keep code identifiers, file paths, command names and API names in their original form even when writing in Chinese.
- Use "##" for top-level sections and "###" below. Keep sections short.
- When describing structure or flow, emit a \`\`\`mermaid code block rather than prose. Use "graph TB" or "sequenceDiagram".
- If the given sources do not answer something, say so plainly instead of guessing.`;

/**
 * Accumulate the visible text of one model stream.
 *
 * This replaces the host's `BlockAssembler`, and the reason is a deployment
 * fact rather than a preference: a plugin installed into a profile cannot import
 * `@deepseek-ai/dsh-llm` with a bare specifier. The loader imports plugins
 * through the host's own resolver, but an `import()` executed *inside* the plugin
 * uses Node's standard resolution, which starts at the profile's
 * `node_modules` — and the profile does not carry the host's own packages. The
 * import therefore threw `ERR_MODULE_NOT_FOUND` and every generation failed with
 * `llm-unavailable`, even though the `llm` service was right there on `ctx`.
 *
 * The chunk protocol the stream emits is small and stable: `text-delta` carries
 * text, `block-end` may carry a complete text block, and `finish` ends the
 * stream. Everything else (tool calls, reasoning, usage) is irrelevant to prose
 * generation and is ignored.
 */
class TextAccumulator {
  constructor() {
    this.parts = [];
    this.finish = { kind: 'stop' };
  }

  /** Feed one raw chunk. */
  push(chunk) {
    if (chunk === null || typeof chunk !== 'object') return;
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      this.parts.push(chunk.text);
      return;
    }
    if (chunk.type === 'block-end' && chunk.block?.type === 'text' && typeof chunk.block.text === 'string') {
      // A provider that sends whole blocks instead of deltas: keep the block,
      // but never double-count a block whose deltas already arrived.
      if (this.parts.length === 0) this.parts.push(chunk.block.text);
      return;
    }
    if (chunk.type === 'finish' && chunk.reason !== undefined) {
      this.finish = chunk.reason;
    }
  }

  /** The accumulated text, trimmed. */
  text() {
    return this.parts.join('').trim();
  }
}

/**
 * Build a user message without importing the host's message helpers.
 *
 * The host's `createUserMessage` clones its input, stamps a fresh UUID and deep
 * freezes it; nothing else is required by the adapters.
 * @param {string} text
 * @returns {object}
 */
export function createUserMessage(text) {
  return {
    id: randomId(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'repo-wiki' },
  };
}

/**
 * Call the host model once and return its text.
 *
 * `ctx.llm` is looked up softly so a host without a model service still serves
 * the panel and the tools; only generation reports `llm-unavailable`.
 * @param {object} ctx cordis context
 * @param {object} settings
 * @param {{ system: string, user: string, signal?: AbortSignal, maxTokens?: number, purpose?: string }} request
 * @returns {Promise<string>}
 */
export async function callModel(ctx, settings, request) {
  const llm = typeof ctx?.get === 'function' ? ctx.get('llm', false) : undefined;
  if (llm === undefined || llm === null || typeof llm.prepareCall !== 'function') {
    throw new WikiError(
      ERROR_CODES.llmUnavailable,
      'the host exposes no llm service; mount a provider adapter to enable generation',
    );
  }

  const route = await resolveRoute(ctx, settings);
  const maxTokens = Number.isInteger(request.maxTokens) && request.maxTokens > 0 ? request.maxTokens : DEFAULT_MAX_TOKENS;
  const signal = request.signal;
  signal?.throwIfAborted();

  const call = await llm.prepareCall({ ...route, maxTokens }, signal);
  const options = {
    ...call.config,
    messages: [createUserMessage(request.user)],
    system: request.system,
    signal,
  };

  const accumulator = new TextAccumulator();
  for await (const chunk of call.stream(options)) {
    signal?.throwIfAborted();
    accumulator.push(chunk);
  }
  signal?.throwIfAborted();

  const finish = accumulator.finish;
  if (finish?.kind === 'error' || finish?.kind === 'aborted') {
    const failure = finish.failure ?? {};
    throw new WikiError(ERROR_CODES.internal, `model call failed: ${failure.message ?? finish.kind}`, {
      kind: finish.kind,
      code: failure.code ?? '',
    });
  }

  const text = accumulator.text();
  if (text === '') {
    throw new WikiError(ERROR_CODES.internal, 'the model returned no text', { purpose: request.purpose ?? 'repo-wiki' });
  }
  return text;
}

/**
 * Resolve which provider/model to call.
 *
 * An explicit setting wins; otherwise the deployment default model is used, so
 * a user who configured DSH once does not have to configure this plugin too.
 */
export async function resolveRoute(ctx, settings) {
  const provider = typeof settings?.provider === 'string' ? settings.provider.trim() : '';
  const model = typeof settings?.model === 'string' ? settings.model.trim() : '';
  if (provider !== '' && model !== '') {
    // Fail with the list of what *would* work, rather than letting the adapter
    // throw an opaque "unknown provider" halfway through a generation.
    const llm = typeof ctx?.get === 'function' ? ctx.get('llm', false) : undefined;
    if (llm !== undefined && llm !== null && typeof llm.listProviders === 'function') {
      let known = [];
      try {
        known = (llm.listProviders() ?? []).map((entry) => entry?.id ?? entry?.provider).filter(Boolean);
      } catch {
        known = [];
      }
      if (known.length > 0 && !known.includes(provider)) {
        throw new WikiError(
          ERROR_CODES.llmUnavailable,
          `provider "${provider}" is not configured in this DSH deployment; configured providers: ${known.join(', ')}`,
          { provider, configured: known },
        );
      }
    }
    return { provider, model };
  }
  if (provider !== '' || model !== '') {
    // Half a route is a configuration mistake worth naming, not a silent fallback:
    // silently ignoring `model` would generate with a different model than the
    // one the user picked.
    throw new WikiError(
      ERROR_CODES.llmUnavailable,
      provider === ''
        ? 'a model is set without a provider; set both, or clear both to use the deployment default'
        : 'a provider is set without a model; set both, or clear both to use the deployment default',
      { provider, model },
    );
  }

  const defaults = typeof ctx?.get === 'function' ? ctx.get('agentDefaultModel', false) : undefined;
  if (defaults !== undefined && defaults !== null) {
    try {
      const selection =
        typeof defaults.currentSelection === 'function'
          ? defaults.currentSelection()
          : typeof defaults.get === 'function'
            ? defaults.get()
            : undefined;
      if (selection !== undefined && selection !== null && selection.provider && selection.model) {
        return { provider: selection.provider, model: selection.model };
      }
    } catch {
      // fall through to the catalog probe
    }
  }

  // Last resort: the first model the LLM service advertises.
  const llm = typeof ctx?.get === 'function' ? ctx.get('llm', false) : undefined;
  if (llm !== undefined && llm !== null && typeof llm.listProviders === 'function') {
    try {
      for (const entry of llm.listProviders() ?? []) {
        const models = typeof entry?.listModels === 'function' ? await entry.listModels() : entry?.models;
        const first = Array.isArray(models) ? models[0] : undefined;
        const modelId = typeof first === 'string' ? first : first?.id;
        if (typeof entry?.provider === 'string' && typeof modelId === 'string' && modelId !== '') {
          return { provider: entry.provider, model: modelId };
        }
      }
    } catch {
      // fall through to the actionable error
    }
  }

  throw new WikiError(
    ERROR_CODES.llmUnavailable,
    'no model route is configured: set provider and model in the plugin settings, or configure a default model in DSH',
  );
}

/* ------------------------------------------------------------------------- *
 * Model output parsing
 * ------------------------------------------------------------------------- */

/**
 * Extract the JSON object from a model response.
 *
 * Models wrap JSON in fences or prose often enough that requiring exact output
 * would fail a large share of otherwise good runs. This finds the first
 * balanced `{…}` block, ignoring braces inside strings.
 * @param {string} text
 * @returns {unknown}
 */
export function extractJson(text) {
  const source = String(text ?? '');
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/u.exec(source);
  const candidates = fenced === null ? [source] : [fenced[1], source];
  for (const candidate of candidates) {
    const start = candidate.indexOf('{');
    if (start < 0) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < candidate.length; i += 1) {
      const ch = candidate[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const slice = candidate.slice(start, i + 1);
          try {
            return JSON.parse(slice);
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new WikiError(ERROR_CODES.internal, 'the model response contained no parsable JSON object');
}

/**
 * Turn a parsed planning response into a normalized catalog tree.
 *
 * Depth is clamped to `maxDepth` by re-parenting deeper nodes onto their
 * grandparent, which keeps their titles and order intact — a page must not
 * disappear just because the model nested it one level too deep.
 * @param {unknown} parsed
 * @param {{ maxDepth?: number }} [options]
 * @returns {{ roots: object[], byId: Map<string, object>, order: object[] }}
 */
export function normalizeCatalogs(parsed, options = {}) {
  const maxDepth = Number.isInteger(options.maxDepth) && options.maxDepth > 0 ? options.maxDepth : 4;
  const raw = Array.isArray(parsed?.catalogs)
    ? parsed.catalogs
    : Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.items)
        ? parsed.items
        : [];
  if (raw.length === 0) {
    throw new WikiError(ERROR_CODES.internal, 'the planning response listed no catalogs');
  }

  const byTitle = new Map();
  const nodes = [];
  let counter = 0;
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const title = String(entry.title ?? entry.name ?? '').trim();
    if (title === '' || byTitle.has(title)) continue;
    counter += 1;
    const node = {
      id: `catalog-${counter}`,
      name: title,
      description: String(entry.description ?? '').trim(),
      prompt: String(entry.prompt ?? entry.goal ?? '').trim(),
      dependent_files: normalizeFiles(entry.files ?? entry.dependent_files),
      parentTitle: String(entry.parent ?? '').trim(),
      order: nodes.length,
      progress_status: CATALOG_STATUS.pending,
      children: [],
      parent_id: '',
    };
    byTitle.set(title, node);
    nodes.push(node);
  }
  if (nodes.length === 0) {
    throw new WikiError(ERROR_CODES.internal, 'the planning response listed no usable catalogs');
  }

  // Resolve parents by title; an unknown parent becomes a root rather than an
  // orphan.
  for (const node of nodes) {
    const parent = node.parentTitle === '' ? undefined : byTitle.get(node.parentTitle);
    if (parent === undefined || parent === node) {
      node.parentTitle = '';
      node.parent_id = '';
    } else {
      node.parent_id = parent.id;
    }
  }
  // Break cycles introduced by the model.
  for (const node of nodes) {
    const seen = new Set([node.id]);
    let cursor = node.parent_id === '' ? undefined : nodes.find((entry) => entry.id === node.parent_id);
    while (cursor !== undefined) {
      if (seen.has(cursor.id)) {
        node.parent_id = '';
        break;
      }
      seen.add(cursor.id);
      cursor = cursor.parent_id === '' ? undefined : nodes.find((entry) => entry.id === cursor.parent_id);
    }
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const attach = () => {
    for (const node of nodes) node.children = [];
    const roots = [];
    for (const node of nodes) {
      const parent = node.parent_id === '' ? undefined : byId.get(node.parent_id);
      if (parent === undefined) roots.push(node);
      else parent.children.push(node);
    }
    return roots;
  };
  let roots = attach();

  // Clamp depth.
  const depthOf = (node) => {
    let depth = 0;
    let cursor = node.parent_id === '' ? undefined : byId.get(node.parent_id);
    while (cursor !== undefined && depth < 64) {
      depth += 1;
      cursor = cursor.parent_id === '' ? undefined : byId.get(cursor.parent_id);
    }
    return depth;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.parent_id !== '' && depthOf(node) >= maxDepth) {
        const parent = byId.get(node.parent_id);
        node.parent_id = parent === undefined ? '' : parent.parent_id;
        changed = true;
      }
    }
  }
  roots = attach();

  // Assign order within each sibling group.
  const order = [];
  const walk = (siblings) => {
    siblings.forEach((node, index) => {
      node.order = index;
      order.push(node);
      walk(node.children);
    });
  };
  walk(roots);
  return { roots, byId, order };
}

function normalizeFiles(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const out = [];
  for (const entry of list) {
    const text = String(entry ?? '').trim().replaceAll('\\', '/').replace(/^\.\//u, '');
    if (text === '' || text.startsWith('/') || text.includes('..')) continue;
    if (!out.includes(text)) out.push(text);
  }
  return out;
}

/**
 * Rebuild the catalog tree from a plan's `documents` whitelist.
 *
 * Qoder treats the list as a strict whitelist — "emit exactly these, preserving
 * titles and parent-child relationships, invent nothing". Doing it here rather
 * than trusting the model means a plan file is honoured deterministically, and
 * the model's own titles are only used for pages the plan does not name (which
 * there should not be).
 *
 * @param {object} plan a validated plan
 * @param {{ roots: object[], byId: Map<string, object>, order: object[] }} planned
 * @returns {{ roots: object[], byId: Map<string, object>, order: object[] }}
 */
export function applyDocumentWhitelist(plan, planned) {
  const documents = plan?.repowiki?.documents ?? [];
  if (documents.length === 0) return planned;

  // Reuse the planner's file attribution where a title matches; otherwise fall
  // back to nothing, which makes the writer sample related files by slug.
  const plannedByTitle = new Map((planned?.order ?? []).map((node) => [node.name, node]));
  const nodes = [];
  const byTitle = new Map();
  documents.forEach((document, index) => {
    const match = plannedByTitle.get(document.title);
    const node = {
      id: `catalog-${index + 1}`,
      name: document.title,
      description: match?.description ?? '',
      prompt: document.goal || match?.prompt || '',
      hints: document.hints ?? '',
      template: document.template ?? '',
      dependent_files: match?.dependent_files ?? [],
      parentTitle: document.parent ?? '',
      order: index,
      progress_status: CATALOG_STATUS.pending,
      children: [],
      parent_id: '',
    };
    nodes.push(node);
    byTitle.set(node.name, node);
  });
  for (const node of nodes) {
    const parent = node.parentTitle === '' ? undefined : byTitle.get(node.parentTitle);
    node.parent_id = parent === undefined ? '' : parent.id;
    node.parentTitle = '';
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots = [];
  for (const node of nodes) {
    const parent = node.parent_id === '' ? undefined : byId.get(node.parent_id);
    if (parent === undefined) {
      node.parent_id = '';
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }
  const order = [];
  const walk = (siblings) => {
    siblings.forEach((node, i) => {
      node.order = i;
      order.push(node);
      walk(node.children);
    });
  };
  walk(roots);
  return { roots, byId, order };
}

/** Whether `affected` is derived from `changed` — the incrementality contract. */
export function affectedCatalogIds(tree, changed) {
  const set = new Set((changed ?? []).map((entry) => String(entry).replaceAll('\\', '/').replace(/^\.\//u, '')));
  if (set.size === 0) return [];
  const affected = [];
  const matches = (catalog) => {
    const files = normalizeFiles(
      typeof catalog.dependent_files === 'string' ? catalog.dependent_files.split(',') : catalog.dependent_files,
    );
    return files.some((file) => set.has(file));
  };
  for (const node of tree.order ?? []) {
    if (matches(node)) affected.push(node.id);
  }
  return affected;
}

/* ------------------------------------------------------------------------- *
 * Pipeline
 * ------------------------------------------------------------------------- */

/**
 * One generation run per workspace.
 *
 * The class holds the in-memory parts (abort controller, pause flag, current
 * stage) and delegates every durable fact to the metadata file. That split is
 * what makes `status()` correct after a restart: it reads the file, sees an
 * in-flight status, and reports `PAUSED`.
 */
export class WikiPipeline {
  /**
   * @param {object} ctx cordis context
   * @param {object} [config] profile config
   */
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config;
    /** @type {Map<string, { controller: AbortController, paused: boolean, cancelled: boolean, stage: string, startedAt: number, language: string }>} */
    this.runs = new Map();
    this.autoUpdateTimers = new Map();
  }

  /** Live settings for one workspace. */
  settingsFor(settings) {
    return {
      dataDir: '.dsh',
      language: 'zh',
      maxFiles: 10000,
      maxDepth: 4,
      maxCitations: 40,
      concurrency: 2,
      citation: true,
      ...(settings ?? {}),
    };
  }

  /** Key used to serialize runs for one workspace+language pair. */
  keyFor(workspace, language) {
    return `${path.resolve(workspace)}::${language}`;
  }

  /** Whether a run is in flight for this workspace. */
  isRunning(workspace) {
    for (const [key, run] of this.runs) {
      if (key.startsWith(`${path.resolve(workspace)}::`) && !run.controller.signal.aborted) return true;
    }
    return false;
  }

  /**
   * Read the effective status for one workspace.
   *
   * Combines the persisted metadata, the in-memory run, and the Git HEAD so a
   * completed wiki that describes an older commit reports `WIKI_HAS_COMMIT`
   * instead of pretending to be current.
   * @param {string} workspace
   * @param {object} settings
   * @returns {Promise<object>}
   */
  async status(workspace, settings) {
    const effective = this.settingsFor(settings);
    const language = effective.language;
    const exists = await wikiExists(workspace, effective.dataDir);
    if (!exists) {
      return this.statusView(STATUS.WIKI_INIT, this.emptyDetails(effective), { workspace, language, catalogs: 0 });
    }
    let metadata;
    try {
      metadata = await readMetadata(workspace, effective, language);
    } catch (error) {
      if (error instanceof WikiError && error.code === ERROR_CODES.metadataCorrupt) {
        return this.statusView(STATUS.WIKI_LOAD_FAIL, this.emptyDetails(effective), { workspace, language, catalogs: 0, error: error.message });
      }
      throw error;
    }
    const repo = metadata.wiki_repo ?? {};
    const total = Array.isArray(metadata.wiki_catalogs) ? metadata.wiki_catalogs.length : 0;
    const completed = metadata.wiki_catalogs.filter((entry) => entry.progress_status === CATALOG_STATUS.completed).length;
    const failed = metadata.wiki_catalogs.filter((entry) => entry.progress_status === CATALOG_STATUS.failed).length;
    const processing = metadata.wiki_catalogs.filter((entry) => entry.progress_status === CATALOG_STATUS.processing).length;

    const run = this.runs.get(this.keyFor(workspace, language));
    let stored = typeof repo.wiki_present_status === 'string' && repo.wiki_present_status !== '' ? repo.wiki_present_status : STATUS.WIKI_INIT;
    // A run that died with the process leaves an in-flight status behind; report
    // it as paused so the user can resume instead of staring at a frozen bar.
    if (run === undefined && isInFlight(stored)) stored = STATUS.PAUSED;

    const head = await headCommit(workspace);
    // A recorded commit that is no longer an ancestor of HEAD means the branch
    // was rewritten — that is Qoder's `WIKI_LOSS_COMMIT`, not `WIKI_HAS_COMMIT`.
    // A `null` answer (git could not tell) is treated as reachable: crying loss
    // on a flaky git call would wipe out a usable wiki's update path.
    const recorded = typeof repo.last_commit_id === 'string' ? repo.last_commit_id : '';
    const reachable =
      head !== null && recorded !== '' && head !== recorded
        ? (await isAncestor(workspace, recorded, head)) !== false
        : undefined;
    const derived = deriveStatus({
      status: stored,
      commitId: repo.last_commit_id,
      headCommit: head,
      totalCatalogs: total,
      commitReachable: reachable,
    });

    const details = {
      ...this.emptyDetails(effective),
      total_catalogs: total,
      completed_catalogs: completed,
      failed_catalogs: failed,
      processing_catalogs: processing,
      generation_type: repo.generation_type ?? GENERATION_TYPE.full,
      remaining_free_quota: 0,
      is_need_confirm: false,
      server_error_code: repo.server_error_code ?? '',
      server_error_hint: repo.server_error_hint ?? '',
      commit_id: repo.last_commit_id ?? '',
      update_time: repo.gmt_modified ?? '',
      total_files: typeof repo.total_files === 'number' ? repo.total_files : 0,
      // Qoder's own names for the same facts, so a client written against it
      // reads them without a translation layer.
      file_count: typeof repo.total_files === 'number' ? repo.total_files : 0,
      last_commit: repo.last_commit_id ?? '',
      current_commit: head ?? '',
      commit_diff_files: await this.commitDiffCount(workspace, repo.last_commit_id, head),
      last_update_time: repo.gmt_modified ?? '',
      branch: await currentBranch(workspace),
      head_commit: head,
      user_config: {
        auto_update: effective.autoUpdate === true,
        auto_export: false,
        citation: effective.citation !== false,
        team_sync: false,
      },
    };
    return this.statusView(derived, details, { workspace, language, catalogs: total, repo });
  }

  /**
   * How many files changed between the recorded commit and HEAD.
   *
   * Qoder shows this next to "the wiki describes an older commit", which is what
   * tells the user whether an update is worth running.
   */
  async commitDiffCount(workspace, recorded, head) {
    if (typeof recorded !== 'string' || recorded === '' || typeof head !== 'string' || head === '' || recorded === head) {
      return 0;
    }
    try {
      return (await changedFiles(workspace, recorded, head)).length;
    } catch {
      return 0;
    }
  }

  /** Shape the RPC/tool response for a status. */
  statusView(status, details, extra = {}) {
    return {
      status,
      details,
      workspace: extra.workspace ?? '',
      language: extra.language ?? 'zh',
      total_catalogs: extra.catalogs ?? 0,
      progress: progressPercent(status, details),
      incremental: isIncremental(details),
      error: extra.error ?? '',
      repo: extra.repo ?? null,
    };
  }

  /** Default `status_details` values. */
  emptyDetails(settings) {
    return {
      total_catalogs: 0,
      completed_catalogs: 0,
      failed_catalogs: 0,
      processing_catalogs: 0,
      generation_type: GENERATION_TYPE.full,
      total_files: 0,
      max_file_count: settings.maxFiles,
      remaining_free_quota: 0,
      line_up_wait_time: 0,
      is_need_confirm: false,
      server_error_code: '',
      server_error_hint: '',
      commit_id: '',
      update_time: '',
      file_count: 0,
      last_commit: '',
      current_commit: '',
      commit_diff_files: 0,
      last_update_time: '',
      confirm_message: '',
      branch: null,
      head_commit: null,
      user_config: { auto_update: false, auto_export: false, citation: true, team_sync: false },
    };
  }

  /* ----------------------------------------------------------------------- *
   * Preflight
   * ----------------------------------------------------------------------- */

  /**
   * Check the preconditions Qoder checks, in the same order.
   *
   * Returns the terminal status to report, or `null` when the run may proceed.
   * @returns {Promise<{ status: string, details?: object } | null>}
   */
  async preflight(workspace, settings, options = {}) {
    const { files, total, truncated } = await listRepoFiles(workspace, {
      dataDir: settings.dataDir,
      maxFiles: settings.maxFiles,
    });
    if (total === 0) return { status: STATUS.NO_FILE_FAILED };
    if (truncated || total > settings.maxFiles) {
      return { status: STATUS.TOO_MANY_FILES_FAILED, details: { max_file_count: settings.maxFiles, total_files: total } };
    }
    // Order matters: a workspace outside Git has no HEAD at all, so checking
    // for a missing commit first would misreport it as "commit your code" when
    // the real answer is "this is not a Git repository".
    const git = await isGitRepo(workspace);
    if (options.incremental === true && !git) return { status: STATUS.NOT_SOURCE_CONTROL_FAILED };
    if (options.requireGit === true && !git) return { status: STATUS.NOT_SOURCE_CONTROL_FAILED };
    if (options.incremental === true) {
      const head = await headCommit(workspace);
      if (head === null) return { status: STATUS.NO_COMMIT_HISTORY_FAILED };
    }
    return null;
  }

  /* ----------------------------------------------------------------------- *
   * Start / pause / resume / cancel
   * ----------------------------------------------------------------------- */

  /**
   * Fail fast when the host has no model service.
   *
   * Requirement: the panel and the agent tools must keep working without an
   * `llm` service, and only generation reports the missing capability — with a
   * code the client can branch on, not a generic failure status.
   * @throws {WikiError} with code `llm-unavailable`
   */
  async requireLlm(settings) {
    const llm = typeof this.ctx?.get === 'function' ? this.ctx.get('llm', false) : undefined;
    if (llm === undefined || llm === null || typeof llm.prepareCall !== 'function') {
      throw new WikiError(
        ERROR_CODES.llmUnavailable,
        'the host exposes no llm service; configure a model provider to enable generation',
      );
    }
    // Resolve the route too, so a bad provider/model pair fails here — before
    // the tree is planned — instead of mid-generation.
    return resolveRoute(this.ctx, settings);
  }

  /**
   * Run a full generation.
   *
   * @param {string} workspace
   * @param {object} settings
   * @param {{ language?: string, type?: string }} [options]
   * @returns {Promise<object>} the status view when the run settles
   */
  async start(workspace, settings, options = {}) {
    const effective = this.settingsFor({ ...settings, ...(options.language === undefined ? {} : { language: options.language }) });
    await this.requireLlm(effective);
    if (this.isRunning(workspace)) {
      const current = await this.status(workspace, effective);
      throw new PipelineBusyError(current.status);
    }

    const plan = await this.readPlan(workspace, effective);
    if (plan !== null && plan.valid === false) {
      throw new WikiError(ERROR_CODES.planInvalid, plan.errorMessage, {
        configPath: plan.configPath,
        valid: false,
        errorMessage: plan.errorMessage,
      });
    }

    const blocked = await this.preflight(workspace, effective, { incremental: false });
    if (blocked !== null) {
      await this.persistStatus(workspace, effective, blocked.status, {
        ...(blocked.details ?? {}),
        generation_type: GENERATION_TYPE.full,
      });
      return this.status(workspace, effective);
    }

    return this.runPipeline(workspace, effective, {
      mode: 'full',
      plan: plan?.plan ?? null,
      type: options.type ?? 'start',
    });
  }

  /** Regenerate from scratch: drop the tree and pages, then run full. */
  async regenerate(workspace, settings) {
    const effective = this.settingsFor(settings);
    if (this.isRunning(workspace)) throw new PipelineBusyError((await this.status(workspace, effective)).status);
    await deleteIndex(workspace, effective, effective.language);
    return this.start(workspace, effective, { type: 'regenerate' });
  }

  /** Delete one language's product. */
  async remove(workspace, settings, language) {
    const effective = this.settingsFor(settings);
    if (this.isRunning(workspace)) throw new PipelineBusyError((await this.status(workspace, effective)).status);
    const target = language ?? effective.language;
    await deleteIndex(workspace, effective, target);
    return this.status(workspace, effective);
  }

  /** Pause the in-flight run; the current page finishes first. */
  pause(workspace) {
    for (const [key, run] of this.runs) {
      if (key.startsWith(`${path.resolve(workspace)}::`)) {
        run.paused = true;
        return true;
      }
    }
    return false;
  }

  /**
   * Resume a paused run.
   *
   * Resuming continues the tree that already exists: re-planning would spend
   * the planning call again and could produce a different catalog, orphaning
   * the pages the paused run already wrote. Pages still marked pending or
   * processing are the work that remains.
   */
  async resume(workspace, settings, options = {}) {
    const effective = this.settingsFor(settings);
    await this.requireLlm(effective);
    const status = await this.status(workspace, effective);
    if (status.status !== STATUS.PAUSED) {
      throw new WikiError(ERROR_CODES.internal, `cannot resume from ${status.status}`);
    }
    if (this.isRunning(workspace)) throw new PipelineBusyError(status.status);

    const metadata = await readMetadata(workspace, effective, effective.language);
    const tree = buildTree(metadata);
    if (tree.order.length === 0) {
      // Nothing to resume: the pause happened before the tree was written.
      return this.start(workspace, effective, { type: 'resume' });
    }
    const remaining = tree.order
      .filter((node) => node.progress_status !== CATALOG_STATUS.completed)
      .map((node) => node.id);
    if (remaining.length === 0) {
      await this.persistStatus(workspace, effective, STATUS.COMPLETED, { recovery_checkpoint: 'wiki_generation_completed' });
      return this.status(workspace, effective);
    }
    return this.runPipeline(workspace, effective, {
      mode: 'resume',
      plan: null,
      type: 'resume',
      metadata,
      tree,
      affected: remaining,
      head: await headCommit(workspace),
      changed: [],
      wait: options.wait,
    });
  }

  /**
   * Retry a partially completed run.
   *
   * Qoder's `PARTLY_COMPLETED` action is `retry`: only the pages still marked
   * pending/processing/failed are regenerated — completed pages stay. This is
   * the same machinery as resume, gated on `PARTLY_COMPLETED` instead of
   * `PAUSED`; deliberately does not delete the tree the way `regenerate` does.
   */
  async retry(workspace, settings, options = {}) {
    const effective = this.settingsFor(settings);
    await this.requireLlm(effective);
    const status = await this.status(workspace, effective);
    if (status.status !== STATUS.PARTLY_COMPLETED) {
      throw new WikiError(ERROR_CODES.internal, `cannot retry from ${status.status}`);
    }
    if (this.isRunning(workspace)) throw new PipelineBusyError(status.status);

    const metadata = await readMetadata(workspace, effective, effective.language);
    const tree = buildTree(metadata);
    const remaining = tree.order
      .filter((node) => node.progress_status !== CATALOG_STATUS.completed)
      .map((node) => node.id);
    if (remaining.length === 0) {
      await this.persistStatus(workspace, effective, STATUS.COMPLETED, { recovery_checkpoint: 'wiki_generation_completed' });
      return this.status(workspace, effective);
    }
    return this.runPipeline(workspace, effective, {
      mode: 'resume',
      plan: null,
      type: 'retry',
      metadata,
      tree,
      affected: remaining,
      head: await headCommit(workspace),
      changed: [],
      wait: options.wait,
    });
  }

  /** Cancel the in-flight run and clean up its partial pages. */
  cancel(workspace) {
    for (const [key, run] of this.runs) {
      if (key.startsWith(`${path.resolve(workspace)}::`)) {
        run.cancelled = true;
        run.controller.abort();
        return true;
      }
    }
    return false;
  }

  /* ----------------------------------------------------------------------- *
   * Auto-update
   * ----------------------------------------------------------------------- */

  /**
   * Schedule an incremental update when HEAD moved past the recorded commit.
   *
   * Debounced per workspace: a burst of commits (a rebase, a branch switch)
   * must produce one run, not one per commit. The timer is held on the instance
   * so a `dispose` can clear it.
   *
   * @param {string} workspace
   * @param {object} settings
   * @returns {Promise<{ scheduled: boolean, reason: string }>}
   */
  async maybeAutoUpdate(workspace, settings) {
    const effective = this.settingsFor(settings);
    if (effective.autoUpdate !== true) return { scheduled: false, reason: 'disabled' };
    const key = path.resolve(workspace);
    if (this.autoUpdateTimers.has(key)) return { scheduled: true, reason: 'already-scheduled' };
    if (this.isRunning(workspace)) return { scheduled: false, reason: 'busy' };

    const status = await this.status(workspace, effective);
    if (status.status !== STATUS.WIKI_HAS_COMMIT) return { scheduled: false, reason: `status-${status.status}` };
    if (await headCommit(workspace) === null) return { scheduled: false, reason: 'no-commit' };

    const delay = Number.isInteger(effective.autoUpdateDelayMs) ? effective.autoUpdateDelayMs : 60000;
    const timer = setTimeout(() => {
      this.autoUpdateTimers.delete(key);
      this.update(workspace, effective).catch(() => {
        // A failed background update must not crash the host; the status file
        // already records the failure.
      });
    }, Math.max(5000, delay));
    // Never hold the process open just to run a wiki update.
    if (typeof timer.unref === 'function') timer.unref();
    this.autoUpdateTimers.set(key, timer);
    return { scheduled: true, reason: 'scheduled', delay };
  }

  /** Cancel every pending auto-update timer (called on dispose). */
  dispose() {
    for (const timer of this.autoUpdateTimers.values()) clearTimeout(timer);
    this.autoUpdateTimers.clear();
    for (const run of this.runs.values()) run.controller.abort();
    this.runs.clear();
  }

  /* ----------------------------------------------------------------------- *
   * Incremental update
   * ----------------------------------------------------------------------- */

  /**
   * Update only the catalogs whose dependent files changed since the recorded
   * commit.
   * @returns {Promise<object>}
   */
  async update(workspace, settings, options = {}) {
    const effective = this.settingsFor(settings);
    await this.requireLlm(effective);
    if (this.isRunning(workspace)) throw new PipelineBusyError((await this.status(workspace, effective)).status);

    const blocked = await this.preflight(workspace, effective, { incremental: true });
    if (blocked !== null) {
      await this.persistStatus(workspace, effective, blocked.status, { generation_type: GENERATION_TYPE.increment });
      return this.status(workspace, effective);
    }

    const metadata = await readMetadata(workspace, effective, effective.language);
    const repo = metadata.wiki_repo ?? {};
    const head = await headCommit(workspace);
    const recorded = typeof repo.last_commit_id === 'string' ? repo.last_commit_id : '';
    if (head === null || recorded === '' || head === recorded) {
      // Nothing to do: report the current status without starting a run.
      return this.status(workspace, effective);
    }
    // The recorded commit must still be reachable: diffing across a rewrite
    // produces a plausible-looking but wrong change set.
    if ((await isAncestor(workspace, recorded, head)) === false) {
      await this.persistStatus(workspace, effective, STATUS.WIKI_LOSS_COMMIT, {
        generation_type: GENERATION_TYPE.increment,
      });
      return this.status(workspace, effective);
    }
    const changed = await changedFiles(workspace, recorded, head);
    const tree = buildTree(metadata);
    const affected = affectedCatalogIds(tree, changed);
    if (affected.length === 0) {
      await this.persistStatus(workspace, effective, STATUS.COMPLETED, {
        generation_type: GENERATION_TYPE.increment,
        last_commit_id: head,
      });
      return this.status(workspace, effective);
    }
    return this.runPipeline(workspace, effective, {
      mode: 'incremental',
      plan: null,
      type: 'update',
      metadata,
      tree,
      affected,
      head,
      changed,
      wait: options.wait,
    });
  }

  /** Regenerate one catalog and its subtree. */
  async regenerateCatalog(workspace, settings, catalogId) {
    const effective = this.settingsFor(settings);
    await this.requireLlm(effective);
    if (this.isRunning(workspace)) throw new PipelineBusyError((await this.status(workspace, effective)).status);
    const metadata = await readMetadata(workspace, effective, effective.language);
    const tree = buildTree(metadata);
    const node = tree.byId.get(String(catalogId ?? ''));
    if (node === undefined) {
      throw new WikiError(ERROR_CODES.catalogNotFound, `no catalog "${catalogId}"`, { catalogId });
    }
    const subtree = [];
    const collect = (current) => {
      subtree.push(current.id);
      for (const child of current.children ?? []) collect(child);
    };
    collect(node);
    return this.runPipeline(workspace, effective, {
      mode: 'incremental',
      plan: null,
      type: 'regenerate-catalog',
      metadata,
      tree,
      affected: subtree,
      head: await headCommit(workspace),
      changed: [],
    });
  }

  /* ----------------------------------------------------------------------- *
   * The run itself
   * ----------------------------------------------------------------------- */

  /**
   * Drive one run from `WAITING` to a terminal status.
   * @param {string} workspace
   * @param {object} settings
   * @param {object} options
   * @returns {Promise<object>}
   */
  async runPipeline(workspace, settings, options) {
    const language = settings.language;
    const key = this.keyFor(workspace, language);
    const run = {
      controller: new AbortController(),
      paused: false,
      cancelled: false,
      stage: STATUS.WAITING,
      startedAt: Date.now(),
      language,
    };
    this.runs.set(key, run);
    // Two callers, two contracts. `wait: false` (the RPC ops) returns as soon
    // as the run is registered so the panel can poll `status`; the default
    // `wait: true` keeps the tool/test path's "await until it settles" shape.
    // Persist WAITING first: the RPC path's returned status must already read
    // "queued", and the detached task can then start at INITIALIZING.
    await this.persistStatus(workspace, settings, STATUS.WAITING, {
      generation_type: options.mode === 'incremental' ? GENERATION_TYPE.increment : GENERATION_TYPE.full,
    });
    const task = this.executePipeline(workspace, settings, options, run);
    if (options.wait === false) {
      task.catch(async (error) => {
        if (isAbort(error)) return;
        const code = error instanceof WikiError ? error.code : 'internal-error';
        await this.persistStatus(workspace, settings, STATUS.DOCUMENT_FAILED, {
          server_error_code: code,
          server_error_hint: failureHint(error),
        }).catch(() => {});
      });
      return this.status(workspace, settings);
    }
    return task;
  }

  /**
   * The pipeline body. `runPipeline` awaits it for tools/tests, detaches it
   * for the RPC surface.
   */
  async executePipeline(workspace, settings, options, run) {
    const key = this.keyFor(workspace, settings.language);
    const language = settings.language;
    const signal = run.controller.signal;

    try {
      // WAITING was persisted by runPipeline before the task was created.
      if (await this.checkpoint(workspace, settings, run)) return this.status(workspace, settings);

      // ── INITIALIZING ───────────────────────────────────────────────────
      run.stage = STATUS.INITIALIZING;
      await this.persistStatus(workspace, settings, STATUS.INITIALIZING, {
        generation_type: options.mode === 'incremental' ? GENERATION_TYPE.increment : GENERATION_TYPE.full,
      });
      const scan = await listRepoFiles(workspace, { dataDir: settings.dataDir, maxFiles: settings.maxFiles });
      const scoped = applyScope(scan.files, options.plan?.scope);
      const files = scoped.length > 0 ? scoped : scan.files;
      const head = options.head ?? (await headCommit(workspace));
      const branch = await currentBranch(workspace);
      const repoId = await this.ensureRepoId(workspace, settings, language, options);

      let metadata = options.metadata ?? (await readMetadata(workspace, settings, language));
      if (metadata.wiki_catalogs.length === 0) metadata = emptyMetadata();
      metadata.wiki_repo = {
        ...metadata.wiki_repo,
        id: repoId,
        name: path.basename(path.resolve(workspace)),
        wiki_present_status: STATUS.INITIALIZING,
        server_error_code: '',
        server_error_hint: '',
        generation_type: options.mode === 'incremental' ? GENERATION_TYPE.increment : GENERATION_TYPE.full,
        total_files: files.length,
        last_commit_id: head ?? '',
        extend_info: JSON.stringify({ language: qoderLocale(language), active: true, branch: branch ?? NON_GIT_BRANCH }),
      };
      await writeMetadata(workspace, settings, language, metadata);

      // ── DIRECTORY_GENERATING ───────────────────────────────────────────
      run.stage = STATUS.DIRECTORY_GENERATING;
      let tree = options.tree ?? null;
      // Only a full run (or a run with no tree at all) plans; resume, update and
      // single-catalog regeneration reuse the stored tree.
      const needsPlan = tree === null || options.mode === 'full';
      if (needsPlan) {
        await this.persistStatus(workspace, settings, STATUS.DIRECTORY_GENERATING, {
          generation_type: metadata.wiki_repo.generation_type,
          total_catalogs: 0,
        });
        if (await this.checkpoint(workspace, settings, run)) return this.status(workspace, settings);
        let normalized;
        try {
          normalized = await this.planCatalogs(workspace, settings, { files, plan: options.plan, signal, language });
          // A `documents` whitelist is a contract, not a hint: enforce it here
          // so a model that invents extra pages cannot break the promise the
          // plan file makes to the team.
          if (hasDocumentWhitelist(options.plan)) {
            normalized = applyDocumentWhitelist(options.plan, normalized);
          }
        } catch (error) {
          if (isAbort(error)) return this.settleAbort(workspace, settings, run);
          await this.persistStatus(workspace, settings, STATUS.DIRECTORY_FAILED, {
            server_error_code: error instanceof WikiError ? error.code : 'planning-failed',
            server_error_hint: failureHint(error),
          });
          return this.status(workspace, settings);
        }
        tree = normalized;
        metadata = emptyMetadata();
        metadata.wiki_repo = {
          id: repoId,
          name: path.basename(path.resolve(workspace)),
          wiki_present_status: STATUS.DIRECTORY_GENERATING,
          generation_type: options.mode === 'incremental' ? GENERATION_TYPE.increment : GENERATION_TYPE.full,
          total_files: files.length,
          last_commit_id: head ?? '',
          total_catalogs: tree.order.length,
          completed_catalogs: 0,
          failed_catalogs: 0,
          extend_info: JSON.stringify({ language: qoderLocale(language), active: true, branch: branch ?? NON_GIT_BRANCH }),
        };
        applyTree(metadata, tree);
        await writeMetadata(workspace, settings, language, metadata);
        if (options.mode === 'full') await this.writeKnowledgeCards(workspace, settings, language, tree, signal, options.plan);
      }

      // ── DOCUMENT_GENERATING ────────────────────────────────────────────
      run.stage = STATUS.DOCUMENT_GENERATING;
      const targetIds = options.affected === null || options.affected === undefined
        ? new Set(tree.order.map((node) => node.id))
        : new Set(options.affected);
      const targets = tree.order.filter((node) => targetIds.has(node.id));
      for (const node of targets) node.progress_status = CATALOG_STATUS.processing;
      applyTree(metadata, tree);
      await writeMetadata(workspace, settings, language, metadata);

      const concurrency = clampInt(settings.concurrency, 1, 8);
      const outcomes = new Map();
      let index = 0;
      let paused = false;

      const worker = async () => {
        while (true) {
          if (signal.aborted) return;
          if (run.paused) {
            paused = true;
            return;
          }
          const current = index;
          index += 1;
          const node = targets[current];
          if (node === undefined) return;
          try {
            const markdown = await this.writeOnePage(workspace, settings, {
              tree,
              node,
              files,
              signal,
              language,
              plan: options.plan,
            });
            outcomes.set(node.id, { ok: true, markdown });
          } catch (error) {
            if (isAbort(error)) return;
            outcomes.set(node.id, { ok: false, error });
          }
          // Persist after each page so a crash keeps the work done so far.
          for (const [id, outcome] of outcomes) {
            const target = tree.byId.get(id);
            if (target === undefined) continue;
            target.progress_status = outcome.ok ? CATALOG_STATUS.completed : CATALOG_STATUS.failed;
          }
          applyTree(metadata, tree);
          metadata.wiki_repo.wiki_present_status = STATUS.DOCUMENT_GENERATING;
          await writeMetadata(workspace, settings, language, metadata);
        }
      };

      await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(targets.length, 1)) }, worker));

      if (signal.aborted) return this.settleAbort(workspace, settings, run);

      // ── Settle ─────────────────────────────────────────────────────────
      const completed = tree.order.filter((node) => node.progress_status === CATALOG_STATUS.completed).length;
      const failed = tree.order.filter((node) => node.progress_status === CATALOG_STATUS.failed).length;
      applyTree(metadata, tree);
      metadata.wiki_repo = {
        ...metadata.wiki_repo,
        completed_catalogs: completed,
        failed_catalogs: failed,
        total_catalogs: tree.order.length,
        last_commit_id: head ?? '',
        last_commit_update: new Date().toISOString(),
        recovery_checkpoint: 'wiki_generation_completed',
      };
      // Qoder's exporter writes progress_status on the repo row; a finished run
      // is 'completed' there even when individual pages failed.
      if (completed > 0) metadata.wiki_repo.progress_status = CATALOG_STATUS.completed;
      const finalStatus = paused
        ? STATUS.PAUSED
        : failed > 0 && completed > 0
          ? STATUS.PARTLY_COMPLETED
          : failed > 0
            ? STATUS.DOCUMENT_FAILED
            : STATUS.COMPLETED;
      metadata.wiki_repo.wiki_present_status = finalStatus;
      await writeMetadata(workspace, settings, language, metadata);
      return this.status(workspace, settings);
    } catch (error) {
      if (isAbort(error)) return this.settleAbort(workspace, settings, run);
      const code = error instanceof WikiError ? error.code : 'internal-error';
      const terminal = code === ERROR_CODES.llmUnavailable ? STATUS.NETWORK_ERROR : STATUS.DOCUMENT_FAILED;
      await this.persistStatus(workspace, settings, terminal, { server_error_code: code, server_error_hint: failureHint(error) }).catch(() => {});
      throw error;
    } finally {
      if (this.runs.get(key) === run) this.runs.delete(key);
    }
  }

  /** Abort path: restore a sane status and clean up partial pages. */
  async settleAbort(workspace, settings, run) {
    const language = settings.language;
    if (run.cancelled) {
      // A cancel rolls back to whatever existed before this run started.
      const metadata = await readMetadata(workspace, settings, language).catch(() => emptyMetadata());
      const tree = buildTree(metadata);
      for (const node of tree.order) {
        if (node.progress_status === CATALOG_STATUS.processing) node.progress_status = CATALOG_STATUS.pending;
      }
      applyTree(metadata, tree);
      const hasContent = tree.order.some((node) => node.progress_status === CATALOG_STATUS.completed);
      metadata.wiki_repo.wiki_present_status = hasContent ? STATUS.PARTLY_COMPLETED : STATUS.WIKI_INIT;
      metadata.wiki_repo.recovery_checkpoint = '';
      if (!hasContent) {
        // A cancel before any page landed leaves nothing worth keeping. Dropping
        // the index is what makes the panel say "not generated" instead of
        // showing an empty tree as if a wiki existed.
        await deleteIndex(workspace, settings, language).catch(() => {});
        return this.status(workspace, settings);
      }
      await writeMetadata(workspace, settings, language, metadata).catch(() => {});
      return this.status(workspace, settings);
    }
    await this.persistStatus(workspace, settings, STATUS.PAUSED, { recovery_checkpoint: 'paused' }).catch(() => {});
    return this.status(workspace, settings);
  }

  /** Return early when the run was paused or cancelled between stages. */
  async checkpoint(workspace, settings, run) {
    if (run.controller.signal.aborted || run.paused) {
      await this.settleAbort(workspace, settings, run);
      return true;
    }
    return false;
  }

  /* ----------------------------------------------------------------------- *
   * Stages
   * ----------------------------------------------------------------------- */

  /** Read and validate `wiki_plan.yaml`; `null` when absent. */
  async readPlan(workspace, settings) {
    const file = planPath(workspace, settings);
    const text = await readTextFile(file, 1024 * 1024);
    if (text === null) return null;
    return parsePlan(text, file);
  }

  /** Planning stage: one model call (plus one retry) producing the tree. */
  async planCatalogs(workspace, settings, context) {
    const digest = renderTreeDigest(context.files, { maxEntries: 400 });
    const samples = await this.sampleFiles(workspace, context.files, PLAN_SAMPLE_FILES, PLAN_SAMPLE_BYTES);
    const planBlock = renderPlanPrompt(context.plan);
    const language = context.language === 'en' ? 'English' : '简体中文';

    const user = [
      `Repository: ${path.basename(path.resolve(workspace))}`,
      `Write the wiki in: ${language}`,
      '',
      '## File tree',
      digest,
      '',
      '## Sampled files',
      samples,
      ...(planBlock === '' ? [] : ['', planBlock]),
      '',
      'Return the JSON object now.',
    ].join('\n');

    let lastError;
    for (let attempt = 1; attempt <= PLAN_ATTEMPTS; attempt += 1) {
      try {
        const text = await callModel(this.ctx, settings, {
          system: PLANNING_SYSTEM,
          user,
          signal: context.signal,
          purpose: 'repo-wiki/plan',
        });
        return normalizeCatalogs(extractJson(text), { maxDepth: settings.maxDepth });
      } catch (error) {
        lastError = error;
        if (isAbort(error)) throw error;
        if (error instanceof WikiError && error.code === ERROR_CODES.llmUnavailable) throw error;
      }
    }
    throw lastError ?? new WikiError(ERROR_CODES.internal, 'planning failed');
  }

  /** Writing stage: one page. Retries once, then reports the failure. */
  async writeOnePage(workspace, settings, context) {
    const { node, tree, files } = context;
    const refs = normalizeFiles(node.dependent_files).filter((file) => files.includes(file));
    const chosen = refs.length > 0 ? refs.slice(0, PAGE_SAMPLE_FILES) : await this.pickRelatedFiles(workspace, node, files);
    const sources = await this.sampleFiles(workspace, chosen, PAGE_SAMPLE_FILES, PAGE_SAMPLE_BYTES);
    const planBlock = renderPlanPrompt(context.plan);
    const language = context.language === 'en' ? 'English' : '简体中文';
    const parents = [];
    let cursor = node.parent_id === '' ? undefined : tree.byId.get(node.parent_id);
    while (cursor !== undefined) {
      parents.unshift(cursor.name);
      cursor = cursor.parent_id === '' ? undefined : tree.byId.get(cursor.parent_id);
    }

    const user = [
      `Repository: ${path.basename(path.resolve(workspace))}`,
      `Page title: ${node.name}`,
      `Write the body in: ${language}`,
      ...(parents.length === 0 ? [] : [`Wiki path: ${[...parents, node.name].join(' > ')}`]),
      ...(node.prompt === '' ? [] : ['', `What this page must cover: ${node.prompt}`]),
      ...(typeof node.hints === 'string' && node.hints !== '' ? [`Additional hints: ${node.hints}`] : []),
      ...(typeof node.template === 'string' && node.template.trim() !== ''
        ? ['', 'Use exactly this section outline:', node.template.trim()]
        : []),
      ...(planBlock === '' ? [] : ['', planBlock]),
      '',
      '## Source files',
      sources === '' ? '(no source files were provided; describe only what the title implies, and say so where you are unsure)' : sources,
      '',
      'Write the page body now. Start with "##".',
    ].join('\n');

    let lastError;
    for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt += 1) {
      try {
        const raw = await callModel(this.ctx, settings, {
          system: WRITING_SYSTEM,
          user,
          signal: context.signal,
          purpose: 'repo-wiki/page',
        });
        const body = stripLeadingTitle(raw, node.name);
        const markdown = renderPage({
          title: node.name,
          refs: settings.citation === false ? [] : chosen,
          body,
          maxCitations: settings.maxCitations,
        });
        await writePage(workspace, settings, context.language, node, markdown, tree.byId);
        node.dependent_files = chosen.join(',');
        return markdown;
      } catch (error) {
        lastError = error;
        if (isAbort(error)) throw error;
        if (error instanceof WikiError && error.code === ERROR_CODES.llmUnavailable) throw error;
      }
    }
    throw lastError ?? new WikiError(ERROR_CODES.internal, `failed to write "${node.name}"`);
  }

  /** Knowledge-card stage: module summaries derived from the catalog tree. */
  async writeKnowledgeCards(workspace, settings, language, tree, signal, plan) {
    // Qoder's `module_path` is the source path a module documents — derive it
    // from the module's dependent files, not from the page description.
    const pathFor = (node) => {
      const files = normalizeFiles(node.dependent_files);
      if (files.length === 0) return moduleFileName(node.name);
      const dirs = files.map((file) => file.split('/').slice(0, -1));
      let prefix = dirs[0] ?? [];
      for (const dir of dirs.slice(1)) {
        let i = 0;
        while (i < prefix.length && i < dir.length && prefix[i] === dir[i]) i += 1;
        prefix = prefix.slice(0, i);
      }
      return prefix.length > 0 ? prefix.join('/') : moduleFileName(node.name);
    };
    const modules = tree.roots.map((root) => ({
      module: moduleFileName(root.name),
      modulePath: pathFor(root),
      title: root.name,
      files: normalizeFiles(root.dependent_files),
      dependsOn: [],
      relatedTo: tree.order
        .filter((node) => node.parent_id === root.id)
        .map((child) => ({ path: pathFor(child) })),
      summary: root.prompt,
      documents: {},
    }));
    if (modules.length === 0) return;
    try {
      signal?.throwIfAborted();
      const digest = tree.order.map((node) => `- ${node.name}: ${node.prompt}`).join('\n');
      const planBlock = renderPlanPrompt(plan);
      // Qoder's card taxonomy: one document per category. `overview` is a
      // card too — the module summary is its seed even when the model writes
      // nothing, so every module always has at least an overview row.
      const text = await callModel(this.ctx, settings, {
        system:
          'You produce repository knowledge cards for an AI agent. Output a single JSON object {"cards":[{"module":string,"overview":string,"architecture_design":string,"tech_stack":string,"coding_conventions":string,"unique_setup_and_commands":string,"related":[string]}]} and nothing else. Each value is a short Markdown body (no H1) or an empty string. "overview" is 1-2 sentences; "related" lists other module names this module depends on. Write in the requested language.',
        user: [
          `Write in: ${language === 'en' ? 'English' : '简体中文'}`,
          '',
          '## Modules',
          digest,
          ...(planBlock === '' ? [] : ['', planBlock]),
          '',
          'Return the JSON object now.',
        ].join('\n'),
        signal,
        purpose: 'repo-wiki/knowledge',
      });
      const parsed = extractJson(text);
      const cards = Array.isArray(parsed?.cards) ? parsed.cards : [];
      for (const card of cards) {
        const target = modules.find((module) => module.module === moduleFileName(String(card?.module ?? '')));
        if (target === undefined) continue;
        if (typeof card.overview === 'string' && card.overview.trim() !== '') target.summary = card.overview.trim();
        for (const category of CARD_CATEGORIES) {
          if (category === 'overview') continue;
          const body = card[category];
          if (typeof body === 'string' && body.trim() !== '') target.documents[category] = body.trim();
        }
        if (Array.isArray(card.related)) {
          target.relatedTo = card.related
            .map((name) => ({ path: moduleFileName(String(name ?? '')) }))
            .filter((entry) => entry.path !== '' && entry.path !== target.module);
        }
      }
    } catch (error) {
      // Knowledge cards are a bonus: a failure here must not fail the wiki.
      if (isAbort(error)) throw error;
    }
    await writeKnowledge(workspace, settings, language, modules, {
      commit: (await headCommit(workspace)) ?? '',
      branch: (await currentBranch(workspace)) ?? NON_GIT_BRANCH,
    });
  }

  /** Read up to `limit` files, truncating each to `bytes`. */
  async sampleFiles(workspace, files, limit, bytes) {
    const chosen = files.slice(0, limit);
    const blocks = [];
    for (const file of chosen) {
      const text = await readTextFile(path.join(workspace, file), bytes * 4);
      if (text === null) continue;
      const trimmed = text.length > bytes ? `${text.slice(0, bytes)}\n… (truncated)` : text;
      blocks.push(`### ${file}`, '```', trimmed, '```');
    }
    return blocks.join('\n');
  }

  /** Best-effort file choice for a catalog the planner left without files. */
  async pickRelatedFiles(workspace, node, files) {
    const slug = (node.description || node.name || '').toLowerCase();
    const tokens = slug.split(/[^a-z0-9]+/u).filter((token) => token.length >= 3);
    if (tokens.length === 0) return files.slice(0, 4);
    const scored = files
      .map((file) => {
        const lower = file.toLowerCase();
        const score = tokens.reduce((sum, token) => (lower.includes(token) ? sum + 1 : sum), 0);
        return { file, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || (a.file < b.file ? -1 : 1));
    const picked = scored.slice(0, 8).map((entry) => entry.file);
    return picked.length > 0 ? picked : files.slice(0, 4);
  }

  /**
   * Keep the repository id stable across runs.
   *
   * Qoder derives it as `sha256(repoName \0 branch \0 locale)`, which makes the
   * id reproducible on another machine checking out the same branch. Matching
   * that means a wiki exported from Qoder and re-exported here keeps the same
   * repo identity, so its metadata diff is empty.
   */
  async ensureRepoId(workspace, settings, language, options) {
    const existing = options?.metadata?.wiki_repo?.id;
    if (typeof existing === 'string' && existing !== '') return existing;
    try {
      const metadata = await readMetadata(workspace, settings, language);
      const id = metadata.wiki_repo?.id;
      if (typeof id === 'string' && id !== '') return id;
    } catch {
      // fall through to the derived id
    }
    // Qoder substitutes its magic sentinel branch when there is no Git
    // repository, so the id stays derivable (and identical to theirs).
    const branch = (await currentBranch(workspace)) ?? NON_GIT_BRANCH;
    return repoIdFor(path.basename(path.resolve(workspace)), branch, language);
  }

  /** Persist a status without touching the tree. */
  async persistStatus(workspace, settings, status, extra = {}) {
    const language = settings.language;
    let metadata;
    try {
      metadata = await readMetadata(workspace, settings, language);
    } catch {
      metadata = emptyMetadata();
    }
    if (metadata.wiki_catalogs.length === 0 && metadata.wiki_repo?.wiki_present_status === STATUS.WIKI_INIT) {
      metadata = { ...metadata, wiki_repo: { ...metadata.wiki_repo, ...extra } };
      metadata.wiki_repo.wiki_present_status = status;
      await writeMetadata(workspace, settings, language, metadata);
      return;
    }
    metadata.wiki_repo = { ...metadata.wiki_repo, ...extra, wiki_present_status: status };
    await writeMetadata(workspace, settings, language, metadata);
  }
}

/* ------------------------------------------------------------------------- *
 * Helpers
 * ------------------------------------------------------------------------- */

/** Whether a status means a run was in flight. */
function isInFlight(status) {
  return (
    status === STATUS.WAITING ||
    status === STATUS.LINING ||
    status === STATUS.INITIALIZING ||
    status === STATUS.DIRECTORY_GENERATING ||
    status === STATUS.DOCUMENT_GENERATING
  );
}

/** Whether an error came from an aborted signal. */
export function isAbort(error) {
  if (error === undefined || error === null) return false;
  if (error.name === 'AbortError') return true;
  if (error.code === 'ABORT_ERR') return true;
  if (error.code === 'ABORTED') return true;
  if (typeof error.message === 'string' && /abort/iu.test(error.message)) return true;
  return false;
}

function clampInt(value, lo, hi) {
  const number = Number(value);
  if (!Number.isFinite(number)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(number)));
}

/** Strip a leading H1 the model added despite being told not to. */
export function stripLeadingTitle(text, title) {
  let body = String(text ?? '').trim();
  const match = /^#\s+(.+?)\s*\n/u.exec(body);
  if (match !== null) {
    const heading = match[1].trim();
    if (heading === title || heading.toLowerCase() === String(title).toLowerCase()) {
      body = body.slice(match[0].length).trim();
    }
  }
  // A model that echoed our own prologue would duplicate it.
  body = body.replace(/^\s*<cite>[\s\S]*?<\/cite>\s*/u, '');
  body = body.replace(/^\s*##\s+目录\s*\n(?:\s*\d+\.\s*\[[^\]]*\]\([^)]*\)\s*\n)*/u, '');
  return body.trim();
}

/**
 * Qoder's repository id: `sha256(name \0 branch \0 locale)`.
 * @param {string} repoName
 * @param {string} branch
 * @param {string} language
 * @returns {string} hex digest
 */
export function repoIdFor(repoName, branch, language) {
  // Qoder seeds with the task locale in its `zh-cn`/`en-us` form (that is what
  // `extend_info.language` carries in real exports), and formats the digest as
  // a UUID — `ED`/`MMr` slice the hex 8-4-4-4-12.
  const seed = `${repoName}\u0000${branch}\u0000${qoderLocale(language)}`;
  try {
    const hex = createHash('sha256').update(seed, 'utf8').digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  } catch {
    return fallbackHash(seed);
  }
}

/** Deterministic non-cryptographic fallback; only used when crypto is absent. */
function fallbackHash(seed) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i += 1) {
    const code = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code, 0x85ebca6b) >>> 0;
  }
  const hex = `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`.repeat(2).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** A UUID v4, using the platform crypto when available. */
export function randomId() {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    const hex = () => Math.floor(Math.random() * 16).toString(16);
    let out = '';
    for (let i = 0; i < 32; i += 1) out += hex();
    return `${out.slice(0, 8)}-${out.slice(8, 12)}-4${out.slice(13, 16)}-a${out.slice(17, 20)}-${out.slice(20, 32)}`;
  }
}

/** Exported for tests that need the language root without a settings object. */
export { languageRoot, metadataPath, pageBody, LAYOUT };
