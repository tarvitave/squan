const fs = require('fs')
const f = 'client/src/App.tsx'
let c = fs.readFileSync(f, 'utf8')

// Replace the Terminal tab button with nothing — remove the fallback
c = c.replace(
  `{/* Fallback to terminal tab */}
        {activeTab && (
          <button
            onClick={() => setSelectedAgentId(null)}
            className={\`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors shrink-0 \${
              selectedAgentId === null
                ? 'bg-bg-primary text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-primary/50'
            }\`}
          >
            <TerminalIcon className="w-3 h-3" />
            Terminal
          </button>
        )}`,
  `{/* All agents shown above */}`
)

// Replace the PaneGrid fallback with a helpful empty state
c = c.replace(
  `        ) : activeTab ? (
          <PaneGrid tab={activeTab} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-tertiary">
            <p>Select an agent above</p>
          </div>`,
  `        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-text-tertiary p-8">
            <Bot className="w-10 h-10 opacity-30" />
            <p className="text-sm">Select an agent above to view its conversation</p>
            <p className="text-xs opacity-50">Or dispatch a new agent from the sidebar [+] button</p>
          </div>`
)

fs.writeFileSync(f, c)
console.log('Fixed terminal fallback')
