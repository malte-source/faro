'use client'

import { trpc } from '@/lib/trpc/client'
import { X, Check, AlertCircle } from 'lucide-react'
import { useEscapeClose } from '@/hooks/use-escape-close'

/**
 * Slide-over showing the last N runs of an automation — useful for debugging
 * "why didn't this fire?" or "why is it failing?". Each run shows whether
 * conditions matched, plus per-action outcome.
 */
export function AutomationRunsDrawer({ automationId, onClose }: { automationId: string; onClose: () => void }) {
  const { data, isLoading } = trpc.automations.runs.useQuery({ automationId })
  useEscapeClose(onClose)

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/50 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] md:pb-5 md:pt-5 shadow-2xl dark:bg-night"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-night dark:text-stone-100">Historial de ejecuciones</h2>
          <button onClick={onClose} className="rounded p-1 text-graphite hover:bg-stone-100 dark:hover:bg-night-700"><X className="h-4 w-4" /></button>
        </div>

        {isLoading && <p className="text-xs text-graphite">Cargando…</p>}
        {!isLoading && !data?.length && <p className="text-xs text-graphite">Sin ejecuciones todavía.</p>}

        <ul className="space-y-2">
          {data?.map(run => (
            <li key={run.id} className="rounded-lg border border-stone p-3 text-xs dark:border-ink-body">
              <div className="flex items-center gap-2">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${run.matched ? 'bg-success-wash text-success dark:bg-success/40 dark:text-success/50' : 'bg-stone-100 text-graphite dark:bg-night-700'}`}>
                  {run.matched ? <Check className="h-3 w-3" /> : '—'}
                </span>
                <span className="font-medium text-ink-body dark:text-stone">
                  {run.matched ? 'Condiciones OK' : 'No matcheó'}
                </span>
                <span className="ml-auto text-[10px] text-graphite">
                  {new Date(run.triggered_at).toLocaleString('es-AR')} · {run.duration_ms ?? 0}ms
                </span>
              </div>
              {run.matched && Array.isArray(run.results) && run.results.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-stone-100 pt-2 dark:border-night-700">
                  {run.results.map((r: { kind: string; ok: boolean; error?: string }, i: number) => (
                    <li key={i} className="flex items-start gap-1.5">
                      {r.ok
                        ? <Check className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                        : <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-danger" />
                      }
                      <span className="font-mono text-[10px]">{r.kind}</span>
                      {r.error && <span className="text-danger dark:text-danger">— {r.error}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
