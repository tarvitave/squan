import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../../store/index.js'
import { Button } from '../ui/button.js'
import { Input } from '../ui/input.js'
import { cn } from '../../lib/utils.js'
import { RefreshCw, Loader2 } from 'lucide-react'

export function AuthPage() {
  const setAuth = useStore((s) => s.setAuth)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [serverTs, setServerTs] = useState<string | null>(null)
  const [checkingServer, setCheckingServer] = useState(false)

  const checkServer = useCallback(async () => {
    setCheckingServer(true)
    try {
      const c = new AbortController()
      const t = setTimeout(() => c.abort(), 5000)
      const res = await fetch('/api/health', { signal: c.signal })
      clearTimeout(t)
      if (res.ok) { const d = await res.json(); setServerStatus('online'); setServerTs(d.ts ?? null) }
      else { setServerStatus('offline'); setServerTs(null) }
    } catch { setServerStatus('offline'); setServerTs(null) }
    finally { setCheckingServer(false) }
  }, [])

  useEffect(() => { checkServer(); const i = setInterval(checkServer, 15000); return () => clearInterval(i) }, [checkServer])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const url = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
      const body: Record<string, string> = { email, password }
      if (mode === 'register' && apiKey) body.anthropicApiKey = apiKey
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Something went wrong'); return }
      setAuth(data.token, data.user)
    } catch { setError('Could not reach the server') }
    finally { setLoading(false) }
  }

  return (
    <div className="flex items-center justify-center w-full h-full bg-bg-primary">
      <div className="w-full max-w-[420px] flex flex-col gap-8 px-6">

        {/* Brand */}
        <div className="text-center">
          <h1 className="text-[28px] font-semibold text-text-primary tracking-tight">Squan</h1>
          <p className="text-text-secondary mt-1.5">Multi-agent development</p>
        </div>

        {/* Server status */}
        <div className="flex items-center gap-3 justify-center">
          <div className={cn(
            'w-2 h-2 rounded-full',
            serverStatus === 'online' && 'bg-green-200',
            serverStatus === 'offline' && 'bg-red-200',
            serverStatus === 'checking' && 'bg-yellow-200 animate-pulse',
          )} />
          <span className="text-sm text-text-secondary">
            {serverStatus === 'checking' ? 'Checking…' : serverStatus === 'online' ? 'Server connected' : 'Server offline'}
          </span>
          <button
            className="text-text-tertiary hover:text-text-secondary transition-colors"
            onClick={checkServer}
            disabled={checkingServer}
          >
            <RefreshCw className={cn('w-3.5 h-3.5', checkingServer && 'animate-spin')} />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="flex border rounded-lg overflow-hidden">
          {(['login', 'register'] as const).map((m) => (
            <button key={m} className={cn(
              'flex-1 py-2.5 text-sm transition-colors',
              mode === m ? 'bg-bg-secondary text-text-primary font-medium' : 'text-text-tertiary hover:text-text-secondary bg-bg-primary'
            )} onClick={() => { setMode(m); setError('') }}>
              {m === 'login' ? 'Sign in' : 'Register'}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-sm text-text-secondary mb-1.5 block">Email</label>
            <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="text-sm text-text-secondary mb-1.5 block">Password</label>
            <Input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>

          {mode === 'register' && (
            <div>
              <label className="text-sm text-text-secondary mb-1.5 block">
                Anthropic API Key <span className="text-text-tertiary">(for agents)</span>
              </label>
              <Input type="password" placeholder="sk-ant-api03-..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              <p className="text-xs text-text-tertiary mt-1.5">Powers Claude Code agents. Update anytime in settings.</p>
            </div>
          )}

          {error && (
            <div className="text-text-danger text-sm bg-red-200/10 border border-border-danger rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          <Button type="submit" disabled={loading || serverStatus === 'offline'} className="h-10">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === 'login' ? 'Sign in' : 'Create account'}
          </Button>
        </form>

        <p className="text-center text-text-disabled text-xs">v{__APP_VERSION__}</p>
      </div>
    </div>
  )
}
