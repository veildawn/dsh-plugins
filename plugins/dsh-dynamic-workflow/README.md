# dsh-dynamic-workflow — 动态编排可视化与已保存 workflow

把 DSH `workflow` 工具的每次运行画成一张实时编排图，并提供与 ZCode `/workflow` 对齐的「保存 / 重新启动」能力。

> 实现依据：用 REA 静态分析 ZCode 3.17.2 的 `app.asar`（`out/host/index.js`、`chunk-D5C6W4UB.js`），得到：
> - `workflows/list|get|save|delete|move|runs|forRun` RPC，保存范围 `project` / `global`；
> - `workflowLaunch` 回合来源（脚本 ≤ 256 000 字符、args JSON ≤ 4096 字节、description ≤ 500）；
> - 编排图 `causalityGraph`：phase 作泳道、agent 作节点、`phaseEdges` 连接各阶段。

## 功能

- **浮动编排卡片**：挂在输入框上方的 `conversation.input.dock`（order -5），采用不透光实体表面杜绝玻璃/极光等半透明主题下聊天文本透底叠字。本会话开始运行 `workflow` 即浮出：头部左侧展示路由图标、`工作流运行中 / 工作流已完成` 动态渐变标题与脚本名称，右侧汇总 `N 个阶段 · M 个子代理工作中 · 模型名` 及当前阶段定位（偏离活动阶段时浮现）、停止（`■` 支持前台与后台 workflow 取消，带即时旋转态反馈）和展开收起（`⤢`）按钮；主体采用**无外框水平阶段时间线（Phase Station Rail）**——绿色完成灯、橙色呼吸运行灯、空心待执行灯、`已收敛/已触发` 分子分母与高对比 2px 阶段连接线（支持鼠标滚轮自动横向滚动与按住拖拽平移，超出视口时左右边缘平滑渐隐并固定 `+N ●—●—●` 折叠阶段灯架，点击圆点或收起态迷你灯轨即可跳转）。宿主对 `workflow` 脚本做静态预解析（含顶层常量与模板字符串清洗），提前渲染后续阶段与条件分支中的待命子代理胶囊及 `>_ 脚本` 胶囊；每个子代理胶囊左侧配备 **20×20 圆角方块动态表情人偶**（9 色色板按角色跨阶段一致着色，随状态自动眨眼、左右扫视、切换专注/思索神态、完成雀跃弹跳、失败摇头叹气、等待三点波浪），右侧带旋转/勾选/告警微图标，点击即可打开该子代理会话。全部成功后先停留约 1.4 秒展示完成神态，再平滑收起并于 6 秒后自动隐藏（悬停或聚焦卡片期间自动暂停收起与隐藏）；有失败时保持展开。
- **消息流去重**：以同一键 `workflow-run`、更高优先级（priority -100）注册 `conversation.chat.node`，把宿主的大卡片替换为带迷你阶段灯轨与叠放表情人偶的一行摘要，点击即零延迟在输入框上方重新展开并高亮工作流卡片。
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
dsh plugin --profile web add ./plugins/dsh-dynamic-workflow/weniatall-dsh-dynamic-workflow-0.1.5.tgz
```

## 三端行为

- **Web / Windows 桌面版 / 全屏**：卡片位于输入区上方的宿主 dock 内，不贴窗口顶边，不涉及标题栏避让。
