const fs = require('fs');
const f = 'server/src/index.ts';
let c = fs.readFileSync(f, 'utf8');

const marker = 'apiKey: user.anthropicApiKey,';
const idx = c.indexOf(marker);
if (idx === -1) {
  console.log('marker not found - checking if already updated');
  console.log('has apiKey: apiKey:', c.includes("apiKey: apiKey"));
  process.exit(0);
}

const spawnStart = c.lastIndexOf('processManager.spawn({', idx);
const spawnEnd = c.indexOf('})', idx) + 2;
console.log('Replacing spawn block from index', spawnStart, 'to', spawnEnd);
console.log('Old:', c.slice(spawnStart, spawnEnd));

const newSpawn = [
  'processManager.spawn({',
  '    id: setup.id,',
  '    name: setup.name,',
  '    cwd: setup.worktreePath,',
  '    task: taskDescription,',
  "    apiKey: apiKey || '',",
  '    provider: provider,',
  '    providerUrl: (user as any).provider_url || undefined,',
  '    model: (user as any).provider_model || undefined,',
  '    extensions: extensions.length > 0 ? extensions : undefined,',
  '  })',
].join('\n');

c = c.slice(0, spawnStart) + newSpawn + c.slice(spawnEnd);
fs.writeFileSync(f, c);
console.log('Done - updated spawn call');
