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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rigs (
      id TEXT PRIMARY KEY,
      town_id TEXT NOT NULL,
      name TEXT NOT NULL,
      repo_url TEXT NOT NULL,
      local_path TEXT NOT NULL,
      runtime_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS polecats (
      id TEXT PRIMARY KEY,
      rig_id TEXT NOT NULL,
      name TEXT NOT NULL,
      branch TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      hook_id TEXT,
      session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mayors (
      id TEXT PRIMARY KEY,
      town_id TEXT NOT NULL,
      session_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hooks (
      id TEXT PRIMARY KEY,
      rig_id TEXT NOT NULL,
      polecat_id TEXT,
      bead_id TEXT,
      status TEXT NOT NULL DEFAULT 'created',
      branch TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS convoys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      rig_id TEXT NOT NULL,
      bead_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS beads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      convoy_id TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      assignee_id TEXT,
      depends_on TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
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
    `ALTER TABLE polecats ADD COLUMN task_description TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE convoys ADD COLUMN description TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE convoys ADD COLUMN assigned_workerbee_id TEXT`,
    `ALTER TABLE beads ADD COLUMN depends_on TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE polecats ADD COLUMN completion_note TEXT NOT NULL DEFAULT ''`,
  ]
  for (const sql of alterStatements) {
    try {
      await db.execute({ sql, args: [] })
    } catch {
      // Column already exists — ignore
    }
  }
}
