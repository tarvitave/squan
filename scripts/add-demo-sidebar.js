const fs = require('fs');
const f = 'client/src/components/Sidebar/index.tsx';
let c = fs.readFileSync(f, 'utf8');

// Add icons to import
c = c.replace(
  'GitBranch, Search, Lock, Globe, ChevronRight, RefreshCw,',
  'GitBranch, Search, Lock, Globe, ChevronRight, RefreshCw, Play, RotateCcw,'
);
console.log('Added icons');

// Add demo state after existing state declarations — find the 'const [showAddProject' line
const stateMarker = 'const [showAddProject';
const idx = c.indexOf(stateMarker);
if (idx !== -1) {
  const lineEnd = c.indexOf('\n', idx);
  c = c.slice(0, lineEnd + 1) + 
    '  const [demoLoading, setDemoLoading] = useState(false)\n' +
    '  const [demoLoaded, setDemoLoaded] = useState(false)\n' +
    c.slice(lineEnd + 1);
  console.log('Added demo state');
}

// Add demo buttons before Settings section
const settingsMarker = "      {/* \u2500\u2500 Settings";
const settingsIdx = c.indexOf(settingsMarker);
if (settingsIdx === -1) {
  // Try simpler marker
  const alt = "borderTop: '1px solid #e3e6ea', padding: 8, flexShrink: 0";
  const altIdx = c.indexOf(alt);
  if (altIdx !== -1) {
    // Go back to find the <div> start before settings
    const divStart = c.lastIndexOf('<div style={{', altIdx);
    // Find the comment before that
    const commentStart = c.lastIndexOf('{/*', divStart);
    
    const demoButtons = `      {/* Demo controls */}
      <div style={{ padding: '4px 8px', flexShrink: 0 }}>
        <div style={{ borderTop: '1px solid #e3e6ea', paddingTop: 8, marginBottom: 4 }}>
          {!demoLoaded ? (
            <button
              onClick={async () => {
                setDemoLoading(true)
                try {
                  const res = await apiFetch('/api/demo/load', { method: 'POST' })
                  const data = await res.json()
                  if (data.projectId) {
                    setDemoLoaded(true)
                    useStore.getState().addToast('Demo loaded: ' + data.agents + ' agents, ' + data.releaseTrains + ' tasks', 'info')
                    // Refresh data
                    const [wbRes, rtRes, rigRes] = await Promise.all([apiFetch('/api/workerbees'), apiFetch('/api/release-trains'), apiFetch('/api/rigs')])
                    if (wbRes.ok) { const wb = await wbRes.json(); useStore.getState().setAgents(wb.map((p) => ({ id: p.id, name: p.name, projectId: p.projectId, role: p.role || 'coder', status: p.status, sessionId: p.sessionId, taskDescription: p.taskDescription || '', completionNote: p.completionNote || '', worktreePath: p.worktreePath || '', branch: p.branch || '' }))) }
                    if (rtRes.ok) useStore.getState().setReleaseTrains(await rtRes.json())
                    if (rigRes.ok) useStore.getState().setRigs(await rigRes.json())
                  }
                } catch (e) { useStore.getState().addToast('Failed to load demo') }
                setDemoLoading(false)
              }}
              disabled={demoLoading}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500, border: '1px dashed #13bbaf50', cursor: 'pointer', backgroundColor: '#13bbaf08', color: '#13bbaf' }}
            >
              <Play style={{ width: 14, height: 14 }} />
              {demoLoading ? 'Loading demo...' : 'Load Demo Project'}
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={async () => {
                  setDemoLoading(true)
                  try {
                    await apiFetch('/api/demo/reset', { method: 'POST' })
                    await apiFetch('/api/demo/load', { method: 'POST' })
                    useStore.getState().addToast('Demo reset to initial state', 'info')
                    const [wbRes, rtRes] = await Promise.all([apiFetch('/api/workerbees'), apiFetch('/api/release-trains')])
                    if (wbRes.ok) { const wb = await wbRes.json(); useStore.getState().setAgents(wb.map((p) => ({ id: p.id, name: p.name, projectId: p.projectId, role: p.role || 'coder', status: p.status, sessionId: p.sessionId, taskDescription: p.taskDescription || '', completionNote: p.completionNote || '', worktreePath: p.worktreePath || '', branch: p.branch || '' }))) }
                    if (rtRes.ok) useStore.getState().setReleaseTrains(await rtRes.json())
                  } catch { useStore.getState().addToast('Failed to reset demo') }
                  setDemoLoading(false)
                }}
                disabled={demoLoading}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, fontSize: 11, fontWeight: 500, border: '1px solid #e3e6ea', cursor: 'pointer', backgroundColor: 'transparent', color: '#878787' }}
              >
                <RotateCcw style={{ width: 12, height: 12 }} /> Reset Demo
              </button>
              <button
                onClick={async () => {
                  setDemoLoading(true)
                  try {
                    await apiFetch('/api/demo/reset', { method: 'POST' })
                    setDemoLoaded(false)
                    useStore.getState().addToast('Demo removed', 'info')
                    const [wbRes, rtRes, rigRes] = await Promise.all([apiFetch('/api/workerbees'), apiFetch('/api/release-trains'), apiFetch('/api/rigs')])
                    if (wbRes.ok) { const wb = await wbRes.json(); useStore.getState().setAgents(wb.map((p) => ({ id: p.id, name: p.name, projectId: p.projectId, role: p.role || 'coder', status: p.status, sessionId: p.sessionId, taskDescription: p.taskDescription || '', completionNote: p.completionNote || '', worktreePath: p.worktreePath || '', branch: p.branch || '' }))) }
                    if (rtRes.ok) useStore.getState().setReleaseTrains(await rtRes.json())
                    if (rigRes.ok) useStore.getState().setRigs(await rigRes.json())
                  } catch { useStore.getState().addToast('Failed to remove demo') }
                  setDemoLoading(false)
                }}
                disabled={demoLoading}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, fontSize: 11, fontWeight: 500, border: '1px solid #e3e6ea', cursor: 'pointer', backgroundColor: 'transparent', color: '#e74c3c' }}
              >
                Remove
              </button>
            </div>
          )}
        </div>
      </div>
`;

    c = c.slice(0, commentStart) + demoButtons + c.slice(commentStart);
    console.log('Added demo buttons');
  } else {
    console.log('Could not find settings section');
  }
} else {
  console.log('Found settings marker directly');
}

fs.writeFileSync(f, c);
console.log('Done');
