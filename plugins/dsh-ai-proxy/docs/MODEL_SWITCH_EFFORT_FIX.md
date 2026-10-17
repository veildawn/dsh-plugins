# 切模型报 400 `invalid_request_error` —— 修复交接

**结论先行**：这是 `dsh-ai-proxy` 插件的缺陷。切模型时，上一个模型的 `reasoning.effort`
被原样带给了新模型；当该档位不在新模型的 effort ladder 内时，网关忠实拒绝并返回
400。修复点在插件侧，**网关（`ai-proxy-service`）与 `ai-protocol` 无需改动**。

本文件是排查结论 + 落地方案 + 单测草稿，供在 `plugins/dsh-ai-proxy` 实施。
按仓库 `AGENTS.md`：仅改代码 + `npm test`，**不要擅自 `dsh plugin add` / 重启服务**。

---

## 1. 现象

在 DSH 会话里切换模型（例：`deepseek-v4.1-flash` → `gemini-3.8-flash`）时，请求失败：

```json
{"error":{"code":"invalid_request_error",
 "message":"protocol request: reasoning effort \"max\" is not one of the accepted levels",
 "param":null,"type":"invalid_request_error"}}
```

HTTP 400。`param:null` 是 OpenAI 错误 envelope 里恒定的空槽，`invalid_request_error`
对应 400，都是网关 `ai-proxy-service/internal/translator/errors.go` 对上游 400 的
**正确**归一化，不是网关 bug。

## 2. 根因

`reasoning.effort` 是**跨模型持久**的会话状态，但每个模型能接受的 effort 档位不同。
切模型后没有按新模型的 ladder 收敛，越界档位被发给上游 fold，被拒。

### 2.1 上游 fold 的硬编码接受集

`ai-protocol` 的 `geminiresponses/request.go` → `applyReasoningEffort`：

```
minimal / low / medium / high / none / disable
```

`max`、`xhigh`、`ultra`、`turbo` 一律拒绝（返回
`reasoning effort %q is not one of the accepted levels`）。经 Gemini 臂的模型
（`gemini-3.8-flash` 等）都会撞上这个集合。

### 2.2 触发矩阵（按实际 settings 声明）

| 源模型 | 其 effort | 目标模型 | 其 effort | 结果 |
|---|---|---|---|---|
| deepseek-v4.1-flash | low/high/**max** | gemini-3.8-flash | low/medium/high | 切过去即 400 |
| grok-4.7 | low/medium/high/**xhigh** | 任何无 xhigh 的模型 | — | 400 |
| 任何含 max/xhigh 的模型 | max/xhigh | 任何经 Gemini 臂的模型 | — | 400 |

（effort 声明取自 `~/.dsh/settings.yaml.imported` 的 `llm-pi-ai.providers.ai-proxy.models[].reasoningEfforts`。）

### 2.3 实测证据（对线上网关 `192.168.1.253:8319`）

- 单发 `deepseek-v4.1-flash`、`gemini-3.8-flash`（无越界 effort）→ **200**
- `deepseek-v4.1-flash` + `effort:"max"` → **200**（max 对它合法）
- `gemini-3.8-flash` + `effort:"max"` → **400**，message 即上面的字符串

即：问题**只在跨模型 + effort 越界**时出现，与模型本身可用性无关。

## 3. 责任判定

- **插件**：切模型后未按新模型 ladder 收敛 effort。← 要修
- **网关 / ai-protocol**：正确。忠实拒绝目标模型无法表达的参数，而非静默猜一个
  `thinkingBudget`。**不要为迁就越界参数去放宽网关校验**——那会掩盖客户端 bug，
  并违背「degraded 也先告知」的设计。

## 4. 插件侧修复

### 4.1 关键事实：回落 machinery 已存在，只是没接在「切换」这条路上

`lib/index.js` 里已有完整的 per-model 回落逻辑，设计意图正是「按模型自己的 ladder
回落，绝不用 route 级档位硬套每个模型」：

- `resolveDefaultEffort(ladder, configured)` —— 就近回落，偏好更低档（L114）
- `preferredEffort(efforts, configured)` —— 只按**本模型** ladder 解析（L282）
- `streamOptionsWithPreferredEffort(streamOptions, efforts, configured)` —— 给「未显式
  选 effort 的直连流」补上本模型档位（L267）

`routeDefaultEffortKey` 的注释（L300-303）已经点破同一个坑：

> a level the strongest model offers (`max`) is refused by a model whose own ladder
> stops at `high`.

### 4.2 缺口定位

`streamOptionsWithPreferredEffort` 的第一行守卫：

```js
if (streamOptions?.provider !== PROVIDER || streamOptions.reasoningEffort !== undefined) return streamOptions
```

`reasoningEffort !== undefined` 表示「已有显式选择就原样保留」。但**切模型后**，
`streamOptions.reasoningEffort` 里残留的是**上一个模型**的档位（已 defined），于是
「按新模型 ladder 重算」被跳过——旧模型的 `max` 原样发给 gemini。

即：回落逻辑只覆盖「从无到有选档」，没覆盖「换了一个模型后旧档位失效」。

### 4.3 修法

**核心原则**：effort 必须相对于**当前模型**有效。切换模型 = 当前模型变了 = 旧档位
可能失效，需要重新按新模型 ladder 收敛。回落用「集合内就近向下」（优先不升档），
只有超界值（max→high、xhigh→high）才向下夹到集合最大值。

**注入点 A（首选，语义最准）——模型切换处**：找到切换模型、重组 streamOptions 的
调用点，切模型后调用一次收敛：

```js
// 切到新模型 modelId 后，用新模型的 ladder 重算 effort
const newLadder = ladderForModel(models, modelId)     // 该模型 reasoningEfforts 的键
const converged = clampEffortToLadder(prevEffort, newLadder)
// converged 覆写 streamOptions.reasoningEffort
```

**注入点 B（兜底，最稳）——`streamOptionsWithPreferredEffort`**：把「已 defined 就
跳过」改为「已 defined 但不在本模型 ladder 内也重算」。保留「显式且合法」的原值。

### 4.4 建议新增的纯函数（便于单测）

在 `lib/index.js` 导出：

```js
/**
 * Clamp an effort onto a model's own ladder, nearest-down preferring lower rungs.
 * Returns the effort unchanged when the ladder already contains it (an explicit,
 * in-range choice is never rewritten). Returns undefined when the ladder has no
 * selectable rung, so the caller omits the field rather than sending one the
 * model cannot serve — an out-of-range effort is a hard 400 upstream.
 *
 * @param {string|undefined} effort  the effort carried over from the previous model
 * @param {string[]|undefined} ladder  the target model's rungs (its reasoningEfforts keys)
 */
export function clampEffortToLadder(effort, ladder) {
  const rungs = (Array.isArray(ladder) ? ladder : [])
    .filter((r) => typeof r === 'string' && r.length > 0 && r !== 'off')
  if (rungs.length === 0) return undefined
  if (typeof effort !== 'string' || effort === '' || effort === 'off') return undefined
  if (rungs.includes(effort)) return effort
  // nearest rung, preferring lower (do not silently upgrade the user's choice)
  const idx = EFFORT_ORDER.indexOf(effort)
  if (idx !== -1) {
    for (let i = idx; i < EFFORT_ORDER.length; i++) {
      if (rungs.includes(EFFORT_ORDER[i])) return EFFORT_ORDER[i]
    }
    for (let i = idx - 1; i >= 0; i--) {
      if (rungs.includes(EFFORT_ORDER[i])) return EFFORT_ORDER[i]
    }
  }
  return rungs[0]
}
```

（`EFFORT_ORDER` 已是模块内常量，L105。）

### 4.5 两个模型 ladder 的来源

- materialize 出的 route：每个模型 entry 的 `reasoningEfforts`（`ladderToReasoningEfforts`
  产物，L366）。取其 `Object.keys(...)` 即选择器键集合。
- 请求时：`streamOptions` 里能拿到当前 `model`，据此查该模型的 ladder。

## 5. 单测草稿

追加到 `test/core.test.mjs`（`node:test` + `node:assert/strict`，从 `../lib/index.js`
导入，与既有用例同风格）。同时把 `clampEffortToLadder` 加进该文件顶部的 import 列表。

```js
test('clampEffortToLadder: a carried-over effort is clamped to the new model', () => {
  // the bug: deepseek(max) -> gemini(low/medium/high) sent "max" and 400'd
  assert.equal(clampEffortToLadder('max', ['low', 'medium', 'high']), 'high')
  assert.equal(clampEffortToLadder('xhigh', ['low', 'medium', 'high']), 'high')
  assert.equal(clampEffortToLadder('max', ['minimal', 'low']), 'low')
  assert.equal(clampEffortToLadder('ultra', ['high', 'max']), 'max')   // unknown rung -> nearest up when nothing lower
})

test('clampEffortToLadder: an in-range effort is never rewritten', () => {
  assert.equal(clampEffortToLadder('high', ['low', 'medium', 'high']), 'high')
  assert.equal(clampEffortToLadder('medium', ['low', 'medium', 'high']), 'medium')
  assert.equal(clampEffortToLadder('low', ['low', 'medium', 'high']), 'low')
})

test('clampEffortToLadder: no selectable rung omits the field', () => {
  assert.equal(clampEffortToLadder('max', []), undefined)
  assert.equal(clampEffortToLadder('max', ['off']), undefined)
  assert.equal(clampEffortToLadder('off', ['low', 'high']), undefined)
  assert.equal(clampEffortToLadder(undefined, ['low', 'high']), undefined)
})
```

若采用注入点 B，再补一条针对 `streamOptionsWithPreferredEffort` 的回归（证明
「已 defined 但越界」会被重算，而「已 defined 且合法」保持原值）：

```js
test('streamOptionsWithPreferredEffort: a stale out-of-range effort is recomputed', () => {
  const stale = { provider: 'ai-proxy', reasoningEffort: ReasoningEffortId('max') }
  const geminiEfforts = { low: 'low', medium: 'medium', high: 'high' }
  const fixed = streamOptionsWithPreferredEffort(stale, geminiEfforts, 'highest')
  assert.notEqual(fixed.reasoningEffort, stale.reasoningEffort, 'the carried-over max must not survive onto gemini')
  // an explicit, in-range effort is still kept verbatim
  const ok = { provider: 'ai-proxy', reasoningEffort: ReasoningEffortId('high') }
  assert.equal(streamOptionsWithPreferredEffort(ok, geminiEfforts, 'highest'), ok)
})
```

## 6. 验收

1. `cd plugins/dsh-ai-proxy && npm test` —— 新增用例全绿，既有用例不回归。
2. 端到端（用户侧验证，需其明确要求后按 `AGENTS.md` 走 `dsh plugin add`）：
   - deepseek-v4.1-flash，effort=max → 切 gemini-3.8-flash → 请求体 effort 应为 `high`，
     接口 200。
   - 反向：gemini(high) → 切 deepseek(max 可用) → effort 保持 `high`（不擅自升到 max）。

## 7. 关联信息

- 网关仓库：`/home/ai_bot/CodeSpace/ai-proxy/ai-proxy-service`（本次只发了一个无关的
  thought-signature 修复 v0.23.1，与本问题无关，未改错误路径）
- `ai-protocol` 接受集：`geminiresponses/request.go` 的 `applyReasoningEffort`
- 错误归一化：`ai-proxy-service/internal/translator/errors.go` 的 `NormalizeErrorFor`
- 插件 effort 常量与函数：`plugins/dsh-ai-proxy/lib/index.js`
  （`EFFORT_ORDER` L105、`resolveDefaultEffort` L114、`ladderToReasoningEfforts` L233、
  `streamOptionsWithPreferredEffort` L267、`preferredEffort` L282）
