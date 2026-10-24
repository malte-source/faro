import * as React from 'react'
import { cn } from '@/lib/utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        'flex h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-foreground md:h-9 md:text-sm placeholder:text-graphite focus:outline-none focus:border-night focus:ring-2 focus:ring-signal/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#1E3A4C] dark:bg-[#12293A] dark:text-mist dark:placeholder:text-[#6E8290]',
        className
      )}
      ref={ref}
      {...props}
    />
  )
)
Input.displayName = 'Input'

export { Input }
