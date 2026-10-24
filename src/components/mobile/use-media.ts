'use client'

import { useSyncExternalStore } from 'react'

function subscribe(query: string, cb: () => void) {
  const mql = window.matchMedia(query)
  mql.addEventListener('change', cb)
  return () => mql.removeEventListener('change', cb)
}

/** `matchMedia` as a hook. Server render / first paint reports `false` (desktop) and corrects on hydrate. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    cb => subscribe(query, cb),
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** Below Tailwind's `md` breakpoint. */
export const useIsMobile = () => useMediaQuery('(max-width: 767px)')
