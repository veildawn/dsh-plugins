/**
 * Smoke test for dsh-plugin-jev: registers the tool against a mock ctx and
 * executes it against a mock official TypeSafe endpoint, covering the
 * transport migration guard, key resolution, validation, cancellation,
 * response envelopes, retries, and concurrency. No DSH process and no real API
 * key required.
 *
 * Every request is recorded in `requestLog` (never a single last-request
 * global) so assertions stay correct under concurrent executes.
 *
 * Run: node test/smoke.mjs
 */
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
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

async function expectError(label, fn, expectedSubstring) {
  try {
    await fn();
    check(label, false, 'expected an error, got success');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(label, message.includes(expectedSubstring), message);
  }
}

/** Run fn and return the thrown Error (or null when it succeeded). */
async function captureError(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

const CANNED = {
  model: 'jev-latest',
  answers: {
    dept: {
      type: 'choice',
      choice: 'billing',
      probabilities: { billing: 0.84, technical: 0.159, sales: 0.001 },
      confidence: 0.596,
    },
    urgent: { type: 'noul', noul: 0.999 },
  },
  usage: { input_tokens: 312, output_tokens: 48 },
};

/** Per-request log: { url, method, headers, body }. */
const requestLog = [];
const server = createServer((req, res) => {
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
    requestLog.push({ url: req.url, method: req.method, headers: req.headers, body: parsed });

    const send = (status, payload, delayMs = 0) => {
      const write = () => {
        const isJson = status === 200;
        res
          .writeHead(status, { 'content-type': isJson ? 'application/json' : 'text/plain' })
          .end(isJson ? JSON.stringify(payload) : String(payload));
      };
      if (delayMs > 0) setTimeout(write, delayMs);
      else write();
    };

    if (req.method === 'POST' && req.url === '/v1/systemone') {
      const state = parsed && parsed.state;
      if (state === 'FAIL') {
        send(401, 'invalid api key');
        return;
      }
      if (typeof state === 'string' && state.startsWith('HTTP500')) {
        send(500, 'upstream boom');
        return;
      }
      if (state === 'HTTP429') {
        send(429, 'rate limited');
        return;
      }
      if (state === 'EMPTYOBJ') {
        send(200, {});
        return;
      }
      if (state === 'EMPTYARR') {
        send(200, []);
        return;
      }
      if (state === 'SLOW') {
        send(200, CANNED, 400);
        return;
      }
      if (state === 'SLOWRETRY') {
        send(200, CANNED, 400);
        return;
      }
      if (state === 'CONC-A') {
        send(200, { answers: { dept: { type: 'choice', choice: 'CONC-A' } } }, 120);
        return;
      }
      if (state === 'CONC-B') {
        send(200, { answers: { dept: { type: 'choice', choice: 'CONC-B' } } }, 10);
        return;
      }
      send(200, CANNED);
      return;
    }
    send(404, 'not found');
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseURL = 'http://127.0.0.1:' + server.address().port;

const nativeRequests = () => requestLog.filter((entry) => entry.url === '/v1/systemone');
const lastNative = () => nativeRequests().at(-1) ?? { headers: {}, body: null };
const callsWithState = (state) => nativeRequests().filter((entry) => entry.body && entry.body.state === state).length;

function register(config) {
  const registered = [];
  apply({ tools: { register: (definition) => { registered.push(definition); return () => {}; } } }, config);
  return registered;
}

/** Minimal validator mirroring what the registry does with output.schema. */
function outputSchemaViolation(value) {
  const schema = tool.output.schema;
  if (schema.type === 'object' && (value === null || typeof value !== 'object' || Array.isArray(value))) {
    return 'value must be an object';
  }
  for (const key of schema.required ?? []) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return 'missing required "' + key + '"';
  }
  const answers = schema.properties?.answers;
  if (answers && answers.type === 'object') {
    const inner = value.answers;
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) {
      return 'answers must be an object';
    }
  }
  return null;
}

process.env.SMOKE_KEY = 'ts_smoke';

// --- registration ---------------------------------------------------------
const tools = register({ baseURL, apiKeyEnv: 'SMOKE_KEY', model: 'jev-test', timeoutMs: 5000 });
check('registers exactly one tool', tools.length === 1, String(tools.length));
const tool = tools[0];
check('tool name is jev_decide', tool.name === 'jev_decide', tool.name);
check('declares output.render', typeof tool.output.render === 'function');
check('declares output.schema object root', tool.output.schema.type === 'object');
check('declares a positive timeoutMs', typeof tool.timeoutMs === 'number' && tool.timeoutMs > 5000, String(tool.timeoutMs));
check('parameters require state and questions', Array.isArray(tool.parameters.required) && tool.parameters.required.join(',') === 'state,questions');
check('declares isConcurrencySafe true (F8)', typeof tool.isConcurrencySafe === 'function' && tool.isConcurrencySafe() === true);
const rendered = tool.output.render({}, CANNED);
check('render emits one text block', Array.isArray(rendered) && rendered.length === 1 && rendered[0].type === 'text');
check('render text carries the answers', rendered[0].text.includes('"choice": "billing"'), rendered[0].text.slice(0, 80));
check('description documents the noul answer field', tool.description.includes('answers[key].noul'), tool.description.slice(0, 120));
check('description drops the retired .probability spelling', !tool.description.includes('.probability'), tool.description);
// Trigger policy anchors (SPEC feature-jev-trigger-policy, acceptance criterion "normal path A"):
// the tool description must read as policy, not as documentation. Verbatim substrings
// come from outputs.schema(1); do not loosen them to match the implementation.
for (const anchor of ['When to use', 'Exempt only when', 'Decision moments', 'Budget:']) {
  check('description carries the policy anchor ' + JSON.stringify(anchor), tool.description.includes(anchor), tool.description.slice(0, 160));
}
check(
  'description drops the retired AI Gateway wording',
  !tool.description.toLowerCase().includes('ai gateway'),
  tool.description.slice(0, 120),
);
check(
  'question schema keeps the noul contract',
  tool.parameters.properties.questions.description.includes('answers[key].noul'),
  tool.parameters.properties.questions.description,
);
check(
  'question schema drops the retired vendor model id',
  !JSON.stringify(tool.parameters).includes('typesafe-ai/jev'),
  JSON.stringify(tool.parameters).slice(0, 120),
);

// --- typesafe transport: happy path ---------------------------------------
const questions = {
  dept: { type: 'choice', instructions: 'Which team handles this', criteria: { billing: 'payments', technical: 'bugs' } },
  urgent: { type: 'noul', instructions: 'Does the message convey urgency?' },
};
const result = await tool.execute(
  { state: 'Customer cannot connect Stripe for 3 days', questions },
  { signal: new AbortController().signal },
);
check('returns the API body unchanged', JSON.stringify(result) === JSON.stringify(CANNED));
check('sends the configured bearer token', lastNative().headers.authorization === 'Bearer ts_smoke', String(lastNative().headers.authorization));
check('uses the configured default model', lastNative().body.model === 'jev-test', JSON.stringify(lastNative().body && lastNative().body.model));
check('forwards state verbatim', lastNative().body.state === 'Customer cannot connect Stripe for 3 days');
check('forwards the question map verbatim', JSON.stringify(lastNative().body.questions) === JSON.stringify(questions));

await tool.execute({ state: 'x', model: 'jev-latest', questions: { q: { type: 'noul', instructions: 'y?' } } }, {});
check('honors a per-call model override', lastNative().body.model === 'jev-latest');
const defaultTool = register({ baseURL, apiKeyEnv: 'SMOKE_KEY' })[0];
await defaultTool.execute({ state: 'x', questions: { q: { type: 'noul', instructions: 'y?' } } }, {});
check('unconfigured model defaults to jev-latest', lastNative().body.model === 'jev-latest', String(lastNative().body && lastNative().body.model));

// --- migration guard: the Vercel transport is gone ------------------------
const retiredError = await captureError(() =>
  register({
    transport: 'vercel',
    gatewayBaseURL: baseURL + '/gateway',
    apiKeyEnv: 'GW_KEY',
    timeoutMs: 5000,
  }),
);
const retiredMessage = retiredError ? retiredError.message : '<no error>';
check('a retired transport is refused at registration', retiredError !== null, retiredMessage);
check('the migration error says the transport was removed', retiredMessage.includes('removed'), retiredMessage);
check('the migration error points at typesafe', retiredMessage.includes('typesafe'), retiredMessage);
check(
  'a retired transport is refused before any key lookup',
  !retiredMessage.includes('no API key'),
  retiredMessage,
);
check(
  'the migration error never silently falls back',
  retiredMessage.includes('got "vercel"') && retiredMessage.includes('only transport "typesafe"'),
  retiredMessage,
);
const explicitTypesafe = register({ transport: 'typesafe', baseURL, apiKeyEnv: 'SMOKE_KEY', timeoutMs: 5000 });
check(
  'typesafe still registers after the guard',
  explicitTypesafe.length === 1 && explicitTypesafe[0].name === 'jev_decide',
  String(explicitTypesafe.length),
);
const defaultTransport = register({ baseURL, apiKeyEnv: 'SMOKE_KEY' });
check(
  'an absent transport still defaults to typesafe',
  defaultTransport.length === 1 && defaultTransport[0].name === 'jev_decide',
  String(defaultTransport.length),
);

// --- boolean alias normalizes to noul on the official wire ----------------
await tool.execute({ state: 'x', questions: { q: { type: 'boolean', instructions: 'y?' } } }, {});
check(
  "normalizes a 'boolean' alias to 'noul' on the wire",
  lastNative().body.questions.q.type === 'noul',
  JSON.stringify(lastNative().body.questions),
);

// --- key resolution -------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), 'jev-smoke-'));
const keyFile = join(dir, 'key');
await writeFile(keyFile, 'ts_from_file\n', 'utf8');
const fileTool = register({ baseURL, apiKeyEnv: 'NO_SUCH_ENV_VAR', keyFile })[0];
delete process.env.JEV_API_KEY;
delete process.env.TYPESAFE_API_KEY;
await fileTool.execute({ state: 'x', questions: { q: { type: 'noul', instructions: 'y?' } } }, {});
check('falls back to the key file', lastNative().headers.authorization === 'Bearer ts_from_file', String(lastNative().headers.authorization));
process.env.JEV_API_KEY = 'ts_from_jev_env';
const envTool = register({ baseURL, apiKeyEnv: 'NO_SUCH_ENV_VAR', keyFile: '/nonexistent/key' })[0];
await envTool.execute({ state: 'x', questions: { q: { type: 'noul', instructions: 'y?' } } }, {});
check('falls back to JEV_API_KEY', lastNative().headers.authorization === 'Bearer ts_from_jev_env', String(lastNative().headers.authorization));
delete process.env.JEV_API_KEY;
await rm(dir, { recursive: true, force: true });

const keylessTool = register({ baseURL, apiKeyEnv: 'NO_SUCH_ENV_VAR', keyFile: '/nonexistent/key' })[0];
await expectError(
  'reports a missing key with all sources',
  () => keylessTool.execute({ state: 'x', questions: { q: { type: 'noul', instructions: 'y?' } } }, {}),
  'no API key',
);

// --- validation and transport errors --------------------------------------
process.env.SMOKE_KEY = 'ts_smoke';
await expectError(
  'rejects an empty state',
  () => tool.execute({ state: '   ', questions }, {}),
  'state must be a non-empty string',
);
await expectError(
  'rejects an unknown question type',
  () => tool.execute({ state: 'x', questions: { q: { type: 'label', instructions: 'y?' } } }, {}),
  'must be one of',
);
await expectError(
  'rejects a choice without criteria',
  () => tool.execute({ state: 'x', questions: { q: { type: 'choice', instructions: 'y?' } } }, {}),
  'criteria is required',
);
await expectError(
  'rejects an empty question map',
  () => tool.execute({ state: 'x', questions: {} }, {}),
  'at least one question',
);
await expectError(
  'surfaces an HTTP error with its status',
  () => tool.execute({ state: 'FAIL', questions: { q: { type: 'noul', instructions: 'y?' } } }, {}),
  'HTTP 401',
);
const wrongPathTool = register({ baseURL: baseURL + '/nope', apiKeyEnv: 'SMOKE_KEY' })[0];
await expectError(
  'surfaces a 404 from a wrong endpoint',
  () => wrongPathTool.execute({ state: 'x', questions: { q: { type: 'noul', instructions: 'y?' } } }, {}),
  'HTTP 404',
);
await expectError(
  'rejects a malformed baseURL',
  () => register({ baseURL: 'not a url', apiKeyEnv: 'SMOKE_KEY' }),
  'baseURL is not a valid URL',
);
await expectError(
  'rejects an unknown transport',
  () => register({ transport: 'openrouter' }),
  'transport must be',
);

// --- D4: criteria shape validation ----------------------------------------
const yQuestion = { q: { type: 'noul', instructions: 'y?' } };
const beforeCriteria = requestLog.length;
await expectError(
  'rejects choice criteria null (D4)',
  () => tool.execute({ state: 'x', questions: { q: { type: 'choice', instructions: 'y?', criteria: null } } }, {}),
  'criteria',
);
await expectError(
  'rejects choice criteria as an array (D4)',
  () => tool.execute({ state: 'x', questions: { q: { type: 'choice', instructions: 'y?', criteria: [] } } }, {}),
  'criteria',
);
await expectError(
  'rejects choice criteria as a string (D4)',
  () => tool.execute({ state: 'x', questions: { q: { type: 'choice', instructions: 'y?', criteria: 'x' } } }, {}),
  'criteria',
);
await expectError(
  'rejects score criteria as an object (D4)',
  () => tool.execute({ state: 'x', questions: { q: { type: 'score', instructions: 'y?', criteria: { low: 'x' } } } }, {}),
  'criteria',
);
check('criteria failures send no request (D4)', requestLog.length === beforeCriteria, String(requestLog.length - beforeCriteria));
const legalChoice = await tool.execute(
  { state: 'x', questions: { q: { type: 'choice', instructions: 'y?', criteria: { a: 'first' } } } },
  {},
);
check('accepts a legal choice criteria object (D4)', JSON.stringify(legalChoice) === JSON.stringify(CANNED));
const legalScore = await tool.execute(
  { state: 'x', questions: { q: { type: 'score', instructions: 'y?', criteria: ['low', 'high'] } } },
  {},
);
check('accepts a legal score criteria array (D4)', JSON.stringify(legalScore) === JSON.stringify(CANNED));

// --- D2: missing-key diagnostic de-duplication ----------------------------
// Rebuilt on the official transport: the D2 regression is about the fallback
// name colliding with apiKeyEnv, so it uses apiKeyEnv 'JEV_API_KEY', the same
// name as the fallback, and proves the diagnostic names it exactly once.
delete process.env.TYPESAFE_API_KEY;
delete process.env.JEV_API_KEY;
const defaultKeyless = register({ baseURL, keyFile: '/nonexistent/key' })[0];
const defaultKeyError = await captureError(() => defaultKeyless.execute({ state: 'x', questions: yQuestion }, {}));
const defaultKeyMessage = defaultKeyError ? defaultKeyError.message : '<no error>';
check(
  'official default key message lists $TYPESAFE_API_KEY and $JEV_API_KEY (D2)',
  defaultKeyMessage.includes('$TYPESAFE_API_KEY') && defaultKeyMessage.includes('$JEV_API_KEY'),
  defaultKeyMessage,
);
check(
  'official default key message names each variable once (D2)',
  defaultKeyMessage.split('$TYPESAFE_API_KEY').length - 1 === 1 && defaultKeyMessage.split('$JEV_API_KEY').length - 1 === 1,
  defaultKeyMessage,
);
const fallbackNamedTool = register({ baseURL, apiKeyEnv: 'JEV_API_KEY', keyFile: '/nonexistent/key' })[0];
const fallbackNamedError = await captureError(() => fallbackNamedTool.execute({ state: 'x', questions: yQuestion }, {}));
const fallbackNamedMessage = fallbackNamedError ? fallbackNamedError.message : '<no error>';
check(
  'explicit apiKeyEnv equal to the fallback is named exactly once (D2)',
  fallbackNamedMessage.split('$JEV_API_KEY').length - 1 === 1,
  fallbackNamedMessage,
);

// --- D6: caller cancellation vs timeout -----------------------------------
const preAborted = new AbortController();
preAborted.abort();
const beforeAbort = requestLog.length;
const abortError = await captureError(() => tool.execute({ state: 'x', questions: yQuestion }, { signal: preAborted.signal }));
const abortMessage = abortError ? abortError.message : '<no error>';
check('reports a pre-aborted signal as caller cancellation (D6)', abortMessage.includes('aborted by the caller'), abortMessage);
check('pre-abort is not reported as a timeout (D6)', !abortMessage.includes('timed out'), abortMessage);
check('pre-abort error keeps name AbortError (D6)', abortError !== null && abortError.name === 'AbortError', abortError && abortError.name);
check('pre-abort sends no request (D6)', requestLog.length === beforeAbort, String(requestLog.length - beforeAbort));
const slowTool = register({ baseURL, apiKeyEnv: 'SMOKE_KEY', timeoutMs: 50 })[0];
await expectError(
  'a caller-independent timeout still reports timed out after 50 ms (D6)',
  () => slowTool.execute({ state: 'SLOW', questions: yQuestion }, {}),
  'timed out after 50 ms',
);

// --- D7: response envelope ------------------------------------------------
await expectError(
  'rejects an object response without answers (D7)',
  () => tool.execute({ state: 'EMPTYOBJ', questions: yQuestion }, {}),
  'answers',
);
await expectError(
  'rejects an array response (D7)',
  () => tool.execute({ state: 'EMPTYARR', questions: yQuestion }, {}),
  'must be an object',
);
const objectViolation = outputSchemaViolation({});
check('output.schema rejects {} at the registry (D7)', objectViolation !== null && objectViolation.includes('answers'), String(objectViolation));
const arrayViolation = outputSchemaViolation([]);
check('output.schema rejects an array at the registry (D7)', arrayViolation !== null && arrayViolation.includes('must be an object'), String(arrayViolation));
check('output.schema still accepts the canned body (D7)', outputSchemaViolation(CANNED) === null, String(outputSchemaViolation(CANNED)));

// --- F6: retries ----------------------------------------------------------
const retryTool = register({ baseURL, apiKeyEnv: 'SMOKE_KEY', timeoutMs: 5000, retries: 1 })[0];
await expectError(
  'retries:1 surfaces HTTP 500 after the attempts are exhausted (F6)',
  () => retryTool.execute({ state: 'HTTP500', questions: yQuestion }, {}),
  'HTTP 500',
);
check('retries:1 re-sends a 5xx once (F6)', callsWithState('HTTP500') === 2, String(callsWithState('HTTP500')));
const rateLimitError = await captureError(() => retryTool.execute({ state: 'HTTP429', questions: yQuestion }, {}));
const rateLimitMessage = rateLimitError ? rateLimitError.message : '<no error>';
check('a 429 is surfaced as an error (F6)', rateLimitMessage.includes('HTTP 429'), rateLimitMessage);
check(
  'a 429 hint is provider-neutral and actionable (F6)',
  rateLimitMessage.includes('rate-limiting this key') && !rateLimitMessage.toLowerCase().includes('ai gateway'),
  rateLimitMessage,
);
check('a 429 is never retried (F6)', callsWithState('HTTP429') === 1, String(callsWithState('HTTP429')));
const noRetryTool = register({ baseURL, apiKeyEnv: 'SMOKE_KEY', timeoutMs: 5000 })[0];
await expectError(
  'retries:0 surfaces HTTP 500 immediately (F6)',
  () => noRetryTool.execute({ state: 'HTTP500R0', questions: yQuestion }, {}),
  'HTTP 500',
);
check('retries:0 never retries a 5xx (F6)', callsWithState('HTTP500R0') === 1, String(callsWithState('HTTP500R0')));
const retryTimeoutTool = register({ baseURL, apiKeyEnv: 'SMOKE_KEY', timeoutMs: 50, retries: 1 })[0];
await expectError(
  'retries:1 surfaces the timeout after retrying (F6)',
  () => retryTimeoutTool.execute({ state: 'SLOWRETRY', questions: yQuestion }, {}),
  'timed out after 50 ms',
);
check('retries:1 re-sends after a timeout (F6)', callsWithState('SLOWRETRY') === 2, String(callsWithState('SLOWRETRY')));

// --- F8: concurrency on one tool instance ---------------------------------
const [concurrentA, concurrentB] = await Promise.all([
  tool.execute({ state: 'CONC-A', questions: yQuestion }, {}),
  tool.execute({ state: 'CONC-B', questions: yQuestion }, {}),
]);
check('concurrent call A receives its own answer (F8)', concurrentA.answers.dept.choice === 'CONC-A', JSON.stringify(concurrentA));
check('concurrent call B receives its own answer (F8)', concurrentB.answers.dept.choice === 'CONC-B', JSON.stringify(concurrentB));
const concurrentCalls = nativeRequests().filter((entry) => entry.body && String(entry.body.state).startsWith('CONC-'));
check(
  'concurrent calls stayed independent (F8)',
  concurrentCalls.length === 2 && concurrentCalls.some((entry) => entry.body.state === 'CONC-A') && concurrentCalls.some((entry) => entry.body.state === 'CONC-B'),
  JSON.stringify(concurrentCalls.map((entry) => entry.body.state)),
);

server.close();
console.log('');
console.log(failures === 0 ? 'SMOKE OK (' + requestLog.length + ' mock requests)' : 'SMOKE FAILED: ' + failures + ' check(s)');
process.exit(failures === 0 ? 0 : 1);
