import { useState, useEffect } from 'react'
import { useStore } from '../../store/index.js'
import type { TownEntry } from '../../store/index.js'

export function TownSelector() {
  const towns = useStore((s) => s.towns)
  const activeTownId = useStore((s) => s.activeTownId)
  const setTowns = useStore((s) => s.setTowns)
  const setActiveTownId = useStore((s) => s.setActiveTownId)
  const setRigs = useStore((s) => s.setRigs)
  const addToast = useStore((s) => s.addToast)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', path: '' })

  useEffect(() => {
    fetch('/api/towns')
      .then((r) => r.json())
      .then((data: TownEntry[]) => {
        setTowns(data)
        if (data.length > 0 && !activeTownId) {
          setActiveTownId(data[0].id)
        }
      })
      .catch(() => {})
  }, [setTowns, setActiveTownId, activeTownId])

  const handleSwitch = (id: string) => {
    setActiveTownId(id)
    fetch(`/api/rigs?townId=${id}`)
      .then((r) => r.json())
      .then(setRigs)
      .catch(() => addToast('Failed to load projects for town'))
  }

  const handleCreate = async () => {
    if (!form.name || !form.path) return
    try {
      const res = await fetch('/api/towns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error(await res.text())
      const town = await res.json() as TownEntry
      setTowns([...towns, town])
      setActiveTownId(town.id)
      setForm({ name: '', path: '' })
      setShowForm(false)
    } catch (err) {
      addToast(`Failed to create town: ${(err as Error).message}`)
    }
  }

  const activeTown = towns.find((t) => t.id === activeTownId)

  return (
    <div style={styles.wrapper}>
      {towns.length > 1 ? (
        <select
          style={styles.select}
          value={activeTownId ?? ''}
          onChange={(e) => handleSwitch(e.target.value)}
        >
          {towns.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      ) : (
        <span style={styles.townName}>{activeTown?.name ?? 'default'}</span>
      )}
      {showForm ? (
        <div style={styles.form}>
          <input
            style={styles.input}
            placeholder="Town name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <input
            style={styles.input}
            placeholder="Path"
            value={form.path}
            onChange={(e) => setForm((f) => ({ ...f, path: e.target.value }))}
          />
          <div style={styles.btns}>
            <button style={styles.saveBtn} onClick={handleCreate}>Create</button>
            <button style={styles.cancelBtn} onClick={() => setShowForm(false)}>&#x2715;</button>
          </div>
        </div>
      ) : (
        <button style={styles.newBtn} onClick={() => setShowForm(true)} title="New town">+</button>
      )}
    </div>
  )
}

const styles = {
  wrapper: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '4px 8px', borderBottom: '1px solid #2d2d2d',
    background: '#0d0d0d', flexShrink: 0,
  },
  townName: { fontSize: 11, color: '#569cd6', fontFamily: 'monospace', flex: 1 },
  select: {
    flex: 1, background: '#111', border: '1px solid #2a2a2a', color: '#569cd6',
    borderRadius: 3, fontSize: 11, fontFamily: 'monospace', padding: '2px 4px', outline: 'none',
  },
  newBtn: {
    background: 'none', border: '1px solid #2a2a2a', color: '#444',
    borderRadius: 3, width: 18, height: 18, cursor: 'pointer', fontSize: 12,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    padding: 0,
  },
  form: { display: 'flex', flexDirection: 'column' as const, gap: 3, flex: 1 },
  input: {
    background: '#1a1a1a', border: '1px solid #333', color: '#d4d4d4',
    borderRadius: 3, padding: '2px 5px', fontSize: 10, fontFamily: 'monospace', outline: 'none',
  },
  btns: { display: 'flex', gap: 3 },
  saveBtn: {
    flex: 1, background: 'none', border: '1px solid #569cd6', color: '#569cd6',
    borderRadius: 3, padding: '1px', cursor: 'pointer', fontSize: 9, fontFamily: 'monospace',
  },
  cancelBtn: {
    background: 'none', border: '1px solid #333', color: '#555',
    borderRadius: 3, padding: '1px 4px', cursor: 'pointer', fontSize: 9,
  },
}
