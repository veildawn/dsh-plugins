/**
 * DSH language resolution for host-side text (copied from dsh-spec/lib/language.js):
 * the profile's `locale.preference`, then LC_ALL/LC_MESSAGES/LANG, then macOS
 * AppleLocale, then ICU, then English.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
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

/**
 * macOS' `AppleLocale` (e.g. `zh_CN`), or `undefined`.
 *
 * The global preferences file is a *binary* plist on every modern macOS, so
 * reading it as text finds neither the key nor the value — which is how a
 * Chinese Mac reported "en" to the server while the browser said "zh-CN".
 * `plutil` renders the binary form; the text path stays for an XML plist or an
 * old system without `plutil`. Result is cached per process: the file changes
 * only when the user changes their region, and this sits on a prompt-assembly
 * path that must not spawn a process every step.
 */
let appleLocaleCache = null;

function appleLocale(env) {
  const file = path.join(env.HOME ?? '', 'Library', 'Preferences', '.GlobalPreferences.plist');
  let stamp = 0;
  try {
    stamp = statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
  if (appleLocaleCache !== null && appleLocaleCache.file === file && appleLocaleCache.stamp === stamp) {
    return appleLocaleCache.value;
  }
  let value;
  try {
    const raw = execFileSync('/usr/bin/plutil', ['-extract', 'AppleLocale', 'raw', '-o', '-', file], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (raw !== '') value = raw;
  } catch {
    // plutil absent or the key is missing: fall through to the text read
  }
  if (value === undefined) {
    try {
      const text = readFileSync(file, 'utf8');
      const match = /<key>AppleLocale<\/key>\s*<string>([^<]+)<\/string>/u.exec(text);
      if (match !== null) value = match[1];
    } catch {
      // no readable global preferences
    }
  }
  appleLocaleCache = { file, stamp, value };
  return value;
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
    const language = normalizeLanguage(appleLocale(env));
    if (language !== undefined) return language;
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
 * `panel` is what the browser reports (`payload.language`) — the host's locale
 * runtime already answered there, so it is the closest thing to the user's own
 * choice and outranks the server's guess at it. It still loses to an explicit
 * plugin setting, which is the one override a user asked for by name.
 *
 * @param {{settings?: {language?: string}, panel?: string, localePreference?: string, system?: string}} input
 * @returns {'zh'|'en'}
 */
export function resolveLanguage(input = {}) {
  return normalizeLanguage(input.settings?.language)
    ?? normalizeLanguage(input.panel)
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
