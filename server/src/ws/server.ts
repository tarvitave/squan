import { WebSocketServer, WebSocket } from 'ws'
import { Server } from 'http'
import { v4 as uuidv4 } from 'uuid'
import type { WsMessage, SquansqEvent } from '../types/index.js'
import { ptyManager } from '../polecat/pty.js'
import { getDb } from '../db/index.js'

// Map of clientId → WebSocket
const clients = new Map<string, WebSocket>()

// Map of clientId → Set of subscribed terminal session IDs
const subscriptions = new Map<string, Set<string>>()

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

  wss.on('connection', (ws) => {
    const clientId = uuidv4()
    clients.set(clientId, ws)
    subscriptions.set(clientId, new Set())

    ws.on('message', (raw) => {
      try {
        const msg: WsMessage = JSON.parse(raw.toString())
        handleMessage(clientId, ws, msg)
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
    })

    send(ws, { type: 'ack', payload: { clientId } })
  })

  return wss
}

function handleMessage(clientId: string, ws: WebSocket, msg: WsMessage) {
  switch (msg.type) {
    case 'subscribe': {
      const sessionId = msg.payload?.sessionId as string
      if (!sessionId) return
      if (!ptyManager.list().includes(sessionId)) {
        send(ws, { type: 'session.not_found', payload: { sessionId } })
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
        ptyManager.write(sessionId, data)
      }
      break
    }

    case 'terminal.resize': {
      const sessionId = msg.payload?.sessionId as string
      const cols = msg.payload?.cols as number
      const rows = msg.payload?.rows as number
      if (sessionId && cols && rows) {
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
