import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Faro badge — pill-shaped state chip. Semantic variants match the brand
 * status palette (success/danger/info/warning) and the neutral ones use
 * Stone / Signal-wash / Noche for the four brand contexts.
 *
 * Sizing: 11px semibold with generous horizontal padding — reads as a status
 * pill, not a button. Never use badges as clickable UI.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors',
  {
    variants: {
      variant: {
        // Default: quiet neutral on stone
        default: 'bg-border-soft text-foreground',
        secondary: 'bg-border-soft text-graphite',
        // Semantic status pills
        success: 'bg-success-wash text-success',
        warning: 'bg-signal-wash text-signal-ink',
        danger: 'bg-danger-wash text-danger',
        orange: 'bg-signal-wash text-signal-ink',
        // Noche pill for "completed" — the reverse-out treatment
        night: 'bg-night text-mist',
        outline: 'border border-border text-graphite bg-transparent',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
