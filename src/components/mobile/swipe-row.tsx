'use client'

import { useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { haptic } from '@/components/mobile/haptics'

export interface SwipeAction {
  label: string
  icon?: ReactNode
  tone: 'success' | 'danger' | 'signal' | 'neutral'
  onTrigger: () => void
}

const TONE: Record<SwipeAction['tone'], string> = {
  success: 'bg-success text-white',
  danger: 'bg-danger text-white',
  signal: 'bg-signal text-night',
  neutral: 'bg-graphite text-white',
}
const ACTION_W = 84

/**
 * Swipe-left to reveal row actions (iOS "swipe actions" / One UI list swipe).
 * A short swipe parks the actions open; a long swipe fires the first action.
 * Vertical scrolling stays native (`touch-action: pan-y`); mouse users get the
 * actions through the row's own menus, so this is touch-only by design.
 */
export function SwipeRow({ children, actions, className }: { children: ReactNode; actions: SwipeAction[]; className?: string }) {
  const [x, setX] = useState(0)
  const [animate, setAnimate] = useState(true)
  const start = useRef<{ x: number; y: number; base: number; axis: 'x' | 'y' | null } | null>(null)
  const open = useRef(false)
  const total = ACTION_W * actions.length

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    start.current = { x: t.clientX, y: t.clientY, base: open.current ? -total : 0, axis: null }
    setAnimate(false)
  }
  const onTouchMove = (e: React.TouchEvent) => {
    const s = start.current
    if (!s) return
    const t = e.touches[0]
    const dx = t.clientX - s.x
    const dy = t.clientY - s.y
    if (!s.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    }
    if (s.axis !== 'x') return
    const raw = s.base + dx
    // rubber-band beyond the actions' width
    const next = raw < -total ? -total + (raw + total) * 0.4 : Math.min(0, raw)
    setX(next)
  }
  const onTouchEnd = () => {
    const s = start.current
    start.current = null
    setAnimate(true)
    if (!s || s.axis !== 'x') return
    if (x < -total * 1.6 && actions[0]) {
      haptic('success')
      setX(0); open.current = false
      actions[0].onTrigger()
    } else if (x < -total * 0.45) {
      haptic()
      setX(-total); open.current = true
    } else {
      setX(0); open.current = false
    }
  }
  const close = () => { setAnimate(true); setX(0); open.current = false }

  return (
    <div className={cn('relative overflow-hidden', className)}>
      <div className="absolute inset-y-0 right-0 flex" style={{ width: total }} aria-hidden={x === 0}>
        {actions.map(a => (
          <button
            key={a.label}
            type="button"
            tabIndex={x === 0 ? -1 : 0}
            onClick={() => { haptic('success'); close(); a.onTrigger() }}
            className={cn('flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold', TONE[a.tone])}
          >
            {a.icon}
            {a.label}
          </button>
        ))}
      </div>
      <div
        className={cn('relative bg-surface [touch-action:pan-y]', animate && 'transition-transform duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)]')}
        style={{ transform: `translateX(${x}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {children}
      </div>
    </div>
  )
}
