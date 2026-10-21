import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ACTION_KINDS,
  CUSTOM_SECTION_PREFIX,
  MATCH_KINDS,
  ORDER_ANCHORS,
  POSITIONS,
  POSITION_ORDERS,
  applyActionToText,
  applyRules,
  asBool,
  asNumber,
  asText,
  defaultConfig,
  findUnknownVariables,
  interpolateLenient,
  matchesSection,
  normalizeAction,
  normalizeConfig,
  normalizeMatch,
  normalizeReach,
  normalizeRule,
  normalizeSection,
  renderSections,
  ruleAppliesTo,
  stableSortByOrder,
} from '../lib/core.js'

/** 一份贴近真实 assembly 的 section 列表（顺序与官方一致）。 */
function sampleSections() {
  return [
    { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
    { name: 'deployment:persona-prefix', text: 'You are a coding agent powered by the {{model}} model.' },
    { name: 'tool-bash', text: 'Check the [exit code: N] marker on every bash result.' },
    { name: 'deployment:persona-suffix', text: 'Remember: All internal thinking and responses MUST be in Chinese.' },
  ]
}

test('asText 处理各种类型', () => {
  assert.equal(asText('x'), 'x')
  assert.equal(asText(undefined), '')
  assert.equal(asText(null), '')
  assert.equal(asText(12), '12')
})

test('asBool 正确识别字符串形式的布尔值', () => {
  assert.equal(asBool(true), true)
  assert.equal(asBool('true'), true)
  assert.equal(asBool('1'), true)
  assert.equal(asBool('yes'), true)
  // 关键回归点：字符串 "false" 不能被当成真值。
  assert.equal(asBool('false'), false)
  assert.equal(asBool('0'), false)
  assert.equal(asBool('off'), false)
  assert.equal(asBool(''), false)
  assert.equal(asBool(undefined, true), true)
  assert.equal(asBool('nonsense', true), true)
})

test('asNumber 只接受有限数字', () => {
  assert.equal(asNumber(3), 3)
  assert.equal(asNumber('3.5'), 3.5)
  assert.equal(asNumber('abc'), undefined)
  assert.equal(asNumber(NaN), undefined)
  assert.equal(asNumber(Infinity), undefined)
  assert.equal(asNumber(undefined, 7), 7)
})

test('normalizeMatch 归一化各种选择器', () => {
  assert.deepEqual(normalizeMatch({ kind: 'all' }).selector, { kind: 'all' })
  assert.deepEqual(normalizeMatch({ kind: 'name', name: 'tool-bash' }).selector, {
    kind: 'name',
    name: 'tool-bash',
  })
  assert.deepEqual(normalizeMatch({ kind: 'prefix', prefix: 'tool-' }).selector, {
    kind: 'prefix',
    prefix: 'tool-',
  })
  assert.deepEqual(normalizeMatch({ kind: 'text', contains: 'exit code' }).selector, {
    kind: 'text',
    contains: 'exit code',
    caseSensitive: false,
  })
})

test('normalizeMatch 对空值退化并给出诊断', () => {
  const name = normalizeMatch({ kind: 'name', name: '   ' })
  assert.deepEqual(name.selector, { kind: 'all' })
  assert.match(name.problem, /match\.name 为空/)

  const prefix = normalizeMatch({ kind: 'prefix', prefix: '' })
  assert.equal(prefix.selector.kind, 'all')
  assert.ok(prefix.problem)

  const text = normalizeMatch({ kind: 'text', contains: '' })
  assert.equal(text.selector.kind, 'all')
  assert.ok(text.problem)
})

test('normalizeMatch 拒绝非法正则并退化', () => {
  const result = normalizeMatch({ kind: 'regex', pattern: '([a-z' })
  assert.deepEqual(result.selector, { kind: 'all' })
  assert.match(result.problem, /不是合法正则/)
})

test('normalizeMatch 接受合法正则', () => {
  const result = normalizeMatch({ kind: 'regex', pattern: 'exit\\s+code', flags: 'i' })
  assert.deepEqual(result.selector, { kind: 'regex', pattern: 'exit\\s+code', flags: 'i' })
  assert.equal(result.problem, undefined)
})

test('normalizeMatch 遇到未知 kind 时退化', () => {
  const result = normalizeMatch({ kind: 'whatever' })
  assert.deepEqual(result.selector, { kind: 'all' })
  assert.match(result.problem, /未知的 match\.kind/)
})

test('normalizeAction 归一化各类动作', () => {
  assert.deepEqual(normalizeAction({ kind: 'remove' }).action, { kind: 'remove' })
  assert.deepEqual(normalizeAction({ kind: 'setText', text: 'hi' }).action, {
    kind: 'setText',
    text: 'hi',
  })
  assert.deepEqual(normalizeAction({ kind: 'append', text: 'tail' }).action, {
    kind: 'append',
    text: 'tail',
  })
  assert.deepEqual(normalizeAction({ kind: 'prepend', text: 'head' }).action, {
    kind: 'prepend',
    text: 'head',
  })
  assert.deepEqual(normalizeAction({ kind: 'replaceText', find: 'a', replace: 'b' }).action, {
    kind: 'replaceText',
    find: 'a',
    replace: 'b',
    all: true,
  })
})

test('normalizeAction 拒绝缺字段的动作', () => {
  assert.equal(normalizeAction({ kind: 'replaceText', find: '' }).action, null)
  assert.equal(normalizeAction({ kind: 'append', text: '' }).action, null)
  assert.equal(normalizeAction({}).action, null)
  assert.equal(normalizeAction({ kind: 'nope' }).action, null)
})

test('normalizeReach 归一化生效范围', () => {
  assert.deepEqual(normalizeReach(undefined).reach, { mode: 'all' })
  assert.deepEqual(normalizeReach({ mode: 'presets', ids: ['standard-zh'] }).reach, {
    mode: 'presets',
    ids: ['standard-zh'],
  })
  // 去重
  assert.deepEqual(normalizeReach({ mode: 'sessions', ids: ['a', 'a', 'b'] }).reach, {
    mode: 'sessions',
    ids: ['a', 'b'],
  })
})

test('normalizeReach 对空 id 列表退化并诊断', () => {
  const result = normalizeReach({ mode: 'presets', ids: [] })
  assert.deepEqual(result.reach, { mode: 'all' })
  assert.match(result.problem, /没有给出任何 id/)
})

test('normalizeRule 标记无效规则但不抛错', () => {
  const invalid = normalizeRule({ id: 'r1', match: { kind: 'name', name: 'x' }, action: { kind: 'append', text: '' } }, 0)
  assert.equal(invalid.valid, false)
  assert.equal(invalid.action, null)
  assert.ok(invalid.problems.length > 0)

  const valid = normalizeRule(
    { id: 'r2', match: { kind: 'name', name: 'x' }, action: { kind: 'append', text: 'ok' } },
    1,
  )
  assert.equal(valid.valid, true)
  assert.equal(valid.enabled, true)
})

test('normalizeRule 在缺 id 时生成稳定兜底 id', () => {
  const rule = normalizeRule({}, 4)
  assert.equal(rule.id, 'rule-5')
})

test('normalizeSection 生成带命名空间前缀与 id 的稳定名字', () => {
  const section = normalizeSection({ text: 'hello' }, 0)
  assert.equal(section.valid, true)
  assert.equal(section.id, 'section-1')
  assert.equal(section.name, `${CUSTOM_SECTION_PREFIX}001-section-1`)

  // id 出现在名字里：删除其它段落时，这一条的名字不会因为序号变化而漂移。
  const named = normalizeSection({ id: 'tone', text: 'hello', name: '我的段落' }, 11)
  assert.equal(named.name, `${CUSTOM_SECTION_PREFIX}012-tone`)
})

test('normalizeSection 的名字不含非 ASCII 字符', () => {
  // 回归点：中文 name 曾被整体替换成 '--'，生成畸形 section 名。
  const section = normalizeSection({ id: 'x', text: 'hello', name: '我的段落' }, 0)
  assert.equal(section.name, `${CUSTOM_SECTION_PREFIX}001-x`)
  assert.doesNotMatch(section.name, /--$/)

  const symbols = normalizeSection({ id: 'y', text: 'hello', name: '***' }, 0)
  assert.doesNotMatch(symbols.name, /--$/)
})

test('normalizeSection 删除中间段落后剩余段落名字不变', () => {
  // 用户场景：先保存 A/B 两段，再删除 A，只剩 B。
  const before = normalizeSection({ id: 'B', text: 'b' }, 1)
  const after = normalizeSection({ id: 'B', text: 'b' }, 0)
  // id 相同即名字相同——即使 index 因删除前一条而改变，也不会触发无效的重注册。
  // （序号用于同 order 下的稳定排序，不会因 id 漂移而变化。）
  assert.ok(before.name.endsWith('-B'))
  assert.ok(after.name.endsWith('-B'))
})

test('normalizeSection 对空文本标记无效', () => {
  const section = normalizeSection({ text: '   ' }, 0)
  assert.equal(section.valid, false)
  assert.ok(section.problems.some((item) => item.includes('段落内容为空')))
})

test('normalizeSection 默认位置为 after-persona', () => {
  const section = normalizeSection({ text: 'x' }, 0)
  assert.equal(section.position, 'after-persona')
  assert.equal(section.order, POSITION_ORDERS['after-persona'])
})

test('normalizeSection 显式 order 优先于 position', () => {
  const section = normalizeSection({ text: 'x', position: 'end', order: 42 }, 0)
  assert.equal(section.order, 42)
  assert.equal(section.position, 'custom')
})

test('normalizeSection 遇到未知 position 时回退并诊断', () => {
  const section = normalizeSection({ text: 'x', position: 'nowhere' }, 0)
  assert.equal(section.order, POSITION_ORDERS['after-persona'])
  assert.ok(section.problems.some((item) => item.includes('未知的 position')))
})

test('normalizeConfig 汇总诊断并去掉重复 id', () => {
  const config = normalizeConfig({
    rules: [
      { id: 'dup', match: { kind: 'all' }, action: { kind: 'append', text: 'a' } },
      { id: 'dup', match: { kind: 'all' }, action: { kind: 'append', text: 'b' } },
      { id: 'bad', match: { kind: 'all' }, action: { kind: 'append', text: '' } },
    ],
    appendSections: [{ id: 's1', text: 'x' }, { id: 's1', text: 'y' }],
  })

  assert.equal(config.rules.length, 2)
  assert.equal(config.appendSections.length, 1)
  assert.ok(config.diagnostics.some((item) => item.includes('重复')))
  assert.ok(config.diagnostics.some((item) => item.includes('无效')))
})

test('normalizeConfig 对空输入给出安全默认值', () => {
  const config = normalizeConfig(undefined)
  assert.equal(config.enabled, true)
  assert.deepEqual(config.rules, [])
  assert.deepEqual(config.appendSections, [])
  assert.deepEqual(config.diagnostics, [])
})

test('matchesSection 覆盖全部匹配方式', () => {
  const section = { name: 'tool-bash', text: 'Check the exit code marker.' }

  assert.equal(matchesSection(section, { kind: 'all' }), true)
  assert.equal(matchesSection(section, { kind: 'name', name: 'tool-bash' }), true)
  assert.equal(matchesSection(section, { kind: 'name', name: 'tool-web' }), false)
  assert.equal(matchesSection(section, { kind: 'prefix', prefix: 'tool-' }), true)
  assert.equal(matchesSection(section, { kind: 'prefix', prefix: 'web-' }), false)
  assert.equal(matchesSection(section, { kind: 'text', contains: 'EXIT CODE', caseSensitive: false }), true)
  assert.equal(matchesSection(section, { kind: 'text', contains: 'EXIT CODE', caseSensitive: true }), false)
  assert.equal(matchesSection(section, { kind: 'regex', pattern: 'exit\\s+code', flags: 'i' }), true)
  assert.equal(matchesSection(section, { kind: 'regex', pattern: 'nomatch' }), false)
})

test('matchesSection 对非法正则返回 false 而不是抛错', () => {
  const section = { name: 'x', text: 'y' }
  assert.equal(matchesSection(section, { kind: 'regex', pattern: '([' }), false)
})

test('applyActionToText 处理全部动作', () => {
  assert.deepEqual(applyActionToText('abc', { kind: 'setText', text: 'xyz' }), {
    text: 'xyz',
    removed: false,
    changed: true,
  })
  assert.deepEqual(applyActionToText('abc', { kind: 'prepend', text: '>' }), {
    text: '>abc',
    removed: false,
    changed: true,
  })
  assert.deepEqual(applyActionToText('abc', { kind: 'append', text: '<' }), {
    text: 'abc<',
    removed: false,
    changed: true,
  })
  assert.deepEqual(applyActionToText('abc', { kind: 'remove' }), {
    text: '',
    removed: true,
    changed: true,
  })
})

test('replaceText 全量替换与单次替换', () => {
  assert.equal(applyActionToText('a-a-a', { kind: 'replaceText', find: 'a', replace: 'b', all: true }).text, 'b-b-b')
  assert.equal(applyActionToText('a-a-a', { kind: 'replaceText', find: 'a', replace: 'b', all: false }).text, 'b-a-a')
})

test('replaceText 不把替换内容当成正则模板', () => {
  // 用 split/join 实现，所以 $1 必须原样保留。
  const result = applyActionToText('price: X', { kind: 'replaceText', find: 'X', replace: '$1 100', all: true })
  assert.equal(result.text, 'price: $1 100')
})

test('replaceText 未命中时 changed 为 false', () => {
  const result = applyActionToText('abc', { kind: 'replaceText', find: 'zzz', replace: 'y', all: true })
  assert.equal(result.text, 'abc')
  assert.equal(result.changed, false)
})

test('applyRules 按规则改写目标段落', () => {
  const config = normalizeConfig({
    rules: [
      {
        id: 'rename-identity',
        match: { kind: 'name', name: 'harness:identity' },
        action: { kind: 'setText', text: 'You are a custom agent.' },
      },
    ],
  })

  const result = applyRules(sampleSections(), config)
  const identity = result.sections.find((section) => section.name === 'harness:identity')
  assert.equal(identity.text, 'You are a custom agent.')
  assert.equal(result.appliedRules, 1)
  assert.equal(result.ruleResults[0].status, 'applied')
})

test('applyRules 删除整段', () => {
  const config = normalizeConfig({
    rules: [{ id: 'drop', match: { kind: 'name', name: 'tool-bash' }, action: { kind: 'remove' } }],
  })

  const result = applyRules(sampleSections(), config)
  assert.equal(result.sections.some((section) => section.name === 'tool-bash'), false)
})

test('applyRules 报告未命中的规则', () => {
  const config = normalizeConfig({
    rules: [
      {
        id: 'miss',
        match: { kind: 'name', name: 'does-not-exist' },
        action: { kind: 'append', text: 'x' },
      },
    ],
  })

  const result = applyRules(sampleSections(), config)
  assert.equal(result.ruleResults[0].status, 'no-match')
  assert.equal(result.appliedRules, 0)
})

test('applyRules 跳过禁用与无效规则', () => {
  const config = normalizeConfig({
    rules: [
      { id: 'off', enabled: false, match: { kind: 'all' }, action: { kind: 'append', text: 'x' } },
      { id: 'bad', match: { kind: 'all' }, action: { kind: 'append', text: '' } },
    ],
  })

  const result = applyRules(sampleSections(), config)
  assert.equal(result.ruleResults[0].status, 'disabled')
  assert.equal(result.ruleResults[1].status, 'invalid')
})

test('applyRules 在总开关关闭时不改动内容', () => {
  const config = normalizeConfig({
    enabled: false,
    rules: [{ id: 'r', match: { kind: 'all' }, action: { kind: 'append', text: 'x' } }],
  })

  const result = applyRules(sampleSections(), config)
  assert.equal(result.disabled, true)
  assert.equal(result.sections.length, sampleSections().length)
  assert.equal(result.sections[0].text, sampleSections()[0].text)
})

test('applyRules 不修改入参', () => {
  const sections = sampleSections()
  const snapshot = JSON.parse(JSON.stringify(sections))
  const config = normalizeConfig({
    rules: [{ id: 'r', match: { kind: 'name', name: 'harness:identity' }, action: { kind: 'remove' } }],
  })

  applyRules(sections, config)
  assert.deepEqual(sections, snapshot)
})

test('applyRules 保留 interpolate 标记', () => {
  const sections = [
    { name: 'a', text: 'literal {{x}}', interpolate: false },
  ]
  const config = normalizeConfig({
    rules: [{ id: 'r', match: { kind: 'name', name: 'a' }, action: { kind: 'append', text: ' tail' } }],
  })

  const result = applyRules(sections, config)
  assert.equal(result.sections[0].interpolate, false)
})

test('applyRules 默认追加自定义段落', () => {
  const config = normalizeConfig({ appendSections: [{ id: 's', text: 'Always be concise.' }] })
  const result = applyRules(sampleSections(), config)
  const appended = result.sections.find((section) => section.text === 'Always be concise.')
  assert.ok(appended)
  assert.ok(appended.name.startsWith(CUSTOM_SECTION_PREFIX))
})

test('applyRules 传 includeAppended:false 时不追加自定义段落', () => {
  const config = normalizeConfig({ appendSections: [{ id: 's', text: 'Always be concise.' }] })
  const result = applyRules(sampleSections(), config, {}, { includeAppended: false })
  assert.equal(result.sections.some((section) => section.text === 'Always be concise.'), false)
})

test('applyRules 按 applyTo 过滤不匹配的预设', () => {
  const config = normalizeConfig({
    rules: [
      {
        id: 'only-standard-zh',
        match: { kind: 'name', name: 'harness:identity' },
        action: { kind: 'setText', text: 'custom' },
        applyTo: { mode: 'presets', ids: ['standard-zh'] },
      },
    ],
  })

  const matched = applyRules(sampleSections(), config, { presetId: 'standard-zh' })
  assert.equal(matched.ruleResults[0].status, 'applied')

  const other = applyRules(sampleSections(), config, { presetId: 'code' })
  assert.equal(other.ruleResults[0].status, 'out-of-scope')
  assert.equal(other.sections[0].text, 'You are an AI agent powered by DeepSeek Harness.')
})

test('ruleAppliesTo 在无法解析预设 id 时放行', () => {
  const rule = { applyTo: { mode: 'presets', ids: ['standard-zh'] } }
  assert.equal(ruleAppliesTo(rule, { presetId: null }), true)
  assert.equal(ruleAppliesTo(rule, {}), true)
  assert.equal(ruleAppliesTo(rule, { presetId: 'standard-zh' }), true)
  assert.equal(ruleAppliesTo(rule, { presetId: 'code' }), false)
})

test('ruleAppliesTo 支持会话维度', () => {
  const rule = { applyTo: { mode: 'sessions', ids: ['s1'] } }
  assert.equal(ruleAppliesTo(rule, { sessionId: 's1' }), true)
  assert.equal(ruleAppliesTo(rule, { sessionId: 's2' }), false)
})

test('stableSortByOrder 保持无 order 段落的相对顺序', () => {
  const sections = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]
  const sorted = stableSortByOrder(sections)
  assert.deepEqual(sorted.map((item) => item.name), ['a', 'b', 'c'])
})

test('stableSortByOrder 把带 order 的段落排到正确位置', () => {
  const sections = [
    { name: 'a' },
    { name: 'inserted', order: 5 },
    { name: 'b' },
  ]
  const sorted = stableSortByOrder(sections)
  // 没有 order 的保持原位，有 order 的按数值参与排序。
  assert.deepEqual(sorted.map((item) => item.name), ['a', 'inserted', 'b'])
})

test('stableSortByOrder 对空输入安全', () => {
  assert.deepEqual(stableSortByOrder(undefined), [])
  assert.deepEqual(stableSortByOrder([]), [])
})

test('renderSections 用空行连接非空段落', () => {
  const text = renderSections([{ name: 'a', text: 'one' }, { name: 'b', text: 'two' }])
  assert.equal(text, 'one\n\ntwo')
})

test('renderSections 丢弃空段落', () => {
  const text = renderSections([
    { name: 'a', text: 'one' },
    { name: 'empty', text: '' },
    { name: 'b', text: 'two' },
  ])
  assert.equal(text, 'one\n\ntwo')
})

test('renderSections 对 interpolate:false 保留字面量', () => {
  const text = renderSections([{ name: 'a', text: 'keep {{model}}', interpolate: false }], { model: 'x' })
  assert.equal(text, 'keep {{model}}')
})

test('interpolateLenient 替换已知变量并保留未知变量', () => {
  const text = interpolateLenient('model={{model}} other={{unknown}}', { model: 'v4' })
  assert.equal(text, 'model=v4 other={{unknown}}')
})

test('findUnknownVariables 找出未知变量并去重排序', () => {
  const unknown = findUnknownVariables('{{b}} {{a}} {{b}} {{model}}', { model: 'x' })
  assert.deepEqual(unknown, ['a', 'b'])
})

test('findUnknownVariables 忽略非规范变量写法', () => {
  const unknown = findUnknownVariables('{{Bad}} {{}} {{ok}}', { ok: '1' })
  assert.deepEqual(unknown, [])
})

test('defaultConfig 返回干净的空配置', () => {
  const config = defaultConfig()
  assert.deepEqual(config, { enabled: true, rules: [], appendSections: [] })
  // 每次调用必须是新对象，避免调用方改动污染默认值。
  assert.notEqual(defaultConfig(), config)
})

test('常量表与实际能力一致', () => {
  assert.ok(MATCH_KINDS.includes('all'))
  assert.ok(ACTION_KINDS.includes('replaceText'))
  assert.ok(POSITIONS.includes('after-persona'))
  // 位置映射必须落在已知锚点之间，避免拼写错误导致排序异常。
  assert.equal(POSITION_ORDERS['before-tools'], ORDER_ANCHORS.FILE_REFERENCE - 1)
  assert.equal(POSITION_ORDERS['after-tools'], ORDER_ANCHORS.MCP_SERVERS + 10)
})

test('完整场景：替换身份句 + 追加规则 + 按预设限定', () => {
  const config = normalizeConfig({
    rules: [
      {
        id: 'identity',
        match: { kind: 'name', name: 'harness:identity' },
        action: {
          kind: 'replaceText',
          find: 'You are an AI agent powered by DeepSeek Harness.',
          replace: 'You are Aria, an internal engineering assistant.',
        },
      },
    ],
    appendSections: [
      { id: 'tone', text: 'Always answer in Chinese.', position: 'after-persona' },
    ],
  })

  const result = applyRules(sampleSections(), config, { presetId: 'standard-zh' })
  const rendered = renderSections(result.sections, { model: 'deepseek-v4.1-flash' })

  assert.match(rendered, /You are Aria, an internal engineering assistant\./)
  assert.match(rendered, /Always answer in Chinese\./)
  assert.match(rendered, /powered by the deepseek-v4\.1-flash model/)
  assert.doesNotMatch(rendered, /You are an AI agent powered by DeepSeek Harness\./)
})
