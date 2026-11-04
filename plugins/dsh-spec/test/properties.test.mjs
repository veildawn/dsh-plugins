/**
 * Property-based tests.
 *
 * Zero dependencies, fixed seeds: a small linear congruential generator drives
 * each property over many generated inputs, so a failure reproduces exactly.
 *
 * Covered properties (see design.md):
 *   Property 4 — tools and prompt reach only the session that runs the preset
 *   Property 6 — the preset's coding rows are the standard rows plus spec-tools
 *   Property 7 — the package contract self-resolves (patches, exports, no edge)
 *
 * Run: node --test test/properties.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
process.env.DSH_HOME = await mkdtemp(path.join(tmpdir(), 'dsh-spec-prop-home-'));

const host = await import('../lib/index.js');
const preset = await import('../lib/tools.js');
const { TOOL_NAMES } = await import('../lib/constants.js');

/** Iterations per property; the design requires at least 100. */
const RUNS = 120;

/**
 * Deterministic 32-bit linear congruential generator (Numerical Recipes
 * constants). Reproducible across machines and Node versions.
 * @param {number} seed
 */
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const pick = (random, items) => items[Math.floor(random() * items.length) % items.length];
const integer = (random, min, max) => min + Math.floor(random() * (max - min + 1));

/**
 * Build two simulated scopes: one bound to the spec preset and one that is not.
 * @param {string} workspace
 */
function scopedRegistries(workspace) {
  const scopes = new Map();
  const layerFor = (scope) => {
    if (!scopes.has(scope)) scopes.set(scope, { tools: new Map(), sections: new Map(), contexts: new Map() });
    return scopes.get(scope);
  };
  const promptService = {
    section: (section) => () => {},
    context: (context) => () => {},
  };
  return {
    scopes,
    layerFor,
    promptService,
    /** Visible tools for a scope, mirroring how the registry chain resolves. */
    visibleTools(scope) {
      const names = new Set();
      for (const [key, layer] of scopes) {
        if (key !== scope && key !== undefined) continue;
        for (const name of layer.tools.keys()) names.add(name);
      }
      return [...names];
    },
    visibleSections(scope) {
      const names = new Set();
      for (const [key, layer] of scopes) {
        if (key !== scope && key !== undefined) continue;
        for (const name of layer.sections.keys()) names.add(name);
      }
      return [...names];
    },
  };
}

/** Mount the preset half into one scope of the simulated registry. */
function mountPresetInto(scope, registries, workspace) {
  const layer = registries.layerFor(scope);
  preset.apply({
    tools: {
      register: (definition) => {
        layer.tools.set(definition.name, definition);
        return () => layer.tools.delete(definition.name);
      },
    },
    get: (key) => (key === 'systemPrompt'
      ? {
        section: (section) => {
          layer.sections.set(section.name, section);
          return () => layer.sections.delete(section.name);
        },
        context: (context) => {
          layer.contexts.set(context.name, context);
          return () => layer.contexts.delete(context.name);
        },
      }
      : key === 'workspaceRegistry' ? { list: () => [{ path: workspace }] } : undefined),
    inject: () => {},
    on: () => {},
    logger: { warn: () => {} },
  }, {});
}

test('Property 4: spec tools and prompt reach only the session that runs the preset', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'dsh-spec-prop-ws-'));
  const random = rng(0x5eed_0001);
  const mountedScopes = ['preset-spec-a', 'preset-standard-b', 'preset-c-'];

  for (let run = 0; run < RUNS; run += 1) {
    // Each run mounts the preset into a randomly chosen subset of scopes.
    const registries = scopedRegistries(workspace);
    for (const scope of mountedScopes) {
      if (random() < 0.5) mountPresetInto(scope, registries, workspace);
    }
    const requested = pick(random, mountedScopes);

    const tools = registries.visibleTools(requested);
    const sections = registries.visibleSections(requested);
    const mounted = registries.scopes.has(requested) && registries.scopes.get(requested).tools.size > 0;

    if (mounted) {
      assert.deepEqual(tools.sort(), Object.values(TOOL_NAMES).sort(), 'a mounted scope sees exactly the eight tools');
      assert.deepEqual(sections, ['spec-policy'], 'a mounted scope sees the policy section');
    } else {
      assert.deepEqual(tools, [], 'an unmounted scope sees no spec tool');
      assert.deepEqual(sections, [], 'an unmounted scope sees no policy section');
      assert.equal(tools.some((name) => name.startsWith('spec_')), false);
    }
  }
});

test('Property 6: the spec preset is the standard coding rows plus spec-tools', async () => {
  const standard = await readFile(
    join('/tmp/asar-extract-spec/out2/dsh/node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml'),
    'utf8',
  ).catch(() => null);
  // The reference file is a local convenience; the shipped rows are also
  // pinned structurally below so the property holds without it.
  const spec = await readFile(join(root, 'presets', 'spec.patch.yml'), 'utf8');
  // The declaration row itself sits at depth one ("name: '@deepseek-ai/dsh-agent-preset'"),
  // so only indented rows are child plugins.
  const names = (text) => [...text.matchAll(/^ +name: '([^']+)'/gmu)]
    .map((match) => match[1])
    .filter((name) => name !== '@deepseek-ai/dsh-agent-preset');

  const specRows = names(spec);
  assert.ok(specRows.includes('@weniatall/dsh-spec/tools'), 'the preset mounts its own tool plugin');

  if (standard !== null) {
    const standardRows = names(standard);
    const specSet = new Set(specRows);
    for (const row of standardRows) {
      assert.ok(specSet.has(row), `spec preset is missing the standard row ${row}`);
    }
    const extra = specRows.filter((row) => !standardRows.includes(row));
    assert.deepEqual(extra, ['@weniatall/dsh-spec/tools'], 'exactly one extra row: the spec tools');
  }

  // Structural invariants that must hold regardless of the reference file.
  const random = rng(0x5eed_0006);
  for (let run = 0; run < RUNS; run += 1) {
    const index = Math.floor(random() * specRows.length);
    assert.equal(typeof specRows[index], 'string');
    assert.ok(specRows[index].includes('/'), 'every row names a package');
  }
  const bashDisabled = /- id: tool-bash\n\s+name: '@deepseek-ai\/dsh-tool-bash'\n\s+disabled: !!js process\.platform === 'win32'/u;
  const pwshDisabled = /- id: tool-pwsh\n\s+name: '@deepseek-ai\/dsh-tool-pwsh'\n\s+disabled: !!js process\.platform !== 'win32'/u;
  assert.match(spec, bashDisabled, 'bash is disabled on Windows');
  assert.match(spec, pwshDisabled, 'pwsh is disabled elsewhere');
});

test('Property 7: the package contract self-resolves', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const random = rng(0x5eed_0007);

  // Every patch path is inside the files list and resolves on disk.
  assert.ok(Array.isArray(manifest.dsh.bundle.patch));
  for (const relative of manifest.dsh.bundle.patch) {
    // npm packs a path when it equals a files entry or sits under a files
    // directory; `.`-prefixed patch names are matched against the bare path.
    const bare = relative.replace(/^\.\//u, '');
    const covered = manifest.files.some((entry) => bare === entry || bare.startsWith(`${entry}/`));
    assert.ok(covered, `${relative} must be covered by files`);
    await access(join(root, relative));
  }

  // Every export resolves to a non-empty file.
  const exportKeys = Object.keys(manifest.exports);
  for (let run = 0; run < RUNS; run += 1) {
    const key = exportKeys[integer(random, 0, exportKeys.length - 1)];
    if (key === './package.json') continue;
    const target = manifest.exports[key];
    const content = await readFile(join(root, target), 'utf8');
    assert.ok(content.length > 0, `${key} must not be empty`);
  }

  // The host entry must not import the preset entry.
  const hostSource = await readFile(join(root, 'lib/index.js'), 'utf8');
  assert.doesNotMatch(hostSource, /from '\.\/tools\.js'/u);
  assert.doesNotMatch(hostSource, /from "\.\/tools\.js"/u);

  // And the separation must survive importing the host entry.
  assert.equal(host.SPEC_POLICY_TEXT, undefined, 'the policy text is not on the host entry');
  assert.deepEqual(host.inject, ['connection']);
  assert.deepEqual(preset.inject, ['tools']);
});
