'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Minimal popover: closes on outside click and on Escape. The caller controls
 * `open` and renders its own trigger (so the trigger keeps its aria state).
 */
export function Popover({
  open,
  onClose,
  children,
  className,
  align = 'left',
  label,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  align?: 'left' | 'right'
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={cn(
        'absolute z-30 mt-1 rounded-xl border border-stone bg-surface p-1.5 shadow-[0_8px_24px_rgba(10,26,38,0.14)] dark:border-[#1E3A4C] dark:bg-[#12293A]',
        align === 'right' ? 'right-0' : 'left-0',
        className,
      )}
    >
      {children}
    </div>
  )
}
