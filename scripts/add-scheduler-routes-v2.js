const fs = require('fs')
const f = 'server/src/index.ts'
let c = fs.readFileSync(f, 'utf8')

// Add import at top of file (after other imports)
if (!c.includes('getSchedulerManager')) {
  // Find last import line
  const lastImport = c.lastIndexOf("import ")
  const endOfLastImport = c.indexOf('\n', lastImport)
  c = c.slice(0, endOfLastImport + 1) + 
    "import { getSchedulerManager } from './scheduler/index.js'\n" +
    c.slice(endOfLastImport + 1)
  console.log('Added import')
}

// Add routes before startWitness — find the function call inside the main code
const startWitnessIdx = c.indexOf('startWitness(')
if (startWitnessIdx < 0) { console.error('startWitness not found'); process.exit(1) }

// Go back to find a good insertion point (a blank line before startWitness)
const insertPoint = c.lastIndexOf('\n\n', startWitnessIdx)

const routes = `

  // ── Automations API ─────────────────────────────────────────
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
`

if (!c.includes('/api/automations')) {
  c = c.slice(0, insertPoint) + routes + c.slice(insertPoint)
  console.log('Added automation routes')
}

fs.writeFileSync(f, c)
console.log('Done')
