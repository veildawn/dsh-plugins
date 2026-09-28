# dsh-plugins (DeepSeek Harness Community Plugins)

官方 DeepSeek Harness (DSH) 社区插件 Monorepo 工作区。每个插件**独立版本管理、独立测试、按需独立发布 Release**。

---

## 📦 插件列表 (Plugins Roster)

| 插件名称 | 目录 | 说明 | 最新独立版本 |
| :--- | :--- | :--- | :--- |
| **`dsh-plugin-manager`** | [`plugins/dsh-plugin-manager`](plugins/dsh-plugin-manager) | 插件管理中心与自有插件更新/卸载管理器（专属拼图图标、移动端全量响应式触控适配、自有插件一键批量更新(N)、社区21分类、静默直接复制指令、剪贴板写入全路径兜底、异步平滑重启与自动恢复） | [`v0.3.29`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-plugin-manager@v0.3.29) |
| **`dsh-model-roles`** | [`plugins/dsh-model-roles`](plugins/dsh-model-roles) | 模型角色路由、自动分工、识图子代理、计划模式与顾问复核 (`/advisor`、局域网访问放行、专属分支路由图标) | [`v0.4.24`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-model-roles@v0.4.24) |
| **`dsh-remote-control`** | [`plugins/dsh-remote-control`](plugins/dsh-remote-control) | 通用 DSH 远程/局域网访问安全控制与特权通道插件（Token 密钥认证、密码锁屏门禁 Unlock Screen、特权 RPC 白名单桥接、HTTP 非安全上下文全局兼容、专属地球网络图标） | [`v0.1.14`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-remote-control@v0.1.14) |
| **`dsh-ai-proxy`** | [`plugins/dsh-ai-proxy`](plugins/dsh-ai-proxy) | AI Proxy Service 网关对接插件（协议层外包给宿主官方 llm-pi-ai 适配器并自动材料化路由、Chat/completions/Anthropic messages/Responses 三格式、最高推理强度开关、OAuth 2.0 PKCE 认证、令牌过期前主动轮换与阶梯推理映射） | [`v0.3.9`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-ai-proxy@v0.3.9) |
| **`dsh-mobile-adapter`** | [`plugins/dsh-mobile-adapter`](plugins/dsh-mobile-adapter) | DSH 移动端全量体验优化（原生图片/相册上传、工作区工具箱整合文件查看器/本地终端/提示词历史、对话框底部全操作按钮圆形统一规范、视口高度自适应、Segmented Control Tabs、全量弹窗防溢出） | [`v0.1.37`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-mobile-adapter@v0.1.37) |
| **`dsh-file-viewer`** | [`plugins/dsh-file-viewer`](plugins/dsh-file-viewer) | 工作区文件查看器（PC端全屏切换、移动端触屏长按右键菜单防抖与底部抽屉、路径复制与@引用、语法高亮、Markdown/JSON、图片、PDF、Excel、Word） | [`v0.1.48`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-file-viewer@v0.1.48) |
| **`dsh-terminal`** | [`plugins/dsh-terminal`](plugins/dsh-terminal) | 跨平台本地交互式终端（移动端专属对话框底部工具箱二合一入口、PC端隐藏、多标签并发、触控辅助键盘） | [`v0.1.12`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-terminal@v0.1.12) |
| **`dsh-archive-manager`** | [`plugins/dsh-archive-manager`](plugins/dsh-archive-manager) | 会话归档管理器（侧边栏实时归档计数徽章、一键恢复会话与彻底删除清理磁盘空间） | [`v0.2.10`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-archive-manager@v0.2.10) |
| **`dsh-prompt-history`** | [`plugins/dsh-prompt-history`](plugins/dsh-prompt-history) | 提示词历史导航、修改重发与跨端同步器（已发气泡悬浮✏️修改与🔄重发、移动端提示词按钮归入工作区工具箱、自适应底部抽屉、严格会话绑定防串门、宿主持久化跨端漫游） | [`v0.4.6`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-prompt-history@v0.4.6) |
| **`dsh-zcode-theme`** | [`plugins/dsh-zcode-theme`](plugins/dsh-zcode-theme) | ZCode Design System 视觉系统（深炭灰画布、暖橙红品牌色、首屏直出零闪烁、全量剔除宿主默认蓝、PC/平板/移动端共享视觉Token与气泡/输入框/终端材质全面重塑） | [`v0.1.33`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-zcode-theme@v0.1.33) |
| **`dsh-jev`** | [`plugins/dsh-jev`](plugins/dsh-jev) | TypeSafe Jev (System One 决策模型) 原生工具插件（70ms 级进程内直连、Choice/Score/Noul 三大决策原语、Web 前端设置面板直接配置 API Key 并测通、常驻决策策略切面引导 Agent 何时调用） | [`v0.1.8`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-jev@v0.1.8) |

---

## 🚀 插件安装指南 (Installation)

无需下载整个仓库，每个插件均提供独立的 `.tgz` 安装包。使用 DSH 官方 CLI 即可在线一键安装：

```bash
# 0. 安装插件管理中心 (自有插件更新与社区市场)
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-plugin-manager@v0.3.29/dsh-plugin-manager-0.3.29.tgz

# 1. 安装模型角色分工插件 (多模型智能路由与识图子代理)
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.24/dsh-model-roles-0.4.24.tgz

# 2. 安装远程安全通道插件 (推荐所有公网/局域网部署安装)
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-remote-control@v0.1.14/dsh-remote-control-0.1.14.tgz

# 3. 安装 AI Proxy 网关插件
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-ai-proxy@v0.3.9/dsh-ai-proxy-0.3.9.tgz

# 4. 安装移动端适配插件 (手机浏览器访问必备)
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-mobile-adapter@v0.1.37/dsh-mobile-adapter-0.1.37.tgz

# 5. 安装文件查看器插件 (会话头部抽屉浏览工作区文件)
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-file-viewer@v0.1.48/dsh-file-viewer-0.1.48.tgz

# 6. 安装本地终端插件 (跨平台原生终端调用与移动端适配)
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-terminal@v0.1.12/dsh-terminal-0.1.12.tgz

# 7. 安装会话归档管理器
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-archive-manager@v0.2.10/dsh-archive-manager-0.2.10.tgz

# 8. 安装提示词历史与跨端漫游
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-prompt-history@v0.4.6/dsh-prompt-history-0.4.6.tgz

# 9. 安装 ZCode 主题
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-zcode-theme@v0.1.33/dsh-zcode-theme-0.1.33.tgz

# 10. 安装 TypeSafe Jev 决策模型
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-jev@v0.1.8/dsh-jev-0.1.8.tgz
```

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

本项目采用业内标准 Monorepo 独立发布策略（**Tag 格式：`<plugin-name>@v<version>`**）：

### 方式 1：使用一键发布脚本 (推荐)
```bash
# 格式: ./scripts/release.sh <插件目录名> [版本号(可选)]
./scripts/release.sh dsh-plugin-manager 0.3.29
./scripts/release.sh dsh-model-roles 0.4.24
./scripts/release.sh dsh-remote-control 0.1.14
./scripts/release.sh dsh-ai-proxy 0.3.9
./scripts/release.sh dsh-mobile-adapter 0.1.37
./scripts/release.sh dsh-file-viewer 0.1.48
./scripts/release.sh dsh-terminal 0.1.12
```
脚本会自动：
1. 运行对应插件的单元测试；
2. 执行 `npm pack`；
3. 打上 `plugin@vX.Y.Z` 格式的 Git Tag 并推送；
4. 自动创建对应的独立 GitHub Release 并上传 `.tgz`。

### 方式 2：CI/CD 自动触发
只要给仓库推送形如 `dsh-model-roles@v0.4.6` 的 Tag，GitHub Actions 将会自动检测对应插件目录并构建专属 Release。

### 设置写入自检（`has no volatile fields` 回归）
DSH 0.1.7 的 `ctx.settings` 是 dsh-settings 的 `SettingsForms`：任何**没有声明 live
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

---

## 📄 License
MIT