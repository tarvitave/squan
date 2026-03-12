import express from 'express'
import { createServer } from 'http'
import { setupWsServer } from './ws/server.js'
import { startWitness } from './witness/index.js'
import { ptyManager } from './polecat/pty.js'
import { polecatManager } from './polecat/manager.js'
import { mayorManager } from './mayor/manager.js'
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

// --- Rigs ---
app.get('/api/rigs', async (_req, res) => {
  res.json(await rigManager.listByTown('default'))
})

app.post('/api/rigs', async (req, res) => {
  const { name, repoUrl, localPath } = req.body
  res.json(await rigManager.add('default', name, repoUrl, localPath))
})

// --- Polecats ---
app.get('/api/polecats', async (_req, res) => {
  res.json(await polecatManager.listAll())
})

app.get('/api/rigs/:rigId/polecats', async (req, res) => {
  res.json(await polecatManager.listByRig(req.params.rigId))
})

app.post('/api/rigs/:rigId/polecats', async (req, res) => {
  const polecat = await polecatManager.spawn(req.params.rigId, req.body.beadId)
  res.json(polecat)
})

app.delete('/api/polecats/:id', async (req, res) => {
  await polecatManager.nuke(req.params.id)
  res.json({ ok: true })
})

// --- Mayor ---
app.post('/api/mayor/start', async (req, res) => {
  res.json(await mayorManager.start(req.body.townId ?? 'default'))
})

app.post('/api/mayor/stop', async (req, res) => {
  await mayorManager.stop(req.body.townId ?? 'default')
  res.json({ ok: true })
})

app.get('/api/mayor', async (_req, res) => {
  res.json(await mayorManager.get('default'))
})

// --- Convoys ---
app.get('/api/convoys', async (_req, res) => {
  res.json(await convoyManager.listAll())
})

app.post('/api/convoys', async (req, res) => {
  const { name, rigId, beadIds } = req.body
  res.json(await convoyManager.create(name, rigId, beadIds))
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
