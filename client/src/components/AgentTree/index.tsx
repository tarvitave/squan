import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
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

// Strip ANSI escape codes for readable display
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r/g, '')
}

interface Snapshot { id: string; capturedAt: string }
interface ReplayFrame { id: string; frameAt: string }

// Full-screen modal for viewing terminal output
function ContentModal({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const clean = stripAnsi(text)

  return createPortal(
    <div style={modal.overlay} onClick={onClose}>
      <div style={modal.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={modal.header}>
          <span style={modal.title}>{title}</span>
          <span style={modal.hint}>esc to close</span>
          <button style={modal.closeBtn} onClick={onClose}>✕</button>
        </div>
        <pre style={modal.body}>{clean}</pre>
      </div>
    </div>,
    document.body
  )
}

const modal = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.75)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialog: {
    background: '#0f0f0f',
    border: '1px solid #2a2a2a',
    borderRadius: 6,
    width: '80vw',
    height: '80vh',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    borderBottom: '1px solid #1e1e1e',
    background: '#111',
    flexShrink: 0,
  },
  title: {
    fontSize: 11,
    color: '#d4d4d4',
    fontFamily: 'monospace',
    flex: 1,
  },
  hint: {
    fontSize: 9,
    color: '#333',
    fontFamily: 'monospace',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#555',
    cursor: 'pointer',
    fontSize: 12,
    padding: '0 2px',
  },
  body: {
    flex: 1,
    overflow: 'auto',
    padding: '12px 16px',
    margin: 0,
    fontSize: 12,
    lineHeight: 1.5,
    color: '#c8c8c8',
    fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
}

export function AgentTree() {
  const agents = useStore((s) => s.agents)
  const rigs = useStore((s) => s.rigs)
  const addPaneToTab = useStore((s) => s.addPaneToTab)
  const addTab = useStore((s) => s.addTab)
  const activeTabId = useStore((s) => s.activeTabId)
  const tabs = useStore((s) => s.tabs)
  const updateAgent = useStore((s) => s.updateAgent)
  const removeAgent = useStore((s) => s.removeAgent)
  const removePaneFromAllTabs = useStore((s) => s.removePaneFromAllTabs)
  const selectedAgentId = useStore((s) => s.selectedAgentId)
  const setSelectedAgent = useStore((s) => s.setSelectedAgent)
  const addToast = useStore((s) => s.addToast)

  const rigNameById = Object.fromEntries(rigs.map((r) => [r.id, r.name]))
  const rigIds = new Set(rigs.map((r) => r.id))
  // Only filter by workspace if rigs have loaded; otherwise show all agents
  const visibleAgents = rigs.length > 0 ? agents.filter((a) => rigIds.has(a.projectId)) : agents
  const byProject = visibleAgents.reduce<Record<string, Agent[]>>((acc, a) => {
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
    // Save sessionId before removing so we can close the pane
    const sessionId = agents.find((a) => a.id === id)?.sessionId
    try {
      const res = await apiFetch(`/api/workerbees/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        addToast(`Failed to kill WorkerBee: ${body.error ?? res.status}`)
        return
      }
      if (sessionId) removePaneFromAllTabs(sessionId)
      removeAgent(id)
      if (selectedAgentId === id) setSelectedAgent(null)
    } catch (err) {
      addToast(`Failed to kill WorkerBee: ${(err as Error).message}`)
    }
  }

  const handleClearFinished = async () => {
    const finished = visibleAgents.filter((a) => a.status === 'zombie' || a.status === 'done')
    await Promise.allSettled(
      finished.map((a) =>
        apiFetch(`/api/workerbees/${a.id}`, { method: 'DELETE' })
          .then(() => {
            if (a.sessionId) removePaneFromAllTabs(a.sessionId)
            removeAgent(a.id)
            if (selectedAgentId === a.id) setSelectedAgent(null)
          })
      )
    )
  }

  if (visibleAgents.length === 0) {
    return (
      <div style={styles.empty}>
        <span style={styles.emptyText}>No WorkerBees</span>
      </div>
    )
  }

  const hasFinished = visibleAgents.some((a) => a.status === 'zombie' || a.status === 'done')

  return (
    <div style={styles.tree}>
      {hasFinished && (
        <div style={styles.clearRow}>
          <button style={styles.clearBtn} onClick={handleClearFinished}>clear done/zombie</button>
        </div>
      )}
      {Object.entries(byProject).map(([projectId, projectAgents]) => (
        <div key={projectId}>
          <div style={styles.rigHeader}>{rigNameById[projectId] ?? '(unknown project)'}</div>
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
  const [modal, setModal] = useState<{ title: string; text: string } | null>(null)
  const [replayIdx, setReplayIdx] = useState(0)
  const [latestFrame, setLatestFrame] = useState<string | null>(null)
  const [loadingLatest, setLoadingLatest] = useState(false)

  useEffect(() => {
    if (!expanded) return
    apiFetch(`/api/workerbees/${agent.id}/snapshots`).then((r) => r.json()).then(setSnapshots).catch(() => {})
    apiFetch(`/api/workerbees/${agent.id}/replay`).then((r) => r.json()).then((f) => {
      setFrames(f)
      setReplayIdx(f.length - 1)
      // Auto-load latest frame for inline preview
      const last = f[f.length - 1]
      if (last) {
        setLoadingLatest(true)
        apiFetch(`/api/replay/${last.id}/content`).then((r) => r.json()).then((d) => {
          setLatestFrame(d.content ?? null)
        }).catch(() => {}).finally(() => setLoadingLatest(false))
      }
    }).catch(() => {})
  }, [expanded, agent.id])

  const openSnapshot = async (id: string, label: string) => {
    const { content } = await apiFetch(`/api/snapshots/${id}/content`).then((r) => r.json())
    setModal({ title: label, text: content })
  }

  const openFrame = async (id: string, label: string) => {
    const { content } = await apiFetch(`/api/replay/${id}/content`).then((r) => r.json())
    setModal({ title: label, text: content })
  }

  const isActive = agent.status === 'working' || agent.status === 'idle'

  return (
    <>
      {modal && <ContentModal title={modal.title} text={modal.text} onClose={() => setModal(null)} />}

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
        {agent.sessionId && isActive && (
          <button style={styles.termBtn} onClick={onOpenTerminal} title="Open live terminal">⬡</button>
        )}
        <button style={styles.killBtn} onClick={onKill} title={agent.status === 'done' || agent.status === 'zombie' ? 'Remove' : 'Kill agent'}>✕</button>
      </div>

      {expanded && (
        <div style={styles.detail}>
          <button style={styles.collapseBtn} onClick={onToggle}>▲ collapse</button>

          {/* Live terminal button — prominent for active agents */}
          {agent.sessionId && isActive && (
            <button style={styles.liveBtn} onClick={onOpenTerminal}>
              ▶ open live terminal
            </button>
          )}

          {/* Task */}
          {agent.taskDescription && (
            <div style={styles.detailSection}>
              <div style={styles.detailLabel}>task</div>
              <div style={{ ...styles.detailText, maxHeight: 80, overflow: 'auto' }}>{agent.taskDescription}</div>
            </div>
          )}

          {/* Completion note */}
          {agent.completionNote && (
            <div style={styles.detailSection}>
              <div style={styles.detailLabel}>
                {agent.status === 'done' ? 'done' : agent.status === 'zombie' ? 'last output' : 'blocked'}
              </div>
              <div style={{ ...styles.detailText, color: agent.status === 'done' ? '#608b4e' : '#ce9178', whiteSpace: 'pre-wrap' as const }}>
                {agent.completionNote}
              </div>
            </div>
          )}

          {/* Latest replay frame inline preview */}
          {(latestFrame || loadingLatest) && (
            <div style={styles.detailSection}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={styles.detailLabel}>latest output</div>
                {latestFrame && (
                  <button
                    style={styles.expandViewBtn}
                    onClick={() => openFrame(frames[frames.length - 1].id, `Latest output — ${agent.name}`)}
                  >
                    expand ↗
                  </button>
                )}
              </div>
              {loadingLatest ? (
                <div style={{ ...styles.detailText, color: '#333' }}>loading…</div>
              ) : (
                <pre style={styles.inlinePreview}>{stripAnsi(latestFrame ?? '').slice(-1200)}</pre>
              )}
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
                    if (f) openFrame(f.id, `Frame ${replayIdx + 1} of ${frames.length} — ${new Date(f.frameAt).toLocaleTimeString([], { hour12: false })}`)
                  }}
                >
                  view ↗
                </button>
              </div>
              <div style={styles.replayTs}>
                {new Date(frames[replayIdx]?.frameAt ?? '').toLocaleTimeString([], { hour12: false })}
              </div>
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
                    onClick={() => openSnapshot(s.id, `Snapshot — ${new Date(s.capturedAt).toLocaleTimeString([], { hour12: false })}`)}
                  >
                    {new Date(s.capturedAt).toLocaleTimeString([], { hour12: false })}
                  </button>
                ))}
              </div>
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
    background: 'none', border: 'none', color: '#f44747', cursor: 'pointer',
    fontSize: 10, padding: '0 2px', flexShrink: 0,
  },
  collapseBtn: {
    background: 'none', border: 'none', color: '#444', cursor: 'pointer',
    fontSize: 9, fontFamily: 'monospace', padding: '0 0 4px', textAlign: 'left' as const,
  },
  liveBtn: {
    background: '#0d1f10', border: '1px solid #2a4a2a', color: '#4ec9b0',
    borderRadius: 3, padding: '4px 8px', cursor: 'pointer',
    fontSize: 10, fontFamily: 'monospace', textAlign: 'left' as const, width: '100%',
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
  inlinePreview: {
    margin: 0,
    background: '#080808',
    border: '1px solid #1a1a1a',
    borderRadius: 3,
    padding: '6px 8px',
    fontSize: 10,
    lineHeight: 1.45,
    color: '#aaa',
    fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    maxHeight: 180,
    overflow: 'auto',
  },
  expandViewBtn: {
    background: 'none', border: 'none', color: '#4ec9b0', cursor: 'pointer',
    fontSize: 9, fontFamily: 'monospace', padding: 0,
  },
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
  empty: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#444', fontSize: 12, fontFamily: 'monospace' },
  clearRow: { padding: '4px 8px', borderBottom: '1px solid #1a1a1a' },
  clearBtn: {
    background: 'none', border: '1px solid #2a2a2a', color: '#555',
    borderRadius: 3, padding: '2px 6px', cursor: 'pointer',
    fontSize: 9, fontFamily: 'monospace', width: '100%', textAlign: 'left' as const,
  },
}
