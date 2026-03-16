import { execFileSync } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { ptyManager } from './pty.js'
import { rigManager } from '../rig/manager.js'
import { releaseTrainManager } from '../releasetrain/manager.js'
import { broadcastEvent } from '../ws/server.js'
import type { WorkerBee } from '../types/index.js'

// WorkerBee name pool
const NAME_POOL = [
  'bee-alpha', 'bee-bravo', 'bee-charlie', 'bee-delta', 'bee-echo',
  'bee-foxtrot', 'bee-golf', 'bee-hotel', 'bee-india', 'bee-juliet',
  'bee-kilo', 'bee-lima', 'bee-mike', 'bee-november', 'bee-oscar',
]

// Signal patterns written to the instructions in CLAUDE.md
const DONE_RE    = /\bDONE:\s*(.{1,300})/i
const BLOCKED_RE = /\bBLOCKED:\s*(.{1,300})/i

export const workerBeeManager = {
  async spawn(projectId: string, taskDescription?: string, userId?: string): Promise<WorkerBee> {
    const db = getDb()
    const id = uuidv4()
    const name = await allocateName(projectId)
    const branch = `workerbee/${name}-${Date.now()}`

    const project = await rigManager.getById(projectId)
    const command = project?.runtime.command ?? 'bash'

    // --- Git worktree isolation ---
    let worktreePath = project?.localPath ?? `/tmp/squansq/${projectId}/${name}`

    if (project?.localPath) {
      const worktreesBase = path.resolve(project.localPath, '..', '.squansq-worktrees', projectId)
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
      }
    }

    // --- CLAUDE.md task injection ---
    if (taskDescription) {
      try {
        writeFileSync(
          path.join(worktreePath, 'CLAUDE.md'),
          buildClaudeMd(name, taskDescription),
          'utf8'
        )
        console.log(`[WorkerBee] Injected CLAUDE.md for ${name}`)
      } catch (err) {
        console.warn(`[WorkerBee] Failed to write CLAUDE.md: ${err}`)
      }
    }

    const sessionId = ptyManager.spawn({
      shell: command,
      args: ['--dangerously-skip-permissions'],
      cwd: worktreePath,
      env: {
        SQUANSQ_WORKERBEE: name,
        SQUANSQ_PROJECT: projectId,
        SQUANSQ_BRANCH: branch,
        SQUANSQ_WORKTREE: worktreePath,
      },
      ownerUserId: userId,
    })

    const now = new Date().toISOString()
    await db.execute({
      sql: `INSERT INTO workerbees (id, rig_id, name, branch, worktree_path, task_description, completion_note, status, hook_id, session_id, user_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, '', 'idle', NULL, ?, ?, ?, ?)`,
      args: [id, projectId, name, branch, worktreePath, taskDescription ?? '', sessionId, userId ?? null, now, now],
    })

    // --- Completion signal monitor ---
    attachSignalMonitor(id, sessionId)

    // --- Auto-status on PTY exit ---
    ptyManager.onSessionExit(sessionId, (exitCode) => {
      console.log(`[WorkerBee] ${name} PTY exited with code ${exitCode}`)
      this.getById(id).then((bee) => {
        if (bee && (bee.status === 'working' || bee.status === 'idle')) {
          // Clean exit → done, non-zero → zombie (witness may also catch this)
          this.updateStatus(id, exitCode === 0 ? 'done' : 'zombie').catch(() => {})
        }
      }).catch(() => {})
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

  async listByProject(projectId: string, userId?: string): Promise<WorkerBee[]> {
    const db = getDb()
    if (userId) {
      const result = await db.execute({
        sql: 'SELECT * FROM workerbees WHERE rig_id = ? AND (user_id = ? OR user_id IS NULL)',
        args: [projectId, userId],
      })
      return result.rows.map((r) => toModel(r as unknown as DbRow))
    }
    const result = await db.execute({ sql: 'SELECT * FROM workerbees WHERE rig_id = ?', args: [projectId] })
    return result.rows.map((r) => toModel(r as unknown as DbRow))
  },

  async listAll(userId?: string): Promise<WorkerBee[]> {
    const db = getDb()
    if (userId) {
      const result = await db.execute({
        sql: 'SELECT * FROM workerbees WHERE user_id = ? OR user_id IS NULL',
        args: [userId],
      })
      return result.rows.map((r) => toModel(r as unknown as DbRow))
    }
    const result = await db.execute({ sql: 'SELECT * FROM workerbees', args: [] })
    return result.rows.map((r) => toModel(r as unknown as DbRow))
  },

  async updateStatus(id: string, status: WorkerBee['status'], note?: string) {
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
    broadcastEvent({
      id: uuidv4(),
      type: status === 'done' ? 'workerbee.done' : status === 'stalled' ? 'workerbee.stalled' : 'workerbee.zombie',
      payload: { workerBeeId: id, status, note: note ?? '' },
      timestamp: new Date().toISOString(),
    })

    // Auto-land the assigned release train when the WorkerBee completes
    if (status === 'done') {
      const db = getDb()
      const rtResult = await db.execute({
        sql: `SELECT id FROM release_trains WHERE assigned_workerbee_id = ? AND status = 'in_progress'`,
        args: [id],
      })
      for (const row of rtResult.rows) {
        await releaseTrainManager.land(row.id as string).catch(() => {})
      }
    }
  },

  async sendMessage(id: string, message: string, userId?: string) {
    const bee = await this.getById(id)
    if (userId && bee?.userId && bee.userId !== userId) throw new Error('Forbidden')
    if (bee?.sessionId) {
      ptyManager.write(bee.sessionId, message + '\r')
    }
  },

  async nuke(id: string, userId?: string) {
    const db = getDb()
    const bee = await this.getById(id)
    if (userId && bee?.userId && bee.userId !== userId) throw new Error('Forbidden')
    if (bee?.sessionId) {
      ptyManager.kill(bee.sessionId)
    }
    // Clean up git worktree if it was isolated
    const project = await rigManager.getById(bee?.projectId ?? '')
    if (bee?.worktreePath && project?.localPath && bee.worktreePath !== project.localPath) {
      try {
        execFileSync('git', ['-C', project.localPath, 'worktree', 'remove', '--force', bee.worktreePath], {
          stdio: 'pipe',
        })
        console.log(`[WorkerBee] Removed worktree ${bee.worktreePath}`)
      } catch (err) {
        console.warn(`[WorkerBee] Failed to remove worktree: ${err}`)
      }
    }
    await db.execute({ sql: 'DELETE FROM workerbees WHERE id = ?', args: [id] })
    broadcastEvent({
      id: uuidv4(),
      type: 'workerbee.deleted',
      payload: { workerBeeId: id },
      timestamp: new Date().toISOString(),
    })
  },
}

// --- Completion signal monitor ---
function attachSignalMonitor(workerBeeId: string, sessionId: string) {
  const monitorId = `monitor-${workerBeeId}`
  let tail = ''
  let fired = false
  let markedWorking = false

  ptyManager.subscribe(sessionId, monitorId, (data) => {
    if (fired) return
    tail = (tail + data).slice(-3000)

    // First real output → transition idle → working
    if (!markedWorking && data.trim().length > 0) {
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

    const doneMatch = tail.match(DONE_RE)
    if (doneMatch) {
      fired = true
      const note = doneMatch[1].trim().replace(/\n.*/s, '').slice(0, 200)
      ptyManager.unsubscribe(sessionId, monitorId)
      console.log(`[WorkerBee] ${workerBeeId} signalled DONE: ${note}`)
      workerBeeManager.updateStatus(workerBeeId, 'done', note).catch(() => {})
      return
    }

    const blockedMatch = tail.match(BLOCKED_RE)
    if (blockedMatch) {
      fired = true
      const note = blockedMatch[1].trim().replace(/\n.*/s, '').slice(0, 200)
      ptyManager.unsubscribe(sessionId, monitorId)
      console.log(`[WorkerBee] ${workerBeeId} signalled BLOCKED: ${note}`)
      workerBeeManager.updateStatus(workerBeeId, 'stalled', note).catch(() => {})
    }
  })
}

async function allocateName(projectId: string): Promise<string> {
  const db = getDb()
  const result = await db.execute({ sql: 'SELECT name FROM workerbees WHERE rig_id = ?', args: [projectId] })
  const used = new Set(result.rows.map((r) => r.name as string))
  return NAME_POOL.find((n) => !used.has(n)) ?? `bee-${Date.now()}`
}

function buildClaudeMd(name: string, task: string): string {
  return `# WorkerBee: ${name}

## Your Task

${task}

## Instructions

- Complete the task described above
- Make commits as you work with clear commit messages
- When done, output: **DONE: <brief summary of what was completed>**
- If blocked, output: **BLOCKED: <what is preventing progress>**
`
}

interface DbRow {
  id: string
  rig_id: string
  name: string
  branch: string
  worktree_path: string
  task_description: string
  completion_note: string
  status: WorkerBee['status']
  hook_id: string | null
  session_id: string | null
  user_id: string | null
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
    status: r.status,
    hookId: r.hook_id,
    sessionId: r.session_id,
    userId: r.user_id ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}
