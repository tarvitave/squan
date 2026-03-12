import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { ptyManager } from '../polecat/pty.js'
import { broadcastEvent } from '../ws/server.js'
import type { Mayor } from '../types/index.js'

export const mayorManager = {
  async start(townId: string): Promise<Mayor> {
    const db = getDb()

    const existing = await db.execute({ sql: 'SELECT * FROM mayors WHERE town_id = ?', args: [townId] })
    const row = existing.rows[0] as unknown as DbMayor | undefined

    if (row?.session_id) {
      return toModel(row)
    }

    const id = row?.id ?? uuidv4()
    const sessionId = ptyManager.spawn({
      env: { SQUANSQ_ROLE: 'mayor', SQUANSQ_TOWN: townId },
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
      type: 'mayor.started',
      payload: { mayorId: id, townId, sessionId },
      timestamp: now,
    })

    return (await this.get(townId))!
  },

  async stop(townId: string) {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM mayors WHERE town_id = ?', args: [townId] })
    const row = result.rows[0] as unknown as DbMayor | undefined
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
      type: 'mayor.stopped',
      payload: { mayorId: row.id, townId },
      timestamp: new Date().toISOString(),
    })
  },

  async get(townId: string): Promise<Mayor | null> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM mayors WHERE town_id = ?', args: [townId] })
    const row = result.rows[0] as unknown as DbMayor | undefined
    return row ? toModel(row) : null
  },
}

interface DbMayor {
  id: string
  town_id: string
  session_id: string | null
  status: Mayor['status']
  created_at: string
}

function toModel(r: DbMayor): Mayor {
  return {
    id: r.id,
    townId: r.town_id,
    sessionId: r.session_id,
    status: r.status,
    createdAt: r.created_at,
  }
}
