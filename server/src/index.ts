import express from 'express'
import { createServer } from 'http'
import { createHmac, timingSafeEqual } from 'crypto'
import { z } from 'zod'
import { setupWsServer } from './ws/server.js'
import { startWitness } from './witness/index.js'
import { ptyManager } from './polecat/pty.js'
import { workerBeeManager } from './polecat/manager.js'
import { mayorLeeManager } from './mayor/manager.js'
import { rigManager } from './rig/manager.js'
import { convoyManager } from './convoy/manager.js'
import { townManager } from './town/manager.js'
import { hookManager } from './hooks/manager.js'
import { beadManager } from './beads/manager.js'
import { templateManager } from './templates/manager.js'
import { snapshotManager, replayManager, startSnapshotScheduler } from './snapshots/manager.js'
import { handleMcpCall, handleMcpToolsList } from './mcp/server.js'
import { getDb, migrate } from './db/index.js'
import { register, login, getUserById, updateApiKey, requireAuth } from './auth/index.js'
import { preconfigureClaudeAuth } from './claude-auth.js'

const app = express()
app.use(express.json())

app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-GitHub-Event, X-Hub-Signature-256')
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  if (_req.method === 'OPTIONS') { res.sendStatus(204); return }
  next()
})

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

// Health — public
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() })
})

// --- Auth middleware for all routes below ---
app.use('/api', requireAuth)

// --- Current user ---
app.get('/api/auth/me', async (_req, res) => {
  const user = await getUserById(res.locals.userId as string)
  res.json(user)
})

app.put('/api/auth/api-key', async (req, res) => {
  const { anthropicApiKey } = req.body
  if (!anthropicApiKey) { res.status(400).json({ error: 'anthropicApiKey required' }); return }
  await updateApiKey(res.locals.userId as string, anthropicApiKey)
  res.json({ ok: true })
})

// --- Projects (formerly Rigs) ---
const ProjectSchema = z.object({
  name: z.string().min(1),
  localPath: z.string().min(1),
  repoUrl: z.string().default(''),
  townId: z.string().optional(),
})

// Towns
app.get('/api/towns', async (_req, res) => {
  res.json(await townManager.list())
})

app.post('/api/towns', async (req, res) => {
  try {
    const { name, path } = req.body
    if (!name || !path) return res.status(400).json({ error: 'name and path required' })
    res.json(await townManager.create(name, path))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.get('/api/projects', async (_req, res) => {
  res.json(await rigManager.listByTown('default'))
})
app.get('/api/rigs', async (req, res) => {
  const townId = (req.query.townId as string) ?? (await townManager.ensureDefault()).id
  res.json(await rigManager.listByTown(townId))
})

app.post('/api/projects', async (req, res) => {
  try {
    const { name, repoUrl, localPath } = validate(ProjectSchema, req.body)
    res.json(await rigManager.add('default', name, repoUrl ?? '', localPath))
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})
app.post('/api/rigs', async (req, res) => {
  try {
    const { name, repoUrl, localPath, townId: bodyTownId } = validate(ProjectSchema, req.body)
    const townId = bodyTownId ?? (await townManager.ensureDefault()).id
    res.json(await rigManager.add(townId, name, repoUrl ?? '', localPath))
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.patch('/api/projects/:id/runtime', async (req, res) => {
  try {
    res.json(await rigManager.setRuntime(req.params.id, req.body))
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.delete('/api/projects/:id', async (req, res) => {
  await rigManager.remove(req.params.id)
  res.json({ ok: true })
})

// --- WorkerBees ---
const SpawnSchema = z.object({ taskDescription: z.string().optional(), task: z.string().optional() })

app.get('/api/workerbees', async (_req, res) => {
  res.json(await workerBeeManager.listAll())
})
app.get('/api/polecats', async (_req, res) => {
  res.json(await workerBeeManager.listAll())
})

app.get('/api/projects/:projectId/workerbees', async (req, res) => {
  res.json(await workerBeeManager.listByProject(req.params.projectId))
})

app.post('/api/projects/:projectId/workerbees', async (req, res) => {
  try {
    const { taskDescription, task } = validate(SpawnSchema, req.body)
    const user = await getUserById(res.locals.userId as string)
    if (user?.anthropicApiKey) preconfigureClaudeAuth(user.anthropicApiKey)
    res.json(await workerBeeManager.spawn(req.params.projectId, taskDescription ?? task))
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})
app.post('/api/rigs/:rigId/polecats', async (req, res) => {  // backwards compat
  try {
    const { taskDescription, task } = validate(SpawnSchema, req.body)
    const user = await getUserById(res.locals.userId as string)
    if (user?.anthropicApiKey) preconfigureClaudeAuth(user.anthropicApiKey)
    res.json(await workerBeeManager.spawn(req.params.rigId, taskDescription ?? task))
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.post('/api/workerbees/:id/message', async (req, res) => {
  await workerBeeManager.sendMessage(req.params.id, req.body.message)
  res.json({ ok: true })
})

app.post('/api/workerbees/:id/done', async (req, res) => {
  await workerBeeManager.updateStatus(req.params.id, 'done')
  res.json({ ok: true })
})

app.delete('/api/workerbees/:id', async (req, res) => {
  await workerBeeManager.nuke(req.params.id)
  res.json({ ok: true })
})

app.patch('/api/workerbees/:id/status', async (req, res) => {
  await workerBeeManager.updateStatus(req.params.id, req.body.status)
  res.json({ ok: true })
})

// Snapshot endpoints
app.post('/api/workerbees/:id/snapshot', async (req, res) => {
  const bee = await workerBeeManager.getById(req.params.id)
  if (!bee?.sessionId) return res.status(400).json({ error: 'No active session' })
  res.json(await snapshotManager.capture(bee.id, bee.sessionId))
})

app.get('/api/workerbees/:id/snapshots', async (req, res) => {
  res.json(await snapshotManager.listByWorkerBee(req.params.id))
})

app.get('/api/snapshots/:id/content', async (req, res) => {
  const content = await snapshotManager.getContent(req.params.id)
  if (content === null) return res.status(404).json({ error: 'Snapshot not found' })
  res.json({ content })
})

// Replay frames
app.get('/api/workerbees/:id/replay', async (req, res) => {
  res.json(await replayManager.listFrames(req.params.id))
})

app.get('/api/replay/:frameId/content', async (req, res) => {
  const content = await replayManager.getFrameContent(req.params.frameId)
  if (content === null) return res.status(404).json({ error: 'Frame not found' })
  res.json({ content })
})

// --- Mayor Lee ---
app.post('/api/mayor-lee/start', async (req, res) => {
  const user = await getUserById(res.locals.userId as string)
  res.json(await mayorLeeManager.start(req.body.townId ?? 'default', user?.anthropicApiKey ?? undefined))
})
app.post('/api/mayor/start', async (req, res) => {  // backwards compat
  const user = await getUserById(res.locals.userId as string)
  res.json(await mayorLeeManager.start(req.body.townId ?? 'default', user?.anthropicApiKey ?? undefined))
})
app.post('/api/mayor-lee/stop', async (req, res) => {
  await mayorLeeManager.stop(req.body.townId ?? 'default')
  res.json({ ok: true })
})
app.post('/api/mayor/stop', async (req, res) => {
  await mayorLeeManager.stop(req.body.townId ?? 'default')
  res.json({ ok: true })
})

app.post('/api/mayor-lee/message', async (req, res) => {
  await mayorLeeManager.sendMessage(req.body.townId ?? 'default', req.body.message)
  res.json({ ok: true })
})
app.post('/api/mayor/message', async (req, res) => {  // backwards compat
  await mayorLeeManager.sendMessage(req.body.townId ?? 'default', req.body.message)
  res.json({ ok: true })
})

app.get('/api/mayor-lee', async (_req, res) => {
  res.json(await mayorLeeManager.get('default'))
})
app.get('/api/mayor', async (_req, res) => {  // backwards compat
  res.json(await mayorLeeManager.get('default'))
})

// --- Convoys ---
const ConvoySchema = z.object({
  name: z.string().min(1),
  projectId: z.string().optional(),
  rigId: z.string().optional(),
  beadIds: z.array(z.string()).optional(),
  description: z.string().optional(),
}).refine((d) => d.projectId || d.rigId, { message: 'projectId or rigId required' })

app.get('/api/convoys', async (_req, res) => {
  res.json(await convoyManager.listAll())
})

app.post('/api/convoys', async (req, res) => {
  try {
    const { name, projectId, rigId, beadIds, description } = validate(ConvoySchema, req.body)
    res.json(await convoyManager.create(name, (projectId ?? rigId)!, beadIds, description))
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.post('/api/convoys/:id/beads', async (req, res) => {
  res.json(await convoyManager.addBeads(req.params.id, req.body.beadIds))
})

app.delete('/api/convoys/:id/beads', async (req, res) => {
  res.json(await convoyManager.removeBeads(req.params.id, req.body.beadIds))
})

app.post('/api/convoys/:id/land', async (req, res) => {
  await convoyManager.land(req.params.id)
  res.json({ ok: true })
})

app.post('/api/convoys/:id/cancel', async (req, res) => {
  await convoyManager.cancel(req.params.id)
  res.json({ ok: true })
})

app.post('/api/convoys/:id/assign', async (req, res) => {
  const convoy = await convoyManager.assignWorkerBee(req.params.id, req.body.workerBeeId ?? null)
  res.json(convoy)
})

app.post('/api/convoys/:id/dispatch', async (req, res) => {
  const convoy = await convoyManager.getById(req.params.id)
  if (!convoy) return res.status(404).json({ error: 'Convoy not found' })
  const taskDescription = convoy.description || convoy.name
  const bee = await workerBeeManager.spawn(convoy.projectId, taskDescription)
  await convoyManager.assignWorkerBee(convoy.id, bee.id)
  res.json({ bee, convoy: await convoyManager.getById(convoy.id) })
})

app.patch('/api/convoys/:id/description', async (req, res) => {
  res.json(await convoyManager.updateDescription(req.params.id, req.body.description))
})

// --- Hooks ---
const HookSchema = z.object({
  projectId: z.string().min(1),
  branch: z.string().min(1),
  notes: z.string().optional(),
  workerBeeId: z.string().optional(),
  beadId: z.string().optional(),
})

app.get('/api/hooks', async (req, res) => {
  const { projectId } = req.query
  res.json(projectId ? await hookManager.listByProject(projectId as string) : await hookManager.listAll())
})

app.post('/api/hooks', async (req, res) => {
  try {
    const { projectId, branch, notes, workerBeeId, beadId } = validate(HookSchema, req.body)
    res.json(await hookManager.create(projectId, branch, notes, workerBeeId, beadId))
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.post('/api/hooks/:id/activate', async (req, res) => {
  await hookManager.activate(req.params.id)
  res.json({ ok: true })
})
app.post('/api/hooks/:id/complete', async (req, res) => {
  await hookManager.complete(req.params.id)
  res.json({ ok: true })
})
app.post('/api/hooks/:id/suspend', async (req, res) => {
  await hookManager.suspend(req.params.id)
  res.json({ ok: true })
})
app.post('/api/hooks/:id/archive', async (req, res) => {
  await hookManager.archive(req.params.id)
  res.json({ ok: true })
})
app.delete('/api/hooks/:id', async (req, res) => {
  await hookManager.remove(req.params.id)
  res.json({ ok: true })
})

// --- Beads ---
const BeadSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  convoyId: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
})

app.get('/api/beads', async (req, res) => {
  const { projectId, convoyId } = req.query
  if (convoyId) return res.json(await beadManager.listByConvoy(convoyId as string))
  if (projectId) return res.json(await beadManager.listByProject(projectId as string))
  res.json(await beadManager.listAll())
})

app.post('/api/beads', async (req, res) => {
  try {
    const { projectId, title, description, convoyId, dependsOn } = validate(BeadSchema, req.body)
    res.json(await beadManager.create(projectId, title, description, convoyId, dependsOn))
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.get('/api/beads/:id/dependencies', async (req, res) => {
  res.json(await beadManager.areDependenciesMet(req.params.id))
})

app.post('/api/beads/:id/dependencies', async (req, res) => {
  res.json(await beadManager.setDependencies(req.params.id, req.body.dependsOn))
})

app.post('/api/beads/:id/assign', async (req, res) => {
  res.json(await beadManager.assign(req.params.id, req.body.workerBeeId))
})

app.post('/api/beads/:id/status', async (req, res) => {
  res.json(await beadManager.setStatus(req.params.id, req.body.status))
})

app.delete('/api/beads/:id', async (req, res) => {
  await beadManager.remove(req.params.id)
  res.json({ ok: true })
})

// --- Templates ---
const TemplateSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  content: z.string().min(1),
})

app.get('/api/templates', async (req, res) => {
  const { projectId } = req.query
  res.json(projectId ? await templateManager.listByProject(projectId as string) : await templateManager.listAll())
})

app.post('/api/templates', async (req, res) => {
  try {
    const { projectId, name, content } = validate(TemplateSchema, req.body)
    res.json(await templateManager.create(projectId, name, content))
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.put('/api/templates/:id', async (req, res) => {
  res.json(await templateManager.update(req.params.id, req.body))
})

app.delete('/api/templates/:id', async (req, res) => {
  await templateManager.remove(req.params.id)
  res.json({ ok: true })
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

// --- Terminals ---
app.get('/api/terminals', (_req, res) => { res.json(ptyManager.list()) })

app.post('/api/terminals', async (req, res) => {
  const user = await getUserById(res.locals.userId as string)
  const env: Record<string, string> = {}
  if (user?.anthropicApiKey) {
    preconfigureClaudeAuth(user.anthropicApiKey)
    env.ANTHROPIC_API_KEY = user.anthropicApiKey
  }
  const id = ptyManager.spawn({
    shell: req.body.shell,
    cwd: req.body.cwd,
    cols: req.body.cols ?? 120,
    rows: req.body.rows ?? 30,
    env,
  })
  res.json({ id })
})

app.delete('/api/terminals/:id', (req, res) => {
  ptyManager.kill(req.params.id)
  res.json({ ok: true })
})

// --- MCP Server ---
app.get('/api/mcp/tools', handleMcpToolsList)
app.post('/api/mcp', handleMcpCall)

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
        const convoy = await convoyManager.create(
          `Issue #${issue.number}: ${issue.title}`,
          project.id,
          [],
          issue.body ?? issue.title
        )
        await beadManager.create(project.id, issue.title, issue.body ?? '', convoy.id)
        return res.json({ ok: true, convoyId: convoy.id })
      }
    }

    if (event === 'pull_request' && body.action === 'opened') {
      const pr = body.pull_request
      const repo = body.repository
      const projects = await rigManager.listByTown('default')
      const project = projects.find((p) => p.repoUrl?.includes(repo.name) || p.name === repo.name)
      if (project) {
        const convoy = await convoyManager.create(
          `PR #${pr.number}: ${pr.title}`,
          project.id,
          [],
          pr.body ?? pr.title
        )
        await beadManager.create(project.id, pr.title, pr.body ?? '', convoy.id)
        return res.json({ ok: true, convoyId: convoy.id })
      }
    }

    res.json({ ok: true, handled: false })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// --- Metrics ---
app.get('/api/metrics', async (_req, res) => {
  const [bees, convoys, beads, projects] = await Promise.all([
    workerBeeManager.listAll(),
    convoyManager.listAll(),
    beadManager.listAll(),
    rigManager.listByTown('default'),
  ])

  const beesByStatus = bees.reduce<Record<string, number>>((acc, b) => {
    acc[b.status] = (acc[b.status] ?? 0) + 1; return acc
  }, {})
  const convoysByStatus = convoys.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1; return acc
  }, {})
  const beadsByStatus = beads.reduce<Record<string, number>>((acc, b) => {
    acc[b.status] = (acc[b.status] ?? 0) + 1; return acc
  }, {})

  const zombieRate = bees.length > 0 ? (beesByStatus['zombie'] ?? 0) / bees.length : 0

  res.json({
    projects: projects.length,
    workerbees: { total: bees.length, ...beesByStatus },
    convoys: { total: convoys.length, ...convoysByStatus },
    beads: { total: beads.length, ...beadsByStatus },
    zombieRate: Math.round(zombieRate * 100),
  })
})

const PORT = process.env.PORT ?? 3001
const httpServer = createServer(app)

setupWsServer(httpServer)

migrate().then(() => {
  startWitness()
  startSnapshotScheduler(() => workerBeeManager.listAll())
  httpServer.listen(PORT, () => {
    console.log(`squansq server  http://localhost:${PORT}`)
    console.log(`websocket       ws://localhost:${PORT}/ws`)
    console.log(`mcp tools       http://localhost:${PORT}/api/mcp/tools`)
  })
}).catch((err) => {
  console.error('Failed to run migrations:', err)
  process.exit(1)
})
