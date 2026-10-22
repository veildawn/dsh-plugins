# dsh-im-bot

DeepSeek Harness（DSH）的**集成机器人**插件：把企业微信智能机器人与个人微信接入 DSH，
让微信成为会话的另一个入口与出口。

- 📥 **微信 → DSH**：在微信里发消息，直接驱动绑定的 DSH 会话；
- 📤 **DSH → 微信**：会话跑完自动把结果推回发起对话的那个聊天；
- 🔔 **任务完成主动通知**：不需要你盯着页面，长任务跑完结果自己送到手机上。

---

## 一、它能做什么

| 需求 | 实现 |
| :--- | :--- |
| 企业微信 + 个人微信双机器人 | 两个独立通道，可只启用其一，也可同时启用 |
| 双向通信 | 入站消息落成会话 prompt；回合结果回推原聊天 |
| 任务完成主动通知 | `turn/end` 且 `completed` 时推摘要；`error`/`aborted`/`max-tokens` 时推告警 |

**刻意只推给「发起过对话」的聊天**：Web 端新开的会话不会打扰任何人。哪个聊天绑了哪个
会话，设置页里一目了然，也能手动解除。

### 内置命令

在微信里直接发这些命令，**不会**进入模型上下文（不消耗 token、不污染历史）：

| 命令 | 作用 |
| :--- | :--- |
| `/new [标题]` | 新建一个会话并绑定到当前聊天 |
| `/use <会话ID>` | 绑定到已有会话（可用前 8 位前缀） |
| `/sessions` | 列出最近会话（带 ▶ 标记当前绑定） |
| `/status` | 查看两个通道状态与当前绑定 |
| `/stop` | 中止当前正在生成的回合 |
| `/notify on\|off` | 开关本聊天的完成通知 |
| `/help` | 命令列表 |

其它任何文本都会作为该会话的下一条消息投递进去。

---

## 二、两条通道的技术底座

### 企业微信 · 智能机器人（长连接 API 模式）

对接企业微信官方的[智能机器人长连接](https://developer.work.weixin.qq.com/document/path/101463)：

- 主动连 `wss://openws.work.weixin.qq.com`，用 `BotID` + `Secret` 发 `aibot_subscribe`；
- 收 `aibot_msg_callback`（文本/图文混排/语音）与 `aibot_event_callback`；
- 发用 `aibot_send_msg`，显式带 `chat_type`（1 单聊 / 2 群聊）；
- 每 30 秒 `ping` 心跳，连续 3 次没回应判定假死重连；
- 收到 `disconnected_event`（同一机器人只能一条长连接，新连接会踢旧的）后**指数退避重连**，
  不会与另一个实例互踢。

**为什么选长连接而不是回调 URL**：不需要公网 IP、不需要 HTTPS 证书、不需要自己实现
AES 验签解密。代价是同一机器人同时只能有一条连接——所以如果你在别处也连了同一个
BotID，两边会互踢，表现为「刚连上又断」。

### 个人微信 · 腾讯 iLink Bot

对接腾讯 iLink Bot 的官方 HTTP 接口（与 iLink 官方 App 同一套协议）：

- 扫码登录取 `ilink_bot_id` + `bot_token`；
- `ilink/bot/getupdates` 长轮询收消息，`get_updates_buf` 游标**持久化**到
  `~/.dsh/im-bot/`，重启不重复消费、不丢消息；
- `ilink/bot/sendmessage` 发消息，必须回带该 peer 最近的 `context_token`；
  过期（`errcode -14`）时自动**去掉 token 重试一次**——这是通知能发出去的关键；
- `ilink/bot/sendtyping` 显示「正在输入」，`typing_ticket` 缓存 600 秒。

> **不读取 `~/.hermes` 下的任何文件。** 如果你同时用 hermes 跑同一个 bot 账号，
> 两边各自持游标会互相抢消息。本插件独立扫码、独立存储，互不干扰。

---

## 三、安装

```bash
# 从 npm 安装
dsh plugin --profile web add @weniatall/dsh-im-bot

# 或从本仓库本地打包安装
cd plugins/dsh-im-bot && npm pack
dsh plugin --profile web add ./weniatall-dsh-im-bot-0.1.6.tgz
```

### 重启生效

`@deepseek-ai/dsh` CLI 没有 `service` 子命令，用仓库自带脚本：

- **macOS / Linux**：`./scripts/dsh-web.sh restart`
- **Windows**：`.\scripts\dsh-web.ps1 restart`（或 `scripts\dsh-web.cmd restart`）

安装后插件**默认完全关闭**，不会建立任何连接。打开 **设置 → 集成机器人** 才启用。

---

## 四、配置

### 4.1 企业微信

1. 企业微信管理后台 → **智能机器人** → 创建/进入机器人；
2. 开启 **API 模式**，选择 **长连接**；
3. 记下 **BotID** 与 **Secret**（长连接专用，与回调模式的 Token/EncodingAESKey 不同）；
4. 在 DSH 设置页填入 BotID 与 Secret，勾选「启用企业微信通道」，保存。

状态标签变成「在线」即连接成功。

### 4.2 个人微信

1. DSH 设置页 →「个人微信 · 扫码登录」→ 点 **扫码登录**；
2. 用微信扫码并在手机上确认；
3. 登录成功后账号 ID、Token 自动写入，通道自动启用。

### 4.3 白名单（重要）

**白名单为空时，任何人都不能使用机器人**（安全默认）。否则任何知道机器人账号的人
发条消息就能消耗你的模型额度。

- 单聊：填对方的 `userid`，每行一个；
- 群聊：勾选「允许群聊」，再填允许的群 ID（`chatid`）。群聊默认关闭。

企业微信里机器人创建者是超级管理员时，`from.userid` 是明文 userid；否则是加密 userid
（需要通过「自建应用与智能机器人的对接」转换）。**用你在回调里实际看到的那个值**。

### 4.4 外部推送令牌（可选）

设置后即可让脚本/CI 主动推消息：

```bash
curl -X POST http://127.0.0.1:3080/dsh-im-bot/send \
  -H 'content-type: application/json' \
  -H 'x-dsh-im-bot-token: <你设置的令牌>' \
  -d '{"sessionId":"<会话ID>","text":"构建完成 ✅","format":"text"}'
```

- `sessionId` 会查绑定表找到对应聊天；也可直接给 `channel` + `peer`。
- **不配置令牌时该路由视同不存在**（返回 404，不暴露存在性）。
- 令牌用恒定时间比较，避免通过响应时间猜测。

### 4.5 给模型用的工具

插件注册了原生工具 `im_bot_send`，模型可以自己决定在任务中途把进度或结果推给你：

```text
im_bot_send(text="部署已完成，版本 v1.2.3", sessionId="<当前会话>")
```

---

## 五、工作原理

```
微信/企微 ──入站──▶ Channel(ilink|wecom)
                        │ 归一化 + 去重 + 白名单
                        ▼
                  命令？──是──▶ 本地执行并回发（不进模型）
                        │否
                        ▼
              agent.followup(createUserMessage)  ──▶ DSH 会话
                        │
                        │  （记录「本会话由哪个聊天发起」）
                        ▼
                   模型跑一轮
                        │
              session/event: turn/end
                        │  reason.kind
             ┌──────────┴──────────┐
       completed               error/aborted/max-tokens
             │                        │
        推送结果摘要              推送失败告警
             └──────────┬─────────────┘
                        ▼
                 回推原聊天（同一通道，断线则降级到另一通道）
```

**为什么监听 `session/event` 而不是 `agent/status`**：只有 `turn/end` 带 `reason`，
能区分「正常完成」与「报错/被中止/超出 token」，这是「失败也要告警」的前提。
`agent/status` 只知道 `idle` / `running`。

---

## 六、可靠性设计

| 场景 | 处理 |
| :--- | :--- |
| 企微长连接被新连接踢掉 | 收 `disconnected_event` → 指数退避重连（1s→60s 封顶），不与对方互踢 |
| 企微心跳无响应 | 连续 3 次未收到回包判定假死，主动关闭并重连 |
| iLink 会话过期（`-14`） | 发送时去 `context_token` 重试一次；轮询时退避 10 分钟 |
| iLink 游标丢失 | 游标原子落盘（tmp + rename），坏文件只降级为空游标，不阻止启动 |
| 重复消息 | `msgid` 级去重 + 内容指纹兜底，TTL 5 分钟 |
| 长文本 | 按通道上限分片（默认 2000 字符），同 peer 串行发送避免交错 |
| 消息风暴 | 每 peer 滑动窗口限流（30 条/分钟）+ 连续失败 3 次退避 30 秒 |
| 通道断开 | 通知自动降级到另一个在线通道；都不可用则记日志丢弃（不排队积压） |
| 宿主重启 | 绑定关系、游标、`context_token` 全部持久化在 `~/.dsh/im-bot/` |
| 绑定会话被删/归档 | 投递前 `resolveAgent` 失败 → 回「会话不可用，请 /new」 |

状态文件（`~/.dsh/im-bot/`，权限 0600）：

| 文件 | 内容 |
| :--- | :--- |
| `bindings.json` | 聊天 ↔ 会话绑定关系 |
| `ilink-sync.json` | iLink 长轮询游标 |
| `ilink-context-tokens.json` | 每个 peer 最近一次的 `context_token` |
| `wecom-peers.json` | 企业微信 peer 的单聊/群聊类型 |

凭据（Bot Secret、iLink Token、HTTP 令牌）**不进配置文件**，统一存于 DSH 凭据存储
（`ctx.credentials`），设置页只显示「已配置 / 未配置」。

---

## 七、排障

### 设置页显示「已保存」但通道一直「未启用」

检查总开关。通道启用开关与总开关是**两个**开关，总开关关闭时任何通道都不会连接。

### 企业微信「刚连上又断了」

同一个 BotID 在别处还有一条长连接。企微规定一个机器人同时只能有一条长连接，
新连接会踢掉旧的。关掉另一处（比如另一个 DSH profile、或你在别的地方跑的脚本）。

### 微信发消息没反应

按顺序检查：

1. `/status` 看通道是否「在线」；
2. 白名单是否包含你的 userid（**留空 = 拒绝所有人**）；
3. 群聊是否同时勾了「允许群聊」并填了群 ID；
4. 宿主日志里搜 `im-bot:`，拒绝原因会写成 `拒绝 <channel>/<peer>（<reason>）`。

### 会话有回复但微信没收到

1. `/status` 看绑定是否还在；
2. `/notify` 是否被关成了 off；
3. 企业微信主动推送要求「用户先给机器人发过消息」——绑定本身就是由入站建立的，
   正常情况下满足；若账号被重置则需重新发一条消息；
4. iLink 通知需要 `context_token`，过期会自动降级重试；若仍失败，
   在微信里给机器人随便发条消息刷新会话。

### 桌面版 / headless profile 下没有双向

双向对话依赖 `ctx.sessionController`（由 `dsh-web-app` 提供）。`desktop` 与 `headless`
组合里没有它，此时设置页会提示「当前 Profile 不支持双向对话」，通道仍可出站推送。

### 想看当前配置与诊断

设置页底部「重新读取」会刷新状态；也可以在浏览器控制台调
`ctx.connection.rpc.call('/dsh-im-bot', 'diagnostics', {})` 拿到完整诊断。

---

## 八、开发与测试

```bash
cd plugins/dsh-im-bot
npm test
```

测试包含四套，全部**零网络、零宿主、零依赖**：

| 文件 | 覆盖 |
| :--- | :--- |
| `test/core.test.mjs` | 命令解析、白名单、绑定表、通知文案、分片、限流、去重 |
| `test/wecom.test.mjs` | 假 WebSocket 驱动订阅/心跳/入站/被踢重连/分片 |
| `test/ilink.test.mjs` | 假 fetch 驱动长轮询/发送/token 降级/扫码状态机 |
| `test/client.test.mjs` | 假 ModuleLoader + React 桩验证设置面板注册与渲染 |

另含两道宿主闸门：

```bash
node ../../scripts/check-host-settings.mjs plugins/dsh-im-bot im-bot   # 设置写入闸门
node ../../scripts/verify-pack-contents.mjs --plugin dsh-im-bot        # 发布内容闸门
```

### 配置形状的一个硬约束

schemastery 明确拒绝「volatile 字段嵌在另一个 volatile 对象里」：

```text
volatile fields require a fixed object path without an enclosing volatile field
```

因此 `Config` 里所有可改字段都是**扁平**的（`wecomBotId`、`ilinkBaseUrl`、
`notifyOnTurnComplete`…），由 `flatToNested()` / `nestedToFlat()` 在扁平配置与
core 层使用的嵌套结构之间转换。改配置字段时三处要同步：
`Config`、`CONFIG_KEYS`、这两个转换函数。

---

## 九、边界与已知限制

- **本期只做文本**。图片/语音/文件/视频已在协议层留好位置，但未接入媒体链路
  （iLink 的媒体要走 AES-128-ECB CDN 协议）。收到媒体消息会回一句「当前仅支持文本消息」。
- **企业微信不支持流式刷新**。回复是完整发一次；企微的 `stream.id` 流式回复留待后续。
- **企业微信回调 URL 模式未实现**。它需要公网 HTTPS，与长连接二选一。
- **群机器人 webhook 未实现**。它是单向的，不满足双向通信需求。
- **需要 Node ≥ 22**：依赖全局 `WebSocket`（企微长连接）。Node 20 需要额外引入 `ws` 依赖。
- **不内嵌任何个人微信 hook**。个人微信走腾讯官方 iLink Bot 接口，不是逆向 hook；
  但账号使用风险（被限制登录等）由使用者自行承担。
- **合规提示**：请在企业微信管理员授权的范围内使用；不要把机器人用于群发营销或
  自动化骚扰。插件不做任何风控规避。

---

## 十、License

MIT
