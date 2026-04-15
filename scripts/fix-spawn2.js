const fs = require('fs');
const f = 'server/src/index.ts';
let c = fs.readFileSync(f, 'utf8');

// Replace the entire spawnDirectAgent function header
const oldHeader = `async function spawnDirectAgent(projectId: string, taskDescription: string, userId: string): Promise<any> {
  const user = await getUserById(userId)
  if (!user?.anthropicApiKey) throw new Error('No Anthropic API key configured. Add one in Settings.')

  const setup = await setupAgentSpawn(projectId, taskDescription, userId)

  // Spawn in a separate process`;

const newHeader = `async function spawnDirectAgent(projectId: string, taskDescription: string, userId: string): Promise<any> {
  const user = await getUserById(userId)
  const provider = (user as any).provider || 'anthropic'
  const apiKey = provider === 'openai' ? (user as any).openai_api_key : provider === 'google' ? (user as any).google_api_key : user?.anthropicApiKey
  if (!apiKey && provider !== 'ollama') throw new Error('No API key configured for ' + provider + '. Add one in Settings.')

  const setup = await setupAgentSpawn(projectId, taskDescription, userId)

  // Load MCP extensions for this project
  const extensionsRes = await getDb().execute({ sql: 'SELECT * FROM extensions WHERE (project_id = ? OR project_id IS NULL) AND enabled = 1', args: [projectId] })
  const extensions = extensionsRes.rows.map((r: any) => ({ name: r.name, type: r.type, command: r.command, args: JSON.parse(r.args_json || '[]'), url: r.url, env: JSON.parse(r.env_json || '{}'), enabled: true }))

  // Spawn in a separate process`;

if (c.includes(oldHeader)) {
  c = c.replace(oldHeader, newHeader);
  console.log('Replaced spawnDirectAgent header');
} else {
  console.log('Old header not found exactly, trying partial...');
  // Try to fix just the broken parts
  if (c.includes("if (!user?.anthropicApiKey) throw new Error")) {
    c = c.replace(
      "if (!user?.anthropicApiKey) throw new Error('No Anthropic API key configured. Add one in Settings.')",
      "const provider = (user as any).provider || 'anthropic'\n  const apiKey = provider === 'openai' ? (user as any).openai_api_key : provider === 'google' ? (user as any).google_api_key : user?.anthropicApiKey\n  if (!apiKey && provider !== 'ollama') throw new Error('No API key configured for ' + provider + '. Add one in Settings.')"
    );
    console.log('Fixed API key check');
  }
  
  // Add extensions query before spawn if not present
  if (!c.includes('SELECT * FROM extensions WHERE')) {
    c = c.replace(
      "  // Spawn in a separate process",
      "  // Load MCP extensions for this project\n  const extensionsRes = await getDb().execute({ sql: 'SELECT * FROM extensions WHERE (project_id = ? OR project_id IS NULL) AND enabled = 1', args: [projectId] })\n  const extensions = extensionsRes.rows.map((r: any) => ({ name: r.name, type: r.type, command: r.command, args: JSON.parse(r.args_json || '[]'), url: r.url, env: JSON.parse(r.env_json || '{}'), enabled: true }))\n\n  // Spawn in a separate process"
    );
    console.log('Added extensions query');
  }
}

fs.writeFileSync(f, c);
console.log('Done');
