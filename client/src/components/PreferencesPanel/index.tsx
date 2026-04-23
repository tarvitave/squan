import { useState, useEffect } from 'react'
import { useStore } from '../../store/index.js'
import { apiFetch } from '../../lib/api.js'
import { useWorkspaceInfo, invalidateWorkspaceInfo } from '../../lib/workspace.js'
import { Button } from '../ui/button.js'
import { Input } from '../ui/input.js'
import { X, Minus, Plus, Check, LogOut, Eye, EyeOff, Trash2, Puzzle, Cpu, Zap } from 'lucide-react'
import { cn } from '../../lib/utils.js'

const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-3-20250514'], keyPlaceholder: 'sk-ant-api03-...' },
  { id: 'openai', name: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'gpt-4-turbo'], keyPlaceholder: 'sk-...' },
  { id: 'google', name: 'Google Gemini', models: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash'], keyPlaceholder: 'AIza...' },
  { id: 'ollama', name: 'Ollama (local)', models: ['llama3', 'codellama', 'mistral', 'deepseek-coder'], keyPlaceholder: '(no key needed)' },
  { id: 'openai-compatible', name: 'OpenAI Compatible', models: [], keyPlaceholder: 'API key...' },
]

interface ExtensionConfig {
  id: string; name: string; type: string; command?: string; args?: string[];
  url?: string; env?: Record<string, string>; enabled: boolean; projectId?: string
}

export function PreferencesPanel() {
  const ui = useStore((s) => s.ui)
  const user = useStore((s) => s.user)
  const token = useStore((s) => s.token)
  const setAuth = useStore((s) => s.setAuth)
  const clearAuth = useStore((s) => s.clearAuth)
  const setFontSize = useStore((s) => s.setFontSize)
  const close = () => useStore.getState().setShowPreferences(false)

  const workspaceInfo = useWorkspaceInfo()
  const [workspacePath, setWorkspacePath] = useState('')
  const [savingWorkspace, setSavingWorkspace] = useState(false)
  const [savedWorkspace, setSavedWorkspace] = useState(false)
  useEffect(() => { if (workspaceInfo) setWorkspacePath(workspaceInfo.root) }, [workspaceInfo])

  const saveWorkspacePath = async () => {
    if (!workspaceInfo || !workspacePath.trim()) return
    setSavingWorkspace(true)
    try {
      await apiFetch(`/api/towns/${workspaceInfo.townId}`, { method: 'PATCH', body: JSON.stringify({ path: workspacePath.trim() }) })
      invalidateWorkspaceInfo()
      setSavedWorkspace(true); setTimeout(() => setSavedWorkspace(false), 2000)
    } catch {}
    setSavingWorkspace(false)
  }

  const [apiKey, setApiKey] = useState(''); const [saving, setSaving] = useState(false); const [saved, setSaved] = useState(false)
  const [ghToken, setGhToken] = useState(''); const [savingGh, setSavingGh] = useState(false); const [savedGh, setSavedGh] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false); const [showGhToken, setShowGhToken] = useState(false)

  // Claude OAuth — loopback flow (browser redirects back to our own server)
  const [oauthStep, setOauthStep] = useState<'idle' | 'waiting'>('idle')
  const [oauthUrl, setOauthUrl] = useState('')
  const [oauthState, setOauthState] = useState('')
  const [oauthBusy, setOauthBusy] = useState(false)
  const [oauthError, setOauthError] = useState<string | null>(null)

  useEffect(() => {
    if (oauthStep !== 'waiting' || !oauthState) return
    const tick = async () => {
      try {
        const res = await apiFetch(`/api/auth/claude-oauth/status?state=${encodeURIComponent(oauthState)}`)
        const data = await res.json()
        if (data.status === 'complete') {
          if (token && data.user) setAuth(token, data.user)
          setOauthStep('idle'); setOauthUrl(''); setOauthState(''); setOauthError(null)
        } else if (data.status === 'error') {
          setOauthError(data.error ?? 'OAuth failed')
          setOauthStep('idle'); setOauthUrl(''); setOauthState('')
        }
      } catch {}
    }
    const iv = setInterval(tick, 1500)
    return () => clearInterval(iv)
  }, [oauthStep, oauthState, token, setAuth])

  const startClaudeOAuth = async () => {
    setOauthBusy(true); setOauthError(null)
    try {
      const res = await apiFetch('/api/auth/claude-oauth/start', { method: 'POST', body: '{}' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to start OAuth')
      setOauthUrl(data.url); setOauthState(data.state); setOauthStep('waiting')
      window.open(data.url, '_blank', 'noreferrer')
    } catch (e) { setOauthError((e as Error).message) }
    setOauthBusy(false)
  }

  const cancelClaudeOAuth = async () => {
    try { await apiFetch('/api/auth/claude-oauth/cancel', { method: 'POST', body: '{}' }) } catch {}
    setOauthStep('idle'); setOauthUrl(''); setOauthState(''); setOauthError(null)
  }

  const clearKey = async (type: 'api' | 'gh') => {
    const url = type === 'api' ? '/api/auth/api-key' : '/api/auth/github-token'
    try {
      const res = await apiFetch(url, { method: 'DELETE' })
      const data = await res.json()
      if (token && data.user) setAuth(token, data.user)
    } catch {}
  }

  const disconnectClaudeOAuth = async () => {
    setOauthBusy(true)
    try {
      await apiFetch('/api/auth/claude-oauth', { method: 'DELETE' })
      const me = await apiFetch('/api/auth/me').then(r => r.json())
      if (token && me?.id) setAuth(token, me)
    } catch {}
    setOauthBusy(false)
  }

  // Provider config
  const [providerConfig, setProviderConfig] = useState<{provider: string; model: string | null; providerUrl: string | null}>({ provider: 'anthropic', model: null, providerUrl: null })
  const [providerKey, setProviderKey] = useState(''); const [savingProvider, setSavingProvider] = useState(false); const [savedProvider, setSavedProvider] = useState(false)
  const [showProviderKey, setShowProviderKey] = useState(false)
  const [customModel, setCustomModel] = useState('')

  // Extensions
  const [extensions, setExtensions] = useState<ExtensionConfig[]>([])
  const [showExtForm, setShowExtForm] = useState(false)
  const [extForm, setExtForm] = useState({ name: '', type: 'stdio', command: '', url: '' })

  // Tab state
  const [tab, setTab] = useState<'general' | 'provider' | 'extensions'>('general')

  // Load data when panel opens
  useEffect(() => {
    if (!ui.showPreferences) return
    apiFetch('/api/user/provider').then(r => r.json()).then(d => {
      setProviderConfig({ provider: d.provider || 'anthropic', model: d.model, providerUrl: d.providerUrl })
    }).catch(() => {})
    apiFetch('/api/extensions').then(r => r.json()).then(setExtensions).catch(() => {})
  }, [ui.showPreferences])

  if (!ui.showPreferences) return null

  const saveKey = async (type: 'api' | 'gh') => {
    const val = type === 'api' ? apiKey : ghToken; if (!val.trim()) return
    type === 'api' ? setSaving(true) : setSavingGh(true)
    try {
      const url = type === 'api' ? '/api/auth/api-key' : '/api/auth/github-token'
      const body = type === 'api' ? { anthropicApiKey: val } : { githubToken: val }
      const res = await apiFetch(url, { method: 'PUT', body: JSON.stringify(body) })
      const data = await res.json()
      if (token && data.user) setAuth(token, data.user)
      type === 'api' ? (setSaved(true), setApiKey(''), setTimeout(() => setSaved(false), 2000)) : (setSavedGh(true), setGhToken(''), setTimeout(() => setSavedGh(false), 2000))
    } catch {}
    type === 'api' ? setSaving(false) : setSavingGh(false)
  }

  const saveProvider = async () => {
    setSavingProvider(true)
    try {
      const body: any = {
        provider: providerConfig.provider,
        model: customModel || providerConfig.model,
        providerUrl: providerConfig.providerUrl,
      }
      if (providerKey.trim()) {
        if (providerConfig.provider === 'openai' || providerConfig.provider === 'openai-compatible') body.openaiApiKey = providerKey
        else if (providerConfig.provider === 'google') body.googleApiKey = providerKey
      }
      await apiFetch('/api/user/provider', { method: 'PUT', body: JSON.stringify(body) })
      setSavedProvider(true); setProviderKey(''); setTimeout(() => setSavedProvider(false), 2000)
    } catch {}
    setSavingProvider(false)
  }

  const addExtension = async () => {
    if (!extForm.name.trim()) return
    try {
      const res = await apiFetch('/api/extensions', {
        method: 'POST',
        body: JSON.stringify({
          name: extForm.name, type: extForm.type,
          command: extForm.type === 'stdio' ? extForm.command : undefined,
          url: extForm.type === 'http' ? extForm.url : undefined,
        }),
      })
      const ext = await res.json()
      setExtensions(prev => [...prev, ext])
      setExtForm({ name: '', type: 'stdio', command: '', url: '' })
      setShowExtForm(false)
    } catch {}
  }

  const deleteExtension = async (id: string) => {
    await apiFetch(`/api/extensions/${id}`, { method: 'DELETE' })
    setExtensions(prev => prev.filter(e => e.id !== id))
  }

  const currentProvider = PROVIDERS.find(p => p.id === providerConfig.provider) || PROVIDERS[0]

  return (
    <div className="fixed inset-0 bg-black/10 backdrop-blur-[2px] flex items-center justify-center z-[10000]" onClick={close}>
      <div className="w-[560px] max-h-[85vh] bg-bg-primary border border-border-primary rounded-xl overflow-hidden flex flex-col shadow-default" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-primary">
          <h2 className="text-[15px] font-semibold text-text-primary">Settings</h2>
          <button onClick={close} className="text-text-tertiary hover:text-text-primary transition-colors"><X className="w-4 h-4" /></button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 py-2 border-b border-border-primary">
          {[
            { id: 'general' as const, label: 'General', icon: Zap },
            { id: 'provider' as const, label: 'AI Provider', icon: Cpu },
            { id: 'extensions' as const, label: 'Extensions', icon: Puzzle },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              tab === t.id ? 'bg-bg-secondary text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
            )}>
              <t.icon className="w-3.5 h-3.5" />{t.label}
            </button>
          ))}
        </div>

        <div className="overflow-auto flex-1">
          {/* ── General Tab ─────────────────────────────── */}
          {tab === 'general' && (
            <div className="divide-y divide-border-primary">
              {/* Appearance */}
              <div className="px-6 py-5">
                <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-4">Appearance</h3>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-primary">Font size</span>
                  <div className="flex items-center gap-3">
                    <Button variant="outline" size="iconXs" onClick={() => setFontSize(ui.fontSize - 1)} disabled={ui.fontSize <= 10}><Minus className="w-3 h-3" /></Button>
                    <span className="text-sm font-medium text-text-primary w-8 text-center">{ui.fontSize}</span>
                    <Button variant="outline" size="iconXs" onClick={() => setFontSize(ui.fontSize + 1)} disabled={ui.fontSize >= 16}><Plus className="w-3 h-3" /></Button>
                  </div>
                </div>
              </div>

              {/* Workspace path */}
              <div className="px-6 py-5">
                <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">Workspace Path</h3>
                <p className="text-xs text-text-secondary mb-3">
                  Root directory where Squan clones new repositories. Each project lands in a subdirectory named after the repo.
                </p>
                <div className="flex gap-2">
                  <Input
                    value={workspacePath}
                    onChange={e => setWorkspacePath(e.target.value)}
                    placeholder="~/squan-workspace"
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={saveWorkspacePath}
                    disabled={savingWorkspace || !workspacePath.trim() || workspacePath.trim() === workspaceInfo?.root}
                  >
                    {savingWorkspace ? '…' : savedWorkspace ? <Check className="w-4 h-4 text-green-200" /> : 'Save'}
                  </Button>
                </div>
              </div>

              {/* Claude OAuth (subscription) */}
              <div className="px-6 py-5">
                <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">Claude Account</h3>
                <p className="text-xs text-text-secondary mb-3">
                  Sign in with your Claude account to use your Pro/Max subscription for agent inference — no API credits needed.
                </p>
                {user?.claudeOAuth?.connected ? (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm text-text-primary">
                      <Check className="w-4 h-4 text-green-200" />
                      <span>Connected{user.claudeOAuth.expiresAt ? ` — expires ${new Date(user.claudeOAuth.expiresAt).toLocaleString()}` : ''}</span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={disconnectClaudeOAuth} disabled={oauthBusy}>Disconnect</Button>
                  </div>
                ) : oauthStep === 'idle' ? (
                  <Button variant="secondary" size="sm" onClick={startClaudeOAuth} disabled={oauthBusy}>
                    {oauthBusy ? 'Opening…' : 'Sign in with Claude'}
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-text-secondary">
                      Waiting for you to approve access in your browser…
                      {oauthUrl && <> (Didn't open? <a href={oauthUrl} target="_blank" rel="noreferrer" className="underline">click here</a>.)</>}
                    </p>
                    <Button variant="ghost" size="sm" onClick={cancelClaudeOAuth}>Cancel</Button>
                  </div>
                )}
                {oauthError && <p className="text-xs text-text-danger mt-2">{oauthError}</p>}
              </div>

              {/* Anthropic key */}
              <div className="px-6 py-5">
                <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">Anthropic API Key</h3>
                <p className="text-xs text-text-secondary mb-3">Pay-as-you-go agent inference billed to your Anthropic account.</p>
                {user?.anthropicApiKey ? (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm text-text-primary">
                      <Check className="w-4 h-4 text-green-200" />
                      <span>Connected <span className="font-mono text-text-secondary">&mdash; ••••{user.anthropicApiKey.slice(-4)}</span></span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => clearKey('api')}>Disconnect</Button>
                  </div>
                ) : (
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input type={showApiKey ? 'text' : 'password'} placeholder="sk-ant-api03-..." value={apiKey} onChange={e => setApiKey(e.target.value)} className="pr-9" />
                    <button className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary" onClick={() => setShowApiKey(!showApiKey)}>
                      {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => saveKey('api')} disabled={saving || !apiKey.trim()}>
                    {saving ? '\u2026' : saved ? <Check className="w-4 h-4 text-green-200" /> : 'Save'}
                  </Button>
                </div>
                )}
              </div>

              {/* GitHub */}
              <div className="px-6 py-5">
                <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">GitHub Token</h3>
                <p className="text-xs text-text-secondary mb-3">Personal access token used for cloning repos and opening PRs on your behalf.</p>
                {user?.githubToken ? (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm text-text-primary">
                      <Check className="w-4 h-4 text-green-200" />
                      <span>Connected <span className="font-mono text-text-secondary">&mdash; ••••{user.githubToken.slice(-4)}</span></span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => clearKey('gh')}>Disconnect</Button>
                  </div>
                ) : (
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input type={showGhToken ? 'text' : 'password'} placeholder="ghp_..." value={ghToken} onChange={e => setGhToken(e.target.value)} className="pr-9" />
                    <button className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary" onClick={() => setShowGhToken(!showGhToken)}>
                      {showGhToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => saveKey('gh')} disabled={savingGh || !ghToken.trim()}>
                    {savingGh ? '\u2026' : savedGh ? <Check className="w-4 h-4 text-green-200" /> : 'Save'}
                  </Button>
                </div>
                )}
              </div>

              {/* Account */}
              <div className="px-6 py-5">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm text-text-secondary">Signed in as</span>
                  <span className="text-sm font-medium text-text-primary">{user?.email ?? '\u2014'}</span>
                </div>
                <Button variant="ghost" size="sm" className="w-full text-text-danger hover:bg-red-200/10" onClick={clearAuth}>
                  <LogOut className="w-4 h-4" /> Sign out
                </Button>
              </div>
            </div>
          )}

          {/* ── Provider Tab ────────────────────────────── */}
          {tab === 'provider' && (
            <div className="px-6 py-5 space-y-5">
              <div>
                <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-3">AI Provider</h3>
                <p className="text-xs text-text-secondary mb-3">Choose which AI model powers your agents. All providers support tool use.</p>
                <div className="grid grid-cols-2 gap-2">
                  {PROVIDERS.map(p => (
                    <button key={p.id} onClick={() => setProviderConfig(prev => ({ ...prev, provider: p.id }))}
                      className={cn('flex items-center gap-2 p-3 rounded-lg border text-left transition-all text-sm',
                        providerConfig.provider === p.id
                          ? 'border-block-teal bg-block-teal/5 text-text-primary'
                          : 'border-border-primary text-text-secondary hover:border-border-secondary')}>
                      <Cpu className="w-4 h-4 shrink-0" />
                      <span className="font-medium">{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Model selection */}
              <div>
                <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-3">Model</h3>
                {currentProvider.models.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {currentProvider.models.map(m => (
                      <button key={m} onClick={() => { setProviderConfig(prev => ({ ...prev, model: m })); setCustomModel('') }}
                        className={cn('px-2.5 py-1 rounded-md text-xs border transition-colors',
                          (providerConfig.model === m || (!providerConfig.model && m === currentProvider.models[0]))
                            ? 'border-block-teal bg-block-teal/10 text-block-teal' : 'border-border-primary text-text-secondary hover:text-text-primary')}>
                        {m}
                      </button>
                    ))}
                  </div>
                ) : null}
                <Input placeholder="Custom model name..." value={customModel} onChange={e => setCustomModel(e.target.value)} className="text-sm" />
              </div>

              {/* API key for non-Anthropic providers */}
              {providerConfig.provider !== 'anthropic' && providerConfig.provider !== 'ollama' && (
                <div>
                  <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-3">{currentProvider.name} API Key</h3>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input type={showProviderKey ? 'text' : 'password'} placeholder={currentProvider.keyPlaceholder} value={providerKey} onChange={e => setProviderKey(e.target.value)} className="pr-9" />
                      <button className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary" onClick={() => setShowProviderKey(!showProviderKey)}>
                        {showProviderKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Custom URL for Ollama / OpenAI-compatible */}
              {(providerConfig.provider === 'ollama' || providerConfig.provider === 'openai-compatible') && (
                <div>
                  <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-3">API Base URL</h3>
                  <Input placeholder={providerConfig.provider === 'ollama' ? 'http://localhost:11434/v1' : 'https://api.example.com/v1'}
                    value={providerConfig.providerUrl ?? ''} onChange={e => setProviderConfig(prev => ({ ...prev, providerUrl: e.target.value }))} className="text-sm" />
                </div>
              )}

              <Button variant="secondary" size="sm" onClick={saveProvider} disabled={savingProvider} className="w-full">
                {savingProvider ? 'Saving...' : savedProvider ? <><Check className="w-4 h-4 text-green-200" /> Saved</> : 'Save Provider Settings'}
              </Button>
            </div>
          )}

          {/* ── Extensions Tab ──────────────────────────── */}
          {tab === 'extensions' && (
            <div className="px-6 py-5 space-y-4">
              <div>
                <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">MCP Extensions</h3>
                <p className="text-xs text-text-secondary mb-4">
                  Connect MCP tool servers to give your agents access to databases, APIs, Slack, Jira, and more.
                  Extensions are available to all agents when dispatched.
                </p>
              </div>

              {/* Extension list */}
              {extensions.length === 0 && !showExtForm && (
                <div className="text-center py-6 text-text-tertiary">
                  <Puzzle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No extensions configured</p>
                  <p className="text-xs mt-1">Add an MCP server to unlock more tools for your agents</p>
                </div>
              )}

              {extensions.map(ext => (
                <div key={ext.id} className="flex items-center gap-3 p-3 rounded-lg border border-border-primary">
                  <Puzzle className="w-4 h-4 text-block-teal shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary">{ext.name}</div>
                    <div className="text-xs text-text-tertiary font-mono truncate">
                      {ext.type === 'stdio' ? ext.command : ext.url}
                    </div>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-secondary text-text-tertiary">{ext.type}</span>
                  <button onClick={() => deleteExtension(ext.id)} className="text-text-tertiary hover:text-text-danger transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}

              {/* Add form */}
              {showExtForm ? (
                <div className="border border-dashed border-border-primary rounded-lg p-4 space-y-3">
                  <Input placeholder="Extension name (e.g. postgres, slack)" value={extForm.name} onChange={e => setExtForm(f => ({ ...f, name: e.target.value }))} autoFocus />
                  <div className="flex gap-2">
                    <button onClick={() => setExtForm(f => ({ ...f, type: 'stdio' }))}
                      className={cn('flex-1 px-3 py-1.5 rounded-md text-xs border transition-colors', extForm.type === 'stdio' ? 'border-block-teal text-block-teal bg-block-teal/5' : 'border-border-primary text-text-tertiary')}>
                      stdio (command)
                    </button>
                    <button onClick={() => setExtForm(f => ({ ...f, type: 'http' }))}
                      className={cn('flex-1 px-3 py-1.5 rounded-md text-xs border transition-colors', extForm.type === 'http' ? 'border-block-teal text-block-teal bg-block-teal/5' : 'border-border-primary text-text-tertiary')}>
                      HTTP (URL)
                    </button>
                  </div>
                  {extForm.type === 'stdio' && (
                    <Input placeholder="npx @modelcontextprotocol/server-postgres" value={extForm.command} onChange={e => setExtForm(f => ({ ...f, command: e.target.value }))} />
                  )}
                  {extForm.type === 'http' && (
                    <Input placeholder="http://localhost:3002/mcp" value={extForm.url} onChange={e => setExtForm(f => ({ ...f, url: e.target.value }))} />
                  )}
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={addExtension} disabled={!extForm.name.trim()}>Add Extension</Button>
                    <Button variant="ghost" size="sm" onClick={() => setShowExtForm(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowExtForm(true)}
                  className="w-full border border-dashed border-border-primary rounded-lg px-4 py-3 text-sm text-text-tertiary hover:text-text-secondary hover:border-border-secondary transition-colors flex items-center justify-center gap-2">
                  <Plus className="w-4 h-4" /> Add MCP Extension
                </button>
              )}

              {/* Examples */}
              <div className="bg-bg-secondary rounded-lg p-3 text-xs text-text-tertiary space-y-1.5">
                <div className="font-medium text-text-secondary">Popular MCP servers:</div>
                <div className="font-mono">npx @modelcontextprotocol/server-postgres</div>
                <div className="font-mono">npx @modelcontextprotocol/server-filesystem</div>
                <div className="font-mono">npx @modelcontextprotocol/server-github</div>
                <div className="font-mono">npx @modelcontextprotocol/server-slack</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
