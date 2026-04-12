import { useEffect } from 'react'
import { AlertCircle, Info, X } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import { useStore } from '../../store/index.js'

export function ToastContainer() {
  const toasts = useStore((s) => s.toasts)
  const dismissToast = useStore((s) => s.dismissToast)

  return (
    <div className="fixed bottom-12 right-4 flex flex-col gap-2 z-[9999] pointer-events-none">
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

  const isError = toast.kind === 'error'

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 px-4 py-3 rounded-lg text-sm max-w-[380px] pointer-events-auto shadow-default border',
        isError
          ? 'bg-bg-primary border-red-200/30 text-text-danger'
          : 'bg-bg-primary border-green-200/30 text-green-200',
      )}
    >
      {isError ? <AlertCircle className="w-4 h-4 shrink-0" /> : <Info className="w-4 h-4 shrink-0" />}
      <span className="flex-1 break-words">{toast.message}</span>
      <button
        className="text-text-tertiary hover:text-text-primary transition-colors cursor-pointer shrink-0"
        onClick={onDismiss}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
