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
export const inject = ['workspaceRegistry', 'sessionPersistence', 'settings']

export const Config = z.object({
  tombstones: z.array(z.object({
    id: z.string(),
    kind: z.string().default('soft'),
    deletedAt: z.string(),
    trashPath: z.string().default(''),
    originalPath: z.string().default(''),
  })).default([]),
  /** Opt-in: enable physical delete (moves artifacts into a trash dir). */
  physicalDelete: z.boolean().default(false),
  /** Custom trash directory; defaults to `<dsh-home>/archive-manager/trash`. */
  trashDir: z.string().default(''),
})

export function apply(ctx, config) {
  const scope = ctx.settings.register(NS, Config, { base: config ?? {} })
  const options = () => resolveOptions(scope.get())

  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.connection.rpc.handle(
      RPC_CHANNEL,
      (method, payload) => handleArchiveRpc(ctx, scope, options(), method, payload),
      { authority: 'trusted-host' },
    )
  })
}
