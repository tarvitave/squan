import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db'
import type { Project, RuntimeConfig } from '../types'

const DEFAULT_RUNTIME: RuntimeConfig = {
  provider: 'claude',
  command: 'claude',
  args: [],
  promptMode: 'auto',
}

export const rigManager = {
  async add(name: string, repoUrl: string, localPath: string, townId: string = 'local'): Promise<Project> {
    const db = getDb()
    const id = uuidv4()
    const now = new Date().toISOString()

    await db.execute({
      sql: `INSERT INTO rigs (id, town_id, name, repo_url, local_path, runtime_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [id, townId, name, repoUrl, localPath, JSON.stringify(DEFAULT_RUNTIME), now],
    })

    return (await this.getById(id))!
  },

  async create(name: string, repoUrl: string, localPath: string, townId: string = 'local'): Promise<Project> {
    return this.add(name, repoUrl, localPath, townId)
  },

  async getById(id: string): Promise<Project | null> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM rigs WHERE id = ?', args: [id] })
    const row = result.rows[0] as unknown as DbRig | undefined
    return row ? toModel(row) : null
  },

  async list(): Promise<Project[]> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM rigs ORDER BY created_at DESC', args: [] })
    return result.rows.map((r) => toModel(r as unknown as DbRig))
  },

  async listAll(): Promise<Project[]> {
    return this.list()
  },

  async listByTown(townId: string): Promise<Project[]> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM rigs WHERE town_id = ?', args: [townId] })
    return result.rows.map((r) => toModel(r as unknown as DbRig))
  },

  async update(id: string, updates: Partial<{ name: string; repoUrl: string; localPath: string }>): Promise<Project> {
    const db = getDb()
    const rig = await this.getById(id)
    if (!rig) throw new Error(`Project ${id} not found`)

    const name = updates.name ?? rig.name
    const repoUrl = updates.repoUrl ?? rig.repoUrl
    const localPath = updates.localPath ?? rig.localPath

    await db.execute({
      sql: `UPDATE rigs SET name = ?, repo_url = ?, local_path = ? WHERE id = ?`,
      args: [name, repoUrl, localPath, id],
    })

    return (await this.getById(id))!
  },

  async setRuntime(id: string, runtime: Partial<RuntimeConfig>): Promise<Project> {
    const db = getDb()
    const rig = await this.getById(id)
    if (!rig) throw new Error(`Project ${id} not found`)
    const merged = { ...rig.runtime, ...runtime }
    await db.execute({
      sql: 'UPDATE rigs SET runtime_json = ? WHERE id = ?',
      args: [JSON.stringify(merged), id],
    })
    return (await this.getById(id))!
  },

  async delete(id: string): Promise<void> {
    const db = getDb()
    await db.execute({ sql: 'DELETE FROM rigs WHERE id = ?', args: [id] })
  },

  async remove(id: string): Promise<void> {
    return this.delete(id)
  },
}

interface DbRig {
  id: string
  town_id: string
  name: string
  repo_url: string
  local_path: string
  runtime_json: string
  created_at: string
}

function toModel(r: DbRig): Project {
  return {
    id: r.id,
    townId: r.town_id,
    name: r.name,
    repoUrl: r.repo_url,
    localPath: r.local_path,
    runtime: JSON.parse(r.runtime_json),
    createdAt: r.created_at,
  }
}
