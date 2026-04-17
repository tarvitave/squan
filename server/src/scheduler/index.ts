/**
 * Scheduler / Automations System
 *
 * Supports three automation types:
 *   - scheduled  – cron-based recurring tasks
 *   - event      – triggered by push, PR, issue, or agent completion
 *   - chain      – runs after another automation finishes
 */

import { getDb } from '../db/index.js'
import { v4 as uuidv4 } from 'uuid'
import type { Client } from '@libsql/client'

// ── Types ────────────────────────────────────────────────────────────────────

export interface Automation {
  id: string
  name: string
  projectId: string
  type: 'scheduled' | 'event' | 'chain'
  enabled: boolean
  skillId?: string
  taskDescription?: string
  role?: string
  schedule?: { cron: string; timezone?: string }
  trigger?: {
    event: 'push' | 'pr_opened' | 'issue_created' | 'agent_completed'
    filter?: string
  }
  chain?: { afterAutomationId: string; condition?: 'success' | 'any' }
  lastRun?: string
  nextRun?: string
  userId: string
  createdAt: string
}

// ── Cron Helpers ─────────────────────────────────────────────────────────────

interface CronFields {
  minute: number[]
  hour: number[]
  dayOfMonth: number[]
  month: number[]
  dayOfWeek: number[]
}

function expandField(field: string, min: number, max: number): number[] {
  const values: number[] = []

  for (const part of field.split(',')) {
    const trimmed = part.trim()

    // Step: */N or M-N/S
    if (trimmed.includes('/')) {
      const [range, stepStr] = trimmed.split('/')
      const step = parseInt(stepStr, 10)
      let start = min
      let end = max
      if (range !== '*') {
        const [a, b] = range.split('-').map(Number)
        start = a
        if (b !== undefined && !isNaN(b)) end = b
      }
      for (let i = start; i <= end; i += step) values.push(i)
    }
    // Range: M-N
    else if (trimmed.includes('-')) {
      const [a, b] = trimmed.split('-').map(Number)
      for (let i = a; i <= b; i++) values.push(i)
    }
    // Wildcard
    else if (trimmed === '*') {
      for (let i = min; i <= max; i++) values.push(i)
    }
    // Literal
    else {
      const n = parseInt(trimmed, 10)
      if (!isNaN(n)) values.push(n)
    }
  }

  return [...new Set(values)].sort((a, b) => a - b)
}

function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`Invalid cron expression: "${expr}" (need 5 fields)`)
  return {
    minute: expandField(parts[0], 0, 59),
    hour: expandField(parts[1], 0, 23),
    dayOfMonth: expandField(parts[2], 1, 31),
    month: expandField(parts[3], 1, 12),
    dayOfWeek: expandField(parts[4], 0, 6),
  }
}

/**
 * Calculate the next run time after `after` for a cron expression.
 * Walks forward minute-by-minute up to 366 days out.
 */
function nextCronRun(expr: string, after: Date = new Date()): Date {
  const fields = parseCron(expr)
  const d = new Date(after.getTime())
  // Start from the next minute
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)

  const limit = 366 * 24 * 60 // max iterations
  for (let i = 0; i < limit; i++) {
    const matchMonth = fields.month.includes(d.getMonth() + 1)
    const matchDom = fields.dayOfMonth.includes(d.getDate())
    const matchDow = fields.dayOfWeek.includes(d.getDay())
    const matchHour = fields.hour.includes(d.getHours())
    const matchMinute = fields.minute.includes(d.getMinutes())

    if (matchMonth && matchDom && matchDow && matchHour && matchMinute) {
      return d
    }
    d.setMinutes(d.getMinutes() + 1)
  }

  throw new Error(`No matching cron run found within 366 days for "${expr}"`)
}

// ── Common pattern helpers ───────────────────────────────────────────────────

export function daily(hour: number, minute = 0): string {
  return `${minute} ${hour} * * *`
}

export function weekly(dayOfWeek: number, hour: number, minute = 0): string {
  return `${minute} ${hour} * * ${dayOfWeek}`
}

export function hourly(minute = 0): string {
  return `${minute} * * * *`
}

// ── Event Matching ───────────────────────────────────────────────────────────

export function matchEvent(
  automation: Automation,
  eventType: string,
  eventData?: Record<string, unknown>,
): boolean {
  if (automation.type !== 'event' || !automation.trigger) return false
  if (!automation.enabled) return false
  if (automation.trigger.event !== eventType) return false

  if (automation.trigger.filter && eventData) {
    try {
      const re = new RegExp(automation.trigger.filter, 'i')
      const haystack = JSON.stringify(eventData)
      return re.test(haystack)
    } catch {
      return false
    }
  }

  return true
}

// ── Serialisation helpers ────────────────────────────────────────────────────

function rowToAutomation(row: Record<string, unknown>): Automation {
  return {
    id: row.id as string,
    name: row.name as string,
    projectId: row.project_id as string,
    type: row.type as Automation['type'],
    enabled: Boolean(row.enabled),
    skillId: (row.skill_id as string) || undefined,
    taskDescription: (row.task_description as string) || undefined,
    role: (row.role as string) || undefined,
    schedule: row.schedule_json ? JSON.parse(row.schedule_json as string) : undefined,
    trigger: row.trigger_json ? JSON.parse(row.trigger_json as string) : undefined,
    chain: row.chain_json ? JSON.parse(row.chain_json as string) : undefined,
    lastRun: (row.last_run as string) || undefined,
    nextRun: (row.next_run as string) || undefined,
    userId: row.user_id as string,
    createdAt: row.created_at as string,
  }
}

// ── Scheduler Manager ────────────────────────────────────────────────────────

export class SchedulerManager {
  private db: Client
  private interval: ReturnType<typeof setInterval> | null = null

  constructor(db: Client) {
    this.db = db
  }

  /** Create the automations table if it doesn't exist. */
  async init(): Promise<void> {
    await this.db.execute({
      sql: `CREATE TABLE IF NOT EXISTS automations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        project_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('scheduled','event','chain')),
        enabled INTEGER NOT NULL DEFAULT 1,
        skill_id TEXT,
        task_description TEXT,
        role TEXT,
        schedule_json TEXT,
        trigger_json TEXT,
        chain_json TEXT,
        last_run TEXT,
        next_run TEXT,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      args: [],
    })
  }

  /** List all automations visible to a user. */
  async list(userId: string): Promise<Automation[]> {
    const result = await this.db.execute({
      sql: 'SELECT * FROM automations WHERE user_id = ? ORDER BY created_at DESC',
      args: [userId],
    })
    return result.rows.map((r) => rowToAutomation(r as Record<string, unknown>))
  }

  /** Create a new automation. */
  async create(input: Partial<Automation> & { name: string; projectId: string; userId: string; type: Automation['type'] }): Promise<Automation> {
    const id = input.id ?? uuidv4()
    const now = new Date().toISOString()

    let nextRun: string | null = null
    if (input.type === 'scheduled' && input.schedule?.cron) {
      try {
        nextRun = nextCronRun(input.schedule.cron).toISOString()
      } catch { /* invalid cron — leave null */ }
    }

    await this.db.execute({
      sql: `INSERT INTO automations
            (id, name, project_id, type, enabled, skill_id, task_description, role,
             schedule_json, trigger_json, chain_json, next_run, user_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.name,
        input.projectId,
        input.type,
        input.enabled !== false ? 1 : 0,
        input.skillId ?? null,
        input.taskDescription ?? null,
        input.role ?? null,
        input.schedule ? JSON.stringify(input.schedule) : null,
        input.trigger ? JSON.stringify(input.trigger) : null,
        input.chain ? JSON.stringify(input.chain) : null,
        nextRun,
        input.userId,
        now,
      ],
    })

    return {
      id,
      name: input.name,
      projectId: input.projectId,
      type: input.type,
      enabled: input.enabled !== false,
      skillId: input.skillId,
      taskDescription: input.taskDescription,
      role: input.role,
      schedule: input.schedule,
      trigger: input.trigger,
      chain: input.chain,
      nextRun: nextRun ?? undefined,
      userId: input.userId,
      createdAt: now,
    }
  }

  /** Update an existing automation. */
  async update(id: string, updates: Partial<Automation>): Promise<Automation> {
    const existing = await this.db.execute({ sql: 'SELECT * FROM automations WHERE id = ?', args: [id] })
    if (!existing.rows.length) throw new Error(`Automation ${id} not found`)

    const current = rowToAutomation(existing.rows[0] as Record<string, unknown>)
    const merged = { ...current, ...updates }

    // Recalculate next run if schedule changed
    let nextRun = merged.nextRun ?? null
    if (merged.type === 'scheduled' && merged.schedule?.cron) {
      try {
        nextRun = nextCronRun(merged.schedule.cron).toISOString()
      } catch { /* leave current */ }
    }

    await this.db.execute({
      sql: `UPDATE automations SET
              name = ?, project_id = ?, type = ?, enabled = ?,
              skill_id = ?, task_description = ?, role = ?,
              schedule_json = ?, trigger_json = ?, chain_json = ?,
              next_run = ?
            WHERE id = ?`,
      args: [
        merged.name,
        merged.projectId,
        merged.type,
        merged.enabled ? 1 : 0,
        merged.skillId ?? null,
        merged.taskDescription ?? null,
        merged.role ?? null,
        merged.schedule ? JSON.stringify(merged.schedule) : null,
        merged.trigger ? JSON.stringify(merged.trigger) : null,
        merged.chain ? JSON.stringify(merged.chain) : null,
        nextRun,
        id,
      ],
    })

    return { ...merged, nextRun: nextRun ?? undefined }
  }

  /** Delete an automation. */
  async delete(id: string): Promise<void> {
    await this.db.execute({ sql: 'DELETE FROM automations WHERE id = ?', args: [id] })
  }

  /** Enable an automation. */
  async enable(id: string): Promise<void> {
    await this.db.execute({ sql: 'UPDATE automations SET enabled = 1 WHERE id = ?', args: [id] })
  }

  /** Disable an automation. */
  async disable(id: string): Promise<void> {
    await this.db.execute({ sql: 'UPDATE automations SET enabled = 0 WHERE id = ?', args: [id] })
  }

  /** Get all enabled scheduled automations that are due to run. */
  async getNextRuns(): Promise<Automation[]> {
    const now = new Date().toISOString()
    const result = await this.db.execute({
      sql: `SELECT * FROM automations
            WHERE enabled = 1 AND type = 'scheduled' AND next_run IS NOT NULL AND next_run <= ?
            ORDER BY next_run ASC`,
      args: [now],
    })
    return result.rows.map((r) => rowToAutomation(r as Record<string, unknown>))
  }

  /** Record that an automation has run and compute its next scheduled time. */
  async recordRun(id: string): Promise<void> {
    const now = new Date()
    const nowIso = now.toISOString()

    const existing = await this.db.execute({ sql: 'SELECT * FROM automations WHERE id = ?', args: [id] })
    if (!existing.rows.length) return

    const auto = rowToAutomation(existing.rows[0] as Record<string, unknown>)
    let nextRun: string | null = null

    if (auto.type === 'scheduled' && auto.schedule?.cron) {
      try {
        nextRun = nextCronRun(auto.schedule.cron, now).toISOString()
      } catch { /* leave null */ }
    }

    await this.db.execute({
      sql: 'UPDATE automations SET last_run = ?, next_run = ? WHERE id = ?',
      args: [nowIso, nextRun, id],
    })
  }

  /** Get automations chained to a specific automation id. */
  async getChainedAutomations(afterAutomationId: string, success: boolean): Promise<Automation[]> {
    const result = await this.db.execute({
      sql: `SELECT * FROM automations WHERE enabled = 1 AND type = 'chain'`,
      args: [],
    })
    return result.rows
      .map((r) => rowToAutomation(r as Record<string, unknown>))
      .filter((a) => {
        if (!a.chain || a.chain.afterAutomationId !== afterAutomationId) return false
        if (a.chain.condition === 'success' && !success) return false
        return true
      })
  }

  /** Get automations that match an incoming event. */
  async getEventAutomations(
    eventType: string,
    eventData?: Record<string, unknown>,
  ): Promise<Automation[]> {
    const result = await this.db.execute({
      sql: `SELECT * FROM automations WHERE enabled = 1 AND type = 'event'`,
      args: [],
    })
    return result.rows
      .map((r) => rowToAutomation(r as Record<string, unknown>))
      .filter((a) => matchEvent(a, eventType, eventData))
  }

  /**
   * Start the scheduler loop.
   * Checks every 60 seconds for scheduled automations that are due.
   * The provided callback is invoked for each due automation.
   */
  start(onDue?: (automation: Automation) => void): void {
    if (this.interval) return
    console.log('[scheduler] Started — checking every 60 s')

    this.interval = setInterval(async () => {
      try {
        const due = await this.getNextRuns()
        for (const auto of due) {
          console.log(`[scheduler] Firing automation "${auto.name}" (${auto.id})`)
          await this.recordRun(auto.id)
          onDue?.(auto)
        }
      } catch (err) {
        console.error('[scheduler] Tick error:', (err as Error).message)
      }
    }, 60_000)
  }

  /** Stop the scheduler loop. */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
      console.log('[scheduler] Stopped')
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let _instance: SchedulerManager | null = null

export function getSchedulerManager(): SchedulerManager {
  if (!_instance) {
    _instance = new SchedulerManager(getDb())
  }
  return _instance
}

export const schedulerManager = {
  /** Lazy-init: call once at startup to create the table. */
  async init(): Promise<SchedulerManager> {
    const mgr = getSchedulerManager()
    await mgr.init()
    return mgr
  },
}
