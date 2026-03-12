import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useWebSocket } from '../../hooks/useWebSocket.js'
import '@xterm/xterm/css/xterm.css'

interface Props {
  sessionId: string
  label?: string
  onClose?: () => void
}

export function TerminalPane({ sessionId, label, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
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
    subscribe(sessionId, (data) => term.write(data))

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
      unsubscribe(sessionId)
      term.dispose()
    }
  }, [sessionId, subscribe, unsubscribe, sendInput, sendResize])

  return (
    <div style={styles.wrapper} onClick={() => termRef.current?.focus()}>
      <div style={styles.titleBar}>
        <span style={styles.label}>{label ?? sessionId.slice(0, 8)}</span>
        {onClose && (
          <button style={styles.closeBtn} onClick={onClose} title="Close pane">
            ✕
          </button>
        )}
      </div>
      <div ref={containerRef} style={styles.terminal} />
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
}
