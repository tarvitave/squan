/**
 * Reads the .squan/ directory structure from a project path.
 * Parses all markdown+frontmatter files into typed objects.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join, relative, basename } from 'path'
import { parse as yamlParse } from 'yaml'
import { parseFrontmatter } from './frontmatter.js'
import type {
  SquanDirState, SquanConfig, TaskFile, TaskMeta, TaskStatus,
  CharterFile, CharterMeta, TemplateFile, TemplateMeta,
  DocFile, DocMeta, SecurityFile, SecurityMeta,
} from './types.js'

const BOARD_DIRS: TaskStatus[] = ['open', 'in_progress', 'pr_review', 'landed', 'cancelled']

/**
 * Check if a project has a .squan/ directory.
 */
export function hasSquanDir(projectPath: string): boolean {
  return existsSync(join(projectPath, '.squan'))
}

/**
 * Read the entire .squan/ directory state.
 */
export function readSquanDir(projectPath: string): SquanDirState {
  const sqDir = join(projectPath, '.squan')
  if (!existsSync(sqDir)) {
    return { config: null, tasks: [], charters: [], templates: [], docs: [], security: [] }
  }

  return {
    config: readConfig(projectPath),
    tasks: readBoard(projectPath),
    charters: readCharters(projectPath),
    templates: readTemplates(projectPath),
    docs: readDocs(projectPath),
    security: readSecurity(projectPath),
  }
}

/**
 * Read .squan/config.yaml
 */
export function readConfig(projectPath: string): SquanConfig | null {
  const configPath = join(projectPath, '.squan', 'config.yaml')
  if (!existsSync(configPath)) return null
  try {
    const raw = readFileSync(configPath, 'utf8')
    return yamlParse(raw) as SquanConfig
  } catch {
    return null
  }
}

/**
 * Read all tasks from .squan/board/{status}/*.md
 */
export function readBoard(projectPath: string): TaskFile[] {
  const boardDir = join(projectPath, '.squan', 'board')
  if (!existsSync(boardDir)) return []

  const tasks: TaskFile[] = []

  for (const status of BOARD_DIRS) {
    const statusDir = join(boardDir, status)
    if (!existsSync(statusDir)) continue

    const files = readdirSync(statusDir).filter((f) => f.endsWith('.md'))
    for (const file of files) {
      const filePath = join(statusDir, file)
      try {
        const content = readFileSync(filePath, 'utf8')
        const { meta, body } = parseFrontmatter<Partial<TaskMeta>>(content)

        // Derive status from directory, not frontmatter (directory is authoritative)
        const task: TaskFile = {
          meta: {
            id: meta.id ?? basename(file, '.md'),
            title: meta.title ?? basename(file, '.md'),
            status,
            type: meta.type ?? 'ai',
            priority: meta.priority,
            assignee: meta.assignee ?? null,
            branch: meta.branch ?? null,
            pr_url: meta.pr_url ?? null,
            pr_number: meta.pr_number ?? null,
            depends_on: meta.depends_on ?? [],
            tags: meta.tags ?? [],
            created: meta.created ?? new Date().toISOString().slice(0, 10),
            updated: meta.updated ?? new Date().toISOString().slice(0, 10),
          },
          description: body,
          filePath: relative(join(projectPath, '.squan'), filePath),
        }
        tasks.push(task)
      } catch (err) {
        console.warn(`[squan-fs] Failed to parse task ${filePath}:`, err)
      }
    }
  }

  return tasks
}

/**
 * Read all charters from .squan/charters/*.md
 */
export function readCharters(projectPath: string): CharterFile[] {
  return readMdDir<CharterMeta>(join(projectPath, '.squan', 'charters'), projectPath, (meta, file) => ({
    role: meta.role ?? basename(file, '.md'),
    updated: meta.updated ?? new Date().toISOString().slice(0, 10),
  }))
}

/**
 * Read all templates from .squan/templates/*.md
 */
export function readTemplates(projectPath: string): TemplateFile[] {
  return readMdDir<TemplateMeta>(join(projectPath, '.squan', 'templates'), projectPath, (meta, file) => ({
    name: meta.name ?? basename(file, '.md'),
    type: meta.type ?? 'ai',
    tags: meta.tags ?? [],
    created: meta.created ?? new Date().toISOString().slice(0, 10),
  }))
}

/**
 * Read all docs from .squan/docs/*.md (recursive)
 */
export function readDocs(projectPath: string): DocFile[] {
  const docsDir = join(projectPath, '.squan', 'docs')
  if (!existsSync(docsDir)) return []

  const docs: DocFile[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        walk(full)
      } else if (entry.endsWith('.md')) {
        try {
          const content = readFileSync(full, 'utf8')
          const { meta, body } = parseFrontmatter<Partial<DocMeta>>(content)
          docs.push({
            meta: {
              title: meta.title ?? basename(entry, '.md'),
              category: meta.category ?? (relative(docsDir, dir) || undefined),
              updated: meta.updated ?? new Date().toISOString().slice(0, 10),
              author: meta.author,
            },
            content: body,
            filePath: relative(join(projectPath, '.squan'), full),
          })
        } catch {}
      }
    }
  }
  walk(docsDir)
  return docs
}

/**
 * Read all security files from .squan/security/*.md
 */
export function readSecurity(projectPath: string): SecurityFile[] {
  return readMdDir<SecurityMeta>(join(projectPath, '.squan', 'security'), projectPath, (meta, file) => ({
    title: meta.title ?? basename(file, '.md'),
    date: meta.date ?? new Date().toISOString().slice(0, 10),
    severity_counts: meta.severity_counts,
  }))
}

// ── Helper ───────────────────────────────────────────────────────────

function readMdDir<M>(dir: string, projectPath: string, buildMeta: (raw: Partial<M>, file: string) => M): Array<{ meta: M; content: string; filePath: string }> {
  if (!existsSync(dir)) return []
  const results: Array<{ meta: M; content: string; filePath: string }> = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    try {
      const full = join(dir, file)
      const content = readFileSync(full, 'utf8')
      const { meta, body } = parseFrontmatter<Partial<M>>(content)
      results.push({
        meta: buildMeta(meta, file),
        content: body,
        filePath: relative(join(projectPath, '.squan'), full),
      })
    } catch {}
  }
  return results
}
