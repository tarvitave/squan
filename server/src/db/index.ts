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

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}
