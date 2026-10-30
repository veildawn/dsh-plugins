/**
 * Model-selection tests.
 *
 * Choosing the generation model is a settings-page affordance backed by one RPC
 * (`models`). The interesting cases are the degraded ones: a provider that
 * cannot enumerate its catalog, and a host with no `llm` service at all. Both
 * must stay *selectable* — hiding the picker would leave the user with no way to
 * configure a model, which is the bug this feature exists to fix.
 *
 * Run: node --test test/models.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DSH_HOME = await mkdtemp(path.join(tmpdir(), 'rw-models-home-'));

const ops = await import('../lib/ops.js');

/** A context whose optional services are supplied per test. */
function ctxWith(services) {
  return { get: (key, _soft) => services[key] };
}

test('a full catalog is enumerated provider by provider', async () => {
  const ctx = ctxWith({
    llm: {
      listProviders: () => [
        { id: 'deepseek-official', name: 'DeepSeek' },
        { id: 'local', name: 'Local' },
      ],
      async listModels(provider) {
        if (provider === 'deepseek-official') {
          return [
            { provider, id: 'deepseek-v4-flash', name: 'V4 Flash', description: 'fast' },
            { provider, id: 'deepseek-v4-pro', name: 'V4 Pro' },
          ];
        }
        return [{ provider, id: 'llama-3', name: 'Llama 3', inputModalities: ['text'] }];
      },
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }) },
  });

  const result = await ops.modelsOp(ctx);
  assert.equal(result.llmAvailable, true);
  assert.equal(result.providers.length, 2);
  const official = result.providers.find((entry) => entry.id === 'deepseek-official');
  assert.equal(official.name, 'DeepSeek');
  assert.equal(official.enumerable, true);
  assert.deepEqual(official.models.map((model) => model.id), ['deepseek-v4-flash', 'deepseek-v4-pro']);
  assert.equal(official.models[0].description, 'fast');
  assert.deepEqual(result.providers.find((entry) => entry.id === 'local').models[0].inputModalities, ['text']);
  assert.deepEqual(result.defaultRoute, { provider: 'deepseek-official', model: 'deepseek-v4-flash' });
  assert.equal(result.error, '');
});

test('a provider that cannot list models stays selectable', async () => {
  const ctx = ctxWith({
    llm: {
      listProviders: () => [{ id: 'custom-openai' }],
      async listModels() {
        throw new Error('this endpoint has no catalog');
      },
    },
  });

  const result = await ops.modelsOp(ctx);
  assert.equal(result.llmAvailable, true);
  assert.equal(result.providers.length, 1, 'the provider must not vanish');
  assert.equal(result.providers[0].enumerable, false);
  assert.deepEqual(result.providers[0].models, []);
  // The failure is reported, not swallowed silently.
  assert.match(result.error, /no catalog/u);
});

test('a host without an llm service reports it instead of throwing', async () => {
  const result = await ops.modelsOp(ctxWith({}));
  assert.equal(result.llmAvailable, false);
  assert.deepEqual(result.providers, []);
  assert.equal(result.defaultRoute, null);
  assert.match(result.error, /no llm service/u);
});

test('an adapter that throws from listProviders still yields a usable answer', async () => {
  const ctx = ctxWith({
    llm: {
      listProviders() {
        throw new Error('registry unavailable');
      },
    },
  });
  const result = await ops.modelsOp(ctx);
  assert.equal(result.llmAvailable, true);
  assert.deepEqual(result.providers, []);
  assert.match(result.error, /listProviders failed/u);
});

test('provider entries without an id are skipped', async () => {
  const ctx = ctxWith({
    llm: {
      listProviders: () => [{ name: 'no id' }, { id: 'ok', name: 'OK' }],
      async listModels() {
        return [];
      },
    },
  });
  const result = await ops.modelsOp(ctx);
  assert.deepEqual(result.providers.map((entry) => entry.id), ['ok']);
});

test('a model without an id is skipped', async () => {
  const ctx = ctxWith({
    llm: {
      listProviders: () => [{ id: 'p' }],
      async listModels(provider) {
        return [{ provider, name: 'nameless' }, { provider, id: 'good', name: 'Good' }];
      },
    },
  });
  const result = await ops.modelsOp(ctx);
  assert.deepEqual(result.providers[0].models.map((model) => model.id), ['good']);
});

test('models is reachable over the RPC table', async () => {
  assert.equal(ops.hasRpcMethod('models'), true);
  const value = await ops.dispatchRpc(ctxWith({}), {}, 'models', {});
  assert.equal(value.llmAvailable, false);
});

test('a named workspace is honoured only when absolute', () => {
  const ctx = ctxWith({});
  assert.equal(ops.workspaceFor(ctx, null, { workspace: '/srv/repo' }), '/srv/repo');
  // A relative value must not silently resolve against the host's cwd.
  assert.equal(ops.workspaceFor(ctx, null, { workspace: 'repo' }), null);
  assert.equal(ops.workspaceFor(ctx, null, { workspace: '   ' }), null);
});

test('an unresolvable workspace is null, never the host cwd', () => {
  // The host process runs with its cwd at the profile directory, so falling
  // back there would grow a wiki under ~/.dsh/profiles/<name>/.dsh/repowiki.
  assert.equal(ops.workspaceFor(ctxWith({}), null, {}), null);
  assert.notEqual(ops.workspaceFor(ctxWith({}), null, {}), process.cwd());
});

test('requireWorkspace turns a missing workspace into an actionable error', () => {
  assert.throws(
    () => ops.requireWorkspace(ctxWith({}), null, {}),
    (error) => error.code === 'no-workspace' && /no workspace is open/u.test(error.message),
  );
  // A registered workspace is used without being named.
  const ctx = ctxWith({ workspaceRegistry: { list: () => [{ path: '/srv/one' }, { path: '/srv/two' }] } });
  assert.equal(ops.requireWorkspace(ctx, null, {}), '/srv/one');
  // An explicit absolute workspace wins over the registry.
  assert.equal(ops.requireWorkspace(ctx, null, { workspace: '/srv/two' }), '/srv/two');
});
