# dsh-plugins (DeepSeek Harness Community Plugins)

官方 DeepSeek Harness (DSH) 社区插件 Monorepo 工作区。每个插件**独立版本管理、独立测试、按需独立发布 Release**。

---

## 📦 插件列表 (Plugins Roster)

| 插件名称 | 目录 | 说明 | 最新独立版本 |
| :--- | :--- | :--- | :--- |
| **`dsh-plugin-manager`** | [`plugins/dsh-plugin-manager`](plugins/dsh-plugin-manager) | 插件管理中心与自有插件更新/卸载管理器（专属拼图图标、移动端全量响应式触控适配、自有插件一键批量更新(N)、支持配置 GitHub Token 提升 API 配额至 5000次/小时并提供 Atom feed 无感兜底、社区21分类、静默直接复制指令、剪贴板写入全路径兜底、异步平滑重启与自动恢复） | [`v0.3.42`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-plugin-manager@v0.3.42) |
| **`dsh-model-roles`** | [`plugins/dsh-model-roles`](plugins/dsh-model-roles) | 模型角色路由、自动分工、识图子代理、计划模式与顾问复核 (`/advisor`、局域网访问放行、专属分支路由图标) | [`v0.4.29`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-model-roles@v0.4.29) |
| **`dsh-remote-control`** | [`plugins/dsh-remote-control`](plugins/dsh-remote-control) | 通用 DSH 远程/局域网访问安全控制与特权通道插件（Token 密钥认证、密码锁屏门禁 Unlock Screen、特权 RPC 白名单桥接、HTTP 非安全上下文全局兼容、专属地球网络图标、桌面端/Web版局域网地址自识别与端口展示、卡片化设置面板与访问地址一键复制） | [`v0.1.20`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-remote-control@v0.1.20) |
| **`dsh-ai-proxy`** | [`plugins/dsh-ai-proxy`](plugins/dsh-ai-proxy) | AI Proxy Service 网关对接插件（协议层外包给宿主官方 llm-pi-ai 适配器并自动材料化路由、Chat/completions/Anthropic messages/Responses 三格式、最高推理强度开关、OAuth 2.0 PKCE 认证、令牌过期前主动轮换与阶梯推理映射、把网关 `/v1/models` 的 `modality`（text/image/decision）写入材料化路由供静态判断） | [`v0.3.15`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-ai-proxy@v0.3.15) |
| **`dsh-mobile-adapter`** | [`plugins/dsh-mobile-adapter`](plugins/dsh-mobile-adapter) | DSH 移动端全量体验优化（原生图片/相册上传、工作区工具箱整合文件查看器/本地终端/提示词历史、移动端右侧栏避让与一键返回对话、对话框底部全操作按钮圆形统一规范、视口高度自适应、Segmented Control Tabs、全量弹窗防溢出、输入区聚焦防整页放大） | [`v0.1.44`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-mobile-adapter@v0.1.44) |
| **`dsh-file-viewer`** | [`plugins/dsh-file-viewer`](plugins/dsh-file-viewer) | 工作区文件查看器（PC端全屏切换、移动端触屏长按右键菜单防抖与底部抽屉、路径复制与@引用、语法高亮、Markdown/JSON、图片、PDF、Excel、Word） | [`v0.2.3`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-file-viewer@v0.2.3) |
| **`dsh-terminal`** | [`plugins/dsh-terminal`](plugins/dsh-terminal) | 跨平台本地交互式终端（移动端专属对话框底部工具箱二合一入口、PC端隐藏、多标签并发、触控辅助键盘） | [`v0.1.14`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-terminal@v0.1.14) |
| **`dsh-archive-manager`** | [`plugins/dsh-archive-manager`](plugins/dsh-archive-manager) | 会话归档管理器（侧边栏实时归档计数徽章、一键恢复会话与彻底删除清理磁盘空间） | [`v0.2.12`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-archive-manager@v0.2.12) |
| **`dsh-prompt-history`** | [`plugins/dsh-prompt-history`](plugins/dsh-prompt-history) | 提示词历史导航、修改重发与跨端同步器（已发气泡悬浮✏️修改与🔄重发、移动端提示词按钮归入工作区工具箱、自适应底部抽屉、严格会话绑定防串门、宿主持久化跨端漫游） | [`v0.4.8`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-prompt-history@v0.4.8) |
| **`dsh-zcode-theme`** | [`plugins/dsh-zcode-theme`](plugins/dsh-zcode-theme) | ZCode Design System 视觉系统（深炭灰画布、暖橙红品牌色、首屏直出零闪烁、全量剔除宿主默认蓝、PC/平板/移动端共享视觉Token与气泡/输入框/终端材质全面重塑） | [`v0.1.37`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-zcode-theme@v0.1.37) |
| **`dsh-jev`** | [`plugins/dsh-jev`](plugins/dsh-jev) | 决策模型原生工具插件（可直接下拉选择 dsh 已配置的提供商与模型，此时接口地址与 API Key 完全由提供商配置解析；也可手写 baseURL/Key/模型 ID。决策模型按 `/v1/models` 的 `modality`、静态 `modality`（含 dsh-ai-proxy 材料化写入）、classifier 协议、模型类型与名称识别；默认仍为 TypeSafe Jev 官方地址、Choice/Score/Noul 三大决策原语、/v1/systemone 与 /v1/decisions 端点切换、代理访问支持 http/https/socks5、常驻决策策略切面引导 Agent 何时调用） | [`v0.2.2`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-jev@v0.2.2) |
| **`dsh-image-gen`** | [`plugins/dsh-image-gen`](plugins/dsh-image-gen) | DSH 原生生图插件（把文生图作为原生工具暴露，可直接下拉选择 dsh 已配置的提供商与模型、或手动填写 baseURL/Key，内置尺寸与画质选择，支持 http/https/socks5 代理；设置面板可实时切换并测试连通性） | [`v0.1.2`](https://github.com/veildawn/dsh-plugins/releases/tag/dsh-image-gen@v0.1.2) |

---

## 🚀 插件安装指南 (Installation)

无需下载整个仓库，每个插件均提供独立的 `.tgz` 安装包。使用 DSH 官方 CLI 即可在线一键安装：

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
# 0. 安装插件管理中心 (自有插件更新与社区市场)
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-plugin-manager@v0.3.42/dsh-plugin-manager-0.3.42.tgz

# 1. 安装模型角色分工插件 (多模型智能路由与识图子代理)
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.29/dsh-model-roles-0.4.29.tgz

# 2. 安装远程安全通道插件 (推荐所有公网/局域网部署安装)
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-remote-control@v0.1.20/dsh-remote-control-0.1.20.tgz

# 3. 安装 AI Proxy 网关插件
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-ai-proxy@v0.3.15/dsh-ai-proxy-0.3.15.tgz

# 4. 安装移动端适配插件 (手机浏览器访问必备)
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-mobile-adapter@v0.1.44/dsh-mobile-adapter-0.1.44.tgz

# 5. 安装文件查看器插件 (会话头部抽屉浏览工作区文件)
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-file-viewer@v0.2.3/dsh-file-viewer-0.2.3.tgz

# 6. 安装本地终端插件 (跨平台原生终端调用与移动端适配)
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-terminal@v0.1.14/dsh-terminal-0.1.14.tgz

# 7. 安装会话归档管理器
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-archive-manager@v0.2.12/dsh-archive-manager-0.2.12.tgz

# 8. 安装提示词历史与跨端漫游
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-prompt-history@v0.4.8/dsh-prompt-history-0.4.8.tgz

# 9. 安装 ZCode 主题
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-zcode-theme@v0.1.37/dsh-zcode-theme-0.1.37.tgz

# 10. 安装决策模型（默认 TypeSafe Jev，也可选 dsh 已配置的提供商）
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-jev@v0.2.2/dsh-jev-0.2.2.tgz

# 11. 安装文生图 (生图模型) 插件
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-image-gen@v0.1.2/dsh-image-gen-0.1.2.tgz
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
./scripts/release.sh dsh-plugin-manager 0.3.38
./scripts/release.sh dsh-model-roles 0.4.28
./scripts/release.sh dsh-remote-control 0.1.18
./scripts/release.sh dsh-ai-proxy 0.3.12
./scripts/release.sh dsh-mobile-adapter 0.1.41
./scripts/release.sh dsh-file-viewer 0.1.49
./scripts/release.sh dsh-terminal 0.1.13
```
脚本会自动：
1. 运行对应插件的单元测试；
2. 执行 `npm pack`；
3. 打上 `plugin@vX.Y.Z` 格式的 Git Tag 并推送；
4. 自动创建对应的独立 GitHub Release 并上传 `.tgz`。

### 方式 2：CI/CD 自动触发
只要给仓库推送形如 `dsh-model-roles@v0.4.26` 的 Tag，GitHub Actions 将会自动检测对应插件目录并构建专属 Release。

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