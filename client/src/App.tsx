import { useEffect, useRef, useState, useCallback, Component } from 'react'
import { Bot } from 'lucide-react'
import type { ReactNode, ErrorInfo } from 'react'
import { apiFetch } from './lib/api.js'
import { TabBar } from './components/TabBar/index.js'
import { PaneGrid } from './components/PaneGrid/index.js'
import { EventStream } from './components/EventStream/index.js'
import { AuthPage } from './components/AuthPage/index.js'
import { KanbanView } from './components/KanbanView/index.js'
import { ConsolePanel } from './components/ConsolePanel/index.js'
// ClaudeCodePanel removed — agents now use DirectRunner with agent chat
import { MetricsPanel } from './components/MetricsPanel/index.js'
import { CostPanel } from './components/CostPanel/index.js'
import { ToastContainer } from './components/Toast/index.js'
import { Sidebar } from './components/Sidebar/index.js'
import { AutomationsView } from './components/AutomationsView/index.js'
import { ClaudeCodeView } from './components/ClaudeCodeView/index.js'
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
   Chat layout:
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
        {/* All agents shown above */}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {selectedAgentId ? (
          <AgentChat
            workerbeeId={selectedAgentId}
            taskDescription={allVisible.find((a) => a.id === selectedAgentId)?.taskDescription}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-text-tertiary p-8">
            <Bot className="w-10 h-10 opacity-30" />
            <p className="text-sm">Select an agent above to view its conversation</p>
            <p className="text-xs opacity-50">Or dispatch a new agent from the sidebar [+] button</p>
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
        const views: MainView[] = ['terminals', 'kanban', 'metrics', 'events', 'costs', 'console', 'claudecode', 'automations']
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
  // Fetch with retry — retries up to 3 times with backoff if server isn't ready
  const fetchWithRetry = useCallback(async (url: string, retries = 3, delay = 1000): Promise<Response> => {
    for (let i = 0; i <= retries; i++) {
      try {
        const r = await apiFetch(url)
        if (r.ok) return r
        if (r.status === 401) throw new Error('Unauthorized')
        if (i < retries) {
          console.warn(`[loadData] ${url} returned ${r.status}, retrying in ${delay}ms (${i + 1}/${retries})`)
          await new Promise(resolve => setTimeout(resolve, delay))
          delay *= 2
          continue
        }
        throw new Error(`${url} failed with ${r.status}`)
      } catch (err) {
        if ((err as Error).message === 'Unauthorized') throw err
        if (i < retries) {
          console.warn(`[loadData] ${url} failed: ${(err as Error).message}, retrying in ${delay}ms (${i + 1}/${retries})`)
          await new Promise(resolve => setTimeout(resolve, delay))
          delay *= 2
          continue
        }
        throw err
      }
    }
    throw new Error(`${url} failed after ${retries} retries`)
  }, [])

  const [dataLoaded, setDataLoaded] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setDataError(null)
    try {
      const [wbRes, rtRes, atRes, tplRes] = await Promise.all([
        fetchWithRetry('/api/workerbees'),
        fetchWithRetry('/api/release-trains'),
        fetchWithRetry('/api/atomictasks'),
        fetchWithRetry('/api/templates'),
      ])
      const wb = await wbRes.json()
      setAgents(wb.map((p: any) => ({
        id: p.id, name: p.name, projectId: p.projectId, role: p.role ?? 'coder',
        status: p.status as 'idle' | 'working' | 'stalled' | 'zombie' | 'done',
        sessionId: p.sessionId, taskDescription: p.taskDescription ?? '',
        completionNote: p.completionNote ?? '', worktreePath: p.worktreePath ?? '', branch: p.branch ?? '',
      })))
      setReleaseTrains(await rtRes.json())
      setAtomicTasks(await atRes.json())
      setTemplates(await tplRes.json())
      setDataLoaded(true)
      console.log('[loadData] All data loaded successfully')
    } catch (err) {
      const msg = (err as Error).message
      console.error('[loadData] Failed to load data:', msg)
      if (msg === 'Unauthorized') {
        // Token is stale — clear auth so user can re-login
        useStore.getState().clearAuth()
      } else {
        setDataError(`Failed to connect to server: ${msg}`)
      }
    }
  }, [setAgents, setReleaseTrains, setAtomicTasks, setTemplates, fetchWithRetry])

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

      {/* Data load error banner */}
      {dataError && (
        <div className="fixed top-0 inset-x-0 z-[9998] bg-red-500/10 text-red-400 text-xs text-center py-2 font-medium flex items-center justify-center gap-3">
          <span>{dataError}</span>
          <button onClick={() => loadData()} className="underline hover:text-red-300">Retry</button>
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
            {mainView === 'automations' ? (
                  <AutomationsView />
                ) : mainView === 'console' && <ConsolePanel />}
          </div>
        </div>
      </div>

      {/* ── Status bar (bottom — ) ──────────── */}
      <StatusBar />
    </div>
  )
}
