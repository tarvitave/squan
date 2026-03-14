import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store/index.js'

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`

// Sentinel value written to a terminal subscriber when its PTY session no longer exists
export const SESSION_DEAD = '\x1b[31m\r\n[session ended — close this pane or create a new terminal]\x1b[0m\r\n'

type DataCallback = (data: string) => void

export function useWebSocket() {
  const ws = useRef<WebSocket | null>(null)
  const queue = useRef<string[]>([])          // messages buffered before connection opens
  const subscribers = useRef<Map<string, DataCallback>>(new Map())
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const pushEvent = useStore((s) => s.pushEvent)
  const addAgent = useStore((s) => s.addAgent)
  const updateAgent = useStore((s) => s.updateAgent)
  const addConvoy = useStore((s) => s.addConvoy)
  const updateConvoy = useStore((s) => s.updateConvoy)
  const addBead = useStore((s) => s.addBead)
  const updateBead = useStore((s) => s.updateBead)

  useEffect(() => {
    let socket: WebSocket
    let reconnectTimer: ReturnType<typeof setTimeout>

    function connect() {
      socket = new WebSocket(WS_URL)
      ws.current = socket

      socket.onopen = () => {
        // Re-subscribe to all active terminal sessions after reconnect
        for (const sessionId of subscribers.current.keys()) {
          socket.send(JSON.stringify({ type: 'subscribe', payload: { sessionId } }))
        }
        // Flush any messages queued while disconnected
        queue.current.forEach((msg) => socket.send(msg))
        queue.current = []

        // Keepalive ping every 30s to prevent NAT/proxy from dropping idle connections
        if (pingTimer.current) clearInterval(pingTimer.current)
        pingTimer.current = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }))
          }
        }, 30_000)
      }

      socket.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)

          if (msg.type === 'pong') return

          if (msg.type === 'session.not_found') {
            const sid = msg.payload?.sessionId as string | undefined
            if (sid) subscribers.current.get(sid)?.(SESSION_DEAD)
            return
          }

          if (msg.type === 'event') {
            const payload = msg.payload

            if (payload?.type === 'terminal.data' && msg.id) {
              subscribers.current.get(msg.id)?.(payload.data as string)
              return
            }

            pushEvent({
              id: crypto.randomUUID(),
              type: payload?.type ?? msg.type,
              payload: payload ?? {},
              timestamp: new Date().toISOString(),
            })

            // WorkerBee events
            if (payload?.type === 'workerbee.spawned') {
              const p = payload as Record<string, unknown>
              addAgent({
                id: p.workerBeeId as string,
                name: p.name as string,
                projectId: p.projectId as string,
                status: 'idle',
                sessionId: p.sessionId as string | null,
                taskDescription: (p.taskDescription as string) ?? '',
                completionNote: '',
                worktreePath: (p.worktreePath as string) ?? '',
                branch: (p.branch as string) ?? '',
              })
            }
            if (payload?.type === 'workerbee.working')
              updateAgent(payload.workerBeeId as string, { status: 'working' })
            if (payload?.type === 'workerbee.done')
              updateAgent(payload.workerBeeId as string, { status: 'done', completionNote: (payload.note as string) ?? '' })
            if (payload?.type === 'workerbee.stalled')
              updateAgent(payload.workerBeeId as string, { status: 'stalled', completionNote: (payload.note as string) ?? '' })
            if (payload?.type === 'workerbee.zombie')
              updateAgent(payload.workerBeeId as string, { status: 'zombie' })

            // Convoy events
            if (payload?.type === 'convoy.created') {
              const p = payload as Record<string, unknown>
              addConvoy({
                id: p.convoyId as string,
                name: p.name as string,
                description: (p.description as string) ?? '',
                projectId: (p.rigId as string) ?? '',
                status: 'open',
                beadIds: (p.beadIds as string[]) ?? [],
                assignedWorkerBeeId: null,
              })
            }
            if (payload?.type === 'convoy.assigned') {
              const p = payload as Record<string, unknown>
              updateConvoy(p.convoyId as string, {
                assignedWorkerBeeId: (p.workerBeeId as string | null) ?? null,
                status: p.workerBeeId ? 'in_progress' : 'open',
              })
            }
            if (payload?.type === 'convoy.landed') {
              updateConvoy(payload.convoyId as string, { status: 'landed' })
            }
            if (payload?.type === 'convoy.cancelled') {
              updateConvoy(payload.convoyId as string, { status: 'cancelled' })
            }

            // Bead events
            if (payload?.type === 'bead.created') {
              const p = payload as Record<string, unknown>
              addBead({
                id: p.beadId as string,
                projectId: p.projectId as string,
                convoyId: (p.convoyId as string | null) ?? null,
                title: p.title as string,
                description: '',
                status: 'open',
                assigneeId: null,
                dependsOn: [],
              })
            }
            if (payload?.type === 'bead.assigned') {
              const p = payload as Record<string, unknown>
              updateBead(p.beadId as string, { assigneeId: p.workerBeeId as string, status: 'assigned' })
            }
            if (payload?.type === 'bead.done') {
              updateBead(payload.beadId as string, { status: 'done' })
            }
          }
        } catch {
          // ignore parse errors
        }
      }

      socket.onclose = () => {
        if (pingTimer.current) { clearInterval(pingTimer.current); pingTimer.current = null }
        // Reconnect after 3s on unexpected close
        reconnectTimer = setTimeout(connect, 3000)
      }
    }

    connect()

    return () => {
      clearTimeout(reconnectTimer)
      if (pingTimer.current) { clearInterval(pingTimer.current); pingTimer.current = null }
      socket.onclose = null   // prevent reconnect on intentional unmount
      socket.close()
    }
  }, [pushEvent, addAgent, updateAgent, addConvoy, updateConvoy, addBead, updateBead])

  // Safe send: queues if socket not yet open
  const safeSend = useCallback((msg: object) => {
    const data = JSON.stringify(msg)
    const socket = ws.current
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(data)
    } else {
      queue.current.push(data)
    }
  }, [])

  const subscribe = useCallback((sessionId: string, cb: DataCallback) => {
    subscribers.current.set(sessionId, cb)
    safeSend({ type: 'subscribe', payload: { sessionId } })
  }, [safeSend])

  const unsubscribe = useCallback((sessionId: string) => {
    subscribers.current.delete(sessionId)
    safeSend({ type: 'unsubscribe', payload: { sessionId } })
  }, [safeSend])

  const sendInput = useCallback((sessionId: string, data: string) => {
    safeSend({ type: 'terminal.input', payload: { sessionId, data } })
  }, [safeSend])

  const sendResize = useCallback((sessionId: string, cols: number, rows: number) => {
    safeSend({ type: 'terminal.resize', payload: { sessionId, cols, rows } })
  }, [safeSend])

  return { subscribe, unsubscribe, sendInput, sendResize }
}
