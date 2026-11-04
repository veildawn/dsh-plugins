# dsh-spec — Kiro 兼容的 SPEC 规约模型（Agent 预设法）

把 Kiro 的 Spec 工作流原样搬进 DeepSeek Harness：`.kiro/specs/<feature>/` 下的
`requirements.md`、`design.md`、`tasks.md` 就是规格本身，任务复选框就是执行状态。
插件不发明新格式，读得懂 Kiro 已经生成的 spec，也写得回同一套文件。

> 实现依据：对 Kiro 1.4.13 的 `kiroAgent` 扩展（`dist/extension.js`）做静态逆向，
> 提取了官方文档模板、`validate_spec_format` 的全部规则码、任务状态映射、
> `tasks.meta.json` 结构与 `## Task Dependency Graph` 波次调度规则。

## 0. 两半结构：宿主行 + Spec 模式预设

插件由两个补丁层组成，装一次包即可同时到位：

| 层 | 文件 | 挂载内容 | 谁会看到 |
| --- | --- | --- | --- |
| 宿主行 | `cordis.patch.yml` | `/dsh-spec` RPC 通道（只 `inject: [connection]`） | 所有 Web 会话 |
| Spec 模式预设 | `presets/spec.patch.yml` | 8 个 `spec_*` 工具 + Kiro 规约提示词 + 会话任务投影（`specPlan`） | **只有选中该预设的会话** |

**关键点：宿主行不注册任何工具、不注册任何提示词段落。** 因此：

- 用 `standard` / `ptc` / `minimal` / `cordis` 预设的会话，工具清单与系统提示词里
  不会出现任何 spec 相关内容；
- 想让 Agent 参与规格编写，把当前会话或新会话切换成 **Spec 模式**（Agent 预设列表里
  `order` 排在标准模式之后的那一项）；
- **输入区 Spec 入口只在 Spec 模式会话显示**。标准、PTC、极简、创造模式会话不显示 Spec 类型选择器。
- 规格面板本身是对话区的一个视图页签（`conversation.view`），排在「对话 / 轨迹」右侧；
  只有当前会话处于 Spec 模式时才注册，所以标准模式不会多出一个空标签（见 §5）。

预设是与 `standard` 同构的完整编码 Agent（文件读写、搜索、shell、后台任务、待办、
子代理、网页等一应俱全），只比标准模式多一个 `spec-tools` 行，所以切过去不会丢能力。

---

## 1. 目录与文件

```
<workspace>/.kiro/specs/<feature>/
├── .config.kiro        {"specId": "<uuid>", "workflowType": "requirements-first", "specType": "feature"}
├── requirements.md     功能规格（bugfix 类型则为 bugfix.md）
├── design.md           技术设计，含 Correctness Properties
├── tasks.md            实施计划（复选框 + 依赖图）
└── tasks.meta.json     执行历史与 PBT 结果（插件/ Kiro 共同维护）
```

- 目录名即 feature name：小写 kebab-case，最长 64。
- Markdown 是唯一事实来源；插件只读派生，写入范围极窄（创建骨架、任务复选框、meta、整文档提交）。
- 已有 Kiro spec 直接可用，不会改写。

## 2. 文档格式（与 Kiro 校验器逐条对齐）

### requirements.md

```markdown
# Requirements Document

## Introduction
## Glossary
## Requirements

### Requirement 1: 标题

**User Story:** As a …, I want …, so that …

#### Acceptance Criteria

1. WHEN …, THE System SHALL …
2. WHILE …, THE System SHALL …
3. IF …, THEN THE System SHALL …
4. WHERE …, THE System SHALL …
```

- 验收条目的稳定 ID 是 `需求号.条目号`（如 `1.2`），与 tasks 的 `_Requirements: 1.2_`、design 的 `**Validates: Requirements 1.2**` 对齐。
- 校验器规则（节选）：`requirements/missing-title`、`missing-introduction`、`missing-glossary`（warning）、`missing-requirements-section`、`malformed-requirement-heading`、`missing-user-story`（warning）、`missing-acceptance-criteria`。
- 插件额外做 EARS 语义检查：`ears/missing-pattern`、`ears/missing-shall`、`ears/vague-verb`、`ears/compound-criterion`。

### design.md

必需章节：`## Overview`、`## Architecture`、`## Components and Interfaces`、`## Data Models`，推荐 `## Correctness Properties`、`## Error Handling`、`## Testing Strategy`。
每个属性写成 `### Property N: 标题` + 通用量化陈述 + `**Validates: Requirements X.Y**`。
bugfix 设计换用 `## Bug Details`、`## Expected Behavior`、`## Hypothesized Root Cause`、`## Fix Implementation` 等章节。

### tasks.md

````markdown
# Implementation Plan: <feature>

## Overview

## Tasks

- [ ] 1. 顶层任务
  - _Requirements: 1.1_

- [ ] 2. 父任务
  - [ ] 2.1 子任务
    - _Requirements: 1.2_

  - [ ]* 2.2 属性测试（`*` 表示可选）
    - **Property 1: Round Trip**
    - **Validates: Requirements 1.2**

- [ ] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.2"] }
  ]
}
```
````

- 最多两级；顶层 `N.`，子任务 `N.M`；每个任务必须勾选框。
- 状态即复选框：`[ ]` 未开始、`[~]` 排队、`[-]` 进行中、`[x]` 完成（大写 `[X]` 会被判为 malformed，与 Kiro 一致）。
  父任务的复选框可以是 `[ ]`，但只要**必需子任务全部完成**，它读出来就是「已完成」
  （标记为 `derived`，文件里的 `[ ]` 不会被改写）——见 §4「诚实的状态」。
- 依赖图规则：每个叶子任务恰好出现一次；同一文件的任务分波；wave id 从 0 连续；可选测试子任务也必须入图；checkpoint 与父任务不入图。bugfix 任务线性执行，不含依赖图。

## 3. 工具（Spec 模式预设内）

这八个工具由 `@weniatall/dsh-spec/tools` 在**预设作用域**内注册，只有选中「Spec 模式」的会话可见。

| 工具 | 作用 |
| --- | --- |
| `spec_create` | 按 Kiro 模板创建 spec 目录与 `.config.kiro`，默认只生成 requirements.md |
| `spec_list` | 列出所有 spec：类型、工作流、阶段、需求/任务进度、ready 任务、格式健康 |
| `spec_read` | 读派生模型（需求+验收、属性、任务树、DAG、ready、问题），或读某份文档原文 |
| `spec_write` | 整份提交 requirements/bugfix/design/tasks，并立即用 Kiro 规则校验 |
| `spec_check` | 全量校验：Kiro 格式规则 + EARS 语义 + 跨文档引用 + 缺 PBT 任务；尚未编写的后续阶段文档只报提示，不算错误 |
| `spec_task_update` | 改任务复选框：自动完成父任务、拒绝未完成必需子任务的父任务、`queued` 批量排队、写 `tasks.meta.json` |
| `spec_next` | 按依赖波次返回下一步可执行任务；文档缺失时告诉你当前应写哪个阶段 |
| `spec_pbt` | 记录属性测试结果（passed/failed + 最小反例）到 `tasks.meta.json` |

## 4. 工作流

```
spec_create → 写 requirements.md → 人工评审 → spec_write(design) → spec_write(tasks)
→ spec_next → spec_task_update(1.1, in_progress) → 实现 → completed → …→ 全部完成
```

- **阶段不可跳过**：`requirements-first` 依次为 requirements → design → tasks；`design-first` 先设计；`fast-task` 静默流水线；`verify-first` 另有验证阶段。
- **诚实的状态**：父任务只有在所有必需子任务完成后才算完成；可选任务（`*`）不阻塞父任务与后续波次。
  这条在**读**和**写**两侧都成立：写回时 `spec_task_update` 会自动勾上父任务，读取时
  （面板、`spec_list`、`spec_read`）也会按子树派生——所以 Agent 直接用编辑工具改
  `tasks.md`、只勾了子任务而没动父任务那一行时，父任务不会显示成「未开始」。
  派生状态只影响报告，不改写文件；界面把这类父任务的复选框与下拉置灰，并标「随子任务」。
- **Checkpoint**：Kiro 的 checkpoint 任务按普通任务处理，勾选即通过。

## 5. 规格视图（对话区「规格」页签）

规格面板是**对话区的一个视图页签**，与「对话」「轨迹」同一排、位于轨迹右侧，形态对齐 Kiro
的 Specs 视图。宿主侧的三个名字各有分工：

| 名字 | 值 | 作用 |
| --- | --- | --- |
| 槽位 | `conversation.view` | 页签注册的槽位名 |
| id | `spec` | 视图在会话里的判别键 |
| order | `20` | 排序：宿主 chat 为 `0`、trajectory 为 `10`，所以 20 落在轨迹右边 |

**注册的是「只有 Spec 模式会话才存在的视图」**：插件订阅主会话的预设投影，预设为 `spec`
时注册 `{ name: 'conversation.view', id: 'spec', order: 20, label: '规格' }`，否则注销。
因此标准模式会话看不到这个页签，也不会多出一个空标签。视图由宿主的视图条渲染，切走时卸载，
切回来时重新挂载并重新读盘——所以「对话里 Agent 刚改完文档」在切回页签时一定能看到。

宿主没有会话视图来源（拿不到 `sessions` / `uiSession`）时插件照常加载：不注册视图，输入区
入口显示「宿主未提供会话视图」，不抛错、不影响其他功能。

入口只有一处：**Spec 模式会话**输入区的 Spec 控件（见下）。

### 树形结构（对齐 Kiro 的 Specs 视图）

```
▾ login-revamp        [设计阶段]  1/4 必需任务 · 25%
   ● Requirements
   ● Design          ← 当前阶段
   ○ Tasks
```

- 每个 spec 一行，行上直接给出**阶段徽标**与**任务完成度**，不用点开就知道在需求、设计还是任务阶段。
- 任务文档里的 `## Task Dependency Graph` 渲染成**执行顺序图**，不是 ID 清单：每个波次一行，
  同一波的任务在同一行里并排（标「并行」），每个任务带编号、标题与状态点，行首节点按波次连线；
  漏进图里的叶子任务单列在「未入依赖图」下。
- 展开后列出**磁盘上已存在**的文档节点；存在性是宿主读盘后返回的事实，不由阶段推断，
  未编写的文档不会占位。
- 文档顺序与 Kiro `SpecExplorerTreeProvider` 一致：`Requirements → Bugfix → Design → Tasks`；
  `fast-task` 工作流改为 `Tasks → Requirements → Design`，后两者标注 `(auto-generated)`。
- 节点圆点区分状态：已完成（绿）、当前（蓝，带光晕）、待开始（灰、半透明）。
- 规格有格式错误时，feature 行显示红色错误计数。

### 文档正文

Requirements / Design / Bugfix 三份文档按 Markdown **渲染后**显示，不是把原文丢进等宽文本框：

- 标题、段落、有序/无序列表、引用、分隔线、行内 `代码`、**粗体**、*斜体*、链接各自成型；
- 表格渲染成真表格（表头吸顶、按 `:---` / `---:` 对齐、窄面板时横向滚动）；
- 围栏代码块保留原文与语言标记，自带滚动，不折行；
- **零依赖**：渲染器内联在 `lib/client.js` 里（客户端 bundle 是经典脚本，不能 import 兄弟 ESM
  模块），只覆盖 Kiro 模板用到的语法；**不认识的语法一律当文本显示**，绝不因为解析不了就丢内容；
- **不使用 `dangerouslySetInnerHTML`**：文档是模型写的，HTML 标签只会以字符形式出现。

正文区是独立滚动容器，文档再长也不挤压表头。

### 操作

- 点文档节点 → 正文区只显示这一份文档，**没有第二层「概览 / 需求 / 设计 / 任务 / 校验」页签**。
- 任务文档（Tasks）直接渲染复选框与状态选择，写回 `tasks.md`；这是**手动状态修正**，
  不冒充 Agent 已执行任务。
- 任务行把**标题与说明分开**：Agent 常写成 `1.1 Create the manifest: \`package.json\` with …`
  一整段，直接显示会让编号、标题、细节糊成一片。现在第一个冒号/破折号前的那一段是标题
  （加粗，编号单独一列），后面是次要说明（灰色、最多两行）；没有自然断句的标题原样保留，
  完整原文放在悬停提示里。
- 顶部「刷新 / 校验 / 新建」与 `⋯` 菜单（关联规格、Spec 设置、新建）。
- 视图在后台（切到「对话」或「轨迹」）时不读盘，也不会因为迟到的旧响应覆盖新选择；
  切回来时重新挂载，列表、当前详情与文档原文都会重新读取。
- **当前边界**：任务执行仍由 Agent 在对话里完成，面板只做状态写回；没有 approve/reject RPC，
  所以界面不会把「格式通过」显示成「人工已批准」。

### 会话与规格的绑定

- 每个会话可以关联一个规格；关联结果保存在 `~/.dsh/spec/sessions.json`，
  **不写入** Kiro 的 `.config.kiro`。
- 没有绑定就是没有绑定：不会按目录修改时间猜测「最近用过的 spec」，
  新会话也不会被工作区里别人的规格锁住类型。
- 创建规格会自动关联到创建它的会话；也可以随时「关联本会话 / 解除关联」。

### 输入区的 Spec 入口

**仅当前会话处于 Spec 模式时**显示：

| 时机 | 形态 | 行为 |
| --- | --- | --- |
| 未关联规格 | `Spec` 菜单 | 第一项是「打开『规格』页签」；其余为草稿类型（Feature / Bugfix / Quick spec）与关联已有规格。选类型只写草稿，不打开面板 |
| 已关联规格 | 可点徽标（feature · 阶段） | 展示当前绑定的规格与阶段，点击打开/定位该会话的「规格」页签，**不会**修改类型 |

选中的类型会先作为**草稿**保存到宿主，新建规格时由 `create` 消费——所以「选了 Bugfix」
就是真的创建 bugfix 规格，而不是只改按钮文字。输入区在选择草稿类型后会提示用户到
「规格」页签点击新建完成创建。

**类型在创建后锁定**：类型存在 `.config.kiro` 里，文档已按该类型写成，改类型会让
`bugfix.md` 与 `requirements.md` 的契约错位。这与 Kiro 一致——Kiro 也不提供创建后改类型的入口。

高级设置（提示词注入、严格校验、默认类型/工作流、`kiroDir`、语言）收在「规格」页签顶部的
`⋯ → Spec 设置…` 里，不再是全局设置里的独立产品页；`kiroDir` 现在贯通列表、读取、写入与校验。

### 输入区的任务面板（替代宿主的 todo）

Spec 模式**不用**宿主的任务模块：`todo_write` 只是三个状态的平铺清单，不懂 Kiro 的依赖波次，
也不懂并行——于是同一个会话里会并排放着两份互相对不上的任务清单（宿主的和 `tasks.md` 的）。
本插件的做法是：

- 预设里把 `tool-todo` 行 `disabled: true`，模型侧不再有 `todo_write`；
- 新增预设行 `spec-plan`（`@weniatall/dsh-spec/plan`），注册会话投影 `specPlan`；
- 面板注册到 `conversation.input.dock`（**输入框上方**，`order: -10`，宿主自己的 todo 也在这一槽位），
  所以位置、宽度与阴影都是宿主的形态，不是另起一个浮层。

**投影而不是轮询**：`spec_write` / `spec_task_update` 每次落盘后追加一条 `spec/plan` 会话事件，
携带整份计划；宿主把投影折叠后推给客户端。因此 Agent 在回合中途改任务，输入框上方的面板会
**实时**更新，不需要切页签、不需要刷新。计划是磁盘上 `tasks.md` 的派生结果，所以**跨回合保留**——
`turn/start` 不会清空它，只有显式的整份计划事件能改它（0.7.4 起；此前每轮开头面板会消失一次）。

**内容按 `## Task Dependency Graph` 分波**：

```
▸ Spec 任务   3 完成 · 2 进行中 · 4 待开始        wc-lite-cli
  ▾ Wave 1                                     1/3
    ● 2.1 实现计数核心                            进行中
    ● 2.2 单元测试                                进行中
    ○ 2.3 帮助文本                                待开始
```

- **并行是真的并行**：同一波里多个 `in_progress` 一起显示，各自带脉冲点——宿主 todo 无法表达这一点。
- 只统计**叶子任务**，父任务不重复计数；由子树派生的完成状态标「随子任务」。
- 可选任务（`*`）标「可选」，不阻塞所在波。
- Checkpoint 不算调度任务，不出现在波次里。
- 图里漏掉的叶子任务会单列在「未入依赖图」下，提示 `tasks.md` 需要补图——**不会静默丢弃**。
- 默认折叠成一行摘要，点开才展开波次；展开态的波次列表自带滚动上限，不会把输入框顶走。

宿主没有 `useProjection`（旧版本）时这段什么都不渲染，绝不退回到「猜一份计划」。

### 界面语言（跟随 DSH）

面板的文案跟随 DSH 自己的语言设置（设置 → 通用 → 语言），**不另设开关**：

- 客户端订阅宿主的 `locale` 运行时（`inject: ["locale"]`），切换语言时页签标题、面板、输入区入口、
  任务面板**同时**换语言，不需要重新加载页面。页签标题注册成 thunk——宿主每次语言变更都会重新解析
  标签，写成固定字符串会让页签停在挂载时的那门语言。
- 没有 `locale` 插件时（独立部署）回落到浏览器 `navigator.language`；再没有就英文。
- **文档名、章节标题、EARS 关键字永远不翻译**（`Requirements`、`## Acceptance Criteria`、
  `SHALL`、`## Task Dependency Graph` …）：它们是 Kiro 与校验器共同匹配的文件格式，翻译了就不再是
  同一份契约。
- 校验提示（「提示 / Requirement 5, criterion 3 …」这类）由服务端在 `get` 时按当前语言重建成中文，
  规则 id 与参数随问题一起下发；Agent 通过 `spec_check` 读到的仍是英文原文——它对照的契约是英文的。
  新加的校验规则如果没有中文条目，会**回落英文**而不是拼一句错的。

## 6. 提示词（同样只在 Spec 模式内）

- 静态策略段（order 185）复述 Kiro 的三文档契约、EARS 要求、复选框状态与检查点纪律，
  并在末尾用一句话指定**文档用什么语言写**（与界面同一套解析）。骨架（章节标题、EARS 关键字、
  `**User Story:**`、`**Validates:**`、JSON 波次图）仍要求英文——翻译骨架会让校验器认不出文档。
- 动态上下文段（order 650）列出当前工作区 spec 及其进度与 ready 任务，最多 `promptMaxSpecs` 条。
- 两段都注册为**函数文本**，每次装配重新读设置（含语言），因此保存后下一步模型调用即生效，
  无需重启，也无需重新挂载预设。
- 语言解析顺序：插件设置里的 `language` → DSH 的语言偏好（`locale` 插件写进 profile patch 的
  `config.preference`）→ 系统语言（`LC_ALL`/`LANG`，macOS 再读 `AppleLocale`）→ 英文。
- 关掉 `prompt.enabled` 后该段渲染为空串，被 `dsh-system-prompt` 的空段过滤丢弃。

## 7. 配置

```yaml
- id: spec
  name: '@weniatall/dsh-spec'
  config:
    kiroDir: .kiro
    prompt:
      enabled: true
      includeActiveSpecs: true
      maxSpecs: 5
    strict: false
    defaultSpecType: feature
    defaultWorkflow: requirements-first
    language: ''        # 空 = 跟随 DSH 的语言设置
```

设置文件：`~/.dsh/spec/settings.json`（UI 保存的优先级高于 profile config）。

这段 `config` 属于**宿主行**，但设置项由**预设半**消费：宿主行只负责读写设置文件，模板装配时
读取的是同一份文件。所以改设置不需要动预设声明。

## 8. 安装与升级

```bash
dsh plugin --profile web add @weniatall/dsh-spec
```

包的 `dsh.bundle.patch` 是数组，一次装载宿主行与预设声明：

```json
"bundle": { "patch": ["./cordis.patch.yml", "./presets/spec.patch.yml"] }
```

升级注意：旧版（0.1.x）把工具注册在宿主行上，新版把它们移进了预设。直接换包即可——
宿主行 id 仍是 `spec`，按 id 覆盖，不需要手改 profile 组合。

**唯一需要留意的冲突**：如果你曾手写过 `id: spec` 的 Agent 预设，新版会撞名并让该预设显示
为 broken（`Duplicate agent preset: spec`）。删掉手写的那一行，改用包内声明。

### 0.4.0 → 0.4.1：热升级导入修复

0.4.0 在同一个长驻 Node 进程里从旧版升级时，可能报 `store.js does not provide an export named 'bindSession'`。
即使安装目录与包内文件完全一致，Node 仍可能缓存旧的辅助模块：重新加载入口不代表重新加载全部相对依赖。

0.4.1 为**整条内部依赖链**使用统一的版本化 ESM URL，避免新入口混用旧 `store` / `ops`。
回归测试会先缓存旧辅助模块、复现 0.4.0 的失败，再原地替换为新源码验证 RPC 与预设工具。
后续发布必须同步内部导入 URL 的版本，包契约测试会检查这一点。

- 若已经卡在 0.4.0：保存工作，完全退出桌面应用后重新打开可清空进程模块缓存（仅刷新页面不够）。
- 更新 0.4.1 请使用桌面应用的插件管理器；desktop profile 不接受公共 CLI 安装，也不要手动覆盖已安装源码。

### 0.4.2：规格标签仅在 Spec 会话显示

修复 0.4.0 / 0.4.1 只隐藏输入选择器、却仍向所有会话注册「规格」标签的问题。
现在根据当前主会话的真实预设投影动态注册/注销标签，标准模式下不占位置；未知模式默认隐藏，残留正文也有独立保护。

### 0.4.2 → 0.5.0：面板从对话标签迁到右栏可停靠页签

面板不再占对话/轨迹旁的一个原生视图（`conversation.view`），改成右栏页签：

- 新增 `sidebarRightTabs.register({ id: '@weniatall/dsh-spec', kind: 'spec', priority: 'extension' })`，
  body 与标题槽位按 **type id** 注册（不是 `kind`）。少了这一步，`openTab('spec')` 会抛
  `no tab type is registered as "spec"`，面板打不开。
- 输入区的 Spec 控件从「只读徽标 / 只提示切标签」改成真正打开页签：未绑定看菜单，已绑定点徽标。
- 页签在后台时不重复读盘，重新显示时（`tab.visible` 转真）自动重读列表、详情与原文。
- 宿主没有 `sidebarRight` 时不再静默失效：类型不注册，入口显示「宿主未提供右侧栏」。
- 页签文字带出绑定规格名（`规格 · <feature>`）。

升级后旧会话里残留的「规格」对话标签不会再出现；同一会话的右栏页签按 kind 复用，不会堆叠。

### 0.5.0 → 0.5.1：类型声明改为迟绑定（修复页签打不开）

0.5.0 在真实宿主上**打不开面板**：点「打开『规格』侧栏」只得到
`sidebarRight: no tab type is registered as "spec"`。

原因不是注册写法，而是**注册时机**。`sidebarRightTabs` 由宿主自己的右栏插件提供，
而那个插件的 `apply` 注入的服务比本插件多（`layout`、`resources`、`sessions`、
`uiSession`、`shortcuts`…），所以本插件的 `apply` 先跑，此刻 `ctx.get('sidebarRightTabs', false)`
还是 `undefined`——一次性读取拿不到就静默跳过声明，页签类型从未注册。
（`sidebarRight` 反而能用，因为入口是在**点击时**才软读的。）

0.5.1 改成迟绑定：

```js
ctx.inject(['sidebarRightTabs'], (inner) => declareTabType(inner.sidebarRightTabs));
```

服务出现时再声明，宿主始终没有右栏就永远不声明、也不报错。单测新增一条用例复现
「apply 时注册表不存在、稍后才提供」的顺序，锁住这个时机问题——只断言注册写法是
测不出来的。

### 0.5.1 → 0.5.2：checkpoint 不再被要求进依赖图

校验器对每个「叶子任务必须入图」逐个检查，却没有把 Kiro 的 checkpoint 排除掉——
而 Kiro 的官方模板本身就把 `N. Checkpoint - …` 写成不参与波次的叶子。结果是**用本插件
模板生成的每个 spec 都带一条假问题**：面板底部「问题」里显示
`Leaf task "5" is not in the dependency graph`。

0.5.2 新增 `isCheckpoint(task)`（标题含 `checkpoint`，大小写不敏感），只豁免这条规则：
checkpoint 仍照常参与调度（勾选即通过），只是不再要求它出现在波次里。真实工作叶子
漏图依旧照报。

### 0.5.2 → 0.6.0：面板回到对话区，成为「轨迹」右侧的视图页签

0.5.0 把面板迁进右栏可停靠页签，实机用下来问题很实在：右栏是宿主自己的地盘，页签的可见性、
宽度、与对话的联动都归它管，而规格面板真正的用法是「一边看文档一边和 Agent 对话」——
挤在右栏既窄又要手动展开。

0.6.0 把它改回**对话区的视图页签**（`conversation.view`，id `spec`，order `20`），
落在「对话」（order 0）和「轨迹」（order 10）右边，和它们同一排、同样的几何：

- 不再注册 `sidebarRightTabs`，也不再使用 `sidebar.right.pane.tab` /
  `sidebar.right.pane.tab.title` 两个槽位；`openTab` 相关的守卫一并删除。
- 视图**只在主会话预设为 `spec` 时注册**（订阅会话投影动态注册/注销），标准模式没有这个页签。
- 输入区的 Spec 控件改用宿主 API `uiConversation.binding(sessionId).activate('spec')` 切视图；
  宿主没提供该绑定时，入口显示「宿主未提供会话视图」。
- 视图带 composer 避让（`--dsh-conversation-viewport-height` 与
  `--dsh-composer-height`），宽度自适应用 `@container(max-width:620px)`，窄栏自动竖排。
- 切到别的视图时宿主卸载本视图，切回来重新挂载并重新读盘——「后台不读盘、回来读最新」
  这个行为因此由宿主生命周期保证，不再依赖 `tab.visible` 轮询。

如果你从 0.5.x 升级：直接换包即可，右栏里遗留的规格页签会随类型注销而消失；会话绑定
（`~/.dsh/spec/sessions.json`）与规格文档都不受影响。

### 0.6.0 → 0.6.2：父任务的完成状态按子任务派生（修复「大任务一直显示未完成」）

实机测试里 Agent 用编辑工具直接改 `tasks.md`，只勾了它实际跑完的子任务，父任务那一行
还是 `- [ ]`。结果面板里 5 个已经全部做完的大任务（`1. Scaffold`…`5. Implement the CLI
orchestration`）全部显示「未开始」——进度条却是 100%，自相矛盾。

根因是「诚实的状态」只实现在**写**路径上：`spec_task_update` 会把父任务一起勾上，
但 Agent 绕过工具直接写文件时这条传播就不会发生，而读取路径（面板、`spec_list`、
`spec_read`）只认复选框本身。

0.6.1 把这条语义补到读取路径：`parseTasks` 建完树后自底向上派生一次，只要一个父任务的
**必需**子任务全部完成，它的状态就是 `completed`，并标记 `derived: true`。要点：

- **不改写文件**：`box` 保留原始复选框，`applyStatusChanges` 只按显式请求写行。
- **可选子任务不参与派生**：只有可选子任务的父任务，仍然只由它自己的复选框说话。
- **派生状态不冒充用户操作**：界面把这类父任务的复选框与状态下拉置灰，并显示「随子任务」
  徽标——否则用户点一下会立刻被子树派生回来，等于给了一个骗人的控件。
- 子任务重新打开时派生随之撤销，父任务回到真实状态。

派生状态还必须跨过 RPC 边界：宿主把任务序列化给面板时用的是白名单式的 `taskView()`，
0.6.1 第一版漏了 `derived` 字段，于是面板状态已经显示「已完成」，控件却仍然是可点的——
客户端根本不知道这个状态是派生的。现在 `taskView()` 带上 `derived`，测试直接断言
`spec_read` 返回的父任务 `derived === true`、未完成的父任务 `derived === false`。

升级后无需改动任何 `tasks.md`：直接换包，面板里的父任务状态立刻变准。

### 0.6.0 → 0.6.2（续）：视图根节点补上 composer 覆盖契约

实机还发现「规格」页签打开后**表头跑到视口上方**（`y = -94`）。原因是宿主的对话视图分两种布局，
由视图根节点上的 `data-conversation-composer-overlay` 属性切换：

- **不带**该属性（宿主自己的「对话」）：视图区跟着页面滚动，composer 是 `position: sticky`；
- **带**该属性（宿主的「轨迹」）：视图区被钉成 `flex:1 1 0; min-height:0; overflow:hidden`，
  composer 变成 `position:absolute` 的覆盖层。

0.6.0 只做了避让的 padding，没带这个属性，于是宿主的「对话」布局把页面留在了聊天时的滚动位置，
本插件 781px 高的面板整体被顶上去 94px。0.6.1 在视图根节点加上该属性，几何与「轨迹」一致；
避让公式 `calc(var(--dsh-composer-height,152px) + 16px)` 与宿主轨迹视图的
`--dsh-trajectory-bottom-clearance` 逐字相同。

### 0.6.2 → 0.7.3：Spec 专属任务模块 + 文档渲染 + 可读的依赖图

这条版本做两件用户直接能看到的事。

**一、用 Spec 自己的任务面板替掉宿主 todo。** 0.6.x 里 Spec 会话同时存在两份任务清单：
宿主的 `todo_write`（`conversation.input.dock`）与 `tasks.md`。它们对不上——宿主不懂依赖波次，
把并行的子任务挤成一条「进行中」，用户看到的是两套互相矛盾的状态。

0.7.0 在预设里 `disabled: true` 掉 `tool-todo`，由 `spec-tools` 独占任务状态；新增
`spec-plan` 预设行注册 `specPlan` 会话投影，客户端把它渲染在**同一槽位**
（`conversation.input.dock`，`order: -10`）。安装后**需要新开一个 Spec 模式会话**（预设的行
在会话创建时装配），已有会话仍按旧预设运行，重启服务不会改变这一点。

升级后旧的 `todo` 投影里可能还留着上一轮的数据；面板不读它，所以不影响显示，但
`~/.dsh` 里的会话记录不必清理。

**任务面板的冷启动**：面板的数据来自会话事件投影，而投影只在该会话里发生过一次写入之后才有内容。
一个已经写好 `tasks.md` 的 spec 关联到新会话时，事件日志里什么都没有，面板本来是空的。0.7.2 给
dock 条目补上 `inject`（此前它拿不到 RPC 句柄），并在挂载时调用一次 `resync`：读绑定的 spec、
发布整份计划、同时把同一份快照返回给面板先画出来。投影仍然只由工具写入，`resync` 只补第一次。

**任务面板不再在回合开始时消失**：`turn/start` 以前会清空投影，于是每一轮开头面板都会消失、
等第一次 `spec_task_update` 才回来。计划来自磁盘上的 `tasks.md`，不是某一轮的产物，所以现在
跨回合保留，只有显式的整份计划事件能改它。

**顺带修掉的两个实机问题**（都来自 0.6.2 的小项目实测）：

- `spec_pbt` 在 `passed` 时**必定报工具序列化错误**：返回值里带着
  `failingExample: undefined`，而宿主把每个工具结果当作 lossless JSON 快照，
  见到 `undefined` 属性就抛 `ToolOutputError`。写入其实已经落盘，所以表现成
  「报错但结果是对的」。现在返回的是真正写进 `tasks.meta.json` 的记录，
  通过的运行根本没有这个键。测试用一次全工具扫描锁死这条契约。
- `spec_check` 的 `spec/missing-pbt-task` 只认任务正文里的 `**Property N**`，
  但 Agent 常把属性测试写在任务标题里（「Write property-based tests for …」）。
  于是属性测试明明已经做了，提示还在，Agent 会反复去找一个已经存在的任务。
  现在标题和正文都算，`property-based` / `property test` 也算。

**二、文档按 Markdown 渲染。** 之前 Requirements / Design / Bugfix 是原文塞进 `<pre>`，
用户读到的就是 `## Overview`、`| --- |`、代码围栏这样的源码，等于没渲染。0.7.0 内联了一个
零依赖渲染器（客户端 bundle 不能 import 兄弟 ESM 模块，所以不能单独成文件）：
标题、列表、表格、代码块、行内标记、链接都成型，未知语法退化成文本而不是被丢弃，
仍然不使用 `dangerouslySetInnerHTML`。正文区同时改成独立滚动容器，长文档不再把表头挤走。

### 0.8.0 → 0.8.1：面板与提示不再各说各话

0.8.0 上线后实测暴露一处分叉：面板文案是中文（浏览器 `zh-CN`），五条「提示」却是英文。原因是
校验提示在**服务端**本地化，而服务端解析语言时既读不到浏览器拿到的 DSH 选择（用户从没在
设置里切过语言，profile patch 里没有 `- id: locale`），也读不到 macOS 的系统语言——全局偏好是
二进制 plist，按文本解析永远失败，最终回落到英文。

0.8.1 的修法是把答案从唯一知道它的地方带过去：面板在 `describe` / `get` 里上报自己的
`language`，服务端优先采用（仍低于显式设置），界面与提示从此同一门语言；macOS 的系统语言改走
`plutil` 读取并按 mtime 缓存。另外面板的 `lang` 成为详情读取的依赖——切换语言会重新拉取，
而不只是重绘标签。

### 0.7.4 → 0.8.0：界面与文档语言跟随 DSH

在此之前界面全部写死中文，Agent 写文档用哪门语言全凭模型自己的判断——用户切到英文界面，
面板还是中文，`requirements.md` 还是中文，而且五个「提示」读起来像同一句话。0.8.0 把语言
收成一条链路，三处消费同一份解析：

| 消费方 | 位置 | 表现 |
| --- | --- | --- |
| 界面文案 | 客户端 `STRINGS`，订阅宿主 `locale` | 页签、面板、输入区入口、任务面板随 DSH 语言即时切换 |
| 校验提示 | 服务端 `get` 时按规则 id + 参数重建 | 「提示 / Requirement 5, criterion 3 含多个 SHALL 子句，建议拆分」 |
| 文档语言 | 提示词策略段末尾一句话 | `languageInstruction()`，同步写进 Agent 的系统提示词 |

**语言是怎么读到的**：面板每次读取（`describe` / `get`）都把它当前的语言一起送上去——
浏览器已经问过宿主的 `locale` 运行时，所以这就是用户的选择本身，服务端以它为准，界面文案与
校验提示因此不可能各说各话（0.8.0 初版正是在这里分叉：面板中文、提示英文，因为服务端读不到
浏览器看到的那份选择）。服务端自己的回落链还在，供没有面板的调用使用：插件设置
（`Spec 设置` 里显式选，覆盖一切）→ 面板上报 → profile 的 `cordis.patch.yml`（`- id: locale` /
`config.preference`，只读按行扫，注释不算）→ 系统语言 → 英文。macOS 的系统语言从
`AppleLocale` 读——全局偏好是二进制 plist，按文本读永远读不到，现在走 `plutil` 并按文件
mtime 缓存（提示词装配路径上不能每轮起一个进程）。

想钉死**文档与校验提示**的语言（比如系统是英文但规格要写中文）就在 `Spec 设置` 里显式选，
这一项会覆盖以上全部；界面文案始终跟随 DSH，不受这一项影响。

**骨架不翻译**：`### Requirement N:`、`## Acceptance Criteria`、`WHEN/WHILE/IF/WHERE/THE/SHALL`、
`**User Story:**`、`**Validates: Requirements X.Y**`、`## Task Dependency Graph` 与 JSON 波次图
在任何语言下都保持英文。它们不是文案，是 Kiro 与 `spec_check` 逐字匹配的文件格式；翻译之后
文档立刻变成「格式错误」。

**升级注意**：客户端新增了对 `@deepseek-ai/dsh-client-locale` 的依赖（`dsh.client.inject` 与
peerDependencies），宿主自带该插件，换包即可。已有会话不需要重建——语言是读取时解析的，不是
创建时固化进会话的。旧会话里已经写好的中文/英文文档不会被改写：语言只影响**之后**的写入。

## 9. 测试

```bash
npm test
```

202 项用例，全部零依赖、无网络：

- `test/validate.test.mjs` — Kiro 规则码与模板自校验；
- `test/tasks.test.mjs` — 复选框语法、层级、可选标记、父任务传播与派生、波次依赖、原位写回、meta；
- `test/plugin.test.mjs` — 工具端到端、RPC、提示词、bugfix 路径、工具结果必须是 lossless JSON（宿主会拒绝带 `undefined` 属性的返回值）；
- `test/host.test.mjs` — 宿主行零工具零提示词、RPC 方法齐全、会话绑定与草稿、跨工作区读写隔离；
- `test/tools.test.mjs` — 预设半的 8 工具、两段提示词、设置热更新、作用域释放；
- `test/properties.test.mjs` — 属性测试（固定种子）：作用域隔离、预设行超集、包契约自洽；
- `test/sidebar.test.mjs` — 规格视图纯函数与常量：文档顺序、存在性、阶段与节点状态、对话视图槽位与顺序；
- `test/client.test.mjs` — 对话视图注册与 Spec 模式门控、视图切换入口、草稿/绑定、文档导航与重挂载重读、任务写回、设置面板、输入区任务面板；
- `test/markdown.test.mjs` — 文档渲染：标题/列表/表格/代码块/行内标记、围栏内的 `#` 不当标题、表格分隔行不进数据、未知语法不丢内容、HTML 只作字符；
- `test/plan.test.mjs` — 任务面板模型：波次分组、并行 in_progress、checkpoint 排除、漏图叶子保留、叶子计数、投影折叠与跨回合保留、发布只追加一条整份计划；
- `test/language.test.mjs` — 语言解析链：DSH 偏好怎么从 profile patch 读出、注释不算、未切换时无偏好、设置 → 面板 → DSH → 系统 → 英文、提示词语言行保留英文骨架；
- `test/messages.test.mjs` — 校验提示中文化：每条规则都有中文、未翻译的规则回落英文、占位符一定被填、文档名与标题保持原样、中文化不改动原对象；
- `test/package.test.mjs` — 包契约、双层 bundle patch、IIFE 自注册、内部依赖版本一致性、零运行时依赖；
- `test/upgrade.test.mjs` — 同进程缓存旧 store/ops、失败入口链接后，热升级 RPC、绑定、草稿与预设工具。

## 10. 与 Kiro 的差异

- Kiro 的 spec 创建/评审由 IDE 编排，插件把同一套文档模型暴露成 Agent 预设内的工具与宿主面板，不复制 IDE 的 subagent 编排。
- Kiro 的 `user_input` 澄清步骤由 DSH 的提问工具承担；插件只负责 spec 文档与任务状态。
- `tasks.meta.json` 仅记录插件产生的执行/PBT 结果；Kiro 已有的历史保持可读。
- 与 Kiro 不同，本插件把「规格能力」做成一个可选 Agent 预设而不是常驻能力：不选它就没有
  `spec_*` 工具。这与 DSH 的预设模型一致——一个会话的 Agent 能力由所选预设决定。
