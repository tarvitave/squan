/**
 * ProcessManager â€” manages agent child processes.
 * Each agent runs in its own Node.js child process for full isolation.
 * Like Goose: each agent is a separate process that can be killed independently.
 */

import { fork, ChildProcess } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { EventEmitter } from 'events'
import { getDb } from '../db/index.js'
import { randomUUID } from 'crypto'

// ESM doesn't have __dirname â€” derive it from import.meta.url
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export interface AgentProcess {
  id: string
  name: string
  pid: number | null
  process: ChildProcess
  status: 'starting' | 'working' | 'done' | 'error' | 'killed'
  messages: any[]
  result: string | null
  totalCost: number
  inputTokens: number
  outputTokens: number
  durationMs: number
  startedAt: number
}

class ProcessManager extends EventEmitter {
  private agents = new Map<string, AgentProcess>()

  /**
   * Spawn a new agent in a child process.
   */
  spawn(opts: {
    id: string
    name: string
    cwd: string
    task: string
    apiKey: string
    model?: string
    provider?: string
    providerUrl?: string
    maxTurns?: number
    extensions?: any[]
  }): AgentProcess {
    // Resolve the worker script path
    const workerPath = join(__dirname, 'agent-worker.js')

    const child = fork(workerPath, [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: opts.apiKey,
      },
      // Don't inherit the server's cwd â€” each agent has its own
      cwd: opts.cwd,
    })

    const agent: AgentProcess = {
      id: opts.id,
      name: opts.name,
      pid: child.pid ?? null,
      process: child,
      status: 'starting',
      messages: [],
      result: null,
      totalCost: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      startedAt: Date.now(),
    }

    this.agents.set(opts.id, agent)

    // Handle IPC messages from the worker
    child.on('message', (msg: any) => {
      switch (msg.type) {
        case 'ready':
          // Worker is ready â€” send the start command
          child.send({
            type: 'start',
            cwd: opts.cwd,
            task: opts.task,
            apiKey: opts.apiKey,
            model: opts.model,
            provider: opts.provider,
            providerUrl: opts.providerUrl,
            maxTurns: opts.maxTurns,
            extensions: opts.extensions,
          })
          // Immediately mark as working â€” don't wait for the first status update
          agent.status = 'working'
          this.emit('status', opts.id, 'working')
          break

        case 'status':
          // Only emit meaningful status changes, skip 'starting' to prevent flash
          if (msg.status === 'error' && agent.status === 'starting') {
            // Suppress error during startup â€” wait for the exit handler
            console.log(`[agent:${opts.name}] Suppressing error during startup`)
            break
          }
          agent.status = msg.status
          this.emit('status', opts.id, msg.status)
          break

        case 'message':
          agent.messages.push(msg.data)
          // Persist message to DB for history
          getDb().execute({ sql: `INSERT INTO workerbee_messages (workerbee_id, message_json) VALUES (?, ?)`, args: [opts.id, JSON.stringify(msg.data)] }).catch(() => {})
          this.emit('message', opts.id, msg.data)
          break

        case 'usage':
          agent.totalCost = msg.totalCost
          agent.inputTokens = msg.inputTokens
          agent.outputTokens = msg.outputTokens
          break

        case 'done':
          agent.result = msg.result
          agent.totalCost = msg.cost
          agent.durationMs = msg.duration
          agent.inputTokens = msg.inputTokens
          agent.outputTokens = msg.outputTokens
          agent.status = msg.isError ? 'error' : 'done'
          // Emit a result message for the chat view
          const resultMsg = {
            type: 'result',
            subtype: msg.isError ? 'error' : 'success',
            result: msg.result,
            total_cost_usd: msg.cost,
            duration_ms: msg.duration,
            num_turns: msg.turns,
            is_error: msg.isError,
          }
          agent.messages.push(resultMsg)
          // Persist result message to DB
          getDb().execute({ sql: `INSERT INTO workerbee_messages (workerbee_id, message_json) VALUES (?, ?)`, args: [opts.id, JSON.stringify(resultMsg)] }).catch(() => {})
          this.emit('message', opts.id, resultMsg)
          this.emit('done', opts.id, msg)
          break
      }
    })

    // Handle child process stdout/stderr (for debugging)
    child.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      if (line) console.log(`[agent:${opts.name}] ${line}`)
    })

    child.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      if (line) console.error(`[agent:${opts.name}:err] ${line}`)
    })

    // Handle child process exit
    child.on('exit', (code, signal) => {
      console.log(`[agent:${opts.name}] Process exited: code=${code} signal=${signal}`)
      if (agent.status === 'working' || agent.status === 'starting') {
        // If the process exits within 5 seconds with a non-zero code,
        // it's likely a startup failure â€” don't flash error in the UI
        const uptime = Date.now() - agent.startedAt
        if (code !== 0 && uptime < 5000) {
          console.warn(`[agent:${opts.name}] Quick exit (${uptime}ms) â€” suppressing error flash`)
          agent.status = 'error'
          agent.result = `Process failed to start (code ${code})`
        } else {
          agent.status = code === 0 ? 'done' : 'error'
          if (!agent.result) {
            agent.result = code === 0 ? 'Process exited normally' : `Process crashed (code ${code})`
          }
        }
        this.emit('status', opts.id, agent.status)
      }
      agent.durationMs = Date.now() - agent.startedAt
    })

    child.on('error', (err) => {
      console.error(`[agent:${opts.name}] Process error:`, err.message)
      // Don't emit error status immediately â€” give the process a chance to recover
      // Only mark as error if it wasn't already done/killed
      if (agent.status !== 'done' && agent.status !== 'killed') {
        agent.status = 'error'
        agent.result = `Process error: ${err.message}`
        this.emit('status', opts.id, 'error')
      }
    })

    console.log(`[process-manager] Spawned agent ${opts.name} (PID ${child.pid}) in ${opts.cwd}`)
    return agent
  }

  /**
   * Kill an agent process.
   */
  kill(id: string): boolean {
    const agent = this.agents.get(id)
    if (!agent) return false

    try {
      // Send kill via IPC first (graceful)
      if (agent.process.connected) {
        agent.process.send({ type: 'kill' })
      }
      // Force kill after 3 seconds
      setTimeout(() => {
        try {
          if (process.platform === 'win32' && agent.pid) {
            require('child_process').execSync(`taskkill /pid ${agent.pid} /t /f`, { stdio: 'ignore' })
          } else {
            agent.process.kill('SIGKILL')
          }
        } catch { /* already dead */ }
      }, 3000)

      agent.status = 'killed'
      agent.result = agent.result ?? 'Killed by user'
      this.emit('status', id, 'killed')
      return true
    } catch {
      return false
    }
  }

  /**
   * Get an agent's state.
   */
  get(id: string): AgentProcess | undefined {
    return this.agents.get(id)
  }

  /**
   * Get all agents.
   */
  getAll(): AgentProcess[] {
    return Array.from(this.agents.values())
  }

  /**
   * Clean up completed/dead agents after a timeout.
   */
  cleanup(maxAgeMs: number = 30 * 60 * 1000) {
    const now = Date.now()
    for (const [id, agent] of this.agents) {
      if (
        (agent.status === 'done' || agent.status === 'error' || agent.status === 'killed') &&
        now - agent.startedAt > maxAgeMs
      ) {
        this.agents.delete(id)
      }
    }
  }
}

export const processManager = new ProcessManager()

