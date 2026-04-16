/**
 * AgentChat \u2014 Chat renderer for agent messages.
 * - SquanMessage: left-aligned, full width, markdown text + tool cards
 * - UserMessage: right-aligned dark pill
 * - ToolCallWithResponse: bordered expandable card
 * - Follow-up input: always available to continue giving instructions
 * - Action bar: "Mark Complete" to advance kanban, or keep chatting
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'
import {
  Bot, ChevronRight, ChevronDown, FileText, Terminal as TerminalIcon,
  Search, Edit3, Globe, Loader2, CheckCircle2, XCircle, DollarSign, Clock,
  Copy, Check, ArrowUp, CheckSquare, GitPullRequest, MessageSquare,
} from 'lucide-react'

// \u2500\u2500 Types \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

interface TextContent { type: 'text'; text: string }
interface ToolUseContent { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
interface AssistantMsg {
  type: 'assistant'
  message: { content: Array<TextContent | ToolUseContent>; usage?: { input_tokens: number; output_tokens: number } }
}
interface UserMsg {
  type: 'user'
  text?: string
  message?: { content: Array<{ tool_use_id: string; type: 'tool_result'; content: string }> }
}
interface SystemMsg { type: 'system' }
interface ResultMsg {
  type: 'result'
  subtype: string
  result: string
  total_cost_usd: number
  duration_ms: number
  num_turns: number
  is_error: boolean
}
type AgentMessage = AssistantMsg | UserMsg | SystemMsg | ResultMsg | { type: string; text?: string }

interface AgentState {
  messages: AgentMessage[]
  status: string
  result: string | null
  totalCost: number
  durationMs: number
  inputTokens: number
  outputTokens: number
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

// \u2500\u2500 Tool helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function getToolIcon(name: string) {
  if (name.includes('read') || name.includes('Read') || name.includes('list') || name.includes('List')) return <FileText className="w-4 h-4 shrink-0" />
  if (name.includes('run') || name.includes('Bash') || name.includes('command')) return <TerminalIcon className="w-4 h-4 shrink-0" />
  if (name.includes('write') || name.includes('Write') || name.includes('edit') || name.includes('Edit')) return <Edit3 className="w-4 h-4 shrink-0" />
  if (name.includes('search') || name.includes('Search') || name.includes('grep')) return <Search className="w-4 h-4 shrink-0" />
  if (name.includes('web') || name.includes('Web')) return <Globe className="w-4 h-4 shrink-0" />
  return <Bot className="w-4 h-4 shrink-0" />
}

function getToolDescription(name: string, input: Record<string, unknown>): string {
  const getStr = (v: unknown) => typeof v === 'string' ? v : JSON.stringify(v)
  switch (name) {
    case 'read_file': return input.path ? `reading ${getStr(input.path).split(/[/\\]/).pop()}` : name
    case 'write_file': return input.path ? `writing ${getStr(input.path).split(/[/\\]/).pop()}` : name
    case 'edit_file': return input.path ? `editing ${getStr(input.path).split(/[/\\]/).pop()}` : name
    case 'run_command': return input.command ? `running ${getStr(input.command).slice(0, 60)}` : name
    case 'list_directory': return input.path ? `listing ${getStr(input.path)}` : 'listing directory'
    case 'search_files': return input.pattern ? `searching for ${getStr(input.pattern)}` : 'searching'
    case 'task_complete': return 'task complete'
    default: {
      const entries = Object.entries(input)
      if (entries.length === 0) return name
      if (entries.length === 1) return `${name}: ${getStr(entries[0][1]).slice(0, 60)}`
      return `${name} (${entries.map(([k]) => k).join(', ')})`
    }
  }
}

// \u2500\u2500 ToolCallCard \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function ToolCallCard({ name, input, result }: { name: string; input: Record<string, unknown>; result?: string }) {
  const [expanded, setExpanded] = useState(false)
  const description = getToolDescription(name, input)

  return (
    <div className="w-full text-sm rounded-lg overflow-hidden border border-border-primary my-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="group w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-secondary transition-colors"
      >
        <span className="relative">
          {getToolIcon(name)}
          {result !== undefined ? (
            <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-500 border border-white" />
          ) : (
            <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-block-teal border border-white animate-pulse" />
          )}
        </span>
        <span className="flex-1 truncate text-text-secondary">{description}</span>
        {expanded
          ? <ChevronDown className="w-4 h-4 text-text-disabled shrink-0 group-hover:text-text-secondary transition-colors" />
          : <ChevronRight className="w-4 h-4 text-text-disabled shrink-0 group-hover:text-text-secondary transition-colors" />
        }
      </button>

      {expanded && (
        <>
          {Object.keys(input).length > 0 && (
            <div className="border-t border-border-primary">
              <ExpandableSection label="Tool Details" startExpanded>
                <div className="px-4 pb-3">
                  {Object.entries(input).map(([key, val]) => (
                    <div key={key} className="mb-1.5 last:mb-0">
                      <span className="text-xs font-medium text-text-secondary">{key}: </span>
                      <span className="text-xs font-mono text-text-primary break-all whitespace-pre-wrap">
                        {typeof val === 'string' ? val.slice(0, 2000) : JSON.stringify(val, null, 2).slice(0, 2000)}
                      </span>
                    </div>
                  ))}
                </div>
              </ExpandableSection>
            </div>
          )}
          {result && (
            <div className="border-t border-border-primary">
              <ExpandableSection label="Output">
                <pre className="px-4 pb-3 text-xs font-mono whitespace-pre-wrap break-all text-text-secondary max-h-48 overflow-auto">
                  {result.slice(0, 3000)}
                </pre>
              </ExpandableSection>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ExpandableSection({ label, children, startExpanded = false }: { label: string; children: React.ReactNode; startExpanded?: boolean }) {
  const [open, setOpen] = useState(startExpanded)
  return (
    <>
      <button onClick={() => setOpen(!open)} className="group w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-bg-secondary transition-colors">
        <span className="text-sm text-text-secondary">{label}</span>
        <ChevronRight className={`w-4 h-4 text-text-disabled transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && children}
    </>
  )
}

// \u2500\u2500 SquanMessage \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function SquanMessageBubble({ content, toolResults }: { content: Array<TextContent | ToolUseContent>; toolResults: Map<string, string> }) {
  return (
    <div className="agent-message flex w-[90%] justify-start min-w-0 py-2">
      <div className="flex flex-col w-full min-w-0">
        {content.map((c, i) => {
          if (c.type === 'text' && c.text.trim()) {
            return (
              <div key={i} className="w-full prose prose-sm text-text-primary max-w-full font-sans leading-relaxed">
                <p className="whitespace-pre-wrap break-words m-0">{c.text}</p>
              </div>
            )
          }
          if (c.type === 'tool_use') {
            return <ToolCallCard key={i} name={c.name} input={c.input} result={toolResults.get(c.id)} />
          }
          return null
        })}
      </div>
    </div>
  )
}

// \u2500\u2500 UserMessage \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function UserMessageBubble({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="w-full mt-4 flex justify-end">
      <div className="max-w-[85%] w-fit">
        <div className="group flex flex-col">
          <div className="flex bg-text-primary text-bg-primary rounded-xl py-2.5 px-4">
            <div className="text-sm leading-relaxed whitespace-pre-wrap break-words font-sans text-white">
              {text}
            </div>
          </div>
          <div className="relative h-5 flex justify-end">
            <button
              onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
              className="absolute right-0 pt-0.5 flex items-center gap-1 text-xs text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// \u2500\u2500 Result Card \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function ResultCard({ result }: { result: ResultMsg }) {
  return (
    <div className={`my-3 p-3 rounded-lg border ${result.is_error ? 'border-red-200/30 bg-red-50' : 'border-green-200/30 bg-green-50'}`}>
      <div className="flex items-center gap-2 mb-2">
        {result.is_error
          ? <XCircle className="w-4 h-4 text-red-500" />
          : <CheckCircle2 className="w-4 h-4 text-green-600" />
        }
        <span className="text-sm font-medium text-text-primary">
          {result.is_error ? 'Agent failed' : 'Agent completed'}
        </span>
      </div>
      <div className="flex gap-4 text-xs text-text-secondary font-mono">
        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{(result.duration_ms / 1000).toFixed(1)}s</span>
        <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />${result.total_cost_usd?.toFixed(4) ?? '0.0000'}</span>
        <span>{result.num_turns} turns</span>
      </div>
      {result.result && (
        <div className="mt-2 text-sm text-text-primary whitespace-pre-wrap">{result.result.slice(0, 500)}</div>
      )}
    </div>
  )
}

// \u2500\u2500 Loading indicator \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function LoadingIndicator() {
  return (
    <div className="flex items-center gap-2 py-3 text-text-tertiary">
      <div className="flex gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-block-teal animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-block-teal animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-block-teal animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="text-xs">Agent is working...</span>
    </div>
  )
}

// \u2500\u2500 Completion Action Bar \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function CompletionActionBar({ workerbeeId }: { workerbeeId: string }) {
  const [marking, setMarking] = useState(false)
  const [marked, setMarked] = useState(false)
  const updateAgent = useStore((s) => s.updateAgent)
  const updateReleaseTrain = useStore((s) => s.updateReleaseTrain)
  const releaseTrains = useStore((s) => s.releaseTrains)

  // Find if this agent has an assigned release train still in_progress
  const assignedRT = releaseTrains.find(
    (rt) => rt.assignedWorkerBeeId === workerbeeId && rt.status === 'in_progress'
  )

  const handleMarkComplete = async () => {
    setMarking(true)
    try {
      const res = await apiFetch(`/api/workerbees/${workerbeeId}/mark-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'Manually marked complete by user' }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        useStore.getState().addToast(err.error || 'Failed to mark complete')
        return
      }
      const data = await res.json()
      updateAgent(workerbeeId, { status: 'done' })
      // Advance release trains in store
      for (const rtId of (data.advancedReleaseTrains ?? [])) {
        updateReleaseTrain(rtId, { status: 'pr_review' })
      }
      setMarked(true)
      useStore.getState().addToast('Agent marked complete \u2014 task moved to PR Review', 'info')
    } catch (err) {
      useStore.getState().addToast(`Failed: ${(err as Error).message}`)
    } finally {
      setMarking(false)
    }
  }

  if (marked) {
    return (
      <div className="mx-4 my-3 p-3 rounded-lg border border-green-200/30 bg-green-50 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
        <span className="text-sm text-green-700 font-medium">
          Marked complete{assignedRT ? ' \u2014 task moved to PR Review' : ''}
        </span>
      </div>
    )
  }

  return (
    <div className="mx-4 my-3 p-3 rounded-lg border border-border-primary bg-bg-secondary">
      <div className="flex items-center gap-2 mb-2">
        <CheckSquare className="w-4 h-4 text-text-secondary shrink-0" />
        <span className="text-sm font-medium text-text-primary">What would you like to do?</span>
      </div>
      <p className="text-xs text-text-secondary mb-3">
        You can give the agent more instructions below, or mark this task as complete to advance it on the board.
      </p>
      <div className="flex gap-2">
        <button
          onClick={handleMarkComplete}
          disabled={marking}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-green-200/40 text-green-600 bg-green-50 hover:bg-green-100 text-xs font-medium transition-colors disabled:opacity-50"
        >
          {marking ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5" />
          )}
          {assignedRT ? 'Mark Complete & Advance Board' : 'Mark Complete'}
        </button>
        <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-tertiary">
          <MessageSquare className="w-3.5 h-3.5" />
          or type below to continue
        </span>
      </div>
    </div>
  )
}

// \u2500\u2500 Follow-up Input Bar \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function FollowUpInput({ workerbeeId, onSent }: { workerbeeId: string; onSent: () => void }) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = async () => {
    const text = message.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const res = await apiFetch(`/api/workerbees/${workerbeeId}/followup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Follow-up failed' }))
        useStore.getState().addToast(err.error || 'Follow-up failed')
        return
      }
      setMessage('')
      // Reset textarea height
      if (inputRef.current) inputRef.current.style.height = 'auto'
      onSent()
    } catch (err) {
      useStore.getState().addToast(`Follow-up failed: ${(err as Error).message}`)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="border-t border-border-primary bg-bg-primary px-4 py-3 shrink-0">
      <div className="flex items-end gap-2 max-w-3xl mx-auto">
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            className="w-full bg-bg-secondary border border-border-primary rounded-xl px-4 py-2.5 pr-10 text-sm outline-none focus:border-block-teal resize-none min-h-[42px] max-h-[120px] placeholder:text-text-disabled"
            placeholder="Give more instructions or ask a follow-up..."
            value={message}
            onChange={(e) => {
              setMessage(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
            }}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={sending}
          />
          <button
            onClick={handleSend}
            disabled={!message.trim() || sending}
            className="absolute right-2 bottom-2 p-1 rounded-lg bg-block-teal text-white disabled:opacity-30 disabled:bg-text-tertiary hover:bg-block-teal/80 transition-colors"
            title="Send (Enter)"
          >
            {sending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <ArrowUp className="w-4 h-4" />
            }
          </button>
        </div>
      </div>
      <div className="text-center mt-1.5">
        <span className="text-[10px] text-text-disabled">Enter to send \u2022 Shift+Enter for new line</span>
      </div>
    </div>
  )
}

// \u2500\u2500 Main Component \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

export function AgentChat({ workerbeeId, taskDescription }: { workerbeeId: string; taskDescription?: string }) {
  const [state, setState] = useState<AgentState | null>(null)
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Poll for messages
  useEffect(() => {
    let active = true
    const poll = async () => {
      try {
        const r = await apiFetch(`/api/workerbees/${workerbeeId}/messages`)
        if (r.ok && active) setState(await r.json())
      } catch { /* ignore */ }
    }
    poll()
    const interval = setInterval(poll, 1500)
    return () => { active = false; clearInterval(interval) }
  }, [workerbeeId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state?.messages.length])

  useEffect(() => {
    if (state) setLoading(false)
  }, [state])

  // Build tool result map
  const toolResults = useMemo(() => {
    const map = new Map<string, string>()
    if (!state) return map
    for (const msg of state.messages) {
      if (msg.type === 'user' && (msg as UserMsg).message?.content) {
        for (const c of (msg as UserMsg).message!.content) {
          if (c.type === 'tool_result') map.set(c.tool_use_id, c.content)
        }
      }
    }
    return map
  }, [state?.messages])

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1">
        <Loader2 className="w-6 h-6 text-text-tertiary animate-spin" />
      </div>
    )
  }

  if (!state) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 text-text-tertiary gap-3 p-8">
        <Bot className="w-8 h-8" />
        <div className="text-sm text-center">Loading agent data...</div>
      </div>
    )
  }

  // If no_runner but we have messages from a previous run, show them
  if (state.status === 'no_runner' && state.messages.length === 0) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex flex-col items-center justify-center flex-1 text-text-tertiary gap-3 p-8">
          <Bot className="w-8 h-8" />
          <div className="text-sm text-center">
            This agent has finished. No conversation history available.
          </div>
        </div>
        <FollowUpInput workerbeeId={workerbeeId} onSent={() => {}} />
      </div>
    )
  }

  // Map no_runner with messages to 'done' for display
  const displayStatus = state.status === 'no_runner' ? 'done' : state.status
  const isFinished = displayStatus === 'done' || displayStatus === 'error'

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-bg-primary">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border-primary shrink-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${
          displayStatus === 'working' ? 'bg-block-teal animate-pulse' :
          displayStatus === 'done' ? 'bg-green-500' : 'bg-red-500'
        }`} />
        <span className="text-sm font-medium text-text-primary">
          {displayStatus === 'working' ? 'Working...' : displayStatus === 'done' ? 'Completed' : 'Error'}
        </span>
        <span className="ml-auto flex items-center gap-3 text-xs text-text-secondary font-mono">
          {state.totalCost > 0 && <span>${state.totalCost.toFixed(4)}</span>}
          {(state.inputTokens > 0 || state.outputTokens > 0) && (
            <span>IN {formatTokens(state.inputTokens)} OUT {formatTokens(state.outputTokens)}</span>
          )}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {taskDescription && <UserMessageBubble text={taskDescription} />}

        {state.messages.map((msg, i) => {
          if (msg.type === 'assistant' && (msg as AssistantMsg).message?.content) {
            return <SquanMessageBubble key={i} content={(msg as AssistantMsg).message.content} toolResults={toolResults} />
          }
          if (msg.type === 'result') {
            return <ResultCard key={i} result={msg as ResultMsg} />
          }
          if (msg.type === 'user' && (msg as UserMsg).text) {
            return <UserMessageBubble key={i} text={(msg as UserMsg).text!} />
          }
          if ((msg as any).type === 'error') {
            return (
              <div key={i} className="my-2 p-3 rounded-lg border border-red-200/30 bg-red-50 text-red-700 text-sm">
                {(msg as any).text}
              </div>
            )
          }
          return null
        })}

        {displayStatus === 'working' && <LoadingIndicator />}

        {/* Completion action bar \u2014 appears inline in the chat after the last message */}
        {isFinished && <CompletionActionBar workerbeeId={workerbeeId} />}

        <div ref={bottomRef} />
      </div>

      {/* Follow-up input \u2014 always visible for giving more instructions */}
      <FollowUpInput
        workerbeeId={workerbeeId}
        onSent={() => {
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 200)
        }}
      />
    </div>
  )
}
