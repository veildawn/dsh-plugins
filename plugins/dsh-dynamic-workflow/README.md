# dsh-dynamic-workflow — 动态编排可视化与已保存 workflow

把 DSH `workflow` 工具的每次运行画成一张实时编排图，并提供与 ZCode `/workflow` 对齐的「保存 / 重新启动」能力。

> 实现依据：用 REA 静态分析 ZCode 3.17.2 的 `app.asar`（`out/host/index.js`、`chunk-D5C6W4UB.js`），得到：
> - `workflows/list|get|save|delete|move|runs|forRun` RPC，保存范围 `project` / `global`；
> - `workflowLaunch` 回合来源（脚本 ≤ 256 000 字符、args JSON ≤ 4096 字节、description ≤ 500）；
> - 编排图 `causalityGraph`：phase 作泳道、agent 作节点、`phaseEdges` 连接各阶段。

## 功能

- **浮动编排卡片**：和宿主的任务列表一样，挂在输入框上方的 `conversation.input.dock`（order -5，位于任务列表之上、dsh-spec 计划之下）。本会话一开始运行 `workflow` 就自动浮出：头部显示名称、状态、`完成数/总数 个 agent`、当前阶段与耗时，可折叠；展开后是 phase 泳道（左→右、箭头相连）与 agent 节点卡（状态、耗时，运行中闪动）。运行结束后卡片保留，可「保存到项目 / 保存为全局」或 × 关闭；新的运行会重新浮出。头部下方有一条进度条；点击带子会话的节点可直接打开该 agent 的会话；全部成功后卡片自动收起为一行，出现失败时保持展开。数据通过长轮询 `watch` 实时刷新。
- **跟随 DSH 语言**：卡片文案跟随宿主 locale（设置 → 通用 → 语言，切换即时生效）；`/workflow` 的回复、命令说明以及发给模型的提示词按 profile 的 `locale.preference` → 系统语言判断，中文环境下要求模型用中文命名阶段和 agent、用中文总结。
- **运行记录**：保存到 `$DSH_HOME/dynamic-workflow/runs`，最多 200 条。重启时仍为「运行中」的记录会标为「已中断」。
- **保存 workflow**：在运行详情里点「保存到项目」或「保存为全局」：
  - 项目：`<工作区>/.dsh/workflows/<name>.json`
  - 全局：`$DSH_HOME/dynamic-workflow/workflows/<name>.json`

  同名时项目覆盖全局。
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
dsh plugin --profile web add ./plugins/dsh-dynamic-workflow/weniatall-dsh-dynamic-workflow-0.1.2.tgz
```

## 三端行为

- **Web / Windows 桌面版 / 全屏**：卡片位于输入区上方的宿主 dock 内，不贴窗口顶边，不涉及标题栏避让。
