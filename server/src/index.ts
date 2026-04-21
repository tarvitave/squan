import 'dotenv/config'
import { execFileSync } from 'child_process'
import { resolve, join } from 'path'
import express from 'express'

// Prevent unhandled rejections from crashing the server (Node 15+ throws by default)
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection:', reason)
})
import { createServer } from 'http'
import { createHmac, timingSafeEqual, randomUUID } from 'crypto'
import { z } from 'zod'
import { setupWsServer } from './ws/server.js'
import { startWitness } from './witness/index.js'
import * as squanFs from './squan-fs/index.js'
// PTY completely disabled â€” agents use DirectRunner (direct API calls )
const ptyManager = {
  activeBackendName: 'disabled' as string,
  tmuxAvailable: false,
  setBackend: (_backend: string) => true,
  reconnectTmuxSessions: () => 0,
  list: () => [] as string[],
  write: (_id: string, _data: string) => {},
  onAnySessionExit: (_cb: (id: string) => void) => {},
}
import { workerBeeManager, charterManager, routingManager } from './workerbee/manager.js'
import { StructuredRunner, type AgentMessage } from './workerbee/structured-runner.js'
import { DirectRunner } from './workerbee/direct-runner.js'
import { processManager } from './workerbee/process-manager.js'
import { setupAgentSpawn, updateSessionId } from './workerbee/spawn-setup.js'
import { broadcastEvent, pushClaudeTerminalData, notifyClaudeSessionEnded } from './ws/server.js'

// Store runners by workerbee ID (DirectRunner or StructuredRunner)
const structuredRunners = new Map<string, DirectRunner | StructuredRunner>()

// Helper: spawn an agent in a separate child process 
async function spawnDirectAgent(projectId: string, taskDescription: string, userId: string): Promise<any> {
  const user = await getUserById(userId)
  const provider = (user as any).provider || 'anthropic'
  const apiKey = provider === 'openai' ? (user as any).openai_api_key : provider === 'google' ? (user as any).google_api_key : user?.anthropicApiKey
  if (!apiKey && provider !== 'ollama') throw new Error('No API key configured for ' + provider + '. Add one in Settings.')

  const setup = await setupAgentSpawn(projectId, taskDescription, userId)

  // Load MCP extensions for this project
  const extensionsRes = await getDb().execute({ sql: 'SELECT * FROM extensions WHERE (project_id = ? OR project_id IS NULL) AND enabled = 1', args: [projectId] })
  const extensions = extensionsRes.rows.map((r: any) => ({ name: r.name, type: r.type, command: r.command, args: JSON.parse(r.args_json || '[]'), url: r.url, env: JSON.parse(r.env_json || '{}'), enabled: true }))

  // Spawn in a separate process â€” full isolation, can be killed independently
  const agent = processManager.spawn({
    id: setup.id,
    name: setup.name,
    cwd: setup.worktreePath,
    task: taskDescription,
    apiKey: apiKey || '',
    provider: provider,
    providerUrl: (user as any).provider_url || undefined,
    model: (user as any).provider_model || undefined,
    extensions: extensions.length > 0 ? extensions : undefined,
  })

  // Forward IPC messages to WebSocket
  processManager.on('message', (agentId: string, msg: any) => {
    if (agentId !== setup.id) return
    broadcastEvent({
      id: randomUUID(), type: 'workerbee.working',
      payload: { workerBeeId: setup.id, workerbeeName: setup.name, agentMessage: msg },
      timestamp: new Date().toISOString(),
    })
  })
  processManager.on('status', async (agentId: string, status: string) => {
    if (agentId !== setup.id) return
    const newStatus = status === 'done' ? 'done' : status === 'error' ? 'zombie' : 'working'
    const agentState = processManager.get(setup.id)
    await workerBeeManager.updateStatus(setup.id, newStatus as any, agentState?.result ?? undefined).catch(() => {})
    broadcastEvent({
      id: randomUUID(),
      type: status === 'done' ? 'workerbee.done' : status === 'error' ? 'workerbee.zombie' : 'workerbee.working',
      payload: { workerBeeId: setup.id, id: setup.id, name: setup.name, result: agentState?.result, cost: agentState?.totalCost, note: agentState?.result },
      timestamp: new Date().toISOString(),
    })

    // Auto-move release train to PR Review when agent completes
    if (status === 'done') {
      try {
        const db = getDb()
        const rt = await db.execute({ sql: `SELECT id, status FROM release_trains WHERE assigned_workerbee_id = ?`, args: [setup.id] })
        if (rt.rows.length > 0 && rt.rows[0].status === 'in_progress') {
          const rtId = rt.rows[0].id as string
          await db.execute({ sql: `UPDATE release_trains SET status = 'pr_review' WHERE id = ?`, args: [rtId] })
          console.log(`[auto] Release train ${rtId} moved to pr_review (agent ${setup.name} completed)`)
          broadcastEvent({
            id: randomUUID(), type: 'releasetrain.pr_review',
            payload: { releaseTrainId: rtId },
            timestamp: new Date().toISOString(),
          })
        }
      } catch (err) {
        console.error('[auto] Failed to auto-advance release train:', err)
      }
    }
  })

  console.log(`[spawn] Agent ${setup.name} (PID ${agent.pid}) dispatched to ${setup.worktreePath}`)
  return await workerBeeManager.getById(setup.id)
}
import { mayorLeeManager } from './mayor/manager.js'
import { rigManager } from './rig/manager.js'
import { releaseTrainManager } from './releasetrain/manager.js'
import { townManager } from './town/manager.js'
import { hookManager } from './hooks/manager.js'
import { atomicTaskManager, beadManager } from './beads/manager.js'
import { templateManager } from './templates/manager.js'
import { snapshotManager, replayManager, startSnapshotScheduler } from './snapshots/manager.js'
import { handleMcpCall, handleMcpToolsList } from './mcp/server.js'
import { getDb, migrate, seedSystemTemplates } from './db/index.js'
import { register, login, getUserById, updateApiKey, requireAuth, updateGithubToken, updateClaudeTheme } from './auth/index.js'
import { skillManager } from './skills/index.js'
import { loadDemo, resetDemo, isDemoLoaded, DEMO_PROJECT } from './demo/seed.js'
import { parseGithubRepo, detectDefaultBranch, createPullRequest, getPullRequestStatus } from './github/index.js'
import { preconfigureClaudeAuth, restoreClaudeConfigOnStartup } from './claude-auth.js'
import { listSessions, parseSession, handleHook, configureHooks } from './claudecode/index.js'
import { getSchedulerManager } from './scheduler/index.js'
import { startClaudeTerminal, getClaudeSession, killClaudeSession, writeToClaudeSession, resizeClaudeSession, killAllClaudeSessions } from './claude-terminal.js'

const app = express()
app.use(express.json())

app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-GitHub-Event, X-Hub-Signature-256')
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  if (_req.method === 'OPTIONS') { res.sendStatus(204); return }
  next()
})

// â”€â”€ Embedded mode: serve client static files â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SQUAN_CLIENT_DIR = process.env.SQUAN_CLIENT_DIR
if (SQUAN_CLIENT_DIR) {
  const clientPath = resolve(SQUAN_CLIENT_DIR)
  console.log(`[server] Serving client from: ${clientPath}`)
  app.use(express.static(clientPath))
}

// Zod validation helper
function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  return schema.parse(data)
}

// --- Auth (public) ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, anthropicApiKey } = req.body
    if (!email || !password) { res.status(400).json({ error: 'Email and password required' }); return }
    res.json(await register(email, password, anthropicApiKey))
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message })
  }
})

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) { res.status(400).json({ error: 'Email and password required' }); return }
    res.json(await login(email, password))
  } catch (e: unknown) {
    res.status(401).json({ error: (e as Error).message })
  }
})

// Health â€” public
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() })
})

// â”€â”€ Terminal backend settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.get('/api/settings/terminal-backend', (_req, res) => {
  res.json({
    active: ptyManager.activeBackendName,
    tmuxAvailable: ptyManager.tmuxAvailable,
    backends: [
      { name: 'pty', label: 'node-pty', description: 'In-process terminals. Fast, works everywhere. Sessions lost on server restart.', available: true },
      { name: 'tmux', label: 'tmux', description: 'Crash-resilient. Agents survive server restarts. Requires tmux (macOS/Linux).', available: ptyManager.tmuxAvailable },
    ],
  })
})

app.put('/api/settings/terminal-backend', (req, res) => {
  const { backend } = req.body as { backend: 'pty' | 'tmux' }
  if (backend !== 'pty' && backend !== 'tmux') {
    return res.status(400).json({ error: 'Invalid backend. Use "pty" or "tmux".' })
  }
  const ok = ptyManager.setBackend(backend)
  if (!ok) {
    return res.status(400).json({ error: 'tmux is not available on this platform. Install tmux and restart.' })
  }
  res.json({ active: ptyManager.activeBackendName, tmuxAvailable: ptyManager.tmuxAvailable })
})

// â”€â”€ .squan/ Everything-as-Code endpoints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.post('/api/projects/:projectId/init-squan', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const project = await rigManager.getById(req.params.projectId)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    if (userId && project.userId && project.userId !== userId) return res.status(403).json({ error: 'Forbidden' })

    await squanFs.initAndSync(project.id, project.localPath, project.name)
    res.json({ ok: true, message: `.squan/ initialized at ${project.localPath}` })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.get('/api/projects/:projectId/squan-status', async (req, res) => {
  try {
    const project = await rigManager.getById(req.params.projectId)
    if (!project) return res.status(404).json({ error: 'Project not found' })

    const hasDir = squanFs.hasSquanDir(project.localPath)
    if (!hasDir) return res.json({ initialized: false })

    const state = squanFs.readSquanDir(project.localPath)
    res.json({
      initialized: true,
      config: state.config,
      counts: {
        tasks: state.tasks.length,
        charters: state.charters.length,
        templates: state.templates.length,
        docs: state.docs.length,
        security: state.security.length,
      },
      tasks_by_status: {
        open: state.tasks.filter((t) => t.meta.status === 'open').length,
        in_progress: state.tasks.filter((t) => t.meta.status === 'in_progress').length,
        pr_review: state.tasks.filter((t) => t.meta.status === 'pr_review').length,
        landed: state.tasks.filter((t) => t.meta.status === 'landed').length,
        cancelled: state.tasks.filter((t) => t.meta.status === 'cancelled').length,
      },
    })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.get('/api/projects/:projectId/squan/tasks', async (req, res) => {
  try {
    const project = await rigManager.getById(req.params.projectId)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    const tasks = squanFs.readBoard(project.localPath)
    res.json(tasks)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.post('/api/projects/:projectId/squan/tasks', async (req, res) => {
  try {
    const project = await rigManager.getById(req.params.projectId)
    if (!project) return res.status(404).json({ error: 'Project not found' })

    const { title, description, type, priority, tags } = req.body as {
      title: string; description?: string; type?: 'ai' | 'manual'; priority?: string; tags?: string[]
    }
    if (!title) return res.status(400).json({ error: 'title is required' })

    const meta = await squanFs.createTask(project.id, project.localPath, {
      title,
      description: description ?? '',
      type,
      priority: priority as 'low' | 'medium' | 'high' | 'critical' | undefined,
      tags,
    })
    res.json(meta)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.patch('/api/projects/:projectId/squan/tasks/:taskId/status', async (req, res) => {
  try {
    const project = await rigManager.getById(req.params.projectId)
    if (!project) return res.status(404).json({ error: 'Project not found' })

    const { status, currentStatus, title } = req.body as { status: string; currentStatus: string; title: string }
    await squanFs.updateTaskStatus(
      project.id, project.localPath,
      req.params.taskId,
      currentStatus as squanFs.TaskStatus,
      status as squanFs.TaskStatus,
      title,
    )
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.delete('/api/projects/:projectId/squan/tasks/:taskId', async (req, res) => {
  try {
    const project = await rigManager.getById(req.params.projectId)
    if (!project) return res.status(404).json({ error: 'Project not found' })

    const status = (req.query.status as string) ?? 'open'
    await squanFs.removeTask(project.id, project.localPath, req.params.taskId, status as squanFs.TaskStatus)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.get('/api/projects/:projectId/squan/charters', async (req, res) => {
  try {
    const project = await rigManager.getById(req.params.projectId)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    res.json(squanFs.readCharters(project.localPath))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.put('/api/projects/:projectId/squan/charters/:role', async (req, res) => {
  try {
    const project = await rigManager.getById(req.params.projectId)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    const { content } = req.body as { content: string }
    await squanFs.updateCharter(project.id, project.localPath, req.params.role, content)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.get('/api/projects/:projectId/squan/templates', async (req, res) => {
  try {
    const project = await rigManager.getById(req.params.projectId)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    res.json(squanFs.readTemplates(project.localPath))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.post('/api/projects/:projectId/squan/templates', async (req, res) => {
  try {
    const project = await rigManager.getById(req.params.projectId)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    const { name, content, type } = req.body as { name: string; content: string; type?: 'ai' | 'manual' }
    await squanFs.createTemplate(project.id, project.localPath, name, content, type)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.delete('/api/projects/:projectId/squan/templates/:name', async (req, res) => {
  try {
    const project = await rigManager.getById(req.params.projectId)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    await squanFs.removeTemplate(project.id, project.localPath, req.params.name)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.get('/api/projects/:projectId/squan/docs', async (req, res) => {
  try {
    const project = await rigManager.getById(req.params.projectId)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    res.json(squanFs.readDocs(project.localPath))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.get('/api/projects/:projectId/squan/security', async (req, res) => {
  try {
    const project = await rigManager.getById(req.params.projectId)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    res.json(squanFs.readSecurity(project.localPath))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

// â”€â”€ GitHub integration endpoints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.get('/api/github/repos', requireAuth, async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const user = await getUserById(userId)
    if (!user?.githubToken) {
      return res.status(400).json({ error: 'GitHub token not configured. Add it in Settings.' })
    }
    const page = parseInt(req.query.page as string) || 1
    const perPage = parseInt(req.query.per_page as string) || 30
    const sort = (req.query.sort as string) || 'updated'
    const search = (req.query.q as string) || ''

    let url = `https://api.github.com/user/repos?per_page=${perPage}&page=${page}&sort=${sort}&affiliation=owner,collaborator,organization_member`

    const ghRes = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${user.githubToken}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })

    if (!ghRes.ok) {
      const err = await ghRes.text()
      return res.status(ghRes.status).json({ error: `GitHub API: ${err.slice(0, 200)}` })
    }

    let repos = await ghRes.json() as Array<{ name: string; full_name: string; clone_url: string; ssh_url: string; html_url: string; description: string | null; private: boolean; language: string | null; updated_at: string; default_branch: string }>

    // Client-side search filter (GitHub API doesn't support filtering user repos by name)
    if (search) {
      const q = search.toLowerCase()
      repos = repos.filter((r) => r.full_name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q))
    }

    res.json(repos.map((r) => ({
      name: r.name,
      fullName: r.full_name,
      cloneUrl: r.clone_url,
      sshUrl: r.ssh_url,
      htmlUrl: r.html_url,
      description: r.description,
      private: r.private,
      language: r.language,
      updatedAt: r.updated_at,
      defaultBranch: r.default_branch,
    })))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.post('/api/github/repos', requireAuth, async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const user = await getUserById(userId)
    if (!user?.githubToken) {
      return res.status(400).json({ error: 'GitHub token not configured. Add it in Settings.' })
    }

    const { name, description, isPrivate } = req.body as { name: string; description?: string; isPrivate?: boolean }
    if (!name) return res.status(400).json({ error: 'Repository name is required' })

    const ghRes = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${user.githubToken}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        description: description || '',
        private: isPrivate ?? true,
        auto_init: true,
      }),
    })

    if (!ghRes.ok) {
      const err = await ghRes.json() as { message?: string }
      return res.status(ghRes.status).json({ error: err.message ?? 'Failed to create repository' })
    }

    const repo = await ghRes.json() as { name: string; full_name: string; clone_url: string; html_url: string; description: string | null; private: boolean; default_branch: string }

    res.json({
      name: repo.name,
      fullName: repo.full_name,
      cloneUrl: repo.clone_url,
      htmlUrl: repo.html_url,
      description: repo.description,
      private: repo.private,
      defaultBranch: repo.default_branch,
    })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

// MCP â€” public (Mayor Lee calls this server-side without a user token)
app.get('/api/mcp/tools', handleMcpToolsList)
app.post('/api/mcp', handleMcpCall)

// â”€â”€ Claude Code integration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.get('/api/claude-code/sessions', requireAuth, (_req, res) => {
  res.json(listSessions())
})

app.get('/api/claude-code/messages', requireAuth, (req, res) => {
  const { file, after } = req.query as { file?: string; after?: string }
  if (!file) { res.status(400).json({ error: 'file required' }); return }
  const afterLine = after ? parseInt(after, 10) : 0
  res.json(parseSession(file, afterLine))
})

app.post('/api/claude-code/hook', handleHook)

app.post('/api/claude-code/configure-hooks', requireAuth, (_req, res) => {
  try {
    res.json(configureHooks())
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// --- Auth middleware for all routes below ---
app.use('/api', requireAuth)

// --- Current user ---
app.get('/api/auth/me', async (_req, res) => {
  try {
    const user = await getUserById(res.locals.userId as string)
    res.json(user)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.put('/api/auth/api-key', async (req, res) => {
  const { anthropicApiKey } = req.body
  if (!anthropicApiKey) { res.status(400).json({ error: 'anthropicApiKey required' }); return }
  await updateApiKey(res.locals.userId as string, anthropicApiKey)
  res.json({ ok: true })
})

app.put('/api/auth/github-token', requireAuth, async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const { githubToken } = req.body
    if (!githubToken) { res.status(400).json({ error: 'githubToken required' }); return }
    await updateGithubToken(userId, githubToken)
    res.json({ ok: true })
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.put('/api/auth/claude-theme', requireAuth, async (req, res) => {
  try {
    const { theme } = req.body as { theme: string }
    if (!['dark', 'light'].includes(theme)) { res.status(400).json({ error: 'theme must be dark or light' }); return }
    await updateClaudeTheme(res.locals.userId as string, theme)
    res.json({ ok: true })
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

// --- Projects (formerly Rigs) ---
const ProjectSchema = z.object({
  name: z.string().min(1),
  localPath: z.string().min(1),
  repoUrl: z.string().default(''),
  townId: z.string().optional(),
})

// Towns
app.get('/api/towns', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    res.json(await townManager.list(userId))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.post('/api/towns', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const { name, path } = req.body
    if (!name || !path) return res.status(400).json({ error: 'name and path required' })
    res.json(await townManager.create(name, path, userId))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.get('/api/projects', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    res.json(await rigManager.listByTown('default', userId))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})
app.get('/api/rigs', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const townId = req.query.townId as string | undefined
    const all = req.query.all === 'true'
    if (all || !townId) {
      // Return ALL rigs for this user across all towns
      res.json(await rigManager.listAll(userId))
    } else {
      res.json(await rigManager.listByTown(townId, userId))
    }
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.post('/api/init-repo', requireAuth, async (req, res) => {
  try {
    const { path: repoPath } = req.body as { path: string }
    if (!repoPath) return res.status(400).json({ error: 'path required' })
    const { mkdirSync } = await import('fs')
    mkdirSync(repoPath, { recursive: true })
    execFileSync('git', ['init', repoPath], { stdio: 'pipe' })
    res.json({ ok: true, path: repoPath })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.get('/api/suggest-repos', requireAuth, async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const townId = (req.query.townId as string) ?? (await townManager.ensureDefault()).id
    const town = await townManager.getById(townId)
    const existingRigs = await rigManager.listByTown(townId, userId)

    const suggestions: Array<{ path: string; name: string; source: 'existing' | 'detected' }> = []

    // Existing projects in this workspace as "use same repo" options
    for (const rig of existingRigs) {
      suggestions.push({ path: rig.localPath, name: rig.name, source: 'existing' })
    }

    // Scan workspace path for git repos (depth 1 and 2)
    if (town?.path) {
      const { readdirSync, statSync, existsSync } = await import('fs')
      const scan = (dir: string, depth: number) => {
        if (depth > 2) return
        try {
          const entries = readdirSync(dir, { withFileTypes: true })
          for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) continue
            const full = `${dir}/${entry.name}`
            if (existsSync(`${full}/.git`)) {
              const already = suggestions.some((s) => s.path === full)
              if (!already) suggestions.push({ path: full, name: entry.name, source: 'detected' })
            } else {
              scan(full, depth + 1)
            }
          }
        } catch { /* ignore permission errors */ }
      }
      if (existsSync(town.path)) scan(town.path, 1)
    }

    res.json({ workspacePath: town?.path ?? '', suggestions })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.post('/api/projects', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const { name, repoUrl, localPath } = validate(ProjectSchema, req.body)
    res.json(await rigManager.add('default', name, repoUrl ?? '', localPath, userId))
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})
app.post('/api/rigs', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const { name, repoUrl, localPath, townId: bodyTownId } = validate(ProjectSchema, req.body)
    const townId = bodyTownId ?? (await townManager.ensureDefault()).id

    // If localPath doesn't exist and repoUrl is a git URL, clone it
    const { existsSync, mkdirSync } = await import('fs')
    if (!existsSync(localPath) && repoUrl && !repoUrl.startsWith('file://')) {
      console.log(`[rigs] Cloning ${repoUrl} â†’ ${localPath}`)
      mkdirSync(join(localPath, '..'), { recursive: true })
      try {
        execFileSync('git', ['clone', repoUrl, localPath], { stdio: 'pipe', timeout: 120_000 })
        console.log(`[rigs] Cloned successfully`)
      } catch (cloneErr) {
        return res.status(400).json({ error: `Failed to clone: ${(cloneErr as Error).message?.slice(0, 200)}` })
      }
    } else if (!existsSync(localPath)) {
      // Create directory + git init for new projects
      console.log(`[rigs] Creating new project at ${localPath}`)
      mkdirSync(localPath, { recursive: true })
      try {
        execFileSync('git', ['init', localPath], { stdio: 'pipe' })
      } catch { /* git init is optional */ }
    }

    res.json(await rigManager.add(townId, name, repoUrl ?? '', localPath, userId))
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.patch('/api/projects/:id/runtime', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    res.json(await rigManager.setRuntime(req.params.id, req.body, userId))
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})

app.patch('/api/projects/:id/repo-url', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const { repoUrl } = req.body as { repoUrl: string }
    await getDb().execute({
      sql: `UPDATE rigs SET repo_url = ? WHERE id = ? AND (user_id = ? OR user_id IS NULL)`,
      args: [repoUrl, req.params.id, userId],
    })
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

app.delete('/api/projects/:id', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    await rigManager.remove(req.params.id, userId)
    res.json({ ok: true })
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})

// --- WorkerBees ---
const SpawnSchema = z.object({ taskDescription: z.string().optional(), task: z.string().optional() })

app.get('/api/workerbees', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    res.json(await workerBeeManager.listAll(userId))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})
app.get('/api/polecats', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    res.json(await workerBeeManager.listAll(userId))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.get('/api/projects/:projectId/workerbees', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    res.json(await workerBeeManager.listByProject(req.params.projectId, userId))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.post('/api/projects/:projectId/workerbees', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const project = await rigManager.getById(req.params.projectId)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    if (project.userId && project.userId !== userId) return res.status(403).json({ error: 'Forbidden' })
    const { taskDescription, task } = validate(SpawnSchema, req.body)
    const taskText = (taskDescription ?? task) || 'No task specified'
    const bee = await spawnDirectAgent(req.params.projectId, taskText, userId)
    // Auto-create release train so agent appears on kanban board
    const rt = await releaseTrainManager.create(taskText.slice(0, 80), req.params.projectId, [], taskText, userId)
    await releaseTrainManager.assignWorkerBee(rt.id, bee.id)
    await releaseTrainManager.start(rt.id)
    broadcastEvent({ id: randomUUID(), type: 'releasetrain.created', payload: rt as any, timestamp: new Date().toISOString() })
    res.json({ ...bee, releaseTrainId: rt.id })
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})
app.post('/api/rigs/:rigId/polecats', async (req, res) => {  // backwards compat
  try {
    const userId = res.locals.userId as string
    const project = await rigManager.getById(req.params.rigId)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    if (project.userId && project.userId !== userId) return res.status(403).json({ error: 'Forbidden' })
    const { taskDescription, task } = validate(SpawnSchema, req.body)
    const taskText2 = (taskDescription ?? task) || 'No task specified'
    const bee = await spawnDirectAgent(req.params.rigId, taskText2, userId)
    // Auto-create release train so agent appears on kanban board
    const rt2 = await releaseTrainManager.create(taskText2.slice(0, 80), req.params.rigId, [], taskText2, userId)
    await releaseTrainManager.assignWorkerBee(rt2.id, bee.id)
    await releaseTrainManager.start(rt2.id)
    broadcastEvent({ id: randomUUID(), type: 'releasetrain.created', payload: rt2 as any, timestamp: new Date().toISOString() })
    res.json({ ...bee, releaseTrainId: rt2.id })
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

// Get messages for an agent (agent chat view)
app.get('/api/workerbees/:id/messages', requireAuth, async (req, res) => {
  const agent = processManager.get(req.params.id)
  if (agent) {
    return res.json({
      messages: agent.messages ?? [],
      status: agent.status ?? 'unknown',
      result: agent.result ?? null,
      totalCost: agent.totalCost ?? 0,
      durationMs: agent.durationMs ?? 0,
      inputTokens: agent.inputTokens ?? 0,
      outputTokens: agent.outputTokens ?? 0,
    })
  }
  // No active process â€” check DB for persisted messages
  try {
    const rows = await getDb().execute({ sql: `SELECT message_json FROM workerbee_messages WHERE workerbee_id = ? ORDER BY id ASC`, args: [req.params.id] })
    const messages = rows.rows.map((r: any) => JSON.parse(r.message_json as string))
    // Get workerbee status from DB
    const bee = await getDb().execute({ sql: `SELECT status FROM workerbees WHERE id = ?`, args: [req.params.id] })
    const dbStatus = bee.rows.length > 0 ? (bee.rows[0].status as string) : 'unknown'
    res.json({
      messages,
      status: messages.length > 0 ? (dbStatus === 'done' ? 'done' : 'no_runner') : 'no_runner',
      result: null,
      totalCost: 0,
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
    })
  } catch {
    res.json({ messages: [], status: 'no_runner' })
  }
})

// Spawn agent with structured runner (Option B - agent chat)
// Spawn agent with direct API calls (agent chat) â€” no CLI needed
app.post('/api/projects/:projectId/workerbees/structured', requireAuth, async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const { taskDescription } = req.body
    if (!taskDescription) return res.status(400).json({ error: 'taskDescription required' })
    const bee = await spawnDirectAgent(req.params.projectId, taskDescription, userId)
    res.json({ ...bee, mode: 'direct' })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

app.post('/api/workerbees/:id/message', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    await workerBeeManager.sendMessage(req.params.id, req.body.message, userId)
    res.json({ ok: true })
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})

// Follow-up: resume conversation with a completed agent
app.post('/api/workerbees/:id/followup', requireAuth, async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const { message } = req.body
    if (!message) return res.status(400).json({ error: 'message required' })

    const bee = await workerBeeManager.getById(req.params.id)
    if (!bee) return res.status(404).json({ error: 'Agent not found' })
    if (bee.userId && bee.userId !== userId) return res.status(403).json({ error: 'Forbidden' })

    const user = await getUserById(userId)
    if (!user?.anthropicApiKey) return res.status(400).json({ error: 'No Anthropic API key' })

    // Check if there's still an active process
    let agent = processManager.get(req.params.id)
    if (agent && (agent.status === 'done' || agent.status === 'error')) {
      // Agent process exists but finished — inject user message and resume the loop
      const userMsg = { type: 'user', text: message }
      agent.messages.push(userMsg)
      getDb().execute({
        sql: `INSERT INTO workerbee_messages (workerbee_id, message_json) VALUES (?, ?)`,
        args: [req.params.id, JSON.stringify(userMsg)],
      }).catch(() => {})
      broadcastEvent({
        id: randomUUID(), type: 'workerbee.working',
        payload: { workerBeeId: req.params.id },
        timestamp: new Date().toISOString(),
      })

      // Send follow-up to the child process via IPC
      if (agent.process && agent.process.connected) {
        agent.status = 'working'
        agent.result = null
        agent.process.send({ type: 'followup', message })
        await workerBeeManager.updateStatus(req.params.id, 'working' as any)
        return res.json({ ok: true, resumed: true })
      }
    }

    // No active process — spawn a fresh one with conversation context
    const existingMessages = await getDb().execute({
      sql: `SELECT message_json FROM workerbee_messages WHERE workerbee_id = ? ORDER BY id ASC`,
      args: [req.params.id],
    })
    const history = existingMessages.rows.map((r: any) => JSON.parse(r.message_json as string))

    // Record the user follow-up message
    const userMsg = { type: 'user', text: message }
    await getDb().execute({
      sql: `INSERT INTO workerbee_messages (workerbee_id, message_json) VALUES (?, ?)`,
      args: [req.params.id, JSON.stringify(userMsg)],
    })

    // Spawn a new process for the follow-up
    const newAgent = processManager.spawn({
      id: req.params.id,
      name: bee.name,
      cwd: bee.worktreePath,
      task: message,
      apiKey: user.anthropicApiKey,
    })

    // Restore message history into the new process
    newAgent.messages = [...history, userMsg]

    await workerBeeManager.updateStatus(req.params.id, 'working' as any)

    // Wire up the same event handlers as spawnDirectAgent
    processManager.on('status', async (agentId: string, status: string) => {
      if (agentId !== req.params.id) return
      const newStatus = status === 'done' ? 'done' : status === 'error' ? 'zombie' : 'working'
      const agentState = processManager.get(req.params.id)
      await workerBeeManager.updateStatus(req.params.id, newStatus as any, agentState?.result ?? undefined).catch(() => {})
      broadcastEvent({
        id: randomUUID(),
        type: status === 'done' ? 'workerbee.done' : status === 'error' ? 'workerbee.zombie' : 'workerbee.working',
        payload: { workerBeeId: req.params.id, id: req.params.id, name: bee.name, result: agentState?.result, note: agentState?.result },
        timestamp: new Date().toISOString(),
      })
    })

    res.json({ ok: true, resumed: false, spawned: true })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

app.post('/api/workerbees/:id/done', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const bee = await workerBeeManager.getById(req.params.id)
    if (!bee) return res.status(404).json({ error: 'Agent not found' })
    if (bee.userId && bee.userId !== userId) return res.status(403).json({ error: 'Forbidden' })
    await workerBeeManager.updateStatus(req.params.id, 'done')
    res.json({ ok: true })
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

// Mark agent complete and advance the kanban: in_progress ? pr_review (not straight to landed)
app.post('/api/workerbees/:id/mark-complete', requireAuth, async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const bee = await workerBeeManager.getById(req.params.id)
    if (!bee) return res.status(404).json({ error: 'Agent not found' })
    if (bee.userId && bee.userId !== userId) return res.status(403).json({ error: 'Forbidden' })

    // Kill the child process if still alive
    processManager.kill(req.params.id)

    // Mark agent as done in DB (without the auto-land side-effect)
    const db = getDb()
    await db.execute({
      sql: `UPDATE workerbees SET status = 'done', completion_note = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [req.body?.note ?? 'Manually marked complete', req.params.id],
    })

    broadcastEvent({
      id: randomUUID(), type: 'workerbee.done',
      payload: { workerBeeId: req.params.id, id: req.params.id, name: bee.name, note: req.body?.note ?? 'Manually marked complete' },
      timestamp: new Date().toISOString(),
    })

    // Advance the assigned release train to pr_review (not landed)
    const rtResult = await db.execute({
      sql: `SELECT id, status FROM release_trains WHERE assigned_workerbee_id = ? AND status = 'in_progress'`,
      args: [req.params.id],
    })
    const advancedRts: string[] = []
    for (const row of rtResult.rows) {
      const rtId = row.id as string
      await db.execute({
        sql: `UPDATE release_trains SET status = 'pr_review', updated_at = datetime('now') WHERE id = ?`,
        args: [rtId],
      })
      advancedRts.push(rtId)
      broadcastEvent({
        id: randomUUID(), type: 'releasetrain.pr_review',
        payload: { releaseTrainId: rtId },
        timestamp: new Date().toISOString(),
      })
      console.log(`[mark-complete] Release train ${rtId} advanced to pr_review`)
    }

    res.json({ ok: true, advancedReleaseTrains: advancedRts })
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.delete('/api/workerbees/:id', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    console.log(`[DELETE] workerbee ${req.params.id} by user ${userId}`)
    // Kill the child process if running
    processManager.kill(req.params.id)
    await workerBeeManager.nuke(req.params.id, userId)
    console.log(`[DELETE] workerbee ${req.params.id} OK`)
    res.json({ ok: true })
  } catch (err) {
    const msg = (err as Error).message
    console.error(`[DELETE] workerbee ${req.params.id} FAILED: ${msg}`)
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})

// Kill agent process without deleting the record
app.post('/api/workerbees/:id/kill', requireAuth, async (req, res) => {
  const killed = processManager.kill(req.params.id)
  if (killed) {
    await workerBeeManager.updateStatus(req.params.id, 'zombie' as any, 'Killed by user').catch(() => {})
  }
  res.json({ ok: true, killed })
})

app.post('/api/workerbees/:id/restart', requireAuth, async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const bee = await workerBeeManager.getById(req.params.id)
    if (!bee) { res.status(404).json({ error: 'Agent not found' }); return }

    const { projectId, taskDescription } = bee

    // Find any release train assigned to this bee
    const db = getDb()
    const rtRow = await db.execute({
      sql: `SELECT id FROM release_trains WHERE assigned_workerbee_id = ? LIMIT 1`,
      args: [bee.id],
    })
    const releaseTrainId = rtRow.rows[0]?.id as string | undefined

    // Kill the old agent
    await workerBeeManager.nuke(bee.id, userId)

    // Spawn a new one using DirectRunner (no CLI)
    const newBee = await spawnDirectAgent(projectId, taskDescription, userId)

    // Re-assign to the release train if there was one
    if (releaseTrainId) {
      await releaseTrainManager.assignWorkerBee(releaseTrainId, newBee.id)
    }

    res.json({ bee: newBee, releaseTrainId })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

async function notifyRootAgentOfCommit(bee: Awaited<ReturnType<typeof workerBeeManager.getById>>, message: string) {
  if (!bee) return
  const db = getDb()
  const rigRow = await db.execute({ sql: `SELECT town_id FROM rigs WHERE id = ?`, args: [bee.projectId] })
  const townId = (rigRow.rows[0] as unknown as { town_id: string } | undefined)?.town_id
  if (!townId) return
  const mayorRow = await db.execute({
    sql: `SELECT session_id FROM mayors WHERE town_id = ? AND session_id IS NOT NULL`,
    args: [townId],
  })
  const sessionId = (mayorRow.rows[0] as unknown as { session_id: string } | undefined)?.session_id
  if (!sessionId || !ptyManager.list().includes(sessionId)) return
  const msg = `\n[Squansq] Agent ${bee.name} committed: "${message.slice(0, 100)}". Use get_status_summary to track progress. ðŸ“\n`
  ptyManager.write(sessionId, msg)
}

// Git post-commit hook fires this â€” no auth required (called from agent's shell)
app.post('/api/workerbees/:id/commit', async (req, res) => {
  try {
    const bee = await workerBeeManager.getById(req.params.id)
    if (!bee) { res.status(404).json({ error: 'Not found' }); return }
    const { branch, message } = req.body as { branch?: string; message?: string }
    console.log(`[Commit hook] ${bee.name} committed on ${branch}: ${message}`)

    // Notify the Root Agent so it stays updated without polling
    await notifyRootAgentOfCommit(bee, message ?? '')
    res.json({ ok: true })
  } catch {
    res.status(400).json({ error: 'failed' })
  }
})

app.patch('/api/workerbees/:id/status', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const bee = await workerBeeManager.getById(req.params.id)
    if (!bee) return res.status(404).json({ error: 'Agent not found' })
    if (bee.userId && bee.userId !== userId) return res.status(403).json({ error: 'Forbidden' })
    await workerBeeManager.updateStatus(req.params.id, req.body.status)
    res.json({ ok: true })
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

// Snapshot endpoints
app.post('/api/workerbees/:id/snapshot', async (req, res) => {
  const userId = res.locals.userId as string
  const bee = await workerBeeManager.getById(req.params.id)
  if (!bee) return res.status(404).json({ error: 'Agent not found' })
  if (bee.userId && bee.userId !== userId) return res.status(403).json({ error: 'Forbidden' })
  if (!bee?.sessionId) return res.status(400).json({ error: 'No active session' })
  res.json(await snapshotManager.capture(bee.id, bee.sessionId))
})

app.get('/api/workerbees/:id/snapshots', async (req, res) => {
  const userId = res.locals.userId as string
  const bee = await workerBeeManager.getById(req.params.id)
  if (!bee) return res.status(404).json({ error: 'Agent not found' })
  if (bee.userId && bee.userId !== userId) return res.status(403).json({ error: 'Forbidden' })
  res.json(await snapshotManager.listByWorkerBee(req.params.id))
})

app.get('/api/snapshots/:id/content', async (req, res) => {
  const content = await snapshotManager.getContent(req.params.id)
  if (content === null) return res.status(404).json({ error: 'Snapshot not found' })
  res.json({ content })
})

// Replay frames
app.get('/api/workerbees/:id/replay', async (req, res) => {
  const userId = res.locals.userId as string
  const bee = await workerBeeManager.getById(req.params.id)
  if (!bee) return res.status(404).json({ error: 'Agent not found' })
  if (bee.userId && bee.userId !== userId) return res.status(403).json({ error: 'Forbidden' })
  res.json(await replayManager.listFrames(req.params.id))
})

app.get('/api/replay/:frameId/content', async (req, res) => {
  const content = await replayManager.getFrameContent(req.params.frameId)
  if (content === null) return res.status(404).json({ error: 'Frame not found' })
  res.json({ content })
})

// --- Mayor Lee ---
app.post('/api/mayor-lee/start', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const user = await getUserById(userId)
    res.json(await mayorLeeManager.start(req.body.townId ?? 'default', user?.anthropicApiKey ?? undefined, userId))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})
app.post('/api/mayor/start', async (req, res) => {  // backwards compat
  try {
    const userId = res.locals.userId as string
    const user = await getUserById(userId)
    res.json(await mayorLeeManager.start(req.body.townId ?? 'default', user?.anthropicApiKey ?? undefined, userId))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})
app.post('/api/mayor-lee/stop', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    await mayorLeeManager.stop(req.body.townId ?? 'default', userId)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})
app.post('/api/mayor/stop', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    await mayorLeeManager.stop(req.body.townId ?? 'default', userId)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.post('/api/mayor-lee/message', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    await mayorLeeManager.sendMessage(req.body.townId ?? 'default', req.body.message, userId)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})
app.post('/api/mayor/message', async (req, res) => {  // backwards compat
  try {
    const userId = res.locals.userId as string
    await mayorLeeManager.sendMessage(req.body.townId ?? 'default', req.body.message, userId)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.get('/api/mayor-lee', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const townId = (req.query.townId as string) || 'default'
    res.json(await mayorLeeManager.get(townId, userId))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})
app.get('/api/mayor', async (req, res) => {  // backwards compat
  try {
    const userId = res.locals.userId as string
    const townId = (req.query.townId as string) || 'default'
    res.json(await mayorLeeManager.get(townId, userId))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

// --- Release Trains (formerly Convoys) ---
const ReleaseTrainSchema = z.object({
  name: z.string().min(1),
  projectId: z.string().optional(),
  rigId: z.string().optional(),
  atomicTaskIds: z.array(z.string()).optional(),
  beadIds: z.array(z.string()).optional(),  // backward compat
  description: z.string().optional(),
  manual: z.boolean().optional(),
}).refine((d) => d.projectId || d.rigId, { message: 'projectId or rigId required' })

app.get('/api/release-trains', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    res.json(await releaseTrainManager.listAll(userId))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})
app.get('/api/convoys', async (req, res) => {  // backward compat
  try {
    const userId = res.locals.userId as string
    res.json(await releaseTrainManager.listAll(userId))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.post('/api/release-trains', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const { name, projectId, rigId, atomicTaskIds, beadIds, description, manual } = validate(ReleaseTrainSchema, req.body)
    res.json(await releaseTrainManager.create(name, (projectId ?? rigId)!, atomicTaskIds ?? beadIds, description, userId, manual))
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})
app.post('/api/convoys', async (req, res) => {  // backward compat
  try {
    const userId = res.locals.userId as string
    const { name, projectId, rigId, atomicTaskIds, beadIds, description, manual } = validate(ReleaseTrainSchema, req.body)
    res.json(await releaseTrainManager.create(name, (projectId ?? rigId)!, atomicTaskIds ?? beadIds, description, userId, manual))
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.post('/api/release-trains/:id/atomictasks', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    res.json(await releaseTrainManager.addAtomicTasks(req.params.id, req.body.atomicTaskIds, userId))
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})
app.post('/api/convoys/:id/atomictasks', async (req, res) => {  // backward compat
  try {
    const userId = res.locals.userId as string
    res.json(await releaseTrainManager.addAtomicTasks(req.params.id, req.body.atomicTaskIds, userId))
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})
app.post('/api/release-trains/:id/beads', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    res.json(await releaseTrainManager.addAtomicTasks(req.params.id, req.body.beadIds ?? req.body.atomicTaskIds, userId))
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})
app.post('/api/convoys/:id/beads', async (req, res) => {  // backward compat
  try {
    const userId = res.locals.userId as string
    res.json(await releaseTrainManager.addAtomicTasks(req.params.id, req.body.beadIds ?? req.body.atomicTaskIds, userId))
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})

app.delete('/api/release-trains/:id/atomictasks', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    res.json(await releaseTrainManager.removeAtomicTasks(req.params.id, req.body.atomicTaskIds, userId))
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})
app.delete('/api/convoys/:id/atomictasks', async (req, res) => {  // backward compat
  try {
    const userId = res.locals.userId as string
    res.json(await releaseTrainManager.removeAtomicTasks(req.params.id, req.body.atomicTaskIds, userId))
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})
app.delete('/api/release-trains/:id/beads', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    res.json(await releaseTrainManager.removeAtomicTasks(req.params.id, req.body.beadIds ?? req.body.atomicTaskIds, userId))
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})
app.delete('/api/convoys/:id/beads', async (req, res) => {  // backward compat
  try {
    const userId = res.locals.userId as string
    res.json(await releaseTrainManager.removeAtomicTasks(req.params.id, req.body.beadIds ?? req.body.atomicTaskIds, userId))
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})

app.post('/api/release-trains/:id/start', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    await releaseTrainManager.start(req.params.id, userId)
    res.json({ ok: true })
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})

app.post('/api/release-trains/:id/land', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    await releaseTrainManager.land(req.params.id, userId)
    res.json({ ok: true })
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})
app.post('/api/convoys/:id/land', async (req, res) => {  // backward compat
  try {
    const userId = res.locals.userId as string
    await releaseTrainManager.land(req.params.id, userId)
    res.json({ ok: true })
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})

app.post('/api/release-trains/:id/cancel', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const rt = await releaseTrainManager.getById(req.params.id)
    if (rt?.assignedWorkerBeeId) {
      await workerBeeManager.nuke(rt.assignedWorkerBeeId, userId).catch(() => {})
    }
    await releaseTrainManager.cancel(req.params.id, userId)
    res.json({ ok: true })
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})
app.post('/api/convoys/:id/cancel', async (req, res) => {  // backward compat
  try {
    const userId = res.locals.userId as string
    await releaseTrainManager.cancel(req.params.id, userId)
    res.json({ ok: true })
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})

app.post('/api/release-trains/:id/assign', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const releaseTrain = await releaseTrainManager.assignWorkerBee(req.params.id, req.body.workerBeeId ?? null, userId)
    res.json(releaseTrain)
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})
app.post('/api/convoys/:id/assign', async (req, res) => {  // backward compat
  try {
    const userId = res.locals.userId as string
    const releaseTrain = await releaseTrainManager.assignWorkerBee(req.params.id, req.body.workerBeeId ?? null, userId)
    res.json(releaseTrain)
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})

app.post('/api/release-trains/:id/dispatch', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const mode = (req.body?.mode as string) || 'structured'
    const releaseTrain = await releaseTrainManager.getById(req.params.id)
    if (!releaseTrain) return res.status(404).json({ error: 'ReleaseTrain not found' })
    if (releaseTrain.userId && releaseTrain.userId !== userId) return res.status(403).json({ error: 'Forbidden' })
    const taskDescription = releaseTrain.description || releaseTrain.name

    {
      // Direct API mode â€” calls Anthropic API directly like Squan
      // No Claude Code CLI, no OAuth, no terminal
      const bee = await spawnDirectAgent(releaseTrain.projectId, taskDescription, userId)
      await releaseTrainManager.assignWorkerBee(releaseTrain.id, bee.id, userId)
      res.json({ bee, releaseTrain: await releaseTrainManager.getById(releaseTrain.id), mode: 'direct' })
    }
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})
// backward compat
app.post('/api/convoys/:id/dispatch', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const releaseTrain = await releaseTrainManager.getById(req.params.id)
    if (!releaseTrain) return res.status(404).json({ error: 'ReleaseTrain not found' })
    if (releaseTrain.userId && releaseTrain.userId !== userId) return res.status(403).json({ error: 'Forbidden' })
    const taskDescription = releaseTrain.description || releaseTrain.name
    const bee = await spawnDirectAgent(releaseTrain.projectId, taskDescription, userId)
    await releaseTrainManager.assignWorkerBee(releaseTrain.id, bee.id, userId)
    res.json({ bee, convoy: await releaseTrainManager.getById(releaseTrain.id), mode: 'direct' })
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.post('/api/release-trains/:id/create-pr', requireAuth, async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const rt = await releaseTrainManager.getById(req.params.id)
    if (!rt) { res.status(404).json({ error: 'Not found' }); return }

    const user = await getUserById(userId)
    const githubToken = user?.githubToken
    if (!githubToken) { res.status(400).json({ error: 'GitHub token not configured â€” add it in account settings' }); return }

    const project = await rigManager.getById(rt.projectId)
    if (!project) { res.status(400).json({ error: 'Project not found' }); return }

    if (!project.repoUrl) { res.status(400).json({ error: 'No GitHub repo URL set for this project â€” edit the project in the sidebar to add one' }); return }
    const parsed = parseGithubRepo(project.repoUrl)
    if (!parsed) { res.status(400).json({ error: 'Could not parse GitHub repo from URL: ' + project.repoUrl + ' â€” expected format: https://github.com/owner/repo' }); return }

    const bee = rt.assignedWorkerBeeId
      ? (await workerBeeManager.getById(rt.assignedWorkerBeeId))
      : null
    const head = bee?.branch ?? req.body.branch
    if (!head) { res.status(400).json({ error: 'No branch found â€” Agent must be assigned' }); return }

    const base = detectDefaultBranch(project.localPath)
    const title = rt.name
    const body = rt.description || `Created by Squansq Agent`

    // Verify branch exists locally before trying to push
    const { execFileSync } = await import('child_process')
    try {
      execFileSync('git', ['-C', project.localPath, 'rev-parse', '--verify', head], { stdio: 'pipe' })
    } catch {
      throw new Error(`Branch '${head}' does not exist locally â€” the agent may not have committed any work yet`)
    }

    // Push the branch to origin â€” always push from the main repo root (worktree may be gone)
    try {
      execFileSync('git', ['-C', project.localPath, 'push', '--set-upstream', 'origin', head], { stdio: 'pipe' })
    } catch (pushErr) {
      const msg = (pushErr as { stderr?: Buffer }).stderr?.toString() ?? ''
      if (!msg.includes('Everything up-to-date') && !msg.includes('up-to-date')) {
        throw new Error(`Failed to push branch '${head}': ${msg || (pushErr as Error).message}`)
      }
    }

    const { url, number } = await createPullRequest(githubToken, parsed.owner, parsed.repo, head, base, title, body)
    const updated = await releaseTrainManager.moveToPrReview(rt.id, url, number, userId)
    res.json(updated)
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.post('/api/release-trains/:id/sync-pr', requireAuth, async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const rt = await releaseTrainManager.getById(req.params.id)
    if (!rt?.prNumber) { res.status(400).json({ error: 'No PR linked' }); return }

    const user = await getUserById(userId)
    const githubToken = user?.githubToken
    if (!githubToken) { res.status(400).json({ error: 'GitHub token not configured' }); return }

    const project = await rigManager.getById(rt.projectId)
    const parsed = project ? parseGithubRepo(project.repoUrl) : null
    if (!parsed) { res.status(400).json({ error: 'Cannot determine GitHub repo' }); return }

    const { state, merged } = await getPullRequestStatus(githubToken, parsed.owner, parsed.repo, rt.prNumber)
    if (merged) {
      await releaseTrainManager.land(rt.id, userId)
      res.json({ state, merged, landed: true })
    } else {
      res.json({ state, merged, landed: false })
    }
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.delete('/api/release-trains/:id', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    await releaseTrainManager.delete(req.params.id, userId)
    res.json({ ok: true })
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})

app.patch('/api/release-trains/:id/description', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    res.json(await releaseTrainManager.updateDescription(req.params.id, req.body.description, userId))
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})
app.patch('/api/convoys/:id/description', async (req, res) => {  // backward compat
  try {
    const userId = res.locals.userId as string
    res.json(await releaseTrainManager.updateDescription(req.params.id, req.body.description, userId))
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})

// --- Hooks ---
const HookSchema = z.object({
  projectId: z.string().min(1),
  branch: z.string().min(1),
  notes: z.string().optional(),
  workerBeeId: z.string().optional(),
  atomicTaskId: z.string().optional(),
  beadId: z.string().optional(),  // backward compat
})

app.get('/api/hooks', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const { projectId } = req.query
    res.json(projectId ? await hookManager.listByProject(projectId as string, userId) : await hookManager.listAll(userId))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.post('/api/hooks', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const { projectId, branch, notes, workerBeeId, atomicTaskId, beadId } = validate(HookSchema, req.body)
    res.json(await hookManager.create(projectId, branch, notes, workerBeeId, atomicTaskId ?? beadId, userId))
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.post('/api/hooks/:id/activate', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    await hookManager.activate(req.params.id, userId)
    res.json({ ok: true })
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})
app.post('/api/hooks/:id/complete', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    await hookManager.complete(req.params.id, userId)
    res.json({ ok: true })
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})
app.post('/api/hooks/:id/suspend', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    await hookManager.suspend(req.params.id, userId)
    res.json({ ok: true })
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})
app.post('/api/hooks/:id/archive', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    await hookManager.archive(req.params.id, userId)
    res.json({ ok: true })
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})
app.delete('/api/hooks/:id', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    await hookManager.remove(req.params.id, userId)
    res.json({ ok: true })
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})

// --- AtomicTasks (formerly Beads) ---
const AtomicTaskSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  releaseTrainId: z.string().optional(),
  convoyId: z.string().optional(),  // backward compat
  dependsOn: z.array(z.string()).optional(),
})

app.get('/api/atomictasks', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const { projectId, releaseTrainId, convoyId } = req.query
    const rtId = (releaseTrainId ?? convoyId) as string | undefined
    if (rtId) return res.json(await atomicTaskManager.listByConvoy(rtId, userId))
    if (projectId) return res.json(await atomicTaskManager.listByProject(projectId as string, userId))
    res.json(await atomicTaskManager.listAll(userId))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})
app.get('/api/beads', async (req, res) => {  // backward compat
  try {
    const userId = res.locals.userId as string
    const { projectId, releaseTrainId, convoyId } = req.query
    const rtId = (releaseTrainId ?? convoyId) as string | undefined
    if (rtId) return res.json(await atomicTaskManager.listByConvoy(rtId, userId))
    if (projectId) return res.json(await atomicTaskManager.listByProject(projectId as string, userId))
    res.json(await atomicTaskManager.listAll(userId))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.post('/api/atomictasks', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const { projectId, title, description, releaseTrainId, convoyId, dependsOn } = validate(AtomicTaskSchema, req.body)
    res.json(await atomicTaskManager.create(projectId, title, description, releaseTrainId ?? convoyId, dependsOn, userId))
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})
app.post('/api/beads', async (req, res) => {  // backward compat
  try {
    const userId = res.locals.userId as string
    const { projectId, title, description, releaseTrainId, convoyId, dependsOn } = validate(AtomicTaskSchema, req.body)
    res.json(await atomicTaskManager.create(projectId, title, description, releaseTrainId ?? convoyId, dependsOn, userId))
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.get('/api/atomictasks/:id/dependencies', async (req, res) => {
  res.json(await atomicTaskManager.areDependenciesMet(req.params.id))
})
app.get('/api/beads/:id/dependencies', async (req, res) => {  // backward compat
  res.json(await atomicTaskManager.areDependenciesMet(req.params.id))
})

app.post('/api/atomictasks/:id/dependencies', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    res.json(await atomicTaskManager.setDependencies(req.params.id, req.body.dependsOn, userId))
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})
app.post('/api/beads/:id/dependencies', async (req, res) => {  // backward compat
  try {
    const userId = res.locals.userId as string
    res.json(await atomicTaskManager.setDependencies(req.params.id, req.body.dependsOn, userId))
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})

app.post('/api/atomictasks/:id/assign', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    res.json(await atomicTaskManager.assign(req.params.id, req.body.workerBeeId, userId))
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})
app.post('/api/beads/:id/assign', async (req, res) => {  // backward compat
  try {
    const userId = res.locals.userId as string
    res.json(await atomicTaskManager.assign(req.params.id, req.body.workerBeeId, userId))
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})

app.post('/api/atomictasks/:id/status', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    res.json(await atomicTaskManager.setStatus(req.params.id, req.body.status, userId))
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})
app.post('/api/beads/:id/status', async (req, res) => {  // backward compat
  try {
    const userId = res.locals.userId as string
    res.json(await atomicTaskManager.setStatus(req.params.id, req.body.status, userId))
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})
app.patch('/api/atomictasks/:id/status', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    res.json(await atomicTaskManager.setStatus(req.params.id, req.body.status, userId))
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})
app.patch('/api/beads/:id/status', async (req, res) => {  // backward compat
  try {
    const userId = res.locals.userId as string
    res.json(await atomicTaskManager.setStatus(req.params.id, req.body.status, userId))
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})

app.delete('/api/atomictasks/:id', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    await atomicTaskManager.remove(req.params.id, userId)
    res.json({ ok: true })
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})
app.delete('/api/beads/:id', async (req, res) => {  // backward compat
  try {
    const userId = res.locals.userId as string
    await atomicTaskManager.remove(req.params.id, userId)
    res.json({ ok: true })
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})

// --- Templates ---
const TemplateSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  content: z.string().min(1),
})

app.get('/api/templates', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const { projectId } = req.query
    res.json(projectId ? await templateManager.listByProject(projectId as string, userId) : await templateManager.listAll(userId))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.post('/api/templates', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const { projectId, name, content } = validate(TemplateSchema, req.body)
    res.json(await templateManager.create(projectId, name, content, userId))
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.put('/api/templates/:id', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    res.json(await templateManager.update(req.params.id, req.body, userId))
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})

app.delete('/api/templates/:id', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    await templateManager.remove(req.params.id, userId)
    res.json({ ok: true })
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})

// --- Events (persisted) ---
app.get('/api/events', async (req, res) => {
  const db = getDb()
  const { type, limit = '100', since, offset = '0' } = req.query
  let sql = 'SELECT * FROM events'
  const args: (string | number)[] = []
  const conditions: string[] = []
  if (type) { conditions.push('type = ?'); args.push(type as string) }
  if (since) { conditions.push('timestamp > ?'); args.push(since as string) }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ')
  sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?'
  args.push(Number(limit))
  args.push(Number(offset))
  const result = await db.execute({ sql, args })
  res.json(result.rows.map((r: Record<string, unknown>) => ({
    id: r.id,
    type: r.type,
    payload: JSON.parse(r.payload_json as string),
    timestamp: r.timestamp,
  })))
})

// --- Terminals REMOVED ---
// Terminal PTY endpoints have been removed. Agents use DirectRunner (direct Anthropic API calls).
// The "Agents" view shows agent chat windows instead of raw terminals.
app.get('/api/terminals', (_req, res) => { res.json([]) })
app.post('/api/terminals', (_req, res) => { res.status(410).json({ error: 'Terminal PTY disabled. Agents use direct API mode.' }) })
app.delete('/api/terminals/:id', (_req, res) => { res.json({ ok: true }) })

// --- Webhooks (GitHub/GitLab) ---
app.post('/api/webhooks/github', express.raw({ type: 'application/json' }), async (req, res) => {
  const event = req.headers['x-github-event'] as string
  const sig   = req.headers['x-hub-signature-256'] as string | undefined
  const secret = process.env.GITHUB_WEBHOOK_SECRET

  // Verify signature if secret is configured
  if (secret) {
    if (!sig) return res.status(401).json({ error: 'Missing signature' })
    const raw = req.body as Buffer
    const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`
    try {
      if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        return res.status(401).json({ error: 'Invalid signature' })
      }
    } catch {
      return res.status(401).json({ error: 'Invalid signature' })
    }
    req.body = JSON.parse(raw.toString())
  }

  const body = req.body

  try {
    if (event === 'issues' && body.action === 'opened') {
      const issue = body.issue
      const repo = body.repository
      // Find project by repo name
      const projects = await rigManager.listByTown('default')
      const project = projects.find((p) => p.repoUrl?.includes(repo.name) || p.name === repo.name)
      if (project) {
        const releaseTrain = await releaseTrainManager.create(
          `Issue #${issue.number}: ${issue.title}`,
          project.id,
          [],
          issue.body ?? issue.title
        )
        await atomicTaskManager.create(project.id, issue.title, issue.body ?? '', releaseTrain.id)
        return res.json({ ok: true, releaseTrainId: releaseTrain.id })
      }
    }

    if (event === 'pull_request' && body.action === 'opened') {
      const pr = body.pull_request
      const repo = body.repository
      const projects = await rigManager.listByTown('default')
      const project = projects.find((p) => p.repoUrl?.includes(repo.name) || p.name === repo.name)
      if (project) {
        const releaseTrain = await releaseTrainManager.create(
          `PR #${pr.number}: ${pr.title}`,
          project.id,
          [],
          pr.body ?? pr.title
        )
        await atomicTaskManager.create(project.id, pr.title, pr.body ?? '', releaseTrain.id)
        return res.json({ ok: true, releaseTrainId: releaseTrain.id })
      }
    }

    res.json({ ok: true, handled: false })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/github/webhook', async (req, res) => {
  try {
    const secret = process.env.GITHUB_WEBHOOK_SECRET
    if (secret) {
      const sig = req.headers['x-hub-signature-256'] as string | undefined
      if (!sig) { res.status(401).json({ error: 'Missing signature' }); return }
      const { createHmac } = await import('crypto')
      const expected = 'sha256=' + createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex')
      if (sig !== expected) { res.status(401).json({ error: 'Invalid signature' }); return }
    }

    const event = req.headers['x-github-event'] as string
    if (event === 'pull_request' && req.body.action === 'closed' && req.body.pull_request?.merged === true) {
      const prNumber = req.body.pull_request.number as number
      const db = getDb()
      const result = await db.execute({
        sql: `SELECT id, user_id FROM release_trains WHERE pr_number = ? AND status = 'pr_review'`,
        args: [prNumber],
      })
      for (const row of result.rows) {
        await releaseTrainManager.land(row.id as string, row.user_id as string | undefined)
      }
    }
    res.json({ ok: true })
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

// --- Costs ---
app.get('/api/costs/summary', requireAuth, async (req, res) => {
  const userId = res.locals.userId as string
  const db = getDb()

  // All workerbees for this user, all time
  const result = await db.execute({
    sql: `SELECT name, status, task_description, created_at, updated_at
          FROM workerbees WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC`,
    args: [userId],
  })
  const bees = result.rows as unknown as Array<{
    name: string; status: string; task_description: string; created_at: string; updated_at: string
  }>

  // Per-day counts for the last 30 days
  const dailyResult = await db.execute({
    sql: `SELECT date(created_at) as day, COUNT(*) as spawned,
          SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
          SUM(CASE WHEN status = 'zombie' THEN 1 ELSE 0 END) as zombie
          FROM workerbees WHERE (user_id = ? OR user_id IS NULL)
            AND created_at >= date('now', '-30 days')
          GROUP BY day ORDER BY day ASC`,
    args: [userId],
  })

  const user = await getUserById(userId)
  const hasApiKey = !!user?.anthropicApiKey

  res.json({
    hasApiKey,
    apiKeyMasked: user?.anthropicApiKey
      ? `sk-ant-...${user.anthropicApiKey.slice(-8)}`
      : null,
    totalSpawned: bees.length,
    byStatus: bees.reduce<Record<string, number>>((acc, b) => {
      acc[b.status] = (acc[b.status] ?? 0) + 1; return acc
    }, {}),
    recent: bees.slice(0, 50).map((b) => ({
      name: b.name,
      status: b.status,
      task: b.task_description?.slice(0, 80),
      createdAt: b.created_at,
      updatedAt: b.updated_at,
      durationMs: b.updated_at && b.created_at
        ? new Date(b.updated_at).getTime() - new Date(b.created_at).getTime()
        : null,
    })),
    daily: dailyResult.rows.map((r) => ({
      day: r.day as string,
      spawned: Number(r.spawned),
      done: Number(r.done),
      zombie: Number(r.zombie),
    })),
  })
})

// --- Metrics ---
app.get('/api/metrics', async (req, res) => {
  const userId = res.locals.userId as string
  const [bees, releaseTrains, atomicTasks, projects] = await Promise.all([
    workerBeeManager.listAll(userId),
    releaseTrainManager.listAll(userId),
    atomicTaskManager.listAll(userId),
    rigManager.listByTown('default', userId),
  ])

  const beesByStatus = bees.reduce<Record<string, number>>((acc, b) => {
    acc[b.status] = (acc[b.status] ?? 0) + 1; return acc
  }, {})
  const releaseTrainsByStatus = releaseTrains.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1; return acc
  }, {})
  const atomicTasksByStatus = atomicTasks.reduce<Record<string, number>>((acc, b) => {
    acc[b.status] = (acc[b.status] ?? 0) + 1; return acc
  }, {})

  const zombieRate = bees.length > 0 ? (beesByStatus['zombie'] ?? 0) / bees.length : 0

  res.json({
    projects: projects.length,
    workerbees: { total: bees.length, ...beesByStatus },
    releaseTrains: { total: releaseTrains.length, ...releaseTrainsByStatus },
    convoys: { total: releaseTrains.length, ...releaseTrainsByStatus },  // backward compat
    atomictasks: { total: atomicTasks.length, ...atomicTasksByStatus },
    zombieRate: Math.round(zombieRate * 100),
  })
})

// --- Charters ---
app.get('/api/charters', async (req, res) => {
  const { projectId } = req.query as Record<string, string>
  if (!projectId) { res.status(400).json({ error: 'projectId required' }); return }
  res.json(await charterManager.list(projectId))
})

app.get('/api/charters/:projectId/:role', async (req, res) => {
  const { projectId, role } = req.params
  const charter = await charterManager.get(projectId, role)
  res.json(charter ?? { content: '' })
})

app.put('/api/charters/:projectId/:role', async (req, res) => {
  const { projectId, role } = req.params
  const { content } = req.body as { content: string }
  if (!content) { res.status(400).json({ error: 'content required' }); return }
  res.json(await charterManager.upsert(projectId, role, content))
})

// --- Routing rules ---
app.get('/api/routing-rules', async (req, res) => {
  const { projectId } = req.query as Record<string, string>
  if (!projectId) { res.status(400).json({ error: 'projectId required' }); return }
  res.json(await routingManager.list(projectId))
})

app.post('/api/routing-rules', async (req, res) => {
  const { projectId, pattern, role } = req.body as { projectId: string; pattern: string; role: string }
  if (!projectId || !pattern || !role) { res.status(400).json({ error: 'projectId, pattern, role required' }); return }
  res.json(await routingManager.set(projectId, pattern, role))
})

app.delete('/api/routing-rules/:id', async (req, res) => {
  await routingManager.delete(req.params.id)
  res.json({ ok: true })
})

// --- Decisions log ---
app.get('/api/decisions', async (req, res) => {
  const { projectId } = req.query as Record<string, string>
  if (!projectId) { res.status(400).json({ error: 'projectId required' }); return }
  try {
    const project = await rigManager.getById(projectId)
    if (!project) { res.status(404).json({ error: 'project not found' }); return }
    const decisionsPath = require('path').join(project.localPath, 'DECISIONS.md')
    const { existsSync, readFileSync } = require('fs')
    const content = existsSync(decisionsPath) ? readFileSync(decisionsPath, 'utf8') : ''
    res.json({ content, path: decisionsPath })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// --- Token budget / circuit breaker ---
const TOKEN_BUDGET_USD = parseFloat(process.env.MAX_HOURLY_COST_USD ?? '0') // 0 = unlimited

app.get('/api/budget', async (_req, res) => {
  const db = getDb()
  const result = await db.execute({
    sql: `SELECT COALESCE(SUM(cost_usd), 0) as total FROM token_usage WHERE recorded_at >= datetime('now', '-1 hour')`,
    args: [],
  })
  const spent = Number((result.rows[0] as unknown as { total: number }).total ?? 0)
  const limit = TOKEN_BUDGET_USD
  res.json({
    spentLastHour: spent,
    limitPerHour: limit,
    unlimited: limit === 0,
    percentUsed: limit > 0 ? Math.round((spent / limit) * 100) : 0,
    blocked: limit > 0 && spent >= limit,
  })
})

app.post('/api/token-usage', async (req, res) => {
  const { workerBeeId, projectId, inputTokens, outputTokens, costUsd } = req.body as {
    workerBeeId?: string; projectId?: string; inputTokens: number; outputTokens: number; costUsd: number
  }
  const db = getDb()
  const { v4 } = await import('uuid')
  await db.execute({
    sql: `INSERT INTO token_usage (id, workerbee_id, project_id, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [v4(), workerBeeId ?? null, projectId ?? null, inputTokens ?? 0, outputTokens ?? 0, costUsd ?? 0],
  })
  res.json({ ok: true })
})

// â”€â”€ SPA fallback for embedded mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if (SQUAN_CLIENT_DIR) {
  app.get('*', (_req, res) => {
    res.sendFile(join(resolve(SQUAN_CLIENT_DIR), 'index.html'))
  })
}

const PORT = process.env.PORT ?? 3001
const httpServer = createServer(app)

setupWsServer(httpServer)
restoreClaudeConfigOnStartup()

migrate().then(async () => {
  // On startup, agent child processes are gone (they were in-memory).
  // Mark working/idle agents as 'done' (not zombie) since their work may be valid.
  // Only mark stalled agents as zombie since they were already in trouble.
  const db = getDb()
  const doneResult = await db.execute({
    sql: `UPDATE workerbees SET status = 'done', completion_note = COALESCE(completion_note, 'Server restarted — agent work preserved'), updated_at = datetime('now') WHERE status IN ('working', 'idle')`,
    args: [],
  })
  if (doneResult.rowsAffected > 0) {
    console.log(`[startup] Marked ${doneResult.rowsAffected} working/idle agent(s) as done (server restart)`)
  }
  const stalledResult = await db.execute({
    sql: `UPDATE workerbees SET status = 'zombie', updated_at = datetime('now') WHERE status = 'stalled'`,
    args: [],
  })
  if (stalledResult.rowsAffected > 0) {
    console.log(`[startup] Marked ${stalledResult.rowsAffected} stalled agent(s) as zombie`)
  }

  // Clear stale Mayor Lee session IDs â€” PTY sessions are in-memory only and lost on restart
  await db.execute({ sql: `UPDATE mayors SET session_id = NULL WHERE session_id IS NOT NULL`, args: [] })

  await seedSystemTemplates()

  // Sync .squan/ directories for all projects
  try {
    const allRigs = await rigManager.listAll()
    for (const rig of allRigs) {
      if (squanFs.hasSquanDir(rig.localPath)) {
        await squanFs.initAndSync(rig.id, rig.localPath, rig.name)
      }
    }
    console.log(`[startup] Synced .squan/ for ${allRigs.filter((r) => squanFs.hasSquanDir(r.localPath)).length} project(s)`)
  } catch (err) {
    console.warn(`[startup] .squan/ sync error:`, err)
  }

  // PTY/tmux disabled â€” no sessions to reconnect


// -- Extensions API ---------------------------------------------------------

app.get('/api/extensions', requireAuth, async (req, res) => {
  try {
    const db = getDb()
    const projectId = req.query.projectId as string | undefined
    const sql = projectId ? 'SELECT * FROM extensions WHERE project_id = ? ORDER BY name' : 'SELECT * FROM extensions ORDER BY name'
    const result = await db.execute({ sql, args: projectId ? [projectId] : [] })
    res.json(result.rows.map((r: any) => ({ ...r, args: JSON.parse(r.args_json || '[]'), env: JSON.parse(r.env_json || '{}') })))
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.post('/api/extensions', requireAuth, async (req, res) => {
  try {
    const db = getDb()
    const { name, type, command, args, url, env, projectId, enabled } = req.body
    const id = randomUUID()
    await db.execute({
      sql: 'INSERT INTO extensions (id, project_id, name, type, command, args_json, url, env_json, enabled) VALUES (?,?,?,?,?,?,?,?,?)',
      args: [id, projectId || null, name, type || 'stdio', command || null, JSON.stringify(args || []), url || null, JSON.stringify(env || {}), enabled !== false ? 1 : 0],
    })
    res.json({ id, name, type, command, args, url, env, projectId, enabled: enabled !== false })
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.delete('/api/extensions/:id', requireAuth, async (req, res) => {
  try {
    const db = getDb()
    await db.execute({ sql: 'DELETE FROM extensions WHERE id = ?', args: [req.params.id] })
    res.json({ ok: true })
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

// -- Skills API ------------------------------------------------------------

app.get('/api/skills', requireAuth, async (req, res) => {
  try {
    const projectId = req.query.projectId as string | undefined
    const dbSkills = await skillManager.list(projectId)
    const builtins = skillManager.builtins()
    res.json([...builtins, ...dbSkills])
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.post('/api/skills', requireAuth, async (req, res) => {
  try {
    const skill = await skillManager.save(req.body)
    res.json(skill)
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.delete('/api/skills/:id', requireAuth, async (req, res) => {
  try {
    await skillManager.delete(req.params.id)
    res.json({ ok: true })
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

// -- Provider config API ----------------------------------------------------

app.get('/api/user/provider', requireAuth, async (req, res) => {
  try {
    const user = await getUserById(res.locals.userId as string)
    if (!user) return res.status(404).json({ error: 'User not found' })
    res.json({
      provider: (user as any).provider || 'anthropic',
      model: (user as any).provider_model || null,
      providerUrl: (user as any).provider_url || null,
      hasAnthropicKey: !!(user as any).anthropicApiKey,
      hasOpenaiKey: !!(user as any).openai_api_key,
      hasGoogleKey: !!(user as any).google_api_key,
    })
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.put('/api/user/provider', requireAuth, async (req, res) => {
  try {
    const db = getDb()
    const { provider, model, providerUrl, openaiApiKey, googleApiKey } = req.body
    const updates: string[] = []
    const args: any[] = []
    if (provider !== undefined) { updates.push('provider = ?'); args.push(provider) }
    if (model !== undefined) { updates.push('provider_model = ?'); args.push(model) }
    if (providerUrl !== undefined) { updates.push('provider_url = ?'); args.push(providerUrl) }
    if (openaiApiKey !== undefined) { updates.push('openai_api_key = ?'); args.push(openaiApiKey) }
    if (googleApiKey !== undefined) { updates.push('google_api_key = ?'); args.push(googleApiKey) }
    if (updates.length > 0) {
      args.push(res.locals.userId)
      await db.execute({ sql: 'UPDATE users SET ' + updates.join(', ') + ' WHERE id = ?', args })
    }
    res.json({ ok: true })
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})



// -- Demo API -----------------------------------------------------------------

app.get('/api/demo/status', requireAuth, async (_req, res) => {
  try {
    const loaded = await isDemoLoaded()
    res.json({ loaded, project: DEMO_PROJECT })
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.post('/api/demo/load', requireAuth, async (_req, res) => {
  try {
    const userId = res.locals.userId as string
    const result = await loadDemo(userId)
    // Broadcast events so UI updates
    broadcastEvent({ id: randomUUID(), type: 'demo.loaded', payload: result as any, timestamp: new Date().toISOString() })
    res.json(result)
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.post('/api/demo/reset', requireAuth, async (_req, res) => {
  try {
    await resetDemo()
    broadcastEvent({ id: randomUUID(), type: 'demo.reset', payload: {} as any, timestamp: new Date().toISOString() })
    res.json({ ok: true })
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})



  // -- Claude Code Terminal ------------------------------------
  app.post('/api/claude-terminal', requireAuth, (req: any, res) => {
    try {
      const rigId = req.body?.rigId
      let cwd: string | undefined
      if (rigId) {
        const rig = (db as any).prepare('SELECT local_path FROM rigs WHERE id = ?').get(rigId) as any
        if (rig) cwd = rig.local_path
      }
      const session = startClaudeTerminal(cwd)

      // Wire PTY output to WebSocket subscribers (not broadcast)
      session.pty.onData((data: string) => {
        pushClaudeTerminalData(session.id, data)
      })

      session.pty.onExit(({ exitCode }: any) => {
        console.log('[claude-terminal] Session exited:', session.id, 'code:', exitCode)
        notifyClaudeSessionEnded(session.id)
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

  startWitness()
  startSnapshotScheduler(() => workerBeeManager.listAll())
  httpServer.listen(PORT, () => {
    console.log(`squan server  http://localhost:${PORT}`)
    console.log(`websocket       ws://localhost:${PORT}/ws`)
    console.log(`mcp tools       http://localhost:${PORT}/api/mcp/tools`)
    console.log(`terminal backend: ${ptyManager.activeBackendName}${ptyManager.tmuxAvailable ? ' (tmux available)' : ''}`)
  })
}).catch((err) => {
  console.error('Failed to run migrations:', err)
  process.exit(1)
})


  // -- Automations API -----------------------------------------
  app.get('/api/automations', requireAuth, async (req: any, res) => {
    try {
      const sm = getSchedulerManager()
      const automations = await sm.list(req.user.userId)
      res.json(automations)
    } catch (e: any) { res.status(500).json({ error: e.message }) }
  })

  app.post('/api/automations', requireAuth, async (req: any, res) => {
    try {
      const sm = getSchedulerManager()
      const automation = await sm.create({ ...req.body, userId: req.user.userId })
      res.json(automation)
    } catch (e: any) { res.status(400).json({ error: e.message }) }
  })

  app.put('/api/automations/:id', requireAuth, async (req: any, res) => {
    try {
      const sm = getSchedulerManager()
      const automation = await sm.update(req.params.id, req.body)
      res.json(automation)
    } catch (e: any) { res.status(400).json({ error: e.message }) }
  })

  app.delete('/api/automations/:id', requireAuth, async (req: any, res) => {
    try {
      const sm = getSchedulerManager()
      await sm.delete(req.params.id)
      res.json({ ok: true })
    } catch (e: any) { res.status(400).json({ error: e.message }) }
  })

  app.post('/api/automations/:id/enable', requireAuth, async (req: any, res) => {
    try {
      const sm = getSchedulerManager()
      await sm.enable(req.params.id)
      res.json({ ok: true })
    } catch (e: any) { res.status(400).json({ error: e.message }) }
  })

  app.post('/api/automations/:id/disable', requireAuth, async (req: any, res) => {
    try {
      const sm = getSchedulerManager()
      await sm.disable(req.params.id)
      res.json({ ok: true })
    } catch (e: any) { res.status(400).json({ error: e.message }) }
  })

  app.post('/api/automations/:id/run', requireAuth, async (req: any, res) => {
    try {
      const sm = getSchedulerManager()
      const automations = await sm.list(req.user.userId)
      const auto = automations.find(a => a.id === req.params.id)
      if (!auto) return res.status(404).json({ error: 'Automation not found' })
      await sm.recordRun(auto.id)
      res.json({ ok: true, message: 'Automation triggered' })
    } catch (e: any) { res.status(400).json({ error: e.message }) }
  })


  


