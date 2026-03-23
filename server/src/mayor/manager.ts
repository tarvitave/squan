import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { ptyManager } from '../workerbee/pty.js'
import { broadcastEvent } from '../ws/server.js'
import { preconfigureClaudeAuth } from '../claude-auth.js'
import type { MayorLee } from '../types/index.js'

const DEFAULT_REPO_PATH = process.env.SQUANSQ_REPO_PATH ?? process.env.HOME ?? '/opt/squansq-repo'
const SERVER_URL = `http://127.0.0.1:${process.env.PORT ?? 3001}`

export const mayorLeeManager = {
  async start(townId: string, apiKey?: string, userId?: string): Promise<MayorLee> {
    const db = getDb()

    // Scope mayor lookup to userId if provided
    let existing
    if (userId) {
      existing = await db.execute({
        sql: 'SELECT * FROM mayors WHERE town_id = ? AND (user_id = ? OR user_id IS NULL)',
        args: [townId, userId],
      })
    } else {
      existing = await db.execute({ sql: 'SELECT * FROM mayors WHERE town_id = ?', args: [townId] })
    }
    const row = existing.rows[0] as unknown as DbRow | undefined

    if (row?.session_id && ptyManager.list().includes(row.session_id)) {
      return toModel(row)
    }

    // Session ID in DB but PTY is gone — clear it so we spawn a fresh session
    if (row?.session_id) {
      await db.execute({ sql: `UPDATE mayors SET session_id = NULL WHERE id = ?`, args: [row.id] })
      ;(row as DbRow).session_id = null
    }

    const id = row?.id ?? uuidv4()

    // Use the town's path if set, otherwise fall back to env var
    const townRow = await db.execute({ sql: 'SELECT path FROM towns WHERE id = ?', args: [townId] })
    const townPath = (townRow.rows[0] as unknown as { path?: string } | undefined)?.path
    const repoPath = townPath || DEFAULT_REPO_PATH

    if (apiKey) preconfigureClaudeAuth(apiKey)

    // Bootstrap Mayor Lee's environment
    bootstrapMayorEnv(repoPath)

    const env: Record<string, string> = {
      SQUANSQ_ROLE: 'mayor-lee',
      SQUANSQ_TOWN: townId,
      SQUANSQ_MCP_URL: `${SERVER_URL}/api/mcp?townId=${townId}`,
    }
    if (apiKey) env.ANTHROPIC_API_KEY = apiKey

    const baseCommand = process.env.MAYOR_COMMAND ?? 'claude'

    console.log(`[Mayor Lee] Spawning: ${baseCommand} --dangerously-skip-permissions in ${repoPath}`)
    const sessionId = ptyManager.spawn({
      shell: baseCommand,
      args: ['--dangerously-skip-permissions'],
      cwd: repoPath,
      env,
      ownerUserId: userId,
    })

    // Auto-answer startup prompts (same as WorkerBee signal monitor)
    attachRootAgentMonitor(sessionId)

    ptyManager.onSessionExit(sessionId, (exitCode) => {
      console.log(`[Mayor Lee] PTY exited with code ${exitCode} (sessionId=${sessionId})`)
      db.execute({ sql: `UPDATE mayors SET session_id = NULL WHERE session_id = ?`, args: [sessionId] }).catch(() => {})
    })

    const now = new Date().toISOString()
    if (row) {
      await db.execute({
        sql: `UPDATE mayors SET session_id = ?, status = 'idle' WHERE id = ?`,
        args: [sessionId, id],
      })
    } else {
      await db.execute({
        sql: `INSERT INTO mayors (id, town_id, session_id, status, user_id, created_at) VALUES (?, ?, ?, 'idle', ?, ?)`,
        args: [id, townId, sessionId, userId ?? null, now],
      })
    }

    broadcastEvent({
      id: uuidv4(),
      type: 'rootagent.started',
      payload: { mayorId: id, townId, sessionId },
      timestamp: now,
    })

    return (await this.get(townId, userId))!
  },

  async stop(townId: string, userId?: string) {
    const db = getDb()
    let result
    if (userId) {
      result = await db.execute({
        sql: 'SELECT * FROM mayors WHERE town_id = ? AND (user_id = ? OR user_id IS NULL)',
        args: [townId, userId],
      })
    } else {
      result = await db.execute({ sql: 'SELECT * FROM mayors WHERE town_id = ?', args: [townId] })
    }
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
      type: 'rootagent.stopped',
      payload: { mayorId: row.id, townId },
      timestamp: new Date().toISOString(),
    })
  },

  async sendMessage(townId: string, message: string, userId?: string) {
    const mayor = await this.get(townId, userId)
    if (mayor?.sessionId) {
      ptyManager.write(mayor.sessionId, message + '\r')
    }
  },

  async get(townId: string, userId?: string): Promise<MayorLee | null> {
    const db = getDb()
    if (userId) {
      const result = await db.execute({
        sql: 'SELECT * FROM mayors WHERE town_id = ? AND (user_id = ? OR user_id IS NULL)',
        args: [townId, userId],
      })
      const row = result.rows[0] as unknown as DbRow | undefined
      return row ? toModel(row) : null
    }
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

    // Write MCP server config for Claude CLI (.mcp.json at project root)
    writeFileSync(
      path.join(repoPath, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          squansq: {
            type: 'http',
            url: `${SERVER_URL}/api/mcp`,
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
  return `# Root Agent — Orchestrator

You are the Root Agent, the orchestrator for this Squansq development platform.
Your job is to coordinate multiple specialized agents to accomplish development tasks.

## MCP Server

You have access to the Squansq MCP server. Use the \`squansq\` MCP tools to manage agents.

## Available Tools

### Core Orchestration
| Tool | Description |
|------|-------------|
| \`get_status_summary\` | Full overview: each agent's name/role/status/task, each release train with its atomic tasks |
| \`list_workerbees\` | List all agents and their status |
| \`spawn_workerbee\` | Spawn a new agent (only when no release train is needed) |
| \`get_workerbee\` | Get details on a specific agent |
| \`kill_workerbee\` | Stop and remove an agent |
| \`list_projects\` | List all projects (git repos) — call this first to get project IDs |

### Work Planning
| Tool | Description |
|------|-------------|
| \`list_release_trains\` | List all work bundles |
| \`create_release_train\` | Create a new work bundle for a feature area |
| \`get_release_train\` | Get full details of a release train including its atomic tasks |
| \`dispatch_release_train\` | Spawn a WorkerBee and assign it to a release train |
| \`land_release_train\` | Mark a release train as complete (call after agent signals DONE) |
| \`list_atomic_tasks\` | List atomic work items |
| \`create_atomic_task\` | Create an atomic work item and link it to a release train |
| \`update_atomic_task\` | Update an atomic task's status (open/in_progress/done/blocked) |
| \`update_release_train\` | Update a release train's description before dispatching |

### Agent Roles & Routing
| Tool | Description |
|------|-------------|
| \`suggest_role\` | Given a task description, get the best agent role (coder/tester/reviewer/devops/lead) |
| \`list_routing_rules\` | See domain ownership rules for a project |
| \`set_routing_rule\` | Map a keyword pattern to an agent role (e.g. "tests" → tester) |

### Institutional Knowledge (Charters)
| Tool | Description |
|------|-------------|
| \`get_charter\` | Get the accumulated knowledge for a role on a project |
| \`update_charter\` | Add or update charter content for a role |

### Other
| Tool | Description |
|------|-------------|
| \`list_hooks\` | List persistent work units |

## Agent Roles

Each agent has a **role** that shapes its CLAUDE.md and determines what prior knowledge (charter) it inherits:

| Role | Best for |
|------|----------|
| \`coder\` | Feature implementation, bug fixes, new code (default) |
| \`tester\` | Writing tests, coverage, edge cases, integration specs |
| \`reviewer\` | Code quality, security, design review, refactoring |
| \`devops\` | CI/CD, Docker, deployment, infrastructure, scripts |
| \`lead\` | Architecture decisions, cross-cutting concerns, coordination |

**Always call \`suggest_role\` before dispatching** — it checks project routing rules and heuristics.
Pass the role to \`dispatch_release_train\` so the agent starts with the right context.

## Charters (Institutional Knowledge)

Agents accumulate knowledge as they work. After each session, they output LEARNINGS which are
auto-saved to the project charter for their role. On the next dispatch, the charter is injected
into their CLAUDE.md so they start smarter.

- Call \`get_charter(projectId, role)\` before planning a task to read prior knowledge
- Call \`update_charter\` to manually add context (conventions, architecture notes, gotchas)

## Decision Log

Agents are instructed to log important decisions to \`DECISIONS.md\` in the project root.
Read this file to understand prior architectural choices before planning new work.

## Mandatory Planning Workflow

**RULE: Never dispatch a WorkerBee without first planning the work.**

For every user request, follow this sequence exactly:

### Step 1 — Orient
Call \`get_status_summary\` to see current state. Call \`list_projects\` to get project IDs.
For non-trivial tasks, call \`get_charter\` to read prior knowledge for the relevant role.

### Step 2 — Plan
Break the request into feature areas (ReleaseTrains) and discrete tasks (AtomicTasks).
- Create one ReleaseTrain per independent feature area or work stream
- Create AtomicTasks inside each ReleaseTrain for the specific steps
- Call \`suggest_role\` to determine the right agent type for each train
- Set dependencies between AtomicTasks where order matters

### Step 3 — Dispatch
For each ReleaseTrain that is ready to start:
- Call \`dispatch_release_train\` with the \`role\` parameter set appropriately
- The ReleaseTrain description **is** the agent's CLAUDE.md — make it detailed and actionable
- Include project conventions and architectural context in the description
- Only dispatch trains whose AtomicTask dependencies are met

### Step 4 — Monitor
When notified that an agent completed or stalled:
1. Call \`get_status_summary\` to review state
2. Call \`update_atomic_task\` to mark completed tasks as done
3. If a ReleaseTrain's work is done, call \`land_release_train\`
4. Dispatch the next wave of ReleaseTrains whose dependencies are now met
5. If an agent is stalled or zombie, kill it with \`kill_workerbee\` and re-dispatch

### Step 5 — Complete
When all ReleaseTrains are landed, summarize what was accomplished.

## Key Rules

- **Always plan before dispatching** — create the ReleaseTrain and its AtomicTasks first
- **Use roles** — always call \`suggest_role\` and pass it to \`dispatch_release_train\`
- **Read charters** — check prior knowledge before starting new work on a project
- **Write detailed ReleaseTrain descriptions** — the description becomes the agent's full instructions
- **Include project context in descriptions** — the agent has no other context beyond its CLAUDE.md
- **Run independent trains in parallel** — dispatch multiple agents when there are no dependencies
- **Keep AtomicTasks granular** — one concrete deliverable per task, not vague areas
- **Track progress via \`update_atomic_task\`** — mark tasks done as agents report completion

## Notes

- Each WorkerBee gets its own git worktree — they work in isolation on their own branch
- Zombie/stalled agents should be killed and re-dispatched
- Agents log decisions to DECISIONS.md — read it to understand prior choices
- Use \`get_status_summary\` as your primary health check tool
`
}

// Auto-answer Claude Code startup prompts so the Root Agent never hangs
function attachRootAgentMonitor(sessionId: string) {
  const monitorId = `root-monitor-${sessionId}`
  let tail = ''
  let loginAnswered = false
  let themeAnswered = false
  let apiKeyAnswered = false

  ptyManager.subscribe(sessionId, monitorId, (data) => {
    tail = (tail + data).slice(-3000)

    if (!loginAnswered && (tail.includes('Select login method') || tail.includes('login method'))) {
      loginAnswered = true; tail = ''
      setTimeout(() => {
        ptyManager.write(sessionId, '\x1b[B')
        setTimeout(() => ptyManager.write(sessionId, '\r'), 150)
        console.log('[Root Agent] Auto-selected login method 2 (API usage)')
      }, 500)
    }

    if (!themeAnswered && (
      tail.includes('Dark mode') || tail.includes('dark mode') ||
      tail.includes('color theme') || tail.includes('Color theme') ||
      tail.includes('Choose a theme') || tail.includes('color scheme')
    )) {
      themeAnswered = true; tail = ''
      setTimeout(() => {
        ptyManager.write(sessionId, '\r')
        console.log('[Root Agent] Auto-answered theme prompt')
      }, 300)
    }

    if (!apiKeyAnswered && tail.includes('Do you want to use this API key')) {
      apiKeyAnswered = true; tail = ''
      setTimeout(() => {
        ptyManager.write(sessionId, '1\r')
        console.log('[Root Agent] Accepted API key prompt')
      }, 300)
    }
  })

  // Stop monitoring once the session exits
  ptyManager.onSessionExit(sessionId, () => {
    ptyManager.unsubscribe(sessionId, monitorId)
  })
}

interface DbRow {
  id: string
  town_id: string
  session_id: string | null
  status: MayorLee['status']
  user_id: string | null
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
