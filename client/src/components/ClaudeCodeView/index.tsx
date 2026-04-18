import 'xterm/css/xterm.css'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from '../../store/index.js'
import { apiFetch } from '../../lib/api.js'
import {
  Code2, Play, Square, RotateCcw, Maximize2, Minimize2, Loader2, AlertCircle,
} from 'lucide-react'

// Dynamic imports for xterm (client-side only)
let Terminal: any = null
let FitAddon: any = null

export function ClaudeCodeView() {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<any>(null)
  const fitAddonRef = useRef<any>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const token = useStore((s) => s.token)

  const [status, setStatus] = useState<'idle' | 'connecting' | 'running' | 'error'>('idle')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Load xterm modules dynamically
  useEffect(() => {
    const loadXterm = async () => {
      if (!Terminal) {
        const xtermModule = await import('xterm')
        Terminal = xtermModule.Terminal
      }
      if (!FitAddon) {
        const fitModule = await import('xterm-addon-fit')
        FitAddon = fitModule.FitAddon
      }
    }
    loadXterm()
  }, [])

  const initTerminal = useCallback(() => {
    if (!terminalRef.current || !Terminal || !FitAddon) return

    // Clean up old terminal
    if (xtermRef.current) {
      xtermRef.current.dispose()
    }

    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon

    const xterm = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
      theme: {
        background: '#0a0b0f',
        foreground: '#e4e7eb',
        cursor: '#13bbaf',
        cursorAccent: '#0a0b0f',
        selectionBackground: '#13bbaf40',
        black: '#0a0b0f',
        red: '#f94b4b',
        green: '#91cb80',
        yellow: '#fbcd44',
        blue: '#6eb0f7',
        magenta: '#c084fc',
        cyan: '#13bbaf',
        white: '#e4e7eb',
        brightBlack: '#4a5568',
        brightRed: '#fc8181',
        brightGreen: '#9ae6b4',
        brightYellow: '#fefcbf',
        brightBlue: '#90cdf4',
        brightMagenta: '#d6bcfa',
        brightCyan: '#76e4f7',
        brightWhite: '#ffffff',
      },
      allowProposedApi: true,
      scrollback: 10000,
    })

    xterm.loadAddon(fitAddon)
    xterm.open(terminalRef.current)

    // Fit after a brief delay to let the DOM settle
    setTimeout(() => {
      try { fitAddon.fit() } catch {}
    }, 100)

    xtermRef.current = xterm

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit() } catch {}
    })
    resizeObserver.observe(terminalRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  // Connect WebSocket to server PTY
  const connectToSession = useCallback((sid: string) => {
    if (wsRef.current) {
      wsRef.current.close()
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.hostname}:3001/ws?token=${token}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      // Subscribe to the claude terminal session
      ws.send(JSON.stringify({ type: 'subscribe', sessionId: sid }))
      setStatus('running')
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'terminal-data' && msg.sessionId === sid && xtermRef.current) {
          xtermRef.current.write(msg.data)
        }
      } catch {
        // Binary data or plain text
        if (xtermRef.current) xtermRef.current.write(event.data)
      }
    }

    ws.onclose = () => {
      setStatus('idle')
    }

    ws.onerror = () => {
      setStatus('error')
      setError('WebSocket connection failed')
    }

    // Send terminal input to server
    if (xtermRef.current) {
      xtermRef.current.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'terminal-input', sessionId: sid, data }))
        }
      })
    }
  }, [token])

  // Start a new Claude Code session
  const startSession = async () => {
    setStatus('connecting')
    setError(null)

    // Initialize terminal
    initTerminal()

    try {
      const res = await apiFetch('/api/claude-terminal', { method: 'POST' })
      if (!res.ok) {
        const err = await res.json()
        setError(err.error || 'Failed to start Claude Code session')
        setStatus('error')
        return
      }
      const data = await res.json()
      setSessionId(data.sessionId)

      // Connect WebSocket
      setTimeout(() => connectToSession(data.sessionId), 200)
    } catch (e: any) {
      setError(e.message || 'Failed to start session')
      setStatus('error')
    }
  }

  // Kill session
  const killSession = async () => {
    if (sessionId) {
      try {
        await apiFetch(`/api/claude-terminal/${sessionId}`, { method: 'DELETE' })
      } catch {}
    }
    if (wsRef.current) wsRef.current.close()
    if (xtermRef.current) {
      xtermRef.current.clear()
      xtermRef.current.write('\r\n\x1b[33mSession ended.\x1b[0m\r\n')
    }
    setSessionId(null)
    setStatus('idle')
  }

  // Restart session
  const restartSession = async () => {
    await killSession()
    setTimeout(startSession, 300)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close()
    }
  }, [])

  // Fit terminal on fullscreen change
  useEffect(() => {
    if (fitAddonRef.current) {
      setTimeout(() => {
        try { fitAddonRef.current.fit() } catch {}
      }, 100)
    }
  }, [isFullscreen])

  return (
    <div className={`flex flex-col ${isFullscreen ? 'fixed inset-0 z-50' : 'h-full'} bg-[#0a0b0f]`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#13141a] border-b border-[#2d2f36] shrink-0">
        <div className="flex items-center gap-3">
          <Code2 className="w-4 h-4 text-teal-400" />
          <span className="text-sm font-medium text-gray-300">Claude Code</span>
          {status === 'running' && (
            <span className="flex items-center gap-1.5 text-xs text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Connected
            </span>
          )}
          {status === 'connecting' && (
            <span className="flex items-center gap-1.5 text-xs text-yellow-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              Connecting...
            </span>
          )}
          {sessionId && (
            <span className="text-xs text-gray-600 font-mono">{sessionId.slice(0, 8)}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {status === 'idle' || status === 'error' ? (
            <button
              onClick={startSession}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-teal-600 rounded-md hover:bg-teal-500 transition-colors"
            >
              <Play className="w-3 h-3" />
              Start Session
            </button>
          ) : (
            <>
              <button
                onClick={restartSession}
                title="Restart session"
                className="w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:text-teal-400 hover:bg-[#2d2f36] transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={killSession}
                title="Kill session"
                className="w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:text-red-400 hover:bg-[#2d2f36] transition-colors"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            className="w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:text-white hover:bg-[#2d2f36] transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Terminal area */}
      <div className="flex-1 relative min-h-0">
        {status === 'idle' && !sessionId && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-gray-500 z-10">
            <Code2 className="w-12 h-12 opacity-30" />
            <div className="text-center">
              <p className="text-sm font-medium text-gray-400 mb-1">Claude Code Terminal</p>
              <p className="text-xs text-gray-600 mb-4">
                Interactive Claude Code CLI session
              </p>
              <button
                onClick={startSession}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-500 transition-colors"
              >
                <Play className="w-4 h-4" />
                Start Claude Code Session
              </button>
            </div>
            <p className="text-xs text-gray-700 mt-4">
              {navigator.platform.includes('Mac') ? 'Uses tmux for persistent sessions' : 'Direct PTY terminal'}
            </p>
          </div>
        )}

        {error && (
          <div className="absolute top-4 left-4 right-4 z-20 flex items-center gap-2 px-3 py-2 bg-red-900/50 border border-red-700/50 rounded-lg text-red-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">✕</button>
          </div>
        )}

        <div
          ref={terminalRef}
          className="absolute inset-0 p-2"
          style={{ display: status === 'idle' && !sessionId ? 'none' : 'block' }}
        />
      </div>


    </div>
  )
}
