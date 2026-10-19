# dsh-zcode-theme

DeepSeek Harness (DSH) Web 的 **ZCode 官方 Zai 主题**。色值全部取自
[zai-org/ZCode](https://github.com/zai-org/ZCode) 的 `packages/ui/src/styles.css`，
并由快照测试守护，保证与上游逐值一致。

本插件只负责**视觉**。移动端布局（Viewport、Drawer、Safe Area、触控区）仍由
`dsh-mobile-adapter` 承担。

## 视觉要点

- **单色品牌体系**：亮色 `--color-brand: #000000`，暗色 `#ffffff`。
  主按钮、焦点、选中态都用「前景色 vs 背景色」对比表达，不引入彩色强调。
- **两层底色**：窗口底 `--color-background-win-alt`（暗 `#2b2b2b`），
  主区内容卡 `--color-background`（暗 `#161616`），卡片带 6px 圆角与 1px 描边、
  四周内缩 4px——这是官方桌面版「左右两边」的观感来源（见 `lib/styles/frame.css`）。
  侧栏直接坐在窗口底色上，不再使用 `--color-sidebar`（官方桌面亦如此）。
- **表面层级**：`background → panel(#202020) → card(#2b2b2b) → input/menu`。
- **文字三级**：`#d4d4d4` / 60% 混合 / 30% 混合（亮色为 `#262626` 系列）。
- **发丝边框**：`rgba(255,255,255,0.10)`，悬停 `0.15`。
- **终端 ANSI 16 色**：跟随官方 `--color-terminal-*`，选区用品牌色低透明度混合。
- **轨迹色**：`--color-trajectory-*` 为 Agent 的 user / assistant / reasoning /
  tool-call / tool-result 五个阶段各配一个语义色。
- **Mention 节点**：file / skill / command / subagent / session / plugin 六类引用
  各有独立底色与前景色，输入框与消息回显共用同一组 Token。
- 支持 `prefers-reduced-motion`。
- 首屏零闪烁：Web 端服务端直出注入，桌面端走结构化注入行回放。

## 选择器契约

宿主前端由几十个 `dsh-client-ui-*` 插件组成，每个插件自带 CSS Modules 类名
（形如 `_2H3hWW_root`、`Hqq-bq_previewBadge`）。主题只能依附这些**运行时真实存在**
的类名，否则选择器永远不命中——颜色再准，版式仍是宿主默认。

`test/fixtures/host-classes.json` 是宿主类名快照，`test/host-selectors.test.mjs`
逐条核对主题里出现的每个 CSS Module 类名。宿主升级后重新采集：

```bash
node scripts/harvest-host-classes.mjs   # 默认读取 D:/Program Files/DSH/resources/app.asar
```

两条约定：

- 类名以数字开头时（如 `3HsggG_selector`），CSS 里必须写成 `\33 ` 转义，极易写错
  并导致整条规则被丢弃；主题统一改用 `[class*="3HsggG_selector"]`，测试守护。
- 类名里的 hash 会随宿主构建变化，测试失败即代表该次升级需要重新对齐。


## 与官方的关系

| 上游 | 本插件 |
| :--- | :--- |
| `styles.css` 的 `.theme-zai-light` / `.theme-zai-dark` | `lib/tokens.js` 的 `ZAI_PALETTE`（193 项官方色，逐值一致） |
| 官方 `--color-*` 变量 | 同名的 `--color-*` CSS 变量（`light-dark()` 成对输出） |
| 宿主 DSH 的 `--dsw-*` 语义层 | `HOST_TOKEN_MAP`（127 项映射，全部指向 `ZAI_PALETTE`） |

`test/fixtures/zai-palette.json` 是官方色板的快照；`test/zai-parity.test.mjs`
逐项比对，任何上游漂移都会让测试失败。

## 安装

```bash
dsh plugin --profile web add https://github.com/veildawn/dsh-plugins/releases/download/dsh-zcode-theme@v0.2.0/dsh-zcode-theme-0.2.0.tgz
```

或本地打包：

```bash
dsh plugin --profile web add ./plugins/dsh-zcode-theme/dsh-zcode-theme-0.2.0.tgz
```

## 重启生效

- **macOS / Linux**：`./scripts/dsh-web.sh restart`
- **Windows**：`.\scripts\dsh-web.ps1 restart` 或 `scripts\dsh-web.cmd restart`

## License

MIT
