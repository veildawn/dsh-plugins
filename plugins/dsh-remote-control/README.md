# dsh-remote-control

DeepSeek Harness（DSH）的独立远程访问门禁与特权 RPC 桥接插件。它不提供模型、OAuth
或业务功能，只负责在非本机 Web Host 上锁定工作区，并在共享密钥认证后代理一组固定的
DSH 特权 API。

## 功能

- 远程浏览器先显示全屏 **Unlock Screen**，认证前不挂载工作区根界面。
- 仅在 `enabled: true` 时改写 Host 鉴权：未认证且未带 `?token=` 的**非回环**根路径直接返回 index.html，让锁屏能加载，避免旧版静默注入 launch token 造成的 `ERR_TOO_MANY_REDIRECTS`。回环浏览器没有锁屏，继续收到官方 401（提示改用 `dsh web` 打印的 `?token=` 链接），不会拿到永远连不上的空壳界面。
- **解锁后由 Host 补齐官方浏览器会话**（`POST /dsh-remote-control/session`）：密钥校验通过后，插件用进程 launch token 完成一次原生 token 交换，把 Connection 自己签发的会话 Cookie 回填给浏览器。官方 `/api/*`（包括驱动 `connection.state` 的 `remote.mux` 事件流）随后即可正常工作，远程页面不再停留在「自动重连中」。
- 浏览器 Cookie 门禁只对 `/dsh-remote-control` 及其兼容别名放行 401；官方 `/api/*` 与配置通道仍要求会话 Cookie。403（跨站 / 未信任 Host）始终拒绝，且在密钥比较之前判定。
- 关闭远程访问（默认）时不劫持 `authorizeIndex` / `requestRejection`，也不签发任何会话。
- 主 RPC 通道为 `/dsh-remote-control`，保留 `/ai-proxy-remote-control` 兼容别名。
- 密钥使用恒定时间比较；未启用、未配置或密钥错误时拒绝特权调用。
- 浏览器密钥暂存在 `localStorage` 的 `dsh-remote-control.secret`；可随时锁定并清除。
- 自动迁移旧版 `dsh-ai-proxy.remote-control-secret` 浏览器键。
- 官方 `/api/*` 仍走 Connection 的浏览器会话校验；本插件不绕过它，而是按需**签发**会话（见下节）。远程特权调用只经过本插件的固定白名单。
- `localhost`、`127.0.0.1` 和 IPv6 回环地址不显示锁屏。

## 安装

插件自带 `cordis.patch.yml`，安装后会插入 `remote-control` Cordis 行，默认关闭远程访问：

```sh
dsh plugin --profile web add ./dsh-remote-control-0.1.11.tgz
dsh service restart
```

`dsh service restart` 依赖宿主打包的 systemd/launchd 单元；**`@deepseek-ai/dsh` CLI 本身没有
`service` 子命令**（`dsh --help` 只列出根命令、`web`、`plugin`），Windows 等没有那层封装的环境执行
会报 `error: too many arguments`。Windows 下改用本仓库的
[`scripts/dsh-service.ps1`](../../scripts/dsh-service.ps1)：

```powershell
powershell -File scripts/dsh-service.ps1 restart -Profile web
```

手动安装时：

```sh
cd ~/.dsh/profiles/web
pnpm add /path/to/dsh-remote-control-0.1.11.tgz
```

对应的手动 Cordis 配置为：

```yaml
- insert:
    - id: remote-control
      name: dsh-remote-control
      config:
        enabled: false
```

远程 Web Host 仍需使用 Harness 的信任主机栅栏，例如：

```sh
dsh web --port 3080 --trusted-host dsh.example.com
```

## 配置与启用

在本机浏览器打开 **设置 → 远程控制**：

1. 输入高强度随机密钥；
2. 打开“启用远程访问”；
3. 点击“保存远程控制”；
4. 从远程域名访问，并在 Unlock Screen 输入同一密钥。

Host 按以下顺序读取密钥，命中后停止：

1. DSH 凭据仓中的 `DSH_REMOTE_CONTROL_SECRET`；
2. 进程环境变量 `DSH_REMOTE_CONTROL_SECRET`；
3. `remote-control.secret` 配置项（`secret` role，作为无法使用凭据仓时的回退）。

推荐通过设置页写入 DSH 凭据仓，或在服务环境中设置：

```sh
DSH_REMOTE_CONTROL_SECRET='replace-with-a-long-random-secret'
```

配置字段：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 是否接受远程认证和特权调用 |
| `secret` | `''` | secret-role 回退密钥；凭据仓和环境变量优先 |

`/dsh-remote-control-config` 是单独的 loopback-only 配置通道。公网通道不能启用远程访问，
也不能替换 Host 密钥。

### 会话握手：为什么解锁后必须再补一次 Cookie

`dsh web` 把**所有**浏览器请求（`/`、`/api/*`、`/api/remote.mux` WebSocket）都栅格在
进程 launch token 换来的会话 Cookie 后面。锁屏本身只能证明「持有共享密钥」，它不会、也
不该绕过官方会话：

| 阶段 | 无会话 Cookie 时的结果 |
| --- | --- |
| `GET /`（非回环 + `enabled`） | 插件直通 index.html，锁屏可加载 |
| `POST /dsh-remote-control/status` | 插件放行 401，锁屏据此判断启用/密钥状态 |
| `GET /api/remote.mux`、任意 `/api/*` | **官方 401** —— Connection 的浏览器会话门禁 |

因此旧版本（0.1.10）在远程解锁后，界面能渲染但左下角一直显示「自动重连中」，工作区
永远没有数据。0.1.11 起，锁屏与设置页在密钥校验通过后会调用握手端点补齐会话：

```http
POST /dsh-remote-control/session
content-type: application/json
cookie: <浏览器自身的会话 Cookie，按需携带>

{ "token": "…" }
```

- 签发成功返回 `200 {"ok":true,"minted":true}`，并通过 `Set-Cookie` 下发 Connection 签发的会话
  Cookie（HttpOnly、SameSite=Strict、按 `host:port` 绑定，浏览器脚本读不到）。
- 已经持有有效会话时返回 `200 {"ok":true,"minted":false}`，不重复下发。客户端据此区分
  「本页是在没有会话的情况下启动的」：`minted: true` 时会自动刷新一次页面，让 SPA 在
  已有会话的干净状态下重新启动（刷新后的自动校验拿到 `minted:false`，因此不会循环刷新）。
- `DELETE` 同一路径会清除该浏览器当前的 `dsh-auth-*` 会话 Cookie，供「锁定远程会话 /
  清除本地凭证」使用；两次调用都要求共享密钥。
- Host 不可信 / 跨站（403）在比较密钥之前就拒绝；未启用或密钥错误分别返回 `403` / `401`；
  宿主未暴露 launch token（无法签发）返回 `503`，此时请改用 `dsh web` 打印的 `?token=`
  链接访问。
- 该端点不返回 launch token 本身，只返回由它派生、且绑定到调用方 authority 的 Cookie。

## 无桌面 Linux 主机：直接编辑配置文件

远程设置页走的是 loopback-only RPC，无桌面浏览器的服务器上打不开。可以跳过设置页，直接
改 DSH 的两个配置文件；两者默认都开着文件监听（约 100ms debounce），改完立即热加载，
不需要重启 `dsh web` 进程。

先确定 `$DSH_HOME`（默认 `~/.dsh`，可被环境变量 `DSH_HOME` 覆盖）：

```sh
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
mkdir -p "$DSH_HOME" && chmod 700 "$DSH_HOME"
```

**1. 密钥写入 `.credentials.yaml`**——扁平 `KEY: value` 映射，没有命名空间包装，key 是
`DSH_REMOTE_CONTROL_SECRET` 字面值：

```sh
printf 'DSH_REMOTE_CONTROL_SECRET: %s\n' "$(openssl rand -base64 32)" >> "$DSH_HOME/.credentials.yaml"
chmod 600 "$DSH_HOME/.credentials.yaml"
```

文件必须是 `600`、父目录 `700`，否则启动时会直接拒绝加载并报错要求先 `chmod`；值不能是
空字符串（留空要删整行，不要写 `''`）。如果文件里已有其它插件的凭据，用 `>>` 追加，不要
整体覆盖。

**2. 开关写入 `settings.yaml`**——按插件命名空间分节，本插件的分节键是 `remote-control`：

```yaml
remote-control:
  enabled: true
```

用编辑器把这一段合并进已有文件（有其它插件分节时不要整体覆盖），或者直接新建文件都可以，
不存在时 DSH 不会因此报错。**不要**在这里写 `secret` 字段——技术上能生效，但明文存放且没有
`.credentials.yaml` 的权限校验，只应作为“无法用凭据仓时”的最后回退，参见上面的取值优先级。

**3. 校验生效**：语法错误在进程启动时是硬失败（拒绝加载插件），运行中的无效编辑只会打警告
并保留上一份有效配置，不会让进程崩溃，但也不会应用改动。建议改完后跑一次 YAML 语法自查，
再用 `status` 方法确认：

```sh
curl -s -X POST http://127.0.0.1:<port>/dsh-remote-control-config \
  -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"check","method":"status","payload":{}}'
```

返回里 `enabled` 和 `secretConfigured` 均为 `true` 即为生效；此通道是 loopback-only，只能在
宿主机本地（或 SSH 隧道转发到本机端口后）调用，公网域名访问会被拒绝。

这一步只解决"密钥怎么写进去"，不替代 [安装](#安装) 一节里的 `--trusted-host` 声明和
[安全边界](#安全边界) 里要求的 HTTPS 反向代理；三者缺一，远程访问都不算配置完整。

## RPC 协议

状态检查：

```json
{
  "channel": "/dsh-remote-control",
  "method": "status",
  "payload": { "token": "…" }
}
```

返回 `enabled`、`secretConfigured` 和 `authenticated`。特权调用使用：

```json
{
  "channel": "/dsh-remote-control",
  "method": "call",
  "payload": {
    "token": "…",
    "method": "settings.describe",
    "payload": {}
  }
}
```

允许的方法是源码内的固定表，不能用任意对象路径扩展：

- `settings.describe/openDocument/update/replace/mutate`
- `credentials.describe/set/unset`
- `agentPreset.read/copy/openDocument/remove`
- `host.pickDirectory/openPath`
- `llm.providers/models/discoverModels`

浏览器端会将对应的 `connection.api` 方法重定向到认证通道。远程页面总是走该通道；本机
页面优先走官方直连，仅在直连返回 HTTP 403 时回退。

## 安全边界

- 本插件是共享密钥门禁，不替代 HTTPS、反向代理访问控制、网络防火墙或 DSH 的
  `--trusted-host` 校验。
- 启用后未认证的**非回环**根路径可以加载 SPA / Unlock Screen，这不是会话认证；官方 `/api/*`
  在没有浏览器 Cookie 时仍返回 401。补齐 Cookie 的唯一途径是共享密钥（会话握手）或
  `dsh web` 打印的 `?token=` 链接，二者等价于完全访问这台 Harness。
- 解锁后远程浏览器持有**官方会话**，其权限不再局限于 RPC 白名单；共享密钥即完整访问凭据，
  请按 HTTPS 反向代理的强度保护它（建议高强度随机值，并定期更换）。
- 「锁定远程会话 / 清除本地凭证」会同时清除浏览器 `localStorage` 密钥与官方会话 Cookie；
  若该请求失败（例如网络中断），官方会话会保留到其过期时间（默认 30 天），此时可在浏览器
  设置里手动删除本站 Cookie。
- 必须通过 HTTPS 暴露远程页面，否则浏览器密钥和会话可能被窃听。
- 密钥存放在当前浏览器的 `localStorage`，同源脚本可以读取；不要在不可信浏览器或共享账号
  中保存，使用完点击“锁定远程会话 / 清除本地凭证”。
- RPC 方法表是最小权限边界。新增方法时必须同时评估输入、Host 副作用并补测试。

## 从 dsh-ai-proxy 0.1.x 迁移

1. 将 `dsh-ai-proxy` 升级到 `0.2.0`；
2. 安装 `dsh-remote-control`；
3. 在新插件的本机设置页重新确认 `enabled`；
4. 继续使用原 `DSH_REMOTE_CONTROL_SECRET` 凭据即可；浏览器旧存储键会自动迁移；
5. 可从旧 `ai-proxy` 设置段删除 `remoteAccess` 和 `remoteAuthSecret`。

兼容 RPC 别名只用于平滑升级；新集成应使用 `/dsh-remote-control`。

## 开发与测试

```sh
npm test
npm pack --dry-run
```

测试覆盖密钥比较与来源优先级、配置通道权限、主通道和兼容别名、固定白名单、Unlock
Screen、LocalStorage 迁移、浏览器 API 重定向、`enabled` 开关下的 index 直通与 401 通道白名单，
以及会话握手（签发/复用/清除、Host 栅栏、未启用、错误密钥、方法限制、无 launch token 的降级）。
