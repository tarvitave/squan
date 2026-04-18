const fs = require('fs')

// 1. Add 'claudecode' to MainView type in store
let store = fs.readFileSync('client/src/store/index.ts', 'utf8')
if (!store.includes('claudecode')) {
  store = store.replace("'console' | 'automations'", "'console' | 'claudecode' | 'automations'")
  fs.writeFileSync('client/src/store/index.ts', store)
  console.log('1. Added claudecode to MainView type')
} else console.log('1. Already has claudecode')

// 2. Add nav item to sidebar
let sidebar = fs.readFileSync('client/src/components/Sidebar/index.tsx', 'utf8')
if (!sidebar.includes('claudecode')) {
  sidebar = sidebar.replace(
    "{ view: 'console', icon: Terminal, label: 'Console' },",
    "{ view: 'console', icon: Terminal, label: 'Console' },\n  { view: 'claudecode' as any, icon: Code2, label: 'Claude Code' },"
  )
  fs.writeFileSync('client/src/components/Sidebar/index.tsx', sidebar)
  console.log('2. Added Claude Code nav item')
} else console.log('2. Already has nav item')

// 3. Add view routing in App.tsx
let app = fs.readFileSync('client/src/App.tsx', 'utf8')
if (!app.includes('ClaudeCodeView')) {
  // Add import
  app = app.replace(
    "import { AutomationsView } from './components/AutomationsView/index.js'",
    "import { AutomationsView } from './components/AutomationsView/index.js'\nimport { ClaudeCodeView } from './components/ClaudeCodeView/index.js'"
  )
  // Add view route - find the automations view line and add before it
  app = app.replace(
    "{mainView === 'automations' && <AutomationsView />}",
    "{mainView === 'claudecode' && <ClaudeCodeView />}\n            {mainView === 'automations' && <AutomationsView />}"
  )
  // Update keyboard shortcuts array
  app = app.replace(
    "const views: MainView[] = ['terminals', 'kanban', 'metrics', 'events', 'costs', 'console']",
    "const views: MainView[] = ['terminals', 'kanban', 'metrics', 'events', 'costs', 'console', 'claudecode', 'automations']"
  )
  fs.writeFileSync('client/src/App.tsx', app)
  console.log('3. Added ClaudeCodeView to App.tsx')
} else console.log('3. Already has ClaudeCodeView')

console.log('\nDone! Now create the component and server endpoint.')
