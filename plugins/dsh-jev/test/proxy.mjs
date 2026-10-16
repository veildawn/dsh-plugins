/**
 * Proxy transport tests for dsh-jev.
 *
 * Covers the feature end to end at the plugin layer: config validation, the
 * "empty means direct" rule, host scoping, the settings-UI RPC surface, and the
 * real jev_decide execution path going through an HTTP CONNECT proxy.
 *
 * Everything runs against local mock servers: zero third-party dependencies, no
 * DSH process, no real API key, and no external network. The settings file and
 * key file are redirected into a temp dir so the developer's real
 * ~/.config/typesafe/* is never touched.
 *
 * Run: node test/proxy.mjs
 */
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, SETTINGS_RPC_CHANNEL } from '../lib/index.js';
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

async function captureError(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

const workDir = await mkdtemp(join(tmpdir(), 'dsh-jev-proxy-'));
const keyFile = join(workDir, 'key');
const settingsFile = join(workDir, 'settings.json');

const CANNED = {
  model: 'jev-latest',
  answers: { dept: { type: 'choice', choice: 'billing', confidence: 0.6 } },
  usage: { input_tokens: 3, output_tokens: 1 },
};

// ---------------------------------------------------------------------------
// mock origin (the "TypeSafe API")
// ---------------------------------------------------------------------------
const originLog = [];
const origin = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    originLog.push({ url: req.url, method: req.method, headers: req.headers, body: parsed });
    const state = parsed && parsed.state;
    if (state === 'FAIL') { res.writeHead(401, { 'content-type': 'text/plain' }).end('invalid api key'); return; }
    if (state === 'HTTP500') { res.writeHead(500, { 'content-type': 'text/plain' }).end('upstream boom'); return; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(CANNED));
  });
});
await new Promise((resolve) => origin.listen(0, '127.0.0.1', resolve));
const originPort = origin.address().port;
const baseURL = 'http://127.0.0.1:' + originPort;

// ---------------------------------------------------------------------------
// mock CONNECT proxy
// ---------------------------------------------------------------------------
let proxyConnects = 0;
let proxyAuthSeen = null;
let proxyRefuse = false;
const proxyLog = [];
const proxy = createServer((_req, res) => { res.writeHead(400).end('CONNECT only'); });
proxy.on('connect', (req, clientSocket, head) => {
  proxyConnects += 1;
  proxyLog.push(req.url);
  proxyAuthSeen = req.headers['proxy-authorization'] ?? proxyAuthSeen;
  if (proxyRefuse) {
    clientSocket.end('HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\n\r\n');
    return;
  }
  const [host, port] = req.url.split(':');
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
const proxyPort = proxy.address().port;
const proxyUrl = 'http://127.0.0.1:' + proxyPort;

/** Register the plugin against a fake ctx and return { tool, rpc }. */
function register(config) {
  const registered = [];
  let rpcHandler = null;
  const ctx = {
    tools: { register: (definition) => { registered.push(definition); return () => {}; } },
    connection: {
      rpc: {
        handle: (channel, handler) => {
          if (channel === SETTINGS_RPC_CHANNEL) rpcHandler = handler;
          return () => {};
        },
      },
    },
  };
  apply(ctx, { keyFile, settingsFile, ...config });
  return {
    tool: registered[0],
    rpc: (method, payload) => rpcHandler(method, payload),
  };
}

const yQuestion = { q: { type: 'noul', instructions: 'y?' } };
const state = () => ({ state: 'x', questions: yQuestion });
const reset = () => { originLog.length = 0; proxyLog.length = 0; proxyConnects = 0; };

process.env.PROXY_SMOKE_KEY = 'ts_proxy_smoke';

// ---------------------------------------------------------------------------
// 1. config validation
// ---------------------------------------------------------------------------
check('accepts an http proxy in config', register({ proxy: proxyUrl, proxyHosts: ['127.0.0.1'] }).tool !== undefined);
const badProxy = await captureError(() => register({ proxy: 'ftp://127.0.0.1:1' }));
check('rejects a non-proxy protocol', badProxy !== null && badProxy.message.includes('must use http'), badProxy && badProxy.message);
const badProxyUrl = await captureError(() => register({ proxy: 'not a url' }));
check('rejects a malformed proxy URL', badProxyUrl !== null && badProxyUrl.message.includes('proxy'), badProxyUrl && badProxyUrl.message);
check('accepts an empty proxy as direct', register({ proxy: '', proxyHosts: ['127.0.0.1'] }).tool !== undefined);
check('accepts an omitted proxy', register({ proxyHosts: ['127.0.0.1'] }).tool !== undefined);

// ---------------------------------------------------------------------------
// 2. proxy is used only when configured and in scope
// ---------------------------------------------------------------------------
const directTool = register({ baseURL, apiKeyEnv: 'PROXY_SMOKE_KEY', proxyHosts: ['127.0.0.1'] }).tool;
reset();
await directTool.execute(state(), {});
check('no proxy configured => direct connection', proxyConnects === 0 && originLog.length === 1, 'connects=' + proxyConnects);
check('direct request reaches the origin', originLog[0]?.headers.authorization === 'Bearer ts_proxy_smoke', originLog[0]?.headers.authorization);

const scopedOut = register({ baseURL, apiKeyEnv: 'PROXY_SMOKE_KEY', proxy: proxyUrl, proxyHosts: ['typesafe.ai'] }).tool;
reset();
await scopedOut.execute(state(), {});
check('proxy configured but host out of scope => direct', proxyConnects === 0 && originLog.length === 1, 'connects=' + proxyConnects);

const proxied = register({ baseURL, apiKeyEnv: 'PROXY_SMOKE_KEY', proxy: proxyUrl, proxyHosts: ['127.0.0.1'] }).tool;
reset();
const viaProxy = await proxied.execute(state(), {});
check('proxy configured and in scope => tunnels through the proxy', proxyConnects === 1, 'connects=' + proxyConnects);
check('proxied call returns the origin payload', JSON.stringify(viaProxy) === JSON.stringify(CANNED), JSON.stringify(viaProxy));
check('proxied call still carries the Authorization header', originLog[0]?.headers.authorization === 'Bearer ts_proxy_smoke', originLog[0]?.headers.authorization);
check('proxy receives a CONNECT for the target host', proxyLog[0] === '127.0.0.1:' + originPort, proxyLog[0]);

// wildcard scope
const wildcard = register({ baseURL, apiKeyEnv: 'PROXY_SMOKE_KEY', proxy: proxyUrl, proxyHosts: ['*'] }).tool;
reset();
await wildcard.execute(state(), {});
check("proxyHosts ['*'] proxies every host", proxyConnects === 1, 'connects=' + proxyConnects);

// ---------------------------------------------------------------------------
// 3. error paths keep their classification through the proxy
// ---------------------------------------------------------------------------
reset();
const authError = await captureError(() => proxied.execute({ state: 'FAIL', questions: yQuestion }, {}));
check('an HTTP 401 through the proxy is still surfaced with its status', authError !== null && authError.message.includes('HTTP 401'), authError && authError.message);

reset();
proxyRefuse = true;
const refused = await captureError(() => proxied.execute(state(), {}));
proxyRefuse = false;
check('a refused CONNECT is reported as a proxy failure', refused !== null && refused.message.includes('refused the CONNECT tunnel'), refused && refused.message);
check('a refused CONNECT is retried as a network fault (retryable)', refused !== null && refused.message.includes('502'), refused && refused.message);

// retries through the proxy
const retryTool = register({ baseURL, apiKeyEnv: 'PROXY_SMOKE_KEY', proxy: proxyUrl, proxyHosts: ['127.0.0.1'], retries: 1 }).tool;
reset();
await captureError(() => retryTool.execute({ state: 'HTTP500', questions: yQuestion }, {}));
check('retries still re-issue the request through the proxy', proxyConnects === 2, 'connects=' + proxyConnects);

// abort through the proxy
reset();
const preAborted = new AbortController();
preAborted.abort();
const aborted = await captureError(() => proxied.execute(state(), { signal: preAborted.signal }));
check('a pre-aborted call is reported as caller cancellation through the proxy path', aborted !== null && aborted.message.includes('aborted by the caller'), aborted && aborted.message);
check('a pre-aborted call opens no proxy tunnel', proxyConnects === 0, 'connects=' + proxyConnects);

// ---------------------------------------------------------------------------
// 4. RPC surface (settings UI)
// ---------------------------------------------------------------------------
const session = register({ baseURL, apiKeyEnv: 'PROXY_SMOKE_KEY', proxyHosts: ['127.0.0.1'] });

const initial = await session.rpc('getConfig', {});
check('getConfig reports no proxy by default', initial.ok === true && initial.value.proxy === '', JSON.stringify(initial));
check('getConfig reports proxyLocked false when config has no proxy', initial.value.proxyLocked === false, String(initial.value.proxyLocked));

const saved = await session.rpc('saveConfig', { proxy: proxyUrl });
check('saveConfig accepts a valid proxy', saved.ok === true, JSON.stringify(saved));
const onDisk = JSON.parse(await readFile(settingsFile, 'utf8'));
check('saveConfig persists the proxy to the settings file', onDisk.proxy === proxyUrl, JSON.stringify(onDisk));

const afterSave = await session.rpc('getConfig', {});
check('getConfig reads the saved proxy back', afterSave.value.proxy === formatProxyForDisplay(parseProxyUrl(proxyUrl)), afterSave.value.proxy);

// a saved proxy is actually used by the tool without re-registering
reset();
await session.tool.execute(state(), {});
check('a proxy saved from the UI is used by subsequent tool calls', proxyConnects === 1, 'connects=' + proxyConnects);

// credentials are persisted but never returned to the browser
const withCreds = 'http://alice:s3cr3t@127.0.0.1:' + proxyPort;
const savedCreds = await session.rpc('saveConfig', { proxy: withCreds });
check('saveConfig accepts a proxy with credentials', savedCreds.ok === true, JSON.stringify(savedCreds));
const shown = await session.rpc('getConfig', {});
check('getConfig masks the proxy password', shown.value.proxy.includes('***') && !shown.value.proxy.includes('s3cr3t'), shown.value.proxy);
reset();
proxyAuthSeen = null;
await session.tool.execute(state(), {});
check('the saved proxy credentials are sent to the proxy', proxyAuthSeen === 'Basic ' + Buffer.from('alice:s3cr3t').toString('base64'), proxyAuthSeen);

// clearing the proxy restores direct connections
const cleared = await session.rpc('saveConfig', { proxy: '' });
check('saveConfig clears the proxy when given an empty string', cleared.ok === true, JSON.stringify(cleared));
reset();
await session.tool.execute(state(), {});
check('clearing the proxy restores direct connections', proxyConnects === 0 && originLog.length === 1, 'connects=' + proxyConnects);

// invalid proxy is rejected and not persisted
const beforeInvalid = await readFile(settingsFile, 'utf8');
const rejected = await session.rpc('saveConfig', { proxy: 'ftp://127.0.0.1:1' });
check('saveConfig rejects an unsupported proxy protocol', rejected.ok === false, JSON.stringify(rejected));
check('a rejected proxy is not written to disk', (await readFile(settingsFile, 'utf8')) === beforeInvalid);

// ---------------------------------------------------------------------------
// 5. a config-pinned proxy locks the UI field
// ---------------------------------------------------------------------------
const locked = register({ baseURL, apiKeyEnv: 'PROXY_SMOKE_KEY', proxy: proxyUrl, proxyHosts: ['127.0.0.1'] });
const lockedConfig = await locked.rpc('getConfig', {});
check('a config-pinned proxy is reported as locked', lockedConfig.value.proxyLocked === true, JSON.stringify(lockedConfig.value));
const lockedSave = await locked.rpc('saveConfig', { proxy: 'http://127.0.0.1:9' });
check('saveConfig refuses to override a config-pinned proxy', lockedSave.ok === false && lockedSave.error.code === 'proxy-locked', JSON.stringify(lockedSave));
reset();
const lockedTest = await locked.rpc('testConnection', { proxy: '' });
check('testConnection cannot bypass a config-pinned proxy', lockedTest.ok === true && proxyConnects === 1, 'connects=' + proxyConnects);

// ---------------------------------------------------------------------------
// 6. testConnection honours the proxy (including an unsaved one)
// ---------------------------------------------------------------------------
const tester = register({ baseURL, apiKeyEnv: 'PROXY_SMOKE_KEY', proxyHosts: ['127.0.0.1'] });
reset();
const tested = await tester.rpc('testConnection', { proxy: proxyUrl });
check('testConnection succeeds through an unsaved proxy', tested.ok === true && tested.value.durationMs >= 0, JSON.stringify(tested).slice(0, 200));
check('testConnection actually used the proxy', proxyConnects === 1, 'connects=' + proxyConnects);
check('testConnection ping hits the systemone route', originLog[0]?.url === '/v1/systemone', originLog[0]?.url);

reset();
const testedDirect = await tester.rpc('testConnection', {});
check('testConnection without a proxy goes direct', testedDirect.ok === true && proxyConnects === 0, 'connects=' + proxyConnects);

reset();
const testedBad = await tester.rpc('testConnection', { proxy: 'ftp://127.0.0.1:1' });
check('testConnection reports an invalid proxy instead of throwing', testedBad.ok === false, JSON.stringify(testedBad));

// an explicitly emptied field tests a DIRECT connection, even with one saved
await tester.rpc('saveConfig', { proxy: proxyUrl });
reset();
const testedCleared = await tester.rpc('testConnection', { proxy: '' });
check('an emptied proxy field tests a direct connection', testedCleared.ok === true && proxyConnects === 0, 'connects=' + proxyConnects);
reset();
const testedSaved = await tester.rpc('testConnection', {});
check('an omitted proxy field still uses the saved proxy', testedSaved.ok === true && proxyConnects === 1, 'connects=' + proxyConnects);
await tester.rpc('saveConfig', { proxy: '' });

// a masked value coming back from getConfig must not be sent as a literal proxy
const maskedSession = register({ baseURL, apiKeyEnv: 'PROXY_SMOKE_KEY', proxyHosts: ['127.0.0.1'] });
await maskedSession.rpc('saveConfig', { proxy: withCreds });
reset();
const maskedTest = await maskedSession.rpc('testConnection', { proxy: 'http://alice:***@127.0.0.1:' + proxyPort });
check('testConnection falls back to the saved proxy for a masked value', maskedTest.ok === true && proxyConnects === 1, 'connects=' + proxyConnects);

// ---------------------------------------------------------------------------
// 6b. baseURL configuration and persistence
// ---------------------------------------------------------------------------
const baseURLSession = register({ apiKeyEnv: 'PROXY_SMOKE_KEY' });
const baseInitial = await baseURLSession.rpc('getConfig', {});
check('getConfig reports default official baseURL when unpinned', baseInitial.value.baseURL === 'https://api.typesafe.ai', baseInitial.value.baseURL);
check('getConfig reports baseURLLocked false when config has no baseURL', baseInitial.value.baseURLLocked === false, String(baseInitial.value.baseURLLocked));

// save custom baseURL
const customBaseURL = 'http://127.0.0.1:' + originPort;
const baseSaved = await baseURLSession.rpc('saveConfig', { baseURL: customBaseURL });
check('saveConfig accepts a valid custom baseURL', baseSaved.ok === true, JSON.stringify(baseSaved));
const onDiskBase = JSON.parse(await readFile(settingsFile, 'utf8'));
check('saveConfig persists the baseURL to the settings file', onDiskBase.baseURL === customBaseURL, JSON.stringify(onDiskBase));

const baseAfterSave = await baseURLSession.rpc('getConfig', {});
check('getConfig reads the saved baseURL back', baseAfterSave.value.baseURL === customBaseURL, baseAfterSave.value.baseURL);

// subsequent tool calls use the saved baseURL
reset();
await baseURLSession.tool.execute(state(), {});
check('a custom baseURL saved from UI is used by subsequent tool calls', originLog.length === 1 && originLog[0].url === '/v1/systemone', 'originLog=' + originLog.length);

// testConnection with unsaved baseURL
reset();
const testCustom = await baseURLSession.rpc('testConnection', { baseURL: customBaseURL });
check('testConnection succeeds with custom baseURL', testCustom.ok === true, JSON.stringify(testCustom));
check('testConnection actually reached the custom baseURL origin', originLog.length === 1 && originLog[0].url === '/v1/systemone', 'originLog=' + originLog.length);

// invalid baseURL is rejected
const beforeBadBase = await readFile(settingsFile, 'utf8');
const badBaseRes = await baseURLSession.rpc('saveConfig', { baseURL: 'ftp://127.0.0.1:8000' });
check('saveConfig rejects an unsupported baseURL protocol', badBaseRes.ok === false, JSON.stringify(badBaseRes));
check('a rejected baseURL is not written to disk', (await readFile(settingsFile, 'utf8')) === beforeBadBase);

// clearing custom baseURL restores official default
const baseCleared = await baseURLSession.rpc('saveConfig', { baseURL: '' });
check('saveConfig clears the baseURL when given an empty string', baseCleared.ok === true, JSON.stringify(baseCleared));
const baseAfterClear = await baseURLSession.rpc('getConfig', {});
check('clearing baseURL restores default official address', baseAfterClear.value.baseURL === 'https://api.typesafe.ai', baseAfterClear.value.baseURL);

// config-pinned baseURL locks the field and prevents override
const lockedBase = register({ baseURL: customBaseURL, apiKeyEnv: 'PROXY_SMOKE_KEY' });
const lockedBaseConfig = await lockedBase.rpc('getConfig', {});
check('a config-pinned baseURL is reported as locked', lockedBaseConfig.value.baseURLLocked === true, JSON.stringify(lockedBaseConfig.value));
const lockedBaseSave = await lockedBase.rpc('saveConfig', { baseURL: 'http://127.0.0.1:9999' });
check('saveConfig refuses to override a config-pinned baseURL', lockedBaseSave.ok === false && lockedBaseSave.error.code === 'base-url-locked', JSON.stringify(lockedBaseSave));

// testConnection cannot bypass config-pinned baseURL
reset();
const lockedBaseTest = await lockedBase.rpc('testConnection', { baseURL: 'http://127.0.0.1:9999' });
check('testConnection cannot bypass a config-pinned baseURL', lockedBaseTest.ok === true && originLog.length === 1, 'originLog=' + originLog.length);

// testConnection reports invalid baseURL gracefully
const testBadBase = await baseURLSession.rpc('testConnection', { baseURL: 'not a valid url' });
check('testConnection reports an invalid baseURL instead of throwing', testBadBase.ok === false, JSON.stringify(testBadBase));

// ---------------------------------------------------------------------------
// 7. the real key file is never touched by these tests
// ---------------------------------------------------------------------------
check('tests never wrote the real ~/.config/typesafe/key', !keyFile.startsWith(process.env.HOME + '/.config/typesafe'), keyFile);

// ---------------------------------------------------------------------------
// 8. unit-level helpers
// ---------------------------------------------------------------------------
check('proxyTargetsUrl matches subdomains', proxyTargetsUrl('https://api.typesafe.ai/v1', ['typesafe.ai']));
check('proxyTargetsUrl rejects lookalike domains', !proxyTargetsUrl('https://evil-typesafe.ai/', ['typesafe.ai']));
check('formatProxyForDisplay hides the password', formatProxyForDisplay(parseProxyUrl('http://u:p@h:1')) === 'http://u:***@h:1', formatProxyForDisplay(parseProxyUrl('http://u:p@h:1')));

// ---------------------------------------------------------------------------
// 9. SOCKS5 transport (no-auth and username/password)
// ---------------------------------------------------------------------------
let socksTunnels = 0;
let socksUser = null;
const socks = net.createServer((socket) => {
  let stage = 'greeting';
  let buffer = Buffer.alloc(0);
  const onData = (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (stage === 'greeting') {
      if (buffer.length < 2 + buffer[1]) return;
      const methods = buffer.subarray(2, 2 + buffer[1]);
      buffer = buffer.subarray(2 + buffer[1]);
      // Offer username/password when the client does, to exercise that branch.
      if (methods.includes(0x02)) {
        socket.write(Buffer.from([0x05, 0x02]));
        stage = 'auth';
        onData(Buffer.alloc(0));
        return;
      }
      socket.write(Buffer.from([0x05, 0x00]));
      stage = 'request';
      onData(Buffer.alloc(0));
      return;
    }
    if (stage === 'auth') {
      if (buffer.length < 2) return;
      const userLength = buffer[1];
      if (buffer.length < 2 + userLength + 1) return;
      const passLength = buffer[2 + userLength];
      if (buffer.length < 2 + userLength + 1 + passLength) return;
      socksUser = buffer.subarray(2, 2 + userLength).toString();
      buffer = buffer.subarray(2 + userLength + 1 + passLength);
      socket.write(Buffer.from([0x01, 0x00]));
      stage = 'request';
      onData(Buffer.alloc(0));
      return;
    }
    if (stage === 'request') {
      if (buffer.length < 4) return;
      const atyp = buffer[3];
      let host;
      let rest;
      if (atyp === 0x01) {
        if (buffer.length < 10) return;
        host = Array.from(buffer.subarray(4, 8)).join('.');
        rest = buffer.subarray(8);
      } else if (atyp === 0x03) {
        const length = buffer[4];
        if (buffer.length < 5 + length + 2) return;
        host = buffer.subarray(5, 5 + length).toString();
        rest = buffer.subarray(5 + length);
      } else {
        socket.destroy();
        return;
      }
      const port = rest.readUInt16BE(0);
      stage = 'tunnel';
      const upstream = net.connect(port, host === 'localhost' ? '127.0.0.1' : host, () => {
        socksTunnels += 1;
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      upstream.on('error', () => socket.destroy());
      return;
    }
  };
  socket.on('data', onData);
  socket.on('error', () => {});
});
await new Promise((resolve) => socks.listen(0, '127.0.0.1', resolve));
const socksPort = socks.address().port;

const socksTool = register({ baseURL, apiKeyEnv: 'PROXY_SMOKE_KEY', proxy: 'socks5://127.0.0.1:' + socksPort, proxyHosts: ['127.0.0.1'] }).tool;
reset();
socksTunnels = 0;
const socksResult = await socksTool.execute(state(), {});
check('socks5:// proxies a real tool call', socksTunnels === 1 && JSON.stringify(socksResult) === JSON.stringify(CANNED), 'tunnels=' + socksTunnels);

reset();
socksTunnels = 0;
const sockshTool = register({ baseURL, apiKeyEnv: 'PROXY_SMOKE_KEY', proxy: 'socks5h://127.0.0.1:' + socksPort, proxyHosts: ['127.0.0.1'] }).tool;
await sockshTool.execute(state(), {});
check('socks5h:// proxies a real tool call (remote DNS)', socksTunnels === 1, 'tunnels=' + socksTunnels);

reset();
socksTunnels = 0;
socksUser = null;
const socksAuthTool = register({ baseURL, apiKeyEnv: 'PROXY_SMOKE_KEY', proxy: 'socks5://bob:pw@127.0.0.1:' + socksPort, proxyHosts: ['127.0.0.1'] }).tool;
await socksAuthTool.execute(state(), {});
check('socks5:// with credentials authenticates', socksUser === 'bob' && socksTunnels === 1, 'user=' + socksUser + ' tunnels=' + socksTunnels);

// a SOCKS5 proxy that refuses the connection is surfaced as a proxy failure
const socksRefuse = net.createServer((socket) => {
  socket.once('data', () => {
    socket.write(Buffer.from([0x05, 0x00]));
    socket.once('data', () => socket.end(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0])));
  });
  socket.on('error', () => {});
});
await new Promise((resolve) => socksRefuse.listen(0, '127.0.0.1', resolve));
const socksRefuseTool = register({ baseURL, apiKeyEnv: 'PROXY_SMOKE_KEY', proxy: 'socks5://127.0.0.1:' + socksRefuse.address().port, proxyHosts: ['127.0.0.1'] }).tool;
const socksRefused = await captureError(() => socksRefuseTool.execute(state(), {}));
check('a refused SOCKS5 connection is surfaced with its reason', socksRefused !== null && socksRefused.message.includes('connection refused'), socksRefused && socksRefused.message);
socksRefuse.close();
socks.close();

origin.close();
proxy.close();
await rm(workDir, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// 10. HTTPS target through the proxy (the production shape)
// ---------------------------------------------------------------------------
// Run in a child process: trusting the fixture CA requires NODE_EXTRA_CA_CERTS,
// which Node only reads at startup. Certificate verification stays ENABLED in
// the child, so this also proves a wrong-host certificate is still rejected.
const testDir = dirname(fileURLToPath(import.meta.url));
const httpsRun = spawnSync(process.execPath, [join(testDir, 'proxy-https.mjs')], {
  encoding: 'utf8',
  timeout: 60000,
  env: {
    ...process.env,
    NODE_EXTRA_CA_CERTS: join(testDir, 'fixtures', 'ca.pem'),
    JEV_TEST_CA: join(testDir, 'fixtures', 'ca.pem'),
    JEV_TEST_CERT: join(testDir, 'fixtures', 'server-cert.pem'),
    JEV_TEST_KEY: join(testDir, 'fixtures', 'server-key.pem'),
  },
});
for (const line of String(httpsRun.stdout ?? '').split('\n')) {
  if (line.startsWith('PASS ') || line.startsWith('FAIL ')) console.log(line);
}
if (httpsRun.error) {
  check('the https-through-proxy child process runs', false, httpsRun.error.message);
} else if (httpsRun.status !== 0) {
  const detail = String(httpsRun.stderr ?? '').trim().split('\n').slice(-3).join(' | ');
  check('the https-through-proxy child process passes', false, 'status=' + httpsRun.status + ' ' + detail.slice(0, 300));
} else {
  check('the https-through-proxy child process passes', true);
}

console.log('');
console.log(failures === 0 ? 'PROXY OK' : 'PROXY FAILED: ' + failures + ' check(s)');
process.exit(failures === 0 ? 0 : 1);
