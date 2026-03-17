import { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api.js'

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
  done: '#608b4e',
  zombie: '#f44747',
  stalled: '#ce9178',
  working: '#4ec9b0',
  idle: '#666',
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 6, background: '#1a1a1a', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace', minWidth: 20, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

export function CostPanel() {
  const [data, setData] = useState<CostSummary | null>(null)
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    apiFetch('/api/costs/summary')
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  if (loading) return <div style={styles.loading}>loading…</div>
  if (!data) return <div style={styles.loading}>failed to load</div>

  const done = data.byStatus['done'] ?? 0
  const zombie = data.byStatus['zombie'] ?? 0
  const stalled = data.byStatus['stalled'] ?? 0
  const successRate = data.totalSpawned > 0 ? Math.round((done / data.totalSpawned) * 100) : 0
  const maxDaily = Math.max(...data.daily.map((d) => d.spawned), 1)

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>API Usage & Costs</span>
        <a
          href="https://console.anthropic.com/settings/usage"
          target="_blank"
          rel="noopener noreferrer"
          style={styles.consoleLink}
        >
          view billing in Anthropic Console ↗
        </a>
      </div>

      <div style={styles.body}>
        {/* API key status */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>API Key</div>
          {data.hasApiKey ? (
            <div style={styles.keyRow}>
              <span style={styles.keyDot}>●</span>
              <span style={styles.keyMasked}>{data.apiKeyMasked}</span>
              <span style={styles.keyNote}>Agents bill to this key · pay-as-you-go</span>
            </div>
          ) : (
            <div style={styles.noKey}>
              No API key configured — Agents are using Claude Pro subscription.
              Add an API key in your account settings to use pay-as-you-go billing.
            </div>
          )}
        </div>

        {/* Totals */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>All-time Activity</div>
          <div style={styles.statGrid}>
            <StatBox label="Total tasks" value={data.totalSpawned} color="#569cd6" />
            <StatBox label="Completed" value={done} color="#608b4e" />
            <StatBox label="Zombied" value={zombie} color="#f44747" />
            <StatBox label="Stalled" value={stalled} color="#ce9178" />
            <StatBox label="Success rate" value={`${successRate}%`} color={successRate > 70 ? '#608b4e' : '#ce9178'} />
          </div>
        </div>

        {/* 30-day daily chart */}
        {data.daily.length > 0 && (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Last 30 Days</div>
            <div style={styles.dailyChart}>
              {data.daily.map((row) => (
                <div key={row.day} style={styles.dailyRow}>
                  <span style={styles.dailyDay}>{row.day.slice(5)}</span>
                  <div style={{ flex: 1 }}>
                    <Bar value={row.done} max={maxDaily} color="#608b4e" />
                    {row.zombie > 0 && <Bar value={row.zombie} max={maxDaily} color="#f44747" />}
                  </div>
                  <span style={styles.dailyTotal}>{row.spawned}</span>
                </div>
              ))}
            </div>
            <div style={styles.chartLegend}>
              <span style={{ color: '#608b4e' }}>■ done</span>
              <span style={{ color: '#f44747' }}>■ zombie</span>
            </div>
          </div>
        )}

        {/* Recent tasks */}
        {data.recent.length > 0 && (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Recent Tasks</div>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>agent</th>
                  <th style={styles.th}>task</th>
                  <th style={styles.th}>status</th>
                  <th style={styles.th}>duration</th>
                  <th style={styles.th}>started</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((bee, i) => (
                  <tr key={i} style={styles.tr}>
                    <td style={styles.td}>{bee.name}</td>
                    <td style={{ ...styles.td, color: '#888', maxWidth: 260 }}>{bee.task || '—'}</td>
                    <td style={{ ...styles.td, color: STATUS_COLOR[bee.status] ?? '#666' }}>{bee.status}</td>
                    <td style={styles.td}>{fmt(bee.durationMs)}</td>
                    <td style={{ ...styles.td, color: '#444' }}>
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
        <div style={styles.callout}>
          <div style={styles.calloutTitle}>Exact billing data</div>
          <div style={styles.calloutBody}>
            Squansq tracks task activity but cannot read token counts or dollar amounts directly from
            the Anthropic API. For exact usage and costs, visit the{' '}
            <a
              href="https://console.anthropic.com/settings/usage"
              target="_blank"
              rel="noopener noreferrer"
              style={styles.calloutLink}
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
    <div style={styles.statBox}>
      <div style={{ ...styles.statValue, color }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  )
}

const styles = {
  root: { display: 'flex', flexDirection: 'column' as const, height: '100%', overflow: 'hidden' },
  loading: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontFamily: 'monospace', fontSize: 12 },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 20px', borderBottom: '1px solid #1e1e1e', background: '#0f0f0f', flexShrink: 0,
  },
  headerTitle: { fontSize: 13, color: '#d4d4d4', fontFamily: 'monospace', fontWeight: 'bold' as const },
  consoleLink: {
    fontSize: 11, color: '#569cd6', fontFamily: 'monospace', textDecoration: 'none',
  },
  body: { flex: 1, overflow: 'auto', padding: '20px', display: 'flex', flexDirection: 'column' as const, gap: 28 },
  section: { display: 'flex', flexDirection: 'column' as const, gap: 10 },
  sectionTitle: {
    fontSize: 10, color: '#569cd6', fontFamily: 'monospace',
    textTransform: 'uppercase' as const, letterSpacing: '0.1em',
    borderBottom: '1px solid #1a1a1a', paddingBottom: 6,
  },
  keyRow: { display: 'flex', alignItems: 'center', gap: 8 },
  keyDot: { color: '#608b4e', fontSize: 10 },
  keyMasked: { fontSize: 12, color: '#d4d4d4', fontFamily: 'monospace' },
  keyNote: { fontSize: 10, color: '#555', fontFamily: 'monospace' },
  noKey: { fontSize: 11, color: '#ce9178', fontFamily: 'monospace', lineHeight: 1.6, background: '#1a1010', border: '1px solid #3a2020', borderRadius: 4, padding: '10px 14px' },
  statGrid: { display: 'flex', gap: 12, flexWrap: 'wrap' as const },
  statBox: {
    background: '#111', border: '1px solid #1e1e1e', borderRadius: 4,
    padding: '12px 18px', minWidth: 90, textAlign: 'center' as const,
  },
  statValue: { fontSize: 24, fontFamily: 'monospace', fontWeight: 'bold' as const, lineHeight: 1 },
  statLabel: { fontSize: 9, color: '#555', fontFamily: 'monospace', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginTop: 4 },
  dailyChart: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  dailyRow: { display: 'flex', alignItems: 'center', gap: 10 },
  dailyDay: { fontSize: 10, color: '#444', fontFamily: 'monospace', width: 32, flexShrink: 0 },
  dailyTotal: { fontSize: 10, color: '#333', fontFamily: 'monospace', width: 20, textAlign: 'right' as const },
  chartLegend: { display: 'flex', gap: 12, fontSize: 9, fontFamily: 'monospace', color: '#555', paddingTop: 4 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 11, fontFamily: 'monospace' },
  th: { textAlign: 'left' as const, color: '#444', fontSize: 9, textTransform: 'uppercase' as const, letterSpacing: '0.06em', padding: '4px 8px', borderBottom: '1px solid #1a1a1a' },
  tr: { borderBottom: '1px solid #0f0f0f' },
  td: { padding: '5px 8px', color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  callout: { background: '#0c0c0c', border: '1px solid #1e1e1e', borderRadius: 4, padding: '14px 16px' },
  calloutTitle: { fontSize: 10, color: '#555', fontFamily: 'monospace', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 6 },
  calloutBody: { fontSize: 11, color: '#666', fontFamily: 'monospace', lineHeight: 1.7 },
  calloutLink: { color: '#569cd6', textDecoration: 'none' },
}
