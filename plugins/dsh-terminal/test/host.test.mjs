import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { handleRpc, sessionManager, resolveWorkingDir } from '../lib/index.js'

describe('Host RPC dispatch and session interactions', () => {
  const mockCtx = {
    sessions: {
      get: (id) => (id === 'sess-1' ? { header: { cwd: 'D:\\ProjectA' } } : undefined),
    },
    workspaceRegistry: {
      list: () => [{ path: 'D:\\DefaultWorkspace' }],
    },
  }

  const options = () => ({ scrollbackMaxBytes: 1024 * 1024 })

  it('resolves working directories from session and fallback workspace', () => {
    assert.equal(resolveWorkingDir(mockCtx, 'sess-1'), 'D:\\ProjectA')
    assert.equal(resolveWorkingDir(mockCtx, 'non-existent'), 'D:\\DefaultWorkspace')
    assert.ok(resolveWorkingDir({}, null).length > 0)
  })

  it('handles shells query', async () => {
    const res = await handleRpc(mockCtx, options, 'shells', {})
    assert.equal(res.ok, true)
    assert.ok(res.value.defaultShell)
    assert.ok(Array.isArray(res.value.available))
  })

  it('creates, writes, polls, resizes, and closes a terminal session', async () => {
    // 1. Create
    const createRes = await handleRpc(mockCtx, options, 'create', {
      cols: 80,
      rows: 24,
      sessionId: 'sess-1',
    })
    assert.equal(createRes.ok, true)
    const termId = createRes.value.id
    assert.ok(termId)
    assert.equal(createRes.value.cwd, 'D:\\ProjectA')

    // 2. Write
    const writeRes = await handleRpc(mockCtx, options, 'write', {
      id: termId,
      data: 'echo HELLO_DSH_TEST\r',
    })
    assert.equal(writeRes.ok, true)

    // 3. Resize
    const resizeRes = await handleRpc(mockCtx, options, 'resize', {
      id: termId,
      cols: 100,
      rows: 30,
    })
    assert.equal(resizeRes.ok, true)

    // 4. Poll
    // Wait brief moment for PTY child echo
    await new Promise((r) => setTimeout(r, 200))
    const pollRes = await handleRpc(mockCtx, options, 'poll', {
      id: termId,
      offset: 0,
    })
    assert.equal(pollRes.ok, true)
    assert.ok(typeof pollRes.value.data === 'string')
    assert.ok(pollRes.value.nextOffset >= 0)

    // 5. Close
    const closeRes = await handleRpc(mockCtx, options, 'close', { id: termId })
    assert.equal(closeRes.ok, true)
    assert.equal(closeRes.value.closed, true)

    // Subsequent poll on closed session returns error
    const pollAfterClose = await handleRpc(mockCtx, options, 'poll', { id: termId })
    assert.equal(pollAfterClose.ok, false)
    assert.equal(pollAfterClose.error.code, 'not-found')
  })
})
