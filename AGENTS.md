# 开发规范

## 【最高优先级】禁止擅自在本机部署插件与重启服务

**严禁在修改插件代码后擅自执行部署（如 `dsh plugin add`）或重启本机服务（如 `scripts/dsh-web.cmd restart` / `scripts/dsh-web.ps1 restart`）。**

- **仅当用户的明确指令中明确要求安装/部署到本机或重启服务验证时**，才允许执行部署和重启操作。
- 在日常开发、修复 bug、功能实现或重构中，默认只在插件目录内完成代码修改、编译打包（如 `npm test`、`node build.mjs`、`npm pack`）和测试用例验证，不得擅自触碰本机 DSH 运行环境及 Profile。

## 【最高优先级】禁止擅自重启本地 DSH 服务

**`scripts/dsh-web.sh restart` / `scripts/dsh-web.ps1 restart` / `scripts/dsh-web.cmd restart`，
以及 `dsh web` 的 start / stop，都算「重启本地服务」。未经用户当轮明确指令，一律禁止执行。**

这条与上面的「禁止擅自部署」并列、单独成节：重启的破坏面比装包大得多，而在实践中它反而更容易
被顺手带出来——因为「装完要重启才生效」写在同一段流程里，装包一旦获准，重启就跟着被默认成了
同一步。

### 为什么它是独立的红线

- **重启会掐断正在跑的会话。** `restart` 先 `kill` 再拉起新进程，用户手上正在跑的回合、
  正在写的文件、内存里尚未落盘的状态一起中断。他可能正因为这次重启丢掉一段长任务的上下文。
- **它不可回滚，也不能靠重试兜底。** `kill` 发出去了就收不回来。工具调用若在「kill 之后、
  新进程起来之前」被打断（超时、取消、会话中断），服务会停在已停未起的空窗期，用户看到的是
  页面 502——而这次重启本来就不该发生。
- **真实事故（2026-10-25 ~ 10-26，排查 `dsh-theme-studio` 极光主题）**：为「验证改动生效」，
  连续多轮在用户没有要求的情况下执行 `./scripts/dsh-web.sh restart`。其中两次工具调用恰好在
  kill 与 start 之间被打断、结果未知，只能靠事后 `status` 反查进程号才确认服务还活着。
  每一次「顺手重启一下」都在赌用户此刻没有正在跑的任务，这个赌不该由 Agent 来下。

### 允许的唯一例外

用户**当轮直接指令**明确要求时，例如「部署到本地验证」「重启服务看看」。

- 授权只覆盖**这一轮**，不延续到后续轮次。
- 「他之前同意过一次」不构成这次的授权。
- 评价类回复（「可以了」「继续」「提交」）是对已完成工作的确认，**不是**对下一个破坏性动作的许可。

### 正确做法

- 改完代码，工作止步于 `npm test` / `npm run build` / `npm pack`（以及必须时的 `dsh plugin add`，
  那同样需要用户当轮明确指令）。
- 需要让改动生效时，**先问**：「是否现在部署到本地 profile 并重启服务？」拿到明确答复再动手。
- 只读观测不受限制：`scripts/dsh-web.sh status`、`dsh plugin --profile web list`、读日志、
  `curl` 探测都可以随时做——但 `status` 是观测手段，不能当「既然停着/既然在跑，就顺手重启」的前置步骤。

## 部署/安装插件到本地 DSH Profile：必须走 `dsh plugin add`

**禁止**手动把源码文件（`lib/client.js`、`lib/index.js` 等）直接复制/覆盖到
`~/.dsh/profiles/<profile>/node_modules/<plugin>/` 下调试。

原因（真实事故）：2026-08-20 排查 `dsh-file-viewer` 的 “Failed to load
plugins” 报错时发现，部署目录下的 `lib/client.js` 只是仓库源文件的前
50427/75727 字节，在 `useState(false);` 处被硬生生截断——多半是编辑器/复制
命令中途被打断。文件语法不完整，浏览器解析整个 `<script>` 失败，导致文件顶部
的 `window.__ModuleLoader__.load(...)` 调用完全没有执行到，表现为宿主报错
`bundle ... loaded without registering "<id>" via __ModuleLoader__.load`。
这类问题只有对着两份文件做字节级 diff 才能定位，排查成本很高，而且没有任何
机制（版本号、lockfile、哈希）能提前发现文件被改动过。

正确流程（**仅在用户明确指令要求在本机部署/验证时执行**）：

```bash
# 1. 跑该插件的单元测试
cd plugins/<plugin>
npm test          # 或仓库根目录: pnpm --filter <plugin> test

# 2. 重新打包（生成全新 .tgz，绝不手改 node_modules 里的文件）
npm pack

# 3. 通过官方 CLI 安装/更新到目标 profile
dsh plugin --profile web add ./plugins/<plugin>/<plugin>-<version>.tgz

# 4. 重启服务生效（Windows 下使用 scripts/dsh-web.cmd 或 scripts/dsh-web.ps1，见下文）
```

- `dsh plugin add` 会走 pnpm 完整安装链路，`package.json`/`pnpm-lock.yaml`
  里的 `file:` 依赖会被正确解析、写入、校验，不会出现半个文件的情况。
- 如果只是改了未发布的本地版本号（如 0.1.0 → 0.1.1），同样要重新 `npm pack`
  再 `dsh plugin add` 覆盖安装，不能只把新文件拷进旧安装目录。
- 排查“插件加载失败/报错”类问题时，第一步应确认部署目录下的文件是否与仓库
  源码字节级一致（`diff`/`cmp`），而不是先假设代码逻辑有问题。

## 【最高优先级】桌面版兼容：全屏面板必须避让 Windows 原生标题栏

**任何"从窗口顶边开始"的全屏/贴边浮层（抽屉、全屏面板、吸顶工具栏），在 Windows 桌面版上
必须从原生标题栏按钮（最小化 / 最大化 / 关闭）下方开始，且不得被其遮挡或覆盖。**

Windows 桌面版用 `titleBarOverlay` 把那排原生按钮画在窗口顶部 40px 条带里，**且永远盖在
页面之上**。宿主的 `shell.overlay` 这类 seat 按 frame 的 padding box 铺满整个窗口，
所以一个从 `top:0` 开始的面板，头部控件会正好落在那排按钮下面——点不到，也看不见。
用户看到的就是"插件工具栏和桌面版工具栏重叠"。

### 必须遵守的四条规则

1. **用宿主标记定位，不要用 UA 或窗口尺寸猜平台。**
   宿主在 `<html>` 上写 `data-windows-titlebar`，并把条带高度发布为
   `--dsh-windows-titlebar-height`（默认 40px，按 DPI 换算）。写死 `40px` 在
   125%/150% 缩放下会错位——像 `dsh-theme-studio` 那样始终读宿主变量。

2. **偏移必须写 `!important`，且选择器特异性不能低于它所对抗的规则。**
   真实事故（2026-10-23，`dsh-file-viewer` v0.2.8 → v0.3.17）：v0.2.8 已加过
   `html[data-windows-titlebar]:not([data-fullscreen]) .fv-scrim{top:var(...)}`，
   之后 v0.3.6 为对抗 `dsh-mobile-adapter` 的"居中卡片化"新增
   `.fv-scrim[role="dialog"]{inset:0!important;...}`。`inset` 简写展开出的
   `top:0` 本身带 `!important`，**层叠上直接压掉那条普通 `top`**——抽屉重新滑回
   标题栏下面，而两条规则在源码里看起来都正确无误。
   修复后的写法：

   ```css
   html[data-windows-titlebar]:not([data-fullscreen]) .fv-scrim[role="dialog"]{
     top:var(--dsh-windows-titlebar-height,40px)!important
   }
   ```

   同一元素上若同时存在"用 `!important` 声明 `inset`/`top`"的规则，**必须逐个比对
   选择器特异性**，否则修复会在无声无息中失效。

3. **全屏时偏移必须消失。** 宿主进全屏后会写 `data-fullscreen`，条带随之隐藏，
   不撤销偏移就会在面板顶部留一条点不到的死区。用
   `:not([data-fullscreen])` 收口，别用 JS 判断窗口状态。

4. **macOS 是另一套几何，不要混用。** macOS 桌面版没有这排按钮，宿主改用
   `html[data-platform="darwin"]` 与 `--dsh-frame-top-clearance`（48px）。需要让位的
   浮层应优先消费 `--dsh-frame-overlay-top`（宿主已按平台和全屏状态算好，含弹窗/菜单
   额外 20px），而不是自己拼一套平台判断。

### 验证要求（缺一不可）

- **不能只断言"规则文本存在"。** 必须断言它**能赢过层叠**：规则带 `!important`、
  选择器特异性不低于对抗规则。`dsh-file-viewer` 的守卫测试是范例——
  `test/package.test.mjs` 中 "the drawer clears the Windows caption strip…" 与
  "no new important declaration may quietly outrank the caption-strip offset"
  两条，前者锁死偏移本身，后者把"新出现的、会设置抽屉垂直几何的 `!important` 规则"
  列为必须人工复核的白名单，防止下一次有人加 `inset:0!important` 时再次悄悄覆盖它。
- **新增/改动任何 `!important` 规则前，先在桌面版上确认最终几何**，不要只跑单测就认为
  兼容。本轮用户报告"原来修好了现在又出现"，正是因为测试只看规则在不在。
- 涉及平台差异的改动，README 需写明三端行为（Web / Windows 桌面版 / 全屏）。

## Windows 环境不能用 `dsh service restart`

所有插件 README 里写的 `dsh service restart` 依赖宿主打包好的 systemd/launchd 单元。
**`@deepseek-ai/dsh` CLI 本身没有 `service` 子命令**——`dsh --help` 只列出根命令、
`web`、`plugin` 三个命令——在没有那层封装的环境（包括本机的 Windows + Git Bash）
执行会直接报 `error: too many arguments. Expected 0 arguments but got 2: service,
restart.`。

Windows 下使用统一控制脚本 `scripts/dsh-web.cmd`（或 `scripts/dsh-web.ps1`），支持 `start` / `stop` / `restart` / `status` 四个子命令：

```powershell
# 检查运行状态与端口
.\scripts\dsh-web.ps1 status
# 或 cmd:
scripts\dsh-web.cmd status

# 重启 dsh web 服务
.\scripts\dsh-web.ps1 restart
# 或 cmd:
scripts\dsh-web.cmd restart

# 启动 / 停止
.\scripts\dsh-web.ps1 start
.\scripts\dsh-web.ps1 stop
```

脚本原理：查找当前运行中包含 `@deepseek-ai\dsh` 或 `dsh\lib\bin.js` 的 `node.exe` 进程，停止旧进程，并使用 `dsh.cmd web` 在后台拉起新实例，同时显示监听端口。

**改完任何插件源码、且用户明确要求让本机运行中的 DSH 服务生效时，必须先按上面「走
`dsh plugin add`」的流程重新安装，再执行这个重启脚本**——两步缺一都会导致
运行中的服务和仓库源码不一致。
