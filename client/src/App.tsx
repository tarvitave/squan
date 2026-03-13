import { useEffect } from 'react'
import { TabBar } from './components/TabBar/index.js'
import { PaneGrid } from './components/PaneGrid/index.js'
import { AgentTree } from './components/AgentTree/index.js'
import { ConvoyPanel } from './components/ConvoyPanel/index.js'
import { EventStream } from './components/EventStream/index.js'
import { MayorPanel } from './components/MayorPanel/index.js'
import { RigPanel } from './components/RigPanel/index.js'
import { Footer } from './components/Footer/index.js'
import { AuthPage } from './components/AuthPage/index.js'
import { AccountPanel } from './components/AccountPanel/index.js'
import { KanbanView } from './components/KanbanView/index.js'
import { MetricsPanel } from './components/MetricsPanel/index.js'
import { BeadsPanel } from './components/BeadsPanel/index.js'
import { ToastContainer } from './components/Toast/index.js'
import { TownSelector } from './components/TownSelector/index.js'
import { useStore } from './store/index.js'
import { useWebSocket } from './hooks/useWebSocket.js'

export default function App() {
  const token = useStore((s) => s.token)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const mainView = useStore((s) => s.mainView)
  const setMainView = useStore((s) => s.setMainView)
  const setAgents = useStore((s) => s.setAgents)
  const setConvoys = useStore((s) => s.setConvoys)
  const setBeads = useStore((s) => s.setBeads)
  const setTemplates = useStore((s) => s.setTemplates)
  const addToast = useStore((s) => s.addToast)

  useWebSocket()

  useEffect(() => {
    if (!token) return
    fetch('/api/workerbees')
      .then((r) => r.json())
      .then((data: Array<{
        id: string; name: string; projectId: string; status: string;
        sessionId: string | null; taskDescription?: string;
        completionNote?: string; worktreePath?: string; branch?: string
      }>) =>
        setAgents(data.map((p) => ({
          id: p.id,
          name: p.name,
          projectId: p.projectId,
          status: p.status as 'idle' | 'working' | 'stalled' | 'zombie' | 'done',
          sessionId: p.sessionId,
          taskDescription: p.taskDescription ?? '',
          completionNote: p.completionNote ?? '',
          worktreePath: p.worktreePath ?? '',
          branch: p.branch ?? '',
        })))
      )
      .catch(() => addToast('Failed to load WorkerBees'))

    fetch('/api/convoys')
      .then((r) => r.json())
      .then(setConvoys)
      .catch(() => addToast('Failed to load Convoys'))

    fetch('/api/beads')
      .then((r) => r.json())
      .then(setBeads)
      .catch(() => addToast('Failed to load Beads'))

    fetch('/api/templates')
      .then((r) => r.json())
      .then(setTemplates)
      .catch(() => addToast('Failed to load Templates'))
  }, [token, setAgents, setConvoys, setBeads, setTemplates, addToast])

  if (!token) return <AuthPage />

  const activeTab = tabs.find((t) => t.id === activeTabId)

  return (
    <div style={styles.root}>
      <ToastContainer />
      {/* Left sidebar */}
      <div style={styles.sidebar}>
        <AccountPanel />
        <TownSelector />
        <div style={{ ...styles.sidebarSection, flex: 'none' }}>
          <div style={styles.sectionTitle}>Mayor Lee</div>
          <MayorPanel />
        </div>
        <div style={{ ...styles.sidebarSection, flex: 'none' }}>
          <div style={styles.sectionTitle}>Projects</div>
          <RigPanel />
        </div>
        <div style={styles.sidebarSection}>
          <div style={styles.sectionTitle}>WorkerBees</div>
          <AgentTree />
        </div>
        <div style={styles.sidebarSection}>
          <div style={styles.sectionTitle}>Convoys</div>
          <ConvoyPanel />
        </div>
        <div style={styles.sidebarSection}>
          <div style={styles.sectionTitle}>Beads</div>
          <BeadsPanel />
        </div>
        <div style={styles.sidebarSection}>
          <div style={styles.sectionTitle}>Events</div>
          <EventStream />
        </div>
        <Footer />
      </div>

      {/* Main content area */}
      <div style={styles.main}>
        {/* View switcher toolbar */}
        <div style={styles.toolbar}>
          <ViewBtn label="Terminals" view="terminals" active={mainView === 'terminals'} onClick={setMainView} />
          <ViewBtn label="Kanban" view="kanban" active={mainView === 'kanban'} onClick={setMainView} />
          <ViewBtn label="Metrics" view="metrics" active={mainView === 'metrics'} onClick={setMainView} />
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
        </div>
      </div>
    </div>
  )
}

function ViewBtn({
  label, view, active, onClick
}: {
  label: string
  view: 'terminals' | 'kanban' | 'metrics'
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
    width: 220,
    flexShrink: 0,
    borderRight: '1px solid #2d2d2d',
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
  noTab: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#888',
  },
}
