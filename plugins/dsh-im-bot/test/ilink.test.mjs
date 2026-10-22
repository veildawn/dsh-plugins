/**
 * 个人微信 iLink 通道单测。
 *
 * 用假的 fetch 驱动长轮询、发送、context_token 降级重试与扫码登录状态机。
 * 零网络、零真实凭据。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  EP,
  ERRCODE_RATE_LIMIT,
  ERRCODE_SESSION_EXPIRED,
  IlinkChannel,
  IlinkLoginSession,
  extractIlinkText,
  guessIlinkChat,
  isRateLimited,
  isSendOk,
  isSessionExpired,
  normalizeIlinkMessage,
  randomWechatUin,
  buildHeaders,
} from '../lib/channels/ilink.js';
import { STATUS } from '../lib/channels/base.js';

/**
 * 可编程的假 fetch：按 URL 子串路由到预设响应序列。
 */
function makeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    for (const [needle, responder] of Object.entries(routes)) {
      if (String(url).includes(needle)) {
        const value = typeof responder === 'function' ? await responder({ url: String(url), init }) : responder;
        const body = typeof value === 'string' ? value : JSON.stringify(value);
        return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    throw new Error(`未配置的请求：${url}`);
  };
  impl.calls = calls;
  return impl;
}

/** 造一个已 online 的 iLink 通道（跳过真实轮询）。 */
function onlineChannel({ fetchImpl, bus, events } = {}) {
  const channel = new IlinkChannel({
    accountId: 'ACC1',
    token: 'TOKEN1',
    fetch: fetchImpl,
    bus,
  });
  channel._status = STATUS.online;
  return channel;
}

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

test('buildHeaders 带齐 iLink 必需头', () => {
  const headers = buildHeaders('{"a":1}', 'TK');
  assert.equal(headers.AuthorizationType, 'ilink_bot_token');
  assert.equal(headers['iLink-App-Id'], 'bot');
  assert.equal(headers.Authorization, 'Bearer TK');
  assert.equal(headers['Content-Length'], '7');
  assert.equal(typeof headers['X-WECHAT-UIN'], 'string');
});

test('buildHeaders 无 token 时不带 Authorization', () => {
  assert.equal(buildHeaders('{}').Authorization, undefined);
});

test('randomWechatUin 是 4 字节小端序的十进制再 base64', () => {
  assert.equal(randomWechatUin(() => new Uint8Array([0, 0, 0, 5])), Buffer.from('5').toString('base64'));
  assert.equal(randomWechatUin(() => new Uint8Array([0, 0, 1, 0])), Buffer.from('256').toString('base64'));
});

test('isSessionExpired 认 -14 与 -2+unknown error', () => {
  assert.equal(isSessionExpired({ ret: ERRCODE_SESSION_EXPIRED }), true);
  assert.equal(isSessionExpired({ errcode: ERRCODE_SESSION_EXPIRED }), true);
  assert.equal(isSessionExpired({ ret: ERRCODE_RATE_LIMIT, errmsg: 'unknown error' }), true);
  assert.equal(isSessionExpired({ ret: ERRCODE_RATE_LIMIT, errmsg: 'rate limited' }), false);
  assert.equal(isSessionExpired({ ret: 0 }), false);
});

test('isRateLimited 与过期判定互斥', () => {
  assert.equal(isRateLimited({ ret: ERRCODE_RATE_LIMIT, errmsg: 'rate limited' }), true);
  assert.equal(isRateLimited({ ret: ERRCODE_RATE_LIMIT, errmsg: 'unknown error' }), false);
  assert.equal(isRateLimited({ ret: 0 }), false);
});

test('isSendOk 认可缺省字段为成功', () => {
  assert.equal(isSendOk({}), true);
  assert.equal(isSendOk({ ret: 0, errcode: 0 }), true);
  assert.equal(isSendOk({ ret: -1 }), false);
  assert.equal(isSendOk({ errcode: 500 }), false);
});

test('extractIlinkText 取文本项', () => {
  assert.equal(extractIlinkText([{ type: 1, text_item: { text: '你好' } }]), '你好');
});

test('extractIlinkText 保留引用的原文与标题', () => {
  const text = extractIlinkText([{
    type: 1,
    text_item: { text: '我的回答' },
    ref_msg: { title: '标题', message_item: { type: 1, text_item: { text: '被引用的原文' } } },
  }]);
  assert.ok(text.includes('标题'));
  assert.ok(text.includes('被引用的原文'));
  assert.ok(text.includes('我的回答'));
});

test('extractIlinkText 引用媒体时标出来源类型', () => {
  const text = extractIlinkText([{
    type: 1,
    text_item: { text: '看图' },
    ref_msg: { title: 'a.png', message_item: { type: 2 } },
  }]);
  assert.ok(text.includes('引用媒体'));
  assert.ok(text.includes('a.png'));
});

test('extractIlinkText 语音在无媒体时使用官方转写并标注', () => {
  assert.equal(extractIlinkText([{ type: 3, voice_item: { text: '语音内容' } }]), '[语音转写]\n语音内容');
});

test('extractIlinkText 语音有可下载媒体时不抢占正文', () => {
  assert.equal(extractIlinkText([{ type: 3, voice_item: { text: '转写', media: { url: 'x' } } }]), '');
});

test('extractIlinkText 无文本项返回空串', () => {
  assert.equal(extractIlinkText([{ type: 2 }]), '');
  assert.equal(extractIlinkText([]), '');
  assert.equal(extractIlinkText(null), '');
});

test('guessIlinkChat 有 room_id 时判群聊', () => {
  assert.deepEqual(guessIlinkChat({ room_id: 'R1', from_user_id: 'U1' }, 'ACC'), { chatType: 'group', peer: 'R1' });
});

test('guessIlinkChat 单聊寻址用发送者', () => {
  assert.deepEqual(
    guessIlinkChat({ from_user_id: 'U1', to_user_id: 'ACC' }, 'ACC'),
    { chatType: 'single', peer: 'U1' },
  );
});

test('guessIlinkChat to_user_id 既非自己也非单聊时按群处理', () => {
  const result = guessIlinkChat({ from_user_id: 'U1', to_user_id: 'OTHER', msg_type: 1 }, 'ACC');
  assert.equal(result.chatType, 'group');
  assert.equal(result.peer, 'OTHER');
});

test('normalizeIlinkMessage 过滤自己发的消息', () => {
  assert.equal(normalizeIlinkMessage({
    from_user_id: 'ACC1', message_id: 'M', item_list: [{ type: 1, text_item: { text: 'x' } }],
  }, 'ACC1'), null);
});

test('normalizeIlinkMessage 归一化文本消息', () => {
  const event = normalizeIlinkMessage({
    from_user_id: 'U1',
    message_id: 'M1',
    item_list: [{ type: 1, text_item: { text: '你好' } }],
  }, 'ACC1');
  assert.equal(event.channel, 'ilink');
  assert.equal(event.peer, 'U1');
  assert.equal(event.chatType, 'single');
  assert.equal(event.text, '你好');
  assert.equal(event.messageId, 'M1');
  assert.equal(event.replyToken, undefined);
});

// ---------------------------------------------------------------------------
// 发送
// ---------------------------------------------------------------------------

test('发送会带 context_token', async () => {
  const fetchImpl = makeFetch({ [EP.sendMessage]: { ret: 0, errcode: 0 } });
  const channel = onlineChannel({ fetchImpl });
  channel.contextTokens.set('U1', 'CT1');
  const receipt = await channel.sendText('U1', '你好');
  assert.equal(receipt.ok, true);

  const call = fetchImpl.calls.find((entry) => entry.url.includes(EP.sendMessage));
  const body = JSON.parse(call.init.body);
  assert.equal(body.msg.context_token, 'CT1');
  assert.equal(body.msg.to_user_id, 'U1');
  assert.equal(body.msg.item_list[0].text_item.text, '你好');
  assert.equal(body.msg.message_type, 2);
  assert.equal(body.msg.message_state, 2);
  assert.equal(body.base_info.channel_version, '2.2.0');
});

test('没有 context_token 时不带该字段', async () => {
  const fetchImpl = makeFetch({ [EP.sendMessage]: { ret: 0, errcode: 0 } });
  const channel = onlineChannel({ fetchImpl });
  await channel.sendText('U1', 'hi');
  const body = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(body.msg.context_token, undefined);
});

test('会话过期时去掉 context_token 重试一次', async () => {
  let attempt = 0;
  const fetchImpl = makeFetch({
    [EP.sendMessage]: () => {
      attempt += 1;
      return attempt === 1 ? { ret: ERRCODE_SESSION_EXPIRED, errmsg: 'session expired' } : { ret: 0, errcode: 0 };
    },
  });
  const channel = onlineChannel({ fetchImpl });
  channel.contextTokens.set('U1', 'CT-OLD');

  const receipt = await channel.sendText('U1', '通知');
  assert.equal(receipt.ok, true, '降级重试后应成功');
  assert.equal(attempt, 2);
  assert.equal(channel.contextTokens.has('U1'), false, '过期 token 应被丢弃');
  const second = JSON.parse(fetchImpl.calls[1].init.body);
  assert.equal(second.msg.context_token, undefined);
});

test('发送被拒绝时返回失败并带原因', async () => {
  const fetchImpl = makeFetch({ [EP.sendMessage]: { ret: -1, errmsg: 'invalid content' } });
  const channel = onlineChannel({ fetchImpl });
  const receipt = await channel.sendText('U1', 'hi');
  assert.equal(receipt.ok, false);
  assert.match(receipt.error, /invalid content/);
});

test('HTTP 非 2xx 视为发送失败', async () => {
  const fetchImpl = async () => new Response('boom', { status: 500 });
  const channel = onlineChannel({ fetchImpl });
  const receipt = await channel.sendText('U1', 'hi');
  assert.equal(receipt.ok, false);
  assert.match(receipt.error, /HTTP 500/);
});

test('markdown 自动降级为纯文本', async () => {
  const fetchImpl = makeFetch({ [EP.sendMessage]: { ret: 0, errcode: 0 } });
  const channel = onlineChannel({ fetchImpl });
  await channel.sendMarkdown('U1', '## 标题\n- 项');
  const body = JSON.parse(fetchImpl.calls[0].init.body);
  const sent = body.msg.item_list[0].text_item.text;
  assert.ok(!sent.includes('#'), sent);
  assert.ok(sent.includes('标题'));
});

test('iLink 声明不支持 markdown 与卡片', () => {
  const channel = onlineChannel({});
  assert.equal(channel.capabilities.markdown, false);
  assert.equal(channel.capabilities.templateCard, false);
  assert.equal(channel.capabilities.proactivePush, true);
});

// ---------------------------------------------------------------------------
// 入站与游标
// ---------------------------------------------------------------------------

test('轮询推进游标并持久化，且派发消息', async () => {
  const bus = new EventEmitter();
  const events = [];
  bus.on('inbound', (event) => events.push(event));

  const saved = [];
  let round = 0;
  const fetchImpl = makeFetch({
    [EP.getUpdates]: () => {
      round += 1;
      if (round === 1) {
        return {
          ret: 0,
          get_updates_buf: 'BUF-1',
          msgs: [{
            from_user_id: 'U1', message_id: 'M1', context_token: 'CT1',
            item_list: [{ type: 1, text_item: { text: '你好' } }],
          }],
        };
      }
      // 第二轮起挂住，模拟长轮询无消息。
      return new Promise(() => {});
    },
    [EP.getConfig]: { typing_ticket: 'TICKET1' },
  });

  const channel = new IlinkChannel({
    accountId: 'ACC1',
    token: 'TK',
    fetch: fetchImpl,
    bus,
    loadState: async () => null,
    saveState: async (key, value) => { saved.push({ key, value }); },
    typing: false,
  });
  channel._status = STATUS.online;
  const controller = new AbortController();
  void channel._pollLoop(controller.signal);

  await new Promise((resolve) => setTimeout(resolve, 60));
  controller.abort();

  assert.equal(events.length, 1);
  assert.equal(events[0].text, '你好');
  assert.equal(channel.syncBuf, 'BUF-1');
  const syncSave = saved.find((entry) => entry.key === 'sync');
  assert.ok(syncSave !== undefined, '游标必须落盘');
  assert.equal(syncSave.value.get_updates_buf, 'BUF-1');
  assert.equal(channel.contextTokens.get('U1'), 'CT1');
});

test('启动时恢复游标与 context_token', async () => {
  const fetchImpl = makeFetch({
    [EP.getUpdates]: { ret: 0, msgs: [] },
  });
  const channel = new IlinkChannel({
    accountId: 'ACC1',
    token: 'TK',
    fetch: fetchImpl,
    loadState: async (key) => (key === 'sync' ? { get_updates_buf: 'SAVED' } : { U1: 'CT-SAVED' }),
    saveState: async () => {},
  });
  await channel._restoreState();
  assert.equal(channel.syncBuf, 'SAVED');
  assert.equal(channel.contextTokens.get('U1'), 'CT-SAVED');
});

test('恢复状态失败时降级为空而不是抛错', async () => {
  const channel = new IlinkChannel({
    accountId: 'ACC1',
    token: 'TK',
    loadState: async () => { throw new Error('disk broken'); },
    saveState: async () => {},
  });
  await channel._restoreState();
  assert.equal(channel.syncBuf, '');
  assert.equal(channel.contextTokens.size, 0);
});

test('会话过期时状态标为 error 并暂停', async () => {
  const fetchImpl = makeFetch({ [EP.getUpdates]: { ret: ERRCODE_SESSION_EXPIRED } });
  const channel = new IlinkChannel({
    accountId: 'ACC1',
    token: 'TK',
    fetch: fetchImpl,
    loadState: async () => null,
    saveState: async () => {},
    sessionExpiredPauseMs: 50,
  });
  channel._status = STATUS.online;
  const controller = new AbortController();
  void channel._pollLoop(controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(channel.status, STATUS.error);
  assert.match(channel.lastError, /过期/);
  controller.abort();
});

// ---------------------------------------------------------------------------
// 连接生命周期
// ---------------------------------------------------------------------------

test('缺少凭据时 start 明确报错', async () => {
  const noAccount = new IlinkChannel({ accountId: '', token: 'TK' });
  await assert.rejects(noAccount.start(), /缺少 accountId/);
  const noToken = new IlinkChannel({ accountId: 'A', token: '' });
  await assert.rejects(noToken.start(), /缺少 token/);
});

test('_probe 在凭据失效时让 start 失败', async () => {
  const fetchImpl = makeFetch({ [EP.getUpdates]: { ret: ERRCODE_SESSION_EXPIRED } });
  const channel = new IlinkChannel({
    accountId: 'ACC1',
    token: 'TK',
    fetch: fetchImpl,
    loadState: async () => null,
    saveState: async () => {},
  });
  await assert.rejects(channel.start(), /会话已过期/);
  assert.equal(channel.status, STATUS.error);
});

test('sendTyping 在未启用时直接返回', async () => {
  const fetchImpl = makeFetch({});
  const channel = onlineChannel({ fetchImpl });
  channel.typingEnabled = false;
  await channel.sendTyping('U1', 1);
  assert.equal(fetchImpl.calls.length, 0);
});

test('sendTyping 复用未过期的 ticket', async () => {
  const fetchImpl = makeFetch({
    [EP.getConfig]: { typing_ticket: 'TICKET1' },
    [EP.sendTyping]: { ret: 0 },
  });
  const channel = onlineChannel({ fetchImpl });
  await channel.sendTyping('U1', 1);
  await channel.sendTyping('U1', 2);
  const configCalls = fetchImpl.calls.filter((call) => call.url.includes(EP.getConfig));
  assert.equal(configCalls.length, 1, '第二个 ticket 应复用缓存');
  const typingCalls = fetchImpl.calls.filter((call) => call.url.includes(EP.sendTyping));
  assert.equal(typingCalls.length, 2);
  assert.equal(JSON.parse(typingCalls[0].init.body).typing_ticket, 'TICKET1');
});

test('stop 取消轮询与在途请求', async () => {
  const fetchImpl = makeFetch({ [EP.getUpdates]: () => new Promise(() => {}) });
  const channel = new IlinkChannel({
    accountId: 'ACC1',
    token: 'TK',
    fetch: fetchImpl,
    loadState: async () => null,
    saveState: async () => {},
  });
  channel._status = STATUS.online;
  channel._started = true;
  const controller = new AbortController();
  channel._pollAbort = controller;
  void channel._pollLoop(controller.signal);
  await channel.stop();
  assert.equal(controller.signal.aborted, true);
  assert.equal(channel.status, STATUS.idle);
});

// ---------------------------------------------------------------------------
// 扫码登录
// ---------------------------------------------------------------------------

test('扫码登录状态机：wait → scaned → confirmed', async () => {
  let step = 0;
  const fetchImpl = makeFetch({
    [EP.getBotQr]: { qrcode: 'QR1', qrcode_img_content: 'https://example.com/qr' },
    [EP.getQrStatus]: () => {
      step += 1;
      if (step === 1) return { status: 'wait' };
      if (step === 2) return { status: 'scaned' };
      return {
        status: 'confirmed',
        ilink_bot_id: 'ACC-NEW',
        bot_token: 'TOKEN-NEW',
        baseurl: 'https://ilink.example',
        ilink_user_id: 'USER1',
      };
    },
  });
  const session = new IlinkLoginSession({ fetch: fetchImpl, baseUrl: 'https://ilinkai.weixin.qq.com' });

  const started = await session.start();
  assert.equal(started.status, 'wait');
  assert.equal(started.qrcode, 'QR1');
  assert.equal(started.qrcodeUrl, 'https://example.com/qr');

  assert.equal((await session.poll()).status, 'wait');
  assert.equal((await session.poll()).status, 'scaned');
  const confirmed = await session.poll();
  assert.equal(confirmed.status, 'confirmed');
  assert.deepEqual(confirmed.credentials, {
    accountId: 'ACC-NEW',
    token: 'TOKEN-NEW',
    baseUrl: 'https://ilink.example',
    userId: 'USER1',
  });
});

test('扫码确认后凭据不完整时报错', async () => {
  const fetchImpl = makeFetch({
    [EP.getBotQr]: { qrcode: 'QR1' },
    [EP.getQrStatus]: { status: 'confirmed', ilink_bot_id: 'ACC' },
  });
  const session = new IlinkLoginSession({ fetch: fetchImpl });
  await session.start();
  const result = await session.poll();
  assert.equal(result.status, 'error');
  assert.match(result.message, /凭据不完整/);
});

test('二维码过期会刷新，超过 3 次报错', async () => {
  const fetchImpl = makeFetch({
    [EP.getBotQr]: { qrcode: 'QR2' },
    [EP.getQrStatus]: { status: 'expired' },
  });
  const session = new IlinkLoginSession({ fetch: fetchImpl });
  await session.start();
  for (let index = 0; index < 3; index += 1) {
    const result = await session.poll();
    assert.equal(result.status, 'wait', `第 ${index + 1} 次过期应刷新而不是失败`);
  }
  const final = await session.poll();
  assert.equal(final.status, 'error');
  assert.match(final.message, /多次过期/);
});

test('scaned_but_redirect 切换接入点', async () => {
  const fetchImpl = makeFetch({
    [EP.getBotQr]: { qrcode: 'QR1' },
    [EP.getQrStatus]: { status: 'scaned_but_redirect', redirect_host: 'other.example.com' },
  });
  const session = new IlinkLoginSession({ fetch: fetchImpl });
  await session.start();
  const result = await session.poll();
  assert.equal(result.status, 'scaned_but_redirect');
  assert.equal(session.baseUrlForPoll, 'https://other.example.com');
});

test('未开始就 poll 返回错误', async () => {
  const session = new IlinkLoginSession({ fetch: makeFetch({}) });
  const result = await session.poll();
  assert.equal(result.status, 'error');
  assert.match(result.message, /尚未开始/);
});

test('登录取不到二维码时报错', async () => {
  const session = new IlinkLoginSession({ fetch: makeFetch({ [EP.getBotQr]: {} }) });
  const result = await session.start();
  assert.equal(result.status, 'error');
  assert.match(result.message, /二维码/);
});
