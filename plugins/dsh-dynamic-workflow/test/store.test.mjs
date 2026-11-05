import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createRunStore, dockDetailOf, parseScriptPlan } from '../lib/store.js';

const meta = {
  name: 'review',
  description: 'review changes',
  phases: [{ title: 'Find', detail: 'look' }, { title: 'Verify' }, { title: 'Report' }],
};
const info = { id: 'run-1', meta };

test('engine events fold into phase lanes, nodes and edges', () => {
  let clock = 1000;
  const store = createRunStore({ now: () => clock });
  store.runStart(info);
  store.phase(info, 'Find');
  store.agentStart('run-1', { seq: 1, label: 'finder a', phase: 'Find', childId: 'c1' });
  store.agentStart('run-1', { seq: 2, label: 'finder b', childId: 'c2' });
  clock = 2000;
  store.agentEnd('run-1', { seq: 1, label: 'finder a', phase: 'Find', childId: 'c1', outcome: 'completed' });
  store.phase(info, 'Verify');
  store.agentStart('run-1', { seq: 3, label: 'verifier', phase: 'Verify', childId: 'c3' });

  const run = store.get('run-1');
  assert.equal(run.status, 'running');
  assert.equal(run.currentPhase, 'Verify');
  assert.deepEqual(run.graph.lanes.map((lane) => lane.title), ['Find', 'Verify', 'Report']);
  assert.deepEqual(run.graph.lanes.map((lane) => lane.state), ['running', 'running', 'pending']);
  assert.deepEqual(run.graph.lanes[0].nodes, [1, 2]);
  assert.equal(run.graph.lanes[0].detail, 'look');
  assert.deepEqual(run.graph.edges, [{ from: 'p0', to: 'p1' }, { from: 'p1', to: 'p2' }]);
  assert.equal(run.nodes[0].status, 'completed');

  store.runEnd('run-1', { stopReason: 'completed', agentsStarted: 3 });
  const done = store.get('run-1');
  assert.equal(done.status, 'completed');
  assert.ok(done.nodes.every((node) => node.status === 'completed'));
  assert.equal(done.graph.lanes[2].state, 'skipped');
});

test('session records and engine events are idempotent and bind the session', () => {
  const store = createRunStore();
  store.toolCall('s1', 'call-1', JSON.stringify({ meta, script: 'return 1', args: { a: 1 } }));
  store.sessionRunStart('s1', { runId: 'run-2', name: 'review' });
  store.runStart({ id: 'run-2', meta });
  store.agentStart('run-2', { seq: 1, label: 'x', childId: 'c' });
  store.agentStart('run-2', { seq: 1, label: 'x', childId: 'c' });
  store.agentEnd('run-2', { seq: 1, outcome: 'failed' });
  store.agentEnd('run-2', { seq: 1, outcome: 'failed' });
  store.runEnd('run-2', { stopReason: 'error', error: 'boom' });
  store.runEnd('run-2', { stopReason: 'error' });

  const run = store.get('run-2');
  assert.equal(run.sessionId, 's1');
  assert.equal(run.script, 'return 1');
  assert.deepEqual(run.args, { a: 1 });
  assert.equal(run.nodes.length, 1);
  assert.equal(run.status, 'error');
  assert.equal(run.error, 'boom');
  assert.equal(run.logs.filter((line) => line.kind === 'end').length, 1);
  assert.equal(store.list({ sessionId: 's1' }).runs.length, 1);
  assert.equal(store.list({ sessionId: 'other' }).runs.length, 0);
});

test('a tool call arriving after the run still attaches its script', () => {
  const store = createRunStore();
  store.sessionRunStart('s1', { runId: 'run-3', name: 'review' });
  store.toolCall('s1', 'call', JSON.stringify({ meta, script: 'return 2' }));
  assert.equal(store.get('run-3').script, 'return 2');
});

test('rev only moves forward and every mutation bumps it', () => {
  const store = createRunStore();
  const r0 = store.rev;
  store.runStart(info);
  const r1 = store.rev;
  store.log(info, 'hi');
  assert.ok(r1 > r0 && store.rev > r1);
});

test('persisted running runs reload as interrupted', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dwf-store-'));
  const first = createRunStore({ dir });
  first.runStart(info);
  first.agentStart('run-1', { seq: 1, label: 'a', childId: 'c' });
  await first.close();
  assert.deepEqual(await readdir(path.join(dir, 'runs')), ['run-1.json']);

  const second = createRunStore({ dir });
  assert.equal(await second.load(), 1);
  const run = second.get('run-1');
  assert.equal(run.status, 'interrupted');
  assert.equal(run.nodes[0].status, 'interrupted');
  await second.close();
});

test('running runs cannot be deleted; finished ones can', async () => {
  const store = createRunStore();
  store.runStart(info);
  await assert.rejects(store.remove('run-1'));
  store.runEnd('run-1', { stopReason: 'cancelled' });
  assert.equal(await store.remove('run-1'), true);
  assert.equal(store.get('run-1'), null);
});

test('parseScriptPlan and phaseLanes reconcile planned agents, script steps, and role avatar slots', () => {
  const script = `
    // comment mentioning agent("ignored", { label: "ghost" })
    /* block phase("ghost-phase") */
    const rx = /agent\\("nope"\\)/g;
    phase("编写并跑通单元测试");
    const testRes = await agent("写测试", { label: "测试作者" });
    log("检查单测通过率");
    if (!testRes) await agent("修编译", { label: "编译修复工" });

    phase("实机连接与录制验证");
    await agent("连接验证", { label: "实机验证员" });

    phase("独立复核并修复问题");
    const findings = await agent("独立复核", { label: "独立复核员" });
    if (findings) await agent("修编译", { label: "编译修复工" });
    const clean = [findings].filter(Boolean);

    phase("撰写交付说明");
    return await agent("生成交付文档", { label: "交付说明撰写者", model: "deepseek-chat" });
  `;

  const plan = parseScriptPlan(script);
  assert.deepEqual(plan.phases, [
    '编写并跑通单元测试',
    '实机连接与录制验证',
    '独立复核并修复问题',
    '撰写交付说明',
  ]);
  assert.deepEqual(plan.byPhase.get('编写并跑通单元测试').map((x) => `${x.kind}:${x.label}`), [
    'agent:测试作者',
    'script:',
    'agent:编译修复工',
  ]);

  const store = createRunStore();
  store.sessionModel('s1', 'deepseek', 'deepseek-v4.1-flash');
  store.toolCall('s1', 'call-plan', JSON.stringify({ meta: { name: '工作流脚本', description: 'full flow' }, script }));
  store.sessionRunStart('s1', { runId: 'run-plan', name: '工作流脚本' });
  store.runStart({ id: 'run-plan', meta: { name: '工作流脚本', description: 'full flow' } });

  // Phase 1 runs `测试作者`, skips `编译修复工`, then moves to Phase 2 -> Phase 3 (`独立复核员` running)
  store.phase({ id: 'run-plan' }, '编写并跑通单元测试');
  store.agentStart('run-plan', { seq: 1, label: '测试作者', phase: '编写并跑通单元测试', childId: 'c1' });
  store.agentEnd('run-plan', { seq: 1, outcome: 'completed' });

  store.phase({ id: 'run-plan' }, '实机连接与录制验证');
  store.agentStart('run-plan', { seq: 2, label: '实机验证员', phase: '实机连接与录制验证', childId: 'c2' });
  store.agentEnd('run-plan', { seq: 2, outcome: 'completed' });

  store.phase({ id: 'run-plan' }, '独立复核并修复问题');
  store.agentStart('run-plan', { seq: 3, label: '独立复核员', phase: '独立复核并修复问题', childId: 'c3' });

  const dock = dockDetailOf(store.raw('run-plan'));
  assert.equal(dock.model, 'deepseek-v4.1-flash');
  assert.equal(dock.phases, 4);
  assert.deepEqual(dock.graph.lanes.map((l) => l.state), ['done', 'done', 'running', 'pending']);

  // Phase 1: 测试作者 completed, 脚本 completed, 编译修复工 stays pending (skipped branch)
  const lane0 = dock.graph.lanes[0];
  assert.deepEqual(lane0.items.map((x) => `${x.kind}:${x.label}:${x.status}`), [
    'agent:测试作者:completed',
    'script::completed',
    'agent:编译修复工:pending',
  ]);

  // Phase 3: 独立复核员 running, 编译修复工 pending, 脚本 pending
  const lane2 = dock.graph.lanes[2];
  assert.deepEqual(lane2.items.map((x) => `${x.kind}:${x.label}:${x.status}`), [
    'agent:独立复核员:running',
    'agent:编译修复工:pending',
    'script::pending',
  ]);

  // Phase 4 (future): 交付说明撰写者 already visible as pending with planned model
  const lane3 = dock.graph.lanes[3];
  assert.equal(lane3.items.length, 1);
  assert.equal(lane3.items[0].label, '交付说明撰写者');
  assert.equal(lane3.items[0].status, 'pending');
  assert.equal(lane3.items[0].model, 'deepseek-chat');
  assert.equal(lane3.items[0].modelDeclared, true);

  // Reused role `编译修复工` gets the exact same avatarSlot across Phase 1 and Phase 3
  const fixerSlotPhase1 = lane0.items.find((x) => x.label === '编译修复工').avatarSlot;
  const fixerSlotPhase3 = lane2.items.find((x) => x.label === '编译修复工').avatarSlot;
  assert.equal(fixerSlotPhase1, fixerSlotPhase3);
});

test('parseScriptPlan resolves top-level const strings and strips generic agent template prefixes', () => {
  const script = `
    const P1 = "基线核查与专项审查";
    const P2 = "影子复核";
    const MODEL = "deepseek-reasoner";
    const LEAD = "主审员";
    phase(P1);
    await agent("check", { label: LEAD, phase: P1, model: MODEL });
    phase(P2);
    for (let i = 0; i < 2; i++) {
      await agent("shadow", { label: \`agent-\${i}\` });
      await agent("named", { label: \`专项复核-\${i}\` });
    }
  `;
  const plan = parseScriptPlan(script);
  assert.deepEqual(plan.phases, ['基线核查与专项审查', '影子复核']);
  const p1Items = plan.byPhase.get('基线核查与专项审查');
  assert.equal(p1Items.length, 1);
  assert.equal(p1Items[0].label, '主审员');
  assert.equal(p1Items[0].model, 'deepseek-reasoner');

  const p2Items = plan.byPhase.get('影子复核');
  assert.deepEqual(p2Items.map((x) => `${x.kind}:${x.label}`), [
    'script:',
    'agent:',
    'agent:专项复核',
  ]);
});

test('cancelled or interrupted runs mark active incomplete phases as cancelled instead of done', () => {
  const store = createRunStore();
  const script = `
    phase("Find");
    await agent("a", { label: "扫描员" });
    phase("Verify");
    await agent("b", { label: "验证员" });
    log("post-verify");
    phase("Report");
    await agent("c", { label: "汇总员" });
  `;
  const cancelMeta = {
    name: 'audit',
    phases: [{ title: 'Find' }, { title: 'Verify' }, { title: 'Report' }],
  };
  store.toolCall('s-cancel', 'c1', JSON.stringify({ meta: cancelMeta, script }));
  store.sessionRunStart('s-cancel', { runId: 'run-cancel', name: 'audit' });
  store.runStart({ id: 'run-cancel', meta: cancelMeta });
  store.phase({ id: 'run-cancel' }, 'Find');
  store.agentStart('run-cancel', { seq: 1, label: '扫描员', phase: 'Find', childId: 'k1' });
  store.agentEnd('run-cancel', { seq: 1, outcome: 'completed' });

  store.phase({ id: 'run-cancel' }, 'Verify');
  store.agentStart('run-cancel', { seq: 2, label: '验证员', phase: 'Verify', childId: 'k2' });
  store.runEnd('run-cancel', { stopReason: 'cancelled' });

  const dock = dockDetailOf(store.raw('run-cancel'));
  assert.deepEqual(dock.graph.lanes.map((l) => l.state), ['done', 'cancelled', 'skipped']);
  // Trailing script step after a cancelled agent must NOT be marked completed
  assert.deepEqual(dock.graph.lanes[1].items.map((x) => `${x.kind}:${x.status}`), [
    'agent:cancelled',
    'script:pending',
  ]);
});

test('parseScriptPlan handles empty, non-string, and truncated/malformed scripts without throwing', () => {
  for (const bad of [null, undefined, 42, '', '   ']) {
    const res = parseScriptPlan(bad);
    assert.deepEqual(res.phases, []);
    assert.equal(res.byPhase.size, 0);
  }
  const malformed = 'phase("Alpha"); agent("task", { label: `unclosed-${x /* comment';
  const parsed = parseScriptPlan(malformed);
  assert.deepEqual(parsed.phases, ['Alpha']);
});

test('parseScriptPlan supports ES6 shorthand { label }, nested option objects, and plural generic templates', () => {
  const script = `
    const phase = "静态阶段";
    const label = "静态评审员";
    const model = "deepseek-v4.1-flash";
    await agent("固定提示词", { label, phase, model });

    phase("动态扇出");
    for (const label of ["安全审计", "性能审计"]) {
      await agent("执行子任务检查", { label });
    }
    await parallel([1, 2].map((i) => () => agent("并发检查", { extra: { retries: 2 }, label: \`agents-\${i}\` })));
    await agent("带嵌套配置的任务", { extra: { a: 1, b: [2, 3] }, label: "最终汇总员" });
  `;

  const plan = parseScriptPlan(script);
  assert.deepEqual(plan.phases, ['静态阶段', '动态扇出']);

  const p0 = plan.byPhase.get('静态阶段');
  assert.equal(p0.length, 1);
  assert.equal(p0[0].label, '静态评审员');
  assert.equal(p0[0].hasStaticLabel ?? !p0[0].dynamicLabel, true);
  assert.equal(p0[0].model, 'deepseek-v4.1-flash');

  const p1 = plan.byPhase.get('动态扇出');
  assert.equal(p1[0].kind, 'script');
  const p1Agents = p1.filter((x) => x.kind === 'agent');
  assert.equal(p1Agents.length, 3);
  // 1st agent: shadowed `for (const label of ...)` shorthand `{ label }` -> empty planned label + dynamicLabel: true (does NOT reuse earlier top-level `const label` or leak prompt)
  assert.equal(p1Agents[0].label, '');
  assert.equal(p1Agents[0].dynamicLabel, true);
  // 2nd agent: `agents-${i}` -> stripped generic plural prefix -> empty label + dynamicLabel: true
  assert.equal(p1Agents[1].label, '');
  assert.equal(p1Agents[1].dynamicLabel, true);
  // 3rd agent: nested `{ extra: { ... }, label: "最终汇总员" }` -> innerDepth balanced, static label preserved
  assert.equal(p1Agents[2].label, '最终汇总员');
  assert.equal(p1Agents[2].dynamicLabel, false);
});
