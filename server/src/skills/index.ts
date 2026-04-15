/**
 * Skill System — declarative YAML workflows for chaining agent tasks.
 * Skills define multi-step automation: test→fix→PR, review→refactor, etc.
 */

import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { getDb } from '../db/index.js'
import { v4 as uuidv4 } from 'uuid'

// ── Types ────────────────────────────────────────────────────────────────────

export interface SkillStep {
  name: string
  task: string
  role?: string           // agent role: coder, tester, reviewer, devops, lead
  condition?: string      // run only if previous step result matches (regex)
  on_failure?: 'stop' | 'continue' | 'retry'
  max_retries?: number
  depends_on?: string[]   // step names this depends on
}

export interface Skill {
  id: string
  name: string
  description: string
  version?: string
  steps: SkillStep[]
  projectId?: string      // null = global skill
}

export interface SkillRun {
  id: string
  skillId: string
  projectId: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  currentStep: number
  stepResults: Array<{
    stepName: string
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
    agentId?: string
    result?: string
    startedAt?: string
    completedAt?: string
  }>
  startedAt: string
  completedAt?: string
}

// ── YAML Parser (simple, no dependency) ──────────────────────────────────────

function parseSimpleYaml(text: string): any {
  // Minimal YAML parser for skill files — handles basic structures
  const lines = text.split('\n')
  const result: any = {}
  let currentKey = ''
  let currentList: any[] | null = null
  let currentObj: any = null
  let indent = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    // List item
    if (trimmed.startsWith('- ')) {
      const value = trimmed.slice(2).trim()
      if (currentList) {
        // Check if it's a key-value in a list item
        if (value.includes(':')) {
          const obj: any = {}
          const [k, ...rest] = value.split(':')
          obj[k.trim()] = rest.join(':').trim().replace(/^["']|["']$/g, '')
          currentObj = obj
          currentList.push(obj)
        } else {
          currentList.push(value.replace(/^["']|["']$/g, ''))
          currentObj = null
        }
      }
      continue
    }

    // Continuation of list object
    if (currentObj && line.startsWith('    ') && trimmed.includes(':')) {
      const [k, ...rest] = trimmed.split(':')
      const val = rest.join(':').trim().replace(/^["']|["']$/g, '')
      currentObj[k.trim()] = val === 'true' ? true : val === 'false' ? false : isNaN(Number(val)) ? val : Number(val)
      continue
    }

    // Top-level key
    if (trimmed.includes(':')) {
      currentObj = null
      const [key, ...rest] = trimmed.split(':')
      const val = rest.join(':').trim()
      currentKey = key.trim()

      if (val) {
        result[currentKey] = val.replace(/^["']|["']$/g, '')
        currentList = null
      } else {
        // Starts a list or nested object
        result[currentKey] = []
        currentList = result[currentKey]
      }
    }
  }

  return result
}

// ── Skill Manager ───────────────────────────────────────────────────────────

export const skillManager = {
  /** Parse a skill from YAML text */
  parse(yamlText: string): Omit<Skill, 'id'> {
    const data = parseSimpleYaml(yamlText)
    return {
      name: data.name ?? 'Untitled Skill',
      description: data.description ?? '',
      version: data.version,
      steps: (data.steps ?? []).map((s: any) => ({
        name: s.name ?? 'unnamed',
        task: s.task ?? '',
        role: s.role,
        condition: s.condition,
        on_failure: s.on_failure ?? 'stop',
        max_retries: s.max_retries ?? 0,
        depends_on: s.depends_on ? String(s.depends_on).split(',').map((d: string) => d.trim()) : undefined,
      })),
    }
  },

  /** Load skills from .squan/skills/ directory */
  async loadFromProject(projectPath: string): Promise<Skill[]> {
    const skillsDir = join(projectPath, '.squan', 'skills')
    if (!existsSync(skillsDir)) return []

    const skills: Skill[] = []
    for (const file of readdirSync(skillsDir)) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue
      try {
        const content = readFileSync(join(skillsDir, file), 'utf8')
        const skill = this.parse(content)
        skills.push({ id: file.replace(/\.ya?ml$/, ''), ...skill })
      } catch (err) {
        console.warn(`[skills] Failed to parse ${file}: ${(err as Error).message}`)
      }
    }
    return skills
  },

  /** List all skills (DB + project files) */
  async list(projectId?: string): Promise<Skill[]> {
    const db = getDb()
    const sql = projectId
      ? 'SELECT * FROM skills WHERE project_id = ? OR project_id IS NULL ORDER BY name'
      : 'SELECT * FROM skills ORDER BY name'
    const result = await db.execute({ sql, args: projectId ? [projectId] : [] })
    return result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? '',
      version: r.version,
      steps: JSON.parse(r.steps_json ?? '[]'),
      projectId: r.project_id,
    }))
  },

  /** Save a skill to DB */
  async save(skill: Omit<Skill, 'id'> & { projectId?: string }): Promise<Skill> {
    const db = getDb()
    const id = uuidv4()
    await db.execute({
      sql: `INSERT INTO skills (id, name, description, version, steps_json, project_id) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [id, skill.name, skill.description, skill.version ?? '1.0', JSON.stringify(skill.steps), skill.projectId ?? null],
    })
    return { id, ...skill }
  },

  /** Delete a skill */
  async delete(id: string): Promise<void> {
    const db = getDb()
    await db.execute({ sql: 'DELETE FROM skills WHERE id = ?', args: [id] })
  },

  /** Get built-in skills */
  builtins(): Skill[] {
    return [
      {
        id: 'builtin-test-fix-pr',
        name: 'Test → Fix → PR',
        description: 'Run tests, fix failures, create PR',
        steps: [
          { name: 'run-tests', task: 'Run the test suite and report any failures. If all tests pass, use task_complete with "All tests passing".', role: 'tester' },
          { name: 'fix-failures', task: 'Fix the test failures reported in the previous step. Run the tests again to verify.', role: 'coder', condition: 'fail|error|FAIL' },
          { name: 'create-pr', task: 'Stage all changes, commit with a clear message, and push the branch.', role: 'coder' },
        ],
      },
      {
        id: 'builtin-review-refactor',
        name: 'Review → Refactor',
        description: 'Code review then refactor based on findings',
        steps: [
          { name: 'review', task: 'Review the codebase for code quality issues, security vulnerabilities, and design problems. List specific files and issues found.', role: 'reviewer' },
          { name: 'refactor', task: 'Address the code quality issues found in the review. Focus on the most impactful improvements.', role: 'coder' },
        ],
      },
      {
        id: 'builtin-doc-gen',
        name: 'Generate Docs',
        description: 'Analyze codebase and generate documentation',
        steps: [
          { name: 'analyze', task: 'Analyze the project structure, key modules, and public APIs. Create a summary of the architecture.', role: 'lead' },
          { name: 'write-docs', task: 'Generate comprehensive README.md and API documentation based on the analysis.', role: 'coder' },
        ],
      },
      {
        id: 'builtin-security-audit',
        name: 'Security Audit',
        description: 'Full security review of the codebase',
        steps: [
          { name: 'scan', task: 'Scan the codebase for security vulnerabilities: SQL injection, XSS, hardcoded secrets, insecure dependencies, auth issues. Report findings.', role: 'reviewer' },
          { name: 'fix', task: 'Fix the security vulnerabilities found. Prioritize critical issues first.', role: 'coder', condition: 'vulnerability|issue|CVE|secret' },
          { name: 'verify', task: 'Verify all security fixes are correct and no new issues were introduced. Run any security-related tests.', role: 'tester' },
        ],
      },
    ]
  },
}
