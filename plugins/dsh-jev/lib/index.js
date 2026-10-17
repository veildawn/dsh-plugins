/**
 * DSH 原生工具插件：把「决策模型」作为原生工具暴露。
 *
 * 决策模型（默认 TypeSafe Jev / System One）接收应用上下文状态 (state) 与强类型
 * 问题 (questions)，返回附带校准置信度的强类型结构化结果，不生成自由文本对话，
 * 因此注册为 Tool 而非 LLM 聊天 Provider。
 *
 * 接口来源有两种模式：
 *   - provider：直接使用 dsh 已经配置好的提供商（llm-pi-ai 的 providers 行）与模型，
 *     baseUrl / 请求头 / API Key 全部按 dsh 自己的配置解析，无需重复填写；
 *   - manual：手写 baseUrl + API Key + 模型 ID，默认仍是官方地址
 *     https://api.typesafe.ai，也可指向任意兼容决策协议的服务。
 *
 * 采用原生轻量设计：零外部 npm 依赖，通过 ctx.tools.register 挂载标准
 * JsonSchemaNode 工具定义。
 *
 * @module dsh-jev
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_PROXY_HOSTS,
  formatProxyForDisplay,
  parseProxyUrl,
  proxyTargetsUrl,
  requestViaProxy,
} from './proxy.js';
import {
  FALLBACK_KEY_ENVS,
  getDshSystemProviders,
  inferDefaultProvider,
  isDecisionModel,
  resolveToken,
} from './provider.js';
import {
  DEFAULT_SETTINGS_PATH,
  SOURCE_MODES,
  describeConfigSource,
  loadUserSettings,
  resolveSettingsPath,
  writeSettingsFile,
} from './settings.js';

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
 * 官方支持的核心问题原语：choice | score | noul。
 * 兼容将 boolean 视为 yes/no 原语，在构建网络请求前自动规范化为 noul。
 */
const QUESTION_TYPES = new Set(['choice', 'score', 'noul']);

/** 可选的接口服务端点列表：官方 /v1/systemone 与 兼容 OpenAI 的 /v1/decisions。 */
export const AVAILABLE_ENDPOINTS = ['/v1/systemone', '/v1/decisions'];

/**
 * 每种配置来源的默认端点。
 *
 * - manual 默认官方原生协议 /v1/systemone；
 * - provider 指向的是 dsh 已配置的 OpenAI 兼容网关，默认走 /v1/decisions。
 */
export const DEFAULT_ENDPOINTS = {
  manual: '/v1/systemone',
  provider: '/v1/decisions',
};

/** 兼容旧导出：手写配置的默认端点。 */
export const DEFAULT_ENDPOINT = DEFAULT_ENDPOINTS.manual;

const DEFAULTS = {
  source: 'manual',
  provider: '',
  transport: 'typesafe',
  baseURL: 'https://api.typesafe.ai',
  model: 'jev-latest',
  apiKey: undefined,
  apiKeyEnv: 'TYPESAFE_API_KEY',
  keyFile: join(homedir(), '.config', 'typesafe', 'key'),
  timeoutMs: 60000,
  // retries 为 0 表示不重试；toolTimeoutMs 根据 timeoutMs 与 retries 动态计算。
  retries: 0,
  maxStateBytes: 262144,
  maxQuestions: 64,
  // 代理：为空表示不使用代理（直连）；非空时，命中 proxyHosts 的请求全部经代理转发。
  proxy: undefined,
  proxyHosts: DEFAULT_PROXY_HOSTS,
  /** 代理等设置持久化文件（供前端保存，避免把凭据写进 Profile 配置）。 */
  settingsFile: DEFAULT_SETTINGS_PATH,
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
 * 校验并规范化接口服务端点路径。
 * 支持 /v1/systemone（官方默认）与 /v1/decisions（兼容 OpenAI）。
 *
 * @param value - 候选端点路径。
 * @param fallback - 缺省默认端点。
 * @returns 规范化后的端点字符串。
 */
function normalizeEndpoint(value, fallback = DEFAULT_ENDPOINTS.manual) {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim().toLowerCase();
  if (text === '' || text === 'default') return fallback;
  if (text === '/v1/systemone' || text === 'systemone') return '/v1/systemone';
  if (text === '/v1/decisions' || text === 'decisions') return '/v1/decisions';
  throw new Error('tool-jev: endpoint must be one of "/v1/systemone" or "/v1/decisions" (got "' + value + '")');
}

/**
 * 将基地址与端点合并为完整的请求端点 URL。
 * 兼容处理 base 尾部已有的 /v1、/v1/systemone 或 /v1/decisions 后缀，防止拼接错误。
 *
 * @param baseURL - 接口基地址。
 * @param endpointPath - 端点路径（默认 /v1/systemone）。
 * @returns 完整的请求端点 URL。
 */
function buildEndpointUrl(baseURL, endpointPath = DEFAULT_ENDPOINTS.manual) {
  let base = String(baseURL).trim().replace(/[/]+$/, '');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) {
    base = 'http://' + base;
  }
  base = base.replace(/\/v1\/(?:systemone|decisions)\/?$/i, '').replace(/\/v1\/?$/i, '');
  const ep = normalizeEndpoint(endpointPath);
  return base + ep;
}

/**
 * 校验可选的 policySection 配置（用于向大模型注入常驻决策策略切面）。
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
 * 规范化配置来源：provider（dsh 已配置的提供商）或 manual（手写 baseUrl）。
 * 兼容旧配置里的 transport: typesafe（等价于 manual）。
 *
 * @param value - 原始来源值。
 * @param fallback - 缺省来源。
 * @returns 'provider' 或 'manual'。
 */
function normalizeSource(value, fallback = DEFAULTS.source) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const text = String(value).trim().toLowerCase();
  if (text === 'provider' || text === 'dsh') return 'provider';
  if (text === 'manual' || text === 'custom' || text === 'typesafe') return 'manual';
  throw new Error('tool-jev: source must be "provider" or "manual" (got "' + value + '")');
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
    raw.baseURL !== undefined && raw.baseURL !== null && String(raw.baseURL).trim() !== ''
      ? endpoint(raw.baseURL, 'baseURL')
      : undefined;
  // 配置里显式给出的端点优先于前端保存的端点；未指定时为 undefined。
  const configEndpoint =
    raw.endpoint !== undefined && raw.endpoint !== null && String(raw.endpoint).trim() !== ''
      ? normalizeEndpoint(raw.endpoint)
      : undefined;
  const configProvider =
    raw.provider !== undefined && raw.provider !== null && String(raw.provider).trim() !== ''
      ? String(raw.provider).trim()
      : undefined;
  const modelExplicit =
    raw.model !== undefined && raw.model !== null && String(raw.model).trim() !== '';
  return {
    source: normalizeSource(raw.source, DEFAULTS.source),
    /** 由插件配置指定的提供商（undefined 表示未指定，允许界面选择）。 */
    configProvider,
    provider: configProvider ?? '',
    transport,
    baseURL: configBaseURL ?? DEFAULTS.baseURL,
    /** 由插件配置固定下来的接口服务地址（undefined 表示允许前端覆盖）。 */
    configBaseURL,
    configEndpoint,
    model: modelExplicit ? String(raw.model).trim() : DEFAULTS.model,
    /** 模型是否是 Profile 里显式写下的（provider 模式据此决定是否回退到提供商模型表）。 */
    modelExplicit,
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
    settingsFile: resolveSettingsPath(raw.settingsFile),
  };
}

/**
 * 读取本地密钥文件内容（自动忽略不存在或空文件）。
 * @param path - 密钥文件路径。
 * @returns 读取到的密钥字符串，或 undefined。
 */
function readKeyFile(path) {
  try {
    const key = readFileSync(path, 'utf8').trim();
    return key === '' ? undefined : key;
  } catch {
    return undefined;
  }
}

/**
 * 读取 legacy 位置 ~/.dsh/tools/jev/.env 中的密钥（历史兜底，保持向后兼容）。
 * @param config - 规范化配置。
 * @returns 密钥或 undefined。
 */
function readLegacyEnvFile(config) {
  const fallbackEnv = join(homedir(), '.dsh', 'tools', 'jev', '.env');
  try {
    const content = readFileSync(fallbackEnv, 'utf8');
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
    // 文件不存在是常态
  }
  return undefined;
}

/**
 * 获取用于查询 API Key 的环境变量名称列表（按优先级去重排序）。
 * @param config - 规范化配置。
 * @returns 环境变量名数组。
 */
function keyEnvNames(config) {
  return Array.from(new Set([config.apiKeyEnv, 'TYPESAFE_API_KEY', 'JEV_API_KEY'].filter(Boolean)));
}

/**
 * 解析当前生效的代理配置。
 *
 * 优先级：插件配置里的 proxy > 前端保存的 proxy > 无代理（直连）。
 * 插件配置优先是为了让 Profile 里写死的代理不会被界面误改。
 *
 * @param config - 规范化配置。
 * @param settings - 前端设置文件内容。
 * @returns 生效的代理描述对象，或 undefined 表示直连。
 */
function resolveProxy(config, settings) {
  if (config.configProxy !== undefined) return config.configProxy;
  if (!settings || typeof settings.proxy !== 'string' || settings.proxy.trim() === '') return undefined;
  try {
    return parseProxyUrl(settings.proxy, 'proxy');
  } catch {
    // 保存时已校验过；此处兜底，避免手工编辑设置文件写坏后整个工具不可用。
    return undefined;
  }
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
 * @param settings - 前端设置文件内容。
 * @returns 代理描述对象、null（直连）或 undefined（沿用已保存值）。
 */
function resolveTestProxy(payload, config, settings) {
  // 配置固定的代理不可被界面绕过，否则"测试连接"会与实际调用行为不一致。
  if (config.configProxy !== undefined) return config.configProxy;
  if (typeof payload?.proxy !== 'string') return resolveProxy(config, settings);
  const candidate = payload.proxy.trim();
  if (candidate === '') return null;
  if (candidate.includes('***')) return resolveProxy(config, settings);
  return parseProxyUrl(candidate, 'proxy');
}

/**
 * 解析 manual 模式下当前生效的接口服务地址 (baseURL)。
 *
 * 优先级：插件配置固定地址 (configBaseURL) > 环境变量 ($TYPESAFE_BASE_URL / $JEV_BASE_URL)
 * > 前端保存的 baseURL > 官方默认地址。
 *
 * @param config - 规范化配置。
 * @param settings - 前端设置文件内容。
 * @returns 规范化后的接口服务地址 URL。
 */
function resolveBaseURL(config, settings) {
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
  if (typeof settings?.baseURL === 'string' && settings.baseURL.trim() !== '') {
    try {
      return endpoint(settings.baseURL.trim(), 'baseURL');
    } catch {
      // 容错兜底：若设置文件损坏则回退
    }
  }
  return DEFAULTS.baseURL;
}

/**
 * 解析当前生效的接口服务端点 (endpoint)。
 *
 * 优先级：插件配置固定端点 > 显式候选（来自界面/工具参数）> 环境变量
 * > 前端保存的 endpoint > 按来源取默认值（manual → /v1/systemone，provider → /v1/decisions）。
 *
 * @param config - 规范化配置。
 * @param settings - 前端设置文件内容。
 * @param source - 当前配置来源。
 * @param candidate - 显式候选端点（可选）。
 * @returns 规范化后的端点字符串。
 */
function resolveEndpoint(config, settings, source, candidate) {
  if (config.configEndpoint !== undefined) return config.configEndpoint;
  if (typeof candidate === 'string') {
    const text = candidate.trim();
    return text === '' ? DEFAULT_ENDPOINTS[source] : normalizeEndpoint(text);
  }
  for (const name of ['TYPESAFE_ENDPOINT', 'JEV_ENDPOINT']) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim() !== '') {
      try {
        return normalizeEndpoint(value.trim());
      } catch {
        // 忽略非法环境变量
      }
    }
  }
  if (typeof settings?.endpoint === 'string' && settings.endpoint.trim() !== '') {
    try {
      return normalizeEndpoint(settings.endpoint.trim());
    } catch {
      // 容错兜底
    }
  }
  return DEFAULT_ENDPOINTS[source] ?? DEFAULT_ENDPOINTS.manual;
}

/**
 * 解析当前生效的模型 ID。
 *
 * @param config - 规范化配置。
 * @param settings - 前端设置文件内容。
 * @param providerRow - 当前提供商的配置行（manual 模式为 undefined）。
 * @param source - 当前配置来源。
 * @param candidate - 显式候选模型（可选）。
 * @returns 模型 ID。
 */
function resolveModel(config, settings, providerRow, source, candidate) {
  if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
  if (typeof settings?.model === 'string' && settings.model.trim() !== '') return settings.model.trim();
  if (source === 'provider') {
    if (config.modelExplicit) return config.model;
    const models = Array.isArray(providerRow?.models) ? providerRow.models : [];
    if (models.length === 0) return DEFAULTS.model;
    if (models.includes('jev-latest')) return 'jev-latest';
    return providerRow.decisionModels[0] ?? models[0];
  }
  return config.model || DEFAULTS.model;
}

/**
 * 校验 provider 行里的 baseURL。
 * @param baseURL - provider 配置的 baseURL。
 * @param providerId - provider ID（用于报错）。
 * @returns 规范化后的 baseURL。
 */
function providerBaseURL(baseURL, providerId) {
  const text = typeof baseURL === 'string' ? baseURL.trim() : '';
  if (text === '') {
    throw new Error(
      'tool-jev: provider "' + providerId + '" has no baseURL in the dsh model settings;' +
        ' pick another provider or switch the source to 手动配置',
    );
  }
  return endpoint(text, 'provider "' + providerId + '" baseURL');
}

/**
 * 计算一次调用实际生效的完整配置。
 *
 * 优先级（高 → 低）：
 *   1. 显式覆盖值（界面测试 / 工具参数）；
 *   2. 前端「保存设置」写入的设置文件；
 *   3. Profile 里本插件的 config 段；
 *   4. provider 行（provider 模式）或内置默认值（manual 模式）。
 *
 * @param config - 规范化配置。
 * @param overrides - 显式覆盖值。
 * @returns 生效配置对象。
 */
function resolveEffective(config, overrides = {}) {
  const loaded = loadUserSettings(config.settingsFile);
  const values = loaded.values;
  const source = normalizeSource(
    overrides.source !== undefined ? overrides.source : (values.source ?? config.source),
  );
  const sysProviders = getDshSystemProviders();
  let providerId = String(
    (overrides.provider !== undefined && overrides.provider !== null ? overrides.provider : '') ||
      values.provider ||
      config.provider ||
      '',
  ).trim();
  let providerRow = providerId ? sysProviders[providerId] : undefined;

  if (source === 'provider' && providerId === '') {
    const inferred = inferDefaultProvider();
    providerId = inferred.provider;
    providerRow = providerId ? sysProviders[providerId] : undefined;
  }
  if (source === 'provider' && !providerRow) {
    const available = Object.keys(sysProviders);
    const error = new Error(
      'tool-jev: provider "' +
        providerId +
        '" is not configured in the dsh model settings. Configured providers: ' +
        (available.length > 0 ? available.join(', ') : '(none)') +
        '. Pick one in the settings panel, or switch the source to 手动配置.',
    );
    error.code = 'EPROVIDER';
    throw error;
  }

  const baseURL =
    source === 'provider' ? providerBaseURL(providerRow.baseURL, providerId) : resolveBaseURL(config, values);
  const endpointPath = resolveEndpoint(config, values, source, overrides.endpoint);
  const model = resolveModel(config, values, providerRow, source, overrides.model);
  const warnings = [];
  if (
    source === 'provider' &&
    model !== '' &&
    Array.isArray(providerRow.models) &&
    providerRow.models.length > 0 &&
    !providerRow.models.includes(model)
  ) {
    warnings.push(
      'model "' + model + '" is not in the configured model list for "' + providerId + '" - sending it anyway',
    );
  }
  return {
    source,
    providerId,
    providerName: providerRow?.name,
    providerRow,
    baseURL,
    endpoint: endpointPath,
    model,
    headers: source === 'provider' ? { ...(providerRow.headers ?? {}) } : {},
    apiKeyEnv: source === 'provider' ? providerRow.apiKeyEnv || config.apiKeyEnv : config.apiKeyEnv,
    settings: loaded,
    proxy: resolveProxy(config, values),
    warnings,
  };
}

/**
 * 多级安全解析 API Key（避免密钥传入模型上下文造成泄露）。
 *
 * provider 模式：
 *   1. 显式传入 / 插件配置 / 设置文件保存的 Key（覆盖提供商自动解析）；
 *   2. 提供商声明的 apiKeyEnv（.credentials.yaml 优先，其次环境变量）；
 *   3. 提供商未声明 apiKeyEnv 时，才回退到通用变量名与本地密钥文件。
 *
 * manual 模式：
 *   1. 显式传入 / 插件配置 / 设置文件保存的 Key；
 *   2. 插件配置的 apiKeyEnv、TYPESAFE_API_KEY、JEV_API_KEY；
 *   3. ~/.config/typesafe/key；
 *   4. ~/.dsh/tools/jev/.env（历史兜底）。
 *
 * @param config - 规范化配置。
 * @param effective - 生效配置（含来源与提供商行）。
 * @param overrides - { inline } 界面/工具传来的未保存 Key。
 * @returns {{ token: string, from: string }}
 */
function resolveApiKey(config, effective, overrides = {}) {
  const inline = typeof overrides.inline === 'string' ? overrides.inline.trim() : '';
  // 含 ... 的值是 getConfig 回显的掩码，绝不能当作真实 Key。
  if (inline !== '' && !inline.includes('...')) return { token: inline, from: 'inline' };
  if (config.apiKey) return { token: config.apiKey, from: 'plugin-config' };
  const saved = effective.settings?.values?.apiKey;
  if (typeof saved === 'string' && saved.trim() !== '') return { token: saved.trim(), from: 'settings-file' };

  const declaredEnv =
    effective.source === 'provider' && effective.providerRow?.apiKeyEnv
      ? effective.providerRow.apiKeyEnv
      : '';
  if (declaredEnv) {
    // provider 声明了 apiKeyEnv 就只用它，绝不旁落到其它提供商的凭证上。
    const found = resolveToken({ apiKeyEnv: declaredEnv });
    if (found.token) return found;
    return { token: '', from: 'none' };
  }

  const envNames =
    effective.source === 'provider'
      ? Array.from(new Set([...keyEnvNames(config), ...FALLBACK_KEY_ENVS]))
      : keyEnvNames(config);
  for (const name of envNames) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim() !== '') return { token: value.trim(), from: 'env:' + name };
  }

  const fileKey = readKeyFile(config.keyFile);
  if (fileKey) return { token: fileKey, from: 'key-file' };

  if (config.keyFile === DEFAULTS.keyFile) {
    const legacy = readLegacyEnvFile(config);
    if (legacy) return { token: legacy, from: 'legacy-env-file' };
  }

  return { token: '', from: 'none' };
}

/**
 * 构建缺少 API Key 时的统一诊断提示信息。
 * @param config - 规范化配置。
 * @param effective - 生效配置。
 * @returns 错误提示文本。
 */
function missingKeyMessage(config, effective) {
  if (effective?.source === 'provider' && effective.providerRow?.apiKeyEnv) {
    return (
      'tool-jev: no API key for provider "' +
      effective.providerId +
      '". Set $' +
      effective.providerRow.apiKeyEnv +
      ' (or add it to ~/.dsh/.credentials.yaml under refs),' +
      ' or type a key into the settings panel.'
    );
  }
  const names = keyEnvNames(config)
    .map((name) => '$' + name)
    .join(' or ');
  return 'tool-jev: no API key. Set ' + names + ', type a key into the settings panel, or write it to ' + config.keyFile + '.';
}

/**
 * 把 API Key 掩码成可回显给浏览器的展示值。
 * @param key - 明文 Key。
 * @returns 掩码后的字符串。
 */
function maskKey(key) {
  if (!key) return '';
  if (key.length <= 10) return key.slice(0, 3) + '...' + key.slice(-2);
  return key.slice(0, 6) + '...' + key.slice(-4);
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
 * 校验模型传入的 questions 映射表，并将其规范化为协议标准格式。
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
 * 将兼容 OpenAI 格式或 /v1/decisions 返回的 answers 数组规范化为以问题 key 为键的标准字典结构。
 * @param answersArray - 决策回答列表。
 * @returns 规范化后的回答字典。
 */
function normalizeDecisionAnswers(answersArray) {
  const answersMap = {};
  for (const item of answersArray) {
    if (!item || typeof item !== 'object') continue;
    const name = item.name;
    if (!name) continue;
    if (item.type === 'predicate') {
      answersMap[name] = {
        type: 'noul',
        noul: typeof item.probability === 'number' ? item.probability : (item.noul ?? 0),
      };
    } else if (item.type === 'choice') {
      let probs = item.probabilities;
      if (Array.isArray(probs)) {
        probs = Object.fromEntries(
          probs
            .filter((p) => p && typeof p === 'object' && p.value !== undefined)
            .map((p) => [p.value, p.probability ?? 0]),
        );
      }
      answersMap[name] = {
        type: 'choice',
        choice: item.choice,
        confidence: item.confidence,
        probabilities: probs,
      };
    } else if (item.type === 'score') {
      let probs = item.probabilities;
      if (Array.isArray(probs) && probs.length > 0 && typeof probs[0] === 'object') {
        probs = probs.map((p) => p.probability ?? 0);
      }
      answersMap[name] = {
        type: 'score',
        score: item.score,
        confidence: item.confidence,
        probabilities: probs,
      };
    } else {
      answersMap[name] = item;
    }
  }
  return answersMap;
}

/**
 * 合并请求头：provider 行配置的 header 照搬，但认证头永远由插件自己设置，
 * 避免把提供商配置里的 Authorization 覆盖成错误的值。
 *
 * @param providerHeaders - provider 行声明的 headers。
 * @param apiKey - 明文 API Key。
 * @returns 合并后的请求头。
 */
function buildHeaders(providerHeaders, apiKey) {
  const headers = { 'content-type': 'application/json' };
  for (const [key, value] of Object.entries(providerHeaders ?? {})) {
    if (key.toLowerCase() === 'authorization') continue;
    if (value === undefined || value === null) continue;
    headers[key] = String(value);
  }
  headers.authorization = 'Bearer ' + apiKey;
  return headers;
}

/**
 * 构建发送给决策 API 的标准 HTTP 请求载荷。
 * 根据所选端点（/v1/systemone 或 /v1/decisions）自动适配协议请求体结构。
 *
 * @param args - 模型传入参数。
 * @param questions - 规范化后的 questions。
 * @param effective - 生效配置。
 * @returns 请求 URL、请求体、模型与端点。
 */
function buildRequest(args, questions, effective) {
  let model = effective.model;
  const ep = effective.endpoint;

  // 兼容历史行为：手写配置 + /v1/decisions 时，默认模型映射为 Vercel 网关标识。
  // provider 模式绝不改写模型名——那里用的是 dsh 提供商自己声明的模型 ID。
  if (ep === '/v1/decisions' && effective.source === 'manual' && (model === 'jev-latest' || !model)) {
    model = 'typesafe-ai/jev';
  }

  // 适配 OpenAI-compatible /v1/decisions 协议规范
  if (ep === '/v1/decisions') {
    const wireQuestions = Object.entries(questions).map(([key, spec]) => {
      const type = spec.type;
      if (type === 'noul' || type === 'boolean') {
        return {
          type: 'predicate',
          name: key,
          instructions: spec.instructions,
        };
      }
      if (type === 'choice') {
        const choices = Array.isArray(spec.criteria)
          ? spec.criteria.map((c) => (typeof c === 'string' ? { value: c } : c))
          : Object.entries(spec.criteria || {}).map(([val, desc]) => ({
              value: val,
              description: String(desc),
            }));
        return {
          type: 'choice',
          name: key,
          instructions: spec.instructions,
          choices,
        };
      }
      if (type === 'score') {
        const levels = Array.isArray(spec.criteria)
          ? spec.criteria.map((lvl) => (typeof lvl === 'string' ? { label: lvl } : lvl))
          : Object.entries(spec.criteria || {}).map(([, label]) => ({
              label: String(label),
            }));
        return {
          type: 'score',
          name: key,
          instructions: spec.instructions,
          levels,
        };
      }
      return { ...spec, name: key };
    });

    return {
      url: buildEndpointUrl(effective.baseURL, ep),
      body: {
        model,
        input: args.state,
        questions: wireQuestions,
      },
      model,
      endpoint: ep,
    };
  }

  // /v1/systemone 官方原生协议
  return {
    url: buildEndpointUrl(effective.baseURL, ep),
    body: { state: args.state, questions, model },
    model,
    endpoint: ep,
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
 * 统一的 HTTP 请求入口：命中代理规则时经代理转发，否则直连。
 *
 * @param targetUrl - 目标请求地址。
 * @param init - 请求初始化参数。
 * @param config - 规范化配置。
 * @param proxy - 已解析的代理；undefined / null 表示直连。
 * @returns fetch 兼容的响应对象。
 */
async function httpRequest(targetUrl, init, config, proxy) {
  if (proxy === undefined || proxy === null || !proxyTargetsUrl(targetUrl, config.proxyHosts)) {
    return fetch(targetUrl, init);
  }
  return requestViaProxy(targetUrl, init, proxy);
}

/**
 * 执行单次 HTTP 请求探测（独立管理超时期，防止前次超时信号污染重试轮次）。
 * @param request - 请求地址与基础属性。
 * @param headers - 认证与协议头。
 * @param body - 序列化载荷。
 * @param exec - 宿主运行上下文。
 * @param config - 插件配置。
 * @param proxy - 已解析的代理。
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
  // 规范化兼容 OpenAI /v1/decisions 数组格式响应
  if (Array.isArray(data.answers)) {
    data.answers = normalizeDecisionAnswers(data.answers);
  } else if (data.answers === undefined || data.answers === null) {
    if (data.decisions && typeof data.decisions === 'object') {
      data.answers = Array.isArray(data.decisions)
        ? normalizeDecisionAnswers(data.decisions)
        : data.decisions;
    } else if (Array.isArray(data.choices) && data.choices[0]?.message?.content) {
      try {
        const parsed = JSON.parse(data.choices[0].message.content);
        if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.answers)) {
            data.answers = normalizeDecisionAnswers(parsed.answers);
          } else {
            data.answers = parsed.answers || parsed;
          }
        }
      } catch {
        // 忽略非 JSON 内容
      }
    }
  }
  if (data.answers === null || typeof data.answers !== 'object' || Array.isArray(data.answers)) {
    throw new Error(
      'tool-jev: the endpoint response is missing the required "answers" object (answers must be an object)',
    );
  }
  return data;
}

/**
 * 发送决策请求（支持网络波动/5xx 自动指数退避重试，4xx 与中止不重试）。
 * @param args - 工具入参。
 * @param exec - 运行上下文。
 * @param config - 插件配置。
 * @returns 决策结果。
 */
async function requestDecision(args, exec, config) {
  const state = args.state;
  if (typeof state !== 'string' || state.trim() === '') {
    throw new Error('tool-jev: state must be a non-empty string');
  }
  const stateBytes = Buffer.byteLength(state, 'utf8');
  if (stateBytes > config.maxStateBytes) {
    throw new Error('tool-jev: state is ' + stateBytes + ' bytes, over maxStateBytes ' + config.maxStateBytes);
  }
  const questions = assertQuestions(args.questions, config);

  const effective = resolveEffective(config, {
    model: typeof args.model === 'string' ? args.model : undefined,
  });
  const keyInfo = resolveApiKey(config, effective, {});
  if (!keyInfo.token) throw new Error(missingKeyMessage(config, effective));

  const request = buildRequest(args, questions, effective);
  const headers = buildHeaders(effective.headers, keyInfo.token);
  const body = JSON.stringify(request.body);

  if (isCallerAborted(exec)) throw callerAbortError();

  const attempts = config.retries + 1;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await sleep(500 * (attempt - 1));
    if (isCallerAborted(exec)) throw callerAbortError();
    try {
      return await attemptRequest(request, headers, body, exec, config, effective.proxy);
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
 * 共享的决策策略提示词片段词汇表（供模型可见的 Tool Description 与常驻提示词切面共用）。
 */
const POLICY = {
  purpose: 'Ask the configured decision model (default: TypeSafe Jev) for typed judgments about arbitrary state.',
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
 * 常驻提示词切面文本内容（Surface B：向模型注入决策规范指南）。
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
        description: 'Optional model id; defaults to the plugin-configured model (jev-latest by default).',
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
 * 组装给前端设置面板的完整视图数据。
 *
 * 这个函数必须足够健壮：即使 dsh 提供商配置缺失或损坏，也要能返回一份可渲染的
 * 视图（用 configError 说明原因），否则设置页会整块白屏。
 *
 * @param config - 规范化配置。
 * @returns 设置视图对象。
 */
function buildConfigView(config) {
  const loaded = loadUserSettings(config.settingsFile);
  const values = loaded.values;
  const sysProviders = getDshSystemProviders();
  const inferred = inferDefaultProvider();
  const source = normalizeSource(values.source ?? config.source);
  const providerId = String(values.provider ?? config.provider ?? '').trim() || inferred.provider;
  const providerRow = providerId ? sysProviders[providerId] : undefined;

  let effective;
  let configError;
  try {
    effective = resolveEffective(config, { source, provider: providerId });
  } catch (error) {
    configError = error.message;
    effective = {
      source,
      providerId,
      providerName: providerRow?.name,
      providerRow,
      baseURL: source === 'provider' ? (providerRow?.baseURL ?? '') : resolveBaseURL(config, values),
      endpoint: resolveEndpoint(config, values, source, undefined),
      model: resolveModel(config, values, providerRow, source, undefined),
      headers: providerRow?.headers ?? {},
      apiKeyEnv: providerRow?.apiKeyEnv || config.apiKeyEnv,
      settings: loaded,
      proxy: resolveProxy(config, values),
      warnings: [],
    };
  }

  const keyInfo = resolveApiKey(config, effective, {});
  const providers = Object.values(sysProviders).map((provider) => ({
    id: provider.id,
    name: provider.name,
    baseURL: provider.baseURL,
    apiKeyEnv: provider.apiKeyEnv,
    models: provider.models,
    decisionModels: provider.decisionModels,
  }));

  return {
    configured: Boolean(keyInfo.token),
    apiKey: maskKey(keyInfo.token),
    apiKeyFrom: keyInfo.from,
    source,
    sourceModes: SOURCE_MODES,
    provider: effective.providerId,
    providers,
    model: effective.model,
    models: providerRow?.models ?? [],
    decisionModels: providerRow?.decisionModels ?? [],
    modelWarning: effective.warnings[0],
    baseURL: effective.baseURL,
    baseURLDefault: DEFAULTS.baseURL,
    /** 手动模式下已保存/生效的地址：切换来源时用它恢复，而不是留着提供商的地址。 */
    manualBaseURL: resolveBaseURL(config, values),
    baseURLLocked: source === 'manual' && config.configBaseURL !== undefined,
    endpoint: effective.endpoint,
    endpointDefault: DEFAULT_ENDPOINTS[source],
    endpointDefaults: { ...DEFAULT_ENDPOINTS },
    endpointLocked: config.configEndpoint !== undefined,
    availableEndpoints: AVAILABLE_ENDPOINTS,
    proxy: effective.proxy ? formatProxyForDisplay(effective.proxy) : '',
    proxyLocked: config.configProxy !== undefined,
    configSource: describeConfigSource(loaded),
    settingsFile: loaded.path,
    legacySettingsFile: loaded.legacyPath,
    inferred: { provider: inferred.provider, model: inferred.model },
    configError,
  };
}

/**
 * 处理前端设置 RPC 调用。
 *
 * 所有解析都从设置文件重新读取，因此「保存」之后同一进程内立即生效，
 * 不需要重启宿主。
 *
 * @param config - 规范化配置。
 * @param method - 方法名。
 * @param payload - 请求载荷。
 * @returns 统一的 { ok, value | error } 信封。
 */
async function handleSettingsRpc(config, method, payload = {}) {
  if (method === 'getConfig') {
    try {
      return rpcOk(buildConfigView(config));
    } catch (error) {
      return rpcFailure('config-failed', error.message);
    }
  }

  if (method === 'saveConfig') {
    try {
      const loaded = loadUserSettings(config.settingsFile);
      const current = loaded.values;
      const source = normalizeSource(
        typeof payload.source === 'string' ? payload.source : (current.source ?? config.source),
      );
      const patch = {};
      if (typeof payload.source === 'string') patch.source = source;

      if (typeof payload.provider === 'string') {
        const id = payload.provider.trim();
        if (id !== '' && !getDshSystemProviders()[id]) {
          const available = Object.keys(getDshSystemProviders());
          return rpcFailure(
            'unknown-provider',
            '提供商 "' + id + '" 未在 dsh 模型配置里定义。可用提供商：' + (available.join(', ') || '(none)'),
          );
        }
        patch.provider = id;
      }

      // 手写接口地址：空字符串表示恢复官方默认地址；provider 模式下由提供商决定，不写盘。
      if (typeof payload.baseURL === 'string' && source === 'manual') {
        if (config.configBaseURL !== undefined) {
          return rpcFailure(
            'base-url-locked',
            '接口地址已由插件配置（baseURL）固定，无法在界面修改：请修改 Profile 配置后重启',
          );
        }
        const trimmed = payload.baseURL.trim();
        patch.baseURL = trimmed === '' ? '' : endpoint(trimmed, 'baseURL');
      }

      // 接口端点：空字符串表示恢复该来源的默认端点。
      if (typeof payload.endpoint === 'string') {
        if (config.configEndpoint !== undefined) {
          return rpcFailure(
            'endpoint-locked',
            '接口端点已由插件配置（endpoint）固定，无法在界面修改：请修改 Profile 配置后重启',
          );
        }
        const trimmed = payload.endpoint.trim();
        patch.endpoint = trimmed === '' ? '' : normalizeEndpoint(trimmed);
      }

      if (typeof payload.model === 'string') {
        const model = payload.model.trim();
        // 手动模式必须给模型；provider 模式允许留空，调用时会回退到提供商模型表。
        if (model === '' && source === 'manual') {
          return rpcFailure('model-required', '模型名称不能为空');
        }
        patch.model = model;
      }

      // 含 ... 的值是 getConfig 回显的掩码，不能写回磁盘；空字符串表示清除显式 Key。
      if (typeof payload.apiKey === 'string' && !payload.apiKey.includes('...')) {
        patch.apiKey = payload.apiKey.trim();
      }

      // 代理地址：空字符串表示清除代理（恢复直连）。保存前先校验，避免写入坏值。
      if (typeof payload.proxy === 'string') {
        if (config.configProxy !== undefined) {
          return rpcFailure(
            'proxy-locked',
            '代理地址已由插件配置（proxy）固定，无法在界面修改：请修改 Profile 配置后重启',
          );
        }
        const trimmed = payload.proxy.trim();
        if (trimmed !== '') parseProxyUrl(trimmed, 'proxy');
        patch.proxy = trimmed;
      }

      writeSettingsFile(config.settingsFile, patch, { source: 'user-set' });
      return rpcOk(buildConfigView(config));
    } catch (error) {
      return rpcFailure('save-failed', error.message);
    }
  }

  if (method === 'testConnection') {
    try {
      const effective = resolveEffective(config, {
        source: typeof payload.source === 'string' ? payload.source : undefined,
        provider: typeof payload.provider === 'string' ? payload.provider : undefined,
        model: typeof payload.model === 'string' ? payload.model : undefined,
        endpoint: typeof payload.endpoint === 'string' ? payload.endpoint : undefined,
      });
      const keyInfo = resolveApiKey(config, effective, {
        inline: typeof payload.apiKey === 'string' ? payload.apiKey : undefined,
      });
      if (!keyInfo.token) {
        return rpcFailure('unconfigured', missingKeyMessage(config, effective));
      }

      // 界面上尚未保存的手写接口地址只影响本次测试；provider 模式的地址由提供商决定。
      let baseURL = effective.baseURL;
      if (effective.source === 'manual' && typeof payload.baseURL === 'string') {
        if (config.configBaseURL !== undefined) {
          baseURL = config.configBaseURL;
        } else {
          const trimmed = payload.baseURL.trim();
          baseURL = trimmed === '' ? DEFAULTS.baseURL : endpoint(trimmed, 'baseURL');
        }
      }

      const testProxy = resolveTestProxy(payload, config, effective.settings.values);
      const isDecisions = effective.endpoint === '/v1/decisions';
      let testModel = effective.model;
      if (isDecisions && effective.source === 'manual' && (testModel === 'jev-latest' || !testModel)) {
        testModel = 'typesafe-ai/jev';
      }

      const pingBody = isDecisions
        ? {
            model: testModel,
            input: 'Ping check from DSH',
            questions: [
              {
                type: 'predicate',
                name: 'ping',
                instructions: 'Is this a valid test ping?',
              },
            ],
          }
        : {
            state: 'Ping check from DSH',
            model: testModel,
            questions: {
              ping: { type: 'noul', instructions: 'Is this a valid test ping?' },
            },
          };

      const start = Date.now();
      const testRes = await httpRequest(
        buildEndpointUrl(baseURL, effective.endpoint),
        {
          method: 'POST',
          headers: buildHeaders(effective.headers, keyInfo.token),
          body: JSON.stringify(pingBody),
        },
        config,
        testProxy,
      );
      const testData = await testRes.json();
      const durationMs = Date.now() - start;
      if (testRes.ok) {
        return rpcOk({
          durationMs,
          model: testModel,
          source: effective.source,
          provider: effective.providerId,
          baseURL,
          endpoint: effective.endpoint,
          apiKeyFrom: keyInfo.from,
          result: testData,
        });
      }
      return rpcFailure(
        'http-' + testRes.status,
        testData?.error?.message || testData?.detail?.message || 'HTTP ' + testRes.status,
        { status: testRes.status, body: testData },
      );
    } catch (error) {
      return rpcFailure('request-failed', error.message);
    }
  }

  return rpcFailure('unknown-method', '未知方法: ' + method);
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
    execute: (args, exec) => requestDecision(args, exec, resolved),
  });
  if (resolved.policySection.enabled) registerPolicySection(ctx, resolved);

  if (ctx.connection?.rpc?.handle) {
    ctx.connection.rpc.handle(
      SETTINGS_RPC_CHANNEL,
      (method, payload) => handleSettingsRpc(resolved, method, payload),
      { authority: 'trusted-host' },
    );
  }
}

/** 便于测试与诊断：导出内部工具函数。 */
export const _internals = {
  normalizeConfig,
  normalizeSource,
  resolveEffective,
  resolveApiKey,
  buildConfigView,
  buildEndpointUrl,
  maskKey,
  isDecisionModel,
};
