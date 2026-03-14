import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { ptyManager } from '../workerbee/pty.js'
import { broadcastEvent } from '../ws/server.js'
import { preconfigureClaudeAuth } from '../claude-auth.js'
import type { MayorLee } from '../types/index.js'

const DEFAULT_REPO_PATH = process.env.SQUANSQ_REPO_PATH ?? process.env.HOME ?? '/opt/squansq-repo'
const SERVER_URL = `http://localhost:${process.env.PORT ?? 3001}`

export const mayorLeeManager = {
  async start(townId: string, apiKey?: string): Promise<MayorLee> {
    const db = getDb()

    const existing = await db.execute({ sql: 'SELECT * FROM mayors WHERE town_id = ?', args: [townId] })
    const row = existing.rows[0] as unknown as DbRow | undefined

    if (row?.session_id) {
      return toModel(row)
    }

    const id = row?.id ?? uuidv4()
    const repoPath = DEFAULT_REPO_PATH

    if (apiKey) preconfigureClaudeAuth(apiKey)

    // Bootstrap Mayor Lee's environment
    bootstrapMayorEnv(repoPath)

    const env: Record<string, string> = {
      SQUANSQ_ROLE: 'mayor-lee',
      SQUANSQ_TOWN: townId,
      SQUANSQ_MCP_URL: `${SERVER_URL}/api/mcp`,
    }
    if (apiKey) env.ANTHROPIC_API_KEY = apiKey

    const baseCommand = process.env.MAYOR_COMMAND ?? 'claude'

    const sessionId = ptyManager.spawn({
      shell: baseCommand,
      cwd: repoPath,
      env,
    })

    const now = new Date().toISOString()
    if (row) {
      await db.execute({
        sql: `UPDATE mayors SET session_id = ?, status = 'idle' WHERE id = ?`,
        args: [sessionId, id],
      })
    } else {
      await db.execute({
        sql: `INSERT INTO mayors (id, town_id, session_id, status, created_at) VALUES (?, ?, ?, 'idle', ?)`,
        args: [id, townId, sessionId, now],
      })
    }

    broadcastEvent({
      id: uuidv4(),
      type: 'mayorlee.started',
      payload: { mayorId: id, townId, sessionId },
      timestamp: now,
    })

    return (await this.get(townId))!
  },

  async stop(townId: string) {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM mayors WHERE town_id = ?', args: [townId] })
    const row = result.rows[0] as unknown as DbRow | undefined
    if (!row) return
    if (row.session_id) {
      ptyManager.kill(row.session_id)
    }
    await db.execute({
      sql: `UPDATE mayors SET session_id = NULL, status = 'idle' WHERE id = ?`,
      args: [row.id],
    })
    broadcastEvent({
      id: uuidv4(),
      type: 'mayorlee.stopped',
      payload: { mayorId: row.id, townId },
      timestamp: new Date().toISOString(),
    })
  },

  async sendMessage(townId: string, message: string) {
    const mayor = await this.get(townId)
    if (mayor?.sessionId) {
      ptyManager.write(mayor.sessionId, message + '\r')
    }
  },

  async get(townId: string): Promise<MayorLee | null> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM mayors WHERE town_id = ?', args: [townId] })
    const row = result.rows[0] as unknown as DbRow | undefined
    return row ? toModel(row) : null
  },
}

export const mayorManager = mayorLeeManager

function bootstrapMayorEnv(repoPath: string) {
  try {
    mkdirSync(repoPath, { recursive: true })

    // Write CLAUDE.md with orchestrator instructions and MCP info
    writeFileSync(
      path.join(repoPath, 'CLAUDE.md'),
      buildMayorClaudeMd(),
      'utf8'
    )

    // Write MCP server config for Claude CLI
    const claudeDir = path.join(repoPath, '.claude')
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(
      path.join(claudeDir, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          squansq: {
            url: `${SERVER_URL}/api/mcp`,
            transport: 'http',
          },
        },
      }, null, 2),
      'utf8'
    )

    console.log(`[Mayor Lee] Bootstrapped environment at ${repoPath}`)
  } catch (err) {
    console.warn(`[Mayor Lee] Failed to bootstrap environment: ${err}`)
  }
}

function buildMayorClaudeMd(): string {
  return `# Mayor Lee — Orchestrator

You are Mayor Lee, the orchestrator for this Squansq development platform.
Your job is to coordinate multiple WorkerBee agents to accomplish development tasks.

## MCP Server

You have access to the Squansq MCP server. Use the \`squansq\` MCP tools to manage agents.

## Available Tools

| Tool | Description |
|------|-------------|
| \`get_status_summary\` | Overview of all WorkerBees, Convoys, and AtomicTasks |
| \`list_workerbees\` | List all agents and their status |
| \`spawn_workerbee\` | Spawn a new agent with a task description |
| \`get_workerbee\` | Get details on a specific agent |
| \`kill_workerbee\` | Stop and remove an agent |
| \`list_projects\` | List all projects (git repos) |
| \`list_convoys\` | List all work bundles |
| \`create_convoy\` | Create a new work bundle |
| \`dispatch_convoy\` | Spawn an agent and assign it to a convoy |
| \`land_convoy\` | Mark a convoy as complete |
| \`list_atomic_tasks\` | List atomic work items |
| \`create_atomic_task\` | Create a new work item |
| \`list_hooks\` | List persistent work units |

## Workflow

1. Start by calling \`get_status_summary\` to understand current state
2. Break work into Convoys (feature areas) and AtomicTasks (individual tasks)
3. Use \`dispatch_convoy\` to assign work to agents — the Convoy description becomes CLAUDE.md
4. Monitor agents with \`list_workerbees\` — look for stalled or zombie agents
5. When an agent signals **DONE:** it will auto-complete; you can verify with \`get_workerbee\`
6. Land convoys with \`land_convoy\` when all work is done

## Notes

- Each WorkerBee gets its own git worktree — they work in isolation
- Stalled agents (no output for 5min) can be killed and respawned
- Use \`get_status_summary\` to get a quick health check
`
}

interface DbRow {
  id: string
  town_id: string
  session_id: string | null
  status: MayorLee['status']
  created_at: string
}

function toModel(r: DbRow): MayorLee {
  return {
    id: r.id,
    townId: r.town_id,
    sessionId: r.session_id,
    status: r.status,
    createdAt: r.created_at,
  }
}
