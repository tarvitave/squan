import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { broadcastEvent } from '../ws/server.js'
import type { AtomicTask } from '../types/index.js'

export const atomicTaskManager = {
  async create(
    projectId: string,
    title: string,
    description?: string,
    releaseTrainId?: string,
    dependsOn?: string[]
  ): Promise<AtomicTask> {
    const db = getDb()
    const id = uuidv4()
    const now = new Date().toISOString()

    await db.execute({
      sql: `INSERT INTO atomic_tasks (id, project_id, release_train_id, title, description, status, assignee_id, depends_on, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'open', NULL, ?, ?, ?)`,
      args: [id, projectId, releaseTrainId ?? null, title, description ?? '', JSON.stringify(dependsOn ?? []), now, now],
    })

    broadcastEvent({
      id: uuidv4(),
      type: 'atomictask.created',
      payload: { atomicTaskId: id, projectId, title, releaseTrainId: releaseTrainId ?? null },
      timestamp: now,
    })

    return (await this.getById(id))!
  },

  async getById(id: string): Promise<AtomicTask | null> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM atomic_tasks WHERE id = ?', args: [id] })
    const row = result.rows[0] as unknown as DbAtomicTask | undefined
    return row ? toModel(row) : null
  },

  async listByProject(projectId: string): Promise<AtomicTask[]> {
    const db = getDb()
    const result = await db.execute({
      sql: 'SELECT * FROM atomic_tasks WHERE project_id = ? ORDER BY created_at DESC',
      args: [projectId],
    })
    return result.rows.map((r) => toModel(r as unknown as DbAtomicTask))
  },

  async listByConvoy(releaseTrainId: string): Promise<AtomicTask[]> {
    const db = getDb()
    const result = await db.execute({
      sql: 'SELECT * FROM atomic_tasks WHERE release_train_id = ? ORDER BY created_at DESC',
      args: [releaseTrainId],
    })
    return result.rows.map((r) => toModel(r as unknown as DbAtomicTask))
  },

  async listAll(): Promise<AtomicTask[]> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM atomic_tasks ORDER BY created_at DESC', args: [] })
    return result.rows.map((r) => toModel(r as unknown as DbAtomicTask))
  },

  /** Check if all dependencies of an atomic task are done */
  async areDependenciesMet(id: string): Promise<{ met: boolean; blocking: AtomicTask[] }> {
    const atomicTask = await this.getById(id)
    if (!atomicTask || atomicTask.dependsOn.length === 0) return { met: true, blocking: [] }

    const deps = await Promise.all(atomicTask.dependsOn.map((depId) => this.getById(depId)))
    const blocking = deps.filter((d): d is AtomicTask => !!d && d.status !== 'done')
    return { met: blocking.length === 0, blocking }
  },

  async setDependencies(id: string, dependsOn: string[]): Promise<AtomicTask> {
    const db = getDb()
    await db.execute({
      sql: `UPDATE atomic_tasks SET depends_on = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [JSON.stringify(dependsOn), id],
    })
    return (await this.getById(id))!
  },

  async assign(id: string, workerBeeId: string): Promise<AtomicTask> {
    const db = getDb()
    await db.execute({
      sql: `UPDATE atomic_tasks SET assignee_id = ?, status = 'assigned', updated_at = datetime('now') WHERE id = ?`,
      args: [workerBeeId, id],
    })
    broadcastEvent({
      id: uuidv4(),
      type: 'atomictask.assigned',
      payload: { atomicTaskId: id, workerBeeId },
      timestamp: new Date().toISOString(),
    })
    return (await this.getById(id))!
  },

  async setStatus(id: string, status: AtomicTask['status']): Promise<AtomicTask> {
    const db = getDb()
    await db.execute({
      sql: `UPDATE atomic_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [status, id],
    })
    if (status === 'done') {
      broadcastEvent({
        id: uuidv4(),
        type: 'atomictask.done',
        payload: { atomicTaskId: id },
        timestamp: new Date().toISOString(),
      })
    }
    return (await this.getById(id))!
  },

  async remove(id: string): Promise<void> {
    const db = getDb()
    await db.execute({ sql: 'DELETE FROM atomic_tasks WHERE id = ?', args: [id] })
  },
}

/** Backward-compat alias */
export const beadManager = atomicTaskManager

interface DbAtomicTask {
  id: string
  project_id: string
  release_train_id: string | null
  title: string
  description: string
  status: AtomicTask['status']
  assignee_id: string | null
  depends_on: string
  created_at: string
  updated_at: string
}

function toModel(r: DbAtomicTask): AtomicTask {
  return {
    id: r.id,
    projectId: r.project_id,
    releaseTrainId: r.release_train_id,
    convoyId: r.release_train_id,  // backward-compat alias
    title: r.title,
    description: r.description,
    status: r.status,
    assigneeId: r.assignee_id,
    dependsOn: JSON.parse(r.depends_on ?? '[]'),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}
