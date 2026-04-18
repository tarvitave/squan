const fs = require('fs')

// Add import to index.ts
const f = 'server/src/index.ts'
let c = fs.readFileSync(f, 'utf8')

// Add import
if (!c.includes('claude-terminal')) {
  const lastImport = c.lastIndexOf("import ")
  const endOfLine = c.indexOf('\n', lastImport)
  c = c.slice(0, endOfLine + 1) +
    "import { startClaudeTerminal, getClaudeSession, killClaudeSession, writeToClaudeSession, resizeClaudeSession, killAllClaudeSessions } from './claude-terminal.js'\n" +
    c.slice(endOfLine + 1)
  console.log('Added claude-terminal import')
}

// Add routes before startWitness
const routes = `

  // ── Claude Code Terminal ────────────────────────────────────
  app.post('/api/claude-terminal', requireAuth, (req: any, res) => {
    try {
      const rigId = req.body?.rigId
      let cwd: string | undefined
      if (rigId) {
        const rig = db.prepare('SELECT local_path FROM rigs WHERE id = ?').get(rigId) as any
        if (rig) cwd = rig.local_path
      }
      const session = startClaudeTerminal(cwd)

      // Wire PTY output to WebSocket broadcast
      session.pty.onData((data: string) => {
        broadcastEvent({
          type: 'terminal-data',
          payload: { type: 'terminal-data', sessionId: session.id, data },
        } as any)
      })

      session.pty.onExit(({ exitCode }: any) => {
        broadcastEvent({
          type: 'terminal-exit',
          payload: { type: 'terminal-exit', sessionId: session.id, exitCode },
        } as any)
      })

      res.json({ sessionId: session.id, platform: session.platform, tmuxSession: session.tmuxSession })
    } catch (e: any) {
      console.error('[claude-terminal] Error:', e)
      res.status(500).json({ error: e.message })
    }
  })

  app.delete('/api/claude-terminal/:id', requireAuth, (req: any, res) => {
    killClaudeSession(req.params.id)
    res.json({ ok: true })
  })

  app.get('/api/claude-terminal/sessions', requireAuth, (_req: any, res) => {
    const { listClaudeSessions } = require('./claude-terminal.js')
    const sessions = listClaudeSessions()
    res.json(sessions.map((s: any) => ({ id: s.id, platform: s.platform, tmuxSession: s.tmuxSession, createdAt: s.createdAt })))
  })

`

if (!c.includes('/api/claude-terminal')) {
  const startWitnessIdx = c.indexOf('startWitness(')
  const insertPoint = c.lastIndexOf('\n\n', startWitnessIdx)
  c = c.slice(0, insertPoint) + routes + c.slice(insertPoint)
  console.log('Added claude-terminal routes')
}

fs.writeFileSync(f, c)

// Now update the WebSocket server to handle terminal-input messages
const wsf = 'server/src/ws/server.ts'
let ws = fs.readFileSync(wsf, 'utf8')

if (!ws.includes('terminal-input')) {
  // Find where messages are handled
  ws = ws.replace(
    "if (msg.type === 'subscribe'",
    `if (msg.type === 'terminal-input' && msg.sessionId && msg.data) {
          // Forward input to Claude PTY session
          try {
            const { writeToClaudeSession, resizeClaudeSession } = require('../claude-terminal.js')
            writeToClaudeSession(msg.sessionId, msg.data)
          } catch {}
        } else if (msg.type === 'terminal-resize' && msg.sessionId) {
          try {
            const { resizeClaudeSession } = require('../claude-terminal.js')
            resizeClaudeSession(msg.sessionId, msg.cols || 120, msg.rows || 40)
          } catch {}
        } else if (msg.type === 'subscribe'`
  )
  fs.writeFileSync(wsf, ws)
  console.log('Added terminal-input handler to WebSocket')
}

console.log('Done!')
