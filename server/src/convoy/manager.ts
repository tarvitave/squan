import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { broadcastEvent } from '../ws/server.js'
import type { Convoy } from '../types/index.js'

export const convoyManager = {
  async create(name: string, rigId: string, beadIds: string[] = [], description?: string): Promise<Convoy> {
    const db = getDb()
    const id = uuidv4()
    const now = new Date().toISOString()

    await db.execute({
      sql: `INSERT INTO convoys (id, name, rig_id, bead_ids_json, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
      args: [id, name, rigId, JSON.stringify(beadIds), description ?? '', now, now],
    })

    broadcastEvent({
      id: uuidv4(),
      type: 'convoy.created',
      payload: { convoyId: id, name, rigId, beadIds, description: description ?? '' },
      timestamp: now,
    })

    return (await this.getById(id))!
  },

  async getById(id: string): Promise<Convoy | null> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM convoys WHERE id = ?', args: [id] })
    const row = result.rows[0] as unknown as DbConvoy | undefined
    return row ? toModel(row) : null
  },

  async listByRig(rigId: string): Promise<Convoy[]> {
    const db = getDb()
    const result = await db.execute({
      sql: 'SELECT * FROM convoys WHERE rig_id = ? ORDER BY created_at DESC',
      args: [rigId],
    })
    return result.rows.map((r) => toModel(r as unknown as DbConvoy))
  },

  async listAll(): Promise<Convoy[]> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM convoys ORDER BY created_at DESC', args: [] })
    return result.rows.map((r) => toModel(r as unknown as DbConvoy))
  },

  async addBeads(convoyId: string, beadIds: string[]): Promise<Convoy> {
    const db = getDb()
    const convoy = await this.getById(convoyId)
    if (!convoy) throw new Error(`Convoy ${convoyId} not found`)
    const merged = [...new Set([...convoy.beadIds, ...beadIds])]
    await db.execute({
      sql: `UPDATE convoys SET bead_ids_json = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [JSON.stringify(merged), convoyId],
    })
    return (await this.getById(convoyId))!
  },

  async removeBeads(convoyId: string, beadIds: string[]): Promise<Convoy> {
    const db = getDb()
    const convoy = await this.getById(convoyId)
    if (!convoy) throw new Error(`Convoy ${convoyId} not found`)
    const filtered = convoy.beadIds.filter((id) => !beadIds.includes(id))
    await db.execute({
      sql: `UPDATE convoys SET bead_ids_json = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [JSON.stringify(filtered), convoyId],
    })
    return (await this.getById(convoyId))!
  },

  async assignWorkerBee(convoyId: string, workerBeeId: string | null): Promise<Convoy> {
    const db = getDb()
    await db.execute({
      sql: `UPDATE convoys SET assigned_workerbee_id = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [workerBeeId, workerBeeId ? 'in_progress' : 'open', convoyId],
    })
    broadcastEvent({
      id: uuidv4(),
      type: 'convoy.assigned',
      payload: { convoyId, workerBeeId },
      timestamp: new Date().toISOString(),
    })
    return (await this.getById(convoyId))!
  },

  async updateDescription(convoyId: string, description: string): Promise<Convoy> {
    const db = getDb()
    await db.execute({
      sql: `UPDATE convoys SET description = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [description, convoyId],
    })
    return (await this.getById(convoyId))!
  },

  async land(convoyId: string) {
    const db = getDb()
    await db.execute({
      sql: `UPDATE convoys SET status = 'landed', updated_at = datetime('now') WHERE id = ?`,
      args: [convoyId],
    })
    broadcastEvent({
      id: uuidv4(),
      type: 'convoy.landed',
      payload: { convoyId },
      timestamp: new Date().toISOString(),
    })
  },

  async cancel(convoyId: string) {
    const db = getDb()
    await db.execute({
      sql: `UPDATE convoys SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`,
      args: [convoyId],
    })
    broadcastEvent({
      id: uuidv4(),
      type: 'convoy.cancelled',
      payload: { convoyId },
      timestamp: new Date().toISOString(),
    })
  },
}

interface DbConvoy {
  id: string
  name: string
  rig_id: string
  bead_ids_json: string
  description: string
  assigned_workerbee_id: string | null
  status: Convoy['status']
  created_at: string
  updated_at: string
}

function toModel(r: DbConvoy): Convoy {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? '',
    projectId: r.rig_id,
    beadIds: JSON.parse(r.bead_ids_json),
    assignedWorkerBeeId: r.assigned_workerbee_id ?? null,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}
