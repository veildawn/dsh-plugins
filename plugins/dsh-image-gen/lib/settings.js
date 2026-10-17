/**
 * 插件的本地设置文件读写（前端「保存设置」落盘的位置）。
 *
 * 与 dsh 生图 MCP 的 image-config.json 不同，这里的设置文件保存的是**完整配置**：
 * 提供商/模型（或手写的 baseUrl/apiKey）、默认尺寸与画质、代理。
 * 每个字段都带来源标记，方便区分「用户设的值」与「插件填的默认值」。
 *
 * @module dsh-image-gen/settings
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_QUALITY, DEFAULT_SIZE, normalizeQuality, normalizeSize } from './image.js';

/** 默认设置文件位置。 */
export const DEFAULT_SETTINGS_PATH = path.join(homedir(), '.dsh', 'image-gen', 'settings.json');

/** 手写（manual）与下拉（provider）两种来源模式。 */
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
  if (typeof raw.model === 'string' && raw.model) out.model = raw.model;
  if (typeof raw.size === 'string' && raw.size) out.size = raw.size;
  if (typeof raw.quality === 'string' && raw.quality) out.quality = raw.quality;
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
  return filePath;
}

/**
 * 规范化一份「完整配置」：校验尺寸/画质/来源模式，返回可落盘的对象。
 *
 * @param {Record<string, unknown>} patch 前端或调用方给出的字段。
 * @param {{ defaults?: Record<string, unknown> }} [opts] 缺省值来源（插件 config + 推断值）。
 * @returns {{ source: string, provider: string, baseURL: string, model: string, size: string, quality: string, proxy: string, hasApiKey: boolean }}
 */
export function normalizeConfig(patch, opts = {}) {
  const defaults = opts.defaults ?? {};
  const sourceRaw = patch.source ?? defaults.source;
  const source = sourceRaw === 'manual' ? 'manual' : 'provider';
  const provider = String(patch.provider ?? defaults.provider ?? '').trim();
  const baseURL = String(patch.baseURL ?? defaults.baseURL ?? '').trim();
  const model = String(patch.model ?? defaults.model ?? '').trim();
  const size = normalizeSize(patch.size ?? defaults.size);
  const quality = normalizeQuality(patch.quality ?? defaults.quality);
  const proxy = String(patch.proxy ?? defaults.proxy ?? '').trim();

  if (source === 'provider' && !provider) {
    throw new Error('provider is required when source is "provider"');
  }
  if (source === 'manual' && !baseURL) {
    throw new Error('baseURL is required when source is "manual"');
  }
  if (!model) {
    throw new Error('model is required');
  }
  return { source, provider, baseURL, model, size, quality, proxy, hasApiKey: false };
}

/**
 * 判断设置文件里的值是用户设的、还是工具推断的。
 *
 * 三种状态必须分开报：文件不存在（还没配过）、文件损坏（读了但解析不了，
 * 等于没配）、文件可读（用户设的值）。把损坏的文件说成「用户已设置」会误导
 * 用户以为自己配过，从而错过真正的配置步骤。
 *
 * @param {string} filePath 文件路径。
 * @returns {string} 来源描述。
 */
export function describeConfigSource(filePath) {
  if (!existsSync(filePath)) return 'inferred (no settings file yet)';
  const raw = readSettingsFile(filePath);
  if (raw === null) return 'inferred (the settings file is unreadable; the defaults are in effect)';
  if (typeof raw._source === 'string') return raw._source;
  return 'user-set (settings file exists, no _source marker)';
}

export { DEFAULT_SIZE, DEFAULT_QUALITY };
