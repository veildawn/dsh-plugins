/**
 * 插件的本地设置文件读写（前端「保存设置」落盘的位置）。
 *
 * 设置文件保存的是**完整配置**：来源模式（dsh 已配置的提供商 / 手动配置）、
 * 提供商与模型、手写 baseUrl 与 API Key、默认端点、代理。
 *
 * 路径约定：
 *   - 新位置：~/.dsh/jev/settings.json（默认写入位置）；
 *   - 旧位置：~/.config/typesafe/settings.json（早期版本写入的位置，继续只读兼容）。
 *     只有使用默认路径时才会合并旧文件；测试或 Profile 显式指定 settingsFile 时
 *     只读那一个文件，避免读到开发机上的真实用户配置。
 *
 * @module dsh-jev/settings
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

/** 默认设置文件位置。 */
export const DEFAULT_SETTINGS_PATH = path.join(homedir(), '.dsh', 'jev', 'settings.json');

/** 早期版本（TypeSafe 专属时期）写入的设置文件位置，仅用于读取兼容。 */
export const LEGACY_SETTINGS_PATH = path.join(homedir(), '.config', 'typesafe', 'settings.json');

/** 两种配置来源模式。 */
export const SOURCE_MODES = ['provider', 'manual'];

/**
 * 把设置文件路径展开成绝对路径（支持 `~/`）。
 * @param {string | undefined} value 配置里的路径。
 * @returns {string}
 */
export function resolveSettingsPath(value) {
  if (typeof value !== 'string' || value.trim() === '') return DEFAULT_SETTINGS_PATH;
  const trimmed = value.trim();
  if (trimmed === '~' || trimmed.startsWith('~/')) {
    return path.join(homedir(), trimmed.slice(1));
  }
  return path.resolve(trimmed);
}

/**
 * 读取设置文件；缺失、损坏或字段类型不对时返回 null（由调用方决定兜底）。
 * @param {string} filePath 文件路径。
 * @returns {Record<string, unknown> | null}
 */
export function readSettingsFile(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 读取当前生效的设置：默认路径时把旧位置的文件作为底层（新文件覆盖旧文件）。
 *
 * @param {string} [primaryPath] 主设置文件路径（默认 DEFAULT_SETTINGS_PATH）。
 * @returns {{ values: Record<string, unknown>, path: string, legacyPath: string | null, hasFile: boolean }}
 */
export function loadUserSettings(primaryPath) {
  const filePath = primaryPath && String(primaryPath).trim() !== '' ? primaryPath : DEFAULT_SETTINGS_PATH;
  const primary = readSettingsFile(filePath);
  if (filePath !== DEFAULT_SETTINGS_PATH) {
    return { values: primary ?? {}, path: filePath, legacyPath: null, hasFile: primary !== null };
  }
  const legacy = readSettingsFile(LEGACY_SETTINGS_PATH);
  if (legacy === null) {
    return { values: primary ?? {}, path: filePath, legacyPath: null, hasFile: primary !== null };
  }
  return {
    values: { ...legacy, ...(primary ?? {}) },
    path: filePath,
    legacyPath: LEGACY_SETTINGS_PATH,
    hasFile: true,
  };
}

/**
 * 从设置文件里取出模型化的配置（只保留认识的字段）。
 * 默认不提取敏感字段（如 apiKey），若后台执行请求需使用敏感字段，传 opts.includeSecrets = true。
 * @param {Record<string, unknown> | null} raw 原始 JSON。
 * @param {{ includeSecrets?: boolean }} [opts] 是否包含机密字段。
 * @returns {Record<string, unknown>} 提取结果。
 */
export function pickConfig(raw, opts = {}) {
  const out = {};
  if (!raw) return out;
  if (typeof raw.source === 'string') out.source = raw.source;
  if (typeof raw.provider === 'string' && raw.provider) out.provider = raw.provider;
  if (typeof raw.baseURL === 'string' && raw.baseURL) out.baseURL = raw.baseURL;
  if (typeof raw.endpoint === 'string' && raw.endpoint) out.endpoint = raw.endpoint;
  if (typeof raw.model === 'string' && raw.model) out.model = raw.model;
  if (typeof raw.proxy === 'string') out.proxy = raw.proxy;
  if (opts.includeSecrets === true && typeof raw.apiKey === 'string' && raw.apiKey) {
    out.apiKey = raw.apiKey;
  }
  return out;
}

/**
 * 合并写入设置文件（保留其它未知字段）。
 * 设置严格文件权限（0600），防止敏感配置（如 API Key）被其他本地用户读取。
 * @param {string} filePath 文件路径。
 * @param {Record<string, unknown>} patch 需要写入的字段。
 * @param {{ source?: string }} [opts] 是否写入来源标记。
 * @returns {string} 实际写入路径。
 */
export function writeSettingsFile(filePath, patch, opts = {}) {
  const current = readSettingsFile(filePath) ?? {};
  const next = { ...current, ...patch };
  if (typeof opts.source === 'string') next._source = opts.source;
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  // 文件已存在时 writeFileSync 的 mode 不生效：设置里可能含 API Key，强制收紧权限。
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // 某些文件系统（如 Windows 挂载）不支持 chmod，忽略即可
  }
  return filePath;
}

/**
 * 判断设置文件里的值是用户设的、还是插件推断的。
 *
 * 三种状态必须分开报：文件不存在（还没配过）、文件损坏（读了但解析不了，
 * 等于没配）、文件可读（用户设的值）。把损坏的文件说成「用户已设置」会误导
 * 用户以为自己配过，从而错过真正的配置步骤。
 *
 * @param {{ values: Record<string, unknown>, path: string, legacyPath: string | null, hasFile: boolean }} loaded
 * @returns {string} 来源描述。
 */
export function describeConfigSource(loaded) {
  if (!loaded.hasFile) return 'inferred (no settings file yet)';
  if (loaded.values && typeof loaded.values._source === 'string') return loaded.values._source;
  return loaded.legacyPath
    ? 'user-set (merged with the legacy settings file)'
    : 'user-set (settings file exists, no _source marker)';
}
