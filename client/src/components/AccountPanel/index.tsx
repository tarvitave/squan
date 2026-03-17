import { useState } from 'react'
import { useStore } from '../../store/index.js'
import { apiFetch } from '../../lib/api.js'

export function AccountPanel() {
  const user = useStore((s) => s.user)
  const setAuth = useStore((s) => s.setAuth)
  const token = useStore((s) => s.token)
  const clearAuth = useStore((s) => s.clearAuth)
  const [open, setOpen] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [ghToken, setGhToken] = useState('')
  const [savingGh, setSavingGh] = useState(false)
  const [savedGh, setSavedGh] = useState(false)

  const save = async () => {
    if (!apiKey.trim()) return
    setSaving(true)
    try {
      await apiFetch('/api/auth/api-key', {
        method: 'PUT',
        body: JSON.stringify({ anthropicApiKey: apiKey.trim() }),
      })
      if (user && token) setAuth(token, { ...user, anthropicApiKey: apiKey.trim() })
      setApiKey('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const saveGithubToken = async () => {
    if (!ghToken.trim()) return
    setSavingGh(true)
    try {
      await apiFetch('/api/auth/github-token', {
        method: 'PUT',
        body: JSON.stringify({ githubToken: ghToken.trim() }),
      })
      if (user && token) setAuth(token, { ...user, githubToken: ghToken.trim() })
      setGhToken('')
      setSavedGh(true)
      setTimeout(() => setSavedGh(false), 2000)
    } finally {
      setSavingGh(false)
    }
  }

  return (
    <div style={styles.root}>
      <div style={styles.bar}>
        <span style={styles.appName}>squansq</span>
        <div style={styles.right}>
          <button
            style={{ ...styles.btn, ...(open ? styles.btnActive : {}) }}
            onClick={() => setOpen((v) => !v)}
            title={user?.email}
          >
            ⚙
          </button>
          <button style={styles.btn} onClick={clearAuth}>
            logout
          </button>
        </div>
      </div>

      {open && (
        <div style={styles.panel}>
          <div style={styles.email}>{user?.email}</div>
          <div style={styles.keyStatus}>
            Anthropic key: {user?.anthropicApiKey ? (
              <span style={styles.keySet}>✓ set</span>
            ) : (
              <span style={styles.keyMissing}>not set — agents will prompt for login</span>
            )}
          </div>
          <div style={styles.row}>
            <input
              style={styles.input}
              type="password"
              placeholder="sk-ant-api03-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
            <button style={styles.saveBtn} onClick={save} disabled={saving || !apiKey.trim()}>
              {saved ? '✓' : saving ? '…' : 'Save'}
            </button>
          </div>
          <div style={styles.keyStatus}>
            GitHub token: {user?.githubToken ? (
              <span style={styles.keySet}>✓ set</span>
            ) : (
              <span style={styles.keyMissing}>not set — needed for PR creation</span>
            )}
          </div>
          <div style={styles.row}>
            <input
              style={styles.input}
              type="password"
              placeholder="github_pat_..."
              value={ghToken}
              onChange={(e) => setGhToken(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveGithubToken()}
            />
            <button style={styles.saveBtn} onClick={saveGithubToken} disabled={savingGh || !ghToken.trim()}>
              {savedGh ? '✓' : savingGh ? '…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  root: {
    borderBottom: '1px solid #2d2d2d',
    flexShrink: 0,
  } as React.CSSProperties,
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 8px',
    background: '#0a0a0a',
  } as React.CSSProperties,
  appName: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#4ec9b0',
    fontWeight: 'bold',
    letterSpacing: '0.05em',
  } as React.CSSProperties,
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  } as React.CSSProperties,
  btn: {
    background: 'none',
    border: '1px solid #333',
    color: '#666',
    cursor: 'pointer',
    fontSize: 10,
    padding: '2px 6px',
    lineHeight: 1,
    borderRadius: 3,
    fontFamily: 'monospace',
  } as React.CSSProperties,
  btnActive: {
    borderColor: '#4ec9b0',
    color: '#4ec9b0',
  } as React.CSSProperties,
  panel: {
    padding: '8px',
    background: '#0d0d0d',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  } as React.CSSProperties,
  email: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#888',
  } as React.CSSProperties,
  keyStatus: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#555',
  } as React.CSSProperties,
  keySet: {
    color: '#4ec9b0',
  } as React.CSSProperties,
  keyMissing: {
    color: '#f44747',
  } as React.CSSProperties,
  row: {
    display: 'flex',
    gap: 4,
  } as React.CSSProperties,
  input: {
    flex: 1,
    background: '#1a1a1a',
    border: '1px solid #333',
    color: '#d4d4d4',
    borderRadius: 3,
    padding: '4px 6px',
    fontSize: 11,
    fontFamily: 'monospace',
    outline: 'none',
    minWidth: 0,
  } as React.CSSProperties,
  saveBtn: {
    background: '#1a3a2a',
    border: '1px solid #4ec9b0',
    color: '#4ec9b0',
    borderRadius: 3,
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'monospace',
  } as React.CSSProperties,
}
