'use client'

import Link from 'next/link'
import { trpc } from '@/lib/trpc/client'
import { cn } from '@/lib/utils'
import { Flame, AlertOctagon, ArrowRight } from 'lucide-react'
import { DueDateChip } from '@/components/ui/due-date-chip'

const PRIORITY_DOT: Record<string, string> = {
  very_high: 'bg-danger', high: 'bg-signal-ink', medium: 'bg-signal-ink', low: 'bg-success', very_low: 'bg-stone',
}

/**
 * Cross-project priority feed. Lists the top tasks ranked by a composite
 * score (priority weight × deadline proximity × project health × in-flight).
 * Designed to answer "qué tengo que hacer YA, sin importar de qué proyecto".
 */
export function PriorityFeed() {
  // Poll every 45 s — cross-project ranking changes slowly enough.
  const { data, isLoading } = trpc.tasks.priorityFeed.useQuery(undefined, { refetchInterval: 45_000 })

  if (isLoading) {
    return <div className="space-y-2">{[...Array(8)].map((_, i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-stone-100 dark:bg-night-700" />)}</div>
  }
  if (!data?.length) {
    return (
      <div className="rounded-xl border border-dashed border-success/50 bg-success-wash/40 p-12 text-center dark:border-success/40 dark:bg-success/20">
        <p className="text-sm font-semibold text-success dark:text-success/30">Sin pendientes prioritarios.</p>
        <p className="mt-1 text-xs text-success/80 dark:text-success/50/80">El equipo está al día.</p>
      </div>
    )
  }

  const maxScore = Math.max(...data.map(t => t._score))

  return (
    <div className="rounded-xl border border-stone bg-white dark:border-night-700 dark:bg-night">
      <header className="flex items-center gap-3 border-b border-stone-100 px-4 py-3 dark:border-night-700">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-danger-wash dark:bg-danger/40">
          <Flame className="h-4 w-4 text-danger" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-night dark:text-stone-100">Lo que más arde</h2>
          <p className="text-[10px] uppercase tracking-wider text-graphite">
            Ranking de {data.length} tareas por urgencia (prioridad × deadline × salud del proyecto)
          </p>
        </div>
      </header>
      <ul className="divide-y divide-stone-100 dark:divide-night-700">
        {data.map((t, i) => {
          const proj = t.project as { id: string; code: string; name: string; color: string } | null
          const assignee = t.assignee as { name: string; avatar_url: string | null } | null
          const intensity = t._score / maxScore // 0..1
          return (
            <li key={t.id}>
              <Link
                href={proj ? `/dashboard/projects/${proj.id}` : '#'}
                className="flex min-h-[60px] items-center gap-3 px-4 py-3 transition active:bg-border-soft md:min-h-0 md:py-2.5 md:hover:bg-background dark:md:hover:bg-night-700/60"
              >
                <span className="w-6 text-center text-xs font-bold tabular-nums text-graphite">{i + 1}</span>
                <span className={cn('h-2 w-2 shrink-0 rounded-full', PRIORITY_DOT[t.priority])} />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm text-night-700 md:truncate dark:text-stone">{t.title}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-graphite">
                    {proj && (
                      <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: proj.color }} />
                        {proj.code}
                      </span>
                    )}
                    {assignee?.name && <span>· {assignee.name}</span>}
                    {t.due_date && (
                      <>
                        <span>·</span>
                        <DueDateChip date={t.due_date} isDone={t.status === 'done' || t.status === 'canceled'} compact />
                      </>
                    )}
                    {t.review_state === 'requested' && <span className="rounded bg-purple-100 px-1 py-px text-[9px] font-semibold uppercase text-purple-700">en revisión</span>}
                  </div>
                </div>
                {/* Score bar */}
                <div className="hidden w-24 sm:block">
                  <div className="h-1 overflow-hidden rounded-full bg-stone-100 dark:bg-night-700">
                    <div className="h-full rounded-full bg-gradient-to-r from-signal-ink to-danger" style={{ width: `${intensity * 100}%` }} />
                  </div>
                  <p className="mt-0.5 text-right text-[9px] font-mono tabular-nums text-graphite">score {t._score}</p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-stone" />
              </Link>
            </li>
          )
        })}
      </ul>
      <footer className="border-t border-stone-100 px-4 py-2 text-[10px] text-graphite dark:border-night-700">
        <span className="inline-flex items-center gap-1">
          <AlertOctagon className="h-2.5 w-2.5" />
          Scoring: prioridad (5-100) + días vencida × 5 (cap 60) + proyecto con salud {'<50'} (+10) + ya en progreso (+5)
        </span>
      </footer>
    </div>
  )
}
