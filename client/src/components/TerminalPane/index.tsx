import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useWebSocket, SESSION_DEAD } from '../../hooks/useWebSocket.js'
import { cn } from '../../lib/utils.js'
import '@xterm/xterm/css/xterm.css'

interface Props {
  sessionId: string
  label?: string
  onClose?: () => void
  onReconnect?: () => void
}

export function TerminalPane({ sessionId, label, onClose, onReconnect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [isDead, setIsDead] = useState(false)
  const { subscribe, unsubscribe, sendInput, sendResize } = useWebSocket()

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      theme: {
        background: '#ffffff',
        foreground: '#3f434b',
        cursor: '#3f434b',
        selectionBackground: '#e3e6ea',
        selectionForeground: '#3f434b',
        black: '#3f434b',
        brightBlack: '#878787',
        white: '#f4f6f7',
        brightWhite: '#ffffff',
      },
      fontFamily: '"Cascadia Code", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      scrollback: 5000,
    })

    const fit = new FitAddon()
    const links = new WebLinksAddon()
    term.loadAddon(fit)
    term.loadAddon(links)
    term.open(containerRef.current)
    fit.fit()
    term.focus()

    termRef.current = term
    fitRef.current = fit

    // Subscribe to server output
    subscribe(sessionId, (data) => {
      term.write(data)
      if (data === SESSION_DEAD) setIsDead(true)
    })

    // Forward keyboard input to server
    term.onData((data) => sendInput(sessionId, data))

    // Ctrl+C: copy selection if any, otherwise send ^C (SIGINT)
    // Ctrl+V: suppress the raw ^V keypress — the browser's paste event fires separately
    //         and xterm.js handles it via its internal textarea, calling onData cleanly.
    //         If we don't suppress here, xterm sends \x16 to the PTY *before* the pasted text.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true

      if (event.ctrlKey && event.key === 'c' && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection()).catch(() => {})
        return false
      }

      if (event.ctrlKey && event.key === 'v') {
        return false  // suppress \x16; paste event will handle the actual content
      }

      return true
    })

    // Handle resize
    const ro = new ResizeObserver(() => {
      fit.fit()
      sendResize(sessionId, term.cols, term.rows)
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      fitRef.current?.dispose()  // disconnect FitAddon's internal ResizeObserver before terminal dispose
      unsubscribe(sessionId)
      term.dispose()
    }
  }, [sessionId, subscribe, unsubscribe, sendInput, sendResize])

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded border border-border-primary bg-bg-primary"
      onClick={() => termRef.current?.focus()}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border-primary bg-bg-secondary px-2 py-1">
        <span className={cn('font-mono text-xs tracking-wide text-block-teal', isDead && 'text-orange')}>
          {label ?? sessionId.slice(0, 8)}
        </span>
        {onClose && (
          <button
            className="cursor-pointer border-none bg-transparent px-1 text-xs text-text-secondary hover:text-text-danger"
            onClick={onClose}
            title="Close pane"
          >
            ✕
          </button>
        )}
      </div>
      <div className="relative flex flex-1 flex-col overflow-hidden">
        <div ref={containerRef} className="flex-1 overflow-hidden p-1" />
        {isDead && onReconnect && (
          <div className="pointer-events-none absolute bottom-4 left-0 right-0 flex justify-center">
            <button
              className="pointer-events-auto cursor-pointer rounded border border-block-teal bg-bg-secondary px-4 py-1.5 font-mono text-xs text-block-teal hover:bg-block-teal/10"
              onClick={(e) => { e.stopPropagation(); onReconnect() }}
            >
              ↺ Resume last session
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
