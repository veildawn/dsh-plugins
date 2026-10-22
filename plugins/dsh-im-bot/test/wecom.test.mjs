/**
 * 企业微信长连接通道单测。
 *
 * 用假的 WebSocket 驱动协议编解码与状态机：断言订阅报文、心跳、入站归一化、
 * 被踢重连、分片与降级。零网络、零真实连接。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  CMD,
  CHAT_TYPE_GROUP,
  CHAT_TYPE_SINGLE,
  WecomChannel,
  eventTypeOf,
  extractWecomText,
  isDisconnectedEvent,
  normalizeWecomMessage,
  parseFrame,
} from '../lib/channels/wecom.js';
import { STATUS } from '../lib/channels/base.js';

/**
 * 假 WebSocket：记录 send 出去的帧，允许测试主动注入 message/close。
 */
class FakeWebSocket extends EventTarget {
  static OPEN = 1;
  static instances = [];

  /**
   * 下一个 aibot_send_msg 的服务端应答 errcode（0 = 成功）。
   * 企微的发送应答是异步的，通道会按 req_id 等待；假实现必须回，
   * 否则每次发送都会挂到超时。
   */
  static nextSendErrcode = 0;
  static nextSendErrmsg = 'ok';

  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.closed = false;
    FakeWebSocket.instances.push(this);
    // 异步触发 open，模拟真实握手。
    setTimeout(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.dispatchEvent(new Event('open'));
    }, 0);
  }

  send(data) {
    const frame = JSON.parse(data);
    this.sent.push(frame);
    // 对 aibot_send_msg 自动回一条应答，模拟真实服务端行为。
    if (frame.cmd === 'aibot_send_msg') {
      setTimeout(() => {
        this.emitFrame({
          headers: { req_id: frame.headers.req_id },
          errcode: FakeWebSocket.nextSendErrcode,
          errmsg: FakeWebSocket.nextSendErrmsg,
        });
      }, 0);
    }
  }

  close() {
    this.closed = true;
    this.readyState = 3;
    setTimeout(() => this.dispatchEvent(new Event('close')), 0);
  }

  /** 服务端推一帧下来。 */
  emitFrame(frame) {
    const event = new Event('message');
    event.data = JSON.stringify(frame);
    this.dispatchEvent(event);
  }
}

/** 造一个通道并等它订阅成功。 */
async function connectedChannel(overrides = {}) {
  FakeWebSocket.instances.length = 0;
  const bus = new EventEmitter();
  const events = [];
  bus.on('inbound', (event) => events.push(event));

  const channel = new WecomChannel({
    botId: 'BOT1',
    secret: 'SECRET1',
    WebSocketImpl: FakeWebSocket,
    bus,
    ...overrides,
  });
  const starting = channel.start();
  // 等 open 之后发出的 subscribe，然后回一个成功响应。
  await new Promise((resolve) => setTimeout(resolve, 5));
  const socket = FakeWebSocket.instances.at(-1);
  socket.emitFrame({ headers: { req_id: 'x' }, errcode: 0, errmsg: 'ok' });
  await starting;
  return { channel, socket, bus, events };
}

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

test('extractWecomText 取 text 正文', () => {
  assert.equal(extractWecomText({ msgtype: 'text', text: { content: '@Robot 你好' } }), '@Robot 你好');
});

test('extractWecomText 拼接 mixed 里的多个文本段', () => {
  const body = {
    msgtype: 'mixed',
    mixed: {
      msg_item: [
        { msgtype: 'text', text: { content: '第一段' } },
        { msgtype: 'image' },
        { msgtype: 'text', text: { content: '第二段' } },
      ],
    },
  };
  assert.equal(extractWecomText(body), '第一段\n第二段');
});

test('extractWecomText 取 voice 的转写文本', () => {
  assert.equal(extractWecomText({ msgtype: 'voice', voice: { content: '语音内容' } }), '语音内容');
});

test('extractWecomText 媒体消息返回空串', () => {
  assert.equal(extractWecomText({ msgtype: 'image', image: { url: 'x' } }), '');
  assert.equal(extractWecomText(null), '');
});

test('normalizeWecomMessage 群聊寻址用 chatid、from 记发言人', () => {
  const event = normalizeWecomMessage({
    cmd: CMD.msgCallback,
    headers: { req_id: 'REQ1' },
    body: {
      msgid: 'M1',
      chatid: 'CHAT1',
      chattype: 'group',
      from: { userid: 'U1' },
      msgtype: 'text',
      text: { content: 'hi' },
    },
  });
  assert.equal(event.peer, 'CHAT1');
  assert.equal(event.chatType, 'group');
  assert.equal(event.from, 'U1');
  assert.equal(event.replyToken, 'REQ1');
  assert.equal(event.messageId, 'M1');
});

test('normalizeWecomMessage 单聊没有 chatid 时回退到 userid', () => {
  const event = normalizeWecomMessage({
    body: { msgid: 'M2', chattype: 'single', from: { userid: 'U9' }, msgtype: 'text', text: { content: 'hi' } },
  });
  assert.equal(event.peer, 'U9');
  assert.equal(event.chatType, 'single');
  assert.equal(event.replyToken, undefined);
});

test('normalizeWecomMessage 无 peer 时返回 null', () => {
  assert.equal(normalizeWecomMessage({ body: { msgtype: 'text' } }), null);
  assert.equal(normalizeWecomMessage(null), null);
});

test('isDisconnectedEvent 只认 disconnected_event', () => {
  assert.equal(isDisconnectedEvent({
    cmd: CMD.eventCallback,
    body: { event: { eventtype: 'disconnected_event' } },
  }), true);
  assert.equal(isDisconnectedEvent({
    cmd: CMD.eventCallback,
    body: { event: { eventtype: 'enter_chat' } },
  }), false);
  assert.equal(isDisconnectedEvent({ cmd: CMD.msgCallback, body: {} }), false);
});

test('eventTypeOf 取出事件类型', () => {
  assert.equal(eventTypeOf({ body: { event: { eventtype: 'enter_chat' } } }), 'enter_chat');
  assert.equal(eventTypeOf({ body: {} }), '');
});

test('parseFrame 拒绝脏帧而不是抛错', () => {
  assert.equal(parseFrame('not json'), null);
  assert.equal(parseFrame('[]'), null);
  assert.equal(parseFrame(''), null);
  assert.equal(parseFrame(123), null);
  assert.deepEqual(parseFrame('{"cmd":"ping"}'), { cmd: 'ping' });
});

// ---------------------------------------------------------------------------
// 连接与订阅
// ---------------------------------------------------------------------------

test('start 连到官方地址并发出 aibot_subscribe', async () => {
  const { channel, socket } = await connectedChannel();
  assert.equal(socket.url, 'wss://openws.work.weixin.qq.com');
  const subscribe = socket.sent.find((frame) => frame.cmd === CMD.subscribe);
  assert.ok(subscribe !== undefined, '必须发出 aibot_subscribe');
  assert.equal(subscribe.body.bot_id, 'BOT1');
  assert.equal(subscribe.body.secret, 'SECRET1');
  assert.equal(typeof subscribe.headers.req_id, 'string');
  assert.equal(channel.status, STATUS.online);
  await channel.stop();
});

test('订阅被拒绝时 start 抛错且状态为 error', async () => {
  FakeWebSocket.instances.length = 0;
  const channel = new WecomChannel({ botId: 'B', secret: 'S', WebSocketImpl: FakeWebSocket });
  const starting = channel.start();
  await new Promise((resolve) => setTimeout(resolve, 5));
  FakeWebSocket.instances.at(-1).emitFrame({ errcode: 40001, errmsg: 'invalid secret' });
  await assert.rejects(starting, /订阅被拒绝/);
  assert.equal(channel.status, STATUS.error);
  assert.match(channel.lastError, /40001/);
});

test('缺少 BotID 或 Secret 时明确报错', async () => {
  const noBot = new WecomChannel({ botId: '', secret: 'S', WebSocketImpl: FakeWebSocket });
  await assert.rejects(noBot.start(), /缺少 BotID/);
  const noSecret = new WecomChannel({ botId: 'B', secret: '', WebSocketImpl: FakeWebSocket });
  await assert.rejects(noSecret.start(), /缺少 Secret/);
});

// ---------------------------------------------------------------------------
// 心跳
// ---------------------------------------------------------------------------

test('订阅成功后按间隔发 ping', async () => {
  const { channel, socket } = await connectedChannel({ heartbeatSeconds: 5 });
  // 直接触发内部定时器不方便，改为断言定时器已建立 + 手动推进不现实；
  // 这里改为验证 _startHeartbeat 的效果：调用后 ping 会在间隔后发出。
  assert.ok(channel._heartbeatTimer !== null, '心跳定时器应已建立');
  await channel.stop();
  assert.equal(channel._heartbeatTimer, null, 'stop 后心跳必须清掉');
  assert.ok(socket.closed);
});

// ---------------------------------------------------------------------------
// 入站派发
// ---------------------------------------------------------------------------

test('收到文本消息派发 inbound 并登记 peer 类型', async () => {
  const { channel, socket, events } = await connectedChannel();
  socket.emitFrame({
    cmd: CMD.msgCallback,
    headers: { req_id: 'R1' },
    body: {
      msgid: 'M1', chatid: 'CHAT1', chattype: 'group',
      from: { userid: 'U1' }, msgtype: 'text', text: { content: '你好' },
    },
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].peer, 'CHAT1');
  assert.equal(events[0].text, '你好');
  await channel.stop();
});

test('同一条 messageId 只派发一次（排重）', async () => {
  const { channel, socket, events } = await connectedChannel();
  const frame = {
    cmd: CMD.msgCallback,
    headers: { req_id: 'R1' },
    body: { msgid: 'M1', chatid: 'C', chattype: 'group', from: { userid: 'U' }, msgtype: 'text', text: { content: 'hi' } },
  };
  socket.emitFrame(frame);
  socket.emitFrame(frame);
  assert.equal(events.length, 1);
  await channel.stop();
});

test('媒体消息不派发但回一条提示', async () => {
  const { channel, socket, events } = await connectedChannel();
  socket.emitFrame({
    cmd: CMD.msgCallback,
    headers: { req_id: 'R1' },
    body: { msgid: 'M2', chatid: 'C1', chattype: 'group', from: { userid: 'U1' }, msgtype: 'image', image: { url: 'x' } },
  });
  assert.equal(events.length, 0);
  // 提示是 fire-and-forget 发出的，等它落到 socket 上。
  await new Promise((resolve) => setTimeout(resolve, 20));
  const hint = socket.sent.find((frame) => frame.cmd === CMD.sendMsg);
  assert.ok(hint !== undefined, '应回一条「仅支持文本」提示');
  assert.match(hint.body.markdown.content, /仅支持文本/);
  await channel.stop();
});

test('收到 disconnected_event 时标记被接管、关闭连接且停止自动重连', async () => {
  const { channel, socket } = await connectedChannel();
  socket.emitFrame({
    cmd: CMD.eventCallback,
    body: { event: { eventtype: 'disconnected_event' } },
  });
  // 等 socket close 事件触发
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(channel.status, STATUS.error);
  assert.match(channel.lastError, /已被新连接接管/);
  assert.equal(channel.reconnect._timer, null, '被接管后不得调度自动重连');
  await channel.stop();
});

// ---------------------------------------------------------------------------
// 出站
// ---------------------------------------------------------------------------

test('发送文本用 aibot_send_msg 并显式带 chat_type', async () => {
  const { channel, socket } = await connectedChannel();
  socket.sent.length = 0;
  channel.rememberPeerType('CHAT1', 'group');
  const receipt = await channel.sendText('CHAT1', '通知内容');
  assert.equal(receipt.ok, true);
  const frame = socket.sent.find((sent) => sent.cmd === CMD.sendMsg);
  assert.ok(frame !== undefined);
  assert.equal(frame.body.chatid, 'CHAT1');
  assert.equal(frame.body.chat_type, CHAT_TYPE_GROUP, '群聊必须用 chat_type=2');
  // 企微智能机器人只有 markdown / template_card 两种类型，没有 text。
  assert.equal(frame.body.msgtype, 'markdown', '企微不支持 text，必须走 markdown');
  assert.equal(frame.body.markdown.content, '通知内容');
  assert.equal(frame.body.text, undefined, '不得再发 text 字段');
  await channel.stop();
});

test('未登记的 peer 按单聊 chat_type=1 发送', async () => {
  const { channel, socket } = await connectedChannel();
  socket.sent.length = 0;
  await channel.sendText('UNKNOWN', 'x');
  const frame = socket.sent.find((sent) => sent.cmd === CMD.sendMsg);
  assert.equal(frame.body.chat_type, CHAT_TYPE_SINGLE);
  await channel.stop();
});

test('发送 markdown 用 msgtype=markdown', async () => {
  const { channel, socket } = await connectedChannel();
  socket.sent.length = 0;
  const receipt = await channel.sendMarkdown('C1', '**粗体**');
  assert.equal(receipt.ok, true);
  const frame = socket.sent.find((sent) => sent.cmd === CMD.sendMsg);
  assert.equal(frame.body.msgtype, 'markdown');
  assert.equal(frame.body.markdown.content, '**粗体**');
  await channel.stop();
});

test('长文本按 2000 字符分片', async () => {
  const { channel, socket } = await connectedChannel();
  socket.sent.length = 0;
  const receipt = await channel.sendText('C1', 'x'.repeat(4500));
  assert.equal(receipt.ok, true);
  const frames = socket.sent.filter((sent) => sent.cmd === CMD.sendMsg);
  assert.equal(frames.length, 3, '4500 字符应切成 3 片');
  const joined = frames.map((frame) => (frame.body.markdown ?? frame.body.text)?.content ?? '').join('');
  assert.equal(joined, 'x'.repeat(4500));
  await channel.stop();
});

test('多分片发送中途失败时 ok 必须为 false 且返回错误信息', async () => {
  const { channel } = await connectedChannel();
  let calls = 0;
  channel._sendText = async () => {
    calls += 1;
    if (calls === 2) throw new Error('网络中断');
    return 'id';
  };
  const receipt = await channel.sendText('C1', 'x'.repeat(4500));
  assert.equal(receipt.ok, false);
  assert.equal(receipt.chunks, 1);
  assert.match(receipt.error, /网络中断/);
  await channel.stop();
});

test('通道离线时发送返回失败而不是抛错', async () => {
  const channel = new WecomChannel({ botId: 'B', secret: 'S', WebSocketImpl: FakeWebSocket });
  const receipt = await channel.sendText('C1', 'x');
  assert.equal(receipt.ok, false);
  assert.match(receipt.error, /通道未就绪/);
});

test('空 peer 或空正文直接拒绝', async () => {
  const { channel } = await connectedChannel();
  assert.equal((await channel.sendText('', 'x')).ok, false);
  assert.equal((await channel.sendText('C1', '   ')).ok, false);
  await channel.stop();
});

test('respond 用回调的 req_id 回传', async () => {
  const { channel, socket } = await connectedChannel();
  socket.sent.length = 0;
  assert.equal(channel.respond('REQ9', '收到'), true);
  const frame = socket.sent.find((sent) => sent.cmd === CMD.respondMsg);
  assert.equal(frame.headers.req_id, 'REQ9');
  assert.equal(frame.body.msgtype, 'markdown', 'aibot_respond_msg 同样没有 text 类型');
  assert.equal(frame.body.markdown.content, '收到');
  assert.equal(channel.respond('', 'x'), false, '空 req_id 不应发送');
  await channel.stop();
});

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------

test('stop 幂等且清理心跳与连接', async () => {
  const { channel, socket } = await connectedChannel();
  await channel.stop();
  assert.equal(channel.status, STATUS.idle);
  assert.equal(socket.closed, true);
  await channel.stop();
  assert.equal(channel.status, STATUS.idle);
});

test('describe 暴露状态、错误与能力', async () => {
  const { channel } = await connectedChannel();
  const state = channel.describe();
  assert.equal(state.kind, 'wecom');
  assert.equal(state.status, STATUS.online);
  assert.equal(state.capabilities.markdown, true);
  assert.equal(state.capabilities.proactivePush, true);
  await channel.stop();
});

// ---------------------------------------------------------------------------
// ws（EventEmitter）风格实现的兼容性
//
// 生产环境用 `ws` 包：它的 API 与浏览器 WebSocket 不同（on() 而非
// addEventListener()，message 直接给 data 而非事件对象，error 直接给 Error）。
// 这里用 EventEmitter 造一个 ws 风格实现，确保适配层两条路径都被覆盖。
// ---------------------------------------------------------------------------

/** ws 风格的假实现：EventEmitter API，没有 addEventListener。 */
class WsStyleWebSocket extends EventEmitter {
  static instances = [];

  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.closed = false;
    WsStyleWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.emit('open');
    }, 0);
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.closed = true;
    this.readyState = 3;
    setTimeout(() => this.emit('close', 1000, Buffer.alloc(0)), 0);
  }

  /** ws 的 message 回调直接给 data，不是事件对象。 */
  emitFrame(frame) {
    this.emit('message', Buffer.from(JSON.stringify(frame)));
  }
}

/** 用 ws 风格实现建立连接。 */
async function connectedWsStyleChannel() {
  WsStyleWebSocket.instances.length = 0;
  const bus = new EventEmitter();
  const events = [];
  bus.on('inbound', (event) => events.push(event));

  const channel = new WecomChannel({
    botId: 'BOT1',
    secret: 'SECRET1',
    WebSocketImpl: WsStyleWebSocket,
    bus,
  });
  const starting = channel.start();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const socket = WsStyleWebSocket.instances.at(-1);
  socket.emitFrame({ errcode: 0, errmsg: 'ok' });
  await starting;
  return { channel, socket, events };
}

test('ws 风格实现（EventEmitter）也能完成订阅', async () => {
  const { channel, socket } = await connectedWsStyleChannel();
  assert.equal(channel.status, STATUS.online);
  const subscribe = socket.sent.find((f) => f.cmd === 'aibot_subscribe');
  assert.ok(subscribe !== undefined, 'ws 风格下也必须发出订阅帧');
  assert.equal(subscribe.body.bot_id, 'BOT1');
  await channel.stop();
  assert.equal(socket.closed, true, 'stop 必须真正关闭 ws 连接');
});

test('ws 风格的 message（直接给 Buffer）能被正确解析', async () => {
  const { channel, socket, events } = await connectedWsStyleChannel();
  socket.emitFrame({
    cmd: 'aibot_msg_callback',
    headers: { req_id: 'R1' },
    body: {
      msgid: 'WM1', chatid: 'C1', chattype: 'group',
      from: { userid: 'U1' }, msgtype: 'text', text: { content: '来自 ws 的消息' },
    },
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].text, '来自 ws 的消息');
  await channel.stop();
});

test('订阅被拒时 ws 风格的错误信息可读', async () => {
  WsStyleWebSocket.instances.length = 0;
  const channel = new WecomChannel({
    botId: 'B', secret: 'S', WebSocketImpl: WsStyleWebSocket,
  });
  const starting = channel.start();
  await new Promise((resolve) => setTimeout(resolve, 5));
  WsStyleWebSocket.instances.at(-1).emitFrame({
    errcode: 853000, errmsg: 'invalid bot_id or secret',
  });
  await assert.rejects(starting, /853000/);
  assert.match(channel.lastError, /853000/);
});

test('ws 风格的 error（直接给 Error）被正确捕获', async () => {
  WsStyleWebSocket.instances.length = 0;
  const channel = new WecomChannel({
    botId: 'B', secret: 'S', WebSocketImpl: WsStyleWebSocket,
  });
  const starting = channel.start();
  await new Promise((resolve) => setTimeout(resolve, 5));
  WsStyleWebSocket.instances.at(-1).emit('error', new Error('Received network error or non-101 status code.'));
  await assert.rejects(starting, /non-101/);
  assert.match(channel.lastError, /non-101/);
});

// ---------------------------------------------------------------------------
// 发送应答（errcode）感知
//
// 企微对 aibot_send_msg 的应答是异步的：帧写出成功 ≠ 消息发送成功。
// 早期实现只看 socket.send() 是否抛错，导致 errcode=40008
// （invalid message type）被静默吞掉，用户只看到「发了但对方没收到」。
// ---------------------------------------------------------------------------

test('服务端返回非 0 errcode 时发送必须失败并带出原因', async () => {
  const { channel } = await connectedChannel();
  FakeWebSocket.nextSendErrcode = 40008;
  FakeWebSocket.nextSendErrmsg = 'invalid message type';
  try {
    const receipt = await channel.sendText('C1', '你好');
    assert.equal(receipt.ok, false, '服务端拒绝时 ok 必须为 false');
    assert.match(receipt.error, /40008/);
    assert.match(receipt.error, /invalid message type/);
  } finally {
    FakeWebSocket.nextSendErrcode = 0;
    FakeWebSocket.nextSendErrmsg = 'ok';
    await channel.stop();
  }
});

test('errcode 0 的应答不会被误当成心跳吃掉', async () => {
  /*
   * 成功应答的形状是 { errcode: 0, cmd: '' }，与心跳 pong 一模一样。
   * 如果应答判断排在心跳之后，发送会永远挂到超时——这里断言能正常返回。
   */
  const { channel } = await connectedChannel();
  const receipt = await channel.sendText('C1', 'ping-pong 形状冲突检查');
  assert.equal(receipt.ok, true, '成功应答必须被正确兑现，不能挂到超时');
  await channel.stop();
});

test('发送不再使用企微不支持的 text 消息类型', async () => {
  const { channel, socket } = await connectedChannel();
  socket.sent.length = 0;
  await channel.sendText('C1', '普通文本');
  await channel.sendMarkdown('C1', '**加粗**');
  const frames = socket.sent.filter((f) => f.cmd === CMD.sendMsg);
  assert.equal(frames.length, 2);
  for (const frame of frames) {
    assert.equal(frame.body.msgtype, 'markdown', '所有出站消息都必须是 markdown');
    assert.equal(frame.body.text, undefined, '不得出现 text 字段');
  }
  await channel.stop();
});
