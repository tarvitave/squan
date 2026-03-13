import { useStore } from '../../store/index.js'
import type { ConvoyEntry } from '../../store/index.js'

const COLUMNS: Array<{ status: ConvoyEntry['status']; label: string; color: string }> = [
  { status: 'open', label: 'Open', color: '#569cd6' },
  { status: 'in_progress', label: 'In Progress', color: '#4ec9b0' },
  { status: 'landed', label: 'Landed', color: '#608b4e' },
  { status: 'cancelled', label: 'Cancelled', color: '#555' },
]

export function KanbanView() {
  const convoys = useStore((s) => s.convoys)
  const agents = useStore((s) => s.agents)
  const rigs = useStore((s) => s.rigs)
  const beads = useStore((s) => s.beads)
  const updateConvoy = useStore((s) => s.updateConvoy)
  const addAgent = useStore((s) => s.addAgent)
  const addPaneToTab = useStore((s) => s.addPaneToTab)
  const addTab = useStore((s) => s.addTab)
  const activeTabId = useStore((s) => s.activeTabId)
  const tabs = useStore((s) => s.tabs)

  const agentById = Object.fromEntries(agents.map((a) => [a.id, a]))
  const rigNameById = Object.fromEntries(rigs.map((r) => [r.id, r.name]))

  const convoyBeadCounts = Object.fromEntries(
    convoys.map((c) => [
      c.id,
      {
        total: beads.filter((b) => c.beadIds.includes(b.id) || b.convoyId === c.id).length,
        done: beads.filter((b) => (c.beadIds.includes(b.id) || b.convoyId === c.id) && b.status === 'done').length,
      },
    ])
  )

  const moveConvoy = async (convoyId: string, status: string) => {
    if (status === 'cancelled') {
      await fetch(`/api/convoys/${convoyId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      updateConvoy(convoyId, { status: 'cancelled' })
    } else {
      await fetch(`/api/convoys/${convoyId}/${status === 'landed' ? 'land' : 'assign'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(status === 'landed' ? {} : { workerBeeId: null }),
      })
      updateConvoy(convoyId, { status: status as ConvoyEntry['status'] })
    }
  }

  const dispatchConvoy = async (convoyId: string) => {
    const res = await fetch(`/api/convoys/${convoyId}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const { bee, convoy } = await res.json()
    if (bee) addAgent({ ...bee, taskDescription: bee.taskDescription ?? '', worktreePath: bee.worktreePath ?? '', branch: bee.branch ?? '' })
    if (convoy) updateConvoy(convoyId, { assignedWorkerBeeId: convoy.assignedWorkerBeeId, status: convoy.status })
    if (bee?.sessionId) {
      const hasSession = tabs.some((t: { panes: string[] }) => t.panes.includes(bee.sessionId))
      if (!hasSession) {
        if (activeTabId) addPaneToTab(activeTabId, bee.sessionId)
        else addTab(bee.name, [bee.sessionId])
      }
    }
  }

  const openBeeTerminal = (bee: { sessionId: string | null; name: string }) => {
    if (!bee.sessionId) return
    const hasSession = tabs.some((t: { panes: string[] }) => t.panes.includes(bee.sessionId!))
    if (!hasSession) {
      if (activeTabId) addPaneToTab(activeTabId, bee.sessionId)
      else addTab(bee.name, [bee.sessionId])
    }
  }

  return (
    <div style={styles.board}>
      {COLUMNS.map((col) => {
        const cards = convoys.filter((c) => c.status === col.status)
        return (
          <div key={col.status} style={styles.column}>
            <div style={styles.colHeader}>
              <span style={{ ...styles.colTitle, color: col.color }}>{col.label}</span>
              <span style={styles.colCount}>{cards.length}</span>
            </div>
            <div style={styles.cards}>
              {cards.map((convoy) => {
                const assignedBee = convoy.assignedWorkerBeeId ? agentById[convoy.assignedWorkerBeeId] : null
                const counts = convoyBeadCounts[convoy.id] ?? { total: 0, done: 0 }
                return (
                  <div key={convoy.id} style={styles.card}>
                    <div style={styles.cardTitle}>{convoy.name}</div>

                    {convoy.description && (
                      <div style={styles.cardDesc}>{convoy.description}</div>
                    )}

                    <div style={styles.cardMeta}>
                      <span style={styles.cardRig}>{rigNameById[convoy.projectId] ?? convoy.projectId.slice(0, 8)}</span>
                      {counts.total > 0 && (
                        <span style={styles.cardBeads}>
                          {counts.done}/{counts.total} beads
                        </span>
                      )}
                    </div>

                    {assignedBee && (
                      <div
                        style={styles.cardBee}
                        onClick={() => openBeeTerminal(assignedBee)}
                        title="Click to open terminal"
                      >
                        <span style={{ color: STATUS_COLOR[assignedBee.status] }}>●</span>
                        <span style={styles.beeName}>{assignedBee.name}</span>
                        <span style={{ ...styles.beeStatus, color: STATUS_COLOR[assignedBee.status] }}>
                          {assignedBee.status}
                        </span>
                      </div>
                    )}

                    <div style={styles.cardActions}>
                      {col.status === 'open' && (
                        <button
                          style={styles.actionBtn}
                          onClick={() => dispatchConvoy(convoy.id)}
                        >
                          dispatch
                        </button>
                      )}
                      {col.status === 'in_progress' && (
                        <button
                          style={{ ...styles.actionBtn, color: '#608b4e', borderColor: '#608b4e' }}
                          onClick={() => moveConvoy(convoy.id, 'landed')}
                        >
                          land
                        </button>
                      )}
                      {col.status !== 'open' && col.status !== 'cancelled' && (
                        <button
                          style={{ ...styles.actionBtn, color: '#555' }}
                          onClick={() => moveConvoy(convoy.id, 'cancelled')}
                        >
                          cancel
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              {cards.length === 0 && (
                <div style={styles.emptyCol}>no {col.label.toLowerCase()} convoys</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const STATUS_COLOR: Record<string, string> = {
  idle: '#666',
  working: '#4ec9b0',
  stalled: '#ce9178',
  zombie: '#f44747',
  done: '#608b4e',
}

const styles = {
  board: {
    display: 'flex',
    gap: 1,
    height: '100%',
    overflow: 'hidden',
    background: '#0d0d0d',
  },
  column: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    borderRight: '1px solid #1e1e1e',
    overflow: 'hidden',
  },
  colHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px 8px',
    borderBottom: '1px solid #1e1e1e',
    background: '#0f0f0f',
    flexShrink: 0,
  },
  colTitle: {
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: 'bold' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
  },
  colCount: {
    fontSize: 10,
    color: '#444',
    fontFamily: 'monospace',
  },
  cards: {
    flex: 1,
    overflow: 'auto',
    padding: '8px 6px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  card: {
    background: '#131313',
    border: '1px solid #1e1e1e',
    borderRadius: 4,
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  cardTitle: {
    fontSize: 12,
    color: '#d4d4d4',
    fontFamily: 'monospace',
    lineHeight: 1.3,
  },
  cardDesc: {
    fontSize: 10,
    color: '#666',
    fontFamily: 'monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  cardMeta: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  cardRig: {
    fontSize: 10,
    color: '#569cd6',
    fontFamily: 'monospace',
  },
  cardBeads: {
    fontSize: 10,
    color: '#555',
    fontFamily: 'monospace',
  },
  cardBee: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    cursor: 'pointer',
    padding: '2px 0',
  },
  beeName: {
    fontSize: 10,
    color: '#d4d4d4',
    fontFamily: 'monospace',
    flex: 1,
  },
  beeStatus: {
    fontSize: 10,
    fontFamily: 'monospace',
  },
  cardActions: {
    display: 'flex',
    gap: 4,
    marginTop: 2,
  },
  actionBtn: {
    background: 'none',
    border: '1px solid #2a2a2a',
    color: '#569cd6',
    borderRadius: 3,
    padding: '2px 8px',
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  emptyCol: {
    color: '#333',
    fontSize: 10,
    fontFamily: 'monospace',
    textAlign: 'center' as const,
    padding: '16px 0',
  },
}
