/** Reproduce a package upgrade inside one long-lived Node ESM process. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const runtime = ['constants.js', 'language.js', 'messages.js', 'validate.js', 'tasks.js', 'model.js', 'templates.js', 'store.js', 'plan.js', 'plan-bridge.js', 'ops.js', 'index.js', 'tools.js'];

test('hot upgrade escapes cached legacy modules and failed 0.4.0 entry links', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'dsh-spec-upgrade-'));
  const sources = {};
  for (const file of runtime) sources[file] = await readFile(join(root, 'lib', file), 'utf8');
  await writeFile(join(fixture, 'sources.json'), JSON.stringify(sources));
  // The old process already evaluated these URLs before package replacement.
  await writeFile(join(fixture, 'package.json'), '{"type":"module"}');
  await writeFile(join(fixture, 'store.js'), 'export const legacy = true;\n');
  await writeFile(join(fixture, 'ops.js'), 'export const legacy = true;\n');
  const script = `
    import assert from 'node:assert/strict';
    import { readFile, writeFile, mkdir } from 'node:fs/promises';
    import { join } from 'node:path';
    const sources = JSON.parse(await readFile(new URL('./sources.json', import.meta.url), 'utf8'));
    const oldStore = await import('./store.js');
    const oldOps = await import('./ops.js');
    assert.equal(oldStore.bindSession, undefined);
    assert.equal(oldOps.specLocation, undefined);
    // A bare root reload is insufficient: failed links can also stay cached.
    await writeFile(new URL('./entry-040.js', import.meta.url), "import { bindSession } from './store.js'; export { bindSession };\\n");
    await assert.rejects(import('./entry-040.js?reload=1'), /does not provide an export named 'bindSession'/);
    for (const [file, source] of Object.entries(sources)) await writeFile(new URL('./' + file, import.meta.url), source);
    // Demonstrate that replacing bytes did NOT clear the old dependency URLs.
    assert.equal(await import('./store.js'), oldStore);
    assert.equal(await import('./ops.js'), oldOps);
    assert.equal((await import('./store.js')).bindSession, undefined);
    const host = await import('./index.js?host-reload=2');
    assert.equal(typeof host.apply, 'function');
    const workspace = join(process.cwd(), 'workspace');
    await mkdir(workspace, { recursive: true });
    let rpc;
    host.apply({
      connection: { rpc: { handle: (_channel, handler) => { rpc = handler; return () => {}; } } },
      get: (key) => ({
        sessions: { get: () => ({ header: { cwd: workspace } }) },
        workspaceRegistry: { list: () => [{ path: workspace }] },
      })[key],
      on() {},
    });
    const ok = async (method, payload) => {
      const result = await rpc(method, payload);
      assert.equal(result.ok, true, JSON.stringify(result.error));
      return result.value;
    };
    await ok('saveDraft', { sessionId: 's-upgrade', specType: 'bugfix' });
    const created = await ok('create', { sessionId: 's-upgrade', title: 'Upgrade smoke' });
    assert.equal(created.specType, 'bugfix');
    assert.ok(created.files.includes('bugfix.md'));
    assert.equal((await ok('describe', { sessionId: 's-upgrade' })).activeSpec.feature, created.feature);
    await ok('unbind', { sessionId: 's-upgrade' });
    assert.equal((await ok('describe', { sessionId: 's-upgrade' })).activeSpec, null);
    await ok('bind', { sessionId: 's-upgrade', feature: created.feature });
    assert.equal((await ok('describe', { sessionId: 's-upgrade' })).activeSpec.feature, created.feature);
    // The preset half must use the SAME release-qualified storage/model graph.
    const preset = await import('./tools.js?host-reload=2');
    const tools = new Map();
    preset.apply({ tools: { register: (entry) => { tools.set(entry.name, entry); return () => {}; } }, on() {} });
    assert.equal(tools.size, 8);
    const listed = await tools.get('spec_list').execute({}, { agent: { session: { id: 's-upgrade', header: { cwd: workspace } } } });
    assert.equal(listed.specs[0].feature, created.feature);
    // Error classes must come from the same versioned model as the operations.
    const missing = await rpc('get', { sessionId: 's-upgrade', feature: 'not-found' });
    assert.equal(missing.error.code, 'spec-not-found');
    console.log('upgrade smoke passed: ${manifest.version}');
  `;
  await writeFile(join(fixture, 'upgrade.mjs'), script);
  const result = spawnSync(process.execPath, ['upgrade.mjs'], {
    cwd: fixture,
    env: { ...process.env, DSH_HOME: join(fixture, 'home') },
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error || ''}`);
  assert.match(result.stdout, /upgrade smoke passed/u);
});
