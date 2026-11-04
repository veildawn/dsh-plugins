import net from 'node:net'
import { publishedPort, upstreamPort } from './docker-ports.mjs'

const port = publishedPort()
const upstream = upstreamPort()

const server = net.createServer((client) => {
  const upstreamSocket = net.createConnection({ host: '127.0.0.1', port: upstream })
  client.pipe(upstreamSocket).pipe(client)
  client.on('error', () => upstreamSocket.destroy())
  upstreamSocket.on('error', () => client.destroy())
})

server.on('error', (error) => {
  console.error(error.message)
  process.exit(1)
})

server.listen({ host: '0.0.0.0', port })

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
