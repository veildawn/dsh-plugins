# dsh-task-models

DeepSeek Harness (DSH) 独立插件：**在设置里为不同类型的子任务配置不同模型**，并可选地让
TypeSafe Jev（System One 决策模型）参与“这个子任务属于哪一类 / 该用哪个模型”的判断。

本插件不依赖任何 Agent Preset 或角色路由插件；只要安装并启用，就会对当前会话委派出的子代理
（`subagent`、`workflow` 的 `agent()`、以及它们派生的孙代理）生效。主会话自身的模型选择不会
被改写。

## 特性

- **按任务类型路由**：内置 `explore`、`implement`、`review`、`test`、`research`、`docs` 六类，
  可添加任意自定义类型；每类独立选择 Provider、模型和思考档位。
- **规则优先**：子任务 label（如 `[review]`）或关键词命中时直接路由，零额外模型调用。
- **可选 Jev**：规则未命中时，把截断后的父任务/子任务文本发给 Jev，让它在已配置任务类型 +
  `general` 中选一个；Jev 只返回任务类型 id，不会发明模型或 Provider。
- **可选轻量分类**：不想用 Jev 时，可配置一个轻量模型作为回退分类器。
- **按子代理决策一次**：首次请求决定后缓存，后续请求沿用同一模型，不会在工具循环中来回切换。
- **安全回退**：Jev 不可用、超时、低置信度、输出非法，或分类器未配置时，保持当前路由。
- **可观测**：设置页提供 Jev 状态、API Key 保存和测试按钮；密钥只写本地文件，不回显。
- **独立设置命名空间**：`task-models`，通过专用 Connection RPC 读写，不依赖宿主设置 allowlist。

## 安装

本插件发布到 npm scope `@weniatall/`，GitHub tag 仍是无 scope 短名
（`dsh-task-models@v0.2.0`），因此两种安装方式都可用：

```bash
# 推荐：走 npm registry（自动跟随最新版）
dsh plugin --profile web add @weniatall/dsh-task-models

# 或从 GitHub Release 安装固定版本的 tarball
dsh plugin --profile web add https://github.com/veildawn/dsh-plugins/releases/download/dsh-task-models@v0.2.0/dsh-task-models-0.2.0.tgz
```

或在仓库内打包安装：

```bash
cd plugins/dsh-task-models
npm test
npm pack
dsh plugin --profile web add ./dsh-task-models-0.2.0.tgz
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
4. 可选启用 Jev，填写 API Key（或留空使用环境变量/密钥文件）、Base URL、模型和阈值。

对应的 YAML：

```yaml
task-models:
  routing:
    enabled: true
    fallback: taskRole          # taskRole | llm
    useJev: true
    respectExplicitChildModel: true
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

- 规则并列（tie）不会按配置顺序随机选择，而是交给 Jev/轻量模型/回退。
- 其他子系统通过 `modelRole` 标记的内部子代理、计划模式、非子代理会话都会旁路。
- 子任务如果显式选择了与父级当前路由不同的模型，默认跳过任务类型路由，避免无声覆盖
  （`respectExplicitChildModel`）。显式选择恰好等于父级基线时无法检测，见“已知限制”。
- 第二次及后续请求会重放缓存的任务类型路由；不会退回父级/当前模型。

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
- 首次子任务请求最多增加 `timeoutMs` 的等待；Jev 失败只告警一次，不阻塞子任务。

## 工作流成员模型标注

本插件还会增强聊天中的 **workflow 运行卡片**：开启后，每个成员行会显示该成员实际使用的模型
（例如 `claude-opus-4-6`），并在悬停时显示 `provider/model` 与思考档位。

实现方式：

- Host 端在每次子代理 `agent/request` 后记录其**最终生效**的 provider/model/effort，覆盖本插件
  路由、其他角色路由以及显式子代理模型三种来源。
- 对插件升级/重启前已存在的 workflow，Host 会尽力从 `~/.dsh/sessions/**/<childId>/session.v4.jsonl(.zstd)`
  的 `request/header` 回溯该成员的最终模型；读不到日志时静默留空，不影响运行。
- Client 端以 `priority: -1` 覆盖宿主的 `workflow-run` 渲染器（DSH 支持的 keyed slot 阴影机制），
  保留运行/阶段状态、展开收起与运行中成员跳转，只额外加入模型徽标。
- 模型信息通过本插件自己的 `/task-models-settings` RPC 的 `childModels` 方法读取；面板每 2 秒
  刷新一次，子代理首次请求完成后徽标即出现。
- 未知模型且成员仍在运行时显示“模型…”；已完成但未知则不显示，避免猜测。

> 该增强依赖宿主 `conversation.chat.node` 的 keyed slot 与 `workflow-run` 节点数据。若未来 DSH
> 改动该 UI，可能需要跟随升级；禁用/卸载本插件会立即恢复宿主原生 workflow 卡片。

## 与 DSH 的边界

- 不 patch `ctx.subagents.start`；只在公开的 `agent/pre-step` / `agent/request` 上工作。
- 不新增子代理工具，不修改 `subagent` / `workflow` 的工具 schema。
- 不处理 ACP / Codex / Claude Code 等外部进程子代理的模型选择；这些由各自外部进程决定。
- 主任务自动分类、识图委派、顾问复核不在本插件职责内；由宿主或相应插件负责。本插件只处理
  子任务模型映射。
- 已运行的子代理在设置修改后保持原路由；新子代理使用新设置。
- 显式选择恰好等于父级当前路由时无法检测，可能被任务类型路由覆盖。
- 宿主 `subagentModelSelection` 的 allowedModels 不会在本插件路由层再次强制；需要严格白名单时
  请关闭本插件的任务路由或 `respectExplicitChildModel` 不能覆盖的部分改由宿主控制。

## 开发与测试

```bash
cd plugins/dsh-task-models
npm test          # core + routing + package + 宿主设置门禁
npm pack --dry-run
```

测试覆盖：配置默认值与校验、关键词/label 规则、tie 回退、Jev choice 解析、自定义 Jev HTTP
端点、低置信度回退、轻量分类、显式 route 跳过、主会话/内部子代理旁路、设置 RPC 和客户端
bundle 渲染。

## License

MIT
