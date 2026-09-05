# dsh-plugins (DeepSeek Harness Community Plugins)

官方 DeepSeek Harness (DSH) 社区插件 Monorepo 工作区。每个插件**独立版本管理、独立测试、按需独立发布 Release**。

---

## 📦 插件列表 (Plugins Roster)

| 插件名称 | 目录 | 说明 | 最新独立版本 |
| :--- | :--- | :--- | :--- |
| **`dsh-plugin-manager`** | [`plugins/dsh-plugin-manager`](plugins/dsh-plugin-manager) | 插件管理中心与自有插件更新/卸载管理器（专属拼图图标、移动端全量响应式触控适配、自有插件一键批量更新(N)、社区21分类、静默直接复制指令、异步平滑重启与自动恢复） | [`v0.2.0`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-plugin-manager@v0.2.0) |
| **`dsh-model-roles`** | [`plugins/dsh-model-roles`](plugins/dsh-model-roles) | 模型角色路由、自动分工、识图子代理、计划模式与顾问复核 (`/advisor`、局域网访问放行、专属分支路由图标) | [`v0.4.9`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-model-roles@v0.4.9) |
| **`dsh-remote-control`** | [`plugins/dsh-remote-control`](plugins/dsh-remote-control) | 通用 DSH 远程/局域网访问安全控制与特权通道插件（Token 密钥认证、密码锁屏门禁 Unlock Screen、特权 RPC 白名单桥接、HTTP 非安全上下文全局兼容、专属地球网络图标） | [`v0.1.5`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-remote-control@v0.1.5) |
| **`dsh-ai-proxy`** | [`plugins/dsh-ai-proxy`](plugins/dsh-ai-proxy) | AI Proxy Service 网关对接与 LLM Provider 插件（支持 Chat/completions、Anthropic messages、Responses 多格式智能匹配、OAuth 2.0 PKCE 认证、Token 刷新与阶梯推理） | [`v0.2.5`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-ai-proxy@v0.2.5) |
| **`dsh-mobile-adapter`** | [`plugins/dsh-mobile-adapter`](plugins/dsh-mobile-adapter) | DSH 移动端全量体验优化（原生图片/相册上传、对话框底部全操作按钮圆形统一规范、视口高度自适应、Segmented Control Tabs、全量弹窗防溢出、工作区行操作按钮触屏常显） | [`v0.1.29`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-mobile-adapter@v0.1.29) |
| **`dsh-file-viewer`** | [`plugins/dsh-file-viewer`](plugins/dsh-file-viewer) | 工作区文件查看器（PC端全屏切换、移动端触屏长按右键菜单防抖与底部抽屉、路径复制与@引用、语法高亮、Markdown/JSON、图片、PDF、Excel、Word） | [`v0.1.8`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-file-viewer@v0.1.8) |
| **`dsh-terminal`** | [`plugins/dsh-terminal`](plugins/dsh-terminal) | 跨平台本地交互式终端（移动端专属对话框底部工具箱二合一入口、PC端隐藏、多标签并发、触控辅助键盘） | [`v0.1.9`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-terminal@v0.1.9) |
| **`dsh-prompt-history`** | [`plugins/dsh-prompt-history`](plugins/dsh-prompt-history) | 提示词历史导航器（上下键浏览历史提示词、草稿暂存防丢失、中文输入法与@/补全智能避让） | `v0.2.0` |

---

## 🚀 插件安装指南 (Installation)

无需下载整个仓库，每个插件均提供独立的 `.tgz` 安装包。使用 DSH 官方 CLI 即可在线一键安装：

```bash
# 0. 安装插件管理中心 (自有插件更新与社区市场)
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-plugin-manager@v0.2.0/dsh-plugin-manager-0.2.0.tgz

# 1. 安装模型角色分工插件 (多模型智能路由与识图子代理)
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.7/dsh-model-roles-0.4.7.tgz

# 2. 安装远程安全通道插件 (推荐所有公网/局域网部署安装)
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-remote-control@v0.1.5/dsh-remote-control-0.1.5.tgz

# 3. 安装 AI Proxy 网关插件
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-ai-proxy@v0.2.5/dsh-ai-proxy-0.2.5.tgz

# 4. 安装移动端适配插件 (手机浏览器访问必备)
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-mobile-adapter@v0.1.29/dsh-mobile-adapter-0.1.29.tgz

# 5. 安装文件查看器插件 (会话头部抽屉浏览工作区文件)
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-file-viewer@v0.1.8/dsh-file-viewer-0.1.8.tgz

# 6. 安装本地终端插件 (跨平台原生终端调用与移动端适配)
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-terminal@v0.1.9/dsh-terminal-0.1.9.tgz

# 重启服务即可生效
dsh service restart --profile web
```

> **Windows 用户注意**：`dsh service restart` 依赖宿主打包的 systemd/launchd 单元，`@deepseek-ai/dsh`
> CLI 本身没有 `service` 子命令（`dsh --help` 只列出根命令、`web`、`plugin`），在 Windows 上执行会直接
> 报 `error: too many arguments`。请改用本仓库自带的重启脚本：
>
> ```powershell
> powershell -File scripts/dsh-service.ps1 restart -Profile web
> ```
>
> 该脚本还支持 `start` / `stop` / `status`，详见脚本内注释。

---

## 🛠️ 独立发布机制 (Independent Release Workflow)

本项目采用业内标准 Monorepo 独立发布策略（**Tag 格式：`<plugin-name>@v<version>`**）：

### 方式 1：使用一键发布脚本 (推荐)
```bash
# 格式: ./scripts/release.sh <插件目录名> [版本号(可选)]
./scripts/release.sh dsh-plugin-manager 0.2.0
./scripts/release.sh dsh-model-roles 0.4.8
./scripts/release.sh dsh-remote-control 0.1.5
./scripts/release.sh dsh-ai-proxy 0.2.4
./scripts/release.sh dsh-mobile-adapter 0.1.12
./scripts/release.sh dsh-file-viewer 0.1.1
./scripts/release.sh dsh-terminal 0.1.0
```
脚本会自动：
1. 运行对应插件的单元测试；
2. 执行 `npm pack`；
3. 打上 `plugin@vX.Y.Z` 格式的 Git Tag 并推送；
4. 自动创建对应的独立 GitHub Release 并上传 `.tgz`。

### 方式 2：CI/CD 自动触发
只要给仓库推送形如 `dsh-model-roles@v0.4.6` 的 Tag，GitHub Actions 将会自动检测对应插件目录并构建专属 Release。

---

## 📄 License
MIT