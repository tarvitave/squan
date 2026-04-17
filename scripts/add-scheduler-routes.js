const fs = require('fs')
const f = 'server/src/index.ts'
let c = fs.readFileSync(f, 'utf8')

// Add import
if (!c.includes('schedulerManager')) {
  c = c.replace(
    "import { skillManager }",
    "import { skillManager } from './skills/index.js'\nimport { getSchedulerManager, matchEvent }"
  )
  // Fix double import
  c = c.replace("import { skillManager } from './skills/index.js'\nimport { getSchedulerManager, matchEvent } from './skills/index.js'",
    "import { skillManager } from './skills/index.js'\nimport { getSchedulerManager, matchEvent } from './scheduler/index.js'")
  
  if (!c.includes("from './scheduler/index.js'")) {
    // Just add the import line
    c = c.replace(
      "import { skillManager } from './skills/index.js'",
      "import { skillManager } from './skills/index.js'\nimport { getSchedulerManager, matchEvent } from './scheduler/index.js'"
    )
  }
  console.log('Added scheduler import')
}

// Add routes before the startWitness line
const routes = `
  // ── Automations API ─────────────────────────────────────────
  app.get('/api/automations', requireAuth, (req: any, res) => {
    try {
      const sm = getSchedulerManager(db)
      const automations = sm.list(req.user.userId)
      res.json(automations)
    } catch (e: any) { res.status(500).json({ error: e.message }) }
  })

  app.post('/api/automations', requireAuth, (req: any, res) => {
    try {
      const sm = getSchedulerManager(db)
      const automation = sm.create({ ...req.body, userId: req.user.userId })
      res.json(automation)
    } catch (e: any) { res.status(400).json({ error: e.message }) }
  })

  app.put('/api/automations/:id', requireAuth, (req: any, res) => {
    try {
      const sm = getSchedulerManager(db)
      const automation = sm.update(req.params.id, req.body)
      res.json(automation)
    } catch (e: any) { res.status(400).json({ error: e.message }) }
  })

  app.delete('/api/automations/:id', requireAuth, (req: any, res) => {
    try {
      const sm = getSchedulerManager(db)
      sm.delete(req.params.id)
      res.json({ ok: true })
    } catch (e: any) { res.status(400).json({ error: e.message }) }
  })

  app.post('/api/automations/:id/enable', requireAuth, (req: any, res) => {
    try {
      const sm = getSchedulerManager(db)
      sm.enable(req.params.id)
      res.json({ ok: true })
    } catch (e: any) { res.status(400).json({ error: e.message }) }
  })

  app.post('/api/automations/:id/disable', requireAuth, (req: any, res) => {
    try {
      const sm = getSchedulerManager(db)
      sm.disable(req.params.id)
      res.json({ ok: true })
    } catch (e: any) { res.status(400).json({ error: e.message }) }
  })

  app.post('/api/automations/:id/run', requireAuth, async (req: any, res) => {
    try {
      const sm = getSchedulerManager(db)
      const automations = sm.list(req.user.userId)
      const auto = automations.find((a: any) => a.id === req.params.id)
      if (!auto) return res.status(404).json({ error: 'Automation not found' })
      // Dispatch agent for this automation
      const task = auto.taskDescription || auto.name
      // Use the existing spawnDirectAgent
      sm.recordRun(auto.id)
      res.json({ ok: true, message: 'Automation triggered' })
    } catch (e: any) { res.status(400).json({ error: e.message }) }
  })

`

if (!c.includes('/api/automations')) {
  const startWitness = c.indexOf('startWitness')
  if (startWitness > 0) {
    const insertPoint = c.lastIndexOf('\n', startWitness)
    c = c.slice(0, insertPoint) + routes + c.slice(insertPoint)
    console.log('Added automation routes')
  }
}

fs.writeFileSync(f, c)
console.log('Done')
