# dsh-mobile-adapter

DeepSeek Harness (DSH) Web 移动端全量体验优化与响应式适配插件。

无需修改 DSH 源码，零侵入通过前端扩展注入实现手机/移动端浏览器的极致体验。

## 功能特性

- 📱 **响应式布局与视口自适应**：自适应手机屏幕高度（100dvh / safe-area），彻底消除底部导航栏/工具栏遮挡与抖动。
- 📷 **移动端原生文件与图片上传**：输入框支持一键调用手机原生相册与文件选择器，自动注入为多模态图片附件。
- 🧰 **工作区工具箱 (Mobile Toolbox)**：移动端在输入框右侧或底部集成统一折叠工具箱，无缝集合文件查看器、本地终端、提示词历史等插件入口。
- 🔘 **全操作按钮规范化与去冗余**：对话框底部全操作按钮圆形统一设计，触控点击更舒适，防误触。权限模式选择器在移动端收成 32px 圆钮（隐藏文字与下拉箭头），选择器哈希同时覆盖 `dsh 0.1.x` 的 `Sh0Q9G_*` 与 `0.2.1-rc.2` 的 `iWlSmW_*`；移动端隐藏原生冗余的「+」快捷指令按钮（移动端直接键入 `/` 即可触发指令，省出单行空间避免挤压换行，多层覆盖 `.uV2eYG_add`、`.ccegLa_add` 与 `[class*="_add"]`、`button[aria-haspopup="listbox"]` 语义选择器）。
- 🧭 **上下文按钮不再溢出**：宿主把上下文用量 meter 放在输入卡片下方，移动端会把它收回输入框内部，不再出现「52% 圆按钮」浮在输入框外的情况。窄屏放不下、必然折行的「N 轮 M 步 · tokens/s」「用量 · 缓存命中」统计药丸在移动端隐藏（按宿主稳定属性 `data-composer-stat` 命中，不依赖会随宿主版本变化的哈希类名），只保留 14% 的上下文圆环，避免两行统计把圆环挤出卡片圆角。
- 📑 **抽屉与弹窗防溢出**：对侧边栏会话抽屉、历史记录抽屉等全部进行移动端全屏/半屏底部抽屉（Bottom Sheet）自适应改造。
- ↩️ **右侧栏（文件/终端）避让与一键返回**：右侧栏在移动端展开时自动避开顶部导航栏并放大 tab 与收起按钮触控区，顶栏右上角变为「← 对话」一键收起面板回到会话；冷启动恢复页面时若右侧栏曾处于展开态，自动收起，不再出现刷新或重开网页后被锁在文件栏、回不到对话的问题。
- 🔍 **聚焦输入不再整页放大**：iOS Safari 会对计算字号小于 16px 的可编辑元素（输入框已是 contenteditable）聚焦时强制放大整个视口，顶栏按钮随之被挤出屏幕。输入区字号现统一抬到 16px 下限（用户在设置里选定的更大字号照常生效），聚焦时页面保持原有缩放，按钮不再消失。

## 安装

```bash
# 1. 使用 GitHub Release 在线安装
dsh plugin --profile web add https://github.com/veildawn/dsh-plugins/releases/download/dsh-mobile-adapter@v0.1.49/dsh-mobile-adapter-0.1.49.tgz

# 2. 或在本地打包安装
dsh plugin --profile web add ./plugins/dsh-mobile-adapter/dsh-mobile-adapter-0.1.49.tgz
```

## 选择器契约

移动端样式同样只能依附宿主运行时真实存在的 CSS Modules 类名。宿主每次构建都会换
哈希（`ccegLa_*` → `uV2eYG_*`），所以这里的规则分三层，越靠后越稳：

1. **语义钩子优先**：`[data-slot=…]`、`[data-composer-card]`、`[data-conversation-scroll]`、
   `[role="dialog"]`、`[data-shell-overlay]`——宿主渲染时写死的属性，不随构建变化。
2. **去哈希兜底**：`:is(.H0stHa_details,[class$="_details"])`，在保留当前哈希的同时
   按局部名后缀匹配，宿主换 hash 后仍然命中。用 `node scripts/add-host-local-fallbacks.mjs`
   生成；它**只在规则已带语义作用域时**加兜底——`_root` 在宿主里有 37 个组件共用、
   `_row` 29 个，裸写 `[class$="_root"]` 会把侧栏内边距糊到整个应用上。个别关键面板
   改用元素类型收窄（轨迹详情面板是 `aside[class$="_details"]`）。
3. **历史版本兼容**：`Sh0Q9G_*`、`ccegLa_*` 等旧宿主哈希保留，并登记在
   `test/mobile-adapter.test.mjs`；一旦某个类名重新出现在宿主中，测试会要求把它删掉。

仓库根 `test/fixtures/host-classes.json` 是宿主类名快照（桌面版 + Web 版，与
`dsh-zcode-theme` 共用），宿主升级后重新采集：

```bash
node scripts/harvest-host-classes.mjs --all          # 桌面版 + Web 版一起采，推荐
node scripts/harvest-host-classes.mjs --web          # 只采 `dsh web` 的前端
node scripts/add-host-local-fallbacks.mjs            # 给新出现的类名补去哈希兜底
node scripts/add-host-local-fallbacks.mjs --check    # 只检查，有未兜底项则以非零退出
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
