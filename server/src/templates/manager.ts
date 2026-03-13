import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import type { Template } from '../types/index.js'

export const templateManager = {
  async create(projectId: string, name: string, content: string): Promise<Template> {
    const db = getDb()
    const id = uuidv4()
    const now = new Date().toISOString()
    await db.execute({
      sql: `INSERT INTO templates (id, project_id, name, content, created_at) VALUES (?, ?, ?, ?, ?)`,
      args: [id, projectId, name, content, now],
    })
    return (await this.getById(id))!
  },

  async getById(id: string): Promise<Template | null> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM templates WHERE id = ?', args: [id] })
    const row = result.rows[0] as unknown as DbTemplate | undefined
    return row ? toModel(row) : null
  },

  async listByProject(projectId: string): Promise<Template[]> {
    const db = getDb()
    const result = await db.execute({
      sql: 'SELECT * FROM templates WHERE project_id = ? ORDER BY name ASC',
      args: [projectId],
    })
    return result.rows.map((r) => toModel(r as unknown as DbTemplate))
  },

  async listAll(): Promise<Template[]> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM templates ORDER BY project_id, name ASC', args: [] })
    return result.rows.map((r) => toModel(r as unknown as DbTemplate))
  },

  async update(id: string, patch: { name?: string; content?: string }): Promise<Template> {
    const db = getDb()
    const tpl = await this.getById(id)
    if (!tpl) throw new Error(`Template ${id} not found`)
    await db.execute({
      sql: `UPDATE templates SET name = ?, content = ? WHERE id = ?`,
      args: [patch.name ?? tpl.name, patch.content ?? tpl.content, id],
    })
    return (await this.getById(id))!
  },

  async remove(id: string): Promise<void> {
    await getDb().execute({ sql: 'DELETE FROM templates WHERE id = ?', args: [id] })
  },
}

interface DbTemplate {
  id: string
  project_id: string
  name: string
  content: string
  created_at: string
}

function toModel(r: DbTemplate): Template {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    content: r.content,
    createdAt: r.created_at,
  }
}
