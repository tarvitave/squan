import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils.js'

/* Matches Goose's button.tsx exactly */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 outline-none",
  {
    variants: {
      variant: {
        default: 'bg-bg-inverse text-text-inverse hover:bg-bg-inverse/90 shadow-sm rounded-md',
        destructive: 'bg-bg-danger text-white hover:bg-bg-danger/90 shadow-sm rounded-md',
        outline: 'border hover:bg-bg-secondary rounded-md',
        secondary: 'bg-bg-secondary text-text-primary hover:bg-bg-secondary/80 shadow-sm rounded-md',
        ghost: 'hover:bg-bg-secondary rounded-md',
        link: 'text-text-primary underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-6 px-2 text-xs gap-1',
        sm: 'h-8 px-3 gap-1.5',
        default: 'h-9 px-4',
        lg: 'h-10 px-6',
        icon: 'h-9 w-9 rounded-full p-0',
        iconSm: 'h-7 w-7 rounded-full p-0',
        iconXs: 'h-6 w-6 rounded-full p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  )
)
Button.displayName = 'Button'
export { buttonVariants }
