'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { haptic } from '@/components/mobile/haptics'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  /** Small counter shown after the label. */
  count?: number
}

/**
 * iOS-style segmented control: a recessed track with a raised selected segment.
 * Use for 2–4 mutually exclusive views ("Mis tareas / Todas", "Lista / Tablero").
 */
export function Segmented<T extends string>({
  value, onChange, options, className, 'aria-label': ariaLabel,
}: { value: T; onChange: (v: T) => void; options: SegmentedOption<T>[]; className?: string; 'aria-label'?: string }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn('flex rounded-[11px] bg-border-soft p-0.5', className)}>
      {options.map(o => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => { if (!selected) { haptic(); onChange(o.value) } }}
            className={cn(
              'flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[9px] px-3 text-[13px] font-medium transition-all duration-200',
              selected ? 'bg-surface text-foreground shadow-[0_1px_3px_rgba(10,26,38,0.14)]' : 'text-graphite active:text-foreground',
            )}
          >
            <span className="truncate">{o.label}</span>
            {o.count !== undefined && <span className="text-[11px] tabular-nums text-graphite">{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
