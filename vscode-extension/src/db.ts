import { createClient, type Client } from '@libsql/client'

let client: Client

export function getDb(): Client {
  if (!client) {
    throw new Error('DB not initialized — call initDb() first')
  }
  return client
}

export async function initDb(dbPath: string): Promise<void> {
  const url = `file:${dbPath}`
  client = createClient({ url })
  await migrate()
}

async function migrate(): Promise<void> {
  const db = getDb()

  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS rigs (
      id TEXT PRIMARY KEY,
      town_id TEXT NOT NULL DEFAULT 'local',
      name TEXT NOT NULL,
      repo_url TEXT NOT NULL,
      local_path TEXT NOT NULL,
      runtime_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workerbees (
      id TEXT PRIMARY KEY,
      rig_id TEXT NOT NULL,
      name TEXT NOT NULL,
      branch TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mayors (
      id TEXT PRIMARY KEY,
      town_id TEXT NOT NULL DEFAULT 'local',
      session_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS release_trains (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      rig_id TEXT NOT NULL,
      atomic_task_ids_json TEXT NOT NULL DEFAULT '[]',
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      assigned_workerbee_id TEXT,
      manual INTEGER NOT NULL DEFAULT 0,
      pr_url TEXT,
      pr_number INTEGER,
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS charters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, role)
    );

    CREATE TABLE IF NOT EXISTS routing_rules (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      pattern TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // Additive column migrations — safe to run repeatedly (errors mean column already exists)
  const alterStatements = [
    `ALTER TABLE workerbees ADD COLUMN task_description TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE workerbees ADD COLUMN completion_note TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE workerbees ADD COLUMN role TEXT NOT NULL DEFAULT 'coder'`,
    `ALTER TABLE workerbees ADD COLUMN hook_id TEXT`,
  ]

  for (const sql of alterStatements) {
    try {
      await db.execute({ sql, args: [] })
    } catch {
      // Column already exists — ignore
    }
  }
}
