# dsh-plugins (DeepSeek Harness Community Plugins)

官方 DeepSeek Harness (DSH) 社区插件集与开发工作区，包含开箱即用的 DSH 插件及开发模板。

---

## 📦 插件列表 (Included Plugins)

| 插件名称 | 目录 | 说明 | 版本 |
| :--- | :--- | :--- | :--- |
| **`dsh-mobile-adapter`** | [`plugins/dsh-mobile-adapter`](plugins/dsh-mobile-adapter) | DSH 全量移动端适配方案（触控优化、视口高度贴合、Pill Tabs、全量弹窗防溢出、创造模式/PTC 模式呈现等） | `0.1.5` |
| **`dsh-ai-proxy`** | [`plugins/dsh-ai-proxy`](plugins/dsh-ai-proxy) | AI Proxy OAuth 2.0 PKCE、LLM Provider、模型发现与推理档位 | `0.2.0` |
| **`dsh-remote-control`** | [`plugins/dsh-remote-control`](plugins/dsh-remote-control) | 独立的远程 Unlock Screen、密钥认证与特权 RPC 白名单桥接 | `0.1.0` |

---

## 🚀 插件安装指南 (Installation)

### 方式 1：使用 DSH 官方 CLI 一键安装（推荐）

直接在终端执行安装（以远程通道插件为例）：

```bash
# 1. 在 profile 下安装对应插件
dsh profile --name web plugin add ./plugins/dsh-remote-control/dsh-remote-control-0.1.0.tgz

# 2. 重启 DSH 服务即可生效
dsh service restart
```

### 方式 2：使用 pnpm / npm 手动安装

```bash
cd ~/.dsh/profiles/web

# 安装插件
pnpm add <插件路径或打包好的tgz包>

# 重启 DSH 服务
```

### AI Proxy 与远程通道组合使用

两个插件已完全解耦，可独立安装。既需要 AI Proxy Provider 又需要公网远程门禁时分别安装：

```bash
dsh profile --name web plugin add ./plugins/dsh-ai-proxy/dsh-ai-proxy-0.2.0.tgz
dsh profile --name web plugin add ./plugins/dsh-remote-control/dsh-remote-control-0.1.0.tgz
dsh service restart
```

随后在本机 **设置 → 远程控制** 设置 `DSH_REMOTE_CONTROL_SECRET` 并启用远程访问。新通道为
`/dsh-remote-control`，旧 `/ai-proxy-remote-control` 仅作为兼容别名保留。部署到公网时仍须
配置 HTTPS 与 DSH `--trusted-host`。

---

## 🛠️ 本地开发与测试 (Development)

本项目采用 Monorepo 结构进行多插件统一管理与测试：

```bash
# 进入各插件目录运行单元测试
cd plugins/dsh-mobile-adapter
node --test test/mobile-adapter.test.mjs

cd ../dsh-ai-proxy
node --test test/

cd ../dsh-remote-control
node --test test/
```

### 打包插件
```bash
cd plugins/<plugin-name>
npm pack
```

---

## 📄 License
MIT
