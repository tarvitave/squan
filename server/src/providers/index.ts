/**
 * Provider abstraction — supports Anthropic, OpenAI, Google Gemini, Ollama.
 * All providers implement the same ChatProvider interface.
 * The agent-worker uses this instead of hardcoded Anthropic fetch calls.
 */

export interface ToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: any
}

export interface ChatResponse {
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>
  stop_reason: string
  usage: { input_tokens: number; output_tokens: number }
}

export interface ChatProvider {
  name: string
  chat(opts: {
    messages: ChatMessage[]
    system: string
    tools: ToolDef[]
    maxTokens: number
    model: string
  }): Promise<ChatResponse>
  /** Cost per 1M tokens [input, output] */
  costPer1M(model: string): [number, number]
}

// ── Anthropic ────────────────────────────────────────────────────────────────

export class AnthropicProvider implements ChatProvider {
  name = 'anthropic'
  constructor(private apiKey: string, private baseUrl = 'https://api.anthropic.com', private oauthAccessToken?: string) {}

  async chat(opts: { messages: ChatMessage[]; system: string; tools: ToolDef[]; maxTokens: number; model: string }): Promise<ChatResponse> {
    const isOAuth = Boolean(this.oauthAccessToken)

    // OAuth tokens require Claude Code identity scaffolding — without the
    // "You are Claude Code..." system prefix and specific beta headers, the
    // Anthropic API rejects subscription-based inference requests.
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(isOAuth
        ? {
            Authorization: `Bearer ${this.oauthAccessToken}`,
            'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
            'user-agent': 'claude-cli/2.1.75',
            'x-app': 'cli',
          }
        : { 'x-api-key': this.apiKey }),
    }

    const system = isOAuth
      ? [
          { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." },
          ...(opts.system ? [{ type: 'text', text: opts.system }] : []),
        ]
      : opts.system

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens,
        system,
        tools: opts.tools,
        messages: opts.messages,
      }),
    })
    if (!response.ok) {
      const errText = await response.text()
      const err: any = new Error(`Anthropic API ${response.status}: ${errText.slice(0, 300)}`)
      err.status = response.status
      throw err
    }
    return response.json() as Promise<ChatResponse>
  }

  costPer1M(model: string): [number, number] {
    if (model.includes('opus')) return [15.0, 75.0]
    if (model.includes('haiku')) return [0.25, 1.25]
    return [3.0, 15.0] // sonnet default
  }
}

// ── OpenAI (also works for Ollama, Azure, any OpenAI-compatible API) ─────────

export class OpenAIProvider implements ChatProvider {
  name: string
  constructor(private apiKey: string, private baseUrl = 'https://api.openai.com/v1', name?: string) {
    this.name = name ?? 'openai'
  }

  async chat(opts: { messages: ChatMessage[]; system: string; tools: ToolDef[]; maxTokens: number; model: string }): Promise<ChatResponse> {
    // Convert Anthropic-style tools to OpenAI function-calling format
    const functions = opts.tools.map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }))

    // Convert Anthropic messages to OpenAI format
    const messages: any[] = [{ role: 'system', content: opts.system }]
    for (const msg of opts.messages) {
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          messages.push({ role: 'user', content: msg.content })
        } else if (Array.isArray(msg.content)) {
          // Tool results
          for (const block of msg.content) {
            if (block.type === 'tool_result') {
              messages.push({ role: 'tool', tool_call_id: block.tool_use_id, content: block.content })
            }
          }
        }
      } else if (msg.role === 'assistant') {
        if (Array.isArray(msg.content)) {
          const textParts = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
          const toolCalls = msg.content.filter((b: any) => b.type === 'tool_use').map((b: any) => ({
            id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) },
          }))
          messages.push({
            role: 'assistant',
            content: textParts || null,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          })
        } else {
          messages.push({ role: 'assistant', content: msg.content })
        }
      }
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens,
        messages,
        tools: functions.length > 0 ? functions : undefined,
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      const err: any = new Error(`OpenAI API ${response.status}: ${errText.slice(0, 300)}`)
      err.status = response.status
      throw err
    }

    const data = await response.json() as any
    const choice = data.choices?.[0]
    if (!choice) throw new Error('No response from OpenAI')

    // Convert OpenAI response to Anthropic format
    const content: ChatResponse['content'] = []
    if (choice.message.content) {
      content.push({ type: 'text', text: choice.message.content })
    }
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments || '{}'),
        })
      }
    }

    return {
      content,
      stop_reason: choice.message.tool_calls ? 'tool_use' : 'end_turn',
      usage: {
        input_tokens: data.usage?.prompt_tokens ?? 0,
        output_tokens: data.usage?.completion_tokens ?? 0,
      },
    }
  }

  costPer1M(model: string): [number, number] {
    if (model.includes('gpt-4o-mini')) return [0.15, 0.60]
    if (model.includes('gpt-4o')) return [2.50, 10.0]
    if (model.includes('gpt-4-turbo')) return [10.0, 30.0]
    if (model.includes('o1')) return [15.0, 60.0]
    if (model.includes('o3')) return [10.0, 40.0]
    return [2.50, 10.0] // default
  }
}

// ── Google Gemini ────────────────────────────────────────────────────────────

export class GeminiProvider implements ChatProvider {
  name = 'google'
  constructor(private apiKey: string) {}

  async chat(opts: { messages: ChatMessage[]; system: string; tools: ToolDef[]; maxTokens: number; model: string }): Promise<ChatResponse> {
    // Convert to Gemini format
    const contents: any[] = []
    for (const msg of opts.messages) {
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          contents.push({ role: 'user', parts: [{ text: msg.content }] })
        } else if (Array.isArray(msg.content)) {
          const parts: any[] = []
          for (const block of msg.content) {
            if (block.type === 'tool_result') {
              parts.push({ functionResponse: { name: block.tool_use_id, response: { content: block.content } } })
            }
          }
          if (parts.length > 0) contents.push({ role: 'user', parts })
        }
      } else if (msg.role === 'assistant') {
        if (Array.isArray(msg.content)) {
          const parts: any[] = []
          for (const block of msg.content) {
            if (block.type === 'text') parts.push({ text: block.text })
            if (block.type === 'tool_use') {
              parts.push({ functionCall: { name: block.name, args: block.input } })
            }
          }
          contents.push({ role: 'model', parts })
        }
      }
    }

    const geminiTools = opts.tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    }))

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: opts.system }] },
          tools: [{ functionDeclarations: geminiTools }],
          generationConfig: { maxOutputTokens: opts.maxTokens },
        }),
      }
    )

    if (!response.ok) {
      const errText = await response.text()
      const err: any = new Error(`Gemini API ${response.status}: ${errText.slice(0, 300)}`)
      err.status = response.status
      throw err
    }

    const data = await response.json() as any
    const candidate = data.candidates?.[0]
    if (!candidate) throw new Error('No response from Gemini')

    const content: ChatResponse['content'] = []
    let hasToolUse = false
    for (const part of candidate.content?.parts ?? []) {
      if (part.text) content.push({ type: 'text', text: part.text })
      if (part.functionCall) {
        hasToolUse = true
        content.push({
          type: 'tool_use',
          id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: part.functionCall.name,
          input: part.functionCall.args ?? {},
        })
      }
    }

    return {
      content,
      stop_reason: hasToolUse ? 'tool_use' : 'end_turn',
      usage: {
        input_tokens: data.usageMetadata?.promptTokenCount ?? 0,
        output_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    }
  }

  costPer1M(_model: string): [number, number] {
    return [0.075, 0.30] // Gemini 1.5 Flash pricing
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export type ProviderConfig = {
  provider: 'anthropic' | 'openai' | 'google' | 'ollama' | 'openai-compatible'
  apiKey: string
  model: string
  baseUrl?: string
  /** If set, Anthropic provider uses OAuth Bearer auth (subscription usage). */
  oauthAccessToken?: string
}

export function createProvider(config: ProviderConfig): ChatProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config.apiKey, config.baseUrl, config.oauthAccessToken)
    case 'openai':
      return new OpenAIProvider(config.apiKey, config.baseUrl ?? 'https://api.openai.com/v1')
    case 'google':
      return new GeminiProvider(config.apiKey)
    case 'ollama':
      return new OpenAIProvider('ollama', config.baseUrl ?? 'http://localhost:11434/v1', 'ollama')
    case 'openai-compatible':
      return new OpenAIProvider(config.apiKey, config.baseUrl ?? 'https://api.openai.com/v1', 'openai-compatible')
    default:
      return new AnthropicProvider(config.apiKey)
  }
}

/** Default model per provider */
export function defaultModel(provider: string): string {
  switch (provider) {
    case 'anthropic': return 'claude-sonnet-4-20250514'
    case 'openai': return 'gpt-4o'
    case 'google': return 'gemini-1.5-flash'
    case 'ollama': return 'llama3'
    default: return 'claude-sonnet-4-20250514'
  }
}
