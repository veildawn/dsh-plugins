# dsh-ai-proxy

DeepSeek Harness 的「AI Proxy 网关」Provider 插件:OAuth 2.0 登录(授权码 + PKCE S256)+
按套餐的模型发现 + 按模型的思考等级(reasoning effort)。UI 分为独立的
「设置 → AI Proxy」与「设置 → 远程控制」两个分节。

登录后,DSH 的模型选择器里出现 `ai-proxy` 这个 provider,列表是你自己的凭据向网关
GET /v1/models 拉到的——看到的就是你的套餐真正允许的那些模型,每个模型带自己的
思考等级档位(effort_levels),与网关面板上的计费/配额同一条准入链。

## 工作原理

- 登录:在「设置 → AI Proxy」填网关地址并点「登录」,host 起
  一个 127.0.0.1 回环回调服务器,打开浏览器走授权码 + PKCE S256(未登记的 client_id 用
  回环回调即可,不需要改网关)。登录完成后凭据自动落库,页面显示已登录,
  模型选择器出现你套餐允许的模型
- 网关地址:设置页内未登录与已登录状态都可修改(走仅限本机的 Host 认证接口,
  不改写 settings.yaml 的其余字段);已登录时改动后点「保存」,未登录时点「登录」
  会先保存再拉起浏览器
- 登出:设置页点「退出登录」→ 调网关 POST /oauth/revoke → 清凭据仓;没有静态密钥时,
  模型选择器里的 ai-proxy 分组随之消失
- 令牌:access/refresh 存在 DSH 凭据仓($DSH_HOME/.credentials.yaml),不落配置文件;
  到期前 30 秒自动用 refresh 轮换,旧 refresh 立即作废(防重放);401 时流式请求会轮换一次
  并重试一次
- 模型:GET /v1/models(Bearer 凭据)缓存 5 分钟;context_window、modality、
  effort_levels 完全按照网关返回值采用,插件不推断或补全档位;
  离线或未登录时回退到设置里的静态目录
- 思考等级:effort_levels 逐项映射为 DSH 的 reasoning 档位(名字按 low/medium/high/xhigh
  等常识映射),请求里作为 reasoning_effort 原样回传,由网关按其 effort ladder 钳制并翻译成
  各家上游的档位

## 远程控制 (Remote Control)

在 **设置 → 远程控制** 中，仅在本机页面启用「远程访问」并设置密钥。密钥写入
DSH 凭据仓的 `DSH_REMOTE_CONTROL_SECRET`（也可在启动环境或 `ai-proxy.remoteAuthSecret`
这个 secret-role 设置项中提供）；不会出现在设置读取响应中。远程域名打开时先显示全屏门禁，
不会挂载主工作区；验证通过后密钥保存在浏览器 localStorage，特权请求会自动携带它。可在
**设置 → 远程控制** 中随时「锁定远程会话 / 清除本地凭证」。

远程 Web Host 必须仍使用 Harness 的信任主机栅栏启动，例如：

~~~sh
dsh web --port 3080 --trusted-host deepseek.veildawn.com
~~~

插件新增受认证的 `/ai-proxy-remote-control` Cordis RPC 通道，校验通过后才在 Host 内部调用
`ctx.apiProxy` 处理 `settings.*`、`credentials.*`、`agentPreset.*` 和 `llm.discoverModels`。
官方 `/api/*` 的 loopback-only 403 规则保持不变；远程特权调用直接走带密钥的白名单通道，
未启用、缺少密钥或密钥错误均拒绝访问。`localhost` 和 `127.0.0.1` 继续无门禁放行。

## 安装

插件自带 bundle 补丁层(cordis.patch.yml),一条命令安装并自动激活,无需手改
profile 的任何 YAML:

~~~sh
dsh plugin --profile web add dsh-ai-proxy@https://github.com/veildawn/ai-proxy-releases/releases/download/<tag>/dsh-ai-proxy-<ver>.tgz
~~~

手动等价方式(不经过 dsh plugin 的 bundle 归并时才需要):
`cd ~/.dsh/profiles/web && pnpm add dsh-ai-proxy@<tgz 或源码目录>`,
再在 profile 的 cordis.patch.yml 里加一段
(`- insert: [{id: llm-ai-proxy, name: dsh-ai-proxy, config: {baseURL, clientId}}]`)。

重启应用(host 与客户端 bundle 都在启动时装载;更新插件后也要重启)。之后到
**设置 → AI Proxy**:

1. 填写网关地址并点「登录」,当前浏览器会打开网关授权页;若弹窗被拦截可点
   「点击前往授权」。本机授权会自动回到回环监听器；远程浏览器授权后把页面显示的
   `code#state` 粘回设置页即可完成登录。随后模型选择器会出现 ai-proxy 的模型和思考档位;
2. 「退出登录」随时可回到未登录状态;没有静态密钥时模型分组消失。

用静态密钥也可以:把 `apiKeyEnv` 改为自定义凭据引用并在 DSH 凭据仓或启动环境中配置它。
默认引用为 `AIPROXY_ACCESS_TOKEN`;只有已登录时设置页才显示「退出登录」。

## 设置项(ai-proxy 分节)

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| baseURL | http://localhost:18080 | 网关地址;OAuth 发现、模型列表、推理共用 |
| clientId | dsh | OAuth 客户端 id;2–64 位,以小写字母或数字开头,其余可用 `a-z0-9._-` |
| apiKeyEnv | AIPROXY_ACCESS_TOKEN | 静态密钥凭据引用;可覆盖 |
| defaultReasoningEffort | '' | 默认档位;留空 = 该模型 ladder 的第一档 |
| maxTokens / defaultContextWindow | 65536 / 200000 | 目录未给出时的兜底值 |
| modelCacheTtlMs | 300000 | 模型目录缓存 |
| remoteAccess | false | 仅本机设置卡可启用的远程特权通道开关 |
| remoteAuthSecret | '' | secret-role 回退密钥；优先使用 `DSH_REMOTE_CONTROL_SECRET` 凭据/环境变量 |
| models | [] | 静态兜底目录(未登录/网关不可达时) |
| retryPolicy | 内置默认 | 重试策略,语法同 dsh-llm |

## 已知限制

- 图片输入已支持:网关 /v1/models 的 `input_modalities` 声明了模型可读的媒体
  (text/image/audio/video,未声明的模型按乐观默认开放图片),插件据此向 DSH 报告
  `inputModalities` 以驱动图片入口;发送时经 attachment 服务读图并转成 OpenAI
  `image_url` data URL。系统/助手消息与工具结果中的图片会被显式拒绝
  (UNSUPPORTED_CONTENT,不做静默丢弃)。
- 思考档位 id 原样透传:某个模型 ladder 之外的档位请求会交给网关钳制/拒绝,错误信息里带
  上游枚举,便于排查。
- 当前 DSH 没有公开的第三方 Provider 编辑器扩展点,因此插件不在「模型」设置页创建
  AI Proxy 行,避免「未知 Provider」提示;登录入口放在独立设置分节。适配器和登录后的
  模型仍正常出现在模型选择器。扩展点需求见
  [deepseek-harness#1491](https://github.com/deepseek-ai/deepseek-harness/discussions/1491)。
  clientId、重试策略等高级字段仍在 settings.yaml 的 ai-proxy 段编辑。

## 开发与测试

lib/index.js 是零构建的 host 插件入口,lib/oauth.js 封装 OAuth 令牌生命周期,lib/client.js
通过公开的 settings.section 提供 AI Proxy 与远程控制设置页;host 文件均为 ESM,依赖走
profile 的 hoisted node_modules。开发期把 harness 的 node_modules 软链进来即可:

~~~sh
ln -sfn "<harness checkout>/node_modules" clients/dsh/node_modules
npm test --prefix clients/dsh
~~~

与网关的契约见 docs/clients/oauth-login.md:发现文档、强制 PKCE S256、未登记客户端仅
回环回调、refresh 轮换与重放吊销。
