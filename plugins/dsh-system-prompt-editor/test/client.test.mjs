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
  const match = source.match(/inject:\n((?:\s*-\s*\S+\n)+)/)
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
