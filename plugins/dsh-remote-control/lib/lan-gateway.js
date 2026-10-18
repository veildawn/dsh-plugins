/**
 * 桌面端局域网入口。
 *
 * 桌面端宿主把 `--host 127.0.0.1` 写死在 Electron IPC 链路里，profile 改绑会让
 * 主进程 `fetch(127.0.0.1:<port>)` 连不上而崩溃。因此这里不动宿主监听，而是在
 * 局域网网卡上另起一个反向代理端口：请求转发到 `127.0.0.1:<webServer.port>`，
 * 于是局域网设备能用 `http://<网卡IP>:<代理端口>` 打开同一个工作区。
 *
 * 代理只做转发与 authority 改写，鉴权仍由宿主的连接会话与远程控制密钥负责。
 *
 * @module dsh-remote-control/lan-gateway
 */
import { createServer, request as httpRequest } from 'node:http'

/** 默认的局域网代理端口，避开宿主 web 端口常用值。 */
export const DEFAULT_LAN_GATEWAY_PORT = 3081

/**
 * 网关标记头：携带浏览器原本的 authority。
 *
 * Host 折成 127.0.0.1 才能过 `connection.admit` 的信任围栏，但插件仍需知道
 * 「这个请求来自局域网」，否则会按回环处理、不给锁屏页而直接回 401。
 */
export const LAN_ORIGIN_HEADER = 'x-dsh-lan-origin'

/** 普通 HTTP 转发要剔除的逐跳头。 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/**
 * WebSocket 升级时**不能**删掉 `connection` 与 `upgrade`：
 * 上游靠这两个头识别升级请求，删了会把握手当普通 GET 处理，
 * 表现为页面能加载但一直「重新连接中」。
 */
const HOP_BY_HOP_UPGRADE = new Set([
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
])

/**
 * 把浏览器带来的 Host/Origin 改写成上游 authority，并记下原始 authority。
 *
 * 上游 `connection.admit` 直接用 `isTrustedApiRequest` 判定，插件无法插手，
 * 而局域网 authority 既不是回环、也不在 `trustedHosts`、也不是绑定地址，
 * 会被判 403。代理在这里把 Host/Origin 折成 `127.0.0.1:<targetPort>`，
 * 让上游按回环处理；原始 authority 放进 {@link LAN_ORIGIN_HEADER}，
 * 让插件仍能识别「来自局域网」，从而下发锁屏页而不是 401。
 */
export function rewriteAuthority(headers, targetPort) {
  const authority = `127.0.0.1:${targetPort}`
  const original = typeof headers.host === 'string' ? headers.host : ''
  if (original) headers[LAN_ORIGIN_HEADER] = original
  headers.host = authority
  const origin = headers.origin
  if (typeof origin === 'string') {
    try {
      const parsed = new URL(origin)
      headers.origin = `${parsed.protocol}//${authority}`
    } catch {
      delete headers.origin
    }
  }
  return headers
}

/** 复制一份去掉逐跳头、并把 authority 折成上游的请求头。 */
function upstreamHeaders(source, targetPort, forUpgrade = false) {
  const headers = { ...source }
  const drop = forUpgrade ? HOP_BY_HOP_UPGRADE : HOP_BY_HOP
  for (const name of drop) delete headers[name]
  return rewriteAuthority(headers, targetPort)
}

/**
 * 启动局域网反向代理。
 * @param {object} options 代理参数。
 * @param {string} options.bindHost 局域网网卡地址，例如 `192.168.50.108`。
 * @param {number} options.port 代理监听端口；0 表示由系统分配。
 * @param {number} options.targetPort 上游 `127.0.0.1` 端口。
 * @param {() => Promise<string|undefined>} [options.mintCookie]
 *   取一份绑定 `127.0.0.1` authority 的会话 Cookie。浏览器自带的 Cookie 绑定的是
 *   局域网 authority，折过 Host 后必然对不上，因此由插件用 launch token 现签。
 * @returns {Promise<{server: import('node:http').Server, close: () => Promise<void>}>}
 *   监听成功后返回 server 与关闭函数；端口占用等错误直接抛出。
 */
export function startLanGateway({ bindHost, port, targetPort, mintCookie }) {
  const withSession = async (source, forUpgrade = false) => {
    const headers = upstreamHeaders(source, targetPort, forUpgrade)
    if (typeof mintCookie !== 'function') return headers
    try {
      const cookie = await mintCookie()
      if (typeof cookie === 'string' && cookie.length > 0) headers.cookie = cookie
      else delete headers.cookie
    } catch {
      delete headers.cookie
    }
    return headers
  }

  const server = createServer(async (req, res) => {
    const upstream = httpRequest({
      host: '127.0.0.1',
      port: targetPort,
      method: req.method,
      path: req.url,
      headers: await withSession(req.headers),
    }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
      upstreamRes.pipe(res)
    })
    upstream.on('error', (error) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('lan gateway: upstream unavailable: ' + (error?.message ?? String(error)))
    })
    req.pipe(upstream)
  })

  // WebSocket 升级同样转发，否则远程页面的 remote.mux 流无法建立。
  server.on('upgrade', (req, socket, head) => {
    void withSession(req.headers, true).then((headers) => {
      const upstream = httpRequest({
        host: '127.0.0.1',
        port: targetPort,
        method: req.method,
        path: req.url,
        headers,
      })
      upstream.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
        const lines = Object.entries(upstreamRes.headers)
          .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
          .join('\r\n')
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines}\r\n\r\n`)
        if (upstreamHead?.length) socket.write(upstreamHead)
        if (head?.length) upstreamSocket.write(head)
        upstreamSocket.pipe(socket).pipe(upstreamSocket)
      })
      upstream.on('error', () => socket.destroy())
      socket.on('error', () => upstream.destroy())
      upstream.end()
    })
  })

  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error)
    server.once('error', onError)
    server.listen(port, bindHost, () => {
      server.off('error', onError)
      resolve({
        server,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}
