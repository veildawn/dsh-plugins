/**
 * HTTPS-through-proxy scenario for dsh-jev, run as a CHILD process by
 * test/proxy.mjs.
 *
 * It is a separate file on purpose: trusting the test CA requires
 * NODE_EXTRA_CA_CERTS, which Node only reads at startup, so the parent must set
 * it before this process boots.
 *
 * What it proves (the production shape: https://api.typesafe.ai):
 *   - a plain tunneled socket is upgraded to TLS and the request succeeds;
 *   - SNI and the Host header carry the real target hostname;
 *   - certificate verification stays ON (a wrong-host certificate is rejected).
 *
 * Env (set by the parent): JEV_TEST_CA, JEV_TEST_CERT, JEV_TEST_KEY.
 * Exit 0 = all assertions passed.
 */
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../lib/index.js';

let failures = 0;
function check(label, condition, extra) {
  if (condition) {
    console.log('PASS ' + label);
  } else {
    failures += 1;
    console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra));
  }
}

const key = readFileSync(process.env.JEV_TEST_KEY);
const cert = readFileSync(process.env.JEV_TEST_CERT);
const TARGET_HOST = 'api.typesafe.test';

const origin = https.createServer({ key, cert }, (req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      answers: { dept: { type: 'choice', choice: 'billing' } },
      servername: req.socket.servername,
      host: req.headers.host,
    }));
  });
});
await new Promise((resolve) => origin.listen(0, '127.0.0.1', resolve));
const originPort = origin.address().port;

let connects = 0;
// The client asks the proxy for the unresolvable production-style hostname;
// the proxy maps that onto the local origin.
const proxy = http.createServer((_req, res) => { res.writeHead(400).end('CONNECT only'); });
proxy.on('connect', (req, clientSocket, head) => {
  connects += 1;
  const upstream = net.connect(originPort, '127.0.0.1', () => {
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

const workDir = await mkdtemp(join(tmpdir(), 'jev-proxy-https-'));
const baseURL = 'https://' + TARGET_HOST + ':' + originPort;
process.env.HTTPS_PROXY_KEY = 'ts_https_proxy';

function register(config) {
  const registered = [];
  apply(
    { tools: { register: (definition) => { registered.push(definition); return () => {}; } } },
    { keyFile: join(workDir, 'key'), settingsFile: join(workDir, 'settings.json'), ...config },
  );
  return registered[0];
}

const question = { q: { type: 'noul', instructions: 'y?' } };

// 1) happy path: TLS is negotiated through the tunnel and the CA is trusted
const tool = register({
  baseURL,
  apiKeyEnv: 'HTTPS_PROXY_KEY',
  proxy: 'http://127.0.0.1:' + proxyPort,
  proxyHosts: ['typesafe.test'],
});
connects = 0;
const result = await tool.execute({ state: 'x', questions: question }, {});
check('https target is fetched through the proxy', connects === 1, 'connects=' + connects);
check('the TLS upgrade returns the origin payload', result.answers.dept.choice === 'billing', JSON.stringify(result));
check('SNI carries the real hostname', result.servername === TARGET_HOST, String(result.servername));
check('the Host header carries the real hostname and port', result.host === TARGET_HOST + ':' + originPort, String(result.host));

// 2) certificate verification must NOT be disabled: the certificate is only
//    valid for api.typesafe.test, so requesting a different name must fail.
const mismatch = register({
  baseURL: 'https://localhost:' + originPort,
  apiKeyEnv: 'HTTPS_PROXY_KEY',
  proxy: 'http://127.0.0.1:' + proxyPort,
  proxyHosts: ['localhost'],
});
try {
  await mismatch.execute({ state: 'x', questions: question }, {});
  check('a wrong-host certificate is rejected', false, 'the request unexpectedly succeeded');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  check('a wrong-host certificate is rejected', /certificate|altnames|unable to verify|self.signed/i.test(message), message.slice(0, 200));
}

origin.close();
proxy.close();
console.log('');
console.log(failures === 0 ? 'PROXY-HTTPS OK' : 'PROXY-HTTPS FAILED: ' + failures + ' check(s)');
process.exit(failures === 0 ? 0 : 1);
