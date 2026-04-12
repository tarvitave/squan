import { useState, useEffect, useRef } from 'react'
import { useStore } from '../../store/index.js'
import { apiFetch } from '../../lib/api.js'
import {
  Settings, ChevronDown, FolderGit2, Plus,
  Monitor, Columns3, BarChart3, Activity,
  DollarSign, Terminal, Code2, Bot, X, Loader2,
  GitBranch, Search, Lock, Globe, ChevronRight,
} from 'lucide-react'
import type { MainView, Rig } from '../../store/index.js'

const NAV_ITEMS: { view: MainView; icon: typeof Monitor; label: string }[] = [
  { view: 'terminals', icon: Monitor, label: 'Terminals' },
  { view: 'kanban', icon: Columns3, label: 'Kanban' },
  { view: 'metrics', icon: BarChart3, label: 'Metrics' },
  { view: 'events', icon: Activity, label: 'Events' },
  { view: 'costs', icon: DollarSign, label: 'Costs' },
  { view: 'console', icon: Terminal, label: 'Console' },
  { view: 'claudecode', icon: Code2, label: 'Claude Code' },
]

interface GithubRepo {
  name: string
  fullName: string
  cloneUrl: string
  htmlUrl: string
  description: string | null
  private: boolean
  language: string | null
  updatedAt: string
}

type AddMode = 'pick' | 'create' | 'url'

function workspacePath(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `C:\\Users\\colin\\squan-workspace\\${slug}`
}

export function Sidebar() {
  const mainView = useStore((s) => s.mainView)
  const setMainView = useStore((s) => s.setMainView)
  const setShowPreferences = useStore((s) => s.setShowPreferences)
  const user = useStore((s) => s.user)
  const agents = useStore((s) => s.agents)
  const rigs = useStore((s) => s.rigs)
  const setRigs = useStore((s) => s.setRigs)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const setActiveProjectId = useStore((s) => s.setActiveProjectId)
  const activeTownId = useStore((s) => s.activeTownId)
  const atomicTasks = useStore((s) => s.atomicTasks)

  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false)
  const [showAddProject, setShowAddProject] = useState(false)
  const [addMode, setAddMode] = useState<AddMode>('pick')
  const [addingProject, setAddingProject] = useState(false)
  const [addError, setAddError] = useState('')

  // GitHub repo picker state
  const [ghRepos, setGhRepos] = useState<GithubRepo[]>([])
  const [ghLoading, setGhLoading] = useState(false)
  const [ghSearch, setGhSearch] = useState('')
  const [ghHasToken, setGhHasToken] = useState(false)

  // Create new repo state
  const [newRepoName, setNewRepoName] = useState('')
  const [newRepoDesc, setNewRepoDesc] = useState('')
  const [newRepoPrivate, setNewRepoPrivate] = useState(true)

  // Manual URL state
  const [manualName, setManualName] = useState('')
  const [manualUrl, setManualUrl] = useState('')

  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    apiFetch('/api/rigs?all=true').then((r) => r.json()).then((data: Rig[]) => {
      setRigs(data)
      if (!activeProjectId && data.length > 0) setActiveProjectId(data[0].id)
    }).catch(() => {})
  }, [activeTownId])

  // Load GitHub repos when picker opens
  useEffect(() => {
    if (showAddProject && addMode === 'pick') {
      setGhLoading(true)
      apiFetch('/api/github/repos?per_page=50&sort=updated')
        .then((r) => {
          if (r.ok) { setGhHasToken(true); return r.json() }
          setGhHasToken(false)
          return []
        })
        .then((data) => setGhRepos(data ?? []))
        .catch(() => setGhHasToken(false))
        .finally(() => setGhLoading(false))
    }
  }, [showAddProject, addMode])

  const activeProject = rigs.find((r) => r.id === activeProjectId)
  const projectAgents = activeProjectId ? agents.filter((a) => a.projectId === activeProjectId) : agents
  const activeCount = projectAgents.filter((a) => a.status === 'working').length

  // Filter GitHub repos by search
  const filteredRepos = ghSearch
    ? ghRepos.filter((r) => r.fullName.toLowerCase().includes(ghSearch.toLowerCase()) || (r.description ?? '').toLowerCase().includes(ghSearch.toLowerCase()))
    : ghRepos

  // Already added repos
  const addedUrls = new Set(rigs.map((r) => r.repoUrl))

  const addProject = async (name: string, repoUrl: string) => {
    setAddingProject(true)
    setAddError('')
    const localPath = workspacePath(name)
    try {
      let townId = activeTownId
      if (!townId) {
        const townsRes = await apiFetch('/api/towns')
        const towns = await townsRes.json()
        townId = towns.length > 0 ? towns[0].id : null
        if (!townId) {
          const createRes = await apiFetch('/api/towns', { method: 'POST', body: JSON.stringify({ name: 'Default', path: localPath }) })
          townId = (await createRes.json()).id
        }
      }
      const res = await apiFetch('/api/rigs', {
        method: 'POST',
        body: JSON.stringify({ townId, name, repoUrl, localPath }),
      })
      if (!res.ok) {
        const err = await res.json()
        setAddError(err.error ?? 'Failed to add project')
        return
      }
      const newRig = await res.json()
      const rigsRes = await apiFetch('/api/rigs?all=true')
      setRigs(await rigsRes.json())
      setActiveProjectId(newRig.id)
      try { await apiFetch(`/api/projects/${newRig.id}/init-squan`, { method: 'POST' }) } catch {}
      closeAddProject()
    } catch (err) {
      setAddError((err as Error).message)
    } finally {
      setAddingProject(false)
    }
  }

  const createAndAddRepo = async () => {
    if (!newRepoName.trim()) { setAddError('Repository name is required'); return }
    setAddingProject(true)
    setAddError('')
    try {
      const res = await apiFetch('/api/github/repos', {
        method: 'POST',
        body: JSON.stringify({ name: newRepoName.trim(), description: newRepoDesc.trim(), isPrivate: newRepoPrivate }),
      })
      if (!res.ok) {
        const err = await res.json()
        setAddError(err.error ?? 'Failed to create repository')
        setAddingProject(false)
        return
      }
      const repo = await res.json()
      await addProject(repo.name, repo.cloneUrl)
    } catch (err) {
      setAddError((err as Error).message)
      setAddingProject(false)
    }
  }

  const closeAddProject = () => {
    setShowAddProject(false)
    setAddMode('pick')
    setAddError('')
    setGhSearch('')
    setNewRepoName('')
    setNewRepoDesc('')
    setManualName('')
    setManualUrl('')
  }

  // ── Styles ──────────────────────────────────────────────────────

  const S = {
    input: { width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid #e3e6ea', borderRadius: 6, outline: 'none', boxSizing: 'border-box' as const, color: '#3f434b', backgroundColor: '#ffffff' },
    label: { fontSize: 11, fontWeight: 500 as const, color: '#878787', display: 'block' as const, marginBottom: 3 },
    tab: (active: boolean) => ({
      flex: 1, padding: '6px 0', fontSize: 12, fontWeight: active ? 500 as const : 400 as const, border: 'none', cursor: 'pointer',
      borderBottom: active ? '2px solid #13bbaf' : '2px solid transparent',
      color: active ? '#13bbaf' : '#878787', backgroundColor: 'transparent',
    }),
    tealBtn: (disabled: boolean) => ({
      flex: 1, display: 'flex' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6,
      padding: '7px 12px', fontSize: 13, fontWeight: 500 as const, border: 'none', borderRadius: 6,
      cursor: disabled ? 'not-allowed' as const : 'pointer' as const,
      backgroundColor: '#13bbaf', color: '#ffffff', opacity: disabled ? 0.5 : 1,
    }),
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', backgroundColor: '#f4f6f7', userSelect: 'none' }}>

      {/* ── Project selector ─────────────────────────────────── */}
      <div style={{ padding: '12px 12px 4px 12px', flexShrink: 0, position: 'relative' }}>
        <button
          onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', borderRadius: 8, backgroundColor: '#ffffff', border: '1px solid #e3e6ea', cursor: 'pointer', textAlign: 'left' }}
        >
          <FolderGit2 style={{ width: 16, height: 16, color: '#878787', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#3f434b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeProject?.name ?? 'All Projects'}
            </div>
            {activeProject && (
              <div style={{ fontSize: 11, color: '#a7b0b9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeProject.localPath.split(/[/\\]/).slice(-2).join('/')}
              </div>
            )}
          </div>
          <ChevronDown style={{ width: 16, height: 16, color: '#a7b0b9', flexShrink: 0, transform: projectDropdownOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
        </button>

        {projectDropdownOpen && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setProjectDropdownOpen(false)} />
            <div style={{
              position: 'absolute', left: 12, right: 12, top: '100%', marginTop: 4, zIndex: 50,
              backgroundColor: '#ffffff', border: '1px solid #e3e6ea', borderRadius: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)', overflow: 'hidden', maxHeight: 360, overflowY: 'auto',
            }}>
              {/* Add project at TOP */}
              <button
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 12px', textAlign: 'left', fontSize: 14, border: 'none', cursor: 'pointer', backgroundColor: '#ffffff', color: '#13bbaf', fontWeight: 500, borderBottom: '1px solid #e3e6ea' }}
                onClick={() => { setProjectDropdownOpen(false); setShowAddProject(true) }}
              >
                <Plus style={{ width: 16, height: 16 }} /> Add project…
              </button>

              <button
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', textAlign: 'left', fontSize: 14, border: 'none', cursor: 'pointer', backgroundColor: !activeProjectId ? '#f4f6f7' : '#ffffff', color: '#3f434b', fontWeight: !activeProjectId ? 500 : 400 }}
                onClick={() => { setActiveProjectId(null); setProjectDropdownOpen(false) }}
              >
                <FolderGit2 style={{ width: 16, height: 16 }} /> All Projects
              </button>
              {rigs.map((rig) => (
                <button
                  key={rig.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', textAlign: 'left', fontSize: 14, border: 'none', cursor: 'pointer', backgroundColor: activeProjectId === rig.id ? '#f4f6f7' : '#ffffff', color: '#3f434b', fontWeight: activeProjectId === rig.id ? 500 : 400 }}
                  onClick={() => { setActiveProjectId(rig.id); setProjectDropdownOpen(false) }}
                >
                  <FolderGit2 style={{ width: 16, height: 16 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rig.name}</div>
                    <div style={{ fontSize: 11, color: '#a7b0b9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rig.localPath.split(/[/\\]/).slice(-2).join('/')}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Add Project Panel ────────────────────────────────── */}
      {showAddProject && (
        <div style={{ padding: '4px 12px 8px 12px', flexShrink: 0 }}>
          <div style={{ backgroundColor: '#ffffff', border: '1px solid #e3e6ea', borderRadius: 8, overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid #e3e6ea' }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: '#3f434b' }}>Add Project</span>
              <button onClick={closeAddProject} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#a7b0b9', padding: 2 }}>
                <X style={{ width: 14, height: 14 }} />
              </button>
            </div>

            {/* Mode tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid #e3e6ea' }}>
              <button style={S.tab(addMode === 'pick')} onClick={() => setAddMode('pick')}>GitHub Repos</button>
              <button style={S.tab(addMode === 'create')} onClick={() => setAddMode('create')}>New Repo</button>
              <button style={S.tab(addMode === 'url')} onClick={() => setAddMode('url')}>URL</button>
            </div>

            {/* Error */}
            {addError && (
              <div style={{ margin: '8px 12px 0', fontSize: 12, color: '#f94b4b', backgroundColor: '#f94b4b10', border: '1px solid #f94b4b30', borderRadius: 6, padding: '6px 10px' }}>
                {addError}
              </div>
            )}

            {/* ── Pick from GitHub ─────────────────────────────── */}
            {addMode === 'pick' && (
              <div style={{ padding: '8px 12px 12px' }}>
                {!ghHasToken && !ghLoading ? (
                  <div style={{ textAlign: 'center', padding: '16px 0' }}>
                    <GitBranch style={{ width: 24, height: 24, color: '#a7b0b9', margin: '0 auto 8px' }} />
                    <div style={{ fontSize: 13, color: '#3f434b', marginBottom: 4 }}>Connect GitHub</div>
                    <div style={{ fontSize: 12, color: '#a7b0b9', marginBottom: 12 }}>Add a GitHub token in Settings to browse your repos</div>
                    <button
                      style={{ ...S.tealBtn(false), flex: 'none', display: 'inline-flex', padding: '6px 16px' }}
                      onClick={() => { closeAddProject(); setShowPreferences(true) }}
                    >
                      <Settings style={{ width: 14, height: 14 }} /> Open Settings
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Search */}
                    <div style={{ position: 'relative', marginBottom: 8 }}>
                      <Search style={{ width: 14, height: 14, position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#a7b0b9' }} />
                      <input
                        ref={searchRef}
                        style={{ ...S.input, paddingLeft: 28 }}
                        placeholder="Search repositories…"
                        value={ghSearch}
                        onChange={(e) => setGhSearch(e.target.value)}
                        autoFocus
                      />
                    </div>

                    {/* Repo list */}
                    <div style={{ maxHeight: 200, overflowY: 'auto', borderRadius: 6, border: '1px solid #e3e6ea' }}>
                      {ghLoading ? (
                        <div style={{ padding: 16, textAlign: 'center' }}>
                          <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite', color: '#a7b0b9', margin: '0 auto' }} />
                        </div>
                      ) : filteredRepos.length === 0 ? (
                        <div style={{ padding: '12px 16px', fontSize: 12, color: '#a7b0b9', textAlign: 'center' }}>
                          {ghSearch ? 'No matching repos' : 'No repos found'}
                        </div>
                      ) : (
                        filteredRepos.map((repo) => {
                          const alreadyAdded = addedUrls.has(repo.cloneUrl)
                          return (
                            <button
                              key={repo.fullName}
                              disabled={alreadyAdded || addingProject}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px',
                                textAlign: 'left', fontSize: 13, border: 'none', cursor: alreadyAdded ? 'default' : 'pointer',
                                backgroundColor: alreadyAdded ? '#f4f6f7' : '#ffffff', color: '#3f434b',
                                borderBottom: '1px solid #f0f0f0', opacity: alreadyAdded ? 0.5 : 1,
                              }}
                              onClick={() => !alreadyAdded && addProject(repo.name, repo.cloneUrl)}
                            >
                              {repo.private ? <Lock style={{ width: 12, height: 12, color: '#a7b0b9', flexShrink: 0 }} /> : <Globe style={{ width: 12, height: 12, color: '#a7b0b9', flexShrink: 0 }} />}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{repo.fullName}</div>
                                {repo.description && (
                                  <div style={{ fontSize: 11, color: '#a7b0b9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{repo.description}</div>
                                )}
                              </div>
                              {repo.language && (
                                <span style={{ fontSize: 10, color: '#a7b0b9', flexShrink: 0 }}>{repo.language}</span>
                              )}
                              {alreadyAdded ? (
                                <span style={{ fontSize: 10, color: '#91cb80', flexShrink: 0 }}>Added</span>
                              ) : (
                                <ChevronRight style={{ width: 14, height: 14, color: '#e3e6ea', flexShrink: 0 }} />
                              )}
                            </button>
                          )
                        })
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Create new GitHub repo ──────────────────────── */}
            {addMode === 'create' && (
              <div style={{ padding: '8px 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {!ghHasToken ? (
                  <div style={{ textAlign: 'center', padding: '16px 0' }}>
                    <div style={{ fontSize: 12, color: '#a7b0b9', marginBottom: 12 }}>Add a GitHub token in Settings to create repos</div>
                    <button
                      style={{ ...S.tealBtn(false), flex: 'none', display: 'inline-flex', padding: '6px 16px' }}
                      onClick={() => { closeAddProject(); setShowPreferences(true) }}
                    >
                      <Settings style={{ width: 14, height: 14 }} /> Open Settings
                    </button>
                  </div>
                ) : (
                  <>
                    <div>
                      <label style={S.label}>Repository name</label>
                      <input style={S.input} placeholder="my-awesome-project" value={newRepoName} onChange={(e) => setNewRepoName(e.target.value)} autoFocus
                        onKeyDown={(e) => e.key === 'Enter' && newRepoName.trim() && createAndAddRepo()}
                      />
                    </div>
                    <div>
                      <label style={S.label}>Description (optional)</label>
                      <input style={S.input} placeholder="A brief description…" value={newRepoDesc} onChange={(e) => setNewRepoDesc(e.target.value)} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        onClick={() => setNewRepoPrivate(!newRepoPrivate)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, border: '1px solid #e3e6ea', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', backgroundColor: '#ffffff', color: '#3f434b' }}
                      >
                        {newRepoPrivate ? <Lock style={{ width: 12, height: 12 }} /> : <Globe style={{ width: 12, height: 12 }} />}
                        {newRepoPrivate ? 'Private' : 'Public'}
                      </button>
                      <span style={{ fontSize: 11, color: '#a7b0b9' }}>
                        {newRepoPrivate ? 'Only you can see this repo' : 'Anyone can see this repo'}
                      </span>
                    </div>
                    {newRepoName.trim() && (
                      <div style={{ fontSize: 11, color: '#a7b0b9' }}>
                        Will create <span style={{ fontFamily: 'monospace', color: '#878787' }}>{user?.email?.split('@')[0] ?? 'you'}/{newRepoName.trim()}</span> on GitHub and clone locally
                      </div>
                    )}
                    <button
                      style={S.tealBtn(addingProject || !newRepoName.trim())}
                      onClick={createAndAddRepo}
                      disabled={addingProject || !newRepoName.trim()}
                    >
                      {addingProject ? <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} /> : <Plus style={{ width: 14, height: 14 }} />}
                      {addingProject ? 'Creating…' : 'Create & Add'}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* ── Manual URL ─────────────────────────────────── */}
            {addMode === 'url' && (
              <div style={{ padding: '8px 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div>
                  <label style={S.label}>Project name</label>
                  <input style={S.input} placeholder="e.g. Stock Price Dashboard" value={manualName} onChange={(e) => setManualName(e.target.value)} autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && manualName.trim() && manualUrl.trim() && addProject(manualName.trim(), manualUrl.trim())}
                  />
                </div>
                <div>
                  <label style={S.label}>Git repository URL</label>
                  <div style={{ position: 'relative' }}>
                    <GitBranch style={{ width: 14, height: 14, position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#a7b0b9' }} />
                    <input style={{ ...S.input, paddingLeft: 28 }} placeholder="https://github.com/user/repo.git" value={manualUrl} onChange={(e) => setManualUrl(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && manualName.trim() && manualUrl.trim() && addProject(manualName.trim(), manualUrl.trim())}
                    />
                  </div>
                </div>
                {manualName.trim() && (
                  <div style={{ fontSize: 11, color: '#a7b0b9' }}>
                    Will clone to: <span style={{ fontFamily: 'monospace', color: '#878787' }}>{workspacePath(manualName.trim())}</span>
                  </div>
                )}
                <button
                  style={S.tealBtn(addingProject || !manualName.trim() || !manualUrl.trim())}
                  onClick={() => addProject(manualName.trim(), manualUrl.trim())}
                  disabled={addingProject || !manualName.trim() || !manualUrl.trim()}
                >
                  {addingProject ? <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} /> : <Plus style={{ width: 14, height: 14 }} />}
                  {addingProject ? 'Adding…' : 'Add Project'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Navigation ───────────────────────────────────────── */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '12px 8px 4px 8px' }}>
        {NAV_ITEMS.map(({ view, icon: Icon, label }) => {
          const active = mainView === view
          return (
            <button
              key={view}
              onClick={() => setMainView(view)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                padding: '7px 12px', borderRadius: 8, fontSize: 13, border: 'none', cursor: 'pointer', textAlign: 'left',
                backgroundColor: active ? '#ffffff' : 'transparent',
                color: active ? '#3f434b' : '#878787',
                fontWeight: active ? 500 : 400,
                boxShadow: active ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              <Icon style={{ width: 18, height: 18, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
              {view === 'terminals' && activeCount > 0 && (
                <span style={{ marginLeft: 'auto', minWidth: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(19,187,175,0.15)', color: '#13bbaf', fontSize: 11, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>
                  {activeCount}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <div style={{ margin: '4px 16px', borderTop: '1px solid #e3e6ea' }} />

      {/* ── Agents ───────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px' }}>
          <Bot style={{ width: 16, height: 16, color: '#a7b0b9' }} />
          <span style={{ fontSize: 11, fontWeight: 500, color: '#a7b0b9', textTransform: 'uppercase', letterSpacing: '0.05em', flex: 1 }}>
            Agents{activeProject ? ` · ${activeProject.name}` : ''}
          </span>
          {activeCount > 0 && <span style={{ fontSize: 11, color: '#13bbaf', fontWeight: 500 }}>{activeCount} active</span>}
        </div>
        <div style={{ borderRadius: 8, border: '1px solid #e3e6ea', backgroundColor: '#ffffff', overflow: 'hidden' }}>
          {projectAgents.length === 0 ? (
            <div style={{ padding: '12px 16px', fontSize: 12, color: '#a7b0b9', textAlign: 'center' }}>No agents yet</div>
          ) : (
            projectAgents.map((agent) => (
              <div key={agent.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: '1px solid #e3e6ea', fontSize: 12 }}>
                <span style={{ color: agent.status === 'working' ? '#13bbaf' : agent.status === 'done' ? '#91cb80' : agent.status === 'stalled' ? '#fbcd44' : '#a7b0b9' }}>●</span>
                <span style={{ flex: 1, color: '#3f434b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.name}</span>
                <span style={{ fontSize: 11, color: '#878787' }}>{agent.status}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Settings ─────────────────────────────────────────── */}
      <div style={{ borderTop: '1px solid #e3e6ea', padding: 8, flexShrink: 0 }}>
        <button
          onClick={() => setShowPreferences(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '7px 12px', borderRadius: 8, fontSize: 13, border: 'none', cursor: 'pointer', textAlign: 'left', backgroundColor: 'transparent', color: '#878787' }}
        >
          <Settings style={{ width: 18, height: 18, flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email ?? 'Settings'}</span>
        </button>
      </div>
    </div>
  )
}
