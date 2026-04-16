const fs = require('fs')
const path = require('path')

const replacements = [
  // Comments and descriptions — replace "Goose" with "Squan" or remove
  ['Goose-style chat renderer', 'Chat renderer'],
  ['Goose-style chat', 'agent chat'],
  ['Goose-style AgentChat UI', 'New AgentChat UI'],
  ['Goose-style chat view', 'agent chat view'],
  ['Goose-style chat windows', 'chat windows'],
  ['Goose-style layout', 'Chat layout'],
  ['Goose-style)', 'agent chat)'],
  ['(like Goose)', ''],
  ['(like Goose/Claude Code)', ''],
  ['like Goose does', 'directly'],
  ['like Goose:', 'independently:'],
  ['like Goose)', ')'],
  ['(Goose-style)', ''],
  ['Goose-style', 'agent-style'],
  ["Matches Goose's button.tsx exactly", 'Shared button component'],
  ['mode: structured (Goose-style chat)', 'mode: direct API (agent chat)'],
  ['Goose', 'Squan'],
]

const files = [
  'README.md',
  'CHANGELOG.md',
  'client/src/App.tsx',
  'client/src/components/AgentChat/index.tsx',
  'client/src/components/ConsolePanel/index.tsx',
  'client/src/components/ui/button.tsx',
  'server/src/index.ts',
  'server/src/workerbee/direct-runner.ts',
  'server/src/workerbee/process-manager.ts',
  'server/src/workerbee/spawn-setup.ts',
]

let totalChanges = 0

for (const file of files) {
  const fp = path.join(__dirname, '..', file)
  if (!fs.existsSync(fp)) { console.log(`SKIP: ${file}`); continue }
  let c = fs.readFileSync(fp, 'utf8')
  let changes = 0
  for (const [from, to] of replacements) {
    const count = c.split(from).length - 1
    if (count > 0) {
      c = c.split(from).join(to)
      changes += count
    }
  }
  if (changes > 0) {
    fs.writeFileSync(fp, c)
    console.log(`${file}: ${changes} replacements`)
    totalChanges += changes
  }
}

console.log(`\nTotal: ${totalChanges} replacements`)
