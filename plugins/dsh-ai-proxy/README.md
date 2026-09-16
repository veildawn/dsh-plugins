# dsh-ai-proxy

DeepSeek Harness 的 AI Proxy Provider 插件。`0.3.0` 起插件不再自带 wire 协议实现——三种
API 格式（Chat/completions、Anthropic messages、Responses）全部由宿主官方
`llm-pi-ai` 适配器执行，本插件负责 OAuth 2.0 PKCE 登录、模型发现，并把网关"材料化"为
`llm-pi-ai:` 设置节中的一条声明式路由（`providers.ai-proxy`）。

## 宿主要求

需要内置休眠挂载 `llm-pi-ai` 的 DSH 宿主（`@deepseek-ai/dsh` ≥ `0.1.5-rc`）。宿主过旧时
插件正常加载、OAuth 正常工作，但会记录一条警告并跳过路由材料化（模型选择器中不出现
AI Proxy 模型）。

## 架构

```
DSH ──> 宿主官方 llm-pi-ai 适配器（三协议、usage/finish 映射、图片、重试）──> 网关
         ▲
         │ settings.yaml 的 llm-pi-ai.providers.ai-proxy（本插件写入）
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

`defaultReasoningEffort` 的 `highest`/`lowest`/精确档语义不变，解析结果换算为选择器键
后作为路由级 `reasoning` 默认档写入。

## 安装

```sh
dsh plugin --profile web add ./dsh-ai-proxy-0.3.0.tgz
dsh service restart
```

`dsh service restart` 依赖宿主打包的 systemd/launchd 单元；**这套 CLI（`@deepseek-ai/dsh`）
本身并不提供 `service` 子命令**（见 `dsh --help`，只有根命令、`web`、`plugin`），在没有那层封装的
环境——包括 Windows——执行会直接报错 `error: too many arguments`。Windows 下改用本仓库的
[`scripts/dsh-service.ps1`](../../scripts/dsh-service.ps1)：

```powershell
powershell -File scripts/dsh-service.ps1 restart -Profile web
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

令牌永不进入 `settings.yaml`。登出会调用网关 `/oauth/revoke`，清除 OAuth 凭据并移除材料化
路由。

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
| `clientId` | `dsh` | OAuth public client id |
| `apiKeyEnv` | `AIPROXY_ACCESS_TOKEN` | 静态密钥凭据引用（材料化路由的 apiKeyEnv 同名） |
| `defaultReasoningEffort` | `'highest'` | 默认思考档位。`highest` 选该模型最高已知档；`lowest` 使用网关 ladder 第一档；精确档位名优先精确匹配，缺失时落到最近的较低档 |
| `maxTokens` | `65536` | 材料化为路由 `defaultMaxTokens`；模型目录未提供输出上限时生效 |
| `defaultContextWindow` | `200000` | 材料化为路由 `defaultContextWindow` |
| `modelCacheTtlMs` | `300000` | 模型目录缓存时间 |
| `streamIdleTimeoutMs` | `300000` | 材料化为路由 `streamIdleTimeoutMs`（流空闲看门狗由官方适配器执行） |
| `models` | `[]` | 离线静态兜底目录 |
| `retryPolicy` | DSH 默认值 | 材料化为路由 `retryPolicy`（重试由官方适配器执行） |

`remoteAccess` 和 `remoteAuthSecret` 已从 0.2.0 配置 schema 删除。升级后可从旧 `ai-proxy`
设置段移除这两个字段。

## 远程访问

本插件不会注册 `/dsh-remote-control`、`/ai-proxy-remote-control`，不会修改浏览器
`localStorage`，也不会挂载 Unlock Screen。需要远程设置/凭据桥接时单独安装：

```sh
dsh plugin --profile web add ./dsh-remote-control-0.1.5.tgz
```

OAuth 认证接口 `/ai-proxy-auth` 使用连接默认访问策略，可由局域网客户端直接调用；远程控制
插件仍不会把任意 RPC 通道加入白名单。

## 手动验证清单（部署后）

1. 登录后 `~/.dsh/settings.yaml` 出现 `llm-pi-ai.providers.ai-proxy`（api/baseURL/模型目录）。
2. 模型选择器出现 `ai-proxy` 路由的模型，effort 档位与网关 ladder 一致。
3. 三种 apiFormat 各发一轮对话：chat/completions 与 responses 的 `baseURL` 带 `/v1`，
   anthropic-messages 的 `baseURL` 为根地址（SDK 自拼 `/v1/messages`）。
4. token 过期前观察 `AIPROXY_ACCESS_TOKEN` 被主动轮换，会话不中断。
5. 网关侧不再收到 `x-ai-proxy-session-id` 头（已随协议层移除）。

## 开发与测试

```sh
npm test
npm pack --dry-run
```

`lib/index.js` 是 Host Provider（材料化 + OAuth 门面），`lib/oauth.js` 管理 OAuth 生命周期，
`lib/client.js` 仅提供 AI Proxy 设置卡。所有 Host 文件均为 ESM，浏览器入口是 DSH
ModuleLoader 格式。
