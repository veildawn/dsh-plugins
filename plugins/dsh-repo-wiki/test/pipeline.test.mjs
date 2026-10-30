/**
 * Pipeline tests.
 *
 * Every test here runs the real pipeline against a real workspace with a fake
 * `ctx.llm`. That is the point: the state machine, the pause/cancel paths and
 * the incremental diff are the parts that are expensive to get wrong, and a
 * mock pipeline would not exercise them.
 *
 * Run: node --test test/pipeline.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  WikiPipeline,
  affectedCatalogIds,
  applyDocumentWhitelist,
  extractJson,
  failureHint,
  isAbort,
  normalizeCatalogs,
  repoIdFor,
  stripLeadingTitle,
} from '../lib/pipeline.js';
import { emptyPlanYaml } from '../lib/plan.js';
import { metadataPath, readMetadata } from '../lib/store.js';

const SETTINGS = {
  dataDir: '.dsh',
  language: 'zh',
  maxDepth: 4,
  maxCitations: 40,
  concurrency: 2,
  citation: true,
  maxFiles: 10000,
  provider: 'test-provider',
  model: 'test-model',
};

/**
 * Build a context whose model returns the queued responses in order.
 * @param {Array<string | Error | ((call: number, options: object) => string | Error)>} responses
 */
function makeCtx(responses) {
  let call = 0;
  const prompts = [];
  const llm = {
    listProviders: () => [{ id: 'test-provider' }, { id: 'deepseek-official' }],
    async prepareCall(config) {
      return {
        config,
        async *stream(options) {
          call += 1;
          prompts.push(config);
          const entry = responses[Math.min(call - 1, responses.length - 1)];
          const value = typeof entry === 'function' ? entry(call, options) : entry;
          if (value instanceof Error) throw value;
          yield { type: 'text-delta', index: 0, text: value };
          yield { type: 'finish', reason: { kind: 'stop' } };
        },
      };
    },
  };
  return {
    ctx: { get: (key) => (key === 'llm' ? llm : undefined) },
    calls: () => call,
    prompts,
  };
}

function planResponse(catalogs) {
  return JSON.stringify({ catalogs });
}

function knowledgeResponse(cards = []) {
  return JSON.stringify({ cards });
}

async function makeWorkspace(files = {}) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'rw-pipe-'));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(workspace, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
  return workspace;
}

async function walk(dir, base = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const relative = base === '' ? entry.name : `${base}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), relative)));
    else out.push(relative);
  }
  return out.sort();
}

function newPipeline(ctx) {
  return new WikiPipeline(ctx, {});
}

/* ------------------------------------------------------------------------- *
 * Pure helpers
 * ------------------------------------------------------------------------- */

test('extractJson finds an object inside prose and fences', () => {
  assert.deepEqual(extractJson('sure:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('prefix {"a":"}"} suffix'), { a: '}' });
  assert.throws(() => extractJson('no json here'));
});

test('normalizeCatalogs resolves parents, cycles and depth', () => {
  const tree = normalizeCatalogs({
    catalogs: [
      { title: 'A' },
      { title: 'B', parent: 'A' },
      { title: 'C', parent: 'B' },
      { title: 'D', parent: 'D' },
      { title: 'A' },
    ],
  }, { maxDepth: 2 });
  const names = tree.order.map((node) => node.name);
  assert.deepEqual(names, ['A', 'B', 'C', 'D']);
  assert.equal(tree.byId.get('catalog-4').parent_id, '', 'a self-parent must become a root');
  // Depth 2 means A → B only; C is promoted to A.
  assert.equal(tree.byId.get('catalog-3').parent_id, 'catalog-1');
});

test('normalizeCatalogs rejects an empty plan', () => {
  assert.throws(() => normalizeCatalogs({ catalogs: [] }));
});

test('applyDocumentWhitelist replaces the model tree verbatim', () => {
  const plan = {
    repowiki: {
      documents: [
        { title: '系统架构', goal: 'g1', parent: '', hints: '', template: '## A' },
        { title: '支付', goal: 'g2', parent: '系统架构', hints: '', template: '' },
      ],
    },
  };
  const planned = normalizeCatalogs({ catalogs: [{ title: '系统架构', files: ['a.ts'] }, { title: '多余' }] });
  const out = applyDocumentWhitelist(plan, planned);
  assert.deepEqual(out.order.map((node) => node.name), ['系统架构', '支付']);
  assert.deepEqual(out.order[0].dependent_files, ['a.ts']);
  assert.equal(out.order[0].template, '## A');
  assert.equal(out.byId.get('catalog-2').parent_id, 'catalog-1');
});

test('affectedCatalogIds is monotone in the change set', () => {
  const tree = normalizeCatalogs({
    catalogs: [
      { title: 'A', files: ['a.ts'] },
      { title: 'B', files: ['b.ts'] },
      { title: 'C', files: ['c.ts'] },
    ],
  });
  const sets = [[], ['a.ts'], ['a.ts', 'b.ts'], ['a.ts', 'b.ts', 'c.ts']];
  const counts = sets.map((set) => affectedCatalogIds(tree, set).length);
  assert.deepEqual(counts, [0, 1, 2, 3]);
});

test('stripLeadingTitle removes a duplicated H1 and prologue', () => {
  assert.equal(stripLeadingTitle('# 概览\n\n## 简介\nx', '概览'), '## 简介\nx');
  assert.equal(stripLeadingTitle('## 简介\nx', '概览'), '## 简介\nx');
  assert.equal(
    stripLeadingTitle('# T\n\n<cite>\n- [a](file://a)\n</cite>\n\n## 目录\n1. [x](#x)\n\n## 正文\ny', 'T'),
    '## 正文\ny',
  );
});

test('repoIdFor matches Qoder\'s UUID(sha256(name \\0 branch \\0 locale))', async () => {
  const { createHash } = await import('node:crypto');
  // Qoder seeds with the `zh-cn` locale form and formats the digest as a UUID.
  const hex = createHash('sha256').update('repo\u0000main\u0000zh-cn', 'utf8').digest('hex');
  const expected = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  assert.equal(repoIdFor('repo', 'main', 'zh'), expected);
  assert.match(repoIdFor('repo', 'main', 'zh'), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
  assert.notEqual(repoIdFor('repo', 'main', 'zh'), repoIdFor('repo', 'dev', 'zh'));
});

test('isAbort recognises the usual abort shapes', () => {
  const abort = new Error('The operation was aborted');
  abort.name = 'AbortError';
  assert.equal(isAbort(abort), true);
  assert.equal(isAbort({ code: 'ABORT_ERR' }), true);
  assert.equal(isAbort(new Error('boom')), false);
  assert.equal(isAbort(null), false);
});

/* ------------------------------------------------------------------------- *
 * Full runs
 * ------------------------------------------------------------------------- */

test('a full run reaches COMPLETED and writes the Qoder layout', async () => {
  const workspace = await makeWorkspace({ 'README.md': '# Demo', 'src/app.ts': 'export const a = 1;' });
  const { ctx } = makeCtx([
    planResponse([
      { title: '概述', description: 'overview', files: ['README.md'], prompt: '项目是什么' },
      { title: '架构', description: 'arch', prompt: '架构' },
      { title: '源码', description: 'source', files: ['src/app.ts'], parent: '架构', prompt: '源码' },
    ]),
    knowledgeResponse([]),
    '## 简介\n正文。',
    '## 简介\n正文。',
    '## 简介\n正文。',
  ]);
  const pipeline = newPipeline(ctx);
  const result = await pipeline.start(workspace, SETTINGS);

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.progress, 100);
  assert.equal(result.details.total_catalogs, 3);
  assert.equal(result.details.completed_catalogs, 3);

  const files = await walk(path.join(workspace, '.dsh'));
  assert.ok(files.includes('repowiki/zh/meta/repowiki-metadata.json'), files.join('\n'));
  assert.ok(files.includes('repowiki/zh/content/概述.md'), 'top-level leaf goes directly under content/');
  assert.ok(files.includes('repowiki/zh/content/架构/架构.md'), 'a category owns a directory');
  assert.ok(files.includes('repowiki/zh/content/架构/源码.md'), 'a child leaf lives in the category directory');

  const metadata = await readMetadata(workspace, SETTINGS, 'zh');
  assert.equal(metadata.wiki_repo.wiki_present_status, 'COMPLETED');
  assert.equal(metadata.wiki_catalogs.length, 3);
  assert.equal(metadata.wiki_items.length, 3);
  assert.match(metadata.wiki_repo.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u, 'repo id is a UUID-formatted digest');
});

test('generation refuses to start without an llm service', async () => {
  const workspace = await makeWorkspace({ 'README.md': '# D' });
  const pipeline = newPipeline({ get: () => undefined });
  await assert.rejects(
    () => pipeline.start(workspace, SETTINGS),
    (error) => error.code === 'llm-unavailable',
  );
  // The status is still readable — the panel keeps working.
  const status = await pipeline.status(workspace, SETTINGS);
  assert.equal(status.status, 'WIKI_INIT');
});

test('a repository with no files fails as NO_FILE_FAILED', async () => {
  const workspace = await makeWorkspace({});
  const { ctx } = makeCtx(['unused']);
  const result = await newPipeline(ctx).start(workspace, SETTINGS);
  assert.equal(result.status, 'NO_FILE_FAILED');
});

test('a planning failure retries once, then reports DIRECTORY_FAILED', async () => {
  const workspace = await makeWorkspace({ 'README.md': '# D' });
  const { ctx, calls } = makeCtx(['not json at all', 'still not json']);
  const result = await newPipeline(ctx).start(workspace, SETTINGS);
  assert.equal(result.status, 'DIRECTORY_FAILED');
  assert.match(result.details.server_error_hint, /目录/u);
  assert.equal(calls(), 2, 'planning must be attempted exactly twice');
});

test('wait:false returns the queued status while the run continues in the background', async () => {
  const workspace = await makeWorkspace({ 'README.md': '# Demo' });
  const { ctx } = makeCtx([
    planResponse([{ title: '概述', files: ['README.md'], prompt: 'p' }]),
    knowledgeResponse([]),
    '## 简介\n正文。',
  ]);
  const pipeline = newPipeline(ctx);
  const queued = await pipeline.start(workspace, SETTINGS, { wait: false });
  // The RPC returns a live status instead of waiting for the run to settle;
  // a fast mock may already have moved past WAITING, which is fine.
  assert.notEqual(queued.status, 'WIKI_INIT');
  // The background task reaches its terminal state on its own.
  for (let i = 0; i < 40; i += 1) {
    const status = await pipeline.status(workspace, SETTINGS);
    if (status.status === 'COMPLETED') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail('the detached run never reached COMPLETED');
});

test('failure hints classify errors without exposing provider error text', () => {
  assert.match(failureHint(new Error('HTTP 401 credential secret-value')), /认证/u);
  assert.doesNotMatch(failureHint(new Error('HTTP 401 credential secret-value')), /secret-value/u);
  assert.match(failureHint(new Error('rate limit 429')), /限流/u);
  assert.match(failureHint(new Error('the model response contained no parsable JSON object')), /目录/u);
});

test('one failing page yields PARTLY_COMPLETED and keeps the good pages', async () => {
  const workspace = await makeWorkspace({ 'README.md': '# D' });
  const { ctx } = makeCtx([
    planResponse([
      { title: '好页', files: ['README.md'], prompt: 'a' },
      { title: '坏页', prompt: 'b' },
    ]),
    knowledgeResponse([]),
    (_call, options) => options.messages[0].content[0].text.includes('Page title: 好页')
      ? '## 正文\n内容'
      : new Error('model exploded'),
  ]);
  const result = await newPipeline(ctx).start(workspace, SETTINGS);
  assert.equal(result.status, 'PARTLY_COMPLETED');
  assert.equal(result.details.completed_catalogs, 1);
  assert.equal(result.details.failed_catalogs, 1);
  const files = await walk(path.join(workspace, '.dsh', 'repowiki', 'zh', 'content'));
  assert.ok(files.includes('好页.md'), 'the successful page must survive');
});

test('a plan with an invalid wiki_plan.yaml is refused before any state change', async () => {
  const workspace = await makeWorkspace({ 'README.md': '# D' });
  await mkdir(path.join(workspace, '.dsh', 'repowiki'), { recursive: true });
  await writeFile(path.join(workspace, '.dsh', 'repowiki', 'wiki_plan.yaml'), '- a\n- b\n');
  const { ctx } = makeCtx(['unused']);
  await assert.rejects(
    () => newPipeline(ctx).start(workspace, SETTINGS),
    (error) => error.code === 'plan-invalid' && typeof error.details.configPath === 'string',
  );
});

test('a valid wiki_plan.yaml whitelist constrains the pages', async () => {
  const workspace = await makeWorkspace({ 'README.md': '# D' });
  await mkdir(path.join(workspace, '.dsh', 'repowiki'), { recursive: true });
  await writeFile(
    path.join(workspace, '.dsh', 'repowiki', 'wiki_plan.yaml'),
    'version: 1\nrepowiki:\n  documents:\n    - title: 只要这页\n      goal: 唯一\n',
  );
  const { ctx } = makeCtx([
    planResponse([{ title: '模型自己想的', prompt: 'x' }, { title: '又一个', prompt: 'y' }]),
    knowledgeResponse([]),
    '## 正文\n内容',
  ]);
  const result = await newPipeline(ctx).start(workspace, SETTINGS);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.details.total_catalogs, 1);
  const metadata = await readMetadata(workspace, SETTINGS, 'zh');
  assert.deepEqual(metadata.wiki_catalogs.map((catalog) => catalog.name), ['只要这页']);
});

test('an empty scaffolded plan does not constrain anything', async () => {
  const workspace = await makeWorkspace({ 'README.md': '# D' });
  await mkdir(path.join(workspace, '.dsh', 'repowiki'), { recursive: true });
  await writeFile(path.join(workspace, '.dsh', 'repowiki', 'wiki_plan.yaml'), emptyPlanYaml());
  const { ctx } = makeCtx([
    planResponse([{ title: 'A', files: ['README.md'], prompt: 'x' }]),
    knowledgeResponse([]),
    '## 正文\n内容',
  ]);
  const result = await newPipeline(ctx).start(workspace, SETTINGS);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.details.total_catalogs, 1);
});

/* ------------------------------------------------------------------------- *
 * Pause / resume / cancel
 * ------------------------------------------------------------------------- */

test('pause stops after the current page and resume continues', async () => {
  const workspace = await makeWorkspace({ 'README.md': '# D' });
  const pipeline = newPipeline(
    makeCtx([
      planResponse([
        { title: 'A', files: ['README.md'], prompt: 'a' },
        { title: 'B', prompt: 'b' },
        { title: 'C', prompt: 'c' },
      ]),
      knowledgeResponse([]),
      '## 正文\n内容',
      '## 正文\n内容',
      '## 正文\n内容',
    ]).ctx,
  );

  // Pause as soon as the run starts; the first page still completes.
  const original = pipeline.writeOnePage.bind(pipeline);
  let written = 0;
  pipeline.writeOnePage = async (...args) => {
    const value = await original(...args);
    written += 1;
    if (written === 1) pipeline.pause(workspace);
    return value;
  };

  const paused = await pipeline.start(workspace, SETTINGS);
  assert.equal(paused.status, 'PAUSED');
  assert.ok(written >= 1);

  const resumed = await pipeline.resume(workspace, SETTINGS);
  assert.equal(resumed.status, 'COMPLETED');
});

test('cancel rolls the run back without leaving half-written state', async () => {
  const workspace = await makeWorkspace({ 'README.md': '# D' });
  const pipeline = newPipeline(
    makeCtx([
      planResponse([{ title: 'A', files: ['README.md'], prompt: 'a' }]),
      knowledgeResponse([]),
      '## 正文\n内容',
    ]).ctx,
  );
  const original = pipeline.writeOnePage.bind(pipeline);
  pipeline.writeOnePage = async (...args) => {
    pipeline.cancel(workspace);
    return original(...args);
  };
  const result = await pipeline.start(workspace, SETTINGS);
  assert.ok(['WIKI_INIT', 'PARTLY_COMPLETED'].includes(result.status), `unexpected ${result.status}`);
});

test('a second start while running is refused', async () => {
  const workspace = await makeWorkspace({ 'README.md': '# D' });
  const pipeline = newPipeline(
    makeCtx([
      planResponse([{ title: 'A', files: ['README.md'], prompt: 'a' }]),
      knowledgeResponse([]),
      '## 正文\n内容',
    ]).ctx,
  );
  const original = pipeline.writeOnePage.bind(pipeline);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  pipeline.writeOnePage = async (...args) => {
    await gate;
    return original(...args);
  };
  const first = pipeline.start(workspace, SETTINGS);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await assert.rejects(() => pipeline.start(workspace, SETTINGS), (error) => error.code === 'busy');
  release();
  await first;
});

/* ------------------------------------------------------------------------- *
 * Incremental updates
 * ------------------------------------------------------------------------- */

function git(workspace, args) {
  execFileSync('git', args, { cwd: workspace, stdio: 'pipe' });
}

async function makeGitWorkspace() {
  const workspace = await makeWorkspace({
    'README.md': '# Demo',
    'src/a.ts': 'export const a = 1;',
    'src/b.ts': 'export const b = 1;',
  });
  git(workspace, ['init', '-q']);
  git(workspace, ['config', 'user.email', 'test@example.com']);
  git(workspace, ['config', 'user.name', 'Test']);
  git(workspace, ['add', '-A']);
  git(workspace, ['commit', '-qm', 'init']);
  return workspace;
}

test('an update with no new commit is a no-op', async () => {
  const workspace = await makeGitWorkspace();
  const { ctx, calls } = makeCtx([
    planResponse([
      { title: '概述', files: ['README.md'], prompt: 'a' },
      { title: '源码', files: ['src/a.ts'], prompt: 'b' },
    ]),
    knowledgeResponse([]),
    '## 正文\n内容',
    '## 正文\n内容',
  ]);
  const pipeline = newPipeline(ctx);
  await pipeline.start(workspace, SETTINGS);
  const before = calls();
  const result = await pipeline.update(workspace, SETTINGS);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(calls(), before, 'no model calls for a no-op update');
});

test('an incremental update only rewrites the affected page', async () => {
  const workspace = await makeGitWorkspace();
  const { ctx, calls } = makeCtx([
    planResponse([
      { title: '概述', files: ['README.md'], prompt: 'a' },
      { title: '源码', files: ['src/a.ts'], prompt: 'b' },
    ]),
    knowledgeResponse([]),
    '## 正文\n内容',
    '## 正文\n内容',
  ]);
  const pipeline = newPipeline(ctx);
  await pipeline.start(workspace, SETTINGS);

  await writeFile(path.join(workspace, 'src', 'a.ts'), 'export const a = 2;');
  git(workspace, ['commit', '-aqm', 'change a']);

  const before = calls();
  const result = await pipeline.update(workspace, SETTINGS);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.details.generation_type, 'INCREMENT');
  assert.equal(calls() - before, 1, 'exactly one page should be rewritten');
});

test('a rewritten HEAD marks the wiki WIKI_LOSS_COMMIT and update refuses to diff', async () => {
  const workspace = await makeGitWorkspace();
  const { ctx, calls } = makeCtx([
    planResponse([
      { title: '概述', files: ['README.md'], prompt: 'a' },
      { title: '源码', files: ['src/a.ts'], prompt: 'b' },
    ]),
    knowledgeResponse([]),
    '## 正文\n内容',
    '## 正文\n内容',
  ]);
  const pipeline = newPipeline(ctx);
  const started = await pipeline.start(workspace, SETTINGS);
  assert.equal(started.status, 'COMPLETED');

  // Amend with a real change: the recorded commit leaves HEAD's ancestry.
  await writeFile(path.join(workspace, 'src', 'a.ts'), 'export const a = 9;');
  git(workspace, ['commit', '-aq', '--amend', '--no-edit']);

  const status = await pipeline.status(workspace, SETTINGS);
  assert.equal(status.status, 'WIKI_LOSS_COMMIT');

  const before = calls();
  const updated = await pipeline.update(workspace, SETTINGS);
  assert.equal(updated.status, 'WIKI_LOSS_COMMIT');
  assert.equal(calls(), before, 'a lost commit must not produce model calls');
});

test('a PARTLY_COMPLETED retry regenerates only the failed pages', async () => {
  const workspace = await makeWorkspace({ 'README.md': '# D' });
  const { ctx } = makeCtx([
    planResponse([
      { title: '好页', files: ['README.md'], prompt: 'a' },
      { title: '坏页', prompt: 'b' },
    ]),
    knowledgeResponse([]),
    '## 正文\n内容',
    new Error('model exploded'),
    new Error('model exploded'),
    '## 补上的正文\n内容',
  ]);
  const pipeline = newPipeline(ctx);
  const partial = await pipeline.start(workspace, SETTINGS);
  assert.equal(partial.status, 'PARTLY_COMPLETED');
  assert.equal(partial.details.completed_catalogs, 1);

  const retried = await pipeline.retry(workspace, SETTINGS);
  assert.equal(retried.status, 'COMPLETED');
  assert.equal(retried.details.completed_catalogs, 2);

  const metadata = await readMetadata(workspace, SETTINGS, 'zh');
  const byName = new Map(metadata.wiki_catalogs.map((catalog) => [catalog.name, catalog]));
  assert.equal(byName.get('坏页').progress_status, 'completed');
  // retry() refuses anything that is not PARTLY_COMPLETED.
  await assert.rejects(
    () => pipeline.retry(workspace, SETTINGS),
    (error) => error.code === 'internal-error',
  );
});

test('an update outside git fails as NOT_SOURCE_CONTROL_FAILED', async () => {
  const workspace = await makeWorkspace({ 'README.md': '# D' });
  const { ctx } = makeCtx(['unused']);
  const result = await newPipeline(ctx).update(workspace, SETTINGS);
  assert.equal(result.status, 'NOT_SOURCE_CONTROL_FAILED');
});

/* ------------------------------------------------------------------------- *
 * Regenerate / delete
 * ------------------------------------------------------------------------- */

test('regenerate clears the tree and rebuilds it', async () => {
  const workspace = await makeWorkspace({ 'README.md': '# D' });
  const { ctx } = makeCtx([
    planResponse([{ title: '旧页', files: ['README.md'], prompt: 'a' }]),
    knowledgeResponse([]),
    '## 正文\n内容',
    planResponse([{ title: '新页', files: ['README.md'], prompt: 'b' }]),
    knowledgeResponse([]),
    '## 正文\n内容',
  ]);
  const pipeline = newPipeline(ctx);
  await pipeline.start(workspace, SETTINGS);
  const result = await pipeline.regenerate(workspace, SETTINGS);
  assert.equal(result.status, 'COMPLETED');
  const metadata = await readMetadata(workspace, SETTINGS, 'zh');
  assert.deepEqual(metadata.wiki_catalogs.map((catalog) => catalog.name), ['新页']);
});

test('deleteIndex resets the status to WIKI_INIT', async () => {
  const workspace = await makeWorkspace({ 'README.md': '# D' });
  const { ctx } = makeCtx([
    planResponse([{ title: 'A', files: ['README.md'], prompt: 'a' }]),
    knowledgeResponse([]),
    '## 正文\n内容',
  ]);
  const pipeline = newPipeline(ctx);
  await pipeline.start(workspace, SETTINGS);
  const result = await pipeline.remove(workspace, SETTINGS, 'zh');
  assert.equal(result.status, 'WIKI_INIT');
});

test('regenerateCatalog only rewrites that subtree', async () => {
  const workspace = await makeWorkspace({ 'README.md': '# D' });
  const { ctx, calls } = makeCtx([
    planResponse([
      { title: 'A', files: ['README.md'], prompt: 'a' },
      { title: 'B', prompt: 'b' },
    ]),
    knowledgeResponse([]),
    '## 正文\n内容',
    '## 正文\n内容',
    '## 正文\n内容',
  ]);
  const pipeline = newPipeline(ctx);
  await pipeline.start(workspace, SETTINGS);
  const metadata = await readMetadata(workspace, SETTINGS, 'zh');
  const target = metadata.wiki_catalogs.find((catalog) => catalog.name === 'B');
  const before = calls();
  await pipeline.regenerateCatalog(workspace, SETTINGS, target.id);
  assert.equal(calls() - before, 1);
});

/* ------------------------------------------------------------------------- *
 * Interrupted runs
 * ------------------------------------------------------------------------- */

test('a stored in-flight status reads as PAUSED after a restart', async () => {
  const workspace = await makeWorkspace({ 'README.md': '# D' });
  const { ctx } = makeCtx([
    planResponse([{ title: 'A', files: ['README.md'], prompt: 'a' }]),
    knowledgeResponse([]),
    '## 正文\n内容',
  ]);
  await newPipeline(ctx).start(workspace, SETTINGS);

  // Simulate the process dying mid-document-stage.
  const file = metadataPath(workspace, SETTINGS, 'zh');
  const raw = JSON.parse(await readFile(file, 'utf8'));
  raw.wiki_repo.wiki_present_status = 'DOCUMENT_GENERATING';
  await writeFile(file, `${JSON.stringify(raw, null, 2)}\n`);

  // A fresh pipeline has no in-memory run, so it must report PAUSED.
  const fresh = newPipeline({ get: () => undefined });
  const status = await fresh.status(workspace, SETTINGS);
  assert.equal(status.status, 'PAUSED');
});

test('a completed wiki whose HEAD moved reports WIKI_HAS_COMMIT', async () => {
  const workspace = await makeGitWorkspace();
  const { ctx } = makeCtx([
    planResponse([{ title: 'A', files: ['README.md'], prompt: 'a' }]),
    knowledgeResponse([]),
    '## 正文\n内容',
  ]);
  const pipeline = newPipeline(ctx);
  await pipeline.start(workspace, SETTINGS);

  await writeFile(path.join(workspace, 'src', 'a.ts'), 'export const a = 99;');
  git(workspace, ['commit', '-aqm', 'moved on']);

  const status = await pipeline.status(workspace, SETTINGS);
  assert.equal(status.status, 'WIKI_HAS_COMMIT');
  assert.ok(status.details.commit_diff_files >= 1);
});

/* ------------------------------------------------------------------------- *
 * Auto-update
 * ------------------------------------------------------------------------- */

test('auto-update is skipped when disabled', async () => {
  const workspace = await makeGitWorkspace();
  const { ctx } = makeCtx(['unused']);
  const pipeline = newPipeline(ctx);
  const result = await pipeline.maybeAutoUpdate(workspace, { ...SETTINGS, autoUpdate: false });
  assert.equal(result.scheduled, false);
  assert.equal(result.reason, 'disabled');
});

test('auto-update is skipped when there is no drift', async () => {
  const workspace = await makeGitWorkspace();
  const { ctx } = makeCtx([
    planResponse([{ title: 'A', files: ['README.md'], prompt: 'a' }]),
    knowledgeResponse([]),
    '## 正文\n内容',
  ]);
  const pipeline = newPipeline(ctx);
  await pipeline.start(workspace, SETTINGS);
  const result = await pipeline.maybeAutoUpdate(workspace, { ...SETTINGS, autoUpdate: true });
  assert.equal(result.scheduled, false);
  assert.match(result.reason, /status-/u);
});

test('dispose clears timers and aborts runs', () => {
  const pipeline = newPipeline({ get: () => undefined });
  pipeline.dispose();
  assert.equal(pipeline.autoUpdateTimers.size, 0);
  assert.equal(pipeline.runs.size, 0);
});

/* ------------------------------------------------------------------------- *
 * Model route selection
 * ------------------------------------------------------------------------- */

test('an unknown provider is rejected before the pipeline starts', async () => {
  const workspace = await makeWorkspace({ 'README.md': '# D' });
  const { ctx } = makeCtx(['unused']);
  const pipeline = newPipeline(ctx);
  await assert.rejects(
    () => pipeline.start(workspace, { ...SETTINGS, provider: 'nope', model: 'x' }),
    (error) => error.code === 'llm-unavailable' && /not configured/u.test(error.message),
  );
  // Nothing was written: the check happens before any state change.
  const status = await pipeline.status(workspace, SETTINGS);
  assert.equal(status.status, 'WIKI_INIT');
});

test('half a route is a configuration error, not a silent fallback', async () => {
  const workspace = await makeWorkspace({ 'README.md': '# D' });
  const { ctx } = makeCtx(['unused']);
  const pipeline = newPipeline(ctx);
  await assert.rejects(
    () => pipeline.start(workspace, { ...SETTINGS, provider: '', model: 'x' }),
    (error) => error.code === 'llm-unavailable' && /both/u.test(error.message),
  );
  await assert.rejects(
    () => pipeline.start(workspace, { ...SETTINGS, provider: 'deepseek-official', model: '' }),
    (error) => error.code === 'llm-unavailable' && /both/u.test(error.message),
  );
});

test('a configured route is passed through to the model call', async () => {
  const workspace = await makeWorkspace({ 'README.md': '# D' });
  const { ctx, prompts } = makeCtx([
    planResponse([{ title: 'A', files: ['README.md'], prompt: 'a' }]),
    knowledgeResponse([]),
    '## 正文\n内容',
  ]);
  const pipeline = newPipeline(ctx);
  const result = await pipeline.start(workspace, {
    ...SETTINGS,
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  });
  assert.equal(result.status, 'COMPLETED');
  assert.ok(prompts.length > 0);
  assert.equal(prompts[0].provider, 'deepseek-official');
  assert.equal(prompts[0].model, 'deepseek-v4-flash');
});

/* ------------------------------------------------------------------------- *
 * Stream assembly
 *
 * The plugin no longer imports the host's `BlockAssembler` (it cannot, from a
 * profile), so its own accumulator has to handle the shapes adapters actually
 * emit: token deltas, whole blocks, and a terminal finish.
 * ------------------------------------------------------------------------- */

test('a provider that sends whole blocks instead of deltas still yields text', async () => {
  const workspace = await makeWorkspace({ 'README.md': '# D' });
  const cats = [{ title: 'A', files: ['README.md'], prompt: 'a' }];
  const llm = {
    listProviders: () => [{ id: 'test-provider' }],
    async prepareCall(config) {
      let call = 0;
      return {
        config,
        async *stream() {
          call += 1;
          const text = call === 1
            ? JSON.stringify({ catalogs: cats })
            : call === 2
              ? JSON.stringify({ cards: [] })
              : '## 正文\n内容';
          // Whole-block form, no text-delta chunks at all.
          yield { type: 'block-start', index: 0, blockType: 'text' };
          yield { type: 'block-end', index: 0, block: { type: 'text', text } };
          yield { type: 'finish', reason: { kind: 'stop' } };
        },
      };
    },
  };
  const pipeline = new WikiPipeline({ get: () => llm }, {});
  const result = await pipeline.start(workspace, SETTINGS);
  assert.equal(result.status, 'COMPLETED');
});

test('a terminal error finish fails the stage instead of returning empty text', async () => {
  const workspace = await makeWorkspace({ 'README.md': '# D' });
  const llm = {
    listProviders: () => [{ id: 'test-provider' }],
    async prepareCall(config) {
      return {
        config,
        async *stream() {
          yield { type: 'text-delta', index: 0, text: 'partial' };
          yield { type: 'finish', reason: { kind: 'error', failure: { message: 'upstream 500', code: 'PROVIDER' } } };
        },
      };
    },
  };
  const pipeline = new WikiPipeline({ get: () => llm }, {});
  const result = await pipeline.start(workspace, SETTINGS);
  assert.equal(result.status, 'DIRECTORY_FAILED');
});
