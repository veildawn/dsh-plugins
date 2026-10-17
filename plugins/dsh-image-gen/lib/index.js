/**
 * DSH 原生生图插件。
 *
 * 把「文生图」作为原生工具（image_generate）暴露给模型，并在 Web 设置面板里提供
 * 完整的可视化配置。与 ~/.dsh/mcp 下的生图 MCP 服务相比：
 *   - 不派生子进程、不依赖 @modelcontextprotocol/sdk，零 npm 依赖；
 *   - 提供商/模型既可以手写 baseUrl + apiKey + model，也可以直接下拉选择
 *     dsh 已经配置好的提供商与模型（llm-pi-ai 行里的 providers）；
 *   - 尺寸与画质都是下拉选择，同时带校验，避免把非法值发给 provider。
 *
 * 配置来源优先级（高 → 低）：
 *   1. 工具调用时的显式参数（provider/model/size/quality/output_path）
 *   2. 前端「保存设置」写入的本地设置文件（~/.dsh/image-gen/settings.json）
 *   3. Profile 里本插件 config 段（provider/model/apiKeyEnv/apiKey/size/quality…）
 *   4. 扫描 dsh 自身模型配置推断出的第一个可生图提供商与模型
 *
 * @module dsh-image-gen
 */

import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  DEFAULT_PROXY_HOSTS,
  formatProxyForDisplay,
  normalizeProxyHosts,
  parseProxyUrl,
} from './proxy.js';
import {
  QUALITY_OPTIONS,
  SIZE_OPTIONS,
  normalizeBaseURL,
  normalizeQuality,
  normalizeSize,
} from './image.js';
import {
  describeConfigSource,
  normalizeConfig,
  pickConfig,
  readSettingsFile,
  resolveSettingsPath,
  writeSettingsFile,
} from './settings.js';
import {
  getDshSystemProviders,
  inferDefaultConfig,
  isEditOnlyModel,
  resolveToken,
} from './provider.js';

/** Cordis 插件名称。 */
export const name = 'tool-image-gen';

/** 插件激活前所需注入的底层服务列表。 */
export const inject = ['tools', 'connection'];

/** 前端设置面板使用的 RPC 通道。 */
export const SETTINGS_RPC_CHANNEL = '/dsh-image-gen-settings';

/** 工具名。 */
export const TOOL_NAME = 'image_generate';

/** 默认超时（毫秒）。 */
const DEFAULT_TIMEOUT_MS = 180000;

/** 一次调用最多落盘的图片字节数（防止 provider 返回异常大的响应）。 */
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

function rpcFailure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

function rpcOk(value) {
  return { ok: true, value };
}

/**
 * 校验并规范化插件配置。
 * @param {Record<string, unknown>} config Profile 里的 config 段。
 * @returns {Record<string, any>} 规范化后的配置。
 */
export function normalizePluginConfig(config) {
  const raw = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  const source = raw.source === 'manual' ? 'manual' : 'provider';
  const timeoutMs = raw.timeoutMs === undefined
    ? DEFAULT_TIMEOUT_MS
    : Number(raw.timeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('image-gen: timeoutMs must be a positive finite number');
  }
  const provider = typeof raw.provider === 'string' ? raw.provider.trim() : '';
  const baseURL = typeof raw.baseURL === 'string' ? raw.baseURL.trim() : '';
  const model = typeof raw.model === 'string' ? raw.model.trim() : '';
  if (source === 'provider' && !provider && !model) {
    // 允许完全留空：插件会自己扫描 dsh 配置推断
  }
  const apiKey = typeof raw.apiKey === 'string' && raw.apiKey.trim() ? raw.apiKey.trim() : undefined;
  const apiKeyEnv = typeof raw.apiKeyEnv === 'string' && raw.apiKeyEnv.trim() ? raw.apiKeyEnv.trim() : undefined;
  const configProxy = parseProxyUrl(raw.proxy, 'proxy');
  const lockedConfig = raw.locked && typeof raw.locked === 'object' ? raw.locked : {};
  const isExplicitlyLocked = (field) => Boolean(lockedConfig[field] ?? raw[`${field}Locked`] ?? raw.lock);
  const locked = {
    provider: isExplicitlyLocked('provider'),
    baseURL: isExplicitlyLocked('baseURL'),
    model: isExplicitlyLocked('model'),
    apiKeyEnv: isExplicitlyLocked('apiKeyEnv'),
  };
  return {
    source,
    provider,
    baseURL,
    model,
    apiKey,
    apiKeyEnv,
    size: normalizeSize(raw.size),
    quality: normalizeQuality(raw.quality),
    timeoutMs,
    /** 由插件配置固定下来的代理（undefined 表示允许前端覆盖）。 */
    configProxy,
    proxy: configProxy,
    proxyHosts: normalizeProxyHosts(raw.proxyHosts),
    settingsFile: resolveSettingsPath(typeof raw.settingsFile === 'string' ? raw.settingsFile : undefined),
    locked,
  };
}

/**
 * 解析当前生效的代理。
 *
 * 优先级：插件配置里的 proxy > 前端设置文件里的 proxy > 直连。
 * 插件配置优先，是为了让 Profile 里写死的代理不会被界面误改。
 *
 * @param {Record<string, any>} resolved 插件配置。
 * @returns {Promise<object | undefined>} 生效的代理描述对象。
 */
async function resolveProxy(resolved) {
  if (resolved.configProxy !== undefined) return resolved.configProxy;
  const saved = pickConfig(readSettingsFile(resolved.settingsFile));
  if (typeof saved.proxy !== 'string' || saved.proxy.trim() === '') return undefined;
  try {
    return parseProxyUrl(saved.proxy, 'proxy');
  } catch {
    // 设置文件被手工改坏时兜底为直连，避免整个工具不可用
    return undefined;
  }
}

/**
 * 解析前端传来的代理测试值（用于 testConnection）。
 *
 * 语义区分：字段缺省 → 沿用已保存的代理；空字符串 → 直连；掩码值（含 ***）
 * 是 getConfig 的回显，不能当地址用，沿用已保存的代理。
 *
 * @param {Record<string, any>} payload 前端请求载荷。
 * @param {Record<string, any>} resolved 插件配置。
 * @returns {Promise<object | null | undefined>} 代理对象、null（直连）或 undefined（沿用）。
 */
async function resolveTestProxy(payload, resolved) {
  if (resolved.configProxy !== undefined) return resolved.configProxy;
  if (typeof payload?.proxy !== 'string') return resolveProxy(resolved);
  const candidate = payload.proxy.trim();
  if (candidate === '') return null;
  if (candidate.includes('***')) return resolveProxy(resolved);
  return parseProxyUrl(candidate, 'proxy');
}

/**
 * 读取设置文件里的模型化配置，并推断默认值兜底。
 * @param {Record<string, any>} resolved 插件配置。
 * @returns {{ file: Record<string, any>, source: string, inferred: { provider: string, model: string } }}
 */
function readEffectiveSettings(resolved) {
  const raw = readSettingsFile(resolved.settingsFile);
  const file = pickConfig(raw, { includeSecrets: true });
  const inferred = inferDefaultConfig();
  const source = describeConfigSource(resolved.settingsFile);
  return { file, source, inferred };
}

/**
 * 计算一次调用实际生效的完整配置。
 *
 * @param {Record<string, any>} resolved 插件配置。
 * @param {{ provider?: string, baseURL?: string, model?: string, apiKey?: string, size?: string, quality?: string }} [overrides] 工具/前端给的覆盖值。
 * @returns {Promise<{ source: string, provider: string, baseURL: string, model: string, size: string, quality: string, proxy: string, warnings: string[], apiKeyEnv: string, headerOverrides: Record<string, string>, fromProviderRow: boolean, proxyObject: object | undefined, savedApiKey?: string }>}
 */
async function computeEffective(resolved, overrides = {}) {
  const { file, inferred } = readEffectiveSettings(resolved);
  const warnings = [];

  const source = overrides.source ?? file.source ?? resolved.source ?? 'provider';
  const providerId = overrides.provider ?? file.provider ?? resolved.provider ?? inferred.provider;
  const model = overrides.model ?? file.model ?? resolved.model ?? inferred.model;
  const size = normalizeSize(overrides.size ?? file.size ?? resolved.size);
  const quality = normalizeQuality(overrides.quality ?? file.quality ?? resolved.quality);
  const proxy = await resolveProxy(resolved);

  const sysProviders = getDshSystemProviders();
  const row = sysProviders[providerId];

  let baseURL = '';
  let apiKeyEnv = '';
  let headerOverrides = {};
  let fromProviderRow = false;

  if (source === 'provider') {
    if (!row) {
      const err = new Error(
        `image-gen: provider "${providerId}" is not configured in dsh model settings. ` +
          `Configured providers: ${Object.keys(sysProviders).join(', ') || '(none)'}. ` +
          'Pick one from the settings panel, or switch the source to 手动配置 and enter a baseUrl.',
      );
      err.code = 'EPROVIDER';
      throw err;
    }
    baseURL = normalizeBaseURL(row.baseURL);
    // provider 行声明的 apiKeyEnv 优先；插件 config 里的 apiKeyEnv 只在行没声明时兜底。
    // 反过来会让「Profile 里写错 key 名字」表现为连接失败，而不是清晰的缺 key 报错。
    apiKeyEnv = row.apiKeyEnv || resolved.apiKeyEnv || '';
    headerOverrides = row.headers;
    fromProviderRow = true;
    if (model && row.models.length > 0 && !row.models.includes(model)) {
      warnings.push(`model "${model}" is not in the configured model list for "${providerId}" - sending it anyway`);
    }
  } else {
    baseURL = normalizeBaseURL(overrides.baseURL ?? file.baseURL ?? resolved.baseURL);
    apiKeyEnv = resolved.apiKeyEnv ?? '';
    if (!baseURL || baseURL === normalizeBaseURL('')) {
      const err = new Error('image-gen: baseURL is required when the source is 手动配置 (manual)');
      err.code = 'EBASEURL';
      throw err;
    }
  }

  return {
    source,
    provider: providerId,
    baseURL,
    model,
    size,
    quality,
    proxy: proxy ? proxy.display : '',
    warnings,
    apiKeyEnv,
    headerOverrides,
    fromProviderRow,
    proxyObject: proxy,
    savedApiKey: typeof file.apiKey === 'string' && file.apiKey.trim() ? file.apiKey.trim() : undefined,
  };
}

/**
 * 取一次调用要用的 API Key。
 *
 * 优先级：显式传入的 apiKey > 插件 config 里的 apiKey > 本地设置文件保存的 key > .credentials.yaml > 环境变量。
 *
 * @param {Record<string, any>} resolved 插件配置。
 * @param {{ apiKey?: string, apiKeyEnv?: string, savedApiKey?: string }} opts
 * @returns {{ token: string, from: string }}
 */
function resolveApiKey(resolved, opts = {}) {
  if (opts.apiKey && String(opts.apiKey).trim() && !String(opts.apiKey).includes('...')) {
    return { token: String(opts.apiKey).trim(), from: 'inline' };
  }
  if (resolved.apiKey) return { token: resolved.apiKey, from: 'plugin-config' };
  if (opts.savedApiKey) return { token: opts.savedApiKey, from: 'settings-file' };
  return resolveToken({ apiKeyEnv: opts.apiKeyEnv });
}

/** 缺少 Key 时的诊断信息。 */
function missingKeyMessage(apiKeyEnv) {
  const names = [];
  if (apiKeyEnv) names.push(apiKeyEnv);
  const unique = Array.from(new Set([...names, 'AIPROXY_ACCESS_TOKEN', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY']));
  return (
    'image-gen: no API key found. ' +
    (unique.length > 0 ? `Set one of ${unique.map((n) => '$' + n).join(', ')}, ` : '') +
    'type it into the settings panel, or add it to ~/.dsh/.credentials.yaml under refs.'
  );
}

/**
 * 面向大模型的工具描述文本。
 * @returns {string}
 */
function describeTool() {
  return [
    'Generate an image from a text prompt and save it to disk.',
    'The provider can be one dsh already configured (picked from a dropdown in the settings panel),',
    'or a hand-written OpenAI-compatible baseUrl plus API key. Size and quality are dropdown choices;',
    'when a value is omitted, the saved default from the settings panel is used.',
    'Providers frequently ignore the requested size: the returned actualSize is read from the image bytes,',
    'so trust it over requestedSize. The file extension always matches the real format (png/jpg/webp).',
    'Use this for posters, brand boards, UI references, mockups, and other still images.',
  ].join(' ');
}

/**
 * 工具入参 JSON Schema。
 * @returns {Record<string, unknown>}
 */
function parametersFor() {
  const sizeList = SIZE_OPTIONS.map((option) => option.value).join(', ');
  const qualityList = QUALITY_OPTIONS.map((option) => option.value).join(', ');
  return {
    type: 'object',
    additionalProperties: false,
    required: ['prompt'],
    properties: {
      prompt: {
        type: 'string',
        description: 'The descriptive prompt for image generation. Be concrete about subject, composition, lighting, style and mood.',
      },
      output_path: {
        type: 'string',
        description:
          'Local file path to save the generated image (e.g. ./output.png). Relative paths resolve against the session workspace. ' +
          'If omitted, a timestamped file in the current directory is chosen. The extension is corrected to the real format when they disagree.',
      },
      provider: {
        type: 'string',
        description:
          "Optional provider ID matching dsh model settings (e.g. 'ai-proxy'). Omit to use the saved default provider.",
      },
      model: {
        type: 'string',
        description: "Optional model ID (e.g. 'gemini-3.1-flash-image', 'grok-imagine-image'). Omit to use the saved default model.",
      },
      size: {
        type: 'string',
        description: `Image dimensions. One of: ${sizeList}. Defaults to the saved setting (1024x1024).`,
      },
      quality: {
        type: 'string',
        description: `Image quality. One of: ${qualityList}. Defaults to the saved setting (auto, which is not sent).`,
      },
    },
  };
}

/**
 * 执行一次生图：解析配置 → 取 key → 请求 → 落盘。
 * @param {Record<string, any>} resolved 插件配置。
 * @param {Record<string, unknown>} args 工具入参。
 * @returns {Promise<Record<string, any>>}
 */
async function runGeneration(resolved, args) {
  // 延迟导入，避免测试只加载 index.js 时也要走 image 模块
  const { generateImage } = await import('./image.js');

  const overrides = {
    provider: typeof args.provider === 'string' && args.provider.trim() ? args.provider.trim() : undefined,
    model: typeof args.model === 'string' && args.model.trim() ? args.model.trim() : undefined,
    size: typeof args.size === 'string' && args.size.trim() ? args.size.trim() : undefined,
    quality: typeof args.quality === 'string' && args.quality.trim() ? args.quality.trim() : undefined,
  };

  const effective = await computeEffective(resolved, overrides);
  const prompt = String(args.prompt ?? '').trim();
  if (prompt === '') throw new Error('image-gen: prompt must be a non-empty string');

  if (isEditOnlyModel(effective.model)) {
    const err = new Error(
      `image-gen: model "${effective.model}" looks like an image-EDIT model (it expects an input image), ` +
        'but this is a text-to-image request. Pick a generation model such as gemini-3.1-flash-image or grok-imagine-image.',
    );
    err.code = 'EEDITONLY';
    throw err;
  }

  const { token, from } = resolveApiKey(resolved, {
    apiKey: typeof args.api_key === 'string' ? args.api_key : undefined,
    apiKeyEnv: effective.apiKeyEnv,
    savedApiKey: effective.savedApiKey,
    providerRow: effective.fromProviderRow,
  });
  if (!token) {
    const err = new Error(missingKeyMessage(effective.apiKeyEnv));
    err.code = 'ETOKEN';
    throw err;
  }

  const outputPath = typeof args.output_path === 'string' && args.output_path.trim() ? args.output_path.trim() : undefined;

  const result = await generateImage({
    prompt,
    baseURL: effective.baseURL,
    apiKey: token,
    model: effective.model,
    size: effective.size,
    quality: effective.quality,
    outputPath,
    headers: effective.headerOverrides,
    timeoutMs: resolved.timeoutMs,
    proxy: effective.proxy,
    proxyHosts: resolved.proxyHosts,
  });

  // effective.warnings 是配置层的告警（模型不在列表等）；result.warnings 是
  // generateImage 自己算的（provider 忽略尺寸、扩展名被改写等）。两者都要保留。
  const warnings = [...effective.warnings, ...(Array.isArray(result.warnings) ? result.warnings : [])];
  if (from.startsWith('credentials:')) {
    warnings.push(`using the token from ~/.dsh/.credentials.yaml (${from.slice('credentials:'.length)})`);
  }

  return {
    ...result,
    provider: effective.provider,
    source: effective.source,
    tokenFrom: from,
    warnings,
  };
}

/**
 * 把生成结果渲染成模型可见的文本块。
 * @param {Record<string, unknown>} args 工具入参。
 * @param {Record<string, any>} value 生成结果。
 * @returns {Array<{ type: string, text: string }>}
 */
function renderResult(args, value) {
  const lines = [
    `Saved image to ${value.savePath}`,
    `Prompt: "${args.prompt}"`,
    `Provider: ${value.provider} (${value.source === 'manual' ? '手动配置' : 'dsh 已配置'})`,
    `Model: ${value.model}`,
    `Size: ${value.actualSize} (requested ${value.requestedSize})`,
    `Quality: ${value.quality}`,
    `Format: ${value.mime} (${value.bytes} bytes, extension matches the content)`,
    `Token source: ${value.tokenFrom}`,
  ];
  if (Array.isArray(value.warnings) && value.warnings.length > 0) {
    lines.push('Warnings:');
    for (const warning of value.warnings) lines.push(`- ${warning}`);
  }
  return [{ type: 'text', text: lines.join('\n') }];
}

/**
 * 组装给前端设置面板的完整视图数据。
 * @param {Record<string, any>} resolved 插件配置。
 * @returns {Record<string, unknown>}
 */
function buildConfigView(resolved) {
  const sysProviders = getDshSystemProviders();
  const { file, source, inferred } = readEffectiveSettings(resolved);
  const providers = Object.values(sysProviders).map((provider) => ({
    id: provider.id,
    name: provider.name,
    baseURL: provider.baseURL,
    apiKeyEnv: provider.apiKeyEnv,
    models: provider.models,
    imageModels: provider.imageModels,
  }));
  const activeProviderId = file.provider || resolved.provider || inferred.provider;
  const activeRow = sysProviders[activeProviderId];
  const token = activeRow ? resolveToken({ apiKeyEnv: activeRow.apiKeyEnv }) : { token: '', from: 'none' };
  const hasConfiguredKey = Boolean(token.token || resolved.apiKey || file.apiKey);
  const keySource = token.token
    ? token.from
    : (resolved.apiKey ? 'plugin-config' : (file.apiKey ? 'settings-file' : 'none'));

  return {
    source: file.source || resolved.source,
    provider: activeProviderId,
    baseURL: file.baseURL || resolved.baseURL,
    model: file.model || resolved.model || inferred.model,
    size: file.size || resolved.size,
    quality: file.quality || resolved.quality,
    proxy: resolved.configProxy !== undefined
      ? formatProxyForDisplay(resolved.configProxy)
      : (typeof file.proxy === 'string' ? file.proxy : ''),
    proxyLocked: resolved.configProxy !== undefined,
    proxyHosts: resolved.proxyHosts,
    apiKeyEnv: activeRow ? activeRow.apiKeyEnv : (resolved.apiKeyEnv ?? ''),
    apiKeyConfigured: hasConfiguredKey,
    apiKeyFrom: keySource,
    configSource: source,
    settingsFile: resolved.settingsFile,
    locked: resolved.locked ?? {
      provider: false,
      baseURL: false,
      model: false,
      apiKeyEnv: false,
    },
    inferred: { provider: inferred.provider, model: inferred.model },
    providers,
    availableProviders: providers.map((provider) => provider.id),
    sizeOptions: SIZE_OPTIONS,
    qualityOptions: QUALITY_OPTIONS,
    availableModels: activeRow ? activeRow.models : [],
    availableImageModels: activeRow ? activeRow.imageModels : [],
  };
}

/**
 * 处理前端设置 RPC 调用。
 * @param {Record<string, any>} resolved 插件配置。
 * @param {string} method 方法名。
 * @param {Record<string, unknown>} payload 请求载荷。
 * @returns {Promise<Record<string, unknown>>}
 */
async function handleSettingsRpc(resolved, method, payload = {}) {
  if (method === 'getConfig') {
    return rpcOk(buildConfigView(resolved));
  }

  if (method === 'saveConfig') {
    try {
      const patch = {};
      if (typeof payload.source === 'string') patch.source = payload.source === 'manual' ? 'manual' : 'provider';
      if (typeof payload.provider === 'string') patch.provider = payload.provider.trim();
      if (typeof payload.baseURL === 'string') patch.baseURL = payload.baseURL.trim();
      if (typeof payload.model === 'string') patch.model = payload.model.trim();
      if (typeof payload.size === 'string') patch.size = payload.size;
      if (typeof payload.quality === 'string') patch.quality = payload.quality;
      if (typeof payload.apiKey === 'string') patch.apiKey = payload.apiKey.trim();
      if (typeof payload.proxy === 'string') patch.proxy = payload.proxy.trim();

      // 保存前先做一次完整校验：尺寸/画质/来源模式/model 都过一遍，
      // 不通过就整体不落盘，避免写进半个坏配置。
      const sysProviders = getDshSystemProviders();
      if (patch.source === 'provider' || (!patch.source && resolved.source === 'provider')) {
        const providerId = patch.provider ?? payload.provider ?? resolved.provider;
        if (providerId && !sysProviders[providerId]) {
          return rpcFailure(
            'unknown-provider',
            `提供商 "${providerId}" 未在 dsh 模型配置里定义。可用提供商：${Object.keys(sysProviders).join(', ') || '(none)'}`,
          );
        }
      }
      normalizeConfig({ source: patch.source ?? 'provider', ...patch }, {
        defaults: {
          provider: resolved.provider,
          baseURL: resolved.baseURL,
          model: resolved.model,
          size: resolved.size,
          quality: resolved.quality,
        },
      });
      if (patch.proxy !== undefined && patch.proxy !== '') {
        parseProxyUrl(patch.proxy, 'proxy');
      }

      writeSettingsFile(resolved.settingsFile, patch, { source: 'user-set' });
      return rpcOk({ ok: true, ...buildConfigView(resolved) });
    } catch (err) {
      return rpcFailure('save-failed', err.message);
    }
  }

  if (method === 'testConnection') {
    try {
      const overrides = {
        provider: typeof payload.provider === 'string' && payload.provider.trim() ? payload.provider.trim() : undefined,
        model: typeof payload.model === 'string' && payload.model.trim() ? payload.model.trim() : undefined,
        size: typeof payload.size === 'string' && payload.size.trim() ? payload.size.trim() : undefined,
        quality: typeof payload.quality === 'string' && payload.quality.trim() ? payload.quality.trim() : undefined,
        source: typeof payload.source === 'string' ? payload.source : undefined,
        baseURL: typeof payload.baseURL === 'string' && payload.baseURL.trim() ? payload.baseURL.trim() : undefined,
      };
      const effective = await computeEffective(resolved, overrides);
      const { token } = resolveApiKey(resolved, {
        apiKey: typeof payload.apiKey === 'string' && payload.apiKey.trim() ? payload.apiKey.trim() : undefined,
        apiKeyEnv: effective.apiKeyEnv,
        savedApiKey: effective.savedApiKey,
      });
      if (!token) return rpcFailure('unconfigured', '未找到可用的 API Key，请先在设置面板填写或配置环境变量');

      const testProxy = await resolveTestProxy(payload, resolved);
      const { generateImage } = await import('./image.js');
      const started = Date.now();
      const probePath = path.join(tmpdir(), 'dsh-image-gen', `probe-${Date.now()}.png`);
      const result = await generateImage({
        prompt: 'A single flat blue square, centered, plain background. Connection test.',
        baseURL: effective.baseURL,
        apiKey: token,
        model: effective.model,
        size: '512x512',
        quality: effective.quality,
        outputPath: probePath,
        headers: effective.headerOverrides,
        timeoutMs: Math.min(resolved.timeoutMs, 60000),
        proxy: testProxy === null || testProxy === undefined ? '' : testProxy.display,
        proxyHosts: resolved.proxyHosts,
      });
      return rpcOk({
        durationMs: Date.now() - started,
        via: testProxy ? `经代理 ${testProxy.display}` : '直连',
        model: effective.model,
        actualSize: result.actualSize,
        savePath: result.savePath,
      });
    } catch (err) {
      return rpcFailure('request-failed', err.message);
    }
  }

  return rpcFailure('unknown-method', '未知方法: ' + method);
}

/**
 * 挂载 Web 端设置路由（与 RPC 通道等价，供非 WebSocket 客户端使用）。
 * @param {Record<string, any>} ctx Cordis 上下文。
 * @param {Record<string, any>} resolved 插件配置。
 */
function setupWebRoutes(ctx, resolved) {
  if (typeof ctx?.inject !== 'function') return;
  ctx.inject(['webServer'], (webServerCtx) => {
    const ws = webServerCtx?.webServer;
    if (!ws || typeof ws.get !== 'function') return;

    const sendJson = (res, status, value) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(value));
    };
    const readBody = (req) =>
      new Promise((resolve) => {
        let raw = '';
        req.on('data', (chunk) => {
          raw += chunk;
        });
        req.on('end', () => {
          try {
            resolve(JSON.parse(raw || '{}'));
          } catch {
            resolve({});
          }
        });
      });

    ws.get('/api/dsh-image-gen/config', async (_req, res) => {
      try {
        sendJson(res, 200, { ok: true, value: buildConfigView(resolved) });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
    });

    ws.post('/api/dsh-image-gen/config', async (req, res) => {
      try {
        const body = await readBody(req);
        const result = await handleSettingsRpc(resolved, 'saveConfig', body);
        sendJson(res, result.ok ? 200 : 400, result);
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
    });

    ws.post('/api/dsh-image-gen/test', async (req, res) => {
      try {
        const body = await readBody(req);
        const result = await handleSettingsRpc(resolved, 'testConnection', body);
        sendJson(res, result.ok ? 200 : 400, result);
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
    });
  });
}

/**
 * Cordis 插件入口：注册生图工具、设置 RPC 通道与 Web 路由。
 * @param {Record<string, any>} ctx Cordis 上下文对象。
 * @param {Record<string, unknown>} [config] Profile 里的 config 段。
 */
export function apply(ctx, config) {
  const resolved = normalizePluginConfig(config);

  ctx.tools.register({
    name: TOOL_NAME,
    description: describeTool(),
    parameters: parametersFor(),
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => true,
    output: {
      schema: {
        type: 'object',
        required: ['savePath', 'model', 'requestedSize', 'actualSize', 'warnings'],
        properties: {
          savePath: { type: 'string', description: 'Absolute path of the saved image file.' },
          model: { type: 'string', description: 'The model that produced the image.' },
          requestedSize: { type: 'string', description: 'The size that was sent to the provider.' },
          actualSize: { type: 'string', description: 'The real pixel size read from the image bytes.' },
          warnings: {
            type: 'array',
            items: { type: 'string' },
            description: 'Non-fatal notes such as the provider ignoring the requested size.',
          },
        },
        description: 'Where the image landed, which model made it, its real size, and any warnings.',
      },
      render: renderResult,
    },
    execute: (args) => runGeneration(resolved, args),
  });

  if (ctx.connection && typeof ctx.connection.rpc?.handle === 'function') {
    ctx.connection.rpc.handle(
      SETTINGS_RPC_CHANNEL,
      (method, payload) => handleSettingsRpc(resolved, method, payload),
      { authority: 'trusted-host' },
    );
  }

  setupWebRoutes(ctx, resolved);
}

export { MAX_IMAGE_BYTES };
