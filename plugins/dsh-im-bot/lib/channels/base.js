/**
 * 通道基座：两个机器人通道共用的契约与运行时设施。
 *
 * 这一层只解决「所有通道都会遇到、且与具体协议无关」的问题：
 *   - 发送分片 + 同 peer 串行，避免两片交错；
 *   - 每 peer 限流与连续失败退避（通知宁可丢不可积压）；
 *   - 入站去重；
 *   - 状态机（idle/connecting/online/error）与最后错误留存；
 *   - 可注入的 `fetch` / `WebSocket` / 时钟，使测试完全离线。
 *
 * 具体协议（企业微信长连接、iLink 长轮询）由子类实现 `_connect` / `_disconnect`
 * / `_sendText` / `_sendMarkdown` 四个钩子，公共流程一律走基类。
 *
 * @module dsh-im-bot/channels/base
 */

import {
  CHANNEL_ILINK,
  CHANNEL_WECOM,
  Deduplicator,
  KeyedSerialLock,
  RATE_LIMIT,
  RateLimiter,
  SEND_BACKOFF_MS,
  SEND_FAILURE_THRESHOLD,
  TEXT_CHUNK_LIMITS,
  WECOM_MARKDOWN_MAX_BYTES,
  contentFingerprint,
  markdownToPlainText,
  splitText,
  splitTextByBytes,
  str,
} from '../core.js';

/** 通道状态。 */
export const STATUS = {
  idle: 'idle',
  connecting: 'connecting',
  online: 'online',
  error: 'error',
};

/**
 * 通道能力声明。调用方据此决定降级策略，不要靠 `kind` 猜。
 * @typedef {object} ChannelCapabilities
 * @property {boolean} markdown 是否原生支持 markdown
 * @property {boolean} templateCard 是否支持模板卡片
 * @property {boolean} proactivePush 是否能在没有入站回调时主动推送
 * @property {boolean} typing 是否有「正在输入」状态
 * @property {number} textLimit 单条文本的字符上限
 * @property {number} markdownBytes markdown 正文的字节上限（不支持 markdown 时无意义）
 */

/**
 * 一条出站结果。
 * @typedef {object} SendReceipt
 * @property {boolean} ok
 * @property {string} [id] 通道侧消息 id（若有）
 * @property {string} [error] 失败原因
 * @property {number} [chunks] 实际发出的分片数
 */

/**
 * 所有通道的抽象基类。
 *
 * 子类必须实现：
 *   - `_connect()`：建立连接并完成握手；失败时抛错。
 *   - `_disconnect()`：释放连接与定时器；必须幂等。
 *   - `_sendText(peer, text, options)`：发一条（已分片）纯文本。
 *   - `_sendMarkdown(peer, markdown, options)`：发一条（已分片）markdown；
 *     不支持 markdown 的通道可以不实现，基类会自动降级到 `_sendText`。
 */
export class BaseChannel {
  /**
   * @param {object} options
   * @param {string} options.kind 通道标识
   * @param {import('node:events').EventEmitter} [options.bus] 入站事件总线
   * @param {typeof fetch} [options.fetch] 注入的 fetch（测试用）
   * @param {() => number} [options.now] 注入的时钟
   * @param {(level: string, message: string, error?: unknown) => void} [options.log] 日志
   */
  constructor(options) {
    this.kind = options.kind;
    this.bus = options.bus;
    this.fetchImpl = typeof options.fetch === 'function' ? options.fetch : globalThis.fetch;
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.log = typeof options.log === 'function' ? options.log : () => {};

    /** @type {string} */
    this._status = STATUS.idle;
    this._lastError = '';
    this._started = false;

    this.dedup = new Deduplicator({ now: this.now });
    this.limiter = new RateLimiter({ windowMs: RATE_LIMIT.windowMs, maxPerWindow: RATE_LIMIT.maxPerWindow, now: this.now });
    this.sendLock = new KeyedSerialLock();

    this._consecutiveFailures = 0;
    this._backoffUntil = 0;
  }

  /** @returns {ChannelCapabilities} */
  get capabilities() {
    return {
      markdown: false,
      templateCard: false,
      proactivePush: false,
      typing: false,
      textLimit: TEXT_CHUNK_LIMITS[this.kind] ?? 2000,
      markdownBytes: WECOM_MARKDOWN_MAX_BYTES,
    };
  }

  /** @returns {string} */
  get status() {
    return this._status;
  }

  /** @returns {string} */
  get lastError() {
    return this._lastError;
  }

  /** 是否已启动（不代表在线）。 */
  get started() {
    return this._started;
  }

  /**
   * 面向设置面板的状态快照。
   * @returns {{ kind: string, status: string, lastError: string, capabilities: ChannelCapabilities }}
   */
  describe() {
    return {
      kind: this.kind,
      status: this._status,
      lastError: this._lastError,
      capabilities: this.capabilities,
    };
  }

  /**
   * 切换状态并广播。
   * @param {string} status
   * @param {string} [error]
   */
  setStatus(status, error = '') {
    const changed = this._status !== status || (error !== '' && error !== this._lastError);
    this._status = status;
    if (error !== '') this._lastError = error;
    if (status === STATUS.online) this._lastError = '';
    if (!changed) return;
    this.bus?.emit?.('channel-status', { kind: this.kind, status, lastError: this._lastError });
  }

  /**
   * 启动通道。幂等：已启动时直接返回当前状态。
   * @returns {Promise<void>}
   */
  async start() {
    if (this._started) return;
    this._started = true;
    this.setStatus(STATUS.connecting);
    try {
      await this._connect();
      this.setStatus(STATUS.online);
      this.log('info', `[${this.kind}] connected`);
    } catch (error) {
      this._started = false;
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(STATUS.error, message);
      this.log('warn', `[${this.kind}] connect failed: ${message}`);
      throw error;
    }
  }

  /**
   * 停止通道。幂等，且不抛错（关闭阶段的失败只记日志）。
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this._started) {
      this.setStatus(STATUS.idle);
      return;
    }
    this._started = false;
    try {
      await this._disconnect();
    } catch (error) {
      this.log('warn', `[${this.kind}] disconnect failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.dedup.clear();
    this.limiter.clear();
    this.sendLock.clear();
    this.setStatus(STATUS.idle);
  }

  /**
   * 发文本。基类负责分片、限流、串行与失败计数；子类只发单片。
   *
   * @param {string} peer
   * @param {string} text
   * @param {{ signal?: AbortSignal, notice?: boolean }} [options]
   * @returns {Promise<SendReceipt>}
   */
  async sendText(peer, text, options = {}) {
    return this._send(peer, text, options, 'text');
  }

  /**
   * 发 markdown；通道不支持时自动降级为纯文本。
   * @param {string} peer
   * @param {string} markdown
   * @param {{ signal?: AbortSignal, notice?: boolean }} [options]
   * @returns {Promise<SendReceipt>}
   */
  async sendMarkdown(peer, markdown, options = {}) {
    return this._send(peer, markdown, options, 'markdown');
  }

  /**
   * @param {string} peer
   * @param {string} text
   * @param {{ signal?: AbortSignal, notice?: boolean }} options
   * @param {'text'|'markdown'} format
   * @returns {Promise<SendReceipt>}
   */
  async _send(peer, text, options, format) {
    const target = str(peer);
    if (target === '') return { ok: false, error: 'peer 不能为空' };
    const source = typeof text === 'string' ? text : '';
    if (source.trim() === '') return { ok: false, error: 'text 不能为空' };

    if (this._status !== STATUS.online) {
      return { ok: false, error: `通道未就绪（${this._status}）` };
    }
    const backoff = this._backoffUntil - this.now();
    if (backoff > 0) {
      return { ok: false, error: `通道退避中，${Math.ceil(backoff / 1000)}s 后恢复` };
    }

    const effectiveFormat = format === 'markdown' && this.capabilities.markdown ? 'markdown' : 'text';
    const payload = effectiveFormat === 'markdown' ? source : markdownToPlainText(source);
    if (payload.trim() === '') return { ok: false, error: '内容为空（markdown 降级后）' };

    const chunks = effectiveFormat === 'markdown'
      ? splitTextByBytes(payload, this.capabilities.markdownBytes)
      : splitText(payload, this.capabilities.textLimit);
    if (chunks.length === 0) return { ok: false, error: '内容为空' };

    const key = `${this.kind}:${target}`;
    let lastId = '';
    let sent = 0;

    return this.sendLock.run(key, async () => {
      for (const chunk of chunks) {
        if (options?.signal?.aborted === true) {
          return { ok: false, id: lastId || undefined, chunks: sent, error: '已取消' };
        }
        if (!this.limiter.take(key)) {
          const wait = Math.ceil(this.limiter.retryAfterMs(key) / 1000);
          return {
            ok: false,
            id: lastId || undefined,
            chunks: sent,
            error: `限流：该会话 ${wait}s 内已达 ${RATE_LIMIT.maxPerWindow} 条上限`,
          };
        }
        try {
          const id = effectiveFormat === 'markdown'
            ? await this._sendMarkdown(target, chunk, options)
            : await this._sendText(target, chunk, options);
          if (typeof id === 'string' && id !== '') lastId = id;
          sent += 1;
          this._consecutiveFailures = 0;
        } catch (error) {
          this._recordFailure();
          const message = error instanceof Error ? error.message : String(error);
          this.log('warn', `[${this.kind}] send to ${target} failed: ${message}`);
          return { ok: false, id: lastId || undefined, chunks: sent, error: message };
        }
      }
      return { ok: true, id: lastId || undefined, chunks: sent };
    });
  }

  /**
   * 记录一次发送失败；连续失败达到阈值时进入退避。
   */
  _recordFailure() {
    this._consecutiveFailures += 1;
    if (this._consecutiveFailures < SEND_FAILURE_THRESHOLD) return;
    this._backoffUntil = this.now() + SEND_BACKOFF_MS;
    this._consecutiveFailures = 0;
    this.log('warn', `[${this.kind}] send backoff for ${Math.round(SEND_BACKOFF_MS / 1000)}s after repeated failures`);
  }

  /**
   * 派发一条已归一化的入站事件；重复消息直接丢弃。
   * @param {import('../core.js').InboundEvent} event
   * @returns {boolean} true 表示已派发
   */
  dispatchInbound(event) {
    if (event === null || typeof event !== 'object') return false;
    const id = str(event.messageId);
    if (id !== '' && this.dedup.check(`${this.kind}:${id}`)) return false;
    const fingerprint = contentFingerprint(event);
    if (this.dedup.check(fingerprint)) return false;
    this.bus?.emit?.('inbound', event);
    return true;
  }

  /**
   * 建立连接（子类实现）。
   * @returns {Promise<void>}
   */
  async _connect() {
    throw new Error(`${this.kind}: _connect 未实现`);
  }

  /**
   * 断开连接（子类实现，必须幂等）。
   * @returns {Promise<void>}
   */
  async _disconnect() {}

  /**
   * 发送单片纯文本（子类实现）。
   * @param {string} _peer
   * @param {string} _text
   * @param {{ signal?: AbortSignal }} [_options]
   * @returns {Promise<string | void>} 通道侧消息 id（可选）
   */
  async _sendText(_peer, _text, _options) {
    throw new Error(`${this.kind}: _sendText 未实现`);
  }

  /**
   * 发送单片 markdown（子类实现；不实现则基类降级为纯文本）。
   * @param {string} _peer
   * @param {string} _markdown
   * @param {{ signal?: AbortSignal }} [_options]
   * @returns {Promise<string | void>}
   */
  async _sendMarkdown(_peer, _markdown, _options) {
    return this._sendText(_peer, _markdown, _options);
  }
}

export { CHANNEL_ILINK, CHANNEL_WECOM };

/**
 * 带指数退避的重连循环。
 *
 * 两个通道都需要「断开后自动重连」，且都要求不无限快速重试。这里抽成
 * 一个可取消的辅助类：`start()` 起循环，`stop()` 清定时器并置取消位。
 */
export class ReconnectLoop {
  /**
   * @param {object} options
   * @param {() => Promise<void>} options.task 每次重试执行的连接动作
   * @param {(error: unknown, attempt: number) => void} [options.onError]
   * @param {() => number} [options.now]
   * @param {{ initialMs?: number, maxMs?: number, factor?: number }} [options.backoff]
   * @param {(ms: number, fn: () => void) => unknown} [options.setTimer]
   * @param {(handle: unknown) => void} [options.clearTimer]
   */
  constructor(options) {
    this.task = options.task;
    this.onError = typeof options.onError === 'function' ? options.onError : () => {};
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    const backoff = options.backoff ?? {};
    this.initialMs = Number.isFinite(backoff.initialMs) ? backoff.initialMs : 1000;
    this.maxMs = Number.isFinite(backoff.maxMs) ? backoff.maxMs : 60000;
    this.factor = Number.isFinite(backoff.factor) ? backoff.factor : 2;
    this.setTimer = typeof options.setTimer === 'function' ? options.setTimer : (ms, fn) => setTimeout(fn, ms);
    this.clearTimer = typeof options.clearTimer === 'function' ? options.clearTimer : (handle) => clearTimeout(handle);

    this._attempt = 0;
    this._cancelled = false;
    /** @type {unknown} */
    this._timer = null;
  }

  /** 当前连续失败次数（成功连接后由调用方 `reset()`）。 */
  get attempt() {
    return this._attempt;
  }

  /** 计算下一次等待时长。 */
  nextDelay() {
    const delay = this.initialMs * (this.factor ** this._attempt);
    return Math.min(this.maxMs, Math.round(delay));
  }

  /** 连接成功后清零。 */
  reset() {
    this._attempt = 0;
  }

  /** 取消后续重试。 */
  stop() {
    this._cancelled = true;
    if (this._timer !== null) {
      this.clearTimer(this._timer);
      this._timer = null;
    }
  }

  /** 恢复可用（`stop()` 之后想复用需要调这个）。 */
  restart() {
    this._cancelled = false;
  }

  /**
   * 立刻尝试一次；失败则排下一次。
   * @returns {Promise<boolean>} 本次是否成功
   */
  async runOnce() {
    if (this._cancelled) return false;
    try {
      await this.task();
      this._attempt = 0;
      return true;
    } catch (error) {
      this._attempt += 1;
      this.onError(error, this._attempt);
      this.scheduleNext();
      return false;
    }
  }

  /** 安排下一次重试。 */
  scheduleNext() {
    if (this._cancelled) return;
    const delay = this.nextDelay();
    this._timer = this.setTimer(delay, () => {
      this._timer = null;
      void this.runOnce();
    });
  }
}

/**
 * 把错误对象转成可展示的一行文本。
 * @param {unknown} error
 * @returns {string}
 */
export function describeError(error) {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
