/**
 * Token-authenticated remote-control bridge for DeepSeek Harness.
 *
 * The public channel exposes only a fixed privileged-method allowlist. Local
 * configuration uses a separate loopback-only channel, so a remote caller can
 * never enable access or replace the shared secret.
 *
 * @module dsh-remote-control
 */
import z from '@deepseek-ai/schemastery'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

export const name = 'remote-control'
export const inject = ['credentials', 'settings', 'connection']
export const NS = 'remote-control'
export const REMOTE_CONTROL_SECRET_REF = 'DSH_REMOTE_CONTROL_SECRET'
export const REMOTE_CONTROL_RPC_CHANNEL = '/dsh-remote-control'
export const REMOTE_CONTROL_RPC_ALIASES = ['/ai-proxy-remote-control']
export const CONFIG_RPC_CHANNEL = '/dsh-remote-control-config'
export const REMOTE_CONTROL_SESSION_PATH = '/dsh-remote-control/session'
/** Cap for the handshake JSON body: one shared secret plus envelope slack. */
export const SESSION_BODY_MAX_BYTES = 8192

export const Config = z.object({
  enabled: z.boolean().default(false),
  secret: z.string().role('secret').default(''),
})

export function resolveOptions(raw = {}) {
  const enabled = raw.enabled ?? false
  const secret = raw.secret ?? ''
  if (typeof enabled !== 'boolean') throw new Error(name + ': enabled must be a boolean')
  if (typeof secret !== 'string') throw new Error(name + ': secret must be a string')
  return { enabled, secret }
}

const METHODS = {
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
  'llm.providers': (api, request) => api.llm.providers(request),
  'llm.models': (api, request) => api.llm.models(request),
  'llm.discoverModels': (api, request) => api.llm.discoverModels(request),
}

function errorResult(message, code = 'bad-request') {
  return {
    ok: false,
    error: {
      code,
      message,
      details: code === 'bad-request' ? { issues: [{ code: 'custom', path: [], message }] } : {},
    },
  }
}

export function matchesRemoteControlSecret(expected, presented) {
  if (typeof expected !== 'string' || expected.length === 0 || typeof presented !== 'string') return false
  const left = Buffer.from(expected)
  const right = Buffer.from(presented)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function remoteControlSecret(ctx, options) {
  const stored = await ctx.credentials.resolve(credentialRef(REMOTE_CONTROL_SECRET_REF))
  return stored?.value || process.env[REMOTE_CONTROL_SECRET_REF] || options().secret || undefined
}

async function status(ctx, options, token) {
  const expected = await remoteControlSecret(ctx, options)
  return {
    enabled: options().enabled,
    secretConfigured: Boolean(expected),
    authenticated: options().enabled && matchesRemoteControlSecret(expected, token),
  }
}

export async function handleConfigRpc(ctx, options, method, payload) {
  const keys = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? Reflect.ownKeys(payload)
    : null
  if (keys === null) return errorResult('Remote Control configuration requests must carry an object')
  try {
    if (method === 'status') {
      if (keys.length !== 0) return errorResult('Remote Control status requests must carry an empty object')
      const value = await status(ctx, options, '')
      return { ok: true, value: { enabled: value.enabled, secretConfigured: value.secretConfigured } }
    }
    if (method === 'setEnabled') {
      if (keys.length !== 1 || !Object.hasOwn(payload, 'enabled') || typeof payload.enabled !== 'boolean') {
        return errorResult('Remote Control setEnabled requests must carry exactly one boolean enabled field')
      }
      await ctx.settings.mutate(NS, [{ op: 'set', path: ['enabled'], value: payload.enabled }])
      const value = await status(ctx, options, '')
      return { ok: true, value: { enabled: value.enabled, secretConfigured: value.secretConfigured } }
    }
    if (method === 'setSecret') {
      if (keys.length !== 1 || !Object.hasOwn(payload, 'secret') || typeof payload.secret !== 'string') {
        return errorResult('Remote Control setSecret requests must carry exactly one string secret field')
      }
      const secret = payload.secret.trim()
      if (secret) await ctx.credentials.set(REMOTE_CONTROL_SECRET_REF, secret)
      else await ctx.credentials.unset(REMOTE_CONTROL_SECRET_REF)
      const value = await status(ctx, options, '')
      return { ok: true, value: { enabled: value.enabled, secretConfigured: value.secretConfigured } }
    }
    return errorResult('Unknown Remote Control configuration method: ' + method)
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error), 'internal')
  }
}

export async function handleRemoteControlRpc(ctx, options, method, payload, signal) {
  const keys = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? Reflect.ownKeys(payload)
    : null
  if (keys === null || !Object.hasOwn(payload, 'token')) return errorResult('远程控制认证失败')
  try {
    const state = await status(ctx, options, payload.token)
    if (method === 'status') {
      if (keys.length !== 1) return errorResult('Remote Control status requests must carry exactly one token field')
      return { ok: true, value: state }
    }
    if (!state.authenticated) return errorResult('远程控制认证失败')
    if (method !== 'call' || keys.length !== 3 || !Object.hasOwn(payload, 'method') || !Object.hasOwn(payload, 'payload')) {
      return errorResult('Remote Control requests must be status or a token-authenticated call')
    }
    if (typeof payload.method !== 'string' || !Object.hasOwn(METHODS, payload.method)) {
      return errorResult('Remote Control method is not allowed: ' + String(payload.method))
    }
    const api = ctx.get('apiProxy')
    if (api === undefined) return errorResult('Remote Control API is unavailable')
    const response = await METHODS[payload.method](api, { rpcId: randomUUID(), payload: payload.payload }, signal)
    return response.result
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error), 'internal')
  }
}

function sessionFailure(status, code, message, headers) {
  const result = { status, body: JSON.stringify({ ok: false, error: { code, message, details: {} } }) }
  if (headers !== undefined) result.headers = headers
  return result
}

/** Success body of a session handshake: whether this call minted a new session. */
function sessionOpened(minted) {
  return JSON.stringify({ ok: true, minted })
}

/** The single `token` field a session handshake carries; undefined for any other shape. */
function sessionToken(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined
  if (Reflect.ownKeys(body).length !== 1 || !Object.hasOwn(body, 'token')) return undefined
  return typeof body.token === 'string' ? body.token : undefined
}

/** Read one bounded JSON handshake body; undefined when absent, oversized, or not JSON. */
async function readSessionBody(request) {
  const chunks = []
  let size = 0
  try {
    for await (const chunk of request) {
      size += chunk.length
      if (size > SESSION_BODY_MAX_BYTES) return undefined
      chunks.push(chunk)
    }
  } catch {
    return undefined
  }
  if (size === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

/** The `dsh-auth-*` browser-session cookie this request carried, when it sent one. */
function sentSessionCookieName(request) {
  const raw = request?.headers?.cookie
  if (typeof raw !== 'string') return undefined
  for (const segment of raw.split(';')) {
    const at = segment.indexOf('=')
    if (at === -1) continue
    const cookie = segment.slice(0, at).trim()
    if (cookie.startsWith('dsh-auth-')) return cookie
  }
  return undefined
}

/**
 * Capture the browser-session cookie Connection would set for the caller's
 * authority by running the native process-token exchange against a synthetic
 * request. Connection owns cookie naming, signing, attributes and authority
 * binding, so the plugin relays the header it produces instead of
 * re-implementing the session format.
 * @param connection - Host Connection service holding `browserAuth`.
 * @param request - caller request carrying the target `host` header.
 * @returns the `Set-Cookie` value, `''` when the caller already holds a
 * session, or undefined when this build exposes no process launch token.
 */
export function captureSessionCookie(connection, request) {
  const launchToken = connection?.browserAuth?.launchToken
  if (typeof launchToken !== 'string' || launchToken.length === 0) return undefined
  const authorize = connection?.authorizeIndex
  if (typeof authorize !== 'function') return undefined
  const exchange = new URL('/', 'http://dsh.invalid')
  exchange.searchParams.set('token', launchToken)
  let captured
  const capture = {
    writeHead(status, headers) { captured = { status, headers: headers ?? {} } },
    end() {},
  }
  const handled = authorize.call(connection, {
    method: 'GET',
    url: exchange.pathname + exchange.search,
    headers: request?.headers ?? {},
  }, capture)
  if (handled === true) return ''
  if (captured?.status !== 303) return undefined
  const cookie = captured.headers['set-cookie']
  return typeof cookie === 'string' && cookie.length > 0 ? cookie : ''
}

/**
 * Resolve one session handshake: mint the official browser session for a caller
 * that proved the shared secret, or drop the session it minted earlier.
 *
 * Remote pages authenticate through the plugin gate, but every `/api` request
 * (including the `remote.mux` stream that drives `connection.state`) stays
 * fenced by Connection's process-token cookie. Without this exchange a remote
 * browser unlocks the gate and then sits in `connecting` forever.
 * @param ctx - context carrying `connection` (and `credentials`).
 * @param options - resolved plugin options.
 * @param request - Node request facts (`method`, `headers`).
 * @param body - parsed JSON handshake body.
 * @returns status, optional headers and optional JSON body for the route.
 */
export async function handleSessionRequest(ctx, options, request, body) {
  const connection = ctx.connection
  const method = request?.method
  if (method !== 'POST' && method !== 'DELETE') {
    return sessionFailure(405, 'method-not-allowed', 'Remote Control session requests must be POST or DELETE', {
      allow: 'POST, DELETE',
    })
  }
  // 403 (cross-site or untrusted authority) stays Connection's call: a host we
  // do not serve must not learn whether the presented secret matches.
  if (typeof connection?.requestRejection === 'function' && connection.requestRejection(request) === 403) {
    return sessionFailure(403, 'forbidden', 'Remote Control session requests require a trusted host')
  }
  if (options().enabled !== true) return sessionFailure(403, 'forbidden', '远程控制未在宿主机启用')
  const expected = await remoteControlSecret(ctx, options)
  if (!matchesRemoteControlSecret(expected, sessionToken(body))) {
    return sessionFailure(401, 'unauthorized', '远程控制认证失败')
  }
  if (method === 'DELETE') {
    const name = sentSessionCookieName(request)
    if (name === undefined) return { status: 204 }
    return {
      status: 204,
      headers: {
        'set-cookie': `${name}=; Path=/; Max-Age=0; Expires=${new Date(0).toUTCString()}; HttpOnly; SameSite=Strict`,
      },
    }
  }
  if (typeof connection?.browserAuth?.isAuthenticated === 'function' && connection.browserAuth.isAuthenticated(request)) {
    return { status: 200, body: sessionOpened(false) }
  }
  const cookie = captureSessionCookie(connection, request)
  if (cookie === undefined) {
    return sessionFailure(503, 'unavailable', 'Host 无法签发浏览器会话，请改用 dsh web 打印的带 token 链接访问')
  }
  if (cookie === '') return { status: 200, body: sessionOpened(false) }
  return { status: 200, headers: { 'set-cookie': cookie }, body: sessionOpened(true) }
}

/** Own one session handshake HTTP exchange on the browser carrier. */
export async function serveSessionRoute(ctx, options, request, response) {
  const body = await readSessionBody(request)
  const result = await handleSessionRequest(ctx, options, request, body)
  const headers = { 'cache-control': 'no-store', ...result.headers }
  if (result.body === undefined) {
    response.writeHead(result.status, headers)
    response.end()
    return
  }
  response.writeHead(result.status, { ...headers, 'content-type': 'application/json; charset=utf-8' })
  response.end(result.body)
}

function requestHeader(request, name) {
  const headers = request?.headers
  if (headers === undefined || headers === null) return undefined
  if (typeof headers.get === 'function') {
    const value = headers.get(name)
    return typeof value === 'string' ? value : undefined
  }
  const value = headers[name.toLowerCase()] ?? headers[name]
  return typeof value === 'string' ? value : undefined
}

/** Whether one Host header names the local loopback authority. */
export function isLoopbackHostHeader(host) {
  if (typeof host !== 'string' || host.length === 0) return false
  let hostname
  try {
    hostname = new URL('http://' + host).hostname
  } catch {
    return false
  }
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function requestPathname(request) {
  try {
    return new URL(request?.url ?? '/', 'http://dsh.invalid').pathname
  } catch {
    return '/'
  }
}

/** Remote-control RPC prefixes that authenticate via payload token, not the browser cookie. */
export function isRemoteControlRpcPath(pathname) {
  if (typeof pathname !== 'string' || pathname.length === 0) return false
  for (const channel of [REMOTE_CONTROL_RPC_CHANNEL, ...REMOTE_CONTROL_RPC_ALIASES]) {
    if (pathname === channel || pathname.startsWith(channel + '/')) return true
  }
  return false
}

/**
 * Whether a 401 from Connection's browser-session gate may be skipped.
 * Only the remote-control channels qualify, and only while remote access is enabled.
 */
export function shouldBypassBrowserAuthRejection(request, enabled) {
  return enabled === true && isRemoteControlRpcPath(requestPathname(request))
}

/**
 * Serve index.html without a 303 token exchange so the Unlock Screen can load.
 * Native `/?token=` handling is left untouched; disabled installs keep the stock 401.
 *
 * Only non-loopback hosts qualify: a loopback browser gets no lock screen, so
 * serving it the SPA would leave a workspace that can never reach `/api`. The
 * stock 401 points that caller at the `?token=` URL `dsh web` prints instead.
 */
export function shouldServeUnauthenticatedIndex(request, enabled, isAuthenticated) {
  if (enabled !== true || isAuthenticated === true) return false
  const method = request?.method
  if (method !== 'GET' && method !== 'HEAD') return false
  let url
  try {
    url = new URL(request?.url ?? '/', 'http://dsh.invalid')
  } catch {
    return false
  }
  if (url.searchParams.has('token')) return false
  if (url.pathname !== '/' && url.pathname !== '/index.html') return false
  return !isLoopbackHostHeader(requestHeader(request, 'host'))
}

export function apply(ctx, config) {
  let current = () => config ?? {}
  const options = () => resolveOptions(current())
  const scope = ctx.settings.register(NS, Config, { base: config ?? {} })
  current = () => scope.get()

  ctx.inject(['webServer'], (webServerCtx) => {
    const polyfillScript = `<script>(function(){if(typeof globalThis!=="undefined"){const c=globalThis.crypto||(globalThis.crypto={});if(typeof c.randomUUID!=="function"){c.randomUUID=function(){if(typeof c.getRandomValues==="function"){return([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,function(d){return(d^c.getRandomValues(new Uint8Array(1))[0]&15>>d/4).toString(16);});}return"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(p){const r=Math.random()*16|0;return(p==="x"?r:r&3|8).toString(16);});};}}})();</script>`
    webServerCtx.webServer.tapIndex(html => html.replace('<head>', '<head>' + polyfillScript))
  })

  ctx.inject(['connection', 'webServer'], (sessionCtx) => {
    sessionCtx.effect(() => sessionCtx.webServer.register({
      kind: 'exact',
      path: REMOTE_CONTROL_SESSION_PATH,
      handler: (request, response) => serveSessionRoute(sessionCtx, options, request, response),
    }), 'remote-control: browser session handshake')
  })

  ctx.inject(['connection'], (connectionCtx) => {
    const connection = connectionCtx.connection
    if (connection && connection.browserAuth && typeof connection.authorizeIndex === 'function') {
      const origAuthorizeIndex = connection.authorizeIndex.bind(connection)
      connection.authorizeIndex = function (request, response) {
        const enabled = options().enabled
        const authenticated = connection.browserAuth.isAuthenticated(request)
        if (shouldServeUnauthenticatedIndex(request, enabled, authenticated)) return true
        return origAuthorizeIndex(request, response)
      }

      if (typeof connection.requestRejection === 'function') {
        const origRequestRejection = connection.requestRejection.bind(connection)
        connection.requestRejection = function (request) {
          const res = origRequestRejection(request)
          if (res === 401 && shouldBypassBrowserAuthRejection(request, options().enabled)) return undefined
          return res
        }
      }
    }

    connectionCtx.connection.rpc.handle(
      CONFIG_RPC_CHANNEL,
      (method, payload) => handleConfigRpc(connectionCtx, options, method, payload),
      { authority: 'loopback' },
    )
    for (const channel of [REMOTE_CONTROL_RPC_CHANNEL, ...REMOTE_CONTROL_RPC_ALIASES]) {
      connectionCtx.connection.rpc.handle(
        channel,
        (method, payload, signal) => handleRemoteControlRpc(connectionCtx, options, method, payload, signal),
        { authority: 'trusted-host' },
      )
    }
  })
}

export const internals = {
  matchesRemoteControlSecret,
  remoteControlSecret,
  handleConfigRpc,
  handleRemoteControlRpc,
  captureSessionCookie,
  handleSessionRequest,
  serveSessionRoute,
  isRemoteControlRpcPath,
  isLoopbackHostHeader,
  shouldBypassBrowserAuthRejection,
  shouldServeUnauthenticatedIndex,
}
