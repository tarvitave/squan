// Core domain types for Squansq

export type AgentStatus = 'idle' | 'working' | 'stalled' | 'zombie' | 'done'

export type HookStatus = 'created' | 'active' | 'suspended' | 'completed' | 'archived'

export type ReleaseTrainStatus = 'open' | 'in_progress' | 'landed' | 'cancelled'

/** Backward-compat alias */
export type ConvoyStatus = ReleaseTrainStatus

export type AtomicTaskStatus = 'open' | 'assigned' | 'in_progress' | 'done' | 'blocked'

/** Backward-compat alias */
export type BeadStatus = AtomicTaskStatus

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

// --- AtomicTask (atomic unit of work, formerly Bead) ---
export interface AtomicTask {
  id: string
  projectId: string
  releaseTrainId: string | null
  /** @deprecated use releaseTrainId */
  convoyId: string | null
  title: string
  description: string
  status: AtomicTaskStatus
  assigneeId: string | null
  dependsOn: string[]
  createdAt: string
  updatedAt: string
}

/** Backward-compat alias */
export type Bead = AtomicTask

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
  atomicTaskId: string | null
  status: HookStatus
  branch: string
  notes: string
  createdAt: string
  updatedAt: string
}

// --- ReleaseTrain (work tracking bundle, formerly Convoy) ---
export interface ReleaseTrain {
  id: string
  name: string
  description: string
  projectId: string
  atomicTaskIds: string[]
  assignedWorkerBeeId: string | null
  status: ReleaseTrainStatus
  createdAt: string
  updatedAt: string
}

/** Backward-compat alias */
export type Convoy = ReleaseTrain

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
  | 'releasetrain.created'
  | 'releasetrain.landed'
  | 'releasetrain.assigned'
  | 'releasetrain.cancelled'
  | 'hook.created'
  | 'hook.activated'
  | 'hook.completed'
  | 'atomictask.created'
  | 'atomictask.assigned'
  | 'atomictask.done'
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
  | 'ping'
  | 'pong'
  | 'session.not_found'

export interface WsMessage {
  type: WsMessageType
  id?: string
  payload?: Record<string, unknown>
}
