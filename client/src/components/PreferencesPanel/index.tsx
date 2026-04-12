import { useState, useEffect } from 'react'
import { useStore } from '../../store/index.js'
import { apiFetch } from '../../lib/api.js'
import { Button } from '../ui/button.js'
import { Input } from '../ui/input.js'
import { X, Minus, Plus, Check, LogOut, Eye, EyeOff, Terminal, RefreshCw, Shield } from 'lucide-react'
import { cn } from '../../lib/utils.js'

interface BackendInfo {
  name: string
  label: string
  description: string
  available: boolean
}

interface BackendSettings {
  active: 'pty' | 'tmux'
  tmuxAvailable: boolean
  backends: BackendInfo[]
}

export function PreferencesPanel() {
  const ui = useStore((s) => s.ui)
  const user = useStore((s) => s.user)
  const token = useStore((s) => s.token)
  const setAuth = useStore((s) => s.setAuth)
  const clearAuth = useStore((s) => s.clearAuth)
  const setFontSize = useStore((s) => s.setFontSize)
  const close = () => useStore.getState().setShowPreferences(false)

  const [apiKey, setApiKey] = useState(''); const [saving, setSaving] = useState(false); const [saved, setSaved] = useState(false)
  const [ghToken, setGhToken] = useState(''); const [savingGh, setSavingGh] = useState(false); const [savedGh, setSavedGh] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false); const [showGhToken, setShowGhToken] = useState(false)

  // Terminal backend state
  const [backendSettings, setBackendSettings] = useState<BackendSettings | null>(null)
  const [switchingBackend, setSwitchingBackend] = useState(false)

  // Load backend settings when panel opens
  useEffect(() => {
    if (ui.showPreferences) {
      apiFetch('/api/settings/terminal-backend')
        .then((r) => r.json())
        .then(setBackendSettings)
        .catch(() => {})
    }
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

  const switchBackend = async (name: 'pty' | 'tmux') => {
    setSwitchingBackend(true)
    try {
      const res = await apiFetch('/api/settings/terminal-backend', {
        method: 'PUT',
        body: JSON.stringify({ backend: name }),
      })
      const data = await res.json()
      if (data.active) {
        setBackendSettings((prev) => prev ? { ...prev, active: data.active } : null)
      }
    } catch {}
    setSwitchingBackend(false)
  }

  return (
    <div className="fixed inset-0 bg-black/10 backdrop-blur-[2px] flex items-center justify-center z-[10000]" onClick={close}>
      <div className="w-[480px] max-h-[80vh] bg-bg-primary border border-border-primary rounded-xl overflow-hidden flex flex-col shadow-default" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-primary">
          <h2 className="text-[15px] font-semibold text-text-primary">Settings</h2>
          <button onClick={close} className="text-text-tertiary hover:text-text-primary transition-colors"><X className="w-4 h-4" /></button>
        </div>

        <div className="overflow-auto divide-y divide-border-primary">
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

          {/* Terminal Backend */}
          <div className="px-6 py-5">
            <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-4">Terminal Backend</h3>
            {backendSettings ? (
              <div className="flex flex-col gap-3">
                {backendSettings.backends.map((b) => {
                  const isActive = backendSettings.active === b.name
                  const isTmux = b.name === 'tmux'
                  return (
                    <button
                      key={b.name}
                      className={cn(
                        'flex items-start gap-3 w-full text-left p-3 rounded-lg border transition-all',
                        isActive
                          ? 'border-block-teal bg-block-teal/5'
                          : b.available
                            ? 'border-border-primary hover:border-border-secondary bg-bg-primary'
                            : 'border-border-primary bg-bg-secondary opacity-50 cursor-not-allowed',
                      )}
                      onClick={() => b.available && !isActive && switchBackend(b.name as 'pty' | 'tmux')}
                      disabled={!b.available || isActive || switchingBackend}
                    >
                      <div className={cn(
                        'mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0',
                        isActive ? 'border-block-teal' : 'border-border-secondary',
                      )}>
                        {isActive && <div className="w-2 h-2 rounded-full bg-block-teal" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Terminal className="w-3.5 h-3.5 text-text-secondary" />
                          <span className="text-sm font-medium text-text-primary">{b.label}</span>
                          {isActive && <span className="text-[10px] font-medium text-block-teal bg-block-teal/10 rounded px-1.5 py-0.5">Active</span>}
                          {isTmux && b.available && (
                            <span className="text-[10px] font-medium text-text-info bg-blue-200/10 rounded px-1.5 py-0.5 flex items-center gap-0.5">
                              <Shield className="w-2.5 h-2.5" /> Crash-resilient
                            </span>
                          )}
                          {isTmux && !b.available && (
                            <span className="text-[10px] text-text-tertiary">Not available</span>
                          )}
                        </div>
                        <p className="text-xs text-text-secondary mt-1 leading-relaxed">{b.description}</p>
                      </div>
                    </button>
                  )
                })}
                {switchingBackend && (
                  <div className="flex items-center gap-2 text-xs text-text-secondary">
                    <RefreshCw className="w-3 h-3 animate-spin" /> Switching backend…
                  </div>
                )}
                <p className="text-[11px] text-text-tertiary leading-relaxed">
                  New agents will use the selected backend. Existing agents continue on their current backend until they finish or are killed.
                </p>
              </div>
            ) : (
              <div className="text-sm text-text-tertiary">Loading…</div>
            )}
          </div>

          {/* Anthropic key */}
          <div className="px-6 py-5">
            <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-4">Anthropic</h3>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-text-secondary">API Key</span>
              <span className="text-sm text-text-primary font-mono">{user?.anthropicApiKey ? '••••' + user.anthropicApiKey.slice(-4) : 'Not set'}</span>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input type={showApiKey ? 'text' : 'password'} placeholder="sk-ant-api03-..." value={apiKey} onChange={e => setApiKey(e.target.value)} className="pr-9" />
                <button className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary" onClick={() => setShowApiKey(!showApiKey)}>
                  {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <Button variant="secondary" size="sm" onClick={() => saveKey('api')} disabled={saving || !apiKey.trim()}>
                {saving ? '…' : saved ? <Check className="w-4 h-4 text-green-200" /> : 'Save'}
              </Button>
            </div>
          </div>

          {/* GitHub */}
          <div className="px-6 py-5">
            <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-4">GitHub</h3>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-text-secondary">Token</span>
              <span className="text-sm text-text-primary font-mono">{user?.githubToken ? '••••' + user.githubToken.slice(-4) : 'Not set'}</span>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input type={showGhToken ? 'text' : 'password'} placeholder="ghp_..." value={ghToken} onChange={e => setGhToken(e.target.value)} className="pr-9" />
                <button className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary" onClick={() => setShowGhToken(!showGhToken)}>
                  {showGhToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <Button variant="secondary" size="sm" onClick={() => saveKey('gh')} disabled={savingGh || !ghToken.trim()}>
                {savingGh ? '…' : savedGh ? <Check className="w-4 h-4 text-green-200" /> : 'Save'}
              </Button>
            </div>
          </div>

          {/* Account */}
          <div className="px-6 py-5">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-text-secondary">Signed in as</span>
              <span className="text-sm font-medium text-text-primary">{user?.email ?? '—'}</span>
            </div>
            <Button variant="ghost" size="sm" className="w-full text-text-danger hover:bg-red-200/10" onClick={clearAuth}>
              <LogOut className="w-4 h-4" /> Sign out
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
