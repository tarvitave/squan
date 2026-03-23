import { useEffect, useRef, useState, Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { apiFetch } from './lib/api.js'
import { TabBar } from './components/TabBar/index.js'
import { PaneGrid } from './components/PaneGrid/index.js'
import { AgentTree } from './components/AgentTree/index.js'
import { EventStream } from './components/EventStream/index.js'
import { MayorPanel } from './components/MayorPanel/index.js'
import { RigPanel } from './components/RigPanel/index.js'
import { AuthPage } from './components/AuthPage/index.js'
import { AccountPanel } from './components/AccountPanel/index.js'
import { KanbanView } from './components/KanbanView/index.js'
import { ConsolePanel } from './components/ConsolePanel/index.js'
import { ClaudeCodePanel } from './components/ClaudeCodePanel/index.js'
import { MetricsPanel } from './components/MetricsPanel/index.js'
import { CostPanel } from './components/CostPanel/index.js'
import { ToastContainer } from './components/Toast/index.js'
import { TownSelector } from './components/TownSelector/index.js'
import { useStore } from './store/index.js'
import { useWebSocket } from './hooks/useWebSocket.js'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null }
  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error('React render error:', err, info)
    this.setState({ error: err.message })
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#f44747', fontFamily: 'monospace', fontSize: 12 }}>
          <div style={{ marginBottom: 8, color: '#888' }}>Render error — check browser console for details</div>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#f44747' }}>{this.state.error}</pre>
          <button
            style={{ marginTop: 12, background: 'none', border: '1px solid #444', color: '#888', padding: '4px 10px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}
            onClick={() => this.setState({ error: null })}
          >
            dismiss
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  const token = useStore((s) => s.token)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const mainView = useStore((s) => s.mainView)
  const setMainView = useStore((s) => s.setMainView)
  const setAgents = useStore((s) => s.setAgents)
  const setReleaseTrains = useStore((s) => s.setReleaseTrains)
  const setAtomicTasks = useStore((s) => s.setAtomicTasks)
  const setTemplates = useStore((s) => s.setTemplates)
  const addToast = useStore((s) => s.addToast)
  const clearAllPanes = useStore((s) => s.clearAllPanes)

  const activeTownId = useStore((s) => s.activeTownId)
  const { connected, serverRestarted, clearServerRestarted } = useWebSocket()

  const [budget, setBudget] = useState<{ percentUsed: number; blocked: boolean; spentLastHour: number; limitPerHour: number; unlimited: boolean } | null>(null)

  useEffect(() => {
    if (!token) return
    const check = () => apiFetch('/api/budget').then((r) => r.json()).then(setBudget).catch(() => {})
    check()
    const t = setInterval(check, 30000)
    return () => clearInterval(t)
  }, [token])

  const loadData = () => {
    apiFetch('/api/workerbees')
      .then((r) => r.json())
      .then((data: Array<{
        id: string; name: string; projectId: string; role?: string; status: string;
        sessionId: string | null; taskDescription?: string;
        completionNote?: string; worktreePath?: string; branch?: string
      }>) =>
        setAgents(data.map((p) => ({
          id: p.id,
          name: p.name,
          projectId: p.projectId,
          role: p.role ?? 'coder',
          status: p.status as 'idle' | 'working' | 'stalled' | 'zombie' | 'done',
          sessionId: p.sessionId,
          taskDescription: p.taskDescription ?? '',
          completionNote: p.completionNote ?? '',
          worktreePath: p.worktreePath ?? '',
          branch: p.branch ?? '',
        })))
      )
      .catch(() => {})

    apiFetch('/api/release-trains').then((r) => r.json()).then(setReleaseTrains).catch(() => {})
    apiFetch('/api/atomictasks').then((r) => r.json()).then(setAtomicTasks).catch(() => {})
    apiFetch('/api/templates').then((r) => r.json()).then(setTemplates).catch(() => {})
  }

  // Load on login and whenever the active town changes
  useEffect(() => {
    if (!token) return
    loadData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTownId])

  // Reload when server restarts (detected via boot ID change in WS ack)
  useEffect(() => {
    if (!token || !serverRestarted) return
    // Clear all terminal panes — all PTY sessions are lost on server restart
    clearAllPanes()
    clearServerRestarted()
    loadData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, serverRestarted])

  const [sidebarWidth, setSidebarWidth] = useState(240)
  const dragging = useRef(false)

  if (!token) return <AuthPage />

  const activeTab = tabs.find((t) => t.id === activeTabId)

  const handleDragStart = (e: React.MouseEvent) => {
    dragging.current = true
    const startX = e.clientX
    const startW = sidebarWidth
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      setSidebarWidth(Math.max(180, Math.min(600, startW + ev.clientX - startX)))
    }
    const onUp = () => {
      dragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div style={styles.root}>
      <ToastContainer />
      {!connected && (
        <div style={styles.offlineBanner}>⚠ reconnecting…</div>
      )}
      {budget && !budget.unlimited && budget.percentUsed >= 80 && (
        <div style={{
          ...styles.offlineBanner,
          background: budget.blocked ? '#4a1010' : '#3a2a00',
          color: budget.blocked ? '#f44747' : '#dcdcaa',
        }}>
          {budget.blocked
            ? `⛔ Hourly budget exceeded ($${budget.spentLastHour.toFixed(3)} / $${budget.limitPerHour}) — new agent dispatches are blocked`
            : `⚠ ${budget.percentUsed}% of hourly budget used ($${budget.spentLastHour.toFixed(3)} / $${budget.limitPerHour})`}
        </div>
      )}
      {/* Left sidebar */}
      <ErrorBoundary>
      <div style={{ ...styles.sidebar, width: sidebarWidth }}>
        <AccountPanel />
        <TownSelector />
        <div style={{ ...styles.sidebarSection, flex: 'none' }}>
          <div style={styles.sectionTitle}>Root Agent</div>
          <MayorPanel />
        </div>
        <div style={{ ...styles.sidebarSection, flex: 'none' }}>
          <div style={styles.sectionTitle}>Projects</div>
          <RigPanel />
        </div>
        <div style={styles.sidebarSection}>
          <div style={styles.sectionTitle}>Agents</div>
          <AgentTree />
        </div>
      </div>
      </ErrorBoundary>

      {/* Resize handle */}
      <div style={styles.resizeHandle} onMouseDown={handleDragStart} />

      {/* Main content area */}
      <div style={styles.main}>
        {/* View switcher toolbar */}
        <div style={styles.toolbar}>
          <ViewBtn label="Terminals" view="terminals" active={mainView === 'terminals'} onClick={setMainView} />
          <ViewBtn label="Kanban" view="kanban" active={mainView === 'kanban'} onClick={setMainView} />
          <ViewBtn label="Metrics" view="metrics" active={mainView === 'metrics'} onClick={setMainView} />
          <ViewBtn label="Events" view="events" active={mainView === 'events'} onClick={setMainView} />
          <ViewBtn label="Costs" view="costs" active={mainView === 'costs'} onClick={setMainView} />
          <ViewBtn label="Console" view="console" active={mainView === 'console'} onClick={setMainView} />
          <ViewBtn label="Claude Code" view="claudecode" active={mainView === 'claudecode'} onClick={setMainView} />
        </div>

        <div style={styles.content}>
          {mainView === 'terminals' && (
            <>
              <TabBar />
              {activeTab ? (
                <PaneGrid tab={activeTab} />
              ) : (
                <div style={styles.noTab}>No tab selected</div>
              )}
            </>
          )}

          {mainView === 'kanban' && <KanbanView />}

          {mainView === 'metrics' && <MetricsPanel />}

          {mainView === 'costs' && <CostPanel />}

          {mainView === 'events' && (
            <div style={styles.eventsPane}>
              <EventStream />
            </div>
          )}

          {mainView === 'console' && <ConsolePanel />}

          {mainView === 'claudecode' && <ClaudeCodePanel />}
        </div>
      </div>
    </div>
  )
}

function ViewBtn({
  label, view, active, onClick
}: {
  label: string
  view: 'terminals' | 'kanban' | 'metrics' | 'events' | 'costs' | 'console' | 'claudecode'
  active: boolean
  onClick: (v: typeof view) => void
}) {
  return (
    <button
      style={{
        ...styles.viewBtn,
        ...(active ? styles.viewBtnActive : {}),
      }}
      onClick={() => onClick(view)}
    >
      {label}
    </button>
  )
}

const styles = {
  root: {
    display: 'flex',
    width: '100%',
    height: '100%',
    background: '#0d0d0d',
    color: '#d4d4d4',
    fontFamily: 'monospace',
    overflow: 'hidden',
  },
  sidebar: {
    flexShrink: 0,
    borderRight: 'none',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  sidebarSection: {
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    minHeight: 80,
    borderBottom: '1px solid #2d2d2d',
    overflow: 'hidden',
  },
  sectionTitle: {
    padding: '6px 8px',
    fontSize: 10,
    fontWeight: 'bold' as const,
    color: '#569cd6',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
    background: '#111',
    borderBottom: '1px solid #2d2d2d',
    flexShrink: 0,
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  toolbar: {
    display: 'flex',
    gap: 1,
    background: '#0f0f0f',
    borderBottom: '1px solid #2d2d2d',
    padding: '4px 8px',
    flexShrink: 0,
  },
  viewBtn: {
    background: 'none',
    border: '1px solid transparent',
    color: '#555',
    borderRadius: 3,
    padding: '3px 10px',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  viewBtnActive: {
    color: '#d4d4d4',
    borderColor: '#2d2d2d',
    background: '#1a1a1a',
  },
  content: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  resizeHandle: {
    width: 4,
    flexShrink: 0,
    cursor: 'col-resize',
    background: 'transparent',
    borderRight: '1px solid #2d2d2d',
    transition: 'background 0.1s',
    ':hover': { background: '#569cd6' },
  },
  offlineBanner: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    background: '#5c3a1e',
    color: '#ce9178',
    fontSize: 11,
    fontFamily: 'monospace',
    textAlign: 'center' as const,
    padding: '3px 8px',
  },
  noTab: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#888',
  },
  eventsPane: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
  },
}
