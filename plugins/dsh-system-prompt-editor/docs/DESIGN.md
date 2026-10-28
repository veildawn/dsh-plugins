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

### 2.5 段落查询定位（locate）

前面几节都在解决「知道段落名之后怎么改」，但用户真正卡住的地方往往更早一步：
**他知道提示词里有这么一句话，但不知道它属于哪个段落**。

典型求助是这样的：

> 想改掉提示词里「Web GUI」这个说法，但翻了半天 `harness:identity`、
> `deployment:persona-prefix` 都不是，到底在哪一段？

所以提供一个**反向查询**：给一段文字，返回命中的段落。

```ts
interface LocateOptions {
  text: string
  mode?: 'auto' | 'phrase' | 'terms' | 'regex'   // 默认 auto
  caseSensitive?: boolean                        // 默认 false
  wholeWord?: boolean                            // 默认 false
}

interface LocateResult {
  ok: boolean
  strategy: 'phrase' | 'terms' | 'regex' | null   // 实际生效的策略
  matchedSections: number
  totalSpans: number
  matches: Array<{
    name: string          // section 名，可直接用于 match.kind = 'name'
    index: number         // 在 assembly 里的序号（1-based）
    hits: number          // 命中次数
    omitted: number       // 未展示的命中数
    custom: boolean       // 是否是用户追加的段落
    snippets: Array<{ segments: Array<{ text: string, hit: boolean }> }>
  }>
  message: string         // 可直接展示给用户的一句话
}
```

**设计取舍**：

- **在折叠空白的副本上匹配，再映射回原文**。用户从别处粘贴的文本常带着换行与
  缩进，而提示词段落本身也有换行；直接 `indexOf` 会大量漏判。`compactWhitespace()`
  把连续空白压成一个空格并记录 `折叠下标 → 原始下标` 的映射，匹配在副本上做，
  切片仍取原文，所以高亮片段不会错位。
- **`auto` 两级降级**。先用整段文字当短语找——命中即说明原文**一字不差地存在**，
  可信度最高；一个都没命中时才按关键词（每个词都出现）找，容忍措辞与顺序差异。
  用户抄错一个标点就得到「查无此项」是最糟糕的体验。
- **大小写折叠要防长度变化**。极少数字符（如 `İ`）小写化后长度会变，会让下标与
  原文错位、切出乱码。`foldCase()` 检测到长度变化即放弃折叠，退化为大小写敏感比较。
  注意查询侧必须做同样的判断，否则一边折叠一边不折叠，永远匹配不上。
- **正则跑在未折叠大小写的文本上**，只用 flags 控制大小写。折叠会破坏 `[A-Z]`、
  `\p{Lu}` 这类模式，结果是静默查不到。
- **查询对象必须是真实段落**。宿主端 `locatePrompt()` 直接对 `assemble()` 的
  `sections` 求值，与「按名称」下拉框同源，因此查到的名字一定能直接选中。
- **短时缓存 assembly**（3 秒）。输入即查意味着每次按键一次请求，若每次都重跑
  整条 waterfall，代价过高。缓存只存极短时间，既能吸收连续输入，又不会让用户
  在改完规则后看到过期结果。
- **纯只读**。`locate` 不落盘、不改配置，失败也只影响结果区。

前端在此基础上多做一步「落成规则」：命中后一键新建 `match.kind = 'name'` 的规则，
并把命中的原文预填进 `replaceText.find`。查到之后还要用户自己去下拉框里翻，
那查询就只是个玩具。

前端还有两个容易出错的地方，测试里专门钉住了：

- **请求序号**。输入即查会产生并发请求，先发的可能后到；不丢弃过期响应，
  界面就会闪回上一个词的结果。
- **查询失败不能连累主流程**。定位只是辅助功能，它挂了也要能正常保存规则。

### 2.5.1 段落中文名映射（SECTION_LABELS）

section 名是内部标识，普通用户在「按名称」下拉框或查询结果里看到 `context:file-reference`
这种裸串是没法判断该改哪一段的。因此前端维护一张 `SECTION_LABELS`：
中文含义 + 括号里的原名 + 字数。

维护这张表有三条约束：

1. **键必须是官方真实注册名**。历史上这里写错过两次：
   - `dsh-tool-web` 注册的是 `tool:web_search` / `tool:web_fetch`（**下划线**），
     早先按连字符写，导致这两段长期退化成裸名；
   - PTC 段落是 `tools:ptc-only` / `tools:sdk`（在 `dsh-tools` 里注册，
     带 `tools:` 前缀），早先按 `ptc:only` 写，同样对不上。
2. **能穷举的才写死，不能穷举的走前缀**。每个 MCP 服务都以 `mcp:<服务名>`
   动态注册（`dsh-mcp-client`），服务名无法预先知道，所以按 `mcp:` 前缀兜底。
   注意前缀兜底**只认冒号**：`mcp-resource-servers`（`dsh-mcp-resources` 注册的
   固定段落，连字符开头）兜不住，必须单独收录。
3. **`sectionLabel` 必须自包含**。测试会从源码里抠出这个函数单独求值，
   一旦它引用模块内的其它 helper 就会 `ReferenceError`。需要复用判断逻辑时，
   复制那几行（见 `knownSectionLabel`），不要把 `sectionLabel` 改成调用方。

### 2.5.2 内置提示词段落的来源（便于定位）

用户常拿着某段原文来问「这是哪个段落」，下表是几个高频段落的真实出处：

| 段落名 | 文本来源 | order |
|---|---|---|
| `harness:identity` | `dsh-system-prompt`（全局硬编码） | -1000 |
| `context:file-reference` | `FILE_REFERENCE_PROMPT`，由 `dsh-file-reference-local` 注册；变量名与前面这一句同名的常量定义在 `@deepseek-ai/dsh-file-reference` | 900 |
| `tool:*` | 各 `dsh-tool-*` 包，名为 `` `tool:${toolName}` `` | 1000–3000 |
| `mcp:<服务名>` | `dsh-mcp-client` | 3100 |
| `ui:deliverable-file-references` | `dsh-client-ui-deliverables` | 9000 |
| `app:web-surface` | `dsh-harness-dev-context` | 10100 |

`context:file-reference` 值得单列：它讲的是「`@` 开头的 token 怎么解析」，
是唯一告诉模型「先用 `read` 读、再声称检查过」的段落。原文只描述语法，
不含行为约束，所以它也是最常被用户接管改写的一段（README 例 6 给了套用模板）。

### 2.5.3 必须带 agent scope 组装（否则漏段）

真实事故（v0.3.2 发布后）：设置页显示「当前共 8 个段落」，而会话提示词里明明
有 `Tokens prefixed with @ are paths the user explicitly referenced`，
在「段落查询定位」里却**搜不到**。

根因不在查询逻辑，而在**组装时给的 scope 不对**：

```js
// 修复前：只合并全局层
state.prompt.assemble({ scope: undefined, [BYPASS_KEY]: true })
```

`SystemPrompt.assemble(context)` 内部按 `this.layers.chainLayers(context.scope)`
合并分层，`scope` 为 `undefined` 时**只拿全局层**。而不少段落注册在更强的
scope 上——典型如 `@deepseek-ai/dsh-file-reference-local`：

```js
for (const agent of ctx.agents.list()) installPrompt(agent)
// installPrompt 里：
agent.ctx.inject(['systemPrompt', 'tools'], (scope) => {
  scope.systemPrompt.section({ name: 'context:file-reference', ... })
})
```

`section()` 走 `layers.effect(this.ctx, ...)`，以**调用时的 ctx** 决定落在哪一层
（`scopeOf(ctx)` 取值，`undefined` 即全局层）。注册发生在 `agent.ctx` 的 scope 里，
所以只有带 agent scope 组装才看得到。

修复方式（`assembleWithAgentScope`）：

1. 先按全局 scope 组装一次——**与旧行为完全一致**，保证无 agent 的部署不受影响；
2. 再用 `findLiveAgent(ctx)` 找到的存活 agent（优先 `agents.roots()` 顶层会话，
   避免拿到子代理）的 `ctx` 组装一次；
3. 把只在 scoped 结果里出现的段落**按名并入**，全局已有的一律以全局为准。

三条边界，测试逐一钉住：

- **全局优先**：同名段落不取 scoped 版本，否则设置页展示的 baseline 会与用户
  真实看到的提示词不一致；
- **空文本不补**：`context:file-reference` 在没有 `read` 工具时 `text()` 返回空串，
  列出来只会让人以为写了规则没生效；
- **探测全防御**：`ctx.agents` 是可选服务（peerDependencies 未声明），
  缺失/抛错/返回空一律退化为「没有 agent」；scoped 组装失败时退回全局结果，
  绝不让整个设置页报错。

> 这条教训值得记在规则里：**「组装一次提示词」不等于「看到全部段落」**。
> 任何以 `scope: undefined` 组装后展示或查询段落的代码，都会静默漏掉
> agent 级注册的段落——而且漏得毫无提示（段落列表只是变短了）。

### 2.6 前端设置页

- 注册到 `settings.section` 插槽（与 dsh-jev 一致）。
- 通过 `ctx.connection.rpc.handle` 暴露方法：
  - `describe`：返回当前配置 + **渲染后的真实系统提示词**（默认展示需求）
  - `locate`：段落查询定位（见 2.5），输入即查
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
| 查出某句话在哪个段落 | ✅ | `locate`，结果可直接落成 `match.kind = 'name'` 规则 |
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
7. **查询定位失败**：`locate` 捕获全部异常并返回 `ok: false` + 可读消息，
   绝不抛出；查询只是辅助功能，不能连累保存与预览。组装提示词本身失败时
   （例如 `systemPrompt` 服务未就绪），同样只降级成「暂时无法定位」。
