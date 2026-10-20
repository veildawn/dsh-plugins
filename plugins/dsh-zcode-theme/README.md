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
（形如 `hHd-Xa_root`、`Hqq-bq_previewBadge`）。主题只能依附这些**运行时真实存在**
的类名，否则选择器永远不命中——颜色再准，版式仍是宿主默认。

`test/fixtures/host-classes.json` 是宿主类名快照，`test/host-selectors.test.mjs`
逐条核对主题里出现的每个 CSS Module 类名。宿主升级后重新采集：

```bash
node scripts/harvest-host-classes.mjs --all   # 桌面版 + Web 版一起采，推荐
node scripts/harvest-host-classes.mjs --web   # 只采 `dsh web` 的前端
```

**必须采两个来源**：桌面版（Electron，前端在 `app.asar`）与 Web 版（前端在
`node_modules/@deepseek-ai/dsh-client-ui-*`）是两次独立构建，哈希完全不同
（同一时期桌面是 `Qt4Hga_primary`、Web 是 `uV2eYG_primary`）。只采一侧，
另一侧的选择器就全是死的，而且测试照样绿。

三条约定：

- 前缀可以很短（`pI_x6G_*` 首段只有 2 个字符），采集正则的下限不能写成 4。
- 数字开头的类名在 CSS 里写作 `._7yHdaG_header`，DOM 上的 className 也是
  `_7yHdaG_header`——前导下划线是**真实类名的一部分**，不是转义技巧。
- 类名里的 hash 会随宿主构建变化，测试失败即代表该次升级需要重新对齐。

## 特异性契约

主题是全局样式，社区插件（`dsh-task-models`、`dsh-remote-control` 等）各自往页面
里注入自己的 CSS。**主题的选择器绝不能比插件的单类规则（`0,1,0`）更高**，否则
插件配色会被静默压掉——没有报错、没有日志，只是「颜色不对」。

三条硬约束，`test/host-selectors.test.mjs` 逐条守护：

- 通用元素规则必须包 `:where()`：写 `[data-dsh-theme="zcode"] :where(input, textarea)`，
  不写 `[data-dsh-theme="zcode"] input`。后者是 `0,1,1`，会压掉 `.tm-input`。
- 禁用态只改 `opacity` 与 `pointer-events`，**不改 `color`**。实心主按钮一旦被改成
  次级文字色，就是深底深字。
- 次级按钮兜底规则（`button.tm-button` 之类）必须用 `:not([class~="tm-primary"])`
  排除主按钮，否则主操作的品牌底色会被换成次级配色。

另：插件侧**不要声明 `color-scheme`**。`light-dark()` 只认最近的 `color-scheme`
祖先，面板里一写 `color-scheme: light dark` 就退回跟随操作系统偏好；应用是暗色、
系统是亮色时，面板内的 `light-dark()` 全部解析到亮色侧（2026-10 的输入框暗底黑字
就是这样来的）。继承宿主写在 `html` 上的值即可。


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
dsh plugin --profile web add https://github.com/veildawn/dsh-plugins/releases/download/dsh-zcode-theme@v0.2.3/dsh-zcode-theme-0.2.3.tgz
```

或本地打包：

```bash
dsh plugin --profile web add ./plugins/dsh-zcode-theme/dsh-zcode-theme-0.2.3.tgz
```

## 重启生效

- **macOS / Linux**：`./scripts/dsh-web.sh restart`
- **Windows**：`.\scripts\dsh-web.ps1 restart` 或 `scripts\dsh-web.cmd restart`

## License

MIT
