import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { broadcastEvent } from '../ws/server.js'
import type { ReleaseTrain } from '../types/index.js'

export const releaseTrainManager = {
  async create(name: string, rigId: string, atomicTaskIds: string[] = [], description?: string, userId?: string, manual?: boolean): Promise<ReleaseTrain> {
    const db = getDb()
    const id = uuidv4()
    const now = new Date().toISOString()

    await db.execute({
      sql: `INSERT INTO release_trains (id, name, rig_id, atomic_task_ids_json, description, status, user_id, manual, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      args: [id, name, rigId, JSON.stringify(atomicTaskIds), description ?? '', userId ?? null, manual ? 1 : 0, now, now],
    })

    broadcastEvent({
      id: uuidv4(),
      type: 'releasetrain.created',
      payload: { releaseTrainId: id, name, rigId, atomicTaskIds, description: description ?? '', manual: manual ?? false },
      timestamp: now,
    })

    return (await this.getById(id))!
  },

  async getById(id: string): Promise<ReleaseTrain | null> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM release_trains WHERE id = ?', args: [id] })
    const row = result.rows[0] as unknown as DbReleaseTrain | undefined
    return row ? toModel(row) : null
  },

  async listByRig(rigId: string, userId?: string): Promise<ReleaseTrain[]> {
    const db = getDb()
    if (userId) {
      const result = await db.execute({
        sql: 'SELECT * FROM release_trains WHERE rig_id = ? AND (user_id = ? OR user_id IS NULL) ORDER BY created_at DESC',
        args: [rigId, userId],
      })
      return result.rows.map((r) => toModel(r as unknown as DbReleaseTrain))
    }
    const result = await db.execute({
      sql: 'SELECT * FROM release_trains WHERE rig_id = ? ORDER BY created_at DESC',
      args: [rigId],
    })
    return result.rows.map((r) => toModel(r as unknown as DbReleaseTrain))
  },

  async listAll(userId?: string): Promise<ReleaseTrain[]> {
    const db = getDb()
    if (userId) {
      const result = await db.execute({
        sql: 'SELECT * FROM release_trains WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC',
        args: [userId],
      })
      return result.rows.map((r) => toModel(r as unknown as DbReleaseTrain))
    }
    const result = await db.execute({ sql: 'SELECT * FROM release_trains ORDER BY created_at DESC', args: [] })
    return result.rows.map((r) => toModel(r as unknown as DbReleaseTrain))
  },

  async addAtomicTasks(releaseTrainId: string, atomicTaskIds: string[], userId?: string): Promise<ReleaseTrain> {
    const db = getDb()
    const releaseTrain = await this.getById(releaseTrainId)
    if (!releaseTrain) throw new Error(`ReleaseTrain ${releaseTrainId} not found`)
    if (userId && releaseTrain.userId && releaseTrain.userId !== userId) throw new Error('Forbidden')
    const merged = [...new Set([...releaseTrain.atomicTaskIds, ...atomicTaskIds])]
    await db.execute({
      sql: `UPDATE release_trains SET atomic_task_ids_json = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [JSON.stringify(merged), releaseTrainId],
    })
    return (await this.getById(releaseTrainId))!
  },

  /** Backward-compat alias */
  async addBeads(releaseTrainId: string, beadIds: string[], userId?: string): Promise<ReleaseTrain> {
    return this.addAtomicTasks(releaseTrainId, beadIds, userId)
  },

  async removeAtomicTasks(releaseTrainId: string, atomicTaskIds: string[], userId?: string): Promise<ReleaseTrain> {
    const db = getDb()
    const releaseTrain = await this.getById(releaseTrainId)
    if (!releaseTrain) throw new Error(`ReleaseTrain ${releaseTrainId} not found`)
    if (userId && releaseTrain.userId && releaseTrain.userId !== userId) throw new Error('Forbidden')
    const filtered = releaseTrain.atomicTaskIds.filter((id) => !atomicTaskIds.includes(id))
    await db.execute({
      sql: `UPDATE release_trains SET atomic_task_ids_json = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [JSON.stringify(filtered), releaseTrainId],
    })
    return (await this.getById(releaseTrainId))!
  },

  /** Backward-compat alias */
  async removeBeads(releaseTrainId: string, beadIds: string[], userId?: string): Promise<ReleaseTrain> {
    return this.removeAtomicTasks(releaseTrainId, beadIds, userId)
  },

  async assignWorkerBee(releaseTrainId: string, workerBeeId: string | null, userId?: string): Promise<ReleaseTrain> {
    const db = getDb()
    if (userId) {
      const rt = await this.getById(releaseTrainId)
      if (rt && rt.userId && rt.userId !== userId) throw new Error('Forbidden')
    }
    await db.execute({
      sql: `UPDATE release_trains SET assigned_workerbee_id = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [workerBeeId, workerBeeId ? 'in_progress' : 'open', releaseTrainId],
    })
    broadcastEvent({
      id: uuidv4(),
      type: 'releasetrain.assigned',
      payload: { releaseTrainId, workerBeeId },
      timestamp: new Date().toISOString(),
    })
    return (await this.getById(releaseTrainId))!
  },

  async updateDescription(releaseTrainId: string, description: string, userId?: string): Promise<ReleaseTrain> {
    const db = getDb()
    if (userId) {
      const rt = await this.getById(releaseTrainId)
      if (rt && rt.userId && rt.userId !== userId) throw new Error('Forbidden')
    }
    await db.execute({
      sql: `UPDATE release_trains SET description = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [description, releaseTrainId],
    })
    return (await this.getById(releaseTrainId))!
  },

  async start(releaseTrainId: string, userId?: string) {
    const db = getDb()
    if (userId) {
      const rt = await this.getById(releaseTrainId)
      if (rt && rt.userId && rt.userId !== userId) throw new Error('Forbidden')
    }
    await db.execute({
      sql: `UPDATE release_trains SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?`,
      args: [releaseTrainId],
    })
    broadcastEvent({
      id: uuidv4(),
      type: 'releasetrain.assigned',
      payload: { releaseTrainId, workerBeeId: null },
      timestamp: new Date().toISOString(),
    })
  },

  async land(releaseTrainId: string, userId?: string) {
    const db = getDb()
    if (userId) {
      const rt = await this.getById(releaseTrainId)
      if (rt && rt.userId && rt.userId !== userId) throw new Error('Forbidden')
    }
    await db.execute({
      sql: `UPDATE release_trains SET status = 'landed', updated_at = datetime('now') WHERE id = ?`,
      args: [releaseTrainId],
    })
    broadcastEvent({
      id: uuidv4(),
      type: 'releasetrain.landed',
      payload: { releaseTrainId },
      timestamp: new Date().toISOString(),
    })
  },

  async cancel(releaseTrainId: string, userId?: string) {
    const db = getDb()
    if (userId) {
      const rt = await this.getById(releaseTrainId)
      if (rt && rt.userId && rt.userId !== userId) throw new Error('Forbidden')
    }
    await db.execute({
      sql: `UPDATE release_trains SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`,
      args: [releaseTrainId],
    })
    broadcastEvent({
      id: uuidv4(),
      type: 'releasetrain.cancelled',
      payload: { releaseTrainId },
      timestamp: new Date().toISOString(),
    })
  },

  async moveToPrReview(releaseTrainId: string, prUrl: string, prNumber: number, userId?: string): Promise<ReleaseTrain> {
    const db = getDb()
    if (userId) {
      const rt = await this.getById(releaseTrainId)
      if (rt && rt.userId && rt.userId !== userId) throw new Error('Forbidden')
    }
    await db.execute({
      sql: `UPDATE release_trains SET status = 'pr_review', pr_url = ?, pr_number = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [prUrl, prNumber, releaseTrainId],
    })
    broadcastEvent({
      id: uuidv4(),
      type: 'releasetrain.pr_review',
      payload: { releaseTrainId, prUrl, prNumber },
      timestamp: new Date().toISOString(),
    })
    return (await this.getById(releaseTrainId))!
  },
}

interface DbReleaseTrain {
  id: string
  name: string
  rig_id: string
  atomic_task_ids_json: string
  description: string
  assigned_workerbee_id: string | null
  status: ReleaseTrain['status']
  manual: number | null
  pr_url: string | null
  pr_number: number | null
  user_id: string | null
  created_at: string
  updated_at: string
}

function toModel(r: DbReleaseTrain): ReleaseTrain {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? '',
    projectId: r.rig_id,
    atomicTaskIds: JSON.parse(r.atomic_task_ids_json ?? '[]'),
    assignedWorkerBeeId: r.assigned_workerbee_id ?? null,
    status: r.status,
    manual: r.manual === 1,
    prUrl: r.pr_url ?? null,
    prNumber: r.pr_number ?? null,
    userId: r.user_id ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}
