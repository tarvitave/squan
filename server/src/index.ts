import express from 'express'
import { createServer } from 'http'
import { setupWsServer } from './ws/server.js'
import { startWitness } from './witness/index.js'
import { ptyManager } from './polecat/pty.js'
import { workerBeeManager } from './polecat/manager.js'
import { mayorLeeManager } from './mayor/manager.js'
import { rigManager } from './rig/manager.js'
import { convoyManager } from './convoy/manager.js'
import { migrate } from './db/index.js'

const app = express()
app.use(express.json())

app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  next()
})

// --- Projects (formerly Rigs) ---
app.get('/api/projects', async (_req, res) => {
  res.json(await rigManager.listByTown('default'))
})
app.get('/api/rigs', async (_req, res) => {  // backwards compat
  res.json(await rigManager.listByTown('default'))
})

app.post('/api/projects', async (req, res) => {
  const { name, repoUrl, localPath } = req.body
  res.json(await rigManager.add('default', name, repoUrl, localPath))
})
app.post('/api/rigs', async (req, res) => {  // backwards compat
  const { name, repoUrl, localPath } = req.body
  res.json(await rigManager.add('default', name, repoUrl, localPath))
})

// --- WorkerBees (formerly Polecats) ---
app.get('/api/workerbees', async (_req, res) => {
  res.json(await workerBeeManager.listAll())
})
app.get('/api/polecats', async (_req, res) => {  // backwards compat
  res.json(await workerBeeManager.listAll())
})

app.get('/api/projects/:projectId/workerbees', async (req, res) => {
  res.json(await workerBeeManager.listByProject(req.params.projectId))
})

app.post('/api/projects/:projectId/workerbees', async (req, res) => {
  const bee = await workerBeeManager.spawn(req.params.projectId, req.body.beadId, req.body.task)
  res.json(bee)
})
app.post('/api/rigs/:rigId/polecats', async (req, res) => {  // backwards compat
  const bee = await workerBeeManager.spawn(req.params.rigId, req.body.beadId, req.body.task)
  res.json(bee)
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

// --- Mayor Lee ---
app.post('/api/mayor-lee/start', async (req, res) => {
  res.json(await mayorLeeManager.start(req.body.townId ?? 'default'))
})
app.post('/api/mayor/start', async (req, res) => {  // backwards compat
  res.json(await mayorLeeManager.start(req.body.townId ?? 'default'))
})

app.post('/api/mayor-lee/stop', async (req, res) => {
  await mayorLeeManager.stop(req.body.townId ?? 'default')
  res.json({ ok: true })
})
app.post('/api/mayor/stop', async (req, res) => {  // backwards compat
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
app.get('/api/convoys', async (_req, res) => {
  res.json(await convoyManager.listAll())
})

app.post('/api/convoys', async (req, res) => {
  const { name, projectId, rigId, beadIds } = req.body
  res.json(await convoyManager.create(name, projectId ?? rigId, beadIds))
})

app.post('/api/convoys/:id/beads', async (req, res) => {
  res.json(await convoyManager.addBeads(req.params.id, req.body.beadIds))
})

app.post('/api/convoys/:id/land', async (req, res) => {
  await convoyManager.land(req.params.id)
  res.json({ ok: true })
})

// --- Terminals ---
app.get('/api/terminals', (_req, res) => {
  res.json(ptyManager.list())
})

app.post('/api/terminals', (req, res) => {
  const id = ptyManager.spawn({
    shell: req.body.shell,
    cwd: req.body.cwd,
    cols: req.body.cols ?? 120,
    rows: req.body.rows ?? 30,
  })
  res.json({ id })
})

app.delete('/api/terminals/:id', (req, res) => {
  ptyManager.kill(req.params.id)
  res.json({ ok: true })
})

// --- Health ---
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() })
})

const PORT = process.env.PORT ?? 3001
const httpServer = createServer(app)

setupWsServer(httpServer)

migrate().then(() => {
  startWitness()
  httpServer.listen(PORT, () => {
    console.log(`squansq server  http://localhost:${PORT}`)
    console.log(`websocket       ws://localhost:${PORT}/ws`)
  })
}).catch((err) => {
  console.error('Failed to run migrations:', err)
  process.exit(1)
})
