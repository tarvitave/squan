/**
 * Agent Worker — runs in a separate child process.
 * Uses the provider abstraction for multi-model support,
 * MCP client for external tool servers, and built-in tools.
 *
 * Supports: Anthropic, OpenAI, Google Gemini, Ollama + any MCP server.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs'
import { execSync } from 'child_process'
import { join, relative, dirname } from 'path'
import { createProvider, defaultModel, type ChatProvider, type ToolDef, type ChatResponse } from '../providers/index.js'
import { McpManager, type McpExtensionConfig } from '../mcp/client.js'
import { fetchUrl, searchWeb } from '../tools/web.js'

// ── Types ────────────────────────────────────────────────────────────────────

interface StartMessage {
  type: 'start'
  cwd: string
  task: string
  apiKey: string
  oauthAccessToken?: string   // Claude OAuth bearer token (Anthropic only)
  model?: string
  provider?: string       // 'anthropic' | 'openai' | 'google' | 'ollama'
  providerUrl?: string    // base URL for openai-compatible / ollama
  maxTokens?: number
  maxTurns?: number
  extensions?: McpExtensionConfig[]  // MCP servers to connect
}

// ── Built-in tool definitions ────────────────────────────────────────────────

const BUILTIN_TOOLS: ToolDef[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file at the given path.',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'File path relative to project root' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Creates parent directories if needed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File path relative to project root' },
        content: { type: 'string', description: 'Complete file content' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Edit a file by finding and replacing text. Search must match exactly and uniquely.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File path relative to project root' },
        search: { type: 'string', description: 'Exact text to find' },
        replace: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'search', 'replace'],
    },
  },
  {
    name: 'run_command',
    description: 'Execute a shell command in the project directory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        timeout_ms: { type: 'number', description: 'Timeout in ms (default 60000)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and directories. Skips node_modules, .git, dist.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Directory path (default ".")' },
        recursive: { type: 'boolean', description: 'List recursively (max depth 3)' },
      },
      required: [],
    },
  },
  {
    name: 'search_files',
    description: 'Search for a pattern across files (like grep).',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Search pattern' },
        path: { type: 'string', description: 'Directory to search (default ".")' },
        file_pattern: { type: 'string', description: 'File glob (e.g. "*.ts")' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'fetch_url',
    description: 'Fetch a URL and return its content as text. HTML is converted to readable plain text. Works for web pages, APIs, docs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        max_length: { type: 'number', description: 'Max response length (default 50000)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'search_web',
    description: 'Search the web for information. Returns relevant results with links.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        max_results: { type: 'number', description: 'Max results (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'task_complete',
    description: 'Signal that the task is complete with a summary.',
    input_schema: {
      type: 'object' as const,
      properties: { summary: { type: 'string', description: 'Summary of what was done' } },
      required: ['summary'],
    },
  },
]

// ── Built-in tool execution ──────────────────────────────────────────────────

function executeBuiltinTool(name: string, input: Record<string, unknown>, cwd: string): { result: string; isError: boolean } {
  try {
    switch (name) {
      case 'read_file': {
        const fp = join(cwd, input.path as string)
        if (!existsSync(fp)) return { result: `Error: File not found: ${input.path}`, isError: true }
        const c = readFileSync(fp, 'utf8')
        return { result: c.length > 50000 ? c.slice(0, 50000) + '\n... (truncated)' : c, isError: false }
      }
      case 'write_file': {
        const fp = join(cwd, input.path as string)
        mkdirSync(dirname(fp), { recursive: true })
        writeFileSync(fp, input.content as string, 'utf8')
        return { result: `Written: ${input.path} (${(input.content as string).split('\n').length} lines)`, isError: false }
      }
      case 'edit_file': {
        const fp = join(cwd, input.path as string)
        if (!existsSync(fp)) return { result: `Error: File not found: ${input.path}`, isError: true }
        const content = readFileSync(fp, 'utf8')
        const search = input.search as string
        if (!content.includes(search)) return { result: `Error: Search text not found in ${input.path}`, isError: true }
        const count = content.split(search).length - 1
        if (count > 1) return { result: `Error: Search text found ${count} times, must be unique`, isError: true }
        writeFileSync(fp, content.replace(search, input.replace as string), 'utf8')
        return { result: `Edited: ${input.path}`, isError: false }
      }
      case 'run_command': {
        const timeout = (input.timeout_ms as number) ?? 60000
        try {
          const result = execSync(input.command as string, {
            cwd, timeout, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
            stdio: ['pipe', 'pipe', 'pipe'],
          })
          return { result: (result || '(no output)').slice(0, 10000), isError: false }
        } catch (err: any) {
          const stderr = err.stderr?.toString() ?? ''
          const stdout = err.stdout?.toString() ?? ''
          return { result: `Exit code ${err.status ?? 1}\n${stdout}\n${stderr}`.slice(0, 10000), isError: true }
        }
      }
      case 'list_directory': {
        const dirPath = join(cwd, (input.path as string) ?? '.')
        const recursive = input.recursive as boolean ?? false
        const items: string[] = []
        const skip = new Set(['.git', 'node_modules', 'dist', '.vite', '__pycache__', '.next', '.squan'])
        function scan(dir: string, depth: number) {
          if (depth > 3) return
          try {
            for (const entry of readdirSync(dir)) {
              if (entry.startsWith('.') && entry !== '.env') continue
              if (skip.has(entry)) continue
              const full = join(dir, entry)
              const rel = relative(cwd, full)
              const stat = statSync(full)
              items.push(stat.isDirectory() ? `${rel}/` : rel)
              if (recursive && stat.isDirectory()) scan(full, depth + 1)
            }
          } catch { /* permission errors */ }
        }
        scan(dirPath, 0)
        return { result: items.join('\n') || '(empty directory)', isError: false }
      }
      case 'search_files': {
        const searchPath = join(cwd, (input.path as string) ?? '.')
        const pattern = input.pattern as string
        try {
          const cmd = process.platform === 'win32'
            ? `findstr /srn "${pattern.replace(/"/g, '')}" "${relative(cwd, searchPath)}\\*"`
            : `grep -rn "${pattern.replace(/"/g, '\\"')}" "${relative(cwd, searchPath)}" --include="${input.file_pattern ?? '*'}" 2>/dev/null | head -50`
          const result = execSync(cmd, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 10000 })
          return { result: result.slice(0, 10000), isError: false }
        } catch {
          return { result: 'No matches found', isError: false }
        }
      }
      case 'task_complete':
        return { result: `DONE: ${input.summary}`, isError: false }
      default:
        return { result: `Unknown built-in tool: ${name}`, isError: true }
    }
  } catch (err) {
    return { result: `Error: ${(err as Error).message}`, isError: true }
  }
}

// ── IPC helpers ──────────────────────────────────────────────────────────────

function send(msg: Record<string, unknown>) {
  if (process.send) process.send(msg)
}

// ── Conversation state ───────────────────────────────────────────────────────

let aborted = false
let savedApiMessages: Array<{ role: string; content: any }> = []
let savedSystemPrompt = ''
let savedOpts: StartMessage | null = null
let savedCost = 0
let savedInputTokens = 0
let savedOutputTokens = 0
let savedTotalTurns = 0
let chatProvider: ChatProvider | null = null
let mcpManager: McpManager | null = null
let allTools: ToolDef[] = []

// ── Initialize provider + MCP ────────────────────────────────────────────────

async function initializeAgent(opts: StartMessage): Promise<void> {
  // Create the chat provider
  const providerType = (opts.provider ?? 'anthropic') as any
  chatProvider = createProvider({
    provider: providerType,
    apiKey: opts.apiKey,
    model: opts.model ?? defaultModel(providerType),
    baseUrl: opts.providerUrl,
    oauthAccessToken: opts.oauthAccessToken,
  })
  console.log(`[agent-worker] Provider: ${chatProvider.name}, Model: ${opts.model ?? defaultModel(providerType)}`)

  // Start with built-in tools
  allTools = [...BUILTIN_TOOLS]

  // Connect to MCP servers if configured
  if (opts.extensions && opts.extensions.length > 0) {
    mcpManager = new McpManager()
    const results = await mcpManager.connectAll(opts.extensions)
    const mcpToolDefs = mcpManager.getToolDefs()
    console.log(`[agent-worker] MCP: ${results.size} server(s) connected, ${mcpToolDefs.length} tools discovered`)

    // Merge MCP tools with built-in tools
    allTools = [...BUILTIN_TOOLS, ...mcpToolDefs]
  }
}

// ── Execute any tool (built-in or MCP) ───────────────────────────────────────

async function executeTool(name: string, input: Record<string, unknown>, cwd: string): Promise<{ result: string; isError: boolean }> {
  // Web tools (built-in but async)
  if (name === 'fetch_url') {
    const result = await fetchUrl(input.url as string, (input.max_length as number) ?? 50000)
    return { result, isError: result.startsWith('Error') }
  }
  if (name === 'search_web') {
    const result = await searchWeb(input.query as string, (input.max_results as number) ?? 5)
    return { result, isError: result.startsWith('Search error') }
  }

  // MCP tools (prefixed with serverName__)
  if (mcpManager?.isMcpTool(name)) {
    try {
      const result = await mcpManager.callTool(name, input)
      return { result, isError: false }
    } catch (err) {
      return { result: `MCP Error: ${(err as Error).message}`, isError: true }
    }
  }

  // Built-in tools
  return executeBuiltinTool(name, input, cwd)
}

// ── Main agent loop ──────────────────────────────────────────────────────────

async function runAgentPersistent(opts: StartMessage) {
  savedOpts = opts
  const useModel = opts.model ?? defaultModel(opts.provider ?? 'anthropic')
  const useMaxTokens = opts.maxTokens ?? 8192
  const useTurns = opts.maxTurns ?? 50

  // Initialize provider + MCP
  await initializeAgent(opts)
  if (!chatProvider) throw new Error('Failed to initialize provider')

  send({ type: 'status', status: 'working' })
  send({ type: 'message', data: { type: 'user', text: opts.task } })

  savedSystemPrompt = `You are an expert software engineer working on a coding task.
You have tools for reading, writing, editing files, running commands, searching code, browsing the web, and more.
Work autonomously to complete the task. When done, use task_complete with a summary.

Working directory: ${opts.cwd}
`

  savedApiMessages = [{ role: 'user', content: opts.task }]

  await runLoop(useModel, useMaxTokens, useTurns, opts.cwd)
}

async function runLoop(model: string, maxTokens: number, maxTurns: number, cwd: string) {
  const startTime = Date.now()
  let turn = 0

  while (turn < maxTurns && !aborted) {
    turn++

    try {
      // Call provider with retry logic
      let response: ChatResponse | null = null
      const maxRetries = 3
      const retryDelays = [5000, 15000, 30000]

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          response = await chatProvider!.chat({
            messages: savedApiMessages as any,
            system: savedSystemPrompt,
            tools: allTools,
            maxTokens: maxTokens,
            model: model,
          })
          break
        } catch (err: any) {
          const status = err.status ?? 0
          if ((status === 429 || status === 529 || status >= 500) && attempt < maxRetries) {
            const delay = retryDelays[attempt]
            send({ type: 'message', data: { type: 'assistant', message: { content: [{ type: 'text', text: `API overloaded (${status}). Retrying in ${delay / 1000}s... (attempt ${attempt + 1}/${maxRetries})` }] } } })
            await new Promise(r => setTimeout(r, delay))
            continue
          }
          throw err
        }
      }

      if (!response) throw new Error('No response from provider')

      // Track cost
      const [inputCostPer1M, outputCostPer1M] = chatProvider!.costPer1M(model)
      savedInputTokens += response.usage.input_tokens
      savedOutputTokens += response.usage.output_tokens
      savedCost += (response.usage.input_tokens / 1e6) * inputCostPer1M + (response.usage.output_tokens / 1e6) * outputCostPer1M

      send({ type: 'usage', inputTokens: savedInputTokens, outputTokens: savedOutputTokens, totalCost: savedCost })

      // Add assistant response to conversation
      savedApiMessages.push({ role: 'assistant', content: response.content })

      // Emit content blocks
      for (const block of response.content) {
        if (block.type === 'text') {
          send({ type: 'message', data: { type: 'assistant', message: { content: [{ type: 'text', text: block.text }], usage: response.usage } } })
        }
        if (block.type === 'tool_use') {
          send({ type: 'message', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: block.id, name: block.name, input: block.input }] } } })
        }
      }

      // No tool use = done
      if (response.stop_reason === 'end_turn') {
        const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
        savedTotalTurns += turn
        send({ type: 'done', result: text, cost: savedCost, duration: Date.now() - startTime, turns: savedTotalTurns, inputTokens: savedInputTokens, outputTokens: savedOutputTokens, isError: false })
        send({ type: 'status', status: 'done' })
        return
      }

      // Execute tools
      if (response.stop_reason === 'tool_use') {
        const toolResults: any[] = []

        for (const block of response.content) {
          if (block.type !== 'tool_use' || !block.id || !block.name) continue

          // task_complete — signal done
          if (block.name === 'task_complete') {
            const summary = (block.input as any)?.summary ?? ''
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Task marked as complete.' })
            savedApiMessages.push({ role: 'user', content: toolResults })
            savedTotalTurns += turn
            send({ type: 'done', result: summary, cost: savedCost, duration: Date.now() - startTime, turns: savedTotalTurns, inputTokens: savedInputTokens, outputTokens: savedOutputTokens, isError: false })
            send({ type: 'status', status: 'done' })
            return
          }

          console.log(`[agent-worker] Tool: ${block.name}`)
          const { result, isError } = await executeTool(block.name, block.input ?? {}, cwd)

          send({ type: 'message', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: block.id, content: result }] } } })

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result,
            ...(isError ? { is_error: true } : {}),
          })
        }

        savedApiMessages.push({ role: 'user', content: toolResults })
      }

    } catch (err) {
      send({ type: 'message', data: { type: 'error', text: `Turn ${turn}: ${(err as Error).message}` } })
      savedTotalTurns += turn
      send({ type: 'done', result: `Error: ${(err as Error).message}`, cost: savedCost, duration: Date.now() - startTime, turns: savedTotalTurns, inputTokens: savedInputTokens, outputTokens: savedOutputTokens, isError: true })
      send({ type: 'status', status: 'error' })
      return
    }
  }

  // Max turns
  if (!aborted) {
    savedTotalTurns += turn
    send({ type: 'done', result: 'Reached maximum turns', cost: savedCost, duration: Date.now() - startTime, turns: savedTotalTurns, inputTokens: savedInputTokens, outputTokens: savedOutputTokens, isError: false })
    send({ type: 'status', status: 'done' })
  }
}

// ── Follow-up handler ────────────────────────────────────────────────────────

async function handleFollowUp(message: string) {
  if (!savedOpts || !chatProvider) {
    send({ type: 'message', data: { type: 'error', text: 'No previous conversation to follow up on' } })
    return
  }

  aborted = false
  send({ type: 'status', status: 'working' })
  send({ type: 'message', data: { type: 'user', text: message } })

  savedApiMessages.push({ role: 'user', content: message })

  const useModel = savedOpts.model ?? defaultModel(savedOpts.provider ?? 'anthropic')
  const useMaxTokens = savedOpts.maxTokens ?? 8192
  const useTurns = savedOpts.maxTurns ?? 50

  await runLoop(useModel, useMaxTokens, useTurns, savedOpts.cwd)
}

// ── IPC message handler ──────────────────────────────────────────────────────

process.on('message', (msg: any) => {
  if (msg.type === 'start') {
    runAgentPersistent(msg as StartMessage).catch((err) => {
      send({ type: 'message', data: { type: 'error', text: err.message } })
      send({ type: 'status', status: 'error' })
    })
  }
  if (msg.type === 'followup') {
    handleFollowUp(msg.message).catch((err) => {
      send({ type: 'message', data: { type: 'error', text: err.message } })
      send({ type: 'status', status: 'error' })
    })
  }
  if (msg.type === 'kill') {
    aborted = true
    if (mcpManager) mcpManager.disconnectAll()
    send({ type: 'status', status: 'error' })
    process.exit(0)
  }
})

send({ type: 'ready' })
