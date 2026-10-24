'use client'

import { useEffect } from 'react'

/**
 * Custom modals (those not built on shadcn/Radix Dialog) lacked Escape-to-close.
 * This hook standardizes that — drop it into any modal that has an `onClose`.
 *
 * Skips when the user is typing inside an input/textarea/contenteditable (Esc
 * there often has its own meaning, e.g. blur a select dropdown).
 */
export function useEscapeClose(onClose: () => void, when = true) {
  useEffect(() => {
    if (!when) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const tag = (e.target as HTMLElement | null)?.tagName
      // Allow native select close, etc. — but still close the modal if focus
      // is on the body / our own controls.
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        // Only swallow Esc if the input has focus AND the user has typed.
        const el = e.target as HTMLInputElement | HTMLTextAreaElement
        if (el.value.length > 0) return
      }
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, when])
}
