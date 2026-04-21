import { useState, useEffect } from 'react'
import { useStore } from '../../store/index.js'
import { apiFetch } from '../../lib/api.js'
import {
  BookOpen, Plus, Trash2, Play, Edit2, X, ChevronDown, ChevronRight,
  Loader2, CheckCircle, AlertCircle, FileText, Zap,
} from 'lucide-react'

interface Skill {
  id: string
  name: string
  description: string
  steps: SkillStep[]
  createdAt?: string
}

interface SkillStep {
  role?: string
  task: string
  dependsOn?: string[]
}

export function SkillsView() {
  const token = useStore((s) => s.token)
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [running, setRunning] = useState<string | null>(null)

  // Form state
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formSteps, setFormSteps] = useState<SkillStep[]>([{ task: '' }])

  const loadSkills = async () => {
    try {
      const res = await apiFetch('/api/skills')
      if (res.ok) setSkills(await res.json())
    } catch {}
    setLoading(false)
  }

  useEffect(() => { loadSkills() }, [])

  const createSkill = async () => {
    if (!formName.trim()) return
    try {
      const res = await apiFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName.trim(),
          description: formDesc.trim(),
          steps: formSteps.filter(s => s.task.trim()),
        }),
      })
      if (res.ok) {
        setFormName(''); setFormDesc(''); setFormSteps([{ task: '' }])
        setShowForm(false)
        loadSkills()
      }
    } catch {}
  }

  const deleteSkill = async (id: string) => {
    try {
      await apiFetch(`/api/skills/${id}`, { method: 'DELETE' })
      loadSkills()
    } catch {}
  }

  const runSkill = async (skill: Skill) => {
    setRunning(skill.id)
    try {
      // Dispatch agents for each step
      for (const step of skill.steps) {
        await apiFetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task: step.task,
            role: step.role || 'developer',
          }),
        })
      }
    } catch {}
    setRunning(null)
  }

  const addStep = () => setFormSteps([...formSteps, { task: '' }])
  const removeStep = (i: number) => setFormSteps(formSteps.filter((_, idx) => idx !== i))
  const updateStep = (i: number, patch: Partial<SkillStep>) => {
    const updated = [...formSteps]
    updated[i] = { ...updated[i], ...patch }
    setFormSteps(updated)
  }

  // Built-in skills
  const BUILTIN_SKILLS: Skill[] = [
    {
      id: 'builtin-test-fix-pr',
      name: 'Test → Fix → PR',
      description: 'Run tests, fix failures, create PR',
      steps: [
        { role: 'tester', task: 'Run the test suite and identify all failing tests' },
        { role: 'developer', task: 'Fix the failing tests identified in the previous step' },
        { role: 'developer', task: 'Create a pull request with the fixes' },
      ],
    },
    {
      id: 'builtin-review-refactor',
      name: 'Review → Refactor',
      description: 'Code review then refactor based on findings',
      steps: [
        { role: 'reviewer', task: 'Review the codebase for code smells, complexity, and improvement opportunities' },
        { role: 'developer', task: 'Refactor the code based on the review findings' },
      ],
    },
    {
      id: 'builtin-docs',
      name: 'Generate Docs',
      description: 'Generate comprehensive documentation',
      steps: [
        { role: 'developer', task: 'Analyze the codebase structure and generate comprehensive documentation including README, API docs, and architecture overview' },
      ],
    },
    {
      id: 'builtin-security',
      name: 'Security Audit',
      description: 'Scan for vulnerabilities and fix them',
      steps: [
        { role: 'security', task: 'Scan the codebase for security vulnerabilities, dependency issues, and common attack vectors' },
        { role: 'developer', task: 'Fix the security issues identified in the audit' },
      ],
    },
  ]

  const allSkills = [...BUILTIN_SKILLS, ...skills]

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
          <BookOpen className="w-5 h-5 text-block-teal" />
          <div>
            <h2 className="text-base font-semibold text-text-primary">Skills</h2>
            <p className="text-xs text-text-secondary">Multi-step workflows that chain agent tasks</p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-block-teal rounded-lg hover:bg-teal-600 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New Skill
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="px-6 py-4 border-b border-border-primary bg-bg-secondary shrink-0">
          <div className="space-y-3 max-w-2xl">
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">Name</label>
              <input
                value={formName} onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Deploy Pipeline"
                className="w-full px-3 py-2 text-sm border border-border-primary rounded-lg bg-bg-primary text-text-primary outline-none focus:border-block-teal"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">Description</label>
              <input
                value={formDesc} onChange={(e) => setFormDesc(e.target.value)}
                placeholder="What this skill does..."
                className="w-full px-3 py-2 text-sm border border-border-primary rounded-lg bg-bg-primary text-text-primary outline-none focus:border-block-teal"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">Steps</label>
              <div className="space-y-2">
                {formSteps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="shrink-0 w-6 h-8 flex items-center justify-center text-xs font-mono text-text-tertiary">{i + 1}</span>
                    <input
                      value={step.role || ''} onChange={(e) => updateStep(i, { role: e.target.value })}
                      placeholder="Role"
                      className="w-28 px-2 py-1.5 text-xs border border-border-primary rounded bg-bg-primary text-text-primary outline-none"
                    />
                    <input
                      value={step.task} onChange={(e) => updateStep(i, { task: e.target.value })}
                      placeholder="Task description..."
                      className="flex-1 px-2 py-1.5 text-xs border border-border-primary rounded bg-bg-primary text-text-primary outline-none"
                    />
                    {formSteps.length > 1 && (
                      <button onClick={() => removeStep(i)} className="shrink-0 p-1 text-text-tertiary hover:text-red-500">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                <button onClick={addStep} className="text-xs text-block-teal hover:text-teal-600 flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Add step
                </button>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={createSkill} className="px-4 py-2 text-xs font-medium text-white bg-block-teal rounded-lg hover:bg-teal-600">
                Create Skill
              </button>
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-xs font-medium text-text-secondary bg-bg-primary border border-border-primary rounded-lg hover:bg-bg-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Skills list */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="space-y-3 max-w-3xl">
          {allSkills.map((skill) => {
            const isBuiltin = skill.id.startsWith('builtin-')
            const isExpanded = expanded === skill.id
            const isRunning = running === skill.id

            return (
              <div
                key={skill.id}
                className="border border-border-primary rounded-xl bg-bg-primary overflow-hidden"
              >
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-bg-secondary/50 transition-colors"
                  onClick={() => setExpanded(isExpanded ? null : skill.id)}
                >
                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 text-text-tertiary shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-text-tertiary shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">{skill.name}</span>
                      {isBuiltin && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-teal-50 text-teal-600 rounded">Built-in</span>
                      )}
                    </div>
                    <p className="text-xs text-text-secondary mt-0.5">{skill.description}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs text-text-tertiary mr-2">{skill.steps.length} step{skill.steps.length !== 1 ? 's' : ''}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); runSkill(skill) }}
                      disabled={isRunning}
                      className="p-1.5 rounded-lg text-block-teal hover:bg-teal-50 transition-colors disabled:opacity-50"
                      title="Run skill"
                    >
                      {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    </button>
                    {!isBuiltin && (
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteSkill(skill.id) }}
                        className="p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 border-t border-border-primary">
                    <div className="space-y-2">
                      {skill.steps.map((step, i) => (
                        <div key={i} className="flex items-start gap-3 pl-2">
                          <div className="flex flex-col items-center shrink-0">
                            <div className="w-6 h-6 rounded-full bg-teal-50 text-teal-600 flex items-center justify-center text-xs font-medium">
                              {i + 1}
                            </div>
                            {i < skill.steps.length - 1 && <div className="w-px h-4 bg-border-primary mt-1" />}
                          </div>
                          <div className="pt-0.5">
                            {step.role && (
                              <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-wider">{step.role}</span>
                            )}
                            <p className="text-xs text-text-primary">{step.task}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {allSkills.length === 0 && (
            <div className="text-center py-12 text-text-tertiary">
              <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No skills yet</p>
              <p className="text-xs mt-1">Create a multi-step workflow to automate agent tasks</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
