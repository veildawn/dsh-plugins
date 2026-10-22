# dsh-plugins (DeepSeek Harness Community Plugins)

官方 DeepSeek Harness (DSH) 社区插件 Monorepo 工作区。每个插件**独立版本管理、独立测试、按需独立发布 Release**。

---

## 📦 插件列表 (Plugins Roster)

| 插件名称 | 目录 | 说明 | 最新独立版本 |
| :--- | :--- | :--- | :--- |
| **`dsh-plugin-manager`** | [`plugins/dsh-plugin-manager`](plugins/dsh-plugin-manager) | 插件管理中心与自有插件更新/卸载管理器（专属拼图图标、移动端全量响应式触控适配、自有插件一键批量更新(N)、支持配置 GitHub Token 提升 API 配额至 5000次/小时并提供 Atom feed 无感兜底、社区21分类、静默直接复制指令、剪贴板写入全路径兜底、异步平滑重启与自动恢复、桌面端宿主版本识别穿透 asar 归档、修复卸载插件时误用无 scope 短名导致 pnpm remove 报错、tarball 安装统一采用 pnpm alias 确保 scoped 命名、自动识别并一键清理新旧短名双份冲突、修复插件更新后因 name mismatch 导致的 cordis.patch.yml 配置被跳过丢失问题、新版本检查全面基于 npm registry 真实版本数据、自有插件目录新增中文标题与描述登记、已废弃插件仅允许卸载并在列表中标注） | [`v0.3.60`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-plugin-manager@v0.3.60) |
| **`dsh-model-roles`** | [`plugins/dsh-model-roles`](plugins/dsh-model-roles) | 模型角色路由、自动分工、识图子代理、计划模式与顾问复核 (`/advisor`、局域网访问放行、专属分支路由图标) | [`v0.4.32`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-model-roles@v0.4.32) |
| **`dsh-remote-control`** | [`plugins/dsh-remote-control`](plugins/dsh-remote-control) | 通用 DSH 远程/局域网访问安全控制与特权通道插件（Token 密钥认证、密码锁屏门禁 Unlock Screen、特权 RPC 白名单桥接、HTTP 非安全上下文全局兼容、专属地球网络图标、桌面端/Web版局域网地址自识别与端口展示、卡片化设置面板与访问地址一键复制、修复启用远程访问开关点击后不生效、局域网绑定改用具体网卡 IP 以适配 DSH 0.2.x 拒绝通配地址、修复端口行标签与按钮文字被挤成两行） | [`v0.1.38`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-remote-control@v0.1.38) |
| **`dsh-ai-proxy`** | [`plugins/dsh-ai-proxy`](plugins/dsh-ai-proxy) | AI Proxy Service 网关对接插件（协议层外包给宿主官方 llm-pi-ai 适配器并自动材料化路由、Chat/completions/Anthropic messages/Responses 三格式、最高推理强度开关、OAuth 2.0 PKCE 认证、令牌过期前主动轮换与阶梯推理映射、把网关 `/v1/models` 的 `modality`（text/image/decision）写入材料化路由供静态判断） | [`v0.3.20`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-ai-proxy@v0.3.20) |
| **`dsh-mobile-adapter`** | [`plugins/dsh-mobile-adapter`](plugins/dsh-mobile-adapter) | DSH 移动端全量体验优化（原生图片/相册上传、工作区工具箱整合文件查看器/本地终端/提示词历史、移动端右侧栏避让与一键返回对话、对话框底部全操作按钮圆形统一规范、输入框下方统计行固定单行三列（槽位 row/nowrap、末位文字省略号、≤360px 再降级）并按实测高度动态收进卡片且不再依赖 `:has()`、视口高度自适应、Segmented Control Tabs、全量弹窗防溢出、输入区聚焦防整页放大、应用级浮层按宿主稳定属性压过移动端顶栏、宿主类名存活与去哈希兜底、设置页头部选择条左右贴边与顶栏无缝一体化融合、一键全屏（Fullscreen API 收起浏览器导航栏与底部工具栏，应用自身顶栏/标题栏/tabs 全部保留 + 100dvh 重铺 + 退出状态同步）、模型选择菜单滚动修复（容器保持 overflow:hidden 让内部滚动区接手）） | [`v0.1.58`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-mobile-adapter@v0.1.58) |
| **`dsh-file-viewer`** | [`plugins/dsh-file-viewer`](plugins/dsh-file-viewer) | 工作区文件查看器（PC端全屏切换、桌面端避开 Windows 原生标题栏按钮并接管原生「在应用中打开」与更改卡片打开、移动端触屏长按右键菜单防抖与底部抽屉、路径复制与@引用、语法高亮、Markdown/JSON、图片、PDF、Excel、Word、安全访问路径双重持久化保存、下载上限独立提至100MB且预览上限保持20MB、浏览器交原生下载管理器接管而桌面端流式显示百分比进度、非 ASCII 文件名与错误回显安全加固、标题字阶与品牌色前景改用宿主真实 token 以兼容单色品牌主题、输入栏入口几何对齐宿主原生「+」按钮、右侧内容区多标签页与标签右键刷新/关闭/关闭其它/关闭所有） | [`v0.3.5`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-file-viewer@v0.3.5) |
| **`dsh-terminal`** | [`plugins/dsh-terminal`](plugins/dsh-terminal) | **（已废弃，插件管理器中只能卸载、不能安装或更新）** 跨平台本地交互式终端（移动端专属对话框底部工具箱二合一入口、PC端隐藏、多标签并发、触控辅助键盘） | [`v0.1.17`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-terminal@v0.1.17) |
| **`dsh-archive-manager`** | [`plugins/dsh-archive-manager`](plugins/dsh-archive-manager) | 会话归档管理器（侧边栏实时归档计数徽章、一键恢复会话与彻底删除清理磁盘空间） | [`v0.2.15`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-archive-manager@v0.2.15) |
| **`dsh-prompt-history`** | [`plugins/dsh-prompt-history`](plugins/dsh-prompt-history) | 提示词历史导航、修改重发与跨端同步器（已发气泡悬浮✏️修改与🔄重发、移动端提示词按钮归入工作区工具箱、自适应底部抽屉、严格会话绑定防串门、宿主持久化跨端漫游、输入栏入口几何对齐宿主原生「+」按钮） | [`v0.4.13`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-prompt-history@v0.4.13) |
| **`dsh-theme-studio`** | [`plugins/dsh-theme-studio`](plugins/dsh-theme-studio) | 主题工作室：默认保持 DSH 原生风格，提供系统默认 + 4 款内置主题（ZCode 官方 / ZCode 单色极简 / 苹果玻璃 / 玻璃彩色）切换、统一 Token 契约（一份 `HOST_TOKEN_MAP` 服务全部主题，宿主 145 个 `--dsw-*` 全覆盖）、插件兼容层（显式定义插件引用但宿主未定义的别名，并逐插件扫描守护）、背景（纯色/图片/不透明度）、字体、字号、11 项字段颜色可视化自定义并持久化到 `~/.dsh/theme-studio/settings.json`、白名单式输入校验防 CSS 注入、首屏直出零闪烁、变量按 body/:root 分层解决宿主特异性覆盖、`prefers-reduced-transparency` 无障碍退化、输入卡内权限与模型选择器去掉背景框与描边（与相邻「+」按钮视觉一致） | [`v0.2.1`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-theme-studio@v0.2.1) |
| **`dsh-zcode-theme`** | [`plugins/dsh-zcode-theme`](plugins/dsh-zcode-theme) | **（已废弃，插件管理器中只能卸载、不能安装或更新；兼容薄壳）** ZCode 主题已并入 `dsh-theme-studio` 的 `zcode` / `zcode-mono` 内置主题；本包仅保留旧属性与样式标签 id 以保证平滑升级，薄壳产出的变量与工作室逐值相同、检测到 `data-theme-studio` 时让位、不再调用 `overrideTokens` 以免覆盖其它主题 | [`v0.3.0`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-zcode-theme@v0.3.0) |
| **`dsh-jev`** | [`plugins/dsh-jev`](plugins/dsh-jev) | 决策模型原生工具插件（可直接下拉选择 dsh 已配置的提供商与模型，此时接口地址与 API Key 完全由提供商配置解析；也可手写 baseURL/Key/模型 ID。决策模型按 `/v1/models` 的 `modality`、静态 `modality`（含 dsh-ai-proxy 材料化写入）、classifier 协议、模型类型与名称识别；默认仍为 TypeSafe Jev 官方地址、Choice/Score/Noul 三大决策原语、/v1/systemone 与 /v1/decisions 端点切换、代理访问支持 http/https/socks5、常驻决策策略切面引导 Agent 何时调用） | [`v0.2.6`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-jev@v0.2.6) |
| **`dsh-image-gen`** | [`plugins/dsh-image-gen`](plugins/dsh-image-gen) | DSH 原生生图插件（把文生图作为原生工具暴露，可直接下拉选择 dsh 已配置的提供商与模型、或手动填写 baseURL/Key，内置尺寸与画质选择，支持 http/https/socks5 代理；设置面板可实时切换并测试连通性） | [`v0.1.5`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-image-gen@v0.1.5) |
| **`dsh-task-models`** | [`plugins/dsh-task-models`](plugins/dsh-task-models) | 独立子任务模型路由插件（按任务类型为子代理选择模型、显式标签优先与词边界匹配、规则试运行预览、workflow 模型标注附路由解释、可选 TypeSafe Jev 决策、可选轻量分类回退、有界决策超时与取消传播、不依赖任何 Agent Preset 或角色路由插件） | [`v0.3.0`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-task-models@v0.3.0) |
| **`dsh-im-bot`** | [`plugins/dsh-im-bot`](plugins/dsh-im-bot) | 集成机器人：企业微信智能机器人（长连接 API 模式，无需公网地址）与个人微信（腾讯 iLink Bot 官方接口）双通道、微信发消息驱动 DSH 会话的双向通信（`/new` `/use` `/sessions` `/status` `/stop` `/notify` `/help` 内置命令）、回合完成与失败告警主动回推发起聊天、白名单安全默认拒绝、每 peer 限流与分片、断线指数退避重连、扫码登录、绑定关系可视化管理、`im_bot_send` 原生工具与 `/dsh-im-bot/send` 通用推送接口 | [`v0.1.5`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-im-bot@v0.1.5) |
| **`dsh-system-prompt-editor`** | [`plugins/dsh-system-prompt-editor`](plugins/dsh-system-prompt-editor) | 系统提示词可视化编辑器（默认展示当前真实系统提示词、按名称定位改为下拉框列出真实段落并附中文含义与悬停预览、同行字段顶部对齐修正下拉框错位、五种定位方式与五种改写动作、可按预设或会话限定生效范围、追加段落走正式 section 注册、保存前实时预览与逐条命中反馈、优先写入官方 settings 服务并原子落盘、任一规则异常都不阻断会话且失败时原样放行官方提示词、通过 `system-prompt/assemble` waterfall 实现故无需改动安装包） | [`v0.2.0`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-system-prompt-editor@v0.2.1) |

---

## 🚀 插件安装指南 (Installation)

所有插件已发布到 npm registry，scope 为 `@weniatall/`。使用 DSH 官方 CLI 即可在线一键安装：

> **为什么带 `@weniatall/` 前缀**：12 个插件里有 9 个的无 scope 包名（`dsh-terminal`、
> `dsh-file-viewer` 等）已被第三方占用且不可转让，因此统一迁移到 scope 下。scope 包名
> 与 GitHub tag 刻意不同 —— tag 仍是 `dsh-terminal@v0.1.16` 这样的短名，以便历史
> Release 的下载链接和插件管理器的来源白名单继续有效。详见 [npm 发布指引](docs/npm-publishing.md)。

> **宿主兼容（dsh `0.2.1-rc.2`）**：下表版本均已针对运行中的 dsh 宿主做过兼容校验，`peerDependencies`
> 使用 `>=0.1.0-rc.6` 这类开放区间，同时接受 0.1.x、`0.2.0-rc.N` 与 `0.2.1-rc.N`。2026-09-29 之前发布的旧版本
> （如 `dsh-ai-proxy@0.3.9`、`dsh-model-roles@0.4.25`）声明的是 `^0.1.0-rc.6`，其隐含上界
> `0.2.0-0` 把 `0.2.0-rc.2` 排除在外，dsh 0.2 会在启动时直接拒载：
>
> ```text
> dsh: warning: Plugin dsh-ai-proxy@0.3.9 is incompatible with dsh 0.2.0-rc.2: peerDependencies ...
> dsh: it stays installed but profile startup denies it until you grant an exemption for those exact versions.
> ```
>
> 修复方式是**用下面的安装命令覆盖安装同名插件**（`dsh plugin add` 会替换 profile 里 pin 住的旧
> tarball），再重启服务；不要手动往 profile 的 `node_modules` 里拷文件。

```bash
# 1. 安装插件管理中心 (自有插件更新与社区市场)
dsh plugin --profile web add @weniatall/dsh-plugin-manager

# 2. 安装模型角色分工插件 (多模型智能路由与识图子代理)
dsh plugin --profile web add @weniatall/dsh-model-roles

# 3. 安装远程安全通道插件 (推荐所有公网/局域网部署安装)
dsh plugin --profile web add @weniatall/dsh-remote-control

# 4. 安装 AI Proxy 网关插件
dsh plugin --profile web add @weniatall/dsh-ai-proxy

# 5. 安装移动端适配插件 (手机浏览器访问必备)
dsh plugin --profile web add @weniatall/dsh-mobile-adapter

# 6. 安装文件查看器插件 (会话头部抽屉浏览工作区文件)
dsh plugin --profile web add @weniatall/dsh-file-viewer

# 7. 安装本地终端插件 (跨平台原生终端调用与移动端适配)
dsh plugin --profile web add @weniatall/dsh-terminal

# 8. 安装会话归档管理器
dsh plugin --profile web add @weniatall/dsh-archive-manager

# 9. 安装提示词历史与跨端漫游
dsh plugin --profile web add @weniatall/dsh-prompt-history

# 10. 安装主题工作室（ZCode / 苹果玻璃等多款主题 + 外观自定义）
dsh plugin --profile web add @weniatall/dsh-theme-studio
#     （旧包 @weniatall/dsh-zcode-theme 已并入上面这个，仅作兼容薄壳保留）

# 11. 安装决策模型（默认 TypeSafe Jev，也可选 dsh 已配置的提供商）
dsh plugin --profile web add @weniatall/dsh-jev

# 12. 安装文生图 (生图模型) 插件
dsh plugin --profile web add @weniatall/dsh-image-gen

# 13. 安装独立子任务模型路由 (按任务类型为子代理选模型)
dsh plugin --profile web add @weniatall/dsh-task-models

# 14. 安装集成机器人 (企业微信 / 个人微信双向通信与任务完成通知)
dsh plugin --profile web add @weniatall/dsh-im-bot
```

### 从旧版 tarball 安装迁移

如果你的 profile 里还 pin 着旧的无 scope 版本或 GitHub tarball，直接执行上面的
`dsh plugin add @weniatall/...` 即可覆盖安装：`dsh plugin add` 会替换 profile 里
pin 住的旧来源，不需要先卸载。

迁移前，profile 的 `package.json` 里通常长这样（两种历史形态）：

```jsonc
{
  // 形态一：插件管理器预下载的本地缓存
  "dsh-terminal": "file:/home/you/.dsh/profiles/web/.plugin-manager/downloads/dsh-terminal-0.1.16.tgz",
  // 形态二：GitHub Release tarball，版本被锁死
  "dsh-model-roles": "https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.31/dsh-model-roles-0.4.31.tgz"
}
```

迁移后应变成标准的 registry 依赖：

```jsonc
{
  "@weniatall/dsh-terminal": "^0.1.17",
  "@weniatall/dsh-model-roles": "^0.4.32"
}
```

> **注意**：包名本身也变了（`dsh-terminal` → `@weniatall/dsh-terminal`），旧条目不会
> 自动消失。安装完新版后，需要把 `dependencies` 与 `dsh.profile.bundles` 里的**旧名**
> 手动删掉，否则宿主会因找不到模块而报错。`dsh-plugin-manager` 已内置新旧名称的双向
> 兼容匹配，能正确识别这种过渡态（不会把已安装的插件显示成「未安装」），但它不会替你
> 改写 profile 清单。

### 插件管理器内的安装与更新

`dsh-plugin-manager` 的版本检测、安装、更新与「复制指令」都走 npm 渠道：

- **版本检测**：优先读 npm registry 的 `dist-tags.latest`（发布事实本身），
  GitHub Release 仅作兜底，避免 tag 与 `package.json` 版本不一致导致的误判；
- **安装 / 更新**：向 `dsh plugin add` 传入 `@weniatall/dsh-xxx` 包名，而不是锁死
  版本的 tarball URL；
- **复制指令**：复制出来的命令是 `dsh plugin --profile web add @weniatall/dsh-xxx`。

离线或内网环境可以在插件管理器设置里打开 `allowTarball`，此时回落到 GitHub Release
的 tarball（仍会校验来源白名单）。

### 重启 DSH Web 服务生效

> **注意**：`@deepseek-ai/dsh` 官方 CLI 本身没有 `service` 子命令，执行 `dsh service restart` 会报错。请使用本仓库自带的控制脚本：

- **macOS / Linux 用户**：
  ```bash
  ./scripts/dsh-web.sh restart
  ```
- **Windows 用户**：
  ```powershell
  .\scripts\dsh-web.ps1 restart
  # 或 cmd:
  scripts\dsh-web.cmd restart
  ```

---

## 🛠️ 独立发布机制 (Independent Release Workflow)

本项目采用业内标准 Monorepo 独立发布策略（**Tag 格式：`<plugin-name>@v<version>`**）。

npm 包名带 scope（`@weniatall/dsh-terminal`），GitHub tag 保持短名（`dsh-terminal@v0.1.16`）——
两者刻意不同，原因见 [npm 发布指引](docs/npm-publishing.md#二命名约定重要)。

### ⚠️ 新增插件时必须手动做的三步操作（一次性）

下面三件事**无法由 CI 完成**，每新增一个插件都要人工执行一次。漏做任何一步，
后续推 tag 的自动发布会直接失败（`E404` 或 `403`）。

**第 1 步：本地登录 npm（每个开发者/每台机器一次）**

```bash
npm login --auth-type=web
```

> Trusted Publishing 只能给**已存在**的包配置，所以每个新包的首个版本必须先在本地发出去。

**第 2 步：首次发布该包（每个新包一次）**

```bash
cd plugins/dsh-terminal && npm publish --access public
```

> 首次发布**不要**加 `--provenance`（本地没有 OIDC 身份，加了会报错）。CI 后续发布的新版本
> 才会带上 provenance。发布前记得先跑 `npm test` 与
> `node scripts/verify-pack-contents.mjs --plugin <插件目录名>`。

**第 3 步：给这个包配置一次 trusted publisher（每个新包一次）**

打开该包的设置页，例如：

<https://www.npmjs.com/package/@weniatall/dsh-terminal/access>

在 **Trusted publishing** 区域点 **Add trusted publisher**，按下表填写：

| 字段 | 值 |
| --- | --- |
| Publisher | **GitHub Actions** |
| Organization or user | `veildawn` |
| Repository | `dsh-plugins` |
| Workflow filename | `release-plugin.yml` |
| Environment name | 留空（不使用 environment 保护） |

> **`Organization or user` 填的是 GitHub 仓库归属（`veildawn`），不是 npm 账号名
> （`weniatall`）**，两者不同是正常的 —— npm 校验的是仓库身份。
>
> 工作流文件名必须逐字符一致（`release-plugin.yml`，含扩展名）。配好后建议同时把
> **Publishing access** 设为 “Require two-factor authentication and disallow tokens”，
> 彻底关掉 token 通道。

三步都完成后，该插件之后的所有版本都可以只靠**推 tag** 自动发布（见下方方式 1）。
完整背景与故障排查见 [npm 发布指引](docs/npm-publishing.md)。

### 方式 1：推送 Tag（推荐，默认即发布 npm）
改好 `plugins/<plugin>/package.json` 的 `version` 并推送到 `main` 后，打并推送
`<plugin-name>@v<version>` 形式的 Tag，CI 会跑测试、校验打包内容、发布 npm（走
Trusted Publishing，无需任何 token）、再创建 GitHub Release：

```bash
git tag -a "dsh-terminal@v0.1.16" -m "dsh-terminal v0.1.16"
git push origin "dsh-terminal@v0.1.16"
```

版本已存在于 npm 时该步骤会**自动跳过**而不是让 job 失败（重跑或重推修正后的 tag
都安全），GitHub Release 仍会正常创建。要发新版本必须升 `package.json` 的 version。

### 方式 2：GitHub Actions 手动触发
在 **Actions → Release Single Plugin → Run workflow** 中填写插件名、版本号。
`publish_npm` 默认已勾选；取消勾选则只建 GitHub Release。执行内容与方式 1 相同。

### 方式 3：本地一键脚本
```bash
# 格式: ./scripts/release.sh <插件目录名> [版本号(可选)]
./scripts/release.sh dsh-plugin-manager 0.3.38
./scripts/release.sh dsh-model-roles 0.4.28
./scripts/release.sh dsh-remote-control 0.1.18
./scripts/release.sh dsh-ai-proxy 0.3.12
./scripts/release.sh dsh-mobile-adapter 0.1.41
./scripts/release.sh dsh-file-viewer 0.1.49
./scripts/release.sh dsh-terminal 0.1.13
./scripts/release.sh dsh-task-models 0.3.0
```
脚本会自动：
1. 运行对应插件的单元测试；
2. 校验宿主兼容性与 npm 发布内容（`verify-pack-contents.mjs`）；
3. 执行 `npm pack` 并把产物重命名为 `<短名>-<版本>.tgz`；
4. 打上 `plugin@vX.Y.Z` 格式的 Git Tag 并推送（**因此同样会触发 CI 发布 npm**）；
5. 再用 `gh release create` 自己建一次 Release。

> ⚠️ 第 4 步已经触发 CI，第 5 步与 workflow 的 “Create GitHub Release” 存在竞争，
> 谁先建谁生效。日常发布建议直接用**方式 1**。

> 发布前的本地自检：`node scripts/verify-pack-contents.mjs` 会逐个校验全部插件的
> `files` 白名单，确保既不漏发运行期文件，也不会把 `test/`、`node_modules/` 或历史
> `.tgz` 一起发出去。

### 设置写入自检（`has no volatile fields` 回归）
dsh `0.1.7` 起（含当前的 `0.2.1-rc.2`）`ctx.settings` 是 dsh-settings 的 `SettingsForms`：任何**没有声明 live
(`.volatile()`) 字段**的插件条目，宿主的写入会直接抛
`Plugin entry "<id>" has no volatile fields`（前端表现为「保存配置失败」），且该条目不
会出现在 `describe()` 里。凡是自己写自己设置节的插件，都要把被写入的字段声明为 live，
并在读取时解包 live 引用。

`scripts/check-host-settings.mjs` 用宿主**真实**的 `Loader`/fiber、`SettingsForms` 与
schemastery 挂载插件的真实 `Config`，逐字段验证写入被接受、落盘到 profile 补丁且不重载
fiber；机器上没有 `dsh` 时打印 `SKIP` 退出 0。受影响插件的 `npm test` 已串联该检查：

```bash
node scripts/check-host-settings.mjs plugins/dsh-archive-manager archive-manager
```

### 宿主兼容自检（`is incompatible with dsh ...` 拒载回归）

dsh 启动时只按 `peerDependencies` 里的 `@deepseek-ai/dsh*` 区间判断插件能否加载，且带
`includePrerelease: true`。`^0.1.0-rc.6` 会被解析成 `>=0.1.0-rc.6 <0.2.0-0`，上界 `0.2.0-0`
小于 `0.2.0-rc.2`，于是 0.1 线上锁死的 caret 区间在宿主升到 `0.2.0-rc.N` 的那一刻变成硬拒载：
插件仍然「安装成功」，但 profile 启动会跳过它，并把
`Plugin <name>@<version> is incompatible with dsh <version>` 写进安装日志与启动告警。

`scripts/check-plugin-compat.mjs` 用宿主**自己**的 `evaluatePluginCompatibility()`
（`@deepseek-ai/dsh-app-boot` 导出，与启动告警同一段逻辑）逐个校验本仓库插件的
`package.json`，并额外确认宿主确实提供了清单里声明的每个 `@deepseek-ai/dsh*` 包；机器上没有
`dsh` 时打印 `SKIP` 退出 0。`scripts/release.sh` 已在测试前串联该预检，范围写错的版本不会再被发出去。

> **`0.2.1-rc.2` 起的「宿主没有这个包」例外**：`@deepseek-ai/dsh-client-ui-slots` 与
> `@deepseek-ai/dsh-client-ui-primitives` 是宿主前端自己的构建依赖，`dsh-web-frontend` 用 vite
> 把它们内联进 `dist/assets/*.js`，再经 `window.__ModuleLoader__` 作为共享模块（seed）发给插件
> client bundle。宿主 `node_modules` 里没有同名目录**不是**不兼容——预检会同时扫描 web bundle 的
> seed 表，命中即视为宿主已提供；只有既不在 `node_modules`、也不在 seed 表里的包才判 FAIL。

```bash
node scripts/check-plugin-compat.mjs                       # 全部插件
node scripts/check-plugin-compat.mjs plugins/dsh-ai-proxy  # 单个插件
node scripts/check-plugin-compat.mjs --runtime 0.2.1-rc.2  # 指定宿主版本
```

### 宿主 CSS Modules 哈希类名自检（`data-*` 稳定属性回归）

宿主前端的 CSS Modules 类名（如 `Sh0Q9G_trigger`、`FJxK0a_root`）由构建生成，**宿主每次发版都可能变**。
插件里按旧哈希写的样式覆盖不会报错，只会静默失效——`0.2.1-rc.2` 把统计行从
`dsh-client-ui-conversation` 迁到 `dsh-client-ui-chat`（`FJxK0a_root` → `bOPqQW_*`），
把权限选择器迁到 `dsh-client-ui-permission-presets`（`Sh0Q9G_*` → `iWlSmW_*`），
移动端因此重新冒出两行统计并把 `∨` 箭头带回权限按钮。

新写样式覆盖时优先用宿主渲染时写死的稳定属性（`data-composer-stat`、`data-slot`、
`data-composer-card`、`[data-shortcut-modal="settings"]` 等），必须用哈希类名时请同时保留
新旧两代前缀，并用下面的脚本确认没有死哈希：

```bash
# 对照当前宿主审计：列出插件里已不存在于宿主 node_modules 的哈希前缀
node -e "
const fs=require('fs'), path=require('path');
const D=process.env.DSH_HOST||'/home/ai_bot/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai';
const isHash=s=>/^[A-Za-z0-9]{5,8}$/.test(s)&&/[A-Z0-9]/.test(s);
const host=new Set();
for(const p of fs.readdirSync(D)){const f=path.join(D,p,'lib/client.js');if(!fs.existsSync(f))continue;
for(const m of fs.readFileSync(f,'utf8').matchAll(/\.([A-Za-z0-9]{5,8})_[a-zA-Z]+\{/g))if(isHash(m[1]))host.add(m[1]);}
for(const plugin of fs.readdirSync('plugins')){const f=path.join('plugins',plugin,'lib/client.js');if(!fs.existsSync(f))continue;
const used=new Set();for(const m of fs.readFileSync(f,'utf8').matchAll(/\.([A-Za-z0-9]{5,8})_[a-zA-Z]+\{/g))if(isHash(m[1]))used.add(m[1]);
const dead=[...used].filter(h=>!host.has(h));if(dead.length)console.log(plugin,'->',dead.join(', '));}
"
```

### 宿主加载自检（`1 required plugin did not activate` 回归）

`peerDependencies` 只挡住「版本区间」，挡不住「清单没变但宿主 API 变了」这一整类故障：
`0.2.1-rc.2` 移除了 `webRuntime` 服务，凡是 `cordis.patch.yml` 还给 `connection` 注入它的插件，
都会让该行永远停在 pending，profile 启动直接失败：

```text
dsh: startup failed: 1 required plugin did not activate
  Plugin                 Missing services
  connection (required)  webRuntime
```

`scripts/check-host-load.mjs` 把插件按宿主**自己的** `node_modules` 真实 `import` 一次，并断言：

1. 入口导出 `apply()`（或默认插件函数）；
2. 每个 `inject` 服务名都能在宿主已装载的插件里找到提供者；
3. `cordis.patch.yml` 里每条 `inject:` 只引用宿主确实提供的服务；
4. 若声明了 `Config`，它是宿主 schemastery 能识别的 schema。

无 `dsh` 时同样打印 `SKIP` 退出 0；`scripts/release.sh` 已把它排在测试之前：

```bash
node scripts/check-host-load.mjs                       # 全部插件
node scripts/check-host-load.mjs plugins/dsh-ai-proxy  # 单个插件
```

---

## 📄 License
MIT