/**
 * Markdown rendering tests.
 *
 * The Specs pane shows requirements.md / design.md / bugfix.md as Kiro wrote
 * them. Until 0.7.0 it dropped the raw text into a `<pre>`, so the user read
 * `## Overview` and `| --- |` instead of a document. These assertions pin the
 * replacement: the constructs Kiro's templates use become real elements, and
 * anything the renderer does not understand survives as text instead of being
 * silently dropped.
 *
 * The renderer is inlined in lib/client.js (the bundle is a classic script
 * registered through __ModuleLoader__, so it cannot import a sibling module),
 * hence this file loads the bundle the same way client.test.mjs does rather
 * than importing a module directly.
 *
 * Run: node --test test/markdown.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const react = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat().filter((child) => child !== null && child !== undefined && child !== false) };
  },
};

let registration = null;
globalThis.window = { __ModuleLoader__: { load: (entry) => { registration = entry; } } };
const styles = [];
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ setAttribute() {} }),
  head: { appendChild: (style) => styles.push(style) },
  body: { appendChild: (style) => styles.push(style) },
};

const clientPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'client.js');
// eslint-disable-next-line no-eval
(0, eval)(readFileSync(clientPath, 'utf8'));
const mod = registration.factory((id) => {
  if (id === 'react') return react;
  throw new Error(`unexpected require: ${id}`);
});
const { parseBlocks, parseInline, renderMarkdown } = mod.internals;

/** Concatenated text of a node tree. */
function textOf(nodes) {
  const walk = (node) => {
    if (node === null || node === undefined || node === false) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(walk).join(' ');
    return walk(node.children);
  };
  return walk(nodes).replace(/\s+/gu, ' ').trim();
}

/** Every node in a tree, depth first. */
function collect(nodes, predicate, out = []) {
  for (const node of Array.isArray(nodes) ? nodes : [nodes]) {
    if (node === null || node === undefined || typeof node !== 'object') continue;
    if (predicate(node)) out.push(node);
    collect(node.children, predicate, out);
  }
  return out;
}

const byTag = (tree, tag) => collect(tree, (node) => node.type === tag);

test('headings become headings, one level down from the document', () => {
  const tree = renderMarkdown('# Design\n\n## Overview\n\n### Data model\n');
  const headings = byTag(tree, 'h2').concat(byTag(tree, 'h3'), byTag(tree, 'h4'));
  assert.deepEqual(headings.map((node) => node.props['data-level']), ['1', '2', '3']);
  assert.deepEqual(headings.map((node) => textOf(node)), ['Design', 'Overview', 'Data model']);
  // The literal marker never survives into the page.
  assert.doesNotMatch(textOf(tree), /#/u);
});

test('a fenced block keeps its code verbatim, markers and all', () => {
  const tree = renderMarkdown('Intro\n\n```json\n{\n  "waves": [\n    { "id": 0, "tasks": ["1.1"] }\n  ]\n}\n```\n\nAfter\n');
  const pre = byTag(tree, 'pre');
  assert.equal(pre.length, 1);
  assert.equal(pre[0].props['data-lang'], 'json');
  assert.equal(pre[0].children[0].type, 'code');
  assert.equal(pre[0].children[0].children[0], '{\n  "waves": [\n    { "id": 0, "tasks": ["1.1"] }\n  ]\n}');
  assert.deepEqual(byTag(tree, 'p').map((node) => textOf(node)), ['Intro', 'After']);
});

test('a # inside a fence is never a heading', () => {
  const blocks = parseBlocks('```\n# not a heading\n```\n');
  assert.deepEqual(blocks.map((block) => block.kind), ['code']);
  assert.equal(blocks[0].text, '# not a heading');
});

test('an unclosed fence renders what it has instead of swallowing the rest silently', () => {
  const blocks = parseBlocks('```js\nconst a = 1;\n');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'code');
  assert.equal(blocks[0].text, 'const a = 1;');
});

test('tables become tables with their alignment', () => {
  const doc = '| Requirement | Status |\n| :--- | ---: |\n| 1.1 | done |\n| 1.2 | **open** |\n';
  const tree = renderMarkdown(doc);
  const table = byTag(tree, 'table')[0];
  assert.ok(table, 'a header row plus a delimiter row is a table');
  assert.deepEqual(byTag(tree, 'th').map((cell) => textOf(cell)), ['Requirement', 'Status']);
  assert.deepEqual(byTag(tree, 'th').map((cell) => cell.props.style?.textAlign), ['left', 'right']);
  const cells = byTag(tree, 'td');
  assert.deepEqual(cells.map((cell) => textOf(cell)), ['1.1', 'done', '1.2', 'open']);
  assert.equal(cells[3].children[0].type, 'strong', 'inline marks work inside cells');
  // The delimiter row must not appear as data.
  assert.doesNotMatch(textOf(tree), /---/u);
});

test('lists become lists and keep their order', () => {
  const doc = '- WHEN a user signs in\n- THEN the system SHALL respond in 2s\n\n1. First\n2. Second\n';
  const tree = renderMarkdown(doc);
  const ul = byTag(tree, 'ul')[0];
  const ol = byTag(tree, 'ol')[0];
  assert.deepEqual(ul.children.map((item) => textOf(item)), ['WHEN a user signs in', 'THEN the system SHALL respond in 2s']);
  assert.deepEqual(ol.children.map((item) => textOf(item)), ['First', 'Second']);
});

test('an indented list line continues its item instead of starting a new one', () => {
  const blocks = parseBlocks('- 2. Implement the core\n  and its tests\n- 3. Checkpoint\n');
  assert.deepEqual(blocks[0].items.map((item) => item.text), ['2. Implement the core and its tests', '3. Checkpoint']);
});

test('inline code wins over the emphasis rules inside it', () => {
  const tokens = parseInline('Use `a_b_c` and **Spec** text');
  assert.deepEqual(tokens.map((token) => token.type), ['text', 'code', 'text', 'strong', 'text']);
  assert.equal(tokens[1].text, 'a_b_c', 'underscores inside code stay literal');
  assert.equal(tokens[3].text, 'Spec');
});

test('the remark style Kiro writes under each task renders as emphasis', () => {
  const tokens = parseInline('_Requirements: 1.1, 2.3_');
  assert.deepEqual(tokens.map((token) => token.type), ['em']);
  assert.equal(tokens[0].text, 'Requirements: 1.1, 2.3');
});

test('links become anchors that open away from the app', () => {
  const tree = renderMarkdown('See [the spec](https://example.com/spec) for more.');
  const anchor = byTag(tree, 'a')[0];
  assert.equal(anchor.props.href, 'https://example.com/spec');
  assert.equal(anchor.props.rel, 'noreferrer noopener');
  assert.equal(anchor.props.target, '_blank');
  assert.equal(textOf(anchor), 'the spec');
});

test('a block quote and a rule are their own elements', () => {
  const tree = renderMarkdown('> Note: generated from requirements 1.2\n\n---\n');
  assert.equal(byTag(tree, 'blockquote').length, 1);
  assert.equal(textOf(byTag(tree, 'blockquote')), 'Note: generated from requirements 1.2');
  assert.equal(byTag(tree, 'hr').length, 1);
});

test('unknown syntax survives as text rather than being dropped', () => {
  // A document must never lose content because the renderer did not know a
  // token; losing a requirement silently is worse than showing it plainly.
  const doc = '::: callout\nDo not lose me\n:::\n\n~~~\nplain fence\n~~~\n';
  const text = textOf(renderMarkdown(doc));
  assert.match(text, /Do not lose me/u);
  assert.match(text, /plain fence/u);
});

test('nothing is rendered as raw HTML', () => {
  // The text is model-written: a stray tag must reach the page as characters.
  const tree = renderMarkdown('<img src=x onerror=alert(1)> and <b>bold</b>\n');
  assert.equal(byTag(tree, 'img').length, 0);
  assert.equal(byTag(tree, 'b').length, 0);
  assert.match(textOf(tree), /<img src=x onerror=alert\(1\)>/u);
});

test('an empty document renders nothing instead of an empty box', () => {
  assert.deepEqual(renderMarkdown(''), []);
  assert.deepEqual(renderMarkdown('  \n\n  \n'), []);
});
