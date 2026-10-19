import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_JEV,
  DEFAULT_ROUTING,
  FALLBACKS,
  RESERVED_IDS,
  childRouteIsExplicit,
  isSubagent,
  parseJevChoice,
  parseProfile,
  planModeActive,
  profileJevRequest,
  profileSystem,
  resolveConfig,
  selectProfile,
  taskTextOf,
} from '../lib/core.js'
import { Config, handleSettingsRpc, isVolatileRef, liveField, settingsBase, unwrapConfig } from '../lib/index.js'

function config(extra = {}) {
  return resolveConfig({
    routing: {
      enabled: true,
      fallback: 'taskRole',
      useJev: true,
      respectExplicitChildModel: true,
      classifier: { provider: '', model: '', reasoningEffort: '' },
      ...(extra.routing || {}),
    },
    profiles: [
      { id: 'review', name: '审查', detail: '代码审查', keywords: ['review', '审查'], provider: 'p', model: 'review-model', enabled: true },
      { id: 'explore', name: '探索', detail: '搜索代码', keywords: ['search', '搜索'], provider: 'p', model: 'explore-model', enabled: true },
      ...(extra.profiles || []),
    ],
    jev: { ...DEFAULT_JEV, ...(extra.jev || {}) },
  })
}

test('task routing defaults are a strict no-op', () => {
  const resolved = resolveConfig({})
  assert.deepEqual(resolved.routing, DEFAULT_ROUTING)
  assert.equal(resolved.profiles.size, 0)
  assert.deepEqual(resolved.jev, DEFAULT_JEV)
  assert.deepEqual(FALLBACKS, ['taskRole', 'llm'])
  assert.equal(RESERVED_IDS.has('general'), true)
  assert.equal(RESERVED_IDS.has('task'), true)
  assert.equal(RESERVED_IDS.has('review'), false)
})

test('task routing settings validate ids, reserved names, routes, classifier and Jev bounds', () => {
  assert.throws(() => resolveConfig({ profiles: [{ id: 'general', provider: 'p', model: 'm' }] }), /reserved/)
  assert.throws(() => resolveConfig({ profiles: [{ id: 'task', provider: 'p', model: 'm' }] }), /reserved/)
  assert.throws(() => resolveConfig({ profiles: [{ id: 'review', provider: 'p', model: 'm' }, { id: 'REVIEW', provider: 'p', model: 'n' }] }), /duplicate/)
  assert.throws(() => resolveConfig({ profiles: [{ id: 'review', provider: '', model: 'm' }] }), /non-empty/)
  assert.throws(() => resolveConfig({ profiles: [{ id: 'Review!', provider: 'p', model: 'm' }] }), /must match/)
  assert.throws(() => resolveConfig({ routing: { fallback: 'explode' } }), /fallback/)
  assert.throws(() => resolveConfig({ routing: { classifier: { provider: 'p' } } }), /both provider and model/)
  assert.throws(() => resolveConfig({ jev: { baseURL: 'not a url' } }), /not a valid URL/)
  assert.throws(() => resolveConfig({ jev: { minConfidence: 1.5 } }), /between/)
  assert.throws(() => resolveConfig({ jev: { timeoutMs: 50 } }), /between/)
  assert.throws(() => resolveConfig({ jev: { maxStateChars: 10 } }), /between/)
  const resolved = config()
  assert.deepEqual([...resolved.profiles.keys()], ['review', 'explore'])
  assert.deepEqual(resolved.profiles.get('review').keywords, ['review', '审查'])
  assert.deepEqual(resolved.routing.classifier, { provider: '', model: '', reasoningEffort: '' })
})

test('deterministic selection prefers labels, scores prompt words, and treats ties as no decision', () => {
  const resolved = config()
  assert.equal(selectProfile(resolved.profiles, '[review]', 'anything').id, 'review')
  assert.equal(selectProfile(resolved.profiles, 'review:', 'anything').id, 'review')
  assert.equal(selectProfile(resolved.profiles, '', 'Please SEARCH the repository').id, 'explore')
  assert.equal(selectProfile(resolved.profiles, '审查这段代码', '').id, 'review')
  assert.equal(selectProfile(resolved.profiles, '', 'nothing relevant'), undefined)

  const tied = resolveConfig({
    profiles: [
      { id: 'review', name: '审查', keywords: ['check'], provider: 'p', model: 'a' },
      { id: 'explore', name: '探索', keywords: ['check'], provider: 'p', model: 'b' },
    ],
  })
  assert.equal(selectProfile(tied.profiles, '', 'check this'), undefined)

  const disabled = resolveConfig({
    profiles: [{ id: 'review', name: '审查', keywords: ['review'], provider: 'p', model: 'a', enabled: false }],
  })
  assert.equal(selectProfile(disabled.profiles, '', 'review this diff'), undefined)
})

test('profile parser accepts exactly one configured id', () => {
  const resolved = config()
  assert.equal(parseProfile('review', resolved.profiles), 'review')
  assert.equal(parseProfile(' `REVIEW`\n', resolved.profiles), 'review')
  assert.equal(parseProfile('"explore"', resolved.profiles), 'explore')
  assert.equal(parseProfile('general', resolved.profiles), undefined)
  assert.equal(parseProfile('review or explore', resolved.profiles), undefined)
  assert.equal(parseProfile('unknown', resolved.profiles), undefined)
  assert.equal(parseProfile(undefined, resolved.profiles), undefined)
})

test('Jev profile requests expose only configured profiles plus general', () => {
  const resolved = config()
  const request = profileJevRequest({
    parentTask: 'Fix the login flow',
    label: 'review the diff',
    text: 'Check the patch for correctness.',
    profiles: resolved.profiles,
    maxStateChars: 8000,
  })
  assert.match(request.state, /Fix the login flow/)
  assert.match(request.state, /review the diff/)
  assert.match(request.state, /- review:/)
  assert.deepEqual(Object.keys(request.criteria).sort(), ['explore', 'general', 'review'])
  assert.equal(request.questions.task_profile.type, 'choice')
  assert(request.state.length <= 8000)
})

test('parseJevChoice enforces allowed ids, confidence and the general abstention', () => {
  const allowed = new Set(['review', 'explore'])
  const answer = (choice, confidence) => ({ answers: { task_profile: { type: 'choice', choice, confidence } } })
  assert.equal(parseJevChoice(answer('review', 0.8), allowed, 0.6), 'review')
  assert.equal(parseJevChoice(answer('REVIEW', 0.8), allowed, 0.6), 'review')
  assert.equal(parseJevChoice(answer('review', 0.2), allowed, 0.6), undefined)
  assert.equal(parseJevChoice(answer('general', 0.9), allowed, 0.6), undefined)
  assert.equal(parseJevChoice(answer('unknown', 0.9), allowed, 0.6), undefined)
  assert.equal(parseJevChoice(answer('review', undefined), allowed, 0.6), 'review')
  assert.equal(parseJevChoice({}, allowed, 0.6), undefined)
  assert.equal(parseJevChoice({ answers: [] }, allowed, 0.6), undefined)
})

test('profileSystem lists enabled ids and the general abstention contract', () => {
  const text = profileSystem(config().profiles)
  assert.match(text, /review:/)
  assert.match(text, /explore:/)
  assert.match(text, /reply general/i)
})

test('subagent and plan-mode facts are folded without Harness imports', () => {
  const subagent = { session: { header: { origin: 'subagent' } }, options: {} }
  assert.equal(isSubagent(subagent), true)
  assert.equal(isSubagent({ session: { header: { parentSession: 'p' } }, options: {} }), true)
  assert.equal(isSubagent({ session: { header: {} }, options: { subagentDepth: 1 } }), true)
  assert.equal(isSubagent({ session: { header: {} }, options: {} }), false)
  assert.equal(planModeActive([{ type: 'plan/mode', data: { active: true } }]), true)
  assert.equal(planModeActive([
    { type: 'plan/mode', data: { active: true } },
    { type: 'plan/mode', data: { active: false } },
  ]), false)
})

test('taskTextOf reads the latest human message and ignores plugin notices', () => {
  const agent = {
    session: {
      deriveMessages: () => [
        { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'old task' }] },
        { role: 'user', source: { kind: 'plugin:task-models' }, content: [{ type: 'text', text: 'notice' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
        { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'new task' }, { type: 'image' }] },
      ],
    },
  }
  assert.equal(taskTextOf(agent), 'new task')
  assert.equal(taskTextOf({ session: { deriveMessages: () => [] } }), '')
})

test('explicit child routes are detected only when they differ from the parent baseline', () => {
  assert.equal(childRouteIsExplicit({ provider: 'p', model: 'child' }, { provider: 'p', model: 'parent' }), true)
  assert.equal(childRouteIsExplicit({ provider: 'p', model: 'child' }, { provider: 'p', model: 'child' }), false)
  assert.equal(childRouteIsExplicit({}, { provider: 'p', model: 'parent' }), false)
  assert.equal(childRouteIsExplicit({ provider: '', model: 'child' }, { provider: 'p', model: 'parent' }), false)
  assert.equal(childRouteIsExplicit(undefined, undefined), false)
})

test('Config: every field this section owns is live, and unwraps to plain data', () => {
  const keys = Object.keys(Config.dict)
  const supportsLiveFields = typeof Config.dict[keys[0]].volatile === 'function'
  for (const [key, field] of Object.entries(Config.dict)) {
    assert.equal(field.meta?.volatile === true, supportsLiveFields,
      key + (supportsLiveFields ? ' must be declared live' : ' stays ordinary on this schemastery'))
  }
  const resolved = Config({})
  assert.equal(isVolatileRef(resolved[keys[0]]), supportsLiveFields)
  const plain = unwrapConfig(resolved)
  for (const key of keys) assert.equal(isVolatileRef(plain[key]), false, key + ' unwraps to plain data')
  assert.deepEqual(Object.keys(plain).sort(), [...keys].sort())
})

test('settings RPC describes, replaces, reports Jev status and saves a key', async () => {
  const calls = []
  let section = { routing: { enabled: false, fallback: 'taskRole', useJev: true, respectExplicitChildModel: true, classifier: {} }, profiles: [], jev: {} }
  const settings = {
    writable: true,
    describe() { return [{ ns: 'task-models', value: section, revision: calls.length }] },
    async replace(ns, next, revision) { calls.push({ ns, next, revision }); section = next },
  }
  assert.equal((await handleSettingsRpc(settings, 'describe', {}, section)).ok, true)
  const replaced = await handleSettingsRpc(settings, 'replace', { section, expectedRevision: 0 }, section)
  assert.equal(replaced.ok, true)
  assert.equal(calls.length, 1)
  assert.equal((await handleSettingsRpc(settings, 'replace', { section: [], expectedRevision: 0 }, section)).ok, false)
  assert.equal((await handleSettingsRpc(settings, 'unknown', {}, section)).ok, false)
  const status = await handleSettingsRpc(settings, 'jevStatus', {}, { jev: { ...DEFAULT_JEV } }, 'task-models', undefined, '/nonexistent/key')
  assert.equal(status.ok, true)
  assert.equal(status.value.configured, false)
  assert.equal((await handleSettingsRpc(settings, 'jevStatus', { extra: true }, section)).ok, false)
  assert.equal((await handleSettingsRpc(settings, 'saveJevKey', {}, section)).ok, false)
  const models = await handleSettingsRpc(
    settings, 'childModels', { childIds: ['child-1'] }, section, 'task-models',
    (ids) => Object.fromEntries(ids.map((id) => [id, { provider: 'p', model: 'm' }])),
  )
  assert.deepEqual(models, { ok: true, value: { models: { 'child-1': { provider: 'p', model: 'm' } } } })
  assert.equal((await handleSettingsRpc(settings, 'childModels', { childIds: [7] }, section)).ok, false)
  assert.equal((await handleSettingsRpc(settings, 'childModels', { childIds: [] }, section)).ok, true)
})

test('settingsBase: the legacy settings seam receives raw plain config', () => {
  const live = { get: () => 'http://gw.example', [Symbol.for('cosmokit.volatile.write')]: () => {} }
  assert.deepEqual(settingsBase({ fiber: undefined }, { enabled: live }), { enabled: 'http://gw.example' })
  const entryConfig = { enabled: true }
  assert.deepEqual(settingsBase({ fiber: { entry: { options: { config: entryConfig } } } }, { enabled: true }), entryConfig)
  assert.deepEqual(settingsBase({ fiber: undefined }, undefined), {})
  assert.equal(typeof liveField, 'function')
})
