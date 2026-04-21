import { useState, useEffect } from 'react'
import { useStore } from '../../store/index.js'
import { apiFetch } from '../../lib/api.js'
import {
  CalendarClock, Plus, Trash2, Play, Pause, X, Edit2,
  Loader2, Clock, Zap, CheckCircle, AlertCircle, RefreshCw,
} from 'lucide-react'

interface ScheduledJob {
  id: string
  name: string
  type: 'cron' | 'event'
  schedule?: string  // cron expression
  eventTrigger?: string
  task: string
  skillId?: string
  enabled: boolean
  lastRun?: string
  nextRun?: string
  runCount: number
  createdAt: string
}

export function SchedulerView() {
  const token = useStore((s) => s.token)
  const [jobs, setJobs] = useState<ScheduledJob[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Form
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<'cron' | 'event'>('cron')
  const [formSchedule, setFormSchedule] = useState('0 */6 * * *')
  const [formEvent, setFormEvent] = useState('')
  const [formTask, setFormTask] = useState('')
  const [formEnabled, setFormEnabled] = useState(true)

  const loadJobs = async () => {
    try {
      const res = await apiFetch('/api/automations')
      if (res.ok) {
        const data = await res.json()
        setJobs(Array.isArray(data) ? data : [])
      }
    } catch {}
    setLoading(false)
  }

  useEffect(() => { loadJobs() }, [])

  const resetForm = () => {
    setFormName(''); setFormType('cron'); setFormSchedule('0 */6 * * *')
    setFormEvent(''); setFormTask(''); setFormEnabled(true); setEditingId(null)
  }

  const saveJob = async () => {
    if (!formName.trim() || !formTask.trim()) return
    const body: any = {
      name: formName.trim(),
      type: formType,
      task: formTask.trim(),
      enabled: formEnabled,
    }
    if (formType === 'cron') body.schedule = formSchedule
    else body.eventTrigger = formEvent

    try {
      if (editingId) {
        await apiFetch(`/api/automations/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        await apiFetch('/api/automations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      }
      resetForm(); setShowForm(false); loadJobs()
    } catch {}
  }

  const toggleJob = async (job: ScheduledJob) => {
    try {
      await apiFetch(`/api/automations/${job.id}/${job.enabled ? 'disable' : 'enable'}`, { method: 'POST' })
      loadJobs()
    } catch {}
  }

  const deleteJob = async (id: string) => {
    try {
      await apiFetch(`/api/automations/${id}`, { method: 'DELETE' })
      loadJobs()
    } catch {}
  }

  const runNow = async (job: ScheduledJob) => {
    try {
      await apiFetch(`/api/automations/${job.id}/run`, { method: 'POST' })
      loadJobs()
    } catch {}
  }

  const editJob = (job: ScheduledJob) => {
    setFormName(job.name)
    setFormType(job.type)
    setFormSchedule(job.schedule || '0 */6 * * *')
    setFormEvent(job.eventTrigger || '')
    setFormTask(job.task)
    setFormEnabled(job.enabled)
    setEditingId(job.id)
    setShowForm(true)
  }

  const CRON_PRESETS = [
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Every 6 hours', value: '0 */6 * * *' },
    { label: 'Daily at 9am', value: '0 9 * * *' },
    { label: 'Mon-Fri at 9am', value: '0 9 * * 1-5' },
    { label: 'Weekly Sunday', value: '0 0 * * 0' },
    { label: 'Monthly 1st', value: '0 0 1 * *' },
  ]

  const EVENT_TYPES = [
    'agent.completed', 'agent.error', 'git.push', 'git.pr.opened',
    'git.pr.merged', 'deploy.success', 'deploy.failure',
  ]

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-text-tertiary animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-primary shrink-0">
        <div className="flex items-center gap-3">
          <CalendarClock className="w-5 h-5 text-block-teal" />
          <div>
            <h2 className="text-base font-semibold text-text-primary">Scheduler</h2>
            <p className="text-xs text-text-secondary">Cron-based and event-triggered automations</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadJobs}
            className="p-2 text-text-tertiary hover:text-text-secondary transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => { resetForm(); setShowForm(!showForm) }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-block-teal rounded-lg hover:bg-teal-600 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Job
          </button>
        </div>
      </div>

      {/* Create/Edit form */}
      {showForm && (
        <div className="px-6 py-4 border-b border-border-primary bg-bg-secondary shrink-0">
          <div className="space-y-3 max-w-2xl">
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">Job Name</label>
              <input
                value={formName} onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Nightly test run"
                className="w-full px-3 py-2 text-sm border border-border-primary rounded-lg bg-bg-primary text-text-primary outline-none focus:border-block-teal"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">Trigger Type</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setFormType('cron')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    formType === 'cron'
                      ? 'bg-block-teal text-white border-block-teal'
                      : 'bg-bg-primary text-text-secondary border-border-primary hover:border-block-teal'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" /> Scheduled (Cron)
                </button>
                <button
                  onClick={() => setFormType('event')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    formType === 'event'
                      ? 'bg-block-teal text-white border-block-teal'
                      : 'bg-bg-primary text-text-secondary border-border-primary hover:border-block-teal'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5" /> Event-driven
                </button>
              </div>
            </div>

            {formType === 'cron' ? (
              <div>
                <label className="text-xs font-medium text-text-secondary block mb-1">Schedule (Cron)</label>
                <input
                  value={formSchedule} onChange={(e) => setFormSchedule(e.target.value)}
                  placeholder="0 */6 * * *"
                  className="w-full px-3 py-2 text-sm font-mono border border-border-primary rounded-lg bg-bg-primary text-text-primary outline-none focus:border-block-teal"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {CRON_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => setFormSchedule(p.value)}
                      className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                        formSchedule === p.value
                          ? 'bg-teal-50 text-teal-600 border-teal-200'
                          : 'bg-bg-primary text-text-tertiary border-border-primary hover:border-teal-200'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <label className="text-xs font-medium text-text-secondary block mb-1">Event</label>
                <select
                  value={formEvent} onChange={(e) => setFormEvent(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border-primary rounded-lg bg-bg-primary text-text-primary outline-none"
                >
                  <option value="">Select event...</option>
                  {EVENT_TYPES.map((ev) => (
                    <option key={ev} value={ev}>{ev}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">Task</label>
              <textarea
                value={formTask} onChange={(e) => setFormTask(e.target.value)}
                placeholder="What the agent should do when triggered..."
                rows={3}
                className="w-full px-3 py-2 text-sm border border-border-primary rounded-lg bg-bg-primary text-text-primary outline-none focus:border-block-teal resize-none"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={saveJob} className="px-4 py-2 text-xs font-medium text-white bg-block-teal rounded-lg hover:bg-teal-600">
                {editingId ? 'Update Job' : 'Create Job'}
              </button>
              <button onClick={() => { resetForm(); setShowForm(false) }} className="px-4 py-2 text-xs font-medium text-text-secondary bg-bg-primary border border-border-primary rounded-lg hover:bg-bg-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Jobs list */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="space-y-3 max-w-3xl">
          {jobs.map((job) => (
            <div
              key={job.id}
              className={`border rounded-xl overflow-hidden transition-colors ${
                job.enabled ? 'border-border-primary bg-bg-primary' : 'border-border-primary/50 bg-bg-secondary/50 opacity-60'
              }`}
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => toggleJob(job)}
                  className={`shrink-0 w-8 h-5 rounded-full transition-colors relative ${
                    job.enabled ? 'bg-block-teal' : 'bg-gray-300'
                  }`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                    job.enabled ? 'left-3.5' : 'left-0.5'
                  }`} />
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">{job.name}</span>
                    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                      job.type === 'cron'
                        ? 'bg-blue-50 text-blue-600'
                        : 'bg-purple-50 text-purple-600'
                    }`}>
                      {job.type === 'cron' ? '⏰ Cron' : '⚡ Event'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-text-tertiary font-mono">
                      {job.type === 'cron' ? job.schedule : job.eventTrigger}
                    </span>
                    {job.runCount > 0 && (
                      <span className="text-xs text-text-tertiary">{job.runCount} runs</span>
                    )}
                    {job.lastRun && (
                      <span className="text-xs text-text-tertiary">
                        Last: {new Date(job.lastRun).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-secondary mt-1 truncate">{job.task}</p>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => runNow(job)}
                    className="p-1.5 rounded-lg text-block-teal hover:bg-teal-50 transition-colors"
                    title="Run now"
                  >
                    <Play className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => editJob(job)}
                    className="p-1.5 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-bg-secondary transition-colors"
                    title="Edit"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deleteJob(job.id)}
                    className="p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {jobs.length === 0 && (
            <div className="text-center py-12 text-text-tertiary">
              <CalendarClock className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No scheduled jobs</p>
              <p className="text-xs mt-1">Create cron-based or event-driven automations</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
