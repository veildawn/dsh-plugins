import net from 'node:net'

const port = Number(process.env.DSH_PORT ?? '3080')
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('DSH_PORT must be an integer between 1 and 65535')
}

const server = net.createServer((client) => {
  const upstream = net.createConnection({ host: '127.0.0.1', port: 3081 })
  client.pipe(upstream).pipe(client)
  client.on('error', () => upstream.destroy())
  upstream.on('error', () => client.destroy())
})

server.listen({ host: '0.0.0.0', port })

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
