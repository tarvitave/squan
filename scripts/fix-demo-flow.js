const fs = require('fs')
const f = 'client/src/components/Sidebar/index.tsx'
let c = fs.readFileSync(f, 'utf8')

// Add state for demo config dialog
c = c.replace(
  "const [demoLoaded, setDemoLoaded] = useState(false)",
  `const [demoLoaded, setDemoLoaded] = useState(false)
  const [showDemoConfig, setShowDemoConfig] = useState(false)
  const [demoRepoUrl, setDemoRepoUrl] = useState('')
  const [demoForking, setDemoForking] = useState(false)`
)

// Replace the Load Demo button to open config dialog instead of loading directly
const oldLoadBtn = `onClick={async () => {
                setDemoLoading(true)
                try {
                  const res = await apiFetch('/api/demo/load', { method: 'POST' })`
const newLoadBtn = `onClick={() => setShowDemoConfig(true)}`

if (c.includes(oldLoadBtn)) {
  // Find the full old handler and replace just the onClick
  const btnStart = c.indexOf(oldLoadBtn)
  // Replace entire onClick handler up to the next disabled=
  const disabledIdx = c.indexOf('disabled={demoLoading}', btnStart)
  const lineBeforeDisabled = c.lastIndexOf('\n', disabledIdx)
  // Actually, let's just replace the opening onClick
  c = c.replace(
    `onClick={async () => {\n                setDemoLoading(true)\n                try {\n                  const res = await apiFetch('/api/demo/load', { method: 'POST' })`,
    `onClick={() => setShowDemoConfig(true)}`
  )
  console.log('Replaced load demo click handler')
} else {
  console.log('Load demo click handler not found, trying alternate match')
}

// Add the demo config modal before the Settings section
// Find the Demo controls comment
const demoControlsIdx = c.indexOf('{/* Demo controls */')
if (demoControlsIdx > 0) {
  const insertPoint = c.lastIndexOf('\n', demoControlsIdx)
  
  const demoModal = `
      {/* Demo Config Modal */}
      {showDemoConfig && (
        <>
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000 }} onClick={() => setShowDemoConfig(false)} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 1001,
            width: 480, maxWidth: '90vw', backgroundColor: '#ffffff', borderRadius: 12,
            boxShadow: '0 20px 60px rgba(0,0,0,0.15)', overflow: 'hidden',
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e3e6ea' }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#3f434b' }}>Load Demo Project</div>
              <div style={{ fontSize: 12, color: '#a7b0b9', marginTop: 2 }}>Set up a finance dashboard demo with pre-configured agents and tasks</div>
            </div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ padding: '10px 12px', backgroundColor: '#f0fdf9', border: '1px solid #13bbaf30', borderRadius: 8, fontSize: 12, color: '#3f434b', lineHeight: 1.5 }}>
                <strong style={{ color: '#13bbaf' }}>How it works:</strong> The demo creates a project with 7 agents and 8 kanban tasks across all columns. You can chat with agents, mark tasks complete, and dispatch new agents — all against your own repo.
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: '#878787', display: 'block', marginBottom: 4 }}>Your GitHub repo URL</label>
                <input
                  value={demoRepoUrl}
                  onChange={(e) => setDemoRepoUrl(e.target.value)}
                  placeholder="https://github.com/you/finance-dashboard.git"
                  style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid #e3e6ea', borderRadius: 8, outline: 'none', boxSizing: 'border-box', color: '#3f434b' }}
                  autoFocus
                />
                <div style={{ fontSize: 11, color: '#a7b0b9', marginTop: 4 }}>
                  Create a repo first, or fork <a href="https://github.com/tarvitave/squan-demo-finance/fork" target="_blank" rel="noopener noreferrer" style={{ color: '#13bbaf', textDecoration: 'underline' }}>squan-demo-finance</a>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={async () => {
                    if (!demoRepoUrl.trim()) {
                      useStore.getState().addToast('Enter a repo URL first')
                      return
                    }
                    setDemoForking(true)
                    setDemoLoading(true)
                    setShowDemoConfig(false)
                    try {
                      const res = await apiFetch('/api/demo/load', {
                        method: 'POST',
                        body: JSON.stringify({ repoUrl: demoRepoUrl.trim() }),
                      })
                      const data = await res.json()
                      if (data.projectId) {
                        setDemoLoaded(true)
                        useStore.getState().addToast('Demo loaded: ' + data.agents + ' agents, ' + data.releaseTrains + ' tasks', 'info')
                        const [wbRes, rtRes, rigRes] = await Promise.all([apiFetch('/api/workerbees'), apiFetch('/api/release-trains'), apiFetch('/api/rigs')])
                        if (wbRes.ok) { const wb = await wbRes.json(); useStore.getState().setAgents(wb.map((p: any) => ({ id: p.id, name: p.name, projectId: p.projectId, role: p.role || 'coder', status: p.status, sessionId: p.sessionId, taskDescription: p.taskDescription || '', completionNote: p.completionNote || '', worktreePath: p.worktreePath || '', branch: p.branch || '' }))) }
                        if (rtRes.ok) useStore.getState().setReleaseTrains(await rtRes.json())
                        if (rigRes.ok) useStore.getState().setRigs(await rigRes.json())
                      } else {
                        useStore.getState().addToast('Demo load failed: ' + (data.error || 'unknown error'))
                      }
                    } catch (e) { useStore.getState().addToast('Failed to load demo') }
                    setDemoLoading(false)
                    setDemoForking(false)
                  }}
                  disabled={!demoRepoUrl.trim() || demoForking}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    padding: '10px 16px', fontSize: 13, fontWeight: 500, border: 'none', borderRadius: 8,
                    cursor: !demoRepoUrl.trim() || demoForking ? 'not-allowed' : 'pointer',
                    backgroundColor: '#13bbaf', color: '#ffffff', opacity: !demoRepoUrl.trim() || demoForking ? 0.5 : 1,
                  }}
                >
                  {demoForking ? 'Loading...' : 'Load Demo'}
                </button>
                <button
                  onClick={() => setShowDemoConfig(false)}
                  style={{ padding: '10px 16px', fontSize: 13, border: '1px solid #e3e6ea', borderRadius: 8, cursor: 'pointer', backgroundColor: 'transparent', color: '#878787' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>
      )}
`
  c = c.slice(0, insertPoint) + demoModal + c.slice(insertPoint)
  console.log('Added demo config modal')
}

// Now update the server seed to accept repoUrl
const sf = 'server/src/demo/seed.ts'
let s = fs.readFileSync(sf, 'utf8')

// Change loadDemo to accept repoUrl parameter
s = s.replace(
  'export async function loadDemo(db: any)',
  'export async function loadDemo(db: any, repoUrl?: string)'
)

// Replace the hardcoded repo URL
s = s.replace(
  "'https://github.com/tarvitave/squan-demo-finance.git'",
  "(repoUrl || 'https://github.com/tarvitave/squan-demo-finance.git')"
)

fs.writeFileSync(sf, s)
console.log('Updated seed to accept repoUrl')

// Update the /api/demo/load endpoint to pass repoUrl
const idxf = 'server/src/index.ts'
let idx = fs.readFileSync(idxf, 'utf8')
idx = idx.replace(
  'const result = await loadDemo(db)',
  'const { repoUrl } = req.body || {}\n    const result = await loadDemo(db, repoUrl)'
)
fs.writeFileSync(idxf, idx)
console.log('Updated demo load endpoint')

fs.writeFileSync(f, c)
console.log('Done! All changes applied')
