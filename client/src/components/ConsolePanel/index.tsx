import { useState, useRef, useEffect, useCallback } from 'react'
import { apiFetch } from '../../lib/api.js'
import { useStore } from '../../store/index.js'

// ── Types ────────────────────────────────────────────────────────────────────

interface Span {
  text: string
  color?: string
  bold?: boolean
}

type SpanLine = Span[]

interface ConsoleLine {
  kind: 'input' | 'output' | 'error' | 'info'
  spans?: SpanLine
  text?: string
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiGet(path: string): Promise<unknown> {
  const r = await apiFetch(path)
  if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? `HTTP ${r.status}`) }
  return r.json()
}

async function apiPost(path: string, body?: unknown): Promise<unknown> {
  const r = await apiFetch(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined })
  if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? `HTTP ${r.status}`) }
  const text = await r.text()
  return text ? JSON.parse(text) : {}
}

async function apiPatch(path: string, body?: unknown): Promise<unknown> {
  const r = await apiFetch(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined })
  if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? `HTTP ${r.status}`) }
  return r.json()
}

async function apiDelete(path: string): Promise<void> {
  const r = await apiFetch(path, { method: 'DELETE' })
  if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? `HTTP ${r.status}`) }
}

async function mcpCall(toolName: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const r = await apiFetch('/api/mcp', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: toolName, arguments: args } }),
  })
  const data = await r.json()
  if (data.error) throw new Error(data.error.message)
  return JSON.parse(data.result.content[0].text)
}

// ── Resolvers ─────────────────────────────────────────────────────────────────

async function resolveBeeId(nameOrId: string): Promise<string> {
  const bees = await apiGet('/api/workerbees') as Array<{ id: string; name: string }>
  const m = bees.find((b) => b.id === nameOrId || b.id.startsWith(nameOrId) || b.name === nameOrId)
  if (!m) throw new Error(`Agent not found: ${nameOrId}`)
  return m.id
}

async function resolveTrainId(nameOrId: string): Promise<string> {
  const trains = await apiGet('/api/release-trains') as Array<{ id: string; name: string }>
  const m = trains.find((rt) => rt.id === nameOrId || rt.id.startsWith(nameOrId) || rt.name === nameOrId)
  if (!m) throw new Error(`Release train not found: ${nameOrId}`)
  return m.id
}

async function resolveProjectId(nameOrId: string): Promise<string> {
  const rigs = await apiGet('/api/rigs') as Array<{ id: string; name: string }>
  const m = rigs.find((r) => r.id === nameOrId || r.id.startsWith(nameOrId) || r.name === nameOrId)
  if (!m) throw new Error(`Project not found: ${nameOrId}`)
  return m.id
}

// ── Span builders ─────────────────────────────────────────────────────────────

function mk(text: string, color?: string, bold?: boolean): SpanLine {
  return [{ text, color, bold }]
}

function statusSpan(status: string): SpanLine {
  const colors: Record<string, string> = {
    working: '#4ec9b0', done: '#4ec9b0', idle: '#569cd6',
    stalled: '#ce9178', zombie: '#f44747',
    open: '#569cd6', in_progress: '#4ec9b0', landed: '#888',
    cancelled: '#555', blocked: '#f44747',
  }
  return [{ text: status, color: colors[status] ?? '#888' }]
}

function pad(text: string, w: number): string {
  return text.length >= w ? text.slice(0, w) : text + ' '.repeat(w - text.length)
}

// Merge multiple SpanLines into one line
function line(...parts: SpanLine[]): SpanLine {
  return parts.flat()
}

// ── Command runner ────────────────────────────────────────────────────────────

async function runCommand(input: string, activeTownId: string | null): Promise<SpanLine[]> {
  const parts = tokenize(input.trim())
  const [cmd, ...args] = parts
  const output: SpanLine[] = []

  const teal  = (t: string) => mk(t, '#4ec9b0')
  const blue  = (t: string) => mk(t, '#569cd6')
  const gray  = (t: string) => mk(t, '#555')
  const dim   = (t: string) => mk(t, '#888')
  const red   = (t: string) => mk(t, '#f44747')
  const bold  = (t: string) => mk(t, undefined, true)

  const push = (...parts: SpanLine[]) => output.push(line(...parts))

  switch (cmd) {
    case 'status': {
      const s = await mcpCall('get_status_summary') as Record<string, unknown>
      push(mk('── Projects ', '#569cd6', true))
      const projects = (s.projects as Array<{ name: string; id: string }>) ?? []
      for (const p of projects) push(...[teal(p.name), gray('  '), dim(p.id)])
      push(mk('── Agents ', '#569cd6', true))
      const workerbees = (s.workerbees as Array<Record<string, unknown>>) ?? []
      if (!workerbees.length) push(...[gray('(none)')])
      for (const b of workerbees) {
        const name = b.name as string
        const status = b.status as string
        const task = ((b.taskDescription as string) ?? '').slice(0, 55)
        const rt = b.releaseTrain as { name: string } | null
        const trainPart = rt ? gray(`  [${rt.name}]`) : []
        push(...[teal(pad(name, 20)), statusSpan(status), ...trainPart, gray('  ' + task)])
      }
      push(mk('── Release Trains ', '#569cd6', true))
      const releaseTrains = (s.releaseTrains as Array<Record<string, unknown>>) ?? []
      if (!releaseTrains.length) push(...[gray('(none)')])
      for (const rt of releaseTrains) {
        const rtName = rt.name as string
        const rtStatus = rt.status as string
        const assignedBee = rt.assignedBee as string | null
        const tasks = (rt.atomicTasks as Array<{ status: string; title: string }>) ?? []
        const done = tasks.filter((t) => t.status === 'done').length
        const beePart = assignedBee ? gray(` -> ${assignedBee}`) : []
        const taskPart = tasks.length ? gray(`  (${done}/${tasks.length} tasks)`) : []
        push(...[blue(pad(rtName, 28)), statusSpan(rtStatus), ...beePart, ...taskPart])
        for (const t of tasks) {
          push(...[gray('  . '), statusSpan(t.status), gray('  ' + t.title)])
        }
      }
      break
    }

    case 'agents': {
      const bees = await apiGet('/api/workerbees') as Array<Record<string, unknown>>
      if (!bees.length) { push(...[gray('(no agents)')]); break }
      push(bold(pad('NAME', 20) + pad('STATUS', 14) + 'TASK'))
      for (const b of bees) {
        const name = b.name as string
        const status = b.status as string
        const task = ((b.taskDescription as string) ?? '').slice(0, 55)
        push(...[teal(pad(name, 20)), statusSpan(pad(status, 14)), gray(task)])
      }
      break
    }

    case 'projects': {
      const rigs = await apiGet('/api/rigs') as Array<Record<string, unknown>>
      if (!rigs.length) { push(...[gray('(no projects)')]); break }
      for (const r of rigs) {
        push(...[teal(r.name as string)])
        push(...[gray('  id:   '), dim(r.id as string)])
        push(...[gray('  path: '), dim((r.localPath as string) ?? '—')])
        push(...[gray('  repo: '), dim((r.repoUrl as string) ?? '—')])
      }
      break
    }

    case 'trains': {
      const status = args[0]
      const url = status ? `/api/release-trains?status=${status}` : '/api/release-trains'
      const trains = await apiGet(url) as Array<Record<string, unknown>>
      if (!trains.length) { push(...[gray('(no release trains)')]); break }
      push(bold(pad('ID', 10) + pad('STATUS', 14) + 'NAME'))
      for (const rt of trains) {
        push(...[gray(pad((rt.id as string).slice(0, 8), 10)), statusSpan(pad(rt.status as string, 14)), mk(rt.name as string)])
      }
      break
    }

    case 'train': {
      if (!args[0]) { push(...[red('Usage: sq train <id>')]); break }
      const rt = await mcpCall('get_release_train', { releaseTrainId: await resolveTrainId(args[0]) }) as Record<string, unknown>
      push(...[mk(rt.name as string, undefined, true), ...statusSpan(rt.status as string)])
      push(...[gray('id: '), dim(rt.id as string)])
      const bee = rt.assignedBee as Record<string, unknown> | null
      if (bee) {
        push(...[gray('agent: '), teal(bee.name as string), ...statusSpan(bee.status as string)])
        if (bee.completionNote) push(...[gray('note: '), dim(bee.completionNote as string)])
      }
      if (rt.description) push(...[gray((rt.description as string).slice(0, 200))])
      const tasks = (rt.atomicTasks as Array<{ id: string; status: string; title: string }>) ?? []
      if (tasks.length) {
        push(bold('Tasks:'))
        for (const t of tasks) push(...[statusSpan(pad(t.status, 14)), mk(t.title + '  '), gray(t.id.slice(0, 8))])
      }
      break
    }

    case 'dispatch': {
      if (!args[0]) { push(...[red('Usage: sq dispatch <release-train-id>')]); break }
      const data = await mcpCall('dispatch_release_train', { releaseTrainId: await resolveTrainId(args[0]) }) as Record<string, unknown>
      const bee = data.bee as Record<string, unknown>
      push(...[mk('✓ Dispatched  ', '#4ec9b0'), teal(bee.name as string), gray('  branch: ' + bee.branch)])
      break
    }

    case 'kill': {
      if (!args[0]) { push(...[red('Usage: sq kill <agent-name-or-id>')]); break }
      const beeId = await resolveBeeId(args[0])
      await apiDelete(`/api/workerbees/${beeId}`)
      push(...[mk(`✓ Killed ${args[0]}`, '#4ec9b0')])
      break
    }

    case 'restart': {
      if (!args[0]) { push(...[red('Usage: sq restart <agent-name-or-id>')]); break }
      const beeId = await resolveBeeId(args[0])
      const data = await apiPost(`/api/workerbees/${beeId}/restart`) as Record<string, unknown>
      const newBee = data.bee as Record<string, unknown>
      push(...[mk('✓ Restarted  ', '#4ec9b0'), teal(newBee.name as string)])
      break
    }

    case 'spawn': {
      if (args.length < 2) { push(...[red('Usage: sq spawn <project> "<task>"')]); break }
      const projectId = await resolveProjectId(args[0])
      const task = args.slice(1).join(' ')
      const bee = await apiPost('/api/workerbees', { projectId, taskDescription: task }) as Record<string, unknown>
      push(...[mk('✓ Spawned  ', '#4ec9b0'), teal(bee.name as string), gray('  branch: ' + bee.branch)])
      break
    }

    case 'create-train': {
      if (args.length < 2) { push(...[red('Usage: sq create-train <project> "<name>"')]); break }
      const projectId = await resolveProjectId(args[0])
      const name = args[1]
      const description = args.slice(2).join(' ')
      const rt = await apiPost('/api/release-trains', { projectId, name, description }) as Record<string, unknown>
      push(...[mk('✓ Created  ', '#4ec9b0'), teal(rt.name as string), gray('  ' + (rt.id as string).slice(0, 8))])
      break
    }

    case 'land': {
      if (!args[0]) { push(...[red('Usage: sq land <release-train-id>')]); break }
      const rtId = await resolveTrainId(args[0])
      await apiPost(`/api/release-trains/${rtId}/land`)
      push(...[mk('✓ Landed', '#4ec9b0')])
      break
    }

    case 'tasks': {
      const rtId = args[0] ? await resolveTrainId(args[0]) : undefined
      const url = rtId ? `/api/atomictasks?releaseTrainId=${rtId}` : '/api/atomictasks'
      const tasks = await apiGet(url) as Array<Record<string, unknown>>
      if (!tasks.length) { push(...[gray('(no tasks)')]); break }
      for (const t of tasks) {
        push(...[gray(pad((t.id as string).slice(0, 8), 10)), statusSpan(pad(t.status as string, 14)), mk(t.title as string)])
      }
      break
    }

    case 'task': {
      if (args.length < 2) { push(...[red('Usage: sq task <release-train-id> "<title>"')]); break }
      const rtId = await resolveTrainId(args[0])
      const title = args[1]
      const description = args.slice(2).join(' ')
      const trains = await apiGet('/api/release-trains') as Array<{ id: string; projectId: string }>
      const rt = trains.find((r) => r.id === rtId)
      if (!rt) throw new Error('Release train not found')
      const t = await apiPost('/api/atomictasks', { projectId: rt.projectId, releaseTrainId: rtId, title, description }) as Record<string, unknown>
      push(...[mk('✓ Created task  ', '#4ec9b0'), mk(t.title as string), gray('  ' + (t.id as string).slice(0, 8))])
      break
    }

    case 'done': {
      if (!args[0]) { push(...[red('Usage: sq done <task-id>')]); break }
      await apiPatch(`/api/atomictasks/${args[0]}/status`, { status: 'done' })
      push(...[mk('✓ Marked done', '#4ec9b0')])
      break
    }

    case 'send': {
      if (args.length < 2) { push(...[red('Usage: sq send <agent-name-or-id> "<message>"')]); break }
      const beeId = await resolveBeeId(args[0])
      const message = args.slice(1).join(' ')
      await apiPost(`/api/workerbees/${beeId}/message`, { message })
      push(...[mk('✓ Sent', '#4ec9b0')])
      break
    }

    case 'help':
    case '?': {
      push(mk('sq — Squansq console', '#4ec9b0', true))
      push([])
      push(mk('Overview', '#569cd6', true))
      push(...[gray('  status               '), mk('Full orchestration overview')])
      push(...[gray('  agents               '), mk('List all agents')])
      push(...[gray('  projects             '), mk('List all projects')])
      push(...[gray('  trains [status]      '), mk('List release trains')])
      push(...[gray('  train <id>           '), mk('Details of a release train')])
      push([])
      push(mk('Agents', '#569cd6', true))
      push(...[gray('  spawn <proj> <task>  '), mk('Spawn an agent')])
      push(...[gray('  kill <name>          '), mk('Kill an agent')])
      push(...[gray('  restart <name>       '), mk('Restart a zombie/stalled agent')])
      push(...[gray('  send <name> <msg>    '), mk('Send a message to an agent')])
      push([])
      push(mk('Release Trains', '#569cd6', true))
      push(...[gray('  create-train <p> <n> '), mk('Create a release train')])
      push(...[gray('  dispatch <id>        '), mk('Dispatch a release train')])
      push(...[gray('  land <id>            '), mk('Mark a release train complete')])
      push([])
      push(mk('Atomic Tasks', '#569cd6', true))
      push(...[gray('  tasks [rt-id]        '), mk('List tasks')])
      push(...[gray('  task <rt-id> <title> '), mk('Create a task')])
      push(...[gray('  done <task-id>       '), mk('Mark a task done')])
      break
    }

    case '': {
      break
    }

    default: {
      push(...[red(`Unknown command: ${cmd}. Type `), mk('help', '#4ec9b0'), red(' for commands.')])
    }
  }

  return output
}

function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuote = false
  let quoteChar = ''
  for (const ch of input) {
    if (inQuote) {
      if (ch === quoteChar) { inQuote = false }
      else { current += ch }
    } else if (ch === '"' || ch === "'") {
      inQuote = true
      quoteChar = ch
    } else if (ch === ' ') {
      if (current) { tokens.push(current); current = '' }
    } else {
      current += ch
    }
  }
  if (current) tokens.push(current)
  return tokens
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ConsolePanel() {
  const activeTownId = useStore((s) => s.activeTownId)
  const [lines, setLines] = useState<ConsoleLine[]>([
    { kind: 'info', text: 'sq — Squansq console. Type help for commands.' },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  const submit = useCallback(async () => {
    const cmd = input.trim()
    setLines((prev) => [...prev, { kind: 'input', text: cmd }])
    setInput('')
    setHistoryIdx(-1)
    if (cmd) setHistory((h) => [cmd, ...h.slice(0, 99)])
    setBusy(true)
    try {
      const spanLines = await runCommand(cmd, activeTownId)
      setLines((prev) => [
        ...prev,
        ...spanLines.map((spans) => ({ kind: 'output' as const, spans })),
      ])
    } catch (err) {
      setLines((prev) => [...prev, { kind: 'error', text: (err as Error).message }])
    } finally {
      setBusy(false)
    }
  }, [input, activeTownId])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      submit()
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHistoryIdx((i) => {
        const next = Math.min(i + 1, history.length - 1)
        setInput(history[next] ?? '')
        return next
      })
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHistoryIdx((i) => {
        const next = Math.max(i - 1, -1)
        setInput(next === -1 ? '' : (history[next] ?? ''))
        return next
      })
    }
  }

  return (
    <div style={styles.root} onClick={() => inputRef.current?.focus()}>
      <div style={styles.output}>
        {lines.map((consoleLine, i) => (
          <div key={i} style={getLineStyle(consoleLine.kind)}>
            {consoleLine.kind === 'input' && (
              <><span style={styles.prompt}>sq&gt;</span>{' '}{consoleLine.text}</>
            )}
            {consoleLine.kind === 'output' && renderSpanLine(consoleLine.spans ?? [])}
            {consoleLine.kind === 'error' && (
              <span style={{ color: '#f44747' }}>Error: {consoleLine.text}</span>
            )}
            {consoleLine.kind === 'info' && (
              <span style={{ color: '#555' }}>{consoleLine.text}</span>
            )}
          </div>
        ))}
        {busy && <div style={styles.busy}>...</div>}
        <div ref={bottomRef} />
      </div>
      <div style={styles.inputRow}>
        <span style={styles.prompt}>sq&gt;</span>
        <input
          ref={inputRef}
          style={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={busy}
          autoFocus
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </div>
  )
}

function renderSpanLine(spans: SpanLine) {
  if (!spans.length) return <br />
  return (
    <>
      {spans.map((s, i) => (
        <span key={i} style={{ color: s.color, fontWeight: s.bold ? 'bold' : undefined }}>
          {s.text}
        </span>
      ))}
    </>
  )
}

function getLineStyle(kind: string): React.CSSProperties {
  return {
    padding: '1px 0',
    whiteSpace: 'pre' as const,
    color: kind === 'input' ? '#d4d4d4' : '#9cdcfe',
    lineHeight: 1.6,
    minHeight: '1.6em',
  }
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#0d0d0d',
    fontFamily: '"Cascadia Code", "Fira Code", monospace',
    fontSize: 13,
  },
  output: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 16px',
  },
  busy: {
    color: '#555',
    padding: '2px 0',
  },
  inputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    borderTop: '1px solid #2d2d2d',
    background: '#0a0a0a',
    flexShrink: 0,
  },
  prompt: {
    color: '#4ec9b0',
    userSelect: 'none',
    flexShrink: 0,
  },
  input: {
    flex: 1,
    background: 'none',
    border: 'none',
    color: '#d4d4d4',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
    caretColor: '#4ec9b0',
  },
}
