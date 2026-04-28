/**
 * DirectRunner — Calls Anthropic API directly.
 * No Claude Code CLI, no OAuth, no terminal. Just HTTP API calls.
 *
 * Uses the Anthropic Messages API with tool_use for:
 * - Reading files
 * - Writing files
 * - Running shell commands
 * - Searching code
 *
 * TODO: This class is imported in index.ts and mcp/server.ts but never
 * instantiated anywhere in the codebase. The live agent path goes through
 * processManager.spawn → agent-worker.ts → providers/index.ts (AnthropicProvider).
 * Decide whether to resurrect this (in-process runner, simpler for tests) or
 * delete it along with the unused imports. If kept, any inference work done
 * here needs OAuth scaffolding matching AnthropicProvider (Bearer auth +
 * anthropic-beta: claude-code-20250219,oauth-2025-04-20 + "You are Claude
 * Code..." system prefix) to work with subscription tokens.
 */

import { EventEmitter } from 'events'
import { getToolDefinitions, executeTool as registryExecuteTool, logToolInventory } from '../tools'
import type { ToolContext } from '../tools'

// ── Types ────────────────────────────────────────────────────────────────────

export interface DirectRunnerOptions {
  cwd: string
  task: string
  apiKey: string
  model?: string
  maxTokens?: number
  maxTurns?: number
  maxBudgetUsd?: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

// ── Tool definitions  ────────────────────────────────

// Tool definitions and execution come from the modular tool registry
// See server/src/tools/ for all 53 built-in tools across 7 categories
let toolsLogged = false
function getTools() {
  if (!toolsLogged) { logToolInventory(); toolsLogged = true }
  return getToolDefinitions()
}

async function executeToolAsync(name: string, input: Record<string, unknown>, cwd: string): Promise<{ result: string; isError: boolean }> {
  const context: ToolContext = { cwd }
  return registryExecuteTool(name, input, context)
}

export class DirectRunner extends EventEmitter {
  public messages: ChatMessage[] = []
  public status: 'starting' | 'working' | 'done' | 'error' = 'starting'
  public result: string | null = null
  public totalCost: number = 0
  public durationMs: number = 0
  public inputTokens: number = 0
  public outputTokens: number = 0
  private aborted = false

  constructor(private options: DirectRunnerOptions) {
    super()
  }

  async start(): Promise<void> {
    this.status = 'working'
    this.emit('status', 'working')
    const startTime = Date.now()

    const model = this.options.model ?? 'claude-sonnet-4-20250514'
    const maxTokens = this.options.maxTokens ?? 8192
    const maxTurns = this.options.maxTurns ?? 50

    // System prompt
    const systemPrompt = `You are an expert software engineer working on a coding task.
You have access to tools for reading, writing, editing files, running commands, and searching code.
Work autonomously to complete the task. When done, use the task_complete tool with a summary.

Current working directory: ${this.options.cwd}
`

    // Start with the user's task
    const apiMessages: Array<{ role: 'user' | 'assistant'; content: any }> = [
      { role: 'user', content: this.options.task },
    ]

    // Emit the task as a "message"
    this.emit('message', { type: 'user', text: this.options.task })

    let turn = 0

    while (turn < maxTurns && !this.aborted) {
      turn++

      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.options.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            system: systemPrompt,
            tools: getTools(),
            messages: apiMessages,
          }),
        })

        if (!response.ok) {
          const errorText = await response.text()
          console.error(`[direct-runner] API error: ${response.status} ${errorText}`)
          this.status = 'error'
          this.result = `API error: ${response.status}`
          this.emit('message', { type: 'error', text: `API error: ${response.status} - ${errorText}` })
          this.emit('status', 'error')
          break
        }

        const data = await response.json() as {
          content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>
          stop_reason: string
          usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number }
        }

        // Track usage
        this.inputTokens += data.usage.input_tokens
        this.outputTokens += data.usage.output_tokens
        // Approximate cost: Claude 3.5 Sonnet pricing
        const inputCost = (data.usage.input_tokens / 1_000_000) * 3.0
        const outputCost = (data.usage.output_tokens / 1_000_000) * 15.0
        this.totalCost += inputCost + outputCost

        // Add assistant message to conversation
        apiMessages.push({ role: 'assistant', content: data.content })

        // Emit each content block
        for (const block of data.content) {
          if (block.type === 'text') {
            this.emit('message', {
              type: 'assistant',
              message: { content: [{ type: 'text', text: block.text }], usage: data.usage },
            })
          }
          if (block.type === 'tool_use') {
            this.emit('message', {
              type: 'assistant',
              message: { content: [{ type: 'tool_use', id: block.id, name: block.name, input: block.input }] },
            })
          }
        }

        // Check if we're done (no tool use)
        if (data.stop_reason === 'end_turn') {
          const textBlocks = data.content.filter((b) => b.type === 'text')
          this.result = textBlocks.map((b) => b.text).join('\n')
          this.status = 'done'
          this.durationMs = Date.now() - startTime
          this.emit('message', {
            type: 'result',
            subtype: 'success',
            result: this.result,
            total_cost_usd: this.totalCost,
            duration_ms: this.durationMs,
            num_turns: turn,
            is_error: false,
          })
          this.emit('status', 'done')
          break
        }

        // Execute tool calls
        if (data.stop_reason === 'tool_use') {
          const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> = []

          for (const block of data.content) {
            if (block.type === 'tool_use' && block.id && block.name && block.input) {
              // Check for task_complete
              if (block.name === 'task_complete') {
                this.result = (block.input as { summary: string }).summary
                this.status = 'done'
                this.durationMs = Date.now() - startTime
                this.emit('message', {
                  type: 'result',
                  subtype: 'success',
                  result: this.result,
                  total_cost_usd: this.totalCost,
                  duration_ms: this.durationMs,
                  num_turns: turn,
                  is_error: false,
                })
                this.emit('status', 'done')

                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: 'Task marked as complete.',
                })
                // Add tool results and break
                apiMessages.push({ role: 'user', content: toolResults })
                return
              }

              console.log(`[direct-runner] Executing tool: ${block.name}`)
              const { result: toolResult, isError } = await executeToolAsync(block.name, block.input, this.options.cwd)

              // Emit tool result
              this.emit('message', {
                type: 'user',
                message: { content: [{ type: 'tool_result', tool_use_id: block.id, content: toolResult }] },
              })

              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: toolResult,
                ...(isError ? { is_error: true } : {}),
              })
            }
          }

          apiMessages.push({ role: 'user', content: toolResults })
        }

      } catch (err) {
        console.error(`[direct-runner] Error in turn ${turn}:`, err)
        this.status = 'error'
        this.result = `Error: ${(err as Error).message}`
        this.durationMs = Date.now() - startTime
        this.emit('message', {
          type: 'result',
          subtype: 'error',
          result: this.result,
          total_cost_usd: this.totalCost,
          duration_ms: this.durationMs,
          num_turns: turn,
          is_error: true,
        })
        this.emit('status', 'error')
        break
      }
    }

    // If we hit max turns
    if (turn >= maxTurns && this.status === 'working') {
      this.status = 'done'
      this.result = 'Reached maximum number of turns'
      this.durationMs = Date.now() - startTime
      this.emit('message', {
        type: 'result',
        subtype: 'success',
        result: this.result,
        total_cost_usd: this.totalCost,
        duration_ms: this.durationMs,
        num_turns: turn,
        is_error: false,
      })
      this.emit('status', 'done')
    }
  }

  kill(): void {
    this.aborted = true
    this.status = 'error'
    this.emit('status', 'error')
  }
}
