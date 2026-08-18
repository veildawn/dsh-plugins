# dsh-plugins (DeepSeek Harness Community Plugins)

官方 DeepSeek Harness (DSH) 社区插件 Monorepo 工作区。每个插件**独立版本管理、独立测试、按需独立发布 Release**。

---

## 📦 插件列表 (Plugins Roster)

| 插件名称 | 目录 | 说明 | 最新独立版本 |
| :--- | :--- | :--- | :--- |
| **`dsh-remote-control`** | [`plugins/dsh-remote-control`](plugins/dsh-remote-control) | 通用 DSH 远程/局域网访问安全控制与特权通道插件（Token 密钥认证、密码锁屏门禁 Unlock Screen、特权 RPC 白名单桥接、HTTP 非安全上下文全局兼容、专属地球网络图标） | [`v0.1.4`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-remote-control@v0.1.4) |
| **`dsh-ai-proxy`** | [`plugins/dsh-ai-proxy`](plugins/dsh-ai-proxy) | AI Proxy Service 网关对接与 LLM Provider 插件（OAuth 2.0 PKCE 认证、Token 刷新、模型与推理等级阶梯拉取、局域网登录放行、专属 API 终端图标） | [`v0.2.3`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-ai-proxy@v0.2.3) |
| **`dsh-mobile-adapter`** | [`plugins/dsh-mobile-adapter`](plugins/dsh-mobile-adapter) | DSH 移动端全量体验优化（视口高度自适应、Segmented Control Tabs、全量弹窗防溢出、创造模式/PTC 模式/标准模式/极简模式状态与切换） | [`v0.1.8`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-mobile-adapter@v0.1.8) |

---

## 🚀 插件安装指南 (Installation)

无需下载整个仓库，每个插件均提供独立的 `.tgz` 安装包。使用 DSH 官方 CLI 即可在线一键安装：

```bash
# 1. 安装远程安全通道插件 (推荐所有公网/局域网部署安装)
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-remote-control@v0.1.4/dsh-remote-control-0.1.4.tgz

# 2. 安装 AI Proxy 网关插件
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-ai-proxy@v0.2.3/dsh-ai-proxy-0.2.3.tgz

# 3. 安装移动端适配插件 (手机浏览器访问必备)
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-mobile-adapter@v0.1.8/dsh-mobile-adapter-0.1.8.tgz

# 重启服务即可生效
dsh service restart --profile web
```

---

## 🛠️ 独立发布机制 (Independent Release Workflow)

本项目采用业内标准 Monorepo 独立发布策略（**Tag 格式：`<plugin-name>@v<version>`**）：

### 方式 1：使用一键发布脚本 (推荐)
```bash
# 格式: ./scripts/release.sh <插件目录名> [版本号(可选)]
./scripts/release.sh dsh-remote-control 0.1.4
./scripts/release.sh dsh-ai-proxy 0.2.3
./scripts/release.sh dsh-mobile-adapter 0.1.8
```
脚本会自动：
1. 运行对应插件的单元测试；
2. 执行 `npm pack`；
3. 打上 `plugin@vX.Y.Z` 格式的 Git Tag 并推送；
4. 自动创建对应的独立 GitHub Release 并上传 `.tgz`。

### 方式 2：CI/CD 自动触发
只要给仓库推送形如 `dsh-remote-control@v0.1.4` 的 Tag，GitHub Actions 将会自动检测对应插件目录并构建专属 Release。

---

## 📄 License
MIT
