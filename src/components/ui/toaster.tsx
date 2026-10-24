'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react'

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
 *  - Bottom-right placement on desktop, top on mobile (less hand-blocking).
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

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])

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

  if (!items.length) return null

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 top-4 z-[90] flex flex-col items-center gap-2 px-4 sm:bottom-4 sm:right-4 sm:left-auto sm:top-auto sm:items-end sm:px-0"
    >
      {items.map(t => {
        const c = COLORS[t.kind]
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl ${c.bg} px-4 py-3 shadow-lg ring-1 ${c.ring} animate-in fade-in slide-in-from-top-2 sm:slide-in-from-right-4`}
          >
            <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${c.iconBg}`}>
              {c.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-night dark:text-mist">{t.title}</p>
              {t.description && <p className="mt-0.5 text-xs text-graphite">{t.description}</p>}
            </div>
            <button
              onClick={() => setItems(prev => prev.filter(x => x.id !== t.id))}
              className="shrink-0 rounded p-0.5 text-graphite hover:bg-stone-100 hover:text-foreground dark:hover:bg-[#17313F]"
              aria-label="Cerrar"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
