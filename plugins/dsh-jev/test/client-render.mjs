/**
 * 前端设置面板渲染测试（lib/client.js）。
 *
 * 面板是用户唯一能看到「下拉选择 dsh 已配置提供商与模型」「手写 baseUrl」的地方，
 * 组件树一旦坏了就是整个设置页抛异常。这里用桩 React 加载 lib/client.js
 * （与 Web 加载方式一致：window.__ModuleLoader__.load），并断言：
 *   - 注册进 settings.section 槽位，导航标签是「决策模型」；
 *   - 默认是手动配置：TypeSafe 官方地址 + /v1/systemone；
 *   - 来源切换在 manual / provider 两种表单之间正确切换；
 *   - 提供商下拉列出 dsh 提供商，切换时把模型下拉收敛到该提供商的决策模型；
 *   - getConfig 回填所有字段，配置固定的字段被禁用；
 *   - 保存与测试都带上当前来源下的全部字段。
 *
 * 零依赖、无浏览器、无网络。
 *
 * Run: node test/client-render.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let failures = 0;
function check(label, condition, extra) {
  if (condition) {
    console.log('PASS ' + label);
  } else {
    failures += 1;
    console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra));
  }
}

// ---------------------------------------------------------------------------
// 桩 React：createElement 建普通树，hooks 手工驱动
// ---------------------------------------------------------------------------
const hookState = [];
let hookIndex = 0;
let effectFns = [];

const react = {
  createElement(type, props, ...children) {
    return {
      type,
      props: props ?? {},
      children: children.flat().filter((c) => c !== null && c !== undefined && c !== false),
    };
  },
  useState(initial) {
    const i = hookIndex++;
    if (!(i in hookState)) hookState[i] = typeof initial === 'function' ? initial() : initial;
    const set = (value) => {
      hookState[i] = typeof value === 'function' ? value(hookState[i]) : value;
    };
    return [hookState[i], set];
  },
  useEffect(fn) {
    hookIndex++;
    effectFns.push(fn);
  },
};

// ---------------------------------------------------------------------------
// 按 Web 加载器的方式加载客户端包
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

const clientPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'client.js');
// eslint-disable-next-line no-eval
(0, eval)(readFileSync(clientPath, 'utf8'));

check('client bundle registers itself with the module loader', registration !== null && registration.id === 'dsh-jev', String(registration && registration.id));

const mod = registration.factory((id) => {
  if (id === 'react') return react;
  throw new Error('unexpected require: ' + id);
});
check('client exports apply', typeof mod.apply === 'function');
check('client injects slots and connection', mod.inject.join(',') === 'slots,connection', JSON.stringify(mod.inject));

// ---------------------------------------------------------------------------
// 假 ctx：捕获注册进来的设置组件
// ---------------------------------------------------------------------------
let component = null;
let slotOptions = null;
const ctx = {
  calls: [],
  connection: {
    rpc: {
      call: async (channel, method, payload) => {
        ctx.lastCall = { channel, method, payload };
        ctx.calls.push({ channel, method, payload });
        return ctx.rpcResult ?? { ok: true, value: {} };
      },
    },
  },
  slots: {
    inject: (_name, fn) => fn(),
    register: (options, comp) => {
      component = comp;
      slotOptions = options;
      return () => {};
    },
  },
};
mod.apply(ctx);
check('apply registers a settings component', typeof component === 'function', typeof component);
check('the slot is settings.section', slotOptions.name === 'settings.section', slotOptions.name);
check('the slot id stays dsh-jev (bundle identity)', slotOptions.id === 'dsh-jev', slotOptions.id);
check('the slot declares a label', typeof slotOptions.label === 'function');

const navLabel = slotOptions.label();
const navLabelText = navLabel.children?.[1]?.children?.[0];
check('the settings nav is named 决策模型', navLabelText === '决策模型', String(navLabelText));

// ---------------------------------------------------------------------------
// 渲染辅助
// ---------------------------------------------------------------------------
function render() {
  hookIndex = 0;
  effectFns = [];
  return component({ rpcCall });
}

async function flush() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function findAll(node, predicate, out = []) {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out);
    return out;
  }
  if (predicate(node)) out.push(node);
  for (const child of node.children ?? []) findAll(child, predicate, out);
  return out;
}

const isInput = (n) => n.type === 'input';
const isSelect = (n) => n.type === 'select';
const labelOf = (tree, text) => findAll(tree, (n) => n.type === 'span' && n.children?.[0] === text)[0];
/** 找某个 label 所在的 .jev-field 容器。 */
const fieldOf = (tree, text) => {
  const label = labelOf(tree, text);
  return findAll(tree, (n) => n.props?.className === 'jev-field' && n.children?.includes(label))[0];
};
const optionValues = (select) => findAll(select, (n) => n.type === 'option').map((o) => o.props.value);
const optionLabels = (select) => findAll(select, (n) => n.type === 'option').map((o) => String(o.children?.[0] ?? ''));

const rpcCall = async (method, payload) => {
  const result = await ctx.connection.rpc.call('channel', method, payload);
  if (result && result.ok === true) return result.value;
  throw new Error(result?.error?.message || '请求失败');
};

/** 一份 getConfig 返回值（provider 模式，带完整提供商列表）。 */
const PROVIDER_VIEW = {
  configured: true,
  apiKey: 'cred-...-yaml',
  apiKeyFrom: 'credentials:AIPROXY_DSH_WEB_ACCESS_TOKEN',
  source: 'provider',
  provider: 'ai-proxy',
  providers: [
    {
      id: 'ai-proxy',
      name: 'AI Proxy',
      baseURL: 'http://192.168.1.253:8319/v1',
      apiKeyEnv: 'AIPROXY_DSH_WEB_ACCESS_TOKEN',
      api: 'openai-responses',
      models: ['jev-latest', 'deepseek-v4.1-flash'],
      decisionModels: ['jev-latest'],
      modelInfo: [
        { id: 'jev-latest', name: '', input: ['text', 'image'], type: '', api: 'openai-responses', modality: 'decision', decisionSource: 'models-api', decisionModel: true },
        { id: 'deepseek-v4.1-flash', name: '', input: ['text'], type: '', api: 'openai-responses', modality: 'text', decisionSource: 'models-api-negative', decisionModel: false },
      ],
      modelsApi: { ok: true, count: 4, remoteDecisionModels: ['liquid/d1-ultra'] },
    },
    {
      id: 'other',
      name: 'Other',
      baseURL: 'https://api.example.com/v1',
      apiKeyEnv: 'OTHER_KEY',
      api: 'openai-completions',
      models: ['some-chat-model'],
      decisionModels: [],
      modelInfo: [
        { id: 'some-chat-model', name: '', input: ['text'], type: '', api: 'openai-completions', decisionModel: false },
      ],
    },
  ],
  model: 'jev-latest',
  models: ['jev-latest', 'deepseek-v4.1-flash'],
  decisionModels: ['jev-latest', 'liquid/d1-ultra'],
  modelInfo: [
    { id: 'jev-latest', name: '', input: ['text', 'image'], type: '', api: 'openai-responses', modality: 'decision', decisionSource: 'models-api', decisionModel: true },
    { id: 'deepseek-v4.1-flash', name: '', input: ['text'], type: '', api: 'openai-responses', modality: 'text', decisionSource: 'models-api-negative', decisionModel: false },
    { id: 'liquid/d1-ultra', name: '', input: [], type: '', api: '', modality: 'decision', decisionSource: 'models-api', decisionModel: true },
  ],
  modelsApi: { ok: true, count: 4, remoteDecisionModels: ['liquid/d1-ultra'] },
  baseURL: 'http://192.168.1.253:8319/v1',
  manualBaseURL: 'https://api.typesafe.ai',
  manualApiKey: 'ts-man...1234',
  baseURLDefault: 'https://api.typesafe.ai',
  baseURLLocked: false,
  endpoint: '/v1/decisions',
  endpointDefault: '/v1/decisions',
  endpointDefaults: { manual: '/v1/systemone', provider: '/v1/decisions' },
  endpointLocked: false,
  proxy: '',
  proxyLocked: false,
  configSource: 'user-set',
};

// ---------------------------------------------------------------------------
// 1. 默认渲染：手动配置 + TypeSafe 官方地址
// ---------------------------------------------------------------------------
let tree = render();
check('renders the panel heading', findAll(tree, (n) => n.type === 'h2')[0]?.children[0] === '决策模型设置');
check('the intro mentions the official default', findAll(tree, (n) => n.type === 'p' && String(n.children[0] ?? '').includes('https://api.typesafe.ai')).length > 0);

const sourceSelect = findAll(tree, isSelect)[0];
check('renders a source select', sourceSelect !== undefined);
check('the source select defaults to manual', sourceSelect.props.value === 'manual', String(sourceSelect.props.value));
check('the source select offers provider mode', optionValues(sourceSelect).join(',') === 'manual,provider', optionValues(sourceSelect).join(','));

const baseURLField = fieldOf(tree, '接口地址');
check('renders the 接口地址 field', baseURLField !== undefined);
const baseURLInput = findAll(baseURLField, isInput)[0];
check('the baseURL input starts with the official address', baseURLInput.props.value === 'https://api.typesafe.ai', JSON.stringify(baseURLInput.props.value));
check('the baseURL input is enabled by default', baseURLInput.props.disabled === false, String(baseURLInput.props.disabled));
check('the baseURL input offers a placeholder', String(baseURLInput.props.placeholder).includes('https://api.typesafe.ai'), String(baseURLInput.props.placeholder));

const modelField = fieldOf(tree, '默认决策模型');
check('renders the 默认决策模型 field', modelField !== undefined);
const modelInput = findAll(modelField, isInput)[0];
check('the manual model field starts with jev-latest', modelInput.props.value === 'jev-latest', String(modelInput.props.value));

// 手动配置时不显示提供商下拉
check('manual mode hides the provider select', fieldOf(tree, '提供商') === undefined);
check('manual mode renders only source + endpoint selects', findAll(tree, isSelect).length === 2, String(findAll(tree, isSelect).length));

// ---------------------------------------------------------------------------
// 2. 端点是下拉，默认 /v1/systemone
// ---------------------------------------------------------------------------
const endpointField = fieldOf(tree, '接口端点');
check('renders the 接口端点 field', endpointField !== undefined);
const endpointSelect = findAll(endpointField, isSelect)[0];
check('the endpoint select starts with /v1/systemone', endpointSelect.props.value === '/v1/systemone', String(endpointSelect.props.value));
check('the endpoint select offers both endpoints', optionValues(endpointSelect).join(',') === '/v1/systemone,/v1/decisions', optionValues(endpointSelect).join(','));

// ---------------------------------------------------------------------------
// 3. 手动模式输入会更新状态并随保存/测试发出
// ---------------------------------------------------------------------------
findAll(baseURLField, isInput)[0].props.onChange({ target: { value: 'http://127.0.0.1:8000' } });
tree = render();
check('typing updates the baseURL input', findAll(fieldOf(tree, '接口地址'), isInput)[0].props.value === 'http://127.0.0.1:8000');

findAll(fieldOf(tree, '接口端点'), isSelect)[0].props.onChange({ target: { value: '/v1/decisions' } });
tree = render();
check('selecting /v1/decisions updates the endpoint', findAll(fieldOf(tree, '接口端点'), isSelect)[0].props.value === '/v1/decisions');

findAll(fieldOf(tree, '默认决策模型'), isInput)[0].props.onChange({ target: { value: 'custom-decision' } });
tree = render();
check('typing updates the model input', findAll(fieldOf(tree, '默认决策模型'), isInput)[0].props.value === 'custom-decision');

findAll(fieldOf(tree, 'API Key'), isInput)[0].props.onChange({ target: { value: 'ts-manual-key' } });
findAll(fieldOf(tree, '代理地址'), isInput)[0].props.onChange({ target: { value: 'http://127.0.0.1:7890' } });
tree = render();
check('typing updates the API key input', findAll(fieldOf(tree, 'API Key'), isInput)[0].props.value === 'ts-manual-key');
check('typing updates the proxy input', findAll(fieldOf(tree, '代理地址'), isInput)[0].props.value === 'http://127.0.0.1:7890');
const proxyHint = findAll(tree, (n) => n.type === 'p' && String(n.children[0] ?? '').includes('留空表示直连'))[0];
check('the proxy hint explains that an empty value means direct', proxyHint !== undefined);

const saveButton = findAll(tree, (n) => n.type === 'button' && n.children?.[0] === '保存设置')[0];
const testButton = findAll(tree, (n) => n.type === 'button' && n.children?.[0] === '测试连接')[0];
check('renders the save button', saveButton !== undefined);
check('renders the test button', testButton !== undefined);

ctx.calls = [];
ctx.rpcResult = { ok: true, value: {} };
await saveButton.props.onClick();
const manualSaveCall = ctx.calls.find((c) => c.method === 'saveConfig');
check(
  'manual save sends baseURL, endpoint, model, key and proxy',
  manualSaveCall?.payload.source === 'manual' &&
    manualSaveCall.payload.baseURL === 'http://127.0.0.1:8000' &&
    manualSaveCall.payload.endpoint === '/v1/decisions' &&
    manualSaveCall.payload.model === 'custom-decision' &&
    manualSaveCall.payload.apiKey === 'ts-manual-key' &&
    manualSaveCall.payload.proxy === 'http://127.0.0.1:7890' &&
    manualSaveCall.payload.provider === undefined,
  JSON.stringify(manualSaveCall),
);

ctx.lastCall = null;
ctx.rpcResult = { ok: true, value: { durationMs: 42, model: 'custom-decision', baseURL: 'http://127.0.0.1:8000', endpoint: '/v1/decisions', source: 'manual', apiKeyFrom: 'inline' } };
await findAll(render(), (n) => n.type === 'button' && n.children?.[0] === '测试连接')[0].props.onClick();
check('manual test sends the same payload', ctx.lastCall?.method === 'testConnection' && ctx.lastCall.payload.baseURL === 'http://127.0.0.1:8000', JSON.stringify(ctx.lastCall));
tree = render();
const okStatus = findAll(tree, (n) => n.props?.className === 'jev-status ok')[0];
check('a successful test names the model', String(okStatus?.children?.[0] ?? '').includes('custom-decision'), String(okStatus?.children?.[0]));

// ---------------------------------------------------------------------------
// 4. getConfig 回填 provider 视图
// ---------------------------------------------------------------------------
ctx.rpcResult = { ok: true, value: PROVIDER_VIEW };
tree = render();
await effectFns[0]();
await flush();
tree = render();
check('getConfig switches the form to provider mode', findAll(tree, isSelect)[0].props.value === 'provider', String(findAll(tree, isSelect)[0].props.value));
const providerField = fieldOf(tree, '提供商');
check('provider mode renders the provider select', providerField !== undefined);
const providerSelect = findAll(providerField, isSelect)[0];
check('the provider select is populated from getConfig', optionValues(providerSelect).join(',') === 'ai-proxy,other', optionValues(providerSelect).join(','));
check('the provider select labels decision-model counts', optionLabels(providerSelect)[0].includes('1 个决策模型'), optionLabels(providerSelect)[0]);
check('the provider select keeps the active provider', providerSelect.props.value === 'ai-proxy', String(providerSelect.props.value));
check('provider mode hides the baseURL form item', fieldOf(tree, '接口地址') === undefined && fieldOf(tree, '接口地址（由提供商决定）') === undefined);
check('provider mode hides the API Key form item', fieldOf(tree, 'API Key') === undefined);
check('provider mode renders exactly four selects (source/provider/model/endpoint)', findAll(tree, isSelect).length === 4, String(findAll(tree, isSelect).length));
check('provider mode hides the manual model input', fieldOf(tree, '默认决策模型') === undefined);
const providerModelField = fieldOf(tree, '模型');
const providerModelSelect = findAll(providerModelField, isSelect)[0];
check('provider mode renders a model select', providerModelSelect !== undefined && providerModelSelect.props.value === 'jev-latest', JSON.stringify(providerModelSelect?.props));
check('the model select offers the provider models plus remote decisions', optionValues(providerModelSelect).join(',') === 'jev-latest,liquid/d1-ultra,deepseek-v4.1-flash', optionValues(providerModelSelect).join(','));
check('the model select groups decision models first', findAll(providerModelSelect, (n) => n.type === 'optgroup')[0]?.props.label === '决策模型');
check('the model label carries the decision flag', optionLabels(providerModelSelect)[0].includes('决策模型'), optionLabels(providerModelSelect)[0]);
check('the model label carries the api modality', optionLabels(providerModelSelect)[0].includes('modality=decision'), optionLabels(providerModelSelect)[0]);
const textModelLabel = optionLabels(providerModelSelect).find((label) => label.startsWith('deepseek-v4.1-flash'));
check('a non-decision model also shows its api modality', String(textModelLabel).includes('modality=text'), String(textModelLabel));
check('the model label does not repeat a plain chat route api', optionLabels(providerModelSelect)[0].includes('openai-responses') === false, optionLabels(providerModelSelect)[0]);
const modelsApiHint = findAll(tree, (n) => n.type === 'p' && String(n.children[0] ?? '').includes('额外报告了 1 个决策模型'))[0];
check('the hint reports the /v1/models decision models', modelsApiHint !== undefined, String(modelsApiHint?.children?.[0]));
check('getConfig restores the provider endpoint', findAll(fieldOf(tree, '接口端点'), isSelect)[0].props.value === '/v1/decisions');

// ---------------------------------------------------------------------------
// 5. 切换提供商 -> 模型收敛
// ---------------------------------------------------------------------------
findAll(fieldOf(tree, '提供商'), isSelect)[0].props.onChange({ target: { value: 'other' } });
tree = render();
check('switching the provider updates the model list', optionValues(findAll(fieldOf(tree, '模型'), isSelect)[0]).join(',') === 'some-chat-model', optionValues(findAll(fieldOf(tree, '模型'), isSelect)[0]).join(','));
check('switching the provider selects its first model', findAll(fieldOf(tree, '模型'), isSelect)[0].props.value === 'some-chat-model', String(findAll(fieldOf(tree, '模型'), isSelect)[0].props.value));

// 切回 ai-proxy，让保存测试使用 jev-latest
findAll(fieldOf(tree, '提供商'), isSelect)[0].props.onChange({ target: { value: 'ai-proxy' } });
tree = render();
check('switching back selects jev-latest', findAll(fieldOf(tree, '模型'), isSelect)[0].props.value === 'jev-latest', String(findAll(fieldOf(tree, '模型'), isSelect)[0].props.value));

// ---------------------------------------------------------------------------
// 6. provider 模式保存 / 测试载荷
// ---------------------------------------------------------------------------
findAll(fieldOf(tree, '接口端点'), isSelect)[0].props.onChange({ target: { value: '/v1/decisions' } });
findAll(fieldOf(tree, '代理地址'), isInput)[0].props.onChange({ target: { value: '' } });
tree = render();
ctx.calls = [];
ctx.rpcResult = { ok: true, value: {} };
await findAll(tree, (n) => n.type === 'button' && n.children?.[0] === '保存设置')[0].props.onClick();
const providerSaveCall = ctx.calls.find((c) => c.method === 'saveConfig');
check(
  'provider save sends source, provider and model, but no baseURL',
  providerSaveCall?.payload.source === 'provider' &&
    providerSaveCall.payload.provider === 'ai-proxy' &&
    providerSaveCall.payload.model === 'jev-latest' &&
    providerSaveCall.payload.endpoint === '/v1/decisions' &&
    providerSaveCall.payload.baseURL === undefined &&
    providerSaveCall.payload.apiKey === undefined,
  JSON.stringify(providerSaveCall),
);

ctx.lastCall = null;
ctx.rpcResult = { ok: true, value: { durationMs: 12, model: 'jev-latest', source: 'provider', provider: 'ai-proxy', baseURL: 'http://192.168.1.253:8319/v1', endpoint: '/v1/decisions', apiKeyFrom: 'credentials:AIPROXY_DSH_WEB_ACCESS_TOKEN' } };
await findAll(render(), (n) => n.type === 'button' && n.children?.[0] === '测试连接')[0].props.onClick();
check('provider test sends the provider payload', ctx.lastCall?.method === 'testConnection' && ctx.lastCall.payload.provider === 'ai-proxy', JSON.stringify(ctx.lastCall));
tree = render();
const providerStatus = findAll(tree, (n) => n.props?.className === 'jev-status ok')[0];
check('a successful provider test names the provider', String(providerStatus?.children?.[0] ?? '').includes('提供商 ai-proxy'), String(providerStatus?.children?.[0]));

// ---------------------------------------------------------------------------
// 7. 切换回 manual 时端点跟随默认值
// ---------------------------------------------------------------------------
findAll(tree, isSelect)[0].props.onChange({ target: { value: 'manual' } });
tree = render();
check('switching back to manual restores the native endpoint default', findAll(fieldOf(tree, '接口端点'), isSelect)[0].props.value === '/v1/systemone', String(findAll(fieldOf(tree, '接口端点'), isSelect)[0].props.value));
check('switching back to manual shows the baseURL input again', findAll(fieldOf(tree, '接口地址'), isInput)[0].props.disabled === false);
check('switching back to manual restores the manual baseURL, not the provider one', findAll(fieldOf(tree, '接口地址'), isInput)[0].props.value === 'https://api.typesafe.ai', String(findAll(fieldOf(tree, '接口地址'), isInput)[0].props.value));
check('switching back to manual restores the manual API key mask', findAll(fieldOf(tree, 'API Key'), isInput)[0].props.value === 'ts-man...1234', String(findAll(fieldOf(tree, 'API Key'), isInput)[0].props.value));

// ---------------------------------------------------------------------------
// 8. 配置固定的字段禁用输入
// ---------------------------------------------------------------------------
ctx.rpcResult = {
  ok: true,
  value: {
    source: 'manual',
    provider: '',
    providers: [],
    model: 'jev-latest',
    models: [],
    decisionModels: [],
    baseURL: 'http://127.0.0.1:9000',
    baseURLLocked: true,
    endpoint: '/v1/decisions',
    endpointLocked: true,
    endpointDefaults: { manual: '/v1/systemone', provider: '/v1/decisions' },
    proxy: 'http://127.0.0.1:7890',
    proxyLocked: true,
    configured: true,
    apiKey: 'ts-ab...1234',
  },
};
tree = render();
await effectFns[0]();
await flush();
tree = render();
check('a config-pinned baseURL disables the input', findAll(fieldOf(tree, '接口地址'), isInput)[0].props.disabled === true);
const lockedBaseHint = findAll(tree, (n) => n.type === 'p' && String(n.children[0] ?? '').includes('baseURL）固定'))[0];
check('the hint explains why the baseURL is locked', lockedBaseHint !== undefined);
check('a config-pinned endpoint disables the select', findAll(fieldOf(tree, '接口端点'), isSelect)[0].props.disabled === true);
const lockedEndpointHint = findAll(tree, (n) => n.type === 'p' && String(n.children[0] ?? '').includes('endpoint）固定'))[0];
check('the hint explains why the endpoint is locked', lockedEndpointHint !== undefined);
check('a config-pinned proxy disables the input', findAll(fieldOf(tree, '代理地址'), isInput)[0].props.disabled === true);
const lockedProxyHint = findAll(tree, (n) => n.type === 'p' && String(n.children[0] ?? '').includes('proxy）固定'))[0];
check('the hint explains why the proxy is locked', lockedProxyHint !== undefined);

console.log('');
console.log(failures === 0 ? 'CLIENT OK' : 'CLIENT FAILED: ' + failures + ' check(s)');
process.exit(failures === 0 ? 0 : 1);
