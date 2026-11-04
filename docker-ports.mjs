/**
 * The public proxy and the loopback DSH process share one network namespace,
 * so their ports have to differ. 3081 is the internal default; an explicit
 * DSH_PORT=3081 moves DSH off that port instead of failing the bind.
 */
import { pathToFileURL } from 'node:url'

export const DEFAULT_PUBLISHED_PORT = 3080
export const DEFAULT_UPSTREAM_PORT = 3081

export function parsePort(value, name) {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) {
    throw new Error(`${name} must be an integer between 1 and 65535`)
  }
  const port = Number(value)
  if (port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`)
  }
  return port
}

export function publishedPort(env = process.env) {
  const raw = env.DSH_PORT
  if (raw === undefined || raw === '') return DEFAULT_PUBLISHED_PORT
  return parsePort(String(raw), 'DSH_PORT')
}

export function upstreamPort(env = process.env) {
  const published = publishedPort(env)
  const raw = env.DSH_UPSTREAM_PORT
  if (raw !== undefined && raw !== '') {
    const upstream = parsePort(String(raw), 'DSH_UPSTREAM_PORT')
    if (upstream === published) {
      throw new Error('DSH_UPSTREAM_PORT must differ from DSH_PORT')
    }
    return upstream
  }
  return published === DEFAULT_UPSTREAM_PORT ? DEFAULT_UPSTREAM_PORT + 1 : DEFAULT_UPSTREAM_PORT
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  process.stdout.write(`${upstreamPort()}\n`)
}
