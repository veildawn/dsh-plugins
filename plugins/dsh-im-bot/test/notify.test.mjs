/**
 * 通知链路测试：验证 `session/event` 里的 `turn/end` 能正确触发回推。
 *
 * 这一套不加载 `lib/index.js`（它依赖宿主包），而是**把同一条判定链**用
 * `core.js` 的纯函数跑一遍，确保「哪种 turn 结束发什么通知、发给谁」的语义
 * 被固定住。真正的 `index.js` 接线由 `test/host.test.mjs` +
 * `scripts/harness-host-test.mjs` 覆盖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BindingTable,
  classifyTurnEnd,
  lastAssistantText,
  renderCompletionNotice,
  renderFailureNotice,
  sessionLabel,
  truncate,
} from '../lib/core.js';

/**
 * 模拟 index.js 里的通知决策：给定 turn/end 与绑定，返回该发什么。
 * @param {object} input
 * @returns {{ action: 'none'|'complete'|'failure', notice?: string, reason?: string }}
 */
function decideNotice({ reason, binding, bufferText, label, notify }) {
  const verdict = classifyTurnEnd(reason);

  // 没有绑定或用户关了通知 → 什么都不发。
  if (binding === undefined) return { action: 'none', reason: 'no-binding' };
  if (binding.notify !== true) return { action: 'none', reason: 'notify-off' };

  if (verdict.failure === true) {
    if (notify?.onTurnFailure !== true) return { action: 'none', reason: 'failure-disabled' };
    return {
      action: 'failure',
      notice: renderFailureNotice({
        label,
        kind: verdict.kind,
        reason: verdict.detail,
        maxChars: notify?.failureChars ?? 300,
      }),
    };
  }

  if (verdict.kind !== 'completed') return { action: 'none', reason: `silent-${verdict.kind}` };
  if (notify?.onTurnComplete !== true) return { action: 'none', reason: 'complete-disabled' };

  return {
    action: 'complete',
    notice: renderCompletionNotice({
      label,
      summary: bufferText,
      durationMs: 5000,
      maxChars: notify?.maxNoticeChars ?? 800,
    }),
  };
}

const binding = { notify: true };

test('completed 发完成通知并带摘要', () => {
  const result = decideNotice({
    reason: { kind: 'completed' },
    binding,
    bufferText: '已经把登录问题修好了，测试全绿。',
    label: '修复登录',
    notify: { onTurnComplete: true, onTurnFailure: true },
  });
  assert.equal(result.action, 'complete');
  assert.ok(result.notice.includes('✅'));
  assert.ok(result.notice.includes('修复登录'));
  assert.ok(result.notice.includes('登录问题修好了'));
});

test('error 发失败告警并带错误信息', () => {
  const result = decideNotice({
    reason: { kind: 'error', error: { message: '连接被拒绝' } },
    binding,
    bufferText: '',
    label: '部署',
    notify: { onTurnComplete: true, onTurnFailure: true },
  });
  assert.equal(result.action, 'failure');
  assert.ok(result.notice.includes('⚠️'));
  assert.ok(result.notice.includes('连接被拒绝'));
});

test('aborted 与 max-tokens 也算失败告警', () => {
  for (const reason of [{ kind: 'aborted', reason: { kind: 'user' } }, { kind: 'max-tokens' }]) {
    const result = decideNotice({
      reason, binding, bufferText: '', label: 'A', notify: { onTurnFailure: true },
    });
    assert.equal(result.action, 'failure', JSON.stringify(reason));
  }
});

test('blocked / interrupted / forked 静默（不发通知也不告警）', () => {
  for (const kind of ['blocked', 'interrupted', 'forked']) {
    const result = decideNotice({
      reason: { kind }, binding, bufferText: '', label: 'A',
      notify: { onTurnComplete: true, onTurnFailure: true },
    });
    assert.equal(result.action, 'none', kind);
    assert.match(result.reason, /silent/);
  }
});

test('没有绑定时什么都不发', () => {
  const result = decideNotice({
    reason: { kind: 'completed' }, binding: undefined, bufferText: 'x', label: 'A', notify: {},
  });
  assert.equal(result.action, 'none');
  assert.equal(result.reason, 'no-binding');
});

test('用户关掉通知后什么都不发', () => {
  const result = decideNotice({
    reason: { kind: 'completed' }, binding: { notify: false }, bufferText: 'x', label: 'A', notify: {},
  });
  assert.equal(result.action, 'none');
  assert.equal(result.reason, 'notify-off');
});

test('总开关关闭某类通知时对应分支静默', () => {
  const complete = decideNotice({
    reason: { kind: 'completed' }, binding, bufferText: 'x', label: 'A',
    notify: { onTurnComplete: false, onTurnFailure: true },
  });
  assert.equal(complete.action, 'none');
  assert.equal(complete.reason, 'complete-disabled');

  const failure = decideNotice({
    reason: { kind: 'error', error: { message: 'x' } }, binding, bufferText: '', label: 'A',
    notify: { onTurnComplete: true, onTurnFailure: false },
  });
  assert.equal(failure.action, 'none');
  assert.equal(failure.reason, 'failure-disabled');
});

test('通知摘要按配置上限截断', () => {
  const long = '细节'.repeat(1000);
  const result = decideNotice({
    reason: { kind: 'completed' }, binding, bufferText: long, label: 'A',
    notify: { onTurnComplete: true, maxNoticeChars: 120 },
  });
  assert.equal(result.action, 'complete');
  // 通知整体（含标题与用时行）应显著短于原文。
  assert.ok(result.notice.length < 400, `实际 ${result.notice.length}`);
  assert.ok(result.notice.includes('…'));
});

test('绑定表的 notify 标志决定是否推送', () => {
  const table = new BindingTable();
  table.set({ channel: 'wecom', peer: 'C1', sessionId: 'S1', notify: true });
  assert.equal(table.get('wecom', 'C1').notify, true);
  table.setNotify('wecom', 'C1', false);
  assert.equal(table.get('wecom', 'C1').notify, false);
});

test('lastAssistantText 取最后一条含文本的 assistant 消息', () => {
  const messages = [
    { content: [{ type: 'text', text: '第一轮' }] },
    { content: [{ type: 'reasoning', text: '思考' }] },
    { content: [{ type: 'text', text: '最后一轮' }, { type: 'tool-call' }] },
    { content: [{ type: 'reasoning', text: '只有思考' }] },
  ];
  assert.equal(lastAssistantText(messages), '最后一轮');
  assert.equal(lastAssistantText([]), '');
  assert.equal(lastAssistantText(null), '');
});

test('sessionLabel 在有标题时优先用标题', () => {
  assert.equal(sessionLabel('修复登录问题', 'abc12345'), '修复登录问题');
  assert.equal(sessionLabel('', 'abc12345'), 'abc12345');
});

test('truncate 保护代理对', () => {
  const text = '😀😀😀';
  const cut = truncate(text, 2);
  assert.ok(!/[\uD800-\uDBFF]…$/.test(cut), cut);
});

test('多目标路由：Web 端触发的长任务主动通知给该会话的所有绑定聊天', () => {
  const table = new BindingTable();
  table.set({ channel: 'wecom', peer: 'CHAT_W', sessionId: 'S1', notify: true });
  table.set({ channel: 'ilink', peer: 'USER_I', sessionId: 'S1', notify: true });
  table.set({ channel: 'wecom', peer: 'MUTED', sessionId: 'S1', notify: false });

  // 模拟 Web 端发起的回合：origin 为 undefined
  const origin = undefined;
  const sessionBindings = table.bySession('S1').filter((b) => b.notify === true);
  const targets = origin !== undefined
    ? [sessionBindings.find((b) => b.channel === origin.channel && b.peer === origin.peer) ?? origin]
    : sessionBindings;

  assert.equal(targets.length, 2);
  assert.ok(targets.some((t) => t.channel === 'wecom' && t.peer === 'CHAT_W'));
  assert.ok(targets.some((t) => t.channel === 'ilink' && t.peer === 'USER_I'));
  assert.ok(!targets.some((t) => t.peer === 'MUTED'));
});

test('单聊天发起的回合只回推给发起聊天的原 peer，不打扰其它绑定', () => {
  const table = new BindingTable();
  table.set({ channel: 'wecom', peer: 'CHAT_W', sessionId: 'S1', notify: true });
  table.set({ channel: 'ilink', peer: 'USER_I', sessionId: 'S1', notify: true });

  // 微信端发起的对话：origin 指向 CHAT_W
  const origin = { channel: 'wecom', peer: 'CHAT_W' };
  const sessionBindings = table.bySession('S1').filter((b) => b.notify === true);
  const targets = origin !== undefined
    ? [sessionBindings.find((b) => b.channel === origin.channel && b.peer === origin.peer) ?? origin]
    : sessionBindings;

  assert.equal(targets.length, 1);
  assert.equal(targets[0].peer, 'CHAT_W');
});
