/**
 * Host-load gate for every plugin's host half.
 *
 * `dsh plugin add` only proves the tarball installs; it does not prove the
 * running host can *resolve and import* the plugin entry. A host bump can break
 * that without changing any version range:
 *
 *   - `0.2.1-rc.2` dropped the `webRuntime` service, so every plugin patch that
 *     injected it made `connection` wait forever and aborted startup with
 *     `dsh: startup failed: 1 required plugin did not activate`;
 *   - a renamed/removed `@deepseek-ai/*` import fails at module-evaluation time,
 *     before Cordis can even report a missing service.
 *
 * This check stages each plugin against the **host's own** `node_modules` (the
 * same tree the booted profile resolves), imports `lib/index.js` for real, and
 * asserts the Cordis plugin contract the Loader will read: a `name`, an
 * `apply`/default class, every `inject` service actually provided by the host,
 * and an optional `Config` schema.
 *
 * Usage:
 *   node scripts/check-host-load.mjs                       # every plugin
 *   node scripts/check-host-load.mjs plugins/dsh-ai-proxy  # just one
 *
 * Prints SKIP and exits 0 when no `dsh` install is on PATH, so it chains from
 * `npm test` / `scripts/release.sh` anywhere.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SELF), '..');
const CHILD_FLAG = 'DSH_HOST_LOAD_ENV';

/**
 * Run a YAML document through the host's own `yaml` package.
 * @param hostModules - staged `node_modules` carrying the host's dependencies.
 * @param text - parsed YAML/JSON source.
 * @returns parsed document.
 */
async function parseHostYaml(hostModules, text) {
  // `yaml` ships its Node entry at dist/index.js; the package root has no file.
  const yaml = await import(pathToFileURL(join(hostModules, 'yaml', 'dist', 'index.js')).href).catch(() => undefined);
  const parse = yaml?.parse ?? yaml?.default?.parse;
  if (typeof parse !== 'function') throw new Error('the host ships no yaml parser to read cordis.patch.yml');
  return parse(text);
}

/**
 * Every service name the host's own plugins provide.
 *
 * A patch that injects a service the host no longer provides does not fail at
 * import: Cordis simply parks the row on `pending` and profile startup aborts
 * with `1 required plugin did not activate`. That is exactly how `0.2.1-rc.2`
 * broke every plugin here after it dropped `webRuntime`.
 * @param hostModules - host `node_modules` root.
 * @returns provided service names.
 */
function collectHostServices(hostModules) {
  const services = new Set();
  const scope = join(hostModules, '@deepseek-ai');
  for (const name of readdirSync(scope)) {
    const lib = join(scope, name, 'lib', 'index.js');
    if (!existsSync(lib)) continue;
    const source = readFileSync(lib, 'utf8');
    for (const match of source.matchAll(/super\(\s*[A-Za-z_$][\w$]*\s*,\s*["']([a-zA-Z.]+)["']/g)) services.add(match[1]);
    for (const match of source.matchAll(/(?:ctx\.)?provide\(\s*["']([a-zA-Z.]+)["']/g)) services.add(match[1]);
  }
  return services;
}

/**
 * Check the plugin's bundle patch list for injections the host cannot satisfy.
 * @param pluginDir - plugin root.
 * @param services - services the host provides.
 * @returns human-readable problems, empty when the patch is loadable.
 */
async function auditPatchInject(pluginDir, services, hostModules) {
  const patchPath = join(pluginDir, 'cordis.patch.yml');
  if (!existsSync(patchPath)) return [];
  let entries;
  try {
    entries = await parseHostYaml(hostModules, readFileSync(patchPath, 'utf8'));
  } catch (error) {
    return ['cordis.patch.yml is unparseable: ' + (error instanceof Error ? error.message : String(error))];
  }
  if (!Array.isArray(entries)) return ['cordis.patch.yml is not a patch list'];
  const problems = [];
  for (const patch of entries) {
    for (const [key, value] of Object.entries(patch ?? {})) {
      if (key !== 'inject' || !Array.isArray(value)) continue;
      for (const name of value) {
        if (typeof name === 'string' && !services.has(name)) {
          problems.push('patch injects "' + name + '" for "' + String(patch.id) + '", which no host plugin provides');
        }
      }
    }
  }
  return problems;
}

function usageError(reason) {
  console.log('FAIL ' + reason);
  process.exit(2);
}
function skip(reason) {
  console.log('SKIP ' + reason);
  process.exit(0);
}

// ── parent: stage one throwaway install per plugin, re-enter as the child ──

if (process.env[CHILD_FLAG] === undefined) {
  const targets = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['dsh'], { encoding: 'utf8' });
  if (which.error !== undefined || which.status !== 0) skip('dsh is not installed on PATH');
  const dshBin = resolve((which.stdout ?? '').split(/\r?\n/).map((line) => line.trim()).find((line) => line !== '') ?? '');
  let hostRoot;
  try {
    hostRoot = resolve(dirname(realpathSync(dshBin)), '..');
  } catch {
    skip('the dsh on PATH is a dangling link (' + dshBin + ')');
  }
  const hostModules = join(hostRoot, 'node_modules');
  const hostVersionPath = join(hostRoot, 'package.json');
  const hostVersion = existsSync(hostVersionPath) ? JSON.parse(readFileSync(hostVersionPath, 'utf8')).version : 'unknown';
  console.log('dsh ' + hostVersion + ' @ ' + hostRoot);

  const pluginDirs = targets.length > 0
    ? targets.map((target) => resolve(REPO_ROOT, target))
    : readdirSync(join(REPO_ROOT, 'plugins'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(REPO_ROOT, 'plugins', entry.name))
      .sort();

  const hostServices = collectHostServices(hostModules);
  let failures = 0;
  for (const pluginDir of pluginDirs) {
    const manifestPath = join(pluginDir, 'package.json');
    if (!existsSync(manifestPath)) usageError('no package.json under ' + pluginDir);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!existsSync(join(pluginDir, 'lib', 'index.js'))) {
      console.log('SKIP ' + manifest.name + ' (no lib/index.js)');
      continue;
    }
    const env = mkdtempSync(join(tmpdir(), 'dsh-host-load-'));
    try {
      mkdirSync(join(env, 'node_modules'), { recursive: true });
      for (const name of readdirSync(hostModules)) {
        if (name.startsWith('.')) continue;
        symlinkSync(join(hostModules, name), join(env, 'node_modules', name), 'dir');
      }
      // Plugin-local third-party dependencies (exceljs, node-pty, undici, ...)
      // live in this workspace's pnpm store, never in the host tree.
      const localModules = join(pluginDir, 'node_modules');
      if (existsSync(localModules)) {
        for (const name of readdirSync(localModules)) {
          if (name.startsWith('.')) continue;
          const target = join(env, 'node_modules', name);
          if (existsSync(target)) continue;
          symlinkSync(join(localModules, name), target, 'dir');
        }
      }
      const installed = join(env, 'node_modules', manifest.name);
      mkdirSync(installed, { recursive: true });
      cpSync(join(pluginDir, 'lib'), join(installed, 'lib'), { recursive: true });
      cpSync(manifestPath, join(installed, 'package.json'));
      // The child must run *inside* the staged tree: ESM resolves bare
      // specifiers from the script's own location, not from cwd, so a probe
      // left in scripts/ would never see the host's node_modules.
      const probePath = join(env, 'probe.mjs');
      cpSync(SELF, probePath);
      const child = spawnSync(process.execPath, [probePath], {
        cwd: env,
        encoding: 'utf8',
        env: { ...process.env, [CHILD_FLAG]: env, DSH_HOST_LOAD_PLUGIN: manifest.name, DSH_HOST_LOAD_HOST: hostRoot },
      });
      const output = (child.stdout + child.stderr).trim();
      const patchProblems = await auditPatchInject(pluginDir, hostServices, hostModules);
      if (child.status === 0 && patchProblems.length === 0) {
        console.log('PASS ' + manifest.name + '@' + manifest.version + ' :: ' + output.split('\n').pop());
      } else {
        failures += 1;
        console.log('FAIL ' + manifest.name + '@' + manifest.version);
        if (child.status !== 0) console.log(output);
        for (const problem of patchProblems) console.log('  - ' + problem);
      }
    } finally {
      rmSync(env, { recursive: true, force: true });
    }
  }
  console.log('');
  if (failures === 0) {
    console.log('HOST LOAD OK (' + pluginDirs.length + ' plugin(s) vs dsh ' + hostVersion + ')');
    process.exit(0);
  }
  console.log('HOST LOAD FAILED: ' + failures + ' plugin(s) cannot be imported by the running host.');
  process.exit(1);
}

// ── child: import the real entry and read the Cordis plugin contract ──────

const packageName = process.env.DSH_HOST_LOAD_PLUGIN;
const hostRoot = process.env.DSH_HOST_LOAD_HOST;
const problems = [];
const note = (message) => problems.push(message);

const { Context } = await import('@deepseek-ai/cordis');
let mod;
try {
  mod = await import(packageName);
} catch (error) {
  console.log('import failed: ' + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
}
if (typeof mod !== 'object' || mod === null) note('the entry exports no module object');
const exported = mod?.default ?? mod;
const apply = typeof exported === 'function' ? exported : exported?.apply;
if (typeof apply !== 'function') note('no apply()/default plugin function is exported');

// The Loader resolves `inject` from the static field; every name must be a
// service the host actually provides or the fiber would wait forever.
const inject = exported?.inject ?? mod?.inject;
const services = new Set();
for (const name of readdirSync(join(hostRoot, 'node_modules', '@deepseek-ai'))) {
  const lib = join(hostRoot, 'node_modules', '@deepseek-ai', name, 'lib', 'index.js');
  if (!existsSync(lib)) continue;
  const source = readFileSync(lib, 'utf8');
  for (const match of source.matchAll(/super\(\s*[A-Za-z_$][\w$]*\s*,\s*["']([a-zA-Z.]+)["']/g)) services.add(match[1]);
  for (const match of source.matchAll(/(?:ctx\.)?provide\(\s*["']([a-zA-Z.]+)["']/g)) services.add(match[1]);
}
const names = Array.isArray(inject) ? inject : Object.keys(inject ?? {});
for (const name of names) {
  if (!services.has(name)) note('inject declares "' + name + '", which no host plugin provides');
}

// A Config schema must be a schemastery object so the Loader can normalize it.
const Config = exported?.Config ?? mod?.Config;
if (Config !== undefined && (typeof Config !== 'function' || typeof Config.dict !== 'object')) {
  note('Config is neither a schemastery schema nor a schema class');
}

if (problems.length > 0) {
  for (const problem of problems) console.log('  - ' + problem);
  process.exit(1);
}
const pluginName = exported?.name ?? mod?.name ?? packageName;
console.log('exports apply' + (typeof Config === 'object' ? ' + Config' : '')
  + (names.length > 0 ? ' + inject[' + names.join(',') + ']' : '') + '; name=' + String(pluginName));
process.exit(0);
