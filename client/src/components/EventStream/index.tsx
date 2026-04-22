import { useState, useMemo, useEffect, useCallback } from 'react'
import { Activity, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'

const PAGE_SIZE = 50

const EVENT_COLOR: Record<string, string> = {
  'workerbee.spawned': 'text-block-teal',
  'workerbee.working': 'text-block-teal',
  'workerbee.done': 'text-block-teal',
  'workerbee.stalled': 'text-orange',
  'workerbee.zombie': 'text-text-danger',
  'releasetrain.created': 'text-text-info',
  'releasetrain.landed': 'text-block-teal',
  'releasetrain.assigned': 'text-block-teal',
  'releasetrain.cancelled': 'text-text-tertiary',
  'hook.created': 'text-text-secondary',
  'hook.activated': 'text-yellow',
  'hook.completed': 'text-block-teal',
  'atomictask.created': 'text-text-info',
  'atomictask.assigned': 'text-block-teal',
  'atomictask.done': 'text-block-teal',
  'rootagent.started': 'text-yellow',
  'rootagent.stopped': 'text-text-secondary',
  'mayorlee.started': 'text-yellow',
  'mayorlee.stopped': 'text-text-secondary',
}

const EVENT_LABEL: Record<string, string> = {
  'mayorlee.started': 'rootAgent.started',
  'mayorlee.stopped': 'rootAgent.stopped',
}

interface EventItem {
  id: string
  type: string
  payload: Record<string, unknown>
  timestamp: string
}

export function EventStream() {
  const activeProjectId = useStore((s) => s.activeProjectId)
  const [events, setEvents] = useState<EventItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  const fetchPage = useCallback(async (pageNum: number, type?: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(pageNum * PAGE_SIZE),
      })
      if (type) params.set('type', type)
      const res = await apiFetch(`/api/events?${params}`)
      const data = await res.json()
      // Support both old (array) and new ({ events, total }) format
      if (Array.isArray(data)) {
        setEvents(data)
        setTotal(data.length >= PAGE_SIZE ? (pageNum + 2) * PAGE_SIZE : (pageNum * PAGE_SIZE) + data.length)
      } else {
        setEvents(data.events || [])
        setTotal(data.total || 0)
      }
    } catch {
      setEvents([])
      setTotal(0)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchPage(0, typeFilter || undefined) }, [fetchPage, typeFilter])

  const goToPage = (p: number) => {
    setPage(p)
    fetchPage(p, typeFilter || undefined)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Text filter (client-side on current page)
  const filtered = useMemo(() => {
    let items = events
    // Filter by project if active
    if (activeProjectId) {
      items = items.filter((e) => {
        const p = e.payload as Record<string, unknown>
        return p.projectId === activeProjectId || p.rigId === activeProjectId || !p.projectId
      })
    }
    if (!filter.trim()) return items
    const q = filter.toLowerCase()
    return items.filter((e) =>
      e.type.toLowerCase().includes(q) ||
      JSON.stringify(e.payload).toLowerCase().includes(q)
    )
  }, [events, filter, activeProjectId])

  // Collect event types for dropdown
  const eventTypes = useMemo(() => {
    const types = new Set(events.map(e => e.type))
    return Array.from(types).sort()
  }, [events])

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-primary shrink-0 bg-bg-secondary/50">
        <Activity className="w-3.5 h-3.5 text-block-teal shrink-0" />
        <input
          className="flex-1 bg-transparent text-text-primary text-xs font-mono px-2 py-1 outline-none border border-border-primary rounded"
          placeholder="Search events..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(0) }}
          className="text-[10px] bg-bg-primary border border-border-primary rounded px-1.5 py-1 text-text-secondary outline-none"
        >
          <option value="">All types</option>
          {eventTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="text-[10px] text-text-tertiary shrink-0">
          {total.toLocaleString()} events
        </span>
      </div>

      {/* Events list */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="w-5 h-5 text-text-tertiary animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-text-disabled text-xs font-mono flex items-center gap-1.5">
            <Activity className="w-3 h-3" />
            {total === 0 ? 'No events yet' : 'No matches'}
          </span>
        </div>
      ) : (
        <div className="overflow-auto flex-1">
          <table className="w-full">
            <tbody>
              {filtered.map((ev) => (
                <tr
                  key={ev.id}
                  className="border-b border-border-primary hover:bg-bg-secondary/30 cursor-default"
                  title={JSON.stringify(ev.payload, null, 2)}
                >
                  <td className="px-2 py-1 text-text-tertiary text-[11px] font-mono whitespace-nowrap w-20">
                    {new Date(ev.timestamp).toLocaleTimeString([], { hour12: false })}
                  </td>
                  <td className="px-2 py-1 text-[11px] font-mono whitespace-nowrap w-48">
                    <span className={cn(EVENT_COLOR[ev.type] ?? 'text-text-secondary')}>
                      {EVENT_LABEL[ev.type] ?? ev.type}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-[10px] font-mono text-text-tertiary truncate max-w-xs">
                    {summarizePayload(ev.payload)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-border-primary shrink-0 bg-bg-secondary/30">
          <button
            onClick={() => goToPage(page - 1)}
            disabled={page === 0}
            className="flex items-center gap-1 text-[10px] text-text-tertiary hover:text-text-primary disabled:opacity-30 disabled:cursor-default"
          >
            <ChevronLeft className="w-3 h-3" /> Prev
          </button>
          <span className="text-[10px] text-text-tertiary">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages - 1}
            className="flex items-center gap-1 text-[10px] text-text-tertiary hover:text-text-primary disabled:opacity-30 disabled:cursor-default"
          >
            Next <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  )
}

function summarizePayload(payload: Record<string, unknown>): string {
  const parts: string[] = []
  if (payload.name) parts.push(String(payload.name))
  if (payload.agentName) parts.push(String(payload.agentName))
  if (payload.task) parts.push(String(payload.task).slice(0, 60))
  if (payload.taskDescription) parts.push(String(payload.taskDescription).slice(0, 60))
  if (payload.branch) parts.push(`branch: ${payload.branch}`)
  if (payload.status) parts.push(`status: ${payload.status}`)
  if (payload.error) parts.push(`error: ${String(payload.error).slice(0, 40)}`)
  return parts.join(' · ') || JSON.stringify(payload).slice(0, 80)
}
