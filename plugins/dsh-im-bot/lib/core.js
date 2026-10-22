/**
 * dsh-im-bot —— 纯函数核心层。
 *
 * 这里只放**不碰 IO、不碰 ctx** 的逻辑：消息归一化、命令解析、绑定表、
 * 通知文案渲染、白名单匹配、分片与限流计算。宿主入口与两个通道实现都从
 * 这里取语义，测试也直接打这些函数，因此不需要任何网络或宿主桩。
 *
 * 设计取向：
 *   - 所有会落盘或跨边界的数据都先经过 `toWire`/`fromWire` 这类显式的
 *     形状校验，拒绝把宿主对象图直接塞进 JSON。
 *   - 所有长度上限都在这里定义成常量，通道实现只引用，不各自维护一份。
 *
 * @module dsh-im-bot/core
 */

import { randomUUID } from 'node:crypto';

/** 插件在 Cordis 里的行 id，也是设置面板命名空间。 */
export const NS = 'im-bot';

/** 浏览器设置面板的 RPC 通道。 */
export const RPC_CHANNEL = '/dsh-im-bot';

/** 通用发送 HTTP 路由（供其它插件/外部脚本调用）。 */
export const SEND_ROUTE = '/dsh-im-bot/send';

/** 机器人消息注入会话时使用的 source.kind。 */
export const MESSAGE_SOURCE_KIND = 'im-bot';

/** 两个通道的稳定标识。 */
export const CHANNEL_ILINK = 'ilink';
export const CHANNEL_WECOM = 'wecom';

/** 全部通道标识，顺序即设置页展示顺序。 */
export const CHANNEL_KINDS = [CHANNEL_WECOM, CHANNEL_ILINK];

/** 通道的展示名。 */
export const CHANNEL_LABELS = {
  [CHANNEL_WECOM]: '企业微信智能机器人',
  [CHANNEL_ILINK]: '个人微信（iLink Bot）',
};

/** 凭据引用（环境变量名）。值只进 ctx.credentials，绝不进 Profile 配置。 */
export const CREDENTIAL_REFS = {
  wecomSecret: 'DSH_IM_BOT_WECOM_SECRET',
  ilinkToken: 'DSH_IM_BOT_ILINK_TOKEN',
  httpSecret: 'DSH_IM_BOT_HTTP_SECRET',
};

/** 建站默认值：一律关闭，装完不产生任何连接。 */
export const DEFAULTS = {
  enabled: false,
  wecom: {
    enabled: false,
    botId: '',
    baseUrl: 'wss://openws.work.weixin.qq.com',
    heartbeatSeconds: 30,
    heartbeatTimeoutCount: 3,
  },
  ilink: {
    enabled: false,
    accountId: '',
    baseUrl: 'https://ilinkai.weixin.qq.com',
    longPollTimeoutMs: 35000,
    sessionExpiredPauseMs: 600000,
    typing: true,
  },
  notify: {
    onTurnComplete: true,
    onTurnFailure: true,
    maxNoticeChars: 800,
    failureChars: 300,
  },
  access: {
    allowFrom: [],
    groupAllowFrom: [],
    groupsEnabled: false,
  },
  session: {
    agentPreset: '',
    provider: '',
    model: '',
    reasoningEffort: '',
  },
};

/** 对外出站文本的通道长度上限（按字符计，字节由通道自己再核一次）。 */
export const TEXT_CHUNK_LIMITS = {
  [CHANNEL_WECOM]: 2000,
  [CHANNEL_ILINK]: 2000,
};

/** 企业微信 markdown 正文的字节上限（官方 20480 字节，留出裕量）。 */
export const WECOM_MARKDOWN_MAX_BYTES = 20000;

/** 去重窗口：同一 msgid/内容指纹在该窗口内只处理一次。 */
export const DEDUP_TTL_MS = 300000;

/** 每 peer 发送限流：窗口内最多 N 条。 */
export const RATE_LIMIT = {
  windowMs: 60000,
  maxPerWindow: 30,
};

/** 连续发送失败多少次后进入退避。 */
export const SEND_FAILURE_THRESHOLD = 3;

/** 发送失败后的退避时长。 */
export const SEND_BACKOFF_MS = 30000;

/** 单条通知里「摘要」部分默认截断长度。 */
export const MAX_NOTICE_CHARS_FLOOR = 100;
export const MAX_NOTICE_CHARS_CEIL = 4000;

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

/**
 * 把任意值收敛成去空白的字符串。
 * @param {unknown} value
 * @returns {string}
 */
export function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 生成一个唯一请求 id（企业微信 iLink 都要求「请求唯一标识」）。
 * @returns {string}
 */
export function requestId() {
  return randomUUID();
}

/**
 * 按字符上限切分文本，优先在换行处断开，避免把一句话劈成两半。
 *
 * 代理对（emoji）不会被切开：切点落在代理对中间时向前退一格。
 *
 * @param {string} text
 * @param {number} limit 每片最大字符数（> 0）
 * @returns {string[]} 至少一项；空输入返回空数组
 */
export function splitText(text, limit) {
  const source = typeof text === 'string' ? text : '';
  if (source === '') return [];
  const size = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 2000;
  if (source.length <= size) return [source];

  /** @type {string[]} */
  const chunks = [];
  let rest = source;
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    // 换行太靠前就退化成硬切，避免产出大量超短碎片。
    if (cut < Math.floor(size / 2)) cut = size;
    // 不切断代理对：高位代理在切点前一位时整体挪到下一片。
    const code = rest.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
    // 片首的换行没有信息量。
    rest = rest.replace(/^\n+/, '');
  }
  if (rest !== '') chunks.push(rest);
  return chunks;
}

/**
 * 按 UTF-8 字节上限切分（企业微信 markdown 正文按字节限流）。
 * @param {string} text
 * @param {number} maxBytes
 * @returns {string[]}
 */
export function splitTextByBytes(text, maxBytes) {
  const source = typeof text === 'string' ? text : '';
  if (source === '') return [];
  const size = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : WECOM_MARKDOWN_MAX_BYTES;
  if (Buffer.byteLength(source, 'utf8') <= size) return [source];

  /** @type {string[]} */
  const chunks = [];
  let current = '';
  let currentBytes = 0;
  // 按码点遍历，保证不切断代理对，也不切断多字节字符。
  for (const char of source) {
    const bytes = Buffer.byteLength(char, 'utf8');
    if (currentBytes + bytes > size && current !== '') {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += char;
    currentBytes += bytes;
  }
  if (current !== '') chunks.push(current);
  return chunks;
}

/**
 * 截断到指定字符数，超出时补省略号。
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
export function truncate(text, maxChars) {
  const source = typeof text === 'string' ? text : '';
  const budget = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 0;
  if (budget === 0 || source.length <= budget) return source;
  const code = source.charCodeAt(budget - 1);
  const safe = code >= 0xd800 && code <= 0xdbff ? budget - 1 : budget;
  return `${source.slice(0, safe).trimEnd()}…`;
}

/**
 * 把 markdown 降级成纯文本（供不支持 markdown 的通道使用）。
 *
 * 只做保守转换：去掉标题井号、列表符号统一成中点、表格折成缩进文本、
 * 行内代码去掉反引号。**不**尝试解析嵌套结构。
 *
 * @param {string} text
 * @returns {string}
 */
export function markdownToPlainText(text) {
  const source = typeof text === 'string' ? text : '';
  if (source === '') return '';
  const lines = source.split('\n');
  /** @type {string[]} */
  const output = [];
  /** @type {string[][] | null} */
  let table = null;

  const flushTable = () => {
    if (table === null) return;
    const rows = table.filter((cells) => !cells.every((cell) => /^:?-{2,}:?$/.test(cell)));
    for (const cells of rows) {
      output.push(`· ${cells.filter(Boolean).join(' | ')}`);
    }
    table = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2) {
      const cells = trimmed.slice(1, -1).split('|').map((cell) => cell.trim());
      if (table === null) table = [];
      table.push(cells);
      continue;
    }
    flushTable();

    if (trimmed === '') {
      output.push('');
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(trimmed);
    if (heading !== null) {
      output.push(heading[1]);
      continue;
    }
    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      output.push('——');
      continue;
    }
    const unordered = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (unordered !== null) {
      output.push(`· ${unordered[1]}`);
      continue;
    }
    output.push(trimmed.replace(/`([^`]+)`/g, '$1'));
  }
  flushTable();
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------------------------------------------------------------------
// 消息归一化
// ---------------------------------------------------------------------------

/**
 * 归一化后的入站消息。
 * @typedef {object} InboundEvent
 * @property {'ilink'|'wecom'} channel
 * @property {string} peer 通道内唯一寻址单位（企微 chatid/userid，iLink userid）
 * @property {'single'|'group'} chatType
 * @property {string} text
 * @property {string} messageId 通道侧的排重 id
 * @property {string} [replyToken] 企微为 req_id；iLink 无
 * @property {string} [from] 发送者（群里与 peer 不同）
 * @property {boolean} [mentioned] 群里是否明确 @ 了机器人
 */

/**
 * 构造一个归一化入站事件，缺字段时补安全默认值。
 * @param {Partial<InboundEvent>} input
 * @returns {InboundEvent}
 */
export function normalizeInbound(input) {
  const channel = input?.channel === CHANNEL_ILINK ? CHANNEL_ILINK : CHANNEL_WECOM;
  const peer = str(input?.peer);
  return {
    channel,
    peer,
    chatType: input?.chatType === 'group' ? 'group' : 'single',
    text: typeof input?.text === 'string' ? input.text : '',
    messageId: str(input?.messageId),
    ...(str(input?.replyToken) === '' ? {} : { replyToken: str(input.replyToken) }),
    ...(str(input?.from) === '' ? {} : { from: str(input.from) }),
    ...(input?.mentioned === true ? { mentioned: true } : {}),
  };
}

/**
 * 通道 + peer 组成的稳定键，绑定表与限流表都用它。
 * @param {string} channel
 * @param {string} peer
 * @returns {string}
 */
export function peerKey(channel, peer) {
  return `${channel}:${peer}`;
}

/**
 * 解析 peerKey 回 `{ channel, peer }`；格式不合法时返回 null。
 * @param {string} key
 * @returns {{ channel: string, peer: string } | null}
 */
export function parsePeerKey(key) {
  const source = str(key);
  const index = source.indexOf(':');
  if (index <= 0 || index === source.length - 1) return null;
  const channel = source.slice(0, index);
  if (!CHANNEL_KINDS.includes(channel)) return null;
  return { channel, peer: source.slice(index + 1) };
}

// ---------------------------------------------------------------------------
// 白名单
// ---------------------------------------------------------------------------

/**
 * 把配置里的白名单收敛成去重数组（忽略大小写差异不处理：userid 大小写敏感）。
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeAllowList(value) {
  const list = Array.isArray(value) ? value : [];
  /** @type {string[]} */
  const out = [];
  for (const item of list) {
    const text = str(item);
    if (text === '' || out.includes(text)) continue;
    out.push(text);
  }
  return out;
}

/**
 * 判断一条入站消息是否有权触发会话。
 *
 * 安全默认：白名单为空时**全部拒绝**。否则任何知道机器人账号的人都能给
 * 机器人发消息，直接烧掉模型额度。
 *
 * @param {object} access 配置里的 access 段
 * @param {InboundEvent} event
 * @returns {{ allowed: boolean, reason: string }}
 */
export function checkAccess(access, event) {
  const allowFrom = normalizeAllowList(access?.allowFrom);
  const groupAllowFrom = normalizeAllowList(access?.groupAllowFrom);
  const groupsEnabled = access?.groupsEnabled === true;
  const sender = str(event?.from) || str(event?.peer);

  if (event?.chatType === 'group') {
    if (!groupsEnabled) return { allowed: false, reason: 'groups-disabled' };
    if (groupAllowFrom.length === 0) return { allowed: false, reason: 'no-group-allowlist' };
    if (!groupAllowFrom.includes(str(event?.peer))) {
      return { allowed: false, reason: 'group-not-allowed' };
    }
    return { allowed: true, reason: 'ok' };
  }

  if (allowFrom.length === 0) return { allowed: false, reason: 'no-allowlist' };
  if (!allowFrom.includes(sender)) return { allowed: false, reason: 'sender-not-allowed' };
  return { allowed: true, reason: 'ok' };
}


/**
 * 判断一条**已有绑定**是否仍有权接收通知。
 *
 * 与 {@link checkAccess} 的区别：那个函数校验「入站消息能否驱动会话」，
 * 输入是 InboundEvent（带 from/chatType）；这里校验「出站通知能否发给这个
 * 聊天」，输入是绑定记录（只有 channel/peer/chatType）。
 *
 * 为什么通知也要过白名单：白名单是**数据边界的唯一开关**。若广播只看 notify
 * 标记，那么一旦用户把某个 peer 从白名单移除（或清空白名单想彻底停用），
 * 历史绑定仍然会把**所有会话的标题与内容摘要**持续推给那个聊天 —— 等于
 * 白名单对出站失效，泄露范围比入站更大。
 *
 * @param {object} access 配置里的 access 段
 * @param {{ channel?: string, peer?: string, chatType?: string }} binding
 * @returns {{ allowed: boolean, reason: string }}
 */
export function checkNotifyAccess(access, binding) {
  const allowFrom = normalizeAllowList(access?.allowFrom);
  const groupAllowFrom = normalizeAllowList(access?.groupAllowFrom);
  const groupsEnabled = access?.groupsEnabled === true;
  const peer = str(binding?.peer);

  if (str(binding?.chatType) === 'group') {
    if (!groupsEnabled) return { allowed: false, reason: 'groups-disabled' };
    if (groupAllowFrom.length === 0) return { allowed: false, reason: 'no-group-allowlist' };
    if (!groupAllowFrom.includes(peer)) return { allowed: false, reason: 'group-not-allowed' };
    return { allowed: true, reason: 'ok' };
  }

  if (allowFrom.length === 0) return { allowed: false, reason: 'no-allowlist' };
  // 单聊的 peer 就是对方 userid，直接比对即可。
  if (!allowFrom.includes(peer)) return { allowed: false, reason: 'peer-not-allowed' };
  return { allowed: true, reason: 'ok' };
}

// ---------------------------------------------------------------------------
// 去重
// ---------------------------------------------------------------------------

/**
 * 生成内容指纹（同一发送者短时间内重复的相同文本视为重投）。
 * @param {InboundEvent} event
 * @returns {string}
 */
export function contentFingerprint(event) {
  const sender = str(event?.from) || str(event?.peer);
  return `${event?.channel}\u0000${sender}\u0000${event?.text ?? ''}`;
}

/**
 * 有界 TTL 去重集合。不依赖定时器：每次写入顺带清理过期项，因此进程
 * 长时间运行也不会无界增长。
 */
export class Deduplicator {
  /**
   * @param {{ ttlMs?: number, maxEntries?: number, now?: () => number }} [options]
   */
  constructor(options = {}) {
    this.ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs > 0 ? options.ttlMs : DEDUP_TTL_MS;
    this.maxEntries = Number.isFinite(options.maxEntries) && options.maxEntries > 0
      ? Math.floor(options.maxEntries)
      : 512;
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    /** @type {Map<string, number>} */
    this.seen = new Map();
  }

  /** 清空。 */
  clear() {
    this.seen.clear();
  }

  /**
   * 记录一个指纹；返回 true 表示「此前已见过」（重复）。
   * @param {string} key
   * @returns {boolean}
   */
  check(key) {
    const id = str(key);
    if (id === '') return false;
    const now = this.now();
    this.prune(now);
    const previous = this.seen.get(id);
    if (previous !== undefined && now - previous < this.ttlMs) return true;
    this.seen.set(id, now);
    if (this.seen.size > this.maxEntries) this.evictOldest();
    return false;
  }

  /**
   * @param {number} now
   */
  prune(now) {
    for (const [key, at] of this.seen) {
      if (now - at < this.ttlMs) continue;
      this.seen.delete(key);
    }
  }

  evictOldest() {
    // Map 保持插入顺序，删掉最旧的一批即可。
    const drop = Math.max(1, Math.floor(this.maxEntries * 0.1));
    let removed = 0;
    for (const key of this.seen.keys()) {
      this.seen.delete(key);
      removed += 1;
      if (removed >= drop) break;
    }
  }
}

// ---------------------------------------------------------------------------
// 令牌桶限流
// ---------------------------------------------------------------------------

/**
 * 每 peer 的滑动窗口限流器。
 *
 * 通知类消息「宁可丢不可积压」，所以这里不排队，超限直接返回 false，
 * 由调用方决定记日志并放弃。
 */
export class RateLimiter {
  /**
   * @param {{ windowMs?: number, maxPerWindow?: number, now?: () => number }} [options]
   */
  constructor(options = {}) {
    this.windowMs = Number.isFinite(options.windowMs) && options.windowMs > 0
      ? options.windowMs
      : RATE_LIMIT.windowMs;
    this.maxPerWindow = Number.isFinite(options.maxPerWindow) && options.maxPerWindow > 0
      ? Math.floor(options.maxPerWindow)
      : RATE_LIMIT.maxPerWindow;
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    /** @type {Map<string, number[]>} */
    this.hits = new Map();
  }

  /**
   * 尝试占用一个配额；返回 false 表示窗口内已超限。
   * @param {string} key
   * @returns {boolean}
   */
  take(key) {
    const id = str(key);
    if (id === '') return false;
    const now = this.now();
    const recent = (this.hits.get(id) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.maxPerWindow) {
      this.hits.set(id, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(id, recent);
    return true;
  }

  /**
   * 距离下个可用配额还有多少毫秒（用于日志）。
   * @param {string} key
   * @returns {number}
   */
  retryAfterMs(key) {
    const recent = this.hits.get(str(key)) ?? [];
    if (recent.length < this.maxPerWindow) return 0;
    const oldest = recent[0];
    return Math.max(0, this.windowMs - (this.now() - oldest));
  }

  /** 清空。 */
  clear() {
    this.hits.clear();
  }
}

// ---------------------------------------------------------------------------
// 同名串行锁（同一 peer 的发送必须按序，避免分片交错）
// ---------------------------------------------------------------------------

/**
 * 按 key 串行化异步任务。
 *
 * 与 `dsh-prompt-history` 的 `withSessionLock` 同款思路：后者等待前者
 * 落定（无论成功失败），保证同一 peer 的多个分片按提交顺序发出。
 */
export class KeyedSerialLock {
  constructor() {
    /** @type {Map<string, Promise<unknown>>} */
    this.chains = new Map();
  }

  /**
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  run(key, task) {
    const id = str(key);
    const previous = this.chains.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    this.chains.set(id, next);
    return next.finally(() => {
      if (this.chains.get(id) === next) this.chains.delete(id);
    });
  }

  /** 清空（只丢弃链引用，不取消已在跑的任务）。 */
  clear() {
    this.chains.clear();
  }
}

// ---------------------------------------------------------------------------
// 命令解析
// ---------------------------------------------------------------------------

/**
 * 命令目录：唯一事实来源。
 *
 * 设置面板、`/help` 文案、解析器三处都从这里取，避免「帮助里有一套、面板里
 * 写另一套、解析器只认第三套」的漂移。`usage` 是给人看的完整写法，
 * `summary` 是一句话说明。
 *
 * @type {ReadonlyArray<{ name: string, usage: string, summary: string }>}
 */
export const COMMAND_CATALOG = Object.freeze([
  { name: 'new', usage: '/new [标题]', summary: '新建会话并绑定到当前聊天' },
  { name: 'use', usage: '/use <会话ID>', summary: '绑定到已有会话（可用前 8 位前缀）' },
  { name: 'sessions', usage: '/sessions', summary: '列出最近会话' },
  { name: 'status', usage: '/status', summary: '查看当前绑定与运行状态' },
  { name: 'stop', usage: '/stop', summary: '中止当前正在生成的回合' },
  { name: 'notify', usage: '/notify on|off', summary: '开关本聊天的任务完成通知' },
  { name: 'agents', usage: '/agents', summary: '列出可用的 agent 预设' },
  { name: 'skills', usage: '/skills', summary: '列出当前会话可用的技能' },
  { name: 'models', usage: '/models', summary: '列出可用的模型提供商与模型' },
  { name: 'model', usage: '/model <提供商/模型ID>', summary: '切换当前会话的模型' },
  { name: 'help', usage: '/help', summary: '显示命令帮助' },
]);

/** 支持的斜杠命令（由 {@link COMMAND_CATALOG} 派生，顺序即展示顺序）。 */
export const COMMANDS = COMMAND_CATALOG.map((item) => item.name);

/**
 * 解析一条入站文本是否为命令。
 *
 * 只有以 `/` 开头且首词命中 {@link COMMANDS} 才算命令；否则一律返回
 * `{ isCommand: false }`，交给会话处理。这样用户正文里出现的路径
 * （如 `/usr/local`）不会被误当成命令。
 *
 * @param {string} text
 * @returns {{ isCommand: false } | { isCommand: true, name: string, argument: string }}
 */
export function parseCommand(text) {
  const source = typeof text === 'string' ? text.trim() : '';
  if (!source.startsWith('/')) return { isCommand: false };
  const match = /^\/([A-Za-z]+)(?:\s+([\s\S]*))?$/.exec(source);
  if (match === null) return { isCommand: false };
  const name = match[1].toLowerCase();
  if (!COMMANDS.includes(name)) return { isCommand: false };
  return { isCommand: true, name, argument: (match[2] ?? '').trim() };
}

/**
 * `/help` 的固定文案。
 * @returns {string}
 */

/**
 * 渲染 agent 预设列表。
 * @param {Array<{ id: string, name?: string, description?: string, broken?: string }>} presets
 * @param {string} [defaultId] 当前默认预设 id
 * @returns {string}
 */
export function renderAgents(presets, defaultId = '') {
  const list = Array.isArray(presets) ? presets : [];
  if (list.length === 0) return '（没有可用的 agent 预设）';
  const lines = list.map((preset) => {
    const id = str(preset?.id);
    const mark = id !== '' && id === str(defaultId) ? '▶ ' : '  ';
    const name = str(preset?.name);
    const label = name !== '' && name !== id ? `${name}（${id}）` : id;
    // broken 是激活失败诊断：显式标出来，否则用户只会觉得「选了没反应」。
    const broken = str(preset?.broken);
    const suffix = broken === '' ? '' : `　⚠️ ${truncate(broken, 60)}`;
    return `${mark}${label}${suffix}`;
  });
  return ['🤖 Agent 预设', '', ...lines, '', '用 /new 新建会话时会使用设置里的默认预设。'].join('\n');
}

/**
 * 渲染技能列表。
 * @param {Array<{ name: string, description?: string, modelInvocable?: boolean }>} skills
 * @returns {string}
 */
export function renderSkills(skills) {
  const list = Array.isArray(skills) ? skills : [];
  if (list.length === 0) return '（当前会话没有可用技能）';
  const lines = list.map((skill) => {
    const name = str(skill?.name);
    const desc = truncate(str(skill?.description), 60);
    const modelTag = skill?.modelInvocable === true ? '' : '　[仅手动]';
    return `/${name}${modelTag}${desc === '' ? '' : `\n    ${desc}`}`;
  });
  return ['🧩 可用技能', '', ...lines].join('\n');
}

/**
 * 渲染模型列表（按提供商分组）。
 * @param {{ default?: { provider?: string, model?: string }, groups?: Array<{ id: string, name?: string, models?: Array<{ id: string, name?: string }> }>, failures?: Array<{ id: string, message?: string }> }} catalog
 * @param {number} [maxPerProvider] 每个提供商最多列几个模型，避免刷屏
 * @returns {string}
 */
export function renderModels(catalog, maxPerProvider = 12) {
  const groups = Array.isArray(catalog?.groups) ? catalog.groups : [];
  const failures = Array.isArray(catalog?.failures) ? catalog.failures : [];
  if (groups.length === 0 && failures.length === 0) return '（没有可用的模型）';

  const lines = [];
  const def = catalog?.default;
  if (str(def?.provider) !== '') {
    lines.push(`默认：${str(def.provider)} / ${str(def.model)}`, '');
  }
  const limit = Number.isFinite(maxPerProvider) && maxPerProvider > 0 ? Math.floor(maxPerProvider) : 12;
  for (const group of groups) {
    const models = Array.isArray(group?.models) ? group.models : [];
    const label = str(group?.name) !== '' && str(group.name) !== str(group.id)
      ? `${str(group.name)}（${str(group.id)}）`
      : str(group?.id);
    lines.push(`${label}：${models.length} 个`);
    for (const model of models.slice(0, limit)) {
      lines.push(`  · ${str(model?.id)}`);
    }
    if (models.length > limit) lines.push(`  …还有 ${models.length - limit} 个`);
  }
  if (failures.length > 0) {
    lines.push('', '⚠️ 以下提供商加载失败：');
    for (const failure of failures) {
      lines.push(`  ${str(failure?.id)}：${truncate(str(failure?.message), 60)}`);
    }
  }
  return ['🧠 可用模型', '', ...lines].join('\n');
}


/**
 * 解析 `/model <提供商>/<模型ID>` 的参数。
 *
 * 模型 ID 本身常含 `/`（如 `deepseek/deepseek-flash`），所以按**第一个**斜杠
 * 切分：前者是提供商，后者整体是模型 ID。也接受纯模型 ID（提供商留空），
 * 由调用方在当前提供商的候选里匹配。
 *
 * @param {string} argument 命令参数
 * @returns {{ ok: true, provider: string, model: string } | { ok: false, error: string }}
 */
export function parseModelArgument(argument) {
  const raw = str(argument);
  if (raw === '') {
    return {
      ok: false,
      error: '用法：/model <提供商/模型ID> [推理强度]，例如 /model ai-proxy/glm-5.3 high',
    };
  }
  /*
   * 可选的第三个字段是推理强度：以「空格分隔的最后一段」识别。
   * 只按空格切一次而不是任取尾部，避免模型 ID 里含空格时误判
   * （模型 ID 实际不含空格，这个约束足够稳）。
   */
  const parts = raw.split(/\s+/);
  const hasEffort = parts.length >= 2 && parts[parts.length - 1].indexOf('/') === -1;
  const effort = hasEffort ? parts[parts.length - 1] : '';
  const target = hasEffort ? parts.slice(0, -1).join(' ') : raw;

  const slash = target.indexOf('/');
  if (slash === -1) {
    // 只给了模型 ID：允许，交由调用方按当前/默认提供商解析。
    return { ok: true, provider: '', model: target, reasoningEffort: effort };
  }
  const provider = target.slice(0, slash).trim();
  const model = target.slice(slash + 1).trim();
  if (model === '') {
    return { ok: false, error: '模型 ID 不能为空，格式：/model <提供商/模型ID> [推理强度]' };
  }
  return { ok: true, provider, model, reasoningEffort: effort };
}

/**
 * 从模型目录里找出可切换的候选，用于解析 `/model` 的输入。
 *
 * @param {{ groups?: Array<{ id: string, models?: Array<{ id: string }> }> }} catalog
 * @param {{ provider: string, model: string }} request
 * @returns {{ ok: true, provider: string, model: string } | { ok: false, error: string }}
 */
export function resolveModelChoice(catalog, request) {
  const groups = Array.isArray(catalog?.groups) ? catalog.groups : [];
  const wantedProvider = str(request?.provider);
  const wantedModel = str(request?.model);

  const providerIds = groups.map((group) => str(group?.id)).filter((id) => id !== '');
  const modelsOf = (providerId) => {
    const group = groups.find((item) => str(item?.id) === providerId);
    return (Array.isArray(group?.models) ? group.models : []).map((model) => str(model?.id));
  };

  if (wantedProvider !== '') {
    if (!providerIds.includes(wantedProvider)) {
      return {
        ok: false,
        error: `没有提供商 "${wantedProvider}"。可用：${providerIds.join(', ') || '（无）'}`,
      };
    }
    const models = modelsOf(wantedProvider);
    if (!models.includes(wantedModel)) {
      return {
        ok: false,
        error: `提供商 "${wantedProvider}" 下没有模型 "${wantedModel}"。可用：${models.slice(0, 8).join(', ')}${models.length > 8 ? ' …' : ''}`,
      };
    }
    return { ok: true, provider: wantedProvider, model: wantedModel };
  }

  // 只给了模型 ID：在所有提供商里找；命中多个要求指明提供商。
  const hits = [];
  for (const providerId of providerIds) {
    if (modelsOf(providerId).includes(wantedModel)) hits.push(providerId);
  }
  if (hits.length === 0) return { ok: false, error: `没有模型 "${wantedModel}"。用 /models 查看可用模型。` };
  if (hits.length > 1) {
    return {
      ok: false,
      error: `模型 "${wantedModel}" 在多个提供商下都有（${hits.join(', ')}），请写成 /model <提供商>/${wantedModel}`,
    };
  }
  return { ok: true, provider: hits[0], model: wantedModel };
}

export function renderHelp() {
  // 由 COMMAND_CATALOG 生成，宽度按最长 usage 对齐；新增命令只改目录一处。
  const width = COMMAND_CATALOG.reduce((max, item) => Math.max(max, item.usage.length), 0);
  const lines = COMMAND_CATALOG.map(
    (item) => `${item.usage.padEnd(width)}  ${item.summary}`,
  );
  return [
    '🤖 DSH 集成机器人 · 命令',
    '',
    ...lines,
    '',
    '直接发送其它文本，即作为该会话的下一条消息。',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 绑定表
// ---------------------------------------------------------------------------

/**
 * 一条聊天↔会话绑定。
 * @typedef {object} Binding
 * @property {string} peerKey
 * @property {string} channel
 * @property {string} peer
 * @property {'single'|'group'} chatType
 * @property {string} sessionId
 * @property {boolean} notify 本聊天是否接收完成通知
 * @property {number} updatedAt epoch ms
 */

/**
 * 校验并规范化一条绑定（从磁盘或 RPC 读回来的都要过这里）。
 * @param {unknown} raw
 * @param {{ now?: () => number }} [options]
 * @returns {Binding | null}
 */
export function normalizeBinding(raw, options = {}) {
  if (raw === null || typeof raw !== 'object') return null;
  const record = /** @type {Record<string, unknown>} */ (raw);
  const channel = str(record.channel);
  const peer = str(record.peer);
  const sessionId = str(record.sessionId);
  if (!CHANNEL_KINDS.includes(channel) || peer === '' || sessionId === '') return null;
  const now = typeof options.now === 'function' ? options.now() : Date.now();
  const updatedAt = Number.isFinite(record.updatedAt) ? Number(record.updatedAt) : now;
  return {
    peerKey: peerKey(channel, peer),
    channel,
    peer,
    chatType: record.chatType === 'group' ? 'group' : 'single',
    sessionId,
    notify: record.notify !== false,
    updatedAt,
  };
}

/**
 * 绑定表：以 peerKey 为主键的纯内存结构，落盘由调用方负责。
 */
export class BindingTable {
  constructor() {
    /** @type {Map<string, Binding>} */
    this.bindings = new Map();
  }

  /**
   * 从磁盘数据重建。
   * @param {unknown} raw
   * @returns {number} 载入条数
   */
  load(raw) {
    this.bindings.clear();
    const list = Array.isArray(raw) ? raw : [];
    let loaded = 0;
    for (const item of list) {
      const binding = normalizeBinding(item);
      if (binding === null) continue;
      this.bindings.set(binding.peerKey, binding);
      loaded += 1;
    }
    return loaded;
  }

  /**
   * 序列化成可落盘的数组。
   * @returns {Binding[]}
   */
  toJSON() {
    return [...this.bindings.values()].map((binding) => ({ ...binding }));
  }

  /**
   * 写入/更新一条绑定。
   * @param {Partial<Binding> & { channel: string, peer: string, sessionId: string }} input
   * @param {{ now?: () => number }} [options]
   * @returns {Binding | null}
   */
  set(input, options = {}) {
    const binding = normalizeBinding({ ...input, updatedAt: undefined }, options);
    if (binding === null) return null;
    const now = typeof options.now === 'function' ? options.now() : Date.now();
    this.bindings.set(binding.peerKey, { ...binding, updatedAt: now });
    return { ...binding, updatedAt: now };
  }

  /**
   * @param {string} channel
   * @param {string} peer
   * @returns {Binding | undefined}
   */
  get(channel, peer) {
    return this.bindings.get(peerKey(channel, peer));
  }

  /**
   * 按会话 id 找绑定（通知时按 sessionId 反查）。
   * @param {string} sessionId
   * @returns {Binding[]}
   */
  bySession(sessionId) {
    const target = str(sessionId);
    if (target === '') return [];
    return [...this.bindings.values()].filter((binding) => binding.sessionId === target);
  }

  /**
   * 删除一条绑定。
   * @param {string} channel
   * @param {string} peer
   * @returns {boolean}
   */
  remove(channel, peer) {
    return this.bindings.delete(peerKey(channel, peer));
  }

  /**
   * 删除指向某会话的所有绑定（会话被删/归档时用）。
   * @param {string} sessionId
   * @returns {number}
   */
  removeBySession(sessionId) {
    const target = str(sessionId);
    let removed = 0;
    for (const [key, binding] of this.bindings) {
      if (binding.sessionId !== target) continue;
      this.bindings.delete(key);
      removed += 1;
    }
    return removed;
  }

  /**
   * 更新某聊天的通知开关。
   * @param {string} channel
   * @param {string} peer
   * @param {boolean} notify
   * @returns {Binding | null}
   */
  setNotify(channel, peer, notify) {
    const binding = this.get(channel, peer);
    if (binding === undefined) return null;
    const next = { ...binding, notify: notify === true };
    this.bindings.set(next.peerKey, next);
    return next;
  }

  /** @returns {number} */
  get size() {
    return this.bindings.size;
  }
}

// ---------------------------------------------------------------------------
// 会话选择
// ---------------------------------------------------------------------------

/**
 * 按前缀匹配会话 id。命中唯一时返回该 id；无命中或有歧义时返回 null。
 * @param {string[]} sessionIds
 * @param {string} prefix
 * @returns {{ sessionId: string } | { error: 'not-found'|'ambiguous', candidates: string[] }}
 */
export function matchSessionPrefix(sessionIds, prefix) {
  const needle = str(prefix);
  const list = Array.isArray(sessionIds) ? sessionIds.filter((id) => typeof id === 'string' && id !== '') : [];
  if (needle === '') return { error: 'not-found', candidates: [] };
  if (list.includes(needle)) return { sessionId: needle };
  const hits = list.filter((id) => id.startsWith(needle));
  if (hits.length === 1) return { sessionId: hits[0] };
  if (hits.length === 0) return { error: 'not-found', candidates: [] };
  return { error: 'ambiguous', candidates: hits.slice(0, 8) };
}

/**
 * 从会话标题事件值里取一个可展示的标题。
 * @param {unknown} title
 * @param {string} sessionId
 * @returns {string}
 */
export function sessionLabel(title, sessionId) {
  const text = str(title);
  if (text !== '') return truncate(text, 40);
  return shortSessionId(sessionId) || '（未知会话）';
}

/**
 * 把完整的 sessionId 压成可展示的短 ID。
 *
 * 坑：宿主 mint 的 id 形如 `session-bf17eeb8-d6fc-4d34-...`，
 * **`session-` 这个前缀正好占 8 个字符**。早期实现直接 `slice(0, 8)`，
 * 结果每个会话都显示成 `session-`，既无区分度又看不到标题以外的信息。
 *
 * 这里先剥掉已知前缀，再取 8 位；对不带前缀的 id 退化为直接截取。
 *
 * @param {string} sessionId
 * @returns {string} 短 ID，空输入返回空串
 */
export function shortSessionId(sessionId) {
  const id = str(sessionId);
  if (id === '') return '';
  // 宿主用 `session-<uuid>`；也兼容未来可能出现的其它命名前缀。
  const stripped = id.startsWith('session-') ? id.slice('session-'.length) : id;
  const body = stripped === '' ? id : stripped;
  return body.slice(0, 8);
}

// ---------------------------------------------------------------------------
// 通知文案
// ---------------------------------------------------------------------------

/**
 * 渲染一条「回合完成」通知。
 * @param {object} input
 * @param {string} input.label 会话标题
 * @param {string} [input.summary] 最后一条 assistant 文本
 * @param {number} [input.durationMs]
 * @param {number} [input.maxChars]
 * @returns {string}
 */
export function renderCompletionNotice(input) {
  const maxChars = clampNoticeChars(input?.maxChars);
  const summary = truncate(str(input?.summary), maxChars);
  const lines = [`✅ 任务完成 · ${str(input?.label) || '会话'}`];
  /*
   * 通知要能「认领」是哪个会话跑完的：标题可能重名，光看标题无法区分。
   * 这里固定带一行短 id，用户可以直接拿它去 /use 绑定或在 Web 端定位。
   */
  const sid = str(input?.sessionId);
  if (sid !== '') lines.push(`　会话 ${shortSessionId(sid)}`);
  if (summary !== '') lines.push('', summary);
  const duration = Number.isFinite(input?.durationMs) ? Math.max(0, Number(input.durationMs)) : 0;
  if (duration > 0) lines.push('', `—— 用时 ${formatDuration(duration)}`);
  return lines.join('\n');
}

/**
 * 渲染一条「回合失败/中断」通知。
 * @param {object} input
 * @param {string} input.label
 * @param {string} input.kind turn/end 的 reason.kind
 * @param {string} [input.reason] 错误信息或原因说明
 * @param {number} [input.maxChars]
 * @returns {string}
 */
export function renderFailureNotice(input) {
  const maxChars = clampNoticeChars(input?.maxChars, DEFAULTS.notify.failureChars);
  const reason = truncate(str(input?.reason), maxChars);
  const kind = str(input?.kind) || 'unknown';
  const lines = [`⚠️ 回合结束（${kind}）· ${str(input?.label) || '会话'}`];
  const sid = str(input?.sessionId);
  if (sid !== '') lines.push(`　会话 ${shortSessionId(sid)}`);
  if (reason !== '') lines.push('', reason);
  return lines.join('\n');
}

/**
 * 把毫秒格式化成人类可读时长。
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  if (total < 1000) return `${total}ms`;
  const seconds = Math.round(total / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60}m`;
}

/**
 * 把通知长度限制收敛到合法区间。
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function clampNoticeChars(value, fallback = DEFAULTS.notify.maxNoticeChars) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const rounded = Math.floor(numeric);
  if (rounded < MAX_NOTICE_CHARS_FLOOR) return MAX_NOTICE_CHARS_FLOOR;
  if (rounded > MAX_NOTICE_CHARS_CEIL) return MAX_NOTICE_CHARS_CEIL;
  return rounded;
}

/**
 * 判断 turn/end 的 reason 是否属于「失败/中断」类，需要发告警。
 * @param {unknown} reason turn/end 事件里的 reason 对象
 * @returns {{ failure: boolean, kind: string, detail: string }}
 */
export function classifyTurnEnd(reason) {
  if (reason === null || typeof reason !== 'object') {
    return { failure: false, kind: 'unknown', detail: '' };
  }
  const record = /** @type {Record<string, unknown>} */ (reason);
  const kind = str(record.kind) || 'unknown';
  if (kind === 'error') {
    const error = record.error;
    let detail = '';
    if (error !== null && typeof error === 'object') {
      const err = /** @type {Record<string, unknown>} */ (error);
      detail = str(err.message) || str(err.code);
    } else {
      detail = str(error);
    }
    return { failure: true, kind, detail };
  }
  if (kind === 'aborted') {
    const cause = record.reason;
    const detail = cause !== null && typeof cause === 'object'
      ? str(/** @type {Record<string, unknown>} */ (cause).kind)
      : str(cause);
    return { failure: true, kind, detail };
  }
  if (kind === 'max-tokens') {
    return { failure: true, kind, detail: '输出达到 token 上限' };
  }
  return { failure: false, kind, detail: '' };
}

/**
 * 从一批 assistant 消息里挑出最后一条的纯文本。
 * @param {Array<{ content?: Array<{ type?: string, text?: string }> }>} messages
 * @returns {string}
 */
export function lastAssistantText(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const content = Array.isArray(list[index]?.content) ? list[index].content : [];
    const text = content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('')
      .trim();
    if (text !== '') return text;
  }
  return '';
}

// ---------------------------------------------------------------------------
// 配置规范化
// ---------------------------------------------------------------------------

/**
 * 把 Profile 里可能残缺的 config 收敛成完整形状。
 *
 * 明确**不**在这里校验凭据是否存在：凭据缺失是运行期状态（用户随时可以
 * 补），不是配置错误，否则插件会因为还没填密钥就拒绝加载。
 *
 * @param {unknown} raw
 * @returns {typeof DEFAULTS}
 */
export function normalizeConfig(raw) {
  const input = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? /** @type {Record<string, any>} */ (raw)
    : {};
  const wecom = input.wecom !== null && typeof input.wecom === 'object' ? input.wecom : {};
  const ilink = input.ilink !== null && typeof input.ilink === 'object' ? input.ilink : {};
  const notify = input.notify !== null && typeof input.notify === 'object' ? input.notify : {};
  const access = input.access !== null && typeof input.access === 'object' ? input.access : {};
  const session = input.session !== null && typeof input.session === 'object' ? input.session : {};

  return {
    enabled: input.enabled === true,
    wecom: {
      enabled: wecom.enabled === true,
      botId: str(wecom.botId),
      baseUrl: str(wecom.baseUrl) || DEFAULTS.wecom.baseUrl,
      heartbeatSeconds: positiveInt(wecom.heartbeatSeconds, DEFAULTS.wecom.heartbeatSeconds, 5, 300),
      heartbeatTimeoutCount: positiveInt(
        wecom.heartbeatTimeoutCount,
        DEFAULTS.wecom.heartbeatTimeoutCount,
        1,
        20,
      ),
    },
    ilink: {
      enabled: ilink.enabled === true,
      accountId: str(ilink.accountId),
      baseUrl: (str(ilink.baseUrl) || DEFAULTS.ilink.baseUrl).replace(/\/+$/, ''),
      longPollTimeoutMs: positiveInt(ilink.longPollTimeoutMs, DEFAULTS.ilink.longPollTimeoutMs, 5000, 120000),
      sessionExpiredPauseMs: positiveInt(
        ilink.sessionExpiredPauseMs,
        DEFAULTS.ilink.sessionExpiredPauseMs,
        1000,
        3600000,
      ),
      typing: ilink.typing !== false,
    },
    notify: {
      onTurnComplete: notify.onTurnComplete !== false,
      onTurnFailure: notify.onTurnFailure !== false,
      maxNoticeChars: clampNoticeChars(notify.maxNoticeChars),
      failureChars: clampNoticeChars(notify.failureChars, DEFAULTS.notify.failureChars),
    },
    access: {
      allowFrom: normalizeAllowList(access.allowFrom),
      groupAllowFrom: normalizeAllowList(access.groupAllowFrom),
      groupsEnabled: access.groupsEnabled === true,
    },
    /*
     * 新会话默认绑定。三项都允许留空：
     *   - agentPreset 空 = 用 DSH 的默认 preset；
     *   - provider/model 空 = 用该 preset / 部署的默认模型。
     * 留空不是「配置错误」，而是「跟随宿主默认」，所以这里不做非空校验。
     */
    session: {
      agentPreset: str(session.agentPreset),
      provider: str(session.provider),
      model: str(session.model),
      reasoningEffort: str(session.reasoningEffort),
    },
  };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function positiveInt(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  const rounded = Math.floor(numeric);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

/**
 * 校验从 RPC 传进来的一条发送请求。
 * @param {unknown} raw
 * @returns {{ ok: true, value: { channel?: string, peer?: string, sessionId?: string, text: string, format: 'text'|'markdown' } } | { ok: false, error: string }}
 */
export function normalizeSendRequest(raw) {
  const input = raw !== null && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const text = typeof input.text === 'string' ? input.text : '';
  if (text.trim() === '') return { ok: false, error: 'text 不能为空' };
  if (Buffer.byteLength(text, 'utf8') > 65536) return { ok: false, error: 'text 超过 64KB 上限' };
  const channel = str(input.channel);
  if (channel !== '' && !CHANNEL_KINDS.includes(channel)) {
    return { ok: false, error: `未知通道: ${channel}` };
  }
  const format = input.format === 'markdown' ? 'markdown' : 'text';
  return {
    ok: true,
    value: {
      ...(channel === '' ? {} : { channel }),
      ...(str(input.peer) === '' ? {} : { peer: str(input.peer) }),
      ...(str(input.sessionId) === '' ? {} : { sessionId: str(input.sessionId) }),
      text,
      format,
    },
  };
}
