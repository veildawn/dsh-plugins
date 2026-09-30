/**
 * Host compatibility gate for the plugin manifests in this repo.
 *
 * DSH refuses to start any plugin whose `@deepseek-ai/dsh*` peerDependencies the
 * running runtime does not satisfy:
 *
 *   dsh: warning: Plugin dsh-ai-proxy@0.3.9 is incompatible with dsh 0.2.0-rc.2:
 *   peerDependencies {"@deepseek-ai/dsh-llm":"^0.1.0-rc.6", ...}. ...
 *   dsh: it stays installed but profile startup denies it until you grant an
 *   exemption for those exact versions.
 *
 * The range that caused that block: `^0.1.0-rc.6` desugars to
 * `>=0.1.0-rc.6 <0.2.0-0`, and the upper bound excludes *prereleases of 0.2.0*
 * (`0.2.0-rc.2 > 0.2.0-0`), so a caret pinned to the 0.1 line silently turns
 * into a hard "incompatible" verdict the moment the host ships `0.2.0-rc.N`.
 * Open-ended `>=0.1.0-rc.6` (what the manifests declare today) accepts every
 * 0.1/0.2 prerelease because the host evaluates ranges with
 * `includePrerelease: true`.
 *
 * This check evaluates each manifest with the host's **own**
 * `evaluatePluginCompatibility()` (exported by `@deepseek-ai/dsh-app-boot`, the
 * module profile startup warns from), so the verdict printed here is exactly the
 * verdict the running host renders. It additionally asserts the host actually
 * ships every `@deepseek-ai/dsh*` package a manifest declares.
 *
 * Usage:
 *   node scripts/check-plugin-compat.mjs                       # every plugin
 *   node scripts/check-plugin-compat.mjs plugins/dsh-ai-proxy  # just one
 *   node scripts/check-plugin-compat.mjs --runtime 0.2.0-rc.2  # target another host
 *
 * Prints SKIP and exits 0 when no `dsh` install is on PATH, so it can be chained
 * from `npm test` / `scripts/release.sh` anywhere.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SELF), '..');
const USAGE = 'usage: node scripts/check-plugin-compat.mjs [plugin-dir ...] [--runtime <version>]';

function skip(reason) {
  console.log('SKIP ' + reason);
  process.exit(0);
}
function usageError(reason) {
  console.log('FAIL ' + reason);
  console.log(USAGE);
  process.exit(2);
}

// ── arguments ────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const targets = [];
let runtimeOverride;
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === '--runtime') {
    runtimeOverride = argv[index + 1];
    index += 1;
    if (runtimeOverride === undefined || runtimeOverride.startsWith('-')) usageError('--runtime needs a version');
    continue;
  }
  if (arg === '--help' || arg === '-h') {
    console.log(USAGE);
    process.exit(0);
  }
  if (arg.startsWith('-')) usageError('unknown option ' + arg);
  targets.push(arg);
}

// ── locate the dsh install that owns this machine ────────────────────────

const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['dsh'], { encoding: 'utf8' });
if (which.error !== undefined || which.status !== 0) skip('dsh is not installed on PATH');
const dshBin = resolve((which.stdout ?? '').split(/\r?\n/).map((line) => line.trim()).find((line) => line !== '') ?? '');
let dshBinReal;
try {
  dshBinReal = realpathSync(dshBin);
} catch {
  skip('the dsh on PATH is a dangling link (' + dshBin + ')');
}
const hostRoot = resolve(dirname(dshBinReal), '..');
const hostScope = dirname(hostRoot);
const bundledScope = join(hostRoot, 'node_modules', '@deepseek-ai');

const bootPackage = join(bundledScope, 'dsh-app-boot', 'package.json');
const bootEntry = join(bundledScope, 'dsh-app-boot', 'lib', 'index.js');
let evaluateHostCompatibility;
let runtimeVersion = runtimeOverride;
if (existsSync(bootEntry)) {
  const boot = await import(pathToFileURL(bootEntry).href);
  evaluateHostCompatibility = boot.evaluatePluginCompatibility;
  runtimeVersion = runtimeOverride ?? boot.getDshRuntimeVersion?.();
}
if (typeof evaluateHostCompatibility !== 'function') {
  skip('the dsh on PATH predates @deepseek-ai/dsh-app-boot#evaluatePluginCompatibility');
}
if (typeof runtimeVersion !== 'string' || runtimeVersion === '') {
  skip('the dsh on PATH does not report a runtime version');
}
const hostLabel = hostRoot + (existsSync(bootPackage) ? '' : ' (no dsh-app-boot)');
console.log('dsh ' + runtimeVersion + ' @ ' + hostLabel);

// ── evaluate every manifest with the host's own rulebook ─────────────────

function dshPeersOf(manifest) {
  return Object.entries(manifest.peerDependencies ?? {})
    .filter(([name]) => typeof name === 'string' && (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')));
}

function hostShipsPeer(name) {
  const shortName = name.split('/')[1];
  return existsSync(join(bundledScope, shortName)) || existsSync(join(hostScope, shortName));
}

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
  if (!existsSync(manifestPath)) usageError('no package.json under ' + pluginDir);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const label = manifest.name + '@' + manifest.version;
  const peers = dshPeersOf(manifest);
  checked += 1;
  if (peers.length === 0) {
    console.log('PASS ' + label + ' (declares no @deepseek-ai/dsh* peers)');
    continue;
  }
  const issue = evaluateHostCompatibility(manifest, {}, runtimeVersion);
  const missing = peers.map(([name]) => name).filter((name) => !hostShipsPeer(name));
  const problems = [];
  for (const [name, range] of Object.entries(issue?.peers ?? {})) problems.push(name + ' ' + range);
  for (const name of missing) problems.push(name + ' (not shipped by this host)');
  if (problems.length === 0) {
    console.log('PASS ' + label + ' (' + peers.length + ' @deepseek-ai/dsh* peer(s))');
    continue;
  }
  failures += 1;
  console.log('FAIL ' + label + ' :: ' + problems.join(', '));
}

console.log('');
if (failures === 0) {
  console.log('COMPAT OK (' + checked + ' plugin manifest(s) vs dsh ' + runtimeVersion + ')');
  process.exit(0);
}
console.log('COMPAT FAILED: ' + failures + ' of ' + checked + ' plugin manifest(s) reject dsh ' + runtimeVersion
  + '; fix package.json peerDependencies and ship a new patch release.');
process.exit(1);
