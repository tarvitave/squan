import { createClient, type Client } from '@libsql/client'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_URL = process.env.DB_URL ?? `file:${path.join(__dirname, '../../squansq.db')}`

let client: Client

export function getDb(): Client {
  if (!client) {
    client = createClient({ url: DB_URL })
  }
  return client
}

export async function migrate() {
  const db = getDb()

  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS towns (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rigs (
      id TEXT PRIMARY KEY,
      town_id TEXT NOT NULL,
      name TEXT NOT NULL,
      repo_url TEXT NOT NULL,
      local_path TEXT NOT NULL,
      runtime_json TEXT NOT NULL DEFAULT '{}',
      user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workerbees (
      id TEXT PRIMARY KEY,
      rig_id TEXT NOT NULL,
      name TEXT NOT NULL,
      branch TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      hook_id TEXT,
      session_id TEXT,
      user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mayors (
      id TEXT PRIMARY KEY,
      town_id TEXT NOT NULL,
      session_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hooks (
      id TEXT PRIMARY KEY,
      rig_id TEXT NOT NULL,
      workerbee_id TEXT,
      atomic_task_id TEXT,
      status TEXT NOT NULL DEFAULT 'created',
      branch TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS release_trains (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      rig_id TEXT NOT NULL,
      atomic_task_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'open',
      user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS atomic_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      release_train_id TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      assignee_id TEXT,
      depends_on TEXT NOT NULL DEFAULT '[]',
      user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      workerbee_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      content TEXT NOT NULL,
      captured_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS replay_frames (
      id TEXT PRIMARY KEY,
      workerbee_id TEXT NOT NULL,
      content TEXT NOT NULL,
      frame_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      anthropic_api_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // Additive column migrations — safe to run repeatedly (errors mean column already exists)
  const alterStatements = [
    `ALTER TABLE polecats RENAME TO workerbees`,
    `ALTER TABLE beads RENAME TO atomic_tasks`,
    `ALTER TABLE hooks RENAME COLUMN polecat_id TO workerbee_id`,
    `ALTER TABLE convoys RENAME COLUMN bead_ids_json TO atomic_task_ids_json`,
    `ALTER TABLE workerbees ADD COLUMN task_description TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE convoys ADD COLUMN description TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE convoys ADD COLUMN assigned_workerbee_id TEXT`,
    `ALTER TABLE atomic_tasks ADD COLUMN depends_on TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE workerbees ADD COLUMN completion_note TEXT NOT NULL DEFAULT ''`,
    // convoy → release_train migrations
    `ALTER TABLE convoys RENAME TO release_trains`,
    `ALTER TABLE atomic_tasks RENAME COLUMN convoy_id TO release_train_id`,
    `ALTER TABLE release_trains RENAME COLUMN bead_ids_json TO atomic_task_ids_json`,
    `ALTER TABLE release_trains ADD COLUMN description TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE release_trains ADD COLUMN assigned_workerbee_id TEXT`,
    // multi-tenant user_id columns
    `ALTER TABLE towns ADD COLUMN user_id TEXT`,
    `ALTER TABLE rigs ADD COLUMN user_id TEXT`,
    `ALTER TABLE workerbees ADD COLUMN user_id TEXT`,
    `ALTER TABLE mayors ADD COLUMN user_id TEXT`,
    `ALTER TABLE hooks ADD COLUMN user_id TEXT`,
    `ALTER TABLE release_trains ADD COLUMN user_id TEXT`,
    `ALTER TABLE atomic_tasks ADD COLUMN user_id TEXT`,
    `ALTER TABLE templates ADD COLUMN user_id TEXT`,
    `ALTER TABLE release_trains ADD COLUMN manual INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE release_trains ADD COLUMN pr_url TEXT`,
    `ALTER TABLE release_trains ADD COLUMN pr_number INTEGER`,
    `ALTER TABLE users ADD COLUMN github_token TEXT`,
    `ALTER TABLE users ADD COLUMN claude_theme TEXT NOT NULL DEFAULT 'dark'`,
  ]
  for (const sql of alterStatements) {
    try {
      await db.execute({ sql, args: [] })
    } catch {
      // Column already exists or table already renamed — ignore
    }
  }
}

const SYSTEM_TEMPLATES = [
  {
    id: 'system-security-review',
    name: 'Security Review',
    content: `You are a security engineer performing a thorough security audit of this codebase. Approach this like Claude Code Security — systematic, comprehensive, and actionable.

## Scope

Review every file in the repository. Focus on:

### Injection & Input
- SQL injection, command injection, XSS, SSTI, path traversal
- Missing input validation and sanitisation
- Unsafe use of eval, exec, shell commands

### Authentication & Authorisation
- Broken authentication flows
- Insecure direct object references (IDOR)
- Missing authorisation checks on API endpoints
- Privilege escalation paths

### Secrets & Data Exposure
- Hardcoded API keys, passwords, tokens in source
- Sensitive data in logs, error messages, or client-visible responses
- PII exposure
- Insecure storage of credentials

### Dependencies
- Run \`npm audit\` (or equivalent for the stack) and record CVEs
- Note outdated packages with known vulnerabilities

### Configuration & Infrastructure
- Overly permissive CORS
- Missing security headers (CSP, HSTS, X-Frame-Options)
- Debug modes or verbose errors enabled in production paths
- Insecure defaults

### Cryptography
- Weak algorithms (MD5, SHA1 for passwords, DES)
- Hardcoded or predictable secrets/salts
- Improper key management

### OWASP Top 10
- Check each of the OWASP Top 10 categories systematically

## Output Format

Create or overwrite SECURITY_REVIEW.md in the repo root with:

\`\`\`
# Security Review — [date]

## Summary
Total findings: N (X critical, Y high, Z medium, W low)

## Findings

### [SEV] Title
- **Location**: file.ts:line
- **Vulnerability**: description of the issue
- **Impact**: what an attacker could do
- **Remediation**: concrete fix with code example where possible

[repeat for each finding]

## Dependency Audit
[output of npm audit or equivalent]

## Recommendations
[top 3-5 prioritised actions]
\`\`\`

## When Done

Commit SECURITY_REVIEW.md with message: "security: add security review findings"
Then output: **DONE: Security review complete — N findings (X critical, Y high, Z medium)**`,
  },
  {
    id: 'system-design-review',
    name: 'Design Review',
    content: `You are a senior software architect performing a design and code quality review.

Review for:
- Architecture and structural concerns (coupling, cohesion, separation of concerns)
- API design (consistency, naming, versioning, error handling)
- Data model design (normalisation, relationships, indexing)
- Performance bottlenecks (N+1 queries, missing caching, blocking I/O)
- Scalability constraints
- Testability and test coverage gaps
- Code duplication and refactoring opportunities
- Documentation and readability issues
- Dependency management and tech debt

For each concern:
1. Identify the issue and its location
2. Explain why it matters
3. Suggest a concrete improvement

Write your findings to DESIGN_REVIEW.md in the repo root.
End your message with DONE: Design review complete — N concerns (X major, Y minor)`,
  },
]

export async function seedSystemTemplates() {
  const db = getDb()
  for (const tpl of SYSTEM_TEMPLATES) {
    const existing = await db.execute({ sql: 'SELECT id FROM templates WHERE id = ?', args: [tpl.id] })
    if (existing.rows.length === 0) {
      await db.execute({
        sql: `INSERT INTO templates (id, project_id, name, content) VALUES (?, 'system', ?, ?)`,
        args: [tpl.id, tpl.name, tpl.content],
      })
    } else {
      // Always keep system templates up to date with latest content
      await db.execute({
        sql: `UPDATE templates SET name = ?, content = ? WHERE id = ?`,
        args: [tpl.name, tpl.content, tpl.id],
      })
    }
  }
}
