/**
 * Terminal session and output buffer management.
 * @module dsh-terminal/core
 */
import { randomUUID } from 'node:crypto'

/** Default maximum retained output memory buffer size (1MB). */
export const DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024

/**
 * Encapsulates one running terminal PTY session, tracking its accumulated
 * output stream and lifecycle.
 */
export class TerminalSession {
  /**
   * @param {object} options
   * @param {string} [options.id]
   * @param {object} options.ptyHandle - node-pty process handle
   * @param {string} options.shell - Display name of shell
   * @param {string} options.shellPath - Path to shell executable
   * @param {string} options.cwd - Working directory
   * @param {number} [options.maxBufferBytes]
   */
  constructor({ id, ptyHandle, shell, shellPath, cwd, maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES }) {
    this.id = id || randomUUID()
    this.pty = ptyHandle
    this.shell = shell
    this.shellPath = shellPath
    this.cwd = cwd
    this.createdAt = Date.now()
    this.maxBufferBytes = maxBufferBytes
    this.buffer = ''
    this.offset = 0 // total bytes written so far
    this.headOffset = 0 // offset at beginning of current in-memory buffer
    this.exited = false
    this.exitCode = null
    this.signal = null

    if (this.pty) {
      if (typeof this.pty.onData === 'function') {
        this.pty.onData((data) => {
          this.append(data)
        })
      }
      if (typeof this.pty.onExit === 'function') {
        this.pty.onExit(({ exitCode, signal }) => {
          this.exited = true
          this.exitCode = exitCode ?? null
          this.signal = signal ?? null
        })
      }
    }
  }

  /**
   * Append raw chunk to output buffer and maintain bound.
   * @param {string} data
   */
  append(data) {
    if (typeof data !== 'string' || data.length === 0) return
    this.buffer += data
    const chunkBytes = Buffer.byteLength(data, 'utf8')
    this.offset += chunkBytes

    // Sliding window buffer eviction if exceeding capacity
    const currentBytes = Buffer.byteLength(this.buffer, 'utf8')
    if (currentBytes > this.maxBufferBytes) {
      const dropCount = Math.floor(currentBytes - this.maxBufferBytes * 0.75)
      const buf = Buffer.from(this.buffer, 'utf8')
      const kept = buf.subarray(dropCount)
      this.buffer = kept.toString('utf8')
      this.headOffset = this.offset - Buffer.byteLength(this.buffer, 'utf8')
    }
  }

  /**
   * Read output delta since client-supplied byte offset.
   * @param {number} fromOffset
   * @returns {{ data: string, nextOffset: number, headOffset: number, lossy: boolean, exited: boolean, exitCode: number | null }}
   */
  readFrom(fromOffset = 0) {
    const lossy = fromOffset < this.headOffset
    let data = ''
    if (fromOffset >= this.offset) {
      data = ''
    } else if (lossy || fromOffset <= this.headOffset) {
      data = this.buffer
    } else {
      // Calculate substring corresponding to byte offset
      const buf = Buffer.from(this.buffer, 'utf8')
      const sliceStart = Math.max(0, fromOffset - this.headOffset)
      data = buf.subarray(sliceStart).toString('utf8')
    }

    return {
      data,
      nextOffset: this.offset,
      headOffset: this.headOffset,
      lossy,
      exited: this.exited,
      exitCode: this.exitCode,
    }
  }

  /**
   * Write data into PTY stdin.
   * @param {string} data
   */
  write(data) {
    if (this.exited) return
    if (this.pty && typeof this.pty.write === 'function') {
      this.pty.write(data)
    }
  }

  /**
   * Resize PTY dimensions.
   * @param {number} cols
   * @param {number} rows
   */
  resize(cols, rows) {
    if (this.exited) return
    const validCols = Math.max(10, Math.min(cols || 80, 500))
    const validRows = Math.max(2, Math.min(rows || 24, 200))
    if (this.pty && typeof this.pty.resize === 'function') {
      try {
        this.pty.resize(validCols, validRows)
      } catch (_) {}
    }
  }

  /**
   * Terminate and destroy session.
   */
  kill() {
    this.exited = true
    if (this.pty && typeof this.pty.kill === 'function') {
      try {
        this.pty.kill()
      } catch (_) {}
    }
  }
}

/**
 * Manages all active terminal sessions on the host.
 */
export class SessionManager {
  constructor() {
    /** @type {Map<string, TerminalSession>} */
    this.sessions = new Map()
  }

  /**
   * Register an existing or freshly spawned session.
   * @param {TerminalSession} session
   */
  add(session) {
    this.sessions.set(session.id, session)
  }

  /**
   * Retrieve session by ID.
   * @param {string} id
   * @returns {TerminalSession | undefined}
   */
  get(id) {
    return this.sessions.get(id)
  }

  /**
   * List summary snapshots of all sessions.
   */
  list() {
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      shell: s.shell,
      shellPath: s.shellPath,
      cwd: s.cwd,
      createdAt: s.createdAt,
      exited: s.exited,
      exitCode: s.exitCode,
    }))
  }

  /**
   * Kill and remove session.
   * @param {string} id
   */
  remove(id) {
    const session = this.sessions.get(id)
    if (session) {
      session.kill()
      this.sessions.delete(id)
      return true
    }
    return false
  }

  /**
   * Teardown all sessions on host exit.
   */
  dispose() {
    for (const session of this.sessions.values()) {
      session.kill()
    }
    this.sessions.clear()
  }
}
