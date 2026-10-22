/**
 * dsh-im-bot 宿主入口。
 *
 * 职责边界：
 *   - 读配置、管通道生命周期（{@link ChannelManager}）；
 *   - 把入站消息落成会话 prompt（`agent.followup`），或当命令在本地执行；
 *   - 监听 `turn/end` 把结果回推给发起对话的聊天（需求③）；
 *   - 暴露设置面板 RPC、通用发送 HTTP 路由、以及给 agent 用的 `im_bot_send` 工具。
 *
 * 不在这里做的事：协议编解码（在 `channels/`）、文案与命令语义（在 `core.js`）。
 *
 * 关键宿主契约（已在 DSH 0.2.1-rc.2 上核实）：
 *   - `ctx.webServer.register({ kind, path, handler })` 的路由**不经过**
 *     Connection 的浏览器鉴权，所以本插件自己校验 token；未配置 token 时该
 *     路由整体不存在（返回 404，不暴露存在性）。
 *   - `ctx.connection.rpc.handle(channel, handler, { authority: 'trusted-host' })`
 *     是浏览器设置面板的通道；`inject` 必须同时含 `connection` 与 `webServer`，
 *     否则 `connection.rpc.handle` 在注册路由时读不到 `webServer` 而激活失败。
 *   - 会话注入走 `ctx.sessionController.resolveAgent(sessionId)` +
 *     `agent.followup(createUserMessage(...))`，与 `dsh-schedule` 同一条路。
 *   - 回合结束用 `session/event` 里的 `turn/end`：只有它带 `reason`，能区分
 *     `completed` 与 `error/aborted/max-tokens`。
 *
 * @module dsh-im-bot
 */

import { EventEmitter } from 'node:events';
import { timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import z from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

import {
  BindingTable,
  CHANNEL_ILINK,
  CHANNEL_KINDS,
  CHANNEL_LABELS,
  CHANNEL_WECOM,
  COMMANDS,
  CREDENTIAL_REFS,
  DEFAULTS,
  MESSAGE_SOURCE_KIND,
  NS,
  RPC_CHANNEL,
  SEND_ROUTE,
  checkAccess,
  classifyTurnEnd,
  matchSessionPrefix,
  normalizeConfig,
  normalizeSendRequest,
  parseCommand,
  renderCompletionNotice,
  renderFailureNotice,
  renderHelp,
  sessionLabel,
  str,
  truncate,
} from './core.js';
import { IlinkChannel, IlinkLoginSession, TYPING } from './channels/ilink.js';
import { WecomChannel } from './channels/wecom.js';
import { STATUS, describeError } from './channels/base.js';

export const name = 'im-bot';

/**
 * `webServer` 必须与 `connection` 一并注入：`connection.rpc.handle` 在调用方
 * ctx 上读 `webServer` 注册路由，缺这一项会让插件在 webServer 就绪前就执行
 * apply 并以 "without inject" 激活失败。
 */
export const inject = ['connection', 'webServer'];

/** 设置面板 RPC 通道与发送路由（供外部按名引用）。 */
export { RPC_CHANNEL, SEND_ROUTE };

/** 单次会话 prompt 的最大字符数（超长截断，避免把模型上下文一次打爆）。 */
const MAX_PROMPT_CHARS = 32000;

/** 绑定表与游标的落盘文件名。 */
const STATE_FILES = {
  bindings: 'bindings.json',
  wecomPeerTypes: 'wecom-peers.json',
  ilinkSync: 'ilink-sync.json',
  ilinkTokens: 'ilink-context-tokens.json',
  ilinkAccount: 'ilink-account.json',
};

/**
 * 原子写 JSON（tmp + rename），与仓库其它插件同款做法：
 * 直接覆盖写会在进程被杀时留下半个文件，而游标文件损坏会导致重复消费。
 *
 * @param {string} filePath
 * @param {unknown} value
 * @returns {Promise<void>}
 */
async function writeJsonAtomic(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    try {
      await rename(tmp, filePath);
    } catch (error) {
      // Windows 上 rename 不能覆盖已存在文件。
      if (error?.code === 'EEXIST' || error?.code === 'EPERM') {
        await rm(filePath, { force: true });
        await rename(tmp, filePath);
      } else {
        throw error;
      }
    }
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * 读 JSON；文件不存在或损坏时返回 null（由调用方兜底，绝不因坏文件拒绝启动）。
 * @param {string} filePath
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function readJson(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 把 `Config` 的一个字段标成 live。
 *
 * 宿主设置服务拒绝对「没有任何 volatile 字段」的条目写入（报
 * `Plugin entry "x" has no volatile fields`），因此每个用户可改的字段都要
 * 过这一层。老版 schemastery 没有 `.volatile()` 时退化成普通配置。
 *
 * @param {any} schema
 * @returns {any}
 */
function liveField(schema) {
  return typeof schema?.volatile === 'function' ? schema.volatile() : schema;
}

/**
 * 插件配置。
 *
 * **所有用户可改字段都必须是顶层 live 字段**：schemastery 的
 * `validateVolatileSchema` 明确拒绝「volatile 字段嵌在另一个 volatile 对象
 * 里」（`volatile fields require a fixed object path without an enclosing
 * volatile field`）。因此配置形状是扁平的 `wecomXxx` / `ilinkXxx`，而不是
 * 嵌套对象；`normalizeConfig` 负责把扁平字段重新组装成 core 层用的嵌套结构。
 *
 * 好处是设置面板能按分组渲染（前端读扁平键名分组），而不用把整组当成一个
 * 不可分字段写入。
 */
export const Config = z.object({
  enabled: liveField(z.boolean().default(false)),

  wecomEnabled: liveField(z.boolean().default(false)),
  wecomBotId: liveField(z.string().default('')),
  wecomBaseUrl: liveField(z.string().default(DEFAULTS.wecom.baseUrl)),
  wecomHeartbeatSeconds: liveField(z.number().default(DEFAULTS.wecom.heartbeatSeconds)),
  wecomHeartbeatTimeoutCount: liveField(z.number().default(DEFAULTS.wecom.heartbeatTimeoutCount)),

  ilinkEnabled: liveField(z.boolean().default(false)),
  ilinkAccountId: liveField(z.string().default('')),
  ilinkBaseUrl: liveField(z.string().default(DEFAULTS.ilink.baseUrl)),
  ilinkLongPollTimeoutMs: liveField(z.number().default(DEFAULTS.ilink.longPollTimeoutMs)),
  ilinkSessionExpiredPauseMs: liveField(z.number().default(DEFAULTS.ilink.sessionExpiredPauseMs)),
  ilinkTyping: liveField(z.boolean().default(true)),

  notifyOnTurnComplete: liveField(z.boolean().default(true)),
  notifyOnTurnFailure: liveField(z.boolean().default(true)),
  notifyMaxNoticeChars: liveField(z.number().default(DEFAULTS.notify.maxNoticeChars)),
  notifyFailureChars: liveField(z.number().default(DEFAULTS.notify.failureChars)),

  accessAllowFrom: liveField(z.array(z.string()).default([])),
  accessGroupAllowFrom: liveField(z.array(z.string()).default([])),
  accessGroupsEnabled: liveField(z.boolean().default(false)),
});

/** Config 的扁平键名，设置面板与 normalizeConfig 共用一份。 */
export const CONFIG_KEYS = [
  'enabled',
  'wecomEnabled', 'wecomBotId', 'wecomBaseUrl', 'wecomHeartbeatSeconds', 'wecomHeartbeatTimeoutCount',
  'ilinkEnabled', 'ilinkAccountId', 'ilinkBaseUrl', 'ilinkLongPollTimeoutMs', 'ilinkSessionExpiredPauseMs', 'ilinkTyping',
  'notifyOnTurnComplete', 'notifyOnTurnFailure', 'notifyMaxNoticeChars', 'notifyFailureChars',
  'accessAllowFrom', 'accessGroupAllowFrom', 'accessGroupsEnabled',
];

/**
 * 把扁平 Config 组装成 core 层使用的嵌套结构。
 * @param {Record<string, unknown>} flat
 * @returns {ReturnType<typeof normalizeConfig>}
 */
export function flatToNested(flat) {
  const input = flat !== null && typeof flat === 'object' ? flat : {};
  return normalizeConfig({
    enabled: input.enabled,
    wecom: {
      enabled: input.wecomEnabled,
      botId: input.wecomBotId,
      baseUrl: input.wecomBaseUrl,
      heartbeatSeconds: input.wecomHeartbeatSeconds,
      heartbeatTimeoutCount: input.wecomHeartbeatTimeoutCount,
    },
    ilink: {
      enabled: input.ilinkEnabled,
      accountId: input.ilinkAccountId,
      baseUrl: input.ilinkBaseUrl,
      longPollTimeoutMs: input.ilinkLongPollTimeoutMs,
      sessionExpiredPauseMs: input.ilinkSessionExpiredPauseMs,
      typing: input.ilinkTyping,
    },
    notify: {
      onTurnComplete: input.notifyOnTurnComplete,
      onTurnFailure: input.notifyOnTurnFailure,
      maxNoticeChars: input.notifyMaxNoticeChars,
      failureChars: input.notifyFailureChars,
    },
    access: {
      allowFrom: input.accessAllowFrom,
      groupAllowFrom: input.accessGroupAllowFrom,
      groupsEnabled: input.accessGroupsEnabled,
    },
  });
}

/**
 * 把嵌套结构摊回扁平 Config（写设置时用）。
 * @param {ReturnType<typeof normalizeConfig>} nested
 * @returns {Record<string, unknown>}
 */
export function nestedToFlat(nested) {
  return {
    enabled: nested.enabled,
    wecomEnabled: nested.wecom.enabled,
    wecomBotId: nested.wecom.botId,
    wecomBaseUrl: nested.wecom.baseUrl,
    wecomHeartbeatSeconds: nested.wecom.heartbeatSeconds,
    wecomHeartbeatTimeoutCount: nested.wecom.heartbeatTimeoutCount,
    ilinkEnabled: nested.ilink.enabled,
    ilinkAccountId: nested.ilink.accountId,
    ilinkBaseUrl: nested.ilink.baseUrl,
    ilinkLongPollTimeoutMs: nested.ilink.longPollTimeoutMs,
    ilinkSessionExpiredPauseMs: nested.ilink.sessionExpiredPauseMs,
    ilinkTyping: nested.ilink.typing,
    notifyOnTurnComplete: nested.notify.onTurnComplete,
    notifyOnTurnFailure: nested.notify.onTurnFailure,
    notifyMaxNoticeChars: nested.notify.maxNoticeChars,
    notifyFailureChars: nested.notify.failureChars,
    accessAllowFrom: nested.access.allowFrom,
    accessGroupAllowFrom: nested.access.groupAllowFrom,
    accessGroupsEnabled: nested.access.groupsEnabled,
  };
}

/**
 * 解包 cosmokit 的 live 引用。
 *
 * schemastery 3.18.4+ 把 volatile 字段交给插件的是一个引用对象，Loader 换
 * 配置时改的是同一个引用内部的值；直接 `JSON.stringify` 它会拿到壳而不是值。
 *
 * @param {unknown} value
 * @param {Set<unknown>} [seen]
 * @returns {unknown}
 */
function unwrapConfig(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  if (typeof (/** @type {any} */ (value).get) === 'function'
    && Symbol.for('cosmokit.volatile.write') in /** @type {any} */ (value)) {
    return unwrapConfig(/** @type {any} */ (value).get(), seen);
  }
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => unwrapConfig(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unwrapConfig(item, seen)]));
}

/**
 * 从 RPC 载荷里只挑出已知的扁平配置字段，忽略 `secrets` 等旁路键。
 * @param {Record<string, unknown>} input
 * @returns {Record<string, unknown>}
 */
export function pickConfigFields(input) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const key of CONFIG_KEYS) {
    if (!Object.hasOwn(input, key)) continue;
    if (input[key] === undefined) continue;
    out[key] = input[key];
  }
  return out;
}

/**
 * 通道管理器：持有两个通道实例、负责启停与降级。
 *
 * 通道实例按配置**懒重建**：配置变了（换了账号/密钥）就停旧建新，而不是
 * 复用旧连接，避免「设置页显示已保存但实际还在用旧 token」。
 */
export class ChannelManager {
  /**
   * @param {object} options
   * @param {() => any} options.getConfig 读当前规范化配置
   * @param {(level: string, message: string, error?: unknown) => void} options.log
   * @param {(kind: 'ilink-sync'|'ilink-tokens') => Promise<Record<string, unknown>|null>} options.loadIlinkState
   * @param {(kind: 'ilink-sync'|'ilink-tokens', value: Record<string, unknown>) => Promise<void>} options.saveIlinkState
   * @param {EventEmitter} options.bus
   * @param {typeof fetch} [options.fetch]
   * @param {typeof WebSocket} [options.WebSocketImpl]
   */
  constructor(options) {
    this.getConfig = options.getConfig;
    this.log = options.log;
    this.bus = options.bus;
    this.fetchImpl = options.fetch;
    this.WebSocketImpl = options.WebSocketImpl;
    this.loadIlinkState = options.loadIlinkState;
    this.saveIlinkState = options.saveIlinkState;

    /** @type {WecomChannel | null} */
    this.wecom = null;
    /** @type {IlinkChannel | null} */
    this.ilink = null;
    this._signature = '';
  }

  /**
   * 当前两个通道的签名（配置指纹）。凭据不进签名：它由外部注入。
   * @returns {string}
   */
  signatureOf() {
    const config = this.getConfig();
    return JSON.stringify({
      enabled: config.enabled,
      wecom: config.wecom,
      ilink: config.ilink,
    });
  }

  /**
   * 按当前配置对齐通道：该启的启、该停的停、配置变了就重建。
   *
   * @param {object} credentials
   * @param {string} [credentials.wecomSecret]
   * @param {string} [credentials.ilinkToken]
   * @returns {Promise<void>}
   */
  async reconcile(credentials) {
    const config = this.getConfig();
    const signature = this.signatureOf();
    const changed = signature !== this._signature;
    this._signature = signature;

    if (config.enabled !== true) {
      await this.stopAll();
      return;
    }

    if (changed) await this.stopAll();

    // 企业微信
    if (config.wecom.enabled === true) {
      if (this.wecom === null) {
        this.wecom = new WecomChannel({
          botId: config.wecom.botId,
          secret: str(credentials?.wecomSecret),
          baseUrl: config.wecom.baseUrl,
          heartbeatSeconds: config.wecom.heartbeatSeconds,
          heartbeatTimeoutCount: config.wecom.heartbeatTimeoutCount,
          bus: this.bus,
          log: this.log,
          ...(this.WebSocketImpl === undefined ? {} : { WebSocketImpl: this.WebSocketImpl }),
        });
        this._attach(this.wecom);
      }
      if (!this.wecom.started) await this._safeStart(this.wecom);
    } else if (this.wecom !== null) {
      await this.wecom.stop();
      this.wecom = null;
    }

    // 个人微信
    if (config.ilink.enabled === true) {
      if (this.ilink === null) {
        this.ilink = new IlinkChannel({
          accountId: config.ilink.accountId,
          token: str(credentials?.ilinkToken),
          baseUrl: config.ilink.baseUrl,
          longPollTimeoutMs: config.ilink.longPollTimeoutMs,
          sessionExpiredPauseMs: config.ilink.sessionExpiredPauseMs,
          typing: config.ilink.typing,
          bus: this.bus,
          log: this.log,
          ...(this.fetchImpl === undefined ? {} : { fetch: this.fetchImpl }),
          loadState: (key) => this.loadIlinkState(key === 'sync' ? 'ilink-sync' : 'ilink-tokens'),
          saveState: (key, value) => this.saveIlinkState(key === 'sync' ? 'ilink-sync' : 'ilink-tokens', value),
        });
        this._attach(this.ilink);
      }
      if (!this.ilink.started) await this._safeStart(this.ilink);
    } else if (this.ilink !== null) {
      await this.ilink.stop();
      this.ilink = null;
    }
  }

  /**
   * 挂公共监听（入站已由通道派发到 bus，这里只补通道特有的登记）。
   * @param {WecomChannel | IlinkChannel} channel
   */
  _attach(channel) {
    if (channel instanceof WecomChannel) {
      // 记住 peer 是单聊还是群聊，主动推送时才能选对 chat_type。
      this.bus.on('inbound', (event) => {
        if (event?.channel === CHANNEL_WECOM) channel.rememberPeerType(event.peer, event.chatType);
      });
    }
  }

  /**
   * 启动通道；失败只记状态，不抛给调用方（设置页要能看到错误而不是 500）。
   * @param {WecomChannel | IlinkChannel} channel
   * @returns {Promise<void>}
   */
  async _safeStart(channel) {
    try {
      await channel.start();
    } catch (error) {
      this.log('warn', `[${channel.kind}] 启动失败：${describeError(error)}`);
    }
  }

  /**
   * 停掉全部通道。
   * @returns {Promise<void>}
   */
  async stopAll() {
    const channels = [this.wecom, this.ilink].filter((channel) => channel !== null);
    this.wecom = null;
    this.ilink = null;
    for (const channel of channels) {
      await channel.stop();
    }
  }

  /**
   * 按 kind 取通道。
   * @param {string} kind
   * @returns {WecomChannel | IlinkChannel | null}
   */
  get(kind) {
    if (kind === CHANNEL_WECOM) return this.wecom;
    if (kind === CHANNEL_ILINK) return this.ilink;
    return null;
  }

  /**
   * 找一个可用的在线通道。
   * @param {string} [preferred]
   * @returns {WecomChannel | IlinkChannel | null}
   */
  onlineChannel(preferred) {
    if (preferred !== undefined && preferred !== '') {
      const exact = this.get(preferred);
      if (exact !== null && exact.status === STATUS.online) return exact;
    }
    for (const kind of CHANNEL_KINDS) {
      const channel = this.get(kind);
      if (channel !== null && channel.status === STATUS.online) return channel;
    }
    return null;
  }

  /**
   * 状态快照（设置页用）。
   * @returns {object}
   */
  describe() {
    return Object.fromEntries(CHANNEL_KINDS.map((kind) => {
      const channel = this.get(kind);
      if (channel === null) {
        return [kind, { kind, label: CHANNEL_LABELS[kind], status: STATUS.idle, lastError: '', configured: false }];
      }
      return [kind, {
        ...channel.describe(),
        label: CHANNEL_LABELS[kind],
        configured: true,
      }];
    }));
  }
}

/**
 * 插件入口。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {unknown} config
 */
export function apply(ctx, config) {
  const bus = new EventEmitter();
  // 通知可能同时来自多个会话；提高上限避免 EventEmitter 的 10 监听告警。
  bus.setMaxListeners(64);

  const log = (level, message, error) => {
    const logger = ctx.logger;
    const line = error === undefined ? message : `${message}: ${describeError(error)}`;
    if (level === 'warn') logger?.warn?.(line);
    else if (level === 'error') logger?.error?.(line);
    else logger?.info?.(line);
  };

  /**
   * 读当前配置。每次现读：live 字段会被 Loader 就地替换，
   * 缓存一份会导致「保存了但不生效」。
   */
  const readConfig = () => flatToNested(/** @type {Record<string, unknown>} */ (unwrapConfig(
    ctx.fiber?.entry?.options?.config ?? config ?? {},
  )));

  const stateDir = () => dshHomePath('im-bot');
  const stateFile = (key) => join(stateDir(), STATE_FILES[key]);

  /** @type {BindingTable} */
  const bindings = new BindingTable();
  let bindingsLoaded = false;

  /**
   * 懒加载绑定表（首次用到时读一次）。
   * @returns {Promise<void>}
   */
  async function ensureBindings() {
    if (bindingsLoaded) return;
    bindingsLoaded = true;
    const raw = await readJson(stateFile('bindings'));
    const loaded = bindings.load(Array.isArray(raw?.bindings) ? raw.bindings : []);
    if (loaded > 0) log('info', `im-bot: 载入 ${loaded} 条聊天绑定`);
  }

  /** 保存绑定表。 */
  async function persistBindings() {
    try {
      await writeJsonAtomic(stateFile('bindings'), { version: 1, bindings: bindings.toJSON() });
    } catch (error) {
      log('warn', 'im-bot: 保存绑定表失败', error);
    }
  }

  /**
   * 读 iLink 的持久化状态。
   * @param {'ilink-sync'|'ilink-tokens'} key
   * @returns {Promise<Record<string, unknown> | null>}
   */
  async function loadIlinkState(key) {
    return readJson(stateFile(key));
  }

  /**
   * 写 iLink 的持久化状态。
   * @param {'ilink-sync'|'ilink-tokens'} key
   * @param {Record<string, unknown>} value
   * @returns {Promise<void>}
   */
  async function saveIlinkState(key, value) {
    await writeJsonAtomic(stateFile(key), value);
  }

  /**
   * 解析凭据：优先 ctx.credentials，其次环境变量。
   * 每次操作现解析，保证设置页刚保存的密钥立刻生效。
   *
   * @param {string} ref
   * @returns {Promise<string>}
   */
  async function resolveSecret(ref) {
    try {
      const stored = await ctx.credentials?.resolve?.(credentialRef(ref));
      const value = str(stored?.value);
      if (value !== '') return value;
    } catch (error) {
      log('warn', `im-bot: 读取凭据 ${ref} 失败`, error);
    }
    return str(process.env[ref]);
  }

  /** 一次性读出两个通道的凭据。 */
  async function readCredentials() {
    return {
      wecomSecret: await resolveSecret(CREDENTIAL_REFS.wecomSecret),
      ilinkToken: await resolveSecret(CREDENTIAL_REFS.ilinkToken),
    };
  }

  const channels = new ChannelManager({
    getConfig: readConfig,
    log,
    bus,
    loadIlinkState,
    saveIlinkState,
  });

  /** 正在进行的 iLink 扫码登录会话。 */
  /** @type {IlinkLoginSession | null} */
  let loginSession = null;

  // -------------------------------------------------------------------------
  // 会话侧：投递与回推
  // -------------------------------------------------------------------------

  /**
   * 每个会话的「本轮由哪个聊天发起」。
   * @type {Map<string, { channel: string, peer: string, chatType: 'single'|'group', at: number }>}
   */
  const replyTargets = new Map();

  /**
   * 会话标题缓存。标题由 `session/title` 事件给出，通知文案用它代替裸 id；
   * 有界（最多 200 条），避免长期运行后无限增长。
   * @type {Map<string, string>}
   */
  const sessionTitles = new Map();

  /**
   * 记录一个会话标题。
   * @param {string} sessionId
   * @param {string} title
   */
  function rememberTitle(sessionId, title) {
    const id = str(sessionId);
    const text = str(title);
    if (id === '' || text === '') return;
    sessionTitles.delete(id);
    sessionTitles.set(id, text);
    if (sessionTitles.size > 200) {
      const oldest = sessionTitles.keys().next();
      if (oldest.done !== true) sessionTitles.delete(oldest.value);
    }
  }

  /**
   * 每个会话正在累积的 assistant 文本与回合起始时间。
   * @type {Map<string, { text: string, startedAt: number, turn: number }>}
   */
  const turnBuffers = new Map();

  /**
   * 取会话服务；宿主没挂时返回 undefined（headless 组合）。
   * @returns {any}
   */
  function sessionController() {
    try {
      return ctx.get?.('sessionController');
    } catch {
      return undefined;
    }
  }

  /**
   * 把一条外部消息投递进会话。
   *
   * @param {string} sessionId
   * @param {string} text
   * @param {{ channel: string, peer: string, chatType: 'single'|'group' }} origin
   * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
   */
  async function deliverToSession(sessionId, text, origin) {
    const controller = sessionController();
    if (controller === undefined || typeof controller.resolveAgent !== 'function') {
      return { ok: false, error: '当前 Profile 未挂载 sessionController，无法进行双向对话' };
    }
    const trimmed = text.trim();
    if (trimmed === '') return { ok: false, error: '消息内容为空' };

    let agent;
    try {
      agent = await controller.resolveAgent(sessionId);
    } catch (error) {
      return { ok: false, error: `会话不可用：${describeError(error)}` };
    }

    const content = truncate(trimmed, MAX_PROMPT_CHARS);
    try {
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: content }],
        source: {
          kind: MESSAGE_SOURCE_KIND,
          channel: origin.channel,
          peer: origin.peer,
        },
      }));
    } catch (error) {
      return { ok: false, error: `投递失败：${describeError(error)}` };
    }

    replyTargets.set(sessionId, { ...origin, at: Date.now() });
    turnBuffers.set(sessionId, { text: '', startedAt: Date.now(), turn: 0 });
    return { ok: true };
  }

  /**
   * 新建一个会话并绑定到聊天。
   * @param {{ channel: string, peer: string, chatType: 'single'|'group' }} origin
   * @param {string} title
   * @returns {Promise<{ ok: true, sessionId: string } | { ok: false, error: string }>}
   */
  async function createSessionForPeer(origin, title) {
    const controller = sessionController();
    if (controller === undefined || typeof controller.create !== 'function') {
      return { ok: false, error: '当前 Profile 不支持新建会话' };
    }
    try {
      const created = await controller.create({});
      const sessionId = str(created?.sessionId);
      if (sessionId === '') return { ok: false, error: '新建会话未返回 id' };
      await ensureBindings();
      bindings.set({ channel: origin.channel, peer: origin.peer, chatType: origin.chatType, sessionId, notify: true });
      await persistBindings();
      replyTargets.set(sessionId, { ...origin, at: Date.now() });
      if (title !== '') {
        // 标题只是展示用；设置失败不影响会话可用性。
        try {
          controller.rename?.({ sessionId, title: truncate(title, 120) });
        } catch {
          /* 忽略 */
        }
      }
      return { ok: true, sessionId };
    } catch (error) {
      return { ok: false, error: `新建会话失败：${describeError(error)}` };
    }
  }

  /**
   * 列出最近会话（命令 /sessions 用）。
   * @returns {Promise<Array<{ sessionId: string, title: string }>>}
   */
  async function listRecentSessions() {
    const controller = sessionController();
    if (controller === undefined || typeof controller.list !== 'function') return [];
    try {
      const result = await controller.list({}, new AbortController().signal);
      const rows = Array.isArray(result?.sessions) ? result.sessions : [];
      return rows.slice(0, 10).map((row) => ({
        sessionId: str(row?.sessionId),
        title: sessionLabel(row?.title, row?.sessionId),
      }));
    } catch (error) {
      log('warn', 'im-bot: 列出会话失败', error);
      return [];
    }
  }

  /**
   * 把一段文本发回某个聊天。
   *
   * @param {{ channel: string, peer: string }} target
   * @param {string} text
   * @param {{ format?: 'text'|'markdown', notice?: boolean }} [options]
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  async function sendToPeer(target, text, options = {}) {
    const channel = channels.onlineChannel(target.channel);
    if (channel === null) return { ok: false, error: '没有可用的在线通道' };
    const receipt = options.format === 'markdown'
      ? await channel.sendMarkdown(target.peer, text)
      : await channel.sendText(target.peer, text);
    return receipt.ok ? { ok: true } : { ok: false, error: receipt.error ?? '发送失败' };
  }

  // -------------------------------------------------------------------------
  // 命令处理
  // -------------------------------------------------------------------------

  /**
   * 执行一条机器人命令。
   * @param {import('./core.js').InboundEvent} event
   * @param {{ name: string, argument: string }} command
   * @returns {Promise<string>}
   */
  async function runCommand(event, command) {
    await ensureBindings();
    const origin = { channel: event.channel, peer: event.peer, chatType: event.chatType };
    const binding = bindings.get(event.channel, event.peer);

    if (command.name === 'help') return renderHelp();

    if (command.name === 'new') {
      const created = await createSessionForPeer(origin, command.argument);
      if (created.ok !== true) return `❌ ${created.error}`;
      return `✅ 已新建并绑定会话 ${created.sessionId.slice(0, 8)}${command.argument === '' ? '' : `（${command.argument}）`}`;
    }

    if (command.name === 'use') {
      if (command.argument === '') return '用法：/use <会话ID>（可用前 8 位前缀）';
      const recent = await listRecentSessions();
      const matched = matchSessionPrefix(recent.map((row) => row.sessionId), command.argument);
      if ('error' in matched) {
        return matched.error === 'ambiguous'
          ? `❌ 前缀有歧义，候选：${matched.candidates.map((id) => id.slice(0, 8)).join(', ')}`
          : '❌ 没有找到匹配的会话，可先用 /sessions 查看';
      }
      bindings.set({ ...origin, sessionId: matched.sessionId, notify: binding?.notify ?? true });
      await persistBindings();
      replyTargets.set(matched.sessionId, { ...origin, at: Date.now() });
      return `✅ 已绑定到会话 ${matched.sessionId.slice(0, 8)}`;
    }

    if (command.name === 'sessions') {
      const recent = await listRecentSessions();
      if (recent.length === 0) return '（没有可用的会话）';
      const current = binding?.sessionId ?? '';
      const lines = recent.map((row) => {
        const mark = row.sessionId === current ? '▶ ' : '  ';
        return `${mark}${row.sessionId.slice(0, 8)}  ${row.title}`;
      });
      return ['📋 最近会话', '', ...lines].join('\n');
    }

    if (command.name === 'status') {
      const parts = ['🤖 DSH 集成机器人状态', ''];
      for (const kind of CHANNEL_KINDS) {
        const state = channels.get(kind);
        const label = CHANNEL_LABELS[kind];
        const status = state === null ? '未启用' : state.status;
        const extra = state !== null && state.lastError !== '' ? `（${truncate(state.lastError, 60)}）` : '';
        parts.push(`${label}：${status}${extra}`);
      }
      parts.push('');
      parts.push(binding === undefined
        ? '当前聊天：未绑定会话（发 /new 新建）'
        : `当前会话：${binding.sessionId.slice(0, 8)}　通知：${binding.notify ? '开' : '关'}`);
      return parts.join('\n');
    }

    if (command.name === 'stop') {
      if (binding === undefined) return '当前聊天还没有绑定会话';
      const controller = sessionController();
      if (controller === undefined || typeof controller.cancel !== 'function') {
        return '❌ 当前 Profile 不支持中止回合';
      }
      try {
        controller.cancel({ sessionId: binding.sessionId });
        return '⏹ 已请求中止当前回合';
      } catch (error) {
        return `❌ 中止失败：${describeError(error)}`;
      }
    }

    if (command.name === 'notify') {
      if (binding === undefined) return '当前聊天还没有绑定会话，先用 /new';
      const argument = command.argument.toLowerCase();
      if (argument !== 'on' && argument !== 'off') return '用法：/notify on|off';
      const next = bindings.setNotify(event.channel, event.peer, argument === 'on');
      await persistBindings();
      return next === null
        ? '❌ 更新失败：绑定已失效'
        : `✅ 本聊天的完成通知已${argument === 'on' ? '开启' : '关闭'}`;
    }

    return renderHelp();
  }

  // -------------------------------------------------------------------------
  // 入站总入口
  // -------------------------------------------------------------------------

  bus.on('inbound', (event) => {
    void handleInbound(event);
  });

  /**
   * 处理一条入站消息。
   * @param {import('./core.js').InboundEvent} event
   * @returns {Promise<void>}
   */
  async function handleInbound(event) {
    const config = readConfig();
    if (config.enabled !== true) return;
    if (str(event?.peer) === '') return;

    // 1) 命令永远允许（不受白名单限制）？——不。白名单是安全边界，
    //    未授权的陌生人连 /help 都不该触发模型额度之外的行为。
    const access = checkAccess(config.access, event);
    if (!access.allowed) {
      log('info', `im-bot: 拒绝 ${event.channel}/${event.peer}（${access.reason}）`);
      return;
    }

    const text = str(event.text);
    if (text === '') return;

    // 2) 命令本地执行，不污染模型历史。
    const command = parseCommand(text);
    if (command.isCommand === true) {
      try {
        const reply = await runCommand(event, command);
        await sendToPeer(event, reply);
      } catch (error) {
        log('warn', `im-bot: 命令 /${command.name} 执行失败`, error);
        await sendToPeer(event, `❌ 命令执行失败：${describeError(error)}`);
      }
      return;
    }

    // 3) 普通消息：投递进绑定会话；没有绑定时给出明确指引。
    await ensureBindings();
    const binding = bindings.get(event.channel, event.peer);
    if (binding === undefined) {
      await sendToPeer(event, '这个聊天还没有绑定会话。\n发 /new 新建一个，或用 /use <会话ID> 绑定已有会话。');
      return;
    }

    // 打字状态是体验增强，失败不影响投递。
    const channel = channels.get(event.channel);
    if (channel !== null && channel.capabilities.typing === true && typeof channel.sendTyping === 'function') {
      void channel.sendTyping(event.peer, TYPING.start);
    }

    const delivered = await deliverToSession(binding.sessionId, text, {
      channel: event.channel,
      peer: event.peer,
      chatType: event.chatType,
    });
    if (delivered.ok !== true) {
      await sendToPeer(event, `❌ ${delivered.error}`);
    }
  }

  // -------------------------------------------------------------------------
  // 回合结束：回推与通知（需求③）
  // -------------------------------------------------------------------------

  /**
   * 从 `session/event` 里累积 assistant 文本、在 `turn/end` 时回推。
   *
   * 为什么不用 `agent/status`：只有 `turn/end` 带 `reason`，能区分
   * `completed` 与 `error/aborted/max-tokens`，这是「失败也要告警」的前提。
   */
  const disposeSessionEvents = ctx.on('session/event', (session, event) => {
    const config = readConfig();
    if (config.enabled !== true) return;
    const sessionId = str(session?.id);
    if (sessionId === '') return;
    const type = str(event?.type);

    if (type === 'session/title') {
      rememberTitle(sessionId, event?.data?.title);
      return;
    }

    if (type === 'turn/start') {
      turnBuffers.set(sessionId, { text: '', startedAt: Date.now(), turn: Number(event?.data?.turn) || 0 });
      return;
    }

    if (type === 'assistant/message') {
      const buffer = turnBuffers.get(sessionId);
      if (buffer === undefined) return;
      const message = event?.data?.message;
      const text = Array.isArray(message?.content)
        ? message.content.filter((block) => block?.type === 'text').map((block) => block.text).join('')
        : '';
      if (text.trim() !== '') buffer.text = text;
      return;
    }

    if (type !== 'turn/end') return;

    const origin = replyTargets.get(sessionId);
    replyTargets.delete(sessionId);
    const buffer = turnBuffers.get(sessionId);
    turnBuffers.delete(sessionId);

    const verdict = classifyTurnEnd(event?.data?.reason);
    const durationMs = buffer === undefined ? 0 : Date.now() - buffer.startedAt;

    void (async () => {
      await ensureBindings();
      // 如果本回合来自特定聊天，优先发回该聊天；
      // 否则（例如在 Web 端发起的任务）广播给所有绑定该会话且开启通知的聊天。
      const sessionBindings = bindings.bySession(sessionId).filter((b) => b.notify === true);
      let targets = [];
      if (origin !== undefined) {
        const bound = sessionBindings.find((b) => b.channel === origin.channel && b.peer === origin.peer);
        if (bound !== undefined) targets = [bound];
        else targets = [origin];
      } else {
        targets = sessionBindings;
      }
      if (targets.length === 0) return;

      const label = sessionLabel(sessionTitles.get(sessionId), sessionId);

      if (verdict.failure === true) {
        if (config.notify.onTurnFailure !== true) return;
        const notice = renderFailureNotice({
          label,
          kind: verdict.kind,
          reason: verdict.detail,
          maxChars: config.notify.failureChars,
        });
        for (const target of targets) {
          const sent = await sendToPeer(target, notice, { format: 'text' });
          if (sent.ok !== true) log('warn', `im-bot: 失败通知未发出到 ${target.channel}/${target.peer}（${sent.error}）`);
        }
        return;
      }

      if (config.notify.onTurnComplete !== true) return;
      // 只在 completed 时发「完成」通知；blocked/interrupted/forked 静默。
      if (verdict.kind !== 'completed') return;

      const summary = buffer === undefined ? '' : buffer.text;
      const notice = renderCompletionNotice({
        label,
        summary,
        durationMs,
        maxChars: config.notify.maxNoticeChars,
      });
      for (const target of targets) {
        const sent = await sendToPeer(target, notice, { format: 'markdown' });
        if (sent.ok !== true) log('warn', `im-bot: 完成通知未发出到 ${target.channel}/${target.peer}（${sent.error}）`);
      }
    })();
  });

  // -------------------------------------------------------------------------
  // 生命周期
  // -------------------------------------------------------------------------

  /**
   * 按当前配置启动通道。配置未启用时什么都不做（默认状态）。
   * @returns {Promise<void>}
   */
  async function boot() {
    await ensureBindings();
    const config = readConfig();
    if (config.enabled !== true) return;
    const credentials = await readCredentials();
    await channels.reconcile(credentials);
  }

  // 启动是异步的，但不能阻塞插件加载：加载失败只影响通道，不该让宿主起不来。
  void boot().catch((error) => log('warn', 'im-bot: 启动通道失败', error));

  // 配置被 Loader 就地更新时重新对齐（live 字段生效路径）。
  const disposeVolatile = ctx.on?.('loader/volatile-update', () => {
    void boot().catch((error) => log('warn', 'im-bot: 配置更新后重启通道失败', error));
  });

  ctx.effect(() => () => {
    disposeVolatile?.();
    disposeSessionEvents?.();
    loginSession = null;
    void channels.stopAll().catch(() => {});
  }, 'im-bot: teardown');

  // -------------------------------------------------------------------------
  // 浏览器 RPC（设置面板）
  // -------------------------------------------------------------------------

  /**
   * 设置页状态。
   * @returns {Promise<object>}
   */
  async function describeStatus() {
    const config = readConfig();
    await ensureBindings();
    const credentials = await readCredentials();
    return {
      enabled: config.enabled,
      config,
      channels: channels.describe(),
      credentials: {
        wecomSecret: credentials.wecomSecret !== '',
        ilinkToken: credentials.ilinkToken !== '',
      },
      bindings: bindings.toJSON().map((binding) => ({
        peerKey: binding.peerKey,
        channel: binding.channel,
        peer: binding.peer,
        chatType: binding.chatType,
        sessionId: binding.sessionId,
        notify: binding.notify,
        updatedAt: binding.updatedAt,
      })),
      login: loginSession === null ? null : loginSession.snapshot(),
      supportsDialog: typeof sessionController()?.resolveAgent === 'function',
    };
  }

  /**
   * 保存设置：写配置（走 ctx.settings）与凭据（走 ctx.credentials）。
   * @param {Record<string, unknown>} payload
   * @returns {Promise<object>}
   */
  async function saveSettings(payload) {
    const input = payload !== null && typeof payload === 'object' ? payload : {};
    // 前端提交的是**扁平**字段；先与当前值合并再规范化，避免漏字段被重置。
    const merged = { ...nestedToFlat(readConfig()), ...pickConfigFields(input) };
    const next = flatToNested(merged);

    // 凭据只在提供了非空值时才覆盖，留空表示「不修改」。
    const secretPatch = input.secrets !== null && typeof input.secrets === 'object' ? input.secrets : {};
    const wecomSecret = str(secretPatch.wecomSecret);
    const ilinkToken = str(secretPatch.ilinkToken);
    const httpSecret = str(secretPatch.httpSecret);
    if (wecomSecret !== '') await ctx.credentials?.set?.(CREDENTIAL_REFS.wecomSecret, wecomSecret);
    if (ilinkToken !== '') await ctx.credentials?.set?.(CREDENTIAL_REFS.ilinkToken, ilinkToken);
    if (httpSecret !== '') await ctx.credentials?.set?.(CREDENTIAL_REFS.httpSecret, httpSecret);

    // 写回配置。live 字段由宿主设置服务落盘并就地生效。
    try {
      await writeFlatConfig(next);
    } catch (error) {
      log('warn', 'im-bot: 写入配置失败', error);
      throw error;
    }

    await boot().catch((error) => log('warn', 'im-bot: 保存后重启通道失败', error));
    return describeStatus();
  }

  /**
   * 把规范化后的嵌套配置按扁平字段写回 settings。
   * @param {ReturnType<typeof normalizeConfig>} nested
   * @returns {Promise<void>}
   */
  async function writeFlatConfig(nested) {
    const flat = nestedToFlat(nested);
    const ops = CONFIG_KEYS
      .filter((key) => Object.hasOwn(flat, key))
      .map((key) => ({ op: 'set', path: [key], value: flat[key] }));
    await ctx.settings?.mutate?.(NS, ops);
  }

  /**
   * 扫码登录：开始。
   * @returns {Promise<object>}
   */
  async function startLogin() {
    const config = readConfig();
    loginSession = new IlinkLoginSession({
      baseUrl: config.ilink.baseUrl,
      log,
    });
    const snapshot = await loginSession.start();
    return snapshot;
  }

  /**
   * 扫码登录：轮询。确认成功后把凭据写进 credentials 并启动通道。
   * @returns {Promise<object>}
   */
  async function pollLogin() {
    if (loginSession === null) return { status: 'error', message: '尚未开始登录' };
    const snapshot = await loginSession.poll();
    if (snapshot.status === 'confirmed' && snapshot.credentials !== undefined) {
      const { accountId, token, baseUrl } = snapshot.credentials;
      await ctx.credentials?.set?.(CREDENTIAL_REFS.ilinkToken, token);
      const config = readConfig();
      // 扫码成功即视为用户明确要启用个人微信通道，连同总开关一起打开，
      // 否则用户还要再点两次「启用」才能收到消息。
      const next = flatToNested({
        ...nestedToFlat(config),
        enabled: true,
        ilinkEnabled: true,
        ilinkAccountId: accountId,
        ilinkBaseUrl: baseUrl,
      });
      try {
        await writeFlatConfig(next);
      } catch (error) {
        log('warn', 'im-bot: 写入 iLink 账号失败', error);
      }
      await boot().catch((error) => log('warn', 'im-bot: 扫码后启动通道失败', error));
    }
    return snapshot;
  }

  /**
   * 手动绑定：把某个会话绑定到某个聊天。
   * @param {Record<string, unknown>} payload
   * @returns {Promise<object>}
   */
  async function bindPeer(payload) {
    const channel = str(payload?.channel);
    const peer = str(payload?.peer);
    const sessionId = str(payload?.sessionId);
    if (!CHANNEL_KINDS.includes(channel)) throw new Error(`未知通道：${channel}`);
    if (peer === '') throw new Error('peer 不能为空');
    if (sessionId === '') throw new Error('sessionId 不能为空');
    await ensureBindings();
    const binding = bindings.set({ channel, peer, sessionId, chatType: 'single', notify: true });
    await persistBindings();
    return { binding };
  }

  /**
   * 解除绑定。
   * @param {Record<string, unknown>} payload
   * @returns {Promise<object>}
   */
  async function unbindPeer(payload) {
    await ensureBindings();
    const channel = str(payload?.channel);
    const peer = str(payload?.peer);
    const removed = bindings.remove(channel, peer);
    if (removed) await persistBindings();
    return { removed };
  }

  /**
   * 主动发送（设置页「测试发送」与外部调用共用）。
   * @param {Record<string, unknown>} payload
   * @returns {Promise<object>}
   */
  async function sendMessage(payload) {
    const parsed = normalizeSendRequest(payload);
    if (parsed.ok !== true) throw new Error(parsed.error);
    const request = parsed.value;

    let target = { channel: request.channel ?? '', peer: request.peer ?? '' };
    if (target.peer === '' && request.sessionId !== undefined) {
      await ensureBindings();
      const found = bindings.bySession(request.sessionId);
      if (found.length === 0) throw new Error('该会话没有绑定的聊天');
      target = { channel: found[0].channel, peer: found[0].peer };
    }
    if (target.peer === '') throw new Error('需要 peer 或已绑定的 sessionId');

    const sent = await sendToPeer(target, request.text, { format: request.format });
    if (sent.ok !== true) throw new Error(sent.error ?? '发送失败');
    return { ok: true };
  }

  /**
   * 诊断信息（设置页「测试连接」）。
   * @returns {Promise<object>}
   */
  async function runDiagnostics() {
    const config = readConfig();
    const credentials = await readCredentials();
    return {
      enabled: config.enabled,
      channels: channels.describe(),
      credentials: {
        wecomSecret: credentials.wecomSecret !== '',
        ilinkToken: credentials.ilinkToken !== '',
      },
      stateDir: stateDir(),
      supportsDialog: typeof sessionController()?.resolveAgent === 'function',
      node: process.version,
      webSocket: typeof globalThis.WebSocket === 'function',
    };
  }

  /**
   * RPC 方法表。
   * @param {string} method
   * @param {Record<string, unknown>} payload
   * @returns {Promise<unknown>}
   */
  async function handleRpc(method, payload) {
    switch (method) {
      case 'status':
        return describeStatus();
      case 'save':
        return saveSettings(payload);
      case 'diagnostics':
        return runDiagnostics();
      case 'ilink.login.start':
        return startLogin();
      case 'ilink.login.poll':
        return pollLogin();
      case 'ilink.login.cancel':
        loginSession = null;
        return { status: 'cancelled' };
      case 'bindings.bind':
        return bindPeer(payload);
      case 'bindings.remove':
        return unbindPeer(payload);
      case 'bindings.list':
        await ensureBindings();
        return { bindings: bindings.toJSON() };
      case 'send':
        return sendMessage(payload);
      case 'commands':
        return { commands: COMMANDS, help: renderHelp() };
      default:
        throw new Error(`未知方法：${method}`);
    }
  }

  ctx.inject(['connection'], (connectionCtx) => {
    if (typeof connectionCtx.connection?.rpc?.handle !== 'function') return;
    connectionCtx.connection.rpc.handle(
      RPC_CHANNEL,
      async (method, payload) => {
        try {
          const value = await handleRpc(str(method), payload ?? {});
          return { ok: true, value };
        } catch (error) {
          return {
            ok: false,
            error: { code: 'im-bot', message: describeError(error), details: {} },
          };
        }
      },
      { authority: 'trusted-host' },
    );
  });

  // -------------------------------------------------------------------------
  // 通用发送 HTTP 路由
  // -------------------------------------------------------------------------

  /**
   * 常量时间字符串比较，避免通过响应时间猜 token。
   * @param {string} expected
   * @param {string} presented
   * @returns {boolean}
   */
  function safeEqual(expected, presented) {
    if (expected === '' || presented === '') return false;
    const left = Buffer.from(expected, 'utf8');
    const right = Buffer.from(presented, 'utf8');
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SEND_ROUTE,
    handler: async (req, res) => {
      const send = (status, body) => {
        res.statusCode = status;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(body));
      };

      // 未配置 token 时整条路由视同不存在：不泄漏「这里有个发送接口」。
      const expected = await resolveSecret(CREDENTIAL_REFS.httpSecret);
      if (expected === '') {
        send(404, { ok: false, error: 'not-found' });
        return;
      }
      if (safeEqual(expected, str(req.headers['x-dsh-im-bot-token']))) {
        // 通过
      } else {
        send(401, { ok: false, error: 'unauthorized' });
        return;
      }
      if (req.method !== 'POST') {
        res.setHeader('allow', 'POST');
        send(405, { ok: false, error: 'method-not-allowed' });
        return;
      }

      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 1 << 20) {
          send(413, { ok: false, error: 'payload-too-large' });
          return;
        }
        chunks.push(chunk);
      }

      let payload;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        send(400, { ok: false, error: 'invalid-json' });
        return;
      }

      try {
        const result = await sendMessage(payload);
        send(200, { ok: true, value: result });
      } catch (error) {
        send(400, { ok: false, error: describeError(error) });
      }
    },
  }), 'im-bot: send route');

  // -------------------------------------------------------------------------
  // 原生工具：让模型能主动推消息
  // -------------------------------------------------------------------------

  if (typeof ctx.tools?.register === 'function') {
    ctx.tools.register({
      name: 'im_bot_send',
      description: [
        '向已绑定的微信/企业微信聊天主动发送一条消息。',
        '用于任务完成通知、把结果推送到手机上等场景。',
        'target 可以是绑定的会话（sessionId），也可以显式给 channel + peer。',
      ].join(''),
      parameters: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string', description: '要发送的正文。' },
          format: {
            type: 'string',
            enum: ['text', 'markdown'],
            description: 'markdown 仅在通道支持时生效，否则自动降级为纯文本。',
          },
          sessionId: { type: 'string', description: '按会话查绑定的聊天（与 channel/peer 二选一）。' },
          channel: { type: 'string', enum: CHANNEL_KINDS, description: '目标通道。' },
          peer: { type: 'string', description: '通道内的聊天标识（企微 chatid/userid，iLink userid）。' },
        },
      },
      isConcurrencySafe: () => false,
      execute: async (args) => {
        const result = await sendMessage(args ?? {});
        return result;
      },
    });
  }
}

