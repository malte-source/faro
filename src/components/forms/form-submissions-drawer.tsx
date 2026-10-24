'use client'

import { trpc } from '@/lib/trpc/client'
import { X, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { useEscapeClose } from '@/hooks/use-escape-close'

/**
 * Right-side drawer: timeline of all submissions to a form.
 * Each shows: timestamp, raw data, link to created task (or error if none).
 */
export function FormSubmissionsDrawer({ formId, onClose }: { formId: string; onClose: () => void }) {
  const { data, isLoading } = trpc.forms.submissions.useQuery({ formId })
  useEscapeClose(onClose)

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/50 backdrop-blur-[2px]" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] md:pb-5 md:pt-5 shadow-2xl dark:bg-night" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Submissions del formulario</h2>
          <button onClick={onClose} className="rounded p-1 text-graphite hover:bg-stone-100 dark:hover:bg-night-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isLoading && <p className="text-xs text-graphite">Cargando…</p>}
        {!isLoading && !data?.length && <p className="text-xs text-graphite">Sin submissions todavía.</p>}

        <ul className="space-y-3">
          {data?.map(s => {
            const task = (s as unknown as { task: { id: string; title: string; status: string } | null }).task
            const raw = s.raw_data as Record<string, string>
            return (
              <li key={s.id} className="rounded-lg border border-stone p-3 text-xs dark:border-ink-body">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[10px] text-graphite">
                    {new Date(s.submitted_at).toLocaleString('es-AR')}
                  </span>
                  {task ? (
                    <Link
                      href={`/dashboard/tasks?taskId=${task.id}`}
                      className="inline-flex items-center gap-1 rounded bg-success-wash px-1.5 py-0.5 text-[9px] font-semibold text-success hover:bg-success/30 dark:bg-success/40 dark:text-success/50"
                    >
                      <CheckCircle2 className="h-2.5 w-2.5" /> Tarea creada
                      <ExternalLink className="h-2.5 w-2.5" />
                    </Link>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-signal-wash px-1.5 py-0.5 text-[9px] font-semibold text-signal-ink dark:bg-signal/40 dark:text-signal/50">
                      <AlertCircle className="h-2.5 w-2.5" /> Sin tarea
                    </span>
                  )}
                </div>
                {task && (
                  <p className="mt-1 text-xs font-medium text-ink-body dark:text-stone">{task.title}</p>
                )}
                <div className="mt-2 space-y-1 border-t border-stone-100 pt-2 dark:border-night-700">
                  {Object.entries(raw).map(([k, v]) => (
                    <div key={k} className="flex gap-2 text-[10px]">
                      <span className="shrink-0 font-mono text-graphite">{k}:</span>
                      <span className="text-ink-body dark:text-stone">{String(v)}</span>
                    </div>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
