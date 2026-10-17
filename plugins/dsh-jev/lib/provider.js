/**
 * dsh 已配置提供商的读取层。
 *
 * dsh 0.1.x 把 provider 放在 ~/.dsh/settings.yaml；0.2.x 起改为 profile 配置层
 * (~/.dsh/profiles/<profile>/cordis*.yml 里的 llm-pi-ai 行)。这里两种来源都读，
 * profile 层优先（与 dsh 自身一致），于是插件在设置面板里能直接列出「dsh 已配置
 * 的提供商与模型」，不必让用户重复手写 baseUrl / key。
 *
 * 设计约束（与本仓库其它插件一致）：
 *   - 零 npm 依赖：js-yaml 通过 createRequire 从宿主 dsh 安装里解析，
 *     解析失败时退回内置的极简 YAML 子集解析器，保证插件永远能列出提供商。
 *   - 只读：绝不改写 dsh 自己的配置与凭证文件。
 *
 * @module dsh-jev/provider
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** dsh 配置里出现的自定义标签：js-yaml 默认 schema 遇到未知标签会直接抛错。 */
const JS_TAGS = ['tag:yaml.org,2002:js', 'tag:yaml.org,2002:js/function'];

/** 便于测试注入的家目录。 */
export const DSH_HOME = process.env.DSH_HOME
  ? String(process.env.DSH_HOME)
  : join(homedir(), '.dsh');

/** 便于测试注入的 profile 名。 */
export function activeProfile(env = process.env) {
  return env.DSH_PROFILE ? String(env.DSH_PROFILE) : 'web';
}

/**
 * 解析 js-yaml。
 *
 * 顺序：
 *   1. 以 `from`（调用方指定的文件）为基准解析；
 *   2. 以本插件在 profile 里的安装位置为基准解析；
 *   3. 以本文件自身位置为基准解析；
 *   4. 直接定位全局 dsh 安装里的 node_modules/js-yaml（用 node 可执行文件的
 *      安装根推断，不写死任何绝对路径）。
 *
 * 全失败就返回 null，调用方退到内置的 YAML 子集解析器。之所以值得多试几次：
 * js-yaml 不是本插件的依赖（本仓库所有插件都不带它），它只存在于 dsh 的安装里，
 * 而从 tar 解包出来的临时目录是解析不到的。
 *
 * @param {string} [from] 以哪个文件为基准解析（默认本文件）。
 * @returns {object | null} js-yaml 模块，或 null。
 */
export function loadYamlModule(from) {
  const candidates = [];
  if (from) candidates.push(from);
  candidates.push(join(DSH_HOME, 'profiles', activeProfile(), 'node_modules', 'dsh-jev', 'lib', 'index.js'));
  candidates.push(fileURLToPath(import.meta.url));
  for (const base of candidates) {
    try {
      const require = createRequire(base);
      const mod = require('js-yaml');
      if (mod && typeof mod.load === 'function') return mod;
    } catch {
      /* try the next candidate */
    }
  }
  // 兜底：在 node 全局安装目录下找 @deepseek-ai/dsh 自带的 js-yaml
  for (const dir of globalDshNodeModules()) {
    try {
      const mod = createRequire(join(dir, 'js-yaml', 'index.js'))('js-yaml');
      if (mod && typeof mod.load === 'function') return mod;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/**
 * 推断全局 dsh 安装的 node_modules 目录。
 *
 * 用 `process.execPath`（node 可执行文件）推断 npm 全局安装根，不写死任何绝对路径。
 * @returns {string[]} 候选目录列表。
 */
function globalDshNodeModules() {
  const roots = [];
  // <node-bin-dir>/../lib/node_modules 是典型的全局安装布局
  const execDir = dirname(process.execPath);
  const nodeModules = join(execDir, '..', 'lib', 'node_modules');
  roots.push(join(nodeModules, '@deepseek-ai', 'dsh', 'node_modules'));
  // 其它常见布局
  roots.push(join(execDir, '..', 'node_modules'));
  roots.push(join(homedir(), '.npm-global', 'lib', 'node_modules'));
  // 从 PATH 里的 npm 反推
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    if (!entry) continue;
    roots.push(join(entry, '..', 'lib', 'node_modules'));
  }
  return Array.from(new Set(roots));
}

/**
 * 把一个标量的引号与行内注释去掉。
 * @param {string} raw 原始标量文本。
 * @returns {string} 清理后的值。
 */
function stripScalar(raw) {
  let value = raw.trim();
  // 去掉未加引号值尾部的行内注释（# 前必须有空白，避免破坏 URL 里的 #）
  const hash = value.search(/\s#/);
  if (hash !== -1 && !/^["']/.test(value)) value = value.slice(0, hash).trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      value = value.slice(1, -1);
    }
  }
  return value;
}

/**
 * 极简 YAML 子集解析器：只覆盖 dsh provider 配置用到的语法
 * （嵌套映射、`- id: xxx` 列表项、字符串标量）。仅在 js-yaml 不可用时兜底。
 * @param {string} text YAML 文本。
 * @returns {unknown} 解析结果。
 */
function parseSimpleYaml(text) {
  const lines = text.split(/\r?\n/);
  let index = 0;

  /** 当前行的缩进宽度。 */
  const indentOf = (line) => {
    const match = /^[ \t]*/.exec(line);
    return match ? match[0].replace(/\t/g, '  ').length : 0;
  };
  const isSkippable = (line) => {
    const trimmed = line.trim();
    return trimmed === '' || trimmed.startsWith('#') || trimmed === '---' || trimmed === '...';
  };

  /** 解析一个块（映射或列表），返回 [值, 下一行下标]。 */
  function parseBlock(minIndent) {
    // 先找到第一个有效行，判断这是映射还是列表
    while (index < lines.length && isSkippable(lines[index])) index += 1;
    if (index >= lines.length) return [null, index];
    const indent = indentOf(lines[index]);
    if (indent < minIndent) return [null, index];
    const trimmed = lines[index].trim();
    if (trimmed.startsWith('- ') || trimmed === '-') {
      return parseList(indent);
    }
    return parseMap(indent);
  }

  function parseList(indent) {
    const items = [];
    while (index < lines.length) {
      if (isSkippable(lines[index])) {
        index += 1;
        continue;
      }
      const line = lines[index];
      if (indentOf(line) !== indent || !line.trim().startsWith('-')) break;
      const rest = line.trim().slice(1).trim();
      index += 1;
      if (rest === '') {
        const [value] = parseBlock(indent + 1);
        items.push(value);
        continue;
      }
      // `- id: xxx` 形式：列表项本身是一个映射，剩余键与它同缩进
      const colon = rest.indexOf(':');
      if (colon === -1) {
        items.push(stripScalar(rest));
        continue;
      }
      const itemIndent = indentOf(line) + 2;
      const map = {};
      const key = rest.slice(0, colon).trim();
      const value = rest.slice(colon + 1).trim();
      if (value === '') {
        const [child] = parseBlock(itemIndent + 1);
        map[key] = child;
      } else {
        map[key] = stripScalar(value);
      }
      // 吸收同一列表项的后续键（缩进等于 itemIndent 且不是新的 `-`）
      while (index < lines.length) {
        if (isSkippable(lines[index])) {
          index += 1;
          continue;
        }
        const next = lines[index];
        if (indentOf(next) !== itemIndent || next.trim().startsWith('-')) break;
        const [nested, nextIndex] = parseMap(itemIndent);
        Object.assign(map, nested);
        index = nextIndex;
      }
      items.push(map);
    }
    return [items, index];
  }

  function parseMap(indent) {
    const map = {};
    while (index < lines.length) {
      if (isSkippable(lines[index])) {
        index += 1;
        continue;
      }
      const line = lines[index];
      if (indentOf(line) !== indent) break;
      const trimmed = line.trim();
      if (trimmed.startsWith('- ')) break;
      const colon = trimmed.indexOf(':');
      if (colon === -1) {
        index += 1;
        continue;
      }
      const key = trimmed.slice(0, colon).trim();
      const value = trimmed.slice(colon + 1).trim();
      index += 1;
      if (value === '' || value === '|' || value === '>') {
        const [child] = parseBlock(indent + 1);
        map[key] = child;
      } else {
        map[key] = stripScalar(value);
      }
    }
    return [map, index];
  }

  const [value] = parseBlock(0);
  return value;
}

/**
 * 加载一份 dsh YAML 配置。js-yaml 可用时走完整解析；否则退回子集解析器。
 * 自定义 `!!js` 标签在两条路径上都被当作普通标量，不会抛错。
 * @param {string} text YAML 文本。
 * @returns {unknown} 解析结果。
 */
export function loadDshYaml(text) {
  const mod = loadYamlModule();
  if (mod) {
    try {
      return mod.load(text);
    } catch {
      // js-yaml 对未知标签敏感：这里显式把 !!js 系列声明为标量后再试一次
      try {
        const schema = mod.DEFAULT_SCHEMA.extend(
          JS_TAGS.map((tag) => new mod.Type(tag, { kind: 'scalar', construct: (data) => data })),
        );
        return mod.load(text, { schema });
      } catch {
        return parseSimpleYaml(text);
      }
    }
  }
  return parseSimpleYaml(text);
}

/**
 * 递归扫描任意 dsh 配置文档，收集 llm-pi-ai 行的 providers 定义。
 * @param {unknown} node 文档节点。
 * @param {Record<string, unknown>} out 收集容器。
 * @returns {Record<string, unknown>} 同一个容器。
 */
export function collectProviderBlocks(node, out = {}) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectProviderBlocks(item, out);
    return out;
  }
  const record = /** @type {Record<string, any>} */ (node);
  const isLlmRow = record.id === 'llm-pi-ai' || record.name === '@deepseek-ai/dsh-llm-pi-ai';
  if (isLlmRow && record.config && record.config.providers) {
    Object.assign(out, record.config.providers);
  } else if (record['llm-pi-ai'] && record['llm-pi-ai'].providers) {
    Object.assign(out, record['llm-pi-ai'].providers);
  }
  for (const value of Object.values(record)) collectProviderBlocks(value, out);
  return out;
}

/**
 * 参与读取的配置文件列表，顺序即优先级（后面的覆盖前面的）。
 * @param {{ dshHome?: string, profile?: string }} [opts]
 * @returns {string[]} 文件绝对路径。
 */
export function providerConfigSources(opts = {}) {
  const dshHome = opts.dshHome ?? DSH_HOME;
  const profile = opts.profile ?? activeProfile();
  // 旧来源放在前面作为兜底；profile 层放在后面，确保当前生效的 profile 优先（后面的覆盖前面的）
  const sources = [
    join(dshHome, 'settings.yaml'),
    join(dshHome, 'settings.yaml.imported'),
  ];
  try {
    const profileDir = join(dshHome, 'profiles', profile);
    for (const file of readdirSync(profileDir).sort()) {
      if (/^cordis.*\.ya?ml$/.test(file)) sources.push(join(profileDir, file));
    }
  } catch {
    /* profile 目录不存在时跳过 */
  }
  return sources;
}

/**
 * 只收集 profile 配置层里的提供商（不含 settings.yaml 等历史来源）。
 * @param {{ dshHome?: string, profile?: string }} [opts]
 * @returns {Record<string, any>}
 */
export function getProfileProviders(opts = {}) {
  const dshHome = opts.dshHome ?? DSH_HOME;
  const profile = opts.profile ?? activeProfile();
  const raw = {};
  try {
    const profileDir = join(dshHome, 'profiles', profile);
    for (const file of readdirSync(profileDir).sort()) {
      if (!/^cordis.*\.ya?ml$/.test(file)) continue;
      try {
        collectProviderBlocks(loadDshYaml(readFileSync(join(profileDir, file), 'utf8')), raw);
      } catch {
        // 单个文件读失败不影响其它来源
      }
    }
  } catch {
    /* profile 目录不存在 */
  }
  return finalizeProviders(raw);
}

/**
 * 把收集到的原始 providers 规范化成统一结构。
 *
 * 每个模型条目保留 `input`（模态）、`type`（pi-ai 模型类型）与 `api`（协议）
 * 三个结构化字段：它们比模型名字更可靠地描述「这个模型能不能做决策」。
 *
 * @param {Record<string, any>} raw 原始定义。
 * @returns {Record<string, any>}
 */
function finalizeProviders(raw) {
  const result = {};
  for (const [id, conf] of Object.entries(raw)) {
    if (!conf || typeof conf !== 'object') continue;
    const routeApi = typeof conf.api === 'string' ? conf.api.trim() : '';
    const modelInfo = (Array.isArray(conf.models) ? conf.models : [])
      .map((entry) => normalizeModelEntry(entry, routeApi))
      .filter((entry) => entry !== null)
      .map((entry) => ({ ...entry, decisionModel: isDecisionModelEntry(entry, routeApi) }));
    const models = modelInfo.map((entry) => entry.id);
    result[id] = {
      id,
      name: typeof conf.displayName === 'string' && conf.displayName ? conf.displayName : id,
      baseURL: typeof conf.baseURL === 'string' ? conf.baseURL : '',
      apiKeyEnv: typeof conf.apiKeyEnv === 'string' ? conf.apiKeyEnv : '',
      api: routeApi,
      headers: conf.headers && typeof conf.headers === 'object' ? { ...conf.headers } : {},
      models,
      decisionModels: modelInfo.filter((entry) => entry.decisionModel).map((entry) => entry.id),
      modelInfo,
    };
  }
  return result;
}

/**
 * pi-ai 中结构化决策/分类模型（classifier）的协议标识。
 *
 * 对应 `@earendil-works/pi-ai` 的 `KnownClassifierApi`：这类模型只能通过
 * `classify()` 调用，返回强类型概率结果，正是 jev_decide 需要的形态。
 */
export const CLASSIFIER_APIS = new Set([
  'typesafe-system-one',
  'cloudflare-workers-ai-system-one',
  'llama-cpp-classify',
  'openai-decisions',
]);

/** 已知的输入模态；除此之外的模态值被视为模型自带的决策能力声明。 */
const KNOWN_INPUT_MODALITIES = new Set(['text', 'image']);

/**
 * 判断一个模型 id 是否像决策模型（名字层面的兜底判断）。
 *
 * 决策模型通常是 jev / systemone / decision / classifier 这类名字。这里只用于
 * 设置面板分组，选错模型也不会被插件阻止。
 * @param {string} model 模型 id 或展示名。
 * @returns {boolean}
 */
export function isDecisionModel(model) {
  return typeof model === 'string' && /(^|[^a-z0-9])(jev|systemone|system-?one|decision|classifier|noul|predicate)([^a-z0-9]|$)/i.test(model);
}

/**
 * 规范化一个模型条目（兼容 `- id` 对象与裸字符串两种写法）。
 *
 * `modality` 不是 dsh 模型 schema 的正式字段（官方只有 id/name/contextWindow/
 * maxTokens/input/reasoningEfforts/compat），但 schemastery 会原样保留未知键，
 * 所以静态配置里可以写 `modality: decision`；插件读的是 YAML 原文，能直接拿到。
 *
 * @param {any} entry 原始条目。
 * @param {string} routeApi provider 级协议。
 * @returns {{ id: string, name: string, input: string[], modality: string, type: string, api: string } | null}
 */
function normalizeModelEntry(entry, routeApi) {
  if (typeof entry === 'string') {
    return { id: entry.trim(), name: '', input: [], modality: '', type: '', api: routeApi };
  }
  if (!entry || typeof entry !== 'object') return null;
  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  if (id === '') return null;
  return {
    id,
    name: typeof entry.name === 'string' ? entry.name.trim() : '',
    input: Array.isArray(entry.input)
      ? entry.input.map((m) => String(m).trim().toLowerCase()).filter((m) => m !== '')
      : [],
    modality: typeof entry.modality === 'string' ? entry.modality.trim().toLowerCase() : '',
    type: typeof entry.type === 'string' ? entry.type.trim().toLowerCase() : '',
    api: typeof entry.api === 'string' && entry.api.trim() !== '' ? entry.api.trim() : routeApi,
  };
}

/**
 * 综合结构化字段判断一个模型条目是否是决策模型。
 *
 * 判断顺序：
 *   0. 条目显式声明了 `modality`（与 `/v1/models` 同名字段）——它是最高优先级的覆盖，
 *      `modality: decision` 即为决策模型，`modality: text` / `image` 则明确排除；
 *   1. 协议属于 pi-ai 的 classifier 协议（typesafe-system-one 等）；
 *   2. 条目显式声明 `type: classifier`；
 *   3. id 或展示名命中决策模型命名规则；
 *   4. 声明了已知模态之外的输入模态（未来扩展，如 `decision`）。
 *
 * 只声明显式的 `input: ['text']` 不会被当成决策模型——普通聊天模型也是纯文本，
 * 那样会把整个模型列表都吞进「决策模型」分组。
 *
 * @param {{ id?: string, name?: string, input?: string[], modality?: string, type?: string, api?: string } | null} entry 模型条目。
 * @param {string} [routeApi] provider 级协议。
 * @returns {boolean}
 */
export function isDecisionModelEntry(entry, routeApi = '') {
  if (!entry || typeof entry !== 'object') return false;
  const declaredModality = String(entry.modality || '').trim().toLowerCase();
  if (declaredModality !== '') return declaredModality === 'decision';
  const api = String(entry.api || routeApi || '').toLowerCase();
  if (CLASSIFIER_APIS.has(api)) return true;
  if (String(entry.type || '').toLowerCase() === 'classifier') return true;
  for (const candidate of [entry.id, entry.name]) {
    if (isDecisionModel(candidate)) return true;
  }
  const input = Array.isArray(entry.input) ? entry.input : [];
  if (input.some((modality) => !KNOWN_INPUT_MODALITIES.has(modality))) return true;
  return false;
}

/**
 * 读取 dsh 自身配置的所有提供商。
 * @param {{ dshHome?: string, profile?: string }} [opts]
 * @returns {Record<string, { id: string, name: string, baseURL: string, apiKeyEnv: string, api: string, headers: Record<string,string>, models: string[], decisionModels: string[], modelInfo: Array<{ id: string, name: string, input: string[], type: string, api: string, decisionModel: boolean }> }>}
 */
export function getDshSystemProviders(opts = {}) {
  const raw = {};
  for (const file of providerConfigSources(opts)) {
    try {
      if (!existsSync(file)) continue;
      collectProviderBlocks(loadDshYaml(readFileSync(file, 'utf8')), raw);
    } catch {
      // 单个配置文件读失败不应影响其它来源
    }
  }
  return finalizeProviders(raw);
}

/**
 * 读取 ~/.dsh/.credentials.yaml 的 refs 段（凭证文件优先于环境变量）。
 * @param {{ dshHome?: string }} [opts]
 * @returns {Record<string, string>}
 */
export function getCredentials(opts = {}) {
  const dshHome = opts.dshHome ?? DSH_HOME;
  const path = join(dshHome, '.credentials.yaml');
  const creds = {};
  try {
    if (!existsSync(path)) return creds;
    const parsed = loadDshYaml(readFileSync(path, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.refs && typeof parsed.refs === 'object') {
      for (const [key, value] of Object.entries(parsed.refs)) {
        if (typeof value === 'string') creds[key] = value;
      }
    }
  } catch {
    // 凭证读不出来时不致命：调用方会继续尝试环境变量
  }
  return creds;
}

/**
 * 常见 API Key 环境变量兜底名单。
 *
 * 只在「provider 完全没有声明 apiKeyEnv」时才作为最后手段使用：这些是通用的
 * Jev / OpenAI / DeepSeek 变量名。一旦 provider 声明了自己的 apiKeyEnv，就只用
 * 那一个名字，绝不旁落到别人的凭证上——否则 A 提供商缺 key 时会静默用上 B 提供
 * 商的 token，把「key 配错了」伪装成「服务连不上」，很难排查。
 */
export const FALLBACK_KEY_ENVS = ['TYPESAFE_API_KEY', 'JEV_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY'];

/**
 * 解析提供商可用的 API Token。
 *
 * 优先级：.credentials.yaml > 环境变量（与 dsh 自身的行为一致）。
 *
 * @param {{ apiKeyEnv?: string, apiKey?: string }} providerConf 提供商配置。
 * @param {{ dshHome?: string, env?: Record<string, string | undefined> }} [opts]
 * @returns {{ token: string, from: string }}
 */
export function resolveToken(providerConf, opts = {}) {
  const creds = getCredentials(opts);
  const env = opts.env ?? process.env;
  const declared = providerConf && typeof providerConf.apiKeyEnv === 'string' && providerConf.apiKeyEnv.trim()
    ? [providerConf.apiKeyEnv.trim()]
    : [];
  // provider 声明了 apiKeyEnv 就只用它；没声明才退到通用变量名
  const names = declared.length > 0 ? declared : [...FALLBACK_KEY_ENVS];
  for (const name of names) {
    if (creds[name]) return { token: creds[name], from: 'credentials:' + name };
  }
  for (const name of names) {
    const value = env[name];
    if (typeof value === 'string' && value.trim() !== '') return { token: value.trim(), from: 'env:' + name };
  }
  return { token: '', from: 'none' };
}

/**
 * 推断一个默认的提供商。
 *
 * 选择顺序：
 *   1. profile 配置层（当前生效的部署）里带决策模型的提供商；
 *   2. 其它来源（settings.yaml / settings.yaml.imported，可能是历史遗留文件）
 *      里带决策模型的提供商；
 *   3. profile 层的第一个提供商；
 *   4. 任何第一个提供商。
 *
 * @param {{ dshHome?: string, profile?: string }} [opts]
 * @returns {{ provider: string, model: string }}
 */
export function inferDefaultProvider(opts = {}) {
  const fromProfile = getProfileProviders(opts);
  const profileIds = Object.keys(fromProfile);
  const profileWithDecisions = profileIds.find((id) => fromProfile[id].decisionModels.length > 0);
  if (profileWithDecisions) {
    return { provider: profileWithDecisions, model: fromProfile[profileWithDecisions].decisionModels[0] };
  }

  // profile 层没有决策模型时，再看旧来源（settings.yaml 等）里有没有
  const legacy = getDshSystemProviders(opts);
  const legacyWithDecisions = Object.keys(legacy).find((id) => legacy[id].decisionModels.length > 0);
  if (legacyWithDecisions) {
    return { provider: legacyWithDecisions, model: legacy[legacyWithDecisions].decisionModels[0] };
  }

  const fallbackProvider = profileIds[0] ?? Object.keys(legacy)[0] ?? '';
  return { provider: fallbackProvider, model: 'jev-latest' };
}

/** 便于测试与诊断：导出内置解析器与识别函数。 */
export const _internals = { parseSimpleYaml, stripScalar, JS_TAGS, normalizeModelEntry, isDecisionModelEntry };
