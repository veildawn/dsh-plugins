# dsh-zcode-theme 全量对齐 ZCode 官方 Zai 主题

> **目标**：把 `plugins/dsh-zcode-theme` 的视觉样式**全部**对齐 ZCode 官方仓库
> [zai-org/ZCode](https://github.com/zai-org/ZCode) 实际发布的样式，而不是此前自拟的近似方案。
>
> **基准来源**（仓库 `main` 分支）：
>
> - `packages/ui/src/styles.css` —— 唯一的主题真源，含 `@theme` 基础层、`.dark`、
>   `.theme-zai-light`、`.theme-zai-dark` 四层。
> - `packages/ui/src/useTheme.ts` —— 默认主题 `zai-dark`，`light`/`dark` 会被
>   normalize 到 `zai-light`/`zai-dark`。
> - `docs/ui/zai-themes.md` —— 明确「Zai 主题接管用户可见的 Light/Dark，原生
>   light/dark 仅作底层 fallback」。
> - `docs/ui/terminal-theme-tokens.md`、`packages/ui/src/terminal/terminalTheme.ts`
>   —— 22 个 xterm Token 及其解析方式。
> - `docs/ui/mention-node-tokens.md` —— file / skill / command / subagent / session /
>   plugin 六类 mention 节点 Token。
> - `docs/ui/ui-font-tokens.md` —— `--ui-font-size` 派生的字阶。
> - `docs/ui/diff-viewer.md`、`packages/ui/src/components/ai-elements/code-block.tsx`
>   —— 代码块与 diff 的容器语义。

## 一、与当前实现的差异（对齐清单）

| # | 维度 | 当前实现 | ZCode 官方 | 处置 |
| :- | :--- | :--- | :--- | :--- |
| 1 | 品牌色 | 暖橙红 `#E85D3A`（自拟） | `.theme-zai-*` 的 `--color-brand`：亮 `#000000`、暗 `#ffffff`（单色） | **改** |
| 2 | 画布 | `#1A1A1A` / `#F7F7F5` | `#161616` / `#f8f8f8` | **改** |
| 3 | 面板/卡片 | `#222222` / `#262626` / `#2A2A2A` | panel `#202020`、card `#2b2b2b`、input/menu `#2b2b2b`、tab `#202020` | **改** |
| 4 | 文字 | `#F2F2F2` / `#A3A3A3` / `#737373` | `#d4d4d4` / subtle 60% / subtlest 30% | **改** |
| 5 | 边框 | `rgba(255,255,255,0.08|0.12)` | `rgba(255,255,255,0.10)` / hover `0.15` | **改** |
| 6 | 语义状态色 | 自拟 `#5A9A6A` / `#C45C5C` | `success #46bf72`、`destructive #ff5c5c`、`warning #ff8a30`（暗）/ `#1e8a3e`、`#e03131`、`#e07b00`（亮） | **改** |
| 7 | 终端 ANSI | 无 | 22 个 `--color-terminal-*` Token | **新增** |
| 8 | 轨迹色 | 无 | `--color-trajectory-{user,assistant,reasoning,tool-call,tool-result}` | **新增** |
| 9 | Mention 节点 | 无 | `--color-{file,skill,command,subagent,session,plugin}-node*` 共 18 个 | **新增** |
| 10 | Diff | 复用 success/error | `--color-diff-*`、`--color-git-*`、`--color-code-diff-*`、`--color-file-diff-*` | **新增** |
| 11 | 用量图 / 上下文分解 | 无 | `--color-usage-chart-*`、`--color-context-breakdown-*`、`--color-usage-heatmap-*` | **新增** |
| 12 | 字号 | 固定 14 / 13 / 12.5 px | `--ui-font-size`（14px）派生 `text-ui-lg/base/sm/xs` | **改** |
| 13 | 字体栈 | Inter 优先 | 系统栈 + CJK 回退，mono 前置 CJK 无衬线 | **改** |
| 14 | 圆角 | 8/10/12/14/16/20 | 与官方一致（`--dsw-radius-*` 已对齐） | 保留 |
| 15 | 代码块 | `--dsw-alias-markdown-code-block` | 容器 `bg-background`、内层 `bg-card` | **改** |

## 二、Token 架构

```
lib/tokens.js
├── ZAI_PALETTE           官方 193 个语义色，{ light, dark } 成对
│   ├── 基础层（@theme + .dark fallback 解析后的有效值）
│   └── .theme-zai-light / .theme-zai-dark 覆盖值
├── HOST_TOKEN_MAP        宿主 --dsw-* → ZAI_PALETTE 语义映射（约 110 项）
├── ZAI_CUSTOM_PROPERTIES 供主题 CSS 直接引用的 --zai-* 变量
├── zaiTokensCss()        生成 --zai-* 声明（light-dark 成对）
├── tokensCss()           生成 --dsw-* 覆盖声明（light-dark 成对）
└── zcodeTokens / zcodeLightTokens  兼容导出（新色值）
```

**为什么不直接照抄 `--color-*` 名字**：宿主（DSH）已有自己的一套 `--dsw-*` 语义层，
且大量宿主与社区插件按 `--dsw-*` 取色。直接覆盖 `--color-*` 不会被宿主组件读到。
因此：官方色板以 `--zai-color-*` 原样落地（保证与官方逐值一致、可审计），再由
`HOST_TOKEN_MAP` 把宿主语义映射过去。

## 三、实施步骤

1. **`lib/tokens.js`**：用脚本从官方 `styles.css` 解析并解析（resolve）出 193 个
   有效色值，生成本模块；手写 `HOST_TOKEN_MAP` 映射与 `FORBIDDEN_*` 黑名单
   （新增禁止 `#E85D3A` 系列，防止旧品牌色回流）。
2. **`lib/css.js`**：`loadThemeCss()` 改为先输出 `zaiTokensCss()` 再输出 `tokensCss()`。
3. **`lib/client.js`**：`HOST_TOKEN_MAP` 与新 `tokens.js` 逐项一致（测试守护）。
4. **`lib/styles/*.css`**：
   - `reset.css`：`color-scheme`、`--shiki-*` 改用官方语义色。
   - `typography.css`：字体栈与字阶对齐官方。
   - `surfaces.css`：画布 / 面板 / 卡片 / 浮层四层对齐官方层级。
   - `navigation.css` / `sidebar.css`：选中态由「品牌橙条」改为官方「surface 抬升」。
   - `chat.css`：气泡 = card；轨迹色接入 reasoning / tool-call / tool-result。
   - `composer.css`：输入卡 = input，发送按钮 = primary（单色）。
   - `buttons.css` / `chips.css` / `states.css`：主色改单色，focus 环改官方。
   - `code.css`：新增 diff（`--color-diff-*`、`--color-git-*`）与代码块容器层级。
   - `terminal.css`：新增 ANSI 16 色、选区、光标 Token 覆盖。
   - `modal.css`：浮层 / 菜单 / toast / tooltip 对齐官方。
   - `motion.css`：保留。
5. **测试**：
   - `tokens.test.mjs`：断言色值与官方逐项一致（含 6 个关键色板锚点）。
   - `forbidden-colors.test.mjs`：新增橙色品牌色黑名单。
   - `theme.test.mjs`：新增终端 / 轨迹 / mention / diff Token 覆盖断言。
   - 新增 `zai-parity.test.mjs`：把 `ZAI_PALETTE` 与仓库内快照
     `test/fixtures/zai-palette.json` 逐值比对，防止后续漂移。
6. **文档**：README、根 README 矩阵、`docs/plans/dsh-zcode-theme-plan.md` 同步更正
   品牌色描述。

## 四、验收标准

- `npm test` 全绿。
- `ZAI_PALETTE` 与官方 `styles.css` 解析结果**逐值相等**（快照测试）。
- 主题产物中不存在 `#E85D3A` / `#F06A48` / `#D14F2E` / `#4d6bfe`。
- 宿主 `--dsw-*` 映射全部有 light/dark 成对值。
- 官方 22 个 terminal Token、5 个 trajectory Token、18 个 mention Token、
  diff/git/usage 系列 Token 全部落地到 CSS。

## 五、实施结果（已完成）

| 指标 | 结果 |
| :--- | :--- |
| 测试 | **33 / 33 通过** |
| 官方色板 `ZAI_PALETTE` | **202 项**（193 官方 + 9 由官方 diff 色派生） |
| 宿主映射 `HOST_TOKEN_MAP` | **133 项**，全部落地，未落地 0 |
| 宿主实际消费的语义 Token 覆盖率 | **100%**（含补映射的 `--dsw-alias-bg-l1/bg-l2/fill-l1/fill-l2/fill-tertiary/fill-tsp-secondary`） |
| `--color-*` 引用完整性 | 被引用 71 项，未定义 0 |
| 废弃色残留 | 无 |
| 主题 CSS 体积 | 66 KB → **53.6 KB** |

### 实施中修正的两处偏差

1. **上下文用量表**（计划第 11 项）最初只把 `--color-context-breakdown-*` 写进色板，
   却没有接到任何选择器上——宿主 `ContextMeter` 实际通过 `--meter-tint` 着色，
   且取值来自 `--dsw-static-*` 基础板。已在 `composer.css` 补 `.JObwrW_color{System,Tools,Messages}`
   三条规则，并加测试锁定。
2. **六个宿主别名词**（`--dsw-alias-bg-l1/bg-l2/fill-l1/fill-l2/fill-tertiary/fill-tsp-secondary`）
   有组件直接 `var()` 引用，但官方 design-platform CSS 并未定义，此前不在映射内，
   会回落到宿主默认蓝板。已补齐并加测试锁定。

### ponytail 审核结论

删除了 134 个 CSS 从不引用、宿主也从不消费的死变量；删除 `zcodeTokens` /
`zcodeLightTokens` / `radius` / `touch` / `motion` 等无外部消费者的向后兼容导出；
删除与 `modal.css` 重复的 `[role="menu"]` 规则；删除宿主中不存在的 `Sh0Q9G_trigger`
（34 处）与编造的属性选择器（`data-trajectory-kind`、`data-workflow-*`、
`data-git-status`、`data-diff-gutter|marker`），改为宿主真实存在的
`[data-chat-flow-kind]`。

### 未执行项

未执行 `dsh plugin add` 部署与重启服务——按 `AGENTS.md` 最高优先级规定，仅在用户
明确要求安装到本机时才允许。

