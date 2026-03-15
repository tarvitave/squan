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
    atomicTaskId?: string,
    userId?: string
  ): Promise<Hook> {
    const db = getDb()
    const id = uuidv4()
    const now = new Date().toISOString()

    await db.execute({
      sql: `INSERT INTO hooks (id, rig_id, workerbee_id, atomic_task_id, status, branch, notes, user_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'created', ?, ?, ?, ?, ?)`,
      args: [id, projectId, workerBeeId ?? null, atomicTaskId ?? null, branch, notes ?? '', userId ?? null, now, now],
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

  async listByProject(projectId: string, userId?: string): Promise<Hook[]> {
    const db = getDb()
    if (userId) {
      const result = await db.execute({
        sql: 'SELECT * FROM hooks WHERE rig_id = ? AND (user_id = ? OR user_id IS NULL) ORDER BY created_at DESC',
        args: [projectId, userId],
      })
      return result.rows.map((r) => toModel(r as unknown as DbHook))
    }
    const result = await db.execute({
      sql: 'SELECT * FROM hooks WHERE rig_id = ? ORDER BY created_at DESC',
      args: [projectId],
    })
    return result.rows.map((r) => toModel(r as unknown as DbHook))
  },

  async listAll(userId?: string): Promise<Hook[]> {
    const db = getDb()
    if (userId) {
      const result = await db.execute({
        sql: 'SELECT * FROM hooks WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC',
        args: [userId],
      })
      return result.rows.map((r) => toModel(r as unknown as DbHook))
    }
    const result = await db.execute({ sql: 'SELECT * FROM hooks ORDER BY created_at DESC', args: [] })
    return result.rows.map((r) => toModel(r as unknown as DbHook))
  },

  async activate(id: string, userId?: string): Promise<void> {
    if (userId) {
      const hook = await this.getById(id)
      if (hook && hook.userId && hook.userId !== userId) throw new Error('Forbidden')
    }
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

  async suspend(id: string, userId?: string): Promise<void> {
    if (userId) {
      const hook = await this.getById(id)
      if (hook && hook.userId && hook.userId !== userId) throw new Error('Forbidden')
    }
    const db = getDb()
    await db.execute({
      sql: `UPDATE hooks SET status = 'suspended', updated_at = datetime('now') WHERE id = ?`,
      args: [id],
    })
  },

  async complete(id: string, userId?: string): Promise<void> {
    if (userId) {
      const hook = await this.getById(id)
      if (hook && hook.userId && hook.userId !== userId) throw new Error('Forbidden')
    }
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

  async archive(id: string, userId?: string): Promise<void> {
    if (userId) {
      const hook = await this.getById(id)
      if (hook && hook.userId && hook.userId !== userId) throw new Error('Forbidden')
    }
    const db = getDb()
    await db.execute({
      sql: `UPDATE hooks SET status = 'archived', updated_at = datetime('now') WHERE id = ?`,
      args: [id],
    })
  },

  async remove(id: string, userId?: string): Promise<void> {
    if (userId) {
      const hook = await this.getById(id)
      if (hook && hook.userId && hook.userId !== userId) throw new Error('Forbidden')
    }
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
  user_id: string | null
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
    userId: r.user_id ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}
