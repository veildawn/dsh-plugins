# dsh-ai-proxy

DeepSeek Harness 的 AI Proxy LLM Provider 插件。`0.2.0` 起只负责 AI Proxy 网关、OAuth
2.0 PKCE、模型发现与推理，不再包含远程通道或锁屏门禁；远程访问请安装独立的
`dsh-remote-control`。

## 功能

- 注册 `ai-proxy` LLM Provider，支持 `Chat/completions`、`Anthropic messages` 和 `Responses` 三种 API 格式，后台根据所选格式智能匹配 API 路径与协议。
- OAuth 2.0 Authorization Code + PKCE S256 登录、刷新令牌轮换与登出撤销。
- access/refresh/expiry 只写入 DSH 凭据仓，不写入 `settings.yaml`。
- 使用账号凭据请求 `/v1/models`，同步套餐允许的模型、上下文窗口、输入模态和
  `effort_levels`。
- 将每个模型的 `effort_levels` 原样映射为 DSH reasoning effort，并以
  `reasoning_effort` 原样发送。
- 支持用户消息中的图片，将 DSH attachment 转为 OpenAI `image_url` data URL。
- 提供独立的 **设置 → AI Proxy** 卡片及支持局域网客户端的 `/ai-proxy-auth` 认证通道。

## 安装

```sh
dsh plugin --profile web add ./dsh-ai-proxy-0.2.7.tgz
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
在 `127.0.0.1` 创建一次性回调监听器并完成 code + PKCE verifier 交换。

## 凭据生命周期

- `AIPROXY_ACCESS_TOKEN`：OAuth access token；
- `AIPROXY_REFRESH_TOKEN`：轮换 refresh token；
- `AIPROXY_TOKEN_EXPIRY`：提前 30 秒计算的到期时间；
- 默认静态密钥引用也是 `AIPROXY_ACCESS_TOKEN`，可通过 `apiKeyEnv` 改写。

每次操作重新解析凭据。access token 到期时使用 single-flight 刷新；流式推理遇到 401 时
强制刷新一次，并仅重试一次。登出会调用网关 `/oauth/revoke`，再清除 OAuth 凭据。

## 模型与推理

插件使用 Bearer 凭据调用 `GET /v1/models`，默认缓存 5 分钟。网关不可达或没有凭据时，
回退到 `models` 静态目录；静态目录只是可用性兜底，不是请求白名单。

`input_modalities` 包含 `image` 时，DSH 模型信息声明 `['text', 'image']`；明确只包含文本时
声明 `['text']`；未声明时保持未知，不擅自禁用图片。系统消息、助手消息无法在 OpenAI wire
中表示图片，会返回 `UNSUPPORTED_CONTENT`；工具结果（`tool-result`）中的图片则会被优雅处理：
Chat Completions 与 Anthropic 协议下按消息拆分注入（OpenAI `image_url` data URL /
Anthropic `image` base64 块），无附件服务或读取失败时降级为 `[Image: <id>]` 占位文本，不再让会话崩溃。

## 配置

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `baseURL` | `http://localhost:18080` | OAuth、模型目录和推理共用网关地址 |
| `apiFormat` | `chat/completions` | API 格式：`chat/completions`、`anthropic-messages`、`responses` |
| `clientId` | `dsh` | OAuth public client id |
| `apiKeyEnv` | `AIPROXY_ACCESS_TOKEN` | 静态密钥凭据引用 |
| `defaultReasoningEffort` | `''` | 切换模型时的默认思考档位。空值或 `lowest` 使用网关 ladder 第一档；`highest` 选该模型最高已知档；精确档位名优先精确匹配，缺失时落到最近的较低档 |
| `maxTokens` | `65536` | 模型目录未提供时的输出上限 |
| `defaultContextWindow` | `200000` | 模型目录未提供时的上下文窗口 |
| `modelCacheTtlMs` | `300000` | 模型目录缓存时间 |
| `streamIdleTimeoutMs` | `300000` | SSE 流空闲超时 |
| `models` | `[]` | 离线静态兜底目录 |
| `retryPolicy` | DSH 默认值 | `dsh-llm` 重试策略 |

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

## 开发与测试

```sh
npm test
npm pack --dry-run
```

`lib/index.js` 是 Host Provider，`lib/oauth.js` 管理 OAuth 生命周期，`lib/client.js` 仅提供
AI Proxy 设置卡。所有 Host 文件均为 ESM，浏览器入口是 DSH ModuleLoader 格式。