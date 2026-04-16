const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, '..', 'client', 'src', 'components', 'Sidebar', 'index.tsx')
let content = fs.readFileSync(file, 'utf8')

// === FIX 1: Add toast + ensure modal closes on addProject success ===
// Replace the addProject success path to add a toast
content = content.replace(
  `try { await apiFetch(\`/api/projects/\${newRig.id}/init-squan\`, { method: 'POST' }) } catch {}
      closeAddProject()`,
  `try { await apiFetch(\`/api/projects/\${newRig.id}/init-squan\`, { method: 'POST' }) } catch {}
      useStore.getState().addToast(\`Project "\${name}" added successfully\`, 'info')
      closeAddProject()`
)

// === FIX 2: Show repo URL in project selector ===
// In the project selector button, show repoUrl instead of localPath
content = content.replace(
  `{activeProject && (
              <div style={{ fontSize: 11, color: '#a7b0b9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeProject.localPath.split(/[/\\\\]/).slice(-2).join('/')}
              </div>
            )}`,
  `{activeProject && (
              <div style={{ fontSize: 11, color: '#a7b0b9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={activeProject.repoUrl || activeProject.localPath}>
                {activeProject.repoUrl
                  ? activeProject.repoUrl.replace(/^https?:\\/\\/github\\.com\\//, '').replace(/\\.git$/, '')
                  : activeProject.localPath.split(/[/\\\\]/).slice(-2).join('/')}
              </div>
            )}`
)

// In the dropdown list, show repo URL for each rig
content = content.replace(
  `<div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rig.name}</div>
                    <div style={{ fontSize: 11, color: '#a7b0b9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rig.localPath.split(/[/\\\\]/).slice(-2).join('/')}</div>`,
  `<div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rig.name}</div>
                    <div style={{ fontSize: 11, color: '#a7b0b9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={rig.repoUrl || rig.localPath}>
                      {rig.repoUrl
                        ? rig.repoUrl.replace(/^https?:\\/\\/github\\.com\\//, '').replace(/\\.git$/, '')
                        : rig.localPath.split(/[/\\\\]/).slice(-2).join('/')}
                    </div>`
)

// === FIX 3: Add model/cost bar at the bottom ===
// Add Cpu icon to imports
content = content.replace(
  `import {
  Settings, ChevronDown, FolderGit2, Plus,
  Monitor, Columns3, BarChart3, Activity,
  DollarSign, Terminal, Code2, Bot, X, Loader2,
  GitBranch, Search, Lock, Globe, ChevronRight, RefreshCw, Play, RotateCcw,
} from 'lucide-react'`,
  `import {
  Settings, ChevronDown, FolderGit2, Plus,
  Monitor, Columns3, BarChart3, Activity,
  DollarSign, Terminal, Code2, Bot, X, Loader2,
  GitBranch, Search, Lock, Globe, ChevronRight, RefreshCw, Play, RotateCcw,
  Cpu, Zap,
} from 'lucide-react'`
)

// Add model state after demoLoaded state
content = content.replace(
  `const [demoLoaded, setDemoLoaded] = useState(false)`,
  `const [demoLoaded, setDemoLoaded] = useState(false)
  const [currentModel, setCurrentModel] = useState('claude-sonnet-4-20250514')
  const [sessionCost, setSessionCost] = useState(0)
  const [showModelPicker, setShowModelPicker] = useState(false)`
)

// Add effect to load provider config and session cost
content = content.replace(
  `useEffect(() => {
    apiFetch('/api/rigs?all=true')`,
  `// Load provider config
  useEffect(() => {
    apiFetch('/api/user/provider').then(r => r.ok ? r.json() : null).then(data => {
      if (data?.model) setCurrentModel(data.model)
    }).catch(() => {})
    // Calculate total session cost from agents
    const totalCost = agents.reduce((sum, a) => {
      const match = (a.completionNote || '').match(/\\$(\\d+\\.\\d+)/)
      return sum + (match ? parseFloat(match[1]) : 0)
    }, 0)
    setSessionCost(totalCost)
  }, [agents])

  useEffect(() => {
    apiFetch('/api/rigs?all=true')`
)

// Replace the Settings section at the bottom with model bar + settings
const settingsSection = `{/* Settings */}
      <div style={{ borderTop: '1px solid #e3e6ea', padding: 8, flexShrink: 0 }}>
        <button
          onClick={() => setShowPreferences(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '7px 12px', borderRadius: 8, fontSize: 13, border: 'none', cursor: 'pointer', textAlign: 'left', backgroundColor: 'transparent', color: '#878787' }}
        >
          <Settings style={{ width: 18, height: 18, flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email ?? 'Settings'}</span>
        </button>
      </div>`

const newBottomBar = `{/* Model + Cost + Settings bar */}
      <div style={{ borderTop: '1px solid #e3e6ea', padding: '6px 8px', flexShrink: 0 }}>
        {/* Model selector */}
        <div style={{ position: 'relative', marginBottom: 4 }}>
          <button
            onClick={() => setShowModelPicker(!showModelPicker)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 10px',
              borderRadius: 6, fontSize: 12, border: '1px solid #e3e6ea', cursor: 'pointer',
              backgroundColor: '#ffffff', color: '#3f434b', textAlign: 'left',
            }}
            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#f4f6f7')}
            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#ffffff')}
          >
            <Cpu style={{ width: 14, height: 14, color: '#13bbaf', flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentModel.replace('claude-', '').replace('gpt-', 'GPT-').replace(/-\\d{8}$/, '')}
            </span>
            {sessionCost > 0 && (
              <span style={{ fontSize: 11, color: '#13bbaf', fontWeight: 500, flexShrink: 0 }}>
                \${sessionCost.toFixed(2)}
              </span>
            )}
            <ChevronDown style={{ width: 12, height: 12, color: '#a7b0b9', flexShrink: 0, transform: showModelPicker ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
          </button>

          {showModelPicker && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowModelPicker(false)} />
              <div style={{
                position: 'absolute', left: 0, right: 0, bottom: '100%', marginBottom: 4, zIndex: 50,
                backgroundColor: '#ffffff', border: '1px solid #e3e6ea', borderRadius: 8,
                boxShadow: '0 -4px 12px rgba(0,0,0,0.08)', overflow: 'hidden',
              }}>
                <div style={{ padding: '8px 10px', borderBottom: '1px solid #e3e6ea', fontSize: 11, fontWeight: 500, color: '#a7b0b9', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Select Model
                </div>
                {[
                  { group: 'Anthropic', models: [
                    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', badge: 'Recommended' },
                    { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', badge: 'Most capable' },
                    { id: 'claude-3-5-haiku-20241022', name: 'Claude Haiku', badge: 'Fastest' },
                  ]},
                  { group: 'OpenAI', models: [
                    { id: 'gpt-4o', name: 'GPT-4o', badge: '' },
                    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', badge: 'Cheapest' },
                    { id: 'o3', name: 'o3', badge: 'Reasoning' },
                  ]},
                  { group: 'Google', models: [
                    { id: 'gemini-1.5-flash', name: 'Gemini Flash', badge: 'Fast' },
                    { id: 'gemini-1.5-pro', name: 'Gemini Pro', badge: '' },
                  ]},
                  { group: 'Local', models: [
                    { id: 'llama3', name: 'Llama 3 (Ollama)', badge: 'Free' },
                    { id: 'codellama', name: 'Code Llama (Ollama)', badge: 'Free' },
                  ]},
                ].map(({ group, models }) => (
                  <div key={group}>
                    <div style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: '#a7b0b9', textTransform: 'uppercase', letterSpacing: '0.05em', backgroundColor: '#f9fafb' }}>
                      {group}
                    </div>
                    {models.map((m) => (
                      <button key={m.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px',
                          fontSize: 12, border: 'none', cursor: 'pointer', textAlign: 'left',
                          backgroundColor: currentModel === m.id ? '#f0fdf9' : '#ffffff',
                          color: currentModel === m.id ? '#13bbaf' : '#3f434b',
                          fontWeight: currentModel === m.id ? 500 : 400,
                        }}
                        onMouseOver={(e) => { if (currentModel !== m.id) e.currentTarget.style.backgroundColor = '#f4f6f7' }}
                        onMouseOut={(e) => { e.currentTarget.style.backgroundColor = currentModel === m.id ? '#f0fdf9' : '#ffffff' }}
                        onClick={async () => {
                          setCurrentModel(m.id)
                          setShowModelPicker(false)
                          try {
                            await apiFetch('/api/user/provider', {
                              method: 'PUT',
                              body: JSON.stringify({ model: m.id }),
                            })
                            useStore.getState().addToast(\`Model: \${m.name}\`, 'info')
                          } catch {}
                        }}
                      >
                        {currentModel === m.id && <Zap style={{ width: 12, height: 12, color: '#13bbaf', flexShrink: 0 }} />}
                        <span style={{ flex: 1 }}>{m.name}</span>
                        {m.badge && (
                          <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, backgroundColor: currentModel === m.id ? '#13bbaf20' : '#f4f6f7', color: currentModel === m.id ? '#13bbaf' : '#a7b0b9' }}>
                            {m.badge}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Settings button */}
        <button
          onClick={() => setShowPreferences(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '6px 10px', borderRadius: 6, fontSize: 12, border: 'none', cursor: 'pointer', textAlign: 'left', backgroundColor: 'transparent', color: '#878787' }}
          onMouseOver={(e) => (e.currentTarget.style.color = '#3f434b')}
          onMouseOut={(e) => (e.currentTarget.style.color = '#878787')}
        >
          <Settings style={{ width: 14, height: 14, flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email ?? 'Settings'}</span>
        </button>
      </div>`

// Find and replace the settings section
// The settings comment has Unicode box-drawing chars, so match by the button content
const settingsIdx = content.lastIndexOf('setShowPreferences(true)')
if (settingsIdx === -1) {
  console.error('Could not find Settings section')
  process.exit(1)
}
// Find the containing div — go back to find borderTop
const searchBack = content.lastIndexOf('borderTop:', settingsIdx)
const divStart = content.lastIndexOf('<div', searchBack)
// Find closing </div> after setShowPreferences
const afterSettings = content.indexOf('</div>', settingsIdx)
const closingDiv = content.indexOf('</div>', afterSettings + 6) + 6

// Now find the comment before the div
const commentStart = content.lastIndexOf('{/*', divStart)

content = content.slice(0, commentStart) + newBottomBar + content.slice(closingDiv)

console.log('Fixes applied:')
console.log('  1. Toast on add project + robust close')
console.log('  2. Repo URL shown in project selector')
console.log('  3. Model/cost bar at bottom')

fs.writeFileSync(file, content)
console.log(`File written: ${content.split('\n').length} lines`)
