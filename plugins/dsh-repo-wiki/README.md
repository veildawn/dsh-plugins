# dsh-repo-wiki

把 [Qoder](https://qoder.com) 的 **Repo Wiki** 搬进 DeepSeek Harness：为仓库自动生成一套
结构化、可持续跟踪代码变更的 Markdown 知识库，并让 Agent 能像在 Qoder 里那样直接读写它。

> 实现依据：对本机 `Qoder CN IDE.app`（1.35.0，`com.aliyun.lingma.ide`）的静态逆向 ——
> LanguageClient 的 15 个 `wiki/*` RPC、`wiki_present_status` 的完整状态机与进度换算、
> 真实导出产物 `.qoder/repowiki` 的四表元数据与目录布局、以及 `wiki_plan.yaml` 的字段语义。

## 0. 两半结构：宿主行 + Repo Wiki 预设

插件由两个补丁层组成，装一次包即可同时到位：

| 层 | 文件 | 挂载内容 | 谁会看到 |
| --- | --- | --- | --- |
| 宿主行 | `cordis.patch.yml` | `/dsh-repo-wiki` RPC 通道 + 生成流水线 + 落盘读写 | Web 的全局面板 |
| Repo Wiki 预设 | `presets/repo-wiki.patch.yml` | 六个 `*_wiki` 工具 + 两段提示词 | **只有选中该预设的会话** |

**关键点：宿主行不注册任何工具、不注册任何提示词段落。** 因此用 `standard` / `ptc` /
`minimal` 预设的会话，工具清单与系统提示词里不会出现任何 Wiki 相关内容；而左侧全局面板
在所有会话可用，因为它读写的是磁盘上的产物，与模型侧工具是否挂载无关。

## 1. 目录布局（与 Qoder 导出兼容）

```
<workspace>/<dataDir>/repowiki/
├── <language>/                          # zh | en
│   ├── content/
│   │   ├── 项目概述/
│   │   │   ├── 项目概述.md
│   │   │   └── 技术栈.md
│   │   └── 架构设计/
│   │       ├── 架构设计.md
│   │       └── 安全架构设计/…
│   └── meta/
│       └── repowiki-metadata.json
├── knowledge/
│   └── <language>/<模块>/
│       ├── _module.yaml
│       ├── 概述.md
│       ├── 架构设计.md
│       └── 编码规范.md
└── wiki_plan.yaml                       # 可选，人工干预配置
```

`dataDir` 默认 `.dsh`，因此默认根是 `.dsh/repowiki`。Qoder 用的是 `.qoder` / `.qoder-cn`，
本插件不写那两个目录，但**能读**它们（见 §6）。

## 2. 状态机（逐值对齐 Qoder）

| 状态 | 含义 | 进度 |
| --- | --- | --- |
| `WIKI_INIT` | 尚无产物 | 0 |
| `WAITING` / `LINING` | 排队 | 10 |
| `INITIALIZING` | 扫描仓库 | 20 |
| `DIRECTORY_GENERATING` | 规划目录 | 30 + 完成比×10（增量 ×20） |
| `DOCUMENT_GENERATING` | 逐页写作 | 40 + 完成比×60（增量 50 + 完成比×50） |
| `COMPLETED` / `PARTLY_COMPLETED` | 完成 / 部分完成 | 100 |
| `PAUSED` | 已暂停，可续跑 | 同当前阶段 |
| `INITIALIZING_FAILED` / `DIRECTORY_FAILED` / `DOCUMENT_FAILED` / `NETWORK_ERROR` | 失败 | 0 |
| `NO_FILE_FAILED` / `TOO_MANY_FILES_FAILED` / `TOO_MANY_WORKSPACE_FAILED` / `NOT_SOURCE_CONTROL_FAILED` / `NO_COMMIT_HISTORY_FAILED` / `INSUFFICIENT_REMAINING_SEATS_FAILED` | 前置条件不满足 | 0 |
| `WIKI_EXIST` / `WIKI_HAS_COMMIT` / `WIKI_HAS_CHANGE` / `WIKI_LOSS_COMMIT` / `WIKI_LOAD_FAIL` / `SERVICE_RECOVERING` | 漂移/服务态 | 0 |

## 3. `wiki_plan.yaml`

```yaml
version: 1

repowiki:
  template: ""                # architecture | product_requirement | ""
  notes:
    - text: "文档应聚焦业务流程而非代码细节"
      author: "架构组"
  documents:                  # 白名单：提供时严格按列表生成
    - title: "系统架构概览"
      goal: "描述系统整体架构、核心模块及其交互关系"
      parent: ""
      hints: ""

knowledgecard:
  notes:
    - text: "重点建模支付和订单两个核心子系统"

scope:
  include: ["src/**"]
  exclude: ["**/test/**"]
```

修改后需手动触发「生成」或「重新生成」才生效 —— 与 Qoder 一致。

校验姿态与 Qoder 相同：**能修的只警告不拒绝**（未知键忽略、空 `title`/`goal` 的条目丢弃、超长截断、
重复标题留第一条、未知/自指 `parent` 提升到顶层、循环链断环、超过一层嵌套重挂载）;
`documents` 的 `goal` 为必填（无 goal 的条目会被丢弃并警告，因为写作器没有可写内容）。
整文件只在三种情况拒绝：超过 2 MB、YAML 语法错误、顶层不是 mapping（`validatePlan` 返回
`{ valid, error_message, config_path, diagnostics, rejection }`）。

## 4. 工具（Repo Wiki 预设内）

| 工具 | 作用 |
| --- | --- |
| `list_wiki` | 列出目录树（`catalog_id` / 标题 / 路径 / 状态） |
| `read_wiki` | 按 `catalog_id` 读整篇正文，或按 `query` 检索 |
| `write_wiki` | 整篇写入（不存在则创建目录项） |
| `edit_wiki` | 查找替换，只在唯一命中时生效 |
| `delete_wiki` | 删除页面并级联子树 |
| `search_wiki` | 标题 + 正文检索，返回命中片段 |

## 5. 生成

打开左侧 Repo Wiki 面板 → 选择工作区和语言 → 检查模型、仓库路径及保存位置 → 点「生成 Repo Wiki」。
生成会把仓库目录和文件样本发送给所选模型。流水线：

```
WAITING → INITIALIZING（扫描文件、读 .gitignore 与 README）
        → DIRECTORY_GENERATING（ctx.llm 调用 #1：产出目录树）
        → DOCUMENT_GENERATING（每页一次 ctx.llm 调用，并发 concurrency）
        → COMPLETED / PARTLY_COMPLETED
```

- **暂停 / 继续 / 取消**：在两次模型调用之间生效，已完成页面保留。
- **重试**：`PARTLY_COMPLETED` 时只补跑未完成/失败的页面，不删已完成页（Qoder 的 retry 语义）。
- **重新生成**：确认后清空当前语言的目录树与页面并重跑全量（`WIKI_LOAD_FAIL`、`WIKI_LOSS_COMMIT` 等不可增量的状态走这里）。
- **更新（增量）**：只重跑受变更文件影响的目录项。若记录的 commit 已被 rebase/force-push 改写
  （`git merge-base --is-ancestor` 不可达），状态置为 `WIKI_LOSS_COMMIT`，必须全量重新生成。
- **导入**：`WIKI_HAS_CHANGE`（本地 repowiki 目录被手工编辑）时 `synchronize file_to_db` 回读磁盘页面。
- **删除索引**：移除该语言的产物并退回 `WIKI_INIT`。
- **单页重新生成**：只重跑该目录项及其子项。

## 6. 与 Qoder 产物互操作

本插件读取 `repowiki-metadata.json` 时：

- 明文字段照常读取；以 `WikiEncrypted:` 开头的字段（Qoder 的 `raw_data`、
  `current_document_structure`、`catalogue_think_content`）跳过而不报错；
- 父子关系优先取 `knowledge_relations` 的 `PARENT_CHILD` 行，缺失时回落到
  `wiki_catalogs[].parent_id`；
- `parent_id` 与 `order` 是本插件新增字段，Qoder 读不了但会原样保留。

因此把 Qoder 已经导出的 `.qoder/repowiki` 拷到 `.dsh/repowiki` 下即可直接浏览与继续更新。

## 7. 面板位置

Repo Wiki 是**左侧全局面板**（`sidebar.panellist` + `main`）。左侧栏点击 Repo Wiki 后，在面板中选择
工作区；会话输入框左侧的快捷按钮只打开面板，并尝试选中该会话所属工作区，不会自动开始生成。
面板中的语言选择只影响当前查看或本次生成；要修改默认语言，请到设置页保存。
已有页面会自动打开首篇，目录可折叠；搜索支持标题与路径，按 Esc 可清除搜索。刷新和生成结束后会重新读取当前页面。

宿主自带的「插件」「定时任务」用的就是这一对槽位，`order` 依次是 0、10，Wiki 排在 20。

## 8. 生成模型

设置页的「生成模型」从宿主已注册的提供商与模型目录**下拉选择**，不用手填 provider ID。

- 留空 = 使用 DSH 默认模型（卡片会显示该默认路由具体是什么）
- 某提供商无法枚举模型（如无 `/models` 的 OpenAI 兼容端点）→ 该提供商仍在列表里，模型改为文本框
- 宿主没有 `llm` 服务 → 卡片内提示，设置页其余部分照常可用

生成前会校验路由：提供商不存在、或只填了 provider/model 的一半，都会直接报错并列出可用提供商，
而不是静默回落到默认模型（那会用错模型生成整库）。

## 9. 配置

```yaml
- id: repo-wiki
  name: '@weniatall/dsh-repo-wiki'
  config:
    dataDir: .dsh
    language: zh
    maxFiles: 10000
    maxDepth: 4
    maxCitations: 40
    concurrency: 2
    autoUpdate: false
    autoUpdateDelayMs: 60000
    citation: true
    prompt:
      enabled: true
      maxCatalogs: 40
```

设置文件：`~/.dsh/repo-wiki/settings.json`。顶层键是全局默认，`workspaces.<绝对路径>` 下是
**每仓库覆盖**（对齐 Qoder 按 workspace 存 `repoWikiConfig` 的模型）；优先级从弱到强：
内置默认 → profile config → 全局设置 → 本仓库设置。
设置页顶部可明确选择「全局默认」或某个工作区；恢复全局默认不会删除其他工作区的覆盖。
设置页只保存修改过的字段，其他字段继续继承全局值；切换范围时会提示尚未保存的修改。

`provider` / `model` 留空时向宿主索取默认模型；填写时用该路由生成。

## 10. 安装

```bash
dsh plugin --profile web add @weniatall/dsh-repo-wiki
```

## 11. 已知限制

- 生成质量取决于所选模型；本插件不做配额控制，也没有 Qoder 的 Credits 概念。
- 增量更新依赖 Git；非 Git 工作区只支持全量生成。
- 不写 Qoder 的 `.qoder` / `.qoder-cn` 目录，避免与 Qoder 自身产物冲突。
- mermaid 代码块原样保留，渲染由宿主/客户端负责。
