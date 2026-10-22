/**
 * 企业微信 · 智能机器人长连接通道（API 模式）。
 *
 * 协议依据企业微信官方文档「智能机器人长连接」（/document/path/101463）：
 *
 *   1. 连 `wss://openws.work.weixin.qq.com`，握手后发 `aibot_subscribe`
 *      （body.bot_id + body.secret），`errcode: 0` 即订阅成功。
 *   2. 入站两种回调：
 *      - `aibot_msg_callback`：用户消息（text/image/mixed/voice/file/video）。
 *      - `aibot_event_callback`：`enter_chat` / `template_card_event` /
 *        `feedback_event` / `disconnected_event`。
 *   3. 出站：
 *      - `aibot_respond_msg`：回应用户消息，**必须透传回调的 req_id**；
 *        24 小时内可回。
 *      - `aibot_send_msg`：主动推送（`chatid` + `chat_type` 1 单聊 / 2 群聊），
 *        前提是用户先给机器人发过消息。
 *      - `aibot_respond_welcome_msg`：进入会话事件后 5 秒内回欢迎语。
 *   4. 心跳：每 30 秒发 `{"cmd":"ping"}`，服务端回 `pong`/`errcode:0`。
 *   5. **单连接约束**：同一机器人只能一条长连接。新连接会踢掉旧连接，旧连接
 *      收到 `disconnected_event`。因此重连必须走退避，不能在收到被踢后立刻
 *      重连，否则两个实例会无限互踢。
 *
 * 关键实现取舍：
 *   - 主动推送优先用 `aibot_send_msg`（不依赖 req_id，可在任意时刻发）；
 *     只有「刚收到消息且 req_id 还在 24h 窗口内」时才用 `aibot_respond_msg`。
 *     这使通知（需求③）不依赖用户是否刚刚说过话。
 *   - `chat_type` 必须显式给（1 单聊 / 2 群聊）：官方说明不填时「优先按群聊
 *     解析」，会把单聊 userid 当群 id 发失败。
 *   - 群聊场景下 `chatid` 是群 id，`from.userid` 是发言人，两者都要留：
 *     投递会话用 chatid（回推回群里），白名单校验用 from。
 *
 * @module dsh-im-bot/channels/wecom
 */

import { BaseChannel, ReconnectLoop, STATUS, describeError } from './base.js';
import { CHANNEL_WECOM, normalizeInbound, requestId, str, truncate } from '../core.js';

/** 官方长连接地址。 */
export const DEFAULT_WECOM_WS_URL = 'wss://openws.work.weixin.qq.com';

/** 命令常量。 */
export const CMD = {
  subscribe: 'aibot_subscribe',
  ping: 'ping',
  msgCallback: 'aibot_msg_callback',
  eventCallback: 'aibot_event_callback',
  respondMsg: 'aibot_respond_msg',
  respondWelcome: 'aibot_respond_welcome_msg',
  respondUpdateMsg: 'aibot_respond_update_msg',
  sendMsg: 'aibot_send_msg',
};

/** 会话类型：`aibot_send_msg` 的 chat_type 取值。 */
export const CHAT_TYPE_SINGLE = 1;
export const CHAT_TYPE_GROUP = 2;

/** 心跳间隔（官方建议 30 秒）。 */
export const DEFAULT_HEARTBEAT_SECONDS = 30;

/**
 * 从 `aibot_msg_callback` 的 body 里提取纯文本。
 *
 * 与 iLink 不同，企微的 `mixed` 是图文混排，需要把其中的 text 段拼起来；
 * 语音只取官方 STT 结果（没有原始音频下载时）。
 *
 * @param {Record<string, unknown>} body
 * @returns {string}
 */
export function extractWecomText(body) {
  if (body === null || typeof body !== 'object') return '';
  const msgtype = str(body.msgtype);
  if (msgtype === 'text') {
    const text = body.text;
    return text !== null && typeof text === 'object' ? str(/** @type {Record<string, unknown>} */ (text).content) : '';
  }
  if (msgtype === 'mixed') {
    const mixed = body.mixed;
    if (mixed === null || typeof mixed !== 'object') return '';
    const items = /** @type {Record<string, unknown>} */ (mixed).msg_item;
    if (!Array.isArray(items)) return '';
    const parts = [];
    for (const item of items) {
      if (item === null || typeof item !== 'object') continue;
      const record = /** @type {Record<string, unknown>} */ (item);
      if (str(record.msgtype) !== 'text') continue;
      const text = record.text;
      if (text === null || typeof text !== 'object') continue;
      const content = str(/** @type {Record<string, unknown>} */ (text).content);
      if (content !== '') parts.push(content);
    }
    return parts.join('\n');
  }
  if (msgtype === 'voice') {
    const voice = body.voice;
    return voice !== null && typeof voice === 'object' ? str(/** @type {Record<string, unknown>} */ (voice).content) : '';
  }
  // image / file / video 本期不转文本，交由调用方按「无文本」处理。
  return '';
}

/**
 * 把一条 `aibot_msg_callback` 归一化成 InboundEvent；不是用户消息时返回 null。
 * @param {Record<string, unknown>} envelope 完整 ws 帧（含 cmd/headers/body）
 * @returns {import('../core.js').InboundEvent | null}
 */
export function normalizeWecomMessage(envelope) {
  const body = envelope?.body;
  if (body === null || typeof body !== 'object') return null;
  const record = /** @type {Record<string, unknown>} */ (body);
  const chatType = str(record.chattype) === 'group' ? 'group' : 'single';
  const chatid = str(record.chatid);
  const from = record.from;
  const userId = from !== null && typeof from === 'object'
    ? str(/** @type {Record<string, unknown>} */ (from).userid)
    : '';
  // 群聊寻址用 chatid；单聊没有 chatid，用发言人的 userid。
  const peer = chatType === 'group' ? (chatid || userId) : (userId || chatid);
  if (peer === '') return null;

  const text = extractWecomText(record);
  const msgtype = str(record.msgtype);
  const replyToken = str(envelope?.headers?.req_id);

  return normalizeInbound({
    channel: CHANNEL_WECOM,
    peer,
    chatType,
    text,
    messageId: str(record.msgid),
    replyToken,
    from: userId,
  });
}

/**
 * 从事件回调里识别出「连接被踢」。
 * @param {Record<string, unknown>} envelope
 * @returns {boolean}
 */
export function isDisconnectedEvent(envelope) {
  if (str(envelope?.cmd) !== CMD.eventCallback) return false;
  const body = envelope?.body;
  if (body === null || typeof body !== 'object') return false;
  const event = /** @type {Record<string, unknown>} */ (body).event;
  if (event === null || typeof event !== 'object') return false;
  return str(/** @type {Record<string, unknown>} */ (event).eventtype) === 'disconnected_event';
}

/**
 * 从事件回调里取事件类型。
 * @param {Record<string, unknown>} envelope
 * @returns {string}
 */
export function eventTypeOf(envelope) {
  const body = envelope?.body;
  if (body === null || typeof body !== 'object') return '';
  const event = /** @type {Record<string, unknown>} */ (body).event;
  if (event === null || typeof event !== 'object') return '';
  return str(/** @type {Record<string, unknown>} */ (event).eventtype);
}

/**
 * 企业微信长连接通道。
 */
export class WecomChannel extends BaseChannel {
  /**
   * @param {object} options
   * @param {string} options.botId
   * @param {string} options.secret
   * @param {string} [options.baseUrl]
   * @param {number} [options.heartbeatSeconds]
   * @param {number} [options.heartbeatTimeoutCount]
   * @param {typeof WebSocket} [options.WebSocketImpl] 注入的 WebSocket 实现（测试用）
   * @param {import('node:events').EventEmitter} [options.bus]
   * @param {() => number} [options.now]
   * @param {(level: string, message: string, error?: unknown) => void} [options.log]
   */
  constructor(options) {
    super({ kind: CHANNEL_WECOM, ...options });
    this.botId = str(options.botId);
    this.secret = str(options.secret);
    this.baseUrl = str(options.baseUrl) || DEFAULT_WECOM_WS_URL;
    this.heartbeatMs = (Number(options.heartbeatSeconds) || DEFAULT_HEARTBEAT_SECONDS) * 1000;
    this.heartbeatTimeoutCount = Math.max(1, Number(options.heartbeatTimeoutCount) || 3);
    this.WebSocketImpl = typeof options.WebSocketImpl === 'function' ? options.WebSocketImpl : globalThis.WebSocket;

    /** @type {WebSocket | null} */
    this.socket = null;
    this._subscribed = false;
    this._takenOver = false;
    this._missedPongs = 0;
    /** @type {unknown} */
    this._heartbeatTimer = null;
    /** 最近一次入站消息的 req_id，用于在窗口内优先走 respond（回执更准）。 */
    this._lastReplyToken = '';
    /** @type {Map<string, number>} 见过的 peer → chat_type，主动推送时据此选对寻址方式。 */
    this._peerTypes = new Map();

    this.reconnect = new ReconnectLoop({
      task: () => this._openSocket(),
      onError: (error, attempt) => {
        this.setStatus(STATUS.error, `重连第 ${attempt} 次失败：${describeError(error)}`);
      },
      now: this.now,
      backoff: { initialMs: 1000, maxMs: 60000, factor: 2 },
    });
  }

  /** @returns {import('./base.js').ChannelCapabilities} */
  get capabilities() {
    return {
      markdown: true,
      templateCard: true,
      proactivePush: true,
      typing: false,
      textLimit: 2000,
      markdownBytes: 20000,
    };
  }

  /**
   * 建立连接。凭据缺失时直接抛错，避免无意义的重连风暴。
   * @returns {Promise<void>}
   */
  async _connect() {
    if (this.botId === '') throw new Error('缺少 BotID，请先在设置页填写');
    if (this.secret === '') throw new Error('缺少 Secret，请先在设置页填写');
    if (typeof this.WebSocketImpl !== 'function') {
      throw new Error('当前 Node 运行时不提供 WebSocket（需要 Node 22+）');
    }
    this._takenOver = false;
    this.reconnect.restart();
    await this._openSocket();
  }

  /**
   * 打开 WebSocket 并等待订阅成功。
   * @returns {Promise<void>}
   */
  _openSocket() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finishOk = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const finishErr = (error) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      let socket;
      try {
        socket = new this.WebSocketImpl(this.baseUrl);
      } catch (error) {
        finishErr(error);
        return;
      }
      this.socket = socket;
      this._subscribed = false;
      this._missedPongs = 0;

      const timeout = setTimeout(() => {
        finishErr(new Error('订阅超时（30s 内未收到 aibot_subscribe 响应）'));
        try {
          socket.close();
        } catch {
          /* 已经关了 */
        }
      }, 30000);

      socket.addEventListener('open', () => {
        this._writeFrame({
          cmd: CMD.subscribe,
          headers: { req_id: requestId() },
          body: { bot_id: this.botId, secret: this.secret },
        });
      });

      socket.addEventListener('message', (event) => {
        const frame = parseFrame(event?.data);
        if (frame === null) return;

        // 订阅响应：errcode 0 才算成功。
        if (this._subscribed === false && str(frame.cmd) === '' && frame.errcode !== undefined) {
          if (Number(frame.errcode) === 0) {
            this._subscribed = true;
            clearTimeout(timeout);
            this._startHeartbeat();
            this.reconnect.reset();
            this.setStatus(STATUS.online);
            finishOk();
          } else {
            clearTimeout(timeout);
            finishErr(new Error(`订阅被拒绝：errcode=${frame.errcode} ${str(frame.errmsg)}`));
          }
          return;
        }

        // 心跳回包：重置丢失计数。
        if (Number(frame.errcode) === 0 && str(frame.cmd) === '') {
          this._missedPongs = 0;
          return;
        }

        this._handleFrame(frame);
      });

      socket.addEventListener('error', (event) => {
        const message = describeError(event?.error ?? event?.message ?? 'websocket error');
        this.setStatus(STATUS.error, message);
        finishErr(new Error(message));
      });

      socket.addEventListener('close', () => {
        clearTimeout(timeout);
        this._stopHeartbeat();
        this.socket = null;
        if (this._subscribed === false) {
          finishErr(new Error('连接在订阅完成前关闭'));
          return;
        }
        this._subscribed = false;
        if (this._started === false) {
          this.setStatus(STATUS.idle);
          return;
        }
        if (this._takenOver === true) {
          // 收到新连接接管事件时，不触发自动重连，避免两端无休止互踢。
          this.setStatus(STATUS.error, '已被新连接接管（同一机器人只允许一条长连接）');
          return;
        }
        // 普通断网：进入退避重连。
        this.setStatus(STATUS.error, '连接已断开，正在退避重连');
        this.reconnect.scheduleNext();
      });
    });
  }

  /**
   * 处理一帧已订阅后的消息。
   * @param {Record<string, any>} frame
   */
  _handleFrame(frame) {
    const cmd = str(frame.cmd);

    if (cmd === CMD.msgCallback) {
      const event = normalizeWecomMessage(frame);
      if (event === null) return;
      if (event.replyToken !== undefined) this._lastReplyToken = event.replyToken;
      if (event.text.trim() === '') {
        // 媒体消息本期不处理，但要给用户一个明确回应，否则对方以为机器人挂了。
        if (event.replyToken !== undefined) {
          void this.sendText(event.peer, '（当前仅支持文本消息）');
        }
        return;
      }
      this.dispatchInbound(event);
      return;
    }

    if (cmd === CMD.eventCallback) {
      if (isDisconnectedEvent(frame)) {
        // 官方明确：新连接会踢掉旧连接并下发该事件。这里标记已被接管并停止重连，
        // 防止退避重试后反过来踢掉新连接，导致双端死循环互踢。
        this._takenOver = true;
        this.reconnect.stop();
        this.setStatus(STATUS.error, '已被新连接接管（同一机器人只允许一条长连接）');
        try {
          this.socket?.close();
        } catch {
          /* 已经关了 */
        }
        return;
      }
      const eventtype = eventTypeOf(frame);
      this.bus?.emit?.('wecom-event', { kind: this.kind, eventtype, frame });
      return;
    }

    // 捕获服务端的错误应答（如 aibot_send_msg 失败、限流等）
    if (str(cmd) === '' && frame?.errcode !== undefined && Number(frame.errcode) !== 0) {
      const errMsg = `企微响应错误：errcode=${frame.errcode} ${str(frame.errmsg)}`;
      this.log('warn', `[${this.kind}] ${errMsg}`);
      this.setStatus(STATUS.error, errMsg);
      return;
    }
  }

  /** 启动心跳。 */
  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (this.socket === null) return;
      this._missedPongs += 1;
      if (this._missedPongs > this.heartbeatTimeoutCount) {
        this.log('warn', `[${this.kind}] 心跳超时 ${this._missedPongs} 次，判定连接假死`);
        this.setStatus(STATUS.error, '心跳超时，正在重连');
        try {
          this.socket.close();
        } catch {
          /* 已经关了 */
        }
        return;
      }
      this._writeFrame({ cmd: CMD.ping, headers: { req_id: requestId() } });
    }, this.heartbeatMs);
    // 不要让心跳定时器拖住进程退出。
    this._heartbeatTimer?.unref?.();
  }

  /** 停心跳。 */
  _stopHeartbeat() {
    if (this._heartbeatTimer === null) return;
    clearInterval(/** @type {any} */ (this._heartbeatTimer));
    this._heartbeatTimer = null;
  }

  /**
   * 发一帧。
   * @param {Record<string, unknown>} frame
   * @returns {boolean} 是否已写出
   */
  _writeFrame(frame) {
    const socket = this.socket;
    if (socket === null || socket.readyState !== 1) return false;
    try {
      socket.send(JSON.stringify(frame));
      return true;
    } catch (error) {
      this.log('warn', `[${this.kind}] send frame failed: ${describeError(error)}`);
      return false;
    }
  }

  /**
   * 断开连接并停止重连。
   * @returns {Promise<void>}
   */
  async _disconnect() {
    this.reconnect.stop();
    this._stopHeartbeat();
    this._subscribed = false;
    const socket = this.socket;
    this.socket = null;
    if (socket === null) return;
    await new Promise((resolve) => {
      const done = () => resolve(undefined);
      try {
        socket.addEventListener('close', done, { once: true });
        socket.close();
      } catch {
        resolve(undefined);
        return;
      }
      // 兜底：某些实现不会触发 close。
      setTimeout(done, 2000)?.unref?.();
    });
  }

  /**
   * 发一条纯文本。优先 `aibot_send_msg`（不依赖 req_id），这样通知也能发。
   * @param {string} peer
   * @param {string} text
   * @param {{ signal?: AbortSignal }} [_options]
   * @returns {Promise<string>}
   */
  async _sendText(peer, text, _options) {
    const target = str(peer);
    if (target === '') throw new Error('peer 不能为空');
    const chatType = this._chatTypeFor(target);
    const ok = this._writeFrame({
      cmd: CMD.sendMsg,
      headers: { req_id: requestId() },
      body: {
        chatid: target,
        chat_type: chatType,
        msgtype: 'text',
        text: { content: text },
      },
    });
    if (!ok) throw new Error('长连接未就绪，消息未发出');
    return '';
  }

  /**
   * 发一条 markdown。markdown 在企微里渲染更好，通知优先用它。
   * @param {string} peer
   * @param {string} markdown
   * @param {{ signal?: AbortSignal }} [_options]
   * @returns {Promise<string>}
   */
  async _sendMarkdown(peer, markdown, _options) {
    const target = str(peer);
    if (target === '') throw new Error('peer 不能为空');
    const chatType = this._chatTypeFor(target);
    const ok = this._writeFrame({
      cmd: CMD.sendMsg,
      headers: { req_id: requestId() },
      body: {
        chatid: target,
        chat_type: chatType,
        msgtype: 'markdown',
        markdown: { content: markdown },
      },
    });
    if (!ok) throw new Error('长连接未就绪，消息未发出');
    return '';
  }

  /**
   * 用 `aibot_respond_msg` 回应某次回调（保留给需要「引用原消息」的场景）。
   * @param {string} replyToken 回调里的 req_id
   * @param {string} text
   * @returns {boolean}
   */
  respond(replyToken, text) {
    const token = str(replyToken);
    if (token === '') return false;
    return this._writeFrame({
      cmd: CMD.respondMsg,
      headers: { req_id: token },
      body: { msgtype: 'text', text: { content: text } },
    });
  }

  /**
   * 判断某个 peer 是单聊还是群聊。
   *
   * 企微不给「这个 id 是群还是人」的查询接口，所以只能靠登记：入站时记下
   * 见过的 peer 类型，主动推送时按记忆发；没见过则按单聊尝试（最常见）。
   * @param {string} peer
   * @returns {number}
   */
  _chatTypeFor(peer) {
    const known = this._peerTypes.get(peer);
    if (known === CHAT_TYPE_GROUP) return CHAT_TYPE_GROUP;
    if (known === CHAT_TYPE_SINGLE) return CHAT_TYPE_SINGLE;
    return CHAT_TYPE_SINGLE;
  }

  /**
   * 登记 peer 的会话类型（由宿主在收到入站时调用）。
   * @param {string} peer
   * @param {'single'|'group'} chatType
   */
  rememberPeerType(peer, chatType) {
    const target = str(peer);
    if (target === '') return;
    this._peerTypes.set(target, chatType === 'group' ? CHAT_TYPE_GROUP : CHAT_TYPE_SINGLE);
  }
}

/**
 * 解析 ws 帧。非 JSON 或形状不对时返回 null（脏帧不该打断整个连接）。
 * @param {unknown} data
 * @returns {Record<string, any> | null}
 */
export function parseFrame(data) {
  if (typeof data !== 'string') {
    // Node 的 WebSocket 给的是 string；某些实现给 Buffer/ArrayBuffer。
    if (data instanceof ArrayBuffer) {
      try {
        return parseFrame(new TextDecoder().decode(data));
      } catch {
        return null;
      }
    }
    if (ArrayBuffer.isView(data)) {
      try {
        return parseFrame(new TextDecoder().decode(/** @type {any} */ (data)));
      } catch {
        return null;
      }
    }
    return null;
  }
  const text = data.trim();
  if (text === '' || text[0] !== '{') return null;
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 生成一条用于设置页「测试连接」的诊断描述。
 * @param {WecomChannel} channel
 * @returns {string}
 */
export function describeWecomState(channel) {
  const state = channel.describe();
  const suffix = state.lastError === '' ? '' : `（${truncate(state.lastError, 80)}）`;
  return `${state.status}${suffix}`;
}
