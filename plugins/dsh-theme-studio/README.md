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
| `aurora` | **极光流光** | 动态极光：三层漂移光斑、聚焦时环绕的流光边框、运行态呼吸波纹 |

每款具体主题都**同时携带明暗两套色板**，由宿主的明暗偏好决定取哪套——用户不需要为
暗色单独再选一次主题。切换主题只改 `html[data-theme-studio]` 的属性值（系统默认时自动移除该属性，彻底退化为原生），
变量块在首屏一次性注入，因此切换是**零闪烁、零重排、零网络请求**的。

### 极光流光（`aurora`）：本仓库唯一带动效的主题

它沿用玻璃的半透明表面结构，但光不是从壁纸透上来的，而是**主题自己画、自己动**：

| 动效 | 实现 | 触发条件 |
| :--- | :--- | :--- |
| 漂移光斑 | `body::before` 三层径向渐变（四段色标自衰减，**不用 `filter: blur()`**），38s 往返平移 | 常驻（唯一常驻的动效） |
| 流光边框 | `::after` + `conic-gradient` + `mask-composite: exclude` 裁出 1.5px 环 | 输入卡 `:focus-within` 时亮起并旋转 |
| 呼吸波纹 | `box-shadow` 从 0 扩散到 `--ts-pulse-spread` | Agent 运行 / 停止生成时 |
| 图标呼吸 | `transform: scale` 2.2s 循环 | 与波纹同步 |

四条硬约束（`test/aurora.test.mjs` 逐条守护）：

1. **动画只碰合成器属性。** `filter: blur()` 是**静态值**，绝不进 `@keyframes`——
   把模糊放进动画等于每一帧重做一次全屏高斯模糊，中端手机直接掉到 20fps。光斑层
   干脆不用 `blur()`，柔和感交给径向渐变的多段色标（`blur(56px)` + `plus-lighter`
   的组合实测 90ms/帧，是这条约束的由来）。
2. **装饰层一律 `pointer-events: none`。** 光斑与边框环都铺满容器，漏写就会吞掉
   所有点击：输入框点不进去、按钮点不动。
3. **动效不常驻（除光斑）。** 扫光只在聚焦时跑；常驻旋转会让整页持续合成，
   笔记本电池与手机发热都受影响。
4. **状态动效必须限定状态本身。** 停止生成按钮的脉冲只该落在**运行中**的那颗按钮上。
   曾经的规则按 `.uV2eYG_primary` / `.Qt4Hga_primary` 选中所有 primary 按钮，日常的
   发送按钮于是也常驻跑动画，闲置时整页持续重绘。现在规则额外要求
   `[aria-label*="停止"]` / `[aria-label*="stop"]` / `:has(svg rect)` 之一，
   把范围收回到真正处于运行态的那颗。

### 玻璃模糊半径为什么是 8px

`--ts-blur` 喂给 `backdrop-filter: blur()`，作用在所有玻璃表面上（侧栏、菜单、浮层）。
它是**静态值**，本身不违反第 1 条约束；但极光光斑在底层常驻平移，Chromium 无法复用
图层位图缓存，模糊半径越大，每帧要重算的像素越多。从 26px 降到 8px 后，GPU 计算量
减少 80% 以上，观感上光斑色相反而更清澈——26px 会把相邻色块糊成一片灰。

亮色晨雾态本来就用 8px，两档现在对齐。该值仍是用户可调项（设置页「玻璃材质」页签，
范围 0–80px），改的只是默认档。

无障碍：`prefers-reduced-motion` 下**真的关掉**动画（`animation: none`，而不是把时长
压到 0.01ms——后者仍占一个合成层）；`prefers-reduced-transparency` 与
`prefers-contrast: more` 下直接隐藏光斑层并退回实色表面。用户自己设了背景图时
光斑层同样让位——两套背景叠在一起只会互相糊掉。

### 极光可见度：为什么主内容区的底色只有 38%

光斑画在 `body` 上，而 `.centerCol` 的半透明底是压在它上面的**第一道遮挡**。
这一层用 72%（即 `--color-background` 原值）时，实测主区彩度 p90 只有 45，
设计稿是 67——界面看着像「一层灰玻璃」而不是极光。

`--ts-canvas-alpha` 把这一层独立降到 38%，实测数据：

| `--ts-canvas-alpha` | 主区彩度 p90 | 正文对比度 |
| :--- | :--- | :--- |
| 72%（直接取 `--color-background`） | 45 | 15.7:1 |
| **38%（当前）** | **86** | **13.1:1** |

彩度翻倍的同时，正文对比度仍有 13.1:1（WCAG AAA 要求 7:1）——观感的收益远大于
对比度的代价。`test/aurora.test.mjs` 把这一档锁死在 25%~45%，防止将来被改回实色。

其余几处同样经过像素级校准（对设计稿做区域统计后逐档对比）：

- **光斑 alpha**：暗色 0.44~0.58。低于此区间主区彩度掉到 40 以下，高于 0.65
  会开始盖住正文。
- **模糊半径 56px**：初版 72px 把能量摊到整片画布，各区域彩度只剩 12~38。
- **衰减用多段色标**：单段 `transparent` 终点斜率太陡，`blur(56px)` 抹不掉那条
  圆形的等高线，观感是一个可见的「光团」；分四级淡出后得到「一片渐变」。
- **底部用 `linear-gradient`**：设计稿的底部是一条横贯左右的光带，`radial-gradient`
  的圆心无论放哪都只能照亮一小块。


## 统一 Token 契约

主题只需提供**语义层**（`--color-*`），宿主层（`--dsw-*`）与插件兼容层自动派生：

```
lib/tokens.js
├── HOST_TOKEN_MAP        宿主 --dsw-* → 语义键（一份映射服务全部主题）
├── PLUGIN_ALIAS_MAP      插件引用但宿主未定义的别名（--dsw-alias-border-default 等）
├── MATERIAL_DEFAULTS     字体 / 圆角 / 阴影 / 毛玻璃参数
├── buildHostTokens()     把主题色板解析成 { light, dark } 成对值
├── themeVarsCss()        生成变量块（按 body 级 / :root 级分层）
└── lib/themes/*.js       五套色板；变体只声明差异键，由 inheritPalette() 合并

lib/host-modules.js       探测当前宿主的 CSS Modules 映射（跨构建自适应）
lib/host-class-slots.js   旧类名 → 模块槽位（自动生成，勿手改）
```

### 主题专属样式层

组件级样式（`STYLE_FILES`）是所有主题共用的；材质与动效的**规则**按主题拆分，
各自带 `html[data-theme-studio="<id>"]` 限定，非该主题下不命中任何元素：

| 文件 | 作用域 | 职责 |
| :--- | :--- | :--- |
| `glass.css` | `glass` / `glass-color` | 毛玻璃材质、壁纸、菜单与浮层的玻璃规则 |
| `aurora.css` | `aurora` | 光斑漂移、流光边框、呼吸波纹、`@property` 角度注册 |

两份都**始终**包含在产物里（切换主题无需重新注入），且 `aurora.css` 必须排在
`glass.css` **之后**——它沿用玻璃的表面结构并改写其中几条取值，反过来会被压回去。

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

## 运行状态条效果

运行状态条（「深度求索中…」那一行）的动效**不属于任何主题**，而是一个独立开关。
默认「原生」——不添加任何特效，状态条保持 DSH 原生观感；想动起来时在设置面板
用卡片选一档即可。

| 档位 | 动效 |
| :--- | :--- |
| **原生（默认）** | 无任何特效，`html` 上不写 `data-ts-status` 属性 |
| 流光文字 | 状态文字有一道高光缓缓扫过 |
| 呼吸光环 | 胶囊向外扩散柔和的呼吸波纹 + 图标浮动 |
| 鲸尾摇曳 | 鲸尾图标上下游动 |
| 极光流动 | 以上全部 + 分隔线流光 |
| 霓虹脉冲 | 双色发光文字 + 边框外发光呼吸 |
| 终端扫描 | 等宽字体 + 横向扫描线，复古终端感 |
| 糖果气泡 | 胶囊轻轻弹跳，文字带糖果色柔光 |
| 故障闪烁 | RGB 色散与随机抖动 |
| 环形进度 | 状态图标外旋转的极光光环 |
| 条形律动 | 胶囊下方三段音量条错峰跳动 |

设计参考 [dsh-status-rotator](https://github.com/01Virex/dsh-status-rotator) 的外观主题，
但**只取视觉与动画**：不做文案替换、打字机、弹幕与词库——本插件接管的是观感，
文案归宿主。

**主题层不再实现状态条动效**（`test/aurora.test.mjs` 有守卫）：状态条只有
`data-ts-status` 一个开关，否则用户关掉特效后仍会被主题强制加动画。

## 组件层适配

除主题自身的骨架外，另有三份组件层样式表，让宿主与社区插件的原生界面也跟随主题：

| 文件 | 作用域 | 覆盖范围 |
| :--- | :--- | :--- |
| `settings.css` | 所有主题 | 宿主全部设置页（导航、卡片、按钮、开关、步进器、下拉）、命令审批浮层、`/` 命令面板、`@` 引用菜单、模型与权限选择器 |
| `plugins.css` | 所有主题 | 仓库内全部社区插件的自绘 UI（卡片、面板、菜单、状态徽标） |
| `status.css` | `data-ts-status` | 状态条 11 档动效 |

宿主的交互控件有 **144 个**分散在 40 多个模块里，逐个列类名不可维护（宿主每次
构建都换哈希）。`settings.css` 因此采用**属性模式兜底**：`[class*="_iconButton"]`
这类写法跨构建、跨版本命中同一部件，全部包在 `:where()` 里把特异性归零，
保证任何具体主题规则都能压过它。

## 自定义能力

设置面板在「设置 → 主题工作室」，全部落盘到 `~/.dsh/theme-studio/settings.json`：

| 能力 | 说明 |
| :--- | :--- |
| **背景** | 主题默认 / 纯色 / 图片；图片支持铺满、留白、平铺与不透明度 |
| **字体** | 正文与代码字体栈，留空则用主题自带 |
| **字号** | 正文（10–22）、代码（10–16）、终端（10–20），留空跟随宿主设置 |
| **字段颜色** | 11 个语义角色（正文、次级、辅助、画布、面板、卡片、输入、边框、品牌、主操作填充与文字） |
| **玻璃材质** | 模糊强度（0–80px）与饱和度（100–300%），玻璃与极光主题生效 |

自定义层**总是排在主题变量之后**，所以它代表用户的最终决定。字段色同时写
`body` 与 `body[data-ds-dark-theme]`——只改语义层的话，宿主组件读的是
`--dsw-*`（它自己那份映射），看不到变化。

### 背景图为什么需要「让位」

背景画在 `body` 上，但主题骨架里有一串**不透明填充**压在 body 之上，会把背景
整层盖住：

| 层 | 原填充 |
| :--- | :--- |
| `#root` | `--color-background-win-alt`（实色） |
| `.frame` / `.sidebarCol` / `.rightbarCol` / `.bottomRow` | `--color-background-win-alt`（实色） |
| `.centerCol` | `--color-background`（ZCode 实色 / 玻璃半透明） |

所以只要用户设了背景，`html` 上就会挂 `data-ts-bg="color|image"`，`lib/styles/background.css`
随即让前三类层彻底透明、把 `.centerCol` 降到 72% 底色并保留毛玻璃——既有背景透出的
观感，又不牺牲正文可读性。

这个开关是**属性驱动**而不是靠 CSS 反推：CSS 没有父选择器能表达「body 有没有背景」，
`:has()` 在这里也不可行（`body:has(> #root)` 恒真）。服务端 `themeScopeScript()` 与
客户端 `applyToDocument()` 共同维护它，判定条件统一走 `activeBackgroundMode()`，
两端不一致时 `test/client-parity.test.mjs` 会失败。

背景图的 HTTP 路由走 `connection.fetch.register()`：

```
GET /api/dsh-theme-studio/background?file=bg-<stamp>.<ext>
```

> ⚠️ 不要改用 `ctx.webServer.get(path, handler)`。宿主的 `WebServer` **没有** `get`
> 方法（只有 `register` / `tapIndex` / `registerFallback` / `registerUpgrade`），
> 早期实现照着 Express 习惯写，导致 `typeof ctx.webServer.get === 'function'` 恒为
> false、整段路由被静默跳过，图片永远 404——现象就是「背景图上传成功，界面一点没变」。
> `test/background.test.mjs` 用**真实宿主 API 形状**（没有 `get`）构造 ctx 来锁死这一点。

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
node scripts/harvest-host-classes.mjs --all      # 桌面版 + Web 版一起采，推荐
node scripts/build-host-class-slots.mjs          # 重建「旧类名 → 模块槽位」对照表
```

**两步都要做**：采集更新快照，重建把快照转成运行时用的对照表。少第二步，
主题就查不到新构建的类名（`test/host-modules.test.mjs` 会先失败）。

### 跨构建自适应（桌面版不兼容的根治）

宿主每次构建都会重新生成 CSS Modules 的哈希前缀。同一个组件在三套构建里是三个
不同类名（实测 2026-10，宿主 0.2.1-rc.2）：

| 来源 | `AppFrame.centerCol` | `MessageItem.bubble` |
| :--- | :--- | :--- |
| Web（`dsh web`） | `pI_x6G_centerCol` | `Sixlwa_bubble` |
| macOS 桌面版 | `_LS25G_centerCol` | `P9wcjW_bubble` |
| **Windows 桌面版** | **`BynINW_centerCol`** | **`cJsG2q_bubble`** |

只把前两套写进 CSS，第三套就**一条规则都命中不了**——没有报错、没有日志，
只是「主题在桌面版上看起来没生效」。这是本插件 0.1.x 的真实故障。

修复不靠「再多写一套哈希」（下次构建又会失效），而是靠一条**跨构建稳定的身份**：

```
bundle + 模块文件名 + 部件名      例：layout/AppFrame.module.css|centerCol
```

`test/host-modules.test.mjs` 用快照锁定「137 个模块的部件名在两套构建之间逐个
完全一致」，这条前提成立，定位才可靠。运行时按它做三件事：

1. `lib/host-modules.js` 启动时枚举**当前正在运行的宿主**的 CSS Modules 映射
   （桌面版读 `app.asar`，Web 版读 `node_modules/@deepseek-ai`）；
2. `lib/host-class-slots.js`（生成产物）把主题里写死的旧类名翻译成槽位键；
3. `adaptCssToHost()` 把 `.旧类名` 改写成 `:is(.旧类名, .当前类名)`。

**已有类名一个都不删** —— Web 版与 macOS 桌面版的写法原样保留，当前构建追加为
并列候选。`:is()` 的特异性取参数最高项，与单类相同（`0,1,0`），不会压过社区插件的
单类规则。实测覆盖：主题引用的 128 个宿主类名**全部命中**，未命中 0 个。

同时覆盖 `[class*="hash_part"]` 这类**属性选择器里的哈希**（权限触发器、
上下文占用表着色段用的就是它）。`[class*="_primary_"]`、`[class~="primary"]`
不含构建哈希，属于跨构建稳定写法，不会被改写。

**读不到宿主就退化**：CI、单元测试、未知安装布局下面板探测为空，`adaptCssToHost()`
原样返回 CSS，行为与引入这层之前完全一致，不会抛错也不会告警。

## 桌面版首屏契约

桌面版（Electron）与 Web 端的首屏路径**完全不同**，这是本插件第二个兼容性坑：

| | Web 端 | 桌面版 |
| :--- | :--- | :--- |
| index.html 来源 | `frontend-static` → `webServer.renderIndex()` | Electron 主进程 `serveWebDocument()` 直读静态 dist |
| 结构化注入行 | `renderIndexInjections()` 渲染进文档 | IPC `dsh-desktop:boot` 交回渲染进程，前端 `PZ()` 逐行执行 |
| `tapIndex` | ✅ 执行 | ❌ **一次都不执行** |

桌面版对静态 index 只做一件事——插入 `__DSH_BOOT_READY__` 的 Promise；其余全部
依赖 `dshDesktopBoot.ready()` 返回的 `injections`。所以主题**必须**提供
`webserver/index-inject` 行，且两行各司其职：

- `script` 行 → 把 `data-theme-studio` 写到 `documentElement`
  （没有它，`html[data-theme-studio] …` 全部不命中）；
- `html` 行 → 样式表本体（前端用 `head.insertAdjacentHTML('beforeend', …)` 追加）。

注入行**必须携带 `settings`**，否则桌面版首屏只有主题色、没有用户自定义的
背景/字体/字段色，要等客户端 RPC 回来才补上——表现为「启动后闪一下才出现自定义
样式」。`test/host.test.mjs` 用「桌面注入行与 Web 端 `patchIndex` 产出字节一致」
锁死这条。

### Windows 标题栏

桌面版 preload（`app.asar/lib/preload-app.cjs`）在 Windows 上会写
`html[data-windows-titlebar]` 并把 `--dsh-windows-titlebar-height` 设成 40px，
宿主 UI 随即切换成 Windows 11 骨架：**顶部 40px 拖拽条 + 内容卡只切左上 16px 圆角**。

主题原本只有 macOS 那套「四周内缩 4px + 6px 全圆角」。两者叠加会出现「圆角套圆角」
和右上角露底。`lib/styles/frame.css` 的 `[data-windows-titlebar]` 段落显式让位：
几何交还宿主，圆角跟随 `--dsh-windows-content-radius`，不写死像素值（宿主按 DPI 换算）。

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
dsh plugin --profile web add ./dsh-theme-studio-0.2.8.tgz
```

桌面版请用 `--profile desktop` 安装同一份包。

## 重启生效

- **macOS / Linux**：`./scripts/dsh-web.sh restart`
- **Windows**：`.\scripts\dsh-web.ps1 restart` 或 `scripts\dsh-web.cmd restart`
- **桌面版**：退出并重新打开 DeepSeek Harness —— Electron 主进程重启后才会重新读取注入行。

## License

MIT
