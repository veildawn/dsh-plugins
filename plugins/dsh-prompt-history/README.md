# dsh-prompt-history

DeepSeek Harness (DSH) 提示词历史导航与跨端同步插件（Shell-like Prompt History Navigator & Sync）。

在 DSH 对话框输入区域提供类似终端/Shell 的提示词历史查看与漫游体验：
- 🔒 **严格会话绑定（Session Isolation）**：提示词历史与当前会话（`sessionId`）一对一强绑定，切换会话自动隔离，不同会话之间绝不串门。
- ☁️ **宿主持久化与跨端多浏览器同步**：历史提示词通过宿主 RPC 实时持久化于服务器本地存储（`~/.dsh/prompt-history/<sessionId>.json`），即使换浏览器、换设备、换终端打开该会话，历史提示词即刻全量同步！
- ⌨️ **`↑` (ArrowUp) / 📱 单指向上滑**：浏览上一条历史提示词（空闲编辑时仅在第一行触发，避免影响多行编辑；进入历史浏览后方向键自由翻页）。
- ⌨️ **`↓` (ArrowDown) / 📱 单指向下滑**：浏览下一条历史提示词。
- 📱 **移动端触控滑动（Swipe）**：在输入框区域向上快速轻扫切换上一条，向下轻扫切换下一条，并带触觉微震动反馈。
- 💾 **自动草稿暂存（Draft Stashing）**：浏览历史前未发送的输入内容会自动暂存，翻回最下方或按 `Esc` 键即刻恢复。
- 🎯 **智能避让**：输入法拼音合成（IME）或打开 `@` / `/` 触发菜单（`[data-trigger-menu]`）时自动让位。
- 🔄 **原子去重与安全截断**：每条限长 8192 字符，单会话最多保留 200 条，原子级文件存储防止读写冲突。草稿读写走官方 `conversation.input.left` 的 `useInput` + `inputActions.setDraft`，完美支持 Lexical contenteditable composer。

---

## 📦 安装与配置

### 1. 本地打包与安装

```bash
cd plugins/dsh-prompt-history
npm pack
dsh plugin add --profile web ./dsh-prompt-history-0.3.2.tgz
```

### 2. 重启生效

Windows 环境请使用仓库根目录脚本（不要使用不存在的 `dsh service restart`）：

```powershell
.\scripts\dsh-web.ps1 restart
```

或 cmd：

```cmd
scripts\dsh-web.cmd restart
```

---

## 🛠️ 运行测试

```bash
cd plugins/dsh-prompt-history
npm test
```
