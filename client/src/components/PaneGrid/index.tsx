import { TerminalPane } from '../TerminalPane/index.js'
import { ConsolePanel } from '../ConsolePanel/index.js'
import type { Tab } from '../../store/index.js'
import { useStore } from '../../store/index.js'
import { apiFetch } from '../../lib/api.js'

let consoleCounter = 0
function newConsoleId() { return `console:${++consoleCounter}` }

interface Props {
  tab: Tab
}

export function PaneGrid({ tab }: Props) {
  const addPaneToTab = useStore((s) => s.addPaneToTab)
  const removePaneFromTab = useStore((s) => s.removePaneFromTab)
  const replacePaneInTab = useStore((s) => s.replacePaneInTab)
  const updateTabLayout = useStore((s) => s.updateTabLayout)
  const agents = useStore((s) => s.agents)

  const addTerminal = async () => {
    const res = await apiFetch('/api/terminals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols: 120, rows: 30 }),
    })
    const { id } = await res.json()
    addPaneToTab(tab.id, id)
  }

  const addConsole = () => addPaneToTab(tab.id, newConsoleId())

  if (tab.panes.length === 0) {
    return (
      <div style={styles.empty}>
        <p style={styles.emptyText}>No panes open</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={styles.spawnBtn} onClick={addTerminal}>+ Terminal</button>
          <button style={styles.spawnBtn} onClick={addConsole}>+ Console</button>
        </div>
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
        <button style={styles.addBtn} onClick={addTerminal} title="New terminal">+ term</button>
        <button style={styles.addBtn} onClick={addConsole} title="New sq console">+ sq</button>
      </div>
      <div style={gridStyle}>
        {tab.panes.map((sessionId) => {
          if (sessionId.startsWith('console:')) {
            return (
              <ConsolePane
                key={sessionId}
                paneId={sessionId}
                onClose={() => removePaneFromTab(tab.id, sessionId)}
              />
            )
          }
          const agentName = agents.find((a) => a.sessionId === sessionId)?.name
          return (
            <TerminalPane
              key={sessionId}
              sessionId={sessionId}
              label={agentName ?? sessionId.slice(0, 8)}
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
          )
        })}
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

function ConsolePane({ paneId, onClose }: { paneId: string; onClose: () => void }) {
  const num = paneId.split(':')[1]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', border: '1px solid #2d2d2d', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', background: '#1a1a1a', borderBottom: '1px solid #2d2d2d', flexShrink: 0 }}>
        <span style={{ color: '#4ec9b0', fontSize: 12, fontFamily: 'monospace', letterSpacing: '0.05em' }}>
          sq console {num}
        </span>
        <button
          style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 12, padding: '0 4px' }}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <ConsolePanel />
      </div>
    </div>
  )
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
