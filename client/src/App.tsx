import { useEffect } from 'react'
import { TabBar } from './components/TabBar/index.js'
import { PaneGrid } from './components/PaneGrid/index.js'
import { AgentTree } from './components/AgentTree/index.js'
import { ConvoyPanel } from './components/ConvoyPanel/index.js'
import { EventStream } from './components/EventStream/index.js'
import { useStore } from './store/index.js'
import { useWebSocket } from './hooks/useWebSocket.js'

export default function App() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const setAgents = useStore((s) => s.setAgents)
  const setConvoys = useStore((s) => s.setConvoys)

  // Establish WebSocket connection
  useWebSocket()

  // Initial data load
  useEffect(() => {
    fetch('/api/polecats')
      .then((r) => r.json())
      .then((data) =>
        setAgents(
          data.map((p: { id: string; name: string; rigId: string; status: string; sessionId: string | null }) => ({
            id: p.id,
            name: p.name,
            rigId: p.rigId,
            status: p.status,
            sessionId: p.sessionId,
          }))
        )
      )
      .catch(() => {})

    fetch('/api/convoys')
      .then((r) => r.json())
      .then(setConvoys)
      .catch(() => {})
  }, [setAgents, setConvoys])

  const activeTab = tabs.find((t) => t.id === activeTabId)

  return (
    <div style={styles.root}>
      {/* Left sidebar */}
      <div style={styles.sidebar}>
        <div style={styles.sidebarSection}>
          <div style={styles.sectionTitle}>Agents</div>
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
