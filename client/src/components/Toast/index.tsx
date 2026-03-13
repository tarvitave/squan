import { useEffect } from 'react'
import { useStore } from '../../store/index.js'

export function ToastContainer() {
  const toasts = useStore((s) => s.toasts)
  const dismissToast = useStore((s) => s.dismissToast)

  return (
    <div style={styles.container}>
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismissToast(t.id)} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onDismiss }: { toast: { id: string; message: string; kind: 'error' | 'info' }; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, toast.kind === 'error' ? 6000 : 3000)
    return () => clearTimeout(timer)
  }, [toast.id, toast.kind, onDismiss])

  return (
    <div style={{ ...styles.toast, ...(toast.kind === 'error' ? styles.error : styles.info) }}>
      <span style={styles.message}>{toast.message}</span>
      <button style={styles.close} onClick={onDismiss}>✕</button>
    </div>
  )
}

const styles = {
  container: {
    position: 'fixed' as const,
    bottom: 16,
    right: 16,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
    zIndex: 9999,
    pointerEvents: 'none' as const,
  },
  toast: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    borderRadius: 4,
    fontFamily: 'monospace',
    fontSize: 11,
    maxWidth: 320,
    pointerEvents: 'all' as const,
    boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
  },
  error: {
    background: '#2a1010',
    border: '1px solid #f44747',
    color: '#f44747',
  },
  info: {
    background: '#101a10',
    border: '1px solid #608b4e',
    color: '#608b4e',
  },
  message: {
    flex: 1,
    wordBreak: 'break-word' as const,
  },
  close: {
    background: 'none',
    border: 'none',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: 10,
    padding: 0,
    flexShrink: 0,
  },
}
