/**
 * dsh-image-gen 出站代理传输层（零第三方依赖，仅使用 node: 内置模块）。
 *
 * 行为约定：
 *   - 代理地址为空（或未配置）→ 直连，调用方继续用全局 fetch；
 *   - 代理地址非空 → 命中 proxyHosts 的请求全部经该代理转发。
 *
 * 支持的代理协议：
 *   - http://     标准 HTTP 代理，通过 CONNECT 建立隧道
 *   - https://    对代理本身启用 TLS，隧道建立方式同上
 *   - socks5://   本地解析 DNS 后按 IP 发起 SOCKS5 请求
 *   - socks5h://  由代理解析 DNS（直接发送域名）
 *
 * 安全约定：始终校验目标站点的 TLS 证书（不提供关闭校验的开关）；代理地址中的
 * 用户名密码只在网络握手时使用，任何错误信息与前端展示都对其做掩码处理。
 *
 * 实现与 dsh-jev/lib/proxy.js 同源（同一仓库内已验证的隧道 + 单次 Agent 方案），
 * 仅把错误信息前缀与默认主机列表换成本插件的。
 *
 * @module dsh-image-gen/proxy
 */

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { lookup } from 'node:dns/promises';
import { brotliDecompressSync, gunzipSync, inflateRawSync, inflateSync } from 'node:zlib';

/** 默认走代理的目标主机（'*' 表示全部）。 */
export const DEFAULT_PROXY_HOSTS = ['*'];

/** 支持的代理协议集合。 */
const PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks5:', 'socks5h:']);

/** 代理地址省略协议时补全的默认协议。 */
const DEFAULT_PROXY_PROTOCOL = 'http:';

/** 判断字符串是否已带协议前缀（不能依赖 new URL 试错：'host:3128' 会被误判为协议）。 */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** SOCKS5 协议常量。 */
const SOCKS_VERSION = 0x05;
const SOCKS_AUTH_NONE = 0x00;
const SOCKS_AUTH_USERPASS = 0x02;
const SOCKS_AUTH_UNACCEPTABLE = 0xff;
const SOCKS_CMD_CONNECT = 0x01;
const SOCKS_ATYP_IPV4 = 0x01;
const SOCKS_ATYP_DOMAIN = 0x03;
const SOCKS_ATYP_IPV6 = 0x04;

/** 错误信息前缀。 */
const PREFIX = 'image-gen:';

/**
 * 构造与 fetch 语义一致的取消异常（name 固定为 AbortError，便于上层归类为取消）。
 * @param {string} [message] 可选的自定义消息。
 * @returns {Error} 异常实例。
 */
function abortError(message = 'call aborted by the caller') {
  const error = new Error(PREFIX + ' ' + message);
  error.name = 'AbortError';
  return error;
}

/**
 * 解析并校验代理地址。
 *
 * 省略协议时按 http:// 处理；不支持 ftp:// 等其它协议。空值返回 undefined
 * （表示不使用代理），让调用方保持直连行为。
 *
 * @param {unknown} value 候选代理地址。
 * @param {string} [label] 诊断报错中使用的字段名。
 * @returns {{ protocol: string, host: string, port: number, username?: string, password?: string, display: string } | undefined}
 */
export function parseProxyUrl(value, label = 'proxy') {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  if (text === '') return undefined;

  const withScheme = HAS_SCHEME.test(text) ? text : DEFAULT_PROXY_PROTOCOL + '//' + text;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(PREFIX + ' ' + label + ' is not a valid proxy URL: ' + text);
  }
  if (!PROXY_PROTOCOLS.has(url.protocol)) {
    throw new Error(
      PREFIX +
        ' ' +
        label +
        ' must use http, https, socks5 or socks5h (got "' +
        url.protocol.replace(':', '') +
        '")',
    );
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === '') throw new Error(PREFIX + ' ' + label + ' is missing a host: ' + text);

  const fallbackPort = url.protocol === 'http:' ? 80 : url.protocol === 'https:' ? 443 : 1080;
  const port = url.port === '' ? fallbackPort : Number(url.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(PREFIX + ' ' + label + ' has an invalid port: ' + text);
  }

  let username;
  let password;
  try {
    username = url.username === '' ? undefined : decodeURIComponent(url.username);
    password = url.password === '' ? undefined : decodeURIComponent(url.password);
  } catch {
    throw new Error(PREFIX + ' ' + label + ' has malformed percent-encoding in its credentials: ' + text);
  }

  return {
    protocol: url.protocol,
    host,
    port,
    username,
    password,
    /** 不含凭据的规范化地址，用于日志与错误信息。 */
    display: url.protocol + '//' + host + ':' + port,
  };
}

/**
 * 判断某个目标 URL 是否应当走代理。
 *
 * 模式匹配规则：'*' 匹配全部；'example.com' 匹配其自身与所有子域；'.example.com' 等价。
 *
 * @param {string} targetUrl 目标请求地址。
 * @param {string[]} [patterns] 主机模式列表。
 * @returns {boolean}
 */
export function proxyTargetsUrl(targetUrl, patterns = DEFAULT_PROXY_HOSTS) {
  let host;
  try {
    host = new URL(targetUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  for (const raw of patterns ?? []) {
    const pattern = String(raw).trim().toLowerCase();
    if (pattern === '') continue;
    if (pattern === '*') return true;
    const suffix = pattern.startsWith('.') ? pattern.slice(1) : pattern;
    if (host === suffix || host.endsWith('.' + suffix)) return true;
  }
  return false;
}

/**
 * 将代理地址格式化为可安全展示的文本（用户名保留、密码掩码）。
 * @param {object} proxy 代理描述对象。
 * @returns {string}
 */
export function formatProxyForDisplay(proxy) {
  if (!proxy) return '';
  const credentials = proxy.username === undefined ? '' : proxy.username + ':***@';
  return proxy.protocol + '//' + credentials + proxy.host + ':' + proxy.port;
}

/**
 * 规范化代理主机模式列表（支持数组或逗号分隔字符串）。
 *
 * 解析结果为空时回退到 ['*']，避免出现「配置了代理却谁都不走代理」的静默失效状态。
 *
 * @param {unknown} raw 原始配置。
 * @returns {string[]} 规范化后的主机模式数组。
 */
export function normalizeProxyHosts(raw) {
  if (raw === undefined || raw === null) return [...DEFAULT_PROXY_HOSTS];
  const list = (Array.isArray(raw) ? raw : String(raw).split(','))
    .map((item) => String(item).trim().toLowerCase())
    .filter((item) => item !== '');
  return list.length === 0 ? [...DEFAULT_PROXY_HOSTS] : list;
}

/**
 * 将错误信息中可能出现的代理凭据替换为掩码（防御性处理）。
 * @param {string} text 原始文本。
 * @param {object | null} [proxy] 代理描述对象。
 * @returns {string} 掩码后的文本。
 */
function maskCredentials(text, proxy) {
  let out = String(text);
  if (proxy?.password) out = out.split(proxy.password).join('***');
  if (proxy?.username) out = out.split(proxy.username + ':').join(proxy.username + ':***');
  return out;
}

/**
 * 在已建立的 socket 上按需读取字节流的小型读取器。
 *
 * 需要它是因为 CONNECT 响应与 SOCKS5 握手都是「定长头 + 变长体」的二进制协议，
 * 且握手结束后缓冲区里可能残留属于后续 TLS/HTTP 的字节，必须原样交还给调用方。
 *
 * @param {import('node:net').Socket} socket 已连接的 socket。
 * @returns {{ readBytes: (n: number) => Promise<Buffer>, readUntil: (marker: Buffer) => Promise<Buffer>, detach: () => Buffer }} 读取器接口。
 */
function createSocketReader(socket) {
  const state = { buffer: Buffer.alloc(0), pending: null, error: null, ended: false };

  function settle(pending, kind, payload) {
    state.pending = null;
    if (kind === 'reject') pending.reject(payload);
    else pending.resolve(payload);
  }

  function pump() {
    const pending = state.pending;
    if (pending === null) return;
    if (pending.kind === 'bytes') {
      if (state.buffer.length >= pending.n) {
        const out = Buffer.from(state.buffer.subarray(0, pending.n));
        state.buffer = state.buffer.subarray(pending.n);
        settle(pending, 'resolve', out);
      } else if (state.error !== null) {
        settle(pending, 'reject', state.error);
      } else if (state.ended) {
        settle(pending, 'reject', new Error('the proxy closed the connection before the handshake completed'));
      }
      return;
    }
    const at = state.buffer.indexOf(pending.marker);
    if (at !== -1) {
      const out = Buffer.from(state.buffer.subarray(0, at));
      state.buffer = state.buffer.subarray(at + pending.marker.length);
      settle(pending, 'resolve', out);
    } else if (state.error !== null) {
      settle(pending, 'reject', state.error);
    } else if (state.ended) {
      settle(pending, 'reject', new Error('the proxy closed the connection before the handshake completed'));
    }
  }

  socket.on('data', (chunk) => {
    state.buffer = Buffer.concat([state.buffer, chunk]);
    pump();
  });
  socket.on('error', (error) => {
    state.error = error instanceof Error ? error : new Error(String(error));
    if (state.pending) settle(state.pending, 'reject', state.error);
  });
  socket.on('close', () => {
    state.ended = true;
    if (state.pending) pump();
  });

  return {
    readBytes(n) {
      if (state.buffer.length >= n) {
        const out = Buffer.from(state.buffer.subarray(0, n));
        state.buffer = state.buffer.subarray(n);
        return Promise.resolve(out);
      }
      return new Promise((resolve, reject) => {
        state.pending = { kind: 'bytes', n, resolve, reject };
        pump();
      });
    },
    readUntil(marker) {
      const at = state.buffer.indexOf(marker);
      if (at !== -1) {
        const out = Buffer.from(state.buffer.subarray(0, at));
        state.buffer = state.buffer.subarray(at + marker.length);
        return Promise.resolve(out);
      }
      return new Promise((resolve, reject) => {
        state.pending = { kind: 'until', marker, resolve, reject };
      });
    },
    detach() {
      const out = state.buffer;
      state.buffer = Buffer.alloc(0);
      return out;
    },
  };
}

/**
 * 连接到代理服务器。
 * @param {object} proxy 代理描述对象。
 * @param {AbortSignal | undefined} signal 取消信号。
 * @returns {Promise<import('node:net').Socket>}
 */
async function connectToProxy(proxy, signal) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port });
    const onAbort = () => {
      socket.destroy();
      reject(abortError());
    };
    const cleanup = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    socket.on('connect', () => {
      cleanup();
      resolve(socket);
    });
    socket.on('error', (error) => {
      cleanup();
      reject(new Error(PREFIX + ' cannot reach the proxy at ' + proxy.display + ': ' + maskCredentials(error.message, proxy)));
    });
    if (signal) {
      if (signal.aborted) {
        socket.destroy();
        reject(abortError());
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * 通过 HTTP/HTTPS 代理的 CONNECT 方法建立到目标的隧道。
 * @param {object} proxy 代理描述对象。
 * @param {string} host 目标主机。
 * @param {number} port 目标端口。
 * @param {AbortSignal | undefined} signal 取消信号。
 * @returns {Promise<{ socket: import('node:net').Socket, leftover: Buffer }>}
 */
async function openHttpTunnel(proxy, host, port, signal) {
  const socket = await connectToProxy(proxy, signal);
  const reader = createSocketReader(socket);
  const onAbort = () => socket.destroy();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });

  try {
    let head = 'CONNECT ' + host + ':' + port + ' HTTP/1.1\r\nHost: ' + host + ':' + port + '\r\n';
    if (proxy.username !== undefined) {
      const raw = proxy.username + ':' + (proxy.password ?? '');
      head += 'Proxy-Authorization: Basic ' + Buffer.from(raw, 'utf8').toString('base64') + '\r\n';
    }
    head += '\r\n';
    socket.write(head);

    const header = (await reader.readUntil(Buffer.from('\r\n\r\n'))).toString('latin1');
    const statusLine = header.split('\r\n')[0] ?? '';
    const matched = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(statusLine);
    if (!matched || Number(matched[1]) !== 200) {
      const hint =
        matched && Number(matched[1]) === 407
          ? ' (the proxy requires authentication: put user:password@ into the proxy URL)'
          : '';
      throw new Error(PREFIX + ' the proxy at ' + proxy.display + ' refused the CONNECT tunnel: ' + statusLine + hint);
    }
    return { socket, leftover: reader.detach() };
  } catch (error) {
    if (signal) signal.removeEventListener('abort', onAbort);
    socket.destroy();
    if (signal && signal.aborted) throw abortError();
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * 通过 SOCKS5 代理建立到目标的隧道。
 * @param {object} proxy 代理描述对象。
 * @param {string} host 目标主机。
 * @param {number} port 目标端口。
 * @param {AbortSignal | undefined} signal 取消信号。
 * @returns {Promise<{ socket: import('node:net').Socket, leftover: Buffer }>}
 */
async function openSocksTunnel(proxy, host, port, signal) {
  const socket = await connectToProxy(proxy, signal);
  const reader = createSocketReader(socket);
  const onAbort = () => socket.destroy();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });

  try {
    // 1) 方法协商：有凭据时同时提供「无认证」与「用户名密码」两种。
    const methods = proxy.username === undefined ? [SOCKS_AUTH_NONE] : [SOCKS_AUTH_NONE, SOCKS_AUTH_USERPASS];
    socket.write(Buffer.from([SOCKS_VERSION, methods.length, ...methods]));
    const greeting = await reader.readBytes(2);
    if (greeting[0] !== SOCKS_VERSION) {
      throw new Error(PREFIX + ' the proxy at ' + proxy.display + ' did not answer with SOCKS5');
    }
    const method = greeting[1];
    if (method === SOCKS_AUTH_UNACCEPTABLE) {
      throw new Error(PREFIX + ' the SOCKS5 proxy at ' + proxy.display + ' rejected every offered auth method');
    }
    if (method === SOCKS_AUTH_USERPASS) {
      if (proxy.username === undefined) {
        throw new Error(PREFIX + ' the SOCKS5 proxy at ' + proxy.display + ' requires a username and password');
      }
      const user = Buffer.from(proxy.username, 'utf8');
      const pass = Buffer.from(proxy.password ?? '', 'utf8');
      socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]));
      const auth = await reader.readBytes(2);
      if (auth[1] !== 0x00) {
        throw new Error(PREFIX + ' the SOCKS5 proxy at ' + proxy.display + ' rejected the supplied credentials');
      }
    } else if (method !== SOCKS_AUTH_NONE) {
      throw new Error(
        PREFIX + ' the SOCKS5 proxy at ' + proxy.display + ' asked for unsupported auth method 0x' + method.toString(16),
      );
    }

    // 2) 连接请求：socks5h 直接发送域名（由代理解析），socks5 先本地解析成 IP。
    const remoteDns = proxy.protocol === 'socks5h:';
    let addressPart;
    if (remoteDns || net.isIP(host) !== 0) {
      const name = Buffer.from(host, 'utf8');
      if (name.length > 255) throw new Error(PREFIX + ' the target host name is too long for SOCKS5: ' + host);
      addressPart = Buffer.concat([Buffer.from([SOCKS_ATYP_DOMAIN, name.length]), name]);
    } else {
      let resolved;
      try {
        resolved = await lookup(host);
      } catch (error) {
        throw new Error(PREFIX + ' cannot resolve ' + host + ' locally for the SOCKS5 proxy: ' + error.message);
      }
      addressPart =
        resolved.family === 6
          ? Buffer.concat([Buffer.from([SOCKS_ATYP_IPV6]), ipv6ToBytes(resolved.address)])
          : Buffer.concat([Buffer.from([SOCKS_ATYP_IPV4]), ipv4ToBytes(resolved.address)]);
    }
    const portBytes = Buffer.from([(port >> 8) & 0xff, port & 0xff]);
    socket.write(Buffer.concat([Buffer.from([SOCKS_VERSION, SOCKS_CMD_CONNECT, 0x00]), addressPart, portBytes]));

    // 3) 应答：先读 4 字节头，再按地址类型读掉变长的绑定地址与端口。
    const reply = await reader.readBytes(4);
    if (reply[1] !== 0x00) {
      throw new Error(
        PREFIX + ' the SOCKS5 proxy at ' + proxy.display + ' refused the connection: ' + socksReplyMessage(reply[1]),
      );
    }
    if (reply[3] === SOCKS_ATYP_IPV4) await reader.readBytes(4 + 2);
    else if (reply[3] === SOCKS_ATYP_IPV6) await reader.readBytes(16 + 2);
    else if (reply[3] === SOCKS_ATYP_DOMAIN) {
      const length = (await reader.readBytes(1))[0];
      await reader.readBytes(length + 2);
    } else {
      throw new Error(PREFIX + ' the SOCKS5 proxy at ' + proxy.display + ' sent an unknown address type');
    }
    return { socket, leftover: reader.detach() };
  } catch (error) {
    if (signal) signal.removeEventListener('abort', onAbort);
    socket.destroy();
    if (signal && signal.aborted) throw abortError();
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/** 将点分十进制 IPv4 转为 4 字节。 */
function ipv4ToBytes(address) {
  return Buffer.from(address.split('.').map((part) => Number(part) & 0xff));
}

/** 将 IPv6 文本转为 16 字节（处理 :: 压缩写法）。 */
function ipv6ToBytes(address) {
  const [head, tail = ''] = address.split('::');
  const headParts = head === '' ? [] : head.split(':');
  const tailParts = tail === '' ? [] : tail.split(':');
  const fill = new Array(Math.max(0, 8 - headParts.length - tailParts.length)).fill('0');
  const parts = [...headParts, ...fill, ...tailParts].map((part) => parseInt(part === '' ? '0' : part, 16));
  const bytes = Buffer.alloc(16);
  parts.forEach((value, index) => bytes.writeUInt16BE(value & 0xffff, index * 2));
  return bytes;
}

/** 将 SOCKS5 应答码转为可读文本。 */
function socksReplyMessage(code) {
  const messages = {
    0x01: 'general SOCKS server failure',
    0x02: 'connection not allowed by ruleset',
    0x03: 'network unreachable',
    0x04: 'host unreachable',
    0x05: 'connection refused',
    0x06: 'TTL expired',
    0x07: 'command not supported',
    0x08: 'address type not supported',
  };
  return messages[code] ?? 'reply code 0x' + code.toString(16);
}

/**
 * 在已建立隧道的基础上，为目标为 https 的请求补做 TLS 握手。
 * @param {import('node:net').Socket} socket 隧道明文 socket。
 * @param {string} host 目标主机（用于 SNI 与证书校验）。
 * @param {Buffer} leftover 握手期间残留的字节（原样交还给 TLS 层）。
 * @param {AbortSignal | undefined} signal 取消信号。
 * @returns {Promise<import('node:tls').TLSSocket>}
 */
function upgradeToTls(socket, host, leftover, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      socket.destroy();
      reject(abortError());
      return;
    }
    if (leftover.length > 0) socket.unshift(leftover);
    const options = { socket };
    // SNI 不能是 IP 字面量；证书校验仍然按 host 进行。
    if (net.isIP(host) === 0) options.servername = host;
    const onAbort = () => {
      socket.destroy();
      reject(abortError());
    };
    const secured = tls.connect(options, () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(secured);
    });
    secured.once('error', (error) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(
        new Error(
          PREFIX + ' TLS handshake with ' + host + ' through the proxy failed: ' + maskCredentials(error.message, null),
        ),
      );
    });
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** 只负责把预先建立好的 socket 交给 HTTP 客户端的单次 Agent（禁止跨请求复用）。 */
class OneShotHttpAgent extends http.Agent {
  constructor(socket) {
    super({ keepAlive: false, maxSockets: 1 });
    this._socket = socket;
  }

  createConnection(_options, callback) {
    const socket = this._socket;
    this._socket = null;
    process.nextTick(() => callback(null, socket));
    return undefined;
  }
}

/** https 版本：socket 已在 upgradeToTls 中完成握手，此处不再重复 TLS。 */
class OneShotHttpsAgent extends https.Agent {
  constructor(socket) {
    super({ keepAlive: false, maxSockets: 1 });
    this._socket = socket;
  }

  createConnection(_options, callback) {
    const socket = this._socket;
    this._socket = null;
    process.nextTick(() => callback(null, socket));
    return undefined;
  }
}

/**
 * 按 content-encoding 解压响应体（代理路径不会像 fetch 那样自动解压）。
 * @param {Buffer} buffer 原始响应体。
 * @param {string | undefined} encoding content-encoding 头。
 * @returns {string} 解压后的文本。
 */
function decodeBody(buffer, encoding) {
  const value = String(encoding ?? '').trim().toLowerCase();
  if (value === '' || value === 'identity') return buffer.toString('utf8');
  if (value === 'gzip' || value === 'x-gzip') return gunzipSync(buffer).toString('utf8');
  if (value === 'br') return brotliDecompressSync(buffer).toString('utf8');
  if (value === 'deflate') {
    try {
      return inflateSync(buffer).toString('utf8');
    } catch {
      return inflateRawSync(buffer).toString('utf8');
    }
  }
  return buffer.toString('utf8');
}

/**
 * 经由代理发送一次 HTTP 请求，返回与 fetch 兼容的精简响应对象。
 *
 * 响应对象提供 ok / status / statusText / text() / json()，与插件内的 fetch
 * 调用点保持一致，因此 generateImage 无需区分直连与代理两条代码路径。
 *
 * @param {string} targetUrl 目标请求地址。
 * @param {RequestInit} init 请求初始化（method / headers / body / signal）。
 * @param {object} proxy 已解析的代理描述对象。
 * @returns {Promise<{ ok: boolean, status: number, statusText: string, text: () => Promise<string>, json: () => Promise<unknown> }>}
 */
export async function requestViaProxy(targetUrl, init, proxy) {
  const url = new URL(targetUrl);
  const isTls = url.protocol === 'https:';
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(PREFIX + ' the proxy transport only supports http(s) targets, got ' + url.protocol);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const port = url.port === '' ? (isTls ? 443 : 80) : Number(url.port);
  const signal = init && init.signal ? init.signal : undefined;
  const method = (init && init.method) || 'GET';
  const body = init && init.body !== undefined && init.body !== null ? init.body : undefined;

  if (signal && signal.aborted) throw abortError();

  const tunnel =
    proxy.protocol === 'socks5:' || proxy.protocol === 'socks5h:'
      ? await openSocksTunnel(proxy, host, port, signal)
      : await openHttpTunnel(proxy, host, port, signal);

  let socket = tunnel.socket;
  try {
    if (isTls) socket = await upgradeToTls(socket, host, tunnel.leftover, signal);
    else if (tunnel.leftover.length > 0) socket.unshift(tunnel.leftover);
  } catch (error) {
    tunnel.socket.destroy();
    throw error;
  }

  const headers = {};
  for (const [key, value] of Object.entries((init && init.headers) || {})) headers[key.toLowerCase()] = value;
  if (headers.host === undefined) headers.host = url.host;
  if (headers['accept-encoding'] === undefined) headers['accept-encoding'] = 'gzip, deflate, br';

  const transport = isTls ? https : http;
  const agent = isTls ? new OneShotHttpsAgent(socket) : new OneShotHttpAgent(socket);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (kind, payload) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      if (kind === 'reject') reject(payload);
      else resolve(payload);
    };
    const onAbort = () => {
      request.destroy();
      socket.destroy();
      finish('reject', abortError());
    };

    const request = transport.request(
      {
        host,
        port,
        method,
        path: url.pathname + url.search,
        headers,
        agent,
        setHost: false,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const raw = Buffer.concat(chunks);
          let text;
          try {
            text = decodeBody(raw, response.headers['content-encoding']);
          } catch (error) {
            finish('reject', new Error(PREFIX + ' cannot decompress the proxy response: ' + error.message));
            return;
          }
          const status = response.statusCode ?? 0;
          finish('resolve', {
            ok: status >= 200 && status < 300,
            status,
            statusText: response.statusMessage ?? '',
            text: async () => text,
            json: async () => JSON.parse(text),
          });
        });
        response.on('error', (error) => finish('reject', error));
      },
    );

    request.on('error', (error) => {
      if (signal && signal.aborted) {
        finish('reject', abortError());
        return;
      }
      finish(
        'reject',
        new Error(
          PREFIX + ' request to ' + targetUrl + ' through the proxy failed: ' + maskCredentials(error.message, proxy),
        ),
      );
    });
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    if (body !== undefined) request.write(body);
    request.end();
  }).finally(() => {
    agent.destroy();
    socket.destroy();
  });
}
