/**
 * spawn-setup.ts — Shared setup logic for agent spawning.
 * Creates git worktree, CLAUDE.md, config dir, etc.
 * Used by both PTY (terminal) and StructuredRunner (Goose-style) modes.
 */

import { execFileSync, type ExecFileSyncOptions } from 'child_process'
import { mkdirSync, writeFileSync, existsSync, copyFileSync, readdirSync } from 'fs'
import * as path from 'path'
import * as os from 'os'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { rigManager } from '../rig/manager.js'
import { getUserById } from '../auth/index.js'

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3001'

// ── Name allocation ──────────────────────────────────────────────────────────

const BEE_NAMES = [
  'alpha','bravo','charlie','delta','echo','foxtrot','golf','hotel','india',
  'juliet','kilo','lima','mike','november','oscar','papa','quebec','romeo',
  'sierra','tango','uniform','victor','whiskey','xray','yankee','zulu',
]

async function allocateName(projectId: string): Promise<string> {
  const db = getDb()
  const existing = await db.execute({
    sql: `SELECT name FROM workerbees WHERE rig_id = ?`,
    args: [projectId],
  })
  const usedNames = new Set(existing.rows.map((r) => r.name as string))
  for (const name of BEE_NAMES) {
    const fullName = `bee-${name}`
    if (!usedNames.has(fullName)) return fullName
  }
  return `bee-${uuidv4().slice(0, 8)}`
}

// ── Charter reading ──────────────────────────────────────────────────────────

async function getCharter(projectId: string, role: string): Promise<string | undefined> {
  const db = getDb()
  const result = await db.execute({
    sql: `SELECT content FROM charters WHERE rig_id = ? AND role = ? LIMIT 1`,
    args: [projectId, role],
  })
  return result.rows[0]?.content as string | undefined
}

// ── CLAUDE.md builder ────────────────────────────────────────────────────────

function buildClaudeMd(name: string, task: string, role: string, charter?: string): string {
  const lines = [
    `# Agent: ${name}`,
    `Role: ${role}`,
    '',
    '## Your Task',
    task,
    '',
    '## Completion Signals',
    '- When DONE: output a line starting with `DONE:` followed by a brief summary',
    '- If BLOCKED: output a line starting with `BLOCKED:` followed by the reason',
    '',
  ]
  if (charter) {
    lines.push('## Project Knowledge', charter, '')
  }
  return lines.join('\n')
}

// ── Spawn setup result ───────────────────────────────────────────────────────

export interface SpawnSetupResult {
  id: string
  name: string
  branch: string
  worktreePath: string
  agentConfigDir: string
  env: Record<string, string>
  taskDescription: string
  projectId: string
  userId: string | null
}

// ── Main setup function ──────────────────────────────────────────────────────

export async function setupAgentSpawn(
  projectId: string,
  taskDescription: string,
  userId?: string,
  role: string = 'coder',
): Promise<SpawnSetupResult> {
  const db = getDb()
  const id = uuidv4()
  const name = await allocateName(projectId)
  const branch = `workerbee/${name}-${Date.now()}`

  const project = await rigManager.getById(projectId)

  // --- Git worktree isolation ---
  let worktreePath = project?.localPath ?? path.join(os.tmpdir(), 'squansq', projectId, name)
  let worktreesBase: string | undefined

  if (project?.localPath) {
    worktreesBase = path.resolve(project.localPath, '..', '.squansq-worktrees', projectId)
    const targetPath = path.join(worktreesBase, `${name}-${Date.now()}`)
    try {
      mkdirSync(worktreesBase, { recursive: true })
      execFileSync('git', ['-C', project.localPath, 'worktree', 'add', targetPath, '-b', branch], { stdio: 'pipe' })
      worktreePath = targetPath
      console.log(`[spawn-setup] Created worktree at ${worktreePath} on branch ${branch}`)
    } catch (err) {
      console.warn(`[spawn-setup] git worktree failed, falling back to project root: ${err}`)
      worktreePath = project.localPath
      try {
        execFileSync('git', ['-C', project.localPath, 'branch', branch], { stdio: 'pipe' })
      } catch { /* branch may exist */ }
    }
  }

  // --- CLAUDE.md task injection ---
  if (taskDescription) {
    try {
      const charter = await getCharter(projectId, role)
      writeFileSync(path.join(worktreePath, 'CLAUDE.md'), buildClaudeMd(name, taskDescription, role, charter), 'utf8')
      console.log(`[spawn-setup] Injected CLAUDE.md for ${name}`)
    } catch (err) {
      console.warn(`[spawn-setup] Failed to write CLAUDE.md: ${err}`)
    }
  }

  // --- Git post-commit hook ---
  if (worktreePath && worktreePath !== project?.localPath) {
    try {
      const hooksDir = path.join(worktreePath, '.git', 'hooks')
      mkdirSync(hooksDir, { recursive: true })
      const hookScript = [
        '#!/bin/sh',
        `curl -s -X POST "${SERVER_URL}/api/workerbees/${id}/commit" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d "{\\"branch\\":\\"${branch}\\",\\"message\\":\\"$(git log -1 --pretty=%s)\\"}" \\`,
        '  > /dev/null 2>&1 || true',
      ].join('\n')
      writeFileSync(path.join(hooksDir, 'post-commit'), hookScript, { mode: 0o755 })
    } catch { /* non-fatal */ }
  }

  // --- Agent config dir ---
  const agentConfigDir = path.join(worktreesBase ?? path.join(os.tmpdir(), 'squansq-configs'), `${name}-config`)
  mkdirSync(agentConfigDir, { recursive: true })

  // Copy OAuth credentials from ~/.claude/
  const homeClaudeDir = path.join(os.homedir(), '.claude')
  const configSrc = path.join(homeClaudeDir, 'config.json')
  if (existsSync(configSrc)) {
    try { copyFileSync(configSrc, path.join(agentConfigDir, 'config.json')) } catch { /* ignore */ }
  }

  // Copy statsig cache
  const statsigSrc = path.join(homeClaudeDir, 'statsig')
  if (existsSync(statsigSrc)) {
    try {
      const statsigDst = path.join(agentConfigDir, 'statsig')
      mkdirSync(statsigDst, { recursive: true })
      for (const f of readdirSync(statsigSrc)) {
        copyFileSync(path.join(statsigSrc, f), path.join(statsigDst, f))
      }
    } catch { /* ignore */ }
  }

  // Write agent settings
  const user = userId ? await getUserById(userId) : null
  const agentSettings: Record<string, unknown> = {
    skipDangerousModePermissionPrompt: true,
    theme: user?.claudeTheme ?? 'dark',
  }
  if (user?.anthropicApiKey) agentSettings.primaryApiKey = user.anthropicApiKey
  writeFileSync(path.join(agentConfigDir, 'settings.json'), JSON.stringify(agentSettings), 'utf8')

  // --- Build env ---
  const env: Record<string, string> = {
    SQUANSQ_WORKERBEE: name,
    SQUANSQ_PROJECT: projectId,
    SQUANSQ_BRANCH: branch,
    SQUANSQ_WORKTREE: worktreePath,
    CLAUDE_CONFIG_DIR: agentConfigDir,
  }

  // --- Insert DB record (without session_id — that's set by the caller) ---
  const now = new Date().toISOString()
  await db.execute({
    sql: `INSERT INTO workerbees (id, rig_id, name, branch, worktree_path, task_description, completion_note, role, status, hook_id, session_id, user_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, '', ?, 'idle', NULL, NULL, ?, ?, ?)`,
    args: [id, projectId, name, branch, worktreePath, taskDescription, role, userId ?? null, now, now],
  })

  return {
    id,
    name,
    branch,
    worktreePath,
    agentConfigDir,
    env,
    taskDescription,
    projectId,
    userId: userId ?? null,
  }
}

// Update the session_id on the workerbee record after process is started
export async function updateSessionId(id: string, sessionId: string): Promise<void> {
  const db = getDb()
  await db.execute({
    sql: `UPDATE workerbees SET session_id = ? WHERE id = ?`,
    args: [sessionId, id],
  })
}
