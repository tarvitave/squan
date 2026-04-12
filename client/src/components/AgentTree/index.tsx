import { Bot, Circle, X, RotateCcw } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'
import type { Agent } from '../../store/index.js'

const ROLE_COLOR: Record<string, string> = {
  coder:    'text-text-info',
  tester:   'text-block-teal',
  reviewer: 'text-yellow',
  devops:   'text-orange',
  lead:     'text-[#c586c0]',
}

const STATUS_COLOR: Record<Agent['status'], string> = {
  idle: 'text-text-info',
  working: 'text-block-teal',
  stalled: 'text-yellow',
  zombie: 'text-text-danger',
  done: 'text-block-teal',
}


export function AgentTree() {
  const _agents = useStore((s) => s.agents)
  const rigs = useStore((s) => s.rigs)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const agents = activeProjectId ? _agents.filter((a) => a.projectId === activeProjectId) : _agents
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
      addAgent({ ...bee, role: bee.role ?? 'coder', taskDescription: bee.taskDescription ?? '', worktreePath: bee.worktreePath ?? '', branch: bee.branch ?? '' })
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
      <div className="flex flex-1 items-center justify-center">
        <span className="text-text-disabled text-xs font-mono">No Agents</span>
      </div>
    )
  }

  const hasFinished = visibleAgents.some((a) => a.status === 'zombie' || a.status === 'done')

  return (
    <div className="overflow-auto flex-1">
      {hasFinished && (
        <div className="px-2 py-1 border-b border-border-primary">
          <button
            className="w-full text-left bg-transparent border border-border-primary text-text-tertiary rounded-sm px-1.5 py-0.5 text-[9px] font-mono cursor-pointer hover:text-text-secondary"
            onClick={handleClearFinished}
          >
            clear done/zombie
          </button>
        </div>
      )}
      {Object.entries(byProject).map(([projectId, projectAgents]) => (
        <div key={projectId}>
          <div className="px-2 py-1 text-[10px] text-text-info uppercase tracking-widest border-b border-border-primary">
            {rigNameById[projectId] ?? '(unknown project)'}
          </div>
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

function StatusIcon({ status }: { status: Agent['status'] }) {
  const colorClass = STATUS_COLOR[status]
  if (status === 'working') return <Bot className={cn('w-3 h-3 shrink-0', colorClass)} />
  if (status === 'done') return <Bot className={cn('w-3 h-3 shrink-0', colorClass)} />
  return <Circle className={cn('w-3 h-3 shrink-0', colorClass)} />
}

function AgentRow({ agent, onOpenTerminal, onKill, onRestart }: {
  agent: Agent
  onOpenTerminal: () => void
  onKill: () => void
  onRestart?: () => void
}) {
  const canOpen = !!agent.sessionId

  return (
    <div className="flex items-center gap-1 px-2 py-1">
      <StatusIcon status={agent.status} />
      <span
        className={cn(
          'text-xs font-mono text-text-primary flex-1 overflow-hidden text-ellipsis whitespace-nowrap',
          canOpen ? 'cursor-pointer hover:text-block-teal' : 'cursor-default'
        )}
        onClick={canOpen ? onOpenTerminal : undefined}
        title={canOpen ? 'Open terminal' : undefined}
      >
        {agent.name}
      </span>
      {agent.role && agent.role !== 'coder' && (
        <span className={cn('text-[9px] font-mono shrink-0', ROLE_COLOR[agent.role] ?? 'text-text-tertiary')}>
          {agent.role}
        </span>
      )}
      <span className={cn('text-[10px] font-mono shrink-0', STATUS_COLOR[agent.status])}>
        {agent.status}
      </span>
      {agent.completionNote ? (
        <span
          className={cn('text-[11px] shrink-0 cursor-default', agent.status === 'done' ? 'text-block-teal' : 'text-orange')}
          title={agent.completionNote}
        >
          ⓘ
        </span>
      ) : null}
      {onRestart && (
        <button
          className="bg-transparent border-none text-orange cursor-pointer p-0 shrink-0 hover:text-yellow"
          onClick={onRestart}
          title="Restart agent"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      )}
      <button
        className="bg-transparent border-none text-text-danger cursor-pointer p-0 shrink-0 hover:text-[#ff6b6b]"
        onClick={onKill}
        title={agent.status === 'done' || agent.status === 'zombie' ? 'Remove' : 'Kill agent'}
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </div>
  )
}