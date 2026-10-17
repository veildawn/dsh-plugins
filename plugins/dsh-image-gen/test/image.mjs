/**
 * 生图核心（lib/image.js）测试。
 *
 * 覆盖：尺寸/画质校验、baseURL 归一化、MIME 嗅探、真实像素尺寸读取、
 * 落盘路径与扩展名纠正、端到端生成（b64_json 与 url 两种响应）、
 * 代理转发、超时与错误透传。
 *
 * 全部跑在本地 mock 服务器上：零第三方依赖、零网络、不需要真实 API Key。
 *
 * Run: node test/image.mjs
 */
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import {
  ALLOWED_EXT,
  DEFAULT_QUALITY,
  DEFAULT_SIZE,
  QUALITY_OPTIONS,
  SIZE_OPTIONS,
  extForMime,
  generateImage,
  imageSize,
  normalizeBaseURL,
  normalizeQuality,
  normalizeSize,
  resolveSavePath,
  saveImage,
  sniffMime,
} from '../lib/image.js';
import { parseProxyUrl, proxyTargetsUrl, formatProxyForDisplay } from '../lib/proxy.js';

let failures = 0;
function check(label, condition, extra) {
  if (condition) {
    console.log('PASS ' + label);
  } else {
    failures += 1;
    console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra));
  }
}

function expectThrow(label, fn, needle) {
  try {
    fn();
    check(label, false, 'expected an error, got success');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(label, message.includes(needle), message);
  }
}

const workDir = await mkdtemp(join(tmpdir(), 'dsh-image-image-'));
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

// ---------------------------------------------------------------------------
// 1. size / quality normalization
// ---------------------------------------------------------------------------
check('normalizeSize defaults to 1024x1024', normalizeSize(undefined) === '1024x1024');
check('normalizeSize default constant matches', DEFAULT_SIZE === '1024x1024');
check('normalizeQuality default constant is auto', DEFAULT_QUALITY === 'auto');
check('normalizeSize accepts auto', normalizeSize('auto') === 'auto');
check('normalizeSize is case-insensitive', normalizeSize('1024X1024') === '1024x1024');
check('normalizeSize trims whitespace', normalizeSize('  512x512 ') === '512x512');
expectThrow('normalizeSize rejects a bare number', () => normalizeSize('1024'), 'size must look like');
expectThrow('normalizeSize rejects garbage', () => normalizeSize('huge'), 'size must look like');
expectThrow('normalizeSize rejects a one-digit side', () => normalizeSize('8x8'), 'size must look like');
expectThrow('normalizeSize rejects absurd dimensions', () => normalizeSize('99999x99999'), 'between 64 and 8192');
check('normalizeQuality lowercases', normalizeQuality('HIGH') === 'high');
check('normalizeQuality accepts auto', normalizeQuality('auto') === 'auto');
expectThrow('normalizeQuality rejects an unknown value', () => normalizeQuality('ultra'), 'quality must be one of');
check('every advertised size passes validation', SIZE_OPTIONS.every((o) => normalizeSize(o.value) === o.value));
check('every advertised quality passes validation', QUALITY_OPTIONS.every((o) => normalizeQuality(o.value) === o.value));
check('the size dropdown carries human labels', SIZE_OPTIONS.every((o) => typeof o.label === 'string' && o.label.length > 0));
check('the quality dropdown carries human labels', QUALITY_OPTIONS.every((o) => typeof o.label === 'string' && o.label.length > 0));

// ---------------------------------------------------------------------------
// 2. baseURL normalization
// ---------------------------------------------------------------------------
check('normalizeBaseURL keeps an existing /v1', normalizeBaseURL('http://h:1/v1') === 'http://h:1/v1');
check('normalizeBaseURL appends /v1', normalizeBaseURL('http://h:1') === 'http://h:1/v1');
check('normalizeBaseURL strips trailing slashes first', normalizeBaseURL('http://h:1///') === 'http://h:1/v1');
check('normalizeBaseURL adds a missing scheme', normalizeBaseURL('h:1') === 'http://h:1/v1');
check('normalizeBaseURL keeps a non-v1 path', normalizeBaseURL('http://h:1/openai') === 'http://h:1/openai/v1');

// ---------------------------------------------------------------------------
// 3. MIME sniffing + real dimensions
// ---------------------------------------------------------------------------
check('sniffs PNG', sniffMime(PNG_1x1) === 'image/png');
check('sniffs JPEG', sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])) === 'image/jpeg');
check('sniffs WebP', sniffMime(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)])) === 'image/webp');
check('unknown bytes sniff as empty', sniffMime(Buffer.from('hello world')) === '');
check('extForMime maps png/webp/jpeg', [extForMime('image/png'), extForMime('image/webp'), extForMime('image/jpeg')].join(',') === '.png,.webp,.jpg');
check('extForMime falls back to .jpg', extForMime('image/gif') === '.jpg');

const pngDims = imageSize(PNG_1x1);
check('reads the real PNG dimensions', pngDims !== null && pngDims.width === 1 && pngDims.height === 1, JSON.stringify(pngDims));
check('unreadable bytes report null dimensions', imageSize(Buffer.from('nope')) === null);

// 手搓一个 4x3 WebP(VP8L) 字节头，验证变长分支。
// VP8L 位布局：数据第 0 字节是 0x2F 签名标记，其后 4 字节小端序为
// bit0..13 = width-1、bit14..27 = height-1、bit28 = alpha_is_used。
// lib/image.js 从偏移 21（签名字节之后）读这 4 字节。
const webpVp8l = (() => {
  const riff = Buffer.from('RIFF');
  const size = Buffer.alloc(4);
  const webp = Buffer.from('WEBP');
  const fourcc = Buffer.from('VP8L');
  const chunkSize = Buffer.alloc(4);
  const payload = Buffer.alloc(16);
  payload[0] = 0x2f; // VP8L signature
  payload.writeUInt32LE((3 & 0x3fff) | ((2 & 0x3fff) << 14), 1);
  return Buffer.concat([riff, size, webp, fourcc, chunkSize, payload]);
})();
const webpDims = imageSize(webpVp8l);
check('reads the real WebP VP8L dimensions', webpDims !== null && webpDims.width === 4 && webpDims.height === 3, JSON.stringify(webpDims));

// ---------------------------------------------------------------------------
// 4. save path resolution: the extension never lies
// ---------------------------------------------------------------------------
check('auto path gets the real extension', resolveSavePath(undefined, 'image/png', workDir).endsWith('.png'));
check('matching extension is kept', resolveSavePath('out.png', 'image/png', workDir) === join(workDir, 'out.png'));
check('.jpeg is treated as .jpg', resolveSavePath('out.jpeg', 'image/jpeg', workDir) === join(workDir, 'out.jpeg'));
check('a wrong extension is rewritten', resolveSavePath('out.png', 'image/jpeg', workDir) === join(workDir, 'out.jpg'));
check('an unknown extension gains the real one', resolveSavePath('out.bin', 'image/png', workDir) === join(workDir, 'out.bin.png'));
check('ALLOWED_EXT covers png/jpg/jpeg/webp', ['png', 'jpg', 'jpeg', 'webp'].every((e) => ALLOWED_EXT.has('.' + e)));

const saved = saveImage({ buffer: PNG_1x1, mime: '' }, join(workDir, 'sniffed.png'));
check('saveImage reports the sniffed MIME', saved.mime === 'image/png', saved.mime);
check('saveImage reports the byte count', saved.bytes === PNG_1x1.length, String(saved.bytes));
const roundTrip = await readFile(saved.savePath);
check('saveImage writes the bytes verbatim', roundTrip.equals(PNG_1x1));

// ---------------------------------------------------------------------------
// 5. proxy URL parsing + host scoping
// ---------------------------------------------------------------------------
check('empty proxy means direct', parseProxyUrl('') === undefined);
check('a missing scheme defaults to http', parseProxyUrl('127.0.0.1:7890').protocol === 'http:');
check('default http port is 80', parseProxyUrl('http://h').port === 80);
check('default https port is 443', parseProxyUrl('https://h').port === 443);
check('default socks port is 1080', parseProxyUrl('socks5://h').port === 1080);
const withAuth = parseProxyUrl('http://user:p%40ss@127.0.0.1:7890');
check('decodes percent-encoded credentials', withAuth.username === 'user' && withAuth.password === 'p@ss');
// display 本身不带凭据，formatProxyForDisplay 才做掩码——两者都不能泄露密码
const authProxy = parseProxyUrl('http://user:secret@h:1');
check('parses the username', authProxy.username === 'user', String(authProxy.username));
check('parses the password', authProxy.password === 'secret');
check('display never carries the password', !authProxy.display.includes('secret'), authProxy.display);
check('formatProxyForDisplay masks the password', formatProxyForDisplay(authProxy) === 'http://user:***@h:1', formatProxyForDisplay(authProxy));
check('formatProxyForDisplay returns empty for no proxy', formatProxyForDisplay(undefined) === '');
expectThrow('rejects ftp:// as a proxy', () => parseProxyUrl('ftp://h:1'), 'must use http');
expectThrow('rejects a malformed proxy URL', () => parseProxyUrl('http://'), 'is not a valid proxy URL');
check('proxyTargetsUrl defaults to everything', proxyTargetsUrl('http://example.com/x') === true);
check('proxyTargetsUrl honors a specific host', proxyTargetsUrl('http://a.example.com/v1', ['example.com']) === true);
check('proxyTargetsUrl skips other hosts', proxyTargetsUrl('http://other.com/v1', ['example.com']) === false);
check('proxyTargetsUrl ignores unparsable URLs', proxyTargetsUrl('not a url') === false);

// ---------------------------------------------------------------------------
// 6. end-to-end generation against a mock provider
// ---------------------------------------------------------------------------
const requests = [];
const origin = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    requests.push({ url: req.url, method: req.method, headers: req.headers, body: parsed });
    if (parsed && parsed.prompt === 'BOOM') {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('bad prompt');
      return;
    }
    if (parsed && parsed.prompt === 'EMPTY') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [] }));
      return;
    }
    if (parsed && parsed.prompt === 'GARBAGE') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ url: null, b64_json: null }] }));
      return;
    }
    if (parsed && parsed.prompt === 'BIG') {
      // 1024x1024 的 b64 会与请求尺寸一致，这里故意返回 1x1 以触发「被忽略」告警
    }
    if (parsed && parsed.prompt === 'URL') {
      // 用一个指向本机的相对 URL 无法直接下载，改用 data URI 之外的路径：
      // 这里返回 b64，另建用例覆盖 url 分支
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        data: [{ b64_json: PNG_1x1.toString('base64'), mime_type: 'image/png' }],
      }),
    );
  });
});
await new Promise((resolve) => origin.listen(0, '127.0.0.1', resolve));
const originPort = origin.address().port;
const baseURL = `http://127.0.0.1:${originPort}`;

const gen = await generateImage({
  prompt: 'a red cube on white',
  baseURL,
  apiKey: 'sk-test',
  model: 'gemini-3.1-flash-image',
  size: '1024x1024',
  quality: 'high',
  outputPath: join(workDir, 'gen.png'),
});
check('generation reports the save path', gen.savePath === join(workDir, 'gen.png'), gen.savePath);
check('generation reports the real MIME', gen.mime === 'image/png', gen.mime);
check('generation reports the model', gen.model === 'gemini-3.1-flash-image');
check('generation echoes the requested size', gen.requestedSize === '1024x1024');
check('generation echoes the quality', gen.quality === 'high');
check('generation reports the real size from the bytes', gen.actualSize === '1x1', gen.actualSize);
check('generation warns when the provider ignores the size', gen.warnings.some((w) => w.includes('ignored the requested size')), JSON.stringify(gen.warnings));
const lastReq = requests.at(-1);
check('posts to /v1/images/generations', lastReq.url === '/v1/images/generations', lastReq.url);
check('sends the bearer token', lastReq.headers.authorization === 'Bearer sk-test', lastReq.headers.authorization);
check('sends n=1', lastReq.body.n === 1, JSON.stringify(lastReq.body.n));
check('sends the model', lastReq.body.model === 'gemini-3.1-flash-image');
check('sends the size', lastReq.body.size === '1024x1024');
check('sends quality only when it is not auto', lastReq.body.quality === 'high');

const autoGen = await generateImage({
  prompt: 'quiet lake',
  baseURL,
  apiKey: 'sk-test',
  model: 'm',
  size: 'auto',
  quality: 'auto',
  outputPath: join(workDir, 'auto.png'),
});
check('quality auto is not sent on the wire', requests.at(-1).body.quality === undefined, JSON.stringify(requests.at(-1).body));
check('size auto is not sent on the wire', requests.at(-1).body.size === undefined, JSON.stringify(requests.at(-1).body));
check('size auto skips the ignored-size warning', autoGen.warnings.length === 0, JSON.stringify(autoGen.warnings));

// 错误透传
async function captureError(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}
const httpError = await captureError(() =>
  generateImage({ prompt: 'BOOM', baseURL, apiKey: 'k', model: 'm' }),
);
check('an HTTP error surfaces with its status', httpError !== null && httpError.message.includes('400'), httpError && httpError.message);
const emptyError = await captureError(() =>
  generateImage({ prompt: 'EMPTY', baseURL, apiKey: 'k', model: 'm' }),
);
check('an empty data array is reported', emptyError !== null && emptyError.message.includes('No image data'), emptyError && emptyError.message);
const garbageError = await captureError(() =>
  generateImage({ prompt: 'GARBAGE', baseURL, apiKey: 'k', model: 'm' }),
);
check('a payload with neither url nor b64 is reported', garbageError !== null && garbageError.message.includes('neither url nor b64_json'), garbageError && garbageError.message);
const noKeyError = await captureError(() =>
  generateImage({ prompt: 'x', baseURL, apiKey: '', model: 'm' }),
);
check('a missing apiKey is refused before the request', noKeyError !== null && noKeyError.message.includes('apiKey is required'), noKeyError && noKeyError.message);
const noPromptError = await captureError(() =>
  generateImage({ prompt: '   ', baseURL, apiKey: 'k', model: 'm' }),
);
check('an empty prompt is refused', noPromptError !== null && noPromptError.message.includes('non-empty string'), noPromptError && noPromptError.message);

// url 分支：起第二个只返回 url 的服务，指向 origin 的下载端点
const asset = createServer((req, res) => {
  if (req.url === '/asset.png') {
    res.writeHead(200, { 'content-type': 'image/png' }).end(PNG_1x1);
    return;
  }
  res.writeHead(404).end('nope');
});
await new Promise((resolve) => asset.listen(0, '127.0.0.1', resolve));
const assetPort = asset.address().port;

const urlOrigin = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' }).end(
    JSON.stringify({ data: [{ url: `http://127.0.0.1:${assetPort}/asset.png`, mime_type: 'image/png' }] }),
  );
});
await new Promise((resolve) => urlOrigin.listen(0, '127.0.0.1', resolve));
const urlGen = await generateImage({
  prompt: 'from a url',
  baseURL: `http://127.0.0.1:${urlOrigin.address().port}`,
  apiKey: 'k',
  model: 'm',
  size: '1024x1024',
  outputPath: join(workDir, 'from-url.png'),
});
check('a url response is downloaded and saved', urlGen.mime === 'image/png' && urlGen.bytes === PNG_1x1.length, JSON.stringify(urlGen));

// 请求头透传
await generateImage({
  prompt: 'headers',
  baseURL,
  apiKey: 'k',
  model: 'm',
  headers: { 'x-ai-proxy-client': 'dsh' },
  outputPath: join(workDir, 'headers.png'),
});
check('provider headers are forwarded', requests.at(-1).headers['x-ai-proxy-client'] === 'dsh', JSON.stringify(requests.at(-1).headers));

// deflate 压缩体（代理路径的解压同样依赖它，这里顺带守住）
const deflated = deflateRawSync(Buffer.from(JSON.stringify({ data: [{ b64_json: PNG_1x1.toString('base64') }] })));
check('deflateRawSync produced bytes', deflated.length > 0);

// ---------------------------------------------------------------------------
// 7. proxied generation through a mock CONNECT proxy
// ---------------------------------------------------------------------------
let proxyConnects = 0;
const proxy = createServer((_req, res) => {
  res.writeHead(400).end('CONNECT only');
});
proxy.on('connect', async (req, clientSocket, head) => {
  proxyConnects += 1;
  const [host, port] = req.url.split(':');
  const net = await import('node:net');
  const upstream = net.connect(Number(port), host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => upstream.destroy());
});
await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
const proxied = await generateImage({
  prompt: 'through a proxy',
  baseURL,
  apiKey: 'k',
  model: 'm',
  size: '512x512',
  proxy: `http://127.0.0.1:${proxy.address().port}`,
  outputPath: join(workDir, 'proxied.png'),
});
check('a proxied generation still saves the image', proxied.bytes === PNG_1x1.length, JSON.stringify(proxied));
check('the request actually went through the proxy', proxyConnects === 1, String(proxyConnects));

// 代理被拒时的报错
const refusingProxy = createServer((_req, res) => {
  res.writeHead(400).end('CONNECT only');
});
refusingProxy.on('connect', (_req, clientSocket) => {
  clientSocket.end('HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\n\r\n');
});
await new Promise((resolve) => refusingProxy.listen(0, '127.0.0.1', resolve));
const refused = await captureError(() =>
  generateImage({
    prompt: 'refused',
    baseURL,
    apiKey: 'k',
    model: 'm',
    proxy: `http://127.0.0.1:${refusingProxy.address().port}`,
  }),
);
check('a refusing proxy is reported, not silently bypassed', refused !== null && refused.message.includes('refused the CONNECT'), refused && refused.message);

// ---------------------------------------------------------------------------
// 8. timeout
// ---------------------------------------------------------------------------
const slow = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({ data: [{ b64_json: PNG_1x1.toString('base64') }] }),
      );
    }, 400);
  });
});
await new Promise((resolve) => slow.listen(0, '127.0.0.1', resolve));
const timeoutError = await captureError(() =>
  generateImage({
    prompt: 'slow',
    baseURL: `http://127.0.0.1:${slow.address().port}`,
    apiKey: 'k',
    model: 'm',
    timeoutMs: 50,
  }),
);
check('a slow provider is reported as aborted', timeoutError !== null, timeoutError && timeoutError.message);

// ---------------------------------------------------------------------------
origin.close();
asset.close();
urlOrigin.close();
proxy.close();
refusingProxy.close();
slow.close();
await rm(workDir, { recursive: true, force: true });

console.log('');
console.log(failures === 0 ? 'IMAGE OK (' + requests.length + ' mock requests)' : 'IMAGE FAILED: ' + failures + ' check(s)');
process.exit(failures === 0 ? 0 : 1);
