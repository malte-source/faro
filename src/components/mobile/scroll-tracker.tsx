'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useMobileChrome } from '@/stores/mobile-chrome'

/**
 * Listens (capture phase — scroll events don't bubble) to scrolling inside
 * <main> and publishes the offset of the page's primary scroller so the
 * Header can collapse its large title. Small or horizontal scrollers
 * (chat lists, kanban columns, chip rows) are ignored; opt a scroller out
 * explicitly with `data-no-track`.
 */
export function ScrollTracker() {
  const pathname = usePathname()
  const setScrollY = useMobileChrome(s => s.setScrollY)

  useEffect(() => { setScrollY(0) }, [pathname, setScrollY])

  useEffect(() => {
    let raf = 0
    let active: HTMLElement | null = null
    const onScroll = (e: Event) => {
      const el = e.target
      if (!(el instanceof HTMLElement)) return
      if (!el.closest('main') || el.closest('[data-no-track]')) return
      if (el.clientHeight < window.innerHeight * 0.4) return // not the page scroller
      if (active && active !== el && active.isConnected && active.scrollTop > 0) return
      active = el
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setScrollY(Math.max(0, Math.round(el.scrollTop))))
    }
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('scroll', onScroll, true)
      cancelAnimationFrame(raf)
    }
  }, [setScrollY])

  return null
}
