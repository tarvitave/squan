/**
 * Agent Worker — runs in a separate child process.
 * Uses the provider abstraction for multi-model support,
 * MCP client for external tool servers, and built-in tools.
 *
 * Supports: Anthropic, OpenAI, Google Gemini, Ollama + any MCP server.
 */

import { createProvider, defaultModel, type ChatProvider, type ToolDef, type ChatResponse } from '../providers/index.js'
import { McpManager, type McpExtensionConfig } from '../mcp/client.js'
import { getToolDefinitions, executeTool as registryExecuteTool, logToolInventory } from '../tools/index.js'
import type { ToolContext } from '../tools/registry.js'

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
  agentId?: string
  projectId?: string
}

// ── Built-in tool definitions ────────────────────────────────────────────────

// Built-in tools now come from the modular registry (server/src/tools/)
// 53 tools across 7 categories: filesystem, git, code-analysis, network, database, system, agent

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

  // Start with all built-in tools from the registry
  logToolInventory()
  allTools = getToolDefinitions() as ToolDef[]

  // Connect to MCP servers if configured
  if (opts.extensions && opts.extensions.length > 0) {
    mcpManager = new McpManager()
    const results = await mcpManager.connectAll(opts.extensions)
    const mcpToolDefs = mcpManager.getToolDefs()
    console.log(`[agent-worker] MCP: ${results.size} server(s) connected, ${mcpToolDefs.length} tools discovered`)

    // Merge MCP tools with built-in tools
    allTools = [...(getToolDefinitions() as ToolDef[]), ...mcpToolDefs]
  }
}

// ── Execute any tool (built-in or MCP) ───────────────────────────────────────

async function executeTool(name: string, input: Record<string, unknown>, cwd: string): Promise<{ result: string; isError: boolean }> {
  // MCP tools (prefixed with serverName__) — check first
  if (mcpManager?.isMcpTool(name)) {
    try {
      const result = await mcpManager.callTool(name, input)
      return { result, isError: false }
    } catch (err) {
      return { result: `MCP Error: ${(err as Error).message}`, isError: true }
    }
  }

  // All built-in tools from the registry (53 tools across 7 categories)
  const context: ToolContext = { cwd, agentId: savedOpts?.agentId, projectId: savedOpts?.projectId }
  return registryExecuteTool(name, input, context)
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
