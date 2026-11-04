# dsh-dynamic-workflow — 动态编排可视化与已保存 workflow

把 DSH `workflow` 工具的每次运行画成一张实时编排图，并提供与 ZCode `/workflow` 对齐的「保存 / 重新启动」能力。

> 实现依据：用 REA 静态分析 ZCode 3.17.2 的 `app.asar`（`out/host/index.js`、`chunk-D5C6W4UB.js`），得到：
> - `workflows/list|get|save|delete|move|runs|forRun` RPC，保存范围 `project` / `global`；
> - `workflowLaunch` 回合来源（脚本 ≤ 256 000 字符、args JSON ≤ 4096 字节、description ≤ 500）；
> - 编排图 `causalityGraph`：phase 作泳道、agent 作节点、`phaseEdges` 连接各阶段。

## 功能

- **编排图面板**：对话区「对话 / 轨迹」右侧新增「编排 / Workflows」视图页签。每个 phase 是一条泳道，泳道之间用箭头连接，每次 `agent()` 调用是一张节点卡片（序号、标签、状态、耗时）。数据来自引擎的 `workflow/*` 事件和会话的 `tool-workflow/*` 记录，面板通过长轮询 `watch` 实时刷新。
- **运行记录**：保存到 `$DSH_HOME/dynamic-workflow/runs`，最多 200 条。重启时仍为「运行中」的记录会标为「已中断」。
- **保存 workflow**：在运行详情里点「保存到项目」或「保存为全局」：
  - 项目：`<工作区>/.dsh/workflows/<name>.json`
  - 全局：`$DSH_HOME/dynamic-workflow/workflows/<name>.json`

  同名时项目覆盖全局。
- **重新启动**：可以在面板的「已保存」页签填写 JSON 参数后点「启动」，也可以输入：

  ```text
  /workflow                       # 列出已保存的 workflow
  /workflow review                # 启动
  /workflow review --global {"path":"src"}
  ```

  启动时插件会向当前会话追加一个用户回合，要求模型原样调用一次 `workflow` 工具。参数会按键覆盖保存时的默认值。

## 结构

| 文件 | 作用 |
| --- | --- |
| `lib/index.js` | 宿主行：订阅事件，提供 `/dsh-dynamic-workflow` RPC（trusted-host），注册 `/workflow` |
| `lib/store.js` | 运行记录与编排图（泳道、节点、边） |
| `lib/library.js` | 已保存 workflow 的读写、启动提示词和命令参数解析 |
| `lib/client.js` | Web 面板（`conversation.view`） |

## 安装

```bash
cd plugins/dsh-dynamic-workflow && npm test && npm pack
dsh plugin --profile web add ./plugins/dsh-dynamic-workflow/weniatall-dsh-dynamic-workflow-0.1.0.tgz
```

## 三端行为

- **Web**：面板占用对话视图，不建全屏浮层。
- **Windows 桌面版 / 全屏**：同样是对话视图，由宿主负责避让标题栏，插件不涉及顶边几何。
