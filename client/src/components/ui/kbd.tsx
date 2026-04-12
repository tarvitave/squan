import { cn } from '../../lib/utils.js'

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={cn(
      'inline-flex items-center justify-center rounded border border-border bg-bg-secondary px-1.5 py-0.5 text-[10px] text-text-tertiary font-mono',
      className
    )}>
      {children}
    </kbd>
  )
}
