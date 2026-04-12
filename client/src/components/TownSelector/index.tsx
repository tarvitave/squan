import { useState, useEffect } from 'react'
import { MapPin, ChevronDown } from 'lucide-react'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'
import { cn } from '../../lib/utils.js'
import type { TownEntry } from '../../store/index.js'

const SQUANSQ_ROOT = 'C:\\Users\\colin\\squan'
function autoPath(name: string) {
  return `${SQUANSQ_ROOT}\\${name.toLowerCase().replace(/\s+/g, '-')}`
}

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
    apiFetch('/api/towns')
      .then((r) => r.json())
      .then((data: TownEntry[]) => {
        setTowns(data)
        if (data.length > 0 && !activeTownId) {
          setActiveTownId(data[0].id)
        }
      })
      .catch(() => {})
  }, [activeTownId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSwitch = (id: string) => {
    setActiveTownId(id)
    apiFetch(`/api/rigs?townId=${id}`)
      .then((r) => r.json())
      .then(setRigs)
      .catch(() => addToast('Failed to load projects for namespace'))
  }

  const handleCreate = async () => {
    if (!form.name || !form.path) return
    try {
      const res = await apiFetch('/api/towns', {
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
      addToast(`Failed to create namespace: ${(err as Error).message}`)
    }
  }

  const activeTown = towns.find((t) => t.id === activeTownId)

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border-primary bg-bg-primary px-2 py-1">
      <MapPin className="h-3 w-3 shrink-0 text-text-info" />
      {towns.length > 1 ? (
        <div className="relative flex-1">
          <select
            className="w-full appearance-none rounded border border-border-primary bg-bg-primary pr-6 pl-1 py-0.5 font-mono text-[11px] text-text-info outline-none focus:border-block-teal"
            value={activeTownId ?? ''}
            onChange={(e) => handleSwitch(e.target.value)}
          >
            {towns.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 text-text-tertiary" />
        </div>
      ) : (
        <span className="flex-1 font-mono text-[11px] text-text-info">{activeTown?.name ?? 'default'}</span>
      )}
      {showForm ? (
        <div className="flex flex-1 flex-col gap-0.5">
          <input
            className="rounded border border-border-primary bg-bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-text-primary outline-none focus:border-block-teal"
            placeholder="Namespace name"
            value={form.name}
            onChange={(e) => {
              const name = e.target.value
              setForm((f) => ({
                name,
                path: f.path === autoPath(f.name) ? autoPath(name) : f.path,
              }))
            }}
          />
          <input
            className="rounded border border-border-primary bg-bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-text-primary outline-none focus:border-block-teal"
            placeholder="Path"
            value={form.path}
            onChange={(e) => setForm((f) => ({ ...f, path: e.target.value }))}
          />
          <div className="flex gap-0.5">
            <button
              className="flex-1 cursor-pointer rounded border border-text-info bg-transparent px-0.5 py-px font-mono text-[9px] text-text-info hover:bg-text-info/10"
              onClick={handleCreate}
            >
              Create
            </button>
            <button
              className="cursor-pointer rounded border border-border-primary bg-transparent px-1 py-px text-[9px] text-text-tertiary hover:text-text-secondary"
              onClick={() => setShowForm(false)}
            >
              &#x2715;
            </button>
          </div>
        </div>
      ) : (
        <button
          className="flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded border border-border-primary bg-transparent p-0 text-xs text-text-disabled hover:border-border-secondary hover:text-text-secondary"
          onClick={() => { setForm({ name: '', path: autoPath('') }); setShowForm(true) }}
          title="New namespace"
        >
          +
        </button>
      )}
    </div>
  )
}
