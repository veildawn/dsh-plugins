# dsh-market (DeepSeek Harness 社区插件市场与仓库更新管理器)

[![npm](https://img.shields.io/npm/v/dsh-market)](https://www.npmjs.com/package/dsh-market)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

DeepSeek Harness (DSH) 可视化插件市场与本仓库专有更新管理插件。

---

## ✨ 核心特性

- **插件发现与浏览**：在 Web 设置面板（Settings → **插件市场**）中直接查看官方精选与社区插件，支持模糊搜索与标签过滤。
- **本 Monorepo 专属更新管理**：专为 `veildawn/dsh-plugins` 独立多插件仓库设计，实时拉取 GitHub Releases（如 `dsh-model-roles@v0.4.8`、`dsh-remote-control@v0.1.5` 等），并自动读取当前 DSH profile 中已安装插件的版本，逐项标记「已安装 → 最新 / 可更新」，一眼掌握本仓库全部插件的更新状态。
- **一键复制安装与更新指令**：为每一款插件生成标准 DSH CLI 在线安装命令（`dsh plugin add --profile <profile> <url>`），避免繁琐的手动下载和安装操作。
- **配置与镜像源管理**：支持切换 GitHub 仓库源、社区目录 URL 与下载镜像前缀（如 gh-proxy），配置写入 market 设置命名空间并持久化。
- **安全通信**：所有数据经宿主 `connection.rpc` 的 **loopback 专用通道** `/dsh-market-rpc` 交换，仅同源 Web 界面可调用，与 `dsh-remote-control` 配置通道采用同一约定。

---

## 📦 安装方式

使用 DSH 官方 CLI 安装本插件：

```bash
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-market@v0.1.0/dsh-market-0.1.0.tgz
```

或使用本地打包安装：

```bash
cd plugins/dsh-market
npm pack
dsh plugin add --profile web ./plugins/dsh-market/dsh-market-0.1.0.tgz
```

---

## 🛠️ 支持的 Monorepo 插件矩阵

| 插件名称 | 标识符 | 描述 |
| :--- | :--- | :--- |
| **`dsh-market`** | `market` | 插件市场与更新管理器 |
| **`dsh-model-roles`** | `model-roles` | 模型角色分工与路由、计划模式、识图与顾问复核 |
| **`dsh-remote-control`** | `remote-control` | 远程访问安全控制与密码锁屏门禁 |
| **`dsh-ai-proxy`** | `ai-proxy` | AI Proxy 网关对接与 LLM Provider |
| **`dsh-mobile-adapter`** | `mobile-adapter` | 移动端全量体验适配与优化 |
| **`dsh-file-viewer`** | `file-viewer` | 会话工作区文件查看器与富文本预览 |
| **`dsh-terminal`** | `terminal` | 跨平台本地交互式终端与触控辅助键盘 |

---

## 🧪 单元测试

```bash
cd plugins/dsh-market
npm test
```

测试覆盖：语义化版本比对、Monorepo Release 标签解析与下载地址生成、profile 已安装版本读取与更新标记、RPC 请求处理（网络已打桩）、客户端 Bundle 与 cordis 补丁一致性校验。

---

## 📄 License
MIT
