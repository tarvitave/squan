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
import { useStore } from './store/index.js'
import { useWebSocket } from './hooks/useWebSocket.js'
import { apiFetch } from './lib/api.js'

export default function App() {
  const token = useStore((s) => s.token)
  const user = useStore((s) => s.user)
  const clearAuth = useStore((s) => s.clearAuth)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const setAgents = useStore((s) => s.setAgents)
  const setConvoys = useStore((s) => s.setConvoys)

  useWebSocket()

  useEffect(() => {
    if (!token) return
    apiFetch('/api/workerbees')
      .then((r) => r.json())
      .then((data) =>
        setAgents(
          data.map((p: { id: string; name: string; projectId: string; status: string; sessionId: string | null }) => ({
            id: p.id,
            name: p.name,
            projectId: p.projectId,
            status: p.status,
            sessionId: p.sessionId,
          }))
        )
      )
      .catch(() => {})

    apiFetch('/api/convoys')
      .then((r) => r.json())
      .then(setConvoys)
      .catch(() => {})
  }, [token, setAgents, setConvoys])

  if (!token) return <AuthPage />

  const activeTab = tabs.find((t) => t.id === activeTabId)

  return (
    <div style={styles.root}>
      {/* Left sidebar */}
      <div style={styles.sidebar}>
        <div style={styles.versionBar}>
          <span style={styles.appName}>squansq</span>
          <div style={styles.versionRight}>
            <span style={styles.version}>v{__APP_VERSION__}</span>
            <button style={styles.signOutBtn} onClick={clearAuth} title={`Signed in as ${user?.email}`}>
              Sign out
            </button>
          </div>
        </div>
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
          <div style={styles.sectionTitle}>Events</div>
          <EventStream />
        </div>
        <Footer />
      </div>

      {/* Main content area */}
      <div style={styles.main}>
        <TabBar />
        <div style={styles.content}>
          {activeTab ? (
            <PaneGrid tab={activeTab} />
          ) : (
            <div style={styles.noTab}>No tab selected</div>
          )}
        </div>
      </div>
    </div>
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
  versionBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 8px',
    background: '#0a0a0a',
    borderBottom: '1px solid #2d2d2d',
    flexShrink: 0,
  },
  appName: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#4ec9b0',
    fontWeight: 'bold' as const,
    letterSpacing: '0.05em',
  },
  versionRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  version: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#444',
  },
  signOutBtn: {
    background: 'none',
    border: '1px solid #333',
    color: '#666',
    cursor: 'pointer',
    fontSize: 10,
    padding: '2px 6px',
    lineHeight: 1,
    borderRadius: 3,
    fontFamily: 'monospace',
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
