# dsh-mobile-adapter

DeepSeek Harness (DSH) Web 移动端全量体验优化与响应式适配插件。

无需修改 DSH 源码，零侵入通过前端扩展注入实现手机/移动端浏览器的极致体验。

## 功能特性

- 📱 **响应式布局与视口自适应**：自适应手机屏幕高度（100dvh / safe-area），彻底消除底部导航栏/工具栏遮挡与抖动。
- 📷 **移动端原生文件与图片上传**：输入框支持一键调用手机原生相册与文件选择器，自动注入为多模态图片附件。
- 🧰 **工作区工具箱 (Mobile Toolbox)**：移动端在输入框右侧或底部集成统一折叠工具箱，无缝集合文件查看器、本地终端、提示词历史等插件入口。
- 🔘 **全操作按钮规范化**：对话框底部全操作按钮圆形统一设计，触控点击更舒适，防误触。
- 🧭 **上下文按钮不再溢出**：宿主把上下文用量 meter 放在输入卡片下方，移动端会把它（含统计行）收回输入框内部，不再出现「52% 圆按钮」浮在输入框外的情况。
- 📑 **抽屉与弹窗防溢出**：对侧边栏会话抽屉、历史记录抽屉等全部进行移动端全屏/半屏底部抽屉（Bottom Sheet）自适应改造。
- ↩️ **右侧栏（文件/终端）避让与一键返回**：右侧栏在移动端展开时自动避开顶部导航栏并放大 tab 与收起按钮触控区，顶栏右上角变为「← 对话」一键收起面板回到会话；冷启动恢复页面时若右侧栏曾处于展开态，自动收起，不再出现刷新或重开网页后被锁在文件栏、回不到对话的问题。

## 安装

```bash
# 1. 使用 GitHub Release 在线安装
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-mobile-adapter@v0.1.40/dsh-mobile-adapter-0.1.40.tgz

# 2. 或在本地打包安装
dsh plugin add --profile web ./plugins/dsh-mobile-adapter/dsh-mobile-adapter-0.1.40.tgz
```

## 重启生效

- **macOS / Linux 用户**：
  ```bash
  ./scripts/dsh-web.sh restart
  ```
- **Windows 用户**：
  ```powershell
  .\scripts\dsh-web.ps1 restart
  # 或 cmd:
  scripts\dsh-web.cmd restart
  ```

## License

MIT
