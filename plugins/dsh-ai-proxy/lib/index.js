/**
 * dsh-ai-proxy: DeepSeek Harness provider for an AI Proxy Service gateway.
 *
 * The gateway is an OAuth 2.0 authorization server (RFC 8414 discovery,
 * authorization code + mandatory PKCE S256, public clients, loopback
 * redirects) and an OpenAI-compatible /v1 surface whose model list carries
 * per-plan models with context windows, modalities and per-model reasoning
 * effort ladders ("effort_levels"). This plugin:
 *
 *   - registers the "ai-proxy" provider route (LlmAdapter over
 *     POST /v1/chat/completions, SSE -> StreamChunk),
 *   - runs OAuth through a Host-only authentication interface, stores
 *     access/refresh tokens through the credentials seam, refreshes with
 *     rotation, and revokes on logout,
 *   - discovers models from GET /v1/models with the user's own credential,
 *     exposing each model's effort ladder as DSH reasoning efforts,
 *   - exposes stable provider settings while login/logout/status travel over
 *     a loopback-only Host RPC channel and never enter settings.yaml.
 *
 * Wire shape: OpenAI chat/completions. Reasoning effort is passed through
 * verbatim as the "reasoning_effort" request field; the gateway translates
 * and clamps it per upstream provider. Replayed reasoning content is NOT
 * sent (the gateway sanitizes it per provider itself).
 *
 * @module dsh-ai-proxy
 */
import z from '@deepseek-ai/schemastery'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import {
  CallId, LlmAdapter, LlmError, ProviderRequestId, ReasoningEffortId,
  RetryPolicySchema, assertUsableApiKey, attributionHeaders, contentHasImage,
  EMPTY_RESPONSE_CODE, QUOTA_EXCEEDED_CODE, CONTEXT_WINDOW_EXCEEDED_CODE,
  isQuotaExceededError, isContextWindowExceededError, resolveRetryPolicy,
} from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { MAX_TIMER_DELAY_MS, idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { deepEqualJson } from '@deepseek-ai/dsh-settings'
import { EventSourceParserStream } from 'eventsource-parser/stream'
import {
  ACCESS_REF, REFRESH_REF, EXPIRY_REF, CLIENT_ID_PATTERN, OAuthSession,
  base64url, pkcePair, discoverEndpoints, tokenRequest, startCallbackListener,
} from './oauth.js'

export {
  ACCESS_REF, REFRESH_REF, EXPIRY_REF, CLIENT_ID_PATTERN,
  base64url, pkcePair, discoverEndpoints, tokenRequest, startCallbackListener,
}

// ── constants ──────────────────────────────────────────────────────────────

export const name = 'llm-ai-proxy'
export const inject = ['llm', 'credentials', 'settings']

/** The single provider route this plugin owns. */
export const PROVIDER = 'ai-proxy'
/** Settings namespace owning this provider's profile. */
export const NS = 'ai-proxy'

export const DEFAULT_BASE_URL = 'http://localhost:18080'
export const DEFAULT_CLIENT_ID = 'dsh'
export const DEFAULT_MAX_TOKENS = 65536
export const DEFAULT_CONTEXT_WINDOW = 200000
export const DEFAULT_MODEL_CACHE_TTL_MS = 300000
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000

export const DEFAULT_API_KEY_ENV = 'AIPROXY_ACCESS_TOKEN'
/** Credential/env reference for Remote Control's write-only shared secret. */
export const REMOTE_CONTROL_SECRET_REF = 'DSH_REMOTE_CONTROL_SECRET'

const STREAM_IDLE_TIMEOUT_CODE = 'LLM_STREAM_IDLE_TIMEOUT'

// ── pure helpers (exported for tests) ──────────────────────────────────────

/** Human-readable display name for a gateway effort rung. */
export function effortName(id) {
  const names = {
    none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium',
    high: 'High', xhigh: 'X-High', ultra: 'Ultra', max: 'Max', turbo: 'Turbo',
  }
  return names[id] ?? id
}

/**
 * Map a gateway catalog entry's perceived media to the harness vocabulary.
 * Absent (or empty) means the gateway said nothing — an unknown, deliberately
 * not "text only", so the harness keeps its image affordance permissive. A
 * declared set containing image maps to ['text','image']; any other declared
 * set is an explicit text-only claim and maps to ['text'].
 */
export function inputModalitiesOf(entry) {
  const inputs = entry?.inputModalities
  if (inputs === undefined || inputs.length === 0) return undefined
  return inputs.includes('image') ? ['text', 'image'] : ['text']
}

export function flattenText(blocks) {
  return blocks.filter((block) => block.type === 'text').map((block) => block.text).join('')
}

/** Base64 data URL for one stored image, the OpenAI image_url spelling. */
export function imageDataUrl(stored) {
  return 'data:' + stored.ref.mediaType + ';base64,' + Buffer.from(stored.data).toString('base64')
}

/**
 * Serialize one user message's content list into the OpenAI wire: a plain
 * string when it is all text, else a content-parts array in which image blocks
 * become image_url data URLs read from the durable attachment service. Images
 * anywhere else in the conversation are rejected by serializeMessages before
 * any text-flattening path can silently erase them.
 */
export async function serializeUserContent(content, attachments) {
  const parts = []
  for (const block of content) {
    if (block.type === 'text') {
      if (block.text.length > 0) parts.push({ type: 'text', text: block.text })
    } else if (block.type === 'image') {
      const stored = await attachments.readImage(block.attachment)
      parts.push({ type: 'image_url', image_url: { url: imageDataUrl(stored) } })
    }
  }
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text
  if (parts.length === 0) return ''
  return parts
}

/**
 * Serialize harness messages into standard OpenAI chat/completions wire
 * messages. Assistant reasoning is deliberately NOT replayed: the gateway
 * sanitizes replayed reasoning_content per provider itself.
 *
 * Image blocks are carried only where the OpenAI dialect can represent them —
 * user content parts. An image in a system or assistant message, or inside a
 * tool result, is rejected instead of silently flattened away; the harness
 * only produces user-content images today, so those are programmer errors.
 */
export async function serializeMessages(messages, attachments) {
  const wire = []
  for (const message of messages) {
    if (message.role === 'system') {
      if (contentHasImage(message.content)) {
        throw new LlmError('AI Proxy adapter cannot represent an image in a system message.', 'UNSUPPORTED_CONTENT')
      }
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      if (contentHasImage(message.content)) {
        throw new LlmError('AI Proxy adapter cannot represent an image in an assistant message.', 'UNSUPPORTED_CONTENT')
      }
      const text = flattenText(message.content)
      const toolCalls = message.content
        .filter((block) => block.type === 'tool-call')
        .map((block) => ({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: block.arguments },
        }))
      wire.push({
        role: 'assistant',
        content: text,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
      continue
    }
    const toolResults = message.content.filter((block) => block.type === 'tool-result')
    for (const result of toolResults) {
      if (contentHasImage(result.content)) {
        throw new LlmError('AI Proxy adapter cannot represent an image inside a tool result.', 'UNSUPPORTED_CONTENT')
      }
    }
    const text = flattenText(message.content)
    if (contentHasImage(message.content)) {
      wire.push({ role: 'user', content: await serializeUserContent(message.content, attachments) })
    } else if (text.length > 0 || toolResults.length === 0) {
      wire.push({ role: 'user', content: text })
    }
    for (const result of toolResults) {
      wire.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        content: flattenText(result.content) || '(no output)',
      })
    }
  }
  return wire
}

/**
 * Build the full OpenAI chat/completions request. Always streaming; no
 * stream_options (the gateway rejects fields it cannot preserve, and usage
 * is optional for the harness). reasoning_effort passes through verbatim;
 * session-title requests omit it. attachments is the durable attachment
 * service, required only when the conversation carries an image.
 */
export async function serializeRequest(options, attachments) {
  const messages = []
  if (options.system !== undefined) messages.push({ role: 'system', content: options.system })
  messages.push(...await serializeMessages(options.messages, attachments))
  const tools = options.tools?.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
  return {
    model: options.model,
    messages,
    stream: true,
    ...(options.purpose !== 'session-title' && options.reasoningEffort !== undefined
      ? { reasoning_effort: options.reasoningEffort }
      : {}),
    ...(tools !== undefined && tools.length > 0 ? { tools } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
    ...(options.stop !== undefined ? { stop: options.stop } : {}),
  }
}

/** Map the wire finish_reason vocabulary to the harness FinishReason. */
export function mapFinishReason(reason) {
  switch (reason) {
    case 'stop': return { kind: 'stop' }
    case 'tool_calls': return { kind: 'tool-calls' }
    case 'length': return { kind: 'max-tokens' }
    default:
      return { kind: 'error', failure: { message: 'model stopped: ' + reason, code: String(reason ?? 'unknown').toUpperCase() } }
  }
}

/**
 * Map wire usage to DISJOINT harness counts: cached prompt tokens are
 * subtracted out of inputTokens (billed input = input + cacheRead).
 */
export function mapUsage(usage) {
  const cacheRead = usage.prompt_tokens_details?.cached_tokens
  const reasoning = usage.completion_tokens_details?.reasoning_tokens
  return {
    inputTokens: (usage.prompt_tokens ?? 0) - (cacheRead ?? 0),
    outputTokens: usage.completion_tokens ?? 0,
    ...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}),
    ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}),
  }
}

/** Assemble the final ContentBlock for one open block. */
export function closeBlock(block) {
  switch (block.kind) {
    case 'text':
      return { type: 'text', text: block.text }
    case 'reasoning':
      return { type: 'reasoning', text: block.text }
    case 'tool-call':
      return {
        type: 'tool-call',
        id: CallId(block.callId ?? ''),
        name: block.name ?? '',
        arguments: block.text,
      }
  }
}

/**
 * Consume SSE data payloads (ending with [DONE]) and yield StreamChunks.
 * Block indexes correlate interleaved deltas; block-end, usage and finish
 * are deferred to the [DONE] sentinel. A stop with no opened blocks is a
 * degenerate completion and maps to an EMPTY_RESPONSE error finish.
 */
export async function* translate(payloads) {
  let nextIndex = 0
  let textBlock
  let reasoningBlock
  const toolBlocks = new Map()
  const order = []
  let pendingFinish
  let pendingUsage

  function open(kind) {
    const block = { index: nextIndex++, kind, text: '', callId: undefined, name: undefined }
    order.push(block)
    return block
  }

  for await (const payload of payloads) {
    if (payload === '[DONE]') {
      for (const block of order) {
        yield { type: 'block-end', index: block.index, block: closeBlock(block) }
      }
      if (pendingUsage) yield { type: 'usage', usage: pendingUsage }
      const reason = pendingFinish ?? { kind: 'stop' }
      yield {
        type: 'finish',
        reason: reason.kind === 'stop' && order.length === 0
          ? { kind: 'error', failure: { message: 'provider returned an empty response', code: EMPTY_RESPONSE_CODE } }
          : reason,
      }
      return
    }
    let chunk
    try {
      chunk = JSON.parse(payload)
    } catch {
      throw new LlmError('provider returned malformed SSE JSON', 'MALFORMED_RESPONSE')
    }
    if (chunk.usage) pendingUsage = mapUsage(chunk.usage)
    const choice = chunk.choices?.[0]
    if (!choice) continue
    const delta = choice.delta ?? {}
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      const created = textBlock === undefined
      textBlock ??= open('text')
      if (created) yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
      textBlock.text += delta.content
      yield { type: 'text-delta', index: textBlock.index, text: delta.content }
    }
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
      const created = reasoningBlock === undefined
      reasoningBlock ??= open('reasoning')
      if (created) yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' }
      reasoningBlock.text += delta.reasoning_content
      yield { type: 'reasoning-delta', index: reasoningBlock.index, text: delta.reasoning_content }
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const item of delta.tool_calls) {
        if (item?.index === undefined) continue
        let block = toolBlocks.get(item.index)
        if (!block) {
          block = open('tool-call')
          toolBlocks.set(item.index, block)
          yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
        }
        if (typeof item.id === 'string' && block.callId === undefined) block.callId = item.id
        if (typeof item.function?.name === 'string' && block.name === undefined) block.name = item.function.name
        const fragment = item.function?.arguments ?? ''
        if (fragment.length > 0) {
          block.text += fragment
          yield {
            type: 'tool-call-delta',
            index: block.index,
            id: CallId(block.callId ?? ''),
            name: block.name,
            argumentsDelta: fragment,
          }
        }
      }
    }
    if (typeof choice.finish_reason === 'string') pendingFinish = mapFinishReason(choice.finish_reason)
  }
  throw new LlmError('SSE payload stream ended without [DONE]', 'STREAM_CLOSED')
}

/** Parse an SSE byte stream into data payloads, [DONE]-terminated. */
export async function* parseSse(stream, onComment) {
  const events = stream.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream({ onComment }))
  for await (const { data } of events) {
    yield data
    if (data === '[DONE]') return
  }
  throw new LlmError('SSE stream ended without [DONE]', 'STREAM_CLOSED')
}

export function providerRetryAfterMs(value) {
  if (value === null) return undefined
  if (/^\d+$/.test(value)) {
    const delay = Number(value) * 1000
    return Number.isFinite(delay) && delay > 0 ? delay : undefined
  }
  const delay = Date.parse(value) - Date.now()
  return Number.isFinite(delay) && delay > 0 ? delay : undefined
}

export function requestId(headers) {
  const value = headers.get('x-request-id')
  return value === null || value.length === 0 ? undefined : ProviderRequestId(value)
}

/** Map an HTTP status and OpenAI-shaped error body to a stable LlmError code. */
export function httpErrorCode(status, error) {
  if (status === 401 || status === 403) return 'AUTH'
  const detail = [error?.code, error?.type, error?.message].filter(Boolean).join(' ')
  if (isQuotaExceededError(detail)) return QUOTA_EXCEEDED_CODE
  if (status === 429) return 'RATE_LIMIT'
  if (status === 400) {
    if (isContextWindowExceededError(detail)) return CONTEXT_WINDOW_EXCEEDED_CODE
    return 'INVALID_REQUEST'
  }
  if (status >= 500) return 'SERVER'
  return 'HTTP_' + status
}

/** Turn a non-ok provider response into a LlmError with provider facts. */
export async function errorFromResponse(response) {
  let message = 'AI Proxy API error (HTTP ' + response.status + ')'
  let providerError
  try {
    providerError = (await response.json()).error
    if (providerError?.message) message = providerError.message
  } catch {}
  const delay = providerRetryAfterMs(response.headers.get('retry-after'))
  const id = requestId(response.headers)
  return new LlmError(message, httpErrorCode(response.status, providerError), {
    status: response.status,
    ...(delay === undefined ? {} : { providerRetryAfterMs: delay }),
    ...(id === undefined ? {} : { requestId: id }),
  })
}

// ── gateway API: credentials, OAuth, catalog ───────────────────────────────

/**
 * Host-side gateway facade: provider authentication, model catalog and
 * inference share one resolved provider profile.
 */
class AiProxyApi {
  constructor(ctx, options) {
    this.ctx = ctx
    this.options = options
    this.modelsCache = null
    this.oauth = new OAuthSession({
      credentials: this.credentials,
      options,
      logger: ctx.logger,
      onTokensChanged: () => this.invalidateModels(),
    })
  }

  get credentials() {
    return this.ctx.credentials
  }

  async staticKey() {
    const ref = credentialRef(this.options().apiKeyEnv)
    const hit = await this.credentials.resolve(ref)
    if (hit?.value) return assertUsableApiKey(hit.value, name, ref)
    return undefined
  }

  /**
   * Resolve the bearer token for one operation: stored OAuth access token
   * when fresh, a rotated one after refresh, or the static API key. Never
   * caches across operations — a changed credential reaches the next request.
   */
  async resolveCredential({ force } = {}) {
    const oauth = await this.oauth.resolve({ force })
    if (oauth !== undefined) return { token: oauth, source: 'oauth' }
    const key = await this.staticKey()
    if (key !== undefined) return { token: key, source: 'key' }
    throw new LlmError(
      '未登录 AI Proxy 网关: 在设置 → AI Proxy 选择「登录」,或配置 ' + this.options().apiKeyEnv + ' 密钥',
      'MISSING_CREDENTIAL',
    )
  }

  invalidateModels() {
    this.modelsCache = null
  }

  /** Return credential-derived OAuth display state. */
  authStatus() {
    return this.oauth.status()
  }

  /**
   * Current gateway facts for the settings page. The browser settings
   * transport only exposes namespaces of registered configurable providers,
   * so while logged out this Host-side read is the page's only source.
   */
  gateway() {
    const opts = this.options()
    return { baseURL: opts.baseURL, clientId: opts.clientId }
  }

  /**
   * Validate and persist one gateway address through the Host settings seam
   * (never exposure-filtered), then drop the cached catalog.
   */
  async setGateway(baseURL) {
    const value = typeof baseURL === 'string' ? baseURL.trim().replace(/\/+$/, '') : ''
    if (value === '') throw new LlmError('网关地址不能为空', 'INVALID_REQUEST')
    let url
    try {
      url = new URL(value)
    } catch {
      throw new LlmError('网关地址格式无效', 'INVALID_REQUEST')
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new LlmError('网关地址必须使用 http 或 https', 'INVALID_REQUEST')
    }
    await this.ctx.settings.mutate(NS, [{ op: 'set', path: ['baseURL'], value }])
    this.invalidateModels()
    return this.gateway()
  }

  /** Start browser authorization without holding the RPC open for the callback. */
  login({ remote = false } = {}) {
    return this.oauth.login({ remote })
  }

  /** Exchange the code returned by the gateway's remote-browser OOB page. */
  async completeLogin(code, state) {
    const body = await this.oauth.completeLogin(code, state)
    const models = await this.catalog()
    const minutes = Math.round((Number(body.expires_in) || 3600) / 60)
    return {
      state: 'signed-in',
      message: '已登录 · ' + models.length + ' 个模型 · access token 约 ' + minutes + ' 分钟有效',
    }
  }

  /** Revoke the grant and return credential-derived signed-out state. */
  async logout() {
    return this.oauth.logout()
  }

  /** Normalized model entry from a /v1/models item. */
  static normalizeModel(item) {
    const effortLevels = Array.isArray(item.effort_levels)
      ? item.effort_levels.map(String)
      : undefined
    const inputModalities = Array.isArray(item.input_modalities)
      ? item.input_modalities.map(String).filter((kind) => kind === 'text' || kind === 'image' || kind === 'audio' || kind === 'video')
      : undefined
    return {
      id: item.id,
      name: item.id,
      ...(Number.isInteger(item.context_window) ? { contextWindow: item.context_window } : {}),
      ...(effortLevels === undefined ? {} : { effortLevels }),
      ...(typeof item.modality === 'string' ? { modality: item.modality } : {}),
      ...(inputModalities === undefined || inputModalities.length === 0 ? {} : { inputModalities }),
    }
  }

  /**
   * The per-plan model catalog, cached for modelCacheTtlMs. Falls back to
   * the configured static catalog when there is no credential or the
   * gateway is unreachable — the catalog is advisory, not a whitelist.
   */
  async catalog() {
    const opts = this.options()
    if (this.modelsCache && Date.now() - this.modelsCache.at < opts.modelCacheTtlMs) {
      return this.modelsCache.models
    }
    const fallback = opts.models.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      ...(m.description !== undefined ? { description: m.description } : {}),
      ...(m.contextWindow !== undefined ? { contextWindow: m.contextWindow } : {}),
      ...(m.maxTokens !== undefined ? { maxTokens: m.maxTokens } : {}),
      effortLevels: [],
    }))
    let credential
    try {
      credential = await this.resolveCredential()
    } catch (error) {
      if (error.code === 'MISSING_CREDENTIAL') return fallback
      throw error
    }
    try {
      const res = await fetch(opts.baseURL + '/v1/models', {
        headers: { authorization: 'Bearer ' + credential.token },
      })
      if (!res.ok) throw await errorFromResponse(res)
      const body = await res.json()
      const models = (body.data ?? []).filter((m) => typeof m?.id === 'string').map(AiProxyApi.normalizeModel)
      this.modelsCache = { at: Date.now(), models }
      return models
    } catch (error) {
      this.ctx.logger.warn('dsh-ai-proxy: /v1/models 拉取失败,回退静态目录: ' + error.message)
      return fallback
    }
  }

  async findModel(model) {
    const catalog = await this.catalog()
    return catalog.find((entry) => entry.id === model)
  }

  /** Model discovery for the Models page "ask the endpoint" action. */
  async discover(request) {
    const opts = this.options()
    const base = (request.baseURL ?? opts.baseURL).replace(/\/+$/, '')
    let token = request.apiKey
    if (token === undefined) {
      try {
        token = (await this.resolveCredential()).token
      } catch {
        throw new LlmError('请先完成 OAuth 登录,或在此提供一次性 API key', 'MISSING_CREDENTIAL')
      }
    }
    const res = await fetch(base + '/v1/models', {
      headers: { authorization: 'Bearer ' + token },
      signal: request.signal,
    })
    if (!res.ok) throw await errorFromResponse(res)
    const body = await res.json()
    return (body.data ?? [])
      .filter((m) => typeof m?.id === 'string')
      .map((m) => ({
        id: m.id,
        name: m.id,
        ...(Number.isInteger(m.context_window) ? { contextWindow: m.context_window } : {}),
      }))
  }

  /** Startup probe: refresh when needed and prime the model catalog. */
  async bootstrap() {
    try {
      await this.resolveCredential()
      await this.catalog()
    } catch (error) {
      if (error.code === 'MISSING_CREDENTIAL') return
      this.ctx.logger.error('dsh-ai-proxy: 启动时刷新令牌失败: ' + error.message)
    }
  }
}

// ── the LlmAdapter ─────────────────────────────────────────────────────────

class AiProxyAdapter extends LlmAdapter {
  constructor(api, resolveAttachments) {
    super()
    this.api = api
    this.resolveAttachments = resolveAttachments ?? (() => undefined)
  }

  providerInfo(provider) {
    return { id: provider, name: 'AI Proxy' }
  }

  providerRetryPolicy(_provider) {
    return this.api.options().retryPolicy
  }

  listModels(provider) {
    return this.api.catalog().then((models) => models.map((model) => {
      const inputModalities = inputModalitiesOf(model)
      return {
        provider,
        id: model.id,
        name: model.name,
        ...(model.description !== undefined ? { description: model.description } : {}),
        ...(inputModalities === undefined ? {} : { inputModalities }),
      }
    }))
  }

  async resolveModel(provider, model, _signal) {
    const opts = this.api.options()
    const entry = await this.api.findModel(model)
    const contextWindow = entry?.contextWindow ?? opts.defaultContextWindow
    const inputModalities = inputModalitiesOf(entry)
    const base = {
      provider,
      id: model,
      name: entry?.name ?? model,
      ...(entry?.description !== undefined ? { description: entry.description } : {}),
      ...(inputModalities === undefined ? {} : { inputModalities }),
      context: { contextWindow },
      defaultMaxTokens: entry?.maxTokens ?? opts.maxTokens,
    }
    const ladder = entry?.effortLevels ?? []
    if (ladder.length === 0) return base
    const configured = opts.defaultReasoningEffort
    const defaultEffort = configured !== '' && ladder.includes(configured) ? configured : ladder[0]
    return {
      ...base,
      reasoning: {
        efforts: ladder.map((effort) => ({ id: ReasoningEffortId(effort), name: effortName(effort) })),
        defaultEffort: ReasoningEffortId(defaultEffort),
      },
    }
  }

  async *stream(options) {
    const consumer = new AbortController()
    const watchdog = idleWatchdog(
      options.signal === undefined ? consumer.signal : AbortSignal.any([options.signal, consumer.signal]),
      this.api.options().streamIdleTimeoutMs,
      STREAM_IDLE_TIMEOUT_CODE,
    )
    // One image anywhere in the conversation flips both gates below. The model
    // gate re-reads the catalog entry (same cache the picker resolved from):
    // only a DECLARED text-only model is refused here — an unknown entry stays
    // permissive, matching the gateway's own optimistic routing. The model gate
    // runs first: a refused capability is more actionable than a missing
    // service, and both must be true before any image bytes are read.
    const containsImage = options.messages.some((message) => contentHasImage(message.content))
    if (containsImage) {
      const entry = await this.api.findModel(options.model)
      if (entry !== undefined && entry.inputModalities !== undefined && !entry.inputModalities.includes('image')) {
        throw new LlmError('ai-proxy model "' + options.model + '" does not support image input', 'UNSUPPORTED_CONTENT')
      }
    }
    const attachments = containsImage ? this.resolveAttachments() : undefined
    if (containsImage && attachments === undefined) {
      throw new LlmError('AI Proxy image input requires the durable attachment service', 'UNSUPPORTED_CONTENT')
    }
    const iterator = this.request(options, watchdog.signal, () => watchdog.pulse(), attachments)[Symbol.asyncIterator]()
    let exhausted = false
    try {
      while (true) {
        const result = await watchdog.next(iterator)
        if (result.done) {
          exhausted = true
          return
        }
        yield result.value
      }
    } catch (error) {
      if (timeoutOf(watchdog.signal, STREAM_IDLE_TIMEOUT_CODE) !== undefined) {
        throw new LlmError('AI Proxy stream idle timeout after ' + this.api.options().streamIdleTimeoutMs + 'ms', 'TIMEOUT', { cause: error })
      }
      if (options.signal?.aborted) throw new LlmError('AI Proxy request aborted by caller', 'ABORTED', { cause: error })
      if (error instanceof LlmError) throw error
      throw new LlmError('AI Proxy API stream from ' + this.api.options().baseURL + ' failed', 'TRANSPORT', { cause: error })
    } finally {
      consumer.abort('AI Proxy stream consumer stopped')
      if (!exhausted && iterator.return !== undefined) {
        try {
          await iterator.return()
        } catch {}
      }
    }
  }

  async *request(options, signal, onComment, attachments) {
    const opts = this.api.options()
    const body = await serializeRequest(options, attachments)
    const payload = JSON.stringify(body)
    const base = opts.baseURL.replace(/\/+$/, '')
    const buildHeaders = (token) => ({
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...attributionHeaders(),
      'x-ai-proxy-client': 'dsh',
      ...(options.sessionId !== undefined ? { 'x-ai-proxy-session-id': String(options.sessionId) } : {}),
    })
    const post = async (token) => {
      try {
        return await fetch(base + '/v1/chat/completions', {
          method: 'POST',
          headers: buildHeaders(token),
          body: payload,
          signal,
        })
      } catch (error) {
        if (signal.aborted) throw error
        throw new LlmError('AI Proxy API request to ' + base + ' failed', 'TRANSPORT', { cause: error })
      }
    }
    let credential = await this.api.resolveCredential()
    let response = await post(credential.token)
    if (response.status === 401) {
      // Token may have expired across processes: rotate once, then retry once.
      const retried = await this.api.resolveCredential({ force: true })
      if (retried.token !== credential.token) {
        credential = retried
        response = await post(credential.token)
      }
    }
    if (!response.ok) throw await errorFromResponse(response)
    if (!response.body) throw new LlmError('AI Proxy API returned no response body', 'EMPTY_RESPONSE')
    yield* translate(parseSse(response.body, onComment))
  }
}

// ── plugin wiring ──────────────────────────────────────────────────────────

const catalogModel = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
})

/** Plugin config; doubles as the ai-proxy settings-section shape. */
export const Config = z.object({
  baseURL: z.string().default(DEFAULT_BASE_URL),
  clientId: z.string().default(DEFAULT_CLIENT_ID),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  defaultReasoningEffort: z.string().default(''),
  maxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  modelCacheTtlMs: z.number().step(1).min(10000).default(DEFAULT_MODEL_CACHE_TTL_MS),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  remoteAccess: z.boolean().default(false),
  // A manual settings fallback for deployments that cannot use the credentials
  // provider. It is always redacted from settings.describe responses.
  remoteAuthSecret: z.string().role('secret').default(''),
  models: z.array(catalogModel).default([]),
  retryPolicy: RetryPolicySchema,
})

/**
 * One explicit resolve step from raw config to validated options. The
 * settings schema already validates, but programmatic construction may not;
 * re-judge every bound here — fail loud at load, keep the last good
 * snapshot afterwards.
 */
export function resolveOptions(raw) {
  if (typeof raw.baseURL === 'string' && raw.baseURL.trim() === '') throw new Error(name + ': baseURL must not be empty')
  const clientId = raw.clientId ?? DEFAULT_CLIENT_ID
  if (typeof clientId !== 'string' || !CLIENT_ID_PATTERN.test(clientId)) {
    throw new Error(name + ': clientId must be 2-64 lower-case letters, digits, dot, underscore or dash, starting with a letter or digit')
  }
  const streamIdleTimeoutMs = raw.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0 || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(name + ': streamIdleTimeoutMs must be a positive finite number no greater than ' + MAX_TIMER_DELAY_MS)
  }
  const modelCacheTtlMs = raw.modelCacheTtlMs ?? DEFAULT_MODEL_CACHE_TTL_MS
  if (!Number.isInteger(modelCacheTtlMs) || modelCacheTtlMs < 10000) throw new Error(name + ': modelCacheTtlMs must be an integer >= 10000')
  const maxTokens = raw.maxTokens ?? DEFAULT_MAX_TOKENS
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) throw new Error(name + ': maxTokens must be a positive safe integer')
  const defaultContextWindow = raw.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW
  if (!Number.isInteger(defaultContextWindow) || defaultContextWindow <= 0) throw new Error(name + ': defaultContextWindow must be a positive integer')
  const remoteAccess = raw.remoteAccess ?? false
  if (typeof remoteAccess !== 'boolean') throw new Error(name + ': remoteAccess must be a boolean')
  const remoteAuthSecret = raw.remoteAuthSecret ?? ''
  if (typeof remoteAuthSecret !== 'string') throw new Error(name + ': remoteAuthSecret must be a string')
  return {
    baseURL: (raw.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    clientId,
    apiKeyEnv: raw.apiKeyEnv ?? DEFAULT_API_KEY_ENV,
    defaultReasoningEffort: raw.defaultReasoningEffort ?? '',
    maxTokens,
    defaultContextWindow,
    modelCacheTtlMs,
    streamIdleTimeoutMs,
    remoteAccess,
    remoteAuthSecret,
    models: raw.models ?? [],
    retryPolicy: resolveRetryPolicy(raw.retryPolicy, name + ': retryPolicy'),
  }
}

/** Dedicated Host RPC channel for interactive provider authentication. */
export const AUTH_RPC_CHANNEL = '/ai-proxy-auth'
/** Token-authenticated remote control channel; never replaces the core /api route. */
export const REMOTE_CONTROL_RPC_CHANNEL = '/ai-proxy-remote-control'

// This mirrors the upstream loopback-only set. It is deliberately a fixed
// dispatch table, never a caller-controlled object path.
const REMOTE_CONTROL_METHODS = {
  'aiProxy.status': remoteAiProxyMethod('status'),
  'aiProxy.gateway': remoteAiProxyMethod('config'),
  'aiProxy.setBaseURL': remoteAiProxyMethod('setBaseURL'),
  'aiProxy.login': remoteAiProxyMethod('login'),
  'aiProxy.completeLogin': remoteAiProxyMethod('completeLogin'),
  'aiProxy.logout': remoteAiProxyMethod('logout'),
  'agentPreset.read': (api, request) => api.agentPresets.read(request),
  'agentPreset.copy': (api, request) => api.agentPresets.copy(request),
  'agentPreset.openDocument': (api, request, signal) => api.agentPresets.openDocument(request, signal),
  'agentPreset.remove': (api, request) => api.agentPresets.remove(request),
  'host.pickDirectory': (api, request, signal) => api.host.pickDirectory(request, signal),
  'host.openPath': (api, request, signal) => api.host.openPath(request, signal),
  'settings.describe': (api, request) => api.settings.describe(request),
  'settings.openDocument': (api, request, signal) => api.settings.openDocument(request, signal),
  'settings.update': (api, request) => api.settings.update(request),
  'settings.replace': (api, request) => api.settings.replace(request),
  'settings.mutate': (api, request) => api.settings.mutate(request),
  'credentials.describe': (api, request) => api.credentials.describe(request),
  'credentials.set': (api, request) => api.credentials.set(request),
  'credentials.unset': (api, request) => api.credentials.unset(request),
  'llm.discoverModels': (api, request) => api.llm.discoverModels(request),
}

function remoteAiProxyMethod(method) {
  return async (_api, request, _signal, aiProxy) => ({
    result: await handleAuthRpc(aiProxy, method, request.payload, aiProxy.options, true),
  })
}

function badAuthRequest(message) {
  return {
    ok: false,
    error: {
      code: 'bad-request',
      message,
      details: { issues: [{ code: 'custom', path: [], message }] },
    },
  }
}

function remoteControlError(message) {
  return badAuthRequest(message)
}

/** Constant-time compare for the one shared remote-control secret. */
export function matchesRemoteControlSecret(expected, presented) {
  if (typeof expected !== 'string' || expected.length === 0 || typeof presented !== 'string') return false
  const left = Buffer.from(expected)
  const right = Buffer.from(presented)
  return left.length === right.length && timingSafeEqual(left, right)
}

async function remoteControlSecret(ctx, options) {
  const stored = await ctx.credentials.resolve(credentialRef(REMOTE_CONTROL_SECRET_REF))
  return stored?.value || options().remoteAuthSecret || undefined
}

async function remoteControlStatus(ctx, options) {
  return {
    enabled: options().remoteAccess,
    secretConfigured: Boolean(await remoteControlSecret(ctx, options)),
  }
}

async function configureRemoteAccess(ctx, options, enabled) {
  if (typeof enabled !== 'boolean') throw new Error('远程访问开关必须是布尔值')
  await ctx.settings.mutate(NS, [{ op: 'set', path: ['remoteAccess'], value: enabled }])
  return remoteControlStatus(ctx, options)
}

async function setRemoteControlSecret(ctx, options, secret) {
  if (typeof secret !== 'string') throw new Error('远程访问密钥必须是字符串')
  const value = secret.trim()
  if (value.length === 0) await ctx.credentials.unset(REMOTE_CONTROL_SECRET_REF)
  else await ctx.credentials.set(REMOTE_CONTROL_SECRET_REF, value)
  return remoteControlStatus(ctx, options)
}

/** Dispatch the authentication-and-gateway interface over Connection RPC. */
export async function handleAuthRpc(api, method, payload, options = api.options, remote = false) {
  const keys = payload === null || typeof payload !== 'object' || Array.isArray(payload)
    ? null
    : Reflect.ownKeys(payload)
  if (keys === null) {
    return badAuthRequest('AI Proxy authentication requests must carry an object')
  }
  try {
    switch (method) {
      case 'status':
      case 'login':
      case 'logout':
      case 'config': {
        if (keys.length !== 0) return badAuthRequest('AI Proxy ' + method + ' requests must carry an empty object')
        if (method === 'status') return { ok: true, value: await api.authStatus() }
        if (method === 'login') return { ok: true, value: await api.login({ remote }) }
        if (method === 'logout') return { ok: true, value: await api.logout() }
        return { ok: true, value: api.gateway() }
      }
      case 'completeLogin': {
        if (keys.length !== 2 || !Object.hasOwn(payload, 'code') || !Object.hasOwn(payload, 'state')
          || typeof payload.code !== 'string' || typeof payload.state !== 'string') {
          return badAuthRequest('AI Proxy completeLogin requests must carry exactly string code and state fields')
        }
        return { ok: true, value: await api.completeLogin(payload.code, payload.state) }
      }
      case 'setBaseURL': {
        if (keys.length !== 1 || !Object.hasOwn(payload, 'baseURL')) {
          return badAuthRequest('AI Proxy setBaseURL requests must carry exactly one baseURL field')
        }
        return { ok: true, value: await api.setGateway(payload.baseURL) }
      }
      case 'remoteConfig': {
        if (keys.length !== 0) return badAuthRequest('AI Proxy remoteConfig requests must carry an empty object')
        return { ok: true, value: await remoteControlStatus(api.ctx, options) }
      }
      case 'setRemoteAccess': {
        if (keys.length !== 1 || !Object.hasOwn(payload, 'enabled')) {
          return badAuthRequest('AI Proxy setRemoteAccess requests must carry exactly one enabled field')
        }
        return { ok: true, value: await configureRemoteAccess(api.ctx, options, payload.enabled) }
      }
      case 'setRemoteSecret': {
        if (keys.length !== 1 || !Object.hasOwn(payload, 'secret')) {
          return badAuthRequest('AI Proxy setRemoteSecret requests must carry exactly one secret field')
        }
        return { ok: true, value: await setRemoteControlSecret(api.ctx, options, payload.secret) }
      }
      default: return badAuthRequest('Unknown AI Proxy authentication method: ' + method)
    }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'internal',
        message: error instanceof Error ? error.message : String(error),
        details: {},
      },
    }
  }
}

/**
 * Authenticate a trusted-host request, then execute one upstream privileged
 * method inside the Host. The browser can never make this channel call an
 * arbitrary ctx property, and the upstream /api 403 fence remains intact.
 */
export async function handleRemoteControlRpc(ctx, options, method, payload, signal, aiProxy) {
  const keys = payload === null || typeof payload !== 'object' || Array.isArray(payload)
    ? null
    : Reflect.ownKeys(payload)
  if (keys === null || !Object.hasOwn(payload, 'token')) {
    return remoteControlError('远程控制认证失败')
  }
  try {
    const expected = await remoteControlSecret(ctx, options)
    if (method === 'status') {
      if (keys.length !== 1) return remoteControlError('Remote Control status requests must carry exactly one token field')
      const enabled = options().remoteAccess
      return {
        ok: true,
        value: {
          enabled,
          secretConfigured: Boolean(expected),
          authenticated: enabled && matchesRemoteControlSecret(expected, payload.token),
        },
      }
    }
    if (!options().remoteAccess || !matchesRemoteControlSecret(expected, payload.token)) {
      return remoteControlError('远程控制认证失败')
    }
    if (method !== 'call' || keys.length !== 3 || !Object.hasOwn(payload, 'method') || !Object.hasOwn(payload, 'payload')) {
      return remoteControlError('Remote Control requests must be status or a token-authenticated call')
    }
    if (typeof payload.method !== 'string' || !Object.hasOwn(REMOTE_CONTROL_METHODS, payload.method)) {
      return remoteControlError('Remote Control method is not allowed: ' + String(payload.method))
    }
    const invoke = REMOTE_CONTROL_METHODS[payload.method]
    const api = ctx.get('apiProxy')
    if (api === undefined) return remoteControlError('Remote Control API is unavailable')
    const response = await invoke(api, { rpcId: randomUUID(), payload: payload.payload }, signal, aiProxy)
    return response.result
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'internal',
        message: error instanceof Error ? error.message : String(error),
        details: {},
      },
    }
  }
}

/**
 * Register the provider route, stable settings, the Host authentication and
 * gateway interface, and model discovery. OAuth actions and display state
 * never enter settings.
 */
export function apply(ctx, config) {
  let current = () => config ?? {}
  let lastRaw
  let lastGood
  const options = () => {
    const raw = current()
    if (raw === lastRaw && lastGood !== undefined) return lastGood
    try {
      const next = resolveOptions(raw)
      lastRaw = raw
      lastGood = next
      return next
    } catch (error) {
      if (lastGood === undefined) throw error
      lastRaw = raw
      ctx.logger.error(name + ': keeping the last good configuration after an invalid settings section')
      ctx.logger.error(error)
      return lastGood
    }
  }

  const api = new AiProxyApi(ctx, options)
  // The durable attachment service is optional (headless compositions may
  // lack it): image serialization resolves it lazily and fails with a clear
  // error only when a conversation actually carries an image.
  const adapter = new AiProxyAdapter(api, () => ctx.get('attachments'))

  // Keep the adapter out of the Models settings page until DSH exposes a
  // public third-party provider editor; its models still use the model picker.
  const registration = ctx.llm.registerAdapter([PROVIDER], adapter)
  let registeredPolicy = options().retryPolicy
  const ensureRegistrationFacts = () => {
    const policy = options().retryPolicy
    if (deepEqualJson(policy, registeredPolicy)) return
    registration.replace([PROVIDER])
    registeredPolicy = policy
  }

  const scope = ctx.settings.register(NS, Config, { base: config ?? {} })
  current = () => scope.get()
  ensureRegistrationFacts()

  scope.watch(() => {
    ensureRegistrationFacts()
  })

  // Connection is optional for headless compositions. When present, the
  // browser receives a dedicated loopback-only command channel instead of
  // writing transient actions into the settings document.
  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.connection.rpc.handle(
      AUTH_RPC_CHANNEL,
      (method, payload) => handleAuthRpc(api, method, payload, options),
      { authority: 'loopback' },
    )
    connectionCtx.connection.rpc.handle(
      REMOTE_CONTROL_RPC_CHANNEL,
      (method, payload, signal) => handleRemoteControlRpc(connectionCtx, options, method, payload, signal, api),
      { authority: 'trusted-host' },
    )
  })

  // Remove fields persisted by versions that used settings as an OAuth
  // command/status bus. Path mutation preserves every unrelated user field.
  const stored = ctx.settings.describe().find((entry) => entry.ns === NS)?.user
  const hasLegacyOAuthFields = stored !== null && typeof stored === 'object'
    && (Object.hasOwn(stored, 'oauth') || Object.hasOwn(stored, 'oauthStatus'))
  if (ctx.settings.writable && hasLegacyOAuthFields) {
    void ctx.settings.mutate(NS, [
      { op: 'unset', path: ['oauth'] },
      { op: 'unset', path: ['oauthStatus'] },
    ]).catch((error) => {
      ctx.logger.warn(name + ': failed to remove legacy OAuth settings fields:', error)
    })
  }

  ctx.llm.registerModelDiscovery(NS, (request) => api.discover(request))

  void api.bootstrap().catch((error) => {
    ctx.logger.error(name + ': bootstrap failed:', error)
  })
}

// Re-exported pure helpers for unit tests.
export const internals = { AiProxyApi, AiProxyAdapter, OAuthSession, serializeMessages, serializeUserContent, serializeRequest, imageDataUrl, inputModalitiesOf, translate, parseSse, pkcePair, base64url, effortName, mapUsage, mapFinishReason, httpErrorCode, discoverEndpoints, tokenRequest, startCallbackListener, handleAuthRpc, handleRemoteControlRpc, matchesRemoteControlSecret }
