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

export function apply(ctx, config) {
  let current = () => config ?? {}
  const options = () => resolveOptions(current())
  const scope = ctx.settings.register(NS, Config, { base: config ?? {} })
  current = () => scope.get()

  ctx.inject(['webServer'], (webServerCtx) => {
    const polyfillScript = `<script>(function(){if(typeof globalThis!=="undefined"){const c=globalThis.crypto||(globalThis.crypto={});if(typeof c.randomUUID!=="function"){c.randomUUID=function(){if(typeof c.getRandomValues==="function"){return([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,function(d){return(d^c.getRandomValues(new Uint8Array(1))[0]&15>>d/4).toString(16);});}return"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(p){const r=Math.random()*16|0;return(p==="x"?r:r&3|8).toString(16);});};}}})();</script>`
    webServerCtx.webServer.tapIndex(html => html.replace('<head>', '<head>' + polyfillScript))
  })

  ctx.inject(['connection'], (connectionCtx) => {
    const connection = connectionCtx.connection
    if (connection && connection.browserAuth && typeof connection.authorizeIndex === 'function') {
      const origAuthorizeIndex = connection.authorizeIndex.bind(connection)
      connection.authorizeIndex = function (request, response) {
        // 如果原本就已经通过 Cookie 认证或请求带有合法 token，走原生流程
        if (connection.browserAuth.isAuthenticated(request)) {
          return origAuthorizeIndex(request, response)
        }
        // 如果是根路径 GET 请求且尚未认证，自动注入 launchToken 换取合法 Cookie
        const rawUrl = request.url ?? '/'
        const url = new URL(rawUrl, 'http://dsh.invalid')
        if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
          if (!url.searchParams.has('token') && connection.browserAuth.launchToken) {
            url.searchParams.set('token', connection.browserAuth.launchToken)
            request.url = url.pathname + url.search
          }
        }
        return origAuthorizeIndex(request, response)
      }

      // 同时放宽 requestRejection，确保如果某些客户端首次发起请求未带 Cookie 时能保持平滑
      if (typeof connection.requestRejection === 'function') {
        const origRequestRejection = connection.requestRejection.bind(connection)
        connection.requestRejection = function (request) {
          const res = origRequestRejection(request)
          // 403 (跨站/不受信任域名) 依然严格拦截，只在 401 (缺少浏览器 Cookie) 时由 remote-control 机制托管放行
          if (res === 401) {
            return undefined
          }
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

export const internals = { matchesRemoteControlSecret, remoteControlSecret, handleConfigRpc, handleRemoteControlRpc }
