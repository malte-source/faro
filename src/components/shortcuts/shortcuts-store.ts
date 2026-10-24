import { create } from 'zustand'

const STORAGE_KEY = 'faro:shortcuts:enabled'

interface ShortcutsState {
  /** Master switch for every keyboard shortcut (the help sheet toggles it). */
  enabled: boolean
  helpOpen: boolean
  /** Pending sequence prefix ("g …") shown as a hint chip; null when idle. */
  hint: { prefix: string[]; next: string[] } | null
  setEnabled: (v: boolean) => void
  /** Load the saved preference (client only, after hydration). */
  hydrate: () => void
  openHelp: () => void
  closeHelp: () => void
  setHint: (hint: ShortcutsState['hint']) => void
}

export const useShortcuts = create<ShortcutsState>(set => ({
  enabled: true,
  helpOpen: false,
  hint: null,
  setEnabled: v => {
    try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0') } catch { /* private mode: the choice lasts until reload */ }
    set(v ? { enabled: true } : { enabled: false, hint: null })
  },
  hydrate: () => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === '0') set({ enabled: false })
    } catch { /* storage blocked: stay enabled */ }
  },
  openHelp: () => set({ helpOpen: true }),
  closeHelp: () => set({ helpOpen: false }),
  setHint: hint => set({ hint }),
}))

/** Open the "Atajos de teclado" sheet from anywhere (palette, buttons). */
export function openShortcutsHelp() {
  useShortcuts.getState().openHelp()
}
