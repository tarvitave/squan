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


export function AgentTree() {
  const agents = useStore((s) => s.agents)
  const rigs = useStore((s) => s.rigs)
  const addPaneToTab = useStore((s) => s.addPaneToTab)
  const addTab = useStore((s) => s.addTab)
  const activeTabId = useStore((s) => s.activeTabId)
  const tabs = useStore((s) => s.tabs)
  const setMainView = useStore((s) => s.setMainView)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const removeAgent = useStore((s) => s.removeAgent)
  const removePaneFromAllTabs = useStore((s) => s.removePaneFromAllTabs)
  const addAgent = useStore((s) => s.addAgent)
  const updateReleaseTrain = useStore((s) => s.updateReleaseTrain)
  const addToast = useStore((s) => s.addToast)

  const rigNameById = Object.fromEntries(rigs.map((r) => [r.id, r.name]))
  const rigIds = new Set(rigs.map((r) => r.id))
  const visibleAgents = rigs.length > 0 ? agents.filter((a) => rigIds.has(a.projectId)) : agents
  const byProject = visibleAgents.reduce<Record<string, Agent[]>>((acc, a) => {
    ;(acc[a.projectId] ??= []).push(a)
    return acc
  }, {})

  const handleOpenTerminal = (agent: Agent) => {
    if (!agent.sessionId) return
    const existingTab = tabs.find((t) => t.panes.includes(agent.sessionId!))
    if (existingTab) {
      setActiveTab(existingTab.id)
    } else if (activeTabId) {
      addPaneToTab(activeTabId, agent.sessionId)
    } else {
      addTab(agent.name, [agent.sessionId])
    }
    setMainView('terminals')
  }

  const handleKill = async (id: string) => {
    const sessionId = agents.find((a) => a.id === id)?.sessionId
    try {
      const res = await apiFetch(`/api/workerbees/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        addToast(`Failed to kill Agent: ${body.error ?? res.status}`)
        return
      }
      if (sessionId) removePaneFromAllTabs(sessionId)
      removeAgent(id)
    } catch (err) {
      addToast(`Failed to kill Agent: ${(err as Error).message}`)
    }
  }

  const handleRestart = async (agent: Agent) => {
    try {
      const res = await apiFetch(`/api/workerbees/${agent.id}/restart`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        addToast(`Failed to restart: ${body.error ?? res.status}`)
        return
      }
      const { bee, releaseTrainId } = await res.json()
      if (agent.sessionId) removePaneFromAllTabs(agent.sessionId)
      removeAgent(agent.id)
      addAgent({ ...bee, taskDescription: bee.taskDescription ?? '', worktreePath: bee.worktreePath ?? '', branch: bee.branch ?? '' })
      if (releaseTrainId) updateReleaseTrain(releaseTrainId, { assignedWorkerBeeId: bee.id, status: 'in_progress' })
      if (bee.sessionId) {
        if (activeTabId) addPaneToTab(activeTabId, bee.sessionId)
        else addTab(bee.name, [bee.sessionId])
      }
      setMainView('terminals')
    } catch (err) {
      addToast(`Failed to restart: ${(err as Error).message}`)
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
          })
      )
    )
  }

  if (visibleAgents.length === 0) {
    return (
      <div style={styles.empty}>
        <span style={styles.emptyText}>No Agents</span>
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
              onOpenTerminal={() => handleOpenTerminal(agent)}
              onKill={() => handleKill(agent.id)}
              onRestart={agent.status === 'zombie' || agent.status === 'stalled' ? () => handleRestart(agent) : undefined}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function AgentRow({ agent, onOpenTerminal, onKill, onRestart }: {
  agent: Agent
  onOpenTerminal: () => void
  onKill: () => void
  onRestart?: () => void
}) {
  const canOpen = !!agent.sessionId

  return (
    <div style={styles.agentRow}>
      <span style={{ ...styles.statusDot, color: STATUS_COLOR[agent.status] }}>
        {STATUS_ICON[agent.status]}
      </span>
      <span
        style={{ ...styles.agentName, cursor: canOpen ? 'pointer' : 'default' }}
        onClick={canOpen ? onOpenTerminal : undefined}
        title={canOpen ? 'Open terminal' : undefined}
      >
        {agent.name}
      </span>
      <span style={{ ...styles.agentStatus, color: STATUS_COLOR[agent.status] }}>{agent.status}</span>
      {agent.completionNote ? (
        <span style={{ ...styles.noteHint, color: agent.status === 'done' ? '#608b4e' : '#ce9178' }}
          title={agent.completionNote}>
          ⓘ
        </span>
      ) : null}
      {onRestart && (
        <button style={styles.restartBtn} onClick={onRestart} title="Restart agent">↺</button>
      )}
      <button
        style={styles.killBtn}
        onClick={onKill}
        title={agent.status === 'done' || agent.status === 'zombie' ? 'Remove' : 'Kill agent'}
      >✕</button>
    </div>
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
  statusDot: { fontSize: 10, width: 12, textAlign: 'center' as const, flexShrink: 0 },
  agentName: {
    fontSize: 12, fontFamily: 'monospace', color: '#d4d4d4', flex: 1,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  agentStatus: { fontSize: 10, fontFamily: 'monospace', flexShrink: 0 },
  noteHint: { fontSize: 11, cursor: 'default', flexShrink: 0 },
  restartBtn: {
    background: 'none', border: 'none', color: '#ce9178', cursor: 'pointer',
    fontSize: 13, padding: '0 2px', flexShrink: 0, lineHeight: 1,
  },
  killBtn: {
    background: 'none', border: 'none', color: '#f44747', cursor: 'pointer',
    fontSize: 10, padding: '0 2px', flexShrink: 0,
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
