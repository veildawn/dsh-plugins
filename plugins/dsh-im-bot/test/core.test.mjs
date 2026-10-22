/**
 * core.js 单测：命令解析、白名单、绑定表、通知文案、分片与限流。
 *
 * 零依赖、零网络、零宿主：core 层刻意不碰 ctx 与 IO，所以这里直接打函数。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BindingTable,
  COMMAND_CATALOG,
  COMMANDS,
  renderAgents,
  renderHelp,
  renderModels,
  renderSkills,
  Deduplicator,
  KeyedSerialLock,
  RateLimiter,
  checkAccess,
  classifyTurnEnd,
  clampNoticeChars,
  formatDuration,
  markdownToPlainText,
  matchSessionPrefix,
  normalizeAllowList,
  normalizeBinding,
  normalizeConfig,
  normalizeInbound,
  normalizeSendRequest,
  parseCommand,
  parseModelArgument,
  resolveModelChoice,
  shortSessionId,
  parsePeerKey,
  peerKey,
  renderCompletionNotice,
  renderFailureNotice,
  sessionLabel,
  splitText,
  splitTextByBytes,
  truncate,
} from '../lib/core.js';

// ---------------------------------------------------------------------------
// 分片
// ---------------------------------------------------------------------------

test('splitText 短文本原样返回单片', () => {
  assert.deepEqual(splitText('你好', 100), ['你好']);
});

test('splitText 空输入返回空数组', () => {
  assert.deepEqual(splitText('', 100), []);
  assert.deepEqual(splitText(null, 100), []);
});

test('splitText 按上限切分且不丢内容', () => {
  const text = 'a'.repeat(25);
  const chunks = splitText(text, 10);
  assert.equal(chunks.join(''), text);
  for (const chunk of chunks) assert.ok(chunk.length <= 10);
});

test('splitText 优先在换行处断开', () => {
  const text = '第一行内容\n第二行内容';
  const chunks = splitText(text, 8);
  assert.deepEqual(chunks, ['第一行内容', '第二行内容']);
});

test('splitText 不切断 emoji 代理对', () => {
  // '😀' 占两个 UTF-16 码元；在奇偶边界上必须整体挪到下一片。
  const text = 'a😀b😀c';
  const chunks = splitText(text, 2);
  assert.equal(chunks.join(''), text);
  for (const chunk of chunks) {
    assert.ok(!/[\uD800-\uDBFF]$/.test(chunk), `片尾不能是孤立高位代理：${chunk}`);
  }
});

test('splitTextByBytes 按 UTF-8 字节切分', () => {
  // 中文每字 3 字节；上限 12 字节 → 每片最多 4 字。
  const text = '一二三四五六七八';
  const chunks = splitTextByBytes(text, 12);
  assert.equal(chunks.join(''), text);
  for (const chunk of chunks) assert.ok(Buffer.byteLength(chunk, 'utf8') <= 12);
});

test('truncate 补省略号且不切代理对', () => {
  assert.equal(truncate('abcdef', 3), 'abc…');
  assert.equal(truncate('ab', 10), 'ab');
  const emoji = 'a😀';
  assert.ok(!truncate(emoji, 2).includes('\uD83D…'));
});

// ---------------------------------------------------------------------------
// markdown 降级
// ---------------------------------------------------------------------------

test('markdownToPlainText 去掉标题井号与列表符号', () => {
  const output = markdownToPlainText('## 标题\n- 项目一\n- 项目二');
  assert.ok(!output.includes('#'));
  assert.ok(output.includes('标题'));
  assert.ok(output.includes('· 项目一'));
});

test('markdownToPlainText 把表格折成缩进行', () => {
  const output = markdownToPlainText('| 姓名 | 尺寸 |\n| --- | --- |\n| 张三 | S |');
  // 表格折成「· 单元格 | 单元格」的缩进行，分隔线行被丢弃。
  assert.ok(!output.includes('---'), output);
  assert.ok(output.includes('· 姓名 | 尺寸'), output);
  assert.ok(output.includes('· 张三 | S'), output);
});

test('markdownToPlainText 去掉行内代码反引号', () => {
  assert.equal(markdownToPlainText('运行 `npm test` 即可'), '运行 npm test 即可');
});

test('markdownToPlainText 保留普通文本不变', () => {
  assert.equal(markdownToPlainText('就是一句话'), '就是一句话');
});

// ---------------------------------------------------------------------------
// 命令解析
// ---------------------------------------------------------------------------

test('parseCommand 识别已注册命令与参数', () => {
  assert.deepEqual(parseCommand('/new 我的会话'), { isCommand: true, name: 'new', argument: '我的会话' });
  assert.deepEqual(parseCommand('/help'), { isCommand: true, name: 'help', argument: '' });
  assert.deepEqual(parseCommand('  /STATUS  '), { isCommand: true, name: 'status', argument: '' });
});

test('parseCommand 不把路径当命令', () => {
  assert.deepEqual(parseCommand('/usr/local/bin'), { isCommand: false });
  assert.deepEqual(parseCommand('/unknown-cmd'), { isCommand: false });
  assert.deepEqual(parseCommand('普通文本'), { isCommand: false });
  assert.deepEqual(parseCommand(''), { isCommand: false });
});

test('parseCommand 保留多行参数', () => {
  const parsed = parseCommand('/new 第一行\n第二行');
  assert.equal(parsed.isCommand, true);
  assert.equal(parsed.argument, '第一行\n第二行');
});

// ---------------------------------------------------------------------------
// 白名单
// ---------------------------------------------------------------------------

test('normalizeAllowList 去空、去重、trim', () => {
  assert.deepEqual(normalizeAllowList([' a ', '', 'a', 'b', null]), ['a', 'b']);
  assert.deepEqual(normalizeAllowList('not-array'), []);
});

test('checkAccess 白名单为空时拒绝（安全默认）', () => {
  const result = checkAccess({ allowFrom: [] }, {
    channel: 'ilink', peer: 'U1', chatType: 'single', text: 'hi', messageId: 'm',
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'no-allowlist');
});

test('checkAccess 单聊按发送者匹配', () => {
  const access = { allowFrom: ['U1'] };
  assert.equal(checkAccess(access, { chatType: 'single', peer: 'U1', from: 'U1' }).allowed, true);
  assert.equal(checkAccess(access, { chatType: 'single', peer: 'U2', from: 'U2' }).allowed, false);
});

test('checkAccess 群聊需要显式开启且按群 id 匹配', () => {
  const event = { chatType: 'group', peer: 'CHAT1', from: 'U1' };
  assert.equal(checkAccess({ allowFrom: ['U1'], groupsEnabled: false }, event).reason, 'groups-disabled');
  assert.equal(
    checkAccess({ allowFrom: ['U1'], groupsEnabled: true, groupAllowFrom: [] }, event).reason,
    'no-group-allowlist',
  );
  assert.equal(
    checkAccess({ allowFrom: ['U1'], groupsEnabled: true, groupAllowFrom: ['CHAT1'] }, event).allowed,
    true,
  );
  assert.equal(
    checkAccess({ allowFrom: ['U1'], groupsEnabled: true, groupAllowFrom: ['CHAT2'] }, event).reason,
    'group-not-allowed',
  );
});

// ---------------------------------------------------------------------------
// peerKey
// ---------------------------------------------------------------------------

test('peerKey 与 parsePeerKey 互逆', () => {
  assert.equal(peerKey('wecom', 'CHAT'), 'wecom:CHAT');
  assert.deepEqual(parsePeerKey('wecom:CHAT'), { channel: 'wecom', peer: 'CHAT' });
  assert.equal(parsePeerKey('unknown:x'), null);
  assert.equal(parsePeerKey('wecom:'), null);
  assert.equal(parsePeerKey('nocolon'), null);
});

test('peerKey 允许 peer 内含冒号', () => {
  assert.deepEqual(parsePeerKey(peerKey('ilink', 'a:b:c')), { channel: 'ilink', peer: 'a:b:c' });
});

// ---------------------------------------------------------------------------
// 绑定表
// ---------------------------------------------------------------------------

test('BindingTable 写入、读取、按会话反查', () => {
  const table = new BindingTable();
  table.set({ channel: 'wecom', peer: 'CHAT1', sessionId: 'S1' });
  const found = table.get('wecom', 'CHAT1');
  assert.equal(found?.sessionId, 'S1');
  assert.equal(found?.notify, true);
  assert.equal(table.bySession('S1').length, 1);
  assert.equal(table.size, 1);
});

test('BindingTable 拒绝非法绑定', () => {
  const table = new BindingTable();
  assert.equal(table.set({ channel: 'unknown', peer: 'P', sessionId: 'S' }), null);
  assert.equal(table.set({ channel: 'wecom', peer: '', sessionId: 'S' }), null);
  assert.equal(table.set({ channel: 'wecom', peer: 'P', sessionId: '' }), null);
  assert.equal(table.size, 0);
});

test('BindingTable 序列化后能原样载回', () => {
  const table = new BindingTable();
  table.set({ channel: 'wecom', peer: 'C1', sessionId: 'S1', chatType: 'group' });
  table.set({ channel: 'ilink', peer: 'U1', sessionId: 'S2', notify: false });
  const restored = new BindingTable();
  const loaded = restored.load(table.toJSON());
  assert.equal(loaded, 2);
  assert.equal(restored.get('wecom', 'C1')?.chatType, 'group');
  assert.equal(restored.get('ilink', 'U1')?.notify, false);
});

test('BindingTable 载入时跳过损坏条目而不是整体失败', () => {
  const table = new BindingTable();
  const loaded = table.load([{ channel: 'wecom' }, null, 'junk', { channel: 'ilink', peer: 'U1', sessionId: 'S1' }]);
  assert.equal(loaded, 1);
});

test('BindingTable setNotify 与 removeBySession', () => {
  const table = new BindingTable();
  table.set({ channel: 'wecom', peer: 'C1', sessionId: 'S1' });
  assert.equal(table.setNotify('wecom', 'C1', false)?.notify, false);
  assert.equal(table.setNotify('wecom', 'nope', true), null);
  assert.equal(table.removeBySession('S1'), 1);
  assert.equal(table.size, 0);
});

test('normalizeBinding 补齐缺失字段', () => {
  const binding = normalizeBinding({ channel: 'wecom', peer: 'C1', sessionId: 'S1' }, { now: () => 42 });
  assert.equal(binding?.updatedAt, 42);
  assert.equal(binding?.chatType, 'single');
  assert.equal(binding?.notify, true);
  assert.equal(normalizeBinding(null), null);
});

// ---------------------------------------------------------------------------
// 会话前缀匹配
// ---------------------------------------------------------------------------

test('matchSessionPrefix 唯一命中返回完整 id', () => {
  assert.deepEqual(matchSessionPrefix(['abc123', 'abd999'], 'abc'), { sessionId: 'abc123' });
});

test('matchSessionPrefix 完整 id 直接命中', () => {
  assert.deepEqual(matchSessionPrefix(['abc123'], 'abc123'), { sessionId: 'abc123' });
});

test('matchSessionPrefix 有歧义时返回候选', () => {
  const result = matchSessionPrefix(['abc1', 'abc2'], 'abc');
  assert.equal(result.error, 'ambiguous');
  assert.equal(result.candidates.length, 2);
});

test('matchSessionPrefix 无命中', () => {
  assert.equal(matchSessionPrefix(['abc1'], 'zzz').error, 'not-found');
  assert.equal(matchSessionPrefix(['abc1'], '').error, 'not-found');
});

test('sessionLabel 优先用标题，缺失时回退 id 前缀', () => {
  assert.equal(sessionLabel('修复登录问题', 'abc123456'), '修复登录问题');
  assert.equal(sessionLabel('', 'abc123456'), 'abc12345');
  assert.equal(sessionLabel(null, ''), '（未知会话）');
});

// ---------------------------------------------------------------------------
// 通知文案
// ---------------------------------------------------------------------------

test('renderCompletionNotice 含标题、摘要与用时', () => {
  const notice = renderCompletionNotice({
    label: '会话A', summary: '任务做完了', durationMs: 12345, maxChars: 800,
  });
  assert.ok(notice.includes('✅ 任务完成'));
  assert.ok(notice.includes('会话A'));
  assert.ok(notice.includes('任务做完了'));
  assert.ok(notice.includes('12s'));
});

test('renderCompletionNotice 摘要按上限截断', () => {
  const notice = renderCompletionNotice({ label: 'A', summary: 'x'.repeat(500), maxChars: 100 });
  assert.ok(notice.length < 300);
  assert.ok(notice.includes('…'));
});

test('renderCompletionNotice 无摘要时不产生空行堆积', () => {
  const notice = renderCompletionNotice({ label: 'A', summary: '', maxChars: 800 });
  assert.ok(!notice.includes('\n\n\n'));
});

test('renderFailureNotice 带原因类型与详情', () => {
  const notice = renderFailureNotice({ label: 'A', kind: 'error', reason: '连接超时', maxChars: 300 });
  assert.ok(notice.includes('⚠️'));
  assert.ok(notice.includes('error'));
  assert.ok(notice.includes('连接超时'));
});

test('clampNoticeChars 收敛到合法区间', () => {
  assert.equal(clampNoticeChars(10), 100);
  assert.equal(clampNoticeChars(999999), 4000);
  assert.equal(clampNoticeChars(500), 500);
  assert.equal(clampNoticeChars('abc'), 800);
});

test('formatDuration 分档展示', () => {
  assert.equal(formatDuration(500), '500ms');
  assert.equal(formatDuration(5000), '5s');
  assert.equal(formatDuration(90000), '1m30s');
  assert.equal(formatDuration(3600000), '1h0m');
});

// ---------------------------------------------------------------------------
// turn/end 分类
// ---------------------------------------------------------------------------

test('classifyTurnEnd completed 不算失败', () => {
  assert.deepEqual(classifyTurnEnd({ kind: 'completed' }), { failure: false, kind: 'completed', detail: '' });
});

test('classifyTurnEnd error 带出错误信息', () => {
  const verdict = classifyTurnEnd({ kind: 'error', error: { message: 'boom', code: 'X' } });
  assert.equal(verdict.failure, true);
  assert.equal(verdict.detail, 'boom');
});

test('classifyTurnEnd aborted 带出取消原因', () => {
  const verdict = classifyTurnEnd({ kind: 'aborted', reason: { kind: 'user' } });
  assert.equal(verdict.failure, true);
  assert.equal(verdict.detail, 'user');
});

test('classifyTurnEnd max-tokens 视为失败告警', () => {
  assert.equal(classifyTurnEnd({ kind: 'max-tokens' }).failure, true);
});

test('classifyTurnEnd blocked/interrupted/forked 不发通知', () => {
  for (const kind of ['blocked', 'interrupted', 'forked']) {
    assert.equal(classifyTurnEnd({ kind }).failure, false);
  }
  assert.equal(classifyTurnEnd(null).failure, false);
});

// ---------------------------------------------------------------------------
// 去重 / 限流 / 串行锁
// ---------------------------------------------------------------------------

test('Deduplicator 同键第二次返回重复', () => {
  let now = 0;
  const dedup = new Deduplicator({ ttlMs: 100, now: () => now });
  assert.equal(dedup.check('a'), false);
  assert.equal(dedup.check('a'), true);
  now = 200;
  assert.equal(dedup.check('a'), false, 'TTL 过期后应视为新消息');
});

test('Deduplicator 空键不参与去重', () => {
  const dedup = new Deduplicator();
  assert.equal(dedup.check(''), false);
  assert.equal(dedup.check(''), false);
});

test('Deduplicator 不会无界增长', () => {
  const dedup = new Deduplicator({ maxEntries: 10, ttlMs: 1000000, now: () => 0 });
  for (let index = 0; index < 100; index += 1) dedup.check(`k${index}`);
  assert.ok(dedup.seen.size <= 10, `实际 ${dedup.seen.size}`);
});

test('RateLimiter 窗口内超限后拒绝', () => {
  let now = 0;
  const limiter = new RateLimiter({ windowMs: 1000, maxPerWindow: 2, now: () => now });
  assert.equal(limiter.take('k'), true);
  assert.equal(limiter.take('k'), true);
  assert.equal(limiter.take('k'), false);
  now = 1500;
  assert.equal(limiter.take('k'), true, '窗口滑过后应恢复');
});

test('RateLimiter 不同 key 互不影响', () => {
  const limiter = new RateLimiter({ windowMs: 1000, maxPerWindow: 1, now: () => 0 });
  assert.equal(limiter.take('a'), true);
  assert.equal(limiter.take('b'), true);
});

test('RateLimiter retryAfterMs 给出等待时长', () => {
  let now = 0;
  const limiter = new RateLimiter({ windowMs: 1000, maxPerWindow: 1, now: () => now });
  limiter.take('k');
  assert.equal(limiter.retryAfterMs('k'), 1000);
  now = 400;
  assert.equal(limiter.retryAfterMs('k'), 600);
});

test('KeyedSerialLock 同键任务串行执行', async () => {
  const lock = new KeyedSerialLock();
  const order = [];
  const task = (name, delay) => async () => {
    order.push(`${name}:start`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    order.push(`${name}:end`);
  };
  await Promise.all([lock.run('k', task('a', 20)), lock.run('k', task('b', 1))]);
  assert.deepEqual(order, ['a:start', 'a:end', 'b:start', 'b:end']);
});

test('KeyedSerialLock 前序失败不阻断后续', async () => {
  const lock = new KeyedSerialLock();
  await assert.rejects(lock.run('k', async () => { throw new Error('boom'); }));
  assert.equal(await lock.run('k', async () => 'ok'), 'ok');
});

// ---------------------------------------------------------------------------
// 归一化
// ---------------------------------------------------------------------------

test('normalizeInbound 补齐默认值', () => {
  const event = normalizeInbound({ channel: 'wecom', peer: 'P1', text: 'hi' });
  assert.equal(event.chatType, 'single');
  assert.equal(event.messageId, '');
  assert.equal(event.replyToken, undefined);
});

test('normalizeInbound 未知通道回退到 wecom', () => {
  assert.equal(normalizeInbound({ channel: 'nope', peer: 'P' }).channel, 'wecom');
});

test('normalizeConfig 补齐全部默认值且默认关闭', () => {
  const config = normalizeConfig(undefined);
  assert.equal(config.enabled, false);
  assert.equal(config.wecom.enabled, false);
  assert.equal(config.ilink.enabled, false);
  assert.equal(config.notify.onTurnComplete, true);
  assert.equal(config.notify.onTurnFailure, true);
  assert.deepEqual(config.access.allowFrom, []);
  assert.equal(config.wecom.baseUrl, 'wss://openws.work.weixin.qq.com');
  assert.equal(config.ilink.baseUrl, 'https://ilinkai.weixin.qq.com');
});

test('normalizeConfig 去掉 baseUrl 尾部斜杠并收敛数值区间', () => {
  const config = normalizeConfig({
    ilink: { baseUrl: 'https://x.example///', longPollTimeoutMs: 1 },
    wecom: { heartbeatSeconds: 100000 },
    notify: { maxNoticeChars: 999999 },
  });
  assert.equal(config.ilink.baseUrl, 'https://x.example');
  assert.equal(config.ilink.longPollTimeoutMs, 5000);
  assert.equal(config.wecom.heartbeatSeconds, 300);
  assert.equal(config.notify.maxNoticeChars, 4000);
});

test('normalizeConfig 只认显式 true，避免字符串误开', () => {
  assert.equal(normalizeConfig({ enabled: 'true' }).enabled, false);
  assert.equal(normalizeConfig({ enabled: true }).enabled, true);
});

test('normalizeSendRequest 校验正文与通道', () => {
  assert.equal(normalizeSendRequest({ text: '  ' }).ok, false);
  assert.equal(normalizeSendRequest({ text: 'hi', channel: 'nope' }).ok, false);
  const parsed = normalizeSendRequest({ text: 'hi', format: 'markdown', channel: 'wecom', peer: 'C1' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.format, 'markdown');
  assert.equal(parsed.value.channel, 'wecom');
});

// ---------------------------------------------------------------------------
// 命令目录（设置面板与 /help 的唯一事实来源）
// ---------------------------------------------------------------------------

test('COMMAND_CATALOG 与 COMMANDS 完全一致（顺序也一致）', () => {
  assert.deepEqual(
    COMMANDS,
    COMMAND_CATALOG.map((item) => item.name),
    'COMMANDS 必须由目录派生，不能各写一份',
  );
});

test('命令目录每项都有 usage 与一句话说明', () => {
  assert.ok(COMMAND_CATALOG.length >= 7, '至少包含 7 个命令');
  for (const item of COMMAND_CATALOG) {
    assert.ok(item.name.length > 0, 'name 不能为空');
    assert.ok(item.usage.startsWith(`/${item.name}`), `usage 必须以 /${item.name} 开头：${item.usage}`);
    assert.ok(item.summary.length > 0, `${item.name} 缺少说明`);
    // 说明要短，面板里一行放得下
    assert.ok(item.summary.length <= 30, `${item.name} 的说明太长（${item.summary.length} 字）`);
  }
});

test('命令目录覆盖解析器认识的全部命令', () => {
  for (const name of COMMANDS) {
    const parsed = parseCommand(`/${name}`);
    assert.equal(parsed.isCommand, true, `目录里的 ${name} 必须能被解析器识别`);
  }
});

test('/help 文案由目录生成，包含所有命令且对齐', () => {
  const help = renderHelp();
  for (const item of COMMAND_CATALOG) {
    assert.ok(help.includes(item.usage), `/help 缺少 ${item.usage}`);
    assert.ok(help.includes(item.summary), `/help 缺少 ${item.name} 的说明`);
  }
  // 所有 usage 行的起始列必须一致（按最长 usage 对齐）
  const usageLines = help.split('\n').filter((line) => line.startsWith('/'));
  const columns = new Set(usageLines.map((line) => {
    const item = COMMAND_CATALOG.find((c) => line.startsWith(c.usage));
    return item === undefined ? -1 : line.indexOf(item.summary);
  }));
  assert.equal(columns.size, 1, `说明列未对齐：${[...columns].join(',')}`);
});

// ---------------------------------------------------------------------------
// /agents /skills /models 的渲染
// ---------------------------------------------------------------------------

test('renderAgents 标出默认预设与激活失败', () => {
  const text = renderAgents([
    { id: 'standard', name: '标准' },
    { id: 'standard-zh', name: '中文标准', broken: '缺少服务 foo' },
  ], 'standard-zh');

  assert.ok(text.includes('🤖 Agent 预设'));
  assert.ok(text.includes('标准（standard）'), '应显示名称与 id');
  assert.ok(text.includes('▶'), '默认预设应有标记');
  // 默认是 standard-zh，标记应在它那一行
  const defaultLine = text.split('\n').find((l) => l.includes('standard-zh'));
  assert.ok(defaultLine.startsWith('▶'), `默认行应带 ▶：${defaultLine}`);
  assert.ok(text.includes('⚠️'), '激活失败必须显式标出');
});

test('renderAgents 空列表有明确提示', () => {
  assert.match(renderAgents([]), /没有可用的 agent 预设/);
  assert.match(renderAgents(null), /没有可用的/);
});

test('renderSkills 显示名称、说明与仅手动标记', () => {
  const text = renderSkills([
    { name: 'brandkit', description: '品牌视觉生成', modelInvocable: true },
    { name: 'manual-only', description: '仅人工触发', modelInvocable: false },
  ]);
  assert.ok(text.includes('🧩 可用技能'));
  assert.ok(text.includes('/brandkit'));
  assert.ok(text.includes('品牌视觉生成'));
  assert.ok(text.includes('[仅手动]'), 'modelInvocable=false 要标出来');
});

test('renderSkills 空列表有明确提示', () => {
  assert.match(renderSkills([]), /没有可用技能/);
});

test('renderModels 按提供商分组并显示默认模型', () => {
  const text = renderModels({
    default: { provider: 'ai-proxy', model: 'gemini-3.8-flash' },
    groups: [
      { id: 'ai-proxy', name: 'AI Proxy', models: [{ id: 'gemini-3.8-flash' }, { id: 'glm-5.3' }] },
      { id: 'other', models: [{ id: 'x' }] },
    ],
  });
  assert.ok(text.includes('🧠 可用模型'));
  assert.ok(text.includes('默认：ai-proxy / gemini-3.8-flash'));
  assert.ok(text.includes('AI Proxy（ai-proxy）：2 个'));
  assert.ok(text.includes('gemini-3.8-flash'));
  assert.ok(text.includes('glm-5.3'));
  assert.ok(text.includes('other：1 个'), '无 name 时用 id');
});

test('renderModels 超出上限时折叠并提示剩余数量', () => {
  const models = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}` }));
  const text = renderModels({ groups: [{ id: 'p', models }] }, 5);
  assert.ok(text.includes('m0'));
  assert.ok(text.includes('m4'));
  assert.ok(!text.includes('m5'), '超过上限的模型不应逐条列出');
  assert.ok(text.includes('还有 15 个'), '应提示剩余数量');
});

test('renderModels 显示加载失败的提供商', () => {
  const text = renderModels({
    groups: [{ id: 'ok', models: [{ id: 'a' }] }],
    failures: [{ id: 'broken-provider', message: '凭据缺失' }],
  });
  assert.ok(text.includes('加载失败'));
  assert.ok(text.includes('broken-provider'));
  assert.ok(text.includes('凭据缺失'));
});

test('renderModels 空目录有明确提示', () => {
  assert.match(renderModels({}), /没有可用的模型/);
});

// ---------------------------------------------------------------------------
// 短 ID（`session-` 前缀占满 8 字符的坑）
// ---------------------------------------------------------------------------

test('shortSessionId 剥掉 session- 前缀后再取 8 位', () => {
  // 真实格式：session-<uuid>。直接 slice(0,8) 只会得到 "session-"。
  const id = 'session-bf17eeb8-d6fc-4d34-8e1e-c817358094c6';
  assert.equal(id.slice(0, 8), 'session-', '这正是旧实现的 bug');
  assert.equal(shortSessionId(id), 'bf17eeb8');
});

test('shortSessionId 对无前缀 id 退化为直接截取', () => {
  assert.equal(shortSessionId('abc123def456'), 'abc123de');
  assert.equal(shortSessionId(''), '');
  assert.equal(shortSessionId(null), '');
});

test('shortSessionId 对不同会话给出不同结果', () => {
  const a = shortSessionId('session-73630388-9e18-412b');
  const b = shortSessionId('session-bf17eeb8-d6fc-4d34');
  assert.notEqual(a, b, '不同会话的短 ID 必须可区分');
  assert.equal(a, '73630388');
  assert.equal(b, 'bf17eeb8');
});

test('sessionLabel 无标题时用短 ID，而不是 session-', () => {
  const label = sessionLabel('', 'session-73630388-9e18-412b');
  assert.equal(label, '73630388');
  assert.notEqual(label, 'session-');
});

// ---------------------------------------------------------------------------
// /model 参数解析
// ---------------------------------------------------------------------------

test('parseModelArgument 按第一个斜杠切分（模型 ID 可含斜杠）', () => {
  assert.deepEqual(
    parseModelArgument('ai-proxy/glm-5.3'),
    { ok: true, provider: 'ai-proxy', model: 'glm-5.3', reasoningEffort: '' },
  );
  // 模型 ID 自身带斜杠：provider 是第一个，其余整体归 model
  assert.deepEqual(
    parseModelArgument('deepseek/deepseek-flash'),
    { ok: true, provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: '' },
  );
});

test('parseModelArgument 允许只给模型 ID', () => {
  assert.deepEqual(
    parseModelArgument('glm-5.3'),
    { ok: true, provider: '', model: 'glm-5.3', reasoningEffort: '' },
  );
});

test('parseModelArgument 拒绝空参数与空模型', () => {
  assert.equal(parseModelArgument('').ok, false);
  assert.equal(parseModelArgument('ai-proxy/').ok, false);
});

test('resolveModelChoice 命中已知 provider+model', () => {
  const catalog = { groups: [{ id: 'ai-proxy', models: [{ id: 'glm-5.3' }] }] };
  assert.deepEqual(
    resolveModelChoice(catalog, { provider: 'ai-proxy', model: 'glm-5.3' }),
    { ok: true, provider: 'ai-proxy', model: 'glm-5.3' },
  );
});

test('resolveModelChoice 未知 provider 时列出可用项', () => {
  const catalog = { groups: [{ id: 'ai-proxy', models: [{ id: 'glm-5.3' }] }] };
  const result = resolveModelChoice(catalog, { provider: 'nope', model: 'x' });
  assert.equal(result.ok, false);
  assert.match(result.error, /ai-proxy/);
});

test('resolveModelChoice 未知模型时列出该提供商可用模型', () => {
  const catalog = { groups: [{ id: 'ai-proxy', models: [{ id: 'glm-5.3' }, { id: 'kimi-k3' }] }] };
  const result = resolveModelChoice(catalog, { provider: 'ai-proxy', model: 'nope' });
  assert.equal(result.ok, false);
  assert.match(result.error, /glm-5\.3/);
});

test('resolveModelChoice 只给模型 ID 时自动定位提供商', () => {
  const catalog = { groups: [{ id: 'ai-proxy', models: [{ id: 'glm-5.3' }] }] };
  assert.deepEqual(
    resolveModelChoice(catalog, { provider: '', model: 'glm-5.3' }),
    { ok: true, provider: 'ai-proxy', model: 'glm-5.3' },
  );
});

test('resolveModelChoice 模型存在于多个提供商时要求指明', () => {
  const catalog = {
    groups: [
      { id: 'a', models: [{ id: 'same' }] },
      { id: 'b', models: [{ id: 'same' }] },
    ],
  };
  const result = resolveModelChoice(catalog, { provider: '', model: 'same' });
  assert.equal(result.ok, false);
  assert.match(result.error, /多个提供商/);
});

test('/model 出现在命令目录里', () => {
  const item = COMMAND_CATALOG.find((c) => c.name === 'model');
  assert.ok(item !== undefined, '/model 必须登记在目录中');
  assert.ok(item.usage.startsWith('/model'));
});

test('parseModelArgument 支持可选的推理强度', () => {
  assert.deepEqual(
    parseModelArgument('ai-proxy/glm-5.3 high'),
    { ok: true, provider: 'ai-proxy', model: 'glm-5.3', reasoningEffort: 'high' },
  );
  // 模型 ID 含斜杠时仍能正确分离强度
  assert.deepEqual(
    parseModelArgument('deepseek/deepseek-flash max'),
    { ok: true, provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'max' },
  );
});

test('parseModelArgument 不把含斜杠的模型 ID 误判为推理强度', () => {
  // 只有「最后一段不含斜杠」才算强度，避免把 deepseek-flash 当成强度
  assert.deepEqual(
    parseModelArgument('deepseek/deepseek-flash'),
    { ok: true, provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: '' },
  );
});

test('session 配置含 reasoningEffort 且可留空', () => {
  const withEffort = normalizeConfig({ session: { provider: 'p', model: 'm', reasoningEffort: 'high' } });
  assert.equal(withEffort.session.reasoningEffort, 'high');

  const empty = normalizeConfig({});
  assert.equal(empty.session.reasoningEffort, '', '默认留空表示跟随模型默认');
});
