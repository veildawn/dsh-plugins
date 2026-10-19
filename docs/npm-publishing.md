# npm 发布指引（Trusted Publishing）

本仓库的 12 个插件统一发布到 npm scope `@weniatall/` 下：
`@weniatall/dsh-terminal`、`@weniatall/dsh-file-viewer` …

发布走 **npm Trusted Publishing（GitHub OIDC）**，不使用长期 token，因此：

- 不存在 token 90 天过期、需要定期轮换的问题；
- 仓库里不放任何 npm 密钥（无需 `NPM_TOKEN` secret）；
- npm 自动为每个版本生成 **provenance** 来源证明。

以下是完整的一次性配置流程。

---

## 一、为什么用 scope

npm 上 9 个无 scope 的包名已被第三方占用且不可转让：

| 包名 | 占用者 | 对方 latest |
| --- | --- | --- |
| `dsh-terminal` | ff-jcg | 0.1.1 |
| `dsh-file-viewer` | liguobao | 0.3.7 |
| `dsh-archive-manager` | jasonrale | 1.1.1 |
| `dsh-plugin-manager` | ruihuahe | 0.1.0 |
| `dsh-model-roles` | pension-qin | 0.1.0 |
| `dsh-prompt-history` | xiaoffy | 1.4.2 |
| `dsh-remote-control` | providcc | 2.0.21 |
| `dsh-jev` | zhangxaochen | 0.2.0 |
| `dsh-image-gen` | shanliuling | 0.9.1 |

只有 `dsh-mobile-adapter`、`dsh-zcode-theme`、`dsh-ai-proxy` 三个无 scope 名是空闲的。
为了让 12 个包的安装方式完全一致，**统一**迁移到 `@weniatall/` scope。

---

## 二、命名约定（重要）

**npm 包名带 scope，GitHub tag 保持无 scope 短名**，两者刻意不同：

```
npm 包名     : @weniatall/dsh-terminal
GitHub tag   : dsh-terminal@v0.1.16
Release 资产 : dsh-terminal-0.1.16.tgz
```

原因有两条，改动任何一条都会让用户的安装命令失效：

1. **GitHub Release 的下载 URL 把 tag 当作单个路径段**。若 tag 写成
   `@weniatall/dsh-terminal@v0.1.16`，URL 里的 `/` 会把它切成两段，
   历史 release 的安装命令全部 404。
2. **`plugins/dsh-plugin-manager/lib/core.js` 的 `isAllowedRepoUrl()`** 按
   `"<name>@v<ver>/<name>-<ver>.tgz"` 校验来源白名单。短名可以原样复用，
   带 scope 则需要改写正则并让历史 release 失效。

另外 `npm pack` 会把 scope 展平进文件名
（`@weniatall/dsh-terminal@0.1.16` → `weniatall-dsh-terminal-0.1.16.tgz`），
因此 CI 与 `scripts/release.sh` 都会在打包后**显式重命名**成 `dsh-terminal-0.1.16.tgz`。

---

## 三、一次性配置 Trusted Publishing

> **新增插件时必读**：每新增一个插件，都要人工做三件事 ——
> ① `npm login --auth-type=web`；② 在 `plugins/<plugin>` 里 `npm publish --access public`
> 完成首版；③ 到 `https://www.npmjs.com/package/@weniatall/<plugin>/access` 配一次
> trusted publisher（`veildawn` / `dsh-plugins` / `release-plugin.yml`）。
> 仓库根 [README](../README.md#️-新增插件时必须手动做的三步操作一次性) 有同样的清单。

对**每一个**包都要做一次。包必须先存在，因此首次发布需要手动完成（见第四节）。

### 3.1 进入包设置页

打开 `https://www.npmjs.com/package/@weniatall/dsh-terminal/access`，
在 **Trusted publishing** 区域点 **Add trusted publisher**。

### 3.2 填写表单

| 字段 | 值 |
| --- | --- |
| Publisher | **GitHub Actions** |
| Organization or user | `veildawn` |
| Repository | `dsh-plugins` |
| Workflow filename | `release-plugin.yml` |
| Environment name | 留空（不使用 environment 保护） |

> 注意 `Organization or user` 填的是 **GitHub 仓库归属**（`veildawn`），
> 不是 npm 账号名（`weniatall`）。两者不同是正常的，npm 校验的是仓库身份。

### 3.3 重复 13 次

需要配置的包列表：

```
@weniatall/dsh-ai-proxy
@weniatall/dsh-archive-manager
@weniatall/dsh-file-viewer
@weniatall/dsh-image-gen
@weniatall/dsh-jev
@weniatall/dsh-mobile-adapter
@weniatall/dsh-model-roles
@weniatall/dsh-plugin-manager
@weniatall/dsh-prompt-history
@weniatall/dsh-remote-control
@weniatall/dsh-task-models
@weniatall/dsh-terminal
@weniatall/dsh-zcode-theme
```

> 配置了 trusted publisher 之后，建议同时把 **Publishing access** 设为
> "Require two-factor authentication and disallow tokens"，彻底关掉 token 通道。

---

## 四、首次发布（必须手动一次）

Trusted Publishing 只能给**已存在**的包配置。所以每个包的首个版本要从本地发：

```bash
# 1. 登录（浏览器 OAuth，会自动开 2FA 流程）
npm login --auth-type=web

# 2. 确认身份
npm whoami          # 应输出 weniatall

# 3. 打包内容自检
node scripts/verify-pack-contents.mjs --plugin dsh-terminal

# 4. 发布首个版本
cd plugins/dsh-terminal
npm publish --access public
```

首次发布**不需要** `--provenance`（本地没有 OIDC 身份），之后走 CI 的版本才会有。

发布成功后，回到 3.1 给这个包加上 trusted publisher。

---

## 五、后续发布

### 方式 A：推 tag（推荐，默认即发布 npm）

日常发布只需要**推一个 tag**，npm 与 GitHub Release 一起产出，不需要再手动触发：

```bash
# 1. 改 plugins/<plugin>/package.json 的 version
# 2. 提交并推送
git add plugins/dsh-terminal && git commit -m "feat(dsh-terminal): ... (v0.1.16)"
git push origin main

# 3. 打 tag 并推送 —— 这就是完整发布
git tag -a "dsh-terminal@v0.1.16" -m "dsh-terminal v0.1.16"
git push origin "dsh-terminal@v0.1.16"
```

workflow 会依次执行：跑测试 → 校验打包内容 → `npm pack` 并重命名 →
`npm publish --access public --provenance`（走 OIDC）→ 创建 GitHub Release。

> **版本已存在时会自动跳过 npm 发布，而不是让整个 job 失败。**
> 重跑 workflow、或重推修正后的同名 tag 都不会再报
> `cannot publish over the previously published versions`，GitHub Release 仍会正常创建。
> 想发新版本就必须升 `package.json` 的 version —— 已发布的版本无法覆盖。

### 方式 B：GitHub Actions 手动触发

在仓库 **Actions → Release Single Plugin → Run workflow** 中填 `plugin` 与 `version`。
`publish_npm` 默认已勾选；取消勾选则只建 GitHub Release，不发 npm。

### 方式 C：本地脚本

```bash
./scripts/release.sh dsh-terminal 0.1.16
```

该脚本会跑本地预检与测试、打包，然后**推 tag**（因此同样会触发 workflow 并发布 npm），
随后再用 `gh release create` 自己建一次 Release。

> ⚠️ 因为推 tag 已经会触发 CI，脚本里的 `gh release create` 与 workflow 的
> “Create GitHub Release” 步骤存在竞争：谁先创建谁生效，另一方会因 tag 已有 Release 而失败。
> 日常发布建议直接用**方式 A**（只推 tag），让 CI 统一产出 npm 包与 Release。

### 方式 D：本地手动发 npm

```bash
cd plugins/dsh-terminal
npm version patch --no-git-tag-version
npm publish --access public
```

本地发布会消耗你账号里的 token/2FA，且**没有 provenance**。建议只在 CI 不可用时使用。

---

## 六、版本号规则

- 每个插件独立版本，互不影响；
- 发布前先改 `plugins/<plugin>/package.json` 的 `version`；
- tag、`package.json`、Release 资产名三者版本必须一致，CI 会校验并拒绝不一致的情况。

---

## 七、验证发布结果

```bash
# 1. 确认包已上线并带 provenance
npm view @weniatall/dsh-terminal --json | node -p "JSON.parse(require('fs').readFileSync(0)).dist-tags"

# 2. 检查 provenance（应返回 attestations 信息）
npm view @weniatall/dsh-terminal dist.attestations

# 3. 端到端安装测试
dsh plugin --profile test add @weniatall/dsh-terminal
```

---

## 八、故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `403 Forbidden — you must be logged in` | OIDC 未生效，npm 仍按 token 认证 | 确认 workflow 有 `id-token: write`；确认包已配置 trusted publisher 且仓库名/文件名完全一致 |
| `E404 Not Found — PUT @weniatall/xxx` | 包名不存在且无权限创建 | 首次必须先手动 `npm publish`，或确认 scope 归属 `weniatall` 账号 |
| `E402 Payment Required` | scope 包默认私有 | 确认 `publishConfig.access = "public"` 或命令带 `--access public` |
| `npm pack` 产物名与 Release 资产不符 | 忘了重命名 | CI 已自动处理；本地手动发布需自行 `mv` |
| 插件管理器拒绝安装自家包 | 资产名不是 `<短名>-<版本>.tgz` | 同上，必须重命名 |
| 装好后插件不加载 | `cordis.patch.yml` 的 `name` 与包名不一致 | patch 里必须是 `'@weniatall/xxx'`（**要加引号**，YAML 中 `@` 是保留字符） |

---

## 九、YAML 里的 `@` 必须加引号

这是一个已经踩过的坑。`cordis.patch.yml` 中：

```yaml
# 错误 —— js-yaml 报 "bad indentation of a mapping entry"，宿主启动直接失败
- insert:
    - id: terminal
      name: @weniatall/dsh-terminal

# 正确
- insert:
    - id: terminal
      name: '@weniatall/dsh-terminal'
```

`@` 是 YAML 的保留指示符，裸写会被解析器拒绝。
