/**
 * dsh-archive-manager host entry.
 *
 * Registers the plugin settings namespace (tombstones + physical-delete
 * options) and the trusted-host RPC channel `/dsh-archive-manager-rpc`,
 * following the same shape as dsh-plugin-manager:
 * `ctx.inject(['connection'], ...)` + `connection.rpc.handle(channel, handler, { authority })`.
 */
import z from '@deepseek-ai/schemastery'
import {
  NS, RPC_CHANNEL, handleArchiveRpc, resolveOptions,
} from './core.js'

export const name = 'archive-manager'
export const inject = ['workspaceRegistry', 'sessionPersistence', 'settings', 'sessions', 'agents']

/** The shared symbol of cosmokit's live-reference protocol, stable across module copies. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * Whether a resolved config value is a live reference rather than plain data.
 * Schemastery 3.18.4+ hands the plugin a cosmokit reference for every volatile
 * field, and the Loader swaps the value inside that same reference when the
 * profile patch changes.
 */
function isVolatileRef(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  if (typeof value.get !== 'function') return false
  return VOLATILE_WRITE in value || Object.keys(value).length === 0
}

function unwrapConfig(value, seen = new Set()) {
  if (isVolatileRef(value)) return unwrapConfig(value.get(), seen)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return value
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => unwrapConfig(item, seen))
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unwrapConfig(item, seen)]))
}

/**
 * Mark one field as live. The host settings service refuses every write to an
 * entry whose Config declares no volatile field ("Plugin entry X has no
 * volatile fields"), and applies an accepted write to the running fiber
 * instead of remounting the plugin. Schemastery copies older than 3.18.4 have
 * no `.volatile()` at all; there the field stays ordinary config and the legacy
 * `settings.register` seam owns the value.
 */
function liveField(schema) {
  return typeof schema?.volatile === 'function' ? schema.volatile() : schema
}

/**
 * Plain composition layer for the legacy settings seam. `settings.register`
 * resolves the schema over its `base` itself, so the base must be raw config:
 * the resolved fiber config carries live references.
 */
function settingsBase(ctx, config) {
  return unwrapConfig(ctx.fiber?.entry?.options?.config ?? config ?? {})
}

export { isVolatileRef, liveField, settingsBase, unwrapConfig }

export const Config = z.object({
  tombstones: liveField(z.array(z.object({
    id: z.string(),
    kind: z.string().default('soft'),
    deletedAt: z.string(),
    trashPath: z.string().default(''),
    originalPath: z.string().default(''),
  })).default([])),
  /** Opt-in: enable physical delete (moves artifacts into a trash dir). */
  physicalDelete: liveField(z.boolean().default(false)),
  /** Custom trash directory; defaults to `<dsh-home>/archive-manager/trash`. */
  trashDir: liveField(z.string().default('')),
})

function settingsNamespace(ctx) {
  if (typeof ctx.settings?.register === 'function') return NS
  const id = ctx.fiber?.entry?.options?.id
  return typeof id === 'string' && id.length > 0 ? id : NS
}

function openSettingsScope(ctx, config) {
  if (typeof ctx.settings?.register === 'function') {
    const scope = ctx.settings.register(NS, Config, { base: settingsBase(ctx, config) })
    // core.js reads `scope.get()` directly, so it must never see live references.
    return { ...scope, get: () => unwrapConfig(scope.get()) }
  }
  const read = () => unwrapConfig(config ?? {})
  const ns = settingsNamespace(ctx)
  return {
    get: read,
    async update(patch) {
      if (typeof ctx.settings?.mutate !== 'function') return
      await ctx.settings.mutate(ns, Object.entries(patch).map(([key, value]) => ({ op: 'set', path: [key], value })))
    },
    async replace(section) {
      if (typeof ctx.settings?.replace !== 'function') return
      await ctx.settings.replace(ns, section)
    },
  }
}

export function apply(ctx, config) {
  const scope = openSettingsScope(ctx, config)
  const options = () => resolveOptions(scope.get())

  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.connection.rpc.handle(
      RPC_CHANNEL,
      (method, payload) => handleArchiveRpc(ctx, scope, options(), method, payload),
      { authority: 'trusted-host' },
    )
  })
}
