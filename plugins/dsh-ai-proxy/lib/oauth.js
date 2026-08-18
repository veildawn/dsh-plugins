/**
 * OAuth 2.0 authorization-code + PKCE implementation for the AI Proxy public
 * client. The module owns the complete token lifecycle behind a small
 * interface: status, resolve, login and logout.
 *
 * @module dsh-ai-proxy/oauth
 */
import { LlmError } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'

/** Credential refs are stable Host-owned storage locations, never settings. */
export const ACCESS_REF = credentialRef('AIPROXY_ACCESS_TOKEN')
export const REFRESH_REF = credentialRef('AIPROXY_REFRESH_TOKEN')
export const EXPIRY_REF = credentialRef('AIPROXY_TOKEN_EXPIRY')

/** Matches the gateway's OAuth client entity invariant. */
export const CLIENT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/

const OAUTH_SCOPE = 'api'
const LOGIN_TIMEOUT_MS = 300000
/** Refresh this many ms before the stored expiry to stay ahead of rotation. */
const EXPIRY_MARGIN_MS = 30000

/** Encode bytes using the unpadded URL-safe base64 alphabet. */
export function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url')
}

/** Create one RFC 7636 verifier/challenge pair and an OAuth state nonce. */
export function pkcePair() {
  const verifier = base64url(randomBytes(48))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const state = base64url(randomBytes(24))
  return { verifier, challenge, state }
}

function absolutize(endpoint, base) {
  try {
    return new URL(endpoint, base).toString()
  } catch {
    return base + '/' + endpoint.replace(/^\//, '')
  }
}

/** Resolve the gateway's OAuth endpoints via RFC 8414 discovery with fallbacks. */
export async function discoverEndpoints(baseURL, signal) {
  const base = baseURL.replace(/\/+$/, '')
  let authorizationEndpoint = base + '/oauth/authorize'
  let tokenEndpoint = base + '/oauth/token'
  let revocationEndpoint = base + '/oauth/revoke'
  try {
    const res = await fetch(base + '/.well-known/oauth-authorization-server', { signal })
    if (res.ok) {
      const meta = await res.json()
      if (typeof meta.authorization_endpoint === 'string') authorizationEndpoint = absolutize(meta.authorization_endpoint, base)
      if (typeof meta.token_endpoint === 'string') tokenEndpoint = absolutize(meta.token_endpoint, base)
      if (typeof meta.revocation_endpoint === 'string') revocationEndpoint = absolutize(meta.revocation_endpoint, base)
    }
  } catch (error) {
    if (signal?.aborted) throw error
    // Discovery is optional; conventional paths remain usable when it is absent.
  }
  return { authorizationEndpoint, tokenEndpoint, revocationEndpoint }
}

/**
 * Bind a loopback listener for exactly one OAuth redirect. The operating
 * system chooses the port as required for native public clients.
 */
export function startCallbackListener() {
  return new Promise((resolve, reject) => {
    let settle
    const callback = new Promise((res, rej) => { settle = { res, rej } })
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404)
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><meta charset="utf-8"><title>AI Proxy</title>'
        + '<h2>授权完成</h2><p>可以关闭本页并返回 DeepSeek Harness。</p>')
      server.close()
      const params = url.searchParams
      settle.res({
        code: params.get('code'),
        state: params.get('state'),
        error: params.get('error'),
        errorDescription: params.get('error_description'),
      })
    })
    server.on('error', (error) => {
      settle.rej(error)
      reject(error)
    })
    server.listen(0, '127.0.0.1', () => {
      resolve({
        redirectUri: 'http://127.0.0.1:' + server.address().port + '/callback',
        close: () => server.close(),
        callback,
      })
    })
  })
}

/** Exchange an authorization code or refresh token at the token endpoint. */
export async function tokenRequest(endpoint, params, signal) {
  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new LlmError('无法连接网关令牌端点 ' + endpoint, 'TRANSPORT', { cause: error })
  }
  let body = null
  try {
    body = await response.json()
  } catch {
    // A non-JSON error is represented by its HTTP status below.
  }
  if (!response.ok) {
    const err = body?.error_description ?? body?.error ?? ('HTTP ' + response.status)
    throw new LlmError('令牌端点拒绝请求: ' + err, body?.error === 'invalid_grant' ? 'AUTH' : 'INVALID_REQUEST', { status: response.status })
  }
  if (!body?.access_token) throw new LlmError('令牌端点未返回 access_token', 'MALFORMED_RESPONSE', { status: response.status })
  return body
}

async function withTimeout(promise, ms, onTimeout, message) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      onTimeout()
      reject(new LlmError(message, 'TIMEOUT'))
    }, ms)
    timer.unref?.()
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Host-side OAuth module. Callers never handle PKCE values, endpoints,
 * refresh rotation or credential-store ordering themselves.
 */
export class OAuthSession {
  constructor({ credentials, options, logger, onTokensChanged }) {
    this.credentials = credentials
    this.options = options
    this.logger = logger
    this.onTokensChanged = onTokensChanged ?? (() => {})
    this.loginFlow = null
    this.loginStartInFlight = null
    this.loginError = null
    this.refreshInFlight = null
  }

  /** Derive display state from the credential store instead of persisted UI state. */
  async status() {
    const [access, refresh, expiryRaw] = await Promise.all([
      this.credentials.resolve(ACCESS_REF),
      this.credentials.resolve(REFRESH_REF),
      this.credentials.resolve(EXPIRY_REF),
    ])
    const expiry = Number(expiryRaw?.value ?? Number.NaN)
    const accessFresh = Boolean(access?.value) && Number.isFinite(expiry) && Date.now() < expiry
    if (accessFresh || refresh?.value) {
      return { state: 'signed-in', message: '已登录 · OAuth 凭据可用' }
    }
    if (this.loginFlow) return this.authorizingStatus()
    if (this.loginError) return { state: 'error', message: '登录失败: ' + this.loginError.message }
    return { state: 'signed-out', message: '未登录 · Not signed in' }
  }

  /**
   * Resolve a usable OAuth access token, refreshing with single-flight
   * rotation when required. Absence is returned for the caller's fallback.
   */
  async resolve({ force } = {}) {
    const access = await this.credentials.resolve(ACCESS_REF)
    const expiryRaw = await this.credentials.resolve(EXPIRY_REF)
    const expiry = Number(expiryRaw?.value ?? Number.NaN)
    if (!force && access?.value && Number.isFinite(expiry) && Date.now() < expiry) {
      return access.value
    }
    const refresh = await this.credentials.resolve(REFRESH_REF)
    if (!refresh?.value) return undefined
    try {
      return await this.refreshTokens()
    } catch (error) {
      if (error.code === 'AUTH') {
        await this.clearTokens()
        throw new LlmError('OAuth 授权已失效,请重新登录', 'AUTH', { cause: error })
      }
      if (access?.value) return access.value
      throw error
    }
  }

  /** Prepare one interactive authorization and return its URL without blocking RPC. */
  async login() {
    if (!this.loginFlow && !this.loginStartInFlight) {
      this.loginError = null
      this.loginStartInFlight = this.startLogin()
        .finally(() => { this.loginStartInFlight = null })
    }
    if (this.loginStartInFlight) await this.loginStartInFlight
    return this.loginFlow ? this.authorizingStatus() : this.status()
  }

  authorizingStatus() {
    return {
      state: 'authorizing',
      message: '等待浏览器授权中…',
      authorizeUrl: this.loginFlow?.authorizeUrl,
    }
  }

  async startLogin() {
    const opts = this.options()
    const { authorizationEndpoint, tokenEndpoint } = await discoverEndpoints(opts.baseURL)
    const { verifier, challenge, state } = pkcePair()
    const listener = await startCallbackListener()
    const redirectUri = listener.redirectUri
    const authorize = new URL(authorizationEndpoint)
    authorize.searchParams.set('client_id', opts.clientId)
    authorize.searchParams.set('response_type', 'code')
    authorize.searchParams.set('redirect_uri', redirectUri)
    authorize.searchParams.set('scope', OAUTH_SCOPE)
    authorize.searchParams.set('state', state)
    authorize.searchParams.set('code_challenge', challenge)
    authorize.searchParams.set('code_challenge_method', 'S256')

    const flow = {
      state,
      verifier,
      redirectUri,
      tokenEndpoint,
      listener,
      authorizeUrl: authorize.toString(),
    }
    this.loginFlow = flow
    void this.finishLoopback(flow).catch((error) => this.failLogin(flow, error))
  }

  async finishLoopback(flow) {
    let callback
    try {
      callback = await withTimeout(
        flow.listener.callback,
        LOGIN_TIMEOUT_MS,
        () => flow.listener.close(),
        'OAuth 授权超时(5 分钟),请重试',
      )
    } finally {
      flow.listener.close()
    }
    if (callback.error) {
      throw new LlmError('授权被拒绝: ' + (callback.errorDescription ?? callback.error), 'AUTH')
    }
    if (callback.state !== flow.state || !callback.code) {
      throw new LlmError('授权回调校验失败(state 不匹配或缺少授权码)', 'INVALID_REQUEST')
    }
    await this.exchangeLogin(flow, callback.code)
  }

  async exchangeLogin(flow, code) {
    if (flow.exchange) return flow.exchange
    flow.exchange = this.doExchangeLogin(flow, code)
    return flow.exchange
  }

  async doExchangeLogin(flow, code) {
    try {
      const body = await tokenRequest(flow.tokenEndpoint, {
        grant_type: 'authorization_code',
        client_id: this.options().clientId,
        code,
        code_verifier: flow.verifier,
        redirect_uri: flow.redirectUri,
      })
      await this.storeTokens(body)
      this.clearLogin(flow)
      return body
    } catch (error) {
      this.failLogin(flow, error)
      throw error
    }
  }

  clearLogin(flow) {
    if (this.loginFlow !== flow) return
    clearTimeout(flow.timer)
    flow.listener?.close()
    this.loginFlow = null
    this.loginError = null
  }

  failLogin(flow, error) {
    if (this.loginFlow !== flow) return
    clearTimeout(flow.timer)
    flow.listener?.close()
    this.loginFlow = null
    this.loginError = error instanceof Error ? error : new Error(String(error))
    this.logger.warn('dsh-ai-proxy: OAuth 登录失败: ' + this.loginError.message)
  }

  /** Revoke the current grant best-effort, then always clear local tokens. */
  async logout() {
    if (this.loginFlow) this.clearLogin(this.loginFlow)
    this.loginError = null
    const opts = this.options()
    const { revocationEndpoint } = await discoverEndpoints(opts.baseURL)
    const [access, refresh] = await Promise.all([
      this.credentials.resolve(ACCESS_REF),
      this.credentials.resolve(REFRESH_REF),
    ])
    const token = refresh?.value ?? access?.value
    if (token) {
      try {
        await fetch(revocationEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token, client_id: opts.clientId }),
        })
      } catch (error) {
        this.logger.warn('dsh-ai-proxy: 吊销令牌失败(忽略):', error)
      }
    }
    await this.clearTokens()
    return { state: 'signed-out', message: '已退出登录' }
  }

  refreshTokens() {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.doRefresh().finally(() => { this.refreshInFlight = null })
    }
    return this.refreshInFlight
  }

  async doRefresh() {
    const opts = this.options()
    const { tokenEndpoint } = await discoverEndpoints(opts.baseURL)
    const refresh = await this.credentials.resolve(REFRESH_REF)
    if (!refresh?.value) throw new LlmError('没有可用的 refresh token', 'MISSING_CREDENTIAL')
    const body = await tokenRequest(tokenEndpoint, {
      grant_type: 'refresh_token',
      client_id: opts.clientId,
      refresh_token: refresh.value,
    })
    await this.storeTokens(body)
    return body.access_token
  }

  async storeTokens(body) {
    await this.credentials.set(ACCESS_REF, body.access_token)
    if (body.refresh_token) await this.credentials.set(REFRESH_REF, body.refresh_token)
    const ttlMs = (Number(body.expires_in) || 3600) * 1000
    await this.credentials.set(EXPIRY_REF, String(Date.now() + ttlMs - EXPIRY_MARGIN_MS))
    this.onTokensChanged()
  }

  async clearTokens() {
    await this.credentials.unset(ACCESS_REF)
    await this.credentials.unset(REFRESH_REF)
    await this.credentials.unset(EXPIRY_REF)
    this.onTokensChanged()
  }
}
