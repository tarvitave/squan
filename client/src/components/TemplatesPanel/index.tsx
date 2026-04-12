import { useEffect, useState } from 'react'
import { FileText, Plus, Trash2 } from 'lucide-react'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'
import { cn } from '../../lib/utils.js'
import type { TemplateEntry } from '../../store/index.js'

interface Props {
  projectId: string
  onSelect?: (content: string) => void
}

export function TemplatesPanel({ projectId, onSelect }: Props) {
  const allTemplates = useStore((s) => s.templates)
  const setTemplates = useStore((s) => s.setTemplates)
  const addTemplate = useStore((s) => s.addTemplate)
  const templates = allTemplates.filter((t) => t.projectId === projectId)
  const removeTemplate = useStore((s) => s.removeTemplate)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', content: '' })
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    apiFetch(`/api/templates?projectId=${projectId}`)
      .then((r) => r.json())
      .then((data: TemplateEntry[]) => {
        const others = allTemplates.filter((t) => t.projectId !== projectId)
        setTemplates([...others, ...data])
      })
      .catch(() => {})
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async () => {
    if (!form.name || !form.content) return
    const res = await apiFetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, ...form }),
    })
    const tpl = await res.json()
    addTemplate(tpl)
    setForm({ name: '', content: '' })
    setShowForm(false)
  }

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/templates/${id}`, { method: 'DELETE' })
    removeTemplate(id)
  }

  if (templates.length === 0 && !showForm) {
    return (
      <div className="py-1">
        <button
          className="mx-2 cursor-pointer rounded border border-dashed border-border-primary bg-transparent px-1.5 py-0.5 text-left font-mono text-[10px] text-text-tertiary hover:border-border-secondary hover:text-text-secondary"
          onClick={() => setShowForm(true)}
        >
          <Plus className="mr-1 inline-block h-3 w-3 align-middle" />
          Template
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      {templates.map((tpl) => (
        <div key={tpl.id} className="border-b border-border-primary py-1">
          <div className="flex items-center gap-1 px-2">
            <FileText className="h-3 w-3 shrink-0 text-text-tertiary" />
            <span
              className="flex-1 cursor-pointer font-mono text-[11px] text-text-secondary hover:text-text-primary"
              onClick={() => setExpanded(expanded === tpl.id ? null : tpl.id)}
            >
              {tpl.name}
            </span>
            <div className="flex gap-1">
              {onSelect && (
                <button
                  className="cursor-pointer rounded border border-border-primary bg-transparent px-1.5 py-px font-mono text-[9px] text-block-teal hover:border-block-teal"
                  onClick={() => onSelect(tpl.content)}
                >
                  use
                </button>
              )}
              <button
                className="cursor-pointer border-none bg-transparent p-0 text-text-disabled hover:text-text-danger"
                onClick={() => handleDelete(tpl.id)}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
          {expanded === tpl.id && (
            <pre className="mx-2 mt-1 max-h-[120px] overflow-auto whitespace-pre-wrap rounded border border-border-primary bg-bg-primary p-1 font-mono text-[9px] text-text-tertiary">
              {tpl.content}
            </pre>
          )}
        </div>
      ))}

      {showForm ? (
        <div className="flex flex-col gap-1 px-2 py-1">
          <input
            className="w-full rounded border border-border-primary bg-bg-secondary px-1.5 py-1 font-mono text-[11px] text-text-primary outline-none focus:border-block-teal"
            placeholder="Template name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <textarea
            className="min-h-[80px] w-full resize-y rounded border border-border-primary bg-bg-secondary px-1.5 py-1 font-mono text-[11px] text-text-primary outline-none focus:border-block-teal"
            placeholder="Template content (CLAUDE.md)"
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
          />
          <div className="flex gap-1">
            <button
              className="flex-1 cursor-pointer rounded border border-block-teal bg-block-teal/10 px-1 py-0.5 font-mono text-[10px] text-block-teal hover:bg-block-teal/20"
              onClick={handleCreate}
            >
              Save
            </button>
            <button
              className="flex-1 cursor-pointer rounded border border-border-primary bg-transparent px-1 py-0.5 font-mono text-[10px] text-text-secondary hover:border-border-secondary"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          className="mx-2 cursor-pointer rounded border border-dashed border-border-primary bg-transparent px-1.5 py-0.5 text-left font-mono text-[10px] text-text-tertiary hover:border-border-secondary hover:text-text-secondary"
          onClick={() => setShowForm(true)}
        >
          <Plus className="mr-1 inline-block h-3 w-3 align-middle" />
          Template
        </button>
      )}
    </div>
  )
}
