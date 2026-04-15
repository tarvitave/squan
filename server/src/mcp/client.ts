/**
 * MCP Client — connects to external MCP tool servers and discovers their tools.
 * Supports both stdio (command-line) and HTTP (SSE/streamable) transports.
 * 
 * This makes Squan agents able to use any MCP tool server — databases,
 * Slack, Jira, GitHub Issues, Figma, Notion, Stripe, etc.
 */

import { spawn, ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'

// ── Types ────────────────────────────────────────────────────────────────────

export interface McpToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpExtensionConfig {
  name: string
  type: 'stdio' | 'http'
  command?: string        // for stdio
  args?: string[]         // for stdio
  url?: string            // for http
  env?: Record<string, string>
  enabled?: boolean
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
  id: string | number
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  result?: any
  error?: { code: number; message: string }
  id: string | number | null
}

// ── Stdio Transport ──────────────────────────────────────────────────────────

class StdioTransport extends EventEmitter {
  private process: ChildProcess | null = null
  private buffer = ''
  private pending = new Map<string | number, { resolve: (v: any) => void; reject: (e: Error) => void }>()

  constructor(private config: McpExtensionConfig) {
    super()
  }

  async start(): Promise<void> {
    if (!this.config.command) throw new Error('stdio transport requires command')

    this.process = spawn(this.config.command, this.config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(this.config.env ?? {}) },
      shell: true,
    })

    this.process.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString()
      this.processBuffer()
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error(`[mcp:${this.config.name}:stderr] ${data.toString().trim()}`)
    })

    this.process.on('exit', (code) => {
      console.log(`[mcp:${this.config.name}] Process exited with code ${code}`)
      // Reject all pending requests
      for (const [, { reject }] of this.pending) {
        reject(new Error(`MCP server ${this.config.name} exited`))
      }
      this.pending.clear()
    })

    this.process.on('error', (err) => {
      console.error(`[mcp:${this.config.name}] Process error: ${err.message}`)
    })

    // Wait for process to be ready
    await new Promise<void>((resolve) => setTimeout(resolve, 500))
  }

  private processBuffer() {
    // JSON-RPC messages are newline-delimited
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? '' // keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse
        if (msg.id !== undefined && msg.id !== null) {
          const pending = this.pending.get(msg.id)
          if (pending) {
            this.pending.delete(msg.id)
            if (msg.error) {
              pending.reject(new Error(msg.error.message))
            } else {
              pending.resolve(msg.result)
            }
          }
        }
        // Notifications (no id) — emit as events
        if (msg.id === undefined || msg.id === null) {
          this.emit('notification', msg)
        }
      } catch {
        // Not JSON — ignore
      }
    }
  }

  async send(method: string, params?: Record<string, unknown>): Promise<any> {
    if (!this.process?.stdin?.writable) throw new Error(`MCP server ${this.config.name} not running`)

    const id = randomUUID()
    const request: JsonRpcRequest = { jsonrpc: '2.0', method, id, ...(params !== undefined ? { params } : {}) }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP request to ${this.config.name} timed out (${method})`))
      }, 30000)

      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timeout); resolve(v) },
        reject: (e) => { clearTimeout(timeout); reject(e) },
      })

      this.process!.stdin!.write(JSON.stringify(request) + '\n')
    })
  }

  stop() {
    if (this.process) {
      try { this.process.kill() } catch { /* ignore */ }
      this.process = null
    }
  }
}

// ── HTTP Transport ───────────────────────────────────────────────────────────

class HttpTransport {
  constructor(private config: McpExtensionConfig) {}

  async send(method: string, params?: Record<string, unknown>): Promise<any> {
    if (!this.config.url) throw new Error('HTTP transport requires url')

    const id = randomUUID()
    const request: JsonRpcRequest = { jsonrpc: '2.0', method, id, ...(params !== undefined ? { params } : {}) }

    const response = await fetch(this.config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${await response.text()}`)

    const data = await response.json() as JsonRpcResponse
    if (data.error) throw new Error(data.error.message)
    return data.result
  }

  async start(): Promise<void> { /* no-op for HTTP */ }
  stop() { /* no-op for HTTP */ }
}

// ── MCP Client (manages one extension) ───────────────────────────────────────

export class McpClient {
  private transport: StdioTransport | HttpTransport
  private tools: McpToolDef[] = []
  private initialized = false

  constructor(public config: McpExtensionConfig) {
    this.transport = config.type === 'stdio'
      ? new StdioTransport(config)
      : new HttpTransport(config)
  }

  async connect(): Promise<McpToolDef[]> {
    try {
      await this.transport.start()

      // Initialize
      await this.transport.send('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'squan', version: '0.4.0' },
      })

      // Send initialized notification
      try {
        await this.transport.send('notifications/initialized')
      } catch { /* some servers don't support this */ }

      // Discover tools
      const result = await this.transport.send('tools/list')
      this.tools = (result?.tools ?? []).map((t: any) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
      }))

      this.initialized = true
      console.log(`[mcp:${this.config.name}] Connected — ${this.tools.length} tools: ${this.tools.map(t => t.name).join(', ')}`)
      return this.tools
    } catch (err) {
      console.error(`[mcp:${this.config.name}] Failed to connect: ${(err as Error).message}`)
      return []
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.initialized) throw new Error(`MCP server ${this.config.name} not connected`)

    try {
      const result = await this.transport.send('tools/call', { name, arguments: args })
      // Extract text content from MCP response
      if (result?.content) {
        return result.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n') || JSON.stringify(result.content)
      }
      return JSON.stringify(result)
    } catch (err) {
      return `Error calling ${name}: ${(err as Error).message}`
    }
  }

  getTools(): McpToolDef[] {
    return this.tools
  }

  disconnect() {
    this.transport.stop()
    this.initialized = false
  }
}

// ── MCP Manager (manages all extensions for a project) ───────────────────────

export class McpManager {
  private clients = new Map<string, McpClient>()

  async connectAll(extensions: McpExtensionConfig[]): Promise<Map<string, McpToolDef[]>> {
    const results = new Map<string, McpToolDef[]>()

    for (const ext of extensions) {
      if (ext.enabled === false) continue
      const client = new McpClient(ext)
      const tools = await client.connect()
      if (tools.length > 0) {
        this.clients.set(ext.name, client)
        results.set(ext.name, tools)
      }
    }

    return results
  }

  /** Get all tools from all connected MCP servers, prefixed with server name */
  getAllTools(): Array<{ serverName: string; tool: McpToolDef }> {
    const all: Array<{ serverName: string; tool: McpToolDef }> = []
    for (const [name, client] of this.clients) {
      for (const tool of client.getTools()) {
        all.push({ serverName: name, tool })
      }
    }
    return all
  }

  /** Get tool definitions in Anthropic format, with names prefixed to avoid collisions */
  getToolDefs(): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
    return this.getAllTools().map(({ serverName, tool }) => ({
      name: `${serverName}__${tool.name}`,
      description: `[${serverName}] ${tool.description}`,
      input_schema: tool.inputSchema,
    }))
  }

  /** Call a tool by its prefixed name (e.g. "postgres__query") */
  async callTool(prefixedName: string, args: Record<string, unknown>): Promise<string> {
    const sep = prefixedName.indexOf('__')
    if (sep === -1) throw new Error(`Invalid MCP tool name: ${prefixedName} (expected serverName__toolName)`)

    const serverName = prefixedName.slice(0, sep)
    const toolName = prefixedName.slice(sep + 2)

    const client = this.clients.get(serverName)
    if (!client) throw new Error(`MCP server not connected: ${serverName}`)

    return client.callTool(toolName, args)
  }

  /** Check if a tool name belongs to an MCP server */
  isMcpTool(name: string): boolean {
    return name.includes('__')
  }

  disconnectAll() {
    for (const client of this.clients.values()) {
      client.disconnect()
    }
    this.clients.clear()
  }
}
