import { useState, useEffect } from 'react'
import { TerminalPane } from '../TerminalPane/index.js'
import { ConsolePanel } from '../ConsolePanel/index.js'
import type { Tab, Agent } from '../../store/index.js'
import { useStore } from '../../store/index.js'
import { apiFetch } from '../../lib/api.js'

let consoleCounter = 0
function newConsoleId() { return `console:${++consoleCounter}` }

const STATUS_COLOR: Record<Agent['status'], string> = {
  idle: '#666',
  working: '#4ec9b0',
  stalled: '#ce9178',
  zombie: '#f44747',
  done: '#608b4e',
}
const STATUS_DOT: Record<Agent['status'], string> = {
  idle: '○', working: '●', stalled: '◐', zombie: '✕', done: '✓',
}

interface Props { tab: Tab }

export function PaneGrid({ tab }: Props) {
  const addPaneToTab = useStore((s) => s.addPaneToTab)
  const removePaneFromTab = useStore((s) => s.removePaneFromTab)
  const replacePaneInTab = useStore((s) => s.replacePaneInTab)
  const agents = useStore((s) => s.agents)

  // Track which pane is focused (index into tab.panes)
  const [focusedIdx, setFocusedIdx] = useState(0)
  // Whether to show multiple panes (split mode) vs single focused pane
  const [splitMode, setSplitMode] = useState(false)

  // When a new pane is added, auto-focus it
  useEffect(() => {
    if (tab.panes.length > 0) {
      setFocusedIdx(tab.panes.length - 1)
    }
  }, [tab.panes.length])

  // Clamp focused index if panes shrink
  const safeFocusedIdx = Math.min(focusedIdx, Math.max(0, tab.panes.length - 1))

  const addTerminal = async () => {
    try {
      const res = await apiFetch('/api/terminals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cols: 120, rows: 30, shell: 'bash' }),
      })
      const body = await res.json()
      if (!res.ok) { addToast(`Failed to open terminal: ${body.error ?? res.status}`); return }
      addPaneToTab(tab.id, body.id)
    } catch (err) {
      addToast(`Failed to open terminal: ${(err as Error).message}`)
    }
  }

  const addToast = useStore((s) => s.addToast)
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

  // Panes to render in split mode: all, single mode: just the focused one
  const visiblePanes = splitMode ? tab.panes : [tab.panes[safeFocusedIdx]]

  const gridStyle: React.CSSProperties = splitMode
    ? {
        flex: 1,
        display: 'grid',
        gap: 4,
        padding: 4,
        overflow: 'hidden',
        gridTemplateColumns: tab.panes.length === 1 ? '1fr' : tab.panes.length === 2 ? '1fr 1fr' : `repeat(${Math.ceil(tab.panes.length / 2)}, 1fr)`,
        gridTemplateRows: tab.panes.length > 2 ? '1fr 1fr' : '1fr',
      }
    : {
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '1fr',
        overflow: 'hidden',
        padding: 4,
      }

  return (
    <div style={styles.wrapper}>
      {/* Agent switcher bar */}
      <div style={styles.switcherBar}>
        <div style={styles.switcherTabs}>
          {tab.panes.map((sessionId, i) => {
            const agent = agents.find((a) => a.sessionId === sessionId)
            const isConsole = sessionId.startsWith('console:')
            const label = isConsole
              ? `sq ${sessionId.split(':')[1]}`
              : (agent?.name ?? sessionId.slice(0, 8))
            const status = agent?.status
            const isFocused = i === safeFocusedIdx

            return (
              <div
                key={sessionId}
                style={{ ...styles.switcherTab, ...(isFocused && !splitMode ? styles.switcherTabActive : {}) }}
                onClick={() => { setFocusedIdx(i); setSplitMode(false) }}
              >
                {status && (
                  <span style={{ color: STATUS_COLOR[status], fontSize: 9, flexShrink: 0 }}>
                    {STATUS_DOT[status]}
                  </span>
                )}
                {isConsole && <span style={{ color: '#4ec9b0', fontSize: 9, flexShrink: 0 }}>▸</span>}
                <span style={styles.switcherLabel}>{label}</span>
                <button
                  style={styles.switcherClose}
                  onClick={(e) => {
                    e.stopPropagation()
                    removePaneFromTab(tab.id, sessionId)
                  }}
                  title="Close"
                >✕</button>
              </div>
            )
          })}
        </div>

        <div style={styles.switcherActions}>
          <button
            style={{ ...styles.actionBtn, ...(splitMode ? styles.actionBtnActive : {}) }}
            onClick={() => setSplitMode((s) => !s)}
            title={splitMode ? 'Focus mode' : 'Split mode — show all panes'}
          >
            {splitMode ? '▣' : '⊞'}
          </button>
          <button style={styles.actionBtn} onClick={addTerminal} title="New terminal">+ term</button>
          <button style={styles.actionBtn} onClick={addConsole} title="New sq console">+ sq</button>
        </div>
      </div>

      {/* Pane area */}
      <div style={gridStyle}>
        {visiblePanes.map((sessionId) => {
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
                try {
                  const res = await apiFetch('/api/terminals', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cols: 120, rows: 30, shell: 'bash' }),
                  })
                  const body = await res.json()
                  if (!res.ok) { addToast(`Reconnect failed: ${body.error ?? res.status}`); return }
                  replacePaneInTab(tab.id, sessionId, body.id)
                } catch (err) {
                  addToast(`Reconnect failed: ${(err as Error).message}`)
                }
              }}
            />
          )
        })}
      </div>
    </div>
  )
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
        >✕</button>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <ConsolePanel />
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
  },
  switcherBar: {
    display: 'flex',
    alignItems: 'center',
    background: '#111',
    borderBottom: '1px solid #2d2d2d',
    flexShrink: 0,
    minHeight: 34,
    overflow: 'hidden',
  },
  switcherTabs: {
    display: 'flex',
    flex: 1,
    overflowX: 'auto',
    alignItems: 'stretch',
    minHeight: 34,
  },
  switcherTab: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '0 10px',
    cursor: 'pointer',
    borderRight: '1px solid #222',
    color: '#555',
    fontSize: 11,
    fontFamily: 'monospace',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    minWidth: 80,
    flexShrink: 0,
  },
  switcherTabActive: {
    color: '#d4d4d4',
    background: '#0d0d0d',
    borderBottom: '2px solid #4ec9b0',
  },
  switcherLabel: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  switcherClose: {
    background: 'none',
    border: 'none',
    color: '#444',
    cursor: 'pointer',
    fontSize: 9,
    padding: '0 2px',
    flexShrink: 0,
    lineHeight: 1,
  },
  switcherActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '0 8px',
    borderLeft: '1px solid #2d2d2d',
    flexShrink: 0,
  },
  actionBtn: {
    background: 'none',
    border: '1px solid #333',
    color: '#4ec9b0',
    borderRadius: 3,
    padding: '2px 8px',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'monospace',
    whiteSpace: 'nowrap',
  },
  actionBtnActive: {
    borderColor: '#4ec9b0',
    background: '#0a1a14',
  },
  empty: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
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
