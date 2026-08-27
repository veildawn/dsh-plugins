# dsh-market (DeepSeek Harness 社区插件市场与仓库更新管理器)

[![npm](https://img.shields.io/npm/v/dsh-market)](https://www.npmjs.com/package/dsh-market)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

DeepSeek Harness (DSH) 可视化插件市场与本仓库专有更新管理插件。

---

## ✨ 核心特性

- **插件发现与浏览**：在 Web 设置面板（Settings → **插件市场**）中直接查看官方精选与社区插件，支持**分类筛选**（21 类）、模糊搜索与标签过滤（数据源：awesome-dsh-plugin.com，自动走系统代理）。
- **一键安装 / 更新**：真实执行 `dsh plugin add`（服务端白名单校验来源后运行），带实时进度日志；仓库插件支持「安装 / 更新到最新 / 已是最新」三态，社区插件按 npm 包一键安装。
- **本 Monorepo 专属更新管理**：专为 `veildawn/dsh-plugins` 独立多插件仓库设计，实时拉取 GitHub Releases（如 `dsh-model-roles@v0.4.8`、`dsh-remote-control@v0.1.6` 等），并自动读取当前 DSH profile 中已安装插件的版本，逐项标记「已安装 → 最新 / 可更新」。
- **配置与镜像源管理**：支持切换 GitHub 仓库源、社区目录 URL 与下载镜像前缀（如 gh-proxy），配置写入 market 设置命名空间并持久化。
- **安全通信**：所有数据经宿主 `connection.rpc` 的 **loopback 专用通道** `/dsh-market-rpc` 交换，仅同源 Web 界面可调用；安装来源必须通过白名单校验（仓库 Release URL 或社区目录声明的 npm 包名），且同一时间只允许一个安装任务。

---

## 📦 安装方式

使用 DSH 官方 CLI 安装本插件：

```bash
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-market@v0.1.2/dsh-market-0.1.2.tgz
```

或使用本地打包安装：

```bash
cd plugins/dsh-market
npm pack
dsh plugin add --profile web ./plugins/dsh-market/dsh-market-0.1.2.tgz
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

测试覆盖：语义化版本比对、Monorepo Release 标签解析与下载地址生成、社区目录归一化与分类提取、安装来源白名单校验、profile 已安装版本读取与更新标记、安装任务执行（fake spawn 验证 CLI 参数与并发限制）、RPC 请求处理（网络已打桩）、客户端 Bundle 与 cordis 补丁一致性校验。

---

## 📄 License
MIT
