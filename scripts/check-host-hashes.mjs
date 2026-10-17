/**
 * Host CSS Modules hash gate for the plugin styles in this repo.
 *
 * The host's frontend is built from CSS Modules, so every class name a plugin
 * styles against carries a build-generated hash prefix:
 *
 *   .Sh0Q9G_trigger   (dsh 0.1.x, dsh-client-ui-conversation)
 *   .iWlSmW_trigger   (dsh 0.2.1-rc.2, dsh-client-ui-permission-presets)
 *
 * A host bump can move a component to another package and mint a new hash. The
 * plugin's rule then matches nothing and fails **silently** — no error, no log,
 * just the un-styled host layout. That is exactly how `0.2.1-rc.2` brought the
 * mobile composer stats back (`.FJxK0a_root` → `.bOPqQW_*`) and re-attached the
 * `∨` chevron to the permission trigger (`.Sh0Q9G_*` → `.iWlSmW_*`).
 *
 * This check treats each `.<hash>_<part>` prefix as a claim: if the running host
 * ships no such prefix anywhere in its own bundles, the rule is dead.
 *
 * Prefer host-rendered stable attributes (`data-composer-stat`, `data-slot`,
 * `data-composer-card`, `[data-shortcut-modal="settings"]`) over hashes; when a
 * hash is unavoidable, keep both the old and the new prefix in the selector.
 *
 * Usage:
 *   node scripts/check-host-hashes.mjs                      # every plugin
 *   node scripts/check-host-hashes.mjs plugins/dsh-mobile-adapter
 *
 * Prints SKIP and exits 0 when no `dsh` install is on PATH, so it chains from
 * `npm test` / `scripts/release.sh` anywhere.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SELF), '..');
const USAGE = 'usage: node scripts/check-host-hashes.mjs [plugin-dir ...]';

function skip(reason) {
  console.log('SKIP ' + reason);
  process.exit(0);
}

const targets = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['dsh'], { encoding: 'utf8' });
if (which.error !== undefined || which.status !== 0) skip('dsh is not installed on PATH');
const dshBin = resolve((which.stdout ?? '').split(/\r?\n/).map((line) => line.trim()).find((line) => line !== '') ?? '');
let hostRoot;
try {
  hostRoot = resolve(dirname(realpathSync(dshBin)), '..');
} catch {
  skip('the dsh on PATH is a dangling link (' + dshBin + ')');
}
const hostScope = join(hostRoot, 'node_modules', '@deepseek-ai');
if (!existsSync(hostScope)) skip('no @deepseek-ai scope next to the dsh binary');
const hostVersion = existsSync(join(hostRoot, 'package.json'))
  ? JSON.parse(readFileSync(join(hostRoot, 'package.json'), 'utf8')).version
  : 'unknown';

/**
 * Whether `candidate` looks like a CSS Modules hash prefix.
 *
 * Real prefixes are 5-8 alphanumerics that mix case or digits (`iWlSmW`,
 * `Sh0Q9G`, `hHd-Xa` uses a hyphen and is handled separately). A plain
 * lowercase word like `body` or `line` is an author-written class, so ruling on
 * it here would report every `.body_foo` rule as dead.
 * @param candidate - the part before the first underscore.
 * @returns true for hash-like prefixes.
 */
function isHashPrefix(candidate) {
  return /^[A-Za-z0-9]{5,8}$/.test(candidate) && /[A-Z0-9]/.test(candidate);
}

/** Collect every hash prefix the host's own bundles mention. */
const hostHashes = new Set();
for (const name of readdirSync(hostScope)) {
  for (const file of ['lib/client.js', 'lib/index.js']) {
    const path = join(hostScope, name, file);
    if (!existsSync(path)) continue;
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(/\.([A-Za-z0-9]{5,8})_[a-zA-Z]+\{/g)) {
      if (isHashPrefix(match[1])) hostHashes.add(match[1]);
    }
    for (const match of source.matchAll(/"[a-z][a-zA-Z]*":\s*"([A-Za-z0-9]{5,8})_[a-zA-Z]+"/g)) {
      if (isHashPrefix(match[1])) hostHashes.add(match[1]);
    }
  }
}

console.log('dsh ' + hostVersion + ' @ ' + hostRoot + ' (' + hostHashes.size + ' hash prefix(es))');

const pluginDirs = targets.length > 0
  ? targets.map((target) => resolve(REPO_ROOT, target))
  : readdirSync(join(REPO_ROOT, 'plugins'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(REPO_ROOT, 'plugins', entry.name))
    .sort();

let checked = 0;
let failures = 0;
for (const pluginDir of pluginDirs) {
  const manifestPath = join(pluginDir, 'package.json');
  if (!existsSync(manifestPath)) {
    console.log('FAIL no package.json under ' + pluginDir);
    failures += 1;
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const label = manifest.name + '@' + manifest.version;
  const clientPath = join(pluginDir, 'lib', 'client.js');
  checked += 1;
  if (!existsSync(clientPath)) {
    console.log('PASS ' + label + ' (no client half)');
    continue;
  }
  const source = readFileSync(clientPath, 'utf8');
  const used = new Set();
  for (const match of source.matchAll(/\.([A-Za-z0-9]{5,8})_[a-zA-Z]+\{/g)) {
    if (isHashPrefix(match[1])) used.add(match[1]);
  }
  const dead = [...used].filter((hash) => !hostHashes.has(hash)).sort();
  if (dead.length === 0) {
    console.log('PASS ' + label + ' (' + used.size + ' hash prefix(es) all present in this host)');
    continue;
  }
  failures += 1;
  console.log('FAIL ' + label + ' :: dead hash prefix(es) ' + dead.join(', ')
    + ' — no host bundle defines them, so those rules silently match nothing.');
}

console.log('');
if (failures === 0) {
  console.log('HASHES OK (' + checked + ' plugin(s) vs dsh ' + hostVersion + ')');
  process.exit(0);
}
console.log('HASHES FAILED: ' + failures + ' of ' + checked + ' plugin(s) style against a hash this host does not ship;'
  + ' switch to a stable data-* attribute, or add the current prefix next to the old one.');
process.exit(1);
