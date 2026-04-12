import { useEffect, useState } from 'react'
import { DollarSign, TrendingUp } from 'lucide-react'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'
import { cn } from '../../lib/utils.js'

interface DailyRow { day: string; spawned: number; done: number; zombie: number }
interface RecentBee {
  name: string; status: string; task: string; createdAt: string; updatedAt: string; durationMs: number | null
}
interface CostSummary {
  hasApiKey: boolean
  apiKeyMasked: string | null
  totalSpawned: number
  byStatus: Record<string, number>
  recent: RecentBee[]
  daily: DailyRow[]
}

const STATUS_COLOR: Record<string, string> = {
  done: 'text-green-600',
  zombie: 'text-red',
  stalled: 'text-orange',
  working: 'text-accent',
  idle: 'text-text-muted',
}

function fmt(ms: number | null): string {
  if (ms === null || ms < 0) return '—'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 rounded-sm bg-bg-elevated overflow-hidden">
        <div
          className={cn('h-full rounded-sm transition-all duration-300', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="min-w-[20px] text-right font-mono text-[10px] text-text-dim">{value}</span>
    </div>
  )
}

export function CostPanel() {
  const [data, setData] = useState<CostSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const activeProjectId = useStore((s) => s.activeProjectId)

  const load = () => {
    setLoading(true)
    const url = activeProjectId ? `/api/costs/summary?projectId=${activeProjectId}` : '/api/costs/summary'
    apiFetch(url)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [activeProjectId])

  if (loading) return <div className="flex flex-1 items-center justify-center font-mono text-xs text-text-faint">loading…</div>
  if (!data) return <div className="flex flex-1 items-center justify-center font-mono text-xs text-text-faint">failed to load</div>

  const done = data.byStatus['done'] ?? 0
  const zombie = data.byStatus['zombie'] ?? 0
  const stalled = data.byStatus['stalled'] ?? 0
  const successRate = data.totalSpawned > 0 ? Math.round((done / data.totalSpawned) * 100) : 0
  const maxDaily = Math.max(...data.daily.map((d) => d.spawned), 1)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border-light bg-bg px-5 py-2.5">
        <span className="flex items-center gap-2 font-mono text-[13px] font-bold text-text">
          <DollarSign className="h-4 w-4 text-accent" />
          API Usage & Costs
        </span>
        <a
          href="https://console.anthropic.com/settings/usage"
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[11px] text-blue no-underline hover:underline"
        >
          view billing in Anthropic Console ↗
        </a>
      </div>

      <div className="flex flex-1 flex-col gap-7 overflow-auto p-5">
        {/* API key status */}
        <div className="flex flex-col gap-2.5">
          <div className="border-b border-border-light pb-1.5 font-mono text-[10px] uppercase tracking-widest text-blue">
            API Key
          </div>
          {data.hasApiKey ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-green-600">●</span>
              <span className="font-mono text-xs text-text">{data.apiKeyMasked}</span>
              <span className="font-mono text-[10px] text-text-dim">Agents bill to this key · pay-as-you-go</span>
            </div>
          ) : (
            <div className="rounded border border-red/30 bg-red/5 px-3.5 py-2.5 font-mono text-[11px] leading-relaxed text-orange">
              No API key configured — Agents are using Claude Pro subscription.
              Add an API key in your account settings to use pay-as-you-go billing.
            </div>
          )}
        </div>

        {/* Totals */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-1.5 border-b border-border-light pb-1.5 font-mono text-[10px] uppercase tracking-widest text-blue">
            <TrendingUp className="h-3 w-3" />
            All-time Activity
          </div>
          <div className="flex flex-wrap gap-3">
            <StatBox label="Total tasks" value={data.totalSpawned} color="text-blue" />
            <StatBox label="Completed" value={done} color="text-green-600" />
            <StatBox label="Zombied" value={zombie} color="text-red" />
            <StatBox label="Stalled" value={stalled} color="text-orange" />
            <StatBox label="Success rate" value={`${successRate}%`} color={successRate > 70 ? 'text-green-600' : 'text-orange'} />
          </div>
        </div>

        {/* 30-day daily chart */}
        {data.daily.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <div className="border-b border-border-light pb-1.5 font-mono text-[10px] uppercase tracking-widest text-blue">
              Last 30 Days
            </div>
            <div className="flex flex-col gap-1">
              {data.daily.map((row) => (
                <div key={row.day} className="flex items-center gap-2.5">
                  <span className="w-8 shrink-0 font-mono text-[10px] text-text-faint">{row.day.slice(5)}</span>
                  <div className="flex-1">
                    <Bar value={row.done} max={maxDaily} color="bg-green-600" />
                    {row.zombie > 0 && <Bar value={row.zombie} max={maxDaily} color="bg-red" />}
                  </div>
                  <span className="w-5 text-right font-mono text-[10px] text-text-faint">{row.spawned}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3 pt-1 font-mono text-[9px] text-text-dim">
              <span className="text-green-600">■ done</span>
              <span className="text-red">■ zombie</span>
            </div>
          </div>
        )}

        {/* Recent tasks */}
        {data.recent.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <div className="border-b border-border-light pb-1.5 font-mono text-[10px] uppercase tracking-widest text-blue">
              Recent Tasks
            </div>
            <table className="w-full border-collapse font-mono text-[11px]">
              <thead>
                <tr>
                  <th className="border-b border-border-light px-2 py-1 text-left text-[9px] uppercase tracking-wide text-text-faint">agent</th>
                  <th className="border-b border-border-light px-2 py-1 text-left text-[9px] uppercase tracking-wide text-text-faint">task</th>
                  <th className="border-b border-border-light px-2 py-1 text-left text-[9px] uppercase tracking-wide text-text-faint">status</th>
                  <th className="border-b border-border-light px-2 py-1 text-left text-[9px] uppercase tracking-wide text-text-faint">duration</th>
                  <th className="border-b border-border-light px-2 py-1 text-left text-[9px] uppercase tracking-wide text-text-faint">started</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((bee, i) => (
                  <tr key={i} className="border-b border-bg">
                    <td className="truncate whitespace-nowrap px-2 py-1.5 text-text-muted">{bee.name}</td>
                    <td className="max-w-[260px] truncate whitespace-nowrap px-2 py-1.5 text-text-muted">{bee.task || '—'}</td>
                    <td className={cn('whitespace-nowrap px-2 py-1.5', STATUS_COLOR[bee.status] ?? 'text-text-muted')}>{bee.status}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-text-muted">{fmt(bee.durationMs)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-text-faint">
                      {new Date(bee.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      {' '}
                      {new Date(bee.createdAt).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Anthropic console callout */}
        <div className="rounded border border-border-light bg-bg p-3.5">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-text-dim">Exact billing data</div>
          <div className="font-mono text-[11px] leading-relaxed text-text-muted">
            Squan tracks task activity but cannot read token counts or dollar amounts directly from
            the Anthropic API. For exact usage and costs, visit the{' '}
            <a
              href="https://console.anthropic.com/settings/usage"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue no-underline hover:underline"
            >
              Anthropic Console usage page
            </a>.
          </div>
        </div>
      </div>
    </div>
  )
}

function StatBox({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="min-w-[90px] rounded border border-border-light bg-bg-card px-4 py-3 text-center">
      <div className={cn('font-mono text-2xl font-bold leading-none', color)}>{value}</div>
      <div className="mt-1 font-mono text-[9px] uppercase tracking-wide text-text-dim">{label}</div>
    </div>
  )
}
