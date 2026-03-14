import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'
import type { ReleaseTrainEntry } from '../../store/index.js'

const COLUMNS: Array<{ status: ReleaseTrainEntry['status']; label: string; color: string }> = [
  { status: 'open', label: 'Open', color: '#569cd6' },
  { status: 'in_progress', label: 'In Progress', color: '#4ec9b0' },
  { status: 'landed', label: 'Landed', color: '#608b4e' },
  { status: 'cancelled', label: 'Cancelled', color: '#555' },
]

export function KanbanView() {
  const releaseTrains = useStore((s) => s.releaseTrains)
  const agents = useStore((s) => s.agents)
  const rigs = useStore((s) => s.rigs)
  const atomicTasks = useStore((s) => s.atomicTasks)
  const updateReleaseTrain = useStore((s) => s.updateReleaseTrain)
  const addAgent = useStore((s) => s.addAgent)
  const addPaneToTab = useStore((s) => s.addPaneToTab)
  const addTab = useStore((s) => s.addTab)
  const activeTabId = useStore((s) => s.activeTabId)
  const tabs = useStore((s) => s.tabs)

  const agentById = Object.fromEntries(agents.map((a) => [a.id, a]))
  const rigNameById = Object.fromEntries(rigs.map((r) => [r.id, r.name]))

  const releaseTrainAtomicTaskCounts = Object.fromEntries(
    releaseTrains.map((c) => [
      c.id,
      {
        total: atomicTasks.filter((b) => c.atomicTaskIds.includes(b.id) || b.releaseTrainId === c.id).length,
        done: atomicTasks.filter((b) => (c.atomicTaskIds.includes(b.id) || b.releaseTrainId === c.id) && b.status === 'done').length,
      },
    ])
  )

  const moveReleaseTrain = async (releaseTrainId: string, status: string) => {
    if (status === 'cancelled') {
      await apiFetch(`/api/release-trains/${releaseTrainId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      updateReleaseTrain(releaseTrainId, { status: 'cancelled' })
    } else {
      await apiFetch(`/api/release-trains/${releaseTrainId}/${status === 'landed' ? 'land' : 'assign'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(status === 'landed' ? {} : { workerBeeId: null }),
      })
      updateReleaseTrain(releaseTrainId, { status: status as ReleaseTrainEntry['status'] })
    }
  }

  const dispatchReleaseTrain = async (releaseTrainId: string) => {
    const res = await apiFetch(`/api/release-trains/${releaseTrainId}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const data = await res.json()
    const bee = data.bee
    const releaseTrain = data.releaseTrain
    if (bee) addAgent({ ...bee, taskDescription: bee.taskDescription ?? '', worktreePath: bee.worktreePath ?? '', branch: bee.branch ?? '' })
    if (releaseTrain) updateReleaseTrain(releaseTrainId, { assignedWorkerBeeId: releaseTrain.assignedWorkerBeeId, status: releaseTrain.status })
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
        const cards = releaseTrains.filter((c) => c.status === col.status)
        return (
          <div key={col.status} style={styles.column}>
            <div style={styles.colHeader}>
              <span style={{ ...styles.colTitle, color: col.color }}>{col.label}</span>
              <span style={styles.colCount}>{cards.length}</span>
            </div>
            <div style={styles.cards}>
              {cards.map((releaseTrain) => {
                const assignedBee = releaseTrain.assignedWorkerBeeId ? agentById[releaseTrain.assignedWorkerBeeId] : null
                const counts = releaseTrainAtomicTaskCounts[releaseTrain.id] ?? { total: 0, done: 0 }
                return (
                  <div key={releaseTrain.id} style={styles.card}>
                    <div style={styles.cardTitle}>{releaseTrain.name}</div>

                    {releaseTrain.description && (
                      <div style={styles.cardDesc}>{releaseTrain.description}</div>
                    )}

                    <div style={styles.cardMeta}>
                      <span style={styles.cardRig}>{rigNameById[releaseTrain.projectId] ?? releaseTrain.projectId.slice(0, 8)}</span>
                      {counts.total > 0 && (
                        <span style={styles.cardBeads}>
                          {counts.done}/{counts.total} tasks
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
                          onClick={() => dispatchReleaseTrain(releaseTrain.id)}
                        >
                          dispatch
                        </button>
                      )}
                      {col.status === 'in_progress' && (
                        <button
                          style={{ ...styles.actionBtn, color: '#608b4e', borderColor: '#608b4e' }}
                          onClick={() => moveReleaseTrain(releaseTrain.id, 'landed')}
                        >
                          land
                        </button>
                      )}
                      {col.status !== 'open' && col.status !== 'cancelled' && (
                        <button
                          style={{ ...styles.actionBtn, color: '#555' }}
                          onClick={() => moveReleaseTrain(releaseTrain.id, 'cancelled')}
                        >
                          cancel
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              {cards.length === 0 && (
                <div style={styles.emptyCol}>no {col.label.toLowerCase()} release trains</div>
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
