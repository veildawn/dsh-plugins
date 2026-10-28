/**
 * 集成测试：用**真实的** `@deepseek-ai/dsh-system-prompt` 服务验证本插件。
 *
 * 这些断言覆盖纯函数测试无法保证的部分——插件注册的 waterfall 是否真的
 * 改写了官方组装结果、追加段落是否真的进入了 assembly、以及“为什么不能靠
 * 重新注册同名 section 来改写”这个核心设计前提。
 *
 * 若上游 `dsh-system-prompt` 的 API 发生变化，这里会最先失败。
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt, renderPrompt } from '@deepseek-ai/dsh-system-prompt'

import { RPC_CHANNEL, apply } from '../lib/index.js'

/** 建一个带真实 SystemPrompt 服务的上下文。 */
function createRuntime() {
  const ctx = new Context()
  const prompt = new SystemPrompt(ctx, {
    includeHarnessIdentity: true,
    includeRuntimeContext: false,
  })
  prompt.variable('model', () => 'test-model')
  return { ctx, prompt }
}

/**
 * 构造插件所需的最小 ctx 视图。
 *
 * 真实宿主会注入 connection/settings/logger；这里只提供本插件实际读取的字段，
 * 避免为了测试去模拟整个 Cordis 服务注册流程。
 */
function createPluginContext(ctx, prompt, options = {}) {
  const view = Object.create(ctx)
  view.systemPrompt = prompt
  view.connection = options.connection
  view.settings = options.settings
  view.logger = options.logger ?? { warn() {} }
  return view
}

test('插件能改写真实 harness:identity 段落', async () => {
  const { ctx, prompt } = createRuntime()
  const view = createPluginContext(ctx, prompt)

  apply(view, {
    enabled: true,
    settingsFile: path.join(os.tmpdir(), `spe-${process.pid}-a.json`),
    rules: [
      {
        id: 'rename',
        match: { kind: 'name', name: 'harness:identity' },
        action: { kind: 'setText', text: 'You are Aria.' },
      },
    ],
    appendSections: [],
  })

  const text = renderPrompt(await prompt.assemble({ scope: undefined }))
  assert.match(text, /You are Aria\./)
  assert.doesNotMatch(text, /You are an AI agent powered by DeepSeek Harness\./)
})

test('追加段落以正式 section 注册且只出现一次', async () => {
  const { ctx, prompt } = createRuntime()
  const view = createPluginContext(ctx, prompt)

  apply(view, {
    enabled: true,
    settingsFile: path.join(os.tmpdir(), `spe-${process.pid}-b.json`),
    rules: [],
    appendSections: [{ id: 'tone', enabled: true, text: 'Always be concise.', position: 'after-persona' }],
  })

  const text = renderPrompt(await prompt.assemble({ scope: undefined }))
  // 关键回归点：waterfall 必须用 includeAppended:false，否则这里会是 2。
  const occurrences = text.split('Always be concise.').length - 1
  assert.equal(occurrences, 1)
})

/**
 * `FILE_REFERENCE_PROMPT` 与 `@deepseek-ai/dsh-file-reference` 导出常量逐字一致。
 *
 * 这里刻意内联而不是 import：本包并不依赖 `dsh-file-reference`（它只是运行时
 * 可能存在的上游提供方），为了测试去加一条 peerDependency 会让所有未挂载
 * file-reference 的部署被迫安装它。
 */
const FILE_REFERENCE_PROMPT = 'Tokens prefixed with @ are paths the user explicitly referenced. Relative paths resolve from the workspace root; absolute paths identify files or directories on the host. A trailing slash marks a directory: list it when its contents matter. Anything else is a file: use the read tool when its contents are needed, and do not claim to have inspected it before reading. @"..." quotes a path containing spaces.'

test('能改写 @ 引用约定段落（context:file-reference）', async () => {
  const { ctx, prompt } = createRuntime()

  // 复刻 dsh-file-reference-local 的注册方式：section 名 context:file-reference，
  // order 取官方 FILE_REFERENCE 锚点（900，工具说明之前）。
  prompt.section({
    name: 'context:file-reference',
    order: prompt.getSectionOrder('FILE_REFERENCE'),
    text: FILE_REFERENCE_PROMPT,
  })

  const view = createPluginContext(ctx, prompt)
  const extra = 'A reference grants permission to read, not an instruction to modify.'

  apply(view, {
    enabled: true,
    settingsFile: path.join(os.tmpdir(), `spe-${process.pid}-fileref.json`),
    rules: [
      {
        id: 'enhance-file-reference',
        match: { kind: 'name', name: 'context:file-reference' },
        action: { kind: 'setText', text: `${FILE_REFERENCE_PROMPT}\n\n${extra}` },
      },
    ],
    appendSections: [],
  })

  const text = renderPrompt(await prompt.assemble({ scope: undefined }))
  assert.match(text, /A reference grants permission to read, not an instruction to modify\./)
  // 整段替换必须原样保留官方原文，而不是只留下新增的那句。
  assert.ok(text.includes(FILE_REFERENCE_PROMPT), '官方原文应原样保留')
})

test('追加段落排在角色设定之后', async () => {
  const { ctx, prompt } = createRuntime()
  const view = createPluginContext(ctx, prompt)

  apply(view, {
    enabled: true,
    settingsFile: path.join(os.tmpdir(), `spe-${process.pid}-c.json`),
    rules: [],
    appendSections: [{ id: 'tone', enabled: true, text: 'TAIL-MARKER', position: 'after-persona' }],
  })

  const assembled = await prompt.assemble({ scope: undefined })
  const names = assembled.sections.map((section) => section.name)
  const customIndex = names.findIndex((item) => item.startsWith('prompt-editor:custom:'))
  const personaIndex = names.indexOf('deployment:persona-prefix')

  assert.ok(customIndex >= 0, '追加段落应出现在 assembly 中')
  assert.ok(customIndex > personaIndex, '追加段落应排在角色设定之后')
})

test('总开关关闭时提示词完全恢复默认', async () => {
  const { ctx, prompt } = createRuntime()
  const view = createPluginContext(ctx, prompt)

  apply(view, {
    enabled: false,
    settingsFile: path.join(os.tmpdir(), `spe-${process.pid}-d.json`),
    rules: [
      { id: 'rename', match: { kind: 'name', name: 'harness:identity' }, action: { kind: 'setText', text: 'SHOULD NOT APPLY' } },
    ],
    appendSections: [{ id: 'x', enabled: true, text: 'SHOULD NOT APPEAR', position: 'after-persona' }],
  })

  const text = renderPrompt(await prompt.assemble({ scope: undefined }))
  assert.match(text, /You are an AI agent powered by DeepSeek Harness\./)
  assert.doesNotMatch(text, /SHOULD NOT APPLY/)
  assert.doesNotMatch(text, /SHOULD NOT APPEAR/)
})

test('全局重复注册同名 section 会抛错——这正是改写必须走 waterfall 的原因', async () => {
  const { prompt } = createRuntime()
  assert.throws(
    () => prompt.section({ name: 'harness:identity', order: -1000, text: 'duplicate' }),
    /already registered/,
  )
})

test('坏规则不会阻断其它规则，也不会让 assemble 失败', async () => {
  const { ctx, prompt } = createRuntime()
  const view = createPluginContext(ctx, prompt)

  apply(view, {
    enabled: true,
    settingsFile: path.join(os.tmpdir(), `spe-${process.pid}-e.json`),
    rules: [
      // 非法正则：归一化阶段退化为 all，仍会执行 append，但不应崩溃。
      { id: 'bad-regex', match: { kind: 'regex', pattern: '([a-z' }, action: { kind: 'append', text: ' X' } },
      // 缺 action.text：整条规则无效，应被跳过。
      { id: 'bad-action', match: { kind: 'name', name: 'harness:identity' }, action: { kind: 'append', text: '' } },
      // 正常规则：必须仍然生效。
      { id: 'good', match: { kind: 'name', name: 'deployment:persona-prefix' }, action: { kind: 'setText', text: 'GOOD RULE APPLIED' } },
    ],
    appendSections: [],
  })

  const text = renderPrompt(await prompt.assemble({ scope: undefined }))
  assert.match(text, /GOOD RULE APPLIED/)
})

test('RPC describe 返回基线与生效后文本', async () => {
  const { ctx, prompt } = createRuntime()
  let handler = null
  const view = createPluginContext(ctx, prompt, {
    connection: {
      rpc: {
        handle(channel, fn) {
          if (channel === RPC_CHANNEL) handler = fn
        },
      },
    },
  })

  apply(view, {
    enabled: true,
    settingsFile: path.join(os.tmpdir(), `spe-${process.pid}-f.json`),
    rules: [
      { id: 'rename', match: { kind: 'name', name: 'harness:identity' }, action: { kind: 'setText', text: 'You are Aria.' } },
    ],
    appendSections: [],
  })

  assert.equal(typeof handler, 'function', 'RPC handler 必须注册成功')
  const result = await handler('describe', {})
  assert.equal(result.ok, true)
  // 关键回归点：baseline 必须是**未被本插件改写**的官方原文，
  // 否则设置页的「系统默认」一栏就永远看不到真正默认的样子。
  assert.match(result.value.baseline, /powered by DeepSeek Harness/)
  assert.doesNotMatch(result.value.baseline, /You are Aria\./)
  assert.match(result.value.effective, /You are Aria\./)
})

test('RPC describe 的 baseline 不含插件追加的段落', async () => {
  const { ctx, prompt } = createRuntime()
  let handler = null
  const view = createPluginContext(ctx, prompt, {
    connection: {
      rpc: {
        handle(channel, fn) {
          if (channel === RPC_CHANNEL) handler = fn
        },
      },
    },
  })

  apply(view, {
    enabled: true,
    settingsFile: path.join(os.tmpdir(), `spe-${process.pid}-h.json`),
    rules: [],
    appendSections: [{ id: 'tone', enabled: true, text: 'CUSTOM-TAIL', position: 'after-persona' }],
  })

  const result = await handler('describe', {})
  // baseline 是纯官方默认，不应包含用户追加的段落。
  assert.doesNotMatch(result.value.baseline, /CUSTOM-TAIL/)
  // effective 是套用配置后的结果，必须包含它。
  assert.match(result.value.effective, /CUSTOM-TAIL/)
})

test('RPC save 落盘后立即读回新值，且 preview 不落盘', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spe-rpc-'))
  const settingsFile = path.join(dir, 'settings.json')
  try {
    const { ctx, prompt } = createRuntime()
    let handler = null
    const view = createPluginContext(ctx, prompt, {
      connection: {
        rpc: {
          handle(channel, fn) {
            if (channel === RPC_CHANNEL) handler = fn
          },
        },
      },
    })

    apply(view, { enabled: true, settingsFile, rules: [], appendSections: [] })

    // preview 不应写盘
    const previewed = await handler('preview', {
      config: {
        enabled: true,
        rules: [{ id: 'p', match: { kind: 'name', name: 'harness:identity' }, action: { kind: 'setText', text: 'PREVIEW ONLY' } }],
        appendSections: [],
      },
    })
    assert.match(previewed.value.effective, /PREVIEW ONLY/)
    assert.equal(fs.existsSync(settingsFile), false, 'preview 不得落盘')

    // save 应落盘，且立刻可读回
    const saved = await handler('save', {
      config: {
        enabled: true,
        rules: [{ id: 's', match: { kind: 'name', name: 'harness:identity' }, action: { kind: 'setText', text: 'SAVED TEXT' } }],
        appendSections: [],
      },
    })
    assert.equal(saved.ok, true)
    assert.equal(fs.existsSync(settingsFile), true, 'save 必须落盘')

    const after = await handler('describe', {})
    assert.match(after.value.effective, /SAVED TEXT/, '保存后立刻读回必须看到新值')

    const onDisk = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
    assert.equal(onDisk.rules[0].action.text, 'SAVED TEXT')

    // reset 恢复默认
    await handler('reset', {})
    const afterReset = await handler('describe', {})
    assert.doesNotMatch(afterReset.value.effective, /SAVED TEXT/)
    assert.match(afterReset.value.effective, /powered by DeepSeek Harness/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('RPC 未知方法返回 ok:false 而不是抛错', async () => {
  const { ctx, prompt } = createRuntime()
  let handler = null
  const view = createPluginContext(ctx, prompt, {
    connection: {
      rpc: {
        handle(channel, fn) {
          if (channel === RPC_CHANNEL) handler = fn
        },
      },
    },
  })

  apply(view, {
    enabled: true,
    settingsFile: path.join(os.tmpdir(), `spe-${process.pid}-g.json`),
    rules: [],
    appendSections: [],
  })

  const result = await handler('nope', {})
  assert.equal(result.ok, false)
  assert.match(result.error.message, /未知方法/)
})

test('保存后立即生效，且外部改动也能被采纳', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spe-fresh-'))
  const settingsFile = path.join(dir, 'settings.json')
  try {
    const { ctx, prompt } = createRuntime()
    let handler = null
    const view = createPluginContext(ctx, prompt, {
      connection: {
        rpc: {
          handle(channel, fn) {
            if (channel === RPC_CHANNEL) handler = fn
          },
        },
      },
    })

    apply(view, { enabled: true, settingsFile, rules: [], appendSections: [] })

    await handler('save', {
      config: {
        enabled: true,
        rules: [{ id: 'r', match: { kind: 'name', name: 'harness:identity' }, action: { kind: 'setText', text: 'EDITED' } }],
        appendSections: [],
      },
    })
    assert.match(renderPrompt(await prompt.assemble({ scope: undefined })), /EDITED/)

    // 外部改写同一份文件，模拟另一个浏览器/编辑器改了配置。
    fs.writeFileSync(settingsFile, JSON.stringify({
      enabled: true,
      rules: [{ id: 'r', match: { kind: 'name', name: 'harness:identity' }, action: { kind: 'setText', text: 'EXTERNAL' } }],
      appendSections: [],
    }))
    ctx.emit('loader/volatile-update')
    await new Promise((resolve) => setImmediate(resolve))

    // 回归点：曾用 storedOverride 锁定内存值，导致外部改动永久读不到。
    assert.match(renderPrompt(await prompt.assemble({ scope: undefined })), /EXTERNAL/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('保存失败时内存保持原样，不会出现“以为没保存却已生效”', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spe-fail-'))
  try {
    // 让写入必定失败：路径的父级是一个普通文件。
    const base = path.join(dir, 'plainfile')
    fs.writeFileSync(base, 'blocked')
    const settingsFile = path.join(base, 'sub', 'settings.json')

    const { ctx, prompt } = createRuntime()
    let handler = null
    const view = createPluginContext(ctx, prompt, {
      connection: {
        rpc: {
          handle(channel, fn) {
            if (channel === RPC_CHANNEL) handler = fn
          },
        },
      },
    })

    apply(view, { enabled: true, settingsFile, rules: [], appendSections: [] })

    // RPC handler 会把异常转成 { ok:false, error } 而不是让它 reject，
    // 因此这里断言"保存被明确拒绝"，而不是 Promise rejection。
    const outcome = await handler('save', {
      config: {
        enabled: true,
        rules: [{ id: 'r', match: { kind: 'name', name: 'harness:identity' }, action: { kind: 'setText', text: 'POLLUTE' } }],
        appendSections: [],
      },
    })
    assert.equal(outcome.ok, false)
    assert.match(outcome.error.message, /写入配置文件失败/)

    // 关键回归点：写入失败必须被明确拒绝，且规则不得残留在内存里生效。
    assert.doesNotMatch(renderPrompt(await prompt.assemble({ scope: undefined })), /POLLUTE/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

/* ================================================================== *
 * 段落查询定位：用真实的 SystemPrompt 服务验证 RPC locate
 *
 * 用户诉求：「给定一个词或一段话，查出它在哪一个/哪几个段落里」，
 * 例如 Web GUI → app:web-surface。这里模拟注册了该段落的真实服务，
 * 走完整 RPC 通道，确认结果与设置页「按名称」下拉框能对上。
 * ================================================================== */

/** 建一个带 app:web-surface 段落的运行时，模拟真实提示词里存在这个段落。 */
function createRuntimeWithWebSurface() {
  const { ctx, prompt } = createRuntime()
  prompt.section({
    name: 'app:web-surface',
    order: 10100,
    text: 'You are interacting with the user through the DeepSeek Harness Web GUI whose URL the runtime context names.',
  })
  return { ctx, prompt }
}

test('RPC locate 能把 Web GUI 定位到 app:web-surface', async () => {
  const { ctx, prompt } = createRuntimeWithWebSurface()
  let handler = null
  const view = createPluginContext(ctx, prompt, {
    connection: {
      rpc: {
        handle(channel, fn) {
          if (channel === RPC_CHANNEL) handler = fn
        },
      },
    },
  })

  apply(view, {
    enabled: true,
    settingsFile: path.join(os.tmpdir(), `spe-${process.pid}-locate.json`),
    rules: [],
    appendSections: [],
  })

  const result = await handler('locate', { query: 'Web GUI' })
  assert.equal(result.ok, true)

  const value = result.value
  assert.equal(value.ok, true)
  assert.equal(value.matchedSections, 1)
  assert.equal(value.matches[0].name, 'app:web-surface')
  assert.equal(value.strategy, 'phrase')

  const hit = value.matches[0].snippets[0].segments.find((segment) => segment.hit)
  assert.equal(hit.text, 'Web GUI')

  // 定位结果必须能直接喂给「按名称」下拉框——这是该功能的落点。
  const describe = await handler('describe', {})
  assert.ok(
    describe.value.sections.some((section) => section.name === 'app:web-surface'),
    '定位到的段落必须出现在 describe 的段落列表里',
  )
})

test('RPC locate 定位不到时返回 0 命中而不是报错', async () => {
  const { ctx, prompt } = createRuntime()
  let handler = null
  const view = createPluginContext(ctx, prompt, {
    connection: {
      rpc: {
        handle(channel, fn) {
          if (channel === RPC_CHANNEL) handler = fn
        },
      },
    },
  })

  apply(view, {
    enabled: true,
    settingsFile: path.join(os.tmpdir(), `spe-${process.pid}-locate2.json`),
    rules: [],
    appendSections: [],
  })

  const result = await handler('locate', { query: '这句话肯定不存在于提示词里' })
  assert.equal(result.ok, true)
  assert.equal(result.value.matchedSections, 0)
  assert.match(result.value.message, /没有任何段落包含/)
})

test('RPC locate 不改动配置，也不会落盘', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spe-locate-'))
  const settingsFile = path.join(dir, 'settings.json')
  try {
    const { ctx, prompt } = createRuntimeWithWebSurface()
    let handler = null
    const view = createPluginContext(ctx, prompt, {
      connection: {
        rpc: {
          handle(channel, fn) {
            if (channel === RPC_CHANNEL) handler = fn
          },
        },
      },
    })

    apply(view, { enabled: true, settingsFile, rules: [], appendSections: [] })
    await handler('locate', { query: 'Web GUI' })

    // 查询是只读操作：不能因为用户搜了一下就把空配置写成文件。
    assert.equal(fs.existsSync(settingsFile), false, 'locate 不得落盘')
    const after = await handler('describe', {})
    assert.deepEqual(after.value.config.rules, [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
