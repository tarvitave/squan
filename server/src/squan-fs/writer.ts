/**
 * Writes .squan/ files and commits changes to git.
 * Every write operation = a git commit for full audit trail.
 */

import { writeFileSync, mkdirSync, existsSync, unlinkSync, renameSync, readdirSync, readFileSync } from 'fs'
import { join, dirname, basename } from 'path'
import { execFileSync } from 'child_process'
import { stringify as yamlStringify } from 'yaml'
import { serializeFrontmatter } from './frontmatter.js'
import type { TaskMeta, TaskStatus, SquanConfig, CharterMeta, TemplateMeta, DocMeta } from './types.js'

// ── Git helpers ──────────────────────────────────────────────────────

function gitAdd(projectPath: string, ...files: string[]) {
  try {
    execFileSync('git', ['-C', projectPath, 'add', ...files], { stdio: 'pipe' })
  } catch { /* not a git repo — skip */ }
}

function gitCommit(projectPath: string, message: string) {
  try {
    execFileSync('git', ['-C', projectPath, 'commit', '-m', message, '--allow-empty'], { stdio: 'pipe' })
  } catch (err) {
    // Nothing to commit is fine
    const msg = (err as Error).message ?? ''
    if (!msg.includes('nothing to commit')) {
      console.warn(`[squan-fs] git commit warning: ${msg.slice(0, 200)}`)
    }
  }
}

function gitMv(projectPath: string, from: string, to: string) {
  try {
    execFileSync('git', ['-C', projectPath, 'mv', from, to], { stdio: 'pipe' })
  } catch {
    // Fallback to manual rename if git mv fails
    renameSync(join(projectPath, from), join(projectPath, to))
    gitAdd(projectPath, from, to)
  }
}

function gitRm(projectPath: string, file: string) {
  try {
    execFileSync('git', ['-C', projectPath, 'rm', '-f', file], { stdio: 'pipe' })
  } catch {
    // Fallback to manual delete
    const full = join(projectPath, file)
    if (existsSync(full)) unlinkSync(full)
  }
}

// ── Initialize .squan/ directory ─────────────────────────────────────

export function initSquanDir(projectPath: string, projectName: string): void {
  const sqDir = join(projectPath, '.squan')
  if (existsSync(sqDir)) {
    console.log(`[squan-fs] .squan/ already exists at ${projectPath}`)
    return
  }

  // Create directory structure
  const dirs = [
    '.squan',
    '.squan/board/open',
    '.squan/board/in_progress',
    '.squan/board/pr_review',
    '.squan/board/landed',
    '.squan/board/cancelled',
    '.squan/charters',
    '.squan/templates',
    '.squan/docs',
    '.squan/docs/decisions',
    '.squan/security',
  ]

  for (const d of dirs) {
    mkdirSync(join(projectPath, d), { recursive: true })
  }

  // Write default config
  const config: SquanConfig = {
    version: 1,
    project: {
      name: projectName,
      runtime: {
        provider: 'claude',
        command: 'claude',
        args: [],
      },
    },
    roles: {
      coder: { description: 'Implements features, fixes bugs, writes clean code.' },
      tester: { description: 'Writes tests, identifies edge cases, ensures correctness.' },
      reviewer: { description: 'Reviews code quality, security, and design.' },
    },
    settings: {
      auto_dispatch: true,
      auto_pr: false,
      stall_threshold_minutes: 5,
    },
  }

  writeFileSync(join(sqDir, 'config.yaml'), yamlStringify(config, { lineWidth: 120 }), 'utf8')

  // Write .gitkeep files so empty dirs are tracked
  for (const d of ['board/open', 'board/in_progress', 'board/pr_review', 'board/landed', 'board/cancelled', 'charters', 'templates', 'docs', 'docs/decisions', 'security']) {
    const keepFile = join(sqDir, d, '.gitkeep')
    if (!existsSync(keepFile)) writeFileSync(keepFile, '', 'utf8')
  }

  // Write README
  writeFileSync(join(sqDir, 'README.md'), `# .squan/

This directory contains Squan project state — tasks, documentation, charters, and templates.

Everything here is version-controlled. Changes show up in git history and PR diffs.

## Structure

- \`config.yaml\` — Project configuration and agent roles
- \`board/\` — Kanban board (tasks organized by status directory)
- \`charters/\` — Accumulated agent knowledge per role
- \`templates/\` — Reusable task templates
- \`docs/\` — Project documentation
- \`security/\` — Security reviews and audit trail

## Task format

Each task is a markdown file with YAML frontmatter:

\`\`\`markdown
---
id: "001"
title: Task title
status: open
type: ai
priority: high
---

## Description
What needs to be done...
\`\`\`

Moving a task = moving its file between status directories.
\`git log .squan/board/\` shows the full board history.
`, 'utf8')

  // Git add + commit
  gitAdd(projectPath, '.squan/')
  gitCommit(projectPath, 'squan: initialize .squan/ project directory')
  console.log(`[squan-fs] Initialized .squan/ at ${projectPath}`)
}

// ── Task CRUD ────────────────────────────────────────────────────────

function taskFileName(id: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return `${id}-${slug}.md`
}

export function writeTask(projectPath: string, meta: TaskMeta, description: string): string {
  const fileName = taskFileName(meta.id, meta.title)
  const relPath = join('.squan', 'board', meta.status, fileName)
  const fullPath = join(projectPath, relPath)

  mkdirSync(dirname(fullPath), { recursive: true })
  const content = serializeFrontmatter(meta, description)
  writeFileSync(fullPath, content, 'utf8')

  gitAdd(projectPath, relPath)
  gitCommit(projectPath, `squan: ${meta.status === 'open' ? 'create' : 'update'} task "${meta.title}"`)

  return relPath
}

export function moveTask(projectPath: string, taskId: string, currentStatus: TaskStatus, newStatus: TaskStatus, title: string): string {
  const fileName = taskFileName(taskId, title)
  const oldPath = join('.squan', 'board', currentStatus, fileName)
  const newPath = join('.squan', 'board', newStatus, fileName)

  // Ensure target directory exists
  mkdirSync(join(projectPath, dirname(newPath)), { recursive: true })

  // If old file doesn't exist, search for it by ID prefix
  const resolvedOldPath = findTaskFile(projectPath, taskId, currentStatus) ?? oldPath

  if (existsSync(join(projectPath, resolvedOldPath))) {
    // Update frontmatter status
    const content = readFileSync(join(projectPath, resolvedOldPath), 'utf8')
    const updated = content.replace(/^status:\s*.+$/m, `status: ${newStatus}`)
      .replace(/^updated:\s*.+$/m, `updated: ${new Date().toISOString().slice(0, 10)}`)
    writeFileSync(join(projectPath, resolvedOldPath), updated, 'utf8')

    gitMv(projectPath, resolvedOldPath, newPath)
    gitCommit(projectPath, `squan: move task "${title}" → ${newStatus}`)
  }

  return newPath
}

export function deleteTask(projectPath: string, taskId: string, status: TaskStatus): void {
  const filePath = findTaskFile(projectPath, taskId, status)
  if (filePath) {
    gitRm(projectPath, filePath)
    gitCommit(projectPath, `squan: delete task ${taskId}`)
  }
}

function findTaskFile(projectPath: string, taskId: string, status?: TaskStatus): string | null {
  const statuses: TaskStatus[] = status ? [status] : ['open', 'in_progress', 'pr_review', 'landed', 'cancelled']
  for (const s of statuses) {
    const dir = join(projectPath, '.squan', 'board', s)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      if (f.startsWith(taskId)) {
        return join('.squan', 'board', s, f)
      }
    }
  }
  return null
}

// ── Charter CRUD ─────────────────────────────────────────────────────

export function writeCharter(projectPath: string, role: string, content: string): string {
  const relPath = join('.squan', 'charters', `${role}.md`)
  const fullPath = join(projectPath, relPath)
  mkdirSync(dirname(fullPath), { recursive: true })

  const meta: CharterMeta = { role, updated: new Date().toISOString().slice(0, 10) }
  writeFileSync(fullPath, serializeFrontmatter(meta, content), 'utf8')

  gitAdd(projectPath, relPath)
  gitCommit(projectPath, `squan: update ${role} charter`)
  return relPath
}

// ── Template CRUD ────────────────────────────────────────────────────

export function writeTemplate(projectPath: string, name: string, content: string, type: 'ai' | 'manual' = 'ai'): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  const relPath = join('.squan', 'templates', `${slug}.md`)
  const fullPath = join(projectPath, relPath)
  mkdirSync(dirname(fullPath), { recursive: true })

  const meta: TemplateMeta = { name, type, tags: [], created: new Date().toISOString().slice(0, 10) }
  writeFileSync(fullPath, serializeFrontmatter(meta, content), 'utf8')

  gitAdd(projectPath, relPath)
  gitCommit(projectPath, `squan: add template "${name}"`)
  return relPath
}

export function deleteTemplate(projectPath: string, name: string): void {
  const dir = join(projectPath, '.squan', 'templates')
  if (!existsSync(dir)) return
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  for (const f of readdirSync(dir)) {
    if (f.startsWith(slug) && f.endsWith('.md')) {
      gitRm(projectPath, join('.squan', 'templates', f))
      gitCommit(projectPath, `squan: delete template "${name}"`)
      return
    }
  }
}

// ── Doc CRUD ─────────────────────────────────────────────────────────

export function writeDoc(projectPath: string, title: string, content: string, category?: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  const subDir = category ? join('.squan', 'docs', category) : join('.squan', 'docs')
  const relPath = join(subDir, `${slug}.md`)
  const fullPath = join(projectPath, relPath)
  mkdirSync(dirname(fullPath), { recursive: true })

  const meta: DocMeta = { title, category, updated: new Date().toISOString().slice(0, 10) }
  writeFileSync(fullPath, serializeFrontmatter(meta, content), 'utf8')

  gitAdd(projectPath, relPath)
  gitCommit(projectPath, `squan: update doc "${title}"`)
  return relPath
}

// ── Security CRUD ────────────────────────────────────────────────────

export function writeSecurity(projectPath: string, title: string, content: string, severityCounts?: { critical: number; high: number; medium: number; low: number }): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  const relPath = join('.squan', 'security', `${slug}.md`)
  const fullPath = join(projectPath, relPath)
  mkdirSync(dirname(fullPath), { recursive: true })

  const meta = { title, date: new Date().toISOString().slice(0, 10), severity_counts: severityCounts }
  writeFileSync(fullPath, serializeFrontmatter(meta, content), 'utf8')

  gitAdd(projectPath, relPath)
  gitCommit(projectPath, `squan: update security review "${title}"`)
  return relPath
}

// ── Config write ─────────────────────────────────────────────────────

export function writeConfig(projectPath: string, config: SquanConfig): void {
  const relPath = join('.squan', 'config.yaml')
  const fullPath = join(projectPath, relPath)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, yamlStringify(config, { lineWidth: 120 }), 'utf8')

  gitAdd(projectPath, relPath)
  gitCommit(projectPath, `squan: update config`)
}
