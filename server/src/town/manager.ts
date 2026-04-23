import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'

export interface Town {
  id: string
  name: string
  path: string
  userId?: string
  createdAt: string
}

export const townManager = {
  async list(userId?: string): Promise<Town[]> {
    const db = getDb()
    if (userId) {
      const result = await db.execute({
        sql: 'SELECT * FROM towns WHERE user_id = ? OR user_id IS NULL ORDER BY created_at ASC',
        args: [userId],
      })
      return result.rows.map((r) => toModel(r as unknown as DbTown))
    }
    const result = await db.execute({ sql: 'SELECT * FROM towns ORDER BY created_at ASC', args: [] })
    return result.rows.map((r) => toModel(r as unknown as DbTown))
  },

  async getById(id: string): Promise<Town | null> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM towns WHERE id = ?', args: [id] })
    const row = result.rows[0] as unknown as DbTown | undefined
    return row ? toModel(row) : null
  },

  async create(name: string, path: string, userId?: string): Promise<Town> {
    const db = getDb()
    const id = uuidv4()
    const now = new Date().toISOString()
    await db.execute({
      sql: `INSERT INTO towns (id, name, path, user_id, created_at) VALUES (?, ?, ?, ?, ?)`,
      args: [id, name, path, userId ?? null, now],
    })
    return (await this.getById(id))!
  },

  async ensureDefault(): Promise<Town> {
    const towns = await this.list()
    if (towns.length > 0) return towns[0]
    const { homedir } = await import('os')
    const { join } = await import('path')
    return this.create('default', join(homedir(), 'squan-workspace'))
  },

  async updatePath(id: string, newPath: string): Promise<Town> {
    const db = getDb()
    await db.execute({ sql: 'UPDATE towns SET path = ? WHERE id = ?', args: [newPath, id] })
    const town = await this.getById(id)
    if (!town) throw new Error('Town not found')
    return town
  },
}

interface DbTown { id: string; name: string; path: string; user_id: string | null; created_at: string }
function toModel(r: DbTown): Town {
  return { id: r.id, name: r.name, path: r.path, userId: r.user_id ?? undefined, createdAt: r.created_at }
}
