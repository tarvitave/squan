import { useEffect, useState } from 'react'
import { BarChart3, Bot, GitBranch, CheckSquare } from 'lucide-react'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'
import { cn } from '../../lib/utils.js'

interface Metrics {
  projects: number
  workerbees: { total: number; idle?: number; working?: number; stalled?: number; zombie?: number; done?: number }
  releaseTrains: { total: number; open?: number; in_progress?: number; landed?: number; cancelled?: number }
  convoys: { total: number; open?: number; in_progress?: number; landed?: number; cancelled?: number }  // backward compat
  atomictasks: { total: number; open?: number; assigned?: number; in_progress?: number; done?: number; blocked?: number }
  zombieRate: number
}

export function MetricsPanel() {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [loading, setLoading] = useState(true)
  const activeProjectId = useStore((s) => s.activeProjectId)

  const load = () => {
    setLoading(true)
    const url = activeProjectId ? `/api/metrics?projectId=${activeProjectId}` : '/api/metrics'
    apiFetch(url)
      .then((r) => r.json())
      .then((d) => { setMetrics(d); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [activeProjectId])

  if (loading && !metrics) {
    return <div className="flex flex-1 items-center justify-center text-text-dim font-mono text-xs">Loading metrics...</div>
  }

  if (!metrics) {
    return <div className="flex flex-1 items-center justify-center text-text-dim font-mono text-xs">Failed to load metrics</div>
  }

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-auto bg-bg p-5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-bold text-text font-mono tracking-wide">
          <BarChart3 className="h-4 w-4 text-blue" />
          System Metrics
        </span>
        <button
          className="rounded border border-text-faint bg-transparent px-2 py-0.5 font-mono text-[11px] text-text-dim cursor-pointer hover:border-text-dim hover:text-text-muted"
          onClick={load}
        >
          ↻ refresh
        </button>
      </div>

      <div className="flex flex-col gap-5">
        {/* Agents */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-1.5 border-b border-border-light pb-1 font-mono text-[10px] uppercase tracking-widest text-blue">
            <Bot className="h-3 w-3" />
            Agents
          </div>
          <div className="flex flex-wrap gap-2">
            <StatCard label="Total" value={metrics.workerbees.total} color="text-text" />
            <StatCard label="Working" value={metrics.workerbees.working ?? 0} color="text-accent" />
            <StatCard label="Stalled" value={metrics.workerbees.stalled ?? 0} color="text-orange" />
            <StatCard label="Zombie" value={metrics.workerbees.zombie ?? 0} color="text-red" />
            <StatCard label="Done" value={metrics.workerbees.done ?? 0} color="text-green-600" />
            <StatCard label="Idle" value={metrics.workerbees.idle ?? 0} color="text-text-muted" />
          </div>
        </div>

        {/* Release Trains */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-1.5 border-b border-border-light pb-1 font-mono text-[10px] uppercase tracking-widest text-blue">
            <GitBranch className="h-3 w-3" />
            Release Trains
          </div>
          <div className="flex flex-wrap gap-2">
            <StatCard label="Total" value={(metrics.releaseTrains ?? metrics.convoys).total} color="text-text" />
            <StatCard label="Open" value={(metrics.releaseTrains ?? metrics.convoys).open ?? 0} color="text-blue" />
            <StatCard label="In Progress" value={(metrics.releaseTrains ?? metrics.convoys).in_progress ?? 0} color="text-accent" />
            <StatCard label="Landed" value={(metrics.releaseTrains ?? metrics.convoys).landed ?? 0} color="text-green-600" />
            <StatCard label="Cancelled" value={(metrics.releaseTrains ?? metrics.convoys).cancelled ?? 0} color="text-text-dim" />
          </div>
        </div>

        {/* Atomic Tasks */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-1.5 border-b border-border-light pb-1 font-mono text-[10px] uppercase tracking-widest text-blue">
            <CheckSquare className="h-3 w-3" />
            Atomic Tasks
          </div>
          <div className="flex flex-wrap gap-2">
            <StatCard label="Total" value={metrics.atomictasks.total} color="text-text" />
            <StatCard label="Open" value={metrics.atomictasks.open ?? 0} color="text-blue" />
            <StatCard label="Assigned" value={metrics.atomictasks.assigned ?? 0} color="text-accent" />
            <StatCard label="Done" value={metrics.atomictasks.done ?? 0} color="text-green-600" />
            <StatCard label="Blocked" value={metrics.atomictasks.blocked ?? 0} color="text-red" />
          </div>
        </div>

        {/* Health */}
        <div className="flex flex-col gap-2.5">
          <div className="border-b border-border-light pb-1 font-mono text-[10px] uppercase tracking-widest text-blue">
            Health
          </div>
          <div className="flex flex-wrap gap-2">
            <StatCard label="Projects" value={metrics.projects} color="text-blue" />
            <StatCard
              label="Zombie Rate"
              value={`${metrics.zombieRate}%`}
              color={metrics.zombieRate > 20 ? 'text-red' : metrics.zombieRate > 5 ? 'text-orange' : 'text-green-600'}
            />
          </div>
        </div>
      </div>

      {/* Completion bars */}
      <div className="flex flex-col gap-2.5">
        <div className="border-b border-border-light pb-1 font-mono text-[10px] uppercase tracking-widest text-blue">
          Progress
        </div>

        {metrics.atomictasks.total > 0 && (
          <ProgressBar
            label="Tasks done"
            value={metrics.atomictasks.done ?? 0}
            total={metrics.atomictasks.total}
            color="bg-green-600"
          />
        )}
        {(metrics.releaseTrains ?? metrics.convoys).total > 0 && (
          <ProgressBar
            label="Release trains landed"
            value={(metrics.releaseTrains ?? metrics.convoys).landed ?? 0}
            total={(metrics.releaseTrains ?? metrics.convoys).total}
            color="bg-accent"
          />
        )}
        {metrics.workerbees.total > 0 && (
          <ProgressBar
            label="Bees done"
            value={metrics.workerbees.done ?? 0}
            total={metrics.workerbees.total}
            color="bg-blue"
          />
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="flex min-w-[80px] flex-col items-center rounded border border-border-light bg-bg-card px-4 py-2.5">
      <span className={cn('font-mono text-[22px] font-bold leading-none', color)}>{value}</span>
      <span className="mt-1 text-center font-mono text-[10px] text-text-dim">{label}</span>
    </div>
  )
}

function ProgressBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-[120px] shrink-0 font-mono text-[11px] text-text-muted">{label}</span>
      <div className="flex-1 h-1.5 rounded-sm bg-border-light overflow-hidden">
        <div
          className={cn('h-full rounded-sm transition-all duration-300', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right font-mono text-[10px] text-text-dim">{pct}%</span>
    </div>
  )
}
