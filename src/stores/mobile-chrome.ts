import { create } from 'zustand'

/**
 * Shared state for the mobile chrome (large-title nav bar, tab bar).
 * `scrollY` is the scroll offset of the page's main scroller; the Header
 * collapses its large title as it grows (iOS "large title" behaviour).
 */
interface MobileChromeState {
  scrollY: number
  setScrollY: (y: number) => void
}

export const useMobileChrome = create<MobileChromeState>(set => ({
  scrollY: 0,
  setScrollY: y => set(s => (s.scrollY === y ? s : { scrollY: y })),
}))
