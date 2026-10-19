# dsh-task-models

DeepSeek Harness (DSH) 独立插件：**在设置里为不同类型的子任务配置不同模型**，并可选地让
TypeSafe Jev（System One 决策模型）参与“这个子任务属于哪一类 / 该用哪个模型”的判断。

本插件不依赖任何 Agent Preset 或角色路由插件；只要安装并启用，就会对当前会话委派出的子代理
（`subagent`、`workflow` 的 `agent()`、以及它们派生的孙代理）生效。主会话自身的模型选择不会
被改写。

## 特性

- **按任务类型路由**：内置 `explore`、`implement`、`review`、`test`、`research`、`docs` 六类，
  可添加任意自定义类型；每类独立选择 Provider、模型和思考档位。
- **规则优先**：精确 label / `[review]` / `review:` 显式前缀绝对优先，其次按关键词评分；英文标识符关键词采用词边界匹配，规则命中零额外模型调用。
- **规则试运行**：设置页直接预览未保存草稿的命中关键词、分数、并列冲突和下一分类路径；不调用模型、不写设置。
- **路由解释**：workflow 模型徽标显示任务类别、规则/Jev/轻量模型来源、有效置信度、决策耗时和回退原因；区分预选路由与请求头已确认模型。
- **可选 Jev**：规则未命中时，把截断后的父任务/子任务文本发给 Jev，让它在已配置任务类型 +
  `general` 中选一个；Jev 只返回任务类型 id，不会发明模型或 Provider。
- **可选轻量分类**：不想用 Jev 时，可配置一个轻量模型作为回退分类器。
- **按子代理决策一次**：首次请求只缓存通过能力校验的有效路由，后续请求沿用同一模型；能力校验失败或最终无匹配时缓存“保持当前路由”，不会重放失败候选。
- **有界等待与取消**：分类链和候选能力校验共用 `decisionTimeoutMs` 总预算（默认 5000ms）；调用者取消立即传播，不启动后续分类器，未完成决策可用新 signal 重试。
- **安全回退**：Jev 不可用、超时、低置信度、输出非法时继续既定回退链；最终无匹配、分类器未配置、总预算耗尽或候选不可用时保持当前路由。
- **可观测**：设置页提供 Jev 状态、API Key 保存和测试按钮；密钥只写本地文件，不回显。
- **独立设置命名空间**：`task-models`，通过专用 Connection RPC 读写，不依赖宿主设置 allowlist。

## 安装

从 npm registry 安装（推荐，自动跟随最新版；插件管理器的「自有插件」页也能直接点安装）：

```bash
dsh plugin --profile web add @weniatall/dsh-task-models
```

或锁定版本，从 GitHub Release 安装 tarball：

```bash
dsh plugin --profile web add https://github.com/veildawn/dsh-plugins/releases/download/dsh-task-models@v0.3.0/dsh-task-models-0.3.0.tgz
```

> 本包已发布到 npm scope `@weniatall/dsh-task-models`，后续版本由 CI 通过 Trusted
> Publishing 发布，并附带 provenance 来源证明。插件管理器在 `allowTarball` 开启时
> （离线/内网环境）会回落到上面的 Release tarball 渠道。

或在仓库内打包安装：

```bash
cd plugins/dsh-task-models
npm test
npm pack
dsh plugin --profile web add ./weniatall-dsh-task-models-0.3.0.tgz
```

> 本仓库的 `AGENTS.md` 规定：除非用户明确要求，不在本机部署插件或重启服务。开发验证请只运行
> `npm test` / `npm pack --dry-run`。

## 设置

打开 **设置 → 任务模型**：

1. 勾选“启用按任务类型路由子任务”。
2. 为内置任务类型选择模型；也可以“添加任务类型”创建自定义类型。
3. 选择规则未命中时的回退方式：
   - **保持当前路由**（默认）：不覆盖会话原有路由；其他插件的路由仍然生效；
   - **用轻量模型分类**：需要先配置“轻量分类模型”。
4. 可选启用 Jev，填写 API Key（留空保留本插件已保存的 Key）、Base URL、模型和阈值；“已配置”只表示已保存 Key，不代表联网测试成功。
5. 设置“决策总超时”，范围 100–60000ms 的整数，默认 5000ms；Jev 还受自身超时限制。
6. 在“规则试运行”输入子任务标题与内容，预览当前未保存草稿。结果只表示规则判断及下一路径，不代替实际 Jev/轻量模型分类或候选能力校验。

设置页编辑期间如配置被其他页面更新，会保留本地草稿和原始 revision 并提示冲突；可重新加载最新配置，直接保存时仍由宿主版本检查拒绝覆盖他人的更新。

对应的 YAML：

```yaml
task-models:
  routing:
    enabled: true
    fallback: taskRole          # taskRole | llm
    useJev: true
    respectExplicitChildModel: true
    decisionTimeoutMs: 5000      # 分类链 + 候选能力校验的总预算
    classifier:                 # fallback=llm 时使用；留空表示不用
      provider: ai-proxy
      model: deepseek-v4-flash
      reasoningEffort: low
  profiles:
    - id: review
      name: 审查与复核
      detail: 代码审查、正确性检查、安全与质量复核。
      keywords: [审查, review, audit]
      provider: ai-proxy
      model: deepseek-v4
      reasoningEffort: high
      enabled: true
  jev:
    enabled: false
    baseURL: https://api.typesafe.ai
    model: jev-latest
    minConfidence: 0.6
    timeoutMs: 3000
    maxStateChars: 8000
```

任务类型 ID 会转为小写，必须匹配 `[a-z][a-z0-9_-]*`，且不能与 `default`、`task`、`general` 重名。内置类型没有配置模型时不参与匹配；清空模型即禁用该类型。

## 决策顺序

```text
子任务首次请求：
  1. label 命中任务类型 ID / 关键词（规则）
  2. 规则未命中且启用 Jev → Jev choice
  3. 仍未命中且 fallback=llm → 轻量分类模型
  4. 仍未命中 → 保持当前路由
```

- 精确 label（`review`）或显式前缀（`[review]`、`review:`）优先于所有关键词分数；禁用类型不参与匹配。
- 没有显式类型时，关键词命中 label 计 3 分、仅命中任务内容计 1 分，每个关键词只计一次。纯 ASCII 字母/数字/下划线关键词采用 Unicode 字母、数字和下划线边界：`read` 不会命中 `Thread`、`reading`、`my_read`；中文关键词仍使用包含匹配。
- 规则并列（tie）不会按配置顺序随机选择，而是交给 Jev/轻量模型/回退。
- 其他子系统通过 `modelRole` 标记的内部子代理、计划模式、非子代理会话都会旁路。
- 子任务如果显式选择了与父级当前路由不同的模型，默认跳过任务类型路由，避免无声覆盖
  （`respectExplicitChildModel`）。显式选择恰好等于父级基线时无法检测，见“已知限制”。
- 第二次及后续请求只重放已通过校验并采用的路由；校验失败、无匹配或总预算耗尽的子代理继续保持当前路由，不重复分类或误用失败候选。
- Jev 的 `confidence` 必须为 `[0,1]` 内的有限数值且达到阈值。**兼容性变化**：旧接口省略 confidence、返回数字字符串或越界数值时不再采用该选择，转入既定回退链。
- 轻量分类必须正常结束；带有部分类型文本的失败/取消响应不能被当作有效选择。

## 与 Agent Preset 无关

本插件不读取、不要求、也不依赖任何 Agent Preset（标准模式、无 Preset 或任何自定义模式下的
行为一致），不注册 Preset，也不修改会话的 Preset。它只依据“是否为子代理”和自身设置决定是否
路由；主会话模型始终不被改写。

## Jev 与密钥

- 设置页只保留一个 **API Key** 输入框；保存后写入本机固定路径
  `~/.dsh/task-models/typesafe.key`（文件 `0600`，目录 `0700`），不写入 profile patch。
- 不再读取环境变量或外部密钥文件配置；未保存 Key 时 `jevStatus` 显示未配置。
- `jevStatus` 只返回“是否已配置”和模型名，不返回 Key 或掩码。
- 启用 Jev 后，规则未命中时会把父任务、子任务 label/prompt（截断到 `maxStateChars`）发送到
  TypeSafe；图片不会发送。敏感任务请关闭 Jev 或改用仅规则/轻量分类。
- Jev 调用受 `jev.timeoutMs` 与剩余决策总预算共同限制；首次请求的插件分类/能力校验等待由 `routing.decisionTimeoutMs` 约束。Jev 失败只告警一次，不阻止既定回退。
- 规则试运行不会调用 Jev/轻量模型，也不会发送输入到 TypeSafe；保存草稿和试运行是两个独立操作。

## 工作流成员模型标注

本插件还会增强聊天中的 **workflow 运行卡片**：开启后，每个成员行会显示该成员实际使用的模型
（例如 `claude-opus-4-6`），并在悬停时显示 `provider/model` 与思考档位。

实现方式：

- Host 端通过公开的 `request/header` 会话事件记录子代理**请求头已确认**的 provider/model/effort，覆盖本插件路由、其他角色路由以及显式子代理模型；这不等于 Provider 已成功响应。
- 路由解释区分 `selectedRoute`（本插件选中的候选，`status=adopted` 才表示已通过能力校验；不可用候选会明确标记原因）与 `effectiveRoute`（请求头确认值）。尚未确认请求头时不把预选模型当成实际模型。
- 对插件升级/重启前已存在的 workflow，Host 会尽力从 `~/.dsh/sessions/**/<childId>/session.v4.jsonl(.zstd)`
  的 `request/header` 回溯该成员的最终模型；读不到日志时静默留空，不影响运行。
- Client 端以 `priority: -1` 覆盖宿主的 `workflow-run` 渲染器（DSH 支持的 keyed slot 阴影机制），
  保留运行/阶段状态、展开收起与运行中成员跳转，只额外加入模型徽标。
- 模型和解释通过本插件自己的 `/task-models-settings` RPC 的 `routingDetails` 方法读取；运行中面板每 2 秒刷新一次，请求头确认后即可显示徽标。旧 `childModels` 方法保留其兼容返回格式。
- 悬停或通过辅助技术读取徽标，可查看类别、决策来源、有效置信度、耗时和稳定的回退原因。旧会话只有模型记录时显示“原因未知”，不反推猜测。
- 未知模型且成员仍在运行时显示“模型…”；已完成但未知则不显示，避免猜测。
- 决策解释仅保存在有界内存缓存（最多 2000 个子代理摘要），不会把完整任务文本或 Key 写入缓存/新日志；插件重载后历史模型可回溯，历史决策原因可能未知。

> 该增强依赖宿主 `conversation.chat.node` 的 keyed slot 与 `workflow-run` 节点数据。若未来 DSH
> 改动该 UI，可能需要跟随升级；禁用/卸载本插件会立即恢复宿主原生 workflow 卡片。

## 与 DSH 的边界

- 不 patch `ctx.subagents.start`；只在公开的 `agent/pre-step` / `agent/request` 上工作。
- 不新增子代理工具，不修改 `subagent` / `workflow` 的工具 schema。
- 不处理 ACP / Codex / Claude Code 等外部进程子代理的模型选择；这些由各自外部进程决定。
- 主任务自动分类、识图委派、顾问复核不在本插件职责内；由宿主或相应插件负责。本插件只处理
  子任务模型映射。
- 已采用路由的子代理在修改模型/档位、禁用或删除任务类型后仍保持原路由；新子代理使用新设置。**总路由开关是例外**：关闭后立即停止覆盖，重新开启后旧子代理恢复原已采用路由；内部角色与计划模式旁路始终优先。若首次分类尚未结束就关闭路由/进入旁路，该候选不会被正式采用，重开也不会突然启用它。
- 以上决策冻结为进程内状态；插件重载/进程重启后，本插件不会重新分类已经有请求头的会话，交由宿主恢复原有请求路由。
- 显式选择恰好等于父级当前路由时无法检测，可能被任务类型路由覆盖。
- 宿主 `subagentModelSelection` 的 allowedModels 不会在本插件路由层再次强制；需要严格白名单时
  请关闭本插件的任务路由或 `respectExplicitChildModel` 不能覆盖的部分改由宿主控制。

## 开发与测试

```bash
cd plugins/dsh-task-models
npm test          # core + routing + rpc + integration + package + 宿主设置门禁
npm pack --dry-run
```

测试覆盖：配置默认值与超时预算校验、显式 label 优先、英文词边界/中文包含匹配、tie 回退、严格 Jev confidence、自定义 Jev HTTP 端点、轻量分类、取消重试、挂起分类器与能力校验超时、不可用候选不重放、热更新行为矩阵、并发决策复用、显式 route 跳过、主会话/内部角色/计划模式旁路、规则试运行 RPC、预选与请求头确认模型区分，以及客户端交互与草稿 revision 冲突保护。

请求链集成测试使用真实 Cordis waterfall 与 LLM Runtime、内存 Adapter 和请求头事件，不访问外部模型；网络测试仅用 loopback HTTP 与隔离临时目录。宿主设置门禁在隔离临时环境挂载 Config，不安装到真实 Profile、不重启服务。

## License

MIT
