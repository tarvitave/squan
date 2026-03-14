import { useState } from 'react'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'
import type { ConvoyEntry } from '../../store/index.js'

const ATOMIC_TASK_STATUS_COLOR: Record<string, string> = {
  open: '#569cd6',
  assigned: '#4ec9b0',
  done: '#608b4e',
  cancelled: '#555',
}

const STATUS_COLOR: Record<string, string> = {
  open: '#569cd6',
  in_progress: '#4ec9b0',
  landed: '#608b4e',
  cancelled: '#555',
}

export function ConvoyPanel() {
  const convoys = useStore((s) => s.convoys)
  const setConvoys = useStore((s) => s.setConvoys)
  const agents = useStore((s) => s.agents)
  const rigs = useStore((s) => s.rigs)
  const atomicTasks = useStore((s) => s.atomicTasks)
  const templates = useStore((s) => s.templates)
  const addPaneToTab = useStore((s) => s.addPaneToTab)
  const addTab = useStore((s) => s.addTab)
  const activeTabId = useStore((s) => s.activeTabId)
  const tabs = useStore((s) => s.tabs)
  const updateConvoy = useStore((s) => s.updateConvoy)
  const addConvoy = useStore((s) => s.addConvoy)
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

  const handleCreate = async () => {
    if (!form.name || !form.projectId) return
    try {
      const res = await apiFetch('/api/convoys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error(await res.text())
      const convoy = await res.json()
      addConvoy(convoy)
      setForm({ name: '', description: '', projectId: '' })
      setShowForm(false)
    } catch (err) {
      addToast(`Failed to create convoy: ${(err as Error).message}`)
    }
  }

  const handleAssign = async (convoyId: string, workerBeeId: string | null) => {
    const res = await apiFetch(`/api/convoys/${convoyId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerBeeId }),
    })
    const updated = await res.json()
    updateConvoy(convoyId, {
      assignedWorkerBeeId: updated.assignedWorkerBeeId,
      status: updated.status,
    })
    setAssigning(null)
  }

  const handleSaveDesc = async (convoyId: string) => {
    await apiFetch(`/api/convoys/${convoyId}/description`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: editDescText }),
    })
    updateConvoy(convoyId, { description: editDescText })
    setEditingDesc(null)
  }

  const handleAddAtomicTasks = async (convoyId: string) => {
    if (atomicTaskSelection.length === 0) { setAddingAtomicTasks(null); return }
    const res = await apiFetch(`/api/convoys/${convoyId}/atomictasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ atomicTaskIds: atomicTaskSelection }),
    })
    const updated = await res.json()
    updateConvoy(convoyId, { atomicTaskIds: updated.atomicTaskIds })
    setAddingAtomicTasks(null)
    setAtomicTaskSelection([])
  }

  const handleRemoveAtomicTask = async (convoy: ConvoyEntry, atomicTaskId: string) => {
    const res = await apiFetch(`/api/convoys/${convoy.id}/atomictasks`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ atomicTaskIds: [atomicTaskId] }),
    })
    const updated = await res.json()
    updateConvoy(convoy.id, { atomicTaskIds: updated.atomicTaskIds })
  }

  const handleDispatch = async (convoyId: string) => {
    setDispatching(convoyId)
    try {
      const res = await apiFetch(`/api/convoys/${convoyId}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(await res.text())
      const { bee, convoy } = await res.json()
      updateConvoy(convoyId, {
        assignedWorkerBeeId: convoy.assignedWorkerBeeId,
        status: convoy.status,
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

  const idleAgents = agents.filter((a) => a.status === 'idle' || a.status === 'working')
  const rigNameById = Object.fromEntries(rigs.map((r) => [r.id, r.name]))
  const agentNameById = Object.fromEntries(agents.map((a) => [a.id, a.name]))
  const atomicTaskById = Object.fromEntries(atomicTasks.map((b) => [b.id, b]))

  return (
    <div style={styles.panel}>
      {convoys.map((convoy) => (
        <div key={convoy.id} style={styles.row}>
          <div style={styles.rowTop}>
            <span style={styles.name}>{convoy.name}</span>
            <span style={{ ...styles.status, color: STATUS_COLOR[convoy.status] ?? '#888' }}>
              {convoy.status}
            </span>
          </div>

          {editingDesc === convoy.id ? (
            <div style={styles.descEdit}>
              <textarea
                style={styles.descInput}
                value={editDescText}
                onChange={(e) => setEditDescText(e.target.value)}
                autoFocus
                rows={3}
              />
              <div style={styles.descEditBtns}>
                <button style={styles.descSaveBtn} onClick={() => handleSaveDesc(convoy.id)}>save</button>
                <button style={styles.descCancelBtn} onClick={() => setEditingDesc(null)}>cancel</button>
              </div>
            </div>
          ) : (
            <div
              style={styles.description}
              onClick={() => { setEditingDesc(convoy.id); setEditDescText(convoy.description) }}
              title="Click to edit description"
            >
              {convoy.description || <span style={{ color: '#333' }}>add description…</span>}
            </div>
          )}

          <div style={styles.meta}>
            <span style={styles.rig}>{rigNameById[convoy.projectId] ?? convoy.projectId.slice(0, 8)}</span>
            <span
              style={{ ...styles.beadCount, cursor: 'pointer', textDecoration: 'underline' }}
              onClick={() => setExpandedId(expandedId === convoy.id ? null : convoy.id)}
              title="Show atomic tasks"
            >
              {convoy.atomicTaskIds.length} atomic tasks
            </span>
          </div>

          {expandedId === convoy.id && (
            <div style={styles.beadSection}>
              {convoy.atomicTaskIds.length === 0 && (
                <span style={styles.noBeads}>no atomic tasks</span>
              )}
              {convoy.atomicTaskIds.map((atid) => {
                const atomicTask = atomicTaskById[atid]
                return (
                  <div key={atid} style={styles.beadItem}>
                    <span style={styles.beadTitle}>{atomicTask?.title ?? atid.slice(0, 8)}</span>
                    {atomicTask && (
                      <span style={{ ...styles.beadStatus, color: ATOMIC_TASK_STATUS_COLOR[atomicTask.status] ?? '#555' }}>
                        {atomicTask.status}
                      </span>
                    )}
                    <button
                      style={styles.removeBeadBtn}
                      onClick={() => handleRemoveAtomicTask(convoy, atid)}
                      title="Remove from convoy"
                    >✕</button>
                  </div>
                )
              })}

              {addingAtomicTasks === convoy.id ? (
                <div style={styles.addBeadForm}>
                  <div style={styles.beadCheckList}>
                    {atomicTasks
                      .filter((b) => b.projectId === convoy.projectId && !convoy.atomicTaskIds.includes(b.id))
                      .map((b) => (
                        <label key={b.id} style={styles.beadCheck}>
                          <input
                            type="checkbox"
                            checked={atomicTaskSelection.includes(b.id)}
                            onChange={() => setAtomicTaskSelection((prev) =>
                              prev.includes(b.id) ? prev.filter((x) => x !== b.id) : [...prev, b.id]
                            )}
                            style={{ marginRight: 4 }}
                          />
                          <span style={{ color: atomicTaskSelection.includes(b.id) ? '#d4d4d4' : '#555', fontSize: 9 }}>
                            {b.title}
                          </span>
                        </label>
                      ))}
                  </div>
                  <div style={styles.addBeadBtns}>
                    <button style={styles.addBeadSaveBtn} onClick={() => handleAddAtomicTasks(convoy.id)}>add</button>
                    <button style={styles.cancelBtn} onClick={() => { setAddingAtomicTasks(null); setAtomicTaskSelection([]) }}>cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  style={styles.addBeadBtn}
                  onClick={() => { setAddingAtomicTasks(convoy.id); setAtomicTaskSelection([]) }}
                >
                  + add atomic task
                </button>
              )}
            </div>
          )}

          {convoy.assignedWorkerBeeId ? (
            <div style={styles.assignedRow}>
              <span style={styles.assignedLabel}>→</span>
              <span style={styles.assignedBee}>{agentNameById[convoy.assignedWorkerBeeId] ?? convoy.assignedWorkerBeeId.slice(0, 8)}</span>
              <button style={styles.unassignBtn} onClick={() => handleAssign(convoy.id, null)} title="Unassign">✕</button>
            </div>
          ) : (
            <div style={styles.actionRow}>
              {assigning === convoy.id ? (
                <div style={styles.assignPicker}>
                  <select
                    style={styles.select}
                    defaultValue=""
                    onChange={(e) => { if (e.target.value) handleAssign(convoy.id, e.target.value) }}
                  >
                    <option value="" disabled>assign bee…</option>
                    {idleAgents.map((a) => (
                      <option key={a.id} value={a.id}>{a.name} ({a.status})</option>
                    ))}
                  </select>
                  <button style={styles.cancelBtn} onClick={() => setAssigning(null)}>✕</button>
                </div>
              ) : (
                <>
                  <button
                    style={styles.actionBtn}
                    onClick={() => setAssigning(convoy.id)}
                    title="Assign existing WorkerBee"
                  >
                    assign
                  </button>
                  {dispatchingWithTemplate === convoy.id ? (
                    <div style={styles.templatePicker}>
                      <select
                        style={styles.select}
                        value={selectedTemplateId}
                        onChange={(e) => setSelectedTemplateId(e.target.value)}
                      >
                        <option value="">no template</option>
                        {templates
                          .filter((t) => t.projectId === convoy.projectId)
                          .map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                      </select>
                      <button
                        style={{ ...styles.actionBtn, color: '#4ec9b0', borderColor: '#4ec9b0' }}
                        onClick={async () => {
                          const tmpl = templates.find((t) => t.id === selectedTemplateId)
                          setDispatchingWithTemplate(null)
                          setDispatching(convoy.id)
                          try {
                            const res = await apiFetch(`/api/convoys/${convoy.id}/dispatch`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify(tmpl ? { taskDescription: tmpl.content } : {}),
                            })
                            const { bee, convoy: updatedConvoy } = await res.json()
                            updateConvoy(convoy.id, {
                              assignedWorkerBeeId: updatedConvoy.assignedWorkerBeeId,
                              status: updatedConvoy.status,
                            })
                            if (bee?.sessionId) {
                              const hasSession = tabs.some((t) => t.panes.includes(bee.sessionId))
                              if (!hasSession) {
                                if (activeTabId) addPaneToTab(activeTabId, bee.sessionId)
                                else addTab(bee.name, [bee.sessionId])
                              }
                            }
                          } finally {
                            setDispatching(null)
                          }
                        }}
                        disabled={dispatching === convoy.id}
                      >
                        go
                      </button>
                      <button style={styles.cancelBtn} onClick={() => setDispatchingWithTemplate(null)}>✕</button>
                    </div>
                  ) : (
                    <button
                      style={{ ...styles.actionBtn, color: '#4ec9b0', borderColor: '#4ec9b0' }}
                      onClick={() => { setDispatchingWithTemplate(convoy.id); setSelectedTemplateId('') }}
                      disabled={dispatching === convoy.id}
                      title="Spawn a new WorkerBee and assign"
                    >
                      {dispatching === convoy.id ? '…' : 'dispatch'}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      ))}

      {showForm ? (
        <div style={styles.form}>
          <input
            style={styles.input}
            placeholder="Convoy name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <textarea
            style={{ ...styles.input, resize: 'vertical', minHeight: 60 }}
            placeholder="Task description (becomes CLAUDE.md when dispatched)"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
          <select
            style={styles.input}
            value={form.projectId}
            onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}
          >
            <option value="" disabled>select project…</option>
            {rigs.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <div style={styles.formBtns}>
            <button style={styles.addBtn} onClick={handleCreate}>Create</button>
            <button style={styles.cancelFormBtn} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button style={styles.newBtn} onClick={() => setShowForm(true)}>
          + New Convoy
        </button>
      )}
    </div>
  )
}

const styles = {
  panel: {
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'auto',
    flex: 1,
  },
  row: {
    padding: '6px 8px',
    borderBottom: '1px solid #1e1e1e',
  },
  rowTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    fontSize: 12,
    color: '#d4d4d4',
    fontFamily: 'monospace',
  },
  status: {
    fontSize: 10,
    fontFamily: 'monospace',
  },
  description: {
    fontSize: 10,
    color: '#888',
    fontFamily: 'monospace',
    marginTop: 2,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    cursor: 'text',
  },
  descEdit: {
    marginTop: 3,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 3,
  },
  descInput: {
    background: '#1a1a1a',
    border: '1px solid #444',
    color: '#d4d4d4',
    borderRadius: 3,
    padding: '3px 5px',
    fontSize: 10,
    fontFamily: 'monospace',
    outline: 'none',
    resize: 'vertical' as const,
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  descEditBtns: {
    display: 'flex',
    gap: 3,
  },
  descSaveBtn: {
    background: 'none',
    border: '1px solid #4ec9b0',
    color: '#4ec9b0',
    borderRadius: 3,
    padding: '1px 6px',
    cursor: 'pointer',
    fontSize: 9,
    fontFamily: 'monospace',
  },
  descCancelBtn: {
    background: 'none',
    border: '1px solid #333',
    color: '#555',
    borderRadius: 3,
    padding: '1px 6px',
    cursor: 'pointer',
    fontSize: 9,
    fontFamily: 'monospace',
  },
  meta: {
    display: 'flex',
    gap: 8,
    marginTop: 2,
  },
  rig: {
    fontSize: 10,
    color: '#569cd6',
    fontFamily: 'monospace',
  },
  beadCount: {
    fontSize: 10,
    color: '#666',
    fontFamily: 'monospace',
  },
  beadSection: {
    marginTop: 4,
    background: '#0c0c0c',
    border: '1px solid #1e1e1e',
    borderRadius: 3,
    padding: '4px 6px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 3,
  },
  noBeads: {
    fontSize: 9,
    color: '#333',
    fontFamily: 'monospace',
  },
  beadItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  beadTitle: {
    fontSize: 10,
    color: '#888',
    fontFamily: 'monospace',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  beadStatus: {
    fontSize: 9,
    fontFamily: 'monospace',
    flexShrink: 0,
  },
  removeBeadBtn: {
    background: 'none',
    border: 'none',
    color: '#333',
    cursor: 'pointer',
    fontSize: 9,
    padding: '0 2px',
    flexShrink: 0,
  },
  addBeadForm: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 3,
  },
  beadCheckList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    maxHeight: 80,
    overflowY: 'auto' as const,
    background: '#111',
    border: '1px solid #222',
    borderRadius: 3,
    padding: '3px 5px',
  },
  beadCheck: {
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer',
    fontFamily: 'monospace',
  },
  addBeadBtns: {
    display: 'flex',
    gap: 3,
  },
  addBeadSaveBtn: {
    background: 'none',
    border: '1px solid #4ec9b0',
    color: '#4ec9b0',
    borderRadius: 3,
    padding: '1px 8px',
    cursor: 'pointer',
    fontSize: 9,
    fontFamily: 'monospace',
  },
  addBeadBtn: {
    background: 'none',
    border: '1px dashed #222',
    color: '#444',
    borderRadius: 3,
    padding: '2px 6px',
    cursor: 'pointer',
    fontSize: 9,
    fontFamily: 'monospace',
    textAlign: 'left' as const,
  },
  assignedRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  assignedLabel: {
    fontSize: 10,
    color: '#555',
    fontFamily: 'monospace',
  },
  assignedBee: {
    fontSize: 10,
    color: '#4ec9b0',
    fontFamily: 'monospace',
    flex: 1,
  },
  unassignBtn: {
    background: 'none',
    border: 'none',
    color: '#555',
    cursor: 'pointer',
    fontSize: 10,
    padding: '0 2px',
  },
  actionRow: {
    display: 'flex',
    gap: 4,
    marginTop: 4,
  },
  actionBtn: {
    background: 'none',
    border: '1px solid #333',
    color: '#888',
    borderRadius: 3,
    padding: '2px 6px',
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  assignPicker: {
    display: 'flex',
    gap: 4,
    flex: 1,
  },
  templatePicker: {
    display: 'flex',
    gap: 4,
    flex: 1,
    alignItems: 'center',
  },
  select: {
    flex: 1,
    background: '#1a1a1a',
    border: '1px solid #333',
    color: '#d4d4d4',
    borderRadius: 3,
    fontSize: 10,
    fontFamily: 'monospace',
    padding: '2px 4px',
  },
  cancelBtn: {
    background: 'none',
    border: 'none',
    color: '#555',
    cursor: 'pointer',
    fontSize: 10,
  },
  form: {
    padding: '6px 8px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    borderTop: '1px solid #2d2d2d',
  },
  input: {
    background: '#1a1a1a',
    border: '1px solid #333',
    color: '#d4d4d4',
    borderRadius: 3,
    padding: '4px 6px',
    fontSize: 11,
    fontFamily: 'monospace',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  formBtns: {
    display: 'flex',
    gap: 4,
  },
  addBtn: {
    flex: 1,
    background: '#1a3a2a',
    border: '1px solid #4ec9b0',
    color: '#4ec9b0',
    borderRadius: 3,
    padding: '4px',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  cancelFormBtn: {
    flex: 1,
    background: 'none',
    border: '1px solid #333',
    color: '#666',
    borderRadius: 3,
    padding: '4px',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  newBtn: {
    margin: '4px 8px',
    background: 'none',
    border: '1px dashed #333',
    color: '#569cd6',
    borderRadius: 3,
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'monospace',
    textAlign: 'left' as const,
  },
}
