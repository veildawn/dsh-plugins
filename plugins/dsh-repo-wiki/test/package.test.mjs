/**
 * Package contract tests.
 *
 * These guard what `dsh plugin add` and the client loader rely on: the package
 * name matches the RPC/plugin identity, every export resolves, the bundle patch
 * mounts that exact name, the preset patch mounts the tools subpath, and the
 * `files` whitelist ships every runtime module (a module left out of `files`
 * works in tests — which read the source tree — and breaks only after install).
 *
 * Run: node --test test/package.test.mjs
 */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const patch = await readFile(path.join(root, 'cordis.patch.yml'), 'utf8');
const presetPatch = await readFile(path.join(root, 'presets', 'repo-wiki.patch.yml'), 'utf8');
const constants = await import('../lib/constants.js');

test('package identity and entry points', () => {
  assert.equal(manifest.name, '@weniatall/dsh-repo-wiki');
  assert.equal(manifest.name, constants.name);
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.main, 'lib/index.js');
  assert.equal(manifest.exports['.'], './lib/index.js');
  assert.equal(manifest.exports['./client'], './lib/client.js');
  assert.equal(manifest.exports['./tools'], './lib/tools.js');
});

test('the declared Node floor matches the rest of the repo', () => {
  assert.equal(manifest.engines.node, '>=20.3');
  assert.equal(manifest.license, 'MIT');
});

test('every export points at an existing non-empty file', async () => {
  for (const [key, value] of Object.entries(manifest.exports)) {
    if (key === './package.json') continue;
    const content = await readFile(path.join(root, value), 'utf8');
    assert.ok(content.length > 0, `${key} is empty`);
  }
});

test('the shipped files list covers every runtime module', async () => {
  const shipped = new Set(manifest.files);
  assert.ok(shipped.has('lib'));
  assert.ok(shipped.has('presets'));
  assert.ok(shipped.has('README.md'));
  assert.ok(shipped.has('cordis.patch.yml'));

  const lib = (await readdir(path.join(root, 'lib'))).sort();
  assert.deepEqual(lib, [
    'client.js', 'constants.js', 'index.js', 'ops.js', 'pipeline.js',
    'plan.js', 'scan.js', 'status.js', 'store.js', 'tools.js',
  ]);
  const presets = (await readdir(path.join(root, 'presets'))).sort();
  assert.deepEqual(presets, ['repo-wiki.patch.yml']);
});

test('every lib module parses', async () => {
  for (const file of await readdir(path.join(root, 'lib'))) {
    const content = await readFile(path.join(root, 'lib', file), 'utf8');
    assert.ok(content.length > 0, `${file} is empty`);
    if (file === 'client.js') {
      // The client bundle is an IIFE, not a module: parse it as a script.
      assert.doesNotThrow(() => new Function(content), 'client.js does not parse');
    } else {
      // Everything else is an ES module: let the loader parse it.
      await assert.doesNotReject(() => import(`../lib/${file}`), `${file} does not parse`);
    }
  }
});

test('the bundle patch mounts the host row under the package name', () => {
  assert.match(patch, /id: repo-wiki/u);
  assert.match(patch, /name: '@weniatall\/dsh-repo-wiki'/u);
  // `@` is a YAML reserved character, so the scalar must be quoted.
  assert.doesNotMatch(patch, /name: @weniatall/u);
});

test('the bundle patch declares both halves', () => {
  assert.deepEqual(manifest.dsh.bundle.patch, ['./cordis.patch.yml', './presets/repo-wiki.patch.yml']);
  assert.deepEqual(manifest.dsh.client.inject, [
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-connection',
  ]);
  assert.equal(manifest.dsh.client.platform, 'web');
});

test('the connection row keeps webStartup and webServer injected', () => {
  // A patch row's `inject` replaces the previous one wholesale, so dropping
  // either of these silently breaks RPC route registration.
  assert.match(patch, /- id: connection/u);
  // Only the inject list matters; the explanatory comment names webRuntime on
  // purpose, so the assertion has to look at the list itself.
  const connectionRow = patch.slice(patch.indexOf('- id: connection'), patch.indexOf('# Cordis bundle patch'));
  const injectList = connectionRow.slice(connectionRow.indexOf('inject:'), connectionRow.indexOf('# Cordis bundle patch'));
  assert.match(injectList, /webStartup/u);
  assert.match(injectList, /webServer/u);
  assert.doesNotMatch(injectList, /webRuntime/u, 'webRuntime must stay out: it never activates on 0.2.1+');
});

test('the preset patch declares one preset that mounts the tools subpath', () => {
  assert.match(presetPatch, /id: preset-repo-wiki/u);
  assert.match(presetPatch, /name: '@deepseek-ai\/dsh-agent-preset'/u);
  // The preset's own identity, which is what sessions select.
  assert.match(presetPatch, /^\s{8}id: repo-wiki$/mu);
  assert.match(presetPatch, /name: Repo Wiki 模式/u);
  assert.match(presetPatch, /name: '@weniatall\/dsh-repo-wiki\/tools'/u);
  // Exactly one row differs from the standard preset: count mounts, not the
  // explanatory comment above the row that names the same subpath.
  const mounts = presetPatch
    .split('\n')
    .filter((line) => /^\s*name: '@weniatall\/dsh-repo-wiki\/tools'$/u.test(line));
  assert.equal(mounts.length, 1);
});

test('the preset carries the standard coding rows', () => {
  for (const row of [
    '@deepseek-ai/dsh-tool-fs',
    '@deepseek-ai/dsh-tool-fs-search',
    '@deepseek-ai/dsh-tool-bash',
    '@deepseek-ai/dsh-tool-subagent',
    '@deepseek-ai/dsh-tool-workflow',
    '@deepseek-ai/dsh-tool-web',
  ]) {
    assert.ok(presetPatch.includes(row), `the preset is missing ${row}`);
  }
});

test('the preset orders after the standard and spec presets', () => {
  const match = /order:\s*(\d+)/u.exec(presetPatch);
  assert.ok(match !== null);
  assert.ok(Number(match[1]) > 0);
});

test('the host half registers no tools and no prompt sections', async () => {
  // This is the load-bearing invariant of the two-half split: a session that did
  // not select the preset must never see wiki tooling.
  const source = await readFile(path.join(root, 'lib', 'index.js'), 'utf8');
  assert.doesNotMatch(source, /tools\.register/u);
  assert.doesNotMatch(source, /systemPrompt/u);
});

test('the peer dependencies cover what the halves import', () => {
  const peers = manifest.peerDependencies;
  assert.ok(peers['@deepseek-ai/dsh-client-ui-slots']);
  assert.ok(peers['@deepseek-ai/dsh-client-connection']);
  assert.ok(peers['@deepseek-ai/dsh-agent-preset']);
  assert.ok(peers['@deepseek-ai/dsh-tools']);
  // The pipeline imports this lazily; it still has to be declared.
  assert.ok(peers['@deepseek-ai/dsh-llm']);
  for (const [name, range] of Object.entries(peers)) {
    assert.doesNotMatch(range, /\^0\.1\.0-rc\.6/u, `${name} pins a range that excludes 0.2.x`);
  }
});

test('the host half loads and exposes the documented surface', async () => {
  const host = await import('../lib/index.js');
  assert.equal(host.name, '@weniatall/dsh-repo-wiki');
  assert.equal(host.RPC_CHANNEL, '/dsh-repo-wiki');
  assert.deepEqual(host.inject, ['connection']);
  assert.equal(typeof host.apply, 'function');
  assert.ok(host.TOOL_NAMES.list === 'list_wiki');
  assert.ok(host.DEFAULT_SETTINGS.dataDir === '.dsh');
});

test('the preset half loads and declares its tools dependency', async () => {
  const preset = await import('../lib/tools.js');
  assert.equal(preset.name, '@weniatall/dsh-repo-wiki/tools');
  assert.deepEqual(preset.inject, ['tools']);
  assert.equal(typeof preset.apply, 'function');
  assert.equal(typeof preset.WIKI_POLICY_TEXT, 'string');
});

test('the RPC channel is a valid single-segment path', () => {
  assert.match(constants.RPC_CHANNEL, /^\/[A-Za-z0-9._~-]+$/u);
});

test('the README documents the layout and the install command', async () => {
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /dsh plugin --profile web add @weniatall\/dsh-repo-wiki/u);
  assert.match(readme, /repowiki/u);
  assert.match(readme, /wiki_plan\.yaml/u);
  assert.match(readme, /list_wiki/u);
});

/* ------------------------------------------------------------------------- *
 * Deployment guards
 *
 * These exist because of a real failure: the first release imported
 * `@deepseek-ai/dsh-llm` inside `callModel` to reuse `BlockAssembler`. A plugin
 * installed into a profile cannot resolve the host's own packages by bare
 * specifier, so every generation would have failed with `llm-unavailable` while
 * the unit tests — which injected a fake module — stayed green.
 * ------------------------------------------------------------------------- */

test('no runtime module imports a host package by bare specifier', async () => {
  for (const file of await readdir(path.join(root, 'lib'))) {
    const source = await readFile(path.join(root, 'lib', file), 'utf8');
    if (file === 'client.js') {
      // The client bundle may only require modules from the platform seed table.
      for (const match of source.matchAll(/require\("([^"]+)"\)/gu)) {
        assert.equal(match[1], 'react', `${file} requires an undeclared module ${match[1]}`);
      }
      continue;
    }
    for (const match of source.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+'([^']+)'/gu)) {
      const specifier = match[1];
      assert.ok(
        specifier.startsWith('node:') || specifier.startsWith('./'),
        `${file} imports "${specifier}"; a profile-installed plugin can only import node: builtins and its own files`,
      );
    }
    // A dynamic import is the same hazard even when it sits inside a function.
    for (const match of source.matchAll(/import\(\s*'([^']+)'\s*\)/gu)) {
      const specifier = match[1];
      assert.ok(
        specifier.startsWith('node:') || specifier.startsWith('./'),
        `${file} dynamically imports "${specifier}", which will not resolve from a profile`,
      );
    }
  }
});

test('the client bundle never reads an optional store hook behind a guard', async () => {
  // Calling a store hook conditionally breaks React's stable-hook-order rule
  // the moment the service that provides it activates after this plugin.
  const source = await readFile(path.join(root, 'lib', 'client.js'), 'utf8');
  // Match a *call* (or a binding), not the explanatory comment that names it.
  assert.doesNotMatch(source, /props\.useWorkspaces\s*[({]/u, 'a store hook is called from props');
  assert.doesNotMatch(source, /const\s+\w+\s*=\s*props\.useWorkspaces/u, 'a store hook is bound from props');
  assert.doesNotMatch(source, /props\.useSessions\s*[({]/u, 'a store hook is called from props');
});
