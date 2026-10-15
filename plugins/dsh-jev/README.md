# dsh-jev

DeepSeek Harness (DSH) 原生插件：集成 TypeSafe Jev (System One 决策模型)。

Jev 专门处理结构化决策、意图分流与状态打分（70ms 级低延迟、强类型、带校准概率）。

## 特性

- **进程内直连**：零子进程冷启动开销，原生注册 `jev_decide` 工具。
- **三类决策原语**：原生支持 `choice`（单选）、`score`（阶梯打分）、`noul`（Yes/No 概率）。
- **多级密钥解析**：支持插件配置显式 `apiKey`、环境变量（`$TYPESAFE_API_KEY` / `$JEV_API_KEY`）及本地配置自动兜底。
- **代理访问**：可在前端设置面板填写代理地址，填写后发往 `*.typesafe.ai` 的请求全部经代理转发；留空即直连。
- **双重触达表面**：提供模型原生 Tool 与可选的常驻提示词切面（Policy Section），自动引导 Agent 何时调用 Jev。
- **高韧性网络**：适配 DSH `AbortSignal` 随时取消，429 配额保护，5xx 自动指数退避重试。

## 配置与参数

在 `cordis.patch.yml` 或 Profile 配置中指定：

```yaml
- insert:
    - id: tool-jev
      name: './lib/index.js'
      config:
        apiKey: ''                  # 可选，显式指定 TypeSafe API Key
        apiKeyEnv: TYPESAFE_API_KEY # 可选，默认读取的环境变量名称
        model: jev-latest           # 模型名称，默认 jev-latest
        timeoutMs: 60000            # 请求超时时间 (毫秒)
        retries: 0                  # 5xx / 瞬态故障重试次数
        proxy: ''                   # 可选，代理地址；留空/省略 = 直连
        proxyHosts: [typesafe.ai]   # 可选，走代理的目标主机（默认含其子域）
```

## 代理访问

在 **设置 → Jev 决策模型 → 代理地址** 中填写即可，保存后立即生效，无需重启。

- **留空表示直连**：这是默认状态，行为与不使用代理时完全一致。
- **填写后**：所有发往 `*.typesafe.ai` 的请求（含 `api.typesafe.ai`）都经该代理转发。
- **支持的协议**：`http://`、`https://`、`socks5://`、`socks5h://`；省略协议时按 `http://` 处理。
- **需要认证**：写成 `http://用户名:密码@主机:端口`。密码不会回显到界面，也不会出现在错误信息中。
- **代理范围**：默认只代理 `typesafe.ai` 及其子域，其它主机仍然直连；如需调整，配置 `proxyHosts`
  （例如 `proxyHosts: ['*']` 表示全部走代理）。
- **优先级**：Profile 配置中的 `proxy` 优先于界面设置；一旦在 Profile 里写死，界面输入框会置灰。
- **持久化**：界面保存的代理写入 `~/.config/typesafe/settings.json`（不写入 Profile 配置）。
- **TLS 校验**：始终校验 `api.typesafe.ai` 的证书，不提供关闭校验的开关。

> 说明：`socks5://` 由本机解析 DNS 后按 IP 连接，`socks5h://` 则把域名交给代理解析（适合本地 DNS 受限的环境）。
> 代理传输层零第三方依赖，仅使用 Node 内置模块。

## 测试

```bash
npm test
```
