import { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'
import { TemplatesPanel } from '../TemplatesPanel/index.js'
import type { Rig } from '../../store/index.js'

interface RepoSuggestion { path: string; name: string; source: 'existing' | 'detected' }

export function RigPanel() {
  const rigs = useStore((s) => s.rigs)
  const setRigs = useStore((s) => s.setRigs)
  const addPaneToTab = useStore((s) => s.addPaneToTab)
  const addTab = useStore((s) => s.addTab)
  const activeTabId = useStore((s) => s.activeTabId)
  const tabs = useStore((s) => s.tabs)
  const activeTownId = useStore((s) => s.activeTownId)
  const addToast = useStore((s) => s.addToast)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', repoUrl: '', localPath: '' })
  const [suggestions, setSuggestions] = useState<RepoSuggestion[]>([])
  const [workspacePath, setWorkspacePath] = useState('')
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  // 'choose' = picking mode vs new, 'new' = create new repo, 'existing' = pick from list, 'manual' = type path
  const [repoMode, setRepoMode] = useState<'choose' | 'new' | 'existing' | 'manual'>('choose')
  const [creating, setCreating] = useState(false)
  const [spawning, setSpawning] = useState<string | null>(null)
  const [spawnTask, setSpawnTask] = useState<{ rigId: string; taskDescription: string } | null>(null)
  const [expandedRig, setExpandedRig] = useState<string | null>(null)
  const [runtimeEdit, setRuntimeEdit] = useState<{ rigId: string; command: string; provider: string } | null>(null)

  useEffect(() => {
    const url = activeTownId ? `/api/rigs?townId=${activeTownId}` : '/api/rigs'
    apiFetch(url)
      .then((r) => r.json())
      .then(setRigs)
      .catch(() => {})
  }, [setRigs, activeTownId])

  const openForm = () => {
    setShowForm(true)
    setRepoMode('choose')
    setForm({ name: '', repoUrl: '', localPath: '' })
    setLoadingSuggestions(true)
    const url = activeTownId ? `/api/suggest-repos?townId=${activeTownId}` : '/api/suggest-repos'
    apiFetch(url)
      .then((r) => r.json())
      .then((d) => { setSuggestions(d.suggestions ?? []); setWorkspacePath(d.workspacePath ?? '') })
      .catch(() => {})
      .finally(() => setLoadingSuggestions(false))
  }

  const closeForm = () => { setShowForm(false); setRepoMode('choose') }

  const pickSuggestion = (s: RepoSuggestion) => {
    setForm((f) => ({ ...f, localPath: s.path, name: f.name || s.name }))
    setRepoMode('manual')  // re-use manual state to show confirm screen
  }

  // Derived: path that would be created for a new repo
  const newRepoPath = workspacePath && form.name
    ? `${workspacePath.replace(/[\\/]+$/, '')}/${form.name.toLowerCase().replace(/\s+/g, '-')}`
    : ''

  const handleAdd = async (localPath?: string) => {
    const path = localPath ?? form.localPath
    if (!form.name || !path) return
    setCreating(true)
    try {
      const res = await apiFetch('/api/rigs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, localPath: path, townId: activeTownId ?? undefined }),
      })
      const rig = await res.json()
      setRigs([...rigs, rig])
      setForm({ name: '', repoUrl: '', localPath: '' })
      closeForm()
    } catch (err) {
      addToast(`Failed to add project: ${(err as Error).message}`)
    } finally {
      setCreating(false)
    }
  }

  const handleCreateNew = async () => {
    if (!newRepoPath || !form.name) return
    setCreating(true)
    try {
      const initRes = await apiFetch('/api/init-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newRepoPath }),
      })
      if (!initRes.ok) {
        const err = await initRes.json().catch(() => ({}))
        addToast(`Failed to create repo: ${err.error ?? initRes.status}`)
        return
      }
      await handleAdd(newRepoPath)
    } catch (err) {
      addToast(`Failed to create repo: ${(err as Error).message}`)
    } finally {
      setCreating(false)
    }
  }

  const handleSpawn = async (rig: Rig, taskDescription?: string) => {
    setSpawning(rig.id)
    try {
      const res = await apiFetch(`/api/projects/${rig.id}/workerbees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskDescription: taskDescription ?? '' }),
      })
      const bee = await res.json()
      if (bee.sessionId) {
        const hasSession = tabs.some((t) => t.panes.includes(bee.sessionId))
        if (!hasSession) {
          if (activeTabId) addPaneToTab(activeTabId, bee.sessionId)
          else addTab(rig.name, [bee.sessionId])
        }
      }
    } catch (err) {
      addToast(`Failed to spawn WorkerBee: ${(err as Error).message}`)
    } finally {
      setSpawning(null)
      setSpawnTask(null)
    }
  }

  const handleSaveRuntime = async (rigId: string) => {
    if (!runtimeEdit) return
    await apiFetch(`/api/projects/${rigId}/runtime`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: runtimeEdit.command, provider: runtimeEdit.provider }),
    })
    const updated = await apiFetch('/api/rigs').then((r) => r.json())
    setRigs(updated)
    setRuntimeEdit(null)
  }

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/projects/${id}`, { method: 'DELETE' })
    setRigs(rigs.filter((r) => r.id !== id))
    if (expandedRig === id) setExpandedRig(null)
  }

  return (
    <div style={styles.panel}>
      {rigs.map((rig) => (
        <div key={rig.id}>
          <div style={styles.rigRow}>
            <div
              style={styles.rigInfo}
              onClick={() => setExpandedRig(expandedRig === rig.id ? null : rig.id)}
            >
              <span style={styles.rigName}>{rig.name}</span>
              <span style={styles.rigPath}>{rig.localPath}</span>
            </div>
            <button
              style={styles.spawnBtn}
              onClick={() => setSpawnTask({ rigId: rig.id, taskDescription: '' })}
              disabled={spawning === rig.id}
              title="Spawn a worker agent"
            >
              {spawning === rig.id ? '…' : '+ Worker'}
            </button>
          </div>

          {expandedRig === rig.id && (
            <div style={styles.expanded}>
              {/* Runtime config */}
              <div style={styles.expandSection}>
                <div style={styles.expandTitle}>Runtime</div>
                {runtimeEdit?.rigId === rig.id ? (
                  <div style={styles.runtimeForm}>
                    <div style={styles.runtimeRow}>
                      <span style={styles.runtimeLabel}>provider</span>
                      <select
                        style={styles.runtimeInput}
                        value={runtimeEdit.provider}
                        onChange={(e) => setRuntimeEdit((r) => r ? { ...r, provider: e.target.value } : null)}
                      >
                        <option value="claude">claude</option>
                        <option value="codex">codex</option>
                        <option value="custom">custom</option>
                      </select>
                    </div>
                    <div style={styles.runtimeRow}>
                      <span style={styles.runtimeLabel}>command</span>
                      <input
                        style={styles.runtimeInput}
                        value={runtimeEdit.command}
                        onChange={(e) => setRuntimeEdit((r) => r ? { ...r, command: e.target.value } : null)}
                      />
                    </div>
                    <div style={styles.runtimeBtns}>
                      <button style={styles.saveBtn} onClick={() => handleSaveRuntime(rig.id)}>Save</button>
                      <button style={styles.cancelSmBtn} onClick={() => setRuntimeEdit(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={styles.runtimeDisplay}>
                    <span style={styles.runtimeValue}>
                      {rig.runtime?.provider ?? 'claude'} · {rig.runtime?.command ?? 'claude'}
                    </span>
                    <button
                      style={styles.editBtn}
                      onClick={() => setRuntimeEdit({
                        rigId: rig.id,
                        command: rig.runtime?.command ?? 'claude',
                        provider: rig.runtime?.provider ?? 'claude',
                      })}
                    >
                      edit
                    </button>
                  </div>
                )}
              </div>

              {/* Templates */}
              <div style={styles.expandSection}>
                <div style={styles.expandTitle}>Templates</div>
                <TemplatesPanel
                  projectId={rig.id}
                  onSelect={(content) => setSpawnTask({ rigId: rig.id, taskDescription: content })}
                />
              </div>

              {/* Delete */}
              <button style={styles.deleteBtn} onClick={() => handleDelete(rig.id)}>
                Delete Project
              </button>
            </div>
          )}
        </div>
      ))}

      {/* Task description prompt before spawning */}
      {spawnTask && (
        <div style={styles.form}>
          <div style={styles.spawnHeader}>
            Spawn WorkerBee for <strong>{rigs.find((r) => r.id === spawnTask.rigId)?.name}</strong>
          </div>
          <textarea
            style={{ ...styles.input, resize: 'vertical', minHeight: 60 }}
            placeholder="Task description (optional) — written as CLAUDE.md in worktree"
            value={spawnTask.taskDescription}
            onChange={(e) => setSpawnTask((t) => t ? { ...t, taskDescription: e.target.value } : null)}
            autoFocus
          />
          <div style={styles.formBtns}>
            <button
              style={styles.addBtn}
              onClick={() => {
                const rig = rigs.find((r) => r.id === spawnTask.rigId)
                if (rig) handleSpawn(rig, spawnTask.taskDescription)
              }}
            >
              Spawn
            </button>
            <button style={styles.cancelBtn} onClick={() => setSpawnTask(null)}>Cancel</button>
          </div>
        </div>
      )}

      {showForm ? (
        <div style={styles.form}>
          {/* Always-visible name field */}
          <input
            style={styles.input}
            placeholder="Project name…"
            value={form.name}
            autoFocus
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />

          {/* Mode: choose / new / existing / manual */}
          {repoMode === 'choose' && (
            <>
              <div style={styles.pickLabel}>Where is the code?</div>
              <button
                style={styles.optionCard}
                onClick={() => setRepoMode('new')}
                disabled={!form.name.trim()}
                title={!form.name.trim() ? 'Enter a project name first' : undefined}
              >
                <span style={styles.optionIcon}>✦</span>
                <div style={styles.optionText}>
                  <span style={styles.optionTitle}>Create new repo</span>
                  <span style={styles.optionDesc}>
                    {form.name.trim()
                      ? `Will create ${workspacePath ? workspacePath.replace(/[\\/]+$/, '') + '/' : ''}${form.name.toLowerCase().replace(/\s+/g, '-')}`
                      : 'Enter a name above first'}
                  </span>
                </div>
              </button>
              <button style={styles.optionCard} onClick={() => setRepoMode('existing')}>
                <span style={styles.optionIcon}>⎇</span>
                <div style={styles.optionText}>
                  <span style={styles.optionTitle}>Use existing repo</span>
                  <span style={styles.optionDesc}>
                    {loadingSuggestions ? 'scanning…' : `${suggestions.length} repo${suggestions.length !== 1 ? 's' : ''} found`}
                  </span>
                </div>
              </button>
              <button style={styles.cancelBtn} onClick={closeForm}>Cancel</button>
            </>
          )}

          {repoMode === 'new' && (
            <>
              <div style={styles.selectedPath}>
                <span style={styles.selectedPathLabel}>will create</span>
                <span style={styles.selectedPathValue}>{newRepoPath || '—'}</span>
                <button style={styles.changeBtn} onClick={() => setRepoMode('choose')}>back</button>
              </div>
              <input
                style={styles.input}
                placeholder="Repo URL (optional, e.g. github.com/…)"
                value={form.repoUrl}
                onChange={(e) => setForm((f) => ({ ...f, repoUrl: e.target.value }))}
              />
              <div style={styles.formBtns}>
                <button style={styles.addBtn} onClick={handleCreateNew} disabled={creating || !form.name.trim() || !newRepoPath}>
                  {creating ? '…' : 'Create & Add'}
                </button>
                <button style={styles.cancelBtn} onClick={closeForm}>Cancel</button>
              </div>
            </>
          )}

          {repoMode === 'existing' && (
            <>
              {loadingSuggestions ? (
                <div style={styles.scanNote}>scanning for repos…</div>
              ) : suggestions.length > 0 ? (
                <div style={styles.suggList}>
                  {suggestions.map((s) => (
                    <button key={s.path} style={styles.suggItem} onClick={() => pickSuggestion(s)}>
                      <span style={styles.suggName}>{s.name}</span>
                      <span style={styles.suggPath}>{s.path}</span>
                      {s.source === 'existing' && (
                        <span style={styles.suggBadge}>already in workspace</span>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div style={styles.scanNote}>No git repos found in workspace path.</div>
              )}
              <button style={styles.manualLink} onClick={() => setRepoMode('manual')}>
                enter path manually →
              </button>
              <button style={styles.cancelBtn} onClick={closeForm}>Cancel</button>
            </>
          )}

          {repoMode === 'manual' && (
            <>
              <div style={styles.selectedPath}>
                <span style={styles.selectedPathLabel}>repo</span>
                <span style={styles.selectedPathValue}>{form.localPath || '—'}</span>
                <button style={styles.changeBtn} onClick={() => { setRepoMode('existing'); setForm((f) => ({ ...f, localPath: '' })) }}>back</button>
              </div>
              {!form.localPath && (
                <input
                  style={styles.input}
                  placeholder="Local path (e.g. C:/projects/myapp)"
                  value={form.localPath}
                  autoFocus
                  onChange={(e) => setForm((f) => ({ ...f, localPath: e.target.value }))}
                />
              )}
              <input
                style={styles.input}
                placeholder="Repo URL (optional)"
                value={form.repoUrl}
                onChange={(e) => setForm((f) => ({ ...f, repoUrl: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
              />
              <div style={styles.formBtns}>
                <button style={styles.addBtn} onClick={() => handleAdd()} disabled={creating || !form.name || !form.localPath}>
                  {creating ? '…' : 'Add Project'}
                </button>
                <button style={styles.cancelBtn} onClick={closeForm}>Cancel</button>
              </div>
            </>
          )}
        </div>
      ) : (
        !spawnTask && (
          <button style={styles.newRigBtn} onClick={openForm}>
            + Add Project
          </button>
        )
      )}
    </div>
  )
}

const styles = {
  panel: { padding: '4px 0', display: 'flex', flexDirection: 'column' as const, gap: 2 },
  rigRow: {
    display: 'flex', alignItems: 'center', padding: '4px 8px', gap: 6,
    borderBottom: '1px solid #1a1a1a',
  },
  rigInfo: {
    flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 1,
    overflow: 'hidden', cursor: 'pointer',
  },
  rigName: { fontSize: 12, color: '#d4d4d4', fontFamily: 'monospace' },
  rigPath: {
    fontSize: 10, color: '#555', fontFamily: 'monospace',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  spawnBtn: {
    background: 'none', border: '1px solid #3a3a3a', color: '#4ec9b0',
    borderRadius: 3, padding: '2px 6px', cursor: 'pointer',
    fontSize: 10, fontFamily: 'monospace', flexShrink: 0,
  },
  expanded: {
    background: '#0f0f0f', borderBottom: '1px solid #1a1a1a',
    padding: '6px 0', display: 'flex', flexDirection: 'column' as const, gap: 8,
  },
  expandSection: {
    padding: '0 8px', display: 'flex', flexDirection: 'column' as const, gap: 4,
  },
  expandTitle: {
    fontSize: 9, color: '#444', fontFamily: 'monospace',
    textTransform: 'uppercase' as const, letterSpacing: '0.1em',
  },
  runtimeDisplay: { display: 'flex', alignItems: 'center', gap: 8 },
  runtimeValue: { fontSize: 10, color: '#888', fontFamily: 'monospace', flex: 1 },
  editBtn: {
    background: 'none', border: '1px solid #2a2a2a', color: '#555',
    borderRadius: 3, padding: '1px 5px', cursor: 'pointer',
    fontSize: 9, fontFamily: 'monospace',
  },
  runtimeForm: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  runtimeRow: { display: 'flex', alignItems: 'center', gap: 6 },
  runtimeLabel: { fontSize: 9, color: '#555', fontFamily: 'monospace', width: 50, flexShrink: 0 },
  runtimeInput: {
    flex: 1, background: '#1a1a1a', border: '1px solid #333', color: '#d4d4d4',
    borderRadius: 3, padding: '2px 5px', fontSize: 10, fontFamily: 'monospace', outline: 'none',
  },
  runtimeBtns: { display: 'flex', gap: 4 },
  saveBtn: {
    background: '#1a3a2a', border: '1px solid #4ec9b0', color: '#4ec9b0',
    borderRadius: 3, padding: '2px 8px', cursor: 'pointer', fontSize: 9, fontFamily: 'monospace',
  },
  cancelSmBtn: {
    background: 'none', border: '1px solid #2a2a2a', color: '#555',
    borderRadius: 3, padding: '2px 8px', cursor: 'pointer', fontSize: 9, fontFamily: 'monospace',
  },
  deleteBtn: {
    margin: '0 8px', background: 'none', border: '1px solid #2a2a2a', color: '#444',
    borderRadius: 3, padding: '3px 8px', cursor: 'pointer', fontSize: 9, fontFamily: 'monospace',
    textAlign: 'left' as const,
  },
  spawnHeader: {
    fontSize: 10, color: '#888', fontFamily: 'monospace', marginBottom: 2,
  },
  form: { padding: '6px 8px', display: 'flex', flexDirection: 'column' as const, gap: 4 },
  input: {
    background: '#1a1a1a', border: '1px solid #333', color: '#d4d4d4',
    borderRadius: 3, padding: '4px 6px', fontSize: 11, fontFamily: 'monospace',
    outline: 'none', width: '100%', boxSizing: 'border-box' as const,
  },
  formBtns: { display: 'flex', gap: 4 },
  addBtn: {
    flex: 1, background: '#1a3a2a', border: '1px solid #4ec9b0', color: '#4ec9b0',
    borderRadius: 3, padding: '4px', cursor: 'pointer', fontSize: 11, fontFamily: 'monospace',
  },
  cancelBtn: {
    flex: 1, background: 'none', border: '1px solid #333', color: '#666',
    borderRadius: 3, padding: '4px', cursor: 'pointer', fontSize: 11, fontFamily: 'monospace',
  },
  newRigBtn: {
    margin: '4px 8px', background: 'none', border: '1px dashed #333', color: '#569cd6',
    borderRadius: 3, padding: '4px 8px', cursor: 'pointer', fontSize: 11, fontFamily: 'monospace',
    textAlign: 'left' as const,
  },
  pickLabel: { fontSize: 9, color: '#569cd6', fontFamily: 'monospace', textTransform: 'uppercase' as const, letterSpacing: '0.08em' },
  optionCard: {
    background: '#111', border: '1px solid #1e1e1e', borderRadius: 4,
    padding: '8px 10px', cursor: 'pointer', textAlign: 'left' as const,
    display: 'flex', alignItems: 'flex-start', gap: 8,
  },
  optionIcon: { fontSize: 14, color: '#569cd6', flexShrink: 0, lineHeight: 1.2 },
  optionText: { display: 'flex', flexDirection: 'column' as const, gap: 2 },
  optionTitle: { fontSize: 11, color: '#d4d4d4', fontFamily: 'monospace' },
  optionDesc: { fontSize: 9, color: '#555', fontFamily: 'monospace', wordBreak: 'break-all' as const },
  scanNote: { fontSize: 10, color: '#555', fontFamily: 'monospace' },
  suggList: { display: 'flex', flexDirection: 'column' as const, gap: 3 },
  suggItem: {
    background: '#111', border: '1px solid #1e1e1e', borderRadius: 3,
    padding: '6px 8px', cursor: 'pointer', textAlign: 'left' as const,
    display: 'flex', flexDirection: 'column' as const, gap: 2,
    transition: 'border-color 0.1s',
  },
  suggName: { fontSize: 11, color: '#d4d4d4', fontFamily: 'monospace' },
  suggPath: { fontSize: 9, color: '#555', fontFamily: 'monospace', wordBreak: 'break-all' as const },
  suggBadge: {
    fontSize: 8, color: '#4ec9b0', fontFamily: 'monospace',
    background: '#0d2a25', border: '1px solid #1a4a3a', borderRadius: 2, padding: '1px 4px',
    alignSelf: 'flex-start' as const,
  },
  manualLink: {
    background: 'none', border: 'none', color: '#444', cursor: 'pointer',
    fontSize: 9, fontFamily: 'monospace', textAlign: 'left' as const, padding: 0,
  },
  selectedPath: {
    display: 'flex', alignItems: 'center', gap: 6,
    background: '#0d2010', border: '1px solid #1a3a20', borderRadius: 3, padding: '5px 8px',
  },
  selectedPathLabel: { fontSize: 9, color: '#4ec9b0', fontFamily: 'monospace', flexShrink: 0 },
  selectedPathValue: { fontSize: 10, color: '#888', fontFamily: 'monospace', flex: 1, wordBreak: 'break-all' as const },
  changeBtn: {
    background: 'none', border: 'none', color: '#444', cursor: 'pointer',
    fontSize: 9, fontFamily: 'monospace', flexShrink: 0,
  },
}
