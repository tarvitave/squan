const fs = require('fs');
const f = 'server/src/index.ts';
let c = fs.readFileSync(f, 'utf8');

// Add import
if (!c.includes('loadDemo')) {
  const marker = "import { skillManager } from './skills/index.js'";
  if (c.includes(marker)) {
    c = c.replace(marker, marker + "\nimport { loadDemo, resetDemo, isDemoLoaded, DEMO_PROJECT } from './demo/seed.js'");
    console.log('Added demo import');
  } else {
    console.log('Could not find skills import to add demo import after');
    // Try alternate
    const alt = "import { recipeManager }";
    if (c.includes(alt)) {
      c = c.replace(alt, "import { loadDemo, resetDemo, isDemoLoaded, DEMO_PROJECT } from './demo/seed.js'\n" + alt);
      console.log('Added demo import (alt)');
    }
  }
}

// Add routes before startWitness
if (!c.includes('/api/demo')) {
  const marker = '  startWitness()';
  const routes = `
// ── Demo API ─────────────────────────────────────────────────────────────────

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

`;

  c = c.replace(marker, routes + '\n' + marker);
  console.log('Added demo routes');
}

fs.writeFileSync(f, c);
console.log('Done');
