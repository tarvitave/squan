import { useEffect, useState, useCallback } from 'react'
import { Zap } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import { useStore } from '../../store/index.js'
import { apiFetch } from '../../lib/api.js'

interface MayorState {
  id: string
  sessionId: string | null
  status: string
}

export function MayorPanel() {
  const [mayor, setMayor] = useState<MayorState | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const activeTabId = useStore((s) => s.activeTabId)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const setMainView = useStore((s) => s.setMainView)
  const addPaneToTab = useStore((s) => s.addPaneToTab)
  const addTab = useStore((s) => s.addTab)
  const tabs = useStore((s) => s.tabs)
  const activeTownId = useStore((s) => s.activeTownId)
  const towns = useStore((s) => s.towns)
  const activeNamespace = towns.find((t) => t.id === activeTownId)

  const fetchMayor = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/mayor?townId=${encodeURIComponent(activeTownId ?? 'default')}`)
      if (res.ok) setMayor(await res.json())
      else setMayor(null)
    } catch { /* server not ready yet */ }
  }, [activeTownId])

  useEffect(() => {
    fetchMayor()
    const interval = setInterval(fetchMayor, 5000)
    return () => clearInterval(interval)
  }, [fetchMayor])

  const openMayorTerminal = useCallback((sessionId: string) => {
    setMainView('terminals')
    const existingTab = tabs.find((t) => t.panes.includes(sessionId))
    if (existingTab) {
      setActiveTab(existingTab.id)
      return
    }
    if (activeTabId) {
      addPaneToTab(activeTabId, sessionId)
    } else {
      addTab('Root Agent', [sessionId])
    }
  }, [tabs, activeTabId, setMainView, setActiveTab, addPaneToTab, addTab])

  const handleStart = async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/mayor/start', {
        method: 'POST',
        body: JSON.stringify({ townId: activeTownId ?? 'default' }),
      })
      const data = await res.json()
      setMayor(data)
      if (data.sessionId) openMayorTerminal(data.sessionId)
    } finally {
      setLoading(false)
    }
  }

  const handleStop = async () => {
    setLoading(true)
    try {
      await apiFetch('/api/mayor/stop', {
        method: 'POST',
        body: JSON.stringify({ townId: activeTownId ?? 'default' }),
      })
      await fetchMayor()
    } finally {
      setLoading(false)
    }
  }

  const handleAttach = () => {
    if (mayor?.sessionId) openMayorTerminal(mayor.sessionId)
  }

  const handleSend = async () => {
    if (!message.trim() || !mayor?.sessionId) return
    setSending(true)
    try {
      await apiFetch('/api/mayor/message', {
        method: 'POST',
        body: JSON.stringify({ townId: activeTownId ?? 'default', message: message.trim() }),
      })
      setMessage('')
      openMayorTerminal(mayor.sessionId)
    } finally {
      setSending(false)
    }
  }

  const isRunning = !!mayor?.sessionId

  return (
    <div className="p-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <Zap className={cn('w-3 h-3 shrink-0', isRunning ? 'text-block-teal' : 'text-text-disabled')} />
        <span className="text-xs font-mono text-text-primary flex-1">
          Root Agent{activeNamespace ? <span className="text-text-info text-[11px]"> · {activeNamespace.name}</span> : null}
        </span>
        <span className={cn('text-[10px] font-mono', isRunning ? 'text-block-teal' : 'text-text-tertiary')}>
          {isRunning ? 'running' : 'stopped'}
        </span>
      </div>
      <div className="flex gap-1">
        {!isRunning ? (
          <button
            className="flex-1 bg-bg-secondary border border-border-primary text-block-teal rounded-sm px-2 py-1 cursor-pointer text-[11px] font-mono hover:bg-bg-hover disabled:opacity-50"
            onClick={handleStart}
            disabled={loading}
          >
            {loading ? '...' : '▶ Start'}
          </button>
        ) : (
          <>
            <button
              className="flex-1 bg-bg-secondary border border-border-primary text-block-teal rounded-sm px-2 py-1 cursor-pointer text-[11px] font-mono hover:bg-bg-hover"
              onClick={handleAttach}
            >
              ⬛ Attach
            </button>
            <button
              className="flex-1 bg-bg-secondary border border-red-200/30 text-text-danger rounded-sm px-2 py-1 cursor-pointer text-[11px] font-mono hover:bg-bg-hover disabled:opacity-50"
              onClick={handleStop}
              disabled={loading}
            >
              {loading ? '...' : '■ Stop'}
            </button>
          </>
        )}
      </div>

      {isRunning && (
        <div className="flex flex-col gap-1">
          <textarea
            className="bg-bg-secondary border border-border-primary text-text-primary rounded-sm px-1.5 py-1 text-[11px] font-mono outline-none resize-y leading-snug"
            placeholder="Give Root Agent a task…"
            value={message}
            rows={3}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend()
            }}
          />
          <button
            className="bg-blue-200/10 border border-blue-200/30 text-text-info rounded-sm px-2 py-1 cursor-pointer text-[11px] font-mono hover:bg-bg-hover disabled:opacity-50"
            onClick={handleSend}
            disabled={sending || !message.trim()}
          >
            {sending ? '…' : '↵ Send'}
          </button>
        </div>
      )}
    </div>
  )
}
