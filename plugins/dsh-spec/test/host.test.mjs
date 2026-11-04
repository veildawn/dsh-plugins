/**
 * Host half tests.
 *
 * The host row (`lib/index.js`) exists so the Web panel can read and write
 * specs in a session that did not select the Spec preset. That is the whole
 * contract, and these assertions pin its two halves:
 *
 *   1. the row never touches the tool or prompt registries, and
 *   2. the RPC channel is served for as long as the row is mounted.
 *
 * Run: node --test test/host.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DSH_HOME = await mkdtemp(path.join(tmpdir(), 'dsh-spec-host-home-'));

const { apply, inject, RPC_CHANNEL } = await import('../lib/index.js');

const workspace = await mkdtemp(path.join(tmpdir(), 'dsh-spec-host-ws-'));

/** A context that records every registry the host row must not touch. */
function makeCtx(options = {}) {
  const calls = { tools: 0, sections: 0, contexts: 0, variables: 0, disposers: 0 };
  let rpcHandler = null;
  let rpcChannel = null;
  let disposed = 0;
  const ctx = {
    tools: {
      register: () => {
        calls.tools += 1;
        return () => {};
      },
    },
    systemPrompt: {
      section: () => {
        calls.sections += 1;
        return () => {};
      },
      context: () => {
        calls.contexts += 1;
        return () => {};
      },
      variable: () => {
        calls.variables += 1;
        return () => {};
      },
    },
    connection: {
      rpc: {
        handle: (channel, handler, handlerOptions) => {
          rpcChannel = channel;
          rpcHandler = handler;
          ctx.handlerOptions = handlerOptions;
          return async () => {
            disposed += 1;
            rpcHandler = null;
          };
        },
      },
    },
    on: (event, listener) => {
      if (event === 'dispose') ctx.disposeListeners.push(listener);
    },
    disposeListeners: [],
    inject: () => {
      calls.disposers += 1;
    },
    get: options.get ?? (() => undefined),
    logger: { warn: () => {} },
  };
  if (options.withoutConnection === true) delete ctx.connection;
  apply(ctx, options.config ?? {});
  return {
    ctx,
    calls,
    get rpcHandler() { return rpcHandler; },
    get rpcChannel() { return rpcChannel; },
    get disposed() { return disposed; },
    call: async (method, payload = {}) => rpcHandler(method, payload),
  };
}

test('the host row injects only the RPC carrier', () => {
  assert.deepEqual(inject, ['connection']);
});

test('the host row registers no tools and no prompt contributions', () => {
  const host = makeCtx();
  assert.equal(host.calls.tools, 0, 'tools.register must never be called');
  assert.equal(host.calls.sections, 0, 'systemPrompt.section must never be called');
  assert.equal(host.calls.contexts, 0, 'systemPrompt.context must never be called');
  assert.equal(host.calls.variables, 0, 'systemPrompt.variable must never be called');
});

test('the host row mounts without a tools or systemPrompt service at all', async () => {
  // Only `connection` is available: the composition may omit both registries.
  const host = makeCtx();
  const described = await host.call('describe', {});
  assert.equal(described.ok, true);
  assert.equal(described.value.workspace, process.cwd());
});

test('the host row serves the RPC channel on /dsh-spec as trusted-host', async () => {
  const host = makeCtx();
  assert.equal(host.rpcChannel, RPC_CHANNEL);
  assert.equal(host.ctx.handlerOptions?.authority, 'trusted-host');
  for (const method of ['describe', 'list']) {
    const result = await host.call(method, {});
    assert.equal(result.ok, true, `${method} should answer`);
  }
});

test('every documented RPC method is reachable', async () => {
  // Pin the workspace so a routing check can never write into the repository.
  const workspace = await mkdtemp(path.join(tmpdir(), 'dsh-spec-rpc-'));
  const host = makeCtx({
    get: (key) => (key === 'workspaceRegistry' ? { list: () => [{ path: workspace }] } : undefined),
  });
  const methods = [
    'describe', 'list', 'get', 'document', 'check', 'create',
    'write', 'taskUpdate', 'next', 'pbt', 'resync', 'bind', 'unbind', 'saveDraft',
    'saveSettings', 'resetSettings',
  ];
  for (const method of methods) {
    let result;
    try {
      result = await host.call(method, {
        feature: 'missing-spec', title: 'X', taskId: '1',
        document: 'requirements', content: '# Requirements\n', status: 'not_started', values: {},
      });
    } catch (error) {
      assert.fail(`${method} threw instead of answering: ${error.message}`);
    }
    // Each answers: either a value or a structured SpecError. An unknown-method
    // rejection is what this test rules out.
    assert.equal(typeof result.ok, 'boolean', `${method} must answer with an envelope`);
    if (result.ok === false) assert.notEqual(result.error.code, 'unknown-method', `${method} must be routed`);
  }
  // The routing check wrote inside the pinned workspace, never the repository.
  const { readdir } = await import('node:fs/promises');
  const created = await readdir(path.join(workspace, '.kiro', 'specs'));
  assert.deepEqual(created, ['missing-spec']);
});

test('the RPC channel is unregistered when the row is disposed', async () => {
  const host = makeCtx();
  assert.equal(host.ctx.disposeListeners.length, 1);
  await host.ctx.disposeListeners[0]();
  assert.equal(host.disposed, 1);
  assert.equal(host.rpcHandler, null);
});

test('a missing connection.rpc leaves the row mounted and warns instead of throwing', () => {
  const host = makeCtx({ withoutConnection: true });
  assert.equal(host.rpcChannel, null);
  assert.equal(host.ctx.disposeListeners.length, 0);
});

test('describe reports whether the calling session runs the spec preset', async () => {
  const agentPresets = { composedPreset: () => 'spec' };
  const agents = { get: (id) => (id === 's1' ? { ctx: {} } : undefined) };
  const host = makeCtx({ get: (key) => ({ agentPresets, agents })[key] });
  const active = await host.call('describe', { sessionId: 's1' });
  assert.equal(active.value.presetActive, true);

  const other = { composedPreset: () => 'standard' };
  const inactive = makeCtx({ get: (key) => ({ agentPresets: other, agents })[key] });
  const result = await inactive.call('describe', { sessionId: 's1' });
  assert.equal(result.value.presetActive, false);

  // No registry at all: the field is simply absent from the answer.
  const bare = makeCtx();
  const absent = await bare.call('describe', {});
  assert.equal(absent.value.presetActive, undefined);
});

test('describe reports an explicitly requested spec and its fixed type', async () => {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const workspace = await mkdtemp(path.join(tmpdir(), 'dsh-spec-active-'));
  const specDir = path.join(workspace, '.kiro', 'specs', 'locked-type');
  await mkdir(specDir, { recursive: true });
  await writeFile(path.join(specDir, '.config.kiro'), JSON.stringify({ specType: 'bugfix', workflowType: 'requirements-first' }));
  await writeFile(path.join(specDir, 'bugfix.md'), '# Bugfix Document\n');

  // No agentPresets/agents registry: only the workspace registry resolves.
  const host = makeCtx({
    get: (key) => (key === 'workspaceRegistry' ? { list: () => [{ path: workspace }] } : undefined),
  });

  // An explicit feature selects that spec without changing its type.
  const explicit = await host.call('describe', { feature: 'locked-type' });
  assert.equal(explicit.value.activeSpec.feature, 'locked-type');
  assert.equal(explicit.value.activeSpec.specType, 'bugfix');
  assert.equal(typeof explicit.value.activeSpec.phase, 'string');

  // Repeated reads agree: the type comes from .config.kiro, not from state.
  const again = await host.call('describe', { feature: 'locked-type' });
  assert.deepEqual(again.value.activeSpec, explicit.value.activeSpec);
});

test('an existing workspace spec never auto-binds a session', async () => {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const workspace = await mkdtemp(path.join(tmpdir(), 'dsh-spec-unbound-'));
  const specDir = path.join(workspace, '.kiro', 'specs', 'someone-else');
  await mkdir(specDir, { recursive: true });
  await writeFile(path.join(specDir, '.config.kiro'), JSON.stringify({ specType: 'bugfix', workflowType: 'requirements-first' }));
  await writeFile(path.join(specDir, 'bugfix.md'), '# Bugfix\n');

  const host = makeCtx({
    get: (key) => (key === 'workspaceRegistry' ? { list: () => [{ path: workspace }] } : undefined),
  });
  // No session and no explicit feature: the workspace has a spec, but this
  // session did not choose it, so it must stay unbound.
  const result = await host.call('describe', {});
  assert.equal(result.ok, true);
  assert.equal(result.value.activeSpec, null);
  assert.equal(result.value.binding, null);
  const session = await host.call('describe', { sessionId: 'never-bound' });
  assert.equal(session.value.activeSpec, null);
});

test('describe reports no active spec for an empty workspace', async () => {
  const empty = await mkdtemp(path.join(tmpdir(), 'dsh-spec-none-'));
  const host = makeCtx({
    get: (key) => (key === 'workspaceRegistry' ? { list: () => [{ path: empty }] } : undefined),
  });
  const result = await host.call('describe', {});
  assert.equal(result.ok, true);
  assert.equal(result.value.activeSpec, null);
});

test('bind associates one session and leaves the others unbound', async () => {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const workspace = await mkdtemp(path.join(tmpdir(), 'dsh-spec-bind-'));
  const specDir = path.join(workspace, '.kiro', 'specs', 'bind-me');
  await mkdir(specDir, { recursive: true });
  await writeFile(path.join(specDir, '.config.kiro'), JSON.stringify({ specType: 'feature', workflowType: 'requirements-first' }));
  await writeFile(path.join(specDir, 'requirements.md'), '# Requirements Document\n');

  const host = makeCtx({
    get: (key) => (key === 'workspaceRegistry' ? { list: () => [{ path: workspace }] } : undefined),
  });

  const bound = await host.call('bind', { sessionId: 's-bind-a', feature: 'bind-me' });
  assert.equal(bound.ok, true);
  assert.deepEqual(bound.value.binding, { feature: 'bind-me' });
  assert.equal(bound.value.activeSpec.specType, 'feature');

  const mine = await host.call('describe', { sessionId: 's-bind-a' });
  assert.equal(mine.value.activeSpec.feature, 'bind-me');
  assert.deepEqual(mine.value.binding, { feature: 'bind-me' });

  // Another session reading the same workspace stays unbound.
  const other = await host.call('describe', { sessionId: 's-bind-b' });
  assert.equal(other.value.activeSpec, null);
  assert.equal(other.value.binding, null);

  const dropped = await host.call('unbind', { sessionId: 's-bind-a' });
  assert.equal(dropped.value.binding, null);
  const after = await host.call('describe', { sessionId: 's-bind-a' });
  assert.equal(after.value.activeSpec, null);

  // Binding a feature that is not a spec is refused.
  const missing = await host.call('bind', { sessionId: 's-bind-a', feature: 'nope' });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'spec-not-found');
});

test('create consumes the session draft and binds the created spec', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'dsh-spec-draft-'));
  const host = makeCtx({
    get: (key) => ({ sessions: { get: (id) => (id === 's-draft' ? { header: { cwd: workspace } } : undefined) } })[key],
  });

  const draft = await host.call('saveDraft', { sessionId: 's-draft', specType: 'bugfix', workflowType: 'fast-task' });
  assert.deepEqual(draft.value.draft, { specType: 'bugfix', workflowType: 'fast-task' });

  const created = await host.call('create', { sessionId: 's-draft', title: 'Broken Checkout' });
  assert.equal(created.ok, true, created.error?.message);
  assert.equal(created.value.specType, 'bugfix');
  assert.equal(created.value.workflowType, 'fast-task');
  assert.deepEqual(created.value.binding, { feature: created.value.feature });

  const { readFile } = await import('node:fs/promises');
  const config = JSON.parse(await readFile(path.join(created.value.directory, '.config.kiro'), 'utf8'));
  assert.equal(config.specType, 'bugfix');
  assert.equal(config.workflowType, 'fast-task');
  // A bugfix spec writes bugfix.md, not requirements.md.
  assert.ok(created.value.files.includes('bugfix.md'), created.value.files.join(','));

  const after = await host.call('describe', { sessionId: 's-draft' });
  assert.equal(after.value.activeSpec.feature, created.value.feature);
  // The draft was consumed by the creation.
  assert.equal(after.value.draft, null);
});

test('every RPC write uses the calling session workspace, not the registry head', async () => {
  const { mkdir, readdir } = await import('node:fs/promises');
  const sessionWs = await mkdtemp(path.join(tmpdir(), 'dsh-spec-session-ws-'));
  const otherWs = await mkdtemp(path.join(tmpdir(), 'dsh-spec-other-ws-'));
  await mkdir(path.join(otherWs, '.kiro', 'specs'), { recursive: true });

  const host = makeCtx({
    get: (key) => ({
      sessions: { get: (id) => (id === 's-ws' ? { header: { cwd: sessionWs } } : undefined) },
      workspaceRegistry: { list: () => [{ path: otherWs }] },
    })[key],
  });

  const created = await host.call('create', { sessionId: 's-ws', title: 'Session Scoped' });
  assert.equal(created.ok, true, created.error?.message);

  // The spec landed in the session's workspace...
  const mine = await readdir(path.join(sessionWs, '.kiro', 'specs'));
  assert.deepEqual(mine, [created.value.feature]);
  // ...and not in the registry's first workspace.
  const others = await readdir(path.join(otherWs, '.kiro', 'specs'));
  assert.deepEqual(others, []);

  const described = await host.call('describe', { sessionId: 's-ws' });
  assert.equal(described.value.workspace, sessionWs);
  assert.equal(described.value.root, path.join(sessionWs, '.kiro', 'specs'));

  const checked = await host.call('check', { sessionId: 's-ws', feature: created.value.feature });
  assert.equal(checked.ok, true, checked.error?.message);
  assert.equal(checked.value.root, path.join(sessionWs, '.kiro', 'specs'));
  assert.equal(checked.value.specs.length, 1);
});

test('a custom kiroDir drives listing, writing and checking consistently', async () => {
  const { readFile } = await import('node:fs/promises');
  const workspace = await mkdtemp(path.join(tmpdir(), 'dsh-spec-alt-root-'));
  const host = makeCtx({
    config: { kiroDir: 'docs' },
    get: (key) => ({ sessions: { get: (id) => (id === 's-root' ? { header: { cwd: workspace } } : undefined) } })[key],
  });

  const created = await host.call('create', { sessionId: 's-root', title: 'Alt Root' });
  assert.equal(created.ok, true, created.error?.message);
  const expectedRoot = path.join(workspace, 'docs', 'specs');
  assert.equal(path.dirname(created.value.directory), expectedRoot);

  const described = await host.call('describe', { sessionId: 's-root' });
  assert.equal(described.value.root, expectedRoot);
  assert.deepEqual(described.value.specs.map((spec) => spec.feature), [created.value.feature]);

  const written = await host.call('write', {
    sessionId: 's-root', feature: created.value.feature, document: 'design', content: '# Design Document\n',
  });
  assert.equal(written.ok, true, written.error?.message);
  assert.equal(written.value.path, path.join(expectedRoot, created.value.feature, 'design.md'));
  assert.match(await readFile(written.value.path, 'utf8'), /Design Document/u);

  const checked = await host.call('check', { sessionId: 's-root' });
  assert.equal(checked.value.root, expectedRoot);
  // The alternate root is the only one populated.
  await assert.rejects(readFile(path.join(workspace, '.kiro', 'specs', created.value.feature, 'design.md'), 'utf8'), { code: 'ENOENT' });
});

test('the panel\'s language localizes its findings, and only the panel\'s', async () => {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const workspace = await mkdtemp(path.join(tmpdir(), 'dsh-spec-lang-ws-'));
  const specDir = path.join(workspace, '.kiro', 'specs', 'lang-panel');
  await mkdir(specDir, { recursive: true });
  await writeFile(path.join(specDir, '.config.kiro'), JSON.stringify({ specType: 'feature', workflowType: 'requirements-first' }));
  // Two SHALL clauses in one criterion: a stable `ears/compound-criterion` hit.
  await writeFile(path.join(specDir, 'requirements.md'), [
    '# Requirements Document',
    '',
    '## Introduction',
    '',
    'A small spec.',
    '',
    '## Requirements',
    '',
    '### Requirement 1: Checkout',
    '',
    '**User Story:** AS a buyer, I WANT to pay, SO THAT I get the goods.',
    '',
    '#### Acceptance Criteria',
    '',
    '1. WHEN the cart is full, THE system SHALL charge the card AND SHALL send a receipt.',
    '',
  ].join('\n'));

  const host = makeCtx({
    get: (key) => ({
      sessions: { get: () => ({ header: { cwd: workspace } }) },
      workspaceRegistry: { list: () => [{ path: workspace }] },
    })[key],
  });

  const zh = await host.call('get', { feature: 'lang-panel', language: 'zh-CN' });
  assert.equal(zh.ok, true, zh.error?.message);
  const compound = zh.value.issues.find((item) => item.rule === 'ears/compound-criterion');
  assert.ok(compound, 'the fixture produces the finding this test localizes');
  assert.match(compound.message, /含多个 SHALL 子句/u);
  // The rule and its structured params survive: the panel rebuilds the sentence
  // from them, and a later locale switch must be able to re-localize.
  assert.deepEqual(compound.params, { where: 'Requirement 1, criterion 1', requirement: '1', criterion: '1' });

  const en = await host.call('get', { feature: 'lang-panel', language: 'en' });
  assert.match(en.value.issues.find((item) => item.rule === 'ears/compound-criterion').message, /multiple SHALL clauses/u);

  // The Agent's copy is the contract it is graded against, so `check` stays English.
  const check = await host.call('check', { feature: 'lang-panel', language: 'zh-CN' });
  assert.match(check.value.specs[0].issues.find((item) => item.rule === 'ears/compound-criterion').message, /multiple SHALL clauses/u);

  // A caller that does not report a language still gets a whole-language answer,
  // never a half-localized one.
  const described = await host.call('describe', {});
  assert.ok(['zh', 'en'].includes(described.value.language), described.value.language);
});
