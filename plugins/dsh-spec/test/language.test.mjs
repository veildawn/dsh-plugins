/**
 * Language resolution: the DSH preference, its fallback chain, and the line the
 * Agent is told about the language documents are written in.
 *
 * Run: node --test test/language.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as language from '../lib/language.js';

test('language tags normalize to the two shipped languages', () => {
  assert.equal(language.normalizeLanguage('zh-CN'), 'zh');
  assert.equal(language.normalizeLanguage('zh_CN.UTF-8'), 'zh');
  assert.equal(language.normalizeLanguage('en-US'), 'en');
  assert.equal(language.normalizeLanguage('EN'), 'en');
  assert.equal(language.normalizeLanguage('fr-FR'), undefined);
  assert.equal(language.normalizeLanguage(''), undefined);
  assert.equal(language.normalizeLanguage(undefined), undefined);
});

test('the locale preference is read from the host profile patch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-spec-lang-'));
  const file = join(dir, 'cordis.patch.yml');
  await writeFile(file, [
    '# a comment that mentions locale: en must not count',
    '- id: ui-settings-general',
    '  name: "@deepseek-ai/dsh-client-ui-settings-general"',
    '  config:',
    '    welcomeNoticeVersion: 2026-09-28.1',
    '- id: locale',
    '  name: "@deepseek-ai/dsh-client-locale"',
    '  config:',
    '    preference: en',
    '- id: llm-pi-ai',
    '  name: "@deepseek-ai/dsh-llm-pi-ai"',
    '',
  ].join('\n'));
  assert.equal(language.readLocalePreference(file), 'en');
});

test('a profile that never switched language has no preference', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-spec-lang-'));
  const file = join(dir, 'cordis.patch.yml');
  // The locale plugin is mounted by the bundle, not by the profile patch, and
  // only a switch writes the entry — so an untouched profile has no answer.
  await writeFile(file, '- id: agent-default-model\n  name: "@deepseek-ai/dsh-agent-default-model"\n');
  assert.equal(language.readLocalePreference(file), undefined);
  assert.equal(language.readLocalePreference(join(dir, 'missing.yml')), undefined);
});

test('a commented-out preference is not a preference', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-spec-lang-'));
  const file = join(dir, 'cordis.patch.yml');
  await writeFile(file, '- id: locale\n  # preference: en\n  name: "@deepseek-ai/dsh-client-locale"\n');
  assert.equal(language.readLocalePreference(file), undefined);
});

test('resolution order is setting, then DSH, then the OS, then English', () => {
  assert.equal(language.resolveLanguage({ settings: { language: 'en' }, localePreference: 'zh', system: 'zh' }), 'en');
  assert.equal(language.resolveLanguage({ settings: { language: '' }, localePreference: 'zh', system: 'en' }), 'zh');
  // An empty setting is "follow DSH", not a language of its own.
  assert.equal(language.resolveLanguage({ settings: {}, localePreference: 'en', system: 'zh' }), 'en');
  assert.equal(language.resolveLanguage({ settings: {}, localePreference: undefined, system: 'zh' }), 'zh');
});

test('the OS language is read from the environment before the platform default', () => {
  assert.equal(language.systemLanguage('linux', { LANG: 'zh_CN.UTF-8' }), 'zh');
  assert.equal(language.systemLanguage('linux', { LC_ALL: 'en_US.UTF-8', LANG: 'zh_CN.UTF-8' }), 'en');
  // Nothing readable anywhere still answers with a shipped language.
  assert.ok(['zh', 'en'].includes(language.systemLanguage('linux', {})));
});

test('the prompt line names the language and keeps the format contract English', () => {
  const zh = language.languageInstruction('zh');
  assert.match(zh, /Simplified Chinese/u);
  // The skeleton stays English: translating `## Acceptance Criteria` would stop
  // the validator (and Kiro) from recognising the document.
  assert.match(zh, /`## Acceptance Criteria`/u);
  assert.match(zh, /`SHALL`/u);
  assert.doesNotMatch(zh, /Acceptance Criteria：|验收标准/u);
  const en = language.languageInstruction('en');
  assert.match(en, /Write all spec prose in English/u);
  assert.match(en, /`## Task Dependency Graph`/u);
});

test('the panel\'s report outranks the server\'s guess but not an explicit setting', () => {
  assert.equal(language.resolveLanguage({ settings: {}, panel: 'zh-CN', system: 'en' }), 'zh');
  // A pin is the one answer a user gave by name.
  assert.equal(language.resolveLanguage({ settings: { language: 'en' }, panel: 'zh' }), 'en');
  // An empty or unknown report falls through instead of forcing `en`.
  assert.equal(language.resolveLanguage({ settings: {}, panel: '', localePreference: 'zh', system: 'en' }), 'zh');
  assert.equal(language.resolveLanguage({ settings: {}, panel: 'fr-FR', system: 'zh' }), 'zh');
});
