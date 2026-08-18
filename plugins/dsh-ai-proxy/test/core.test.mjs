// Pure-function unit tests for dsh-ai-proxy. Run with:
//   node --test test/core.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_RESPONSE_CODE, LlmError } from '@deepseek-ai/dsh-llm'
import { internals, resolveOptions } from '../lib/index.js'

const {
  AiProxyApi,
  serializeMessages, serializeUserContent, serializeRequest, translate, pkcePair, effortName,
  imageDataUrl, inputModalitiesOf,
  mapUsage, mapFinishReason, httpErrorCode,
} = internals

async function* payloads(items) {
  for (const item of items) yield item
}

async function collect(chunks) {
  const out = []
  for await (const chunk of chunks) out.push(chunk)
  return out
}

test('pkcePair: verifier/challenge/state shapes and S256 binding', () => {
  const { verifier, challenge, state } = pkcePair()
  assert.equal(verifier.length, 64)
  assert.match(verifier, /^[A-Za-z0-9_-]{64}$/)
  assert.equal(state.length, 32)
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/)
})

test('resolveOptions: clientId follows the gateway entity invariant', () => {
  assert.equal(resolveOptions({ clientId: 'dsh' }).clientId, 'dsh')
  assert.equal(resolveOptions({ clientId: 'a1' }).clientId, 'a1')
  for (const clientId of ['a', '-dsh', '.dsh', 'DSH', 'a'.repeat(65)]) {
    assert.throws(() => resolveOptions({ clientId }), /clientId must be 2-64/)
  }
})

test('effortName: known rungs get human names, unknown ids pass through', () => {
  assert.equal(effortName('high'), 'High')
  assert.equal(effortName('xhigh'), 'X-High')
  assert.equal(effortName('none'), 'None')
  assert.equal(effortName('some-custom-rung'), 'some-custom-rung')
})

test('model reasoning ladder follows the gateway response exactly', () => {
  assert.deepEqual(AiProxyApi.normalizeModel({
    id: 'gemini-3.7-flash-tiered', effort_levels: [],
  }).effortLevels, [])
  assert.deepEqual(AiProxyApi.normalizeModel({
    id: 'gemini-3.7-flash-tiered', effort_levels: ['low', 'high'],
  }).effortLevels, ['low', 'high'])
})

test('serializeMessages: system, assistant tool calls, tool results', async () => {
  const wire = await serializeMessages([
    { role: 'system', content: [{ type: 'text', text: 'be brief' }] },
    { role: 'assistant', content: [
      { type: 'text', text: 'running it' },
      { type: 'tool-call', id: 'call-1', name: 'bash', arguments: '{"cmd":"ls"}' },
    ] },
    { role: 'user', content: [
      { type: 'text', text: 'here is the result' },
      { type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'ok' }] },
    ] },
    { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call-2', content: [] }] },
  ])
  assert.deepEqual(wire, [
    { role: 'system', content: 'be brief' },
    { role: 'assistant', content: 'running it', tool_calls: [
      { id: 'call-1', type: 'function', function: { name: 'bash', arguments: '{"cmd":"ls"}' } },
    ] },
    { role: 'user', content: 'here is the result' },
    { role: 'tool', tool_call_id: 'call-1', content: 'ok' },
    { role: 'tool', tool_call_id: 'call-2', content: '(no output)' },
  ])
})

const fakeAttachments = {
  async readImage(ref) {
    return { ref: { mediaType: ref.mediaType ?? 'image/png' }, data: Buffer.from('fake-bytes') }
  },
}

test('serializeMessages: user image becomes an image_url data URL', async () => {
  const wire = await serializeMessages([
    { role: 'user', content: [
      { type: 'text', text: 'what is this?' },
      { type: 'image', attachment: { attachmentId: 'img-1', mediaType: 'image/png' } },
    ] },
  ], fakeAttachments)
  assert.deepEqual(wire, [
    { role: 'user', content: [
      { type: 'text', text: 'what is this?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,' + Buffer.from('fake-bytes').toString('base64') } },
    ] },
  ])
})

test('serializeUserContent: image-only user content is a parts array, text-only stays a string', async () => {
  const parts = await serializeUserContent([
    { type: 'image', attachment: { attachmentId: 'img-1', mediaType: 'image/jpeg' } },
  ], fakeAttachments)
  assert.equal(parts.length, 1)
  assert.equal(parts[0].type, 'image_url')
  assert.match(parts[0].image_url.url, /^data:image\/jpeg;base64,/)
  assert.equal(await serializeUserContent([{ type: 'text', text: 'hi' }], fakeAttachments), 'hi')
  assert.equal(imageDataUrl({ ref: { mediaType: 'image/webp' }, data: Buffer.from([1, 2, 3]) }), 'data:image/webp;base64,' + Buffer.from([1, 2, 3]).toString('base64'))
})

test('serializeMessages: images outside user content are rejected, not flattened', async () => {
  const image = { type: 'image', attachment: { attachmentId: 'img-1' } }
  for (const message of [
    { role: 'system', content: [image] },
    { role: 'assistant', content: [image] },
    { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c', content: [image] }] },
  ]) {
    await assert.rejects(
      serializeMessages([message], fakeAttachments),
      (error) => error instanceof LlmError && error.code === 'UNSUPPORTED_CONTENT',
    )
  }
})

test('inputModalitiesOf: gateway declaration to harness vocabulary', () => {
  assert.equal(inputModalitiesOf(undefined), undefined, 'unknown stays permissive')
  assert.equal(inputModalitiesOf({}), undefined)
  assert.equal(inputModalitiesOf({ inputModalities: [] }), undefined)
  assert.deepEqual(inputModalitiesOf({ inputModalities: ['text', 'image'] }), ['text', 'image'])
  assert.deepEqual(inputModalitiesOf({ inputModalities: ['text'] }), ['text'])
  assert.deepEqual(inputModalitiesOf({ inputModalities: ['text', 'audio'] }), ['text'])
})

test('serializeRequest: OpenAI shape, effort passthrough, session-title omission', async () => {
  const base = {
    model: 'claude-sonnet-4-5',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    system: 'sys',
    tools: [{ name: 'bash', description: 'run', parameters: { type: 'object' } }],
    temperature: 0.2,
    maxTokens: 4096,
    stop: ['\n\n'],
  }
  const withEffort = await serializeRequest({ ...base, reasoningEffort: 'high' })
  assert.equal(withEffort.stream, true)
  assert.equal(withEffort.reasoning_effort, 'high')
  assert.deepEqual(withEffort.messages, [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
  ])
  assert.deepEqual(withEffort.tools, [
    { type: 'function', function: { name: 'bash', description: 'run', parameters: { type: 'object' } } },
  ])
  assert.equal(withEffort.max_tokens, 4096)
  assert.equal(withEffort.temperature, 0.2)
  assert.deepEqual(withEffort.stop, ['\n\n'])
  assert.equal('stream_options' in withEffort, false, 'gateway rejects stream_options')

  const title = await serializeRequest({ ...base, reasoningEffort: 'high', purpose: 'session-title' })
  assert.equal('reasoning_effort' in title, false)
  const bare = await serializeRequest(base)
  assert.equal('reasoning_effort' in bare, false)
})

test('mapUsage: disjoint counts subtract cached prompt tokens', () => {
  const usage = mapUsage({
    prompt_tokens: 100,
    completion_tokens: 50,
    prompt_tokens_details: { cached_tokens: 40 },
    completion_tokens_details: { reasoning_tokens: 30 },
  })
  assert.deepEqual(usage, { inputTokens: 60, outputTokens: 50, cacheReadTokens: 40, reasoningTokens: 30 })
})

test('mapFinishReason: wire vocabulary to harness vocabulary', () => {
  assert.deepEqual(mapFinishReason('stop'), { kind: 'stop' })
  assert.deepEqual(mapFinishReason('length'), { kind: 'max-tokens' })
  assert.deepEqual(mapFinishReason('tool_calls'), { kind: 'tool-calls' })
  assert.equal(mapFinishReason('content_filter').kind, 'error')
})

test('httpErrorCode: stable taxonomy', () => {
  assert.equal(httpErrorCode(401, null), 'AUTH')
  assert.equal(httpErrorCode(403, null), 'AUTH')
  assert.equal(httpErrorCode(429, null), 'RATE_LIMIT')
  assert.equal(httpErrorCode(400, null), 'INVALID_REQUEST')
  assert.equal(httpErrorCode(503, null), 'SERVER')
  assert.equal(httpErrorCode(418, null), 'HTTP_418')
})

test('translate: text, reasoning, finish sequence', async () => {
  const out = await collect(translate(payloads([
    '{"choices":[{"index":0,"delta":{"content":"Hello"}}]}',
    '{"choices":[{"index":0,"delta":{"content":" world"}}]}',
    '{"choices":[{"index":0,"delta":{"reasoning_content":"think"}}]}',
    '{"choices":[{"index":0,"finish_reason":"stop"}]}',
    '[DONE]',
  ])))
  assert.deepEqual(out.map((c) => c.type), [
    'block-start', 'text-delta', 'text-delta', 'block-start', 'reasoning-delta', 'block-end', 'block-end', 'finish',
  ])
  assert.equal(out[1].text, 'Hello')
  assert.equal(out[2].text, ' world')
  const text = out.find((c) => c.type === 'block-end' && c.block.type === 'text').block.text
  assert.equal(text, 'Hello world')
  assert.deepEqual(out.at(-1), { type: 'finish', reason: { kind: 'stop' } })
})

test('translate: tool call deltas join into one block', async () => {
  const c1 = JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'bash', arguments: '{"cmd":' } }] } }] })
  const c2 = JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"ls"}' } }] } }] })
  const out = await collect(translate(payloads([
    c1,
    c2,
    '{"choices":[{"finish_reason":"tool_calls"}]}',
    '[DONE]',
  ])))
  const ended = out.find((c) => c.type === 'block-end')
  assert.equal(ended.block.type, 'tool-call')
  assert.equal(ended.block.id, 'call_1')
  assert.equal(ended.block.name, 'bash')
  assert.equal(ended.block.arguments, '{"cmd":"ls"}')
  assert.deepEqual(out.at(-1), { type: 'finish', reason: { kind: 'tool-calls' } })
})

test('translate: usage emitted before finish; empty response is an error finish', async () => {
  const withUsage = await collect(translate(payloads([
    '{"choices":[{"delta":{"content":"x"}}]}',
    '{"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}',
    '[DONE]',
  ])))
  const types = withUsage.map((c) => c.type)
  assert.deepEqual(types, ['block-start', 'text-delta', 'block-end', 'usage', 'finish'])
  assert.deepEqual(withUsage[3].usage, { inputTokens: 10, outputTokens: 5 })

  const empty = await collect(translate(payloads(['[DONE]'])))
  assert.equal(empty.length, 1)
  assert.equal(empty[0].type, 'finish')
  assert.equal(empty[0].reason.kind, 'error')
  assert.equal(empty[0].reason.failure.code, EMPTY_RESPONSE_CODE)
})

test('translate: malformed JSON aborts with MALFORMED_RESPONSE', async () => {
  await assert.rejects(
    collect(translate(payloads(['not json', '[DONE]']))),
    (error) => error instanceof LlmError && error.code === 'MALFORMED_RESPONSE',
  )
})
