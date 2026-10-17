/**
 * 生图核心：请求、落盘、格式归一化与真实尺寸读取。
 *
 * 与 dsh 生图 MCP (~/.dsh/mcp/image-mcp-server.cjs) 的关键差异：
 *   - 不依赖 @modelcontextprotocol/sdk：原生注册为 ctx.tools 工具；
 *   - 增加 quality 参数与尺寸白名单校验；
 *   - 同样按真实字节格式决定扩展名，并从字节头读真实像素尺寸
 *     （provider 经常忽略请求的 size，元数据不能复述请求值）。
 *
 * @module dsh-image-gen/image
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseProxyUrl, proxyTargetsUrl, requestViaProxy } from './proxy.js';

/** 允许的图片扩展名。 */
export const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/** 尺寸下拉可选项（常见文生图比例）。 */
export const SIZE_OPTIONS = [
  { value: '1024x1024', label: '1024 × 1024（方形 1:1）' },
  { value: '1024x1792', label: '1024 × 1792（竖版 9:16）' },
  { value: '1792x1024', label: '1792 × 1024（横版 16:9）' },
  { value: '1024x1536', label: '1024 × 1536（竖版 2:3）' },
  { value: '1536x1024', label: '1536 × 1024（横版 3:2）' },
  { value: '512x512', label: '512 × 512（小图 1:1）' },
  { value: '1024x768', label: '1024 × 768（横版 4:3）' },
  { value: '768x1024', label: '768 × 1024（竖版 3:4）' },
  { value: 'auto', label: 'auto（由模型决定）' },
];

/** 画质下拉可选项。 */
export const QUALITY_OPTIONS = [
  { value: 'auto', label: 'auto（默认）' },
  { value: 'standard', label: 'standard（标准）' },
  { value: 'high', label: 'high（高）' },
  { value: 'hd', label: 'hd（高清）' },
  { value: 'medium', label: 'medium（中）' },
  { value: 'low', label: 'low（低/快）' },
];

/** 默认尺寸与画质。 */
export const DEFAULT_SIZE = '1024x1024';
export const DEFAULT_QUALITY = 'auto';

/**
 * 校验尺寸参数：`WxH`（两位以上数字）或 `auto`。
 * @param {string} value 候选尺寸。
 * @returns {string} 规范化后的尺寸。
 */
export function normalizeSize(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_SIZE;
  const text = String(value).trim().toLowerCase();
  if (text === 'auto' || text === 'default') return 'auto';
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(text);
  if (!match) {
    throw new Error(
      'size must look like "1024x1024" or "auto" (got "' + value + '"). Available: ' +
        SIZE_OPTIONS.map((option) => option.value).join(', '),
    );
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 64 || height < 64 || width > 8192 || height > 8192) {
    throw new Error('size dimensions must be between 64 and 8192 pixels (got "' + value + '")');
  }
  return `${width}x${height}`;
}

/**
 * 校验画质参数（大小写不敏感，空值表示 auto）。
 * @param {string} value 候选画质。
 * @returns {string} 规范化后的画质。
 */
export function normalizeQuality(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_QUALITY;
  const text = String(value).trim().toLowerCase();
  if (text === 'auto' || text === 'default') return 'auto';
  const allowed = QUALITY_OPTIONS.map((option) => option.value);
  if (!allowed.includes(text)) {
    throw new Error('quality must be one of ' + allowed.join(', ') + ' (got "' + value + '")');
  }
  return text;
}

/**
 * 从字节头嗅探真实 MIME。
 * @param {Buffer} buffer 图片字节。
 * @returns {string} MIME 或空字符串。
 */
export function sniffMime(buffer) {
  if (!Buffer.isBuffer(buffer)) return '';
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return '';
}

/**
 * 真实 MIME 对应的扩展名。
 * @param {string} mime MIME。
 * @returns {string} 扩展名（含点）。
 */
export function extForMime(mime) {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  return '.jpg';
}

/**
 * 从字节头读真实像素尺寸（provider 经常忽略请求的 size）。
 * @param {Buffer} buffer 图片字节。
 * @returns {{ width: number, height: number } | null}
 */
export function imageSize(buffer) {
  try {
    // PNG: 8 字节签名 + IHDR，宽高在 16..24
    if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    // WebP（VP8X / VP8L / VP8）
    if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
      const fourcc = buffer.toString('ascii', 12, 16);
      if (fourcc === 'VP8X') {
        return {
          width: (buffer.readUIntLE(24, 3) & 0xffffff) + 1,
          height: (buffer.readUIntLE(27, 3) & 0xffffff) + 1,
        };
      }
      if (fourcc === 'VP8L') {
        const bits = buffer.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (fourcc === 'VP8 ') {
        return {
          width: buffer.readUInt16LE(26) & 0x3fff,
          height: buffer.readUInt16LE(28) & 0x3fff,
        };
      }
    }
    // JPEG: 扫描 SOF 段
    if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buffer.length) {
        if (buffer[i] !== 0xff) {
          i += 1;
          continue;
        }
        const marker = buffer[i + 1];
        if (marker === 0xff) {
          i += 1;
          continue;
        }
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
          i += 2;
          continue;
        }
        const len = buffer.readUInt16BE(i + 2);
        if (len < 2) break;
        const isSof =
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf);
        if (isSof && i + 9 < buffer.length) {
          return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
        }
        if (marker === 0xda) break;
        i += 2 + len;
      }
    }
  } catch {
    // 解析失败就算了：返回 null，由调用方写 "(unknown)"
  }
  return null;
}

/**
 * 决定最终落盘路径：扩展名与实际格式不符时改写扩展名，避免写出「撒谎的后缀」。
 * @param {string | undefined} requestedPath 调用方请求的路径。
 * @param {string} mime 真实 MIME。
 * @param {string} [cwd] 基准目录。
 * @returns {string} 绝对路径。
 */
export function resolveSavePath(requestedPath, mime, cwd = process.cwd()) {
  const ext = extForMime(mime);
  if (!requestedPath) return path.join(cwd, `generated-${Date.now()}${ext}`);
  const abs = path.resolve(cwd, requestedPath);
  const currentExt = path.extname(abs).toLowerCase();
  if (currentExt && ALLOWED_EXT.has(currentExt)) {
    if (currentExt === '.jpeg' && ext === '.jpg') return abs;
    return currentExt === ext ? abs : `${abs.slice(0, -currentExt.length)}${ext}`;
  }
  return `${abs}${ext}`;
}

/**
 * 把 baseURL 归一化成 `{origin}/v1` 形式。
 * @param {string} baseURL 原始地址。
 * @returns {string} 归一化后的地址。
 */
export function normalizeBaseURL(baseURL) {
  let base = String(baseURL ?? '').trim().replace(/\/+$/, '');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) base = `http://${base}`;
  if (!/\/v1$/i.test(base)) base = `${base}/v1`;
  return base;
}

/**
 * 从响应体里取出图片字节与声明 MIME。
 * 当响应为图片 URL 时，若配置了代理则通过代理下载，避免海外或受限 CDN 下载超时。
 * @param {any} first data[0] 条目。
 * @param {object} [opts]
 * @param {object} [opts.proxy] 代理对象。
 * @param {string[]} [opts.proxyHosts] 走代理的目标主机模式。
 * @param {number} [opts.timeoutMs] 超时时间。
 * @returns {Promise<{ buffer: Buffer, mime: string }>}
 */
export async function extractImage(first, opts = {}) {
  if (first && typeof first.url === 'string' && first.url) {
    const proxy = opts.proxy;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60000);
    let resp;
    try {
      if (proxy !== undefined && proxyTargetsUrl(first.url, opts.proxyHosts)) {
        resp = await requestViaProxy(first.url, { method: 'GET', signal: controller.signal }, proxy);
      } else {
        resp = await fetch(first.url, { signal: controller.signal });
      }
    } finally {
      clearTimeout(timeout);
    }
    if (!resp.ok) {
      throw new Error(`Failed to download image from URL ${first.url}: status ${resp.status}`);
    }
    return { buffer: Buffer.from(await resp.arrayBuffer()), mime: typeof first.mime_type === 'string' ? first.mime_type : '' };
  }
  if (first && typeof first.b64_json === 'string' && first.b64_json) {
    return {
      buffer: Buffer.from(first.b64_json, 'base64'),
      mime: typeof first.mime_type === 'string' ? first.mime_type : '',
    };
  }
  throw new Error('Response contained neither url nor b64_json');
}

/**
 * 把图片写到磁盘（必要时创建目录），返回真实格式信息。
 * @param {{ buffer: Buffer, mime: string }} image 图片字节与声明 MIME。
 * @param {string | undefined} outputPath 请求的路径。
 * @returns {{ savePath: string, mime: string, bytes: number, note: string }}
 */
export function saveImage(image, outputPath) {
  const actualMime = sniffMime(image.buffer) || image.mime || 'image/jpeg';
  const savePath = resolveSavePath(outputPath, actualMime);
  let note = '';
  if (outputPath) {
    const requestedExt = path.extname(String(outputPath)).toLowerCase();
    if (requestedExt && ALLOWED_EXT.has(requestedExt)) {
      const matches = extForMime(actualMime) === requestedExt || (requestedExt === '.jpeg' && actualMime === 'image/jpeg');
      if (!matches) note = `requested ${requestedExt} but the provider returned ${actualMime}; keeping the real format`;
    }
  }
  mkdirSync(path.dirname(savePath), { recursive: true });
  writeFileSync(savePath, image.buffer);
  return { savePath, mime: actualMime, bytes: image.buffer.length, note };
}

/**
 * 生成一张图片并落盘。
 *
 * @param {object} opts
 * @param {string} opts.prompt 提示词。
 * @param {string} opts.baseURL 提供商 baseURL。
 * @param {string} opts.apiKey Bearer Token。
 * @param {string} opts.model 模型 id。
 * @param {string} [opts.size] 尺寸。
 * @param {string} [opts.quality] 画质。
 * @param {string} [opts.outputPath] 输出路径。
 * @param {Record<string, string>} [opts.headers] 额外请求头。
 * @param {number} [opts.timeoutMs] 超时。
 * @param {number} [opts.n] 生成张数（默认 1）。
 * @param {string} [opts.proxy] 出站代理地址（空 = 直连）。
 * @param {string[]} [opts.proxyHosts] 走代理的目标主机模式（默认 ['*']）。
 * @returns {Promise<object>} 生成结果。
 */
export async function generateImage(opts) {
  const prompt = String(opts.prompt ?? '').trim();
  if (prompt === '') throw new Error('prompt must be a non-empty string');
  const apiKey = String(opts.apiKey ?? '').trim();
  if (apiKey === '') throw new Error('apiKey is required');
  const model = String(opts.model ?? '').trim();
  if (model === '') throw new Error('model is required');

  const size = normalizeSize(opts.size);
  const quality = normalizeQuality(opts.quality);
  const endpoint = `${normalizeBaseURL(opts.baseURL)}/images/generations`;

  const payload = { model, prompt, n: opts.n ?? 1 };
  if (size !== 'auto') payload.size = size;
  if (quality !== 'auto') payload.quality = quality;

  // 代理为空（或目标主机不在代理范围内）时走原生 fetch，行为与无代理完全一致。
  const proxy = parseProxyUrl(opts.proxy ?? '', 'proxy');
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...(opts.headers ?? {}),
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120000);
  const init = {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: controller.signal,
  };
  let resp;
  try {
    resp =
      proxy === undefined || !proxyTargetsUrl(endpoint, opts.proxyHosts)
        ? await fetch(endpoint, init)
        : await requestViaProxy(endpoint, init, proxy);
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Image API error (${resp.status}) from ${endpoint}: ${detail.slice(0, 500)}`);
  }

  const body = await resp.json();
  const first = body && Array.isArray(body.data) ? body.data[0] : null;
  if (!first) {
    throw new Error(`No image data returned from provider: ${JSON.stringify(body).slice(0, 500)}`);
  }

  const image = await extractImage(first, { proxy, proxyHosts: opts.proxyHosts, timeoutMs: opts.timeoutMs });
  const saved = saveImage(image, opts.outputPath);
  const dims = imageSize(image.buffer);
  const actualSize = dims ? `${dims.width}x${dims.height}` : '(unknown)';
  const warnings = [];
  if (saved.note) warnings.push(saved.note);
  if (dims && size !== 'auto' && actualSize !== size) {
    warnings.push(`provider ignored the requested size: asked ${size}, got ${actualSize}`);
  }

  return {
    savePath: saved.savePath,
    mime: saved.mime,
    bytes: saved.bytes,
    model,
    requestedSize: size,
    actualSize,
    quality,
    warnings,
  };
}
