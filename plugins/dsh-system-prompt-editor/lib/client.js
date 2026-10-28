/**
 * dsh-system-prompt-editor 前端设置页。
 *
 * 挂载在 DSH 的 Settings → 系统提示词。
 *
 * 交互设计要点：
 *  1. **默认展示当前系统提示词**（用户明确要求）：打开页面即调用 describe，
 *     把 `baseline` 渲染出来，不需要先配置任何规则。
 *  2. 左侧是规则列表，右侧实时预览 `effective`，保存前可以点“预览”看效果。
 *  3. 每条规则旁边显示命中状态（applied / no-match / invalid / disabled），
 *     避免用户以为改了却其实没生效。
 *
 * 该文件由宿主的模块加载器执行，因此只能用 `window.__ModuleLoader__` 的形式，
 * 不能写成 ES module。
 */

window.__ModuleLoader__.load({
  id: '@weniatall/dsh-system-prompt-editor',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')

    const SETTINGS_SLOT = 'settings.section'
    const RPC_CHANNEL = '/dsh-system-prompt-editor'

    const MATCH_OPTIONS = [
      { value: 'all', label: '全部段落' },
      { value: 'name', label: '按名称' },
      { value: 'prefix', label: '按名称前缀' },
      { value: 'text', label: '按内容包含' },
      { value: 'regex', label: '按内容正则' },
    ]

    /** 段落查询的匹配方式。与 core.js 的 QUERY_MODES 保持一致。 */
    const QUERY_OPTIONS = [
      { value: 'auto', label: '自动（先整句，再关键词）' },
      { value: 'phrase', label: '整句短语' },
      { value: 'terms', label: '关键词（全部出现）' },
      { value: 'regex', label: '正则表达式' },
    ]

    const ACTION_OPTIONS = [
      { value: 'replaceText', label: '替换文本片段' },
      { value: 'setText', label: '整段替换' },
      { value: 'prepend', label: '段首插入' },
      { value: 'append', label: '段尾追加' },
      { value: 'remove', label: '删除整段' },
    ]

    const POSITION_OPTIONS = [
      { value: 'after-persona', label: '角色设定之后（默认）' },
      { value: 'before-persona', label: '身份句之后' },
      { value: 'before-tools', label: '工具说明之前' },
      { value: 'after-tools', label: '工具说明之后' },
      { value: 'end', label: '提示词末尾' },
    ]

    const css = `
      .spe-root{display:flex;flex-direction:column;gap:16px;width:100%;max-width:1180px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family)}
      .spe-root h2,.spe-root p{margin:0}
      .spe-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
      .spe-title{display:flex;align-items:center;gap:8px;font:var(--dsw-font-l-20)}
      .spe-intro{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-s-14);line-height:20px}
      .spe-badge{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:9px;font-size:11px;line-height:18px}
      .spe-badge.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 14%,transparent);color:var(--dsw-alias-state-success-primary,#22c55e)}
      .spe-badge.warn{background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#f59e0b) 16%,transparent);color:var(--dsw-alias-state-warning-primary,#f59e0b)}
      .spe-badge.muted{background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#888) 16%,transparent);color:var(--dsw-alias-label-tertiary,#888)}
      .spe-badge.err{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 14%,transparent);color:var(--dsw-alias-state-error-primary,#d84848)}
      .spe-card{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-l,12px);background:var(--dsw-alias-background-base,var(--dsw-alias-bg-module-platform))}
      .spe-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
      .spe-card-title{font-weight:600;font-size:13px}
      /* align-items:flex-start —— 同一行里各字段顶部对齐。
         用 flex-end 时，只要某一侧多出一行文字（例如说明），
         底部对齐就会把它的控件顶高，与旁边的控件错位。 */
      .spe-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start}
      .spe-field{display:flex;flex-direction:column;gap:6px;flex:1 1 200px;min-width:0}
      .spe-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:16px}
      .spe-input,.spe-select,.spe-textarea{box-sizing:border-box;width:100%;padding:0 10px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:8px;outline:none;background:var(--dsw-alias-background-base,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
      .spe-input,.spe-select{height:34px}
      .spe-textarea{min-height:76px;padding:8px 10px;font-family:var(--dsw-font-family-mono,ui-monospace,monospace);font-size:12px;line-height:18px;resize:vertical}
      .spe-input:focus-visible,.spe-select:focus-visible,.spe-textarea:focus-visible{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 18%,transparent)}
      .spe-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 14px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:17px;background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);cursor:pointer;white-space:nowrap}
      .spe-btn:disabled{cursor:default;opacity:.5}
      .spe-btn-primary{border-color:transparent;background:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff)}
      .spe-btn-danger{border-color:transparent;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 12%,transparent);color:var(--dsw-alias-state-error-primary,#d84848)}
      .spe-list{display:flex;flex-direction:column;gap:10px}
      .spe-rule{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));border-radius:10px;background:var(--dsw-alias-bg-layer-1,transparent)}
      .spe-rule-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
      .spe-rule-name{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
      .spe-preview{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      @media (max-width:900px){.spe-preview{grid-template-columns:1fr}}
      .spe-pane{display:flex;flex-direction:column;gap:6px;min-width:0}
      .spe-pane pre{margin:0;padding:12px;border-radius:10px;border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family-mono,ui-monospace,monospace);font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto}
      .spe-status{padding:10px 12px;border-radius:8px;font-size:12px;line-height:18px;white-space:pre-wrap}
      .spe-status.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 10%,transparent);color:var(--dsw-alias-state-success-primary,#22c55e)}
      .spe-status.err{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 10%,transparent);color:var(--dsw-alias-state-error-primary,#d84848)}
      .spe-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}
      /* 独立成行的说明：紧跟在某个 spe-row 之后，整体略收紧，不参与行内对齐 */
      .spe-hint-block{margin-top:-2px;padding-left:2px}
      .spe-empty{padding:18px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px}
      .spe-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .spe-spacer{flex:1 1 auto}
      /* —— 段落查询定位 —— */
      .spe-query-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start}
      .spe-query-row .spe-field{flex:1 1 240px}
      .spe-query-row .spe-field.grow{flex:3 1 380px}
      .spe-check{display:inline-flex;align-items:center;gap:6px;height:34px;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap;cursor:pointer}
      .spe-results{display:flex;flex-direction:column;gap:8px}
      .spe-snippets{display:flex;flex-direction:column;gap:6px}
      .spe-result{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));border-left:3px solid var(--dsw-alias-brand-primary,#4d6bfe);border-radius:10px;background:var(--dsw-alias-bg-layer-1,transparent)}
      .spe-result-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .spe-result-name{font-size:12px;font-weight:600}
      .spe-result-cat{color:var(--dsw-alias-label-tertiary);font-size:12px}
      .spe-snippet{margin:0;padding:8px 10px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#888) 8%,transparent);color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family-mono,ui-monospace,monospace);font-size:12px;line-height:19px;white-space:pre-wrap;word-break:break-word}
      .spe-snippet mark{padding:0 2px;border-radius:3px;background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#f59e0b) 34%,transparent);color:var(--dsw-alias-label-primary);font-weight:600}
      .spe-result-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .spe-result-actions .spe-btn{height:28px;padding:0 10px;border-radius:14px;font-size:12px}
      .spe-kv{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}
      /* 段落名独立代码块：user-select:all 让用户点击或双击时自动全选，方便无剪贴板权限时手动划选复制 */
      .spe-code{display:inline-block;padding:2px 7px;border-radius:5px;border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 8%,transparent);color:var(--dsw-alias-brand-primary,#4d6bfe);font-family:var(--dsw-font-family-mono,ui-monospace,monospace);font-size:12px;line-height:16px;user-select:all;-webkit-user-select:all;cursor:text}
    `

    /** 生成一个足够唯一的本地 id。 */
    function nextId(prefix, list) {
      const used = new Set((Array.isArray(list) ? list : []).map((item) => item && item.id))
      let index = (Array.isArray(list) ? list.length : 0) + 1
      while (used.has(`${prefix}-${index}`)) index += 1
      return `${prefix}-${index}`
    }

    /** 把内部规则结构转成前端可编辑的扁平结构。 */
    function toEditorRule(rule, index) {
      const match = rule && rule.match ? rule.match : { kind: 'all' }
      const action = rule && rule.action ? rule.action : { kind: 'append', text: '' }
      const reach = rule && rule.applyTo ? rule.applyTo : { mode: 'all' }
      return {
        id: rule && rule.id ? rule.id : `rule-${index + 1}`,
        enabled: rule && rule.enabled === false ? false : true,
        matchKind: match.kind || 'all',
        matchValue: match.name || match.prefix || match.contains || match.pattern || '',
        actionKind: action.kind || 'append',
        actionText: action.text !== undefined ? action.text : action.replace !== undefined ? action.replace : '',
        actionFind: action.find || '',
        actionReplace: action.replace || '',
        reachMode: reach.mode || 'all',
        reachIds: Array.isArray(reach.ids) ? reach.ids.join(', ') : '',
      }
    }

    /** 把前端编辑结构还原成内部规则结构。 */
    function fromEditorRule(editor) {
      let match
      if (editor.matchKind === 'all') match = { kind: 'all' }
      else if (editor.matchKind === 'name') match = { kind: 'name', name: editor.matchValue }
      else if (editor.matchKind === 'prefix') match = { kind: 'prefix', prefix: editor.matchValue }
      else if (editor.matchKind === 'text') match = { kind: 'text', contains: editor.matchValue }
      else match = { kind: 'regex', pattern: editor.matchValue }

      let action
      if (editor.actionKind === 'remove') action = { kind: 'remove' }
      else if (editor.actionKind === 'replaceText') {
        action = { kind: 'replaceText', find: editor.actionFind, replace: editor.actionReplace }
      } else if (editor.actionKind === 'setText') action = { kind: 'setText', text: editor.actionText }
      else action = { kind: editor.actionKind, text: editor.actionText }

      const ids = String(editor.reachIds || '')
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '')

      return {
        id: editor.id,
        enabled: editor.enabled,
        match,
        action,
        ...editor.reachMode === 'all' ? {} : { applyTo: { mode: editor.reachMode, ids } },
      }
    }

    /** 把内部段落结构转成前端可编辑结构。 */
    function toEditorSection(section, index) {
      return {
        id: section && section.id ? section.id : `section-${index + 1}`,
        enabled: section && section.enabled === false ? false : true,
        text: section && typeof section.text === 'string' ? section.text : '',
        position: section && section.position ? section.position : 'after-persona',
      }
    }

    /**
     * 官方已知段落的可读名称。
     *
     * section 名是内部标识（harness:identity、app:web-surface），直接展示对
     * 普通用户不友好。这里映射成中文含义，未收录的按原名展示。
     *
     * 键以官方真实注册名为准（冒号形式，见 `SECTION_ORDERS` 与各插件源码）；
     * 早期版本曾误写成 `tool-bash` 这类连字符形式，两种都保留，避免存量
     * 部署因命名差异退化成裸名字。
     *
     * 注意 `tool:web_search` / `tool:web_fetch` 用的是**下划线**（见
     * `@deepseek-ai/dsh-tool-web` 的 `section({ name: ... })`），不是连字符；
     * 连字符写法只是历史遗留的兜底键。
     */
    const SECTION_LABELS = {
      // —— 骨架段落 ——
      'harness:identity': '身份声明（我是谁）',
      'harness:source': '实现代码位置说明',
      'app:web-surface': 'Web GUI 界面说明',
      'deployment:persona-prefix': '角色设定·前段（系统人设）',
      'deployment:persona-suffix': '角色设定·后段（收尾提醒）',
      'plan:policy': '计划模式规范',
      'team:identity': '团队身份说明',
      'team:policy': '团队协作规范',
      'tools:ptc-only': 'PTC 专用说明',
      'tools:sdk': 'PTC 生成的 SDK 说明',
      'ui:deliverable-file-references': '交付物文件引用约定',
      'mcp-resource-servers': 'MCP 资源服务说明',

      // —— 上下文约定段落（context:*，由各能力插件按需注册）——
      'context:file-reference': '@ 引用路径约定（文件与目录引用）',

      // —— 工具说明（冒号形式为官方真实名）——
      'tool:bash': 'Bash 工具说明',
      'tool:pwsh': 'PowerShell 工具说明',
      'tool:read': '读取文件工具说明',
      'tool:write': '写入文件工具说明',
      'tool:edit': '编辑文件工具说明',
      'tool:glob': '文件搜索工具说明',
      'tool:grep': '内容搜索工具说明',
      'tool:jobs': '后台任务工具说明',
      'tool:pty': '终端会话工具说明',
      'tool:web_search': '联网搜索工具说明',
      'tool:web_fetch': '网页抓取工具说明',
      'tool:goal': '目标管理工具说明',
      'tool:workflow': '工作流工具说明',
      'tool:subagent': '子代理工具说明',
      'tool:ralph': 'Ralph 循环工具说明',
      'tool:lsp': '语言服务工具说明',
      'tool:session-query': '会话检索工具说明',
      'tool:report': '报告工具说明',
      'tool:computer-use': '桌面操作工具说明',

      // —— 兼容旧命名（连字符 / 早期笔误）——
      'tool-bash': 'Bash 工具说明',
      'tool-pwsh': 'PowerShell 工具说明',
      'tool-read': '读取文件工具说明',
      'tool-write': '写入文件工具说明',
      'tool-edit': '编辑文件工具说明',
      'tool-glob': '文件搜索工具说明',
      'tool-grep': '内容搜索工具说明',
      'tool-jobs': '后台任务工具说明',
      'tool-web-search': '联网搜索工具说明',
      'tool-web-fetch': '网页抓取工具说明',
      'tool-goal': '目标管理工具说明',
      'tool-workflow': '工作流工具说明',
      'tool-subagent': '子代理工具说明',
      'ptc:only': 'PTC 专用说明',
      'mcp-servers': 'MCP 服务说明',
    }

    /**
     * 把 section 名翻译成中文含义。
     *
     * 与 {@link sectionLabel} 内部的那段判断刻意重复：`sectionLabel` 必须
     * 自包含（测试会从源码里抠出它单独求值，一旦它引用外部函数就会
     * ReferenceError）。这里的版本只返回中文名，供查询结果渲染使用。
     * @param {string} name - 原始 section 名。
     * @returns {string} 中文名；未收录时返回空串。
     */
    function knownSectionLabel(name) {
      return SECTION_LABELS[name] || (name.startsWith('mcp:') ? 'MCP 服务说明' : '')
    }

    /**
     * 生成下拉选项的可读标签。
     *
     * 同时展示中文含义与原始 section 名：前者降低理解门槛，后者让用户在
     * 排障、手写配置或对照文档时仍能对上号。
     * @param {{name: string, length?: number}} section - 段落摘要。
     * @returns {string} 展示文本。
     */
    function sectionLabel(section) {
      const name = section && section.name ? String(section.name) : ''
      // 每个 MCP 服务都以 `mcp:<服务名>` 单独注册，服务名无法预先穷举，
      // 所以按前缀识别，避免下拉框里出现一排裸标识。
      const known = SECTION_LABELS[name] || (name.startsWith('mcp:') ? 'MCP 服务说明' : '')
      const base = known ? `${known}（${name}）` : name
      const size = section && typeof section.length === 'number' ? ` · ${section.length} 字` : ''
      return `${base}${size}`
    }

    /** 设置页主组件。 */
    function SystemPromptEditor(props) {
      const rpcCall = props && props.rpcCall
      const [loading, setLoading] = react.useState(true)
      const [busy, setBusy] = react.useState(false)
      const [status, setStatus] = react.useState(null)
      const [view, setView] = react.useState(null)
      const [enabled, setEnabled] = react.useState(true)
      const [rules, setRules] = react.useState([])
      const [sections, setSections] = react.useState([])
      const [previewMode, setPreviewMode] = react.useState('effective')

      // —— 段落查询定位 ——
      // 用户知道某句话在提示词里（例如「Web GUI」），但不知道它属于哪个段落。
      // 这里维护查询条件、结果与进行中标记；命中后可以一键把结果填进某条规则。
      const [queryText, setQueryText] = react.useState('')
      const [queryMode, setQueryMode] = react.useState('auto')
      const [queryCase, setQueryCase] = react.useState(false)
      const [queryWholeWord, setQueryWholeWord] = react.useState(false)
      const [queryResult, setQueryResult] = react.useState(null)
      const [querying, setQuerying] = react.useState(false)
      // 记录最近一次成功复制的段落名，用于按钮显示「✓ 已复制」微反馈
      const [copiedName, setCopiedName] = react.useState('')

      // 请求序号：丢弃过期响应，避免快速输入时结果与输入框对不上。
      const queryTicket = react.useRef(0)

      /** 把服务端视图灌进本地编辑状态。 */
      const adopt = react.useCallback((next) => {
        setView(next)
        setEnabled(!next || !next.config ? true : next.config.enabled !== false)
        setRules(((next && next.config && next.config.rules) || []).map(toEditorRule))
        setSections(((next && next.config && next.config.appendSections) || []).map(toEditorSection))
      }, [])

      const load = react.useCallback(async () => {
        setLoading(true)
        try {
          const data = await rpcCall('describe', {})
          adopt(data)
          setStatus(null)
        } catch (error) {
          setStatus({ kind: 'err', text: error instanceof Error ? error.message : String(error) })
        } finally {
          setLoading(false)
        }
      }, [adopt, rpcCall])

      react.useEffect(() => {
        load()
      }, [load])

      /** 当前编辑状态 → 配置对象。 */
      const buildConfig = () => ({
        enabled,
        rules: rules.map(fromEditorRule),
        appendSections: sections.map((section) => ({
          id: section.id,
          enabled: section.enabled,
          text: section.text,
          position: section.position,
        })),
      })

      const doPreview = async () => {
        setBusy(true)
        try {
          const data = await rpcCall('preview', { config: buildConfig() })
          setView(data)
          setStatus({ kind: 'ok', text: '预览已更新（尚未保存）' })
        } catch (error) {
          setStatus({ kind: 'err', text: error instanceof Error ? error.message : String(error) })
        } finally {
          setBusy(false)
        }
      }

      const doSave = async () => {
        setBusy(true)
        try {
          const data = await rpcCall('save', { config: buildConfig() })
          adopt(data && data.view ? data.view : null)
          setStatus({ kind: 'ok', text: '已保存并生效' })
        } catch (error) {
          setStatus({ kind: 'err', text: error instanceof Error ? error.message : String(error) })
        } finally {
          setBusy(false)
        }
      }

      const doReset = async () => {
        setBusy(true)
        try {
          const data = await rpcCall('reset', {})
          adopt(data && data.view ? data.view : null)
          setStatus({ kind: 'ok', text: '已恢复默认（无任何规则）' })
        } catch (error) {
          setStatus({ kind: 'err', text: error instanceof Error ? error.message : String(error) })
        } finally {
          setBusy(false)
        }
      }

      /**
       * 执行一次段落查询。
       *
       * 三个细节：
       *  1. 用请求序号丢弃过期响应——连续输入时先发的请求可能后到，
       *     不丢弃会让结果与输入框对不上。
       *  2. 空查询直接清空结果，不发请求。
       *  3. 查询失败只显示在结果区，不动页面上的其它状态（保存按钮等照常可用）。
       */
      const runQuery = react.useCallback(async (text, options = {}) => {
        const trimmed = String(text || '').trim()
        if (trimmed === '') {
          setQueryResult(null)
          setQuerying(false)
          return
        }

        const ticket = (queryTicket.current += 1)
        setQuerying(true)
        try {
          const data = await rpcCall('locate', {
            query: {
              text: trimmed,
              mode: options.mode || queryMode,
              caseSensitive: options.caseSensitive ?? queryCase,
              wholeWord: options.wholeWord ?? queryWholeWord,
            },
          })
          if (ticket !== queryTicket.current) return
          setQueryResult(data)
        } catch (error) {
          if (ticket !== queryTicket.current) return
          setQueryResult({
            ok: false,
            matches: [],
            matchedSections: 0,
            message: error instanceof Error ? error.message : String(error),
          })
        } finally {
          if (ticket === queryTicket.current) setQuerying(false)
        }
      }, [queryCase, queryMode, queryWholeWord, rpcCall])

      const updateRule = (index, patch) => {
        setRules((list) => list.map((item, at) => (at === index ? { ...item, ...patch } : item)))
      }

      const removeRule = (index) => {
        setRules((list) => list.filter((_, at) => at !== index))
      }

      const addRule = () => {
        setRules((list) => [
          ...list,
          {
            id: nextId('rule', list),
            enabled: true,
            matchKind: 'name',
            matchValue: 'harness:identity',
            actionKind: 'replaceText',
            actionText: '',
            actionFind: '',
            actionReplace: '',
            reachMode: 'all',
            reachIds: '',
          },
        ])
      }

      const updateSection = (index, patch) => {
        setSections((list) => list.map((item, at) => (at === index ? { ...item, ...patch } : item)))
      }

      const removeSection = (index) => {
        setSections((list) => list.filter((_, at) => at !== index))
      }

      const addSection = () => {
        setSections((list) => [
          ...list,
          { id: nextId('section', list), enabled: true, text: '', position: 'after-persona' },
        ])
      }

      /**
       * 把一次查询命中应用到规则上——这是「查询定位」真正有价值的一步。
       *
       * 用户的原始诉求是「我知道这句话在提示词里，但不知道改哪一段」。查完之后
       * 用户点击「定位到这条规则」或「+ 再加一条规则」，插件都会新建一条规则，
       * 定位方式设置为「按名称」并选定该段落，同时把命中的原文自动填进「要查找的原文」。
       * 用户只需决定替换成什么即可。
       * @param {string} name - 命中的 section 名。
       * @param {object} [snippet] - 命中的片段，用于预填 replaceText 的 find。
       */
      const applyLocateToRule = (name, snippet) => {
        // 优先用服务端给的原始命中文本：`segments` 里的 hit 为了展示把换行
        // 压成了空格，跨行命中时直接拿它当查找原文会永远匹配不上。
        const findText = snippet && typeof snippet.hitText === 'string'
          ? snippet.hitText
          : snippet && Array.isArray(snippet.segments)
            ? snippet.segments.filter((item) => item && item.hit).map((item) => item.text).join('')
            : ''

        const hasExisting = rules.some((rule) => rule && rule.matchValue === name && rule.matchKind === 'name')

        setRules((list) => [
          ...list,
          {
            id: nextId('rule', list),
            enabled: true,
            matchKind: 'name',
            matchValue: name,
            actionKind: findText === '' ? 'append' : 'replaceText',
            actionText: '',
            actionFind: findText,
            actionReplace: '',
            reachMode: 'all',
            reachIds: '',
          },
        ])

        const baseMsg = findText === ''
          ? `定位到「${name}」，请填写要追加的内容`
          : `定位到「${name}」，并把「${findText}」填为查找原文`
        setStatus({
          kind: 'ok',
          text: hasExisting ? `已再新建一条规则，${baseMsg}` : `已新建规则，${baseMsg}`,
        })
      }

      /**
       * 兼容同步复制兜底（用于不支持 Clipboard API、未获授权或非安全上下文 HTTP 环境）。
       * @param {string} text - 待复制文本。
       * @returns {boolean} 是否成功。
       */
      const execCopy = (text) => {
        try {
          if (typeof document === 'undefined') return false
          const ta = document.createElement('textarea')
          ta.value = text
          ta.setAttribute('readonly', '')
          ta.style.position = 'fixed'
          ta.style.top = '0'
          ta.style.left = '0'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.focus()
          ta.select()
          const ok = document.execCommand('copy')
          document.body.removeChild(ta)
          return Boolean(ok)
        } catch {
          return false
        }
      }

      /**
       * 健壮的剪贴板写入通道：优先使用异步 Clipboard API，
       * 被拒绝或在非安全上下文（如直接 IP 访问）不可用时自动回退到 execCommand。
       * 若全部失败，给出包含原始段落名的明确提示，并尝试通过原生 prompt 辅助划选。
       * @param {string} text - 要复制的段落名。
       */
      const copyText = async (text) => {
        let copied = false
        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          try {
            await navigator.clipboard.writeText(text)
            copied = true
          } catch {
            // 回退到 execCopy
          }
        }

        if (!copied) {
          copied = execCopy(text)
        }

        if (copied) {
          setCopiedName(text)
          setTimeout(() => setCopiedName(''), 1800)
          setStatus({ kind: 'ok', text: `已复制段落名：${text}` })
          return true
        }

        // 最终兜底：弹原生 prompt 对话框（自动全选中文字，用户直接 Ctrl+C 即可复制）
        try {
          if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
            window.prompt('浏览器阻止了自动写入剪贴板，请在此按 Ctrl+C 复制段落名：', text)
          }
        } catch {
          // 忽略
        }

        setStatus({ kind: 'err', text: `未能自动写入剪贴板，段落名：${text}（可直接在上方卡片标签或此处手动划选）` })
        return false
      }

      /** 渲染一条查询结果（一个命中段落）。 */
      const renderMatch = (match, index) => {
        const known = knownSectionLabel(match.name)
        const referenced = rules.some(
          (rule) => rule && rule.matchKind === 'name' && rule.matchValue === match.name,
        )
        const isCopied = copiedName === match.name

        return react.createElement('div', { key: `${match.name}-${index}`, className: 'spe-result' },
          react.createElement('div', { className: 'spe-result-head' },
            known ? react.createElement('span', { className: 'spe-result-name' }, known) : null,
            react.createElement('code', {
              className: 'spe-code',
              title: '段落名（已启用全选，双击或长按可直接手动复制）',
            }, match.name),
            react.createElement('span', { className: 'spe-badge ok' }, `命中 ${match.hits} 处`),
            react.createElement('span', { className: 'spe-badge muted' }, `第 ${match.index} 段`),
            match.custom ? react.createElement('span', { className: 'spe-badge warn' }, '自定义段落') : null,
            typeof match.order === 'number'
              ? react.createElement('span', { className: 'spe-kv' }, `order ${match.order}`)
              : null,
            react.createElement('span', { className: 'spe-kv' }, `${match.length} 字`),
          ),

          // 片段直接来自服务端（已含省略号与命中标记），前端只负责加 <mark>，
          // 避免两端各自实现一遍高亮导致不一致。
          react.createElement('div', { className: 'spe-snippets' },
            (match.snippets || []).map((snippet, at) => react.createElement('p', {
              key: at,
              className: 'spe-snippet',
            }, (snippet.segments || []).map((segment, pos) => (segment.hit
              ? react.createElement('mark', { key: pos }, segment.text)
              : react.createElement('span', { key: pos }, segment.text))))),
          ),

          match.omitted > 0 && match.range
            ? react.createElement('p', { className: 'spe-hint' },
              `另有 ${match.omitted} 处命中未展示，全部集中在第 ${match.range.from}–${match.range.to} 字符之间。`)
            : null,

          react.createElement('div', { className: 'spe-result-actions' },
            react.createElement('button', {
              type: 'button',
              className: 'spe-btn',
              title: referenced
                ? '已有规则指向这个段落，再次点击会再建一条'
                : '新建一条定位到这个段落的规则，并把命中的文字填为查找原文',
              onClick: () => applyLocateToRule(match.name, (match.snippets || [])[0]),
            }, referenced ? '+ 再加一条规则' : '定位到这条规则'),
            react.createElement('button', {
              type: 'button',
              className: `spe-btn${isCopied ? ' spe-btn-primary' : ''}`,
              onClick: () => copyText(match.name),
            }, isCopied ? '✓ 已复制' : '复制段落名'),
          ),
        )
      }

      /** 渲染单条规则编辑卡片。 */
      const renderRule = (rule, index) => {
        const result = view && Array.isArray(view.ruleResults)
          ? view.ruleResults.find((item) => item && item.id === rule.id)
          : null
        const badge = result
          ? result.status === 'applied'
            ? { cls: 'ok', text: `已命中 ${result.hits} 段` }
            : result.status === 'no-match'
              ? { cls: 'warn', text: '未命中任何段落' }
              : result.status === 'out-of-scope'
                ? { cls: 'muted', text: '不在当前生效范围' }
                : result.status === 'disabled'
                  ? { cls: 'muted', text: '已停用' }
                  : { cls: 'err', text: '规则无效' }
          : null

        return react.createElement('div', { key: rule.id, className: 'spe-rule' },
          react.createElement('div', { className: 'spe-rule-head' },
            react.createElement('div', { className: 'spe-rule-name' },
              react.createElement('input', {
                type: 'checkbox',
                checked: rule.enabled,
                onChange: (event) => updateRule(index, { enabled: event.target.checked }),
                title: '启用/停用这条规则',
              }),
              react.createElement('span', null, rule.id),
              badge ? react.createElement('span', { className: `spe-badge ${badge.cls}` }, badge.text) : null,
            ),
            react.createElement('button', {
              type: 'button',
              className: 'spe-btn spe-btn-danger',
              onClick: () => removeRule(index),
            }, '删除'),
          ),

          react.createElement('div', { className: 'spe-row' },
            react.createElement('div', { className: 'spe-field' },
              react.createElement('label', { className: 'spe-label' }, '定位方式'),
              react.createElement('select', {
                className: 'spe-select',
                value: rule.matchKind,
                onChange: (event) => updateRule(index, { matchKind: event.target.value }),
              }, MATCH_OPTIONS.map((option) => react.createElement('option', {
                key: option.value,
                value: option.value,
              }, option.label))),
            ),
            rule.matchKind === 'all' ? null : rule.matchKind === 'name'
              ? react.createElement('div', { className: 'spe-field', style: { flex: '2 1 260px' } },
                react.createElement('label', { className: 'spe-label' }, '选择段落'),
                react.createElement('select', {
                  className: 'spe-select',
                  value: rule.matchValue,
                  onChange: (event) => updateRule(index, { matchValue: event.target.value }),
                },
                  // 空值选项：让用户能主动清空一个误设的值。
                  react.createElement('option', { value: '' }, '（请选择段落）'),
                  // 兼容存量配置：若规则已指向一个当前不存在的段落名，
                  // 也要把它作为一个选项保留，否则下拉框会显示空白、
                  // 用户误以为规则没保存。这种情况通常是预设切换导致的。
                  rule.matchValue && !(view && Array.isArray(view.sections) && view.sections.some((s) => s.name === rule.matchValue))
                    ? react.createElement('option', { key: '__current__', value: rule.matchValue },
                      `${rule.matchValue}（当前配置，未出现在段落列表中）`)
                    : null,
                  (view && Array.isArray(view.sections) ? view.sections : []).map((section) => react.createElement('option', {
                    key: section.name,
                    value: section.name,
                    title: section.preview || '',
                  },
                  // inactive：段落已注册但当前不输出（text() 返回空串）。
                  // 不标出来的话，用户会以为「列在这里就一定在提示词里」。
                  sectionLabel(section) + (section.inactive ? ' · 当前未输出' : ''))),
                ),
              )
              : react.createElement('div', { className: 'spe-field', style: { flex: '2 1 260px' } },
                react.createElement('label', { className: 'spe-label' },
                  rule.matchKind === 'prefix' ? '名称前缀（如 tool-）'
                    : rule.matchKind === 'text' ? '包含的文本'
                      : '正则表达式'
                ),
                react.createElement('input', {
                  className: 'spe-input',
                  value: rule.matchValue,
                  placeholder: rule.matchKind === 'prefix' ? 'tool-' : '',
                  onChange: (event) => updateRule(index, { matchValue: event.target.value }),
                }),
              ),
          ),

          // 说明文字放在整行下方，而不是塞进右侧 field 里。
          // 否则右侧比左侧多一行文字，在 align-items:flex-end 下会把
          // 两个下拉框顶成错位——这正是之前视觉不对齐的原因。
          rule.matchKind === 'name'
            ? react.createElement('p', { className: 'spe-hint spe-hint-block' },
              view && Array.isArray(view.sections) && view.sections.length > 0
                ? '下拉框列出的是当前真实存在的所有段落，选中即可，无需手填名称。'
                : '尚未读取到段落列表，请先点击下方「重新读取」。')
            : null,

          react.createElement('div', { className: 'spe-row' },
            react.createElement('div', { className: 'spe-field' },
              react.createElement('label', { className: 'spe-label' }, '动作'),
              react.createElement('select', {
                className: 'spe-select',
                value: rule.actionKind,
                onChange: (event) => updateRule(index, { actionKind: event.target.value }),
              }, ACTION_OPTIONS.map((option) => react.createElement('option', {
                key: option.value,
                value: option.value,
              }, option.label))),
            ),
            rule.actionKind === 'remove' ? null : react.createElement('div', { className: 'spe-field', style: { flex: '3 1 320px' } },
              react.createElement('label', { className: 'spe-label' },
                rule.actionKind === 'replaceText' ? '要查找的原文' : '文本内容'
              ),
              react.createElement('textarea', {
                className: 'spe-textarea',
                value: rule.actionKind === 'replaceText' ? rule.actionFind : rule.actionText,
                onChange: (event) => updateRule(index,
                  rule.actionKind === 'replaceText'
                    ? { actionFind: event.target.value }
                    : { actionText: event.target.value }
                ),
              }),
            ),
          ),

          rule.actionKind === 'replaceText' || rule.actionKind === 'setText'
            ? react.createElement('div', { className: 'spe-row' },
              react.createElement('div', { className: 'spe-field', style: { flex: '3 1 320px' } },
                react.createElement('label', { className: 'spe-label' },
                  rule.actionKind === 'replaceText' ? '替换为' : '（整段替换使用上方“文本内容”）'
                ),
                react.createElement('textarea', {
                  className: 'spe-textarea',
                  value: rule.actionKind === 'replaceText' ? rule.actionReplace : '',
                  disabled: rule.actionKind !== 'replaceText',
                  onChange: (event) => updateRule(index, { actionReplace: event.target.value }),
                }),
              ),
            )
            : null,

          react.createElement('div', { className: 'spe-row' },
            react.createElement('div', { className: 'spe-field' },
              react.createElement('label', { className: 'spe-label' }, '生效范围'),
              react.createElement('select', {
                className: 'spe-select',
                value: rule.reachMode,
                onChange: (event) => updateRule(index, { reachMode: event.target.value }),
              },
                react.createElement('option', { value: 'all' }, '所有会话'),
                react.createElement('option', { value: 'presets' }, '仅指定预设'),
                react.createElement('option', { value: 'sessions' }, '仅指定会话'),
              ),
            ),
            rule.reachMode === 'all' ? null : react.createElement('div', { className: 'spe-field', style: { flex: '2 1 260px' } },
              react.createElement('label', { className: 'spe-label' },
                rule.reachMode === 'presets' ? '预设 id，逗号分隔（如 standard-zh）' : '会话 id，逗号分隔'
              ),
              react.createElement('input', {
                className: 'spe-input',
                value: rule.reachIds,
                placeholder: rule.reachMode === 'presets' ? 'standard-zh, code' : 'session-xxxx',
                onChange: (event) => updateRule(index, { reachIds: event.target.value }),
              }),
            ),
          ),
        )
      }

      /** 渲染单条自定义段落卡片。 */
      const renderSection = (section, index) => {
        return react.createElement('div', { key: section.id, className: 'spe-rule' },
          react.createElement('div', { className: 'spe-rule-head' },
            react.createElement('div', { className: 'spe-rule-name' },
              react.createElement('input', {
                type: 'checkbox',
                checked: section.enabled,
                onChange: (event) => updateSection(index, { enabled: event.target.checked }),
              }),
              react.createElement('span', null, section.id),
            ),
            react.createElement('button', {
              type: 'button',
              className: 'spe-btn spe-btn-danger',
              onClick: () => removeSection(index),
            }, '删除'),
          ),
          react.createElement('div', { className: 'spe-field' },
            react.createElement('label', { className: 'spe-label' }, '插入位置'),
            react.createElement('select', {
              className: 'spe-select',
              value: section.position,
              onChange: (event) => updateSection(index, { position: event.target.value }),
            }, POSITION_OPTIONS.map((option) => react.createElement('option', {
              key: option.value,
              value: option.value,
            }, option.label))),
          ),
          react.createElement('div', { className: 'spe-field' },
            react.createElement('label', { className: 'spe-label' }, '段落内容'),
            react.createElement('textarea', {
              className: 'spe-textarea',
              style: { minHeight: '110px' },
              value: section.text,
              placeholder: '例如：Always answer in Chinese.',
              onChange: (event) => updateSection(index, { text: event.target.value }),
            }),
          ),
        )
      }

      const baselineText = view && typeof view.baseline === 'string' ? view.baseline : ''
      const effectiveText = view && typeof view.effective === 'string' ? view.effective : ''
      const diagnostics = view && Array.isArray(view.diagnostics) ? view.diagnostics : []
      const unknownVariables = view && Array.isArray(view.unknownVariables) ? view.unknownVariables : []

      if (loading) {
        return react.createElement('div', { className: 'spe-root' },
          react.createElement('div', { className: 'spe-empty' }, '正在读取系统提示词…'),
        )
      }

      return react.createElement('div', { className: 'spe-root' },
        react.createElement('div', { className: 'spe-head' },
          react.createElement('div', null,
            react.createElement('h2', { className: 'spe-title' }, '系统提示词编辑'),
            react.createElement('p', { className: 'spe-intro' },
              '在不修改 DSH 安装包的前提下调整系统提示词。下方默认展示当前系统提示词原文，'
              + '右侧是你配置规则后的效果。规则通过 system-prompt/assemble 生效，'
              + '追加段落则以正式 section 注册。'
            ),
          ),
          react.createElement('div', { className: 'spe-actions' },
            react.createElement('span', {
              className: `spe-badge ${view && view.storageKind === 'settings' ? 'ok' : 'muted'}`,
              title: view && view.settingsFile ? view.settingsFile : '',
            }, view && view.storageKind === 'settings' ? '已接入 settings 服务' : '本地文件持久化'),
            react.createElement('button', {
              type: 'button',
              className: 'spe-btn',
              disabled: busy,
              onClick: load,
            }, '重新读取'),
          ),
        ),

        status ? react.createElement('div', { className: `spe-status ${status.kind}` }, status.text) : null,

        view && view.failure
          ? react.createElement('div', { className: 'spe-status err' }, `组装提示词失败：${view.failure}`)
          : null,

        diagnostics.length > 0
          ? react.createElement('div', { className: 'spe-status err' },
            `配置诊断：\n${diagnostics.join('\n')}`)
          : null,

        unknownVariables.length > 0
          ? react.createElement('div', { className: 'spe-status err' },
            `以下变量当前不可用，保存后官方渲染可能报错：${unknownVariables.join(', ')}`)
          : null,

        react.createElement('div', { className: 'spe-card' },
          react.createElement('div', { className: 'spe-card-head' },
            react.createElement('div', { className: 'spe-card-title' }, '总开关'),
            react.createElement('label', { className: 'spe-label', style: { display: 'flex', alignItems: 'center', gap: 8 } },
              react.createElement('input', {
                type: 'checkbox',
                checked: enabled,
                onChange: (event) => setEnabled(event.target.checked),
              }),
              '启用本插件的全部规则与追加段落',
            ),
          ),
          react.createElement('p', { className: 'spe-hint' },
            '关闭后系统提示词完全恢复官方默认，配置仍会保留。'
          ),
        ),

        react.createElement('div', { className: 'spe-card' },
          react.createElement('div', { className: 'spe-card-head' },
            react.createElement('div', { className: 'spe-card-title' }, '段落查询定位'),
            react.createElement('span', { className: 'spe-kv' },
              view && Array.isArray(view.sections)
                ? `当前共 ${view.sections.length} 个段落`
                : '段落列表尚未读取'),
          ),
          react.createElement('p', { className: 'spe-hint' },
            '知道提示词里有这么一句话、但不知道它属于哪个段落？在这里输入一个词或一段话，'
            + '下方会列出命中的段落与上下文。例如输入 Web GUI，会定位到 app:web-surface。'
          ),
          // 段落列表来自「全局 scope + 当前会话 agent 的 scope」两路合并。
          // 有些段落虽然注册了，但当前条件下不输出（如需要 read 工具的
          // context:file-reference），它们会以「当前未输出」标注列出——
          // 这样用户能区分「段落不存在」和「段落存在但此刻是空的」。
          view && Array.isArray(view.sections) && view.sections.length > 0
            ? react.createElement('p', { className: 'spe-hint' },
              '列表已包含当前会话专属的段落（如 context:file-reference）。'
              + '标注「当前未输出」的段落已注册，但当前条件下内容为空——'
              + '这类段落搜不到原文是正常的，需要满足条件（例如会话具备 read 工具）才会输出。')
            : null,

          react.createElement('div', { className: 'spe-query-row' },
            react.createElement('div', { className: 'spe-field grow' },
              react.createElement('label', { className: 'spe-label' }, '要查找的词或句子'),
              react.createElement('input', {
                className: 'spe-input',
                value: queryText,
                placeholder: '例如：Web GUI，或整段原文',
                onChange: (event) => {
                  setQueryText(event.target.value)
                  // 输入即查：用户不必再点一次按钮。请求序号保证结果与输入对齐。
                  runQuery(event.target.value)
                },
                onKeyDown: (event) => {
                  if (event.key === 'Enter') runQuery(queryText)
                },
              }),
            ),
            react.createElement('div', { className: 'spe-field' },
              react.createElement('label', { className: 'spe-label' }, '匹配方式'),
              react.createElement('select', {
                className: 'spe-select',
                value: queryMode,
                onChange: (event) => {
                  setQueryMode(event.target.value)
                  runQuery(queryText, { mode: event.target.value })
                },
              }, QUERY_OPTIONS.map((option) => react.createElement('option', {
                key: option.value,
                value: option.value,
              }, option.label))),
            ),
          ),

          react.createElement('div', { className: 'spe-query-row' },
            react.createElement('label', { className: 'spe-check' },
              react.createElement('input', {
                type: 'checkbox',
                checked: queryCase,
                onChange: (event) => {
                  setQueryCase(event.target.checked)
                  runQuery(queryText, { caseSensitive: event.target.checked })
                },
              }),
              '区分大小写',
            ),
            react.createElement('label', { className: 'spe-check' },
              react.createElement('input', {
                type: 'checkbox',
                checked: queryWholeWord,
                onChange: (event) => {
                  setQueryWholeWord(event.target.checked)
                  runQuery(queryText, { wholeWord: event.target.checked })
                },
              }),
              '整词匹配',
            ),
            react.createElement('div', { className: 'spe-spacer' }),
            react.createElement('button', {
              type: 'button',
              className: 'spe-btn',
              disabled: querying || String(queryText).trim() === '',
              onClick: () => runQuery(queryText),
            }, querying ? '查询中…' : '重新查询'),
            react.createElement('button', {
              type: 'button',
              className: 'spe-btn',
              disabled: String(queryText).trim() === '',
              onClick: () => {
                setQueryText('')
                setQueryResult(null)
              },
            }, '清空'),
          ),

          queryResult && queryResult.problem
            ? react.createElement('div', { className: 'spe-status err' }, queryResult.problem)
            : null,

          queryResult
            ? react.createElement('div', {
              className: `spe-status ${queryResult.ok && queryResult.matchedSections > 0 ? 'ok' : 'err'}`,
            }, queryResult.message || '没有结果')
            : null,

          queryResult && Array.isArray(queryResult.matches) && queryResult.matches.length > 0
            ? react.createElement('div', { className: 'spe-results' }, queryResult.matches.map(renderMatch))
            : null,

          queryResult && queryResult.ok && queryResult.matches && queryResult.matches.length === 0
            ? react.createElement('p', { className: 'spe-hint' },
              '提示：自动模式先按整句找，找不到再按关键词（每个词都出现）找。'
              + '整段长句常因为多了一个标点就查不到，可以只取其中最有辨识度的几个词。')
            : null,
        ),

        react.createElement('div', { className: 'spe-card' },
          react.createElement('div', { className: 'spe-card-head' },
            react.createElement('div', { className: 'spe-card-title' }, `改写规则（${rules.length}）`),
            react.createElement('button', { type: 'button', className: 'spe-btn', onClick: addRule }, '+ 新增规则'),
          ),
          rules.length === 0
            ? react.createElement('div', { className: 'spe-empty' },
              '还没有规则。新增一条即可修改身份句、工具说明等任意段落。')
            : react.createElement('div', { className: 'spe-list' }, rules.map(renderRule)),
        ),

        react.createElement('div', { className: 'spe-card' },
          react.createElement('div', { className: 'spe-card-head' },
            react.createElement('div', { className: 'spe-card-title' }, `追加段落（${sections.length}）`),
            react.createElement('button', { type: 'button', className: 'spe-btn', onClick: addSection }, '+ 新增段落'),
          ),
          sections.length === 0
            ? react.createElement('div', { className: 'spe-empty' },
              '还没有追加段落。这里添加的内容会作为独立 section 插入提示词。')
            : react.createElement('div', { className: 'spe-list' }, sections.map(renderSection)),
        ),

        react.createElement('div', { className: 'spe-card' },
          react.createElement('div', { className: 'spe-card-head' },
            react.createElement('div', { className: 'spe-card-title' }, '提示词预览'),
            react.createElement('div', { className: 'spe-actions' },
              react.createElement('button', {
                type: 'button',
                className: `spe-btn${previewMode === 'baseline' ? ' spe-btn-primary' : ''}`,
                onClick: () => setPreviewMode('baseline'),
              }, '系统默认'),
              react.createElement('button', {
                type: 'button',
                className: `spe-btn${previewMode === 'effective' ? ' spe-btn-primary' : ''}`,
                onClick: () => setPreviewMode('effective'),
              }, '套用规则后'),
            ),
          ),
          react.createElement('div', { className: 'spe-pane' },
            react.createElement('pre', null,
              previewMode === 'baseline'
                ? (baselineText || '（未能读取系统默认提示词）')
                : (effectiveText || '（尚未生成预览，点击下方“预览效果”）')
            ),
          ),
          react.createElement('p', { className: 'spe-hint' },
            `段落数：${view && Array.isArray(view.sections) ? view.sections.length : 0}`
            + `　可用变量：${view && view.variables ? Object.keys(view.variables).join(', ') || '（无）' : '（无）'}`
          ),
        ),

        react.createElement('div', { className: 'spe-actions' },
          react.createElement('button', {
            type: 'button',
            className: 'spe-btn',
            disabled: busy,
            onClick: doPreview,
          }, '预览效果'),
          react.createElement('div', { className: 'spe-spacer' }),
          react.createElement('button', {
            type: 'button',
            className: 'spe-btn spe-btn-danger',
            disabled: busy,
            onClick: doReset,
          }, '恢复默认'),
          react.createElement('button', {
            type: 'button',
            className: 'spe-btn spe-btn-primary',
            disabled: busy,
            onClick: doSave,
          }, busy ? '处理中…' : '保存并生效'),
        ),
      )
    }

    /** 插件入口：注册设置页插槽。 */
    function apply(ctx) {
      if (typeof document !== 'undefined' && !document.getElementById('dsh-spe-style')) {
        const style = document.createElement('style')
        style.id = 'dsh-spe-style'
        style.textContent = css
        document.head.appendChild(style)
      }

      const rpcCall = async (method, payload) => {
        const conn = ctx && ctx.connection
        const rpc = conn && conn.rpc
        if (!rpc || typeof rpc.call !== 'function') {
          throw new Error('连接服务尚未就绪')
        }
        const result = await rpc.call(RPC_CHANNEL, method, payload || {})
        if (result && result.ok === true) return result.value
        const message = result && result.error && result.error.message
        throw new Error(message || '请求失败')
      }

      const label = () => react.createElement('span', {
        'data-settings-nav-label': 'dsh-system-prompt-editor',
        style: { display: 'inline-flex', alignItems: 'center', gap: 8 },
      }, react.createElement('span', null, '系统提示词'))

      ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({
        name: SETTINGS_SLOT,
        id: 'dsh-system-prompt-editor',
        order: 37,
        label,
        inject: () => ({ rpcCall }),
      }, SystemPromptEditor))
    }

    exports.apply = apply
    exports.inject = ['slots', 'connection']
    return module.exports
  },
})
