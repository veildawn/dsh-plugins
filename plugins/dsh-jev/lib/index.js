/**
 * DSH 原生工具插件：将 TypeSafe Jev System One 决策模型作为原生工具暴露。
 *
 * Jev 属于决策类模型：接收应用上下文状态 (state) 与强类型问题 (questions)，
 * 返回附带校准置信度的强类型结构化结果，不生成自由文本对话，因此注册为 Tool 而非 LLM 聊天 Provider。
 *
 * 采用原生轻量设计：零外部 npm 依赖，通过 ctx.tools.register 挂载标准 JsonSchemaNode 工具定义。
 *
 * @module dsh-jev
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  DEFAULT_PROXY_HOSTS,
  formatProxyForDisplay,
  parseProxyUrl,
  proxyTargetsUrl,
  requestViaProxy,
} from './proxy.js';

/** Cordis 插件名称。 */
export const name = 'tool-jev';

/** 插件激活前所需注入的底层服务列表。保持 tools 硬依赖以符合 SPEC。 */
export const inject = ['tools'];

/**
 * 设置 RPC 通道常量。
 */
export const SETTINGS_RPC_CHANNEL = '/dsh-jev-settings';

function rpcFailure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

function rpcOk(value) {
  return { ok: true, value };
}

/**
 * 处理前端设置 RPC 调用
 */
async function handleSettingsRpc(ctx, resolved, method, payload) {
  // 遵循配置里的 keyFile：前端保存的密钥必须写到与读取时相同的位置。
  const userKeyPath = resolved.keyFile;

  if (method === 'getConfig') {
    const currentKey = await resolveApiKey(resolved);
    const proxy = await resolveProxy(resolved);
    const baseURL = await resolveBaseURL(resolved);
    return rpcOk({
      configured: Boolean(currentKey),
      apiKey: currentKey ? (currentKey.slice(0, 6) + '...' + currentKey.slice(-4)) : '',
      model: resolved.model,
      baseURL,
      baseURLDefault: DEFAULTS.baseURL,
      baseURLLocked: resolved.configBaseURL !== undefined,
      // 代理地址回显给前端；密码已掩码，绝不把明文凭据送回浏览器。
      proxy: proxy ? formatProxyForDisplay(proxy) : '',
      // 由 Profile 配置固定的代理不允许在界面修改，前端据此禁用输入框。
      proxyLocked: resolved.configProxy !== undefined,
    });
  }

  if (method === 'saveConfig') {
    try {
      if (typeof payload?.apiKey === 'string' && payload.apiKey.trim() && !payload.apiKey.includes('...')) {
        await mkdir(dirname(userKeyPath), { recursive: true });
        await writeFile(userKeyPath, payload.apiKey.trim(), 'utf8');
        resolved.apiKey = payload.apiKey.trim();
      }
      if (typeof payload?.model === 'string' && payload.model.trim()) {
        resolved.model = payload.model.trim();
      }
      // 接口服务地址：支持自定义为其它地址（如本地接口服务）。空字符串表示恢复官方默认地址。
      if (typeof payload?.baseURL === 'string') {
        if (resolved.configBaseURL !== undefined) {
          return rpcFailure(
            'base-url-locked',
            '接口地址已由插件配置（baseURL）固定，无法在界面修改：请修改 Profile 配置后重启',
          );
        }
        const trimmed = payload.baseURL.trim();
        if (trimmed === '') {
          await writeSettingsFile(resolved, { baseURL: '' });
          resolved.baseURL = DEFAULTS.baseURL;
        } else {
          const validated = endpoint(trimmed, 'baseURL');
          await writeSettingsFile(resolved, { baseURL: validated });
          resolved.baseURL = validated;
        }
      }
      // 代理地址：空字符串表示清除代理（恢复直连）。保存前先校验，避免写入坏值。
      if (typeof payload?.proxy === 'string') {
        if (resolved.configProxy !== undefined) {
          return rpcFailure(
            'proxy-locked',
            '代理地址已由插件配置（proxy）固定，无法在界面修改：请修改 Profile 配置后重启',
          );
        }
        const trimmed = payload.proxy.trim();
        if (trimmed === '') {
          await writeSettingsFile(resolved, { proxy: '' });
        } else {
          // 校验失败会抛出可读错误，由下方 catch 统一转为 RPC 失败。
          parseProxyUrl(trimmed, 'proxy');
          await writeSettingsFile(resolved, { proxy: trimmed });
        }
        resolved.proxy = undefined;
      }
      return rpcOk(true);
    } catch (err) {
      return rpcFailure('save-failed', err.message);
    }
  }

  if (method === 'testConnection') {
    try {
      let testKey = payload?.apiKey;
      // 如果前端传了包含掩码的 apiKey (如 "apikey...8f8e")，或者为空，则从本地配置或环境解析完整 key
      if (!testKey || testKey.includes('...')) {
        testKey = await resolveApiKey(resolved);
      }
      if (!testKey) {
        return rpcFailure('unconfigured', '未配置 API Key');
      }
      // 使用界面上尚未保存的代理地址与接口服务地址进行测试。
      const testProxy = await resolveTestProxy(payload, resolved);
      const testBaseURL = await resolveTestBaseURL(payload, resolved);
      const start = Date.now();
      const testRes = await httpRequest(
        resolveEndpointUrl(testBaseURL),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${testKey}`,
          },
          body: JSON.stringify({
            state: 'Ping check from DSH',
            model: payload?.model || resolved.model || 'jev-latest',
            questions: {
              ping: { type: 'noul', instructions: 'Is this a valid test ping?' },
            },
          }),
        },
        resolved,
        testProxy,
      );
      const testData = await testRes.json();
      const durationMs = Date.now() - start;
      if (testRes.ok) {
        return rpcOk({ durationMs, result: testData });
      }
      return rpcFailure(
        `http-${testRes.status}`,
        testData?.error?.message || testData?.detail?.message || `HTTP ${testRes.status}`,
        { status: testRes.status, body: testData }
      );
    } catch (err) {
      return rpcFailure('request-failed', err.message);
    }
  }

  return rpcFailure('unknown-method', '未知方法: ' + method);
}

/**
 * 官方支持的核心问题原语：choice | score | noul。
 * 兼容将 boolean 视为 yes/no 原语，在构建网络请求前自动规范化为 noul。
 */
const QUESTION_TYPES = new Set(['choice', 'score', 'noul']);

const DEFAULTS = {
  transport: 'typesafe',
  baseURL: 'https://api.typesafe.ai',
  model: 'jev-latest',
  apiKey: undefined,
  apiKeyEnv: 'TYPESAFE_API_KEY',
  keyFile: join(homedir(), '.config', 'typesafe', 'key'),
  timeoutMs: 60000,
  // toolTimeoutMs 根据 timeoutMs 与 retries 动态计算，确保覆盖所有重试轮次
  retries: 0,
  maxStateBytes: 262144,
  maxQuestions: 64,
  // 代理：为空表示不使用代理（直连）；非空时，命中 proxyHosts 的请求全部经代理转发。
  proxy: undefined,
  proxyHosts: DEFAULT_PROXY_HOSTS,
  /** 代理设置持久化文件（供前端保存，避免把代理密码写进 Profile 配置）。 */
  settingsFile: join(homedir(), '.config', 'typesafe', 'settings.json'),
};

/**
 * 解析正有限数值配置项。
 * @param value - 候选配置值。
 * @param fallback - 缺省默认值。
 * @param label - 诊断报错字段标识。
 * @returns 解析后的正数。
 */
function positiveNumber(value, fallback, label) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('tool-jev: ' + label + ' must be a positive finite number');
  }
  return value;
}

/**
 * 解析非负整数配置项（0 表示不进行重试）。
 * @param value - 候选配置值。
 * @param fallback - 缺省默认值。
 * @param label - 诊断报错字段标识。
 * @returns 解析后的非负整数。
 */
function nonNegativeInteger(value, fallback, label) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('tool-jev: ' + label + ' must be a non-negative integer');
  }
  return value;
}

/**
 * 校验并清理 http(s) 服务端点 URL（去除尾部斜杠）。
 * @param value - 候选 URL。
 * @param label - 诊断报错字段标识。
 * @returns 规范化后的 URL。
 */
function endpoint(value, label) {
  let url = String(value).trim().replace(/[/]+$/, '');
  // 省略协议时智能补全 http://
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    url = 'http://' + url;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('tool-jev: ' + label + ' is not a valid URL: ' + value);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('tool-jev: ' + label + ' must be http(s), got ' + parsed.protocol);
  }
  return url;
}

/**
 * 将接口服务基地址规整为完整的 System One 请求端点 URL。
 * 兼容处理尾部 /v1、/v1/systemone 等多余后缀，避免拼接出 /v1/v1/systemone。
 *
 * @param baseURL - 接口服务基地址。
 * @returns 完整的请求端点 URL。
 */
function resolveEndpointUrl(baseURL) {
  const url = String(baseURL).trim().replace(/[/]+$/, '');
  if (url.endsWith('/v1/systemone')) {
    return url;
  }
  if (url.endsWith('/v1')) {
    return url + '/systemone';
  }
  return url + '/v1/systemone';
}

/**
 * 校验可选的 policySection 配置（用于向大模型注入常驻 Jev 决策策略切面）。
 * @param raw - 原始配置值。
 * @returns 解析后的 { enabled, order } 配置。
 */
function normalizePolicySection(raw) {
  if (raw === undefined || raw === null) return { enabled: true, order: undefined };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('tool-jev: policySection must be an object with optional enabled and order fields');
  }
  const enabled = raw.enabled === undefined ? true : raw.enabled;
  if (typeof enabled !== 'boolean') {
    throw new Error('tool-jev: policySection.enabled must be a boolean');
  }
  let order;
  if (raw.order !== undefined && raw.order !== null) {
    if (typeof raw.order !== 'number' || !Number.isFinite(raw.order)) {
      throw new Error('tool-jev: policySection.order must be a finite number');
    }
    order = raw.order;
  }
  return { enabled, order };
}

/**
 * 规范化代理主机模式列表。
 *
 * 支持数组或逗号分隔字符串；'*' 表示匹配全部主机。解析结果为空时回退到默认的
 * typesafe.ai，避免出现"配置了代理却谁都不走代理"的静默失效状态。
 *
 * @param raw - 原始配置值。
 * @returns 规范化后的主机模式数组。
 */
function normalizeProxyHosts(raw) {
  if (raw === undefined || raw === null) return [...DEFAULT_PROXY_HOSTS];
  const list = (Array.isArray(raw) ? raw : String(raw).split(','))
    .map((item) => String(item).trim().toLowerCase())
    .filter((item) => item !== '');
  return list.length === 0 ? [...DEFAULT_PROXY_HOSTS] : list;
}

/**
 * 规范化插件配置：填充默认值、校验传输协议与 URL，自动清理路径尾部斜杠。
 * @param config - 原始传入配置。
 * @returns 规范化后的完整配置对象。
 */
function normalizeConfig(config) {
  const raw = config === undefined || config === null ? {} : config;
  const transport = String(raw.transport === undefined ? DEFAULTS.transport : raw.transport);
  if (transport !== 'typesafe') {
    throw new Error(
      'tool-jev: transport must be "typesafe": the Vercel AI Gateway transport was removed,' +
        ' so only transport "typesafe" (the official TypeSafe API) is supported (got "' + transport + '")',
    );
  }
  const timeoutMs = positiveNumber(raw.timeoutMs, DEFAULTS.timeoutMs, 'timeoutMs');
  const retries = nonNegativeInteger(raw.retries, DEFAULTS.retries, 'retries');
  const apiKey = raw.apiKey === undefined || raw.apiKey === null ? undefined : String(raw.apiKey).trim();
  // 配置里显式给出的代理优先于前端保存的代理；为空表示直连。
  const configProxy = parseProxyUrl(raw.proxy, 'proxy');
  // 配置里显式给出的接口地址优先于前端保存的地址；未指定时为 undefined（允许界面自定义与环境变量覆盖）。
  const configBaseURL =
    raw.baseURL !== undefined && raw.baseURL !== null
      ? endpoint(raw.baseURL, 'baseURL')
      : undefined;
  return {
    transport,
    baseURL: configBaseURL ?? DEFAULTS.baseURL,
    /** 由插件配置固定下来的接口服务地址（undefined 表示允许前端覆盖）。 */
    configBaseURL,
    model: String(raw.model === undefined ? DEFAULTS.model : raw.model),
    apiKey: apiKey === '' ? undefined : apiKey,
    apiKeyEnv: String(raw.apiKeyEnv === undefined ? DEFAULTS.apiKeyEnv : raw.apiKeyEnv),
    keyFile: String(raw.keyFile === undefined ? DEFAULTS.keyFile : raw.keyFile),
    timeoutMs,
    retries,
    toolTimeoutMs:
      raw.toolTimeoutMs === undefined
        ? positiveNumber(undefined, timeoutMs * (retries + 1) + 5000, 'toolTimeoutMs')
        : positiveNumber(raw.toolTimeoutMs, timeoutMs * (retries + 1) + 5000, 'toolTimeoutMs'),
    maxStateBytes: positiveNumber(raw.maxStateBytes, DEFAULTS.maxStateBytes, 'maxStateBytes'),
    maxQuestions: positiveNumber(raw.maxQuestions, DEFAULTS.maxQuestions, 'maxQuestions'),
    policySection: normalizePolicySection(raw.policySection),
    proxyHosts: normalizeProxyHosts(raw.proxyHosts),
    /** 由插件配置固定下来的代理（undefined 表示允许前端覆盖）。 */
    configProxy,
    /** 当前生效的代理描述对象，undefined 表示直连。 */
    proxy: configProxy,
    settingsFile: String(raw.settingsFile === undefined ? DEFAULTS.settingsFile : raw.settingsFile),
  };
}

/**
 * 读取本地密钥文件内容（自动忽略不存在或空文件）。
 * @param path - 密钥文件路径。
 * @returns 读取到的密钥字符串，或 undefined。
 */
async function readKeyFile(path) {
  try {
    const key = (await readFile(path, 'utf8')).trim();
    return key === '' ? undefined : key;
  } catch {
    return undefined;
  }
}

/**
 * 获取用于查询 API Key 的环境变量名称列表（按优先级去重排序）。
 * @param config - 规范化配置。
 * @returns 环境变量名数组。
 */
function keyEnvNames(config) {
  return Array.from(new Set([config.apiKeyEnv, 'JEV_API_KEY']));
}

/**
 * 读取前端保存的设置文件（代理地址等）。
 *
 * 文件缺失、为空或 JSON 损坏时一律返回空对象：设置文件只是便利层，
 * 任何读取问题都不应让插件加载失败。
 *
 * @param config - 规范化配置。
 * @returns 解析后的设置对象。
 */
async function readSettingsFile(config) {
  try {
    const text = await readFile(config.settingsFile, 'utf8');
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/**
 * 将前端设置写入设置文件（合并写入，保留其它字段）。
 * @param config - 规范化配置。
 * @param patch - 需要写入的字段。
 */
async function writeSettingsFile(config, patch) {
  const current = await readSettingsFile(config);
  const next = { ...current, ...patch };
  await mkdir(dirname(config.settingsFile), { recursive: true });
  await writeFile(config.settingsFile, JSON.stringify(next, null, 2) + '\n', 'utf8');
}

/**
 * 解析当前生效的代理配置。
 *
 * 优先级：插件配置里的 proxy > 前端保存的 proxy > 无代理（直连）。
 * 插件配置优先是为了让 Profile 里写死的代理不会被界面误改。
 *
 * @param config - 规范化配置。
 * @returns 生效的代理描述对象，或 undefined 表示直连。
 */
async function resolveProxy(config) {
  if (config.configProxy !== undefined) return config.configProxy;
  const settings = await readSettingsFile(config);
  if (typeof settings.proxy !== 'string' || settings.proxy.trim() === '') return undefined;
  try {
    return parseProxyUrl(settings.proxy, 'proxy');
  } catch {
    // 保存时已校验过；此处兜底，避免手工编辑设置文件写坏后整个工具不可用。
    return undefined;
  }
}

/**
 * 统一的 HTTP 请求入口：命中代理规则时经代理转发，否则直连。
 *
 * 代理地址为空（或目标主机不在代理范围内）时走原生 fetch，行为与升级前完全一致。
 *
 * @param targetUrl - 目标请求地址。
 * @param init - 请求初始化参数。
 * @param config - 规范化配置。
 * @param proxy - 已解析的代理；省略（undefined）时按配置解析，显式传 null 表示强制直连。
 * @returns fetch 兼容的响应对象。
 */
async function httpRequest(targetUrl, init, config, proxy) {
  const active = proxy === undefined ? await resolveProxy(config) : proxy;
  if (active === undefined || active === null || !proxyTargetsUrl(targetUrl, config.proxyHosts)) {
    return fetch(targetUrl, init);
  }
  return requestViaProxy(targetUrl, init, active);
}

/**
 * 解析前端传来的代理测试值（用于 testConnection）。
 *
 * 三种语义必须区分清楚：
 *   - 字段缺省：沿用已保存的代理；
 *   - 空字符串：用户清空了输入框，按"直连"测试（返回 null）；
 *   - 含 *** 的掩码值：是 getConfig 回显的展示值，不能当作真实地址，沿用已保存的代理。
 *
 * @param payload - 前端请求载荷。
 * @param config - 规范化配置。
 * @returns 代理描述对象、null（直连）或 undefined（沿用已保存值）。
 */
async function resolveTestProxy(payload, config) {
  // 配置固定的代理不可被界面绕过，否则"测试连接"会与实际调用行为不一致。
  if (config.configProxy !== undefined) return config.configProxy;
  if (typeof payload?.proxy !== 'string') return resolveProxy(config);
  const candidate = payload.proxy.trim();
  if (candidate === '') return null;
  if (candidate.includes('***')) return resolveProxy(config);
  return parseProxyUrl(candidate, 'proxy');
}

/**
 * 解析当前生效的接口服务地址 (baseURL)。
 *
 * 优先级：插件配置固定地址 (configBaseURL) > 环境变量 ($TYPESAFE_BASE_URL / $JEV_BASE_URL) > 前端保存的 baseURL > 官方默认地址。
 *
 * @param config - 规范化配置。
 * @returns 规范化后的接口服务地址 URL。
 */
async function resolveBaseURL(config) {
  if (config.configBaseURL !== undefined) return config.configBaseURL;
  for (const name of ['TYPESAFE_BASE_URL', 'JEV_BASE_URL']) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim() !== '') {
      try {
        return endpoint(value.trim(), name);
      } catch {
        // 环境变量格式非法时忽略并继续兜底
      }
    }
  }
  const settings = await readSettingsFile(config);
  if (typeof settings.baseURL === 'string' && settings.baseURL.trim() !== '') {
    try {
      return endpoint(settings.baseURL.trim(), 'baseURL');
    } catch {
      // 容错兜底：若设置文件损坏则回退
    }
  }
  return DEFAULTS.baseURL;
}

/**
 * 解析前端传来的接口地址测试值（用于 testConnection）。
 *
 * 语义：
 *   - 字段缺省（undefined）：沿用已保存或默认生效的接口地址；
 *   - 空字符串：用户清空了输入框，回退到官方默认地址测试；
 *   - 非空字符串：校验并使用该候选地址进行测试。
 *
 * @param payload - 前端请求载荷。
 * @param config - 规范化配置。
 * @returns 接口地址 URL。
 */
async function resolveTestBaseURL(payload, config) {
  // 配置固定的接口地址不可被界面绕过
  if (config.configBaseURL !== undefined) return config.configBaseURL;
  if (typeof payload?.baseURL !== 'string') return resolveBaseURL(config);
  const candidate = payload.baseURL.trim();
  if (candidate === '') return DEFAULTS.baseURL;
  return endpoint(candidate, 'baseURL');
}

/**
 * 多级安全解析 API Key（避免密钥传入模型上下文造成泄露）：
 * 1. 插件显式配置项 (apiKey)
 * 2. 指定的环境变量名，随后检查 JEV_API_KEY
 * 3. 配置文件 (~/.config/typesafe/key)
 * 4. 本地 ~/.dsh/tools/jev/.env 自动探测兜底
 *
 * @param config - 规范化配置。
 * @returns 解析得到的密钥或 undefined。
 */
async function resolveApiKey(config) {
  if (config.apiKey) return config.apiKey;

  for (const name of keyEnvNames(config)) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }

  const fileKey = await readKeyFile(config.keyFile);
  if (fileKey) return fileKey;

  // If using default keyFile location and not found, check ~/.dsh/tools/jev/.env
  if (config.keyFile === DEFAULTS.keyFile) {
    const fallbackEnv = join(homedir(), '.dsh', 'tools', 'jev', '.env');
    try {
      const content = await readFile(fallbackEnv, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.search(/[:=]/);
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          if (key === config.apiKeyEnv || key === 'TYPESAFE_API_KEY' || key === 'JEV_API_KEY') {
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^["'](.*)["']$/, '$1');
            if (val) return val;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return undefined;
}

/**
 * 构建缺少 API Key 时的统一诊断提示信息。
 * @param config - 规范化配置。
 * @returns 错误提示文本。
 */
function missingKeyMessage(config) {
  const names = keyEnvNames(config)
    .map((name) => '$' + name)
    .join(' or ');
  return 'tool-jev: no API key. Set ' + names + ', or write the key to ' + config.keyFile + '.';
}

/**
 * 描述被拒绝参数的类型概貌（避免在报错中回显冗长原始载荷）。
 * @param value - 被校验的值。
 * @returns 简短的类型描述字符串。
 */
function describeShape(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length === 0 ? 'an empty array' : 'an array';
  const type = typeof value;
  if (type === 'object') return Object.keys(value).length === 0 ? 'an empty object' : 'an object';
  if (type === 'string') return 'a string';
  return 'a ' + type;
}

/**
 * 校验模型传入的 questions 映射表，并将其规范化为 TypeSafe 协议标准格式。
 * @param questions - 模型输入的原始 questions。
 * @param config - 规范化配置。
 * @returns 校验合格并规范化后的 questions 结构体。
 */
function assertQuestions(questions, config) {
  if (questions === null || typeof questions !== 'object' || Array.isArray(questions)) {
    throw new Error('tool-jev: questions must be an object mapping a key to { type, instructions, criteria? }');
  }
  const allowed = QUESTION_TYPES;
  const keys = Object.keys(questions);
  if (keys.length === 0) throw new Error('tool-jev: questions must declare at least one question');
  if (keys.length > config.maxQuestions) {
    throw new Error('tool-jev: at most ' + config.maxQuestions + ' questions per call (got ' + keys.length + ')');
  }
  const wire = {};
  for (const key of keys) {
    const spec = questions[key];
    if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new Error('tool-jev: questions.' + key + ' must be an object');
    }
    let type = spec.type;
    if (type === 'boolean') type = 'noul';
    if (!allowed.has(type)) {
      throw new Error('tool-jev: questions.' + key + '.type must be one of choice | score | noul');
    }
    if (
      spec.instructions === undefined ||
      spec.instructions === null ||
      (typeof spec.instructions === 'string' && spec.instructions.trim() === '') ||
      (typeof spec.instructions !== 'string' && typeof spec.instructions !== 'object')
    ) {
      throw new Error('tool-jev: questions.' + key + '.instructions must be a non-empty string, object, or array');
    }
    if (type !== 'noul') {
      if (spec.criteria === undefined) {
        throw new Error('tool-jev: questions.' + key + '.criteria is required for a ' + type + ' question');
      }
      if (type === 'choice') {
        const isObject =
          spec.criteria !== null && typeof spec.criteria === 'object' && !Array.isArray(spec.criteria);
        if (!isObject || Object.keys(spec.criteria).length === 0) {
          throw new Error(
            'tool-jev: questions.' +
              key +
              '.criteria must be a non-empty object mapping option_key to meaning for a choice question (got ' +
              describeShape(spec.criteria) +
              ')',
          );
        }
      } else if (!Array.isArray(spec.criteria) || spec.criteria.length === 0) {
        throw new Error(
          'tool-jev: questions.' +
            key +
            '.criteria must be a non-empty array of level meanings for a score question (got ' +
            describeShape(spec.criteria) +
            ')',
        );
      }
    }
    const normalized = { type, instructions: spec.instructions };
    if (spec.criteria !== undefined) normalized.criteria = spec.criteria;
    wire[key] = normalized;
  }
  return wire;
}

/**
 * 构建发送给 TypeSafe 官方 API 的标准 HTTP 请求载荷。
 * @param args - 模型传入参数。
 * @param questions - 规范化后的 questions。
 * @param config - 插件配置。
 * @returns 请求 URL、请求头与载荷。
 */
function buildRequest(args, questions, config, baseURL) {
  const model = typeof args.model === 'string' && args.model.trim() !== '' ? args.model.trim() : config.model;
  const base = baseURL || config.baseURL || DEFAULTS.baseURL;
  return {
    url: resolveEndpointUrl(base),
    headers: { 'content-type': 'application/json' },
    body: { state: args.state, questions, model },
    model,
  };
}

/**
 * 检查宿主 Harness 是否已主动取消执行（避免取消后重试并防止误报为超时）。
 * @param exec - 工具运行上下文。
 * @returns 是否已被调用方中止。
 */
function isCallerAborted(exec) {
  return exec?.signal?.aborted === true;
}

/**
 * 构建调用方取消异常对象（名称固定为 AbortError 以便宿主捕获处理）。
 * @returns 异常实例。
 */
function callerAbortError() {
  const error = new Error('tool-jev: call aborted by the caller');
  error.name = 'AbortError';
  return error;
}

/** 延迟等待函数（用于指数退避重试）。 @param ms - 等待毫秒数。 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 为 429（限流/配额超限）响应追加明确的用户指引提示。
 * @param status - HTTP 响应状态码。
 * @returns 提示建议文本。
 */
function rateLimitHint(status) {
  if (status !== 429) return '';
  return (
    ' The provider is rate-limiting this key (HTTP 429): wait a moment and retry.' +
    ' If it keeps failing, the key is over its quota and needs a higher limit.'
  );
}

/**
 * 执行单次 HTTP 请求探测（独立管理超时期，防止前次超时信号污染重试轮次）。
 * @param request - 请求地址与基础属性。
 * @param headers - 认证与协议头。
 * @param body - 序列化载荷。
 * @param exec - 宿主运行上下文。
 * @param config - 插件配置。
 * @returns API 返回数据。
 */
async function attemptRequest(request, headers, body, exec, config, proxy) {
  const signals = [AbortSignal.timeout(config.timeoutMs)];
  if (exec !== undefined && exec !== null && exec.signal) signals.push(exec.signal);

  let response;
  try {
    response = await httpRequest(
      request.url,
      {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.any(signals),
      },
      config,
      proxy,
    );
  } catch (error) {
    if (isCallerAborted(exec)) throw callerAbortError();
    const errorName = error instanceof Error ? error.name : '';
    if (errorName === 'TimeoutError' || errorName === 'AbortError') {
      const timeout = new Error('tool-jev: request to ' + request.url + ' timed out after ' + config.timeoutMs + ' ms');
      timeout.retryable = true;
      throw timeout;
    }
    const message = error instanceof Error ? error.message : String(error);
    const network = new Error('tool-jev: request to ' + request.url + ' failed: ' + message);
    network.retryable = true;
    throw network;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const httpError = new Error(
      'tool-jev: ' +
        request.model +
        ' returned HTTP ' +
        response.status +
        (detail ? ': ' + detail.slice(0, 500) : '') +
        rateLimitHint(response.status),
    );
    httpError.retryable = response.status >= 500;
    throw httpError;
  }

  const data = await response.json();
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(
      'tool-jev: the endpoint response must be an object with an "answers" property, got ' + describeShape(data),
    );
  }
  if (data.answers === null || typeof data.answers !== 'object' || Array.isArray(data.answers)) {
    throw new Error(
      'tool-jev: the endpoint response is missing the required "answers" object (answers must be an object)',
    );
  }
  return data;
}

/**
 * 发送 System One 决策请求（支持网络波动/5xx 自动指数退避重试，4xx 与中止不重试）。
 * @param args - 工具入参。
 * @param exec - 运行上下文。
 * @param config - 插件配置。
 * @returns 决策结果。
 */
async function requestSystemOne(args, exec, config) {
  const state = args.state;
  if (typeof state !== 'string' || state.trim() === '') {
    throw new Error('tool-jev: state must be a non-empty string');
  }
  const stateBytes = Buffer.byteLength(state, 'utf8');
  if (stateBytes > config.maxStateBytes) {
    throw new Error('tool-jev: state is ' + stateBytes + ' bytes, over maxStateBytes ' + config.maxStateBytes);
  }
  const questions = assertQuestions(args.questions, config);

  const apiKey = await resolveApiKey(config);
  if (apiKey === undefined) throw new Error(missingKeyMessage(config));

  const baseURL = await resolveBaseURL(config);
  const request = buildRequest(args, questions, config, baseURL);
  const headers = { ...request.headers, authorization: 'Bearer ' + apiKey };
  const body = JSON.stringify(request.body);

  // 代理只在一次工具调用开始时解析一次：重试轮次之间保持一致，
  // 也避免每轮都去读设置文件。
  const proxy = await resolveProxy(config);

  if (isCallerAborted(exec)) throw callerAbortError();

  const attempts = config.retries + 1;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await sleep(500 * (attempt - 1));
    if (isCallerAborted(exec)) throw callerAbortError();
    try {
      return await attemptRequest(request, headers, body, exec, config, proxy);
    } catch (error) {
      if (isCallerAborted(exec)) throw callerAbortError();
      lastError = error;
      const retryable = error instanceof Error && error.retryable === true;
      if (!retryable || attempt >= attempts) break;
    }
  }
  throw lastError;
}

/**
 * 共享的 Jev 决策策略提示词片段词汇表（供模型可见的 Tool Description 与常驻提示词切面共用）。
 */
const POLICY = {
  purpose: 'Ask TypeSafe Jev, a System One decision model, for typed judgments about arbitrary state.',
  whenToUse: 'When to use: call jev_decide whenever the answer is a judgment, not a lookup.',
  defaultRule:
    'Default: ask Jev before turning a judgment about meaning, intent, relevance, fit, or risk into a conclusion.',
  exemptions:
    "Exempt only when the answer is fixed by an explicit instruction, a mechanical check, readable file or command output, or the caller's own decision.",
  moments:
    'Decision moments: comparing alternatives or win-rate; trade-offs; two self-consistent options; meaning, intent, or relevance; classifying or routing; rubric scoring; calibrated yes/no; ambiguous state; irreversible next step.',
  budget: 'Budget: one call carries one state plus every question about it; keep criteria concrete.',
  grammar:
    'Question grammar: choice needs { type: "choice", instructions: "...", criteria: { "option_key": "meaning" } };',
  scoreGrammar:
    'score needs { type: "score", instructions: "...", criteria: ["level 0 meaning", "level 1 meaning"] };',
  noulGrammar:
    'the yes/no primitive is { type: "noul", instructions: "yes/no question" }, with { type: "boolean" } as an accepted alias normalized to noul on the wire.',
  replies: [
    'Replies: choice gives answers[key].choice plus probabilities and a calibrated confidence;',
    'score gives answers[key].score plus a legend or probabilities and a calibrated confidence;',
    'the yes/no primitive is noul, so read answers[key].noul, the probability that the answer is yes.',
    'Question keys are yours to choose, and choice/score criteria accept nested JSON structure.',
  ].join(' '),
};

/**
 * 组合决策策略核心规则块文本。
 * @returns 策略规则文本。
 */
function policyBlock() {
  return [POLICY.whenToUse, POLICY.defaultRule, POLICY.exemptions, POLICY.moments, POLICY.budget].join(' ');
}

/**
 * 常驻提示词切面文本内容（Surface B：向模型注入 Jev 决策规范指南）。
 * @returns 完整的切面说明文本。
 */
function policySectionText() {
  return [
    '## Jev decision policy',
    'Use jev_decide for typed judgments: it returns a typed answer plus a calibrated confidence, never prose.',
    policyBlock(),
    'In PTC mode call jev_decide from inside a run_code program, not as a top-level tool call.',
  ].join('\n\n');
}

/**
 * 面向大模型的工具描述文本（Surface A：jev_decide 的功能与语法规范）。
 * @returns 工具描述文本。
 */
function describeTool() {
  return [
    POLICY.purpose,
    policyBlock(),
    POLICY.grammar,
    POLICY.scoreGrammar,
    POLICY.noulGrammar,
    POLICY.replies,
  ].join(' ');
}

/**
 * 构造工具输入参数的标准 JSON Schema。
 * @returns 约束架构对象。
 */
function parametersFor() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['state', 'questions'],
    properties: {
      state: {
        type: 'string',
        description: 'The state to judge: raw text, JSON, a log excerpt, a support ticket, a diff, and so on.',
      },
      questions: {
        type: 'object',
        description:
          'Map of question key to { type: "choice" | "score" | "noul" | "boolean", instructions: string, criteria?: object | array }.' +
          ' criteria is required for choice (a non-empty object of option_key -> meaning) and for score (a non-empty array of level meanings).' +
          ' choice answers carry .choice plus probabilities and a confidence; score answers carry .score plus a legend or probabilities' +
          ' and a confidence; for yes/no, read answers[key].noul, the probability that the answer is yes.',
      },
      model: {
        type: 'string',
        description: 'Optional model id; defaults to the plugin-configured model (jev-latest).',
      },
    },
  };
}

/**
 * 记录非致命性诊断日志（切面注册异常不阻断主插件加载）。
 * @param ctx - 上下文对象。
 * @param message - 日志消息。
 */
function noteDiagnostic(ctx, message) {
  try {
    if (typeof ctx?.logger?.warn === 'function') ctx.logger.warn(message);
  } catch {
    // Diagnostics never break registration.
  }
}

/**
 * 解析提示词切面在系统提示词中的默认排序位置。
 * @param prompt - systemPrompt 服务。
 * @param ctx - 上下文对象。
 * @returns 排序序号。
 */
function defaultSectionOrder(prompt, ctx) {
  try {
    const base = prompt.getSectionOrder('MCP_SERVERS');
    if (typeof base === 'number' && Number.isFinite(base)) return base + 10;
    noteDiagnostic(
      ctx,
      'tool-jev: systemPrompt.getSectionOrder("MCP_SERVERS") returned a non-finite value; using fallback order 3110',
    );
  } catch {
    noteDiagnostic(ctx, 'tool-jev: systemPrompt.getSectionOrder("MCP_SERVERS") failed; using fallback order 3110');
  }
  return 3110;
}

/**
 * 向系统提示词中注册常驻决策切面（Surface B），绑定资源销毁清理钩子。
 * @param ctx - 注册上下文。
 * @param resolved - 插件配置。
 */
function registerPolicySection(ctx, resolved) {
  if (typeof ctx?.inject !== 'function') return;
  try {
    const dispose = ctx.inject(['systemPrompt'], (inner) => {
      const prompt = inner?.systemPrompt ?? ctx.systemPrompt;
      if (prompt === undefined || prompt === null || typeof prompt.section !== 'function') return;
      const unregister = prompt.section({
        name: 'jev-decision-policy',
        interpolate: false,
        order:
          resolved.policySection.order === undefined
            ? defaultSectionOrder(prompt, ctx)
            : resolved.policySection.order,
        text: policySectionText(),
      });
      if (typeof unregister === 'function') {
        inner.on?.('dispose', unregister);
      }
    });
    if (typeof dispose === 'function') {
      ctx.on?.('dispose', dispose);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    noteDiagnostic(ctx, 'tool-jev: policy section registration failed: ' + message);
  }
}

/**
 * 挂载 Web 端设置路由接口（用于支持前端界面输入 API Key）
 */
function setupWebRoutes(ctx, resolved) {
  if (typeof ctx?.inject !== 'function') return;
  ctx.inject(['webServer'], (webServerCtx) => {
    const ws = webServerCtx?.webServer;
    if (!ws || typeof ws.get !== 'function') return;

    // 与 RPC 路径保持一致：保存位置必须与读取位置相同（遵循 keyFile 配置）。
    const userKeyPath = resolved.keyFile;

    ws.get('/api/dsh-jev/config', async (_req, res) => {
      const currentKey = await resolveApiKey(resolved);
      const proxy = await resolveProxy(resolved);
      const baseURL = await resolveBaseURL(resolved);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        configured: Boolean(currentKey),
        apiKey: currentKey ? (currentKey.slice(0, 6) + '...' + currentKey.slice(-4)) : '',
        model: resolved.model,
        baseURL,
        baseURLDefault: DEFAULTS.baseURL,
        baseURLLocked: resolved.configBaseURL !== undefined,
        proxy: proxy ? formatProxyForDisplay(proxy) : '',
        proxyLocked: resolved.configProxy !== undefined,
      }));
    });

    ws.post('/api/dsh-jev/config', async (req, res) => {
      let bodyStr = '';
      req.on('data', (chunk) => { bodyStr += chunk; });
      req.on('end', async () => {
        try {
          const body = JSON.parse(bodyStr || '{}');
          if (typeof body.apiKey === 'string' && body.apiKey.trim() && !body.apiKey.includes('...')) {
            await mkdir(dirname(userKeyPath), { recursive: true });
            await writeFile(userKeyPath, body.apiKey.trim(), 'utf8');
            resolved.apiKey = body.apiKey.trim();
          }
          if (typeof body.model === 'string' && body.model.trim()) {
            resolved.model = body.model.trim();
          }
          if (typeof body.baseURL === 'string') {
            if (resolved.configBaseURL !== undefined) {
              res.statusCode = 409;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                ok: false,
                error: '接口地址已由插件配置（baseURL）固定，无法在界面修改',
              }));
              return;
            }
            const trimmed = body.baseURL.trim();
            if (trimmed === '') {
              await writeSettingsFile(resolved, { baseURL: '' });
              resolved.baseURL = DEFAULTS.baseURL;
            } else {
              const validated = endpoint(trimmed, 'baseURL');
              await writeSettingsFile(resolved, { baseURL: validated });
              resolved.baseURL = validated;
            }
          }
          if (typeof body.proxy === 'string') {
            if (resolved.configProxy !== undefined) {
              res.statusCode = 409;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                ok: false,
                error: '代理地址已由插件配置（proxy）固定，无法在界面修改',
              }));
              return;
            }
            const trimmed = body.proxy.trim();
            if (trimmed === '') {
              await writeSettingsFile(resolved, { proxy: '' });
            } else {
              parseProxyUrl(trimmed, 'proxy');
              await writeSettingsFile(resolved, { proxy: trimmed });
            }
            resolved.proxy = undefined;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
    });

    ws.post('/api/dsh-jev/test', async (req, res) => {
      let bodyStr = '';
      req.on('data', (chunk) => { bodyStr += chunk; });
      req.on('end', async () => {
        try {
          const body = JSON.parse(bodyStr || '{}');
          const testKey = body.apiKey || (await resolveApiKey(resolved));
          if (!testKey) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: '未配置 API Key' }));
            return;
          }
          const testProxy = await resolveTestProxy(body, resolved);
          const testBaseURL = await resolveTestBaseURL(body, resolved);
          const start = Date.now();
          const testRes = await httpRequest(
            resolveEndpointUrl(testBaseURL),
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${testKey}`,
              },
              body: JSON.stringify({
                state: 'Ping check from DSH',
                model: body.model || resolved.model || 'jev-latest',
                questions: {
                  ping: { type: 'noul', instructions: 'Is this a valid test ping?' },
                },
              }),
            },
            resolved,
            testProxy,
          );
          const testData = await testRes.json();
          const durationMs = Date.now() - start;
          if (testRes.ok) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, durationMs, result: testData }));
          } else {
            res.statusCode = testRes.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: testData?.error?.message || `HTTP ${testRes.status}` }));
          }
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
    });
  });
}

/**
 * Cordis 插件入口函数：注册 jev_decide 工具及可选决策策略切面。
 * @param ctx - Cordis 上下文对象。
 * @param config - 部署配置项。
 */
export function apply(ctx, config) {
  const resolved = normalizeConfig(config);
  ctx.tools.register({
    name: 'jev_decide',
    description: describeTool(),
    parameters: parametersFor(),
    timeoutMs: resolved.toolTimeoutMs,
    isConcurrencySafe: () => true,
    output: {
      schema: {
        type: 'object',
        required: ['answers'],
        properties: {
          answers: {
            type: 'object',
            description: 'Answers keyed by question key, one entry per requested question.',
          },
        },
        description: 'The provider response: answers keyed by question, plus usage when the provider reports it.',
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: (args, exec) => requestSystemOne(args, exec, resolved),
  });
  if (resolved.policySection.enabled) registerPolicySection(ctx, resolved);
  
  if (ctx.connection?.rpc?.handle) {
    ctx.connection.rpc.handle(
      SETTINGS_RPC_CHANNEL,
      (method, payload) => handleSettingsRpc(ctx, resolved, method, payload),
      { authority: 'trusted-host' },
    );
  }
}
