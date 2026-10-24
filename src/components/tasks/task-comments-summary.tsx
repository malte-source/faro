'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Sparkles, Loader2, X, CheckCircle2, AlertCircle, ChevronRight } from 'lucide-react'

/**
 * Inline AI summarize button for the task comments thread.
 * Only renders when there are enough comments to make a summary worthwhile.
 *
 * The result is shown right above the comments — a small card with
 * "TL;DR + decisiones + abiertas + siguientes pasos".
 */
export function TaskCommentsSummary({ taskId, commentsCount }: { taskId: string; commentsCount: number }) {
  const [open, setOpen] = useState(false)
  const summarize = trpc.aiSummarize.summarizeTaskComments.useMutation()

  if (commentsCount < 3) return null  // not worth it

  return (
    <div className="mb-3">
      {!summarize.data && !open ? (
        <button
          onClick={() => { setOpen(true); summarize.mutate({ taskId }) }}
          className="inline-flex items-center gap-1.5 rounded-md border border-stone bg-signal-wash/60 px-2 py-1 text-[11px] font-medium text-night hover:bg-signal-wash dark:border-signal/40 dark:bg-signal/30 dark:text-signal"
        >
          <Sparkles className="h-3 w-3" /> Resumir conversación ({commentsCount})
        </button>
      ) : (
        <div className="rounded-lg border border-stone bg-gradient-to-br from-signal-wash/40 to-white p-3 dark:border-signal/40 dark:from-[#17313F] dark:to-night">
          <div className="mb-2 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-night dark:text-signal">
              <Sparkles className="h-3 w-3" /> Resumen AI
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => summarize.mutate({ taskId })}
                disabled={summarize.isPending}
                className="rounded p-0.5 text-signal-ink hover:bg-signal-wash disabled:opacity-50 dark:hover:bg-signal/40"
                title="Regenerar"
              >
                <Sparkles className="h-3 w-3" />
              </button>
              <button
                onClick={() => { setOpen(false); summarize.reset() }}
                className="rounded p-0.5 text-graphite hover:bg-stone-100 dark:hover:bg-night-700"
                title="Cerrar"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>

          {summarize.isPending && (
            <div className="flex items-center gap-2 text-xs text-graphite">
              <Loader2 className="h-3 w-3 animate-spin" /> Analizando…
            </div>
          )}
          {summarize.isError && (
            <p className="text-xs text-danger">{summarize.error.message}</p>
          )}
          {summarize.data && (
            <div className="space-y-2 text-xs">
              <p className="text-ink-body dark:text-stone">{summarize.data.tldr}</p>
              {summarize.data.decisions.length > 0 && (
                <SummarySection
                  icon={<CheckCircle2 className="h-3 w-3 text-success" />}
                  label="Decisiones"
                  items={summarize.data.decisions}
                />
              )}
              {summarize.data.next_steps.length > 0 && (
                <SummarySection
                  icon={<ChevronRight className="h-3 w-3 text-signal-ink" />}
                  label="Próximos pasos"
                  items={summarize.data.next_steps}
                />
              )}
              {summarize.data.open_questions.length > 0 && (
                <SummarySection
                  icon={<AlertCircle className="h-3 w-3 text-signal-ink" />}
                  label="Abiertas"
                  items={summarize.data.open_questions}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SummarySection({ icon, label, items }: { icon: React.ReactNode; label: string; items: string[] }) {
  return (
    <div>
      <p className="mb-0.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-graphite">
        {icon} {label}
      </p>
      <ul className="ml-3 list-disc space-y-0.5 text-[11px] text-ink-body dark:text-stone">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  )
}
