/**
 * dsh-repo-wiki — repository scanning, scope filtering, and Git awareness.
 *
 * The pure half (`matchGlob`, `applyScope`, `isIgnoredPath`) is separated from
 * the I/O half (`listRepoFiles`, `headCommit`, `changedFiles`) so the matching
 * rules — the part a user will notice when it is wrong — can be property-tested
 * without a filesystem.
 *
 * Glob support is the subset `.gitignore` actually uses for this file's scope
 * fields: `*`, `**`, `?`, character classes, `!` negation, and trailing-`/`
 * directory patterns. That is deliberately not a full `gitignore` engine (no
 * precedence ordering against a real `.gitignore` file); `wiki_plan.yaml`'s
 * `scope` is an independent allow/deny list, and Qoder treats it that way too.
 *
 * @module dsh-repo-wiki/scan
 */

import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Directories never worth walking: VCS metadata, deps, and our own output. */
export const ALWAYS_SKIPPED = Object.freeze([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.gradle',
  '.idea',
  'target',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.pnpm-store',
]);

/** Binary or noise extensions that add no documentation value. */
const SKIPPED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.icns', '.webp', '.avif', '.tiff',
  '.mp3', '.mp4', '.mov', '.avi', '.mkv', '.wav', '.flac', '.ogg', '.webm',
  '.zip', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar', '.tar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.exe', '.dll', '.so', '.dylib', '.a', '.o', '.obj', '.class', '.jar', '.war',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.lock', '.map', '.min.js', '.min.css',
  '.sqlite', '.db', '.bin', '.dat', '.pak', '.asar',
]);

/** Files larger than this are listed but not offered for content analysis. */
export const MAX_ANALYSED_BYTES = 512 * 1024;

/* ------------------------------------------------------------------------- *
 * Glob matching (pure)
 * ------------------------------------------------------------------------- */

/**
 * Compile one gitignore-style pattern into a predicate over repo-relative POSIX
 * paths.
 *
 * Semantics implemented:
 *   - a pattern with no `/` matches a basename at any depth;
 *   - a leading `/` anchors to the repository root;
 *   - a trailing `/` matches directories (and everything under them);
 *   - `**` crosses directory separators, a single `*` does not;
 *   - `?` matches one non-separator character;
 *   - `[...]` is a character class;
 *   - a leading `!` negates (handled by {@link applyScope}, not here).
 *
 * @param {string} pattern
 * @returns {(relPath: string, isDirectory?: boolean) => boolean}
 */
export function compileGlob(pattern) {
  const raw = String(pattern ?? '').trim();
  if (raw === '') return () => false;

  let body = raw;
  let directoryOnly = false;
  if (body.endsWith('/')) {
    directoryOnly = true;
    body = body.slice(0, -1);
  }
  const anchored = body.startsWith('/');
  if (anchored) body = body.slice(1);
  if (body === '') return () => false;

  const hasSeparator = body.includes('/');
  const source = globToRegExpSource(body);
  // An unanchored, separator-free pattern matches at any depth; anything else
  // is anchored to the root (gitignore's own rule).
  const prefix = anchored || hasSeparator ? '^' : '^(?:.*/)?';
  const suffix = directoryOnly ? '(?:/.*)?$' : '(?:$|/.*$)';
  const regex = new RegExp(`${prefix}${source}${suffix}`, 'u');
  return (relPath, isDirectory = false) => {
    const normalized = normalizeRelPath(relPath);
    if (normalized === '') return false;
    if (directoryOnly && !isDirectory && !regex.test(normalized)) return false;
    return regex.test(normalized);
  };
}

/** Translate a glob body to a regex source string. */
function globToRegExpSource(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*') {
      const next = glob[i + 1];
      if (next === '*') {
        // `**/` consumes zero or more path segments; a bare `**` consumes any run.
        const after = glob[i + 2];
        if (after === '/') {
          out += '(?:[^/]+/)*';
          i += 2;
          continue;
        }
        out += '.*';
        i += 1;
        continue;
      }
      out += '[^/]*';
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      continue;
    }
    if (ch === '[') {
      const close = glob.indexOf(']', i + 1);
      if (close < 0) {
        out += '\\[';
        continue;
      }
      let body = glob.slice(i + 1, close);
      let negated = false;
      if (body.startsWith('!') || body.startsWith('^')) {
        negated = true;
        body = body.slice(1);
      }
      const escaped = body.replaceAll('\\', '\\\\').replaceAll(']', '\\]');
      out += negated ? `[^/${escaped}]` : `[${escaped}]`;
      i = close;
      continue;
    }
    out += ch.replace(/[.+^${}()|\\]/gu, '\\$&');
  }
  return out;
}

/** Normalize a path to forward slashes without a leading `./`. */
export function normalizeRelPath(relPath) {
  return String(relPath ?? '')
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/\/+$/u, '');
}

/**
 * Whether a repo-relative path is inside a directory we never walk.
 * @param {string} relPath
 * @param {readonly string[]} [extraSkipped]
 * @returns {boolean}
 */
export function isIgnoredPath(relPath, extraSkipped = []) {
  const normalized = normalizeRelPath(relPath);
  if (normalized === '') return false;
  const segments = normalized.split('/');
  const skipped = extraSkipped.length === 0 ? ALWAYS_SKIPPED : [...ALWAYS_SKIPPED, ...extraSkipped];
  for (const segment of segments.slice(0, -1)) {
    if (skipped.includes(segment)) return true;
  }
  const base = segments[segments.length - 1] ?? '';
  if (skipped.includes(base)) return true;
  const lower = base.toLowerCase();
  if (lower === '.ds_store' || lower === 'thumbs.db') return true;
  for (const extension of SKIPPED_EXTENSIONS) {
    if (lower.endsWith(extension)) return true;
  }
  return false;
}

/**
 * Apply a plan's `scope` to a file list.
 *
 * Rules, in order: drop ignored paths, then — when `include` is non-empty —
 * keep only files matching at least one include pattern, then drop anything
 * matching an `exclude` pattern. A `!`-prefixed pattern in either list flips its
 * own meaning, matching gitignore's negation.
 *
 * @param {string[]} files repo-relative POSIX paths
 * @param {{ include?: string[], exclude?: string[] }} [scope]
 * @returns {string[]} filtered paths, in input order
 */
export function applyScope(files, scope) {
  const list = Array.isArray(files) ? files : [];
  const include = splitPatterns(scope?.include);
  const exclude = splitPatterns(scope?.exclude);

  const includePositive = include.filter((entry) => !entry.negated).map((entry) => entry.match);
  const includeNegative = include.filter((entry) => entry.negated).map((entry) => entry.match);
  const excludePositive = exclude.filter((entry) => !entry.negated).map((entry) => entry.match);
  const excludeNegative = exclude.filter((entry) => entry.negated).map((entry) => entry.match);

  return list.filter((file) => {
    const normalized = normalizeRelPath(file);
    if (normalized === '') return false;
    if (include.length > 0) {
      const matched = includePositive.some((match) => match(normalized));
      const rescued = includeNegative.some((match) => match(normalized));
      if (!matched && !rescued) return false;
      if (matched && rescued) return false;
    }
    if (excludePositive.some((match) => match(normalized))) return false;
    if (excludeNegative.some((match) => match(normalized))) return true;
    return true;
  });
}

function splitPatterns(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((entry) => String(entry ?? '').trim())
    .filter((entry) => entry !== '')
    .map((entry) => {
      if (entry.startsWith('!')) return { negated: true, match: compileGlob(entry.slice(1)) };
      return { negated: false, match: compileGlob(entry) };
    });
}

/* ------------------------------------------------------------------------- *
 * Filesystem scanning
 * ------------------------------------------------------------------------- */

/**
 * Compile `.gitignore` file contents into an ordered matcher list.
 *
 * Each entry keeps the semantics of `compileGlob`; `!` flips the match back to
 * "not ignored". Evaluation is last-match-wins, like git's own.
 * @param {string} text
 * @returns {{ match: (relPath: string, isDirectory?: boolean) => boolean, negated: boolean }[]}
 */
export function compileGitignore(text) {
  return String(text ?? '')
    .split(/\r\n|\n|\r/u)
    .map((line) => line.trimEnd())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const negated = line.startsWith('!');
      const pattern = negated ? line.slice(1).trim() : line.trim();
      return pattern === '' ? null : { match: compileGlob(pattern), negated };
    })
    .filter((entry) => entry !== null);
}

/**
 * Whether `relPath` is ignored by an ordered gitignore rule set.
 *
 * `rules` is a list of `{ base, matchers }` where `base` is the repo-relative
 * directory the `.gitignore` lived in; later matching patterns win.
 */
export function isGitignored(relPath, rules) {
  const normalized = normalizeRelPath(relPath);
  if (normalized === '') return false;
  let ignored = false;
  for (const rule of rules ?? []) {
    const base = typeof rule?.base === 'string' ? rule.base : '';
    let local = normalized;
    if (base !== '') {
      if (normalized !== base && !normalized.startsWith(`${base}/`)) continue;
      local = normalized.slice(base.length + 1);
      if (local === '') continue;
    }
    for (const matcher of rule.matchers ?? []) {
      if (matcher.match(local)) ignored = !matcher.negated;
    }
  }
  return ignored;
}

/**
 * Walk the workspace and return repo-relative POSIX paths.
 *
 * Symbolic links are not followed (a link loop would hang the scan), and the
 * generated `repowiki` output directory is excluded so a second run never feeds
 * its own prose back into the model.
 *
 * `.gitignore` files are honoured the way Qoder's scan honours them — its
 * INITIALIZING stage reads them too (`error reading .gitignore file` in the
 * backend), so a `coverage/` or `generated/` directory does not count toward
 * the file cap or reach the model's file digest.
 *
 * @param {string} workspace absolute workspace root
 * @param {{ dataDir?: string, maxFiles?: number }} [options]
 * @returns {Promise<{ files: string[], truncated: boolean, total: number }>}
 */
export async function listRepoFiles(workspace, options = {}) {
  const dataDir = typeof options.dataDir === 'string' && options.dataDir !== '' ? options.dataDir : '.dsh';
  const limit = Number.isInteger(options.maxFiles) && options.maxFiles > 0 ? options.maxFiles : 10000;
  const extraSkipped = [dataDir.replace(/^\.\//u, '')];
  const files = [];
  let total = 0;
  let truncated = false;

  /** Depth-first walk with an explicit stack (no recursion depth limits). */
  const stack = [{ absolute: workspace, relative: '', rules: [] }];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(current.absolute, { withFileTypes: true });
    } catch {
      continue;
    }
    // A `.gitignore` in this directory extends the inherited rule set before
    // any of its children are judged.
    let rules = current.rules;
    if (entries.some((entry) => entry.name === '.gitignore' && entry.isFile())) {
      try {
        const text = await fsp.readFile(path.join(current.absolute, '.gitignore'), 'utf8');
        const matchers = compileGitignore(text);
        if (matchers.length > 0) rules = [...rules, { base: current.relative, matchers }];
      } catch {
        // an unreadable .gitignore is ignored, like a permissions error on any
        // other directory entry
      }
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const relative = current.relative === '' ? entry.name : `${current.relative}/${entry.name}`;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (ALWAYS_SKIPPED.includes(entry.name)) continue;
        if (extraSkipped.includes(entry.name)) continue;
        if (isGitignored(relative, rules)) continue;
        stack.push({ absolute: path.join(current.absolute, entry.name), relative, rules });
        continue;
      }
      if (!entry.isFile()) continue;
      if (isIgnoredPath(relative, extraSkipped)) continue;
      if (isGitignored(relative, rules)) continue;
      total += 1;
      if (files.length < limit) files.push(relative);
      else truncated = true;
    }
  }
  files.sort();
  return { files, truncated, total };
}

/** Whether `repowiki/` exists under the configured data directory. */
export async function wikiExists(workspace, dataDir) {
  const root = path.join(workspace, typeof dataDir === 'string' && dataDir !== '' ? dataDir : '.dsh', 'repowiki');
  try {
    const stat = await fsp.stat(root);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------- *
 * Git
 * ------------------------------------------------------------------------- */

/** Run a git command, returning stdout or `null` on any failure. */
async function git(workspace, args, options = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: workspace,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      ...options,
    });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Whether the workspace is inside a Git work tree.
 * @param {string} workspace
 * @returns {Promise<boolean>}
 */
export async function isGitRepo(workspace) {
  const out = await git(workspace, ['rev-parse', '--is-inside-work-tree']);
  return out !== null && out.trim() === 'true';
}

/**
 * Current HEAD commit, or `null` when the workspace is not a Git repo or has no
 * commits yet.
 * @param {string} workspace
 * @returns {Promise<string|null>}
 */
export async function headCommit(workspace) {
  const out = await git(workspace, ['rev-parse', 'HEAD']);
  if (out === null) return null;
  const trimmed = out.trim();
  return trimmed === '' ? null : trimmed;
}

/** Current branch name, or `null`. */
export async function currentBranch(workspace) {
  const out = await git(workspace, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (out === null) return null;
  const trimmed = out.trim();
  return trimmed === '' || trimmed === 'HEAD' ? null : trimmed;
}

/**
 * Files changed between two commits.
 *
 * `from` is exclusive and `to` is inclusive, matching how the wiki's recorded
 * commit marks "what the last generation saw".
 * @param {string} workspace
 * @param {string} from
 * @param {string} [to] defaults to HEAD
 * @returns {Promise<string[]>} repo-relative POSIX paths; empty on failure
 */
export async function changedFiles(workspace, from, to = 'HEAD') {
  if (typeof from !== 'string' || from === '') return [];
  const out = await git(workspace, ['diff', '--name-only', `${from}..${to}`]);
  if (out === null) return [];
  return out
    .split('\n')
    .map((line) => normalizeRelPath(line.trim()))
    .filter((line) => line !== '');
}

/**
 * Whether `older` is an ancestor of `newer` (`git merge-base --is-ancestor`).
 *
 * This is how Qoder tells `WIKI_HAS_COMMIT` apart from `WIKI_LOSS_COMMIT`: a
 * recorded commit that is no longer reachable from HEAD means the branch was
 * rebased or rewritten, and the stored tree cannot be trusted as a diff base.
 * `git diff A..B` still produces output in that situation, so the check must be
 * explicit.
 *
 * @param {string} workspace
 * @param {string} older the candidate ancestor (the recorded commit)
 * @param {string} [newer] defaults to HEAD
 * @returns {Promise<boolean|null>} `null` when git cannot answer
 */
export async function isAncestor(workspace, older, newer = 'HEAD') {
  if (typeof older !== 'string' || older === '' || typeof newer !== 'string' || newer === '') return null;
  try {
    await execFileAsync('git', ['merge-base', '--is-ancestor', older, newer], {
      cwd: workspace,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return true;
  } catch (error) {
    // exit 1 = "not an ancestor"; anything else = git could not answer
    if (typeof error?.code === 'number' && error.code === 1) return false;
    return null;
  }
}

/**
 * Whether the working tree has uncommitted changes to tracked files.
 * @param {string} workspace
 * @returns {Promise<boolean>}
 */
export async function hasUncommittedChanges(workspace) {
  const out = await git(workspace, ['status', '--porcelain']);
  if (out === null) return false;
  return out.trim() !== '';
}

/**
 * Read a file's text, or `null` when it is missing or not valid UTF-8.
 * @param {string} absolutePath
 * @param {number} [maxBytes]
 * @returns {Promise<string|null>}
 */
export async function readTextFile(absolutePath, maxBytes = MAX_ANALYSED_BYTES) {
  try {
    const stat = await fsp.stat(absolutePath);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    const buffer = await fsp.readFile(absolutePath);
    // Reject NUL bytes: a binary file that slipped past the extension filter.
    if (buffer.includes(0)) return null;
    return buffer.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Build the compact repository digest handed to the planning model.
 *
 * The tree is rendered as a directory outline with file counts rather than a
 * full listing: a 10,000-file repository would otherwise consume the whole
 * context window before the model has read a single line of code.
 * @param {string[]} files
 * @param {{ maxEntries?: number }} [options]
 * @returns {string}
 */
export function renderTreeDigest(files, options = {}) {
  const maxEntries = Number.isInteger(options.maxEntries) && options.maxEntries > 0 ? options.maxEntries : 400;
  const directories = new Map();
  for (const file of files) {
    const normalized = normalizeRelPath(file);
    const slash = normalized.lastIndexOf('/');
    const directory = slash < 0 ? '.' : normalized.slice(0, slash);
    const bucket = directories.get(directory);
    if (bucket === undefined) directories.set(directory, [normalized.slice(slash + 1)]);
    else bucket.push(normalized.slice(slash + 1));
  }
  const sorted = [...directories.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const lines = [];
  for (const [directory, names] of sorted) {
    if (lines.length >= maxEntries) {
      lines.push(`… ${sorted.length - maxEntries} more director${sorted.length - maxEntries === 1 ? 'y' : 'ies'} omitted`);
      break;
    }
    const sample = names.slice(0, 8).join(', ');
    const extra = names.length > 8 ? `, … (+${names.length - 8})` : '';
    lines.push(`- ${directory}/ (${names.length}): ${sample}${extra}`);
  }
  return lines.join('\n');
}
