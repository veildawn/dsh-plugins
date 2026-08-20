import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TerminalSession, SessionManager } from '../lib/core.js'

describe('TerminalSession output buffering and reading', () => {
  it('records incremental output and computes offsets', () => {
    let onDataCb = null
    const mockPty = {
      onData: (fn) => { onDataCb = fn },
      onExit: () => {},
      write: () => {},
      resize: () => {},
      kill: () => {},
    }

    const session = new TerminalSession({
      id: 'test-term-1',
      ptyHandle: mockPty,
      shell: 'pwsh',
      shellPath: 'pwsh.exe',
      cwd: 'D:\\CodeSpace',
    })

    assert.equal(session.id, 'test-term-1')
    assert.equal(session.offset, 0)

    // Simulate PTY output chunks
    onDataCb('Hello ')
    onDataCb('World!\r\n')

    const read1 = session.readFrom(0)
    assert.equal(read1.data, 'Hello World!\r\n')
    assert.equal(read1.nextOffset, 14)
    assert.equal(read1.lossy, false)

    // Subsequent incremental read from offset
    onDataCb('Prompt> ')
    const read2 = session.readFrom(read1.nextOffset)
    assert.equal(read2.data, 'Prompt> ')
    assert.equal(read2.nextOffset, 22)
  })

  it('handles ring buffer eviction under high volume', () => {
    const session = new TerminalSession({
      id: 'test-term-overflow',
      ptyHandle: null,
      shell: 'bash',
      shellPath: '/bin/bash',
      cwd: '/home',
      maxBufferBytes: 100, // Small limit for testing
    })

    session.append('A'.repeat(80))
    session.append('B'.repeat(80))

    const read = session.readFrom(0)
    assert.ok(read.lossy, 'read from 0 should be marked lossy after eviction')
    assert.ok(session.headOffset > 0, 'headOffset must advance')
    assert.ok(read.data.includes('B'), 'recent data must be kept')
  })

  it('SessionManager manages sessions lifecycle', () => {
    const mgr = new SessionManager()
    let killed = false
    const mockSession = new TerminalSession({
      id: 'term-mgr-test',
      ptyHandle: { kill: () => { killed = true } },
      shell: 'sh',
      shellPath: '/bin/sh',
      cwd: '/tmp',
    })

    mgr.add(mockSession)
    assert.equal(mgr.list().length, 1)
    assert.equal(mgr.get('term-mgr-test'), mockSession)

    const ok = mgr.remove('term-mgr-test')
    assert.equal(ok, true)
    assert.equal(killed, true)
    assert.equal(mgr.list().length, 0)
  })
})
