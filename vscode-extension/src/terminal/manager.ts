import * as vscode from 'vscode'
import { v4 as uuidv4 } from 'uuid'

export interface SpawnOptions {
  name: string
  shellPath: string
  shellArgs: string[]
  cwd: string
  env: Record<string, string>
}

const RING_BUFFER_SIZE = 4000

export class VsTerminalManager implements vscode.Disposable {
  private terminals: Map<string, vscode.Terminal> = new Map()
  private outputBuffers: Map<string, string> = new Map()
  private subscribers: Map<string, Map<string, (data: string) => void>> = new Map()
  private exitCallbacks: Map<string, Array<(code: number) => void>> = new Map()
  private terminalToId: Map<vscode.Terminal, string> = new Map()
  private disposables: vscode.Disposable[] = []

  constructor(_context: vscode.ExtensionContext) {
    // Route terminal data to subscribers and ring buffer
    const dataListener = (vscode.window as any).onDidWriteTerminalData((e: any) => {
      const id = this.terminalToId.get(e.terminal)
      if (!id) return

      // Append to ring buffer (keep last RING_BUFFER_SIZE chars)
      const prev = this.outputBuffers.get(id) ?? ''
      const next = (prev + e.data).slice(-RING_BUFFER_SIZE)
      this.outputBuffers.set(id, next)

      // Notify all subscribers
      const subs = this.subscribers.get(id)
      if (subs) {
        for (const cb of subs.values()) {
          try { cb(e.data) } catch { /* ignore subscriber errors */ }
        }
      }
    })

    // Fire exit callbacks when terminal closes
    const closeListener = vscode.window.onDidCloseTerminal((terminal) => {
      const id = this.terminalToId.get(terminal)
      if (!id) return

      const callbacks = this.exitCallbacks.get(id) ?? []
      for (const cb of callbacks) {
        try { cb(0) } catch { /* ignore */ }
      }

      // Cleanup
      this.terminals.delete(id)
      this.outputBuffers.delete(id)
      this.subscribers.delete(id)
      this.exitCallbacks.delete(id)
      this.terminalToId.delete(terminal)
    })

    this.disposables.push(dataListener, closeListener)
  }

  /**
   * Spawn a new terminal and return its ID.
   */
  spawn(opts: SpawnOptions): string {
    const id = uuidv4()

    // Merge current process env with provided env overrides
    const mergedEnv: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) mergedEnv[k] = v
    }
    for (const [k, v] of Object.entries(opts.env)) {
      mergedEnv[k] = v
    }

    const terminal = vscode.window.createTerminal({
      name: opts.name,
      shellPath: opts.shellPath,
      shellArgs: opts.shellArgs,
      cwd: opts.cwd,
      env: mergedEnv,
      isTransient: false,
    })

    this.terminals.set(id, terminal)
    this.outputBuffers.set(id, '')
    this.subscribers.set(id, new Map())
    this.exitCallbacks.set(id, [])
    this.terminalToId.set(terminal, id)

    return id
  }

  /**
   * Write data to a terminal. The `false` parameter prevents VSCode from adding a newline.
   */
  write(id: string, data: string): void {
    const terminal = this.terminals.get(id)
    if (terminal) {
      terminal.sendText(data, false)
    }
  }

  /**
   * Kill (dispose) a terminal.
   */
  kill(id: string): void {
    const terminal = this.terminals.get(id)
    if (terminal) {
      terminal.dispose()
      // onDidCloseTerminal will handle cleanup
    }
  }

  /**
   * Show a terminal in the UI.
   */
  show(id: string): void {
    const terminal = this.terminals.get(id)
    if (terminal) {
      terminal.show()
    }
  }

  /**
   * Subscribe to output from a terminal.
   */
  subscribe(id: string, subscriberId: string, cb: (data: string) => void): void {
    let subs = this.subscribers.get(id)
    if (!subs) {
      subs = new Map()
      this.subscribers.set(id, subs)
    }
    subs.set(subscriberId, cb)
  }

  /**
   * Unsubscribe from terminal output.
   */
  unsubscribe(id: string, subscriberId: string): void {
    const subs = this.subscribers.get(id)
    if (subs) {
      subs.delete(subscriberId)
    }
  }

  /**
   * Register a callback for when a terminal session exits.
   */
  onSessionExit(id: string, cb: (code: number) => void): void {
    let callbacks = this.exitCallbacks.get(id)
    if (!callbacks) {
      callbacks = []
      this.exitCallbacks.set(id, callbacks)
    }
    callbacks.push(cb)
  }

  /**
   * Get the current output buffer for a terminal.
   */
  getBuffer(id: string): string {
    return this.outputBuffers.get(id) ?? ''
  }

  /**
   * List all active terminal IDs.
   */
  list(): string[] {
    return Array.from(this.terminals.keys())
  }

  /**
   * Dispose all terminals and listeners.
   */
  dispose(): void {
    for (const terminal of this.terminals.values()) {
      try { terminal.dispose() } catch { /* ignore */ }
    }
    this.terminals.clear()
    this.outputBuffers.clear()
    this.subscribers.clear()
    this.exitCallbacks.clear()
    this.terminalToId.clear()

    for (const d of this.disposables) {
      try { d.dispose() } catch { /* ignore */ }
    }
    this.disposables = []
  }
}
