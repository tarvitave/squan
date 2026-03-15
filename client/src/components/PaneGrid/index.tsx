import { TerminalPane } from '../TerminalPane/index.js'
import type { Tab } from '../../store/index.js'
import { useStore } from '../../store/index.js'
import { apiFetch } from '../../lib/api.js'

interface Props {
  tab: Tab
}

export function PaneGrid({ tab }: Props) {
  const addPaneToTab = useStore((s) => s.addPaneToTab)
  const removePaneFromTab = useStore((s) => s.removePaneFromTab)
  const replacePaneInTab = useStore((s) => s.replacePaneInTab)
  const updateTabLayout = useStore((s) => s.updateTabLayout)

  if (tab.panes.length === 0) {
    return (
      <div style={styles.empty}>
        <p style={styles.emptyText}>No terminals open</p>
        <button
          style={styles.spawnBtn}
          onClick={async () => {
            const res = await apiFetch('/api/terminals', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cols: 120, rows: 30 }),
            })
            const { id } = await res.json()
            addPaneToTab(tab.id, id)
          }}
        >
          + New Terminal
        </button>
      </div>
    )
  }

  const gridStyle = getGridStyle(tab.layout, tab.panes.length)

  return (
    <div style={styles.wrapper}>
      <div style={styles.layoutBar}>
        {(['single', 'split-h', 'split-v', 'quad'] as Tab['layout'][]).map((l) => (
          <button
            key={l}
            style={{ ...styles.layoutBtn, ...(tab.layout === l ? styles.layoutBtnActive : {}) }}
            onClick={() => updateTabLayout(tab.id, l)}
            title={l}
          >
            {LAYOUT_ICONS[l]}
          </button>
        ))}
        <button
          style={styles.addBtn}
          onClick={async () => {
            const res = await apiFetch('/api/terminals', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cols: 120, rows: 30 }),
            })
            const { id } = await res.json()
            addPaneToTab(tab.id, id)
          }}
        >
          +
        </button>
      </div>
      <div style={gridStyle}>
        {tab.panes.map((sessionId) => (
          <TerminalPane
            key={sessionId}
            sessionId={sessionId}
            label={sessionId.slice(0, 8)}
            onClose={() => removePaneFromTab(tab.id, sessionId)}
            onReconnect={async () => {
              const res = await apiFetch('/api/terminals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cols: 120, rows: 30, args: ['--continue'] }),
              })
              const { id } = await res.json()
              replacePaneInTab(tab.id, sessionId, id)
            }}
          />
        ))}
      </div>
    </div>
  )
}

function getGridStyle(layout: Tab['layout'], count: number): React.CSSProperties {
  const base: React.CSSProperties = {
    flex: 1,
    display: 'grid',
    gap: 4,
    padding: 4,
    overflow: 'hidden',
  }

  switch (layout) {
    case 'split-h':
      return { ...base, gridTemplateColumns: `repeat(${Math.min(count, 2)}, 1fr)` }
    case 'split-v':
      return { ...base, gridTemplateRows: `repeat(${Math.min(count, 2)}, 1fr)` }
    case 'quad':
      return { ...base, gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }
    default:
      return { ...base, gridTemplateColumns: '1fr' }
  }
}

const LAYOUT_ICONS: Record<Tab['layout'], string> = {
  single: '▣',
  'split-h': '⬛⬛',
  'split-v': '⬜',
  quad: '⊞',
}

const styles = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    overflow: 'hidden',
  },
  layoutBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 8px',
    background: '#111',
    borderBottom: '1px solid #2d2d2d',
    flexShrink: 0,
  },
  layoutBtn: {
    background: 'none',
    border: '1px solid #333',
    color: '#888',
    borderRadius: 3,
    padding: '2px 6px',
    cursor: 'pointer',
    fontSize: 12,
  },
  layoutBtnActive: {
    borderColor: '#4ec9b0',
    color: '#4ec9b0',
  },
  addBtn: {
    background: 'none',
    border: '1px solid #333',
    color: '#4ec9b0',
    borderRadius: 3,
    padding: '2px 8px',
    cursor: 'pointer',
    fontSize: 14,
    marginLeft: 'auto',
  },
  empty: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  emptyText: {
    color: '#aaa',
    fontFamily: 'monospace',
    fontSize: 14,
  },
  spawnBtn: {
    background: '#1a1a1a',
    border: '1px solid #4ec9b0',
    color: '#4ec9b0',
    borderRadius: 4,
    padding: '8px 16px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: 13,
  },
}
