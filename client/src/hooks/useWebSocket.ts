import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store/index.js'

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`

type DataCallback = (data: string) => void

export function useWebSocket() {
  const ws = useRef<WebSocket | null>(null)
  const queue = useRef<string[]>([])          // messages buffered before connection opens
  const subscribers = useRef<Map<string, DataCallback>>(new Map())
  const pushEvent = useStore((s) => s.pushEvent)
  const updateAgent = useStore((s) => s.updateAgent)

  useEffect(() => {
    let socket: WebSocket
    let reconnectTimer: ReturnType<typeof setTimeout>

    function connect() {
      socket = new WebSocket(WS_URL)
      ws.current = socket

      socket.onopen = () => {
        // Flush any messages that were sent before the connection opened
        queue.current.forEach((msg) => socket.send(msg))
        queue.current = []
      }

      socket.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)

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

            if (payload?.type === 'workerbee.done') updateAgent(payload.workerbeeId as string, { status: 'done' })
            if (payload?.type === 'workerbee.stalled') updateAgent(payload.workerbeeId as string, { status: 'stalled' })
            if (payload?.type === 'workerbee.zombie') updateAgent(payload.workerbeeId as string, { status: 'zombie' })
          }
        } catch {
          // ignore parse errors
        }
      }

      socket.onclose = () => {
        // Reconnect after 3s on unexpected close
        reconnectTimer = setTimeout(connect, 3000)
      }
    }

    connect()

    return () => {
      clearTimeout(reconnectTimer)
      socket.onclose = null   // prevent reconnect on intentional unmount
      socket.close()
    }
  }, [pushEvent, updateAgent])

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
