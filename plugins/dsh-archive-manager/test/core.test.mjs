import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NS, RPC_CHANNEL, unarchiveSessions, deleteSessions, restoreDeleted,
  listSummaries, listDeleted, handleArchiveRpc,
  physicalDeleteSessions, restorePhysicalSessions, destroyPhysicalSessions,
  resolveOptions, resolveTrashDir,
} from '../lib/core.js';
import * as HostPlugin from '../lib/index.js';

/** Build a workspace-registry mock with the real private-method shape. */
function mockRegistry({ archivedSessionIds = [], workspaces = [] } = {}) {
  let state = { initialized: true, workspaceIds: [], archivedSessionIds };
  let tail = Promise.resolve();
  return {
    archivedSessionIds,
    list: () => workspaces,
    requireState: () => state,
    setState: async (next) => { state = next; },
    enqueueOperation: (operation) => {
      const result = tail.then(async () => operation());
      tail = result.then(() => {}, () => {});
      return result;
    },
    _state: () => state,
  };
}

function mockScope(initial = {}) {
  let section = initial;
  return {
    get: () => section,
    update: async (patch) => { section = { ...section, ...patch }; },
    replace: async (next) => { section = next; },
  };
}

/** In-memory fs (node:fs/promises shape) for testing physical deletes. */
function mockFsd(files = new Map()) {
  return {
    files,
    stat: async (p) => {
      if (!files.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return { size: 1 };
    },
    mkdir: async () => {},
    rename: async (from, to) => {
      if (!files.has(from)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      files.set(to, files.get(from));
      files.delete(from);
    },
    unlink: async (p) => { files.delete(p); },
  };
}

function mockCtx({ registry, scope, headers = [], live = [], artifacts = null, sessionTitle = null, projectionCache = null } = {}) {
  const liveSessions = new Map(live.map((id) => [id, { id, header: { id } }]));
  let locateImpl = (header) => {
    if (!artifacts) return undefined;
    const entry = artifacts.find((a) => a.id === String(header.id));
    return entry ? { kind: 'jsonl', path: entry.path } : undefined;
  };
  const services = {
    sessions: { get: (id) => liveSessions.get(id) },
  };
  if (sessionTitle) services.sessionTitle = sessionTitle;
  if (projectionCache) services.sessionProjectionCache = projectionCache;
  return {
    workspaceRegistry: registry,
    sessionPersistence: {
      list: async () => headers,
      locate: (header) => locateImpl(header),
    },
    get: (name) => services[name],
    settings: {
      register: (ns, schema, options) => {
        assert.equal(ns, NS);
        return scope ?? mockScope(options?.base ?? {});
      },
    },
    inject: (deps, fn) => { fn({ connection: { rpc: { handle: (...args) => { mockCtx.lastHandle = args; } } } }); },
  };
}

test('core: unarchiveSessions removes ids via the registry operation queue', async () => {
  const registry = mockRegistry({ archivedSessionIds: ['s1', 's2', 's3'] });
  await unarchiveSessions({ workspaceRegistry: registry }, ['s2']);
  assert.deepEqual(registry._state().archivedSessionIds, ['s1', 's3']);
});

test('core: unarchiveSessions is idempotent for ids outside the set', async () => {
  const registry = mockRegistry({ archivedSessionIds: ['s1'] });
  await unarchiveSessions({ workspaceRegistry: registry }, ['nope']);
  assert.deepEqual(registry._state().archivedSessionIds, ['s1']);
});

test('core: unarchiveSessions fails loud when the registry surface is missing', async () => {
  await assert.rejects(
    () => unarchiveSessions({ workspaceRegistry: {} }, ['s1']),
    /DSH version mismatch/,
  );
});

test('core: deleteSessions records soft tombstones and leaves the archive set untouched', async () => {
  const registry = mockRegistry({ archivedSessionIds: ['s1', 's2'] });
  const scope = mockScope({});
  const deleted = await deleteSessions(scope, ['s1']);
  assert.deepEqual(deleted, ['s1']);
  assert.equal(scope.get().tombstones[0].kind, 'soft');
  assert.deepEqual(registry._state().archivedSessionIds, ['s1', 's2']);
});

test('core: restoreDeleted clears soft tombstones only', async () => {
  const scope = mockScope({ tombstones: [
    { id: 's1', kind: 'soft', deletedAt: '2026-01-01T00:00:00Z' },
    { id: 's2', kind: 'physical', deletedAt: '2026-01-02T00:00:00Z', trashPath: '/t/s2', originalPath: '/o/s2' },
  ] });
  const restored = await restoreDeleted(scope, ['s1', 's2']);
  assert.deepEqual(restored, ['s1']);
  assert.deepEqual(scope.get().tombstones.map((t) => t.id), ['s2']);
});

test('core: listSummaries joins persistence headers with workspace accounting and filters tombstones', async () => {
  const registry = mockRegistry({
    archivedSessionIds: ['s1', 's2', 's3'],
    workspaces: [{ id: 'w1', title: 'Work', sessionIds: ['s1'] }],
  });
  const ctx = mockCtx({
    registry,
    headers: [
      { id: 's1', createdAt: 1000, cwd: '/work/proj-a' },
      { id: 's2', createdAt: 2000, cwd: undefined },
    ],
  });
  const scope = mockScope({ tombstones: [{ id: 's3', kind: 'soft', deletedAt: '2026-01-01T00:00:00Z' }] });
  const list = await listSummaries(ctx, scope);
  assert.equal(list.length, 2); // s3 tombstoned -> filtered out
  assert.deepEqual(list.map((item) => item.id), ['s2', 's1']); // newest first
  assert.equal(list[1].workspaceTitle, 'Work');
  assert.equal(list[1].title, 'proj-a'); // fallback: cwd basename (no title projection)
  assert.equal(list[0].workspaceTitle, '未分组 (Ungrouped)');
});

test('core: listSummaries reads the real session title from live sessions and the title projection cache', async () => {
  const registry = mockRegistry({
    archivedSessionIds: ['s1', 's2', 's3'],
    workspaces: [{ id: 'w1', title: 'Work', sessionIds: ['s1', 's2'] }],
  });
  // s1 live with a folded title; s2 cold with a cached title projection;
  // s3 cold without any title projection -> cwd basename fallback.
  const sessionTitle = {
    get: (session) => session.id === 's1' ? { title: '为 DSH 开发归档管理器' } : undefined,
  };
  const projectionCache = {
    cachedSnapshot: (header, offset) => {
      assert.equal(typeof offset, 'number');
      if (String(header.id) === 's2') return { asOfSeq: 5, values: { title: '设计一个归档管理插件' } };
      return undefined;
    },
  };
  const ctx = mockCtx({
    registry,
    live: ['s1'],
    headers: [
      { id: 's1', createdAt: 1000, cwd: '/work/a' },
      { id: 's2', createdAt: 2000, cwd: '/work/b' },
      { id: 's3', createdAt: 3000, cwd: '/work/c' },
    ],
    sessionTitle,
    projectionCache,
  });
  const scope = mockScope({});
  const list = await listSummaries(ctx, scope);
  const byId = Object.fromEntries(list.map((item) => [item.id, item]));
  assert.equal(byId['s1'].title, '为 DSH 开发归档管理器'); // live title wins
  assert.equal(byId['s2'].title, '设计一个归档管理插件');   // projection cache title
  assert.equal(byId['s3'].title, 'c');                       // fallback: cwd basename
});

test('core: listDeleted lists soft (still archived) and physical tombstones', async () => {
  const registry = mockRegistry({
    archivedSessionIds: ['s1', 's2'],
    workspaces: [{ id: 'w1', title: 'Work', sessionIds: ['s1'] }],
  });
  const ctx = mockCtx({ registry, headers: [{ id: 's1', createdAt: 1000, cwd: '/work/proj-a' }] });
  const scope = mockScope({ tombstones: [
    { id: 's1', kind: 'soft', deletedAt: '2026-02-01T00:00:00Z' },
    { id: 'gone', kind: 'soft', deletedAt: '2026-02-02T00:00:00Z' }, // no longer archived -> hidden
    { id: 's2', kind: 'physical', deletedAt: '2026-02-03T00:00:00Z', trashPath: '/t/s2', originalPath: '/o/s2' },
  ] });
  const rows = await listDeleted(ctx, scope);
  assert.deepEqual(rows.map((r) => r.id), ['s2', 's1']);
  assert.equal(rows[0].kind, 'physical');
  assert.equal(rows[0].trashPath, '/t/s2');
  assert.equal(rows[1].workspaceTitle, 'Work');
});

test('core: physicalDeleteSessions moves artifacts to trash, records tombstone, unarchives, refuses live sessions', async () => {
  const registry = mockRegistry({
    archivedSessionIds: ['s1', 's2', 's3'],
    workspaces: [{ id: 'w1', title: 'Work', sessionIds: ['s1', 's2'] }],
  });
  const ctx = mockCtx({
    registry,
    live: ['s3'], // s3 is live -> must be refused
    headers: [
      { id: 's1', createdAt: 1000, cwd: '/work/a' },
      { id: 's2', createdAt: 2000, cwd: '/work/b' },
      { id: 's3', createdAt: 3000, cwd: '/work/c' },
    ],
    artifacts: [
      { id: 's1', path: '/logs/work/a/s1.jsonl' },
      { id: 's2', path: '/logs/work/b/s2.jsonl' },
      { id: 's3', path: '/logs/work/c/s3.jsonl' },
    ],
  });
  const files = new Map([
    ['/logs/work/a/s1.jsonl', 'log-s1'],
    ['/logs/work/b/s2.jsonl', 'log-s2'],
    ['/logs/work/c/s3.jsonl', 'log-s3'],
  ]);
  const scope = mockScope({});
  const options = resolveOptions({ physicalDelete: true, trashDir: '/trash' });
  const result = await physicalDeleteSessions(ctx, scope, ['s1', 's2', 's3'], options, mockFsd(files));

  assert.deepEqual(result.moved.map((m) => m.id), ['s1', 's2']);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].id, 's3');
  assert.match(result.skipped[0].reason, /live/);

  // files moved to trash
  assert.equal(files.has('/logs/work/a/s1.jsonl'), false);
  assert.equal(files.has('/trash/s1.jsonl'), true);
  assert.equal(files.has('/trash/s2.jsonl'), true);
  // s3 untouched (live)
  assert.equal(files.has('/logs/work/c/s3.jsonl'), true);

  // tombstones recorded
  const tombstones = scope.get().tombstones;
  assert.equal(tombstones.length, 2);
  assert.deepEqual(tombstones.map((t) => t.id), ['s1', 's2']);
  assert.equal(tombstones[0].kind, 'physical');
  assert.equal(tombstones[0].trashPath, '/trash/s1.jsonl');
  assert.equal(tombstones[0].originalPath, '/logs/work/a/s1.jsonl');

  // archive set updated: s1/s2 removed, s3 stays
  assert.deepEqual(registry._state().archivedSessionIds, ['s3']);
});

test('core: physicalDeleteSessions records tombstone without move when the artifact is missing', async () => {
  const registry = mockRegistry({ archivedSessionIds: ['s1'] });
  const ctx = mockCtx({
    registry,
    headers: [{ id: 's1', createdAt: 1000, cwd: '/work/a' }],
    artifacts: [{ id: 's1', path: '/logs/work/a/s1.jsonl' }],
  });
  const files = new Map(); // artifact never materialized
  const scope = mockScope({});
  const result = await physicalDeleteSessions(ctx, scope, ['s1'], resolveOptions({ physicalDelete: true, trashDir: '/trash' }), mockFsd(files));
  assert.equal(result.moved.length, 1);
  assert.equal(result.moved[0].trashPath, null);
  assert.equal(scope.get().tombstones[0].originalPath, '/logs/work/a/s1.jsonl');
  assert.deepEqual(registry._state().archivedSessionIds, []);
});

test('core: physicalDeleteSessions refuses when no artifact resolves', async () => {
  const registry = mockRegistry({ archivedSessionIds: ['s1'] });
  const ctx = mockCtx({ registry, headers: [{ id: 's1', createdAt: 1000, cwd: '/work/a' }] });
  const scope = mockScope({});
  const result = await physicalDeleteSessions(ctx, scope, ['s1'], resolveOptions({ physicalDelete: true, trashDir: '/trash' }), mockFsd(new Map()));
  assert.equal(result.moved.length, 0);
  assert.equal(result.skipped[0].id, 's1');
  assert.match(result.skipped[0].reason, /no artifact/);
});

test('core: restorePhysicalSessions renames the artifact back and clears the tombstone', async () => {
  const registry = mockRegistry({ archivedSessionIds: [] });
  const ctx = mockCtx({ registry, headers: [] });
  const files = new Map([['/trash/s1.jsonl', 'log-s1']]);
  const scope = mockScope({ tombstones: [
    { id: 's1', kind: 'physical', deletedAt: '2026-01-01T00:00:00Z', trashPath: '/trash/s1.jsonl', originalPath: '/logs/work/a/s1.jsonl' },
  ] });
  const restored = await restorePhysicalSessions(ctx, scope, ['s1'], mockFsd(files));
  assert.deepEqual(restored, ['s1']);
  assert.equal(files.has('/trash/s1.jsonl'), false);
  assert.equal(files.has('/logs/work/a/s1.jsonl'), true);
  assert.equal(scope.get().tombstones.length, 0);
});

test('core: destroyPhysicalSessions unlinks the trash file irreversibly', async () => {
  const registry = mockRegistry({ archivedSessionIds: [] });
  const ctx = mockCtx({ registry, headers: [] });
  const files = new Map([['/trash/s1.jsonl', 'log-s1']]);
  const scope = mockScope({ tombstones: [
    { id: 's1', kind: 'physical', deletedAt: '2026-01-01T00:00:00Z', trashPath: '/trash/s1.jsonl', originalPath: '/logs/work/a/s1.jsonl' },
  ] });
  const destroyed = await destroyPhysicalSessions(ctx, scope, ['s1'], mockFsd(files));
  assert.deepEqual(destroyed, ['s1']);
  assert.equal(files.size, 0);
  assert.equal(scope.get().tombstones.length, 0);
});

test('core: resolveTrashDir falls back to dsh home and honors config', () => {
  const configured = resolveTrashDir(resolveOptions({ trashDir: '/custom' }));
  assert.equal(configured, '/custom');
  const defaulted = resolveTrashDir(resolveOptions({}));
  assert.equal(typeof defaulted, 'string');
  assert.ok(defaulted.endsWith('archive-manager') || defaulted.endsWith('archive-manager/trash') || defaulted.includes('archive-manager'));
});

test('core: handleArchiveRpc dispatches with the ok/error envelope and gates physical methods', async () => {
  const registry = mockRegistry({ archivedSessionIds: ['s1'] });
  const ctx = mockCtx({ registry, headers: [{ id: 's1', createdAt: 1000, cwd: '/work/a' }] });
  const scope = mockScope({});
  const opts = resolveOptions({ physicalDelete: false });

  const caps = await handleArchiveRpc(ctx, scope, opts, 'capabilities', {});
  assert.equal(caps.ok, true);
  assert.equal(caps.value.physicalDelete, false);

  const disabled = await handleArchiveRpc(ctx, scope, opts, 'deletePhysical', { sessionIds: ['s1'] });
  assert.equal(disabled.ok, false);
  assert.equal(disabled.error.code, 'disabled');

  const listResult = await handleArchiveRpc(ctx, scope, opts, 'list', {});
  assert.equal(listResult.ok, true);
  assert.equal(listResult.value.length, 1);
  assert.equal(listResult.value[0].id, 's1');

  const unarchiveResult = await handleArchiveRpc(ctx, scope, opts, 'unarchive', { sessionIds: ['s1'] });
  assert.equal(unarchiveResult.ok, true);
  assert.deepEqual(unarchiveResult.value.unarchivedIds, ['s1']);

  const badResult = await handleArchiveRpc(ctx, scope, opts, 'unarchive', {});
  assert.equal(badResult.ok, false);
  assert.equal(badResult.error.code, 'bad-request');

  const unknown = await handleArchiveRpc(ctx, scope, opts, 'nope', {});
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'method-not-found');
});

test('host: apply registers the settings namespace and the trusted-host RPC channel', async () => {
  assert.equal(HostPlugin.name, 'archive-manager');
  assert.deepEqual(HostPlugin.inject, ['workspaceRegistry', 'sessionPersistence', 'settings']);
  const calls = { handle: null, register: null };
  const ctx = {
    settings: {
      register: (ns, schema, options) => {
        calls.register = { ns, schema, options };
        return mockScope({});
      },
    },
    inject: (deps, fn) => {
      fn({
        connection: {
          rpc: {
            handle: (channel, handler, opts) => { calls.handle = { channel, handler, opts }; },
          },
        },
      });
    },
  };
  HostPlugin.apply(ctx, {});
  assert.equal(calls.register.ns, NS);
  assert.equal(calls.handle.channel, RPC_CHANNEL);
  assert.deepEqual(calls.handle.opts, { authority: 'trusted-host' });
  const result = await calls.handle.handler('list', {});
  assert.equal(result.ok, true);
});

test('client: bundle loads through __ModuleLoader__ with the single-arg factory contract', async () => {
  const captured = {};
  const fakeReact = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    Fragment: Symbol('Fragment'),
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useRef: (init) => ({ current: init }),
  };
  globalThis.window = {
    __ModuleLoader__: {
      load: (entry) => { captured.entry = entry; },
    },
    dispatchEvent: () => {},
    setTimeout: () => {},
    CustomEvent: class {},
  };
  globalThis.document = { getElementById: () => null, createElement: () => ({ appendChild: () => {} }), head: { appendChild: () => {} } };
  await import(`../lib/client.js?t=${Date.now()}`);
  const { entry } = captured;
  assert.equal(entry.id, 'dsh-archive-manager');
  assert.equal(typeof entry.factory, 'function');
  const module = { exports: {} };
  const exportsObj = entry.factory((name) => {
    if (name === 'react') return fakeReact;
    throw new Error(`unexpected require: ${name}`);
  }, undefined, undefined);
  assert.equal(typeof exportsObj.apply, 'function');
  assert.deepEqual(exportsObj.inject, ['slots', 'connection', 'workspaces']);
  delete globalThis.window;
  delete globalThis.document;
});
