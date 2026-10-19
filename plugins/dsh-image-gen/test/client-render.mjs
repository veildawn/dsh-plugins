/**
 * 前端设置面板渲染测试（lib/client.js）。
 *
 * 面板是用户唯一能看到「下拉选择 dsh 已配置提供商与模型」「下拉选择尺寸与画质」
 * 的地方，组件树一旦坏了就是整个设置页抛异常。这里用桩 React 加载 lib/client.js
 * （与 Web 加载方式一致：window.__ModuleLoader__.load），并断言：
 *   - 注册进 settings.section 槽位；
 *   - 来源切换在 provider / manual 两种表单之间正确切换；
 *   - 提供商下拉列出 dsh 提供商，切换时把模型下拉收敛到该提供商的生图模型；
 *   - 尺寸与画质是下拉（select + option），不是自由文本；
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
    if (!(i in hookState)) hookState[i] = initial;
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

check('client bundle registers itself with the module loader', registration !== null && registration.id === '@weniatall/dsh-image-gen', String(registration && registration.id));

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
  connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
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
check('the slot id is dsh-image-gen', slotOptions.id === 'dsh-image-gen', slotOptions.id);
check('the slot supplies rpcCall', typeof slotOptions.inject().rpcCall === 'function');
check('the slot declares a label', typeof slotOptions.label === 'function');

// ---------------------------------------------------------------------------
// 渲染辅助
// ---------------------------------------------------------------------------
/** 渲染一次面板（重置 hook 索引，让 useState 读到最新状态）。 */
function render(rpc = rpcCall) {
  hookIndex = 0;
  effectFns = [];
  return component({ rpcCall: rpc });
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
const optionValues = (select) => findAll(select, (n) => n.type === 'option').map((o) => o.props.value);

/** 让 getConfig 的 Promise 落地。 */
async function flush() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

/** getConfig 返回的假数据：一个带生图模型的提供商 + 一个只有聊天模型的。 */
const CONFIG = {
  source: 'provider',
  provider: 'ai-proxy',
  baseURL: '',
  model: 'gemini-3.1-flash-image',
  size: '1024x1024',
  quality: 'auto',
  proxy: '',
  proxyLocked: false,
  proxyHosts: ['*'],
  apiKeyEnv: 'AIPROXY_DSH_WEB_ACCESS_TOKEN',
  apiKeyConfigured: true,
  apiKeyFrom: 'credentials:AIPROXY_DSH_WEB_ACCESS_TOKEN',
  configSource: 'user-set',
  settingsFile: '/home/x/.dsh/image-gen/settings.json',
  locked: {},
  inferred: { provider: 'ai-proxy', model: 'gemini-3.1-flash-image' },
  providers: [
    {
      id: 'ai-proxy',
      name: 'AI Proxy',
      baseURL: 'http://192.168.1.253:8319/v1',
      apiKeyEnv: 'AIPROXY_DSH_WEB_ACCESS_TOKEN',
      models: ['gemini-3.1-flash-image', 'grok-imagine-image', 'glm-5.3'],
      imageModels: ['gemini-3.1-flash-image', 'grok-imagine-image'],
    },
    {
      id: 'chat-only',
      name: 'Chat Only',
      baseURL: 'https://api.example.com/v1',
      apiKeyEnv: 'CHAT_KEY',
      models: ['glm-5.3'],
      imageModels: [],
    },
  ],
  availableProviders: ['ai-proxy', 'chat-only'],
  sizeOptions: [
    { value: '1024x1024', label: '1024 × 1024（方形 1:1）' },
    { value: '1024x1792', label: '1024 × 1792（竖版 9:16）' },
    { value: '1792x1024', label: '1792 × 1024（横版 16:9）' },
    { value: 'auto', label: 'auto（由模型决定）' },
  ],
  qualityOptions: [
    { value: 'auto', label: 'auto（默认）' },
    { value: 'standard', label: 'standard（标准）' },
    { value: 'high', label: 'high（高）' },
  ],
  availableModels: ['gemini-3.1-flash-image', 'grok-imagine-image', 'glm-5.3'],
  availableImageModels: ['gemini-3.1-flash-image', 'grok-imagine-image'],
};

const rpcCall = async () => CONFIG;

// ---------------------------------------------------------------------------
// 1. 默认渲染（provider 来源，先让 getConfig 落地）
// ---------------------------------------------------------------------------
/** 渲染并跑完 getConfig 的副作用，返回填好数据的树。 */
async function renderLoaded(rpc = rpcCall) {
  const first = render(rpc);
  for (const fn of effectFns) fn();
  await flush();
  return render(rpc);
}

let tree = await renderLoaded();
check('renders the panel heading', findAll(tree, (n) => n.type === 'h2')[0]?.children[0] === '生图模型设置');
check('renders an intro paragraph', findAll(tree, (n) => n.type === 'p' && String(n.children[0] ?? '').includes('文生图'))[0] !== undefined);

const sourceLabel = labelOf(tree, '配置来源');
check('renders a 配置来源 label', sourceLabel !== undefined);
const selects = findAll(tree, isSelect);
check('renders the source select', selects[0] !== undefined);
check('the source select offers both modes', optionValues(selects[0]).join(',') === 'provider,manual', optionValues(selects[0]).join(','));
check('the source select starts on provider', selects[0].props.value === 'provider', String(selects[0].props.value));

const providerLabel = labelOf(tree, '提供商');
check('renders a 提供商 label', providerLabel !== undefined);
const providerSelect = selects[1];
check('renders a provider select', providerSelect !== undefined);
check('the provider select lists dsh providers', optionValues(providerSelect).includes('ai-proxy') && optionValues(providerSelect).includes('chat-only'), optionValues(providerSelect).join(','));
check('the provider select starts on the active provider', providerSelect.props.value === 'ai-proxy', String(providerSelect.props.value));
check('the provider select is enabled by default', providerSelect.props.disabled === false, String(providerSelect.props.disabled));
check('the provider options mention the image-model count', (() => {
  const opt = findAll(providerSelect, (n) => n.type === 'option' && n.props.value === 'ai-proxy')[0];
  return String(opt?.children?.[0] ?? '').includes('2 个生图模型');
})());

const modelLabel = labelOf(tree, '模型');
check('renders a 模型 label', modelLabel !== undefined);
const modelSelect = selects[2];
check('renders a model select', modelSelect !== undefined);
check('the model select is a dropdown, not a text input', modelSelect.type === 'select');
check('the model select groups the image models', (() => {
  const groups = findAll(modelSelect, (n) => n.type === 'optgroup');
  return groups.some((g) => g.props.label === '生图模型' && optionValues(g).includes('gemini-3.1-flash-image'));
})());
check('the model select keeps other models in a second group', (() => {
  const groups = findAll(modelSelect, (n) => n.type === 'optgroup');
  return groups.some((g) => g.props.label !== '生图模型' && optionValues(g).includes('glm-5.3'));
})());
check('the model select starts on the active model', modelSelect.props.value === 'gemini-3.1-flash-image', String(modelSelect.props.value));

const sizeLabel = labelOf(tree, '图片尺寸');
check('renders a 图片尺寸 label', sizeLabel !== undefined);
const sizeSelect = selects[3];
check('renders a size select', sizeSelect !== undefined);
check('the size select offers every option from the server', optionValues(sizeSelect).length === CONFIG.sizeOptions.length, String(optionValues(sizeSelect).length));
check('the size select carries human labels', optionValues(sizeSelect).every((v) => CONFIG.sizeOptions.some((o) => o.value === v)));
check('the size select starts on the saved size', sizeSelect.props.value === '1024x1024', String(sizeSelect.props.value));
check('the size select is enabled by default', sizeSelect.props.disabled !== true, String(sizeSelect.props.disabled));

const qualityLabel = labelOf(tree, '画质');
check('renders a 画质 label', qualityLabel !== undefined);
const qualitySelect = selects[4];
check('renders a quality select', qualitySelect !== undefined);
check('the quality select offers every option from the server', optionValues(qualitySelect).length === CONFIG.qualityOptions.length, String(optionValues(qualitySelect).length));
check('the quality select starts on auto', qualitySelect.props.value === 'auto', String(qualitySelect.props.value));

check('the manual baseUrl input is hidden in provider mode', findAll(tree, (n) => n.type === 'span' && n.children?.[0] === '接口地址 baseUrl').length === 0);
check('the manual API Key input is hidden in provider mode', findAll(tree, (n) => n.type === 'span' && n.children?.[0] === 'API Key').length === 0);

// ---------------------------------------------------------------------------
// 2. 切到手动模式
// ---------------------------------------------------------------------------
selects[0].props.onChange({ target: { value: 'manual' } });
tree = render();
const manualSelects = findAll(tree, isSelect);
check('switching to manual hides the provider select', findAll(tree, (n) => n.type === 'span' && n.children?.[0] === '提供商').length === 0);
check('switching to manual shows the baseUrl input', labelOf(tree, '接口地址 baseUrl') !== undefined);
const manualInputs = findAll(tree, isInput);
check('switching to manual shows the API Key input', labelOf(tree, 'API Key') !== undefined);
const baseUrlInput = manualInputs.find((i) => i.props.type === 'text' && String(i.props.placeholder ?? '').includes('v1'));
check('the baseUrl input offers a placeholder', baseUrlInput !== undefined, JSON.stringify(manualInputs.map((i) => i.props.placeholder)));
check('the baseUrl input is enabled by default', baseUrlInput && baseUrlInput.props.disabled === false);
const keyInput = manualInputs.find((i) => i.props.type === 'password');
check('the API Key input is a password field', keyInput !== undefined);
check('the API Key input says the key is already saved', String(keyInput?.props.placeholder ?? '').includes('已保存'), String(keyInput?.props.placeholder));
check('the manual size select is still offered', findAll(tree, isSelect).length >= 3);
check('the manual quality select is still offered', labelOf(tree, '画质') !== undefined);
const manualModelInput = manualInputs.find((i) => i.props.type === 'text' && String(i.props.placeholder ?? '').includes('gemini'));
check('manual mode renders model as text input for custom models', manualModelInput !== undefined);
manualModelInput.props.onChange({ target: { value: 'custom-flux-v1' } });
tree = render();
check('typing updates the manual model value', findAll(tree, isInput).some((i) => i.props.value === 'custom-flux-v1'));

// 手写 baseUrl 与 key
baseUrlInput.props.onChange({ target: { value: 'http://127.0.0.1:8319/v1' } });
keyInput.props.onChange({ target: { value: 'sk-typed' } });
tree = render();
const typedBase = findAll(tree, isInput).find((i) => i.props.type === 'text' && String(i.props.placeholder ?? '').includes('v1'));
check('typing updates the baseUrl value', typedBase.props.value === 'http://127.0.0.1:8319/v1', typedBase.props.value);
const typedKey = findAll(tree, isInput).find((i) => i.props.type === 'password');
check('typing updates the API Key value', typedKey.props.value === 'sk-typed', typedKey.props.value);

// 切回 provider 模式
findAll(tree, isSelect)[0].props.onChange({ target: { value: 'provider' } });
tree = render();
check('switching back hides the manual fields', labelOf(tree, '接口地址 baseUrl') === undefined && labelOf(tree, 'API Key') === undefined);
check('switching back restores the provider select', labelOf(tree, '提供商') !== undefined);

// ---------------------------------------------------------------------------
// 3. 切提供商时模型下拉收敛到该提供商的生图模型
// ---------------------------------------------------------------------------
tree = render();
const providerSel = findAll(tree, isSelect)[1];
providerSel.props.onChange({ target: { value: 'chat-only' } });
tree = render();
const chatModelSelect = findAll(tree, isSelect)[2];
check('switching provider swaps the model list', optionValues(chatModelSelect).join(',') === 'glm-5.3', optionValues(chatModelSelect).join(','));
check('switching provider picks the first model', chatModelSelect.props.value === 'glm-5.3', String(chatModelSelect.props.value));
check('a provider without image models drops the image group', findAll(chatModelSelect, (n) => n.type === 'optgroup' && n.props.label === '生图模型').length === 0);
check('the hint warns that no image model was found', (() => {
  const hints = findAll(tree, (n) => n.type === 'p' && String(n.children?.[0] ?? '').includes('没有识别到生图模型'));
  return hints.length > 0;
})());

providerSel.props.onChange({ target: { value: 'ai-proxy' } });
tree = render();
const backModelSelect = findAll(tree, isSelect)[2];
check('switching back restores the image models', optionValues(backModelSelect).includes('grok-imagine-image') && optionValues(backModelSelect).includes('glm-5.3'), optionValues(backModelSelect).join(','));

// 尺寸/画质下拉切换
const sizeSel = findAll(tree, isSelect)[3];
sizeSel.props.onChange({ target: { value: '1024x1792' } });
tree = render();
check('selecting a size updates the value', findAll(tree, isSelect)[3].props.value === '1024x1792', String(findAll(tree, isSelect)[3].props.value));
const qualitySel = findAll(tree, isSelect)[4];
qualitySel.props.onChange({ target: { value: 'high' } });
tree = render();
check('selecting a quality updates the value', findAll(tree, isSelect)[4].props.value === 'high', String(findAll(tree, isSelect)[4].props.value));

// ---------------------------------------------------------------------------
// 4. getConfig 回填 + 配置固定字段被禁用
// ---------------------------------------------------------------------------
tree = await renderLoaded();
check('getConfig fills the provider', findAll(tree, isSelect)[1].props.value === 'ai-proxy');
check('getConfig fills the model', findAll(tree, isSelect)[2].props.value === 'gemini-3.1-flash-image');
check('getConfig fills the size', findAll(tree, isSelect)[3].props.value === '1024x1024');
check('getConfig fills the quality', findAll(tree, isSelect)[4].props.value === 'auto');
check('getConfig fills the proxy field', (() => {
  const proxyInput = findAll(tree, isInput).find((i) => String(i.props.placeholder ?? '').includes('7890'));
  return proxyInput && proxyInput.props.value === '';
})());

// 配置固定了 provider / model / proxy 的情况
const LOCKED = {
  ...CONFIG,
  locked: { provider: true, model: true },
  proxy: 'http://user:***@127.0.0.1:7890',
  proxyLocked: true,
};
const lockedRpc = async () => LOCKED;
tree = await renderLoaded(lockedRpc);
const lockedSelects = findAll(tree, isSelect);
check('a config-pinned provider disables its select', lockedSelects[1].props.disabled === true, String(lockedSelects[1].props.disabled));
check('a config-pinned model disables its select', lockedSelects[2].props.disabled === true, String(lockedSelects[2].props.disabled));
const lockedProxy = findAll(tree, isInput).find((i) => String(i.props.placeholder ?? '').includes('7890'));
check('a config-pinned proxy disables its input', lockedProxy && lockedProxy.props.disabled === true, String(lockedProxy && lockedProxy.props.disabled));
check('the locked proxy is echoed back masked', lockedProxy && lockedProxy.props.value === 'http://user:***@127.0.0.1:7890', String(lockedProxy && lockedProxy.props.value));
check('the hint explains the locked provider', findAll(tree, (n) => n.type === 'p' && String(n.children?.[0] ?? '').includes('provider）固定'))[0] !== undefined);
check('the hint explains the locked proxy', findAll(tree, (n) => n.type === 'p' && String(n.children?.[0] ?? '').includes('proxy）固定'))[0] !== undefined);

// ---------------------------------------------------------------------------
// 5. 保存与测试带上的字段
// ---------------------------------------------------------------------------
const sent = [];
// 组件内部的 rpcCall 已把 { ok, value } 解包成 value，所以桩直接返回 value
const spyRpc = async (method, payload) => {
  sent.push({ method, payload });
  if (method === 'testConnection') {
    return { durationMs: 12, model: 'gemini-3.1-flash-image', via: '直连', actualSize: '512x512', savePath: '/tmp/x.png' };
  }
  return CONFIG;
};
tree = await renderLoaded(spyRpc);

const saveBtn = findAll(tree, (n) => n.type === 'button' && n.children?.[0] === '保存设置')[0];
check('renders the save button', saveBtn !== undefined);
const testBtn = findAll(tree, (n) => n.type === 'button' && n.children?.[0] === '测试连接')[0];
check('renders the test button', testBtn !== undefined);

/** 状态条文本（status.msg 直接作为 children 传入）。 */
const statusText = (t) => {
  const node = findAll(t, (n) => typeof n.props?.className === 'string' && n.props.className.startsWith('img-status'))[0];
  return String(node?.children?.[0] ?? '');
};

sent.length = 0;
await saveBtn.props.onClick();
check('save sends the source mode', sent.at(-1)?.method === 'saveConfig' && sent.at(-1).payload.source === 'provider', JSON.stringify(sent.at(-1)));
check('save sends the provider', sent.at(-1).payload.provider === 'ai-proxy');
check('save sends the model', sent.at(-1).payload.model === 'gemini-3.1-flash-image');
check('save sends the size', sent.at(-1).payload.size === '1024x1024');
check('save sends the quality', sent.at(-1).payload.quality === 'auto');
check('save sends the proxy', typeof sent.at(-1).payload.proxy === 'string');
check('save omits baseURL in provider mode', sent.at(-1).payload.baseURL === undefined, JSON.stringify(Object.keys(sent.at(-1).payload)));
tree = render(spyRpc);
check('save reports success status', statusText(tree).includes('设置已保存'), statusText(tree));

sent.length = 0;
await testBtn.props.onClick();
check('test uses the same payload shape', sent.at(-1)?.method === 'testConnection' && sent.at(-1).payload.provider === 'ai-proxy' && sent.at(-1).payload.size === '1024x1024', JSON.stringify(sent.at(-1)));
tree = render(spyRpc);
check('test reports success with the route', statusText(tree).includes('连接成功'), statusText(tree));
check('a successful test says it was direct', statusText(tree).includes('直连'), statusText(tree));

// 手动模式下的保存
const manualSent = [];
const manualRpc = async (method, payload) => {
  manualSent.push({ method, payload });
  return { ok: true, value: {} };
};
tree = await renderLoaded(manualRpc);
findAll(tree, isSelect)[0].props.onChange({ target: { value: 'manual' } });
tree = render(manualRpc);
const mInputs = findAll(tree, isInput);
const mBase = mInputs.find((i) => i.props.type === 'text' && String(i.props.placeholder ?? '').includes('v1'));
mBase.props.onChange({ target: { value: 'http://10.0.0.5:9000/v1' } });
tree = render(manualRpc);
manualSent.length = 0;
await findAll(tree, (n) => n.type === 'button' && n.children?.[0] === '保存设置')[0].props.onClick();
check('manual save includes the baseURL', manualSent.at(-1)?.payload.baseURL === 'http://10.0.0.5:9000/v1', JSON.stringify(manualSent.at(-1)?.payload));
check('manual save still sends the size and quality', manualSent.at(-1)?.payload.size === '1024x1024' && manualSent.at(-1)?.payload.quality === 'auto');

// 失败路径
const failRpc = async (method) => {
  if (method === 'getConfig') throw new Error('rpc down');
  if (method === 'saveConfig') throw new Error('保存失败：模型不存在');
  return {};
};
tree = render(failRpc);
await flush();
tree = render(failRpc);
const failBtn = findAll(tree, (n) => n.type === 'button' && n.children?.[0] === '保存设置')[0];
await failBtn.props.onClick();
tree = render(failRpc);
check('a failed save shows the error', statusText(tree).includes('保存失败'), statusText(tree));

// ---------------------------------------------------------------------------
// 6. 没有任何提供商时的降级
// ---------------------------------------------------------------------------
const EMPTY = {
  ...CONFIG,
  providers: [],
  availableProviders: [],
  availableModels: [],
  availableImageModels: [],
  model: '',
};
tree = await renderLoaded(async () => EMPTY);
const emptyProviderSelect = findAll(tree, isSelect)[1];
check('no providers still renders a select', emptyProviderSelect !== undefined);
check('no providers still offers a way to pick', optionValues(emptyProviderSelect).length >= 1, optionValues(emptyProviderSelect).join(','));
check('no providers explains what to do', findAll(tree, (n) => n.type === 'p' && String(n.children?.[0] ?? '').includes('未在 dsh 模型配置里找到提供商'))[0] !== undefined);
check('no providers still renders the size and quality dropdowns', findAll(tree, isSelect).length >= 4);

console.log('');
console.log(failures === 0 ? 'CLIENT OK' : 'CLIENT FAILED: ' + failures + ' check(s)');
process.exit(failures === 0 ? 0 : 1);
