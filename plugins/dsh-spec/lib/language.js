/**
 * dsh-spec — UI language.
 *
 * One language drives the whole feature: the Web panel, the validator's
 * findings, and the language the Agent is told to *write* the documents in.
 * The DSH Web client keeps its choice in the `locale` plugin's settings
 * namespace (`locale.preference`, "zh"/"en"), and that is the only place it
 * lives — the host does not publish it over RPC. This module reads it the way
 * the host writes it (the profile patch), so the server half follows a switch
 * in Settings → General without any wiring between the two halves.
 *
 * Resolution order, highest first:
 *
 *   1. an explicit `language` in the plugin's own settings (power users),
 *   2. the host's `locale.preference` (what the user picked in DSH),
 *   3. the OS locale (`AppleLocale` / `LANG` / `Intl`),
 *   4. English.
 *
 * Nothing here is cached: the panel asks again on every settings save, and the
 * prompt provider re-reads per assembly, so a language switch reaches the very
 * next model step.
 *
 * @module dsh-spec/language
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Languages the plugin ships copy for. */
export const LANGUAGES = ['zh', 'en'];

/** Short name of a language, for the prompt and the UI. */
export const LANGUAGE_NAME = { zh: 'Chinese', en: 'English' };

/** Normalize anything language-shaped ("zh-CN", "zh_CN.UTF-8") to "zh"/"en". */
export function normalizeLanguage(value) {
  if (typeof value !== 'string') return undefined;
  const tag = value.trim().toLowerCase();
  if (tag === '') return undefined;
  if (tag.startsWith('zh') || tag.startsWith('cn')) return 'zh';
  if (tag.startsWith('en')) return 'en';
  return undefined;
}

/**
 * Read the host locale preference from a profile's `cordis.patch.yml`.
 *
 * The DSH client locale plugin persists the switch as an entry patch
 * (`- id: locale` / `config: {preference: zh}`); before the first switch there
 * is no entry at all and the browser decides, which is why this is one step in
 * the chain and not the answer. Deliberately a line scanner: the file is
 * user-edited YAML whose comments and ordering must survive, so it is read,
 * never rewritten, and a malformed tail yields "no preference" rather than an
 * exception.
 *
 * @param {string} file - absolute path to the profile patch.
 * @returns {'zh'|'en'|undefined}
 */
export function readLocalePreference(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  const rows = text.replace(/\r\n?/gu, '\n').split('\n');
  let inLocaleEntry = false;
  for (const row of rows) {
    if (/^\s*#/u.test(row) || row.trim() === '') continue;
    // A top-level list item starts the next entry: stop once the locale entry ends.
    const entry = /^-\s+id:\s*['"]?([^'"\s]+)['"]?\s*$/u.exec(row);
    if (entry !== null) {
      inLocaleEntry = entry[1] === 'locale';
      continue;
    }
    if (!inLocaleEntry) continue;
    const preference = /^\s+preference:\s*['"]?([^'"\s#]+)['"]?/u.exec(row);
    if (preference !== null) return normalizeLanguage(preference[1]);
  }
  return undefined;
}

/** The OS language, read where each platform actually keeps it. */
export function systemLanguage(platform = process.platform, env = process.env) {
  const variables = [env.LC_ALL, env.LC_MESSAGES, env.LANG];
  for (const value of variables) {
    const language = normalizeLanguage(value);
    if (language !== undefined) return language;
  }
  if (platform === 'darwin') {
    // `LANG` is routinely unset in the launchd environment the Web service runs
    // in, while macOS keeps the user's choice in the global preferences domain.
    try {
      const plist = path.join(env.HOME ?? '', 'Library', 'Preferences', '.GlobalPreferences.plist');
      const text = readFileSync(plist, 'utf8');
      const match = /<key>AppleLocale<\/key>\s*<string>([^<]+)<\/string>/u.exec(text);
      if (match !== null) {
        const language = normalizeLanguage(match[1]);
        if (language !== undefined) return language;
      }
    } catch {
      // no readable global preferences: fall through
    }
  }
  try {
    const resolved = new Intl.DateTimeFormat().resolvedOptions().locale;
    const language = normalizeLanguage(resolved);
    if (language !== undefined) return language;
  } catch {
    // no ICU data
  }
  return 'en';
}

/**
 * The active language, from the resolved chain.
 *
 * @param {{settings?: {language?: string}, localePreference?: string, system?: string}} input
 * @returns {'zh'|'en'}
 */
export function resolveLanguage(input = {}) {
  return normalizeLanguage(input.settings?.language)
    ?? normalizeLanguage(input.localePreference)
    ?? normalizeLanguage(input.system)
    ?? systemLanguage();
}

/**
 * The one line the Agent is told about language.
 *
 * The policy section is English (it is a contract, not prose), but the
 * documents are the user's: they read them, quote them, and diff them. Saying
 * so explicitly is what makes an Agent that has been writing Chinese specs all
 * session switch the moment the UI does. Heading structure, EARS keywords and
 * `## Task Dependency Graph` stay in English — they are the format the
 * validator and Kiro both match on, and translating them would break the
 * contract rather than localize it.
 *
 * @param {'zh'|'en'} language
 * @returns {string}
 */
export function languageInstruction(language) {
  if (language === 'zh') {
    return 'Write all spec prose in Simplified Chinese: introduction, glossary, user stories, requirement titles and acceptance criteria, design sections, task titles and notes. Keep the document skeleton in English exactly as specified — every heading (`## Introduction`, `## Acceptance Criteria`, `### Requirement N:`, `## Task Dependency Graph` …), the EARS keywords (`WHEN`, `WHILE`, `IF`, `WHERE`, `THE`, `SHALL`), `**User Story:**`, `**Validates: Requirements X.Y**`, `_Requirements: X.Y_`, and the JSON wave graph. Chinese punctuation is fine inside a Chinese sentence.';
  }
  return 'Write all spec prose in English: introduction, glossary, user stories, requirement titles and acceptance criteria, design sections, task titles and notes. Keep the document skeleton exactly as specified — every heading (`## Introduction`, `## Acceptance Criteria`, `### Requirement N:`, `## Task Dependency Graph` …), the EARS keywords (`WHEN`, `WHILE`, `IF`, `WHERE`, `THE`, `SHALL`), `**User Story:**`, `**Validates: Requirements X.Y**`, `_Requirements: X.Y_`, and the JSON wave graph.';
}
