/**
 * Storage tests.
 *
 * The interesting assertions here are the Qoder-compatibility ones: an export
 * this plugin writes must be readable by Qoder and vice versa, which means the
 * four metadata tables, the `WikiEncrypted:` tolerance, the item-level
 * `knowledge_relations` and the category-directory page paths all have to line
 * up exactly. Those are pinned against the real 71-page export found on this
 * machine when it is present, and against a synthetic equivalent otherwise.
 *
 * Run: node --test test/store.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  WikiError,
  applyTree,
  buildTree,
  deleteIndex,
  emptyMetadata,
  flattenTree,
  hasContent,
  isEncrypted,
  knowledgeRoot,
  languageRoot,
  metadataPath,
  cardFileName,
  moduleFileName,
  normalizeDataDir,
  normalizeLanguage,
  pageBody,
  pageFileName,
  pagePath,
  planPath,
  readKnowledge,
  readMetadata,
  readPage,
  reconcilePagePaths,
  renderKnowledgeIndex,
  renderModuleYaml,
  renderPage,
  safeFileName,
  wikiRoot,
  withLock,
  writeKnowledge,
  writeMetadata,
  writePage,
} from '../lib/store.js';

const SETTINGS = { dataDir: '.dsh', language: 'zh' };

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function tempWorkspace(prefix) {
  return mkdtemp(path.join(tmpdir(), prefix));
}

/* ------------------------------------------------------------------------- *
 * Paths
 * ------------------------------------------------------------------------- */

test('path helpers compose the documented layout', () => {
  const workspace = '/repo';
  assert.equal(wikiRoot(workspace, SETTINGS), path.join('/repo', '.dsh', 'repowiki'));
  assert.equal(languageRoot(workspace, SETTINGS, 'zh'), path.join('/repo', '.dsh', 'repowiki', 'zh'));
  assert.equal(
    metadataPath(workspace, SETTINGS, 'zh'),
    path.join('/repo', '.dsh', 'repowiki', 'zh', 'meta', 'repowiki-metadata.json'),
  );
  assert.equal(planPath(workspace, SETTINGS), path.join('/repo', '.dsh', 'repowiki', 'wiki_plan.yaml'));
  assert.equal(knowledgeRoot(workspace, SETTINGS, 'en'), path.join('/repo', '.dsh', 'repowiki', 'knowledge', 'en'));
});

test('normalizeDataDir refuses to escape the workspace', () => {
  assert.equal(normalizeDataDir('.dsh'), '.dsh');
  assert.equal(normalizeDataDir('./docs/.wiki/'), 'docs/.wiki');
  assert.equal(normalizeDataDir(''), '.dsh');
  assert.equal(normalizeDataDir('../outside'), '.dsh');
  assert.equal(normalizeDataDir('/etc'), '.dsh');
  assert.equal(normalizeDataDir('C:/x'), '.dsh');
});

test('normalizeLanguage folds tags onto zh and en', () => {
  assert.equal(normalizeLanguage('zh'), 'zh');
  assert.equal(normalizeLanguage('zh-cn'), 'zh');
  assert.equal(normalizeLanguage('en-us'), 'en');
  assert.equal(normalizeLanguage('fr'), 'zh');
  assert.equal(normalizeLanguage(undefined), 'zh');
});

/* ------------------------------------------------------------------------- *
 * Property 3: safeFileName is idempotent and legal.
 * ------------------------------------------------------------------------- */

test('Property 3: safeFileName is idempotent and produces a legal name', () => {
  const random = mulberry32(0xabcd);
  const alphabet = 'abc /\\:*?"<>|.\t中文_-0123456789';
  // Qoder's `Kbt` replaces exactly these with `_` — control characters and dots
  // are *not* sanitized by the exporter, so they are not asserted here.
  const illegal = /[/\\:*?"<>|]/u;

  for (let iteration = 0; iteration < 300; iteration += 1) {
    let source = '';
    const length = Math.floor(random() * 40);
    for (let i = 0; i < length; i += 1) source += alphabet[Math.floor(random() * alphabet.length)];

    const first = safeFileName(source);
    assert.equal(safeFileName(first), first, `not idempotent for ${JSON.stringify(source)}`);
    assert.equal(illegal.test(first), false, `illegal characters survived in ${JSON.stringify(first)}`);
    assert.notEqual(first, '', 'result must not be empty');
    assert.equal(first, first.trim(), 'result must not have surrounding whitespace');
  }
});

test('safeFileName matches Qoder\'s page-name substitution', () => {
  // `Kbt` (wiki pages): every illegal character becomes `_`, then a trim —
  // no length cap, no dot stripping.
  assert.equal(pageFileName('a/b:c*d'), 'a_b_c_d');
  assert.equal(pageFileName('  '), '');
  assert.equal(pageFileName('con'), 'con-page');
  assert.equal(pageFileName('.hidden'), '.hidden', 'Kbt keeps leading dots');
  assert.equal(pageFileName('x'.repeat(300)).length, 300, 'Kbt does not truncate');
  assert.equal(safeFileName('  '), '_unnamed', 'the alias keeps a guaranteed stem');
});

test('moduleFileName matches Qoder\'s $Mr rule', () => {
  // `$Mr` (knowledge modules): `/` → `_`, the other illegal characters are
  // *deleted*, capped at 80 characters, `_unnamed` when nothing remains.
  assert.equal(moduleFileName('a/b:c*d'), 'a_bcd');
  assert.equal(moduleFileName('a/b'), 'a_b');
  assert.equal(moduleFileName(':::'), '_unnamed');
  assert.equal(moduleFileName('x'.repeat(100)).length, 80);
  assert.equal(moduleFileName('  ok  '), 'ok');
});

/* ------------------------------------------------------------------------- *
 * Property 4: page paths follow Qoder's category rule.
 * ------------------------------------------------------------------------- */

function treeOf(specs) {
  const metadata = emptyMetadata();
  const nodes = new Map();
  const order = [];
  let index = 0;
  for (const spec of specs) {
    index += 1;
    const node = {
      id: `c${index}`,
      name: spec.title,
      parent_id: spec.parent ?? '',
      order: spec.order ?? index,
      children: [],
      progress_status: 'completed',
    };
    nodes.set(node.id, node);
    order.push(node);
  }
  for (const node of order) {
    if (node.parent_id === '') continue;
    nodes.get(node.parent_id).children.push(node);
  }
  const roots = order.filter((node) => node.parent_id === '');
  metadata.wiki_repo.id = 'r';
  applyTree(metadata, { roots, byId: nodes, order });
  return buildTree(metadata);
}

test('a top-level leaf lives directly under content/', () => {
  const tree = treeOf([{ title: '快速开始' }]);
  assert.equal(pagePath(tree.byId.get('c1'), tree.byId), '快速开始.md');
});

test('a category owns a directory and its own page lives inside', () => {
  const tree = treeOf([{ title: '架构设计' }, { title: '模块化设计', parent: 'c1' }]);
  assert.equal(pagePath(tree.byId.get('c1'), tree.byId), '架构设计/架构设计.md');
  assert.equal(pagePath(tree.byId.get('c2'), tree.byId), '架构设计/模块化设计.md');
});

test('nested categories chain their directories', () => {
  const tree = treeOf([
    { title: '架构设计' },
    { title: '安全架构设计', parent: 'c1' },
    { title: '沙箱隔离机制', parent: 'c2' },
  ]);
  assert.equal(pagePath(tree.byId.get('c2'), tree.byId), '架构设计/安全架构设计/安全架构设计.md');
  assert.equal(pagePath(tree.byId.get('c3'), tree.byId), '架构设计/安全架构设计/沙箱隔离机制.md');
});

test('Property 4: page paths are unique across a random tree', () => {
  const random = mulberry32(0x7777);
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const specs = [];
    const count = 1 + Math.floor(random() * 12);
    for (let i = 0; i < count; i += 1) {
      const parent = specs.length > 0 && random() < 0.5 ? `c${1 + Math.floor(random() * specs.length)}` : '';
      specs.push({ title: `页面${i}`, parent });
    }
    const tree = treeOf(specs);
    const seen = new Set();
    for (const node of tree.order) {
      const page = pagePath(node, tree.byId);
      assert.equal(seen.has(page), false, `duplicate path ${page}`);
      seen.add(page);
      assert.match(page, /\.md$/u);
      assert.equal(page.includes('..'), false);
    }
  }
});

/* ------------------------------------------------------------------------- *
 * Metadata
 * ------------------------------------------------------------------------- */

test('a missing metadata file reads as an empty skeleton', async () => {
  const workspace = await tempWorkspace('rw-meta-');
  const metadata = await readMetadata(workspace, SETTINGS, 'zh');
  assert.deepEqual(metadata.wiki_catalogs, []);
  assert.equal(metadata.wiki_repo.wiki_present_status, 'WIKI_INIT');
});

test('a corrupt metadata file raises metadata-corrupt and is left alone', async () => {
  const workspace = await tempWorkspace('rw-bad-');
  const file = metadataPath(workspace, SETTINGS, 'zh');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '{ not json');
  await assert.rejects(
    () => readMetadata(workspace, SETTINGS, 'zh'),
    (error) => error instanceof WikiError && error.code === 'metadata-corrupt',
  );
  assert.equal(await readFile(file, 'utf8'), '{ not json', 'the original must not be rewritten');
});

test('Qoder\'s encrypted fields are dropped without failing the read', async () => {
  const workspace = await tempWorkspace('rw-enc-');
  const qoder = {
    wiki_repo: {
      id: 'repo-1',
      wiki_present_status: 'COMPLETED',
      optimized_catalog: 'WikiEncrypted:AAAA',
      current_document_structure: 'WikiEncrypted:BBBB',
      last_commit_id: 'abc123',
    },
    wiki_catalogs: [{ id: 'c1', name: '架构设计', raw_data: 'WikiEncrypted:CCCC' }],
    wiki_items: [{ catalog_id: 'c1', title: '架构设计', id: 'i1' }],
    knowledge_relations: [],
  };
  await writeMetadata(workspace, SETTINGS, 'zh', qoder);
  const metadata = await readMetadata(workspace, SETTINGS, 'zh');
  assert.equal(metadata.wiki_repo.optimized_catalog, undefined);
  assert.equal(metadata.wiki_repo.current_document_structure, undefined);
  assert.equal(metadata.wiki_repo.last_commit_id, 'abc123');
  assert.equal(isEncrypted('WikiEncrypted:x'), true);
  assert.equal(isEncrypted('plain'), false);
});

test('writeMetadata keeps the four tables and refreshes counters', async () => {
  const workspace = await tempWorkspace('rw-count-');
  const metadata = emptyMetadata();
  metadata.wiki_catalogs = [
    { id: 'a', name: 'A', progress_status: 'completed' },
    { id: 'b', name: 'B', progress_status: 'failed' },
    { id: 'c', name: 'C', progress_status: 'pending' },
  ];
  const written = await writeMetadata(workspace, SETTINGS, 'zh', metadata);
  assert.equal(written.wiki_repo.total_catalogs, 3);
  assert.equal(written.wiki_repo.completed_catalogs, 1);
  assert.equal(written.wiki_repo.failed_catalogs, 1);
  const raw = JSON.parse(await readFile(metadataPath(workspace, SETTINGS, 'zh'), 'utf8'));
  assert.deepEqual(Object.keys(raw).sort(), ['knowledge_relations', 'wiki_catalogs', 'wiki_items', 'wiki_repo']);
});

test('knowledge_relations are written with item ids, the way Qoder writes them', async () => {
  const workspace = await tempWorkspace('rw-rel-');
  const tree = treeOf([{ title: '父' }, { title: '子', parent: 'c1' }]);
  const metadata = emptyMetadata();
  metadata.wiki_repo.id = 'r';
  applyTree(metadata, tree);
  const parentItem = metadata.wiki_items.find((item) => item.catalog_id === 'c1');
  const childItem = metadata.wiki_items.find((item) => item.catalog_id === 'c2');
  assert.equal(metadata.knowledge_relations.length, 1);
  assert.equal(metadata.knowledge_relations[0].source_id, parentItem.id);
  assert.equal(metadata.knowledge_relations[0].target_id, childItem.id);
  assert.equal(metadata.knowledge_relations[0].relationship_type, 'PARENT_CHILD');
  // And the catalog keeps the plugin's own parent_id extension too.
  assert.equal(metadata.wiki_catalogs.find((catalog) => catalog.id === 'c2').parent_id, 'c1');
});

test('buildTree resolves Qoder item-level relations back to catalogs', () => {
  const metadata = {
    wiki_repo: { id: 'r' },
    wiki_catalogs: [
      { id: 'c1', name: '父' },
      { id: 'c2', name: '子' },
    ],
    wiki_items: [
      { id: 'i1', catalog_id: 'c1', title: '父' },
      { id: 'i2', catalog_id: 'c2', title: '子' },
    ],
    knowledge_relations: [
      { source_id: 'i1', target_id: 'i2', relationship_type: 'PARENT_CHILD' },
    ],
  };
  const tree = buildTree(metadata);
  assert.equal(tree.byId.get('c2').parent_id, 'c1');
  assert.equal(tree.roots.length, 1);
  assert.equal(tree.roots[0].children.length, 1);
});

test('Property 7: metadata round-trips through disk', async () => {
  const workspace = await tempWorkspace('rw-rt-');
  const random = mulberry32(0x4242);
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const count = 1 + Math.floor(random() * 5);
    const metadata = emptyMetadata();
    metadata.wiki_repo.id = 'repo-x';
    for (let i = 0; i < count; i += 1) {
      metadata.wiki_catalogs.push({
        id: `c${i}`,
        name: `页面${i}`,
        description: `d${i}`,
        prompt: '',
        progress_status: random() < 0.5 ? 'completed' : 'pending',
        dependent_files: '',
        parent_id: null,
        order: i,
      });
    }
    await writeMetadata(workspace, SETTINGS, 'zh', metadata);
    const back = await readMetadata(workspace, SETTINGS, 'zh');
    assert.equal(back.wiki_catalogs.length, count);
    assert.deepEqual(
      back.wiki_catalogs.map((catalog) => catalog.id),
      metadata.wiki_catalogs.map((catalog) => catalog.id),
    );
  }
});

/* ------------------------------------------------------------------------- *
 * Pages
 * ------------------------------------------------------------------------- */

test('renderPage emits title, cite block, contents and body in order', () => {
  const page = renderPage({
    title: '技术栈',
    refs: ['build.gradle.kts', 'src/app.kt'],
    body: '## 简介\n内容\n\n## 依赖\nx',
  });
  const lines = page.split('\n');
  assert.equal(lines[0], '# 技术栈');
  assert.ok(page.includes('<cite>'));
  assert.ok(page.includes('[app.kt](file://src/app.kt)'));
  assert.ok(page.includes('## 目录'));
  assert.ok(page.indexOf('</cite>') < page.indexOf('## 目录'));
  assert.ok(page.indexOf('## 目录') < page.indexOf('## 简介'));
});

test('renderPage truncates a long reference list and says so', () => {
  const refs = Array.from({ length: 10 }, (_, i) => `src/f${i}.ts`);
  const page = renderPage({ title: 'T', refs, body: '## A\nx', maxCitations: 3 });
  assert.equal((page.match(/- \[/gu) ?? []).length, 3);
  assert.match(page, /另有 7 个文件未列出/u);
});

test('pageBody strips the generated prologue', () => {
  const page = renderPage({ title: 'T', refs: ['a.ts'], body: '## A\nx' });
  const body = pageBody(page);
  assert.ok(body.startsWith('## A'));
  assert.equal(body.includes('<cite>'), false);
  assert.equal(body.includes('## 目录'), false);
});

test('a page round-trips through disk', async () => {
  const workspace = await tempWorkspace('rw-page-');
  const tree = treeOf([{ title: '概览' }]);
  const node = tree.byId.get('c1');
  const markdown = renderPage({ title: '概览', refs: ['README.md'], body: '## 简介\n内容' });
  const relative = await writePage(workspace, SETTINGS, 'zh', node, markdown, tree.byId);
  assert.equal(relative, '概览.md');
  const read = await readPage(workspace, SETTINGS, 'zh', node, tree.byId);
  assert.equal(read.trimEnd(), markdown.trimEnd());
  assert.equal(node.page_path, '概览.md');
});

test('a leaf that gains a child has its page moved, and back again', async () => {
  const workspace = await tempWorkspace('rw-move-');
  const tree = treeOf([{ title: '快速开始' }]);
  const parent = tree.byId.get('c1');
  await writePage(workspace, SETTINGS, 'zh', parent, renderPage({ title: '快速开始', body: '## A\nx' }), tree.byId);
  assert.equal(parent.page_path, '快速开始.md');

  // Give it a child, then reconcile: the parent's file must move into the new
  // directory rather than being orphaned.
  const child = { id: 'c2', name: '技术栈', parent_id: 'c1', order: 0, children: [], progress_status: 'completed' };
  parent.children.push(child);
  tree.byId.set('c2', child);
  tree.order.push(child);
  const moved = await reconcilePagePaths(workspace, SETTINGS, 'zh', tree);
  assert.deepEqual(moved, ['快速开始/快速开始.md']);
  assert.equal(parent.page_path, '快速开始/快速开始.md');
  const read = await readPage(workspace, SETTINGS, 'zh', parent, tree.byId);
  assert.ok(read.includes('## A'));
});

test('deleteIndex removes content, metadata and knowledge cards', async () => {
  const workspace = await tempWorkspace('rw-del-');
  const tree = treeOf([{ title: '概览' }]);
  await writePage(workspace, SETTINGS, 'zh', tree.byId.get('c1'), '# 概览\n', tree.byId);
  await writeMetadata(workspace, SETTINGS, 'zh', emptyMetadata());
  await writeKnowledge(workspace, SETTINGS, 'zh', [{ module: 'm', title: 'M', summary: 's' }]);
  assert.equal(await hasContent(workspace, SETTINGS, 'zh'), true);
  assert.equal(await deleteIndex(workspace, SETTINGS, 'zh'), true);
  assert.equal(await hasContent(workspace, SETTINGS, 'zh'), false);
  assert.equal(existsSync(languageRoot(workspace, SETTINGS, 'zh')), false);
  assert.equal(existsSync(knowledgeRoot(workspace, SETTINGS, 'zh')), false);
});

/* ------------------------------------------------------------------------- *
 * Knowledge cards
 * ------------------------------------------------------------------------- */

test('knowledge cards write _index.yaml, _module.yaml and documents', async () => {
  const workspace = await tempWorkspace('rw-know-');
  const written = await writeKnowledge(workspace, SETTINGS, 'zh', [
    {
      module: 'core_config',
      title: 'LLM配置与密钥安全管理',
      files: ['core-config/'],
      summary: '负责配置持久化。',
      documents: { 架构设计: '## 概览\n内容' },
    },
  ]);
  assert.ok(written >= 3);
  const root = knowledgeRoot(workspace, SETTINGS, 'zh');
  const files = await readdir(root);
  assert.ok(files.includes('_index.yaml'));
  assert.ok(files.includes('core_config'));
  const index = await readFile(path.join(root, '_index.yaml'), 'utf8');
  assert.ok(index.startsWith('# 知识卡导出索引文件'));

  const cards = await readKnowledge(workspace, SETTINGS, 'zh');
  // One card per document file: the bare summary is `overview`, the
  // `架构设计` document maps back to `architecture_design`.
  assert.equal(cards.length, 2);
  const overview = cards.find((card) => card.category === 'overview');
  const arch = cards.find((card) => card.category === 'architecture_design');
  assert.equal(overview.module, 'core_config');
  assert.ok(overview.content.includes('配置持久化'));
  assert.equal(overview.id, 'core_config/overview');
  assert.ok(arch.content.includes('内容'));
});

test('renderModuleYaml quotes values that need it', () => {
  const yaml = renderModuleYaml({ module: 'm', title: 'a: b', files: [] }, 'm');
  assert.ok(yaml.includes('title: "a: b"'));
});

test('renderKnowledgeIndex handles an empty list', () => {
  const index = renderKnowledgeIndex([]);
  assert.ok(index.startsWith('# 知识卡导出索引文件'));
  assert.ok(index.includes('modules: {}'));
});

test('renderKnowledgeIndex matches Qoder\'s lMr shape', () => {
  const index = renderKnowledgeIndex(
    [{ module: 'src/core', modulePath: 'src/core', title: '核心', files: ['src/a.ts'] }],
    { commit: 'abc123', branch: 'main' },
    'zh',
  );
  assert.ok(index.startsWith('# 知识卡导出索引文件'));
  assert.ok(index.includes('schema_version: 1'));
  assert.ok(index.includes('locale: zh-cn'));
  assert.ok(index.includes('commit: abc123'));
  assert.ok(index.includes('nodes_managed: false'));
  // Modules are a map keyed by module path, with the Qoder field names.
  assert.ok(index.includes('  src/core:'));
  assert.ok(index.includes('dir_name: src_core'));
  assert.ok(index.includes('source_files: []'));
  assert.ok(index.includes('children: []'));
});

test('renderModuleYaml writes Qoder\'s uMr relation objects', () => {
  const yaml = renderModuleYaml(
    {
      module: 'core',
      modulePath: 'src/core',
      title: '核心',
      files: ['src/a.ts'],
      dependsOn: [{ path: 'src/dep', reason: '调用' }],
      relatedTo: ['src/sibling'],
    },
    'core',
  );
  assert.ok(yaml.includes('module_path: src/core'));
  assert.ok(yaml.includes('scope:'));
  assert.ok(yaml.includes('- src/a.ts'));
  // Relations are `{path, reason?}` objects, never bare strings.
  assert.ok(yaml.includes('- path: src/dep\n      reason: 调用'));
  assert.ok(yaml.includes('- path: src/sibling'));
  assert.ok(yaml.includes('version_of: []'));
  assert.ok(yaml.includes('similar_to: []'));
});

test('cardFileName is locale-sensitive like Qoder\'s wMr', () => {
  assert.equal(cardFileName('architecture_design', 'zh'), '架构设计');
  assert.equal(cardFileName('overview', 'zh'), '概述');
  assert.equal(cardFileName('coding_conventions', 'zh-CN'), '编码规范');
  // English and other locales keep the card type verbatim.
  assert.equal(cardFileName('architecture_design', 'en'), 'architecture_design');
  assert.equal(cardFileName('unknown_type', 'zh'), 'unknown_type');
});

test('writeKnowledge writes English card file names for en', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rw-knowledge-en-'));
  const written = await writeKnowledge(root, { dataDir: '.dsh' }, 'en', [
    {
      module: 'core',
      title: 'Core',
      files: ['a.ts'],
      documents: { overview: 'sum', architecture_design: 'arch' },
    },
  ], { commit: 'abc', branch: 'main' });
  assert.equal(written, 4, 'index + module.yaml + two cards');
  const module = await import('node:fs/promises').then((fsp) =>
    fsp.readdir(path.join(root, '.dsh', 'repowiki', 'knowledge', 'en', 'core')),
  );
  assert.ok(module.includes('_module.yaml'));
  assert.ok(module.includes('overview.md'), 'en keeps English card names');
  assert.ok(module.includes('architecture_design.md'));
  assert.ok(!module.includes('架构设计.md'), 'no Chinese names under en');
});

/* ------------------------------------------------------------------------- *
 * Concurrency
 * ------------------------------------------------------------------------- */

test('withLock serializes work on one key', async () => {
  const order = [];
  const work = (id, delay) =>
    withLock('same', async () => {
      order.push(`start-${id}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      order.push(`end-${id}`);
    });
  await Promise.all([work(1, 20), work(2, 1)]);
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2']);
});

test('concurrent metadata writes do not lose tables', async () => {
  const workspace = await tempWorkspace('rw-race-');
  const writes = Array.from({ length: 8 }, (_, i) => {
    const metadata = emptyMetadata();
    metadata.wiki_repo.id = `repo-${i}`;
    metadata.wiki_catalogs = [{ id: `c${i}`, name: `n${i}`, progress_status: 'completed' }];
    return writeMetadata(workspace, SETTINGS, 'zh', metadata);
  });
  await Promise.all(writes);
  const back = await readMetadata(workspace, SETTINGS, 'zh');
  // Exactly one write wins, and it is a complete document — never a blend.
  assert.equal(back.wiki_catalogs.length, 1);
  assert.match(back.wiki_repo.id, /^repo-\d$/u);
});

/* ------------------------------------------------------------------------- *
 * Qoder export parity (runs only when the sample export is present)
 * ------------------------------------------------------------------------- */

const QODER_SAMPLE = '/Users/veildawn/Documents/Projects/droid-claw/.qoder/repowiki/zh';

test('a real Qoder export is read with 100% path parity', async (t) => {
  if (!existsSync(path.join(QODER_SAMPLE, 'meta', 'repowiki-metadata.json'))) {
    t.skip('no local Qoder export to compare against');
    return;
  }
  const raw = JSON.parse(await readFile(path.join(QODER_SAMPLE, 'meta', 'repowiki-metadata.json'), 'utf8'));
  const tree = buildTree(raw);
  assert.ok(tree.order.length > 50, 'expected a substantial sample');
  let matched = 0;
  for (const node of tree.order) {
    const page = pagePath(node, tree.byId);
    if (existsSync(path.join(QODER_SAMPLE, 'content', page))) matched += 1;
  }
  assert.equal(matched, tree.order.length, 'every Qoder page path must resolve');

  // And a write-then-rebuild cycle must not disturb the structure.
  const metadata = emptyMetadata();
  metadata.wiki_repo.id = 'parity';
  applyTree(metadata, tree);
  const rebuilt = buildTree(metadata);
  assert.equal(rebuilt.order.length, tree.order.length);
  for (const node of tree.order) {
    assert.equal(rebuilt.byId.get(node.id).parent_id, node.parent_id, `parent changed for ${node.name}`);
  }
  assert.equal(flattenTree(rebuilt).length, tree.order.length);
});
