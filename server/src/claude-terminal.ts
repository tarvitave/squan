/**
 * Claude Code Terminal Manager
 * 
 * Manages PTY sessions for interactive Claude Code CLI.
 * - Windows: spawns claude.exe directly via node-pty
 * - macOS/Linux: uses tmux for persistent sessions
 */

import { spawn as ptySpawn } from 'node-pty'
import { execSync, spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { platform } from 'os'

interface ClaudeTerminalSession {
  id: string
  pty: any
  createdAt: Date
  platform: 'win32' | 'darwin' | 'linux'
  tmuxSession?: string
}

const sessions = new Map<string, ClaudeTerminalSession>()

// Detect platform
const IS_MAC = platform() === 'darwin'
const IS_WIN = platform() === 'win32'
const IS_LINUX = platform() === 'linux'

function hasTmux(): boolean {
  try {
    execSync('tmux -V', { stdio: 'pipe' })
    return true
  } catch { return false }
}

function hasClaudeCli(): boolean {
  try {
    if (IS_WIN) {
      execSync('where claude', { stdio: 'pipe' })
    } else {
      execSync('which claude', { stdio: 'pipe' })
    }
    return true
  } catch { return false }
}

/**
 * Start a new Claude Code terminal session
 */
export function startClaudeTerminal(cwd?: string): ClaudeTerminalSession {
  const id = `claude-${randomUUID().slice(0, 8)}`
  const workDir = cwd || process.env.HOME || process.env.USERPROFILE || '.'

  let pty: any

  if ((IS_MAC || IS_LINUX) && hasTmux()) {
    // macOS/Linux: Use tmux for persistent sessions
    const tmuxSessionName = `squan-claude-${id.slice(7)}`

    // Create tmux session running claude
    try {
      execSync(`tmux kill-session -t ${tmuxSessionName} 2>/dev/null || true`, { stdio: 'pipe' })
    } catch {}

    // Spawn a PTY that attaches to tmux
    // First create the tmux session with claude
    const claudeCmd = hasClaudeCli() ? 'claude' : 'echo "Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code" && bash'

    try {
      execSync(`tmux new-session -d -s ${tmuxSessionName} -x 120 -y 40 "${claudeCmd}"`, {
        cwd: workDir,
        stdio: 'pipe',
        env: { ...process.env },
      })
    } catch (e: any) {
      console.error('[claude-terminal] Failed to create tmux session:', e.message)
    }

    // Now spawn a PTY that attaches to that tmux session
    const shell = process.env.SHELL || '/bin/bash'
    pty = ptySpawn(shell, ['-c', `tmux attach -t ${tmuxSessionName}`], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: workDir,
      env: { ...process.env, TERM: 'xterm-256color' } as any,
    })

    const session: ClaudeTerminalSession = {
      id,
      pty,
      createdAt: new Date(),
      platform: IS_MAC ? 'darwin' : 'linux',
      tmuxSession: tmuxSessionName,
    }
    sessions.set(id, session)
    console.log(`[claude-terminal] Started tmux session: ${tmuxSessionName}`)
    return session

  } else {
    // Windows: Direct PTY spawn
    const claudeExists = hasClaudeCli()
    
    if (IS_WIN) {
      if (claudeExists) {
        pty = ptySpawn('claude.exe', [], {
          name: 'xterm-256color',
          cols: 120,
          rows: 40,
          cwd: workDir,
          env: { ...process.env } as any,
        })
      } else {
        // Fallback to PowerShell with a message
        pty = ptySpawn('powershell.exe', ['-NoExit', '-Command', 
          'Write-Host "Claude Code CLI not found." -ForegroundColor Yellow; Write-Host "Install with: npm install -g @anthropic-ai/claude-code" -ForegroundColor Cyan; Write-Host ""; Write-Host "You can use this terminal normally in the meantime." -ForegroundColor Gray'
        ], {
          name: 'xterm-256color',
          cols: 120,
          rows: 40,
          cwd: workDir,
          env: { ...process.env } as any,
        })
      }
    } else {
      // Linux without tmux
      const shell = process.env.SHELL || '/bin/bash'
      const args = claudeExists ? ['-c', 'claude'] : []
      pty = ptySpawn(shell, args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: workDir,
        env: { ...process.env, TERM: 'xterm-256color' } as any,
      })
    }

    const session: ClaudeTerminalSession = {
      id,
      pty,
      createdAt: new Date(),
      platform: IS_WIN ? 'win32' : 'linux',
    }
    sessions.set(id, session)
    console.log(`[claude-terminal] Started direct PTY session: ${id}`)
    return session
  }
}

/**
 * Get a session by ID
 */
export function getClaudeSession(id: string): ClaudeTerminalSession | undefined {
  return sessions.get(id)
}

/**
 * Kill a session
 */
export function killClaudeSession(id: string): void {
  const session = sessions.get(id)
  if (!session) return

  // Kill the PTY
  try { session.pty.kill() } catch {}

  // Kill tmux session if applicable
  if (session.tmuxSession) {
    try {
      execSync(`tmux kill-session -t ${session.tmuxSession} 2>/dev/null || true`, { stdio: 'pipe' })
    } catch {}
  }

  sessions.delete(id)
  console.log(`[claude-terminal] Killed session: ${id}`)
}

/**
 * Resize a session's PTY
 */
export function resizeClaudeSession(id: string, cols: number, rows: number): void {
  const session = sessions.get(id)
  if (session?.pty) {
    try { session.pty.resize(cols, rows) } catch {}
  }
}

/**
 * Write data to a session's PTY
 */
export function writeToClaudeSession(id: string, data: string): void {
  const session = sessions.get(id)
  if (session?.pty) {
    session.pty.write(data)
  }
}

/**
 * List all active sessions
 */
export function listClaudeSessions(): ClaudeTerminalSession[] {
  return Array.from(sessions.values())
}

/**
 * Kill all sessions (cleanup)
 */
export function killAllClaudeSessions(): void {
  for (const [id] of sessions) {
    killClaudeSession(id)
  }
}
