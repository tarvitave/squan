/**
 * Tool Registry — Central registry for all agent tools.
 *
 * Tools are grouped into categories (filesystem, shell, web, etc.) and
 * registered at startup.  The registry provides:
 *   • A flat list of ToolDefinitions (for the Anthropic `tools` param)
 *   • Name→handler dispatch via `execute()`
 *   • Category-level querying for UI / permission gating
 *
 * Usage:
 *   import { registry } from '../tools/registry.js'
 *   import '../tools/filesystem.js'   // side-effect: registers category
 *
 *   const defs   = registry.getDefinitions()
 *   const result = await registry.execute('read_file', { path: 'foo.ts' }, ctx)
 */

// ── Public interfaces ────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string
  description: string
  category: string
  input_schema: {
    type: 'object'
    properties: Record<string, any>
    required: string[]
  }
}

export interface ToolResult {
  result: string
  isError: boolean
}

export interface ToolContext {
  /** Agent's working directory — all relative paths resolve against this. */
  cwd: string
  /** Which agent is calling (for audit / rate-limiting). */
  agentId?: string
  /** Which project the call belongs to. */
  projectId?: string
  /** Optional callback for streaming real-time events to the client. */
  emit?: (event: string, data: any) => void
}

export type ToolHandler = (
  input: Record<string, unknown>,
  context: ToolContext,
) => Promise<ToolResult> | ToolResult

export interface ToolEntry {
  definition: ToolDefinition
  handler: ToolHandler
}

export interface ToolCategory {
  name: string
  description: string
  tools: ToolEntry[]
}

// ── Registry class ───────────────────────────────────────────────────────────

class ToolRegistry {
  private categories = new Map<string, ToolCategory>()
  private handlers = new Map<string, ToolHandler>()
  private definitions = new Map<string, ToolDefinition>()

  /**
   * Register an entire category of tools.
   * Throws if any tool name collides with an existing registration.
   */
  register(category: ToolCategory): void {
    if (this.categories.has(category.name)) {
      throw new Error(`[ToolRegistry] Category "${category.name}" is already registered`)
    }

    for (const { definition, handler } of category.tools) {
      if (this.handlers.has(definition.name)) {
        throw new Error(
          `[ToolRegistry] Tool "${definition.name}" is already registered ` +
            `(in category "${this.definitions.get(definition.name)!.category}")`,
        )
      }
      this.handlers.set(definition.name, handler)
      this.definitions.set(definition.name, definition)
    }

    this.categories.set(category.name, category)
  }

  /** All tool definitions — suitable for the Anthropic `tools` parameter. */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.definitions.values())
  }

  /**
   * Tool definitions filtered by category.
   * Returns an empty array if the category doesn't exist.
   */
  getDefinitionsByCategory(category: string): ToolDefinition[] {
    const cat = this.categories.get(category)
    return cat ? cat.tools.map((t) => t.definition) : []
  }

  /** Execute a tool by name. Throws on unknown tool names. */
  async execute(
    name: string,
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const handler = this.handlers.get(name)
    if (!handler) {
      return { result: `Unknown tool: ${name}`, isError: true }
    }
    try {
      return await handler(input, context)
    } catch (err) {
      return {
        result: `Tool "${name}" threw: ${(err as Error).message}`,
        isError: true,
      }
    }
  }

  /** Check whether a tool name is registered. */
  has(name: string): boolean {
    return this.handlers.has(name)
  }

  /** Registered category names. */
  listCategories(): string[] {
    return Array.from(this.categories.keys())
  }

  /** Get category metadata (null if not found). */
  getCategory(name: string): ToolCategory | null {
    return this.categories.get(name) ?? null
  }

  /** Total number of registered tools. */
  get size(): number {
    return this.handlers.size
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const registry = new ToolRegistry()
