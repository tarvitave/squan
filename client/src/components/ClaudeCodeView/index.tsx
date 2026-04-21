import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from '../../store/index.js'
import { useWebSocket } from '../../hooks/useWebSocket.js'
import { apiFetch } from '../../lib/api.js'
import {
  Code2, Play, Square, RotateCcw, Maximize2, Minimize2, Loader2, AlertCircle, X,
} from 'lucide-react'

// Dynamic imports for xterm (client-side only)
let Terminal: any = null
let FitAddon: any = null

/**
 * Claude Code panel — persistent left-side terminal for Claude Code CLI.
 * Uses tmux on macOS/Linux, direct PTY on Windows.
 * Communicates through the shared WebSocket (subscribe/terminal.input).
 */
export function ClaudeCodeView({ onClose }: { onClose?: () => void }) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<any>(null)
  const fitAddonRef = useRef<any>(null)
  const { subscribe, unsubscribe, sendInput, sendResize } = useWebSocket()

  const [status, setStatus] = useState<'idle' | 'connecting' | 'running' | 'error'>('idle')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Load xterm modules dynamically
  useEffect(() => {
    const loadXterm = async () => {
      if (!Terminal) {
        const xtermModule = await import('@xterm/xterm')
        Terminal = xtermModule.Terminal
      }
      if (!FitAddon) {
        const fitModule = await import('@xterm/addon-fit')
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
      try {
        fitAddon.fit()
        // Notify server of new dimensions
        if (xterm.cols && xterm.rows) {
          const sid = sessionId
          if (sid) sendResize(sid, xterm.cols, xterm.rows)
        }
      } catch {}
    })
    resizeObserver.observe(terminalRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [sendResize, sessionId])

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
      const sid = data.sessionId
      setSessionId(sid)

      // Subscribe to terminal output via shared WebSocket
      setTimeout(() => {
        subscribe(sid, (termData: string) => {
          if (xtermRef.current) {
            xtermRef.current.write(termData)
          }
        })

        // Wire keyboard input → server
        if (xtermRef.current) {
          xtermRef.current.onData((input: string) => {
            sendInput(sid, input)
          })
        }

        setStatus('running')
      }, 200)
    } catch (e: any) {
      setError(e.message || 'Failed to start session')
      setStatus('error')
    }
  }

  // Kill session
  const killSession = async () => {
    if (sessionId) {
      unsubscribe(sessionId)
      try {
        await apiFetch(`/api/claude-terminal/${sessionId}`, { method: 'DELETE' })
      } catch {}
    }
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
      if (sessionId) unsubscribe(sessionId)
    }
  }, [sessionId, unsubscribe])

  // Fit terminal on fullscreen change or panel resize
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
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#13141a] border-b border-[#2d2f36] shrink-0">
        <div className="flex items-center gap-2">
          <Code2 className="w-3.5 h-3.5 text-teal-400" />
          <span className="text-xs font-medium text-gray-300">Claude Code</span>
          {status === 'running' && (
            <span className="flex items-center gap-1 text-[10px] text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Connected
            </span>
          )}
          {status === 'connecting' && (
            <span className="flex items-center gap-1 text-[10px] text-yellow-400">
              <Loader2 className="w-3 h-3 animate-spin" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {status === 'idle' || status === 'error' ? (
            <button
              onClick={startSession}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-white bg-teal-600 rounded hover:bg-teal-500 transition-colors"
            >
              <Play className="w-3 h-3" />
              Start
            </button>
          ) : (
            <>
              <button
                onClick={restartSession}
                title="Restart session"
                className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:text-teal-400 hover:bg-[#2d2f36] transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
              <button
                onClick={killSession}
                title="Kill session"
                className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:text-red-400 hover:bg-[#2d2f36] transition-colors"
              >
                <Square className="w-3 h-3" />
              </button>
            </>
          )}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:text-white hover:bg-[#2d2f36] transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              title="Close panel"
              className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:text-white hover:bg-[#2d2f36] transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Terminal area */}
      <div className="flex-1 relative min-h-0">
        {status === 'idle' && !sessionId && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-500 z-10">
            <Code2 className="w-10 h-10 opacity-30" />
            <div className="text-center">
              <p className="text-xs font-medium text-gray-400 mb-1">Claude Code Terminal</p>
              <p className="text-[10px] text-gray-600 mb-3">
                Interactive Claude Code CLI session
              </p>
              <button
                onClick={startSession}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-500 transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                Start Session
              </button>
            </div>
            <p className="text-[10px] text-gray-700 mt-2">
              {navigator.platform.includes('Mac') ? 'Uses tmux for persistent sessions' : 'Direct PTY terminal'}
            </p>
          </div>
        )}

        {error && (
          <div className="absolute top-2 left-2 right-2 z-20 flex items-center gap-2 px-2 py-1.5 bg-red-900/50 border border-red-700/50 rounded text-red-300 text-[10px]">
            <AlertCircle className="w-3 h-3 shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">✕</button>
          </div>
        )}

        <div
          ref={terminalRef}
          className="absolute inset-0 p-1"
          style={{ display: status === 'idle' && !sessionId ? 'none' : 'block' }}
        />
      </div>
    </div>
  )
}
