const fs = require('fs')
const f = 'server/src/index.ts'
let c = fs.readFileSync(f, 'utf8')

// Extract the claude terminal routes block
const routeStart = c.indexOf("// ── Claude Code Terminal")
if (routeStart < 0) { console.log('Routes not found'); process.exit(1) }

// Find the end — after the last route's closing })
const sessionsRoute = c.indexOf("app.get('/api/claude-terminal/sessions'", routeStart)
const routeEnd = c.indexOf('\n\n', sessionsRoute)

const routeBlock = c.slice(routeStart, routeEnd)
console.log('Route block:', routeBlock.split('\n').length, 'lines')

// Remove routes from current position
c = c.slice(0, routeStart) + c.slice(routeEnd)

// Insert before startWitness
const startWitnessIdx = c.indexOf('  startWitness()')
c = c.slice(0, startWitnessIdx) + '\n  ' + routeBlock + '\n\n' + c.slice(startWitnessIdx)

fs.writeFileSync(f, c)
console.log('Moved routes before startWitness')
