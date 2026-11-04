/**
 * Localized findings.
 *
 * The panel renders Chinese copy while the Agent keeps reading English; both
 * come from the same finding, so neither can drift into a different fact.
 *
 * Run: node --test test/messages.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { ZH, localizeIssue, localizeIssues } from '../lib/messages.js';
import { checkSpec, loadSpec } from '../lib/model.js';
import { lintRequirementsSemantics } from '../lib/validate.js';

test('every issue producer has a Chinese entry for its rule', async () => {
  // A rule with no translation silently falls back to English, which is a
  // missing string rather than a bug — so the sweep is what keeps the two
  // lists honest as rules are added.
  const rules = new Set(Object.keys(ZH));
  const issues = lintRequirementsSemantics([
    '### Requirement 1: Login',
    '#### Acceptance Criteria',
    '1. The login page handles the form and supports retries and manages state',
    '2. WHEN the user submits, the form validates.',
  ].join('\n'));
  assert.ok(issues.length >= 3);
  for (const issue of issues) {
    assert.ok(rules.has(issue.rule), `${issue.rule} has no zh copy`);
    const zh = localizeIssue(issue, 'zh');
    assert.notEqual(zh, issue.message, `${issue.rule} did not localize`);
    // Holes are filled, never left as `{where}`.
    assert.doesNotMatch(zh, /\{\w+\}/u);
  }
});

test('a finding without a translation falls back to its English message', () => {
  const issue = { severity: 'info', rule: 'not/a-real-rule', message: 'Something happened.' };
  assert.equal(localizeIssue(issue, 'zh'), 'Something happened.');
  assert.equal(localizeIssue(issue, 'en'), 'Something happened.');
});

test('English keeps the producer’s sentence verbatim', () => {
  const issue = { severity: 'warning', rule: 'requirements/missing-introduction', message: 'Missing required section: ## Introduction' };
  assert.equal(localizeIssue(issue, 'en'), 'Missing required section: ## Introduction');
  // English returns the list untouched (same reference): localization must not
  // churn objects the panel already holds.
  const list = [issue];
  assert.equal(localizeIssues(list, 'en'), list);
});

test('localizing never mutates the issue it was given', () => {
  const issue = { severity: 'warning', rule: 'requirements/missing-introduction', message: 'Missing required section: ## Introduction' };
  const before = JSON.stringify(issue);
  localizeIssues([issue], 'zh');
  assert.equal(JSON.stringify(issue), before);
});

test('document names and headings stay verbatim inside Chinese copy', () => {
  const issue = { severity: 'warning', rule: 'spec/missing-document', message: 'Document not written yet: design.md', params: { file: 'design.md' } };
  assert.equal(localizeIssue(issue, 'zh'), '文档尚未编写：design.md');
  const heading = { severity: 'error', rule: 'design/missing-overview', message: 'Missing required section: ## Overview' };
  assert.match(localizeIssue(heading, 'zh'), /## Overview/u);
});

test('the five compound-criterion hints the user saw read as one sentence in Chinese', () => {
  // The exact finding the panel showed five times: "contains multiple SHALL
  // clauses; consider splitting it". In Chinese it must name the clause and
  // say what to do.
  const issue = { severity: 'info', rule: 'ears/compound-criterion', message: 'Requirement 5, criterion 3 contains multiple SHALL clauses; consider splitting it', params: { where: 'Requirement 5, criterion 3', requirement: '5', criterion: '3' } };
  const zh = localizeIssue(issue, 'zh');
  // The location is Chinese too: a translated sentence wrapping an English
  // "Requirement 5, criterion 3" is exactly the half-translated state this
  // rule was fixed for.
  assert.equal(zh, '第 5 条需求第 3 项含多个 SHALL 子句，建议拆分');
  assert.doesNotMatch(zh, /Requirement|criterion|contains multiple/u);

  // A finding written before the structured fields existed still localizes,
  // with its English location left as the only thing that stays English.
  const legacy = { ...issue, params: { where: 'Requirement 5, criterion 3' } };
  assert.equal(localizeIssue(legacy, 'zh'), 'Requirement 5, criterion 3含多个 SHALL 子句，建议拆分');
});
