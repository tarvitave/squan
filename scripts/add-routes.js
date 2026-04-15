const fs = require('fs');
const f = 'server/src/index.ts';
let c = fs.readFileSync(f, 'utf8');

// Add import
const importMarker = "import { parseGithubRepo";
if (!c.includes("recipeManager")) {
  c = c.replace(importMarker, "import { recipeManager } from './recipes/index.js'\n" + importMarker);
  console.log("Added recipeManager import");
}

// Add routes before startWitness
const routeMarker = '  startWitness()';
if (!c.includes('/api/extensions')) {
  const routes = `
// ── Extensions API ─────────────────────────────────────────────────────────

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

// ── Recipes API ────────────────────────────────────────────────────────────

app.get('/api/recipes', requireAuth, async (req, res) => {
  try {
    const projectId = req.query.projectId as string | undefined
    const dbRecipes = await recipeManager.list(projectId)
    const builtins = recipeManager.builtins()
    res.json([...builtins, ...dbRecipes])
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.post('/api/recipes', requireAuth, async (req, res) => {
  try {
    const recipe = await recipeManager.save(req.body)
    res.json(recipe)
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

app.delete('/api/recipes/:id', requireAuth, async (req, res) => {
  try {
    await recipeManager.delete(req.params.id)
    res.json({ ok: true })
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})

// ── Provider config API ────────────────────────────────────────────────────

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
    const updates = []
    const args = []
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

`;

  c = c.replace(routeMarker, routes + '\n' + routeMarker);
  console.log("Added extension, recipe, and provider routes");
}

fs.writeFileSync(f, c);
console.log("Done");
