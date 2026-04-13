/**
 * ProcessManager — manages agent child processes.
 * Each agent runs in its own Node.js child process for full isolation.
 * Like Goose: each agent is a separate process that can be killed independently.
 */

import { fork, ChildProcess } from 'child_process'
import { join } from 'path'
import { EventEmitter } from 'events'

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
    maxTurns?: number
  }): AgentProcess {
    // Resolve the worker script path
    const workerPath = join(__dirname, 'agent-worker.js')

    const child = fork(workerPath, [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: opts.apiKey,
      },
      // Don't inherit the server's cwd — each agent has its own
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
          // Worker is ready — send the start command
          child.send({
            type: 'start',
            cwd: opts.cwd,
            task: opts.task,
            apiKey: opts.apiKey,
            model: opts.model,
            maxTurns: opts.maxTurns,
          })
          break

        case 'status':
          agent.status = msg.status
          this.emit('status', opts.id, msg.status)
          break

        case 'message':
          agent.messages.push(msg.data)
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
          agent.messages.push({
            type: 'result',
            subtype: msg.isError ? 'error' : 'success',
            result: msg.result,
            total_cost_usd: msg.cost,
            duration_ms: msg.duration,
            num_turns: msg.turns,
            is_error: msg.isError,
          })
          this.emit('message', opts.id, agent.messages[agent.messages.length - 1])
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
        agent.status = code === 0 ? 'done' : 'error'
        if (!agent.result) {
          agent.result = code === 0 ? 'Process exited normally' : `Process crashed (code ${code})`
        }
        this.emit('status', opts.id, agent.status)
      }
      agent.durationMs = Date.now() - agent.startedAt
    })

    child.on('error', (err) => {
      console.error(`[agent:${opts.name}] Process error:`, err.message)
      agent.status = 'error'
      agent.result = `Process error: ${err.message}`
      this.emit('status', opts.id, 'error')
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
