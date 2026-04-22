/**
 * Structured Agent Runner
 *
 * Spawns Claude Code with --print --output-format stream-json --verbose
 * instead of raw PTY. Parses structured JSON output line-by-line and
 * broadcasts typed messages via WebSocket.
 *
 * TODO: This class is imported in index.ts but never instantiated anywhere.
 * The live agent path uses processManager.spawn → agent-worker.ts (forked
 * child) → providers/index.ts. If this is resurrected to invoke the Claude
 * Code CLI, note that CLAUDE_CODE_OAUTH_TOKEN is already plumbed in
 * spawn-setup.ts/process-manager.ts so subscription auth would work for free.
 * Otherwise delete this file and the accompanying unused import.
 */

import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'
import { EventEmitter } from 'events'

// ── Message types from Claude Code stream-json ───────────────────────────────

export interface SystemMessage {
  type: 'system'
  subtype: 'init'
  cwd: string
  session_id: string
  tools: string[]
  model: string
  claude_code_version: string
}

export interface AssistantMessage {
  type: 'assistant'
  message: {
    role: 'assistant'
    content: Array<TextContent | ToolUseContent>
    usage?: {
      input_tokens: number
      output_tokens: number
      cache_read_input_tokens?: number
    }
  }
  session_id: string
}

export interface TextContent {
  type: 'text'
  text: string
}

export interface ToolUseContent {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface UserMessage {
  type: 'user'
  message: {
    role: 'user'
    content: Array<{ tool_use_id: string; type: 'tool_result'; content: string }>
  }
  tool_use_result?: {
    type: 'text'
    file?: { filePath: string; content: string; numLines: number }
  }
  session_id: string
}

export interface ResultMessage {
  type: 'result'
  subtype: 'success' | 'error'
  is_error: boolean
  duration_ms: number
  num_turns: number
  result: string
  total_cost_usd: number
  session_id: string
  usage?: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number
  }
}

export interface RateLimitMessage {
  type: 'rate_limit_event'
  rate_limit_info: {
    status: string
    resetsAt: number
  }
}

export type AgentMessage = SystemMessage | AssistantMessage | UserMessage | ResultMessage | RateLimitMessage

// ── Structured Agent Runner ──────────────────────────────────────────────────

export interface StructuredRunnerOptions {
  cwd: string
  task: string
  claudeConfigDir?: string
  env?: Record<string, string>
  model?: string
  maxBudgetUsd?: number
}

export class StructuredRunner extends EventEmitter {
  private process: ChildProcess | null = null
  private buffer = ''
  public sessionId: string | null = null
  public messages: AgentMessage[] = []
  public status: 'starting' | 'working' | 'done' | 'error' = 'starting'
  public result: string | null = null
  public totalCost: number = 0
  public durationMs: number = 0

  constructor(private options: StructuredRunnerOptions) {
    super()
  }

  start(): void {
    const args = [
      '-p',                        // print mode (non-interactive)
      '--output-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ]

    if (this.options.model) {
      args.push('--model', this.options.model)
    }

    if (this.options.maxBudgetUsd) {
      args.push('--max-budget-usd', String(this.options.maxBudgetUsd))
    }

    // The task prompt
    args.push(this.options.task)

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...this.options.env,
    }

    if (this.options.claudeConfigDir) {
      env.CLAUDE_CONFIG_DIR = this.options.claudeConfigDir
    }

    const hasApiKey = !!env.ANTHROPIC_API_KEY
    console.log(`[structured-runner] Spawning claude in ${this.options.cwd}`)
    console.log(`[structured-runner] API key present: ${hasApiKey}, config dir: ${this.options.claudeConfigDir ?? 'none'}`)
    console.log(`[structured-runner] Args: claude ${args.join(' ').slice(0, 120)}...`)

    this.process = spawn('claude', args, {
      cwd: this.options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.status = 'working'
    this.emit('status', 'working')

    // Parse stdout line by line
    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString()
      const lines = this.buffer.split('\n')
      this.buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const msg = JSON.parse(trimmed) as AgentMessage
          this.handleMessage(msg)
        } catch {
          // Non-JSON output — emit as raw text
          this.emit('raw', trimmed)
        }
      }
    })

    this.process.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) this.emit('stderr', text)
    })

    this.process.on('error', (err) => {
      this.status = 'error'
      this.emit('status', 'error')
      this.emit('error', err)
    })

    this.process.on('exit', (code) => {
      // Flush remaining buffer
      if (this.buffer.trim()) {
        try {
          const msg = JSON.parse(this.buffer.trim()) as AgentMessage
          this.handleMessage(msg)
        } catch { /* ignore */ }
      }

      if (this.status === 'working') {
        this.status = code === 0 ? 'done' : 'error'
        this.emit('status', this.status)
      }
      this.emit('exit', code)
    })
  }

  private handleMessage(msg: AgentMessage): void {
    this.messages.push(msg)

    switch (msg.type) {
      case 'system':
        this.sessionId = msg.session_id
        break

      case 'assistant': {
        // Check if this is a text message or tool call
        const content = msg.message.content
        for (const c of content) {
          if (c.type === 'text') {
            this.emit('text', c.text)
          } else if (c.type === 'tool_use') {
            this.emit('tool_call', { name: c.name, input: c.input, id: c.id })
          }
        }
        break
      }

      case 'user':
        // Tool result
        if (msg.tool_use_result) {
          this.emit('tool_result', msg.tool_use_result)
        }
        break

      case 'result':
        this.result = msg.result
        this.totalCost = msg.total_cost_usd
        this.durationMs = msg.duration_ms
        this.status = msg.is_error ? 'error' : 'done'
        this.emit('status', this.status)
        break
    }

    // Emit every message for the UI to render
    this.emit('message', msg)
  }

  kill(): void {
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM')
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL')
        }
      }, 5000)
    }
    this.status = 'error'
  }

  sendInput(text: string): void {
    if (this.process?.stdin?.writable) {
      this.process.stdin.write(text + '\n')
    }
  }
}
