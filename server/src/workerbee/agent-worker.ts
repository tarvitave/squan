/**
 * Agent Worker — runs in a separate child process.
 * Each agent gets its own Node.js process for full isolation.
 * Communicates with the main server via IPC (process.send / process.on).
 *
 * Usage: fork('agent-worker.js') then send { type: 'start', ... }
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs'
import { execSync } from 'child_process'
import { join, relative, dirname } from 'path'

// ── Types ────────────────────────────────────────────────────────────────────

interface StartMessage {
  type: 'start'
  cwd: string
  task: string
  apiKey: string
  model?: string
  maxTokens?: number
  maxTurns?: number
}

interface KillMessage {
  type: 'kill'
}

type WorkerMessage = StartMessage | KillMessage

// ── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
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
    name: 'task_complete',
    description: 'Signal that the task is complete with a summary.',
    input_schema: {
      type: 'object' as const,
      properties: { summary: { type: 'string', description: 'Summary of what was done' } },
      required: ['summary'],
    },
  },
]

// ── Tool execution ───────────────────────────────────────────────────────────

function executeTool(name: string, input: Record<string, unknown>, cwd: string): { result: string; isError: boolean } {
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
        return { result: `Unknown tool: ${name}`, isError: true }
    }
  } catch (err) {
    return { result: `Error: ${(err as Error).message}`, isError: true }
  }
}

// ── IPC send helper ──────────────────────────────────────────────────────────

function send(msg: Record<string, unknown>) {
  if (process.send) process.send(msg)
}

// ── Main agent loop ──────────────────────────────────────────────────────────

let aborted = false

async function runAgent(opts: StartMessage) {
  const { cwd, task, apiKey, model, maxTokens, maxTurns } = opts
  const useModel = model ?? 'claude-sonnet-4-20250514'
  const useMaxTokens = maxTokens ?? 8192
  const useTurns = maxTurns ?? 50

  send({ type: 'status', status: 'working' })
  send({ type: 'message', data: { type: 'user', text: task } })

  const systemPrompt = `You are an expert software engineer working on a coding task.
You have tools for reading, writing, editing files, running commands, and searching code.
Work autonomously to complete the task. When done, use task_complete with a summary.

Working directory: ${cwd}
`

  const apiMessages: Array<{ role: string; content: any }> = [
    { role: 'user', content: task },
  ]

  let totalCost = 0
  let inputTokens = 0
  let outputTokens = 0
  let turn = 0
  const startTime = Date.now()

  while (turn < useTurns && !aborted) {
    turn++

    try {
      // API call with retry logic for 429/529 overload errors
      let response: Response | null = null
      const maxRetries = 3
      const retryDelays = [5000, 15000, 30000] // 5s, 15s, 30s

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: useModel,
            max_tokens: useMaxTokens,
            system: systemPrompt,
            tools: TOOLS,
            messages: apiMessages,
          }),
        })

        // Retry on overload (429, 529) or server errors (500, 502, 503)
        if (response.status === 429 || response.status === 529 || response.status === 500 || response.status === 502 || response.status === 503) {
          if (attempt < maxRetries) {
            const delay = retryDelays[attempt]
            send({ type: 'message', data: { type: 'assistant', message: { content: [{ type: 'text', text: `API overloaded (${response.status}). Retrying in ${delay / 1000}s... (attempt ${attempt + 1}/${maxRetries})` }] } } })
            await new Promise(r => setTimeout(r, delay))
            continue
          }
        }

        break // Success or non-retryable error
      }

      if (!response!.ok) {
        const errText = await response!.text()
        send({ type: 'message', data: { type: 'error', text: `API ${response!.status}: ${errText.slice(0, 200)}` } })
        send({ type: 'status', status: 'error' })
        send({ type: 'done', result: `API error: ${response!.status}`, cost: totalCost, duration: Date.now() - startTime, turns: turn, inputTokens, outputTokens, isError: true })
        process.exit(1)
      }

      const data = await response!.json() as any

      // Track cost
      inputTokens += data.usage.input_tokens
      outputTokens += data.usage.output_tokens
      totalCost += (data.usage.input_tokens / 1e6) * 3.0 + (data.usage.output_tokens / 1e6) * 15.0

      send({ type: 'usage', inputTokens, outputTokens, totalCost })

      // Add assistant response
      apiMessages.push({ role: 'assistant', content: data.content })

      // Emit content blocks
      for (const block of data.content) {
        if (block.type === 'text') {
          send({ type: 'message', data: { type: 'assistant', message: { content: [{ type: 'text', text: block.text }], usage: data.usage } } })
        }
        if (block.type === 'tool_use') {
          send({ type: 'message', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: block.id, name: block.name, input: block.input }] } } })
        }
      }

      // No tool use = done
      if (data.stop_reason === 'end_turn') {
        const text = data.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
        send({ type: 'done', result: text, cost: totalCost, duration: Date.now() - startTime, turns: turn, inputTokens, outputTokens, isError: false })
        send({ type: 'status', status: 'done' })
        process.exit(0)
      }

      // Execute tools
      if (data.stop_reason === 'tool_use') {
        const toolResults: any[] = []

        for (const block of data.content) {
          if (block.type !== 'tool_use') continue

          // task_complete
          if (block.name === 'task_complete') {
            const summary = (block.input as any).summary
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Task marked as complete.' })
            apiMessages.push({ role: 'user', content: toolResults })
            send({ type: 'done', result: summary, cost: totalCost, duration: Date.now() - startTime, turns: turn, inputTokens, outputTokens, isError: false })
            send({ type: 'status', status: 'done' })
            process.exit(0)
          }

          console.log(`[agent-worker] Tool: ${block.name}`)
          const { result, isError } = executeTool(block.name, block.input, cwd)

          send({ type: 'message', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: block.id, content: result }] } } })

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result,
            ...(isError ? { is_error: true } : {}),
          })
        }

        apiMessages.push({ role: 'user', content: toolResults })
      }

    } catch (err) {
      send({ type: 'message', data: { type: 'error', text: `Turn ${turn}: ${(err as Error).message}` } })
      send({ type: 'done', result: `Error: ${(err as Error).message}`, cost: totalCost, duration: Date.now() - startTime, turns: turn, inputTokens, outputTokens, isError: true })
      send({ type: 'status', status: 'error' })
      process.exit(1)
    }
  }

  // Max turns
  if (!aborted) {
    send({ type: 'done', result: 'Reached maximum turns', cost: totalCost, duration: Date.now() - startTime, turns: turn, inputTokens, outputTokens, isError: false })
    send({ type: 'status', status: 'done' })
  }
  process.exit(0)
}

// ── IPC message handler ──────────────────────────────────────────────────────

process.on('message', (msg: WorkerMessage) => {
  if (msg.type === 'start') {
    runAgent(msg).catch((err) => {
      send({ type: 'message', data: { type: 'error', text: err.message } })
      send({ type: 'status', status: 'error' })
      process.exit(1)
    })
  }
  if (msg.type === 'kill') {
    aborted = true
    send({ type: 'status', status: 'error' })
    process.exit(0)
  }
})

send({ type: 'ready' })
