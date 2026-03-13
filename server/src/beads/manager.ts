import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { broadcastEvent } from '../ws/server.js'
import type { Bead } from '../types/index.js'

export const beadManager = {
  async create(
    projectId: string,
    title: string,
    description?: string,
    convoyId?: string,
    dependsOn?: string[]
  ): Promise<Bead> {
    const db = getDb()
    const id = uuidv4()
    const now = new Date().toISOString()

    await db.execute({
      sql: `INSERT INTO beads (id, project_id, convoy_id, title, description, status, assignee_id, depends_on, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'open', NULL, ?, ?, ?)`,
      args: [id, projectId, convoyId ?? null, title, description ?? '', JSON.stringify(dependsOn ?? []), now, now],
    })

    broadcastEvent({
      id: uuidv4(),
      type: 'bead.created',
      payload: { beadId: id, projectId, title, convoyId: convoyId ?? null },
      timestamp: now,
    })

    return (await this.getById(id))!
  },

  async getById(id: string): Promise<Bead | null> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM beads WHERE id = ?', args: [id] })
    const row = result.rows[0] as unknown as DbBead | undefined
    return row ? toModel(row) : null
  },

  async listByProject(projectId: string): Promise<Bead[]> {
    const db = getDb()
    const result = await db.execute({
      sql: 'SELECT * FROM beads WHERE project_id = ? ORDER BY created_at DESC',
      args: [projectId],
    })
    return result.rows.map((r) => toModel(r as unknown as DbBead))
  },

  async listByConvoy(convoyId: string): Promise<Bead[]> {
    const db = getDb()
    const result = await db.execute({
      sql: 'SELECT * FROM beads WHERE convoy_id = ? ORDER BY created_at DESC',
      args: [convoyId],
    })
    return result.rows.map((r) => toModel(r as unknown as DbBead))
  },

  async listAll(): Promise<Bead[]> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM beads ORDER BY created_at DESC', args: [] })
    return result.rows.map((r) => toModel(r as unknown as DbBead))
  },

  /** Check if all dependencies of a bead are done */
  async areDependenciesMet(id: string): Promise<{ met: boolean; blocking: Bead[] }> {
    const bead = await this.getById(id)
    if (!bead || bead.dependsOn.length === 0) return { met: true, blocking: [] }

    const deps = await Promise.all(bead.dependsOn.map((depId) => this.getById(depId)))
    const blocking = deps.filter((d): d is Bead => !!d && d.status !== 'done')
    return { met: blocking.length === 0, blocking }
  },

  async setDependencies(id: string, dependsOn: string[]): Promise<Bead> {
    const db = getDb()
    await db.execute({
      sql: `UPDATE beads SET depends_on = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [JSON.stringify(dependsOn), id],
    })
    return (await this.getById(id))!
  },

  async assign(id: string, workerBeeId: string): Promise<Bead> {
    const db = getDb()
    await db.execute({
      sql: `UPDATE beads SET assignee_id = ?, status = 'assigned', updated_at = datetime('now') WHERE id = ?`,
      args: [workerBeeId, id],
    })
    broadcastEvent({
      id: uuidv4(),
      type: 'bead.assigned',
      payload: { beadId: id, workerBeeId },
      timestamp: new Date().toISOString(),
    })
    return (await this.getById(id))!
  },

  async setStatus(id: string, status: Bead['status']): Promise<Bead> {
    const db = getDb()
    await db.execute({
      sql: `UPDATE beads SET status = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [status, id],
    })
    if (status === 'done') {
      broadcastEvent({
        id: uuidv4(),
        type: 'bead.done',
        payload: { beadId: id },
        timestamp: new Date().toISOString(),
      })
    }
    return (await this.getById(id))!
  },

  async remove(id: string): Promise<void> {
    const db = getDb()
    await db.execute({ sql: 'DELETE FROM beads WHERE id = ?', args: [id] })
  },
}

interface DbBead {
  id: string
  project_id: string
  convoy_id: string | null
  title: string
  description: string
  status: Bead['status']
  assignee_id: string | null
  depends_on: string
  created_at: string
  updated_at: string
}

function toModel(r: DbBead): Bead {
  return {
    id: r.id,
    projectId: r.project_id,
    convoyId: r.convoy_id,
    title: r.title,
    description: r.description,
    status: r.status,
    assigneeId: r.assignee_id,
    dependsOn: JSON.parse(r.depends_on ?? '[]'),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}
