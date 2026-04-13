import { useEffect, useRef, useState, useCallback, Component } from 'react'
import { Bot, Terminal as TerminalIcon } from 'lucide-react'
import type { ReactNode, ErrorInfo } from 'react'
import { apiFetch } from './lib/api.js'
import { TabBar } from './components/TabBar/index.js'
import { PaneGrid } from './components/PaneGrid/index.js'
import { EventStream } from './components/EventStream/index.js'
import { AuthPage } from './components/AuthPage/index.js'
import { KanbanView } from './components/KanbanView/index.js'
import { ConsolePanel } from './components/ConsolePanel/index.js'
// ClaudeCodePanel removed — agents now use DirectRunner with Goose-style chat
import { MetricsPanel } from './components/MetricsPanel/index.js'
import { CostPanel } from './components/CostPanel/index.js'
import { ToastContainer } from './components/Toast/index.js'
import { Sidebar } from './components/Sidebar/index.js'
import { CommandPalette } from './components/CommandPalette/index.js'
import { PreferencesPanel } from './components/PreferencesPanel/index.js'
import { AgentChat } from './components/AgentChat/index.js'
import { cn } from './lib/utils.js'
import { useStore } from './store/index.js'
import { useWebSocket } from './hooks/useWebSocket.js'
import { StatusBar } from './components/StatusBar/index.js'
import { PanelLeft } from 'lucide-react'
import type { MainView } from './store/index.js'

/* ────────────────────────────────────────────────────────
   Goose-style layout:
   ┌─ bg-secondary shell (with 2px padding) ───────────┐
   │ ┌── nav panel ─┬── bg-primary rounded-lg card ──┐ │
   │ │ sidebar       │                                 │ │
   │ │               │    main content fills card      │ │
   │ │               │                                 │ │
   │ └───────────────┴─────────────────────────────────┘ │
   └─────────────────────────────────────────────────────┘
   ──────────────────────────────────────────────────────── */

// ── Error boundary ──────────────────────────────────────

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null }
  componentDidCatch(err: Error, info: ErrorInfo) { console.error(err, info); this.setState({ error: err.message }) }
  render() {
    if (this.state.error) return (
      <div className="p-8">
        <div className="bg-red-200/10 border border-border-danger text-text-danger rounded-xl p-4 text-sm">
          <p className="font-medium mb-1">Render error</p>
          <pre className="text-xs whitespace-pre-wrap">{this.state.error}</pre>
          <button className="mt-3 text-xs underline" onClick={() => this.setState({ error: null })}>dismiss</button>
        </div>
      </div>
    )
    return this.props.children
  }
}

// ── Agent Dashboard ─────────────────────────────────────

function AgentDashboard({ activeTab }: { activeTab: any }) {
  const agents = useStore((s) => s.agents)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const storeSelectedId = useStore((s) => s.selectedAgentId)
  const setStoreSelectedId = useStore((s) => s.setSelectedAgentId)
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null)

  // Use store selection if set (from sidebar click), otherwise local
  const selectedAgentId = storeSelectedId ?? localSelectedId
  const setSelectedAgentId = (id: string | null) => {
    setLocalSelectedId(id)
    setStoreSelectedId(null) // Clear store selection after using it
  }

  const projectAgents = activeProjectId
    ? agents.filter((a) => a.projectId === activeProjectId)
    : agents

  const workingAgents = projectAgents.filter((a) => ['working', 'idle', 'stalled'].includes(a.status))
  const doneAgents = projectAgents.filter((a) => a.status === 'done').slice(0, 5)
  const allVisible = [...workingAgents, ...doneAgents]

  // Auto-select: store selection (from sidebar) → first working agent → first visible
  useEffect(() => {
    if (storeSelectedId && allVisible.find(a => a.id === storeSelectedId)) {
      setLocalSelectedId(storeSelectedId)
      setStoreSelectedId(null)
    } else if (!selectedAgentId && workingAgents.length > 0) {
      setLocalSelectedId(workingAgents[0].id)
    }
  }, [storeSelectedId, workingAgents.length])

  if (allVisible.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-tertiary">
        <Bot className="w-10 h-10" />
        <p className="text-lg">No active agents</p>
        <p className="text-sm">Dispatch an agent from the Kanban board or Console</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Agent tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border-primary bg-bg-secondary overflow-x-auto shrink-0">
        {allVisible.map((agent) => (
          <button
            key={agent.id}
            onClick={() => setSelectedAgentId(agent.id)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors shrink-0 ${
              selectedAgentId === agent.id
                ? 'bg-bg-primary text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-primary/50'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${
              agent.status === 'working' ? 'bg-block-teal' :
              agent.status === 'done' ? 'bg-green-500' :
              agent.status === 'stalled' ? 'bg-yellow-500' : 'bg-text-disabled'
            }`} />
            {agent.name}
          </button>
        ))}
        {/* Fallback to terminal tab */}
        {activeTab && (
          <button
            onClick={() => setSelectedAgentId(null)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors shrink-0 ${
              selectedAgentId === null
                ? 'bg-bg-primary text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-primary/50'
            }`}
          >
            <TerminalIcon className="w-3 h-3" />
            Terminal
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {selectedAgentId ? (
          <AgentChat
            workerbeeId={selectedAgentId}
            taskDescription={allVisible.find((a) => a.id === selectedAgentId)?.taskDescription}
          />
        ) : activeTab ? (
          <PaneGrid tab={activeTab} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-tertiary">
            <p>Select an agent above</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── App ─────────────────────────────────────────────────

export default function App() {
  const token = useStore((s) => s.token)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const mainView = useStore((s) => s.mainView)
  const setMainView = useStore((s) => s.setMainView)
  const setAgents = useStore((s) => s.setAgents)
  const setReleaseTrains = useStore((s) => s.setReleaseTrains)
  const setAtomicTasks = useStore((s) => s.setAtomicTasks)
  const setTemplates = useStore((s) => s.setTemplates)
  const clearAllPanes = useStore((s) => s.clearAllPanes)
  const ui = useStore((s) => s.ui)
  const toggleCommandPalette = useStore((s) => s.toggleCommandPalette)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const setShowPreferences = useStore((s) => s.setShowPreferences)
  const activeTownId = useStore((s) => s.activeTownId)
  const { connected, serverRestarted, clearServerRestarted } = useWebSocket()

  // Keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const m = e.metaKey || e.ctrlKey
      if (m && e.key === 'k') { e.preventDefault(); toggleCommandPalette() }
      if (m && e.key === 'b') { e.preventDefault(); toggleSidebar() }
      if (m && e.key === ',') { e.preventDefault(); setShowPreferences(true) }
      if (m && e.key >= '1' && e.key <= '7') {
        e.preventDefault()
        const views: MainView[] = ['terminals', 'kanban', 'metrics', 'events', 'costs', 'console']
        setMainView(views[parseInt(e.key) - 1] ?? 'terminals')
      }
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [toggleCommandPalette, toggleSidebar, setShowPreferences, setMainView])

  // Electron IPC
  useEffect(() => {
    const c: (() => void)[] = []
    if (window.squan) {
      c.push(window.squan.onSwitchView((v) => setMainView(v as MainView)))
      c.push(window.squan.onToggleCommandPalette(toggleCommandPalette))
      c.push(window.squan.onToggleSidebar(toggleSidebar))
      c.push(window.squan.onOpenPreferences(() => setShowPreferences(true)))
    }
    return () => c.forEach((f) => f())
  }, [setMainView, toggleCommandPalette, toggleSidebar, setShowPreferences])

  // Data loading
  const loadData = useCallback(() => {
    apiFetch('/api/workerbees').then(r => r.json()).then((d: Array<{
      id: string; name: string; projectId: string; role?: string; status: string;
      sessionId: string | null; taskDescription?: string; completionNote?: string;
      worktreePath?: string; branch?: string
    }>) =>
      setAgents(d.map(p => ({
        id: p.id, name: p.name, projectId: p.projectId, role: p.role ?? 'coder',
        status: p.status as 'idle' | 'working' | 'stalled' | 'zombie' | 'done',
        sessionId: p.sessionId, taskDescription: p.taskDescription ?? '',
        completionNote: p.completionNote ?? '', worktreePath: p.worktreePath ?? '', branch: p.branch ?? '',
      })))
    ).catch(() => {})
    apiFetch('/api/release-trains').then(r => r.json()).then(setReleaseTrains).catch(() => {})
    apiFetch('/api/atomictasks').then(r => r.json()).then(setAtomicTasks).catch(() => {})
    apiFetch('/api/templates').then(r => r.json()).then(setTemplates).catch(() => {})
  }, [setAgents, setReleaseTrains, setAtomicTasks, setTemplates])

  useEffect(() => { if (token) loadData() }, [token, activeTownId, loadData])
  useEffect(() => {
    if (token && serverRestarted) { clearAllPanes(); clearServerRestarted(); loadData() }
  }, [token, serverRestarted, clearAllPanes, clearServerRestarted, loadData])

  // Sidebar resize
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const dragging = useRef(false)
  const handleDrag = (e: React.MouseEvent) => {
    dragging.current = true
    const sx = e.clientX, sw = sidebarWidth
    const onMove = (ev: MouseEvent) => { if (dragging.current) setSidebarWidth(Math.max(200, Math.min(380, sw + ev.clientX - sx))) }
    const onUp = () => { dragging.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }

  // Auth gate
  if (!token) return <AuthPage />

  const activeTab = tabs.find((t) => t.id === activeTabId)

  return (
    <div
      className="flex flex-col w-full h-full bg-bg-secondary overflow-hidden"
      style={{ fontSize: ui.fontSize }}
    >
      <ToastContainer />
      <CommandPalette />
      <PreferencesPanel />

      {/* Connection banner */}
      {!connected && (
        <div className="fixed top-0 inset-x-0 z-[9999] bg-bg-warning/20 text-text-warning text-xs text-center py-1.5 font-medium">
          Reconnecting to server…
        </div>
      )}

      {/* ── Main area (sidebar + content) ────────────── */}
      <div className="flex flex-1 overflow-hidden" style={{ padding: '2px 2px 0 2px' }}>
        {/* Navigation panel (sidebar) — always visible */}
        <ErrorBoundary>
          <div style={{ width: sidebarWidth }} className="shrink-0 h-full">
            <Sidebar />
          </div>
          {/* Resize handle */}
          <div
            className="w-[3px] shrink-0 cursor-col-resize group relative"
            onMouseDown={handleDrag}
          >
            <div className="absolute inset-y-0 -left-[2px] -right-[2px] group-hover:bg-block-teal/20 group-active:bg-block-teal/30 transition-colors rounded-full" />
          </div>
        </ErrorBoundary>

        {/* Main content card */}
        <div className="flex-1 flex flex-col overflow-hidden bg-bg-primary rounded-t-lg min-w-0 relative">
          <div className="flex-1 overflow-hidden flex flex-col">
            {mainView === 'terminals' && (
              <AgentDashboard activeTab={activeTab} />
            )}
            {mainView === 'kanban' && <KanbanView />}
            {mainView === 'metrics' && <MetricsPanel />}
            {mainView === 'costs' && <CostPanel />}
            {mainView === 'events' && <div className="flex-1 overflow-hidden flex flex-col"><EventStream /></div>}
            {mainView === 'console' && <ConsolePanel />}
          </div>
        </div>
      </div>

      {/* ── Status bar (bottom — like Goose) ──────────── */}
      <StatusBar />
    </div>
  )
}
