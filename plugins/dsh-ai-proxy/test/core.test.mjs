// Pure-function unit tests for dsh-ai-proxy. Run with:
//   node --test test/core.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_RESPONSE_CODE, LlmError } from '@deepseek-ai/dsh-llm'
import { internals, resolveOptions } from '../lib/index.js'

const {
  AiProxyApi,
  serializeMessages, serializeUserContent, serializeRequest, translate, pkcePair, effortName,
  resolveDefaultEffort, normalizeAnthropicEffort,
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

test('normalizeAnthropicEffort: minimal maps to low, off/none disables, valid values pass through', () => {
  assert.equal(normalizeAnthropicEffort('minimal'), 'low')
  assert.equal(normalizeAnthropicEffort('low'), 'low')
  assert.equal(normalizeAnthropicEffort('medium'), 'medium')
  assert.equal(normalizeAnthropicEffort('high'), 'high')
  assert.equal(normalizeAnthropicEffort('max'), 'max')
  assert.equal(normalizeAnthropicEffort('xhigh'), 'xhigh')
  assert.equal(normalizeAnthropicEffort('ultra'), 'max')
  assert.equal(normalizeAnthropicEffort('turbo'), 'max')
  assert.equal(normalizeAnthropicEffort('none'), undefined)
  assert.equal(normalizeAnthropicEffort('off'), undefined)
  assert.equal(normalizeAnthropicEffort(''), undefined)
  assert.equal(normalizeAnthropicEffort(undefined), undefined)
})

test('resolveDefaultEffort: fallback, exact match, closest level, and highest', () => {
  const ladder3 = ['low', 'medium', 'high']
  const ladderMax = ['low', 'high', 'max']
  const ladderXhigh = ['low', 'medium', 'high', 'xhigh']
  const custom = ['fast', 'deep']
  const empty = []

  assert.equal(resolveDefaultEffort(empty, 'highest'), undefined)
  assert.equal(resolveDefaultEffort(undefined, 'highest'), undefined)

  // Unconfigured or empty string falls back to ladder[0] (preserving existing behavior)
  assert.equal(resolveDefaultEffort(ladder3, ''), 'low')
  assert.equal(resolveDefaultEffort(ladder3, undefined), 'low')
  assert.equal(resolveDefaultEffort(ladder3, '  HIGH  '), 'high')

  // 'lowest' is a preference keyword, not a gateway rung
  assert.equal(resolveDefaultEffort(ladder3, 'lowest'), 'low')
  assert.equal(resolveDefaultEffort(['lowest', 'high'], 'lowest'), 'lowest')

  // Exact matches
  assert.equal(resolveDefaultEffort(ladder3, 'medium'), 'medium')
  assert.equal(resolveDefaultEffort(ladder3, 'high'), 'high')

  // 'highest' keyword picks the highest known rung present on the ladder
  assert.equal(resolveDefaultEffort(ladder3, 'highest'), 'high')
  assert.equal(resolveDefaultEffort(ladderMax, 'highest'), 'max')
  assert.equal(resolveDefaultEffort(ladderXhigh, 'highest'), 'xhigh')
  assert.equal(resolveDefaultEffort(custom, 'highest'), 'deep')

  // Missing known rungs fall toward the nearest lower available rung, then up
  assert.equal(resolveDefaultEffort(ladderMax, 'max'), 'max')
  assert.equal(resolveDefaultEffort(ladderXhigh, 'max'), 'xhigh')
  assert.equal(resolveDefaultEffort(ladder3, 'max'), 'high')
  assert.equal(resolveDefaultEffort(ladder3, 'xhigh'), 'high')
  assert.equal(resolveDefaultEffort(['none', 'low'], 'high'), 'low')
  assert.equal(resolveDefaultEffort(custom, 'unknown'), 'fast')
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

test('serializeMessages: images in system or assistant messages are rejected', async () => {
  const image = { type: 'image', attachment: { attachmentId: 'img-1' } }
  for (const message of [
    { role: 'system', content: [image] },
    { role: 'assistant', content: [image] },
  ]) {
    await assert.rejects(
      serializeMessages([message], fakeAttachments),
      (error) => error instanceof LlmError && error.code === 'UNSUPPORTED_CONTENT',
    )
  }
})

test('serializeMessages: tool-result with image splits into tool message and following user message with image', async () => {
  const image = { type: 'image', attachment: { attachmentId: 'img-1' } }
  const wire = await serializeMessages([
    { role: 'user', content: [
      { type: 'tool-result', toolCallId: 'call-img', content: [
        { type: 'text', text: 'image captured: ' },
        image,
      ] },
    ] },
  ], fakeAttachments)

  assert.deepEqual(wire, [
    { role: 'tool', tool_call_id: 'call-img', content: 'image captured: ' },
    { role: 'user', content: [
      { type: 'text', text: 'Attached image(s) from tool result:' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,' + Buffer.from('fake-bytes').toString('base64') } },
    ] },
  ])

  // Graceful degradation when attachments is not provided
  const wireDegraded = await serializeMessages([
    { role: 'user', content: [
      { type: 'tool-result', toolCallId: 'call-img', content: [image] },
    ] },
  ])
  assert.deepEqual(wireDegraded, [
    { role: 'tool', tool_call_id: 'call-img', content: '[Image: img-1]' },
  ])
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

  // When gateway returns prompt_tokens smaller than cacheRead, clamp to 0
  const clampedUsage = mapUsage({
    prompt_tokens: 10,
    cache_read_input_tokens: 50,
  })
  assert.equal(clampedUsage.inputTokens, 0)
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
test('resolveInferenceEndpoint & normalizeApiFormat: smart matching for all formats', () => {
  const { normalizeApiFormat, resolveInferenceEndpoint, resolveModelsEndpoint } = internals
  
  assert.equal(normalizeApiFormat('chat/completions'), 'chat/completions')
  assert.equal(normalizeApiFormat('anthropic-messages'), 'anthropic-messages')
  assert.equal(normalizeApiFormat('messages'), 'anthropic-messages')
  assert.equal(normalizeApiFormat('responses'), 'responses')
  assert.equal(normalizeApiFormat('openai-responses'), 'responses')
  assert.equal(normalizeApiFormat('unknown'), 'chat/completions')
  assert.equal(normalizeApiFormat(undefined), 'chat/completions')

  // Standard root baseURL
  assert.equal(resolveInferenceEndpoint('http://localhost:18080', 'chat/completions'), 'http://localhost:18080/v1/chat/completions')
  assert.equal(resolveInferenceEndpoint('http://localhost:18080', 'anthropic-messages'), 'http://localhost:18080/v1/messages')
  assert.equal(resolveInferenceEndpoint('http://localhost:18080', 'responses'), 'http://localhost:18080/v1/responses')

  // /v1 suffix baseURL
  assert.equal(resolveInferenceEndpoint('http://localhost:18080/v1', 'chat/completions'), 'http://localhost:18080/v1/chat/completions')
  assert.equal(resolveInferenceEndpoint('http://localhost:18080/v1', 'anthropic-messages'), 'http://localhost:18080/v1/messages')
  assert.equal(resolveInferenceEndpoint('http://localhost:18080/v1', 'responses'), 'http://localhost:18080/v1/responses')

  // Already carrying another endpoint path -> cleanly stripped & matched
  assert.equal(resolveInferenceEndpoint('http://localhost:18080/v1/chat/completions', 'anthropic-messages'), 'http://localhost:18080/v1/messages')
  assert.equal(resolveInferenceEndpoint('http://localhost:18080/v1/messages', 'responses'), 'http://localhost:18080/v1/responses')
  assert.equal(resolveInferenceEndpoint('http://localhost:18080/v1/responses', 'chat/completions'), 'http://localhost:18080/v1/chat/completions')

  // resolveModelsEndpoint
  assert.equal(resolveModelsEndpoint('http://localhost:18080'), 'http://localhost:18080/v1/models')
  assert.equal(resolveModelsEndpoint('http://localhost:18080/v1/chat/completions'), 'http://localhost:18080/v1/models')
})

test('serializeAnthropicRequest: messages format, system prompt, thinking, tool calls and results', async () => {
  const { serializeAnthropicRequest } = internals
  const req = await serializeAnthropicRequest({
    model: 'claude-3-7-sonnet',
    system: 'system instructions',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'question' }] },
      { role: 'assistant', content: [
        { type: 'text', text: 'calling tool' },
        { type: 'tool-call', id: 'call_1', name: 'calc', arguments: '{"expr":"2+2"}' }
      ] },
      { role: 'user', content: [
        { type: 'tool-result', toolCallId: 'call_1', content: [{ type: 'text', text: '4' }] },
        { type: 'text', text: 'and then?' }
      ] },
    ],
    tools: [{ name: 'calc', description: 'calculate', parameters: { type: 'object' } }],
    reasoningEffort: 'high',
    maxTokens: 2048,
    temperature: 0.7,
  })

  assert.equal(req.model, 'claude-3-7-sonnet')
  assert.equal(req.system, 'system instructions')
  assert.equal(req.max_tokens, 2048)
  assert.equal(req.stream, true)
  assert.deepEqual(req.thinking, { type: 'adaptive' })
  assert.deepEqual(req.output_config, { effort: 'high' })
  assert.equal(req.messages.length, 3)
  assert.equal(req.messages[0].role, 'user')
  assert.equal(req.messages[0].content, 'question')
  assert.equal(req.messages[1].role, 'assistant')
  assert.deepEqual(req.messages[1].content, [
    { type: 'text', text: 'calling tool' },
    { type: 'tool_use', id: 'call_1', name: 'calc', input: { expr: '2+2' } },
  ])
  assert.equal(req.messages[2].role, 'user')
  assert.deepEqual(req.messages[2].content, [
    { type: 'tool_result', tool_use_id: 'call_1', content: '4' },
    { type: 'text', text: 'and then?' },
  ])
  assert.deepEqual(req.tools, [
    { name: 'calc', description: 'calculate', input_schema: { type: 'object' } },
  ])

  // Test tool-result with image
  const img = { type: 'image', attachment: { attachmentId: 'img-res' } }
  const reqWithImg = await serializeAnthropicRequest({
    model: 'claude-3-7-sonnet',
    messages: [
      { role: 'user', content: [
        { type: 'tool-result', toolCallId: 'call_img', content: [
          { type: 'text', text: 'chart: ' },
          img,
        ] },
      ] },
    ],
  }, fakeAttachments)

  assert.deepEqual(reqWithImg.messages[0].content, [
    {
      type: 'tool_result',
      tool_use_id: 'call_img',
      content: [
        { type: 'text', text: 'chart: ' },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: Buffer.from('fake-bytes').toString('base64'),
          },
        },
      ],
    },
  ])

  // Test that minimal reasoningEffort normalizes to 'low' and doesn't send 'minimal'
  const reqMinimal = await serializeAnthropicRequest({
    model: 'claude-3-7-sonnet',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    reasoningEffort: 'minimal',
  })
  assert.deepEqual(reqMinimal.thinking, { type: 'adaptive' })
  assert.deepEqual(reqMinimal.output_config, { effort: 'low' })

  // Test that none/off reasoningEffort disables thinking
  const reqNone = await serializeAnthropicRequest({
    model: 'claude-3-7-sonnet',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    reasoningEffort: 'none',
  })
  assert.equal(reqNone.thinking, undefined)
  assert.equal(reqNone.output_config, undefined)
})

test('serializeResponsesRequest: responses format, input list, reasoning effort', async () => {
  const { serializeResponsesRequest } = internals
  const req = await serializeResponsesRequest({
    model: 'gpt-4o',
    system: 'system instructions',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [
        { type: 'text', text: 'executing' },
        { type: 'tool-call', id: 'call_1', name: 'search', arguments: '{"q":"dsh"}' }
      ] },
      { role: 'user', content: [
        { type: 'tool-result', toolCallId: 'call_1', content: [{ type: 'text', text: 'found' }] },
      ] },
    ],
    tools: [{ name: 'search', description: 'search web', parameters: { type: 'object' } }],
    reasoningEffort: 'medium',
    maxTokens: 1024,
  })

  assert.equal(req.model, 'gpt-4o')
  assert.equal(req.stream, true)
  assert.deepEqual(req.reasoning, { effort: 'medium' })
  assert.equal(req.max_output_tokens, 1024)
  assert.deepEqual(req.input, [
    { role: 'system', content: 'system instructions' },
    { role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'executing' }], status: 'completed' },
    { type: 'function_call', call_id: 'call_1', name: 'search', arguments: '{"q":"dsh"}' },
    { type: 'function_call_output', call_id: 'call_1', output: 'found' },
  ])
})

test('translateAnthropic: text, thinking, tool calls, usage, stop reason', async () => {
  const { translateAnthropic } = internals
  const events = [
    { event: 'message_start', data: JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 20, cache_read_input_tokens: 5 } } }) },
    { event: 'content_block_start', data: JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }) },
    { event: 'content_block_delta', data: JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me think' } }) },
    { event: 'content_block_stop', data: JSON.stringify({ type: 'content_block_stop', index: 0 }) },
    { event: 'content_block_start', data: JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }) },
    { event: 'content_block_delta', data: JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello world' } }) },
    { event: 'content_block_stop', data: JSON.stringify({ type: 'content_block_stop', index: 1 }) },
    { event: 'message_delta', data: JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10, output_tokens_details: { thinking_tokens: 4 } } }) },
    { event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) },
  ]

  const chunks = await collect(translateAnthropic(payloads(events)))
  assert.equal(chunks.some(c => c.type === 'block-start' && c.blockType === 'reasoning'), true)
  assert.equal(chunks.some(c => c.type === 'reasoning-delta' && c.text === 'Let me think'), true)
  assert.equal(chunks.some(c => c.type === 'text-delta' && c.text === 'Hello world'), true)
  const usageChunk = chunks.find(c => c.type === 'usage')
  assert.deepEqual(usageChunk.usage, {
    inputTokens: 15,
    outputTokens: 10,
    cacheReadTokens: 5,
    reasoningTokens: 4,
  })
  const finishChunk = chunks.at(-1)
  assert.deepEqual(finishChunk, { type: 'finish', reason: { kind: 'stop' } })
})

test('translateResponses: message, reasoning, function_call, usage', async () => {
  const { translateResponses } = internals
  const events = [
    { data: JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning' } }) },
    { data: JSON.stringify({ type: 'response.reasoning.delta', output_index: 0, delta: 'pondering' }) },
    { data: JSON.stringify({ type: 'response.output_item.done', output_index: 0 }) },
    { data: JSON.stringify({ type: 'response.output_item.added', output_index: 1, item: { type: 'message' } }) },
    { data: JSON.stringify({ type: 'response.text.delta', output_index: 1, delta: 'answering' }) },
    { data: JSON.stringify({ type: 'response.output_item.done', output_index: 1 }) },
    { data: JSON.stringify({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 30, output_tokens: 15 } } }) },
    { data: '[DONE]' },
  ]

  const chunks = await collect(translateResponses(payloads(events)))
  assert.equal(chunks.some(c => c.type === 'block-start' && c.blockType === 'reasoning'), true)
  assert.equal(chunks.some(c => c.type === 'reasoning-delta' && c.text === 'pondering'), true)
  assert.equal(chunks.some(c => c.type === 'text-delta' && c.text === 'answering'), true)
  const usageChunk = chunks.find(c => c.type === 'usage')
  assert.deepEqual(usageChunk.usage, { inputTokens: 30, outputTokens: 15 })
  const finishChunk = chunks.at(-1)
  assert.deepEqual(finishChunk, { type: 'finish', reason: { kind: 'stop' } })
})
