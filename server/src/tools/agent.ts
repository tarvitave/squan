import * as fs from 'fs'
import * as path from 'path'
import type { ToolCategory, ToolResult, ToolContext } from './registry'

function success(result: string): ToolResult {
  return { result, isError: false }
}

function error(result: string): ToolResult {
  return { result, isError: true }
}

function ensureSquanDir(projectDir: string): string {
  const squanDir = path.join(projectDir, '.squan')
  if (!fs.existsSync(squanDir)) {
    fs.mkdirSync(squanDir, { recursive: true })
  }
  return squanDir
}

function getSharedContextPath(cwd: string): string {
  const squanDir = ensureSquanDir(cwd)
  return path.join(squanDir, 'shared-context.json')
}

function readSharedContextFile(cwd: string): Record<string, unknown> {
  const contextPath = getSharedContextPath(cwd)
  if (!fs.existsSync(contextPath)) {
    return {}
  }
  try {
    const raw = fs.readFileSync(contextPath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function writeSharedContextFile(cwd: string, data: Record<string, unknown>): void {
  const contextPath = getSharedContextPath(cwd)
  fs.writeFileSync(contextPath, JSON.stringify(data, null, 2), 'utf-8')
}

export const agentTools: ToolCategory = {
  name: 'agent',
  description: 'Agent coordination — delegate tasks, share context, communicate with other agents, and create reusable skills.',
  tools: [
    // ── delegate_task ──
    {
      definition: {
        name: 'delegate_task',
        description: 'Request another agent be spawned to handle a subtask. The server will handle actual agent spawning.',
        category: 'agent',
        input_schema: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
              description: 'Description of the task to delegate',
            },
            project: {
              type: 'string',
              description: 'Project directory to work in (defaults to current working directory)',
            },
            wait: {
              type: 'boolean',
              description: 'If true, wait for the delegated task to complete before continuing',
              default: false,
            },
          },
          required: ['description'],
        },
      },
      handler(input: Record<string, unknown>, context: ToolContext): ToolResult {
        const description = input.description as string
        const project = (input.project as string) || context.cwd
        const wait = (input.wait as boolean) ?? false

        if (context.emit) {
          context.emit('delegate_request', {
            description,
            project,
            wait,
            requestingAgent: context.agentId,
          })
        }

        return success(
          `Delegation requested: "${description}" in project ${project}` +
          (wait ? ' (waiting for completion)' : ' (fire-and-forget)') +
          '. The server will spawn an agent to handle this.'
        )
      },
    },

    // ── ask_agent ──
    {
      definition: {
        name: 'ask_agent',
        description: 'Send a question to another running agent and wait for a response.',
        category: 'agent',
        input_schema: {
          type: 'object',
          properties: {
            agent_id: {
              type: 'string',
              description: 'The ID of the agent to ask',
            },
            question: {
              type: 'string',
              description: 'The question to send to the agent',
            },
          },
          required: ['agent_id', 'question'],
        },
      },
      handler(input: Record<string, unknown>, context: ToolContext): ToolResult {
        const agentId = input.agent_id as string
        const question = input.question as string

        if (context.emit) {
          context.emit('agent_question', {
            targetAgent: agentId,
            question,
            fromAgent: context.agentId,
          })
        }

        return success(`Question sent to agent ${agentId}: "${question}". Awaiting response.`)
      },
    },

    // ── share_context ──
    {
      definition: {
        name: 'share_context',
        description: 'Share a piece of information with all other agents working on the same project. Writes to .squan/shared-context.json.',
        category: 'agent',
        input_schema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Descriptive name for the shared information',
            },
            value: {
              type: 'string',
              description: 'The information to share',
            },
          },
          required: ['key', 'value'],
        },
      },
      handler(input: Record<string, unknown>, context: ToolContext): ToolResult {
        const key = input.key as string
        const value = input.value as string

        try {
          const data = readSharedContextFile(context.cwd)
          data[key] = {
            value,
            setBy: context.agentId || 'unknown',
            timestamp: new Date().toISOString(),
          }
          writeSharedContextFile(context.cwd, data)
          return success(`Shared context key "${key}" written to .squan/shared-context.json`)
        } catch (err: any) {
          return error(`Failed to write shared context: ${err.message}`)
        }
      },
    },

    // ── read_shared_context ──
    {
      definition: {
        name: 'read_shared_context',
        description: 'Read shared context from other agents. Reads from .squan/shared-context.json.',
        category: 'agent',
        input_schema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Specific key to read. If omitted, returns all shared context.',
            },
          },
          required: [],
        },
      },
      handler(input: Record<string, unknown>, context: ToolContext): ToolResult {
        try {
          const data = readSharedContextFile(context.cwd)
          const key = input.key as string | undefined

          if (key) {
            if (key in data) {
              return success(JSON.stringify(data[key], null, 2))
            }
            return error(`Key "${key}" not found in shared context`)
          }

          if (Object.keys(data).length === 0) {
            return success('Shared context is empty — no keys have been set yet.')
          }

          return success(JSON.stringify(data, null, 2))
        } catch (err: any) {
          return error(`Failed to read shared context: ${err.message}`)
        }
      },
    },

    // ── create_skill ──
    {
      definition: {
        name: 'create_skill',
        description: 'Save the current task workflow as a reusable skill template. Writes to .squan/skills/{name}.yaml.',
        category: 'agent',
        input_schema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Name of the skill (used as filename)',
            },
            description: {
              type: 'string',
              description: 'Description of what the skill does',
            },
            steps: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of step descriptions that make up the skill',
            },
          },
          required: ['name', 'description', 'steps'],
        },
      },
      handler(input: Record<string, unknown>, context: ToolContext): ToolResult {
        const name = input.name as string
        const description = input.description as string
        const steps = input.steps as string[]

        try {
          const squanDir = ensureSquanDir(context.cwd)
          const skillsDir = path.join(squanDir, 'skills')
          if (!fs.existsSync(skillsDir)) {
            fs.mkdirSync(skillsDir, { recursive: true })
          }

          // Build simple YAML content
          let yaml = `name: ${name}\n`
          yaml += `description: ${description}\n`
          yaml += `created: ${new Date().toISOString()}\n`
          yaml += `created_by: ${context.agentId || 'unknown'}\n`
          yaml += `steps:\n`
          for (let i = 0; i < steps.length; i++) {
            yaml += `  - step: ${i + 1}\n`
            yaml += `    description: ${steps[i]}\n`
          }

          const skillPath = path.join(skillsDir, `${name}.yaml`)
          fs.writeFileSync(skillPath, yaml, 'utf-8')

          return success(`Skill "${name}" saved to .squan/skills/${name}.yaml with ${steps.length} steps`)
        } catch (err: any) {
          return error(`Failed to create skill: ${err.message}`)
        }
      },
    },

    // ── notify_user ──
    {
      definition: {
        name: 'notify_user',
        description: 'Send a notification or message to the user.',
        category: 'agent',
        input_schema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'The notification message',
            },
            level: {
              type: 'string',
              enum: ['info', 'warning', 'error'],
              description: 'Notification level',
              default: 'info',
            },
          },
          required: ['message'],
        },
      },
      handler(input: Record<string, unknown>, context: ToolContext): ToolResult {
        const message = input.message as string
        const level = (input.level as string) || 'info'

        if (context.emit) {
          context.emit('user_notification', {
            message,
            level,
            fromAgent: context.agentId,
            timestamp: new Date().toISOString(),
          })
        }

        return success(`Notification sent to user [${level}]: ${message}`)
      },
    },

    // ── request_review ──
    {
      definition: {
        name: 'request_review',
        description: 'Request human review of the current work before continuing.',
        category: 'agent',
        input_schema: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description: 'Summary of what needs to be reviewed',
            },
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of file paths to review',
            },
          },
          required: ['summary'],
        },
      },
      handler(input: Record<string, unknown>, context: ToolContext): ToolResult {
        const summary = input.summary as string
        const files = (input.files as string[]) || []

        if (context.emit) {
          context.emit('review_request', {
            summary,
            files,
            fromAgent: context.agentId,
            timestamp: new Date().toISOString(),
          })
        }

        const fileList = files.length > 0 ? `\nFiles for review:\n${files.map(f => `  - ${f}`).join('\n')}` : ''
        return success(`Review requested: ${summary}${fileList}\nWaiting for human review.`)
      },
    },

    // ── task_complete ──
    {
      definition: {
        name: 'task_complete',
        description: 'Signal that the current task is complete.',
        category: 'agent',
        input_schema: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description: 'Summary of what was accomplished',
            },
          },
          required: ['summary'],
        },
      },
      handler(input: Record<string, unknown>, context: ToolContext): ToolResult {
        const summary = input.summary as string

        if (context.emit) {
          context.emit('task_complete', {
            summary,
            agentId: context.agentId,
            timestamp: new Date().toISOString(),
          })
        }

        return success(`Task complete: ${summary}`)
      },
    },
  ],
}
