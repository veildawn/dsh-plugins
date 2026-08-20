# 开发规范

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

正确流程（每次改动某个插件源码后，要在本机验证效果时）：

```bash
# 1. 跑该插件的单元测试
cd plugins/<plugin>
npm test          # 或仓库根目录: pnpm --filter <plugin> test

# 2. 重新打包（生成全新 .tgz，绝不手改 node_modules 里的文件）
npm pack

# 3. 通过官方 CLI 安装/更新到目标 profile
dsh plugin add --profile web ./plugins/<plugin>/<plugin>-<version>.tgz

# 4. 重启服务生效
dsh service restart --profile web
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

Windows 下改用本仓库的 `scripts/dsh-service.ps1`，支持 `start` / `stop` / `restart` /
`status` 四个子命令：

```powershell
powershell -File scripts/dsh-service.ps1 status -Profile web
powershell -File scripts/dsh-service.ps1 restart -Profile web
# 后台运行、把 stdout/stderr 落到 $DSH_HOME/logs：
powershell -File scripts/dsh-service.ps1 restart -Profile web -Background
```

脚本原理：用 `Get-CimInstance Win32_Process` 找到当前 `dsh.cmd <profile>` 对应的
`node.exe` 进程（命令行里包含 `@deepseek-ai\dsh\lib\bin.js` 且以该 profile 名结尾），
`Stop-Process -Force` 结束它，再用 `dsh.cmd`（不是裸的 `dsh`，PowerShell 的
`Start-Process` 无法直接执行 POSIX shim）重新拉起一份。

**改完任何插件源码、需要让本机运行中的 DSH 服务生效时，必须先按上面「走
`dsh plugin add`」的流程重新安装，再执行这个重启脚本**——两步缺一都会导致
运行中的服务和仓库源码不一致。
