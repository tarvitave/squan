import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'

interface SessionMeta {
  id: string
  projectPath: string
  file: string
  mtime: number
  size: number
}

interface CCMessage {
  uuid?: string
  type: string
  role?: string
  timestamp?: string
  text?: string
  toolName?: string
  toolInput?: unknown
  toolResult?: unknown
  thinking?: string
}

export function ClaudeCodePanel() {
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [messages, setMessages] = useState<CCMessage[]>([])
  const [totalLines, setTotalLines] = useState(0)
  const [hooksConfigured, setHooksConfigured] = useState(false)
  const [configuring, setConfiguring] = useState(false)
  const [hookEvents, setHookEvents] = useState<Array<{ id: string; type: string; toolName?: string; ts: string }>>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const events = useStore((s) => s.events)

  // Load session list
  useEffect(() => {
    apiFetch('/api/claude-code/sessions')
      .then((r) => r.json())
      .then((data: SessionMeta[]) => {
        setSessions(data)
        // Auto-select most recent session
        if (data.length > 0 && !selectedFile) setSelectedFile(data[0].file)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load messages for selected session, then poll for new ones
  useEffect(() => {
    if (!selectedFile) return
    setMessages([])
    setTotalLines(0)

    let currentLine = 0
    let cancelled = false

    const load = () => {
      apiFetch(`/api/claude-code/messages?file=${encodeURIComponent(selectedFile)}&after=${currentLine}`)
        .then((r) => r.json())
        .then(({ messages: newMsgs, totalLines: newTotal }: { messages: CCMessage[]; totalLines: number }) => {
          if (cancelled) return
          if (newMsgs.length > 0) {
            setMessages((prev) => [...prev, ...newMsgs])
            currentLine = newTotal
            setTotalLines(newTotal)
          }
        })
        .catch(() => {})
    }

    load()
    const interval = setInterval(load, 2000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [selectedFile])

  // Capture hook events from the event stream
  useEffect(() => {
    const ccEvents = events.filter((e) => e.type.startsWith('claude_code.'))
    setHookEvents(ccEvents.slice(0, 20).map((e) => ({
      id: e.id,
      type: e.type.replace('claude_code.', ''),
      toolName: (e.payload as Record<string, unknown>)?.toolName as string | undefined,
      ts: e.timestamp,
    })))
  }, [events])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const configureHooks = useCallback(async () => {
    setConfiguring(true)
    try {
      await apiFetch('/api/claude-code/configure-hooks', { method: 'POST' })
      setHooksConfigured(true)
    } catch { /* ignore */ } finally {
      setConfiguring(false)
    }
  }, [])

  const formatTime = (ts?: string) => {
    if (!ts) return ''
    try { return new Date(ts).toLocaleTimeString() } catch { return '' }
  }

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.title}>Claude Code</span>

        <select
          style={styles.sessionSelect}
          value={selectedFile ?? ''}
          onChange={(e) => { setSelectedFile(e.target.value); setMessages([]) }}
        >
          {sessions.map((s) => (
            <option key={s.file} value={s.file}>
              {s.projectPath.slice(-40)} · {s.id.slice(0, 8)} · {new Date(s.mtime).toLocaleDateString()}
            </option>
          ))}
        </select>

        <button
          style={{ ...styles.hookBtn, ...(hooksConfigured ? styles.hookBtnDone : {}) }}
          onClick={configureHooks}
          disabled={configuring || hooksConfigured}
          title="Configure Claude Code hooks to push tool-use events to Squansq in real-time"
        >
          {hooksConfigured ? '✓ hooks live' : configuring ? '…' : '⚡ enable live hooks'}
        </button>
      </div>

      <div style={styles.body}>
        {/* Conversation */}
        <div style={styles.conversation}>
          {messages.length === 0 && (
            <div style={styles.empty}>Select a session above to view the conversation.</div>
          )}

          {messages.map((msg, i) => {
            if (msg.type === 'tool_use') return (
              <div key={i} style={styles.toolUse}>
                <span style={styles.toolBadge}>{msg.toolName}</span>
                {msg.toolInput != null && (
                  <pre style={styles.toolPre}>
                    {JSON.stringify(msg.toolInput as Record<string, unknown>, null, 2).slice(0, 400)}
                  </pre>
                )}
              </div>
            )

            if (msg.type === 'tool_result') return (
              <div key={i} style={styles.toolResult}>
                <span style={styles.toolResultBadge}>result</span>
                <span style={styles.toolResultText}>
                  {typeof msg.toolResult === 'string'
                    ? msg.toolResult.slice(0, 200)
                    : JSON.stringify(msg.toolResult).slice(0, 200)}
                </span>
              </div>
            )

            if (msg.type === 'thinking') return (
              <div key={i} style={styles.thinking}>
                <span style={styles.thinkingLabel}>thinking</span>
                <span style={styles.thinkingText}>{(msg.thinking ?? '').slice(0, 300)}</span>
              </div>
            )

            if (!msg.text) return null

            const isUser = msg.role === 'user'
            return (
              <div key={i} style={isUser ? styles.userMsg : styles.assistantMsg}>
                <div style={styles.msgMeta}>
                  <span style={isUser ? styles.userLabel : styles.assistantLabel}>
                    {isUser ? 'you' : 'claude'}
                  </span>
                  <span style={styles.msgTime}>{formatTime(msg.timestamp)}</span>
                </div>
                <div style={styles.msgText}>{msg.text}</div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {/* Hook events sidebar */}
        {hookEvents.length > 0 && (
          <div style={styles.hookSidebar}>
            <div style={styles.hookSidebarTitle}>live hooks</div>
            {hookEvents.map((e) => (
              <div key={e.id} style={styles.hookEvent}>
                <span style={styles.hookEventType}>{e.type}</span>
                {e.toolName && <span style={styles.hookEventTool}>{e.toolName}</span>}
                <span style={styles.hookEventTime}>{formatTime(e.ts)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#0d0d0d',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    background: '#111',
    borderBottom: '1px solid #2d2d2d',
    flexShrink: 0,
  },
  title: {
    color: '#4ec9b0',
    fontWeight: 'bold',
    fontSize: 11,
    letterSpacing: '0.05em',
    flexShrink: 0,
  },
  sessionSelect: {
    flex: 1,
    background: '#1a1a1a',
    border: '1px solid #333',
    color: '#d4d4d4',
    borderRadius: 3,
    padding: '3px 6px',
    fontSize: 11,
    fontFamily: 'monospace',
    outline: 'none',
    minWidth: 0,
  },
  hookBtn: {
    background: '#1a1a1a',
    border: '1px solid #555',
    color: '#888',
    borderRadius: 3,
    padding: '3px 8px',
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'monospace',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  hookBtnDone: {
    borderColor: '#4ec9b0',
    color: '#4ec9b0',
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  conversation: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  empty: {
    color: '#555',
    padding: 24,
    textAlign: 'center',
  },
  userMsg: {
    background: '#111',
    border: '1px solid #2a2a2a',
    borderRadius: 4,
    padding: '8px 10px',
    marginBottom: 4,
  },
  assistantMsg: {
    background: '#0a1a14',
    border: '1px solid #1a3a2a',
    borderRadius: 4,
    padding: '8px 10px',
    marginBottom: 4,
  },
  msgMeta: {
    display: 'flex',
    gap: 8,
    marginBottom: 4,
    alignItems: 'center',
  },
  userLabel: {
    color: '#569cd6',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },
  assistantLabel: {
    color: '#4ec9b0',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },
  msgTime: {
    color: '#444',
    fontSize: 10,
  },
  msgText: {
    color: '#d4d4d4',
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  toolUse: {
    background: '#111822',
    border: '1px solid #1e3a5a',
    borderRadius: 3,
    padding: '4px 8px',
    marginBottom: 2,
  },
  toolBadge: {
    color: '#9cdcfe',
    fontSize: 10,
    fontWeight: 'bold',
  },
  toolPre: {
    color: '#888',
    fontSize: 10,
    margin: '4px 0 0',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    overflowX: 'hidden',
  },
  toolResult: {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-start',
    padding: '3px 8px',
    marginBottom: 2,
    borderLeft: '2px solid #2d2d2d',
  },
  toolResultBadge: {
    color: '#555',
    fontSize: 10,
    flexShrink: 0,
  },
  toolResultText: {
    color: '#666',
    fontSize: 10,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  thinking: {
    display: 'flex',
    gap: 8,
    padding: '3px 8px',
    marginBottom: 2,
    opacity: 0.5,
  },
  thinkingLabel: {
    color: '#555',
    fontSize: 10,
    flexShrink: 0,
    fontStyle: 'italic',
  },
  thinkingText: {
    color: '#555',
    fontSize: 10,
    fontStyle: 'italic',
    whiteSpace: 'pre-wrap',
  },
  hookSidebar: {
    width: 200,
    borderLeft: '1px solid #2d2d2d',
    overflowY: 'auto',
    padding: '8px',
    flexShrink: 0,
  },
  hookSidebarTitle: {
    color: '#4ec9b0',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginBottom: 6,
  },
  hookEvent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    padding: '4px 0',
    borderBottom: '1px solid #1a1a1a',
  },
  hookEventType: {
    color: '#9cdcfe',
    fontSize: 10,
  },
  hookEventTool: {
    color: '#888',
    fontSize: 10,
  },
  hookEventTime: {
    color: '#444',
    fontSize: 10,
  },
}
