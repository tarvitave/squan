import * as pty from 'node-pty'
import { v4 as uuidv4 } from 'uuid'

// A single running pseudo-terminal
interface PtySession {
  id: string
  pty: pty.IPty
  // clientId → data callback
  subscribers: Map<string, (data: string) => void>
  history: string[]  // ring buffer of recent output for new subscribers
  ownerUserId: string | null  // userId of the user who created this session
}

const HISTORY_LIMIT = 2000 // lines

class PtyManager {
  private sessions = new Map<string, PtySession>()
  private lastOutputAt = new Map<string, Date>()
  private exitCallbacks = new Map<string, (exitCode: number) => void>()
  private globalExitHandler?: (sessionId: string, exitCode: number) => void

  onAnySessionExit(cb: (sessionId: string, exitCode: number) => void) {
    this.globalExitHandler = cb
  }

  spawn(opts: {
    id?: string
    shell?: string
    args?: string[]
    cwd?: string
    cols?: number
    rows?: number
    env?: Record<string, string>
    ownerUserId?: string
  }): string {
    const id = opts.id ?? uuidv4()
    const requestedShell = opts.shell ?? (process.platform === 'win32' ? 'cmd.exe' : 'bash')
    const requestedArgs = opts.args ?? []

    // On Windows, node-pty cannot spawn .cmd/.bat files directly -- wrap with cmd.exe /c
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
      // Append to history ring buffer
      session.history.push(data)
      if (session.history.length > HISTORY_LIMIT) {
        session.history.shift()
      }
      // Broadcast to all subscribers
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
    // Replay history to new subscriber
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

export const ptyManager = new PtyManager()
