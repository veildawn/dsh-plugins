# dsh-mobile-adapter

DeepSeek Harness (DSH) Web 移动端全量体验优化与响应式适配插件。

无需修改 DSH 源码，零侵入通过前端扩展注入实现手机/移动端浏览器的极致体验。

## 功能特性

- 📱 **响应式布局与视口自适应**：自适应手机屏幕高度（100dvh / safe-area），彻底消除底部导航栏/工具栏遮挡与抖动。
- 📷 **移动端原生文件与图片上传**：输入框支持一键调用手机原生相册与文件选择器，自动注入为多模态图片附件。
- 🧰 **工作区工具箱 (Mobile Toolbox)**：移动端在输入框右侧或底部集成统一折叠工具箱，无缝集合文件查看器、本地终端、提示词历史等插件入口。
- 🔘 **全操作按钮规范化**：对话框底部全操作按钮圆形统一设计，触控点击更舒适，防误触。
- 📑 **抽屉与弹窗防溢出**：对侧边栏会话抽屉、历史记录抽屉等全部进行移动端全屏/半屏底部抽屉（Bottom Sheet）自适应改造。

## 安装

```bash
# 1. 使用 GitHub Release 在线安装
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-mobile-adapter@v0.1.30/dsh-mobile-adapter-0.1.30.tgz

# 2. 或在本地打包安装
dsh plugin add --profile web ./plugins/dsh-mobile-adapter/dsh-mobile-adapter-0.1.30.tgz
```

## 重启生效

- **Windows 用户**：
  ```powershell
  .\scripts\dsh-web.ps1 restart
  # 或 cmd:
  scripts\dsh-web.cmd restart
  ```
- **Linux / macOS 用户**：
  ```bash
  dsh service restart --profile web
  ```

## License

MIT
