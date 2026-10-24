'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  /** Small line under the title. */
  description?: ReactNode
  children: ReactNode
  /** Pinned under the scrolling body (primary action row). */
  footer?: ReactNode
  /** Fill most of the screen (forms, pickers with long lists). */
  tall?: boolean
  className?: string
}

const DISMISS_PX = 110
const DISMISS_VELOCITY = 0.55 // px/ms

/**
 * Bottom sheet in the iOS/One UI idiom: grabber, 26px top corners, drag the
 * header down to dismiss, tap the scrim or press Esc to close, safe-area aware.
 * On desktop (≥ md) the same component renders as a centred modal.
 */
export function BottomSheet({ open, onClose, title, description, children, footer, tall = false, className }: BottomSheetProps) {
  // `present` keeps the panel in the DOM while it animates out; `entered` flips one frame after
  // mounting so the slide-in transition has a starting state. Both change only in callbacks.
  const [present, setPresent] = useState(open)
  const [entered, setEntered] = useState(false)
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ startY: number; startT: number; id: number } | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  // Callers pass inline `onClose` closures; keep the latest in a ref so effects never re-run
  // (re-running the focus effect on every keystroke stole focus back to the opener).
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  if (open && !present) setPresent(true) // adjust state during render (allowed, guarded)
  const mounted = open || present
  const shown = open && entered

  useEffect(() => {
    if (open) {
      returnFocus.current = document.activeElement as HTMLElement | null
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)))
      return () => cancelAnimationFrame(raf)
    }
    const t = setTimeout(() => { setPresent(false); setEntered(false); setDragY(0) }, 280)
    return () => clearTimeout(t)
  }, [open])

  // Scroll lock, Esc, focus.
  useEffect(() => {
    if (!mounted) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.body.dataset.sheetOpen = ''
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current() }
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus({ preventScroll: true })
    return () => {
      document.body.style.overflow = prevOverflow
      delete document.body.dataset.sheetOpen
      window.removeEventListener('keydown', onKey)
      returnFocus.current?.focus?.({ preventScroll: true })
    }
  }, [mounted])

  if (!mounted || typeof document === 'undefined') return null

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { startY: e.clientY, startT: performance.now(), id: e.pointerId }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    setDragY(Math.max(0, e.clientY - drag.current.startY))
  }
  const endDrag = (e: React.PointerEvent) => {
    if (!drag.current) return
    const dy = Math.max(0, e.clientY - drag.current.startY)
    const v = dy / Math.max(1, performance.now() - drag.current.startT)
    drag.current = null
    setDragging(false)
    if (dy > DISMISS_PX || v > DISMISS_VELOCITY) onClose()
    else setDragY(0)
  }

  const translate = shown ? dragY : null // null → CSS class drives the off-screen position

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center" role="presentation">
      <div
        className={cn('absolute inset-0 bg-night/50 backdrop-blur-[2px] transition-opacity duration-[280ms]', shown ? 'opacity-100' : 'opacity-0')}
        style={dragY > 0 ? { opacity: Math.max(0.2, 1 - dragY / 400) } : undefined}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        style={translate !== null ? { transform: `translateY(${translate}px)` } : undefined}
        className={cn(
          'relative flex w-full flex-col overflow-hidden bg-background shadow-[0_-8px_40px_rgba(10,26,38,0.25)] outline-none',
          'rounded-t-[26px] md:max-w-lg md:rounded-[22px]',
          tall ? 'h-[92dvh] md:h-auto md:max-h-[85dvh]' : 'max-h-[88dvh] md:max-h-[85dvh]',
          !dragging && 'transition-transform duration-[320ms] ease-[cubic-bezier(0.32,0.72,0,1)]',
          translate === null && 'translate-y-full md:translate-y-4 md:opacity-0',
          shown && 'md:opacity-100',
          className,
        )}
      >
        <div
          className="shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className="mx-auto mt-2.5 block h-1 w-10 rounded-full bg-stone dark:bg-border md:hidden" aria-hidden />
          {(title || description) && (
            <div className="px-5 pb-2 pt-3 md:pt-5">
              {title && <h2 className="font-display text-xl font-extrabold tracking-[-0.03em] text-foreground">{title}</h2>}
              {description && <p className="mt-0.5 text-[13px] text-graphite">{description}</p>}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4" data-no-track data-no-ptr>
          {children}
        </div>
        {footer && (
          <div className="shrink-0 border-t border-border bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">{footer}</div>
        )}
        {!footer && <div className="shrink-0 pb-[env(safe-area-inset-bottom)]" />}
      </div>
    </div>,
    document.body,
  )
}
