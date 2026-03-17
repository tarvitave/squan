import { useEffect, useState, useCallback } from 'react'
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
    // If already open in some tab, switch to that tab
    const existingTab = tabs.find((t) => t.panes.includes(sessionId))
    if (existingTab) {
      setActiveTab(existingTab.id)
      return
    }
    // Otherwise add to current tab (or create one)
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
      // Open terminal so user can see Root Agent respond
      openMayorTerminal(mayor.sessionId)
    } finally {
      setSending(false)
    }
  }

  const isRunning = !!mayor?.sessionId

  return (
    <div style={styles.panel}>
      <div style={styles.row}>
        <span style={{ ...styles.dot, background: isRunning ? '#4ec9b0' : '#444' }} />
        <span style={styles.label}>
          Root Agent{activeNamespace ? <span style={styles.namespace}> · {activeNamespace.name}</span> : null}
        </span>
        <span style={{ ...styles.status, color: isRunning ? '#4ec9b0' : '#555' }}>
          {isRunning ? 'running' : 'stopped'}
        </span>
      </div>
      <div style={styles.buttons}>
        {!isRunning ? (
          <button style={styles.btn} onClick={handleStart} disabled={loading}>
            {loading ? '...' : '▶ Start'}
          </button>
        ) : (
          <>
            <button style={styles.btn} onClick={handleAttach}>
              ⬛ Attach
            </button>
            <button style={{ ...styles.btn, ...styles.btnDanger }} onClick={handleStop} disabled={loading}>
              {loading ? '...' : '■ Stop'}
            </button>
          </>
        )}
      </div>

      {isRunning && (
        <div style={styles.messageBox}>
          <textarea
            style={styles.messageInput}
            placeholder="Give Root Agent a task…"
            value={message}
            rows={3}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend()
            }}
          />
          <button
            style={styles.sendBtn}
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

const styles = {
  panel: {
    padding: '8px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  label: {
    fontSize: 12,
    color: '#d4d4d4',
    fontFamily: 'monospace',
    flex: 1,
  },
  namespace: {
    color: '#569cd6',
    fontSize: 11,
  },
  status: {
    fontSize: 10,
    fontFamily: 'monospace',
  },
  buttons: {
    display: 'flex',
    gap: 4,
  },
  btn: {
    flex: 1,
    background: '#1a1a1a',
    border: '1px solid #3a3a3a',
    color: '#4ec9b0',
    borderRadius: 3,
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  btnDanger: {
    color: '#f44747',
    borderColor: '#3a1a1a',
  },
  messageBox: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  messageInput: {
    background: '#1a1a1a',
    border: '1px solid #333',
    color: '#d4d4d4',
    borderRadius: 3,
    padding: '4px 6px',
    fontSize: 11,
    fontFamily: 'monospace',
    outline: 'none',
    resize: 'vertical' as const,
    lineHeight: 1.4,
  },
  sendBtn: {
    background: '#1a2a3a',
    border: '1px solid #569cd6',
    color: '#569cd6',
    borderRadius: 3,
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'monospace',
  },
}
