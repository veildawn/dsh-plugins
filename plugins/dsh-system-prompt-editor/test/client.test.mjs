import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_PATH = path.join(__dirname, '..', 'lib', 'client.js')

/**
 * 读取 client.js 源码。
 *
 * 前端文件在浏览器里由 `window.__ModuleLoader__` 执行，Node 下无法直接 import，
 * 所以这里做两类验证：模块契约（能解析、注册 id 正确）与关键行为（源码里
 * 确实没有把内部结构写错）。这不是完整的前端渲染测试，但能挡住最常见的
 * “改坏了却不自知”的问题，例如 RPC 通道名写错、忘记 inject。
 */
function readClient() {
  return fs.readFileSync(CLIENT_PATH, 'utf8')
}

test('client.js 通过 ModuleLoader 注册且 id 与包名一致', () => {
  const source = readClient()
  assert.match(source, /window\.__ModuleLoader__\.load\(/)
  assert.match(source, /id:\s*'@weniatall\/dsh-system-prompt-editor'/)
})

test('client.js 使用正确的设置页插槽', () => {
  const source = readClient()
  assert.match(source, /SETTINGS_SLOT\s*=\s*'settings\.section'/)
  assert.match(source, /ctx\.slots\.inject\(SETTINGS_SLOT/)
})

test('client.js 声明了必需的 inject 依赖', () => {
  const source = readClient()
  assert.match(source, /exports\.inject\s*=\s*\['slots',\s*'connection'\]/)
})

test('client.js 的 RPC 通道与宿主端一致', () => {
  const hostSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'index.js'), 'utf8')
  const clientSource = readClient()

  const hostChannel = hostSource.match(/RPC_CHANNEL\s*=\s*'([^']+)'/)
  const clientChannel = clientSource.match(/RPC_CHANNEL\s*=\s*'([^']+)'/)

  assert.ok(hostChannel, '宿主端必须定义 RPC_CHANNEL')
  assert.ok(clientChannel, '前端必须定义 RPC_CHANNEL')
  assert.equal(clientChannel[1], hostChannel[1], '两端 RPC 通道名必须完全一致')
})

test('client.js 调用的方法宿主端都实现了', () => {
  const hostSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'index.js'), 'utf8')
  const clientSource = readClient()

  // 从前端收集所有 rpcCall('xxx', ...) 的调用
  const used = new Set()
  for (const match of clientSource.matchAll(/rpcCall\(\s*'([a-zA-Z]+)'/g)) used.add(match[1])

  assert.ok(used.has('describe'))
  for (const method of used) {
    assert.match(
      hostSource,
      new RegExp(`method === '${method}'`),
      `宿主端缺少对 "${method}" 的处理分支`,
    )
  }
})

test('client.js 允许用户覆盖 rebuild 的默认动作组合', () => {
  const source = readClient()
  // 动作列表必须覆盖 core.js 支持的全部 kind，否则用户无法在 UI 里选到。
  for (const kind of ['replaceText', 'setText', 'prepend', 'append', 'remove']) {
    assert.match(source, new RegExp(`value: '${kind}'`), `设置页缺少动作 "${kind}"`)
  }
  // 匹配方式同理。
  for (const kind of ['all', 'name', 'prefix', 'text', 'regex']) {
    assert.match(source, new RegExp(`value: '${kind}'`), `设置页缺少匹配方式 "${kind}"`)
  }
})

test('client.js 默认展示系统提示词', () => {
  const source = readClient()
  // 用户明确要求「默认要读取系统默认的提示词显示」。
  assert.match(source, /baseline/, '必须渲染 baseline（系统默认提示词）')
  assert.match(source, /useEffect/, '打开页面即应自动加载')
})

test('client.js 阻止未加载完成时的误操作', () => {
  const source = readClient()
  assert.match(source, /loading/, '必须区分加载中状态')
  assert.match(source, /disabled:\s*busy/, '忙碌时应禁用提交按钮')
})

/**
 * 从 client.js 源码里提取 toEditorRule / fromEditorRule 两个纯函数，
 * 在 Node 下真实执行它们，验证“服务端配置 → 编辑表单 → 服务端配置”往返无损。
 *
 * 这两个函数决定用户的每次编辑能否被正确保存，是前端最容易出错的地方，
 * 所以不能只做字符串匹配，必须真的跑一遍。
 */
function loadRuleMappers() {
  const source = readClient()
  const toMatch = source.match(/function toEditorRule[\s\S]*?\n    }/)
  const fromMatch = source.match(/function fromEditorRule[\s\S]*?\n    }/)
  assert.ok(toMatch, '未能从 client.js 提取 toEditorRule')
  assert.ok(fromMatch, '未能从 client.js 提取 fromEditorRule')

  // eslint-disable-next-line no-new-func
  const factory = new Function(`${toMatch[0]}\n${fromMatch[0]}\nreturn { toEditorRule, fromEditorRule }`)
  return factory()
}

test('规则在编辑表单与服务端结构之间往返无损', () => {
  const { toEditorRule, fromEditorRule } = loadRuleMappers()

  const cases = [
    { id: 'a', enabled: true, match: { kind: 'name', name: 'harness:identity' }, action: { kind: 'replaceText', find: 'X', replace: 'Y' } },
    { id: 'b', enabled: false, match: { kind: 'all' }, action: { kind: 'remove' } },
    { id: 'c', enabled: true, match: { kind: 'text', contains: 'foo' }, action: { kind: 'setText', text: 'BAR' } },
    { id: 'd', enabled: true, match: { kind: 'prefix', prefix: 'tool-' }, action: { kind: 'append', text: 'tail' } },
    { id: 'e', enabled: true, match: { kind: 'regex', pattern: 'a.*b' }, action: { kind: 'prepend', text: 'head' } },
    {
      id: 'f',
      enabled: true,
      match: { kind: 'name', name: 'x' },
      action: { kind: 'append', text: 't' },
      applyTo: { mode: 'presets', ids: ['standard-zh'] },
    },
  ]

  for (const original of cases) {
    const round = fromEditorRule(toEditorRule(original, 0))
    assert.deepEqual(round.match, original.match, `规则 ${original.id} 的 match 往返后不一致`)
    assert.deepEqual(round.action, original.action, `规则 ${original.id} 的 action 往返后不一致`)
    assert.deepEqual(round.applyTo ?? null, original.applyTo ?? null, `规则 ${original.id} 的 applyTo 往返后不一致`)
    assert.equal(round.enabled, original.enabled)
    assert.equal(round.id, original.id)
  }
})

test('setText 动作不会被误转成 append', () => {
  const { fromEditorRule } = loadRuleMappers()
  const rule = fromEditorRule({
    id: 'r1',
    enabled: true,
    matchKind: 'name',
    matchValue: 'harness:identity',
    actionKind: 'setText',
    actionText: 'You are Aria.',
    actionFind: '',
    actionReplace: '',
    reachMode: 'all',
    reachIds: '',
  })

  assert.equal(rule.action.kind, 'setText')
  assert.equal(rule.action.text, 'You are Aria.')
})

test('remove 动作不带多余字段', () => {
  const { fromEditorRule } = loadRuleMappers()
  const rule = fromEditorRule({
    id: 'r3',
    enabled: true,
    matchKind: 'all',
    matchValue: '',
    actionKind: 'remove',
    actionText: 'ignored',
    actionFind: '',
    actionReplace: '',
    reachMode: 'all',
    reachIds: '',
  })

  assert.deepEqual(rule.action, { kind: 'remove' })
})

test('生效范围为空 id 时不写入 applyTo', () => {
  const { fromEditorRule } = loadRuleMappers()
  const rule = fromEditorRule({
    id: 'r4',
    enabled: true,
    matchKind: 'all',
    matchValue: '',
    actionKind: 'append',
    actionText: 'x',
    actionFind: '',
    actionReplace: '',
    reachMode: 'all',
    reachIds: '',
  })

  // reachMode 为 all 时不应产生 applyTo，否则后端会做无意义的范围判断。
  assert.equal(rule.applyTo, undefined)
})

/**
 * 回归：宿主端注入声明必须包含 connection。
 *
 * 这个缺陷真实发生过一次——2026-10 发布 0.1.0 时 cordis.patch.yml 只声明了
 * systemPrompt，前端设置页能正常渲染（client.js 加载成功），但所有 RPC 调用
 * 返回 HTTP 405，因为宿主端从未拿到 connection.rpc，也就没 register 过通道。
 * 症状是"UI 正常但数据全错"，只看 UI 完全发现不了。
 *
 * 因此这里同时断言三处：模块 inject、patch inject、以及代码确实用到 rpc。
 */

/** 读取 patch 里某个插件行的 inject 列表。 */
function readPatchInject(source) {
  // 行尾必须两种都认：仓库里的 yml 是 LF，但 Windows 检出（core.autocrlf）后是 CRLF。
  // 只写 `\n` 会让这条断言在 Windows 上恒定失败 —— 那是测试环境的换行差异，
  // 不是插件真的没声明 inject。
  const match = source.match(/inject:\r?\n((?:\s*-\s*\S+\r?\n)+)/)
  assert.ok(match, '未能从 cordis.patch.yml 解析出 inject 列表')
  return [...match[1].matchAll(/-\s*(\S+)/g)].map((item) => item[1])
}

test('模块 inject 与 cordis.patch.yml 的 inject 完全一致', () => {
  const hostSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'index.js'), 'utf8')
  const patchSource = fs.readFileSync(path.join(__dirname, '..', 'cordis.patch.yml'), 'utf8')

  const moduleInject = hostSource.match(/export const inject = \[([^\]]*)\]/)
  assert.ok(moduleInject, 'lib/index.js 必须导出 inject')
  const moduleList = [...moduleInject[1].matchAll(/'([^']+)'/g)].map((item) => item[1])
  const patchList = readPatchInject(patchSource)

  // 顺序无关，集合必须相同：两处漂移会让"实际拿到的服务"与代码预期不符。
  assert.deepEqual([...moduleList].sort(), [...patchList].sort())
})

test('inject 包含 connection——否则设置页 RPC 会 405', () => {
  const hostSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'index.js'), 'utf8')
  const patchSource = fs.readFileSync(path.join(__dirname, '..', 'cordis.patch.yml'), 'utf8')

  assert.ok(readPatchInject(patchSource).includes('connection'),
    'cordis.patch.yml 必须注入 connection，否则前端所有 RPC 调用返回 405')
  assert.match(hostSource, /export const inject = \[[^\]]*'connection'/,
    'lib/index.js 的 inject 必须包含 connection')
})

test('inject 包含 agents——否则设置页看不到会话层段落', () => {
  const hostSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'index.js'), 'utf8')
  const patchSource = fs.readFileSync(path.join(__dirname, '..', 'cordis.patch.yml'), 'utf8')

  // v0.3.4 漏了这一项：Cordis 未声明的服务读出来是 undefined，
  // findLiveAgent 永远返回 null，段落数停在全局 8 段。
  assert.ok(readPatchInject(patchSource).includes('agents'),
    'cordis.patch.yml 必须注入 agents')
  assert.match(hostSource, /export const inject = \[[^\]]*'agents'/,
    'lib/index.js 的 inject 必须包含 agents')
})

test('宿主端确实注册了 RPC 通道', () => {
  const hostSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'index.js'), 'utf8')
  // 仅声明 inject 不够，代码必须真的调用 rpc.handle。
  assert.match(hostSource, /rpc\.handle\(/, '宿主端必须调用 connection.rpc.handle 注册通道')
  assert.match(hostSource, /RPC_CHANNEL,/, 'rpc.handle 的第一个参数必须是 RPC_CHANNEL')
})

/**
 * 回归：按名称定位必须用下拉框列出真实 section，不能要求用户手填内部标识。
 *
 * 背景：section 名是内部实现（harness:identity、deployment:persona-prefix），
 * 对普通用户不可见也不友好。最初版本是一个文本输入框，用户根本无法知道
 * 该填什么。现在改为从 describe 返回的 sections 渲染下拉框。
 */

test('按名称定位使用 select 下拉框，而不是文本输入框', () => {
  const source = readClient()

  assert.match(source, /rule\.matchKind === 'name'/, '应存在 name 匹配的专属分支')
  // 反证：不应再出现要求用户手填 section 名的 input + placeholder。
  assert.doesNotMatch(source, /placeholder: rule\.matchKind === 'name' \? 'harness:identity'/)
  // 下拉框选项必须来自 describe 返回的 sections
  assert.match(source, /Array\.isArray\(view\.sections\) \? view\.sections : \[\]\)\.map\(\(section\) => react\.createElement\('option'/)
})

test('sectionLabel 为官方段落提供中文可读名称', () => {
  const source = readClient()
  const labels = source.match(/const SECTION_LABELS = \{[\s\S]*?\n    \}/)
  const labelFn = source.match(/function sectionLabel[\s\S]*?\n    \}/)
  assert.ok(labels && labelFn, '未能提取 SECTION_LABELS / sectionLabel')

  // eslint-disable-next-line no-new-func
  const { sectionLabel } = new Function(`${labels[0]}\n${labelFn[0]}\nreturn { sectionLabel }`)()

  // 已知段落应显示中文含义
  assert.match(sectionLabel({ name: 'harness:identity', length: 48 }), /身份声明/)
  assert.match(sectionLabel({ name: 'deployment:persona-prefix' }), /角色设定/)
  // 未知段落回落到原名，不能显示空
  assert.match(sectionLabel({ name: 'custom-thing' }), /^custom-thing/)
  // 原名必须保留，便于排障时对上号
  assert.match(sectionLabel({ name: 'harness:identity' }), /harness:identity/)
})

test('sectionLabel 覆盖 @ 引用约定与下划线形式的真实工具名', () => {
  const source = readClient()
  const labels = source.match(/const SECTION_LABELS = \{[\s\S]*?\n    \}/)
  const labelFn = source.match(/function sectionLabel[\s\S]*?\n    \}/)
  assert.ok(labels && labelFn, '未能提取 SECTION_LABELS / sectionLabel')

  // eslint-disable-next-line no-new-func
  const { sectionLabel } = new Function(`${labels[0]}\n${labelFn[0]}\nreturn { sectionLabel }`)()

  // FILE_REFERENCE_PROMPT 注册为 context:file-reference（order 900，工具说明之前）。
  // 它是“@ 引用怎么解析”的唯一说明，必须有中文名，否则下拉框里只有裸标识。
  assert.match(sectionLabel({ name: 'context:file-reference' }), /@ 引用/)
  assert.match(sectionLabel({ name: 'context:file-reference' }), /context:file-reference/)

  // dsh-tool-web 注册的是 tool:web_search / tool:web_fetch（下划线），
  // 早期标签表写成连字符，导致这两段长期退化成裸名。
  assert.match(sectionLabel({ name: 'tool:web_search' }), /联网搜索/)
  assert.match(sectionLabel({ name: 'tool:web_fetch' }), /网页抓取/)

  // 每个 MCP 服务以 mcp:<服务名> 动态注册，名称无法穷举，靠前缀兜底。
  assert.match(sectionLabel({ name: 'mcp:filesystem' }), /MCP 服务说明/)
  assert.match(sectionLabel({ name: 'mcp:filesystem' }), /mcp:filesystem/)

  // mcp-resource-servers 是连字符开头的固定段落（dsh-mcp-resources），
  // mcp: 前缀兜底只认冒号，兜不住它，必须单独收录。
  assert.match(sectionLabel({ name: 'mcp-resource-servers' }), /MCP 资源服务说明/)
})

test('存量配置指向的段落不在列表中时仍保留该选项', () => {
  const source = readClient()
  // 预设切换后，规则指向的 section 可能暂时不存在；此时绝不能让下拉框空白，
  // 否则用户会以为配置丢了。
  assert.match(source, /当前配置，未出现在段落列表中/)
  assert.match(source, /__current__/)
})

test('下拉框提供清空选项', () => {
  const source = readClient()
  assert.match(source, /value: ''\s*\},\s*'（请选择段落）'/)
})

/**
 * 回归：同一行内的字段必须顶部对齐，说明文字不得塞进字段内部。
 *
 * 背景：曾经把「选择段落」的说明文字放在右侧 spe-field 里，而 .spe-row 用的是
 * align-items:flex-end。右侧比左侧多一行文字，底部对齐就把右侧下拉框顶高，
 * 与左侧「定位方式」下拉框错位——视觉上明显不齐。
 *
 * 修法有两层，缺一不可：
 *   1. .spe-row 改为 align-items:flex-start（顶部对齐，任何高度差都不再错位）
 *   2. 说明文字移出 spe-field，放到整行下方独立渲染
 */

test('spe-row 使用顶部对齐，避免高度不同的字段错位', () => {
  const source = readClient()
  const rowRule = source.match(/\.spe-row\{([^}]*)\}/)
  assert.ok(rowRule, '应存在 .spe-row 规则')
  assert.match(rowRule[1], /align-items:flex-start/,
    '.spe-row 必须顶部对齐；flex-end 会在字段高度不同时造成错位')
  assert.doesNotMatch(rowRule[1], /align-items:flex-end/)
})

test('选择段落的说明文字不在字段内部', () => {
  const source = readClient()

  // 旧写法：spe-field 内部塞一个行内 span hint
  assert.doesNotMatch(source, /react\.createElement\('span', \{ className: 'spe-hint' \},/,
    '不应再用行内 span 承载说明文字')

  // 新写法：块级说明，紧跟整行之后
  assert.match(source, /className: 'spe-hint spe-hint-block'/,
    '说明文字应作为独立块渲染')
})

test('spe-label 有固定行高，保证两侧标签基线一致', () => {
  const source = readClient()
  const labelRule = source.match(/\.spe-label\{([^}]*)\}/)
  assert.ok(labelRule, '应存在 .spe-label 规则')
  assert.match(labelRule[1], /line-height:16px/,
    '标签需要固定行高，否则两侧标签高度不同也会导致控件错位')
})

/**
 * 回归：段落查询的匹配方式必须在前后端保持一致。
 *
 * 前端从 QUERY_OPTIONS 渲染下拉框，后端 core.js 的 QUERY_MODES 决定实际
 * 支持哪些模式。两边漂移的后果是静默的——用户能选到一个后端不认识的模式，
 * 后端按 auto 处理，界面却显示"按关键词"，排查时完全看不出来。
 */
test('QUERY_OPTIONS 覆盖 core.js 的 QUERY_MODES', async () => {
  const { QUERY_MODES } = await import('../lib/core.js')
  const source = readClient()

  const block = source.match(/const QUERY_OPTIONS = \[[\s\S]*?\n    \]/)
  assert.ok(block, 'client.js 必须定义 QUERY_OPTIONS')

  const values = [...block[0].matchAll(/value:\s*'([^']+)'/g)].map((item) => item[1])
  assert.deepEqual([...values].sort(), [...QUERY_MODES].sort(),
    '前端可选的匹配方式必须与 core.js 支持的一致')
})

test('client.js 通过 locate 方法查询，且不把查询结果写进配置', () => {
  const source = readClient()
  assert.match(source, /rpcCall\(\s*'locate'/, '前端必须调用 locate 方法')
  // 查询是只读操作：locate 的响应不能直接变成 save 的入参。
  assert.doesNotMatch(source, /rpcCall\(\s*'save'[\s\S]{0,80}queryResult/,
    '查询结果不应进入保存流程')
})

test('查询请求带上模式、大小写与整词开关', () => {
  const source = readClient()
  for (const field of ['text:', 'mode:', 'caseSensitive:', 'wholeWord:']) {
    assert.match(source, new RegExp(field), `locate 请求缺少字段 ${field}`)
  }
})
