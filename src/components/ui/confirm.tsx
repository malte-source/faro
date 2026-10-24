'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Imperative confirm dialog — replaces `window.confirm()` everywhere.
 *
 * Usage:
 *   const ok = await confirmAction({
 *     title: 'Borrar tarea',
 *     description: 'Esta acción no se puede deshacer.',
 *     variant: 'destructive',
 *   })
 *   if (ok) doIt()
 *
 * Why imperative (not declarative): keeps mutation call-sites concise. Same
 * mental model as window.confirm but with proper styling, dark mode, escape
 * handling, focus management, and i18n-ready copy.
 *
 * Mount the <ConfirmHost /> once in the root layout/providers tree.
 */

type Variant = 'default' | 'destructive' | 'warning'

interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: Variant
}

const EVENT_REQUEST = 'faro:confirm:request'
const EVENT_RESOLVE = 'faro:confirm:resolve'

let requestId = 0

export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  return new Promise(resolve => {
    const id = ++requestId
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ id: number; ok: boolean }>
      if (ce.detail.id !== id) return
      window.removeEventListener(EVENT_RESOLVE, handler)
      resolve(ce.detail.ok)
    }
    window.addEventListener(EVENT_RESOLVE, handler)
    window.dispatchEvent(new CustomEvent(EVENT_REQUEST, { detail: { id, opts } }))
  })
}

export function ConfirmHost() {
  const [state, setState] = useState<{ id: number; opts: ConfirmOptions } | null>(null)

  useEffect(() => {
    const onRequest = (e: Event) => {
      const ce = e as CustomEvent<{ id: number; opts: ConfirmOptions }>
      setState(ce.detail)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && state) resolve(false)
    }
    window.addEventListener(EVENT_REQUEST, onRequest)
    window.addEventListener('keydown', onEsc)
    return () => {
      window.removeEventListener(EVENT_REQUEST, onRequest)
      window.removeEventListener('keydown', onEsc)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  function resolve(ok: boolean) {
    if (!state) return
    window.dispatchEvent(new CustomEvent(EVENT_RESOLVE, { detail: { id: state.id, ok } }))
    setState(null)
  }

  if (!state) return null
  const { opts } = state
  const variant = opts.variant ?? 'default'
  const accent =
    variant === 'destructive' ? { iconBg: 'bg-danger-wash', icon: 'text-danger' } :
    variant === 'warning'     ? { iconBg: 'bg-signal-wash', icon: 'text-signal-ink' } :
                                { iconBg: 'bg-border-soft', icon: 'text-foreground' }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(10,26,38,0.55)] p-4 animate-in fade-in"
      onClick={() => resolve(false)}
    >
      <div
        className="w-full max-w-md rounded-[18px] border border-stone bg-surface p-5 shadow-[0_8px_24px_rgba(10,26,38,0.12)] dark:border-[#1E3A4C] dark:bg-[#12293A] animate-in zoom-in-95 fade-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${accent.iconBg}`}>
            <AlertTriangle className={`h-5 w-5 ${accent.icon}`} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="confirm-title" className="font-display text-base font-bold text-night dark:text-mist">
              {opts.title}
            </h2>
            {opts.description && (
              <p className="mt-1 whitespace-pre-line text-sm text-graphite">
                {opts.description}
              </p>
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => resolve(false)}>
            {opts.cancelLabel ?? 'Cancelar'}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            onClick={() => resolve(true)}
            autoFocus
          >
            {opts.confirmLabel ?? 'Confirmar'}
          </Button>
        </div>
      </div>
    </div>
  )
}
