import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { ptyManager } from '../polecat/pty.js'
import { broadcastEvent } from '../ws/server.js'
import type { MayorLee } from '../types/index.js'

// mayorLeeManager — manages Mayor Lee, the orchestrator agent
export const mayorLeeManager = {
  async start(townId: string, apiKey?: string): Promise<MayorLee> {
    const db = getDb()

    const existing = await db.execute({ sql: 'SELECT * FROM mayors WHERE town_id = ?', args: [townId] })
    const row = existing.rows[0] as unknown as DbRow | undefined

    if (row?.session_id) {
      return toModel(row)
    }

    const id = row?.id ?? uuidv4()
    const repoPath = process.env.SQUANSQ_REPO_PATH ?? process.env.HOME ?? '/opt/squansq-repo'

    const env: Record<string, string> = {
      SQUANSQ_ROLE: 'mayor-lee',
      SQUANSQ_TOWN: townId,
    }
    if (apiKey) env.ANTHROPIC_API_KEY = apiKey

    const sessionId = ptyManager.spawn({
      shell: process.env.MAYOR_COMMAND ?? 'claude',
      cwd: repoPath,
      env,
    })

    const now = new Date().toISOString()
    if (row) {
      await db.execute({
        sql: `UPDATE mayors SET session_id = ?, status = 'idle' WHERE id = ?`,
        args: [sessionId, id],
      })
    } else {
      await db.execute({
        sql: `INSERT INTO mayors (id, town_id, session_id, status, created_at) VALUES (?, ?, ?, 'idle', ?)`,
        args: [id, townId, sessionId, now],
      })
    }

    broadcastEvent({
      id: uuidv4(),
      type: 'mayorlee.started',
      payload: { mayorId: id, townId, sessionId },
      timestamp: now,
    })

    return (await this.get(townId))!
  },

  async stop(townId: string) {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM mayors WHERE town_id = ?', args: [townId] })
    const row = result.rows[0] as unknown as DbRow | undefined
    if (!row) return
    if (row.session_id) {
      ptyManager.kill(row.session_id)
    }
    await db.execute({
      sql: `UPDATE mayors SET session_id = NULL, status = 'idle' WHERE id = ?`,
      args: [row.id],
    })
    broadcastEvent({
      id: uuidv4(),
      type: 'mayorlee.stopped',
      payload: { mayorId: row.id, townId },
      timestamp: new Date().toISOString(),
    })
  },

  async sendMessage(townId: string, message: string) {
    const mayor = await this.get(townId)
    if (mayor?.sessionId) {
      ptyManager.write(mayor.sessionId, message + '\r')
    }
  },

  async get(townId: string): Promise<MayorLee | null> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM mayors WHERE town_id = ?', args: [townId] })
    const row = result.rows[0] as unknown as DbRow | undefined
    return row ? toModel(row) : null
  },
}

// Backwards compat alias
export const mayorManager = mayorLeeManager

interface DbRow {
  id: string
  town_id: string
  session_id: string | null
  status: MayorLee['status']
  created_at: string
}

function toModel(r: DbRow): MayorLee {
  return {
    id: r.id,
    townId: r.town_id,
    sessionId: r.session_id,
    status: r.status,
    createdAt: r.created_at,
  }
}
