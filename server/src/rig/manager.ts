import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import type { Project as Rig, RuntimeConfig } from '../types/index.js'

const DEFAULT_RUNTIME: RuntimeConfig = {
  provider: 'claude',
  command: 'claude',
  args: [],
  promptMode: 'auto',
}

export const rigManager = {
  async add(townId: string, name: string, repoUrl: string, localPath: string, userId?: string): Promise<Rig> {
    const db = getDb()
    const id = uuidv4()
    const now = new Date().toISOString()

    await db.execute({
      sql: `INSERT INTO rigs (id, town_id, name, repo_url, local_path, runtime_json, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, townId, name, repoUrl, localPath, JSON.stringify(DEFAULT_RUNTIME), userId ?? null, now],
    })

    return (await this.getById(id))!
  },

  async getById(id: string): Promise<Rig | null> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM rigs WHERE id = ?', args: [id] })
    const row = result.rows[0] as unknown as DbRig | undefined
    return row ? toModel(row) : null
  },

  async listByTown(townId: string, userId?: string): Promise<Rig[]> {
    const db = getDb()
    if (userId) {
      const result = await db.execute({
        sql: 'SELECT * FROM rigs WHERE town_id = ? AND (user_id = ? OR user_id IS NULL)',
        args: [townId, userId],
      })
      return result.rows.map((r) => toModel(r as unknown as DbRig))
    }
    const result = await db.execute({ sql: 'SELECT * FROM rigs WHERE town_id = ?', args: [townId] })
    return result.rows.map((r) => toModel(r as unknown as DbRig))
  },

  async setRuntime(id: string, runtime: Partial<RuntimeConfig>, userId?: string): Promise<Rig> {
    const db = getDb()
    const rig = await this.getById(id)
    if (!rig) throw new Error(`Rig ${id} not found`)
    if (userId && rig.userId && rig.userId !== userId) throw new Error('Forbidden')
    const merged = { ...rig.runtime, ...runtime }
    await db.execute({
      sql: 'UPDATE rigs SET runtime_json = ? WHERE id = ?',
      args: [JSON.stringify(merged), id],
    })
    return (await this.getById(id))!
  },

  async remove(id: string, userId?: string) {
    if (userId) {
      const rig = await this.getById(id)
      if (rig && rig.userId && rig.userId !== userId) throw new Error('Forbidden')
    }
    await getDb().execute({ sql: 'DELETE FROM rigs WHERE id = ?', args: [id] })
  },
}

interface DbRig {
  id: string
  town_id: string
  name: string
  repo_url: string
  local_path: string
  runtime_json: string
  user_id: string | null
  created_at: string
}

function toModel(r: DbRig): Rig {
  return {
    id: r.id,
    townId: r.town_id,
    name: r.name,
    repoUrl: r.repo_url,
    localPath: r.local_path,
    runtime: JSON.parse(r.runtime_json),
    userId: r.user_id ?? undefined,
    createdAt: r.created_at,
  }
}
