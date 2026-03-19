import { useEffect, useRef, useCallback, useState } from 'react'
import { useStore } from '../store/index.js'

// Sentinel value written to a terminal subscriber when its PTY session no longer exists
export const SESSION_DEAD = '\x1b[31m\r\n[session ended — close this pane or create a new terminal]\x1b[0m\r\n'

type DataCallback = (data: string) => void

export function useWebSocket() {
  const ws = useRef<WebSocket | null>(null)
  const queue = useRef<string[]>([])          // messages buffered before connection opens
  const subscribers = useRef<Map<string, DataCallback>>(new Map())
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const retryDelay = useRef(1000)             // exponential backoff, starts at 1s, caps at 30s
  const lastBootId = useRef<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [serverRestarted, setServerRestarted] = useState(false)
  const pushEvent = useStore((s) => s.pushEvent)
  const addAgent = useStore((s) => s.addAgent)
  const updateAgent = useStore((s) => s.updateAgent)
  const removeAgent = useStore((s) => s.removeAgent)
  const addReleaseTrain = useStore((s) => s.addReleaseTrain)
  const updateReleaseTrain = useStore((s) => s.updateReleaseTrain)
  const addAtomicTask = useStore((s) => s.addAtomicTask)
  const updateAtomicTask = useStore((s) => s.updateAtomicTask)

  useEffect(() => {
    let socket: WebSocket
    let reconnectTimer: ReturnType<typeof setTimeout>

    function connect() {
      const token = useStore.getState().token
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const wsUrl = token
        ? `${proto}://${window.location.host}/ws?token=${encodeURIComponent(token)}`
        : `${proto}://${window.location.host}/ws`
      socket = new WebSocket(wsUrl)
      ws.current = socket

      socket.onopen = () => {
        retryDelay.current = 1000  // reset backoff on successful connect
        setConnected(true)
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

          if (msg.type === 'ack') {
            const bootId = msg.payload?.bootId as string | undefined
            if (bootId && lastBootId.current !== null && lastBootId.current !== bootId) {
              // Server restarted — signal App to clear stale panes
              setServerRestarted(true)
            }
            if (bootId) lastBootId.current = bootId
            return
          }

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
            if (payload?.type === 'workerbee.deleted') {
              const workerBeeId = payload.workerBeeId as string
              const agent = useStore.getState().agents.find((a) => a.id === workerBeeId)
              if (agent?.sessionId) useStore.getState().removePaneFromAllTabs(agent.sessionId)
              removeAgent(workerBeeId)
            }

            // ReleaseTrain events
            if (payload?.type === 'releasetrain.created') {
              const p = payload as Record<string, unknown>
              addReleaseTrain({
                id: p.releaseTrainId as string,
                name: p.name as string,
                description: (p.description as string) ?? '',
                projectId: (p.rigId as string) ?? '',
                status: 'open',
                atomicTaskIds: (p.atomicTaskIds as string[]) ?? [],
                assignedWorkerBeeId: null,
              })
            }
            if (payload?.type === 'releasetrain.assigned') {
              const p = payload as Record<string, unknown>
              updateReleaseTrain(p.releaseTrainId as string, {
                assignedWorkerBeeId: (p.workerBeeId as string | null) ?? null,
                status: p.workerBeeId ? 'in_progress' : 'open',
              })
            }
            if (payload?.type === 'releasetrain.landed') {
              updateReleaseTrain(payload.releaseTrainId as string, { status: 'landed' })
            }
            if (payload?.type === 'releasetrain.cancelled') {
              updateReleaseTrain(payload.releaseTrainId as string, { status: 'cancelled' })
            }
            if (payload?.type === 'releasetrain.pr_review') {
              const p = payload as Record<string, unknown>
              updateReleaseTrain(p.releaseTrainId as string, {
                status: 'pr_review',
                prUrl: p.prUrl as string,
                prNumber: p.prNumber as number,
              })
            }

            // AtomicTask events
            if (payload?.type === 'atomictask.created') {
              const p = payload as Record<string, unknown>
              addAtomicTask({
                id: p.atomicTaskId as string,
                projectId: p.projectId as string,
                releaseTrainId: (p.releaseTrainId as string | null) ?? null,
                convoyId: (p.releaseTrainId as string | null) ?? null,  // backward compat
                title: p.title as string,
                description: '',
                status: 'open',
                assigneeId: null,
                dependsOn: [],
              })
            }
            if (payload?.type === 'atomictask.assigned') {
              const p = payload as Record<string, unknown>
              updateAtomicTask(p.atomicTaskId as string, { assigneeId: p.workerBeeId as string, status: 'assigned' })
            }
            if (payload?.type === 'atomictask.done') {
              updateAtomicTask(payload.atomicTaskId as string, { status: 'done' })
            }
          }
        } catch {
          // ignore parse errors
        }
      }

      socket.onclose = () => {
        if (pingTimer.current) { clearInterval(pingTimer.current); pingTimer.current = null }
        setConnected(false)
        // Reconnect with exponential backoff (1s → 2s → 4s → … → 30s max)
        reconnectTimer = setTimeout(connect, retryDelay.current)
        retryDelay.current = Math.min(retryDelay.current * 2, 30_000)
      }
    }

    connect()

    return () => {
      clearTimeout(reconnectTimer)
      if (pingTimer.current) { clearInterval(pingTimer.current); pingTimer.current = null }
      socket.onopen = null    // prevent stale state setters firing after unmount
      socket.onmessage = null
      socket.onclose = null   // prevent reconnect on intentional unmount
      socket.close()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  return { subscribe, unsubscribe, sendInput, sendResize, connected, serverRestarted, clearServerRestarted: () => setServerRestarted(false) }
}
