# dsh-jev

DeepSeek Harness (DSH) 原生「决策模型」插件：把结构化决策能力作为原生工具 `jev_decide` 暴露给模型。

默认对接 TypeSafe Jev (System One 决策模型)：70ms 级低延迟、强类型、带校准概率。但插件本身不再绑定 TypeSafe——你可以直接下拉选择 dsh 已经配置好的提供商与模型，也可以手写任意兼容决策协议的服务地址。

## 特性

- **两种配置来源**：
  - **dsh 已配置的提供商**：下拉选择 `llm-pi-ai` 里已有的 provider 与模型（例如本机的 `ai-proxy` / `jev-latest`），baseUrl、请求头、API Key 都按 dsh 自己的配置解析；
  - **手动配置**：手写 baseUrl + API Key + 模型 ID，默认仍是官方地址 `https://api.typesafe.ai`。
- **桌面端与 web 端同样可用**：插件不会只认 `$DSH_PROFILE`（那个变量只在模型 shell 调用时才由 dsh 临时注入，宿主进程里并没有），而是按 `$DSH_PROFILE` → 进程参数里的 profile 目录 / `--profile` → 插件自身的安装路径 → 机器上唯一的 profile → `web` 逐级解析当前 profile，因此 Electron 桌面端（profile 名是 `desktop`）同样能列出本机配置的提供商。设置面板在找不到提供商时会直接显示本次解析到的 profile、主目录与实际读取的配置文件。
- **进程内直连**：零子进程冷启动开销，原生注册 `jev_decide` 工具。
- **三类决策原语**：原生支持 `choice`（单选）、`score`（阶梯打分）、`noul`（Yes/No 概率）。
- **多级密钥解析**：显式 Key（插件配置 / 设置面板）→ 提供商 `apiKeyEnv`（`~/.dsh/.credentials.yaml` 优先，其次环境变量）→ 本地密钥文件 → 历史 `.env` 兜底。
- **可选请求端点**：`/v1/systemone`（官方原生协议）与 `/v1/decisions`（兼容 OpenAI）可下拉切换；provider 模式默认 `/v1/decisions`，手动模式默认 `/v1/systemone`。
- **代理访问**：可在设置面板填写代理地址，留空即直连；支持 `http://`、`https://`、`socks5://`、`socks5h://`。
- **双重触达表面**：提供模型原生 Tool 与可选的常驻提示词切面（Policy Section），自动引导 Agent 何时调用决策模型。
- **高韧性网络**：适配 DSH `AbortSignal` 随时取消，429 配额保护，5xx 自动指数退避重试。

## 配置与参数

在 `cordis.patch.yml` 或 Profile 配置中指定：

```yaml
- insert:
    - id: tool-jev
      name: './lib/index.js'
      config:
        # 配置来源：provider（dsh 已配置的提供商）或 manual（手写 baseUrl，默认）
        source: manual

        # source: provider 时使用：
        provider: ai-proxy         # dsh 的 llm-pi-ai providers 里的 key
        model: jev-latest          # 该提供商下的模型 ID

        # source: manual 时使用：
        baseURL: https://api.typesafe.ai # 可选，默认官方地址
        model: jev-latest           # 模型名称，默认 jev-latest

        endpoint: /v1/systemone     # 可选：/v1/systemone 或 /v1/decisions
        apiKey: ''                  # 可选，显式指定 API Key（不推荐写进配置）
        apiKeyEnv: TYPESAFE_API_KEY # 可选，默认读取的环境变量名称
        timeoutMs: 60000            # 请求超时时间 (毫秒)
        retries: 0                  # 5xx / 瞬态故障重试次数
        proxy: ''                   # 可选，代理地址；留空/省略 = 直连
        proxyHosts: [typesafe.ai]   # 可选，走代理的目标主机（默认含其子域）
```

> `transport: typesafe` 仍然被接受（早期版本的遗留写法，等价于 `source: manual`）。

## 在设置面板中配置

打开 **设置 → 决策模型**，保存后立即生效，无需重启。

- **配置来源**
  - `dsh 已配置的提供商`：只显示「提供商 / 模型 / 接口端点」三项。接口地址、请求头与 API Key 全部由该提供商的配置决定，
    因此面板不再显示这两个表单项（避免和 dsh 自身配置打架）。模型列表来自 dsh 的 `llm-pi-ai` 配置，
    并用提供商 `/v1/models` 的 `modality` 字段校准哪些是决策模型。
  - `手动配置接口地址与 API Key`：填写 baseUrl、模型 ID 与 Key。baseUrl 留空并保存会恢复官方默认地址 `https://api.typesafe.ai`。
- **决策模型识别（下拉分组依据）**
  - **静态 `modality`（可直接写在 YAML 里）**：模型条目支持写 `modality: decision`（与 `/v1/models` 同名字段）。
    dsh 的模型 schema 没有这个正式字段，但 schemastery 会原样保留未知键，所以写进 `cordis.patch.yml`
    不会导致启动失败；插件读的是 YAML 原文，因此离线或接口不可用时也能识别。
    `modality: text` / `image` 会明确排除该模型（即使名字里带 `jev` / `decision`）。
    示例：

    ```yaml
    models:
      - id: liquid/d1-ultra
        modality: decision     # 静态声明，优先于名字猜测
    ```

  - **提供商 `/v1/models` 的 `modality`（最可靠）**：provider 模式下插件会请求 `<baseURL>/v1/models`，
    响应里 `modality: "decision"` 的模型直接判定为决策模型，`text` / `image` 的模型则排除。
    例如本机 ai-proxy 的 `convaiinnovations/laya`、`liquid/d1-ultra` 名字不含任何关键词，只靠该字段就能正确归组。
    接口报告为 decision、但 dsh 模型配置里未列出的模型也会追加到「决策模型」分组。
  - 协议：provider 的 `api` 或模型条目的 `api` 属于 pi-ai 的 classifier 协议
    （`typesafe-system-one`、`cloudflare-workers-ai-system-one`、`llama-cpp-classify`、`openai-decisions`）；
  - 类型：模型条目显式声明 `type: classifier`；
  - 名称：模型 id 或展示名命中 `jev` / `systemone` / `system-one` / `decision` / `classifier` / `noul` / `predicate`；
  - 模态：模型声明了 `text` / `image` 之外的输入模态（为未来的能力扩展预留）。
  - **优先级**：`/v1/models` 的 `modality` > 静态 `modality` > classifier 协议 / `type` / 名称 / 扩展输入模态。
    探测失败（超时、无权限、接口不支持）时保留静态判断，并在模型下拉提示里说明失败原因。
    探测超时 3 秒、成功结果缓存 60 秒、失败缓存 15 秒；只在打开/保存设置面板时请求，工具调用不受影响。
  - 下拉选项会显示判断依据，例如 `jev-latest · 决策模型 · modality=decision`；
    接口不可用时退回 `jev-latest · 决策模型 · decision`（静态 modality）或 `jev-latest · 决策模型 · 文本`。
  - 说明：dsh 的 provider schema 只把 `input` 定义为 `text` / `image` 两种输入模态，不包含
    `modality` / `type` 这类正式字段；但未声明的键会被保留，插件据此读取静态 `modality`，
    并在有接口时用 `/v1/models` 的实时值校准。
- **接口端点**
  - `/v1/systemone`：TypeSafe 官方原生决策协议；
  - `/v1/decisions`：兼容 OpenAI 决策协议的路由端点。
  - provider 模式默认 `/v1/decisions`（dsh 提供商通常是 OpenAI 兼容网关）；手动模式默认 `/v1/systemone`。
- **API Key**
  - provider 模式：面板不提供 Key 输入，按提供商的 `apiKeyEnv` 自动解析（`~/.dsh/.credentials.yaml` 优先）。
  - 手动模式：留空保存表示保持原值；显式清空后保存可删除已存 Key。
  - 面板里回显的是掩码（形如 `ts-abc...1234`），掩码值不会被当成真实 Key 写回。
- **测试连接**：会真的发一次最小决策请求（1 个 yes/no 问题），显示耗时、端点、模型与 Key 来源。

### 优先级

| 配置项 | 优先级（高 → 低） |
| --- | --- |
| 来源 / 提供商 | 面板保存值 > Profile `source`/`provider` > 自动推断（优先带决策模型的提供商） |
| baseURL（手动） | Profile `baseURL`（锁定）> 环境变量 `TYPESAFE_BASE_URL`/`JEV_BASE_URL` > 面板保存值 > 官方默认 |
| 端点 | Profile `endpoint`（锁定）> 面板/请求显式值 > 环境变量 > 面板保存值 > 按来源默认 |
| 模型 | 工具参数 `model` > 面板保存值 > Profile `model`（provider 模式仅当显式配置）> 提供商模型表（`jev-latest` 优先） |

Profile 里显式写死 `baseURL` / `endpoint` / `proxy` 时，对应输入框会自动置灰锁定，修改需编辑 Profile 后重启。

## 提供商模式如何取 Key

provider 模式下按 dsh 自身规则解析，面板不保存也不显示 Key：

1. Profile 里插件配置的 `apiKey`（不推荐写死）或设置文件里已有的显式 Key；
2. 提供商声明的 `apiKeyEnv`：先查 `~/.dsh/.credentials.yaml` 的 `refs`，再查同名环境变量；
3. 提供商没有声明 `apiKeyEnv` 时，才回退到通用变量
   （`$TYPESAFE_API_KEY`、`$JEV_API_KEY`、`$OPENAI_API_KEY`、`$DEEPSEEK_API_KEY`）与本地密钥文件。

> 提供商声明了 `apiKeyEnv` 时绝不会旁落到其它提供商的 Key。否则 A 提供商缺 Key 时会静默用上 B 的 token，把「Key 配错了」伪装成「服务连不上」。

## 接口服务地址与端点配置

- **默认官方地址**：`https://api.typesafe.ai`（手动配置模式）。
- **自定义**：支持任意 http(s) 地址，例如本地部署的接口服务（`http://127.0.0.1:8000`、`http://localhost:3000`）。
- **省略协议**：`127.0.0.1:8000` 会自动补成 `http://127.0.0.1:8000`。
- **尾部路径**：baseUrl 末尾带 `/v1`、`/v1/systemone`、`/v1/decisions` 都不会拼出重复路径。
- **历史兼容**：手动模式 + `/v1/decisions` 且模型为默认的 `jev-latest` 时，会映射成 Vercel 网关的 `typesafe-ai/jev`；provider 模式绝不改写模型 ID。

## 代理访问

在 **设置 → 决策模型 → 代理地址** 中填写即可，保存后立即生效。

- **留空表示直连**：默认状态。
- **支持的协议**：`http://`、`https://`、`socks5://`、`socks5h://`；省略协议时按 `http://` 处理。
- **需要认证**：写成 `http://用户名:密码@主机:端口`。密码不会回显，也不会出现在错误信息中。
- **代理范围**：默认只代理 `typesafe.ai` 及其子域；如需调整，配置 `proxyHosts`
  （例如 `proxyHosts: ['*']` 表示全部走代理）。provider 模式下请求的是 dsh 提供商配置的
  baseUrl，同样只有命中 `proxyHosts` 才走代理；要让这类请求也走代理，把对应主机加进 `proxyHosts`。
- **优先级**：Profile 配置的 `proxy` 优先于面板设置；写死后输入框置灰。
- **TLS 校验**：始终校验证书，不提供关闭校验的开关。

> `socks5://` 由本机解析 DNS 后按 IP 连接，`socks5h://` 则把域名交给代理解析（适合本地 DNS 受限的环境）。
> 代理传输层零第三方依赖，仅使用 Node 内置模块。

## 设置文件的存放位置

- **新位置（默认写入）**：`~/.dsh/jev/settings.json`，权限 `0600`。
- **旧位置（只读兼容）**：`~/.config/typesafe/settings.json`。使用默认路径时会先读旧文件、再用新文件覆盖同名字段，所以升级后原来的 baseURL / 端点 / 代理仍然生效；保存一次即迁移到新位置。
- **显式指定 `settingsFile`**（测试或 Profile）时只读写那一个文件，不会旁落读取旧位置。
- **Key 文件兼容**：旧版保存在 `~/.config/typesafe/key` 的 Key 仍会被读取；新版面板保存的 Key 写入设置文件的 `apiKey` 字段。

## 测试

```bash
npm test
```

覆盖：提供商读取层、设置文件合并与权限、工具注册与请求、代理（HTTP/SOCKS5/HTTPS）、provider 模式端到端、前端面板渲染。
