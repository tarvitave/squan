const fs = require('fs')
const f = 'client/src/components/Sidebar/index.tsx'
let c = fs.readFileSync(f, 'utf8')

// Add Clock icon
c = c.replace('Cpu, Zap, Send, Maximize2,', 'Cpu, Zap, Send, Maximize2, Clock,')

// Add automations nav item
c = c.replace(
  "{ view: 'console', icon: Terminal, label: 'Console' },",
  "{ view: 'console', icon: Terminal, label: 'Console' },\n  { view: 'automations' as any, icon: Clock, label: 'Automations' },"
)

fs.writeFileSync(f, c)
console.log('Added Clock icon + Automations nav item')
