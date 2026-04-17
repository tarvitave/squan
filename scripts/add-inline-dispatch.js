const fs = require('fs')
const f = 'client/src/components/Sidebar/index.tsx'
let c = fs.readFileSync(f, 'utf8')

// Add Send icon to imports
c = c.replace('Cpu, Zap,', 'Cpu, Zap, Send, Maximize2,')

// Add inline dispatch state after showModelPicker
c = c.replace(
  "const [showModelPicker, setShowModelPicker] = useState(false)",
  `const [showModelPicker, setShowModelPicker] = useState(false)
  const [showInlineDispatch, setShowInlineDispatch] = useState(false)
  const [dispatchTask, setDispatchTask] = useState('')
  const [dispatchRole, setDispatchRole] = useState('coder')
  const [dispatching, setDispatching] = useState(false)
  const [showDispatchModal, setShowDispatchModal] = useState(false)
  const [dispatchSkill, setDispatchSkill] = useState('')`
)

// Add dispatch function after closeAddProject
const dispatchFn = `
  const dispatchAgent = async (task: string, role: string, skill?: string) => {
    if (!task.trim() || !activeProjectId) return
    setDispatching(true)
    try {
      const body: any = { task: task.trim(), role }
      if (skill) body.skill = skill
      const res = await apiFetch(\`/api/projects/\${activeProjectId}/dispatch\`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        useStore.getState().addToast(\`Agent dispatched: \${data.workerBeeName || 'new agent'}\`, 'info')
        setDispatchTask('')
        setShowInlineDispatch(false)
        setShowDispatchModal(false)
        // Refresh agents
        const wbRes = await apiFetch('/api/workerbees')
        if (wbRes.ok) {
          const wb = await wbRes.json()
          useStore.getState().setAgents(wb.map((p: any) => ({
            id: p.id, name: p.name, projectId: p.projectId, role: p.role ?? 'coder',
            status: p.status, sessionId: p.sessionId, taskDescription: p.taskDescription ?? '',
            completionNote: p.completionNote ?? '', worktreePath: p.worktreePath ?? '', branch: p.branch ?? '',
          })))
        }
        const rtRes = await apiFetch('/api/release-trains')
        if (rtRes.ok) useStore.getState().setReleaseTrains(await rtRes.json())
        // Switch to agents view
        useStore.getState().setMainView('terminals')
      } else {
        const err = await res.json()
        useStore.getState().addToast(err.error || 'Dispatch failed')
      }
    } catch (e) {
      useStore.getState().addToast('Dispatch failed')
    }
    setDispatching(false)
  }
`
c = c.replace(
  '  const closeAddProject = () => {',
  dispatchFn + '\n  const closeAddProject = () => {'
)

// Now add the + button next to the Agents header refresh button
// Find the RefreshCw button and add a + button before it
c = c.replace(
  `{activeCount > 0 && <span style={{ fontSize: 11, color: '#13bbaf', fontWeight: 500 }}>{activeCount} active</span>}`,
  `{activeCount > 0 && <span style={{ fontSize: 11, color: '#13bbaf', fontWeight: 500 }}>{activeCount} active</span>}
          {activeProjectId && (
            <button
              onClick={() => setShowInlineDispatch(!showInlineDispatch)}
              title="Quick dispatch agent"
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: showInlineDispatch ? '#13bbaf' : '#a7b0b9', padding: 2, display: 'flex', alignItems: 'center' }}
              onMouseOver={(e) => (e.currentTarget.style.color = '#13bbaf')}
              onMouseOut={(e) => (e.currentTarget.style.color = showInlineDispatch ? '#13bbaf' : '#a7b0b9')}
            >
              <Plus style={{ width: 13, height: 13 }} />
            </button>
          )}`
)

// Add inline dispatch form after the agents header (after the RefreshCw button's closing </button>)
// Find the agent list container and insert before it
const agentListStart = `<div style={{ borderRadius: 8, border: '1px solid #e3e6ea', backgroundColor: '#ffffff', overflow: 'hidden' }}>`
const inlineForm = `{/* Inline dispatch form */}
        {showInlineDispatch && activeProjectId && (
          <div style={{ margin: '4px 0 6px', padding: '8px 10px', borderRadius: 8, border: '1px solid #13bbaf40', backgroundColor: '#13bbaf08' }}>
            <div style={{ position: 'relative' }}>
              <textarea
                value={dispatchTask}
                onChange={(e) => setDispatchTask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); dispatchAgent(dispatchTask, dispatchRole) }
                  if (e.key === 'Escape') { setShowInlineDispatch(false); setDispatchTask('') }
                }}
                placeholder="Describe task for agent..."
                autoFocus
                style={{ width: '100%', padding: '6px 8px', paddingRight: 56, fontSize: 12, border: '1px solid #e3e6ea', borderRadius: 6, outline: 'none', resize: 'none', minHeight: 36, maxHeight: 80, fontFamily: 'inherit', color: '#3f434b', backgroundColor: '#ffffff', boxSizing: 'border-box' }}
              />
              <div style={{ position: 'absolute', right: 4, top: 4, display: 'flex', gap: 2 }}>
                <button
                  onClick={() => { setShowDispatchModal(true); setShowInlineDispatch(false) }}
                  title="Expand to full editor"
                  style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid #e3e6ea', backgroundColor: '#ffffff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a7b0b9', padding: 0 }}
                  onMouseOver={(e) => (e.currentTarget.style.color = '#13bbaf')}
                  onMouseOut={(e) => (e.currentTarget.style.color = '#a7b0b9')}
                >
                  <Maximize2 style={{ width: 10, height: 10 }} />
                </button>
                <button
                  onClick={() => dispatchAgent(dispatchTask, dispatchRole)}
                  disabled={!dispatchTask.trim() || dispatching}
                  title="Dispatch agent (Enter)"
                  style={{ width: 22, height: 22, borderRadius: 4, border: 'none', backgroundColor: dispatchTask.trim() ? '#13bbaf' : '#e3e6ea', cursor: dispatchTask.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', padding: 0 }}
                >
                  {dispatching ? <Loader2 style={{ width: 10, height: 10, animation: 'spin 1s linear infinite' }} /> : <Send style={{ width: 10, height: 10 }} />}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, fontSize: 10, color: '#a7b0b9' }}>
              <span>Enter to send</span>
              <span style={{ margin: '0 2px' }}>·</span>
              <span>Shift+Enter for newline</span>
              <span style={{ margin: '0 2px' }}>·</span>
              <span>Esc to cancel</span>
            </div>
          </div>
        )}
        `

if (c.includes(agentListStart)) {
  c = c.replace(agentListStart, inlineForm + agentListStart)
  console.log('Added inline dispatch form')
}

// Add the expanded dispatch modal before the closing </div> of the Sidebar
// Find the last closing tags of the component
const modalJsx = `
      {/* Dispatch Agent Modal */}
      {showDispatchModal && activeProjectId && (
        <>
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000 }} onClick={() => setShowDispatchModal(false)} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 1001,
            width: 520, maxWidth: '90vw', backgroundColor: '#ffffff', borderRadius: 12,
            boxShadow: '0 20px 60px rgba(0,0,0,0.15)', overflow: 'hidden',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #e3e6ea' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#3f434b' }}>Dispatch Agent</div>
                <div style={{ fontSize: 12, color: '#a7b0b9', marginTop: 2 }}>{activeProject?.name || 'Current project'}</div>
              </div>
              <button onClick={() => setShowDispatchModal(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#a7b0b9', padding: 4 }}>
                <X style={{ width: 18, height: 18 }} />
              </button>
            </div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: '#878787', display: 'block', marginBottom: 4 }}>Task description</label>
                <textarea
                  value={dispatchTask}
                  onChange={(e) => setDispatchTask(e.target.value)}
                  placeholder="Describe what the agent should do..."
                  autoFocus
                  rows={5}
                  style={{ width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid #e3e6ea', borderRadius: 8, outline: 'none', resize: 'vertical', minHeight: 100, fontFamily: 'inherit', color: '#3f434b', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#878787', display: 'block', marginBottom: 4 }}>Role</label>
                  <select value={dispatchRole} onChange={(e) => setDispatchRole(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #e3e6ea', borderRadius: 6, outline: 'none', color: '#3f434b', backgroundColor: '#ffffff', cursor: 'pointer' }}>
                    <option value="coder">Coder</option>
                    <option value="tester">Tester</option>
                    <option value="reviewer">Reviewer</option>
                    <option value="devops">DevOps</option>
                    <option value="lead">Lead</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#878787', display: 'block', marginBottom: 4 }}>Skill (optional)</label>
                  <select value={dispatchSkill} onChange={(e) => setDispatchSkill(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #e3e6ea', borderRadius: 6, outline: 'none', color: '#3f434b', backgroundColor: '#ffffff', cursor: 'pointer' }}>
                    <option value="">None (custom task)</option>
                    <option value="test-fix-pr">Test → Fix → PR</option>
                    <option value="review-refactor">Review → Refactor</option>
                    <option value="generate-docs">Generate Docs</option>
                    <option value="security-audit">Security Audit</option>
                  </select>
                </div>
              </div>
              <button
                onClick={() => dispatchAgent(dispatchTask, dispatchRole, dispatchSkill || undefined)}
                disabled={!dispatchTask.trim() || dispatching}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '10px 16px', fontSize: 14, fontWeight: 500, border: 'none', borderRadius: 8,
                  cursor: !dispatchTask.trim() || dispatching ? 'not-allowed' : 'pointer',
                  backgroundColor: '#13bbaf', color: '#ffffff', opacity: !dispatchTask.trim() || dispatching ? 0.5 : 1,
                }}>
                {dispatching ? <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> : <Send style={{ width: 16, height: 16 }} />}
                {dispatching ? 'Dispatching...' : 'Dispatch Agent'}
              </button>
            </div>
          </div>
        </>
      )}
`

// Insert before the last closing </div> of the component
const lastDiv = c.lastIndexOf('    </div>\n  )\n}')
if (lastDiv > 0) {
  c = c.slice(0, lastDiv) + modalJsx + '\n' + c.slice(lastDiv)
  console.log('Added dispatch modal')
} else {
  // Try alternate pattern
  const alt = c.lastIndexOf('    </div>')
  if (alt > 0) {
    c = c.slice(0, alt) + modalJsx + '\n' + c.slice(alt)
    console.log('Added dispatch modal (alt)')
  }
}

fs.writeFileSync(f, c)
console.log('File written:', c.split('\n').length, 'lines')
