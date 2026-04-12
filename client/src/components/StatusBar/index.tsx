import { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'
import { cn } from '../../lib/utils.js'
import { Coins, Bot, Wifi, Clock, ArrowUpRight, ArrowDownRight } from 'lucide-react'

interface CostData {
  totalSpent?: number
  spentLastHour?: number
  inputTokens?: number
  outputTokens?: number
  limitPerHour?: number
  percentUsed?: number
  blocked?: boolean
  unlimited?: boolean
  totalSpawned?: number
}

export function StatusBar() {
  const agents = useStore((s) => s.agents)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const rigs = useStore((s) => s.rigs)
  const [cost, setCost] = useState<CostData | null>(null)

  const activeProject = rigs.find((r) => r.id === activeProjectId)
  const projectAgents = activeProjectId ? agents.filter((a) => a.projectId === activeProjectId) : agents
  const working = projectAgents.filter((a) => a.status === 'working').length
  const total = projectAgents.length

  useEffect(() => {
    const load = () => {
      const url = activeProjectId
        ? `/api/costs/summary?projectId=${activeProjectId}`
        : '/api/costs/summary'
      apiFetch(url)
        .then((r) => r.json())
        .then((d) => setCost(d))
        .catch(() => {})
    }
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [activeProjectId])

  const formatCost = (v: number | undefined | null) => {
    if (v == null || isNaN(v)) return '$0.00'
    if (v < 0.01) return `$${v.toFixed(4)}`
    if (v < 1) return `$${v.toFixed(3)}`
    return `$${v.toFixed(2)}`
  }

  const formatTokens = (v: number | undefined | null) => {
    if (v == null || isNaN(v)) return '0'
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
    return `${v}`
  }

  return (
    <div className="flex items-center h-7 px-3 bg-bg-secondary border-t border-border-primary text-[11px] text-text-secondary shrink-0 select-none gap-0">
      {/* Server status */}
      <StatusItem title="Server status">
        <Wifi className="w-3 h-3 text-green-200" />
        <span>Connected</span>
      </StatusItem>

      <Divider />

      {/* Active project */}
      {activeProject && (
        <>
          <StatusItem title="Active project">
            <span className="text-text-primary font-medium">{activeProject.name}</span>
          </StatusItem>
          <Divider />
        </>
      )}

      {/* Agents */}
      <StatusItem title={`${working} working, ${total} total agents`}>
        <Bot className="w-3 h-3" />
        <span>{working > 0 ? <span className="text-block-teal font-medium">{working}</span> : '0'} / {total} agents</span>
      </StatusItem>

      {cost && (
        <>
          <Divider />

          {/* Cost */}
          <StatusItem title={cost.unlimited ? 'No budget limit' : `${cost.percentUsed ?? 0}% of hourly budget used`}>
            <Coins className="w-3 h-3" />
            <span className={cn(
              'font-mono',
              cost.blocked ? 'text-text-danger font-medium' : (cost.percentUsed ?? 0) >= 80 ? 'text-yellow-200' : '',
            )}>
              {formatCost(cost.totalSpent)}
            </span>
            {!cost.unlimited && cost.limitPerHour != null && (
              <span className="text-text-tertiary">
                / {formatCost(cost.limitPerHour)}/hr
              </span>
            )}
          </StatusItem>

          <Divider />

          {/* Tokens */}
          <StatusItem title={`Input: ${(cost.inputTokens ?? 0).toLocaleString()} tokens\nOutput: ${(cost.outputTokens ?? 0).toLocaleString()} tokens`}>
            <ArrowUpRight className="w-3 h-3" />
            <span className="font-mono">{formatTokens(cost.inputTokens)}</span>
            <ArrowDownRight className="w-3 h-3 ml-1" />
            <span className="font-mono">{formatTokens(cost.outputTokens)}</span>
          </StatusItem>

          <Divider />

          {/* Rate */}
          <StatusItem title="Spend rate last hour">
            <Clock className="w-3 h-3" />
            <span className="font-mono">{formatCost(cost.spentLastHour)}/hr</span>
          </StatusItem>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Version */}
      <span className="text-text-tertiary text-[10px]">v{__APP_VERSION__}</span>
    </div>
  )
}

function StatusItem({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2 h-full cursor-default hover:bg-bg-hover/50 transition-colors" title={title}>
      {children}
    </div>
  )
}

function Divider() {
  return <div className="w-px h-3.5 bg-border-primary mx-0.5" />
}
