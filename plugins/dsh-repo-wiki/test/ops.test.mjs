/**
 * `lib/ops.js` tests: per-workspace settings and RPC routing.
 *
 * Qoder stores `quest.knowledge.repoWikiConfig` keyed by workspace; our
 * settings file mirrors that with a `workspaces` map. These tests pin the
 * merge order (defaults < config < global stored < workspace stored) and the
 * isolation between two workspaces.
 *
 * Run: node --test test/ops.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DSH_HOME = await mkdtemp(path.join(tmpdir(), 'rw-ops-home-'));

const {
  effectiveSettings,
  hasRpcMethod,
  resetSettings,
  saveSettings,
  sanitizeSettings,
  settingsFilePath,
  dispatchRpc,
  workspacesOp,
} = await import('../lib/ops.js');

test('workspace-scoped values override globals without leaking', async () => {
  const wsA = '/tmp/workspace-a';
  const wsB = '/tmp/workspace-b';

  await resetSettings(null);
  await saveSettings(null, { language: 'en', maxFiles: 5000 });
  await saveSettings(null, { language: 'zh' }, wsA);

  const a = await effectiveSettings(null, wsA);
  const b = await effectiveSettings(null, wsB);
  const global = await effectiveSettings(null);

  assert.equal(a.values.language, 'zh', 'workspace A keeps its own language');
  assert.equal(a.values.maxFiles, 5000, 'workspace A inherits the global maxFiles');
  assert.equal(b.values.language, 'en', 'workspace B sees only the global value');
  assert.equal(global.values.language, 'en');

  // The file layout: top-level keys are global, workspaces carry overrides.
  const stored = JSON.parse(await readFile(settingsFilePath(), 'utf8'));
  assert.equal(stored.language, 'en');
  assert.equal(stored.workspaces[wsA].language, 'zh');
  assert.equal(stored.workspaces[wsB], undefined);
});

test('resetSettings(workspace) removes only that workspace', async () => {
  const wsA = '/tmp/reset-a';
  await resetSettings(null);
  await saveSettings(null, { language: 'en' });
  await saveSettings(null, { maxFiles: 1111 }, wsA);

  await resetSettings(null, wsA);
  const scoped = await effectiveSettings(null, wsA);
  assert.equal(scoped.values.maxFiles, 10000, 'falls back to the default, not the removed override');

  const stored = JSON.parse(await readFile(settingsFilePath(), 'utf8'));
  assert.equal(stored.language, 'en', 'global values survive a scoped reset');
  assert.deepEqual(stored.workspaces ?? {}, {});
});

test('sanitizeSettings does not flag the workspaces container', () => {
  const { warnings } = sanitizeSettings({ language: 'zh', workspaces: { '/x': { language: 'en' } } });
  assert.deepEqual(warnings, []);
});

test('the retry RPC is routed', () => {
  assert.equal(hasRpcMethod('retry'), true);
  assert.equal(hasRpcMethod('synchronize'), true);
});

test('workspace picker maps the composer session without falling back to the first workspace', async () => {
  const registry = { list: () => [
    { path: '/tmp/a', title: 'A', sessionIds: ['a-session'] },
    { path: '/tmp/b', title: 'B', sessionIds: ['b-session'] },
  ] };
  const ctx = { get: (key) => key === 'workspaceRegistry' ? registry : undefined };
  const result = await workspacesOp(ctx, null, null, { sessionId: 'b-session' });
  assert.deepEqual(result.items.map((item) => item.path), ['/tmp/a', '/tmp/b']);
  assert.equal(result.sessionWorkspace, '/tmp/b');
  assert.equal((await workspacesOp(ctx, null, null, { sessionId: 'unknown' })).sessionWorkspace, '');
});

test('workspaces includeStatus annotates each item and survives failures', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'rw-status-ws-'));
  const registry = { list: () => [
    { path: workspace, title: 'WS' },
  ] };
  const ctx = { get: (key) => key === 'workspaceRegistry' ? registry : undefined };
  const result = await workspacesOp(ctx, null, null, { includeStatus: true });
  const item = result.items.find((entry) => entry.path === workspace);
  // A workspace without a wiki reports WIKI_INIT with the effective language.
  assert.equal(item.status.status, 'WIKI_INIT');
  assert.equal(item.status.workspace, workspace);
  assert.equal(typeof item.language, 'string');
  // Without includeStatus the items stay bare.
  const plain = await workspacesOp(ctx, null, null, {});
  assert.equal(plain.items[0].status, undefined);
});

test('global settings and reset do not target or erase the first workspace', async () => {
  const workspace = '/tmp/scope-test';
  const ctx = { get: (key) => key === 'workspaceRegistry' ? { list: () => [{ path: workspace }] } : undefined };
  await resetSettings(null);
  await saveSettings(null, { language: 'zh' }, workspace);
  await dispatchRpc(ctx, null, 'saveSettings', { scope: 'global', values: { language: 'en' } });
  assert.equal((await dispatchRpc(ctx, null, 'settings', { scope: 'global' })).settings.values.language, 'en');
  assert.equal((await effectiveSettings(null, workspace)).values.language, 'zh');
  await dispatchRpc(ctx, null, 'resetSettings', { scope: 'global' });
  assert.equal((await effectiveSettings(null, workspace)).values.language, 'zh');
});
