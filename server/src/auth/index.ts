import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import type { Request, Response, NextFunction } from 'express'

const JWT_SECRET = process.env.JWT_SECRET ?? 'squansq-dev-secret-change-in-production'

interface DbUser {
  id: string
  email: string
  password_hash: string
  anthropic_api_key: string | null
  created_at: string
}

export interface AuthUser {
  id: string
  email: string
  anthropicApiKey: string | null
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

  const user: AuthUser = { id, email: email.toLowerCase(), anthropicApiKey: anthropicApiKey ?? null }
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

  const user: AuthUser = { id: row.id, email: row.email, anthropicApiKey: row.anthropic_api_key }
  const token = jwt.sign({ userId: row.id }, JWT_SECRET, { expiresIn: '30d' })
  return { token, user }
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  const db = getDb()
  const result = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [id] })
  const row = result.rows[0] as unknown as DbUser | undefined
  if (!row) return null
  return { id: row.id, email: row.email, anthropicApiKey: row.anthropic_api_key }
}

export async function updateApiKey(userId: string, apiKey: string): Promise<void> {
  const db = getDb()
  await db.execute({ sql: 'UPDATE users SET anthropic_api_key = ? WHERE id = ?', args: [apiKey, userId] })
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
