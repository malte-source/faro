'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, ArrowDown } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { haptic } from '@/components/mobile/haptics'
import { cn } from '@/lib/utils'

const THRESHOLD = 68
const MAX_PULL = 110

function scrollerOf(el: EventTarget | null): HTMLElement | null {
  let node = el instanceof HTMLElement ? el : null
  while (node && node !== document.body) {
    if (node.hasAttribute('data-no-ptr')) return null
    const oy = getComputedStyle(node).overflowY
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 1) return node
    node = node.parentElement
  }
  return node === document.body ? document.body : null
}

/**
 * Global pull-to-refresh for the mobile app: drag down from the top of any
 * scrolling screen to refetch every active query (tRPC `invalidate`). Native
 * browser pull-to-refresh is disabled in CSS (`overscroll-behavior`), so this
 * is the only one and never reloads the page. Surfaces that must keep their
 * own vertical drag (chat, kanban, sheets) opt out with `data-no-ptr`.
 */
export function PullToRefresh() {
  const utils = trpc.useUtils()
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const state = useRef<{ y: number; scroller: HTMLElement | null; active: boolean; armed: boolean } | null>(null)
  const busy = useRef(false)

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)')
    const onStart = (e: TouchEvent) => {
      if (!mql.matches || busy.current || document.body.dataset.sheetOpen !== undefined) return
      const target = e.target as HTMLElement | null
      if (!target?.closest('main')) return
      const scroller = scrollerOf(target)
      if (scroller === null && !target.closest('main')) return
      state.current = { y: e.touches[0].clientY, scroller, active: false, armed: false }
    }
    const onMove = (e: TouchEvent) => {
      const s = state.current
      if (!s || busy.current) return
      const dy = e.touches[0].clientY - s.y
      const top = s.scroller ? s.scroller.scrollTop <= 0 : true
      if (dy <= 0 || !top) { if (s.active) { s.active = false; setPull(0) } return }
      s.active = true
      const eased = Math.min(MAX_PULL, dy * 0.5)
      setPull(eased)
      if (!s.armed && eased >= THRESHOLD) { s.armed = true; haptic() }
      if (s.armed && eased < THRESHOLD) s.armed = false
    }
    const onEnd = async () => {
      const s = state.current
      state.current = null
      if (!s?.active) return
      if (s.armed) {
        busy.current = true
        setRefreshing(true)
        setPull(THRESHOLD * 0.75)
        const started = Date.now()
        try { await utils.invalidate() } catch { /* a failed refetch surfaces in its own screen */ }
        await new Promise(r => setTimeout(r, Math.max(0, 650 - (Date.now() - started))))
        haptic('success')
        setRefreshing(false)
        busy.current = false
      }
      setPull(0)
    }
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', onEnd)
    document.addEventListener('touchcancel', onEnd)
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [utils])

  if (pull === 0 && !refreshing) return null
  const ready = pull >= THRESHOLD
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[55] flex justify-center md:hidden"
      style={{ top: 'calc(env(safe-area-inset-top) + 52px)', transform: `translateY(${pull - 24}px)`, opacity: Math.min(1, pull / 40) }}
      aria-hidden
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface shadow-[0_2px_12px_rgba(10,26,38,0.25)] ring-1 ring-border">
        {refreshing
          ? <Loader2 className="h-4 w-4 animate-spin text-signal-ink" />
          : <ArrowDown className={cn('h-4 w-4 text-graphite transition-transform duration-200', ready && 'rotate-180 text-signal-ink')} />}
      </span>
    </div>
  )
}
