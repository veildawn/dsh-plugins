import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime, createUserMessage } from '@deepseek-ai/dsh-llm'
import { apply } from '../lib/index.js'

/** Real Cordis waterfall + real LLM resolution/streaming, no disk or network. */
class MemoryAdapter extends LlmAdapter {
  calls = []
  resolutions = []
  async resolveModel(provider, model) {
    this.resolutions.push({ provider, model })
    return {
      provider, id: model, name: model,
      reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
    }
  }
  async *stream(options) {
    this.calls.push(options)
    const output = options.model === 'classifier' ? 'review' : 'done'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: output }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: output } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function createRuntime({ effort = 'high' } = {}) {
  const ctx = new Context()
  const adapter = new MemoryAdapter()
  const rpc = new Map()
  const config = {
    routing: { enabled: true, fallback: 'llm', classifier: { provider: 'memory', model: 'classifier' } },
    profiles: [{ id: 'review', name: 'Review', keywords: ['review'], provider: 'memory', model: 'review-model', reasoningEffort: effort }],
  }
  new LlmRuntime(ctx)
  ctx.llm.registerAdapter(['memory'], adapter)
  ctx.provide('settings', { register() { return { get: () => config, watch() { return () => {} } } } })
  ctx.provide('connection', { rpc: { handle(channel, fn) { rpc.set(channel, fn); return () => rpc.delete(channel) } } })
  apply(ctx)
  return { ctx, adapter, rpc }
}

function makeAgent(id, child) {
  let header
  const events = []
  return {
    id, options: {},
    session: {
      id, events, header: child ? { origin: 'subagent', parentSession: 'main' } : {},
      requestHeader: () => header,
      deriveMessages: () => [],
      commit(ctx, config) {
        header = { config }
        const event = { type: 'request/header', data: { header } }
        events.push(event)
        ctx.emit('session/event', this, event)
      },
    },
  }
}

async function propose(ctx, agent, text) {
  await ctx.waterfall('agent/pre-step', { agent, turn: 1, step: 1 }, async () => ({
    kind: 'enter', messages: [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })],
  }))
  return ctx.waterfall('agent/request', { agent, signal: new AbortController().signal }, async () => ({
    provider: 'memory', model: 'baseline', maxTokens: 256,
  }))
}

async function streamCommitted(ctx, agent, proposal) {
  const prepared = await ctx.llm.prepareCall(proposal)
  agent.session.commit(ctx, prepared.config)
  const chunks = []
  for await (const chunk of prepared.stream({
    ...prepared.config,
    messages: [createUserMessage({ content: [{ type: 'text', text: 'Execute task' }], source: { kind: 'user' } })],
  })) chunks.push(chunk)
  assert.equal(chunks.at(-1).reason.kind, 'stop')
}

test('real request waterfalls, adapter validation, committed headers and explanations agree', async () => {
  const { ctx, adapter, rpc } = createRuntime()
  try {
    // Let the actual dependency-injected RPC fiber finish loading.
    await ctx.inject(['connection'], () => {})
    const settingsRpc = rpc.get('/task-models-settings')
    assert.equal(typeof settingsRpc, 'function')
    const main = makeAgent('main', false)
    const mainRoute = await propose(ctx, main, 'Review this diff')
    assert.equal(mainRoute.model, 'baseline')
    await streamCommitted(ctx, main, mainRoute)

    const child = makeAgent('rules-child', true)
    const selected = await propose(ctx, child, 'Review this diff')
    assert.equal(selected.model, 'review-model')
    assert.equal(selected.reasoningEffort, 'high')
    assert(adapter.resolutions.some((route) => route.model === 'review-model'))
    let details = (await settingsRpc('routingDetails', { childIds: [child.id] })).value
    assert.equal(details.models[child.id], undefined)
    assert.equal(details.details[child.id].selectedRoute.model, 'review-model')
    await streamCommitted(ctx, child, selected)
    details = (await settingsRpc('routingDetails', { childIds: [child.id] })).value
    assert.equal(details.models[child.id].model, adapter.calls.at(-1).model)
    assert.equal(details.details[child.id].effectiveRoute.model, child.session.requestHeader().config.model)
    assert.equal(details.details[child.id].reason, 'rules-keywords')
    assert.equal((await settingsRpc('childModels', { childIds: [child.id] })).value.models[child.id].model, 'review-model')

    const classified = makeAgent('llm-child', true)
    const classifiedRoute = await propose(ctx, classified, 'Assess the patch')
    assert.equal(classifiedRoute.model, 'review-model')
    await streamCommitted(ctx, classified, classifiedRoute)
    const explanation = (await settingsRpc('routingDetails', { childIds: [classified.id] })).value.details[classified.id]
    assert.equal(explanation.source, 'llm')
    assert.equal(explanation.reason, 'llm-selected')
    assert.equal(explanation.effectiveRoute.model, 'review-model')
    const classifierCalls = adapter.calls.filter((call) => call.model === 'classifier')
    assert.equal(classifierCalls.length, 1)
    assert.equal(classifierCalls[0].signal.aborted, false)
    assert.equal((await propose(ctx, classified, 'Another prompt')).model, 'review-model')
    assert.equal(adapter.calls.filter((call) => call.model === 'classifier').length, 1)
    assert.equal((await settingsRpc('routingDetails', { childIds: ['main'] })).value.details.main, undefined)
  } finally {
    await ctx.fiber.dispose()
  }
})

test('real capability rejection stays on baseline for every later request', async () => {
  const { ctx, adapter, rpc } = createRuntime({ effort: 'unsupported' })
  try {
    await ctx.inject(['connection'], () => {})
    const child = makeAgent('bad-effort-child', true)
    const first = await propose(ctx, child, 'Review this diff')
    assert.equal(first.model, 'baseline')
    await streamCommitted(ctx, child, first)
    const later = await propose(ctx, child, 'Review this diff')
    assert.deepEqual(later, first)
    await streamCommitted(ctx, child, later)
    assert.equal(adapter.calls.filter((call) => call.model === 'review-model').length, 0)
    const { value } = await rpc.get('/task-models-settings')('routingDetails', { childIds: [child.id] })
    assert.equal(value.details[child.id].reason, 'route-unusable')
    assert.equal(value.details[child.id].selectedRoute.reasoningEffort, 'unsupported')
    assert.equal(value.details[child.id].effectiveRoute.model, 'baseline')
  } finally {
    await ctx.fiber.dispose()
  }
})

test('task routing composes with another real middleware without changing main sessions', async () => {
  const { ctx } = createRuntime()
  try {
    ctx.on('agent/request', async (_input, next) => ({ ...await next(), model: 'other-router', reasoningEffort: 'low' }))
    assert.equal((await propose(ctx, makeAgent('main', false), 'Review this diff')).model, 'other-router')
    const selected = await propose(ctx, makeAgent('child', true), 'Review this diff')
    assert.equal(selected.model, 'review-model')
    assert.equal(selected.reasoningEffort, 'high')
  } finally {
    await ctx.fiber.dispose()
  }
})
