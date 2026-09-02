# dsh-prompt-history

DeepSeek Harness (DSH) 提示词历史导航插件（Shell-like Prompt History Navigator）。

在 DSH 对话框输入区域提供类似终端/Shell 的提示词历史查看体验：
- ⌨️ **`↑` (ArrowUp) / 📱 单指向上滑**：浏览上一条历史提示词（在第一行或开头触发，避免影响多行编辑）。
- ⌨️ **`↓` (ArrowDown) / 📱 单指向下滑**：浏览下一条历史提示词。
- 📱 **移动端专属触控滑动手势（Swipe）**：针对手机触屏无物理方向键的痛点，直接在输入框区域向上快速轻扫切换上一条，向下轻扫切换下一条，并带触觉微震动反馈。
- 💾 **自动草稿暂存（Draft Stashing）**：浏览历史前未发送的输入内容会自动暂存，当翻回最下方或按 `Esc` 键时无缝恢复。
- 🎯 **智能避让**：在输入法拼音合成（IME）或者打开 `@` 文件引用 / `/` 命令补全菜单时自动让位，互不冲突。
- 🔄 **自动去重与持久化**：发送成功的历史记录自动保存至本地浏览器存储（`localStorage`）。

---

## 📦 安装与配置

### 1. 本地打包与安装

```bash
cd plugins/dsh-prompt-history
npm pack
dsh plugin add --profile web ./dsh-prompt-history-0.1.0.tgz
```

### 2. 重启生效

Windows 环境：
```powershell
powershell -File scripts/dsh-service.ps1 restart -Profile web
```

---

## 🛠️ 运行测试

```bash
cd plugins/dsh-prompt-history
npm test
```
