# dsh-system-prompt-editor

DeepSeek Harness（DSH）**系统提示词可视化编辑器**：查看当前系统提示词，按规则追加、替换或删除任意段落，配置持久化，无需改动 DSH 安装包。

- 👀 **默认展示系统默认提示词**：打开设置页即可看到当前会话真实组装出的提示词原文，不需要先写任何配置。
- 🔎 **段落查询定位**：输入一个词或一段话（如 `Web GUI`），直接查出它在**哪一个/哪几个段落**里，附上下文高亮，并可一键落成规则。
- ✏️ **五种改写动作**：替换文本片段、整段替换、段首插入、段尾追加、删除整段。
- 🎯 **五种定位方式**：全部段落、按名称（下拉框列出真实段落）、按名称前缀、按内容包含、按内容正则。
- ➕ **追加自定义段落**：以独立 section 插入，可选「身份句之后 / 角色设定之后 / 工具说明之前 / 工具说明之后 / 末尾」。
- 🎚️ **可按预设或会话限定**：同一条规则可以只对某个 agent 预设（如 `standard-zh`）或某个会话生效。
- 👁️ **保存前预览**：左侧改规则，右侧实时对比「系统默认」与「套用规则后」。
- 🔍 **逐条命中反馈**：每条规则显示「已命中 N 段 / 未命中 / 不在生效范围 / 无效」，避免以为改了却没生效。
- 💾 **持久化**：优先写入 DSH 官方 settings 服务（进入 profile 文档）；不可用时回退到 `~/.dsh/system-prompt-editor/settings.json`，原子写入。
- 🛡️ **失败不伤主流程**：任何规则异常都只影响它自己，改写失败时原样放行官方提示词，绝不让会话崩溃。

---

## 🧠 它是怎么工作的（为什么不改安装包）

DSH 的系统提示词由 `@deepseek-ai/dsh-system-prompt` 按 `order` 排序拼接而成。
其中 `harness:identity`（即 `You are an AI agent powered by DeepSeek Harness.`）等段落
在**全局层硬编码注册**，因此：

- 直接改 npm 安装目录里的源码 → 升级即被覆盖；
- 全局再注册一个同名 section → 直接抛错
  `prompt section "harness:identity" is already registered`。

本插件改用官方开放的扩展点，分两条互不干扰的通道：

| 通道 | 用途 | 机制 |
|---|---|---|
| **主通道** | 改写/删除已有段落 | `system-prompt/assemble` waterfall（返回值权威，全局监听器能收到所有 scope 的组装请求） |
| **辅通道** | 追加全新段落 | `systemPrompt.section()`，使用带命名空间的 `prompt-editor:custom:*` 名称 |

主通道刻意**不**重新注册同名 section，所以不会与官方或其它插件抢占命名空间；
辅通道用独立命名空间，也不会冲突。

> 详细论证与源码依据见 [docs/DESIGN.md](docs/DESIGN.md)。

---

## 📦 安装

```bash
cd plugins/dsh-system-prompt-editor
npm test          # 先跑测试
npm pack          # 生成 tgz
dsh plugin --profile web add ./weniatall-dsh-system-prompt-editor-0.3.0.tgz
```

> 请勿手动把 `lib/*.js` 复制进 `~/.dsh/profiles/<profile>/node_modules/`，
> 那样会绕过 pnpm 校验，出现过文件被截断却毫无提示的事故。

重启服务使插件生效（Windows 用仓库脚本，`dsh` 本身没有 `service` 子命令）：

```powershell
.\scripts\dsh-web.ps1 restart
# 或 cmd:
scripts\dsh-web.cmd restart
```

macOS / Linux：

```bash
./scripts/dsh-web.sh restart
```

---

## 🚀 使用

重启后进入 **设置 → 系统提示词**。

### 例 1：替换身份句

1. 点「+ 新增规则」。
2. 定位方式选 `按名称`，从下拉框里选 **身份声明（我是谁）**。
3. 动作选 `替换文本片段`，查找填：
   ```
   You are an AI agent powered by DeepSeek Harness.
   ```
   替换为：
   ```
   You are Aria, an internal engineering assistant.
   ```
4. 点「预览效果」确认，再点「保存并生效」。

### 例 2：追加一条全局规矩

在「追加段落」里新增一段，位置选 `角色设定之后`，内容填：

```
Always answer in Chinese.
```

### 例 3：只对某个预设生效

把规则里「生效范围」改成 `仅指定预设`，填入预设 id（如 `standard-zh`，多个用逗号分隔）。

> 预设 id 可以从 `~/.dsh/profiles/<profile>/cordis.patch.yml` 里
> `preset-*` 行的 `config.id` 看到。
> 若当前会话无法解析预设 id，规则会按「不限制」生效，避免静默失效。

### 例 4：删掉某段工具说明

定位方式选 `按名称`，从下拉框选对应的工具说明段落，动作选 `删除整段`。

### 例 5：先查清楚某句话在哪个段落

最常见的卡点不是「不会改」，而是**不知道改哪一段**。比如你知道提示词里有
`Web GUI` 这个说法，却不知道它属于哪个 section——去几百行原文里翻是不现实的。

1. 在「段落查询定位」里输入 `Web GUI`。
2. 结果会列出命中的段落，例如：

   ```
   Web GUI 界面说明（app:web-surface）  命中 1 处  第 12 段   688 字
   …interacting with the user through the DeepSeek Harness [Web GUI] whose URL…
   ```

3. 点「定位到这条规则」：插件会新建一条规则，定位方式已经是 `按名称 → app:web-surface`，
   「要查找的原文」也已填好 `Web GUI`，你只需决定替换成什么。

> 查询在**当前真实提示词**上做，且与「按名称」下拉框是同一批段落，
> 所以查到的名字一定能直接在规则里选中。

---

## 🔎 段落查询定位

### 输入什么

一个词（`Web GUI`）、一个短语，或者整段原文都可以。粘贴多行文本也没关系——
查询会忽略空白差异（换行、缩进、多空格都不影响命中）。

### 三种匹配方式

| 方式 | 语义 | 适合 |
|---|---|---|
| 自动（默认） | 先按整句短语找；一个都没命中再按关键词（每个词都出现）找 | 大多数情况 |
| 整句短语 | 整段输入必须**连续原样**出现 | 你确定原文一字不差 |
| 关键词 | 输入按空白切词，**每个词都出现**即可，顺序与间隔不限 | 只记得几个词、或记得措辞有出入 |
| 正则 | 直接当正则表达式跑 | `Web\s+GUI`、`harness:.*` 这类模式 |

### 两个开关

- **区分大小写**：默认关闭。
- **整词匹配**：默认关闭。关闭时 `GUI` 会命中 `WebGUIClone`；打开后只命中前后都是边界的词。

### 结果怎么读

每条结果给出：

- **中文含义（原始段落名）**：如 `Web GUI 界面说明（app:web-surface）`，既能看懂又能对上配置。
- **命中次数 / 第几段 / 字数**：`命中 2 处`、`第 12 段`、`688 字`。
- **上下文片段**：命中词用黄色高亮，两端 `…` 表示被截断。
- **自定义段落标记**：若命中的是你自己追加的段落，会标出「自定义段落」。

同一段落命中超过 3 处时只展示前 3 处，并提示「另有 N 处命中未展示」。

### 一键落成规则

结果里的两个按钮：

- **定位到这条规则**：新建（或复用）一条 `按名称` 规则，并把命中的文字预填为
  `replaceText` 的查找原文。
- **复制段落名**：把 `app:web-surface` 复制到剪贴板，方便手写配置或对照文档。

---

## 🧾 按名称定位：下拉框说明

section 名是内部标识（`harness:identity`、`deployment:persona-prefix`），对用户不可见。
所以「按名称」定位**不是手填输入框，而是一个下拉框**，列出当前真实存在的所有段落：

- **中文含义**：常见官方段落会显示为人话，如「身份声明（我是谁）」「角色设定·前段（系统人设）」。
  未收录的段落按原名展示。
- **附带原名**：中文名后面括号里保留原始 section 名，方便排障、写配置或对照文档时对上号。
- **附带字数**：如 `· 48 字`，用于区分内容相近的段落。
- **悬停预览**：鼠标停在选项上可看到该段落的开头内容。

列表来自 `describe` 返回的 `sections`，也就是**当前这次组装里真实存在的段落**。
如果下拉框是空的，先点右上角「重新读取」。

> 若某条规则指向的段落当前不在列表中（例如切换预设后该段落消失了），
> 下拉框仍会保留一个「当前配置，未出现在段落列表中」的选项，避免你误以为配置丢了。

---

## ⚠️ 已知边界

| 场景 | 支持情况 | 说明 |
|---|---|---|
| 改任意已有段落 | ✅ | 走 waterfall |
| 追加新段落 | ✅ | 走正式 section 注册 |
| 调整段落顺序 | ✅ | 追加段落可指定位置或 `order` |
| 预设使用了 `complete: true` | ❌ 改不动 | 官方会把该 scope 的提示词强制收拢为那一个 section，任何 waterfall 修改都会被丢弃 |
| 修改工具 schema 描述 | ❌ 不在范围 | 属于 `systemPrompt.tools()` 提供方 |

> **关于 `complete: true`**：`dsh-persona` 支持 `complete` 选项。若你的预设开启了它，
> 本插件的改写会被官方覆盖。此时请改用追加段落，或关掉该预设的 `complete`。

---

## 🛠️ 配置项

写在 profile 的 `cordis.patch.yml` 里（一般无需手写，设置页会代劳）：

```yaml
- id: system-prompt-editor
  name: '@weniatall/dsh-system-prompt-editor'
  config:
    enabled: true          # 总开关
    settingsFile: ''       # 留空用 ~/.dsh/system-prompt-editor/settings.json
    rules: []              # 改写规则
    appendSections: []     # 追加段落
```

规则结构：

```yaml
- id: rename-identity
  enabled: true
  match:
    kind: name             # all | name | prefix | text | regex
    name: harness:identity
  action:
    kind: replaceText      # replaceText | setText | prepend | append | remove
    find: You are an AI agent powered by DeepSeek Harness.
    replace: You are Aria.
    all: true
  applyTo:                 # 省略表示所有会话
    mode: presets          # presets | sessions
    ids: [standard-zh]
```

---

## 🧪 测试

```bash
cd plugins/dsh-system-prompt-editor
npm test
```

覆盖范围（共 150 项）：

- `test/core.test.mjs`：规则归一化、匹配、动作、排序、渲染、边界与完整场景；
  以及段落查询定位的匹配语义、空白折叠、下标映射与片段生成（73 项）
- `test/host.test.mjs`：持久化原子性、损坏配置容错、身份解析、视图组装与降级、
  `locatePrompt` 定位入口（25 项）
- `test/client.test.mjs`：模块契约、插槽、RPC 通道一致性、编辑表单往返无损、
  前后端匹配方式一致性（25 项）
- `test/locate-ui.test.mjs`：用 `test/react-harness.mjs` **真正挂载设置页组件**，
  验证输入即查、结果渲染与高亮、一键落成规则、多次追加规则、过期响应丢弃（12 项）
- `test/integration.test.mjs`：用**真实** `dsh-system-prompt` 服务验证 waterfall 生效、
  追加段落不重复、坏规则不阻断、baseline 不被自身污染、RPC 全链路，
  以及 `locate` 能把 `Web GUI` 定位到 `app:web-surface`（15 项）

> `integration.test.mjs` 直接依赖上游 `@deepseek-ai/dsh-system-prompt` 的真实行为。
> 如果 DSH 升级后改了这个 API，它会最先失败——这是有意为之的早期预警。
>
> `test/react-harness.mjs` 是最小化的 React 替身（hooks + 批处理重渲染 + 元素树遍历），
> 不引入 jsdom 或 testing-library。它只覆盖本插件用到的 API，别当通用测试框架用。

---

## 📄 许可证

MIT
