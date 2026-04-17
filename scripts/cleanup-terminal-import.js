const fs = require('fs')
const f = 'client/src/App.tsx'
let c = fs.readFileSync(f, 'utf8')
c = c.replace("import { Bot, Terminal as TerminalIcon } from 'lucide-react'", "import { Bot } from 'lucide-react'")
fs.writeFileSync(f, c)
console.log('Removed TerminalIcon import')
