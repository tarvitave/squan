import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AuthUser {
  id: string
  email: string
  anthropicApiKey: string | null
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

export interface ConvoyEntry {
  id: string
  name: string
  description: string
  projectId: string
  status: string
  beadIds: string[]
  assignedWorkerBeeId: string | null
}

export interface BeadEntry {
  id: string
  projectId: string
  convoyId: string | null
  title: string
  description: string
  status: string
  assigneeId: string | null
  dependsOn: string[]
}

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

export type MainView = 'terminals' | 'kanban' | 'metrics'

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
  addPaneToTab: (tabId: string, sessionId: string) => void
  removePaneFromTab: (tabId: string, sessionId: string) => void

  // Rigs
  rigs: Rig[]
  setRigs: (rigs: Rig[]) => void

  // Agents
  agents: Agent[]
  setAgents: (agents: Agent[]) => void
  addAgent: (agent: Agent) => void
  updateAgent: (id: string, patch: Partial<Agent>) => void
  selectedAgentId: string | null
  setSelectedAgent: (id: string | null) => void

  // Convoys
  convoys: ConvoyEntry[]
  setConvoys: (convoys: ConvoyEntry[]) => void
  addConvoy: (convoy: ConvoyEntry) => void
  updateConvoy: (id: string, patch: Partial<ConvoyEntry>) => void

  // Beads
  beads: BeadEntry[]
  setBeads: (beads: BeadEntry[]) => void
  addBead: (bead: BeadEntry) => void
  updateBead: (id: string, patch: Partial<BeadEntry>) => void

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

      tabs: [{ id: 'tab-1', label: 'Mayor', panes: [], layout: 'single' }],
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
            tabs: tabs.length ? tabs : [{ id: 'tab-1', label: 'Mayor', panes: [], layout: 'single' }],
            activeTabId: s.activeTabId === id ? (tabs[0]?.id ?? 'tab-1') : s.activeTabId,
          }
        }),

      setActiveTab: (id) => set({ activeTabId: id }),

      updateTabLayout: (id, layout) =>
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, layout } : t)) })),

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

      rigs: [],
      setRigs: (rigs) => set({ rigs }),

      agents: [],
      setAgents: (agents) => set({ agents }),
      addAgent: (agent) => set((s) => ({ agents: [...s.agents.filter((a) => a.id !== agent.id), agent] })),
      updateAgent: (id, patch) =>
        set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
      selectedAgentId: null,
      setSelectedAgent: (selectedAgentId) => set({ selectedAgentId }),

      convoys: [],
      setConvoys: (convoys) => set({ convoys }),
      addConvoy: (convoy) => set((s) => ({ convoys: [convoy, ...s.convoys.filter((c) => c.id !== convoy.id)] })),
      updateConvoy: (id, patch) =>
        set((s) => ({ convoys: s.convoys.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),

      beads: [],
      setBeads: (beads) => set({ beads }),
      addBead: (bead) => set((s) => ({ beads: [bead, ...s.beads.filter((b) => b.id !== bead.id)] })),
      updateBead: (id, patch) =>
        set((s) => ({ beads: s.beads.map((b) => (b.id === id ? { ...b, ...patch } : b)) })),

      templates: [],
      setTemplates: (templates) => set({ templates }),
      addTemplate: (template) =>
        set((s) => ({ templates: [...s.templates.filter((t) => t.id !== template.id), template] })),
      removeTemplate: (id) =>
        set((s) => ({ templates: s.templates.filter((t) => t.id !== id) })),

      events: [],
      pushEvent: (event) =>
        set((s) => ({ events: [event, ...s.events].slice(0, 500) })),

      towns: [],
      activeTownId: null,
      setTowns: (towns) => set({ towns }),
      setActiveTownId: (activeTownId) => set({ activeTownId }),

      toasts: [],
      addToast: (message, kind = 'error') =>
        set((s) => ({ toasts: [...s.toasts, { id: crypto.randomUUID(), message, kind }] })),
      dismissToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    {
      name: 'squansq-ui',
      version: 1,
      migrate: (persisted: unknown) => {
        const p = persisted as Record<string, unknown>
        return { token: p?.token ?? null, user: p?.user ?? null }
      },
      partialize: (s) => ({ tabs: s.tabs, activeTabId: s.activeTabId, mainView: s.mainView, towns: s.towns, activeTownId: s.activeTownId, token: s.token, user: s.user }),
    }
  )
)
