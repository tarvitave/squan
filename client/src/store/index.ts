import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AuthUser {
  id: string
  email: string
  anthropicApiKey: string | null
  githubToken: string | null
  claudeTheme: string
}

export interface Tab {
  id: string
  label: string
  panes: string[]
  layout: 'single' | 'split-h' | 'split-v' | 'quad'
}

export interface Agent {
  id: string
  name: string
  projectId: string
  role: string
  status: 'idle' | 'working' | 'stalled' | 'zombie' | 'done'
  sessionId: string | null
  taskDescription: string
  completionNote: string
  worktreePath: string
  branch: string
}

export interface Rig {
  id: string
  name: string
  repoUrl: string
  localPath: string
  runtime?: {
    provider: string
    command: string
    args: string[]
    promptMode: string
  }
}

export interface ReleaseTrainEntry {
  id: string
  name: string
  description: string
  projectId: string
  status: string
  atomicTaskIds: string[]
  assignedWorkerBeeId: string | null
  manual?: boolean
  prUrl?: string
  prNumber?: number
}

/** Backward-compat alias */
export type ConvoyEntry = ReleaseTrainEntry

export interface AtomicTaskEntry {
  id: string
  projectId: string
  releaseTrainId: string | null
  /** @deprecated use releaseTrainId */
  convoyId: string | null
  title: string
  description: string
  status: string
  assigneeId: string | null
  dependsOn: string[]
}

/** Backward-compat alias */
export type BeadEntry = AtomicTaskEntry

export interface TemplateEntry {
  id: string
  projectId: string
  name: string
  content: string
}

export interface EventEntry {
  id: string
  type: string
  payload: Record<string, unknown>
  timestamp: string
}

export interface ToastEntry {
  id: string
  message: string
  kind: 'error' | 'info'
}

export interface TownEntry {
  id: string
  name: string
  path: string
  createdAt: string
}

export type MainView = 'terminals' | 'kanban' | 'metrics' | 'events' | 'costs' | 'console'

/** The currently focused project — when set, all views filter to this project */
export type ActiveProjectId = string | null

export interface UiPreferences {
  fontSize: number       // 10-16, default 12
  sidebarCollapsed: boolean
  sidebarIconOnly: boolean
  commandPaletteOpen: boolean
  showPreferences: boolean
}

interface SquansqState {
  // Auth
  token: string | null
  user: AuthUser | null
  setAuth: (token: string, user: AuthUser) => void
  clearAuth: () => void

  // View
  mainView: MainView
  setMainView: (view: MainView) => void

  // Tabs
  tabs: Tab[]
  activeTabId: string | null
  addTab: (label: string, panes?: string[]) => void
  removeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTabLayout: (id: string, layout: Tab['layout']) => void
  updateTabLabel: (id: string, label: string) => void
  addPaneToTab: (tabId: string, sessionId: string) => void
  removePaneFromTab: (tabId: string, sessionId: string) => void
  replacePaneInTab: (tabId: string, oldSessionId: string, newSessionId: string) => void
  clearAllPanes: () => void
  removePaneFromAllTabs: (sessionId: string) => void

  // Active project — all views filter to this
  activeProjectId: ActiveProjectId
  setActiveProjectId: (id: ActiveProjectId) => void

  // Rigs
  rigs: Rig[]
  setRigs: (rigs: Rig[]) => void

  // Agents
  agents: Agent[]
  setAgents: (agents: Agent[]) => void
  addAgent: (agent: Agent) => void
  updateAgent: (id: string, patch: Partial<Agent>) => void
  removeAgent: (id: string) => void
  selectedAgentId: string | null
  setSelectedAgent: (id: string | null) => void

  // Release Trains (formerly Convoys)
  releaseTrains: ReleaseTrainEntry[]
  setReleaseTrains: (releaseTrains: ReleaseTrainEntry[]) => void
  addReleaseTrain: (releaseTrain: ReleaseTrainEntry) => void
  updateReleaseTrain: (id: string, patch: Partial<ReleaseTrainEntry>) => void
  /** @deprecated use releaseTrains */
  convoys: ReleaseTrainEntry[]
  /** @deprecated use setReleaseTrains */
  setConvoys: (convoys: ReleaseTrainEntry[]) => void
  /** @deprecated use addReleaseTrain */
  addConvoy: (convoy: ReleaseTrainEntry) => void
  /** @deprecated use updateReleaseTrain */
  updateConvoy: (id: string, patch: Partial<ReleaseTrainEntry>) => void

  // AtomicTasks (formerly Beads)
  atomicTasks: AtomicTaskEntry[]
  setAtomicTasks: (atomicTasks: AtomicTaskEntry[]) => void
  addAtomicTask: (atomicTask: AtomicTaskEntry) => void
  updateAtomicTask: (id: string, patch: Partial<AtomicTaskEntry>) => void
  /** @deprecated use atomicTasks */
  beads: AtomicTaskEntry[]
  setBeads: (beads: AtomicTaskEntry[]) => void
  addBead: (bead: AtomicTaskEntry) => void
  updateBead: (id: string, patch: Partial<AtomicTaskEntry>) => void

  // Templates
  templates: TemplateEntry[]
  setTemplates: (templates: TemplateEntry[]) => void
  addTemplate: (template: TemplateEntry) => void
  removeTemplate: (id: string) => void

  // Event stream
  events: EventEntry[]
  pushEvent: (event: EventEntry) => void

  // Towns
  towns: TownEntry[]
  activeTownId: string | null
  setTowns: (towns: TownEntry[]) => void
  setActiveTownId: (id: string) => void

  // Toasts
  toasts: ToastEntry[]
  addToast: (message: string, kind?: 'error' | 'info') => void
  dismissToast: (id: string) => void

  // UI Preferences
  ui: UiPreferences
  setFontSize: (size: number) => void
  toggleSidebar: () => void
  toggleSidebarIconOnly: () => void
  toggleCommandPalette: () => void
  setShowPreferences: (show: boolean) => void
}

let tabCounter = 1

export const useStore = create<SquansqState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      clearAuth: () => set({ token: null, user: null }),

      mainView: 'terminals' as MainView,
      setMainView: (mainView: MainView) => set({ mainView }),

      tabs: [{ id: 'tab-1', label: 'Root Agent', panes: [], layout: 'single' }],
      activeTabId: 'tab-1',

      addTab: (label, panes = []) =>
        set((s) => {
          const id = `tab-${++tabCounter}-${Date.now()}`
          return { tabs: [...s.tabs, { id, label, panes, layout: 'single' }], activeTabId: id }
        }),

      removeTab: (id) =>
        set((s) => {
          const tabs = s.tabs.filter((t) => t.id !== id)
          return {
            tabs: tabs.length ? tabs : [{ id: 'tab-1', label: 'Root Agent', panes: [], layout: 'single' }],
            activeTabId: s.activeTabId === id ? (tabs[0]?.id ?? 'tab-1') : s.activeTabId,
          }
        }),

      setActiveTab: (id) => set({ activeTabId: id }),

      updateTabLayout: (id, layout) =>
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, layout } : t)) })),

      updateTabLabel: (id, label) =>
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, label } : t)) })),

      addPaneToTab: (tabId, sessionId) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tabId ? { ...t, panes: [...new Set([...t.panes, sessionId])] } : t
          ),
        })),

      removePaneFromTab: (tabId, sessionId) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tabId ? { ...t, panes: t.panes.filter((p) => p !== sessionId) } : t
          ),
        })),

      replacePaneInTab: (tabId, oldSessionId, newSessionId) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tabId ? { ...t, panes: t.panes.map((p) => (p === oldSessionId ? newSessionId : p)) } : t
          ),
        })),

      clearAllPanes: () =>
        set((s) => ({ tabs: s.tabs.map((t) => ({ ...t, panes: [] })) })),

      removePaneFromAllTabs: (sessionId) =>
        set((s) => ({ tabs: s.tabs.map((t) => ({ ...t, panes: t.panes.filter((p) => p !== sessionId) })) })),

      activeProjectId: null,
      setActiveProjectId: (activeProjectId) => set({ activeProjectId }),

      rigs: [],
      setRigs: (rigs) => set({ rigs }),

      agents: [],
      setAgents: (agents) => set({ agents }),
      addAgent: (agent) => set((s) => ({ agents: [...s.agents.filter((a) => a.id !== agent.id), agent] })),
      updateAgent: (id, patch) =>
        set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
      removeAgent: (id) => set((s) => ({ agents: s.agents.filter((a) => a.id !== id) })),
      selectedAgentId: null,
      setSelectedAgent: (selectedAgentId) => set({ selectedAgentId }),

      releaseTrains: [],
      setReleaseTrains: (releaseTrains) => set({ releaseTrains, convoys: releaseTrains }),
      addReleaseTrain: (releaseTrain) => set((s) => {
        const updated = [releaseTrain, ...s.releaseTrains.filter((c) => c.id !== releaseTrain.id)]
        return { releaseTrains: updated, convoys: updated }
      }),
      updateReleaseTrain: (id, patch) =>
        set((s) => {
          const updated = s.releaseTrains.map((c) => (c.id === id ? { ...c, ...patch } : c))
          return { releaseTrains: updated, convoys: updated }
        }),
      // backward-compat aliases
      convoys: [],
      setConvoys: (convoys) => set({ convoys, releaseTrains: convoys }),
      addConvoy: (convoy) => set((s) => {
        const updated = [convoy, ...s.releaseTrains.filter((c) => c.id !== convoy.id)]
        return { releaseTrains: updated, convoys: updated }
      }),
      updateConvoy: (id, patch) =>
        set((s) => {
          const updated = s.releaseTrains.map((c) => (c.id === id ? { ...c, ...patch } : c))
          return { releaseTrains: updated, convoys: updated }
        }),

      atomicTasks: [],
      setAtomicTasks: (atomicTasks) => set({ atomicTasks, beads: atomicTasks }),
      addAtomicTask: (atomicTask) => set((s) => {
        const updated = [atomicTask, ...s.atomicTasks.filter((b) => b.id !== atomicTask.id)]
        return { atomicTasks: updated, beads: updated }
      }),
      updateAtomicTask: (id, patch) =>
        set((s) => {
          const updated = s.atomicTasks.map((b) => (b.id === id ? { ...b, ...patch } : b))
          return { atomicTasks: updated, beads: updated }
        }),
      // backward-compat aliases
      beads: [],
      setBeads: (beads) => set({ beads, atomicTasks: beads }),
      addBead: (bead) => set((s) => {
        const updated = [bead, ...s.atomicTasks.filter((b) => b.id !== bead.id)]
        return { atomicTasks: updated, beads: updated }
      }),
      updateBead: (id, patch) =>
        set((s) => {
          const updated = s.atomicTasks.map((b) => (b.id === id ? { ...b, ...patch } : b))
          return { atomicTasks: updated, beads: updated }
        }),

      templates: [],
      setTemplates: (templates) => set({ templates }),
      addTemplate: (template) =>
        set((s) => ({ templates: [...s.templates.filter((t) => t.id !== template.id), template] })),
      removeTemplate: (id) =>
        set((s) => ({ templates: s.templates.filter((t) => t.id !== id) })),

      events: [],
      pushEvent: (event) =>
        set((s) => {
          if (s.events.some((e) => e.id === event.id)) return s
          return { events: [event, ...s.events].slice(0, 500) }
        }),

      towns: [],
      activeTownId: null,
      setTowns: (towns) => set({ towns }),
      setActiveTownId: (activeTownId) => set({ activeTownId }),

      toasts: [],
      addToast: (message, kind = 'error') =>
        set((s) => ({ toasts: [...s.toasts, { id: crypto.randomUUID(), message, kind }] })),
      dismissToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      // UI Preferences
      ui: {
        fontSize: 12,
        sidebarCollapsed: false,
        sidebarIconOnly: false,
        commandPaletteOpen: false,
        showPreferences: false,
      },
      setFontSize: (size) => set((s) => ({ ui: { ...s.ui, fontSize: Math.max(10, Math.min(16, size)) } })),
      toggleSidebar: () => set((s) => ({ ui: { ...s.ui, sidebarCollapsed: !s.ui.sidebarCollapsed } })),
      toggleSidebarIconOnly: () => set((s) => ({ ui: { ...s.ui, sidebarIconOnly: !s.ui.sidebarIconOnly } })),
      toggleCommandPalette: () => set((s) => ({ ui: { ...s.ui, commandPaletteOpen: !s.ui.commandPaletteOpen } })),
      setShowPreferences: (show) => set((s) => ({ ui: { ...s.ui, showPreferences: show } })),
    }),
    {
      name: 'squansq-ui',
      version: 4,
      migrate: (_persisted: unknown) => {
        const p = (_persisted ?? {}) as Record<string, unknown>
        return { token: p.token ?? null, user: p.user ?? null } as never
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Record<string, unknown>
        return {
          ...current,
          token: (p.token ?? null) as string | null,
          user: (p.user ?? null) as typeof current.user,
          tabs: Array.isArray(p.tabs)
            ? (p.tabs as typeof current.tabs).map((t) => ({ ...t, panes: t.panes.filter((pane) => typeof pane === 'string') }))
            : current.tabs,
          activeTabId: typeof p.activeTabId === 'string' ? p.activeTabId : current.activeTabId,
          mainView: p.mainView ? p.mainView as typeof current.mainView : current.mainView,
          towns: Array.isArray(p.towns) ? p.towns as typeof current.towns : current.towns,
          activeTownId: typeof p.activeTownId === 'string' ? p.activeTownId : current.activeTownId,
          activeProjectId: typeof p.activeProjectId === 'string' ? p.activeProjectId : current.activeProjectId,
          ui: p.ui ? { ...current.ui, ...(p.ui as Partial<typeof current.ui>), sidebarCollapsed: false } : current.ui,
        }
      },
      partialize: (s) => ({ tabs: s.tabs, activeTabId: s.activeTabId, mainView: s.mainView, towns: s.towns, activeTownId: s.activeTownId, activeProjectId: s.activeProjectId, token: s.token, user: s.user, ui: s.ui }),
    }
  )
)
