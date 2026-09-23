// Pure-function unit tests for dsh-ai-proxy. Run with:
//   node --test test/core.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { internals, resolveOptions } from '../lib/index.js'

const {
  AiProxyApi,
  pkcePair, effortName,
  resolveDefaultEffort, inputModalitiesOf,
  httpErrorCode, normalizeApiFormat, resolveModelsEndpoint,
  piAiProtocolFor, piAiBaseURL,
  ladderToReasoningEfforts, preferredEffort, streamOptionsWithPreferredEffort, routeDefaultEffortKey, buildProviderProfile,
  routeCompatFor,
} = internals

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

test('inputModalitiesOf: gateway declaration to harness vocabulary', () => {
  assert.equal(inputModalitiesOf(undefined), undefined, 'unknown stays permissive')
  assert.equal(inputModalitiesOf({}), undefined)
  assert.equal(inputModalitiesOf({ inputModalities: [] }), undefined)
  assert.deepEqual(inputModalitiesOf({ inputModalities: ['text', 'image'] }), ['text', 'image'])
  assert.deepEqual(inputModalitiesOf({ inputModalities: ['text'] }), ['text'])
  assert.deepEqual(inputModalitiesOf({ inputModalities: ['text', 'audio'] }), ['text'])
})

test('httpErrorCode: stable taxonomy', () => {
  assert.equal(httpErrorCode(401, null), 'AUTH')
  assert.equal(httpErrorCode(403, null), 'AUTH')
  assert.equal(httpErrorCode(429, null), 'RATE_LIMIT')
  assert.equal(httpErrorCode(400, null), 'INVALID_REQUEST')
  assert.equal(httpErrorCode(503, null), 'SERVER')
  assert.equal(httpErrorCode(418, null), 'HTTP_418')
})

test('normalizeApiFormat & resolveModelsEndpoint: canonical ids and models URL', () => {
  assert.equal(normalizeApiFormat('chat/completions'), 'chat/completions')
  assert.equal(normalizeApiFormat('anthropic-messages'), 'anthropic-messages')
  assert.equal(normalizeApiFormat('messages'), 'anthropic-messages')
  assert.equal(normalizeApiFormat('responses'), 'responses')
  assert.equal(normalizeApiFormat('openai-responses'), 'responses')
  assert.equal(normalizeApiFormat('unknown'), 'chat/completions')
  assert.equal(normalizeApiFormat(undefined), 'chat/completions')

  assert.equal(resolveModelsEndpoint('http://localhost:18080'), 'http://localhost:18080/v1/models')
  assert.equal(resolveModelsEndpoint('http://localhost:18080/v1/chat/completions'), 'http://localhost:18080/v1/models')
})

// ── llm-pi-ai materialization ──────────────────────────────────────────────

test('piAiProtocolFor: API format to official adapter protocol ids', () => {
  assert.equal(piAiProtocolFor('chat/completions'), 'openai-completions')
  assert.equal(piAiProtocolFor('responses'), 'openai-responses')
  assert.equal(piAiProtocolFor('anthropic-messages'), 'anthropic-messages')
  assert.equal(piAiProtocolFor('messages'), 'anthropic-messages')
  assert.equal(piAiProtocolFor(undefined), 'openai-completions')
})

test('piAiBaseURL: OpenAI routes keep /v1, the Anthropic route keeps the bare root', () => {
  // OpenAI SDKs append /chat/completions and /responses to the base themselves
  assert.equal(piAiBaseURL('http://localhost:18080', 'chat/completions'), 'http://localhost:18080/v1')
  assert.equal(piAiBaseURL('http://localhost:18080', 'responses'), 'http://localhost:18080/v1')
  assert.equal(piAiBaseURL('http://localhost:18080/v1', 'chat/completions'), 'http://localhost:18080/v1')

  // The Anthropic SDK appends /v1/messages itself, so the root stays bare
  assert.equal(piAiBaseURL('http://localhost:18080', 'anthropic-messages'), 'http://localhost:18080')
  assert.equal(piAiBaseURL('http://localhost:18080/v1', 'anthropic-messages'), 'http://localhost:18080')

  // Endpoint paths already spelled in the configured base are stripped first
  assert.equal(piAiBaseURL('http://localhost:18080/v1/chat/completions', 'responses'), 'http://localhost:18080/v1')
  assert.equal(piAiBaseURL('http://localhost:18080/v1/messages', 'anthropic-messages'), 'http://localhost:18080')
  assert.equal(piAiBaseURL('http://gw.example/openai/v1/', 'chat/completions'), 'http://gw.example/openai/v1')
})

test('ladderToReasoningEfforts: identity ladders, off handling, non-standard rungs', () => {
  assert.equal(ladderToReasoningEfforts(undefined), false, 'absent ladder marks a non-reasoning model')
  assert.equal(ladderToReasoningEfforts([]), false)
  assert.equal(ladderToReasoningEfforts(['off']), false, 'off alone cannot satisfy the one-rung rule')
  assert.equal(ladderToReasoningEfforts(['none']), false)

  assert.deepEqual(ladderToReasoningEfforts(['low', 'medium', 'high']), {
    low: 'low', medium: 'medium', high: 'high',
  })

  // off/none become the null-valued "supported, send no parameter" entry
  assert.deepEqual(ladderToReasoningEfforts(['off', 'high']), { off: null, high: 'high' })

  // Non-standard rungs borrow free selector keys from the top down
  assert.deepEqual(ladderToReasoningEfforts(['ultra']), { max: 'ultra' })
  assert.deepEqual(ladderToReasoningEfforts(['turbo', 'ultra']), { max: 'turbo', xhigh: 'ultra' })
  assert.deepEqual(ladderToReasoningEfforts(['off', 'high', 'ultra']), { off: null, high: 'high', max: 'ultra' })

  // Custom spellings keep their wire form under the nearest free key
  assert.deepEqual(ladderToReasoningEfforts(['fast', 'deep']), { max: 'fast', xhigh: 'deep' })
})

test('streamOptionsWithPreferredEffort: direct streams get this model\'s rung only', () => {
  const efforts = [{ id: 'low' }, { id: 'high' }]
  const plain = { provider: 'ai-proxy', model: 'gemini-3.8-flash', messages: [], purpose: 'compaction' }
  const filled = streamOptionsWithPreferredEffort(plain, efforts, 'highest')
  assert.equal(filled.reasoningEffort, 'high')
  assert.equal(plain.reasoningEffort, undefined, 'the caller\'s options object is not mutated')
  assert.equal(filled.purpose, 'compaction')
  const explicit = { provider: 'ai-proxy', model: 'gemini-3.8-flash', reasoningEffort: 'low' }
  assert.equal(streamOptionsWithPreferredEffort(explicit, efforts, 'highest'), explicit, 'an explicit effort is kept')
  const other = { provider: 'other', model: 'x' }
  assert.equal(streamOptionsWithPreferredEffort(other, efforts, 'highest'), other, 'another provider is untouched')
  assert.equal(streamOptionsWithPreferredEffort(plain, [], 'off'), plain, 'a disabled preference sends no effort')
})

test('preferredEffort: one model\'s own ladder, never a catalog-wide rung', () => {
  const efforts = [{ id: 'low' }, { id: 'medium' }, { id: 'high' }]
  assert.equal(preferredEffort(efforts, 'highest'), 'high', 'highest stays inside this model')
  assert.equal(preferredEffort(efforts, 'lowest'), 'low')
  assert.equal(preferredEffort(efforts, 'max'), 'high', 'a missing stronger rung falls to the nearest lower one')
  assert.equal(preferredEffort(efforts, 'off'), undefined, 'a disabled preference sends no effort')
  assert.equal(preferredEffort([{ id: 'off' }], 'highest'), undefined, 'off alone is not a thinking level')
  assert.equal(preferredEffort([], 'highest'), undefined)
  assert.equal(preferredEffort(undefined, 'highest'), undefined)
})

test('routeDefaultEffortKey: the route default spans every model ladder', () => {
  const models = [
    { id: 'a', effortLevels: ['medium'] },                        // claude-opus-style: only medium
    { id: 'b', effortLevels: ['off', 'low', 'high'] },
    { id: 'c', effortLevels: ['off', 'ultra'] },                  // ultra borrows the max slot
  ]
  assert.equal(routeDefaultEffortKey(models, 'highest'), 'max',
    "'highest' reaches the strongest key ANY model offers, not the first ladder's ceiling")
  assert.equal(routeDefaultEffortKey(models, 'lowest'), 'low', "weakest non-off key across models")
  assert.equal(routeDefaultEffortKey(models, 'high'), 'high', 'exact offered key wins')
  assert.equal(routeDefaultEffortKey(models, 'xhigh'), 'high', 'missing rung falls to the nearest lower offered key')
  assert.equal(routeDefaultEffortKey(models, 'medium'), 'medium')
  assert.equal(routeDefaultEffortKey(models, 'off'), 'off', 'a disabled preference stays off')

  assert.equal(routeDefaultEffortKey([{ id: 'x', effortLevels: ['low', 'max'] }], 'highest'), 'max')
  assert.equal(routeDefaultEffortKey([{ id: 'x', effortLevels: [] }], 'highest'), undefined, 'no reasoning models, no default')
  assert.equal(routeDefaultEffortKey([], 'highest'), undefined)
  assert.equal(routeDefaultEffortKey(undefined, 'highest'), undefined)
})

test('routeCompatFor: OpenAI-family routes refuse the developer role, Anthropic omits the switch', () => {
  assert.deepEqual(routeCompatFor('openai-completions'), { supportsDeveloperRole: false })
  assert.deepEqual(routeCompatFor('openai-responses'), { supportsDeveloperRole: false })
  assert.equal(routeCompatFor('anthropic-messages'), undefined)
})

test('buildProviderProfile: full shape, defaults, effort ladder and headers', () => {
  const options = resolveOptions({
    baseURL: 'http://localhost:18080',
    apiFormat: 'anthropic-messages',
    apiKeyEnv: 'AIPROXY_API_KEY',
    maxTokens: 8192,
    defaultContextWindow: 131072,
    streamIdleTimeoutMs: 120000,
    retryPolicy: { mode: 'normal', maxRetries: 3 },
  })
  const models = [
    { id: 'tiered-model', name: 'tiered-model', contextWindow: 200000, effortLevels: ['low', 'medium', 'high'], inputModalities: ['text', 'image'] },
    { id: 'plain-model', name: 'plain-model', inputModalities: ['text'] },
    { id: 'strong-model', name: 'strong-model', effortLevels: ['off', 'ultra'] },
  ]
  const profile = buildProviderProfile(options, models)

  assert.equal(profile.displayName, 'AI Proxy')
  assert.equal(profile.apiKeyEnv, 'AIPROXY_API_KEY')
  assert.equal(profile.api, 'anthropic-messages')
  assert.equal(profile.baseURL, 'http://localhost:18080')
  assert.deepEqual(profile.headers, { 'x-ai-proxy-client': 'dsh' })
  assert.equal(profile.defaultContextWindow, 131072)
  assert.equal(profile.defaultMaxTokens, 8192)
  assert.equal(profile.streamIdleTimeoutMs, 120000)
  assert.deepEqual(profile.retryPolicy, { mode: 'normal', maxRetries: 3 })
  assert.equal('reasoning' in profile, false,
    'profile.reasoning is omitted so dynamic hooks pick each model ladder independently')
  assert.equal('compat' in profile, false, 'Anthropic Messages does not take supportsDeveloperRole')

  assert.equal(profile.models.length, 3)
  assert.deepEqual(profile.models[0], {
    id: 'tiered-model',
    contextWindow: 200000,
    input: ['text', 'image'],
    reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' },
  }, 'name equal to id is omitted, per-model fields pass through')
  assert.deepEqual(profile.models[1], {
    id: 'plain-model',
    input: ['text'],
    reasoningEfforts: false,
  }, 'no ladder marks a non-reasoning model')
  assert.deepEqual(profile.models[2], {
    id: 'strong-model',
    input: ['text'],
    reasoningEfforts: { off: null, max: 'ultra' },
  }, 'undisclosed media defaults to text; non-standard rungs keep their wire spelling')
})

test('buildProviderProfile: chat/completions default spells the /v1 base', () => {
  const profile = buildProviderProfile(resolveOptions({ baseURL: 'http://gw.example/' }), [])
  assert.equal(profile.api, 'openai-completions')
  assert.equal(profile.baseURL, 'http://gw.example/v1')
  assert.equal(profile.apiKeyEnv, 'AIPROXY_ACCESS_TOKEN', 'apiKeyEnv bridges to the OAuth ref by default')
  assert.equal('reasoning' in profile, false)
  assert.equal('retryPolicy' in profile, false, 'unconfigured policy is omitted for the host default')
  assert.deepEqual(profile.compat, { supportsDeveloperRole: false },
    'custom OpenAI-compatible gateways must not rewrite system prompts to role=developer')
})

test('buildProviderProfile: responses protocol also refuses the developer role', () => {
  const profile = buildProviderProfile(resolveOptions({
    baseURL: 'http://gw.example/',
    apiFormat: 'responses',
  }), [{ id: 'reasoner', effortLevels: ['low', 'high'] }])
  assert.equal(profile.api, 'openai-responses')
  assert.deepEqual(profile.compat, { supportsDeveloperRole: false })
})
