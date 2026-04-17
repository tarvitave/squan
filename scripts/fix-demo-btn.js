const fs = require('fs')
const f = 'client/src/components/Sidebar/index.tsx'
const lines = fs.readFileSync(f, 'utf8').split('\n')

// Find line with "onClick={async () => {" after "!demoLoaded" 
let startLine = -1
for (let i = 805; i < 815; i++) {
  if (lines[i] && lines[i].includes('onClick={async () => {') && lines[i-1] && lines[i-1].includes('<button')) {
    startLine = i
    break
  }
}

if (startLine < 0) { console.error('Could not find demo onClick'); process.exit(1) }

// Find the closing of the onClick handler — look for the matching }}
let depth = 0
let endLine = startLine
for (let i = startLine; i < lines.length; i++) {
  for (const ch of lines[i]) {
    if (ch === '{') depth++
    if (ch === '}') depth--
  }
  if (depth <= 0) { endLine = i; break }
}

console.log(`Replacing lines ${startLine + 1} to ${endLine + 1}`)

// Replace with simple handler
lines.splice(startLine, endLine - startLine + 1, 
  '              onClick={() => setShowDemoConfig(true)}')

fs.writeFileSync(f, lines.join('\n'))
console.log('Replaced demo button handler')
