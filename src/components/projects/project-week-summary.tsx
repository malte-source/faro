'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Sparkles, Loader2, RefreshCw, TrendingUp, AlertTriangle, ChevronRight } from 'lucide-react'

/**
 * Project Overview card: AI-generated executive recap of "this week" —
 * activity in the last 7 days. Manual trigger (not auto) to keep Gemini
 * costs predictable and to make it clear when the data is fresh.
 */
export function ProjectWeekSummary({ projectId }: { projectId: string }) {
  const [opened, setOpened] = useState(false)
  const summarize = trpc.aiSummarize.summarizeProjectWeek.useMutation()

  return (
    <div className="rounded-xl border border-stone bg-white p-5 dark:border-night-700 dark:bg-night">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-signal-wash dark:bg-signal/40">
          <Sparkles className="h-5 w-5 text-signal-ink" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-night dark:text-stone-100">Resumen semanal</h3>
          <p className="text-xs text-graphite">
            TL;DR ejecutivo de los últimos 7 días — qué se movió, qué riesgos hay, qué viene.
          </p>
        </div>
        {opened && summarize.data && (
          <button
            onClick={() => summarize.mutate({ projectId })}
            disabled={summarize.isPending}
            className="inline-flex items-center gap-1 rounded-md border border-stone px-2 py-1 text-[11px] text-graphite hover:bg-mist disabled:opacity-50 dark:border-ink-body dark:text-stone dark:hover:bg-night-700"
          >
            <RefreshCw className={`h-3 w-3 ${summarize.isPending ? 'animate-spin' : ''}`} />
            Regenerar
          </button>
        )}
      </div>

      {!opened ? (
        <button
          onClick={() => { setOpened(true); summarize.mutate({ projectId }) }}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 active:scale-95"
        >
          <Sparkles className="h-3.5 w-3.5" /> Generar resumen
        </button>
      ) : (
        <div className="mt-4">
          {summarize.isPending && (
            <div className="flex items-center gap-2 text-sm text-graphite">
              <Loader2 className="h-4 w-4 animate-spin" /> Analizando actividad reciente…
            </div>
          )}
          {summarize.isError && (
            <p className="rounded-lg bg-danger-wash px-3 py-2 text-xs text-danger dark:bg-danger/30 dark:text-danger/50">
              {summarize.error.message}
            </p>
          )}
          {summarize.data && (
            <div className="space-y-3">
              <p className="rounded-lg bg-signal-wash/60 px-3 py-2 text-sm font-medium text-night dark:bg-signal/30 dark:text-signal">
                {summarize.data.headline}
              </p>

              {summarize.data.highlights.length > 0 && (
                <Section
                  icon={<TrendingUp className="h-3.5 w-3.5 text-success" />}
                  label="Avances"
                  items={summarize.data.highlights}
                />
              )}
              {summarize.data.risks.length > 0 && (
                <Section
                  icon={<AlertTriangle className="h-3.5 w-3.5 text-signal-ink" />}
                  label="Riesgos / alertas"
                  items={summarize.data.risks}
                />
              )}
              {summarize.data.next_week.length > 0 && (
                <Section
                  icon={<ChevronRight className="h-3.5 w-3.5 text-signal-ink" />}
                  label="Próxima semana"
                  items={summarize.data.next_week}
                />
              )}

              <p className="text-[10px] text-graphite">
                Basado en {summarize.data.tasks_count} tareas con movimiento + {summarize.data.comments_count} comentarios.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ icon, label, items }: { icon: React.ReactNode; label: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-graphite">
        {icon} {label}
      </p>
      <ul className="ml-4 list-disc space-y-0.5 text-xs text-ink-body dark:text-stone">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  )
}
