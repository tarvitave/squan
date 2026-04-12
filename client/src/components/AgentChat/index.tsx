/**
 * AgentChat — Goose-style chat renderer for structured agent messages.
 * Shows assistant text as left-aligned bubbles, tool calls as collapsible cards,
 * and the user's task as a right-aligned dark pill.
 */

import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'
import {
  Bot, User, ChevronDown, ChevronRight, FileText, Terminal as TerminalIcon,
  Search, Edit3, Globe, Loader2, CheckCircle2, XCircle, DollarSign, Clock,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface TextContent { type: 'text'; text: string }
interface ToolUseContent { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

interface AssistantMsg {
  type: 'assistant'
  message: { content: Array<TextContent | ToolUseContent>; usage?: { input_tokens: number; output_tokens: number } }
}

interface UserMsg {
  type: 'user'
  tool_use_result?: { type: string; file?: { filePath: string; content: string; numLines: number } }
  message: { content: Array<{ tool_use_id: string; type: 'tool_result'; content: string }> }
}

interface SystemMsg { type: 'system'; model: string; claude_code_version: string; tools: string[] }

interface ResultMsg {
  type: 'result'
  subtype: string
  result: string
  total_cost_usd: number
  duration_ms: number
  num_turns: number
  is_error: boolean
}

type AgentMessage = AssistantMsg | UserMsg | SystemMsg | ResultMsg | { type: string }

interface AgentState {
  messages: AgentMessage[]
  status: string
  result: string | null
  totalCost: number
  durationMs: number
  sessionId: string | null
}

// ── Tool icon mapping ────────────────────────────────────────────────────────

function toolIcon(name: string) {
  if (name.includes('Read') || name.includes('Glob')) return <FileText className="w-3.5 h-3.5" />
  if (name.includes('Bash') || name.includes('Terminal')) return <TerminalIcon className="w-3.5 h-3.5" />
  if (name.includes('Write') || name.includes('Edit')) return <Edit3 className="w-3.5 h-3.5" />
  if (name.includes('Search') || name.includes('Grep')) return <Search className="w-3.5 h-3.5" />
  if (name.includes('Web')) return <Globe className="w-3.5 h-3.5" />
  return <Bot className="w-3.5 h-3.5" />
}

function formatToolInput(name: string, input: Record<string, unknown>): string {
  if (name === 'Read' && input.file_path) return String(input.file_path).split(/[/\\]/).pop() ?? ''
  if (name === 'Write' && input.file_path) return String(input.file_path).split(/[/\\]/).pop() ?? ''
  if (name === 'Edit' && input.file_path) return String(input.file_path).split(/[/\\]/).pop() ?? ''
  if (name === 'Bash' && input.command) return String(input.command).slice(0, 80)
  if (name === 'Grep' && input.pattern) return `/${input.pattern}/`
  if (name === 'Glob' && input.pattern) return String(input.pattern)
  return Object.values(input).map(String).join(', ').slice(0, 80)
}

// ── Components ───────────────────────────────────────────────────────────────

function ToolCallCard({ name, input, result }: { name: string; input: Record<string, unknown>; result?: string }) {
  const [expanded, setExpanded] = useState(false)
  const summary = formatToolInput(name, input)

  return (
    <div style={{ margin: '6px 0', borderRadius: 8, border: '1px solid #e3e6ea', overflow: 'hidden', fontSize: 13 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px',
          backgroundColor: '#f4f6f7', border: 'none', cursor: 'pointer', textAlign: 'left',
          color: '#3f434b',
        }}
      >
        {toolIcon(name)}
        <span style={{ fontWeight: 500 }}>{name}</span>
        <span style={{ color: '#878787', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 12 }}>
          {summary}
        </span>
        {expanded ? <ChevronDown className="w-4 h-4" style={{ color: '#a7b0b9', flexShrink: 0 }} /> : <ChevronRight className="w-4 h-4" style={{ color: '#a7b0b9', flexShrink: 0 }} />}
      </button>
      {expanded && (
        <div style={{ padding: '8px 12px', backgroundColor: '#ffffff', borderTop: '1px solid #e3e6ea' }}>
          <pre style={{ fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#3f434b', margin: 0, maxHeight: 200, overflow: 'auto' }}>
            {JSON.stringify(input, null, 2)}
          </pre>
          {result && (
            <>
              <div style={{ borderTop: '1px solid #e3e6ea', margin: '8px 0' }} />
              <pre style={{ fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#878787', margin: 0, maxHeight: 200, overflow: 'auto' }}>
                {result.slice(0, 2000)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function AssistantBubble({ content, toolResults }: { content: Array<TextContent | ToolUseContent>; toolResults: Map<string, string> }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '8px 0' }}>
      <div style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#f4f6f7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
        <Bot style={{ width: 16, height: 16, color: '#878787' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {content.map((c, i) => {
          if (c.type === 'text') {
            return (
              <div key={i} style={{ backgroundColor: '#f4f6f7', borderRadius: 12, padding: '10px 14px', color: '#3f434b', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {c.text}
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

function TaskBubble({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 0' }}>
      <div style={{ maxWidth: '80%', display: 'flex', gap: 10, flexDirection: 'row-reverse' }}>
        <div style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#3f434b', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
          <User style={{ width: 16, height: 16, color: '#ffffff' }} />
        </div>
        <div style={{ backgroundColor: '#3f434b', color: '#ffffff', borderRadius: 12, padding: '10px 14px', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {text}
        </div>
      </div>
    </div>
  )
}

function ResultCard({ result }: { result: ResultMsg }) {
  return (
    <div style={{
      margin: '12px 0', padding: '12px 16px', borderRadius: 8,
      backgroundColor: result.is_error ? '#f94b4b10' : '#91cb8010',
      border: `1px solid ${result.is_error ? '#f94b4b30' : '#91cb8030'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {result.is_error
          ? <XCircle style={{ width: 16, height: 16, color: '#f94b4b' }} />
          : <CheckCircle2 style={{ width: 16, height: 16, color: '#91cb80' }} />
        }
        <span style={{ fontSize: 14, fontWeight: 500, color: '#3f434b' }}>
          {result.is_error ? 'Agent failed' : 'Agent completed'}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#878787' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock style={{ width: 12, height: 12 }} />
          {(result.duration_ms / 1000).toFixed(1)}s
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <DollarSign style={{ width: 12, height: 12 }} />
          ${result.total_cost_usd.toFixed(4)}
        </span>
        <span>{result.num_turns} turns</span>
      </div>
      {result.result && (
        <div style={{ marginTop: 8, fontSize: 13, color: '#3f434b', whiteSpace: 'pre-wrap' }}>
          {result.result.slice(0, 500)}
        </div>
      )}
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

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
        if (r.ok && active) {
          const data = await r.json()
          setState(data)
        }
      } catch { /* ignore */ }
    }

    poll()
    const interval = setInterval(poll, 2000) // Poll every 2s
    return () => { active = false; clearInterval(interval) }
  }, [workerbeeId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state?.messages.length])

  useEffect(() => {
    if (state) setLoading(false)
  }, [state])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#a7b0b9' }}>
        <Loader2 style={{ width: 24, height: 24, animation: 'spin 1s linear infinite' }} />
      </div>
    )
  }

  if (!state || state.status === 'no_runner') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#a7b0b9', gap: 8, padding: 32 }}>
        <Bot style={{ width: 32, height: 32 }} />
        <div style={{ fontSize: 14, textAlign: 'center' }}>
          This agent is using the terminal view.<br />
          Switch to the <strong>Terminals</strong> tab to see its output.
        </div>
      </div>
    )
  }

  // Build tool result map (tool_use_id → result text)
  const toolResults = new Map<string, string>()
  for (const msg of state.messages) {
    if (msg.type === 'user') {
      const userMsg = msg as UserMsg
      for (const c of userMsg.message.content) {
        if (c.type === 'tool_result') {
          toolResults.set(c.tool_use_id, c.content)
        }
      }
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#ffffff' }}>
      {/* Header */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #e3e6ea', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <div style={{
          width: 8, height: 8, borderRadius: 4, flexShrink: 0,
          backgroundColor: state.status === 'working' ? '#13bbaf' : state.status === 'done' ? '#91cb80' : '#f94b4b',
        }} />
        <span style={{ fontSize: 14, fontWeight: 500, color: '#3f434b' }}>Agent Chat</span>
        <span style={{ fontSize: 12, color: '#878787' }}>
          {state.status === 'working' ? 'Working…' : state.status === 'done' ? 'Completed' : 'Error'}
        </span>
        {state.totalCost > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#878787', display: 'flex', alignItems: 'center', gap: 4 }}>
            <DollarSign style={{ width: 12, height: 12 }} />
            ${state.totalCost.toFixed(4)}
          </span>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
        {/* Show task as user message */}
        {taskDescription && <TaskBubble text={taskDescription} />}

        {state.messages.map((msg, i) => {
          if (msg.type === 'assistant') {
            const assistantMsg = msg as AssistantMsg
            return <AssistantBubble key={i} content={assistantMsg.message.content} toolResults={toolResults} />
          }
          if (msg.type === 'result') {
            return <ResultCard key={i} result={msg as ResultMsg} />
          }
          // Skip system, user (tool results rendered inside assistant), rate_limit
          return null
        })}

        {state.status === 'working' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', color: '#a7b0b9' }}>
            <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13 }}>Agent is working…</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}
