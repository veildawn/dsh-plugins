/**
 * 前端行为测试：段落查询定位。
 *
 * 与 client.test.mjs（源码契约与纯函数往返）不同，这里用 test/react-harness.mjs
 * 真正挂载设置页组件，模拟用户输入，验证「输入 → locate 请求 → 渲染结果 →
 * 一键落成规则」整条链路。查询定位是交互型功能，只做字符串匹配挡不住
 * 「请求参数拼错」「结果没渲染」「点按钮没反应」这类问题。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { byClass, byTag, findAll, loadClientModule, mount, textOf } from './react-harness.mjs'

/** 一份 describe 返回的最小视图。 */
function describeView(overrides = {}) {
  return {
    ok: true,
    config: { enabled: true, rules: [], appendSections: [] },
    baseline: 'You are an AI agent powered by DeepSeek Harness.',
    effective: 'You are an AI agent powered by DeepSeek Harness.',
    variables: { model: 'test-model' },
    sections: [
      { name: 'harness:identity', length: 48, preview: 'You are an AI agent powered by DeepSeek Harness.' },
      { name: 'app:web-surface', length: 700, preview: 'You are interacting with the user through the DeepSeek Harness Web GUI…' },
      { name: 'tool:bash', length: 120, preview: 'Check the [exit code: N] marker…' },
    ],
    ruleResults: [],
    diagnostics: [],
    failure: null,
    storageKind: 'file',
    settingsFile: '/tmp/x.json',
    ...overrides,
  }
}

/** 一条 locate 命中结果（对应「Web GUI」）。 */
function locateHit(name = 'app:web-surface') {
  return {
    ok: true,
    query: { text: 'Web GUI', mode: 'auto', caseSensitive: false, wholeWord: false },
    problem: null,
    strategy: 'phrase',
    matches: [
      {
        name,
        index: 2,
        length: 700,
        hits: 2,
        omitted: 0,
        range: { from: 60, to: 90 },
        custom: false,
        order: null,
        snippets: [
          {
            segments: [
              { text: '…through the DeepSeek Harness ', hit: false },
              { text: 'Web GUI', hit: true },
              { text: ' whose URL the runtime context names…', hit: false },
            ],
            leading: true,
            trailing: true,
            hitText: 'Web GUI',
          },
        ],
      },
    ],
    matchedSections: 1,
    totalSections: 3,
    totalSpans: 2,
    message: `共 1 个段落命中「Web GUI」（按短语匹配），合计 2 处。`,
  }
}

/**
 * 建一个记录调用的 rpcCall，并按方法返回预设结果。
 * @param {{locate?: Function, describe?: object}} options - 各方法的返回值。
 * @returns {{rpcCall: Function, calls: object[]}} 桩与调用记录。
 */
function fakeRpc(options = {}) {
  const calls = []
  const rpcCall = async (method, payload) => {
    calls.push({ method, payload })
    if (method === 'describe') return options.describe || describeView()
    if (method === 'locate') {
      if (typeof options.locate === 'function') return options.locate(payload)
      return options.locate || locateHit()
    }
    if (method === 'preview' || method === 'save') return options.describe || describeView()
    if (method === 'reset') return { view: options.describe || describeView() }
    throw new Error(`未预期的方法 ${method}`)
  }
  return { rpcCall, calls }
}

/** 找到查询输入框。 */
function queryInput(tree) {
  const found = findAll(tree, (node) => node.type === 'input'
    && typeof node.props?.placeholder === 'string'
    && node.props.placeholder.includes('Web GUI'))
  assert.equal(found.length, 1, '应当只有一个查询输入框')
  return found[0]
}

/** 按可见文字找按钮。 */
function buttonByText(tree, text) {
  const found = byTag(tree, 'button').filter((node) => {
    const children = node.props.children
    const flat = Array.isArray(children) ? children.join('') : children
    return typeof flat === 'string' && flat.includes(text)
  })
  return found
}

test('设置页渲染出「段落查询定位」卡片与查询输入框', async () => {
  const { SystemPromptEditor } = loadClientModule()
  const { rpcCall } = fakeRpc()
  const handle = await mount(SystemPromptEditor, { rpcCall })

  const text = textOf(handle.tree)
  assert.match(text, /段落查询定位/, '必须有查询卡片')
  assert.match(text, /app:web-surface/, '说明文字应给出 Web GUI → app:web-surface 的例子')
  assert.ok(queryInput(handle.tree), '必须有查询输入框')
})

test('输入文字即自动发起 locate 请求，并带上查询条件', async () => {
  const { SystemPromptEditor } = loadClientModule()
  const { rpcCall, calls } = fakeRpc()
  const handle = await mount(SystemPromptEditor, { rpcCall })

  await handle.act(() => queryInput(handle.tree).props.onChange({ target: { value: 'Web GUI' } }))
  await handle.settle()

  const locate = calls.filter((call) => call.method === 'locate')
  assert.equal(locate.length, 1, '输入后应自动查询一次')
  assert.equal(locate[0].payload.query.text, 'Web GUI')
  assert.equal(locate[0].payload.query.mode, 'auto')
  assert.equal(locate[0].payload.query.caseSensitive, false)
  assert.equal(locate[0].payload.query.wholeWord, false)
})

test('查询结果展示命中的段落名、次数与高亮片段', async () => {
  const { SystemPromptEditor } = loadClientModule()
  const { rpcCall } = fakeRpc()
  const handle = await mount(SystemPromptEditor, { rpcCall })

  await handle.act(() => queryInput(handle.tree).props.onChange({ target: { value: 'Web GUI' } }))
  await handle.settle()

  const text = textOf(handle.tree)
  // 段落名要显示中文含义 + 原始名，用户才能既看懂又对得上配置。
  assert.match(text, /Web GUI 界面说明/)
  assert.match(text, /app:web-surface/)
  assert.match(text, /命中 2 处/)
  assert.match(text, /第 2 段/)
  assert.match(text, /共 1 个段落命中/)

  // 命中片段必须用 <mark> 渲染，而不是纯文本拼字符串。
  const marks = byTag(handle.tree, 'mark')
  assert.equal(marks.length, 1, '应有一段被高亮')
  assert.deepEqual(marks[0].props.children, ['Web GUI'])
})

test('查询为空时不发请求，清空后结果消失', async () => {
  const { SystemPromptEditor } = loadClientModule()
  const { rpcCall, calls } = fakeRpc()
  const handle = await mount(SystemPromptEditor, { rpcCall })

  await handle.act(() => queryInput(handle.tree).props.onChange({ target: { value: '   ' } }))
  await handle.settle()
  assert.equal(calls.filter((call) => call.method === 'locate').length, 0, '空查询不应发请求')

  await handle.act(() => queryInput(handle.tree).props.onChange({ target: { value: 'Web GUI' } }))
  await handle.settle()
  assert.equal(byClass(handle.tree, 'spe-result').length, 1)

  const clear = buttonByText(handle.tree, '清空')
  assert.equal(clear.length, 1)
  await handle.act(() => clear[0].props.onClick())
  await handle.settle()

  assert.equal(byClass(handle.tree, 'spe-result').length, 0, '清空后结果应消失')
})

test('没有命中时给出可操作的提示，而不是空白', async () => {
  const { SystemPromptEditor } = loadClientModule()
  const { rpcCall } = fakeRpc({
    locate: {
      ok: true,
      strategy: 'phrase',
      matches: [],
      matchedSections: 0,
      totalSpans: 0,
      message: '没有任何段落包含「绝对不存在的句子」。',
    },
  })
  const handle = await mount(SystemPromptEditor, { rpcCall })

  await handle.act(() => queryInput(handle.tree).props.onChange({ target: { value: '绝对不存在的句子' } }))
  await handle.settle()

  const text = textOf(handle.tree)
  assert.match(text, /没有任何段落包含/)
  assert.match(text, /整段长句常因为多了一个标点就查不到/, '应引导用户改用关键词')
  assert.equal(byClass(handle.tree, 'spe-result').length, 0)
})

test('查询失败只影响结果区，页面其余部分照常可用', async () => {
  const { SystemPromptEditor } = loadClientModule()
  const { rpcCall } = fakeRpc({
    locate: () => {
      throw new Error('连接服务尚未就绪')
    },
  })
  const handle = await mount(SystemPromptEditor, { rpcCall })

  await handle.act(() => queryInput(handle.tree).props.onChange({ target: { value: 'Web GUI' } }))
  await handle.settle()

  const text = textOf(handle.tree)
  assert.match(text, /连接服务尚未就绪/)
  // 保存按钮必须仍然可用：查询只是辅助功能，坏了不能连累保存。
  const save = buttonByText(handle.tree, '保存并生效')
  assert.equal(save.length, 1)
  assert.ok(!save[0].props.disabled, '保存按钮不应因为查询失败而禁用')
})

test('点击「定位到这条规则」会新建一条按名称定位的规则', async () => {
  const { SystemPromptEditor } = loadClientModule()
  const { rpcCall } = fakeRpc()
  const handle = await mount(SystemPromptEditor, { rpcCall })

  await handle.act(() => queryInput(handle.tree).props.onChange({ target: { value: 'Web GUI' } }))
  await handle.settle()

  const apply = buttonByText(handle.tree, '定位到这条规则')
  assert.equal(apply.length, 1, '结果里应有「定位到这条规则」按钮')
  await handle.act(() => apply[0].props.onClick())
  await handle.settle()

  const text = textOf(handle.tree)
  assert.match(text, /改写规则（1）/, '应新增一条规则')
  // 命中文字要预填成 replaceText 的查找原文，用户只需决定替换成什么。
  const textareas = byTag(handle.tree, 'textarea')
  assert.ok(
    textareas.some((node) => node.props.value === 'Web GUI'),
    '应把命中的文字填进「要查找的原文」',
  )
})

test('已有规则指向该段落后，点击「+ 再加一条规则」会再新建一条规则', async () => {
  const { SystemPromptEditor } = loadClientModule()
  const { rpcCall } = fakeRpc()
  const handle = await mount(SystemPromptEditor, { rpcCall })

  await handle.act(() => queryInput(handle.tree).props.onChange({ target: { value: 'Web GUI' } }))
  await handle.settle()

  // 第一次点击
  const applyFirst = buttonByText(handle.tree, '定位到这条规则')
  assert.equal(applyFirst.length, 1)
  await handle.act(() => applyFirst[0].props.onClick())
  await handle.settle()
  assert.match(textOf(handle.tree), /改写规则（1）/)

  // 此时按钮文案应更新为「+ 再加一条规则」
  const applySecond = buttonByText(handle.tree, '+ 再加一条规则')
  assert.equal(applySecond.length, 1, '已有规则时应显示「+ 再加一条规则」')

  // 第二次点击
  await handle.act(() => applySecond[0].props.onClick())
  await handle.settle()

  // 必须成功新增第二条规则，规则数从 1 变成 2
  assert.match(textOf(handle.tree), /改写规则（2）/, '再次点击必须成功新增第二条规则')
})

test('匹配方式切换后立刻用新方式重查', async () => {
  const { SystemPromptEditor } = loadClientModule()
  const { rpcCall, calls } = fakeRpc()
  const handle = await mount(SystemPromptEditor, { rpcCall })

  await handle.act(() => queryInput(handle.tree).props.onChange({ target: { value: 'Web GUI' } }))
  await handle.settle()

  const select = findAll(handle.tree, (node) => node.type === 'select'
    && (node.props.children || []).some?.((child) => child && child.props && child.props.value === 'terms'))
  assert.ok(select.length >= 1, '应有匹配方式下拉框')

  await handle.act(() => select[0].props.onChange({ target: { value: 'terms' } }))
  await handle.settle()

  const locate = calls.filter((call) => call.method === 'locate')
  assert.equal(locate.length, 2, '切换方式应触发重新查询')
  assert.equal(locate[1].payload.query.mode, 'terms')
})

test('区分大小写与整词匹配的开关会带进请求', async () => {
  const { SystemPromptEditor } = loadClientModule()
  const { rpcCall, calls } = fakeRpc()
  const handle = await mount(SystemPromptEditor, { rpcCall })

  await handle.act(() => queryInput(handle.tree).props.onChange({ target: { value: 'Web GUI' } }))
  await handle.settle()

  const checkboxes = findAll(handle.tree, (node) => node.type === 'input' && node.props.type === 'checkbox'
    && typeof node.props.onChange === 'function'
    && node.props.checked === false)
  assert.ok(checkboxes.length >= 2, '应有「区分大小写」「整词匹配」两个复选框')

  // 第一个是区分大小写，第二个是整词匹配（渲染顺序固定）。
  await handle.act(() => checkboxes[0].props.onChange({ target: { checked: true } }))
  await handle.settle()
  let last = calls.filter((call) => call.method === 'locate').at(-1)
  assert.equal(last.payload.query.caseSensitive, true)

  await handle.act(() => checkboxes[1].props.onChange({ target: { checked: true } }))
  await handle.settle()
  last = calls.filter((call) => call.method === 'locate').at(-1)
  assert.equal(last.payload.query.wholeWord, true)
})

test('连续输入时只采纳最后一次查询的结果', async () => {
  const { SystemPromptEditor } = loadClientModule()
  let resolveSlow = null
  let seq = 0
  const { rpcCall } = fakeRpc({
    locate: () => {
      seq += 1
      if (seq === 1) {
        // 第一次查询故意慢：它返回时输入框里已经是第二个词了。
        return new Promise((resolve) => {
          resolveSlow = () => resolve({
            ...locateHit('harness:identity'),
            message: '过期结果',
          })
        })
      }
      return locateHit('app:web-surface')
    },
  })
  const handle = await mount(SystemPromptEditor, { rpcCall })

  await handle.act(() => queryInput(handle.tree).props.onChange({ target: { value: 'Web' } }))
  await handle.act(() => queryInput(handle.tree).props.onChange({ target: { value: 'Web GUI' } }))
  await handle.settle()

  // 让慢请求此刻才返回：结果必须被丢弃，否则界面会闪回旧结果。
  if (resolveSlow) resolveSlow()
  await handle.settle()

  const text = textOf(handle.tree)
  assert.doesNotMatch(text, /过期结果/)
  assert.match(text, /Web GUI 界面说明/)
})

test('跨行命中时用原始文本（含换行）作为查找原文', async () => {
  const { SystemPromptEditor } = loadClientModule()
  const { rpcCall } = fakeRpc({
    locate: {
      ...locateHit(),
      matches: [{
        ...locateHit().matches[0],
        snippets: [{
          // 展示用的 hit 已把换行压成空格，但 hitText 保留原文换行。
          segments: [
            { text: '…', hit: false },
            { text: 'Web GUI whose URL', hit: true },
            { text: '…', hit: false },
          ],
          leading: true,
          trailing: true,
          hitText: 'Web GUI whose URL',
        }],
      }],
    },
  })
  const handle = await mount(SystemPromptEditor, { rpcCall })

  await handle.act(() => queryInput(handle.tree).props.onChange({ target: { value: 'Web GUI' } }))
  await handle.settle()

  const apply = buttonByText(handle.tree, '定位到这条规则')
  await handle.act(() => apply[0].props.onClick())
  await handle.settle()

  // 关键点：填进去的必须是 hitText，而不是把 segments 里的高亮段拼起来——
  // 后者在跨行场景下会被压成空格，写进规则就永远匹配不到原文。
  const textareas = byTag(handle.tree, 'textarea')
  assert.ok(
    textareas.some((node) => node.props.value === 'Web GUI whose URL'),
    '应使用服务端给的原始命中文本',
  )
})

test('查询结果卡片包含独立的段落名 code 块，便于无剪贴板权限时手动划选', async () => {
  const { SystemPromptEditor } = loadClientModule()
  const { rpcCall } = fakeRpc()
  const handle = await mount(SystemPromptEditor, { rpcCall })

  await handle.act(() => queryInput(handle.tree).props.onChange({ target: { value: 'Web GUI' } }))
  await handle.settle()

  const codes = byTag(handle.tree, 'code')
  assert.ok(codes.length >= 1, '应有 code 标签渲染原始段落名')
  const codeNode = codes.find((n) => (n.props.children || []).includes('app:web-surface'))
  assert.ok(codeNode, 'code 标签内容必须是原始段落名 app:web-surface')
  assert.equal(codeNode.props.className, 'spe-code')
})

test('复制段落名按钮在 Clipboard API 失败时能自动走 execCommand 兜底并反馈', async () => {
  const { SystemPromptEditor } = loadClientModule()
  const { rpcCall } = fakeRpc()

  // 模拟浏览器环境：没有 navigator.clipboard，但有 document.execCommand
  let copiedCommand = ''
  const fakeDoc = {
    createElement(tag) {
      return {
        value: '',
        style: {},
        setAttribute() {},
        focus() {},
        select() {},
      }
    },
    body: {
      appendChild(node) {
        copiedCommand = node.value
      },
      removeChild() {},
    },
    execCommand(cmd) {
      return cmd === 'copy'
    },
  }

  const prevDoc = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const prevNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  try {
    Object.defineProperty(globalThis, 'document', { value: fakeDoc, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true }) // 无 clipboard
    const handle = await mount(SystemPromptEditor, { rpcCall })

    await handle.act(() => queryInput(handle.tree).props.onChange({ target: { value: 'Web GUI' } }))
    await handle.settle()

    const copyBtn = buttonByText(handle.tree, '复制段落名')
    assert.equal(copyBtn.length, 1)

    await handle.act(() => copyBtn[0].props.onClick())
    await handle.settle()

    // 验证 execCommand 成功写入了段落名
    assert.equal(copiedCommand, 'app:web-surface')
    // 按钮即时变为「✓ 已复制」
    assert.ok(buttonByText(handle.tree, '✓ 已复制').length >= 1)
    // 状态栏包含成功提示
    assert.match(textOf(handle.tree), /已复制段落名：app:web-surface/)
  } finally {
    if (prevDoc) Object.defineProperty(globalThis, 'document', prevDoc)
    else delete globalThis.document
    if (prevNav) Object.defineProperty(globalThis, 'navigator', prevNav)
    else delete globalThis.navigator
  }
})

test('所有剪贴板通道均失败时，给出包含具体段落名的显式提示', async () => {
  const { SystemPromptEditor } = loadClientModule()
  const { rpcCall } = fakeRpc()

  const prevDoc = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const prevNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const prevWin = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let promptShown = ''
  try {
    delete globalThis.document
    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'window', {
      value: {
        prompt(msg, val) {
          promptShown = val
        },
      },
      configurable: true,
      writable: true,
    })

    const handle = await mount(SystemPromptEditor, { rpcCall })
    await handle.act(() => queryInput(handle.tree).props.onChange({ target: { value: 'Web GUI' } }))
    await handle.settle()

    const copyBtn = buttonByText(handle.tree, '复制段落名')
    await handle.act(() => copyBtn[0].props.onClick())
    await handle.settle()

    // 状态提示必须明确打印出段落名 app:web-surface，不再是空洞的“请手动复制”
    const text = textOf(handle.tree)
    assert.match(text, /未能自动写入剪贴板，段落名：app:web-surface/)
    // prompt 对话框应收到该段落名供一键复制
    assert.equal(promptShown, 'app:web-surface')
  } finally {
    if (prevDoc) Object.defineProperty(globalThis, 'document', prevDoc)
    else delete globalThis.document
    if (prevNav) Object.defineProperty(globalThis, 'navigator', prevNav)
    else delete globalThis.navigator
    if (prevWin) Object.defineProperty(globalThis, 'window', prevWin)
    else delete globalThis.window
  }
})
