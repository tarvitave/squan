import { useState } from 'react'
import { useStore } from '../../store/index.js'
import type { BeadEntry } from '../../store/index.js'

const STATUS_COLOR: Record<string, string> = {
  open: '#569cd6',
  assigned: '#4ec9b0',
  done: '#608b4e',
  cancelled: '#555',
}

export function BeadsPanel() {
  const beads = useStore((s) => s.beads)
  const convoys = useStore((s) => s.convoys)
  const rigs = useStore((s) => s.rigs)
  const agents = useStore((s) => s.agents)
  const addBead = useStore((s) => s.addBead)
  const updateBead = useStore((s) => s.updateBead)
  const addToast = useStore((s) => s.addToast)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ title: '', description: '', projectId: '', convoyId: '' })
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [editingDeps, setEditingDeps] = useState<string | null>(null)  // beadId
  const [depsSelection, setDepsSelection] = useState<string[]>([])
  const [assigningBeadId, setAssigningBeadId] = useState<string | null>(null)

  const convoyNameById = Object.fromEntries(convoys.map((c) => [c.id, c.name]))
  const rigNameById = Object.fromEntries(rigs.map((r) => [r.id, r.name]))
  const agentNameById = Object.fromEntries(agents.map((a) => [a.id, a.name]))
  const beadTitleById = Object.fromEntries(beads.map((b) => [b.id, b.title]))

  const filteredBeads = filterStatus === 'all'
    ? beads
    : beads.filter((b) => b.status === filterStatus)

  const handleCreate = async () => {
    if (!form.title || !form.projectId) return
    try {
      const body: Record<string, unknown> = {
        title: form.title,
        projectId: form.projectId,
      }
      if (form.description) body.description = form.description
      if (form.convoyId) body.convoyId = form.convoyId

      const res = await fetch('/api/beads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const bead = await res.json()
      addBead({ ...bead, dependsOn: bead.dependsOn ?? [] })
      setForm({ title: '', description: '', projectId: '', convoyId: '' })
      setShowForm(false)
    } catch (err) {
      addToast(`Failed to create bead: ${(err as Error).message}`)
    }
  }

  const handleMarkDone = async (bead: BeadEntry) => {
    try {
      await fetch(`/api/beads/${bead.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      })
      updateBead(bead.id, { status: 'done' })
    } catch (err) {
      addToast(`Failed to mark bead done: ${(err as Error).message}`)
    }
  }

  const handleCancel = async (bead: BeadEntry) => {
    try {
      await fetch(`/api/beads/${bead.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      updateBead(bead.id, { status: 'cancelled' })
    } catch (err) {
      addToast(`Failed to cancel bead: ${(err as Error).message}`)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/beads/${id}`, { method: 'DELETE' })
      // Remove from local store by marking cancelled then filtering — store has no removeBead,
      // so update status to a sentinel and rely on filter; simplest is to reload beads.
      const fresh = await fetch('/api/beads').then((r) => r.json())
      useStore.getState().setBeads(fresh)
    } catch (err) {
      addToast(`Failed to delete bead: ${(err as Error).message}`)
    }
  }

  const handleSaveDeps = async (beadId: string) => {
    try {
      await fetch(`/api/beads/${beadId}/dependencies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dependsOn: depsSelection }),
      })
      updateBead(beadId, { dependsOn: depsSelection })
      setEditingDeps(null)
    } catch (err) {
      addToast(`Failed to save dependencies: ${(err as Error).message}`)
    }
  }

  const handleAssignBead = async (beadId: string, workerBeeId: string) => {
    try {
      await fetch(`/api/beads/${beadId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerBeeId }),
      })
      updateBead(beadId, { assigneeId: workerBeeId, status: 'assigned' })
      setAssigningBeadId(null)
    } catch (err) {
      addToast(`Failed to assign bead: ${(err as Error).message}`)
    }
  }

  const toggleDep = (depId: string) => {
    setDepsSelection((prev) =>
      prev.includes(depId) ? prev.filter((d) => d !== depId) : [...prev, depId]
    )
  }

  return (
    <div style={styles.panel}>
      {/* Filter tabs */}
      <div style={styles.filterBar}>
        {['all', 'open', 'assigned', 'done'].map((s) => (
          <button
            key={s}
            style={{
              ...styles.filterBtn,
              ...(filterStatus === s ? styles.filterBtnActive : {}),
            }}
            onClick={() => setFilterStatus(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {filteredBeads.length === 0 && (
        <div style={styles.empty}>no beads</div>
      )}

      {filteredBeads.map((bead) => (
        <div key={bead.id} style={styles.row}>
          <div style={styles.rowTop}>
            <span
              style={styles.title}
              onClick={() => setExpandedId(expandedId === bead.id ? null : bead.id)}
            >
              {bead.title}
            </span>
            <span style={{ ...styles.status, color: STATUS_COLOR[bead.status] ?? '#888' }}>
              {bead.status}
            </span>
          </div>

          <div style={styles.meta}>
            <span style={styles.project}>{rigNameById[bead.projectId] ?? bead.projectId.slice(0, 8)}</span>
            {bead.convoyId && (
              <span style={styles.convoy}>{convoyNameById[bead.convoyId] ?? bead.convoyId.slice(0, 8)}</span>
            )}
            {bead.assigneeId && (
              <span style={styles.assignee}>→ {agentNameById[bead.assigneeId] ?? bead.assigneeId.slice(0, 8)}</span>
            )}
          </div>

          {expandedId === bead.id && (
            <div style={styles.detail}>
              {bead.description && (
                <div style={styles.desc}>{bead.description}</div>
              )}

              {/* Dependencies */}
              <div style={styles.deps}>
                <div style={styles.depsHeader}>
                  <span style={styles.depsLabel}>depends on</span>
                  {editingDeps !== bead.id && (
                    <button
                      style={styles.editDepsBtn}
                      onClick={() => { setEditingDeps(bead.id); setDepsSelection(bead.dependsOn) }}
                    >
                      edit
                    </button>
                  )}
                </div>
                {editingDeps === bead.id ? (
                  <div style={styles.depsEditor}>
                    <div style={styles.depCheckList}>
                      {beads
                        .filter((b) => b.id !== bead.id)
                        .map((b) => (
                          <label key={b.id} style={styles.depCheck}>
                            <input
                              type="checkbox"
                              checked={depsSelection.includes(b.id)}
                              onChange={() => toggleDep(b.id)}
                              style={{ marginRight: 4 }}
                            />
                            <span style={{ color: depsSelection.includes(b.id) ? '#d4d4d4' : '#555' }}>
                              {b.title}
                            </span>
                          </label>
                        ))}
                    </div>
                    <div style={styles.depsBtns}>
                      <button style={styles.descSaveBtn} onClick={() => handleSaveDeps(bead.id)}>save</button>
                      <button style={styles.cancelBtn} onClick={() => setEditingDeps(null)}>cancel</button>
                    </div>
                  </div>
                ) : bead.dependsOn.length > 0 ? (
                  <div style={styles.depList}>
                    {bead.dependsOn.map((depId) => (
                      <span key={depId} style={styles.dep}>
                        {beadTitleById[depId] ?? depId.slice(0, 8)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span style={styles.noDeps}>none</span>
                )}
              </div>

              {!bead.assigneeId && bead.status === 'open' && (
                <div style={styles.assignRow}>
                  {assigningBeadId === bead.id ? (
                    <div style={styles.assignPicker}>
                      <select
                        style={styles.assignSelect}
                        defaultValue=""
                        onChange={(e) => { if (e.target.value) handleAssignBead(bead.id, e.target.value) }}
                      >
                        <option value="" disabled>assign to bee…</option>
                        {agents.filter((a) => a.status === 'idle' || a.status === 'working').map((a) => (
                          <option key={a.id} value={a.id}>{a.name} ({a.status})</option>
                        ))}
                      </select>
                      <button style={styles.cancelBtn} onClick={() => setAssigningBeadId(null)}>&#x2715;</button>
                    </div>
                  ) : (
                    <button style={styles.assignBtn} onClick={() => setAssigningBeadId(bead.id)}>assign bee</button>
                  )}
                </div>
              )}

              <div style={styles.actions}>
                {bead.status !== 'done' && bead.status !== 'cancelled' && (
                  <>
                    <button style={styles.doneBtn} onClick={() => handleMarkDone(bead)}>done</button>
                    <button style={styles.cancelBtn} onClick={() => handleCancel(bead)}>cancel</button>
                  </>
                )}
                <button style={styles.deleteBtn} onClick={() => handleDelete(bead.id)}>delete</button>
              </div>
            </div>
          )}
        </div>
      ))}

      {showForm ? (
        <div style={styles.form}>
          <input
            style={styles.input}
            placeholder="Bead title"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <textarea
            style={{ ...styles.input, resize: 'vertical', minHeight: 50 }}
            placeholder="Description (optional)"
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
          <select
            style={styles.input}
            value={form.convoyId}
            onChange={(e) => setForm((f) => ({ ...f, convoyId: e.target.value }))}
          >
            <option value="">no convoy</option>
            {convoys
              .filter((c) => !form.projectId || c.projectId === form.projectId)
              .map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
          </select>
          <div style={styles.formBtns}>
            <button style={styles.addBtn} onClick={handleCreate}>Create</button>
            <button style={styles.cancelFormBtn} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button style={styles.newBtn} onClick={() => setShowForm(true)}>
          + New Bead
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
  filterBar: {
    display: 'flex',
    gap: 2,
    padding: '4px 6px',
    borderBottom: '1px solid #1e1e1e',
    flexShrink: 0,
  },
  filterBtn: {
    background: 'none',
    border: '1px solid transparent',
    color: '#555',
    borderRadius: 3,
    padding: '1px 6px',
    cursor: 'pointer',
    fontSize: 9,
    fontFamily: 'monospace',
  },
  filterBtnActive: {
    color: '#d4d4d4',
    borderColor: '#333',
    background: '#1a1a1a',
  },
  empty: {
    padding: '12px 8px',
    fontSize: 10,
    color: '#444',
    fontFamily: 'monospace',
    textAlign: 'center' as const,
  },
  row: {
    padding: '5px 8px',
    borderBottom: '1px solid #1a1a1a',
  },
  rowTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 4,
  },
  title: {
    fontSize: 11,
    color: '#d4d4d4',
    fontFamily: 'monospace',
    cursor: 'pointer',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  status: {
    fontSize: 9,
    fontFamily: 'monospace',
    flexShrink: 0,
  },
  meta: {
    display: 'flex',
    gap: 6,
    marginTop: 2,
    flexWrap: 'wrap' as const,
  },
  project: {
    fontSize: 9,
    color: '#569cd6',
    fontFamily: 'monospace',
  },
  convoy: {
    fontSize: 9,
    color: '#ce9178',
    fontFamily: 'monospace',
  },
  assignee: {
    fontSize: 9,
    color: '#4ec9b0',
    fontFamily: 'monospace',
  },
  detail: {
    marginTop: 4,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  desc: {
    fontSize: 10,
    color: '#888',
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap' as const,
  },
  deps: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 3,
  },
  depsHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  depsLabel: {
    fontSize: 9,
    color: '#444',
    fontFamily: 'monospace',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
  },
  editDepsBtn: {
    background: 'none',
    border: 'none',
    color: '#444',
    cursor: 'pointer',
    fontSize: 9,
    fontFamily: 'monospace',
    padding: 0,
    textDecoration: 'underline',
  },
  depsEditor: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  depCheckList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    maxHeight: 80,
    overflowY: 'auto' as const,
    background: '#111',
    border: '1px solid #2a2a2a',
    borderRadius: 3,
    padding: '3px 5px',
  },
  depCheck: {
    display: 'flex',
    alignItems: 'center',
    fontSize: 9,
    fontFamily: 'monospace',
    cursor: 'pointer',
  },
  depsBtns: {
    display: 'flex',
    gap: 3,
  },
  descSaveBtn: {
    background: 'none',
    border: '1px solid #569cd6',
    color: '#569cd6',
    borderRadius: 3,
    padding: '1px 6px',
    cursor: 'pointer',
    fontSize: 9,
    fontFamily: 'monospace',
  },
  noDeps: {
    fontSize: 9,
    color: '#333',
    fontFamily: 'monospace',
  },
  depList: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 3,
  },
  dep: {
    fontSize: 9,
    color: '#555',
    fontFamily: 'monospace',
    background: '#1a1a1a',
    border: '1px solid #2a2a2a',
    borderRadius: 3,
    padding: '1px 5px',
  },
  actions: {
    display: 'flex',
    gap: 4,
    flexWrap: 'wrap' as const,
  },
  doneBtn: {
    background: 'none',
    border: '1px solid #608b4e',
    color: '#608b4e',
    borderRadius: 3,
    padding: '2px 6px',
    cursor: 'pointer',
    fontSize: 9,
    fontFamily: 'monospace',
  },
  cancelBtn: {
    background: 'none',
    border: '1px solid #333',
    color: '#555',
    borderRadius: 3,
    padding: '2px 6px',
    cursor: 'pointer',
    fontSize: 9,
    fontFamily: 'monospace',
  },
  deleteBtn: {
    background: 'none',
    border: '1px solid #3a2020',
    color: '#554040',
    borderRadius: 3,
    padding: '2px 6px',
    cursor: 'pointer',
    fontSize: 9,
    fontFamily: 'monospace',
    marginLeft: 'auto',
  },
  assignRow: { marginTop: 2 },
  assignPicker: { display: 'flex', gap: 4 },
  assignSelect: {
    flex: 1, background: '#1a1a1a', border: '1px solid #333', color: '#d4d4d4',
    borderRadius: 3, fontSize: 9, fontFamily: 'monospace', padding: '1px 3px',
  },
  assignBtn: {
    background: 'none', border: '1px solid #333', color: '#555',
    borderRadius: 3, padding: '1px 6px', cursor: 'pointer', fontSize: 9, fontFamily: 'monospace',
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
    background: '#1a2a3a',
    border: '1px solid #569cd6',
    color: '#569cd6',
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
