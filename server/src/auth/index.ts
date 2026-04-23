import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { refreshAccessToken, type OAuthTokens } from './claude-oauth.js'
import type { Request, Response, NextFunction } from 'express'

const JWT_SECRET = process.env.JWT_SECRET ?? 'squansq-dev-secret-change-in-production'

interface DbUser {
  id: string
  email: string
  password_hash: string
  anthropic_api_key: string | null
  github_token: string | null
  claude_theme: string | null
  anthropic_oauth_access_token: string | null
  anthropic_oauth_refresh_token: string | null
  anthropic_oauth_expires_at: string | null
  anthropic_oauth_scope: string | null
  created_at: string
}

export interface AuthUser {
  id: string
  email: string
  anthropicApiKey: string | null
  githubToken: string | null
  claudeTheme: string
  claudeOAuth: {
    connected: boolean
    expiresAt: string | null
    scope: string | null
  }
}

function toAuthUser(row: DbUser): AuthUser {
  return {
    id: row.id,
    email: row.email,
    anthropicApiKey: row.anthropic_api_key,
    githubToken: row.github_token ?? null,
    claudeTheme: row.claude_theme ?? 'dark',
    claudeOAuth: {
      connected: Boolean(row.anthropic_oauth_access_token),
      expiresAt: row.anthropic_oauth_expires_at,
      scope: row.anthropic_oauth_scope,
    },
  }
}

export async function register(email: string, password: string, anthropicApiKey?: string): Promise<{ token: string; user: AuthUser }> {
  const db = getDb()
  const existing = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email.toLowerCase()] })
  if (existing.rows.length > 0) throw new Error('Email already registered')

  const id = uuidv4()
  const passwordHash = await bcrypt.hash(password, 10)
  const now = new Date().toISOString()

  await db.execute({
    sql: 'INSERT INTO users (id, email, password_hash, anthropic_api_key, created_at) VALUES (?, ?, ?, ?, ?)',
    args: [id, email.toLowerCase(), passwordHash, anthropicApiKey ?? null, now],
  })

  const user: AuthUser = {
    id,
    email: email.toLowerCase(),
    anthropicApiKey: anthropicApiKey ?? null,
    githubToken: null,
    claudeTheme: 'dark',
    claudeOAuth: { connected: false, expiresAt: null, scope: null },
  }
  const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '30d' })
  return { token, user }
}

export async function login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const db = getDb()
  const result = await db.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email.toLowerCase()] })
  const row = result.rows[0] as unknown as DbUser | undefined
  if (!row) throw new Error('Invalid email or password')

  const valid = await bcrypt.compare(password, row.password_hash)
  if (!valid) throw new Error('Invalid email or password')

  const token = jwt.sign({ userId: row.id }, JWT_SECRET, { expiresIn: '30d' })
  return { token, user: toAuthUser(row) }
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  const db = getDb()
  const result = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [id] })
  const row = result.rows[0] as unknown as DbUser | undefined
  if (!row) return null
  return toAuthUser(row)
}

export async function updateApiKey(userId: string, apiKey: string | null): Promise<void> {
  await getDb().execute({ sql: 'UPDATE users SET anthropic_api_key = ? WHERE id = ?', args: [apiKey, userId] })
}

export async function updateGithubToken(userId: string, githubToken: string | null): Promise<void> {
  await getDb().execute({ sql: 'UPDATE users SET github_token = ? WHERE id = ?', args: [githubToken, userId] })
}

export async function updateClaudeTheme(userId: string, theme: string): Promise<void> {
  await getDb().execute({ sql: 'UPDATE users SET claude_theme = ? WHERE id = ?', args: [theme, userId] })
}

export async function saveClaudeOAuth(userId: string, tokens: OAuthTokens): Promise<void> {
  await getDb().execute({
    sql: `UPDATE users SET anthropic_oauth_access_token = ?, anthropic_oauth_refresh_token = ?,
          anthropic_oauth_expires_at = ?, anthropic_oauth_scope = ? WHERE id = ?`,
    args: [tokens.accessToken, tokens.refreshToken, tokens.expiresAt, tokens.scope, userId],
  })
}

export async function clearClaudeOAuth(userId: string): Promise<void> {
  await getDb().execute({
    sql: `UPDATE users SET anthropic_oauth_access_token = NULL, anthropic_oauth_refresh_token = NULL,
          anthropic_oauth_expires_at = NULL, anthropic_oauth_scope = NULL WHERE id = ?`,
    args: [userId],
  })
}

/**
 * Returns a non-expired access token, refreshing if it expires within 60s.
 * Throws if no OAuth connection exists.
 */
export async function getFreshClaudeOAuthToken(userId: string): Promise<string> {
  const db = getDb()
  const result = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [userId] })
  const row = result.rows[0] as unknown as DbUser | undefined
  if (!row?.anthropic_oauth_access_token || !row.anthropic_oauth_refresh_token) {
    throw new Error('Claude OAuth not connected')
  }
  const expiresAt = row.anthropic_oauth_expires_at ? new Date(row.anthropic_oauth_expires_at).getTime() : 0
  if (expiresAt - Date.now() > 60_000) return row.anthropic_oauth_access_token

  const refreshed = await refreshAccessToken(row.anthropic_oauth_refresh_token)
  await saveClaudeOAuth(userId, refreshed)
  return refreshed.accessToken
}

// Stores userId in res.locals (avoids extending Request type, which causes strict-mode errors)
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  try {
    const token = authHeader.slice(7)
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string }
    res.locals.userId = payload.userId
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}
