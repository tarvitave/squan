import { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api.js'

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

  const load = () => {
    setLoading(true)
    apiFetch('/api/metrics')
      .then((r) => r.json())
      .then((d) => { setMetrics(d); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [])

  if (loading && !metrics) {
    return <div style={styles.loading}>Loading metrics...</div>
  }

  if (!metrics) {
    return <div style={styles.loading}>Failed to load metrics</div>
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <span style={styles.title}>System Metrics</span>
        <button style={styles.refreshBtn} onClick={load}>↻ refresh</button>
      </div>

      <div style={styles.grid}>
        {/* Agents */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Agents</div>
          <div style={styles.statRow}>
            <StatCard label="Total" value={metrics.workerbees.total} color="#d4d4d4" />
            <StatCard label="Working" value={metrics.workerbees.working ?? 0} color="#4ec9b0" />
            <StatCard label="Stalled" value={metrics.workerbees.stalled ?? 0} color="#ce9178" />
            <StatCard label="Zombie" value={metrics.workerbees.zombie ?? 0} color="#f44747" />
            <StatCard label="Done" value={metrics.workerbees.done ?? 0} color="#608b4e" />
            <StatCard label="Idle" value={metrics.workerbees.idle ?? 0} color="#666" />
          </div>
        </div>

        {/* Release Trains */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Release Trains</div>
          <div style={styles.statRow}>
            <StatCard label="Total" value={(metrics.releaseTrains ?? metrics.convoys).total} color="#d4d4d4" />
            <StatCard label="Open" value={(metrics.releaseTrains ?? metrics.convoys).open ?? 0} color="#569cd6" />
            <StatCard label="In Progress" value={(metrics.releaseTrains ?? metrics.convoys).in_progress ?? 0} color="#4ec9b0" />
            <StatCard label="Landed" value={(metrics.releaseTrains ?? metrics.convoys).landed ?? 0} color="#608b4e" />
            <StatCard label="Cancelled" value={(metrics.releaseTrains ?? metrics.convoys).cancelled ?? 0} color="#555" />
          </div>
        </div>

        {/* Atomic Tasks */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Atomic Tasks</div>
          <div style={styles.statRow}>
            <StatCard label="Total" value={metrics.atomictasks.total} color="#d4d4d4" />
            <StatCard label="Open" value={metrics.atomictasks.open ?? 0} color="#569cd6" />
            <StatCard label="Assigned" value={metrics.atomictasks.assigned ?? 0} color="#4ec9b0" />
            <StatCard label="Done" value={metrics.atomictasks.done ?? 0} color="#608b4e" />
            <StatCard label="Blocked" value={metrics.atomictasks.blocked ?? 0} color="#f44747" />
          </div>
        </div>

        {/* Health */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Health</div>
          <div style={styles.statRow}>
            <StatCard label="Projects" value={metrics.projects} color="#569cd6" />
            <StatCard
              label="Zombie Rate"
              value={`${metrics.zombieRate}%`}
              color={metrics.zombieRate > 20 ? '#f44747' : metrics.zombieRate > 5 ? '#ce9178' : '#608b4e'}
            />
          </div>
        </div>
      </div>

      {/* Completion bars */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Progress</div>

        {metrics.atomictasks.total > 0 && (
          <ProgressBar
            label="Tasks done"
            value={metrics.atomictasks.done ?? 0}
            total={metrics.atomictasks.total}
            color="#608b4e"
          />
        )}
        {(metrics.releaseTrains ?? metrics.convoys).total > 0 && (
          <ProgressBar
            label="Release trains landed"
            value={(metrics.releaseTrains ?? metrics.convoys).landed ?? 0}
            total={(metrics.releaseTrains ?? metrics.convoys).total}
            color="#4ec9b0"
          />
        )}
        {metrics.workerbees.total > 0 && (
          <ProgressBar
            label="Bees done"
            value={metrics.workerbees.done ?? 0}
            total={metrics.workerbees.total}
            color="#569cd6"
          />
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={cardStyles.card}>
      <span style={{ ...cardStyles.value, color }}>{value}</span>
      <span style={cardStyles.label}>{label}</span>
    </div>
  )
}

function ProgressBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div style={barStyles.row}>
      <span style={barStyles.label}>{label}</span>
      <div style={barStyles.track}>
        <div style={{ ...barStyles.fill, width: `${pct}%`, background: color }} />
      </div>
      <span style={barStyles.pct}>{pct}%</span>
    </div>
  )
}

const styles = {
  page: {
    flex: 1,
    overflow: 'auto',
    padding: 20,
    background: '#0d0d0d',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 20,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 14,
    color: '#d4d4d4',
    fontFamily: 'monospace',
    fontWeight: 'bold' as const,
    letterSpacing: '0.05em',
  },
  refreshBtn: {
    background: 'none',
    border: '1px solid #333',
    color: '#666',
    borderRadius: 3,
    padding: '3px 8px',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  grid: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 20,
  },
  section: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 10,
    color: '#569cd6',
    fontFamily: 'monospace',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
    borderBottom: '1px solid #1e1e1e',
    paddingBottom: 4,
  },
  statRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap' as const,
  },
  loading: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#555',
    fontFamily: 'monospace',
    fontSize: 12,
  },
}

const cardStyles = {
  card: {
    background: '#111',
    border: '1px solid #1e1e1e',
    borderRadius: 4,
    padding: '10px 16px',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    minWidth: 80,
  },
  value: {
    fontSize: 22,
    fontFamily: 'monospace',
    fontWeight: 'bold' as const,
    lineHeight: 1,
  },
  label: {
    fontSize: 10,
    color: '#555',
    fontFamily: 'monospace',
    marginTop: 4,
    textAlign: 'center' as const,
  },
}

const barStyles = {
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  label: {
    fontSize: 11,
    color: '#888',
    fontFamily: 'monospace',
    width: 120,
    flexShrink: 0,
  },
  track: {
    flex: 1,
    height: 6,
    background: '#1e1e1e',
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
    transition: 'width 0.3s ease',
  },
  pct: {
    fontSize: 10,
    color: '#555',
    fontFamily: 'monospace',
    width: 32,
    textAlign: 'right' as const,
  },
}
