import { useStore } from '../../store/index.js'

const EVENT_COLOR: Record<string, string> = {
  'workerbee.spawned': '#4ec9b0',
  'workerbee.done': '#608b4e',
  'workerbee.stalled': '#ce9178',
  'workerbee.zombie': '#f44747',
  'convoy.created': '#569cd6',
  'convoy.landed': '#608b4e',
  'hook.created': '#888',
  'hook.completed': '#4ec9b0',
  'mayorlee.started': '#dcdcaa',
  'mayorlee.stopped': '#888',
}

export function EventStream() {
  const events = useStore((s) => s.events)

  if (events.length === 0) {
    return (
      <div style={styles.empty}>
        <span style={styles.emptyText}>Waiting for events...</span>
      </div>
    )
  }

  return (
    <div style={styles.stream}>
      {events.map((ev) => (
        <div key={ev.id} style={styles.row}>
          <span style={styles.ts}>
            {new Date(ev.timestamp).toLocaleTimeString([], { hour12: false })}
          </span>
          <span style={{ ...styles.type, color: EVENT_COLOR[ev.type] ?? '#888' }}>
            {ev.type}
          </span>
        </div>
      ))}
    </div>
  )
}

const styles = {
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
}
