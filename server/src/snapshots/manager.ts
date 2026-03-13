import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { ptyManager } from '../polecat/pty.js'
import type { Snapshot, ReplayFrame } from '../types/index.js'

const MAX_SNAPSHOT_LINES = 500
const AUTO_SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000   // 10 minutes
const REPLAY_FRAME_INTERVAL_MS  = 30 * 1000          // 30 seconds
const MAX_REPLAY_FRAME_LINES    = 200

export const snapshotManager = {
  async capture(workerBeeId: string, sessionId: string): Promise<Snapshot> {
    const db = getDb()
    const id = uuidv4()
    const now = new Date().toISOString()
    const content = ptyManager.getHistory(sessionId).slice(-MAX_SNAPSHOT_LINES).join('')

    await db.execute({
      sql: `INSERT INTO snapshots (id, workerbee_id, session_id, content, captured_at) VALUES (?, ?, ?, ?, ?)`,
      args: [id, workerBeeId, sessionId, content, now],
    })

    return (await this.getById(id))!
  },

  async getById(id: string): Promise<Snapshot | null> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT * FROM snapshots WHERE id = ?', args: [id] })
    const row = result.rows[0] as unknown as DbSnapshot | undefined
    return row ? toSnapshotModel(row) : null
  },

  async listByWorkerBee(workerBeeId: string): Promise<Snapshot[]> {
    const db = getDb()
    const result = await db.execute({
      sql: 'SELECT id, workerbee_id, session_id, captured_at FROM snapshots WHERE workerbee_id = ? ORDER BY captured_at DESC',
      args: [workerBeeId],
    })
    return result.rows.map((r) => toSnapshotModel({ ...(r as unknown as DbSnapshot), content: '' }))
  },

  async getContent(id: string): Promise<string | null> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT content FROM snapshots WHERE id = ?', args: [id] })
    return (result.rows[0]?.content as string) ?? null
  },

  async remove(id: string): Promise<void> {
    await getDb().execute({ sql: 'DELETE FROM snapshots WHERE id = ?', args: [id] })
  },

  async pruneOld(workerBeeId: string, keepCount = 10): Promise<void> {
    const db = getDb()
    await db.execute({
      sql: `DELETE FROM snapshots WHERE workerbee_id = ? AND id NOT IN (
              SELECT id FROM snapshots WHERE workerbee_id = ? ORDER BY captured_at DESC LIMIT ?
            )`,
      args: [workerBeeId, workerBeeId, keepCount],
    })
  },
}

export const replayManager = {
  async recordFrame(workerBeeId: string, sessionId: string): Promise<void> {
    const db = getDb()
    const id = uuidv4()
    const content = ptyManager.getHistory(sessionId).slice(-MAX_REPLAY_FRAME_LINES).join('')
    await db.execute({
      sql: `INSERT INTO replay_frames (id, workerbee_id, content, frame_at) VALUES (?, ?, ?, datetime('now'))`,
      args: [id, workerBeeId, content],
    })
  },

  async listFrames(workerBeeId: string): Promise<ReplayFrame[]> {
    const db = getDb()
    const result = await db.execute({
      sql: 'SELECT id, workerbee_id, frame_at FROM replay_frames WHERE workerbee_id = ? ORDER BY frame_at ASC',
      args: [workerBeeId],
    })
    return result.rows.map((r) => toFrameModel(r as unknown as DbFrame))
  },

  async getFrameContent(frameId: string): Promise<string | null> {
    const db = getDb()
    const result = await db.execute({ sql: 'SELECT content FROM replay_frames WHERE id = ?', args: [frameId] })
    return (result.rows[0]?.content as string) ?? null
  },

  async pruneOld(workerBeeId: string, keepCount = 200): Promise<void> {
    const db = getDb()
    await db.execute({
      sql: `DELETE FROM replay_frames WHERE workerbee_id = ? AND id NOT IN (
              SELECT id FROM replay_frames WHERE workerbee_id = ? ORDER BY frame_at DESC LIMIT ?
            )`,
      args: [workerBeeId, workerBeeId, keepCount],
    })
  },
}

// Combined scheduler for both snapshots and replay frames
export function startSnapshotScheduler(
  getActiveBees: () => Promise<Array<{ id: string; sessionId: string | null; status: string }>>
) {
  // Replay frames: every 30s
  setInterval(async () => {
    try {
      const bees = await getActiveBees()
      for (const bee of bees) {
        if (bee.status === 'working' && bee.sessionId && ptyManager.list().includes(bee.sessionId)) {
          await replayManager.recordFrame(bee.id, bee.sessionId)
        }
      }
    } catch (err) {
      console.error('[Replay] Frame capture failed:', err)
    }
  }, REPLAY_FRAME_INTERVAL_MS)

  // Snapshots: every 10 min
  setInterval(async () => {
    try {
      const bees = await getActiveBees()
      for (const bee of bees) {
        if (bee.status === 'working' && bee.sessionId && ptyManager.list().includes(bee.sessionId)) {
          await snapshotManager.capture(bee.id, bee.sessionId)
          await snapshotManager.pruneOld(bee.id)
          await replayManager.pruneOld(bee.id)
        }
      }
    } catch (err) {
      console.error('[Snapshots] Auto-capture failed:', err)
    }
  }, AUTO_SNAPSHOT_INTERVAL_MS)
}

interface DbSnapshot {
  id: string
  workerbee_id: string
  session_id: string
  content: string
  captured_at: string
}

interface DbFrame {
  id: string
  workerbee_id: string
  content?: string
  frame_at: string
}

function toSnapshotModel(r: DbSnapshot): Snapshot {
  return { id: r.id, workerBeeId: r.workerbee_id, sessionId: r.session_id, content: r.content ?? '', capturedAt: r.captured_at }
}

function toFrameModel(r: DbFrame): ReplayFrame {
  return { id: r.id, workerBeeId: r.workerbee_id, content: r.content ?? '', frameAt: r.frame_at }
}
