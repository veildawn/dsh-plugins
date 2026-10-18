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
import { networkInterfaces } from 'node:os'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { DEFAULT_LAN_GATEWAY_PORT, LAN_ORIGIN_HEADER, startLanGateway } from './lan-gateway.js'

export const name = 'remote-control'
export const inject = ['credentials', 'settings', 'connection', 'webServer']
export const NS = 'remote-control'
export const REMOTE_CONTROL_SECRET_REF = 'DSH_REMOTE_CONTROL_SECRET'
export const REMOTE_CONTROL_RPC_CHANNEL = '/dsh-remote-control'
export const REMOTE_CONTROL_RPC_ALIASES = ['/ai-proxy-remote-control']
export const CONFIG_RPC_CHANNEL = '/dsh-remote-control-config'
export const REMOTE_CONTROL_SESSION_PATH = '/dsh-remote-control/session'
/** Cap for the handshake JSON body: one shared secret plus envelope slack. */
export const SESSION_BODY_MAX_BYTES = 8192


const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

function liveField(schema) {
  return typeof schema?.volatile === 'function' ? schema.volatile() : schema
}

function isVolatileRef(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  if (typeof value.get !== 'function') return false
  return VOLATILE_WRITE in value || Object.keys(value).length === 0
}

/**
 * Plain composition layer for the legacy settings seam. `settings.register`
 * resolves the schema over its `base` itself, so the base must be raw config:
 * the resolved fiber config carries live references.
 */
function settingsBase(ctx, config) {
  return unwrapConfig(ctx.fiber?.entry?.options?.config ?? config ?? {})
}

function unwrapConfig(value, seen = new Set()) {
  if (isVolatileRef(value)) return unwrapConfig(value.get(), seen)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return value
  if (Array.isArray(value)) return value.map((item) => unwrapConfig(item, seen))
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unwrapConfig(item, seen)]))
}

function settingsNamespace(ctx, fallback) {
  if (typeof ctx.settings?.register === 'function') return fallback
  const id = ctx.fiber?.entry?.options?.id
  return typeof id === 'string' && id.length > 0 ? id : fallback
}

function openSettingsScope(ctx, ns, schema, config) {
  if (typeof ctx.settings?.register === 'function') {
    return ctx.settings.register(ns, schema, { base: settingsBase(ctx, config) })
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

export { isVolatileRef, liveField, settingsBase, unwrapConfig }

export const Config = z.object({
  enabled: liveField(z.boolean().default(false)),
  secret: liveField(z.string().role('secret').default('')),
  /* 桌面端无法改宿主绑定，这里给出对外暴露的局域网代理端口。 */
  lanGatewayPort: liveField(z.natural().min(1).max(65535).default(DEFAULT_LAN_GATEWAY_PORT)),
})

export function resolveOptions(raw = {}) {
  const enabled = raw.enabled ?? false
  const secret = raw.secret ?? ''
  const lanGatewayPort = raw.lanGatewayPort ?? DEFAULT_LAN_GATEWAY_PORT
  if (typeof enabled !== 'boolean') throw new Error(name + ': enabled must be a boolean')
  if (typeof secret !== 'string') throw new Error(name + ': secret must be a string')
  if (!Number.isInteger(lanGatewayPort) || lanGatewayPort < 1 || lanGatewayPort > 65535) {
    throw new Error(name + ': lanGatewayPort must be an integer between 1 and 65535')
  }
  return { enabled, secret, lanGatewayPort }
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

/**
 * 寻找当前运行 profile 的 cordis.patch.yml 文件路径。
 */
export function resolveProfilePatchPath(ctx) {
  const profile = ctx.get('profileContext')
  if (profile?.patchPath && existsSync(profile.patchPath)) return profile.patchPath
  if (profile?.dir) {
    const candidate = join(profile.dir, 'cordis.patch.yml')
    if (existsSync(candidate)) return candidate
  }
  const home = profile?.home || process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
  const profileName = profile?.name || 'desktop'
  const candidate = join(home, 'profiles', profileName, 'cordis.patch.yml')
  if (existsSync(candidate)) return candidate
  const webCandidate = join(home, 'profiles', 'web', 'cordis.patch.yml')
  if (existsSync(webCandidate)) return webCandidate
  return undefined
}

/**
 * 修改 YAML 内容中 webserver 的 host 与 port 配置。
 * targetPort 为 undefined 时保留原有端口行；其余情况写入给定端口。
 */
export function updateWebserverHostInPatch(yamlContent, targetHost, defaultPort = 19387, targetPort) {
  const port = Number.isInteger(targetPort) ? targetPort : defaultPort
  const lines = yamlContent.split(/\r?\n/)
  let inWebserver = false
  let inConfig = false
  let hostReplaced = false
  let portReplaced = false
  const output = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*-\s+id:\s*['"]?webserver['"]?/.test(line)) {
      inWebserver = true
      inConfig = false
      output.push(line)
      continue
    }
    if (inWebserver && /^\s*-\s+id:/.test(line)) {
      if (!hostReplaced) {
        output.push(`    host: "${targetHost}"`)
        hostReplaced = true
      }
      if (!portReplaced) {
        output.push(`    port: ${port}`)
        portReplaced = true
      }
      inWebserver = false
      inConfig = false
      output.push(line)
      continue
    }
    if (inWebserver && /^\s+config:\s*$/.test(line)) {
      inConfig = true
      output.push(line)
      continue
    }
    if (inWebserver && inConfig && /^\s+host:\s*.+$/.test(line)) {
      output.push(`    host: "${targetHost}"`)
      hostReplaced = true
      continue
    }
    if (inWebserver && inConfig && /^\s+port:\s*\d+\s*$/.test(line)) {
      output.push(`    port: ${port}`)
      portReplaced = true
      continue
    }
    output.push(line)
  }

  if (inWebserver && !hostReplaced) {
    output.push(`    host: "${targetHost}"`)
    hostReplaced = true
  }
  if (inWebserver && !portReplaced) {
    output.push(`    port: ${port}`)
    portReplaced = true
  }

  if (!hostReplaced) {
    const block = [
      `- id: webserver`,
      `  name: "@deepseek-ai/dsh-host-webserver"`,
      `  config:`,
      `    host: "${targetHost}"`,
      `    port: ${port}`,
      ``,
    ]
    return block.join('\n') + yamlContent
  }

  return output.join('\n')
}

/** 通配地址：宿主的 webserver 从 0.2.x 起在启动阶段直接拒绝，写进配置会导致整个 profile 起不来。 */
const WILDCARD_BIND_HOSTS = new Set(['0.0.0.0', '::', '[::]', '*'])
/** 回环别名，写进配置前都要换成宿主机认识的 IP 字面量。 */
const LOOPBACK_BIND_ALIASES = new Set(['localhost', '::1', '[::1]'])
const IPV4_LITERAL = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

export function isLoopbackHost(host) {
  if (typeof host !== 'string') return false
  const raw = host.trim().toLowerCase()
  if (raw === '127.0.0.1' || LOOPBACK_BIND_ALIASES.has(raw)) return true
  const match = IPV4_LITERAL.exec(raw)
  return Boolean(match) && match[1] === '127'
}

/** 宿主只接受具体 IP 字面量，域名与回环别名都必须在写入配置前落成地址。 */
function isBindableLiteral(host) {
  const match = IPV4_LITERAL.exec(host)
  if (match) return match.slice(1).every((part) => Number(part) <= 255)
  return /^[0-9a-f:]+$/i.test(host) && host.includes(':')
}

/** 未配置端口时宿主给 webserver 的默认值。 */
export const DEFAULT_SERVER_PORT = 3080

/**
 * 校验监听端口：必须是 1~65535 的整数（0 表示让系统分配，这里不接受）。
 * 端口可以自定义，桌面端也能改；只有 host 受宿主限制。
 */
export function normalizeBindPort(targetPort) {
  const port = typeof targetPort === 'string' ? Number(targetPort.trim()) : targetPort
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('端口必须是 1 到 65535 之间的整数')
  }
  return port
}

/**
 * 把绑定请求解析成宿主能接受的地址：通配地址换成一块具体网卡的 IPv4。
 * 宿主只接受具体 IP 字面量，因此「开放局域网」必须落到某个真实网卡地址上。
 */
export function normalizeBindHost(targetHost) {
  const raw = typeof targetHost === 'string' ? targetHost.trim() : ''
  if (!raw) throw new Error('绑定地址不能为空')
  if (WILDCARD_BIND_HOSTS.has(raw)) {
    const lan = pickLanBindHost()
    if (!lan) throw new Error('宿主机没有可用的局域网 IPv4 地址，无法开放局域网访问')
    return lan
  }
  if (isLoopbackHost(raw)) return '127.0.0.1'
  if (!isBindableLiteral(raw)) {
    throw new Error('绑定地址必须是具体的 IP 地址，不能是域名或通配地址')
  }
  return raw
}

/** 选一块非回环网卡的 IPv4 作为局域网绑定地址；没有可用网卡时返回 undefined。 */
export function pickLanBindHost() {
  return getLocalLanAddresses().find((ip) => !ip.startsWith('127.'))
}

/**
 * 切换或设置当前 profile 的 webserver 绑定 Host 与端口。
 * 入参可以是 127.0.0.1，也可以是要绑定的具体局域网 IP；port 省略时保留当前端口。
 *
 * 桌面端只锁 host：宿主固定连 127.0.0.1，改绑会让应用起不来。桌面端的回环端口
 * 保持随机（宿主传 `--port 0`），对外端口由 `lanGatewayPort` 单独控制，
 * 见 {@link setLanGatewayPort}。
 */
export async function setServerBindHost(ctx, targetHost, targetPort) {
  const desktop = isDesktopHostedProfile(ctx)
  if (desktop) {
    // 桌面端只看「是不是回环」，不做完整规范化：无 LAN 网卡时 normalizeBindHost
    // 会先抛「没有可用的局域网 IPv4」，掩盖真正该报的桌面端限制。
    if (targetHost !== undefined && !isLoopbackHost(String(targetHost).trim())) {
      throw new Error('桌面端不能修改监听地址：宿主固定连接 127.0.0.1，改绑会导致应用无法启动。对外端口请用「局域网端口」设置。')
    }
    if (targetPort !== undefined) {
      throw new Error('桌面端的回环端口由宿主随机分配，不能固定；需要对外暴露请设置「局域网端口」。')
    }
  }
  const host = desktop ? '127.0.0.1' : normalizeBindHost(targetHost)
  const port = targetPort === undefined ? undefined : normalizeBindPort(targetPort)
  const patchPath = resolveProfilePatchPath(ctx)
  if (!patchPath) {
    throw new Error('未找到当前 profile 的 cordis.patch.yml 配置文件')
  }
  const content = readFileSync(patchPath, 'utf8')
  const defaultPort = port ?? (ctx.webServer?.port || DEFAULT_SERVER_PORT)
  const updated = updateWebserverHostInPatch(content, host, defaultPort, port)
  writeFileSync(patchPath, updated, 'utf8')
  return { ok: true, host, ...port === undefined ? {} : { port }, path: patchPath }
}

/**
 * 设置桌面端对外暴露的局域网端口。该端口由插件自己的反向代理监听，
 * 与宿主回环端口相互独立，因此可以稳定对外而不影响 Electron 启动。
 */
export async function setLanGatewayPort(ctx, targetPort) {
  const port = normalizeBindPort(targetPort)
  await ctx.settings.mutate(settingsNamespace(ctx, NS), [{ op: 'set', path: ['lanGatewayPort'], value: port }])
  return { ok: true, lanGatewayPort: port }
}
export function getLocalLanAddresses() {
  try {
    return Object.values(networkInterfaces())
      .flat()
      .filter((iface) => iface !== undefined && iface.family === 'IPv4' && !iface.internal)
      .map((iface) => iface.address)
  } catch {
    return []
  }
}

/**
 * 当前进程是否由 Electron 桌面端宿主托管。
 * 桌面端把 `--host 127.0.0.1` 写死在 IPC 链路里，据此区分「能改绑」与「只能走局域网代理」。
 */
export function isDesktopHostedProfile(ctx) {
  try {
    const profile = ctx.get('profileContext')
    if (profile?.name === 'desktop') return true
    const entry = ctx.fiber?.entry?.options
    if (typeof entry?.name === 'string' && entry.name.includes('desktop-host')) return true
  } catch {}
  if (process.env.DSH_DESKTOP_NODE_EXECUTABLE !== undefined) return true
  // 桌面端宿主以 `dsh-desktop-host/lib/index.js` 作为入口启动子进程，
  // 该路径同时出现在 execArgv 与 argv 里，profile 换名也照样命中。
  const argv = [...process.execArgv, ...process.argv].join(' ')
  return /dsh-desktop-host/.test(argv)
}

/**
 * 检测当前宿主机监听端口与网络绑定信息。
 * 兼容 desktop 与 web 两种 profile 环境。
 */
export function getServerNetworkInfo(ctx) {
  const webServer = ctx.webServer
  const connection = ctx.connection
  const port = Number(webServer?.port || (typeof webServer?.server?.address === 'function' ? webServer.server.address()?.port : undefined)) || undefined
  const host = webServer?.host || '127.0.0.1'
  // 宿主只允许绑定具体 IP，因此「已开放局域网」等价于绑定了一块非回环网卡。
  const isAllInterfaces = !isLoopbackHost(host)
  const lanIps = getLocalLanAddresses()
  const trustedHosts = Array.isArray(connection?.trustedHosts) ? [...connection.trustedHosts] : []
  // 桌面端无法改绑：宿主用写死的 127.0.0.1 打开界面，改绑会让整个应用起不来。
  const bindLocked = isDesktopHostedProfile(ctx)

  return {
    port,
    host,
    isAllInterfaces,
    lanIps,
    trustedHosts,
    bindLocked,
  }
}

async function status(ctx, options, token) {
  const expected = await remoteControlSecret(ctx, options)
  const network = getServerNetworkInfo(ctx)
  const current = options()
  return {
    enabled: current.enabled,
    secretConfigured: Boolean(expected),
    authenticated: current.enabled && matchesRemoteControlSecret(expected, token),
    port: network.port,
    host: network.host,
    isAllInterfaces: network.isAllInterfaces,
    lanIps: network.lanIps,
    trustedHosts: network.trustedHosts,
    bindLocked: network.bindLocked,
    lanGatewayPort: current.lanGatewayPort,
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
      return {
        ok: true,
        value: {
          enabled: value.enabled,
          secretConfigured: value.secretConfigured,
          port: value.port,
          host: value.host,
          isAllInterfaces: value.isAllInterfaces,
          lanIps: value.lanIps,
          trustedHosts: value.trustedHosts,
          bindLocked: value.bindLocked,
          lanGatewayPort: value.lanGatewayPort,
        },
      }
    }
    if (method === 'setEnabled') {
      if (keys.length !== 1 || !Object.hasOwn(payload, 'enabled') || typeof payload.enabled !== 'boolean') {
        return errorResult('Remote Control setEnabled requests must carry exactly one boolean enabled field')
      }
      await ctx.settings.mutate(settingsNamespace(ctx, NS), [{ op: 'set', path: ['enabled'], value: payload.enabled }])
      const value = await status(ctx, options, '')
      return {
        ok: true,
        value: {
          enabled: value.enabled,
          secretConfigured: value.secretConfigured,
          port: value.port,
          host: value.host,
          isAllInterfaces: value.isAllInterfaces,
          lanIps: value.lanIps,
          trustedHosts: value.trustedHosts,
          bindLocked: value.bindLocked,
          lanGatewayPort: value.lanGatewayPort,
        },
      }
    }
    if (method === 'setSecret') {
      if (keys.length !== 1 || !Object.hasOwn(payload, 'secret') || typeof payload.secret !== 'string') {
        return errorResult('Remote Control setSecret requests must carry exactly one string secret field')
      }
      const secret = payload.secret.trim()
      if (secret) await ctx.credentials.set(REMOTE_CONTROL_SECRET_REF, secret)
      else await ctx.credentials.unset(REMOTE_CONTROL_SECRET_REF)
      const value = await status(ctx, options, '')
      return {
        ok: true,
        value: {
          enabled: value.enabled,
          secretConfigured: value.secretConfigured,
          port: value.port,
          host: value.host,
          isAllInterfaces: value.isAllInterfaces,
          lanIps: value.lanIps,
          trustedHosts: value.trustedHosts,
          bindLocked: value.bindLocked,
          lanGatewayPort: value.lanGatewayPort,
        },
      }
    }
    if (method === 'setBindHost') {
      /* host 可选：桌面端只允许改 port，此时 payload 只带 port。 */
      const fields = new Set(keys.map((key) => String(key)))
      const hasHost = fields.has('host')
      const hasPort = fields.has('port')
      if (fields.size === 0 || fields.size > 2 || fields.size !== (hasHost ? 1 : 0) + (hasPort ? 1 : 0)) {
        return errorResult('Remote Control setBindHost requests carry exactly one host or port field')
      }
      if (hasHost && typeof payload.host !== 'string') {
        return errorResult('Remote Control setBindHost host must be a string')
      }
      if (hasPort && !Number.isInteger(payload.port)) {
        return errorResult('Remote Control setBindHost port must be an integer')
      }
      await setServerBindHost(ctx, hasHost ? payload.host : undefined, hasPort ? payload.port : undefined)
      const value = await status(ctx, options, '')
      return {
        ok: true,
        value: {
          enabled: value.enabled,
          secretConfigured: value.secretConfigured,
          port: value.port,
          host: value.host,
          isAllInterfaces: value.isAllInterfaces,
          lanIps: value.lanIps,
          trustedHosts: value.trustedHosts,
          bindLocked: value.bindLocked,
          lanGatewayPort: value.lanGatewayPort,
        },
      }
    }
    if (method === 'setLanGatewayPort') {
      if (keys.length !== 1 || !Object.hasOwn(payload, 'port') || !Number.isInteger(payload.port)) {
        return errorResult('Remote Control setLanGatewayPort requests carry exactly one integer port field')
      }
      await setLanGatewayPort(ctx, payload.port)
      const value = await status(ctx, options, '')
      return {
        ok: true,
        value: {
          enabled: value.enabled,
          secretConfigured: value.secretConfigured,
          port: value.port,
          host: value.host,
          isAllInterfaces: value.isAllInterfaces,
          lanIps: value.lanIps,
          trustedHosts: value.trustedHosts,
          bindLocked: value.bindLocked,
          lanGatewayPort: value.lanGatewayPort,
        },
      }
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
  // 局域网网关会把 Host 折成回环，原始 authority 记在标记头里。
  if (isLanGatewayRequest(request)) return true
  return !isLoopbackHostHeader(requestHeader(request, 'host'))
}

/** 请求是否来自本插件的局域网网关（Host 已被折成回环）。 */
export function isLanGatewayRequest(request) {
  const origin = requestHeader(request, LAN_ORIGIN_HEADER)
  return typeof origin === 'string' && origin.length > 0
}

export function apply(ctx, config) {
  let current = () => unwrapConfig(config ?? {})
  const options = () => resolveOptions(current())
  const scope = openSettingsScope(ctx, NS, Config, config)
  current = () => unwrapConfig(scope.get())

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

  /* 桌面端不能改宿主绑定，改用独立局域网代理端口对外提供同一工作区。 */
  ctx.inject(['connection', 'webServer'], (gatewayCtx) => {
    gatewayCtx.effect(() => {
      if (!isDesktopHostedProfile(gatewayCtx)) return
      const lanIp = pickLanBindHost()
      const targetPort = Number(gatewayCtx.webServer?.port) || undefined
      if (!lanIp || !targetPort) return
      const gatewayPort = normalizeBindPort(options().lanGatewayPort ?? DEFAULT_LAN_GATEWAY_PORT)
      let handle
      let disposed = false
      const stop = async () => {
        disposed = true
        const current = handle
        handle = undefined
        await current?.close()
      }
      /* 浏览器自带的 Cookie 绑定局域网 authority，折过 Host 后对不上；
         网关用宿主的 launch token 现签一份绑定 127.0.0.1 的会话。 */
      const mintCookie = async () => {
        const cookie = captureSessionCookie(gatewayCtx.connection, {
          headers: { host: `127.0.0.1:${targetPort}` },
        })
        return typeof cookie === 'string' && cookie.length > 0 ? cookie : undefined
      }
      startLanGateway({ bindHost: lanIp, port: gatewayPort, targetPort, mintCookie }).then((started) => {
        if (disposed) { void started.close(); return }
        handle = started
        gatewayCtx.logger?.info?.('remote-control: LAN gateway on %s:%s', lanIp, gatewayPort)
      }, (error) => {
        gatewayCtx.logger?.warn?.('remote-control: LAN gateway failed on %s:%s: %s', lanIp, gatewayPort, error?.message ?? error)
      })
      return stop
    }, 'remote-control: LAN gateway')
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
          // 当远程控制启用时，如果 Host 未显式配置当前局域网 IP 到 trustedHosts，
          // 在校验合法局域网来源时自动放行 403 围栏，确保桌面端局域网设备也能正常握手与认证
          let res = origRequestRejection(request)
          if (res === 403 && options().enabled) {
            const hostHeader = requestHeader(request, 'host')
            const lanOrigin = requestHeader(request, LAN_ORIGIN_HEADER)
            if (hostHeader) {
              const lanIps = getLocalLanAddresses()
              const isLocalLan = lanIps.some((ip) => hostHeader === ip || hostHeader.startsWith(ip + ':'))
                // 网关请求的 Host 已被折成回环，原始 authority 在标记头里
                || (typeof lanOrigin === 'string' && lanIps.some((ip) => lanOrigin === ip || lanOrigin.startsWith(ip + ':')))
              if (isLocalLan) {
                res = connection.browserAuth.isAuthenticated(request) ? undefined : 401
              }
            }
          }
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
  getLocalLanAddresses,
  pickLanBindHost,
  normalizeBindHost,
  isLoopbackHost,
  isDesktopHostedProfile,
  getServerNetworkInfo,
  resolveProfilePatchPath,
  updateWebserverHostInPatch,
  setServerBindHost,
  setLanGatewayPort,
  normalizeBindPort,
  DEFAULT_SERVER_PORT,
  handleConfigRpc,
  handleRemoteControlRpc,
  captureSessionCookie,
  handleSessionRequest,
  serveSessionRoute,
  isRemoteControlRpcPath,
  isLoopbackHostHeader,
  shouldBypassBrowserAuthRejection,
  isLanGatewayRequest,
  shouldServeUnauthenticatedIndex,
}
