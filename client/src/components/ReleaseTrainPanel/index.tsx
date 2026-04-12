import { useState } from 'react'
import { Train, GitBranch, Play, CheckCircle, XCircle } from 'lucide-react'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'
import { cn } from '../../lib/utils.js'
import type { ReleaseTrainEntry } from '../../store/index.js'

const ATOMIC_TASK_STATUS_COLOR: Record<string, string> = {
  open: 'text-text-info',
  assigned: 'text-block-teal',
  done: 'text-[#608b4e]',
  cancelled: 'text-text-tertiary',
}

const STATUS_COLOR: Record<string, string> = {
  open: 'text-text-info',
  in_progress: 'text-block-teal',
  landed: 'text-[#608b4e]',
  cancelled: 'text-text-tertiary',
}

export function ReleaseTrainPanel() {
  const releaseTrains = useStore((s) => s.releaseTrains)
  const setReleaseTrains = useStore((s) => s.setReleaseTrains)
  const agents = useStore((s) => s.agents)
  const rigs = useStore((s) => s.rigs)
  const atomicTasks = useStore((s) => s.atomicTasks)
  const templates = useStore((s) => s.templates)
  const addPaneToTab = useStore((s) => s.addPaneToTab)
  const addTab = useStore((s) => s.addTab)
  const activeTabId = useStore((s) => s.activeTabId)
  const tabs = useStore((s) => s.tabs)
  const updateReleaseTrain = useStore((s) => s.updateReleaseTrain)
  const addReleaseTrain = useStore((s) => s.addReleaseTrain)
  const addToast = useStore((s) => s.addToast)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', projectId: '' })
  const [assigning, setAssigning] = useState<string | null>(null)
  const [dispatching, setDispatching] = useState<string | null>(null)
  const [editingDesc, setEditingDesc] = useState<string | null>(null)
  const [editDescText, setEditDescText] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [addingAtomicTasks, setAddingAtomicTasks] = useState<string | null>(null)
  const [atomicTaskSelection, setAtomicTaskSelection] = useState<string[]>([])
  const [dispatchingWithTemplate, setDispatchingWithTemplate] = useState<string | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState('')

  void setReleaseTrains

  const handleCreate = async () => {
    if (!form.name || !form.projectId) return
    try {
      const res = await apiFetch('/api/release-trains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error(await res.text())
      const releaseTrain = await res.json()
      addReleaseTrain(releaseTrain)
      setForm({ name: '', description: '', projectId: '' })
      setShowForm(false)
    } catch (err) {
      addToast(`Failed to create release train: ${(err as Error).message}`)
    }
  }

  const handleAssign = async (releaseTrainId: string, workerBeeId: string | null) => {
    const res = await apiFetch(`/api/release-trains/${releaseTrainId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerBeeId }),
    })
    const updated = await res.json()
    updateReleaseTrain(releaseTrainId, {
      assignedWorkerBeeId: updated.assignedWorkerBeeId,
      status: updated.status,
    })
    setAssigning(null)
  }

  const handleSaveDesc = async (releaseTrainId: string) => {
    await apiFetch(`/api/release-trains/${releaseTrainId}/description`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: editDescText }),
    })
    updateReleaseTrain(releaseTrainId, { description: editDescText })
    setEditingDesc(null)
  }

  const handleAddAtomicTasks = async (releaseTrainId: string) => {
    if (atomicTaskSelection.length === 0) { setAddingAtomicTasks(null); return }
    const res = await apiFetch(`/api/release-trains/${releaseTrainId}/atomictasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ atomicTaskIds: atomicTaskSelection }),
    })
    const updated = await res.json()
    updateReleaseTrain(releaseTrainId, { atomicTaskIds: updated.atomicTaskIds })
    setAddingAtomicTasks(null)
    setAtomicTaskSelection([])
  }

  const handleRemoveAtomicTask = async (releaseTrain: ReleaseTrainEntry, atomicTaskId: string) => {
    const res = await apiFetch(`/api/release-trains/${releaseTrain.id}/atomictasks`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ atomicTaskIds: [atomicTaskId] }),
    })
    const updated = await res.json()
    updateReleaseTrain(releaseTrain.id, { atomicTaskIds: updated.atomicTaskIds })
  }

  const handleDispatch = async (releaseTrainId: string) => {
    setDispatching(releaseTrainId)
    try {
      const res = await apiFetch(`/api/release-trains/${releaseTrainId}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(await res.text())
      const { bee, releaseTrain } = await res.json()
      updateReleaseTrain(releaseTrainId, {
        assignedWorkerBeeId: releaseTrain.assignedWorkerBeeId,
        status: releaseTrain.status,
      })
      if (bee?.sessionId) {
        const hasSession = tabs.some((t) => t.panes.includes(bee.sessionId))
        if (!hasSession) {
          if (activeTabId) addPaneToTab(activeTabId, bee.sessionId)
          else addTab(bee.name, [bee.sessionId])
        }
      }
    } catch (err) {
      addToast(`Dispatch failed: ${(err as Error).message}`)
    } finally {
      setDispatching(null)
    }
  }

  void handleDispatch

  const idleAgents = agents.filter((a) => a.status === 'idle' || a.status === 'working')
  const rigNameById = Object.fromEntries(rigs.map((r) => [r.id, r.name]))
  const agentNameById = Object.fromEntries(agents.map((a) => [a.id, a.name]))
  const atomicTaskById = Object.fromEntries(atomicTasks.map((b) => [b.id, b]))

  return (
    <div className="flex flex-col overflow-auto flex-1">
      {releaseTrains.map((releaseTrain) => (
        <div key={releaseTrain.id} className="px-2 py-1.5 border-b border-border-primary">
          <div className="flex justify-between items-center">
            <span className="flex items-center gap-1.5 text-xs text-text-primary font-mono">
              <Train className="w-3 h-3 text-text-info shrink-0" />
              {releaseTrain.name}
            </span>
            <span className={cn(
              'text-[10px] font-mono',
              STATUS_COLOR[releaseTrain.status] ?? 'text-text-secondary'
            )}>
              {releaseTrain.status}
            </span>
          </div>

          {editingDesc === releaseTrain.id ? (
            <div className="mt-1 flex flex-col gap-1">
              <textarea
                className="w-full bg-bg-secondary border border-border-primary text-text-primary rounded px-1.5 py-1 text-[10px] font-mono outline-none resize-y box-border"
                value={editDescText}
                onChange={(e) => setEditDescText(e.target.value)}
                autoFocus
                rows={3}
              />
              <div className="flex gap-1">
                <button
                  className="bg-transparent border border-block-teal text-block-teal rounded px-1.5 py-px cursor-pointer text-[9px] font-mono"
                  onClick={() => handleSaveDesc(releaseTrain.id)}
                >
                  save
                </button>
                <button
                  className="bg-transparent border border-border-primary text-text-tertiary rounded px-1.5 py-px cursor-pointer text-[9px] font-mono"
                  onClick={() => setEditingDesc(null)}
                >
                  cancel
                </button>
              </div>
            </div>
          ) : (
            <div
              className="text-[10px] text-text-secondary font-mono mt-0.5 truncate cursor-text"
              onClick={() => { setEditingDesc(releaseTrain.id); setEditDescText(releaseTrain.description) }}
              title="Click to edit description"
            >
              {releaseTrain.description || <span className="text-text-disabled">add description…</span>}
            </div>
          )}

          <div className="flex gap-2 mt-0.5">
            <span className="flex items-center gap-1 text-[10px] text-text-info font-mono">
              <GitBranch className="w-2.5 h-2.5" />
              {rigNameById[releaseTrain.projectId] ?? releaseTrain.projectId.slice(0, 8)}
            </span>
            <span
              className="text-[10px] text-text-tertiary font-mono cursor-pointer underline"
              onClick={() => setExpandedId(expandedId === releaseTrain.id ? null : releaseTrain.id)}
              title="Show atomic tasks"
            >
              {releaseTrain.atomicTaskIds.length} atomic tasks
            </span>
          </div>

          {expandedId === releaseTrain.id && (
            <div className="mt-1 bg-bg-primary border border-border-primary rounded px-1.5 py-1 flex flex-col gap-1">
              {releaseTrain.atomicTaskIds.length === 0 && (
                <span className="text-[9px] text-text-disabled font-mono">no atomic tasks</span>
              )}
              {releaseTrain.atomicTaskIds.map((atid) => {
                const atomicTask = atomicTaskById[atid]
                return (
                  <div key={atid} className="flex items-center gap-1">
                    <span className="flex-1 text-[10px] text-text-secondary font-mono truncate">
                      {atomicTask?.title ?? atid.slice(0, 8)}
                    </span>
                    {atomicTask && (
                      <span className={cn(
                        'text-[9px] font-mono shrink-0',
                        ATOMIC_TASK_STATUS_COLOR[atomicTask.status] ?? 'text-text-tertiary'
                      )}>
                        {atomicTask.status}
                      </span>
                    )}
                    <button
                      className="bg-transparent border-none text-text-disabled cursor-pointer text-[9px] p-0 px-0.5 shrink-0 hover:text-text-danger"
                      onClick={() => handleRemoveAtomicTask(releaseTrain, atid)}
                      title="Remove from release train"
                    >
                      <XCircle className="w-3 h-3" />
                    </button>
                  </div>
                )
              })}

              {addingAtomicTasks === releaseTrain.id ? (
                <div className="flex flex-col gap-1">
                  <div className="flex flex-col gap-0.5 max-h-20 overflow-y-auto bg-bg-primary border border-border-primary rounded px-1.5 py-1">
                    {atomicTasks
                      .filter((b) => b.projectId === releaseTrain.projectId && !releaseTrain.atomicTaskIds.includes(b.id))
                      .map((b) => (
                        <label key={b.id} className="flex items-center cursor-pointer font-mono">
                          <input
                            type="checkbox"
                            checked={atomicTaskSelection.includes(b.id)}
                            onChange={() => setAtomicTaskSelection((prev) =>
                              prev.includes(b.id) ? prev.filter((x) => x !== b.id) : [...prev, b.id]
                            )}
                            className="mr-1"
                          />
                          <span className={cn(
                            'text-[9px]',
                            atomicTaskSelection.includes(b.id) ? 'text-text-primary' : 'text-text-tertiary'
                          )}>
                            {b.title}
                          </span>
                        </label>
                      ))}
                  </div>
                  <div className="flex gap-1">
                    <button
                      className="bg-transparent border border-block-teal text-block-teal rounded px-2 py-px cursor-pointer text-[9px] font-mono"
                      onClick={() => handleAddAtomicTasks(releaseTrain.id)}
                    >
                      add
                    </button>
                    <button
                      className="bg-transparent border-none text-text-tertiary cursor-pointer text-[10px]"
                      onClick={() => { setAddingAtomicTasks(null); setAtomicTaskSelection([]) }}
                    >
                      cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="bg-transparent border border-dashed border-border-primary text-text-disabled rounded px-1.5 py-0.5 cursor-pointer text-[9px] font-mono text-left hover:text-text-tertiary"
                  onClick={() => { setAddingAtomicTasks(releaseTrain.id); setAtomicTaskSelection([]) }}
                >
                  + add atomic task
                </button>
              )}
            </div>
          )}

          {releaseTrain.assignedWorkerBeeId ? (
            <div className="flex items-center gap-1 mt-1">
              <span className="text-[10px] text-text-tertiary font-mono">→</span>
              <span className="flex-1 text-[10px] text-block-teal font-mono">
                {agentNameById[releaseTrain.assignedWorkerBeeId] ?? releaseTrain.assignedWorkerBeeId.slice(0, 8)}
              </span>
              <button
                className="bg-transparent border-none text-text-tertiary cursor-pointer text-[10px] p-0 px-0.5 hover:text-text-danger"
                onClick={() => handleAssign(releaseTrain.id, null)}
                title="Unassign"
              >
                <XCircle className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="flex gap-1 mt-1">
              {assigning === releaseTrain.id ? (
                <div className="flex gap-1 flex-1">
                  <select
                    className="flex-1 bg-bg-secondary border border-border-primary text-text-primary rounded text-[10px] font-mono px-1 py-0.5"
                    defaultValue=""
                    onChange={(e) => { if (e.target.value) handleAssign(releaseTrain.id, e.target.value) }}
                  >
                    <option value="" disabled>assign agent…</option>
                    {idleAgents.map((a) => (
                      <option key={a.id} value={a.id}>{a.name} ({a.status})</option>
                    ))}
                  </select>
                  <button
                    className="bg-transparent border-none text-text-tertiary cursor-pointer text-[10px]"
                    onClick={() => setAssigning(null)}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <>
                  <button
                    className="bg-transparent border border-border-primary text-text-secondary rounded px-1.5 py-0.5 cursor-pointer text-[10px] font-mono hover:border-border-primary"
                    onClick={() => setAssigning(releaseTrain.id)}
                    title="Assign existing Agent"
                  >
                    assign
                  </button>
                  {dispatchingWithTemplate === releaseTrain.id ? (
                    <div className="flex gap-1 flex-1 items-center">
                      <select
                        className="flex-1 bg-bg-secondary border border-border-primary text-text-primary rounded text-[10px] font-mono px-1 py-0.5"
                        value={selectedTemplateId}
                        onChange={(e) => setSelectedTemplateId(e.target.value)}
                      >
                        <option value="">no template</option>
                        {templates
                          .filter((t) => t.projectId === releaseTrain.projectId)
                          .map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                      </select>
                      <button
                        className="bg-transparent border border-block-teal text-block-teal rounded px-1.5 py-0.5 cursor-pointer text-[10px] font-mono disabled:opacity-50"
                        onClick={async () => {
                          const tmpl = templates.find((t) => t.id === selectedTemplateId)
                          setDispatchingWithTemplate(null)
                          setDispatching(releaseTrain.id)
                          try {
                            const res = await apiFetch(`/api/release-trains/${releaseTrain.id}/dispatch`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify(tmpl ? { taskDescription: tmpl.content } : {}),
                            })
                            const data = await res.json()
                            const updatedReleaseTrain = data.releaseTrain
                            if (updatedReleaseTrain) {
                              updateReleaseTrain(releaseTrain.id, {
                                assignedWorkerBeeId: updatedReleaseTrain.assignedWorkerBeeId,
                                status: updatedReleaseTrain.status,
                              })
                            }
                            if (data.bee?.sessionId) {
                              const hasSession = tabs.some((t) => t.panes.includes(data.bee.sessionId))
                              if (!hasSession) {
                                if (activeTabId) addPaneToTab(activeTabId, data.bee.sessionId)
                                else addTab(data.bee.name, [data.bee.sessionId])
                              }
                            }
                          } finally {
                            setDispatching(null)
                          }
                        }}
                        disabled={dispatching === releaseTrain.id}
                      >
                        <Play className="w-3 h-3" />
                      </button>
                      <button
                        className="bg-transparent border-none text-text-tertiary cursor-pointer text-[10px]"
                        onClick={() => setDispatchingWithTemplate(null)}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      className="bg-transparent border border-block-teal text-block-teal rounded px-1.5 py-0.5 cursor-pointer text-[10px] font-mono disabled:opacity-50 flex items-center gap-1"
                      onClick={() => { setDispatchingWithTemplate(releaseTrain.id); setSelectedTemplateId('') }}
                      disabled={dispatching === releaseTrain.id}
                      title="Spawn a new Agent and assign"
                    >
                      <Play className="w-3 h-3" />
                      {dispatching === releaseTrain.id ? '…' : 'dispatch'}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      ))}

      {showForm ? (
        <div className="flex flex-col gap-1 px-2 py-1.5 border-t border-border-primary">
          <input
            className="w-full bg-bg-secondary border border-border-primary text-text-primary rounded px-1.5 py-1 text-[11px] font-mono outline-none box-border"
            placeholder="Release train name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <textarea
            className="w-full bg-bg-secondary border border-border-primary text-text-primary rounded px-1.5 py-1 text-[11px] font-mono outline-none box-border resize-y min-h-[60px]"
            placeholder="Task description (becomes CLAUDE.md when dispatched)"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
          <select
            className="w-full bg-bg-secondary border border-border-primary text-text-primary rounded px-1.5 py-1 text-[11px] font-mono outline-none box-border"
            value={form.projectId}
            onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}
          >
            <option value="" disabled>select project…</option>
            {rigs.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <div className="flex gap-1">
            <button
              className="flex-1 bg-block-teal/10 border border-block-teal text-block-teal rounded py-1 cursor-pointer text-[11px] font-mono flex items-center justify-center gap-1"
              onClick={handleCreate}
            >
              <CheckCircle className="w-3 h-3" />
              Create
            </button>
            <button
              className="flex-1 bg-transparent border border-border-primary text-text-tertiary rounded py-1 cursor-pointer text-[11px] font-mono"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          className="mx-2 my-1 flex items-center gap-1 bg-transparent border border-dashed border-border-primary text-text-info rounded px-2 py-1 cursor-pointer text-[11px] font-mono text-left hover:border-blue-200/50"
          onClick={() => setShowForm(true)}
        >
          <Train className="w-3 h-3" />
          New Release Train
        </button>
      )}
    </div>
  )
}
