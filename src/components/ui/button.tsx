'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Faro button — reads from brand tokens (Noche + Señal + Stone).
 *
 * Variants:
 *   default      → primary action (Noche fill, Mist text). Most submits.
 *   signal       → single-per-screen highlight action (Señal fill, Noche text).
 *                  Reserved for "Generar análisis", "Crear workspace de equipo",
 *                  and similar upgrade / IA CTAs. Never a generic submit.
 *   destructive  → red for irreversible actions.
 *   outline      → ghosted Noche outline, mist hover.
 *   secondary    → Stone fill, quiet complements.
 *   ghost        → borderless / no-fill, hover fills Stone-100.
 *   link         → underlined Signal-ink text; used inline.
 *
 * Focus ring is Señal — accessibility requirement, not decorative.
 * Radii are 10px per brand tokens (rounded-[10px]).
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // Noche fill on light; on Noche surfaces the primary action flips to Señal so it never vanishes.
        default: 'bg-night text-mist hover:bg-night-700 dark:bg-signal dark:text-night dark:hover:bg-signal/90',
        signal: 'bg-signal text-night font-semibold hover:bg-[#F0A30F]',
        destructive: 'bg-danger text-white hover:bg-[#B03A30]',
        outline: 'border border-night bg-surface text-foreground hover:bg-background',
        secondary: 'bg-border-soft text-foreground hover:bg-border',
        ghost: 'text-graphite hover:bg-border-soft hover:text-foreground',
        link: 'text-signal-ink underline-offset-4 hover:underline',
      },
      size: {
        // Thumb-sized (44px) on phones, compact on desktop.
        default: 'h-11 px-4 py-2 md:h-9',
        sm: 'h-10 px-3 text-xs md:h-8',
        lg: 'h-12 px-6 md:h-11',
        icon: 'h-11 w-11 md:h-9 md:w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  )
)
Button.displayName = 'Button'

export { Button, buttonVariants }
