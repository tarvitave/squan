const fs = require('fs')
const f = 'server/src/index.ts'
let c = fs.readFileSync(f, 'utf8')
c = c.replace(
  "const rig = db.prepare('SELECT local_path FROM rigs WHERE id = ?').get(rigId) as any",
  "const rig = (db as any).prepare('SELECT local_path FROM rigs WHERE id = ?').get(rigId) as any"
)
fs.writeFileSync(f, c)
console.log('Fixed db cast')
