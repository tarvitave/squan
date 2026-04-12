import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/utils.js'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-md bg-bg-primary border border-border px-3 py-2 text-sm text-text-primary',
        'placeholder:text-text-tertiary outline-none',
        'focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all',
        className
      )}
      {...props}
    />
  )
)
Input.displayName = 'Input'
