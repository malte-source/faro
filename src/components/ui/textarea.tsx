import * as React from 'react'
import { cn } from '@/lib/utils'

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        'flex min-h-[80px] w-full rounded-[10px] border border-stone bg-surface px-3 py-2 text-sm text-night placeholder:text-graphite focus:outline-none focus:border-night focus:ring-2 focus:ring-signal/40 disabled:cursor-not-allowed disabled:opacity-50 resize-none dark:border-[#1E3A4C] dark:bg-[#12293A] dark:text-mist dark:placeholder:text-[#6E8290]',
        className
      )}
      ref={ref}
      {...props}
    />
  )
)
Textarea.displayName = 'Textarea'

export { Textarea }
