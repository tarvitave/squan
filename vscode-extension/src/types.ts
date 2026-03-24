// Core domain types for Squansq VSCode Extension

export type AgentStatus = 'idle' | 'working' | 'stalled' | 'zombie' | 'done'

export type ReleaseTrainStatus = 'open' | 'in_progress' | 'pr_review' | 'landed' | 'cancelled'

export type AtomicTaskStatus = 'open' | 'assigned' | 'in_progress' | 'done' | 'blocked'

export type AgentRole = 'coder' | 'tester' | 'reviewer' | 'devops' | 'lead'

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

// --- WorkerBee (ephemeral worker agent) ---
export interface WorkerBee {
  id: string
  projectId: string
  name: string
  branch: string
  worktreePath: string
  taskDescription: string
  completionNote: string
  role: AgentRole | string
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

// --- AtomicTask (atomic unit of work) ---
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

// --- ReleaseTrain (work tracking bundle) ---
export interface ReleaseTrain {
  id: string
  name: string
  description: string
  projectId: string
  atomicTaskIds: string[]
  assignedWorkerBeeId: string | null
  status: ReleaseTrainStatus
  manual: boolean
  prUrl: string | null
  prNumber: number | null
  createdAt: string
  updatedAt: string
}

// --- Events (streamed to UI) ---
export type EventType =
  | 'workerbee.spawned'
  | 'workerbee.working'
  | 'workerbee.done'
  | 'workerbee.stalled'
  | 'workerbee.zombie'
  | 'workerbee.deleted'
  | 'releasetrain.created'
  | 'releasetrain.landed'
  | 'releasetrain.assigned'
  | 'releasetrain.cancelled'
  | 'releasetrain.pr_review'
  | 'atomictask.created'
  | 'atomictask.assigned'
  | 'atomictask.done'
  | 'rootagent.started'
  | 'rootagent.stopped'
  | 'terminal.data'

export interface SquansqEvent {
  id: string
  type: EventType
  payload: Record<string, unknown>
  timestamp: string
}

// --- Extension state ---
export interface ExtensionState {
  mcpPort: number
  rootAgentTerminalId: string | null
}
