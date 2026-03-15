import { useState, useEffect } from 'react'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'
import type { Agent } from '../../store/index.js'

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

interface Snapshot { id: string; capturedAt: string }
interface ReplayFrame { id: string; frameAt: string }

export function AgentTree() {
  const agents = useStore((s) => s.agents)
  const rigs = useStore((s) => s.rigs)
  const addPaneToTab = useStore((s) => s.addPaneToTab)
  const addTab = useStore((s) => s.addTab)
  const activeTabId = useStore((s) => s.activeTabId)
  const tabs = useStore((s) => s.tabs)
  const updateAgent = useStore((s) => s.updateAgent)
  const removeAgent = useStore((s) => s.removeAgent)
  const selectedAgentId = useStore((s) => s.selectedAgentId)
  const setSelectedAgent = useStore((s) => s.setSelectedAgent)
  const addToast = useStore((s) => s.addToast)

  const rigNameById = Object.fromEntries(rigs.map((r) => [r.id, r.name]))
  const byProject = agents.reduce<Record<string, Agent[]>>((acc, a) => {
    ;(acc[a.projectId] ??= []).push(a)
    return acc
  }, {})

  const handleOpenTerminal = (agent: Agent) => {
    if (!agent.sessionId) return
    const hasSession = tabs.some((t) => t.panes.includes(agent.sessionId!))
    if (!hasSession) {
      if (activeTabId) addPaneToTab(activeTabId, agent.sessionId)
      else addTab(agent.name, [agent.sessionId])
    }
  }

  const handleKill = async (id: string) => {
    try {
      await apiFetch(`/api/workerbees/${id}`, { method: 'DELETE' })
      removeAgent(id)
      if (selectedAgentId === id) setSelectedAgent(null)
    } catch (err) {
      addToast(`Failed to kill WorkerBee: ${(err as Error).message}`)
    }
  }

  const handleClearFinished = async () => {
    const finished = agents.filter((a) => a.status === 'zombie' || a.status === 'done')
    await Promise.allSettled(
      finished.map((a) =>
        apiFetch(`/api/workerbees/${a.id}`, { method: 'DELETE' })
          .then(() => {
            removeAgent(a.id)
            if (selectedAgentId === a.id) setSelectedAgent(null)
          })
      )
    )
  }

  if (agents.length === 0) {
    return (
      <div style={styles.empty}>
        <span style={styles.emptyText}>No WorkerBees</span>
      </div>
    )
  }

  const hasFinished = agents.some((a) => a.status === 'zombie' || a.status === 'done')

  return (
    <div style={styles.tree}>
      {hasFinished && (
        <div style={styles.clearRow}>
          <button style={styles.clearBtn} onClick={handleClearFinished}>clear done/zombie</button>
        </div>
      )}
      {Object.entries(byProject).map(([projectId, projectAgents]) => (
        <div key={projectId}>
          <div style={styles.rigHeader}>{rigNameById[projectId] ?? projectId}</div>
          {projectAgents.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              expanded={selectedAgentId === agent.id}
              onToggle={() => setSelectedAgent(selectedAgentId === agent.id ? null : agent.id)}
              onOpenTerminal={() => handleOpenTerminal(agent)}
              onKill={() => handleKill(agent.id)}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function AgentRow({
  agent, expanded, onToggle, onOpenTerminal, onKill,
}: {
  agent: Agent
  expanded: boolean
  onToggle: () => void
  onOpenTerminal: () => void
  onKill: () => void
}) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [frames, setFrames] = useState<ReplayFrame[]>([])
  const [viewContent, setViewContent] = useState<{ title: string; text: string } | null>(null)
  const [replayIdx, setReplayIdx] = useState(0)

  useEffect(() => {
    if (!expanded) return
    apiFetch(`/api/workerbees/${agent.id}/snapshots`).then((r) => r.json()).then(setSnapshots).catch(() => {})
    apiFetch(`/api/workerbees/${agent.id}/replay`).then((r) => r.json()).then((f) => { setFrames(f); setReplayIdx(f.length - 1) }).catch(() => {})
  }, [expanded, agent.id])

  const viewSnapshot = async (id: string, label: string) => {
    const { content } = await apiFetch(`/api/snapshots/${id}/content`).then((r) => r.json())
    setViewContent({ title: label, text: content })
  }

  const viewFrame = async (id: string, label: string) => {
    const { content } = await apiFetch(`/api/replay/${id}/content`).then((r) => r.json())
    setViewContent({ title: label, text: content })
  }

  return (
    <>
      <div style={styles.agentRow}>
        <span
          style={{ ...styles.statusDot, color: STATUS_COLOR[agent.status] }}
          onClick={onOpenTerminal}
          title={agent.sessionId ? 'Open terminal' : undefined}
        >
          {STATUS_ICON[agent.status]}
        </span>
        <span style={styles.agentName} onClick={onToggle}>{agent.name}</span>
        <span style={{ ...styles.agentStatus, color: STATUS_COLOR[agent.status] }}>{agent.status}</span>
        {agent.sessionId && agent.status !== 'zombie' && agent.status !== 'done' && (
          <button style={styles.termBtn} onClick={onOpenTerminal} title="Open terminal">⬡</button>
        )}
        {agent.status !== 'done' && agent.status !== 'zombie' && (
          <button style={styles.killBtn} onClick={onKill} title="Kill agent">✕</button>
        )}
        {(agent.status === 'zombie' || agent.status === 'done') && (
          <button style={styles.killBtn} onClick={onKill} title="Remove">✕</button>
        )}
      </div>

      {expanded && (
        <div style={styles.detail}>
          {/* Task */}
          {agent.taskDescription && (
            <div style={styles.detailSection}>
              <div style={styles.detailLabel}>task</div>
              <div style={styles.detailText}>{agent.taskDescription}</div>
            </div>
          )}

          {/* Completion note */}
          {agent.completionNote && (
            <div style={styles.detailSection}>
              <div style={styles.detailLabel}>
                {agent.status === 'done' ? 'done' : 'blocked'}
              </div>
              <div style={{ ...styles.detailText, color: agent.status === 'done' ? '#608b4e' : '#ce9178' }}>
                {agent.completionNote}
              </div>
            </div>
          )}

          {/* Branch / worktree */}
          <div style={styles.detailSection}>
            <div style={styles.detailLabel}>branch</div>
            <div style={{ ...styles.detailText, color: '#569cd6' }}>{agent.branch || '—'}</div>
          </div>
          {agent.worktreePath && (
            <div style={styles.detailSection}>
              <div style={styles.detailLabel}>worktree</div>
              <div style={{ ...styles.detailText, color: '#555', fontSize: 9 }}>{agent.worktreePath}</div>
            </div>
          )}

          {/* Snapshots */}
          {snapshots.length > 0 && (
            <div style={styles.detailSection}>
              <div style={styles.detailLabel}>snapshots</div>
              <div style={styles.itemList}>
                {snapshots.slice(0, 5).map((s) => (
                  <button
                    key={s.id}
                    style={styles.itemBtn}
                    onClick={() => viewSnapshot(s.id, new Date(s.capturedAt).toLocaleTimeString())}
                  >
                    {new Date(s.capturedAt).toLocaleTimeString([], { hour12: false })}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Session Replay */}
          {frames.length > 0 && (
            <div style={styles.detailSection}>
              <div style={styles.detailLabel}>replay ({frames.length} frames)</div>
              <div style={styles.replayControls}>
                <button style={styles.replayBtn} onClick={() => setReplayIdx(0)} disabled={replayIdx === 0}>⏮</button>
                <button style={styles.replayBtn} onClick={() => setReplayIdx((i) => Math.max(0, i - 1))} disabled={replayIdx === 0}>◀</button>
                <span style={styles.replayPos}>{replayIdx + 1}/{frames.length}</span>
                <button style={styles.replayBtn} onClick={() => setReplayIdx((i) => Math.min(frames.length - 1, i + 1))} disabled={replayIdx === frames.length - 1}>▶</button>
                <button style={styles.replayBtn} onClick={() => setReplayIdx(frames.length - 1)} disabled={replayIdx === frames.length - 1}>⏭</button>
                <button
                  style={{ ...styles.replayBtn, color: '#4ec9b0' }}
                  onClick={() => {
                    const f = frames[replayIdx]
                    if (f) viewFrame(f.id, `Frame ${replayIdx + 1} — ${new Date(f.frameAt).toLocaleTimeString([], { hour12: false })}`)
                  }}
                >
                  view
                </button>
              </div>
              <div style={styles.replayTs}>
                {new Date(frames[replayIdx]?.frameAt ?? '').toLocaleTimeString([], { hour12: false })}
              </div>
            </div>
          )}

          {/* Content viewer */}
          {viewContent && (
            <div style={styles.contentViewer}>
              <div style={styles.contentHeader}>
                <span style={styles.contentTitle}>{viewContent.title}</span>
                <button style={styles.closeBtn} onClick={() => setViewContent(null)}>✕</button>
              </div>
              <pre style={styles.contentPre}>{viewContent.text}</pre>
            </div>
          )}
        </div>
      )}
    </>
  )
}

const styles = {
  tree: { overflow: 'auto', flex: 1 },
  rigHeader: {
    padding: '4px 8px', fontSize: 10, color: '#569cd6',
    textTransform: 'uppercase' as const, letterSpacing: '0.1em',
    borderBottom: '1px solid #1e1e1e',
  },
  agentRow: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '4px 8px', cursor: 'default',
  },
  statusDot: { fontSize: 10, width: 12, textAlign: 'center' as const, cursor: 'pointer', flexShrink: 0 },
  agentName: {
    fontSize: 12, fontFamily: 'monospace', color: '#d4d4d4', flex: 1,
    cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  agentStatus: { fontSize: 10, fontFamily: 'monospace', flexShrink: 0 },
  termBtn: {
    background: 'none', border: 'none', color: '#444', cursor: 'pointer',
    fontSize: 12, padding: '0 2px', flexShrink: 0,
  },
  killBtn: {
    background: 'none', border: 'none', color: '#3a2020', cursor: 'pointer',
    fontSize: 10, padding: '0 2px', flexShrink: 0,
    ':hover': { color: '#f44747' },
  },
  detail: {
    background: '#0c0c0c', borderBottom: '1px solid #1a1a1a',
    padding: '6px 8px 8px', display: 'flex', flexDirection: 'column' as const, gap: 6,
  },
  detailSection: { display: 'flex', flexDirection: 'column' as const, gap: 2 },
  detailLabel: {
    fontSize: 9, color: '#444', fontFamily: 'monospace',
    textTransform: 'uppercase' as const, letterSpacing: '0.08em',
  },
  detailText: { fontSize: 10, color: '#888', fontFamily: 'monospace', wordBreak: 'break-all' as const },
  itemList: { display: 'flex', flexWrap: 'wrap' as const, gap: 3 },
  itemBtn: {
    background: 'none', border: '1px solid #1e1e1e', color: '#555',
    borderRadius: 3, padding: '1px 5px', cursor: 'pointer',
    fontSize: 9, fontFamily: 'monospace',
  },
  replayControls: { display: 'flex', alignItems: 'center', gap: 3 },
  replayBtn: {
    background: 'none', border: '1px solid #1e1e1e', color: '#555',
    borderRadius: 2, padding: '1px 4px', cursor: 'pointer',
    fontSize: 9, fontFamily: 'monospace',
  },
  replayPos: { fontSize: 9, color: '#555', fontFamily: 'monospace', padding: '0 3px' },
  replayTs: { fontSize: 9, color: '#333', fontFamily: 'monospace' },
  contentViewer: {
    background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: 3,
    display: 'flex', flexDirection: 'column' as const, maxHeight: 200,
  },
  contentHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '3px 6px', borderBottom: '1px solid #1e1e1e', flexShrink: 0,
  },
  contentTitle: { fontSize: 9, color: '#555', fontFamily: 'monospace' },
  closeBtn: {
    background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 9,
  },
  contentPre: {
    margin: 0, padding: '4px 6px', fontSize: 9, color: '#888',
    fontFamily: 'monospace', overflow: 'auto', flex: 1,
    whiteSpace: 'pre-wrap' as const, wordBreak: 'break-all' as const,
  },
  empty: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#444', fontSize: 12, fontFamily: 'monospace' },
  clearRow: { padding: '4px 8px', borderBottom: '1px solid #1a1a1a' },
  clearBtn: {
    background: 'none', border: '1px solid #2a2a2a', color: '#555',
    borderRadius: 3, padding: '2px 6px', cursor: 'pointer',
    fontSize: 9, fontFamily: 'monospace', width: '100%', textAlign: 'left' as const,
  },
}
