import { useStore } from '../../store/index.js'
import type { Agent } from '../../store/index.js'
import { useStore as useAppStore } from '../../store/index.js'

const STATUS_COLOR: Record<Agent['status'], string> = {
  idle: '#666',
  working: '#4ec9b0',
  stalled: '#ce9178',
  zombie: '#f44747',
  done: '#608b4e',
}

const STATUS_ICON: Record<Agent['status'], string> = {
  idle: '○',
  working: '●',
  stalled: '◐',
  zombie: '✕',
  done: '✓',
}

export function AgentTree() {
  const agents = useStore((s) => s.agents)
  const addPaneToTab = useAppStore((s) => s.addPaneToTab)
  const activeTabId = useAppStore((s) => s.activeTabId)

  // Group by rig
  const byRig = agents.reduce<Record<string, Agent[]>>((acc, a) => {
    ;(acc[a.rigId] ??= []).push(a)
    return acc
  }, {})

  if (agents.length === 0) {
    return (
      <div style={styles.empty}>
        <span style={styles.emptyText}>No agents</span>
      </div>
    )
  }

  return (
    <div style={styles.tree}>
      {Object.entries(byRig).map(([rigId, rigAgents]) => (
        <div key={rigId}>
          <div style={styles.rigHeader}>{rigId}</div>
          {rigAgents.map((agent) => (
            <div
              key={agent.id}
              style={styles.agentRow}
              onClick={() => {
                if (agent.sessionId && activeTabId) {
                  addPaneToTab(activeTabId, agent.sessionId)
                }
              }}
              title={agent.sessionId ? 'Click to open terminal' : undefined}
            >
              <span style={{ ...styles.statusDot, color: STATUS_COLOR[agent.status] }}>
                {STATUS_ICON[agent.status]}
              </span>
              <span style={styles.agentName}>{agent.name}</span>
              <span style={{ ...styles.agentStatus, color: STATUS_COLOR[agent.status] }}>
                {agent.status}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

const styles = {
  tree: {
    overflow: 'auto',
    flex: 1,
  },
  rigHeader: {
    padding: '4px 8px',
    fontSize: 10,
    color: '#569cd6',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
    borderBottom: '1px solid #1e1e1e',
  },
  agentRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 12px',
    cursor: 'pointer',
    '&:hover': { background: '#1a1a1a' },
  },
  statusDot: {
    fontSize: 10,
    width: 12,
    textAlign: 'center' as const,
  },
  agentName: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#d4d4d4',
    flex: 1,
  },
  agentStatus: {
    fontSize: 10,
    fontFamily: 'monospace',
  },
  empty: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#444',
    fontSize: 12,
    fontFamily: 'monospace',
  },
}
