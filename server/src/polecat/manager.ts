import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { ptyManager } from './pty.js'
import { rigManager } from '../rig/manager.js'
import { broadcastEvent } from '../ws/server.js'
import type { WorkerBee } from '../types/index.js'

// WorkerBee name pool — themed names for your worker agents
const NAME_POOL = [
  'bee-alpha', 'bee-bravo', 'bee-charlie', 'bee-delta', 'bee-echo',
  'bee-foxtrot', 'bee-golf', 'bee-hotel', 'bee-india', 'bee-juliet',
  'bee-kilo', 'bee-lima', 'bee-mike', 'bee-november', 'bee-oscar',
]

// workerBeeManager — manages WorkerBee (formerly Polecat) lifecycle
export const workerBeeManager = {
  async spawn(projectId: string, _beadId?: string): Promise<WorkerBee> {
    const db = getDb()
    const id = uuidv4()
    const name = await allocateName(projectId)
    const branch = `workerbee/${name}-${Date.now()}`

    const project = await rigManager.getById(projectId)
    const worktreePath = project?.localPath ?? `/tmp/squansq/${projectId}/${name}`
    const command = project?.runtime.command ?? 'bash'

    const sessionId = ptyManager.spawn({
      shell: command,
      cwd: worktreePath,
      env: {
        SQUANSQ_WORKERBEE: name,
        SQUANSQ_PROJECT: projectId,
      },
    })

    const now = new Date().toISOString()
    await db.execute({
      sql: `INSERT INTO polecats (id, rig_id, name, branch, worktree_path, status, hook_id, session_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'idle', NULL, ?, ?, ?)`,
      args: [id, projectId, name, branch, worktreePath, sessionId, now, now],
    })

    const bee = await this.getById(id)

    broadcastEvent({
      id: uuidv4(),
      type: 'workerbee.spawned',
      payload: { workerBeeId: id, projectId, name, sessionId },
      timestamp: now,
    })

    return bee!
  },

  async getById(id: string): Promise<WorkerBee | null> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM polecats WHERE id = ?', args: [id] })
    const row = result.rows[0]
    return row ? toModel(row as unknown as DbRow) : null
  },

  async listByProject(projectId: string): Promise<WorkerBee[]> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM polecats WHERE rig_id = ?', args: [projectId] })
    return result.rows.map((r) => toModel(r as unknown as DbRow))
  },

  async listAll(): Promise<WorkerBee[]> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM polecats', args: [] })
    return result.rows.map((r) => toModel(r as unknown as DbRow))
  },

  async updateStatus(id: string, status: WorkerBee['status']) {
    const db = getDb()
    await db.execute({
      sql: `UPDATE polecats SET status = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [status, id],
    })
    broadcastEvent({
      id: uuidv4(),
      type: status === 'done' ? 'workerbee.done' : status === 'stalled' ? 'workerbee.stalled' : 'workerbee.zombie',
      payload: { workerBeeId: id, status },
      timestamp: new Date().toISOString(),
    })
  },

  async nuke(id: string) {
    const db = getDb()
    const bee = await this.getById(id)
    if (bee?.sessionId) {
      ptyManager.kill(bee.sessionId)
    }
    await db.execute({ sql: 'DELETE FROM polecats WHERE id = ?', args: [id] })
  },
}

// Keep old export name for backwards compat with routes
export const polecatManager = workerBeeManager

async function allocateName(projectId: string): Promise<string> {
  const db = getDb()
  const result = await db.execute({ sql: 'SELECT name FROM polecats WHERE rig_id = ?', args: [projectId] })
  const used = new Set(result.rows.map((r) => r.name as string))
  return NAME_POOL.find((n) => !used.has(n)) ?? `bee-${Date.now()}`
}

interface DbRow {
  id: string
  rig_id: string
  name: string
  branch: string
  worktree_path: string
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
    status: r.status,
    hookId: r.hook_id,
    sessionId: r.session_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}
