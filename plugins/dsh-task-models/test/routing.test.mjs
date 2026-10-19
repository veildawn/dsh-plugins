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

async function request(harness, agent, config = { provider: 'base', model: 'base-model', maxTokens: 100 }, signal = AbortSignal.timeout(5_000)) {
  return harness.listeners.get('agent/request')({
    agent, turn: 1, signal,
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
    const detail = (await harness.rpc('routingDetails', { childIds: [child.id] })).value.details.child
    assert.equal(detail.confidence, 0.9)
    assert.equal(detail.source, 'jev')
    assert.equal(detail.reason, 'jev-selected')
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

test('Jev missing confidence falls through to the configured lightweight classifier', async () => {
  const server = createServer((req, res) => {
    req.on('data', () => {})
    req.on('end', () => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      answers: { task_profile: { type: 'choice', choice: 'review' } },
    })))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const home = await mkdtemp(join(tmpdir(), 'task-models-confidence-'))
  const previousHome = process.env.DSH_HOME
  await mkdir(join(home, 'task-models'), { recursive: true })
  await writeFile(join(home, 'task-models', 'typesafe.key'), 'ts_isolated_test', { mode: 0o600 })
  process.env.DSH_HOME = home
  try {
    const harness = createHarness(baseConfig({ fallback: 'llm', classifier: { provider: 'classifier', model: 'tiny' } }, [], {
      enabled: true, baseURL: `http://127.0.0.1:${server.address().port}`, timeoutMs: 1000,
    }))
    const child = makeAgent()
    await preStep(harness, child, 'Assess the patch.')
    assert.equal((await request(harness, child)).model, 'review-model')
    assert.equal(harness.streams.length, 1)
    const { value } = await harness.rpc('routingDetails', { childIds: [child.id] })
    assert.equal(value.details.child.source, 'llm')
    assert.equal(value.details.child.confidence, undefined)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    assert(home.startsWith(join(tmpdir(), 'task-models-confidence-')))
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

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function commitHeader(harness, child, config) {
  child.session.setRequestHeader({ config })
  harness.listeners.get('session/event')(child.session, { type: 'request/header', data: { header: { config } } })
}

test('an unusable candidate never becomes a later replay route', async () => {
  const harness = createHarness(baseConfig())
  let validations = 0
  harness.ctx.llm.resolveCallConfig = async () => { validations++; throw new Error('unsupported effort') }
  const child = makeAgent()
  await preStep(harness, child, 'Review this diff.')
  const first = await request(harness, child)
  commitHeader(harness, child, first)
  assert.deepEqual(await request(harness, child), first)
  assert.equal(first.model, 'base-model')
  assert.equal(validations, 1)
  const { value } = await harness.rpc('routingDetails', { childIds: [child.id] })
  assert.equal(value.details.child.status, 'current')
  assert.equal(value.details.child.reason, 'route-unusable')
  assert.equal(value.details.child.selectedRoute.model, 'review-model')
  assert.equal(value.models.child.model, 'base-model')
})

test('adopted routes freeze across profile edits, disablement and removal; new children use the new table', async () => {
  for (const change of ['edit', 'disable', 'remove']) {
    const harness = createHarness(baseConfig())
    const child = makeAgent({ id: `existing-${change}` })
    await preStep(harness, child, 'Review this diff.')
    const first = await request(harness, child)
    commitHeader(harness, child, first)
    const updated = baseConfig()
    if (change === 'edit') updated.profiles[0] = { ...updated.profiles[0], model: 'new-model', reasoningEffort: 'low' }
    if (change === 'disable') updated.profiles[0].enabled = false
    if (change === 'remove') updated.profiles = []
    harness.update(updated)
    assert.deepEqual(await request(harness, child), first, change)
    const newcomer = makeAgent({ id: `new-${change}` })
    await preStep(harness, newcomer, 'Review this diff.')
    assert.equal((await request(harness, newcomer)).model, change === 'edit' ? 'new-model' : 'base-model', change)
  }
})

test('the global routing switch suspends and restores adopted routes, while bypasses still win', async () => {
  const harness = createHarness(baseConfig())
  const child = makeAgent()
  await preStep(harness, child, 'Review this diff.')
  const adopted = await request(harness, child)
  commitHeader(harness, child, adopted)
  harness.update(baseConfig({ enabled: false }))
  const baseline = await request(harness, child)
  assert.equal(baseline.model, 'base-model')
  commitHeader(harness, child, baseline)
  assert.equal((await harness.rpc('routingDetails', { childIds: ['child'] })).value.details.child.reason, 'routing-disabled')
  harness.update({ ...baseConfig(), profiles: [] })
  assert.deepEqual(await request(harness, child), adopted)
  child.session.events.push({ type: 'plan/mode', data: { active: true } })
  assert.equal((await request(harness, child)).model, 'base-model')
  child.session.events.push({ type: 'plan/mode', data: { active: false } })
  assert.deepEqual(await request(harness, child), adopted)
  child.options.modelRole = 'advisor'
  assert.equal((await request(harness, child)).model, 'base-model')
})

test('concurrent first requests share one classifier and one candidate validation', async () => {
  const harness = createHarness(baseConfig({ fallback: 'llm', classifier: { provider: 'classifier', model: 'tiny' } }))
  const started = deferred()
  const release = deferred()
  let calls = 0
  let validations = 0
  harness.ctx.llm.stream = async function* () {
    calls++
    started.resolve()
    await release.promise
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'review' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  harness.ctx.llm.resolveCallConfig = async () => { validations++ }
  const child = makeAgent()
  await preStep(harness, child, 'Assess the patch.')
  const one = request(harness, child)
  const two = request(harness, child)
  await started.promise
  const pendingDetails = (await harness.rpc('routingDetails', { childIds: [child.id] })).value
  assert.equal(pendingDetails.models[child.id], undefined)
  assert.equal(pendingDetails.details[child.id], undefined)
  release.resolve()
  const [a, b] = await Promise.all([one, two])
  assert.deepEqual(a, b)
  assert.equal(a.model, 'review-model')
  assert.equal(calls, 1)
  assert.equal(validations, 1)
})

test('caller cancellation evicts a pending decision and a fresh signal can retry', async () => {
  const harness = createHarness(baseConfig({ fallback: 'llm', classifier: { provider: 'classifier', model: 'tiny' } }))
  const started = deferred()
  const release = deferred()
  let calls = 0
  let cancelledSignal
  harness.ctx.llm.stream = async function* ({ signal }) {
    calls++
    if (calls === 1) {
      cancelledSignal = signal
      started.resolve()
      await release.promise
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'review' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const child = makeAgent()
  await preStep(harness, child, 'Assess the patch.')
  const controller = new AbortController()
  const pending = request(harness, child, undefined, controller.signal)
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  await started.promise
  controller.abort()
  const retry = request(harness, child)
  await rejected
  assert.equal(cancelledSignal.aborted, true)
  release.resolve()
  assert.equal((await retry).model, 'review-model', 'a retry started before the cancelled promise settles must get a fresh decision')
  assert.equal(calls, 2)
})

test('completed no-op decisions remain cached when an old caller signal later aborts', async () => {
  const harness = createHarness(baseConfig({ fallback: 'llm', classifier: { provider: 'classifier', model: 'tiny' } }))
  const child = makeAgent()
  const controller = new AbortController()
  await preStep(harness, child, 'A neutral subtask.')
  assert.equal((await request(harness, child, undefined, controller.signal)).model, 'base-model')
  assert.equal(harness.streams.length, 1)
  controller.abort()
  assert.equal((await request(harness, child)).model, 'base-model')
  assert.equal(harness.streams.length, 1, 'completed abstentions are not aborted pending decisions')
})

test('the decision budget bounds an uncooperative classifier and caches the safe fallback', async () => {
  const harness = createHarness(baseConfig({ decisionTimeoutMs: 100, fallback: 'llm', classifier: { provider: 'classifier', model: 'tiny' } }))
  const release = deferred()
  let calls = 0
  let classifierSignal
  harness.ctx.llm.stream = async function* ({ signal }) {
    calls++
    classifierSignal = signal
    await release.promise
  }
  const child = makeAgent()
  await preStep(harness, child, 'Assess the patch.')
  const first = await request(harness, child)
  assert.equal(first.model, 'base-model')
  assert.equal(classifierSignal.aborted, true)
  commitHeader(harness, child, first)
  assert.deepEqual(await request(harness, child), first)
  assert.equal(calls, 1)
  release.resolve()
  const detail = (await harness.rpc('routingDetails', { childIds: [child.id] })).value.details.child
  assert.equal(detail.reason, 'decision-timeout')
  assert(detail.durationMs >= 80 && detail.durationMs < 2000)
})

test('candidate capability validation is covered by the same decision budget', async () => {
  const harness = createHarness(baseConfig({ decisionTimeoutMs: 100 }))
  const release = deferred()
  let validations = 0
  harness.ctx.llm.resolveCallConfig = async () => { validations++; await release.promise }
  const child = makeAgent()
  await preStep(harness, child, 'Review this diff.')
  assert.equal((await request(harness, child)).model, 'base-model')
  assert.equal((await request(harness, child)).model, 'base-model')
  assert.equal(validations, 1)
  assert.equal((await harness.rpc('routingDetails', { childIds: [child.id] })).value.details.child.reason, 'decision-timeout')
  release.resolve()
})

test('turning routing off during classification never applies the pending candidate', async () => {
  const harness = createHarness(baseConfig({ fallback: 'llm', classifier: { provider: 'classifier', model: 'tiny' } }))
  const started = deferred()
  const release = deferred()
  harness.ctx.llm.stream = async function* () {
    started.resolve()
    await release.promise
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'review' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const child = makeAgent()
  await preStep(harness, child, 'Assess the patch.')
  const pending = request(harness, child)
  await started.promise
  harness.update(baseConfig({ enabled: false }))
  release.resolve()
  const baseline = await pending
  assert.equal(baseline.model, 'base-model')
  assert.equal((await harness.rpc('routingDetails', { childIds: [child.id] })).value.details.child.reason, 'routing-disabled')
  commitHeader(harness, child, baseline)
  harness.update(baseConfig({ fallback: 'llm', classifier: { provider: 'classifier', model: 'tiny' } }))
  assert.equal((await request(harness, child)).model, 'base-model', 'a never-adopted pending candidate must not wake up on re-enable')
})

test('failed terminal classifier chunks do not authorize a partial profile answer', async () => {
  const harness = createHarness(baseConfig({ fallback: 'llm', classifier: { provider: 'classifier', model: 'tiny' } }))
  harness.ctx.llm.stream = async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'review' } }
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'NETWORK', message: 'failed' } } }
  }
  const child = makeAgent()
  await preStep(harness, child, 'Assess the patch.')
  assert.equal((await request(harness, child)).model, 'base-model')
  assert.equal((await harness.rpc('routingDetails', { childIds: [child.id] })).value.details.child.reason, 'classifier-failed')
})

test('routing explanations distinguish selected candidates from committed effective headers', async () => {
  const harness = createHarness(baseConfig())
  const child = makeAgent({ events: [{ type: 'subagent/descriptor', data: { label: '[review]' } }] })
  await preStep(harness, child, 'Inspect the patch.')
  const proposal = await request(harness, child)
  let value = (await harness.rpc('routingDetails', { childIds: ['child'] })).value
  assert.equal(value.details.child.selectedRoute.model, 'review-model')
  assert.equal(value.details.child.reason, 'rules-explicit-label')
  assert.equal(value.details.child.effectiveRoute, undefined)
  assert.equal(value.models.child, undefined)
  commitHeader(harness, child, { ...proposal, reasoningEffort: 'low' })
  value = (await harness.rpc('routingDetails', { childIds: ['child'] })).value
  assert.equal(value.models.child.reasoningEffort, 'low')
  assert.equal(value.details.child.effectiveRoute.reasoningEffort, 'low')
  assert.equal(value.details.child.selectedRoute.reasoningEffort, 'high')
  assert.equal(value.details.child.source, 'rules')
  assert.equal(value.details.child.ruleAnalysis.profileId, 'review')
  assert.equal(JSON.stringify(value).includes('Inspect the patch'), false)
})

test('Jev caller cancellation does not start the fallback LLM', async () => {
  const received = deferred()
  const server = createServer((req) => {
    req.on('data', () => {})
    req.on('end', () => received.resolve())
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const home = await mkdtemp(join(tmpdir(), 'task-models-cancel-'))
  const previousHome = process.env.DSH_HOME
  await mkdir(join(home, 'task-models'), { recursive: true })
  await writeFile(join(home, 'task-models', 'typesafe.key'), 'ts_isolated_test', { mode: 0o600 })
  process.env.DSH_HOME = home
  try {
    const harness = createHarness(baseConfig({ fallback: 'llm', classifier: { provider: 'classifier', model: 'tiny' } }, [], {
      enabled: true, baseURL: `http://127.0.0.1:${server.address().port}`, timeoutMs: 1000,
    }))
    const child = makeAgent()
    await preStep(harness, child, 'Assess the patch.')
    const controller = new AbortController()
    const pending = request(harness, child, undefined, controller.signal)
    const rejected = assert.rejects(pending, { name: 'AbortError' })
    await received.promise
    controller.abort()
    await rejected
    assert.equal(harness.streams.length, 0)
    harness.update(baseConfig())
    await preStep(harness, child, 'Assess the patch.')
    assert.equal((await request(harness, child)).model, 'base-model')
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    assert(home.startsWith(join(tmpdir(), 'task-models-cancel-')))
    await rm(home, { recursive: true, force: true })
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
