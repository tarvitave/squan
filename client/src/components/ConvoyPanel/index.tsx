import { useStore } from '../../store/index.js'

const STATUS_COLOR: Record<string, string> = {
  open: '#569cd6',
  in_progress: '#4ec9b0',
  landed: '#608b4e',
  cancelled: '#555',
}

export function ConvoyPanel() {
  const convoys = useStore((s) => s.convoys)

  if (convoys.length === 0) {
    return (
      <div style={styles.empty}>
        <span style={styles.emptyText}>No convoys</span>
      </div>
    )
  }

  return (
    <div style={styles.list}>
      {convoys.map((convoy) => (
        <div key={convoy.id} style={styles.row}>
          <div style={styles.rowTop}>
            <span style={styles.name}>{convoy.name}</span>
            <span style={{ ...styles.status, color: STATUS_COLOR[convoy.status] ?? '#888' }}>
              {convoy.status}
            </span>
          </div>
          <div style={styles.meta}>
            <span style={styles.rig}>{convoy.projectId}</span>
            <span style={styles.beadCount}>{convoy.beadIds.length} beads</span>
          </div>
        </div>
      ))}
    </div>
  )
}

const styles = {
  list: {
    overflow: 'auto',
    flex: 1,
  },
  row: {
    padding: '6px 8px',
    borderBottom: '1px solid #1e1e1e',
    cursor: 'default',
  },
  rowTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    fontSize: 12,
    color: '#d4d4d4',
    fontFamily: 'monospace',
  },
  status: {
    fontSize: 10,
    fontFamily: 'monospace',
  },
  meta: {
    display: 'flex',
    gap: 8,
    marginTop: 2,
  },
  rig: {
    fontSize: 10,
    color: '#569cd6',
    fontFamily: 'monospace',
  },
  beadCount: {
    fontSize: 10,
    color: '#666',
    fontFamily: 'monospace',
  },
  empty: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#444',
    fontSize: 12,
    fontFamily: 'monospace',
  },
}
