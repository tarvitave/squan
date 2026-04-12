/**
 * tmux terminal backend.
 *
 * Each agent runs in its own tmux session. If the Squan server crashes,
 * agents keep running and can be reconnected on restart.
 *
 * Requirements: `tmux` must be installed and in PATH.
 * Not available on Windows (use node-pty backend instead).
 */

import { execFileSync, execFile } from 'child_process'
import { v4 as uuidv4 } from 'uuid'
import { existsSync, mkdirSync, unlinkSync, writeFileSync, statSync, openSync, readSync, closeSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { TerminalBackend, SpawnOpts } from './backend.js'

const HISTORY_LIMIT = 2000
const POLL_INTERVAL_MS = 250 // output polling interval
const SQUAN_TMUX_PREFIX = 'squan-'

interface TmuxSession {
  id: string
  tmuxName: string  // tmux session name (squan-<id>)
  pipePath: string  // fifo/log file for output capture
  subscribers: Map<string, (data: string) => void>
  history: string[]
  ownerUserId: string | null
  lastOutputAt: Date | null
  pollTimer: ReturnType<typeof setInterval> | null
  exitCallbacks: Array<(exitCode: number) => void>
  dead: boolean
}

export class TmuxBackend implements TerminalBackend {
  readonly name = 'tmux' as const
  private sessions = new Map<string, TmuxSession>()
  private globalExitHandler?: (sessionId: string, exitCode: number) => void
  private logDir: string

  constructor() {
    this.logDir = join(tmpdir(), 'squan-tmux-logs')
    mkdirSync(this.logDir, { recursive: true })
  }

  /** Check if tmux is available on this system */
  static isAvailable(): boolean {
    try {
      execFileSync('tmux', ['-V'], { stdio: 'pipe' })
      return true
    } catch {
      return false
    }
  }

  /** List existing squan tmux sessions (for reconnect after crash) */
  static listExistingSessions(): string[] {
    try {
      const output = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], { stdio: 'pipe' }).toString().trim()
      if (!output) return []
      return output.split('\n').filter((s) => s.startsWith(SQUAN_TMUX_PREFIX))
    } catch {
      return []
    }
  }

  spawn(opts: SpawnOpts): string {
    const id = opts.id ?? uuidv4()
    const tmuxName = `${SQUAN_TMUX_PREFIX}${id}`
    const shell = opts.shell ?? 'bash'
    const args = opts.args ?? []
    const cwd = opts.cwd ?? process.env.HOME ?? '/tmp'

    // Build the command to run inside tmux
    const fullCmd = [shell, ...args].map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')

    // Build environment exports
    const envExports = Object.entries(opts.env ?? {})
      .map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`)
      .join('; ')

    // Create the log file for output capture
    const pipePath = join(this.logDir, `${id}.log`)
    writeFileSync(pipePath, '', 'utf8')

    // Create tmux session with the command
    const tmuxCmd = envExports ? `${envExports}; ${fullCmd}` : fullCmd
    try {
      execFileSync('tmux', [
        'new-session',
        '-d',                  // detached
        '-s', tmuxName,        // session name
        '-x', String(opts.cols ?? 120),
        '-y', String(opts.rows ?? 30),
        tmuxCmd,
      ], {
        cwd,
        env: { ...process.env, ...(opts.env ?? {}) },
        stdio: 'pipe',
      })
    } catch (err) {
      console.error(`[tmux] Failed to create session ${tmuxName}:`, err)
      throw err
    }

    // Set up output capture via pipe-pane
    try {
      execFileSync('tmux', ['pipe-pane', '-t', tmuxName, `cat >> '${pipePath}'`], { stdio: 'pipe' })
    } catch (err) {
      console.warn(`[tmux] pipe-pane failed for ${tmuxName}:`, err)
    }

    const session: TmuxSession = {
      id,
      tmuxName,
      pipePath,
      subscribers: new Map(),
      history: [],
      ownerUserId: opts.ownerUserId ?? null,
      lastOutputAt: null,
      pollTimer: null,
      exitCallbacks: [],
      dead: false,
    }

    this.sessions.set(id, session)

    // Start polling the log file for new output
    this.startPolling(session)

    // Start monitoring for session exit
    this.monitorExit(session)

    console.log(`[tmux] Spawned session ${tmuxName} (id: ${id})`)
    return id
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.dead) return

    // tmux send-keys sends literal text. For special keys we need to handle them:
    // - \r → Enter
    // - \x1b[B → Down arrow
    // - \x1b[A → Up arrow

    // Split data into chunks that can be sent
    if (data === '\r' || data === '\n') {
      execFile('tmux', ['send-keys', '-t', session.tmuxName, 'Enter'], () => {})
    } else if (data === '\x1b[B') {
      execFile('tmux', ['send-keys', '-t', session.tmuxName, 'Down'], () => {})
    } else if (data === '\x1b[A') {
      execFile('tmux', ['send-keys', '-t', session.tmuxName, 'Up'], () => {})
    } else if (data.endsWith('\r') || data.endsWith('\n')) {
      const text = data.slice(0, -1)
      if (text) {
        execFile('tmux', ['send-keys', '-t', session.tmuxName, '-l', text], () => {
          execFile('tmux', ['send-keys', '-t', session.tmuxName, 'Enter'], () => {})
        })
      } else {
        execFile('tmux', ['send-keys', '-t', session.tmuxName, 'Enter'], () => {})
      }
    } else {
      execFile('tmux', ['send-keys', '-t', session.tmuxName, '-l', data], () => {})
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.dead) return
    execFile('tmux', ['resize-window', '-t', session.tmuxName, '-x', String(cols), '-y', String(rows)], () => {})
  }

  subscribe(sessionId: string, clientId: string, cb: (data: string) => void): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    // Replay history
    for (const chunk of session.history) {
      cb(chunk)
    }
    session.subscribers.set(clientId, cb)
  }

  unsubscribe(sessionId: string, clientId: string): void {
    this.sessions.get(sessionId)?.subscribers.delete(clientId)
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.dead = true
    if (session.pollTimer) clearInterval(session.pollTimer)

    try {
      execFileSync('tmux', ['kill-session', '-t', session.tmuxName], { stdio: 'pipe' })
    } catch {
      // Session may already be dead
    }

    // Clean up log file
    try { unlinkSync(session.pipePath) } catch { /* ignore */ }

    this.sessions.delete(sessionId)
  }

  list(): string[] {
    return Array.from(this.sessions.keys())
  }

  getLastOutputAt(sessionId: string): Date | null {
    return this.sessions.get(sessionId)?.lastOutputAt ?? null
  }

  getHistory(sessionId: string): string[] {
    return this.sessions.get(sessionId)?.history ?? []
  }

  onSessionExit(sessionId: string, cb: (exitCode: number) => void): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.exitCallbacks.push(cb)
    }
  }

  onAnySessionExit(cb: (sessionId: string, exitCode: number) => void): void {
    this.globalExitHandler = cb
  }

  getOwnerUserId(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.ownerUserId ?? null
  }

  // ── Reconnection (the killer feature) ──────────────────────────────

  /**
   * Reconnect to an existing tmux session that survived a server crash.
   * Returns the session ID if successful.
   */
  reconnect(tmuxName: string, ownerUserId?: string): string | null {
    // Check if session actually exists
    try {
      execFileSync('tmux', ['has-session', '-t', tmuxName], { stdio: 'pipe' })
    } catch {
      return null
    }

    const id = tmuxName.replace(SQUAN_TMUX_PREFIX, '')
    const pipePath = join(this.logDir, `${id}.log`)
    writeFileSync(pipePath, '', 'utf8')

    // Re-attach pipe-pane
    try {
      execFileSync('tmux', ['pipe-pane', '-t', tmuxName, `cat >> '${pipePath}'`], { stdio: 'pipe' })
    } catch { /* ignore */ }

    const session: TmuxSession = {
      id,
      tmuxName,
      pipePath,
      subscribers: new Map(),
      history: [],
      ownerUserId: ownerUserId ?? null,
      lastOutputAt: null,
      pollTimer: null,
      exitCallbacks: [],
      dead: false,
    }

    // Capture current pane content as initial history
    try {
      const content = execFileSync('tmux', ['capture-pane', '-t', tmuxName, '-p', '-S', '-200'], { stdio: 'pipe' }).toString()
      if (content) {
        session.history.push(content)
      }
    } catch { /* ignore */ }

    this.sessions.set(id, session)
    this.startPolling(session)
    this.monitorExit(session)

    console.log(`[tmux] Reconnected to session ${tmuxName} (id: ${id})`)
    return id
  }

  // ── Internal helpers ───────────────────────────────────────────────

  private startPolling(session: TmuxSession): void {
    let lastSize = 0

    session.pollTimer = setInterval(() => {
      if (session.dead) return

      try {
        const stat = statSync(session.pipePath)
        if (stat.size > lastSize) {
          const fd = openSync(session.pipePath, 'r')
          const buf = Buffer.alloc(stat.size - lastSize)
          readSync(fd, buf, 0, buf.length, lastSize)
          closeSync(fd)
          lastSize = stat.size

          const data = buf.toString('utf8')
          if (data) {
            session.lastOutputAt = new Date()
            session.history.push(data)
            if (session.history.length > HISTORY_LIMIT) {
              session.history.shift()
            }
            for (const cb of session.subscribers.values()) {
              cb(data)
            }
          }
        }
      } catch {
        // File may have been deleted
      }
    }, POLL_INTERVAL_MS)
  }

  private monitorExit(session: TmuxSession): void {
    const check = setInterval(() => {
      if (session.dead) {
        clearInterval(check)
        return
      }

      try {
        execFileSync('tmux', ['has-session', '-t', session.tmuxName], { stdio: 'pipe' })
      } catch {
        // Session no longer exists — it exited
        session.dead = true
        clearInterval(check)
        if (session.pollTimer) clearInterval(session.pollTimer)

        console.log(`[tmux] Session ${session.tmuxName} exited`)

        for (const cb of session.exitCallbacks) {
          cb(0) // tmux doesn't easily give us exit codes; default to 0
        }
        this.globalExitHandler?.(session.id, 0)

        // Clean up
        try { unlinkSync(session.pipePath) } catch { /* ignore */ }
        this.sessions.delete(session.id)
      }
    }, 1000)
  }

  /** Shut down all sessions and clean up */
  shutdown(): void {
    for (const session of this.sessions.values()) {
      session.dead = true
      if (session.pollTimer) clearInterval(session.pollTimer)
      try { unlinkSync(session.pipePath) } catch { /* ignore */ }
    }
    this.sessions.clear()
  }
}
