import { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'
import type { TemplateEntry } from '../../store/index.js'

interface Props {
  projectId: string
  onSelect?: (content: string) => void
}

export function TemplatesPanel({ projectId, onSelect }: Props) {
  const templates = useStore((s) => s.templates.filter((t) => t.projectId === projectId))
  const setTemplates = useStore((s) => s.setTemplates)
  const allTemplates = useStore((s) => s.templates)
  const addTemplate = useStore((s) => s.addTemplate)
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
      <div style={styles.empty}>
        <button style={styles.newBtn} onClick={() => setShowForm(true)}>+ Template</button>
      </div>
    )
  }

  return (
    <div style={styles.panel}>
      {templates.map((tpl) => (
        <div key={tpl.id} style={styles.row}>
          <div style={styles.rowTop}>
            <span
              style={styles.name}
              onClick={() => setExpanded(expanded === tpl.id ? null : tpl.id)}
            >
              {tpl.name}
            </span>
            <div style={styles.rowBtns}>
              {onSelect && (
                <button style={styles.useBtn} onClick={() => onSelect(tpl.content)}>use</button>
              )}
              <button style={styles.delBtn} onClick={() => handleDelete(tpl.id)}>✕</button>
            </div>
          </div>
          {expanded === tpl.id && (
            <pre style={styles.preview}>{tpl.content}</pre>
          )}
        </div>
      ))}

      {showForm ? (
        <div style={styles.form}>
          <input
            style={styles.input}
            placeholder="Template name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <textarea
            style={{ ...styles.input, resize: 'vertical', minHeight: 80 }}
            placeholder="Template content (CLAUDE.md)"
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
          />
          <div style={styles.formBtns}>
            <button style={styles.addBtn} onClick={handleCreate}>Save</button>
            <button style={styles.cancelBtn} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button style={styles.newBtn} onClick={() => setShowForm(true)}>+ Template</button>
      )}
    </div>
  )
}

const styles = {
  panel: { display: 'flex', flexDirection: 'column' as const, gap: 2 },
  empty: { padding: '4px 0' },
  row: {
    borderBottom: '1px solid #1e1e1e',
    padding: '4px 0',
  },
  rowTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '0 8px',
  },
  name: {
    fontSize: 11,
    color: '#888',
    fontFamily: 'monospace',
    flex: 1,
    cursor: 'pointer',
  },
  rowBtns: { display: 'flex', gap: 4 },
  useBtn: {
    background: 'none',
    border: '1px solid #333',
    color: '#4ec9b0',
    borderRadius: 3,
    padding: '1px 5px',
    cursor: 'pointer',
    fontSize: 9,
    fontFamily: 'monospace',
  },
  delBtn: {
    background: 'none',
    border: 'none',
    color: '#444',
    cursor: 'pointer',
    fontSize: 10,
  },
  preview: {
    margin: '4px 8px',
    fontSize: 9,
    color: '#555',
    fontFamily: 'monospace',
    background: '#111',
    border: '1px solid #1e1e1e',
    borderRadius: 3,
    padding: '4px',
    overflow: 'auto',
    maxHeight: 120,
    whiteSpace: 'pre-wrap' as const,
  },
  form: {
    padding: '4px 8px',
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
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  formBtns: { display: 'flex', gap: 4 },
  addBtn: {
    flex: 1,
    background: '#1a3a2a',
    border: '1px solid #4ec9b0',
    color: '#4ec9b0',
    borderRadius: 3,
    padding: '3px',
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  cancelBtn: {
    flex: 1,
    background: 'none',
    border: '1px solid #333',
    color: '#666',
    borderRadius: 3,
    padding: '3px',
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  newBtn: {
    margin: '4px 8px',
    background: 'none',
    border: '1px dashed #2a2a2a',
    color: '#555',
    borderRadius: 3,
    padding: '3px 6px',
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'monospace',
    textAlign: 'left' as const,
  },
}
