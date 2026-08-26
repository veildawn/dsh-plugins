# dsh-model-roles

为 DeepSeek Harness 提供类似 [Oh My Pi（OMP）](https://github.com/can1357/oh-my-pi)
`modelRoles` 的角色模型路由。对话角色接入 DSH 官方 `agent/request`，`tiny` 接入
`llm/stream`，`advisor` 接入 `subagents`、回合停止事件与 steering 收件箱；主会话再通过
`tiny`（未配置时为 `smol`）每回合自动判断任务角色。生效的对话路由会进入 `request/header`，
因此轨迹显示和模型响应来源看到的都是实际使用的模型。

## 支持的角色

| 角色 | 触发条件 | 未配置时 |
| --- | --- | --- |
| `default` | 普通实现任务或自动分类不明确的主会话任务；无需配置 | 始终使用 DSH 会话当前选择的模型 |
| `smol` | 自动分类为短小、机械、低风险的任务；或同名 Agent Preset | 使用会话当前模型 |
| `slow` | 自动分类为复杂推理、疑难调试、架构、研究或高风险正确性任务；或同名 Preset | 使用会话当前模型 |
| `vision` | 图片输入自动委派给一次性识图子代理 | 使用会话当前模型 |
| `plan` | `/plan` 处于开启状态 | 使用会话当前模型 |
| `designer` | 自动分类为 UI、UX、视觉、交互、布局或产品设计；或同名 Preset | 使用会话当前模型 |
| `commit` | 自动分类为提交信息生成或提交专用分析；或同名 Preset | 使用会话当前模型 |
| `tiny` | 主任务自动分类，以及 DSH 会话标题、压缩等后台 LLM 调用 | 回退 `smol`，再使用原请求模型 |
| `task` | DSH 委派创建的子会话 | 使用会话当前模型 |
| `advisor` | 顾问复核运行时创建的独立 DSH 子代理 | 未直接配置时不启动顾问复核 |
| 自定义 Preset 角色 | Agent Preset ID 与角色 ID 完全相同 | 继续按后续规则判断 |

语义上保留 OMP 当前的 10 个模型角色，其中 `default` 由每个 DSH 会话的模型选择器提供，设置页
只配置其余 9 个专用角色。旧设置中的 `default` 映射会被忽略，不能覆盖会话选择。

主请求路由优先级为：插件内部运行时角色 → `plan` → 同名 Agent Preset → `task` 子代理 →
主任务自动分类 → DSH 会话模型。收到图片时，插件会在主请求之前启动一次性
`vision` 子代理：它不能调用工具，最多生成 4096 token，只负责识图、OCR 和提取与任务相关的
事实。完成后图片会从本次主模型输入中移除，识图文字以插件消息带回主会话；主会话随后照常自动
选择普通角色，因此不会因为历史里存在图片而长期占用识图模型。识图子代理失败时，仅当前回合
回退为直接使用 `vision` 模型。

### 自动任务分类

普通主会话进入每个新回合时，插件使用 `tiny` 角色模型把最新用户任务严格分类为
`default`、`smol`、`slow`、`designer` 或 `commit`。同一回合的后续工具循环复用分类结果，不会
重复产生分类调用。如果未配置 `tiny`，则使用直接配置的 `smol`；两者都未配置时跳过分类并使用
当前会话模型。

输入框不提供角色选择器，也不注册 `/model-role` 命令。图片、计划模式、子代理、顾问和同名
Agent Preset 都使用 DSH 原生生命周期与事实，不要求用户手动选角。分类模型失败或输出非法角色
时安全回退到当前会话模型。

### 顾问复核

为 `advisor` 配置模型并开启顾问后，每个主会话回合停止前都会通过 DSH `subagents` 服务启动一个
隔离的顾问子代理。顾问模型使用完整的派生会话记录进行复核；返回 `OK` 时不打扰主会话，返回
实质建议时通过 DSH steering 收件箱送回主代理继续处理。同一回合只复核一次，顾问自身不会递归
创建顾问。

```text
/advisor on       # 当前会话开启
/advisor off      # 当前会话关闭
/advisor status   # 查看状态和模型是否已配置
/advisor          # 切换当前会话状态
```

默认不复核任务子代理；可在设置页启用“同时复核任务子代理”。顾问使用独立模型调用，会产生额外
延迟与费用。

## 安装

```sh
dsh plugin --profile web add ./dsh-model-roles-0.4.8.tgz
dsh service restart
```

`dsh service restart` 依赖宿主打包的 systemd/launchd 单元；**`@deepseek-ai/dsh` CLI 本身没有
`service` 子命令**（`dsh --help` 只列出根命令、`web`、`plugin`），Windows 等没有那层封装的环境执行
会报 `error: too many arguments`。Windows 下改用本仓库的
[`scripts/dsh-service.ps1`](../../scripts/dsh-service.ps1)：

```powershell
powershell -File scripts/dsh-service.ps1 restart -Profile web
```

升级插件时必须先等待所有运行中的会话结束再重启 DSH；重启活跃服务会让尚未关闭的回合以
`interrupted` 结束。仅修改角色设置不需要重启，保存后会从下一次请求即时生效。

插件自带的 Cordis 配置为空映射，安装后不会改变原生行为：

```yaml
- insert:
    - id: model-roles
      name: dsh-model-roles
      config:
        roles: []
        advisor:
          enabled: false
          subagents: false
          provider: spawn
          maxTranscriptChars: 60000
```

打开 **设置 → 模型角色**，为需要的角色选择 Provider、模型和思考档位后保存。角色设置即时
用于下一次请求，不需要重启服务。

也可以直接在 `settings.yaml` 中配置：

```yaml
model-roles:
  roles:
    - role: plan
      provider: ai-proxy
      model: deepseek-v4
      reasoningEffort: high
    - role: vision
      provider: openrouter
      model: google/gemini-3-pro-image-preview
      reasoningEffort: medium
    - role: task
      provider: ai-proxy
      model: deepseek-v4-flash
      reasoningEffort: low
    - role: smol
      provider: ai-proxy
      model: deepseek-v4-flash
      reasoningEffort: low
    - role: slow
      provider: ai-proxy
      model: deepseek-v4
      reasoningEffort: high
    - role: designer
      provider: ai-proxy
      model: deepseek-v4
      reasoningEffort: medium
    - role: commit
      provider: ai-proxy
      model: deepseek-v4-flash
      reasoningEffort: low
    - role: tiny
      provider: ai-proxy
      model: deepseek-v4-flash
      reasoningEffort: low
    - role: advisor
      provider: ai-proxy
      model: deepseek-v4
      reasoningEffort: ''
  advisor:
    enabled: false
    subagents: false
    provider: spawn
    maxTranscriptChars: 60000
```

角色 ID 会转为小写，必须匹配 `[a-z][a-z0-9_-]*`，且不能重复。空
`reasoningEffort` 表示使用目标模型的默认档位。

## 与 DSH 模型选择器的关系

DSH 对话框中的模型选择就是该会话的默认模型，不在模型角色中重复配置。命中已配置的专用角色
时，本插件在请求组装阶段临时覆盖基础路由；没有命中任何配置时完全保留原生选择。修改映射不会
改写历史消息，只影响后续模型请求。

## 与 DSH 的融合边界

- 除 `default` 外的九个 OMP 专用角色可以独立选择模型；`default` 始终来自当前会话；`vision` 通过一次性 DSH 子代理触发，`plan`、`task` 使用 DSH 原生会话事实自动触发，
  `tiny` 接管自动任务分类、DSH 会话标题与压缩 LLM 调用，`advisor` 使用 DSH 子代理和 steering
  通道完成复核。
- `smol`、`slow`、`designer`、`commit` 由轻量模型阅读本回合任务后自动选择；同名 Agent Preset
  可直接确定角色而跳过分类。分类不是关键词猜测，模型只允许返回五个固定角色之一。
- OMP 本身主要由各内部子系统显式请求角色；本插件在对应 DSH 事实之外增加主任务分类，满足 Web
  会话无需手动选角的使用方式。每个普通主会话回合会因此多一次轻量模型调用。
- OMP 的 memory、auto-thinking、unexpected-stop 等后台任务在当前 DSH 中没有一一对应的公共
  `purpose`；插件只路由 DSH 实际存在的 `session-title` 与 `compaction` 辅助调用。
- 顾问复核使用 DSH 一次性子代理，不实现 OMP 专属的 `WATCHDOG.md`/`WATCHDOG.yml` 多顾问编排、
  backlog 和免疫回合策略；这些不是模型角色选择所必需的 DSH 能力。
- 远程 ACP、Codex、Claude Code 子代理由各自外部进程选择模型，不经过本地 DSH Agent 路由。
- `plan` 识别依赖 DSH 公共的 `plan/mode` 会话事件；未安装计划模式插件时它自然不会触发。

## 开发与测试

```sh
npm test
npm pack --dry-run
```

端到端测试使用真实的 Cordis、DSH Settings、Commands、Session、Agent 事件、LLM Runtime 与
Subagent Runtime；只在最外层模型 Provider 使用可观测测试 Adapter。测试会证明 `default` 保留
会话模型、九个专用角色命中各自配置，并覆盖自动任务分类、同回合分类缓存、顾问建议回注以及
`tiny` 标题/压缩路由。提供真实模型映射后，还要在实际 DSH Profile 中逐角色执行联网模型验收。
