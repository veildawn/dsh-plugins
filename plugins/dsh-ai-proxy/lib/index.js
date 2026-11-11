/**
 * dsh-ai-proxy: DeepSeek Harness provider for an AI Proxy Service gateway.
 *
 * The gateway is an OAuth 2.0 authorization server (RFC 8414 discovery,
 * authorization code + mandatory PKCE S256, public clients, loopback
 * redirects) and an OpenAI/Anthropic-compatible surface whose model list
 * carries per-plan models with context windows, modalities and per-model
 * reasoning effort ladders ("effort_levels").
 *
 * Wire protocols are owned by the host's official llm-pi-ai adapter. This
 * plugin materializes the gateway as one declarative route under the
 * `llm-pi-ai:` settings section (`providers.ai-proxy`) and keeps:
 *
 *   - the OAuth login/refresh/revoke lifecycle, storing the access token in
 *     the credentials seam under the ref the materialized route's apiKeyEnv
 *     names, so per-request resolution picks up rotated tokens by itself;
 *   - a proactive refresh timer that rotates the token before expiry, since
 *     the request path (and its 401s) now belongs to the official adapter;
 *   - model discovery from GET /v1/models with the user's own credential,
 *     mapping each model's effort ladder onto llm-pi-ai reasoning efforts;
 *   - the settings card and the loopback-only Host RPC channel for login,
 *     logout, status and model refresh.
 *
 * @module dsh-ai-proxy
 */
import z from '@deepseek-ai/schemastery'
import * as DshLlm from '@deepseek-ai/dsh-llm'

const {
  LlmError, ProviderRequestId, ReasoningEffortId, RetryPolicySchema, assertUsableApiKey,
  QUOTA_EXCEEDED_CODE, CONTEXT_WINDOW_EXCEEDED_CODE,
  isQuotaExceededError, isContextWindowExceededError,
} = DshLlm
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { randomBytes } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  ACCESS_REF, REFRESH_REF, EXPIRY_REF, CLIENT_ID_PATTERN, OAuthSession,
  LEGACY_REFS, clearCredentialSlot, tokenRefs,
  base64url, pkcePair, discoverEndpoints, tokenRequest, startCallbackListener,
} from './oauth.js'

export {
  ACCESS_REF, REFRESH_REF, EXPIRY_REF, CLIENT_ID_PATTERN,
  LEGACY_REFS, tokenRefs, clearCredentialSlot,
  base64url, pkcePair, discoverEndpoints, tokenRequest, startCallbackListener,
}

// ── constants ──────────────────────────────────────────────────────────────

export const name = 'llm-ai-proxy'
// webServer 必须一并注入：connection.rpc.handle 在调用方 ctx 上读 webServer 注册路由，
// 缺这一项会让插件在 webServer 就绪前就执行 apply 并以 "without inject" 激活失败。
export const inject = ['credentials', 'settings', 'llm', 'webServer']

/** The provider route name; also the llm-pi-ai providers-dict key we own. */
export const PROVIDER = 'ai-proxy'
/** Settings namespace owning this provider's profile. */
export const NS = 'ai-proxy'
/** Settings namespace of the host's official multi-protocol adapter. */
export const PI_AI_NS = 'llm-pi-ai'

export const DEFAULT_BASE_URL = 'http://localhost:18080'
export const DEFAULT_CLIENT_ID = 'dsh'

/**
 * Per-machine OAuth client id. The shared sentinel `dsh` is one grant for every
 * install; a stable 8-hex suffix keeps each machine on its own refresh chain.
 */
export function generateDefaultClientId() {
  return 'dsh-' + randomBytes(4).toString('hex')
}
export const DEFAULT_MAX_TOKENS = 65536
export const DEFAULT_CONTEXT_WINDOW = 200000
/**
 * Ceiling applied to every materialized model's context window: 1M tokens.
 * A model that advertises exactly 1M keeps its own window; only a larger one
 * is pulled down.
 */
export const DEFAULT_MAX_CONTEXT_WINDOW = 1000000
export const DEFAULT_MODEL_CACHE_TTL_MS = 300000
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000

export const DEFAULT_API_KEY_ENV = 'AIPROXY_ACCESS_TOKEN'
// Off by default. "Highest" is a depth the user opts into — a default that
// silently spends on the deepest rung of every model is a policy nobody chose,
// and the card's switch reflects this same default (see client.js).
export const DEFAULT_REASONING_EFFORT = 'lowest'

export const API_FORMAT_CHAT_COMPLETIONS = 'chat/completions'
export const API_FORMAT_ANTHROPIC_MESSAGES = 'anthropic-messages'
export const API_FORMAT_RESPONSES = 'responses'

export const API_FORMATS = [
  API_FORMAT_CHAT_COMPLETIONS,
  API_FORMAT_ANTHROPIC_MESSAGES,
  API_FORMAT_RESPONSES,
]

export const DEFAULT_API_FORMAT = API_FORMAT_CHAT_COMPLETIONS

/** Node's setTimeout deadline; longer refresh delays are clamped to it. */
const MAX_SET_TIMEOUT_MS = 2147483647

// ── pure helpers (exported for tests) ──────────────────────────────────────

/** Human-readable display name for a gateway effort rung. */
export function effortName(id) {
  const names = {
    none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium',
    high: 'High', xhigh: 'X-High', ultra: 'Ultra', max: 'Max', turbo: 'Turbo',
  }
  return names[id] ?? id
}

/** Known effort ladder rungs from highest to lowest. */
const EFFORT_ORDER = ['turbo', 'ultra', 'max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none']

/**
 * Resolve the default effort from a model's effort ladder and user preference.
 * - exact match: use the configured id when the ladder includes it
 * - 'highest': pick the highest known rung present on the ladder
 * - 'lowest' / empty / unknown: keep the previous behavior of ladder[0]
 * - known rung missing from the ladder: nearest available rung, preferring lower
 */
export function resolveDefaultEffort(ladder, configured) {
  if (!Array.isArray(ladder) || ladder.length === 0) return undefined
  const conf = typeof configured === 'string' ? configured.trim().toLowerCase() : ''
  // Unset means the switch is off, which is the floor — not the ceiling.
  if (conf === '' || conf === 'lowest') return ladder[0]
  if (ladder.includes(conf)) return conf
  if (conf === 'highest') {
    for (const effort of EFFORT_ORDER) {
      if (ladder.includes(effort)) return effort
    }
    return ladder[ladder.length - 1]
  }
  const confIndex = EFFORT_ORDER.indexOf(conf)
  if (confIndex !== -1) {
    for (let i = confIndex; i < EFFORT_ORDER.length; i++) {
      if (ladder.includes(EFFORT_ORDER[i])) return EFFORT_ORDER[i]
    }
    for (let i = confIndex - 1; i >= 0; i--) {
      if (ladder.includes(EFFORT_ORDER[i])) return EFFORT_ORDER[i]
    }
  }
  return ladder[0]
}

/** Extract non-empty, non-off reasoning rung identifiers from an array or dict. */
export function extractEffortRungs(ladder) {
  if (Array.isArray(ladder)) {
    return ladder
      .map((r) => typeof r === 'string' ? r : r?.id)
      .filter((r) => typeof r === 'string' && r.length > 0 && r !== 'off')
  }
  if (ladder && typeof ladder === 'object') {
    return Object.keys(ladder)
      .filter((k) => typeof k === 'string' && k.length > 0 && k !== 'off')
  }
  return []
}

/**
 * Clamp an effort onto a model's own ladder, nearest-down preferring lower rungs.
 * Returns the effort unchanged when the ladder already contains it (an explicit,
 * in-range choice is never rewritten). Returns undefined when the ladder has no
 * selectable rung, so the caller omits the field rather than sending one the
 * model cannot serve — an out-of-range effort is a hard 400 upstream.
 *
 * @param {string|undefined} effort  the effort carried over from the previous model
 * @param {string[]|object|undefined} ladder  the target model's rungs (its reasoningEfforts keys)
 */
export function clampEffortToLadder(effort, ladder) {
  const rungs = extractEffortRungs(ladder).filter((r) => r !== 'none')
  if (rungs.length === 0) return undefined
  if (typeof effort !== 'string' || effort === '' || effort === 'off' || effort === 'none') return undefined
  if (rungs.includes(effort)) return effort
  // nearest rung, preferring lower (do not silently upgrade the user's choice)
  const idx = EFFORT_ORDER.indexOf(effort)
  if (idx !== -1) {
    for (let i = idx; i < EFFORT_ORDER.length; i++) {
      if (rungs.includes(EFFORT_ORDER[i])) return EFFORT_ORDER[i]
    }
    for (let i = idx - 1; i >= 0; i--) {
      if (rungs.includes(EFFORT_ORDER[i])) return EFFORT_ORDER[i]
    }
  }
  return rungs[0]
}

// ── context-window ceiling ─────────────────────────────────────────────────

/**
 * Unit suffixes a context-window value may carry, keyed lower-case. The scales
 * are decimal — `1M` is 1000K — matching how model capacities are quoted in the
 * host's own model editor (`CAPACITY_SCALE` in dsh-client-ui-settings-models),
 * so a value typed here reads the same as one typed there.
 */
const CONTEXT_WINDOW_SCALES = { '': 1, k: 1e3, m: 1e6 }

/** A decimal count with an optional K/M suffix; surrounding space is tolerated. */
const CONTEXT_WINDOW_PATTERN = /^(\d+(?:\.\d+)?)\s*([km])?$/i

/**
 * Read a configured context-window ceiling.
 *
 * Accepts a plain token count (`500000`) or one carrying a K/M suffix in either
 * case (`500K`, `500k`, `1M`, `1m`, `1.5M`). Returns a positive integer, or
 * `undefined` when the value is not a readable capacity — callers turn that into
 * a validation error rather than silently falling back to a default, so a typo
 * in the profile patch is visible instead of quietly ignored.
 */
export function parseContextWindow(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined
  }
  if (typeof value !== 'string') return undefined
  const match = CONTEXT_WINDOW_PATTERN.exec(value.trim())
  if (match === null) return undefined
  const scale = CONTEXT_WINDOW_SCALES[(match[2] ?? '').toLowerCase()]
  const rounded = Math.round(Number(match[1]) * scale)
  return Number.isSafeInteger(rounded) && rounded > 0 ? rounded : undefined
}

/**
 * Lowest ceiling a user may configure: 128K tokens.
 *
 * Host-side pressure compaction cannot run under a narrow window. It charges one
 * request's output reservation to the same window as the prompt, then subtracts
 * its own headroom. With the entry limit this plugin materializes (a quarter of
 * the window) and the host's default 64K headroom, the smallest window whose
 * budget stays positive is 104026; 128K (decimal, matching this plugin's own
 * capacity units: 1K = 1000) sits above that with room to spare and is a number
 * users recognize from model tiers.
 *
 * Below this floor compaction rejects every pass with `TargetPressureConfigError`.
 * That failure surfaces later, mid-conversation, so the value is refused at
 * configuration time instead.
 */
export const MIN_MAX_CONTEXT_WINDOW = 128000

/** Human spelling of {@link MIN_MAX_CONTEXT_WINDOW} for messages and the card. */
export const MIN_MAX_CONTEXT_WINDOW_LABEL = '128K'

/**
 * Apply the ceiling to one capacity (a context window or an output limit).
 *
 * The configured value is a maximum, never a floor: a capacity that already fits
 * below it is kept exactly as it is, and only a larger one is pulled down to the
 * cap. Anything that is not a positive integer (an undeclared model capacity, a
 * malformed catalog entry) has nothing to clamp and passes through untouched, so
 * the caller's own validation still reports it.
 */
export function clampToCap(capacity, cap) {
  if (!Number.isSafeInteger(capacity) || capacity <= 0) return capacity
  if (!Number.isSafeInteger(cap) || cap <= 0) return capacity
  return capacity > cap ? cap : capacity
}

/**
 * Fraction of a context window an output limit may take.
 *
 * Host-side pressure compaction (`dsh-compaction-basic`) charges one request's
 * output reservation to the same window as the prompt, then subtracts its own
 * headroom:
 *
 *   messageBudget  = contextWindow - reserved   (reserved = the entry maxTokens)
 *   pressureBudget = messageBudget  - headroomTokens
 *
 * and throws `TargetPressureConfigError` unless both stay positive. An output
 * limit that merely equals the window leaves zero message budget and disables
 * compaction outright, so a clamped window must keep the limit well inside it.
 * A quarter leaves the entry limit below the window even after the host's
 * default 64K headroom, and matches the order of magnitude of real model output
 * limits (a 200K model typically allows 8K–64K out).
 */
const OUTPUT_LIMIT_WINDOW_FRACTION = 0.25

/**
 * The output limit one materialized model entry may declare.
 *
 * Two bounds apply. The configured limit is never raised, and it is pulled
 * first under the route ceiling and then under a fraction of the model's own
 * window, so the host's compaction budget keeps room on both sides. Without the
 * fraction, lowering `maxContextWindow` to (say) 128K would make every entry
 * declare a 64K output limit inside a 128K window and compaction would throw
 * before its first pass.
 */
export function outputLimitFor(maxTokens, window, cap) {
  const bounded = clampToCap(maxTokens, cap)
  if (!Number.isSafeInteger(window) || window <= 0) return bounded
  return clampToCap(bounded, Math.floor(window * OUTPUT_LIMIT_WINDOW_FRACTION))
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

// ── llm-pi-ai materialization helpers ──────────────────────────────────────

export const PI_AI_PROTOCOL_CHAT_COMPLETIONS = 'openai-completions'
export const PI_AI_PROTOCOL_RESPONSES = 'openai-responses'
export const PI_AI_PROTOCOL_ANTHROPIC = 'anthropic-messages'

/** Map our API-format vocabulary onto the official adapter's protocol ids. */
export function piAiProtocolFor(apiFormat) {
  const format = normalizeApiFormat(apiFormat)
  if (format === API_FORMAT_ANTHROPIC_MESSAGES) return PI_AI_PROTOCOL_ANTHROPIC
  if (format === API_FORMAT_RESPONSES) return PI_AI_PROTOCOL_RESPONSES
  return PI_AI_PROTOCOL_CHAT_COMPLETIONS
}

/**
 * Route-level compat for the official adapter.
 *
 * Custom OpenAI-compatible gateways are not the official OpenAI API. pi-ai
 * rewrites a reasoning model's system prompt to `role: "developer"` unless
 * `compat.supportsDeveloperRole` is false; DeepSeek / GLM / similar endpoints
 * reject that variant (`unknown variant \`developer\``). Anthropic Messages
 * does not take the switch, so that protocol omits the block.
 *
 * `supportsReasoningEffort` is declared rather than left to pi-ai's detection:
 * today every custom baseURL defaults to true, which is why the ladder reaches
 * the wire at all, but that is an inference about somebody else's endpoint and
 * one upstream release away from silently dropping `reasoning_effort` — and
 * with it the level the gateway logs. The gateway takes the parameter on every
 * OpenAI-shaped surface this route can be given, so it is stated here.
 */
export function routeCompatFor(api) {
  if (api === PI_AI_PROTOCOL_ANTHROPIC) return undefined
  return { supportsDeveloperRole: false, supportsReasoningEffort: true }
}

/**
 * Spell the route baseURL for the official adapter. The OpenAI SDK appends
 * `/chat/completions` (or `/responses`) to the configured base itself, so
 * OpenAI-style routes carry the `/v1` suffix; the Anthropic SDK appends
 * `/v1/messages`, so that route keeps the bare gateway root.
 */
export function piAiBaseURL(baseURL, apiFormat) {
  let base = (baseURL || '').trim().replace(/\/+$/, '')
  base = base.replace(/\/v1\/(chat\/completions|messages|responses)\/?$/i, '/v1')
  base = base.replace(/\/(chat\/completions|messages|responses)\/?$/i, '')
  if (piAiProtocolFor(apiFormat) === PI_AI_PROTOCOL_ANTHROPIC) {
    return base.replace(/\/v1$/i, '') || base
  }
  return base.endsWith('/v1') ? base : base + '/v1'
}

/** Resolve /v1/models endpoint from base URL (our own discovery path). */
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

/** The reasoning-effort selector keys the official adapter's ladder accepts. */
const PI_AI_EFFORT_KEYS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * Translate one gateway effort ladder into the official adapter's
 * `reasoningEfforts` dict: keys are selector levels, values are the wire
 * spellings the gateway expects. Standard rungs keep their identity spelling;
 * non-standard rungs (ultra/turbo/…) borrow free selector keys from the top
 * down so the gateway's strongest spelling stays selectable as its strongest
 * level. `false` marks a model with no selectable reasoning.
 *
 * `off` is a USER choice and nothing else. A ladder that declares `off`/`none`
 * maps it to `null` ("supported, send no parameter"); a ladder that does not is
 * left without the key, so the picker never offers a level the gateway did not
 * publish and `highest` never quietly turns "don't think" on. What a request
 * with no level sends is the route preference's business, resolved per model by
 * {@link preferredEffort} on the request path — not something this table bakes
 * in, because the same table is what the picker renders.
 */
export function ladderToReasoningEfforts(effortLevels) {
  const rungs = Array.isArray(effortLevels)
    ? effortLevels.map(String).filter((rung) => rung.length > 0)
    : []
  const entries = new Map()
  const declaresOff = rungs.includes('off') || rungs.includes('none')
  if (declaresOff) entries.set('off', null)
  for (const key of PI_AI_EFFORT_KEYS) {
    if (rungs.includes(key)) entries.set(key, key)
  }
  const rank = (rung) => {
    const index = EFFORT_ORDER.indexOf(rung)
    return index === -1 ? EFFORT_ORDER.length : index
  }
  const extras = rungs
    .filter((rung) => !PI_AI_EFFORT_KEYS.includes(rung) && rung !== 'off' && rung !== 'none')
    .sort((a, b) => rank(a) - rank(b))
  for (const rung of extras) {
    for (let i = PI_AI_EFFORT_KEYS.length - 1; i >= 0; i--) {
      const key = PI_AI_EFFORT_KEYS[i]
      if (!entries.has(key)) {
        entries.set(key, rung)
        break
      }
    }
  }
  if ([...entries.keys()].every((key) => key === 'off')) return false
  return Object.fromEntries(entries)
}

/**
 * Attach the route preference to a direct stream that named no effort, or
 * clamp a stale carried-over effort onto this model's own ladder when out of range.
 * Returns the original options when the provider is not ours, an in-range effort
 * is already selected, or this model has no selectable rung for the preference.
 */
export function streamOptionsWithPreferredEffort(streamOptions, efforts, configured) {
  if (streamOptions?.provider !== PROVIDER) return streamOptions
  if (streamOptions.reasoningEffort !== undefined) {
    // An explicit level is the user's own decision — including "off", which is
    // a real rung for the models that publish it and must survive untouched.
    const clamped = clampEffortToLadder(streamOptions.reasoningEffort, efforts)
    if (clamped === streamOptions.reasoningEffort) return streamOptions
    if (clamped !== undefined) {
      return { ...streamOptions, reasoningEffort: ReasoningEffortId(clamped) }
    }
    const rest = { ...streamOptions }
    delete rest.reasoningEffort
    return rest
  }
  const target = preferredEffort(efforts, configured)
  if (target === undefined) return streamOptions
  return { ...streamOptions, reasoningEffort: ReasoningEffortId(target) }
}

/**
 * The level a request that names none should end up at, for THIS model.
 *
 * `defaultReasoningEffort` is the route preference, but the route itself only
 * publishes one static level (`reasoning`), and a static field cannot say
 * "highest" for a catalog whose model tops differ. So the preference is
 * resolved here, per model, and widened to that model's own top for
 * "highest" — `max` for a model that offers it, `xhigh` or `high` for one that
 * does not.
 *
 * `off` is not a destination: it is a rung the user picks, and a preference of
 * "highest" must never turn a model's thinking off, nor may it be used to
 * smuggle a level into a model that never published one. A ladder with no
 * selectable rung answers undefined, which the caller turns into "send no
 * parameter" — exactly what such a model's only setting means.
 */
export function defaultEffortForModel(efforts, configured) {
  const rungs = (Array.isArray(efforts) ? efforts : [])
    .map((effort) => typeof effort === 'string' ? effort : effort?.id)
    .filter((id) => typeof id === 'string' && id.length > 0 && id !== 'off')
  if (rungs.length === 0) return undefined
  const pref = effectiveDefaultEffort(configured)
  if (pref === 'off' || pref === 'none') return undefined
  return resolveDefaultEffort(rungs, pref)
}

/** Check whether a model identifier represents any Google Gemini model. */
export function isGeminiModel(modelId) {
  if (typeof modelId !== 'string') return false
  return modelId.toLowerCase().includes('gemini')
}

/** Check whether a model identifier represents a Gemini 3+ model. */
export function isGemini3Model(modelId) {
  if (typeof modelId !== 'string') return false
  const lower = modelId.toLowerCase()
  return /gemini-?3(?:\.\d+)?-(?:pro|flash)/.test(lower) ||
    lower.includes('gemini-3') ||
    lower.startsWith('gemini-3')
}

/**
 * Recursively cleans JSON Schema parameters for Gemini API compatibility:
 * 1. Strips meta-keywords ($schema, $id, definitions, etc.)
 * 2. Purges `type: "null"` from `anyOf` / `oneOf` unions to prevent 400 Bad Request
 * 3. Normalizes `type: ["string", "null"]` into `type: "string", nullable: true`
 */
export function sanitizeGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema
  if (Array.isArray(schema)) {
    return schema.map(sanitizeGeminiSchema)
  }

  const out = {}
  for (const [k, v] of Object.entries(schema)) {
    if (k === '$schema' || k === '$id' || k === '$defs' || k === 'definitions') {
      continue
    }
    out[k] = sanitizeGeminiSchema(v)
  }

  // Handle type arrays like ["string", "null"] -> "string" + nullable: true
  if (Array.isArray(out.type)) {
    const nonNull = out.type.filter((t) => t !== 'null')
    out.type = nonNull.length === 1 ? nonNull[0] : (nonNull.length > 0 ? nonNull[0] : 'string')
    out.nullable = true
  }

  // Handle anyOf / oneOf containing null branches
  for (const unionKey of ['anyOf', 'oneOf']) {
    if (Array.isArray(out[unionKey])) {
      const branches = out[unionKey]
      const nonNull = branches.filter((branch) => !(branch && typeof branch === 'object' && branch.type === 'null'))
      if (nonNull.length !== branches.length) {
        if (nonNull.length === 1) {
          const single = sanitizeGeminiSchema(nonNull[0])
          delete out[unionKey]
          Object.assign(out, single)
          out.nullable = true
        } else if (nonNull.length > 1) {
          out[unionKey] = nonNull.map(sanitizeGeminiSchema)
          out.nullable = true
        } else {
          delete out[unionKey]
          out.type = 'string'
          out.nullable = true
        }
      }
    }
  }

  return out
}

/** Clean all tool definitions in a stream request for Gemini compatibility. */
export function sanitizeGeminiTools(tools) {
  if (!Array.isArray(tools)) return tools
  return tools.map((tool) => {
    if (!tool || typeof tool !== 'object') return tool
    if (!tool.parameters || typeof tool.parameters !== 'object') return tool
    return {
      ...tool,
      parameters: sanitizeGeminiSchema(tool.parameters),
    }
  })
}

/**
 * Normalizes Windows file paths and clears noisy local attachment copy paths.
 */
export function sanitizeWindowsPathText(text) {
  if (typeof text !== 'string' || text.length === 0) return text
  // Remove verbose host-local Normalized copy attachment hints that contain Windows paths
  let cleaned = text.replace(
    /\s*Normalized copy \(read-only; may be resized or re-encoded\):[\s\S]*?before editing\./g,
    ''
  )
  // Normalize remaining Windows drive backslash paths like C:\Users\... to C:/Users/...
  cleaned = cleaned.replace(/([A-Za-z]:)\\[^\s"'\n\r]*/g, (m) => m.replace(/\\/g, '/'))
  return cleaned
}

/**
 * Sanitize conversation messages for Gemini 3 models to prevent 400 Bad Request:
 * 1. Gemini 3 strictly validates `thought_signature` on historical functionCall parts.
 *    Since DSH session storage does not preserve Google's ephemeral encrypted thought signatures,
 *    historical tool calls and their results are gracefully converted into dialogue text blocks.
 * 2. Sanitize Windows local file paths in normalized image placeholder descriptions.
 */
export function sanitizeGeminiMessages(messages) {
  if (!Array.isArray(messages)) return messages

  const out = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (!msg || typeof msg !== 'object') {
      out.push(msg)
      continue
    }

    if (msg.role === 'assistant') {
      const content = Array.isArray(msg.content) ? msg.content : []
      const hasToolCall = content.some((b) => b && b.type === 'tool-call')
      if (hasToolCall) {
        const newBlocks = []
        for (const block of content) {
          if (!block || typeof block !== 'object') continue
          if (block.type === 'tool-call') {
            const toolCallText = `[Called tool: ${block.name || 'unknown'}(${block.arguments || ''})]`
            newBlocks.push({
              type: 'text',
              text: toolCallText,
            })
          } else if (block.type === 'text') {
            newBlocks.push({
              ...block,
              text: sanitizeWindowsPathText(block.text),
            })
          } else {
            newBlocks.push(block)
          }
        }
        out.push({
          ...msg,
          content: newBlocks,
        })
      } else {
        out.push({
          ...msg,
          content: content.map((b) => (b && b.type === 'text' ? { ...b, text: sanitizeWindowsPathText(b.text) } : b)),
        })
      }
    } else if (msg.role === 'tool') {
      const rawText = Array.isArray(msg.content)
        ? msg.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n')
        : (typeof msg.content === 'string' ? msg.content : '')
      const safeText = sanitizeWindowsPathText(rawText)
      const label = msg.toolCallId ? `[Tool result for ${msg.toolCallId}]` : '[Tool result]'
      out.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `${label}:\n${safeText || '(no output)'}`,
          },
        ],
      })
    } else if (msg.role === 'user') {
      const content = Array.isArray(msg.content) ? msg.content : []
      out.push({
        ...msg,
        content: content.map((b) => (b && b.type === 'text' ? { ...b, text: sanitizeWindowsPathText(b.text) } : b)),
      })
    } else {
      out.push(msg)
    }
  }

  return out
}

/**
 * Pick one model's own default effort from its selector rungs.
 *
 * `highest` / `lowest` / an exact rung are resolved against THIS model's
 * ladder only. A preference of `off` / `none`, or a model with no selectable
 * effort, yields nothing so the caller omits the field instead of inventing
 * a route-wide level another model cannot serve.
 */
export function preferredEffort(efforts, configured) {
  const rungs = (Array.isArray(efforts) ? efforts : [])
    .map((effort) => typeof effort === 'string' ? effort : effort?.id)
    .filter((id) => typeof id === 'string' && id.length > 0 && id !== 'off')
  if (rungs.length === 0) return undefined
  const pref = typeof configured === 'string' ? configured.trim().toLowerCase() : ''
  if (pref === 'off' || pref === 'none') return undefined
  return resolveDefaultEffort(rungs, pref === '' ? DEFAULT_REASONING_EFFORT : pref)
}

/**
 * The setting is a genuine two-state switch, and that is all it is.
 *
 * `highest` means "the deepest rung THIS model publishes" and `lowest` means
 * "its shallowest". There is no third state: an exact rung name is not a
 * policy the switch can express (the card only ever writes the two words), and
 * "off" is not one either — turning a model's thinking off is a per-model,
 * user-made pick in the effort list, not a route-wide default. Broadening this
 * into "any level the adapter knows" is how a stale or hand-edited config ends
 * up forcing every request onto a depth nobody chose.
 *
 * The switch is OFF unless the value literally says `highest`: unset, blank,
 * unknown or a typo all mean "the floor", because the costlier side must be
 * something the user turned on rather than something a bad value defaulted to.
 */
export function effectiveDefaultEffort(configured) {
  const pref = typeof configured === 'string' ? configured.trim().toLowerCase() : ''
  return pref === 'highest' ? 'highest' : 'lowest'
}

/**
 * Resolve the route-level default reasoning level from every model's ladder
 * at once: 'highest' picks the strongest selector key any model offers and
 * 'lowest' the weakest non-off key, so models that cannot serve the key keep
 * their own ladder in the picker while capable ones aim high. An exact
 * configured key wins when offered; otherwise the nearest lower offered key
 * applies, falling up when nothing lower exists.
 *
 * Kept for callers that still want a catalog-wide key. The materialized
 * route must NOT persist that key as `profile.reasoning`: llm-pi-ai treats
 * it as one static level for every model, and a level the strongest model
 * offers (`max`) is refused by a model whose own ladder stops at `high`.
 */
export function routeDefaultEffortKey(models, configured) {
  const offered = new Set()
  for (const entry of Array.isArray(models) ? models : []) {
    const ladder = ladderToReasoningEfforts(entry?.effortLevels)
    if (ladder === false) continue
    for (const key of Object.keys(ladder)) {
      if (key !== 'off') offered.add(key)
    }
  }
  if (offered.size === 0) return undefined
  const conf = typeof configured === 'string' ? configured.trim().toLowerCase() : ''
  if (conf === 'off' || conf === 'none') return 'off'
  if (offered.has(conf)) return conf
  const ranked = PI_AI_EFFORT_KEYS.filter((key) => offered.has(key))
  if (conf === 'highest') return ranked[ranked.length - 1]
  if (conf === '' || conf === 'lowest') return ranked[0]
  const index = PI_AI_EFFORT_KEYS.indexOf(conf)
  if (index !== -1) {
    for (let i = index; i >= 0; i--) {
      if (offered.has(PI_AI_EFFORT_KEYS[i])) return PI_AI_EFFORT_KEYS[i]
    }
    for (let i = index + 1; i < PI_AI_EFFORT_KEYS.length; i++) {
      if (offered.has(PI_AI_EFFORT_KEYS[i])) return PI_AI_EFFORT_KEYS[i]
    }
  }
  return ranked[ranked.length - 1]
}

/** Static request headers every materialized route carries. */
export const ROUTE_HEADERS = { 'x-ai-proxy-client': 'dsh' }

const MATERIALIZED_MODEL_KEYS = new Set([
  'id',
  'name',
  'contextWindow',
  'maxTokens',
  'modality',
  'input',
  'reasoningEfforts',
])

/**
 * Determine whether a model field on the existing materialized route was
 * manually modified by the user compared against the auto-generated reference.
 *
 * - When `baselineModel` is known (from a previous sync in this session), any
 *   divergence between `existingModel[key]` and `baselineModel[key]` means the
 *   user edited that field after it was materialized.
 * - On initial startup (`baselineModel === undefined`), an existing defined
 *   field that differs from `freshModel[key]` (excluding a default `name === id`)
 *   is treated as a pre-existing user customization.
 */
function isModelFieldUserModified(key, existingModel, freshModel, baselineModel) {
  if (!existingModel || typeof existingModel !== 'object') return false
  const hasExisting = Object.hasOwn(existingModel, key) && existingModel[key] !== undefined
  if (baselineModel && typeof baselineModel === 'object') {
    const hasBaseline = Object.hasOwn(baselineModel, key) && baselineModel[key] !== undefined
    if (key === 'name' && hasExisting && existingModel.name === existingModel.id && !hasBaseline) {
      return false
    }
    if (!hasExisting && !hasBaseline) return false
    if (hasExisting !== hasBaseline) return true
    return !isDeepStrictEqual(existingModel[key], baselineModel[key])
  }
  if (!hasExisting) return false
  if (key === 'name' && existingModel.name === existingModel.id && freshModel.name === undefined) {
    return false
  }
  const hasFresh = Object.hasOwn(freshModel, key) && freshModel[key] !== undefined
  if (!hasFresh) return true
  return !isDeepStrictEqual(existingModel[key], freshModel[key])
}

/**
 * Merge a freshly computed model entry with an existing model entry from the
 * materialized route, preserving fields manually modified by the user while
 * updating untouched fields from `freshModel`.
 *
 * Returns `{ model, baseline }` where `baseline` records the auto-generated
 * reference values to compare against on the next sync.
 */
export function mergeModelEntry(freshModel, existingModel, baselineModel) {
  if (!existingModel || typeof existingModel !== 'object' || Array.isArray(existingModel)) {
    return {
      model: structuredClone(freshModel),
      baseline: structuredClone(freshModel),
    }
  }
  const refModel = baselineModel && typeof baselineModel === 'object' ? baselineModel : freshModel
  const model = { id: freshModel.id }
  const baseline = { id: freshModel.id }

  const nameModified = isModelFieldUserModified('name', existingModel, freshModel, baselineModel)
  const resolvedName = nameModified ? existingModel.name : freshModel.name
  if (resolvedName !== undefined && resolvedName !== freshModel.id) {
    model.name = resolvedName
  }
  const baselineName = nameModified ? refModel.name : freshModel.name
  if (baselineName !== undefined && baselineName !== freshModel.id) {
    baseline.name = baselineName
  }

  const windowModified = isModelFieldUserModified('contextWindow', existingModel, freshModel, baselineModel)
  const resolvedWindow = windowModified ? existingModel.contextWindow : freshModel.contextWindow
  if (resolvedWindow !== undefined) {
    model.contextWindow = resolvedWindow
  }
  const baselineWindow = windowModified ? refModel.contextWindow : freshModel.contextWindow
  if (baselineWindow !== undefined) {
    baseline.contextWindow = baselineWindow
  }

  const maxTokensModified = isModelFieldUserModified('maxTokens', existingModel, freshModel, baselineModel)
  let resolvedMaxTokens
  let baselineMaxTokens
  if (maxTokensModified) {
    resolvedMaxTokens = existingModel.maxTokens
    baselineMaxTokens = refModel.maxTokens
  } else if (windowModified && existingModel.maxTokens !== undefined) {
    // The user customized contextWindow without touching maxTokens: keep their
    // existing maxTokens (clamped only if it would exceed a quarter of their
    // custom contextWindow and break host pressure compaction) rather than
    // overwriting it with a limit derived from the gateway's window or route cap.
    resolvedMaxTokens = outputLimitFor(existingModel.maxTokens, resolvedWindow, undefined)
    baselineMaxTokens = resolvedMaxTokens
  } else {
    resolvedMaxTokens = freshModel.maxTokens
    baselineMaxTokens = freshModel.maxTokens
  }
  if (resolvedMaxTokens !== undefined) {
    model.maxTokens = resolvedMaxTokens
  }
  if (baselineMaxTokens !== undefined) {
    baseline.maxTokens = baselineMaxTokens
  }

  for (const key of ['modality', 'input', 'reasoningEfforts']) {
    const modified = isModelFieldUserModified(key, existingModel, freshModel, baselineModel)
    const resolvedVal = modified ? existingModel[key] : freshModel[key]
    if (resolvedVal !== undefined) {
      model[key] = structuredClone(resolvedVal)
    }
    const baselineVal = modified ? refModel[key] : freshModel[key]
    if (baselineVal !== undefined) {
      baseline[key] = structuredClone(baselineVal)
    }
  }

  for (const [key, val] of Object.entries(existingModel)) {
    if (MATERIALIZED_MODEL_KEYS.has(key) || val === undefined) continue
    model[key] = structuredClone(val)
  }

  return { model, baseline }
}

/**
 * Merge a newly built provider profile with the existing materialized route in
 * `llm-pi-ai`. Models that the user has not manually modified are updated to
 * the latest gateway / plugin values; any model configurations (`contextWindow`,
 * `maxTokens`, `name`, `input`, `reasoningEfforts`, `modality`, or extra custom
 * fields) manually modified by the user are preserved.
 */
export function mergeProviderProfile(freshProfile, existingRoute, baselineRoute) {
  if (!existingRoute || typeof existingRoute !== 'object' || Array.isArray(existingRoute)) {
    return {
      profile: structuredClone(freshProfile),
      baseline: structuredClone(freshProfile),
    }
  }
  const existingModelsById = new Map()
  for (const entry of Array.isArray(existingRoute.models) ? existingRoute.models : []) {
    if (entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id.length > 0) {
      existingModelsById.set(entry.id, entry)
    }
  }
  const baselineModelsById = new Map()
  for (const entry of Array.isArray(baselineRoute?.models) ? baselineRoute.models : []) {
    if (entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id.length > 0) {
      baselineModelsById.set(entry.id, entry)
    }
  }

  const mergedModels = []
  const baselineModels = []
  for (const freshModel of Array.isArray(freshProfile.models) ? freshProfile.models : []) {
    const existingModel = existingModelsById.get(freshModel.id)
    const baselineModel = baselineModelsById.get(freshModel.id)
    const { model, baseline } = mergeModelEntry(freshModel, existingModel, baselineModel)
    mergedModels.push(model)
    baselineModels.push(baseline)
  }

  const profile = {
    ...structuredClone(freshProfile),
    models: mergedModels,
  }
  const baseline = {
    ...structuredClone(freshProfile),
    models: baselineModels,
  }
  return { profile, baseline }
}

/**
 * Apply any static per-model overrides configured in `options.models` onto the
 * catalog entries discovered from `GET /v1/models`, so user-configured static
 * overrides (`contextWindow`, `maxTokens`, `name`, `modality`, etc.) are not
 * overwritten by raw gateway defaults.
 */
export function applyStaticModelOverrides(discoveredModels, staticModels) {
  if (!Array.isArray(staticModels) || staticModels.length === 0) return discoveredModels
  const overrides = new Map()
  for (const item of staticModels) {
    if (item && typeof item === 'object' && typeof item.id === 'string' && item.id.length > 0) {
      overrides.set(item.id, item)
    }
  }
  if (overrides.size === 0) return discoveredModels
  return discoveredModels.map((model) => {
    const override = overrides.get(model.id)
    if (!override) return model
    return {
      ...model,
      ...(override.name !== undefined ? { name: override.name } : {}),
      ...(override.description !== undefined ? { description: override.description } : {}),
      ...(override.contextWindow !== undefined ? { contextWindow: override.contextWindow } : {}),
      ...(override.maxTokens !== undefined ? { maxTokens: override.maxTokens } : {}),
      ...(override.modality !== undefined ? { modality: override.modality } : {}),
      ...(override.inputModalities !== undefined ? { inputModalities: override.inputModalities } : {}),
      ...(override.effortLevels !== undefined ? { effortLevels: override.effortLevels } : {}),
    }
  })
}

/**
 * Build the provider profile materialized into the official `llm-pi-ai`
 * settings section. The providers-dict key (PROVIDER) IS the provider route,
 * so sessions keep addressing models as before; `apiKeyEnv` names the
 * credential ref the OAuth session already writes, and the official adapter
 * re-resolves it per request, so rotated tokens apply to the next request
 * without any notification.
 */
export function buildProviderProfile(options, models, existingRoute, baselineRoute) {
  const catalog = (Array.isArray(models) ? models : [])
    .filter((entry) => typeof entry?.id === 'string' && entry.id.length > 0)
  const api = piAiProtocolFor(options.apiFormat)
  // The ceiling applies to every capacity this route publishes, including the
  // fallback used for models the gateway did not size. maxTokens is capped too:
  // a requested output longer than the whole context cannot be satisfied, and
  // the host forwards maxTokens to the gateway verbatim.
  const cap = options.maxContextWindow
  // The route fallback window and its output limit must satisfy the same budget
  // as a model entry: a model the gateway did not size resolves to these two, and
  // the host charges them to the compaction budget exactly the same way.
  const fallbackWindow = clampToCap(options.defaultContextWindow, cap)
  // The route deliberately carries NO `reasoning`. It is one static level for
  // every model on the route, and a catalog whose models top out differently
  // has no single correct value for it: writing one model's `max` hands `max`
  // to a model that stops at `high` (a 400), and writing the intersection's
  // floor silently demotes the capable ones — which is exactly how
  // `deepseek-v4.1-flash` ended up defaulting to `high` rather than `max` once
  // `hy4-preview` (whose ladder is only `off`/`high`) was in the catalog.
  //
  // The preference is therefore resolved per model, by this plugin, in
  // `resolveModelInfo` (the picker's default) and on the request path. The
  // adapter answers "no default" for a route without this field, which is the
  // answer that lets the per-model override take effect — and the startup
  // cleanup still removes a value an older build left here.
  const profile = {
    displayName: 'AI Proxy',
    apiKeyEnv: options.apiKeyEnv,
    api,
    baseURL: piAiBaseURL(options.baseURL, options.apiFormat),
    headers: { ...ROUTE_HEADERS },
    defaultContextWindow: fallbackWindow,
    defaultMaxTokens: outputLimitFor(options.maxTokens, fallbackWindow, cap),
    ...(Number.isFinite(options.streamIdleTimeoutMs)
      ? { streamIdleTimeoutMs: options.streamIdleTimeoutMs }
      : {}),
    ...(options.retryPolicy !== undefined ? { retryPolicy: options.retryPolicy } : {}),
    models: catalog.map((entry) => {
      // The window this model will actually resolve to: its own declaration, or
      // the route fallback when the gateway did not size it.
      const window = clampToCap(entry.contextWindow ?? options.defaultContextWindow, cap)
      // The output limit the host will actually send. pi-ai fills an omitted
      // request maxTokens from the model entry itself (`options.maxTokens ??
      // model.maxTokens`), and the adapter only reports an entry's own maxTokens
      // as the request default — the route-level defaultMaxTokens never reaches a
      // request. It is bounded by the window's own fraction so host-side
      // pressure compaction keeps a positive budget (see outputLimitFor).
      const outputLimit = outputLimitFor(entry.maxTokens ?? options.maxTokens, window, cap)
      return {
        id: entry.id,
        ...(entry.name !== undefined && entry.name !== entry.id ? { name: entry.name } : {}),
        ...(entry.contextWindow !== undefined ? { contextWindow: window } : {}),
        ...(outputLimit !== undefined ? { maxTokens: outputLimit } : {}),
        // The gateway's /v1/models "modality" (text / image / decision) is not a
        // formal llm-pi-ai model field, but schemastery preserves undeclared keys,
        // so writing it here lets static consumers (e.g. dsh-jev's decision-model
        // detection) classify models without probing /v1/models again.
        ...(typeof entry.modality === 'string' && entry.modality.trim() !== ''
          ? { modality: entry.modality.trim() }
          : {}),
        input: inputModalitiesOf(entry) ?? ['text'],
        reasoningEfforts: ladderToReasoningEfforts(entry.effortLevels),
      }
    }),
  }
  const compat = routeCompatFor(api)
  if (compat !== undefined) profile.compat = compat
  if (existingRoute !== undefined) {
    return mergeProviderProfile(profile, existingRoute, baselineRoute).profile
  }
  return profile
}

// ── error mapping (discovery path) ─────────────────────────────────────────

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
 * Host-side gateway facade: provider authentication and model catalog. The
 * wire path itself belongs to the official llm-pi-ai adapter; this facade
 * keeps the credential the materialized route resolves ahead of rotation.
 */
class AiProxyApi {
  constructor(ctx, options) {
    this.ctx = ctx
    this.options = options
    this.modelsCache = null
    this.refreshTimer = undefined
    this.refreshBackoffMs = 0
    this.disposed = false
    this.oauth = new OAuthSession({
      credentials: this.credentials,
      options,
      logger: ctx.logger,
      onTokensChanged: () => {
        this.invalidateModels()
        this.scheduleTokenRefresh()
        this.onCredentialState?.()
      },
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

  /** Return credential-derived OAuth display state, plus the client id in use. */
  async authStatus() {
    const status = await this.oauth.status()
    const clientId = this.options().clientId
    if (status.state === 'signed-out' && this.reauthMessage) {
      return { ...status, message: this.reauthMessage, clientId }
    }
    return { ...status, clientId }
  }

  /** Current gateway facts for the settings page. */
  gateway() {
    const opts = this.options()
    return {
      baseURL: opts.baseURL,
      clientId: opts.clientId,
      apiFormat: opts.apiFormat,
      defaultReasoningEffort: opts.defaultReasoningEffort ?? DEFAULT_REASONING_EFFORT,
      maxContextWindow: opts.maxContextWindow,
    }
  }

  /** Validate and persist gateway configuration through the Host settings seam. */
  async setGateway(params) {
    let baseURL = typeof params === 'string' ? params : params?.baseURL
    const apiFormat = typeof params === 'object' && params?.apiFormat ? normalizeApiFormat(params.apiFormat) : undefined
    const defaultReasoningEffort = typeof params === 'object' && params?.defaultReasoningEffort !== undefined
      ? (typeof params.defaultReasoningEffort === 'string' ? params.defaultReasoningEffort.trim() : '')
      : undefined
    const clientId = typeof params === 'object' && params?.clientId !== undefined
      ? (typeof params.clientId === 'string' ? params.clientId.trim() : '')
      : undefined
    // Absent = leave the stored value alone. An empty string = clear the field,
    // which resets it to the schema default. Anything else must parse.
    let maxContextWindow
    if (typeof params === 'object' && params?.maxContextWindow !== undefined) {
      const rawCap = params.maxContextWindow
      if (typeof rawCap === 'string' && rawCap.trim() === '') {
        // Written back explicitly instead of unset: an unset would fall through
        // to whatever the composition layer holds, while clearing the card's
        // field must mean the documented default.
        maxContextWindow = DEFAULT_MAX_CONTEXT_WINDOW
      } else {
        maxContextWindow = parseContextWindow(rawCap)
        if (maxContextWindow === undefined) {
          throw new LlmError(
            '上下文上限必须是正整数，可带 K 或 M 单位（例如 500K、1M）',
            'INVALID_REQUEST',
          )
        }
        if (maxContextWindow < MIN_MAX_CONTEXT_WINDOW) {
          throw new LlmError(
            '上下文上限不能低于 ' + MIN_MAX_CONTEXT_WINDOW_LABEL + '，否则宿主无法压缩上下文',
            'INVALID_REQUEST',
          )
        }
      }
    }

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
    if (defaultReasoningEffort !== undefined) {
      mutations.push({ op: 'set', path: ['defaultReasoningEffort'], value: defaultReasoningEffort })
    }
    if (maxContextWindow !== undefined) {
      mutations.push({ op: 'set', path: ['maxContextWindow'], value: maxContextWindow })
    }
    let clientIdChanged = false
    let previousOptions
    if (clientId !== undefined) {
      if (!CLIENT_ID_PATTERN.test(clientId)) {
        throw new LlmError('Client ID 必须为 2-64 位小写字母、数字、点、下划线或连字符，且以字母或数字开头', 'INVALID_REQUEST')
      }
      const previous = this.options().clientId
      if (clientId === DEFAULT_CLIENT_ID && previous !== DEFAULT_CLIENT_ID) {
        throw new LlmError('不能改回共享 Client ID dsh，否则多台机器会互相踢下线', 'INVALID_REQUEST')
      }
      if (clientId !== previous) {
        mutations.push({ op: 'set', path: ['clientId'], value: clientId })
        clientIdChanged = true
        previousOptions = this.options()
      }
    }

    if (mutations.length > 0) {
      await this.ctx.settings.mutate(this.settingsNs ?? NS, mutations)
      this.invalidateModels()
    }
    if (clientIdChanged) {
      // The stored refresh token was issued to the previous client_id. Refreshing
      // it under the new id is an invalid_grant, and leaving it in place lets a
      // later timer present the old shared grant.
      this.reauthMessage = 'Client ID 已更改，请重新登录'
      await this.dropForeignTokens(previousOptions)
    }
    const gateway = this.gateway()
    return clientIdChanged ? { ...gateway, reauthRequired: true } : gateway
  }

  /**
   * Forget every slot a previous client id — or a pre-namespacing build — wrote
   * into the shared credentials document. Two installs that share the file (DSH
   * web and desktop on one machine) must not read each other's tokens.
   */
  async dropForeignTokens(previous) {
    const slots = [
      tokenRefs(previous.clientId, previous.apiKeyEnv),
      tokenRefs(this.options().clientId, this.options().apiKeyEnv),
      LEGACY_REFS,
    ]
    const seen = new Set()
    for (const slot of slots) {
      for (const ref of [slot.access, slot.refresh, slot.expiry]) {
        if (seen.has(ref)) continue
        seen.add(ref)
        await this.credentials.unset(ref)
      }
    }
    // Notifies listeners, reschedules the timer, and removes the route.
    await this.oauth.clearTokens()
  }

  /**
   * Leave the shared `dsh` client id before any refresh or authorization.
   * One in-flight migration is shared so two callers cannot mint two ids.
   */
  ensureDeviceClientId() {
    if (!this.clientIdEnsure) {
      this.clientIdEnsure = this.doEnsureDeviceClientId().finally(() => {
        this.clientIdEnsure = null
      })
    }
    return this.clientIdEnsure
  }

  async doEnsureDeviceClientId() {
    const current = this.options().clientId
    if (current !== DEFAULT_CLIENT_ID) return current
    if (!this.ctx.settings?.writable) {
      throw new LlmError(
        '当前 Client ID 仍是共享默认值 dsh，且设置不可写，无法为这台机器分配独立标识',
        'INVALID_REQUEST',
      )
    }
    const generated = generateDefaultClientId()
    await this.ctx.settings.mutate(this.settingsNs ?? NS, [
      { op: 'set', path: ['clientId'], value: generated },
    ])
    const applied = this.options().clientId
    if (applied !== generated) {
      throw new LlmError(
        '独立 Client ID 未能生效（当前仍是 ' + applied + '）。请确认 profile 没有把 clientId 固定为 dsh',
        'INVALID_REQUEST',
      )
    }
    return generated
  }

  /**
   * Persist a unique client id when this install is still on the shared
   * sentinel, and drop tokens that belong to the old grant. Those tokens must
   * not be refreshed: doing so either replays the shared chain or fails the
   * new client id and clears the login anyway.
   */
  async adoptDeviceClientId() {
    const before = this.options()
    const clientId = await this.ensureDeviceClientId()
    if (clientId !== before.clientId) {
      this.reauthMessage = '已为这台机器分配独立 Client ID ' + clientId + '，请重新登录'
      await this.dropForeignTokens(before)
    }
    return clientId
  }

  /** Start browser authorization without holding the RPC open for the callback. */
  async login() {
    const clientId = await this.adoptDeviceClientId()
    const status = await this.oauth.login({ clientId })
    return { ...status, clientId: status.clientId ?? clientId }
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
   * The per-plan model catalog, cached for modelCacheTtlMs. Strict mode
   * (`{ strict: true }`) never substitutes the static fallback: a missing
   * credential or a failed fetch rethrows, so callers that persist discovery
   * results cannot record a failed answer as the catalog.
   */
  async catalog({ strict = false } = {}) {
    const opts = this.options()
    if (this.modelsCache && Date.now() - this.modelsCache.at < opts.modelCacheTtlMs) {
      return this.modelsCache.models
    }
    const fallback = () => opts.models.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      ...(m.description !== undefined ? { description: m.description } : {}),
      ...(m.contextWindow !== undefined ? { contextWindow: m.contextWindow } : {}),
      ...(m.maxTokens !== undefined ? { maxTokens: m.maxTokens } : {}),
      // Keep statically declared gateway capabilities, including modality.
      ...(m.modality !== undefined ? { modality: m.modality } : {}),
      ...(m.inputModalities !== undefined ? { inputModalities: m.inputModalities } : {}),
      ...(m.effortLevels !== undefined ? { effortLevels: m.effortLevels } : []),
    }))
    let credential
    try {
      credential = await this.resolveCredential()
    } catch (error) {
      if (!strict && error.code === 'MISSING_CREDENTIAL') return fallback()
      throw error
    }
    try {
      const modelsUrl = resolveModelsEndpoint(opts.baseURL)
      const res = await fetch(modelsUrl, {
        headers: { authorization: 'Bearer ' + credential.token },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) throw await errorFromResponse(res)
      const body = await res.json()
      const discovered = (body.data ?? []).filter((m) => typeof m?.id === 'string').map(AiProxyApi.normalizeModel)
      const models = applyStaticModelOverrides(discovered, opts.models)
      this.modelsCache = { at: Date.now(), models }
      return models
    } catch (error) {
      if (strict) throw error
      this.ctx.logger.warn('dsh-ai-proxy: /v1/models 拉取失败,回退静态目录: ' + error.message)
      return fallback()
    }
  }

  /**
   * Force refresh model catalog from /v1/models with current credentials.
   */
  async refreshModels() {
    this.invalidateModels()
    const opts = this.options()
    let credential = await this.resolveCredential()
    const modelsUrl = resolveModelsEndpoint(opts.baseURL)
    let res = await fetch(modelsUrl, {
      headers: { authorization: "Bearer " + credential.token },
      signal: AbortSignal.timeout(10000),
    })
    if (res.status === 401 && credential.source === "oauth") {
      try {
        credential = await this.resolveCredential({ force: true })
        res = await fetch(modelsUrl, {
          headers: { authorization: "Bearer " + credential.token },
          signal: AbortSignal.timeout(10000),
        })
      } catch {}
    }
    if (!res.ok) throw await errorFromResponse(res)
    const body = await res.json()
    const discovered = (body.data ?? []).filter((m) => typeof m?.id === "string").map(AiProxyApi.normalizeModel)
    const models = applyStaticModelOverrides(discovered, opts.models)
    this.modelsCache = { at: Date.now(), models }
    if (typeof this.onModelsRefreshed === "function") {
      try {
        await this.onModelsRefreshed()
      } catch (error) {
        this.ctx.logger.warn("dsh-ai-proxy: notify models refreshed failed: " + error.message)
      }
    }
    return { count: models.length, models }
  }

  /**
   * Schedule one proactive refresh at the stored expiry so the credential ref
   * the materialized route resolves never serves a stale token: the official
   * adapter reads it per request, and this timer keeps it ahead of rotation.
   * Failed refreshes back off exponentially instead of hot-looping.
   */
  scheduleTokenRefresh() {
    if (this.disposed) return
    // Rapid token changes overlap the async expiry read; a generation guard
    // keeps exactly the latest schedule alive.
    const generation = this.refreshGeneration = (this.refreshGeneration ?? 0) + 1
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = undefined
    }
    void (async () => {
      let expiry = Number.NaN
      try {
        const stored = await this.credentials.resolve(this.oauth.refs().expiry)
        expiry = Number(stored?.value ?? Number.NaN)
      } catch {
        return
      }
      if (this.disposed || generation !== this.refreshGeneration) return
      if (!Number.isFinite(expiry)) {
        this.refreshBackoffMs = 0
        return
      }
      const delay = Math.min(
        Math.max(expiry - Date.now(), this.refreshBackoffMs, 1),
        MAX_SET_TIMEOUT_MS,
      )
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = undefined
        if (this.disposed) return
        void (async () => {
          try {
            await this.oauth.resolve({ force: true })
            this.refreshBackoffMs = 0
          } catch (error) {
            this.refreshBackoffMs = this.refreshBackoffMs === 0
              ? 15000
              : Math.min(this.refreshBackoffMs * 2, 600000)
            this.ctx.logger.warn(name + ': 主动刷新令牌失败: ' + error.message)
          }
          this.scheduleTokenRefresh()
        })()
      }, delay)
      this.refreshTimer.unref?.()
    })()
  }

  /** Startup probe: detach from the shared client id before any refresh. */
  async bootstrap() {
    try {
      await this.adoptDeviceClientId()
      await this.resolveCredential()
      await this.catalog()
    } catch (error) {
      if (error.code === 'MISSING_CREDENTIAL') return
      this.ctx.logger.error('dsh-ai-proxy: 启动时刷新令牌失败: ' + error.message)
    } finally {
      // A machine still stuck on `dsh` must not rotate that shared grant.
      if (this.options().clientId === DEFAULT_CLIENT_ID) {
        this.ctx.logger.error(name + ': 仍在使用共享 Client ID dsh，已停止自动刷新，避免把其它机器踢下线')
        return
      }
      this.scheduleTokenRefresh()
    }
  }

  /** Stop the proactive refresh timer (host is disposing this plugin). */
  dispose() {
    this.disposed = true
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = undefined
    }
  }
}

// ── llm-pi-ai route materializer ───────────────────────────────────────────

/**
 * Writes and removes this plugin's single provider profile in the official
 * `llm-pi-ai` settings section. Only the `providers.ai-proxy` key is ever
 * touched: hand-written routes in the same section are left alone, and the
 * official adapter hot-registers whatever the merged section says.
 */
class RouteMaterializer {
  constructor(ctx) {
    this.ctx = ctx
    /** undefined = not probed yet; false = host ships no llm-pi-ai section. */
    this.available = undefined
    /** Auto-generated baseline from the previous sync, used to detect user edits. */
    this.baseline = undefined
  }

  /** Probe the host settings document for the official adapter's section. */
  async checkAvailability() {
    if (this.available !== undefined) return this.available
    try {
      const described = this.ctx.settings.describe?.() ?? []
      this.available = described.some((entry) => entry?.ns === PI_AI_NS)
    } catch {
      this.available = false
    }
    return this.available
  }

  /** Persist one provider profile, preserving user-modified model configs. */
  async sync(freshProfile) {
    if (this.available === false) {
      throw new LlmError('宿主未挂载 llm-pi-ai 适配器,无法材料化 AI Proxy 路由', 'UNSUPPORTED')
    }
    let existingRoute
    try {
      existingRoute = readSettingsSection(this.ctx, PI_AI_NS)?.providers?.[PROVIDER]
    } catch {
      existingRoute = undefined
    }
    const { profile, baseline } = mergeProviderProfile(freshProfile, existingRoute, this.baseline)
    this.baseline = baseline
    await this.ctx.settings.mutate(PI_AI_NS, [
      { op: 'set', path: ['providers', PROVIDER], value: profile },
    ])
  }

  /**
   * Remove a route-level `reasoning` left by an older materialization.
   *
   * This build never writes that field: one static level cannot serve a catalog
   * whose models top out differently, and the adapter reports it as every
   * model's default — which is how `deepseek-v4.1-flash` (low/high/max) came to
   * default to `high` because another model in the same catalog offered only
   * `off`/`high`. A stale value would keep winning over the per-model
   * resolution, so it is removed up front; a sync then writes the route without
   * it. Discovery failure does not bring it back, and the catalog itself is
   * left untouched.
   */
  async dropRouteReasoning() {
    if (this.available === false) return false
    let route
    try {
      route = readSettingsSection(this.ctx, PI_AI_NS)?.providers?.[PROVIDER]
    } catch {
      return false
    }
    if (!route || typeof route !== 'object' || !Object.hasOwn(route, 'reasoning')) return false
    await this.ctx.settings.mutate(PI_AI_NS, [
      { op: 'unset', path: ['providers', PROVIDER, 'reasoning'] },
    ])
    return true
  }

  /** Remove the materialized route, e.g. after the last credential is gone. */
  async remove() {
    if (this.available === false) return
    this.baseline = undefined
    await this.ctx.settings.mutate(PI_AI_NS, [
      { op: 'unset', path: ['providers', PROVIDER] },
    ])
  }
}

// ── plugin config ──────────────────────────────────────────────────────────

const catalogModel = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  // Gateway-side capability fields discovered from /v1/models. They are
  // carried through the plugin config so a re-materialization keeps them.
  modality: z.string(),
  inputModalities: z.array(z.string()),
  effortLevels: z.array(z.string()),
})


/** The shared symbol of cosmokit's live-reference protocol, stable across module copies. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * Whether a resolved config value is a live reference rather than plain data.
 * Schemastery 3.18.4+ hands the plugin a cosmokit reference for every volatile
 * field (`{ get(), [VOLATILE_WRITE] }`), and the Loader swaps the value inside
 * that same reference when the profile patch changes, so it must be unwrapped
 * before the config is validated.
 */
function isVolatileRef(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  if (typeof value.get !== 'function') return false
  return VOLATILE_WRITE in value || Object.keys(value).length === 0
}

/**
 * Mark one top-level field as live. The host settings service edits a plugin's
 * config through `settings.mutate`, which refuses an entry that declares no
 * volatile field ("Plugin entry X has no volatile fields"), and the Loader then
 * applies the write to the running fiber instead of remounting it. Schemastery
 * copies older than 3.18.4 have no `.volatile()` at all; there the field stays
 * ordinary config and the legacy `settings.register` seam owns the value.
 * @param schema Field schema.
 * @returns The same schema, marked live when the host supports live fields.
 */
function liveField(schema) {
  return typeof schema.volatile === 'function' ? schema.volatile() : schema
}

function unwrapConfig(value, seen = new Set()) {
  if (isVolatileRef(value)) return unwrapConfig(value.get(), seen)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return value
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => unwrapConfig(item, seen))
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unwrapConfig(item, seen)]))
}

function settingsNamespace(ctx, fallback) {
  if (typeof ctx.settings?.register === 'function') return fallback
  const id = ctx.fiber?.entry?.options?.id
  return typeof id === 'string' && id.length > 0 ? id : fallback
}

function readSettingsSection(ctx, ns) {
  if (typeof ctx.settings?.get === 'function') {
    const value = ctx.settings.get(ns)
    if (value !== undefined) return unwrapConfig(value)
  }
  const described = typeof ctx.settings?.describe === 'function' ? ctx.settings.describe() : []
  return described.find((entry) => entry?.ns === ns)?.value
}

/**
 * The composition layer a settings section inherits from, as plain data.
 * `settings.register` resolves the schema over its `base` itself, so the base
 * must be raw config: the resolved fiber config carries live references on a
 * schemastery with volatile support, and a reference is not config data.
 */
function settingsBase(ctx, config) {
  return unwrapConfig(ctx.fiber?.entry?.options?.config ?? config ?? {})
}

function openSettingsScope(ctx, ns, config) {
  if (typeof ctx.settings?.register === 'function') {
    return ctx.settings.register(ns, Config, { base: settingsBase(ctx, config) })
  }
  const read = () => unwrapConfig(config ?? {})
  return {
    get: read,
    watch(listener) {
      if (typeof ctx.on !== 'function') return () => {}
      return ctx.on('loader/volatile-update', () => listener(read()))
    },
  }
}

/** Plugin config; doubles as the ai-proxy settings-section shape. */
export const Config = z.object({
  baseURL: liveField(z.string().default(DEFAULT_BASE_URL)),
  apiFormat: liveField(z.union(API_FORMATS).default(DEFAULT_API_FORMAT)),
  clientId: liveField(z.string().default(DEFAULT_CLIENT_ID)),
  // No default: the access slot is derived from the client id (see tokenRefs),
  // so a schema-level default would pin every install to one shared ref.
  apiKeyEnv: z.string().role('credential-ref'),
  // Two states and only two: the card writes whichever side its switch is on,
  // and anything else would be a depth policy the UI cannot express. Enumerated
  // so a hand-edited profile is refused at write time instead of being folded
  // into one of the two at request time.
  defaultReasoningEffort: liveField(z.union(['highest', 'lowest']).default(DEFAULT_REASONING_EFFORT)),
  maxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  // A plain token count or one carrying a K/M suffix (`500K`, `1M`, `500k`);
  // parseContextWindow normalizes it in resolveOptions. Declared live so the
  // settings card can rewrite it through settings.mutate, which rejects any
  // field the schema does not mark volatile.
  maxContextWindow: liveField(
    z.union([z.number(), z.string()]).default(DEFAULT_MAX_CONTEXT_WINDOW),
  ),
  modelCacheTtlMs: z.number().step(1).min(10000).default(DEFAULT_MODEL_CACHE_TTL_MS),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_SET_TIMEOUT_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
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
  if (!Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0 || streamIdleTimeoutMs > MAX_SET_TIMEOUT_MS) {
    throw new Error(name + ': streamIdleTimeoutMs must be a positive finite number no greater than ' + MAX_SET_TIMEOUT_MS)
  }
  const modelCacheTtlMs = raw.modelCacheTtlMs ?? DEFAULT_MODEL_CACHE_TTL_MS
  if (!Number.isInteger(modelCacheTtlMs) || modelCacheTtlMs < 10000) throw new Error(name + ': modelCacheTtlMs must be an integer >= 10000')
  const maxTokens = raw.maxTokens ?? DEFAULT_MAX_TOKENS
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) throw new Error(name + ': maxTokens must be a positive safe integer')
  const defaultContextWindow = raw.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW
  if (!Number.isInteger(defaultContextWindow) || defaultContextWindow <= 0) throw new Error(name + ': defaultContextWindow must be a positive integer')
  const maxContextWindow = parseContextWindow(raw.maxContextWindow ?? DEFAULT_MAX_CONTEXT_WINDOW)
  if (maxContextWindow === undefined) {
    throw new Error(name + ': maxContextWindow must be a positive token count, optionally suffixed K or M (e.g. 500K, 1M)')
  }
  if (maxContextWindow < MIN_MAX_CONTEXT_WINDOW) {
    throw new Error(name + ': maxContextWindow must be at least ' + MIN_MAX_CONTEXT_WINDOW_LABEL + ' (' + MIN_MAX_CONTEXT_WINDOW + ' tokens); a narrower window disables host-side context compaction')
  }
  return {
    baseURL: (raw.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiFormat: normalizeApiFormat(raw.apiFormat),
    clientId,
    // The access slot follows the client id, so the materialized route (which
    // resolves apiKeyEnv per request) reads exactly the slot OAuth writes to.
    apiKeyEnv: tokenRefs(clientId, raw.apiKeyEnv).access,
    defaultReasoningEffort: raw.defaultReasoningEffort ?? DEFAULT_REASONING_EFFORT,
    maxTokens,
    defaultContextWindow,
    maxContextWindow,
    modelCacheTtlMs,
    streamIdleTimeoutMs,
    models: raw.models ?? [],
    retryPolicy: raw.retryPolicy,
  }
}

// ── Host RPC channel ───────────────────────────────────────────────────────

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
      case 'config':
      case 'refreshModels': {
        if (keys.length !== 0) return badAuthRequest('AI Proxy ' + method + ' requests must carry an empty object')
        if (method === 'status') return { ok: true, value: await api.authStatus() }
        if (method === 'login') return { ok: true, value: await api.login() }
        if (method === 'logout') return { ok: true, value: await api.logout() }
        if (method === 'refreshModels') return { ok: true, value: await api.refreshModels() }
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

// ── plugin wiring ──────────────────────────────────────────────────────────

/**
 * Register the stable settings section, the Host authentication interface,
 * and materialize the gateway as one official llm-pi-ai provider route.
 */
export function apply(ctx, config) {
  let current = () => unwrapConfig(config ?? {})
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
  const materializer = new RouteMaterializer(ctx)

  const syncError = (error) => {
    ctx.logger.warn(name + ': 材料化 llm-pi-ai 路由失败: ' + (error instanceof Error ? error.message : String(error)))
  }

  /** The materialized route as it currently stands in the settings document. */
  const currentRoute = () => {
    try {
      return readSettingsSection(ctx, PI_AI_NS)?.providers?.[PROVIDER]
    } catch {
      return undefined
    }
  }

  /**
   * Re-materialize the route from the current catalog. Discovery runs strict:
   * a failed or empty answer never overwrites the last good route in settings
   * (the settings document IS the persistence layer across restarts), and an
   * empty static fallback writes nothing either — a route with no models
   * serves nothing.
   */
  const maybeSync = async () => {
    if (!(await materializer.checkAvailability())) return
    let models
    try {
      models = await api.catalog({ strict: true })
    } catch {
      if (currentRoute() !== undefined) return
      try {
        models = await api.catalog()
      } catch {
        return
      }
    }
    if (!Array.isArray(models) || models.length === 0) return
    await materializer.sync(buildProviderProfile(options(), models))
  }

  api.onModelsRefreshed = () => maybeSync().catch(syncError)
  api.onCredentialState = () => {
    void (async () => {
      try {
        await api.resolveCredential()
        await maybeSync()
      } catch {
        await materializer.remove().catch(syncError)
      }
    })()
  }

  const settingsNs = settingsNamespace(ctx, NS)
  api.settingsNs = settingsNs
  const scope = openSettingsScope(ctx, NS, config)
  current = () => unwrapConfig(scope.get())

  let syncTimer
  const scheduleSync = () => {
    clearTimeout(syncTimer)
    syncTimer = setTimeout(() => { void maybeSync().catch(syncError) }, 250)
    syncTimer.unref?.()
  }
  scope.watch(scheduleSync)

  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.connection.rpc.handle(
      AUTH_RPC_CHANNEL,
      (method, payload) => handleAuthRpc(api, method, payload),
      { authority: 'trusted-host' },
    )
  })

  const stored = ctx.settings.describe().find((entry) => entry.ns === settingsNs)?.user
  const hasLegacyOAuthFields = stored !== null && typeof stored === 'object'
    && (Object.hasOwn(stored, 'oauth') || Object.hasOwn(stored, 'oauthStatus'))
  if (ctx.settings.writable && hasLegacyOAuthFields) {
    void ctx.settings.mutate(settingsNs, [
      { op: 'unset', path: ['oauth'] },
      { op: 'unset', path: ['oauthStatus'] },
    ]).catch((error) => {
      ctx.logger.warn(name + ': failed to remove legacy OAuth settings fields:', error)
    })
  }

  // Fill this route's preference against the concrete model's own ladder.
  // The preference has to land on `config.reasoningEffort`, because that is
  // the only thing the request path reads: the agent loop builds its frozen
  // request from `prepareCall().config`, and the official adapter resolves
  // `options.reasoningEffort ?? profile.reasoning` — never `defaultEffort`.
  //
  // `defaultEffort` alone is therefore NOT enough. It only pre-selects a row
  // in the picker; nothing copies it into a request. That is why "the switch is
  // on but the gateway logs no effort" survived three attempts at fixing the
  // picker: the value never reached the wire.
  //
  // The seam that decides is `resolveCallFor`: `prepareCall` and every
  // `ctx.llm.stream()` both derive their resolved config from it, and the agent
  // loop's request is built from that config. Filling it here covers all three
  // dispatch shapes at once, and `adapterDefaults.reasoningEffort` then records
  // the level as adapter-supplied rather than user-chosen — which is exactly
  // what it is.
  const preference = () => options().defaultReasoningEffort ?? DEFAULT_REASONING_EFFORT
  const preferredFor = (info) => defaultEffortForModel(info?.reasoning?.efforts, preference())
  if (ctx.llm) {
    // The seam the host actually reads. `resolveCallFor` — which every dispatch
    // runs before the adapter is called — reaches model metadata through
    // `resolveModelInfoFor(registration, …)`, NOT through the public
    // `resolveModelInfo(provider, …)`. Overriding only the public one leaves
    // the internal path on the adapter's own answer, so a route-level
    // `reasoning` (or the adapter's absent default) wins and the preference
    // never reaches the request. Both entry points are wrapped: the internal
    // one because it is the one that matters, the public one because other
    // plugins and the model editor call it directly.
    const origResolveModelInfoFor = typeof ctx.llm.resolveModelInfoFor === 'function'
      ? ctx.llm.resolveModelInfoFor.bind(ctx.llm)
      : undefined
    const origResolveModelInfo = typeof ctx.llm.resolveModelInfo === 'function'
      ? ctx.llm.resolveModelInfo.bind(ctx.llm)
      : undefined

    /**
     * Fill this route's preference against the concrete model's own ladder.
     *
     * Recomputed every time, not only when the adapter left `defaultEffort`
     * unset: the adapter derives it from the route's static `reasoning`, which
     * is one level for the whole catalog, so a route defaulted to `high`
     * (because some model only offers `off`/`high`) reports `high` for a model
     * whose own ladder reaches `max`. This plugin is the only party that
     * resolves the preference against the concrete ladder, so it wins.
     *
     * `defaultEffort` is also the picker's pre-selected row, so a level this
     * model does not publish is left off rather than shown as a selection whose
     * effect is invisible in the list.
     */
    const withPreferredDefault = (info, provider) => {
      if (provider !== PROVIDER || info?.reasoning === undefined) return info
      const target = preferredFor(info)
      if (target === undefined) return info
      const offered = (Array.isArray(info?.reasoning?.efforts) ? info.reasoning.efforts : [])
        .some((effort) => (typeof effort === 'string' ? effort : effort?.id) === target)
      if (!offered) return info
      if (info.reasoning.defaultEffort === target) return info
      return {
        ...info,
        reasoning: {
          ...info.reasoning,
          defaultEffort: ReasoningEffortId(target),
        },
      }
    }

    if (origResolveModelInfoFor !== undefined) {
      ctx.llm.resolveModelInfoFor = async function (registration, model, signal) {
        const info = await origResolveModelInfoFor(registration, model, signal)
        return withPreferredDefault(info, registration?.provider?.id ?? info?.provider)
      }
    }
    if (origResolveModelInfo !== undefined) {
      ctx.llm.resolveModelInfo = async function (provider, model, signal) {
        const info = await origResolveModelInfo(provider, model, signal)
        return withPreferredDefault(info, provider)
      }
    }

    // The seam that actually puts the level on the wire. Every dispatch shape
    // — `ctx.llm.stream()`, `prepareCall().stream()`, the agent loop's frozen
    // request — derives its config from here, so filling `reasoningEffort`
    // here reaches all of them. It is filled only when the caller named no
    // level: an explicit choice (including `off`) is the user's and is left
    // exactly as it is.
    if (origResolveModelInfoFor !== undefined && typeof ctx.llm.resolveCallFor === 'function') {
      const origResolveCallFor = ctx.llm.resolveCallFor.bind(ctx.llm)
      ctx.llm.resolveCallFor = async function (registration, config, signal) {
        if (config?.provider !== PROVIDER) return origResolveCallFor(registration, config, signal)
        // Normalise the caller's level BEFORE the host validates it. The host
        // throws UNSUPPORTED_REASONING_EFFORT for a level outside the model's
        // ladder, which is the right answer for a genuine mistake but the wrong
        // one for a level carried over from a different model after a switch —
        // the clamp exists precisely so that case never reaches the host.
        let effective = config
        try {
          const info = await origResolveModelInfoFor(registration, config.model, signal)
          const efforts = info?.reasoning?.efforts
          if (config.reasoningEffort === undefined) {
            const target = preferredFor(info)
            if (target !== undefined) effective = { ...config, reasoningEffort: ReasoningEffortId(target) }
          } else {
            const clamped = clampEffortToLadder(config.reasoningEffort, efforts)
            if (clamped !== config.reasoningEffort) {
              effective = clamped === undefined
                ? (() => { const rest = { ...config }; delete rest.reasoningEffort; return rest })()
                : { ...config, reasoningEffort: ReasoningEffortId(clamped) }
            }
          }
        } catch {}
        return origResolveCallFor(registration, effective, signal)
      }
    }

    // The 0.2.x seam, and the one the installed host actually dispatches
    // through. `prepareCall` and `adapterStream` there call
    // `resolveCallWithInfo(config, info)` directly — `resolveCallFor` is left
    // for the standalone `resolveCallConfig` query only — so wrapping the
    // older entry point alone changes nothing on this host.
    //
    // It receives the already-normalized model info, so the ladder is read
    // straight off it and no extra lookup is needed. The config it is handed
    // is the caller's, before the host's own defaulting, which is exactly
    // where a missing level has to be filled.
    if (typeof ctx.llm.resolveCallWithInfo === 'function') {
      const origResolveCallWithInfo = ctx.llm.resolveCallWithInfo.bind(ctx.llm)
      ctx.llm.resolveCallWithInfo = function (config, info) {
        if (config?.provider !== PROVIDER) return origResolveCallWithInfo(config, info)
        let effective = config
        try {
          const efforts = info?.reasoning?.efforts
          if (config.reasoningEffort === undefined) {
            const target = preferredFor(info)
            if (target !== undefined) effective = { ...config, reasoningEffort: ReasoningEffortId(target) }
          } else {
            const clamped = clampEffortToLadder(config.reasoningEffort, efforts)
            if (clamped !== config.reasoningEffort) {
              effective = clamped === undefined
                ? (() => { const rest = { ...config }; delete rest.reasoningEffort; return rest })()
                : { ...config, reasoningEffort: ReasoningEffortId(clamped) }
            }
          }
        } catch {}
        return origResolveCallWithInfo(effective, info)
      }
    }

    // `resolveCallConfig` is a "what would this call send" query, so it must
    // answer the level the dispatch will use — the same one `resolveCallFor`
    // fills. Only the missing case is answered here; a level the caller named
    // is passed through untouched, because this entry point is also used by the
    // session controller to validate a selection, and rewriting a user's choice
    // in a validation call is not its job.
    if (origResolveModelInfo !== undefined && typeof ctx.llm.resolveCallConfig === 'function') {
      const origResolveCallConfig = ctx.llm.resolveCallConfig.bind(ctx.llm)
      ctx.llm.resolveCallConfig = async function (config, signal) {
        if (config?.provider === PROVIDER && config.reasoningEffort === undefined) {
          try {
            const info = await origResolveModelInfo(config.provider, config.model, signal)
            const target = preferredFor(info)
            if (target !== undefined) config = { ...config, reasoningEffort: ReasoningEffortId(target) }
          } catch {}
        }
        return origResolveCallConfig(config, signal)
      }
    }

    ctx.on('llm/stream', (streamOptions, next) => {
      if (streamOptions?.provider !== PROVIDER) return next()
      return (async function* () {
        try {
          if (origResolveModelInfo !== undefined) {
            const info = await origResolveModelInfo(streamOptions.provider, streamOptions.model, streamOptions.signal)
            const resolved = streamOptionsWithPreferredEffort(streamOptions, info?.reasoning?.efforts, preference())
            if (resolved !== streamOptions) {
              if (resolved.reasoningEffort !== undefined) {
                streamOptions.reasoningEffort = resolved.reasoningEffort
              } else if (streamOptions.reasoningEffort !== undefined) {
                delete streamOptions.reasoningEffort
              }
            }
          }
          if (isGeminiModel(streamOptions.model)) {
            if (Array.isArray(streamOptions.tools) && streamOptions.tools.length > 0) {
              streamOptions.tools = sanitizeGeminiTools(streamOptions.tools)
            }
          }
          if (isGemini3Model(streamOptions.model)) {
            if (Array.isArray(streamOptions.messages) && streamOptions.messages.length > 0) {
              streamOptions.messages = sanitizeGeminiMessages(streamOptions.messages)
            }
          }
        } catch {}
        yield* next()
      })()
    })
  }

  ctx.on('dispose', () => {
    clearTimeout(syncTimer)
    api.dispose()
  })

  void (async () => {
    if (!(await materializer.checkAvailability())) {
      ctx.logger.warn(name + ': 宿主未提供 llm-pi-ai 设置节(需要 DSH 宿主 0.1.5-rc 及以上),已跳过路由材料化')
      return
    }
    // A route-level reasoning left by an older build outlives a discovery
    // failure along with the catalog, and the adapter would keep reporting it
    // as every model's default ahead of this plugin's per-model resolution —
    // so it is removed up front, before the catalog is even fetched.
    await materializer.dropRouteReasoning().catch(syncError)
    try {
      await api.bootstrap()
    } catch (error) {
      ctx.logger.error(name + ': bootstrap failed: ' + (error instanceof Error ? error.message : String(error)))
    }
    await maybeSync().catch(syncError)
  })()
}

// Re-exported pure helpers for unit tests.
export const internals = {
  AiProxyApi, RouteMaterializer, OAuthSession,
  buildProviderProfile, mergeModelEntry, mergeProviderProfile, applyStaticModelOverrides,
  piAiProtocolFor, piAiBaseURL, routeCompatFor,
  ladderToReasoningEfforts, preferredEffort, effectiveDefaultEffort, defaultEffortForModel,
  streamOptionsWithPreferredEffort, routeDefaultEffortKey,
  clampEffortToLadder, extractEffortRungs,
  effortName, resolveDefaultEffort, inputModalitiesOf,
  parseContextWindow, clampToCap, outputLimitFor,
  isGeminiModel, isGemini3Model, sanitizeGeminiSchema, sanitizeGeminiTools, sanitizeWindowsPathText, sanitizeGeminiMessages,
  httpErrorCode, errorFromResponse, handleAuthRpc,
  pkcePair, base64url,
  discoverEndpoints, tokenRequest, startCallbackListener,
  normalizeApiFormat, resolveModelsEndpoint, generateDefaultClientId, tokenRefs,
  isVolatileRef, unwrapConfig, liveField, VOLATILE_WRITE, settingsBase,
  API_FORMAT_CHAT_COMPLETIONS, API_FORMAT_ANTHROPIC_MESSAGES, API_FORMAT_RESPONSES, API_FORMATS, DEFAULT_API_FORMAT,
  PI_AI_PROTOCOL_CHAT_COMPLETIONS, PI_AI_PROTOCOL_RESPONSES, PI_AI_PROTOCOL_ANTHROPIC,
}
