# dsh-terminal (DeepSeek Harness Local Terminal Plugin)

**DeepSeek Harness (DSH)** 官方跨平台本地交互式终端插件。支持在 **Windows、Linux、macOS** 上直接调用本地原生终端（PowerShell、CMD、Git Bash、Bash、Zsh 等），并深度适配桌面端与移动端触控交互体验。

---

## ✨ 核心特性

- 🌐 **全平台原生调用**：
  - **Windows**：自动探测并优先调用 PowerShell 7 / Windows PowerShell / CMD / Git Bash，ConPTY 引擎驱动。
  - **macOS**：原生调用 Zsh / Bash / sh，完整支持 256 色及 ANSI 格式化。
  - **Linux**：原生调用 Bash / Zsh / sh，支持 TrueColor。
- 📑 **多标签页并发管理 (Multi-Tab)**：
  - 支持在单个抽屉内并发开启多个独立终端会话。
  - 会话工作目录（`cwd`）自动与当前 DSH 项目/会话同步绑定。
- 📱 **深度移动端适配 (Mobile-Friendly)**：
  - **触控辅助按键栏**：虚拟键盘上方常驻 `Esc`、`Tab`（自动补全）、`Ctrl+C`（中断）、`Ctrl+D`、`Clear`、方向键 `↑ ↓ ← →`。
  - **贴边拖拽悬浮球**：手机端专属自由拖拽悬浮入口，支持惯性吸附边缘与位置记忆。
  - **视口自适应**：支持 `100dvh` 及 iOS/Android 安全区（`--dsh-sat` / `--dsh-sab`）避让。
- 🛡️ **安全脱敏与生命周期隔离**：
  - 自动净化敏感环境变量（如 `DEEPSEEK_API_KEY`、`DSH_*` 令牌），避免凭据泄露至子进程。
  - 宿主退出或关闭标签时执行完整进程树清理（Teardown），杜绝孤儿进程占用后台资源。

---

## 📦 安装与部署

### 1. 使用 DSH 官方 CLI 安装

```bash
# 安装终端插件
dsh plugin add --profile web ./plugins/dsh-terminal/dsh-terminal-0.1.0.tgz
```

### 2. 重启 DSH 服务生效

- **Windows 用户**（使用仓库自带脚本）：
  ```powershell
  powershell -File scripts/dsh-service.ps1 restart -Profile web
  ```
- **Linux / macOS 用户**：
  ```bash
  dsh service restart --profile web
  ```

---

## 📄 License
MIT
