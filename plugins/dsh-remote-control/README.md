# dsh-remote-control

DeepSeek Harness（DSH）的独立远程访问门禁与特权 RPC 桥接插件。它不提供模型、OAuth
或业务功能，只负责在非本机 Web Host 上锁定工作区，并在共享密钥认证后代理一组固定的
DSH 特权 API。

## 功能

- 远程浏览器先显示全屏 **Unlock Screen**，认证前不挂载工作区根界面。
- 主 RPC 通道为 `/dsh-remote-control`，保留 `/ai-proxy-remote-control` 兼容别名。
- 密钥使用恒定时间比较；未启用、未配置或密钥错误时拒绝特权调用。
- 浏览器密钥暂存在 `localStorage` 的 `dsh-remote-control.secret`；可随时锁定并清除。
- 自动迁移旧版 `dsh-ai-proxy.remote-control-secret` 浏览器键。
- 官方 `/api/*` 的 loopback-only 规则保持不变；远程调用只经过本插件的固定白名单。
- `localhost`、`127.0.0.1` 和 IPv6 回环地址不显示锁屏。

## 安装

插件自带 `cordis.patch.yml`，安装后会插入 `remote-control` Cordis 行，默认关闭远程访问：

```sh
dsh plugin --profile web add ./dsh-remote-control-0.1.5.tgz
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
pnpm add /path/to/dsh-remote-control-0.1.5.tgz
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
Screen、LocalStorage 迁移及浏览器 API 重定向。
