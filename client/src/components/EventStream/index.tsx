import { useState, useMemo, useEffect } from 'react'
import { Activity } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'

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

export function EventStream() {
  const _events = useStore((s) => s.events)
  const pushEvent = useStore((s) => s.pushEvent)
  const activeProjectId = useStore((s) => s.activeProjectId)
  // Filter events by project when a project is selected
  const events = activeProjectId
    ? _events.filter((e) => {
        const payload = e.payload as Record<string, unknown>
        return payload.projectId === activeProjectId || payload.rigId === activeProjectId || !payload.projectId
      })
    : _events
  const [filter, setFilter] = useState('')
  const [offset, setOffset] = useState(100)
  const [hasMore, setHasMore] = useState(true)

  useEffect(() => {
    apiFetch('/api/events?limit=100')
      .then((r) => r.json())
      .then((data: Array<{ id: string; type: string; payload: Record<string, unknown>; timestamp: string }>) => {
        setHasMore(data.length === 100)
        for (let i = data.length - 1; i >= 0; i--) {
          pushEvent(data[i])
        }
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoadMore = () => {
    apiFetch(`/api/events?limit=50&offset=${offset}`)
      .then((r) => r.json())
      .then((data: Array<{ id: string; type: string; payload: Record<string, unknown>; timestamp: string }>) => {
        setHasMore(data.length === 50)
        setOffset((prev) => prev + 50)
        for (let i = data.length - 1; i >= 0; i--) {
          pushEvent(data[i])
        }
      })
      .catch(() => {})
  }

  const filtered = useMemo(() => {
    if (!filter.trim()) return events
    const q = filter.toLowerCase()
    return events.filter((e) =>
      e.type.toLowerCase().includes(q) ||
      JSON.stringify(e.payload).toLowerCase().includes(q)
    )
  }, [events, filter])

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <input
        className="bg-transparent border-none border-b border-border-primary text-text-secondary text-[10px] font-mono px-2 py-1 outline-none shrink-0"
        placeholder="filter events…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-text-disabled text-[11px] font-mono flex items-center gap-1.5">
            <Activity className="w-3 h-3" />
            {events.length === 0 ? 'Waiting for events...' : 'No matches'}
          </span>
        </div>
      ) : (
        <div className="overflow-auto flex-1 flex flex-col">
          {filtered.map((ev) => (
            <div
              key={ev.id}
              className="flex gap-2 px-2 py-[3px] border-b border-border-primary font-mono text-[11px] cursor-default"
              title={JSON.stringify(ev.payload, null, 2)}
            >
              <span className="text-text-tertiary shrink-0">
                {new Date(ev.timestamp).toLocaleTimeString([], { hour12: false })}
              </span>
              <span className={cn('break-all', EVENT_COLOR[ev.type] ?? 'text-text-secondary')}>
                {EVENT_LABEL[ev.type] ?? ev.type}
              </span>
            </div>
          ))}
          {hasMore && (
            <button
              className="bg-transparent border-none border-t border-border-primary text-text-tertiary text-[10px] font-mono py-1.5 px-2 cursor-pointer text-center w-full shrink-0 hover:text-text-secondary"
              onClick={handleLoadMore}
            >
              load more
            </button>
          )}
        </div>
      )}
    </div>
  )
}