/**
 * `wiki_plan.yaml` tests.
 *
 * Two things matter here: the parser must accept exactly the subset Qoder's own
 * schema uses (including the `|` block scalar its documentation puts in a
 * document's `template`), and it must never throw — a validation endpoint that
 * crashes on bad input is worse than one that says "invalid".
 *
 * Run: node --test test/plan.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PLAN_LIMITS,
  emptyPlanYaml,
  hasDocumentWhitelist,
  hasScope,
  parsePlan,
  parseYaml,
  renderPlanPrompt,
  renderPlanYaml,
  validatePlan,
} from '../lib/plan.js';

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

const SAMPLE = `version: 1

repowiki:
  template: architecture
  notes:
    - text: "文档应聚焦业务流程而非代码细节"
      author: "架构组"
  documents:
    - title: "系统架构概览"
      goal: "描述系统整体架构"
      parent: ""
    - title: "订单系统"
      goal: "说明订单全生命周期"
      parent: "系统架构概览"
      hints: "含状态机"
      template: |
        ## 订单模型
        ## 状态流转

knowledgecard:
  notes:
    - text: "重点建模支付和订单两个核心子系统"

scope:
  include:
    - "src/**"
  exclude:
    - "**/test/**"
`;

test('parses the documented sample', () => {
  const result = parsePlan(SAMPLE, '.dsh/repowiki/wiki_plan.yaml');
  assert.equal(result.valid, true, result.errorMessage);
  assert.equal(result.plan.repowiki.template, 'architecture');
  assert.equal(result.plan.repowiki.notes.length, 1);
  assert.equal(result.plan.repowiki.notes[0].author, '架构组');
  assert.equal(result.plan.repowiki.documents.length, 2);
  assert.equal(result.plan.repowiki.documents[1].parent, '系统架构概览');
  assert.equal(result.plan.repowiki.documents[1].template, '## 订单模型\n## 状态流转\n');
  assert.deepEqual(result.plan.scope.include, ['src/**']);
  assert.deepEqual(result.plan.scope.exclude, ['**/test/**']);
});

test('an empty or absent plan is valid and unconstraining', () => {
  const result = parsePlan('');
  assert.equal(result.valid, true);
  assert.equal(hasDocumentWhitelist(result.plan), false);
  assert.equal(hasScope(result.plan), false);
  assert.equal(renderPlanPrompt(result.plan), '');
});

test('Qoder warn-normalizes recoverable problems instead of rejecting', () => {
  const cases = [
    ['unknown top-level key', 'version: 1\nbogus: 2\n', /bogus.*ignored/u],
    ['unknown template', 'repowiki:\n  template: nope\n', /template.*ignored/u],
    ['duplicate document title', 'repowiki:\n  documents:\n    - title: A\n      goal: g\n    - title: A\n      goal: g2\n', /duplicate/u],
    ['orphan parent', 'repowiki:\n  documents:\n    - title: A\n      goal: g\n      parent: Nope\n', /parent.*top level/u],
    ['cyclic parents', 'repowiki:\n  documents:\n    - title: A\n      goal: g\n      parent: B\n    - title: B\n      goal: g\n      parent: A\n', /cyclic/u],
    ['non-number version', 'version: "1"\n', /version.*not a number/u],
    ['goal-less document', 'repowiki:\n  documents:\n    - title: A\n', /goal is empty/u],
  ];
  for (const [label, source, pattern] of cases) {
    let result;
    assert.doesNotThrow(() => {
      result = parsePlan(source);
    }, `${label} threw`);
    assert.equal(result.valid, true, `${label} should still be valid: ${result.errorMessage}`);
    assert.equal(result.rejection, null, `${label} should not reject`);
    assert.ok(
      result.diagnostics.some((line) => pattern.test(line)),
      `${label} should warn — diagnostics: ${JSON.stringify(result.diagnostics)}`,
    );
  }
});

test('duplicate titles keep the first document', () => {
  const result = parsePlan('repowiki:\n  documents:\n    - title: A\n      goal: first\n    - title: A\n      goal: second\n');
  assert.equal(result.valid, true);
  assert.equal(result.plan.repowiki.documents.length, 1);
  assert.equal(result.plan.repowiki.documents[0].goal, 'first');
});

test('still refuses what Qoder refuses: size, syntax, non-mapping', () => {
  const cases = [
    ['flow collection', 'repowiki: {a: 1}\n', 'syntax_error'],
    ['anchor', 'version: &x 1\n', 'syntax_error'],
    ['duplicate key', 'version: 1\nversion: 2\n', 'syntax_error'],
    ['not a mapping', '- a\n- b\n', 'not_a_mapping'],
  ];
  for (const [label, source, rejection] of cases) {
    let result;
    assert.doesNotThrow(() => {
      result = parsePlan(source);
    }, `${label} threw`);
    assert.equal(result.valid, false, `${label} should be invalid`);
    assert.equal(result.rejection, rejection, `${label} rejection`);
    assert.ok(result.errorMessage.length > 0, `${label} should explain why`);
  }

  const tooLarge = `version: 1\nrepowiki:\n  notes:\n    - text: ${'x'.repeat(PLAN_LIMITS.bytes)}\n`;
  const result = parsePlan(tooLarge);
  assert.equal(result.valid, false);
  assert.equal(result.rejection, 'too_large');
});

test('enforces the Qoder limits by truncating with a warning', () => {
  const manyNotes = `version: 1\nrepowiki:\n  notes:\n${Array.from({ length: PLAN_LIMITS.notes + 1 }, (_, i) => `    - text: n${i}`).join('\n')}\n`;
  const notes = parsePlan(manyNotes);
  assert.equal(notes.valid, true);
  assert.equal(notes.plan.repowiki.notes.length, PLAN_LIMITS.notes);
  assert.ok(notes.diagnostics.some((line) => /truncated to 50/u.test(line)));

  const manyDocs = `version: 1\nrepowiki:\n  documents:\n${Array.from({ length: PLAN_LIMITS.documents + 1 }, (_, i) => `    - title: t${i}\n      goal: g${i}`).join('\n')}\n`;
  const docs = parsePlan(manyDocs);
  assert.equal(docs.valid, true);
  assert.equal(docs.plan.repowiki.documents.length, PLAN_LIMITS.documents);

  const longTitle = `version: 1\nrepowiki:\n  documents:\n    - title: ${'x'.repeat(PLAN_LIMITS.titleChars + 1)}\n      goal: g\n`;
  const title = parsePlan(longTitle);
  assert.equal(title.valid, true);
  assert.equal(title.plan.repowiki.documents[0].title.length, PLAN_LIMITS.titleChars);
  assert.ok(title.diagnostics.some((line) => /truncated/u.test(line)));
});

test('documents deeper than one level are re-parented, not rejected', () => {
  const source = 'version: 1\nrepowiki:\n  documents:\n    - title: A\n      goal: g\n    - title: B\n      goal: g\n      parent: A\n    - title: C\n      goal: g\n      parent: B\n';
  const result = parsePlan(source);
  assert.equal(result.valid, true);
  const byTitle = new Map(result.plan.repowiki.documents.map((document) => [document.title, document]));
  assert.equal(byTitle.get('B').parent, 'A');
  assert.equal(byTitle.get('C').parent, '', 'C is two levels deep and must be promoted');
});

test('block scalars are read verbatim, comments and all', () => {
  const source = 'version: 1\nrepowiki:\n  documents:\n    - title: A\n      goal: g\n      template: |\n        ## One\n        ## Two # not a comment\n';
  const result = parsePlan(source);
  assert.equal(result.valid, true, result.errorMessage);
  assert.equal(result.plan.repowiki.documents[0].template, '## One\n## Two # not a comment\n');
});

test('folded scalars join lines', () => {
  const source = 'version: 1\nrepowiki:\n  documents:\n    - title: A\n      goal: g\n      template: >\n        one\n        two\n';
  assert.equal(parsePlan(source).plan.repowiki.documents[0].template, 'one two\n');
});

test('presets inject Qoder\'s own guidance', () => {
  const architecture = validatePlan({ version: 1, repowiki: { template: 'architecture' } }).plan;
  assert.match(renderPlanPrompt(architecture), /Comprehensively analyse/u);
  const product = validatePlan({ version: 1, repowiki: { template: 'product_requirement' } }).plan;
  assert.match(renderPlanPrompt(product), /产品概述/u);
  assert.match(renderPlanPrompt(product), /关键约束与边界/u);
});

test('a document whitelist is rendered as strict', () => {
  const { plan } = validatePlan({
    version: 1,
    repowiki: { documents: [{ title: 'A', goal: 'ga' }, { title: 'B', parent: 'A', goal: 'gb' }] },
  });
  const prompt = renderPlanPrompt(plan);
  assert.match(prompt, /strict whitelist/u);
  assert.match(prompt, /child of "A"/u);
});

test('the empty plan scaffold round-trips', () => {
  const scaffold = emptyPlanYaml();
  const result = parsePlan(scaffold);
  assert.equal(result.valid, true, result.errorMessage);
  assert.equal(result.plan.repowiki.documents.length, 0);
});

test('a top level that is not a mapping is a not_a_mapping rejection', () => {
  const { plan, rejection, diagnostics } = validatePlan(parseYaml('- a\n- b\n'));
  assert.equal(rejection, 'not_a_mapping');
  assert.equal(plan.repowiki.documents.length, 0);
  assert.ok(diagnostics.length > 0);
});

/* ------------------------------------------------------------------------- *
 * Property 5: render/parse round-trip, and never throwing on bad input.
 * ------------------------------------------------------------------------- */

test('Property 5: render → parse is identity for generated plans', () => {
  const random = mulberry32(0x1234);
  const words = ['架构', 'payment', 'a:b', '#hash', 'with space', 'quote"s', "single'", 'dash-', '-lead', '42'];
  const pick = (list) => list[Math.floor(random() * list.length)];

  for (let iteration = 0; iteration < 100; iteration += 1) {
    const documentCount = 1 + Math.floor(random() * 4);
    const titles = Array.from({ length: documentCount }, (_, i) => `${pick(words)}-${i}`);
    const documents = titles.map((title, index) => ({
      title,
      goal: `goal-${index}-${pick(words)}`,
      parent: index > 0 && random() < 0.5 ? titles[0] : '',
      hints: random() < 0.4 ? pick(words) : '',
      template: random() < 0.3 ? `## ${pick(words)}\n` : '',
    }));
    const { plan } = validatePlan({
      version: 1,
      repowiki: {
        template: random() < 0.5 ? 'architecture' : '',
        notes: random() < 0.5 ? [{ text: pick(words), author: pick(words) }] : [],
        documents,
      },
      knowledgecard: { notes: [] },
      scope: {
        include: random() < 0.5 ? [pick(words)] : [],
        exclude: random() < 0.5 ? [pick(words)] : [],
      },
    });
    const rendered = renderPlanYaml(plan);
    const reparsed = parsePlan(rendered);
    assert.equal(reparsed.valid, true, `round-trip failed for ${JSON.stringify(plan)}: ${reparsed.errorMessage}`);
    assert.deepEqual(reparsed.plan, plan, `round-trip changed the plan:\n${rendered}`);
  }
});

test('Property 5b: parsePlan never throws on arbitrary text', () => {
  const random = mulberry32(0x9999);
  const alphabet = 'abc :|-{}\n\t"\'#[]&*!>0123456789中文';
  for (let iteration = 0; iteration < 300; iteration += 1) {
    let source = '';
    const length = Math.floor(random() * 120);
    for (let i = 0; i < length; i += 1) {
      source += alphabet[Math.floor(random() * alphabet.length)];
    }
    let result;
    assert.doesNotThrow(() => {
      result = parsePlan(source);
    }, `threw on ${JSON.stringify(source)}`);
    assert.equal(typeof result.valid, 'boolean');
    if (result.valid === false) {
      assert.ok(result.errorMessage.length > 0);
    }
  }
});
