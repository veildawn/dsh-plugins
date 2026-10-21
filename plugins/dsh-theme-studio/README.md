# dsh-theme-studio

DeepSeek Harness (DSH) Web 的**主题工作室**：内置多款可切换主题，并提供背景、字体、
字号、字段颜色的可视化自定义。所有主题共用**一套统一 Token**，仓库内所有插件自动跟随。

本插件只负责**视觉**。移动端布局（Viewport、Drawer、Safe Area、触控区）仍由
`dsh-mobile-adapter` 承担。

## 内置主题

安装后**默认不使用主题**（保持 DSH 官方原生风格与组件外观，零样式侵入）；可在设置中随时按需启用：

| id | 名称 | 风格 |
| :--- | :--- | :--- |
| `none` | **系统默认**（默认） | 保持 DeepSeek Harness 原生界面风格，不使用任何定制主题 |
| `zcode` | **ZCode 官方** | 单色品牌 + 灰阶层级，官方 202 项色板逐值对齐 |
| `zcode-mono` | **ZCode 单色极简** | 收敛所有装饰色为灰阶，只保留 destructive 的红色 |
| `glass` | **苹果玻璃** | Apple Liquid Glass：真实背景模糊、饱和提升、轮廓光描边 |
| `glass-color` | **玻璃彩色** | 彩色玻璃：更强模糊与色相折射，强调色用 Apple 系统色 |

每款具体主题都**同时携带明暗两套色板**，由宿主的明暗偏好决定取哪套——用户不需要为
暗色单独再选一次主题。切换主题只改 `html[data-theme-studio]` 的属性值（系统默认时自动移除该属性，彻底退化为原生），
变量块在首屏一次性注入，因此切换是**零闪烁、零重排、零网络请求**的。

## 统一 Token 契约

主题只需提供**语义层**（`--color-*`），宿主层（`--dsw-*`）与插件兼容层自动派生：

```
lib/tokens.js
├── HOST_TOKEN_MAP        宿主 --dsw-* → 语义键（一份映射服务全部主题）
├── PLUGIN_ALIAS_MAP      插件引用但宿主未定义的别名（--dsw-alias-border-default 等）
├── MATERIAL_DEFAULTS     字体 / 圆角 / 阴影 / 毛玻璃参数
├── buildHostTokens()     把主题色板解析成 { light, dark } 成对值
├── themeVarsCss()        生成变量块（按 body 级 / :root 级分层）
└── lib/themes/*.js       四套色板；变体只声明差异键，由 inheritPalette() 合并
```

### 为什么变量要分两块输出

宿主把 Token 定义在不同层级，CSS 变量沿继承链查找最近的定义：

| 宿主定义位置 | Token | 本插件写在 |
| :--- | :--- | :--- |
| `body` | `--dsw-alias-*` / `--dsw-static-*` / `--dsw-specific-*` / 字体栈 | `html[attr] body`（0,1,2） |
| `:root` | `--dsw-radius-*` / `--dsw-shadow-*` | `html[attr]`（0,1,1） |
| 从未定义 | `--dsw-focus-ring-color` / `--dsw-hovercard-bg` | `html[attr] body` |

只写 `html[attr]` 的话，`body` 上宿主的同名定义更近，主题值会被**静默吃掉**——
这正是旧版 `dsh-zcode-theme` 必须依赖宿主 `ThemeRuntime.overrideTokens()`
写内联 style 的原因。本插件用选择器特异性解决，不依赖任何运行时 API，
服务端直出即刻生效，桌面端与 Web 端行为一致。

### 插件兼容层

仓库内插件大量引用宿主**从未定义**的别名，写法是
`var(--dsw-alias-border-default, var(--dsw-alias-border-l2))`。宿主没有该变量时
插件只能回落到 fallback（有些 fallback 直接是 `#fff`），主题就管不到它。

本插件显式定义这些别名，插件的所有表面才会跟随主题：

```css
--dsw-alias-background-base      --dsw-alias-border-default
--dsw-alias-background-surface   --dsw-alias-border-subtle
--dsw-alias-background-subtle    --dsw-alias-state-warning-primary
--dsw-alias-background-muted     --dsw-alias-status-warning
--dsw-alias-surface-l2           --dsw-alias-bg-warning
--dsw-font-l-20 / -m-18 / -base-16 / -base-strong-16 / -s-14 / -s-strong-14
--dsw-font-family-mono / --dsw-font-mono / --dsw-font-code
--dsw-radius-s / -m / -l / -pill / --dsw-focus-ring-width
```

`test/plugin-compat.test.mjs` **扫描仓库内每个插件真实引用的 `--dsw-*`**，逐个
检查主题是否提供定义。新插件引入新别名时这里会先失败，而不是等到用户看见
「主题没覆盖到某个面板」。

## 自定义能力

设置面板在「设置 → 主题工作室」，全部落盘到 `~/.dsh/theme-studio/settings.json`：

| 能力 | 说明 |
| :--- | :--- |
| **背景** | 主题默认 / 纯色 / 图片；图片支持铺满、留白、平铺与不透明度 |
| **字体** | 正文与代码字体栈，留空则用主题自带 |
| **字号** | 正文（10–22）、代码（10–16）、终端（10–20），留空跟随宿主设置 |
| **字段颜色** | 11 个语义角色（正文、次级、辅助、画布、面板、卡片、输入、边框、品牌、主操作填充与文字） |
| **玻璃材质** | 模糊强度（0–80px）与饱和度（100–300%），仅玻璃主题生效 |

自定义层**总是排在主题变量之后**，所以它代表用户的最终决定。字段色同时写
`body` 与 `body[data-ds-dark-theme]`——只改语义层的话，宿主组件读的是
`--dsw-*`（它自己那份映射），看不到变化。

### 安全校验

设置来自两个入口（前端表单、手改 JSON），两者都可能传来非法值，而设置最终会被
拼进 `<style>`。一旦 `}` 或 `;` 漏进去，整份主题 CSS 会被提前闭合——表现是
「主题突然失效」，排查成本极高。所以颜色 / 字体 / 文件名一律**白名单式校验**：

- 颜色：`#rgb`/`#rrggbb`/`#rrggbbaa`、`rgb()`/`hsl()`、有限的 `color-mix()`、具名色；
- 字体：禁止 `;{}<>\\`、换行与 `url()`；
- 背景文件名：只允许纯文件名，拒绝任何路径分隔符与 `..`；
- 非法**单项**被丢弃，其它设置保留——改错一个颜色不该丢掉刚选的背景图。

## 与 dsh-zcode-theme 的关系

ZCode 全平台视觉主题已迁入本插件（`zcode` / `zcode-mono`）。
`dsh-zcode-theme` 保留为**兼容薄壳**：

- 注入的 `data-dsh-theme="zcode"`、样式标签 id 与旧版完全相同，升级时旧样式被精确替换；
- 薄壳产出的变量与这里的 ZCode 主题**逐值相同**（同一份 token 与 CSS 源），
  因此两者同时安装也不会打架；
- 薄壳客户端**不再调用 `overrideTokens`**——那是与主题工作室冲突的根源
  （两个插件各注册一层，后注册的覆盖前一层）；
- 薄壳检测到 `data-theme-studio` 时**让位**，不抢旧属性。

迁移：

```bash
dsh plugin --profile web remove @weniatall/dsh-zcode-theme
dsh plugin --profile web add @weniatall/dsh-theme-studio
```

## 选择器契约

宿主前端由几十个 `dsh-client-ui-*` 插件组成，每个插件自带 CSS Modules 类名
（形如 `hHd-Xa_root`、`Hqq-bq_previewBadge`）。主题只能依附这些**运行时真实存在**
的类名，否则选择器永远不命中——颜色再准，版式仍是宿主默认。

`test/fixtures` 里与仓库根共享的 `host-classes.json` 是宿主类名快照，
`test/host-selectors.test.mjs` 逐条核对主题里出现的每个 CSS Module 类名。
宿主升级后重新采集：

```bash
node scripts/harvest-host-classes.mjs --all   # 桌面版 + Web 版一起采，推荐
```

**必须采两个来源**：桌面版（Electron，前端在 `app.asar`）与 Web 版是两次独立
构建，哈希完全不同。只采一侧，另一侧的选择器就全是死的，而且测试照样绿。
每条宿主选择器都要**同时写两套哈希**。

## 特异性契约

主题是全局样式，社区插件各自往页面里注入自己的 CSS。**主题的选择器绝不能比
插件的单类规则（`0,1,0`）更高**，否则插件配色会被静默压掉——没有报错、没有日志，
只是「颜色不对」。

三条硬约束，`test/host-selectors.test.mjs` 逐条守护：

- 通用元素规则必须包 `:where()`；
- 禁用态只改 `opacity` 与 `pointer-events`，**不改 `color`**；
- 次级按钮兜底规则必须用 `:not([class~="tm-primary"])` 排除主按钮。

另：插件侧**不要声明 `color-scheme`**。`light-dark()` 只认最近的 `color-scheme`
祖先，一写 `light dark` 就退回跟随操作系统偏好；应用是暗色、系统是亮色时，
面板内的 `light-dark()` 全部解析到亮色侧。继承宿主写在 `html` 上的值即可。

## Z 轴契约

宿主的应用级浮层（文件查看器抽屉、命令面板、设置面板、终端）全部挂在
`[data-shell-overlay]` 里，整层被 `z-index: 20` 锁死：**插件内部写多大的 z-index
都出不了 20**。所以主题给页面 chrome 设置的 `z-index` 必须低于 20。

## 无障碍

- `prefers-reduced-motion`：关停动画与过渡；
- `prefers-reduced-transparency`：玻璃主题退化实心表面（这是无障碍要求，
  半透明 + 模糊在低对比显示器上会显著降低可读性）；
- `prefers-contrast: more`：同样去掉材质。

## 安装

```bash
dsh plugin --profile web add @weniatall/dsh-theme-studio
```

或本地打包：

```bash
cd plugins/dsh-theme-studio && npm pack
dsh plugin --profile web add ./plugins/dsh-theme-studio/dsh-theme-studio-0.1.5.tgz
```

## 重启生效

- **macOS / Linux**：`./scripts/dsh-web.sh restart`
- **Windows**：`.\scripts\dsh-web.ps1 restart` 或 `scripts\dsh-web.cmd restart`

## License

MIT
