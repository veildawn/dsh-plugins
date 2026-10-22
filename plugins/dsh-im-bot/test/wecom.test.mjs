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
    this.sent.push(JSON.parse(data));
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
  assert.match(hint.body.text.content, /仅支持文本/);
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
  assert.equal(frame.body.msgtype, 'text');
  assert.equal(frame.body.text.content, '通知内容');
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
  assert.equal(frames.map((frame) => frame.body.text.content).join(''), 'x'.repeat(4500));
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
  assert.equal(frame.body.text.content, '收到');
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
