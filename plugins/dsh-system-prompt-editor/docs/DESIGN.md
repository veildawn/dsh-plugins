# dsh-system-prompt-editor 设计说明

> 目标：在不修改 `@deepseek-ai/dsh-system-prompt` 安装包源码的前提下，
> 让用户能**查看**、**追加**、**替换**、**删除**系统提示词段落，
> 配置持久化，并通过 Web 设置页可视化编辑。

---

## 1. 背景：系统提示词是怎么被组装出来的

`@deepseek-ai/dsh-system-prompt` 是一个 Cordis 注册表服务（`ctx.systemPrompt`）。
每次模型请求前，它把若干 **section** 按 `order` 升序拼接：

```
sections.sort(order, name) → 逐段插值 {{var}} → 丢弃空段 → 用空行 join
```

关键源码事实（`lib/index.js`，版本 `0.2.1-rc.2`）：

| 事实 | 代码位置 | 对设计的影响 |
|---|---|---|
| `harness:identity` 在构造器里**全局硬编码**注册 | L228-232 | 全局层不能重复注册同名 section，会抛错 |
| `section()` 通过 `this.layers.effect(this.ctx, ...)` 按**调用者的 scope** 归属 | L253-256 | 注册位置决定可见范围：全局 or 某个 agent scope |
| `ScopedLayers.merge` 让**最近 scope 获胜** | `dsh-scope` L172-176 | scope 内同名 section 可以 shadow 全局同名 |
| 全局层内同名注册**直接抛错** | L203 | 不能靠“再注册一次同名”改全局段 |
| `system-prompt/assemble` waterfall，返回值权威 | L398 | **全局插件也能改写最终 assembly** |
| 未打 scope tag 的监听器能收到所有 scope 的事件 | `dsh-scope` `scopeTarget` | 全局监听器可统一处理所有会话 |
| 存在 `complete: true` 的 section 时，waterfall 结果被丢弃 | L399-405 | 使用 complete 的预设下，插件改写会失效（需检测并提示） |
| `context.agent` 由 `dsh-agent` 模块扩展提供 | `dsh-agent/lib/types/runtime-types.d.ts` L15 | 可按 agent / 会话维度区分 |

### 结论：为什么不用“重新注册同名 section”

- **全局维度**：`harness:identity`、`deployment:persona-prefix` 等已在全局层注册，
  全局再注册同名必然抛 `prompt section "xxx" is already registered`。
- **预设维度**：预设 scope 内注册同名确实可以覆盖，但只能覆盖 **section 名可预知**
  的那几段，且必须把插件挂进预设的 `plugins` 列表。

因此本插件采用**双通道**：

1. **`system-prompt/assemble` waterfall（主通道）**
   拿到已组装的 `assembly.sections`，按规则做文本变换。全局挂载即对所有会话生效，
   且完全不碰注册表命名空间，不会与任何现有插件冲突。
2. **额外 section 注入（辅通道）**
   注册新的、名字带命名空间的 section（`prompt-editor:custom-*`），
   用于“追加一段全新提示词”这个最常用场景，享受正常排序与插值。

两条通道互不重叠：改已有段落走 waterfall，加新段落走 section 注册。

---

## 2. 功能模型

### 2.1 规则（rule）

一条规则表达“对哪里、做什么”：

```ts
interface Rule {
  id: string                 // 稳定标识，用于前端列表与诊断
  enabled: boolean           // 默认 true，关闭后规则不参与
  match: MatchSelector        // 选中哪些 section
  action: Action              // 对它做什么
  applyTo?: Reach             // 生效范围（默认按插件实例的挂载范围）
}

type MatchSelector =
  | { kind: 'all' }                       // 所有 section
  | { kind: 'name'; name: string }        // 精确 section 名，如 'harness:identity'
  | { kind: 'prefix'; prefix: string }    // 名字前缀，如 'deployment:'
  | { kind: 'text'; contains: string; caseSensitive?: boolean }  // 按内容定位
  | { kind: 'regex'; pattern: string; flags?: string }           // 按内容正则

type Action =
  | { kind: 'replaceText'; find: string; replace: string; all?: boolean }  // 段内文本替换
  | { kind: 'setText'; text: string }        // 整段文本替换
  | { kind: 'prepend'; text: string }        // 段首插入
  | { kind: 'append'; text: string }         // 段尾追加
  | { kind: 'remove' }                        // 删除整段
```

**设计取舍**：

- `replaceText` 是“只改一句”场景（例如把
  `You are an AI agent powered by DeepSeek Harness.` 换成自有身份句）的最小侵入方式：
  不重写整段，其余内容原样保留。
- `setText` 用于彻底接管某段。风险更高，前端需给出确认提示。
- `remove` 等价于“关掉某段提示词”，例如禁用某工具的说明。
- 所有 action 都保持 `interpolate` 标记不变，避免破坏 `{{model}}` 之类的变量插值。

### 2.2 追加段落（appendSections）

独立于规则的一个列表，直接注册为新 section：

```ts
interface CustomSection {
  id: string
  enabled: boolean
  name?: string          // 可选，最终统一加 'prompt-editor:custom:' 前缀
  text: string
  order?: number         // 默认放在 persona suffix 之后（10200 + 偏移）
  position?: 'before-persona' | 'after-persona' | 'before-tools' | 'after-tools' | 'end'
}
```

`position` 是给人用的语义位置，内部映射到 `SECTION_ORDERS` 的锚点：

| position | 实际 order |
|---|---|
| `before-persona` | `HARNESS_IDENTITY + 1`（-999，紧跟身份句） |
| `after-persona`（默认） | `DEPLOYMENT_PERSONA_SUFFIX + 10`（10210） |
| `before-tools` | `FILE_REFERENCE - 1`（899，在工具说明之前） |
| `after-tools` | `MCP_SERVERS + 10`（3110） |
| `end` | `DEPLOYMENT_PERSONA_SUFFIX + 1000`（11200） |

显式 `order` 优先于 `position`。稳定性说明：同一 order 的多个 section 按名称
（code unit）排序，所以给自动生成的 name 加零填充序号保证顺序可控。

### 2.3 生效范围（Reach）

用户要求“全局或指定 agent/预设”。实现方式：

- **全局**：插件挂在 profile 全局层 → waterfall 对**所有** scope 生效。
  这是默认。
- **限定预设/agent**：规则携带 `applyTo`，在 waterfall 里按 `context.scope`
  与 `context.agent` 匹配后才执行。这样即使是全局挂载，也能做到“只影响某个预设”。

```ts
type Reach =
  | { mode: 'all' }                        // 所有会话
  | { mode: 'presets'; ids: string[] }     // 只在这些预设下生效
  | { mode: 'sessions'; ids: string[] }    // 只在指定会话生效
```

> 为什么不用“把插件挂进预设 scope”来实现按预设生效？
> 因为用户会频繁切换预设，而每个预设单独装一份插件会让配置分散、难以统一管理。
> 用 waterfall + `applyTo` 过滤，配置只存一份，前端一处编辑。

**如何拿到当前会话的预设 id**：`AssembleContext` 只保证有 `scope`/`signal`，
`agent` 由 `dsh-agent` 扩展。预设 id 需要从 `agent.session` 读取。
实现时做**防御性探测**：拿不到就 fallback 成“匹配所有”，并在诊断信息里标明
“本会话无法解析预设 id，`applyTo.presets` 已退化为不限制”，避免静默错配。

### 2.4 配置持久化

- 主存储：`ctx.settings.register(ns, Config, { base })`（官方设置服务），
  让配置进入 profile 补丁文档，随 profile 一起保存。
- 兜底：`~/.dsh/system-prompt-editor/settings.json`（当 `ctx.settings` 不可用时）。
  这是 file-viewer 插件已验证过的兼容写法。
- 原子写：写临时文件 + `rename`，避免半截 JSON。

### 2.5 前端设置页

- 注册到 `settings.section` 插槽（与 dsh-jev 一致）。
- 通过 `ctx.connection.rpc.handle` 暴露方法：
  - `describe`：返回当前配置 + **渲染后的真实系统提示词**（默认展示需求）
  - `save`：保存配置
  - `preview`：用候选配置渲染一次预览（不落盘，用于“保存前看效果”）
  - `reset`：恢复默认
- 默认展示“系统默认提示词”：通过一次**不带规则**的 `assemble` 得到基线文本，
  与带规则的最终文本并排展示，差异部分高亮。

---

## 3. 与官方能力的边界

| 场景 | 本插件能否做到 | 说明 |
|---|---|---|
| 改身份句文本 | ✅ | `replaceText` 命中 `harness:identity` |
| 追加自定义规矩 | ✅ | `appendSections` |
| 删除某段工具说明 | ✅ | `remove` 规则 |
| 改变段落顺序 | ✅ | 给自定义段落指定 order / position |
| 在 `complete: true` 的预设下改写 | ⚠️ 检测到即禁用并提示 | 官方会强制恢复该 section，任何监听器都改不动 |
| 改工具 schema 描述 | ❌ | 属于 `systemPrompt.tools()` 提供方，不在本插件职责内 |

---

## 4. 失败模式与防护

1. **规则语法错误**：单条规则解析失败只禁用该条，其余规则继续生效；
   前端列表标红并给出原因，绝不整插件崩溃。
2. **正则非法**：捕获异常，标记该规则失效。
3. **`setText` 未命中任何段落**：不报错，但前端提示“该规则未命中”，
   避免用户以为生效了。
4. **重复 id**：后出现的规则被丢弃并告警。
5. **配置损坏**：回退到默认空配置，日志记录原始错误。
6. **插值变量**：所有改写都保留原 section 的 `interpolate` 标记。
   若用户在新文本里写了未知 `{{var}}`，官方渲染期会抛错——
   前端在保存前用当前变量表校验一遍并拦截。
