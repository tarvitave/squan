import { useEffect, useState } from 'react'
import { FolderGit2, Plus, ExternalLink, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'
import { TemplatesPanel } from '../TemplatesPanel/index.js'
import { cn } from '../../lib/utils.js'
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
  const addAgent = useStore((s) => s.addAgent)
  const addReleaseTrain = useStore((s) => s.addReleaseTrain)
  const setMainView = useStore((s) => s.setMainView)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', repoUrl: '', localPath: '' })
  const [suggestions, setSuggestions] = useState<RepoSuggestion[]>([])
  const [workspacePath, setWorkspacePath] = useState('')
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [repoMode, setRepoMode] = useState<'choose' | 'new' | 'existing' | 'manual'>('choose')
  const [creating, setCreating] = useState(false)
  const [spawning, setSpawning] = useState<string | null>(null)
  const [spawnTask, setSpawnTask] = useState<{ rigId: string; taskDescription: string } | null>(null)
  const [expandedRig, setExpandedRig] = useState<string | null>(null)
  const [runtimeEdit, setRuntimeEdit] = useState<{ rigId: string; command: string; provider: string } | null>(null)
  const [repoUrlEdit, setRepoUrlEdit] = useState<{ rigId: string; value: string } | null>(null)

  useEffect(() => {
    const url = activeTownId ? `/api/rigs?townId=${activeTownId}` : '/api/rigs'
    apiFetch(url)
      .then((r) => r.json())
      .then(setRigs)
      .catch(() => {})
  }, [activeTownId]) // eslint-disable-line react-hooks/exhaustive-deps

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
    setRepoMode('manual')
  }

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
      await res.json()
      const url = activeTownId ? `/api/rigs?townId=${activeTownId}` : '/api/rigs'
      const updated = await apiFetch(url).then((r) => r.json())
      setRigs(updated)
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
      const rtRes = await apiFetch('/api/release-trains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${rig.name} task`,
          description: taskDescription ?? '',
          projectId: rig.id,
        }),
      })
      const rt = await rtRes.json()
      addReleaseTrain(rt)

      const dispRes = await apiFetch(`/api/release-trains/${rt.id}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await dispRes.json()
      const bee = data.bee ?? data
      if (bee?.id) {
        addAgent({
          ...bee,
          taskDescription: bee.taskDescription ?? taskDescription ?? '',
          worktreePath: bee.worktreePath ?? '',
          branch: bee.branch ?? '',
        })
      }
      if (bee?.sessionId) {
        const hasSession = tabs.some((t) => t.panes.includes(bee.sessionId))
        if (!hasSession) {
          if (activeTabId) addPaneToTab(activeTabId, bee.sessionId)
          else addTab(rig.name, [bee.sessionId])
        }
      }
      setMainView('terminals')
    } catch (err) {
      addToast(`Failed to spawn Agent: ${(err as Error).message}`)
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
    const url = activeTownId ? `/api/rigs?townId=${activeTownId}` : '/api/rigs'
    const updated = await apiFetch(url).then((r) => r.json())
    setRigs(updated)
    setRuntimeEdit(null)
  }

  const handleSaveRepoUrl = async (rigId: string) => {
    if (!repoUrlEdit) return
    await apiFetch(`/api/projects/${rigId}/repo-url`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: repoUrlEdit.value.trim() }),
    })
    const url = activeTownId ? `/api/rigs?townId=${activeTownId}` : '/api/rigs'
    const updated = await apiFetch(url).then((r) => r.json())
    setRigs(updated)
    setRepoUrlEdit(null)
  }

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/projects/${id}`, { method: 'DELETE' })
    setRigs(rigs.filter((r) => r.id !== id))
    if (expandedRig === id) setExpandedRig(null)
  }

  return (
    <div className="flex flex-col gap-0.5 py-1">
      {rigs.map((rig) => (
        <div key={rig.id}>
          <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border-primary">
            <div
              className="flex flex-1 flex-col gap-px overflow-hidden cursor-pointer"
              onClick={() => setExpandedRig(expandedRig === rig.id ? null : rig.id)}
            >
              <span className="flex items-center gap-1.5 text-xs text-text-primary font-mono">
                {expandedRig === rig.id
                  ? <ChevronDown className="w-3 h-3 text-text-tertiary shrink-0" />
                  : <ChevronRight className="w-3 h-3 text-text-tertiary shrink-0" />}
                <FolderGit2 className="w-3 h-3 text-text-info shrink-0" />
                {rig.name}
              </span>
              <span className="text-[10px] text-text-tertiary font-mono truncate pl-[30px]">
                {rig.localPath}
              </span>
            </div>
            <button
              className="shrink-0 flex items-center gap-1 bg-transparent border border-border-primary text-block-teal rounded px-1.5 py-0.5 cursor-pointer text-[10px] font-mono hover:border-block-teal/50"
              onClick={() => setSpawnTask({ rigId: rig.id, taskDescription: '' })}
              disabled={spawning === rig.id}
              title="Spawn a worker agent"
            >
              <Plus className="w-3 h-3" />
              {spawning === rig.id ? '…' : 'Worker'}
            </button>
          </div>

          {expandedRig === rig.id && (
            <div className="flex flex-col gap-2 bg-bg-primary py-1.5 border-b border-border-primary">
              {/* Repo URL */}
              <div className="flex flex-col gap-1 px-2">
                <div className="text-[9px] text-text-disabled font-mono uppercase tracking-wider">
                  GitHub Repo URL
                </div>
                {repoUrlEdit?.rigId === rig.id ? (
                  <div className="flex flex-col gap-1">
                    <input
                      className="w-full bg-bg-secondary border border-border-primary text-text-primary rounded px-1.5 py-0.5 text-[10px] font-mono outline-none box-border"
                      value={repoUrlEdit.value}
                      placeholder="https://github.com/owner/repo"
                      autoFocus
                      onChange={(e) => setRepoUrlEdit((r) => r ? { ...r, value: e.target.value } : null)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveRepoUrl(rig.id) }}
                    />
                    <div className="flex gap-1">
                      <button
                        className="bg-block-teal/10 border border-block-teal text-block-teal rounded px-2 py-px cursor-pointer text-[9px] font-mono"
                        onClick={() => handleSaveRepoUrl(rig.id)}
                      >
                        Save
                      </button>
                      <button
                        className="bg-transparent border border-border-primary text-text-tertiary rounded px-2 py-px cursor-pointer text-[9px] font-mono"
                        onClick={() => setRepoUrlEdit(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'flex-1 text-[10px] font-mono',
                      rig.repoUrl ? 'text-text-info' : 'text-text-tertiary'
                    )}>
                      {rig.repoUrl ? (
                        <span className="flex items-center gap-1">
                          {rig.repoUrl}
                          <ExternalLink className="w-2.5 h-2.5 inline" />
                        </span>
                      ) : 'not set'}
                    </span>
                    <button
                      className="bg-transparent border border-border-primary text-text-tertiary rounded px-1.5 py-px cursor-pointer text-[9px] font-mono"
                      onClick={() => setRepoUrlEdit({ rigId: rig.id, value: rig.repoUrl ?? '' })}
                    >
                      edit
                    </button>
                  </div>
                )}
              </div>

              {/* Runtime config */}
              <div className="flex flex-col gap-1 px-2">
                <div className="text-[9px] text-text-disabled font-mono uppercase tracking-wider">
                  Runtime
                </div>
                {runtimeEdit?.rigId === rig.id ? (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] text-text-tertiary font-mono w-[50px] shrink-0">provider</span>
                      <select
                        className="flex-1 bg-bg-secondary border border-border-primary text-text-primary rounded px-1.5 py-0.5 text-[10px] font-mono outline-none"
                        value={runtimeEdit.provider}
                        onChange={(e) => setRuntimeEdit((r) => r ? { ...r, provider: e.target.value } : null)}
                      >
                        <option value="claude">claude</option>
                        <option value="codex">codex</option>
                        <option value="custom">custom</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] text-text-tertiary font-mono w-[50px] shrink-0">command</span>
                      <input
                        className="flex-1 bg-bg-secondary border border-border-primary text-text-primary rounded px-1.5 py-0.5 text-[10px] font-mono outline-none"
                        value={runtimeEdit.command}
                        onChange={(e) => setRuntimeEdit((r) => r ? { ...r, command: e.target.value } : null)}
                      />
                    </div>
                    <div className="flex gap-1">
                      <button
                        className="bg-block-teal/10 border border-block-teal text-block-teal rounded px-2 py-px cursor-pointer text-[9px] font-mono"
                        onClick={() => handleSaveRuntime(rig.id)}
                      >
                        Save
                      </button>
                      <button
                        className="bg-transparent border border-border-primary text-text-tertiary rounded px-2 py-px cursor-pointer text-[9px] font-mono"
                        onClick={() => setRuntimeEdit(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-[10px] text-text-secondary font-mono">
                      {rig.runtime?.provider ?? 'claude'} · {rig.runtime?.command ?? 'claude'}
                    </span>
                    <button
                      className="bg-transparent border border-border-primary text-text-tertiary rounded px-1.5 py-px cursor-pointer text-[9px] font-mono"
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
              <div className="flex flex-col gap-1 px-2">
                <div className="text-[9px] text-text-disabled font-mono uppercase tracking-wider">
                  Templates
                </div>
                <TemplatesPanel
                  projectId={rig.id}
                  onSelect={(content) => setSpawnTask({ rigId: rig.id, taskDescription: content })}
                />
              </div>

              {/* Delete */}
              <button
                className="mx-2 flex items-center gap-1 bg-transparent border border-border-primary text-text-disabled rounded px-2 py-0.5 cursor-pointer text-[9px] font-mono text-left hover:border-red-200/50 hover:text-text-danger/70"
                onClick={() => handleDelete(rig.id)}
              >
                <Trash2 className="w-3 h-3" />
                Delete Project
              </button>
            </div>
          )}
        </div>
      ))}

      {/* Task description prompt before spawning */}
      {spawnTask && (
        <div className="flex flex-col gap-1 px-2 py-1.5">
          <div className="text-[10px] text-text-secondary font-mono mb-0.5">
            Spawn Agent for <strong>{rigs.find((r) => r.id === spawnTask.rigId)?.name}</strong>
          </div>
          <textarea
            className="w-full bg-bg-secondary border border-border-primary text-text-primary rounded px-1.5 py-1 text-[11px] font-mono outline-none box-border resize-y min-h-[60px]"
            placeholder="Task description (optional) — written as CLAUDE.md in worktree"
            value={spawnTask.taskDescription}
            onChange={(e) => setSpawnTask((t) => t ? { ...t, taskDescription: e.target.value } : null)}
            autoFocus
          />
          <div className="flex gap-1">
            <button
              className="flex-1 bg-block-teal/10 border border-block-teal text-block-teal rounded py-1 cursor-pointer text-[11px] font-mono"
              onClick={() => {
                const rig = rigs.find((r) => r.id === spawnTask.rigId)
                if (rig) handleSpawn(rig, spawnTask.taskDescription)
              }}
            >
              Spawn
            </button>
            <button
              className="flex-1 bg-transparent border border-border-primary text-text-tertiary rounded py-1 cursor-pointer text-[11px] font-mono"
              onClick={() => setSpawnTask(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showForm ? (
        <div className="flex flex-col gap-1 px-2 py-1.5">
          {/* Always-visible name field */}
          <input
            className="w-full bg-bg-secondary border border-border-primary text-text-primary rounded px-1.5 py-1 text-[11px] font-mono outline-none box-border"
            placeholder="Project name…"
            value={form.name}
            autoFocus
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />

          {/* Mode: choose */}
          {repoMode === 'choose' && (
            <>
              <div className="text-[9px] text-text-info font-mono uppercase tracking-wide">
                Where is the code?
              </div>
              <button
                className="flex items-start gap-2 bg-bg-primary border border-border-primary rounded p-2 cursor-pointer text-left disabled:opacity-50"
                onClick={() => setRepoMode('new')}
                disabled={!form.name.trim()}
                title={!form.name.trim() ? 'Enter a project name first' : undefined}
              >
                <Plus className="w-3.5 h-3.5 text-text-info shrink-0 mt-0.5" />
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] text-text-primary font-mono">Create new repo</span>
                  <span className="text-[9px] text-text-tertiary font-mono break-all">
                    {form.name.trim()
                      ? `Will create ${workspacePath ? workspacePath.replace(/[\\/]+$/, '') + '/' : ''}${form.name.toLowerCase().replace(/\s+/g, '-')}`
                      : 'Enter a name above first'}
                  </span>
                </div>
              </button>
              <button
                className="flex items-start gap-2 bg-bg-primary border border-border-primary rounded p-2 cursor-pointer text-left"
                onClick={() => setRepoMode('existing')}
              >
                <FolderGit2 className="w-3.5 h-3.5 text-text-info shrink-0 mt-0.5" />
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] text-text-primary font-mono">Use existing repo</span>
                  <span className="text-[9px] text-text-tertiary font-mono">
                    {loadingSuggestions ? 'scanning…' : `${suggestions.length} repo${suggestions.length !== 1 ? 's' : ''} found`}
                  </span>
                </div>
              </button>
              <button
                className="flex-1 bg-transparent border border-border-primary text-text-tertiary rounded py-1 cursor-pointer text-[11px] font-mono"
                onClick={closeForm}
              >
                Cancel
              </button>
            </>
          )}

          {/* Mode: new */}
          {repoMode === 'new' && (
            <>
              <div className="flex items-center gap-1.5 bg-block-teal/5 border border-block-teal/20 rounded px-2 py-1">
                <span className="text-[9px] text-block-teal font-mono shrink-0">will create</span>
                <span className="flex-1 text-[10px] text-text-secondary font-mono break-all">{newRepoPath || '—'}</span>
                <button
                  className="bg-transparent border-none text-text-disabled cursor-pointer text-[9px] font-mono shrink-0"
                  onClick={() => setRepoMode('choose')}
                >
                  back
                </button>
              </div>
              <input
                className="w-full bg-bg-secondary border border-border-primary text-text-primary rounded px-1.5 py-1 text-[11px] font-mono outline-none box-border"
                placeholder="Repo URL (optional, e.g. github.com/…)"
                value={form.repoUrl}
                onChange={(e) => setForm((f) => ({ ...f, repoUrl: e.target.value }))}
              />
              <div className="flex gap-1">
                <button
                  className="flex-1 bg-block-teal/10 border border-block-teal text-block-teal rounded py-1 cursor-pointer text-[11px] font-mono disabled:opacity-50"
                  onClick={handleCreateNew}
                  disabled={creating || !form.name.trim() || !newRepoPath}
                >
                  {creating ? '…' : 'Create & Add'}
                </button>
                <button
                  className="flex-1 bg-transparent border border-border-primary text-text-tertiary rounded py-1 cursor-pointer text-[11px] font-mono"
                  onClick={closeForm}
                >
                  Cancel
                </button>
              </div>
            </>
          )}

          {/* Mode: existing */}
          {repoMode === 'existing' && (
            <>
              {loadingSuggestions ? (
                <div className="text-[10px] text-text-tertiary font-mono">scanning for repos…</div>
              ) : suggestions.length > 0 ? (
                <div className="flex flex-col gap-0.5">
                  {suggestions.map((s) => (
                    <button
                      key={s.path}
                      className="flex flex-col gap-0.5 bg-bg-primary border border-border-primary rounded px-2 py-1.5 cursor-pointer text-left transition-colors hover:border-border-primary"
                      onClick={() => pickSuggestion(s)}
                    >
                      <span className="text-[11px] text-text-primary font-mono">{s.name}</span>
                      <span className="text-[9px] text-text-tertiary font-mono break-all">{s.path}</span>
                      {s.source === 'existing' && (
                        <span className="self-start text-[8px] text-block-teal font-mono bg-block-teal/5 border border-block-teal/20 rounded px-1 py-px">
                          already in workspace
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-[10px] text-text-tertiary font-mono">No git repos found in workspace path.</div>
              )}
              <button
                className="bg-transparent border-none text-text-disabled cursor-pointer text-[9px] font-mono text-left p-0 hover:text-text-tertiary"
                onClick={() => setRepoMode('manual')}
              >
                enter path manually →
              </button>
              <button
                className="flex-1 bg-transparent border border-border-primary text-text-tertiary rounded py-1 cursor-pointer text-[11px] font-mono"
                onClick={closeForm}
              >
                Cancel
              </button>
            </>
          )}

          {/* Mode: manual */}
          {repoMode === 'manual' && (
            <>
              <div className="flex items-center gap-1.5 bg-block-teal/5 border border-block-teal/20 rounded px-2 py-1">
                <span className="text-[9px] text-block-teal font-mono shrink-0">repo</span>
                <span className="flex-1 text-[10px] text-text-secondary font-mono break-all">{form.localPath || '—'}</span>
                <button
                  className="bg-transparent border-none text-text-disabled cursor-pointer text-[9px] font-mono shrink-0"
                  onClick={() => { setRepoMode('existing'); setForm((f) => ({ ...f, localPath: '' })) }}
                >
                  back
                </button>
              </div>
              {!form.localPath && (
                <input
                  className="w-full bg-bg-secondary border border-border-primary text-text-primary rounded px-1.5 py-1 text-[11px] font-mono outline-none box-border"
                  placeholder="Local path (e.g. C:/projects/myapp)"
                  value={form.localPath}
                  autoFocus
                  onChange={(e) => setForm((f) => ({ ...f, localPath: e.target.value }))}
                />
              )}
              <input
                className="w-full bg-bg-secondary border border-border-primary text-text-primary rounded px-1.5 py-1 text-[11px] font-mono outline-none box-border"
                placeholder="Repo URL (optional)"
                value={form.repoUrl}
                onChange={(e) => setForm((f) => ({ ...f, repoUrl: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
              />
              <div className="flex gap-1">
                <button
                  className="flex-1 bg-block-teal/10 border border-block-teal text-block-teal rounded py-1 cursor-pointer text-[11px] font-mono disabled:opacity-50"
                  onClick={() => handleAdd()}
                  disabled={creating || !form.name || !form.localPath}
                >
                  {creating ? '…' : 'Add Project'}
                </button>
                <button
                  className="flex-1 bg-transparent border border-border-primary text-text-tertiary rounded py-1 cursor-pointer text-[11px] font-mono"
                  onClick={closeForm}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        !spawnTask && (
          <button
            className="mx-2 my-1 flex items-center gap-1 bg-transparent border border-dashed border-border-primary text-text-info rounded px-2 py-1 cursor-pointer text-[11px] font-mono text-left hover:border-blue-200/50"
            onClick={openForm}
          >
            <Plus className="w-3 h-3" />
            Add Project
          </button>
        )
      )}
    </div>
  )
}
