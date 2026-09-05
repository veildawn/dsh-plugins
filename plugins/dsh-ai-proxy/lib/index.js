/**
 * dsh-ai-proxy: DeepSeek Harness provider for an AI Proxy Service gateway.
 *
 * The gateway is an OAuth 2.0 authorization server (RFC 8414 discovery,
 * authorization code + mandatory PKCE S256, public clients, loopback
 * redirects) and an OpenAI/Anthropic-compatible surface whose model list
 * carries per-plan models with context windows, modalities and per-model
 * reasoning effort ladders ("effort_levels"). This plugin:
 *
 *   - registers the "ai-proxy" provider route (LlmAdapter supporting
 *     chat/completions, Anthropic messages, and Responses API formats),
 *   - runs OAuth through a Host-only authentication interface, stores
 *     access/refresh tokens through the credentials seam, refreshes with
 *     rotation, and revokes on logout,
 *   - discovers models from GET /v1/models with the user's own credential,
 *     exposing each model's effort ladder as DSH reasoning efforts,
 *   - exposes stable provider settings while login/logout/status travel over
 *     a loopback-only Host RPC channel and never enter settings.yaml.
 *
 * @module dsh-ai-proxy
 */
import z from '@deepseek-ai/schemastery'
import * as DshLlm from '@deepseek-ai/dsh-llm'

const {
  LlmAdapter, LlmError, ProviderRequestId, ReasoningEffortId,
  RetryPolicySchema, assertUsableApiKey, attributionHeaders, contentHasImage,
  EMPTY_RESPONSE_CODE, QUOTA_EXCEEDED_CODE, CONTEXT_WINDOW_EXCEEDED_CODE,
  isQuotaExceededError, isContextWindowExceededError, resolveRetryPolicy,
} = DshLlm
const CallId = DshLlm.CallId ?? DshLlm.ToolCallId ?? ((id) => id)
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { MAX_TIMER_DELAY_MS, idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
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

export const API_FORMAT_CHAT_COMPLETIONS = 'chat/completions'
export const API_FORMAT_ANTHROPIC_MESSAGES = 'anthropic-messages'
export const API_FORMAT_RESPONSES = 'responses'

export const API_FORMATS = [
  API_FORMAT_CHAT_COMPLETIONS,
  API_FORMAT_ANTHROPIC_MESSAGES,
  API_FORMAT_RESPONSES,
]

export const DEFAULT_API_FORMAT = API_FORMAT_CHAT_COMPLETIONS

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
 * Normalize reasoning effort to standard Anthropic output_config.effort values.
 * Anthropic API strictly permits: 'low', 'medium', 'high', 'max', 'xhigh'.
 * Non-standard values like 'minimal' map to 'low', while 'none'/'off' disable thinking.
 */
export function normalizeAnthropicEffort(effort) {
  if (!effort || typeof effort !== 'string') return undefined
  const val = effort.trim().toLowerCase()
  if (val === 'none' || val === 'off' || val === '') return undefined
  if (val === 'minimal' || val === 'low') return 'low'
  if (val === 'medium') return 'medium'
  if (val === 'high') return 'high'
  if (val === 'max' || val === 'ultra' || val === 'turbo') return 'max'
  if (val === 'xhigh') return 'xhigh'
  return val
}

/** Normalize API format string to canonical identifier. */
export function normalizeApiFormat(raw) {
  if (!raw || typeof raw !== 'string') return DEFAULT_API_FORMAT
  const val = raw.trim().toLowerCase()
  if (val === 'anthropic-messages' || val === 'anthropic messages' || val === 'messages' || val === 'anthropic') {
    return API_FORMAT_ANTHROPIC_MESSAGES
  }
  if (val === 'responses' || val === 'openai-responses') {
    return API_FORMAT_RESPONSES
  }
  return API_FORMAT_CHAT_COMPLETIONS
}

/**
 * Intelligent endpoint resolution based on base URL and API format.
 * Strips any mismatched endpoints and returns the correct path.
 */
export function resolveInferenceEndpoint(baseURL, apiFormat = DEFAULT_API_FORMAT) {
  let base = (baseURL || '').trim().replace(/\/+$/, '')
  if (!base) base = DEFAULT_BASE_URL

  // Strip known trailing endpoint subpaths
  base = base.replace(/\/v1\/(chat\/completions|messages|responses)\/?$/i, '/v1')
  base = base.replace(/\/(chat\/completions|messages|responses)\/?$/i, '')

  const format = normalizeApiFormat(apiFormat)
  let suffix = '/chat/completions'
  if (format === API_FORMAT_ANTHROPIC_MESSAGES) suffix = '/messages'
  else if (format === API_FORMAT_RESPONSES) suffix = '/responses'

  if (base.endsWith('/v1')) {
    return base + suffix
  }
  return base + '/v1' + suffix
}

/** Resolve /v1/models endpoint from base URL. */
export function resolveModelsEndpoint(baseURL) {
  let base = (baseURL || '').trim().replace(/\/+$/, '')
  if (!base) base = DEFAULT_BASE_URL

  base = base.replace(/\/v1\/(chat\/completions|messages|responses)\/?$/i, '/v1')
  base = base.replace(/\/(chat\/completions|messages|responses)\/?$/i, '')

  if (base.endsWith('/v1')) {
    return base + '/models'
  }
  return base + '/v1/models'
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
 * become image_url data URLs read from the durable attachment service. Regular
 * image blocks are serialized here; images nested inside tool-result blocks in
 * the same message are handled separately by serializeMessages so they degrade
 * gracefully instead of crashing the session.
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
    const regular = message.content.filter((block) => block.type !== 'tool-result')
    const toolResults = message.content.filter((block) => block.type === 'tool-result')
    const text = flattenText(regular)
    if (contentHasImage(regular)) {
      wire.push({ role: 'user', content: await serializeUserContent(regular, attachments) })
    } else if (text.length > 0 || toolResults.length === 0) {
      wire.push({ role: 'user', content: text })
    }
    const pendingToolImages = []
    for (const result of toolResults) {
      const textParts = []
      for (const block of result.content) {
        if (block.type === 'text') {
          if (block.text.length > 0) textParts.push(block.text)
        } else if (block.type === 'image') {
          if (attachments) {
            try {
              const stored = await attachments.readImage(block.attachment)
              pendingToolImages.push({
                type: 'image_url',
                image_url: { url: imageDataUrl(stored) },
              })
            } catch {
              textParts.push(`[Image: ${block.attachment?.attachmentId || 'attached'}]`)
            }
          } else {
            textParts.push(`[Image: ${block.attachment?.attachmentId || 'attached'}]`)
          }
        }
      }
      wire.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        content: textParts.join('') || '(no output)',
      })
    }
    if (pendingToolImages.length > 0) {
      wire.push({
        role: 'user',
        content: [
          { type: 'text', text: 'Attached image(s) from tool result:' },
          ...pendingToolImages,
        ],
      })
    }
  }
  return wire
}

/** Build Chat Completions request body. */
export async function serializeChatCompletionsRequest(options, attachments) {
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

/** Build Anthropic Messages request body. */
export async function serializeAnthropicRequest(options, attachments) {
  let system = options.system
  const messages = []

  for (const message of options.messages) {
    if (message.role === 'system') {
      const text = flattenText(message.content)
      system = system ? system + '\n\n' + text : text
      continue
    }

    if (message.role === 'user') {
      const content = []
      const toolResults = message.content.filter((b) => b.type === 'tool-result')

      for (const block of message.content) {
        if (block.type === 'text') {
          if (block.text.length > 0) content.push({ type: 'text', text: block.text })
        } else if (block.type === 'image') {
          const stored = await attachments.readImage(block.attachment)
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: stored.ref.mediaType || 'image/png',
              data: Buffer.from(stored.data).toString('base64'),
            },
          })
        } else if (block.type === 'tool-result') {
          if (contentHasImage(block.content)) {
            const parts = []
            for (const sub of block.content) {
              if (sub.type === 'text') {
                if (sub.text.length > 0) parts.push({ type: 'text', text: sub.text })
              } else if (sub.type === 'image') {
                if (attachments) {
                  try {
                    const stored = await attachments.readImage(sub.attachment)
                    parts.push({
                      type: 'image',
                      source: {
                        type: 'base64',
                        media_type: stored.ref.mediaType || 'image/png',
                        data: Buffer.from(stored.data).toString('base64'),
                      },
                    })
                  } catch {
                    parts.push({ type: 'text', text: `[Image: ${sub.attachment?.attachmentId || 'attached'}]` })
                  }
                } else {
                  parts.push({ type: 'text', text: `[Image: ${sub.attachment?.attachmentId || 'attached'}]` })
                }
              }
            }
            content.push({
              type: 'tool_result',
              tool_use_id: block.toolCallId,
              content: parts.length > 0 ? parts : '(no output)',
            })
          } else {
            const text = flattenText(block.content)
            content.push({
              type: 'tool_result',
              tool_use_id: block.toolCallId,
              content: text || '(no output)',
            })
          }
        }
      }

      if (content.length === 1 && content[0].type === 'text' && toolResults.length === 0) {
        messages.push({ role: 'user', content: content[0].text })
      } else if (content.length > 0) {
        messages.push({ role: 'user', content })
      }
      continue
    }

    if (message.role === 'assistant') {
      const content = []
      for (const block of message.content) {
        if (block.type === 'text') {
          if (block.text.length > 0) content.push({ type: 'text', text: block.text })
        } else if (block.type === 'tool-call') {
          let input = {}
          try { input = JSON.parse(block.arguments || '{}') } catch {}
          content.push({
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input,
          })
        }
      }
      if (content.length === 1 && content[0].type === 'text') {
        messages.push({ role: 'assistant', content: content[0].text })
      } else if (content.length > 0) {
        messages.push({ role: 'assistant', content })
      }
      continue
    }
  }

  const tools = options.tools?.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters || { type: 'object', properties: {} },
  }))

  const body = {
    model: options.model,
    messages,
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    stream: true,
    ...(system !== undefined ? { system } : {}),
    ...(tools !== undefined && tools.length > 0 ? { tools } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.stop !== undefined ? { stop_sequences: options.stop } : {}),
  }

  if (options.purpose !== 'session-title' && options.reasoningEffort !== undefined) {
    const normalizedEffort = normalizeAnthropicEffort(options.reasoningEffort)
    if (normalizedEffort !== undefined) {
      body.thinking = { type: 'adaptive' }
      body.output_config = { effort: normalizedEffort }
    }
  }

  return body
}

/** Build OpenAI Responses request body. */
export async function serializeResponsesRequest(options, attachments) {
  const input = []
  if (options.system !== undefined) {
    input.push({ role: 'system', content: options.system })
  }

  for (const message of options.messages) {
    if (message.role === 'system') {
      const text = flattenText(message.content)
      input.push({ role: 'system', content: text })
      continue
    }

    if (message.role === 'user') {
      const content = []
      const toolResults = message.content.filter((b) => b.type === 'tool-result')

      for (const block of message.content) {
        if (block.type === 'text') {
          if (block.text.length > 0) content.push({ type: 'input_text', text: block.text })
        } else if (block.type === 'image') {
          const stored = await attachments.readImage(block.attachment)
          const dataUrl = imageDataUrl(stored)
          content.push({ type: 'input_image', image_url: dataUrl })
        }
      }

      if (content.length > 0) {
        input.push({ role: 'user', content })
      }

      for (const result of toolResults) {
        if (contentHasImage(result.content)) {
          const parts = []
          for (const b of result.content) {
            if (b.type === 'text') {
              if (b.text.length > 0) parts.push(b.text)
            } else if (b.type === 'image') {
              parts.push(`[Image: ${b.attachment?.attachmentId || 'attached'}]`)
            }
          }
          input.push({
            type: 'function_call_output',
            call_id: result.toolCallId,
            output: parts.join('') || '(no output)',
          })
        } else {
          const text = flattenText(result.content)
          input.push({
            type: 'function_call_output',
            call_id: result.toolCallId,
            output: text || '(no output)',
          })
        }
      }
      continue
    }

    if (message.role === 'assistant') {
      const text = flattenText(message.content)
      const toolCalls = message.content.filter((b) => b.type === 'tool-call')

      if (text.length > 0) {
        input.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text }],
          status: 'completed',
        })
      }

      for (const call of toolCalls) {
        input.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
        })
      }
      continue
    }
  }

  const tools = options.tools?.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))

  return {
    model: options.model,
    input,
    stream: true,
    ...(options.purpose !== 'session-title' && options.reasoningEffort !== undefined
      ? { reasoning: { effort: options.reasoningEffort } }
      : {}),
    ...(tools !== undefined && tools.length > 0 ? { tools } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxTokens !== undefined ? { max_output_tokens: options.maxTokens } : {}),
  }
}

/** Master serializeRequest dispatcher. */
export async function serializeRequest(options, attachments, apiFormat = DEFAULT_API_FORMAT) {
  const format = normalizeApiFormat(apiFormat)
  if (format === API_FORMAT_ANTHROPIC_MESSAGES) {
    return serializeAnthropicRequest(options, attachments)
  }
  if (format === API_FORMAT_RESPONSES) {
    return serializeResponsesRequest(options, attachments)
  }
  return serializeChatCompletionsRequest(options, attachments)
}

/** Map the wire finish_reason vocabulary to the harness FinishReason. */
export function mapFinishReason(reason) {
  switch (reason) {
    case 'stop':
    case 'end_turn':
    case 'stop_sequence':
    case 'completed':
      return { kind: 'stop' }
    case 'tool_calls':
    case 'tool_use':
      return { kind: 'tool-calls' }
    case 'length':
    case 'max_tokens':
    case 'incomplete':
      return { kind: 'max-tokens' }
    default:
      return { kind: 'error', failure: { message: 'model stopped: ' + reason, code: String(reason ?? 'unknown').toUpperCase() } }
  }
}

/**
 * Map wire usage to DISJOINT harness counts: cached prompt tokens are
 * subtracted out of inputTokens (billed input = input + cacheRead).
 */
export function mapUsage(usage) {
  const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0
  const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens
  const reasoning = usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.thinking_tokens
  const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? 0
  return {
    inputTokens: Math.max(0, promptTokens - (cacheRead ?? 0)),
    outputTokens: completionTokens,
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
 * Consume SSE data payloads for OpenAI Chat Completions and yield StreamChunks.
 */
export async function* translateChatCompletions(payloads) {
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
    const raw = typeof payload === 'string' ? payload : payload?.data
    if (raw === '[DONE]') {
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
      chunk = JSON.parse(raw)
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

/**
 * Consume SSE data events for Anthropic Messages and yield StreamChunks.
 */
export async function* translateAnthropic(events) {
  let nextIndex = 0
  const blockMap = new Map()
  const order = []
  let pendingUsage = null
  let pendingFinish = null

  for await (const event of events) {
    if (!event) continue
    const raw = typeof event === 'string' ? event : event.data
    if (raw === '[DONE]') {
      break
    }
    let data
    try {
      data = JSON.parse(raw)
    } catch {
      throw new LlmError('provider returned malformed SSE JSON', 'MALFORMED_RESPONSE')
    }

    const type = data.type || (typeof event === 'object' ? event.event : undefined)
    if (type === 'message_start') {
      if (data.message?.usage) {
        pendingUsage = mapUsage(data.message.usage)
      }
    } else if (type === 'content_block_start') {
      const idx = data.index ?? nextIndex++
      const cb = data.content_block || {}
      if (cb.type === 'text') {
        const block = { index: idx, kind: 'text', text: cb.text || '' }
        blockMap.set(idx, block)
        order.push(block)
        yield { type: 'block-start', index: idx, blockType: 'text' }
      } else if (cb.type === 'thinking' || cb.type === 'redacted_thinking') {
        const block = { index: idx, kind: 'reasoning', text: cb.thinking || '' }
        blockMap.set(idx, block)
        order.push(block)
        yield { type: 'block-start', index: idx, blockType: 'reasoning' }
      } else if (cb.type === 'tool_use') {
        const block = { index: idx, kind: 'tool-call', callId: cb.id, name: cb.name, text: '' }
        blockMap.set(idx, block)
        order.push(block)
        yield { type: 'block-start', index: idx, blockType: 'tool-call' }
      }
    } else if (type === 'content_block_delta') {
      const idx = data.index
      const block = blockMap.get(idx)
      const delta = data.delta || {}
      if (block) {
        if (delta.type === 'text_delta') {
          block.text += delta.text
          yield { type: 'text-delta', index: idx, text: delta.text }
        } else if (delta.type === 'thinking_delta') {
          block.text += delta.thinking
          yield { type: 'reasoning-delta', index: idx, text: delta.thinking }
        } else if (delta.type === 'input_json_delta') {
          block.text += delta.partial_json
          yield {
            type: 'tool-call-delta',
            index: idx,
            id: CallId(block.callId ?? ''),
            name: block.name ?? '',
            argumentsDelta: delta.partial_json,
          }
        }
      }
    } else if (type === 'content_block_stop') {
      const idx = data.index
      const block = blockMap.get(idx)
      if (block) {
        yield { type: 'block-end', index: idx, block: closeBlock(block) }
      }
    } else if (type === 'message_delta') {
      if (data.usage) {
        const u = data.usage
        const inputTokens = pendingUsage?.inputTokens ?? 0
        const cacheReadTokens = pendingUsage?.cacheReadTokens
        const reasoningTokens = u.output_tokens_details?.thinking_tokens
        pendingUsage = {
          inputTokens,
          outputTokens: u.output_tokens ?? pendingUsage?.outputTokens ?? 0,
          ...(cacheReadTokens ? { cacheReadTokens } : {}),
          ...(reasoningTokens ? { reasoningTokens } : {}),
        }
      }
      if (data.delta?.stop_reason) {
        pendingFinish = mapFinishReason(data.delta.stop_reason)
      }
    } else if (type === 'message_stop') {
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
  }

  for (const block of order) {
    // If not ended
  }
  if (pendingUsage) yield { type: 'usage', usage: pendingUsage }
  const reason = pendingFinish ?? { kind: 'stop' }
  yield {
    type: 'finish',
    reason: reason.kind === 'stop' && order.length === 0
      ? { kind: 'error', failure: { message: 'provider returned an empty response', code: EMPTY_RESPONSE_CODE } }
      : reason,
  }
}

/**
 * Consume SSE data events for OpenAI Responses and yield StreamChunks.
 */
export async function* translateResponses(events) {
  let nextIndex = 0
  const itemMap = new Map()
  const order = []
  let pendingUsage = null
  let pendingFinish = null

  for await (const event of events) {
    if (!event) continue
    const raw = typeof event === 'string' ? event : event.data
    if (raw === '[DONE]') {
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

    let data
    try {
      data = JSON.parse(raw)
    } catch {
      throw new LlmError('provider returned malformed SSE JSON', 'MALFORMED_RESPONSE')
    }

    const type = data.type || (typeof event === 'object' ? event.event : undefined)

    if (type === 'response.output_item.added') {
      const item = data.item || {}
      const idx = data.output_index ?? nextIndex++
      if (item.type === 'message') {
        const block = { index: idx, kind: 'text', text: '' }
        itemMap.set(idx, block)
        order.push(block)
        yield { type: 'block-start', index: idx, blockType: 'text' }
      } else if (item.type === 'reasoning' || item.type === 'thinking') {
        const block = { index: idx, kind: 'reasoning', text: '' }
        itemMap.set(idx, block)
        order.push(block)
        yield { type: 'block-start', index: idx, blockType: 'reasoning' }
      } else if (item.type === 'function_call') {
        const block = { index: idx, kind: 'tool-call', callId: item.call_id || item.id, name: item.name || '', text: item.arguments || '' }
        itemMap.set(idx, block)
        order.push(block)
        yield { type: 'block-start', index: idx, blockType: 'tool-call' }
      }
    } else if (type === 'response.text.delta' || type === 'response.output_text.delta') {
      const idx = data.output_index ?? 0
      let block = itemMap.get(idx)
      if (!block) {
        block = { index: idx, kind: 'text', text: '' }
        itemMap.set(idx, block)
        order.push(block)
        yield { type: 'block-start', index: idx, blockType: 'text' }
      }
      const delta = data.delta ?? ''
      block.text += delta
      yield { type: 'text-delta', index: idx, text: delta }
    } else if (type === 'response.reasoning.delta' || type === 'response.reasoning_text.delta' || type === 'response.thinking.delta') {
      const idx = data.output_index ?? 0
      let block = itemMap.get(idx)
      if (!block) {
        block = { index: idx, kind: 'reasoning', text: '' }
        itemMap.set(idx, block)
        order.push(block)
        yield { type: 'block-start', index: idx, blockType: 'reasoning' }
      }
      const delta = data.delta ?? ''
      block.text += delta
      yield { type: 'reasoning-delta', index: idx, text: delta }
    } else if (type === 'response.function_call_arguments.delta') {
      const idx = data.output_index ?? 0
      const block = itemMap.get(idx)
      if (block && block.kind === 'tool-call') {
        const delta = data.delta ?? ''
        block.text += delta
        yield {
          type: 'tool-call-delta',
          index: idx,
          id: CallId(block.callId ?? ''),
          name: block.name ?? '',
          argumentsDelta: delta,
        }
      }
    } else if (type === 'response.output_item.done') {
      const idx = data.output_index ?? 0
      const block = itemMap.get(idx)
      if (block) {
        yield { type: 'block-end', index: idx, block: closeBlock(block) }
      }
    } else if (type === 'response.completed' || type === 'response.done') {
      const resp = data.response || {}
      if (resp.usage) {
        pendingUsage = mapUsage(resp.usage)
      }
      const hasToolCalls = Array.from(itemMap.values()).some((b) => b.kind === 'tool-call')
      if (hasToolCalls) {
        pendingFinish = { kind: 'tool-calls' }
      } else if (resp.status) {
        pendingFinish = mapFinishReason(resp.status)
      }
    }
  }

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
}

/** Master translate dispatcher. */
export async function* translate(events, apiFormat = DEFAULT_API_FORMAT) {
  const format = normalizeApiFormat(apiFormat)
  if (format === API_FORMAT_ANTHROPIC_MESSAGES) {
    yield* translateAnthropic(events)
  } else if (format === API_FORMAT_RESPONSES) {
    yield* translateResponses(events)
  } else {
    yield* translateChatCompletions(events)
  }
}

/** Parse an SSE byte stream into event objects/data payloads. */
export async function* parseSse(stream, onComment) {
  const events = stream.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream({ onComment }))
  for await (const event of events) {
    yield event
    if (event.data === '[DONE]') return
  }
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

/** Map an HTTP status and error body to a stable LlmError code. */
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
   * when fresh, a rotated one after refresh, or the static API key.
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

  /** Current gateway facts for the settings page. */
  gateway() {
    const opts = this.options()
    return {
      baseURL: opts.baseURL,
      clientId: opts.clientId,
      apiFormat: opts.apiFormat,
      endpoint: resolveInferenceEndpoint(opts.baseURL, opts.apiFormat),
    }
  }

  /** Validate and persist gateway configuration through the Host settings seam. */
  async setGateway(params) {
    let baseURL = typeof params === 'string' ? params : params?.baseURL
    const apiFormat = typeof params === 'object' && params?.apiFormat ? normalizeApiFormat(params.apiFormat) : undefined

    const mutations = []
    if (baseURL !== undefined) {
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
      mutations.push({ op: 'set', path: ['baseURL'], value })
    }
    if (apiFormat !== undefined) {
      mutations.push({ op: 'set', path: ['apiFormat'], value: apiFormat })
    }

    if (mutations.length > 0) {
      await this.ctx.settings.mutate(NS, mutations)
      this.invalidateModels()
    }
    return this.gateway()
  }

  /** Start browser authorization without holding the RPC open for the callback. */
  login() {
    return this.oauth.login()
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
   * The per-plan model catalog, cached for modelCacheTtlMs.
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
      const modelsUrl = resolveModelsEndpoint(opts.baseURL)
      const res = await fetch(modelsUrl, {
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
    const modelsUrl = resolveModelsEndpoint(request.baseURL ?? opts.baseURL)
    let token = request.apiKey
    if (token === undefined) {
      try {
        token = (await this.resolveCredential()).token
      } catch {
        throw new LlmError('请先完成 OAuth 登录,或在此提供一次性 API key', 'MISSING_CREDENTIAL')
      }
    }
    const res = await fetch(modelsUrl, {
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
    const format = normalizeApiFormat(opts.apiFormat)
    const body = await serializeRequest(options, attachments, format)
    const payload = JSON.stringify(body)
    const endpointUrl = resolveInferenceEndpoint(opts.baseURL, format)
    const buildHeaders = (token) => ({
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...attributionHeaders(),
      'x-ai-proxy-client': 'dsh',
      ...(format === API_FORMAT_ANTHROPIC_MESSAGES ? { 'anthropic-version': '2023-06-01' } : {}),
      ...(options.sessionId !== undefined ? { 'x-ai-proxy-session-id': String(options.sessionId) } : {}),
    })
    const post = async (token) => {
      try {
        return await fetch(endpointUrl, {
          method: 'POST',
          headers: buildHeaders(token),
          body: payload,
          signal,
        })
      } catch (error) {
        if (signal.aborted) throw error
        throw new LlmError('AI Proxy API request to ' + endpointUrl + ' failed', 'TRANSPORT', { cause: error })
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
    yield* translate(parseSse(response.body, onComment), format)
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
  apiFormat: z.union(API_FORMATS).default(DEFAULT_API_FORMAT),
  clientId: z.string().default(DEFAULT_CLIENT_ID),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  defaultReasoningEffort: z.string().default(''),
  maxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  modelCacheTtlMs: z.number().step(1).min(10000).default(DEFAULT_MODEL_CACHE_TTL_MS),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  models: z.array(catalogModel).default([]),
  retryPolicy: RetryPolicySchema,
})

/**
 * One explicit resolve step from raw config to validated options.
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
  return {
    baseURL: (raw.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiFormat: normalizeApiFormat(raw.apiFormat),
    clientId,
    apiKeyEnv: raw.apiKeyEnv ?? DEFAULT_API_KEY_ENV,
    defaultReasoningEffort: raw.defaultReasoningEffort ?? '',
    maxTokens,
    defaultContextWindow,
    modelCacheTtlMs,
    streamIdleTimeoutMs,
    models: raw.models ?? [],
    retryPolicy: resolveRetryPolicy(raw.retryPolicy, name + ': retryPolicy'),
  }
}

/** Dedicated Host RPC channel for interactive provider authentication. */
export const AUTH_RPC_CHANNEL = '/ai-proxy-auth'

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

/** Dispatch the authentication-and-gateway interface over Connection RPC. */
export async function handleAuthRpc(api, method, payload) {
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
        if (method === 'login') return { ok: true, value: await api.login() }
        if (method === 'logout') return { ok: true, value: await api.logout() }
        return { ok: true, value: api.gateway() }
      }
      case 'callback': {
        if (!payload || typeof payload !== 'object' || !payload.code || !payload.state) {
          return badAuthRequest('AI Proxy callback requests must carry code and state')
        }
        return { ok: true, value: await api.oauth.handleCallback({
          code: payload.code,
          state: payload.state,
          error: payload.error,
          errorDescription: payload.errorDescription || payload.error_description,
        }) }
      }
      case 'setBaseURL': {
        if (keys.length !== 1 || !Object.hasOwn(payload, 'baseURL')) {
          return badAuthRequest('AI Proxy setBaseURL requests must carry exactly one baseURL field')
        }
        return { ok: true, value: await api.setGateway(payload.baseURL) }
      }
      case 'setGateway': {
        return { ok: true, value: await api.setGateway(payload) }
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
 * Register the provider route, stable settings, the Host authentication and
 * gateway interface, and model discovery.
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
  const adapter = new AiProxyAdapter(api, () => ctx.get('attachments'))

  const registration = ctx.llm.registerAdapter([PROVIDER], adapter)
  let registeredPolicy = options().retryPolicy
  const isPolicyEqual = (a, b) => {
    if (a === b) return true
    try {
      return JSON.stringify(a) === JSON.stringify(b)
    } catch {
      return false
    }
  }
  const ensureRegistrationFacts = () => {
    const policy = options().retryPolicy
    if (isPolicyEqual(policy, registeredPolicy)) return
    registration.replace([PROVIDER])
    registeredPolicy = policy
  }

  const scope = ctx.settings.register(NS, Config, { base: config ?? {} })
  current = () => scope.get()
  ensureRegistrationFacts()

  scope.watch(() => {
    ensureRegistrationFacts()
  })

  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.connection.rpc.handle(
      AUTH_RPC_CHANNEL,
      (method, payload) => handleAuthRpc(api, method, payload),
      { authority: 'trusted-host' },
    )
  })

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
export const internals = {
  AiProxyApi, AiProxyAdapter, OAuthSession,
  serializeMessages, serializeUserContent, serializeRequest,
  serializeChatCompletionsRequest, serializeAnthropicRequest, serializeResponsesRequest,
  imageDataUrl, inputModalitiesOf,
  translate, translateChatCompletions, translateAnthropic, translateResponses,
  parseSse, pkcePair, base64url, effortName, normalizeAnthropicEffort, mapUsage, mapFinishReason, httpErrorCode,
  discoverEndpoints, tokenRequest, startCallbackListener, handleAuthRpc,
  normalizeApiFormat, resolveInferenceEndpoint, resolveModelsEndpoint,
  API_FORMAT_CHAT_COMPLETIONS, API_FORMAT_ANTHROPIC_MESSAGES, API_FORMAT_RESPONSES, API_FORMATS, DEFAULT_API_FORMAT,
}
