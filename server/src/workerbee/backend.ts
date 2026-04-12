/**
 * Abstract interface for terminal backends.
 * Both node-pty and tmux implement this same interface so the rest of the
 * codebase doesn't need to know which backend is active.
 */

export interface SpawnOpts {
  id?: string
  shell?: string
  args?: string[]
  cwd?: string
  cols?: number
  rows?: number
  env?: Record<string, string>
  ownerUserId?: string
}

export interface TerminalBackend {
  readonly name: 'pty' | 'tmux'

  spawn(opts: SpawnOpts): string
  write(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
  subscribe(sessionId: string, clientId: string, cb: (data: string) => void): void
  unsubscribe(sessionId: string, clientId: string): void
  kill(sessionId: string): void
  list(): string[]
  getLastOutputAt(sessionId: string): Date | null
  getHistory(sessionId: string): string[]
  onSessionExit(sessionId: string, cb: (exitCode: number) => void): void
  onAnySessionExit(cb: (sessionId: string, exitCode: number) => void): void
  getOwnerUserId(sessionId: string): string | null
}
