# dsh-zcode-theme

DeepSeek Harness (DSH) Web 的 ZCode Design System。以官方 ZCode 桌面端与手机端 Remote Control 的视觉语言为基准，统一 Desktop / Tablet / Mobile 的色彩、材质、Typography、组件表面与交互状态。

本插件只负责**视觉**。移动端布局（Viewport、Drawer、Safe Area、触控区）仍由 `dsh-mobile-adapter` 承担。

## 视觉要点

- 深炭灰画布 `#1A1A1A`，浅色画布 `#F7F7F5`；跟随宿主 Appearance 的 light / dark / system
- 暖橙红品牌色 `#E85D3A`，只用于主操作 / 选中 / Focus
- 低对比 Surface 层级、Hairline 边框、大圆角
- Active 使用 Module 抬升 + 左侧 3px 品牌指示条
- Chat / Code / Terminal 共用同一套设计语言
- 支持 `prefers-reduced-motion`

## 安装

```bash
dsh plugin add --profile web https://github.com/veildawn/dsh-plugins/releases/download/dsh-zcode-theme@v0.1.16/dsh-zcode-theme-0.1.16.tgz
```

或本地打包：

```bash
dsh plugin add --profile web ./plugins/dsh-zcode-theme/dsh-zcode-theme-0.1.16.tgz
```

## 重启生效

- **Windows**：`.\scripts\dsh-web.ps1 restart`
- **Linux / macOS**：`dsh service restart --profile web`

## License

MIT
