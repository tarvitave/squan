import { useState } from 'react'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'
import type { ReleaseTrainEntry, TemplateEntry } from '../../store/index.js'
import { ReleaseTrainPanel } from '../ReleaseTrainPanel/index.js'
import { AtomicTasksPanel } from '../AtomicTasksPanel/index.js'

type KanbanTab = 'board' | 'trains' | 'tasks' | 'standbys'

const COLUMNS: Array<{ status: ReleaseTrainEntry['status']; label: string; color: string }> = [
  { status: 'open', label: 'Open', color: '#569cd6' },
  { status: 'in_progress', label: 'In Progress', color: '#4ec9b0' },
  { status: 'landed', label: 'Landed', color: '#608b4e' },
  { status: 'cancelled', label: 'Cancelled', color: '#555' },
]

export function KanbanView() {
  const [tab, setTab] = useState<KanbanTab>('board')

  return (
    <div style={styles.root}>
      <div style={styles.tabBar}>
        <TabBtn label="Board" active={tab === 'board'} onClick={() => setTab('board')} />
        <TabBtn label="Standbys" active={tab === 'standbys'} onClick={() => setTab('standbys')} />
        <TabBtn label="Release Trains" active={tab === 'trains'} onClick={() => setTab('trains')} />
        <TabBtn label="Atomic Tasks" active={tab === 'tasks'} onClick={() => setTab('tasks')} />
      </div>
      <div style={styles.body}>
        {tab === 'board' && <Board />}
        {tab === 'standbys' && <StandbysPanel />}
        {tab === 'trains' && <ReleaseTrainPanel />}
        {tab === 'tasks' && <AtomicTasksPanel />}
      </div>
    </div>
  )
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      style={{ ...styles.tabBtn, ...(active ? styles.tabBtnActive : {}) }}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function Board() {
  const releaseTrains = useStore((s) => s.releaseTrains)
  const agents = useStore((s) => s.agents)
  const rigs = useStore((s) => s.rigs)
  const atomicTasks = useStore((s) => s.atomicTasks)
  const updateReleaseTrain = useStore((s) => s.updateReleaseTrain)
  const addReleaseTrain = useStore((s) => s.addReleaseTrain)
  const addAgent = useStore((s) => s.addAgent)
  const addPaneToTab = useStore((s) => s.addPaneToTab)
  const addTab = useStore((s) => s.addTab)
  const activeTabId = useStore((s) => s.activeTabId)
  const tabs = useStore((s) => s.tabs)

  const templates = useStore((s) => s.templates)

  const [showNewForm, setShowNewForm] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', description: '', projectId: '' })
  const [creating, setCreating] = useState(false)
  const [autoDispatch, setAutoDispatch] = useState(true)

  const agentById = Object.fromEntries(agents.map((a) => [a.id, a]))
  const rigNameById = Object.fromEntries(rigs.map((r) => [r.id, r.name]))

  const releaseTrainAtomicTaskCounts = Object.fromEntries(
    releaseTrains.map((c) => [
      c.id,
      {
        total: atomicTasks.filter((b) => c.atomicTaskIds.includes(b.id) || b.releaseTrainId === c.id).length,
        done: atomicTasks.filter((b) => (c.atomicTaskIds.includes(b.id) || b.releaseTrainId === c.id) && b.status === 'done').length,
      },
    ])
  )

  const moveReleaseTrain = async (releaseTrainId: string, status: string) => {
    if (status === 'cancelled') {
      await apiFetch(`/api/release-trains/${releaseTrainId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      updateReleaseTrain(releaseTrainId, { status: 'cancelled' })
    } else {
      await apiFetch(`/api/release-trains/${releaseTrainId}/${status === 'landed' ? 'land' : 'assign'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(status === 'landed' ? {} : { workerBeeId: null }),
      })
      updateReleaseTrain(releaseTrainId, { status: status as ReleaseTrainEntry['status'] })
    }
  }

  const dispatchReleaseTrain = async (releaseTrainId: string) => {
    const res = await apiFetch(`/api/release-trains/${releaseTrainId}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const data = await res.json()
    const bee = data.bee
    const releaseTrain = data.releaseTrain
    if (bee) addAgent({ ...bee, taskDescription: bee.taskDescription ?? '', worktreePath: bee.worktreePath ?? '', branch: bee.branch ?? '' })
    if (releaseTrain) updateReleaseTrain(releaseTrainId, { assignedWorkerBeeId: releaseTrain.assignedWorkerBeeId, status: releaseTrain.status })
    if (bee?.sessionId) {
      const hasSession = tabs.some((t: { panes: string[] }) => t.panes.includes(bee.sessionId))
      if (!hasSession) {
        if (activeTabId) addPaneToTab(activeTabId, bee.sessionId)
        else addTab(bee.name, [bee.sessionId])
      }
    }
  }

  const handleCreate = async () => {
    const projectId = newForm.projectId || rigs[0]?.id
    if (!newForm.name.trim() || !projectId) return
    setCreating(true)
    try {
      const res = await apiFetch('/api/release-trains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newForm.name.trim(), description: newForm.description.trim(), projectId }),
      })
      const created = await res.json()
      addReleaseTrain(created)
      setShowNewForm(false)
      setNewForm({ name: '', description: '', projectId: '' })
      if (autoDispatch) {
        const dres = await apiFetch(`/api/release-trains/${created.id}/dispatch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const data = await dres.json()
        if (data.bee) addAgent({ ...data.bee, taskDescription: data.bee.taskDescription ?? '', worktreePath: data.bee.worktreePath ?? '', branch: data.bee.branch ?? '' })
        if (data.releaseTrain) updateReleaseTrain(created.id, { assignedWorkerBeeId: data.releaseTrain.assignedWorkerBeeId, status: data.releaseTrain.status })
        if (data.bee?.sessionId) {
          const hasSession = tabs.some((t: { panes: string[] }) => t.panes.includes(data.bee.sessionId))
          if (!hasSession) {
            if (activeTabId) addPaneToTab(activeTabId, data.bee.sessionId)
            else addTab(data.bee.name, [data.bee.sessionId])
          }
        }
      }
    } finally {
      setCreating(false)
    }
  }

  const openBeeTerminal = (bee: { sessionId: string | null; name: string }) => {
    if (!bee.sessionId) return
    const hasSession = tabs.some((t: { panes: string[] }) => t.panes.includes(bee.sessionId!))
    if (!hasSession) {
      if (activeTabId) addPaneToTab(activeTabId, bee.sessionId)
      else addTab(bee.name, [bee.sessionId])
    }
  }

  return (
    <div style={styles.board}>
      {COLUMNS.map((col) => {
        const cards = releaseTrains.filter((c) => c.status === col.status)
        return (
          <div key={col.status} style={styles.column}>
            <div style={styles.colHeader}>
              <span style={{ ...styles.colTitle, color: col.color }}>{col.label}</span>
              <span style={styles.colCount}>{cards.length}</span>
              {col.status === 'open' && (
                <button style={styles.newBtn} onClick={() => setShowNewForm((v) => !v)} title="New release train">+</button>
              )}
            </div>
            {col.status === 'open' && showNewForm && (
              <div style={styles.newForm}>
                {templates.length > 0 && (
                  <select
                    style={styles.formInput}
                    defaultValue=""
                    onChange={(e) => {
                      const tpl = templates.find((t) => t.id === e.target.value)
                      if (tpl) setNewForm((f) => ({ ...f, name: f.name || tpl.name, description: tpl.content, projectId: f.projectId || tpl.projectId }))
                    }}
                  >
                    <option value="" disabled>— use a standby template —</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
                <input
                  style={styles.formInput}
                  placeholder="Task name…"
                  value={newForm.name}
                  onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
                  autoFocus
                />
                <textarea
                  style={{ ...styles.formInput, resize: 'vertical' as const, minHeight: 48 }}
                  placeholder="Description (becomes the WorkerBee's instructions)…"
                  value={newForm.description}
                  rows={2}
                  onChange={(e) => setNewForm((f) => ({ ...f, description: e.target.value }))}
                />
                {rigs.length > 1 && (
                  <select
                    style={styles.formInput}
                    value={newForm.projectId || rigs[0]?.id}
                    onChange={(e) => setNewForm((f) => ({ ...f, projectId: e.target.value }))}
                  >
                    {rigs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                )}
                <label style={styles.checkRow}>
                  <input type="checkbox" checked={autoDispatch} onChange={(e) => setAutoDispatch(e.target.checked)} />
                  <span style={styles.checkLabel}>auto-dispatch WorkerBee</span>
                </label>
                <div style={styles.formActions}>
                  <button style={styles.actionBtn} onClick={handleCreate} disabled={creating || !newForm.name.trim()}>
                    {creating ? '…' : autoDispatch ? 'Create & Dispatch' : 'Create'}
                  </button>
                  <button style={{ ...styles.actionBtn, color: '#555' }} onClick={() => setShowNewForm(false)}>cancel</button>
                </div>
              </div>
            )}
            <div style={styles.cards}>
              {cards.map((releaseTrain) => {
                const assignedBee = releaseTrain.assignedWorkerBeeId ? agentById[releaseTrain.assignedWorkerBeeId] : null
                const counts = releaseTrainAtomicTaskCounts[releaseTrain.id] ?? { total: 0, done: 0 }
                return (
                  <div key={releaseTrain.id} style={styles.card}>
                    <div style={styles.cardTitle}>{releaseTrain.name}</div>

                    {releaseTrain.description && (
                      <div style={styles.cardDesc}>{releaseTrain.description}</div>
                    )}

                    <div style={styles.cardMeta}>
                      <span style={styles.cardRig}>{rigNameById[releaseTrain.projectId] ?? releaseTrain.projectId.slice(0, 8)}</span>
                      {counts.total > 0 && (
                        <span style={styles.cardBeads}>
                          {counts.done}/{counts.total} tasks
                        </span>
                      )}
                    </div>

                    {assignedBee && (
                      <div
                        style={styles.cardBee}
                        onClick={() => openBeeTerminal(assignedBee)}
                        title="Click to open terminal"
                      >
                        <span style={{ color: STATUS_COLOR[assignedBee.status] }}>●</span>
                        <span style={styles.beeName}>{assignedBee.name}</span>
                        <span style={{ ...styles.beeStatus, color: STATUS_COLOR[assignedBee.status] }}>
                          {assignedBee.status}
                        </span>
                      </div>
                    )}

                    <div style={styles.cardActions}>
                      {col.status === 'open' && (
                        <button
                          style={styles.actionBtn}
                          onClick={() => dispatchReleaseTrain(releaseTrain.id)}
                        >
                          dispatch
                        </button>
                      )}
                      {col.status === 'in_progress' && (
                        <button
                          style={{ ...styles.actionBtn, color: '#608b4e', borderColor: '#608b4e' }}
                          onClick={() => moveReleaseTrain(releaseTrain.id, 'landed')}
                        >
                          land
                        </button>
                      )}
                      {col.status !== 'open' && col.status !== 'cancelled' && (
                        <button
                          style={{ ...styles.actionBtn, color: '#555' }}
                          onClick={() => moveReleaseTrain(releaseTrain.id, 'cancelled')}
                        >
                          cancel
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              {cards.length === 0 && (
                <div style={styles.emptyCol}>no {col.label.toLowerCase()} release trains</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const STATUS_COLOR: Record<string, string> = {
  idle: '#666',
  working: '#4ec9b0',
  stalled: '#ce9178',
  zombie: '#f44747',
  done: '#608b4e',
}

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    overflow: 'hidden',
  },
  tabBar: {
    display: 'flex',
    gap: 1,
    background: '#0a0a0a',
    borderBottom: '1px solid #1e1e1e',
    padding: '4px 8px',
    flexShrink: 0,
  },
  tabBtn: {
    background: 'none',
    border: '1px solid transparent',
    color: '#555',
    borderRadius: 3,
    padding: '2px 10px',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  tabBtnActive: {
    color: '#d4d4d4',
    borderColor: '#2d2d2d',
    background: '#1a1a1a',
  },
  body: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  board: {
    display: 'flex',
    gap: 1,
    height: '100%',
    overflow: 'hidden',
    background: '#0d0d0d',
  },
  column: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    borderRight: '1px solid #1e1e1e',
    overflow: 'hidden',
  },
  colHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px 8px',
    borderBottom: '1px solid #1e1e1e',
    background: '#0f0f0f',
    flexShrink: 0,
  },
  colTitle: {
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: 'bold' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
  },
  colCount: {
    fontSize: 10,
    color: '#444',
    fontFamily: 'monospace',
  },
  cards: {
    flex: 1,
    overflow: 'auto',
    padding: '8px 6px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  card: {
    background: '#131313',
    border: '1px solid #1e1e1e',
    borderRadius: 4,
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  cardTitle: {
    fontSize: 12,
    color: '#d4d4d4',
    fontFamily: 'monospace',
    lineHeight: 1.3,
  },
  cardDesc: {
    fontSize: 10,
    color: '#666',
    fontFamily: 'monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  cardMeta: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  cardRig: {
    fontSize: 10,
    color: '#569cd6',
    fontFamily: 'monospace',
  },
  cardBeads: {
    fontSize: 10,
    color: '#555',
    fontFamily: 'monospace',
  },
  cardBee: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    cursor: 'pointer',
    padding: '2px 0',
  },
  beeName: {
    fontSize: 10,
    color: '#d4d4d4',
    fontFamily: 'monospace',
    flex: 1,
  },
  beeStatus: {
    fontSize: 10,
    fontFamily: 'monospace',
  },
  cardActions: {
    display: 'flex',
    gap: 4,
    marginTop: 2,
  },
  actionBtn: {
    background: 'none',
    border: '1px solid #2a2a2a',
    color: '#569cd6',
    borderRadius: 3,
    padding: '2px 8px',
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  emptyCol: {
    color: '#333',
    fontSize: 10,
    fontFamily: 'monospace',
    textAlign: 'center' as const,
    padding: '16px 0',
  },
  newBtn: {
    background: 'none',
    border: 'none',
    color: '#444',
    cursor: 'pointer',
    fontSize: 16,
    lineHeight: 1,
    padding: '0 2px',
    marginLeft: 4,
  },
  newForm: {
    padding: '8px 10px',
    borderBottom: '1px solid #1e1e1e',
    background: '#0c0c0c',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  formInput: {
    background: '#111',
    border: '1px solid #2a2a2a',
    color: '#d4d4d4',
    borderRadius: 3,
    padding: '4px 6px',
    fontSize: 11,
    fontFamily: 'monospace',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  checkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
  },
  checkLabel: {
    fontSize: 10,
    color: '#888',
    fontFamily: 'monospace',
  },
  formActions: {
    display: 'flex',
    gap: 4,
  },
  // Standbys
  standbys: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    overflow: 'auto',
    padding: 16,
    gap: 12,
  },
  standbysHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  standbysTitle: {
    fontSize: 11,
    color: '#888',
    fontFamily: 'monospace',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
  },
  standbyCard: {
    background: '#111',
    border: '1px solid #1e1e1e',
    borderRadius: 4,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  standbyCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  standbyName: {
    fontSize: 13,
    color: '#d4d4d4',
    fontFamily: 'monospace',
    flex: 1,
  },
  standbyProject: {
    fontSize: 10,
    color: '#569cd6',
    fontFamily: 'monospace',
  },
  standbyDesc: {
    fontSize: 10,
    color: '#666',
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap' as const,
    maxHeight: 60,
    overflow: 'hidden',
  },
  standbyDescExpanded: {
    fontSize: 10,
    color: '#888',
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap' as const,
  },
  standbyActions: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
  },
  dispatchBtn: {
    background: '#1a2a3a',
    border: '1px solid #569cd6',
    color: '#569cd6',
    borderRadius: 3,
    padding: '3px 10px',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  expandBtn: {
    background: 'none',
    border: 'none',
    color: '#444',
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'monospace',
    padding: 0,
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    color: '#3a1a1a',
    cursor: 'pointer',
    fontSize: 10,
    marginLeft: 'auto',
  },
  addStandbyForm: {
    background: '#0c0c0c',
    border: '1px dashed #2a2a2a',
    borderRadius: 4,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  addStandbyBtn: {
    background: 'none',
    border: '1px dashed #2a2a2a',
    color: '#555',
    borderRadius: 4,
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'monospace',
    textAlign: 'left' as const,
  },
  contextBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: '#0c0c0c',
    border: '1px solid #1e1e1e',
    borderRadius: 3,
    padding: '5px 10px',
  },
  contextLabel: {
    fontSize: 10,
    color: '#444',
    fontFamily: 'monospace',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  },
  contextValue: {
    fontSize: 11,
    color: '#d4d4d4',
    fontFamily: 'monospace',
  },
  contextSep: {
    color: '#333',
    fontSize: 11,
  },
  contextSelect: {
    background: 'transparent',
    border: 'none',
    color: '#d4d4d4',
    fontFamily: 'monospace',
    fontSize: 11,
    cursor: 'pointer',
    outline: 'none',
    padding: 0,
  },
}

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

  const activeTownId = useStore((s) => s.activeTownId)
  const towns = useStore((s) => s.towns)
  const activeTown = towns.find((t) => t.id === activeTownId)

  const rigNameById = Object.fromEntries(rigs.map((r) => [r.id, r.name]))
  const [activeProjectId, setActiveProjectId] = useState<string>('')
  const resolvedProjectId = activeProjectId || rigs[0]?.id || ''

  const [expanded, setExpanded] = useState<string | null>(null)
  const [dispatching, setDispatching] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', content: '', projectId: '' })
  const [saving, setSaving] = useState(false)

  const handleDispatch = async (tpl: TemplateEntry) => {
    const projectId = tpl.projectId === 'system' ? resolvedProjectId : tpl.projectId
    if (!projectId) return
    setDispatching(tpl.id)
    try {
      // Create a release train from the template then dispatch it
      const rtRes = await apiFetch('/api/release-trains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tpl.name, description: tpl.content, projectId }),
      })
      const rt = await rtRes.json()
      addReleaseTrain(rt)
      const dRes = await apiFetch(`/api/release-trains/${rt.id}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await dRes.json()
      if (data.bee) addAgent({ ...data.bee, taskDescription: data.bee.taskDescription ?? '', worktreePath: data.bee.worktreePath ?? '', branch: data.bee.branch ?? '' })
      if (data.releaseTrain) updateReleaseTrain(rt.id, { assignedWorkerBeeId: data.releaseTrain.assignedWorkerBeeId, status: data.releaseTrain.status })
      if (data.bee?.sessionId) {
        const hasSession = tabs.some((t: { panes: string[] }) => t.panes.includes(data.bee.sessionId))
        if (!hasSession) {
          if (activeTabId) addPaneToTab(activeTabId, data.bee.sessionId)
          else addTab(data.bee.name, [data.bee.sessionId])
        }
      }
    } finally {
      setDispatching(null)
    }
  }

  const handleSave = async () => {
    const projectId = form.projectId || rigs[0]?.id
    if (!form.name.trim() || !form.content.trim() || !projectId) return
    setSaving(true)
    try {
      const res = await apiFetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), content: form.content.trim(), projectId }),
      })
      addTemplate(await res.json())
      setForm({ name: '', content: '', projectId: '' })
      setShowForm(false)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/templates/${id}`, { method: 'DELETE' })
    removeTemplate(id)
  }

  return (
    <div style={styles.standbys}>
      <div style={styles.standbysHeader}>
        <span style={styles.standbysTitle}>Standby Templates</span>
        <span style={{ fontSize: 10, color: '#444', fontFamily: 'monospace' }}>
          one-click dispatch · Mayor Lee can also trigger these
        </span>
      </div>

      <div style={styles.contextBar}>
        <span style={styles.contextLabel}>workspace</span>
        <span style={styles.contextValue}>{activeTown?.name ?? activeTownId ?? '—'}</span>
        <span style={styles.contextSep}>·</span>
        <span style={styles.contextLabel}>project</span>
        {rigs.length === 0 ? (
          <span style={{ ...styles.contextValue, color: '#f44747' }}>no projects in workspace</span>
        ) : rigs.length === 1 ? (
          <span style={styles.contextValue}>{rigs[0].name}</span>
        ) : (
          <select
            style={styles.contextSelect}
            value={resolvedProjectId}
            onChange={(e) => setActiveProjectId(e.target.value)}
          >
            {rigs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
      </div>

      {templates.length === 0 && !showForm && (
        <div style={{ color: '#444', fontSize: 11, fontFamily: 'monospace' }}>
          No standbys yet. Create a template to define a repeatable job (security review, design audit, etc.)
        </div>
      )}

      {templates.map((tpl) => (
        <div key={tpl.id} style={styles.standbyCard}>
          <div style={styles.standbyCardHeader}>
            <span style={styles.standbyName}>{tpl.name}</span>
            <span style={styles.standbyProject}>{tpl.projectId === 'system' ? 'system' : (rigNameById[tpl.projectId] ?? '(unknown project)')}</span>
            <button style={styles.deleteBtn} onClick={() => handleDelete(tpl.id)} title="Delete template">✕</button>
          </div>
          <div
            style={expanded === tpl.id ? styles.standbyDescExpanded : styles.standbyDesc}
          >
            {tpl.content}
          </div>
          <div style={styles.standbyActions}>
            <button
              style={styles.dispatchBtn}
              onClick={() => handleDispatch(tpl)}
              disabled={dispatching === tpl.id}
            >
              {dispatching === tpl.id ? '…' : '▶ Dispatch Now'}
            </button>
            <button
              style={styles.expandBtn}
              onClick={() => setExpanded(expanded === tpl.id ? null : tpl.id)}
            >
              {expanded === tpl.id ? 'collapse' : 'expand'}
            </button>
          </div>
        </div>
      ))}

      {showForm ? (
        <div style={styles.addStandbyForm}>
          <input
            style={styles.formInput}
            placeholder="Standby name (e.g. Security Review)"
            value={form.name}
            autoFocus
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <textarea
            style={{ ...styles.formInput, resize: 'vertical' as const, minHeight: 100 }}
            placeholder="Instructions for the WorkerBee…"
            value={form.content}
            rows={5}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
          />
          {rigs.length > 1 && (
            <select
              style={styles.formInput}
              value={form.projectId || rigs[0]?.id}
              onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}
            >
              {rigs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          <div style={styles.formActions}>
            <button style={styles.dispatchBtn} onClick={handleSave} disabled={saving || !form.name.trim() || !form.content.trim()}>
              {saving ? '…' : 'Save Standby'}
            </button>
            <button style={{ ...styles.actionBtn, color: '#555' }} onClick={() => setShowForm(false)}>cancel</button>
          </div>
        </div>
      ) : (
        <button style={styles.addStandbyBtn} onClick={() => setShowForm(true)}>+ New Standby</button>
      )}
    </div>
  )
}
