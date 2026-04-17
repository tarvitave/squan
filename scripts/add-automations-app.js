const fs = require('fs')
const f = 'client/src/App.tsx'
let c = fs.readFileSync(f, 'utf8')

// Add import
if (!c.includes('AutomationsView')) {
  c = c.replace(
    "import { Sidebar } from './components/Sidebar/index.js'",
    "import { Sidebar } from './components/Sidebar/index.js'\nimport { AutomationsView } from './components/AutomationsView/index.js'"
  )
  console.log('Added AutomationsView import')
}

// Add view rendering - find where console view is rendered
if (!c.includes("mainView === 'automations'")) {
  c = c.replace(
    "mainView === 'console'",
    "mainView === 'automations' ? (\n                  <AutomationsView />\n                ) : mainView === 'console'"
  )
  console.log('Added automations view rendering')
}

fs.writeFileSync(f, c)
console.log('Done')
