import test from 'node:test'
import assert from 'node:assert/strict'
import { handleSettingsRpc } from '../lib/index.js'

function section(routing = {}, profiles) {
  return {
    routing: { enabled: true, ...routing },
    profiles: profiles ?? [
      { id: 'review', name: '审查', keywords: ['review', 'check'], provider: 'p', model: 'review-model' },
      { id: 'test', name: '测试', keywords: ['test', 'check'], provider: 'p', model: 'test-model' },
    ],
  }
}

function rpc(method, payload, current = section(), settings = {}) {
  return handleSettingsRpc(settings, method, payload, current)
}

test('rule previews use validated unsaved drafts without writes or model calls', async () => {
  const writes = []
  const settings = { replace(...args) { writes.push(args); assert.fail('preview must not persist') } }
  const current = section({ enabled: false })
  const draft = section()
  const result = await rpc('previewRules', { label: '[test] review check', text: 'A secret task', section: draft }, current, settings)
  assert.equal(result.ok, true)
  assert.equal(result.value.next, 'rules')
  assert.equal(result.value.profile.id, 'test')
  assert.equal(result.value.reason, 'rules-explicit-label')
  assert.equal(result.value.ruleAnalysis.profileId, 'test')
  assert.equal(writes.length, 0)
  assert.equal(current.routing.enabled, false)
  assert.equal(JSON.stringify(result).includes('A secret task'), false)
})

test('rule previews describe ties and classifier paths without claiming final selection', async () => {
  let result = await rpc('previewRules', { label: '', text: 'check' })
  assert.equal(result.value.next, 'current')
  assert.equal(result.value.reason, 'rules-tie')
  assert.deepEqual(result.value.ruleAnalysis.tiedIds, ['review', 'test'])
  result = await rpc('previewRules', { label: '', text: 'assess' }, { ...section(), jev: { enabled: true } })
  assert.equal(result.value.next, 'jev')
  assert.equal(result.value.profile, undefined)
  result = await rpc('previewRules', { label: '', text: 'assess' }, section({ fallback: 'llm', classifier: { provider: 'p', model: 'tiny' } }))
  assert.equal(result.value.next, 'llm')
  assert.equal(result.value.profile, undefined)
  result = await rpc('previewRules', { label: '', text: 'assess' }, section({ fallback: 'llm' }))
  assert.equal(result.value.reason, 'classifier-unconfigured')
  result = await rpc('previewRules', { label: 'review', text: '' }, section({ enabled: false }))
  assert.equal(result.value.next, 'current')
  assert.equal(result.value.reason, 'routing-disabled')
  result = await rpc('previewRules', { label: 'review', text: '' }, section({}, []))
  assert.equal(result.value.reason, 'no-profiles')
  result = await rpc('previewRules', { label: '', text: '   ' }, { ...section(), jev: { enabled: true } })
  assert.equal(result.value.reason, 'no-task')
  assert.equal(result.value.next, 'current')
})

test('preview RPC validates bounds, unknown fields and draft settings', async () => {
  for (const payload of [
    {}, { label: [], text: '' }, { label: '', text: 1 },
    { label: 'x'.repeat(301), text: '' }, { label: '', text: 'x'.repeat(6001) },
    { label: '', text: '', section: null }, { label: '', text: '', section: [] },
    { label: '', text: '', extra: true },
    { label: '', text: '', section: { routing: { decisionTimeoutMs: 1 } } },
    { label: '', text: '', section: section({}, [{ id: 'bad!', provider: 'p', model: 'm' }]) },
  ]) {
    const result = await rpc('previewRules', payload)
    assert.equal(result.ok, false, JSON.stringify(payload))
    assert.equal(result.error.code, 'bad-request')
  }
  assert.equal((await rpc('previewRules', { label: 'x'.repeat(300), text: 'x'.repeat(6000) })).ok, true)
})

test('routingDetails keeps legacy childModels intact and reports unknown explanations honestly', async () => {
  const getModels = async (ids) => Object.fromEntries(ids.filter((id) => id === 'old-child').map((id) => [id, { provider: 'p', model: 'historical' }]))
  const args = [{}, 'routingDetails', { childIds: ['old-child', 'unknown'] }, {}, 'task-models', getModels, '/nonexistent/test-key']
  assert.deepEqual(await handleSettingsRpc(...args), {
    ok: true, value: { models: { 'old-child': { provider: 'p', model: 'historical' } }, details: {} },
  })
  args[1] = 'childModels'
  assert.deepEqual(await handleSettingsRpc(...args), {
    ok: true, value: { models: { 'old-child': { provider: 'p', model: 'historical' } } },
  })
  args[1] = 'routingDetails'
  const detailed = await handleSettingsRpc(...args, async (ids) => ({
    models: {}, details: Object.fromEntries(ids.map((id) => [id, { status: 'current', source: 'current', reason: 'no-match', durationMs: 0 }])),
  }))
  assert.equal(detailed.value.details['old-child'].reason, 'no-match')
  for (const payload of [{}, { childIds: [3] }, { childIds: [''] }, { childIds: Array(501).fill('child') }, { childIds: [], extra: true }]) {
    assert.equal((await rpc('routingDetails', payload)).ok, false)
  }
})

test('settings writes validate semantic config and use the actual target namespace', async () => {
  const calls = []
  const settings = { async replace(...args) { calls.push(args) } }
  let result = await handleSettingsRpc(settings, 'replace', { section: section(), expectedRevision: 2 }, {}, 'custom-task-models')
  assert.equal(result.ok, true)
  assert.equal(calls[0][0], 'custom-task-models')
  result = await handleSettingsRpc(settings, 'replace', { section: section({ decisionTimeoutMs: 2 }), expectedRevision: 2 })
  assert.equal(result.ok, false)
  assert.equal(calls.length, 1)
})
