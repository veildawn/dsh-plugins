/**
 * Package contract tests.
 *
 * Guards the things `dsh plugin add` and the client loader rely on: the
 * package name matches the RPC/plugin identity, every export resolves, the
 * bundle patch mounts that exact name, peer deps cover what the host half
 * expects, and the client bundle is a self-registering IIFE.
 *
 * Run: node --test test/package.test.mjs
 */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8');
const presetPatch = await readFile(join(root, 'presets', 'spec.patch.yml'), 'utf8');

test('package identity and entry points', () => {
  assert.equal(manifest.name, '@weniatall/dsh-spec');
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.main, 'lib/index.js');
  assert.equal(manifest.exports['.'], './lib/index.js');
  assert.equal(manifest.exports['./client'], './lib/client.js');
});

test('every export points at an existing file', async () => {
  for (const [key, value] of Object.entries(manifest.exports)) {
    if (key === './package.json') continue;
    const file = join(root, value);
    const content = await readFile(file, 'utf8');
    assert.ok(content.length > 0, `${key} is empty`);
  }
});

test('the shipped files list covers every runtime module', async () => {
  const shipped = new Set(manifest.files);
  assert.ok(shipped.has('lib'));
  assert.ok(shipped.has('presets'));
  assert.ok(shipped.has('README.md'));
  assert.ok(shipped.has('cordis.patch.yml'));
  const lib = await readdir(join(root, 'lib'));
  assert.deepEqual(lib.sort(), [
    'client.js', 'constants.js', 'index.js', 'language.js', 'messages.js', 'model.js', 'ops.js', 'plan-bridge.js', 'plan.js', 'store.js', 'tasks.js', 'templates.js', 'tools.js', 'validate.js',
  ]);
  const presets = await readdir(join(root, 'presets'));
  assert.deepEqual(presets.sort(), ['spec.patch.yml']);
});

test('the bundle patch mounts the package name and connection services', () => {
  assert.match(patch, /- id: connection/u);
  assert.match(patch, /- webStartup/u);
  assert.match(patch, /- webServer/u);
  assert.match(patch, /name: '@weniatall\/dsh-spec'/u);
  assert.match(patch, /id: spec/u);
});

test('the host module injects only the RPC carrier and exposes no tools or prompt', async () => {
  const host = await import(join(root, 'lib/index.js'));
  assert.equal(host.name, manifest.name);
  // The host row must stay inert: connection is its only required service.
  assert.deepEqual(host.inject, ['connection']);
  assert.equal(host.RPC_CHANNEL, '/dsh-spec');
  assert.equal(host.DEFAULT_SETTINGS.kiroDir, '.kiro');
  assert.equal(host.SPEC_POLICY_TEXT, undefined, 'the policy text belongs to the preset half');
  // Tool names stay exported for the Web client and for the preset half.
  assert.deepEqual(Object.values(host.TOOL_NAMES).sort(), [
    'spec_check', 'spec_create', 'spec_list', 'spec_next', 'spec_pbt', 'spec_read', 'spec_task_update', 'spec_write',
  ]);
  // No import edge from the host entry to the preset entry.
  const source = await readFile(join(root, 'lib/index.js'), 'utf8');
  assert.doesNotMatch(source, /from '\.\/tools\.js(?:\?[^']*)?'/u);
});

test('the preset module owns the tools and the policy text', async () => {
  const preset = await import(join(root, 'lib/tools.js'));
  assert.equal(preset.name, '@weniatall/dsh-spec/tools');
  assert.deepEqual(preset.inject, ['tools']);
  assert.match(preset.SPEC_POLICY_TEXT, /Kiro-style specs/u);
  assert.match(preset.SPEC_POLICY_TEXT, /Task Dependency Graph/u);
  assert.match(preset.SPEC_POLICY_TEXT, /spec_task_update/u);
});

test('the preset patch declares the spec preset built from the standard coding rows', () => {
  assert.match(presetPatch, /- id: preset-spec/u);
  assert.match(presetPatch, /name: '@deepseek-ai\/dsh-agent-preset'/u);
  assert.match(presetPatch, /id: spec$/mu);
  assert.match(presetPatch, /order: 5/u);
  assert.match(presetPatch, /name: Spec 模式/u);
  // The eight tools arrive through this row.
  assert.match(presetPatch, /- id: spec-tools\n\s+name: '@weniatall\/dsh-spec\/tools'/u);
  // The plan projection ships beside them: the dock's data half.
  assert.match(presetPatch, /- id: spec-plan\n\s+name: '@weniatall\/dsh-spec\/plan'/u);
  // The host todo module is off here: two disagreeing task lists was the bug.
  assert.match(presetPatch, /- id: tool-todo\n\s+name: '@deepseek-ai\/dsh-tool-todo'\n\s+disabled: true/u);
  // The shell rows stay mutually exclusive per platform.
  assert.match(presetPatch, /- id: tool-bash\n\s+name: '@deepseek-ai\/dsh-tool-bash'\n\s+disabled: !!js process\.platform === 'win32'/u);
  assert.match(presetPatch, /- id: tool-pwsh\n\s+name: '@deepseek-ai\/dsh-tool-pwsh'\n\s+disabled: !!js process\.platform !== 'win32'/u);
});

test('the bundle patch array ships both layers and every path resolves', async () => {
  const patches = manifest.dsh.bundle.patch;
  assert.ok(Array.isArray(patches), 'bundle.patch must be an array once a preset ships beside the host row');
  assert.deepEqual(patches, ['./cordis.patch.yml', './presets/spec.patch.yml']);
  for (const relative of patches) {
    const content = await readFile(join(root, relative), 'utf8');
    assert.ok(content.length > 0, `${relative} is empty`);
  }
});

test('the client bundle is a self-registering module-loader IIFE', async () => {
  const source = await readFile(join(root, 'lib/client.js'), 'utf8');
  assert.match(source, /window\.__ModuleLoader__\.load\(\{/u);
  assert.match(source, /id: "@weniatall\/dsh-spec"/u);
  assert.match(source, /factory: \(require\) =>/u);
  assert.match(source, /exports\.apply = apply;/u);
  assert.match(source, /exports\.inject = \["slots", "connection", "locale"\];/u);
  assert.doesNotMatch(source, /^\s*import\s/mu);
  // The bundle may only require packages the host injects.
  const requires = [...source.matchAll(/require\("([^"]+)"\)/gu)].map((match) => match[1]);
  assert.deepEqual(requires, ['react']);
});

test('peer dependencies describe the host services the plugin runs against', () => {
  const peers = Object.keys(manifest.peerDependencies).sort();
  assert.deepEqual(peers, [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-agent-preset',
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-tools',
  ]);
  assert.deepEqual(manifest.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-locale']);
  assert.deepEqual(manifest.dsh.bundle.patch, ['./cordis.patch.yml', './presets/spec.patch.yml']);
});

test('all internal module edges use the package release as the ESM cache key', async () => {
  for (const file of await readdir(join(root, 'lib'))) {
    if (!file.endsWith('.js')) continue;
    const source = await readFile(join(root, 'lib', file), 'utf8');
    const edges = [...source.matchAll(/\bfrom\s+['"](\.\/[^'"]+)['"]/gu)];
    for (const [, specifier] of edges) {
      const url = new URL(specifier, 'file:///dsh-spec/lib/' + file);
      assert.equal(url.searchParams.get('dsh-spec'), manifest.version, `${file}: ${specifier}`);
      assert.ok(await readFile(join(root, 'lib', url.pathname.split('/').pop()), 'utf8'));
    }
  }
});

test('the plugin has no runtime dependencies', () => {
  assert.equal(manifest.dependencies, undefined);
});
