import { useState, useEffect, useRef, useCallback } from 'react'
import { Code2, RefreshCw, Zap, ChevronDown, ChevronRight, Wrench } from 'lucide-react'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'
import { cn } from '../../lib/utils.js'
import { Button } from '../ui/button.js'

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
  const [collapsedTools, setCollapsedTools] = useState<Set<number>>(new Set())
  const bottomRef = useRef<HTMLDivElement>(null)
  const events = useStore((s) => s.events)

  useEffect(() => {
    apiFetch('/api/claude-code/sessions')
      .then((r) => r.json())
      .then((data: SessionMeta[]) => {
        setSessions(data)
        if (data.length > 0 && !selectedFile) setSelectedFile(data[0].file)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedFile) return
    setMessages([]); setTotalLines(0)
    let currentLine = 0, cancelled = false
    const load = () => {
      apiFetch(`/api/claude-code/messages?file=${encodeURIComponent(selectedFile)}&after=${currentLine}`)
        .then((r) => r.json())
        .then(({ messages: newMsgs, totalLines: newTotal }: { messages: CCMessage[]; totalLines: number }) => {
          if (cancelled) return
          if (newMsgs.length > 0) { setMessages((prev) => [...prev, ...newMsgs]); currentLine = newTotal; setTotalLines(newTotal) }
        })
        .catch(() => {})
    }
    load()
    const interval = setInterval(load, 2000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [selectedFile])

  useEffect(() => {
    const ccEvents = events.filter((e) => e.type.startsWith('claude_code.'))
    setHookEvents(ccEvents.slice(0, 20).map((e) => ({
      id: e.id,
      type: e.type.replace('claude_code.', ''),
      toolName: (e.payload as Record<string, unknown>)?.toolName as string | undefined,
      ts: e.timestamp,
    })))
  }, [events])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const configureHooks = useCallback(async () => {
    setConfiguring(true)
    try { await apiFetch('/api/claude-code/configure-hooks', { method: 'POST' }); setHooksConfigured(true) }
    catch {} finally { setConfiguring(false) }
  }, [])

  const toggleTool = (idx: number) => setCollapsedTools((prev) => {
    const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n
  })

  const formatTime = (ts?: string) => {
    if (!ts) return ''
    try { return new Date(ts).toLocaleTimeString() } catch { return '' }
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border-primary shrink-0">
        <div className="flex items-center gap-2 text-text-primary shrink-0">
          <Code2 className="w-4 h-4" />
          <span className="text-sm font-medium">Claude Code</span>
        </div>

        <select
          className="flex-1 min-w-0 bg-bg-secondary border border-border-primary text-text-primary rounded-md px-3 py-1.5 text-sm outline-none focus:border-block-teal transition-colors"
          value={selectedFile ?? ''}
          onChange={(e) => { setSelectedFile(e.target.value); setMessages([]) }}
        >
          {sessions.length === 0 && <option value="">No sessions found</option>}
          {sessions.map((s) => (
            <option key={s.file} value={s.file}>
              {s.projectPath.split(/[/\\]/).slice(-2).join('/')} · {s.id.slice(0, 8)} · {new Date(s.mtime).toLocaleDateString()}
            </option>
          ))}
        </select>

        <Button
          variant={hooksConfigured ? 'secondary' : 'outline'}
          size="sm"
          onClick={configureHooks}
          disabled={configuring || hooksConfigured}
          title="Configure Claude Code hooks for real-time events"
          className={cn(hooksConfigured && 'text-green-200 border-green-200/30')}
        >
          <Zap className={cn('w-3.5 h-3.5', configuring && 'animate-spin')} />
          {hooksConfigured ? 'Hooks live' : configuring ? 'Configuring…' : 'Enable hooks'}
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Conversation */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          {messages.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-text-tertiary">
              <Code2 className="w-8 h-8" />
              <p className="text-sm">Select a session to view the conversation</p>
            </div>
          )}

          {messages.map((msg, i) => {
            // Tool use — collapsible card
            if (msg.type === 'tool_use') {
              const collapsed = collapsedTools.has(i)
              return (
                <div key={i} className="border border-border-primary rounded-lg overflow-hidden">
                  <button
                    className="flex items-center gap-2 w-full px-3 py-2 text-left bg-bg-secondary hover:bg-bg-tertiary/50 transition-colors"
                    onClick={() => toggleTool(i)}
                  >
                    {collapsed ? <ChevronRight className="w-3.5 h-3.5 text-text-tertiary" /> : <ChevronDown className="w-3.5 h-3.5 text-text-tertiary" />}
                    <Wrench className="w-3.5 h-3.5 text-text-info" />
                    <span className="text-sm font-medium text-text-info">{msg.toolName}</span>
                  </button>
                  {!collapsed && msg.toolInput != null && (
                    <pre className="px-3 py-2 text-xs text-text-secondary font-mono whitespace-pre-wrap break-all bg-bg-primary border-t border-border-primary max-h-48 overflow-auto">
                      {JSON.stringify(msg.toolInput as Record<string, unknown>, null, 2).slice(0, 600)}
                    </pre>
                  )}
                </div>
              )
            }

            // Tool result
            if (msg.type === 'tool_result') return (
              <div key={i} className="flex gap-2 items-start px-3 py-2 border-l-2 border-border-secondary ml-2">
                <span className="text-xs text-text-tertiary shrink-0 font-medium">result</span>
                <span className="text-xs text-text-secondary font-mono whitespace-pre-wrap break-all">
                  {typeof msg.toolResult === 'string'
                    ? msg.toolResult.slice(0, 300)
                    : JSON.stringify(msg.toolResult).slice(0, 300)}
                </span>
              </div>
            )

            // Thinking
            if (msg.type === 'thinking') return (
              <div key={i} className="px-3 py-2 text-xs text-text-tertiary italic">
                <span className="font-medium not-italic mr-1">thinking</span>
                {(msg.thinking ?? '').slice(0, 400)}
              </div>
            )

            if (!msg.text) return null

            const isUser = msg.role === 'user'
            return (
              <div key={i} className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
                <div className={cn(
                  'max-w-[85%] rounded-2xl px-4 py-2.5',
                  isUser
                    ? 'bg-bg-inverse text-text-inverse'
                    : 'bg-bg-secondary text-text-primary',
                )}>
                  {!isUser && (
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-xs font-medium text-text-secondary">Claude</span>
                      {msg.timestamp && <span className="text-[10px] text-text-tertiary">{formatTime(msg.timestamp)}</span>}
                    </div>
                  )}
                  <div className={cn(
                    'text-sm leading-relaxed whitespace-pre-wrap break-words',
                    isUser && 'text-[14px]'
                  )}>
                    {msg.text}
                  </div>
                  {isUser && msg.timestamp && (
                    <div className="text-[10px] text-text-inverse/50 mt-1 text-right">{formatTime(msg.timestamp)}</div>
                  )}
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {/* Hook events sidebar */}
        {hookEvents.length > 0 && (
          <div className="w-[200px] border-l border-border-primary overflow-y-auto p-3 shrink-0 bg-bg-secondary">
            <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary uppercase tracking-wider mb-3">
              <RefreshCw className="w-3 h-3 text-block-teal" />
              Live hooks
            </div>
            {hookEvents.map((e) => (
              <div key={e.id} className="flex flex-col gap-0.5 py-2 border-b border-border-primary">
                <span className="text-xs font-medium text-text-info">{e.type}</span>
                {e.toolName && <span className="text-xs text-text-secondary">{e.toolName}</span>}
                <span className="text-[10px] text-text-tertiary">{formatTime(e.ts)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
