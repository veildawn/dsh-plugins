# dsh-jev

DeepSeek Harness (DSH) 原生插件：集成 TypeSafe Jev (System One 决策模型)。

Jev 专门处理结构化决策、意图分流与状态打分（70ms 级低延迟、强类型、带校准概率）。

## 特性

- **进程内直连**：零子进程冷启动开销，原生注册 `jev_decide` 工具。
- **三类决策原语**：原生支持 `choice`（单选）、`score`（阶梯打分）、`noul`（Yes/No 概率）。
- **多级密钥解析**：支持插件配置显式 `apiKey`、环境变量（`$TYPESAFE_API_KEY` / `$JEV_API_KEY`）及本地配置自动兜底。
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
```

## 测试

```bash
npm test
```
