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

import { createRequire } from 'node:module';

import { BaseChannel, ReconnectLoop, STATUS, describeError } from './base.js';
import { CHANNEL_WECOM, normalizeInbound, requestId, str, truncate } from '../core.js';

/**
 * 解析一个可用的 WebSocket 实现，优先 `ws`。
 *
 * 用 `createRequire` 而不是静态 `import 'ws'`：`ws` 是**可选**依赖（DSH 宿主
 * 自己的 node_modules 里就有，插件不必重复安装）。静态 import 会让整个模块在
 * `ws` 缺失时加载失败，进而拖垮 apply —— 那就又回到「插件加载失败 → RPC 405」
 * 的老路上了。这里失败即降级，绝不影响插件其余部分。
 *
 * @returns {typeof WebSocket | undefined}
 */
export function resolveWebSocketImpl() {
  try {
    const require = createRequire(import.meta.url);
    const mod = require('ws');
    // ws 的默认导出就是构造函数；兼容 ESM 互操作时的 .default 包装。
    const Ctor = typeof mod === 'function' ? mod : mod?.default;
    if (typeof Ctor === 'function') return Ctor;
  } catch {
    /* ws 不可用，退回内置实现 */
  }
  return typeof globalThis.WebSocket === 'function' ? globalThis.WebSocket : undefined;
}

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
    /*
     * WebSocket 实现的选择（线上踩过的坑，别改回 globalThis.WebSocket）：
     *
     * Node 22 内置的 WebSocket 连企微 `wss://openws.work.weixin.qq.com` 时握手
     * 直接被拒，抛 `Received network error or non-101 status code.`；同一个地址
     * 用 `ws` 包 130ms 就能连上，`aibot_subscribe` 也能收到服务端应答
     * （错凭据会返回 errcode 853000，说明链路完全正常）。
     *
     * 内置实现不接受自定义握手头、也没有 `unexpected-response` 事件，出错时只剩
     * 一句笼统的 network error，无法排查。因此优先用 `ws`，仅当它不可用时才
     * 退回内置实现。测试可注入任意实现。
     */
    this.WebSocketImpl = typeof options.WebSocketImpl === 'function'
      ? options.WebSocketImpl
      : resolveWebSocketImpl();

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
    /**
     * 等待服务端应答的帧：req_id → 兑现回调。
     * 企微的发送应答是异步的，必须按 req_id 关联，否则业务错误会被静默吞掉。
     * @type {Map<string, (frame: Record<string, any>) => void>}
     */
    this._pendingAcks = new Map();

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

      /*
       * 事件 API 适配：`ws` 用 EventEmitter（`on(event, ...args)`，message 回调
       * 直接给 data；error 给 Error），浏览器/Node 内置实现用 EventTarget
       * （`addEventListener(event, ev)`，message 取 `ev.data`）。两种都支持，
       * 这样测试可以注入假实现、生产用 ws，代码只有一份。
       */
      const on = (event, handler) => {
        if (typeof socket.addEventListener === 'function') {
          socket.addEventListener(event, handler);
        } else if (typeof socket.on === 'function') {
          socket.on(event, handler);
        }
      };
      /** 优雅关闭；ws 的 close() 在 CONNECTING 态会抛，用 terminate 兜底。 */
      /*
       * 关闭连接。
       *
       * `ws` 在 CONNECTING 态调用 `close()` 是安全的（会中止握手），但
       * `terminate()` 在握手未完成时会**抛出未捕获的 error 事件**（
       * `WebSocket was closed before the connection was established`），
       * 那会把进程搞挂。所以 terminate 只在 open 之后用，且必须吞掉异常。
       */
      const hardClose = () => {
        try {
          socket.close();
        } catch {
          /* close 在极端状态下会抛，忽略 */
        }
      };

      const timeout = setTimeout(() => {
        finishErr(new Error('订阅超时（30s 内未收到 aibot_subscribe 响应）'));
        hardClose();
      }, 30000);

      on('open', () => {
        this._writeFrame({
          cmd: CMD.subscribe,
          headers: { req_id: requestId() },
          body: { bot_id: this.botId, secret: this.secret },
        });
      });

      on('message', (eventOrData) => {
        // EventTarget 给事件对象，ws 直接给 Buffer/string。
        const raw = eventOrData?.data !== undefined && typeof eventOrData.addEventListener !== 'function'
          ? eventOrData.data
          : (eventOrData?.data ?? eventOrData);
        const frame = parseFrame(raw);
        if (frame === null) return;

        /*
         * 应答优先：带 req_id 且命中挂起表的帧是某次操作的应答，必须最先兑现。
         *
         * 顺序很关键 —— 成功应答的 `errcode` 是 0、`cmd` 为空，与「心跳回包」
         * 的形状**完全一样**。若先走心跳分支，ack 会被当成 pong 吞掉并 return，
         * 调用方永远等不到结果、只能挂到超时。
         */
        if (this._settleAck(frame)) return;

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

      // ws 的 error 回调直接给 Error；EventTarget 给事件对象。
      on('error', (eventOrError) => {
        const message = describeError(
          eventOrError?.error ?? eventOrError?.message ?? eventOrError ?? 'websocket error',
        );
        this.setStatus(STATUS.error, message);
        finishErr(new Error(message));
      });

      on('close', (eventOrCode) => {
        clearTimeout(timeout);
        this._stopHeartbeat();
        this.socket = null;
        if (this._subscribed === false) {
          // 把服务端的关闭码带出来，否则只剩一句「连接在订阅完成前关闭」。
          const code = typeof eventOrCode === 'number' ? eventOrCode : eventOrCode?.code;
          finishErr(new Error(code === undefined
            ? '连接在订阅完成前关闭'
            : `连接在订阅完成前关闭（code=${code}）`));
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
   * 发一帧并等待服务端应答。
   *
   * 企微对 `aibot_send_msg` 的应答是**异步**的：帧写出去只是进了 socket 缓冲区，
   * 服务端随后才回 `{ headers: { req_id }, errcode, errmsg }`。原来的
   * `_writeFrame` 只要 `send()` 没抛异常就报成功，于是 `errcode=40008
   * invalid message type` 这类业务错误被完全吞掉，用户只看到「发了但对方没收到」。
   *
   * 这里按 `req_id` 挂起一个等待槽，收到同 req_id 的应答后兑现：
   *   - errcode 0 → resolve；
   *   - 非 0 → reject，并带上 errcode/errmsg，让设置页与日志都能看到真实原因；
   *   - 超时（默认 10s）→ reject，明确说明「未收到服务端应答」。
   *
   * @param {Record<string, any>} frame 必须自带 headers.req_id
   * @param {number} [timeoutMs]
   * @returns {Promise<void>}
   */
  _writeFrameAwaitAck(frame, timeoutMs = 10000) {
    const reqId = str(frame?.headers?.req_id);
    if (reqId === '') return Promise.reject(new Error('内部错误：帧缺少 req_id'));

    if (!this._writeFrame(frame)) {
      return Promise.reject(new Error('长连接未就绪，消息未发出'));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingAcks.delete(reqId);
        reject(new Error(`未收到服务端应答（req_id=${reqId}，超时 ${Math.round(timeoutMs / 1000)}s）`));
      }, timeoutMs);
      timer?.unref?.();

      this._pendingAcks.set(reqId, (frame_) => {
        clearTimeout(timer);
        const errcode = Number(frame_?.errcode ?? 0);
        if (errcode === 0) {
          resolve(undefined);
          return;
        }
        reject(new Error(`企微响应错误：errcode=${errcode} ${str(frame_?.errmsg)}`));
      });
    });
  }

  /**
   * 兑现一个挂起的应答等待（收到带 req_id 的响应帧时调用）。
   * @param {Record<string, any>} frame
   * @returns {boolean} 是否命中了挂起项
   */
  _settleAck(frame) {
    const reqId = str(frame?.headers?.req_id);
    if (reqId === '') return false;
    const settle = this._pendingAcks.get(reqId);
    if (settle === undefined) return false;
    this._pendingAcks.delete(reqId);
    settle(frame);
    return true;
  }

  /**
   * 断开连接并停止重连。
   * @returns {Promise<void>}
   */
  async _disconnect() {
    this.reconnect.stop();
    this._stopHeartbeat();
    this._subscribed = false;
    // 断开时把所有挂起的应答等待清掉，避免调用方一直等到超时。
    for (const settle of this._pendingAcks.values()) {
      settle({ errcode: -1, errmsg: '连接已断开' });
    }
    this._pendingAcks.clear();
    const socket = this.socket;
    this.socket = null;
    if (socket === null) return;
    await new Promise((resolve) => {
      const done = () => resolve(undefined);
      try {
        // 同时兼容 EventTarget（addEventListener）与 ws（EventEmitter 的 once）。
        if (typeof socket.addEventListener === 'function') {
          socket.addEventListener('close', done, { once: true });
        } else if (typeof socket.once === 'function') {
          socket.once('close', done);
        } else if (typeof socket.on === 'function') {
          socket.on('close', done);
        }
        socket.close();
      } catch {
        done();
        return;
      }
      // 兜底：某些实现不会触发 close。
      setTimeout(done, 2000)?.unref?.();
    });
  }

  /**
   * 发一条纯文本。
   *
   * **企微智能机器人没有 text 消息类型**：`aibot_send_msg` 的 `body.msgtype`
   * 官方只接受 `markdown` 与 `template_card`（见「主动推送消息」一节的字段
   * 说明）。早期实现发 `msgtype: "text"`，服务端直接回
   * `errcode=40008 invalid message type`，消息一条都发不出去。
   *
   * 因此纯文本一律走 markdown 通道，把原文放进 `markdown.content`。不额外
   * 转义反斜杠——企微的 markdown 是常见子集，转义未必被识别，反而会把 `\*`
   * 原样显示给用户。
   *
   * @param {string} peer
   * @param {string} text
   * @param {{ signal?: AbortSignal }} [_options]
   * @returns {Promise<string>}
   */
  async _sendText(peer, text, _options) {
    return this._sendMarkdown(peer, text, _options);
  }

  /**
   * 发一条 markdown。企微智能机器人**只有 markdown 与 template_card 两种
   * 消息类型**，所以文本与通知最终都走这里。
   *
   * 用 `_writeFrameAwaitAck`：服务端的 errcode（如 40008 invalid message type、
   * 30 条/分钟限流等）会作为 reject 冒泡出去，而不是写完 socket 就当成功。
   *
   * @param {string} peer
   * @param {string} markdown
   * @param {{ signal?: AbortSignal }} [_options]
   * @returns {Promise<string>}
   */
  async _sendMarkdown(peer, markdown, _options) {
    const target = str(peer);
    if (target === '') throw new Error('peer 不能为空');
    const chatType = this._chatTypeFor(target);
    await this._writeFrameAwaitAck({
      cmd: CMD.sendMsg,
      headers: { req_id: requestId() },
      body: {
        chatid: target,
        chat_type: chatType,
        msgtype: 'markdown',
        markdown: { content: markdown },
      },
    });
    return '';
  }

  /**
   * 用 `aibot_respond_msg` 回应某次回调（保留给需要「引用原消息」的场景）。
   *
   * 注意：`aibot_respond_msg` 的 msgtype 同样没有 `text`，只支持
   * stream / template_card / markdown / file / image / voice / video，
   * 所以这里也用 markdown。
   *
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
      body: { msgtype: 'markdown', markdown: { content: text } },
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
