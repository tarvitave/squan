import { useState } from 'react'
import { useStore } from '../../store/index.js'

export function AuthPage() {
  const setAuth = useStore((s) => s.setAuth)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const url = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
      const body: Record<string, string> = { email, password }
      if (mode === 'register' && apiKey) body.anthropicApiKey = apiKey

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Something went wrong'); return }
      setAuth(data.token, data.user)
    } catch {
      setError('Could not reach the server')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.root}>
      <div style={styles.card}>
        <div style={styles.logo}>squansq</div>
        <div style={styles.subtitle}>multi-agent orchestration</div>

        <div style={styles.tabs}>
          <button
            style={{ ...styles.tab, ...(mode === 'login' ? styles.tabActive : {}) }}
            onClick={() => { setMode('login'); setError('') }}
          >
            Sign in
          </button>
          <button
            style={{ ...styles.tab, ...(mode === 'register' ? styles.tabActive : {}) }}
            onClick={() => { setMode('register'); setError('') }}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>Email</label>
          <input
            style={styles.input}
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />

          <label style={styles.label}>Password</label>
          <input
            style={styles.input}
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {mode === 'register' && (
            <>
              <label style={styles.label}>
                Anthropic API Key
                <span style={styles.optional}> (required to run agents)</span>
              </label>
              <input
                style={styles.input}
                type="password"
                placeholder="sk-ant-api03-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p style={styles.hint}>
                Your key is stored in the database and used to power Claude Code agents.
                You can update it later from your profile.
              </p>
            </>
          )}

          {error && <div style={styles.error}>{error}</div>}

          <button style={styles.submit} type="submit" disabled={loading}>
            {loading ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div style={styles.footer}>
          <a href="/privacy.html" target="_blank" style={styles.footerLink}>Privacy</a>
          <span style={styles.sep}>·</span>
          <a href="/terms.html" target="_blank" style={styles.footerLink}>Terms</a>
        </div>
      </div>
    </div>
  )
}

const styles = {
  root: {
    width: '100%',
    height: '100%',
    background: '#0d0d0d',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: 360,
    background: '#111',
    border: '1px solid #2d2d2d',
    borderRadius: 6,
    padding: '32px 28px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 16,
  },
  logo: {
    fontSize: 22,
    fontFamily: 'monospace',
    color: '#4ec9b0',
    fontWeight: 'bold' as const,
    letterSpacing: '0.05em',
    textAlign: 'center' as const,
  },
  subtitle: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#555',
    textAlign: 'center' as const,
    marginTop: -10,
  },
  tabs: {
    display: 'flex',
    gap: 0,
    background: '#0d0d0d',
    borderRadius: 4,
    padding: 2,
  },
  tab: {
    flex: 1,
    background: 'none',
    border: 'none',
    color: '#555',
    padding: '6px 0',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'monospace',
    borderRadius: 3,
  },
  tabActive: {
    background: '#1a1a1a',
    color: '#d4d4d4',
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  label: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#888',
  },
  optional: {
    color: '#555',
  },
  input: {
    background: '#1a1a1a',
    border: '1px solid #333',
    color: '#d4d4d4',
    borderRadius: 3,
    padding: '8px 10px',
    fontSize: 13,
    fontFamily: 'monospace',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  hint: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#444',
    margin: 0,
    lineHeight: 1.5,
  },
  error: {
    background: '#1a0a0a',
    border: '1px solid #3a1a1a',
    color: '#f44747',
    borderRadius: 3,
    padding: '6px 10px',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  submit: {
    background: '#1a3a2a',
    border: '1px solid #4ec9b0',
    color: '#4ec9b0',
    borderRadius: 3,
    padding: '8px',
    cursor: 'pointer',
    fontSize: 13,
    fontFamily: 'monospace',
    marginTop: 4,
  },
  footer: {
    display: 'flex',
    justifyContent: 'center',
    gap: 4,
    alignItems: 'center',
  },
  footerLink: {
    color: '#444',
    fontSize: 10,
    fontFamily: 'monospace',
    textDecoration: 'none',
  },
  sep: {
    color: '#333',
    fontSize: 10,
  },
}
