'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc/client'
import { openCommandPalette } from '@/components/command/command-palette'
import { createTask } from './actions'
import { buildCatalog, displayKey, matcherDefs, type ShortcutInfo } from './catalog'
import { shouldIgnoreShortcut } from './guards'
import { SEQUENCE_TIMEOUT_MS, SequenceMatcher } from './matcher'
import { isOverlayOpen } from './overlay'
import { ShortcutsHelp } from './shortcuts-help'
import { useShortcuts } from './shortcuts-store'

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph', 'Dead', 'Unidentified'])

/**
 * Global keyboard layer: sequences ("g" then "h"), single keys (c, /, ?) and the help
 * sheet. It never fires while someone is typing, with a modifier held, or while a dialog,
 * sheet or the palette is open (see guards.ts), and it can be switched off from the help sheet.
 * List keys (j k x e Enter) live in useListNavigation; ⌘K in the palette; ⌘Z in the toaster.
 */
export function ShortcutsProvider() {
  const router = useRouter()
  const { data: me } = trpc.membership.me.useQuery(undefined, { staleTime: 60_000 })
  const groupMode = me?.groupMode ?? false
  const enabled = useShortcuts(s => s.enabled)
  const hint = useShortcuts(s => s.hint)
  const hydrate = useShortcuts(s => s.hydrate)

  const catalog = useMemo(() => buildCatalog({ groupMode }), [groupMode])
  const [matcher] = useState(() => new SequenceMatcher([])) // one instance for the provider's lifetime
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { hydrate() }, [hydrate])

  useEffect(() => { matcher.setDefs(matcherDefs(catalog)) }, [catalog, matcher])

  useEffect(() => {
    if (!enabled) return

    const clearHint = () => {
      if (hintTimer.current) clearTimeout(hintTimer.current)
      hintTimer.current = null
      useShortcuts.getState().setHint(null)
    }

    const run = (info: ShortcutInfo) => {
      switch (info.action) {
        case 'navigate': if (info.href) router.push(info.href); break
        case 'create': createTask(); break
        case 'search': openCommandPalette(); break
        case 'help': useShortcuts.getState().openHelp(); break
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (MODIFIER_KEYS.has(e.key)) return // pressing Shift for "?" must not cancel a pending "g"
      if (shouldIgnoreShortcut(e, { overlayOpen: isOverlayOpen() })) {
        if (matcher.pendingPrefix.length) { matcher.reset(); clearHint() }
        return
      }
      const result = matcher.feed(e.key, Date.now())
      if (result.type === 'pending') {
        const { prefix, next } = result
        useShortcuts.getState().setHint({ prefix, next })
        if (hintTimer.current) clearTimeout(hintTimer.current)
        hintTimer.current = setTimeout(clearHint, SEQUENCE_TIMEOUT_MS)
        return
      }
      clearHint()
      if (result.type !== 'match') return
      const info = catalog.find(s => s.id === result.id)
      if (!info) return
      e.preventDefault()
      run(info)
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      clearHint()
      matcher.reset()
    }
  }, [enabled, catalog, matcher, router])

  return (
    <>
      <ShortcutHint hint={hint} catalog={catalog} />
      <ShortcutsHelp catalog={catalog} />
    </>
  )
}

/** The small "g …" chip that appears for 1.5 s after a sequence prefix, listing what can follow. */
function ShortcutHint({ hint, catalog }: { hint: { prefix: string[]; next: string[] } | null; catalog: ShortcutInfo[] }) {
  if (!hint) return null
  const options = hint.next
    .map(key => {
      const info = catalog.find(s => s.keys.length === hint.prefix.length + 1 && hint.prefix.every((k, i) => s.keys[i] === k) && s.keys[hint.prefix.length] === key)
      return info ? { key, label: info.label.replace(/^Ir (a la |al |a |el )?/, '') } : null
    })
    .filter((o): o is { key: string; label: string } => !!o)
  return (
    <div
      role="status"
      className="pointer-events-none fixed bottom-4 left-4 z-[85] hidden items-center gap-2 rounded-xl bg-night px-3 py-2 text-mist shadow-lg ring-1 ring-signal/30 animate-in fade-in slide-in-from-bottom-1 md:flex"
    >
      <span className="flex items-center gap-1">
        {hint.prefix.map((k, i) => (
          <kbd key={i} className="rounded border border-signal/40 bg-night-700 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-signal">{displayKey(k)}</kbd>
        ))}
        <span className="text-xs text-graphite">…</span>
      </span>
      {options.length > 0 && (
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-stone">
          {options.map(o => (
            <span key={o.key} className="flex items-center gap-1">
              <kbd className="rounded border border-white/15 bg-night-700 px-1 font-mono text-[10px] text-mist">{displayKey(o.key)}</kbd>
              {o.label}
            </span>
          ))}
        </span>
      )}
    </div>
  )
}
