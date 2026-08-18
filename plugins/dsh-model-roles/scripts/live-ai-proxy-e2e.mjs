import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'

const baseUrl = process.env.DSH_E2E_BASE_URL ?? 'http://127.0.0.1:3081'
const cwd = process.env.DSH_E2E_CWD ?? process.cwd()
const pollIntervalMs = Number(process.env.DSH_E2E_POLL_INTERVAL_MS ?? 500)
const timeoutMs = Number(process.env.DSH_E2E_TIMEOUT_MS ?? 300_000)
const requestedRoles = new Set((process.env.DSH_E2E_ROLES ?? '')
  .split(',')
  .map((role) => role.trim())
  .filter(Boolean))
if (requestedRoles.has('tiny')) {
  for (const role of ['default', 'smol', 'slow', 'designer', 'commit']) requestedRoles.add(role)
}

const routes = {
  default: { provider: 'ai-proxy', model: 'gpt-5.6-terra', reasoningEffort: 'medium' },
  smol: { provider: 'ai-proxy', model: 'deepseek-v4-flash', reasoningEffort: 'low' },
  slow: { provider: 'ai-proxy', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
  vision: { provider: 'ai-proxy', model: 'gemini-3.7-flash-tiered', reasoningEffort: 'high' },
  plan: { provider: 'ai-proxy', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
  designer: { provider: 'ai-proxy', model: 'mimo-v2.5-pro', reasoningEffort: 'high' },
  commit: { provider: 'ai-proxy', model: 'glm-5.3', reasoningEffort: 'low' },
  tiny: { provider: 'ai-proxy', model: 'gpt-5.6-luna', reasoningEffort: 'none' },
  task: { provider: 'ai-proxy', model: 'k3', reasoningEffort: 'high' },
  advisor: { provider: 'ai-proxy', model: 'mimo-v2.5', reasoningEffort: 'high' },
}

const results = []

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function rpc(method, payload) {
  const rpcId = crypto.randomUUID()
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
  })
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}: ${await response.text()}`)
  const envelope = await response.json()
  assert.equal(envelope.rpcId, rpcId, `${method}: rpcId mismatch`)
  if (!envelope.result?.ok) {
    throw new Error(`${method}: ${envelope.result?.error?.code ?? 'unknown'}: ${envelope.result?.error?.message ?? 'unknown error'}`)
  }
  return envelope.result.value
}

async function settingsRpc(method, payload = {}) {
  const rpcId = crypto.randomUUID()
  const response = await fetch(`${baseUrl}/model-roles-settings/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
  })
  if (!response.ok) throw new Error(`model-roles-settings/${method}: HTTP ${response.status}`)
  const envelope = await response.json()
  assert.equal(envelope.rpcId, rpcId, `model-roles-settings/${method}: rpcId mismatch`)
  if (!envelope.result?.ok) throw new Error(envelope.result?.error?.message ?? 'settings RPC failed')
  return envelope.result.value
}

async function connectionRpc(endpoint, args) {
  const rpcId = crypto.randomUUID()
  const response = await fetch(`${baseUrl}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId,
      method: endpoint,
      payload: { args },
    }),
  })
  if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}: ${await response.text()}`)
  const envelope = await response.json()
  assert.equal(envelope.rpcId, rpcId, `${endpoint}: rpcId mismatch`)
  if (!envelope.result?.ok) {
    throw new Error(`${endpoint}: ${envelope.result?.error?.code ?? 'unknown'}: ${envelope.result?.error?.message ?? 'unknown error'}`)
  }
  return envelope.result.value
}

function rawEvents(history) {
  return history.events.map((entry) => entry.event)
}

async function history(sessionId) {
  return rpc('session.history', { sessionId, maxMessages: 200 })
}

async function waitUntil(label, sample, accept) {
  const startedAt = Date.now()
  let last
  while (Date.now() - startedAt < timeoutMs) {
    last = await sample()
    if (accept(last)) return last
    await sleep(pollIntervalMs)
  }
  throw new Error(`${label}: timed out after ${timeoutMs}ms; last=${JSON.stringify(last)?.slice(0, 2_000)}`)
}

async function createSession() {
  const created = await rpc('session.create', { cwd })
  await rpc('session.selectModel', {
    sessionId: created.sessionId,
    provider: routes.default.provider,
    model: routes.default.model,
    reasoningEffort: routes.default.reasoningEffort,
  })
  return created.sessionId
}

async function command(sessionId, text) {
  const value = await connectionRpc('commands/execute', { agentId: sessionId, line: text })
  assert(value, `${text} was not recognized as a command`)
  assert.equal(value.result?.kind, 'success', `${text} command failed: ${value.result?.text ?? 'unknown error'}`)
  return value
}

function lastCompletedTurn(events) {
  const end = events.findLast((event) => event.type === 'turn/end')
  if (end === undefined) return undefined
  const start = events.findLast((event) => event.type === 'turn/start' && event.data.turn === end.data.turn)
  if (start === undefined) return undefined
  return { start, end, events: events.filter((event) => event.seq >= start.seq && event.seq <= end.seq) }
}

function assertCompletedRoute(events, expected, label) {
  const turn = lastCompletedTurn(events)
  assert(turn, `${label}: no completed turn`)
  assert.equal(turn.end.data.reason?.kind, 'completed', `${label}: turn did not complete`)
  const headers = turn.events.filter((event) => event.type === 'request/header')
  assert(headers.length > 0, `${label}: completed turn has no request/header`)
  for (const event of headers) {
    const config = event.data.header.config
    assert.equal(config.provider, expected.provider, `${label}: provider at seq ${event.seq}`)
    assert.equal(config.model, expected.model, `${label}: model at seq ${event.seq}`)
    assert.equal(config.reasoningEffort, expected.reasoningEffort, `${label}: effort at seq ${event.seq}`)
  }
  const assistant = turn.events.filter((event) => event.type === 'assistant/message')
  assert(assistant.length > 0, `${label}: completed turn has no assistant/message`)
  return { turn, assistant }
}

function assistantText(assistantEvents) {
  return assistantEvents.flatMap((event) => event.data.message.content)
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

function containsImage(content = []) {
  return content.some((block) => block?.type === 'image'
    || (block?.type === 'tool-result' && containsImage(block.content ?? [])))
}

async function promptAndWait(sessionId, content) {
  const before = rawEvents(await history(sessionId))
  const beforeEndSeq = before.filter((event) => event.type === 'turn/end').at(-1)?.seq ?? 0
  const receipt = await rpc('session.prompt', { sessionId, mode: 'queue', content })
  assert.equal(receipt.accepted, true)
  const complete = await waitUntil(
    `session ${sessionId} turn`,
    async () => rawEvents(await history(sessionId)),
    (events) => events.some((event) => event.type === 'turn/end' && event.seq > beforeEndSeq),
  )
  const turn = lastCompletedTurn(complete)
  assert.equal(turn?.end.data.reason?.kind, 'completed', `session ${sessionId}: turn did not complete`)
  return complete
}

async function runMainRole(role, prompt, options = {}) {
  const sessionId = await createSession()
  if (options.command !== undefined) await command(sessionId, options.command)
  const events = await promptAndWait(sessionId, [{ type: 'text', text: prompt }])
  const evidence = assertCompletedRoute(events, routes[role], role)
  const text = assistantText(evidence.assistant)
  assert(text.length > 0, `${role}: empty assistant text`)
  if (options.matches !== undefined) assert.match(text, options.matches, `${role}: unexpected assistant text`)
  return { sessionId, events, text, evidence }
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii')
  const output = Buffer.alloc(12 + data.length)
  output.writeUInt32BE(data.length, 0)
  name.copy(output, 4)
  data.copy(output, 8)
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length)
  return output
}

function solidRedPngBase64(size = 48) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 2
  const rowBytes = size * 3 + 1
  const pixels = Buffer.alloc(rowBytes * size)
  for (let y = 0; y < size; y += 1) {
    const offset = y * rowBytes
    pixels[offset] = 0
    for (let x = 0; x < size; x += 1) {
      pixels[offset + 1 + x * 3] = 255
      pixels[offset + 2 + x * 3] = 0
      pixels[offset + 3 + x * 3] = 0
    }
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]).toString('base64')
}

async function record(role, run) {
  const startedAt = Date.now()
  try {
    const evidence = await run()
    const result = { role, ok: true, elapsedMs: Date.now() - startedAt, ...evidence }
    results.push(result)
    console.log(`PASS ${role} ${result.elapsedMs}ms ${result.model ?? ''} ${result.sessionId ?? ''}`.trim())
    return result
  } catch (error) {
    const result = { role, ok: false, elapsedMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) }
    results.push(result)
    console.error(`FAIL ${role} ${result.elapsedMs}ms ${result.error}`)
    return result
  }
}

async function recordRole(role, run) {
  if (requestedRoles.size > 0 && !requestedRoles.has(role)) {
    return { role, ok: true, skipped: true }
  }
  return record(role, run)
}

const settings = await settingsRpc('describe')
const configured = new Map(settings.value.roles.map((route) => [route.role, route]))
for (const [role, expected] of Object.entries(routes)) {
  assert.deepEqual(configured.get(role), { role, ...expected }, `${role}: live settings route mismatch`)
}

const defaultResult = await recordRole('default', async () => {
  const run = await runMainRole('default', [
    'This is an ordinary implementation task, neither a tiny mechanical change nor a difficult architecture problem.',
    'Do not use tools. State one practical benefit of input validation, then include the exact marker DEFAULT_OK.',
  ].join(' '), { matches: /DEFAULT_OK/i })
  return { sessionId: run.sessionId, model: routes.default.model }
})

const smolResult = await recordRole('smol', async () => {
  const run = await runMainRole('smol', 'This is a short, cheap, mechanical, low-risk task. Do not use tools. Convert foo-bar to uppercase and include the exact marker SMOL_OK.')
  return { sessionId: run.sessionId, model: routes.smol.model }
})

const slowResult = await recordRole('slow', async () => {
  const run = await runMainRole('slow', 'This is a difficult, high-risk distributed-systems correctness and architecture analysis. Do not use tools. Name one split-brain invariant and include the exact marker SLOW_OK.')
  return { sessionId: run.sessionId, model: routes.slow.model }
})

const designerResult = await recordRole('designer', async () => {
  const run = await runMainRole('designer', 'This is a UI/UX visual interaction and layout design task. Do not use tools. Suggest one dashboard visual-hierarchy improvement and include the exact marker DESIGNER_OK.')
  return { sessionId: run.sessionId, model: routes.designer.model }
})

const commitResult = await recordRole('commit', async () => {
  const run = await runMainRole('commit', 'Generate a Conventional Commit message for adding exponential retry handling. Do not use tools. Include the exact marker COMMIT_OK after the message.')
  return { sessionId: run.sessionId, model: routes.commit.model }
})

await recordRole('vision', async () => {
  const parentSessionId = await createSession()
  const events = await promptAndWait(parentSessionId, [
    { type: 'text', text: 'Inspect the attached image. What is its single dominant color? Do not use tools. Reply with exactly RED.' },
    { type: 'image', mediaType: 'image/png', data: solidRedPngBase64(), name: 'solid-red.png' },
  ])
  const parentTurn = lastCompletedTurn(events)
  assert(parentTurn, 'vision: parent has no completed turn')
  const parentHeaders = parentTurn.events.filter((event) => event.type === 'request/header')
  assert(parentHeaders.length > 0, 'vision: parent completed turn has no request/header')
  assert(parentHeaders.every((event) => event.data.header.config.model !== routes.vision.model),
    'vision: parent remained on the image model')
  const parentAssistant = parentTurn.events.filter((event) => event.type === 'assistant/message')
  assert.match(assistantText(parentAssistant), /^RED[.!]?$/i, 'vision: parent did not use returned analysis')
  assert.equal(events.filter((event) => event.type === 'user/message')
    .some((event) => containsImage(event.data.content)), false, 'vision: image remained in parent model history')
  const returned = events.find((event) => event.type === 'user/message'
    && event.data.source?.kind === 'plugin'
    && event.data.source?.summary === 'Vision analysis')
  assert(returned, 'vision: analysis was not returned to the parent session')
  assert.match(returned.data.content[0].text, /red/i)

  const catalog = await waitUntil(
    'vision subagent catalog',
    () => rpc('subagent.list', { parentSessionId }),
    (value) => value.entries.some((entry) => entry.kind === 'child' && entry.label === 'vision'),
  )
  const child = catalog.entries.find((entry) => entry.kind === 'child' && entry.label === 'vision')
  const childHistory = await rpc('subagent.history', {
    parentSessionId,
    childSessionId: child.id,
    mode: child.mode,
    maxMessages: 200,
  })
  const childEvents = rawEvents(childHistory)
  const evidence = assertCompletedRoute(childEvents, routes.vision, 'vision child')
  assert.match(assistantText(evidence.assistant), /red/i, 'vision: child did not identify the image')
  assert.equal(childEvents.some((event) => event.type === 'tool/call'), false, 'vision: child used a tool')
  return { sessionId: parentSessionId, childSessionId: child.id, model: routes.vision.model }
})

await recordRole('plan', async () => {
  const run = await runMainRole('plan', 'Do not use tools. Give a two-step plan for validating a configuration file and include the exact marker PLAN_OK.', { command: '/plan' })
  assert(run.events.some((event) => event.type === 'plan/mode'), 'plan: /plan did not append plan/mode')
  return { sessionId: run.sessionId, model: routes.plan.model }
})

await recordRole('task', async () => {
  const parentSessionId = await createSession()
  await promptAndWait(parentSessionId, [{
    type: 'text',
    text: [
      'This is a DeepSeek Harness integration test.',
      'You MUST call the subagent tool exactly once with a one-shot child whose task is: “Do not use tools. Reply exactly TASK_CHILD_OK.”',
      'After the child returns, do not call any other tool and include the exact marker TASK_PARENT_OK.',
    ].join(' '),
  }])
  const catalog = await waitUntil(
    'task subagent catalog',
    () => rpc('subagent.list', { parentSessionId }),
    (value) => value.entries.some((entry) => entry.kind === 'child'),
  )
  const child = catalog.entries.find((entry) => entry.kind === 'child')
  const childHistory = await waitUntil(
    'task subagent completion',
    () => rpc('subagent.history', { parentSessionId, childSessionId: child.id, mode: child.mode, maxMessages: 200 }),
    (value) => rawEvents(value).some((event) => event.type === 'turn/end'),
  )
  const evidence = assertCompletedRoute(rawEvents(childHistory), routes.task, 'task')
  assert.match(assistantText(evidence.assistant), /TASK_CHILD_OK/i, 'task: child did not complete its assigned task')
  return { sessionId: parentSessionId, childSessionId: child.id, model: routes.task.model }
})

await recordRole('advisor', async () => {
  const parentSessionId = await createSession()
  await command(parentSessionId, '/advisor on')
  await promptAndWait(parentSessionId, [{ type: 'text', text: 'Do not use tools. Reply exactly ADVISOR_PARENT_OK.' }])
  const catalog = await waitUntil(
    'advisor subagent catalog',
    () => rpc('subagent.list', { parentSessionId }),
    (value) => value.entries.some((entry) => entry.kind === 'child' && entry.label === 'advisor'),
  )
  const child = catalog.entries.find((entry) => entry.kind === 'child' && entry.label === 'advisor')
  const childHistory = await waitUntil(
    'advisor subagent completion',
    () => rpc('subagent.history', { parentSessionId, childSessionId: child.id, mode: child.mode, maxMessages: 200 }),
    (value) => rawEvents(value).some((event) => event.type === 'turn/end'),
  )
  assertCompletedRoute(rawEvents(childHistory), routes.advisor, 'advisor')
  return { sessionId: parentSessionId, childSessionId: child.id, model: routes.advisor.model }
})

await recordRole('tiny', async () => {
  for (const result of [smolResult, slowResult, designerResult, commitResult]) {
    assert(result.ok, `tiny: automatic classifier evidence for ${result.role} failed`)
  }
  assert(defaultResult.ok, 'tiny: default classifier evidence failed')
  return {
    sessionId: defaultResult.sessionId,
    model: routes.tiny.model,
    evidence: 'live tiny classifier selected all five automatic main-task roles',
  }
})

const summary = results.map(({ role, ok, elapsedMs, model, sessionId, childSessionId, error }) => ({
  role, ok, elapsedMs, model, sessionId, childSessionId, error,
}))
console.log(`RESULTS ${JSON.stringify(summary, null, 2)}`)

const failures = results.filter((result) => !result.ok)
if (failures.length > 0) {
  process.exitCode = 1
} else {
  console.log(`PASS all ${results.length} live role tests through ${baseUrl}`)
}
