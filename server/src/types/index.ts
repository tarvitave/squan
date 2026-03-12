// Core domain types for Squansq
// These mirror Gas Town's architecture — rename as desired

export type AgentStatus = 'idle' | 'working' | 'stalled' | 'zombie' | 'done'

export type HookStatus = 'created' | 'active' | 'suspended' | 'completed' | 'archived'

export type ConvoyStatus = 'open' | 'in_progress' | 'landed' | 'cancelled'

// --- Town (workspace) ---
export interface Town {
  id: string
  path: string
  name: string
  createdAt: string
}

// --- Rig (project container wrapping a git repo) ---
export interface Rig {
  id: string
  townId: string
  name: string
  repoUrl: string
  localPath: string
  runtime: RuntimeConfig
  createdAt: string
}

export interface RuntimeConfig {
  provider: 'claude' | 'codex' | 'custom'
  command: string
  args: string[]
  promptMode: 'none' | 'auto'
}

// --- Polecat (ephemeral worker agent) ---
export interface Polecat {
  id: string
  rigId: string
  name: string
  branch: string
  worktreePath: string
  status: AgentStatus
  hookId: string | null
  sessionId: string | null  // terminal session in the browser
  createdAt: string
  updatedAt: string
}

// --- Mayor (orchestrator agent) ---
export interface Mayor {
  id: string
  townId: string
  sessionId: string | null
  status: AgentStatus
  createdAt: string
}

// --- Hook (persistent work unit, git-worktree-backed) ---
export interface Hook {
  id: string
  rigId: string
  polecatId: string | null
  beadId: string | null
  status: HookStatus
  branch: string
  notes: string
  createdAt: string
  updatedAt: string
}

// --- Convoy (work tracking bundle) ---
export interface Convoy {
  id: string
  name: string
  rigId: string
  beadIds: string[]
  status: ConvoyStatus
  createdAt: string
  updatedAt: string
}

// --- Terminal Session (browser-side pty) ---
export interface TerminalSession {
  id: string
  label: string
  polecatId: string | null
  mayorId: string | null
  cols: number
  rows: number
  createdAt: string
}

// --- Events (streamed to browser clients) ---
export type EventType =
  | 'polecat.spawned'
  | 'polecat.done'
  | 'polecat.stalled'
  | 'polecat.zombie'
  | 'convoy.created'
  | 'convoy.landed'
  | 'hook.created'
  | 'hook.completed'
  | 'mayor.started'
  | 'mayor.stopped'
  | 'terminal.data'
  | 'terminal.resize'

export interface SquansqEvent {
  id: string
  type: EventType
  payload: Record<string, unknown>
  timestamp: string
}

// --- WebSocket message protocol ---
export type WsMessageType =
  | 'subscribe'
  | 'unsubscribe'
  | 'terminal.input'
  | 'terminal.resize'
  | 'event'
  | 'error'
  | 'ack'

export interface WsMessage {
  type: WsMessageType
  id?: string
  payload?: Record<string, unknown>
}
