/**
 * Claude Code integration
 * - Reads conversation JSONL files from ~/.claude/projects/
 * - Receives hook events (PostToolUse, Stop, etc.) from Claude Code
 * - Configures Claude Code's settings.local.json to POST hooks here
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'fs'
import path from 'path'
import os from 'os'
import type { Request, Response } from 'express'
import { broadcastEvent } from '../ws/server.js'
import { v4 as uuidv4 } from 'uuid'

const HOME_CLAUDE = path.join(os.homedir(), '.claude')
const PROJECTS_DIR = path.join(HOME_CLAUDE, 'projects')
const SERVER_URL = `http://127.0.0.1:${process.env.PORT ?? 3001}`

// ── Session listing ───────────────────────────────────────────────────────────

export interface SessionMeta {
  id: string
  projectPath: string   // decoded path label
  file: string          // absolute path to JSONL
  mtime: number
  size: number
}

export function listSessions(): SessionMeta[] {
  if (!existsSync(PROJECTS_DIR)) return []
  const sessions: SessionMeta[] = []

  try {
    const projectDirs = readdirSync(PROJECTS_DIR)
    for (const dir of projectDirs) {
      const dirPath = path.join(PROJECTS_DIR, dir)
      try {
        const stat = statSync(dirPath)
        if (!stat.isDirectory()) continue
        // Decode C--Users-colin-Projects-foo → C:\Users\colin\Projects\foo
        const projectPath = dir.replace(/--/g, '\\').replace(/-/g, path.sep).replace(/\\\\/g, '\\')
        const files = readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'))
        for (const f of files) {
          const filePath = path.join(dirPath, f)
          const fstat = statSync(filePath)
          sessions.push({
            id: f.replace('.jsonl', ''),
            projectPath: dir,
            file: filePath,
            mtime: fstat.mtimeMs,
            size: fstat.size,
          })
        }
      } catch { /* skip unreadable dirs */ }
    }
  } catch { /* PROJECTS_DIR unreadable */ }

  return sessions.sort((a, b) => b.mtime - a.mtime)
}

// ── Message parsing ───────────────────────────────────────────────────────────

export interface CCMessage {
  uuid?: string
  type: string
  role?: string
  timestamp?: string
  text?: string
  toolName?: string
  toolInput?: unknown
  toolResult?: unknown
  thinking?: string
}

export function parseSession(filePath: string, afterLine = 0): { messages: CCMessage[]; totalLines: number } {
  if (!existsSync(filePath)) return { messages: [], totalLines: 0 }
  const raw = readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
  const messages: CCMessage[] = []

  for (let i = afterLine; i < raw.length; i++) {
    try {
      const entry = JSON.parse(raw[i])
      const msg = parseEntry(entry)
      if (msg) messages.push(msg)
    } catch { /* skip malformed lines */ }
  }

  return { messages, totalLines: raw.length }
}

function parseEntry(entry: Record<string, unknown>): CCMessage | null {
  const type = entry.type as string
  if (!type) return null

  // Skip internal bookkeeping entries
  if (['queue-operation', 'file-history-snapshot', 'debug'].includes(type)) return null

  if (type === 'user' || type === 'assistant') {
    const msg = entry.message as Record<string, unknown> | undefined
    if (!msg) return null
    const content = msg.content
    const role = msg.role as string

    if (typeof content === 'string') {
      return { uuid: entry.uuid as string, type, role, timestamp: entry.timestamp as string, text: content }
    }

    if (Array.isArray(content)) {
      const parts: CCMessage[] = []
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const b = block as Record<string, unknown>
        if (b.type === 'text' && b.text) {
          parts.push({ uuid: entry.uuid as string, type, role, timestamp: entry.timestamp as string, text: b.text as string })
        } else if (b.type === 'tool_use') {
          parts.push({
            uuid: entry.uuid as string,
            type: 'tool_use',
            role,
            timestamp: entry.timestamp as string,
            toolName: b.name as string,
            toolInput: b.input,
          })
        } else if (b.type === 'tool_result') {
          const resultContent = b.content
          const text = Array.isArray(resultContent)
            ? resultContent.filter((c: unknown) => (c as Record<string,unknown>)?.type === 'text').map((c: unknown) => (c as Record<string,unknown>).text).join('\n')
            : typeof resultContent === 'string' ? resultContent : ''
          parts.push({
            uuid: entry.uuid as string,
            type: 'tool_result',
            role,
            timestamp: entry.timestamp as string,
            toolName: b.tool_use_id as string,
            toolResult: text || b.content,
          })
        } else if (b.type === 'thinking') {
          parts.push({
            uuid: entry.uuid as string,
            type: 'thinking',
            role,
            timestamp: entry.timestamp as string,
            thinking: b.thinking as string,
          })
        }
      }
      if (parts.length === 1) return parts[0]
      if (parts.length > 1) return parts[0] // return first; others lost (acceptable for display)
    }
  }

  return { uuid: entry.uuid as string, type, timestamp: entry.timestamp as string }
}

// ── Hook receiver ─────────────────────────────────────────────────────────────

export function handleHook(req: Request, res: Response) {
  try {
    const payload = req.body as Record<string, unknown>
    const eventType = (payload.hook_event_name as string) ?? (payload.type as string) ?? 'claude_code.event'
    const sessionId = payload.session_id as string | undefined

    broadcastEvent({
      id: uuidv4(),
      type: `claude_code.${eventType.toLowerCase().replace(/\s+/g, '_')}`,
      payload: {
        sessionId,
        toolName: payload.tool_name,
        toolInput: payload.tool_input,
        stopReason: payload.stop_reason,
        raw: payload,
      },
      timestamp: new Date().toISOString(),
    })

    console.log(`[ClaudeCode hook] ${eventType} session=${sessionId ?? 'unknown'}`)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
}

// ── Hook configuration ────────────────────────────────────────────────────────

export function configureHooks(): { configured: boolean; path: string } {
  const settingsPath = path.join(HOME_CLAUDE, 'settings.local.json')
  let existing: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    try { existing = JSON.parse(readFileSync(settingsPath, 'utf8')) } catch { /* start fresh */ }
  }

  const hookCmd = `curl -s -X POST ${SERVER_URL}/api/claude-code/hook -H "Content-Type: application/json" -d @- > /dev/null 2>&1`

  const hooks = {
    PostToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: hookCmd }] }],
    Stop: [{ matcher: '.*', hooks: [{ type: 'command', command: hookCmd }] }],
  }

  const updated = { ...existing, hooks: { ...(existing.hooks as Record<string,unknown> ?? {}), ...hooks } }
  writeFileSync(settingsPath, JSON.stringify(updated, null, 2), 'utf8')
  console.log(`[ClaudeCode] Hooks configured at ${settingsPath}`)
  return { configured: true, path: settingsPath }
}
