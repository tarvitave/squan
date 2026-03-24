import { execFileSync } from 'child_process'
import { readdirSync } from 'fs'
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as vscode from 'vscode'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db'
import { rigManager } from './rig'
import { releaseTrainManager } from './releasetrain'
import { broadcastEvent } from '../events'
import type { WorkerBee } from '../types'
import type { VsTerminalManager } from '../terminal/manager'

// Module-level terminal manager — set via setTerminalManager() during activation
let terminalManager: VsTerminalManager | null = null

export function setTerminalManager(tm: VsTerminalManager): void {
  terminalManager = tm
}

function getTerminalManager(): VsTerminalManager {
  if (!terminalManager) throw new Error('TerminalManager not initialized')
  return terminalManager
}

function getClaudeCommand(): string {
  const configured = vscode.workspace.getConfiguration('squansq').get<string>('claudeCommand', 'claude')
  if (configured !== 'claude') return configured

  // On Windows, look for claude.cmd
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

// WorkerBee name pool
const NAME_POOL = [
  'bee-alpha', 'bee-bravo', 'bee-charlie', 'bee-delta', 'bee-echo',
  'bee-foxtrot', 'bee-golf', 'bee-hotel', 'bee-india', 'bee-juliet',
  'bee-kilo', 'bee-lima', 'bee-mike', 'bee-november', 'bee-oscar',
]

// Signal patterns written to the instructions in CLAUDE.md
const DONE_RE      = /\bDONE:\s*(.{1,300})/i
const BLOCKED_RE   = /\bBLOCKED:\s*(.{1,300})/i
const LEARNINGS_RE = /LEARNINGS:\s*([\s\S]{10,800}?)(?:\n\n|\nDONE:|\nBLOCKED:|$)/i

export const workerBeeManager = {
  async spawn(projectId: string, taskDescription?: string, role: string = 'coder'): Promise<WorkerBee> {
    const tm = getTerminalManager()
    const db = getDb()
    const id = uuidv4()
    const name = await allocateName(projectId)
    const branch = `workerbee/${name}-${Date.now()}`

    const project = await rigManager.getById(projectId)
    const command = getClaudeCommand()

    // --- Git worktree isolation ---
    let worktreePath = project?.localPath ?? path.join(os.tmpdir(), 'squansq', projectId, name)
    let worktreesBase: string | undefined

    if (project?.localPath) {
      worktreesBase = path.resolve(project.localPath, '..', '.squansq-worktrees', projectId)
      const targetPath = path.join(worktreesBase, `${name}-${Date.now()}`)
      try {
        mkdirSync(worktreesBase, { recursive: true })
        execFileSync('git', ['-C', project.localPath, 'worktree', 'add', targetPath, '-b', branch], {
          stdio: 'pipe',
        })
        worktreePath = targetPath
        console.log(`[WorkerBee] Created worktree at ${worktreePath} on branch ${branch}`)
      } catch (err) {
        console.warn(`[WorkerBee] git worktree failed, falling back to project root: ${err}`)
        worktreePath = project.localPath
        try {
          execFileSync('git', ['-C', project.localPath, 'branch', branch], { stdio: 'pipe' })
        } catch {
          // Branch may already exist — safe to ignore
        }
      }
    }

    // --- CLAUDE.md task injection ---
    if (taskDescription) {
      try {
        const charter = await getCharter(projectId, role)
        writeFileSync(
          path.join(worktreePath, 'CLAUDE.md'),
          buildClaudeMd(name, taskDescription, role, charter),
          'utf8'
        )
        console.log(`[WorkerBee] Injected CLAUDE.md for ${name} (role: ${role})`)
      } catch (err) {
        console.warn(`[WorkerBee] Failed to write CLAUDE.md: ${err}`)
      }
    }

    // Create an isolated CLAUDE_CONFIG_DIR for this agent
    const agentConfigDir = path.join(
      worktreesBase ?? path.join(os.tmpdir(), 'squansq-configs'),
      `${name}-config`
    )
    mkdirSync(agentConfigDir, { recursive: true })

    // Seed credentials from ~/.claude/
    const homeClaudeDir = path.join(os.homedir(), '.claude')
    const configSrc = path.join(homeClaudeDir, 'config.json')
    if (existsSync(configSrc)) {
      try { copyFileSync(configSrc, path.join(agentConfigDir, 'config.json')) } catch { /* ignore */ }
    }

    // Copy statsig evaluations cache
    const statsigSrc = path.join(homeClaudeDir, 'statsig')
    if (existsSync(statsigSrc)) {
      try {
        const statsigDst = path.join(agentConfigDir, 'statsig')
        mkdirSync(statsigDst, { recursive: true })
        for (const f of readdirSync(statsigSrc)) {
          copyFileSync(path.join(statsigSrc, f), path.join(statsigDst, f))
        }
      } catch { /* ignore */ }
    }

    // Write minimal settings
    const agentSettings: Record<string, unknown> = {
      skipDangerousModePermissionPrompt: true,
      theme: 'dark',
    }
    writeFileSync(path.join(agentConfigDir, 'settings.json'), JSON.stringify(agentSettings), 'utf8')

    const workerEnv: Record<string, string> = {
      SQUANSQ_WORKERBEE: name,
      SQUANSQ_PROJECT: projectId,
      SQUANSQ_BRANCH: branch,
      SQUANSQ_WORKTREE: worktreePath,
      CLAUDE_CONFIG_DIR: agentConfigDir,
    }

    // Determine shell path for Windows vs unix
    const shellPath = process.platform === 'win32' ? command : undefined
    const shellArgs = ['--dangerously-skip-permissions']

    const sessionId = tm.spawn({
      name: `WorkerBee: ${name}`,
      shellPath: shellPath ?? command,
      shellArgs,
      cwd: worktreePath,
      env: workerEnv,
    })

    const now = new Date().toISOString()
    await db.execute({
      sql: `INSERT INTO workerbees (id, rig_id, name, branch, worktree_path, task_description, completion_note, role, status, hook_id, session_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, '', ?, 'idle', NULL, ?, ?, ?)`,
      args: [id, projectId, name, branch, worktreePath, taskDescription ?? '', role, sessionId, now, now],
    })

    // --- Completion signal monitor ---
    attachSignalMonitor(id, sessionId, taskDescription)

    // --- Auto-status on clean terminal exit ---
    tm.onSessionExit(sessionId, (exitCode) => {
      console.log(`[WorkerBee] ${name} terminal exited with code ${exitCode}`)
      if (exitCode === 0) {
        workerBeeManager.getById(id).then((bee) => {
          if (bee && (bee.status === 'working' || bee.status === 'idle')) {
            workerBeeManager.updateStatus(id, 'done').catch(() => {})
          }
        }).catch(() => {})
      }
    })

    const bee = await this.getById(id)

    broadcastEvent({
      id: uuidv4(),
      type: 'workerbee.spawned',
      payload: { workerBeeId: id, projectId, name, sessionId, branch, worktreePath, taskDescription: taskDescription ?? '' },
      timestamp: now,
    })

    return bee!
  },

  async getById(id: string): Promise<WorkerBee | null> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM workerbees WHERE id = ?', args: [id] })
    const row = result.rows[0]
    return row ? toModel(row as unknown as DbRow) : null
  },

  async listByProject(projectId: string): Promise<WorkerBee[]> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM workerbees WHERE rig_id = ?', args: [projectId] })
    return result.rows.map((r) => toModel(r as unknown as DbRow))
  },

  async listAll(): Promise<WorkerBee[]> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM workerbees', args: [] })
    return result.rows.map((r) => toModel(r as unknown as DbRow))
  },

  async updateStatus(id: string, status: WorkerBee['status'], note?: string): Promise<void> {
    const db = getDb()
    if (note !== undefined) {
      await db.execute({
        sql: `UPDATE workerbees SET status = ?, completion_note = ?, updated_at = datetime('now') WHERE id = ?`,
        args: [status, note, id],
      })
    } else {
      await db.execute({
        sql: `UPDATE workerbees SET status = ?, updated_at = datetime('now') WHERE id = ?`,
        args: [status, id],
      })
    }

    const eventType = status === 'done'
      ? 'workerbee.done'
      : status === 'stalled'
        ? 'workerbee.stalled'
        : 'workerbee.zombie'

    broadcastEvent({
      id: uuidv4(),
      type: eventType,
      payload: { workerBeeId: id, status, note: note ?? '' },
      timestamp: new Date().toISOString(),
    })

    // Auto-land the assigned release train when the WorkerBee completes
    if (status === 'done') {
      const rtResult = await db.execute({
        sql: `SELECT id FROM release_trains WHERE assigned_workerbee_id = ? AND status = 'in_progress'`,
        args: [id],
      })
      for (const row of rtResult.rows) {
        await releaseTrainManager.land(row.id as string).catch(() => {})
      }
    }

    // Notify the Root Agent so it knows to proceed without polling
    notifyRootAgent(id, status, note).catch(() => {})
  },

  async sendMessage(id: string, message: string): Promise<void> {
    const tm = getTerminalManager()
    const bee = await this.getById(id)
    if (bee?.sessionId) {
      tm.write(bee.sessionId, message + '\r')
    }
  },

  async nuke(id: string): Promise<void> {
    const db = getDb()
    const bee = await this.getById(id)
    const tm = getTerminalManager()

    if (bee?.sessionId) {
      tm.kill(bee.sessionId)
    }

    // Clean up git worktree if it was isolated
    if (bee) {
      const project = await rigManager.getById(bee.projectId)
      if (bee.worktreePath && project?.localPath && bee.worktreePath !== project.localPath) {
        try {
          execFileSync('git', ['-C', project.localPath, 'worktree', 'remove', '--force', bee.worktreePath], {
            stdio: 'pipe',
          })
          console.log(`[WorkerBee] Removed worktree ${bee.worktreePath}`)
        } catch (err) {
          console.warn(`[WorkerBee] Failed to remove worktree: ${err}`)
        }
      }
    }

    await db.execute({ sql: 'DELETE FROM workerbees WHERE id = ?', args: [id] })

    // Cancel any in_progress release train assigned to this bee
    const assignedRts = await db.execute({
      sql: `SELECT id FROM release_trains WHERE assigned_workerbee_id = ? AND status = 'in_progress'`,
      args: [id],
    })
    if (assignedRts.rows.length > 0) {
      await db.execute({
        sql: `UPDATE release_trains SET status = 'cancelled', assigned_workerbee_id = NULL, updated_at = datetime('now')
              WHERE assigned_workerbee_id = ? AND status = 'in_progress'`,
        args: [id],
      })
      for (const row of assignedRts.rows) {
        broadcastEvent({
          id: uuidv4(),
          type: 'releasetrain.cancelled',
          payload: { releaseTrainId: row.id as string },
          timestamp: new Date().toISOString(),
        })
      }
    }

    broadcastEvent({
      id: uuidv4(),
      type: 'workerbee.deleted',
      payload: { workerBeeId: id },
      timestamp: new Date().toISOString(),
    })
  },
}

// --- Root Agent notification ---
async function notifyRootAgent(workerBeeId: string, status: WorkerBee['status'], note?: string): Promise<void> {
  if (status !== 'done' && status !== 'stalled' && status !== 'zombie') return
  const db = getDb()
  const tm = terminalManager
  if (!tm) return

  const beeRow = await db.execute({ sql: `SELECT name, rig_id FROM workerbees WHERE id = ?`, args: [workerBeeId] })
  const bee = beeRow.rows[0] as unknown as { name: string; rig_id: string } | undefined
  if (!bee) return

  // Find the running Root Agent
  const mayorRow = await db.execute({
    sql: `SELECT session_id FROM mayors WHERE session_id IS NOT NULL`,
    args: [],
  })
  const sessionId = (mayorRow.rows[0] as unknown as { session_id: string } | undefined)?.session_id
  if (!sessionId || !tm.list().includes(sessionId)) return

  const label = status === 'done' ? 'completed' : status === 'stalled' ? 'is blocked' : 'has crashed'
  const summary = note ? ` — ${note.slice(0, 150)}` : ''
  const msg = `\n[Squansq] Agent ${bee.name} ${label}${summary}. Call get_status_summary to review and decide next steps.\n`

  tm.write(sessionId, msg)
  console.log(`[WorkerBee] Notified Root Agent of ${bee.name} -> ${status}`)
}

// --- Completion signal monitor ---
function attachSignalMonitor(workerBeeId: string, sessionId: string, taskDescription?: string): void {
  const tm = getTerminalManager()
  const monitorId = `monitor-${workerBeeId}`
  let tail = ''
  let fired = false
  let markedWorking = false
  let kicked = false
  let apiKeyAnswered = false
  let themeAnswered = false
  let loginAnswered = false

  tm.subscribe(sessionId, monitorId, (data) => {
    if (fired) return
    tail = (tail + data).slice(-3000)

    // Auto-answer login method selection
    if (!loginAnswered && (
      tail.includes('Select login method') ||
      tail.includes('login method')
    )) {
      loginAnswered = true
      tail = ''
      setTimeout(() => {
        tm.write(sessionId, '\x1b[B') // down arrow
        setTimeout(() => tm.write(sessionId, '\r'), 150)
      }, 500)
    }

    // Auto-answer theme/onboarding prompt
    if (!themeAnswered && (
      tail.includes('Dark mode') ||
      tail.includes('dark mode') ||
      tail.includes('color theme') ||
      tail.includes('Color theme') ||
      tail.includes('Choose a theme') ||
      tail.includes('color scheme') ||
      tail.includes('Color scheme')
    )) {
      themeAnswered = true
      tail = ''
      setTimeout(() => {
        tm.write(sessionId, '\r')
        console.log(`[WorkerBee] ${workerBeeId} auto-answered theme prompt`)
      }, 300)
    }

    // Auto-answer API key confirmation
    if (!apiKeyAnswered && tail.includes('Do you want to use this API key')) {
      apiKeyAnswered = true
      tail = ''
      setTimeout(() => {
        tm.write(sessionId, '1\r')
        console.log(`[WorkerBee] ${workerBeeId} accepted API key prompt`)
      }, 300)
    }

    // Detect Claude's ready prompt (❯) and send kickoff message
    if (!kicked && tail.includes('\u276f')) {
      kicked = true
      setTimeout(() => {
        const kickoff = taskDescription?.trim()
          ? taskDescription.trim()
          : 'Please begin your assigned task as described in CLAUDE.md'
        tm.write(sessionId, kickoff + '\r')
        console.log(`[WorkerBee] ${workerBeeId} kickoff message sent`)
      }, 500)
    }

    // Transition idle -> working after kickoff
    if (!markedWorking && kicked && data.length > 0) {
      markedWorking = true
      workerBeeManager.getById(workerBeeId).then((bee) => {
        if (bee?.status === 'idle') {
          getDb().execute({
            sql: `UPDATE workerbees SET status = 'working', updated_at = datetime('now') WHERE id = ?`,
            args: [workerBeeId],
          }).then(() => {
            broadcastEvent({
              id: uuidv4(),
              type: 'workerbee.working',
              payload: { workerBeeId },
              timestamp: new Date().toISOString(),
            })
          }).catch(() => {})
        }
      }).catch(() => {})
    }

    // Capture LEARNINGS before marking done
    const learningsMatch = tail.match(LEARNINGS_RE)
    if (learningsMatch) {
      const learnings = learningsMatch[1].trim()
      workerBeeManager.getById(workerBeeId).then(async (bee) => {
        if (bee) await saveChapterLearnings(bee.projectId, bee.role ?? 'coder', learnings)
      }).catch(() => {})
    }

    const doneMatch = tail.match(DONE_RE)
    if (doneMatch) {
      fired = true
      const note = doneMatch[1].trim().replace(/\n.*/s, '').slice(0, 200)
      tm.unsubscribe(sessionId, monitorId)
      console.log(`[WorkerBee] ${workerBeeId} signalled DONE: ${note}`)
      workerBeeManager.updateStatus(workerBeeId, 'done', note).catch(() => {})
      return
    }

    const blockedMatch = tail.match(BLOCKED_RE)
    if (blockedMatch) {
      fired = true
      const note = blockedMatch[1].trim().replace(/\n.*/s, '').slice(0, 200)
      tm.unsubscribe(sessionId, monitorId)
      console.log(`[WorkerBee] ${workerBeeId} signalled BLOCKED: ${note}`)
      workerBeeManager.updateStatus(workerBeeId, 'stalled', note).catch(() => {})
    }
  })

  // When terminal exits with error, save last output as zombie note
  tm.onSessionExit(sessionId, (exitCode) => {
    if (fired || exitCode === 0) return
    fired = true
    tm.unsubscribe(sessionId, monitorId)
    const plain = tail.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim()
    const note = plain.slice(-400) || `exited with code ${exitCode}`
    console.log(`[WorkerBee] ${workerBeeId} zombie note: ${note.slice(0, 120)}`)
    workerBeeManager.updateStatus(workerBeeId, 'zombie', note).catch(() => {})
  })
}

async function allocateName(projectId: string): Promise<string> {
  const db = getDb()
  const result = await db.execute({ sql: 'SELECT name FROM workerbees WHERE rig_id = ?', args: [projectId] })
  const used = new Set(result.rows.map((r) => r.name as string))
  return NAME_POOL.find((n) => !used.has(n)) ?? `bee-${Date.now()}`
}

function buildClaudeMd(name: string, task: string, role: string = 'coder', charter?: string): string {
  const roleGuide: Record<string, string> = {
    coder:    'You are a **coder** agent. Focus on implementing features, fixing bugs, and writing clean code.',
    tester:   'You are a **tester** agent. Focus on writing tests, identifying edge cases, and ensuring correctness.',
    reviewer: 'You are a **reviewer** agent. Focus on code quality, security, and design issues. Suggest concrete improvements.',
    devops:   'You are a **devops** agent. Focus on CI/CD, infrastructure, deployment scripts, and reliability.',
    lead:     'You are a **lead** agent. Focus on architecture decisions, coordinating sub-tasks, and ensuring consistency.',
  }
  const roleDesc = roleGuide[role] ?? `You are a **${role}** agent.`

  const charterSection = charter
    ? `\n## Prior Knowledge (Charter)\n\nYour accumulated knowledge from previous sessions on this project:\n\n${charter}\n`
    : ''

  return `# Agent: ${name} (${role})

## Role

${roleDesc}

## Your Task

${task}
${charterSection}
## Instructions

- Complete the task described above
- Make commits as you work with clear commit messages
- Log important decisions to \`DECISIONS.md\` in the project root (format: \`## [YYYY-MM-DD] Title\\n<rationale>\`)
- Before finishing, summarize key learnings as:
  **LEARNINGS:**
  <bullet points of what you discovered — conventions, gotchas, architecture details>
- When done, output: **DONE: <brief summary of what was completed>**
- If blocked, output: **BLOCKED: <what is preventing progress>**
`
}

async function getCharter(projectId: string, role: string): Promise<string | undefined> {
  try {
    const db = getDb()
    const result = await db.execute({
      sql: 'SELECT content FROM charters WHERE project_id = ? AND role = ?',
      args: [projectId, role],
    })
    return result.rows[0]?.content as string | undefined
  } catch { return undefined }
}

async function saveChapterLearnings(projectId: string, role: string, learnings: string): Promise<void> {
  try {
    const db = getDb()
    const existing = await db.execute({
      sql: 'SELECT id, content FROM charters WHERE project_id = ? AND role = ?',
      args: [projectId, role],
    })
    if (existing.rows.length > 0) {
      const prev = (existing.rows[0].content as string) ?? ''
      const combined = `${prev}\n\n---\n${new Date().toISOString().slice(0, 10)}\n${learnings}`.slice(-4000)
      await db.execute({
        sql: `UPDATE charters SET content = ?, updated_at = datetime('now') WHERE project_id = ? AND role = ?`,
        args: [combined, projectId, role],
      })
    } else {
      await db.execute({
        sql: `INSERT INTO charters (id, project_id, role, content) VALUES (?, ?, ?, ?)`,
        args: [uuidv4(), projectId, role, learnings],
      })
    }
    console.log(`[Charter] Saved learnings for ${role} on project ${projectId}`)
  } catch (err) {
    console.warn(`[Charter] Failed to save learnings: ${err}`)
  }
}

export const charterManager = {
  async get(projectId: string, role: string) {
    const db = getDb()
    const result = await db.execute({
      sql: 'SELECT * FROM charters WHERE project_id = ? AND role = ?',
      args: [projectId, role],
    })
    return result.rows[0] ?? null
  },
  async list(projectId: string) {
    const db = getDb()
    const result = await db.execute({
      sql: 'SELECT * FROM charters WHERE project_id = ?',
      args: [projectId],
    })
    return result.rows
  },
  async upsert(projectId: string, role: string, content: string) {
    const db = getDb()
    const existing = await db.execute({
      sql: 'SELECT id FROM charters WHERE project_id = ? AND role = ?',
      args: [projectId, role],
    })
    if (existing.rows.length > 0) {
      await db.execute({
        sql: `UPDATE charters SET content = ?, updated_at = datetime('now') WHERE project_id = ? AND role = ?`,
        args: [content, projectId, role],
      })
    } else {
      await db.execute({
        sql: `INSERT INTO charters (id, project_id, role, content) VALUES (?, ?, ?, ?)`,
        args: [uuidv4(), projectId, role, content],
      })
    }
    return this.get(projectId, role)
  },
}

export const routingManager = {
  async list(projectId: string) {
    const db = getDb()
    const result = await db.execute({
      sql: 'SELECT * FROM routing_rules WHERE project_id = ? ORDER BY created_at',
      args: [projectId],
    })
    return result.rows
  },
  async set(projectId: string, pattern: string, role: string) {
    const db = getDb()
    const existing = await db.execute({
      sql: 'SELECT id FROM routing_rules WHERE project_id = ? AND pattern = ?',
      args: [projectId, pattern],
    })
    if (existing.rows.length > 0) {
      await db.execute({
        sql: 'UPDATE routing_rules SET role = ? WHERE project_id = ? AND pattern = ?',
        args: [role, projectId, pattern],
      })
    } else {
      await db.execute({
        sql: 'INSERT INTO routing_rules (id, project_id, pattern, role) VALUES (?, ?, ?, ?)',
        args: [uuidv4(), projectId, pattern, role],
      })
    }
    return this.list(projectId)
  },
  async delete(id: string) {
    const db = getDb()
    await db.execute({ sql: 'DELETE FROM routing_rules WHERE id = ?', args: [id] })
  },
  suggest(task: string, rules: Array<{ pattern: string; role: string }>): string {
    const lower = task.toLowerCase()
    for (const rule of rules) {
      if (lower.includes(rule.pattern.toLowerCase())) return rule.role
    }
    if (/test|spec|coverage|jest|vitest|cypress/.test(lower)) return 'tester'
    if (/review|audit|security|quality|refactor/.test(lower)) return 'reviewer'
    if (/deploy|docker|ci|cd|pipeline|infra|nginx/.test(lower)) return 'devops'
    if (/architect|design|plan|coordinate|structure/.test(lower)) return 'lead'
    return 'coder'
  },
}

interface DbRow {
  id: string
  rig_id: string
  name: string
  branch: string
  worktree_path: string
  task_description: string
  completion_note: string
  role: string
  status: WorkerBee['status']
  hook_id: string | null
  session_id: string | null
  created_at: string
  updated_at: string
}

function toModel(r: DbRow): WorkerBee {
  return {
    id: r.id,
    projectId: r.rig_id,
    name: r.name,
    branch: r.branch,
    worktreePath: r.worktree_path,
    taskDescription: r.task_description ?? '',
    completionNote: r.completion_note ?? '',
    role: r.role ?? 'coder',
    status: r.status,
    hookId: r.hook_id,
    sessionId: r.session_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}
