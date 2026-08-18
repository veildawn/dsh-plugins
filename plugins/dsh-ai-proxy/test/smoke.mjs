// Cordis integration smoke test for dsh-ai-proxy against a mock gateway.
// Run with:
//   node --test test/smoke.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import * as plugin from '../lib/index.js'
const { internals, resolveOptions, AUTH_RPC_CHANNEL } = plugin

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

class FakeAttachments extends Service {
  constructor(ctx) {
    super(ctx, 'attachments')
    this.reads = []
  }
  async readImage(ref) {
    this.reads.push(ref)
    return { ref: { mediaType: ref.mediaType ?? 'image/png' }, data: Buffer.from('fake-image-bytes') }
  }
}

function makeCtx(settingsDoc) {
  const ctx = new Context()
  new LlmRuntime(ctx)
  const settings = new MemSettings(ctx, settingsDoc)
  const creds = new FakeCreds(ctx)
  const connection = new FakeConnection(ctx)
  const attachments = new FakeAttachments(ctx)
  return { ctx, creds, connection, settings, attachments }
}

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
    if (url.pathname === '/v1/chat/completions') {
      void readBody().then((body) => {
        const parsed = JSON.parse(body)
        requests.push({ path: url.pathname, auth, body: parsed })
        if (auth === 'Bearer acc-old') {
          res.statusCode = 401
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: { message: 'token expired' } }))
          return
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: 'thinking…' } }] }) + '\n\n')
        res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'hello from gateway' } }] }) + '\n\n')
        res.write('data: ' + JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 3 } } }) + '\n\n')
        res.end('data: [DONE]\n\n')
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

async function collect(stream) {
  const out = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

// ── tests ──────────────────────────────────────────────────────────────────

test('registration, catalog and reasoning ladders (static key)', async () => {
  const gw = await mockGateway()
  const { ctx, creds, settings } = makeCtx()
  try {
    creds.store.set('AIPROXY_API_KEY', 'sk-test')
    await ctx.plugin(plugin, { baseURL: gw.url, clientId: 'dsh', apiKeyEnv: 'AIPROXY_API_KEY' })
    await sleep(50)

    assert(ctx.llm.listProviders().some((p) => p.id === 'ai-proxy'), 'provider registered')
    assert(!ctx.llm.listConfigurableProviders().some((e) => e.settingsNs === 'ai-proxy'), 'unsupported Models editor stays hidden')
    const discovered = await ctx.llm.discoverModels('ai-proxy', { baseURL: gw.url, apiKey: 'one-shot-key' })
    assert.equal(discovered.length, 3)
    assert.equal(discovered[0].id, 'claude-sonnet-4-5')
    assert.equal(discovered[0].contextWindow, 200000)

    const models = await ctx.llm.listModels('ai-proxy')
    assert.equal(models.length, 3)
    const chat = models.find((m) => m.id === 'claude-sonnet-4-5')
    assert.deepEqual(chat.inputModalities, ['text', 'image'], 'declared vision model accepts images')
    const textOnly = models.find((m) => m.id === 'text-only-model')
    assert.deepEqual(textOnly.inputModalities, ['text'], 'declared text-only model refuses images')
    const image = models.find((m) => m.id === 'gpt-image-2')
    assert.equal(image.inputModalities, undefined, 'non-chat model carries no perceived-media claim')

    const info = await ctx.llm.resolveModelInfo('ai-proxy', 'claude-sonnet-4-5')
    assert.equal(info.context.contextWindow, 200000)
    assert.deepEqual(info.inputModalities, ['text', 'image'])
    assert.deepEqual(info.reasoning.efforts.map((e) => e.id), ['low', 'medium', 'high'])
    assert.deepEqual(info.reasoning.efforts.map((e) => e.name), ['Low', 'Medium', 'High'])
    assert.equal(info.reasoning.defaultEffort, 'low')

    const plain = await ctx.llm.resolveModelInfo('ai-proxy', 'gpt-image-2')
    assert.equal(plain.reasoning, undefined)

    assert(gw.requests.some((r) => r.path === '/v1/models' && r.auth === 'Bearer sk-test'), 'models fetched with static key')
    assert.equal(settings.persisted.length, 0, 'normal startup does not rewrite settings')
  } finally {
    gw.close()
  }
})

test('stream: OpenAI wire, reasoning_effort passthrough, usage and finish', async () => {
  const gw = await mockGateway()
  const { ctx, creds } = makeCtx()
  try {
    creds.store.set('AIPROXY_API_KEY', 'sk-test')
    await ctx.plugin(plugin, { baseURL: gw.url, clientId: 'dsh', apiKeyEnv: 'AIPROXY_API_KEY' })
    await sleep(50)

    const out = await collect(ctx.llm.stream({
      provider: 'ai-proxy',
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      reasoningEffort: 'high',
    }))
    assert.deepEqual(out.at(-1), { type: 'finish', reason: { kind: 'stop' } })
    const text = out.filter((c) => c.type === 'block-end' && c.block.type === 'text').map((c) => c.block.text).join('')
    assert.equal(text, 'hello from gateway')
    const reasoning = out.filter((c) => c.type === 'block-end' && c.block.type === 'reasoning').map((c) => c.block.text).join('')
    assert.equal(reasoning, 'thinking…')
    const usage = out.find((c) => c.type === 'usage')
    assert.deepEqual(usage.usage, { inputTokens: 10, outputTokens: 5, reasoningTokens: 3 })

    const call = gw.requests.find((r) => r.path === '/v1/chat/completions')
    assert.equal(call.auth, 'Bearer sk-test')
    assert.equal(call.body.model, 'claude-sonnet-4-5')
    assert.equal(call.body.stream, true)
    assert.equal(call.body.reasoning_effort, 'high')
    assert.equal('stream_options' in call.body, false)
  } finally {
    gw.close()
  }
})

test('stream: user images serialize to image_url data URLs', async () => {
  const gw = await mockGateway()
  const { ctx, creds, attachments } = makeCtx()
  try {
    creds.store.set('AIPROXY_API_KEY', 'sk-test')
    await ctx.plugin(plugin, { baseURL: gw.url, clientId: 'dsh', apiKeyEnv: 'AIPROXY_API_KEY' })
    await sleep(50)

    const image = { type: 'image', attachment: { attachmentId: 'img-1', mediaType: 'image/png' } }
    const out = await collect(ctx.llm.stream({
      provider: 'ai-proxy',
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'what is this?' }, image] }],
    }))
    assert.equal(out.at(-1).type, 'finish')

    const call = gw.requests.find((r) => r.path === '/v1/chat/completions')
    assert.deepEqual(call.body.messages[0].content, [
      { type: 'text', text: 'what is this?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,' + Buffer.from('fake-image-bytes').toString('base64') } },
    ])
    assert.deepEqual(attachments.reads, [{ attachmentId: 'img-1', mediaType: 'image/png' }], 'bytes read from the durable attachment service')
  } finally {
    gw.close()
  }
})

test('stream: a declared text-only model refuses image input', async () => {
  const gw = await mockGateway()
  const { ctx, creds } = makeCtx()
  try {
    creds.store.set('AIPROXY_API_KEY', 'sk-test')
    await ctx.plugin(plugin, { baseURL: gw.url, clientId: 'dsh', apiKeyEnv: 'AIPROXY_API_KEY' })
    await sleep(50)

    const image = { type: 'image', attachment: { attachmentId: 'img-1', mediaType: 'image/png' } }
    const out = await collect(ctx.llm.stream({
      provider: 'ai-proxy',
      model: 'text-only-model',
      messages: [{ role: 'user', content: [image] }],
    }))
    // Adapter failures surface as a terminal failure chunk through the
    // harness boundary, not as a throw.
    const finish = out.at(-1)
    assert.equal(finish.type, 'finish')
    assert.equal(finish.reason.kind, 'error')
    assert.equal(finish.reason.failure.code, 'UNSUPPORTED_CONTENT')
    assert.equal(gw.requests.some((r) => r.path === '/v1/chat/completions'), false, 'nothing sent upstream for a refused capability')
  } finally {
    gw.close()
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

test('Host auth RPC revokes and clears tokens without changing settings', async () => {
  const gw = await mockGateway()
  const { ctx, creds, connection } = makeCtx()
  try {
    creds.store.set('AIPROXY_ACCESS_TOKEN', 'acc-code')
    creds.store.set('AIPROXY_REFRESH_TOKEN', 'ref-code')
    creds.store.set('AIPROXY_TOKEN_EXPIRY', String(Date.now() + 3600000))
    await ctx.plugin(plugin, { baseURL: gw.url, clientId: 'dsh' })
    await sleep(50)

    assert.equal(connection.registration().channel, AUTH_RPC_CHANNEL)
    assert.deepEqual(connection.registration().options, { authority: 'loopback' })
    assert.deepEqual([...connection.registrations.keys()], [AUTH_RPC_CHANNEL])
    assert(ctx.llm.listProviders().some((p) => p.id === 'ai-proxy'), 'provider registered')
    const before = await connection.registration().handler('status', {})
    assert.equal(before.value.state, 'signed-in')
    const result = await connection.registration().handler('logout', {})
    assert.deepEqual(result, { ok: true, value: { state: 'signed-out', message: '已退出登录' } })
    assert.equal(gw.requests.some((r) => r.path === '/oauth/revoke'), true, 'revoke request sent')
    assert.equal(creds.store.get('AIPROXY_ACCESS_TOKEN'), undefined)
    assert.equal(creds.store.get('AIPROXY_REFRESH_TOKEN'), undefined)
    assert(ctx.llm.listProviders().some((p) => p.id === 'ai-proxy'), 'logout keeps the adapter registered')
    const section = ctx.settings.get('ai-proxy')
    assert.equal('oauth' in section, false)
    assert.equal('oauthStatus' in section, false)
  } finally {
    gw.close()
  }
})

test('auth RPC reads and writes the gateway address host-side', async () => {
  const gw = await mockGateway()
  const { ctx, connection, settings } = makeCtx()
  try {
    await ctx.plugin(plugin, { clientId: 'dsh' })
    const handler = connection.registration().handler
    assert.deepEqual(await handler('config', {}), {
      ok: true,
      value: { baseURL: 'http://localhost:18080', clientId: 'dsh' },
    })
    const written = await handler('setBaseURL', { baseURL: gw.url + '/' })
    assert.equal(written.ok, true)
    assert.equal(written.value.baseURL, gw.url)
    assert.equal(settings.doc['ai-proxy'].baseURL, gw.url)
    assert.equal((await handler('setBaseURL', { baseURL: 'ftp://nope' })).ok, false)
    assert.equal((await handler('setBaseURL', { baseURL: '  ' })).ok, false)
    assert.equal((await handler('setBaseURL', {})).ok, false)
    assert.equal((await handler('config', { extra: 1 })).ok, false)
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

test('401 on stream rotates the token once and retries', async () => {
  const gw = await mockGateway()
  const { ctx, creds } = makeCtx()
  try {
    creds.store.set('AIPROXY_ACCESS_TOKEN', 'acc-old')
    creds.store.set('AIPROXY_REFRESH_TOKEN', 'ref-1')
    creds.store.set('AIPROXY_TOKEN_EXPIRY', String(Date.now() + 3600000))
    await ctx.plugin(plugin, { baseURL: gw.url, clientId: 'dsh' })
    await sleep(50)

    const out = await collect(ctx.llm.stream({
      provider: 'ai-proxy',
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    }))
    assert.equal(out.at(-1).type, 'finish')
    const calls = gw.requests.filter((r) => r.path === '/v1/chat/completions')
    assert.equal(calls.length, 2)
    assert.equal(calls[0].auth, 'Bearer acc-old')
    assert.equal(calls[1].auth, 'Bearer acc-new')
    assert.equal(creds.store.get('AIPROXY_ACCESS_TOKEN'), 'acc-new')
    assert.equal(creds.store.get('AIPROXY_REFRESH_TOKEN'), 'ref-new')
  } finally {
    gw.close()
  }
})
