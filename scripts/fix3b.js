const fs = require('fs')
const f = 'client/src/components/Sidebar/index.tsx'
let c = fs.readFileSync(f, 'utf8')

// Normalize line endings for matching
c = c.replace(/\r\n/g, '\n')

let changes = 0

// FIX 1: Add toast after init-squan line
const initLine = "try { await apiFetch(`/api/projects/${newRig.id}/init-squan`, { method: 'POST' }) } catch {}"
const closeLine = "      closeAddProject()"
const target1 = initLine + '\n' + closeLine
const replace1 = initLine + '\n      useStore.getState().addToast(`Project "${name}" added`, \'info\')\n' + closeLine
if (c.includes(target1)) { c = c.replace(target1, replace1); changes++; console.log('Fix 1: toast on add') }
else console.log('Fix 1: NOT FOUND')

// FIX 2a: repoUrl in selector button
const old2a = "{activeProject.localPath.split(/[/\\\\]/).slice(-2).join('/')}"
const new2a = "{activeProject.repoUrl ? activeProject.repoUrl.replace(/^https?:\\/\\/github\\.com\\//, '').replace(/\\.git$/, '') : activeProject.localPath.split(/[/\\\\]/).slice(-2).join('/')}"
if (c.includes(old2a)) { c = c.replace(old2a, new2a); changes++; console.log('Fix 2a: repoUrl in selector') }
else console.log('Fix 2a: NOT FOUND')

// FIX 2b: repoUrl in dropdown
const old2b = "{rig.localPath.split(/[/\\\\]/).slice(-2).join('/')}"
const new2b = "{rig.repoUrl ? rig.repoUrl.replace(/^https?:\\/\\/github\\.com\\//, '').replace(/\\.git$/, '') : rig.localPath.split(/[/\\\\]/).slice(-2).join('/')}"
if (c.includes(old2b)) { c = c.replace(old2b, new2b); changes++; console.log('Fix 2b: repoUrl in dropdown') }
else console.log('Fix 2b: NOT FOUND')

// FIX 3c: Model bar - find the Settings button and add model picker before it
// Find by unique pattern
const settingsPattern = 'onClick={() => setShowPreferences(true)}\n'
const settingsIdx = c.lastIndexOf(settingsPattern)
if (settingsIdx > 0) {
  // Go back to find the <button before it
  const btnIdx = c.lastIndexOf('<button', settingsIdx)
  // Insert model bar before the button
  const modelBar = `{/* Model selector */}
        <div style={{ position: 'relative', marginBottom: 4 }}>
          <button onClick={() => setShowModelPicker(!showModelPicker)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 10px', borderRadius: 6, fontSize: 12, border: '1px solid #e3e6ea', cursor: 'pointer', backgroundColor: '#ffffff', color: '#3f434b', textAlign: 'left' }}
            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#f4f6f7')}
            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#ffffff')}>
            <Cpu style={{ width: 14, height: 14, color: '#13bbaf', flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
              {currentModel.replace('claude-', '').replace('gpt-', 'GPT-').replace(/-\\d{8}$/, '')}
            </span>
            {sessionCost > 0 && <span style={{ fontSize: 10, color: '#13bbaf', fontWeight: 500, flexShrink: 0 }}>\${sessionCost.toFixed(2)}</span>}
            <ChevronDown style={{ width: 12, height: 12, color: '#a7b0b9', flexShrink: 0, transform: showModelPicker ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
          </button>
          {showModelPicker && (<>
            <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowModelPicker(false)} />
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: '100%', marginBottom: 4, zIndex: 50, backgroundColor: '#ffffff', border: '1px solid #e3e6ea', borderRadius: 8, boxShadow: '0 -4px 12px rgba(0,0,0,0.08)', overflow: 'hidden', maxHeight: 400, overflowY: 'auto' }}>
              <div style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: '#a7b0b9', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #e3e6ea' }}>Select Model</div>
              {[
                { g: 'Anthropic', m: [{ id: 'claude-sonnet-4-20250514', n: 'Claude Sonnet 4', b: 'Recommended' }, { id: 'claude-opus-4-20250514', n: 'Claude Opus 4', b: 'Most capable' }, { id: 'claude-3-5-haiku-20241022', n: 'Claude Haiku', b: 'Fastest' }] },
                { g: 'OpenAI', m: [{ id: 'gpt-4o', n: 'GPT-4o', b: '' }, { id: 'gpt-4o-mini', n: 'GPT-4o Mini', b: 'Cheapest' }, { id: 'o3', n: 'o3', b: 'Reasoning' }] },
                { g: 'Google', m: [{ id: 'gemini-1.5-flash', n: 'Gemini Flash', b: 'Fast' }, { id: 'gemini-1.5-pro', n: 'Gemini Pro', b: '' }] },
                { g: 'Local', m: [{ id: 'llama3', n: 'Llama 3 (Ollama)', b: 'Free' }, { id: 'codellama', n: 'Code Llama', b: 'Free' }] },
              ].map(({ g, m: models }) => (
                <div key={g}>
                  <div style={{ padding: '4px 10px', fontSize: 10, fontWeight: 600, color: '#a7b0b9', textTransform: 'uppercase', backgroundColor: '#f9fafb' }}>{g}</div>
                  {models.map((mo) => (
                    <button key={mo.id} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 10px', fontSize: 12, border: 'none', cursor: 'pointer', textAlign: 'left', backgroundColor: currentModel === mo.id ? '#f0fdf9' : '#fff', color: currentModel === mo.id ? '#13bbaf' : '#3f434b', fontWeight: currentModel === mo.id ? 500 : 400 }}
                      onMouseOver={(e) => { if (currentModel !== mo.id) e.currentTarget.style.backgroundColor = '#f4f6f7' }}
                      onMouseOut={(e) => { e.currentTarget.style.backgroundColor = currentModel === mo.id ? '#f0fdf9' : '#fff' }}
                      onClick={async () => { setCurrentModel(mo.id); setShowModelPicker(false); try { await apiFetch('/api/user/provider', { method: 'PUT', body: JSON.stringify({ model: mo.id }) }); useStore.getState().addToast('Model: ' + mo.n, 'info') } catch {} }}>
                      {currentModel === mo.id && <Zap style={{ width: 10, height: 10, color: '#13bbaf', flexShrink: 0 }} />}
                      <span style={{ flex: 1 }}>{mo.n}</span>
                      {mo.b && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 8, backgroundColor: '#f4f6f7', color: '#a7b0b9' }}>{mo.b}</span>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </>)}
        </div>
        `
  c = c.slice(0, btnIdx) + modelBar + c.slice(btnIdx)
  changes++
  console.log('Fix 3c: model bar added')
} else console.log('Fix 3c: settings button NOT FOUND')

// Write with CRLF for Windows
c = c.replace(/\n/g, '\r\n')
fs.writeFileSync(f, c)
console.log(`\nTotal: ${changes} fixes applied, ${c.split('\r\n').length} lines`)
