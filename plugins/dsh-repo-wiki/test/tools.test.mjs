/**
 * Agent tool tests.
 *
 * The six `*_wiki` tools are thin wrappers over `lib/ops.js`, so these tests
 * exercise the real code path a Repo Wiki session hits: register the tools in a
 * fake preset scope, call them through `execute`, and assert on both the
 * structured value and the rendered text the model sees.
 *
 * Run: node --test test/tools.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DSH_HOME = await mkdtemp(path.join(tmpdir(), 'rw-tools-home-'));

const preset = await import('../lib/tools.js');
const ops = await import('../lib/ops.js');
const { TOOL_NAMES } = await import('../lib/constants.js');

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

/** Build a preset-scope context that captures tools, sections and contexts. */
async function mountPreset(options = {}) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'rw-tools-ws-'));
  await writeFile(path.join(workspace, 'README.md'), '# Demo');
  const tools = new Map();
  const sections = [];
  const contexts = [];
  const warnings = [];
  const promptService = {
    section: (section) => {
      sections.push(section);
      return () => {};
    },
    context: (context) => {
      contexts.push(context);
      return () => {};
    },
  };
  const ctx = {
    tools: {
      register: (definition) => {
        tools.set(definition.name, definition);
        return () => {};
      },
    },
    get: (key) => {
      if (key === 'workspaceRegistry') return { list: () => [{ path: workspace }] };
      if (key === 'systemPrompt') return options.noPrompt === true ? undefined : promptService;
      return undefined;
    },
    inject: () => {},
    on: () => {},
    logger: { warn: (message) => warnings.push(message) },
  };
  preset.apply(ctx, { prompt: { enabled: true, maxCatalogs: 40 } });
  const exec = { agent: { session: { header: { cwd: workspace } } } };
  return { workspace, tools, sections, contexts, warnings, exec, ctx };
}

/* ------------------------------------------------------------------------- *
 * Registration
 * ------------------------------------------------------------------------- */

test('mounting registers exactly the six wiki tools', async () => {
  const { tools } = await mountPreset();
  assert.deepEqual(
    [...tools.keys()].sort(),
    [TOOL_NAMES.delete, TOOL_NAMES.edit, TOOL_NAMES.list, TOOL_NAMES.read, TOOL_NAMES.search, TOOL_NAMES.write].sort(),
  );
  for (const [name, definition] of tools) {
    assert.equal(definition.name, name);
    assert.equal(typeof definition.execute, 'function');
    assert.equal(typeof definition.output.render, 'function');
    assert.equal(definition.output.schema.type, 'object');
    assert.ok(typeof definition.description === 'string' && definition.description.length > 40, `${name} needs a description`);
  }
});

test('the prompt contributions use the agreed orders', async () => {
  const { sections, contexts } = await mountPreset();
  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, 'repo-wiki-policy');
  assert.equal(sections[0].order, 186);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].name, 'repo-wiki-catalog');
  assert.equal(contexts[0].order, 651);
});

test('a preset without a prompt registry still loads its tools', async () => {
  // A composition may mount this half without `dsh-system-prompt`. The tools are
  // the contract; the prompt section is a bonus. Activation must not throw.
  const { tools } = await mountPreset({ noPrompt: true });
  assert.equal(tools.size, 6);
});

test('a preset with neither a registry nor inject() records a diagnostic', async () => {
  const tools = new Map();
  const warnings = [];
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
    get: () => undefined,
    // No `inject` at all: the late-binding path is unavailable.
    on: () => {},
    logger: { warn: (message) => warnings.push(message) },
  };
  preset.apply(ctx, {});
  assert.equal(tools.size, 6);
  assert.ok(warnings.some((message) => message.includes('systemPrompt')));
});

test('the policy text names the three read tools', () => {
  assert.ok(preset.WIKI_POLICY_TEXT.includes('list_wiki'));
  assert.ok(preset.WIKI_POLICY_TEXT.includes('read_wiki'));
  assert.ok(preset.WIKI_POLICY_TEXT.includes('search_wiki'));
});

test('the catalog context is empty before a wiki exists', async () => {
  const { contexts, exec } = await mountPreset();
  const text = contexts[0].text({ agent: exec.agent });
  assert.equal(typeof text, 'string');
  assert.equal(text, '');
});

/* ------------------------------------------------------------------------- *
 * Tool behaviour
 * ------------------------------------------------------------------------- */

test('list_wiki reports an empty wiki rather than failing', async () => {
  const { tools, exec } = await mountPreset();
  const value = await tools.get(TOOL_NAMES.list).execute({}, exec);
  assert.equal(value.generated, false);
  assert.deepEqual(value.catalogs, []);
  assert.deepEqual(value.Files, []);
  const rendered = tools.get(TOOL_NAMES.list).output.render({}, value)[0].text;
  assert.match(rendered, /No Repo Wiki/u);
});

test('write → list → read → search → edit → delete round-trips', async () => {
  const { tools, exec } = await mountPreset();

  const written = await tools.get(TOOL_NAMES.write).execute(
    { title: '快速开始', content: '## 简介\n这是正文。', references: ['README.md'] },
    exec,
  );
  assert.equal(written.created, true);
  assert.equal(written.path, '快速开始.md');

  const listed = await tools.get(TOOL_NAMES.list).execute({}, exec);
  assert.equal(listed.generated, true);
  assert.equal(listed.catalogs.length, 1);
  assert.equal(listed.catalogs[0].title, '快速开始');
  assert.deepEqual(listed.Files, [{ catalog_id: written.catalog_id, title: '快速开始', path: '快速开始.md' }]);

  const read = await tools.get(TOOL_NAMES.read).execute({ catalog_id: written.catalog_id }, exec);
  assert.equal(read.title, '快速开始');
  assert.ok(read.content.includes('这是正文。'));
  assert.deepEqual(read.references, ['README.md']);

  const byTitle = await tools.get(TOOL_NAMES.read).execute({ title: '快速开始' }, exec);
  assert.equal(byTitle.catalog_id, written.catalog_id);

  const found = await tools.get(TOOL_NAMES.search).execute({ query: '正文' }, exec);
  assert.equal(found.results.length, 1);
  assert.equal(found.results[0].catalog_id, written.catalog_id);
  assert.ok(found.results[0].snippet.includes('正文'));

  const edited = await tools.get(TOOL_NAMES.edit).execute(
    { catalog_id: written.catalog_id, content: '## 改过\n新内容' },
    exec,
  );
  assert.equal(edited.wholePage, true);
  const reread = await tools.get(TOOL_NAMES.read).execute({ catalog_id: written.catalog_id }, exec);
  assert.ok(reread.content.includes('新内容'));
  assert.equal(reread.content.includes('这是正文。'), false);

  const deleted = await tools.get(TOOL_NAMES.delete).execute({ catalog_id: written.catalog_id }, exec);
  assert.deepEqual(deleted.deleted, [written.catalog_id]);
  const after = await tools.get(TOOL_NAMES.list).execute({}, exec);
  assert.equal(after.generated, false);
});

test('a nested page lands in its category directory', async () => {
  const { tools, exec } = await mountPreset();
  const parent = await tools.get(TOOL_NAMES.write).execute({ title: '架构', content: '## 总览\nx' }, exec);
  const child = await tools.get(TOOL_NAMES.write).execute(
    { title: '模块', content: '## 细节\ny', parent_id: parent.catalog_id },
    exec,
  );
  assert.equal(child.path, '架构/模块.md');
  // The parent's own page moved into the new directory.
  const reread = await tools.get(TOOL_NAMES.read).execute({ catalog_id: parent.catalog_id }, exec);
  assert.ok(reread.content.includes('总览'));
});

test('search_wiki returns one hit per page', async () => {
  const { tools, exec } = await mountPreset();
  await tools.get(TOOL_NAMES.write).execute({ title: 'A', content: '## X\nneedle\nneedle again' }, exec);
  await tools.get(TOOL_NAMES.write).execute({ title: 'B', content: '## Y\nno match' }, exec);
  const found = await tools.get(TOOL_NAMES.search).execute({ query: 'needle' }, exec);
  assert.equal(found.results.length, 1);
});

test('read_wiki with an unknown id raises catalog-not-found', async () => {
  const { tools, exec } = await mountPreset();
  await assert.rejects(
    () => tools.get(TOOL_NAMES.read).execute({ catalog_id: 'nope' }, exec),
    (error) => error.code === 'catalog-not-found',
  );
});

test('write_wiki refuses empty content', async () => {
  const { tools, exec } = await mountPreset();
  await assert.rejects(
    () => tools.get(TOOL_NAMES.write).execute({ title: 'X', content: '   ' }, exec),
    (error) => typeof error.code === 'string',
  );
});

/* ------------------------------------------------------------------------- *
 * Property 10: an ambiguous edit is refused.
 * ------------------------------------------------------------------------- */

test('Property 10: edit_wiki only applies a unique match', async () => {
  const { tools, exec } = await mountPreset();
  const written = await tools.get(TOOL_NAMES.write).execute(
    { title: '页', content: '## A\nalpha\n## B\nalpha' },
    exec,
  );
  await assert.rejects(
    () => tools.get(TOOL_NAMES.edit).execute({ catalog_id: written.catalog_id, find: 'alpha', replace: 'beta' }, exec),
    (error) => error.code === 'ambiguous-edit',
  );
  const all = await tools.get(TOOL_NAMES.edit).execute(
    { catalog_id: written.catalog_id, find: 'alpha', replace: 'beta', all: true },
    exec,
  );
  assert.equal(all.replacements, 2);
  const reread = await tools.get(TOOL_NAMES.read).execute({ catalog_id: written.catalog_id }, exec);
  assert.equal(reread.content.includes('alpha'), false);

  // A unique match still applies without `all`.
  const unique = await tools.get(TOOL_NAMES.edit).execute(
    { catalog_id: written.catalog_id, find: '## A', replace: '## 甲' },
    exec,
  );
  assert.equal(unique.replacements, 1);
});

/* ------------------------------------------------------------------------- *
 * Property 11: delete cascades over the whole subtree.
 * ------------------------------------------------------------------------- */

test('Property 11: delete_wiki removes exactly the subtree', async () => {
  const { tools, exec } = await mountPreset();
  const root = await tools.get(TOOL_NAMES.write).execute({ title: '根', content: '## A\n1' }, exec);
  const child = await tools.get(TOOL_NAMES.write).execute(
    { title: '子', content: '## B\n2', parent_id: root.catalog_id },
    exec,
  );
  const grandchild = await tools.get(TOOL_NAMES.write).execute(
    { title: '孙', content: '## C\n3', parent_id: child.catalog_id },
    exec,
  );
  const sibling = await tools.get(TOOL_NAMES.write).execute({ title: '兄弟', content: '## D\n4' }, exec);

  const deleted = await tools.get(TOOL_NAMES.delete).execute({ catalog_id: root.catalog_id }, exec);
  assert.deepEqual(
    deleted.deleted.sort(),
    [root.catalog_id, child.catalog_id, grandchild.catalog_id].sort(),
  );
  const remaining = await tools.get(TOOL_NAMES.list).execute({}, exec);
  assert.deepEqual(remaining.catalogs.map((catalog) => catalog.title), ['兄弟']);
  assert.ok(sibling.catalog_id);
});

test('delete_wiki with cascade:false keeps the children', async () => {
  const { tools, exec } = await mountPreset();
  const root = await tools.get(TOOL_NAMES.write).execute({ title: '根', content: '## A\n1' }, exec);
  await tools.get(TOOL_NAMES.write).execute({ title: '子', content: '## B\n2', parent_id: root.catalog_id }, exec);
  const deleted = await tools.get(TOOL_NAMES.delete).execute({ catalog_id: root.catalog_id, cascade: false }, exec);
  assert.deepEqual(deleted.deleted, [root.catalog_id]);
  const remaining = await tools.get(TOOL_NAMES.list).execute({}, exec);
  assert.deepEqual(remaining.catalogs.map((catalog) => catalog.title), ['子']);
});

/* ------------------------------------------------------------------------- *
 * Property 12: search hits always contain the query.
 * ------------------------------------------------------------------------- */

test('Property 12: every search snippet contains the query, one hit per page', async () => {
  const { tools, exec } = await mountPreset();
  const random = mulberry32(0x1357);
  const words = ['alpha', 'beta', 'gamma', '架构', '模块'];
  for (let i = 0; i < 6; i += 1) {
    const word = words[Math.floor(random() * words.length)];
    await tools.get(TOOL_NAMES.write).execute(
      { title: `页${i}`, content: `## 小节\n${word} 内容 ${i}` },
      exec,
    );
  }
  for (const query of words) {
    const found = await tools.get(TOOL_NAMES.search).execute({ query }, exec);
    const ids = found.results.map((hit) => hit.catalog_id);
    assert.equal(new Set(ids).size, ids.length, 'one hit per page');
    for (const hit of found.results) {
      assert.ok(
        hit.snippet.toLowerCase().includes(query.toLowerCase()),
        `snippet for "${query}" does not contain it: ${hit.snippet}`,
      );
    }
  }
});

test('snippetAround windows long text', () => {
  const text = 'x'.repeat(200) + 'needle' + 'y'.repeat(200);
  const snippet = ops.snippetAround(text, 200, 6, 10);
  assert.ok(snippet.includes('needle'));
  assert.ok(snippet.startsWith('…'));
  assert.ok(snippet.endsWith('…'));
});

test('countOccurrences counts non-overlapping matches', () => {
  assert.equal(ops.countOccurrences('aaaa', 'aa'), 2);
  assert.equal(ops.countOccurrences('abc', 'z'), 0);
  assert.equal(ops.countOccurrences('abc', ''), 0);
});
