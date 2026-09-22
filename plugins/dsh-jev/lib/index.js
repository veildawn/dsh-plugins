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
  const userKeyPath = join(homedir(), '.config', 'typesafe', 'key');

  if (method === 'getConfig') {
    const currentKey = await resolveApiKey(resolved);
    return rpcOk({
      configured: Boolean(currentKey),
      apiKey: currentKey ? (currentKey.slice(0, 6) + '...' + currentKey.slice(-4)) : '',
      model: resolved.model,
    });
  }

  if (method === 'saveConfig') {
    try {
      if (typeof payload?.apiKey === 'string' && payload.apiKey.trim()) {
        await mkdir(dirname(userKeyPath), { recursive: true });
        await writeFile(userKeyPath, payload.apiKey.trim(), 'utf8');
        resolved.apiKey = payload.apiKey.trim();
      }
      if (typeof payload?.model === 'string' && payload.model.trim()) {
        resolved.model = payload.model.trim();
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
      const start = Date.now();
      const testRes = await fetch(`${resolved.baseURL}/v1/systemone`, {
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
      });
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
  const url = String(value).replace(/[/]+$/, '');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('tool-jev: ' + label + ' is not a valid URL: ' + url);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('tool-jev: ' + label + ' must be http(s), got ' + parsed.protocol);
  }
  return url;
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
  return {
    transport,
    baseURL: endpoint(raw.baseURL === undefined ? DEFAULTS.baseURL : raw.baseURL, 'baseURL'),
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
function buildRequest(args, questions, config) {
  const model = typeof args.model === 'string' && args.model.trim() !== '' ? args.model.trim() : config.model;
  return {
    url: config.baseURL + '/v1/systemone',
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
async function attemptRequest(request, headers, body, exec, config) {
  const signals = [AbortSignal.timeout(config.timeoutMs)];
  if (exec !== undefined && exec !== null && exec.signal) signals.push(exec.signal);

  let response;
  try {
    response = await fetch(request.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.any(signals),
    });
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

  const request = buildRequest(args, questions, config);
  const headers = { ...request.headers, authorization: 'Bearer ' + apiKey };
  const body = JSON.stringify(request.body);

  if (isCallerAborted(exec)) throw callerAbortError();

  const attempts = config.retries + 1;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await sleep(500 * (attempt - 1));
    if (isCallerAborted(exec)) throw callerAbortError();
    try {
      return await attemptRequest(request, headers, body, exec, config);
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

    const userKeyPath = join(homedir(), '.config', 'typesafe', 'key');

    ws.get('/api/dsh-jev/config', async (_req, res) => {
      const currentKey = await resolveApiKey(resolved);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        configured: Boolean(currentKey),
        apiKey: currentKey ? (currentKey.slice(0, 6) + '...' + currentKey.slice(-4)) : '',
        model: resolved.model,
      }));
    });

    ws.post('/api/dsh-jev/config', async (req, res) => {
      let bodyStr = '';
      req.on('data', (chunk) => { bodyStr += chunk; });
      req.on('end', async () => {
        try {
          const body = JSON.parse(bodyStr || '{}');
          if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
            await mkdir(dirname(userKeyPath), { recursive: true });
            await writeFile(userKeyPath, body.apiKey.trim(), 'utf8');
            resolved.apiKey = body.apiKey.trim();
          }
          if (typeof body.model === 'string' && body.model.trim()) {
            resolved.model = body.model.trim();
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
          const start = Date.now();
          const testRes = await fetch(`${resolved.baseURL}/v1/systemone`, {
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
          });
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
