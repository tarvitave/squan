import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useWebSocket, SESSION_DEAD } from '../../hooks/useWebSocket.js'
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
        background: '#0d0d0d',
        foreground: '#d4d4d4',
        cursor: '#4ec9b0',
        selectionBackground: '#264f78',
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
    <div style={styles.wrapper} onClick={() => termRef.current?.focus()}>
      <div style={styles.titleBar}>
        <span style={{ ...styles.label, ...(isDead ? styles.labelDead : {}) }}>
          {label ?? sessionId.slice(0, 8)}
        </span>
        {onClose && (
          <button style={styles.closeBtn} onClick={onClose} title="Close pane">
            ✕
          </button>
        )}
      </div>
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div ref={containerRef} style={styles.terminal} />
        {isDead && onReconnect && (
          <div style={styles.deadOverlay}>
            <button
              style={styles.resumeBtn}
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

const styles = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    border: '1px solid #2d2d2d',
    borderRadius: 4,
    overflow: 'hidden',
    background: '#0d0d0d',
  },
  titleBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 8px',
    background: '#1a1a1a',
    borderBottom: '1px solid #2d2d2d',
    flexShrink: 0,
  },
  label: {
    color: '#4ec9b0',
    fontSize: 12,
    fontFamily: 'monospace',
    letterSpacing: '0.05em',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#666',
    cursor: 'pointer',
    fontSize: 12,
    padding: '0 4px',
  },
  terminal: {
    flex: 1,
    overflow: 'hidden',
    padding: 4,
  },
  labelDead: {
    color: '#ce9178',
  },
  deadOverlay: {
    position: 'absolute' as const,
    bottom: 16,
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'center',
    pointerEvents: 'none' as const,
  },
  resumeBtn: {
    pointerEvents: 'auto' as const,
    background: '#1a1a1a',
    border: '1px solid #4ec9b0',
    color: '#4ec9b0',
    borderRadius: 4,
    padding: '6px 16px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: 12,
  },
}
