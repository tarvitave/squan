import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { ptyManager } from './pty.js'
import { rigManager } from '../rig/manager.js'
import { broadcastEvent } from '../ws/server.js'
import type { Polecat } from '../types/index.js'

const NAME_POOL = [
  'alpha', 'bravo', 'charlie', 'delta', 'echo',
  'foxtrot', 'golf', 'hotel', 'india', 'juliet',
  'kilo', 'lima', 'mike', 'november', 'oscar',
]

export const polecatManager = {
  async spawn(rigId: string, _beadId?: string): Promise<Polecat> {
    const db = getDb()
    const id = uuidv4()
    const name = await allocateName(rigId)
    const branch = `polecat/${name}-${Date.now()}`

    // Look up rig to get the repo path and runtime command
    const rig = await rigManager.getById(rigId)
    const worktreePath = rig?.localPath ?? `/tmp/squansq/${rigId}/${name}`
    const command = rig?.runtime.command ?? 'bash'

    const sessionId = ptyManager.spawn({
      shell: command,
      cwd: worktreePath,
      env: {
        SQUANSQ_POLECAT: name,
        SQUANSQ_RIG: rigId,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
      },
    })

    const now = new Date().toISOString()
    await db.execute({
      sql: `INSERT INTO polecats (id, rig_id, name, branch, worktree_path, status, hook_id, session_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'idle', NULL, ?, ?, ?)`,
      args: [id, rigId, name, branch, worktreePath, sessionId, now, now],
    })

    const polecat = await this.getById(id)

    broadcastEvent({
      id: uuidv4(),
      type: 'polecat.spawned',
      payload: { polecatId: id, rigId, name, sessionId },
      timestamp: now,
    })

    return polecat!
  },

  async getById(id: string): Promise<Polecat | null> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM polecats WHERE id = ?', args: [id] })
    const row = result.rows[0]
    return row ? toModel(row as unknown as DbPolecat) : null
  },

  async listByRig(rigId: string): Promise<Polecat[]> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM polecats WHERE rig_id = ?', args: [rigId] })
    return result.rows.map((r) => toModel(r as unknown as DbPolecat))
  },

  async listAll(): Promise<Polecat[]> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM polecats', args: [] })
    return result.rows.map((r) => toModel(r as unknown as DbPolecat))
  },

  async updateStatus(id: string, status: Polecat['status']) {
    const db = getDb()
    await db.execute({
      sql: `UPDATE polecats SET status = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [status, id],
    })
    broadcastEvent({
      id: uuidv4(),
      type: status === 'done' ? 'polecat.done' : status === 'stalled' ? 'polecat.stalled' : 'polecat.zombie',
      payload: { polecatId: id, status },
      timestamp: new Date().toISOString(),
    })
  },

  async nuke(id: string) {
    const db = getDb()
    const polecat = await this.getById(id)
    if (polecat?.sessionId) {
      ptyManager.kill(polecat.sessionId)
    }
    await db.execute({ sql: 'DELETE FROM polecats WHERE id = ?', args: [id] })
  },
}

async function allocateName(rigId: string): Promise<string> {
  const db = getDb()
  const result = await db.execute({ sql: 'SELECT name FROM polecats WHERE rig_id = ?', args: [rigId] })
  const used = new Set(result.rows.map((r) => r.name as string))
  return NAME_POOL.find((n) => !used.has(n)) ?? `polecat-${Date.now()}`
}

interface DbPolecat {
  id: string
  rig_id: string
  name: string
  branch: string
  worktree_path: string
  status: Polecat['status']
  hook_id: string | null
  session_id: string | null
  created_at: string
  updated_at: string
}

function toModel(r: DbPolecat): Polecat {
  return {
    id: r.id,
    rigId: r.rig_id,
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
