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
export const inject = ['credentials', 'settings', 'llm']

/** The provider route name; also the llm-pi-ai providers-dict key we own. */
export const PROVIDER = 'ai-proxy'
/** Settings namespace owning this provider's profile. */
export const NS = 'ai-proxy'
/** Settings namespace of the host's official multi-protocol adapter. */
export const PI_AI_NS = 'llm-pi-ai'

export const DEFAULT_BASE_URL = 'http://localhost:18080'
export const DEFAULT_CLIENT_ID = 'dsh'
export const DEFAULT_MAX_TOKENS = 65536
export const DEFAULT_CONTEXT_WINDOW = 200000
export const DEFAULT_MODEL_CACHE_TTL_MS = 300000
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000

export const DEFAULT_API_KEY_ENV = 'AIPROXY_ACCESS_TOKEN'
export const DEFAULT_REASONING_EFFORT = 'highest'

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
 * spellings the gateway expects. `off` maps to null ("supported, send no
 * parameter"); standard rungs keep their identity spelling; non-standard
 * rungs (ultra/turbo/…) borrow free selector keys from the top down so the
 * gateway's strongest spelling stays selectable as its strongest level.
 * `false` marks a model with no selectable reasoning.
 */
export function ladderToReasoningEfforts(effortLevels) {
  const rungs = Array.isArray(effortLevels)
    ? effortLevels.map(String).filter((rung) => rung.length > 0)
    : []
  const entries = new Map()
  if (rungs.includes('off') || rungs.includes('none')) entries.set('off', null)
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
  if (![...entries.keys()].some((key) => key !== 'off')) return false
  return Object.fromEntries(entries)
}

/**
 * Resolve the route-level default reasoning level from every model's ladder
 * at once: 'highest' picks the strongest selector key any model offers and
 * 'lowest' the weakest non-off key, so models that cannot serve the key keep
 * their own ladder in the picker while capable ones aim high. An exact
 * configured key wins when offered; otherwise the nearest lower offered key
 * applies, falling up when nothing lower exists.
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

/**
 * Build the provider profile materialized into the official `llm-pi-ai`
 * settings section. The providers-dict key (PROVIDER) IS the provider route,
 * so sessions keep addressing models as before; `apiKeyEnv` names the
 * credential ref the OAuth session already writes, and the official adapter
 * re-resolves it per request, so rotated tokens apply to the next request
 * without any notification.
 */
export function buildProviderProfile(options, models) {
  const catalog = (Array.isArray(models) ? models : [])
    .filter((entry) => typeof entry?.id === 'string' && entry.id.length > 0)
  const profile = {
    displayName: 'AI Proxy',
    apiKeyEnv: options.apiKeyEnv,
    api: piAiProtocolFor(options.apiFormat),
    baseURL: piAiBaseURL(options.baseURL, options.apiFormat),
    headers: { ...ROUTE_HEADERS },
    defaultContextWindow: options.defaultContextWindow,
    defaultMaxTokens: options.maxTokens,
    ...(Number.isFinite(options.streamIdleTimeoutMs)
      ? { streamIdleTimeoutMs: options.streamIdleTimeoutMs }
      : {}),
    ...(options.retryPolicy !== undefined ? { retryPolicy: options.retryPolicy } : {}),
    models: catalog.map((entry) => ({
      id: entry.id,
      ...(entry.name !== undefined && entry.name !== entry.id ? { name: entry.name } : {}),
      ...(entry.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
      ...(entry.maxTokens !== undefined ? { maxTokens: entry.maxTokens } : {}),
      input: inputModalitiesOf(entry) ?? ['text'],
      reasoningEfforts: ladderToReasoningEfforts(entry.effortLevels),
    })),
  }
  const defaultKey = routeDefaultEffortKey(catalog, options.defaultReasoningEffort)
  if (defaultKey !== undefined) profile.reasoning = defaultKey
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
      defaultReasoningEffort: opts.defaultReasoningEffort ?? DEFAULT_REASONING_EFFORT,
    }
  }

  /** Validate and persist gateway configuration through the Host settings seam. */
  async setGateway(params) {
    let baseURL = typeof params === 'string' ? params : params?.baseURL
    const apiFormat = typeof params === 'object' && params?.apiFormat ? normalizeApiFormat(params.apiFormat) : undefined
    const defaultReasoningEffort = typeof params === 'object' && params?.defaultReasoningEffort !== undefined
      ? (typeof params.defaultReasoningEffort === 'string' ? params.defaultReasoningEffort.trim() : '')
      : undefined

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
      effortLevels: [],
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
      })
      if (!res.ok) throw await errorFromResponse(res)
      const body = await res.json()
      const models = (body.data ?? []).filter((m) => typeof m?.id === 'string').map(AiProxyApi.normalizeModel)
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
    })
    if (res.status === 401 && credential.source === "oauth") {
      try {
        credential = await this.resolveCredential({ force: true })
        res = await fetch(modelsUrl, {
          headers: { authorization: "Bearer " + credential.token },
        })
      } catch {}
    }
    if (!res.ok) throw await errorFromResponse(res)
    const body = await res.json()
    const models = (body.data ?? []).filter((m) => typeof m?.id === "string").map(AiProxyApi.normalizeModel)
    this.modelsCache = { at: Date.now(), models }
    if (typeof this.onModelsRefreshed === "function") {
      try {
        this.onModelsRefreshed()
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
        const stored = await this.credentials.resolve(EXPIRY_REF)
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

  /** Startup probe: refresh when needed and prime the model catalog. */
  async bootstrap() {
    try {
      await this.resolveCredential()
      await this.catalog()
    } catch (error) {
      if (error.code === 'MISSING_CREDENTIAL') return
      this.ctx.logger.error('dsh-ai-proxy: 启动时刷新令牌失败: ' + error.message)
    } finally {
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

  /** Persist one provider profile; only our own dict key is written. */
  async sync(profile) {
    if (this.available === false) {
      throw new LlmError('宿主未挂载 llm-pi-ai 适配器,无法材料化 AI Proxy 路由', 'UNSUPPORTED')
    }
    await this.ctx.settings.mutate(PI_AI_NS, [
      { op: 'set', path: ['providers', PROVIDER], value: profile },
    ])
  }

  /** Remove the materialized route, e.g. after the last credential is gone. */
  async remove() {
    if (this.available === false) return
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
})

/** Plugin config; doubles as the ai-proxy settings-section shape. */
export const Config = z.object({
  baseURL: z.string().default(DEFAULT_BASE_URL),
  apiFormat: z.union(API_FORMATS).default(DEFAULT_API_FORMAT),
  clientId: z.string().default(DEFAULT_CLIENT_ID),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  defaultReasoningEffort: z.string().default(DEFAULT_REASONING_EFFORT),
  maxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
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
  return {
    baseURL: (raw.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiFormat: normalizeApiFormat(raw.apiFormat),
    clientId,
    apiKeyEnv: raw.apiKeyEnv ?? DEFAULT_API_KEY_ENV,
    defaultReasoningEffort: raw.defaultReasoningEffort ?? DEFAULT_REASONING_EFFORT,
    maxTokens,
    defaultContextWindow,
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
  const materializer = new RouteMaterializer(ctx)

  const syncError = (error) => {
    ctx.logger.warn(name + ': 材料化 llm-pi-ai 路由失败: ' + (error instanceof Error ? error.message : String(error)))
  }

  /** The materialized route as it currently stands in the settings document. */
  const currentRoute = () => {
    try {
      return ctx.settings.get(PI_AI_NS)?.providers?.[PROVIDER]
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

  api.onModelsRefreshed = () => { void maybeSync().catch(syncError) }
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

  const scope = ctx.settings.register(NS, Config, { base: config ?? {} })
  current = () => scope.get()

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

  // Hook ctx.llm.resolveModelInfo and ctx.llm.resolveCallConfig so that switching models
  // accurately picks that concrete model's own highest (or lowest) available reasoning effort
  // in both the browser UI catalog (ModelSelect) and the execution call resolution.
  if (ctx.llm) {
    if (typeof ctx.llm.resolveModelInfo === 'function') {
      const origResolveModelInfo = ctx.llm.resolveModelInfo.bind(ctx.llm)
      ctx.llm.resolveModelInfo = async function (provider, model, signal) {
        const info = await origResolveModelInfo(provider, model, signal)
        if (provider === PROVIDER && info?.reasoning?.efforts?.length) {
          const opts = options()
          const pref = opts.defaultReasoningEffort ?? DEFAULT_REASONING_EFFORT
          if (pref !== 'off' && pref !== 'none') {
            const rungs = info.reasoning.efforts.map((e) => e.id)
            const target = resolveDefaultEffort(rungs, pref)
            if (target !== undefined) {
              return {
                ...info,
                reasoning: {
                  ...info.reasoning,
                  defaultEffort: ReasoningEffortId(target),
                },
              }
            }
          }
        }
        return info
      }
    }

    if (typeof ctx.llm.resolveCallConfig === 'function') {
      const origResolveCallConfig = ctx.llm.resolveCallConfig.bind(ctx.llm)
      ctx.llm.resolveCallConfig = async function (config, signal) {
        if (config?.provider === PROVIDER && config.reasoningEffort === undefined) {
          const opts = options()
          const pref = opts.defaultReasoningEffort ?? DEFAULT_REASONING_EFFORT
          if (pref !== 'off' && pref !== 'none') {
            try {
              const info = await ctx.llm.resolveModelInfo(config.provider, config.model, signal)
              if (info?.reasoning?.efforts?.length) {
                const rungs = info.reasoning.efforts.map((e) => e.id)
                const target = resolveDefaultEffort(rungs, pref)
                if (target !== undefined) {
                  config = { ...config, reasoningEffort: ReasoningEffortId(target) }
                }
              }
            } catch {}
          }
        }
        return origResolveCallConfig(config, signal)
      }
    }
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
  buildProviderProfile, piAiProtocolFor, piAiBaseURL,
  ladderToReasoningEfforts, routeDefaultEffortKey,
  effortName, resolveDefaultEffort, inputModalitiesOf,
  httpErrorCode, errorFromResponse, handleAuthRpc,
  pkcePair, base64url,
  discoverEndpoints, tokenRequest, startCallbackListener,
  normalizeApiFormat, resolveModelsEndpoint,
  API_FORMAT_CHAT_COMPLETIONS, API_FORMAT_ANTHROPIC_MESSAGES, API_FORMAT_RESPONSES, API_FORMATS, DEFAULT_API_FORMAT,
  PI_AI_PROTOCOL_CHAT_COMPLETIONS, PI_AI_PROTOCOL_RESPONSES, PI_AI_PROTOCOL_ANTHROPIC,
}
