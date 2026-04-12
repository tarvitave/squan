/**
 * Terminal backend manager.
 *
 * Supports two backends:
 * - node-pty (default): in-process PTY, works on all platforms
 * - tmux: crash-resilient, agents survive server restarts (macOS/Linux only)
 *
 * The active backend can be switched at runtime via the settings API.
 * Existing sessions continue on their original backend; only new sessions
 * use the newly selected backend.
 */

import * as pty from 'node-pty'
import { v4 as uuidv4 } from 'uuid'
import { TmuxBackend } from './tmux-backend.js'
import type { TerminalBackend, SpawnOpts } from './backend.js'

// ── node-pty backend ─────────────────────────────────────────────────

const HISTORY_LIMIT = 2000

interface PtySession {
  id: string
  pty: pty.IPty
  subscribers: Map<string, (data: string) => void>
  history: string[]
  ownerUserId: string | null
}

class NodePtyBackend implements TerminalBackend {
  readonly name = 'pty' as const
  private sessions = new Map<string, PtySession>()
  private lastOutputAt = new Map<string, Date>()
  private exitCallbacks = new Map<string, (exitCode: number) => void>()
  private globalExitHandler?: (sessionId: string, exitCode: number) => void

  onAnySessionExit(cb: (sessionId: string, exitCode: number) => void) {
    this.globalExitHandler = cb
  }

  spawn(opts: SpawnOpts): string {
    const id = opts.id ?? uuidv4()
    const requestedShell = opts.shell ?? (process.platform === 'win32' ? 'cmd.exe' : 'bash')
    const requestedArgs = opts.args ?? []

    let shell: string
    let args: string[]
    if (process.platform === 'win32' && requestedShell !== 'cmd.exe' && !requestedShell.endsWith('.exe')) {
      shell = 'cmd.exe'
      args = ['/c', requestedShell, ...requestedArgs]
    } else {
      shell = requestedShell
      args = requestedArgs
    }

    const proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 30,
      cwd: opts.cwd ?? process.env.USERPROFILE ?? process.env.HOME,
      env: { ...process.env, ...(opts.env ?? {}) } as Record<string, string>,
    })

    const session: PtySession = {
      id,
      pty: proc,
      subscribers: new Map(),
      history: [],
      ownerUserId: opts.ownerUserId ?? null,
    }

    proc.onData((data) => {
      this.lastOutputAt.set(id, new Date())
      session.history.push(data)
      if (session.history.length > HISTORY_LIMIT) {
        session.history.shift()
      }
      for (const cb of session.subscribers.values()) {
        cb(data)
      }
    })

    proc.onExit(({ exitCode }) => {
      this.exitCallbacks.get(id)?.(exitCode ?? 0)
      this.exitCallbacks.delete(id)
      this.sessions.delete(id)
      this.lastOutputAt.delete(id)
      this.globalExitHandler?.(id, exitCode ?? 0)
    })

    this.sessions.set(id, session)
    return id
  }

  write(sessionId: string, data: string) {
    this.sessions.get(sessionId)?.pty.write(data)
  }

  resize(sessionId: string, cols: number, rows: number) {
    this.sessions.get(sessionId)?.pty.resize(cols, rows)
  }

  subscribe(sessionId: string, clientId: string, cb: (data: string) => void) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    for (const chunk of session.history) {
      cb(chunk)
    }
    session.subscribers.set(clientId, cb)
  }

  unsubscribe(sessionId: string, clientId: string) {
    this.sessions.get(sessionId)?.subscribers.delete(clientId)
  }

  kill(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.pty.kill()
      this.sessions.delete(sessionId)
    }
  }

  list(): string[] {
    return Array.from(this.sessions.keys())
  }

  getLastOutputAt(sessionId: string): Date | null {
    return this.lastOutputAt.get(sessionId) ?? null
  }

  getHistory(sessionId: string): string[] {
    return this.sessions.get(sessionId)?.history ?? []
  }

  onSessionExit(sessionId: string, cb: (exitCode: number) => void) {
    this.exitCallbacks.set(sessionId, cb)
  }

  getOwnerUserId(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.ownerUserId ?? null
  }
}

// ── Unified manager that delegates to the active backend ─────────────

class PtyManager implements TerminalBackend {
  readonly name = 'pty' as const // default name, overridden by active backend
  private ptyBackend: NodePtyBackend
  private tmuxBackend: TmuxBackend | null = null
  private _activeBackendName: 'pty' | 'tmux' = 'pty'

  constructor() {
    this.ptyBackend = new NodePtyBackend()

    // Auto-detect tmux availability
    if (process.platform !== 'win32' && TmuxBackend.isAvailable()) {
      this.tmuxBackend = new TmuxBackend()
      console.log('[pty] tmux backend available')
    } else {
      console.log('[pty] tmux not available, using node-pty only')
    }
  }

  // ── Backend selection ──────────────────────────────────────────────

  get activeBackendName(): 'pty' | 'tmux' {
    return this._activeBackendName
  }

  get tmuxAvailable(): boolean {
    return this.tmuxBackend !== null
  }

  setBackend(name: 'pty' | 'tmux'): boolean {
    if (name === 'tmux' && !this.tmuxBackend) {
      console.warn('[pty] Cannot switch to tmux — not available on this platform')
      return false
    }
    const previous = this._activeBackendName
    this._activeBackendName = name
    console.log(`[pty] Backend switched: ${previous} → ${name}`)
    return true
  }

  private get active(): TerminalBackend {
    if (this._activeBackendName === 'tmux' && this.tmuxBackend) {
      return this.tmuxBackend
    }
    return this.ptyBackend
  }

  // ── Reconnection (tmux only) ──────────────────────────────────────

  reconnectTmuxSessions(): string[] {
    if (!this.tmuxBackend) return []
    const existing = TmuxBackend.listExistingSessions()
    const reconnected: string[] = []
    for (const tmuxName of existing) {
      const id = this.tmuxBackend.reconnect(tmuxName)
      if (id) reconnected.push(id)
    }
    if (reconnected.length > 0) {
      console.log(`[pty] Reconnected ${reconnected.length} tmux sessions`)
    }
    return reconnected
  }

  // ── Delegated interface ───────────────────────────────────────────

  spawn(opts: SpawnOpts): string {
    return this.active.spawn(opts)
  }

  write(sessionId: string, data: string): void {
    // Try both backends (session could be on either)
    if (this.ptyBackend.list().includes(sessionId)) {
      this.ptyBackend.write(sessionId, data)
    } else if (this.tmuxBackend?.list().includes(sessionId)) {
      this.tmuxBackend.write(sessionId, data)
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    if (this.ptyBackend.list().includes(sessionId)) {
      this.ptyBackend.resize(sessionId, cols, rows)
    } else if (this.tmuxBackend?.list().includes(sessionId)) {
      this.tmuxBackend.resize(sessionId, cols, rows)
    }
  }

  subscribe(sessionId: string, clientId: string, cb: (data: string) => void): void {
    if (this.ptyBackend.list().includes(sessionId)) {
      this.ptyBackend.subscribe(sessionId, clientId, cb)
    } else if (this.tmuxBackend?.list().includes(sessionId)) {
      this.tmuxBackend.subscribe(sessionId, clientId, cb)
    }
  }

  unsubscribe(sessionId: string, clientId: string): void {
    this.ptyBackend.unsubscribe(sessionId, clientId)
    this.tmuxBackend?.unsubscribe(sessionId, clientId)
  }

  kill(sessionId: string): void {
    if (this.ptyBackend.list().includes(sessionId)) {
      this.ptyBackend.kill(sessionId)
    } else if (this.tmuxBackend?.list().includes(sessionId)) {
      this.tmuxBackend.kill(sessionId)
    }
  }

  list(): string[] {
    const ptyList = this.ptyBackend.list()
    const tmuxList = this.tmuxBackend?.list() ?? []
    return [...ptyList, ...tmuxList]
  }

  getLastOutputAt(sessionId: string): Date | null {
    return this.ptyBackend.getLastOutputAt(sessionId) ?? this.tmuxBackend?.getLastOutputAt(sessionId) ?? null
  }

  getHistory(sessionId: string): string[] {
    const ptyHistory = this.ptyBackend.getHistory(sessionId)
    if (ptyHistory.length > 0) return ptyHistory
    return this.tmuxBackend?.getHistory(sessionId) ?? []
  }

  onSessionExit(sessionId: string, cb: (exitCode: number) => void): void {
    if (this.ptyBackend.list().includes(sessionId)) {
      this.ptyBackend.onSessionExit(sessionId, cb)
    } else if (this.tmuxBackend?.list().includes(sessionId)) {
      this.tmuxBackend.onSessionExit(sessionId, cb)
    }
  }

  onAnySessionExit(cb: (sessionId: string, exitCode: number) => void): void {
    this.ptyBackend.onAnySessionExit(cb)
    this.tmuxBackend?.onAnySessionExit(cb)
  }

  getOwnerUserId(sessionId: string): string | null {
    return this.ptyBackend.getOwnerUserId(sessionId) ?? this.tmuxBackend?.getOwnerUserId(sessionId) ?? null
  }
}

export const ptyManager = new PtyManager()
