import { useState, useEffect } from 'react'
import { useStore } from '../../store/index.js'
import { apiFetch } from '../../lib/api.js'
import {
  Clock, Plus, Play, Pause, Trash2, Edit2, X,
  GitBranch, Zap, Link2, Loader2, Save,
} from 'lucide-react'

interface Automation {
  id: string
  name: string
  projectId: string
  type: 'scheduled' | 'event' | 'chain'
  enabled: boolean
  skillId?: string
  taskDescription?: string
  role?: string
  schedule?: { cron: string; timezone?: string }
  trigger?: { event: string; filter?: string }
  chain?: { afterAutomationId: string; condition?: string }
  lastRun?: string
  nextRun?: string
  userId: string
  createdAt: string
}

const TYPES = [
  { value: 'scheduled', label: '🕐 Scheduled', desc: 'Run on a cron schedule' },
  { value: 'event', label: '⚡ Event', desc: 'Triggered by GitHub events' },
  { value: 'chain', label: '🔗 Chain', desc: 'Run after another automation' },
]

const EVENTS = [
  { value: 'push', label: 'Push to main' },
  { value: 'pr_opened', label: 'PR opened' },
  { value: 'issue_created', label: 'Issue created' },
  { value: 'agent_completed', label: 'Agent completed' },
]

const PRESETS = [
  { label: 'Every morning 9am', cron: '0 9 * * *' },
  { label: 'Every Friday 5pm', cron: '0 17 * * 5' },
  { label: 'Every Monday 8am', cron: '0 8 * * 1' },
  { label: 'Every night 2am', cron: '0 2 * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Every hour', cron: '0 * * * *' },
]

const SKILLS = [
  { value: '', label: 'Custom task' },
  { value: 'test-fix-pr', label: 'Test → Fix → PR' },
  { value: 'review-refactor', label: 'Review → Refactor' },
  { value: 'generate-docs', label: 'Generate Docs' },
  { value: 'security-audit', label: 'Security Audit' },
]

export function AutomationsView() {
  const activeProjectId = useStore((s) => s.activeProjectId)
  const rigs = useStore((s) => s.rigs)
  const activeProject = rigs.find((r) => r.id === activeProjectId)

  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  // Form state
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<'scheduled' | 'event' | 'chain'>('scheduled')
  const [formSkill, setFormSkill] = useState('')
  const [formTask, setFormTask] = useState('')
  const [formRole, setFormRole] = useState('coder')
  const [formCron, setFormCron] = useState('0 9 * * *')
  const [formEvent, setFormEvent] = useState('push')
  const [formChainAfter, setFormChainAfter] = useState('')
  const [formChainCondition, setFormChainCondition] = useState('success')
  const [saving, setSaving] = useState(false)

  const loadAutomations = async () => {
    try {
      const res = await apiFetch('/api/automations')
      if (res.ok) setAutomations(await res.json())
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => { loadAutomations() }, [])

  const projectAutomations = activeProjectId
    ? automations.filter(a => a.projectId === activeProjectId)
    : automations

  const resetForm = () => {
    setFormName(''); setFormType('scheduled'); setFormSkill(''); setFormTask('')
    setFormRole('coder'); setFormCron('0 9 * * *'); setFormEvent('push')
    setFormChainAfter(''); setFormChainCondition('success')
    setShowCreate(false); setEditId(null)
  }

  const editAutomation = (auto: Automation) => {
    setEditId(auto.id)
    setFormName(auto.name)
    setFormType(auto.type)
    setFormSkill(auto.skillId || '')
    setFormTask(auto.taskDescription || '')
    setFormRole(auto.role || 'coder')
    if (auto.schedule) setFormCron(auto.schedule.cron)
    if (auto.trigger) setFormEvent(auto.trigger.event)
    if (auto.chain) { setFormChainAfter(auto.chain.afterAutomationId); setFormChainCondition(auto.chain.condition || 'success') }
    setShowCreate(true)
  }

  const saveAutomation = async () => {
    if (!formName.trim()) return
    if (!activeProjectId) {
      useStore.getState().addToast('Select or create a project before creating an automation.', 'error')
      return
    }
    setSaving(true)
    const body: any = {
      name: formName.trim(),
      projectId: activeProjectId,
      type: formType,
      role: formRole,
    }
    if (formSkill) body.skillId = formSkill
    if (formTask.trim()) body.taskDescription = formTask.trim()
    if (formType === 'scheduled') body.schedule = { cron: formCron }
    if (formType === 'event') body.trigger = { event: formEvent }
    if (formType === 'chain') body.chain = { afterAutomationId: formChainAfter, condition: formChainCondition }

    try {
      const url = editId ? `/api/automations/${editId}` : '/api/automations'
      const method = editId ? 'PUT' : 'POST'
      const res = await apiFetch(url, { method, body: JSON.stringify(body) })
      if (res.ok) {
        useStore.getState().addToast(editId ? 'Automation updated' : 'Automation created', 'info')
        resetForm()
        loadAutomations()
      } else {
        const err = await res.json()
        useStore.getState().addToast(err.error || 'Failed to save')
      }
    } catch { useStore.getState().addToast('Failed to save') }
    setSaving(false)
  }

  const toggleAutomation = async (id: string, enabled: boolean) => {
    const endpoint = enabled ? 'disable' : 'enable'
    await apiFetch(`/api/automations/${id}/${endpoint}`, { method: 'POST' })
    loadAutomations()
  }

  const deleteAutomation = async (id: string) => {
    if (!confirm('Delete this automation?')) return
    await apiFetch(`/api/automations/${id}`, { method: 'DELETE' })
    loadAutomations()
  }

  const runNow = async (id: string) => {
    await apiFetch(`/api/automations/${id}/run`, { method: 'POST' })
    useStore.getState().addToast('Automation triggered', 'info')
    loadAutomations()
  }

  const typeIcon = (type: string) => {
    if (type === 'scheduled') return <Clock className="w-4 h-4 text-blue-400" />
    if (type === 'event') return <Zap className="w-4 h-4 text-yellow-400" />
    return <Link2 className="w-4 h-4 text-purple-400" />
  }

  const S = {
    label: 'text-xs font-medium text-gray-500 block mb-1',
    input: 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500',
    select: 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-teal-500/20 cursor-pointer bg-white',
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Automations</h2>
          <p className="text-sm text-gray-400">
            {activeProject ? `${activeProject.name} — ` : ''}
            Schedule skills, react to events, chain workflows
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowCreate(true) }}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-500 rounded-lg hover:bg-teal-600 transition-colors"
        >
          <Plus className="w-4 h-4" /> New Automation
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
          </div>
        ) : projectAutomations.length === 0 && !showCreate ? (
          <div className="text-center py-16">
            <Clock className="w-12 h-12 text-gray-200 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-700 mb-2">No automations yet</h3>
            <p className="text-sm text-gray-400 mb-6 max-w-md mx-auto">
              Automate your workflow: schedule daily tests, trigger code reviews on PR, or chain agents together.
            </p>
            <button
              onClick={() => { resetForm(); setShowCreate(true) }}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-teal-600 border border-teal-200 rounded-lg hover:bg-teal-50 transition-colors"
            >
              <Plus className="w-4 h-4" /> Create your first automation
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {projectAutomations.map((auto) => (
              <div key={auto.id} className={`border rounded-lg p-4 transition-colors ${auto.enabled ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
                <div className="flex items-center gap-3">
                  {typeIcon(auto.type)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 text-sm">{auto.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${auto.enabled ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                        {auto.enabled ? 'Active' : 'Paused'}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {auto.type === 'scheduled' && auto.schedule && `Cron: ${auto.schedule.cron}`}
                      {auto.type === 'event' && auto.trigger && `On: ${auto.trigger.event}`}
                      {auto.type === 'chain' && auto.chain && `After: ${auto.chain.afterAutomationId}`}
                      {auto.skillId && ` · Skill: ${auto.skillId}`}
                      {auto.lastRun && ` · Last: ${new Date(auto.lastRun).toLocaleDateString()}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => runNow(auto.id)} title="Run now"
                      className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-400 hover:text-teal-500 hover:border-teal-200 transition-colors">
                      <Play className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => toggleAutomation(auto.id, auto.enabled)} title={auto.enabled ? 'Pause' : 'Enable'}
                      className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-400 hover:text-yellow-500 hover:border-yellow-200 transition-colors">
                      <Pause className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => editAutomation(auto)} title="Edit"
                      className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-400 hover:text-blue-500 hover:border-blue-200 transition-colors">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => deleteAutomation(auto.id)} title="Delete"
                      className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-400 hover:text-red-500 hover:border-red-200 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create/Edit Form */}
        {showCreate && (
          <div className="mt-6 border border-teal-200 rounded-lg p-5 bg-teal-50/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">{editId ? 'Edit Automation' : 'New Automation'}</h3>
              <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>

            <div className="space-y-4">
              <div>
                <label className={S.label}>Name</label>
                <input className={S.input} value={formName} onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Daily test run" autoFocus />
              </div>

              {/* Type selector */}
              <div>
                <label className={S.label}>Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {TYPES.map((t) => (
                    <button key={t.value} onClick={() => setFormType(t.value as any)}
                      className={`p-3 text-left rounded-lg border text-sm transition-colors ${
                        formType === t.value ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-200 hover:border-gray-300'
                      }`}>
                      <div className="font-medium">{t.label}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{t.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Schedule config */}
              {formType === 'scheduled' && (
                <div>
                  <label className={S.label}>Schedule</label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {PRESETS.map((p) => (
                      <button key={p.cron} onClick={() => setFormCron(p.cron)}
                        className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                          formCron === p.cron ? 'border-teal-500 bg-teal-50 text-teal-600' : 'border-gray-200 text-gray-500 hover:border-gray-300'
                        }`}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <input className={S.input} value={formCron} onChange={(e) => setFormCron(e.target.value)}
                    placeholder="0 9 * * * (minute hour day month weekday)" />
                </div>
              )}

              {/* Event config */}
              {formType === 'event' && (
                <div>
                  <label className={S.label}>Trigger event</label>
                  <div className="grid grid-cols-2 gap-2">
                    {EVENTS.map((ev) => (
                      <button key={ev.value} onClick={() => setFormEvent(ev.value)}
                        className={`p-2 text-sm rounded-lg border transition-colors ${
                          formEvent === ev.value ? 'border-teal-500 bg-teal-50 text-teal-600' : 'border-gray-200 hover:border-gray-300'
                        }`}>
                        {ev.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Chain config */}
              {formType === 'chain' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={S.label}>After automation</label>
                    <select className={S.select} value={formChainAfter} onChange={(e) => setFormChainAfter(e.target.value)}>
                      <option value="">Select...</option>
                      {automations.filter(a => a.id !== editId).map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={S.label}>Condition</label>
                    <select className={S.select} value={formChainCondition} onChange={(e) => setFormChainCondition(e.target.value)}>
                      <option value="success">On success</option>
                      <option value="any">Always</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Skill / Task */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={S.label}>Skill</label>
                  <select className={S.select} value={formSkill} onChange={(e) => setFormSkill(e.target.value)}>
                    {SKILLS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={S.label}>Agent role</label>
                  <select className={S.select} value={formRole} onChange={(e) => setFormRole(e.target.value)}>
                    <option value="coder">Coder</option>
                    <option value="tester">Tester</option>
                    <option value="reviewer">Reviewer</option>
                    <option value="devops">DevOps</option>
                    <option value="lead">Lead</option>
                  </select>
                </div>
              </div>

              {!formSkill && (
                <div>
                  <label className={S.label}>Task description</label>
                  <textarea className={`${S.input} resize-none`} rows={3} value={formTask}
                    onChange={(e) => setFormTask(e.target.value)} placeholder="What should the agent do?" />
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={saveAutomation} disabled={!formName.trim() || saving}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-teal-500 rounded-lg hover:bg-teal-600 transition-colors disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? 'Saving...' : editId ? 'Update Automation' : 'Create Automation'}
                </button>
                <button onClick={resetForm}
                  className="px-4 py-2.5 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
