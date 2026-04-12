import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore } from '../../store/index.js'
import { cn } from '../../lib/utils.js'
import { Monitor, Columns3, BarChart3, Activity, DollarSign, Terminal, Code2, PanelLeft, Settings } from 'lucide-react'
import type { MainView } from '../../store/index.js'

interface Cmd { id: string; label: string; shortcut?: string; icon: React.ReactNode; section: string; action: () => void }

export function CommandPalette() {
  const ui = useStore((s) => s.ui)
  const close = useStore((s) => s.toggleCommandPalette)
  const setMainView = useStore((s) => s.setMainView)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const setShowPreferences = useStore((s) => s.setShowPreferences)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const ic = 'w-4 h-4 text-text-tertiary'

  const commands: Cmd[] = [
    { id: 'v1', label: 'Terminals', shortcut: '⌘1', icon: <Monitor className={ic} />, section: 'Views', action: () => { setMainView('terminals'); close() } },
    { id: 'v2', label: 'Kanban', shortcut: '⌘2', icon: <Columns3 className={ic} />, section: 'Views', action: () => { setMainView('kanban'); close() } },
    { id: 'v3', label: 'Metrics', shortcut: '⌘3', icon: <BarChart3 className={ic} />, section: 'Views', action: () => { setMainView('metrics'); close() } },
    { id: 'v4', label: 'Events', shortcut: '⌘4', icon: <Activity className={ic} />, section: 'Views', action: () => { setMainView('events'); close() } },
    { id: 'v5', label: 'Costs', shortcut: '⌘5', icon: <DollarSign className={ic} />, section: 'Views', action: () => { setMainView('costs'); close() } },
    { id: 'v6', label: 'Console', shortcut: '⌘6', icon: <Terminal className={ic} />, section: 'Views', action: () => { setMainView('console'); close() } },
    { id: 'v7', label: 'Claude Code', shortcut: '⌘7', icon: <Code2 className={ic} />, section: 'Views', action: () => { setMainView('claudecode'); close() } },
    { id: 'sb', label: 'Toggle Sidebar', shortcut: '⌘B', icon: <PanelLeft className={ic} />, section: 'Layout', action: () => { toggleSidebar(); close() } },
    { id: 'pr', label: 'Settings', shortcut: '⌘,', icon: <Settings className={ic} />, section: 'Settings', action: () => { setShowPreferences(true); close() } },
  ]

  const filtered = query ? commands.filter(c => c.label.toLowerCase().includes(query.toLowerCase())) : commands
  const [sel, setSel] = useState(0)
  useEffect(() => setSel(0), [query])
  useEffect(() => { if (ui.commandPaletteOpen) { setQuery(''); setTimeout(() => inputRef.current?.focus(), 50) } }, [ui.commandPaletteOpen])

  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') close()
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(i => Math.min(i + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && filtered[sel]) filtered[sel].action()
  }, [filtered, sel, close])

  if (!ui.commandPaletteOpen) return null

  const sections = new Map<string, Cmd[]>()
  for (const c of filtered) { const l = sections.get(c.section) ?? []; l.push(c); sections.set(c.section, l) }
  let idx = 0

  return (
    <div className="fixed inset-0 bg-black/10 backdrop-blur-[2px] flex justify-center pt-[20%] z-[10000]" onClick={close}>
      <div className="w-[520px] max-h-[400px] bg-bg-primary border border-border-primary rounded-xl overflow-hidden flex flex-col shadow-default" onClick={e => e.stopPropagation()} onKeyDown={onKey}>
        <input ref={inputRef} className="bg-transparent border-b border-border-primary text-text-primary px-5 py-4 text-[15px] outline-none w-full placeholder:text-text-tertiary font-light" placeholder="Search commands…" value={query} onChange={e => setQuery(e.target.value)} autoFocus />
        <div className="overflow-auto py-1.5">
          {!filtered.length && <p className="text-center text-text-tertiary py-8 text-sm">No results</p>}
          {[...sections.entries()].map(([sec, cmds]) => (
            <div key={sec}>
              <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider px-5 pt-3 pb-1">{sec}</p>
              {cmds.map(c => { const i = idx++; return (
                <div key={c.id} className={cn('flex items-center gap-3 px-5 py-2.5 cursor-pointer transition-colors text-[13px]', i === sel ? 'bg-bg-secondary text-text-primary' : 'text-text-secondary hover:bg-bg-secondary/50')}
                  onClick={c.action} onMouseEnter={() => setSel(i)}>
                  {c.icon}
                  <span className="flex-1">{c.label}</span>
                  {c.shortcut && <kbd className="text-[11px] text-text-tertiary font-mono bg-bg-secondary rounded px-1.5 py-0.5">{c.shortcut}</kbd>}
                </div>
              )})}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
