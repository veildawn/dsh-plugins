/**
 * dsh-task-models: per-task-type subagent model routing for DeepSeek Harness.
 *
 * The plugin is standalone: it does not read or require any Agent Preset or
 * role-routing plugin. It routes only delegated child sessions, decides once per
 * child at its first request, and optionally asks TypeSafe Jev (or a
 * configured lightweight classifier) when deterministic keywords do not
 * settle the task type.
 *
 * @module dsh-task-models
 */
import z from '@deepseek-ai/schemastery'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import zlib from 'node:zlib'
import {
  DEFAULT_JEV,
  DEFAULT_ROUTING,
  childRouteIsExplicit,
  isSubagent,
  parseJevChoice,
  parseProfile,
  planModeActive,
  profileJevRequest,
  profileSystem,
  resolveConfig,
  selectProfile,
  taskTextOf,
} from './core.js'

export const name = '@weniatall/dsh-task-models'
export const inject = ['settings', 'llm']
export const NS = 'task-models'
export const SETTINGS_RPC_CHANNEL = '/task-models-settings'
export const JEV_PING_INSTRUCTIONS = 'Is this a valid test ping?'
export function keyFilePath() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'task-models', 'typesafe.key')
}

const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

function liveField(schema) {
  return typeof schema?.volatile === 'function' ? schema.volatile() : schema
}

function isVolatileRef(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  if (typeof value.get !== 'function') return false
  return VOLATILE_WRITE in value || Object.keys(value).length === 0
}

/** Plain composition layer for the legacy settings seam. */
function settingsBase(ctx, config) {
  return unwrapConfig(ctx.fiber?.entry?.options?.config ?? config ?? {})
}

function unwrapConfig(value, seen = new Set()) {
  if (isVolatileRef(value)) return unwrapConfig(value.get(), seen)
  if (value === null || typeof value !== 'object') return value
  seen.add(value)
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
  const read = () => {
    const raw = typeof ctx.settings?.get === 'function' ? ctx.settings.get(ns) : config
    return unwrapConfig(schema(unwrapConfig(raw ?? {})))
  }
  return {
    get: read,
    watch(listener) {
      if (typeof ctx.on !== 'function') return () => {}
      return ctx.on('loader/volatile-update', () => listener(read()))
    },
  }
}

const routeEntry = z.object({
  provider: z.string().default(''),
  model: z.string().default(''),
  reasoningEffort: z.string().default(''),
})

const profileEntry = z.object({
  id: z.string().required(),
  name: z.string().default(''),
  detail: z.string().default(''),
  keywords: z.array(z.string()).default([]),
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string().default(''),
  enabled: z.boolean().default(true),
})

/** Settings section and Cordis entry configuration. */
export const Config = z.object({
  routing: liveField(z.object({
    enabled: z.boolean().default(false),
    fallback: z.string().default('taskRole'),
    useJev: z.boolean().default(true),
    respectExplicitChildModel: z.boolean().default(true),
    classifier: routeEntry.default({}),
  }).default({})),
  profiles: liveField(z.array(profileEntry).default([])),
  jev: liveField(z.object({
    enabled: z.boolean().default(false),
    baseURL: z.string().default(DEFAULT_JEV.baseURL),
    model: z.string().default(DEFAULT_JEV.model),
    minConfidence: z.number().min(0).max(1).default(DEFAULT_JEV.minConfidence),
    timeoutMs: z.number().step(1).min(100).max(60_000).default(DEFAULT_JEV.timeoutMs),
    maxStateChars: z.number().step(1).min(500).max(100_000).default(DEFAULT_JEV.maxStateChars),
  }).default({})),
})

export { isVolatileRef, liveField, settingsBase, unwrapConfig }

function badSettingsRequest(message) {
  return {
    ok: false,
    error: {
      code: 'bad-request',
      message,
      details: { issues: [{ code: 'custom', path: [], message }] },
    },
  }
}

function settingsRpcView(settingsProvider, fallbackValue, targetNs = NS) {
  const descriptor = typeof settingsProvider?.describe === 'function'
    ? settingsProvider.describe({ redactSecrets: true }).find((entry) => entry.ns === targetNs)
    : undefined
  if (descriptor !== undefined) {
    return {
      writable: settingsProvider.writable,
      value: descriptor.value,
      revision: descriptor.revision,
    }
  }
  return {
    writable: true,
    value: unwrapConfig(fallbackValue ?? {}),
    revision: 0,
  }
}

async function readTextFile(path) {
  try {
    const text = await readFile(path, 'utf8')
    return text.trim() === '' ? undefined : text.trim()
  } catch {
    return undefined
  }
}

/** The API Key lives in one fixed local file, never in the profile patch. */
async function resolveApiKey(overrideKey, keyPath = keyFilePath()) {
  if (typeof overrideKey === 'string' && overrideKey.trim() !== '') return overrideKey.trim()
  return readTextFile(keyPath)
}

async function saveJevKey(apiKey, keyPath = keyFilePath()) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (key === '') throw new Error('task-models: API key must be non-empty')
  await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 })
  await writeFile(keyPath, key, { encoding: 'utf8', mode: 0o600 })
  return keyPath
}

function signalWithTimeout(signal, timeoutMs) {
  const timeout = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined
  if (signal === undefined || signal === null) return timeout
  if (typeof AbortSignal.any === 'function' && timeout !== undefined) {
    return AbortSignal.any([signal, timeout])
  }
  const controller = new AbortController()
  const abort = (reason) => controller.abort(reason)
  if (signal.aborted) abort(signal.reason)
  else signal.addEventListener('abort', () => abort(signal.reason), { once: true })
  if (timeout !== undefined) timeout.addEventListener('abort', () => abort(timeout.reason), { once: true })
  return controller.signal
}

async function requestJev(jev, input, signal, overrideKey, keyPath = keyFilePath()) {
  const state = input?.state
  if (typeof state !== 'string' || state.trim() === '') {
    throw new Error('task-models: Jev state must be non-empty')
  }
  const questions = input?.questions
  if (questions === null || typeof questions !== 'object' || Array.isArray(questions)
    || Object.keys(questions).length === 0) {
    throw new Error('task-models: Jev questions must be a non-empty object')
  }
  const apiKey = await resolveApiKey(overrideKey, keyPath)
  if (apiKey === undefined) {
    const error = new Error(`task-models: no TypeSafe API key. Save one in Settings -> 任务模型 -> Jev (${keyPath}).`)
    error.code = 'unconfigured'
    throw error
  }
  const url = `${String(jev.baseURL).replace(/\/+$/u, '')}/v1/systemone`
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ state, questions, model: jev.model }),
      signal: signalWithTimeout(signal, jev.timeoutMs),
    })
  } catch (error) {
    if (signal?.aborted === true) {
      const aborted = new Error('task-models: Jev request was aborted by the caller')
      aborted.name = 'AbortError'
      aborted.code = 'aborted'
      throw aborted
    }
    const name = error instanceof Error ? error.name : ''
    const code = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network'
    const wrapped = new Error(`task-models: Jev request failed (${code}): ${error instanceof Error ? error.message : String(error)}`)
    wrapped.code = code
    throw wrapped
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const error = new Error(`task-models: Jev returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`)
    error.code = `http-${response.status}`
    throw error
  }
  const data = await response.json().catch((error) => {
    const wrapped = new Error(`task-models: Jev returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    wrapped.code = 'invalid-response'
    throw wrapped
  })
  if (data === null || typeof data !== 'object' || Array.isArray(data)
    || data.answers === null || typeof data.answers !== 'object' || Array.isArray(data.answers)) {
    const error = new Error('task-models: Jev response is missing the required answers object')
    error.code = 'invalid-response'
    throw error
  }
  return data
}

async function pingJev(jev, overrideKey, signal, keyPath = keyFilePath()) {
  const startedAt = Date.now()
  const data = await requestJev(jev, {
    state: 'Ping check from DSH task-models',
    questions: {
      ping: { type: 'noul', instructions: JEV_PING_INSTRUCTIONS },
    },
  }, signal, overrideKey, keyPath)
  return { latencyMs: Date.now() - startedAt, answers: data.answers }
}

/** Dedicated host RPC wire for a namespace hidden by DSH's settings allowlist. */
export async function handleSettingsRpc(settingsProvider, method, payload, currentSettings = {}, targetNs = NS, getChildModels, keyPath = keyFilePath()) {
  const keys = payload === null || typeof payload !== 'object' || Array.isArray(payload)
    ? null
    : Reflect.ownKeys(payload)
  if (keys === null) return badSettingsRequest('task-models settings requests must carry an object')

  let current
  try {
    current = resolveConfig(currentSettings)
  } catch {
    current = resolveConfig({})
  }

  try {
    if (method === 'describe') {
      if (keys.length !== 0) return badSettingsRequest('task-models describe requests must carry an empty object')
      return { ok: true, value: settingsRpcView(settingsProvider, currentSettings, targetNs) }
    }
    if (method === 'replace') {
      if (keys.length !== 2 || !Object.hasOwn(payload, 'section') || !Object.hasOwn(payload, 'expectedRevision')) {
        return badSettingsRequest('task-models replace requests require section and expectedRevision')
      }
      if (payload.section === null || typeof payload.section !== 'object' || Array.isArray(payload.section)) {
        return badSettingsRequest('task-models section must be an object')
      }
      if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0) {
        return badSettingsRequest('task-models expectedRevision must be a non-negative integer')
      }
      await settingsProvider.replace(NS, payload.section, payload.expectedRevision)
      return { ok: true, value: settingsRpcView(settingsProvider, payload.section, targetNs) }
    }
    if (method === 'jevStatus') {
      if (keys.length !== 0) return badSettingsRequest('task-models jevStatus requests must carry an empty object')
      const apiKey = await resolveApiKey(undefined, keyPath)
      return {
        ok: true,
        value: { configured: apiKey !== undefined, model: current.jev.model },
      }
    }
    if (method === 'saveJevKey') {
      if (keys.length !== 1 || !Object.hasOwn(payload, 'apiKey') || typeof payload.apiKey !== 'string') {
        return badSettingsRequest('task-models saveJevKey requests require an apiKey string')
      }
      await saveJevKey(payload.apiKey, keyPath)
      return { ok: true, value: { configured: true, model: current.jev.model } }
    }
    if (method === 'childModels') {
      if (keys.length !== 1
        || !Object.hasOwn(payload, 'childIds')
        || !Array.isArray(payload.childIds)
        || payload.childIds.length > 500
        || payload.childIds.some((id) => typeof id !== 'string' || id === '')) {
        return badSettingsRequest('task-models childModels requests require a childIds string array (max 500)')
      }
      const models = typeof getChildModels === 'function' ? await getChildModels(payload.childIds) : {}
      return { ok: true, value: { models: models !== null && typeof models === 'object' ? models : {} } }
    }
    if (method === 'testJev') {
      if (keys.length > 2
        || (Object.hasOwn(payload, 'apiKey') && typeof payload.apiKey !== 'string')
        || (Object.hasOwn(payload, 'jev') && (payload.jev === null || typeof payload.jev !== 'object' || Array.isArray(payload.jev)))) {
        return badSettingsRequest('task-models testJev accepts an optional apiKey string and jev object')
      }
      const jevConfig = resolveConfig({
        ...currentSettings,
        jev: { ...current.jev, ...(typeof payload.jev === 'object' && payload.jev !== null ? payload.jev : {}) },
      }).jev
      const result = await pingJev(
        jevConfig,
        typeof payload.apiKey === 'string' ? payload.apiKey : undefined,
        typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(5_000) : undefined,
        keyPath,
      )
      return { ok: true, value: { latencyMs: result.latencyMs, answers: result.answers } }
    }
    return badSettingsRequest(`Unknown task-models settings method: ${method}`)
  } catch (error) {
    return {
      ok: false,
      error: {
        code: typeof error?.code === 'string' ? error.code : 'internal',
        message: error instanceof Error ? error.message : String(error),
        details: {},
      },
    }
  }
}

function promptTextOf(messages) {
  if (!Array.isArray(messages)) return ''
  const human = messages.filter((message) => message?.role === 'user'
    && (message.source?.kind === undefined || message.source.kind === 'user'))
  const selected = human.length > 0 ? human : messages
  return selected
    .flatMap((message) => (Array.isArray(message?.content) ? message.content : []))
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

function toRoute(profile) {
  if (profile?.provider === undefined || profile?.model === undefined) return undefined
  return {
    provider: profile.provider,
    model: profile.model,
    ...(profile.reasoningEffort === undefined || profile.reasoningEffort === ''
      ? {}
      : { reasoningEffort: profile.reasoningEffort }),
  }
}

function applyRoute(config, route) {
  const { reasoningEffort: _previousEffort, ...rest } = config
  return {
    ...rest,
    provider: route.provider,
    model: route.model,
    ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
  }
}

/** Register settings, the Jev client, and the subagent request router. */
export function apply(ctx, config = {}) {
  const scope = openSettingsScope(ctx, NS, Config, config)
  let settings = unwrapConfig(scope.get())
  let routingConfig
  try {
    routingConfig = resolveConfig(settings)
  } catch (error) {
    ctx.logger.warn?.('task-models: invalid settings; using defaults')
    ctx.logger.warn?.(error)
    routingConfig = resolveConfig({})
  }

  const firstStepText = new WeakMap()
  const subagentLabels = new WeakMap()
  const taskDecisions = new WeakMap()
  const childModels = new Map()
  const historicalModels = new Map()
  let jevFailureLogged = false

  /**
   * Remember the effective route of every delegated child request. The
   * workflow UI asks for these by child session id, so a member row can show
   * the model that actually served the child even when another role router,
   * an explicit subagent model, or this plugin selected it.
   */
  function rememberChildModel(agent, config) {
    if (!isSubagent(agent)) return
    const provider = typeof config?.provider === 'string' ? config.provider : ''
    const model = typeof config?.model === 'string' ? config.model : ''
    if (provider === '' || model === '') return
    const id = agent?.session?.id ?? agent?.id
    if (typeof id !== 'string' || id === '') return
    const previous = childModels.get(id)
    const next = Object.freeze({
      provider,
      model,
      ...(typeof config?.reasoningEffort === 'string' && config.reasoningEffort !== ''
        ? { reasoningEffort: config.reasoningEffort }
        : {}),
    })
    if (previous !== undefined && previous.provider === next.provider
      && previous.model === next.model && previous.reasoningEffort === next.reasoningEffort) {
      return
    }
    childModels.delete(id)
    childModels.set(id, next)
    if (childModels.size > 2_000) {
      const oldest = childModels.keys().next().value
      if (oldest !== undefined) childModels.delete(oldest)
    }
  }

  function modelsFor(childIds) {
    const models = {}
    for (const id of childIds) {
      const entry = childModels.get(id)
      if (entry !== undefined) models[id] = entry
    }
    return models
  }

  /**
   * Best-effort backfill for workflow members whose child session predates
   * this plugin instance (for example a run created before a restart). The
   * durable child log records its last request/header, which contains the
   * provider/model that actually served it. This is additive and never
   * affects routing; a missing or unreadable log simply leaves the badge
   * blank.
   */
  async function historicalModelOf(childId) {
    if (typeof childId !== 'string' || childId === '.' || childId === '..' || childId.includes('..')
      || !/^[A-Za-z0-9._:-]+$/u.test(childId)) return undefined
    if (historicalModels.has(childId)) return historicalModels.get(childId) ?? undefined
    let result
    try {
      const home = process.env.DSH_HOME || join(homedir(), '.dsh')
      const root = join(home, 'sessions')
      const scopes = await readdir(root, { withFileTypes: true })
      for (const scope of scopes) {
        if (!scope.isDirectory()) continue
        const base = join(root, scope.name, childId)
        for (const name of ['session.v4.jsonl.zstd', 'session.v4.jsonl']) {
          let raw
          try {
            raw = await readFile(join(base, name))
          } catch {
            continue
          }
          let text
          if (name.endsWith('.zstd')) {
            if (typeof zlib.zstdDecompressSync !== 'function') continue
            try {
              const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
              const offsets = []
              let offset = raw.indexOf(magic)
              while (offset !== -1) {
                offsets.push(offset)
                offset = raw.indexOf(magic, offset + 4)
              }
              const chunks = []
              for (let index = 0; index < offsets.length; index += 1) {
                const end = index + 1 < offsets.length ? offsets[index + 1] : raw.length
                try {
                  chunks.push(zlib.zstdDecompressSync(raw.subarray(offsets[index], end)).toString('utf8'))
                } catch {
                  // A malformed frame never invalidates the other frames.
                }
              }
              text = chunks.join('')
            } catch {
              continue
            }
          } else {
            text = raw.toString('utf8')
          }
          let found
          for (const line of text.split(/\r?\n/u)) {
            if (!line.includes('"request/header"')) continue
            try {
              const event = JSON.parse(line)
              const config = event?.data?.header?.config ?? event?.data?.config
              if (typeof config?.provider === 'string' && typeof config?.model === 'string') {
                found = {
                  provider: config.provider,
                  model: config.model,
                  ...(typeof config.reasoningEffort === 'string' && config.reasoningEffort !== ''
                    ? { reasoningEffort: config.reasoningEffort }
                    : {}),
                }
              }
            } catch {
              // Ignore a torn or non-JSON line.
            }
          }
          if (found !== undefined) {
            result = found
            break
          }
        }
        if (result !== undefined) break
      }
    } catch {
      // Missing session storage is normal on a fresh machine.
    }
    historicalModels.set(childId, result ?? null)
    if (historicalModels.size > 1_000) {
      const oldest = historicalModels.keys().next().value
      if (oldest !== undefined) historicalModels.delete(oldest)
    }
    return result
  }

  async function modelsForWithHistory(childIds) {
    const models = modelsFor(childIds)
    const missing = childIds.filter((id) => models[id] === undefined)
    await Promise.all(missing.map(async (id) => {
      const entry = await historicalModelOf(id)
      if (entry !== undefined) models[id] = entry
    }))
    return models
  }

  function warnJevOnce(message, error) {
    if (jevFailureLogged) return
    jevFailureLogged = true
    ctx.logger.warn?.(message)
    if (error !== undefined) ctx.logger.warn?.(error)
  }

  function labelOf(agent) {
    const session = agent?.session
    if (session === undefined) return undefined
    const cached = subagentLabels.get(session)
    if (cached !== undefined) return cached
    const events = Array.isArray(session.events) ? session.events : []
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event?.type === 'subagent/descriptor' && typeof event.data?.label === 'string') {
        subagentLabels.set(session, event.data.label)
        return event.data.label
      }
    }
    return undefined
  }

  function parentOf(agent) {
    const id = agent?.session?.header?.parentSession
    if (typeof id !== 'string' || id === '') return undefined
    try {
      return ctx.get?.('agents')?.get?.(id)
    } catch {
      return undefined
    }
  }

  function requestHeaderOf(agent) {
    try {
      return agent?.session?.requestHeader?.()
    } catch {
      return undefined
    }
  }

  function childHasExplicitRoute(agent) {
    const parent = parentOf(agent)
    if (parent === undefined) return false
    let parentConfig = {}
    try {
      parentConfig = parent.session?.requestHeader?.()?.config ?? parent.options ?? {}
    } catch {
      parentConfig = parent.options ?? {}
    }
    return childRouteIsExplicit(agent?.options, parentConfig)
  }

  async function askJev(agent, cfg, label, text, signal) {
    const parent = parentOf(agent)
    const request = profileJevRequest({
      parentTask: parent === undefined ? '' : taskTextOf(parent).slice(-2_000),
      label,
      text,
      profiles: cfg.profiles,
      maxStateChars: cfg.jev.maxStateChars,
    })
    const data = await requestJev(cfg.jev, request, signal)
    return parseJevChoice(data, cfg.profiles, cfg.jev.minConfidence)
  }

  async function classifyWithLlm(cfg, label, text, signal) {
    const route = cfg.routing.classifier
    if (!route?.provider || !route?.model) return undefined
    const task = [
      typeof label === 'string' && label.trim() !== '' ? `Subtask label:\n${label}` : '',
      typeof text === 'string' && text.trim() !== '' ? `<subtask>\n${text}\n</subtask>` : '',
    ].filter(Boolean).join('\n\n').slice(-6_000)
    if (task === '') return undefined
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      ...(route.reasoningEffort === '' ? {} : { reasoningEffort: route.reasoningEffort }),
      messages: [createUserMessage({
        content: [{ type: 'text', text: task }],
        source: { kind: `plugin:${NS}` },
      })],
      system: profileSystem(cfg.profiles),
      temperature: 0,
      maxTokens: 128,
      ...(signal === undefined ? {} : { signal }),
    })) assembler.push(chunk)
    const output = assembler.blocks()
      .filter((block) => block?.type === 'text')
      .map((block) => block.text)
      .join('\n')
    return parseProfile(output, cfg.profiles)
  }

  async function decideProfile(agent, cfg, label, text, signal) {
    const deterministic = selectProfile(cfg.profiles, label, text)
    if (deterministic !== undefined) return { profile: deterministic, source: 'rules' }

    if (cfg.routing.useJev && cfg.jev.enabled) {
      try {
        const id = await askJev(agent, cfg, label, text, signal)
        const profile = id === undefined ? undefined : cfg.profiles.get(id)
        if (profile?.enabled) return { profile, source: 'jev' }
      } catch (error) {
        if (!(error?.name === 'AbortError' && signal?.aborted === true)) {
          warnJevOnce('task-models: Jev task classification failed; falling back', error)
        }
      }
    }

    if (cfg.routing.fallback === 'llm') {
      const id = await classifyWithLlm(cfg, label, text, signal)
      const profile = id === undefined ? undefined : cfg.profiles.get(id)
      if (profile?.enabled) return { profile, source: 'llm' }
    }
    return undefined
  }

  function decisionFor(agent, cfg, label, text, signal) {
    const signature = `${label ?? ''}\u0000${text ?? ''}`
    const cached = taskDecisions.get(agent)
    if (cached !== undefined && cached.signature === signature) return cached.promise
    const promise = decideProfile(agent, cfg, label, text, signal).catch((error) => {
      ctx.logger.warn?.('task-models: task profile classification failed; keeping the current route')
      ctx.logger.warn?.(error)
      return undefined
    })
    taskDecisions.set(agent, { signature, promise })
    return promise
  }

  async function routeUsable(route, signal) {
    if (typeof ctx.llm?.resolveCallConfig !== 'function') return true
    try {
      await ctx.llm.resolveCallConfig(route, signal)
      return true
    } catch (error) {
      ctx.logger.warn?.('task-models: selected profile route is not usable; keeping the current route')
      ctx.logger.warn?.(error)
      return false
    }
  }

  scope.watch((next) => {
    const value = unwrapConfig(next)
    try {
      const resolved = resolveConfig(value)
      settings = value
      routingConfig = resolved
    } catch (error) {
      ctx.logger.warn?.('task-models: keeping the last good settings after an invalid update')
      ctx.logger.warn?.(error)
    }
  })

  ctx.inject(['connection'], (connectionCtx) => {
    const targetNs = settingsNamespace(ctx, NS)
    connectionCtx.connection.rpc.handle(
      SETTINGS_RPC_CHANNEL,
      (method, payload) => handleSettingsRpc(
        ctx.settings,
        method,
        payload,
        settings,
        targetNs,
        (childIds) => modelsForWithHistory(childIds),
      ),
      { authority: 'trusted-host' },
    )
  })

  // Capture the delegated prompt before agent/request: the Host commits the
  // current step's user message only after the request waterfall.
  ctx.on('agent/pre-step', async ({ agent, turn, step }, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    if (isSubagent(agent) && turn === 1 && step === 1
      && agent?.options?.modelRole === undefined && !firstStepText.has(agent)) {
      const text = promptTextOf(decision.messages)
      if (text !== '') firstStepText.set(agent, text.slice(-6_000))
    }
    return decision
  }, { prepend: true })

  ctx.on('session/event', (session, event) => {
    if (event?.type === 'subagent/descriptor' && typeof event.data?.label === 'string') {
      subagentLabels.set(session, event.data.label)
    }
  })

  // Prepending makes this router the outermost agent/request listener: it
  // observes every other listener's result through next() and applies its
  // profile last. It only touches delegated children.
  ctx.on('agent/request', async ({ agent, signal }, next) => {
    const current = await next()
    rememberChildModel(agent, current)
    const cfg = routingConfig
    if (!cfg.routing.enabled || cfg.profiles.size === 0) return current
    if (!isSubagent(agent)) return current
    if (agent?.options?.modelRole !== undefined) return current
    if (planModeActive(agent?.session?.events)) return current

    const label = labelOf(agent)
    const captured = firstStepText.get(agent)
    const text = typeof captured === 'string' && captured !== '' ? captured : taskTextOf(agent)
    if ((label ?? '') === '' && (text ?? '') === '') return current

    const firstRequest = requestHeaderOf(agent) === undefined
    let decision
    const cached = taskDecisions.get(agent)
    if (cached !== undefined) {
      decision = await cached.promise
    } else {
      if (!firstRequest) return current
      if (cfg.routing.respectExplicitChildModel && childHasExplicitRoute(agent)) return current
      decision = await decisionFor(agent, cfg, label, text, signal)
    }

    if (decision?.profile === undefined || !cfg.profiles.has(decision.profile.id)) return current
    const route = toRoute(decision.profile)
    if (route === undefined) return current
    if (firstRequest && !(await routeUsable(route, signal))) return current
    const routed = applyRoute(current, route)
    rememberChildModel(agent, routed)
    return routed
  }, { prepend: true })
}
