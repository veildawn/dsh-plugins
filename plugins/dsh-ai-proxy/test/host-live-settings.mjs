/**
 * Live settings-seam check against the DSH 0.1.7 host, using the host's own
 * classes rather than fakes for everything that decides whether a settings
 * write is accepted.
 *
 * The plugin is copied into a throwaway directory whose `@deepseek-ai` scope is
 * symlinked to the install that ships the `dsh` on PATH, so the copied sources
 * resolve exactly what the running host resolves: cordis, schemastery (the
 * >= 3.18.4 line that implements `.volatile()`), cosmokit, cordis-plugin-loader
 * and the dsh-settings `SettingsForms` service. The scenario then drives the
 * real `Loader` entry/fiber, the real `SettingsForms.describe()`/`mutate()` and
 * the real volatile-reference protocol; only the two services the check has no
 * business mounting (the profile document and credential storage) are stubbed.
 *
 * Regression guarded: DSH 0.1.7's `SettingsForms.write` rejects any plugin whose
 * Config declares no volatile field with
 * `Plugin entry "<id>" has no volatile fields`, which surfaced in the AI Proxy
 * section as "保存配置失败: Plugin entry "llm-ai-proxy" has no volatile fields".
 *
 * Needs a `dsh` on PATH with a 0.1.7-line settings service; prints SKIP and exits
 * 0 anywhere else, so `npm test` stays green on a machine without DSH.
 *
 * Run: node test/host-live-settings.mjs   (exit 0 = pass or SKIP, 1 = fail)
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const selfPath = fileURLToPath(import.meta.url);
const pluginRoot = resolve(dirname(selfPath), '..');
const CHILD_FLAG = 'DSH_AI_PROXY_LIVE_ENV';

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
  const env = mkdtempSync(join(tmpdir(), 'dsh-ai-proxy-live-'));
  try {
    mkdirSync(join(env, 'node_modules'), { recursive: true });
    symlinkSync(hostScope, join(env, 'node_modules', '@deepseek-ai'), 'dir');
    const installed = join(env, 'node_modules', 'dsh-ai-proxy');
    mkdirSync(installed, { recursive: true });
    for (const entry of ['lib', 'package.json', 'cordis.patch.yml']) {
      cpSync(join(pluginRoot, entry), join(installed, entry), { recursive: true });
    }
    writeFileSync(join(env, 'probe.mjs'), readFileSync(selfPath, 'utf8'));
    console.log('host install: ' + hostRoot + ' (dsh-settings ' + version + ')');
    const child = spawnSync(process.execPath, [join(env, 'probe.mjs')], {
      cwd: env,
      stdio: 'inherit',
      env: { ...process.env, [CHILD_FLAG]: env },
    });
    process.exit(child.status ?? 1);
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
}

// ── child: the plugin under test, mounted as a real host entry ────────────

const ENTRY_ID = 'llm-ai-proxy';
/** Mirrors the bundle patch row that mounts the plugin in a real profile. */
const BUNDLE_CONFIG = { baseURL: 'http://localhost:18080', clientId: 'dsh' };

const { Context, Service } = await import('@deepseek-ai/cordis');
const { Loader } = await import('@deepseek-ai/cordis-plugin-loader');
const { SettingsForms } = await import('@deepseek-ai/dsh-settings');
const { LlmRuntime } = await import('@deepseek-ai/dsh-llm');
const cosmokit = await import('@deepseek-ai/cosmokit');
const plugin = await import('dsh-ai-proxy');
const { AUTH_RPC_CHANNEL } = plugin;

const home = mkdtempSync(join(tmpdir(), 'dsh-ai-proxy-profile-'));
const patchPath = join(home, 'cordis.patch.yml');
writeFileSync(patchPath, '[]\n');
/** The profile patch document, which dsh-config-editor owns on a real host. */
let rows = [];

const ctx = new Context();
const loaderFiber = ctx.plugin(Loader, {});
await loaderFiber.await();
ctx.provide('profileContext', { home, name: 'live-settings', dir: home, installAnchor: home, patchPath });
new LlmRuntime(ctx);

/** Stand-in for the credential store; the settings seam never reads it. */
class ProbeCreds extends Service {
  constructor(ownerCtx) {
    super(ownerCtx, 'credentials');
    this.store = new Map();
  }
  async resolve(ref) {
    const value = this.store.get(String(ref));
    return value === undefined ? undefined : { value, source: 'probe' };
  }
  async set(ref, value) { this.store.set(String(ref), value); }
  async unset(ref) { this.store.delete(String(ref)); }
  async describe(ref) { return { configured: this.store.has(String(ref)), writable: true }; }
}
new ProbeCreds(ctx);

/** Stand-in for the connection service that carries the plugin's RPC channel. */
const registrations = new Map();
ctx.provide('connection', {
  rpc: {
    handle(channel, handler, options) {
      registrations.set(channel, { handler, options });
      return async () => { registrations.delete(channel); };
    },
  },
});

/**
 * Mirrors dsh-config-editor's ConfigEditor: `configuration()` reads the loader
 * tree plus the profile rows, and `edit()` persists the row and then drives the
 * loader the way the root Include entry does. The volatile commit that runs
 * inside `Entry.update` -> `_commitVolatile` is the host's own code.
 */
const configEditor = {
  documentPath: patchPath,
  entries: () => [...ctx.loader.entries()],
  configuration: () => configEditor.entries().map((entry) => ({
    entry,
    inherited: structuredClone(BUNDLE_CONFIG),
    override: structuredClone(rows.find((row) => row.id === entry.options.id)?.config ?? {}),
  })),
  async edit(entry, change) {
    const next = change(structuredClone(entry.options.config ?? {}), structuredClone(BUNDLE_CONFIG));
    rows = [{ id: entry.options.id, name: entry.options.name, config: next }];
    writeFileSync(patchPath, JSON.stringify(rows, null, 2) + '\n');
    await ctx.loader.root.update(rows);
  },
};
ctx.provide('configEditor', configEditor);

const settings = new SettingsForms(ctx);
check('host settings service mounts', typeof settings.describe === 'function' && settings.writable === true);

ctx.loader.builtins['ai-proxy-under-test'] = plugin;
await ctx.loader.create({ id: ENTRY_ID, name: 'cordis:ai-proxy-under-test', config: structuredClone(BUNDLE_CONFIG) });
const entry = ctx.loader.resolve(ENTRY_ID);
await entry.fiber.await();
const fiber = entry.fiber;
// The Loader emits live commits through the fiber's own filtered context.
const liveUpdates = [];
fiber.ctx.on('loader/volatile-update', (paths) => liveUpdates.push(paths));
check('plugin mounts as an active host entry', fiber !== undefined && fiber.state === 2, 'state=' + fiber?.state);
check('authentication RPC channel is published',
  registrations.get(AUTH_RPC_CHANNEL)?.options?.authority === 'trusted-host');

// ── the reported failure: saving the gateway from the settings section ────

const described = settings.describe();
const section = described.find((row) => row.ns === ENTRY_ID);
check('settings section is visible to the host', section !== undefined,
  'describe() = ' + JSON.stringify(described.map((row) => row.ns)));
check('settings section applies live', section?.applies === 'live', 'applies=' + String(section?.applies));
check('settings section reports the composed gateway',
  section?.value?.baseURL === 'http://localhost:18080'
  && (section?.value?.clientId === undefined || section?.value?.clientId === 'dsh'),
  JSON.stringify(section?.value));

let mutateError;
try {
  await settings.mutate(ENTRY_ID, [{ op: 'set', path: ['baseURL'], value: 'http://192.168.1.253:8319' }]);
} catch (error) {
  mutateError = error;
}
check('gateway write is accepted by the host', mutateError === undefined, mutateError?.message);
check('gateway write reaches the profile patch',
  rows[0]?.config?.baseURL === 'http://192.168.1.253:8319', JSON.stringify(rows[0]?.config));
check('gateway write keeps the rest of the config',
  rows[0]?.config?.clientId === 'dsh', JSON.stringify(rows[0]?.config));
check('gateway write commits through the volatile path', liveUpdates.length === 1,
  JSON.stringify(liveUpdates));

const gateway = await registrations.get(AUTH_RPC_CHANNEL).handler('config', {});
check('running plugin reports the new gateway without remounting',
  gateway?.value?.baseURL === 'http://192.168.1.253:8319', JSON.stringify(gateway));
check('running plugin keeps its fiber', entry.fiber === fiber && fiber.state === 2);

// ── the section's own save path: the authentication RPC ──────────────────

const saved = await registrations.get(AUTH_RPC_CHANNEL).handler('setGateway', {
  baseURL: 'http://127.0.0.1:18080/',
  apiFormat: 'responses',
  defaultReasoningEffort: 'lowest',
});
check('setGateway RPC completes', saved?.ok === true, JSON.stringify(saved));
check('setGateway RPC normalizes and persists the gateway',
  saved?.value?.baseURL === 'http://127.0.0.1:18080' && rows[0]?.config?.baseURL === 'http://127.0.0.1:18080',
  JSON.stringify(rows[0]?.config));
check('setGateway RPC persists the api format and effort',
  rows[0]?.config?.apiFormat === 'responses' && rows[0]?.config?.defaultReasoningEffort === 'lowest',
  JSON.stringify(rows[0]?.config));

const rejected = await registrations.get(AUTH_RPC_CHANNEL).handler('setGateway', { baseURL: 'ftp://nope' });
check('setGateway RPC still rejects a bad gateway', rejected?.ok === false, JSON.stringify(rejected));

const after = await registrations.get(AUTH_RPC_CHANNEL).handler('config', {});
check('running plugin follows every live edit',
  after?.value?.baseURL === 'http://127.0.0.1:18080' && after?.value?.apiFormat === 'responses'
  && after?.value?.defaultReasoningEffort === 'lowest',
  JSON.stringify(after?.value));
check('live edits never remount the fiber', entry.fiber === fiber && fiber.state === 2);

// ── schema shape: only the editable gateway fields are live ──────────────

const fields = plugin.Config.dict ?? {};
const volatileKeys = Object.entries(fields)
  .filter(([, field]) => field.meta?.volatile === true).map(([key]) => key).sort();
check('only the live gateway fields are volatile',
  JSON.stringify(volatileKeys) === JSON.stringify(['apiFormat', 'baseURL', 'clientId', 'defaultReasoningEffort']),
  JSON.stringify(volatileKeys));
check('model catalog stays ordinary config', fields.models?.meta?.volatile !== true);
check('the resolved config carries live references',
  cosmokit.isVolatile(fiber.config.baseURL) && fiber.config.baseURL.get() === 'http://127.0.0.1:18080');
check('clientId is also live config',
  cosmokit.isVolatile(fiber.config.clientId) && fiber.config.clientId.get() === 'dsh');

rmSync(home, { recursive: true, force: true });
console.log('');
console.log(failures === 0 ? 'LIVE SETTINGS OK' : 'LIVE SETTINGS FAILED: ' + failures + ' check(s)');
process.exit(failures === 0 ? 0 : 1);
