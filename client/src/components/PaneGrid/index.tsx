import { useState, useEffect } from 'react'
import { TerminalPane } from '../TerminalPane/index.js'
import { ConsolePanel } from '../ConsolePanel/index.js'
import type { Tab, Agent } from '../../store/index.js'
import { useStore } from '../../store/index.js'
import { apiFetch } from '../../lib/api.js'
import { cn } from '../../lib/utils.js'

let consoleCounter = 0
function newConsoleId() { return `console:${++consoleCounter}` }

const STATUS_COLOR: Record<Agent['status'], string> = {
  idle: 'text-text-secondary',
  working: 'text-block-teal',
  stalled: 'text-orange',
  zombie: 'text-text-danger',
  done: 'text-green-600',
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
        body: JSON.stringify({ cols: 120, rows: 30 }),
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
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <p className="font-mono text-sm text-text-secondary">No panes open</p>
        <div className="flex gap-2">
          <button
            className="cursor-pointer rounded border border-block-teal bg-bg-secondary px-4 py-2 font-mono text-[13px] text-block-teal hover:bg-block-teal/10"
            onClick={addTerminal}
          >
            + Terminal
          </button>
          <button
            className="cursor-pointer rounded border border-block-teal bg-bg-secondary px-4 py-2 font-mono text-[13px] text-block-teal hover:bg-block-teal/10"
            onClick={addConsole}
          >
            + Console
          </button>
        </div>
      </div>
    )
  }

  // Panes to render in split mode: all, single mode: just the focused one
  const visiblePanes = splitMode ? tab.panes : [tab.panes[safeFocusedIdx]]

  const gridCols = splitMode
    ? tab.panes.length === 1
      ? 'grid-cols-1'
      : tab.panes.length === 2
        ? 'grid-cols-2'
        : `grid-cols-${Math.ceil(tab.panes.length / 2)}`
    : 'grid-cols-1'

  const gridRows = splitMode && tab.panes.length > 2 ? 'grid-rows-2' : 'grid-rows-1'

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Agent switcher bar */}
      <div className="flex shrink-0 items-center overflow-hidden border-b border-border-primary bg-bg-primary" style={{ minHeight: 34 }}>
        <div className="flex flex-1 items-stretch overflow-x-auto" style={{ minHeight: 34 }}>
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
                className={cn(
                  'flex min-w-[80px] shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap border-r border-border-primary px-2.5 font-mono text-[11px] text-text-tertiary',
                  isFocused && !splitMode && 'border-b-2 border-b-block-teal bg-bg-primary text-text-primary'
                )}
                onClick={() => { setFocusedIdx(i); setSplitMode(false) }}
              >
                {status && (
                  <span className={cn('shrink-0 text-[9px]', STATUS_COLOR[status])}>
                    {STATUS_DOT[status]}
                  </span>
                )}
                {isConsole && <span className="shrink-0 text-[9px] text-block-teal">▸</span>}
                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
                <button
                  className="shrink-0 cursor-pointer border-none bg-transparent px-0.5 text-[9px] leading-none text-text-disabled hover:text-text-danger"
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

        <div className="flex shrink-0 items-center gap-1 border-l border-border-primary px-2">
          <button
            className={cn(
              'cursor-pointer whitespace-nowrap rounded border border-border-primary bg-transparent px-2 py-0.5 font-mono text-[11px] text-block-teal hover:border-block-teal',
              splitMode && 'border-block-teal bg-block-teal/10'
            )}
            onClick={() => setSplitMode((s) => !s)}
            title={splitMode ? 'Focus mode' : 'Split mode — show all panes'}
          >
            {splitMode ? '▣' : '⊞'}
          </button>
          <button
            className="cursor-pointer whitespace-nowrap rounded border border-border-primary bg-transparent px-2 py-0.5 font-mono text-[11px] text-block-teal hover:border-block-teal"
            onClick={addTerminal}
            title="New terminal"
          >
            + term
          </button>
          <button
            className="cursor-pointer whitespace-nowrap rounded border border-border-primary bg-transparent px-2 py-0.5 font-mono text-[11px] text-block-teal hover:border-block-teal"
            onClick={addConsole}
            title="New sq console"
          >
            + sq
          </button>
        </div>
      </div>

      {/* Pane area */}
      <div className={cn('flex-1 grid gap-1 overflow-hidden p-1', gridCols, gridRows)}>
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
                    body: JSON.stringify({ cols: 120, rows: 30 }),
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
    <div className="flex h-full flex-col overflow-hidden rounded border border-border-primary">
      <div className="flex shrink-0 items-center justify-between border-b border-border-primary bg-bg-secondary px-2 py-1">
        <span className="font-mono text-xs tracking-wide text-block-teal">
          sq console {num}
        </span>
        <button
          className="cursor-pointer border-none bg-transparent px-1 text-xs text-text-secondary hover:text-text-danger"
          onClick={onClose}
        >✕</button>
      </div>
      <div className="flex-1 overflow-hidden">
        <ConsolePanel />
      </div>
    </div>
  )
}
