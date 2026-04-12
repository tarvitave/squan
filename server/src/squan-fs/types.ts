/**
 * Type definitions for .squan/ file structures.
 */

// ── Task (board item) ────────────────────────────────────────────────

export type TaskStatus = 'open' | 'in_progress' | 'pr_review' | 'landed' | 'cancelled'
export type TaskType = 'ai' | 'manual'

export interface TaskMeta {
  id: string
  title: string
  status: TaskStatus
  type: TaskType
  priority?: 'low' | 'medium' | 'high' | 'critical'
  assignee?: string | null
  branch?: string | null
  pr_url?: string | null
  pr_number?: number | null
  depends_on?: string[]
  tags?: string[]
  created: string     // ISO date
  updated: string     // ISO date
}

export interface TaskFile {
  meta: TaskMeta
  description: string   // markdown body: description, acceptance criteria, notes
  filePath: string      // relative path within .squan/board/
}

// ── Config ───────────────────────────────────────────────────────────

export interface SquanConfig {
  version: number
  project: {
    name: string
    repo?: string
    runtime?: {
      provider: string
      command: string
      args?: string[]
    }
  }
  roles?: Record<string, {
    description: string
    routing_patterns?: string[]
  }>
  settings?: {
    auto_dispatch?: boolean
    auto_pr?: boolean
    stall_threshold_minutes?: number
  }
}

// ── Charter (accumulated agent knowledge) ────────────────────────────

export interface CharterMeta {
  role: string
  updated: string
}

export interface CharterFile {
  meta: CharterMeta
  content: string
  filePath: string
}

// ── Template (reusable task descriptions) ────────────────────────────

export interface TemplateMeta {
  name: string
  type: TaskType
  tags?: string[]
  created: string
}

export interface TemplateFile {
  meta: TemplateMeta
  content: string
  filePath: string
}

// ── Doc (project documentation) ──────────────────────────────────────

export interface DocMeta {
  title: string
  category?: string
  updated: string
  author?: string
}

export interface DocFile {
  meta: DocMeta
  content: string
  filePath: string
}

// ── Security ─────────────────────────────────────────────────────────

export interface SecurityMeta {
  title: string
  date: string
  severity_counts?: {
    critical: number
    high: number
    medium: number
    low: number
  }
}

export interface SecurityFile {
  meta: SecurityMeta
  content: string
  filePath: string
}

// ── Directory scan result ────────────────────────────────────────────

export interface SquanDirState {
  config: SquanConfig | null
  tasks: TaskFile[]
  charters: CharterFile[]
  templates: TemplateFile[]
  docs: DocFile[]
  security: SecurityFile[]
}
