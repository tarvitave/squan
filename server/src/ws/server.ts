import { WebSocketServer, WebSocket } from 'ws'
import { Server } from 'http'
import { v4 as uuidv4 } from 'uuid'
import jwt from 'jsonwebtoken'
import type { WsMessage, SquansqEvent } from '../types/index.js'
import { ptyManager } from '../workerbee/pty.js'
import { getDb } from '../db/index.js'

const JWT_SECRET = process.env.JWT_SECRET ?? 'squansq-dev-secret-change-in-production'

// Unique ID for this server process — changes on every restart
const BOOT_ID = uuidv4()

// Map of clientId → WebSocket
const clients = new Map<string, WebSocket>()

// Map of clientId → Set of subscribed terminal session IDs
const subscriptions = new Map<string, Set<string>>()

// Map of clientId → authenticated userId
const clientUserIds = new Map<string, string>()

// Notify all clients subscribed to a session that the session has ended
export function notifySessionEnded(sessionId: string) {
  for (const [clientId, sessions] of subscriptions.entries()) {
    if (sessions.has(sessionId)) {
      const ws = clients.get(clientId)
      if (ws) send(ws, { type: 'session.not_found', payload: { sessionId } })
      sessions.delete(sessionId)
    }
  }
}

export function setupWsServer(httpServer: Server) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

  // Notify browser clients when a PTY session exits so they see "session ended" instead of a hung cursor
  ptyManager.onAnySessionExit((sessionId) => notifySessionEnded(sessionId))

  wss.on('connection', (ws, req) => {
    // --- Authentication: require ?token=<jwt> query parameter ---
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
    const token = url.searchParams.get('token')

    let userId: string | null = null
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET) as { userId: string }
        userId = payload.userId
      } catch {
        // invalid token — reject
      }
    }

    if (!userId) {
      send(ws, { type: 'error', payload: { message: 'Unauthorized: valid token required' } })
      ws.close(1008, 'Unauthorized')
      return
    }

    const clientId = uuidv4()
    clients.set(clientId, ws)
    subscriptions.set(clientId, new Set())
    clientUserIds.set(clientId, userId)

    ws.on('message', (raw) => {
      try {
        const msg: WsMessage = JSON.parse(raw.toString())
        handleMessage(clientId, ws, msg).catch(() => {})
      } catch {
        send(ws, { type: 'error', payload: { message: 'Invalid JSON' } })
      }
    })

    ws.on('close', () => {
      subscriptions.get(clientId)?.forEach((sessionId) => {
        ptyManager.unsubscribe(sessionId, clientId)
      })
      clients.delete(clientId)
      subscriptions.delete(clientId)
      clientUserIds.delete(clientId)
    })

    send(ws, { type: 'ack', payload: { clientId, bootId: BOOT_ID } })
  })

  return wss
}

async function handleMessage(clientId: string, ws: WebSocket, msg: WsMessage) {
  const userId = clientUserIds.get(clientId)
  if (!userId) {
    send(ws, { type: 'error', payload: { message: 'Unauthorized' } })
    return
  }

  switch (msg.type) {
    case 'subscribe': {
      const sessionId = msg.payload?.sessionId as string
      if (!sessionId) return
      if (!ptyManager.list().includes(sessionId)) {
        // Try to replay the last known output for this session before marking it dead
        try {
          const db = getDb()
          const beeRow = await db.execute({ sql: `SELECT id FROM workerbees WHERE session_id = ? LIMIT 1`, args: [sessionId] })
          const beeId = beeRow.rows[0]?.id as string | undefined
          if (beeId) {
            const frameRow = await db.execute({ sql: `SELECT content FROM replay_frames WHERE workerbee_id = ? ORDER BY frame_at DESC LIMIT 1`, args: [beeId] })
            const content = frameRow.rows[0]?.content as string | undefined
            if (content) {
              send(ws, { type: 'event', id: sessionId, payload: { type: 'terminal.data', data: '\r\n\x1b[90m[— replaying last known output —]\x1b[0m\r\n' + content } })
            }
          }
        } catch { /* ignore — best-effort history */ }
        send(ws, { type: 'session.not_found', payload: { sessionId } })
        return
      }
      // Enforce session ownership: only the owner can subscribe
      const ownerUserId = ptyManager.getOwnerUserId(sessionId)
      if (ownerUserId !== null && ownerUserId !== userId) {
        send(ws, { type: 'error', payload: { message: 'Forbidden: session belongs to another user' } })
        return
      }
      subscriptions.get(clientId)?.add(sessionId)
      ptyManager.subscribe(sessionId, clientId, (data: string) => {
        send(ws, { type: 'event', id: sessionId, payload: { type: 'terminal.data', data } })
      })
      break
    }

    case 'ping': {
      send(ws, { type: 'pong', payload: {} })
      break
    }

    case 'unsubscribe': {
      const sessionId = msg.payload?.sessionId as string
      if (!sessionId) return
      subscriptions.get(clientId)?.delete(sessionId)
      ptyManager.unsubscribe(sessionId, clientId)
      break
    }

    case 'terminal.input': {
      const sessionId = msg.payload?.sessionId as string
      const data = msg.payload?.data as string
      if (sessionId && data) {
        // Only allow input to sessions owned by this user (or unowned sessions)
        const ownerUserId = ptyManager.getOwnerUserId(sessionId)
        if (ownerUserId !== null && ownerUserId !== userId) {
          send(ws, { type: 'error', payload: { message: 'Forbidden: session belongs to another user' } })
          return
        }
        ptyManager.write(sessionId, data)
      }
      break
    }

    case 'terminal.resize': {
      const sessionId = msg.payload?.sessionId as string
      const cols = msg.payload?.cols as number
      const rows = msg.payload?.rows as number
      if (sessionId && cols && rows) {
        // Only allow resize for sessions owned by this user (or unowned sessions)
        const ownerUserId = ptyManager.getOwnerUserId(sessionId)
        if (ownerUserId !== null && ownerUserId !== userId) {
          send(ws, { type: 'error', payload: { message: 'Forbidden: session belongs to another user' } })
          return
        }
        ptyManager.resize(sessionId, cols, rows)
      }
      break
    }
  }
}

// Broadcast a domain event to all connected clients and persist to DB
export function broadcastEvent(event: SquansqEvent) {
  // Skip terminal data events — too noisy to persist
  if (event.type !== 'terminal.data' && event.type !== 'terminal.resize') {
    getDb().execute({
      sql: `INSERT INTO events (id, type, payload_json, timestamp) VALUES (?, ?, ?, ?)`,
      args: [event.id, event.type, JSON.stringify(event.payload), event.timestamp],
    }).catch(() => { /* non-blocking, ignore errors */ })
  }

  const msg: WsMessage = { type: 'event', payload: event as unknown as Record<string, unknown> }
  for (const ws of clients.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      send(ws, msg)
    }
  }
}

function send(ws: WebSocket, msg: WsMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}
