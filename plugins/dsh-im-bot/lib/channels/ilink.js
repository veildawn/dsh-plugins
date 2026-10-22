/**
 * 个人微信 · 腾讯 iLink Bot 通道。
 *
 * 协议依据本机 hermes 的既有实现
 * （`~/.hermes/hermes-agent/gateway/platforms/weixin.py`，2401 行），
 * 它是腾讯 iLink Bot 的**官方**接口，不是 hook / 逆向：
 *
 *   - 基址 `https://ilinkai.weixin.qq.com`，请求头需要
 *     `AuthorizationType: ilink_bot_token`、`iLink-App-Id: bot`、
 *     `iLink-App-ClientVersion`、`X-WECHAT-UIN`，body 恒带 `base_info`。
 *   - 登录：`ilink/bot/get_bot_qrcode?bot_type=3` 拿二维码，
 *     再轮询 `ilink/bot/get_qrcode_status?qrcode=`；状态机
 *     `wait` → `scaned` → [`scaned_but_redirect`] → `confirmed`，
 *     `expired` 需换码。`confirmed` 返回 `ilink_bot_id` / `bot_token` /
 *     `baseurl` / `ilink_user_id`。
 *   - 收：`ilink/bot/getupdates` 长轮询（35s），必须持久化返回的
 *     `get_updates_buf` 游标，否则重启会重复消费或丢消息。
 *   - 发：`ilink/bot/sendmessage`，`msg.context_token` 必须回带该 peer
 *     最近一次的 token；`errcode -14` 表示会话过期，此时**去掉
 *     context_token 重试**（官方接受无 token 降级发送）。
 *   - 输入态：`ilink/bot/sendtyping`，`typing_ticket` 由 `ilink/bot/getconfig`
 *     取，TTL 600 秒，过期需重新取。
 *
 * 与她的差异（刻意的）：
 *   - 不读写 `~/.hermes` 下任何文件。hermes 与 DSH 若共用同一 bot 账号，
 *     两边各自持游标会互相抢消息，因此本插件独立扫码登录、独立存游标。
 *   - 只做文本与纯文本降级，不引入 CDN 的 AES-128-ECB 媒体链路。
 *
 * @module dsh-im-bot/channels/ilink
 */

import { BaseChannel, ReconnectLoop, STATUS, describeError } from './base.js';
import { CHANNEL_ILINK, normalizeInbound, requestId, str } from '../core.js';

/** 官方基址。 */
export const DEFAULT_ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com';

/** 端点。 */
export const EP = {
  getUpdates: 'ilink/bot/getupdates',
  sendMessage: 'ilink/bot/sendmessage',
  sendTyping: 'ilink/bot/sendtyping',
  getConfig: 'ilink/bot/getconfig',
  getBotQr: 'ilink/bot/get_bot_qrcode',
  getQrStatus: 'ilink/bot/get_qrcode_status',
};

/** 常量（对齐 hermes 实测值）。 */
export const ILINK_APP_ID = 'bot';
export const CHANNEL_VERSION = '2.2.0';
export const ILINK_APP_CLIENT_VERSION = (2 << 16) | (2 << 8) | 0;

export const LONG_POLL_TIMEOUT_MS = 35000;
export const API_TIMEOUT_MS = 15000;
export const CONFIG_TIMEOUT_MS = 10000;
export const QR_TIMEOUT_MS = 35000;

/** 消息项类型。 */
export const ITEM = { text: 1, image: 2, voice: 3, file: 4, video: 5 };

/** 出站消息类型：2 = bot。 */
export const MSG_TYPE_BOT = 2;
/** 消息状态：2 = 完成。 */
export const MSG_STATE_FINISH = 2;

/** 输入态。 */
export const TYPING = { start: 1, stop: 2 };

/** 会话过期 / 限流的错误码。 */
export const ERRCODE_SESSION_EXPIRED = -14;
export const ERRCODE_RATE_LIMIT = -2;

/** 会话过期后的暂停时长（hermes 用 10 分钟）。 */
export const SESSION_EXPIRED_PAUSE_MS = 600000;

/** typing_ticket 的 TTL。 */
export const TYPING_TICKET_TTL_MS = 600000;

/** 轮询失败的重试节奏。 */
const RETRY_DELAY_MS = 2000;
const BACKOFF_DELAY_MS = 30000;
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * 生成 `X-WECHAT-UIN`：把 4 字节随机数转成十进制字符串再 base64。
 * @param {() => Uint8Array} [randomBytes]
 * @returns {string}
 */
export function randomWechatUin(randomBytes) {
  const bytes = typeof randomBytes === 'function'
    ? randomBytes()
    : /** @type {Uint8Array} */ (globalThis.crypto.getRandomValues(new Uint8Array(4)));
  let value = 0;
  for (let index = 0; index < 4; index += 1) value = value * 256 + bytes[index];
  return Buffer.from(String(value), 'utf8').toString('base64');
}

/**
 * 组装请求头。
 * @param {string} body
 * @param {string} [token]
 * @returns {Record<string, string>}
 */
export function buildHeaders(body, token = '') {
  /** @type {Record<string, string>} */
  const headers = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'Content-Length': String(Buffer.byteLength(body, 'utf8')),
    'X-WECHAT-UIN': randomWechatUin(),
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': String(ILINK_APP_CLIENT_VERSION),
  };
  if (token !== '') headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * 判断一次响应是否表示「会话过期」。
 *
 * hermes 的实测结论：`-14` 明确是过期；`-2` 配 `"unknown error"` 也是
 * 过期信号（伪装成限流）。这里把两条都算上，避免误判为限流而退避不当。
 *
 * @param {Record<string, unknown>} response
 * @returns {boolean}
 */
export function isSessionExpired(response) {
  const ret = Number(response?.ret);
  const errcode = Number(response?.errcode);
  if (ret === ERRCODE_SESSION_EXPIRED || errcode === ERRCODE_SESSION_EXPIRED) return true;
  if (ret !== ERRCODE_RATE_LIMIT && errcode !== ERRCODE_RATE_LIMIT) return false;
  return str(response?.errmsg).toLowerCase() === 'unknown error';
}

/**
 * 判断一次响应是否表示限流。
 * @param {Record<string, unknown>} response
 * @returns {boolean}
 */
export function isRateLimited(response) {
  if (isSessionExpired(response)) return false;
  return Number(response?.ret) === ERRCODE_RATE_LIMIT || Number(response?.errcode) === ERRCODE_RATE_LIMIT;
}

/**
 * 从 `item_list` 里提取正文。
 *
 * 语音只在没有可下载音频时才用官方 STT 文本（hermes #27300 的教训：
 * 腾讯云的 STT 对非中文音频会给出胡话），并打上来源标记。
 *
 * @param {Array<Record<string, any>>} itemList
 * @returns {string}
 */
export function extractIlinkText(itemList) {
  const items = Array.isArray(itemList) ? itemList : [];
  for (const item of items) {
    if (Number(item?.type) !== ITEM.text) continue;
    const text = str(item?.text_item?.text);
    const ref = item?.ref_msg;
    const refItem = ref?.message_item;
    const refType = Number(refItem?.type);
    if (Object.values(ITEM).includes(refType) && refType !== ITEM.text) {
      const title = str(ref?.title);
      return title === '' ? `[引用媒体]\n${text}` : `[引用媒体: ${title}]\n${text}`;
    }
    if (refItem !== undefined && refItem !== null && typeof refItem === 'object') {
      const parts = [];
      if (str(ref?.title) !== '') parts.push(str(ref.title));
      const quoted = extractIlinkText([refItem]);
      if (quoted !== '') parts.push(quoted);
      if (parts.length > 0) return `[引用: ${parts.join(' | ')}]\n${text}`;
    }
    return text;
  }
  for (const item of items) {
    if (Number(item?.type) !== ITEM.voice) continue;
    const voice = item?.voice_item ?? {};
    // 有可下载音频时交给上层，别用腾讯的 STT。
    if (voice?.media !== undefined && voice?.media !== null) continue;
    const voiceText = str(voice?.text);
    if (voiceText !== '') return `[语音转写]\n${voiceText}`;
  }
  return '';
}

/**
 * 判断一条 iLink 消息是单聊还是群聊。
 * @param {Record<string, any>} message
 * @param {string} accountId
 * @returns {{ chatType: 'single'|'group', peer: string }}
 */
export function guessIlinkChat(message, accountId) {
  const roomId = str(message?.room_id) || str(message?.chat_room_id);
  const toUserId = str(message?.to_user_id);
  const fromUserId = str(message?.from_user_id);
  const isGroup = roomId !== ''
    || (toUserId !== '' && accountId !== '' && toUserId !== accountId && Number(message?.msg_type) === 1);
  if (isGroup) {
    const peer = roomId !== '' ? roomId : (toUserId !== '' ? toUserId : fromUserId);
    return { chatType: 'group', peer };
  }
  return { chatType: 'single', peer: fromUserId };
}

/**
 * 把一条 `getupdates` 消息归一化成 InboundEvent。
 * @param {Record<string, any>} message
 * @param {string} accountId
 * @returns {import('../core.js').InboundEvent | null}
 */
export function normalizeIlinkMessage(message, accountId) {
  if (message === null || typeof message !== 'object') return null;
  const fromUserId = str(message.from_user_id);
  if (fromUserId === '' || fromUserId === accountId) return null;
  const { chatType, peer } = guessIlinkChat(message, accountId);
  if (peer === '') return null;
  const itemList = Array.isArray(message.item_list) ? message.item_list : [];
  return normalizeInbound({
    channel: CHANNEL_ILINK,
    peer,
    chatType,
    text: extractIlinkText(itemList),
    messageId: str(message.message_id),
    from: fromUserId,
  });
}

/**
 * iLink 通道。
 *
 * 需要持久化的两份状态由宿主通过 `loadState` / `saveState` 注入，通道本身
 * 不碰文件系统：这样单测可以完全离线，宿主也能决定落盘位置。
 */
export class IlinkChannel extends BaseChannel {
  /**
   * @param {object} options
   * @param {string} options.accountId
   * @param {string} options.token
   * @param {string} [options.baseUrl]
   * @param {number} [options.longPollTimeoutMs]
   * @param {number} [options.sessionExpiredPauseMs]
   * @param {boolean} [options.typing]
   * @param {typeof fetch} [options.fetch]
   * @param {(key: 'sync'|'contextTokens') => Promise<Record<string, unknown> | null>} [options.loadState]
   * @param {(key: 'sync'|'contextTokens', value: Record<string, unknown>) => Promise<void>} [options.saveState]
   * @param {import('node:events').EventEmitter} [options.bus]
   * @param {() => number} [options.now]
   * @param {(level: string, message: string, error?: unknown) => void} [options.log]
   */
  constructor(options) {
    super({ kind: CHANNEL_ILINK, ...options });
    this.accountId = str(options.accountId);
    this.token = str(options.token);
    this.baseUrl = (str(options.baseUrl) || DEFAULT_ILINK_BASE_URL).replace(/\/+$/, '');
    this.longPollTimeoutMs = Number(options.longPollTimeoutMs) || LONG_POLL_TIMEOUT_MS;
    this.sessionExpiredPauseMs = Number(options.sessionExpiredPauseMs) || SESSION_EXPIRED_PAUSE_MS;
    this.typingEnabled = options.typing !== false;
    this.loadState = typeof options.loadState === 'function' ? options.loadState : async () => null;
    this.saveState = typeof options.saveState === 'function' ? options.saveState : async () => {};

    /** @type {string} */
    this.syncBuf = '';
    /** @type {Map<string, string>} */
    this.contextTokens = new Map();
    /** @type {Map<string, { ticket: string, at: number }>} */
    this.typingTickets = new Map();

    this._pollAbort = null;
    /** @type {Set<AbortController>} 正在进行的发送请求，用于 stop 时统一取消。 */
    this._inFlight = new Set();
    this._stopping = false;

    this.reconnect = new ReconnectLoop({
      task: async () => {
        await this._pollOnce();
        // 单次轮询成功即视为「已连上」；长轮询本身是循环，不需要外部再调度。
      },
      onError: (error, attempt) => {
        this.setStatus(STATUS.error, `轮询第 ${attempt} 次失败：${describeError(error)}`);
      },
      now: this.now,
      backoff: { initialMs: 2000, maxMs: 60000, factor: 2 },
    });
  }

  /** @returns {import('./base.js').ChannelCapabilities} */
  get capabilities() {
    // iLink 不支持 markdown 渲染，也不支持卡片；只能纯文本。
    return {
      markdown: false,
      templateCard: false,
      proactivePush: true,
      typing: this.typingEnabled,
      textLimit: 2000,
      markdownBytes: 0,
    };
  }

  /**
   * 建立连接：先恢复游标与 context_token，再启动轮询环。
   * @returns {Promise<void>}
   */
  async _connect() {
    if (this.accountId === '') throw new Error('缺少 accountId，请先在设置页扫码登录');
    if (this.token === '') throw new Error('缺少 token，请先在设置页扫码登录');
    this._stopping = false;
    await this._restoreState();
    // 先探一次，确认凭据有效；失败直接抛给 start()，避免「看起来在线但收不到」。
    await this._probe();
    this._startPollLoop();
  }

  /**
   * 恢复持久化状态。
   * @returns {Promise<void>}
   */
  async _restoreState() {
    try {
      const sync = await this.loadState('sync');
      this.syncBuf = str(sync?.get_updates_buf);
    } catch (error) {
      this.log('warn', `[${this.kind}] 恢复游标失败：${describeError(error)}`);
      this.syncBuf = '';
    }
    try {
      const tokens = await this.loadState('contextTokens');
      this.contextTokens = new Map();
      if (tokens !== null && typeof tokens === 'object') {
        for (const [key, value] of Object.entries(tokens)) {
          const token = str(value);
          if (token !== '') this.contextTokens.set(key, token);
        }
      }
    } catch (error) {
      this.log('warn', `[${this.kind}] 恢复 context_token 失败：${describeError(error)}`);
      this.contextTokens = new Map();
    }
  }

  /**
   * 持久化游标。
   * @returns {Promise<void>}
   */
  async _persistSync() {
    try {
      await this.saveState('sync', { get_updates_buf: this.syncBuf });
    } catch (error) {
      this.log('warn', `[${this.kind}] 保存游标失败：${describeError(error)}`);
    }
  }

  /**
   * 持久化 context_token。
   * @returns {Promise<void>}
   */
  async _persistContextTokens() {
    try {
      await this.saveState('contextTokens', Object.fromEntries(this.contextTokens));
    } catch (error) {
      this.log('warn', `[${this.kind}] 保存 context_token 失败：${describeError(error)}`);
    }
  }

  /**
   * 一次性探活：发一个空游标的 getupdates（带短超时），只看鉴权结果。
   * @returns {Promise<void>}
   */
  async _probe() {
    // 用 sendtyping 的 getconfig 更轻，但它需要 typing_ticket 的副作用。
    // 直接打 getupdates 且不推进游标，语义最干净。
    const response = await this._post(EP.getUpdates, { get_updates_buf: this.syncBuf }, 8000);
    if (isSessionExpired(response)) {
      throw new Error('iLink 会话已过期，请重新扫码登录');
    }
    if (Number(response?.ret) !== 0 && response?.ret !== undefined) {
      throw new Error(`iLink 鉴权失败：ret=${response.ret} ${str(response.errmsg)}`);
    }
    if (Number(response?.errcode) !== 0 && response?.errcode !== undefined) {
      throw new Error(`iLink 鉴权失败：errcode=${response.errcode} ${str(response.errmsg)}`);
    }
  }

  /**
   * 启动轮询环（不阻塞 `_connect`）。
   */
  _startPollLoop() {
    const controller = new AbortController();
    this._pollAbort = controller;
    void this._pollLoop(controller.signal);
  }

  /**
   * 长轮询主循环。
   * @param {AbortSignal} signal
   * @returns {Promise<void>}
   */
  async _pollLoop(signal) {
    let consecutiveFailures = 0;
    let timeoutMs = this.longPollTimeoutMs;

    while (!signal.aborted && !this._stopping) {
      try {
        const response = await this._post(
          EP.getUpdates,
          { get_updates_buf: this.syncBuf },
          timeoutMs,
          signal,
        );
        // 服务端可以调整建议的超时；照它来能减少无效重连。
        const suggested = Number(response?.longpolling_timeout_ms);
        if (Number.isFinite(suggested) && suggested > 0) timeoutMs = suggested;

        if (isSessionExpired(response)) {
          this.setStatus(STATUS.error, 'iLink 会话已过期，请重新扫码登录');
          this.log('warn', `[${this.kind}] 会话过期，暂停 ${Math.round(this.sessionExpiredPauseMs / 1000)}s`);
          await this._sleep(this.sessionExpiredPauseMs, signal);
          consecutiveFailures = 0;
          continue;
        }
        if (isRateLimited(response)) {
          this.log('warn', `[${this.kind}] 轮询被限流，退避 ${Math.round(BACKOFF_DELAY_MS / 1000)}s`);
          await this._sleep(BACKOFF_DELAY_MS, signal);
          continue;
        }
        const ret = Number(response?.ret ?? 0);
        const errcode = Number(response?.errcode ?? 0);
        if (ret !== 0 || errcode !== 0) {
          consecutiveFailures += 1;
          this.log('warn', `[${this.kind}] getupdates ret=${ret} errcode=${errcode} ${str(response?.errmsg)}（${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}）`);
          await this._sleep(consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? BACKOFF_DELAY_MS : RETRY_DELAY_MS, signal);
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) consecutiveFailures = 0;
          continue;
        }

        consecutiveFailures = 0;
        if (this.status !== STATUS.online) this.setStatus(STATUS.online);

        const nextBuf = str(response?.get_updates_buf);
        if (nextBuf !== '' && nextBuf !== this.syncBuf) {
          this.syncBuf = nextBuf;
          await this._persistSync();
        }

        const messages = Array.isArray(response?.msgs) ? response.msgs : [];
        for (const message of messages) {
          this._acceptMessage(message);
        }
      } catch (error) {
        if (signal.aborted || this._stopping) break;
        consecutiveFailures += 1;
        const message = describeError(error);
        // 长轮询超时是正常现象（35s 没消息），不该当失败。
        const isTimeout = /timeout|aborted/i.test(message);
        if (!isTimeout) {
          this.log('warn', `[${this.kind}] poll error（${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}）：${message}`);
        }
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          this.setStatus(STATUS.error, `轮询连续失败：${message}`);
          consecutiveFailures = 0;
        }
        await this._sleep(isTimeout ? 0 : (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? BACKOFF_DELAY_MS : RETRY_DELAY_MS), signal);
      }
    }
  }

  /**
   * 收下一条消息：记 context_token、登记 typing ticket、派发。
   * @param {Record<string, any>} message
   */
  _acceptMessage(message) {
    const event = normalizeIlinkMessage(message, this.accountId);
    if (event === null) return;
    const contextToken = str(message?.context_token);
    if (contextToken !== '') {
      this.contextTokens.set(event.peer, contextToken);
      void this._persistContextTokens();
      // typing ticket 要跟着最新的 context_token 一起取，否则会拿不到。
      if (this.typingEnabled) void this._refreshTypingTicket(event.peer, contextToken);
    }
    this.dispatchInbound(event);
  }

  /**
   * 拉取并缓存 typing_ticket。
   * @param {string} peer
   * @param {string} [contextToken]
   * @returns {Promise<string>}
   */
  async _refreshTypingTicket(peer, contextToken) {
    try {
      const response = await this._post(
        EP.getConfig,
        {
          ilink_user_id: peer,
          ...(contextToken === undefined || contextToken === '' ? {} : { context_token: contextToken }),
        },
        CONFIG_TIMEOUT_MS,
      );
      const ticket = str(response?.typing_ticket);
      if (ticket !== '') this.typingTickets.set(peer, { ticket, at: this.now() });
      return ticket;
    } catch (error) {
      this.log('warn', `[${this.kind}] 获取 typing_ticket 失败：${describeError(error)}`);
      return '';
    }
  }

  /**
   * 取一个仍在 TTL 内的 ticket；过期则重新拉。
   * @param {string} peer
   * @returns {Promise<string>}
   */
  async _typingTicket(peer) {
    const cached = this.typingTickets.get(peer);
    if (cached !== undefined && this.now() - cached.at < TYPING_TICKET_TTL_MS) return cached.ticket;
    return this._refreshTypingTicket(peer, this.contextTokens.get(peer));
  }

  /**
   * 发送「正在输入」状态（失败静默：这只是体验增强）。
   * @param {string} peer
   * @param {number} status TYPING.start | TYPING.stop
   * @returns {Promise<void>}
   */
  async sendTyping(peer, status) {
    if (!this.typingEnabled) return;
    const ticket = await this._typingTicket(peer);
    if (ticket === '') return;
    try {
      await this._post(
        EP.sendTyping,
        { ilink_user_id: peer, typing_ticket: ticket, status },
        CONFIG_TIMEOUT_MS,
      );
    } catch (error) {
      this.log('warn', `[${this.kind}] sendtyping 失败：${describeError(error)}`);
    }
  }

  /**
   * 发一条纯文本，带「过期去 token 重试一次」的降级。
   * @param {string} peer
   * @param {string} text
   * @param {{ signal?: AbortSignal }} [_options]
   * @returns {Promise<string>}
   */
  async _sendText(peer, text, _options) {
    const target = str(peer);
    if (target === '') throw new Error('peer 不能为空');
    const clientId = `dsh-im-bot-${requestId()}`;
    const baseMessage = {
      from_user_id: '',
      to_user_id: target,
      client_id: clientId,
      message_type: MSG_TYPE_BOT,
      message_state: MSG_STATE_FINISH,
      item_list: [{ type: ITEM.text, text_item: { text } }],
    };

    const contextToken = this.contextTokens.get(target);
    let response = await this._post(
      EP.sendMessage,
      { msg: contextToken === undefined ? baseMessage : { ...baseMessage, context_token: contextToken } },
      API_TIMEOUT_MS,
    );

    // 会话过期时官方接受无 context_token 的降级发送，这是通知能发出去的关键。
    if (isSessionExpired(response) && contextToken !== undefined) {
      this.log('info', `[${this.kind}] context_token 过期，改用无 token 重试`);
      this.contextTokens.delete(target);
      void this._persistContextTokens();
      response = await this._post(EP.sendMessage, { msg: baseMessage }, API_TIMEOUT_MS);
    }

    if (!isSendOk(response)) {
      throw new Error(`iLink 发送失败：ret=${response?.ret} errcode=${response?.errcode} ${str(response?.errmsg)}`);
    }
    return str(response?.message_id) || clientId;
  }

  /**
   * iLink 不认识 markdown，基类会自动降级；这里显式再兜一层，
   * 避免将来有人直接调 `_sendMarkdown` 时行为不一致。
   * @param {string} peer
   * @param {string} markdown
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<string>}
   */
  async _sendMarkdown(peer, markdown, options) {
    return this._sendText(peer, markdown, options);
  }

  /**
   * 停止：取消轮询与在途请求。
   * @returns {Promise<void>}
   */
  async _disconnect() {
    this._stopping = true;
    this.reconnect.stop();
    this._pollAbort?.abort();
    this._pollAbort = null;
    for (const controller of this._inFlight) {
      controller.abort();
    }
    this._inFlight.clear();
    this.typingTickets.clear();
  }

  /**
   * 发一个 POST 请求。
   * @param {string} endpoint
   * @param {Record<string, unknown>} payload
   * @param {number} timeoutMs
   * @param {AbortSignal} [outerSignal]
   * @returns {Promise<Record<string, any>>}
   */
  async _post(endpoint, payload, timeoutMs, outerSignal) {
    if (typeof this.fetchImpl !== 'function') throw new Error('当前运行时不提供 fetch');
    const body = JSON.stringify({ ...payload, base_info: { channel_version: CHANNEL_VERSION } });
    const url = `${this.baseUrl}/${endpoint}`;
    const controller = new AbortController();
    this._inFlight.add(controller);
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    timer?.unref?.();
    const onOuterAbort = () => controller.abort(new Error('aborted'));
    outerSignal?.addEventListener('abort', onOuterAbort, { once: true });

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: buildHeaders(body, this.token),
        body,
        signal: controller.signal,
      });
      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`iLink ${endpoint} HTTP ${response.status}: ${raw.slice(0, 200)}`);
      }
      if (raw.trim() === '') return {};
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`iLink ${endpoint} 返回了非对象 JSON`);
      }
      return parsed;
    } finally {
      clearTimeout(timer);
      outerSignal?.removeEventListener('abort', onOuterAbort);
      this._inFlight.delete(controller);
    }
  }

  /**
   * 可被中止的 sleep。
   * @param {number} ms
   * @param {AbortSignal} signal
   * @returns {Promise<void>}
   */
  _sleep(ms, signal) {
    if (signal.aborted || this._stopping) return Promise.resolve();
    if (!(ms > 0)) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      timer?.unref?.();
      const onAbort = () => done();
      function done() {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve();
      }
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

/**
 * 判断一次发送响应是否成功。
 * @param {Record<string, any>} response
 * @returns {boolean}
 */
export function isSendOk(response) {
  const ret = response?.ret;
  const errcode = response?.errcode;
  const retOk = ret === undefined || ret === null || Number(ret) === 0;
  const errOk = errcode === undefined || errcode === null || Number(errcode) === 0;
  return retOk && errOk;
}

// ---------------------------------------------------------------------------
// 扫码登录（与通道实例解耦：登录时通道还没起来）
// ---------------------------------------------------------------------------

/**
 * 扫码登录状态机。
 *
 * 设置面板点「扫码登录」→ 宿主 `start()` → 前端轮询 `poll()`。
 * 这里刻意不自己发网络请求之外的事情：二维码图片由前端直接用
 * `qrcode_img_content`（企微/微信的 liteapp URL）渲染。
 */
export class IlinkLoginSession {
  /**
   * @param {object} options
   * @param {string} [options.baseUrl]
   * @param {string} [options.botType]
   * @param {typeof fetch} [options.fetch]
   * @param {() => number} [options.now]
   * @param {(level: string, message: string, error?: unknown) => void} [options.log]
   */
  constructor(options = {}) {
    this.baseUrl = (str(options.baseUrl) || DEFAULT_ILINK_BASE_URL).replace(/\/+$/, '');
    this.botType = str(options.botType) || '3';
    this.fetchImpl = typeof options.fetch === 'function' ? options.fetch : globalThis.fetch;
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.log = typeof options.log === 'function' ? options.log : () => {};

    /** @type {''|'wait'|'scaned'|'scaned_but_redirect'|'expired'|'confirmed'|'error'} */
    this.status = '';
    this.qrcode = '';
    this.qrcodeUrl = '';
    this.message = '';
    /** @type {{ accountId: string, token: string, baseUrl: string, userId: string } | null} */
    this.credentials = null;
    this.baseUrlForPoll = this.baseUrl;
    this._expiredRefreshCount = 0;
    this._startedAt = 0;
  }

  /** 状态快照（给前端）。 */
  snapshot() {
    return {
      status: this.status,
      qrcode: this.qrcode,
      qrcodeUrl: this.qrcodeUrl,
      message: this.message,
      ...(this.credentials === null ? {} : { credentials: this.credentials }),
    };
  }

  /**
   * 开始登录：取二维码。
   * @returns {Promise<ReturnType<IlinkLoginSession['snapshot']>>}
   */
  async start() {
    this.status = '';
    this.message = '';
    this.credentials = null;
    this._expiredRefreshCount = 0;
    this._startedAt = this.now();
    const response = await this._get(`${EP.getBotQr}?bot_type=${encodeURIComponent(this.botType)}`);
    const qrcode = str(response?.qrcode);
    const qrcodeUrl = str(response?.qrcode_img_content);
    if (qrcode === '') {
      this.status = 'error';
      this.message = '未能取得二维码，请稍后重试';
      return this.snapshot();
    }
    this.qrcode = qrcode;
    this.qrcodeUrl = qrcodeUrl || qrcode;
    this.status = 'wait';
    return this.snapshot();
  }

  /**
   * 轮询一次扫码状态。
   * @returns {Promise<ReturnType<IlinkLoginSession['snapshot']>>}
   */
  async poll() {
    if (this.qrcode === '') {
      this.status = 'error';
      this.message = '尚未开始登录';
      return this.snapshot();
    }
    if (this.status === 'confirmed' || this.status === 'error') return this.snapshot();

    const response = await this._get(
      `${EP.getQrStatus}?qrcode=${encodeURIComponent(this.qrcode)}`,
      this.baseUrlForPoll,
    );
    const status = str(response?.status) || 'wait';

    if (status === 'wait') {
      this.status = 'wait';
      this.message = '等待扫码';
      return this.snapshot();
    }
    if (status === 'scaned') {
      this.status = 'scaned';
      this.message = '已扫码，请在微信里确认';
      return this.snapshot();
    }
    if (status === 'scaned_but_redirect') {
      // 服务端要求换域名继续轮询（跨集群登录）。
      const host = str(response?.redirect_host);
      this.status = 'scaned_but_redirect';
      this.message = '已扫码，正在切换接入点…';
      if (host !== '') this.baseUrlForPoll = `https://${host}`;
      return this.snapshot();
    }
    if (status === 'expired') {
      this._expiredRefreshCount += 1;
      if (this._expiredRefreshCount > 3) {
        this.status = 'error';
        this.message = '二维码多次过期，请重新发起登录';
        return this.snapshot();
      }
      const fresh = await this._get(`${EP.getBotQr}?bot_type=${encodeURIComponent(this.botType)}`);
      this.qrcode = str(fresh?.qrcode);
      this.qrcodeUrl = str(fresh?.qrcode_img_content) || this.qrcode;
      this.status = 'wait';
      this.message = `二维码已刷新（${this._expiredRefreshCount}/3）`;
      return this.snapshot();
    }
    if (status === 'confirmed') {
      const accountId = str(response?.ilink_bot_id);
      const token = str(response?.bot_token);
      if (accountId === '' || token === '') {
        this.status = 'error';
        this.message = '扫码成功但凭据不完整，请重新登录';
        return this.snapshot();
      }
      this.status = 'confirmed';
      this.message = '登录成功';
      this.credentials = {
        accountId,
        token,
        baseUrl: str(response?.baseurl) || this.baseUrl,
        userId: str(response?.ilink_user_id),
      };
      return this.snapshot();
    }

    this.status = 'wait';
    this.message = `未知状态：${status}`;
    return this.snapshot();
  }

  /**
   * @param {string} pathWithQuery
   * @param {string} [baseUrl]
   * @returns {Promise<Record<string, any>>}
   */
  async _get(pathWithQuery, baseUrl) {
    if (typeof this.fetchImpl !== 'function') throw new Error('当前运行时不提供 fetch');
    const base = (baseUrl ?? this.baseUrl).replace(/\/+$/, '');
    const response = await this.fetchImpl(`${base}/${pathWithQuery}`, {
      method: 'GET',
      headers: {
        'iLink-App-Id': ILINK_APP_ID,
        'iLink-App-ClientVersion': String(ILINK_APP_CLIENT_VERSION),
      },
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`iLink ${pathWithQuery} HTTP ${response.status}: ${raw.slice(0, 200)}`);
    if (raw.trim() === '') return {};
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  }
}
