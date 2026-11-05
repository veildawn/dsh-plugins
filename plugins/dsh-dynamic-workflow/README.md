# dsh-dynamic-workflow — 动态编排可视化与已保存 workflow

把 DSH `workflow` 工具的每次运行画成一张实时编排图，并提供与 ZCode `/workflow` 对齐的「保存 / 重新启动」能力。

> 实现依据：用 REA 静态分析 ZCode 3.17.2 的 `app.asar`（`out/host/index.js`、`chunk-D5C6W4UB.js`），得到：
> - `workflows/list|get|save|delete|move|runs|forRun` RPC，保存范围 `project` / `global`；
> - `workflowLaunch` 回合来源（脚本 ≤ 256 000 字符、args JSON ≤ 4096 字节、description ≤ 500）；
> - 编排图 `causalityGraph`：phase 作泳道、agent 作节点、`phaseEdges` 连接各阶段。

## 功能

- **浮动编排卡片**：挂在输入框上方的 `conversation.input.dock`（order -5）。本会话开始运行 `workflow` 即浮出：头部显示名称、状态、`完成数/总数 个 agent`、当前阶段与耗时，下方进度条；展开后是 phase 泳道与 agent 节点，每个节点显示所用模型（子会话实际模型；尚未上报时显示阶段声明的模型并标「计划」）。点击节点打开该 agent 会话。全部成功后先收起、6 秒后自动隐藏；有失败时保持展开。
- **消息流去重**：以同一键 `workflow-run`、更高优先级（priority -100）注册 `conversation.chat.node`，把宿主的大卡片替换为一行摘要，点击即在输入框上方重新展开编排卡片。
- **性能**：卡片只长轮询本会话的 `dock` 接口，宿主仅在本会话最新运行变化时应答，并在同一次应答里带回精简数据（不含脚本、参数、日志）。
- **运行记录**：保存到 `$DSH_HOME/dynamic-workflow/runs`，最多 200 条；重启时仍在运行的记录标为「已中断」。
- **`/workflow` 命令**：

  ```text
  /workflow                       # 列出已保存的 workflow
  /workflow review                # 启动已保存的 review
  /workflow 审查项目问题           # 没有同名保存项时，让模型为该任务编排并运行一个 workflow
  /workflow review --global {"path":"src"}
  ```

  名称支持中文。命中已保存 workflow 时，插件追加一个用户回合要求模型原样调用一次 `workflow` 工具，参数按键覆盖保存时的默认值；未命中时，整段输入作为任务描述，要求模型声明 `meta.phases` 并编排运行。

## 结构

| 文件 | 作用 |
| --- | --- |
| `lib/index.js` | 宿主行：订阅事件，提供 `/dsh-dynamic-workflow` RPC（trusted-host），注册 `/workflow` |
| `lib/store.js` | 运行记录与编排图（泳道、节点、边） |
| `lib/library.js` | 已保存 workflow 的读写、启动提示词和命令参数解析 |
| `lib/language.js` / `lib/messages.js` | DSH 语言解析与宿主侧中英文案 |
| `lib/client.js` | 输入框上方的浮动编排卡片（`conversation.input.dock`） |

## 安装

```bash
cd plugins/dsh-dynamic-workflow && npm test && npm pack
dsh plugin --profile web add ./plugins/dsh-dynamic-workflow/weniatall-dsh-dynamic-workflow-0.1.3.tgz
```

## 三端行为

- **Web / Windows 桌面版 / 全屏**：卡片位于输入区上方的宿主 dock 内，不贴窗口顶边，不涉及标题栏避让。
