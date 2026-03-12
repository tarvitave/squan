import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store/index.js'

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`

type DataCallback = (data: string) => void

export function useWebSocket() {
  const ws = useRef<WebSocket | null>(null)
  const subscribers = useRef<Map<string, DataCallback>>(new Map())
  const pushEvent = useStore((s) => s.pushEvent)
  const updateAgent = useStore((s) => s.updateAgent)

  useEffect(() => {
    const socket = new WebSocket(WS_URL)
    ws.current = socket

    socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)

        if (msg.type === 'event') {
          const payload = msg.payload

          // Terminal data → route to subscriber
          if (payload?.type === 'terminal.data' && msg.id) {
            subscribers.current.get(msg.id)?.(payload.data as string)
            return
          }

          // Domain events → store + event stream
          pushEvent({
            id: crypto.randomUUID(),
            type: payload?.type ?? msg.type,
            payload: payload ?? {},
            timestamp: new Date().toISOString(),
          })

          // Handle agent status updates
          if (payload?.type === 'polecat.done') updateAgent(payload.polecatId as string, { status: 'done' })
          if (payload?.type === 'polecat.stalled') updateAgent(payload.polecatId as string, { status: 'stalled' })
          if (payload?.type === 'polecat.zombie') updateAgent(payload.polecatId as string, { status: 'zombie' })
        }
      } catch {
        // ignore parse errors
      }
    }

    return () => socket.close()
  }, [pushEvent, updateAgent])

  const subscribe = useCallback((sessionId: string, cb: DataCallback) => {
    subscribers.current.set(sessionId, cb)
    ws.current?.send(JSON.stringify({ type: 'subscribe', payload: { sessionId } }))
  }, [])

  const unsubscribe = useCallback((sessionId: string) => {
    subscribers.current.delete(sessionId)
    ws.current?.send(JSON.stringify({ type: 'unsubscribe', payload: { sessionId } }))
  }, [])

  const sendInput = useCallback((sessionId: string, data: string) => {
    ws.current?.send(JSON.stringify({ type: 'terminal.input', payload: { sessionId, data } }))
  }, [])

  const sendResize = useCallback((sessionId: string, cols: number, rows: number) => {
    ws.current?.send(JSON.stringify({ type: 'terminal.resize', payload: { sessionId, cols, rows } }))
  }, [])

  return { subscribe, unsubscribe, sendInput, sendResize }
}
