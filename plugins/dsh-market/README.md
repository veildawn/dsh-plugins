# dsh-market (DeepSeek Harness 社区插件市场与仓库更新管理器)

[![npm](https://img.shields.io/npm/v/dsh-market)](https://www.npmjs.com/package/dsh-market)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

DeepSeek Harness (DSH) 可视化插件市场与本仓库专有更新管理插件。

---

## ✨ 核心特性

- **插件发现与浏览**：在 Web 设置面板（Settings → **插件市场**）中直接查看官方精选与社区插件，支持**分类筛选**（21 类）、模糊搜索与标签过滤（数据源：awesome-dsh-plugin.com，自动走系统代理）。
- **一键批量更新 (N)**：在「自有插件」与「社区插件」栏目中均提供「🚀 一键更新全部 (N)」按钮，自动统计可更新数量并批量执行更新（更新后绝不自动重启）。
- **一键安装 / 更新 / 卸载**：真实执行 `dsh plugin add` 和 `dsh plugin remove`（服务端白名单校验来源后运行），带实时进度日志；支持一键卸载已装插件并自动刷新状态；自有插件支持「安装 / 更新到最新 / 已是最新 / 卸载」，社区插件按 npm 包一键安装与卸载。
- **静默直接复制指令**：点击「复制指令」直接将精准的 CLI 安装/更新命令写入系统剪贴板，绝不跳出弹窗确认。
- **异步平滑重启与自动恢复**：提供手动「🔄 立即重启 DSH 服务」按钮，服务端延迟异步重启后台守护进程，前端无缝自动探测端口，服务重新就绪后自动刷新恢复页面。
- **自有插件专属管理**：专为 `veildawn/dsh-plugins` 独立多插件仓库设计，实时拉取 GitHub Releases（如 `dsh-model-roles@v0.4.8`、`dsh-remote-control@v0.1.6` 等），并自动读取当前 DSH profile 中已安装插件的版本，逐项标记「已安装 → 最新 / 可更新 / 卸载」。
- **安全与局域网放行**：RPC 通道注册为 `trusted-host` 权限，支持从本机（localhost/127.0.0.1）以及 `connection.trustedHosts` 白名单配置的局域网客户端直接调用；安装与卸载来源必须通过白名单校验，且同一时间只允许一个任务执行。

---

## 📦 安装方式

使用 DSH 官方 CLI 安装本插件：

```bash
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-market@v0.1.5/dsh-market-0.1.5.tgz
```

或使用本地打包安装：

```bash
cd plugins/dsh-market
npm pack
dsh plugin add --profile web ./plugins/dsh-market/dsh-market-0.1.5.tgz
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
