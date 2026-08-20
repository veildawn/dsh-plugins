/**
 * DSH Terminal Plugin — Host half.
 *
 * Exposes a trusted-host RPC channel for browser-based interactive terminal
 * sessions across Windows, Linux, and macOS.
 *
 * @module dsh-terminal
 */
import z from '@deepseek-ai/schemastery'
import * as nodePty from 'node-pty'
import { detectShells, buildCleanEnv } from './shell.js'
import { TerminalSession, SessionManager } from './core.js'

export const name = 'terminal'
export const inject = ['connection', 'settings', 'sessions', 'workspaceRegistry']
export const NS = 'terminal'
export const RPC_CHANNEL = '/dsh-terminal'

export const Config = z.object({
  defaultShell: z.string().default(''),
  scrollbackMaxBytes: z.natural().default(1024 * 1024),
})

/** Global host-side terminal session registry */
export const sessionManager = new SessionManager()

/**
 * Resolve working directory from a session or workspace root.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {string} [sessionId]
 * @returns {string}
 */
export function resolveWorkingDir(ctx, sessionId) {
  if (sessionId && ctx.sessions?.get) {
    const s = ctx.sessions.get(sessionId)
    const cwd = s?.header?.cwd ?? s?.header?.meta?.cwd
    if (typeof cwd === 'string' && cwd.length > 0) return cwd
  }

  const workspaces = ctx.workspaceRegistry?.list?.() ?? []
  if (workspaces.length > 0 && typeof workspaces[0]?.path === 'string') {
    return workspaces[0].path
  }

  return process.cwd()
}

/**
 * Handle incoming RPC requests from the browser.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {() => object} options
 * @param {string} method
 * @param {object} payload
 * @param {AbortSignal} [signal]
 */
export async function handleRpc(ctx, options, method, payload = {}, signal) {
  try {
    switch (method) {
      case 'shells': {
        const detected = detectShells()
        return { ok: true, value: detected }
      }

      case 'list': {
        return { ok: true, value: sessionManager.list() }
      }

      case 'create': {
        const { shellId, cols = 80, rows = 24, sessionId, cwd: customCwd } = payload
        const detected = detectShells()
        const selected = detected.available.find((s) => s.id === shellId) || detected.defaultShell
        const targetCwd = customCwd || resolveWorkingDir(ctx, sessionId)
        const cleanEnv = buildCleanEnv()

        let ptyProcess = null
        try {
          ptyProcess = nodePty.spawn(selected.path, selected.args, {
            name: 'xterm-256color',
            cols: Math.max(10, Math.min(cols, 500)),
            rows: Math.max(2, Math.min(rows, 200)),
            cwd: targetCwd,
            env: cleanEnv,
          })
        } catch (spawnErr) {
          return {
            ok: false,
            error: {
              code: 'spawn-failed',
              message: 'Failed to spawn shell: ' + (spawnErr instanceof Error ? spawnErr.message : String(spawnErr)),
            },
          }
        }

        const session = new TerminalSession({
          ptyHandle: ptyProcess,
          shell: selected.name,
          shellPath: selected.path,
          cwd: targetCwd,
          maxBufferBytes: options().scrollbackMaxBytes,
        })
        sessionManager.add(session)

        return {
          ok: true,
          value: {
            id: session.id,
            shell: session.shell,
            shellPath: session.shellPath,
            cwd: session.cwd,
            createdAt: session.createdAt,
          },
        }
      }

      case 'write': {
        const { id, data } = payload
        const session = sessionManager.get(id)
        if (!session) {
          return { ok: false, error: { code: 'not-found', message: 'Terminal session not found' } }
        }
        session.write(typeof data === 'string' ? data : '')
        return { ok: true, value: { written: true } }
      }

      case 'resize': {
        const { id, cols, rows } = payload
        const session = sessionManager.get(id)
        if (!session) {
          return { ok: false, error: { code: 'not-found', message: 'Terminal session not found' } }
        }
        session.resize(cols, rows)
        return { ok: true, value: { resized: true } }
      }

      case 'poll': {
        const { id, offset = 0 } = payload
        const session = sessionManager.get(id)
        if (!session) {
          return { ok: false, error: { code: 'not-found', message: 'Terminal session not found' } }
        }
        const delta = session.readFrom(Number(offset) || 0)
        return { ok: true, value: delta }
      }

      case 'close': {
        const { id } = payload
        const removed = sessionManager.remove(id)
        return { ok: true, value: { closed: removed } }
      }

      default:
        return {
          ok: false,
          error: {
            code: 'unknown-method',
            message: 'Unknown terminal RPC method: ' + method,
          },
        }
    }
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'internal-error',
        message: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/**
 * Register Cordis host plugin.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} [config]
 */
export function apply(ctx, config = {}) {
  const scope = ctx.settings?.register?.(NS, Config, { base: config })
  let settings = scope?.get?.() ?? Config(config)
  scope?.watch?.((next) => {
    settings = next
  })

  const options = () => ({
    defaultShell: settings?.defaultShell ?? '',
    scrollbackMaxBytes: settings?.scrollbackMaxBytes ?? 1024 * 1024,
  })

  ctx.inject(['connection'], (connCtx) => {
    connCtx.connection.rpc.handle(
      RPC_CHANNEL,
      (method, payload, signal) => handleRpc(ctx, options, method, payload, signal),
      { authority: 'trusted-host' },
    )
  })

  // Cleanup on host context disposal
  ctx.on('dispose', () => {
    sessionManager.dispose()
  })
}
