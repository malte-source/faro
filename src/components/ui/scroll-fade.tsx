'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Scroll fade hints — wraps a scrollable container and shows a subtle gradient
 * at the top/bottom edges when there's more content scrolled out of view.
 *
 * Why this exists:
 *  - Long lists (sidebar, task lists, dropdown menus) often hide content with
 *    no visual cue. Users don't realize they can scroll, especially on mobile
 *    where scrollbars are invisible by default.
 *  - This adds a gradient overlay at the cut edge — same pattern Linear and
 *    Notion use.
 *
 * Usage:
 *   <ScrollFade className="max-h-80 overflow-y-auto">
 *     {children}
 *   </ScrollFade>
 *
 * Defaults:
 *  - Direction: vertical (`y`). Pass `direction="x"` for horizontal scrolling.
 *  - Color: white (with dark-mode night sibling). Override via `fadeColor`
 *    using a tailwind class like `from-mist dark:from-night-700`.
 *
 * Implementation notes:
 *  - Listens to onScroll + ResizeObserver to recompute when content changes.
 *  - The gradients are pointer-events-none so they don't block clicks inside.
 *  - Initial state assumes scrolled-to-top (showTop=false, showBottom=true if
 *    overflowing) — we measure on mount + after children change.
 */

interface Props {
  children: React.ReactNode
  className?: string
  direction?: 'y' | 'x'
  /** Tailwind gradient FROM color (top/left fade origin). */
  fadeColor?: string
  /** Fade strip size in px. */
  size?: number
}

export function ScrollFade({
  children,
  className = '',
  direction = 'y',
  fadeColor = 'from-white dark:from-night',
  size = 24,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [showStart, setShowStart] = useState(false)
  const [showEnd, setShowEnd] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const check = () => {
      if (direction === 'y') {
        setShowStart(el.scrollTop > 4)
        setShowEnd(el.scrollTop + el.clientHeight < el.scrollHeight - 4)
      } else {
        setShowStart(el.scrollLeft > 4)
        setShowEnd(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
      }
    }

    check()
    el.addEventListener('scroll', check, { passive: true })
    // Recompute when contents resize (e.g. list items load in).
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', check)
      ro.disconnect()
    }
  }, [direction])

  const startGradient =
    direction === 'y'
      ? `pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b ${fadeColor} to-transparent transition-opacity duration-150`
      : `pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r ${fadeColor} to-transparent transition-opacity duration-150`

  const endGradient =
    direction === 'y'
      ? `pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t ${fadeColor} to-transparent transition-opacity duration-150`
      : `pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l ${fadeColor} to-transparent transition-opacity duration-150`

  const sizeStyle = direction === 'y' ? { height: size } : { width: size }

  return (
    <div className="relative">
      <div ref={ref} className={className}>
        {children}
      </div>
      <div className={startGradient} style={{ ...sizeStyle, opacity: showStart ? 1 : 0 }} />
      <div className={endGradient} style={{ ...sizeStyle, opacity: showEnd ? 1 : 0 }} />
    </div>
  )
}
