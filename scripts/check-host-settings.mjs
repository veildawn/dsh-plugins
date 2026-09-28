/**
 * Host settings-gate check for plugin settings sections.
 *
 * DSH 0.1.7 mounts `ctx.settings` as dsh-settings' `SettingsForms`, whose write
 * path starts with `volatileForm(schema)`:
 *
 *   const form = volatileForm(schema);
 *   if (form === void 0) throw new Error(`Plugin entry "${ns}" has no volatile fields`);
 *
 * A plugin whose Config declares no live (`.volatile()`) field therefore cannot
 * persist its own section at all - the settings card reports
 * `保存配置失败: Plugin entry "<id>" has no volatile fields` - and the entry is
 * missing from `describe()`, so nothing can read the stored value back.
 *
 * This check mounts the plugin's real `Config` as a real host entry (stub
 * `apply`, real `Loader`/fiber/`SettingsForms`/schemastery) and asserts the
 * gate accepts a write for every live field. The plugin's `@deepseek-ai` scope
 * is symlinked to the install that ships `dsh` on PATH, so the copied sources
 * resolve the same schemastery (> =3.18.4, the build implementing `.volatile()`)
 * the running host resolves.
 *
 * Usage: node scripts/check-host-settings.mjs <plugin-dir> <entry-id>
 *   e.g. node scripts/check-host-settings.mjs plugins/dsh-archive-manager archive-manager
 *
 * Prints SKIP and exits 0 when no suitable `dsh` is on PATH, so `npm test` can
 * chain it anywhere.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SELF), '..');
const CHILD_FLAG = 'DSH_SETTINGS_GATE_ENV';

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log('PASS ' + label);
    return true;
  }
  failures += 1;
  console.log('FAIL ' + label + (detail === undefined ? '' : ' :: ' + String(detail)));
  return false;
}
function skip(reason) {
  console.log('SKIP ' + reason);
  process.exit(0);
}

// ── parent: stage the throwaway install and re-enter as the child ─────────

if (process.env[CHILD_FLAG] === undefined) {
  const pluginArg = process.argv[2];
  const entryId = process.argv[3];
  if (pluginArg === undefined || entryId === undefined) {
    console.log('usage: node scripts/check-host-settings.mjs <plugin-dir> <entry-id>');
    process.exit(2);
  }
  const pluginRoot = resolve(REPO_ROOT, pluginArg);
  const manifest = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'));

  const which = spawnSync('which', ['dsh'], { encoding: 'utf8' });
  if (which.error !== undefined || which.status !== 0) skip('dsh is not installed on PATH');
  const hostRoot = resolve(dirname(realpathSync(which.stdout.trim())), '..');
  const hostScope = join(hostRoot, 'node_modules', '@deepseek-ai');
  const settingsPackage = join(hostScope, 'dsh-settings', 'package.json');
  if (!existsSync(settingsPackage)) skip('no @deepseek-ai/dsh-settings next to the dsh binary');
  const version = JSON.parse(readFileSync(settingsPackage, 'utf8')).version;
  if (typeof version === 'string' && version.startsWith('0.1.0')) {
    skip('host settings ' + version + ' has no SettingsForms service (the legacy seam is covered by npm test)');
  }

  const env = mkdtempSync(join(tmpdir(), 'dsh-settings-gate-'));
  try {
    mkdirSync(join(env, 'node_modules'), { recursive: true });
    // Give the copied plugin exactly what the running host resolves: the host's
    // own node_modules tree (cordis, schemastery, dsh-*, plus third-party deps
    // such as undici that a plugin's host half imports directly).
    for (const name of readdirSync(join(hostRoot, 'node_modules'))) {
      if (name.startsWith('.')) continue;
      symlinkSync(join(hostRoot, 'node_modules', name), join(env, 'node_modules', name), 'dir');
    }
    const installed = join(env, 'node_modules', manifest.name);
    mkdirSync(installed, { recursive: true });
    cpSync(join(pluginRoot, 'lib'), join(installed, 'lib'), { recursive: true });
    cpSync(join(pluginRoot, 'package.json'), join(installed, 'package.json'));
    writeFileSync(join(env, 'probe.mjs'), readFileSync(SELF, 'utf8'));
    console.log(manifest.name + ' @ ' + hostRoot + ' (dsh-settings ' + version + ')');
    const child = spawnSync(process.execPath, [join(env, 'probe.mjs')], {
      cwd: env,
      stdio: 'inherit',
      env: { ...process.env, [CHILD_FLAG]: env, DSH_GATE_PLUGIN: manifest.name, DSH_GATE_ENTRY: entryId },
    });
    process.exit(child.status ?? 1);
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
}

// ── child: mount the real Config as a real host entry ────────────────────

const packageName = process.env.DSH_GATE_PLUGIN;
const entryId = process.env.DSH_GATE_ENTRY;
const { Context } = await import('@deepseek-ai/cordis');
const { Loader } = await import('@deepseek-ai/cordis-plugin-loader');
const { SettingsForms } = await import('@deepseek-ai/dsh-settings');
const cosmokit = await import('@deepseek-ai/cosmokit');
const plugin = await import(packageName);

const home = mkdtempSync(join(tmpdir(), 'dsh-settings-gate-home-'));
const patchPath = join(home, 'cordis.patch.yml');
writeFileSync(patchPath, '[]\n');
let rows = [];

const ctx = new Context();
const loaderFiber = ctx.plugin(Loader, {});
await loaderFiber.await();
ctx.provide('profileContext', { home, name: 'settings-gate', dir: home, installAnchor: home, patchPath });
/** Mirrors dsh-config-editor: persist the profile row, then drive the loader. */
ctx.provide('configEditor', {
  documentPath: patchPath,
  entries: () => [...ctx.loader.entries()],
  configuration: () => [...ctx.loader.entries()].map((entry) => ({
    entry,
    inherited: {},
    override: structuredClone(rows.find((row) => row.id === entry.options.id)?.config ?? {}),
  })),
  async edit(entry, change) {
    const next = change(structuredClone(entry.options.config ?? {}), {});
    rows = [{ id: entry.options.id, name: entry.options.name, config: next }];
    writeFileSync(patchPath, JSON.stringify(rows, null, 2) + '\n');
    await ctx.loader.root.update(rows);
  },
});
const settings = new SettingsForms(ctx);

// The stub keeps the check about the Config schema and the host gate, not about
// which services a particular plugin needs to run.
ctx.loader.builtins['settings-gate-stub'] = { name: entryId, Config: plugin.Config, apply() {} };
await ctx.loader.create({ id: entryId, name: 'cordis:settings-gate-stub', config: {} });
const entry = ctx.loader.resolve(entryId);
await entry.fiber.await();
const fiber = entry.fiber;
check('host entry with the plugin Config is active', fiber?.state === 2, 'state=' + fiber?.state);

const schema = plugin.Config;
const rootLive = schema.meta?.volatile === true;
const fields = schema.dict ?? {};
const liveKeys = Object.entries(fields)
  .filter(([, field]) => rootLive || field.meta?.volatile === true).map(([key]) => key);
check('the plugin declares at least one live field', liveKeys.length > 0,
  'the host rejects every write for an entry without one');

const described = settings.describe().find((row) => row.ns === entryId);
check('host exposes the settings section', described !== undefined, 'describe() omits ' + entryId);
check('host applies the section live', described?.applies === 'live', 'applies=' + String(described?.applies));
check('host reports the reserved editable fields',
  described === undefined || JSON.stringify(Object.keys(described.value).sort()) === JSON.stringify([...liveKeys].sort()),
  'value=' + JSON.stringify(described?.value));

function sampleValue(field) {
  if (field.meta?.default !== undefined) return structuredClone(field.meta.default);
  if (field.type === 'boolean') return true;
  if (field.type === 'number') return 1;
  if (field.type === 'array') return [];
  return 'probe';
}

const updated = [];
for (const key of liveKeys) {
  try {
    await settings.mutate(entryId, [{ op: 'set', path: [key], value: sampleValue(fields[key]) }]);
    updated.push(key);
  } catch (error) {
    check('host accepts a write to "' + key + '"', false, error.message);
  }
}
if (updated.length === liveKeys.length && liveKeys.length > 0) {
  check('host accepts a write to every live field', true);
}
check('writes reach the profile patch',
  liveKeys.length > 0 && liveKeys.every((key) => key in (rows[0]?.config ?? {})), JSON.stringify(rows[0]?.config));
check('writes never remount the fiber', entry.fiber === fiber && fiber.state === 2);
const live = liveKeys.length > 0
  && (rootLive ? cosmokit.isVolatile(fiber.config) : liveKeys.every((key) => cosmokit.isVolatile(fiber.config[key])));
check('the resolved config carries live references', live);

rmSync(home, { recursive: true, force: true });
console.log('');
console.log(failures === 0 ? 'SETTINGS GATE OK (' + packageName + ')' : 'SETTINGS GATE FAILED: ' + failures + ' check(s)');
process.exit(failures === 0 ? 0 : 1);
