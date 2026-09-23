// Cordis integration smoke test for dsh-ai-proxy against a mock gateway.
// Run with:
//   node --test test/smoke.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import z from '@deepseek-ai/schemastery'
import { Context, Service } from '@deepseek-ai/cordis'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import * as plugin from '../lib/index.js'
const { internals, resolveOptions, AUTH_RPC_CHANNEL, PI_AI_NS } = plugin

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(cond, timeoutMs = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (cond()) return true
    await sleep(20)
  }
  return cond()
}

// ── fakes ──────────────────────────────────────────────────────────────────

class FakeCreds extends Service {
  constructor(ctx) {
    super(ctx, 'credentials')
    this.store = new Map()
  }
  async resolve(ref) {
    const value = this.store.get(String(ref))
    return value === undefined ? undefined : { value, source: 'test' }
  }
  async set(ref, value) {
    this.store.set(String(ref), value)
    this.notifyUpdated(ref)
  }
  async unset(ref) {
    this.store.delete(String(ref))
    this.notifyUpdated(ref)
  }
  async describe(ref) { return { configured: this.store.has(String(ref)), writable: true } }
  /** Mirror the real provider's contained fan-out after a committed write. */
  notifyUpdated(ref) {
    for (const listener of this.ctx.events.dispatch('emit', ['credentials/updated', ref])) {
      try { listener(ref) } catch { /* contained */ }
    }
  }
}

class MemSettings extends SettingsProvider {
  constructor(ctx, doc = {}) {
    super(ctx)
    this.doc = structuredClone(doc)
    this.persisted = []
  }
  async load() { return structuredClone(this.doc) }
  async persist(ns, section) {
    this.doc[ns] = structuredClone(section)
    this.persisted.push({ ns, section: structuredClone(section) })
  }
  pushExternal(doc) {
    this.doc = structuredClone(doc)
    this.publish(structuredClone(doc))
  }
  get writable() { return true }
}

class FakeConnection extends Service {
  constructor(ctx) {
    super(ctx, 'connection')
    this.registrations = new Map()
    this.rpc = {
      handle: (channel, handler, options) => {
        const registration = { channel, handler, options }
        this.registrations.set(channel, registration)
        return async () => { this.registrations.delete(channel) }
      },
    }
  }

  registration(channel = AUTH_RPC_CHANNEL) {
    return this.registrations.get(channel)
  }
}

function makeCtx(settingsDoc) {
  const ctx = new Context()
  new LlmRuntime(ctx)
  const settings = new MemSettings(ctx, settingsDoc)
  const creds = new FakeCreds(ctx)
  const connection = new FakeConnection(ctx)
  return { ctx, creds, connection, settings }
}

/** Stand in for the host's official llm-pi-ai settings section. */
async function enablePiAi(ctx) {
  // Registered through an injected mini-plugin so the settings document is
  // already loaded (Service.init published) before the section resolves.
  await ctx.plugin({
    name: 'test-enable-pi-ai',
    inject: ['settings'],
    apply(c) {
      c.settings.register(PI_AI_NS, z.object({ providers: z.dict(z.any()).default({}) }), { base: {} })
    },
  })
}

const materialized = (settings) => settings.doc[PI_AI_NS]?.providers?.[plugin.PROVIDER]

// ── mock gateway ───────────────────────────────────────────────────────────

function mockGateway() {
  const requests = []
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const auth = req.headers.authorization ?? ''
    const readBody = () => new Promise((resolve) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => resolve(body))
    })
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ issuer: base, authorization_endpoint: base + '/oauth/authorize', token_endpoint: base + '/oauth/token' }))
      return
    }
    if (url.pathname === '/v1/models') {
      requests.push({ path: url.pathname, auth })
      if (auth === 'Bearer acc-old') {
        res.statusCode = 401
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: { message: 'token expired' } }))
        return
      }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ object: 'list', data: [
        { id: 'claude-sonnet-4-5', context_window: 200000, effort_levels: ['low', 'medium', 'high'], modality: 'text', input_modalities: ['text', 'image'] },
        { id: 'text-only-model', modality: 'text', input_modalities: ['text'] },
        { id: 'gpt-image-2', modality: 'image' },
      ] }))
      return
    }
    if (url.pathname === '/oauth/token') {
      void readBody().then((body) => {
        const params = new URLSearchParams(body)
        requests.push({ path: url.pathname, params: Object.fromEntries(params) })
        const grant = params.get('grant_type')
        if (grant === 'refresh_token' && params.get('refresh_token') === 'ref-1') {
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ access_token: 'acc-new', token_type: 'Bearer', expires_in: 3600, refresh_token: 'ref-new' }))
        } else if (grant === 'authorization_code' && params.get('code') === 'mock-code') {
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ access_token: 'acc-code', token_type: 'Bearer', expires_in: 3600, refresh_token: 'ref-code' }))
        } else {
          res.statusCode = 400
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'bad grant' }))
        }
      })
      return
    }
    if (url.pathname === '/oauth/revoke') {
      requests.push({ path: url.pathname })
      res.end('')
      return
    }
    res.statusCode = 404
    res.end('not found')
  })
  let base = ''
  server.unref()
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      base = 'http://127.0.0.1:' + server.address().port
      resolve({ url: base, requests, close: () => server.close() })
    })
  })
}

// ── tests ──────────────────────────────────────────────────────────────────

test('materializes the gateway as one llm-pi-ai route, leaving hand-written ones alone', async () => {
  const gw = await mockGateway()
  const { ctx, creds, settings } = makeCtx()
  try {
    await enablePiAi(ctx)
    settings.pushExternal({
      [PI_AI_NS]: { providers: { 'manual-route': { api: 'openai-completions', baseURL: 'https://manual.example/v1' } } },
    })
    creds.store.set('AIPROXY_API_KEY', 'sk-test')
    await ctx.plugin(plugin, { baseURL: gw.url, clientId: 'dsh', apiKeyEnv: 'AIPROXY_API_KEY' })
    assert.equal(await waitFor(() => materialized(settings) !== undefined), true, 'route materialized')

    assert(!ctx.llm.listProviders().some((p) => p.id === 'ai-proxy'), 'no self-registered adapter: the host route serves requests')

    const profile = materialized(settings)
    assert.equal(profile.api, 'openai-completions')
    assert.equal(profile.baseURL, gw.url + '/v1')
    assert.equal(profile.apiKeyEnv, 'AIPROXY_API_KEY')
    assert.deepEqual(profile.headers, { 'x-ai-proxy-client': 'dsh' })
    assert.equal('reasoning' in profile, false, 'no static profile.reasoning override')
    assert.deepEqual(profile.compat, { supportsDeveloperRole: false },
      'materialized OpenAI-compatible route refuses the developer role')
    assert.equal(profile.models.length, 3)
    assert.deepEqual(profile.models[0], {
      id: 'claude-sonnet-4-5',
      contextWindow: 200000,
      input: ['text', 'image'],
      reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' },
    })
    assert.deepEqual(profile.models[1].reasoningEfforts, false, 'model without a ladder is non-reasoning')
    assert.deepEqual(profile.models[2].input, ['text'], 'undisclosed media defaults to text')

    assert.deepEqual(settings.doc[PI_AI_NS].providers['manual-route'], {
      api: 'openai-completions', baseURL: 'https://manual.example/v1',
    }, 'hand-written routes in the same section are untouched')
    assert(gw.requests.some((r) => r.path === '/v1/models' && r.auth === 'Bearer sk-test'), 'models fetched with static key')
  } finally {
    gw.close()
  }
})

test('host without llm-pi-ai degrades to a warning without writing foreign sections', async () => {
  const gw = await mockGateway()
  const { ctx, creds, connection, settings } = makeCtx()
  try {
    creds.store.set('AIPROXY_API_KEY', 'sk-test')
    await ctx.plugin(plugin, { baseURL: gw.url, clientId: 'dsh', apiKeyEnv: 'AIPROXY_API_KEY' })
    await sleep(200)
    assert.equal(settings.doc[PI_AI_NS], undefined, 'nothing written to an unmounted section')
    assert.equal(settings.persisted.some((p) => p.ns === PI_AI_NS), false)
    assert(connection.registration() !== undefined, 'RPC channel still registered')
  } finally {
    gw.close()
  }
})

test('auth RPC reads and writes the gateway address host-side', async () => {
  const gw = await mockGateway()
  const { ctx, creds, connection, settings } = makeCtx()
  try {
    enablePiAi(ctx)
    await ctx.plugin(plugin, { clientId: 'dsh' })
    const handler = connection.registration().handler
    assert.deepEqual(await handler('config', {}), {
      ok: true,
      value: {
        baseURL: 'http://localhost:18080',
        clientId: 'dsh',
        apiFormat: 'chat/completions',
        defaultReasoningEffort: 'highest',
      },
    })
    const written = await handler('setBaseURL', { baseURL: gw.url + '/' })
    assert.equal(written.ok, true)
    assert.equal(written.value.baseURL, gw.url)
    assert.equal(settings.doc['ai-proxy'].baseURL, gw.url)

    const writtenEffort = await handler('setGateway', { defaultReasoningEffort: 'lowest' })
    assert.equal(writtenEffort.ok, true)
    assert.equal(writtenEffort.value.defaultReasoningEffort, 'lowest')
    assert.equal(settings.doc['ai-proxy'].defaultReasoningEffort, 'lowest')

    creds.store.set('AIPROXY_ACCESS_TOKEN', 'sk-test')
    const refreshed = await handler('refreshModels', {})
    assert.equal(refreshed.ok, true)
    assert.equal(refreshed.value.count, 3)
    assert.equal(refreshed.value.models[0].id, 'claude-sonnet-4-5')
    assert.equal((await handler('setBaseURL', { baseURL: 'ftp://nope' })).ok, false)
    assert.equal((await handler('setBaseURL', { baseURL: '  ' })).ok, false)
    assert.equal((await handler('setBaseURL', {})).ok, false, 'setBaseURL requires exactly one baseURL field')
    assert.equal((await handler('config', { extra: 1 })).ok, false)
  } finally {
    gw.close()
  }
})

test('refreshModels re-materializes the catalog under the llm-pi-ai section', async () => {
  const gw = await mockGateway()
  const { ctx, creds, connection, settings } = makeCtx()
  try {
    enablePiAi(ctx)
    creds.store.set('AIPROXY_API_KEY', 'sk-test')
    await ctx.plugin(plugin, { baseURL: gw.url, clientId: 'dsh', apiKeyEnv: 'AIPROXY_API_KEY' })
    assert.equal(await waitFor(() => materialized(settings) !== undefined), true, 'initial materialization')
    const before = settings.persisted.filter((p) => p.ns === PI_AI_NS).length

    // Verify resolveModelInfo & resolveCallConfig auto-select highest effort for each model
    const mockModelInfo = {
      provider: 'ai-proxy',
      id: 'claude-sonnet-4-5',
      name: 'Claude Sonnet',
      reasoning: {
        efforts: [
          { id: 'low', name: 'Low' },
          { id: 'medium', name: 'Medium' },
          { id: 'high', name: 'High' },
        ],
      },
    }
    const origResolveModelInfo = ctx.llm.resolveModelInfo
    ctx.llm.registerAdapter(['ai-proxy'], {
      providerInfo: (p) => ({ id: p, name: 'AI Proxy' }),
      providerRetryPolicy: () => undefined,
      resolveModel: async () => mockModelInfo,
      prepareCall: async () => ({ model: mockModelInfo, stream: async function* () {} }),
    })

    const resolvedInfo = await ctx.llm.resolveModelInfo('ai-proxy', 'claude-sonnet-4-5')
    assert.equal(resolvedInfo.reasoning.defaultEffort, 'high', 'resolveModelInfo enriches defaultEffort with highest rung')

    const resolvedCall = await ctx.llm.resolveCallConfig({ provider: 'ai-proxy', model: 'claude-sonnet-4-5' })
    assert.equal(resolvedCall.reasoningEffort, 'high', 'resolveCallConfig defaults reasoningEffort to highest available rung')

    const refreshed = await connection.registration().handler('refreshModels', {})
    assert.equal(refreshed.ok, true)
    assert.equal(await waitFor(() =>
      settings.persisted.filter((p) => p.ns === PI_AI_NS).length > before), true, 'section rewritten after refresh')
    assert.equal(materialized(settings).models.length, 3)
  } finally {
    gw.close()
  }
})

test('changing the API format through settings re-materializes protocol and base', async () => {
  const gw = await mockGateway()
  const { ctx, creds, connection, settings } = makeCtx()
  try {
    enablePiAi(ctx)
    creds.store.set('AIPROXY_API_KEY', 'sk-test')
    await ctx.plugin(plugin, { baseURL: gw.url, clientId: 'dsh', apiKeyEnv: 'AIPROXY_API_KEY' })
    assert.equal(await waitFor(() => materialized(settings)?.api === 'openai-completions'), true)

    const written = await connection.registration().handler('setGateway', { baseURL: gw.url + '/v1', apiFormat: 'anthropic-messages' })
    assert.equal(written.ok, true)
    assert.equal(await waitFor(() => materialized(settings)?.api === 'anthropic-messages'), true, 'protocol switch propagates')
    const profile = materialized(settings)
    assert.equal(profile.baseURL, gw.url, 'Anthropic SDK appends /v1/messages itself, the root stays bare')
    assert.equal(profile.models.length, 3)
  } finally {
    gw.close()
  }
})

test('a gateway outage at boot never overwrites the last good materialized route', async () => {
  const { ctx, creds, settings } = makeCtx()
  try {
    await enablePiAi(ctx)
    settings.pushExternal({
      [PI_AI_NS]: { providers: { [plugin.PROVIDER]: {
        api: 'openai-completions', baseURL: 'https://old.example/v1',
        reasoning: 'max',
        models: [{ id: 'previous-model' }],
      } } },
    })
    creds.store.set('AIPROXY_API_KEY', 'sk-test')
    // Port 1 refuses every connection: discovery cannot succeed at all.
    await ctx.plugin(plugin, { baseURL: 'http://127.0.0.1:1', clientId: 'dsh', apiKeyEnv: 'AIPROXY_API_KEY' })
    assert.equal(await waitFor(() => materialized(settings)?.reasoning === undefined), true,
      'a stale route-level reasoning is dropped even when discovery cannot rewrite the route')
    assert.equal(materialized(settings)?.models?.[0]?.id, 'previous-model', 'previous catalog stays intact')
    assert.equal(materialized(settings)?.baseURL, 'https://old.example/v1', 'the rest of the last good route stays')
  } finally {
    await ctx.stop?.()
  }
})

test('OAuth login: PKCE loopback flow stores rotating tokens', async () => {
  const gw = await mockGateway()
  const { ctx, creds } = makeCtx()
  try {
    await ctx.plugin(plugin, { baseURL: gw.url, clientId: 'dsh' })

    const api = new internals.AiProxyApi(ctx, () => resolveOptions({ baseURL: gw.url, clientId: 'dsh' }))
    const login = await api.login()
    assert.equal(login.state, 'authorizing')
    const authorize = new URL(login.authorizeUrl)
    assert.equal(authorize.pathname, '/oauth/authorize')
    assert.equal(authorize.searchParams.get('client_id'), 'dsh')
    assert.equal(authorize.searchParams.get('response_type'), 'code')
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(authorize.searchParams.get('scope'), 'api')
    assert.match(authorize.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/)
    const state = authorize.searchParams.get('state')
    const redirectUri = authorize.searchParams.get('redirect_uri')
    assert.match(redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/)

    const callback = await fetch(redirectUri + '?code=mock-code&state=' + state)
    assert.equal(callback.status, 200)
    assert.match(await callback.text(), /授权完成/)

    assert.equal(await waitFor(() => creds.store.has('AIPROXY_ACCESS_TOKEN')), true)
    const status = await api.authStatus()
    assert.equal(creds.store.get('AIPROXY_ACCESS_TOKEN'), 'acc-code')
    assert.equal(creds.store.get('AIPROXY_REFRESH_TOKEN'), 'ref-code')
    assert(Number(creds.store.get('AIPROXY_TOKEN_EXPIRY')) > Date.now())
    assert.equal(status.state, 'signed-in')
    assert.match(status.message, /^已登录/)
    const tokenCall = gw.requests.find((r) => r.path === '/oauth/token')
    assert.equal(tokenCall.params.grant_type, 'authorization_code')
    assert.equal(tokenCall.params.redirect_uri, redirectUri)
  } finally {
    gw.close()
  }
})

test('Host auth RPC revokes tokens and removes the materialized route', async () => {
  const gw = await mockGateway()
  const { ctx, creds, connection, settings } = makeCtx()
  try {
    await enablePiAi(ctx)
    settings.pushExternal({
      [PI_AI_NS]: { providers: { 'manual-route': { api: 'openai-completions', baseURL: 'https://manual.example/v1' } } },
    })
    creds.store.set('AIPROXY_ACCESS_TOKEN', 'acc-code')
    creds.store.set('AIPROXY_REFRESH_TOKEN', 'ref-code')
    creds.store.set('AIPROXY_TOKEN_EXPIRY', String(Date.now() + 3600000))
    await ctx.plugin(plugin, { baseURL: gw.url, clientId: 'dsh' })
    await sleep(50)

    assert.equal(connection.registration().channel, AUTH_RPC_CHANNEL)
    assert.deepEqual(connection.registration().options, { authority: 'trusted-host' })
    assert.deepEqual([...connection.registrations.keys()], [AUTH_RPC_CHANNEL])
    assert.equal(await waitFor(() => materialized(settings) !== undefined), true, 'route present while signed in')

    const before = await connection.registration().handler('status', {})
    assert.equal(before.value.state, 'signed-in')
    const result = await connection.registration().handler('logout', {})
    assert.deepEqual(result, { ok: true, value: { state: 'signed-out', message: '已退出登录' } })
    assert.equal(gw.requests.some((r) => r.path === '/oauth/revoke'), true, 'revoke request sent')
    assert.equal(creds.store.get('AIPROXY_ACCESS_TOKEN'), undefined)
    assert.equal(creds.store.get('AIPROXY_REFRESH_TOKEN'), undefined)
    assert.equal(await waitFor(() => materialized(settings) === undefined), true, 'route removed after logout')
    assert.deepEqual(settings.doc[PI_AI_NS].providers['manual-route'], {
      api: 'openai-completions', baseURL: 'https://manual.example/v1',
    }, 'other routes survive the removal')
    const section = ctx.settings.get('ai-proxy')
    assert.equal('oauth' in section, false)
    assert.equal('oauthStatus' in section, false)
  } finally {
    gw.close()
  }
})

test('401 on model discovery rotates the token once and retries', async () => {
  const gw = await mockGateway()
  const { ctx, creds, connection } = makeCtx()
  try {
    enablePiAi(ctx)
    creds.store.set('AIPROXY_ACCESS_TOKEN', 'acc-old')
    creds.store.set('AIPROXY_REFRESH_TOKEN', 'ref-1')
    creds.store.set('AIPROXY_TOKEN_EXPIRY', String(Date.now() + 3600000))
    await ctx.plugin(plugin, { baseURL: gw.url, clientId: 'dsh' })
    await sleep(50)

    const refreshed = await connection.registration().handler('refreshModels', {})
    assert.equal(refreshed.ok, true)
    assert.equal(refreshed.value.count, 3)
    // Startup probes precede the RPC: the rotation pair is the last two fetches.
    const modelCalls = gw.requests.filter((r) => r.path === '/v1/models')
    assert.deepEqual(modelCalls.slice(-2).map((r) => r.auth), ['Bearer acc-old', 'Bearer acc-new'])
    assert.equal(creds.store.get('AIPROXY_ACCESS_TOKEN'), 'acc-new')
    assert.equal(creds.store.get('AIPROXY_REFRESH_TOKEN'), 'ref-new')
  } finally {
    gw.close()
  }
})

test('proactive refresh timer rotates the token before expiry and re-materializes', async () => {
  const gw = await mockGateway()
  const { ctx, creds, settings } = makeCtx()
  try {
    enablePiAi(ctx)
    creds.store.set('AIPROXY_ACCESS_TOKEN', 'acc-old')
    creds.store.set('AIPROXY_REFRESH_TOKEN', 'ref-1')
    creds.store.set('AIPROXY_TOKEN_EXPIRY', String(Date.now() + 300))
    await ctx.plugin(plugin, { baseURL: gw.url, clientId: 'dsh' })

    assert.equal(await waitFor(() => creds.store.get('AIPROXY_ACCESS_TOKEN') === 'acc-new'), true,
      'timer fired at the stored expiry and rotated the token')
    assert.equal(creds.store.get('AIPROXY_REFRESH_TOKEN'), 'ref-new')
    assert.equal(await waitFor(() => materialized(settings)?.models?.length === 3), true,
      'catalog discovered with the fresh token lands in the materialized route')
  } finally {
    gw.close()
  }
})

test('startup migration removes legacy OAuth action and status fields only', async () => {
  const { ctx, settings } = makeCtx()
  settings.pushExternal({
    'ai-proxy': {
      baseURL: 'http://gateway.test',
      oauth: 'login',
      oauthStatus: '旧状态',
      modelCacheTtlMs: 120000,
    },
  })
  await ctx.plugin(plugin, { clientId: 'dsh' })
  assert.equal(await waitFor(() => settings.persisted.length > 0), true)
  assert.deepEqual(settings.doc['ai-proxy'], {
    baseURL: 'http://gateway.test',
    modelCacheTtlMs: 120000,
  })
})
