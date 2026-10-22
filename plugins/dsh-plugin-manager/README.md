# dsh-plugin-manager (DeepSeek Harness 插件管理中心)

[![npm](https://img.shields.io/npm/v/dsh-plugin-manager)](https://www.npmjs.com/package/dsh-plugin-manager)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

DeepSeek Harness (DSH) 可视化**插件管理**与本仓库专属更新管理插件。提供专属拼图造型独立图标、支持自有插件与 2200+ 社区插件的一键安装 / 更新 / 卸载与异步平滑重启。

---

## ✨ 核心特性

- **全局状态三态筛选**：支持「全部 (N)」、「已安装 (N)」、「未安装 (N)」三大分类即时筛选，支持在自有插件与社区插件下与垂直分类和搜索无缝叠加。
- **专属独立图标与导航**：在 Web 设置面板（Settings → **插件管理**）中注入专属矢量拼图插件图标（覆盖宿主默认灰度图标）。
- **自有插件专属管理**：专为 `veildawn/dsh-plugins` 独立多插件仓库设计，实时拉取 GitHub Releases（如 `dsh-model-roles@v0.4.9`、`dsh-remote-control@v0.1.6` 等），并自动读取当前 DSH profile 中已安装插件的版本，逐项标记「已安装 → 最新 / 可更新 / 卸载」。
- **一键批量更新 (N)**：在「自有插件」与「社区插件」栏目中均提供「🚀 一键更新全部 (N)」按钮，自动统计可更新数量并批量执行更新（更新后绝不自动重启）。
- **一键安装 / 更新 / 卸载**：真实执行 `dsh plugin add` 和 `dsh plugin remove`（服务端白名单校验来源后运行），带实时流式进度日志；支持一键卸载已装插件并自动刷新状态；自有插件支持「安装 / 更新到最新 / 已是最新 / 卸载」，社区插件按 npm 包一键安装与卸载。
- **废弃插件只允许卸载**：`dsh-terminal`、`dsh-zcode-theme` 已在目录中标记为废弃，卡片显示「已废弃」徽章与废弃原因，只保留「卸载」按钮——不显示「安装」「更新」「复制指令」，不参与「一键更新全部」的统计与执行。三层同时生效：界面隐藏入口、更新检测强制 `hasUpdate=false`、服务端 `installPlugin` 直接拒绝（即使绕过 UI 手工调 RPC 也装不上）。废弃清单集中在 `core.js` 的 `DEPRECATED_REPO_PLUGINS`，新增下线插件只需改这一处。
- **Scoped 别名安装与冲突彻底清理**：使用 GitHub Release tarball 安装时一律采用 pnpm alias 语法（`@weniatall/dsh-xxx@url`），确保无论历史 tarball 内 package.json 是否有 scope 前缀，统一在 profile 中以 scoped 规范包名安装，消除磁盘双份共存；自动检测 dependencies、bundles 及物理目录中的历史无 scope 旧短名冲突，并在安装/批量更新/卸载时自动清理残留，同时在界面提供「⚠️ 存在旧版冲突」徽章与「一键清理冲突」操作。
- **更新按界面提示的版本精确安装**：更新时把界面已知的 `latestVersion` 一并传给宿主（`pnpm add <pkg>@<version>`），而不是让 pnpm 再解析一次 `@latest`。安装目标因此与「可更新到 vX」的提示完全一致，不受 dist-tag 漂移与 pnpm 元数据缓存过期影响。
- **更新结果校验**：`pnpm` 退出码 0 不代表版本真的变了（它可能判定 `Already up to date` 后原样退出）。安装完成后回读 `node_modules` 中的实际版本，与目标不一致时明确报「更新未生效」，而不是显示成功后仍一直提示可更新；装完会把 `dependencies` 的精确版本恢复为 `^<version>`，保持后续可更新。
- **静默直接复制指令**：点击「复制指令」直接将精准的 CLI 安装/更新命令写入系统剪贴板，绝不跳出弹窗确认。
- **剪贴板写入全路径兜底**：DSH 宿主更新横幅的「复制更新命令」与版本徽章「⚡ 可更新」均走统一的复制通道——优先使用异步 Clipboard API，被拒绝（无权限 / 文档未聚焦）或不可用时自动回退到 `document.execCommand("copy")`，写入成功时按钮即时变为「✓ 已复制」并弹出 Toast，全部失败时明确提示「复制失败，请手动执行：…」，不再出现点击无反应的哑按钮。
- **异步平滑重启与自动恢复**：提供手动「🔄 立即重启 DSH 服务」按钮。Linux 走 systemd 瞬态作用域，macOS 走用户 LaunchAgent 的 `launchctl kickstart`，Windows 走后台脚本。服务端延迟异步重启守护进程，前端探测端口并在就绪后自动刷新。
- **Lockfile 全自动静默检测与修复**：自动比对 profile 的 `pnpm-lock.yaml` 中记录的 tarball URL 与远程最新 GitHub Release，发现陈旧条目时在后台自动静默清理，对用户完全透明；安装与更新前自动预清理旧条目，命中 `ERR_PNPM_TARBALL_INTEGRITY` 时自动二次剥离并重试，彻底避免因旧版本 tarball 哈希漂移导致的更新失败。
- **社区插件分类浏览**：支持 **21 类分类筛选**、模糊搜索与标签过滤（数据源：awesome-dsh-plugin.com，自动走系统代理）。
- **移动端全量响应式适配**：小屏下弹性栅格排版、安全区避让、触摸友好的大操作按钮。
- **安全与局域网放行**：RPC 通道注册为 `trusted-host` 权限，支持从本机（localhost/127.0.0.1）以及 `connection.trustedHosts` 白名单配置的局域网客户端直接调用；安装与卸载来源必须通过白名单校验，且同一时间只允许一个任务执行。

---

## 🍏 macOS 用户：配置 launchd LaunchAgent 以获得平滑重启支持

macOS 没有 systemd。插件的「立即重启」只认 **用户级 LaunchAgent**（不是 LaunchDaemon / 系统级服务）。未配置时按钮会返回 `restart-unavailable`，请先按下面托管 `dsh web`。

仓库模板：`scripts/com.deepseek.dsh-web.plist`（Label 必须是 `com.deepseek.dsh-web`，与插件默认服务名一致）。

1. **安装 plist**（拷到用户 LaunchAgents 目录；没有仓库时用 curl）：
   ```bash
   mkdir -p ~/Library/LaunchAgents
   cp scripts/com.deepseek.dsh-web.plist ~/Library/LaunchAgents/com.deepseek.dsh-web.plist
   # 或:
   # curl -fsSL https://raw.githubusercontent.com/veildawn/dsh-plugins/main/scripts/com.deepseek.dsh-web.plist \
   #   -o ~/Library/LaunchAgents/com.deepseek.dsh-web.plist
   ```
   若 `dsh` 来自 nvm / fnm / volta / asdf，不要依赖模板里的 PATH，把 `ProgramArguments` 改成 `dsh` 的绝对路径加 `web`。可用 `which dsh` 查看。

2. **加载并启动**（macOS 10.10+ 用 bootstrap，不要用已过时的 `launchctl load`）：
   ```bash
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.deepseek.dsh-web.plist
   launchctl enable gui/$(id -u)/com.deepseek.dsh-web
   launchctl kickstart -k gui/$(id -u)/com.deepseek.dsh-web
   ```
   无图形会话（SSH）时把 `gui/$(id -u)` 换成 `user/$(id -u)`。

3. **完成后**：在 Web 界面点「🔄 立即重启 DSH 服务」，插件会探测 `gui/<uid>/com.deepseek.dsh-web` 与 `user/<uid>/com.deepseek.dsh-web`，再执行 `launchctl kickstart -k`。

卸载：
```bash
launchctl bootout gui/$(id -u)/com.deepseek.dsh-web
rm ~/Library/LaunchAgents/com.deepseek.dsh-web.plist
```

---

## 📦 安装方式

使用 DSH 官方 CLI 安装本插件：

```bash
dsh plugin --profile web add https://github.com/veildawn/dsh-plugins/releases/download/dsh-plugin-manager@v0.3.45/dsh-plugin-manager-0.3.45.tgz
```

或使用本地打包安装：

```bash
cd plugins/dsh-plugin-manager
npm pack
dsh plugin --profile web add ./plugins/dsh-plugin-manager/dsh-plugin-manager-0.3.45.tgz
```

### ⚙️ GitHub Token 配置（提高 API 速率限制）

默认情况下使用 GitHub 匿名 API 请求，每个 IP 限制 **60 次/小时**。若频繁检查更新或同一网络下共享 IP，容易触发 HTTP 403 速率限制。

- **界面配置**：在「插件管理 → 设置」面板中填写 **GitHub Token** 并点击「保存配置」，API 配额将立即提升至 **5000 次/小时**；
- **环境变量配置**：亦可在系统环境变量中直接设置 `GITHUB_TOKEN=ghp_...` 或 `GH_TOKEN=ghp_...`，插件会自动识别并优先使用；
- **自动兜底保障**：若未配置 Token 且匿名 API 触发了 403 限流，插件会自动切换至无需认证的 `releases.atom` 源无感兜底，确保始终能检测到最新版本。

> **0.3.25 起 bundle 行 id 改为 `dsh-plugin-manager`**（此前是 `plugin-manager`）。旧 id 与宿主 base bundle 里的
> 官方 `@deepseek-ai/dsh-plugin-manager` 冲突：profile 层按 id 覆盖、后写者胜，市场插件顶掉了官方插件，导致
> 官方 `pluginManager` 服务缺失（示例症状：创造模式 `cordis` 预设报
> `tool-plugin-manager (@deepseek-ai/dsh-plugin-manager/tools): waiting for pluginManager`）。
> 如果你在 profile 的 `cordis.patch.yml` 里写过 `- id: plugin-manager` 来覆盖本插件的配置，请把该 id 改成
> `dsh-plugin-manager`；同时该行的设置节 id 也随之变化（市场配置会回到 bundle 默认值，重新保存一次即可）。

---

## 🛠️ 支持的 Monorepo 插件矩阵

| 插件名称 | 标识符 | 描述 |
| :--- | :--- | :--- |
| **`dsh-plugin-manager`** | `plugin-manager` | 插件管理中心与自有插件更新/卸载管理器 |
| **`dsh-model-roles`** | `model-roles` | 模型角色分工与路由、计划模式、识图与顾问复核 |
| **`dsh-remote-control`** | `remote-control` | 远程访问安全控制与密码锁屏门禁 |
| **`dsh-ai-proxy`** | `ai-proxy` | AI Proxy 网关对接与 LLM Provider |
| **`dsh-mobile-adapter`** | `mobile-adapter` | 移动端全量体验适配与优化 |
| **`dsh-file-viewer`** | `file-viewer` | 会话工作区文件查看器与富文本预览 |
| **`dsh-terminal`** | `terminal` | 跨平台本地交互式终端与触控辅助键盘 —— **（已废弃，只能卸载）** |
| **`dsh-archive-manager`** | `archive-manager` | 会话归档管理、一键恢复与彻底删除磁盘清理 |
| **`dsh-prompt-history`** | `prompt-history` | 提示词历史导航、修改重发与跨端漫游 |
| **`dsh-im-bot`** | `im-bot` | 集成机器人：企业微信智能机器人与个人微信双通道接入，微信发消息驱动会话、回合完成自动回推 |
| **`dsh-theme-studio`** | `theme-studio` | 主题工作室：多内置主题、统一 Token 契约与视觉自定义 |
| **`dsh-zcode-theme`** | `zcode-theme` | ZCode 主题兼容薄壳 —— **（已废弃，只能卸载，请改用 `dsh-theme-studio`）** |

---

## 🧪 单元测试

```bash
cd plugins/dsh-plugin-manager
npm test
```

测试覆盖：语义化版本比对、Monorepo Release 标签解析与下载地址生成、社区目录归一化与分类提取、安装/卸载来源白名单校验、profile 已安装版本全量扫描与更新标记、lockfile 条目扫描/健康检测/剥离与 RPC 修复、批量更新与卸载任务执行（fake spawn 验证 CLI 参数与并发限制）、异步平滑重启调度（Linux systemd、macOS launchd gui/user 域、未配置则拒绝、仅 DSH_PLUGINS_REPO 维护者脚本回退）、RPC 请求处理（网络已打桩）、专属图标与客户端 Bundle 完整性校验、**废弃插件三层拦截回归**（目录标记与中文标题、短名/scope 名双向判定、远端版本更高也不提示更新、`installPlugin` 任务直接失败且不触发任何 CLI 调用、卡片只渲染「卸载」且不出现「安装 / 更新 / 复制指令」），以及**复制命令全路径回归**（真实渲染更新横幅并在 fake DOM 中点击按钮：Clipboard API 成功、API 缺失回退 `execCommand`、`writeText` 被拒回退、全部失败时输出手动复制提示、按钮「✓ 已复制」即时反馈与 2 秒复位、无未处理的 Promise 拒绝）。

---

## 📄 License
MIT
