'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, Info, AlertTriangle, X, Undo2 } from 'lucide-react'
import { undoQueue, type UndoEntry, type UndoOptions } from '@/lib/undo-queue'
import { isEditableTarget } from '@/components/shortcuts/guards'

/**
 * Minimal toast system — no deps, no context provider.  Uses a CustomEvent
 * bus on `window` so any component can fire `toast.success('...')` without
 * needing access to a provider.  The <Toaster /> sits in the root layout and
 * listens for these events.
 *
 * Design choices:
 *  - Event-based dispatch (rather than React context) so module-level helpers
 *    `toast.success()` work from outside the React tree (e.g. mutation onSuccess).
 *  - No queue limit — just trim old ones if more than 5 stack up.
 *  - Auto-dismiss after 4 s (or 7 s for errors); user can dismiss manually too.
 *  - Phones: pinned above the tab bar (thumb range, never under the raised capture
 *    button). Desktop: bottom-right.
 *  - `toast.undo(...)` opens a 6 s undo window (see src/lib/undo-queue.ts): an
 *    "Deshacer" button, a progress bar and ⌘Z / Ctrl+Z while it is visible.
 */

type ToastKind = 'success' | 'error' | 'info' | 'warning'

interface ToastItem {
  id: number
  kind: ToastKind
  title: string
  description?: string
  ts: number
}

const EVENT_NAME = 'faro:toast'
let counter = 0

function emit(kind: ToastKind, title: string, description?: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<{ kind: ToastKind; title: string; description?: string }>(EVENT_NAME, {
    detail: { kind, title, description },
  }))
}

/** Module-level helpers — callable from anywhere, including outside React. */
export const toast = {
  success: (title: string, description?: string) => emit('success', title, description),
  error:   (title: string, description?: string) => emit('error', title, description),
  info:    (title: string, description?: string) => emit('info', title, description),
  warning: (title: string, description?: string) => emit('warning', title, description),
  /**
   * An action the user can take back for a few seconds. Two uses:
   *  - already applied → `onUndo` performs the inverse ("Tarea completada");
   *  - delayed → `onCommit` performs it when the window closes without an undo
   *    (deleting): nothing happens until then, `onUndo` just releases the held-back state.
   * Returns the undo id.
   */
  undo: (title: string, opts: UndoOptions = {}) => undoQueue.push(title, opts),
}

const COLORS: Record<ToastKind, { bg: string; ring: string; icon: React.ReactNode; iconBg: string }> = {
  success: {
    bg: 'bg-surface dark:bg-[#12293A]',
    ring: 'ring-success/25',
    iconBg: 'bg-success-wash',
    icon: <CheckCircle2 className="h-4 w-4 text-success" />,
  },
  error: {
    bg: 'bg-surface dark:bg-[#12293A]',
    ring: 'ring-danger/25',
    iconBg: 'bg-danger-wash',
    icon: <XCircle className="h-4 w-4 text-danger" />,
  },
  info: {
    bg: 'bg-surface dark:bg-[#12293A]',
    ring: 'ring-info/25',
    iconBg: 'bg-info/10',
    icon: <Info className="h-4 w-4 text-info" />,
  },
  warning: {
    bg: 'bg-surface dark:bg-[#12293A]',
    ring: 'ring-signal/30',
    iconBg: 'bg-signal-wash',
    icon: <AlertTriangle className="h-4 w-4 text-signal-ink" />,
  },
}

/** One undo window: Deshacer + ⌘Z hint + a progress bar that drains over its duration. */
function UndoToast({ entry }: { entry: UndoEntry }) {
  // The bar starts full and drains linearly; flipping `run` one frame after mount starts the transition.
  const [run, setRun] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setRun(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      role="status"
      className="pointer-events-auto relative flex w-full max-w-sm items-center gap-3 overflow-hidden rounded-xl bg-surface px-4 py-3 shadow-lg ring-1 ring-signal/30 animate-in fade-in slide-in-from-bottom-2 dark:bg-[#12293A] sm:slide-in-from-right-4"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-signal-wash dark:bg-signal/15">
        <Undo2 className="h-4 w-4 text-signal-ink" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{entry.title}</p>
        {entry.description && <p className="mt-0.5 truncate text-xs text-graphite">{entry.description}</p>}
      </div>
      <button
        type="button"
        onClick={() => undoQueue.undo(entry.id)}
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-bold text-signal-ink hover:bg-signal-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal dark:hover:bg-signal/15"
      >
        Deshacer
        <kbd className="hidden rounded border border-border bg-border-soft px-1 font-mono text-[10px] font-medium text-graphite md:inline">⌘Z</kbd>
      </button>
      <button
        type="button"
        onClick={() => undoQueue.commit(entry.id)}
        className="shrink-0 rounded p-1 text-graphite hover:bg-border-soft hover:text-foreground"
        aria-label="Cerrar"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-signal"
        style={{ width: run ? '0%' : '100%', transition: `width ${entry.duration}ms linear` }}
      />
    </div>
  )
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])
  const [undos, setUndos] = useState<UndoEntry[]>(() => undoQueue.entries())

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ kind: ToastKind; title: string; description?: string }>
      const id = ++counter
      const item: ToastItem = { id, ts: Date.now(), ...ce.detail }
      setItems(prev => {
        const next = [...prev, item]
        return next.length > 5 ? next.slice(-5) : next  // trim queue
      })
      const ttl = ce.detail.kind === 'error' ? 7000 : 4000
      setTimeout(() => setItems(prev => prev.filter(t => t.id !== id)), ttl)
    }
    window.addEventListener(EVENT_NAME, handler)
    return () => window.removeEventListener(EVENT_NAME, handler)
  }, [])

  // Undo windows: mirror the queue, ⌘Z / Ctrl+Z reverts the latest, and a page that is being
  // left accepts whatever is still pending (a delayed delete must not silently vanish).
  useEffect(() => {
    const unsubscribe = undoQueue.subscribe(setUndos)
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return
      if (isEditableTarget(e.target as HTMLElement | null)) return // native text undo wins inside fields
      if (undoQueue.entries().length === 0) return
      e.preventDefault()
      undoQueue.undoLatest()
    }
    const onPageHide = () => undoQueue.flushAll()
    document.addEventListener('keydown', onKey)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      unsubscribe()
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [])

  if (!items.length && !undos.length) return null

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      // Phones: above the tab bar and the raised capture button (64px bar + 22px button + gap).
      className="pointer-events-none fixed inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-[90] flex flex-col items-center gap-2 px-4 sm:bottom-4 sm:left-auto sm:right-4 sm:items-end sm:px-0"
    >
      {items.map(t => {
        const c = COLORS[t.kind]
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl ${c.bg} px-4 py-3 shadow-lg ring-1 ${c.ring} animate-in fade-in slide-in-from-bottom-2 sm:slide-in-from-right-4`}
          >
            <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${c.iconBg}`}>
              {c.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{t.title}</p>
              {t.description && <p className="mt-0.5 text-xs text-graphite">{t.description}</p>}
            </div>
            <button
              onClick={() => setItems(prev => prev.filter(x => x.id !== t.id))}
              className="shrink-0 rounded p-0.5 text-graphite hover:bg-border-soft hover:text-foreground"
              aria-label="Cerrar"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
      {undos.map(u => <UndoToast key={u.id} entry={u} />)}
    </div>
  )
}
