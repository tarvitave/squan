import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { broadcastEvent } from '../ws/server.js'
import type { Hook } from '../types/index.js'

export const hookManager = {
  async create(
    projectId: string,
    branch: string,
    notes?: string,
    workerBeeId?: string,
    atomicTaskId?: string
  ): Promise<Hook> {
    const db = getDb()
    const id = uuidv4()
    const now = new Date().toISOString()

    await db.execute({
      sql: `INSERT INTO hooks (id, rig_id, workerbee_id, atomic_task_id, status, branch, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'created', ?, ?, ?, ?)`,
      args: [id, projectId, workerBeeId ?? null, atomicTaskId ?? null, branch, notes ?? '', now, now],
    })

    broadcastEvent({
      id: uuidv4(),
      type: 'hook.created',
      payload: { hookId: id, projectId, branch, workerBeeId: workerBeeId ?? null },
      timestamp: now,
    })

    return (await this.getById(id))!
  },

  async getById(id: string): Promise<Hook | null> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM hooks WHERE id = ?', args: [id] })
    const row = result.rows[0] as unknown as DbHook | undefined
    return row ? toModel(row) : null
  },

  async listByProject(projectId: string): Promise<Hook[]> {
    const db = getDb()
    const result = await db.execute({
      sql: 'SELECT * FROM hooks WHERE rig_id = ? ORDER BY created_at DESC',
      args: [projectId],
    })
    return result.rows.map((r) => toModel(r as unknown as DbHook))
  },

  async listAll(): Promise<Hook[]> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM hooks ORDER BY created_at DESC', args: [] })
    return result.rows.map((r) => toModel(r as unknown as DbHook))
  },

  async activate(id: string): Promise<void> {
    const db = getDb()
    await db.execute({
      sql: `UPDATE hooks SET status = 'active', updated_at = datetime('now') WHERE id = ?`,
      args: [id],
    })
    broadcastEvent({
      id: uuidv4(),
      type: 'hook.activated',
      payload: { hookId: id },
      timestamp: new Date().toISOString(),
    })
  },

  async suspend(id: string): Promise<void> {
    const db = getDb()
    await db.execute({
      sql: `UPDATE hooks SET status = 'suspended', updated_at = datetime('now') WHERE id = ?`,
      args: [id],
    })
  },

  async complete(id: string): Promise<void> {
    const db = getDb()
    await db.execute({
      sql: `UPDATE hooks SET status = 'completed', updated_at = datetime('now') WHERE id = ?`,
      args: [id],
    })
    broadcastEvent({
      id: uuidv4(),
      type: 'hook.completed',
      payload: { hookId: id },
      timestamp: new Date().toISOString(),
    })
  },

  async archive(id: string): Promise<void> {
    const db = getDb()
    await db.execute({
      sql: `UPDATE hooks SET status = 'archived', updated_at = datetime('now') WHERE id = ?`,
      args: [id],
    })
  },

  async remove(id: string): Promise<void> {
    const db = getDb()
    await db.execute({ sql: 'DELETE FROM hooks WHERE id = ?', args: [id] })
  },
}

interface DbHook {
  id: string
  rig_id: string
  workerbee_id: string | null
  atomic_task_id: string | null
  status: Hook['status']
  branch: string
  notes: string
  created_at: string
  updated_at: string
}

function toModel(r: DbHook): Hook {
  return {
    id: r.id,
    projectId: r.rig_id,
    workerBeeId: r.workerbee_id,
    atomicTaskId: r.atomic_task_id,
    status: r.status,
    branch: r.branch,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}
