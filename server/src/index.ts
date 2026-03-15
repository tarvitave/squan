import 'dotenv/config'
import express from 'express'

// Prevent unhandled rejections from crashing the server (Node 15+ throws by default)
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection:', reason)
})
import { createServer } from 'http'
import { createHmac, timingSafeEqual } from 'crypto'
import { z } from 'zod'
import { setupWsServer } from './ws/server.js'
import { startWitness } from './witness/index.js'
import { ptyManager } from './workerbee/pty.js'
import { workerBeeManager } from './workerbee/manager.js'
import { mayorLeeManager } from './mayor/manager.js'
import { rigManager } from './rig/manager.js'
import { releaseTrainManager } from './releasetrain/manager.js'
import { townManager } from './town/manager.js'
import { hookManager } from './hooks/manager.js'
import { atomicTaskManager, beadManager } from './beads/manager.js'
import { templateManager } from './templates/manager.js'
import { snapshotManager, replayManager, startSnapshotScheduler } from './snapshots/manager.js'
import { handleMcpCall, handleMcpToolsList } from './mcp/server.js'
import { getDb, migrate } from './db/index.js'
import { register, login, getUserById, updateApiKey, requireAuth } from './auth/index.js'
import { preconfigureClaudeAuth, restoreClaudeConfigOnStartup } from './claude-auth.js'

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
    const townId = (req.query.townId as string) ?? (await townManager.ensureDefault()).id
    res.json(await rigManager.listByTown(townId, userId))
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
    // Verify project belongs to this user
    const project = await rigManager.getById(req.params.projectId)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    if (project.userId && project.userId !== userId) return res.status(403).json({ error: 'Forbidden' })
    const { taskDescription, task } = validate(SpawnSchema, req.body)
    const user = await getUserById(userId)
    if (user?.anthropicApiKey) preconfigureClaudeAuth(user.anthropicApiKey)
    res.json(await workerBeeManager.spawn(req.params.projectId, taskDescription ?? task, userId))
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})
app.post('/api/rigs/:rigId/polecats', async (req, res) => {  // backwards compat
  try {
    const userId = res.locals.userId as string
    const project = await rigManager.getById(req.params.rigId)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    if (project.userId && project.userId !== userId) return res.status(403).json({ error: 'Forbidden' })
    const { taskDescription, task } = validate(SpawnSchema, req.body)
    const user = await getUserById(userId)
    if (user?.anthropicApiKey) preconfigureClaudeAuth(user.anthropicApiKey)
    res.json(await workerBeeManager.spawn(req.params.rigId, taskDescription ?? task, userId))
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
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

app.post('/api/workerbees/:id/done', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const bee = await workerBeeManager.getById(req.params.id)
    if (!bee) return res.status(404).json({ error: 'WorkerBee not found' })
    if (bee.userId && bee.userId !== userId) return res.status(403).json({ error: 'Forbidden' })
    await workerBeeManager.updateStatus(req.params.id, 'done')
    res.json({ ok: true })
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.delete('/api/workerbees/:id', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    await workerBeeManager.nuke(req.params.id, userId)
    res.json({ ok: true })
  } catch (err) {
    const msg = (err as Error).message
    res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg })
  }
})

app.patch('/api/workerbees/:id/status', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const bee = await workerBeeManager.getById(req.params.id)
    if (!bee) return res.status(404).json({ error: 'WorkerBee not found' })
    if (bee.userId && bee.userId !== userId) return res.status(403).json({ error: 'Forbidden' })
    await workerBeeManager.updateStatus(req.params.id, req.body.status)
    res.json({ ok: true })
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

// Snapshot endpoints
app.post('/api/workerbees/:id/snapshot', async (req, res) => {
  const userId = res.locals.userId as string
  const bee = await workerBeeManager.getById(req.params.id)
  if (!bee) return res.status(404).json({ error: 'WorkerBee not found' })
  if (bee.userId && bee.userId !== userId) return res.status(403).json({ error: 'Forbidden' })
  if (!bee?.sessionId) return res.status(400).json({ error: 'No active session' })
  res.json(await snapshotManager.capture(bee.id, bee.sessionId))
})

app.get('/api/workerbees/:id/snapshots', async (req, res) => {
  const userId = res.locals.userId as string
  const bee = await workerBeeManager.getById(req.params.id)
  if (!bee) return res.status(404).json({ error: 'WorkerBee not found' })
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
  if (!bee) return res.status(404).json({ error: 'WorkerBee not found' })
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
    res.json(await mayorLeeManager.get('default', userId))
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})
app.get('/api/mayor', async (req, res) => {  // backwards compat
  try {
    const userId = res.locals.userId as string
    res.json(await mayorLeeManager.get('default', userId))
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
    const { name, projectId, rigId, atomicTaskIds, beadIds, description } = validate(ReleaseTrainSchema, req.body)
    res.json(await releaseTrainManager.create(name, (projectId ?? rigId)!, atomicTaskIds ?? beadIds, description, userId))
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})
app.post('/api/convoys', async (req, res) => {  // backward compat
  try {
    const userId = res.locals.userId as string
    const { name, projectId, rigId, atomicTaskIds, beadIds, description } = validate(ReleaseTrainSchema, req.body)
    res.json(await releaseTrainManager.create(name, (projectId ?? rigId)!, atomicTaskIds ?? beadIds, description, userId))
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
    const releaseTrain = await releaseTrainManager.getById(req.params.id)
    if (!releaseTrain) return res.status(404).json({ error: 'ReleaseTrain not found' })
    if (releaseTrain.userId && releaseTrain.userId !== userId) return res.status(403).json({ error: 'Forbidden' })
    const taskDescription = releaseTrain.description || releaseTrain.name
    const bee = await workerBeeManager.spawn(releaseTrain.projectId, taskDescription, userId)
    await releaseTrainManager.assignWorkerBee(releaseTrain.id, bee.id, userId)
    res.json({ bee, releaseTrain: await releaseTrainManager.getById(releaseTrain.id) })
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})
app.post('/api/convoys/:id/dispatch', async (req, res) => {  // backward compat
  try {
    const userId = res.locals.userId as string
    const releaseTrain = await releaseTrainManager.getById(req.params.id)
    if (!releaseTrain) return res.status(404).json({ error: 'ReleaseTrain not found' })
    if (releaseTrain.userId && releaseTrain.userId !== userId) return res.status(403).json({ error: 'Forbidden' })
    const taskDescription = releaseTrain.description || releaseTrain.name
    const bee = await workerBeeManager.spawn(releaseTrain.projectId, taskDescription, userId)
    await releaseTrainManager.assignWorkerBee(releaseTrain.id, bee.id, userId)
    res.json({ bee, convoy: await releaseTrainManager.getById(releaseTrain.id) })
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
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

// --- Terminals ---
app.get('/api/terminals', (req, res) => {
  const userId = res.locals.userId as string
  // Only return terminal session IDs owned by this user
  const allSessions = ptyManager.list()
  const userSessions = allSessions.filter((id) => {
    const owner = ptyManager.getOwnerUserId(id)
    return owner === null || owner === userId
  })
  res.json(userSessions)
})

app.post('/api/terminals', async (req, res) => {
  try {
    const userId = res.locals.userId as string
    const user = await getUserById(userId)
    const env: Record<string, string> = {}
    if (user?.anthropicApiKey) {
      preconfigureClaudeAuth(user.anthropicApiKey)
      env.ANTHROPIC_API_KEY = user.anthropicApiKey
    }
    const id = ptyManager.spawn({
      shell: req.body.shell ?? (process.env.TERMINAL_COMMAND ?? 'claude'),
      args: Array.isArray(req.body.args) ? req.body.args : undefined,
      cwd: req.body.cwd,
      cols: req.body.cols ?? 120,
      rows: req.body.rows ?? 30,
      env,
      ownerUserId: userId,
    })
    res.json({ id })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

app.delete('/api/terminals/:id', (req, res) => {
  const userId = res.locals.userId as string
  const owner = ptyManager.getOwnerUserId(req.params.id)
  if (owner !== null && owner !== userId) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
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

const PORT = process.env.PORT ?? 3001
const httpServer = createServer(app)

setupWsServer(httpServer)
restoreClaudeConfigOnStartup()

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
