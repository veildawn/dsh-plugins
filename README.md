# dsh-plugins (DeepSeek Harness Community Plugins)

官方 DeepSeek Harness (DSH) 社区插件集与开发工作区，包含开箱即用的 DSH 插件及开发模板。

---

## 📦 插件列表 (Included Plugins)

| 插件名称 | 目录 | 说明 | 版本 |
| :--- | :--- | :--- | :--- |
| **`dsh-mobile-adapter`** | [`plugins/dsh-mobile-adapter`](plugins/dsh-mobile-adapter) | DSH 全量移动端适配方案（触控优化、视口高度贴合、Pill Tabs、全量弹窗防溢出、创造模式/PTC 模式呈现等） | `0.1.5` |
| **`dsh-ai-proxy`** | [`plugins/dsh-ai-proxy`](plugins/dsh-ai-proxy) | AI Proxy 远程管理与凭证/设置桥接插件（Cordis 远程通道、锁屏门禁与配置同步） | `0.1.22` |

---

## 🚀 插件安装指南 (Installation)

### 方式 1：使用 DSH 官方 CLI 一键安装（推荐）

直接在终端执行安装（以 `dsh-mobile-adapter` 为例）：

```bash
# 1. 在 profile 下安装对应插件
dsh profile --name web plugin add ./plugins/dsh-mobile-adapter/dsh-mobile-adapter-0.1.5.tgz

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

---

## 🛠️ 本地开发与测试 (Development)

本项目采用 Monorepo 结构进行多插件统一管理与测试：

```bash
# 进入各插件目录运行单元测试
cd plugins/dsh-mobile-adapter
node --test test/mobile-adapter.test.mjs

cd ../dsh-ai-proxy
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
