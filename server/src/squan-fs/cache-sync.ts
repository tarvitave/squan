/**
 * SQLite cache layer for .squan/ file state.
 *
 * The .squan/ directory is the source of truth.
 * SQLite is a fast read cache that's rebuilt from files.
 *
 * Write path:  API → write .squan/ file → git commit → update cache
 * Read path:   API → SQLite cache (fast) → return
 * Startup:     Parse .squan/ → populate SQLite
 * Watch:       Poll for changes → detect external edits → update cache
 */

import { execFileSync } from 'child_process'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { readSquanDir, hasSquanDir } from './reader.js'
import { initSquanDir, writeTask, moveTask, deleteTask as deleteTaskFile, writeCharter, writeTemplate, deleteTemplate as deleteTemplateFile } from './writer.js'
import type { TaskMeta, TaskStatus, TaskFile, SquanDirState } from './types.js'
import { broadcastEvent } from '../ws/server.js'

const POLL_INTERVAL_MS = 5_000 // check for external changes every 5s
const pollTimers = new Map<string, ReturnType<typeof setInterval>>()

// ── Initialize ───────────────────────────────────────────────────────

/**
 * Initialize .squan/ for a project and sync to cache.
 * If .squan/ already exists, just sync.
 */
export async function initAndSync(projectId: string, projectPath: string, projectName: string): Promise<void> {
  if (!hasSquanDir(projectPath)) {
    initSquanDir(projectPath, projectName)
  }
  await fullSync(projectId, projectPath)
  startWatching(projectId, projectPath)
}

// ── Full sync: .squan/ files → SQLite cache ──────────────────────────

/**
 * Rebuild the SQLite cache from .squan/ files.
 * This is idempotent — safe to call on every startup.
 */
export async function fullSync(projectId: string, projectPath: string): Promise<{ tasks: number; charters: number; templates: number }> {
  if (!hasSquanDir(projectPath)) {
    return { tasks: 0, charters: 0, templates: 0 }
  }

  const state = readSquanDir(projectPath)
  const db = getDb()

  // ── Sync tasks → release_trains + atomic_tasks ──────────────────

  // Map .squan tasks to release_trains (each task = a release train for simplicity)
  for (const task of state.tasks) {
    const existing = await db.execute({
      sql: 'SELECT id FROM release_trains WHERE id = ?',
      args: [task.meta.id],
    })

    const rtStatus = mapTaskStatusToRt(task.meta.status)

    if (existing.rows.length === 0) {
      // Insert
      await db.execute({
        sql: `INSERT OR IGNORE INTO release_trains (id, name, rig_id, description, status, manual, atomic_task_ids_json, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
        args: [
          task.meta.id,
          task.meta.title,
          projectId,
          task.description.slice(0, 4000),
          rtStatus,
          task.meta.type === 'manual' ? 1 : 0,
          task.meta.created,
          task.meta.updated,
        ],
      })
    } else {
      // Update
      await db.execute({
        sql: `UPDATE release_trains SET name = ?, description = ?, status = ?, manual = ?, updated_at = ? WHERE id = ?`,
        args: [
          task.meta.title,
          task.description.slice(0, 4000),
          rtStatus,
          task.meta.type === 'manual' ? 1 : 0,
          task.meta.updated,
          task.meta.id,
        ],
      })
    }
  }

  // Remove cached tasks that no longer exist in .squan/
  const taskIds = new Set(state.tasks.map((t) => t.meta.id))
  const cachedTasks = await db.execute({
    sql: 'SELECT id FROM release_trains WHERE rig_id = ?',
    args: [projectId],
  })
  for (const row of cachedTasks.rows) {
    if (!taskIds.has(row.id as string)) {
      await db.execute({ sql: 'DELETE FROM release_trains WHERE id = ?', args: [row.id] })
    }
  }

  // ── Sync charters ──────────────────────────────────────────────

  for (const charter of state.charters) {
    const existing = await db.execute({
      sql: 'SELECT id FROM charters WHERE project_id = ? AND role = ?',
      args: [projectId, charter.meta.role],
    })
    if (existing.rows.length === 0) {
      await db.execute({
        sql: 'INSERT INTO charters (id, project_id, role, content, updated_at) VALUES (?, ?, ?, ?, ?)',
        args: [uuidv4(), projectId, charter.meta.role, charter.content, charter.meta.updated],
      })
    } else {
      await db.execute({
        sql: 'UPDATE charters SET content = ?, updated_at = ? WHERE project_id = ? AND role = ?',
        args: [charter.content, charter.meta.updated, projectId, charter.meta.role],
      })
    }
  }

  // ── Sync templates ─────────────────────────────────────────────

  for (const tpl of state.templates) {
    const existing = await db.execute({
      sql: 'SELECT id FROM templates WHERE project_id = ? AND name = ?',
      args: [projectId, tpl.meta.name],
    })
    if (existing.rows.length === 0) {
      await db.execute({
        sql: 'INSERT INTO templates (id, project_id, name, content) VALUES (?, ?, ?, ?)',
        args: [uuidv4(), projectId, tpl.meta.name, tpl.content],
      })
    } else {
      await db.execute({
        sql: 'UPDATE templates SET content = ? WHERE project_id = ? AND name = ?',
        args: [tpl.content, projectId, tpl.meta.name],
      })
    }
  }

  console.log(`[cache-sync] Synced ${projectId}: ${state.tasks.length} tasks, ${state.charters.length} charters, ${state.templates.length} templates`)
  return { tasks: state.tasks.length, charters: state.charters.length, templates: state.templates.length }
}

// ── Watch for external changes ───────────────────────────────────────

let lastGitHash = new Map<string, string>()

function getGitHash(projectPath: string): string | null {
  try {
    return execFileSync('git', ['-C', projectPath, 'log', '-1', '--format=%H', '--', '.squan/'], { stdio: 'pipe' }).toString().trim()
  } catch {
    return null
  }
}

function startWatching(projectId: string, projectPath: string): void {
  // Stop any existing watcher
  const existing = pollTimers.get(projectId)
  if (existing) clearInterval(existing)

  // Record initial hash
  lastGitHash.set(projectId, getGitHash(projectPath) ?? '')

  const timer = setInterval(async () => {
    const currentHash = getGitHash(projectPath)
    const previousHash = lastGitHash.get(projectId) ?? ''

    if (currentHash && currentHash !== previousHash) {
      console.log(`[cache-sync] External change detected for ${projectId}, resyncing...`)
      lastGitHash.set(projectId, currentHash)
      await fullSync(projectId, projectPath)

      // Broadcast event so UI updates
      broadcastEvent({
        id: uuidv4(),
        type: 'releasetrain.created', // generic event to trigger UI refresh
        payload: { projectId, source: 'squan-fs-sync' },
        timestamp: new Date().toISOString(),
      })
    }
  }, POLL_INTERVAL_MS)

  pollTimers.set(projectId, timer)
}

export function stopWatching(projectId: string): void {
  const timer = pollTimers.get(projectId)
  if (timer) {
    clearInterval(timer)
    pollTimers.delete(projectId)
  }
}

// ── Write-through helpers (API → files → cache) ─────────────────────

/**
 * Create a task: write to .squan/board/open/ → update cache
 */
export async function createTask(projectId: string, projectPath: string, opts: {
  title: string
  description: string
  type?: 'ai' | 'manual'
  priority?: 'low' | 'medium' | 'high' | 'critical'
  tags?: string[]
}): Promise<TaskMeta> {
  const id = uuidv4().slice(0, 8)
  const now = new Date().toISOString().slice(0, 10)
  const meta: TaskMeta = {
    id,
    title: opts.title,
    status: 'open',
    type: opts.type ?? 'ai',
    priority: opts.priority ?? 'medium',
    assignee: null,
    branch: null,
    pr_url: null,
    pr_number: null,
    depends_on: [],
    tags: opts.tags ?? [],
    created: now,
    updated: now,
  }

  writeTask(projectPath, meta, opts.description)
  await fullSync(projectId, projectPath) // rebuild cache

  return meta
}

/**
 * Move a task to a new status: git mv → update cache
 */
export async function updateTaskStatus(
  projectId: string, projectPath: string,
  taskId: string, currentStatus: TaskStatus, newStatus: TaskStatus, title: string,
): Promise<void> {
  moveTask(projectPath, taskId, currentStatus, newStatus, title)
  await fullSync(projectId, projectPath)
}

/**
 * Delete a task: git rm → update cache
 */
export async function removeTask(projectId: string, projectPath: string, taskId: string, status: TaskStatus): Promise<void> {
  deleteTaskFile(projectPath, taskId, status)
  await fullSync(projectId, projectPath)
}

/**
 * Update a charter: write file → update cache
 */
export async function updateCharter(projectId: string, projectPath: string, role: string, content: string): Promise<void> {
  writeCharter(projectPath, role, content)
  await fullSync(projectId, projectPath)
}

/**
 * Create a template: write file → update cache
 */
export async function createTemplate(projectId: string, projectPath: string, name: string, content: string, type?: 'ai' | 'manual'): Promise<void> {
  writeTemplate(projectPath, name, content, type)
  await fullSync(projectId, projectPath)
}

/**
 * Delete a template: git rm → update cache
 */
export async function removeTemplate(projectId: string, projectPath: string, name: string): Promise<void> {
  deleteTemplateFile(projectPath, name)
  await fullSync(projectId, projectPath)
}

// ── Status mapping ───────────────────────────────────────────────────

function mapTaskStatusToRt(status: TaskStatus): string {
  const map: Record<TaskStatus, string> = {
    open: 'open',
    in_progress: 'in_progress',
    pr_review: 'pr_review',
    landed: 'landed',
    cancelled: 'cancelled',
  }
  return map[status] ?? 'open'
}
