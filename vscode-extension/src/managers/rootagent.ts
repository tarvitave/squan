import { mkdirSync, writeFileSync, copyFileSync, existsSync, readdirSync } from 'fs'
import * as path from 'path'
import * as os from 'os'
import { v4 as uuidv4 } from 'uuid'
import * as vscode from 'vscode'
import { getDb } from '../db'
import { broadcastEvent } from '../events'
import type { MayorLee } from '../types'
import type { VsTerminalManager } from '../terminal/manager'

// Module-level terminal manager — shared with workerbee manager
let terminalManager: VsTerminalManager | null = null

export function setRootAgentTerminalManager(tm: VsTerminalManager): void {
  terminalManager = tm
}

function getTerminalManager(): VsTerminalManager {
  if (!terminalManager) throw new Error('TerminalManager not initialized')
  return terminalManager
}

function getClaudeCommand(): string {
  const configured = vscode.workspace.getConfiguration('squansq').get<string>('claudeCommand', 'claude')
  if (configured !== 'claude') return configured

  if (process.platform === 'win32') {
    const candidates = [
      path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd'),
      'claude.cmd',
      'claude',
    ]
    for (const c of candidates) {
      if (existsSync(c)) return c
    }
    return 'claude.cmd'
  }
  return 'claude'
}

export const rootAgentManager = {
  async start(mcpPort: number, workspacePath?: string): Promise<MayorLee> {
    const db = getDb()
    const tm = getTerminalManager()
    const townId = 'local'

    const existing = await db.execute({
      sql: 'SELECT * FROM mayors WHERE town_id = ?',
      args: [townId],
    })
    const row = existing.rows[0] as unknown as DbRow | undefined

    // Check if there's already a running session
    if (row?.session_id && tm.list().includes(row.session_id)) {
      return toModel(row)
    }

    // Clear stale session ID
    if (row?.session_id) {
      await db.execute({ sql: `UPDATE mayors SET session_id = NULL WHERE id = ?`, args: [row.id] })
    }

    const id = row?.id ?? uuidv4()

    // Determine the workspace path to run the root agent in
    const repoPath = workspacePath
      ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      ?? os.homedir()

    // Bootstrap the Mayor environment (CLAUDE.md + .mcp.json)
    bootstrapMayorEnv(repoPath, mcpPort)

    // Create isolated CLAUDE_CONFIG_DIR
    const mayorConfigDir = path.join(os.tmpdir(), 'squansq-mayor-config', townId)
    mkdirSync(mayorConfigDir, { recursive: true })

    // Seed credentials from ~/.claude/
    const homeClaudeDir = path.join(os.homedir(), '.claude')
    const configSrc = path.join(homeClaudeDir, 'config.json')
    if (existsSync(configSrc)) {
      try { copyFileSync(configSrc, path.join(mayorConfigDir, 'config.json')) } catch { /* ignore */ }
    }

    // Copy statsig evaluations cache
    const statsigSrc = path.join(homeClaudeDir, 'statsig')
    if (existsSync(statsigSrc)) {
      try {
        const statsigDst = path.join(mayorConfigDir, 'statsig')
        mkdirSync(statsigDst, { recursive: true })
        for (const f of readdirSync(statsigSrc)) {
          copyFileSync(path.join(statsigSrc, f), path.join(statsigDst, f))
        }
      } catch { /* ignore */ }
    }

    // Write settings
    const mayorSettings: Record<string, unknown> = {
      skipDangerousModePermissionPrompt: true,
      theme: 'dark',
    }
    writeFileSync(path.join(mayorConfigDir, 'settings.json'), JSON.stringify(mayorSettings), 'utf8')

    const command = getClaudeCommand()
    const env: Record<string, string> = {
      SQUANSQ_ROLE: 'root-agent',
      SQUANSQ_TOWN: townId,
      SQUANSQ_MCP_URL: `http://127.0.0.1:${mcpPort}/mcp`,
      CLAUDE_CONFIG_DIR: mayorConfigDir,
    }

    console.log(`[RootAgent] Spawning: ${command} --dangerously-skip-permissions in ${repoPath}`)
    const sessionId = tm.spawn({
      name: 'Root Agent (Squansq)',
      shellPath: command,
      shellArgs: ['--dangerously-skip-permissions'],
      cwd: repoPath,
      env,
    })

    // Show the terminal so the user can see it
    tm.show(sessionId)

    // Auto-answer startup prompts
    attachRootAgentMonitor(sessionId)

    tm.onSessionExit(sessionId, (exitCode) => {
      console.log(`[RootAgent] Terminal exited with code ${exitCode} (sessionId=${sessionId})`)
      db.execute({
        sql: `UPDATE mayors SET session_id = NULL WHERE session_id = ?`,
        args: [sessionId],
      }).catch(() => {})
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
      type: 'rootagent.started',
      payload: { mayorId: id, townId, sessionId },
      timestamp: now,
    })

    return (await this.get())!
  },

  async stop(): Promise<void> {
    const db = getDb()
    const tm = getTerminalManager()
    const result = await db.execute({
      sql: 'SELECT * FROM mayors WHERE town_id = ?',
      args: ['local'],
    })
    const row = result.rows[0] as unknown as DbRow | undefined
    if (!row) return

    if (row.session_id) {
      tm.kill(row.session_id)
    }

    await db.execute({
      sql: `UPDATE mayors SET session_id = NULL, status = 'idle' WHERE id = ?`,
      args: [row.id],
    })

    broadcastEvent({
      id: uuidv4(),
      type: 'rootagent.stopped',
      payload: { mayorId: row.id, townId: 'local' },
      timestamp: new Date().toISOString(),
    })
  },

  async sendMessage(message: string): Promise<void> {
    const mayor = await this.get()
    const tm = getTerminalManager()
    if (mayor?.sessionId) {
      tm.write(mayor.sessionId, message + '\r')
    }
  },

  async get(): Promise<MayorLee | null> {
    const db = getDb()
    const result = await db.execute({
      sql: 'SELECT * FROM mayors WHERE town_id = ?',
      args: ['local'],
    })
    const row = result.rows[0] as unknown as DbRow | undefined
    return row ? toModel(row) : null
  },

  async isRunning(): Promise<boolean> {
    const tm = terminalManager
    if (!tm) return false
    const mayor = await this.get()
    return !!(mayor?.sessionId && tm.list().includes(mayor.sessionId))
  },
}

function bootstrapMayorEnv(repoPath: string, mcpPort: number): void {
  try {
    mkdirSync(repoPath, { recursive: true })

    writeFileSync(
      path.join(repoPath, 'CLAUDE.md'),
      buildMayorClaudeMd(),
      'utf8'
    )

    writeFileSync(
      path.join(repoPath, '.mcp.json'),
      JSON.stringify(
        {
          mcpServers: {
            squansq: {
              type: 'http',
              url: `http://127.0.0.1:${mcpPort}/mcp`,
            },
          },
        },
        null,
        2
      ),
      'utf8'
    )

    console.log(`[RootAgent] Bootstrapped environment at ${repoPath}`)
  } catch (err) {
    console.warn(`[RootAgent] Failed to bootstrap environment: ${err}`)
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

// Auto-answer Claude Code startup prompts so the Root Agent never hangs.
function attachRootAgentMonitor(sessionId: string): void {
  const tm = getTerminalManager()
  const monitorId = `root-monitor-${sessionId}`
  let tail = ''

  tm.subscribe(sessionId, monitorId, (data) => {
    tail = (tail + data).slice(-4000)
  })

  const watchdog = setInterval(() => {
    const allPlain = tail.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '')
    const lines = allPlain.split('\n').filter((l) => l.trim())
    const screen = lines.slice(-10).join('\n')

    if (!screen) return

    console.log(`[RootAgent] Watchdog screen: ${screen.replace(/\n/g, ' | ').slice(-300)}`)

    const isLoginPrompt  = screen.includes('Select login method') || screen.includes('login method')
    const isThemePrompt  = screen.includes('Dark mode') || screen.includes('Choose a theme') || screen.includes('color theme')
    const isApiKeyPrompt = screen.includes('Do you want to use this API key')
    const isYesNoPrompt  = screen.includes('(y/N)') || screen.includes('(Y/n)') || screen.includes('(yes/no)')
    const isMcpPrompt    = /trust.*MCP|allow.*MCP|MCP.*trust|MCP.*allow/i.test(screen)

    const hasPrompt = isLoginPrompt || isThemePrompt || isApiKeyPrompt || isYesNoPrompt || isMcpPrompt

    if (!hasPrompt && screen.includes('\u276f')) {
      // Bare ❯ with no interactive prompt text → Claude is at its input prompt
      console.log('[RootAgent] Watchdog: ready, stopping')
      clearInterval(watchdog)
      return
    }

    if (!hasPrompt) return

    console.log('[RootAgent] Watchdog: dismissing prompt...')
    tail = ''

    if (isLoginPrompt) {
      tm.write(sessionId, '\x1b[B') // down arrow
      setTimeout(() => tm.write(sessionId, '\r'), 150)
    } else if (isApiKeyPrompt) {
      tm.write(sessionId, '1\r')
    } else if (isYesNoPrompt) {
      tm.write(sessionId, 'y\r')
    } else {
      tm.write(sessionId, '\r') // accept default
    }
  }, 1500)

  // Stop after 90s regardless
  setTimeout(() => clearInterval(watchdog), 90_000)

  tm.onSessionExit(sessionId, () => {
    clearInterval(watchdog)
    tm.unsubscribe(sessionId, monitorId)
  })
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
