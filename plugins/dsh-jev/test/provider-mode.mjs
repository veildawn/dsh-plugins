/**
 * 「使用 dsh 已配置的提供商」模式集成测试。
 *
 * 这是本次功能的核心：用户不再必须手写 TypeSafe 的 baseUrl 与 API Key，
 * 而是可以直接选 dsh 模型配置里的提供商（例如本机 ai-proxy 的 jev-latest）。
 *
 * 覆盖：
 *   - provider 模式的工具调用走提供商的 baseURL + /v1/decisions；
 *   - 模型 ID 原样使用提供商声明的 jev-latest（不被改写成 typesafe-ai/jev）；
 *   - 请求头带上提供商声明的额外 header，认证头来自 .credentials.yaml；
 *   - getConfig 返回提供商列表、当前来源、Key 来源与掩码；
 *   - saveConfig 切回手动配置后，后续调用立即改走手写地址；
 *   - 未知提供商在保存与调用时都给出清晰错误；
 *   - 默认（不配置来源）仍是 TypeSafe 官方地址 + /v1/systemone。
 *
 * 全程只用临时 DSH_HOME 与临时设置文件，不碰真实用户配置。
 *
 * Run: node test/provider-mode.mjs
 */
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;
function check(label, condition, extra) {
  if (condition) {
    console.log('PASS ' + label);
  } else {
    failures += 1;
    console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra));
  }
}

const workDir = await mkdtemp(join(tmpdir(), 'dsh-jev-provider-mode-'));
const profileDir = join(workDir, 'profiles', 'web');
await mkdir(profileDir, { recursive: true });

/** 决策请求记进这个数组，并发下也不会互相覆盖。 */
const requestLog = [];

/** /v1/models 探测请求单独记录，避免影响「工具调用只发一次请求」的断言。 */
const modelsLog = [];

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    let body = null;
    try {
      body = raw === '' ? null : JSON.parse(raw);
    } catch {
      body = { unparsed: raw };
    }
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url === '/v1/models') {
      modelsLog.push({ url: req.url, headers: req.headers });
      res.end(JSON.stringify({
        object: 'list',
        data: [
          { id: 'jev-latest', modality: 'decision', owned_by: 'typesafe' },
          { id: 'deepseek-v4.1-flash', modality: 'text', input_modalities: ['text', 'image'] },
          { id: 'liquid/d1-ultra', modality: 'decision', owned_by: 'vercel' },
          { id: 'gemini-3.1-flash-image', modality: 'image' },
        ],
      }));
      return;
    }
    requestLog.push({ url: req.url, headers: req.headers, body });
    if (req.url === '/v1/decisions') {
      res.end(JSON.stringify({
        answers: [
          { type: 'predicate', name: 'urgent', probability: 0.93 },
          { type: 'choice', name: 'dept', choice: 'billing', probabilities: { billing: 0.8, tech: 0.2 }, confidence: 0.51 },
        ],
      }));
      return;
    }
    res.end(JSON.stringify({ answers: { urgent: { type: 'noul', noul: 0.91 } } }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const mockBase = 'http://127.0.0.1:' + port;

// provider 行的 baseURL 指向 mock 的 OpenAI 兼容网关根地址
await writeFile(join(profileDir, 'cordis.patch.yml'), `
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      ai-proxy:
        displayName: AI Proxy
        apiKeyEnv: AIPROXY_DSH_WEB_ACCESS_TOKEN
        api: openai-responses
        baseURL: ${mockBase}/v1
        headers:
          x-ai-proxy-client: dsh
        models:
          - id: jev-latest
            contextWindow: 200000
          - id: deepseek-v4.1-flash
            contextWindow: 1000000
      static-only:
        displayName: Static Only
        baseURL: http://127.0.0.1:1/v1
        models:
          - id: fully-custom
            modality: decision
`, 'utf8');

await writeFile(join(workDir, '.credentials.yaml'), `
refs:
  AIPROXY_DSH_WEB_ACCESS_TOKEN: cred-from-yaml
`, 'utf8');

// index.js 经由 provider.js 在模块加载时读取 DSH_HOME / DSH_PROFILE；
// AIPROXY 变量故意设置成另一个值，用来证明 credentials 优先。
process.env.DSH_HOME = workDir;
process.env.DSH_PROFILE = 'web';
process.env.AIPROXY_DSH_WEB_ACCESS_TOKEN = 'env-token';

const { apply, buildModelsUrl, parseModelsApi, mergeModelsApi } = await import('../lib/index.js');

const settingsDir = join(workDir, 'settings');
await mkdir(settingsDir, { recursive: true });
let settingsSeq = 0;

/**
 * 注册一次插件。
 * @param {Record<string, unknown>} config Profile config 段。
 * @returns {{ tool: any, rpc: (method: string, payload?: object) => Promise<any>, settingsFile: string }}
 */
function register(config = {}) {
  settingsSeq += 1;
  const settingsFile = join(settingsDir, 'settings-' + settingsSeq + '.json');
  const tools = [];
  let rpcHandler = null;
  const ctx = {
    tools: { register: (definition) => { tools.push(definition); return () => {}; } },
    connection: { rpc: { handle: (_channel, handler) => { rpcHandler = handler; } } },
  };
  apply(ctx, { settingsFile, timeoutMs: 5000, ...config });
  return {
    tool: tools[0],
    settingsFile,
    rpc: (method, payload = {}) => rpcHandler(method, payload),
  };
}

const state = 'Customer cannot connect Stripe for 3 days';
const questions = {
  urgent: { type: 'noul', instructions: 'Does the message convey urgency?' },
  dept: { type: 'choice', instructions: 'Which team handles this', criteria: { billing: 'payments', tech: 'bugs' } },
};

// ---------------------------------------------------------------------------
// 1. provider 模式的工具调用
// ---------------------------------------------------------------------------
requestLog.length = 0;
const providerSession = register({ source: 'provider', provider: 'ai-proxy' });
const providerConfig = await providerSession.rpc('getConfig', {});
check('provider mode getConfig succeeds', providerConfig.ok === true, JSON.stringify(providerConfig));
const view = providerConfig.value;
check('getConfig reports the provider source', view.source === 'provider', view.source);
check('getConfig reports the selected provider', view.provider === 'ai-proxy', view.provider);
check('getConfig lists the dsh providers', Array.isArray(view.providers) && view.providers.some((p) => p.id === 'ai-proxy'), JSON.stringify(view.providers));
check('getConfig reports the provider model', view.model === 'jev-latest', view.model);
check('getConfig reports the provider baseURL', view.baseURL === mockBase + '/v1', view.baseURL);
check('getConfig defaults the provider endpoint to /v1/decisions', view.endpoint === '/v1/decisions', view.endpoint);
check('getConfig reports the API key source from credentials', String(view.apiKeyFrom).startsWith('credentials:AIPROXY_DSH_WEB_ACCESS_TOKEN'), view.apiKeyFrom);
check('getConfig masks the API key', view.apiKey !== 'cred-from-yaml' && view.apiKey.includes('...'), view.apiKey);
check('getConfig has no config error', view.configError === undefined || view.configError === null, String(view.configError));
check('getConfig also exposes the manual baseURL for switching back', view.manualBaseURL === 'https://api.typesafe.ai', view.manualBaseURL);
const jevInfo = Array.isArray(view.modelInfo) ? view.modelInfo.find((m) => m.id === 'jev-latest') : undefined;
check('getConfig exposes modelInfo with modalities', jevInfo !== undefined && Array.isArray(jevInfo.input), JSON.stringify(jevInfo));
check('modelInfo marks jev-latest as a decision model', jevInfo?.decisionModel === true, JSON.stringify(jevInfo));
check('provider rows also carry modelInfo', Array.isArray(view.providers[0]?.modelInfo) && view.providers[0].modelInfo.length > 0, JSON.stringify(view.providers[0]?.modelInfo));

// /v1/models: the provider's own modality field decides what is a decision model
check('getConfig probes /v1/models in provider mode', view.modelsApi !== null && view.modelsApi.ok === true, JSON.stringify(view.modelsApi));
check('the models probe reports the model count', view.modelsApi?.count === 4, JSON.stringify(view.modelsApi));
check('the models probe reports non-decision models too', view.modelInfo.find((m) => m.id === 'deepseek-v4.1-flash')?.decisionModel === false, JSON.stringify(view.modelInfo.find((m) => m.id === 'deepseek-v4.1-flash')));
check('modality is carried into modelInfo', view.modelInfo.find((m) => m.id === 'jev-latest')?.modality === 'decision', JSON.stringify(view.modelInfo.find((m) => m.id === 'jev-latest')));
check(
  'a decision model missing from the dsh model list is added',
  view.decisionModels.includes('liquid/d1-ultra') && view.modelInfo.some((m) => m.id === 'liquid/d1-ultra' && m.decisionModel),
  JSON.stringify(view.decisionModels),
);
check('the probe lists the remote-only decision models', view.modelsApi?.remoteDecisionModels?.join(',') === 'liquid/d1-ultra', JSON.stringify(view.modelsApi?.remoteDecisionModels));
check('the models probe logged exactly one GET', modelsLog.length === 1 && modelsLog[0].url === '/v1/models', JSON.stringify(modelsLog.map((m) => m.url)));
check('the models probe authenticates with the provider key', modelsLog[0]?.headers?.authorization === 'Bearer cred-from-yaml', modelsLog[0]?.headers?.authorization);

const providerResult = await providerSession.tool.execute({ state, questions }, {});
check('provider mode returns normalized answers', providerResult?.answers?.urgent?.noul === 0.93 && providerResult?.answers?.dept?.choice === 'billing', JSON.stringify(providerResult));
check('provider mode sent exactly one request', requestLog.length === 1, String(requestLog.length));
check('provider mode routes to /v1/decisions', requestLog[0]?.url === '/v1/decisions', requestLog[0]?.url);
check('provider mode keeps the provider model id jev-latest', requestLog[0]?.body?.model === 'jev-latest', JSON.stringify(requestLog[0]?.body?.model));
check('provider mode sends the state as input', requestLog[0]?.body?.input === state, JSON.stringify(requestLog[0]?.body?.input));
check('provider mode formats questions as an array', Array.isArray(requestLog[0]?.body?.questions), JSON.stringify(requestLog[0]?.body?.questions));
check(
  'provider mode authenticates with the credentials key',
  requestLog[0]?.headers?.authorization === 'Bearer cred-from-yaml',
  requestLog[0]?.headers?.authorization,
);
check(
  'provider mode forwards provider headers',
  requestLog[0]?.headers?.['x-ai-proxy-client'] === 'dsh',
  JSON.stringify(requestLog[0]?.headers),
);

// ---------------------------------------------------------------------------
// 2. 切换到手动配置后立即生效
// ---------------------------------------------------------------------------
requestLog.length = 0;
const saved = await providerSession.rpc('saveConfig', {
  source: 'manual',
  baseURL: mockBase,
  endpoint: '/v1/systemone',
  model: 'jev-latest',
  apiKey: 'manual-key',
  proxy: '',
});
check('saveConfig switches the source to manual', saved.ok === true, JSON.stringify(saved));
const onDisk = JSON.parse(await readFile(providerSession.settingsFile, 'utf8'));
check('saveConfig persists the manual baseURL', onDisk.baseURL === mockBase, JSON.stringify(onDisk));
check('saveConfig persists the manual source', onDisk.source === 'manual', JSON.stringify(onDisk));
check('saveConfig stores the API key with the settings file', onDisk.apiKey === 'manual-key', JSON.stringify(onDisk));

const manualConfig = await providerSession.rpc('getConfig', {});
check('getConfig reads the manual source back', manualConfig.value.source === 'manual', manualConfig.value.source);
check('getConfig reads the manual baseURL back', manualConfig.value.baseURL === mockBase, manualConfig.value.baseURL);
check('getConfig reads the manual endpoint back', manualConfig.value.endpoint === '/v1/systemone', manualConfig.value.endpoint);

const manualResult = await providerSession.tool.execute({ state, questions }, {});
check('manual mode returns answers', manualResult?.answers?.urgent?.noul === 0.91, JSON.stringify(manualResult));
check('manual mode routes to /v1/systemone', requestLog[0]?.url === '/v1/systemone', requestLog[0]?.url);
check('manual mode authenticates with the saved key', requestLog[0]?.headers?.authorization === 'Bearer manual-key', requestLog[0]?.headers?.authorization);
check('manual mode sends the native body shape', typeof requestLog[0]?.body?.state === 'string' && !Array.isArray(requestLog[0]?.body?.questions), JSON.stringify(requestLog[0]?.body));

// ---------------------------------------------------------------------------
// 3. 未知提供商的错误信息
// ---------------------------------------------------------------------------
const providerSaveNoKey = await providerSession.rpc('saveConfig', {
  source: 'provider',
  provider: 'ai-proxy',
  model: 'jev-latest',
  endpoint: '/v1/decisions',
  proxy: '',
});
check('provider mode saves without an apiKey field', providerSaveNoKey.ok === true && providerSaveNoKey.value.source === 'provider', JSON.stringify(providerSaveNoKey).slice(0, 300));

const badProviderSave = await providerSession.rpc('saveConfig', { source: 'provider', provider: 'nope' });
check('saveConfig rejects an unknown provider', badProviderSave.ok === false && badProviderSave.error.code === 'unknown-provider', JSON.stringify(badProviderSave));

const badProviderSession = register({ source: 'provider', provider: 'nope' });
const badView = await badProviderSession.rpc('getConfig', {});
check('getConfig survives an unknown provider', badView.ok === true && typeof badView.value.configError === 'string', JSON.stringify(badView));
check('the config error names the problem', String(badView.value.configError).includes('not configured in the dsh model settings'), badView.value.configError);
let badProviderError = null;
try {
  await badProviderSession.tool.execute({ state, questions }, {});
} catch (error) {
  badProviderError = error;
}
check('executing with an unknown provider throws a readable error', badProviderError !== null && badProviderError.message.includes('not configured'), badProviderError?.message);

// ---------------------------------------------------------------------------
// 4. testConnection 在两种来源下都可用
// ---------------------------------------------------------------------------
requestLog.length = 0;
const providerTestSession = register({ source: 'provider', provider: 'ai-proxy' });
const providerTest = await providerTestSession.rpc('testConnection', { source: 'provider', provider: 'ai-proxy' });
check('provider mode testConnection succeeds', providerTest.ok === true, JSON.stringify(providerTest));
check('provider testConnection reports the model', providerTest.value?.model === 'jev-latest', JSON.stringify(providerTest.value));
check('provider testConnection hits /v1/decisions', requestLog[0]?.url === '/v1/decisions', requestLog[0]?.url);
check('provider testConnection reports the key source', String(providerTest.value?.apiKeyFrom).startsWith('credentials:'), JSON.stringify(providerTest.value?.apiKeyFrom));

requestLog.length = 0;
const manualTestSession = register({ source: 'manual' });
const manualTest = await manualTestSession.rpc('testConnection', {
  source: 'manual',
  baseURL: mockBase,
  endpoint: '/v1/systemone',
  model: 'jev-latest',
  apiKey: 'inline-test-key',
});
check('manual testConnection succeeds with an unsaved baseURL', manualTest.ok === true, JSON.stringify(manualTest));
check('manual testConnection hits the unsaved baseURL', requestLog[0]?.url === '/v1/systemone', requestLog[0]?.url);
check('manual testConnection uses the inline key', requestLog[0]?.headers?.authorization === 'Bearer inline-test-key', requestLog[0]?.headers?.authorization);

// ---------------------------------------------------------------------------
// 5. 默认行为不变：TypeSafe 官方地址 + 原生端点
// ---------------------------------------------------------------------------
const defaultSession = register({});
const defaultView = await defaultSession.rpc('getConfig', {});
check('the default source is manual (TypeSafe unchanged)', defaultView.value.source === 'manual', defaultView.value.source);
check('the default baseURL is still the official typesafe address', defaultView.value.baseURL === 'https://api.typesafe.ai', defaultView.value.baseURL);
check('the default endpoint is still /v1/systemone', defaultView.value.endpoint === '/v1/systemone', defaultView.value.endpoint);
check('the default model is jev-latest', defaultView.value.model === 'jev-latest', defaultView.value.model);

// ---------------------------------------------------------------------------
// 5b. 远程发现的决策模型可以直接选用
// ---------------------------------------------------------------------------
const remoteSession = register({ source: 'provider', provider: 'ai-proxy' });
const remoteView = await remoteSession.rpc('getConfig', {});
check('the remote-only decision model is offered in the view', remoteView.value.decisionModels.includes('liquid/d1-ultra'), JSON.stringify(remoteView.value.decisionModels));
const remoteSave = await remoteSession.rpc('saveConfig', {
  source: 'provider',
  provider: 'ai-proxy',
  model: 'liquid/d1-ultra',
  endpoint: '/v1/decisions',
});
check('a remote-discovered decision model can be saved', remoteSave.ok === true && remoteSave.value.model === 'liquid/d1-ultra', JSON.stringify(remoteSave).slice(0, 300));
check('a remote-discovered model is not flagged as unknown', remoteSave.value?.modelWarning === undefined, JSON.stringify(remoteSave.value?.modelWarning));

// ---------------------------------------------------------------------------
// 5c. /v1/models 不可用时，静态 modality 仍然生效
// ---------------------------------------------------------------------------
const staticSession = register({ source: 'provider', provider: 'static-only' });
const staticView = await staticSession.rpc('getConfig', {});
check('an unreachable /v1/models is reported as a failed probe', staticView.value.modelsApi !== null && staticView.value.modelsApi.ok === false, JSON.stringify(staticView.value.modelsApi));
check('the static modality still marks the decision model', staticView.value.decisionModels.includes('fully-custom'), JSON.stringify(staticView.value.decisionModels));
const staticInfo = staticView.value.modelInfo.find((m) => m.id === 'fully-custom');
check('the static modality is exposed in modelInfo', staticInfo?.modality === 'decision' && staticInfo?.decisionModel === true, JSON.stringify(staticInfo));
check('the static provider defaults to its decision model', staticView.value.model === 'fully-custom', String(staticView.value.model));

// ---------------------------------------------------------------------------
// 6. 保存时拒绝会写坏配置的输入
// ---------------------------------------------------------------------------
const badBase = await providerSession.rpc('saveConfig', { source: 'manual', baseURL: 'ftp://127.0.0.1:1' });
check('saveConfig rejects a non-http baseURL', badBase.ok === false, JSON.stringify(badBase));
const badEndpoint = await providerSession.rpc('saveConfig', { source: 'manual', endpoint: '/v1/nope' });
check('saveConfig rejects an unknown endpoint', badEndpoint.ok === false, JSON.stringify(badEndpoint));
const emptyModel = await providerSession.rpc('saveConfig', { source: 'manual', model: '   ' });
check('saveConfig rejects an empty model', emptyModel.ok === false && emptyModel.error.code === 'model-required', JSON.stringify(emptyModel));

// ---------------------------------------------------------------------------
// 7. /v1/models 地址推导与响应解析
// ---------------------------------------------------------------------------
check('buildModelsUrl appends /models to a /v1 base', buildModelsUrl('http://x:1/v1') === 'http://x:1/v1/models', buildModelsUrl('http://x:1/v1'));
check('buildModelsUrl adds /v1/models to a bare base', buildModelsUrl('http://x:1') === 'http://x:1/v1/models', buildModelsUrl('http://x:1'));
check('buildModelsUrl keeps an explicit /v1/models base', buildModelsUrl('http://x:1/v1/models') === 'http://x:1/v1/models', buildModelsUrl('http://x:1/v1/models'));
const parsed = parseModelsApi({
  data: [
    { id: 'a', modality: 'decision' },
    { id: 'b', modality: 'text', input_modalities: ['text', 'image'] },
  ],
});
check(
  'parseModelsApi reads modality and input_modalities',
  parsed.length === 2 && parsed[0].modality === 'decision' && parsed[1].inputModalities.join(',') === 'text,image',
  JSON.stringify(parsed),
);
check('parseModelsApi accepts a bare array', parseModelsApi([{ id: 'x', modality: 'image' }])[0]?.modality === 'image');
const mergedModels = mergeModelsApi(
  [{ id: 'known', decisionModel: false }],
  [],
  {
    ok: true,
    models: [
      { id: 'known', modality: 'decision', inputModalities: [] },
      { id: 'remote', modality: 'decision', inputModalities: [] },
      { id: 'text-only', modality: 'text', inputModalities: [] },
    ],
  },
);
check(
  'mergeModelsApi lets the api modality override the static guess',
  mergedModels.modelInfo.find((m) => m.id === 'known')?.decisionModel === true && mergedModels.decisionModels.includes('known'),
  JSON.stringify(mergedModels),
);
check(
  'mergeModelsApi appends remote-only decision models',
  mergedModels.decisionModels.includes('remote') && mergedModels.remoteDecisionModels.join(',') === 'remote',
  JSON.stringify(mergedModels),
);
check(
  'mergeModelsApi ignores non-decision remote-only models',
  mergedModels.decisionModels.includes('text-only') === false,
  JSON.stringify(mergedModels.decisionModels),
);
check(
  'mergeModelsApi falls back cleanly without a probe result',
  mergeModelsApi([{ id: 'a', decisionModel: true }], ['a'], null).decisionModels.join(',') === 'a',
);

const staticModalitySurvives = mergeModelsApi(
  [{ id: 'static-decision', modality: 'decision', decisionModel: true }],
  ['static-decision'],
  { ok: true, models: [{ id: 'other', modality: 'text', inputModalities: [] }] },
);
check(
  'a static modality survives when the api omits the model',
  staticModalitySurvives.decisionModels.includes('static-decision'),
  JSON.stringify(staticModalitySurvives.decisionModels),
);

const apiOverridesStaticModality = mergeModelsApi(
  [{ id: 'static-decision', modality: 'decision', decisionModel: true }],
  ['static-decision'],
  { ok: true, models: [{ id: 'static-decision', modality: 'text', inputModalities: [] }] },
);
check(
  'the api modality overrides a static modality',
  apiOverridesStaticModality.decisionModels.includes('static-decision') === false &&
    apiOverridesStaticModality.modelInfo[0].decisionSource === 'models-api-negative',
  JSON.stringify(apiOverridesStaticModality),
);

await new Promise((resolve) => server.close(resolve));
await rm(workDir, { recursive: true, force: true });

console.log('');
console.log(failures === 0 ? 'PROVIDER MODE OK' : 'PROVIDER MODE FAILED: ' + failures + ' check(s)');
process.exit(failures === 0 ? 0 : 1);
