/**
 * dsh-repo-wiki/tools — the preset half.
 *
 * This module is the plugin a `@deepseek-ai/dsh-agent-preset` row mounts as
 * `@weniatall/dsh-repo-wiki/tools`. Everything it registers lands in the preset's
 * Cordis scope, so only an Agent that selected the `repo-wiki` preset sees the
 * six `*_wiki` tools or the two prompt sections. The host row deliberately
 * registers none of it.
 *
 * The tools are thin wrappers over `lib/ops.js`: the same functions the Web
 * panel calls over RPC. That is what keeps the two surfaces honest — a fix to
 * the delete cascade or the edit-ambiguity rule applies to both, and a tool test
 * exercises the code the panel actually runs.
 *
 * @module dsh-repo-wiki/tools
 */

import { DEFAULT_SETTINGS, TOOL_NAMES } from './constants.js';
import {
  catalogPromptLines,
  configSettings,
  deleteWiki,
  editWiki,
  effectiveSettings,
  hasWikiFor,
  listWiki,
  readWiki,
  searchWiki,
  workspaceFor,
  writeWiki,
} from './ops.js';
import { STATUS } from './constants.js';

/** Cordis plugin name; must match the preset row `name`. */
export const name = '@weniatall/dsh-repo-wiki/tools';

/** Tools are required; the prompt registry is looked up optionally. */
export const inject = ['tools'];

/* ------------------------------------------------------------------------- *
 * Schemas
 * ------------------------------------------------------------------------- */

const TEXT = { type: 'string' };
const NUMBER = { type: 'number' };
const BOOLEAN = { type: 'boolean' };

const CATALOG = {
  type: 'object',
  additionalProperties: true,
  required: ['catalog_id', 'title', 'path', 'progress_status'],
  properties: {
    catalog_id: TEXT,
    title: TEXT,
    path: TEXT,
    parent_id: { oneOf: [TEXT, { type: 'null' }] },
    progress_status: TEXT,
    depth: NUMBER,
  },
};

const SEARCH_HIT = {
  type: 'object',
  additionalProperties: true,
  required: ['catalog_id', 'title', 'path', 'snippet'],
  properties: { catalog_id: TEXT, title: TEXT, path: TEXT, snippet: TEXT },
};

function textContent(text) {
  return [{ type: 'text', text }];
}

/* ------------------------------------------------------------------------- *
 * Renderers
 * ------------------------------------------------------------------------- */

function renderList(value) {
  if (value.catalogs.length === 0) {
    return [
      `No Repo Wiki in ${value.workspace} yet.`,
      `Generate one from the Repo Wiki panel (right sidebar), or run the pipeline over RPC.`,
      `Root: ${value.root}`,
    ].join('\n');
  }
  const lines = [
    `Repo Wiki — ${value.catalogs.length} page(s), language ${value.language}`,
    `Root: ${value.root}`,
    '',
  ];
  for (const catalog of value.catalogs) {
    const indent = '  '.repeat(Math.min(catalog.depth ?? 0, 8));
    const marker = catalog.progress_status === 'completed' ? '' : ` [${catalog.progress_status}]`;
    lines.push(`${indent}- ${catalog.title}${marker} — \`${catalog.catalog_id}\``);
  }
  lines.push('', `Read one with ${TOOL_NAMES.read} and a catalog_id.`);
  return lines.join('\n');
}

function renderRead(value) {
  if (Array.isArray(value.results)) {
    if (value.results.length === 0) return `No page matches "${value.query}".`;
    const lines = [`${value.results.length} page(s) match "${value.query}":`];
    for (const hit of value.results) {
      lines.push(`- ${hit.title} (${hit.path}) — \`${hit.catalog_id}\``);
      lines.push(`  ${hit.snippet}`);
    }
    return lines.join('\n');
  }
  if (value.missing === true) {
    return `Page "${value.title}" exists in the catalog but has no content on disk yet (${value.path}).`;
  }
  const header = [`# ${value.title}`, '', `Path: ${value.path}`, `Catalog: ${value.catalog_id}`, ''];
  return [...header, value.content].join('\n');
}

function renderWrite(value) {
  return [
    `${value.created ? 'Created' : 'Updated'} page "${value.title}".`,
    `Path: ${value.path}`,
    `Catalog: ${value.catalog_id}`,
  ].join('\n');
}

function renderEdit(value) {
  return `Edited "${value.title}": ${value.replacements} replacement(s).`;
}

function renderDelete(value) {
  if (value.deleted.length === 1) return `Deleted page \`${value.deleted[0]}\`.`;
  return `Deleted ${value.deleted.length} pages: ${value.deleted.join(', ')}`;
}

function renderSearch(value) {
  if (value.results.length === 0) return `No page matches "${value.query}".`;
  const lines = [`${value.results.length} page(s) match "${value.query}":`];
  for (const hit of value.results) {
    lines.push(`- ${hit.title} (${hit.path}) — \`${hit.catalog_id}\``);
    lines.push(`  ${hit.snippet}`);
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------------- *
 * Tool definitions
 * ------------------------------------------------------------------------- */

function createToolDefinitions(ctx, config) {
  return [
    {
      name: TOOL_NAMES.list,
      description:
        'List the repository wiki catalog tree: one entry per page with its catalog_id, title, on-disk path and generation status. Use it before answering "how does X work?" — reading the wiki page first is cheaper and more accurate than grepping the whole repository. Returns an empty list (not an error) when no wiki has been generated yet.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: {
            type: 'string',
            description: 'Optional subtree prefix to list under, e.g. "架构设计" or "/" for the root.',
          },
          language: { type: 'string', description: 'zh or en; defaults to the configured language.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['workspace', 'language', 'generated', 'root', 'catalogs', 'error'],
          properties: {
            workspace: TEXT,
            language: TEXT,
            generated: BOOLEAN,
            root: TEXT,
            catalogs: { type: 'array', items: CATALOG },
            error: TEXT,
          },
        },
        render: (_args, value) => textContent(renderList(value)),
      },
      async execute(args, exec) {
        const value = await listWiki(ctx, config, exec, args ?? {});
        // Qoder's tool returns `{ Files: [...] }`; keep that alias alongside the
        // structured list so a prompt or client written against Qoder works.
        return {
          ...value,
          Files: value.catalogs.map((catalog) => ({
            catalog_id: catalog.catalog_id,
            title: catalog.title,
            path: catalog.path,
          })),
        };
      },
    },
    {
      name: TOOL_NAMES.read,
      description:
        'Read one wiki page by catalog_id, or search the wiki when given a query instead. The page body is Markdown and starts with a <cite> block naming the source files it was written from — use those paths to jump into the code. A title or on-disk path is also accepted in place of an id.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          catalog_id: { type: 'string', description: 'Catalog id from list_wiki. Accepts a title or path too.' },
          title: { type: 'string', description: 'Page title, as an alternative to catalog_id.' },
          query: { type: 'string', description: 'Search titles and bodies instead of reading one page.' },
          language: { type: 'string' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            catalog_id: TEXT,
            title: TEXT,
            path: TEXT,
            content: TEXT,
            missing: BOOLEAN,
            references: { type: 'array', items: TEXT },
            query: TEXT,
            results: { type: 'array', items: SEARCH_HIT },
          },
        },
        render: (_args, value) => textContent(renderRead(value)),
      },
      async execute(args, exec) {
        return readWiki(ctx, config, exec, args ?? {});
      },
    },
    {
      name: TOOL_NAMES.write,
      description:
        'Write or replace one whole wiki page. When the catalog does not exist it is created — pass `title` and optionally `parent_id` to nest it. The body is Markdown without an H1: the title, the <cite> block and the table of contents are added for you. Use this to record knowledge the wiki is missing, not to restate what it already says.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['content'],
        properties: {
          catalog_id: { type: 'string', description: 'Existing page to replace. Omit to create.' },
          path: { type: 'string', description: 'On-disk path; used to find an existing page.' },
          title: { type: 'string', description: 'Required when creating; also accepted to look up an existing page.' },
          content: { type: 'string', description: 'Markdown body. No H1, no cite block.' },
          parent_id: { type: 'string', description: 'Catalog id to nest a new page under.' },
          description: { type: 'string', description: 'Kebab-case slug for a new page.' },
          references: { type: 'array', items: TEXT, description: 'Repository-relative paths to cite.' },
          language: { type: 'string' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['catalog_id', 'title', 'path', 'created'],
          properties: { catalog_id: TEXT, title: TEXT, path: TEXT, created: BOOLEAN },
        },
        render: (_args, value) => textContent(renderWrite(value)),
      },
      async execute(args, exec) {
        return writeWiki(ctx, config, exec, args ?? {});
      },
    },
    {
      name: TOOL_NAMES.edit,
      description:
        'Edit one existing wiki page. Pass `content` to replace the whole body (Qoder\'s edit_wiki), or `find`/`replace` to patch a substring. A substring edit requires exactly one match unless `all: true`, so an ambiguous patch is refused rather than guessed.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['catalog_id'],
        properties: {
          catalog_id: TEXT,
          title: { type: 'string', description: 'Alternative to catalog_id.' },
          content: { type: 'string', description: 'Full replacement body (no H1, no cite block).' },
          find: { type: 'string', description: 'Exact text to find, for a partial edit.' },
          replace: { type: 'string', description: 'Replacement text for the partial edit.' },
          all: { type: 'boolean', description: 'Replace every occurrence (default false).' },
          language: { type: 'string' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['catalog_id', 'title', 'replacements'],
          properties: { catalog_id: TEXT, title: TEXT, replacements: NUMBER },
        },
        render: (_args, value) => textContent(renderEdit(value)),
      },
      async execute(args, exec) {
        return editWiki(ctx, config, exec, args ?? {});
      },
    },
    {
      name: TOOL_NAMES.delete,
      description:
        'Delete one wiki page and, by default, every page beneath it. Pass `cascade: false` to remove only the page and re-parent nothing (its children stay where they are).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          catalog_id: TEXT,
          title: { type: 'string', description: 'Alternative to catalog_id.' },
          path: { type: 'string', description: 'On-disk path, as another alternative.' },
          cascade: { type: 'boolean', description: 'Also delete the subtree (default true).' },
          language: { type: 'string' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['deleted', 'skipped'],
          properties: { deleted: { type: 'array', items: TEXT }, skipped: { type: 'array', items: TEXT } },
        },
        render: (_args, value) => textContent(renderDelete(value)),
      },
      async execute(args, exec) {
        return deleteWiki(ctx, config, exec, args ?? {});
      },
    },
    {
      name: TOOL_NAMES.search,
      description:
        'Search the repository wiki titles and bodies. Returns one hit per page with a short snippet. Use it to find which wiki page covers a subsystem before reading it in full.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: TEXT,
          limit: { type: 'integer', description: 'Maximum hits (default 20).' },
          language: { type: 'string' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['query', 'results'],
          properties: { query: TEXT, results: { type: 'array', items: SEARCH_HIT } },
        },
        render: (_args, value) => textContent(renderSearch(value)),
      },
      async execute(args, exec) {
        return searchWiki(ctx, config, exec, args ?? {});
      },
    },
  ];
}

/* ------------------------------------------------------------------------- *
 * Prompt
 * ------------------------------------------------------------------------- */

/**
 * The static policy section.
 *
 * Deliberately short: it tells the model the wiki exists, where it lives, and
 * when to prefer it over searching the code. Anything longer competes with the
 * actual task for attention.
 */
export const WIKI_POLICY_TEXT = `## Repo Wiki

This workspace carries a generated repository wiki: a tree of Markdown pages describing the project's architecture, modules, and data flow. It lives under \`<dataDir>/repowiki/<language>/\` and is maintained by the \`dsh-repo-wiki\` plugin.

Use it before you search:
- \`${TOOL_NAMES.list}\` gives you the catalog with stable ids. Do this first when you need to understand an unfamiliar area.
- \`${TOOL_NAMES.read}\` returns one page. Each page opens with a \`<cite>\` block listing the source files it was written from — follow those paths into the code to verify or go deeper.
- \`${TOOL_NAMES.search}\` finds the page covering a topic when you do not know the tree yet.

The wiki is a starting point, not the source of truth. Code wins over wiki when they disagree; when you find a page that is wrong or missing a fact you had to dig for, fix it with \`${TOOL_NAMES.write}\` or \`${TOOL_NAMES.edit}\` so the next reader does not repeat the work.

Do not paste whole pages back to the user. Cite the page and explain what matters.`;

/** Read the live settings for the prompt provider. */
async function liveSettings(config, workspace = null) {
  const effective = await effectiveSettings(config, workspace);
  return effective.values;
}

/**
 * Catalog summaries for the dynamic prompt section.
 *
 * The prompt registry interpolates synchronously, so the section cannot await a
 * disk read. This cache is filled out-of-band — on install and on a slow timer —
 * and a cold entry renders nothing, which is the correct degradation: a missing
 * catalog summary costs one tool call, a blocking prompt assembly costs the turn.
 */
const contextCache = {
  settings: null,
  entries: new Map(),
  timer: null,
};

/** Refresh the cached summary for one workspace. */
async function refreshContext(ctx, config, workspace) {
  try {
    const settings = await liveSettings(config, workspace);
    contextCache.settings = settings;
    if (settings.promptEnabled !== true || settings.promptMaxCatalogs === 0) return;
    const generated = await hasWikiFor(workspace, settings, settings.language);
    if (!generated) {
      contextCache.entries.set(workspace, { status: STATUS.WIKI_INIT, lines: [], total: 0 });
      return;
    }
    const summary = await catalogPromptLines(workspace, settings, settings.language, settings.promptMaxCatalogs);
    contextCache.entries.set(workspace, summary);
  } catch {
    // a stale or empty cache is always safe
  }
}

/** Start the background refresher for the workspaces this preset can see. */
function startContextRefresher(ctx, config) {
  stopContextRefresher();
  const tick = () => {
    try {
      const registry = typeof ctx?.get === 'function' ? ctx.get('workspaceRegistry', false) : undefined;
      const workspaces = (registry?.list?.() ?? []).map((entry) => entry?.path).filter((entry) => typeof entry === 'string');
      for (const workspace of workspaces) void refreshContext(ctx, config, workspace);
    } catch {
      // the registry may not be available in every composition
    }
  };
  tick();
  contextCache.timer = setInterval(tick, 15000);
  if (typeof contextCache.timer.unref === 'function') contextCache.timer.unref();
}

function stopContextRefresher() {
  if (contextCache.timer !== null) {
    clearInterval(contextCache.timer);
    contextCache.timer = null;
  }
}

/**
 * Register the policy section and the catalog context in the calling (preset)
 * scope.
 *
 * Both contributions consult the live settings on every assembly, so saving
 * settings takes effect on the next model call with no restart and no remount.
 * Returning an empty string drops them from the rendered prompt.
 *
 * @param {object} ctx Cordis context of the preset scope.
 * @param {unknown} config profile config.
 * @returns {{install: () => Promise<void>, uninstall: () => void}}
 */
function installPrompt(ctx, config) {
  let promptService = null;
  let disposers = [];
  const uninstall = () => {
    stopContextRefresher();
    for (const dispose of disposers) {
      try {
        dispose?.();
      } catch {
        // already disposed with the prompt scope
      }
    }
    disposers = [];
  };
  const install = async () => {
    if (promptService === null || typeof promptService.section !== 'function') {
      noteDiagnostic(ctx, 'repo-wiki: systemPrompt is unavailable in this preset scope; tools load without the wiki policy section');
      return;
    }
    uninstall();
    startContextRefresher(ctx, config);
    try {
      const section = promptService.section({
        name: 'repo-wiki-policy',
        order: 186,
        interpolate: false,
        text: () => (liveSettingsIsEnabled(config) ? WIKI_POLICY_TEXT : ''),
      });
      if (typeof section === 'function') disposers.push(section);
      if (typeof promptService.context === 'function') {
        const context = promptService.context({
          name: 'repo-wiki-catalog',
          order: 651,
          text: (assembly) => {
            // The prompt registry interpolates synchronously, so this must be a
            // string right now. The catalog summary is therefore served from a
            // cache refreshed after every RPC mutation and on a short timer;
            // a cold cache renders nothing rather than blocking assembly.
            try {
              const settings = contextCache.settings;
              if (settings === null || settings.promptEnabled !== true || settings.promptMaxCatalogs === 0) return '';
              const workspace = workspaceFor(ctx, { agent: assembly?.agent });
              const entry = contextCache.entries.get(workspace);
              if (entry === undefined || entry.lines.length === 0) {
                void refreshContext(ctx, config, workspace);
                return '';
              }
              const more = entry.total > entry.lines.length ? `\n… ${entry.total - entry.lines.length} more page(s) omitted.` : '';
              return [
                '## Repo Wiki catalog',
                '',
                `Status: ${entry.status} · language: ${settings.language} · ${entry.total} page(s).`,
                '',
                ...entry.lines,
                more,
                '',
                `Read one with \`${TOOL_NAMES.read}\` and its catalog_id.`,
              ].join('\n');
            } catch {
              return '';
            }
          },
        });
        if (typeof context === 'function') disposers.push(context);
      }
    } catch (error) {
      noteDiagnostic(ctx, `repo-wiki: prompt registration failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  if (typeof ctx?.get === 'function') {
    try {
      promptService = ctx.get('systemPrompt', false) ?? null;
    } catch {
      promptService = null;
    }
  }
  if (promptService !== null) {
    void install();
  } else if (typeof ctx?.inject === 'function') {
    ctx.inject(['systemPrompt'], (inner) => {
      promptService = inner?.systemPrompt ?? null;
      if (promptService !== null) void install();
      else noteDiagnostic(ctx, 'repo-wiki: systemPrompt did not resolve; tools load without the wiki policy section');
      inner.on?.('dispose', uninstall);
    });
  } else {
    noteDiagnostic(ctx, 'repo-wiki: systemPrompt is unavailable in this preset scope; tools load without the wiki policy section');
  }
  return { install, uninstall };
}

/** Cheap synchronous read of the one flag the static section needs. */
function liveSettingsIsEnabled(config) {
  // The static section is a plain string; reading the settings file on every
  // assembly is fine, but the config value is enough for a boolean that rarely
  // changes. The stored file is consulted by the dynamic context instead.
  const fromConfig = configSettings(config).values;
  return fromConfig.promptEnabled !== false;
}

function noteDiagnostic(ctx, message) {
  try {
    if (typeof ctx?.logger?.warn === 'function') ctx.logger.warn(message);
  } catch {
    // diagnostics never break load
  }
}

/* ------------------------------------------------------------------------- *
 * Entry
 * ------------------------------------------------------------------------- */

/**
 * Mount the preset half in the calling (preset) scope.
 * @param {object} ctx Cordis context of the preset scope.
 * @param {unknown} [config] profile config.
 */
export function apply(ctx, config) {
  const toolDisposers = [];
  for (const definition of createToolDefinitions(ctx, config)) {
    const dispose = ctx.tools.register(definition);
    if (typeof dispose === 'function') toolDisposers.push(dispose);
  }
  const prompt = installPrompt(ctx, config);
  ctx.on?.('dispose', () => {
    prompt.uninstall();
    for (const dispose of toolDisposers) {
      try {
        dispose();
      } catch {
        // the registry may already be gone with the scope
      }
    }
  });
}

export { DEFAULT_SETTINGS, STATUS, createToolDefinitions };
