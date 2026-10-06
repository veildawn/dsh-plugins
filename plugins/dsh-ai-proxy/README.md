# dsh-ai-proxy

DeepSeek Harness 的 AI Proxy Provider 插件。`0.3.0` 起插件不再自带 wire 协议实现——三种
API 格式（Chat/completions、Anthropic messages、Responses）全部由宿主官方
`llm-pi-ai` 适配器执行，本插件负责 OAuth 2.0 PKCE 登录、模型发现，并把网关"材料化"为
`llm-pi-ai:` 设置节中的一条声明式路由（`providers.ai-proxy`）。

## 宿主要求

需要内置休眠挂载 `llm-pi-ai` 的 DSH 宿主（`@deepseek-ai/dsh` ≥ `0.1.5-rc`）。宿主过旧时
插件正常加载、OAuth 正常工作，但会记录一条警告并跳过路由材料化（模型选择器中不出现
AI Proxy 模型）。

设置卡片在两类宿主设置接口上都能工作：

- **0.1.7 及今后的 `SettingsForms` 接口**（`ctx.settings.describe/mutate`）：网关字段必须是
  schema 声明的 **live（volatile）字段**，否则宿主的写入会直接拒绝：
  `Plugin entry "llm-ai-proxy" has no volatile fields`，前端表现为
  `保存配置失败: Plugin entry "llm-ai-proxy" has no volatile fields`。插件把 `baseURL`、
  `apiFormat`、`defaultReasoningEffort` 声明为 live 字段（需要宿主的 schemastery ≥ `3.18.4`
  才实现 `.volatile()`），写入落在 profile 的 `cordis.patch.yml` 行 `llm-ai-proxy` 上，并由
  Loader 原地更新运行中的 fiber——**不需要重启**。
- **0.1.0-rc 线的 `settings.register` 接口**：插件沿用旧的命名空间 `ai-proxy`，值写在
  `settings.yaml`；两条路径按宿主能力自动选择，互不干扰。

## 架构

```
DSH ──> 宿主官方 llm-pi-ai 适配器（三协议、usage/finish 映射、图片、重试）──> 网关
         ▲
         │ 宿主设置文档的 llm-pi-ai.providers.ai-proxy（本插件写入）
dsh-ai-proxy：
  - OAuth 登录/刷新/撤销，access token 存 AIPROXY_ACCESS_TOKEN 凭据引用
  - 主动刷新定时器在过期前轮换 token（路由的 apiKeyEnv 按请求解析，新 token 自动生效）
  - GET /v1/models 发现套餐模型，把 effort_levels 映射为 llm-pi-ai reasoningEfforts
  - 设置卡片 + /ai-proxy-auth Host RPC（登录/登出/状态/刷新模型）
```

- 提供方路由名仍是 `ai-proxy`（llm-pi-ai providers 字典键即路由名），升级后存量会话的
  模型地址不变。
- `apiKeyEnv` 指向 OAuth 已在写的 `AIPROXY_ACCESS_TOKEN` 凭据引用——零配置桥接；官方
  适配器逐请求解析该引用，token 轮换后下一个请求自动使用新值，无需重启或通知。
- 旧的流式 401 即时轮换随协议层一起移交给官方适配器；插件改用过期前主动刷新
  （`AIPROXY_TOKEN_EXPIRY` 内嵌 30 秒余量，失败按指数退避重试）。
- 每请求动态头 `x-ai-proxy-session-id` 无法由静态路由头表达，已随协议层移除；静态头
  `x-ai-proxy-client: dsh` 保留。
- 材料化只写 `providers.ai-proxy` 这一个键：用户手工配置的其他 llm-pi-ai 路由不受影响。
  登出且无静态密钥时该键被移除；插件卸载时材料化路由保留在 settings.yaml，重新登录即恢复。

## effort 阶梯映射

网关 `effort_levels` 映射为官方适配器的 `reasoningEfforts` 字典（键 = DSH 选择器档位，
值 = wire 拼写）：

- 标准档位（`minimal`/`low`/`medium`/`high`/`xhigh`/`max`）保持原拼写；
- `off`/`none` 映射为 `off: null`（支持该档但不发送参数）；
- 非标准档位（如 `ultra`/`turbo`）按强度就近借用空闲选择器键，wire 拼写原样保留
  （例如 `max: ultra`——选择器显示 max，请求发 `ultra`）；
- 无 ladder 的模型标记 `reasoningEfforts: false`（非推理模型）。

`defaultReasoningEffort`（`highest`/`lowest`/精确档位）只按**当前模型自己的 ladder** 解析，
不写入路由级 `profile.reasoning`。那个字段是整条路由共用的一个静态档位：全目录的
`highest` 会变成 `max`，而只支持 `low`/`medium`/`high` 的模型在未显式指定档位的
直调（`/compact`、会话标题）里会因此被拒绝。解析挂在三处：模型选择器
（`resolveModelInfo`）、显式解析配置（`resolveCallConfig`）、以及 `llm/stream`
（直调在进入官方适配器前补上该模型自己的档位）。启动时也会清掉材料化路由上遗留的
`reasoning`，即使这次网关发现失败、目录本身保留不动。

Chat Completions / Responses 路由会带上 `compat.supportsDeveloperRole: false`。自定义
网关的 `provider`/`baseURL` 对 pi-ai 来说不像官方 DeepSeek，推理模型默认会把 system
prompt 改写成 `role: "developer"`，而 DeepSeek / GLM 等上游只接受
`system`/`user`/`assistant`/`tool`。Anthropic Messages 不使用该开关，材料化时省略。

## 安装

```sh
# 从 GitHub Release 安装指定版本
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-ai-proxy@v0.3.11/dsh-ai-proxy-0.3.11.tgz

# 或使用本地打包产物
dsh plugin add --profile web ./dsh-ai-proxy-0.3.11.tgz
```

### 重启生效

`@deepseek-ai/dsh` 官方 CLI 本身并不提供 `service` 子命令，执行 `dsh service restart` 会报错。请使用本仓库自带的控制脚本：

- **macOS / Linux**：
  ```bash
  ./scripts/dsh-web.sh restart
  ```
- **Windows**：
  ```powershell
  .\scripts\dsh-web.ps1 restart
  # 或 cmd:
  scripts\dsh-web.cmd restart
  ```

插件自带 `cordis.patch.yml`。手动 Cordis 配置等价于：

```yaml
- insert:
    - id: llm-ai-proxy
      name: dsh-ai-proxy
      config:
        baseURL: http://localhost:18080
        clientId: dsh
```

重启后在 **设置 → AI Proxy** 中填写网关地址并点击“登录”。浏览器将打开授权页，Host
在 `127.0.0.1` 创建一次性回调监听器并完成 code + PKCE verifier 交换。登录成功后插件自动
发现模型并材料化路由。

## 凭据生命周期

- `AIPROXY_ACCESS_TOKEN`：OAuth access token；
- `AIPROXY_REFRESH_TOKEN`：轮换 refresh token；
- `AIPROXY_TOKEN_EXPIRY`：提前 30 秒计算的到期时间（主动刷新定时器据此排期）；
- 默认静态密钥引用也是 `AIPROXY_ACCESS_TOKEN`，可通过 `apiKeyEnv` 改写。

令牌只存放在宿主凭据库，永不进入设置文档。登出会调用网关 `/oauth/revoke`，清除 OAuth 凭据
并移除材料化路由。

### 多机部署：每台机器一个 Client ID

网关对 `(用户, client_id)` 只维护一条活跃授权，并采用 refresh token 单向轮换（RFC 9700）。
如果多台机器共用同一个 `client_id`，其中一台刷新后，另一台在到期前发起的刷新会被判定为
**令牌重放**，网关随即吊销整个授权，两台机器同时掉成“未登录”。

因此插件把 `clientId` 的默认值 `dsh` 视为**共享占位符**，而不是可用配置：

- 启动或点击登录时，若仍是 `dsh`，会自动改写为 `dsh-` 加 8 位随机后缀（例如
  `dsh-3f9a1c02`）并持久化到设置节；同时丢掉本地旧令牌，不再拿它去刷新共享授权。
- 自动分配失败（设置不可写、profile 把 `clientId` 固定为 `dsh`）时会停止自动刷新并报错，
  绝不继续用 `dsh` 轮换。
- 自定义值（如 `dsh-work` / `dsh-laptop`）会被保留，覆盖安装不会换掉它。
- 已分配后不允许再改回 `dsh`；改成另一个自定义值会清除本地令牌并要求重新登录。
- 升级后每台机器只需重新登录一次，之后各走各的 refresh 链，互不影响。

设置的 **AI Proxy 卡片**里可以直接查看和修改当前 Client ID。

## 模型发现

插件使用 Bearer 凭据调用 `GET /v1/models`，默认缓存 5 分钟；"重新获取模型列表"按钮强制
刷新并重写材料化路由。网关不可达或没有凭据时回退到 `models` 静态目录；材料化永远不会用
空目录覆盖上一次的好目录。`input_modalities` 决定模型声明 `['text','image']` 还是
`['text']`，未声明时按文本处理。

## 配置

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `baseURL` | `http://localhost:18080` | OAuth、模型目录和材料化路由共用网关地址 |
| `apiFormat` | `chat/completions` | API 格式（决定材料化路由的协议与端点拼写）：`chat/completions`、`anthropic-messages`、`responses` |
| `clientId` | `dsh` | OAuth public client id。`dsh` 只是共享占位：启动或登录时会改成 `dsh-` 加 8 位随机后缀并丢掉旧令牌，避免多台机器共用一条 refresh 链互相踢下线。自定义值会保留 |
| `apiKeyEnv` | `AIPROXY_ACCESS_TOKEN` | 静态密钥凭据引用（材料化路由的 apiKeyEnv 同名） |
| `defaultReasoningEffort` | `'highest'` | 当前模型的默认思考档位，不写入路由级 `reasoning`。`highest` 选该模型自己 ladder 的最高档；`lowest` 用第一档；精确档位名优先精确匹配，缺失时落到最近的较低档 |
| `maxTokens` | `65536` | 材料化为路由 `defaultMaxTokens`；模型目录未提供输出上限时生效 |
| `defaultContextWindow` | `200000` | 材料化为路由 `defaultContextWindow` |
| `modelCacheTtlMs` | `300000` | 模型目录缓存时间 |
| `streamIdleTimeoutMs` | `300000` | 材料化为路由 `streamIdleTimeoutMs`（流空闲看门狗由官方适配器执行） |
| `models` | `[]` | 离线静态兜底目录 |
| `retryPolicy` | DSH 默认值 | 材料化为路由 `retryPolicy`（重试由官方适配器执行） |

`remoteAccess` 和 `remoteAuthSecret` 已从 0.2.0 配置 schema 删除。升级后可从旧 `ai-proxy`
设置段移除这两个字段。

`baseURL`、`apiFormat`、`defaultReasoningEffort` 对宿主是 **live 字段**：改完立即作用于运行中
的插件（OAuth、模型发现、材料化路由全部按新值走），不触发重载；其余字段是普通配置，改动
后由 Loader 按常规生命周期重新应用插件。

## 远程访问

本插件不会注册 `/dsh-remote-control`、`/ai-proxy-remote-control`，不会修改浏览器
`localStorage`，也不会挂载 Unlock Screen。需要远程设置/凭据桥接时单独安装：

```sh
dsh plugin --profile web add ./dsh-remote-control-0.1.5.tgz
```

OAuth 认证接口 `/ai-proxy-auth` 使用连接默认访问策略，可由局域网客户端直接调用；远程控制
插件仍不会把任意 RPC 通道加入白名单。

## 手动验证清单（部署后）

1. 登录后宿主设置文档出现 `llm-pi-ai.providers.ai-proxy`（api/baseURL/模型目录；chat/completions 与 responses 带 `compat.supportsDeveloperRole: false`；**没有**路由级 `reasoning`）——0.1.7 宿主是 `~/.dsh/profiles/<profile>/cordis.patch.yml` 的 `llm-pi-ai` 行，0.1.0-rc 宿主是 `~/.dsh/settings.yaml`。
2. 模型选择器出现 `ai-proxy` 路由的模型，effort 档位与网关 ladder 一致。
3. 三种 apiFormat 各发一轮对话：chat/completions 与 responses 的 `baseURL` 带 `/v1`，
   anthropic-messages 的 `baseURL` 为根地址（SDK 自拼 `/v1/messages`）。
4. token 过期前观察 `AIPROXY_ACCESS_TOKEN` 被主动轮换，会话不中断。
5. 网关侧不再收到 `x-ai-proxy-session-id` 头（已随协议层移除）。
6. **设置 → AI Proxy** 改网关地址后点“保存”：不再出现
   `保存配置失败: Plugin entry "llm-ai-proxy" has no volatile fields`，profile 补丁里
   `llm-ai-proxy` 行的 `config.baseURL` 立即更新，且插件无需重启即可用新网关登录/拉模型。

## 开发与测试

```sh
npm test
npm pack --dry-run
```

`npm test` 先跑 `node --test` 的三个用例文件（core/client/smoke，全部使用内置的旧接口假件），
再跑 `test/host-live-settings.mjs`——它把插件拷进一个临时目录、把 `@deepseek-ai` 作用域指向
PATH 上 `dsh` 所在的宿主安装，然后用宿主的**真实** `Loader`（真 entry/fiber）、真实
`SettingsForms`（`describe`/`mutate`）和真实 schemastery volatile 引用跑一遍“设置卡片保存”
的完整链路；机器上没有 `dsh` 或宿主过旧时打印 `SKIP` 并以 0 退出，CI 不受影响。

`lib/index.js` 是 Host Provider（材料化 + OAuth 门面），`lib/oauth.js` 管理 OAuth 生命周期，
`lib/client.js` 仅提供 AI Proxy 设置卡。所有 Host 文件均为 ESM，浏览器入口是 DSH
ModuleLoader 格式。
