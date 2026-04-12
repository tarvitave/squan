import { cn } from '../../lib/utils.js'

export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('bg-bg-primary text-text-primary flex flex-col gap-4 rounded-xl border py-4 shadow-sm', className)} {...props} />
}
export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-start justify-between px-4', className)} {...props} />
}
export function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('text-sm font-medium leading-none', className)} {...props} />
}
export function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('text-text-secondary text-sm', className)} {...props} />
}
export function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('px-4', className)} {...props} />
}
