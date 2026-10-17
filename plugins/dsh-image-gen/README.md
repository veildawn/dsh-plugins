# dsh-image-gen

DSH 原生生图插件：把「文生图」作为原生工具 `image_generate` 暴露给模型，并在 Web 设置面板里提供完整的可视化配置。

它替换的是 `~/.dsh/mcp/image-mcp-server.cjs` 那套 stdio MCP 服务——同样的能力，但不再派生子进程、不依赖 `@modelcontextprotocol/sdk`、零 npm 依赖。

## 两个核心需求

**1. 既能手写 baseUrl / key / 模型，也能直接下拉选择 dsh 已经配置好的提供商和模型**

设置面板顶部的「配置来源」在两种模式间切换：

| 模式 | 你需要填的 | 适用场景 |
| --- | --- | --- |
| `dsh 已配置的提供商` | 提供商下拉 + 模型下拉（按生图/非生图分组） | 用 dsh 里已经配好的 `ai-proxy` 等（推荐） |
| `手动配置` | 接口地址 baseUrl + API Key + 自定义模型输入框 | 指向另一个外部 OpenAI 兼容生图服务（如 SiliconFlow、Together AI、自建 Flux 接口等） |

提供商列表不是硬编码的：插件会扫描 dsh 自身的模型配置（`~/.dsh/settings.yaml`、`settings.yaml.imported`、`~/.dsh/profiles/<profile>/cordis*.yml` 里 `llm-pi-ai` 行的 `providers`），把每个提供商的 `baseURL`、`apiKeyEnv`、请求头和模型列表读出来。选中一个提供商，模型下拉就列出它名下的模型，识别到的生图模型排在「生图模型」分组里，其余模型归到另一组并标注「不保证支持生图」。在「手动配置」模式下，模型字段自动切换为文本输入框，用户可随意填写任意兼容生图服务的模型 ID。

API Key 的解析与安全：
- 优先级：显式入参 > 插件静态配置里的 `apiKey` > **本地保存的手动配置 Key (`settings.json`)** > `~/.dsh/.credentials.yaml` 的 `refs`（按提供商的 `apiKeyEnv` 找）→ 同名环境变量。
- **一个提供商声明了 `apiKeyEnv` 就只认这一个名字**，不会旁落到别的提供商的凭证上——否则 A 提供商缺 key 时会静默用上 B 提供商的 token，把「key 配错了」伪装成「服务连不上」。
- **凭证安全脱敏**：Web 界面仅展示「已配置」状态标识，不会回显明文 Key；本地设置文件使用严格的 `0600` 文件权限与 `0700` 目录权限落盘，防止被其他系统用户读取。

**2. 尺寸和画质都是下拉选择**

- **图片尺寸**：`1024×1024`（1:1）、`1024×1792`（9:16）、`1792×1024`（16:9）、`1024×1536`（2:3）、`1536×1024`（3:2）、`512×512`、`1024×768`（4:3）、`768×1024`（3:4）、`auto`（由模型决定，不发送 `size` 字段）
- **画质**：`auto`（默认，不发送 `quality` 字段）、`standard`、`high`、`hd`、`medium`、`low`

调用 `image_generate` 时可以用 `size` / `quality` 参数临时覆盖，不传则用面板里保存的默认值。当 `size` 或 `quality` 选择 `auto` 时，网络请求中省略对应字段，完全符合 OpenAI 兼容规范，由服务端自行采用模型缺省参数。

## 工具：`image_generate`

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `prompt` | 是 | 提示词，写清楚主体、构图、光线、风格与情绪 |
| `output_path` | 否 | 落盘路径；省略则在当前目录生成 `generated-<时间戳>.<ext>` |
| `provider` | 否 | 覆盖提供商 id |
| `model` | 否 | 覆盖模型 id |
| `size` | 否 | 覆盖尺寸 |
| `quality` | 否 | 覆盖画质 |

返回 `savePath`、`model`、`requestedSize`、`actualSize`、`warnings` 等字段。两点值得注意：

- **`actualSize` 从图片字节里读，不是复述请求值。** provider 经常忽略 `size` 参数（实测请求 512×512 返回 1024×1024），这种情况会在 `warnings` 里明确说「asked X, got Y」，元数据不说谎。
- **文件后缀永远匹配真实格式。** 插件嗅探 PNG/JPEG/WebP 魔数，扩展名不符时按真实格式改写，不会写出「撒谎的后缀」。

编辑类模型（id 里带 `edit`）用于纯文生图会直接报错并提示换一个生成模型。

## 安装与配置

`dsh-image-gen` 通过 `dsh.bundle.patch` 以一行插入启用。在 Profile 的 patch 层（`~/.dsh/profiles/web/cordis.patch.yml`）里加：

```yaml
- insert:
    - id: tool-image-gen
      name: './lib/index.js'
      inject:
        - tools
        - connection
      config:
        provider: ai-proxy            # 直接用 dsh 已配置的提供商（推荐）
        model: gemini-3.1-flash-image
        size: 1024x1024
        quality: auto
```

或指向一个手写地址：

```yaml
- insert:
    - id: tool-image-gen
      name: './lib/index.js'
      inject:
        - tools
        - connection
      config:
        source: manual
        baseURL: 'http://192.168.1.253:8319/v1'
        apiKeyEnv: MY_IMAGE_KEY
        # apiKey: 'sk-...'           # 不推荐：明文写进 Profile
        size: 1024x1024
        quality: auto
        proxy: 'http://127.0.0.1:7890'   # 可选；留空表示直连
        settingsFile: ~/.dsh/image-gen/settings.json
```

不写任何 `config` 也能跑：插件会自己扫描 dsh 配置，挑第一个带生图模型的提供商作为默认值。

### 配置优先级（高 → 低）

1. 工具调用时的显式参数（`provider` / `model` / `size` / `quality` / `output_path`）
2. 面板「保存设置」写入的 `~/.dsh/image-gen/settings.json`
3. Profile 里本插件的 `config` 段
4. 扫描 dsh 自身配置推断出的默认值

注：Profile 中的 `config` 默认作为缺省初值，用户可在 Web 设置面板自由修改并保存；若管理员需要强制固定某项不可在界面更改，可在 `config` 下配置 `locked: { provider: true, model: true }`，被固定的字段在面板中会显示为禁用状态。

### 出站代理

可选。支持 `http://`、`https://`、`socks5://`、`socks5h://`，需要认证时写成 `http://user:password@host:port`。留空表示直连。
- **全链路保护**：不仅生图 API 调用走代理，当服务端返回海外或第三方 CDN 图片 URL 时，图片下载同样通过代理隧道进行，防止海外 CDN 下载超时。
- **安全脱敏**：代理地址只用于网络握手，任何错误信息和前端展示都会把密码掩码成 `***`。

## 设置面板

出现在 DSH 的 **Settings → 生图模型**，提供：

- 来源切换（提供商 / 手动）
- 提供商与模型下拉
- 尺寸与画质下拉
- API Key（手动模式，密码框）
- 代理地址
- 「测试连接」：真正出一张 512×512 小图，报告耗时、走的路线（直连/代理）、模型返回的实际尺寸和测试图落点
- 「保存设置」：写入 `~/.dsh/image-gen/settings.json`，带 `_source: user-set` 标记

保存前会做完整校验（尺寸、画质、来源模式、提供商是否存在、代理地址格式），任何一项不过就整体不落盘，不会写进半个坏配置。

同时挂载了三个 HTTP 路由，供非 WebSocket 客户端使用：

| 方法 | 路径 |
| --- | --- |
| GET | `/api/dsh-image-gen/config` |
| POST | `/api/dsh-image-gen/config` |
| POST | `/api/dsh-image-gen/test` |

## 开发

```bash
cd plugins/dsh-image-gen
npm test      # 400 项断言，5 个测试文件，零依赖、无网络
npm pack
```

测试覆盖：

| 文件 | 覆盖内容 |
| --- | --- |
| `test/image.mjs` | 尺寸/画质校验、baseURL 归一化、MIME 嗅探、真实像素尺寸读取（PNG/JPEG/WebP）、落盘扩展名纠正、端到端生成（b64 与 url 两种响应）、代理转发、超时 |
| `test/providers.mjs` | profile 层与 settings.yaml 两层提供商收集、`!!js` 标签容错、模型条目两种写法、凭证优先级、生图/编辑模型识别、默认值推断 |
| `test/settings.mjs` | 设置文件路径展开、坏文件容错、字段白名单、来源模式校验、合并写入保留未知字段 |
| `test/smoke.mjs` | 工具注册形态、provider 与 manual 两条全链路、设置文件驱动默认值、各类报错、RPC 三个方法、Web 路由、前端包加载 |
| `test/client-render.mjs` | 设置面板渲染：来源切换、提供商/模型下拉联动、尺寸画质下拉、配置固定字段禁用、保存与测试载荷、无提供商降级 |

### 目录结构

```
plugins/dsh-image-gen/
├── package.json          # dsh.bundle.patch + dsh.client.inject
├── cordis.patch.yml      # 插入 tool-image-gen 行的示例
├── lib/
│   ├── index.js          # 工具注册、RPC 通道、Web 路由
│   ├── client.js         # 设置面板（window.__ModuleLoader__ 加载）
│   ├── provider.js       # 读取 dsh 已配置的提供商与凭证
│   ├── image.js          # 生图核心：请求、落盘、格式归一化
│   ├── settings.js       # 设置文件读写与校验
│   └── proxy.js          # 可选出站代理（CONNECT / SOCKS5）
└── test/
```

## 已知限制

- 只支持 OpenAI 兼容的 `/v1/images/generations`。Anthropic、Gemini 原生等协议需要另加适配层。
- 尺寸白名单是「常见比例」而非「provider 支持的比例」。实际支持哪些由 provider 决定，传了不支持的通常被忽略（此时 `actualSize` 会告诉你真相）或直接报错。
- `js-yaml` 不是依赖：它通过 `createRequire` 从宿主 dsh 安装里解析。万一解析不到，插件会退到内置的 YAML 子集解析器（覆盖 dsh provider 配置用到的语法），仍然能列出提供商，只是不保证解析任意 YAML。
