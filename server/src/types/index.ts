// Core domain types for Squansq

export type AgentStatus = 'idle' | 'working' | 'stalled' | 'zombie' | 'done'

export type HookStatus = 'created' | 'active' | 'suspended' | 'completed' | 'archived'

export type ConvoyStatus = 'open' | 'in_progress' | 'landed' | 'cancelled'

export type BeadStatus = 'open' | 'assigned' | 'in_progress' | 'done' | 'blocked'

// --- AllProjects (workspace) ---
export interface AllProjects {
  id: string
  path: string
  name: string
  createdAt: string
}

// --- Project (wraps a git repo, was "Rig") ---
export interface Project {
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

// --- WorkerBee (ephemeral worker agent, was "Polecat") ---
export interface WorkerBee {
  id: string
  projectId: string
  name: string
  branch: string
  worktreePath: string
  taskDescription: string
  completionNote: string
  status: AgentStatus
  hookId: string | null
  sessionId: string | null
  createdAt: string
  updatedAt: string
}

// --- MayorLee (orchestrator agent) ---
export interface MayorLee {
  id: string
  townId: string
  sessionId: string | null
  status: AgentStatus
  createdAt: string
}

// --- Bead (atomic unit of work) ---
export interface Bead {
  id: string
  projectId: string
  convoyId: string | null
  title: string
  description: string
  status: BeadStatus
  assigneeId: string | null
  dependsOn: string[]
  createdAt: string
  updatedAt: string
}

// --- Template (reusable CLAUDE.md content) ---
export interface Template {
  id: string
  projectId: string
  name: string
  content: string
  createdAt: string
}

// --- Snapshot (point-in-time PTY output capture) ---
export interface Snapshot {
  id: string
  workerBeeId: string
  sessionId: string
  content: string
  capturedAt: string
}

// --- ReplayFrame (30s-interval PTY output frame for session replay) ---
export interface ReplayFrame {
  id: string
  workerBeeId: string
  content: string
  frameAt: string
}

// --- Hook (persistent work unit, git-worktree-backed) ---
export interface Hook {
  id: string
  projectId: string
  workerBeeId: string | null
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
  description: string
  projectId: string
  beadIds: string[]
  assignedWorkerBeeId: string | null
  status: ConvoyStatus
  createdAt: string
  updatedAt: string
}

// --- Terminal Session (browser-side pty) ---
export interface TerminalSession {
  id: string
  label: string
  workerBeeId: string | null
  mayorId: string | null
  cols: number
  rows: number
  createdAt: string
}

// --- Events (streamed to browser clients) ---
export type EventType =
  | 'workerbee.spawned'
  | 'workerbee.working'
  | 'workerbee.done'
  | 'workerbee.stalled'
  | 'workerbee.zombie'
  | 'convoy.created'
  | 'convoy.landed'
  | 'convoy.assigned'
  | 'convoy.cancelled'
  | 'hook.created'
  | 'hook.activated'
  | 'hook.completed'
  | 'bead.created'
  | 'bead.assigned'
  | 'bead.done'
  | 'mayorlee.started'
  | 'mayorlee.stopped'
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
