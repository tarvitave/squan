import { useEffect, useState, useCallback } from 'react'
import { useStore } from '../../store/index.js'

interface MayorState {
  id: string
  sessionId: string | null
  status: string
}

export function MayorPanel() {
  const [mayor, setMayor] = useState<MayorState | null>(null)
  const [loading, setLoading] = useState(false)
  const activeTabId = useStore((s) => s.activeTabId)
  const addPaneToTab = useStore((s) => s.addPaneToTab)
  const addTab = useStore((s) => s.addTab)
  const tabs = useStore((s) => s.tabs)

  const fetchMayor = useCallback(async () => {
    try {
      const res = await fetch('/api/mayor')
      if (res.ok) setMayor(await res.json())
    } catch { /* server not ready yet */ }
  }, [])

  useEffect(() => {
    fetchMayor()
    const interval = setInterval(fetchMayor, 5000)
    return () => clearInterval(interval)
  }, [fetchMayor])

  const openMayorTerminal = useCallback((sessionId: string) => {
    // Find if any tab already has this session
    const hasSession = tabs.some((t) => t.panes.includes(sessionId))
    if (hasSession) return

    if (activeTabId) {
      addPaneToTab(activeTabId, sessionId)
    } else {
      addTab('Mayor', [sessionId])
    }
  }, [tabs, activeTabId, addPaneToTab, addTab])

  const handleStart = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/mayor/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ townId: 'default' }),
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
      await fetch('/api/mayor/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ townId: 'default' }),
      })
      await fetchMayor()
    } finally {
      setLoading(false)
    }
  }

  const handleAttach = () => {
    if (mayor?.sessionId) openMayorTerminal(mayor.sessionId)
  }

  const isRunning = !!mayor?.sessionId

  return (
    <div style={styles.panel}>
      <div style={styles.row}>
        <span style={{ ...styles.dot, background: isRunning ? '#4ec9b0' : '#444' }} />
        <span style={styles.label}>Mayor</span>
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
}
