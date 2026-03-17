import { useState, useMemo, useEffect } from 'react'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'

const EVENT_COLOR: Record<string, string> = {
  'workerbee.spawned': '#4ec9b0',
  'workerbee.working': '#4ec9b0',
  'workerbee.done': '#608b4e',
  'workerbee.stalled': '#ce9178',
  'workerbee.zombie': '#f44747',
  'releasetrain.created': '#569cd6',
  'releasetrain.landed': '#608b4e',
  'releasetrain.assigned': '#4ec9b0',
  'releasetrain.cancelled': '#555',
  'hook.created': '#888',
  'hook.activated': '#dcdcaa',
  'hook.completed': '#4ec9b0',
  'atomictask.created': '#569cd6',
  'atomictask.assigned': '#4ec9b0',
  'atomictask.done': '#608b4e',
  'rootagent.started': '#dcdcaa',
  'rootagent.stopped': '#888',
  'mayorlee.started': '#dcdcaa',  // legacy alias
  'mayorlee.stopped': '#888',     // legacy alias
}

// Display name mapping — normalises legacy event types
const EVENT_LABEL: Record<string, string> = {
  'mayorlee.started': 'rootAgent.started',
  'mayorlee.stopped': 'rootAgent.stopped',
}

export function EventStream() {
  const events = useStore((s) => s.events)
  const pushEvent = useStore((s) => s.pushEvent)
  const [filter, setFilter] = useState('')
  const [offset, setOffset] = useState(100)
  const [hasMore, setHasMore] = useState(true)

  useEffect(() => {
    apiFetch('/api/events?limit=100')
      .then((r) => r.json())
      .then((data: Array<{ id: string; type: string; payload: Record<string, unknown>; timestamp: string }>) => {
        setHasMore(data.length === 100)
        // Push in reverse so oldest arrive first; store prepends, so newest ends up at top
        for (let i = data.length - 1; i >= 0; i--) {
          pushEvent(data[i])
        }
      })
      .catch(() => {})
  }, [pushEvent])

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
    <div style={styles.wrapper}>
      <input
        style={styles.search}
        placeholder="filter events…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      {filtered.length === 0 ? (
        <div style={styles.empty}>
          <span style={styles.emptyText}>
            {events.length === 0 ? 'Waiting for events...' : 'No matches'}
          </span>
        </div>
      ) : (
        <div style={styles.stream}>
          {filtered.map((ev) => (
            <div key={ev.id} style={styles.row} title={JSON.stringify(ev.payload, null, 2)}>
              <span style={styles.ts}>
                {new Date(ev.timestamp).toLocaleTimeString([], { hour12: false })}
              </span>
              <span style={{ ...styles.type, color: EVENT_COLOR[ev.type] ?? '#888' }}>
                {EVENT_LABEL[ev.type] ?? ev.type}
              </span>
            </div>
          ))}
          {hasMore && (
            <button style={styles.loadMoreBtn} onClick={handleLoadMore}>
              load more
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const styles = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    overflow: 'hidden',
  },
  search: {
    background: 'none',
    border: 'none',
    borderBottom: '1px solid #222',
    color: '#888',
    fontSize: 10,
    fontFamily: 'monospace',
    padding: '4px 8px',
    outline: 'none',
    flexShrink: 0,
  },
  stream: {
    overflow: 'auto',
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
  },
  row: {
    display: 'flex',
    gap: 8,
    padding: '3px 8px',
    borderBottom: '1px solid #111',
    fontFamily: 'monospace',
    fontSize: 11,
    cursor: 'default',
  },
  ts: {
    color: '#555',
    flexShrink: 0,
  },
  type: {
    wordBreak: 'break-all' as const,
  },
  empty: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#333',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  loadMoreBtn: {
    background: 'none',
    border: 'none',
    borderTop: '1px solid #1a1a1a',
    color: '#444',
    fontSize: 10,
    fontFamily: 'monospace',
    padding: '6px 8px',
    cursor: 'pointer',
    textAlign: 'center' as const,
    width: '100%',
    flexShrink: 0,
  },
}
