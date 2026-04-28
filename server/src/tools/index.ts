import { registry } from './registry'
import type { ToolContext } from './registry'
import { filesystemTools } from './filesystem'
import { gitTools } from './git'
import { codeAnalysisTools } from './code-analysis'
import { networkTools } from './network'
import { databaseTools } from './database'
import { systemTools } from './system'
import { agentTools } from './agent'

// Register all built-in tool categories
registry.register(filesystemTools)
registry.register(gitTools)
registry.register(codeAnalysisTools)
registry.register(networkTools)
registry.register(databaseTools)
registry.register(systemTools)
registry.register(agentTools)

export { registry }
export type { ToolDefinition, ToolResult, ToolContext, ToolHandler, ToolCategory } from './registry'

// Convenience: get all tool definitions formatted for the Anthropic API
export function getToolDefinitions() {
  return registry.getDefinitions().map(def => ({
    name: def.name,
    description: def.description,
    input_schema: def.input_schema,
  }))
}

// Convenience: execute a tool by name
export async function executeTool(name: string, input: Record<string, unknown>, context: ToolContext) {
  return registry.execute(name, input, context)
}

// Print tool inventory on startup
export function logToolInventory() {
  const cats = registry.listCategories()
  const total = registry.getDefinitions().length
  console.log(`[tools] ${total} tools registered across ${cats.length} categories:`)
  for (const cat of cats) {
    const defs = registry.getDefinitionsByCategory(cat)
    console.log(`  ${cat}: ${defs.map(d => d.name).join(', ')}`)
  }
}
