import { useState } from 'react'
import { ListChecks, CheckSquare, Square, Circle, AlertTriangle } from 'lucide-react'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'
import { cn } from '../../lib/utils.js'
import type { AtomicTaskEntry } from '../../store/index.js'

const STATUS_COLOR: Record<string, string> = {
  open: 'text-text-info',
  assigned: 'text-block-teal',
  done: 'text-[#608b4e]',
  cancelled: 'text-text-tertiary',
}

export function AtomicTasksPanel() {
  const atomicTasks = useStore((s) => s.atomicTasks)
  const releaseTrains = useStore((s) => s.releaseTrains)
  const rigs = useStore((s) => s.rigs)
  const agents = useStore((s) => s.agents)
  const addAtomicTask = useStore((s) => s.addAtomicTask)
  const updateAtomicTask = useStore((s) => s.updateAtomicTask)
  const addToast = useStore((s) => s.addToast)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ title: '', description: '', projectId: '', releaseTrainId: '' })
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [editingDeps, setEditingDeps] = useState<string | null>(null)
  const [depsSelection, setDepsSelection] = useState<string[]>([])
  const [assigningAtomicTaskId, setAssigningAtomicTaskId] = useState<string | null>(null)

  const releaseTrainNameById = Object.fromEntries(releaseTrains.map((c) => [c.id, c.name]))
  const rigNameById = Object.fromEntries(rigs.map((r) => [r.id, r.name]))
  const agentNameById = Object.fromEntries(agents.map((a) => [a.id, a.name]))
  const atomicTaskTitleById = Object.fromEntries(atomicTasks.map((b) => [b.id, b.title]))

  const filteredAtomicTasks = filterStatus === 'all'
    ? atomicTasks
    : atomicTasks.filter((b) => b.status === filterStatus)

  const handleCreate = async () => {
    if (!form.title || !form.projectId) return
    try {
      const body: Record<string, unknown> = {
        title: form.title,
        projectId: form.projectId,
      }
      if (form.description) body.description = form.description
      if (form.releaseTrainId) body.releaseTrainId = form.releaseTrainId

      const res = await apiFetch('/api/atomictasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const atomicTask = await res.json()
      addAtomicTask({ ...atomicTask, dependsOn: atomicTask.dependsOn ?? [] })
      setForm({ title: '', description: '', projectId: '', releaseTrainId: '' })
      setShowForm(false)
    } catch (err) {
      addToast(`Failed to create atomic task: ${(err as Error).message}`)
    }
  }

  const handleMarkDone = async (atomicTask: AtomicTaskEntry) => {
    try {
      await apiFetch(`/api/atomictasks/${atomicTask.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      })
      updateAtomicTask(atomicTask.id, { status: 'done' })
    } catch (err) {
      addToast(`Failed to mark atomic task done: ${(err as Error).message}`)
    }
  }

  const handleCancel = async (atomicTask: AtomicTaskEntry) => {
    try {
      await apiFetch(`/api/atomictasks/${atomicTask.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      updateAtomicTask(atomicTask.id, { status: 'cancelled' })
    } catch (err) {
      addToast(`Failed to cancel atomic task: ${(err as Error).message}`)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/api/atomictasks/${id}`, { method: 'DELETE' })
      const fresh = await apiFetch('/api/atomictasks').then((r) => r.json())
      useStore.getState().setAtomicTasks(fresh)
    } catch (err) {
      addToast(`Failed to delete atomic task: ${(err as Error).message}`)
    }
  }

  const handleSaveDeps = async (atomicTaskId: string) => {
    try {
      await apiFetch(`/api/atomictasks/${atomicTaskId}/dependencies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dependsOn: depsSelection }),
      })
      updateAtomicTask(atomicTaskId, { dependsOn: depsSelection })
      setEditingDeps(null)
    } catch (err) {
      addToast(`Failed to save dependencies: ${(err as Error).message}`)
    }
  }

  const handleAssignAtomicTask = async (atomicTaskId: string, workerBeeId: string) => {
    try {
      await apiFetch(`/api/atomictasks/${atomicTaskId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerBeeId }),
      })
      updateAtomicTask(atomicTaskId, { assigneeId: workerBeeId, status: 'assigned' })
      setAssigningAtomicTaskId(null)
    } catch (err) {
      addToast(`Failed to assign atomic task: ${(err as Error).message}`)
    }
  }

  const toggleDep = (depId: string) => {
    setDepsSelection((prev) =>
      prev.includes(depId) ? prev.filter((d) => d !== depId) : [...prev, depId]
    )
  }

  return (
    <div className="flex flex-col overflow-auto flex-1">
      {/* Filter tabs */}
      <div className="flex gap-0.5 px-1.5 py-1 border-b border-border-primary shrink-0">
        {['all', 'open', 'assigned', 'done'].map((s) => (
          <button
            key={s}
            className={cn(
              'bg-transparent border border-transparent rounded px-1.5 py-px cursor-pointer text-[9px] font-mono',
              filterStatus === s
                ? 'text-text-primary border-border-primary bg-bg-secondary'
                : 'text-text-tertiary'
            )}
            onClick={() => setFilterStatus(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {filteredAtomicTasks.length === 0 && (
        <div className="py-3 px-2 text-[10px] text-text-disabled font-mono text-center">
          no atomic tasks
        </div>
      )}

      {filteredAtomicTasks.map((atomicTask) => (
        <div key={atomicTask.id} className="px-2 py-1.5 border-b border-border-primary">
          <div className="flex justify-between items-center gap-1">
            <span
              className="flex items-center gap-1.5 flex-1 text-[11px] text-text-primary font-mono cursor-pointer truncate"
              onClick={() => setExpandedId(expandedId === atomicTask.id ? null : atomicTask.id)}
            >
              {atomicTask.status === 'done'
                ? <CheckSquare className="w-3 h-3 text-[#608b4e] shrink-0" />
                : atomicTask.status === 'cancelled'
                  ? <Square className="w-3 h-3 text-text-tertiary shrink-0" />
                  : <Circle className="w-3 h-3 text-text-info shrink-0" />}
              {atomicTask.title}
            </span>
            <span className={cn(
              'text-[9px] font-mono shrink-0',
              STATUS_COLOR[atomicTask.status] ?? 'text-text-secondary'
            )}>
              {atomicTask.status}
            </span>
          </div>

          <div className="flex gap-1.5 mt-0.5 flex-wrap pl-[22px]">
            <span className="text-[9px] text-text-info font-mono">
              {rigNameById[atomicTask.projectId] ?? atomicTask.projectId.slice(0, 8)}
            </span>
            {atomicTask.releaseTrainId && (
              <span className="text-[9px] text-orange font-mono">
                {releaseTrainNameById[atomicTask.releaseTrainId] ?? atomicTask.releaseTrainId.slice(0, 8)}
              </span>
            )}
            {atomicTask.assigneeId && (
              <span className="text-[9px] text-block-teal font-mono">
                → {agentNameById[atomicTask.assigneeId] ?? atomicTask.assigneeId.slice(0, 8)}
              </span>
            )}
          </div>

          {expandedId === atomicTask.id && (
            <div className="mt-1 flex flex-col gap-1 pl-[22px]">
              {atomicTask.description && (
                <div className="text-[10px] text-text-secondary font-mono whitespace-pre-wrap">
                  {atomicTask.description}
                </div>
              )}

              {/* Dependencies */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-text-disabled font-mono uppercase tracking-wide">
                    depends on
                  </span>
                  {editingDeps !== atomicTask.id && (
                    <button
                      className="bg-transparent border-none text-text-disabled cursor-pointer text-[9px] font-mono p-0 underline hover:text-text-tertiary"
                      onClick={() => { setEditingDeps(atomicTask.id); setDepsSelection(atomicTask.dependsOn) }}
                    >
                      edit
                    </button>
                  )}
                </div>
                {editingDeps === atomicTask.id ? (
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-col gap-0.5 max-h-20 overflow-y-auto bg-bg-primary border border-border-primary rounded px-1.5 py-1">
                      {atomicTasks
                        .filter((b) => b.id !== atomicTask.id)
                        .map((b) => (
                          <label key={b.id} className="flex items-center text-[9px] font-mono cursor-pointer">
                            <input
                              type="checkbox"
                              checked={depsSelection.includes(b.id)}
                              onChange={() => toggleDep(b.id)}
                              className="mr-1"
                            />
                            <span className={depsSelection.includes(b.id) ? 'text-text-primary' : 'text-text-tertiary'}>
                              {b.title}
                            </span>
                          </label>
                        ))}
                    </div>
                    <div className="flex gap-1">
                      <button
                        className="bg-transparent border border-blue-200/30 text-text-info rounded px-1.5 py-px cursor-pointer text-[9px] font-mono"
                        onClick={() => handleSaveDeps(atomicTask.id)}
                      >
                        save
                      </button>
                      <button
                        className="bg-transparent border border-border-primary text-text-tertiary rounded px-1.5 py-0.5 cursor-pointer text-[9px] font-mono"
                        onClick={() => setEditingDeps(null)}
                      >
                        cancel
                      </button>
                    </div>
                  </div>
                ) : atomicTask.dependsOn.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {atomicTask.dependsOn.map((depId) => (
                      <span
                        key={depId}
                        className="text-[9px] text-text-tertiary font-mono bg-bg-secondary border border-border-primary rounded px-1.5 py-px"
                      >
                        {atomicTaskTitleById[depId] ?? depId.slice(0, 8)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-[9px] text-text-disabled font-mono">none</span>
                )}
              </div>

              {!atomicTask.assigneeId && atomicTask.status === 'open' && (
                <div className="mt-0.5">
                  {assigningAtomicTaskId === atomicTask.id ? (
                    <div className="flex gap-1">
                      <select
                        className="flex-1 bg-bg-secondary border border-border-primary text-text-primary rounded text-[9px] font-mono px-1 py-px"
                        defaultValue=""
                        onChange={(e) => { if (e.target.value) handleAssignAtomicTask(atomicTask.id, e.target.value) }}
                      >
                        <option value="" disabled>assign to bee…</option>
                        {agents.filter((a) => a.status === 'idle' || a.status === 'working').map((a) => (
                          <option key={a.id} value={a.id}>{a.name} ({a.status})</option>
                        ))}
                      </select>
                      <button
                        className="bg-transparent border border-border-primary text-text-tertiary rounded px-1.5 py-0.5 cursor-pointer text-[9px] font-mono"
                        onClick={() => setAssigningAtomicTaskId(null)}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      className="bg-transparent border border-border-primary text-text-tertiary rounded px-1.5 py-px cursor-pointer text-[9px] font-mono hover:border-border-primary"
                      onClick={() => setAssigningAtomicTaskId(atomicTask.id)}
                    >
                      assign bee
                    </button>
                  )}
                </div>
              )}

              <div className="flex gap-1 flex-wrap">
                {atomicTask.status !== 'done' && atomicTask.status !== 'cancelled' && (
                  <>
                    <button
                      className="flex items-center gap-1 bg-transparent border border-[#608b4e] text-[#608b4e] rounded px-1.5 py-0.5 cursor-pointer text-[9px] font-mono"
                      onClick={() => handleMarkDone(atomicTask)}
                    >
                      <CheckSquare className="w-3 h-3" />
                      done
                    </button>
                    <button
                      className="bg-transparent border border-border-primary text-text-tertiary rounded px-1.5 py-0.5 cursor-pointer text-[9px] font-mono"
                      onClick={() => handleCancel(atomicTask)}
                    >
                      cancel
                    </button>
                  </>
                )}
                <button
                  className="flex items-center gap-1 bg-transparent border border-red/30 text-red/50 rounded px-1.5 py-0.5 cursor-pointer text-[9px] font-mono ml-auto hover:border-red/60 hover:text-red/80"
                  onClick={() => handleDelete(atomicTask.id)}
                >
                  <AlertTriangle className="w-3 h-3" />
                  delete
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {showForm ? (
        <div className="flex flex-col gap-1 px-2 py-1.5 border-t border-border-primary">
          <input
            className="w-full bg-bg-secondary border border-border-primary text-text-primary rounded px-1.5 py-1 text-[11px] font-mono outline-none box-border"
            placeholder="Atomic task title"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <textarea
            className="w-full bg-bg-secondary border border-border-primary text-text-primary rounded px-1.5 py-1 text-[11px] font-mono outline-none box-border resize-y min-h-[50px]"
            placeholder="Description (optional)"
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
          <select
            className="w-full bg-bg-secondary border border-border-primary text-text-primary rounded px-1.5 py-1 text-[11px] font-mono outline-none box-border"
            value={form.releaseTrainId}
            onChange={(e) => setForm((f) => ({ ...f, releaseTrainId: e.target.value }))}
          >
            <option value="">no release train</option>
            {releaseTrains
              .filter((c) => !form.projectId || c.projectId === form.projectId)
              .map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
          </select>
          <div className="flex gap-1">
            <button
              className="flex-1 bg-block-teal/10 border border-blue-200/30 text-text-info rounded py-1 cursor-pointer text-[11px] font-mono flex items-center justify-center gap-1"
              onClick={handleCreate}
            >
              <ListChecks className="w-3 h-3" />
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
          <ListChecks className="w-3 h-3" />
          New Atomic Task
        </button>
      )}
    </div>
  )
}
