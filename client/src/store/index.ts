import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Tab {
  id: string
  label: string
  // Which terminal session IDs are visible in this tab
  panes: string[]
  layout: 'single' | 'split-h' | 'split-v' | 'quad'
}

export interface Agent {
  id: string
  name: string
  rigId: string
  status: 'idle' | 'working' | 'stalled' | 'zombie' | 'done'
  sessionId: string | null
}

export interface Rig {
  id: string
  name: string
  repoUrl: string
  localPath: string
}

export interface ConvoyEntry {
  id: string
  name: string
  rigId: string
  status: string
  beadIds: string[]
}

export interface EventEntry {
  id: string
  type: string
  payload: Record<string, unknown>
  timestamp: string
}

interface SquansqState {
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

  // Agents (polecats + mayor)
  agents: Agent[]
  setAgents: (agents: Agent[]) => void
  updateAgent: (id: string, patch: Partial<Agent>) => void

  // Convoys
  convoys: ConvoyEntry[]
  setConvoys: (convoys: ConvoyEntry[]) => void

  // Event stream
  events: EventEntry[]
  pushEvent: (event: EventEntry) => void
}

let tabCounter = 1

export const useStore = create<SquansqState>()(
  persist(
    (set) => ({
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
      updateAgent: (id, patch) =>
        set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),

      convoys: [],
      setConvoys: (convoys) => set({ convoys }),

      events: [],
      pushEvent: (event) =>
        set((s) => ({ events: [event, ...s.events].slice(0, 500) })),
    }),
    {
      name: 'squansq-ui',
      // Only persist tabs — agents/events are live data reloaded on connect
      partialize: (s) => ({ tabs: s.tabs, activeTabId: s.activeTabId }),
    }
  )
)
