import { useState } from 'react'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'
import type { ReleaseTrainEntry, TemplateEntry } from '../../store/index.js'
import { ReleaseTrainPanel } from '../ReleaseTrainPanel/index.js'
import { cn } from '../../lib/utils.js'
import { Button } from '../ui/button.js'
import {
  Plus, X, ChevronDown, ChevronRight, Trash2,
  RefreshCw, ExternalLink, Zap, Wrench, Rocket, Send,
} from 'lucide-react'

type KanbanTab = 'board' | 'trains' | 'standbys'

const COLUMNS: Array<{ status: string; label: string; color: string; dot: string }> = [
  { status: 'open', label: 'Open', color: 'text-text-info', dot: 'bg-blue-200' },
  { status: 'in_progress', label: 'In Progress', color: 'text-block-teal', dot: 'bg-block-teal' },
  { status: 'pr_review', label: 'PR Review', color: 'text-yellow-200', dot: 'bg-yellow-200' },
  { status: 'landed', label: 'Landed', color: 'text-green-200', dot: 'bg-green-200' },
  { status: 'cancelled', label: 'Cancelled', color: 'text-text-tertiary', dot: 'bg-neutral-300' },
]

const STATUS_COLOR: Record<string, string> = {
  idle: 'text-text-tertiary',
  working: 'text-block-teal',
  stalled: 'text-yellow-200',
  zombie: 'text-red-200',
  done: 'text-green-200',
}

export function KanbanView() {
  const [tab, setTab] = useState<KanbanTab>('board')

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg-primary">
      {/* Tab bar */}
      <div className="flex gap-1 px-4 py-2 border-b border-border-primary shrink-0">
        {(['board', 'standbys', 'trains'] as const).map((t) => (
          <button
            key={t}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm transition-colors',
              tab === t
                ? 'bg-bg-secondary text-text-primary font-medium shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
            )}
            onClick={() => setTab(t)}
          >
            {t === 'board' ? 'Board' : t === 'standbys' ? 'Standbys' : 'Release Trains'}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === 'board' && <Board />}
        {tab === 'standbys' && <StandbysPanel />}
        {tab === 'trains' && <ReleaseTrainPanel />}
      </div>
    </div>
  )
}

// ── Board ────────────────────────────────────────────────────────────

function Board() {
  const _releaseTrains = useStore((s) => s.releaseTrains)
  const _agents = useStore((s) => s.agents)
  const rigs = useStore((s) => s.rigs)
  const _atomicTasks = useStore((s) => s.atomicTasks)
  const activeProjectId = useStore((s) => s.activeProjectId)

  const releaseTrains = activeProjectId ? _releaseTrains.filter((r) => r.projectId === activeProjectId) : _releaseTrains
  const agents = activeProjectId ? _agents.filter((a) => a.projectId === activeProjectId) : _agents
  const atomicTasks = activeProjectId ? _atomicTasks.filter((t) => t.projectId === activeProjectId) : _atomicTasks
  const updateReleaseTrain = useStore((s) => s.updateReleaseTrain)
  const addReleaseTrain = useStore((s) => s.addReleaseTrain)
  const addAgent = useStore((s) => s.addAgent)
  const addPaneToTab = useStore((s) => s.addPaneToTab)
  const addTab = useStore((s) => s.addTab)
  const activeTabId = useStore((s) => s.activeTabId)
  const tabs = useStore((s) => s.tabs)
  const addToast = useStore((s) => s.addToast)
  const templates = useStore((s) => s.templates)
  const removeAgent = useStore((s) => s.removeAgent)
  const removePaneFromAllTabs = useStore((s) => s.removePaneFromAllTabs)

  const [showNewForm, setShowNewForm] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', description: '', projectId: '' })
  const [creating, setCreating] = useState(false)
  const [autoDispatch, setAutoDispatch] = useState(true)
  const [isManual, setIsManual] = useState(false)
  const [creatingPr, setCreatingPr] = useState<string | null>(null)
  const [syncingPr, setSyncingPr] = useState<string | null>(null)
  const [restarting, setRestarting] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const agentById = Object.fromEntries(agents.map((a) => [a.id, a]))
  const rigNameById = Object.fromEntries(rigs.map((r) => [r.id, r.name]))

  const rtTaskCounts = Object.fromEntries(
    releaseTrains.map((c) => [c.id, {
      total: atomicTasks.filter((b) => c.atomicTaskIds.includes(b.id) || b.releaseTrainId === c.id).length,
      done: atomicTasks.filter((b) => (c.atomicTaskIds.includes(b.id) || b.releaseTrainId === c.id) && b.status === 'done').length,
    }])
  )

  const moveRT = async (id: string, status: string) => {
    const endpoints: Record<string, string> = { cancelled: 'cancel', landed: 'land', in_progress: 'start' }
    const ep = endpoints[status]
    if (!ep) return
    await apiFetch(`/api/release-trains/${id}/${ep}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    updateReleaseTrain(id, { status })
  }

  const deleteRT = async (id: string) => {
    setDeleting(id)
    try {
      const res = await apiFetch(`/api/release-trains/${id}`, { method: 'DELETE' })
      if (!res.ok) { addToast('Failed to delete'); return }
      // Remove from store by setting status to a sentinel, then rely on next data load
      // Or we can filter it out directly:
      useStore.setState((s) => ({
        releaseTrains: s.releaseTrains.filter((r) => r.id !== id),
        convoys: s.convoys.filter((r) => r.id !== id),
      }))
    } catch (err) {
      addToast(`Delete failed: ${(err as Error).message}`)
    } finally {
      setDeleting(null)
    }
  }

  const createPr = async (id: string) => {
    setCreatingPr(id)
    try {
      const res = await apiFetch(`/api/release-trains/${id}/create-pr`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (!res.ok) { addToast((await res.json().catch(() => ({}))).error ?? 'Failed'); return }
      const data = await res.json()
      updateReleaseTrain(id, { status: 'pr_review', prUrl: data.prUrl, prNumber: data.prNumber })
    } catch (err) { addToast(`PR failed: ${(err as Error).message}`) }
    finally { setCreatingPr(null) }
  }

  const syncPr = async (id: string) => {
    setSyncingPr(id)
    try {
      const res = await apiFetch(`/api/release-trains/${id}/sync-pr`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await res.json() as { landed?: boolean; state?: string; error?: string }
      if (data.error) { addToast(data.error); return }
      if (data.landed) updateReleaseTrain(id, { status: 'landed' })
      else addToast(`PR is ${data.state}`, 'info')
    } catch (err) { addToast(`Sync failed: ${(err as Error).message}`) }
    finally { setSyncingPr(null) }
  }

  const restartAgent = async (agentId: string, rtId: string) => {
    setRestarting(rtId)
    try {
      const res = await apiFetch(`/api/workerbees/${agentId}/restart`, { method: 'POST' })
      if (!res.ok) { addToast((await res.json().catch(() => ({}))).error ?? 'Failed'); return }
      const { bee } = await res.json()
      const old = agents.find((a) => a.id === agentId)
      if (old?.sessionId) removePaneFromAllTabs(old.sessionId)
      removeAgent(agentId)
      addAgent({ ...bee, taskDescription: bee.taskDescription ?? '', worktreePath: bee.worktreePath ?? '', branch: bee.branch ?? '' })
      updateReleaseTrain(rtId, { assignedWorkerBeeId: bee.id, status: 'in_progress' })
      if (bee.sessionId) { if (activeTabId) addPaneToTab(activeTabId, bee.sessionId); else addTab(bee.name, [bee.sessionId]) }
    } catch (err) { addToast(`Restart failed: ${(err as Error).message}`) }
    finally { setRestarting(null) }
  }

  const [dispatchingId, setDispatchingId] = useState<string | null>(null)
  const dispatch = async (id: string) => {
    setDispatchingId(id)
    try {
      const res = await apiFetch(`/api/release-trains/${id}/dispatch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Dispatch failed' }))
        useStore.getState().addToast(err.error || 'Dispatch failed')
        return
      }
      const data = await res.json()
      if (data.bee) {
        addAgent({ ...data.bee, taskDescription: data.bee.taskDescription ?? '', worktreePath: data.bee.worktreePath ?? '', branch: data.bee.branch ?? '' })
        useStore.getState().addToast(`Agent ${data.bee.name} dispatched!`, 'info')
      }
      if (data.releaseTrain) updateReleaseTrain(id, { assignedWorkerBeeId: data.releaseTrain.assignedWorkerBeeId, status: data.releaseTrain.status })
      // Switch to Agents view to see the chat
      useStore.getState().setMainView('terminals')
      // Refresh agents list
      const agentsRes = await apiFetch('/api/workerbees')
      if (agentsRes.ok) useStore.getState().setAgents(await agentsRes.json())
    } catch (err) {
      useStore.getState().addToast(`Dispatch failed: ${(err as Error).message}`)
    } finally {
      setDispatchingId(null)
    }
  }

  const handleCreate = async () => {
    const projectId = newForm.projectId || (activeProjectId ?? rigs[0]?.id)
    if (!newForm.name.trim() || !projectId) return
    setCreating(true)
    try {
      const res = await apiFetch('/api/release-trains', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newForm.name.trim(), description: newForm.description.trim(), projectId, manual: isManual }) })
      const created = await res.json()
      addReleaseTrain(created)
      setShowNewForm(false); setNewForm({ name: '', description: '', projectId: '' })
      if (!isManual && autoDispatch) await dispatch(created.id)
    } finally { setCreating(false) }
  }

  const openTerminal = (bee: { sessionId: string | null; name: string }) => {
    if (!bee.sessionId) return
    if (!tabs.some((t) => t.panes.includes(bee.sessionId!))) {
      if (activeTabId) addPaneToTab(activeTabId, bee.sessionId); else addTab(bee.name, [bee.sessionId])
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {COLUMNS.map((col) => {
        const cards = releaseTrains.filter((c) => c.status === col.status)
        return (
          <div key={col.status} className="flex-1 flex flex-col border-r border-border-primary last:border-r-0 overflow-hidden min-w-[200px]">
            {/* Column header */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border-primary bg-bg-secondary shrink-0">
              <span className={cn('w-2 h-2 rounded-full shrink-0', col.dot)} />
              <span className={cn('text-xs font-medium uppercase tracking-wider flex-1', col.color)}>{col.label}</span>
              <span className="text-xs text-text-tertiary">{cards.length}</span>
              {col.status === 'open' && (
                <button className="text-text-tertiary hover:text-text-primary transition-colors" onClick={() => setShowNewForm((v) => !v)}>
                  <Plus className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* New form */}
            {col.status === 'open' && showNewForm && (
              <div className="p-3 border-b border-border-primary bg-bg-secondary flex flex-col gap-2">
                {templates.length > 0 && (
                  <select className="w-full bg-bg-primary border border-border-primary rounded-md px-2.5 py-1.5 text-sm outline-none" defaultValue=""
                    onChange={(e) => { const tpl = templates.find((t) => t.id === e.target.value); if (tpl) setNewForm((f) => ({ ...f, name: f.name || tpl.name, description: tpl.content, projectId: f.projectId || tpl.projectId })) }}>
                    <option value="" disabled>Use a standby template…</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
                <input ref={(el) => { if (el) setTimeout(() => el.focus(), 100) }} className="w-full bg-bg-primary border border-border-primary rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-block-teal" placeholder="Task name…" value={newForm.name} onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }} />
                <textarea className="w-full bg-bg-primary border border-border-primary rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-block-teal resize-y min-h-[48px]" placeholder={isManual ? 'Description…' : "Agent instructions…"} value={newForm.description} rows={2} onChange={(e) => setNewForm((f) => ({ ...f, description: e.target.value }))} />
                {rigs.length > 1 && !activeProjectId && (
                  <select className="w-full bg-bg-primary border border-border-primary rounded-md px-2.5 py-1.5 text-sm outline-none" value={newForm.projectId || rigs[0]?.id} onChange={(e) => setNewForm((f) => ({ ...f, projectId: e.target.value }))}>
                    {rigs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                )}
                <div className="flex gap-1.5">
                  <button className={cn('flex-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors', !isManual ? 'bg-blue-200/10 border-blue-200/30 text-text-info' : 'border-border-primary text-text-tertiary hover:text-text-secondary')} onClick={() => setIsManual(false)}>
                    <Zap className="w-3 h-3 inline mr-1" />AI task
                  </button>
                  <button className={cn('flex-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors', isManual ? 'bg-yellow-200/10 border-yellow-200/30 text-yellow-200' : 'border-border-primary text-text-tertiary hover:text-text-secondary')} onClick={() => setIsManual(true)}>
                    <Wrench className="w-3 h-3 inline mr-1" />Manual
                  </button>
                </div>
                {!isManual && (
                  <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
                    <input type="checkbox" checked={autoDispatch} onChange={(e) => setAutoDispatch(e.target.checked)} className="accent-block-teal" />
                    Auto-dispatch agent
                  </label>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleCreate} disabled={creating || !newForm.name.trim()} className="flex-1">
                    {creating ? '…' : isManual ? 'Create' : autoDispatch ? 'Create & Dispatch' : 'Create'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowNewForm(false)}>Cancel</Button>
                </div>
              </div>
            )}

            {/* Cards */}
            <div className="flex-1 overflow-auto p-2 flex flex-col gap-2">
              {cards.map((rt) => {
                const bee = rt.assignedWorkerBeeId ? agentById[rt.assignedWorkerBeeId] : null
                const counts = rtTaskCounts[rt.id] ?? { total: 0, done: 0 }
                return (
                  <div key={rt.id} className={cn('border rounded-lg p-3 flex flex-col gap-2 transition-colors hover:shadow-sm', rt.manual ? 'border-yellow-200/20 bg-yellow-200/5' : 'border-border-primary bg-bg-primary')}>
                    {/* Title + delete */}
                    <div className="flex items-start gap-1.5">
                      <span className="text-sm text-text-primary font-medium leading-snug flex-1">{rt.name}</span>
                      {rt.manual && <span className="text-[10px] text-yellow-200 bg-yellow-200/10 border border-yellow-200/20 rounded px-1.5 py-0.5 shrink-0">manual</span>}
                      <button
                        className="text-text-tertiary hover:text-text-danger transition-colors shrink-0 p-0.5"
                        onClick={() => deleteRT(rt.id)}
                        disabled={deleting === rt.id}
                        title="Delete"
                      >
                        {deleting === rt.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    {/* Description */}
                    {rt.description && (
                      <p className="text-xs text-text-secondary overflow-hidden text-ellipsis whitespace-nowrap">{rt.description}</p>
                    )}

                    {/* Meta */}
                    <div className="flex gap-2 items-center text-xs">
                      <span className="text-text-info">{rigNameById[rt.projectId] ?? rt.projectId.slice(0, 8)}</span>
                      {counts.total > 0 && <span className="text-text-tertiary">{counts.done}/{counts.total} tasks</span>}
                    </div>

                    {/* Assigned agent */}
                    {!rt.manual && bee && (
                      <div className="flex items-center gap-2 py-1 px-2 bg-bg-secondary rounded-md">
                        <span className={cn('text-sm', STATUS_COLOR[bee.status] ?? 'text-text-tertiary')}>●</span>
                        <span className="text-xs text-text-primary flex-1 truncate cursor-pointer hover:underline" onClick={() => openTerminal(bee)}>{bee.name}</span>
                        <span className={cn('text-[11px]', STATUS_COLOR[bee.status])}>{bee.status}</span>
                        {(bee.status === 'zombie' || bee.status === 'stalled') && (
                          <button className="text-yellow-200 hover:text-yellow-100 transition-colors" onClick={() => restartAgent(bee.id, rt.id)} disabled={restarting === rt.id}>
                            <RefreshCw className={cn('w-3.5 h-3.5', restarting === rt.id && 'animate-spin')} />
                          </button>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex flex-wrap gap-1.5">
                      {rt.manual ? (
                        <>
                          {col.status === 'open' && <ActionBtn onClick={() => moveRT(rt.id, 'in_progress')}>Start</ActionBtn>}
                          {(col.status === 'open' || col.status === 'in_progress') && <ActionBtn variant="success" onClick={() => moveRT(rt.id, 'landed')}>Land</ActionBtn>}
                          {col.status !== 'open' && col.status !== 'cancelled' && <ActionBtn onClick={() => moveRT(rt.id, 'cancelled')}>Cancel</ActionBtn>}
                        </>
                      ) : (
                        <>
                          {col.status === 'open' && <ActionBtn onClick={() => dispatch(rt.id)} disabled={dispatchingId === rt.id}>{dispatchingId === rt.id ? 'Dispatching…' : 'Dispatch'}</ActionBtn>}
                          {col.status === 'in_progress' && !bee && <ActionBtn onClick={() => dispatch(rt.id)} disabled={dispatchingId === rt.id}>{dispatchingId === rt.id ? 'Dispatching…' : 'Re-dispatch'}</ActionBtn>}
                          {col.status === 'in_progress' && bee && (
                            <ActionBtn variant="warning" onClick={() => createPr(rt.id)} disabled={creatingPr === rt.id}>
                              {creatingPr === rt.id ? '…' : 'Create PR'}
                            </ActionBtn>
                          )}
                          {col.status === 'in_progress' && <ActionBtn variant="success" onClick={() => moveRT(rt.id, 'landed')}>Land</ActionBtn>}
                          {col.status === 'pr_review' && (
                            <>
                              {rt.prUrl && (
                                <a href={rt.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-yellow-200 bg-yellow-200/10 border border-yellow-200/20 rounded-md px-2 py-1 no-underline hover:bg-yellow-200/15">
                                  #{rt.prNumber} <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                              <ActionBtn variant="warning" onClick={() => syncPr(rt.id)} disabled={syncingPr === rt.id}>{syncingPr === rt.id ? '…' : 'Sync'}</ActionBtn>
                              <ActionBtn variant="success" onClick={() => moveRT(rt.id, 'landed')}>Land</ActionBtn>
                              <ActionBtn onClick={() => moveRT(rt.id, 'cancelled')}>Cancel</ActionBtn>
                            </>
                          )}
                          {col.status === 'in_progress' && (
                            <ActionBtn onClick={() => moveRT(rt.id, 'cancelled')}>Cancel</ActionBtn>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
              {cards.length === 0 && (
                <div className="text-text-tertiary text-xs text-center py-6">
                  No {col.label.toLowerCase()} items
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Action button helper ─────────────────────────────────────────────

function ActionBtn({ children, variant, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'success' | 'warning' }) {
  return (
    <button
      className={cn(
        'rounded-md border px-2 py-1 text-xs transition-colors',
        variant === 'success' && 'border-green-200/30 text-green-200 hover:bg-green-200/10',
        variant === 'warning' && 'border-yellow-200/30 text-yellow-200 hover:bg-yellow-200/10',
        !variant && 'border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover',
        'disabled:opacity-40',
      )}
      {...props}
    >
      {children}
    </button>
  )
}

// ── Standbys ─────────────────────────────────────────────────────────

function StandbysPanel() {
  const templates = useStore((s) => s.templates)
  const rigs = useStore((s) => s.rigs)
  const addAgent = useStore((s) => s.addAgent)
  const addReleaseTrain = useStore((s) => s.addReleaseTrain)
  const updateReleaseTrain = useStore((s) => s.updateReleaseTrain)
  const addTemplate = useStore((s) => s.addTemplate)
  const removeTemplate = useStore((s) => s.removeTemplate)
  const addPaneToTab = useStore((s) => s.addPaneToTab)
  const addTab = useStore((s) => s.addTab)
  const activeTabId = useStore((s) => s.activeTabId)
  const tabs = useStore((s) => s.tabs)
  const activeProjectId = useStore((s) => s.activeProjectId)

  const rigNameById = Object.fromEntries(rigs.map((r) => [r.id, r.name]))
  const [localProjectId, setLocalProjectId] = useState('')
  const resolvedProjectId = activeProjectId ?? (localProjectId || rigs[0]?.id || '')

  const [expanded, setExpanded] = useState<string | null>(null)
  const [dispatching, setDispatching] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', content: '', projectId: '' })
  const [saving, setSaving] = useState(false)

  const filteredTemplates = activeProjectId
    ? templates.filter((t) => t.projectId === activeProjectId || t.projectId === 'system')
    : templates

  const handleDispatch = async (tpl: TemplateEntry) => {
    const projectId = tpl.projectId === 'system' ? resolvedProjectId : tpl.projectId
    if (!projectId) return
    setDispatching(tpl.id)
    try {
      const rtRes = await apiFetch('/api/release-trains', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: tpl.name, description: tpl.content, projectId }) })
      const rt = await rtRes.json()
      addReleaseTrain(rt)
      const dRes = await apiFetch(`/api/release-trains/${rt.id}/dispatch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await dRes.json()
      if (data.bee) addAgent({ ...data.bee, taskDescription: data.bee.taskDescription ?? '', worktreePath: data.bee.worktreePath ?? '', branch: data.bee.branch ?? '' })
      if (data.releaseTrain) updateReleaseTrain(rt.id, { assignedWorkerBeeId: data.releaseTrain.assignedWorkerBeeId, status: data.releaseTrain.status })
      if (data.bee?.sessionId && !tabs.some((t) => t.panes.includes(data.bee.sessionId))) {
        if (activeTabId) addPaneToTab(activeTabId, data.bee.sessionId); else addTab(data.bee.name, [data.bee.sessionId])
      }
    } finally { setDispatching(null) }
  }

  const handleSave = async () => {
    const projectId = form.projectId || resolvedProjectId
    if (!form.name.trim() || !form.content.trim() || !projectId) return
    setSaving(true)
    try {
      const res = await apiFetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.name.trim(), content: form.content.trim(), projectId }) })
      addTemplate(await res.json())
      setForm({ name: '', content: '', projectId: '' }); setShowForm(false)
    } finally { setSaving(false) }
  }

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/templates/${id}`, { method: 'DELETE' })
    removeTemplate(id)
  }

  return (
    <div className="flex flex-col h-full overflow-auto p-5 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-text-primary">Standby Templates</h2>
        <span className="text-xs text-text-tertiary">One-click dispatch</span>
      </div>

      {/* Project context (only show if viewing all projects) */}
      {!activeProjectId && rigs.length > 1 && (
        <div className="flex items-center gap-2 bg-bg-secondary rounded-lg px-3 py-2">
          <span className="text-xs text-text-tertiary">Project</span>
          <select className="bg-transparent border-none text-sm text-text-primary outline-none cursor-pointer" value={resolvedProjectId} onChange={(e) => setLocalProjectId(e.target.value)}>
            {rigs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
      )}

      {/* Empty state */}
      {filteredTemplates.length === 0 && !showForm && (
        <p className="text-text-tertiary text-sm py-4">No standby templates yet. Create one to define a repeatable job.</p>
      )}

      {/* Template cards */}
      {filteredTemplates.map((tpl) => (
        <div key={tpl.id} className="bg-bg-primary border border-border-primary rounded-lg p-4 flex flex-col gap-2 hover:shadow-sm transition-shadow">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary flex-1">{tpl.name}</span>
            <span className="text-xs text-text-info">{tpl.projectId === 'system' ? 'system' : rigNameById[tpl.projectId] ?? '?'}</span>
            <button className="text-text-tertiary hover:text-text-danger transition-colors" onClick={() => handleDelete(tpl.id)} title="Delete">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className={cn('text-xs text-text-secondary whitespace-pre-wrap', expanded === tpl.id ? '' : 'max-h-16 overflow-hidden')}>
            {tpl.content}
          </div>
          <div className="flex gap-2 items-center">
            <Button variant="outline" size="xs" onClick={() => handleDispatch(tpl)} disabled={dispatching === tpl.id}>
              {dispatching === tpl.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <><Rocket className="w-3 h-3" /> Dispatch</>}
            </Button>
            <button className="text-xs text-text-tertiary hover:text-text-secondary inline-flex items-center gap-0.5" onClick={() => setExpanded(expanded === tpl.id ? null : tpl.id)}>
              {expanded === tpl.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {expanded === tpl.id ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </div>
      ))}

      {/* Add form */}
      {showForm ? (
        <div className="border border-dashed border-border-primary rounded-lg p-4 bg-bg-secondary flex flex-col gap-3">
          <input className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm outline-none focus:border-block-teal" placeholder="Standby name (e.g. Security Review)" value={form.name} autoFocus onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <textarea className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm outline-none focus:border-block-teal resize-y min-h-[100px]" placeholder="Agent instructions…" value={form.content} rows={5} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} />
          {rigs.length > 1 && !activeProjectId && (
            <select className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm outline-none" value={form.projectId || rigs[0]?.id} onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}>
              {rigs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleSave} disabled={saving || !form.name.trim() || !form.content.trim()}>
              {saving ? '…' : 'Save Standby'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <button className="border border-dashed border-border-primary rounded-lg px-4 py-3 text-sm text-text-tertiary hover:text-text-secondary hover:border-border-secondary transition-colors inline-flex items-center gap-2" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> New Standby
        </button>
      )}
    </div>
  )
}
