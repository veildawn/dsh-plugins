# 开发规范

## 【最高优先级】禁止擅自在本机部署插件与重启服务

**严禁在修改插件代码后擅自执行部署（如 `dsh plugin add`）或重启本机服务（如 `scripts/dsh-web.cmd restart` / `scripts/dsh-web.ps1 restart`）。**

- **仅当用户的明确指令中明确要求安装/部署到本机或重启服务验证时**，才允许执行部署和重启操作。
- 在日常开发、修复 bug、功能实现或重构中，默认只在插件目录内完成代码修改、编译打包（如 `npm test`、`node build.mjs`、`npm pack`）和测试用例验证，不得擅自触碰本机 DSH 运行环境及 Profile。

## 部署/安装插件到本地 DSH Profile：必须走 `dsh plugin add`

**禁止**手动把源码文件（`lib/client.js`、`lib/index.js` 等）直接复制/覆盖到
`~/.dsh/profiles/<profile>/node_modules/<plugin>/` 下调试。

原因（真实事故）：2026-08-20 排查 `dsh-file-viewer` 的 “Failed to load
plugins” 报错时发现，部署目录下的 `lib/client.js` 只是仓库源文件的前
50427/75727 字节，在 `useState(false);` 处被硬生生截断——多半是编辑器/复制
命令中途被打断。文件语法不完整，浏览器解析整个 `<script>` 失败，导致文件顶部
的 `window.__ModuleLoader__.load(...)` 调用完全没有执行到，表现为宿主报错
`bundle ... loaded without registering "<id>" via __ModuleLoader__.load`。
这类问题只有对着两份文件做字节级 diff 才能定位，排查成本很高，而且没有任何
机制（版本号、lockfile、哈希）能提前发现文件被改动过。

正确流程（**仅在用户明确指令要求在本机部署/验证时执行**）：

```bash
# 1. 跑该插件的单元测试
cd plugins/<plugin>
npm test          # 或仓库根目录: pnpm --filter <plugin> test

# 2. 重新打包（生成全新 .tgz，绝不手改 node_modules 里的文件）
npm pack

# 3. 通过官方 CLI 安装/更新到目标 profile
dsh plugin add --profile web ./plugins/<plugin>/<plugin>-<version>.tgz

# 4. 重启服务生效（Windows 下使用 scripts/dsh-web.cmd 或 scripts/dsh-web.ps1，见下文）
```

- `dsh plugin add` 会走 pnpm 完整安装链路，`package.json`/`pnpm-lock.yaml`
  里的 `file:` 依赖会被正确解析、写入、校验，不会出现半个文件的情况。
- 如果只是改了未发布的本地版本号（如 0.1.0 → 0.1.1），同样要重新 `npm pack`
  再 `dsh plugin add` 覆盖安装，不能只把新文件拷进旧安装目录。
- 排查“插件加载失败/报错”类问题时，第一步应确认部署目录下的文件是否与仓库
  源码字节级一致（`diff`/`cmp`），而不是先假设代码逻辑有问题。

## Windows 环境不能用 `dsh service restart`

所有插件 README 里写的 `dsh service restart` 依赖宿主打包好的 systemd/launchd 单元。
**`@deepseek-ai/dsh` CLI 本身没有 `service` 子命令**——`dsh --help` 只列出根命令、
`web`、`plugin` 三个命令——在没有那层封装的环境（包括本机的 Windows + Git Bash）
执行会直接报 `error: too many arguments. Expected 0 arguments but got 2: service,
restart.`。

Windows 下使用统一控制脚本 `scripts/dsh-web.cmd`（或 `scripts/dsh-web.ps1`），支持 `start` / `stop` / `restart` / `status` 四个子命令：

```powershell
# 检查运行状态与端口
.\scripts\dsh-web.ps1 status
# 或 cmd:
scripts\dsh-web.cmd status

# 重启 dsh web 服务
.\scripts\dsh-web.ps1 restart
# 或 cmd:
scripts\dsh-web.cmd restart

# 启动 / 停止
.\scripts\dsh-web.ps1 start
.\scripts\dsh-web.ps1 stop
```

脚本原理：查找当前运行中包含 `@deepseek-ai\dsh` 或 `dsh\lib\bin.js` 的 `node.exe` 进程，停止旧进程，并使用 `dsh.cmd web` 在后台拉起新实例，同时显示监听端口。

**改完任何插件源码、且用户明确要求让本机运行中的 DSH 服务生效时，必须先按上面「走
`dsh plugin add`」的流程重新安装，再执行这个重启脚本**——两步缺一都会导致
运行中的服务和仓库源码不一致。
