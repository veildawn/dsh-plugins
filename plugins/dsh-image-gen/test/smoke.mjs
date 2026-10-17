/**
 * 插件集成冒烟测试（lib/index.js）。
 *
 * 用 mock ctx 走真实的 apply() 注册路径，覆盖：
 *   - 工具注册形态（名称、schema、超时、并发安全、output.schema）
 *   - 生图全链路（provider 下拉模式与 manual 模式两条路径）
 *   - 尺寸/画质从设置文件落到请求载荷
 *   - 缺 key / 未知 provider / 编辑类模型的报错
 *   - 设置 RPC 的 getConfig / saveConfig / testConnection
 *   - Web 路由（/api/dsh-image-gen/config 与 /test）
 *   - 前端 client.js 能否被模块加载器加载并注册到 settings.section
 *
 * 全部跑在本地 mock 服务器上，写文件只写 mkdtemp 目录，不碰 ~/.dsh，
 * 也不启动任何真实服务。
 *
 * Run: node test/smoke.mjs
 */
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 隔离本机环境。
 *
 * provider.js 在模块加载时就把 DSH_HOME 定下来了（之后不再重读），所以必须
 * 在 import '../lib/index.js' 之前设好，否则会读到本机真实的
 * ~/.dsh/.credentials.yaml 与 llm-pi-ai 配置。工作目录与 profile 都是本测试
 * 自己的 mkdtemp 副本，测试结束后一并删除。
 */
const workDir = await mkdtemp(join(tmpdir(), 'dsh-image-smoke-'));
process.env.DSH_HOME = workDir;
process.env.DSH_PROFILE = 'web';

const { apply, SETTINGS_RPC_CHANNEL, TOOL_NAME, normalizePluginConfig } = await import('../lib/index.js');

/** 复位测试注入的环境变量，避免泄漏到后续测试文件。 */
const restoreEnv = () => {
  delete process.env.DSH_HOME;
  delete process.env.DSH_PROFILE;
};

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

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

// ---------------------------------------------------------------------------
// fixture: a fake dsh deployment + a fake image provider
// ---------------------------------------------------------------------------
const profileDir = join(workDir, 'profiles', 'web');
const settingsFile = join(workDir, 'image-gen', 'settings.json');
const outDir = join(workDir, 'out');
await (async () => {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(profileDir, { recursive: true });
  await mkdir(join(workDir, 'image-gen'), { recursive: true });
  await mkdir(outDir, { recursive: true });
})();

await writeFile(
  join(profileDir, 'cordis.patch.yml'),
  `
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      ai-proxy:
        displayName: AI Proxy
        apiKeyEnv: SMOKE_IMAGE_KEY
        baseURL: __BASE_URL__
        headers:
          x-ai-proxy-client: dsh
        models:
          - id: gemini-3.1-flash-image
          - id: grok-imagine-image
          - id: gemini-3.1-flash-image-edit
          - id: glm-5.3
      keyless:
        displayName: Keyless Provider
        apiKeyEnv: SMOKE_NO_KEY_ANYWHERE
        baseURL: __BASE_URL__
        models:
          - id: gemini-3.1-flash-image
`,
  'utf8',
);

const requests = [];
const provider = createServer((req, res) => {
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
    requests.push({ url: req.url, headers: req.headers, body: parsed });
    if (parsed && parsed.prompt === 'BOOM') {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('bad prompt');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({ data: [{ b64_json: PNG_1x1.toString('base64'), mime_type: 'image/png' }] }),
    );
  });
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const baseURL = `http://127.0.0.1:${provider.address().port}`;

// 把 fixture 里的占位符换成真实地址（全局替换：文件里有两处 provider 行）
await writeFile(
  join(profileDir, 'cordis.patch.yml'),
  (await readFile(join(profileDir, 'cordis.patch.yml'), 'utf8')).replace(/__BASE_URL__/g, `${baseURL}/v1`),
  'utf8',
);

await writeFile(
  join(workDir, '.credentials.yaml'),
  'version: 1\nrefs:\n  SMOKE_IMAGE_KEY: sk-from-credentials\n',
  'utf8',
);

// 关键点：apply() 内部通过 provider.js 读取 dsh 配置，那里用 createRequire
// 从 dsh 安装里解析 js-yaml；本测试把 DSH_HOME 指到 fixture 目录，
// 同时用 apiKeyEnv 固定凭证名，避免读到本机真实的 ~/.dsh/.credentials.yaml。
process.env.SMOKE_IMAGE_KEY = 'sk-from-env';

// ---------------------------------------------------------------------------
// mock ctx
// ---------------------------------------------------------------------------
function register(config = {}) {
  const registered = [];
  let rpcHandler = null;
  const routes = { get: [], post: [] };
  const ctx = {
    tools: {
      register: (definition) => {
        registered.push(definition);
        return () => {};
      },
    },
    connection: {
      rpc: {
        handle: (channel, handler) => {
          if (channel === SETTINGS_RPC_CHANNEL) rpcHandler = handler;
          return () => {};
        },
      },
    },
    inject: (names, fn) => {
      void names;
      const wsCtx = {
        webServer: {
          get: (path, handler) => routes.get.push({ path, handler }),
          post: (path, handler) => routes.post.push({ path, handler }),
        },
      };
      const dispose = fn(wsCtx);
      return typeof dispose === 'function' ? dispose : () => {};
    },
  };
  apply(ctx, { settingsFile, ...config });
  return { tool: registered[0], rpc: (method, payload) => rpcHandler(method, payload), routes };
}

const base = { provider: 'ai-proxy', model: 'gemini-3.1-flash-image', settingsFile };

// ---------------------------------------------------------------------------
// 1. registration shape
// ---------------------------------------------------------------------------
const reg = register(base);
check('registers exactly one tool', reg.tool !== undefined);
check('the tool is named image_generate', reg.tool.name === TOOL_NAME, reg.tool.name);
check('TOOL_NAME is image_generate', TOOL_NAME === 'image_generate');
check('declares a positive timeoutMs', typeof reg.tool.timeoutMs === 'number' && reg.tool.timeoutMs > 1000, String(reg.tool.timeoutMs));
check('isConcurrencySafe is true', typeof reg.tool.isConcurrencySafe === 'function' && reg.tool.isConcurrencySafe() === true);
check('parameters require only prompt', JSON.stringify(reg.tool.parameters.required) === JSON.stringify(['prompt']), JSON.stringify(reg.tool.parameters.required));
check('parameters reject unknown keys', reg.tool.parameters.additionalProperties === false);
check('output.schema requires savePath', reg.tool.output.schema.required.includes('savePath'));
check('output.schema requires the real size', reg.tool.output.schema.required.includes('actualSize'));
check('output.schema requires warnings', reg.tool.output.schema.required.includes('warnings'));
check('declares output.render', typeof reg.tool.output.render === 'function');
check('the description mentions size and quality', reg.tool.description.includes('Size and quality are dropdown choices'), reg.tool.description.slice(0, 120));
check('the description warns that actualSize beats requestedSize', reg.tool.description.includes('trust it over requestedSize'));
check('the prompt parameter documents what to describe', reg.tool.parameters.properties.prompt.description.includes('composition'), reg.tool.parameters.properties.prompt.description);
check('output_path documents extension correction', reg.tool.parameters.properties.output_path.description.includes('extension is corrected'));
check('size documents the option list', reg.tool.parameters.properties.size.description.includes('1024x1024'));
check('quality documents auto', reg.tool.parameters.properties.quality.description.includes('auto'));

// ---------------------------------------------------------------------------
// 2. end-to-end: provider mode
// ---------------------------------------------------------------------------
requests.length = 0;
const result = await reg.tool.execute(
  { prompt: 'a blue cube on white', output_path: join(outDir, 'a.png'), size: '1024x1024', quality: 'high' },
  {},
);
check('returns the save path', result.savePath === join(outDir, 'a.png'), result.savePath);
check('reports the real 1x1 size', result.actualSize === '1x1', result.actualSize);
check('reports the requested size', result.requestedSize === '1024x1024');
check('reports the quality', result.quality === 'high');
check('names the provider row', result.provider === 'ai-proxy', result.provider);
check('says the source is the dsh provider row', result.source === 'provider', result.source);
check('the token came from the credentials file', result.tokenFrom === 'credentials:SMOKE_IMAGE_KEY', result.tokenFrom);
check('the file exists and holds the bytes', (await readFile(result.savePath)).equals(PNG_1x1));
check('warns that the provider ignored the size', result.warnings.some((w) => w.includes('ignored the requested size')), JSON.stringify(result.warnings));
const req = requests.at(-1);
check('posts to /v1/images/generations', req.url === '/v1/images/generations', req.url);
check('sends the credentials token', req.headers.authorization === 'Bearer sk-from-credentials', req.headers.authorization);
check('forwards the provider header', req.headers['x-ai-proxy-client'] === 'dsh');
check('sends the configured model', req.body.model === 'gemini-3.1-flash-image');
check('sends the requested size', req.body.size === '1024x1024');
check('sends the quality', req.body.quality === 'high');

// per-call overrides
requests.length = 0;
const override = await reg.tool.execute(
  { prompt: 'override run', model: 'grok-imagine-image', size: '512x512', quality: 'low', output_path: join(outDir, 'b.png') },
  {},
);
check('a per-call model override is honored', requests.at(-1).body.model === 'grok-imagine-image');
check('a per-call size override is honored', requests.at(-1).body.size === '512x512');
check('a per-call quality override is honored', requests.at(-1).body.quality === 'low');
check('the override still reports the same provider', override.provider === 'ai-proxy');

// quality auto is not sent
requests.length = 0;
await reg.tool.execute({ prompt: 'auto quality', quality: 'auto', output_path: join(outDir, 'c.png') }, {});
check('quality auto is omitted from the payload', requests.at(-1).body.quality === undefined);

// render
const rendered = reg.tool.output.render({ prompt: 'p' }, result);
check('render emits one text block', rendered.length === 1 && rendered[0].type === 'text');
check('render names the save path', rendered[0].text.includes(result.savePath));
check('render reports the real size', rendered[0].text.includes('1x1 (requested 1024x1024)'));
check('render lists the warnings', rendered[0].text.includes('Warnings:'));

// output.schema accepts the real value
const schema = reg.tool.output.schema;
const schemaOk = schema.required.every((key) => Object.prototype.hasOwnProperty.call(result, key));
check('output.schema is satisfied by the real result', schemaOk);

// ---------------------------------------------------------------------------
// 3. end-to-end: manual mode
// ---------------------------------------------------------------------------
requests.length = 0;
const manual = register({
  source: 'manual',
  baseURL,
  model: 'gemini-3.1-flash-image',
  apiKey: 'sk-inline-manual',
  size: '1024x1024',
  quality: 'standard',
  settingsFile: join(workDir, 'image-gen', 'manual-settings.json'),
});
const manualResult = await manual.tool.execute({ prompt: 'manual run', output_path: join(outDir, 'manual.png') }, {});
check('manual mode saves the image', manualResult.savePath === join(outDir, 'manual.png'));
check('manual mode reports its source', manualResult.source === 'manual', manualResult.source);
check('manual mode uses the inline key', manualResult.tokenFrom === 'plugin-config', manualResult.tokenFrom);
check('manual mode sends the inline key', requests.at(-1).headers.authorization === 'Bearer sk-inline-manual');
check('manual mode sends the quality', requests.at(-1).body.quality === 'standard');

// 3.1 manual mode with key saved in settingsFile (simulating Web Settings panel save)
requests.length = 0;
const savedKeySettingsFile = join(workDir, 'image-gen', 'saved-key-settings.json');
await writeFile(
  savedKeySettingsFile,
  JSON.stringify({ source: 'manual', baseURL, model: 'gemini-3.1-flash-image', apiKey: 'sk-saved-manual', _source: 'user-set' }, null, 2),
  'utf8',
);
const manualSaved = register({
  settingsFile: savedKeySettingsFile,
});
const manualSavedResult = await manualSaved.tool.execute({ prompt: 'saved key run', output_path: join(outDir, 'manual-saved.png') }, {});
check('manual mode with saved key lands image', manualSavedResult.savePath === join(outDir, 'manual-saved.png'));
check('manual mode resolves key from settings-file', manualSavedResult.tokenFrom === 'settings-file', manualSavedResult.tokenFrom);
check('manual mode sends the saved token', requests.at(-1).headers.authorization === 'Bearer ' + 'sk-saved-manual');

// ---------------------------------------------------------------------------
// 4. settings file drives the defaults
// ---------------------------------------------------------------------------
await writeFile(
  settingsFile,
  JSON.stringify({ provider: 'ai-proxy', model: 'grok-imagine-image', size: '512x512', quality: 'low', _source: 'user-set' }, null, 2),
  'utf8',
);
requests.length = 0;
const fromSettings = register(base);
await fromSettings.tool.execute({ prompt: 'from settings', output_path: join(outDir, 's.png') }, {});
check('the settings file supplies the model', requests.at(-1).body.model === 'grok-imagine-image', requests.at(-1).body.model);
check('the settings file supplies the size', requests.at(-1).body.size === '512x512');
check('the settings file supplies the quality', requests.at(-1).body.quality === 'low');
check('the result echoes the saved size', fromSettings.tool.output.render({}, { requestedSize: '512x512' })[0].text.includes('512x512'));
await rm(settingsFile, { force: true });

// ---------------------------------------------------------------------------
// 5. failure modes
// ---------------------------------------------------------------------------
const noKey = register({
  provider: 'keyless',
  model: 'gemini-3.1-flash-image',
  settingsFile: join(workDir, 'image-gen', 'nokey.json'),
});
const noKeyError = await captureError(() => noKey.tool.execute({ prompt: 'x' }, {}));
check('a missing key is reported with the env name', noKeyError !== null && noKeyError.message.includes('$SMOKE_NO_KEY_ANYWHERE'), noKeyError && noKeyError.message);
check('a missing key mentions the settings panel', noKeyError !== null && noKeyError.message.includes('settings panel'), noKeyError && noKeyError.message);
check('a missing key has the ETOKEN code', noKeyError !== null && noKeyError.code === 'ETOKEN');

const unknownProvider = register({ provider: 'does-not-exist', model: 'm', settingsFile: join(workDir, 'image-gen', 'unknown.json') });
const unknownError = await captureError(() => unknownProvider.tool.execute({ prompt: 'x' }, {}));
check('an unknown provider is reported', unknownError !== null && unknownError.message.includes('does-not-exist'), unknownError && unknownError.message);
check('an unknown provider lists the available ones', unknownError !== null && unknownError.message.includes('ai-proxy'));
check('an unknown provider suggests manual mode', unknownError !== null && unknownError.message.includes('手动配置'), unknownError && unknownError.message);
check('an unknown provider has the EPROVIDER code', unknownError !== null && unknownError.code === 'EPROVIDER');

const editModel = register({ provider: 'ai-proxy', model: 'gemini-3.1-flash-image-edit', settingsFile: join(workDir, 'image-gen', 'edit.json') });
const editError = await captureError(() => editModel.tool.execute({ prompt: 'x' }, {}));
check('an edit-only model is refused for text-to-image', editError !== null && editError.message.includes('image-EDIT'), editError && editError.message);
check('the edit-only error suggests a generation model', editError !== null && editError.message.includes('grok-imagine-image'));
check('the edit-only error has the EEDITONLY code', editError !== null && editError.code === 'EEDITONLY');

const emptyPrompt = await captureError(() => reg.tool.execute({ prompt: '   ' }, {}));
check('an empty prompt is refused', emptyPrompt !== null && emptyPrompt.message.includes('non-empty string'), emptyPrompt && emptyPrompt.message);

const httpError = await captureError(() => reg.tool.execute({ prompt: 'BOOM', output_path: join(outDir, 'boom.png') }, {}));
check('an HTTP error surfaces with its status', httpError !== null && httpError.message.includes('400'), httpError && httpError.message);

const badSize = await captureError(() => reg.tool.execute({ prompt: 'x', size: 'gigantic' }, {}));
check('a bad size is refused', badSize !== null && badSize.message.includes('size must look like'), badSize && badSize.message);
const badQuality = await captureError(() => reg.tool.execute({ prompt: 'x', quality: 'ultra' }, {}));
check('a bad quality is refused', badQuality !== null && badQuality.message.includes('quality must be one of'), badQuality && badQuality.message);

// ---------------------------------------------------------------------------
// 6. settings RPC
// ---------------------------------------------------------------------------
const rpc = register(base);
const view = (await rpc.rpc('getConfig', {})).value;
check('getConfig reports the source', view.source === 'provider', view.source);
check('getConfig lists the providers', Array.isArray(view.providers) && view.providers.some((p) => p.id === 'ai-proxy'), JSON.stringify(view.providers));
check('getConfig separates image models', view.availableImageModels.includes('gemini-3.1-flash-image') && view.availableImageModels.includes('grok-imagine-image'), JSON.stringify(view.availableImageModels));
check('getConfig keeps non-image models out of the image list', !view.availableImageModels.includes('glm-5.3'));
check('getConfig lists every model on the active provider', view.availableModels.length === 4, JSON.stringify(view.availableModels));
check('getConfig lists both providers', view.providers.length === 2 && view.providers.some((p) => p.id === 'keyless'), JSON.stringify(view.providers.map((p) => p.id)));
check('getConfig offers size options with labels', view.sizeOptions.length >= 8 && view.sizeOptions.every((o) => typeof o.label === 'string'));
check('getConfig offers quality options with labels', view.qualityOptions.length >= 5);
check('getConfig reports the apiKeyEnv', view.apiKeyEnv === 'SMOKE_IMAGE_KEY', view.apiKeyEnv);
check('getConfig reports the key as configured', view.apiKeyConfigured === true);
check('getConfig never returns the key itself', !JSON.stringify(view).includes('sk-from-credentials'), JSON.stringify(view).slice(0, 200));
check('getConfig reports the settings file', view.settingsFile === settingsFile, view.settingsFile);
check('getConfig reports the config source', typeof view.configSource === 'string' && view.configSource.includes('inferred'), view.configSource);
check('getConfig exposes the proxy host list', Array.isArray(view.proxyHosts));

const saved = await rpc.rpc('saveConfig', {
  source: 'provider',
  provider: 'ai-proxy',
  model: 'grok-imagine-image',
  size: '1024x1792',
  quality: 'hd',
});
check('saveConfig succeeds', saved !== null && saved.ok !== false, JSON.stringify(saved && saved.error));
const savedFile = JSON.parse(await readFile(settingsFile, 'utf8'));
check('saveConfig writes the model', savedFile.model === 'grok-imagine-image', savedFile.model);
check('saveConfig writes the size', savedFile.size === '1024x1792', savedFile.size);
check('saveConfig writes the quality', savedFile.quality === 'hd', savedFile.quality);
check('saveConfig marks the file as user-set', savedFile._source === 'user-set');
check('saveConfig never writes an apiKey', savedFile.apiKey === undefined);

const badSave = await rpc.rpc('saveConfig', { source: 'provider', provider: 'nope', model: 'm' });
check('saveConfig refuses an unknown provider', badSave.ok === false && badSave.error.code === 'unknown-provider', JSON.stringify(badSave));
check('the unknown-provider error lists the options', String(badSave.error.message).includes('ai-proxy'), badSave.error.message);
const badSaveSize = await rpc.rpc('saveConfig', { source: 'provider', provider: 'ai-proxy', model: 'm', size: 'nope' });
check('saveConfig refuses a bad size', badSaveSize.ok === false, JSON.stringify(badSaveSize));
const stillOk = JSON.parse(await readFile(settingsFile, 'utf8'));
check('a refused save leaves the file untouched', stillOk.size === '1024x1792' && stillOk.model === 'grok-imagine-image', JSON.stringify(stillOk));

const testResult = await rpc.rpc('testConnection', {});
check('testConnection succeeds', testResult.ok === true && typeof testResult.value.durationMs === 'number', JSON.stringify(testResult));
check('testConnection reports the model used', testResult.value.model === 'grok-imagine-image', testResult.value.model);
check('testConnection reports a direct connection', testResult.value.via === '直连', testResult.value.via);
check('testConnection used a 512x512 probe', requests.at(-1).body.size === '512x512', requests.at(-1).body.size);
check('testConnection names the saved probe file', typeof testResult.value.savePath === 'string');

const testManual = await rpc.rpc('testConnection', { source: 'manual', baseURL, model: 'gemini-3.1-flash-image', apiKey: 'sk-probe' });
check('testConnection works in manual mode', testManual.ok === true, JSON.stringify(testManual));
check('manual testConnection sends the probe key', requests.at(-1).headers.authorization === 'Bearer sk-probe');

const testNoKey = await rpc.rpc('testConnection', { source: 'manual', baseURL, model: 'm', apiKey: '' });
check('testConnection reports a missing key', testNoKey.ok === false && testNoKey.error.code === 'unconfigured', JSON.stringify(testNoKey));

const unknownMethod = await rpc.rpc('noSuchMethod', {});
check('an unknown RPC method is reported', unknownMethod.ok === false && unknownMethod.error.code === 'unknown-method', JSON.stringify(unknownMethod));

// ---------------------------------------------------------------------------
// 7. web routes
// ---------------------------------------------------------------------------
check('GET /config is mounted', rpc.routes.get.some((r) => r.path === '/api/dsh-image-gen/config'), JSON.stringify(rpc.routes.get));
check('POST /config is mounted', rpc.routes.post.some((r) => r.path === '/api/dsh-image-gen/config'));
check('POST /test is mounted', rpc.routes.post.some((r) => r.path === '/api/dsh-image-gen/test'));

function fakeResponse() {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(payload) {
      this.body = payload ?? '';
      this.done = true;
    },
  };
  return res;
}

const getRoute = rpc.routes.get.find((r) => r.path === '/api/dsh-image-gen/config');
const getRes = fakeResponse();
await getRoute.handler({}, getRes);
check('GET /config answers 200', getRes.statusCode === 200, String(getRes.statusCode));
check('GET /config returns JSON', getRes.headers['content-type'] === 'application/json');
check('GET /config carries the view', JSON.parse(getRes.body).value.provider === 'ai-proxy', getRes.body.slice(0, 120));

/**
 * 一个最小可用的假请求对象：立即把 'end' 触发掉，让 readBody 的 Promise 落地。
 * 传 payload 时按 JSON 字符串投喂给 'data'。
 */
function fakeRequest(payload) {
  const handlers = { data: [], end: [] };
  return {
    on(event, handler) {
      if (handlers[event]) handlers[event].push(handler);
      return this;
    },
    emit() {
      if (payload !== undefined && payload !== null) {
        for (const handler of handlers.data) handler(typeof payload === 'string' ? payload : JSON.stringify(payload));
      }
      for (const handler of handlers.end) handler();
    },
  };
}

const postRoute = rpc.routes.post.find((r) => r.path === '/api/dsh-image-gen/config');
const postRes = fakeResponse();
const postReq = fakeRequest(undefined);
const postDone = postRoute.handler(postReq, postRes);
postReq.emit();
await postDone;
check('POST /config with no body still answers', postRes.done === true, String(postRes.statusCode));

const testRoute = rpc.routes.post.find((r) => r.path === '/api/dsh-image-gen/test');
const testRes = fakeResponse();
const testReq = fakeRequest(undefined);
const testDone = testRoute.handler(testReq, testRes);
testReq.emit();
await testDone;
check('POST /test answers', testRes.done === true, String(testRes.statusCode));

// 带 payload 的 POST：走一遍 saveConfig 的 Web 路径
const saveRoute = rpc.routes.post.find((r) => r.path === '/api/dsh-image-gen/config');
const saveRes = fakeResponse();
const saveReq = fakeRequest({ source: 'provider', provider: 'ai-proxy', model: 'grok-imagine-image', size: '768x1024', quality: 'standard' });
const saveDone = saveRoute.handler(saveReq, saveRes);
saveReq.emit();
await saveDone;
check('POST /config accepts a real payload', saveRes.done === true && saveRes.statusCode === 200, String(saveRes.statusCode));
const viaWeb = JSON.parse(await readFile(settingsFile, 'utf8'));
check('POST /config writes the size', viaWeb.size === '768x1024', viaWeb.size);
check('POST /config writes the quality', viaWeb.quality === 'standard', viaWeb.quality);

// 坏 payload 不写坏文件
const badReq = fakeRequest('{not json');
const badRes = fakeResponse();
const badDone = saveRoute.handler(badReq, badRes);
badReq.emit();
await badDone;
check('POST /config tolerates a malformed body', badRes.done === true, String(badRes.statusCode));

// ---------------------------------------------------------------------------
// 8. client bundle loads under the module loader
// ---------------------------------------------------------------------------
let registration = null;
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      registration = entry;
    },
  },
};
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ set textContent(v) { this._t = v; }, get textContent() { return this._t; }, id: '' }),
  head: { appendChild: () => {} },
};
{
  const { readFileSync } = await import('node:fs');
  const clientPath = new URL('../lib/client.js', import.meta.url).pathname;
  // eslint-disable-next-line no-eval
  (0, eval)(readFileSync(clientPath, 'utf8'));
}
check('the client bundle registers itself', registration !== null && registration.id === 'dsh-image-gen', String(registration && registration.id));

// 用一个最小 React 存根驱动 factory，验证它注册到 settings.section
const hookState = [];
let hookIndex = 0;
const reactStub = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat().filter((c) => c !== null && c !== undefined && c !== false) };
  },
  useState(initial) {
    const i = hookIndex++;
    if (!(i in hookState)) hookState[i] = initial;
    return [hookState[i], (v) => { hookState[i] = v; }];
  },
  useEffect() {},
};
const clientMod = registration.factory((id) => {
  if (id === 'react') return reactStub;
  throw new Error('unexpected require: ' + id);
});
check('the client exports apply', typeof clientMod.apply === 'function');
check('the client injects slots and connection', clientMod.inject.join(',') === 'slots,connection', JSON.stringify(clientMod.inject));

let clientComponent = null;
const slotOptions = {};
const clientCtx = {
  connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
  slots: {
    inject: (_name, fn) => fn(),
    register: (_options, comp) => {
      clientComponent = comp;
      slotOptions.options = _options;
      return () => {};
    },
  },
};
clientMod.apply(clientCtx);
check('the client registers a settings component', typeof clientComponent === 'function', typeof clientComponent);
check('the component slot is settings.section', slotOptions.options.name === 'settings.section', slotOptions.options.name);
check('the slot id is dsh-image-gen', slotOptions.options.id === 'dsh-image-gen', slotOptions.options.id);
check('the slot supplies rpcCall', typeof slotOptions.options.inject().rpcCall === 'function');
check('the slot declares a label', typeof slotOptions.options.label === 'function');

// 渲染一次面板，确认两条来源路径的字段都在
const panel = clientComponent({ rpcCall: async () => ({}) });
check('the panel renders a heading', (() => {
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.type === 'h2') found.push(node);
    (node.children ?? []).forEach(walk);
  };
  walk(panel);
  return found.length === 1 && found[0].children[0] === '生图模型设置';
})(), 'h2 not found');
check('the panel offers both source modes', (() => {
  const options = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.type === 'option') options.push(node.props.value);
    (node.children ?? []).forEach(walk);
  };
  walk(panel);
  return options.includes('provider') && options.includes('manual');
})(), 'source options missing');
check('the panel exposes a provider select', (() => {
  const selects = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.type === 'select') selects.push(node);
    (node.children ?? []).forEach(walk);
  };
  walk(panel);
  return selects.length >= 1;
})());
check('the panel has size and quality selects', (() => {
  const labels = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.type === 'span' && node.children?.[0]) labels.push(node.children[0]);
    (node.children ?? []).forEach(walk);
  };
  walk(panel);
  return labels.includes('图片尺寸') && labels.includes('画质');
})(), 'the size/quality labels are missing');

// ---------------------------------------------------------------------------
// 9. plugin config normalization
// ---------------------------------------------------------------------------
const defaults = normalizePluginConfig({});
check('an empty config defaults to the provider source', defaults.source === 'provider');
check('an empty config defaults to 1024x1024', defaults.size === '1024x1024');
check('an empty config defaults to auto quality', defaults.quality === 'auto');
check('an empty config has a positive timeout', defaults.timeoutMs > 0);
check('an empty config allows all proxy hosts', defaults.proxyHosts.join(',') === '*');
check('the settings file has a default path', typeof defaults.settingsFile === 'string' && defaults.settingsFile.includes('image-gen'));
const manualCfg = normalizePluginConfig({ source: 'manual', baseURL, apiKey: 'sk-x', size: '512x512', quality: 'low' });
check('manual config keeps its baseURL', manualCfg.baseURL === baseURL);
check('manual config keeps the inline key', manualCfg.apiKey === 'sk-x');
check('manual config validates the size', manualCfg.size === '512x512');
const proxyCfg = normalizePluginConfig({ proxy: 'http://127.0.0.1:7890' });
check('a configured proxy is parsed', proxyCfg.configProxy !== undefined && proxyCfg.configProxy.port === 7890);
const lockedProxy = await captureError(() => normalizePluginConfig({ proxy: 'ftp://h:1' }));
check('a bad proxy in config is refused at startup', lockedProxy !== null && lockedProxy.message.includes('must use http'), lockedProxy && lockedProxy.message);
const badTimeout = await captureError(() => normalizePluginConfig({ timeoutMs: -5 }));
check('a bad timeout is refused at startup', badTimeout !== null && badTimeout.message.includes('positive finite'), badTimeout && badTimeout.message);

// ---------------------------------------------------------------------------
provider.close();
await rm(workDir, { recursive: true, force: true });
delete process.env.SMOKE_IMAGE_KEY;
restoreEnv();

console.log('');
console.log(failures === 0 ? 'SMOKE OK (' + requests.length + ' mock requests)' : 'SMOKE FAILED: ' + failures + ' check(s)');
process.exit(failures === 0 ? 0 : 1);
