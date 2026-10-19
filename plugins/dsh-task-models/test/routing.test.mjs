import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'
import { apply } from '../lib/index.js'
import { DEFAULT_JEV } from '../lib/core.js'

function createHarness(section) {
  const listeners = new Map()
  const streams = []
  const agents = new Map()
  const rpcHandlers = new Map()
  const requestedServices = []
  let watcher
  let current = section
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    settings: {
      register(_ns, _schema, _options) {
        return {
          get: () => current,
          watch(listener) { watcher = listener; return () => {} },
        }
      },
    },
    llm: {
      async *stream(options) {
        streams.push(options)
        const text = options.messages
          ?.flatMap((message) => message.content ?? [])
          .filter((block) => block?.type === 'text')
          .map((block) => block.text)
          .join('\n') ?? ''
        const output = /assess/iu.test(text) ? 'review' : 'general'
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: output }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: output } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
      async resolveCallConfig() {},
    },
    get(name) {
      requestedServices.push(name)
      if (name === 'agents') return { get: (id) => agents.get(id) }
      return undefined
    },
    on(name, listener) {
      listeners.set(name, listener)
      return () => {}
    },
    inject(dependencies, install) {
      if (dependencies.includes('connection')) {
        return install({
          connection: {
            rpc: {
              handle(channel, handler) {
                rpcHandlers.set(channel, handler)
                return () => {}
              },
            },
          },
        })
      }
      return () => {}
    },
  }
  apply(ctx, section)
  return {
    ctx,
    listeners,
    streams,
    agents,
    requestedServices,
    rpc(method, payload) {
      const handler = rpcHandlers.get('/task-models-settings')
      assert.equal(typeof handler, 'function')
      return handler(method, payload)
    },
    update(next) {
      current = next
      watcher?.(next)
    },
  }
}

function makeAgent({ id = 'child', header = { origin: 'subagent', parentSession: 'parent' }, options = {}, messages = [], events = [], requestHeader } = {}) {
  let headerValue = requestHeader
  const session = {
    id,
    header,
    events: [...events],
    deriveMessages: () => messages,
    requestHeader: () => headerValue,
    setRequestHeader(value) { headerValue = value },
  }
  return { id, session, options }
}

function message(text) {
  return { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }
}

async function preStep(harness, agent, text, { turn = 1, step = 1 } = {}) {
  return harness.listeners.get('agent/pre-step')({
    agent, turn, step, signal: AbortSignal.timeout(5_000), messages: [message(text)],
  }, () => Promise.resolve({ kind: 'enter', messages: [message(text)] }))
}

async function request(harness, agent, config = { provider: 'base', model: 'base-model', maxTokens: 100 }) {
  return harness.listeners.get('agent/request')({
    agent, turn: 1, signal: AbortSignal.timeout(5_000),
  }, () => Promise.resolve(config))
}

function baseConfig(routing = {}, profiles = [], jev = {}) {
  return {
    routing: {
      enabled: true,
      fallback: 'taskRole',
      useJev: true,
      respectExplicitChildModel: true,
      classifier: { provider: '', model: '', reasoningEffort: '' },
      ...routing,
    },
    profiles: [
      { id: 'review', name: '审查', detail: '代码审查', keywords: ['review'], provider: 'p', model: 'review-model', reasoningEffort: 'high', enabled: true },
      ...profiles,
    ],
    jev: { ...DEFAULT_JEV, enabled: false, ...jev },
  }
}

test('a matching task profile routes the first and later child requests', async () => {
  const harness = createHarness(baseConfig())
  const child = makeAgent()
  await preStep(harness, child, 'Review this diff for correctness.')
  assert.deepEqual(await request(harness, child), {
    provider: 'p', model: 'review-model', reasoningEffort: 'high', maxTokens: 100,
  })
  child.session.setRequestHeader({ config: { provider: 'p', model: 'review-model' } })
  assert.deepEqual(await request(harness, child), {
    provider: 'p', model: 'review-model', reasoningEffort: 'high', maxTokens: 100,
  })
})

test('an unmatched child keeps the current route (invalid or disabled profiles are no-ops)', async () => {
  const harness = createHarness(baseConfig())
  const child = makeAgent()
  await preStep(harness, child, 'Implement a normal feature.')
  assert.deepEqual(await request(harness, child), { provider: 'base', model: 'base-model', maxTokens: 100 })

  const disabled = createHarness({ ...baseConfig(), routing: { ...baseConfig().routing, enabled: false } })
  const other = makeAgent()
  await preStep(disabled, other, 'Review this diff.')
  assert.deepEqual(await request(disabled, other), { provider: 'base', model: 'base-model', maxTokens: 100 })
})

test('fallback=llm uses the configured classifier and its dedicated prompt', async () => {
  const harness = createHarness(baseConfig({
    fallback: 'llm',
    classifier: { provider: 'classifier', model: 'tiny', reasoningEffort: 'low' },
  }))
  const child = makeAgent()
  await preStep(harness, child, 'Assess the patch for issues.')
  const routed = await request(harness, child)
  assert.deepEqual(routed, { provider: 'p', model: 'review-model', reasoningEffort: 'high', maxTokens: 100 })
  const classifier = harness.streams.find((stream) => stream.system?.includes('Classify the delegated subtask'))
  assert.equal(classifier?.provider, 'classifier')
  assert.equal(classifier?.model, 'tiny')
  assert.match(classifier?.system ?? '', /review:/)
})

test('a label on the subagent descriptor selects a profile without keywords', async () => {
  const harness = createHarness(baseConfig())
  const child = makeAgent({
    events: [{ type: 'subagent/descriptor', data: { label: 'review' } }],
  })
  await preStep(harness, child, 'Look at this.')
  assert.deepEqual(await request(harness, child), {
    provider: 'p', model: 'review-model', reasoningEffort: 'high', maxTokens: 100,
  })
})

test('a detectable explicit child route is respected when configured', async () => {
  const harness = createHarness(baseConfig())
  const parent = makeAgent({
    id: 'parent',
    header: { origin: 'user' },
    requestHeader: { config: { provider: 'p', model: 'parent-model' } },
  })
  harness.agents.set(parent.id, parent)
  const child = makeAgent({
    header: { origin: 'subagent', parentSession: parent.id },
    options: { provider: 'p', model: 'explicit-child-model' },
  })
  await preStep(harness, child, 'Review this diff.')
  assert.deepEqual(await request(harness, child), { provider: 'base', model: 'base-model', maxTokens: 100 })
})

test('main agents, vision/advisor children and plan-mode children are untouched', async () => {
  const harness = createHarness(baseConfig())
  assert.deepEqual(await request(harness, makeAgent({ header: {} })), {
    provider: 'base', model: 'base-model', maxTokens: 100,
  })
  const vision = makeAgent({ options: { modelRole: 'vision' } })
  await preStep(harness, vision, 'Review this image.')
  assert.deepEqual(await request(harness, vision), { provider: 'base', model: 'base-model', maxTokens: 100 })
  const planned = makeAgent({ events: [{ type: 'plan/mode', data: { active: true } }] })
  await preStep(harness, planned, 'Review this plan.')
  assert.deepEqual(await request(harness, planned), { provider: 'base', model: 'base-model', maxTokens: 100 })
})

test('Jev chooses a configured profile and caches the decision per child', async () => {
  const requests = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      requests.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw || '{}') })
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        answers: { task_profile: { type: 'choice', choice: 'review', probabilities: { review: 0.9 }, confidence: 0.9 } },
      }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const home = await mkdtemp(join(tmpdir(), 'task-models-jev-'))
  const previousHome = process.env.DSH_HOME
  await mkdir(join(home, 'task-models'), { recursive: true })
  await writeFile(join(home, 'task-models', 'typesafe.key'), 'ts_task_models', { mode: 0o600 })
  process.env.DSH_HOME = home
  try {
    const harness = createHarness(baseConfig({}, [], {
      enabled: true,
      baseURL: `http://127.0.0.1:${port}`,
      timeoutMs: 1000,
    }))
    const child = makeAgent()
    await preStep(harness, child, 'Look at this patch.')
    assert.deepEqual(await request(harness, child), {
      provider: 'p', model: 'review-model', reasoningEffort: 'high', maxTokens: 100,
    })
    child.session.setRequestHeader({ config: { provider: 'p', model: 'review-model' } })
    assert.deepEqual(await request(harness, child), {
      provider: 'p', model: 'review-model', reasoningEffort: 'high', maxTokens: 100,
    })
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, '/v1/systemone')
    assert.equal(requests[0].auth, 'Bearer ts_task_models')
    assert.equal(requests[0].body.model, 'jev-latest')
    assert.equal(requests[0].body.questions.task_profile.type, 'choice')
    assert.equal(typeof requests[0].body.questions.task_profile.criteria.review, 'string')
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
    await new Promise((resolve) => server.close(resolve))
  }
})

test('low-confidence Jev decisions keep the current route', async () => {
  const server = createServer((req, res) => {
    req.on('data', () => {})
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        answers: { task_profile: { type: 'choice', choice: 'review', confidence: 0.1 } },
      }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const home = await mkdtemp(join(tmpdir(), 'task-models-jev-'))
  const previousHome = process.env.DSH_HOME
  await mkdir(join(home, 'task-models'), { recursive: true })
  await writeFile(join(home, 'task-models', 'typesafe.key'), 'ts_task_models', { mode: 0o600 })
  process.env.DSH_HOME = home
  try {
    const harness = createHarness(baseConfig({}, [], {
      enabled: true,
      baseURL: `http://127.0.0.1:${port}`,
      timeoutMs: 1000,
    }))
    const child = makeAgent()
    await preStep(harness, child, 'Look at this patch.')
    assert.deepEqual(await request(harness, child), { provider: 'base', model: 'base-model', maxTokens: 100 })
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
    await new Promise((resolve) => server.close(resolve))
  }
})


test('the host exposes each child effective model to the workflow panel', async () => {
  const harness = createHarness(baseConfig())
  const child = makeAgent()
  await preStep(harness, child, 'Review this diff.')
  await request(harness, child)

  const result = await harness.rpc('childModels', { childIds: ['child', 'unknown-child'] })
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.models.child, {
    provider: 'p', model: 'review-model', reasoningEffort: 'high',
  })
  assert.equal(result.value.models['unknown-child'], undefined)
  assert.equal((await harness.rpc('childModels', { childIds: ['child', 7] })).ok, false)
  assert.equal((await harness.rpc('childModels', { childIds: 'child' })).ok, false)
})

test('an unmatched child records the current route in the model map', async () => {
  const harness = createHarness(baseConfig())
  const child = makeAgent()
  await preStep(harness, child, 'Implement a normal feature.')
  await request(harness, child)
  const result = await harness.rpc('childModels', { childIds: ['child'] })
  assert.deepEqual(result.value.models.child, { provider: 'base', model: 'base-model' })
})


test('historical child session logs backfill the workflow model map', async () => {
  const home = await mkdtemp(join(tmpdir(), 'task-models-history-'))
  const previousHome = process.env.DSH_HOME
  try {
    const dir = join(home, 'sessions', 'scope', 'child-history')
    await mkdir(dir, { recursive: true })
    const lines = [
      JSON.stringify({ type: 'session', version: 4, id: 'child-history' }),
      JSON.stringify({
        type: 'request/header',
        seq: 1,
        data: { header: { config: { provider: 'e2e', model: 'historical-model', reasoningEffort: 'high' } } },
      }),
    ].join('\n') + '\n'
    await writeFile(join(dir, 'session.v4.jsonl.zstd'), zlib.zstdCompressSync(Buffer.from(lines, 'utf8')))
    process.env.DSH_HOME = home
    const harness = createHarness(baseConfig())
    const result = await harness.rpc('childModels', { childIds: ['child-history'] })
    assert.equal(result.ok, true)
    assert.deepEqual(result.value.models['child-history'], {
      provider: 'e2e', model: 'historical-model', reasoningEffort: 'high',
    })
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})


test('routing is independent of Agent Preset and never reads the preset registry', async () => {
  const harness = createHarness(baseConfig())

  const standard = makeAgent({
    id: 'standard-child',
    header: { origin: 'subagent', parentSession: 'parent', agentPreset: 'standard' },
  })
  await preStep(harness, standard, 'Review this diff.')
  assert.deepEqual(await request(harness, standard), {
    provider: 'p', model: 'review-model', reasoningEffort: 'high', maxTokens: 100,
  })

  const noPreset = makeAgent({ id: 'no-preset-child', header: { origin: 'subagent', parentSession: 'parent' } })
  await preStep(harness, noPreset, 'Review this diff.')
  assert.deepEqual(await request(harness, noPreset), {
    provider: 'p', model: 'review-model', reasoningEffort: 'high', maxTokens: 100,
  })

  const main = makeAgent({
    id: 'main-agent',
    header: { origin: 'user', agentPreset: 'model-roles' },
  })
  assert.deepEqual(await request(harness, main), {
    provider: 'base', model: 'base-model', maxTokens: 100,
  })

  assert.equal(harness.requestedServices.includes('agentPresets'), false)
})
