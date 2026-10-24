'use client'

import { useSyncExternalStore } from 'react'

/**
 * Platform sniffing for install guidance and capture hints. Everything is
 * best-effort UA/feature detection — it only changes WHAT WE EXPLAIN, never
 * what works. The `use*` hooks report `false` on the server and first paint
 * (no hydration mismatch) and correct on the client.
 */

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/i.test(ua)) return true
  // iPadOS 13+ reports itself as a Mac, but has a touch screen.
  return /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1
}

export function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
}

/** Running as an installed app (Home Screen / WebAPK), not in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (window.navigator as { standalone?: boolean }).standalone === true
  )
}

const never = () => () => {}

export const useIsIOS = () => useSyncExternalStore(never, isIOS, () => false)
export const useIsStandalone = () => useSyncExternalStore(never, isStandalone, () => false)
