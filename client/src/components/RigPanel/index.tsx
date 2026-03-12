import { useEffect, useState } from 'react'
import { useStore } from '../../store/index.js'
import type { Rig } from '../../store/index.js'

export function RigPanel() {
  const rigs = useStore((s) => s.rigs)
  const setRigs = useStore((s) => s.setRigs)
  const addPaneToTab = useStore((s) => s.addPaneToTab)
  const addTab = useStore((s) => s.addTab)
  const activeTabId = useStore((s) => s.activeTabId)
  const tabs = useStore((s) => s.tabs)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', repoUrl: '', localPath: '' })
  const [spawning, setSpawning] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/rigs')
      .then((r) => r.json())
      .then(setRigs)
      .catch(() => {})
  }, [setRigs])

  const handleAdd = async () => {
    if (!form.name || !form.localPath) return
    const res = await fetch('/api/rigs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const rig = await res.json()
    setRigs([...rigs, rig])
    setForm({ name: '', repoUrl: '', localPath: '' })
    setShowForm(false)
  }

  const handleSpawn = async (rig: Rig) => {
    setSpawning(rig.id)
    try {
      const res = await fetch(`/api/rigs/${rig.id}/polecats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const polecat = await res.json()
      if (polecat.sessionId) {
        const hasSession = tabs.some((t) => t.panes.includes(polecat.sessionId))
        if (!hasSession) {
          if (activeTabId) {
            addPaneToTab(activeTabId, polecat.sessionId)
          } else {
            addTab(rig.name, [polecat.sessionId])
          }
        }
      }
    } finally {
      setSpawning(null)
    }
  }

  return (
    <div style={styles.panel}>
      {rigs.map((rig) => (
        <div key={rig.id} style={styles.rigRow}>
          <div style={styles.rigInfo}>
            <span style={styles.rigName}>{rig.name}</span>
            <span style={styles.rigPath}>{rig.localPath}</span>
          </div>
          <button
            style={styles.spawnBtn}
            onClick={() => handleSpawn(rig)}
            disabled={spawning === rig.id}
            title="Spawn a worker agent"
          >
            {spawning === rig.id ? '…' : '+ Worker'}
          </button>
        </div>
      ))}

      {showForm ? (
        <div style={styles.form}>
          <input
            style={styles.input}
            placeholder="Name (e.g. squansq)"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <input
            style={styles.input}
            placeholder="Local path (e.g. /repo)"
            value={form.localPath}
            onChange={(e) => setForm((f) => ({ ...f, localPath: e.target.value }))}
          />
          <input
            style={styles.input}
            placeholder="Repo URL (optional)"
            value={form.repoUrl}
            onChange={(e) => setForm((f) => ({ ...f, repoUrl: e.target.value }))}
          />
          <div style={styles.formBtns}>
            <button style={styles.addBtn} onClick={handleAdd}>Add</button>
            <button style={styles.cancelBtn} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button style={styles.newRigBtn} onClick={() => setShowForm(true)}>
          + Add Rig
        </button>
      )}
    </div>
  )
}

const styles = {
  panel: {
    padding: '4px 0',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  },
  rigRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 8px',
    gap: 6,
    borderBottom: '1px solid #1a1a1a',
  },
  rigInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 1,
    overflow: 'hidden',
  },
  rigName: {
    fontSize: 12,
    color: '#d4d4d4',
    fontFamily: 'monospace',
  },
  rigPath: {
    fontSize: 10,
    color: '#555',
    fontFamily: 'monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  spawnBtn: {
    background: 'none',
    border: '1px solid #3a3a3a',
    color: '#4ec9b0',
    borderRadius: 3,
    padding: '2px 6px',
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'monospace',
    flexShrink: 0,
  },
  form: {
    padding: '6px 8px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
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
  cancelBtn: {
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
  newRigBtn: {
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
