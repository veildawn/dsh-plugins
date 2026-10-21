# 主题工作室设计说明（dsh-theme-studio）

> **目标**：把 DSH Web 的视觉从「一个写死的主题」升级为「一套可切换、可自定义的
> 主题系统」，并把仓库既有的 ZCode 全平台视觉主题收编为内置主题之一。

## 一、需求与实现对照

| 需求 | 实现 | 验证 |
| :--- | :--- | :--- |
| 可切换插件内置的多款主题 | 4 款内置主题，`html[data-theme-studio]` 驱动；四套变量块首屏一次性注入，切换只改属性值 | `test/tokens.test.mjs`、`test/host.test.mjs` |
| 把仓库内 ZCode 全平台视觉主题收进插件 | `zcode`（官方 202 项色板逐值对齐）+ `zcode-mono`（灰阶变体）；旧包改为兼容薄壳 | `test/zai-parity.test.mjs`、薄壳的 `test/theme.test.mjs` |
| 设计苹果风「玻璃」主题 | `glass`（Liquid Glass 冷调）+ `glass-color`（彩色玻璃） | `test/zai-parity.test.mjs` 的玻璃断言 |
| 自定义背景色 / 背景图 / 字体 / 字段色 / 字号 | 设置面板 + `~/.dsh/theme-studio/settings.json` | `test/settings.test.mjs` |
| 统一 token 定义，兼容所有插件 | 三层 Token 契约 + 插件兼容别名 + 逐插件扫描测试 | `test/plugin-compat.test.mjs` |

## 二、Token 架构

```
语义层 --color-*          主题唯一需要提供的东西（4 套色板）
    │
    ├── HOST_TOKEN_MAP    宿主 --dsw-* → 语义键（一份映射服务全部主题）
    │       └── 按宿主定义位置分成两块输出：
    │             html[attr]       : :root 级（圆角、阴影、模糊）
    │             html[attr] body  : body 级（alias/static/specific、字体栈）
    │
    ├── PLUGIN_ALIAS_MAP  插件引用但宿主未定义的别名（12 项）
    │
    └── MATERIAL_DEFAULTS 字体 / 圆角 / 阴影 / 毛玻璃（30 项）
```

### 2.1 为什么变量必须分两块

这是本次实现中最关键的一条宿主事实。宿主 `ui-theme` 的 `design-platform.css`：

```css
body { --dsw-alias-bg-base: var(--dsw-static-neutral-bluish-00); ... }
body[data-ds-dark-theme] { --dsw-alias-bg-base: var(--dsw-static-neutral-bluish-950); ... }
:root { --dsw-radius-sm: 8px; --dsw-shadow-lv3: ...; }
```

CSS 变量沿继承链查找**最近**的定义。若主题只写 `html[attr] { --dsw-alias-bg-base }`
（特异性 0,1,1），`body` 上宿主的同名定义（0,0,1）虽然特异性更低，但它在**更近的
元素**上——继承链优先于特异性。结果：主题值被静默吃掉。

这正是旧版 `dsh-zcode-theme` 必须调用宿主 `ThemeRuntime.overrideTokens()` 写内联
style 的原因（内联样式最高优先级）。但那条路有三个代价：

1. 依赖客户端运行时，服务端直出的 CSS 拿不到覆盖 → 首屏闪一下；
2. 每个插件各注册一层，后注册的覆盖前一层 → 插件之间互相打架；
3. 内联 style 写满 `body`，调试时看不出主题到底生效在哪一层。

本插件改用选择器：`html[attr] body`（0,1,2）压过 `body`（0,0,1）与
`body[data-ds-dark-theme]`（0,1,1）。不依赖任何运行时 API，服务端直出即刻生效。

`test/tokens.test.mjs` 的「主题变量块把 body 级 Token 写在 body 选择器上」
逐主题断言这一点：`--dsw-alias-*` 一旦泄漏到 html 块就失败。

### 2.2 插件兼容层

仓库插件普遍引用宿主**从未定义**的别名，且写法带 fallback：

```js
var(--dsw-alias-border-default, var(--dsw-alias-border-l2))
var(--dsw-alias-background-base, #fff)
```

宿主没有该变量时，插件只能回落到 fallback——有些 fallback 直接是 `#fff`，
在暗色主题下就是一块刺眼白斑。本插件显式定义这 12 个别名后，插件的卡片、
输入框、边框立刻跟随主题。

`test/plugin-compat.test.mjs` 的做法是**扫描而非列举**：读遍
`plugins/*/lib/**` 里所有 `var(--dsw-*)`，逐个检查主题是否定义。这条测试会
随仓库演进——新插件引入新别名时先失败，而不是等用户发现某块界面没变色。

## 三、四款主题的设计取舍

### 3.1 ZCode 官方（`zcode`）

直接使用上游 202 项色板，**零改动**。这是仓库既有用户的默认体验，
也是「收编而非重写」的基线：`test/zai-parity.test.mjs` 与上游快照逐值比对。

### 3.2 ZCode 单色极简（`zcode-mono`）

ZCode 官方已把品牌色收成单色，但 diff / 轨迹 / mention / 终端仍有大量彩色语义。
本变体把它们收敛为灰阶，**只保留 `destructive` 的红色**——危险操作必须一眼可辨，
那是安全语义不是装饰（`test/zai-parity.test.mjs` 用 RGB 差值断言这条）。

不覆盖任何材质：圆角、阴影、字号与基座一致，所以两款 ZCode 主题可以互换而不
产生版式抖动。

### 3.3 苹果玻璃（`glass`）

复刻 macOS Sonoma / iOS 17 之后 Apple 的 Liquid Glass 观感，四条可辨识特征：

| 特征 | 实现 |
| :--- | :--- |
| 色相来自壁纸而非固定色 | 根画布两层低饱和径向渐变（`--ts-wallpaper-1/2`，明暗不同） |
| 描边是「光」不是「线」 | `inset 0 1px 0 var(--ts-glass-highlight)`，暗色换整圈轮廓光 |
| 饱和提升 | `backdrop-filter: blur() saturate()`，`--ts-saturate` 默认 180% |
| 前景色偏冷且高对比 | 正文 `#1d1d1f` / `#f5f5f7`（Apple 官方 body 色），非纯黑纯白 |

**层级即景深**：侧栏比主区更透明、模糊更弱（`calc(var(--ts-blur) * 0.7)`），
对话框比面板更实、阴影更远。这不是随意取值，是 macOS 上「侧栏在后、内容在前」
的观感来源。

**不改布局**：`glass.css` 只碰 background / border / box-shadow / backdrop-filter /
border-radius。间距、尺寸、z-index 全部留给基座样式表与 `dsh-mobile-adapter`。
玻璃是一种材质，不是一种布局。

**无障碍退化**：`prefers-reduced-transparency` 与 `prefers-contrast: more` 下
移除全部 `backdrop-filter`。半透明 + 模糊在低对比显示器上会显著降低可读性，
这是无障碍要求而非审美偏好。

### 3.4 玻璃彩色（`glass-color`）

把色相加回**表面**与**强调**，但**文字与边框保持中性**。彩色玻璃最怕的是把文字
也染色——对比度会随背景漂移，暗色下尤其糟。强调色用 Apple 系统色
（SystemIndigo / SystemPink / SystemTeal），与 macOS「多彩外观」一致。

## 四、自定义能力的设计

### 4.1 为什么设置放服务端

背景图需要落地成文件，且桌面端（Electron）与 Web 端要看到同一份配置。
`~/.dsh/theme-studio/settings.json` + `backgrounds/` 子目录。

### 4.2 背景必须写在 body 上

这是实现中实际踩到的坑，值得记录：

自定义背景最初写在 `html[data-theme-studio]` 上。玻璃主题的「壁纸」渐变画在
`body` 上，而 `body` 比 `html` 更靠近所有内容——写在 `html` 上的背景被整层
盖住，用户上传图片成功、设置也存对了，但界面毫无变化。表现是「上传成功但
界面没变」，属于最难自查的一类问题。

修复：背景写到 `html[attr] body`，与壁纸同级；自定义层注入顺序最后，
同特异性下后写者胜，于是用户背景压过主题壁纸。暗色块同样要写，
否则宿主 `body[data-ds-dark-theme]` 上的规则会在暗色下回弹。

`test/settings.test.mjs` 用「背景必须落在 body 块」的断言锁定这条。

### 4.3 自定义层的顺序契约

```
主题变量 → 组件样式 → 玻璃材质 → 用户自定义
```

用户自定义**必须最后**，它代表用户的最终决定。`composeThemeCss()` 把顺序写死，
`test/host.test.mjs` 用「自定义层偏移量必须大于主题变量偏移量」断言这条。

### 4.4 字段色为什么写两套变量

```css
html[data-theme-studio] body                    { --color-foreground: #xxx; --dsw-alias-label-primary: #xxx; }
html[data-theme-studio] body[data-ds-dark-theme] { --color-foreground: #xxx; --dsw-alias-label-primary: #xxx; }
```

只改语义层 `--color-*` 不够：主题 CSS 全部读语义层，所以**主题自己画的组件**
会跟随；但**宿主自绘的组件**（输入框、菜单、对话框标题等）读 `--dsw-*`，
停在旧配色上，表现为「改了一半」。

所以 `customCss()` 为每个字段色角色同时输出语义层与宿主层。宿主层名单由
`hostTokensFor()` 从 `HOST_TOKEN_MAP` **反查**得到，不手抄——新增映射时自动跟随。
`test/settings.test.mjs` 与 `test/client-parity.test.mjs` 两端守护这份名单。

### 4.5 安全校验

设置来自前端表单与手改 JSON 两个入口，最终被拼进 `<style>`。`}` 或 `;` 漏进去
会让整份主题 CSS 提前闭合——表现是「主题突然失效」，排查成本极高。所以：

- 颜色白名单：`#rgb`/`#rrggbb`/`#rrggbbaa`、`rgb()`/`hsl()`、有限 `color-mix()`、具名色；
- 字体禁止 `;{}<>\\`、换行与 `url()`；
- 背景文件名只允许纯文件名，拒绝路径分隔符与 `..`；
- 非法**单项**丢弃、其它保留（改错一个颜色不该丢掉刚选的背景图）。

`test/settings.test.mjs` 用 11 个恶意输入逐条验证，并断言产物大括号配平。

## 五、已知限制

1. **背景图不压缩**。8MB 上限内原样落盘，由 CSS `background-size` 缩放。
   大图在低端设备上可能影响滚动性能。
2. **主题不可在运行时新增**。4 款主题在构建期确定，`html[attr]` 的取值由
   `normalizeThemeId()` 白名单校验。第三方主题需要改代码或提供新插件。
3. **自定义字段色与主题色板不做对比度校验**。用户可以选一个与背景同色的正文色，
   界面会变得不可读。这属于「用户明确要求」的范畴，不静默纠正。

## 六、验收

| 指标 | 结果 |
| :--- | :--- |
| 测试 | **111 / 111 通过**（theme-studio）+ **21 / 21**（zcode-theme 薄壳） |
| 内置主题 | 4 款（ZCode 官方 / ZCode 单色极简 / 苹果玻璃 / 玻璃彩色） |
| 宿主 Token 覆盖 | 145 项，全部明暗成对 |
| 插件引用覆盖 | 仓库内插件引用的 `--dsw-*` **零缺口**（扫描式守护） |
| 首屏产物体积 | 全 4 套主题约 217 KB（未压缩；gzip 后约 30 KB） |
| 真实浏览器验证 | 4 款主题 + 自定义背景图均已用 Chromium 无头渲染核对计算样式与截图 |
| 废弃色残留 | 无（`#4d6bfe` / `#E85D3A` 系列） |

未执行 `dsh plugin add` 部署与重启服务——按 `AGENTS.md` 最高优先级规定，
仅在用户明确要求安装到本机时才允许。
