import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  _internals,
  buildSettingsView,
  defaultSettingsFilePath,
  readPersistedSettings,
  resolveAgentIdentity,
  resolveSettingsFilePath,
  writePersistedSettings,
} from '../lib/index.js'

/** 创建一个测试用的临时目录，并在测试结束后清理。 */
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-editor-'))
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // 清理失败不影响测试结论。
    }
  })
  return dir
}

/** 构造一个只实现本插件所需接口的假 systemPrompt 服务。 */
function fakePrompt(sections) {
  return {
    async assemble() {
      return {
        sections: sections.map((section) => ({ ...section })),
        contexts: [],
        tools: [],
        variables: { model: 'test-model' },
      }
    },
  }
}

test('resolveSettingsFilePath 处理空值与相对路径', () => {
  assert.equal(resolveSettingsFilePath(''), defaultSettingsFilePath())
  assert.equal(resolveSettingsFilePath('   '), defaultSettingsFilePath())
  assert.equal(resolveSettingsFilePath('/tmp/a/b.json'), '/tmp/a/b.json')
})

test('resolveSettingsFilePath 展开 ~ 前缀', () => {
  assert.equal(resolveSettingsFilePath('~/x.json'), path.join(os.homedir(), 'x.json'))
  assert.equal(resolveSettingsFilePath('~'), os.homedir())
})

test('writePersistedSettings 与 readPersistedSettings 往返一致', (t) => {
  const dir = tempDir(t)
  const file = path.join(dir, 'settings.json')

  const ok = writePersistedSettings(file, {
    enabled: true,
    rules: [{ id: 'r1' }],
    appendSections: [],
  })
  assert.equal(ok, true)

  const read = readPersistedSettings(file)
  assert.equal(read.enabled, true)
  assert.equal(read.rules.length, 1)
  assert.equal(typeof read.updatedAt, 'string')
})

test('writePersistedSettings 合并而非覆盖已有字段', (t) => {
  const dir = tempDir(t)
  const file = path.join(dir, 'settings.json')

  writePersistedSettings(file, { a: 1 })
  writePersistedSettings(file, { b: 2 })

  const read = readPersistedSettings(file)
  assert.equal(read.a, 1)
  assert.equal(read.b, 2)
})

test('writePersistedSettings 自动创建父目录', (t) => {
  const dir = tempDir(t)
  const file = path.join(dir, 'nested', 'deep', 'settings.json')

  assert.equal(writePersistedSettings(file, { x: 1 }), true)
  assert.equal(fs.existsSync(file), true)
})

test('readPersistedSettings 对缺失文件返回 null', (t) => {
  const dir = tempDir(t)
  assert.equal(readPersistedSettings(path.join(dir, 'missing.json')), null)
})

test('readPersistedSettings 对损坏 JSON 返回 null 而不抛错', (t) => {
  const dir = tempDir(t)
  const file = path.join(dir, 'broken.json')
  fs.writeFileSync(file, '{ not json', 'utf8')

  assert.equal(readPersistedSettings(file), null)
})

test('readPersistedSettings 对数组内容返回 null', (t) => {
  const dir = tempDir(t)
  const file = path.join(dir, 'array.json')
  fs.writeFileSync(file, '[1,2,3]', 'utf8')

  assert.equal(readPersistedSettings(file), null)
})

test('writePersistedSettings 不留下临时文件', (t) => {
  const dir = tempDir(t)
  const file = path.join(dir, 'settings.json')
  writePersistedSettings(file, { x: 1 })

  const leftovers = fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'))
  assert.deepEqual(leftovers, [])
})

test('resolveAgentIdentity 从 session.header 读取预设与会话 id', () => {
  const identity = resolveAgentIdentity({
    session: { header: { agentPreset: 'standard-zh', id: 'session-1' } },
  })
  assert.deepEqual(identity, { presetId: 'standard-zh', sessionId: 'session-1' })
})

test('resolveAgentIdentity 在缺少 agent 时返回空值', () => {
  assert.deepEqual(resolveAgentIdentity(undefined), { presetId: null, sessionId: null })
  assert.deepEqual(resolveAgentIdentity(null), { presetId: null, sessionId: null })
  assert.deepEqual(resolveAgentIdentity({}), { presetId: null, sessionId: null })
})

test('resolveAgentIdentity 容忍 header 抛错的对象', () => {
  const hostile = {
    get session() {
      throw new Error('boom')
    },
  }
  // 必须安全返回，不能把异常抛给调用方（否则整个 assemble 会失败）。
  assert.deepEqual(resolveAgentIdentity(hostile), { presetId: null, sessionId: null })
})

test('resolveAgentIdentity 回退到 agent.session.id', () => {
  const identity = resolveAgentIdentity({ session: { id: 's-9', header: {} } })
  assert.equal(identity.sessionId, 's-9')
  assert.equal(identity.presetId, null)
})

test('buildSettingsView 返回基线与生效后文本', async () => {
  const state = {
    prompt: fakePrompt([
      { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
      { name: 'deployment:persona-prefix', text: 'You are a coding agent powered by the {{model}} model.' },
    ]),
    current: () => ({
      enabled: true,
      rules: [
        {
          id: 'r1',
          enabled: true,
          valid: true,
          match: { kind: 'name', name: 'harness:identity' },
          action: { kind: 'setText', text: 'You are Aria.' },
          applyTo: { mode: 'all' },
        },
      ],
      appendSections: [],
      diagnostics: [],
    }),
    settingsFile: '/tmp/x.json',
    storageKind: 'file',
  }

  const view = await buildSettingsView(state)
  assert.equal(view.ok, true)
  assert.match(view.baseline, /powered by DeepSeek Harness/)
  assert.match(view.effective, /You are Aria\./)
  assert.doesNotMatch(view.effective, /powered by DeepSeek Harness/)
  // 变量插值必须发生在预览里，否则用户看到的 {{model}} 会以为坏了。
  assert.match(view.effective, /test-model/)
  assert.equal(view.failure, null)
})

test('buildSettingsView 在 assemble 抛错时降级而不崩溃', async () => {
  const state = {
    prompt: {
      async assemble() {
        throw new Error('prompt service unavailable')
      },
    },
    current: () => ({ enabled: true, rules: [], appendSections: [], diagnostics: [] }),
    settingsFile: '/tmp/x.json',
    storageKind: 'file',
  }

  const view = await buildSettingsView(state)
  assert.equal(view.ok, true)
  assert.equal(view.baseline, null)
  assert.equal(view.effective, null)
  assert.match(view.failure, /prompt service unavailable/)
  // 失败时要给出可读提示，而不是空白。
  assert.match(view.hint, /无法组装提示词/)
})

test('buildSettingsView 支持 preview 覆盖当前配置', async () => {
  const state = {
    prompt: fakePrompt([{ name: 'harness:identity', text: 'original' }]),
    current: () => ({ enabled: true, rules: [], appendSections: [], diagnostics: [] }),
    settingsFile: '/tmp/x.json',
    storageKind: 'file',
  }

  const view = await buildSettingsView(state, {
    preview: {
      rules: [
        { id: 'p', match: { kind: 'name', name: 'harness:identity' }, action: { kind: 'setText', text: 'previewed' } },
      ],
    },
  })

  assert.match(view.effective, /previewed/)
  // preview 不应污染 state.current 的返回值。
  assert.equal(state.current().rules.length, 0)
})

test('buildSettingsView 报告未知变量', async () => {
  const state = {
    prompt: fakePrompt([{ name: 'a', text: 'hello' }]),
    current: () => ({
      enabled: true,
      rules: [],
      appendSections: [
        { id: 's1', enabled: true, valid: true, name: 'x', text: 'use {{nonexistent}}', order: 1 },
      ],
      diagnostics: [],
    }),
    settingsFile: '/tmp/x.json',
    storageKind: 'file',
  }

  const view = await buildSettingsView(state)
  assert.deepEqual(view.unknownVariables, ['nonexistent'])
})

test('buildSettingsView 汇总 sections 摘要', async () => {
  const state = {
    prompt: fakePrompt([
      { name: 'a', text: 'x'.repeat(500) },
      { name: 'b', text: 'short' },
    ]),
    current: () => ({ enabled: true, rules: [], appendSections: [], diagnostics: [] }),
    settingsFile: '/tmp/x.json',
    storageKind: 'file',
  }

  const view = await buildSettingsView(state)
  assert.equal(view.sections.length, 2)
  // preview 截断到 240 字符，避免把整份提示词塞进 RPC 响应。
  assert.equal(view.sections[0].preview.length, 240)
  assert.equal(view.sections[0].length, 500)
})

test('_internals 暴露归一化工具', () => {
  const config = _internals.normalizeConfig({ rules: [] })
  assert.equal(config.enabled, true)
  assert.deepEqual(config.rules, [])
})
